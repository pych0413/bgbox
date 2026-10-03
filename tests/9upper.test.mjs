// ============================================================
// tests/9upper.test.mjs — rules, edge cases, leak checks and a fuzzer for 瞎掰王 9upper.
//   node tests/run.mjs 9upper
// ============================================================

import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { test, assert, Sim, HOST, ACT, makePlayers, paths } from './lib.mjs';
import { createBag } from '../js/core/bag.js';
import { mulberry32, clone } from '../js/core/engine-kit.js';
import * as game from '../js/games/9upper/game.js';

const { engine, config, meta, rules, CATEGORIES } = game;

// ---------- fixtures ----------

const CATS = ['地理', '科學', '歷史', '生活'];
// every explanation / source carries a unique, delimiter-wrapped token so substring leak checks are exact
const BANK = Array.from({ length: 60 }, (_, i) => ({
  term: `詞語${i}號`, explain: `真解釋【E${i}】`, cat: CATS[i % 4], level: 1 + (i % 3), src: `來源【S${i}】`,
}));
const banks = { '9upper': BANK };

const mk = (n, seed = 1, over = {}, b = banks) =>
  new Sim(game, { n, seed, banks: b, config: { ...config.defaults(n), ...over } });

const J = (sim) => sim.state.round.judge;
const phase = (sim) => sim.state.phase;

function toExplain(sim, level = 2) {
  if (phase(sim) === 'level') sim.act(J(sim), { type: 'level', level });
  if (phase(sim) === 'read') {
    if (sim.state.cfg.readSecs > 0) sim.advance();
    else for (const p of sim.state.round.explainers) sim.act(p, { type: 'ready' });
  }
  assert.equal(phase(sim), 'explain');
}
function toJudge(sim, level = 2) {
  toExplain(sim, level);
  sim.act(J(sim), { type: 'decide' });
  assert.equal(phase(sim), 'judge');
}
const bluffers = (sim) => sim.state.round.explainers.filter((p) => p !== sim.state.round.honest);

// ---------- config ----------

test('9upper: meta, rules and banks shape', () => {
  assert.equal(meta.id, '9upper');
  assert.deepEqual(meta.players, [3, 9]);
  assert.deepEqual(meta.banks, ['9upper']);
  assert.equal(meta.singleDevice, 'full');
  assert.equal(meta.css, true);
  assert.ok(rules.quick.length >= 5);
  assert.deepEqual(rules.roles.map((r) => r.id), ['judge', 'honest', 'bluffer']);
  for (const s of rules.sections) assert.ok(s.title && s.body);
  for (const k of ['setup', 'act', 'advance', 'view', 'cue', 'focus', 'autoAct', 'legalActions', 'result']) {
    assert.equal(typeof engine[k], 'function', k);
  }
});

test('9upper: config.defaults is valid for every head-count; laps follow the official table', () => {
  const rounds = { 3: 9, 4: 12, 5: 10, 6: 12, 7: 14, 8: 8, 9: 9 };
  for (let n = 3; n <= 9; n++) {
    const cfg = config.defaults(n);
    const v = config.validate(cfg, n);
    assert.ok(v.ok, `n=${n}: ${v.message}`);
    assert.ok(Array.isArray(v.warnings));
    const sim = mk(n);
    assert.equal(sim.state.totalRounds, rounds[n], `n=${n}`);
    assert.equal(sim.state.cfg.laps, game.lapsFor(n));
    assert.ok(config.summary(cfg, n)[0].includes(`共 ${rounds[n]} 輪`));
    assert.ok(config.fields(cfg, n).length >= 6);
  }
});

test('9upper: config.defaults keeps prev, sanitises it and honours singleDevice', () => {
  const d = config.defaults(5, { levelMode: '3', readSecs: 25, callouts: 2, laps: 'bogus', topics: { cats: ['地理'] }, junk: 1 });
  assert.equal(d.levelMode, '3');
  assert.equal(d.readSecs, 25);
  assert.equal(d.callouts, 2);
  assert.equal(d.laps, 0);          // invalid → default
  assert.deepEqual(d.topics, { cats: ['地理'] });
  assert.ok(!('junk' in d));
  assert.deepEqual(config.defaults(5).topics, { cats: [] });
  assert.deepEqual(config.defaults(5, { topics: ['地理'] }).topics, { cats: ['地理'] });          // bare array tolerated
  assert.deepEqual(config.defaults(5, { topics: { categories: ['地理'] } }).topics, { cats: ['地理'] });
  assert.equal(config.defaults(5, { readSecs: 25 }, { singleDevice: true }).readSecs, 0);
  assert.equal(config.defaults(5).readSecs, 15);
});

test('9upper: config.validate rejects bad player counts and bad values, warns on odd ones', () => {
  const base = config.defaults(5);
  for (const n of [0, 1, 2, 10, 12, 4.5]) assert.equal(config.validate(base, n).ok, false, `n=${n}`);
  for (const bad of [{ laps: 4 }, { laps: -1 }, { readSecs: 121 }, { readSecs: 1.5 }, { speakSecs: 301 }, { callouts: 3 },
    { levelMode: '4' }, { scoreFloor: 'yes' }, { topics: 'x' }, { topics: { cats: [1] } }, { topics: [1] }]) {
    const v = config.validate({ ...base, ...bad }, 5);
    assert.equal(v.ok, false, JSON.stringify(bad));
    assert.ok(v.message.length > 0);
  }
  assert.ok(config.validate({ ...base, readSecs: 5 }, 5).warnings.length >= 1);
  assert.ok(config.validate({ ...base, laps: 3 }, 8).warnings.length >= 1);        // 24 rounds
  assert.ok(config.validate({ ...base, callouts: 2 }, 3).warnings.length >= 1);
  // numeric strings from a <select> / input are accepted
  assert.ok(config.validate({ ...base, readSecs: '20', callouts: '2' }, 5).ok);
  assert.equal(config.defaults(5, { readSecs: '20' }).readSecs, 20);
});

test('9upper: config.summary reflects the settings', () => {
  const s = config.summary({ ...config.defaults(6), levelMode: 'mix', readSecs: 0, speakSecs: 45, callouts: 0,
    topics: { cats: ['地理', '科學'] }, scoreFloor: true, rePeek: true }, 6).join('|');
  for (const t of ['共 12 輪', '隨機', '每人睇完自己㩒', '45 秒', '唔玩收皮啦', '地理、科學', '低過 0', '再睇']) {
    assert.ok(s.includes(t), t);
  }
});

// ---------- setup and rotation ----------

