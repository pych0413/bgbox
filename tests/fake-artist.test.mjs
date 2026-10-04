// ============================================================
// tests/fake-artist.test.mjs — rules, edge cases, leak checks and a fuzzer for the
// 假畫家 (Fake Artist) engine, in both drawing modes (📱 phone / 📝 paper) and both
// question-master modes (app / player). Run:  node tests/run.mjs fake-artist
// ============================================================

import { test, Sim, assert, HOST, ACT, makePlayers, makeBag } from './lib.mjs';
import { mulberry32, clone } from '../js/core/engine-kit.js';
import { Session } from '../js/core/session.js';
import * as game from '../js/games/fake-artist/game.js';
import drawBank from '../js/data/draw-words.js';

const { engine } = game;
const { CATEGORIES, EXCLUDED_CATEGORIES, MIN_STROKE_LEN } = game;

// ---------- fixture: words that are never substrings of each other or of anything else ----------
const pad = (i) => String(i).padStart(2, '0');
const FIXTURE = Array.from({ length: 80 }, (_, i) => ({
  w: `詞語${pad(i)}`, alt: [`別名${pad(i)}`], level: 1 + (i % 2), cat: CATEGORIES[i % 6],
}));
const banks = { draw: FIXTURE };
const WORD_RE = /詞語\d\d|別名\d\d/;

// the real bank, flattened exactly as core/bag.js does
const REAL = [];
for (const e of drawBank) for (const w of e.words) REAL.push({ w: w.w, alt: w.alt ?? [], level: w.level ?? 1, cat: e.cat });

// ---------- helpers ----------
function mk(n, { seed = 1, config = {}, bank = FIXTURE } = {}) {
  return new Sim(game, { n, seed, config: { ...game.config.defaults(n), ...config }, banks: { draw: bank } });
}
const ids = (sim) => sim.players.map((p) => p.id);
const R = (sim) => sim.state.round;
const phase = (sim) => sim.state.phase;
const drawerOf = (sim) => R(sim).turnOrder[R(sim).turn % R(sim).turnOrder.length];
const readyAll = (sim) => { for (const a of R(sim).artists) sim.act(a, { type: 'ready' }); return sim; };
const drawStroke = (sim) => {
  const d = drawerOf(sim);
  return sim.state.cfg.draw === 'paper' ? sim.act(d, { type: 'done' }) : sim.act(d, { type: 'stroke', length: 150 });
};
const drawAll = (sim) => { while (phase(sim) === 'draw') assert.ok(drawStroke(sim), 'a stroke must advance the turn'); return sim; };
const toVote = (sim) => { if (phase(sim) === 'qm-input') sim.act(R(sim).qm, { type: 'qm-auto' }); if (phase(sim) === 'deal') readyAll(sim); if (phase(sim) === 'first') sim.act(R(sim).qm, { type: 'first', target: R(sim).artists[0] }); return drawAll(sim); };
const voteWith = (sim, fn) => { for (const a of R(sim).vote.voters) sim.act(a, { type: 'vote', target: fn(a) }); return sim; };
const settle = (sim) => { if (phase(sim) === 'tally') sim.advance(); return sim; };
/** The result: every present seat of the round taps 睇完 (D3), so the next round (or the end) comes. */
const allNext = (sim) => {
  const r = R(sim);
  for (const p of [...r.artists, ...(r.qm ? [r.qm] : [])]) {
    if (phase(sim) !== 'result' || R(sim).key !== r.key) break;
    if (!sim.state.absent?.[p]) sim.act(p, { type: 'next' });
  }
  return sim;
};
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const other = (list, not) => list.find((x) => x !== not);

/** Everyone votes for `target` (the target itself votes for somebody else). */
const allVote = (sim, target) => voteWith(sim, (a) => (a === target ? other(R(sim).vote.candidates, a) : target));

/** A round already at the `vote` phase with a chosen fake (a test-only edit of the secret). */
function atVote(n, { config = {}, seed = 1, fake } = {}) {
  const sim = toVote(mk(n, { seed, config }));
  if (fake) sim.state.round.fake = fake;
  return sim;
}

/** Play one whole round: fake not caught (everyone votes for a real artist), then `next`. */
function playRound(sim, { caught = false, correct = false } = {}) {
  toVote(sim);
  const F = R(sim).fake;
  const real = R(sim).artists.filter((a) => a !== F);
  if (caught) allVote(sim, F); else voteWith(sim, (a) => (a === real[0] ? real[1] : real[0]));
  settle(sim);
  if (phase(sim) === 'guess' || phase(sim) === 'judge') {
    if (sim.state.cfg.guess === 'typed') {
      sim.act(F, { type: 'guess', text: correct ? R(sim).word : '（亂估）' });
      if (phase(sim) === 'judge') sim.act(R(sim).judge, { type: 'verdict', correct });
    } else sim.act(R(sim).judge, { type: 'verdict', correct });
  }
  return sim;
}

function setupRaw(n, { config = {}, seed = 1, hostPid, bank = FIXTURE } = {}) {
  const players = makePlayers(n);
  const sim = new Sim(game, { n, seed, config: { ...game.config.defaults(n), ...config }, banks: { draw: bank } });
  const rng = mulberry32(seed);
  sim.state = engine.setup({ players, config: { ...game.config.defaults(n), ...config }, rng, now: sim.now, bag: makeBag({ draw: bank }, mulberry32(seed + 7)), hostPid });
  return sim;
}

// ============================================================
// meta, rules, config
// ============================================================

test('fake-artist: module shape', () => {
  for (const k of ['meta', 'rules', 'config', 'engine']) assert.ok(game[k], `export ${k}`);
  for (const k of ['setup', 'act', 'advance', 'view', 'cue', 'focus', 'blocking', 'autoAct', 'legalActions', 'result', 'canInk']) {
    assert.equal(typeof engine[k], 'function', `engine.${k}`);
  }
  const m = game.meta;
  assert.equal(m.id, 'fake-artist');
  assert.deepEqual(m.banks, ['draw']);
  assert.equal(m.css, true);
  assert.equal(m.paperMode, true);
  assert.ok(m.players[0] <= 4 && m.players[1] >= 8);
  assert.ok(['required', 'recommended', 'optional', 'none'].includes(m.narration));
  assert.ok(['full', 'partial', 'none'].includes(m.singleDevice));
  assert.ok(game.rules.quick.length >= 5 && game.rules.sections.length >= 5);
  for (const sec of game.rules.sections) assert.ok(sec.title && sec.body);
});

test('fake-artist: index.js is the §15.1 module (game exports + ui.mount)', async () => {
  const mod = await import('../js/games/fake-artist/index.js');
  const g = mod.default;
  for (const k of ['meta', 'rules', 'config', 'engine']) assert.ok(g[k], k);
  assert.deepEqual(g.meta, game.meta);                    // (index.js imports game.js?v=N: another module instance)
  assert.equal(typeof g.ui.mount, 'function');
  for (const k of ['setup', 'act', 'advance', 'view', 'cue', 'focus', 'autoAct', 'legalActions', 'result', 'canInk']) assert.equal(typeof g.engine[k], 'function', k);
});

test('fake-artist: config defaults are valid for every head-count and fields/summary render', () => {
  for (let n = game.meta.players[0]; n <= game.meta.players[1]; n++) {
    const cfg = game.config.defaults(n);
    const v = game.config.validate(cfg, n);
    assert.ok(v.ok, `n=${n}: ${v.message}`);
    assert.equal(cfg.qm, 'app');
    assert.equal(cfg.draw, 'phone');
    assert.equal(cfg.laps, 2);
    assert.equal(cfg.target, 5);
    assert.equal(cfg.tieRule, 'must-guess');
    assert.equal(cfg.scoring, 'points');
    const fields = game.config.fields(cfg, n);
    assert.ok(fields.length >= 9);
    for (const f of fields) assert.ok(f.key && f.label && f.type, `field ${f.key}`);
    assert.ok(game.config.summary(cfg, n).every((l) => typeof l === 'string' && l));
    new Sim(game, { n, seed: n, config: cfg, banks }).runRandom();
  }
});

test('fake-artist: the categories field offers the drawable categories and the three levels', () => {
  const f = game.config.fields(game.config.defaults(6), 6).find((x) => x.type === 'categories');
  assert.equal(f.key, 'topics');
  assert.deepEqual(f.options.map((o) => o.value), CATEGORIES);
  assert.deepEqual(f.levels.map((o) => o.value), [1, 2, 3]);
  // the shell hands back { cats, levels } and the engine reads exactly that
  const cfg = game.config.defaults(6, { topics: { cats: [CATEGORIES[1]], levels: [2] } });
  assert.deepEqual(cfg.topics, { cats: [CATEGORIES[1]], levels: [2] });
  assert.deepEqual(game.config.defaults(6, { topics: [CATEGORIES[2]] }).topics, { cats: [CATEGORIES[2]], levels: [] }, 'a bare array is tolerated');
});

test('fake-artist: config.defaults keeps tastes from prev, drops what does not fit the head-count', () => {
  const prev = { draw: 'paper', qm: 'player', laps: 1, tieRule: 'revote', guess: 'typed', endMode: 'rounds', rounds: 4, first: 'qm', turnSecs: 15, antiStreak: true };
  const six = game.config.defaults(6, prev);
  for (const [k, v] of Object.entries(prev)) assert.equal(six[k], v, k);
  const three = game.config.defaults(3, prev);          // a human QM needs 3 artists
  assert.equal(three.qm, 'app');
  assert.ok(game.config.validate(three, 3).ok);
  assert.equal(new Sim(game, { n: 3, seed: 1, config: three, banks }).state.cfg.first, 'auto', '「出題者揀」 needs a QM: the engine treats it as auto');
  const junk = game.config.defaults(5, { draw: 'x', qm: 7, laps: 99, tieRule: 'no', guess: null, scoring: 'x', endMode: 'x', target: 0, rounds: -2, first: 'z', turnSecs: 999, antiStreak: 'y', topics: 5 });
  assert.deepEqual(junk, game.config.defaults(5));
});

test('fake-artist: config.defaults with { singleDevice } — one phone for everybody: the app asks, no stroke clock, other tastes kept', () => {
  const prev = { draw: 'paper', qm: 'player', laps: 1, tieRule: 'escape', guess: 'typed', turnSecs: 15, scoring: 'none' };
  const one = game.config.defaults(6, prev, { singleDevice: true });
  assert.equal(one.qm, 'app', 'a question master on a passed-round phone has nobody to hide the fake from');
  assert.equal(one.turnSecs, 0, 'handing the phone over would eat into a stroke clock');
  for (const k of ['draw', 'laps', 'tieRule', 'guess', 'scoring']) assert.equal(one[k], prev[k], k);
  assert.equal(one.vote, 'point', 'U7: one phone votes by pointing together');
  assert.equal(one.passPhone, true, 'the engine learns the phone goes round');
  assert.deepEqual(game.config.defaults(6, prev, { singleDevice: false }), game.config.defaults(6, prev));
  assert.deepEqual(game.config.defaults(6, undefined, { singleDevice: true }),
    { ...game.config.defaults(6), qm: 'app', turnSecs: 0, vote: 'point', passPhone: true });
  // a second phone joins: the one phone's defaults go back to the multi-phone ones
  const back = game.config.defaults(6, one, { singleDevice: false });
  assert.deepEqual([back.vote, back.passPhone], ['ballot', false]);
  assert.equal(game.config.defaults(6, { ...one, vote: 'point', passPhone: false }, { singleDevice: false }).vote, 'point',
    'a table that chose 一齊指 itself keeps it');
  for (let n = game.meta.players[0]; n <= game.meta.players[1]; n++) {
    const cfg = game.config.defaults(n, prev, { singleDevice: true });
    assert.ok(game.config.validate(cfg, n).ok, `n=${n}`);
    new Sim(game, { n, seed: n + 40, config: cfg, banks }).runRandom();
  }
});

test('fake-artist: config.validate rejects nonsense, warns about the shaky, and old saved configs still load', () => {
  const v = (cfg, n) => game.config.validate({ ...game.config.defaults(n), ...cfg }, n);
  for (const n of [0, 2, 11, 12]) assert.equal(game.config.validate(game.config.defaults(5), n).ok, false, `n=${n}`);
  for (const bad of [{ draw: 'x' }, { qm: 'x' }, { laps: 0 }, { laps: 4 }, { tieRule: 'coin' }, { guess: 'x' }, { endMode: 'x' }, { target: 0 }, { target: 16 },
    { rounds: 21 }, { first: 'x' }, { turnSecs: 61 }, { antiStreak: 'yes' }, { topics: { cats: [3] } }, { topics: { levels: [4] } }, { scoring: 'x' }]) {
    assert.equal(v(bad, 6).ok, false, JSON.stringify(bad));
  }
  assert.equal(v({ qm: 'player' }, 3).ok, false, 'a human QM needs at least 4 players');
  assert.equal(v({ qm: 'player' }, 4).ok, true);
  assert.ok(v({}, 3).warnings.some((w) => /3 個畫家/.test(w)));
  assert.ok(v({ qm: 'player' }, 4).warnings.length, '4 players with a QM is below the official minimum');
  assert.ok(v({}, 10).warnings.some((w) => /10 個畫家/.test(w)));
  assert.ok(!v({}, 10).warnings.some((w) => /1 圈/.test(w)), 'fewer strokes would make a big table even worse at catching the fake');
  assert.ok(!v({ qm: 'player' }, 5).warnings.some((w) => /官方最少/.test(w)), 'QM + 4 artists IS the official minimum');
  for (let n = 5; n <= 8; n++) assert.deepEqual(v({}, n).warnings, [], `the default setup for ${n} is not shaky`);
  assert.ok(v({ tieRule: 'escape' }, 5).warnings.some((w) => /舊版/.test(w)));
  assert.equal(game.config.validate({}, 6).ok, true, 'an empty saved config');
  const sim = new Sim(game, { n: 6, seed: 1, config: { draw: 'phone', qm: 'app' }, banks });
  assert.equal(sim.state.cfg.tieRule, 'must-guess');
  assert.equal(sim.state.cfg.target, 5);
});

test('fake-artist: #8 presets — every head-count has presets with a short reason, and every preset is valid and playable', () => {
  for (let n = game.meta.players[0]; n <= game.meta.players[1]; n++) {
    const ps = game.config.presets(n);
    assert.ok(ps.length >= 3, `n=${n}`);
    assert.equal(ps[0].id, 'standard');
    assert.equal(new Set(ps.map((p) => p.id)).size, ps.length);
    assert.ok(ps[0].reason.startsWith(`${n} 人：`), ps[0].reason);
    assert.match(ps[0].reason, n <= 3 ? /易俾人睇穿/ : n === 4 ? /平票/ : n <= 8 ? /最啱玩/ : /難揪/, 'the standard preset says why for this head-count');
    assert.equal(ps.some((p) => p.id === 'host'), n >= 5, 'the official QM game needs 5 players (QM + 4 artists)');
    const d = game.config.defaults(n);
    const seen = new Set();
    for (const p of ps) {
      assert.ok(p.label && Array.from(p.label).length <= 6, `short label: ${p.label}`);
      assert.ok(p.reason && Array.from(p.reason).length <= 45, `short reason: ${p.reason}`);
      assert.match(p.reason, /：/, `a reason, not a list: ${p.reason}`);
      const cfg = { ...d, ...p.cfg };
      assert.ok(game.config.validate(cfg, n).ok, `n=${n} preset ${p.id}`);
      const key = JSON.stringify(game.config.summary(cfg, n));
      assert.ok(!seen.has(key), `preset ${p.id} plays exactly like another one`);
      seen.add(key);
      const sim = new Sim(game, { n, seed: n, config: cfg, banks });
      const { result } = sim.runRandom();
      if (p.id === 'noscore') assert.ok(Object.values(sim.state.scores).every((x) => x === 0), 'no points in 唔計分');
      if (p.id === 'host') assert.equal(sim.state.cfg.qm, 'player');
      assert.ok(result.winners.length >= 1);
    }
  }
  // invalid sets are blocked, not just warned about
  assert.equal(game.config.validate({ ...game.config.defaults(3), qm: 'player' }, 3).ok, false);
  assert.equal(game.config.validate({ ...game.config.defaults(6), scoring: 'maybe' }, 6).ok, false);
});

test('fake-artist: U1 — rules.quick is at most 6 short lines; every role says what you do and how you win', () => {
  const q = game.rules.quick;
  assert.ok(q.length >= 3 && q.length <= 6);
  for (const l of q) assert.ok(Array.from(l).length <= 40, `short quick line: ${l}`);
  assert.deepEqual(game.rules.roles.map((r) => r.id).sort(), ['artist', 'fake', 'question-master']);
  for (const r of game.rules.roles) {
    assert.ok(r.name && r.emoji && r.team && r.text);
    assert.ok(r.text.includes('點贏'), `${r.id} says how to win`);
    assert.ok(r.text.split('點贏')[0].length >= 15, `${r.id} says what you do`);
  }
});

// ============================================================
// the word bank
// ============================================================

test('fake-artist: the shipped draw bank — drawable + excluded categories partition it, no leaks, enough easy words', () => {
  const bankCats = [...new Set(REAL.map((e) => e.cat))];
  assert.deepEqual([...bankCats].sort(), [...CATEGORIES, ...EXCLUDED_CATEGORIES].sort(),
    'a category was added to / removed from the bank: decide whether it is drawable');
  for (const c of EXCLUDED_CATEGORIES) assert.ok(!CATEGORIES.includes(c));
  const norm = game.normText;
  for (const cat of CATEGORIES) {
    const good = REAL.filter((e) => e.cat === cat && e.level <= 2 && !norm(cat).includes(norm(e.w)) && !norm(e.w).includes(norm(cat))
      && !e.alt.some((a) => a && norm(cat).includes(norm(a))));
    assert.ok(good.length >= 8, `${cat}: only ${good.length} usable easy words`);
  }
});

test('fake-artist: bank draws never hand the fake the answer (theme never names the word) and honour category / level filters', () => {
  const norm = game.normText;
  for (let seed = 1; seed <= 12; seed++) {
    const sim = new Sim(game, { n: 5, seed, config: { ...game.config.defaults(5), topics: { cats: [], levels: [] } }, banks: { draw: REAL } });
    for (let r = 0; r < 4; r++) {
      const rd = R(sim);
      assert.ok(CATEGORIES.includes(rd.theme), `theme ${rd.theme}`);
      assert.ok(!norm(rd.theme).includes(norm(rd.word)) && !norm(rd.word).includes(norm(rd.theme)), `${rd.theme}/${rd.word}`);
      for (const a of rd.alt) assert.ok(!norm(rd.theme).includes(norm(a)), `${rd.theme}/${a}`);
      const e = REAL.find((x) => x.w === rd.word);
      assert.ok(e.level <= 2, `default levels are easy + medium: ${rd.word} is level ${e.level}`);
      playRound(sim, { caught: false });
      if (sim.state.ending) break;
      allNext(sim);
    }
  }
  const cfg = { ...game.config.defaults(5), topics: { cats: ['水果'], levels: [1] } };
  for (let seed = 1; seed <= 6; seed++) {
    const sim = new Sim(game, { n: 5, seed, config: cfg, banks: { draw: REAL } });
    const e = REAL.find((x) => x.w === R(sim).word);
    assert.equal(e.cat, '水果');
    assert.equal(e.level, 1);
  }
});

test('fake-artist: a missing or empty bank never kills a round (emergency words)', () => {
  const sim = new Sim(game, { n: 5, seed: 3, banks: {} });
  assert.ok(R(sim).word && R(sim).theme);
  assert.equal(phase(sim), 'deal');
  sim.runRandom();
  const throwing = { draw() { throw new Error('bank not loaded'); } };
  const s2 = engine.setup({ players: makePlayers(5), config: game.config.defaults(5), rng: mulberry32(2), now: 1, bag: throwing });
  assert.ok(s2.round.word);
  const s3 = engine.setup({ players: makePlayers(5), config: game.config.defaults(5), rng: mulberry32(2), now: 1 });
  assert.ok(s3.round.word, 'no bag at all');
});

// ============================================================
// setup and the deal
// ============================================================

test('fake-artist: app QM — everybody draws, exactly one fake, a theme and a word from the bank', () => {
  for (let n = 3; n <= 10; n++) {
    const sim = mk(n, { seed: n });
    const r = R(sim);
    assert.equal(r.qm, null);
    assert.equal(r.artists.length, n);
    assert.ok(r.artists.includes(r.fake));
    assert.equal(phase(sim), 'deal');
    assert.equal(sim.state.inkEpoch, 1);
    assert.ok(FIXTURE.some((e) => e.w === r.word && e.cat === r.theme));
  }
});

test('fake-artist: player QM — the QM is not an artist, rotates to the left each round, first QM is random', () => {
  const firsts = new Set();
  for (let seed = 1; seed <= 40; seed++) firsts.add(R(mk(5, { seed, config: { qm: 'player' } })).qm);
  assert.ok(firsts.size >= 4, `the first QM is random over the seats (saw ${[...firsts]})`);

  const sim = mk(5, { seed: 7, config: { qm: 'player', endMode: 'rounds', rounds: 8 } });
  assert.equal(phase(sim), 'qm-input');
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const r = R(sim);
    seen.push(r.qm);
    assert.equal(r.artists.length, 4);
    assert.ok(!r.artists.includes(r.qm));
    sim.act(r.qm, { type: 'qm-auto' });
    assert.ok(r.artists.includes(R(sim).fake));
    assert.notEqual(R(sim).fake, r.qm, 'the QM is never the fake');
    assert.deepEqual(r.artists, [...ids(sim).slice(ids(sim).indexOf(r.qm) + 1), ...ids(sim).slice(0, ids(sim).indexOf(r.qm))], 'artists in seat order starting left of the QM');
    playRound(sim);
    allNext(sim);
  }
  for (let i = 1; i < seen.length; i++) assert.equal(seen[i], ids(sim)[(ids(sim).indexOf(seen[i - 1]) + 1) % 5], 'the QM moves one seat left each round');
});

test('fake-artist: the fake is dealt uniformly at random and the first drawer is random over all artists', () => {
  const n = 5;
  const asFake = Object.fromEntries(ids(mk(n)).map((id) => [id, 0]));
  const asFirst = { ...asFake };
  const N = 1500;
  for (let seed = 1; seed <= N; seed++) {
    const sim = mk(n, { seed });
    asFake[R(sim).fake] += 1;
    readyAll(sim);
    asFirst[R(sim).turnOrder[0]] += 1;
  }
  for (const [id, c] of Object.entries(asFake)) assert.ok(Math.abs(c - N / n) < N / n * 0.25, `${id} fake ${c}/${N}`);
  for (const [id, c] of Object.entries(asFirst)) assert.ok(Math.abs(c - N / n) < N / n * 0.25, `${id} first ${c}/${N}`);
});

