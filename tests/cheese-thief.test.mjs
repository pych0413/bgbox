// ============================================================
// tests/cheese-thief.test.mjs — rules, anti-tell, leaks and a fuzzer for 芝士大盜.
//   node tests/run.mjs cheese-thief
// ============================================================

import { test, assert, Sim, paths, ACT, HOST, makePlayers } from './lib.mjs';
import * as game from '../js/games/cheese-thief/game.js';
import { judge } from '../js/games/cheese-thief/game.js';
import { mulberry32, clone, wantsNightAmbient } from '../js/core/engine-kit.js';
import { narrate, VOTE_CALL, HINT } from '../js/games/cheese-thief/script.js';

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
  // U8 (re-run N3): the night's noise bed on a whole-table phone, so an occupied hour sounds like an empty one
  assert.equal(meta.nightAmbient, true);
  assert.equal(wantsNightAmbient(meta), true);
  // the one-phone rules no longer promise a one-tap 夠鐘投票 (re-run N2)
  const onePhone = game.rules.sections.find((x) => x.title.includes('一部手機'));
  assert.ok(onePhone && onePhone.body.includes('㩒兩下') && !onePhone.body.includes('一下就得'), onePhone?.body);
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
  assert.deepEqual(engine.focus(sim.state), { pids: ['p5'], label: '睇牌・擲骰' }, 'the step name a shared phone\'s gate shows (#33)');
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
  assert.equal(new Set(prompts.map((p) => p.anonymous.replace(/[一二兩三四五六]/g, '#'))).size, 1);
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
      assert.equal(v.hint, HINT.night.sleep);
      seen.add(JSON.stringify({ n: v.nightSeat, k: Object.keys(v.my).sort(), hint: v.hint, keys: Object.keys(v).sort() }));
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
  assert.match(t8['rec-meet'], /三個/);
  for (const t of [t6, t7, t8]) {
    assert.match(t['rec-pick'], /伸一隻手/, 'everyone holds out a hand so a touch reveals nothing');
    assert.match(t['rec-pick'], /喺手機揀/, 'the thief picks on the phone as well as by touch');
    assert.match(t['rec-close'], /收返隻手/, 'and takes the hand back at the end');
  }
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
  assert.ok(r.lines.some((l) => l.includes('偷走芝士')), 'the night recap says when the cheese went');
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
    // the 💡 roles in play (re-run #5) are public: the same in every view, from the head-count and the config only
    const fm = s.cfg.fallMouse ? 1 : 0;
    assert.deepEqual(v.rolesInPlay, [{ id: 'thief', count: 1 }, { id: 'sleepyhead', count: s.n - 1 - fm },
      ...(s.n >= 5 ? ['follower'] : []), ...(fm ? [{ id: 'fall-mouse', count: 1 }] : [])]);
    for (const p of rolePaths) {
      if (p.startsWith('$.rolesInPlay.')) continue;
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
      if (v.my?.crew?.thief) claims.push(v.my.crew.thief);
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
      for (const x of v.my?.crew?.mates ?? []) names.push(x);
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
      // the role card's crew: only a told follower, or the thief once it has followers
      if (v.my.crew) assert.ok(s.informed.includes(A) || (A === thief && s.followers.length), `${A} got a crew it never earned`);
      else assert.ok(!s.informed.includes(A) && !(A === thief && s.followers.length), `${A} is missing its crew`);
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
    if (s.phase !== 'over') assert.ok(!('recap' in v), 'the night recap is published only at the end');
    assert.equal(typeof v.hint, 'string');

    // the public part of a step says nothing about who is awake: windowMs is the step kind's fixed length (#7)
    if (s.phase === 'night') {
      assert.deepEqual(Object.keys(v.step).sort(), ['h', 'ix', 'k', 'stage', 'total', 'windowMs']);
      assert.equal(v.step.windowMs, fixedWindow(s.cfg, v.step.k), `${v.step.k}: the bar's length is the step kind's`);
    }
  }
}

/** The length every window of a step kind has (docs/games/cheese-thief.md §3.2), one phone's hand-over pad included. */
function fixedWindow(cfg, k) {
  const pad = cfg.passPhone ? game.PASS_PAD_SEC * 1000 : 0;
  const hour = cfg.hourSec * 1000;
  return { begin: 3000, open: hour + pad, 'rec-pick': hour + pad, 'rec-meet': Math.max(5000, Math.round(hour / 2)) + pad, dawn: 1500 }[k] ?? 2000;
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
    assert.deepEqual(Object.keys(t.step).sort(), ['h', 'ix', 'k', 'stage', 'total', 'windowMs']);
    assert.ok(!('acks' in t), 'no tap counter on the table: on a shared phone only the awake seats tap');
    assert.ok(paths(t, (x) => x === 'thief' || x === 'sleepyhead').filter((p) => !p.startsWith('$.rolesInPlay.')).length === 0);
    assert.deepEqual(t.rolesInPlay, [{ id: 'thief', count: 1 }, { id: 'sleepyhead', count: 5 }, 'follower'], 'the 💡 roles in play: public');
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
  const covers = [];
  const CoverRec = (p0) => { const c = Cover(p0); covers.push(c); return c; };
  return { Cover: CoverRec, RoleCard, DiceCup, VotePanel, Timer, PlayerPicker: null, Canvas: null, dieFace, covers };
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
function mountAll(ui, sim, sent, { sounds = [] } = {}) {
  const comps = stubComponents();
  const seats = {};
  for (const pid of [...sim.players.map((p) => p.id), null]) {
    const root = new FEl('div');
    const api = {
      me: pid, players: sim.players, isHost: pid === 'p1', meta: game.meta, config: sim.state.cfg,
      send: (a) => { const changed = sim.act(pid, a); sent.push({ pid, a, changed }); return changed; },
      ink() {}, now: () => sim.now, sfx: (name) => sounds.push({ pid, name, phase: sim.state.phase }), toast() {}, components: comps,
    };
    seats[pid ?? 'table'] = { pid, root, api, handle: ui.mount(root, api) };
  }
  Object.defineProperty(seats, 'comps', { value: comps, enumerable: false });
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
    if (v.hint) assert.ok(!seat.root.textContent.includes(v.hint), `the 💡 hint is drawn on ${seat.pid ?? 'table'}'s screen (U1: on demand only)`);
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
    assert.equal(chips.length, 4, 'every name stays tappable (same look as a sleeper grid)');
    click(chips.find((c) => c.textContent === '玩家4'));
    assert.equal(chips.filter((c) => hasCls(c, 'on')).length, 0, 'a non-witness cannot be picked');
    click(chips.find((c) => c.textContent === '玩家3'));
    click(findAll(seats.p1.root, (n) => hasCls(n, 'ct-ack'))[0]);
    assert.deepEqual(sent.at(-1).a, { type: 'recruit', targets: ['p3'] });
    pushViews(sim, seats);
    assert.ok(seats.p3.root.textContent.includes('你畀大盜揀咗做共犯'));
    assert.ok(seats.p2.root.textContent.includes('大盜揀咗 玩家3 做共犯'));
    for (const s of Object.values(seats)) s.handle.destroy();
  });
});

// ============================================================
// QA pass 2026-10-03 UTC — verified rules, anti-tell, teaching, recap
// (docs/research/cheese-thief.md "## Verification" overrides the draft)
// ============================================================

test('cheese-thief: U1 — rules.quick is at most 6 short lines; every role says what you do and how you win', () => {
  const q = game.rules.quick;
  assert.ok(q.length >= 3 && q.length <= 6, `${q.length} quick lines`);
  for (const l of q) {
    assert.ok(!l.includes('\n'));
    assert.ok([...l].length <= 40, `quick line too long: ${l}`);
  }
  for (const r of game.rules.roles) {
    assert.match(r.text, /做乜：/, `${r.id} says what you do`);
    assert.match(r.text, /點贏：/, `${r.id} says how you win`);
    assert.ok(r.text.indexOf('做乜：') < r.text.indexOf('點贏：'));
  }
  // the official 4p no-peek rule is stated wherever the peek is offered
  assert.match(q.join(''), /4 人局唔得/);
  assert.match(game.rules.roles.find((r) => r.id === 'sleepyhead').text, /4 人局唔得/);
  assert.match(game.rules.sections.find((x) => x.title.startsWith('4 人局')).body, /官方規則：就算淨係得你醒都唔可以偷睇/);
});

test('cheese-thief: house rules (4p peek, re-roll) are off by default and labelled 家規 everywhere', () => {
  for (const n of COUNTS) {
    const d = config.defaults(n);
    assert.equal(d.peek4, false);
    assert.equal(d.pick5, false);
    assert.equal(d.reroll, false);
    assert.equal(d.fallMouse, false);
    assert.equal(d.hourSec, 10, 'official 10 s hour windows');
    for (const f of config.fields(d, n)) {
      if (f.key === 'peek4' || f.key === 'reroll' || f.key === 'pick5') { assert.match(f.label, /家規/); assert.match(f.help, /官方/); }
    }
    assert.equal(config.fields(d, n).some((f) => f.key === 'peek4'), n === 4);
    assert.equal(config.fields(d, n).some((f) => f.key === 'pick5'), n === 5);
    const on = { ...d, peek4: true, reroll: true };
    const sum = config.summary(on, n).join('\n');
    assert.match(sum, /家規：擲骰可重擲/);
    if (n === 4) assert.match(sum, /家規：4 人局都可以偷睇/);
    else assert.ok(!/偷睇/.test(sum), 'the 4p peek option says nothing outside 4p');
    assert.match(config.validate(on, n).warnings.join('\n'), /家規/);
    // a house rule that is ON always says so first (「家規：…」); by default none is on
    // (5p only mentions that the 家規 exists, so the group can pick it)
    assert.ok(!config.validate(d, n).warnings.some((w) => w.startsWith('家規')), 'no house-rule warning by default');
  }
});

test('cheese-thief: #8 — every head-count explains its set-up; lobby counts match the deal (fuzzed)', () => {
  for (const n of COUNTS) {
    const reason = config.summary(config.defaults(n), n).find((l) => l.startsWith('💬'));
    assert.ok(reason && reason.includes(`${n} 人`) && reason.includes('—'), `n=${n} has a reason line`);
  }
  const rng = mulberry32(808);
  for (let i = 0; i < 400; i++) {
    const n = 4 + Math.floor(rng() * 5);
    const prev = {
      fallMouse: rng() < 0.5, peek4: rng() < 0.5, reroll: rng() < 0.5, recap: rng() < 0.5,
      hourSec: Math.floor(rng() * 50) - 5, discussSec: Math.floor(rng() * 2200) - 100,
    };
    const cfg = config.defaults(n, prev);
    assert.equal(config.validate(cfg, n).ok, true, `defaults(${n}, ${JSON.stringify(prev)}) must be valid`);
    const m = /🧀 1 大盜 · 🐭 (\d+) 貪瞓鼠(?: · 🎭 (\d) 背鍋鼠)?/.exec(config.summary(cfg, n)[0]);
    assert.ok(m);
    const roles = Object.values(engine.setup({ players: makePlayers(n), config: cfg, rng: mulberry32(i), now: 0 }).role);
    assert.equal(roles.length, n);
    assert.equal(roles.filter((r) => r === 'thief').length, 1);
    assert.equal(roles.filter((r) => r === 'sleepyhead').length, +m[1]);
    assert.equal(roles.filter((r) => r === 'fall-mouse').length, m[2] ? +m[2] : 0);
    if (n < 6) assert.ok(!roles.includes('fall-mouse'));
    // an invalid composition is refused, never silently played
    if (n < 6) assert.equal(config.validate({ ...cfg, fallMouse: true }, n).ok, false);
  }
});

test('cheese-thief: U1 — every phase gives every seat and the table a one-line 💡 hint', () => {
  const phases = new Set();
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 5; seed++) {
      const cfg = { ...config.defaults(n), ...(n >= 6 && seed % 2 ? { fallMouse: true } : {}) };
      const sim = new Sim(game, { n, seed: seed * 13 + n, config: cfg });
      const check = (x) => {
        for (const A of [...ids(n), null]) {
          const v = x.view(A);
          assert.equal(typeof v.hint, 'string', `${v.phase} hint for ${A}`);
          assert.ok(v.hint.length >= 6 && [...v.hint].length <= 32 && !v.hint.includes('\n'), `hint "${v.hint}"`);
          phases.add(v.phase);
        }
      };
      check(sim);
      sim.runRandom({ onStep: check });
    }
  }
  assert.deepEqual([...phases].sort(), ['day', 'night', 'over', 'reveal', 'roll', 'vote']);
  // the hint follows what this seat can do right now
  const sim = scenario(6, { thief: 'p1', dice: { p1: 3, p2: 2, p3: 1, p4: 4, p5: 5, p6: 6 } });
  openHour(sim, 2);
  assert.equal(view(sim, 'p2').hint, HINT.night.peek);
  assert.equal(view(sim, 'p3').hint, HINT.night.sleep);
  openHour(sim, 3);
  assert.equal(view(sim, 'p1').hint, HINT.night.thief);
  runTo(sim, stepIndex(sim, 'rec-pick'), 'window');
  assert.equal(view(sim, 'p1').hint, HINT.night.recruit);
  assert.equal(view(sim, 'p2').hint, HINT.night.sleep, 'a sleeper hint never changes');
});

