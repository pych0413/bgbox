// ============================================================
// Canvas — the shared drawing board (你畫我猜 / 假畫家). DESIGN §15.7 + §15.10.
//
//   Canvas({ ink, canDraw, tools, color, width, oneStroke, minStrokeLen,
//            colorOf(pid), onInk(payload), onStrokeEnd({ strokeId, length }), onShort() })
//     → { el, update(props), destroy() }
//
//   ink           ctx.ink = { epoch, strokes: [{ id, pid, pts, end, color?, width?, eraser? }] }
//   canDraw       this seat may ink now (engine.canInk). Viewers get no pointer handling at all
//                 and the page keeps scrolling over the canvas.
//   tools         'none' = one colour, no toolbar · 'full' = 8 colours, 3 widths, eraser, undo, clear
//   color, width  'none': the pen. 'full': picks that pen when the prop changes.
//   oneStroke     after ONE accepted stroke input stops until the props change (see "re-arming")
//   minStrokeLen  0–1000 units; a finished stroke shorter than this is discarded, onShort() fires
//   colorOf(pid)  colour for strokes that carry none (fake artist: one fixed colour per seat)
//   onInk         wire payloads for api.ink(): { stroke, pts, end?, color?, width?, eraser? } | { op }
//   onStrokeEnd   an accepted stroke ended; `length` is its path length in 0–1000 units
//
// Extra optional props (additive, safe to omit):
//   me            the pid drawing on this device — used in stroke ids and for colorOf(me)
//   rearm         any JSON value; changing it lets a locked oneStroke canvas accept another stroke
//   touchGuard    default true: non-passive touchstart/touchmove preventDefault on the canvas (§4.2)
//
// Re-arming a oneStroke canvas: the lock lifts when canDraw, oneStroke, color, rearm or the ink
// epoch changes — i.e. when the engine says it is somebody's (or my next) turn. Updating with the
// very same props never lifts it, and a too-short stroke never engages it (retry is free).
//
// How it stays correct:
//  - Resolution independent. Everything is 0–1000 on a square; the backing store is
//    round(cssSize × min(dpr, 3)) and only reallocated when that pixel size changes (never mid-stroke).
//  - The picture is rebuilt from the stroke list. The bitmap is a cache: it is repainted after a
//    resize, an epoch change, undo/clear (a stroke disappearing), a hidden→visible switch, bfcache.
//  - Painting is incremental and driven by requestAnimationFrame: per stroke we remember how many
//    points are on the bitmap, so an in-place-mutated ink (the app does that) costs only the new
//    points. Remote strokes grow with a small pace so 50 ms batches look like a moving pen.
//  - My own stroke is painted from my own points the moment they arrive (no network in the loop)
//    and reconciled with `ink` when the echo comes: seen then missing = removed elsewhere (undo,
//    clear, rejected); never seen for GRACE_MS = rejected by the host. With no `ink` prop at all
//    the canvas works stand-alone (own strokes stay, undo/clear are local).
// ============================================================

import { el, restartAnim, sig, toast } from '../dom.js?v=20261003171423';
import { sfx } from '../../core/sfx.js?v=20261003171423';
import {
  PALETTE, WIDTHS, ERASER_MULT, PAPER, DEFAULT_COLOR, DEFAULT_WIDTH, BATCH_MS,
  MAX_PTS_PER_STROKE, MAX_PTS_TOTAL, MAX_STROKES,
  toLogical, strokeLength, backingSize, edgeInset, safeColor, resolveStyle, makeStrokeIds,
  pathState, advancePath, finishPath, paceCount, createOutbox, syncPlan,
} from '../ink.js?v=20261003171423';

export { PALETTE, WIDTHS, PAPER };

const GRACE_MS = 3000;          // own stroke not echoed back by then = the host refused it
const RESIZE_DEBOUNCE_MS = 100;
const CONFIRM_MS = 3000;        // 清除 asks twice; the question lapses after this
const EDGE_MIN_PX = 24;         // iOS back-swipe lives in the left edge

