// ============================================================
// tests/spyfall.test.mjs — rules, edge cases, leak checks and a fuzzer for the
// Spyfall engine. Run:  node tests/run.mjs spyfall
// ============================================================

import { test, Sim, assert, HOST, ACT, makePlayers, makeBag } from './lib.mjs';
import { mulberry32, clone } from '../js/core/engine-kit.js';
import * as game from '../js/games/spyfall/game.js';

const { engine } = game;

// ---------- fixture: 36 locations, ids that are never substrings of each other ----------
const pad = (i) => String(i).padStart(2, '0');
const FIXTURE = Array.from({ length: 36 }, (_, i) => ({
  name: `地點${pad(i)}`,
  emoji: '📍',
  cat: i < 12 ? '經典' : i < 20 ? '日本' : i < 28 ? '香港' : '奇幻科幻',
  roles: Array.from({ length: 7 }, (_, j) => `地點${pad(i)}角色${j}`),
}));
const banks = { spyfall: FIXTURE };

// ---------- helpers ----------
function mk(n, { seed = 1, config = {}, bank = FIXTURE } = {}) {
  return new Sim(game, { n, seed, config: { ...game.config.defaults(n), ...config }, banks: { spyfall: bank } });
}
const ids = (sim) => sim.players.map((p) => p.id);
const R = (sim) => sim.state.round;
const spyOf = (sim) => R(sim).spies[0];
const nonSpies = (sim) => ids(sim).filter((id) => !R(sim).spies.includes(id));
const readyAll = (sim) => { for (const id of ids(sim)) sim.act(id, { type: 'ready' }); return sim; };
const playing = (n, opts) => readyAll(mk(n, opts));
const changed = (sim, pid, action) => sim.act(pid, action);
const phase = (sim) => sim.state.phase;

/** Everyone who still has a vote casts `yes` (suspect excluded automatically by legalActions). */
function voteAll(sim, yes, { except = [] } = {}) {
  for (const id of ids(sim)) {
    if (phase(sim) !== 'vote') return;
    if (except.includes(id)) continue;
    const opt = sim.legal(id).find((a) => a.type === 'vote' && a.yes === yes);
    if (opt) sim.act(id, opt);
  }
}

/** Let a finished tally linger and move on. */
function settle(sim) { if (phase(sim) === 'tally') sim.advance(); }

/** Run the clock out: warning first, then 0:00. */
function timeUp(sim) {
  while (phase(sim) === 'play') assert.ok(sim.advance(), 'clock must advance');
}

/** Finish the round with a spy guess that is wrong. */
function wrongGuess(sim) {
  const spy = spyOf(sim);
  sim.act(spy, { type: 'spy-stop' });
  while (phase(sim) === 'guess') {
    const g = R(sim).guess;
    sim.act(g.order[g.idx], { type: 'guess', loc: (R(sim).loc + 1) % sim.state.list.length });
  }
}

function playRounds(sim) {
  readyAll(sim);
  wrongGuess(sim);
  while (phase(sim) === 'roundEnd') {
    sim.act('p1', { type: 'next-round' });
    if (phase(sim) === 'reveal') { readyAll(sim); wrongGuess(sim); }
  }
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// ============================================================
// meta, rules, config
// ============================================================

test('spyfall: module shape', () => {
  for (const k of ['meta', 'rules', 'config', 'engine']) assert.ok(game[k], `export ${k}`);
  for (const k of ['setup', 'act', 'advance', 'view', 'cue', 'focus', 'autoAct', 'legalActions', 'result']) {
    assert.equal(typeof engine[k], 'function', `engine.${k}`);
  }
  const m = game.meta;
  assert.equal(m.id, 'spyfall');
  assert.deepEqual(m.banks, ['spyfall']);
  assert.ok(m.players[0] >= 3 && m.players[1] >= 8);
  assert.ok(['required', 'recommended', 'optional', 'none'].includes(m.narration));
  assert.ok(['full', 'partial', 'none'].includes(m.singleDevice));
  assert.ok(game.rules.quick.length >= 5 && game.rules.quick.every((l) => typeof l === 'string'));
  assert.ok(game.rules.roles.length >= 2 && game.rules.sections.length >= 5);
  for (const sec of game.rules.sections) assert.ok(sec.title && sec.body);
});

test('spyfall: config defaults are valid for every head-count and follow the timer table', () => {
  const table = { 3: 6, 4: 6, 5: 7, 6: 7, 7: 8, 8: 8, 9: 9, 10: 9, 11: 10, 12: 10 };
  for (let n = game.meta.players[0]; n <= game.meta.players[1]; n++) {
    const cfg = game.config.defaults(n);
    const v = game.config.validate(cfg, n);
    assert.ok(v.ok, `n=${n}: ${v.message}`);
    assert.equal(cfg.minutes, table[n], `minutes for ${n}`);
    assert.equal(cfg.spies, n >= 9 ? 2 : 1, `spies for ${n}`);
    assert.ok(game.config.fields(cfg, n).length >= 5);
    assert.ok(game.config.summary(cfg, n).every((l) => typeof l === 'string'));
  }
});

test('spyfall: config.defaults keeps tastes from prev but re-derives time and spies', () => {
  const prev = { rounds: 5, minutes: 15, spies: 2, listSize: 30, voteMode: 'hands', categories: { cats: ['日本'] } };
  const cfg = game.config.defaults(4, prev);
  assert.equal(cfg.rounds, 5);
  assert.equal(cfg.listSize, 30);
  assert.equal(cfg.voteMode, 'hands');
  assert.deepEqual(cfg.categories, { cats: ['日本'] });
  assert.deepEqual(game.config.defaults(4, { categories: ['香港'] }).categories, { cats: ['香港'] }, 'a bare array is tolerated');
  assert.equal(cfg.minutes, 6);
  assert.equal(cfg.spies, 1);
  // junk in prev is ignored
  const junk = game.config.defaults(5, { rounds: 99, listSize: 7, voteMode: 'x', categories: 7 });
  assert.deepEqual(junk, game.config.defaults(5));
});

test('spyfall: config.validate rejects nonsense and warns about odd setups', () => {
  const ok = (cfg, n) => game.config.validate(cfg, n);
  const base = (n) => game.config.defaults(n);
  assert.equal(ok(base(5), 2).ok, false);
  assert.equal(ok(base(5), 13).ok, false);
  assert.equal(ok({ ...base(5), rounds: 0 }, 5).ok, false);
  assert.equal(ok({ ...base(5), rounds: 11 }, 5).ok, false);
  assert.equal(ok({ ...base(5), minutes: 1 }, 5).ok, false);
  assert.equal(ok({ ...base(5), spies: 3 }, 5).ok, false);
  assert.equal(ok({ ...base(5), spies: 2 }, 5).ok, false, 'two spies need 6+');
  assert.equal(ok({ ...base(6), spies: 2 }, 6).ok, true);
  assert.equal(ok({ ...base(5), listSize: 7 }, 5).ok, false);
  assert.equal(ok({ ...base(5), voteMode: 'x' }, 5).ok, false);
  assert.equal(ok({ ...base(5), categories: { cats: [1] } }, 5).ok, false);
  assert.equal(ok({ ...base(5), categories: 'x' }, 5).ok, false);
  assert.equal(ok({ ...base(5), categories: { cats: ['日本'] } }, 5).ok, true);
  assert.ok(ok({ ...base(5), categories: { cats: ['日本'] } }, 5).warnings.some((w) => /一個類別/.test(w)));
  assert.equal(ok(null, 5).ok, false);
  assert.ok(ok(base(3), 3).warnings.length >= 1, '3 players warns');
  assert.ok(ok({ ...base(10), spies: 1 }, 10).warnings.some((w) => /2 個間諜/.test(w)));
  assert.ok(ok({ ...base(7), spies: 2 }, 7).warnings.length >= 1, 'two spies below 9 warns');
  assert.deepEqual(ok(base(6), 6).warnings, []);
});

test('spyfall: config.fields only edit keys that config.defaults owns, with sane types', () => {
  const types = ['int', 'bool', 'select', 'seconds', 'roles', 'categories'];
  for (let n = 3; n <= 12; n++) {
    const cfg = game.config.defaults(n);
    for (const f of game.config.fields(cfg, n)) {
      assert.ok(f.key in cfg, `field ${f.key} has no default`);
      assert.ok(types.includes(f.type), f.type);
      assert.ok(f.label);
      if (f.type === 'int') assert.ok(Number.isInteger(f.min) && Number.isInteger(f.max) && f.min <= cfg[f.key] && cfg[f.key] <= f.max, `${f.key} default inside its range`);
      if (f.type === 'select') assert.ok(f.options.some((o) => (o.value ?? o) === cfg[f.key]), `${f.key} default is one of the options`);
    }
  }
  // every categories option exists in CATEGORIES, and the spies field never offers two below 6 players
  const f = game.config.fields(game.config.defaults(5), 5);
  const spyValues = (fs) => fs.find((x) => x.key === 'spies').options.map((o) => o.value);
  assert.deepEqual(spyValues(f), [1]);
  assert.deepEqual(spyValues(game.config.fields(game.config.defaults(6), 6)), [1, 2]);
  assert.deepEqual(f.find((x) => x.type === 'categories').options.map((o) => o.value), game.CATEGORIES);
  // the head-count reason is readable in the form today (the spies field's help)
  assert.match(f.find((x) => x.key === 'spies').help, /5 人：1 個間諜 · 每局 7 分鐘 — 官方建議/);
  // the two-spy threshold only shows up when two spies are chosen
  assert.equal(f.some((x) => x.key === 'twoSpyThreshold'), false);
  const two = game.config.fields({ ...game.config.defaults(9), spies: 2 }, 9);
  assert.deepEqual(two.find((x) => x.key === 'twoSpyThreshold').options.map((o) => o.value), ['n-2', 'n-3']);
});

test('spyfall: index.js is the §15.1 module (meta, rules, config, engine, ui.mount)', async () => {
  const mod = (await import('../js/games/spyfall/index.js')).default;
  for (const k of ['meta', 'rules', 'config', 'engine']) assert.ok(mod[k], k);
  assert.equal(typeof mod.ui.mount, 'function');
  assert.equal(mod.meta.id, 'spyfall');
  assert.equal(mod.meta.css, true);
});

test('spyfall: the shipped bank (js/data/spyfall-locations.js) fits what the engine assumes', async () => {
  let BANK;
  try { BANK = (await import('../js/data/spyfall-locations.js')).default; } catch { return; }   // built by the data task; skip while absent
  assert.ok(Array.isArray(BANK) && BANK.length >= 40, 'enough locations for a 30-long list over several games');
  const names = new Set();
  const cats = new Set();
  for (const e of BANK) {
    assert.ok(e.name && e.emoji && e.cat, JSON.stringify(e));
    assert.ok(!names.has(e.name), `duplicate location ${e.name}`);
    names.add(e.name);
    cats.add(e.cat);
    assert.ok(Array.isArray(e.roles) && e.roles.length >= 7 && new Set(e.roles).size === e.roles.length, `${e.name}: roles`);
  }
  for (const c of cats) assert.ok(game.CATEGORIES.includes(c), `bank category ${c} is missing from CATEGORIES (the config form would not offer it)`);
  for (const c of game.CATEGORIES) assert.ok(cats.has(c), `CATEGORIES lists ${c} but the bank has no such location`);
  // a few complete games on the real bank, one category filter included
  for (const n of [3, 6, 9, 12]) {
    for (let seed = 1; seed <= 4; seed++) {
      const config = { ...game.config.defaults(n), rounds: 3, categories: { cats: seed === 4 ? ['日本'] : [] } };
      const sim = new Sim(game, { n, seed, config, banks: { spyfall: BANK } });
      const japan = BANK.filter((e) => e.cat === '日本').length;
      assert.equal(sim.state.list.length, seed === 4 ? Math.min(24, japan) : 24);
      if (seed === 4) assert.ok(sim.state.list.every((e) => e.cat === '日本'));
      sim.runRandom();
    }
  }
});

// ============================================================
// setup & dealing
// ============================================================

test('spyfall: setup deals the right number of spies, valid roles and a public list that holds the secret', () => {
  for (let n = 3; n <= 12; n++) {
    for (const spies of n >= 6 ? [1, 2] : [1]) {
      const sim = mk(n, { seed: n * 10 + spies, config: { spies } });
      const s = sim.state;
      const r = s.round;
      assert.equal(s.phase, 'reveal');
      assert.equal(r.spies.length, spies);
      assert.equal(new Set(r.spies).size, spies);
      assert.ok(ids(sim).includes(r.dealer));
      assert.equal(s.list.length, 24);
      assert.equal(new Set(s.list.map((e) => e.name)).size, s.list.length, 'distinct names');
      assert.ok(r.loc >= 0 && r.loc < s.list.length);
      const pool = s.plan[0].roles;
      assert.equal(s.plan[0].loc, r.loc);
      assert.equal(s.plan.length, s.cfg.rounds);
      assert.equal(new Set(s.plan.map((p) => p.loc)).size, s.plan.length, 'distinct secrets');
      const ns = nonSpies(sim);
      assert.equal(Object.keys(r.roles).length, ns.length);
      for (const id of ns) assert.ok(pool.includes(r.roles[id]), 'role belongs to the location');
      if (ns.length <= 7) assert.equal(new Set(ns.map((id) => r.roles[id])).size, ns.length, 'roles distinct when the list allows');
    }
  }
});

test('spyfall: the list is grouped by category and the secret is spread over all of it', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 150; seed++) {
    const sim = mk(5, { seed });
    const list = sim.state.list;
    const rank = (c) => game.CATEGORIES.indexOf(c);
    for (let i = 1; i < list.length; i++) assert.ok(rank(list[i - 1].cat) <= rank(list[i].cat), 'sorted by category');
    seen.add(R(sim).loc);
  }
  assert.ok(seen.size >= 18, `secret should land all over the list, saw ${seen.size} distinct positions`);
});

