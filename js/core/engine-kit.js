// ============================================================
// engine-kit.js — pure helpers shared by every game engine.
//
// Engines run on the host phone AND headless under Node in tests, so
// nothing here may touch the DOM, the network, Math.random() or Date.
// Randomness always comes from an injected rng(): () => float in [0, 1).
// ============================================================

/** Host-internal action types. They arrive with pid === HOST. */
export const HOST = '@host';
export const ACT = Object.freeze({
  CUE_DONE: '@cue-done',   // { type, id } narration for cue `id` finished (or was skipped)
  NEXT: '@next',           // { type } host pressed 下一步 / skip
  AUTO: '@auto',           // { type, pid } host asked to auto-act a stalled seat
  VOID_ROUND: '@void-round', // { type } host discards the current round (a phone died mid-round). Optional:
                             // an engine that does not support it returns the state unchanged.
});

// ---------- randomness ----------

/** Seeded PRNG for tests and replays. Same seed → same game. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Crypto-grade rng for real games (host only). */
export function cryptoRng() {
  const buf = new Uint32Array(1);
  return function rng() {
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  };
}

/** Uniform integer in [0, n). */
export function rint(rng, n) {
  if (!(n > 0)) throw new RangeError('rint: n must be > 0');
  return Math.min(n - 1, Math.floor(rng() * n));
}

/** Fisher–Yates. Returns a new array. */
export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rint(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick(rng, arr) {
  return arr.length ? arr[rint(rng, arr.length)] : undefined;
}

/** k distinct items, order random. */
export function sample(rng, arr, k) {
  return shuffle(rng, arr).slice(0, Math.max(0, Math.min(k, arr.length)));
}

export function rollDie(rng, sides = 6) { return rint(rng, sides) + 1; }

// ---------- seats ----------

/** Player ids in seat order. `players` is [{ id, seat }]. */
export function seatOrder(players) {
  return players.slice().sort((a, b) => a.seat - b.seat).map((p) => p.id);
}

/**
 * Next id clockwise after `fromId` in `order`, skipping ids for which
 * `eligible(id)` is false. Returns null if nobody is eligible.
 */
export function nextSeat(order, fromId, eligible = () => true) {
  const n = order.length;
  const start = order.indexOf(fromId);
  for (let step = 1; step <= n; step++) {
    const id = order[(start + step + n) % n];
    if (eligible(id)) return id;
  }
  return null;
}

// ---------- votes ----------

/**
 * Count votes. `votes` maps voter → target id, or null for abstain.
 * Optional `weights` maps voter → weight (e.g. 1.5 for a sheriff).
 * Returns { counts: { target: n }, top: [ids with the max], max }.
 * Abstentions are not counted. Nobody voted → top = [], max = 0.
 */
export function tally(votes, weights = {}) {
  const counts = {};
  for (const [voter, target] of Object.entries(votes)) {
    if (target == null) continue;
    counts[target] = (counts[target] || 0) + (weights[voter] ?? 1);
  }
  let max = 0;
  for (const n of Object.values(counts)) if (n > max) max = n;
  const top = max > 0 ? Object.keys(counts).filter((k) => counts[k] === max) : [];
  return { counts, top, max };
}

// ---------- state ----------

/** Deep copy for plain JSON-ish state. The session clones before every engine call. */
export function clone(x) {
  return typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x));
}

/** Push to a public log, keeping it bounded. */
export function note(state, text, max = 80) {
  (state.log ||= []).push(text);
  if (state.log.length > max) state.log.splice(0, state.log.length - max);
  return state;
}
