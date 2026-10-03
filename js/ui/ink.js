// ============================================================
// ink.js — pure drawing helpers behind the Canvas component (DESIGN §15.10).
//
// No DOM, no timers, no randomness: everything here runs under Node, so the
// maths (smoothing, batching, length, sizing) is unit-tested in
// tests/canvas.test.mjs. Canvas.js adds the pointer events, the <canvas> and
// the toolbar on top.
//
// Coordinates are integers 0–1000 on a SQUARE canvas: one logical unit is the
// same distance in x and y on every phone, so a circle stays a circle.
// ============================================================

export const SIZE = 1000;                 // logical canvas is SIZE x SIZE
export const PAPER = '#fffdf5';           // the sheet; the eraser paints this colour
export const DEFAULT_COLOR = '#17140e';
export const DEFAULT_WIDTH = 9;

/** The 8 pens of tools: 'full'. Black and white are included (white paints over black fills). */
export const PALETTE = Object.freeze([
  { id: 'black',  name: '黑', color: '#17140e' },
  { id: 'white',  name: '白', color: '#ffffff' },
  { id: 'red',    name: '紅', color: '#e4573d' },
  { id: 'orange', name: '橙', color: '#ff9f1c' },
  { id: 'yellow', name: '黃', color: '#f2c200' },
  { id: 'green',  name: '綠', color: '#2fa866' },
  { id: 'blue',   name: '藍', color: '#2e7de0' },
  { id: 'purple', name: '紫', color: '#9b59d0' },
]);

/** Logical widths for thin / medium / thick (1.4 / 3.1 / 6.9 CSS px on a 345 px canvas). */
export const WIDTHS = Object.freeze([4, 9, 20]);
export const ERASER_MULT = 3;

// Wire / session limits. They mirror js/core/session.js (checked by the tests, which push
// payloads through the real normalizeInk / applyInkBatch).
export const BATCH_MS = 50;
export const MAX_PTS_PER_BATCH = 400;
export const MAX_PTS_PER_STROKE = 6000;
export const MAX_PTS_TOTAL = 12000;
export const MAX_STROKES = 3000;

// Viewer pacing: a remote stroke grows by a fraction of its backlog per frame so 50 ms
// batches look like a moving pen, and a long backlog (after a stall) is flushed at once.
export const PACE = 0.34;
export const CATCHUP = 60;

const TAU = Math.PI * 2;

// ---------- coordinates ----------

/** Round and clamp one coordinate to the 0–1000 integer grid. NaN stays NaN (callers check). */
export function clampCoord(v) {
  return Math.max(0, Math.min(SIZE, Math.round(v)));
}

/** Pointer position → logical point, or null if the rect is empty / the numbers are not finite. */
export function toLogical(clientX, clientY, rect) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  const x = clampCoord((clientX - rect.left) * (SIZE / rect.width));
  const y = clampCoord((clientY - rect.top) * (SIZE / rect.height));
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/** Path length of a polyline of [x, y] points, in logical units. */
export function strokeLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

// ---------- sizing ----------

/**
 * Backing-store side in device pixels for a square CSS size. DPR is clamped to 3 and the
 * area to 4 MP (far below any iOS limit, but a runaway DPR must never allocate silly bitmaps).
 */
export function backingSize(cssPx, dpr, { maxScale = 3, maxArea = 4_000_000 } = {}) {
  if (!(cssPx > 0)) return 0;
  const scale = Math.min(Math.max(Number.isFinite(dpr) ? dpr : 1, 1), maxScale);
  let px = Math.max(1, Math.round(cssPx * scale));
  if (px * px > maxArea) px = Math.floor(Math.sqrt(maxArea));
  return px;
}

/** Extra padding (CSS px, each side) so the canvas keeps `min` px from the screen edge (iOS back-swipe). */
export function edgeInset(left, min = 24) {
  return Number.isFinite(left) ? Math.max(0, Math.ceil(min - left)) : 0;
}

// ---------- style ----------

/** Accept only hex / rgb() / hsl() — a bad string would silently keep the previous strokeStyle. */
export function safeColor(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  if (/^(?:rgb|hsl)a?\(\s*[-\d.%,\s/]+\)$/i.test(s)) return s;
  return null;
}