test('spyfall: category filter restricts the list, and tops up when the pool is too small', () => {
  const two = mk(5, { config: { categories: { cats: ['日本', '香港'] }, listSize: 30 } }).state.list;
  assert.equal(two.length, 16, 'only the 16 locations of the two categories');
  assert.ok(two.every((e) => e.cat === '日本' || e.cat === '香港'));

  const one = mk(5, { config: { categories: { cats: ['奇幻科幻'] } } }).state.list;
  assert.equal(one.length, 8, 'topped up to the minimum list of 8');
  assert.equal(one.filter((e) => e.cat === '奇幻科幻').length, 8, 'all 8 fantasy locations fit');

  const tiny = mk(5, { config: { categories: { cats: ['不存在'] } } }).state.list;
  assert.equal(tiny.length, 8, 'unknown category falls back to the whole bank');
});

test('spyfall: odd bank entries are sanitised; empty bank throws a clear error', () => {
  const bank = [{ name: '路邊', roles: [] }, { name: '天台', emoji: '🌇', cat: '香港' }, ...FIXTURE.slice(0, 10)];
  const sim = mk(4, { bank, config: { listSize: 30 } });
  for (const e of sim.state.list) assert.ok(e.emoji && e.cat && e.name);
  for (const p of sim.state.plan) assert.ok(p.roles.length >= 7, 'a bank entry without roles gets a generic role pool');
  assert.throws(() => mk(4, { bank: [] }), /bank is empty/);
});

test('spyfall: rounds are capped by the list size so a secret never has to repeat', () => {
  const bank = FIXTURE.slice(0, 5);   // bank smaller than MIN_LIST
  const sim = mk(4, { bank, config: { rounds: 10 } });
  assert.equal(sim.state.list.length, 5);
  assert.equal(sim.state.cfg.rounds, 5);
});

test('spyfall: the secret location never repeats within a game and every round ends with a new one', () => {
  const sim = mk(4, { seed: 5, config: { rounds: 10, listSize: 16 } });
  playRounds(sim);
  assert.equal(phase(sim), 'over');
  const locs = sim.state.history.map((h) => h.loc);
  assert.equal(locs.length, 10);
  assert.equal(new Set(locs).size, 10);
});

test('spyfall: dealer is random in round 1 and moves one seat clockwise each round', () => {
  const sim = mk(5, { seed: 3, config: { rounds: 4 } });
  const dealers = [];
  readyAll(sim);
  for (let i = 0; i < 4; i++) {
    dealers.push(R(sim).dealer);
    wrongGuess(sim);
    sim.act('p2', { type: 'next-round' });
    if (phase(sim) === 'reveal') readyAll(sim);
  }
  const order = ids(sim);
  for (let i = 1; i < dealers.length; i++) {
    assert.equal(dealers[i], order[(order.indexOf(dealers[i - 1]) + 1) % order.length]);
  }
  const firsts = new Set();
  for (let seed = 1; seed <= 60; seed++) firsts.add(R(mk(5, { seed })).dealer);
  assert.ok(firsts.size >= 4, 'round-1 dealer varies');
});

// ============================================================
// reveal phase
// ============================================================

test('spyfall: the clock starts only when every seat is ready', () => {
  const sim = mk(4);
  assert.equal(phase(sim), 'reveal');
  assert.equal(sim.state.deadline, null);
  assert.deepEqual(sim.focus().pids, ids(sim));
  assert.ok(sim.cue().text.includes('準備好'));
  assert.equal(sim.act('p1', { type: 'ready' }), true);
  assert.equal(sim.act('p1', { type: 'ready' }), false, 'twice is a no-op');
  assert.deepEqual(sim.focus().pids, ['p2', 'p3', 'p4']);
  assert.deepEqual(sim.legal('p1'), []);
  assert.equal(sim.view('p2').ready.done, 1);
  sim.act('p2', { type: 'ready' });
  sim.act('p3', { type: 'ready' });
  assert.equal(phase(sim), 'reveal');
  assert.equal(sim.act('ghost', { type: 'ready' }), false);
  sim.act('p4', { type: 'ready' });
  assert.equal(phase(sim), 'play');
  assert.equal(sim.focus(), null);
  assert.ok(sim.state.deadline > sim.now);
  const v = sim.view('p1');
  assert.equal(v.deadline, sim.now + 6 * 60_000, 'view.deadline is the true end of the clock');
  assert.equal(v.floor.holder, R(sim).dealer);
  assert.equal(v.floor.prev, null);
  assert.ok(sim.cue().text.includes('6分鐘'));
});

test('spyfall: nothing but ready works during the private look', () => {
  const sim = mk(4);
  const spy = spyOf(sim);
  for (const a of [{ type: 'ask', target: 'p2' }, { type: 'accuse', target: 'p2' }, { type: 'spy-stop' },
    { type: 'vote', yes: true }, { type: 'guess', loc: 1 }, { type: 'next-round' }]) {
    assert.equal(sim.act('p1', a), false, a.type);
    assert.equal(sim.act(spy, a), false, a.type);
  }
});

// ============================================================
// the who-asks-next tracker
// ============================================================

test('spyfall: question tracker — pass, cannot ask back, undo', () => {
  const sim = playing(4);
  const d = R(sim).dealer;
  const [a, b, c] = ids(sim).filter((x) => x !== d);
  assert.equal(sim.view(a).floor.holder, d);
  assert.equal(sim.act(a, { type: 'ask', target: d }), false, 'the holder cannot ask themself');
  assert.equal(sim.act(a, { type: 'ask', target: 'nobody' }), false);
  assert.equal(sim.act(a, { type: 'ask', target: b }), true, 'any seat can record the pass (single device)');
  let f = sim.view(c).floor;
  assert.deepEqual([f.holder, f.prev], [b, d]);
  assert.equal(sim.act(b, { type: 'ask', target: d }), false, 'cannot ask back');
  assert.equal(sim.act(b, { type: 'ask', target: b }), false);
  assert.equal(sim.act(b, { type: 'ask', target: c }), true);
  f = sim.view(c).floor;
  assert.deepEqual([f.holder, f.prev], [c, b]);
  assert.deepEqual(f.trail, [d, b, c]);
  assert.equal(f.canUndo, true);
  assert.equal(sim.act(c, { type: 'undo-ask' }), true);
  assert.deepEqual([sim.view(c).floor.holder, sim.view(c).floor.prev], [b, d]);
  assert.equal(sim.act(c, { type: 'undo-ask' }), true);
  assert.equal(sim.view(c).floor.holder, d);
  assert.equal(sim.act(c, { type: 'undo-ask' }), false, 'nothing left to undo');
  assert.equal(sim.view(c).floor.canUndo, false);
});

test('spyfall: with three players the question must go round in a strict cycle', () => {
  const sim = playing(3);
  let holder = R(sim).dealer;
  const order = ids(sim);
  for (let i = 0; i < 6; i++) {
    const legal = sim.legal(holder).filter((a) => a.type === 'ask').map((a) => a.target);
    const prev = sim.view(holder).floor.prev;
    const expect = order.filter((x) => x !== holder && x !== prev);
    assert.deepEqual(legal, expect);
    if (i > 0) assert.equal(legal.length, 1, 'only one legal target after the first question');
    sim.act(holder, { type: 'ask', target: legal[0] });
    holder = legal[0];
  }
});

// ============================================================
// accusations
// ============================================================

test('spyfall: a unanimous accusation of the spy ends the round for the non-spies, with the first-accuser bonus', () => {
  const sim = playing(5, { seed: 11 });
  const spy = spyOf(sim);
  const [x] = nonSpies(sim);
  assert.equal(sim.act(x, { type: 'accuse', target: spy }), true);
  assert.equal(phase(sim), 'vote');
  assert.equal(sim.state.deadline, null, 'clock is stopped');
  assert.ok(sim.cue().text.includes('指控'));
  const v = sim.view(x).vote;
  assert.equal(v.kind, 'accuse');
  assert.equal(v.suspect, spy);
  assert.equal(v.voters.length, 4);
  assert.deepEqual(v.voted, [x], 'the accuser counts as a yes');
  assert.equal(sim.legal(x).length, 0, 'accuser has nothing left to vote');
  assert.equal(sim.legal(spy).length, 0, 'suspect does not vote');
  assert.deepEqual(sim.focus().pids.sort(), ids(sim).filter((i) => i !== x && i !== spy).sort());
  voteAll(sim, true);
  assert.equal(phase(sim), 'tally');
  assert.equal(sim.state.deadline, sim.now + 3500);
  const t = sim.view('p1').tally;
  assert.equal(t.convicted, true);
  assert.equal(t.noCount, 0);
  assert.deepEqual(t.yes.sort(), ids(sim).filter((i) => i !== spy).sort());
  settle(sim);
  assert.equal(phase(sim), 'roundEnd');
  const e = sim.view('p1').end;
  assert.equal(e.code, 'accused-spy');
  assert.equal(e.winTeam, 'agent');
  assert.equal(e.caught, spy);
  assert.equal(e.bonusTo, x);
  assert.equal(e.deltas[x], 2);
  for (const id of nonSpies(sim)) if (id !== x) assert.equal(e.deltas[id], 1);
  assert.equal(e.deltas[spy], 0);
  assert.deepEqual(sim.view('p1').totals, e.deltas);
});

test('spyfall: unanimously accusing a non-spy hands the spy four points', () => {
  const sim = playing(5, { seed: 12 });
  const spy = spyOf(sim);
  const [x, y] = nonSpies(sim);
  sim.act(x, { type: 'accuse', target: y });
  voteAll(sim, true);
  settle(sim);
  const e = sim.view('p1').end;
  assert.equal(e.code, 'accused-innocent');
  assert.equal(e.winTeam, 'spy');
  assert.equal(e.deltas[spy], 4);
  assert.equal(sum(e.deltas), 4);
  assert.equal(e.bonusTo, null);
});

test('spyfall: one "no" sinks an accusation with one spy, the clock resumes with the exact time left', () => {
  const sim = playing(4, { seed: 13 });
  const spy = spyOf(sim);
  const [x, y] = nonSpies(sim);
  const before = sim.view(x).deadline;
  sim.tick(41_000);
  sim.act(x, { type: 'accuse', target: spy });
  const left = before - sim.now;
  assert.equal(sim.state.round.frozen, left);
  assert.equal(sim.view(x).frozen, left, 'phones show the frozen time');
  assert.equal(sim.view(x).deadline, null);
  sim.tick(25_000);                                     // a long argument while stopped
  const voters = ids(sim).filter((i) => i !== x && i !== spy);
  sim.act(voters[0], { type: 'vote', yes: true });
  assert.equal(phase(sim), 'vote');
  sim.act(voters[1] ?? voters[0], { type: 'vote', yes: false });
  assert.equal(phase(sim), 'tally');
  assert.equal(sim.view('p1').tally.convicted, false);
  assert.ok(sim.cue().text.includes('繼續'));
  sim.advance();                                        // the result lingers, then play resumes
  assert.equal(phase(sim), 'play');
  assert.equal(sim.view(x).deadline - sim.now, left, 'no second gained or lost across the pause');
  assert.deepEqual(sim.view(x).accUsed, [x]);
  assert.equal(sim.view(x).accusations[0].result, 'failed');
  assert.ok(y);
});

test('spyfall: everyone gets exactly one accusation; no self-accusation; no accusing during a vote', () => {
  const sim = playing(4, { seed: 14 });
  const [a, b, c] = ids(sim);
  assert.equal(sim.act(a, { type: 'accuse', target: a }), false, 'cannot accuse yourself');
  assert.equal(sim.act(a, { type: 'accuse', target: 'zzz' }), false);
  assert.equal(sim.act(a, { type: 'accuse', target: b }), true);
  assert.equal(sim.act(c, { type: 'accuse', target: b }), false, 'a vote is already open');
  assert.equal(sim.act(spyOf(sim), { type: 'spy-stop' }), false, 'spy cannot stop the clock during a vote');
  voteAll(sim, false);
  settle(sim);
  assert.equal(phase(sim), 'play');
  assert.equal(sim.act(a, { type: 'accuse', target: c }), false, 'a used their one accusation');
  assert.equal(sim.legal(a).some((x) => x.type === 'accuse'), false);
  assert.equal(sim.act(c, { type: 'accuse', target: b }), true, 'same suspect again, different accuser');
});

test('spyfall: the accuser and suspect cannot vote; nobody votes twice', () => {
  const sim = playing(5, { seed: 15 });
  const [a, b, c, d] = ids(sim);
  sim.act(a, { type: 'accuse', target: b });
  assert.equal(sim.act(a, { type: 'vote', yes: false }), false, 'accuser is locked to yes');
  assert.equal(sim.act(b, { type: 'vote', yes: false }), false, 'suspect never votes');
  assert.equal(sim.act(c, { type: 'vote', yes: 'yes' }), false, 'must be a boolean');
  assert.equal(sim.act(c, { type: 'vote', yes: true }), true);
  assert.equal(sim.act(c, { type: 'vote', yes: false }), false, 'cannot change a vote');
  assert.equal(sim.act(d, { type: 'verdict', no: 0 }), false, 'hands verdicts are not allowed in phone mode');
  assert.equal(sim.view(c).mine.vote, true);
  assert.equal(sim.view(d).mine.vote, null);
  assert.equal(sim.view(null).mine, null);
});

test('spyfall: view of a vote in progress shows who voted, never what', () => {
  const sim = playing(5, { seed: 16 });
  const [a, b, c, d] = ids(sim);
  sim.act(a, { type: 'accuse', target: b });
  sim.act(c, { type: 'vote', yes: false });
  const v = sim.view(d);
  assert.deepEqual(v.vote.voted.sort(), [a, c].sort());
  const dump = JSON.stringify(v);
  assert.ok(!dump.includes('"votes"'));
  assert.equal(v.mine.vote, null);
  assert.equal(sim.view(c).mine.vote, false);
});

