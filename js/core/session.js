// ============================================================
// session.js — runs ONE engine on the host (DESIGN §4, §15.4).
//
// The engine is pure; the session is everything around it that has a clock or
// a callback: deadlines, narration cues, host-internal actions, auto-acting a
// stalled seat, pause/resume, the shared drawing, and snapshot/restore.
//
// Conventions worth knowing:
//  - State is cloned before every act/advance/autoAct call, so engines may
//    mutate what they get; returning undefined means "unchanged".
//  - ctx.now is a NUMBER (host ms at the moment of the call), not a function.
//  - `@auto` is handled here and never reaches the engine: the session asks
//    engine.autoAct (or legalActions[0]) and feeds the result back as that pid.
//  - While paused every dispatch is refused (returns false): "paused" freezes
//    the table, and refusing input is the only way a deadline set during the
//    pause could not be shifted twice.
//  - A restored session starts PAUSED, with the clock stopped at the moment it
//    was last saved, so the host taps 繼續 (which also satisfies iOS' gesture
//    rule for speech) and every timer carries on from where it was.
// ============================================================

import { ACT, HOST, clone } from './engine-kit.js?v=1';

const MAX_TIMEOUT = 2 ** 31 - 1;       // setTimeout overflows (fires at once) beyond this
const MAX_STROKES = 3000;
const MAX_PTS_PER_STROKE = 6000;
const MAX_PTS_TOTAL = 12000;          // keeps a full inkSync well under a DataChannel message (~256 KB)
const MAX_PTS_PER_BATCH = 400;
const STYLE_KEYS = ['color', 'width', 'eraser'];

const jsonClone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// ---------- shared drawing (also used by the client app) ----------

export function emptyInk(epoch = 0) { return { epoch, strokes: [] }; }

/**
 * Normalise an ink payload from the network. Returns a batch
 *   { pid, stroke, pts: [[x, y]...], end, color?, width?, eraser? }  |  { pid, op: 'undo' | 'clear' }
 * or null if it is not acceptable. Coordinates are rounded to 0–1000 integers.
 */
export function normalizeInk(pid, payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.op === 'undo' || payload.op === 'clear') return { pid, op: payload.op };
  const stroke = typeof payload.stroke === 'number' ? String(payload.stroke) : payload.stroke;
  if (typeof stroke !== 'string' || !stroke || stroke.length > 40) return null;
  const pts = [];
  for (const p of Array.isArray(payload.pts) ? payload.pts.slice(0, MAX_PTS_PER_BATCH) : []) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    pts.push([Math.max(0, Math.min(1000, Math.round(p[0]))), Math.max(0, Math.min(1000, Math.round(p[1])))]);
  }
  const end = !!payload.end;
  if (!pts.length && !end) return null;
  const batch = { pid, stroke, pts, end };
  if (typeof payload.color === 'string' && payload.color.length <= 24) batch.color = payload.color;
  if (Number.isFinite(payload.width)) batch.width = Math.max(1, Math.min(200, Math.round(payload.width)));
  if (typeof payload.eraser === 'boolean') batch.eraser = payload.eraser;
  return batch;
}

/** Merge a normalised batch into `ink` ({ epoch, strokes }) in place. Used by host and clients alike. */
export function applyInkBatch(ink, batch) {
  if (!batch) return ink;
  if (batch.op === 'clear') { ink.strokes = []; return ink; }
  if (batch.op === 'undo') {
    for (let i = ink.strokes.length - 1; i >= 0; i--) {
      if (ink.strokes[i].pid === batch.pid) { ink.strokes.splice(i, 1); break; }
    }
    return ink;
  }
  let s = null;
  for (let i = ink.strokes.length - 1; i >= 0 && i >= ink.strokes.length - 8; i--) {
    if (ink.strokes[i].id === batch.stroke && ink.strokes[i].pid === batch.pid) { s = ink.strokes[i]; break; }
  }
  if (!s) {
    if (ink.strokes.length >= MAX_STROKES) return ink;
    s = { id: batch.stroke, pid: batch.pid, pts: [], end: false };
    for (const k of STYLE_KEYS) if (batch[k] !== undefined) s[k] = batch[k];
    ink.strokes.push(s);
  }
  for (const p of batch.pts ?? []) if (s.pts.length < MAX_PTS_PER_STROKE) s.pts.push(p);
  if (batch.end) s.end = true;
  return ink;
}

