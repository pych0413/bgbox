// ============================================================
// tests/cheese-thief.test.mjs — rules, anti-tell, leaks and a fuzzer for 芝士大盜.
//   node tests/run.mjs cheese-thief
// ============================================================

import { test, assert, Sim, paths, ACT, HOST, makePlayers } from './lib.mjs';
import * as game from '../js/games/cheese-thief/game.js';
import { judge } from '../js/games/cheese-thief/game.js';
import { mulberry32, clone } from '../js/core/engine-kit.js';

const { engine, config, meta } = game;
const COUNTS = [4, 5, 6, 7, 8];

// ---------- helpers ----------

const ids = (n) => makePlayers(n).map((p) => p.id);

/**
 * Build a game at the start of the night with chosen roles and dice.
 * dice: { p1: 3 } (4p: a number means two equal dice, or give [a, b]).
 * pick4: { p2: 5 } which die a 4p sleepyhead keeps (default: its first).
 */
function scenario(n, { seed = 1, thief = 'p1', fm = null, dice = {}, pick4 = {}, config: cfg } = {}) {
  const sim = new Sim(game, { n, seed, config: cfg });
  const s = sim.state;
  const all = ids(n);
  all.forEach((id, i) => {
    s.role[id] = 'sleepyhead';
    const d = dice[id] ?? (i % 6) + 1;
    s.dice[id] = n === 4 ? (Array.isArray(d) ? d.slice() : [d, d]) : [Array.isArray(d) ? d[0] : d];
    s.locked[id] = true;
    s.rollSeq[id] = 1;
  });
  s.role[thief] = 'thief';
  if (fm) s.role[fm] = 'fall-mouse';
  for (const id of all) {
    if (n === 4 && s.role[id] !== 'thief') s.pick4[id] = pick4[id] ?? s.dice[id][0];
  }
  for (const id of all) sim.act(id, { type: 'ready' });
  assert.equal(sim.state.phase, 'night');
  return sim;
}

const st = (sim) => sim.state.steps[sim.state.ix];
const stepIndex = (sim, k, h) => sim.state.steps.findIndex((x) => x.k === k && (h === undefined || x.h === h));

/** Run the clock until the given step is in the given stage. */
function runTo(sim, ix, stage = 'window') {
  for (let guard = 0; guard < 500; guard++) {
    const s = sim.state;
    if (s.phase !== 'night') throw new Error(`left the night before reaching step ${ix}`);
    if (s.ix === ix && s.stage === stage) return;
    if (s.stage === 'cue') sim.cueDone(); else sim.advance();
  }
  throw new Error('runTo did not converge');
}
const openHour = (sim, h) => runTo(sim, stepIndex(sim, 'open', h), 'window');

/** Play the rest of the night with nobody doing anything. Ends in the day. */
function finishNight(sim) {
  for (let guard = 0; guard < 500 && sim.state.phase === 'night'; guard++) {
    if (sim.state.stage === 'cue') sim.cueDone(); else sim.advance();
  }
  assert.equal(sim.state.phase, 'day');
}

function toVote(sim) {
  finishNight(sim);
  for (const id of ids(sim.state.n)) sim.act(id, { type: 'day-ready', on: true });
  assert.equal(sim.state.phase, 'vote');
}

/** Cast votes (plan: voter → target). Missing voters vote for someone harmless. */
function castVotes(sim, plan) {
  const all = ids(sim.state.n);
  for (const id of all) {
    const target = plan[id] ?? all.find((x) => x !== id);
    sim.act(id, { type: 'vote', target });
  }
}

function playOut(sim, plan) {
  toVote(sim);
  castVotes(sim, plan);
  assert.equal(sim.state.phase, 'reveal');
  sim.advance();
  assert.equal(sim.state.phase, 'over');
  return sim.result();
}

const view = (sim, id) => sim.view(id);
const sorted = (a) => a.slice().sort();

// ============================================================
// meta / config
// ============================================================

test('cheese-thief: meta and config are well-formed', () => {
  assert.equal(meta.id, 'cheese-thief');
  assert.deepEqual(meta.players, [4, 8]);
  assert.equal(meta.narration, 'required');
  assert.ok(['full', 'partial', 'none'].includes(meta.singleDevice));
  assert.ok(Array.isArray(meta.banks));
  assert.ok(game.rules.quick.length >= 3);
  assert.deepEqual(game.rules.roles.map((r) => r.id).sort(), ['fall-mouse', 'follower', 'sleepyhead', 'thief']);
  for (const r of game.rules.roles) assert.ok(r.name && r.emoji && r.team && r.text, r.id);
  for (const sec of game.rules.sections) assert.ok(sec.title && sec.body);

  for (const n of COUNTS) {
    const d = config.defaults(n);
    assert.equal(config.validate(d, n).ok, true, `defaults valid for ${n}`);
    assert.ok(config.summary(d, n).length >= 2);
    const keys = new Set();
    for (const f of config.fields(d, n)) {
      assert.ok(f.key && f.label && f.type, 'field shape');
      assert.ok(['int', 'bool', 'select', 'roles', 'categories', 'seconds'].includes(f.type));
      assert.ok(!keys.has(f.key));
      keys.add(f.key);
    }
  }
});

test('cheese-thief: validate rejects bad head-counts and bad options', () => {
  assert.equal(config.validate(config.defaults(5), 3).ok, false);
  assert.equal(config.validate(config.defaults(5), 9).ok, false);
  assert.equal(config.validate({ ...config.defaults(5), fallMouse: true }, 5).ok, false, 'fall mouse needs 6-8');
  assert.equal(config.validate({ ...config.defaults(4), fallMouse: true }, 4).ok, false);
  assert.equal(config.validate({ ...config.defaults(6), fallMouse: true }, 6).ok, true);
  assert.equal(config.validate({ ...config.defaults(8), fallMouse: true }, 8).ok, true);
  assert.equal(config.validate({ ...config.defaults(6), hourSec: 2 }, 6).ok, false);
  assert.equal(config.validate({ ...config.defaults(6), hourSec: 99 }, 6).ok, false);
  assert.equal(config.validate({ ...config.defaults(6), discussSec: -1 }, 6).ok, false);
  assert.ok(config.validate(config.defaults(4), 4).warnings.length > 0, '4p warns about the variant');
});

test('cheese-thief: fields only offer what applies to the head-count', () => {
  const keys = (n) => config.fields(config.defaults(n), n).map((f) => f.key);
  assert.ok(!keys(5).includes('fallMouse'));
  assert.ok(keys(6).includes('fallMouse'));
  assert.ok(!keys(6).includes('peek4'));
  assert.ok(keys(4).includes('peek4'));
});

test('cheese-thief: defaults keep what the host chose last time, but never an invalid combo', () => {
  const prev = { fallMouse: true, hourSec: 14, discussSec: 0, reroll: true, recap: false, peek4: true };
  const d6 = config.defaults(6, prev);
  assert.equal(d6.fallMouse, true);
  assert.equal(d6.hourSec, 14);
  assert.equal(d6.discussSec, 0);
  const d5 = config.defaults(5, prev);
  assert.equal(d5.fallMouse, false, 'fall mouse does not carry into 5p');
  assert.equal(config.validate(d5, 5).ok, true);
});

// ============================================================
// deal, dice
// ============================================================

test('cheese-thief: deck is 1 thief + sleepyheads; fall mouse replaces a sleepyhead (6-8 only)', () => {
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 25; seed++) {
      const sim = new Sim(game, { n, seed });
      const roles = Object.values(sim.state.role);
      assert.equal(roles.length, n);
      assert.equal(roles.filter((r) => r === 'thief').length, 1);
      assert.equal(roles.filter((r) => r === 'sleepyhead').length, n - 1);
    }
  }
  for (const n of [6, 7, 8]) {
    const sim = new Sim(game, { n, seed: 3, config: { ...config.defaults(n), fallMouse: true } });
    const roles = Object.values(sim.state.role);
    assert.equal(roles.filter((r) => r === 'thief').length, 1);
    assert.equal(roles.filter((r) => r === 'fall-mouse').length, 1);
    assert.equal(roles.filter((r) => r === 'sleepyhead').length, n - 2, 'replaces, not adds');
  }
  // setup ignores a fall mouse that the head-count cannot take (validate() already refuses it)
  for (const n of [4, 5]) {
    const state = engine.setup({ players: makePlayers(n), config: { ...config.defaults(n), fallMouse: true }, rng: mulberry32(3), now: 0 });
    assert.equal(Object.values(state.role).filter((r) => r === 'fall-mouse').length, 0);
  }
});

test('cheese-thief: the deal is seeded, and the thief is not always the first seat', () => {
  const a = new Sim(game, { n: 6, seed: 42 }).state.role;
  const b = new Sim(game, { n: 6, seed: 42 }).state.role;
  assert.deepEqual(a, b);
  const thieves = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const r = new Sim(game, { n: 6, seed }).state.role;
    thieves.add(Object.keys(r).find((k) => r[k] === 'thief'));
  }
  assert.ok(thieves.size >= 4, 'thief seat varies');
});

test('cheese-thief: one roll stands — a second roll changes nothing (official rule)', () => {
  const sim = new Sim(game, { n: 5, seed: 2 });
  assert.equal(sim.state.dice.p1, null);
  assert.equal(view(sim, 'p1').my.dice, null);
  assert.ok(sim.act('p1', { type: 'roll' }));
  const first = clone(sim.state.dice.p1);
  assert.equal(first.length, 1);
  assert.ok(first[0] >= 1 && first[0] <= 6);
  assert.equal(sim.state.locked.p1, true, 'auto-locked');
  assert.equal(sim.state.rollSeq.p1, 1);
  for (let i = 0; i < 20; i++) assert.equal(sim.act('p1', { type: 'roll' }), false);
  assert.deepEqual(sim.state.dice.p1, first);
  assert.equal(sim.state.rollSeq.p1, 1);
  assert.deepEqual(view(sim, 'p1').my.dice, first);
  assert.equal(view(sim, 'p1').my.locked, true);
});

test('cheese-thief: reroll mode — roll until you lock, then it stands', () => {
  const sim = new Sim(game, { n: 5, seed: 2, config: { ...config.defaults(5), reroll: true } });
  assert.equal(sim.act('p1', { type: 'lock' }), false, 'nothing to lock yet');
  sim.act('p1', { type: 'roll' });
  assert.equal(sim.state.locked.p1, false);
  const seq = new Set([sim.state.rollSeq.p1]);
  for (let i = 0; i < 6; i++) { sim.act('p1', { type: 'roll' }); seq.add(sim.state.rollSeq.p1); }
  assert.equal(seq.size, 7, 'every roll bumps the counter, even if it lands on the same number');
  assert.ok(sim.legal('p1').some((a) => a.type === 'lock'));
  assert.ok(sim.act('p1', { type: 'lock' }));
  const fixed = clone(sim.state.dice.p1);
  assert.equal(sim.act('p1', { type: 'roll' }), false);
  assert.deepEqual(sim.state.dice.p1, fixed);
});