const normalize = (props = {}) => {
  const minStrokeLen = Number(props.minStrokeLen);
  return {
    canDraw: false, oneStroke: false, touchGuard: true,
    ...props,
    tools: props.tools === 'full' ? 'full' : 'none',
    minStrokeLen: Number.isFinite(minStrokeLen) ? Math.max(0, Math.min(1000, minStrokeLen)) : 0,
  };
};

export function Canvas(props = {}) {
  let p = normalize({});          // real props arrive through the update() at the bottom
  const newId = makeStrokeIds(Math.random().toString(36).slice(2, 5));

  // ---------- DOM ----------
  const surface = el('canvas', { class: 'c-canvas-surface' });
  const paper = el('div', { class: 'c-canvas-paper', role: 'img', 'aria-label': '畫板' }, surface);
  const toolbar = buildToolbar();
  const col = el('div', { class: 'c-canvas-col' }, paper, toolbar.el);
  const stage = el('div', { class: 'c-canvas-stage' }, col);
  const root = el('div', { class: 'c-canvas' }, stage);

  let ctx = null;
  try { ctx = surface.getContext('2d', { alpha: false }); } catch { ctx = null; }   // WebKit ignores alpha:false; we fill the paper anyway

  // ---------- state ----------
  let destroyed = false;
  let ready = false;              // backing store allocated and transform set
  let needFull = true;            // repaint everything on the next frame
  let epoch = null;
  let locked = false;             // oneStroke consumed
  let armKey = null;
  let model = [];                 // strokes to show, in order (ink strokes, my own swapped in)
  let painted = [];               // [{ id, n, finished, paced, st, color, width }] what is on the bitmap
  const ownList = [];             // my strokes (data), oldest first
  const ownById = new Map();
  const shortIds = new Set();     // my strokes discarded for being too short: never shown again
  let active = null;              // { pointerId, rec, out, rect, base, timer }
  let raf = 0;
  let settleTimer = 0;
  let wantW = 0;                  // latest CSS width from the ResizeObserver
  let resizeTimer = 0;
  let confirmTimer = 0;
  let guards = false;
  const tool = { color: PALETTE[0].color, width: WIDTHS[1], eraser: false };

  // ---------- helpers ----------
  const canDrawNow = () => !destroyed && p.canDraw && !locked;

  function emit(payload) {
    try { p.onInk?.(payload); } catch (err) { console.error('[Canvas] onInk threw', err); }
  }

  function currentStyle() {
    if (p.tools === 'full') {
      return tool.eraser
        ? { color: PAPER, width: tool.width * ERASER_MULT, eraser: true }
        : { color: tool.color, width: tool.width, eraser: false };
    }
    let viaPid = null;
    if (typeof p.colorOf === 'function' && p.me != null) { try { viaPid = safeColor(p.colorOf(p.me)); } catch { viaPid = null; } }
    return {
      color: safeColor(p.color) ?? viaPid ?? DEFAULT_COLOR,
      width: Number.isFinite(p.width) ? Math.max(1, Math.min(200, Math.round(p.width))) : DEFAULT_WIDTH,
      eraser: false,
    };
  }

  const wireStyle = (s) => (s.eraser ? { width: s.width, eraser: true } : { color: s.color, width: s.width });

  // ---------- model: ink strokes with my own swapped in ----------
  function buildModel() {
    const inkGiven = p.ink != null;
    const strokes = inkGiven && Array.isArray(p.ink.strokes) ? p.ink.strokes : [];
    const list = [];
    const inInk = new Set();
    for (const s of strokes) {
      if (!s || !Array.isArray(s.pts) || (typeof s.id !== 'string' && typeof s.id !== 'number')) continue;
      if (shortIds.has(s.id)) continue;
      const o = ownById.get(s.id);
      if (o) { o.seen = true; o.pid = s.pid; inInk.add(s.id); list.push(o); }   // my copy is always the longer one
      else list.push(s);
    }
    const now = performance.now();
    let pendingUntil = Infinity;
    for (let i = 0; i < ownList.length; i++) {
      const o = ownList[i];
      if (inInk.has(o.id)) continue;
      const live = o === active?.rec;
      const waiting = !o.seen && o.since != null && now - o.since < GRACE_MS;
      if (!inkGiven || live || waiting) {
        list.push(o);
        if (waiting) pendingUntil = Math.min(pendingUntil, o.since + GRACE_MS);
      } else {
        ownById.delete(o.id);
        ownList.splice(i--, 1);
      }
    }
    clearTimeout(settleTimer);
    settleTimer = 0;
    if (pendingUntil !== Infinity) {
      settleTimer = setTimeout(() => { settleTimer = 0; syncInk(); schedulePaint(); }, Math.max(50, pendingUntil - now + 30));
    }
    return list;
  }

  function resetPicture() {
    abortActive();
    ownList.length = 0;
    ownById.clear();
    shortIds.clear();
    painted = [];
    needFull = true;
    locked = false;
  }

  function syncInk() {
    const ep = p.ink?.epoch ?? 0;
    if (ep !== epoch) { epoch = ep; resetPicture(); }
    model = buildModel();
  }

  // ---------- painting ----------
  function paintPaper() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, surface.width, surface.height);
    ctx.restore();
  }

  function newRecord(s, full) {
    const style = resolveStyle(s, { colorOf: p.colorOf, color: p.color, width: p.width });
    const st = pathState();
    // `n` (points on the bitmap) is the path state's own counter, so it can never drift from what was drawn
    return { id: s.id, get n() { return st.n; }, finished: false, paced: !full && !s.own && !s.end, st, color: style.color, width: style.width };
  }

  function paint() {
    raf = 0;
    if (destroyed || !ctx) return;
    if (!ready) { measure(); if (!ready) return; }
    let full = needFull;
    if (!full && syncPlan(painted, model) === 'full') full = true;
    if (full) {
      paintPaper();
      painted = [];
      needFull = false;
    }
    for (let i = painted.length; i < model.length; i++) painted.push(newRecord(model[i], full));
    let more = false;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < painted.length; i++) {
      const rec = painted[i];
      const s = model[i];
      const total = s.pts.length;
      if (rec.n < total) {
        const upTo = rec.paced ? rec.n + paceCount(total - rec.n) : total;
        ctx.strokeStyle = ctx.fillStyle = rec.color;
        ctx.lineWidth = rec.width;
        advancePath(ctx, rec.st, s.pts, upTo, rec.width);
        if (rec.n < total) more = true;
      }
      if (!rec.finished && s.end && rec.n >= total) {
        ctx.strokeStyle = ctx.fillStyle = rec.color;
        ctx.lineWidth = rec.width;
        finishPath(ctx, rec.st);
        rec.finished = true;
      }
    }
    if (more) schedulePaint();
  }

  function schedulePaint() {
    if (raf || destroyed) return;
    raf = requestAnimationFrame(paint);
  }

  // ---------- backing store ----------
  function applySize(cssW) {
    const px = backingSize(cssW, window.devicePixelRatio);
    if (!px || !ctx) return false;
    if (surface.width !== px || surface.height !== px) { surface.width = px; surface.height = px; needFull = true; }
    ctx.setTransform(px / 1000, 0, 0, px / 1000, 0, 0);
    if (!ready) { ready = true; needFull = true; }
    schedulePaint();
    return true;
  }

  function measure() {
    const w = surface.getBoundingClientRect().width;
    if (w > 0) applySize(w);
  }

  function updateEdge() {
    const extra = edgeInset(root.getBoundingClientRect().left, EDGE_MIN_PX);
    const v = `${extra}px`;
    if (stage.style.getPropertyValue('--c-edge') !== v) stage.style.setProperty('--c-edge', v);
  }

  function onResize(width) {
    if (typeof width === 'number') wantW = width;
    updateEdge();
    if (active) active.rect = surface.getBoundingClientRect();   // the CSS size changes at once (rotation); only the bitmap waits for the pen
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = 0;
      if (active) return;                       // never reallocate mid-stroke; endStroke re-runs this
      applySize(wantW || surface.getBoundingClientRect().width);
    }, ready ? RESIZE_DEBOUNCE_MS : 0);
  }

  // ---------- drawing input ----------
  function inkTotals(except) {
    let pts = 0;
    for (const s of model) if (s !== except) pts += s.pts.length;
    return pts;
  }

  function refuse(text) {
    restartAnim(paper, 'denied');
    sfx('deny');
    if (text) toast(text);
  }

  function onDown(e) {
    if (!canDrawNow() || !ready) return;        // viewers: do nothing, let the page scroll
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (active || !e.isPrimary) return;          // one finger draws; a second one is ignored
    if (model.length >= MAX_STROKES - 5 || inkTotals(null) >= MAX_PTS_TOTAL - 20) { refuse('畫得太密喇，清一清先'); return; }
    document.activeElement?.blur?.();
    try { surface.setPointerCapture(e.pointerId); } catch { /* implicit touch capture still holds */ }
    beginStroke(e);
  }

  function beginStroke(e) {
    const style = currentStyle();
    const rec = {
      id: newId(p.me), pid: p.me ?? null, pts: [], end: false, own: true, seen: false, since: null,
      color: style.color, width: style.width, eraser: style.eraser,
    };
    ownList.push(rec);
    ownById.set(rec.id, rec);
    active = {
      pointerId: e.pointerId, rec, timer: 0,
      minLen: p.minStrokeLen,                   // fixed for this stroke: the outbox holds back by the same number
      out: createOutbox({ stroke: rec.id, style: wireStyle(style), holdUntil: p.minStrokeLen }),
      rect: surface.getBoundingClientRect(),     // one layout read per stroke
      base: 0,
    };
    active.base = inkTotals(rec);
    addSample(e);
    model = buildModel();
    flush(true);
    schedulePaint();
  }

  function addSample(ev) {
    const pt = toLogical(ev.clientX, ev.clientY, active.rect);
    if (!pt) return false;
    const pts = active.rec.pts;
    const last = pts[pts.length - 1];
    if (last && last[0] === pt[0] && last[1] === pt[1]) return false;   // stationary "moves" and duplicates
    pts.push(pt);
    active.out.add(pt);
    return true;
  }

  function onMove(e) {
    if (!active || e.pointerId !== active.pointerId) return;
    let list = null;
    try { list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null; } catch { list = null; }
    let added = false;
    for (const c of (list && list.length ? list : [e])) added = addSample(c) || added;
    if (!added) return;
    const n = active.rec.pts.length;
    if (n >= MAX_PTS_PER_STROKE - 1 || active.base + n >= MAX_PTS_TOTAL - 5) { endStroke(); return; }   // the host would drop the rest
    flush(false);
    schedulePaint();
  }

  const onUp = (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    addSample(e);
    endStroke();
  };
  // pointercancel (an edge swipe, a system gesture, an alert) ends the stroke where it is.
  const onCancel = (e) => { if (active && e.pointerId === active.pointerId) endStroke(); };

  /** Send what is due; arm a timer so the tail of a pause still goes out within ~50 ms. */
  function flush(force) {
    const a = active;
    if (!a) return;
    const payloads = a.out.take(performance.now(), { force });
    for (const pl of payloads) emit(pl);
    if (payloads.length) { clearTimeout(a.timer); a.timer = 0; }
    if (a.out.pending() && !a.out.held() && !a.timer) {
      a.timer = setTimeout(() => { a.timer = 0; if (active === a) flush(true); }, BATCH_MS);
    }
  }

  function abortActive() {
    const a = active;
    if (!a) return;
    active = null;
    clearTimeout(a.timer);
    try { surface.releasePointerCapture(a.pointerId); } catch { /* already released */ }
  }

  function removeOwn(rec) {
    ownById.delete(rec.id);
    const i = ownList.indexOf(rec);
    if (i >= 0) ownList.splice(i, 1);
  }

  function endStroke() {
    const a = active;
    if (!a) return;
    active = null;
    clearTimeout(a.timer);
    try { surface.releasePointerCapture(a.pointerId); } catch { /* already released */ }
    const rec = a.rec;
    rec.end = true;
    rec.since = performance.now();
    const length = strokeLength(rec.pts);
    const short = a.minLen > 0 && length < a.minLen;

    for (const pl of a.out.take(performance.now(), { end: true, force: true })) emit(pl);

    if (short) {
      if (a.out.sent) emit({ op: 'undo' });      // only if anything left the device: undo would eat my PREVIOUS stroke otherwise
      shortIds.add(rec.id);
      removeOwn(rec);
      model = buildModel();
      needFull = true;
      schedulePaint();
      refuse();
      try { p.onShort?.(); } catch (err) { console.error('[Canvas] onShort threw', err); }
    } else {
      model = buildModel();
      schedulePaint();
      if (p.oneStroke) { locked = true; applyFlags(); }   // lock BEFORE the callback: it may update() us synchronously
      try { p.onStrokeEnd?.({ strokeId: rec.id, length: Math.round(length) }); } catch (err) { console.error('[Canvas] onStrokeEnd threw', err); }
    }
    if (wantW && ready) onResize();               // a resize that waited for the pen to lift
  }

  // ---------- toolbar (tools: 'full') ----------
  function buildToolbar() {
    const swatches = PALETTE.map((c) => el('button', {
      class: 'c-canvas-swatch', type: 'button', 'data-color': c.color, 'aria-label': c.name, style: { '--sw': c.color },
      onclick: () => { tool.color = c.color; tool.eraser = false; sfx('tap'); refreshTools(); },
    }));
    const widthBtns = WIDTHS.map((w, i) => el('button', {
      class: 'c-canvas-btn c-canvas-width', type: 'button', 'data-width': String(w), 'aria-label': ['幼', '中', '粗'][i],
      onclick: () => { tool.width = w; sfx('tap'); refreshTools(); },
    }, el('span', { class: 'c-canvas-wdot', style: { '--d': `${0.25 + i * 0.4}rem` } })));
    const eraserBtn = el('button', {
      class: 'c-canvas-btn', type: 'button', 'aria-label': '擦膠',
      onclick: () => { tool.eraser = !tool.eraser; sfx('tap'); refreshTools(); },
    }, el('span', { class: 'c-canvas-ico', text: '🧽' }), el('span', { class: 'c-canvas-cap', text: '擦' }));
    const undoBtn = el('button', {
      class: 'c-canvas-btn', type: 'button', 'aria-label': '還原',
      onclick: () => { sfx('tap'); emit({ op: 'undo' }); if (p.ink == null) { const last = ownList[ownList.length - 1]; if (last) { removeOwn(last); model = buildModel(); needFull = true; schedulePaint(); } } },
    }, el('span', { class: 'c-canvas-ico', text: '↩️' }), el('span', { class: 'c-canvas-cap', text: '還原' }));
    const clearCap = el('span', { class: 'c-canvas-cap', text: '清除' });
    const clearBtn = el('button', {
      class: 'c-canvas-btn c-canvas-clear', type: 'button', 'aria-label': '清除',
      onclick: () => {
        if (!clearBtn.classList.contains('confirm')) {            // first tap only asks
          clearBtn.classList.add('confirm');
          clearCap.textContent = '確定？';
          sfx('lock');
          clearTimeout(confirmTimer);
          confirmTimer = setTimeout(cancelConfirm, CONFIRM_MS);
          return;
        }
        cancelConfirm();
        sfx('flip');
        emit({ op: 'clear' });
        if (p.ink == null) { ownList.length = 0; ownById.clear(); model = buildModel(); needFull = true; schedulePaint(); }
      },
    }, el('span', { class: 'c-canvas-ico', text: '🗑️' }), clearCap);
    function cancelConfirm() {
      clearTimeout(confirmTimer);
      confirmTimer = 0;
      clearBtn.classList.remove('confirm');
      clearCap.textContent = '清除';
    }
    const node = el('div', { class: 'c-canvas-tools', role: 'toolbar', 'aria-label': '畫畫工具' },
      el('div', { class: 'c-canvas-colors' }, swatches),
      el('div', { class: 'c-canvas-row' }, widthBtns, eraserBtn, undoBtn, clearBtn));
    return { el: node, swatches, widthBtns, eraserBtn, cancelConfirm };
  }

  function refreshTools() {
    for (const b of toolbar.swatches) {
      const on = !tool.eraser && b.dataset.color === tool.color;
      b.setAttribute('aria-pressed', String(on));
    }
    for (const b of toolbar.widthBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.width) === tool.width));
    toolbar.eraserBtn.setAttribute('aria-pressed', String(tool.eraser));
    root.classList.toggle('erasing', p.tools === 'full' && tool.eraser);
  }

  // ---------- flags / touch guards ----------
  const stopTouch = (e) => { if (canDrawNow() && p.touchGuard) e.preventDefault(); };

  /** The §4.2 guard: non-passive, on the canvas only, and only while this seat may draw. */
  function setGuards(on) {
    if (on === guards) return;
    guards = on;
    const f = on ? 'addEventListener' : 'removeEventListener';
    surface[f]('touchstart', stopTouch, { passive: false });
    surface[f]('touchmove', stopTouch, { passive: false });
    paper[f]('gesturestart', stopTouch, { passive: false });
  }

  function applyFlags() {
    const can = canDrawNow();
    root.classList.toggle('can-draw', can);
    root.classList.toggle('is-locked', p.canDraw && locked);
    root.dataset.tools = p.tools;
    toolbar.el.hidden = !(p.tools === 'full' && p.canDraw);
    if (toolbar.el.hidden) toolbar.cancelConfirm();
    paper.setAttribute('aria-label', can ? '畫板，你而家可以畫' : '畫板');
    setGuards(can && p.touchGuard !== false);
    refreshTools();
  }

  function syncTools(prev) {
    if (p.color !== prev.color && safeColor(p.color)) { tool.color = p.color; tool.eraser = false; }
    if (p.width !== prev.width && Number.isFinite(p.width)) tool.width = Math.max(1, Math.min(200, Math.round(p.width)));
  }

  // ---------- page lifecycle ----------
  const onVisibility = () => {
    if (document.hidden) { if (active) endStroke(); }
    else { needFull = true; schedulePaint(); }    // the bitmap may have been purged while hidden
  };
  const onHide = () => { if (active) endStroke(); };
  const onShow = (e) => { if (e.persisted) { needFull = true; schedulePaint(); } };
  const onWinResize = () => onResize();

  // ---------- wiring ----------
  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onUp);
  surface.addEventListener('pointercancel', onCancel);
  surface.addEventListener('lostpointercapture', onCancel);
  surface.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('selectstart', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('blur', onHide);
  window.addEventListener('pageshow', onShow);
  window.addEventListener('resize', onWinResize);

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        if (en.target === surface) onResize(en.contentRect.width);
        else onResize();                          // root moved/resized: refresh the edge margin
      }
    });
    ro.observe(surface);
    ro.observe(root);
  }

  const api = {
    el: root,
    update(next = {}) {
      if (destroyed) return;
      const prev = p;
      p = normalize(next);
      const key = sig([p.canDraw, p.oneStroke, p.color ?? null, p.rearm ?? null, p.ink?.epoch ?? 0]);
      if (key !== armKey) { armKey = key; locked = false; }    // props changed: a oneStroke canvas may draw again
      syncTools(prev);
      syncInk();
      if (!p.canDraw && active) endStroke();                   // the turn was taken away mid-stroke
      applyFlags();
      schedulePaint();
    },
    destroy() {
      if (destroyed) return;
      if (active) endStroke();
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(settleTimer);
      clearTimeout(resizeTimer);
      clearTimeout(confirmTimer);
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('blur', onHide);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('resize', onWinResize);
      setGuards(false);
      surface.width = surface.height = 0;                      // hand the bitmap back (old iOS counted canvas memory)
      root.remove();
    },
  };

  api.update(props);
  return api;
}

export default Canvas;