test('fake-artist: option antiStreak — off by default; on, the same seat is not the fake twice running (4+ artists)', () => {
  assert.equal(game.config.defaults(6).antiStreak, false);
  let repeats = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const sim = mk(5, { seed, config: { antiStreak: true, endMode: 'rounds', rounds: 5 } });
    let prev = null;
    for (let i = 0; i < 4; i++) {
      if (prev !== null && R(sim).fake === prev) repeats++;
      prev = R(sim).fake;
      playRound(sim);
      allNext(sim);
    }
  }
  assert.equal(repeats, 0, 'no immediate repeats with antiStreak');
  let plain = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const sim = mk(5, { seed, config: { endMode: 'rounds', rounds: 5 } });
    let prev = null;
    for (let i = 0; i < 4; i++) {
      if (prev !== null && R(sim).fake === prev) plain++;
      prev = R(sim).fake;
      playRound(sim);
      allNext(sim);
    }
  }
  assert.ok(plain > 0, 'without it repeats do happen (so the option really does something)');
});

// ============================================================
// the question master (player mode)
// ============================================================

const qmSim = (n = 5, seed = 4, config = {}) => mk(n, { seed, config: { qm: 'player', first: 'auto', ...config } });

test('fake-artist: the QM types a theme and a word; others, spectators and wrong phases are ignored', () => {
  const sim = qmSim();
  const qm = R(sim).qm;
  const notQm = other(ids(sim), qm);
  assert.equal(sim.act(notQm, { type: 'qm-set', theme: '動物', word: '貓' }), false);
  assert.equal(sim.act(notQm, { type: 'qm-random' }), false);
  assert.equal(sim.act(notQm, { type: 'qm-auto' }), false);
  assert.equal(sim.act('nobody', { type: 'qm-set', theme: '動物', word: '貓' }), false);
  assert.equal(sim.act(qm, { type: 'ready' }), false, 'the QM does not look at a card to start');
  assert.ok(sim.act(qm, { type: 'qm-set', theme: '  動物 ', word: '大  象' }));
  assert.equal(phase(sim), 'deal');
  assert.equal(R(sim).theme, '動物');
  assert.equal(R(sim).word, '大 象', 'whitespace is tidied');
  assert.equal(sim.act(qm, { type: 'qm-set', theme: 'x', word: 'y' }), false, 'one entry only');
  assert.notEqual(R(sim).fake, qm);
});

test('fake-artist: QM entries are validated (empty, too long, theme naming the word)', () => {
  const sim0 = qmSim();
  const qm = R(sim0).qm;
  for (const [theme, word] of [['', '貓'], ['動物', ''], ['  ', '  '], ['一二三四五六七八九十一二三', '貓'], ['動物', '一二三四五六七八九十一二三四五六七'],
    ['獅子', '獅子'], ['大象動物', '大象'], ['Lion', 'lion'], ['LION!', 'lion'], ['動 物', '動物'], [3, 4], [null, undefined], [{}, []]]) {
    const sim = qmSim();
    assert.equal(sim.act(qm, { type: 'qm-set', theme, word }), false, JSON.stringify([theme, word]));
    assert.equal(phase(sim), 'qm-input');
  }
  const ok = game.checkEntry('動物', '大象');
  assert.deepEqual([ok.ok, ok.theme, ok.word], [true, '動物', '大象']);
  assert.equal(game.checkEntry('動物', '動物園').ok, true, 'a word that merely contains the theme is allowed');
  assert.match(game.checkEntry('獅子', '獅子').message, /洩露/);
  assert.equal(game.checkEntry(undefined, undefined).ok, false);
});

test('fake-artist: 🎲 qm-random fills a draft only the QM sees; keeping the word keeps the bank aliases; qm-auto deals at once', () => {
  const sim = qmSim();
  const qm = R(sim).qm;
  assert.equal(sim.view(qm).draft, null);
  sim.act(qm, { type: 'qm-random' });
  const d1 = sim.view(qm).draft;
  assert.ok(d1 && d1.seq === 1 && d1.word && d1.theme);
  assert.equal(phase(sim), 'qm-input', 'a draft is only a suggestion');
  for (const pid of ids(sim)) if (pid !== qm) assert.equal(sim.view(pid).draft, null);
  assert.equal(sim.view(null).draft, null);
  assert.ok(!JSON.stringify(sim.view(other(ids(sim), qm))).includes(d1.word), 'the others never see the draft');
  sim.act(qm, { type: 'qm-random' });
  assert.equal(sim.view(qm).draft.seq, 2);
  const d2 = sim.view(qm).draft;
  const entry = FIXTURE.find((e) => e.w === d2.word);
  sim.act(qm, { type: 'qm-set', theme: d2.theme, word: d2.word });
  assert.deepEqual(R(sim).alt, entry.alt, 'the QM kept the rolled word, so its aliases still count');

  const s2 = qmSim(5, 9);
  s2.act(R(s2).qm, { type: 'qm-set', theme: '動物', word: '貓' });
  assert.deepEqual(R(s2).alt, [], 'a typed word has no aliases');

  const s3 = qmSim(5, 11);
  assert.ok(s3.act(R(s3).qm, { type: 'qm-auto' }));
  assert.equal(phase(s3), 'deal');
  assert.ok(FIXTURE.some((e) => e.w === R(s3).word));
});

test('fake-artist: the QM knows the word and the fake; nobody else does (views)', () => {
  const sim = qmSim();
  const qm = R(sim).qm;
  sim.act(qm, { type: 'qm-set', theme: '動物', word: '大象' });
  const v = sim.view(qm);
  assert.deepEqual(v.mine, { role: 'question-master', theme: '動物', word: '大象', fake: R(sim).fake });
  assert.equal(v.myRole, 'question-master');
  for (const a of R(sim).artists) {
    const va = sim.view(a);
    assert.equal(va.mine.theme, '動物');
    assert.equal(va.mine.fake, undefined, 'artists never learn who the fake is');
    assert.equal(va.mine.word, a === R(sim).fake ? null : '大象');
  }
  assert.equal(sim.view(null).mine, null);
  assert.ok(!JSON.stringify(sim.view(null)).includes('大象'));
});

test('fake-artist: the official rule is the default — switch to a QM game and the QM picks who draws first', () => {
  assert.equal(game.config.defaults(6).first, 'qm');
  const sim = new Sim(game, { n: 6, seed: 5, config: { ...game.config.defaults(6), qm: 'player' }, banks });
  const qm = R(sim).qm;
  sim.act(qm, { type: 'qm-auto' });
  readyAll(sim);
  assert.equal(phase(sim), 'first');
  assert.equal(sim.view(qm).hint.includes('先畫'), true);
  const app = new Sim(game, { n: 6, seed: 5, config: game.config.defaults(6), banks });
  readyAll(app);
  assert.equal(phase(app), 'draw', 'with the app as QM there is nobody to choose');
  const fields = game.config.fields({ ...game.config.defaults(6), qm: 'player' }, 6).find((f) => f.key === 'first');
  assert.equal(fields.options[0].value, 'qm');
});

test('fake-artist: first drawer — auto = left of the QM, random, or the QM picks (clockwise from there)', () => {
  const left = qmSim(5, 3, { first: 'auto' });
  left.act(R(left).qm, { type: 'qm-auto' });
  readyAll(left);
  assert.equal(R(left).turnOrder[0], R(left).artists[0], 'left of the QM');

  const picked = qmSim(5, 3, { first: 'qm' });
  const qm = R(picked).qm;
  picked.act(qm, { type: 'qm-auto' });
  assert.equal(phase(picked), 'deal');
  readyAll(picked);
  assert.equal(phase(picked), 'first');
  assert.deepEqual(sim_focus(picked), [qm]);
  const notQm = other(ids(picked), qm);
  assert.equal(picked.act(notQm, { type: 'first', target: R(picked).artists[0] }), false);
  assert.equal(picked.act(qm, { type: 'first', target: qm }), false, 'the QM does not draw');
  assert.equal(picked.act(qm, { type: 'first', target: 'zz' }), false);
  const target = R(picked).artists[2];
  assert.ok(picked.act(qm, { type: 'first', target }));
  assert.equal(phase(picked), 'draw');
  assert.equal(R(picked).turnOrder[0], target);
  const art = R(picked).artists;
  assert.deepEqual(R(picked).turnOrder, [...art.slice(2), ...art.slice(0, 2)], 'clockwise (seat order) from the first drawer');

  const rnd = mk(5, { seed: 3, config: { first: 'random' } });
  readyAll(rnd);
  assert.ok(R(rnd).turnOrder.length === 5);
  const app = mk(5, { seed: 3, config: { first: 'qm' } });          // no QM in app mode: it is just 'auto' (random)
  readyAll(app);
  assert.equal(phase(app), 'draw');
});
function sim_focus(sim) { return sim.focus().pids; }

// ============================================================
// the card (anti-tell)
// ============================================================

test('fake-artist: the fake and the real artists get a card of exactly the same shape; only the word differs', () => {
  const sim = mk(6, { seed: 5 });
  const F = R(sim).fake;
  const keys = (v) => JSON.stringify(Object.keys(v.mine));
  const real = R(sim).artists.filter((a) => a !== F);
  for (const a of real) {
    const v = sim.view(a);
    assert.equal(keys(v), keys(sim.view(F)));
    assert.equal(v.mine.role, 'artist');
    assert.equal(v.mine.word, R(sim).word);
    assert.equal(v.mine.theme, R(sim).theme);
  }
  const fv = sim.view(F);
  assert.equal(fv.mine.role, 'fake');
  assert.equal(fv.mine.word, null);
  assert.equal(fv.mine.theme, R(sim).theme, 'the fake does see the theme');
  assert.equal(fv.myRole, 'fake');
  assert.equal(sim.view(real[0]).myRole, 'artist');
  // top-level keys of the two views are identical too (nothing extra for one role)
  assert.deepEqual(Object.keys(fv).sort(), Object.keys(sim.view(real[0])).sort());
  assert.equal(sim.view(F).ready.mine, false);
});

test('fake-artist: drawing waits until every artist has looked; the table moves on without the QM', () => {
  const sim = mk(5, { seed: 2 });
  const [a, b, c, d, e] = R(sim).artists;
  for (const x of [a, b, c, d]) sim.act(x, { type: 'ready' });
  assert.equal(phase(sim), 'deal');
  assert.equal(sim.act(a, { type: 'ready' }), false, 'a second tap changes nothing');
  assert.deepEqual(sim_focus(sim), [e]);
  assert.equal(sim.view(e).ready.done, 4);
  assert.equal(sim.view(null).ready.total, 5);
  sim.act(e, { type: 'ready' });
  assert.equal(phase(sim), 'draw');
  assert.equal(sim.act('ghost', { type: 'ready' }), false);
});

// ============================================================
// drawing — order, laps, both modes
// ============================================================

for (const mode of ['phone', 'paper']) {
  test(`fake-artist: ${mode} — clockwise, 2 laps, exactly 2 x artists strokes, nobody draws twice in a row`, () => {
    for (const n of [3, 5, 8, 10]) {
      const sim = mk(n, { seed: n, config: { draw: mode } });
      readyAll(sim);
      const order = R(sim).turnOrder.slice();
      assert.equal(order.length, n);
      const seatOrder = ids(sim);
      for (let i = 1; i < n; i++) assert.equal(order[i], seatOrder[(seatOrder.indexOf(order[i - 1]) + 1) % n], 'clockwise');
      const log = [];
      while (phase(sim) === 'draw') {
        assert.equal(sim.view(drawerOf(sim)).draw.current, drawerOf(sim));
        log.push(drawerOf(sim));
        drawStroke(sim);
      }
      assert.equal(log.length, 2 * n);
      assert.deepEqual(log, [...order, ...order]);
      for (let i = 1; i < log.length; i++) assert.notEqual(log[i], log[i - 1]);
      assert.equal(phase(sim), 'vote');
      assert.deepEqual(R(sim).strokes.map((s) => s.pid), log);
      assert.deepEqual(R(sim).strokes.map((s) => s.lap), log.map((_, i) => (i < n ? 1 : 2)));
    }
  });
}

test('fake-artist: laps 1 and 3 change the stroke count', () => {
  for (const laps of [1, 3]) {
    const sim = mk(4, { seed: 2, config: { laps } });
    readyAll(sim);
    let strokes = 0;
    while (phase(sim) === 'draw') { drawStroke(sim); strokes++; }
    assert.equal(strokes, 4 * laps);
  }
});

test('fake-artist: phone mode — only the current drawer may ink or send a stroke; a too-short stroke does not count', () => {
  const sim = mk(5, { seed: 2 });
  assert.equal(engine.canInk(sim.state, R(sim).artists[0]), false, 'nobody inks before the drawing starts');
  readyAll(sim);
  const d = drawerOf(sim);
  for (const pid of ids(sim)) assert.equal(engine.canInk(sim.state, pid), pid === d, `canInk ${pid}`);
  assert.equal(engine.canInk(sim.state, null), false);
  const notD = other(ids(sim), d);
  assert.equal(sim.act(notD, { type: 'stroke', length: 150 }), false, 'wrong player');
  assert.equal(sim.act(d, { type: 'stroke', length: 3 }), false, 'a tap is not a stroke');
  assert.equal(sim.act(d, { type: 'stroke', length: -50 }), false);
  assert.equal(sim.act(d, { type: 'stroke', length: Number.NaN }), false);
  assert.equal(sim.act(d, { type: 'stroke', length: '150' }), false, 'a string is not a length');
  assert.equal(sim.act(d, { type: 'stroke' }), false);
  assert.equal(sim.act(d, { type: 'done' }), false, 'no 畫完 button on the phone board');
  assert.ok(R(sim).turn === 0);
  assert.ok(sim.act(d, { type: 'stroke', length: MIN_STROKE_LEN }), 'a stroke of the minimum length counts');
  assert.equal(R(sim).turn, 1);
  assert.equal(engine.canInk(sim.state, d), false, 'one stroke per turn: the turn moved on');
  assert.equal(sim.act(d, { type: 'stroke', length: 150 }), false, 'a second stroke from the same player is not their turn');
  assert.equal(sim.view(d).draw.canDraw, false);
  assert.equal(sim.view(drawerOf(sim)).draw.canDraw, true);
  assert.equal(sim.view(null).draw.canDraw, false);
  const v = sim.view(d).draw;
  assert.equal(v.minLen, MIN_STROKE_LEN);
  assert.equal(v.mode, 'phone');
});

test('fake-artist: paper mode — nobody inks; the drawer (or the human QM) taps 畫完; strokes from a phone board are ignored', () => {
  const sim = mk(5, { seed: 2, config: { draw: 'paper' } });
  readyAll(sim);
  const d = drawerOf(sim);
  for (const pid of ids(sim)) assert.equal(engine.canInk(sim.state, pid), false);
  assert.equal(sim.act(d, { type: 'stroke', length: 150 }), false);
  assert.equal(sim.act(other(ids(sim), d), { type: 'done' }), false, 'somebody else cannot end your stroke');
  assert.equal(sim.view(other(ids(sim), d)).draw.canDone, false);
  assert.equal(sim.view(d).draw.canDone, true);
  assert.ok(sim.act(d, { type: 'done' }));
  assert.equal(R(sim).turn, 1);
  assert.equal(R(sim).strokes[0].kind, 'paper');

  const q = qmSim(5, 3, { draw: 'paper' });
  q.act(R(q).qm, { type: 'qm-auto' });
  readyAll(q);
  const qm = R(q).qm;
  assert.equal(q.view(qm).draw.canDone, true, 'the QM can keep the table moving');
  assert.ok(q.act(qm, { type: 'done' }));
  assert.equal(R(q).turn, 1);
});

test('fake-artist: a stroke is given up with skip / autoAct / host @next (forfeit): the slot is used, no second chance', () => {
  const sim = mk(4, { seed: 2 });
  readyAll(sim);
  const d = drawerOf(sim);
  const before = R(sim).turn;
  assert.deepEqual(engine.autoAct(clone(sim.state), d, sim.ctx()), { type: 'skip' });
  assert.equal(engine.autoAct(clone(sim.state), other(ids(sim), d), sim.ctx()), null);
  assert.ok(sim.act(d, engine.autoAct(clone(sim.state), d, sim.ctx())));
  assert.equal(R(sim).turn, before + 1);
  assert.equal(R(sim).strokes[0].kind, 'forfeit');
  const d2 = drawerOf(sim);
  // host @next: the first press only acknowledges the narration line, the second skips
  sim.host({ type: ACT.NEXT });
  if (R(sim).turn === before + 1) sim.host({ type: ACT.NEXT });
  assert.equal(R(sim).turn, before + 2, `host skipped ${d2}`);
  assert.equal(R(sim).strokes[1].kind, 'forfeit');
  // paper mode: the host 「代佢做」 means the drawing happened on the paper — it counts as done
  const p = mk(4, { seed: 2, config: { draw: 'paper' } });
  readyAll(p);
  const pd = drawerOf(p);
  assert.deepEqual(engine.autoAct(clone(p.state), pd, p.ctx()), { type: 'done' });
});

test('fake-artist: option turnSecs — a timed-out stroke is forfeited and the next drawer gets a fresh clock', () => {
  const sim = mk(4, { seed: 2, config: { turnSecs: 15 } });
  assert.equal(sim.state.deadline, null, 'no clock while people look at their cards');
  readyAll(sim);
  assert.equal(sim.state.deadline, sim.now + 15000);
  assert.ok(sim.view(drawerOf(sim)).deadline);
  const first = drawerOf(sim);
  assert.equal(engine.advance(clone(sim.state), { ...sim.ctx(), now: sim.now + 14000 }).round.turn, 0, 'a timer that fires early is ignored');
  assert.ok(sim.advance());
  assert.equal(R(sim).turn, 1);
  assert.equal(R(sim).strokes[0].pid, first);
  assert.equal(R(sim).strokes[0].kind, 'forfeit');
  assert.equal(sim.state.deadline, sim.now + 15000, 'a fresh clock');
  // a drawer who finishes in time just moves the turn; the clock restarts
  sim.tick(3000);
  drawStroke(sim);
  assert.equal(sim.state.deadline, sim.now + 15000);
  while (phase(sim) === 'draw') drawStroke(sim);
  assert.equal(sim.state.deadline, null, 'no clock in the vote');
  // every stroke timing out still ends the drawing
  const t = mk(3, { seed: 4, config: { turnSecs: 5, draw: 'paper' } });
  readyAll(t);
  let guard = 0;
  while (phase(t) === 'draw' && guard++ < 50) t.advance();
  assert.equal(phase(t), 'vote');
  assert.equal(R(t).strokes.length, 6);
});

test('fake-artist: the picture is a fresh epoch every round (the session clears the ink); state never holds ink', () => {
  const sim = mk(4, { seed: 2 });
  assert.equal(sim.state.inkEpoch, 1);
  playRound(sim);
  assert.equal(sim.state.inkEpoch, 1, 'the picture stays for the reveal');
  allNext(sim);
  assert.equal(sim.state.inkEpoch, 2);
  assert.ok(!JSON.stringify(sim.state).includes('"pts"'));
});

// ============================================================
// voting
// ============================================================

test('fake-artist: ballots — no self vote, QM and outsiders cannot vote, one ballot each, hidden until the last one', () => {
  const sim = toVote(mk(5, { seed: 6 }));
  const [a, b, c, d, e] = R(sim).artists;
  assert.equal(phase(sim), 'vote');
  assert.deepEqual(sim_focus(sim).sort(), [a, b, c, d, e].sort());
  assert.equal(sim.act(a, { type: 'vote', target: a }), false, 'no self vote');
  assert.equal(sim.act(a, { type: 'vote', target: 'ghost' }), false);
  assert.equal(sim.act(a, { type: 'vote', target: undefined }), false);
  assert.equal(sim.act('ghost', { type: 'vote', target: a }), false);
  assert.ok(sim.act(a, { type: 'vote', target: b }));
  assert.equal(sim.act(a, { type: 'vote', target: c }), false, 'ballots are locked at submit');
  assert.equal(sim.view(a).vote.myVote, b);
  assert.equal(sim.view(c).vote.myVote, undefined);
  assert.equal(sim.view(a).vote.canVote, false);
  assert.equal(sim.view(c).vote.canVote, true);
  assert.equal(sim.view(c).vote.done, 1);
  assert.ok(!('tally' in sim.view(c)), 'nothing revealed yet');
  assert.ok(!JSON.stringify(sim.view(c)).includes(`"votes"`), 'no ballots in anyone else’s view');
  for (const x of [b, c, d]) sim.act(x, { type: 'vote', target: other(R(sim).vote.candidates, x) });
  assert.equal(phase(sim), 'vote', 'still one ballot missing');
  sim.act(e, { type: 'vote', target: a });
  assert.equal(phase(sim), 'tally');
  assert.ok(sim.view(c).tally.round1.votes[a] === b, 'the reveal shows who voted for whom');

  const q = qmSim(5, 3);
  q.act(R(q).qm, { type: 'qm-auto' });
  toVote(q);
  assert.equal(q.act(R(q).qm, { type: 'vote', target: R(q).artists[0] }), false, 'the QM does not vote');
  assert.equal(q.view(R(q).qm).vote.canVote, false);
  assert.equal(q.view(R(q).qm).vote.total, 4);
  assert.deepEqual(R(q).vote.candidates, R(q).artists, 'the QM is not a candidate');
});

test('fake-artist: a stalled voter is abstained by the host; abstentions are flagged and never convict', () => {
  const sim = toVote(mk(5, { seed: 6 }));
  const [a, b, c, d, e] = R(sim).artists;
  const F = R(sim).fake;
  assert.deepEqual(engine.autoAct(clone(sim.state), a, sim.ctx()), { type: 'vote', target: null });
  assert.ok(sim.act(a, { type: 'vote', target: null }), 'an abstention is accepted');
  assert.equal(sim.view(a).vote.myVote, null);
  for (const x of [b, c, d]) sim.act(x, { type: 'vote', target: other(R(sim).vote.candidates, x) === x ? e : other(R(sim).vote.candidates.filter((y) => y !== x), x) });
  assert.equal(phase(sim), 'vote');
  sim.host({ type: ACT.NEXT });                                     // acknowledge the narration line…
  if (phase(sim) === 'vote') sim.host({ type: ACT.NEXT });          // …then force the missing ballot
  assert.equal(phase(sim), 'tally');
  assert.deepEqual(R(sim).tally1.abstained.sort(), [a, e].sort());
  assert.ok(sim.view(a).tally.round1.abstained.length === 2);
  // nobody pointed at the fake at all: not caught
  const none = toVote(mk(5, { seed: 6 }));
  for (const x of R(none).artists) none.act(x, { type: 'vote', target: null });
  assert.equal(phase(none), 'tally');
  assert.deepEqual(R(none).tally1.top, []);
  assert.equal(R(none).caught, false);
  assert.ok(!['guess', 'judge'].includes(phase(settle(none))));
  assert.equal(none.view(null).reveal.outcome, 'escaped');
  assert.ok(F);
});

// ---------- the tie rules, exhaustively ----------

