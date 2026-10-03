// ============================================================
// tests/canvas.test.mjs — the pure half of the Canvas component (js/ui/ink.js).
//
// The DOM half (pointer events, rAF, toolbar) is exercised in a real browser via
// ui-gallery.html#canvas; everything that can be wrong without a screen — smoothing,
// batching, length, sizing, colour safety, reconciliation — is checked here, and the
// wire format is checked against the REAL normalizeInk / applyInkBatch in session.js.
// ============================================================

import { test, assert } from './lib.mjs';
import { mulberry32 } from '../js/core/engine-kit.js';
import { normalizeInk, applyInkBatch, emptyInk } from '../js/core/session.js';
import {
  SIZE, PAPER, PALETTE, WIDTHS, ERASER_MULT, BATCH_MS, MAX_PTS_PER_BATCH, MAX_PTS_PER_STROKE,
  clampCoord, toLogical, strokeLength, backingSize, edgeInset, safeColor, resolveStyle, makeStrokeIds,
  pathState, advancePath, finishPath, paceCount, splitBatches, createOutbox, syncPlan,
} from '../js/ui/ink.js';

// ---------- helpers ----------
function recorder() {
  const calls = [];
  const g = {};
  for (const m of ['beginPath', 'moveTo', 'quadraticCurveTo', 'lineTo', 'arc', 'fill', 'stroke']) g[m] = (...a) => calls.push([m, ...a]);
  return { g, calls };
}

/** Turn recorded canvas calls into a list of segments, independent of how the calls were chunked. */
function segments(calls) {
  const out = [];
  let cur = null;
  for (const [m, ...a] of calls) {
    if (m === 'moveTo') cur = [a[0], a[1]];
    else if (m === 'quadraticCurveTo') { out.push({ k: 'Q', from: cur, cp: [a[0], a[1]], to: [a[2], a[3]] }); cur = [a[2], a[3]]; }
    else if (m === 'lineTo') { out.push({ k: 'L', from: cur, to: [a[0], a[1]] }); cur = [a[0], a[1]]; }
    else if (m === 'arc') out.push({ k: 'dot', at: [a[0], a[1]], r: a[2] });
  }
  return out;
}

function randomPts(rng, n) {
  const pts = [];
  let x = Math.floor(rng() * 1001);
  let y = Math.floor(rng() * 1001);
  for (let i = 0; i < n; i++) {
    x = clampCoord(x + (rng() - 0.5) * 60);
    y = clampCoord(y + (rng() - 0.5) * 60);
    if (!pts.length || pts[pts.length - 1][0] !== x || pts[pts.length - 1][1] !== y) pts.push([x, y]);
  }
  return pts;
}

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// ---------- coordinates ----------
test('canvas: toLogical maps the rect onto 0–1000 and clamps', () => {
  const rect = { left: 10, top: 20, width: 200, height: 200 };
  assert.deepEqual(toLogical(10, 20, rect), [0, 0]);
  assert.deepEqual(toLogical(210, 220, rect), [1000, 1000]);
  assert.deepEqual(toLogical(110, 120, rect), [500, 500]);
  assert.deepEqual(toLogical(-500, 9999, rect), [0, 1000], 'outside the canvas clamps (finger slid off)');
  assert.deepEqual(toLogical(10 + 33.3 * 0.2, 20, rect), [33, 0], 'rounds to integers');
  assert.equal(toLogical(5, 5, { left: 0, top: 0, width: 0, height: 0 }), null);
  assert.equal(toLogical(NaN, 5, rect), null);
  assert.equal(toLogical(5, 5, null), null);
  // a non-square rect still maps each axis to the full 0–1000 range
  assert.deepEqual(toLogical(100, 50, { left: 0, top: 0, width: 100, height: 50 }), [1000, 1000]);
});