// ---------- the session ----------

export class Session {
  /**
   * @param {object}   o
   * @param {object}   o.game       { meta, config, engine, ... } — the loaded game module
   * @param {object[]} o.players    [{ id, name, seat, color }] in seat order
   * @param {object}   o.config
   * @param {string|null} [o.hostPid] the host's own seat (G1) — moderator modes need to know who holds the host phone
   * @param {*}        [o.carry]    the previous game's result().carry for the same game (anti-streak), or undefined
   * @param {Function} o.rng        () => [0,1)
   * @param {object}   o.bag        content bag (draw/stats)
   * @param {Function} o.now        () => host ms
   * @param {Function} [o.onChange] () => void           state changed (views must be re-sent)
   * @param {Function} [o.onCue]    (cue, { replay }) => void   a new narration line began
   * @param {Function} [o.onInk]    (batch | null) => void       relay a stroke batch; null = full resync needed
   * @param {object}   [o.timers]   { setTimeout, clearTimeout } (injectable for tests)
   * @param {string}   [o.narrationMode] 'voice' | 'read' | 'silent'
   * @param {object}   [o.restore]  snapshot to restore from (use Session.restore)
   */
  constructor(o) {
    this.game = o.game;
    this.engine = o.game.engine;
    this.rng = o.rng;
    this.bag = o.bag;
    this.nowFn = o.now;
    this.onChange = o.onChange ?? (() => {});
    this.onCue = o.onCue ?? (() => {});
    this.onInk = o.onInk ?? (() => {});
    this.timers = o.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    };
    this.mode = o.narrationMode ?? 'voice';

    this.rev = 0;
    this.lastError = null;
    this.stopped = false;
    this.deadlineTimer = null;
    this.cueTimer = null;
    this.silent = null;            // { id, due } silent-mode auto-complete in flight
    this.silentRemaining = null;   // ms left when a pause interrupted it
    this.lastCueId = null;
    this.cueStartedAt = 0;