/** Independent oracle for a round-1 ballot. → 'caught' | 'free' | 'revote' */
function oracle(rule, votes, F, artists) {
  const counts = {};
  for (const t of Object.values(votes)) if (t != null) counts[t] = (counts[t] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  const top = Object.keys(counts).filter((k) => counts[k] === max);
  if (!top.length) return 'free';
  if (top.length === 1) return top[0] === F ? 'caught' : 'free';
  if (!top.includes(F)) return 'free';
  if (rule === 'escape') return 'free';
  if (rule === 'revote') return artists.some((a) => !top.includes(a)) ? 'revote' : 'caught';
  return 'caught';
}

function* assignments(voters, candidates) {
  const pick = (i, acc) => {
    if (i === voters.length) return [acc];
    const out = [];
    for (const c of candidates) if (c !== voters[i]) out.push(...pick(i + 1, { ...acc, [voters[i]]: c }));
    return out;
  };
  yield* pick(0, {});
}

for (const rule of ['must-guess', 'escape', 'revote']) {
  test(`fake-artist: tie rule ${rule} — every possible ballot with 4 artists, fake anywhere, matches the rulebook oracle`, () => {
    const base = toVote(mk(4, { seed: 8, config: { tieRule: rule } }));
    const artists = R(base).artists;
    let seen = 0;
    const shapes = new Set();
    for (const F of artists) {
      for (const votes of assignments(artists, artists)) {
        const st = clone(base.state);
        st.round.fake = F;
        let s = st;
        for (const [pid, target] of Object.entries(votes)) s = engine.act(s, { pid, action: { type: 'vote', target } }, base.ctx()) ?? s;
        assert.equal(s.phase, 'tally', 'all ballots in → the tally');
        const want = oracle(rule, votes, F, artists);
        const got = s.round.revotePending ? 'revote' : s.round.caught ? 'caught' : 'free';
        assert.equal(got, want, `${rule} fake=${F} votes=${JSON.stringify(votes)}`);
        // the tally linger then leads to the right next phase
        const after = engine.advance(s, { ...base.ctx(), now: s.deadline });
        assert.equal(after.phase, { caught: 'guess', free: 'result', revote: 'revote' }[want], `${rule}: next phase`);
        const counts = Object.values(s.round.tally1.counts).sort().join('');
        shapes.add(counts);
        seen++;
      }
    }
    assert.equal(seen, 4 * 81);
    // with 4 artists a vote can never be 4-0 (nobody votes for themselves): only 3-1, 2-2, 2-1-1, 1-1-1-1 (and 3-... shapes)
    for (const s of shapes) assert.ok(['13', '22', '112', '1111', '13'].includes(s) || /^[1-3]+$/.test(s), `shape ${s}`);
    assert.ok(![...shapes].some((s) => s.includes('4')), '4-0 is impossible');
  });
}

test('fake-artist: tie rule oracle also holds with 5 and 6 artists (sampled ballots)', () => {
  const rng = mulberry32(99);
  for (const n of [5, 6]) {
    for (const rule of ['must-guess', 'escape', 'revote']) {
      const base = toVote(mk(n, { seed: 12, config: { tieRule: rule } }));
      const artists = R(base).artists;
      for (let i = 0; i < 400; i++) {
        const votes = {};
        for (const a of artists) { const cands = artists.filter((x) => x !== a); votes[a] = cands[Math.floor(rng() * cands.length)]; }
        const F = artists[Math.floor(rng() * artists.length)];
        let s = clone(base.state);
        s.round.fake = F;
        for (const [pid, target] of Object.entries(votes)) s = engine.act(s, { pid, action: { type: 'vote', target } }, base.ctx()) ?? s;
        const want = oracle(rule, votes, F, artists);
        assert.equal(s.round.revotePending ? 'revote' : s.round.caught ? 'caught' : 'free', want, `${n}/${rule}`);
      }
    }
  }
});

test('fake-artist: the v1 booklet example — F=2, two artists 1 each, one 0 (4 artists) — is caught under every tie rule', () => {
  for (const rule of ['must-guess', 'escape', 'revote']) {
    const sim = toVote(mk(4, { seed: 8, config: { tieRule: rule } }));
    const [F, a, b, c] = R(sim).artists;
    sim.state.round.fake = F;
    const votes = { [F]: a, [a]: F, [b]: F, [c]: b };      // F=2, a=1, b=1, c=0
    for (const [pid, target] of Object.entries(votes)) sim.act(pid, { type: 'vote', target });
    assert.equal(R(sim).caught, true, rule);
  }
});

test('fake-artist: must-guess — F in a tie is caught; escape — the same tie frees F; F beaten by a real artist is free under both', () => {
  const setup = (rule) => { const s = toVote(mk(5, { seed: 8, config: { tieRule: rule } })); return [s, ...R(s).artists]; };
  for (const [rule, caught] of [['must-guess', true], ['escape', false]]) {
    const [sim, F, a, b, c, d] = setup(rule);
    sim.state.round.fake = F;
    // F=2, a=2: a tie at the top that contains the fake
    const votes = { [F]: a, [a]: F, [b]: F, [c]: a, [d]: b };
    for (const [pid, target] of Object.entries(votes)) sim.act(pid, { type: 'vote', target });
    assert.deepEqual(R(sim).tally1.top.sort(), [F, a].sort());
    assert.equal(R(sim).caught, caught, rule);
  }
  for (const rule of ['must-guess', 'escape']) {
    const [sim, F, a, b, c, d] = setup(rule);
    sim.state.round.fake = F;
    const votes = { [F]: a, [a]: b, [b]: a, [c]: F, [d]: a };    // a=3, F=1: a real artist leads
    for (const [pid, target] of Object.entries(votes)) sim.act(pid, { type: 'vote', target });
    assert.equal(R(sim).caught, false, rule);
  }
  // F matches a LOWER real artist's count but neither is at the top: not caught
  const [sim, F, a, b, c, d] = setup('must-guess');
  sim.state.round.fake = F;
  const votes = { [F]: b, [a]: b, [b]: a, [c]: F, [d]: a };     // b=2, a=2, F=1, c=0, d=0 → top = a,b (F not in it)
  for (const [pid, target] of Object.entries(votes)) sim.act(pid, { type: 'vote', target });
  assert.deepEqual(R(sim).tally1.top.sort(), [a, b].sort());
  assert.equal(R(sim).caught, false);
});

test('fake-artist: revote — only the artists outside the tie vote, only among the tied; every second ballot is checked against the oracle', () => {
  const base = toVote(mk(5, { seed: 8, config: { tieRule: 'revote' } }));
  const artists = R(base).artists;
  let revotes = 0;
  for (const F of artists) {
    for (const votes of assignments(artists, artists)) {
      const w = oracle('revote', votes, F, artists);
      if (w !== 'revote') continue;
      revotes++;
      if (revotes % 11 !== 0) continue;                             // a spread of cases, not all 1024 x 5
      let s = clone(base.state);
      s.round.fake = F;
      for (const [pid, target] of Object.entries(votes)) s = engine.act(s, { pid, action: { type: 'vote', target } }, base.ctx()) ?? s;
      assert.equal(s.phase, 'tally');
      assert.equal(s.round.caught, null, 'undecided until the second ballot');
      s = engine.advance(s, { ...base.ctx(), now: s.deadline });
      assert.equal(s.phase, 'revote');
      const top = s.round.tally1.top;
      assert.deepEqual(s.round.vote.candidates.slice().sort(), top.slice().sort());
      assert.deepEqual(s.round.vote.voters.slice().sort(), artists.filter((a) => !top.includes(a)).sort());
      // a tied player cannot vote; a voter cannot pick outside the tie
      const tied = top[0];
      assert.equal(engine.act(clone(s), { pid: tied, action: { type: 'vote', target: top[1] } }, base.ctx()).round.vote.votes[tied], undefined);
      const voter = s.round.vote.voters[0];
      const outsider = s.round.vote.voters[1] ?? voter;
      assert.equal(engine.act(clone(s), { pid: voter, action: { type: 'vote', target: outsider } }, base.ctx()).round.vote.votes[voter], undefined, 'not one of the tied');
      // every possible second ballot
      const voters = s.round.vote.voters;
      const combos = voters.reduce((acc, v) => acc.flatMap((m) => top.map((t) => ({ ...m, [v]: t }))), [{}]);
      for (const second of combos) {
        let s2 = clone(s);
        for (const [pid, target] of Object.entries(second)) s2 = engine.act(s2, { pid, action: { type: 'vote', target } }, base.ctx()) ?? s2;
        assert.equal(s2.phase, 'tally');
        const counts = {};
        for (const t of Object.values(second)) counts[t] = (counts[t] || 0) + 1;
        const max = Math.max(...Object.values(counts));
        const winners = Object.keys(counts).filter((k) => counts[k] === max);
        const wantCaught = winners.length === 1 ? winners[0] === F : true;      // a second tie falls back to must-guess
        assert.equal(s2.round.caught, wantCaught, `second ballot ${JSON.stringify(second)}`);
        assert.equal(s2.round.revotePending, false);
        assert.equal(s2.round.tally2.round, 2);
      }
    }
  }
  assert.ok(revotes > 100, 'the enumeration found plenty of ties');
});

test('fake-artist: revote when everybody is tied (nobody left to vote) falls back to must-guess', () => {
  const sim = toVote(mk(4, { seed: 8, config: { tieRule: 'revote' } }));
  const artists = R(sim).artists;
  // a 4-cycle: everybody gets exactly one vote, so all four are at the top
  artists.forEach((a, i) => sim.act(a, { type: 'vote', target: artists[(i + 1) % 4] }));
  assert.deepEqual(R(sim).tally1.top.length, 4);
  assert.equal(R(sim).revotePending, false);
  assert.equal(R(sim).caught, true);
  assert.equal(settle(sim) && phase(sim), 'guess');
});

test('fake-artist: revote — the screens and cues of the second ballot', () => {
  const sim = toVote(mk(5, { seed: 8, config: { tieRule: 'revote' } }));
  const [F, a, b, c, d] = R(sim).artists;
  sim.state.round.fake = F;
  for (const [pid, target] of Object.entries({ [F]: a, [a]: F, [b]: F, [c]: a, [d]: b })) sim.act(pid, { type: 'vote', target });
  assert.equal(sim.view(b).tally.revote, true);
  assert.equal(sim.view(b).tally.caught, null);
  assert.equal(sim.view(b).fake, null, 'the fake is not named while the second ballot is pending');
  assert.match(sim.cue().text, /再投一次/);
  settle(sim);
  assert.equal(phase(sim), 'revote');
  assert.equal(sim.cue().text.includes('平票'), true);
  const vb = sim.view(b).vote;
  assert.deepEqual([vb.round, vb.canVote, vb.total], [2, true, 3]);
  assert.equal(sim.view(F).vote.canVote, false, 'the tied do not vote again');
  assert.deepEqual(sim_focus(sim).sort(), [b, c, d].sort());
  for (const x of [b, c, d]) sim.act(x, { type: 'vote', target: a });
  assert.equal(R(sim).caught, false, 'a unique non-fake winner frees the fake');
  assert.equal(sim.view(null).tally.round2.top[0], a);
  settle(sim);
  assert.equal(phase(sim), 'result');
  assert.ok(sim.view(null).reveal.lines.some((l) => /再投/.test(l)));
});

// ============================================================
// the guess
// ============================================================

test('fake-artist: spoken guess — only the judge rules; the QM is the judge in player mode; the word never reaches the fake', () => {
  const sim = qmSim(5, 3);
  const qm = R(sim).qm;
  sim.act(qm, { type: 'qm-set', theme: '動物', word: '大象' });
  toVote(sim);
  const F = R(sim).fake;
  allVote(sim, F);
  settle(sim);
  assert.equal(phase(sim), 'guess');
  assert.equal(R(sim).judge, qm);
  assert.deepEqual(sim_focus(sim), [qm]);
  assert.equal(sim.view(qm).guess.word, '大象');
  assert.equal(sim.view(qm).guess.canJudge, true);
  for (const a of R(sim).artists) {
    const v = sim.view(a);
    assert.equal(v.guess.word, undefined, 'only the judge gets the word on this screen');
    assert.equal(v.guess.canJudge, false);
    assert.equal(v.fake, F, 'the caught fake is public');
    assert.equal(sim.act(a, { type: 'verdict', correct: true }), false, 'an artist cannot rule');
    assert.equal(sim.act(a, { type: 'guess', text: '大象' }), false, 'spoken mode has no typing');
  }
  assert.ok(!JSON.stringify(sim.view(F)).includes('大象'), 'the fake’s view never holds the word before the guess is locked');
  assert.ok(!JSON.stringify(sim.view(null)).includes('大象'));
  assert.equal(sim.act(qm, { type: 'verdict', correct: 'yes' }), false);
  assert.ok(sim.act(qm, { type: 'verdict', correct: true }));
  assert.equal(phase(sim), 'result');
  assert.equal(R(sim).rv.outcome, 'guess-right');
  assert.equal(sim.act(qm, { type: 'verdict', correct: false }), false, 'exactly one guess');
  assert.ok(JSON.stringify(sim.view(F)).includes('大象'), 'after the verdict the word is public');
});

test('fake-artist: app QM — the judge is the host seat (a real artist), else the next artist after the fake', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const sim = setupRaw(5, { seed, hostPid: 'p2' });
    toVote(sim);
    const F = R(sim).fake;
    allVote(sim, F);
    settle(sim);
    const j = R(sim).judge;
    assert.notEqual(j, F);
    if (F !== 'p2') assert.equal(j, 'p2', 'the host judges');
    else assert.equal(j, R(sim).artists[(R(sim).artists.indexOf(F) + 1) % 5], 'the host is the fake: the next artist judges');
  }
  const noHost = setupRaw(5, { seed: 2 });
  toVote(noHost);
  allVote(noHost, R(noHost).fake);
  settle(noHost);
  assert.notEqual(R(noHost).judge, R(noHost).fake, 'without a known host a real artist still judges');
});

test('fake-artist: typed guess — an exact word or alias (spacing, case, width, punctuation ignored) is right on the spot', () => {
  for (const [text, right] of [['詞語07', true], ['別名07', true], [' 詞語07 ', true], ['詞語０７', true], ['詞語07！', true], ['詞 語 07', true], ['詞語08', false], ['詞語', false], ['詞語077', false], ['', false]]) {
    const sim = mk(5, { seed: 2, config: { guess: 'typed' } });
    R(sim).word; sim.state.round.word = '詞語07'; sim.state.round.alt = ['別名07'];
    toVote(sim);
    const F = R(sim).fake;
    allVote(sim, F);
    settle(sim);
    assert.equal(phase(sim), 'guess');
    assert.deepEqual(sim_focus(sim), [F], 'the fake is the one to act');
    assert.equal(sim.view(F).guess.canGuess, true);
    assert.equal(sim.act(other(R(sim).artists, F), { type: 'guess', text }), false, 'only the fake types');
    sim.act(F, { type: 'guess', text });
    if (text === '') assert.equal(R(sim).rv.outcome, 'guess-wrong', 'no answer is wrong');
    else if (right) { assert.equal(phase(sim), 'result'); assert.equal(R(sim).rv.outcome, 'guess-right'); assert.equal(R(sim).rv.guess.by, 'match'); }
    else assert.equal(phase(sim), 'judge', `「${text}」 is not the same words: the judge decides`);
  }
});

test('fake-artist: typed guess that does not match — the judge sees it and may overrule (synonyms), once', () => {
  const sim = mk(5, { seed: 2, config: { guess: 'typed' } });
  sim.state.round.word = '詞語07'; sim.state.round.alt = [];
  toVote(sim);
  const F = R(sim).fake;
  allVote(sim, F);
  settle(sim);
  sim.act(F, { type: 'guess', text: '近義詞' });
  assert.equal(phase(sim), 'judge');
  assert.equal(sim.act(F, { type: 'guess', text: '詞語07' }), false, 'one guess only');
  const j = R(sim).judge;
  assert.equal(sim.view(j).guess.canJudge, true);
  assert.equal(sim.view(j).guess.text, '近義詞');
  assert.equal(sim.view(j).guess.word, '詞語07');
  assert.equal(sim.view(F).guess.word, undefined);
  assert.ok(!JSON.stringify(sim.view(F)).includes('詞語07'));
  assert.equal(sim.view(other(R(sim).artists, j)).guess.text, '近義詞', 'the guess itself is public');
  assert.equal(sim.act(F, { type: 'verdict', correct: true }), false, 'the fake cannot rule on their own guess');
  assert.deepEqual(sim_focus(sim), [j]);
  assert.ok(sim.act(j, { type: 'verdict', correct: true }));
  assert.equal(R(sim).rv.outcome, 'guess-right');
  assert.equal(R(sim).rv.guess.by, 'judge');
  assert.equal(R(sim).rv.guess.text, '近義詞');
  assert.equal(sim.view(null).reveal.guess.text, '近義詞');
});

test('fake-artist: a stalled guess / judge is settled by the host as wrong (never hands the fake a win)', () => {
  const spoken = toVote(mk(5, { seed: 2 }));
  allVote(spoken, R(spoken).fake);
  settle(spoken);
  assert.deepEqual(engine.autoAct(clone(spoken.state), R(spoken).judge, spoken.ctx()), { type: 'verdict', correct: false });
  assert.equal(engine.autoAct(clone(spoken.state), R(spoken).fake, spoken.ctx()), null);
  spoken.host({ type: ACT.NEXT });
  if (phase(spoken) === 'guess') spoken.host({ type: ACT.NEXT });
  assert.equal(R(spoken).rv.outcome, 'guess-wrong');
  assert.equal(R(spoken).rv.guess.by, 'auto');

  const typed = toVote(mk(5, { seed: 2, config: { guess: 'typed' } }));
  allVote(typed, R(typed).fake);
  settle(typed);
  assert.deepEqual(engine.autoAct(clone(typed.state), R(typed).fake, typed.ctx()), { type: 'guess', text: '' });
  typed.act(R(typed).fake, { type: 'guess', text: '' });
  assert.equal(R(typed).rv.outcome, 'guess-wrong');
  assert.equal(R(typed).rv.guess.by, 'none');
  const t2 = toVote(mk(5, { seed: 2, config: { guess: 'typed' } }));
  allVote(t2, R(t2).fake);
  settle(t2);
  t2.act(R(t2).fake, { type: 'guess', text: '近義詞' });
  assert.deepEqual(engine.autoAct(clone(t2.state), R(t2).judge, t2.ctx()), { type: 'verdict', correct: false });
});

test('fake-artist: not caught — there is no guess phase at all and the fake stays hidden until the round result', () => {
  const sim = toVote(mk(5, { seed: 2 }));
  const F = R(sim).fake;
  const real = R(sim).artists.filter((a) => a !== F);
  voteWith(sim, (a) => (a === real[0] ? real[1] : real[0]));
  assert.equal(R(sim).caught, false);
  assert.equal(sim.view(real[2]).fake, null, 'still unnamed on the tally screen');
  assert.ok(!JSON.stringify(sim.view(real[2]).tally).includes(`"caught":true`));
  settle(sim);
  assert.equal(phase(sim), 'result');
  assert.equal(sim.view(real[2]).fake, F);
  assert.equal(sim.view(real[2]).reveal.guess, null);
  assert.equal(sim.view(real[2]).reveal.outcome, 'escaped');
});

// ============================================================
// scoring and the end of the game
// ============================================================

test('fake-artist: points-v1 — fake +2 and QM +2 when not caught or guessed right; every real artist +1 when the guess is wrong', () => {
  for (const guess of ['spoken', 'typed']) {
    // app QM: there is no QM share
    let sim = mk(5, { seed: 3, config: { guess } });
    let F = null;
    playRound(sim, { caught: false });
    F = sim.state.history[0].fake;
    assert.deepEqual(Object.fromEntries(Object.entries(sim.state.scores).filter(([, v]) => v)), { [F]: 2 }, `${guess}: escaped`);
    assert.equal(sim.view(null).reveal.outcome, 'escaped');
    assert.equal(sum(sim.state.scores), 2, 'there is no QM to share it with');

    sim = mk(5, { seed: 3, config: { guess } });
    playRound(sim, { caught: true, correct: true });
    F = sim.state.history[0].fake;
    assert.equal(sim.state.scores[F], 2, `${guess}: caught but guessed right`);
    assert.equal(sum(sim.state.scores), 2);
    assert.equal(sim.view(null).reveal.outcome, 'guess-right');

    sim = mk(5, { seed: 3, config: { guess } });
    playRound(sim, { caught: true, correct: false });
    F = sim.state.history[0].fake;
    assert.equal(sim.state.scores[F], 0);
    for (const a of ids(sim).filter((x) => x !== F)) assert.equal(sim.state.scores[a], 1, `${guess}: artist ${a}`);
    assert.equal(sim.view(null).reveal.outcome, 'guess-wrong');

    // player QM: the QM shares the fake's two points; the QM scores nothing when the artists win
    for (const [caught, correct, want] of [[false, false, 'fake'], [true, true, 'fake'], [true, false, 'artists']]) {
      sim = mk(5, { seed: 3, config: { guess, qm: 'player' } });
      const qm = R(sim).qm;
      playRound(sim, { caught, correct });
      F = sim.state.history[0].fake;
      if (want === 'fake') {
        assert.equal(sim.state.scores[F], 2, `${guess} qm fake`);
        assert.equal(sim.state.scores[qm], 2, `${guess} qm shares`);
        assert.equal(sum(sim.state.scores), 4);
      } else {
        assert.equal(sim.state.scores[qm], 0);
        assert.equal(sim.state.scores[F], 0);
        for (const a of R(sim).artists.filter((x) => x !== F)) assert.equal(sim.state.scores[a], 1);
        assert.equal(sum(sim.state.scores), 3, 'three real artists');
      }
    }
  }
});

test('fake-artist: points-v1 — when the artists win, EVERY real artist scores, also one who pointed at the wrong person (p.7 chart, not the house rule)', () => {
  for (const qm of ['app', 'player']) {
    const sim = toVote(mk(6, { seed: 21, config: { qm, first: 'auto' } }));
    const F = R(sim).fake;
    const real = R(sim).artists.filter((a) => a !== F);
    const stray = real[0];
    // everybody points at F except `stray`, who points at another real artist; F still has the most votes
    voteWith(sim, (a) => (a === F ? real[1] : a === stray ? real[1] : F));
    settle(sim);
    assert.equal(R(sim).caught, true);
    sim.act(R(sim).judge, { type: 'verdict', correct: false });
    for (const a of real) assert.equal(sim.state.scores[a], 1, `${qm}: ${a}${a === stray ? ' (voted wrong)' : ''}`);
    assert.equal(sim.state.scores[F], 0);
    if (R(sim).qm) assert.equal(sim.state.scores[R(sim).qm], 0);
  }
});