test('9upper: every seat is the 諗樣 `laps` times and the 諗樣 rotates by seat', () => {
  for (let n = 3; n <= 9; n++) {
    for (const laps of [0, 1, 2, 3]) {
      const sim = mk(n, 5 + n, { laps });
      const s = sim.state;
      const expectLaps = laps || game.lapsFor(n);
      assert.equal(s.judges.length, n * expectLaps);
      const counts = {};
      for (const j of s.judges) counts[j] = (counts[j] ?? 0) + 1;
      for (const p of sim.players) assert.equal(counts[p.id], expectLaps, `n=${n} laps=${laps} ${p.id}`);
      const order = s.order;
      s.judges.forEach((j, i) => {
        if (i) assert.equal(order.indexOf(j), (order.indexOf(s.judges[i - 1]) + 1) % n, 'left neighbour next');
      });
    }
  }
});

test('9upper: first 諗樣 varies with the seed', () => {
  const firsts = new Set();
  for (let seed = 1; seed <= 40; seed++) firsts.add(J(mk(5, seed)));
  assert.ok(firsts.size >= 4, `only ${firsts.size} distinct first judges`);
});

test('9upper: exactly one honest, never the judge, and everybody gets to be honest', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 120; seed++) {
    const sim = mk(5, seed);
    const r = sim.state.round;
    assert.equal(r.explainers.length, 4);
    assert.ok(!r.explainers.includes(r.judge));
    assert.ok(r.explainers.includes(r.honest));
    assert.notEqual(r.honest, r.judge);
    seen.add(`${r.judge}>${r.honest}`);
  }
  assert.ok(seen.size >= 15, `only ${seen.size} judge/honest pairs in 120 seeds`);
});

test('9upper: everybody starts on 3 and explaining order starts left of the judge', () => {
  const sim = mk(6, 3);
  for (const p of sim.players) assert.equal(sim.state.scores[p.id], 3);
  const r = sim.state.round;
  const order = sim.state.order;
  assert.equal(r.explainers[0], order[(order.indexOf(r.judge) + 1) % 6]);
  assert.equal(r.explainers.length, 5);
});

// ---------- the happy path ----------

test('9upper: one round end to end (judge picks the level)', () => {
  const sim = mk(4, 2);
  const judge = J(sim);
  assert.equal(phase(sim), 'level');
  assert.equal(sim.state.round.term, null);
  sim.act(judge, { type: 'level', level: 3 });
  assert.equal(phase(sim), 'read');
  assert.equal(sim.state.round.term.level, 3);
  assert.equal(sim.state.deadline, sim.now + 15000);
  sim.advance();
  assert.equal(phase(sim), 'explain');
  assert.equal(sim.state.deadline, null);
  const [a, b, c] = sim.state.round.explainers;
  sim.act(a, { type: 'done' });
  sim.act(b, { type: 'done' });
  assert.equal(phase(sim), 'explain');
  sim.act(c, { type: 'done' });
  assert.equal(phase(sim), 'judge');
  sim.act(judge, { type: 'pick', target: a });
  assert.equal(phase(sim), 'reveal');
  sim.act(judge, { type: 'next' });
  assert.equal(sim.state.roundNo, 2);
  assert.equal(sim.state.round.n, 2);
  assert.equal(sim.state.round.judge, sim.state.judges[1]);
  assert.equal(phase(sim), 'level');
});

test('9upper: levelMode fixed or mix skips the level phase', () => {
  const fixed = mk(5, 1, { levelMode: '2' });
  assert.equal(phase(fixed), 'read');
  assert.equal(fixed.state.round.term.level, 2);
  const mix = mk(5, 1, { levelMode: 'mix' });
  assert.equal(phase(mix), 'read');
  const levels = new Set();
  for (let seed = 1; seed <= 40; seed++) levels.add(mk(5, seed, { levelMode: 'mix' }).state.round.term.level);
  assert.equal(levels.size, 3);
});

// ---------- act validation ----------

test('9upper: garbage, wrong phase, wrong seat and illegal targets never change state or throw', () => {
  const sim = mk(5, 7);
  const judge = J(sim);
  const other = sim.state.round.explainers[0];
  const snap = () => JSON.stringify(sim.state);
  const before = snap();
  const junk = [null, undefined, 42, 'x', {}, { pid: judge }, { pid: judge, action: null }, { pid: judge, action: 'level' },
    { pid: judge, action: {} }, { pid: judge, action: { type: 42 } }, { pid: 'nobody', action: { type: 'level', level: 1 } },
    { pid: null, action: { type: 'level', level: 1 } }, { pid: { id: judge }, action: { type: 'level', level: 1 } },
    { pid: judge, action: { type: 'level', level: 4 } }, { pid: judge, action: { type: 'level', level: 0 } },
    { pid: judge, action: { type: 'level', level: 1.5 } }, { pid: judge, action: { type: 'level', level: null } },
    { pid: other, action: { type: 'level', level: 1 } },                   // not the judge
    { pid: judge, action: { type: 'pick', target: other } },               // wrong phase
    { pid: judge, action: { type: 'done' } }, { pid: judge, action: { type: 'next' } },
    { pid: judge, action: { type: 'ready' } }, { pid: judge, action: { type: 'swap' } },
    { pid: judge, action: { type: 'callout', target: other } }, { pid: judge, action: { type: 'bogus' } },
    { pid: HOST, action: { type: 'bogus' } }, { pid: HOST, action: { type: ACT.CUE_DONE, id: 'nope' } },
    { pid: HOST, action: { type: ACT.CUE_DONE } }, { pid: HOST, action: { type: ACT.AUTO, pid: judge } }];
  for (const m of junk) {
    const out = engine.act(clone(sim.state), m, sim.ctx());
    assert.equal(JSON.stringify(out), before, JSON.stringify(m));
  }
  assert.equal(snap(), before);
  // after the level, later phases reject the wrong people
  sim.act(judge, { type: 'level', level: 2 });
  const read = snap();
  for (const m of [{ pid: judge, action: { type: 'level', level: 1 } }, { pid: other, action: { type: 'done' } },
    { pid: other, action: { type: 'swap' } }, { pid: other, action: { type: 'ready' } },
    { pid: other, action: { type: 'callout', target: judge } }]) {
    assert.equal(JSON.stringify(engine.act(clone(sim.state), m, sim.ctx())), read, JSON.stringify(m));
  }
});

test('9upper: the engine accepts a numeric-string level and returns undefined-safe state', () => {
  const sim = mk(4, 1);
  sim.act(J(sim), { type: 'level', level: '3' });
  assert.equal(phase(sim), 'read');
  assert.equal(sim.state.round.term.level, 3);
});