test('canvas: strokeLength is the path length in logical units', () => {
  assert.equal(strokeLength([]), 0);
  assert.equal(strokeLength([[5, 5]]), 0);
  assert.equal(strokeLength([[0, 0], [3, 4]]), 5);
  assert.equal(strokeLength([[0, 0], [3, 4], [3, 14]]), 15);
  // a closed unit square has length 4 even though start == end
  assert.equal(strokeLength([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), 4);
});

// ---------- smoothing ----------
test('canvas: smoothing follows the quadratic-midpoint rule', () => {
  const pts = [[0, 0], [100, 0], [100, 100], [200, 100], [250, 180]];
  const { g, calls } = recorder();
  const st = pathState();
  advancePath(g, st, pts, pts.length, 9);
  finishPath(g, st);
  const segs = segments(calls);
  assert.deepEqual(segs[0], { k: 'dot', at: [0, 0], r: 4.5 }, 'the pen-down dot');
  const q = segs.filter((s) => s.k === 'Q');
  assert.equal(q.length, pts.length - 1);
  q.forEach((s, i) => {
    const k = i + 1;
    assert.deepEqual(s.from, k === 1 ? pts[0] : mid(pts[k - 2], pts[k - 1]), `segment ${k} starts where the last ended`);
    assert.deepEqual(s.cp, pts[k - 1], `segment ${k} is bent by the previous raw point`);
    assert.deepEqual(s.to, mid(pts[k - 1], pts[k]), `segment ${k} ends at a midpoint`);
  });
  const closing = segs[segs.length - 1];
  assert.deepEqual(closing, { k: 'L', from: mid(pts[3], pts[4]), to: pts[4] }, 'pen-up closes the half segment');
});

test('canvas: drawing in any chunking gives exactly the same curve (incremental == full)', () => {
  const rng = mulberry32(11);
  for (let trial = 0; trial < 300; trial++) {
    const pts = randomPts(rng, 1 + Math.floor(rng() * 80));
    const one = recorder();
    const st1 = pathState();
    advancePath(one.g, st1, pts, pts.length, 9);
    finishPath(one.g, st1);

    const chunked = recorder();
    const st2 = pathState();
    let drawn = 0;
    while (drawn < pts.length) {
      drawn = Math.min(pts.length, drawn + 1 + Math.floor(rng() * 7));
      advancePath(chunked.g, st2, pts, drawn, 9);
    }
    finishPath(chunked.g, st2);

    assert.deepEqual(segments(chunked.calls), segments(one.calls), `trial ${trial} (${pts.length} pts)`);
    assert.equal(st2.n, pts.length);
  }
});

test('canvas: a lone point is a dot, two points are a line, nothing is drawn twice', () => {
  const dot = recorder();
  const st = pathState();
  advancePath(dot.g, st, [[500, 500]], 1, 20);
  finishPath(dot.g, st);
  assert.deepEqual(segments(dot.calls), [{ k: 'dot', at: [500, 500], r: 10 }]);
  assert.ok(dot.calls.some((c) => c[0] === 'fill'));

  const two = recorder();
  const st2 = pathState();
  const pts = [[0, 0], [40, 0]];
  assert.equal(advancePath(two.g, st2, pts, 99, 4), 2, 'upTo beyond the end is clamped; returns points consumed');
  assert.equal(advancePath(two.g, st2, pts, 99, 4), 0, 'a second call has nothing new to draw');
  finishPath(two.g, st2);
  const segs = segments(two.calls);
  assert.deepEqual(segs.map((s) => s.k), ['dot', 'Q', 'L']);
  assert.deepEqual(segs[2], { k: 'L', from: [20, 0], to: [40, 0] });
});

test('canvas: pen-down dot and path are painted before any pen-up', () => {
  // A stroke that is still growing (end:false) must already show its dot and curve.
  const r = recorder();
  const st = pathState();
  advancePath(r.g, st, [[10, 10], [60, 10], [60, 60]], 3, 9);
  assert.ok(r.calls.some((c) => c[0] === 'stroke'), 'curve stroked');
  assert.equal(st.n, 3);
});

// ---------- pacing ----------
test('canvas: paceCount drains small backlogs smoothly and big ones at once', () => {
  assert.equal(paceCount(0), 0);
  assert.equal(paceCount(1), 1);
  assert.equal(paceCount(6), 3);
  assert.equal(paceCount(60), 21);
  assert.equal(paceCount(61), 61, 'after a stall everything is drawn in one frame');
  assert.equal(paceCount(5000), 5000);
  let backlog = 6;
  let frames = 0;
  while (backlog > 0) { backlog -= paceCount(backlog); frames++; }
  assert.ok(frames >= 2 && frames <= 4, `a 50 ms batch (≈6 pts) drains over a few frames, took ${frames}`);
  for (let b = 1; b <= 60; b++) assert.ok(paceCount(b) >= 1 && paceCount(b) <= b);
});

// ---------- sizing ----------
test('canvas: backingSize is round(css × min(dpr, 3)) with an area cap', () => {
  assert.equal(backingSize(345, 3), 1035);
  assert.equal(backingSize(345, 2), 690);
  assert.equal(backingSize(345, 1), 345);
  assert.equal(backingSize(345, 5), 1035, 'dpr clamps at 3');
  assert.equal(backingSize(345, 0.5), 345, 'browser zoom-out never shrinks the bitmap below CSS size');
  assert.equal(backingSize(345.4, 3), 1036);
  assert.equal(backingSize(400, NaN), 400);
  assert.equal(backingSize(0, 3), 0);
  assert.equal(backingSize(-5, 3), 0);
  assert.equal(backingSize(NaN, 3), 0);
  assert.equal(backingSize(2000, 3), 2000, '6000² would be 36 MP: capped at 4 MP');
  assert.ok(backingSize(1500, 3) ** 2 <= 4_000_000);
});

test('canvas: edgeInset keeps 24 px from the screen edge (iOS back-swipe)', () => {
  assert.equal(edgeInset(16), 8, '#app padding is ~16 px, add the rest');
  assert.equal(edgeInset(24), 0);
  assert.equal(edgeInset(33), 0);
  assert.equal(edgeInset(0), 24);
  assert.equal(edgeInset(15.2), 9);
  assert.equal(edgeInset(NaN), 0);
});

// ---------- style ----------
test('canvas: safeColor only lets real colours through', () => {
  for (const ok of ['#fff', '#ffffff', '#FFAA0033', ' #123 ', 'rgb(1, 2, 3)', 'rgba(1,2,3,.5)', 'hsl(120, 50%, 50%)']) assert.ok(safeColor(ok), ok);
  for (const bad of ['red', 'url(http://x)', '#12', '#12345', 'javascript:alert(1)', '', null, undefined, 123, {}, 'rgb(1,2,3); x']) assert.equal(safeColor(bad), null, String(bad));
});

test('canvas: palette = 8 colours incl. black and white, 3 widths, wire-safe', () => {
  assert.equal(PALETTE.length, 8);
  assert.equal(new Set(PALETTE.map((c) => c.color)).size, 8);
  assert.ok(PALETTE.some((c) => c.id === 'black') && PALETTE.some((c) => c.id === 'white'));
  for (const c of PALETTE) {
    assert.ok(safeColor(c.color), c.id);
    assert.ok(c.color.length <= 24, 'normalizeInk drops colours longer than 24 chars');
    assert.ok(c.name.length >= 1);
  }
  assert.equal(WIDTHS.length, 3);
  assert.ok(WIDTHS[0] < WIDTHS[1] && WIDTHS[1] < WIDTHS[2]);
  assert.ok(WIDTHS[2] * ERASER_MULT <= 200, 'the widest eraser still fits the wire clamp (200)');
  assert.ok(safeColor(PAPER));
});

test('canvas: resolveStyle — own keys, then colorOf(pid), then the prop, eraser = paper', () => {
  const colorOf = (pid) => ({ p1: '#e4573d', p2: 'not a colour' }[pid]);
  assert.deepEqual(resolveStyle({ pid: 'p1', color: '#2e7de0', width: 9 }, { colorOf }), { color: '#2e7de0', width: 9, eraser: false });
  assert.equal(resolveStyle({ pid: 'p1' }, { colorOf, color: '#000' }).color, '#e4573d', 'colorOf beats the prop');
  assert.equal(resolveStyle({ pid: 'p2' }, { colorOf, color: '#123456' }).color, '#123456', 'unusable colorOf falls through');
  assert.equal(resolveStyle({ pid: 'p3' }, {}).color, '#17140e', 'then the default ink');
  assert.equal(resolveStyle({ pid: 'p1', color: 'red' }, { colorOf }).color, '#e4573d', 'an unsafe stroke colour is ignored');
  assert.deepEqual(resolveStyle({ eraser: true, width: 27, color: '#ff0000' }, {}), { color: PAPER, width: 27, eraser: true });
  assert.equal(resolveStyle({ eraser: true }, {}).width, 27, 'eraser without a width = 3 × medium');
  assert.equal(resolveStyle({}, { width: 20 }).width, 20);
  assert.equal(resolveStyle({ width: 9999 }, {}).width, 200);
  assert.equal(resolveStyle({ width: 0.2 }, {}).width, 1);
  assert.equal(resolveStyle({ pid: 'p1' }, { colorOf: () => { throw new Error('boom'); }, color: '#abc' }).color, '#abc', 'colorOf may throw');
});

test('canvas: stroke ids are unique per device, salted per instance and within the wire limit', () => {
  const a = makeStrokeIds('k3a');
  const b = makeStrokeIds('x9z');
  const seen = new Set();
  for (let i = 0; i < 1000; i++) { seen.add(a('p1')); seen.add(b('p1')); }
  assert.equal(seen.size, 2000, 'two Canvas instances of the same seat never collide (remount safety)');
  const long = a('seat-with-a-ridiculously-long-identifier-from-somewhere');
  assert.ok(long.length <= 40, long);
  assert.ok(normalizeInk('p1', { stroke: long, pts: [[1, 1]] }), 'accepted by the real normalizer');
  assert.match(a('p2'), /^p2-k3a\.\d+$/);
  assert.match(makeStrokeIds('')('p1'), /^p1-\d+$/);
});

// ---------- batching ----------
test('canvas: splitBatches — style on the first, end on the last, ≤ 400 points each', () => {
  const pts = Array.from({ length: 1000 }, (_, i) => [i % 1001, (i * 7) % 1001]);
  const out = splitBatches({ stroke: 's1', pts, end: true, style: { color: '#fff', width: 9 } });
  assert.deepEqual(out.map((o) => o.pts.length), [400, 400, 200]);
  assert.deepEqual(out.map((o) => 'color' in o), [true, false, false]);
  assert.deepEqual(out.map((o) => !!o.end), [false, false, true]);
  assert.deepEqual(out.flatMap((o) => o.pts), pts);
  // no points: nothing to send unless the pen lifts
  assert.deepEqual(splitBatches({ stroke: 's', pts: [] }), []);
  assert.deepEqual(splitBatches({ stroke: 's', pts: [], end: true }), [{ stroke: 's', pts: [], end: true }]);
  // the payload owns copies, not the caller's arrays
  const src = [[1, 2]];
  const [one] = splitBatches({ stroke: 's', pts: src });
  one.pts[0][0] = 99;
  assert.equal(src[0][0], 1);
});

test('canvas: every payload round-trips through the real normalizeInk unchanged', () => {
  const rng = mulberry32(5);
  for (let t = 0; t < 40; t++) {
    const pts = randomPts(rng, 1 + Math.floor(rng() * 900));
    const style = rng() < 0.5 ? { color: PALETTE[t % 8].color, width: WIDTHS[t % 3] } : { width: WIDTHS[t % 3] * ERASER_MULT, eraser: true };
    for (const pl of splitBatches({ stroke: 'p1-a.1', pts, end: true, style })) {
      const b = normalizeInk('p1', pl);
      assert.ok(b, 'accepted');
      assert.deepEqual(b.pts, pl.pts, 'nothing rounded, clamped or truncated');
      assert.equal(b.end, !!pl.end);
      for (const k of ['color', 'width', 'eraser']) assert.equal(b[k], pl[k], k);
    }
  }
  // and the limit we split at is the limit the session truncates at
  const over = normalizeInk('p1', { stroke: 's', pts: Array.from({ length: MAX_PTS_PER_BATCH + 1 }, () => [1, 1]) });
  assert.equal(over.pts.length, MAX_PTS_PER_BATCH);
  assert.equal(MAX_PTS_PER_BATCH, 400);
});

test('canvas: the per-stroke cap matches what applyInkBatch will keep', () => {
  const ink = emptyInk();
  const ob = createOutbox({ stroke: 'big', style: { color: '#000', width: 9 } });
  for (let i = 0; i < MAX_PTS_PER_STROKE + 500; i++) ob.add([i % 1001, 500]);
  for (const pl of ob.take(0, { end: true })) applyInkBatch(ink, normalizeInk('p1', pl));
  assert.equal(ink.strokes[0].pts.length, MAX_PTS_PER_STROKE, 'Canvas ends a stroke at this size; the host would drop the rest');
});

test('canvas: outbox — first batch at once, then every ~50 ms, pen-up flushes', () => {
  const ob = createOutbox({ stroke: 's', style: { color: '#fff', width: 9 } });
  assert.deepEqual(ob.take(0), [], 'nothing to send yet');
  ob.add([10, 10]);
  const first = ob.take(0, { force: true });
  assert.equal(first.length, 1);
  assert.deepEqual(first[0], { stroke: 's', pts: [[10, 10]], color: '#fff', width: 9 });
  assert.equal(ob.sent, true);

  ob.add([11, 11]); ob.add([12, 12]); ob.add([13, 13]);
  assert.deepEqual(ob.take(BATCH_MS - 1), [], 'not due before 50 ms');
  const second = ob.take(BATCH_MS);
  assert.equal(second.length, 1);
  assert.deepEqual(second[0], { stroke: 's', pts: [[11, 11], [12, 12], [13, 13]] }, 'style only on the first batch');
  assert.equal(ob.pending(), 0);

  ob.add([14, 14]);
  const last = ob.take(BATCH_MS + 1, { end: true });
  assert.deepEqual(last, [{ stroke: 's', pts: [[14, 14]], end: true }], 'pen-up is immediate and carries end');
  // a pen-up with nothing buffered still closes the stroke on the other phones
  const ob2 = createOutbox({ stroke: 't', style: { width: 9 } });
  ob2.add([1, 1]);
  ob2.take(0, { force: true });
  assert.deepEqual(ob2.take(1, { end: true }), [{ stroke: 't', pts: [], end: true }]);
  assert.ok(normalizeInk('p1', { stroke: 't', pts: [], end: true }), 'normalizeInk accepts a bare end');
});

test('canvas: outbox flushes early when 400 points are waiting', () => {
  const ob = createOutbox({ stroke: 's', style: { width: 9 } });
  ob.add([0, 0]);
  ob.take(0, { force: true });
  for (let i = 0; i < 399; i++) ob.add([i, 1]);
  assert.deepEqual(ob.take(1), [], '399 waiting and < 50 ms: keep batching');
  ob.add([500, 2]);
  const out = ob.take(2);
  assert.equal(out.length, 1);
  assert.equal(out[0].pts.length, 400);
});

test('canvas: outbox holds an accidental tap back (minStrokeLen) so nobody ever sees it', () => {
  // a tap that never gets long enough: nothing is sent, so there is nothing to undo
  const tap = createOutbox({ stroke: 's', style: { color: '#000', width: 9 }, holdUntil: 40 });
  tap.add([100, 100]);
  assert.deepEqual(tap.take(0, { force: true }), []);
  tap.add([110, 100]);
  assert.deepEqual(tap.take(60), []);
  assert.equal(tap.held(), true);
  assert.deepEqual(tap.take(61, { end: true, force: true }), [], 'lifted too early: leaves no trace');
  assert.equal(tap.sent, false);
  assert.equal(tap.pending(), 0);

  // a real stroke: everything buffered goes out together the moment it is long enough
  const real = createOutbox({ stroke: 's', style: { color: '#000', width: 9 }, holdUntil: 40 });
  real.add([100, 100]);
  assert.deepEqual(real.take(0, { force: true }), []);
  real.add([120, 100]);
  assert.deepEqual(real.take(10), []);
  real.add([150, 100]);                                  // length 50 ≥ 40
  const out = real.take(11);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].pts, [[100, 100], [120, 100], [150, 100]]);
  assert.equal(out[0].color, '#000', 'style travels with the first batch that is actually sent');
  assert.equal(real.sent, true);
  assert.equal(real.held(), false);

  // exactly minStrokeLen counts as long enough (the Canvas rejects only length < min)
  const edge = createOutbox({ stroke: 's', style: {}, holdUntil: 30 });
  edge.add([0, 0]); edge.add([30, 0]);
  assert.equal(edge.held(), false);
});