// ============================================================
// the clock
// ============================================================

test('spyfall: one-minute warning cue, then time-up opens the final vote on the dealer', () => {
  const sim = playing(4, { seed: 20 });
  const end = sim.view('p1').deadline;
  assert.equal(sim.state.deadline, end - 60_000, 'first wake-up is the warning');
  sim.advance();
  assert.equal(phase(sim), 'play');
  assert.ok(sim.cue().text.includes('一分鐘'));
  assert.equal(sim.view('p1').deadline, end, 'the visible clock never moved');
  assert.equal(sim.state.deadline, end);
  sim.advance();
  assert.equal(phase(sim), 'vote');
  const v = sim.view('p1');
  assert.equal(v.vote.kind, 'final');
  assert.equal(v.vote.suspect, R(sim).dealer);
  assert.equal(v.vote.index, 1);
  assert.equal(v.deadline, null);
  assert.equal(v.frozen, 0);
  assert.ok(sim.cue().text.includes('時間到'));
});

test('spyfall: a host pause shifts the deadline and the clock follows', () => {
  const sim = playing(4, { seed: 21 });
  const end = sim.view('p1').deadline;
  sim.state.deadline += 90_000;            // what the session does on resume after a 90 s pause
  assert.equal(sim.view('p1').deadline, end + 90_000);
  sim.tick(30_000);
  const [x, y] = ids(sim);
  sim.act(x, { type: 'accuse', target: y });
  assert.equal(sim.state.round.frozen, end + 90_000 - sim.now);
});

test('spyfall: no accusation or spy stop once the clock reached 0:00', () => {
  const sim = playing(4, { seed: 22 });
  sim.advance();                           // warning
  sim.now = sim.state.deadline;            // the timer fired, the engine has not advanced yet
  assert.equal(sim.act('p1', { type: 'accuse', target: 'p2' }), false);
  assert.equal(sim.act(spyOf(sim), { type: 'spy-stop' }), false);
  sim.advance();
  assert.equal(phase(sim), 'vote');
});

test('spyfall: a short round with less than 75 s skips the warning', () => {
  const sim = playing(4, { seed: 23, config: { minutes: 2 } });
  assert.equal(sim.state.clockLeft, 60_000, '2 minutes still warns');
  const sim1 = playing(4, { seed: 23 });
  sim1.tick(5 * 60_000);                   // 1:00 left
  sim1.act('p1', { type: 'accuse', target: 'p2' });
  voteAll(sim1, false);
  sim1.advance();
  assert.equal(phase(sim1), 'play');
  assert.equal(sim1.state.clockLeft, 0, 'already inside the last minute: warning is spent');
});

// ============================================================
// the spy stops the clock
// ============================================================

test('spyfall: only a spy can stop the clock; a right guess wins four points', () => {
  const sim = playing(5, { seed: 30 });
  const spy = spyOf(sim);
  for (const id of nonSpies(sim)) assert.equal(sim.act(id, { type: 'spy-stop' }), false);
  assert.equal(sim.legal(nonSpies(sim)[0]).some((a) => a.type === 'spy-stop'), false);
  assert.equal(sim.act(spy, { type: 'spy-stop' }), true);
  assert.equal(phase(sim), 'guess');
  assert.deepEqual(sim.focus().pids, [spy]);
  assert.equal(sim.state.deadline, null);
  const g = sim.view('p1').guess;
  assert.equal(g.current, spy);
  assert.deepEqual(g.shown, [spy]);
  assert.ok(sim.cue().text.includes('間諜'));
  assert.equal(sim.legal(spy).length, 24);
  assert.equal(sim.act(nonSpies(sim)[0], { type: 'guess', loc: R(sim).loc }), false, 'only the spy guesses');
  assert.equal(sim.act(spy, { type: 'guess', loc: 99 }), false);
  assert.equal(sim.act(spy, { type: 'guess', loc: -1 }), false);
  assert.equal(sim.act(spy, { type: 'guess', loc: 1.5 }), false);
  assert.equal(sim.act(spy, { type: 'guess', loc: '3' }), false);
  assert.equal(sim.act(spy, { type: 'guess', loc: R(sim).loc }), true);
  assert.equal(phase(sim), 'roundEnd');
  const e = sim.view('p2').end;
  assert.equal(e.code, 'guess-right');
  assert.equal(e.winTeam, 'spy');
  assert.equal(e.deltas[spy], 4);
  assert.equal(sum(e.deltas), 4);
  assert.deepEqual(e.picks, { [spy]: R(sim).loc });
});

test('spyfall: a wrong guess gives every non-spy a point and nobody a bonus', () => {
  const sim = playing(5, { seed: 31 });
  const spy = spyOf(sim);
  const [x] = nonSpies(sim);
  // an earlier accusation that named the spy must NOT earn a bonus after a wrong guess
  sim.act(x, { type: 'accuse', target: spy });
  voteAll(sim, false);
  settle(sim);
  wrongGuess(sim);
  const e = sim.view('p1').end;
  assert.equal(e.code, 'guess-wrong');
  assert.equal(e.winTeam, 'agent');
  assert.equal(e.deltas[spy], 0);
  for (const id of nonSpies(sim)) assert.equal(e.deltas[id], 1);
  assert.equal(e.bonusTo, null);
});

test('spyfall: the stopped clock stays stopped for the whole guess', () => {
  const sim = playing(4, { seed: 32 });
  sim.act(spyOf(sim), { type: 'spy-stop' });
  assert.equal(sim.advance(), false, 'nothing to advance while guessing');
  assert.equal(phase(sim), 'guess');
});

test('spyfall: a convicted spy gets no last guess', () => {
  const sim = playing(4, { seed: 33 });
  const spy = spyOf(sim);
  sim.act(nonSpies(sim)[0], { type: 'accuse', target: spy });
  voteAll(sim, true);
  assert.equal(sim.act(spy, { type: 'spy-stop' }), false);
  settle(sim);
  assert.equal(sim.act(spy, { type: 'spy-stop' }), false);
  assert.equal(sim.act(spy, { type: 'guess', loc: R(sim).loc }), false);
});

// ============================================================
// final vote
// ============================================================

test('spyfall: final vote goes dealer first, then seat order, and the first unanimous suspect ends it', () => {
  const sim = playing(5, { seed: 40 });
  const order = ids(sim);
  const d = R(sim).dealer;
  const expectOrder = Array.from({ length: 5 }, (_, i) => order[(order.indexOf(d) + i) % 5]);
  timeUp(sim);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    assert.equal(phase(sim), 'vote');
    const v = sim.view('p1').vote;
    assert.equal(v.kind, 'final');
    assert.equal(v.index, i + 1);
    seen.push(v.suspect);
    assert.deepEqual(v.voted, [], 'nobody votes automatically in a final vote');
    assert.equal(v.voters.length, 4);
    voteAll(sim, false);
    assert.equal(phase(sim), 'tally');
    assert.equal(sim.view('p1').tally.convicted, false);
    settle(sim);
  }
  assert.deepEqual(seen, expectOrder);
  assert.equal(phase(sim), 'roundEnd');
  const e = sim.view('p1').end;
  assert.equal(e.code, 'survived');
  assert.equal(e.deltas[spyOf(sim)], 2);
  assert.equal(sum(e.deltas), 2);
});

test('spyfall: a conviction in the final vote reveals the spy (non-spies win) or the innocent (spy wins +2)', () => {
  // convict the spy
  const sim = playing(5, { seed: 41 });
  timeUp(sim);
  const spy = spyOf(sim);
  while (sim.view('p1').vote.suspect !== spy) { voteAll(sim, false); settle(sim); }
  voteAll(sim, true);
  settle(sim);
  let e = sim.view('p1').end;
  assert.equal(e.code, 'final-spy');
  assert.equal(e.caught, spy);
  assert.equal(e.bonusTo, null, 'nobody accused the spy mid-round, so no bonus');
  for (const id of nonSpies(sim)) assert.equal(e.deltas[id], 1);

  // convict an innocent
  const sim2 = playing(5, { seed: 42 });
  timeUp(sim2);
  const spy2 = spyOf(sim2);
  while (sim2.view('p1').vote.suspect === spy2) { voteAll(sim2, false); settle(sim2); }
  const victim = sim2.view('p1').vote.suspect;
  voteAll(sim2, true);
  settle(sim2);
  e = sim2.view('p1').end;
  assert.equal(e.code, 'final-innocent');
  assert.equal(e.suspect, victim);
  assert.equal(e.deltas[spy2], 2, 'no extra for an innocent convicted at the final vote');
  assert.equal(sum(e.deltas), 2);
});

test('spyfall: the spy cannot guess once time is up', () => {
  const sim = playing(4, { seed: 43 });
  timeUp(sim);
  assert.equal(sim.act(spyOf(sim), { type: 'spy-stop' }), false);
  assert.equal(sim.act('p1', { type: 'accuse', target: 'p2' }), false);
});

test('spyfall: with three players both others must agree', () => {
  const sim = playing(3, { seed: 44 });
  const spy = spyOf(sim);
  const [x, y] = nonSpies(sim);
  sim.act(x, { type: 'accuse', target: spy });
  assert.deepEqual(sim.view(x).vote.voters.sort(), [x, y].sort());
  assert.equal(sim.view(x).vote.need, 2);
  sim.act(y, { type: 'vote', yes: true });
  assert.equal(phase(sim), 'tally');
  assert.equal(sim.view(x).tally.convicted, true);
});

// ============================================================
// two spies
// ============================================================

test('spyfall: with two spies one dissenter is allowed, two are not', () => {
  const sim = playing(6, { seed: 50, config: { spies: 2 } });
  const [s1, s2] = R(sim).spies;
  const ns = nonSpies(sim);
  sim.act(ns[0], { type: 'accuse', target: s1 });
  assert.equal(sim.view('p1').vote.need, 4);
  assert.equal(sim.view('p1').vote.maxNo, 1);
  // voters: everyone but s1 → s2 votes no, the rest yes: exactly one dissent
  const voters = ids(sim).filter((i) => i !== s1 && i !== ns[0]);
  for (const id of voters) sim.act(id, { type: 'vote', yes: id !== s2 });
  assert.equal(phase(sim), 'tally');
  assert.equal(sim.view('p1').tally.convicted, true);
  settle(sim);
  const e = sim.view('p1').end;
  assert.equal(e.code, 'accused-spy');
  assert.equal(e.caught, s1);
  assert.equal(e.deltas[s1], 0);
  assert.equal(e.deltas[s2], 1, 'the uncaught spy scores as a non-spy');
  assert.equal(e.deltas[ns[0]], 2, 'first accuser bonus');
  for (const id of ns.slice(1)) assert.equal(e.deltas[id], 1);
  assert.equal(e.winTeam, 'agent');

  const sim2 = playing(6, { seed: 51, config: { spies: 2 } });
  const [t1, t2] = R(sim2).spies;
  const ns2 = nonSpies(sim2);
  sim2.act(ns2[0], { type: 'accuse', target: t1 });
  const voters2 = ids(sim2).filter((i) => i !== t1 && i !== ns2[0]);
  voters2.slice(0, 2).forEach((id) => sim2.act(id, { type: 'vote', yes: false }));
  voters2.slice(2).forEach((id) => sim2.act(id, { type: 'vote', yes: true }));
  assert.equal(sim2.view('p1').tally.convicted, false, 'two dissenters block');
  assert.ok(t2);
});

test('spyfall: two-spy guess — the second spy is revealed only after the first has named a place', () => {
  const sim = playing(6, { seed: 52, config: { spies: 2 } });
  const [s1, s2] = R(sim).spies;
  const loc = R(sim).loc;
  assert.equal(sim.act(s2, { type: 'spy-stop' }), true, 'either spy may be first');
  let g = sim.view('p1').guess;
  assert.deepEqual(g.shown, [s2], 'the other spy stays hidden');
  assert.equal(g.current, s2);
  assert.deepEqual(sim.focus().pids, [s2]);
  assert.equal(sim.act(s1, { type: 'guess', loc }), false, 'not the second spy yet');
  assert.equal(sim.act(s2, { type: 'guess', loc: (loc + 1) % 24 }), true);
  assert.equal(phase(sim), 'guess');
  g = sim.view('p1').guess;
  assert.deepEqual(g.shown, [s2, s1]);
  assert.equal(g.current, s1);
  assert.deepEqual(g.picks, { [s2]: (loc + 1) % 24 }, 'the first pick is public, its verdict is not');
  assert.ok(sim.cue().text.includes('另一個間諜'));
  assert.equal(sim.act(s1, { type: 'guess', loc }), true);
  const e = sim.view('p1').end;
  assert.equal(e.code, 'guess-right');
  assert.deepEqual(e.rightSpies, [s1]);
  assert.equal(e.deltas[s1], 4, '2 for the win + 2 for being right');
  assert.equal(e.deltas[s2], 2, '2 for the win');
  assert.equal(sum(e.deltas), 6);
});

test('spyfall: two spies both wrong → non-spies win; second spy may copy the first guess', () => {
  const sim = playing(6, { seed: 53, config: { spies: 2 } });
  const [s1] = R(sim).spies;
  const wrong = (R(sim).loc + 3) % 24;
  sim.act(s1, { type: 'spy-stop' });
  sim.act(s1, { type: 'guess', loc: wrong });
  const second = sim.view('p1').guess.current;
  assert.ok(sim.legal(second).some((a) => a.loc === wrong), 'duplicate guesses are fine');
  sim.act(second, { type: 'guess', loc: wrong });
  const e = sim.view('p1').end;
  assert.equal(e.code, 'guess-wrong');
  for (const sp of R(sim).spies) assert.equal(e.deltas[sp], 0);
  for (const id of nonSpies(sim)) assert.equal(e.deltas[id], 1);
});