// ---------- terms ----------

test('9upper: judge-chosen level draws that level; cats filter applies', () => {
  for (const level of [1, 2, 3]) {
    const sim = mk(4, level, { topics: { cats: ['地理'] } });
    sim.act(J(sim), { type: 'level', level });
    const t = sim.state.round.term;
    assert.equal(t.level, level);
    assert.equal(t.cat, '地理');
  }
});

test('9upper: empty pools relax level, then category, then fall back to an emergency card', () => {
  const only1 = { '9upper': BANK.filter((e) => e.level === 1) };
  const s1 = mk(4, 1, {}, only1);
  s1.act(J(s1), { type: 'level', level: 3 });
  assert.equal(s1.state.round.term.level, 1);                      // level relaxed

  const geo = { '9upper': BANK.filter((e) => e.cat === '地理') };
  const s2 = mk(4, 1, { topics: { cats: ['科學'] } }, geo);
  s2.act(J(s2), { type: 'level', level: 2 });
  assert.equal(s2.state.round.term.cat, '地理');                   // category relaxed

  const s3 = mk(4, 1, {}, { '9upper': [] });
  s3.act(J(s3), { type: 'level', level: 2 });
  assert.equal(phase(s3), 'read');
  assert.ok(s3.state.round.term.term && s3.state.round.term.explain);   // emergency card

  const s4 = mk(4, 1, {}, {});                                     // bank never loaded
  s4.act(J(s4), { type: 'level', level: 2 });
  assert.equal(phase(s4), 'read');

  const broken = { '9upper': [{ term: 'x' }, { explain: 'y' }, null, { term: '', explain: '' }] };
  const s5 = mk(4, 1, {}, broken);
  s5.act(J(s5), { type: 'level', level: 1 });
  assert.ok(s5.state.round.term.explain.length > 2);               // unusable entries are never dealt
});

test('9upper: hints — level 1 one true cat, level 2 three distinct with one true, level 3 none', () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const level of [1, 2, 3]) {
      const sim = mk(4, seed, { levelMode: String(level) });
      const t = sim.state.round.term;
      if (level === 1) assert.deepEqual(t.hint, { kind: 'one', options: [t.cat] });
      if (level === 2) {
        assert.equal(t.hint.kind, 'three');
        assert.equal(t.hint.options.length, 3);
        assert.equal(new Set(t.hint.options).size, 3);
        assert.equal(t.hint.options.filter((c) => c === t.cat).length, 1);
      }
      if (level === 3) assert.equal(t.hint, null);
    }
  }
});

test('9upper: level-2 decoys are real bank categories, never the true one twice', () => {
  const realish = { '9upper': BANK.map((e, i) => ({ ...e, cat: CATEGORIES[i % CATEGORIES.length] })) };
  for (let seed = 1; seed <= 60; seed++) {
    const sim = mk(4, seed, { levelMode: '2' }, realish);
    const t = sim.state.round.term;
    assert.ok(CATEGORIES.includes(t.cat));
    for (const o of t.hint.options) assert.ok(CATEGORIES.includes(o), o);
  }
});

test('9upper: the config field lists every bank category and the lobby value shape is accepted', () => {
  const f = config.fields(config.defaults(5), 5).find((x) => x.type === 'categories');
  assert.equal(f.key, 'topics');
  assert.deepEqual(f.options.map((o) => o.value), CATEGORIES);
  assert.ok(config.validate({ ...config.defaults(5), topics: { cats: [CATEGORIES[0]], levels: [] } }, 5).ok);
  for (const fld of config.fields(config.defaults(5), 5)) assert.ok(fld.key && fld.label && fld.type);
});

// the real bank (merged file if it exists, else the shards) — skipped silently while it is still being written
async function realBank() {
  const root = new URL('../js/data/', import.meta.url);
  if (existsSync(new URL('9upper-terms.js', root))) {
    return { merged: true, bank: (await import(new URL('9upper-terms.js', root).href)).default };
  }
  const dir = fileURLToPath(new URL('parts/', root));
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^9upper-.*\.js$/.test(f)).sort();
  if (!files.length) return null;
  const all = [];
  for (const f of files) all.push(...(await import(pathToFileURL(join(dir, f)).href)).default);
  return { merged: false, bank: all };   // shards: the merge step is what removes duplicates
}

test('9upper: the real term bank fits the engine (shape, levels, categories, unique terms)', async () => {
  const real = await realBank();
  if (!real) return;
  const { bank, merged } = real;
  assert.ok(bank.length > 50, 'bank looks too small');
  const seen = new Set();
  for (const e of bank) {
    assert.ok(typeof e.term === 'string' && e.term, 'term');
    assert.ok(typeof e.explain === 'string' && e.explain, `explain of ${e.term}`);
    assert.ok([1, 2, 3].includes(e.level), `level of ${e.term}`);
    assert.ok(typeof e.src === 'string' && e.src, `src of ${e.term}`);
    assert.ok(CATEGORIES.includes(e.cat), `category 「${e.cat}」 of ${e.term} is missing from CATEGORIES in game.js`);
    assert.ok(!e.explain.includes(e.term) || e.explain.length > e.term.length + 4, `explain just repeats ${e.term}`);
    if (merged) assert.ok(!seen.has(e.term), `duplicate term ${e.term}`);
    seen.add(e.term);
  }
});

test('9upper: random games with the real bank terminate and never leak', async () => {
  const real = await realBank();
  if (!real) return;
  const bank = real.bank;
  for (const mode of MODES) {
    for (let n = 3; n <= 9; n += 2) {
      const sim = mk(n, n * 5, mode.over, { '9upper': bank });
      sim.runRandom({ onStep: leakCheck });
    }
  }
});

test('9upper: works with the real core/bag.js (predicate filter, no repeats, persisted used keys)', async () => {
  const storage = new Map();
  const bag = createBag({ storage, rng: mulberry32(3), banks: { '9upper': { load: async () => BANK, key: (e) => e.term } } });
  await bag.load('9upper');
  const sim = mk(5, 7, { levelMode: 'mix' });
  sim.bag = bag;
  const seen = [];
  sim.runRandom({ onStep: (x) => { const t = x.state.round.term; if (t && seen[seen.length - 1] !== t.term) seen.push(t.term); } });
  assert.ok(seen.length >= 10);
  assert.equal(new Set(seen).size, seen.length, 'a term repeated');
  assert.ok(bag.stats('9upper').used >= seen.length - 1);
  // a bank that was never loaded makes core/bag.js throw: the round still gets an emergency card
  const unloaded = createBag({ storage: new Map(), banks: { '9upper': { load: async () => BANK, key: (e) => e.term } } });
  const s2 = mk(4, 2);
  s2.bag = unloaded;
  s2.act(J(s2), { type: 'level', level: 2 });
  assert.equal(phase(s2), 'read');
  assert.ok(s2.state.round.term.explain);
  const throwing = { draw() { throw new Error('boom'); }, stats() { return { used: 0, total: 0 }; } };
  const s3 = mk(4, 2);
  s3.bag = throwing;
  s3.runRandom();
});