test('cheese-thief: 7p — a follower who watched the theft knows the thief; the other follower does not', () => {
  // p1 steals at three with p2 watching; p3 wakes alone at five
  const sim = scenario(7, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 5, p4: 1, p5: 2, p6: 4, p7: 6 } });
  runTo(sim, stepIndex(sim, 'rec-pick'), 'window');
  assert.ok(sim.act('p1', { type: 'recruit', targets: ['p2', 'p3'] }));
  runTo(sim, stepIndex(sim, 'rec-meet'), 'window');
  assert.deepEqual(sorted(awakeIds(sim)), ['p2', 'p3'], 'the thief still keeps its eyes shut');
  assert.deepEqual(view(sim, 'p2').nightSeat.meet, { thief: 'p1', mates: ['p3'] });
  assert.deepEqual(view(sim, 'p3').nightSeat.meet, { thief: null, mates: ['p2'] });
  leakCheck(sim);
  finishNight(sim);
  assert.equal(view(sim, 'p2').notes.find((x) => x.k === 'follower').thief, 'p1');
  assert.equal(view(sim, 'p3').notes.find((x) => x.k === 'follower').thief, null);
  leakCheck(sim);
});

/** The night as the room experiences it: every line, its silent-mode time and every window, in order. */
function nightTimeline(sim, act) {
  const out = [];
  for (let guard = 0; guard < 500 && sim.state.phase === 'night'; guard++) {
    const s = sim.state;
    const k = s.steps[s.ix];
    const tag = `${k.k}${k.h ?? ''}/${s.stage}`;
    for (const id of ids(s.n)) {
      assert.ok(sim.legal(id).some((a) => a.type === 'ack'), `${id} has no decoy to tap at ${tag}`);
    }
    if (s.stage === 'cue') {
      const c = sim.cue();
      out.push(['cue', k.k, k.h ?? null, c.text, c.minMs]);
      sim.cueDone();
    } else {
      const t0 = sim.now;
      const len = s.deadline - t0;
      const ix = s.ix;
      if (act) act(sim);
      assert.equal(sim.state.deadline - t0, len, `acting moved the window at ${tag}`);
      assert.equal(sim.state.ix, ix);
      out.push(['window', k.k, k.h ?? null, len]);
      sim.advance();
    }
  }
  return out;
}

test('cheese-thief: anti-tell — the night sounds and lasts the same whoever is awake and whatever they do', () => {
  // every seat does the first real thing it may (peek, steal, pick), then taps the decoy
  const doAll = (sim) => {
    for (const id of ids(sim.state.n)) {
      const a = sim.legal(id).find((x) => x.type !== 'ack');
      if (a) assert.ok(sim.act(id, a));
      sim.act(id, { type: 'ack' });
    }
  };
  for (const n of COUNTS) {
    for (const hourSec of [10, 7]) {
      const cfg = { ...config.defaults(n), hourSec };
      // A: everyone on the same hour, nobody does anything
      const crowd = Object.fromEntries(ids(n).map((id) => [id, n === 4 ? [2, 2] : 2]));
      const a = nightTimeline(scenario(n, { dice: crowd, config: cfg }));
      // B: spread out, the thief on another seat, everybody acts as much as it can
      const spread = Object.fromEntries(ids(n).map((id, i) => [id, n === 4 ? [i + 1, 6 - i] : (i % 6) + 1]));
      const b = nightTimeline(scenario(n, { thief: ids(n)[n - 1], dice: spread, config: cfg }), doAll);
      assert.deepEqual(b, a, `n=${n}: the night must look and sound the same from outside`);
      const opens = a.filter((r) => r[0] === 'window' && r[1] === 'open');
      assert.equal(opens.length, 6, 'all six hours, every game');
      for (const r of opens) assert.equal(r[3], hourSec * 1000, 'every hour window is exactly hourSec');
      const pick = a.find((r) => r[0] === 'window' && r[1] === 'rec-pick');
      const meet = a.find((r) => r[0] === 'window' && r[1] === 'rec-meet');
      if (n >= 6) { assert.equal(pick[3], hourSec * 1000); assert.equal(meet[3], 5000, 'official 5 s meeting'); }
    }
  }
  // the 4p thief wakes twice — still nothing in the timeline gives it away
  const one = nightTimeline(scenario(4, { thief: 'p1', dice: { p1: [3, 3], p2: 1, p3: 2, p4: 5 } }));
  const two = nightTimeline(scenario(4, { thief: 'p1', dice: { p1: [3, 6], p2: 1, p3: 2, p4: 5 } }), doAll);
  assert.deepEqual(two, one);
});

test('cheese-thief: narration — the exact Cantonese script per head-count, short, generic, never a name', () => {
  const H = ['一', '兩', '三', '四', '五', '六'];
  const hours = (n) => H.flatMap((h) => [
    n === 4 ? `而家${h}點鐘。醒鐘係${h}點嘅老鼠，請睜開眼。` : `而家${h}點鐘。擲到${h}點嘅老鼠，請睜開眼。`,
    '請閉返眼。',
  ]);
  const BEGIN = '天黑喇，請大家閉眼。手機放喺面前唔好鎖，唔好偷望。';
  const DAWN = '天光喇，請大家睜開眼。芝士唔見咗！';
  const REC = {
    6: ['所有人伸一隻手出嚟。大盜請睜眼，喺手機揀一位共犯，再輕輕摸佢隻手。',
      '被摸到手嘅共犯，請睜眼，同大盜對望認人。',
      '大盜同共犯，請閉返眼。大家收返隻手。'],
    7: ['所有人伸一隻手出嚟。大盜請睜眼，喺手機揀兩位共犯，再輕輕摸佢哋隻手。',
      '大盜請閉返眼。',
      '被摸到手嘅兩位共犯，請睜眼，互相認人。',
      '兩位共犯，請閉返眼。大家收返隻手。'],
    8: ['所有人伸一隻手出嚟。大盜請睜眼，喺手機揀兩位共犯，再輕輕摸佢哋隻手。',
      '被摸到手嘅兩位共犯，請睜眼，同大盜三個互相認人。',
      '大盜同兩位共犯，請閉返眼。大家收返隻手。'],
  };
  for (const n of COUNTS) {
    const sim = scenario(n, { seed: n });
    const heard = [];
    for (let g = 0; g < 200 && sim.state.phase === 'night'; g++) {
      const c = sim.cue();
      if (c) { heard.push(c); sim.cueDone(); } else sim.advance();
    }
    assert.deepEqual(heard.map((c) => c.text), [BEGIN, ...hours(n), ...(REC[n] ?? []), DAWN], `n=${n} script`);
    for (const c of heard) {
      assert.ok([...c.text].length <= 36, `too long to read in one breath: ${c.text}`);
      assert.ok(c.minMs >= 1800 && c.minMs <= 7000);
      for (const p of sim.players) assert.ok(!c.text.includes(p.name), 'the narrator never names anyone');
      assert.ok(!/[0-9]/.test(c.text), 'numbers are written as words so the zh-HK voice reads them right');
    }
    for (const id of ids(n)) sim.act(id, { type: 'day-ready', on: true });
    assert.equal(sim.cue().text, VOTE_CALL);
    assert.ok([...VOTE_CALL].length <= 36);
    sim.cueDone();
    assert.equal(sim.cue(), null, 'the vote call is said once');
  }
  // the narration text does not depend on roles or dice at all
  for (const n of COUNTS) {
    for (const k of ['begin', 'close', 'rec-pick', 'rec-tclose', 'rec-meet', 'rec-close', 'dawn']) {
      assert.equal(narrate({ k, h: 3 }, n), narrate({ k, h: 5 }, n));
    }
  }
});

test('cheese-thief: 讀稿 and 靜音 — the whole night runs on 下一步 alone, or on cue timers alone', () => {
  for (const n of COUNTS) {
    // 讀稿: the reader presses 下一步 after each line, and may also skip a window
    const r = scenario(n);
    let presses = 0;
    for (let g = 0; g < 200 && r.state.phase === 'night'; g++) { assert.ok(r.host({ type: ACT.NEXT })); presses++; }
    assert.equal(r.state.phase, 'day');
    assert.equal(presses, r.state.steps.length * 2, 'every step: its line, then its window');
    assert.equal(r.state.cheese.gone, true, 'the theft still happens');
    if (n >= 6) assert.equal(r.state.followers.length, n === 6 ? 1 : 2, 'a skipped pick is still made');
    // 靜音: every line stays on screen for minMs, then the session completes it
    const q = scenario(n);
    let ms = 0;
    for (let g = 0; g < 200 && q.state.phase === 'night'; g++) {
      if (q.state.stage === 'cue') { const c = q.cue(); q.tick(c.minMs); ms += c.minMs; q.cueDone(); }
      else { ms += q.state.deadline - q.now; q.advance(); }
    }
    assert.equal(q.state.phase, 'day');
    assert.ok(ms < 4 * 60 * 1000, `n=${n}: a silent night takes ${Math.round(ms / 1000)} s`);
  }
});

test('cheese-thief: #10 — the result replays the night: who woke when, the theft and its witnesses, peeks, picks', () => {
  // 5p: p4 alone at one peeks the thief; p1 steals at three with p2 + p3 watching and picks p3
  const sim = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 3, p4: 1, p5: 6 } });
  openHour(sim, 1);
  assert.ok(sim.act('p4', { type: 'peek', target: 'p1' }));
  openHour(sim, 3);
  assert.ok(sim.act('p1', { type: 'recruit', targets: ['p3'] }));
  const r = playOut(sim, { p1: 'p2', p2: 'p1', p3: 'p2', p4: 'p1', p5: 'p1' });
  assert.deepEqual(r.recap, [
    '一點鐘：玩家4 醒咗 — 玩家4 偷睇咗 玩家1 粒骰（3）',
    '兩點鐘：冇人醒',
    '三點鐘：玩家1、玩家2、玩家3 醒咗 — 大盜 玩家1 偷走芝士（玩家2、玩家3 睇到）；大盜揀咗 玩家3 做共犯',
    '四點鐘：冇人醒',
    '五點鐘：冇人醒',
    '六點鐘：玩家5 醒咗',
  ]);
  const at = r.lines.indexOf('🌙 夜晚重溫：');
  assert.ok(at > 0);
  assert.deepEqual(r.lines.slice(at + 1, at + 7), r.recap, 'result.lines carries the recap');
  for (const A of [...ids(5), null]) assert.deepEqual(sim.view(A).recap, r.recap, 'every phone shows the same recap at the end');

  // 4p: the thief waits at its first wake, then must steal at its second
  const wait = scenario(4, { thief: 'p1', dice: { p1: [2, 5], p2: 1, p3: 2, p4: 5 } });
  const rw = playOut(wait, {}).recap;
  assert.equal(rw[1], '兩點鐘：玩家1、玩家3 醒咗 — 大盜 玩家1 醒咗，但揀咗遲啲先偷');
  assert.equal(rw[4], '五點鐘：玩家1、玩家4 醒咗 — 大盜 玩家1 偷走芝士（玩家4 睇到）');
  // 4p: the thief steals first, wakes again with nothing left to take
  const early = scenario(4, { thief: 'p1', dice: { p1: [2, 5], p2: 1, p3: 2, p4: 5 } });
  openHour(early, 2);
  assert.ok(early.act('p1', { type: 'steal' }));
  const re = playOut(early, {}).recap;
  assert.equal(re[1], '兩點鐘：玩家1、玩家3 醒咗 — 大盜 玩家1 偷走芝士（玩家3 睇到）');
  assert.equal(re[4], '五點鐘：玩家1、玩家4 醒咗 — 大盜 玩家1 再醒，芝士早就冇咗');
  // 6-8p: the follower step closes the recap
  for (const n of [6, 7, 8]) {
    const x = scenario(n, { thief: 'p1' });
    runTo(x, stepIndex(x, 'rec-pick'), 'window');
    assert.ok(x.act('p1', { type: 'recruit', targets: n === 6 ? ['p4'] : ['p4', 'p6'] }));
    const last = playOut(x, {}).recap.at(-1);
    assert.match(last, n === 6 ? /^夜尾：大盜揀咗 玩家4 做共犯（兩個互相認得）$/ : /^夜尾：大盜揀咗 玩家4、玩家6 做共犯/);
    if (n === 7) assert.match(last, /大盜冇同佢哋對望/);
  }
});