test('fake-artist: the fake and the QM are different players, one player never gets two awards, scores never decrease', () => {
  const sim = mk(6, { seed: 5, config: { qm: 'player', endMode: 'rounds', rounds: 12 } });
  let prev = clone(sim.state.scores);
  for (let i = 0; i < 12; i++) {
    const { qm } = R(sim);
    playRound(sim, { caught: i % 2 === 0, correct: i % 3 === 0 });
    const h = sim.state.history[i];
    assert.notEqual(h.fake, qm);
    assert.equal(new Set(h.deltas.map((d) => d.pid)).size, h.deltas.length, 'one award each');
    for (const [id, v] of Object.entries(sim.state.scores)) assert.ok(v >= prev[id]);
    prev = clone(sim.state.scores);
    allNext(sim);
  }
  assert.equal(phase(sim), 'over');
});

test('fake-artist: first to the target wins — checked after the round is scored; overshoot is legal; co-winners share', () => {
  const sim = mk(5, { seed: 3, config: { target: 5 } });
  let rounds = 0;
  while (phase(sim) !== 'over' && rounds < 60) {
    playRound(sim, { caught: rounds % 2 === 1, correct: false });
    rounds++;
    const top = Math.max(...Object.values(sim.state.scores));
    assert.equal(sim.view('p1').last, top >= 5, 'the last-round flag follows the target');
    assert.equal(phase(sim), 'result');
    allNext(sim);
    if (top < 5) assert.notEqual(phase(sim), 'over');
  }
  assert.equal(phase(sim), 'over');
  const res = sim.result();
  const top = Math.max(...Object.values(sim.state.scores));
  assert.ok(top >= 5);
  assert.deepEqual(res.winners, ids(sim).filter((id) => sim.state.scores[id] === top));
  assert.deepEqual(res.points, sim.state.scores);
  assert.ok(res.summary.includes(String(top)));

  // 4 + 2 = 6 is legal: engineer a score of 4 and an escape
  const o = mk(5, { seed: 3, config: { target: 5 } });
  for (const id of ids(o)) o.state.scores[id] = 0;
  o.state.scores[R(o).fake] = 4;
  playRound(o, { caught: false });
  assert.equal(o.state.scores[o.state.history[0].fake], 6);
  assert.equal(o.state.ending, true);

  // two players crossing in the same round: highest total wins, equal totals share
  const t = mk(5, { seed: 3, config: { target: 5 } });
  for (const id of ids(t)) t.state.scores[id] = 4;
  playRound(t, { caught: true, correct: false });         // every real artist +1 → five of them... the fake stays on 4
  allNext(t);
  assert.equal(phase(t), 'over');
  const r = t.result();
  const F = t.state.history[0].fake;
  assert.ok(!r.winners.includes(F));
  assert.equal(r.winners.length, 4, 'the four real artists crossed together and share the win');
  assert.match(r.summary, /同分奪冠/);
});

test('fake-artist: endMode rounds — exactly N rounds (auto = one per player), highest total wins, target is ignored', () => {
  const auto = mk(4, { seed: 3, config: { endMode: 'rounds', rounds: 0, target: 1 } });
  assert.equal(auto.state.totalRounds, 4);
  let played = 0;
  while (phase(auto) !== 'over') { playRound(auto, { caught: true, correct: false }); played++; allNext(auto); }
  assert.equal(played, 4, 'a target of 1 does not end a rounds game');
  const three = mk(5, { seed: 3, config: { endMode: 'rounds', rounds: 3 } });
  played = 0;
  while (phase(three) !== 'over') {
    assert.equal(three.view('p1').round.total, 3);
    assert.match(three.view('p1').title, /\/3 輪/);
    playRound(three, { caught: false });
    played++;
    assert.equal(three.view('p1').last, played === 3);
    allNext(three);
  }
  assert.equal(played, 3);
  assert.equal(three.result().lines.filter((l) => l.startsWith('第 ')).length, 3);
});

test('fake-artist: result lines explain every round, including what was hidden during play', () => {
  const sim = mk(5, { seed: 5, config: { endMode: 'rounds', rounds: 2 } });
  playRound(sim, { caught: false });
  const w1 = R(sim).word;
  const f1 = R(sim).fake;
  allNext(sim);
  playRound(sim, { caught: true, correct: false });
  const w2 = R(sim).word;
  const f2 = R(sim).fake;
  const name = (id) => sim.players.find((p) => p.id === id).name;
  assert.ok(sim.view('p1').reveal.lines.length >= 4, 'the reveal explains how it went');
  allNext(sim);
  const res = sim.result();
  const [l1, why1, l2, why2] = res.lines;
  assert.ok(l1.includes('第 1/2 輪') && l1.includes(w1) && l1.includes(name(f1)) && l1.includes('假畫家逃脫') && l1.includes(`${name(f1)} +2`), l1);
  assert.ok(why1.includes('投票：') && why1.includes('最高票唔係假畫家'), `why round 1 went so: ${why1}`);
  assert.ok(l2.includes('第 2/2 輪') && l2.includes(w2) && l2.includes(name(f2)) && l2.includes('真畫家贏'), l2);
  assert.ok(why2.includes('揪到') && why2.includes('錯'), `why round 2 went so: ${why2}`);
  assert.ok(!why1.startsWith('第 ') && !why2.startsWith('第 '));
  assert.ok(res.lines.some((l) => l.includes('最醒目')));
  const rv = clone(sim.state.history[1]);
  assert.equal(rv.outcome, 'guess-wrong');
});

test('fake-artist: the reveal object lists the whole round — word, theme, fake, QM, ballots, guess, points, strokes in order', () => {
  const sim = mk(5, { seed: 5, config: { qm: 'player' } });
  const qm = R(sim).qm;
  playRound(sim, { caught: true, correct: false });
  const rv = sim.view(qm).reveal;
  assert.equal(rv.word, R(sim).word);
  assert.equal(rv.theme, R(sim).theme);
  assert.equal(rv.fake, R(sim).fake);
  assert.equal(rv.qm, qm);
  assert.equal(rv.winner ?? rv.fakeSide, false);
  assert.equal(rv.guess.correct, false);
  assert.equal(rv.round1.top[0], rv.fake);
  assert.equal(rv.turns.length, 8);
  assert.deepEqual(rv.turns.map((t) => t.pid), [...R(sim).turnOrder, ...R(sim).turnOrder]);
  assert.ok(rv.deltas.every((d) => d.role === 'artist' && d.delta === 1));
  assert.ok(rv.lines[0].includes('真畫家贏'));
  assert.deepEqual(sim.view(R(sim).artists[0]).reveal, rv, 'everyone sees the same reveal');
  assert.deepEqual(sim.view(null).reveal, rv);
});

// ============================================================
// views, privacy, hints, cues, focus
// ============================================================

/** Edit a secret and compare what the seats that are NOT entitled to it can see. */
function privacyCheck(sim) {
  const st = sim.state;
  const r = st.round;
  const order = ids(sim);
  const pre = r.caught !== true && !['result', 'over'].includes(st.phase);
  if (pre && r.artists.length > 3) {
    // 1. the fake's identity: swap it, every seat that is neither old fake, new fake nor the QM sees exactly the same
    const newFake = r.artists.find((a) => a !== r.fake && a !== r.judge) ?? r.artists.find((a) => a !== r.fake);
    const alt = clone(st);
    alt.round.fake = newFake;
    for (const pid of [...order, null, 'late-joiner']) {
      if (pid === r.fake || pid === newFake || pid === r.qm) continue;
      assert.equal(JSON.stringify(engine.view(alt, pid)), JSON.stringify(engine.view(st, pid)), `${st.phase}: ${pid}'s view depends on who the fake is`);
    }
    assert.equal(JSON.stringify(engine.cue(alt)), JSON.stringify(engine.cue(st)), `${st.phase}: the narration depends on who the fake is`);
  }
  if (!['result', 'over'].includes(st.phase) && st.phase !== 'qm-input') {
    // 2. the word: swap it, the fake and the table see exactly the same until the guess is locked
    const alt = clone(st);
    alt.round.word = '〇〇完全唔同〇〇';
    alt.round.alt = ['別名之外'];
    for (const pid of [r.fake, null, 'late-joiner']) {
      assert.equal(JSON.stringify(engine.view(alt, pid)), JSON.stringify(engine.view(st, pid)), `${st.phase}: ${pid ?? 'the table'} can see the word`);
    }
    assert.equal(JSON.stringify(engine.cue(alt)), JSON.stringify(engine.cue(st)), `${st.phase}: the narration says the word`);
    if (r.qm) {
      // the QM entry only the QM sees
      for (const pid of order) {
        if (pid === r.qm) continue;
        assert.equal(engine.view(st, pid).draft, null);
      }
    }
  }
  for (const pid of [...order, null]) {
    const v = engine.view(st, pid);
    JSON.parse(JSON.stringify(v));
    if (pid !== r.qm && !['result', 'over'].includes(st.phase)) assert.equal(v.mine?.fake, undefined, 'only the QM carries the fake’s id in mine');
    if (pid !== null && st.phase !== 'result' && st.phase !== 'over' && v.vote && !v.vote.canVote && v.vote.myVote === undefined) {
      assert.ok(!('myVote' in v.vote));
    }
    // nobody else's ballot before the tally
    if (['vote', 'revote'].includes(st.phase)) {
      const ballots = JSON.stringify(v).match(/"votes"/g);
      assert.equal(ballots, null, 'no ballots in views during voting');
    }
  }
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(st)), 'state is plain JSON');
}

for (const [label, cfg] of [
  ['phone + app QM', { draw: 'phone', qm: 'app' }],
  ['paper + app QM', { draw: 'paper', qm: 'app' }],
  ['phone + player QM', { draw: 'phone', qm: 'player' }],
  ['paper + player QM, typed guess, revote', { draw: 'paper', qm: 'player', guess: 'typed', tieRule: 'revote' }],
]) {
  test(`fake-artist: privacy — the fake, the word and the ballots do not leak through any view or cue (${label})`, () => {
    for (const n of [5, 7]) {
      for (let seed = 1; seed <= 5; seed++) {
        const sim = mk(n, { seed: seed * 17 + n, config: { ...cfg, target: 3 } });
        privacyCheck(sim);
        sim.runRandom({ onStep: privacyCheck });
      }
    }
  });
}

test('fake-artist: views are whitelisted — no engine internals in anyone’s view', () => {
  const sim = mk(5, { seed: 5 });
  const FORBIDDEN = ['acks', 'draftSeq', 'tally1', 'tally2', 'next', 'revotePending', 'alt', 'lastFake', 'qmPtr', 'cueAck', 'history', 'stats', 'cfg', 'players'];
  const check = (s) => {
    for (const pid of [...ids(s), null]) {
      const walk = (o, path) => {
        if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { assert.ok(!FORBIDDEN.includes(k), `${path}.${k} in ${s.state.phase}`); walk(v, `${path}.${k}`); }
      };
      walk(s.view(pid), `view(${pid})`);
    }
  };
  check(sim);
  sim.runRandom({ onStep: check });
});

test('fake-artist: U1 — every phase has a short hint for every seat and spectators, role-neutral before the fake is named', () => {
  const phases = new Set();
  for (const [n, qm, draw, guess, tie] of [[5, 'app', 'phone', 'spoken', 'must-guess'], [5, 'player', 'paper', 'typed', 'revote'], [7, 'app', 'paper', 'spoken', 'revote'], [6, 'player', 'phone', 'typed', 'must-guess']]) {
    for (let seed = 1; seed <= 8; seed++) {
      const sim = mk(n, { seed: seed * 31 + n, config: { qm, draw, guess, tieRule: tie, target: 3 } });
      const check = (s) => {
        const st = s.state;
        phases.add(st.phase);
        const r = st.round;
        const alt = clone(st);
        const newFake = r.artists.find((a) => a !== r.fake);
        alt.round.fake = newFake;
        const pre = r.caught !== true && !['result', 'over'].includes(st.phase);
        for (const pid of [...ids(s), null, 'late-joiner']) {
          const hint = engine.view(st, pid).hint;
          assert.ok(typeof hint === 'string' && hint.length > 0 && Array.from(hint).length <= 40, `${st.phase}: ${hint}`);
          if (pre && pid !== r.fake && pid !== newFake) assert.equal(engine.view(alt, pid).hint, hint, `hint for ${pid} in ${st.phase} depends on the fake`);
        }
      };
      check(sim);
      sim.runRandom({ onStep: check });
    }
  }
  for (const ph of ['qm-input', 'deal', 'first', 'draw', 'vote', 'revote', 'tally', 'guess', 'judge', 'result']) {
    if (ph === 'first') continue;          // covered below
    assert.ok(phases.has(ph), `no hint checked in ${ph}`);
  }
  const sim = mk(5, { seed: 9, config: { draw: 'phone' } });
  readyAll(sim);
  assert.match(sim.view(drawerOf(sim)).hint, /輪到你/);
  assert.match(sim.view(other(ids(sim), drawerOf(sim))).hint, /睇住/);
  const p = mk(5, { seed: 9, config: { draw: 'paper' } });
  readyAll(p);
  assert.match(p.view(drawerOf(p)).hint, /畫完/);
  const f = qmSim(5, 3, { first: 'qm' });
  f.act(R(f).qm, { type: 'qm-auto' });
  readyAll(f);
  assert.equal(phase(f), 'first');
  assert.ok(f.view(R(f).qm).hint.length > 0);
});

test('fake-artist: narration cues — unique ids, public facts only, never the word before the result, ack + next semantics', () => {
  for (const cfg of [{ draw: 'phone' }, { draw: 'paper', qm: 'player' }]) {
    const sim = mk(5, { seed: 7, config: { ...cfg, endMode: 'rounds', rounds: 2 } });
    const seen = new Set();
    let steps = 0;
    const onStep = (s) => {
      const c = s.cue();
      if (!c) return;
      assert.ok(c.id && c.text && c.minMs > 0, JSON.stringify(c));
      if (R(s).word && s.state.phase !== 'result') assert.ok(!c.text.includes(R(s).word), `${s.state.phase}: the cue says the word`);
      assert.ok(!/[✕🕶️]/.test(c.text), 'spoken text has no symbols');
      seen.add(c.id);
      steps++;
    };
    onStep(sim);
    sim.runRandom({ onStep });
    assert.ok(steps > 20 && seen.size > 10);
  }
  // ids are unique per step (a turn cue in paper mode, a lap cue in phone mode) and change when the step changes
  const p = mk(4, { seed: 7, config: { draw: 'paper' } });
  readyAll(p);
  const ids1 = [];
  while (phase(p) === 'draw') { const c = p.cue(); if (c) ids1.push(c.id); p.host({ type: ACT.CUE_DONE, id: c?.id }); drawStroke(p); }
  assert.equal(new Set(ids1).size, ids1.length);
  assert.equal(ids1.length, 8, 'paper mode names every turn');
  const ph = mk(4, { seed: 7, config: { draw: 'phone' } });
  readyAll(ph);
  const seenPhone = [];
  while (phase(ph) === 'draw') { const c = ph.cue(); if (c) { seenPhone.push(c.id); ph.host({ type: ACT.CUE_DONE, id: c.id }); } drawStroke(ph); }
  assert.equal(seenPhone.length, 2, 'phone mode: the start of the drawing and the start of lap 2');
  // an ack of a stale id changes nothing; the cue goes away when acked
  const s = mk(4, { seed: 7 });
  const c0 = s.cue();
  assert.equal(s.host({ type: ACT.CUE_DONE, id: 'stale' }), false);
  assert.ok(s.host({ type: ACT.CUE_DONE, id: c0.id }));
  assert.equal(s.cue(), null);
  // the result cue speaks the word (the guess is locked by then)
  const r = mk(5, { seed: 7 });
  playRound(r, { caught: true, correct: false });
  assert.ok(r.cue().text.includes(R(r).word));
});

test('fake-artist: host 下一步 acknowledges the narration first, then moves the step along (never decides a ballot)', () => {
  const sim = mk(5, { seed: 7 });
  assert.equal(phase(sim), 'deal');
  sim.host({ type: ACT.NEXT });
  assert.equal(phase(sim), 'deal', 'the first press only acknowledges the line');
  sim.host({ type: ACT.NEXT });
  assert.equal(phase(sim), 'draw', 'a stalled deal is skipped: everybody counts as having looked');
  assert.ok(R(sim).artists.every((a) => R(sim).acks[a]));
  // tally → skipped to the next phase
  const t = toVote(mk(5, { seed: 7 }));
  allVote(t, R(t).fake);
  assert.equal(phase(t), 'tally');
  t.host({ type: ACT.NEXT });
  if (phase(t) === 'tally') t.host({ type: ACT.NEXT });
  assert.equal(phase(t), 'guess');
  // result → next round
  const rr = mk(5, { seed: 7 });
  playRound(rr, { caught: false });
  assert.equal(phase(rr), 'result');
  rr.host({ type: ACT.NEXT });
  if (phase(rr) === 'result') rr.host({ type: ACT.NEXT });
  assert.notEqual(phase(rr), 'result');
  // unknown host actions and junk are harmless
  assert.equal(sim.host({ type: 'whatever' }), false);
});

test('fake-artist: focus names the seats that must act right now', () => {
  const sim = qmSim(6, 3, { first: 'qm' });
  const qm = R(sim).qm;
  assert.deepEqual(sim_focus(sim), [qm]);
  sim.act(qm, { type: 'qm-auto' });
  assert.deepEqual(sim_focus(sim).sort(), R(sim).artists.slice().sort(), 'everybody has to look at their card');
  sim.act(R(sim).artists[0], { type: 'ready' });
  assert.equal(sim_focus(sim).length, 4);
  readyAll(sim);
  assert.deepEqual(sim_focus(sim), [qm], 'the QM picks the first drawer');
  sim.act(qm, { type: 'first', target: R(sim).artists[1] });
  assert.deepEqual(sim_focus(sim), [drawerOf(sim)]);
  drawAll(sim);
  assert.equal(sim_focus(sim).length, 5);
  allVote(sim, R(sim).fake);
  assert.equal(sim.focus(), null, 'nobody has to do anything while the vote result lingers');
  settle(sim);
  assert.deepEqual(sim_focus(sim), [qm], 'spoken guess: the judge');
  sim.act(qm, { type: 'verdict', correct: false });
  assert.equal(sim.focus(), null);
});

test('fake-artist: legalActions offers exactly what the engine accepts, nothing to spectators and nothing at the end', () => {
  const sim = mk(5, { seed: 11, config: { qm: 'player', guess: 'typed' } });
  let steps = 0;
  const check = (s) => {
    for (const pid of ids(s)) for (const a of s.legal(pid)) {
      const next = engine.act(clone(s.state), { pid, action: a }, s.ctx());
      assert.notEqual(JSON.stringify(next), JSON.stringify(s.state), `${s.state.phase}: ${pid} ${JSON.stringify(a)} changed nothing`);
    }
    assert.deepEqual(s.legal('nobody'), []);
    assert.deepEqual(s.legal(null), []);
    steps++;
  };
  check(sim);
  sim.runRandom({ onStep: check });
  assert.ok(steps > 30);
  for (const pid of ids(sim)) assert.deepEqual(sim.legal(pid), [], 'nothing once over');
});

test('fake-artist: junk actions from the network never throw and never change the state', () => {
  const sim = mk(5, { seed: 3, config: { qm: 'player' } });
  const junk = [undefined, null, 0, 'x', [], {}, { type: 5 }, { type: 'stroke', length: Infinity }, { type: 'stroke', length: [150] }, { type: 'vote', target: { a: 1 } }, { type: 'guess', text: { a: 1 } },
    { type: 'qm-set', theme: {}, word: [] }, { type: '@next' }, { type: '@cue-done', id: 'x' }, { type: 'first', target: 7 }, { type: 'verdict' }, { type: '__proto__' }];
  const pids = [...ids(sim), 'ghost', null, undefined, 5, '@host'];
  for (let round = 0; round < 3; round++) {
    for (const pid of pids) for (const action of junk) {
      const before = JSON.stringify(sim.state);
      let next;
      assert.doesNotThrow(() => { next = engine.act(clone(sim.state), { pid, action }, sim.ctx()); }, `${pid} ${JSON.stringify(action)}`);
      if (pid !== '@host') assert.equal(JSON.stringify(next ?? sim.state), before, `${pid} ${JSON.stringify(action)} changed the state`);
    }
    assert.doesNotThrow(() => engine.act(clone(sim.state), undefined, sim.ctx()));
    assert.doesNotThrow(() => engine.act(clone(sim.state), { pid: 'p1' }, sim.ctx()));
    // move the game on a little between rounds of junk
    if (phase(sim) === 'qm-input') sim.act(R(sim).qm, { type: 'qm-auto' });
    else if (phase(sim) === 'deal') readyAll(sim);
  }
});

// ============================================================
// the shared Session: ink really is accepted only from the drawer, and cleared per round
// ============================================================