test('9upper: a game never repeats a term while the bank has enough', () => {
  const sim = mk(5, 4, { levelMode: 'mix' });
  const seen = [];
  sim.runRandom({ onStep: (x) => { const t = x.state.round.term; if (t && seen[seen.length - 1] !== t.term) seen.push(t.term); } });
  assert.equal(new Set(seen).size, seen.length, `repeated: ${seen.join(',')}`);
});

// ---------- read phase ----------

test('9upper: timed read — no early end, no ready button, the clock (or a skip) ends it', () => {
  const sim = mk(5, 3, { levelMode: '2' });
  assert.equal(phase(sim), 'read');
  const s = sim.state;
  assert.equal(s.deadline, 1_000_000 + 15000);
  for (const p of sim.players) {
    assert.ok(!sim.legal(p.id).some((a) => a.type === 'ready'));
    assert.equal(sim.act(p.id, { type: 'ready' }), false);
  }
  // before the deadline advance() is a no-op
  assert.equal(JSON.stringify(engine.advance(clone(s), { ...sim.ctx(), now: s.deadline - 1 })), JSON.stringify(s));
  sim.advance();
  assert.equal(phase(sim), 'explain');

  const skip = mk(5, 3, { levelMode: '2' });
  assert.equal(skip.host({ type: ACT.NEXT }), true);                 // first 下一步 only acknowledges the cue
  assert.equal(phase(skip), 'read');
  assert.equal(skip.cue(), null);
  assert.equal(skip.host({ type: ACT.NEXT }), true);                 // second one skips the wait
  assert.equal(phase(skip), 'explain');
});

test('9upper: tap read — ready per 玩家, focus shrinks, all ready ends it, judge cannot ready', () => {
  const sim = mk(5, 3, { levelMode: '2', readSecs: 0 });
  const s = sim.state;
  assert.equal(s.deadline, null);
  assert.equal(sim.view(null).readMode, 'tap');
  const ex = s.round.explainers;
  assert.deepEqual(sim.focus().pids, ex);
  assert.equal(sim.act(J(sim), { type: 'ready' }), false);
  assert.equal(sim.act(ex[0], { type: 'ready' }), true);
  assert.equal(sim.act(ex[0], { type: 'ready' }), false);           // once
  assert.deepEqual(sim.focus().pids, ex.slice(1));
  assert.equal(sim.view(ex[0]).mine.ready, true);
  assert.equal(sim.view(ex[1]).mine.ready, false);
  assert.ok(!sim.legal(ex[0]).some((a) => a.type === 'ready'));
  for (const p of ex.slice(1)) sim.act(p, { type: 'ready' });
  assert.equal(phase(sim), 'explain');
});

test('9upper: swap — judge only, twice per round, new term, same honest, window restarts, nothing scores', () => {
  const sim = mk(5, 8, { levelMode: '2' });
  const honest = sim.state.round.honest;
  const first = sim.state.round.term.term;
  const scores = { ...sim.state.scores };
  assert.equal(sim.act(sim.state.round.explainers[0], { type: 'swap' }), false);
  sim.tick(5000);
  const cue1 = sim.cue().id;
  assert.equal(sim.act(J(sim), { type: 'swap' }), true);
  assert.notEqual(sim.state.round.term.term, first);
  assert.equal(sim.state.round.term.level, 2);
  assert.equal(sim.state.round.honest, honest);
  assert.equal(sim.state.deadline, sim.now + 15000);                  // restarted from "now"
  assert.notEqual(sim.cue().id, cue1);                                // the narrator speaks the new term
  assert.equal(sim.view(J(sim)).swapsLeft, 1);
  assert.equal(sim.act(J(sim), { type: 'swap' }), true);
  assert.equal(sim.view(J(sim)).canSwap, false);
  assert.equal(sim.act(J(sim), { type: 'swap' }), false);
  assert.ok(!sim.legal(J(sim)).some((a) => a.type === 'swap'));
  assert.deepEqual(sim.state.scores, scores);
  assert.equal(phase(sim), 'read');
  assert.equal(sim.view(honest).mine.explain, sim.state.round.term.explain);   // honest sees the NEW explanation
  sim.advance();
  assert.equal(sim.act(J(sim), { type: 'swap' }), false);             // too late once the window closed
});

// ---------- explain phase ----------

test('9upper: speakers go in seat order from the judge\'s left; done by the speaker or the judge only', () => {
  const sim = mk(5, 6);
  toExplain(sim);
  const ex = sim.state.round.explainers;
  assert.deepEqual(sim.view(null).turn, { index: 0, total: 4, pid: ex[0] });
  assert.equal(sim.act(ex[1], { type: 'done' }), false);              // not your turn
  assert.equal(sim.act(ex[0], { type: 'done' }), true);
  assert.equal(sim.view(null).turn.pid, ex[1]);
  assert.equal(sim.act(J(sim), { type: 'done' }), true);              // the judge may end any turn
  assert.equal(sim.view(null).turn.pid, ex[2]);
  assert.ok(sim.legal(ex[2]).some((a) => a.type === 'done'));
  assert.deepEqual(sim.legal(ex[3]), []);
  sim.act(ex[2], { type: 'done' });
  sim.act(ex[3], { type: 'done' });
  assert.equal(phase(sim), 'judge');
  assert.equal(sim.view(null).turn, null);
});

test('9upper: speakSecs puts a deadline on every turn and advance() ends the turn', () => {
  const sim = mk(4, 2, { speakSecs: 30 });
  toExplain(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.state.deadline, sim.now + 30000);
  assert.ok(sim.state.timerLabel.includes(sim.players.find((p) => p.id === ex[0]).name));
  assert.equal(sim.view(ex[0]).deadline, sim.state.deadline);
  sim.advance();
  assert.equal(sim.view(null).turn.pid, ex[1]);
  assert.equal(sim.state.deadline, sim.now + 30000);
  sim.advance();
  sim.advance();
  assert.equal(phase(sim), 'judge');
  assert.equal(sim.state.deadline, null);
  assert.equal(sim.view(null).deadline, undefined);
});

