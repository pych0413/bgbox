// ============================================================
// tests/lib.mjs — headless harness for game engines (Node 18+, no deps).
//
//   import { test, Sim, assert } from './lib.mjs';
//   import * as game from '../js/games/spyfall/game.js';
//   test('spyfall: random games terminate', () => {
//     for (let seed = 1; seed <= 200; seed++)
//       new Sim(game, { n: 5, seed, banks }).runRandom();
//   });
//
// `game` is the PURE module (games/<id>/game.js): { meta, rules, config, engine }.
// ============================================================

import assert from 'node:assert/strict';
import { mulberry32, clone, HOST, ACT } from '../js/core/engine-kit.js';

export { assert, HOST, ACT };

// ---------- registry ----------
export const TESTS = [];
export function test(name, fn) { TESTS.push({ name, fn }); }

// ---------- fixtures ----------
export const COLORS = ['#f5c518', '#4ec97a', '#4aa3ff', '#ff7a59', '#c084fc', '#f472b6',
  '#2dd4bf', '#facc15', '#a3e635', '#fb923c', '#60a5fa', '#e879f9', '#94a3b8', '#fda4af', '#86efac', '#fde68a'];

export function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, name: `玩家${i + 1}`, seat: i, color: COLORS[i % COLORS.length],
  }));
}

/**
 * In-memory content bag with the same contract as js/core/bag.js:
 *   draw(bankId, filter?) → entry | null   (without replacement; refills when the filtered pool runs out)
 *   stats(bankId, filter?) → { used, total }
 * `banks` = { bankId: entries[] }  (draw-words should be passed already flattened to {w, alt, level, cat}).
 */
export function makeBag(banks = {}, rng = mulberry32(99)) {
  const used = {};
  const key = (e) => JSON.stringify(e);
  return {
    draw(bankId, filter = () => true) {
      const all = (banks[bankId] || []).filter(filter);
      if (!all.length) return null;
      const u = (used[bankId] ||= new Set());
      let pool = all.filter((e) => !u.has(key(e)));
      if (!pool.length) { for (const e of all) u.delete(key(e)); pool = all; }
      const e = pool[Math.floor(rng() * pool.length)];
      u.add(key(e));
      return clone(e);
    },
    stats(bankId, filter = () => true) {
      const all = (banks[bankId] || []).filter(filter);
      const u = used[bankId] || new Set();
      return { used: all.filter((e) => u.has(key(e))).length, total: all.length };
    },
  };
}

// ---------- simulator ----------
export class Sim {
  /**
   * @param game  pure game module { meta, config, engine }
   * @param opts  { n, seed=1, config?, banks?, now? }
   */
  constructor(game, { n, seed = 1, config, banks = {}, now = 1_000_000 } = {}) {
    this.game = game;
    this.engine = game.engine;
    this.rng = mulberry32(seed);
    this.now = now;
    this.players = makePlayers(n);
    this.config = config ?? game.config.defaults(n);
    const v = game.config.validate(this.config, n);
    if (!v.ok) throw new Error(`invalid config for n=${n}: ${v.message}`);
    this.bag = makeBag(banks, mulberry32(seed + 7));
    this.state = this.engine.setup({ players: clone(this.players), config: clone(this.config), ...this.ctx() });
    this.steps = 0;
    this.trace = [];
  }

  ctx() { return { rng: this.rng, now: this.now, bag: this.bag }; }

  /** Feed an action. Returns true if the state changed. */
  act(pid, action) {
    const before = JSON.stringify(this.state);
    const next = this.engine.act(clone(this.state), { pid, action }, this.ctx());
    if (next !== undefined) this.state = next;
    this.steps++;
    const changed = JSON.stringify(this.state) !== before;
    this.trace.push({ pid, action, changed, phase: this.state.phase });
    if (this.trace.length > 60) this.trace.shift();
    return changed;
  }

  host(action) { return this.act(HOST, action); }

  /** Finish the current narration cue, as the narrator would. */
  cueDone() {
    const c = this.cue();
    return c ? this.host({ type: ACT.CUE_DONE, id: c.id }) : false;
  }