test('cheese-thief: 4 players roll two dice; the same roll counter drives the chime', () => {
  const sim = new Sim(game, { n: 4, seed: 9 });
  sim.act('p1', { type: 'roll' });
  assert.equal(sim.state.dice.p1.length, 2);
  assert.equal(view(sim, 'p1').my.dice.length, 2);
  assert.equal(view(sim, 'p1').my.rollSeq, 1);
  assert.equal(view(sim, 'p2').my.rollSeq, 0, 'a seat sees only its own counter');
});

test('cheese-thief: 4p sleepyhead picks one of its two dice; thief keeps both', () => {
  const sim = new Sim(game, { n: 4, seed: 1 });
  const s = sim.state;
  for (const id of ids(4)) { s.role[id] = 'sleepyhead'; s.dice[id] = [2, 5]; s.locked[id] = true; }
  s.role.p1 = 'thief';
  assert.equal(view(sim, 'p2').my.needsChoice, true);
  assert.equal(view(sim, 'p1').my.needsChoice, false, 'thief does not choose');
  assert.equal(sim.act('p2', { type: 'choose-hour', hour: 4 }), false, 'must be one of its dice');
  assert.equal(sim.act('p2', { type: 'choose-hour', hour: 'x' }), false);
  assert.equal(sim.act('p1', { type: 'choose-hour', hour: 2 }), false, 'thief cannot choose');
  assert.ok(sim.act('p2', { type: 'choose-hour', hour: 5 }));
  assert.equal(view(sim, 'p2').my.chosen, 5);
  assert.ok(sim.act('p2', { type: 'choose-hour', hour: 2 }), 'may change before ready');
  assert.equal(sim.state.pick4.p2, 2);
  sim.act('p2', { type: 'ready' });
  assert.equal(sim.act('p2', { type: 'choose-hour', hour: 5 }), false, 'fixed once ready');
  assert.equal(sim.state.pick4.p2, 2);
  // equal dice: no choice needed
  sim.state.dice.p3 = [4, 4];
  assert.equal(view(sim, 'p3').my.needsChoice, false);
});

test('cheese-thief: "ready" fills in whatever is missing (roll, lock, 4p choice) — 代佢做 is one tap', () => {
  for (const n of COUNTS) {
    const sim = new Sim(game, { n, seed: 5 });
    for (const id of ids(n)) {
      const a = engine.autoAct(sim.state, id, sim.ctx());
      assert.deepEqual(a, { type: 'ready' });
      assert.ok(sim.act(id, a));
      assert.equal(sim.state.ready[id], true);
      assert.ok(sim.state.dice[id].length === (n === 4 ? 2 : 1));
      if (n === 4 && sim.state.role[id] !== 'thief') assert.ok(sim.state.dice[id].includes(sim.state.pick4[id]));
    }
    assert.equal(sim.state.phase, 'night');
  }
});

test('cheese-thief: night starts only when everyone is ready', () => {
  const sim = new Sim(game, { n: 5, seed: 4 });
  for (const id of ids(5).slice(0, 4)) sim.act(id, { type: 'ready' });
  assert.equal(sim.state.phase, 'roll');
  assert.equal(view(sim, 'p5').ready.done, 4);
  assert.deepEqual(engine.focus(sim.state), { pids: ['p5'] });
  sim.act('p5', { type: 'ready' });
  assert.equal(sim.state.phase, 'night');
});

// ============================================================
// night structure and pacing
// ============================================================

test('cheese-thief: hours 1-6 are all called in order; recruit steps match the head-count', () => {
  const kinds = (n) => scenario(n).state.steps.map((x) => x.k + (x.h ? x.h : ''));
  const base = ['begin', 'open1', 'close1', 'open2', 'close2', 'open3', 'close3', 'open4', 'close4', 'open5', 'close5', 'open6', 'close6'];
  assert.deepEqual(kinds(4), [...base, 'dawn']);
  assert.deepEqual(kinds(5), [...base, 'dawn']);
  assert.deepEqual(kinds(6), [...base, 'rec-pick', 'rec-meet', 'rec-close', 'dawn']);
  assert.deepEqual(kinds(7), [...base, 'rec-pick', 'rec-tclose', 'rec-meet', 'rec-close', 'dawn']);
  assert.deepEqual(kinds(8), [...base, 'rec-pick', 'rec-meet', 'rec-close', 'dawn']);
});

test('cheese-thief: every hour window is exactly the configured length, empty or not', () => {
  for (const n of [5, 6]) {
    // everyone rolls 1: hours 2-6 are empty, hour 1 is crowded
    const dice = Object.fromEntries(ids(n).map((id) => [id, 1]));
    const sim = scenario(n, { dice, config: { ...config.defaults(n), hourSec: 7 } });
    const lens = [];
    for (let h = 1; h <= 6; h++) {
      runTo(sim, stepIndex(sim, 'open', h), 'cue');
      const t0 = sim.now;
      sim.cueDone();
      lens.push(sim.state.deadline - t0);
    }
    assert.deepEqual(new Set(lens), new Set([7000]), `n=${n}: ${lens}`);
  }
});

test('cheese-thief: what the host hears and sees is identical for crowded and empty hours', () => {
  const dice = { p1: 1, p2: 1, p3: 1, p4: 1, p5: 1, p6: 1 };
  const sim = scenario(6, { dice });
  const cues = [];
  const prompts = [];
  for (let h = 1; h <= 6; h++) {
    runTo(sim, stepIndex(sim, 'open', h), 'cue');
    cues.push(engine.cue(sim.state).text);
    sim.cueDone();
    prompts.push(engine.focus(sim.state));
    assert.ok(prompts[h - 1], `hour ${h} still returns a focus (empty or not)`);
  }
  // same sentence frame, only the numerals differ
  const frame = (t) => t.replace(/[一二兩三四五六]/g, '#');
  assert.equal(new Set(cues.map(frame)).size, 1);
  assert.equal(new Set(cues.map((c) => c.length)).size, 1);
  assert.equal(new Set(prompts.map((p) => p.anonymous.replace(/[一二三四五六]/g, '#'))).size, 1);
  assert.deepEqual(prompts[0].pids.length, 6);
  assert.deepEqual(prompts[1].pids, [], 'empty hour: no pids, but the prompt is still there');
  assert.ok(prompts[1].anonymous.length > 0);
});

test('cheese-thief: sleeping seats get the same (empty) night view at every hour', () => {
  const sim = scenario(6, { dice: { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6 } });
  const seen = new Set();
  for (let h = 1; h <= 6; h++) {
    openHour(sim, h);
    for (const id of ids(6)) {
      const v = view(sim, id);
      if (sim.state.wake[id].includes(h)) continue;
      assert.deepEqual(v.nightSeat, { awake: false });
      seen.add(JSON.stringify({ n: v.nightSeat, k: Object.keys(v.my).sort() }));
    }
  }
  assert.equal(seen.size, 1, 'a sleeper cannot tell hours apart except by the public step number');
});

test('cheese-thief: acking, peeking and recruiting never shorten a step', () => {
  const sim = scenario(6, { dice: { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6 } });
  openHour(sim, 2);
  const d = sim.state.deadline;
  for (const id of ids(6)) sim.act(id, { type: 'ack' });
  sim.act('p2', { type: 'peek', target: 'p3' });
  assert.equal(sim.state.deadline, d);
  assert.equal(sim.state.ix, stepIndex(sim, 'open', 2));
  assert.equal(sim.state.stage, 'window');
  assert.equal(view(sim, 'p4').acks.done, 6);
});

test('cheese-thief: @next in read mode ends the narration, then the window; @cue-done needs the right id', () => {
  const sim = scenario(5);
  assert.equal(sim.state.stage, 'cue');
  assert.equal(sim.host({ type: ACT.CUE_DONE, id: 'nope' }), false, 'stale cue id ignored');
  assert.ok(sim.host({ type: ACT.NEXT }));
  assert.equal(sim.state.stage, 'window');
  assert.ok(sim.state.deadline != null);
  assert.ok(sim.host({ type: ACT.NEXT }));
  assert.equal(sim.state.stage, 'cue');
  assert.equal(sim.state.ix, 1);
  assert.equal(sim.state.deadline, null);
});

test('cheese-thief: cue ids are unique through a whole game and never repeat across games', () => {
  const seen = new Map();
  for (const seed of [1, 2, 3]) {
    const sim = new Sim(game, { n: 7, seed });
    const mine = new Set();
    sim.runRandom({
      onStep: (x) => {
        const c = x.cue();
        if (c) { mine.add(c.id); assert.ok(c.text.length > 3); assert.ok(c.minMs >= 1800); }
      },
    });
    assert.ok(mine.size >= 14);
    for (const id of mine) { assert.ok(!seen.has(id), `cue id ${id} reused`); seen.set(id, seed); }
  }
});

test('cheese-thief: narration says the right recruitment script for 6, 7 and 8', () => {
  const textAt = (n) => {
    const sim = scenario(n);
    const out = {};
    for (const k of ['rec-pick', 'rec-tclose', 'rec-meet', 'rec-close']) {
      const ix = stepIndex(sim, k);
      if (ix < 0) continue;
      runTo(sim, ix, 'cue');
      out[k] = engine.cue(sim.state).text;
    }
    return out;
  };
  const t6 = textAt(6), t7 = textAt(7), t8 = textAt(8);
  assert.match(t6['rec-pick'], /一位共犯/);
  assert.match(t7['rec-pick'], /兩位共犯/);
  assert.match(t8['rec-pick'], /兩位共犯/);
  assert.match(t6['rec-meet'], /同大盜對望/);
  assert.match(t7['rec-meet'], /互相認人/);
  assert.ok(!/大盜/.test(t7['rec-meet']), '7p: the thief does not open eyes at the meeting');
  assert.match(t8['rec-meet'], /三個人/);
  assert.ok(t7['rec-tclose'], '7p has the extra "thief shuts eyes" step');
  assert.equal(t6['rec-tclose'], undefined);
  assert.equal(t8['rec-tclose'], undefined);
  assert.equal(scenario(5).state.steps.some((x) => x.k.startsWith('rec')), false);
  assert.equal(scenario(4).state.steps.some((x) => x.k.startsWith('rec')), false);
});

// ============================================================
// night: waking, theft, peeking
// ============================================================

test('cheese-thief: the thief steals as its window opens; co-wakers see who; later wakers do not', () => {
  // p1 thief wakes at 3 with p2; p3 wakes at 5 (after the theft); p4 at 3 as well
  const sim = scenario(6, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 5, p4: 3, p5: 1, p6: 6 } });
  openHour(sim, 1);
  assert.deepEqual(view(sim, 'p5').nightSeat.cheese, 'table');
  assert.equal(sim.state.cheese.gone, false);
  runTo(sim, stepIndex(sim, 'open', 3), 'cue');
  assert.equal(sim.state.cheese.gone, false, 'not before the window opens');
  sim.cueDone();
  assert.equal(sim.state.cheese.gone, true);
  assert.equal(sim.state.cheese.by, 'p1');
  assert.equal(sim.state.cheese.hour, 3);

  const v1 = view(sim, 'p1').nightSeat, v2 = view(sim, 'p2').nightSeat, v4 = view(sim, 'p4').nightSeat;
  assert.equal(v1.awake, true);
  assert.deepEqual(sorted(v1.with), ['p2', 'p4']);
  assert.equal(v1.thief, 'p1');
  assert.equal(v1.cheese, 'gone');
  assert.deepEqual(sorted(v2.with), ['p1', 'p4']);
  assert.equal(v2.thief, 'p1', 'a witness sees who took it');
  assert.equal(v4.thief, 'p1');
  assert.equal(v2.cheese, 'gone');
  assert.deepEqual(view(sim, 'p3').nightSeat, { awake: false });

  openHour(sim, 5);
  const v3 = view(sim, 'p3').nightSeat;
  assert.equal(v3.awake, true);
  assert.equal(v3.cheese, 'gone', 'a late waker finds the cheese missing');
  assert.equal(v3.thief, null, '...but is not told who');
  assert.deepEqual(v3.with, []);
});