test('fake-artist: with the real Session — the drawer inks, nobody else can, the picture is cleared for the next round', () => {
  const players = makePlayers(4);
  const clock = { t: 5000 };
  const session = new Session({
    game, players, config: game.config.defaults(4), rng: mulberry32(5), bag: makeBag(banks, mulberry32(9)), now: () => clock.t,
    timers: { setTimeout: () => 0, clearTimeout: () => {} }, narrationMode: 'silent',
  }).begin();
  const st = () => session.state;
  for (const a of st().round.artists) session.dispatch(a, { type: 'ready' });
  assert.equal(st().phase, 'draw');
  const stroke = (pid, id, end = true) => ({ stroke: id, pts: [[100, 100], [300, 320], [500, 300]], end, color: '#e4573d', width: 9 });
  const d1 = st().round.turnOrder[0];
  const other1 = st().round.turnOrder[1];
  assert.equal(session.ink(other1, stroke(other1, 'x-1')), false, 'not their turn');
  assert.equal(session.ink(d1, stroke(d1, `${d1}-1`)), true);
  assert.equal(session.drawing.strokes.length, 1);
  assert.equal(session.drawing.strokes[0].pid, d1);
  session.dispatch(d1, { type: 'stroke', length: 400 });
  assert.equal(session.ink(d1, stroke(d1, `${d1}-2`)), false, 'one stroke per turn: the turn has moved on');
  assert.equal(session.ink(other1, stroke(other1, `${other1}-1`)), true);
  // paste the rest of the round
  session.dispatch(other1, { type: 'stroke', length: 400 });
  while (st().phase === 'draw') session.dispatch(st().round.turnOrder[st().round.turn % 4], { type: 'stroke', length: 250 });
  assert.equal(st().phase, 'vote');
  assert.equal(session.drawing.strokes.length, 2, 'the drawing is what was inked, not what was reported');
  const F = st().round.fake;
  for (const a of st().round.artists) session.dispatch(a, { type: 'vote', target: a === F ? st().round.artists.find((x) => x !== F) : F });
  clock.t += 5000;
  session.poke();
  session.dispatch('@host', { type: ACT.NEXT });
  if (st().phase === 'tally') session.dispatch('@host', { type: ACT.NEXT });
  assert.equal(st().phase, 'guess');
  session.dispatch(st().round.judge, { type: 'verdict', correct: false });
  assert.equal(st().phase, 'result');
  assert.equal(session.drawing.strokes.length, 2, 'the picture stays for the reveal');
  for (const a of st().round.artists) if (st().phase === 'result') session.dispatch(a, { type: 'next' });
  assert.equal(st().round.n, 2);
  assert.equal(session.drawing.epoch, 2, 'a new round starts a new picture');
  assert.equal(session.drawing.strokes.length, 0);
  const snap = session.snapshot();
  assert.doesNotThrow(() => JSON.stringify(snap));
  const restored = Session.restore(JSON.parse(JSON.stringify(snap)), { game, rng: mulberry32(1), bag: makeBag(banks), now: () => clock.t, timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  assert.equal(restored.state.round.n, 2);
  assert.equal(restored.view('p1').phase, 'deal');
});

// ============================================================
// fuzz — both drawing modes, both QM modes, every head-count
// ============================================================

test('fake-artist: fuzz — random legal play terminates for every head-count, draw mode, QM mode, tie rule and guess mode', () => {
  let games = 0;
  const t0 = Date.now();
  for (let n = game.meta.players[0]; n <= game.meta.players[1]; n++) {
    for (const draw of ['phone', 'paper']) {
      for (const qm of ['app', 'player']) {
        if (qm === 'player' && n < 4) continue;
        for (const tieRule of ['must-guess', 'escape', 'revote']) {
          const guess = (n + tieRule.length) % 2 ? 'typed' : 'spoken';
          for (let seed = 1; seed <= 2; seed++) {
            const config = { ...game.config.defaults(n), draw, qm, tieRule, guess, target: 3, turnSecs: seed === 2 ? 20 : 0, first: qm === 'player' && seed === 1 ? 'qm' : 'auto', antiStreak: seed === 2 };
            const sim = new Sim(game, { n, seed: seed * 1000 + n, config, banks });
            const { result, steps } = sim.runRandom({
              onStep: (s) => {
                const r = s.state.round;
                if (s.state.phase !== 'qm-input') {
                  assert.equal(r.artists.filter((a) => a === r.fake).length, 1, 'exactly one fake');
                  assert.ok(r.artists.includes(r.fake));
                }
                if (r.qm) assert.ok(!r.artists.includes(r.qm));
                assert.ok(Object.values(s.state.scores).every((v) => Number.isInteger(v) && v >= 0));
              },
            });
            assert.ok(result.winners.length >= 1);
            assert.ok(steps > 10);
            games++;
          }
        }
      }
    }
  }
  assert.ok(games > 150, `${games} fuzz games`);
  assert.ok(Date.now() - t0 < 20000, `fuzz finished in ${Date.now() - t0} ms`);
});

test('fake-artist: fuzz on the real bank — full games, every round’s theme/word pair is clean', () => {
  const norm = game.normText;
  for (let seed = 1; seed <= 10; seed++) {
    const n = 3 + (seed % 8);
    const sim = new Sim(game, { n, seed, config: { ...game.config.defaults(n), qm: n >= 4 && seed % 2 ? 'player' : 'app', target: 2 }, banks: { draw: REAL } });
    sim.runRandom({
      onStep: (s) => {
        const r = s.state.round;
        if (!r.word) return;
        assert.ok(!norm(r.theme).includes(norm(r.word)), `${r.theme} names ${r.word}`);
      },
    });
  }
});

// ============================================================
// framework hooks: @void-round, blocking, carry, singleDevice (defaults: see the config tests)
// ============================================================

/** One random step, the way Sim.runRandom moves (but it stops after one). */
function stepRandom(sim) {
  const movers = ids(sim).filter((id) => sim.legal(id).length);
  if (movers.length && sim.rng() < 0.85) {
    const pid = movers[Math.floor(sim.rng() * movers.length)];
    const opts = sim.legal(pid);
    return sim.act(pid, opts[Math.floor(sim.rng() * opts.length)]);
  }
  if (sim.cue() && sim.cueDone()) return true;
  if (sim.state.deadline != null && sim.advance()) return true;
  if (movers.length) return sim.act(movers[0], sim.legal(movers[0])[0]);
  return sim.host({ type: ACT.NEXT });
}

const VOID = { type: ACT.VOID_ROUND };

test('fake-artist: host 呢鋪唔計 (@void-round) — in every phase before the result the round is thrown away, nothing scored, a fresh deal under the same number', () => {
  const voidedIn = new Set();
  for (const cfg of [{ qm: 'app' }, { qm: 'player', first: 'qm', tieRule: 'revote', guess: 'typed' }, { qm: 'player', draw: 'paper', scoring: 'none' }]) {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = mk(5, { seed: seed + 300, config: { ...cfg, endMode: 'rounds', rounds: 3 } });
      for (let i = 0; i < (seed * 7) % 41 && phase(sim) !== 'over'; i++) stepRandom(sim);
      const before = clone(sim.state);
      const changed = sim.host(VOID);
      if (['result', 'over'].includes(before.phase)) {
        assert.equal(changed, false, `${before.phase}: a scored round (or a finished game) is left alone`);
        continue;
      }
      voidedIn.add(before.phase);
      assert.ok(changed, `${before.phase}: voided`);
      const st = sim.state;
      assert.equal(st.roundNo, before.roundNo, 'the same round number again');
      assert.equal(st.round.n, before.round.n);
      assert.equal(st.round.key, before.round.key + 1, 'a new round key (cue ids never repeat)');
      assert.equal(st.round.redo, true);
      assert.deepEqual(st.scores, before.scores, 'nobody scores');
      assert.deepEqual(st.wins, before.wins);
      assert.deepEqual(st.stats, before.stats, 'no stats either');
      assert.equal(st.lastFake, before.lastFake, 'a voided fake does not count for the streak');
      assert.equal(st.inkEpoch, before.inkEpoch + 1, 'a fresh picture');
      const h = st.history[st.history.length - 1];
      assert.equal(h.voided, true);
      assert.equal(h.n, before.round.n);
      assert.equal(h.word, before.round.word || null);
      assert.equal(h.fake, before.round.word ? before.round.fake : null);
      if (before.round.qm) assert.equal(st.round.qm, before.order[before.qmPtr], 'the next question master takes over (a QM whose phone died is replaced)');
      assert.ok(['qm-input', 'deal'].includes(st.phase));
      if (st.phase === 'deal') assert.ok(st.round.artists.includes(st.round.fake) && st.round.word);
      const c = sim.cue();
      assert.ok(c.id.startsWith(`r${st.round.key}:`), c.id);
      assert.match(c.text, /上一鋪唔計/);
      assert.ok(sim.view('p1').round.redo);
      // the game carries on to its normal end: exactly 3 scored rounds, the voided one in the recap
      const { result } = sim.runRandom();
      const scored = sim.state.history.filter((x) => !x.voided);
      assert.equal(scored.length, 3, 'a voided round does not use up one of the rounds');
      assert.deepEqual(scored.map((x) => x.n), [1, 2, 3]);
      const fakeName = h.fake ? sim.players.find((p) => p.id === h.fake).name : '';
      assert.ok(result.lines.some((l) => l.includes('作廢') && (!h.word || (l.includes(h.word) && l.includes(fakeName)))), 'the recap says what the voided round hid');
    }
  }
  for (const ph of ['qm-input', 'deal', 'first', 'draw', 'vote', 'tally', 'guess']) assert.ok(voidedIn.has(ph), `never voided in ${ph}`);
  // seats cannot send it
  const s = mk(4, { seed: 2 });
  assert.equal(s.act('p1', VOID), false, 'only the host');
  assert.equal(s.host({ type: ACT.VOID_ROUND, extra: 1 }), true);
});

test('fake-artist: @void-round through the real Session clears the drawing and re-announces the round', () => {
  const clock = { t: 1000 };
  const cues = [];
  const session = new Session({
    game, players: makePlayers(4), config: game.config.defaults(4), hostPid: 'p1', rng: mulberry32(3), bag: makeBag(banks, mulberry32(4)),
    now: () => clock.t, timers: { setTimeout: () => 0, clearTimeout: () => {} }, narrationMode: 'voice', onCue: (c) => cues.push(c.id),
  }).begin();
  for (const a of session.state.round.artists) session.dispatch(a, { type: 'ready' });
  const d = session.state.round.turnOrder[0];
  assert.ok(session.ink(d, { stroke: `${d}-1`, pts: [[100, 100], [400, 400]], end: true, color: '#d62828', width: 9 }));
  assert.equal(session.drawing.strokes.length, 1);
  assert.ok(session.dispatch(HOST, VOID));
  assert.equal(session.state.phase, 'deal');
  assert.equal(session.drawing.strokes.length, 0, 'the half-drawn picture is gone');
  assert.equal(session.drawing.epoch, session.state.inkEpoch);
  assert.equal(new Set(cues).size, cues.length, 'every cue id is new, so the narrator speaks the redo line');
  assert.match(session.cue().text, /上一鋪唔計/);
});

test('fake-artist: blocking — the table waits exactly on the seats in focus (and the result’s 睇完 still to come), never during the tally linger', () => {
  let checked = 0;
  for (const cfg of [{ qm: 'app' }, { qm: 'player', first: 'qm', guess: 'typed', tieRule: 'revote' }, { draw: 'paper', qm: 'player' }]) {
    for (let seed = 1; seed <= 4; seed++) {
      const sim = mk(6, { seed: seed * 7, config: { ...cfg, target: 3 } });
      const check = (s) => {
        const st = s.state;
        const f = engine.focus(st);
        const blockers = ids(s).filter((pid) => engine.blocking(st, pid));
        const readers = [...st.round.artists, ...(st.round.qm ? [st.round.qm] : [])];
        for (const pid of ids(s)) {
          const want = st.phase === 'result' ? readers.includes(pid) && !st.round.seen?.[pid] : !!f && f.pids.includes(pid);
          assert.equal(engine.blocking(st, pid), want, `${st.phase}: ${pid}`);
        }
        assert.equal(engine.blocking(st, null), false);
        assert.equal(engine.blocking(st, 'ghost'), false);
        if (['tally', 'over'].includes(st.phase)) {
          assert.deepEqual(blockers, [], `${st.phase}: nobody holds the table up`);
          return;
        }
        assert.ok(blockers.length >= 1, `${st.phase}: somebody is always being waited on (no silent deadlock)`);
        for (const pid of blockers) {
          assert.ok(s.legal(pid).length > 0, `${st.phase}: ${pid} is waited on but has nothing to do`);
          const a = engine.autoAct(clone(st), pid, s.ctx());
          assert.ok(a, `${st.phase}: 代佢做 has an answer for ${pid}`);
          assert.notEqual(JSON.stringify(engine.act(clone(st), { pid, action: a }, s.ctx())), JSON.stringify(st), `${st.phase}: 代佢做 for ${pid} moves the game`);
        }
        checked++;
      };
      check(sim);
      sim.runRandom({ onStep: check });
    }
  }
  assert.ok(checked > 200);
  // the Session asks the engine (not focus/legalActions): the seats it reports are the ones the game waits on
  const session = new Session({
    game, players: makePlayers(4), config: game.config.defaults(4), hostPid: 'p1', rng: mulberry32(1), bag: makeBag(banks),
    now: () => 0, timers: { setTimeout: () => 0, clearTimeout: () => {} }, narrationMode: 'silent',
  }).begin();
  assert.deepEqual(['p1', 'p2', 'p3', 'p4'].filter((p) => session.blocking(p)).sort(), session.state.round.artists.slice().sort());
  for (const a of session.state.round.artists) session.dispatch(a, { type: 'ready' });
  assert.deepEqual(['p1', 'p2', 'p3', 'p4'].filter((p) => session.blocking(p)), [session.state.round.turnOrder[0]]);
});

test('fake-artist: carry — the QM rotation and antiStreak run on into the next game; a junk carry is ignored', () => {
  const g1 = mk(5, { seed: 3, config: { qm: 'player', first: 'auto', endMode: 'rounds', rounds: 2 } });
  const qms = [];
  while (phase(g1) !== 'over') { qms.push(R(g1).qm); playRound(g1); allNext(g1); }
  const carry = g1.result().carry;
  const order = ids(g1);
  assert.equal(carry.lastFake, g1.state.history[g1.state.history.length - 1].fake);
  assert.equal(carry.nextQm, order[(order.indexOf(qms[qms.length - 1]) + 1) % 5], 'the seat after the last QM');
  for (const pid of [...order, null]) assert.ok(!JSON.stringify(g1.view(pid)).includes('carry'), 'carry is host-only');
  for (let seed = 1; seed <= 8; seed++) {
    const g2 = new Sim(game, { n: 5, seed, config: { ...game.config.defaults(5), qm: 'player' }, banks, carry });
    assert.equal(R(g2).qm, carry.nextQm, 'the rotation carries on instead of a random first QM');
  }
  let hit = 0;
  let plain = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const lastFake = `p${1 + (seed % 5)}`;
    const a = new Sim(game, { n: 5, seed, config: { ...game.config.defaults(5), antiStreak: true }, banks, carry: { lastFake } });
    if (R(a).fake === lastFake) hit++;
    const b = new Sim(game, { n: 5, seed, config: game.config.defaults(5), banks, carry: { lastFake } });
    if (R(b).fake === lastFake) plain++;
  }
  assert.equal(hit, 0, 'antiStreak keeps the last game’s fake out of the first deal');
  assert.ok(plain > 0, 'without antiStreak the deal stays uniform');
  // three artists: antiStreak never kicks in (it would come close to naming the fake)
  let three = 0;
  for (let seed = 1; seed <= 60; seed++) {
    if (R(new Sim(game, { n: 3, seed, config: { ...game.config.defaults(3), antiStreak: true }, banks, carry: { lastFake: 'p1' } })).fake === 'p1') three++;
  }
  assert.ok(three > 0);
  for (const junk of [5, 'x', [], { lastFake: 'ghost', nextQm: 'ghost' }, { lastFake: 7, nextQm: {} }]) {
    const sim = new Sim(game, { n: 5, seed: 2, config: { ...game.config.defaults(5), qm: 'player', antiStreak: true }, banks, carry: junk });
    assert.equal(sim.state.lastFake, null, JSON.stringify(junk));
    assert.ok(order.includes(R(sim).qm));
  }
  const app = mk(4, { seed: 1, config: { endMode: 'rounds', rounds: 1 } });
  playRound(app);
  allNext(app);
  assert.deepEqual(app.result().carry, { lastFake: app.state.history[0].fake, nextQm: null }, 'no human QM, no rotation to carry');
});

// ============================================================
// 唔計分 (none-v2) and the pens
// ============================================================

test('fake-artist: 唔計分 (none-v2, the current print) — nobody scores, each round has a winning side, the most rounds won takes the game', () => {
  const sim = mk(5, { seed: 4, config: { scoring: 'none', qm: 'player', first: 'auto' } });
  assert.equal(sim.state.cfg.endMode, 'rounds');
  assert.equal(sim.state.totalRounds, 5, 'rounds 0 = one round per player (everybody is QM once)');
  const wins = Object.fromEntries(ids(sim).map((id) => [id, 0]));
  const qms = [];
  for (const [caught, correct] of [[false, false], [true, true], [true, false], [true, false], [false, false]]) {
    const qm = R(sim).qm;
    qms.push(qm);
    playRound(sim, { caught, correct });
    const F = R(sim).fake;
    const rv = sim.view(null).reveal;
    assert.deepEqual(rv.deltas, [], 'no points in this mode');
    assert.equal(rv.scoring, 'none');
    const side = caught && !correct ? R(sim).artists.filter((a) => a !== F) : [F, qm];
    assert.deepEqual(rv.winners.slice().sort(), side.slice().sort(), `${caught}/${correct}`);
    for (const w of side) wins[w] += 1;
    assert.deepEqual(sim.view('p1').wins, wins);
    assert.ok(rv.lines.some((l) => l.includes('唔計分')), rv.lines.join(' | '));
    assert.ok(!/得 \d 分/.test(sim.cue().text), 'the result cue does not talk about points');
    assert.ok(Object.values(sim.state.scores).every((x) => x === 0));
    allNext(sim);
  }
  assert.equal(new Set(qms).size, 5, 'everybody was QM once');
  assert.equal(phase(sim), 'over');
  const res = sim.result();
  const top = Math.max(...Object.values(wins));
  assert.deepEqual(res.winners, ids(sim).filter((id) => wins[id] === top));
  assert.deepEqual(res.points, {}, 'no points reach the evening scoreboard');
  assert.match(res.summary, /輪/);
  // a target means nothing without points: the game is a fixed number of rounds
  const t = mk(4, { seed: 2, config: { scoring: 'none', endMode: 'target', target: 1, rounds: 2 } });
  let played = 0;
  while (phase(t) !== 'over') { playRound(t, { caught: false }); played++; allNext(t); }
  assert.equal(played, 2);
  // the form follows: no end mode or target, the number of rounds instead
  const keys = game.config.fields({ ...game.config.defaults(6), scoring: 'none' }, 6).map((f) => f.key);
  assert.ok(keys.includes('scoring') && keys.includes('rounds') && !keys.includes('target') && !keys.includes('endMode'), keys.join());
  assert.ok(game.config.summary({ ...game.config.defaults(6), scoring: 'none' }, 6).some((l) => /唔計分/.test(l)));
  assert.equal(sim.view('p1').mode.scoring, 'none');
});

test('fake-artist: pens — every seat gets its own pen: distinct, dark enough for the cream sheet, the same on every phone and every round', () => {
  const { PENS, assignPens, colorDistance } = game;
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const paper = lum('#fffdf5');
  assert.ok(PENS.length >= game.meta.players[1], 'enough pens for the biggest table');
  for (let i = 0; i < PENS.length; i++) {
    assert.ok((paper + 0.05) / (lum(PENS[i]) + 0.05) >= 3, `${PENS[i]} shows on the paper (3:1)`);
    for (let j = i + 1; j < PENS.length; j++) assert.ok(colorDistance(PENS[i], PENS[j]) >= 24, `${PENS[i]} vs ${PENS[j]} look alike`);
  }
  // the room palette has near twins (the old deepened pens of #f5c518 and #facc15 were ΔE 3 apart)
  const LOBBY = ['#f5c518', '#4ec97a', '#4aa3ff', '#ff7a59', '#c084fc', '#f472b6', '#2dd4bf', '#facc15', '#a3e635', '#fb923c', '#60a5fa', '#e879f9', '#94a3b8', '#fda4af', '#86efac', '#fde68a'];
  const twins = assignPens([{ id: 'a', color: '#f5c518' }, { id: 'b', color: '#facc15' }]);
  assert.ok(colorDistance(twins.a, twins.b) >= 24);
  const rng = mulberry32(5);
  for (let k = 0; k < 600; k++) {
    const n = 3 + Math.floor(rng() * 8);
    const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, color: LOBBY[Math.floor(rng() * LOBBY.length)] }));
    const m = assignPens(players);
    assert.equal(new Set(Object.values(m)).size, n, 'nobody shares a pen');
    for (const p of players) assert.ok(PENS.includes(m[p.id]));
    assert.deepEqual(assignPens(players), m, 'deterministic: every phone computes the same map');
  }
  const first10 = assignPens(LOBBY.slice(0, 10).map((color, i) => ({ id: `p${i + 1}`, color })));
  assert.equal(first10.p1, '#b07d00', 'yellow seat → the amber pen');
  assert.equal(first10.p2, '#2b8a3e', 'green seat → the green pen');
  assert.equal(first10.p3, '#1c7ed6', 'blue seat → the blue pen');
  assert.equal(Object.keys(assignPens([{ id: 'x', color: 'var(--a)' }, { id: 'y' }])).length, 2, 'odd colours still get a pen');
  // in the game: one map for everybody, stable while the QM moves round
  const sim = mk(6, { seed: 3, config: { qm: 'player', first: 'auto', endMode: 'rounds', rounds: 3 } });
  const pens = sim.view('p1').pens;
  assert.deepEqual(Object.keys(pens).sort(), ids(sim).sort());
  for (const pid of [...ids(sim), null]) assert.deepEqual(sim.view(pid).pens, pens);
  playRound(sim);
  allNext(sim);
  assert.deepEqual(sim.view('p2').pens, pens, 'a new QM does not reshuffle the pens');
});

test('fake-artist: fuzz with 唔計分 and the host voiding rounds at random — always terminates, never scores a voided round', () => {
  let games = 0;
  for (let n = 3; n <= 10; n++) {
    for (const scoring of ['points', 'none']) {
      const config = { scoring, qm: n >= 4 && n % 2 ? 'player' : 'app', draw: n % 3 ? 'phone' : 'paper', endMode: 'rounds', rounds: 3, target: 3 };
      const sim = mk(n, { seed: n * 11 + scoring.length, config });
      let voids = 0;
      for (let i = 0; i < 4000 && phase(sim) !== 'over'; i++) {
        if (sim.rng() < 0.02 && voids < 4) {
          const before = clone(sim.state);
          if (sim.host(VOID)) { voids++; assert.deepEqual(sim.state.scores, before.scores); }
        } else assert.ok(stepRandom(sim), 'progress');
      }
      assert.equal(phase(sim), 'over');
      assert.equal(sim.state.history.filter((h) => !h.voided).length, 3);
      assert.equal(sim.state.history.filter((h) => h.voided).length, voids);
      const res = sim.result();
      assert.ok(res.winners.length >= 1);
      if (scoring === 'none') assert.ok(Object.values(sim.state.scores).every((x) => x === 0));
      games++;
    }
  }
  assert.equal(games, 16);
});

// ============================================================
// UI smoke test (tiny DOM shim, fake timers; no browser)
// ============================================================

/** Just enough DOM for js/games/fake-artist/ui.js, plus timers the test flushes by hand. */
function installDom() {
  class FakeNode {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.parent = null; this.attrs = {}; this.listeners = {};
      this.style = { cssText: '' }; this._text = ''; this.hidden = false; this.disabled = false; this.className = ''; this.value = '';
      const set = new Set();
      this.classList = {
        add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c),
        toggle: (c, on = !set.has(c)) => { if (on) set.add(c); else set.delete(c); return on; },
      };
    }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = []; this._text = String(v ?? ''); }
    get firstChild() { return this.children[0] ?? null; }
    append(...kids) {
      for (const k of kids) {
        const n = k instanceof FakeNode ? k : FakeNode.text(String(k));
        n.remove();
        n.parent = this;
        this.children.push(n);
      }
    }
    replaceChildren(...kids) { for (const c of this.children) c.parent = null; this.children = []; this._text = ''; this.append(...kids); }
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
    fire(t, ev = {}) { for (const fn of this.listeners[t] ?? []) fn(ev); }
    click() { if (!this.disabled) { this.fire('pointerdown'); this.fire('click'); } }
    focus() {}
    blur() {}
    visibleText() { return this.hidden ? '' : this._text + this.children.map((c) => c.visibleText()).join(''); }
    all() { return [this, ...this.children.flatMap((c) => c.all())]; }
    static text(s) { const n = new FakeNode('#text'); n._text = s; return n; }
  }
  const queue = [];
  let seq = 0;
  const prev = { Node: globalThis.Node, document: globalThis.document, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  globalThis.Node = FakeNode;
  globalThis.document = { createElement: (t) => new FakeNode(t), createTextNode: (s) => FakeNode.text(s) };
  globalThis.setTimeout = (fn, ms) => { const id = ++seq; queue.push({ id, fn, ms }); return id; };
  globalThis.clearTimeout = (id) => { const i = queue.findIndex((q) => q.id === id); if (i >= 0) queue.splice(i, 1); };
  return {
    FakeNode,
    /** Run every pending timer (and the ones they schedule), like letting a few seconds pass. */
    flush() { for (let k = 0; k < 50 && queue.length; k++) { const q = queue.splice(0, queue.length); for (const t of q) t.fn(); } },
    restore() { Object.assign(globalThis, prev); },
  };
}