test('cheese-thief: result lines get the odd cases right (fall mouse follower, no follower, ties)', () => {
  const cfg = { ...config.defaults(6), fallMouse: true };
  // FM recruited, a plain sleepyhead on top → the thief alone wins; the FM is told why it lost
  const r = verdict(6, { fm: 'p2', followers: ['p2'], config: cfg, votes: { p1: 'p3', p2: 'p3', p3: 'p4', p4: 'p3', p5: 'p3', p6: 'p3' } });
  assert.deepEqual(r.winners, ['p1']);
  assert.match(r.lines.join('\n'), /唔喺最高票，所以大盜贏/);
  assert.match(r.lines.join('\n'), /背鍋鼠 玩家2 雖然做咗共犯，但佢淨係靠畀人投中先贏，所以輸/);
  assert.equal(r.points.p1, 2);
  assert.equal(r.points.p2, 0);
  // caught with an FM follower: the FM is not said to "lose with the thief"; it loses for its own reason
  const c = verdict(6, { fm: 'p2', followers: ['p2'], config: cfg, votes: { p1: 'p3', p2: 'p1', p3: 'p1', p4: 'p1', p5: 'p3', p6: 'p4' } });
  assert.ok(!c.lines.some((l) => l.includes('跟大盜一齊輸')));
  assert.match(c.lines.join('\n'), /背鍋鼠 玩家2 唔喺最高票，所以都輸（佢做咗共犯都一樣）/);
  // no follower at all
  const e = verdict(5, { followers: [], votes: { p1: 'p2', p2: 'p3', p3: 'p2', p4: 'p2', p5: 'p2' } });
  assert.match(e.lines.join('\n'), /唔喺最高票，所以大盜贏/);
  assert.ok(e.lines.includes('今局冇共犯。'));
  // a tie that includes the thief (5-8p) is a catch, and the line says so
  const t = verdict(6, { followers: ['p2'], votes: { p1: 'p3', p2: 'p1', p3: 'p1', p4: 'p3', p5: 'p3', p6: 'p1' } });
  assert.match(t.lines.join('\n'), /平票都一齊開牌，大盜照計畀人揪出/);
  // the 4p tie names the 2023 amendment (older printed rulebooks disagree)
  const f = verdict(4, { votes: { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p2' } });
  assert.match(f.lines.join('\n'), /2023 年官方修訂/);
});

test('cheese-thief ui: a peek, a steal and a follower pick look like a sleeper decoy at a glance; the night is silent', async () => {
  await withFakeDom(async (ui) => {
    const cls = (n) => [...n.cls].filter((c) => c !== 'on' && c !== 'is-done').sort().join('.');
    const glance = (root) => {
      const night = findAll(root, (n) => hasCls(n, 'ct-night'))[0];
      assert.ok(night, 'a night screen');
      const ack = findAll(night, (n) => hasCls(n, 'ct-ack'))[0];
      return JSON.stringify({
        night: cls(night),
        kids: night.children.map(cls),
        panel: cls(findAll(night, (n) => hasCls(n, 'ct-panel'))[0]),
        chips: findAll(night, (n) => hasCls(n, 'ct-chip')).map((c) => [cls(c), c.disabled, c.hidden]),
        ack: [cls(ack), ack.disabled, ack.hidden, findAll(ack, (n) => hasCls(n, 'ct-ack-main'))[0].textContent],
      });
    };
    const sameForAll = (sim, seats, label) => {
      const g = new Set(sim.players.map((p) => glance(seats[p.id].root)));
      assert.equal(g.size, 1, `${label}: phones differ at a glance:\n${[...g].join('\n')}`);
    };
    const bigButton = (seat) => findAll(seat.root, (n) => hasCls(n, 'ct-ack'))[0];
    /** The one gesture everybody makes: tap a name, then the big button. */
    const gesture = (seat, name) => {
      click(findAll(seat.root, (n) => hasCls(n, 'ct-chip') && n.textContent === name)[0]);
      click(bigButton(seat));
    };
    const lastSent = (sent, pid) => sent.filter((x) => x.pid === pid).at(-1)?.a;
    const sounds = [];

    // 6p: p2 alone at two (peek), p1 steals alone at three, follower pick after six
    const sim = scenario(6, { thief: 'p1', dice: { p1: 3, p2: 2, p3: 1, p4: 4, p5: 5, p6: 6 } });
    const sent = [];
    const seats = mountAll(ui, sim, sent, { sounds });
    for (let g = 0; g < 200; g++) {
      pushViews(sim, seats);
      if (sim.state.phase !== 'night') break;
      sameForAll(sim, seats, `step ${sim.state.ix} ${sim.state.stage}`);
      if (sim.state.stage === 'window') {
        const k = st(sim);
        if (k.k === 'open' && k.h === 2) {
          gesture(seats.p2, '玩家4');
          gesture(seats.p5, '玩家4');
          assert.deepEqual(lastSent(sent, 'p2'), { type: 'peek', target: 'p4' });
          assert.deepEqual(lastSent(sent, 'p5'), { type: 'ack' }, 'the same gesture is only a decoy for a sleeper');
        }
        if (k.k === 'open' && k.h === 3) {
          assert.equal(sim.state.cheese.by, 'p1', 'the theft needs no tap at all in 5-8p');
          click(bigButton(seats.p1));
          assert.deepEqual(lastSent(sent, 'p1'), { type: 'ack' });
        }
        if (k.k === 'rec-pick') {
          gesture(seats.p1, '玩家3');
          gesture(seats.p6, '玩家3');
          assert.deepEqual(lastSent(sent, 'p1'), { type: 'recruit', targets: ['p3'] });
          assert.deepEqual(lastSent(sent, 'p6'), { type: 'ack' });
        }
        pushViews(sim, seats);
        sameForAll(sim, seats, `after acting at step ${sim.state.ix}`);
      }
      if (sim.state.stage === 'cue') sim.cueDone(); else sim.advance();
    }
    assert.equal(sim.state.phase, 'day');
    assert.deepEqual(sim.state.followers, ['p3']);
    // the peek result sits under a cover that opens without a sound
    const eyeCovers = seats.comps.covers.filter((c) => c.props?.backArt === '👁');
    assert.ok(eyeCovers.length > 0);
    for (const c of eyeCovers) assert.equal(c.props.openSound, 'none', 'the night peek cover is silent');

    // 5p: the thief picks among two witnesses — same look as everybody else
    const five = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 3, p4: 4, p5: 5 } });
    const sent5 = [];
    const seats5 = mountAll(ui, five, sent5, { sounds });
    openHour(five, 3);
    pushViews(five, seats5);
    sameForAll(five, seats5, '5p pick');
    gesture(seats5.p1, '玩家2');
    gesture(seats5.p4, '玩家2');
    assert.deepEqual(lastSent(sent5, 'p1'), { type: 'recruit', targets: ['p2'] });
    pushViews(five, seats5);
    sameForAll(five, seats5, '5p after the pick');

    // 4p: the thief steals at its first wake with the very same big button
    const four = scenario(4, { thief: 'p1', dice: { p1: [2, 5], p2: 1, p3: 3, p4: 4 } });
    const sent4 = [];
    const seats4 = mountAll(ui, four, sent4, { sounds });
    openHour(four, 2);
    pushViews(four, seats4);
    sameForAll(four, seats4, '4p first wake');
    assert.match(seats4.p1.root.textContent, /㩒落去＝而家偷芝士/, 'only the small line says what the tap does');
    click(bigButton(seats4.p1));
    click(bigButton(seats4.p3));
    assert.deepEqual(lastSent(sent4, 'p1'), { type: 'steal' });
    assert.equal(four.state.cheese.hour, 2);
    pushViews(four, seats4);
    sameForAll(four, seats4, '4p after the steal');

    assert.deepEqual(sounds.filter((x) => x.phase === 'night'), [], 'the game UI makes no sound at night');
    for (const all of [seats, seats5, seats4]) for (const s of Object.values(all)) s.handle.destroy();
  });
});

// ============================================================
// Play-test fixes 2026-10-04 UTC (friends on real iPhones): dice above the card,
// every awake seat really gets its own screen (incl. a phone passed around), the
// 5p 家規 night-end pick, and the dawn re-check of the role card
// ============================================================

test('cheese-thief: 5p 家規 pick5 — off by default; labelled 家規 in field, summary, warning and preset; ignored elsewhere', () => {
  const d = config.defaults(5);
  assert.equal(d.pick5, false);
  const f = config.fields(d, 5).find((x) => x.key === 'pick5');
  assert.equal(f.label, '家規：5 人都喺夜晚尾由大盜揀 1 個共犯');
  assert.equal(f.type, 'bool');
  assert.match(f.help, /官方/);
  // official by default: the witness rule is explained and the 家規 is offered by name
  const w = config.validate(d, 5).warnings.join('\n');
  assert.match(w, /一齊醒/);
  assert.match(w, /家規「夜尾揀共犯」/);
  const on = { ...d, pick5: true };
  assert.equal(config.validate(on, 5).ok, true);
  assert.ok(config.validate(on, 5).warnings.some((x) => x.startsWith('家規：5 人局夜晚尾由大盜揀 1 位共犯')));
  const sum = config.summary(on, 5).join('\n');
  assert.match(sum, /夜尾大盜揀 1 位共犯（家規）/);
  assert.match(sum, /🤝 家規：5 人局夜晚尾由大盜揀 1 個共犯/);
  assert.match(sum, /💬 5 人（家規）/);
  assert.match(config.summary(d, 5).join('\n'), /共犯：偷芝士時喺度嘅貪瞓鼠/);
  // the lobby's one-tap chips: official first, the 家規 second — 5 players only
  const ps = config.presets(5);
  assert.deepEqual(ps.map((p) => p.cfg), [{ pick5: false }, { pick5: true }]);
  assert.ok(ps.every((p) => p.label && p.reason));
  assert.match(ps[1].label, /家規/);
  for (const n of [4, 6, 7, 8]) assert.deepEqual(config.presets(n), []);
  // other head-counts ignore it; the next 5p game keeps the host's choice
  for (const n of [4, 6, 7, 8]) {
    assert.equal(config.defaults(n, on).pick5, false);
    assert.equal(config.validate(on, n).ok, true);
    assert.ok(!config.summary(on, n).join('\n').includes('🤝 家規'));
  }
  assert.equal(config.defaults(5, on).pick5, true);
  // one phone: the official hour plus the hand-over pad (U6), the hour itself stays the host's choice
  assert.equal(config.defaults(5, undefined, { singleDevice: true }).hourSec, 10);
  assert.equal(config.defaults(5, undefined, { singleDevice: true }).passPhone, true);
  assert.equal(config.defaults(5, { hourSec: 12 }, { singleDevice: true }).hourSec, 12);
  assert.equal(config.defaults(5, undefined, { singleDevice: false }).hourSec, 10);
  assert.equal(config.defaults(5, undefined, { singleDevice: false }).passPhone, false);
});