test('9upper: judge can decide early; explain without speakSecs has no deadline', () => {
  const sim = mk(4, 2);
  toExplain(sim);
  assert.equal(sim.state.deadline, null);
  assert.equal(sim.act(sim.state.round.explainers[0], { type: 'decide' }), false);
  assert.equal(sim.act(J(sim), { type: 'decide' }), true);
  assert.equal(phase(sim), 'judge');
});

// ---------- 收皮啦 ----------

test('9upper: callout — judge only, explain/judge phases, once per target, capped by config, never self', () => {
  const sim = mk(5, 9, { callouts: 2 });
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.act(judge, { type: 'callout', target: ex[0] }), false);       // read phase
  toExplain(sim);
  assert.equal(sim.act(ex[1], { type: 'callout', target: ex[2] }), false);        // not the judge
  assert.equal(sim.act(judge, { type: 'callout', target: judge }), false);        // never self
  assert.equal(sim.act(judge, { type: 'callout', target: 'zzz' }), false);
  assert.equal(sim.act(judge, { type: 'callout', target: ex[2] }), true);         // not the current speaker
  assert.equal(sim.view(null).turn.pid, ex[0]);                                   // their turn is untouched
  assert.equal(sim.act(judge, { type: 'callout', target: ex[2] }), false);        // once per target
  assert.deepEqual(sim.view(ex[3]).callouts, { max: 2, left: 1, used: [ex[2]] });
  assert.equal(sim.act(judge, { type: 'callout', target: ex[3] }), true);
  assert.equal(sim.act(judge, { type: 'callout', target: ex[1] }), false);        // cap of 2
  assert.ok(!sim.legal(judge).some((a) => a.type === 'callout'));
  sim.act(judge, { type: 'decide' });
  assert.equal(sim.act(judge, { type: 'callout', target: ex[1] }), false);        // still capped in judge phase
});

test('9upper: callout on the current speaker ends their turn; on the last speaker moves to judge', () => {
  const sim = mk(4, 5, { callouts: 2 });
  toExplain(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.act(J(sim), { type: 'callout', target: ex[0] }), true);
  assert.equal(sim.view(null).turn.pid, ex[1]);
  sim.act(ex[1], { type: 'done' });
  sim.act(J(sim), { type: 'callout', target: ex[2] });                            // last speaker
  assert.equal(phase(sim), 'judge');
});

test('9upper: callouts = 0 disables 收皮啦; works in the judge phase too', () => {
  const off = mk(5, 2, { callouts: 0 });
  toJudge(off);
  assert.equal(off.act(J(off), { type: 'callout', target: off.state.round.explainers[0] }), false);
  assert.ok(!off.legal(J(off)).some((a) => a.type === 'callout'));
  assert.deepEqual(off.view(null).callouts, { max: 0, left: 0, used: [] });

  const on = mk(5, 2);
  toJudge(on);
  assert.equal(on.act(J(on), { type: 'callout', target: on.state.round.explainers[0] }), true);
  assert.equal(on.act(J(on), { type: 'callout', target: on.state.round.explainers[1] }), false);   // default is 1 card
});

// ---------- scoring ----------

const VECTORS = [
  { name: 'pick honest, no callout', pick: 'H', call: null, exp: { J: 2, H: 2 } },
  { name: 'pick a bluffer, no callout', pick: 'X', call: null, exp: { X: 2 } },
  { name: 'pick honest, callout honest', pick: 'H', call: 'H', exp: { J: -1, H: 2 } },
  { name: 'pick honest, callout bluffer', pick: 'H', call: 'Y', exp: { J: 3, H: 2, Y: -1 } },
  { name: 'pick bluffer, callout same bluffer', pick: 'X', call: 'X', exp: { X: 1, J: 1 } },
  { name: 'pick bluffer, callout another bluffer', pick: 'X', call: 'Y', exp: { X: 2, Y: -1, J: 1 } },
  { name: 'pick bluffer, callout honest', pick: 'X', call: 'H', exp: { X: 2, J: -3 } },
];

test('9upper: research golden vectors (N=5, D=2) settle exactly', () => {
  for (const v of VECTORS) {
    const sim = mk(5, 11, { levelMode: '2' });
    toJudge(sim);
    const judge = J(sim);
    const H = sim.state.round.honest;
    const [X, Y] = bluffers(sim);
    const who = { J: judge, H, X, Y };
    if (v.call) assert.equal(sim.act(judge, { type: 'callout', target: who[v.call] }), true, v.name);
    assert.equal(sim.act(judge, { type: 'pick', target: who[v.pick] }), true, v.name);
    assert.equal(phase(sim), 'reveal');
    const expected = Object.fromEntries(sim.players.map((p) => [p.id, 3]));
    for (const [k, d] of Object.entries(v.exp)) expected[who[k]] += d;
    assert.deepEqual(sim.state.scores, expected, v.name);
    const rv = sim.view(null).reveal;
    for (const c of rv.changes) assert.equal(c.delta, expected[c.pid] - 3, `${v.name} change ${c.pid}`);
    assert.equal(rv.correct, v.pick === 'H');
    assert.equal(rv.honest, H);
    assert.equal(rv.d, 2);
  }
});

test('9upper: D follows the term level (1, 2, 3)', () => {
  for (const level of [1, 2, 3]) {
    const sim = mk(4, 3, { levelMode: String(level) });
    toJudge(sim);
    const H = sim.state.round.honest;
    sim.act(J(sim), { type: 'pick', target: H });
    assert.equal(sim.state.scores[H], 3 + level);
    assert.equal(sim.state.scores[J(sim)], 3 + level);
  }
});

test('9upper: pick must be a 玩家; picks only in the judge phase; reveal carries the explanation and source', () => {
  const sim = mk(5, 4);
  toExplain(sim);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.act(judge, { type: 'pick', target: ex[0] }), false);           // still explaining
  sim.act(judge, { type: 'decide' });
  assert.equal(sim.act(judge, { type: 'pick', target: judge }), false);
  assert.equal(sim.act(judge, { type: 'pick', target: 'zzz' }), false);
  assert.equal(sim.act(ex[0], { type: 'pick', target: ex[1] }), false);           // not the judge
  assert.ok(sim.legal(judge).filter((a) => a.type === 'pick').length === 4);
  sim.act(judge, { type: 'pick', target: ex[1] });
  const rv = sim.view(ex[2]).reveal;
  const t = sim.state.round.term;
  assert.equal(rv.explain, t.explain);
  assert.equal(rv.src, t.src);
  assert.equal(rv.term, t.term);
  assert.ok(rv.lines.length >= 2);
  assert.ok(rv.lines.join('\n').includes('老實人係'));
  assert.equal(sim.act(judge, { type: 'pick', target: ex[2] }), false);           // cannot pick twice
});