const clampWidth = (w) => Math.max(1, Math.min(200, Math.round(w)));

/**
 * How to paint a stroke: its own style keys win, then colorOf(pid), then the component's colour.
 * An eraser paints the paper colour at the width it was sent with.
 * @returns {{ color: string, width: number, eraser: boolean }}
 */
export function resolveStyle(stroke, { colorOf, color, width } = {}) {
  const eraser = stroke?.eraser === true;
  let w = Number.isFinite(stroke?.width) ? stroke.width : (Number.isFinite(width) ? width : (eraser ? DEFAULT_WIDTH * ERASER_MULT : DEFAULT_WIDTH));
  w = clampWidth(w);
  if (eraser) return { color: PAPER, width: w, eraser: true };
  let viaPid = null;
  if (typeof colorOf === 'function' && stroke?.pid != null) {
    try { viaPid = safeColor(colorOf(stroke.pid)); } catch { viaPid = null; }
  }
  return { color: safeColor(stroke?.color) ?? viaPid ?? safeColor(color) ?? DEFAULT_COLOR, width: w, eraser: false };
}

/** Stroke-id factory: `${prefix}-${salt}.${n}`, ≤ 40 chars, unique per device and per Canvas instance. */
export function makeStrokeIds(salt = '') {
  let n = 0;
  const tag = String(salt).replace(/[^0-9a-z]/gi, '').slice(0, 6);
  return (prefix = 'c') => {
    const head = String(prefix).replace(/\s+/g, '').slice(-20) || 'c';
    return `${head}-${tag}${tag ? '.' : ''}${++n}`;
  };
}

// ---------- smoothing (quadratic midpoints) ----------
//
// Every raw point is a quadratic CONTROL point and the midpoint between consecutive points
// is the curve END point, so the line is continuous in position and direction and needs no
// look-ahead — it can be drawn while the points are still arriving. The path state makes the
// drawing incremental: drawing points in any chunking produces exactly the same curve.

export function pathState() {
  return { n: 0, cx: 0, cy: 0, px: 0, py: 0 };   // n points consumed; (cx,cy) path end; (px,py) previous point
}

/**
 * Extend the smoothed path through pts[st.n .. upTo). Draws on `g` (a CanvasRenderingContext2D
 * or any recorder with the same methods) with the style the caller already set.
 * The very first point also paints a dot, which the round cap would paint anyway — so a pen that
 * is down and not yet moving is visible at once, and a lone tap needs no special case.
 * @returns {number} how many points were consumed
 */
export function advancePath(g, st, pts, upTo, width = DEFAULT_WIDTH) {
  const end = Math.min(upTo, pts.length);
  const from = st.n;
  let started = false;
  let drewAny = false;
  for (; st.n < end; st.n++) {
    const x = pts[st.n][0];
    const y = pts[st.n][1];
    if (st.n === 0) {
      st.cx = st.px = x;
      st.cy = st.py = y;
      g.beginPath();
      g.arc(x, y, width / 2, 0, TAU);
      g.fill();
      continue;
    }
    if (!started) { g.beginPath(); g.moveTo(st.cx, st.cy); started = true; }
    const mx = (st.px + x) / 2;
    const my = (st.py + y) / 2;
    g.quadraticCurveTo(st.px, st.py, mx, my);
    st.cx = mx; st.cy = my; st.px = x; st.py = y;
    drewAny = true;
  }
  if (drewAny) g.stroke();
  return st.n - from;
}

/** Pen up: close the half segment between the last midpoint and the last point. */
export function finishPath(g, st) {
  if (st.n < 2) return;                       // a lone point is already a dot
  g.beginPath();
  g.moveTo(st.cx, st.cy);
  g.lineTo(st.px, st.py);
  g.stroke();
}

/** How many points a paced (remote, still growing) stroke draws this frame. */
export function paceCount(backlog) {
  if (backlog <= 0) return 0;
  if (backlog > CATCHUP) return backlog;
  return Math.max(1, Math.ceil(backlog * PACE));
}

/**
 * Paint a whole picture at once — the keepsake PNG and anything else that is not live.
 * `g` must already map 0–1000 logical units onto its pixels (setTransform). Same smoothing and
 * styles as the live board, so the souvenir looks exactly like what the table saw.
 * @returns {number} strokes painted
 */