test('cheese-thief: 5p 家規 pick5 — no witness follower at the theft; the 6p night-end pick, script and meeting instead', () => {
  const cfg = { ...config.defaults(5), pick5: true };
  // p1 steals at three with p2 + p3 watching: the official rule would make it pick one of them now
  const sim = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 3, p4: 1, p5: 6 }, config: cfg });
  assert.deepEqual(sim.state.steps.slice(-4).map((x) => x.k), ['rec-pick', 'rec-meet', 'rec-close', 'dawn']);
  openHour(sim, 3);
  assert.equal(sim.state.pending, null, 'no pick at the theft hour');
  assert.deepEqual(sim.state.followers, []);
  assert.equal(view(sim, 'p1').nightSeat.recruit, null);
  assert.equal(view(sim, 'p2').nightSeat.thief, 'p1', 'the witnesses still see the theft');
  leakCheck(sim);
  // the 6p script: one follower, then thief and follower look at each other
  runTo(sim, stepIndex(sim, 'rec-pick'), 'cue');
  assert.equal(sim.cue().text, narrate({ k: 'rec-pick' }, 6));
  sim.cueDone();
  assert.equal(engine.focus(sim.state).anonymous, '大盜請拎起部手機');
  assert.deepEqual(engine.focus(sim.state).pids, ['p1']);
  assert.deepEqual(view(sim, 'p1').nightSeat.recruit, { count: 1, among: ['p2', 'p3', 'p4', 'p5'] });
  assert.equal(view(sim, 'p1').hint, HINT.night.recruit);
  assert.equal(sim.act('p1', { type: 'recruit', targets: ['p4', 'p5'] }), false, 'exactly one');
  assert.ok(sim.act('p1', { type: 'recruit', targets: ['p4'] }), 'anyone may be picked, not only a witness');
  runTo(sim, stepIndex(sim, 'rec-meet'), 'cue');
  assert.equal(sim.cue().text, narrate({ k: 'rec-meet' }, 6));
  sim.cueDone();
  assert.deepEqual(sorted(awakeIds(sim)), ['p1', 'p4']);
  assert.deepEqual(view(sim, 'p4').nightSeat.meet, { thief: 'p1', mates: [] });
  assert.equal(view(sim, 'p4').my.follower, true);
  assert.deepEqual(view(sim, 'p4').my.crew, { thief: 'p1', mates: [] });
  assert.deepEqual(view(sim, 'p1').my.crew, { thief: null, mates: ['p4'] });
  leakCheck(sim);
  runTo(sim, stepIndex(sim, 'rec-close'), 'cue');
  assert.equal(sim.cue().text, narrate({ k: 'rec-close' }, 6));
  const r = playOut(sim, { p1: 'p2', p2: 'p1', p3: 'p2', p4: 'p2', p5: 'p1' });
  assert.equal(r.recap.at(-1), '夜尾：大盜揀咗 玩家4 做共犯（兩個互相認得）');
  assert.ok(!r.recap.slice(0, 6).some((l) => l.includes('做共犯')), 'no pick during the hours');
  assert.deepEqual(sorted(r.winners), ['p1', 'p4'], 'the thief escaped: thief + follower win');
});

test('cheese-thief: 5p 家規 pick5 — anti-tell timeline holds; fuzzed games always end with exactly one follower', () => {
  const doAll = (sim) => {
    for (const id of ids(sim.state.n)) {
      const a = sim.legal(id).find((x) => x.type !== 'ack');
      if (a) assert.ok(sim.act(id, a));
      sim.act(id, { type: 'ack' });
    }
  };
  for (const hourSec of [10, 7]) {
    const cfg = { ...config.defaults(5), pick5: true, hourSec };
    const a = nightTimeline(scenario(5, { dice: { p1: 2, p2: 2, p3: 2, p4: 2, p5: 2 }, config: cfg }));
    const b = nightTimeline(scenario(5, { thief: 'p5', dice: { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 }, config: cfg }), doAll);
    assert.deepEqual(b, a);
    assert.equal(a.find((r) => r[0] === 'window' && r[1] === 'rec-meet')[3], 5000, 'official 5 s meeting');
  }
  for (let seed = 1; seed <= 60; seed++) {
    const sim = new Sim(game, { n: 5, seed: seed * 3 + 1, config: { ...config.defaults(5), pick5: true } });
    sim.runRandom({ onStep: (x) => { if (x.steps % 4 === 0) leakCheck(x); } });
    leakCheck(sim);
    assert.equal(sim.state.followers.length, 1);
    assert.ok(!sim.state.followers.includes(ids(5).find((p) => sim.state.role[p] === 'thief')));
  }
});

test('cheese-thief: a phone passed around walks through the awake seats — `done` leaves focus, never moves the clock', () => {
  // 5p: p1 steals at three with p2 + p3 watching (the thief owes a pick)
  const sim = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 3, p4: 1, p5: 6 } });
  runTo(sim, stepIndex(sim, 'open', 3), 'cue');
  assert.equal(sim.act('p1', { type: 'done' }), false, 'nothing to finish while the line is read');
  sim.cueDone();
  const d = sim.state.deadline;
  const pids = () => engine.focus(sim.state).pids;
  assert.deepEqual(pids(), ['p1', 'p2', 'p3']);
  assert.equal(sim.act('p1', { type: 'done' }), false, 'not while a follower pick is owed');
  assert.ok(!sim.legal('p1').some((a) => a.type === 'done'));
  assert.equal(sim.act('p4', { type: 'done' }), false, 'a sleeper has nothing to finish');
  assert.ok(!sim.legal('p4').some((a) => a.type === 'done'));
  const others = ['p1', 'p3', 'p4', 'p5'];
  const before = Object.fromEntries(others.map((x) => [x, JSON.stringify(view(sim, x))]));
  assert.ok(sim.act('p2', { type: 'done' }));
  for (const x of others) {
    const a = JSON.parse(before[x]); const b = view(sim, x);
    delete a.acks; delete b.acks;
    assert.deepEqual(b, a, `${x} noticed p2 handing the phone on`);
  }
  assert.deepEqual(pids(), ['p1', 'p3'], 'focus walks on');
  assert.equal(sim.act('p2', { type: 'done' }), false, 'once');
  assert.ok(sim.act('p1', { type: 'recruit', targets: ['p3'] }));
  assert.ok(sim.act('p1', { type: 'done' }));
  assert.deepEqual(pids(), ['p3']);
  assert.ok(sim.act('p3', { type: 'done' }));
  assert.deepEqual(engine.focus(sim.state), { pids: [], anonymous: '擲到三點嘅請拎起部手機' }, 'the prompt stays, like an empty hour');
  assert.equal(sim.state.deadline, d, 'the hour keeps its full length');
  assert.equal(sim.state.ix, stepIndex(sim, 'open', 3));
  assert.equal(view(sim, 'p4').acks.done, 3, 'counted like any other tap');
  assert.ok(view(sim, 'p2').nightSeat.awake, 'still awake on its own view (a one-seat phone never sends done)');
  // the next step starts afresh
  openHour(sim, 6);
  assert.deepEqual(pids(), ['p5']);
  assert.equal(sim.act('p2', { type: 'done' }), false);
  assert.ok(!JSON.stringify(view(sim, 'p5')).includes('"done":['), 'the done list never reaches a view');
});

test('cheese-thief: the role card crew — a told follower knows whom it met, the thief its followers, nobody else gets one', () => {
  const s6 = scenario(6, { thief: 'p1', dice: { p1: 3, p2: 1, p3: 2, p4: 4, p5: 5, p6: 6 } });
  runTo(s6, stepIndex(s6, 'rec-pick'), 'window');
  assert.ok(s6.act('p1', { type: 'recruit', targets: ['p4'] }));
  assert.deepEqual(view(s6, 'p1').my.crew, { thief: null, mates: ['p4'] }, 'the thief knows whom it picked');
  assert.equal(view(s6, 'p4').my.crew, undefined, 'not told before the meeting');
  finishNight(s6);
  assert.deepEqual(view(s6, 'p4').my.crew, { thief: 'p1', mates: [] });
  for (const x of ['p2', 'p3', 'p5', 'p6']) assert.equal(view(s6, x).my.crew, undefined);
  leakCheck(s6);
  // 7p: a follower that did not watch the theft does not know the thief, only its mate
  const s7 = scenario(7, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 5, p4: 1, p5: 2, p6: 4, p7: 6 } });
  runTo(s7, stepIndex(s7, 'rec-pick'), 'window');
  assert.ok(s7.act('p1', { type: 'recruit', targets: ['p2', 'p3'] }));
  finishNight(s7);
  assert.deepEqual(view(s7, 'p2').my.crew, { thief: 'p1', mates: ['p3'] }, 'p2 watched the theft');
  assert.deepEqual(view(s7, 'p3').my.crew, { thief: null, mates: ['p2'] });
  leakCheck(s7);
  // 5p official: the witness learns it at the thief's hour
  const s5 = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 2, p4: 4, p5: 5 } });
  openHour(s5, 3);
  assert.deepEqual(view(s5, 'p2').my.crew, { thief: 'p1', mates: [] });
  // the day 💡 line is the same on every phone (the sheet itself is not covered)
  finishNight(s5);
  assert.equal(new Set(ids(5).map((x) => view(s5, x).hint)).size, 1);
  assert.equal(view(s5, 'p2').hint, HINT.day.all);
});

// ---------- the real Room: who is "in focus" (the shell lifts the night dim only for those) ----------

async function cheeseRoom(n, { shared = false, config: cfg = {}, thiefAt = 0, dice = [] } = {}) {
  const { Room } = await import('../js/core/room.js?v=1');
  const { createBag } = await import('../js/core/bag.js?v=1');
  const { PROTOCOL } = await import('../js/core/transport.js?v=1');
  let now = 1_700_000_000_000;
  let timers = [];
  let seq = 0;
  const clock = {
    now: () => now,
    setTimeout: (fn, ms = 0) => { const id = ++seq; timers.push({ at: now + ms, fn, id }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
    setInterval: () => 0, clearInterval() {},
  };
  const run = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = Math.max(now, due.at);
      due.fn();
    }
    now = end;
  };
  const NAMES = ['阿明', '阿欣', '阿強', '阿珍', '阿玲', '阿B', '阿C', '阿D'].slice(0, n);
  const sent = [];
  const room = new Room({
    code: shared ? null : '3456', hostDeviceId: 'dev_host', names: shared ? NAMES : [NAMES[0]], now: clock.now, rng: mulberry32(21),
    bag: createBag({ storage: new Map(), rng: mulberry32(5), banks: {} }), timers: clock,
    loadGame: async () => game, send: (deviceId, msg) => sent.push({ deviceId, msg: clone(msg) }), onCue: () => {}, narrationMode: 'silent',
  });
  if (!shared) NAMES.slice(1).forEach((nm, i) => room.receive(`peer_${i}`, { t: 'hello', v: PROTOCOL, deviceId: `dev_${i}`, seats: [{ name: nm }] }));
  const sel = await room.selectGame('cheese-thief');
  assert.equal(sel.ok, true, sel.message);
  room.setConfig({ ...room.config, ...cfg });
  assert.equal(room.start().ok, true);
  const roomMsg = () => [...sent].reverse().find((x) => x.deviceId === 'dev_host' && x.msg.t === 'room').msg.room;
  const order = roomMsg().players.map((p) => p.id);
  const deviceOf = new Map(roomMsg().players.map((p) => [p.id, p.deviceId]));
  const lastViews = (dev) => [...sent].reverse().find((x) => x.deviceId === dev && x.msg.t === 'views')?.msg;
  const s = () => room.session.state;
  for (const pid of order) room.act(deviceOf.get(pid), pid, { type: 'roll' });
  // set the table up: who is the thief, what everybody rolled
  order.forEach((pid, i) => { s().role[pid] = i === thiefAt ? 'thief' : 'sleepyhead'; s().dice[pid] = [dice[i] ?? (i % 6) + 1]; });
  for (const pid of order) room.act(deviceOf.get(pid), pid, { type: 'ready' });
  assert.equal(s().phase, 'night');
  return { room, run, order, deviceOf, lastViews, s };
}

test('cheese-thief in a real Room: one phone per seat — exactly the awake seats are in focus (lit) for their whole window, acting never drops them', async () => {
  // 6p: seat 0 steals at three with seat 2 watching; seat 1 is alone at one (peeks)
  const R = await cheeseRoom(6, { dice: [3, 1, 3, 4, 5, 6] });
  const { room, run, order, deviceOf, lastViews, s } = R;
  let windows = 0;
  let peeked = false;
  let recruited = false;
  for (let guard = 0; guard < 4000 && s().phase === 'night'; guard++) {
    const st = s().steps[s().ix];
    for (const [pid, dev] of deviceOf) {
      const m = lastViews(dev);
      assert.deepEqual(Object.keys(m.bySeat), [pid]);
      const inFocus = !!m.focus?.pids?.includes(pid);
      const awake = !!m.bySeat[pid].nightSeat?.awake;
      assert.equal(inFocus, awake, `${st.k}${st.h ?? ''}/${s().stage}: ${pid} awake=${awake} but in focus=${inFocus}`);
      if (s().stage !== 'window' || !['open', 'rec-pick', 'rec-meet'].includes(st.k)) assert.equal(inFocus, false);
    }
    if (s().stage === 'window' && st.k === 'open' && st.h === 1 && !peeked) {
      peeked = true;
      windows++;
      room.act(deviceOf.get(order[1]), order[1], { type: 'peek', target: order[3] });
      const m = lastViews(deviceOf.get(order[1]));
      assert.ok(m.focus.pids.includes(order[1]), 'after peeking the seat is still in focus, so its phone stays lit to read the result');
      assert.deepEqual(m.bySeat[order[1]].nightSeat.peek.done.dice, [4]);
    }
    if (s().stage === 'window' && st.k === 'rec-pick' && !recruited) {
      recruited = true;
      windows++;
      room.act(deviceOf.get(order[0]), order[0], { type: 'recruit', targets: [order[4]] });
      assert.ok(lastViews(deviceOf.get(order[0])).focus.pids.includes(order[0]), 'the thief stays lit after its pick');
    }
    run(250);
  }
  assert.equal(s().phase, 'day');
  assert.equal(windows, 2);
  assert.deepEqual(s().followers, [order[4]]);
  // dawn: only the follower's own phone carries it, as role-card data
  const fv = lastViews(deviceOf.get(order[4])).bySeat[order[4]];
  assert.equal(fv.my.follower, true);
  assert.deepEqual(fv.my.crew, { thief: order[0], mates: [] });
  for (const pid of order.slice(1, 4)) assert.equal(lastViews(deviceOf.get(pid)).bySeat[pid].my.crew, undefined);
});