    const snap = o.restore;
    if (snap) {
      this.players = clone(snap.players);
      this.config = clone(snap.config);
      this.hostPid = snap.hostPid ?? null;
      this.state = clone(snap.state);
      this.rev = snap.rev ?? 0;
      this.drawing = snap.ink ? clone(snap.ink) : emptyInk(this.state.inkEpoch ?? 0);
      this.lastCueId = snap.lastCueId ?? null;
      this.cueStartedAt = snap.cueStartedAt ?? 0;
      this.paused = true;
      this.pausedAt = snap.paused ? (snap.pausedAt ?? snap.savedAt) : snap.savedAt;
      this.silentRemaining = snap.silentRemaining ?? null;
    } else {
      this.players = clone(o.players);
      this.config = clone(o.config);
      this.hostPid = o.hostPid != null && this.players.some((p) => p.id === o.hostPid) ? o.hostPid : null;
      this.paused = false;
      this.pausedAt = 0;
      const ctx = this.#ctx();
      const made = this.engine.setup({
        players: clone(this.players), config: clone(this.config), ...ctx, hostPid: this.hostPid,
        ...(o.carry !== undefined && o.carry !== null ? { carry: clone(o.carry) } : {}),
      });
      this.state = made === undefined ? null : made;
      if (!this.state) throw new Error('engine.setup returned nothing');
      this.drawing = emptyInk(this.state.inkEpoch ?? 0);
    }
  }

  static restore(snap, deps) { return new Session({ ...deps, restore: snap }); }

  /** Kick things off: schedules the deadline, announces the first cue, emits onChange. Not for restored sessions. */
  begin() {
    this.rev++;
    this.#after();
    return this;
  }

  // ---------- running the engine ----------

  #ctx() { return { rng: this.rng, now: this.nowFn(), bag: this.bag }; }

  /** Run an engine mutation on a clone; commit only if something changed. */
  #apply(fn) {
    if (this.stopped || this.paused) return false;
    const before = JSON.stringify(this.state);
    let next;
    try {
      next = fn(clone(this.state), this.#ctx());
    } catch (e) {
      this.lastError = e;
      console.error('[session] engine threw; action ignored', e);
      return false;
    }
    if (next === undefined || next === null) return false;
    if (JSON.stringify(next) === before) return false;
    this.state = next;
    this.rev++;
    this.#after();
    return true;
  }

  #after() {
    if ((this.state.inkEpoch ?? 0) !== this.drawing.epoch) {
      this.drawing = emptyInk(this.state.inkEpoch ?? 0);
      this.onInk(null);
    }
    this.#schedule();
    const fresh = this.#trackCue();
    this.onChange();
    if (fresh) this.onCue(fresh, { replay: false });
  }

  /**
   * A seat (or the host, via HOST) sends an action. Returns true if the state changed.
   * `{ type: '@auto', pid }` from the host is routed to autoAct().
   */
  dispatch(pid, action) {
    if (this.stopped || this.paused) return false;
    if (pid === HOST && action?.type === ACT.AUTO) return this.autoAct(action.pid);
    return this.#apply((st, ctx) => this.engine.act(st, { pid, action }, ctx));
  }

  cueDone(id) { return this.dispatch(HOST, { type: ACT.CUE_DONE, id }); }
  next() { return this.dispatch(HOST, { type: ACT.NEXT }); }

  /** Act on behalf of a stalled seat: engine.autoAct if it has one, else the first legal action. */
  autoAct(pid) {
    if (this.stopped || this.paused) return false;
    let action = null;
    try {
      action = this.engine.autoAct
        ? this.engine.autoAct(clone(this.state), pid, this.#ctx())
        : (this.engine.legalActions?.(this.state, pid) ?? [])[0];
    } catch (e) {
      this.lastError = e;
      console.error('[session] autoAct threw', e);
      return false;
    }
    if (action === undefined || action === null) return false;
    return this.dispatch(pid, action);
  }

  // ---------- deadline ----------

  #schedule() {
    if (this.deadlineTimer !== null) { this.timers.clearTimeout(this.deadlineTimer); this.deadlineTimer = null; }
    if (this.stopped || this.paused) return;
    const d = this.state?.deadline;
    if (typeof d !== 'number' || !Number.isFinite(d)) return;
    const delay = Math.min(MAX_TIMEOUT, Math.max(0, d - this.nowFn()));
    this.deadlineTimer = this.timers.setTimeout(() => this.#fire(), delay);
  }

  #fire() {
    this.deadlineTimer = null;
    if (this.stopped || this.paused) return;
    const d = this.state?.deadline;
    if (typeof d !== 'number') return;
    if (this.nowFn() < d) { this.#schedule(); return; }   // timer fired early, or the delay was clamped
    // If advance changes nothing the deadline stays due but is NOT rescheduled (no hot loop);
    // the next change re-arms it.
    this.#apply((st, ctx) => this.engine.advance(st, ctx));
  }

  /** Re-check the deadline now. Call when the page returns to the foreground: phones throttle timers. */
  poke() { if (!this.paused && !this.stopped) this.#schedule(); }

  // ---------- pause ----------

  pause() {
    if (this.paused || this.stopped) return false;
    this.paused = true;
    this.pausedAt = this.nowFn();
    if (this.deadlineTimer !== null) { this.timers.clearTimeout(this.deadlineTimer); this.deadlineTimer = null; }
    if (this.silent) this.silentRemaining = Math.max(0, this.silent.due - this.pausedAt);
    this.#clearCueTimer();
    return true;
  }

  resume() {
    if (!this.paused || this.stopped) return false;
    const delta = Math.max(0, this.nowFn() - this.pausedAt);
    this.paused = false;
    let moved = false;
    if (typeof this.state.deadline === 'number' && delta > 0) { this.state.deadline += delta; moved = true; }
    if (moved) this.rev++;
    this.#schedule();
    const cue = this.cue();
    if (cue && this.mode === 'silent') {
      this.#armSilent(cue, this.silentRemaining ?? Math.max(0, (cue.minMs ?? 0) - (this.pausedAt - this.cueStartedAt)));
    }
    this.silentRemaining = null;
    if (moved) this.onChange();
    if (cue) this.onCue(cue, { replay: true });   // speech was cancelled by the pause; say it again
    return true;
  }

  stop() {
    this.stopped = true;
    if (this.deadlineTimer !== null) { this.timers.clearTimeout(this.deadlineTimer); this.deadlineTimer = null; }
    this.#clearCueTimer();
  }

  // ---------- narration cues ----------

  #clearCueTimer() {
    if (this.cueTimer !== null) { this.timers.clearTimeout(this.cueTimer); this.cueTimer = null; }
    this.silent = null;
  }

  /** Returns the cue if a NEW one began (id changed), else null. */
  #trackCue() {
    const cue = this.cue();
    const id = cue?.id ?? null;
    if (id === this.lastCueId) return null;
    this.lastCueId = id;
    this.cueStartedAt = this.nowFn();
    this.#clearCueTimer();
    this.silentRemaining = null;
    if (cue && this.mode === 'silent') this.#armSilent(cue, cue.minMs ?? 0);
    return cue;
  }

  #armSilent(cue, delay) {
    this.#clearCueTimer();
    const ms = Math.max(0, delay);
    this.silent = { id: cue.id, due: this.nowFn() + ms };
    this.cueTimer = this.timers.setTimeout(() => {
      this.cueTimer = null;
      this.silent = null;
      if (this.stopped || this.paused || this.lastCueId !== cue.id) return;
      this.cueDone(cue.id);
    }, ms);
  }

  /** 'voice' | 'read' | 'silent'. Only silent makes the session complete cues by itself. */
  setNarrationMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.stopped || this.paused) return;
    if (mode !== 'silent') { this.#clearCueTimer(); return; }
    const cue = this.cue();
    if (cue) this.#armSilent(cue, Math.max(0, (cue.minMs ?? 0) - (this.nowFn() - this.cueStartedAt)));
  }

  // ---------- queries ----------

  #query(fn, fallback) {
    try { return fn(); } catch (e) { this.lastError = e; console.error('[session] engine query threw', e); return fallback; }
  }

  /** What `pid` may see. Always a fresh JSON copy; null if the engine threw. */
  view(pid) { return this.#query(() => jsonClone(this.engine.view(this.state, pid)) ?? null, null); }
  table() { return this.view(null); }
  focus() { return this.#query(() => jsonClone(this.engine.focus?.(this.state) ?? null), null); }
  cue() {
    if (this.stopped) return null;
    return this.#query(() => jsonClone(this.engine.cue?.(this.state) ?? null), null);
  }
  result() { return this.#query(() => jsonClone(this.engine.result?.(this.state) ?? null), null); }
  legal(pid) { return this.#query(() => this.engine.legalActions?.(this.state, pid) ?? [], []); }

  /**
   * Is the game actually WAITING on this seat (so a dead phone stalls the table)? Night decoys give every
   * seat a legal action, so legality alone over-reports. Asks, in order: engine.blocking(state, pid) if the
   * game has it; else whether focus() names the seat (when focus gives an answer); else legalActions.
   */
  blocking(pid) {
    return this.#query(() => {
      if (typeof this.engine.blocking === 'function') return !!this.engine.blocking(this.state, pid);
      const f = this.engine.focus?.(this.state);
      if (f && Array.isArray(f.pids)) return f.pids.includes(pid);
      return (this.engine.legalActions?.(this.state, pid) ?? []).length > 0;
    }, false);
  }
  deadline() { return typeof this.state?.deadline === 'number' ? this.state.deadline : null; }

  // ---------- shared drawing ----------

  /**
   * A seat sends strokes. Accepted only if the engine says this seat may draw now.
   * The normalised batch is merged into `session.drawing` ({ epoch, strokes }) and
   * handed to onInk for relaying.
   */
  ink(pid, payload) {
    if (this.stopped || this.paused) return false;
    if (!this.#query(() => this.engine.canInk?.(this.state, pid), false)) return false;
    const batch = normalizeInk(pid, payload);
    if (!batch) return false;
    if (batch.pts?.length) {
      let total = batch.pts.length;
      for (const s of this.drawing.strokes) total += s.pts.length;
      if (total > MAX_PTS_TOTAL) return false;   // a drawing this dense is not a party-game drawing
    }
    applyInkBatch(this.drawing, batch);
    this.onInk(batch);
    return true;
  }

  // ---------- persistence ----------

  snapshot() {
    return {
      v: 1,
      savedAt: this.nowFn(),
      gameId: this.game.meta?.id ?? null,
      players: clone(this.players),
      config: clone(this.config),
      hostPid: this.hostPid,
      state: clone(this.state),
      rev: this.rev,
      ink: clone(this.drawing),
      lastCueId: this.lastCueId,
      cueStartedAt: this.cueStartedAt,
      paused: this.paused,
      pausedAt: this.pausedAt,
      silentRemaining: this.paused
        ? this.silentRemaining
        : (this.silent ? Math.max(0, this.silent.due - this.nowFn()) : null),
    };
  }
}