function fakeComponents(FakeNode) {
  const made = { canvases: [], panels: [], pickers: [], covers: [] };
  const plain = () => { const el = new FakeNode('div'); return { el, update() {}, destroy() { el.remove(); } }; };
  return {
    made,
    components: {
      Cover(props) {
        const el = new FakeNode('div');
        el.append(props.front);   // the real Cover keeps the front in the DOM too (hidden until held): leak checks see it
        const me = { el, props, update(p) { me.props = p; }, close() {}, destroy() { el.remove(); } };
        made.covers.push(me);
        return me;
      },
      PlayerPicker() { const me = { el: new FakeNode('div'), props: null, update(p) { me.props = p; }, destroy() {} }; made.pickers.push(me); return me; },
      VotePanel(props) { const me = { el: new FakeNode('div'), props, update(p) { me.props = p; }, destroy() {} }; made.panels.push(me); return me; },
      Canvas(props) { const me = { el: new FakeNode('div'), props, update(p) { me.props = p; }, destroy() { me.dead = true; } }; made.canvases.push(me); return me; },
      Timer: plain,
    },
  };
}

const uiButtons = (root) => root.all().filter((n) => n.tagName === 'button' && !n.hidden);
const uiButton = (root, text) => uiButtons(root).find((b) => b.textContent.includes(text));

test('fake-artist: UI (fake DOM) renders every phase for every seat, never shows the word to the fake or the table early, and sends what the engine expects', async () => {
  const dom = installDom();
  const mounted = [];
  try {
    const { mount } = await import('../js/games/fake-artist/ui.js');
    const mountSeat = (sim, me) => {
      const root = new dom.FakeNode('div');
      const sent = [];
      const fc = fakeComponents(dom.FakeNode);
      const ui = mount(root, { me, players: sim.players, isHost: me === 'p1', send: (a) => sent.push(a), ink() {}, sfx() {}, toast() {},
        now: () => sim.now, components: fc.components, meta: game.meta, config: sim.config });
      mounted.push(ui);
      return { me, root, ui, sent, fc, show(ink = { epoch: sim.state.inkEpoch, strokes: [] }) { ui.update(sim.view(me), { focus: sim.focus(), paused: false, ink }); } };
    };

    // 1. every phase, every seat, three set-ups: no blank screen, no junk text, no early word
    for (const cfg of [{ draw: 'phone' }, { draw: 'paper', qm: 'player', guess: 'typed', tieRule: 'revote' }, { draw: 'phone', scoring: 'none', qm: 'player', first: 'qm' }]) {
      for (let seed = 1; seed <= 3; seed++) {
        const sim = mk(5, { seed: seed * 13, config: { ...cfg, target: 3, rounds: 2 } });
        const seats = [...ids(sim), null].map((me) => mountSeat(sim, me));
        const paint = () => {
          const st = sim.state;
          for (const u of seats) {
            u.show();
            const all = u.root.textContent;
            assert.ok(u.root.visibleText().length > 0, `blank screen for ${u.me} in ${st.phase}`);
            assert.ok(!/undefined|NaN|\[object|null/.test(all), `junk on ${u.me}'s screen in ${st.phase}: ${all.slice(0, 120)}`);
            const r = st.round;
            if (r.word && !['result', 'over'].includes(st.phase) && (u.me === null || u.me === r.fake)) {
              assert.ok(!all.includes(r.word), `${u.me ?? 'the table'} can read the word in ${st.phase}`);
            }
            if (st.phase === 'over') assert.match(all, cfg.scoring === 'none' ? /勝/ : /分/);
          }
        };
        paint();
        sim.runRandom({ onStep: paint });
        dom.flush();
        paint();
      }
    }

    // 2. wiring — deal: 睇完喇 sends ready
    const sim = mk(4, { seed: 5 });
    const a0 = R(sim).artists[0];
    const u0 = mountSeat(sim, a0);
    u0.show();
    uiButton(u0.root, '睇完喇').click();
    assert.deepEqual(u0.sent.pop(), { type: 'ready' });
    readyAll(sim);

    // draw (phone): only the drawer's Canvas can draw, with its own pen; an accepted stroke becomes { type: 'stroke', length }
    const drawer = mountSeat(sim, drawerOf(sim));
    const watcher = mountSeat(sim, other(ids(sim), drawerOf(sim)));
    drawer.show();
    watcher.show();
    const cv = drawer.fc.made.canvases[0];
    assert.equal(cv.props.canDraw, true);
    assert.equal(cv.props.oneStroke, true);
    assert.equal(cv.props.tools, 'none');
    assert.equal(cv.props.minStrokeLen, MIN_STROKE_LEN);
    assert.equal(cv.props.color, sim.view(drawer.me).pens[drawer.me], 'the seat draws with its own pen');
    assert.equal(cv.props.colorOf(watcher.me), sim.view(drawer.me).pens[watcher.me]);
    assert.equal(watcher.fc.made.canvases[0].props.canDraw, false);
    cv.props.onStrokeEnd({ strokeId: 'x-1', length: 187 });
    assert.deepEqual(drawer.sent.pop(), { type: 'stroke', length: 187 });
    cv.props.onStrokeEnd({ strokeId: 'x-2', length: 190 });
    assert.equal(drawer.sent.length, 0, 'one stroke per turn: a second callback in the same turn sends nothing');
    cv.props.onShort();
    assert.equal(drawer.sent.length, 0, 'a too-short stroke sends nothing (the Canvas discarded it)');
    assert.ok(sim.act(drawer.me, { type: 'stroke', length: 187 }), 'the engine accepts exactly what the UI sent');

    // vote: the VotePanel's pick becomes { type: 'vote', target }, never self
    drawAll(sim);
    const voter = mountSeat(sim, R(sim).artists[1]);
    voter.show();
    const panel = voter.fc.made.panels[0];
    assert.ok(!panel.props.candidates.includes(voter.me));
    panel.props.onVote(panel.props.candidates[0]);
    assert.deepEqual(voter.sent.pop(), { type: 'vote', target: panel.props.candidates[0] });

    // spoken guess: the judge needs two taps on 啱 / 錯
    allVote(sim, R(sim).fake);
    settle(sim);
    assert.equal(phase(sim), 'guess');
    const judge = mountSeat(sim, R(sim).judge);
    judge.show();
    assert.ok(judge.root.textContent.includes(R(sim).word), 'the judge sees the answer');
    uiButton(judge.root, '錯').click();
    assert.equal(judge.sent.length, 0, 'the first tap only arms');
    uiButton(judge.root, '再㩒一下').click();
    assert.deepEqual(judge.sent.pop(), { type: 'verdict', correct: false });
    const fakeUi = mountSeat(sim, R(sim).fake);
    fakeUi.show();
    assert.ok(!fakeUi.root.textContent.includes(R(sim).word));
    sim.act(R(sim).judge, { type: 'verdict', correct: false });

    // result: 睇完 only after a beat (a stray tap must not skip the reveal), then { type: 'next' }
    const res = mountSeat(sim, R(sim).artists[2]);
    res.show();
    assert.equal(uiButton(res.root, '睇完').disabled, true);
    dom.flush();
    res.show();
    uiButton(res.root, '睇完').click();
    assert.deepEqual(res.sent.pop(), { type: 'next' });

    // paper: 畫完 for the drawer, 「幫佢㩒」 for the QM
    const p = mk(5, { seed: 6, config: { draw: 'paper', qm: 'player', first: 'auto' } });
    p.act(R(p).qm, { type: 'qm-auto' });
    readyAll(p);
    const pd = mountSeat(p, drawerOf(p));
    const pq = mountSeat(p, R(p).qm);
    pd.show();
    pq.show();
    uiButton(pd.root, '畫完').click();
    assert.deepEqual(pd.sent.pop(), { type: 'done' });
    uiButton(pq.root, '幫佢㩒').click();
    assert.deepEqual(pq.sent.pop(), { type: 'done' });

    // typed guess: the caught fake types one guess
    const t = mk(4, { seed: 7, config: { guess: 'typed' } });
    toVote(t);
    allVote(t, R(t).fake);
    settle(t);
    const tf = mountSeat(t, R(t).fake);
    tf.show();
    const input = tf.root.all().find((n) => n.tagName === 'input');
    input.value = '犀牛';
    input.fire('input', {});
    uiButton(tf.root, '就係呢個').click();
    assert.deepEqual(tf.sent.pop(), { type: 'guess', text: '犀牛' });

    // the QM types a theme and a word; a theme that names the word is refused on the phone already
    const q = mk(5, { seed: 8, config: { qm: 'player' } });
    const qu = mountSeat(q, R(q).qm);
    qu.show();
    const [themeIn, wordIn] = qu.root.all().filter((n) => n.tagName === 'input');
    themeIn.value = '大象'; wordIn.value = '大象';
    themeIn.fire('input', {});
    uiButton(qu.root, '出題').click();
    assert.equal(qu.sent.length, 0, 'the theme may not give the word away');
    themeIn.value = '動物';
    themeIn.fire('input', {});
    uiButton(qu.root, '出題').click();
    assert.deepEqual(qu.sent.pop(), { type: 'qm-set', theme: '動物', word: '大象' });
  } finally {
    for (const ui of mounted) ui.destroy();
    dom.restore();
  }
});

// ============================================================
// small pure helpers
// ============================================================

test('fake-artist: config.fields — target / rounds and the first-drawer choice only show when they matter', () => {
  const keys = (cfg, n) => game.config.fields({ ...game.config.defaults(n), ...cfg }, n).map((f) => f.key);
  assert.ok(keys({}, 6).includes('target') && !keys({}, 6).includes('rounds'));
  assert.ok(keys({ endMode: 'rounds' }, 6).includes('rounds') && !keys({ endMode: 'rounds' }, 6).includes('target'));
  assert.ok(!keys({}, 6).includes('first'), 'no QM, nobody to choose');
  assert.ok(keys({ qm: 'player' }, 6).includes('first'));
  const qm = game.config.fields({ ...game.config.defaults(3) }, 3).find((f) => f.key === 'qm');
  assert.deepEqual(qm.options.map((o) => o.value), ['app'], 'with 3 players only the app can be the question master');
  assert.deepEqual(game.config.fields(game.config.defaults(5), 5).find((f) => f.key === 'qm').options.map((o) => o.value), ['app', 'player']);
});

test('fake-artist: penColor keeps the hue but deepens pale pens so every lobby colour shows on the cream sheet', async () => {
  const { penColor } = await import('../js/games/fake-artist/ui.js');
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const paper = lum('#fffdf5');
  for (const c of ['#f5c518', '#4ec97a', '#4aa3ff', '#ff7a59', '#c084fc', '#f472b6', '#2dd4bf', '#facc15', '#a3e635', '#fb923c', '#60a5fa', '#e879f9', '#94a3b8', '#fda4af', '#86efac', '#fde68a']) {
    const p = penColor(c);
    assert.match(p, /^#[0-9a-f]{6}$/);
    const ratio = (paper + 0.05) / (lum(p) + 0.05);
    assert.ok(ratio >= 1.8, `${c} → ${p} contrast ${ratio.toFixed(2)}`);
  }
  assert.equal(penColor('var(--cheese)'), 'var(--cheese)');
  assert.equal(penColor(undefined), undefined);
});

test('fake-artist: strokeLength / matchesWord / tidy helpers', () => {
  assert.equal(game.strokeLength([]), 0);
  assert.equal(game.strokeLength([[0, 0]]), 0);
  assert.equal(game.strokeLength([[0, 0], [3, 4], [3, 14]]), 15);
  assert.equal(game.matchesWord('  大 象！', '大象', []), true);
  assert.equal(game.matchesWord('象', '大象', ['象']), true);
  assert.equal(game.matchesWord('象', '大象', []), false);
  assert.equal(game.matchesWord('', '大象', ['']), false);
  assert.equal(game.tidy('  a \n\t b\u0007  '), 'a b');
  assert.equal(game.textLen('大象ab'), 4);
});

// ============================================================
// playtest fixes (docs/playtest/multi/fake-artist.md)
// ============================================================

/** Mount one seat on the fake DOM (installDom must be active). */
async function mountFakeArtistSeat(dom, sim, me) {
  const { mount } = await import('../js/games/fake-artist/ui.js');
  const root = new dom.FakeNode('div');
  const sent = [];
  const fc = fakeComponents(dom.FakeNode);
  const ui = mount(root, { me, players: sim.players, isHost: me === 'p1', send: (a) => sent.push(a), ink() {}, sfx() {}, toast() {},
    now: () => sim.now, components: fc.components, meta: game.meta, config: sim.config });
  const show = () => ui.update(sim.view(me), { focus: sim.focus(), paused: false, ink: { epoch: sim.state.inkEpoch, strokes: [] } });
  show();
  return { me, root, ui, sent, fc, show };
}
/** Is `node` inside `ancestor`? */
const inside = (node, ancestor) => { for (let x = node; x; x = x.parent) if (x === ancestor) return true; return false; };

test('fake-artist: #7 spoken guess — the judge’s answer is behind hold-to-peek, 啱 / 錯 outside it; typed keeps it visible', async () => {
  const dom = installDom();
  const uis = [];
  try {
    for (const [qm, guess] of [['app', 'spoken'], ['player', 'spoken'], ['app', 'typed']]) {
      const sim = mk(5, { seed: 41, config: { qm, guess } });
      toVote(sim);
      allVote(sim, R(sim).fake);
      settle(sim);
      if (guess === 'typed') sim.act(R(sim).fake, { type: 'guess', text: '（亂估）' });
      assert.equal(phase(sim), guess === 'typed' ? 'judge' : 'guess');
      const j = await mountFakeArtistSeat(dom, sim, R(sim).judge);
      uis.push(j.ui);
      const word = R(sim).word;
      const wordEl = j.root.all().find((n) => n.className === 'fk-judge-word');
      assert.equal(wordEl.textContent, word, 'the judge has the answer');
      const answerCover = j.fc.made.covers.find((c) => inside(wordEl, c.el));
      const yes = uiButton(j.root, '啱');
      const no = uiButton(j.root, '錯');
      if (guess === 'spoken') {
        assert.ok(answerCover, `${qm}: the answer sits under a Cover while the fake is still thinking`);
        assert.equal(answerCover.props.backLabel, '㩒住睇答案');
        assert.notEqual(answerCover.props.lockMode, 'peek', 'the judge can always peek (it is not latched shut)');
        for (const b of [yes, no]) assert.ok(b && !inside(b, answerCover.el), '啱 / 錯 stay outside the cover');
      } else {
        assert.equal(answerCover, undefined, 'typed: the guess is locked, so the answer may simply show');
      }
      // the two-tap verdict still works
      no.click();
      uiButton(j.root, '再㩒一下').click();
      assert.deepEqual(j.sent.pop(), { type: 'verdict', correct: false });
    }
  } finally {
    for (const ui of uis) ui.destroy();
    dom.restore();
  }
});

test('fake-artist: #27 the vote and guess screens keep the full-size picture; ballot and tally dots use the pen colours', async () => {
  const dom = installDom();
  const uis = [];
  try {
    const sim = mk(5, { seed: 43 });
    toVote(sim);
    const pens = sim.view('p1').pens;
    const voter = await mountFakeArtistSeat(dom, sim, R(sim).artists[0]);
    uis.push(voter.ui);
    const boards = voter.root.all().filter((n) => (n.className ?? '').split(' ').includes('fk-board'));
    assert.equal(boards.length, 1, 'the vote screen shows the picture');
    assert.equal(boards[0].className, 'fk-board', 'full size (no compact board)');
    const panel = voter.fc.made.panels[0].props;
    for (const p of panel.players) assert.equal(p.color, pens[p.id], `${p.id}: the ballot dot is the pen colour`);
    assert.equal(typeof panel.colorOf, 'function');
    for (const id of ids(sim)) assert.equal(panel.colorOf(id), pens[id]);
    // the tally shows the same colours
    allVote(sim, R(sim).fake);
    assert.equal(phase(sim), 'tally');
    voter.show();
    const tallyPanel = voter.fc.made.panels[voter.fc.made.panels.length - 1].props;
    assert.ok(tallyPanel.reveal, 'the tally panel');
    for (const p of tallyPanel.players) assert.equal(p.color, pens[p.id]);
    // the guess screen: full size too
    settle(sim);
    const fake = await mountFakeArtistSeat(dom, sim, R(sim).fake);
    uis.push(fake.ui);
    const gb = fake.root.all().filter((n) => (n.className ?? '').split(' ').includes('fk-board'));
    assert.equal(gb.length, 1);
    assert.equal(gb[0].className, 'fk-board', 'the caught fake reads a full-size picture');
  } finally {
    for (const ui of uis) ui.destroy();
    dom.restore();
  }
});

test('fake-artist: the result screen keeps who voted for whom (both ballots after a revote), in pen colours', async () => {
  const dom = installDom();
  const uis = [];
  try {
    const nm = (sim, id) => sim.players.find((p) => p.id === id).name;
    // a plain round
    const sim = mk(5, { seed: 47 });
    toVote(sim);
    const F = R(sim).fake;
    const real = R(sim).artists.filter((a) => a !== F);
    voteWith(sim, (a) => (a === real[0] ? real[1] : real[0]));
    settle(sim);
    assert.equal(phase(sim), 'result');
    const u = await mountFakeArtistSeat(dom, sim, real[2]);
    uis.push(u.ui);
    const votes = u.root.all().find((n) => n.className === 'fk-votes');
    assert.ok(votes && !votes.hidden, 'a who-voted-for-whom block');
    const text = votes.textContent;
    assert.ok(text.includes('邊個投邊個'));
    const rows = votes.all().filter((n) => (n.className ?? '').startsWith('fk-votes-row'));
    const top = rows.find((r) => r.textContent.includes(nm(sim, real[0])) && r.textContent.includes('4 票'));
    assert.ok(top, `${nm(sim, real[0])} got 4 votes: ${text}`);
    for (const v of R(sim).artists.filter((a) => a !== real[0])) assert.ok(top.textContent.includes(nm(sim, v)), `${nm(sim, v)} is listed as a voter`);
    const pens = sim.view('p1').pens;
    const dotColours = top.all().filter((n) => n.className === 'fk-dot').map((n) => n.style.cssText);
    for (const c of dotColours) assert.ok(Object.values(pens).some((pc) => c === `--seat:${pc}`), `dot in a pen colour: ${c}`);
    // a revote shows both ballots
    let found = false;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const s2 = mk(5, { seed: 500 + seed, config: { tieRule: 'revote' } });
      toVote(s2);
      const [a, b, c, d, e] = R(s2).artists;
      // a 2-2-1 tie between a and b, then a second ballot by the other three
      const plan = { [a]: b, [b]: a, [c]: a, [d]: b, [e]: a === e ? b : c };
      voteWith(s2, (x) => plan[x]);
      if (phase(s2) !== 'revote') { s2.advance(); }
      if (phase(s2) !== 'revote') continue;
      for (const x of R(s2).vote.voters) s2.act(x, { type: 'vote', target: R(s2).vote.candidates.find((t) => t !== x) });
      settle(s2);
      if (phase(s2) === 'guess' || phase(s2) === 'judge') s2.act(R(s2).judge, { type: 'verdict', correct: false });
      if (phase(s2) !== 'result') continue;
      const u2 = await mountFakeArtistSeat(dom, s2, R(s2).artists[0]);
      uis.push(u2.ui);
      const t2 = u2.root.all().find((n) => n.className === 'fk-votes').textContent;
      assert.ok(t2.includes('第一次投票') && t2.includes('再投'), t2);
      found = true;
    }
    assert.ok(found, 'reached a revote result');
  } finally {
    for (const ui of uis) ui.destroy();
    dom.restore();
  }
});

test('fake-artist: #28 scoring text and narration fit the QM mode (no phantom 出題者, 「得 2 分」 for one person)', () => {
  assert.ok(!game.rules.quick.some((l) => l.includes('假畫家同出題者贏各')), 'the quick rules do not name a QM who may not exist');
  assert.ok(game.rules.quick.some((l) => l.includes('假畫家贏 +2') && l.includes('有出題者')));
  const help = (cfg) => game.config.fields({ ...game.config.defaults(5), ...cfg }, 5).find((f) => f.key === 'scoring').help;
  assert.ok(!help({ qm: 'app' }).includes('出題者'), help({ qm: 'app' }));
  assert.ok(help({ qm: 'player' }).includes('出題者'));
  for (const qm of ['app', 'player']) {
    const sim = mk(5, { seed: 61, config: { qm, first: 'auto' } });
    playRound(sim);   // the fake escapes: +2 (and the QM +2)
    assert.equal(phase(sim), 'result');
    const c = sim.cue();
    const nm = (id) => sim.players.find((p) => p.id === id).name;
    if (qm === 'app') {
      assert.ok(c.text.includes(`${nm(R(sim).fake)}得 2 分`), c.text);
      assert.ok(!c.text.includes('各得'), `one person never 「各得」: ${c.text}`);
    } else {
      assert.ok(c.text.includes(`出題者${nm(R(sim).qm)}各得 2 分`), c.text);
    }
  }
});

test('fake-artist: 呢鋪唔計 explains itself — engine.canVoid agrees with @void-round and says why a scored round stays', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const sim = mk(5, { seed: seed + 700, config: { endMode: 'rounds', rounds: 2, qm: seed % 2 ? 'app' : 'player', first: 'auto' } });
    for (let i = 0; i < (seed * 5) % 37 && phase(sim) !== 'over'; i++) stepRandom(sim);
    const verdict = engine.canVoid(clone(sim.state));
    const before = phase(sim);
    const changed = sim.host(VOID);
    assert.equal(verdict.ok, changed, `${before}: canVoid says ${verdict.ok}, @void-round changed ${changed}`);
    if (!verdict.ok) assert.ok(verdict.message && /[一-鿿]/.test(verdict.message), 'a reason in words');
    if (before === 'result') assert.match(verdict.message, /計咗分/);
  }
  const s = mk(4, { seed: 3 });
  playRound(s);
  assert.equal(phase(s), 'result');
  assert.deepEqual(engine.canVoid(s.state), { ok: false, message: '呢輪已經計咗分，大家㩒「睇完」就得' });
  // the round that decided the game says the same: everybody taps 睇完 (D3)
  const last = mk(4, { seed: 3, config: { endMode: 'rounds', rounds: 1 } });
  playRound(last);
  assert.equal(phase(last), 'result');
  assert.equal(last.view('p1').last, true);
  assert.deepEqual(engine.canVoid(last.state), { ok: false, message: '呢輪已經計咗分，大家㩒「睇完」就得' });
  assert.ok(game.rules.sections.some((x) => x.body.includes('已經計咗分')), 'the rules sheet says a scored round stays');
});