export function paintStrokes(g, strokes, { colorOf, paper = true } = {}) {
  if (paper) {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, SIZE, SIZE);
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  let n = 0;
  for (const s of Array.isArray(strokes) ? strokes : []) {
    if (!s || !Array.isArray(s.pts) || !s.pts.length) continue;
    const style = resolveStyle(s, { colorOf });
    g.strokeStyle = g.fillStyle = style.color;
    g.lineWidth = style.width;
    const st = pathState();
    advancePath(g, st, s.pts, s.pts.length, style.width);
    finishPath(g, st);
    n++;
  }
  return n;
}

// ---------- batching ----------

/**
 * Cut a run of points into wire payloads ({ stroke, pts, end?, ...style }) of ≤ maxPts points.
 * Style keys ride on the FIRST payload only (and only when `style` is given); `end` on the last.
 * No points and no end → nothing to send. normalizeInk accepts an empty batch only with `end`.
 */
export function splitBatches({ stroke, pts, end = false, style = null, maxPts = MAX_PTS_PER_BATCH }) {
  const out = [];
  if (!pts.length) {
    if (end) out.push({ stroke, pts: [], end: true, ...(style ?? {}) });
    return out;
  }
  for (let i = 0; i < pts.length; i += maxPts) {
    const payload = { stroke, pts: pts.slice(i, i + maxPts).map((p) => [p[0], p[1]]) };
    if (i === 0 && style) Object.assign(payload, style);
    if (end && i + maxPts >= pts.length) payload.end = true;
    out.push(payload);
  }
  return out;
}

/**
 * Collects the points of one stroke and decides WHEN to send them (pure: the caller passes `nowMs`).
 *
 *   add(pt)            append a point (already quantised and de-duplicated by the caller)
 *   take(now, opts)    → payload[]: [] while not due; { force } sends now, { end } closes the stroke
 *   sent / length / pending() / held()
 *
 * A batch is due when ≥ batchMs have passed since the last one, ≥ maxPts are waiting, or the caller
 * forces it. `holdUntil` (the Canvas minStrokeLen) keeps the first batch back until the stroke is
 * that long, so an accidental tap is never broadcast; if the pen lifts before that, nothing is
 * sent at all (`sent` stays false → no undo is needed).
 */
export function createOutbox({ stroke, style = {}, batchMs = BATCH_MS, maxPts = MAX_PTS_PER_BATCH, holdUntil = 0 }) {
  let buf = [];
  let last = null;
  let len = 0;
  let sent = false;
  let lastAt = -Infinity;
  const held = () => holdUntil > 0 && !sent && len < holdUntil;
  return {
    add(pt) {
      if (last) len += Math.hypot(pt[0] - last[0], pt[1] - last[1]);
      last = pt;
      buf.push(pt);
    },
    take(nowMs, { force = false, end = false } = {}) {
      if (!buf.length && !end) return [];
      if (held()) {
        if (end) buf = [];                       // lifted before it was long enough: leave no trace
        return [];
      }
      if (!end && !force && buf.length < maxPts && nowMs - lastAt < batchMs) return [];
      const out = splitBatches({ stroke, pts: buf, end, style: sent ? null : style, maxPts });
      buf = [];
      if (out.length) { sent = true; lastAt = nowMs; }
      return out;
    },
    pending: () => buf.length,
    held,
    get sent() { return sent; },
    get length() { return len; },
  };
}

// ---------- reconciling a model with what is already painted ----------

/**
 * Decide whether the canvas can just paint what is new ('inc') or must repaint everything ('full').
 * `painted` = [{ id, n, finished }] in paint order; `target` = [{ id, pts, end }] in model order.
 * Anything that is not a pure append — a stroke removed (undo/clear/rejected), reordered, or a stroke
 * that lost points or un-ended — needs a full repaint.
 */
export function syncPlan(painted, target) {
  if (target.length < painted.length) return 'full';
  for (let i = 0; i < painted.length; i++) {
    const d = painted[i];
    const t = target[i];
    if (d.id !== t.id || t.pts.length < d.n || (d.finished && !t.end)) return 'full';
  }
  return 'inc';
}