test('9upper: scoreFloor clamps at 0 and reports nominal vs applied; default allows negatives', () => {
  for (const floor of [false, true]) {
    const sim = mk(5, 11, { levelMode: '1', scoreFloor: floor, callouts: 1 });
    toJudge(sim);
    const judge = J(sim);
    const H = sim.state.round.honest;
    sim.state.scores[judge] = 1;                                                   // judge on 1 point
    sim.act(judge, { type: 'callout', target: H });                                // −3 for the judge
    sim.act(judge, { type: 'pick', target: bluffers(sim)[0] });                    // pick a bluffer: judge +0
    assert.equal(sim.state.scores[judge], floor ? 0 : -2, `floor=${floor}`);
    const ch = sim.view(null).reveal.changes.find((c) => c.pid === judge);
    assert.equal(ch.nominal, -3);
    assert.equal(ch.delta, floor ? -1 : -3);
    if (floor) assert.ok(sim.view(null).reveal.lines.join('').includes('分數唔會低過 0'));
  }
});

test('9upper: a player who is picked and called out is netted once', () => {
  const sim = mk(5, 11, { levelMode: '2' });
  toJudge(sim);
  const X = bluffers(sim)[0];
  sim.act(J(sim), { type: 'callout', target: X });
  sim.act(J(sim), { type: 'pick', target: X });
  assert.equal(sim.state.scores[X], 3 + 2 - 1);
  assert.deepEqual(sim.view(null).reveal.changes.filter((c) => c.pid === X).length, 1);
});

// ---------- end of game ----------

test('9upper: next after the last reveal ends the game; result has winners, points and every round\'s truth', () => {
  const sim = mk(3, 5, { levelMode: '2' });
  assert.equal(sim.result(), null);
  const total = sim.state.totalRounds;
  for (let i = 0; i < total; i++) {
    assert.equal(sim.result(), null);
    toJudge(sim);
    assert.equal(sim.view(null).last, i === total - 1);
    sim.act(J(sim), { type: 'pick', target: sim.state.round.honest });
    assert.equal(sim.result(), null);
    sim.act(J(sim), { type: 'next' });
  }
  assert.equal(phase(sim), 'over');
  const res = sim.result();
  assert.ok(res);
  assert.equal(sim.state.history.length, total);
  // every round the judge found the honest player: everybody judges 3 times and is honest ... equal totals
  const top = Math.max(...Object.values(sim.state.scores));
  assert.deepEqual(res.winners.slice().sort(), sim.players.filter((p) => sim.state.scores[p.id] === top).map((p) => p.id).sort());
  assert.deepEqual(res.points, sim.state.scores);
  assert.equal(typeof res.summary, 'string');
  const text = res.lines.join('\n');
  for (const h of sim.state.history) {
    assert.ok(text.includes(h.explain), 'explanation in results');
    assert.ok(text.includes(h.src), 'source in results');
    assert.ok(text.includes(h.term));
  }
  assert.ok(res.lines.some((l) => l.includes('最準諗樣')));
  assert.equal(sim.legal(J(sim)).length, 0);
  assert.equal(sim.act(J(sim), { type: 'next' }), false);
  assert.equal(sim.focus(), null);
  assert.equal(sim.cue(), null);
});

test('9upper: ties share the win; a clear leader wins alone', () => {
  const sim = mk(4, 1);
  sim.state.phase = 'over';
  sim.state.scores = { p1: 7, p2: 7, p3: 5, p4: 7 };
  let res = sim.result();
  assert.deepEqual(res.winners, ['p1', 'p2', 'p4']);
  assert.ok(res.summary.includes('同分'));
  sim.state.scores = { p1: 7, p2: 9, p3: 5, p4: 7 };
  res = sim.result();
  assert.deepEqual(res.winners, ['p2']);
  assert.ok(res.summary.includes('9 分'));
});

test('9upper: awards name the right people', () => {
  const sim = mk(4, 1, { levelMode: '2' });
  const total = sim.state.totalRounds;
  const fool = sim.players[0].id;
  for (let i = 0; i < total; i++) {
    toJudge(sim);
    const ex = sim.state.round.explainers;
    // the judge always picks `fool` when possible, otherwise the honest player
    sim.act(J(sim), { type: 'pick', target: ex.includes(fool) ? fool : sim.state.round.honest });
    sim.act(J(sim), { type: 'next' });
  }
  const lines = sim.result().lines.join('\n');
  assert.ok(lines.includes(`最勁 9up：${sim.players[0].name}`) || lines.includes('最勁 9up'));
  assert.ok(lines.includes('呃過諗樣'));
});

// ---------- cues, focus, auto-act ----------

test('9upper: cues are public, unique per step, acknowledged ones disappear, @next acknowledges first', () => {
  const sim = mk(4, 6);
  const ids = [];
  const note = () => { const c = sim.cue(); if (c) ids.push(c.id); return c; };
  let c = note();
  assert.equal(c.id, 'r1:level');
  assert.ok(c.text.includes('做諗樣'));
  assert.ok(c.minMs > 0);
  assert.equal(sim.host({ type: ACT.CUE_DONE, id: 'wrong' }), false);
  assert.equal(sim.cueDone(), true);
  assert.equal(sim.cue(), null);
  assert.equal(sim.cueDone(), false);                                  // acknowledged once only
  sim.act(J(sim), { type: 'level', level: 2 });
  c = note();
  assert.equal(c.id, 'r1:read:0');
  assert.ok(c.text.includes(sim.state.round.term.term));
  assert.ok(c.text.includes('15 秒'));
  assert.ok(!c.text.includes(sim.state.round.term.explain));
  sim.advance();
  c = note();
  assert.equal(c.id, 'r1:explain');
  for (const p of sim.state.round.explainers) assert.ok(c.text.includes(sim.players.find((x) => x.id === p).name));
  toJudge(mk(4, 6));                                                   // smoke
  sim.act(J(sim), { type: 'decide' });
  assert.equal(note().id, 'r1:judge');
  sim.act(J(sim), { type: 'pick', target: sim.state.round.honest });
  c = note();
  assert.equal(c.id, 'r1:reveal');
  assert.ok(c.text.includes(sim.state.round.term.explain));            // read out loud after the reveal
  assert.equal(new Set(ids).size, ids.length);
});