test('spyfall: two spies, final-vote conviction of an innocent → both spies +2', () => {
  const sim = playing(6, { seed: 54, config: { spies: 2 } });
  timeUp(sim);
  while (R(sim).spies.includes(sim.view('p1').vote.suspect)) { voteAll(sim, false); settle(sim); }
  voteAll(sim, true);
  settle(sim);
  const e = sim.view('p1').end;
  assert.equal(e.code, 'final-innocent');
  for (const sp of R(sim).spies) assert.equal(e.deltas[sp], 2);
  assert.equal(sum(e.deltas), 4);
});

test('spyfall: two spies, mid-round innocent conviction → four points each', () => {
  const sim = playing(7, { seed: 55, config: { spies: 2 } });
  const [x, y] = nonSpies(sim);
  sim.act(x, { type: 'accuse', target: y });
  voteAll(sim, true);
  settle(sim);
  const e = sim.view('p1').end;
  assert.equal(e.code, 'accused-innocent');
  for (const sp of R(sim).spies) assert.equal(e.deltas[sp], 4);
});

// ============================================================
// scoring table (pure)
// ============================================================

test('spyfall: scoreRound — every outcome, one spy and two spies', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f'];
  const one = { order, spies: ['a'] };
  const two = { order, spies: ['a', 'b'] };
  const S = game.scoreRound;
  assert.deepEqual(S({ ...one, code: 'survived' }), { a: 2, b: 0, c: 0, d: 0, e: 0, f: 0 });
  assert.deepEqual(S({ ...one, code: 'final-innocent' }), { a: 2, b: 0, c: 0, d: 0, e: 0, f: 0 });
  assert.deepEqual(S({ ...one, code: 'accused-innocent' }), { a: 4, b: 0, c: 0, d: 0, e: 0, f: 0 });
  assert.deepEqual(S({ ...one, code: 'guess-right', rightSpies: ['a'] }), { a: 4, b: 0, c: 0, d: 0, e: 0, f: 0 });
  assert.deepEqual(S({ ...one, code: 'guess-wrong' }), { a: 0, b: 1, c: 1, d: 1, e: 1, f: 1 });
  assert.deepEqual(S({ ...one, code: 'accused-spy', caught: 'a', bonusTo: 'c' }), { a: 0, b: 1, c: 2, d: 1, e: 1, f: 1 });
  assert.deepEqual(S({ ...one, code: 'final-spy', caught: 'a' }), { a: 0, b: 1, c: 1, d: 1, e: 1, f: 1 });
  assert.deepEqual(S({ ...one, code: 'guess-wrong', bonusTo: 'c' }), { a: 0, b: 1, c: 1, d: 1, e: 1, f: 1 }, 'no bonus after a wrong guess');

  assert.deepEqual(S({ ...two, code: 'survived' }), { a: 2, b: 2, c: 0, d: 0, e: 0, f: 0 });
  assert.deepEqual(S({ ...two, code: 'accused-innocent' }), { a: 4, b: 4, c: 0, d: 0, e: 0, f: 0 });
  assert.deepEqual(S({ ...two, code: 'guess-right', rightSpies: ['b'] }), { a: 2, b: 4, c: 0, d: 0, e: 0, f: 0 });
  assert.deepEqual(S({ ...two, code: 'guess-right', rightSpies: ['a', 'b'] }), { a: 4, b: 4, c: 0, d: 0, e: 0, f: 0 });
  assert.deepEqual(S({ ...two, code: 'guess-wrong' }), { a: 0, b: 0, c: 1, d: 1, e: 1, f: 1 });
  assert.deepEqual(S({ ...two, code: 'accused-spy', caught: 'a', bonusTo: 'd' }), { a: 0, b: 1, c: 1, d: 2, e: 1, f: 1 });
  assert.deepEqual(S({ ...two, code: 'final-spy', caught: 'b', bonusTo: 'a' }), { a: 2, b: 0, c: 1, d: 1, e: 1, f: 1 }, 'the uncaught spy may also hold the bonus');
});

test('spyfall: first-accuser bonus goes to whoever first named the spy that is convicted, even if their vote failed', () => {
  const sim = playing(5, { seed: 60 });
  const spy = spyOf(sim);
  const [x, y, z] = nonSpies(sim);
  sim.act(x, { type: 'accuse', target: spy });          // fails
  voteAll(sim, false);
  settle(sim);
  sim.act(y, { type: 'accuse', target: spy });          // succeeds
  voteAll(sim, true);
  settle(sim);
  const e = sim.view('p1').end;
  assert.equal(e.code, 'accused-spy');
  assert.equal(e.bonusTo, x, 'x accused first');
  assert.equal(e.deltas[x], 2);
  assert.equal(e.deltas[y], 1, 'the one who finished it does not get the bonus');
  assert.equal(e.deltas[z], 1);
  assert.ok(e.lines.some((l) => l.includes('最先指控')));
});

/** Accuse the spy mid-round (fails), then convict them at the final vote. Returns { sim, spy, x, y }. */
function caughtAtFinalAfterAccusation(config = {}) {
  const sim = playing(5, { seed: 61, config });
  const spy = spyOf(sim);
  const [x, y] = nonSpies(sim);
  sim.act(y, { type: 'accuse', target: x });            // an unrelated accusation
  voteAll(sim, false);
  settle(sim);
  sim.act(x, { type: 'accuse', target: spy });          // names the spy, fails
  voteAll(sim, false);
  settle(sim);
  timeUp(sim);
  while (sim.view('p1').vote.suspect !== spy) { voteAll(sim, false); settle(sim); }
  voteAll(sim, true);
  settle(sim);
  return { sim, spy, x, y };
}

test('spyfall: rule — accuser bonus only for a mid-round conviction; a spy caught at the final vote pays no bonus', () => {
  const { sim, x, y } = caughtAtFinalAfterAccusation();
  const e = sim.view('p1').end;
  assert.equal(e.code, 'final-spy');
  assert.equal(e.bonusTo, null, 'Hobby World: the bonus belongs to a successful vote BEFORE the end of the round');
  assert.equal(e.deltas[x], 1, 'x accused the spy first, but the spy was caught at the final vote');
  assert.equal(e.deltas[y], 1);
  assert.equal(sum(e.deltas), 4, 'four non-spies, +1 each, nothing more');
  assert.ok(e.lines.some((l) => l.includes('中途指控過') && l.includes('中途全票捉到先有')), 'the reveal explains the missing bonus');
});

test('spyfall: option accuserBonus=first-any (house rule) also pays the first accuser at the final vote', () => {
  const { sim, x, y } = caughtAtFinalAfterAccusation({ accuserBonus: 'first-any' });
  const e = sim.view('p1').end;
  assert.equal(e.code, 'final-spy');
  assert.equal(e.bonusTo, x);
  assert.equal(e.deltas[x], 2);
  assert.equal(e.deltas[y], 1, 'an accusation of an innocent earns nothing');
  assert.ok(e.lines.some((l) => l.includes('自訂玩法')));
});

test('spyfall: option accuserBonus=successful (Spyfall 1) pays the accuser whose vote succeeded', () => {
  const sim = playing(5, { seed: 60, config: { accuserBonus: 'successful' } });
  const spy = spyOf(sim);
  const [x, y, z] = nonSpies(sim);
  sim.act(x, { type: 'accuse', target: spy });          // fails
  voteAll(sim, false);
  settle(sim);
  sim.act(y, { type: 'accuse', target: spy });          // succeeds
  voteAll(sim, true);
  settle(sim);
  const e = sim.view('p1').end;
  assert.equal(e.code, 'accused-spy');
  assert.equal(e.bonusTo, y);
  assert.deepEqual([e.deltas[x], e.deltas[y], e.deltas[z], e.deltas[spy]], [1, 2, 1, 0]);
  assert.ok(e.lines.some((l) => l.includes('成功指控')));
});

test('spyfall: bonusFor — every outcome and every bonus mode', () => {
  const B = game.bonusFor;
  const accs = [{ by: 'x', suspect: 'q' }, { by: 'y', suspect: 'a' }, { by: 'z', suspect: 'a' }];
  for (const mode of ['first-midround', 'successful', 'first-any']) {
    for (const code of ['survived', 'final-innocent', 'accused-innocent', 'guess-right', 'guess-wrong']) {
      assert.equal(B({ code, caught: null, by: 'z', accusations: accs, mode }), null, `${mode} ${code}`);
    }
  }
  assert.equal(B({ code: 'accused-spy', caught: 'a', by: 'z', accusations: accs }), 'y', 'default = first mid-round accuser');
  assert.equal(B({ code: 'final-spy', caught: 'a', accusations: accs }), null, 'default: nothing at the final vote');
  assert.equal(B({ code: 'accused-spy', caught: 'a', by: 'z', accusations: accs, mode: 'successful' }), 'z');
  assert.equal(B({ code: 'final-spy', caught: 'a', accusations: accs, mode: 'successful' }), null);
  assert.equal(B({ code: 'accused-spy', caught: 'a', by: 'z', accusations: accs, mode: 'first-any' }), 'y');
  assert.equal(B({ code: 'final-spy', caught: 'a', accusations: accs, mode: 'first-any' }), 'y');
  assert.equal(B({ code: 'final-spy', caught: 'b', accusations: accs, mode: 'first-any' }), null, 'nobody named b');
});

test('spyfall: a spy may accuse as a feint and it uses their one accusation', () => {
  const sim = playing(5, { seed: 62 });
  const spy = spyOf(sim);
  const [x] = nonSpies(sim);
  assert.equal(sim.act(spy, { type: 'accuse', target: x }), true);
  voteAll(sim, false);
  settle(sim);
  assert.equal(sim.legal(spy).some((a) => a.type === 'accuse'), false);
  assert.equal(sim.legal(spy).some((a) => a.type === 'spy-stop'), true, 'can still stop the clock afterwards');
  assert.equal(sim.act(spy, { type: 'spy-stop' }), true);
});

// ============================================================
// hands mode (single device)
// ============================================================

test('spyfall: hands mode — the accuser reports how many hands stayed down', () => {
  const sim = playing(5, { seed: 70, config: { voteMode: 'hands' } });
  const spy = spyOf(sim);
  const [x, y] = nonSpies(sim);
  sim.act(x, { type: 'accuse', target: spy });
  const v = sim.view(y).vote;
  assert.equal(v.mode, 'hands');
  assert.equal(v.reporter, x);
  assert.deepEqual(sim.focus().pids, [x]);
  assert.equal(sim.act(y, { type: 'verdict', no: 0 }), false, 'only the reporter');
  assert.equal(sim.act(y, { type: 'vote', yes: true }), false, 'no per-phone votes in hands mode');
  assert.equal(sim.act(x, { type: 'verdict', no: -1 }), false);
  assert.equal(sim.act(x, { type: 'verdict', no: 5 }), false);
  assert.equal(sim.act(x, { type: 'verdict', no: 0.5 }), false);
  assert.equal(sim.legal(x).length, 5);
  assert.equal(sim.legal(y).length, 0);
  assert.equal(sim.act(x, { type: 'verdict', no: 1 }), true);
  assert.equal(phase(sim), 'tally');
  const t = sim.view('p1').tally;
  assert.equal(t.convicted, false);
  assert.equal(t.noCount, 1);
  assert.equal(t.yes, null, 'hands are not recorded per seat');
  settle(sim);
  assert.equal(phase(sim), 'play');
});

test('spyfall: hands mode — final vote is reported by the dealer (or the next seat when the dealer is the suspect)', () => {
  const sim = playing(4, { seed: 71, config: { voteMode: 'hands' } });
  const d = R(sim).dealer;
  const order = ids(sim);
  timeUp(sim);
  assert.equal(sim.view('p1').vote.suspect, d);
  assert.equal(sim.view('p1').vote.reporter, order[(order.indexOf(d) + 1) % 4]);
  sim.act(sim.view('p1').vote.reporter, { type: 'verdict', no: 1 });
  settle(sim);
  assert.equal(sim.view('p1').vote.suspect, order[(order.indexOf(d) + 1) % 4]);
  assert.equal(sim.view('p1').vote.reporter, d);
});

test('spyfall: hands mode with two spies — one hand down still convicts', () => {
  const sim = playing(6, { seed: 72, config: { voteMode: 'hands', spies: 2 } });
  const x = nonSpies(sim)[0];
  const [s1] = R(sim).spies;
  sim.act(x, { type: 'accuse', target: s1 });
  sim.act(x, { type: 'verdict', no: 1 });
  assert.equal(sim.view('p1').tally.convicted, true);
  const sim2 = playing(6, { seed: 73, config: { voteMode: 'hands', spies: 2 } });
  sim2.act(nonSpies(sim2)[0], { type: 'accuse', target: R(sim2).spies[0] });
  sim2.act(nonSpies(sim2)[0], { type: 'verdict', no: 2 });
  assert.equal(sim2.view('p1').tally.convicted, false);
});

// ============================================================
// rounds, game end, result
// ============================================================