test('cheese-thief: a lone sleepyhead sees the cheese still on the table', () => {
  const sim = scenario(6, { thief: 'p1', dice: { p1: 6, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6 } });
  openHour(sim, 2);
  const v = view(sim, 'p2').nightSeat;
  assert.equal(v.cheese, 'table');
  assert.equal(v.thief, null);
  assert.deepEqual(v.with, []);
});

test('cheese-thief: lone sleepyhead may peek at exactly one other die; self, repeat and skipping are handled', () => {
  const sim = scenario(6, { thief: 'p1', dice: { p1: 1, p2: 2, p3: 4, p4: 3, p5: 5, p6: 6 } });
  openHour(sim, 2);
  const v = view(sim, 'p2').nightSeat;
  assert.equal(v.peek.mode, 'can');
  assert.deepEqual(sorted(v.peek.targets), ['p1', 'p3', 'p4', 'p5', 'p6']);
  assert.equal(sim.act('p2', { type: 'peek', target: 'p2' }), false, 'not at yourself');
  assert.equal(sim.act('p2', { type: 'peek', target: 'zzz' }), false);
  assert.equal(sim.act('p2', { type: 'peek' }), false);
  assert.equal(sim.act('p3', { type: 'peek', target: 'p4' }), false, 'p3 is asleep');
  const watchers = ['p1', 'p3', 'p4', 'p5', 'p6'];
  const before = watchers.map((id) => JSON.stringify(view(sim, id)));

  assert.ok(sim.act('p2', { type: 'peek', target: 'p3' }));
  assert.deepEqual(view(sim, 'p2').nightSeat.peek.done, { target: 'p3', dice: [4] });
  assert.equal(view(sim, 'p2').nightSeat.peek.mode, 'done');
  assert.deepEqual(view(sim, 'p2').notes.find((x) => x.k === 'peek'), { k: 'peek', h: 2, target: 'p3', dice: [4] });
  assert.equal(sim.act('p2', { type: 'peek', target: 'p4' }), false, 'only one peek');
  assert.equal(sim.state.peeked.p2.target, 'p3');

  // the peeked seat is never told, and nobody else's view moved at all
  const after = watchers.map((id) => JSON.stringify(view(sim, id)));
  // (acks count is public and is allowed to change)
  const strip = (j) => { const o = JSON.parse(j); delete o.acks; return JSON.stringify(o); };
  assert.deepEqual(after.map(strip), before.map(strip));
});

test('cheese-thief: skipping the peek is simply doing nothing — the hour still ends on time', () => {
  const sim = scenario(6, { thief: 'p1', dice: { p1: 1, p2: 2, p3: 4, p4: 3, p5: 5, p6: 6 } });
  openHour(sim, 2);
  const d = sim.state.deadline;
  sim.advance();
  assert.equal(sim.state.ix, stepIndex(sim, 'close', 2));
  assert.ok(d > 0);
  assert.equal(sim.state.peeked.p2, undefined);
  assert.equal(view(sim, 'p2').notes.some((x) => x.k === 'peek'), false);
});

test('cheese-thief: sleepyheads awake together cannot peek (they only learn each other)', () => {
  const sim = scenario(6, { thief: 'p1', dice: { p1: 1, p2: 2, p3: 2, p4: 3, p5: 5, p6: 6 } });
  openHour(sim, 2);
  assert.equal(view(sim, 'p2').nightSeat.peek.mode, 'together');
  assert.deepEqual(view(sim, 'p2').nightSeat.peek.targets, []);
  assert.deepEqual(view(sim, 'p2').nightSeat.with, ['p3']);
  assert.equal(sim.act('p2', { type: 'peek', target: 'p4' }), false);
  assert.equal(sim.act('p3', { type: 'peek', target: 'p4' }), false);
  assert.equal(sim.legal('p2').some((a) => a.type === 'peek'), false);
});

test('cheese-thief: the thief never gets the peek, even awake alone', () => {
  const sim = scenario(6, { thief: 'p1', dice: { p1: 4, p2: 2, p3: 3, p4: 5, p5: 5, p6: 6 } });
  openHour(sim, 4);
  assert.equal(view(sim, 'p1').nightSeat.peek.mode, 'off');
  assert.equal(sim.act('p1', { type: 'peek', target: 'p2' }), false);
  assert.equal(sim.legal('p1').some((a) => a.type === 'peek'), false);
});

test('cheese-thief: the fall mouse peeks like a sleepyhead', () => {
  const sim = scenario(6, { thief: 'p1', fm: 'p2', dice: { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6 }, config: { ...config.defaults(6), fallMouse: true } });
  openHour(sim, 2);
  assert.equal(view(sim, 'p2').nightSeat.peek.mode, 'can');
  assert.ok(sim.act('p2', { type: 'peek', target: 'p1' }));
  assert.deepEqual(view(sim, 'p2').nightSeat.peek.done, { target: 'p1', dice: [1] });
});

test('cheese-thief: a wake with the thief means no peek for the witness', () => {
  const sim = scenario(6, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 1, p4: 2, p5: 4, p6: 5 } });
  openHour(sim, 3);
  assert.equal(view(sim, 'p2').nightSeat.peek.mode, 'together');
  assert.equal(sim.act('p2', { type: 'peek', target: 'p4' }), false);
});

test('cheese-thief: everybody rolled the same number — all wake together, nobody can peek', () => {
  for (const n of [5, 6, 7, 8]) {
    const dice = Object.fromEntries(ids(n).map((id) => [id, 4]));
    const sim = scenario(n, { dice });
    openHour(sim, 4);
    assert.equal(awakeCount(sim), n);
    for (const id of ids(n)) {
      assert.ok(!sim.legal(id).some((a) => a.type === 'peek'));
      assert.equal(view(sim, id).nightSeat.with.length, n - 1);
    }
    assert.equal(sim.state.cheese.by, 'p1');
    for (const id of ids(n).filter((x) => x !== 'p1')) assert.equal(view(sim, id).nightSeat.thief, 'p1');
    if (n === 5) {
      assert.deepEqual(sim.state.pending.among.length, 4, '5p still asks the thief to pick among four witnesses');
      assert.equal(sim.state.followers.length, 0);
    } else {
      assert.equal(sim.state.followers.length, 0, 'no automatic followers in 6-8p');
    }
    finishNight(sim);
    assert.equal(sim.state.followers.length, n === 5 ? 1 : n === 6 ? 1 : 2);
  }
});

function awakeCount(sim) {
  return ids(sim.state.n).filter((id) => view(sim, id).nightSeat?.awake).length;
}

test('cheese-thief: hours with nobody are skipped quietly but still exist', () => {
  const sim = scenario(5, { dice: { p1: 1, p2: 1, p3: 1, p4: 1, p5: 1 } });
  openHour(sim, 4);
  assert.equal(awakeCount(sim), 0);
  assert.equal(sim.state.stage, 'window');
  assert.ok(sim.state.deadline > sim.now);
  assert.equal(sim.state.cheese.gone, true);
});

// ============================================================
// recruitment
// ============================================================

test('cheese-thief: 5p — the thief alone means no follower', () => {
  const sim = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 1, p3: 2, p4: 4, p5: 5 } });
  openHour(sim, 3);
  assert.equal(sim.state.pending, null);
  finishNight(sim);
  assert.deepEqual(sim.state.followers, []);
  assert.equal(view(sim, 'p2').my.follower, false);
});

test('cheese-thief: 5p — exactly one witness becomes the follower with no choice', () => {
  const sim = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 2, p4: 4, p5: 5 } });
  openHour(sim, 3);
  assert.deepEqual(sim.state.followers, ['p2']);
  assert.equal(sim.state.pending, null);
  assert.equal(view(sim, 'p2').my.follower, true);
  assert.equal(view(sim, 'p2').nightSeat.thief, 'p1');
  assert.equal(view(sim, 'p1').my.follower, false);
  const note = view(sim, 'p2').notes.find((x) => x.k === 'follower');
  assert.deepEqual(note, { k: 'follower', h: 3, thief: 'p1', mates: [] });
  assert.deepEqual(view(sim, 'p1').notes.find((x) => x.k === 'recruited').followers, ['p2']);
  assert.equal(view(sim, 'p3').my.follower, false);
  assert.equal(sim.act('p1', { type: 'recruit', targets: ['p3'] }), false, 'nothing left to pick');
});

test('cheese-thief: 5p — with two or more witnesses the thief must pick exactly one of them', () => {
  const sim = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 3, p4: 4, p5: 5 } });
  openHour(sim, 3);
  assert.deepEqual(sim.state.followers, []);
  assert.deepEqual(view(sim, 'p1').nightSeat.recruit, { count: 1, among: ['p2', 'p3'] });
  assert.equal(view(sim, 'p2').nightSeat.recruit, null);
  assert.equal(sim.act('p2', { type: 'recruit', targets: ['p3'] }), false, 'only the thief picks');
  assert.equal(sim.act('p1', { type: 'recruit', targets: ['p4'] }), false, 'non-witness');
  assert.equal(sim.act('p1', { type: 'recruit', targets: ['p1'] }), false, 'not itself');
  assert.equal(sim.act('p1', { type: 'recruit', targets: ['p2', 'p3'] }), false, 'exactly one');
  assert.equal(sim.act('p1', { type: 'recruit', targets: [] }), false, 'passing is illegal');
  assert.equal(sim.act('p1', { type: 'recruit', targets: 'p2' }), false);
  assert.ok(sim.act('p1', { type: 'recruit', targets: ['p3'] }));
  assert.deepEqual(sim.state.followers, ['p3']);
  assert.equal(view(sim, 'p3').my.follower, true);
  assert.equal(view(sim, 'p2').my.follower, false, 'unpicked witness stays a sleepyhead');
  assert.equal(view(sim, 'p2').nightSeat.picked, 'p3', 'but they saw the pointing');
  assert.equal(view(sim, 'p2').nightSeat.thief, 'p1', 'and know who the thief is');
  assert.equal(sim.act('p1', { type: 'recruit', targets: ['p2'] }), false, 'no second pick');
  assert.deepEqual(sim.state.followers, ['p3']);
});