// ============================================================
// decisions 2026-10-04: D3 睇完 n / m, D4 absent seats, D12 the tally stays 7 s, D6 secret own vote
// ============================================================

const ABSENT = (pid) => ({ type: '@absent', pid });
const PRESENT = (pid) => ({ type: '@present', pid });

test('fake-artist D12: who voted for whom stays 7 s on the tally, and the result keeps every ballot', () => {
  assert.equal(game.TALLY_MS, 7000);
  const sim = atVote(5, { seed: 501 });
  const F = R(sim).fake;
  const real = R(sim).artists.filter((a) => a !== F);
  voteWith(sim, (a) => (a === real[0] ? real[1] : real[0]));
  assert.equal(phase(sim), 'tally');
  assert.equal(sim.state.deadline, sim.now + 7000);
  sim.tick(6900);
  assert.equal(engine.advance(clone(sim.state), sim.ctx()).phase, 'tally', 'still on screen at 6.9 s');
  settle(sim);
  assert.equal(phase(sim), 'result');
  const votes = sim.view('p1').reveal.round1.votes;
  assert.deepEqual(Object.keys(votes).sort(), R(sim).artists.slice().sort(), 'every ballot is on the result screen');
  for (const a of R(sim).artists) assert.equal(votes[a], a === real[0] ? real[1] : real[0]);
});

test('fake-artist D3: the result moves on once every seat of the round has tapped 睇完; the host can force it; a shared phone taps once', () => {
  const sim = mk(5, { seed: 510, config: { qm: 'player', first: 'auto', endMode: 'rounds', rounds: 3 } });
  playRound(sim);
  assert.equal(phase(sim), 'result');
  const readers = [...R(sim).artists, R(sim).qm];
  assert.deepEqual(sim.view('p1').seen, { who: [], total: 5 });
  assert.ok(sim.act(readers[0], { type: 'next' }));
  assert.equal(phase(sim), 'result', 'one eager seat does not move everybody on');
  assert.equal(sim.act(readers[0], { type: 'next' }), false, 'twice is nothing');
  assert.deepEqual(sim.legal(readers[0]), []);
  assert.equal(engine.blocking(sim.state, readers[0]), false);
  assert.equal(engine.blocking(sim.state, readers[1]), true, 'a reader still to tap is waited on');
  assert.deepEqual(engine.autoAct(sim.state, readers[1]), { type: 'next' });
  assert.ok(sim.act(readers[1], { type: 'next', seats: [readers[2], 'ghost', 4] }), 'a shared phone counts for its other seat');
  assert.deepEqual(sim.view('p2').seen.who.slice().sort(), readers.slice(0, 3).sort());
  assert.ok(sim.act(readers[3], { type: 'next' }));
  assert.equal(phase(sim), 'result');
  assert.ok(sim.act(readers[4], { type: 'next' }));
  assert.equal(R(sim).n, 2, 'the last reader deals the next round');
  // the host's 下一步 (after the line is read) forces it
  playRound(sim);
  sim.act(R(sim).qm, { type: 'next' });
  sim.host({ type: ACT.CUE_DONE, id: sim.cue().id });
  assert.ok(sim.host({ type: ACT.NEXT }));
  assert.equal(R(sim).n, 3);
});

test('fake-artist D4: an absent artist is not waited on to look, its strokes are skipped, it neither votes nor can be voted for', () => {
  const sim = mk(5, { seed: 520 });
  const F = R(sim).fake;
  const gone = R(sim).artists.find((a) => a !== F);
  for (const a of R(sim).artists) if (a !== gone) sim.act(a, { type: 'ready' });
  assert.equal(phase(sim), 'deal');
  assert.ok(sim.host(ABSENT(gone)));
  assert.equal(phase(sim), 'draw', 'the deal was only waiting on the seat that left');
  for (const p of [...ids(sim), null]) assert.deepEqual(sim.view(p).absent, [gone], 'public, the same on every phone');
  assert.deepEqual(sim.legal(gone), []);
  assert.equal(sim.act(gone, { type: 'stroke', length: 150 }), false);
  let skipped = 0;
  while (phase(sim) === 'draw') {
    assert.notEqual(drawerOf(sim), gone, 'the turn never rests on an absent artist');
    drawStroke(sim);
  }
  skipped = R(sim).strokes.filter((x) => x.kind === 'away').length;
  assert.equal(skipped, 2, 'both of its laps were skipped');
  assert.ok(R(sim).strokes.filter((x) => x.kind === 'away').every((x) => x.pid === gone));
  assert.equal(phase(sim), 'vote');
  assert.ok(!R(sim).vote.voters.includes(gone) && !R(sim).vote.candidates.includes(gone), 'not a voter, not a candidate (it is not the fake)');
  assert.equal(sim.view('p1').draw.counts[gone], 0, 'skipped turns are not strokes');
});

test('fake-artist D4: a drawer who leaves mid-turn is skipped; a voter who leaves closes the ballot it held up; @present brings it back', () => {
  const sim = mk(6, { seed: 530 });
  readyAll(sim);
  const F = R(sim).fake;
  const d = drawerOf(sim);
  if (d !== F) {
    assert.ok(sim.host(ABSENT(d)));
    assert.notEqual(drawerOf(sim), d);
    assert.equal(R(sim).strokes[0].kind, 'away');
    assert.ok(sim.host(PRESENT(d)));
  }
  drawAll(sim);
  const real = R(sim).vote.voters.filter((a) => a !== F);
  const late = real[real.length - 1];
  for (const a of R(sim).vote.voters) if (a !== late) sim.act(a, { type: 'vote', target: a === real[0] ? real[1] : real[0] });
  assert.equal(phase(sim), 'vote');
  assert.deepEqual(engine.focus(sim.state).pids, [late]);
  assert.ok(sim.host(ABSENT(late)));
  assert.equal(phase(sim), 'tally', 'the ballot closes without the seat that left');
  assert.ok(!(late in R(sim).tally1.votes), 'no abstention is invented for it');
});

test('fake-artist D4: an absent fake (not yet caught) or question master voids the round; a caught fake that leaves just gives no answer', () => {
  // the fake leaves while drawing: void, a fresh round under the same number, never the same seat as fake
  const a = mk(5, { seed: 540, config: { endMode: 'rounds', rounds: 2 } });
  readyAll(a);
  const F = R(a).fake;
  assert.ok(a.host(ABSENT(F)));
  assert.equal(phase(a), 'deal');
  assert.equal(R(a).n, 1);
  assert.equal(R(a).redo, true);
  assert.notEqual(R(a).fake, F);
  assert.ok(!R(a).artists.includes(F), 'an absent seat sits the re-dealt round out');
  const h = a.state.history[0];
  assert.ok(h.voided && h.why === 'absent' && h.absent === F);
  assert.ok(Object.values(a.state.scores).every((x) => x === 0));
  assert.match(a.cue().text, /上一鋪唔計/);
  // the question master leaves: void, and the next present seat becomes QM
  const q = mk(6, { seed: 541, config: { qm: 'player', first: 'auto', endMode: 'rounds', rounds: 2 } });
  const qm = R(q).qm;
  q.act(qm, { type: 'qm-auto' });
  assert.ok(q.host(ABSENT(qm)));
  assert.equal(phase(q), 'qm-input');
  assert.notEqual(R(q).qm, qm);
  assert.ok(!R(q).artists.includes(qm));
  // a caught fake that leaves before its guess: no answer, the artists win
  const c = atVote(5, { seed: 542 });
  const F2 = R(c).fake;
  allVote(c, F2);
  settle(c);
  assert.equal(phase(c), 'guess');
  assert.ok(c.host(ABSENT(F2)));
  assert.equal(phase(c), 'result');
  const rv = c.view('p1').reveal;
  assert.equal(rv.outcome, 'guess-wrong');
  assert.equal(rv.guess.by, 'away');
  assert.ok(rv.lines.some((l) => l.includes('唔喺度')), rv.lines.join(' / '));
  // a fake that escaped and leaves during the tally keeps its win
  const e = atVote(5, { seed: 543 });
  const F3 = R(e).fake;
  const real = R(e).artists.filter((x) => x !== F3);
  voteWith(e, (x) => (x === real[0] ? real[1] : real[0]));
  assert.equal(phase(e), 'tally');
  assert.ok(e.host(ABSENT(F3)));
  assert.equal(phase(e), 'tally', 'a decided round is not voided');
  settle(e);
  assert.equal(e.view('p1').reveal.outcome, 'escaped');
});

test('fake-artist D4: the judge who leaves is replaced; @absent is refused when too few would draw', () => {
  const sim = atVote(6, { seed: 550 });
  allVote(sim, R(sim).fake);
  settle(sim);
  assert.equal(phase(sim), 'guess');
  const j = R(sim).judge;
  assert.ok(sim.host(ABSENT(j)));
  assert.notEqual(R(sim).judge, j);
  assert.ok(R(sim).judge !== R(sim).fake && !sim.state.absent[R(sim).judge]);
  assert.deepEqual(engine.focus(sim.state).pids, [R(sim).judge]);
  const three = mk(3, { seed: 551 });
  assert.equal(three.host(ABSENT('p1')), false, 'three artists is the minimum');
  const qm4 = mk(4, { seed: 552, config: { qm: 'player' } });
  assert.equal(qm4.host(ABSENT(R(qm4).artists[0])), false, 'a question master needs three artists');
  for (const junk of [null, undefined, 'ghost', 7]) assert.equal(sim.host(ABSENT(junk)), false);
  assert.equal(sim.host(PRESENT(R(sim).fake)), false, 'a seat that is here cannot come back');
  assert.equal(sim.host(PRESENT(j)), true, 'the old judge is back (the new one keeps judging)');
});

test('fake-artist D4: fuzz — random @absent / @present / @void-round keep legalActions honest and every game finishing', () => {
  for (let n = 4; n <= 9; n++) {
    for (const qm of ['app', 'player']) {
      for (let seed = 1; seed <= 6; seed++) {
        const config = { qm, draw: seed % 2 ? 'phone' : 'paper', guess: seed % 3 ? 'spoken' : 'typed', tieRule: ['must-guess', 'escape', 'revote'][seed % 3], endMode: 'rounds', rounds: 3, first: 'auto' };
        const sim = mk(n, { seed: n * 100 + seed, config });
        const rng = mulberry32(seed + n);
        let k = 0;
        sim.runRandom({
          maxSteps: 40000,
          onStep(s) {
            if (++k % 5) return;
            const pid = ids(s)[Math.floor(rng() * n)];
            const x = rng();
            if (x < 0.3) s.host(ABSENT(pid)); else if (x < 0.5) s.host(PRESENT(pid)); else if (x < 0.53) s.host({ type: ACT.VOID_ROUND });
            const st = s.state;
            if (st.phase === 'over') return;
            for (const p of ids(s)) {
              if (st.absent[p]) {
                assert.deepEqual(s.legal(p), [], 'an absent seat has nothing to do');
                assert.equal(engine.blocking(st, p), false);
              }
            }
            const f = engine.focus(st);
            if (f) assert.ok(!f.pids.some((p) => st.absent[p]), `focus names an absent seat in ${st.phase}`);
            if (!['result', 'over'].includes(st.phase) && st.round.fake && st.round.caught !== true && !(st.phase === 'tally' && st.round.next === 'score')) {
              assert.ok(!st.absent[st.round.fake], 'an undecided round never has an absent fake');
            }
          },
        });
        assert.equal(phase(sim), 'over');
        assert.equal(sim.state.history.filter((h) => !h.voided).length, 3);
      }
    }
  }
});

test('fake-artist UI D3/D4/D6: 睇完 n / m after a short lock, the ballot keeps your pick secret, 💤 for absent seats', async () => {
  const dom = installDom();
  try {
    const { mount } = await import('../js/games/fake-artist/ui.js');
    const sim = mk(5, { seed: 560 });
    sim.players = sim.players.map((p, i) => ({ ...p, deviceId: i >= 3 ? 'shared' : `own${i}` }));
    const mountSeat = (me) => {
      const root = new dom.FakeNode('div');
      const sent = [];
      const fc = fakeComponents(dom.FakeNode);
      const ui = mount(root, { me, players: sim.players, isHost: me === 'p1', send: (a) => sent.push(a), ink() {}, sfx() {}, toast() {},
        now: () => sim.now, components: fc.components, meta: game.meta, config: sim.config });
      return { me, root, ui, sent, fc, show() { ui.update(sim.view(me), { focus: sim.focus(), paused: false, ink: { epoch: sim.state.inkEpoch, strokes: [] } }); } };
    };
    const gone = R(sim).artists.find((a) => a !== R(sim).fake && a !== 'p2' && a !== 'p4');
    sim.host(ABSENT(gone));
    const away = mountSeat(gone);
    away.show();
    assert.ok(away.root.visibleText().includes('房主當咗你唔喺度'), away.root.visibleText());
    assert.ok(!uiButton(away.root, '睇完喇'), 'no 睇完喇 on an absent phone');
    readyAll(sim);
    const watcher = mountSeat('p2');
    watcher.show();
    assert.ok(watcher.root.textContent.includes('💤'), 'the absent artist is marked');
    drawAll(sim);
    watcher.show();
    const panel = watcher.fc.made.panels[0];
    assert.equal(panel.props.secretChoice, true, 'D6: your phone says 已投 ✓, never whom');
    assert.ok(!panel.props.candidates.includes(gone));
    const F = R(sim).fake;
    allVote(sim, R(sim).artists.find((a) => a !== F && !sim.state.absent[a]));
    settle(sim);
    assert.equal(phase(sim), 'result');
    const s2 = mountSeat('p2');
    s2.show();
    assert.ok(s2.root.textContent.includes('睇完 0 / 4'), s2.root.textContent);
    assert.equal(uiButton(s2.root, '睇完 ✓').disabled, true, 'a short lock first');
    dom.flush();
    s2.show();
    uiButton(s2.root, '睇完 ✓').click();
    assert.deepEqual(s2.sent.pop(), { type: 'next' }, 'a phone of its own sends just its own');
    sim.act('p2', { type: 'next' });
    s2.show();
    assert.ok(uiButton(s2.root, '✓ 睇完 · 等緊其他人').disabled);
    assert.ok(s2.root.textContent.includes('睇完 1 / 4'));
    const s4 = mountSeat('p4');
    s4.show();
    dom.flush();
    s4.show();
    uiButton(s4.root, '睇完 ✓').click();
    assert.deepEqual(s4.sent.pop(), { type: 'next', seats: ['p5'] }, 'a shared phone taps for its other seat too');
  } finally {
    dom.restore();
  }
});

// ============================================================
// one phone in the middle (DESIGN §7.1; one-phone playtest fake-artist F1–F8, #2, #4, #5, #29, #30, U7)
// ============================================================

const onePhone = (n, config = {}, seed = 1) => mk(n, { seed, config: { ...game.config.defaults(n, undefined, { singleDevice: true }), ...config } });

test('fake-artist one phone: #4 every stroke is a public step (the public card, not 「其他人唔好望」); the guess and the ballots are named for the gate', () => {
  const sim = mk(5, { seed: 501 });
  assert.equal(sim.focus().label, '睇卡');
  readyAll(sim);
  const f = sim.focus();
  assert.deepEqual(f, { pids: [drawerOf(sim)], open: true, step: 'draw:0', label: '畫第 1 筆' });
  drawStroke(sim);
  assert.equal(sim.focus().step, 'draw:1', 'every turn is its own step');
  drawAll(sim);
  // secret ballots (the multi-phone default): private, with 「全部投完先好講」 on the gate (#30)
  const v = sim.focus();
  assert.equal(v.open, undefined);
  assert.deepEqual([v.step, v.label], ['vote:1', '投票 · 全部投完先好講']);
  allVote(sim, R(sim).fake);
  settle(sim);
  assert.equal(phase(sim), 'guess');
  // #29: the spoken guess lets the phone lie in the middle for the caught fake (the answer stays under the judge's cover)
  assert.deepEqual(sim.focus(), { pids: [R(sim).judge], open: true, label: '開口估題目' });
  const typed = mk(5, { seed: 502, config: { guess: 'typed' } });
  toVote(typed);
  allVote(typed, R(typed).fake);
  settle(typed);
  assert.deepEqual(typed.focus(), { pids: [R(typed).fake], label: '打字估題目' }, 'typing a guess is private');
  typed.act(R(typed).fake, { type: 'guess', text: '（亂估）' });
  assert.equal(typed.focus().step, 'judge', 'the judge’s own step');
});

test('fake-artist one phone: secret ballots on one phone first lay the picture in the middle — anybody starts the walk (#2)', () => {
  const sim = onePhone(5, { vote: 'ballot' }, 503);
  assert.equal(sim.state.cfg.passPhone, true);
  readyAll(sim);
  drawAll(sim);
  assert.equal(phase(sim), 'vote');
  assert.equal(sim.view(null).vote.look, true);
  assert.equal(sim.focus(), null, 'nobody is called: the picture lies in the middle for everybody');
  assert.equal(sim.cue().id, `r${R(sim).key}:vote:look`);
  assert.ok(!sim.cue().text.includes('三、二、一'), 'no simultaneous vote is announced');
  const v0 = R(sim).artists[0];
  assert.equal(sim.act(v0, { type: 'vote', target: R(sim).artists[1] }), false, 'no ballot before the look is over');
  assert.equal(game.engine.autoAct(clone(sim.state), v0), null);
  assert.ok(sim.act(R(sim).artists[2], { type: 'start-vote' }));
  assert.equal(sim.view(null).vote.look, false);
  assert.equal(sim.focus().label, '投票 · 全部投完先好講');
  assert.match(sim.cue().text, /全部投完先好講/);
  // the host's ⏭ during the look starts the walk — it never turns the ballots into abstentions
  const h = onePhone(5, { vote: 'ballot' }, 504);
  readyAll(h);
  drawAll(h);
  h.host({ type: ACT.CUE_DONE, id: h.cue().id });
  assert.ok(h.host({ type: ACT.NEXT }));
  assert.equal(phase(h), 'vote');
  assert.equal(h.view(null).vote.look, false);
  assert.deepEqual(R(h).vote.votes, {});
  // a multi-phone table never gets the look
  const multi = mk(5, { seed: 505 });
  toVote(multi);
  assert.equal(multi.view(null).vote.look, false);
  assert.ok(multi.focus().pids.length > 0);
  assert.match(multi.cue().text, /三、二、一，投！/, 'the multi-phone cue is unchanged');
});

test('fake-artist one phone: U7 一齊指 — count, point, one person enters who pointed at whom; the tally and tie rules run as usual', () => {
  const sim = onePhone(5, {}, 506);
  assert.equal(sim.state.cfg.vote, 'point');
  readyAll(sim);
  drawAll(sim);
  const F = R(sim).fake;
  const artists = R(sim).artists;
  assert.equal(phase(sim), 'vote');
  assert.equal(sim.focus(), null, 'nobody is handed the phone one by one');
  assert.match(sim.cue().text, /一齊指/);
  const v = sim.view(artists[0]).vote;
  assert.deepEqual([v.mode, v.canVote, v.countAt], ['point', false, null]);
  for (const p of artists) assert.equal(game.engine.blocking(sim.state, p), false, 'the table is not waiting on anybody in particular');
  assert.equal(sim.act(artists[0], { type: 'vote', target: artists[1] }), false, 'no separate ballots');
  const all = (t) => Object.fromEntries(artists.map((p) => [p, p === t ? artists.find((x) => x !== t) : t]));
  assert.equal(sim.act(artists[0], { type: 'point', votes: all(F) }), false, 'not before the count');
  assert.ok(sim.act(artists[1], { type: 'count' }));
  assert.equal(sim.view(null).vote.countAt, sim.now);
  assert.equal(sim.cue().text, '三、二、一，指！指住唔好郁。');
  const goId = sim.cue().id;
  // incomplete or impossible entries are refused
  const { [artists[0]]: _, ...partial } = all(F);
  assert.equal(sim.act(artists[0], { type: 'point', votes: partial }), false, 'every pointer must be entered');
  assert.equal(sim.act(artists[0], { type: 'point', votes: { ...all(F), [artists[2]]: artists[2] } }), false, 'nobody points at themselves');
  assert.equal(sim.act(artists[0], { type: 'point', votes: { ...all(F), [artists[2]]: 'p99' } }), false);
  // counting again re-says the count
  assert.ok(sim.act(artists[0], { type: 'count' }));
  assert.notEqual(sim.cue().id, goId);
  assert.ok(sim.act(artists[3], { type: 'point', votes: all(F) }));
  assert.equal(phase(sim), 'tally');
  assert.deepEqual(R(sim).tally1.votes, all(F), 'who pointed at whom is kept for the result (and the 最醒目 award)');
  assert.equal(R(sim).caught, true);
  // a tie under the revote rule: the re-vote is pointing too, among the tied only
  const t = onePhone(6, { tieRule: 'revote' }, 507);
  readyAll(t);
  drawAll(t);
  const A = R(t).artists;
  const fk = R(t).fake;
  const other = A.find((p) => p !== fk);
  t.act(A[0], { type: 'count' });
  const rest = A.filter((p) => p !== fk && p !== other);
  // 3 v 3: the fake and one other artist are tied at the top, and four artists are left to re-point
  const tie = { [fk]: other, [other]: fk, [rest[0]]: fk, [rest[1]]: fk, [rest[2]]: other, [rest[3]]: other };
  assert.ok(t.act(A[0], { type: 'point', votes: tie }));
  settle(t);
  assert.equal(phase(t), 'revote');
  {
    assert.equal(R(t).vote.mode, 'point');
    assert.equal(R(t).vote.countAt, null, 'a fresh count');
    assert.deepEqual(R(t).vote.voters, rest, 'only the artists nobody pointed at most');
    assert.equal(t.focus(), null);
    assert.match(t.cue().text, /再一齊指/);
  }
});

test('fake-artist one phone: fuzz — 一齊指 and the look on one phone always finish, and legalActions stay honest', () => {
  for (const cfg of [{}, { vote: 'ballot' }, { tieRule: 'revote' }, { tieRule: 'escape', guess: 'typed' }, { draw: 'paper' }]) {
    for (let seed = 1; seed <= 6; seed++) {
      const n = 3 + (seed % 6);
      const sim = onePhone(n, cfg, 600 + seed);
      sim.runRandom();
      assert.equal(sim.state.phase, 'over', `${JSON.stringify(cfg)} n=${n} seed=${seed}`);
    }
  }
});