test('spyfall: next-round needs the round to be over; the last round ends the game with a result', () => {
  const sim = mk(4, { seed: 80, config: { rounds: 2 } });
  assert.equal(sim.result(), null);
  readyAll(sim);
  assert.equal(sim.act('p1', { type: 'next-round' }), false, 'not while playing');
  wrongGuess(sim);
  assert.equal(sim.result(), null, 'the reveal comes before the result');
  assert.equal(sim.view('p1').end.last, false);
  assert.equal(sim.act('p3', { type: 'next-round' }), true);
  assert.equal(phase(sim), 'reveal');
  assert.equal(sim.view('p1').round.n, 2);
  assert.equal(sim.view('p1').end, null, 'last round’s reveal is gone');
  assert.equal(sim.view('p1').history.length, 1);
  assert.equal(sim.view('p1').locations.filter((l) => l.used).length, 1, 'a used location is marked');
  readyAll(sim);
  wrongGuess(sim);
  assert.equal(sim.view('p1').end.last, true);
  assert.equal(sim.act('p1', { type: 'next-round' }), true);
  assert.equal(phase(sim), 'over');
  const res = sim.result();
  assert.ok(res);
  assert.deepEqual(sim.legal('p1'), []);
  assert.equal(sim.act('p1', { type: 'next-round' }), false);
  assert.equal(sim.view('p1').end.last, true, 'the over view keeps the final reveal');
  const totals = sim.state.totals;
  const max = Math.max(...Object.values(totals));
  assert.deepEqual(res.winners, ids(sim).filter((id) => totals[id] === max));
  assert.deepEqual(res.points, totals);
  assert.equal(typeof res.summary, 'string');
  assert.ok(res.lines.length >= 4, 'one line per round plus the last round’s explanation');
  assert.ok(!res.lines.some((l) => /：d+ 分$/.test(l)), 'the ranking is the shell’s job, not result.lines');
  assert.ok(res.lines.some((l) => l.includes('第 1 局')) && res.lines.some((l) => l.includes('第 2 局')));
});

test('spyfall: totals are the sum of every round, ties share the win', () => {
  const sim = mk(4, { seed: 81, config: { rounds: 3 } });
  playRounds(sim);
  const sums = Object.fromEntries(ids(sim).map((id) => [id, 0]));
  for (const h of sim.state.history) for (const id of ids(sim)) sums[id] += h.deltas[id];
  assert.deepEqual(sim.state.totals, sums);
  const res = sim.result();
  const max = Math.max(...Object.values(sums));
  assert.ok(res.winners.every((w) => sums[w] === max));
  if (res.winners.length > 1) assert.ok(res.summary.includes('同分'));
  // craft an exact tie
  const t = mk(3, { seed: 82, config: { rounds: 1 } });
  readyAll(t);
  wrongGuess(t);
  t.act('p1', { type: 'next-round' });
  const r1 = t.result();
  assert.equal(r1.winners.length, 2, 'two non-spies tie on 1 point each');
  assert.ok(r1.summary.includes('同分'));
});

test('spyfall: one-round game is a legal quick game', () => {
  const sim = mk(5, { seed: 83, config: { rounds: 1 } });
  readyAll(sim);
  sim.act(spyOf(sim), { type: 'spy-stop' });
  sim.act(spyOf(sim), { type: 'guess', loc: R(sim).loc });
  assert.equal(sim.view('p1').end.last, true);
  sim.act('p1', { type: 'next-round' });
  assert.equal(phase(sim), 'over');
  assert.deepEqual(sim.result().winners, [spyOf(sim)]);
});

// ============================================================
// cues
// ============================================================

test('spyfall: cues never speak a secret and every cue id is unique', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const sim = mk(5 + (seed % 3), { seed, config: { rounds: 2, voteMode: seed % 2 ? 'hands' : 'phone' } });
    const ids_ = new Set();
    sim.runRandom({
      onStep(s) {
        const c = s.cue();
        if (!c) return;
        if (!ids_.has(c.id)) {
          ids_.add(c.id);
          assert.equal(typeof c.text, 'string');
          assert.ok(Number.isFinite(c.minMs) && c.minMs >= 0);
        }
        const r = s.state.round;
        if (['reveal', 'play', 'vote', 'tally'].includes(s.state.phase)) {
          assert.ok(!c.text.includes(s.state.list[r.loc].name), `cue leaks location: ${c.text}`);
          for (const role of Object.values(r.roles)) assert.ok(!c.text.includes(role), `cue leaks a role: ${c.text}`);
        }
      },
    });
    assert.ok(ids_.size >= 6);
  }
});

test('spyfall: @cue-done and @next only touch narration', () => {
  const sim = mk(4);
  const c = sim.cue();
  assert.ok(c);
  assert.equal(sim.host({ type: ACT.CUE_DONE, id: 'stale' }), false);
  assert.equal(sim.host({ type: ACT.CUE_DONE, id: c.id }), true);
  assert.equal(sim.cue(), null);
  assert.equal(sim.host({ type: ACT.CUE_DONE, id: c.id }), false);
  assert.equal(sim.host({ type: ACT.NEXT }), false, 'no cue left to skip');
  assert.equal(phase(sim), 'reveal');
  readyAll(sim);
  assert.equal(sim.host({ type: ACT.NEXT }), true, 'skip the "start" cue');
  assert.equal(sim.cue(), null);
  assert.equal(sim.host({ type: ACT.AUTO, pid: 'p1' }), false);
  assert.equal(phase(sim), 'play');
});

// ============================================================
// autoAct
// ============================================================

test('spyfall: autoAct readies, votes no, never moves the question, guesses legally, continues', () => {
  const sim = mk(5, { seed: 90 });
  const rng = mulberry32(5);
  const auto = (pid) => engine.autoAct(sim.state, pid, { rng, now: sim.now });
  assert.deepEqual(auto('p1'), { type: 'ready' });
  for (const id of ids(sim)) sim.act(id, auto(id));
  assert.equal(phase(sim), 'play');
  assert.equal(auto('p1'), null, 'nothing to do for a stalled seat during play');

  sim.act('p1', { type: 'accuse', target: 'p2' });
  const voter = ids(sim).find((i) => i !== 'p1' && i !== 'p2');
  assert.deepEqual(auto(voter), { type: 'vote', yes: false });
  assert.equal(auto('p1'), null, 'accuser already counted');
  for (const id of ids(sim)) if (id !== 'p2' && id !== 'p1') sim.act(id, auto(id));
  assert.equal(sim.view('p1').tally.convicted, false, 'auto votes never convict');
  settle(sim);

  sim.act(spyOf(sim), { type: 'spy-stop' });
  const a = auto(spyOf(sim));
  assert.equal(a.type, 'guess');
  assert.equal(sim.act(spyOf(sim), a), true);
  assert.equal(auto('p1').type, 'next-round');

  const h = playing(4, { seed: 91, config: { voteMode: 'hands' } });
  h.act('p1', { type: 'accuse', target: 'p2' });
  const act = engine.autoAct(h.state, 'p1', { rng, now: h.now });
  assert.deepEqual(act, { type: 'verdict', no: 1 });
  assert.equal(h.act('p1', act), true);
  assert.equal(h.view('p1').tally.convicted, false);
});

// ============================================================
// robustness
// ============================================================

test('spyfall: act never throws and ignores junk, whoever sends it, in every phase', () => {
  const junk = [
    null, undefined, 5, 'x', [], {}, { type: 5 }, { type: null }, { type: 'nope' }, { type: '' },
    { type: 'ask' }, { type: 'ask', target: {} }, { type: 'ask', target: null }, { type: 'ask', target: ['p1'] },
    { type: 'accuse' }, { type: 'accuse', target: 42 },
    { type: 'vote' }, { type: 'vote', yes: 1 }, { type: 'vote', yes: null }, { type: 'vote', yes: 'true' },
    { type: 'verdict' }, { type: 'verdict', no: '1' }, { type: 'verdict', no: NaN }, { type: 'verdict', no: Infinity },
    { type: 'guess' }, { type: 'guess', loc: NaN }, { type: 'guess', loc: null }, { type: 'guess', loc: {} }, { type: 'guess', loc: 1e9 },
    { type: ACT.CUE_DONE }, { type: ACT.NEXT, id: 3 },
  ];
  const phases = new Set();
  const sim = mk(5, { seed: 100, config: { rounds: 2 } });
  const probe = (sim) => {
    const key = `${sim.state.phase}:${sim.state.round.vote?.mode ?? ''}`;
    if (phases.has(key)) return;
    phases.add(key);
    const snap = JSON.stringify(sim.state);
    for (const pid of [...ids(sim), 'ghost', null, undefined, HOST]) {
      for (const a of junk) {
        let out;
        assert.doesNotThrow(() => { out = engine.act(clone(sim.state), { pid, action: a }, sim.ctx()); });
        // HOST + {type: ACT.CUE_DONE} with no id and ACT.NEXT are the only ones allowed to change anything
        if (pid === HOST && a && (a.type === ACT.NEXT)) continue;
        assert.equal(JSON.stringify(out ?? sim.state), snap, `junk changed state in ${sim.state.phase}: ${JSON.stringify(a)} from ${pid}`);
      }
    }
    assert.doesNotThrow(() => engine.act(clone(sim.state), undefined, sim.ctx()));
    assert.doesNotThrow(() => engine.act(clone(sim.state), { pid: 'p1' }, sim.ctx()));
  };
  probe(sim);
  sim.runRandom({ onStep: probe });
  // phases a random game may or may not visit: set them up on purpose
  const g = playing(5, { seed: 102 });
  g.act(spyOf(g), { type: 'spy-stop' });
  probe(g);
  const h = playing(5, { seed: 103, config: { voteMode: 'hands' } });
  h.act('p1', { type: 'accuse', target: 'p2' });
  probe(h);
  const t = playing(5, { seed: 104, config: { spies: 1 } });
  t.act('p1', { type: 'accuse', target: 'p2' });
  voteAll(t, true);
  probe(t);
  for (const ph of ['reveal:', 'play:', 'vote:phone', 'vote:hands', 'tally:', 'guess:', 'roundEnd:', 'over:']) {
    assert.ok(phases.has(ph), `junk probe never saw ${ph}`);
  }
});

test('spyfall: legalActions and act agree exactly, for every seat in every phase', () => {
  const universe = (n) => {
    const out = [{ type: 'ready' }, { type: 'undo-ask' }, { type: 'spy-stop' }, { type: 'next-round' },
      { type: 'vote', yes: true }, { type: 'vote', yes: false }];
    for (let i = 1; i <= n; i++) out.push({ type: 'ask', target: `p${i}` }, { type: 'accuse', target: `p${i}` });
    for (let no = 0; no <= n; no++) out.push({ type: 'verdict', no });
    for (let loc = 0; loc < 24; loc++) out.push({ type: 'guess', loc });
    return out;
  };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const seen = new Set();
  for (const mode of ['phone', 'hands']) {
    for (const spies of [1, 2]) {
      const sim = mk(6, { seed: 110 + spies, config: { voteMode: mode, spies, rounds: 2 } });
      const check = () => {
        const key = `${mode}${spies}:${sim.state.phase}:${sim.state.round.vote?.kind ?? ''}:${sim.state.round.guess?.idx ?? ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        const snap = JSON.stringify(sim.state);
        for (const pid of ids(sim)) {
          const legal = sim.legal(pid);
          for (const a of universe(6)) {
            const out = engine.act(clone(sim.state), { pid, action: a }, sim.ctx());
            const did = JSON.stringify(out ?? sim.state) !== snap;
            const isLegal = legal.some((l) => eq(l, a));
            assert.equal(did, isLegal, `${key} ${pid} ${JSON.stringify(a)}: act ${did ? 'changed' : 'ignored'} but legalActions says ${isLegal}`);
          }
        }
      };
      check();
      sim.runRandom({ onStep: check });
    }
  }
  assert.ok(seen.size >= 14, `covered ${seen.size} distinct situations`);
});

// ============================================================
// views: whitelist, leaks, anti-tell
// ============================================================

/**
 * Everything public: the view with this seat's private block removed. `hint` is per seat
 * (「輪到你問」 vs 「聽 X 問」) but built from public facts only; it has its own test below.
 */
const publicPart = (v) => { const { mine, hint, ...rest } = v; return rest; };

function checkViews(sim) {
  const s = sim.state;
  const r = s.round;
  const secretLoc = s.list[r.loc];
  const revealed = s.phase === 'roundEnd' || s.phase === 'over';
  const table = sim.view(null);
  assert.equal(table.mine, null);
  const base = JSON.stringify(publicPart(table));
  const guessPublic = s.phase === 'guess' || revealed;

  for (const p of sim.players) {
    const v = sim.view(p.id);
    // 1. anti-tell: apart from `mine`, every seat sees exactly what the table sees
    assert.equal(JSON.stringify(publicPart(v)), base, `public part differs for ${p.id} in ${s.phase}`);
    // 2. the private block describes this seat only
    assert.ok(v.mine);
    const isSpy = r.spies.includes(p.id);
    assert.equal(v.mine.isSpy, isSpy);
    assert.equal(v.mine.card.spy, isSpy);
    const mineDump = JSON.stringify(v.mine);
    if (isSpy) {
      assert.ok(!mineDump.includes(secretLoc.name), 'a spy’s card must not contain the location');
      for (const role of Object.values(r.roles)) assert.ok(!mineDump.includes(role));
    } else {
      assert.equal(v.mine.card.name, secretLoc.name);
      assert.ok(v.mine.card.text.includes(r.roles[p.id]));
      for (const q of sim.players) {
        if (q.id !== p.id && r.roles[q.id] && r.roles[q.id] !== r.roles[p.id]) {
          assert.ok(!mineDump.includes(r.roles[q.id]), `${p.id} sees ${q.id}'s role`);
        }
      }
    }
    // 3. nothing about the deal outside `mine` before the reveal — apart from the public list
    if (!revealed) {
      const pub = JSON.stringify({ ...publicPart(v), locations: undefined, history: undefined });
      for (const role of Object.values(r.roles)) assert.ok(!pub.includes(role), 'role in public part');
      assert.ok(!pub.includes(secretLoc.name), 'secret location name outside the list in the public part');
      assert.equal(v.end, null);
    }
    // 4. the list carries no tell about the secret
    for (const l of v.locations) {
      assert.deepEqual(Object.keys(l).sort(), ['cat', 'emoji', 'i', 'name', 'used']);
      assert.equal(l.used, s.history.some((h) => h.loc === l.i), 'used = finished rounds only');
    }
    assert.equal(v.locations.length, s.list.length);
    if (!revealed) assert.equal(v.locations[r.loc].used, false, 'the current secret is not marked used');
    // 4b. the 💡 hint: one short line, never a secret
    assert.ok(typeof v.hint === 'string' && v.hint.length > 0 && Array.from(v.hint).length <= 50, `hint: ${v.hint}`);
    if (!revealed) {
      assert.ok(!v.hint.includes(secretLoc.name), `hint leaks the location: ${v.hint}`);
      for (const role of Object.values(r.roles)) assert.ok(!v.hint.includes(role), `hint leaks a role: ${v.hint}`);
    }
    assert.equal(v.mine.role, isSpy ? 'spy' : 'agent');
    // 5. the spies are public only once a spy has acted or the round is over
    if (!guessPublic) assert.equal(v.guess, null);
    if (v.guess) for (const sp of v.guess.shown) assert.ok(r.spies.includes(sp));
  }
}