test('cheese-thief: 5p — an unmade pick is made for the thief when the window closes', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const sim = scenario(5, { seed, thief: 'p1', dice: { p1: 3, p2: 3, p3: 3, p4: 3, p5: 5 } });
    openHour(sim, 3);
    assert.equal(sim.state.pending.count, 1);
    sim.advance();
    assert.equal(sim.state.followers.length, 1);
    assert.ok(['p2', 'p3', 'p4'].includes(sim.state.followers[0]));
    seen.add(sim.state.followers[0]);
  }
  assert.ok(seen.size >= 2, 'random among the witnesses');
});

test('cheese-thief: 6/7/8p — no automatic followers during the hours, even for witnesses', () => {
  for (const n of [6, 7, 8]) {
    const dice = { p1: 3, p2: 3, p3: 3, p4: 1, p5: 2, p6: 4, p7: 5, p8: 6 };
    const sim = scenario(n, { dice });
    openHour(sim, 3);
    assert.deepEqual(sim.state.followers, []);
    assert.equal(sim.state.pending, null);
    assert.equal(view(sim, 'p2').my.follower, false);
  }
});

test('cheese-thief: 6p — thief picks one, both then know each other', () => {
  const sim = scenario(6, { thief: 'p1', dice: { p1: 3, p2: 1, p3: 2, p4: 4, p5: 5, p6: 6 } });
  runTo(sim, stepIndex(sim, 'rec-pick'), 'window');
  assert.deepEqual(sorted(awakeIds(sim)), ['p1']);
  assert.deepEqual(view(sim, 'p1').nightSeat.recruit, { count: 1, among: ['p2', 'p3', 'p4', 'p5', 'p6'] });
  assert.equal(view(sim, 'p2').nightSeat.awake, false);
  assert.equal(sim.act('p1', { type: 'recruit', targets: ['p1'] }), false);
  assert.equal(sim.act('p1', { type: 'recruit', targets: ['p2', 'p3'] }), false, '6p picks exactly one');
  assert.equal(sim.act('p2', { type: 'recruit', targets: ['p3'] }), false);
  assert.ok(sim.act('p1', { type: 'recruit', targets: ['p5'] }));
  assert.equal(view(sim, 'p5').my.follower, false, 'told only at the meeting');
  runTo(sim, stepIndex(sim, 'rec-meet'), 'window');
  assert.deepEqual(sorted(awakeIds(sim)), ['p1', 'p5']);
  assert.deepEqual(view(sim, 'p5').nightSeat.meet, { thief: 'p1', mates: [] });
  assert.deepEqual(view(sim, 'p1').nightSeat.meet, { thief: null, mates: ['p5'] });
  assert.equal(view(sim, 'p5').my.follower, true);
  assert.equal(view(sim, 'p3').nightSeat.awake, false);
});

function awakeIds(sim) { return ids(sim.state.n).filter((id) => view(sim, id).nightSeat?.awake); }

test('cheese-thief: 7p — two followers who know each other but not the thief', () => {
  const sim = scenario(7, { thief: 'p1', dice: { p1: 3, p2: 1, p3: 2, p4: 4, p5: 5, p6: 6, p7: 1 } });
  runTo(sim, stepIndex(sim, 'rec-pick'), 'window');
  assert.equal(view(sim, 'p1').nightSeat.recruit.count, 2);
  assert.equal(sim.act('p1', { type: 'recruit', targets: ['p2'] }), false, 'two needed');
  assert.equal(sim.act('p1', { type: 'recruit', targets: ['p2', 'p2'] }), false, 'distinct');
  assert.equal(sim.act('p1', { type: 'recruit', targets: ['p2', 'p1'] }), false, 'not the thief');
  assert.ok(sim.act('p1', { type: 'recruit', targets: ['p6', 'p3'] }));
  runTo(sim, stepIndex(sim, 'rec-tclose'), 'window');
  assert.deepEqual(awakeIds(sim), [], 'thief has closed its eyes');
  runTo(sim, stepIndex(sim, 'rec-meet'), 'window');
  assert.deepEqual(sorted(awakeIds(sim)), ['p3', 'p6'], 'only the followers open their eyes');
  assert.deepEqual(view(sim, 'p3').nightSeat.meet, { thief: null, mates: ['p6'] });
  assert.deepEqual(view(sim, 'p6').nightSeat.meet, { thief: null, mates: ['p3'] });
  assert.equal(view(sim, 'p1').nightSeat.awake, false);
  for (const f of ['p3', 'p6']) {
    const note = view(sim, f).notes.find((x) => x.k === 'follower');
    assert.equal(note.thief, null, '7p followers do not learn the thief');
  }
  assert.deepEqual(sorted(view(sim, 'p1').notes.find((x) => x.k === 'recruited').followers), ['p3', 'p6'], 'the thief knows both');
});

test('cheese-thief: 8p — three people who all know each other', () => {
  const sim = scenario(8, { thief: 'p1', dice: { p1: 3, p2: 1, p3: 2, p4: 4, p5: 5, p6: 6, p7: 1, p8: 2 } });
  runTo(sim, stepIndex(sim, 'rec-pick'), 'window');
  assert.ok(sim.act('p1', { type: 'recruit', targets: ['p8', 'p4'] }));
  runTo(sim, stepIndex(sim, 'rec-meet'), 'window');
  assert.deepEqual(sorted(awakeIds(sim)), ['p1', 'p4', 'p8']);
  assert.deepEqual(view(sim, 'p4').nightSeat.meet, { thief: 'p1', mates: ['p8'] });
  assert.deepEqual(view(sim, 'p8').nightSeat.meet, { thief: 'p1', mates: ['p4'] });
  assert.deepEqual(sorted(view(sim, 'p1').nightSeat.meet.mates), ['p4', 'p8']);
});

test('cheese-thief: the thief may recruit the fall mouse or someone who never woke with it; a missed pick is made at window end', () => {
  const cfg = { ...config.defaults(7), fallMouse: true };
  const sim = scenario(7, { thief: 'p1', fm: 'p2', dice: { p1: 3, p2: 1, p3: 2, p4: 4, p5: 5, p6: 6, p7: 1 }, config: cfg });
  runTo(sim, stepIndex(sim, 'rec-pick'), 'window');
  assert.ok(sim.act('p1', { type: 'recruit', targets: ['p2', 'p4'] }));
  assert.deepEqual(sim.state.followers, ['p2', 'p4']);
  assert.equal(sim.state.role.p2, 'fall-mouse', 'keeps its card for the reveal');

  for (const n of [6, 7, 8]) {
    const s2 = scenario(n, { seed: 11, thief: 'p1' });
    runTo(s2, stepIndex(s2, 'rec-pick'), 'window');
    s2.advance();   // the thief did nothing
    assert.equal(s2.state.followers.length, n === 6 ? 1 : 2);
    assert.ok(!s2.state.followers.includes('p1'));
    assert.equal(new Set(s2.state.followers).size, s2.state.followers.length);
  }
});

test('cheese-thief: a lone fall mouse who was recruited is still a follower for knowledge, not for winning', () => {
  const cfg = { ...config.defaults(6), fallMouse: true };
  const sim = scenario(6, { thief: 'p1', fm: 'p2', dice: { p1: 3, p2: 1, p3: 2, p4: 4, p5: 5, p6: 6 }, config: cfg });
  runTo(sim, stepIndex(sim, 'rec-pick'), 'window');
  sim.act('p1', { type: 'recruit', targets: ['p2'] });
  finishNight(sim);
  assert.equal(view(sim, 'p2').my.follower, true);
  assert.equal(view(sim, 'p2').my.role, 'fall-mouse');
});

// ============================================================
// 4 players
// ============================================================

test('cheese-thief: 4p — thief wakes at both of its numbers and may pick which time to steal', () => {
  const sim = scenario(4, { thief: 'p1', dice: { p1: [2, 5], p2: 1, p3: 2, p4: 5 } });
  assert.deepEqual(sim.state.wake.p1, [2, 5]);
  assert.deepEqual(sim.state.wake.p3, [2], 'sleepyheads wake once');
  openHour(sim, 2);
  assert.equal(sim.state.cheese.gone, false, 'not forced at the first wake');
  assert.deepEqual(view(sim, 'p1').nightSeat.steal, { can: true, twoWakes: true });
  assert.equal(view(sim, 'p3').nightSeat.thief, null);
  assert.equal(sim.act('p3', { type: 'steal' }), false);
  // wait, then steal at the second wake
  sim.advance();
  openHour(sim, 5);
  assert.equal(sim.state.cheese.gone, true, 'forced at its last wake');
  assert.equal(sim.state.cheese.hour, 5);
  assert.equal(view(sim, 'p4').nightSeat.thief, 'p1');
  assert.deepEqual(sim.state.followers, [], 'no followers in 4p');
});

test('cheese-thief: 4p — stealing at the first wake leaves nothing to steal at the second', () => {
  const sim = scenario(4, { thief: 'p1', dice: { p1: [2, 5], p2: 1, p3: 2, p4: 5 } });
  openHour(sim, 2);
  assert.ok(sim.act('p1', { type: 'steal' }));
  assert.equal(sim.state.cheese.hour, 2);
  assert.equal(view(sim, 'p3').nightSeat.thief, 'p1', 'a co-waker sees it happen');
  assert.equal(view(sim, 'p3').notes.find((x) => x.k === 'woke').thief, 'p1', 'and the recap says so');
  assert.equal(sim.act('p1', { type: 'steal' }), false, 'only once');
  openHour(sim, 5);
  const v = view(sim, 'p1').nightSeat;
  assert.equal(v.cheese, 'gone');
  assert.equal(v.steal.can, false);
  assert.equal(view(sim, 'p4').nightSeat.thief, null, 'a later waker is not told who');
  assert.equal(sim.state.cheese.hour, 2, 'the theft hour never moves');
});

test('cheese-thief: 4p — equal dice mean one wake, forced steal', () => {
  const sim = scenario(4, { thief: 'p1', dice: { p1: [3, 3], p2: 1, p3: 2, p4: 5 } });
  assert.deepEqual(sim.state.wake.p1, [3]);
  openHour(sim, 3);
  assert.equal(sim.state.cheese.gone, true);
  assert.deepEqual(view(sim, 'p1').nightSeat.steal, { can: false, twoWakes: false });
});

test('cheese-thief: 4p — sleepyhead wakes at the die it chose, not the other one', () => {
  const sim = scenario(4, { thief: 'p1', dice: { p1: [1, 1], p2: [2, 6], p3: 3, p4: 4 }, pick4: { p2: 6 } });
  assert.deepEqual(sim.state.wake.p2, [6]);
  openHour(sim, 2);
  assert.equal(view(sim, 'p2').nightSeat.awake, false);
  openHour(sim, 6);
  assert.equal(view(sim, 'p2').nightSeat.awake, true);
});

test('cheese-thief: 4p — the lone sleepyhead gets no peek by default; the option switches it on', () => {
  const dice = { p1: [1, 1], p2: 2, p3: 3, p4: 4 };
  const off = scenario(4, { thief: 'p1', dice });
  openHour(off, 2);
  assert.equal(view(off, 'p2').nightSeat.peek.mode, 'off');
  assert.equal(off.act('p2', { type: 'peek', target: 'p3' }), false);

  const on = scenario(4, { thief: 'p1', dice, config: { ...config.defaults(4), peek4: true } });
  openHour(on, 2);
  assert.equal(view(on, 'p2').nightSeat.peek.mode, 'can');
  assert.ok(on.act('p2', { type: 'peek', target: 'p3' }));
  assert.deepEqual(view(on, 'p2').nightSeat.peek.done, { target: 'p3', dice: [3, 3] }, 'both dice under the cup');
});