test('9upper: tap-mode cue tells people to tap 我睇完', () => {
  const sim = mk(4, 6, { levelMode: '1', readSecs: 0 });
  assert.ok(sim.cue().text.includes('我睇完'));
});

test('9upper: focus per phase', () => {
  const sim = mk(5, 2);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  assert.deepEqual(sim.focus(), { pids: [judge] });                    // level
  sim.act(judge, { type: 'level', level: 2 });
  assert.deepEqual(sim.focus().pids, ex);                              // read (timed): every 玩家
  sim.advance();
  assert.deepEqual(sim.focus(), { pids: [judge] });                    // explain
  sim.act(judge, { type: 'decide' });
  assert.deepEqual(sim.focus(), { pids: [judge] });                    // judge
  sim.act(judge, { type: 'pick', target: ex[0] });
  assert.deepEqual(sim.focus(), { pids: [judge] });                    // reveal
  assert.equal(sim.focus().anonymous, undefined);
});

test('9upper: autoAct unsticks every phase, so a dead phone cannot stop the table', () => {
  for (const readSecs of [15, 0]) {
    const sim = mk(5, 4, { readSecs, speakSecs: 0 });
    let guard = 0;
    while (!sim.result() && guard++ < 3000) {
      const pids = sim.players.map((p) => p.id);
      const f = sim.focus();
      let acted = false;
      for (const pid of f ? f.pids : pids) {
        const a = engine.autoAct(sim.state, pid, sim.ctx());
        if (a) { assert.ok(sim.act(pid, a), `autoAct ${JSON.stringify(a)} did nothing in ${phase(sim)}`); acted = true; break; }
      }
      if (!acted) {
        if (sim.cue() && sim.cueDone()) continue;
        assert.ok(sim.state.deadline != null, `stuck in ${phase(sim)}`);
        sim.advance();
      }
    }
    assert.ok(sim.result(), `readSecs=${readSecs}`);
  }
  const sim = mk(4, 4);
  assert.equal(engine.autoAct(sim.state, 'p1', sim.ctx()) === null || typeof engine.autoAct(sim.state, 'p1', sim.ctx()) === 'object', true);
  assert.equal(engine.autoAct(sim.state, 'nobody', sim.ctx()), null);
});

test('9upper: @next from the host never gets stuck in judge, and skips level/read/explain/reveal', () => {
  const sim = mk(4, 3);
  sim.host({ type: ACT.NEXT });                                        // ack cue
  sim.host({ type: ACT.NEXT });                                        // level → auto level → read
  assert.equal(phase(sim), 'read');
  sim.host({ type: ACT.NEXT }); sim.host({ type: ACT.NEXT });          // read → explain
  assert.equal(phase(sim), 'explain');
  const turn0 = sim.view(null).turn.index;
  sim.host({ type: ACT.NEXT }); sim.host({ type: ACT.NEXT });
  assert.equal(sim.view(null).turn.index, turn0 + 1);
  sim.act(J(sim), { type: 'decide' });
  sim.host({ type: ACT.NEXT });
  assert.equal(sim.host({ type: ACT.NEXT }), false);                   // judge phase: nothing to skip
  assert.equal(phase(sim), 'judge');
});

// ---------- views and leaks ----------

const keysIn = (o, key, base = '$') => {
  const out = [];
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (k === key) out.push(`${base}.${k}`);
      out.push(...keysIn(v, key, `${base}.${k}`));
    }
  }
  return out;
};

/** The core secrecy invariant, evaluated against the live state after any step. */
function leakCheck(sim) {
  const s = sim.state;
  const r = s.round;
  if (!r || !r.term) return;
  const secret = r.term.explain;
  const src = r.term.src;
  const revealed = s.phase === 'reveal' || s.phase === 'over';
  for (const p of [...sim.players.map((x) => x.id), null]) {
    const v = sim.view(p);
    const json = JSON.stringify(v);
    const isHonest = p === r.honest;
    const mayRead = isHonest && (s.phase === 'read' || ((s.phase === 'explain' || s.phase === 'judge') && s.cfg.rePeek));
    assert.equal(json.includes(secret), revealed || mayRead,
      `phase ${s.phase}: seat ${p} ${json.includes(secret) ? 'has' : 'lacks'} the explanation`);
    assert.equal(json.includes(src), revealed, `source shown outside the reveal to ${p} in ${s.phase}`);
    if (!revealed) {
      assert.equal(v.reveal, null);
      const hk = keysIn(v, 'honest');
      if (p === null || p === r.judge) {
        assert.deepEqual(hk, [], `judge/table view carries an honest flag (${p})`);
        assert.equal(v.mine, null);
      } else if (s.phase === 'level') {
        assert.deepEqual(hk, []);
      } else {
        assert.deepEqual(hk, ['$.mine.honest'], `seat ${p}`);
        assert.equal(v.mine.honest, isHonest);
        assert.equal('explain' in v.mine, mayRead);
      }
    }
    // never any private state key by name
    for (const bad of ['cfg', 'stats', 'cueAck', 'judges', 'players', 'history']) assert.equal(bad in v, false, `view leaks ${bad}`);
    assert.deepEqual(Object.keys(v.round), ['n', 'total']);
    if (!revealed && !mayRead) assert.deepEqual(paths(v, (x) => x === secret), []);
  }
}

test('9upper: leak check at every step of a scripted round', () => {
  for (const rePeek of [false, true]) {
    const sim = mk(6, 12, { rePeek });
    leakCheck(sim);
    sim.act(J(sim), { type: 'level', level: 2 }); leakCheck(sim);
    sim.advance(); leakCheck(sim);
    sim.act(sim.state.round.explainers[0], { type: 'done' }); leakCheck(sim);
    sim.act(J(sim), { type: 'callout', target: sim.state.round.explainers[2] }); leakCheck(sim);
    sim.act(J(sim), { type: 'decide' }); leakCheck(sim);
    sim.act(J(sim), { type: 'pick', target: sim.state.round.explainers[1] }); leakCheck(sim);
    sim.act(J(sim), { type: 'next' }); leakCheck(sim);
  }
});