test('spyfall: views are whitelisted, identical for every seat apart from `mine`, and leak nothing', () => {
  for (let n = 3; n <= 12; n++) {
    const spies = n >= 9 ? 2 : 1;
    const sim = mk(n, { seed: 120 + n, config: { rounds: 2, spies, voteMode: n % 2 ? 'hands' : 'phone' } });
    checkViews(sim);
    sim.runRandom({ onStep: checkViews });
  }
});

test('spyfall: view() is a fresh object — mutating it never touches the state', () => {
  const sim = playing(4, { seed: 130 });
  const snap = JSON.stringify(sim.state);
  const v = sim.view('p1');
  v.locations.length = 0;
  v.totals.p1 = 99;
  v.mine.card.name = 'x';
  v.floor.holder = 'p4';
  assert.equal(JSON.stringify(sim.state), snap);
  const keys = Object.keys(v).sort();
  for (const forbidden of ['state', 'list', 'cfg', 'players', 'order', 'cue', 'seq', 'used', 'roles', 'spies', 'loc', 'secret']) {
    assert.ok(!keys.includes(forbidden), `top-level key ${forbidden} must not be exposed`);
  }
  assert.deepEqual(Object.keys(v.round).sort(), ['n', 'of'], 'view.round is only the round counter, not state.round');
});

test('spyfall: the spy’s card and an agent’s card have the same shape', () => {
  const sim = mk(5, { seed: 131 });
  const shape = (c) => Object.keys(c).sort().join(',');
  const shapes = new Set(sim.players.map((p) => shape(sim.view(p.id).mine.card)));
  assert.equal(shapes.size, 1);
  const spyCard = sim.view(spyOf(sim)).mine.card;
  assert.equal(spyCard.name, '你係間諜');
  const agentCard = sim.view(nonSpies(sim)[0]).mine.card;
  assert.ok(Math.abs(spyCard.text.length - agentCard.text.length) < 20, 'no glaring length tell');
});

test('spyfall: a seat that is not in the game gets the public view and no card', () => {
  const sim = playing(4, { seed: 132 });
  const v = sim.view('late-joiner');
  assert.equal(v.mine, null);
  assert.deepEqual(sim.legal('late-joiner'), []);
  assert.equal(sim.act('late-joiner', { type: 'accuse', target: 'p1' }), false);
  assert.equal(JSON.stringify(v), JSON.stringify(sim.view(null)));
});

test('spyfall: the reveal exposes the deal to everyone, and only then', () => {
  const sim = playing(5, { seed: 133 });
  wrongGuess(sim);
  const v = sim.view('p2');
  assert.equal(v.phase, 'roundEnd');
  assert.equal(v.end.location.name, sim.state.list[R(sim).loc].name);
  assert.deepEqual(v.end.spies, R(sim).spies);
  assert.deepEqual(v.end.roles, R(sim).roles);
  assert.ok(v.end.headline && v.end.lines.length >= 2);
  assert.ok(sim.cue().text.includes(sim.state.list[R(sim).loc].name), 'narration reveals it at the end');
  assert.equal(v.history.length, 1);
});

// ============================================================
// determinism and persistence
// ============================================================

test('spyfall: same seed, same game; state survives a JSON round-trip mid-game', () => {
  const run = (seed) => {
    const sim = mk(6, { seed, config: { rounds: 2 } });
    const out = sim.runRandom();
    return JSON.stringify([sim.state, out.result]);
  };
  assert.equal(run(7), run(7));
  assert.notEqual(run(7), run(8));

  const sim = mk(5, { seed: 140, config: { rounds: 2 } });
  let i = 0;
  sim.runRandom({
    onStep(s) {
      if (i++ % 7) return;
      const json = JSON.stringify(s.state);
      assert.equal(JSON.stringify(JSON.parse(json)), json);
      const a = engine.view(s.state, 'p1');
      const b = engine.view(JSON.parse(json), 'p1');
      assert.deepEqual(a, b);
    },
  });
});

// ============================================================
// fuzzer: every head-count × many seeds, random legal play to the end
// ============================================================

test('spyfall: fuzz — every player count × 100 seeds terminates with a well-formed result', () => {
  const seenPhases = new Set();
  const seenCodes = new Set();
  let games = 0;
  for (let n = game.meta.players[0]; n <= game.meta.players[1]; n++) {
    for (let seed = 1; seed <= 100; seed++) {
      const spies = n >= 6 && seed % 4 === 0 ? 2 : 1;
      const config = {
        spies,
        rounds: 1 + (seed % 3),
        voteMode: seed % 2 ? 'phone' : 'hands',
        listSize: [16, 20, 24, 30][seed % 4],
        categories: { cats: seed % 5 === 0 ? ['日本', '香港'] : [] },
        accuserBonus: ['first-midround', 'successful', 'first-any'][seed % 3],
        twoSpyThreshold: seed % 8 === 0 ? 'n-3' : 'n-2',
        antiStreak: seed % 7 === 0,
      };
      const sim = mk(n, { seed: seed * 1000 + n, config });
      const checked = seed <= 3;           // full per-step view checks on a sample (the leak test covers every size), plain play on the rest
      let dealtRound = 0;
      const { result, steps } = sim.runRandom({
        maxSteps: 30000,
        onStep(s) {
          seenPhases.add(s.state.phase);
          if (checked) checkViews(s);
          // role-count invariants, once per deal
          const r = s.state.round;
          if (r.n !== dealtRound) {
            dealtRound = r.n;
            assert.equal(r.spies.length, spies, 'spy count');
            assert.equal(new Set(r.spies).size, spies);
            assert.deepEqual(Object.keys(r.roles).sort(), ids(s).filter((id) => !r.spies.includes(id)).sort(), 'every non-spy has a role, no spy has one');
            const prev = s.state.history[s.state.history.length - 1];
            if (config.antiStreak && prev) assert.ok(!r.spies.some((id) => prev.spies.includes(id)), 'anti-streak');
          }
        },
      });
      games++;
      const s = sim.state;
      assert.equal(s.phase, 'over');
      assert.equal(s.history.length, s.cfg.rounds);
      assert.equal(new Set(s.history.map((h) => h.loc)).size, s.history.length, 'no repeated location');
      for (const h of s.history) {
        seenCodes.add(h.code);
        assert.equal(h.spies.length, spies);
        const total = sum(h.deltas);
        assert.ok(total > 0 && total <= 4 + (spies === 2 ? 4 : 0) + n, 'sane points');
      }
      for (const id of ids(sim)) {
        assert.equal(s.totals[id], s.history.reduce((a, h) => a + h.deltas[id], 0));
      }
      assert.deepEqual(result.points, s.totals);
      assert.ok(result.winners.length >= 1);
      assert.ok(steps > 5);
    }
  }
  for (const ph of ['reveal', 'play', 'vote', 'tally', 'guess', 'roundEnd', 'over']) {
    assert.ok(seenPhases.has(ph), `fuzz never reached phase ${ph}`);
  }
  for (const code of ['survived', 'final-innocent', 'accused-innocent', 'guess-right', 'accused-spy', 'final-spy', 'guess-wrong']) {
    assert.ok(seenCodes.has(code), `fuzz never produced outcome ${code} (${[...seenCodes]})`);
  }
  assert.equal(games, 10 * 100);
});

test('spyfall: fuzz — a bank that refills mid-list still never repeats a location inside one list', () => {
  const small = FIXTURE.slice(0, 11);
  for (let seed = 1; seed <= 40; seed++) {
    const sim = new Sim(game, {
      n: 5, seed, banks: { spyfall: small },
      config: { ...game.config.defaults(5), listSize: 30, rounds: 3 },
    });
    // pre-use part of the bank so the bag has to refill while the list is drawn
    sim.bag.draw('spyfall');
    sim.bag.draw('spyfall');
    const again = new Sim(game, { n: 5, seed, banks: { spyfall: small }, config: { ...game.config.defaults(5), listSize: 30, rounds: 3 } });
    for (const s of [sim, again]) {
      const names = s.state.list.map((e) => e.name);
      assert.equal(new Set(names).size, names.length);
      assert.ok(names.length >= 8 && names.length <= 11);
    }
    again.runRandom();
  }
});

// ============================================================
// verified rules (docs/research/spyfall.md § Verification) — one test per corrected rule
// ============================================================

test('spyfall: rule — the uncaught second spy scores as a non-spy, first-accuser bonus included', () => {
  const sim = playing(6, { seed: 56, config: { spies: 2 } });
  const [s1, s2] = R(sim).spies;
  const ns = nonSpies(sim);
  sim.act(s2, { type: 'accuse', target: s1 });         // the other spy names s1 first; it fails
  voteAll(sim, false);
  settle(sim);
  assert.equal(phase(sim), 'play');
  sim.act(ns[0], { type: 'accuse', target: s1 });      // later mid-round vote succeeds
  voteAll(sim, true);
  settle(sim);
  const e = sim.view('p1').end;
  assert.equal(e.code, 'accused-spy');
  assert.equal(e.caught, s1);
  assert.equal(e.bonusTo, s2, 'the rulebook: the uncaught spy scores "as if he were a non-spy player"');
  assert.equal(e.deltas[s2], 2, '+1 as a non-spy, +1 first accuser');
  assert.equal(e.deltas[s1], 0);
  for (const id of ns) assert.equal(e.deltas[id], 1);
});

test('spyfall: rule — two spies, one caught at the final vote: the other gets +1 as a non-spy and nobody a bonus', () => {
  const sim = playing(6, { seed: 57, config: { spies: 2 } });
  const [s1, s2] = R(sim).spies;
  const ns = nonSpies(sim);
  sim.act(ns[0], { type: 'accuse', target: s1 });      // names s1 mid-round, fails
  voteAll(sim, false);
  settle(sim);
  timeUp(sim);
  while (sim.view('p1').vote.suspect !== s1) { voteAll(sim, false); settle(sim); }
  voteAll(sim, true);
  settle(sim);
  const e = sim.view('p1').end;
  assert.equal(e.code, 'final-spy');
  assert.equal(e.bonusTo, null);
  assert.equal(e.deltas[s2], 1);
  assert.equal(e.deltas[s1], 0);
  for (const id of ns) assert.equal(e.deltas[id], 1, 'no bonus for the earlier accuser');
});

test('spyfall: rule — the spy may stop the clock again once a failed accusation resumes play', () => {
  const sim = playing(5, { seed: 63 });
  const spy = spyOf(sim);
  const [x, y] = nonSpies(sim);
  sim.act(x, { type: 'accuse', target: y });
  assert.equal(sim.act(spy, { type: 'spy-stop' }), false, 'not while the vote is open');
  voteAll(sim, false);
  assert.equal(phase(sim), 'tally');
  assert.equal(sim.act(spy, { type: 'spy-stop' }), false, 'not while the result is on screen');
  settle(sim);
  assert.equal(phase(sim), 'play');
  assert.equal(sim.act(spy, { type: 'spy-stop' }), true, 'Russian v1.1: the spy regains the right to reveal');
  assert.equal(phase(sim), 'guess');
});

test('spyfall: rule — at time-up the spy can no longer guess and the table is told not to name the location', () => {
  const sim = playing(5, { seed: 64 });
  timeUp(sim);
  assert.equal(phase(sim), 'vote');
  assert.equal(sim.act(spyOf(sim), { type: 'spy-stop' }), false);
  const c = sim.cue().text;
  assert.ok(c.includes('唔可以再估') && c.includes('唔好講出地點'), c);
  const suspect = sim.view('p1').vote.suspect;
  const voter = ids(sim).find((id) => id !== suspect);
  assert.ok(sim.view(voter).hint.includes('唔好講出地點'));
  assert.ok(sim.view(suspect).hint.includes('唔好講出地點'));
});

test('spyfall: rule — final vote: suspects in seat order from the dealer, each once, first conviction ends it (two spies too)', () => {
  const sim = playing(7, { seed: 65, config: { spies: 2 } });
  const order = ids(sim);
  const d = R(sim).dealer;
  timeUp(sim);
  const seen = [];
  // the third suspect is convicted with exactly one dissenter (allowed with two spies); the round ends there
  for (let i = 0; i < 3; i++) {
    const v = sim.view('p1').vote;
    seen.push(v.suspect);
    if (i < 2) voteAll(sim, false);
    else v.voters.forEach((id, k) => sim.act(id, { type: 'vote', yes: k !== 0 }));
    settle(sim);
  }
  assert.deepEqual(seen, [0, 1, 2].map((i) => order[(order.indexOf(d) + i) % 7]));
  assert.equal(phase(sim), 'roundEnd');
  assert.equal(sim.view('p1').end.suspect, seen[2]);
});