// ============================================================
// day and vote
// ============================================================

test('cheese-thief: discussion ends on the timer, when everyone is ready, or when the host skips', () => {
  const mk = (cfg) => { const s = scenario(5, { config: { ...config.defaults(5), ...cfg } }); finishNight(s); return s; };
  const a = mk({ discussSec: 120 });
  assert.equal(a.state.deadline, a.now + 120000);
  assert.equal(view(a, 'p1').deadline, a.state.deadline);
  a.advance();
  assert.equal(a.state.phase, 'vote');

  const b = mk({ discussSec: 0 });
  assert.equal(b.state.deadline, null);
  assert.equal(view(b, 'p1').deadline, undefined);
  for (const id of ids(5).slice(0, 4)) b.act(id, { type: 'day-ready', on: true });
  assert.equal(b.state.phase, 'day');
  assert.equal(view(b, 'p1').dayReady.done, 4);
  b.act('p1', { type: 'day-ready', on: false });
  assert.equal(view(b, 'p1').dayReady.done, 3);
  assert.equal(view(b, 'p1').dayReady.mine, false);
  b.act('p1', { type: 'day-ready', on: true });
  b.act('p5', { type: 'day-ready', on: true });
  assert.equal(b.state.phase, 'vote');

  const c = mk({ discussSec: 0 });
  assert.ok(c.host({ type: ACT.NEXT }));
  assert.equal(c.state.phase, 'vote');
});

test('cheese-thief: voting — never for yourself, never an unknown seat, change until the last vote lands', () => {
  const sim = scenario(5);
  toVote(sim);
  assert.deepEqual(view(sim, 'p1').candidates, ['p2', 'p3', 'p4', 'p5']);
  assert.equal(sim.act('p1', { type: 'vote', target: 'p1' }), false);
  assert.equal(sim.act('p1', { type: 'vote', target: 'nobody' }), false);
  assert.equal(sim.act('p1', { type: 'vote' }), false);
  assert.equal('myVote' in view(sim, 'p1'), false, 'not voted yet');
  assert.ok(sim.act('p1', { type: 'vote', target: 'p2' }));
  assert.equal(view(sim, 'p1').myVote, 'p2');
  assert.equal(view(sim, 'p2').progress.done, 1);
  assert.equal(sim.legal('p1').some((a) => a.target === 'p2'), false, 'the current pick is not offered again');
  assert.ok(sim.act('p1', { type: 'vote', target: 'p3' }), 'a mis-tap can be corrected');
  assert.equal(sim.state.votes.p1, 'p3');
  assert.equal(sim.state.phase, 'vote');
  // nobody sees how anyone else voted
  assert.equal('votes' in view(sim, 'p2'), false);
  assert.equal(JSON.stringify(view(sim, 'p2')).includes('"p3"'), true);   // candidate list only
  assert.equal(view(sim, 'p2').reveal, undefined);
  for (const id of ['p2', 'p3', 'p4', 'p5']) sim.act(id, { type: 'vote', target: 'p1' });
  assert.equal(sim.state.phase, 'reveal');
  assert.equal(sim.act('p1', { type: 'vote', target: 'p4' }), false, 'nothing changes after the reveal');
});