test('cheese-thief in a real Room: one shared phone — the seats awake together stay in focus all hour (ONE combined screen, U2); the thief picks from the same phone; the pad holds', async () => {
  // 5p on one phone: seat 0 steals at three with seats 1 and 2 watching (it owes a pick); seat 3 is alone at four
  const R = await cheeseRoom(5, { shared: true, dice: [3, 3, 3, 4, 6] });
  const { room, run, order, lastViews, s } = R;
  assert.equal(s().cfg.passPhone, true, 'the room told config.defaults it is one phone');
  const focus = () => lastViews('dev_host').focus;
  const seat = (pid) => lastViews('dev_host').bySeat[pid];
  let windows = 0;
  let picked = false;
  for (let guard = 0; guard < 4000 && s().phase === 'night'; guard++) {
    const st = s().steps[s().ix];
    if (s().stage === 'window' && st.k === 'open' && st.h === 3) {
      windows++;
      const f = focus();
      assert.equal(f.anonymous, '擲到三點嘅請拎起部手機');
      assert.deepEqual(f.pids, order.slice(0, 3), 'thief and both witnesses, in seat order, the whole hour');
      assert.equal(seat(order[0]).step.windowMs, 20000);
      if (!picked) {
        picked = true;
        assert.ok(seat(order[0]).nightSeat.recruit, 'the thief owes its pick');
        // the combined screen sends the pick AS the thief and acks for all three — all from the one phone
        assert.ok(room.act('dev_host', order[0], { type: 'recruit', targets: [order[2]] }));
        assert.ok(room.act('dev_host', order[1], { type: 'ack', seats: order.slice(0, 3) }));
        assert.deepEqual(focus().pids, order.slice(0, 3), 'acting never drops anyone');
        assert.equal(seat(order[1]).nightSeat.picked, order[2], 'the witnesses see whom the thief picked');
      }
    }
    if (s().stage === 'window' && st.k === 'open' && st.h === 4) assert.deepEqual(focus().pids, [order[3]]);
    run(250);
  }
  assert.ok(windows >= 40, `the hour ran its full 20 s (${windows} looks)`);
  assert.deepEqual(s().followers, [order[2]], 'picked on the phone, not at random after the hour');
});

// ---------- phone UI ----------

/** What a neighbour can read at a glance: all text except under covers (the stubs draw cover fronts, the
 *  role card's front and the cup's dice in plain DOM; the real components keep them hidden). */
function glanceText(root, skip = []) {
  const out = [];
  const go = (n) => {
    if (n instanceof FText) { out.push(n.data); return; }
    if (['c-cover-front', 'rc-body', 'c-dicecup', 'c-timer', ...skip].some((c) => n.cls.has(c))) return;
    for (const c of n.children) go(c);
  };
  go(root);
  return out.join('');
}
const indexOfCls = (root, c) => { const all = []; walk(root, (n) => { if (n instanceof FEl) all.push(n); }); return all.findIndex((n) => hasCls(n, c)); };

test('cheese-thief ui: the dice cup sits above the role card (roll and day screens)', async () => {
  await withFakeDom(async (ui) => {
    const sim = new Sim(game, { n: 5, seed: 4 });
    const seats = mountAll(ui, sim, []);
    pushViews(sim, seats);
    const r = seats.p1.root;
    assert.ok(indexOfCls(r, 'c-dicecup') >= 0 && indexOfCls(r, 'c-dicecup') < indexOfCls(r, 'c-rolecard'), 'roll: cup above card');
    for (const id of ids(5)) sim.act(id, { type: 'ready' });
    finishNight(sim);
    pushViews(sim, seats);
    assert.ok(indexOfCls(r, 'c-dicecup') >= 0 && indexOfCls(r, 'c-dicecup') < indexOfCls(r, 'c-rolecard'), 'day: cup above card');
    for (const s of Object.values(seats)) s.handle.destroy();
  });
});

test('cheese-thief ui: at dawn every phone shows the same re-check line under its role card; 共犯 shows only on the card front', async () => {
  await withFakeDom(async (ui) => {
    for (const [n, cfg, plan] of [
      [6, {}, ['p4']], [7, {}, ['p2', 'p3']], [8, {}, ['p4', 'p6']], [5, { pick5: true }, ['p3']], [5, {}, null], [4, {}, null],
    ]) {
      const dice = { p1: 3, p2: 3, p3: 5, p4: 1, p5: 2, p6: 4, p7: 6, p8: 6 };
      const sim = scenario(n, { thief: 'p1', dice, config: { ...config.defaults(n), ...cfg } });
      if (plan) { runTo(sim, stepIndex(sim, 'rec-pick'), 'window'); assert.ok(sim.act('p1', { type: 'recruit', targets: plan })); }
      finishNight(sim);
      const seats = mountAll(ui, sim, []);
      pushViews(sim, seats);
      const all = ids(n);
      // the same words on every phone, placed right under the card — never the top of the screen
      for (const x of all) {
        const r = seats[x].root;
        const l = findAll(r, (e) => hasCls(e, 'ct-recheck'))[0];
        assert.equal(l.hidden, n < 5, `n=${n}: re-check shown from 5 players up`);
        assert.equal(l.textContent, ui.RECHECK);
        assert.ok(indexOfCls(r, 'c-rolecard') < indexOfCls(r, 'ct-recheck'), 'under the role card');
        const day = findAll(r, (e) => hasCls(e, 'ct-day'))[0];
        assert.ok(day.children.indexOf(l) > 1, 'not a banner at the top');
      }
      // at a glance (everything outside the covers) a follower's phone reads exactly like everyone else's
      assert.equal(new Set(all.map((x) => glanceText(seats[x].root))).size, 1, `n=${n}: day screens differ at a glance`);
      // the card front (stub: .rc-body) says it, and with whom it is shared
      const card = (x) => findAll(seats[x].root, (e) => hasCls(e, 'rc-body'))[0]?.textContent ?? '';
      const nm = (x) => `玩家${x.slice(1)}`;
      for (const f of sim.state.followers) {
        assert.match(card(f), /^🤝共犯\|/, `n=${n}: ${f}'s card says 共犯`);
        const mates = sim.state.followers.filter((x) => x !== f).map(nm);
        if (mates.length) assert.ok(card(f).includes(`另一位共犯：${mates.join('、')}`));
        const knows = n !== 7 || sim.state.wake[f].includes(sim.state.cheese.hour);
        assert.ok(card(f).includes(knows ? '大盜係 玩家1' : '你唔知大盜係邊個'), `n=${n}: ${card(f)}`);
      }
      if (sim.state.followers.length) assert.ok(card('p1').includes(`你嘅共犯：${sim.state.followers.map(nm).join('、')}`));
      for (const x of all.filter((y) => y !== 'p1' && !sim.state.followers.includes(y))) assert.match(card(x), /^🐭貪瞓鼠\|/);
      // ... and the vote screen has no follower banner either
      for (const x of all) sim.act(x, { type: 'day-ready', on: true });
      assert.equal(sim.state.phase, 'vote');
      pushViews(sim, seats);
      // (the ballot itself lists everybody but you, so it differs by design)
      assert.equal(new Set(all.map((x) => glanceText(seats[x].root, ['c-votepanel']))).size, 1, `n=${n}: vote screens differ at a glance`);
      for (const x of all) assert.ok(!seats[x].root.textContent.includes('你係共犯'));
      for (const s of Object.values(seats)) s.handle.destroy();
    }
  });
});

/**
 * One seat of a SHARED phone (DESIGN §7.1), as the play screen mounts it: api.shared / wholeTable, sendAs for the
 * co-wakers, tableSend for the phone in the middle (it ticks every seat, as the room's `seats` filter allows).
 */
function mountShared(ui, sim, pid, sent, { whole = true } = {}) {
  const comps = stubComponents();
  const cards = [];
  const RC = comps.RoleCard;
  comps.RoleCard = (p) => { const c = RC(p); cards.push(c); return c; };
  const root = new FEl('div');
  const all = sim.players.map((p) => p.id);
  const act = (as, a) => { const changed = sim.act(as, a); sent.push({ pid: as, a, changed }); return changed; };
  // re-run #2 (DESIGN §7.1): `confirm` on a whole-table phone — the first tap arms (sends nothing, false), the next sends
  const tableCalls = [];
  const armed = new Set();
  const api = {
    me: pid, players: sim.players, isHost: true, meta: game.meta, config: sim.state.cfg,
    shared: true, wholeTable: whole, atTable: pid === null, mySeats: all,
    send: (a) => (pid ? act(pid, a) : false),
    sendAs: (as, a) => act(as, a),
    tableSend: (a, opts = {}) => {
      tableCalls.push({ a, opts });
      if (opts.confirm && whole && !armed.has(a.type)) { armed.add(a.type); return false; }
      armed.delete(a.type);
      return act(all[0], { ...a, seats: all, table: true });
    },
    ink() {}, now: () => sim.now, clockNow: () => sim.now, sfx() {}, toast() {}, components: comps,
  };
  return { pid, root, api, cards, tableCalls, handle: ui.mount(root, api) };
}

/** The ctx a shared phone gives the seat it mounted for: `coWakers` / `views` while several of its seats are awake. */
function sharedCtx(sim, co = [], extra = {}) {
  const f = engine.focus(sim.state);
  return {
    focus: f, paused: false, narrationMode: 'voice', shared: true, wholeTable: true, atTable: false, tableLocked: false,
    coWakers: co, views: Object.fromEntries(co.map((p) => [p, sim.view(p)])), asked: null, clockHeld: false, ...extra,
  };
}

/** Update twice, as the shell may: the screen must be the same after both. */
function showTwice(seat, view, ctx) {
  seat.handle.update(view, ctx);
  const a = serialize(seat.root);
  seat.handle.update(clone(view), clone(ctx));
  assert.equal(serialize(seat.root), a, `update() is not idempotent for ${seat.pid ?? 'table'}`);
}

const byCls = (root, c) => findAll(root, (n) => hasCls(n, c));
const visibleText = (root) => {
  const out = [];
  const go = (n) => { if (n instanceof FText) out.push(n.data); else if (!n.hidden) n.children.forEach(go); };
  go(root);
  return out.join(' ');
};