test('spyfall: option twoSpyThreshold=n-3 — two dissenters still convict, three do not', () => {
  const run = (noes, seed) => {
    const sim = playing(7, { seed, config: { spies: 2, twoSpyThreshold: 'n-3' } });
    const [s1] = R(sim).spies;
    const x = nonSpies(sim)[0];
    sim.act(x, { type: 'accuse', target: s1 });
    const v = sim.view('p1').vote;
    assert.equal(v.maxNo, 2);
    assert.equal(v.need, 4);
    const voters = v.voters.filter((id) => id !== x);
    voters.forEach((id, k) => sim.act(id, { type: 'vote', yes: k >= noes }));
    return sim.view('p1').tally.convicted;
  };
  assert.equal(run(2, 66), true);
  assert.equal(run(3, 67), false);
  // hands mode: autoAct reports one "no" too many to convict
  const h = playing(7, { seed: 68, config: { spies: 2, twoSpyThreshold: 'n-3', voteMode: 'hands' } });
  const x = nonSpies(h)[0];
  h.act(x, { type: 'accuse', target: R(h).spies[0] });
  assert.deepEqual(engine.autoAct(h.state, x, h.ctx()), { type: 'verdict', no: 3 });
  assert.equal(h.view('p1').rules.maxNo, 2);
  h.act(x, { type: 'verdict', no: 2 });
  assert.equal(h.view('p1').tally.convicted, true);
});

// ============================================================
// backlog #8 — head-count presets with a reason, invalid compositions blocked
// ============================================================

test('spyfall: #8 presets — every head-count has presets with a readable reason, and every preset is valid', () => {
  for (let n = 3; n <= 12; n++) {
    const ps = game.config.presets(n);
    assert.ok(ps.length >= 3, `n=${n}`);
    assert.equal(ps[0].id, 'standard');
    assert.equal(new Set(ps.map((p) => p.id)).size, ps.length, 'ids unique');
    assert.ok(ps[0].reason.startsWith(`${n} 人：`), ps[0].reason);
    const d = game.config.defaults(n);
    assert.equal(ps[0].cfg.spies, d.spies, 'the standard preset is what defaults() gives');
    assert.equal(ps[0].cfg.minutes, d.minutes);
    for (const p of ps) {
      assert.ok(p.label && Array.from(p.label).length <= 6, `short label: ${p.label}`);
      assert.ok(p.reason && Array.from(p.reason).length <= 45, `short reason: ${p.reason}`);
      const cfg = { ...d, ...p.cfg };
      const v = game.config.validate(cfg, n);
      assert.ok(v.ok, `n=${n} preset ${p.id}: ${v.message}`);
      new Sim(game, { n, seed: n, config: cfg, banks }).runRandom();
    }
    assert.equal(ps.some((p) => p.id === 'two-spies'), n >= 6 && n <= 8, 'two-spy preset only where it is an alternative');
  }
  assert.match(game.config.presets(6)[0].reason, /6 人：1 個間諜 · 每局 7 分鐘 — 官方建議/);
  assert.match(game.config.presets(9)[0].reason, /9 人：2 個間諜/);
});

test('spyfall: #8 validate blocks invalid compositions and option values; old saved configs still load', () => {
  const v = (cfg, n) => game.config.validate({ ...game.config.defaults(n), ...cfg }, n);
  for (const n of [3, 4, 5]) assert.equal(v({ spies: 2 }, n).ok, false, `2 spies at ${n}`);
  assert.equal(v({ spies: 0 }, 6).ok, false);
  assert.equal(v({ spies: 3 }, 12).ok, false);
  assert.equal(v({ accuserBonus: 'everyone' }, 6).ok, false);
  assert.equal(v({ twoSpyThreshold: 'n-4' }, 9).ok, false);
  assert.equal(v({ antiStreak: 'yes' }, 6).ok, false);
  assert.ok(v({ spies: 1 }, 12).warnings.some((w) => /2 個間諜/.test(w)), '12 with one spy is non-standard');
  const old = { rounds: 3, minutes: 7, spies: 1, listSize: 24, voteMode: 'phone', categories: { cats: [] } };
  assert.equal(game.config.validate(old, 6).ok, true, 'a config saved before the new keys existed');
  const sim = new Sim(game, { n: 6, seed: 1, config: old, banks });
  assert.equal(sim.state.cfg.accuserBonus, 'first-midround');
  assert.equal(sim.state.cfg.twoSpyThreshold, 'n-2');
  assert.equal(sim.state.cfg.antiStreak, false);
  // tastes carry over from the last game
  const prev = { ...game.config.defaults(6), accuserBonus: 'successful', twoSpyThreshold: 'n-3', antiStreak: true };
  const next = game.config.defaults(9, prev);
  assert.deepEqual([next.accuserBonus, next.twoSpyThreshold, next.antiStreak], ['successful', 'n-3', true]);
});

// ============================================================
// backlog #20 — fair randomness
// ============================================================

test('spyfall: #20 — the first asker (round-1 dealer) is random over ALL seats, spy included, independent of the spy', () => {
  const n = 5;
  const asSeat = Object.fromEntries(ids(mk(n)).map((id) => [id, 0]));
  let dealerIsSpy = 0;
  const N = 1000;
  for (let seed = 1; seed <= N; seed++) {
    const sim = mk(n, { seed });
    asSeat[R(sim).dealer]++;
    if (R(sim).spies.includes(R(sim).dealer)) dealerIsSpy++;
    if (seed === 1) { readyAll(sim); assert.equal(sim.view('p1').floor.holder, R(sim).dealer, 'the dealer asks first'); }
  }
  for (const [id, c] of Object.entries(asSeat)) assert.ok(c > 140 && c < 260, `${id} dealt ${c}/${N}`);
  assert.ok(dealerIsSpy > 140 && dealerIsSpy < 260, `dealer is the spy ${dealerIsSpy}/${N} (expect about ${N / n})`);
});

test('spyfall: #20 option antiStreak — off by default; on, nobody is the spy two rounds running', () => {
  assert.equal(game.config.defaults(5).antiStreak, false, 'the rules doc does not recommend it, so it is off');
  const repeats = (antiStreak, n, spies) => {
    let hits = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const sim = mk(n, { seed, config: { rounds: 10, listSize: 16, antiStreak, spies } });
      playRounds(sim);
      const hs = sim.state.history;
      for (let i = 1; i < hs.length; i++) if (hs[i].spies.some((id) => hs[i - 1].spies.includes(id))) hits++;
    }
    return hits;
  };
  assert.ok(repeats(false, 3, 1) > 0, 'without the option a spy can repeat (uniform draw)');
  assert.equal(repeats(true, 3, 1), 0);
  assert.equal(repeats(true, 6, 2), 0);
});

// ============================================================
// backlog U1 — on-demand teaching text
// ============================================================

test('spyfall: U1 — rules.quick is at most 6 short lines; every role says what you do and how you win', () => {
  const q = game.rules.quick;
  assert.ok(q.length >= 3 && q.length <= 6);
  for (const l of q) assert.ok(Array.from(l).length <= 40, `short quick line: ${l}`);
  assert.deepEqual(game.rules.roles.map((r) => r.id).sort(), ['agent', 'spy']);
  for (const r of game.rules.roles) {
    assert.ok(r.name && r.emoji && r.team && r.text);
    assert.ok(r.text.includes('點贏'), `${r.id} says how to win`);
    assert.ok(r.text.split('點贏')[0].length >= 15, `${r.id} says what you do`);
  }
});

test('spyfall: U1 — every phase has a hint for every seat and spectators, and hints never depend on who the spy is', () => {
  const phases = new Set();
  for (const [n, mode, spies] of [[3, 'phone', 1], [5, 'hands', 1], [7, 'phone', 2], [9, 'hands', 2]]) {
    for (let seed = 1; seed <= 6; seed++) {
      const sim = mk(n, { seed: seed * 31 + n, config: { rounds: 2, voteMode: mode, spies } });
      const check = (s) => {
        const st = s.state;
        phases.add(st.phase);
        // the same table with a different spy (every other secret left alone)
        const alt = clone(st);
        const order = ids(s);
        alt.round.spies = st.round.spies.map((sp) => order[(order.indexOf(sp) + 1) % order.length]);
        for (const pid of [...order, null, 'late-joiner']) {
          const h = engine.view(st, pid).hint;
          assert.ok(typeof h === 'string' && h.length > 0 && Array.from(h).length <= 50, `${st.phase}: ${h}`);
          assert.equal(engine.view(alt, pid).hint, h, `hint for ${pid} in ${st.phase} depends on the spy`);
        }
      };
      check(sim);
      sim.runRandom({ onStep: check });
    }
  }
  for (const ph of ['reveal', 'play', 'vote', 'tally', 'guess', 'roundEnd', 'over']) assert.ok(phases.has(ph), `no hint checked in ${ph}`);
  // a few concrete lines
  const sim = playing(4, { seed: 9 });
  const d = R(sim).dealer;
  assert.match(sim.view(d).hint, /輪到你/);
  assert.match(sim.view(ids(sim).find((x) => x !== d)).hint, /指控/);
});

// ============================================================
// backlog #10 — results that explain why
// ============================================================

test('spyfall: #10 — result lines list every round (location, spies, who scored) and explain the last round', () => {
  const sim = mk(5, { seed: 84, config: { rounds: 2 } });
  readyAll(sim);
  const spy1 = spyOf(sim);
  const [x, y] = nonSpies(sim);
  const roleY = R(sim).roles[y];
  sim.act(x, { type: 'accuse', target: y });           // an innocent convicted mid-round
  voteAll(sim, true);
  settle(sim);
  const e1 = sim.view('p1').end;
  assert.equal(e1.code, 'accused-innocent');
  assert.ok(e1.lines.some((l) => l.includes(`「${roleY}」`)), 'the innocent’s hidden role is explained');
  sim.act('p1', { type: 'next-round' });
  readyAll(sim);
  const spy2 = spyOf(sim);
  const [a] = nonSpies(sim);
  sim.act(a, { type: 'accuse', target: spy2 });        // names the spy, fails…
  voteAll(sim, false);
  settle(sim);
  wrongGuess(sim);                                     // …then the spy guesses wrong
  const e2 = sim.view('p1').end;
  assert.ok(e2.lines.some((l) => l.includes('指控過佢嘅人冇額外分')), 'explains why the accuser got nothing extra');
  sim.act('p1', { type: 'next-round' });
  const res = sim.result();
  const [l1, l2] = res.lines;
  const name = (id) => sim.players.find((p) => p.id === id).name;
  assert.ok(l1.includes('第 1 局') && l1.includes(sim.state.list[sim.state.history[0].loc].name), l1);
  assert.ok(l1.includes(name(spy1)) && l1.includes(`${name(spy1)} +4`), l1);
  assert.ok(l2.includes('第 2 局') && l2.includes('非間諜各 +1'), l2);
  assert.ok(res.lines.includes('第 2 局點解咁計：'));
  assert.ok(res.lines.some((l) => l.includes('指控過佢嘅人冇額外分')));
});

// ============================================================
// ui.js smoke test — a minimal fake DOM, one mounted UI per seat + the table
// ============================================================

class FNode {}
class FText extends FNode {
  constructor(t) { super(); this.data = String(t); this.parentNode = null; }
  get textContent() { return this.data; }
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
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(...(String(v) === '' ? [] : [new FText(v)])); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  append(...kids) { for (const k of kids) this.appendChild(k instanceof FNode ? k : new FText(k)); }
  appendChild(k) { k.parentNode?.removeChild(k); k.parentNode = this; this.children.push(k); return k; }
  removeChild(k) { const i = this.children.indexOf(k); if (i >= 0) { this.children.splice(i, 1); k.parentNode = null; } return k; }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() { this.parentNode?.removeChild(this); }
}
const fakeDocument = { createElement: (t) => new FEl(t), createTextNode: (t) => new FText(t) };
const walkEl = (n, fn) => { fn(n); if (n.children) for (const c of n.children) walkEl(c, fn); };
const findEls = (root, pred) => { const out = []; walkEl(root, (n) => { if (n instanceof FEl && pred(n)) out.push(n); }); return out; };
const serializeEl = (n) => (n instanceof FText ? n.data
  : JSON.stringify([n.tag, [...n.cls].sort(), n.attrs, n.hidden, n.disabled, n.styleMap, n.dataset, n.children.map(serializeEl)]));
/** Visible = neither it nor an ancestor is hidden. */
const shown = (n) => { for (let x = n; x; x = x.parentNode) if (x.hidden) return false; return true; };

function stubSpyfallComponents() {
  const E = (tag, cls) => { const n = new FEl(tag); if (cls) n.className = cls; return n; };
  const RoleCard = (p0) => {
    const root = E('div', 'c-rolecard');
    const api = { el: root, update(p) { root.textContent = p.role ? `${p.role.name}|${p.role.text}` : ''; }, close() {}, destroy() { root.remove(); } };
    api.update(p0);
    return api;
  };
  const Timer = (p0) => {
    const root = E('div', 'c-timer');
    const api = { el: root, update(p) { root.textContent = String(p.deadline); }, destroy() { root.remove(); } };
    api.update(p0);
    return api;
  };
  const PlayerPicker = (p0) => {
    const root = E('div', 'c-playerpicker');
    const api = { el: root, update(p) { root.textContent = (p.players ?? []).map((x) => x.id).join(','); }, destroy() { root.remove(); } };
    api.update(p0);
    return api;
  };
  return { RoleCard, Timer, PlayerPicker };
}

async function withSpyfallUi(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node };
  globalThis.document = fakeDocument;
  globalThis.Node = FNode;
  try {
    return await fn(await import('../js/games/spyfall/ui.js'));
  } finally {
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
    if (saved.Node === undefined) delete globalThis.Node; else globalThis.Node = saved.Node;
  }
}