test('fake-artist one phone: a whole-table 睇完 counts every listed reader, whichever seat carried it', () => {
  const sim = mk(4, { seed: 508, config: { endMode: 'rounds', rounds: 2 } });
  playRound(sim);
  assert.equal(phase(sim), 'result');
  const all = ids(sim);
  assert.ok(sim.act('p1', { type: 'next' }));
  assert.equal(sim.act('p1', { type: 'next', seats: all }), false, 'a seat that is done cannot tap for the others');
  assert.ok(sim.act('p1', { type: 'next', seats: all, table: true }));
  assert.notEqual(phase(sim), 'result', 'one tap on the table screen read it for everybody');
});

test('fake-artist one phone: rules and help no longer promise a simultaneous vote or 「其他人即時睇到」; a 一部手機玩 section', () => {
  const text = [...game.rules.quick, ...game.rules.sections.map((s) => s.body)].join('\n');
  assert.ok(!text.includes('畫完同時投票'));
  assert.ok(!text.includes('其他人即時睇到'));
  const one = game.rules.sections.find((s) => s.title === '一部手機玩');
  for (const bit of ['一齊指', '全部投完先好講', '答案冚住']) assert.ok(one.body.includes(bit), bit);
  const help = game.config.fields(game.config.defaults(5), 5).find((f) => f.key === 'draw').help;
  assert.ok(!help.includes('即時睇到'), help);
  assert.ok(game.config.fields(game.config.defaults(5), 5).some((f) => f.key === 'vote'));
  const w = game.config.validate({ ...game.config.defaults(5), vote: 'ballot' }, 5, { singleDevice: true }).warnings;
  assert.ok(w.some((x) => x.includes('一齊指')), w.join(' | '));
  assert.equal(game.config.validate({ ...game.config.defaults(5), vote: 'x' }, 5).ok, false);
});

/** A shared phone's mount (me null = the table screen) with the §7.1 api members faked and logged. */
async function mountFakeShared(dom, sim, me, { wholeTable = true, ctx = {} } = {}) {
  const { mount } = await import('../js/games/fake-artist/ui.js');
  const root = new dom.FakeNode('div');
  const log = { sent: [], table: [], handTo: [], toTable: 0 };
  const fc = fakeComponents(dom.FakeNode);
  const all = ids(sim);
  const ui = mount(root, {
    me, players: sim.players, isHost: true, send: (a) => { log.sent.push(a); return true; }, ink() {}, sfx() {}, toast() {},
    now: () => sim.now, components: fc.components, meta: game.meta, config: sim.config,
    shared: true, wholeTable, atTable: me == null, mySeats: all,
    tableSend: (a) => { log.table.push(a); return Promise.resolve(true); },
    handTo: (pid, opts = {}) => { log.handTo.push([pid, opts]); return true; },
    toTable: () => { log.toTable += 1; return true; },
  });
  const show = (extra = {}) => ui.update(sim.view(me), {
    focus: sim.focus(), paused: false, ink: { epoch: sim.state.inkEpoch, strokes: [] },
    shared: true, wholeTable, atTable: me == null, tableLocked: false, asked: null, ...ctx, ...extra,
  });
  show();
  return { me, root, ui, log, fc, show };
}

test('fake-artist ui one phone: the table screen of the deal says the phone goes round — never 「睇你張卡」 to the table (#20)', async () => {
  const dom = installDom();
  let t = null;
  try {
    const sim = onePhone(5, {}, 519);
    t = await mountFakeShared(dom, sim, null);
    const text = t.root.visibleText();
    assert.ok(!text.includes('睇你張卡'), text);
    assert.ok(text.includes('逐個睇卡') && text.includes('部手機逐個傳'), text);
  } finally {
    t?.ui.destroy();
    dom.restore();
  }
});

test('fake-artist ui one phone: the drawer’s public screen hides the re-peek card; 「唔記得題目？」 goes through a private hand-over and back (#4)', async () => {
  const dom = installDom();
  const uis = [];
  try {
    const sim = mk(5, { seed: 520 });
    readyAll(sim);
    const d = drawerOf(sim);
    const a = await mountFakeShared(dom, sim, d);
    uis.push(a.ui);
    const cover = () => a.fc.made.covers[a.fc.made.covers.length - 1];
    assert.ok(cover().el.hidden, 'no hold-to-peek card on a screen the whole table watches');
    assert.ok(!a.root.visibleText().includes('輪到你'), '#20: the table reads it, so it names the drawer');
    assert.ok(a.root.visibleText().includes(`${sim.players.find((p) => p.id === d).name} 畫`), a.root.visibleText());
    assert.equal(a.fc.made.canvases[0].props.canDraw, true, 'the drawer draws on the public screen');
    uiButton(a.root, '唔記得題目').click();
    assert.deepEqual(a.log.handTo, [[d, { why: '睇返張卡' }]], 'a private hand-over card for the same seat');
    // the shell mounts the seat afresh behind that card: the card is there, the pen is down
    const b = await mountFakeShared(dom, sim, d);
    uis.push(b.ui);
    const bc = b.fc.made.covers[b.fc.made.covers.length - 1];
    assert.ok(!bc.el.hidden, 'the card can be held now');
    assert.equal(b.fc.made.canvases[0].props.canDraw, false, 'no drawing while the others look away');
    // put back with the shell's 📱 擺返中間 instead: the public card that follows opens a plain stroke screen, never
    // the card again on the screen the table watches (the request is taken once, by the screen it was made for)
    const c = await mountFakeShared(dom, sim, d);
    uis.push(c.ui);
    assert.ok(c.fc.made.covers[c.fc.made.covers.length - 1].el.hidden, 'no card after the phone went back to the middle');
    assert.equal(c.fc.made.canvases[0].props.canDraw, true);
    assert.ok(!uiButton(c.root, '記得喇'));
    uiButton(b.root, '記得喇').click();
    assert.deepEqual(b.log.handTo, [[d, { open: true }]], 'back to the table with the public card');
    b.show();
    assert.ok(bc.el.hidden);
    assert.equal(b.fc.made.canvases[0].props.canDraw, true);
    // a phone of its own: the re-peek card stays, nothing changes
    const own = await mountFakeArtistSeat(dom, sim, d);
    uis.push(own.ui);
    assert.ok(!own.fc.made.covers[own.fc.made.covers.length - 1].el.hidden);
    assert.ok(!uiButton(own.root, '唔記得題目'));
  } finally {
    for (const ui of uis) ui.destroy();
    dom.restore();
  }
});

test('fake-artist ui one phone: 一齊指 on the table screen — 3-2-1 for everybody, then one person enters the pointing (U7)', async () => {
  const dom = installDom();
  const uis = [];
  try {
    const sim = onePhone(5, {}, 521);
    readyAll(sim);
    drawAll(sim);
    const t = await mountFakeShared(dom, sim, null);
    uis.push(t.ui);
    assert.ok(t.root.visibleText().includes('一齊指'));
    t.show({ tableLocked: true });
    assert.equal(uiButton(t.root, '3、2、1').disabled, true, 'locked while the table card is up (U5)');
    t.show();
    uiButton(t.root, '3、2、1').click();
    assert.deepEqual(t.log.table, [{ type: 'count' }]);
    assert.ok(sim.act('p1', t.log.table[0]));
    t.show();
    const big = () => t.root.all().find((n) => n.className === 'fk-count');
    assert.equal(big().textContent, '3', 'the count, from the host’s clock');
    sim.now += 1500;
    t.show();
    assert.equal(big().textContent, '2');
    assert.ok(!uiButton(t.root, '確定'), 'no entry until 「指！」');
    sim.now += 2000;
    t.show();
    assert.equal(big().textContent, '指！');
    const ok = () => uiButton(t.root, '確定');
    assert.equal(ok().disabled, true, 'every pointer has to be entered first');
    const F = R(sim).fake;
    // tap a chip per row: everybody points at the fake, the fake at someone else
    const rows = t.root.all().filter((n) => n.className === 'fk-point-row');
    assert.equal(rows.length, R(sim).artists.length);
    for (const row of rows) {
      const chips = row.all().filter((n) => n.tagName === 'button');
      const fakeChip = chips.find((c) => c.textContent.includes(sim.players.find((p) => p.id === F).name));
      (fakeChip ?? chips[0]).click();
    }
    assert.equal(ok().disabled, false);
    ok().click();
    assert.equal(t.log.table.length, 1, 'the first tap only arms');
    uiButton(t.root, '再㩒一次').click();
    const sent = t.log.table.at(-1);
    assert.equal(sent.type, 'point');
    assert.ok(sim.act('p2', sent), 'the engine takes the entry');
    assert.equal(R(sim).caught, true);
  } finally {
    for (const ui of uis) ui.destroy();
    dom.restore();
  }
});

test('fake-artist ui one phone: the look starts the walk, ballots say 「全部投完先好講」, the judge puts the picture first, the result closes with one tap (#2, #29, #30, F7)', async () => {
  const dom = installDom();
  const uis = [];
  try {
    const sim = onePhone(5, { vote: 'ballot' }, 522);
    readyAll(sim);
    drawAll(sim);
    const t = await mountFakeShared(dom, sim, null);
    uis.push(t.ui);
    assert.ok(t.root.visibleText().includes('大家睇清楚幅畫'));
    uiButton(t.root, '開始投票').click();
    assert.deepEqual(t.log.table, [{ type: 'start-vote' }]);
    assert.ok(sim.act('p1', t.log.table[0]));
    const v = await mountFakeShared(dom, sim, R(sim).vote.voters[0]);
    uis.push(v.ui);
    assert.ok(v.root.visibleText().includes('投票中 — 全部投完先好講'), v.root.visibleText());
    allVote(sim, R(sim).fake);
    settle(sim);
    assert.equal(phase(sim), 'guess');
    // spoken guess on one phone: the picture first, the answer under the cover, the note says how
    const j = await mountFakeShared(dom, sim, R(sim).judge);
    uis.push(j.ui);
    const kids = j.root.all();
    const boardAt = kids.findIndex((n) => n.className === 'fk-board');
    const wordAt = kids.findIndex((n) => n.className === 'fk-judge-word');
    assert.ok(boardAt >= 0 && boardAt < wordAt, 'the picture comes before the covered answer');
    assert.ok(j.root.visibleText().includes('部手機擺喺中間俾'), j.root.visibleText());
    sim.act(R(sim).judge, { type: 'verdict', correct: false });
    assert.equal(phase(sim), 'result');
    const r = await mountFakeShared(dom, sim, null);
    uis.push(r.ui);
    const next = () => uiButton(r.root, '大家睇完 ✓（一下就得）');
    assert.equal(next().disabled, true, 'a short lock first');
    dom.flush();
    r.show();
    assert.equal(next().disabled, false);
    assert.ok(!r.root.visibleText().includes('等緊：'), 'no waiting list on the one phone');
    assert.ok(!r.root.visibleText().includes('（你）'));
    next().click();
    assert.deepEqual(r.log.table.at(-1), { type: 'next' });
    assert.ok(sim.act('p1', { type: 'next', seats: ids(sim), table: true }));
    assert.notEqual(phase(sim), 'result');
  } finally {
    for (const ui of uis) ui.destroy();
    dom.restore();
  }
});

// ---------- one phone through the REAL play screen (js/ui/screens/play.js) and this game's real UI ----------
// A whole-table phone driven by a Sim: state.views / table / focus come from the engine (focus filtered the way the room
// filters it), app.act feeds the Sim (the room's `seats` / `table` clean-up changes nothing for one device holding every
// seat). This checks that the engine's focus, the shell's gates and this UI fit together (DESIGN §7.1).

class ShNode {
  constructor() { this.parentNode = null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === shDoc.body; }
}
class ShText extends ShNode {
  constructor(t) { super(); this.data = String(t); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
class ShEl extends ShNode {
  constructor(tag) {
    super();
    this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.cls = new Set();
    this.styleMap = {}; this.hidden = false; this.disabled = false; this.dataset = {}; this.open = false; this.value = '';
    const self = this;
    this.style = new Proxy({}, {
      get: (_, k) => (k === 'setProperty' ? (n, v) => { self.styleMap[n] = String(v); }
        : k === 'removeProperty' ? (n) => { delete self.styleMap[n]; } : self.styleMap[k]),
      set: (_, k, v) => { self.styleMap[k] = String(v); return true; },
    });
    this.classList = {
      add: (...c) => c.forEach((x) => self.cls.add(x)),
      remove: (...c) => c.forEach((x) => self.cls.delete(x)),
      toggle: (c, on) => { const want = on === undefined ? !self.cls.has(c) : !!on; if (want) self.cls.add(c); else self.cls.delete(c); return want; },
      contains: (c) => self.cls.has(c),
    };
  }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] ?? null; }
  get firstElementChild() { return this.children.find((c) => c instanceof ShEl) ?? null; }
  get lastElementChild() { return [...this.children].reverse().find((c) => c instanceof ShEl) ?? null; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(...(String(v) === '' ? [] : [new ShText(v)])); }
  get outerHTML() { return `<${this.tag} ${JSON.stringify([...this.cls])} ${JSON.stringify(this.attrs)} ${this.hidden} ${this.disabled}>${this.children.map((c) => (c instanceof ShEl ? c.outerHTML : c.data)).join('')}</${this.tag}>`; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  scrollIntoView() {}
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  focus() {}
  blur() {}
  append(...kids) { for (const k of kids) this.appendChild(k instanceof ShNode ? k : new ShText(k)); }
  appendChild(k) { k.parentNode?.removeChild(k); k.parentNode = this; this.children.push(k); return k; }
  insertBefore(k, ref) {
    if (!ref) return this.appendChild(k);
    k.parentNode?.removeChild(k);
    const i = this.children.indexOf(ref);
    k.parentNode = this;
    this.children.splice(i < 0 ? this.children.length : i, 0, k);
    return k;
  }
  removeChild(k) { const i = this.children.indexOf(k); if (i >= 0) { this.children.splice(i, 1); k.parentNode = null; } return k; }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() { this.parentNode?.removeChild(this); }
}
const shFind = (root, pred) => { const out = []; const w = (n) => { if (n instanceof ShEl && pred(n)) out.push(n); for (const c of n.children ?? []) w(c); }; w(root); return out; };
const shDoc = {
  createElement: (t) => new ShEl(t),
  createTextNode: (t) => new ShText(t),
  getElementById: (id) => shFind(shDoc.body, (n) => n.attrs.id === id)[0] ?? null,
  addEventListener() {}, removeEventListener() {},
  hidden: false,
  body: new ShEl('body'), head: new ShEl('head'),
};
const shShown = (n) => { for (let x = n; x; x = x.parentNode) if (x.hidden) return false; return true; };
/** What a person could read: hidden subtrees left out. */
const shText = (n) => (n instanceof ShText ? n.data : !n || n.hidden ? '' : n.children.map(shText).join(''));
const shTap = (n) => {
  assert.ok(n, 'nothing to tap');
  assert.ok(!n.disabled && shShown(n), `tapped a disabled / hidden control (${n.className} "${n.textContent}")`);
  for (const f of n.listeners.click ?? []) f({ preventDefault() {}, currentTarget: n, target: n });
};
const shSettle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

async function withShell(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node, window: globalThis.window, raf: globalThis.requestAnimationFrame };
  globalThis.document = shDoc;
  globalThis.Node = ShNode;
  globalThis.window = { addEventListener() {}, removeEventListener() {}, AudioContext: undefined, scrollTo() {}, devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = () => 1;            // (the real Canvas paints on frames: never run here)
  const savedCaf = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  shDoc.body.replaceChildren();
  const dom = await import('../js/ui/dom.js?v=1');
  try {
    return await fn(dom);
  } finally {
    dom.disarmConfirm?.();
    const { PassGate } = await import('../js/ui/components/PassGate.js?v=1');
    PassGate.hide();
    for (const [k, v] of Object.entries({ document: saved.document, Node: saved.Node, window: saved.window, requestAnimationFrame: saved.raf, cancelAnimationFrame: savedCaf })) {
      if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
    }
  }
}

/** The whole table on one phone, through the real play screen. `mount` = this game's real ui.mount. */
async function onePhoneShell(dom, sim, mount) {
  const { mountPlay } = await import('../js/ui/screens/play.js?v=1');
  const { filterFocus } = await import('../js/core/room.js?v=1');
  const seats = sim.players.map((p) => p.id);
  const players = sim.players.map((p) => ({ ...p, connected: true, deviceId: 'dev', isHost: p.id === 'p1', spectator: false }));
  const st = {
    mode: 'local', isHost: true, mySeats: seats.slice(), activeSeat: null, conn: 'online',
    views: {}, table: null, focus: null, cue: null, waiting: false, hostActions: [], canInk: [],
    room: {
      phase: 'playing', gameId: game.meta.id, players, paused: false, narration: { mode: 'voice' }, stalled: [], idle: [], absent: [],
      singleDevice: true, clockHeld: false, config: sim.config,
    },
  };
  const sync = () => {
    st.views = Object.fromEntries(seats.map((p) => [p, sim.view(p)]));
    st.table = sim.view(null);
    st.focus = filterFocus(sim.focus(), seats);
  };
  const acts = [];
  let screen = null;
  const render = async () => { sync(); screen.update(st); await shSettle(); screen.update(st); await shSettle(); };
  const app = {
    state: st,
    hostCtl: {
      next: () => true, voidRound: () => false, pause() {}, resume() {}, autoAct: () => true, markAbsent: () => true, markPresent: () => true,
      holdClock: () => true,
    },
    narration: { setMode() {} },
    act: (pid, action) => { acts.push({ pid, action }); const ok = sim.act(pid, action); return Promise.resolve(ok); },
    ink() {}, clock: { now: () => sim.now },
    setActiveSeat(pid) { if (pid === null ? st.mySeats.length < 2 : !st.mySeats.includes(pid)) return; st.activeSeat = pid; },
  };
  const gameMod = { ...game, ui: { mount } };
  const sh = {
    app, narrator: { cancel() {}, prime() {}, speak() {} }, cameFrom: null,
    timer: { button: () => new ShEl('button'), strip: () => new ShEl('div'), available: () => false, open() {}, openBig() {} },
    soundButton: () => new ShEl('button'),
    sound: { isOn: () => true, toggle() {}, night() {}, ambient() {} },
    gameMeta: () => game.meta, cached: () => gameMod, loadGame: async () => gameMod,
    confirm: (text, node = null, opts = {}) => dom.confirmTap(text, { node, ...opts }),
    leave: () => false,
  };
  screen = mountPlay(sh);
  shDoc.body.append(screen.el);
  await render();
  const gateEl = () => shFind(shDoc.body, (n) => n.cls.has('c-passgate'))[0] ?? null;
  const gameEl = () => shFind(screen.el, (n) => n.cls.has('play-game'))[0];
  const tap = async (n) => { shTap(n); await shSettle(); await render(); };
  return {
    st, acts, render, tap,
    gate: () => gateEl()?.attrs['data-gate'] ?? null,
    gateText: () => gateEl()?.textContent ?? '',
    tapGate: async () => tap(shFind(gateEl(), (n) => n.tag === 'button' && n.cls.has('btn-primary'))[0]),
    game: gameEl,
    text: () => shText(gameEl()),
    find: (pred) => shFind(gameEl(), pred),
    button: (text) => shFind(gameEl(), (n) => n.tag === 'button' && shShown(n) && n.textContent.includes(text))[0],
    tapIn: async (text) => tap(shFind(gameEl(), (n) => n.tag === 'button' && shShown(n) && n.textContent.includes(text))[0]),
    sheetButton: (text) => shFind(shDoc.body, (n) => n.cls.has('menu-sheet')).flatMap((m) => shFind(m, (n) => n.tag === 'button' && n.textContent.includes(text)))[0],
    destroy: () => screen.destroy(),
  };
}

const shWait = (ms) => new Promise((r) => setTimeout(r, ms));

test('fake-artist, one phone through the real play screen: private deal walk, every stroke behind the PUBLIC card, 一齊指 in the middle, one tap reads the result (#4, #2, U7, F7)', async () => {
  await withShell(async (dom) => {
    const { mount } = await import('../js/games/fake-artist/ui.js?v=1');
    const sim = onePhone(4, { endMode: 'rounds', rounds: 2 }, 530);
    const ph = await onePhoneShell(dom, sim, mount);
    assert.equal(ph.st.activeSeat, null, 'the phone starts in the middle');
    while (phase(sim) === 'deal') {
      assert.equal(ph.gate(), 'private', ph.gateText());
      assert.ok(ph.gateText().includes('睇卡'), ph.gateText());
      await ph.tapGate();
      await ph.tapIn('睇完喇');
    }
    // every stroke: the public card (no 「其他人唔好望」, the picture stays in view), then the drawer's screen
    let strokes = 0;
    while (phase(sim) === 'draw') {
      assert.equal(ph.gate(), 'public', `stroke ${strokes + 1}: ${ph.gateText()}`);
      assert.ok(!ph.gateText().includes('其他人唔好望'), ph.gateText());
      assert.ok(ph.gateText().includes(`畫第 ${strokes + 1} 筆`), ph.gateText());
      await ph.tapGate();
      assert.equal(ph.st.activeSeat, drawerOf(sim));
      assert.ok(!ph.find((n) => n.cls.has('c-cover')).some(shShown), 'no re-peek card on the screen everybody watches');
      assert.ok(ph.button('唔記得題目'), 'the drawer can still ask for a private look');
      sim.act(drawerOf(sim), { type: 'stroke', length: 150 });
      strokes += 1;
      await ph.render();
    }
    assert.equal(strokes, 8);
    // 一齊指: nobody is handed the phone one by one — it goes to the middle
    assert.equal(phase(sim), 'vote');
    assert.equal(ph.gate(), 'table');
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, null);
    await ph.tapIn('3、2、1');
    assert.notEqual(sim.view(null).vote.countAt, null);
    sim.now += 3500;
    await ph.render();
    const F = R(sim).fake;
    const fakeName = sim.players.find((p) => p.id === F).name;
    for (const row of ph.find((n) => n.cls.has('fk-point-row'))) {
      const chips = shFind(row, (n) => n.tag === 'button');
      await ph.tap(chips.find((c) => c.textContent.includes(fakeName)) ?? chips[0]);
    }
    await ph.tapIn('確定');
    await shWait(400);
    await ph.tapIn('再㩒一次確定');
    assert.equal(phase(sim), 'tally');
    assert.equal(R(sim).caught, true);
    // the spoken guess: the public card to the judge; the picture stays in view for the caught fake
    sim.advance();
    await ph.render();
    assert.equal(phase(sim), 'guess');
    assert.equal(ph.gate(), 'public', ph.gateText());
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, R(sim).judge);
    assert.ok(ph.text().includes('部手機擺喺中間俾'), ph.text());
    sim.act(R(sim).judge, { type: 'verdict', correct: false });
    await ph.render();
    assert.equal(phase(sim), 'result');
    assert.equal(ph.gate(), 'table');
    await ph.tapGate();
    await shWait(2600);                                          // the short lock every result has
    await ph.render();
    assert.ok(!ph.text().includes('等緊：'), ph.text());
    await ph.tapIn('大家睇完 ✓（一下就得）');
    assert.equal(phase(sim), 'deal', 'one tap read it for the whole table: the next round is dealt');
    assert.equal(ph.gate(), 'private');
    ph.destroy();
  });
});