test('cheese-thief ui: one phone, several awake in one hour — ONE combined screen; the thief\'s pick goes out as the thief and everyone sees it; one tap acks for all; never `done` (U2)', async () => {
  await withFakeDom(async (ui) => {
    // 5p, official witness rule: p1 steals at three with p2 and p3 watching, so it owes a pick
    const sim = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 3, p4: 1, p5: 6 } });
    openHour(sim, 3);
    const co = ['p1', 'p2', 'p3'];
    const sent = [];
    const seat = mountShared(ui, sim, 'p1', sent);
    showTwice(seat, sim.view('p1'), sharedCtx(sim, co));
    const r = seat.root;
    assert.equal(byCls(r, 'ct-co').length, 1, 'the combined screen');
    const txt = visibleText(r);
    assert.ok(txt.includes('你哋一齊醒：玩家1、玩家2、玩家3'), txt);
    assert.ok(txt.includes('玩家1 偷走咗芝士 — 你哋都睇到'), 'they all watched the theft');
    assert.ok(txt.includes('玩家1 要喺 玩家2、玩家3 入面揀 1 位做共犯'), 'the pick is made in front of the witnesses');
    assert.ok(!/你醒咗|同你一齊醒/.test(txt), 'written for all of them, not for one 「你」');
    // the pick: only the witnesses are live; the big button sends it AS THE THIEF
    const chip = (name) => byCls(r, 'ct-chip').find((n) => n.textContent === name);
    assert.equal(chip('玩家4').disabled, true, 'a sleeper cannot be picked');
    click(chip('玩家3'));
    click(byCls(r, 'ct-ack').find((n) => !n.hidden && n.parentNode && hasCls(n.parentNode, 'ct-co-shared')));
    assert.deepEqual(sent.at(-1), { pid: 'p1', a: { type: 'recruit', targets: ['p3'] }, changed: true });
    assert.deepEqual(sim.state.followers, ['p3']);
    showTwice(seat, sim.view('p1'), sharedCtx(sim, co));
    assert.ok(visibleText(r).includes('大盜揀咗 玩家3 做共犯'), 'every co-waker sees whom the thief picked');
    assert.ok(!visibleText(r).includes('要喺'), 'the pick is done');
    // the plain tap: "we have all seen it" — one ack for every co-waker, the hour keeps its length
    const d = sim.state.deadline;
    click(byCls(r, 'ct-ack').find((n) => n.parentNode && hasCls(n.parentNode, 'ct-co-shared')));
    assert.deepEqual(sent.at(-1).a, { type: 'ack', seats: co });
    for (const p of co) assert.ok(sim.state.acked.includes(p), `${p} acked`);
    assert.equal(sim.state.deadline, d, 'the window never ends early');
    assert.deepEqual(engine.focus(sim.state).pids, co, 'everyone stays awake (in focus) all hour');
    assert.ok(!sent.some((x) => x.a.type === 'done'), 'the old chained walk is gone');
    seat.handle.destroy();
  });
});

test('cheese-thief ui: co-wakers — what only one of them knows or may do sits behind its own 🤫 panel; the shared part never shows who the thief is (4p wait-or-steal)', async () => {
  await withFakeDom(async (ui) => {
    // 4p: p1 (thief, wakes at two and five) and p2 (keeps its two) are awake together at two; the cheese is still there
    const make = (thief) => {
      const sim = scenario(4, { thief, dice: { p1: [2, 5], p2: [2, 6], p3: [1, 1], p4: [3, 4] }, pick4: { p2: 2, p3: 1, p4: 3 }, config: { ...config.defaults(4, undefined, { singleDevice: true }) } });
      openHour(sim, 2);
      return sim;
    };
    const sim = make('p1');
    assert.equal(sim.view('p1').nightSeat.steal.can, true);
    const co = ['p1', 'p2'];
    const sent = [];
    const seat = mountShared(ui, sim, 'p1', sent);
    showTwice(seat, sim.view('p1'), sharedCtx(sim, co));
    const r = seat.root;
    const shared = () => byCls(r, 'ct-co-shared')[0];
    const own = () => byCls(r, 'ct-co-priv')[0];
    // at a glance the shared part is word for word what it would be if p1 were a plain sleepyhead
    const other = make('p4');           // p4 wakes at three and four: at two, p1 and p2 are plain sleepyheads
    const twin = mountShared(ui, other, 'p1', []);
    showTwice(twin, other.view('p1'), sharedCtx(other, co));
    assert.equal(visibleText(shared()), visibleText(byCls(twin.root, 'ct-co-shared')[0]), 'the shared part says nothing about who may steal');
    assert.ok(!visibleText(shared()).includes('大盜'));
    assert.ok(visibleText(shared()).includes('芝士仲喺枱上'));
    // 🤫 玩家1: only now does p1 read its choice; the same-shaped button steals
    const ownBtn = (name) => byCls(r, 'ct-co-me').find((n) => n.textContent.includes(name));
    click(ownBtn('玩家1'));
    showTwice(seat, sim.view('p1'), sharedCtx(sim, co));
    assert.equal(shared().hidden, true, 'the shared part steps aside');
    assert.ok(visibleText(own()).includes('淨係 玩家1 睇 — 其他人望開'));
    assert.ok(visibleText(own()).includes('等五點鐘'), 'its own choice: steal now or wait');
    assert.equal(byCls(own(), 'die').length, 2, 'its own two dice');
    const shapeOf = (n) => JSON.stringify(n.children.map((c) => [c.tag, [...c.cls].sort()]));
    const p1Shape = shapeOf(own());
    click(byCls(own(), 'ct-ack')[0]);
    assert.deepEqual(sent.at(-1), { pid: 'p1', a: { type: 'steal' }, changed: true });
    click(byCls(own(), 'ct-co-back')[0]);
    showTwice(seat, sim.view('p1'), sharedCtx(sim, co));
    assert.ok(visibleText(shared()).includes('玩家1 偷走咗芝士 — 你哋都睇到'), 'the witness saw the cheese go');
    // 🤫 玩家2: the same panel, nothing to do — its tap acks as p2
    click(ownBtn('玩家2'));
    showTwice(seat, sim.view('p1'), sharedCtx(sim, co));
    assert.equal(shapeOf(own()), p1Shape, 'every co-waker\'s own panel has the same shape');
    assert.ok(visibleText(own()).includes('冇嘢要做'));
    click(byCls(own(), 'ct-ack')[0]);
    assert.deepEqual(sent.at(-1).pid, 'p2');
    assert.deepEqual(sent.at(-1).a, { type: 'ack' });
    seat.handle.destroy();
    twin.handle.destroy();
  });
});

test('cheese-thief ui: the 7p meeting on one phone — the crew is shared; whether a follower knows the thief stays on its own panel', async () => {
  await withFakeDom(async (ui) => {
    // p1 steals at three with p2 watching; p3 never saw it
    const sim = scenario(7, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 5, p4: 1, p5: 2, p6: 4, p7: 6 } });
    runTo(sim, stepIndex(sim, 'rec-pick'), 'window');
    assert.ok(sim.act('p1', { type: 'recruit', targets: ['p2', 'p3'] }));
    runTo(sim, stepIndex(sim, 'rec-meet'), 'window');
    const co = ['p2', 'p3'];
    const seat = mountShared(ui, sim, 'p2', []);
    showTwice(seat, sim.view('p2'), sharedCtx(sim, co));
    const shared = byCls(seat.root, 'ct-co-shared')[0];
    assert.ok(visibleText(shared).includes('共犯：玩家2、玩家3'));
    assert.ok(!visibleText(shared).includes('玩家1'), 'who the thief is never reaches the shared part');
    const open = (name) => {
      click(byCls(seat.root, 'ct-co-me').find((n) => n.textContent.includes(name)));
      showTwice(seat, sim.view('p2'), sharedCtx(sim, co));
      return visibleText(byCls(seat.root, 'ct-co-priv')[0]);
    };
    assert.ok(open('玩家2').includes('大盜係 玩家1（你夜晚親眼見到佢偷）'));
    click(byCls(seat.root, 'ct-co-back')[0]);
    assert.ok(open('玩家3').includes('你唔知大盜係邊個'));
    seat.handle.destroy();
  });
});

test('cheese-thief ui: one phone, a lone sleepyhead — the peek is ONE tap; unusable names are dimmed; the bar runs from the fixed window and says 時間到 (#7, #36)', async () => {
  await withFakeDom(async (ui) => {
    const cfg = config.defaults(5, undefined, { singleDevice: true });
    const sim = scenario(5, { thief: 'p1', dice: { p1: 6, p2: 1, p3: 2, p4: 3, p5: 4 }, config: cfg });
    openHour(sim, 1);
    const len = sim.state.deadline - sim.now;
    assert.equal(len, (10 + game.PASS_PAD_SEC) * 1000, 'the official hour plus the hand-over pad');
    assert.equal(sim.view('p2').step.windowMs, len);
    sim.now = sim.state.deadline - 5000;          // the gate and the pick-up took 15 s
    const sent = [];
    const seat = mountShared(ui, sim, 'p2', sent);
    showTwice(seat, sim.view('p2'), sharedCtx(sim));
    const r = seat.root;
    const bar = byCls(r, 'ct-bar')[0];
    assert.equal(byCls(r, 'ct-bar-text')[0].textContent, '仲有 5 秒');
    assert.equal(bar.children[0].styleMap.transform, 'scaleX(0.250)', 'drawn from the fixed 20 s, not from when the screen mounted');
    assert.equal(bar.attrs.role, 'progressbar');
    assert.equal(bar.attrs['aria-valuetext'], '仲有 5 秒');
    const lines = byCls(r, 'ct-line');
    assert.ok(lines.length <= 3, `a short awake card on one phone (${lines.length} lines)`);
    assert.ok(visibleText(r).includes('㩒一個名就即刻偷睇'));
    // one tap on a name is the peek
    click(byCls(r, 'ct-chip').find((n) => n.textContent === '玩家4'));
    assert.deepEqual(sent.at(-1), { pid: 'p2', a: { type: 'peek', target: 'p4' }, changed: true });
    showTwice(seat, sim.view('p2'), sharedCtx(sim));
    assert.ok(byCls(r, 'ct-chip').every((n) => n.disabled), 'nothing left to pick: every name is dimmed');
    assert.equal(byCls(r, 'ct-grid')[0].cls.has('is-dim'), true);
    assert.equal(byCls(r, 'ct-ack-sub')[0].textContent, ui.ACK_SHARED);
    assert.ok(!visibleText(r).includes('自己部機'), 'never 「望住自己部機」 on the phone in the middle');
    sim.now = sim.state.deadline;
    showTwice(seat, sim.view('p2'), sharedCtx(sim));
    assert.equal(byCls(r, 'ct-bar-text')[0].textContent, ui.TIME_UP_SHARED);
    seat.handle.destroy();
    // a phone of its own keeps the two-tap peek (it must look like a sleeper's decoy)
    const own = scenario(5, { thief: 'p1', dice: { p1: 6, p2: 1, p3: 2, p4: 3, p5: 4 } });
    openHour(own, 1);
    const s2 = [];
    const seats = mountAll(ui, own, s2);
    pushViews(own, seats);
    click(findAll(seats.p2.root, (n) => hasCls(n, 'ct-chip') && n.textContent === '玩家4')[0]);
    assert.equal(s2.length, 0, 'a name tap alone sends nothing on a phone of its own');
    assert.ok(findAll(seats.p2.root, (n) => hasCls(n, 'ct-chip')).every((n) => !n.disabled));
    for (const s of Object.values(seats)) s.handle.destroy();
  });
});