test('canvas: batches reproduce the stroke exactly through the real applyInkBatch', () => {
  const rng = mulberry32(21);
  for (let t = 0; t < 120; t++) {
    const ink = emptyInk();
    const ob = createOutbox({ stroke: `p1-a.${t}`, style: { color: PALETTE[t % 8].color, width: WIDTHS[t % 3] } });
    const pts = randomPts(rng, 1 + Math.floor(rng() * 700));
    let now = 0;
    ob.add(pts[0]);
    for (const pl of ob.take(now, { force: true })) applyInkBatch(ink, normalizeInk('p1', pl));
    for (let i = 1; i < pts.length; i++) {
      ob.add(pts[i]);
      now += Math.floor(rng() * 30);
      for (const pl of ob.take(now)) applyInkBatch(ink, normalizeInk('p1', pl));
    }
    for (const pl of ob.take(now + 1, { end: true, force: true })) applyInkBatch(ink, normalizeInk('p1', pl));
    assert.equal(ink.strokes.length, 1);
    const s = ink.strokes[0];
    assert.deepEqual(s.pts, pts, `trial ${t}`);
    assert.equal(s.end, true);
    assert.equal(s.color, PALETTE[t % 8].color);
    assert.equal(s.width, WIDTHS[t % 3]);
    assert.ok(Math.abs(strokeLength(s.pts) - ob.length) < 1e-6, 'outbox length tracks strokeLength');
  }
});