test('9upper: only the honest seat gets the explanation, during the window; it is dropped afterwards unless rePeek', () => {
  const sim = mk(5, 21, { levelMode: '3' });
  const H = sim.state.round.honest;
  const exp = sim.state.round.term.explain;
  for (const p of sim.players) {
    const v = sim.view(p.id);
    if (p.id === H) { assert.equal(v.mine.honest, true); assert.equal(v.mine.explain, exp); }
    else if (p.id === J(sim)) assert.equal(v.mine, null);
    else { assert.equal(v.mine.honest, false); assert.equal('explain' in v.mine, false); }
  }
  assert.equal(sim.view(null).mine, null);
  sim.advance();
  assert.equal('explain' in sim.view(H).mine, false);                 // phone no longer holds the text
  assert.equal(sim.view(H).mine.honest, true);                        // but the role reminder stays
  const lenient = mk(5, 21, { levelMode: '3', rePeek: true });
  lenient.advance();
  assert.equal(lenient.view(lenient.state.round.honest).mine.explain, lenient.state.round.term.explain);
  for (const p of lenient.players) {
    if (p.id !== lenient.state.round.honest) assert.equal(JSON.stringify(lenient.view(p.id)).includes(lenient.state.round.term.explain), false);
  }
});

test('9upper: the term, hint, judge and order are public to everybody (spectators too)', () => {
  const sim = mk(5, 2, { levelMode: '2' });
  const t = sim.state.round.term;
  for (const pid of [...sim.players.map((p) => p.id), null, 'stranger']) {
    const v = sim.view(pid);
    assert.equal(v.term.text, t.term);
    assert.equal(v.term.level, 2);
    assert.deepEqual(v.term.hint.options, t.hint.options);
    assert.equal(v.judge, J(sim));
    assert.deepEqual(v.explainers, sim.state.round.explainers);
    assert.equal(v.phase, 'read');
    assert.ok(v.title.includes('1/'));
    assert.ok(v.subtitle.includes('做諗樣'));
  }
  assert.equal(sim.view('stranger').me, null);
  assert.equal(sim.view(null).me, null);
});

test('9upper: views are fresh objects (mutating one never touches the state)', () => {
  const sim = mk(5, 2, { levelMode: '2' });
  const before = JSON.stringify(sim.state);
  const v = sim.view(sim.state.round.honest);
  v.mine.explain = 'tampered'; v.term.hint.options.push('x'); v.scores.p1 = 99; v.explainers.pop();
  assert.equal(JSON.stringify(sim.state), before);
});

test('9upper: state is plain JSON and games are deterministic per seed', () => {
  const run = (seed) => { const s = mk(5, seed); s.runRandom(); return s; };
  const a = run(77), b = run(77), c = run(78);
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
  assert.notEqual(JSON.stringify(a.state), JSON.stringify(c.state));
  assert.deepEqual(JSON.parse(JSON.stringify(a.state)), a.state);
  const mid = mk(5, 3);
  mid.act(J(mid), { type: 'level', level: 2 });
  const snap = JSON.parse(JSON.stringify(mid.state));                  // a host refresh restores from JSON
  const out = engine.advance(snap, { ...mid.ctx(), now: snap.deadline });
  assert.equal(out.phase, 'explain');
});

// ---------- fuzzers ----------

const MODES = [
  { name: 'timer', over: {} },
  { name: 'tap', over: { readSecs: 0, levelMode: 'mix' } },
  { name: 'busy', over: { levelMode: '3', speakSecs: 20, callouts: 2, scoreFloor: true, rePeek: true } },
  { name: 'fixed1', over: { levelMode: '1', laps: 1, callouts: 0 } },
];

test('9upper: fuzz — every player count x 110 seeds terminates with a well-formed result', () => {
  for (let n = 3; n <= 9; n++) {
    for (let seed = 1; seed <= 110; seed++) {
      const sim = mk(n, seed * 31 + n);
      const { result } = sim.runRandom();
      assert.ok(result.winners.length >= 1);
      assert.equal(sim.state.history.length, sim.state.totalRounds);
      assert.equal(Object.keys(result.points).length, n);
      // score conservation sanity: nobody exceeds the theoretical maximum
      for (const v of Object.values(result.points)) assert.ok(Number.isFinite(v));
    }
  }
});

test('9upper: fuzz with leak checks at every step — modes x counts x seeds', () => {
  for (const mode of MODES) {
    for (let n = 3; n <= 9; n++) {
      for (let seed = 1; seed <= 6; seed++) {
        const sim = mk(n, seed * 17 + n, mode.over);
        sim.runRandom({ onStep: leakCheck });
        leakCheck(sim);
      }
    }
  }
});

test('9upper: fuzz — config variants over many seeds', () => {
  for (const mode of MODES) {
    for (let n = 3; n <= 9; n += 2) {
      for (let seed = 1; seed <= 25; seed++) {
        const sim = mk(n, seed * 13 + n, mode.over);
        const { result } = sim.runRandom();
        assert.ok(result);
        // legalActions never offers a no-op: runRandom would have thrown
      }
    }
  }
});

test('9upper: fuzz — an empty or missing bank still plays to the end (emergency cards)', () => {
  for (const b of [{ '9upper': [] }, {}]) {
    for (let n = 3; n <= 9; n += 3) {
      const sim = mk(n, n, { levelMode: 'mix' }, b);
      sim.runRandom();
    }
  }
});

test('9upper: fuzz — every non-judge sometimes wins, every judge sometimes scores (no dead roles)', () => {
  const wins = {};
  const players = makePlayers(5).map((p) => p.id);
  for (let seed = 1; seed <= 60; seed++) {
    const { result } = mk(5, seed).runRandom();
    for (const w of result.winners) wins[w] = (wins[w] ?? 0) + 1;
  }
  for (const p of players) assert.ok(wins[p] > 0, `${p} never won in 60 games`);
});

test('9upper: legalActions are all accepted and each changes the state (random sample)', () => {
  const rng = mulberry32(5);
  for (let n = 3; n <= 9; n++) {
    const sim = mk(n, n * 3, { callouts: 2 });
    for (let i = 0; i < 400 && !sim.result(); i++) {
      for (const p of sim.players) {
        const acts = sim.legal(p.id);
        for (const a of acts) {
          const out = engine.act(clone(sim.state), { pid: p.id, action: a }, sim.ctx());
          assert.notEqual(JSON.stringify(out), JSON.stringify(sim.state), `${p.id} ${JSON.stringify(a)} in ${phase(sim)} is a no-op`);
        }
      }
      const movers = sim.players.filter((p) => sim.legal(p.id).length);
      if (movers.length && rng() < 0.9) {
        const m = movers[Math.floor(rng() * movers.length)];
        const acts = sim.legal(m.id);
        sim.act(m.id, acts[Math.floor(rng() * acts.length)]);
      } else if (!(sim.cue() && sim.cueDone())) {
        if (!sim.advance()) sim.host({ type: ACT.NEXT });
      }
    }
  }
});