test('cheese-thief ui: by day on a whole-table phone — 夠鐘投票 is one tap from the middle (locked while the card is up), a seat\'s own screen points there, and no shared screen says 「你」 (#5, #20)', async () => {
  await withFakeDom(async (ui) => {
    const sim = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 1, p3: 2, p4: 4, p5: 5 } });
    finishNight(sim);
    const sent = [];
    const table = mountShared(ui, sim, null, sent);
    showTwice(table, sim.view(null), sharedCtx(sim, [], { atTable: true, tableLocked: true }));
    const btn = byCls(table.root, 'ct-table-ready')[0];
    assert.equal(btn.hidden, false);
    assert.equal(btn.textContent, ui.TABLE_READY);
    assert.ok(!btn.textContent.includes('一下就得'));
    assert.equal(btn.disabled, true, 'U5: locked until the 「擺返中間」 card is tapped');
    assert.ok(!visibleText(table.root).includes('想投票：'), 'no n / m waiting list');
    assert.ok(byCls(table.root, 'c-timer').length === 1, 'the clock is on the table screen');
    // re-run N4: the dawn re-check, once for the whole table (5p), under the clock
    const rc = byCls(table.root, 'ct-table-recheck')[0];
    assert.equal(rc.hidden, false);
    assert.equal(rc.textContent, ui.RECHECK_TABLE);
    showTwice(table, sim.view(null), sharedCtx(sim, [], { atTable: true, tableLocked: false }));
    // re-run N2: 夠鐘投票 ends the talk for everybody, so the first tap only arms (naming the time still on the clock)
    sim.now = sim.state.deadline - 170_000;
    click(btn);
    assert.equal(sent.length, 0, 'the first tap sends nothing');
    assert.equal(sim.state.phase, 'day');
    assert.equal(table.tableCalls.at(-1).opts.confirm, '全枱傾夠未？仲有 2:50');
    assert.equal(table.tableCalls.at(-1).opts.node, btn, 'the button itself is armed');
    click(btn);
    assert.deepEqual(sent.at(-1).a, { type: 'day-ready', on: true, seats: ids(5), table: true });
    assert.equal(sim.state.phase, 'vote', 'the second tap is the table\'s decision');
    showTwice(table, sim.view(null), sharedCtx(sim, [], { atTable: true }));
    assert.equal(byCls(table.root, 'ct-table-recheck')[0].hidden, true, 'not during the vote');
    table.handle.destroy();
    assert.equal(ui.tableReadyConfirm(0), '全枱傾夠未？');
    assert.equal(ui.tableReadyConfirm(65_000), '全枱傾夠未？仲有 1:05');

    // 4p never has a follower: no re-check line on the table
    const four = scenario(4, { thief: 'p1', dice: { p1: [3, 4], p2: [1, 2], p3: [2, 5], p4: [4, 6] } });
    finishNight(four);
    const t4 = mountShared(ui, four, null, []);
    showTwice(t4, four.view(null), sharedCtx(four, [], { atTable: true }));
    assert.equal(byCls(t4.root, 'ct-table-recheck')[0].hidden, true);
    t4.handle.destroy();

    // a seat picked by hand by day: its own card, dice and 📓 — and where the table button is
    const day = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 1, p3: 2, p4: 4, p5: 5 } });
    finishNight(day);
    const seat = mountShared(ui, day, 'p2', []);
    showTwice(seat, day.view('p2'), sharedCtx(day));
    assert.ok(!findAll(seat.root, (n) => n.tag === 'button' && !n.hidden && n.textContent.includes('夠鐘投票')).length, 'no per-seat 夠鐘投票');
    assert.ok(visibleText(seat.root).includes('擺返中間，喺枱面㩒「夠鐘投票」'));
    assert.equal(seat.cards.at(-1).props.onLockToggle, undefined, '#36: no 🔓 lock on a phone passed round (it would not survive the hand-over)');
    seat.handle.destroy();

    // a spectator table (not a shared phone) has no table button
    const spect = mountAll(ui, day, []);
    pushViews(day, spect);
    assert.equal(byCls(spect.table.root, 'ct-table-ready')[0].hidden, true);
    for (const s of Object.values(spect)) s.handle.destroy();

    // the end: 🧀 完咗 for the whole table, never 「你贏咗」 / 「（你）」 on a shared phone
    const end = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 1, p3: 2, p4: 4, p5: 5 } });
    playOut(end, {});
    const over = mountShared(ui, end, 'p2', []);
    showTwice(over, end.view('p2'), sharedCtx(end));
    const t = visibleText(over.root);
    assert.ok(t.includes('🧀 完咗'));
    assert.ok(!/你贏咗|你輸咗|（你）/.test(t), t);
    over.handle.destroy();
  });
});

test('cheese-thief ui: every night screen has the same silent "your dice" cover in its title row; the peek result is first in the card', async () => {
  await withFakeDom(async (ui) => {
    const sim = scenario(6, { thief: 'p1', dice: { p1: 3, p2: 2, p3: 1, p4: 4, p5: 5, p6: 6 } });
    const sent = [];
    const seats = mountAll(ui, sim, sent);
    openHour(sim, 2);
    pushViews(sim, seats);
    const mine = seats.comps.covers.filter((c) => c.props?.backArt === '🎲');
    assert.ok(mine.length >= 6);
    for (const c of mine) assert.equal(c.props.openSound, 'none', 'silent at night');
    for (const x of ids(6)) {
      const night = findAll(seats[x].root, (n) => hasCls(n, 'ct-night'))[0];
      const box = findAll(night, (n) => hasCls(n, 'ct-mydice'))[0];
      assert.ok(box && indexOfCls(night, 'ct-mydice') < indexOfCls(night, 'ct-panel'), 'above the info card');
      assert.ok(findAll(night, (n) => hasCls(n, 'ct-n-head'))[0].children.includes(box), 'in the title row (keeps the big button up on a small phone)');
      assert.equal(findAll(box, (n) => hasCls(n, 'die')).map((d) => d.textContent).join(), String(sim.state.dice[x][0]), 'its own die, under the cover');
    }
    // p2 peeks: the result cover is the first thing in the fixed-height card
    click(findAll(seats.p2.root, (n) => hasCls(n, 'ct-chip') && n.textContent === '玩家4')[0]);
    click(findAll(seats.p2.root, (n) => hasCls(n, 'ct-ack'))[0]);
    pushViews(sim, seats);
    const panel = findAll(seats.p2.root, (n) => hasCls(n, 'ct-panel'))[0];
    assert.ok(hasCls(panel.children[0], 'ct-peekwrap') && !panel.children[0].hidden);
    for (const s of Object.values(seats)) s.handle.destroy();
  });
});

// ============================================================
// decisions 2026-10-04: D4 absent seats, D6 secret own vote, the missed-peek line
// ============================================================

const ABSENT = (pid) => ({ type: ACT.ABSENT ?? '@absent', pid });
const PRESENT = (pid) => ({ type: ACT.PRESENT ?? '@present', pid });

test('cheese-thief: @absent at the roll — the night does not wait; an absent seat that never rolled gets its die; @present counts it again (D4)', () => {
  for (const n of [4, 5, 8]) {
    const sim = new Sim(game, { n, seed: 9 + n });
    const all = ids(n);
    for (const p of all.slice(0, n - 2)) sim.act(p, { type: 'ready' });
    assert.equal(sim.state.phase, 'roll');
    const [a, b] = all.slice(n - 2);
    assert.ok(sim.host(ABSENT(a)));
    assert.deepEqual(view(sim, all[0]).ready, { done: n - 2, total: n - 1 }, 'the count is of the seats the night waits for');
    assert.deepEqual(sim.focus().pids, [b]);
    assert.equal(engine.blocking(sim.state, a), false);
    assert.equal(engine.blocking(sim.state, b), true);
    assert.equal(sim.host(ABSENT(a)), false, 'already absent');
    assert.ok(sim.host(PRESENT(a)));
    assert.equal(engine.blocking(sim.state, a), true, 'back: waited on again');
    assert.equal(sim.host(PRESENT(a)), false, 'already present');
    sim.host(ABSENT(a));
    sim.act(b, { type: 'ready' });                                 // the last present seat: night, with a's die rolled for it
    assert.equal(sim.state.phase, 'night', `n=${n}`);
    assert.ok(Array.isArray(sim.state.dice[a]) && sim.state.locked[a] && sim.state.wake[a].length >= 1);
    if (n === 4 && sim.state.role[a] !== 'thief') assert.ok(sim.state.dice[a].includes(sim.state.pick4[a]));
  }
  // what never changes: unknown seats, a missing pid, a seat sending it, anything after the end
  const sim = new Sim(game, { n: 5, seed: 3 });
  for (const bad of [ABSENT('nobody'), ABSENT(null), { type: ACT.ABSENT ?? '@absent' }, PRESENT('p1')]) assert.equal(sim.host(bad), false, JSON.stringify(bad));
  assert.equal(sim.act('p1', ABSENT('p2')), false);
  const done = scenario(5);
  playOut(done, {});
  assert.equal(done.host(ABSENT('p2')), false, 'over');
});

test('cheese-thief: @absent by day and at the vote — 夠鐘投票 and the vote count present seats; no vote from an absent seat; it can still be caught (D4)', () => {
  const sim = scenario(5, { thief: 'p5', config: { ...config.defaults(5), discussSec: 0 } });
  finishNight(sim);
  for (const p of ['p1', 'p2', 'p3']) sim.act(p, { type: 'day-ready', on: true });
  assert.deepEqual(view(sim, 'p1').dayReady, { done: 3, total: 5, mine: true });
  assert.ok(sim.host(ABSENT('p5')));
  assert.deepEqual(view(sim, 'p1').dayReady, { done: 3, total: 4, mine: true });
  assert.equal(engine.blocking(sim.state, 'p5'), false);
  assert.equal(engine.blocking(sim.state, 'p4'), true);
  sim.act('p4', { type: 'day-ready', on: true });
  assert.equal(sim.state.phase, 'vote', 'the absent seat did not hold up 夠鐘投票');
  // the vote: p5 casts nothing, is still a candidate, and is never waited for
  assert.equal(sim.act('p5', { type: 'vote', target: 'p1' }), false);
  assert.deepEqual(sim.legal('p5'), []);
  assert.equal(engine.autoAct(sim.state, 'p5', sim.ctx()), null);
  assert.ok(view(sim, 'p1').candidates.includes('p5'));
  assert.equal(view(sim, 'p1').progress.total, 4);
  assert.equal(view(sim, 'p5').hint, HINT.absent);
  assert.deepEqual(sim.focus().pids, ['p1', 'p2', 'p3', 'p4']);
  for (const p of ['p1', 'p2', 'p3', 'p4']) sim.act(p, { type: 'vote', target: 'p5' });
  assert.equal(sim.state.phase, 'reveal');
  assert.deepEqual(sim.state.final.top, ['p5']);
  sim.advance();
  assert.equal(sim.result().mode, 'caught', 'an absent thief is caught like anybody');

  // a vote cast before the seat left still counts; marking the last missing voter closes the vote
  const v2 = scenario(5, { thief: 'p1' });
  toVote(v2);
  v2.act('p2', { type: 'vote', target: 'p1' });
  v2.host(ABSENT('p2'));
  assert.equal(v2.state.votes.p2, 'p1', 'its ballot stands');
  assert.equal(view(v2, 'p1').progress.total, 5, 'and stays in the count');
  for (const p of ['p1', 'p3', 'p4']) v2.act(p, { type: 'vote', target: 'p2' });
  assert.equal(v2.state.phase, 'vote', 'p5 is still present');
  assert.ok(v2.host(ABSENT('p5')));
  assert.equal(v2.state.phase, 'reveal', 'nobody left to wait for');
  assert.equal(v2.state.votes.p5, undefined);

  // @present at the vote: it is waited for again
  const v3 = scenario(5);
  toVote(v3);
  v3.host(ABSENT('p3'));
  for (const p of ['p1', 'p2', 'p4']) v3.act(p, { type: 'vote', target: 'p3' });
  v3.host(PRESENT('p3'));
  v3.act('p5', { type: 'vote', target: 'p3' });
  assert.equal(v3.state.phase, 'vote', 'p3 is back and has not voted');
  v3.act('p3', { type: 'vote', target: 'p1' });
  assert.equal(v3.state.phase, 'reveal');
});

test('cheese-thief: engine.blocking — the roll, 夠鐘投票 and the vote; never at night, so a stall banner never points at who is awake (D4)', () => {
  const sim = scenario(5, { dice: { p1: 2, p2: 2, p3: 3, p4: 4, p5: 5 } });
  for (let guard = 0; guard < 200 && sim.state.phase === 'night'; guard++) {
    for (const p of ids(5)) assert.equal(engine.blocking(sim.state, p), false, `night ${st(sim).k}/${sim.state.stage}: ${p}`);
    if (sim.state.stage === 'cue') sim.cueDone(); else sim.advance();
  }
  assert.equal(sim.state.phase, 'day');
  for (const p of ids(5)) assert.equal(engine.blocking(sim.state, p), true);
  sim.act('p1', { type: 'day-ready', on: true });
  assert.equal(engine.blocking(sim.state, 'p1'), false);
  assert.equal(engine.blocking(sim.state, 'nobody'), false);
});

test('cheese-thief: absent seats are public — every phone and the table list the same 💤 seats (D4)', () => {
  const sim = scenario(6);
  sim.host(ABSENT('p4'));
  sim.host(ABSENT('p2'));
  const lists = [...ids(6), null].map((p) => JSON.stringify(view(sim, p).absent));
  assert.equal(new Set(lists).size, 1);
  assert.deepEqual(JSON.parse(lists[0]), ['p2', 'p4'], 'seat order');
  assert.equal(view(sim, 'p4').my.absent, true);
  assert.equal(view(sim, 'p3').my.absent, undefined);
  // the night is untouched: the same hours, the same windows
  const plain = scenario(6);
  assert.deepEqual(sim.state.steps, plain.state.steps);
});

test('cheese-thief: fuzz — the host marks random seats absent and back; every game still ends with a consistent verdict (D4)', () => {
  let marks = 0;
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = new Sim(game, { n, seed: seed * 13 + n, config: { ...config.defaults(n), discussSec: seed % 2 ? 0 : 120 } });
      const rng = mulberry32(seed * 5 + n);
      const { result } = sim.runRandom({
        onStep: (x) => {
          const s = x.state;
          if (s.phase !== 'over' && rng() < 0.05) {
            const p = s.order[Math.floor(rng() * s.n)];
            x.host(s.absent?.[p] ? PRESENT(p) : ABSENT(p));
            marks++;
          }
          const t = x.state;
          for (const p of t.order) if (t.absent?.[p]) assert.equal(engine.blocking(t, p), false);
          if (t.phase === 'vote') assert.ok(t.order.some((p) => t.votes[p] === undefined && !t.absent?.[p]), 'the vote closes once every present seat has voted');
          if (x.steps % 7 === 0) leakCheck(x);
        },
      });
      assert.ok(result, `n=${n} seed=${seed}`);
      const s = sim.state;
      for (const p of Object.keys(s.votes)) assert.notEqual(s.votes[p], p);
    }
  }
  assert.ok(marks > 100, `the host marked seats ${marks} times`);
});