test('canvas: undo/short-stroke semantics on the wire — a never-sent tap must not eat the previous stroke', () => {
  const ink = emptyInk();
  const send = (pl) => applyInkBatch(ink, normalizeInk('p1', pl));
  // lap 1: a real stroke
  const a = createOutbox({ stroke: 'p1-a.1', style: { color: '#000', width: 9 }, holdUntil: 40 });
  [[0, 0], [100, 0], [200, 0]].forEach((p) => a.add(p));
  a.take(0, { force: true }).forEach(send);
  a.take(1, { end: true, force: true }).forEach(send);
  assert.equal(ink.strokes.length, 1);
  // lap 2: an accidental tap, held back → no payload, so the Canvas sends NO undo
  const tap = createOutbox({ stroke: 'p1-a.2', style: { color: '#000', width: 9 }, holdUntil: 40 });
  tap.add([5, 5]);
  tap.take(0, { force: true }).forEach(send);
  tap.take(1, { end: true, force: true }).forEach(send);
  assert.equal(tap.sent, false);
  assert.equal(ink.strokes.length, 1, 'lap-1 stroke untouched');
  // had the tap been sent (hold off), the undo that follows removes exactly that stroke
  const sentTap = createOutbox({ stroke: 'p1-a.3', style: { width: 9 } });
  sentTap.add([5, 5]);
  sentTap.take(0, { force: true }).forEach(send);
  sentTap.take(1, { end: true, force: true }).forEach(send);
  assert.equal(ink.strokes.length, 2);
  assert.equal(sentTap.sent, true);
  send({ op: 'undo' });
  assert.deepEqual(ink.strokes.map((s) => s.id), ['p1-a.1']);
  send({ op: 'clear' });
  assert.equal(ink.strokes.length, 0);
});