test('cheese-thief: reveal publishes the tally, who pointed at whom, and the top cards — then the result', () => {
  const sim = scenario(5, { thief: 'p1' });
  toVote(sim);
  castVotes(sim, { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p2', p5: 'p2' });
  const v = view(sim, 'p4');
  assert.equal(v.phase, 'reveal');
  assert.deepEqual(v.reveal.counts, { p1: 2, p2: 3 });
  assert.deepEqual(v.reveal.top, ['p2']);
  assert.deepEqual(v.revealed, [{ pid: 'p2', role: 'sleepyhead' }]);
  assert.equal(v.reveal.votes.p3, 'p1');
  assert.equal(sim.result(), null, 'result waits for the reveal to land');
  assert.ok(sim.state.deadline > sim.now);
  assert.equal(sim.host({ type: ACT.NEXT }), true);
  assert.equal(sim.state.phase, 'over');
  const r = sim.result();
  assert.deepEqual(r.winners, ['p1']);
});

// ----- the truth table (docs/research/cheese-thief.md, "Voting & resolution") -----

function verdict(n, { thief = 'p1', fm = null, followers = [], votes, config: cfg }) {
  const sim = scenario(n, { thief, fm, config: cfg });
  toVote(sim);
  sim.state.followers = followers.slice();     // white-box: decide who the followers were
  castVotes(sim, votes);
  sim.advance();
  return sim.result();
}

test('cheese-thief: truth table, 5-8p, no fall mouse', () => {
  // p1 thief, p2 follower, p3..p6 sleepyheads (n = 6)
  const f = ['p2'];
  const w = (r) => sorted(r.winners);
  const sleepy = ['p3', 'p4', 'p5', 'p6'];
  // thief alone on top → sleepyheads (the follower loses with the thief)
  assert.deepEqual(w(verdict(6, { followers: f, votes: { p2: 'p1', p3: 'p1', p4: 'p1', p5: 'p2', p6: 'p3', p1: 'p2' } })), sleepy);
  // thief tied with a sleepyhead → sleepyheads
  assert.deepEqual(w(verdict(6, { followers: f, votes: { p1: 'p3', p2: 'p1', p3: 'p1', p4: 'p3', p5: 'p3', p6: 'p1' } })), sleepy);
  assert.deepEqual(w(verdict(6, { followers: f, votes: { p1: 'p3', p2: 'p1', p3: 'p1', p4: 'p1', p5: 'p3', p6: 'p3' } })), sleepy);
  // thief tied with the follower → sleepyheads (designer ruling)
  assert.deepEqual(w(verdict(6, { followers: f, votes: { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p2', p5: 'p1', p6: 'p2' } })), sleepy);
  // follower alone on top → thief team
  assert.deepEqual(w(verdict(6, { followers: f, votes: { p1: 'p2', p3: 'p2', p4: 'p2', p5: 'p3', p6: 'p2', p2: 'p3' } })), ['p1', 'p2']);
  // a sleepyhead alone on top → thief team
  assert.deepEqual(w(verdict(6, { followers: f, votes: { p1: 'p3', p2: 'p3', p3: 'p4', p4: 'p3', p5: 'p3', p6: 'p3' } })), ['p1', 'p2']);
  // follower and a sleepyhead tied, no thief → thief team
  assert.deepEqual(w(verdict(6, { followers: f, votes: { p1: 'p2', p2: 'p3', p3: 'p2', p4: 'p3', p5: 'p2', p6: 'p3' } })), ['p1', 'p2']);
  // everyone on exactly one vote: the thief is in the top set → sleepyheads
  assert.deepEqual(w(verdict(6, { followers: f, votes: { p1: 'p2', p2: 'p3', p3: 'p4', p4: 'p5', p5: 'p6', p6: 'p1' } })), sleepy);
  // no follower at all
  assert.deepEqual(w(verdict(5, { followers: [], votes: { p1: 'p2', p2: 'p3', p3: 'p1', p4: 'p3', p5: 'p3' } })), ['p1']);
});

test('cheese-thief: truth table — fall mouse', () => {
  const cfg = { ...config.defaults(6), fallMouse: true };
  const w = (r) => sorted(r.winners);
  // FM alone on top → FM alone
  assert.deepEqual(w(verdict(6, { fm: 'p2', config: cfg, votes: { p1: 'p2', p3: 'p2', p4: 'p2', p5: 'p3', p6: 'p4', p2: 'p3' } })), ['p2']);
  // FM tied with the thief → FM alone (designer example)
  assert.deepEqual(w(verdict(6, { fm: 'p2', config: cfg, votes: { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p2', p5: 'p1', p6: 'p2' } })), ['p2']);
  // FM tied with a sleepyhead → FM alone
  assert.deepEqual(w(verdict(6, { fm: 'p2', config: cfg, votes: { p1: 'p3', p2: 'p3', p3: 'p2', p4: 'p2', p5: 'p3', p6: 'p2' } })), ['p2']);
  // FM recruited, thief on top, FM not → sleepyheads win, FM loses
  const r = verdict(6, { fm: 'p2', followers: ['p2'], config: cfg, votes: { p1: 'p3', p2: 'p1', p3: 'p1', p4: 'p1', p5: 'p3', p6: 'p4' } });
  assert.deepEqual(w(r), ['p3', 'p4', 'p5', 'p6']);
  assert.equal(r.points.p2, 0);
  // FM not top, thief not top, FM recruited → thief team without the FM
  const r2 = verdict(6, { fm: 'p2', followers: ['p2'], config: cfg, votes: { p1: 'p3', p2: 'p3', p3: 'p4', p4: 'p3', p5: 'p3', p6: 'p3' } });
  assert.deepEqual(w(r2), ['p1']);
  // FM not top, thief on top, FM not recruited → FM loses
  const r3 = verdict(6, { fm: 'p2', config: cfg, votes: { p1: 'p3', p2: 'p1', p3: 'p1', p4: 'p1', p5: 'p1', p6: 'p3' } });
  assert.ok(!r3.winners.includes('p2'));
  assert.deepEqual(w(r3), ['p3', 'p4', 'p5', 'p6']);
});

test('cheese-thief: truth table — 4 players (a tie that includes the thief is a thief win)', () => {
  const w = (r) => sorted(r.winners);
  // thief alone → sleepyheads
  assert.deepEqual(w(verdict(4, { votes: { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p1' } })), ['p2', 'p3', 'p4']);
  // thief tied with someone → thief
  assert.deepEqual(w(verdict(4, { votes: { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p2' } })), ['p1']);
  // everyone on one vote (thief included) → thief (|H| > 1)
  assert.deepEqual(w(verdict(4, { votes: { p1: 'p2', p2: 'p3', p3: 'p4', p4: 'p1' } })), ['p1']);
  // thief not in the top set → thief
  assert.deepEqual(w(verdict(4, { votes: { p1: 'p2', p2: 'p3', p3: 'p2', p4: 'p2' } })), ['p1']);
});

test('cheese-thief: judge() agrees with the research table on a brute-force sweep', () => {
  // Re-derive the verdict independently of judge() and compare on random tallies.
  const rng = mulberry32(2024);
  for (let i = 0; i < 4000; i++) {
    const n = [4, 5, 6, 7, 8][Math.floor(rng() * 5)];
    const order = ids(n);
    const roles = Object.fromEntries(order.map((p) => [p, 'sleepyhead']));
    const thief = order[Math.floor(rng() * n)];
    roles[thief] = 'thief';
    let fm = null;
    if (n >= 6 && rng() < 0.5) { fm = order.find((p) => p !== thief && rng() < 0.4) ?? order.find((p) => p !== thief); roles[fm] = 'fall-mouse'; }
    const nf = n === 4 ? 0 : n === 5 ? Math.floor(rng() * 2) : n === 6 ? 1 : 2;
    const followers = order.filter((p) => p !== thief).sort(() => rng() - 0.5).slice(0, nf);
    const top = order.filter(() => rng() < 0.4);
    if (!top.length) top.push(order[0]);

    let expected;
    if (fm && top.includes(fm)) expected = [fm];
    else if (top.includes(thief)) {
      expected = n === 4 && top.length > 1 ? [thief]
        : order.filter((p) => roles[p] === 'sleepyhead' && !followers.includes(p));
    } else expected = order.filter((p) => p === thief || (followers.includes(p) && p !== fm));
    const got = judge({ n, thief, fallMouse: fm, followers, roles, order, top }).winners;
    assert.deepEqual(sorted(got), sorted(expected));
  }
});

test('cheese-thief: result lines explain why, in Cantonese, and points follow the app convention', () => {
  const r = verdict(6, { followers: ['p2'], votes: { p2: 'p1', p3: 'p1', p4: 'p1', p5: 'p2', p6: 'p3', p1: 'p2' } });
  assert.match(r.summary, /貪瞓鼠贏/);
  assert.ok(r.lines.some((l) => l.includes('最高票')));
  assert.ok(r.lines.some((l) => l.includes('大盜 玩家1')));
  assert.ok(r.lines.some((l) => l.includes('共犯')));
  assert.ok(r.lines.some((l) => l.includes('芝士喺')));
  assert.equal(r.lines.filter((l) => l.includes('骰')).length >= 6, true, 'a debrief line per player');
  for (const w of r.winners) assert.equal(r.points[w], 1);
  assert.equal(r.points.p1, 0);
  assert.equal(r.points.p2, 0);

  const t = verdict(6, { followers: ['p2'], votes: { p1: 'p3', p2: 'p3', p3: 'p4', p4: 'p3', p5: 'p3', p6: 'p3' } });
  assert.match(t.summary, /大盜隊贏/);
  assert.equal(t.points.p1, 2);
  assert.equal(t.points.p2, 1);

  const cfg = { ...config.defaults(6), fallMouse: true };
  const f = verdict(6, { fm: 'p2', config: cfg, votes: { p1: 'p2', p3: 'p2', p4: 'p2', p5: 'p3', p6: 'p4', p2: 'p3' } });
  assert.match(f.summary, /背鍋鼠/);
  assert.equal(f.points.p2, 3);

  const four = verdict(4, { votes: { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p2' } });
  assert.ok(four.lines.some((l) => l.includes('4 人局')));
});

// ============================================================
// information boundary
// ============================================================

/** Everything seat `A` may legitimately know about the thief, per the knowledge table. */
function knowsThief(s, A) {
  if (s.role[A] === 'thief') return true;
  if (s.cheese.gone && s.wake[A] && s.wake[A].includes(s.cheese.hour)) return true;   // watched the theft
  if (s.informed.includes(A) && s.n !== 7) return true;                              // followers, except 7p
  return false;
}

function leakCheck(sim) {
  const s = sim.state;
  const all = ids(s.n);
  const thief = all.find((p) => s.role[p] === 'thief');
  const open = s.phase === 'reveal' || s.phase === 'over';

  for (const A of [...all, null]) {
    const v = sim.view(A);
    assert.equal(v.seat, A, 'view.seat');
    assert.equal(v.phase, s.phase);
    const json = JSON.stringify(v);
    for (const bad of ['"roles"', '"pick4"', '"peeked"', '"pending"', '"followers"', '"informed"', '"final"', '"gid"']) {
      if (bad === '"followers"') continue;   // allowed inside the thief's own notes, checked below
      assert.ok(!json.includes(bad), `${bad} leaked into ${A}'s view`);
    }

    // role ids: only my own card (or, after the vote, what the table has seen)
    const rolePaths = paths(v, (x) => x === 'thief' || x === 'sleepyhead' || x === 'fall-mouse');
    for (const p of rolePaths) {
      if (open && (p.startsWith('$.revealed.') || p.startsWith('$.debrief.'))) continue;
      assert.equal(p, '$.my.role', `role id at ${p} in ${A}'s view`);
    }
    if (A && !open) assert.equal(v.my.role, s.role[A]);
    if (A === null) assert.ok(!('my' in v) && !('notes' in v));

    // dice: own, a peek you made, or the debrief
    const diceKeys = [];
    const walk = (o, base) => {
      if (o && typeof o === 'object') for (const [k, x] of Object.entries(o)) {
        if (k === 'dice' || k === 'wake') diceKeys.push(`${base}.${k}`);
        walk(x, `${base}.${k}`);
      }
    };
    walk(v, '$');
    for (const p of diceKeys) {
      const ok = p === '$.my.dice' || p === '$.my.wake' || p === '$.nightSeat.peek.done.dice'
        || /^\$\.notes\.\d+\.dice$/.test(p) || (s.phase === 'over' && p.startsWith('$.debrief.'));
      assert.ok(ok, `dice/wake leaked at ${p} in ${A}'s view`);
    }
    if (A) {
      assert.deepEqual(v.my.dice, s.dice[A], 'own dice');
      const done = v.nightSeat?.peek?.done;
      if (done) {
        assert.equal(s.peeked[A].target, done.target);
        assert.deepEqual(done.dice, s.dice[done.target]);
      }
      for (const note of v.notes ?? []) if (note.k === 'peek') {
        assert.deepEqual(note.dice, s.dice[note.target]);
        assert.equal(s.peeked[A].target, note.target);
      }
    }

    // the thief's identity
    const claims = [];
    if (A && s.phase !== 'roll') {
      if (v.nightSeat?.thief) claims.push(v.nightSeat.thief);
      if (v.nightSeat?.meet?.thief) claims.push(v.nightSeat.meet.thief);
      for (const note of v.notes ?? []) if (note.thief) claims.push(note.thief);
    }
    for (const c of claims) {
      assert.equal(c, thief, 'a seat only ever "knows" the real thief');
      assert.ok(knowsThief(s, A), `${A} was told who the thief is without earning it`);
    }

    // followers: only the thief, or a follower, or a witness of a 5p pick
    if (A && s.phase !== 'roll') {
      const names = [];
      if (v.nightSeat?.picked) names.push(v.nightSeat.picked);
      for (const x of v.nightSeat?.recruited ?? []) names.push(x);
      for (const x of v.nightSeat?.meet?.mates ?? []) names.push(x);
      for (const note of v.notes ?? []) {
        for (const x of note.followers ?? []) names.push(x);
        for (const x of note.mates ?? []) names.push(x);
        if (note.picked) names.push(note.picked);
      }
      for (const f of names) assert.ok(s.followers.includes(f), 'only real followers are named');
      if (names.length && A !== thief) {
        const sawPick = s.n === 5 && s.wake[A].includes(s.recruitHour);
        assert.ok(s.informed.includes(A) || sawPick, `${A} learned about followers without earning it`);
      }
      if (!s.informed.includes(A)) assert.equal(v.my.follower, false);
    }

    // night: a sleeper sees nothing; the awake see exactly who shares the step
    if (A && s.phase === 'night') {
      if (!v.nightSeat.awake) assert.deepEqual(v.nightSeat, { awake: false });
      else {
        const co = all.filter((p) => p !== A && sim.view(p).nightSeat.awake);
        assert.deepEqual(sorted(v.nightSeat.with), sorted(co), 'with = the others awake right now');
      }
    }
    if (A && (s.phase === 'night' || s.phase === 'roll')) assert.ok(!('votes' in v));
    if (s.phase === 'vote' || s.phase === 'day') assert.ok(!('reveal' in v));
    if (s.phase === 'vote') assert.ok(!('votes' in v) && !('debrief' in v));
    if (!open) assert.ok(!('revealed' in v) && !('debrief' in v) && !('summary' in v));

    // the public part of a step says nothing about who is awake
    if (s.phase === 'night') assert.deepEqual(Object.keys(v.step).sort(), ['h', 'ix', 'k', 'stage', 'total']);
  }
}

test('cheese-thief: leak check on scripted scenarios, every step', () => {
  const dice = { p1: 3, p2: 3, p3: 5, p4: 3, p5: 1, p6: 6, p7: 2, p8: 2 };
  for (const n of [5, 6, 7, 8]) {
    const sim = scenario(n, { dice });
    leakCheck(sim);
    for (let guard = 0; guard < 600 && sim.state.phase === 'night'; guard++) {
      if (sim.state.stage === 'cue') sim.cueDone(); else sim.advance();
      // do the legal things too
      for (const id of ids(n)) { const a = sim.legal(id).filter((x) => x.type !== 'ack')[0]; if (a) sim.act(id, a); }
      leakCheck(sim);
    }
  }
});

test('cheese-thief: leak check — peeking never changes anyone else\'s view', () => {
  const sim = scenario(7, { thief: 'p1', dice: { p1: 4, p2: 2, p3: 3, p4: 5, p5: 6, p6: 1, p7: 6 } });
  openHour(sim, 2);
  const others = ids(7).filter((x) => x !== 'p2');
  const snap = Object.fromEntries(others.map((x) => [x, JSON.stringify(view(sim, x))]));
  sim.act('p2', { type: 'peek', target: 'p4' });
  for (const x of others) {
    const a = JSON.parse(snap[x]); const b = view(sim, x);
    delete a.acks; delete b.acks;
    assert.deepEqual(b, a, `${x} noticed the peek`);
  }
});

test('cheese-thief: the table view (spectator/host screen) never carries a secret before the reveal', () => {
  const sim = scenario(6, { dice: { p1: 3, p2: 3, p3: 5, p4: 3, p5: 1, p6: 6 } });
  for (let guard = 0; guard < 400 && sim.state.phase === 'night'; guard++) {
    const t = sim.view(null);
    assert.equal(t.seat, null);
    for (const k of ['my', 'notes', 'candidates', 'myVote', 'revealed', 'debrief']) assert.ok(!(k in t), k);
    assert.deepEqual(Object.keys(t.step).sort(), ['h', 'ix', 'k', 'stage', 'total']);
    assert.ok(paths(t, (x) => x === 'thief' || x === 'sleepyhead').length === 0);
    if (sim.state.stage === 'cue') sim.cueDone(); else sim.advance();
  }
});

// ============================================================
// robustness
// ============================================================

test('cheese-thief: junk from the network never throws and never changes anything', () => {
  const junk = [
    undefined, null, {}, { type: 5 }, { type: 'peek' }, { type: 'peek', target: {} }, { type: 'recruit' },
    { type: 'recruit', targets: 'p2' }, { type: 'recruit', targets: [null] }, { type: 'vote', target: 7 },
    { type: 'choose-hour', hour: NaN }, { type: 'day-ready', on: 'maybe' }, { type: '@cue-done', id: 'x' },
    { type: '@next' }, { type: '@auto', pid: 'p1' }, { type: 'steal' }, { type: 'lock' }, { type: 'toString' },
    { type: '__proto__' }, { type: 'constructor' },
  ];
  for (const n of [4, 6]) {
    const sim = new Sim(game, { n, seed: 3 });
    for (let guard = 0; guard < 400; guard++) {
      const before = JSON.stringify(sim.state);
      for (const pid of ['p1', 'ghost', undefined, null, '@host', '__proto__']) {
        for (const a of junk) {
          // @host junk is mostly harmless but must not throw either; only compare for seat junk
          const next = engine.act(clone(sim.state), { pid, action: a }, sim.ctx());
          if (pid !== '@host' && !(a && ['@next', '@cue-done', '@auto'].includes(a.type))) {
            const harmless = a == null || !['steal', 'lock', 'day-ready'].includes(a.type) || pid !== 'p1';
            if (harmless) assert.equal(JSON.stringify(next ?? sim.state), before, `junk changed state: ${pid} ${JSON.stringify(a)}`);
          }
        }
      }
      if (sim.result()) break;
      const movers = ids(n).filter((id) => sim.legal(id).length);
      if (movers.length && sim.rng() < 0.7) { const id = movers[Math.floor(sim.rng() * movers.length)]; const o = sim.legal(id); sim.act(id, o[Math.floor(sim.rng() * o.length)]); }
      else if (sim.cue()) sim.cueDone();
      else if (sim.state.deadline != null) sim.advance();
      else sim.host({ type: ACT.NEXT });
    }
  }
});

test('cheese-thief: wrong-phase actions are refused', () => {
  const sim = new Sim(game, { n: 5, seed: 1 });
  assert.equal(sim.act('p1', { type: 'vote', target: 'p2' }), false);
  assert.equal(sim.act('p1', { type: 'peek', target: 'p2' }), false);
  assert.equal(sim.act('p1', { type: 'day-ready', on: true }), false);
  assert.equal(sim.act('p1', { type: 'ack' }), false);
  for (const id of ids(5)) sim.act(id, { type: 'ready' });
  assert.equal(sim.act('p1', { type: 'roll' }), false, 'no rolling in the night');
  assert.equal(sim.act('p1', { type: 'ready' }), false);
  assert.equal(sim.act('p1', { type: 'vote', target: 'p2' }), false);
});

test('cheese-thief: state survives a JSON round-trip at every step (snapshot / clone safe)', () => {
  const sim = new Sim(game, { n: 6, seed: 12 });
  sim.runRandom({ onStep: (x) => { assert.deepEqual(JSON.parse(JSON.stringify(x.state)), x.state); } });
});

// ============================================================
// fuzzer
// ============================================================

test('cheese-thief: fuzz — every head-count × seeds, with leak checks and result consistency', () => {
  let games = 0;
  let trades = 0;
  for (const n of COUNTS) {
    const variants = [{}];
    if (n >= 6) variants.push({ fallMouse: true });
    if (n === 4) variants.push({ peek4: true });
    variants.push({ reroll: true, discussSec: 0, hourSec: 5 });
    for (let seed = 1; seed <= 110; seed++) {
      const cfg = { ...config.defaults(n), ...variants[seed % variants.length] };
      const sim = new Sim(game, { n, seed: seed * 7 + n, config: cfg });
      const { result } = sim.runRandom({ onStep: (x) => { if (x.steps % 5 === 0 || x.state.phase !== 'night') leakCheck(x); } });
      leakCheck(sim);
      games++;

      // the verdict matches an independent recount from the final state
      const s = sim.state;
      const all = ids(n);
      const counts = {};
      for (const t of Object.values(s.votes)) counts[t] = (counts[t] || 0) + 1;
      const max = Math.max(...Object.values(counts));
      const top = all.filter((p) => counts[p] === max);
      const thief = all.find((p) => s.role[p] === 'thief');
      const fm = all.find((p) => s.role[p] === 'fall-mouse');
      let want;
      if (fm && top.includes(fm)) want = [fm];
      else if (top.includes(thief)) want = n === 4 && top.length > 1 ? [thief] : all.filter((p) => s.role[p] === 'sleepyhead' && !s.followers.includes(p));
      else want = all.filter((p) => p === thief || (s.followers.includes(p) && p !== fm));
      assert.deepEqual(sorted(result.winners), sorted(want), `n=${n} seed=${seed}`);

      // structural invariants of every finished game
      assert.equal(s.cheese.gone, true);
      assert.equal(s.followers.length, n === 4 ? 0 : n === 5 ? s.followers.length : n === 6 ? 1 : 2);
      assert.ok(n !== 5 || s.followers.length <= 1);
      assert.ok(!s.followers.includes(thief));
      for (const p of all) assert.ok(s.wake[p].length === (n === 4 && p === thief ? new Set(s.dice[p]).size : 1));
      assert.equal(Object.keys(result.points).length, n);
      trades += s.ix;
    }
  }
  assert.ok(games >= 500);
  assert.ok(trades > 0);
});

test('cheese-thief: fuzz — when five phones play, 5p followers are exactly the witnesses the thief may pick', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const sim = new Sim(game, { n: 5, seed });
    sim.runRandom();
    const s = sim.state;
    const thief = ids(5).find((p) => s.role[p] === 'thief');
    const hour = s.cheese.hour;
    const witnesses = ids(5).filter((p) => p !== thief && s.wake[p].includes(hour));
    if (witnesses.length === 0) assert.equal(s.followers.length, 0);
    else { assert.equal(s.followers.length, 1); assert.ok(witnesses.includes(s.followers[0])); }
  }
});

test('cheese-thief: fuzz — 4p thief steals exactly once, at one of its own wake hours', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const sim = new Sim(game, { n: 4, seed, config: { ...config.defaults(4), peek4: seed % 2 === 0 } });
    sim.runRandom();
    const s = sim.state;
    const thief = ids(4).find((p) => s.role[p] === 'thief');
    assert.ok(s.wake[thief].includes(s.cheese.hour));
    assert.equal(s.cheese.by, thief);
    assert.equal(s.followers.length, 0);
  }
});

test('cheese-thief: autoAct finishes any stalled seat in every phase', () => {
  for (const n of [4, 5, 8]) {
    const sim = new Sim(game, { n, seed: 77 });
    let guard = 0;
    while (!sim.result() && guard++ < 3000) {
      const s = sim.state;
      let moved = false;
      for (const id of ids(n)) {
        const a = engine.autoAct(s, id, sim.ctx());
        if (a && sim.act(id, a)) { moved = true; break; }
      }
      if (moved) continue;
      if (sim.cue()) sim.cueDone();
      else if (s.deadline != null) sim.advance();
      else sim.host({ type: ACT.NEXT });
    }
    assert.ok(sim.result(), `n=${n} finished through autoAct alone`);
  }
});

test('cheese-thief: speed — a whole 8-player game is quick enough to fuzz', () => {
  const t0 = performance.now();
  for (let seed = 1; seed <= 20; seed++) new Sim(game, { n: 8, seed }).runRandom();
  assert.ok(performance.now() - t0 < 4000);
});

// ============================================================
// phone UI (ui.js) — fake DOM, stub components, driven only by "taps"
// ============================================================

class FNode {}
class FText extends FNode {
  constructor(t) { super(); this.data = String(t); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
class FEl extends FNode {
  constructor(tag) {
    super();
    this.tag = tag; this.parentNode = null; this.children = []; this.attrs = {}; this.listeners = {};
    this.cls = new Set(); this.styleMap = {}; this.hidden = false; this.disabled = false; this.dataset = {};
    const self = this;
    this.style = new Proxy({}, {
      get: (_, k) => (k === 'setProperty' ? (n, v) => { self.styleMap[n] = String(v); } : self.styleMap[k]),
      set: (_, k, v) => { self.styleMap[k] = String(v); return true; },
    });
    this.classList = {
      add: (...c) => c.forEach((x) => self.cls.add(x)),
      remove: (...c) => c.forEach((x) => self.cls.delete(x)),
      toggle: (c, on) => { const want = on === undefined ? !self.cls.has(c) : !!on; if (want) self.cls.add(c); else self.cls.delete(c); return want; },
      contains: (c) => self.cls.has(c),
    };
  }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get childNodes() { return this.children.slice(); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(...(String(v) === '' ? [] : [new FText(v)])); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  append(...kids) { for (const k of kids) this.appendChild(k instanceof FNode ? k : new FText(k)); }
  appendChild(k) { k.parentNode?.removeChild(k); k.parentNode = this; this.children.push(k); return k; }
  removeChild(k) { const i = this.children.indexOf(k); if (i >= 0) { this.children.splice(i, 1); k.parentNode = null; } return k; }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() { this.parentNode?.removeChild(this); }
}
const fakeDocument = {
  createElement: (t) => new FEl(t),
  createTextNode: (t) => new FText(t),
  getElementById: () => null,
  head: new FEl('head'), body: new FEl('body'),
};

const walk = (n, fn) => { fn(n); if (n.children) for (const c of n.children) walk(c, fn); };
const findAll = (root, pred) => { const out = []; walk(root, (n) => { if (n instanceof FEl && pred(n)) out.push(n); }); return out; };
const hasCls = (n, c) => n.cls.has(c);
const click = (n) => {
  assert.ok(!n.disabled && !n.hidden, 'clicked a disabled/hidden control');
  for (const f of n.listeners.click ?? []) f({ preventDefault() {} });
};
const serialize = (n) => (n instanceof FText ? n.data : JSON.stringify([n.tag, [...n.cls].sort(), n.attrs, n.hidden, n.disabled, n.styleMap, n.dataset, n.children.map(serialize)]));

/** Stand-ins for the shared components: same props, same callbacks, just enough DOM. */
function stubComponents() {
  const E = (tag, cls, ...kids) => { const n = new FEl(tag); if (cls) n.className = cls; n.append(...kids); return n; };
  const dieFace = (v) => E('div', 'die', String(v));
  const Cover = (p0 = {}) => {
    const front = E('div', 'c-cover-front'); const back = E('div', 'c-cover-back'); const root = E('div', 'c-cover', front, back);
    const api = {
      el: root,
      update(p) { if (p.front && front.children[0] !== p.front) front.replaceChildren(p.front); back.textContent = p.backLabel ?? ''; api.props = p; },
      close() {},
      destroy() { root.remove(); },
    };
    api.update(p0);
    return api;
  };
  const RoleCard = (p0 = {}) => {
    const body = E('div', 'rc-body'); const lock = E('button', 'rc-lock'); const root = E('div', 'c-rolecard', body, lock);
    lock.addEventListener('click', () => api.props.onLockToggle?.());
    const api = {
      el: root,
      update(p) { api.props = p; body.textContent = p.role ? `${p.role.emoji}${p.role.name}|${p.role.text}` : 'none'; lock.textContent = p.locked ? 'locked' : 'unlocked'; },
      destroy() { root.remove(); },
    };
    api.update(p0);
    return api;
  };
  const DiceCup = (p0 = {}) => {
    const row = E('div', 'dice-row'); const roll = E('button', 'cup-roll'); const lock = E('button', 'cup-lock'); const root = E('div', 'c-dicecup', row, roll, lock);
    roll.addEventListener('click', () => { if (api.props.canRoll && !api.props.lockedRoll) api.props.onRoll?.(); });
    lock.addEventListener('click', () => { if (!api.props.lockedRoll && api.props.dice?.length) api.props.onLock?.(); });
    const api = {
      el: root,
      update(p) { api.props = p; row.replaceChildren(...(p.dice ?? []).map(dieFace)); roll.hidden = !p.canRoll; lock.hidden = !p.onLock; lock.disabled = !!p.lockedRoll || !p.dice?.length; },
      destroy() { root.remove(); },
    };
    api.update(p0);
    return api;
  };
  const VotePanel = (p0 = {}) => {
    const list = E('div', 'vp-list'); const root = E('div', 'c-votepanel', list);
    const api = {
      el: root,
      update(p) {
        api.props = p;
        list.replaceChildren(...(p.reveal ? [E('p', 'vp-reveal', JSON.stringify(p.reveal.top))]
          : (p.candidates ?? []).map((id) => { const b = E('button', 'vp-opt'); b.dataset.pid = id; b.textContent = id; b.addEventListener('click', () => p.onVote?.(id)); return b; })));
      },
      destroy() { root.remove(); },
    };
    api.update(p0);
    return api;
  };
  const Timer = (p0 = {}) => {
    const root = E('div', 'c-timer');
    const api = { el: root, update(p) { api.props = p; root.textContent = String(p.deadline); }, destroy() { root.remove(); } };
    api.update(p0);
    return api;
  };
  return { Cover, RoleCard, DiceCup, VotePanel, Timer, PlayerPicker: null, Canvas: null, dieFace };
}

async function withFakeDom(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node };
  globalThis.document = fakeDocument;
  globalThis.Node = FNode;
  try {
    return await fn(await import('../js/games/cheese-thief/ui.js'));
  } finally {
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
    if (saved.Node === undefined) delete globalThis.Node; else globalThis.Node = saved.Node;
  }
}

/** One mounted UI per seat (and one for the table), as the shell does. */
function mountAll(ui, sim, sent) {
  const comps = stubComponents();
  const seats = {};
  for (const pid of [...sim.players.map((p) => p.id), null]) {
    const root = new FEl('div');
    const api = {
      me: pid, players: sim.players, isHost: pid === 'p1', meta: game.meta, config: sim.state.cfg,
      send: (a) => { const changed = sim.act(pid, a); sent.push({ pid, a, changed }); return changed; },
      ink() {}, now: () => sim.now, sfx() {}, toast() {}, components: comps,
    };
    seats[pid ?? 'table'] = { pid, root, api, handle: ui.mount(root, api) };
  }
  return seats;
}

function pushViews(sim, seats) {
  const ctx = { focus: null, paused: false, narrationMode: 'voice' };
  for (const seat of Object.values(seats)) {
    const v = sim.view(seat.pid);
    seat.handle.update(v, ctx);
    const a = serialize(seat.root);
    seat.handle.update(clone(v), ctx);
    assert.equal(serialize(seat.root), a, `update() is not idempotent for ${seat.pid ?? 'table'} in ${v.phase}`);
  }
}

/** The big shape of a night screen: must be the same on every phone at every step. */
function nightShape(root) {
  const night = findAll(root, (n) => hasCls(n, 'ct-night'))[0];
  if (!night) return null;
  const top = night.children.map((c) => [...c.cls].filter((x) => !['is-awake', 'has-live-grid', 'is-done', 'is-action', 'is-wait'].includes(x)).join('.'));
  const grid = findAll(night, (n) => hasCls(n, 'ct-grid'))[0];
  return JSON.stringify([top, grid.children.length, night.children.find((c) => hasCls(c, 'ct-ack')).children.length]);
}

/** What a thumb would do on this seat's current screen. Returns true if it tapped something real. */
function tapSomething(seat, rng) {
  const root = seat.root;
  const vis = (n) => !n.hidden && !n.disabled;
  const btn = (cls) => findAll(root, (n) => hasCls(n, cls) && vis(n));

  const lock = btn('cup-lock')[0];
  const rollBtn = btn('cup-roll')[0];
  if (lock && (!rollBtn || rng() < 0.5)) { click(lock); return true; }
  if (rollBtn) { click(rollBtn); return true; }
  const choose = findAll(root, (n) => hasCls(n, 'ct-choose') && !n.hidden)[0];
  if (choose) {
    const opts = findAll(choose, (n) => n.tag === 'button' && vis(n));
    if (opts.length && rng() < 0.7) click(opts[Math.floor(rng() * opts.length)]);
  }
  const ready = btn('ct-ready')[0];
  if (ready) { click(ready); return true; }

  // night: pick on the live grid, then the big button
  const chips = findAll(root, (n) => hasCls(n, 'ct-chip') && vis(n));
  const ack = findAll(root, (n) => hasCls(n, 'ct-ack'))[0];
  if (ack) {
    if (chips.length) {
      const m = /揀 (\d) 位/.exec(root.textContent);
      const need = m ? +m[1] : 1;
      for (let i = 0; i < need; i++) click(chips[Math.floor(rng() * chips.length)]);
    }
    click(ack);
    return true;
  }
  const dayReady = findAll(root, (n) => n.tag === 'button' && n.textContent.includes('夠鐘投票') && !n.textContent.startsWith('✓'))[0];
  if (dayReady) { click(dayReady); return true; }
  const opt = findAll(root, (n) => hasCls(n, 'vp-opt'));
  if (opt.length) { click(opt[Math.floor(rng() * opt.length)]); return true; }
  return false;
}

test('cheese-thief ui: every phase renders for every seat, idempotently, and every screen can be finished by tapping', async () => {
  await withFakeDom(async (ui) => {
    const cases = [[4, 1, {}], [4, 2, { peek4: true }], [5, 3, {}], [6, 4, {}], [7, 5, {}], [8, 6, {}], [6, 7, { fallMouse: true }], [5, 8, { reroll: true, discussSec: 0 }]];
    for (const [n, seed, cfg] of cases) {
      const sim = new Sim(game, { n, seed, config: { ...config.defaults(n), ...cfg } });
      const sent = [];
      const seats = mountAll(ui, sim, sent);
      const rng = mulberry32(seed * 31);
      const phases = new Set();
      let guard = 0;
      while (!sim.result() && guard++ < 4000) {
        pushViews(sim, seats);
        phases.add(sim.state.phase);

        if (sim.state.phase === 'night' && sim.state.stage === 'window') {
          const shapes = new Set(sim.players.map((p) => nightShape(seats[p.id].root)));
          assert.equal(shapes.size, 1, `night screens differ in shape between seats (step ${sim.state.ix}): ${[...shapes].join(" // ")}`);
        }

        // each seat taps what its screen offers (in random order), then time moves on
        const order = sim.players.map((p) => p.id).sort(() => rng() - 0.5);
        let tapped = false;
        for (const pid of order) {
          if (sim.state.phase === 'over' || sim.state.phase === 'reveal') break;
          if (rng() < 0.6 || sim.state.phase !== 'night') {
            try { tapped = tapSomething(seats[pid], rng) || tapped; } catch (e) { throw new Error(`tap failed for ${pid} in ${sim.state.phase}: ${e.message}`); }
            pushViews(sim, { [pid]: seats[pid] });
          }
        }
        if (sim.state.phase === 'night' || sim.state.phase === 'reveal') {
          if (sim.state.phase === 'reveal') { pushViews(sim, seats); phases.add('reveal'); }
          if (sim.cue()) sim.cueDone(); else sim.advance();
        } else if (!tapped) {
          if (sim.state.deadline != null) sim.advance(); else sim.host({ type: ACT.NEXT });
        }
      }
      assert.ok(sim.result(), `n=${n}: finished by tapping alone (stuck in ${sim.state.phase} ix=${sim.state.ix} ${sim.state.stage}; last sent: ${JSON.stringify(sent.slice(-4))}; seats: ${JSON.stringify(sim.players.map((p) => [p.id, sim.state.ready[p.id], sim.state.locked[p.id], findAll(seats[p.id].root, (x) => hasCls(x, 'ct-ready')).map((b) => [b.disabled, b.hidden, b.textContent])]))})`);
      pushViews(sim, seats);
      for (const p of ['roll', 'night', 'day', 'vote', 'reveal']) assert.ok(phases.has(p), `phase ${p} was rendered (n=${n})`);

      // the UI only ever sent actions the engine accepted, apart from duplicate acks
      for (const s of sent) if (!s.changed) assert.ok(['ack', 'day-ready', 'choose-hour'].includes(s.a.type), `UI sent a refused ${JSON.stringify(s.a)} as ${s.pid}`);
      for (const seat of Object.values(seats)) seat.handle.destroy();
    }
  });
});

test('cheese-thief ui: the peek result and the recap belong to their owner alone', async () => {
  await withFakeDom(async (ui) => {
    const sim = scenario(6, { thief: 'p1', dice: { p1: 3, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6 } });
    const sent = [];
    const seats = mountAll(ui, sim, sent);
    openHour(sim, 2);
    pushViews(sim, seats);
    const text = (pid) => seats[pid].root.textContent;
    // p2 is alone at 2: picks p4 through the grid, then the big button
    const chips = findAll(seats.p2.root, (n) => hasCls(n, 'ct-chip') && !n.disabled);
    assert.equal(chips.length, 5);
    click(chips.find((c) => c.textContent === '玩家4'));
    click(findAll(seats.p2.root, (n) => hasCls(n, 'ct-ack'))[0]);
    assert.deepEqual(sent.at(-1).a, { type: 'peek', target: 'p4' });
    pushViews(sim, seats);
    assert.ok(text('p2').includes('玩家4 粒骰'), 'peeker sees the result (under a cover)');
    for (const other of ['p1', 'p3', 'p4', 'p5', 'p6']) assert.ok(!text(other).includes('玩家4 粒骰'), `${other} must not see it`);
    finishNight(sim);
    pushViews(sim, seats);
    assert.ok(text('p2').includes('你偷睇咗 玩家4'), 'recap for the peeker');
    assert.ok(!text('p3').includes('偷睇咗'), 'nobody else has a peek line');
    for (const s of Object.values(seats)) s.handle.destroy();
  });
});

test('cheese-thief ui: the thief sees its theft, witnesses are told who, and a 5p thief picks its follower from the grid', async () => {
  await withFakeDom(async (ui) => {
    const sim = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 3, p4: 4, p5: 5 } });
    const sent = [];
    const seats = mountAll(ui, sim, sent);
    openHour(sim, 3);
    pushViews(sim, seats);
    assert.ok(seats.p1.root.textContent.includes('你偷走咗芝士'));
    assert.ok(seats.p2.root.textContent.includes('玩家1 偷走咗芝士'));
    assert.ok(!seats.p4.root.textContent.includes('偷走咗芝士'));
    const chips = findAll(seats.p1.root, (n) => hasCls(n, 'ct-chip') && !n.disabled);
    assert.deepEqual(chips.map((c) => c.textContent).sort(), ['玩家2', '玩家3']);
    click(chips.find((c) => c.textContent === '玩家3'));
    click(findAll(seats.p1.root, (n) => hasCls(n, 'ct-ack'))[0]);
    assert.deepEqual(sent.at(-1).a, { type: 'recruit', targets: ['p3'] });
    pushViews(sim, seats);
    assert.ok(seats.p3.root.textContent.includes('你畀大盜揀咗做共犯'));
    assert.ok(seats.p2.root.textContent.includes('大盜揀咗 玩家3 做共犯'));
    for (const s of Object.values(seats)) s.handle.destroy();
  });
});