test('cheese-thief ui: your own vote is secret on your phone (D6); absent candidates carry 💤; an absent seat gets a 💤 line, not a ballot (D4)', async () => {
  await withFakeDom(async (ui) => {
    const sim = scenario(5);
    toVote(sim);
    sim.host(ABSENT('p3'));
    const seats = mountAll(ui, sim, []);
    const made = [];
    const base = seats.comps.VotePanel;
    seats.comps.VotePanel = (p) => { const x = base(p); made.push(x); return x; };
    pushViews(sim, seats);
    const ballots = made.filter((x) => !x.props.reveal);
    assert.equal(ballots.length, 5, 'one ballot screen per seat');
    for (const x of ballots) {
      assert.equal(x.props.secretChoice, true);
      const p3 = x.props.players.find((p) => p.id === 'p3');
      assert.ok(p3.name.endsWith('💤'), p3.name);
      assert.ok(!x.props.players.find((p) => p.id === 'p2').name.includes('💤'));
    }
    const text = (k) => seats[k].root.textContent;
    const ui3 = await import('../js/games/cheese-thief/ui.js');
    assert.ok(text('p3').includes(ui3.ABSENT_SELF));
    const panel3 = findAll(seats.p3.root, (n) => hasCls(n, 'c-votepanel'))[0];
    assert.equal(panel3.hidden, true, 'no ballot for the absent seat');
    for (const k of ['p1', 'p3', 'table']) assert.ok(text(k).includes(ui3.absentLine('玩家3')), `${k}: the public 💤 line`);
    for (const s of Object.values(seats)) s.handle.destroy();
  });
});

test('cheese-thief ui: a lone peeker is told 「睇唔切唔緊要：天光喺 📓 夜晚記錄睇得返」, before and after the peek; nobody else, and not without a 📓', async () => {
  await withFakeDom(async (ui) => {
    const { PEEK_LATER } = ui;
    assert.ok(PEEK_LATER.includes('睇唔切唔緊要') && PEEK_LATER.includes('📓'));
    const run = (recap) => {
      const sim = scenario(6, { thief: 'p1', dice: { p1: 3, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6 }, config: { ...config.defaults(6), recap } });
      const sent = [];
      const seats = mountAll(ui, sim, sent);
      openHour(sim, 2);                                            // p2 alone at two o'clock
      pushViews(sim, seats);
      const lines = (k) => findAll(seats[k].root, (n) => hasCls(n, 'ct-lines'))[0].textContent;
      assert.equal(lines('p2').includes(PEEK_LATER), recap, `recap=${recap}: before the peek`);
      for (const o of ['p1', 'p3', 'p4', 'p5', 'p6']) assert.ok(!lines(o).includes(PEEK_LATER), `${o} is asleep`);
      click(findAll(seats.p2.root, (n) => hasCls(n, 'ct-chip')).find((c) => c.textContent === '玩家4'));
      click(findAll(seats.p2.root, (n) => hasCls(n, 'ct-ack'))[0]);
      pushViews(sim, seats);
      assert.equal(lines('p2').includes(PEEK_LATER), recap, `recap=${recap}: after the peek`);
      // the thief awake at three with p3: no peek, no line
      openHour(sim, 3);
      pushViews(sim, seats);
      for (const k of ['p1', 'p3']) assert.ok(!lines(k).includes(PEEK_LATER), `${k} awake together`);
      for (const s of Object.values(seats)) s.handle.destroy();
    };
    run(true);
    run(false);
  });
});

test('cheese-thief ui: with seats marked 💤 and back through whole random games, every screen still renders for every seat, idempotently (D4)', async () => {
  await withFakeDom(async (ui) => {
    for (const [n, seed] of [[4, 2], [6, 5], [8, 7]]) {
      const sim = new Sim(game, { n, seed, config: { ...config.defaults(n), discussSec: 0 } });
      const seats = mountAll(ui, sim, []);
      const rng = mulberry32(seed * 101);
      sim.runRandom({
        onStep: (x) => {
          if (x.state.phase !== 'over' && rng() < 0.05) {
            const p = x.state.order[Math.floor(rng() * x.state.n)];
            x.host(x.state.absent?.[p] ? PRESENT(p) : ABSENT(p));
          }
          if (x.steps % 3 === 0) pushViews(x, seats);
        },
      });
      pushViews(sim, seats);
      for (const s of Object.values(seats)) s.handle.destroy();
    }
  });
});

// ============================================================
// one phone in the middle (DESIGN §7.1; one-phone playtest #5, #7, #8, U2, U6)
// ============================================================

test('cheese-thief: one phone (passPhone, U6) — every awake window gets the same 10 s hand-over pad, empty or not; it follows the room; an old 15 s one-phone hour migrates', () => {
  const one = config.defaults(5, undefined, { singleDevice: true });
  assert.equal(one.passPhone, true);
  assert.equal(one.hourSec, 10, 'the hour itself stays the official 10 s');
  assert.equal(config.fields(one, 5).some((f) => f.key === 'passPhone'), false, 'a hidden marker, not a form field');
  assert.ok(config.fields(one, 5).find((f) => f.key === 'hourSec').help.includes('加 10 秒交機'));
  assert.equal(config.validate(one, 5).ok, true);
  assert.ok(config.summary(one, 5).some((l) => l.includes('每個點鐘 20 秒（含交機 10 秒）')));
  assert.ok(config.summary(config.defaults(5), 5).some((l) => l.includes('每個點鐘 10 秒 ·')));
  // a second phone joins: the room re-runs defaults with prev = the config
  const joined = config.defaults(5, one, { singleDevice: false });
  assert.equal(joined.passPhone, false);
  assert.equal(config.defaults(5, joined, { singleDevice: true }).passPhone, true);
  assert.equal(config.defaults(5, one).passPhone, true, 'no env: kept as it was');
  // a config saved before the pad (its 15 s was the one-phone default) becomes 10 + pad; a choice made since stays
  assert.equal(config.defaults(5, { hourSec: 15 }, { singleDevice: true }).hourSec, 10);
  assert.equal(config.defaults(5, { hourSec: 15, passPhone: true }, { singleDevice: true }).hourSec, 15);
  assert.equal(config.defaults(5, { hourSec: 15 }, { singleDevice: false }).hourSec, 15);
  // the night: every window the length of its kind — crowded or empty, acted in or not
  for (const n of [4, 5, 6, 7, 8]) {
    const cfg = config.defaults(n, undefined, { singleDevice: true });
    const sim = scenario(n, { dice: { p1: 1, p2: 1, p3: 3, p4: 5, p5: 5, p6: 6, p7: 6, p8: 6 }, config: cfg });
    const tl = nightTimeline(sim, (x) => { for (const id of ids(n)) x.act(id, { type: 'ack' }); });
    const opens = tl.filter((r) => r[0] === 'window' && r[1] === 'open');
    assert.equal(opens.length, 6);
    for (const r of tl) if (r[0] === 'window') assert.equal(r[3], fixedWindow(cfg, r[1]), `n=${n} ${r[1]}${r[2] ?? ''}`);
    for (const r of opens) assert.equal(r[3], 20000, 'the official 10 s + the 10 s hand-over pad');
  }
});

test('cheese-thief: one phone — the begin and vote lines put the phone in the middle; one phone each keeps its own lines', () => {
  const one = scenario(5, { config: config.defaults(5, undefined, { singleDevice: true }) });
  assert.equal(one.state.steps[one.state.ix].k, 'begin');
  assert.equal(one.cue().text, narrate({ k: 'begin' }, 5, { passPhone: true }));
  assert.ok(one.cue().text.includes('部手機擺喺枱中間') && !one.cue().text.includes('面前'));
  toVote(one);
  assert.ok(one.cue().text.includes('部手機逐個交'));
  const own = scenario(5);
  assert.equal(own.cue().text, narrate({ k: 'begin' }, 5));
  assert.ok(own.cue().text.includes('手機放喺面前'));
  toVote(own);
  assert.equal(own.cue().text, VOTE_CALL);
  // the hour lines never change: a phone in the middle still hears the same frame every hour
  for (let h = 1; h <= 6; h++) assert.equal(narrate({ k: 'open', h }, 5, { passPhone: true }), narrate({ k: 'open', h }, 5));
});

test('cheese-thief: `seats` (§7.1) — one whole-table tap readies every listed seat for the vote; co-wakers ack together; a seat of its own still counts once', () => {
  const sim = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 3, p4: 1, p5: 6 } });
  openHour(sim, 3);
  const d = sim.state.deadline;
  assert.ok(sim.act('p2', { type: 'ack', seats: ['p2', 'p3', 'nobody', 7, null] }));
  assert.deepEqual(sorted(sim.state.acked), ['p2', 'p3']);
  assert.equal(sim.state.deadline, d, 'acking never ends a window');
  assert.deepEqual(engine.focus(sim.state).pids, ['p1', 'p2', 'p3'], 'and never drops a seat from focus');
  finishNight(sim);
  assert.ok(sim.act('p1', { type: 'day-ready', on: true, seats: ['p1', 'p2'] }));
  assert.equal(sim.view('p4').dayReady.done, 2);
  assert.ok(sim.act('p3', { type: 'day-ready', on: true }));
  assert.equal(sim.view('p4').dayReady.done, 3, 'a seat of its own counts once');
  assert.ok(sim.act('p1', { type: 'day-ready', on: false, seats: ['p1', 'p2'] }));
  assert.equal(sim.view('p4').dayReady.done, 1, 'and both can take it back at once');
  assert.equal(sim.act('p1', { type: 'day-ready', on: true, seats: 'p2' }), true, 'junk seats: only the sender counts');
  assert.equal(sim.view('p4').dayReady.done, 2);
  assert.ok(sim.act('p1', { type: 'day-ready', on: true, seats: ids(5), table: true }));
  assert.equal(sim.state.phase, 'vote', 'the phone holding the whole table decides in one tap');
  assert.deepEqual(engine.focus(sim.state), { pids: ids(5), label: '投票' }, 'the vote gate names the step (#33)');
});

test('cheese-thief: the table view (the phone in the middle) carries the clock and 想投票, and no night tap counter', () => {
  const sim = scenario(5, { thief: 'p1', dice: { p1: 3, p2: 3, p3: 3, p4: 1, p5: 6 } });
  openHour(sim, 3);
  for (const id of ids(5)) sim.act(id, { type: 'ack' });
  const t = sim.view(null);
  assert.equal(t.night, true, 'night on the table view: the shell can tell dawn from it');
  assert.ok(!('acks' in t), 'the table never counts taps (on a shared phone only the awake would tap)');
  assert.ok('acks' in sim.view('p4'), 'a seat still has its own count');
  finishNight(sim);
  const day = sim.view(null);
  assert.equal(day.night, undefined);
  assert.equal(typeof day.deadline, 'number');
  assert.deepEqual(day.dayReady, { done: 0, total: 5 });
});

test('cheese-thief (re-run #5): every view and the table name the roles of this game (view.rolesInPlay) — the 💡 sheet lists only those', async () => {
  const { hintRoles } = await import('../js/ui/logic.js');
  const five = scenario(5, { thief: 'p2' });
  for (const pid of [null, 'p1', 'p2']) {
    const h = hintRoles(five.view(pid), game.rules);
    assert.equal(h.inPlay, true);
    assert.deepEqual(h.roles.map((r) => [r.id, r.count]), [['thief', 1], ['sleepyhead', 4], ['follower', null]]);
  }
  const four = scenario(4, { thief: 'p1' });
  assert.deepEqual(hintRoles(four.view(null), game.rules).roles.map((r) => r.id), ['thief', 'sleepyhead'], '4p: no follower');
  const fm = new Sim(game, { n: 6, seed: 2, config: { ...config.defaults(6), fallMouse: true } });
  assert.deepEqual(hintRoles(fm.view(null), game.rules).roles.map((r) => [r.id, r.count]), [['thief', 1], ['sleepyhead', 4], ['follower', null], ['fall-mouse', 1]]);
});