// ---------- reconciling with what is painted ----------
test('canvas: syncPlan paints appends incrementally and repaints on anything else', () => {
  const s = (id, n, end = false) => ({ id, pts: Array.from({ length: n }, () => [1, 1]), end });
  const p = (id, n, finished = false) => ({ id, n, finished });
  assert.equal(syncPlan([], []), 'inc');
  assert.equal(syncPlan([], [s('a', 3)]), 'inc', 'first strokes');
  assert.equal(syncPlan([p('a', 3)], [s('a', 3)]), 'inc', 'same props twice: nothing to do');
  assert.equal(syncPlan([p('a', 3)], [s('a', 9, true), s('b', 2)]), 'inc', 'a stroke grew and a new one began');
  assert.equal(syncPlan([p('a', 3), p('b', 2)], [s('a', 3)]), 'full', 'undo (stroke removed)');
  assert.equal(syncPlan([p('a', 3)], []), 'full', 'clear');
  assert.equal(syncPlan([p('a', 3), p('b', 2)], [s('b', 2), s('a', 3)]), 'full', 'reordered');
  assert.equal(syncPlan([p('a', 3), p('b', 2)], [s('a', 3), s('c', 2)]), 'full', 'a stroke replaced');
  assert.equal(syncPlan([p('a', 5)], [s('a', 3)]), 'full', 'a stroke lost points (inkSync)');
  assert.equal(syncPlan([p('a', 5, true)], [s('a', 5, false)]), 'full', 'an ended stroke is open again');
});