  /** Jump the clock to the deadline and let the engine advance. */
  advance() {
    const d = this.state.deadline;
    if (d == null) return false;
    if (this.now < d) this.now = d;
    const before = JSON.stringify(this.state);
    const next = this.engine.advance(clone(this.state), this.ctx());
    if (next !== undefined) this.state = next;
    this.steps++;
    const changed = JSON.stringify(this.state) !== before;
    this.trace.push({ pid: '@clock', action: { type: 'advance' }, changed, phase: this.state.phase });
    return changed;
  }

  tick(ms) { this.now += ms; }
  view(pid) { return this.engine.view(this.state, pid); }
  views() { return Object.fromEntries(this.players.map((p) => [p.id, this.view(p.id)])); }
  cue() { return this.engine.cue ? this.engine.cue(this.state) : null; }
  focus() { return this.engine.focus ? this.engine.focus(this.state) : null; }
  result() { return this.engine.result(this.state); }
  legal(pid) { return this.engine.legalActions ? this.engine.legalActions(this.state, pid) : []; }

  /**
   * Play random legal moves until the game ends. Throws with a trace if it
   * gets stuck or runs past maxSteps. Returns { result, steps }.
   * `onStep(sim)` runs after every step — put invariant/leak checks there.
   */
  runRandom({ maxSteps = 20000, onStep } = {}) {
    for (let i = 0; i < maxSteps; i++) {
      const res = this.result();
      if (res) {
        assertResultShape(res, this.players);
        return { result: res, steps: this.steps };
      }
      const movers = this.players.map((p) => p.id).filter((id) => this.legal(id).length);
      let progressed = false;

      if (movers.length && this.rng() < 0.85) {
        const pid = movers[Math.floor(this.rng() * movers.length)];
        const options = this.legal(pid);
        progressed = this.act(pid, options[Math.floor(this.rng() * options.length)]);
        if (!progressed) throw this.stuck(`legalActions offered an action that changed nothing (pid ${pid})`);
      } else if (this.cue() && this.cueDone()) {
        progressed = true;
      } else if (this.state.deadline != null && this.advance()) {
        progressed = true;
      } else if (movers.length) {
        const pid = movers[0];
        progressed = this.act(pid, this.legal(pid)[0]);
      } else if (this.host({ type: ACT.NEXT })) {
        progressed = true;
      }

      if (!progressed) throw this.stuck('no seat can act, no cue, no deadline, and @next does nothing');
      if (onStep) onStep(this);
    }
    throw this.stuck(`no result after ${maxSteps} steps`);
  }

  stuck(why) {
    return new Error(`${this.game.meta?.id ?? 'game'} stuck: ${why}\nphase=${this.state.phase}\n`
      + `last steps:\n${this.trace.map((t) => `  ${t.pid} ${JSON.stringify(t.action)} → ${t.phase}${t.changed ? '' : ' (no change)'}`).join('\n')}`);
  }
}

export function assertResultShape(res, players) {
  const ids = new Set(players.map((p) => p.id));
  assert.ok(Array.isArray(res.winners), 'result.winners must be an array');
  for (const w of res.winners) assert.ok(ids.has(w), `unknown winner ${w}`);
  assert.equal(typeof res.summary, 'string', 'result.summary must be a string');
  assert.ok(Array.isArray(res.lines ?? []), 'result.lines must be an array');
}

// ---------- leak helpers ----------

/** Every path in `obj` whose value satisfies `pred`, e.g. paths(view, v => v === 'werewolf'). */
export function paths(obj, pred, base = '$') {
  const out = [];
  if (pred(obj)) out.push(base);
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) out.push(...paths(v, pred, `${base}.${k}`));
  }
  return out;
}

/** Assert that `view` contains no key named any of `keys` anywhere (e.g. ['role', 'word'] in someone else's view). */
export function assertNoKeys(view, keys, label = 'view') {
  const hits = paths(view, () => false);
  const walk = (o, base) => {
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (keys.includes(k)) hits.push(`${base}.${k}`);
        walk(v, `${base}.${k}`);
      }
    }
  };
  walk(view, '$');
  assert.deepEqual(hits, [], `${label} leaks ${keys.join('/')}: ${hits.join(', ')}`);
}