test('spyfall ui: every phase renders on every seat and the table, idempotently, with the verified vote texts', async () => {
  await withSpyfallUi(async (ui) => {
    const comps = stubSpyfallComponents();
    const seen = new Set();
    const cases = [
      [5, { voteMode: 'phone' }], [5, { voteMode: 'hands' }],
      [7, { voteMode: 'hands', spies: 2 }], [7, { voteMode: 'hands', spies: 2, twoSpyThreshold: 'n-3' }],
      [9, { voteMode: 'phone', spies: 2 }],
    ];
    for (const [n, cfg] of cases) {
      for (let seed = 1; seed <= 2; seed++) {
        const sim = mk(n, { seed: seed * 17 + n, config: { rounds: 2, ...cfg } });
        const seats = [...ids(sim), null].map((pid) => {
          const root = new FEl('div');
          const api = {
            me: pid, players: sim.players, isHost: pid === 'p1', meta: game.meta, config: sim.state.cfg,
            send: () => {}, ink() {}, now: () => sim.now, sfx() {}, toast() {}, components: comps,
          };
          return { pid, root, handle: ui.mount(root, api) };
        });
        const render = (s) => {
          for (const seat of seats) {
            const v = s.view(seat.pid);
            seen.add(v.phase);
            seat.handle.update(v, { focus: null, paused: false });
            const a = serializeEl(seat.root);
            seat.handle.update(clone(v), { focus: null, paused: false });
            assert.equal(serializeEl(seat.root), a, `update() not idempotent for ${seat.pid ?? 'table'} in ${v.phase}`);
            const text = seat.root.textContent;
            if (v.phase === 'vote' && v.vote.kind === 'final') assert.ok(text.includes('唔好講出地點'), 'final-vote reminder');
            if (v.phase === 'vote' && v.vote.kind === 'accuse') assert.ok(text.includes('唔好講理由'));
            if (v.phase === 'vote' && v.vote.mode === 'hands' && seat.pid === v.vote.reporter) {
              const box = findEls(seat.root, (x) => x.cls.has('sf-hands-btns') && shown(x))[0];
              assert.ok(box, 'reporter sees the result buttons');
              assert.equal(box.children.length, v.vote.maxNo + 2, 'one button per allowed "no" count, plus "too many"');
            }
            if (v.vote && v.vote.maxNo > 0) assert.ok(text.includes(`最多 ${v.vote.maxNo} 個人反對`), 'threshold text follows maxNo');
          }
        };
        render(sim);
        sim.runRandom({ onStep: render });
        for (const seat of seats) seat.handle.destroy();
      }
    }
    for (const ph of ['reveal', 'play', 'vote', 'tally', 'guess', 'roundEnd', 'over']) assert.ok(seen.has(ph), `ui never rendered ${ph}`);
  });
});

test('spyfall ui: the hands-mode buttons send verdicts the engine accepts, including "too many"', async () => {
  await withSpyfallUi(async (ui) => {
    const comps = stubSpyfallComponents();
    for (const cfg of [{ spies: 1 }, { spies: 2 }, { spies: 2, twoSpyThreshold: 'n-3' }]) {
      const sim = playing(7, { seed: 77, config: { voteMode: 'hands', ...cfg } });
      const x = nonSpies(sim)[0];
      sim.act(x, { type: 'accuse', target: R(sim).spies[0] });
      const sent = [];
      const root = new FEl('div');
      const handle = ui.mount(root, {
        me: x, players: sim.players, isHost: false, meta: game.meta, config: sim.state.cfg,
        send: (a) => sent.push(a), ink() {}, now: () => sim.now, sfx() {}, toast() {}, components: comps,
      });
      handle.update(sim.view(x), {});
      const btns = findEls(root, (n) => n.cls.has('sf-hands-btns'))[0].children;
      for (const b of btns) for (const f of b.listeners.click ?? []) f({});
      const maxNo = sim.view(x).vote.maxNo;
      assert.deepEqual(sent.map((a) => a.no), Array.from({ length: maxNo + 2 }, (_, i) => i));
      for (const a of sent) assert.ok(sim.legal(x).some((l) => l.type === 'verdict' && l.no === a.no), `verdict ${a.no} is legal`);
      assert.equal(sim.act(x, sent[sent.length - 1]), true);
      assert.equal(sim.view(x).tally.convicted, false, '"too many" never convicts');
      handle.destroy();
    }
  });
});

// ---------- playtest fixes (docs/playtest/multi/spyfall.md) ----------

/** Mount one seat's UI on the fake DOM, logging what it sends, plays and toasts. */
function mountSpyfallSeat(ui, sim, pid, log) {
  const root = new FEl('div');
  const handle = ui.mount(root, {
    me: pid, players: sim.players, isHost: pid === 'p1', meta: game.meta, config: sim.state.cfg,
    send: (a) => log.sent.push([pid, a]), ink() {}, now: () => sim.now,
    sfx: (n) => log.sfx.push([pid, n]), toast: (t) => log.toast.push([pid, t]), components: stubSpyfallComponents(),
  });
  const show = () => handle.update(sim.view(pid), { focus: null, paused: false });
  show();
  return { pid, root, handle, show };
}
/** h() sets the attribute (as the real DOM would); the fake element keeps it in attrs. */
const isOff = (b) => b.disabled || 'disabled' in b.attrs;
const clickEl = (b) => {
  assert.ok(b, 'button exists');
  assert.ok(!isOff(b), `button 「${b.textContent}」 is enabled`);
  for (const f of b.listeners.click ?? []) f({});
};
const btnText = (root, text) => findEls(root, (n) => n.tag === 'button' && shown(n) && n.textContent.includes(text))[0];
const boxOf = (root, cls) => findEls(root, (n) => n.cls.has(cls))[0];

/** Timers are queued, not run, until `step()`; window.scrollTo is recorded. */
async function withQueuedTimers(fn) {
  const saved = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, scrollTo: globalThis.scrollTo };
  const queue = [];
  let seq = 0;
  const scrolls = [];
  globalThis.setTimeout = (f, ms) => { const id = ++seq; queue.push({ id, f, ms }); return id; };
  globalThis.clearTimeout = (id) => { const i = queue.findIndex((q) => q.id === id); if (i >= 0) queue.splice(i, 1); };
  globalThis.scrollTo = (x, y) => scrolls.push([x, y]);
  try {
    return await fn({ step: () => { const q = queue.shift(); q?.f(); return !!q; }, pending: () => queue.length, scrolls });
  } finally {
    globalThis.setTimeout = saved.setTimeout;
    globalThis.clearTimeout = saved.clearTimeout;
    if (saved.scrollTo === undefined) delete globalThis.scrollTo; else globalThis.scrollTo = saved.scrollTo;
  }
}

test('spyfall ui: 🕵️ 我係間諜 is the same silent panel on every phone; only a spy’s 停鐘 sends anything', async () => {
  await withSpyfallUi(async (ui) => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../js/games/spyfall/ui.js', import.meta.url), 'utf8');
    assert.ok(!src.includes('你唔係間諜'), 'no screen ever says 「你唔係間諜」');
    for (const spies of [1, 2]) {
      const sim = playing(spies === 2 ? 7 : 5, { seed: 31 + spies, config: { spies } });
      const spy = spyOf(sim);
      const agent = nonSpies(sim)[0];
      const log = { sent: [], sfx: [], toast: [] };
      const seats = [spy, agent].map((pid) => mountSpyfallSeat(ui, sim, pid, log));
      const acts = (s) => serializeEl(boxOf(s.root, 'sf-actions'));
      assert.equal(acts(seats[0]), acts(seats[1]), 'the action grid is identical for the spy and a non-spy');
      for (const s of seats) clickEl(btnText(s.root, '我係間諜'));
      assert.equal(acts(seats[0]), acts(seats[1]), 'the confirm panel is identical for the spy and a non-spy');
      assert.ok(seats[1].root.textContent.includes('確定要亮身分'), 'a non-spy gets the same confirmation');
      assert.deepEqual([log.sfx, log.toast], [[], []], 'no sound and no toast for anyone');
      // a non-spy's 停鐘 closes the panel like 取消 and sends nothing
      clickEl(btnText(seats[1].root, '我係間諜，停鐘'));
      assert.deepEqual(log.sent, [], 'a non-spy sends nothing');
      assert.ok(btnText(seats[1].root, '🕵️ 我係間諜'), 'back to the main buttons');
      // 取消 does the same for the spy; then a real 停鐘
      clickEl(btnText(seats[0].root, '取消'));
      assert.equal(acts(seats[0]), acts(seats[1]), 'both phones are back to the same grid');
      clickEl(btnText(seats[0].root, '我係間諜'));
      clickEl(btnText(seats[0].root, '我係間諜，停鐘'));
      assert.deepEqual(log.sent, [[spy, { type: 'spy-stop' }]]);
      assert.equal(sim.act(spy, log.sent[0][1]), true, 'the engine accepts what the spy sent');
      assert.deepEqual([log.sfx, log.toast], [[], []], 'still silent everywhere');
      for (const s of seats) s.handle.destroy();
    }
    const section = game.rules.sections.find((x) => x.title === '指控同投票');
    assert.ok(section.body.includes('唔好俾人睇你部手機證明身分'), 'the rules sheet says not to use the phone as proof');
  });
});

test('spyfall ui: the clock bar keeps 🙋 in reach; the list folds once when play starts; used accusations are marked', async () => {
  await withSpyfallUi(async (ui) => withQueuedTimers(async (t) => {
    const sim = mk(5, { seed: 44 });
    const log = { sent: [], sfx: [], toast: [] };
    const seats = ids(sim).map((pid) => mountSpyfallSeat(ui, sim, pid, log));
    const listChips = (s) => findEls(s.root, (n) => n.cls.has('sf-loc') && shown(n)).length;
    const nm = (pid) => sim.players.find((p) => p.id === pid).name;
    for (const s of seats) {
      assert.ok(listChips(s) > 0, 'the list is open during the look');
      assert.ok(!shown(boxOf(s.root, 'sf-clock')), 'no clock bar before play');
    }
    readyAll(sim);
    t.scrolls.length = 0;
    for (const s of seats) s.show();
    assert.ok(t.scrolls.length >= 1 && t.scrolls.every(([x, y]) => x === 0 && y === 0), 'play starts at the top of the page');
    for (const s of seats) {
      assert.equal(listChips(s), 0, 'the list folds once when play starts');
      const bar = boxOf(s.root, 'sf-clock');
      assert.ok(shown(bar), 'the clock bar shows during play');
      assert.equal(findEls(bar, (n) => n.tag === 'button')[0].textContent, '🙋 指控');
    }
    // the 📍 toggle reopens the list, and a later update does not fold it again
    const s0 = seats[0];
    clickEl(findEls(s0.root, (n) => n.cls.has('sf-list-toggle'))[0]);
    s0.show();
    assert.ok(listChips(s0) > 0, 'the toggle reopens the list and it stays open');
    // the holder line: the first question, then "answer, then ask"
    const holderText = (s) => boxOf(s.root, 'sf-holder').textContent;
    const dealer = R(sim).dealer;
    for (const s of seats) assert.equal(holderText(s), s.pid === dealer ? '你問第一條問題' : `${nm(dealer)} 問第一條問題`);
    const asked = ids(sim).find((id) => id !== dealer);
    sim.act(dealer, { type: 'ask', target: asked });
    for (const s of seats) {
      s.show();
      assert.equal(holderText(s), s.pid === asked ? '你答完就問下一個' : `${nm(asked)} 答完就問下一個`);
    }
    // the bar's 🙋 opens the picker (the question card makes way for it)
    const accuser = ids(sim).find((id) => id !== dealer && id !== asked);
    const a = seats.find((s) => s.pid === accuser);
    clickEl(findEls(boxOf(a.root, 'sf-clock'), (n) => n.tag === 'button')[0]);
    assert.ok(shown(boxOf(a.root, 'sf-picker')), 'the accusation picker is open');
    assert.ok(!shown(boxOf(a.root, 'sf-floor')), 'the question card makes way for it');
    clickEl(btnText(a.root, '取消'));
    // after a failed accusation every phone marks the accuser, and only the accuser's bar button is spent
    const suspect = ids(sim).find((id) => id !== accuser);
    sim.act(accuser, { type: 'accuse', target: suspect });
    voteAll(sim, false);
    settle(sim);
    assert.equal(phase(sim), 'play');
    for (const s of seats) {
      s.show();
      const marked = findEls(boxOf(s.root, 'sf-floor'), (n) => n.cls.has('sf-acc')).map((n) => n.parentNode.textContent);
      assert.equal(marked.length, 1, 'exactly one seat carries 🙋✓');
      assert.ok(marked[0].includes(nm(accuser)));
      const b = findEls(boxOf(s.root, 'sf-clock'), (n) => n.tag === 'button')[0];
      assert.equal(isOff(b), s.pid === accuser, 'only the accuser’s 🙋 is spent');
      assert.equal(b.textContent, s.pid === accuser ? '🙋 用咗' : '🙋 指控');
    }
    assert.equal(listChips(seats[1]), 0, 'resuming play after a vote does not reopen the list');
    for (const s of seats) s.handle.destroy();
  }));
});

test('spyfall ui: 下一局 wakes up after a 2-second countdown that is shown on screen', async () => {
  await withSpyfallUi(async (ui) => withQueuedTimers(async (t) => {
    const sim = playing(5, { seed: 52, config: { rounds: 2 } });
    wrongGuess(sim);
    assert.equal(phase(sim), 'roundEnd');
    const log = { sent: [], sfx: [], toast: [] };
    const s = mountSpyfallSeat(ui, sim, nonSpies(sim)[0], log);
    const next = () => btnText(s.root, '下一局');
    assert.ok(s.root.textContent.includes('睇清楚先，2 秒後先㩒得'));
    assert.equal(isOff(next()), true);
    assert.ok(t.step());
    assert.ok(s.root.textContent.includes('睇清楚先，1 秒後先㩒得'));
    assert.equal(isOff(next()), true);
    assert.ok(t.step());
    assert.ok(!s.root.textContent.includes('秒後先㩒得'), 'the countdown line goes away');
    assert.equal(isOff(next()), false);
    assert.equal(t.pending(), 0, 'no timer left running');
    clickEl(next());
    assert.deepEqual(log.sent.pop()[1], { type: 'next-round' });
    s.handle.destroy();
  }));
});