// ---------- end to end: two "phones" through the real wire code ----------
test('canvas: loopback — a stroke drawn on A arrives on B point for point, undo and clear follow', () => {
  const rng = mulberry32(77);
  for (let round = 0; round < 40; round++) {
    const host = emptyInk();
    const a = emptyInk();              // phone A (the drawer): applies its own batches at once
    const b = emptyInk();              // phone B: only what the host relays
    const flow = (pid, payload) => {
      const batch = normalizeInk(pid, payload);          // what client.js ink() does
      applyInkBatch(a, batch);
      const accepted = normalizeInk(pid, batch);         // the host normalises again (Session.ink)
      applyInkBatch(host, accepted);
      applyInkBatch(b, { t: 'ink', ...accepted });       // Room.#relayInk → client 'ink' handler
    };
    const strokes = [];
    for (let k = 0; k < 1 + Math.floor(rng() * 5); k++) {
      const pts = randomPts(rng, 2 + Math.floor(rng() * 300));
      strokes.push(pts);
      const ob = createOutbox({ stroke: `p1-z.${round}.${k}`, style: { color: PALETTE[k % 8].color, width: WIDTHS[k % 3] } });
      let now = 0;
      ob.add(pts[0]);
      ob.take(now, { force: true }).forEach((pl) => flow('p1', pl));
      for (let i = 1; i < pts.length; i++) {
        ob.add(pts[i]);
        now += 1 + Math.floor(rng() * 20);
        ob.take(now).forEach((pl) => flow('p1', pl));
      }
      ob.take(now + 1, { end: true, force: true }).forEach((pl) => flow('p1', pl));
    }
    assert.deepEqual(b.strokes, a.strokes, 'B shows what A drew');
    assert.deepEqual(host.strokes, a.strokes);
    assert.deepEqual(b.strokes.map((s) => s.pts), strokes);
    assert.ok(b.strokes.every((s) => s.end === true));
    flow('p1', { op: 'undo' });
    assert.equal(b.strokes.length, strokes.length - 1);
    assert.deepEqual(b.strokes, a.strokes);
    flow('p1', { op: 'clear' });
    assert.equal(b.strokes.length, 0);
    assert.equal(a.strokes.length, 0);
  }
});

test('canvas: a stroke still being drawn is visible on B before pen-up (end:false)', () => {
  const b = emptyInk();
  const ob = createOutbox({ stroke: 's', style: { color: '#e4573d', width: 9 } });
  ob.add([10, 10]);
  ob.take(0, { force: true }).forEach((pl) => applyInkBatch(b, normalizeInk('p1', pl)));
  for (let i = 1; i <= 5; i++) ob.add([10 + i * 10, 10]);
  ob.take(60).forEach((pl) => applyInkBatch(b, normalizeInk('p1', pl)));
  assert.equal(b.strokes[0].pts.length, 6);
  assert.equal(b.strokes[0].end, false, 'viewers render progressively until end arrives');
});

test('canvas: ink.js is DOM-free (it must run under Node)', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(SIZE, 1000);
});
