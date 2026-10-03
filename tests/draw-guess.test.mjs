// ============================================================
// tests/draw-guess.test.mjs — rules, scoring, clock, typed-guess judge, privacy and a fuzzer for 你畫我猜.
//   node tests/run.mjs draw-guess
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, assert, Sim, HOST, ACT, makePlayers } from './lib.mjs';
import { mulberry32, clone } from '../js/core/engine-kit.js';
import { Session } from '../js/core/session.js';
import * as game from '../js/games/draw-guess/game.js';
import * as judgeMod from '../js/games/draw-guess/judge.js';
import * as S from '../js/games/draw-guess/script.js';
import bankFile from '../js/data/draw-words.js';
import { roleParts, teamStyle, roleFor, resultSections } from '../js/ui/logic.js';

const { engine, config, meta, rules, CATEGORIES, scoreEntry, teamSizes, teamRoundsFor, cyclesFor, topicMatch } = game;
const { analyse, normalise, answersOf, editDistance, AMBIGUOUS } = judgeMod;

// ---------- fixtures ----------

const here = dirname(fileURLToPath(import.meta.url));
const FLAT = bankFile.flatMap((c) => c.words.map((w) => ({ w: w.w, alt: w.alt, level: w.level, cat: c.cat })));

/** A word made of characters from CJK Extension A: no hint, name or UI string can contain them by accident. */
const uniq = (i, len) => Array.from({ length: len }, (_, j) => String.fromCodePoint(0x3400 + i * 6 + j)).join('');
const CATS4 = ['甲類', '乙類', '丙類', '丁類'];
const LENS = [5, 3, 4, 2];
const UBANK = Array.from({ length: 120 }, (_, i) => ({ w: uniq(i, LENS[i % 4]), alt: [], level: 1 + (i % 3), cat: CATS4[i % 4] }));
const bankOf = (entries) => ({ draw: entries });

/** Three known words, one per tier: 老虎 (2) · 摩天輪 (3) · 守株待兔 (4). */
const TRIO = [
  { w: '老虎', alt: ['虎', 'tiger'], level: 1, cat: '陸上動物' },
  { w: '摩天輪', alt: ['摩天轮'], level: 2, cat: '建築與地方' },
  { w: '守株待兔', alt: [], level: 3, cat: '成語' },
];

const mk = (n, seed = 1, over = {}, banks = bankOf(UBANK), opts = {}) =>
  new Sim(game, { n, seed, banks, config: { ...config.defaults(n), ...over }, ...opts });

const T = (sim) => sim.state.turn;
const D = (sim) => T(sim).drawer;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const endOf = (sim) => (T(sim).sub === 'run' ? sim.state.deadline + sum(T(sim).then) : sim.state.deadline);
const offer = (sim, w) => T(sim).offers.findIndex((o) => o.w === w);

/** The drawer picks the offered word `w` (or the card at `level`). Returns the picked word. */
function pick(sim, which) {
  const i = typeof which === 'string' ? offer(sim, which) : T(sim).offers.findIndex((o) => o.level === (which ?? 2));
  assert.ok(i >= 0, `no such offer: ${which}`);
  assert.ok(sim.act(D(sim), { type: 'pick', i }));
  return T(sim).word.w;
}
/** Set the clock so that `r` of the turn is still left. */
const at = (sim, r) => { sim.now = Math.round(endOf(sim) - r * T(sim).T); };
const guessers = (sim) => T(sim).eligible;
const typedCfg = { guessMode: 'typed', roundSeconds: 80 };

function toReveal(sim) {
  let guard = 0;
  while (sim.state.phase !== 'reveal' && guard++ < 50) sim.advance();
  assert.equal(sim.state.phase, 'reveal');
}

/** Let the reveal (and a standings break after a full cycle) run out on the clock: the next turn, or the end. */
function toNext(sim) {
  let guard = 0;
  while ((sim.state.phase === 'reveal' || sim.state.phase === 'standings') && guard++ < 5) sim.advance();
  assert.ok(sim.state.phase === 'choose' || sim.state.phase === 'over', `stuck in ${sim.state.phase}`);
}

class FakeClock {
  constructor(start = 1_700_000_000_000) { this.t = start; this.q = []; this.seq = 0; }
  now = () => this.t;
  setTimeout = (fn, ms = 0) => { const id = ++this.seq; this.q.push({ id, at: this.t + Math.max(0, ms), fn }); return id; };
  clearTimeout = (id) => { this.q = this.q.filter((x) => x.id !== id); };
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      let next = null;
      for (const x of this.q) if (x.at <= end && (!next || x.at < next.at || (x.at === next.at && x.id < next.id))) next = x;
      if (!next) break;
      this.t = Math.max(this.t, next.at);
      this.q = this.q.filter((x) => x !== next);
      next.fn();
    }
    this.t = end;
  }
}

// ============================================================
// meta, rules, config
// ============================================================

test('draw-guess: meta, rules and engine shape', () => {
  assert.equal(meta.id, 'draw-guess');
  assert.deepEqual(meta.players, [3, 12]);
  assert.deepEqual(meta.banks, ['draw']);
  assert.equal(meta.css, true);
  assert.equal(meta.paperMode, true);
  assert.ok(rules.quick.length >= 4 && rules.quick.length <= 6, 'U1: rules.quick is at most 6 lines');
  for (const q of rules.quick) assert.ok(Array.from(q).length <= 40, `quick rule too long: ${q}`);
  assert.deepEqual(rules.roles.map((r) => r.id), ['drawer', 'guesser', 'rival']);
  for (const r of rules.roles) {
    // U1: the 💡 sheet splits 「做乜：… 點贏：…」; a drawing game has no 好人 / 壞人 side, so no team label
    const { what, win } = roleParts(r.text);
    assert.ok(what.length > 10 && win.length > 5, `${r.id}: what-you-do AND how-you-win (${r.text})`);
    assert.equal(teamStyle(r).label, null, `${r.id}: no 陣營 label`);
  }
  assert.equal(roleFor({ role: 'guesser' }, rules).name, '估嘅人', 'the 💡 sheet finds the seat\'s role by view.role');
  for (const s of rules.sections) assert.ok(s.title && s.body);
  for (const k of ['setup', 'act', 'advance', 'view', 'cue', 'focus', 'blocking', 'autoAct', 'legalActions', 'result', 'canInk']) {
    assert.equal(typeof engine[k], 'function', k);
  }
});

test('draw-guess: CATEGORIES lists every category of the real draw bank', () => {
  const real = bankFile.map((c) => c.cat);
  assert.deepEqual(real.filter((c) => !CATEGORIES.includes(c)), [], 'bank categories missing from CATEGORIES');
  assert.deepEqual(CATEGORIES.filter((c) => !real.includes(c)), [], 'CATEGORIES not in the bank');
});

test('draw-guess: config.defaults is valid for every head-count and every previous config', () => {
  for (let n = 3; n <= 12; n++) {
    for (const prev of [undefined, { teamMode: 'teams', teams: 4 }, { guessMode: 'typed' }, { teams: 9, cycles: 'x' }]) {
      const cfg = config.defaults(n, prev);
      const v = config.validate(cfg, n);
      assert.ok(v.ok, `n=${n} ${JSON.stringify(prev)}: ${v.message}`);
      assert.ok(Array.isArray(v.warnings));
      assert.ok(config.summary(cfg, n).length >= 4);
      assert.ok(config.fields(cfg, n).length >= 7);
      new Sim(game, { n, seed: n, banks: bankOf(UBANK), config: cfg });      // setup works
    }
  }
  assert.equal(config.defaults(3, { teamMode: 'teams' }).teamMode, 'ffa', '3 players cannot form teams');
  assert.equal(config.defaults(5, { teamMode: 'teams', teams: 4 }).teams, 2, 'teams are clamped to the head-count');
  assert.equal(config.defaults(6).drawMode, 'canvas');
  assert.equal(config.defaults(6).guessMode, 'shout', 'shout is the default guessing mode');
});

test('draw-guess: one phone for everybody — typed is never the default, is warned about, and has no preset', () => {
  for (let n = 3; n <= 12; n++) {
    for (const prev of [undefined, { guessMode: 'typed' }, { guessMode: 'typed', drawMode: 'paper', teamMode: 'teams' }]) {
      const cfg = config.defaults(n, prev, { singleDevice: true });
      assert.equal(cfg.guessMode, 'shout', `n=${n} ${JSON.stringify(prev)}: typed never survives on one phone`);
      assert.ok(config.validate(cfg, n, { singleDevice: true }).ok);
      if (prev?.drawMode) assert.equal(cfg.drawMode, 'paper', 'the other choices are kept');
    }
    // several phones: the previous choice is kept
    assert.equal(config.defaults(n, { guessMode: 'typed' }, { singleDevice: false }).guessMode, 'typed');
    // chosen anyway on one phone: still valid (it can be played, badly) but the warning says why not
    const typed = { ...config.defaults(n), guessMode: 'typed' };
    const w1 = config.validate(typed, n, { singleDevice: true });
    assert.ok(w1.ok && w1.warnings.some((w) => w.includes('一部手機唔啱打字估')), `n=${n}: ${w1.warnings}`);
    assert.ok(config.validate(typed, n).warnings.some((w) => w.includes('每人用自己部手機')), 'without env: the generic warning');
    const ids = config.presets(n, { singleDevice: true }).map((p) => p.id);
    assert.ok(!ids.includes('quiet'), 'no typed preset for one phone');
    assert.ok(ids.includes('classic') && ids.includes('phone'), 'paper and phone-canvas are both offered');
    for (const p of config.presets(n, { singleDevice: true })) assert.equal(p.cfg.guessMode ?? 'shout', 'shout');
  }
});

test('draw-guess: paper and phone drawing are both one tap away, and the bag counts what the topics allow', () => {
  const f = config.fields(config.defaults(6), 6);
  const dm = f.find((x) => x.key === 'drawMode');
  assert.deepEqual(dm.options.map((o) => o.value), ['canvas', 'paper']);
  const presets = config.presets(6);
  assert.equal(presets.find((p) => p.id === 'classic').cfg.drawMode, 'paper');
  assert.equal(presets.find((p) => p.id === 'phone').cfg.drawMode, 'canvas');
  // #11: the categories field carries bank + matches, so the lobby can print 已用 / 總數 from the bag
  const topics = f.find((x) => x.type === 'categories');
  assert.equal(topics.bank, 'draw');
  const e = { w: '老虎', alt: [], level: 1, cat: '陸上動物' };
  assert.equal(topics.matches({ cats: [], levels: [] }, e), true);
  assert.equal(topics.matches({ cats: ['成語'], levels: [] }, e), false);
  assert.equal(topics.matches({ cats: ['陸上動物'], levels: [2, 3] }, e), false);
  assert.equal(topics.matches({ categories: ['陸上動物'], level: ['1'] }, e), true, 'the alternative key names too');
  assert.equal(topicMatch(['陸上動物'], e), true, 'a bare array of categories');
  assert.equal(topicMatch(undefined, e), true);
  assert.equal(topicMatch({}, null), false);
  // the real bank: every tier of every category is non-empty under the default topics
  const all = FLAT.filter((x) => topicMatch(config.defaults(6).topics, x));
  assert.equal(all.length, FLAT.length);
});

test('draw-guess: turns, minutes and defaults follow the research table', () => {
  const turns = { 3: 9, 4: 8, 5: 10, 6: 12, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12 };
  for (const [n, t] of Object.entries(turns)) {
    const sim = mk(+n, 2);
    assert.equal(sim.state.queue.length, t, `n=${n}`);
    assert.equal(sim.state.cfg.cycles, cyclesFor(+n));
    assert.equal(sim.state.cfg.seconds, 80, 'shout default 80 s');
    assert.ok(config.summary(config.defaults(+n), +n)[0].includes(`共 ${t} 輪`));
  }
  assert.equal(mk(6, 1, { guessMode: 'typed' }).state.cfg.seconds, 100, 'typed default 100 s');
  assert.equal(mk(6, 1, { teamMode: 'teams' }).state.cfg.seconds, 60, 'team shout default 60 s');
  assert.equal(mk(6, 1, { teamMode: 'teams', guessMode: 'typed' }).state.cfg.seconds, 80);
  assert.equal(mk(6, 1, { roundSeconds: 45 }).state.cfg.seconds, 45);
  // teams: 5 draws per team (4 for 2v2), 4 for three teams, 3 for four
  assert.equal(teamRoundsFor(4, 2), 4);
  assert.equal(teamRoundsFor(5, 2), 5);
  assert.equal(teamRoundsFor(9, 3), 4);
  assert.equal(teamRoundsFor(12, 4), 3);
  assert.deepEqual(teamSizes(7, 2), [4, 3]);
  assert.deepEqual(teamSizes(12, 4), [3, 3, 3, 3]);
  assert.equal(mk(4, 1, { teamMode: 'teams' }).state.queue.length, 8);
  assert.equal(mk(6, 1, { teamMode: 'teams', teams: 3 }).state.queue.length, 12);
  assert.equal(mk(8, 1, { teamMode: 'teams', teams: 2, teamRounds: 2 }).state.queue.length, 4);
});

test('draw-guess: config.validate rejects bad input and warns on odd setups', () => {
  const base = config.defaults(6);
  for (const n of [0, 1, 2, 13, 20, 4.5]) assert.equal(config.validate(base, n).ok, false, `n=${n}`);
  for (const bad of [{ drawMode: 'pen' }, { guessMode: 'voice' }, { teamMode: 'x' }, { teamAssign: 'none' }, { strictness: 'hard' },
    { teams: 1 }, { teams: 5 }, { cycles: 6 }, { cycles: -1 }, { teamRounds: 9 }, { roundSeconds: 20 }, { roundSeconds: 181 },
    { roundSeconds: 80.5 }, { hints: 'yes' }, { starsAsPoints: 1 }, { topics: 'x' }, { topics: { cats: [1] } }, { topics: { levels: [4] } }]) {
    const v = config.validate({ ...base, ...bad }, 6);
    assert.equal(v.ok, false, JSON.stringify(bad));
    assert.ok(v.message.length > 0);
  }
  assert.equal(config.validate({ ...base, teamMode: 'teams' }, 3).ok, false, 'teams need 4 players');
  assert.equal(config.validate({ ...base, teamMode: 'teams', teams: 4 }, 6).ok, false, '4 teams need 8 players');
  assert.ok(config.validate({ ...base, teamMode: 'teams', teams: 4 }, 8).ok);
  assert.ok(config.validate({ ...base, guessMode: 'typed' }, 6).warnings.length >= 1, 'typed warns about one phone');
  assert.ok(config.validate({ ...base, teamMode: 'teams' }, 7).warnings.some((w) => w.includes('唔平均')));
  assert.ok(config.validate({ ...base, cycles: 5 }, 12).warnings.some((w) => w.includes('60')), 'long game says how long');
  assert.ok(config.validate({ ...base, topics: { cats: ['成語'], levels: [] } }, 6).warnings.length >= 1);
  // numeric strings from a <select> / input are accepted, and so are the numeric level strings
  assert.ok(config.validate({ ...base, roundSeconds: '100', cycles: '2', topics: { cats: [], levels: ['1', '3'] } }, 6).ok);
  assert.equal(config.defaults(6, { roundSeconds: '100' }).roundSeconds, 100);
  assert.deepEqual(config.defaults(6, { topics: { cats: ['成語'], levels: ['1', 3] } }).topics, { cats: ['成語'], levels: [1, 3] });
  assert.deepEqual(config.defaults(6, { topics: ['成語'] }).topics, { cats: ['成語'], levels: [] });
});

test('draw-guess: presets come with a reason and are valid for every head-count they are offered for', () => {
  for (let n = 3; n <= 12; n++) {
    const list = config.presets(n);
    assert.deepEqual(list.map((p) => p.id).slice(0, 3), ['classic', 'phone', 'quiet']);
    assert.equal(list.some((p) => p.id === 'teams'), n >= 4, `teams preset only from 4 players (n=${n})`);
    for (const p of list) {
      assert.ok(p.label && p.reason.length > 8, p.id);
      const cfg = config.defaults(n, p.cfg);
      assert.ok(config.validate(cfg, n).ok, `${p.id} n=${n}`);
      for (const [k, v] of Object.entries(p.cfg)) assert.equal(cfg[k], v, `${p.id}.${k}`);
      new Sim(game, { n, seed: 1, banks: bankOf(UBANK), config: cfg });
    }
  }
  assert.ok(config.fields(config.defaults(6), 6).find((f) => f.key === 'cycles').help.includes('最啱玩嘅人數'), 'the head-count reason is in the help');
});

test('draw-guess: config.fields and summary follow the setup', () => {
  const keys = (cfg, n) => config.fields(cfg, n).map((f) => f.key);
  assert.ok(keys(config.defaults(6), 6).includes('cycles'));
  assert.ok(!keys(config.defaults(6), 6).includes('teams'));
  assert.ok(!keys(config.defaults(6), 6).includes('strictness'));
  const t = { ...config.defaults(6), teamMode: 'teams' };
  assert.ok(keys(t, 6).includes('teams') && keys(t, 6).includes('teamRounds') && !keys(t, 6).includes('cycles'));
  assert.ok(keys({ ...config.defaults(6), guessMode: 'typed' }, 6).includes('strictness'));
  const cat = config.fields(config.defaults(6), 6).find((f) => f.type === 'categories');
  assert.deepEqual(cat.options.map((o) => o.value), CATEGORIES);
  assert.deepEqual(cat.levels.map((o) => o.value), [1, 2, 3]);
  const modes = config.fields(config.defaults(6), 6);
  assert.deepEqual(modes.find((f) => f.key === 'drawMode').options.map((o) => o.value), ['canvas', 'paper']);
  assert.deepEqual(modes.find((f) => f.key === 'guessMode').options.map((o) => o.value), ['shout', 'typed']);
  const s = config.summary({ ...config.defaults(6), drawMode: 'paper', guessMode: 'typed', strictness: 'loose', hints: false,
    topics: { cats: ['成語', '日本'], levels: [2, 3] } }, 6).join('|');
  for (const part of ['共 12 輪', '實體紙筆', '打字估（寬鬆）', '每輪 100 秒', '冇提示', '成語、日本', '中等、困難']) assert.ok(s.includes(part), part);
  const ts = config.summary({ ...config.defaults(7), teamMode: 'teams', starsAsPoints: true }, 7).join('|');
  assert.ok(ts.includes('分 2 隊（4、3）') && ts.includes('難詞多分'), ts);
});

// ============================================================
// the typed-guess judge
// ============================================================

test('judge: normalisation drops spaces, punctuation, width and case, and folds Traditional to Simplified', () => {
  assert.equal(normalise(' Ｔ恤 ！'), 't恤');
  assert.equal(normalise('卡拉 O K'), '卡拉ok');
  assert.equal(normalise('老　虎。'), '老虎');
  assert.equal(normalise('摩天輪'), normalise('摩天轮'));
  assert.equal(normalise('蘋果'), normalise('苹果'));
  assert.equal(normalise('雞'), normalise('鸡'));
  assert.equal(normalise('🐯'), '', 'a lone emoji normalises to nothing');
  assert.equal(editDistance('老虎', '老鼠'), 1);
  assert.equal(editDistance('', '虎'), 1);
  assert.equal(editDistance('摩天輪', '摩天輪'), 0);
  // the ambiguous groups are not folded together
  for (const g of AMBIGUOUS) {
    const cs = Array.from(g);
    assert.ok(new Set(cs.map((c) => normalise(c))).size === cs.length, `group ${g} must not fold together`);
  }
});

test('judge: right answers — word, alt, script, width, filler', () => {
  const tiger = { w: '老虎', alt: ['虎', 'tiger'] };
  for (const g of ['老虎', ' 老 虎 ', '老虎！', '虎', 'Tiger', 'ＴＩＧＥＲ', '係老虎', '老虎呀', '估老虎', '係唔係老虎', '是不是老虎', '老虎嘅', '我猜老虎', '虎嘅']) {
    assert.equal(analyse(g, tiger).kind, 'right', g);
  }
  const wheel = { w: '摩天輪', alt: ['摩天轮'] };
  for (const g of ['摩天輪', '摩天轮', '摩 天 轮', '係摩天輪嗎']) assert.equal(analyse(g, wheel).kind, 'right', g);
  // simplified↔traditional through the fold: the entry lists only one script
  assert.equal(analyse('冰淇淋', { w: '雪糕', alt: ['冰淇淋'] }).kind, 'right');
  assert.equal(analyse('苹果', { w: '蘋果', alt: [] }).kind, 'right');
  assert.equal(analyse('蘋果', { w: '苹果', alt: [] }).kind, 'right');
  assert.equal(analyse('台北101', { w: '台北101', alt: [] }).kind, 'right');
  assert.equal(analyse('臺北101', { w: '台北101', alt: [] }).kind, 'right');
  assert.equal(analyse('t恤', { w: 'T恤', alt: [] }).kind, 'right');
  // the ambiguous groups: every spelling of the ANSWER is accepted, in either script
  for (const [w, g] of [['麵包', '面包'], ['麵包', '麵包'], ['頭髮', '头发'], ['頭髮', '頭發'], ['发財', '發財'], ['皇后', '皇後'], ['乾杯', '干杯'], ['幹部', '干部']]) {
    assert.equal(analyse(g, { w, alt: [] }).kind, 'right', `${w} ← ${g}`);
  }
  assert.equal(answersOf({ w: '麵包', alt: [] }).includes(normalise('面包')), true);
});

test('judge: a message that lists several answers never matches, and it never counts as a wrong (public) guess', () => {
  const tiger = { w: '老虎', alt: ['虎'] };
  for (const g of ['老虎獅子', '老虎？獅子？', '獅子或者老虎', '我估係老虎或者獅子', '老虎 獅子 豹']) {
    const r = analyse(g, tiger);
    assert.notEqual(r.kind, 'right', g);
    assert.notEqual(r.kind, 'wrong', `${g}: contains the answer, so it must stay hidden`);
  }
});

test('judge: close, near and wrong', () => {
  const wheel = { w: '摩天輪', alt: [] };
  assert.equal(analyse('摩天', wheel).kind, 'close');            // piece / edit distance 1
  assert.equal(analyse('摩天輪機', wheel).kind, 'close');         // contains
  assert.equal(analyse('輪天摩', wheel).kind, 'close');           // scrambled
  assert.equal(analyse('摩地輪', wheel).kind, 'close');           // one character off
  assert.equal(analyse('太空船', wheel).kind, 'wrong');
  assert.equal(analyse('', wheel).kind, 'wrong');
  assert.equal(analyse('！！', wheel).kind, 'wrong');
  const tiger = { w: '老虎', alt: [] };
  assert.equal(analyse('老鼠', tiger).kind, 'close', 'two-character answer: shares a character in the same place');
  assert.equal(analyse('虎老', tiger).kind, 'close', 'reversed');
  assert.equal(analyse('獅子', tiger).kind, 'wrong');
  assert.equal(analyse('馬', tiger).kind, 'wrong');
  assert.equal(analyse('黃牛', { w: '牛', alt: [] }).kind, 'close', 'a one-character answer contained in the guess');
  assert.equal(analyse('馬', { w: '牛', alt: [] }).kind, 'wrong');
  // `near`: a related answer from the entry itself
  assert.equal(analyse('獅子', { w: '老虎', alt: [], near: ['獅子', '豹'] }).kind, 'near');
  assert.equal(analyse('豹', { w: '老虎', alt: [], near: ['獅子', '豹'] }).kind, 'near');
});

test('judge: strictness', () => {
  const wheel = { w: '摩天輪', alt: ['ferris wheel'] };
  assert.equal(analyse('摩天輪', wheel, 'strict').kind, 'right');
  assert.equal(analyse(' 摩天輪！', wheel, 'strict').kind, 'right', 'strict still ignores spaces and punctuation');
  assert.equal(analyse('Ferris Wheel', wheel, 'strict').kind, 'right', 'and case');
  assert.equal(analyse('摩天轮', wheel, 'strict').kind, 'close', 'strict: another script is only close, never public text');
  assert.equal(analyse('係摩天輪', wheel, 'strict').kind, 'close', 'strict: no filler stripping');
  assert.equal(analyse('太空船', wheel, 'strict').kind, 'wrong');
  assert.equal(analyse('摩天轮', wheel, 'standard').kind, 'right');
  assert.equal(analyse('摩天輪機', wheel, 'standard').kind, 'close');
  assert.equal(analyse('摩天輪機', wheel, 'loose').kind, 'right', 'loose: contained, within answer + 2');
  assert.equal(analyse('摩天', wheel, 'loose').kind, 'right', 'loose: a ≥ 2-character piece');
  assert.equal(analyse('我估係摩天輪啦', wheel, 'loose').kind, 'right', 'loose strips a filler first, then accepts the contained answer');
  assert.equal(analyse('我估係摩天輪啦', wheel, 'standard').kind, 'close', 'standard removes at most ONE leading filler');
  assert.equal(analyse('我覺得係摩天輪啦', wheel, 'loose').kind, 'close', 'a long sentence is not accepted even when loose');
  assert.equal(analyse('摩天輪同老虎同獅子', wheel, 'loose').kind, 'close', 'loose never accepts a list of answers');
  assert.equal(analyse('老虎', wheel, 'loose').kind, 'wrong');
});

test('judge: a wrong (public) guess never contains the answer — property over the whole real bank', () => {
  const variants = (w) => [`我估係${w}？可能係`, `${w}${w}`, `${w}同老虎`, `${w}。`, ` ${w.split('').join(' ')} `];
  let n = 0;
  for (const e of FLAT) {
    if (n++ % 3) continue;                         // a third of the bank keeps this quick
    for (const strictness of ['strict', 'standard', 'loose']) {
      for (const g of variants(e.w)) {
        const r = analyse(g, e, strictness);
        if (strictness !== 'loose' && g.replace(/[\s。]/g, '') !== e.w) assert.notEqual(r.kind, 'wrong', `${e.w} / ${g} / ${strictness}`);
        if (r.kind === 'wrong') assert.ok(!normalise(g).includes(normalise(e.w)), `${e.w} leaked through ${g}`);
      }
      // the plain word, an alt and its simplified form are always right under standard, and under strict when spelled exactly
      if (strictness === 'standard') {
        assert.equal(analyse(e.w, e, 'standard').kind, 'right', e.w);
        for (const a of e.alt) assert.equal(analyse(a, e, 'standard').kind, 'right', `${e.w} ← ${a}`);
      }
      assert.equal(analyse(e.w, e, 'strict').kind, 'right', e.w);
    }
  }
});

// ============================================================
// setup, queue, offers
// ============================================================

test('draw-guess: every seat draws exactly `cycles` times and the first drawer is random over ALL seats', () => {
  for (const n of [3, 5, 8, 12]) {
    const sim = mk(n, 4);
    const count = {};
    for (const q of sim.state.queue) count[q.drawer] = (count[q.drawer] ?? 0) + 1;
    assert.equal(Object.keys(count).length, n);
    for (const c of Object.values(count)) assert.equal(c, sim.state.cfg.cycles);
    // seat order, cyclic
    const order = sim.state.order;
    for (let i = 0; i < sim.state.queue.length; i++) assert.equal(sim.state.queue[i].drawer, order[(order.indexOf(sim.state.queue[0].drawer) + i) % n]);
  }
  const first = new Set();
  for (let seed = 1; seed <= 80; seed++) first.add(mk(6, seed).state.queue[0].drawer);
  assert.equal(first.size, 6, 'every seat can draw first');
});

test('draw-guess: each turn offers three different words — easy, medium, hard — never repeated in a game', () => {
  const sim = mk(5, 3);
  const seen = new Set();
  for (let turn = 0; turn < 6; turn++) {
    const o = T(sim).offers;
    assert.equal(o.length, 3);
    assert.deepEqual(o.map((x) => x.level), [1, 2, 3]);
    assert.equal(new Set(o.map((x) => x.w)).size, 3);
    for (const x of o) { assert.ok(!seen.has(x.w), `${x.w} offered twice`); seen.add(x.w); }
    pick(sim, 2);
    sim.advance(); sim.advance(); sim.advance(); sim.advance();   // let the clock run out (hints, then the buzzer)
    toReveal(sim);
    toNext(sim);
  }
  assert.equal(sim.state.seen.length, new Set(sim.state.seen).size);
});

test('draw-guess: the tier and category filters decide what is offered, borrowing the nearest tier when a pool is empty', () => {
  const hard = mk(4, 2, { topics: { cats: [], levels: [3] } });
  assert.deepEqual(T(hard).offers.map((o) => o.level), [3, 3, 3]);
  const easyHard = mk(4, 2, { topics: { cats: [], levels: [1, 3] } });
  assert.ok(T(easyHard).offers.every((o) => o.level === 1 || o.level === 3));
  const cat = mk(4, 2, { topics: { cats: ['甲類', '乙類'], levels: [] } });
  assert.ok(T(cat).offers.every((o) => ['甲類', '乙類'].includes(o.cat)));
  // only tier-1 words exist but tier 2 and 3 are wanted: borrow
  const onlyEasy = mk(4, 2, {}, bankOf(UBANK.filter((e) => e.level === 1)));
  assert.equal(T(onlyEasy).offers.length, 3);
  assert.ok(T(onlyEasy).offers.every((o) => o.level === 1));
  // a category that matches nothing: relax the category, never fail
  const none = mk(4, 2, { topics: { cats: ['不存在'], levels: [] } });
  assert.equal(T(none).offers.length, 3);
});

test('draw-guess: a missing or empty bank never kills a turn (built-in emergency words)', () => {
  for (const banks of [{}, bankOf([]), { draw: [{ w: '', alt: [], level: 1, cat: 'x' }, null] }]) {
    const sim = mk(4, 1, {}, banks);
    assert.equal(T(sim).offers.length, 3);
    assert.equal(new Set(T(sim).offers.map((o) => o.w)).size, 3);
    pick(sim, 2);
    assert.equal(sim.state.phase, 'play');
  }
  // a bag that throws (bank never loaded)
  const sim = mk(4, 1);
  const s = clone(sim.state);
  const thrower = { draw() { throw new Error('bank not loaded'); } };
  const next = engine.setup({ players: makePlayers(4), config: config.defaults(4), rng: mulberry32(2), now: 5, bag: thrower, hostPid: 'p1' });
  assert.equal(next.turn.offers.length, 3);
  assert.ok(s);
});

test('draw-guess: picking, one re-roll, the choice timeout and who may choose', () => {
  const sim = mk(5, 6);
  const old = T(sim).offers.map((o) => o.w);
  const stranger = sim.state.order.find((p) => p !== D(sim));
  assert.equal(sim.act(stranger, { type: 'pick', i: 0 }), false, 'only the drawer picks');
  assert.equal(sim.act(stranger, { type: 'reroll' }), false);
  for (const bad of [-1, 3, 1.5, '1', null, undefined]) assert.equal(sim.act(D(sim), { type: 'pick', i: bad }), false, String(bad));
  assert.equal(sim.state.phase, 'choose');
  assert.ok(view(sim, D(sim)).choose.canReroll);
  assert.ok(sim.act(D(sim), { type: 'reroll' }));
  const fresh = T(sim).offers.map((o) => o.w);
  assert.equal(fresh.filter((w) => old.includes(w)).length, 0, 're-roll deals three NEW words');
  assert.equal(sim.act(D(sim), { type: 'reroll' }), false, 'a second re-roll is rejected');
  assert.equal(view(sim, D(sim)).choose.canReroll, false);
  assert.equal(sim.state.deadline, sim.now + 20000, 'a re-roll restarts the choice clock');
  // timeout → the medium card
  sim.advance();
  assert.equal(sim.state.phase, 'play');
  assert.equal(T(sim).word.level, 2);
  assert.ok(!old.some((w) => sim.state.seen.indexOf(w) < 0), 'burned words stay out of the game');
});

test('draw-guess: unpicked offers go back to the bag (when it can take them)', () => {
  const sim = mk(4, 3);
  const released = [];
  sim.bag.release = (bank, key) => released.push([bank, key]);
  const offers = T(sim).offers.map((o) => o.w);
  const i = 1;
  sim.act(D(sim), { type: 'pick', i });
  assert.deepEqual(released.map((r) => r[0]), ['draw', 'draw']);
  assert.deepEqual(released.map((r) => r[1]).sort(), offers.filter((_, j) => j !== i).sort());
  // a re-roll releases all three burned offers
  const sim2 = mk(4, 3);
  const rel2 = [];
  sim2.bag.release = (b, k) => rel2.push(k);
  const before = T(sim2).offers.map((o) => o.w);
  sim2.act(D(sim2), { type: 'reroll' });
  assert.deepEqual(rel2.sort(), before.sort());
  // and a bag without release is fine (the default)
  const sim3 = mk(4, 3);
  assert.ok(sim3.act(D(sim3), { type: 'pick', i: 0 }));
});

const view = (sim, pid) => sim.view(pid);

// ============================================================
// the clock and the hints
// ============================================================

/** Reveal times for a word with these tiers: 20 s category, 40 s first character, 60 s second (4+ characters). */
test('draw-guess: the hint clock — mask first, category at 1/4, a character at 1/2, a second at 3/4 (4+ characters only)', () => {
  const sim = mk(4, 2, { roundSeconds: 80 }, bankOf(TRIO));
  const w = pick(sim, '守株待兔');
  const t0 = sim.now;
  const o = engine.view(sim.state, guessers(sim)[0]);
  assert.equal(o.play.mask.n, 4);
  assert.deepEqual(o.play.mask.cells, ['', '', '', '']);
  assert.equal(o.play.cat, null);
  assert.equal(sim.state.deadline, t0 + 20000);
  assert.equal(o.deadline, t0 + 80000, 'the view carries the END of the turn, not the next hint');
  sim.advance();                                   // 20 s
  let v = view(sim, guessers(sim)[0]);
  assert.equal(v.play.cat, '成語');
  assert.equal(v.play.mask.cells.filter(Boolean).length, 0);
  assert.equal(sim.now, t0 + 20000);
  sim.advance();                                   // 40 s
  v = view(sim, guessers(sim)[0]);
  assert.equal(v.play.mask.cells.filter(Boolean).length, 1);
  sim.advance();                                   // 60 s
  v = view(sim, guessers(sim)[0]);
  const shown = v.play.mask.cells.filter(Boolean);
  assert.equal(shown.length, 2);
  assert.equal(sim.now, t0 + 60000);
  for (const c of shown) assert.ok(w.includes(c));
  assert.equal(v.deadline, t0 + 80000);
  assert.equal(sim.state.deadline, t0 + 80000, 'after the last hint the deadline IS the end');
  // the revealed characters keep their order and never change
  const first = T(sim).reveals.slice();
  assert.deepEqual(first, T(sim).reveals);
});

test('draw-guess: short words get fewer reveals; hints off and single-category filters drop their events', () => {
  const reveals = (word, over = {}) => {
    const bank = bankOf([{ w: word, alt: [], level: 1, cat: '甲類' }, { w: '乙乙乙', alt: [], level: 2, cat: '乙類' }, { w: '丙丙丙丙', alt: [], level: 3, cat: '丙類' }]);
    const sim = mk(4, 2, over, bank);
    pick(sim, word);
    return { evs: T(sim).pending.slice(), max: Math.min(2, Math.floor(Array.from(word.replace(/[\s-]/g, '')).length / 2)), sim };
  };
  assert.deepEqual(reveals('貓').evs, ['cat'], 'one character: no reveal, only the category');
  assert.deepEqual(reveals('老虎').evs, ['cat', 'r']);
  assert.deepEqual(reveals('摩天輪').evs, ['cat', 'r']);
  assert.deepEqual(reveals('守株待兔').evs, ['cat', 'r', 'r']);
  assert.deepEqual(reveals('hello world').evs, ['cat', 'r', 'r']);
  assert.deepEqual(reveals('守株待兔', { hints: false }).evs, []);
  assert.deepEqual(reveals('守株待兔', { topics: { cats: ['甲類'], levels: [] } }).evs, ['r', 'r'], 'a one-category game has no category hint');
  // words with a space or hyphen show the gap; the gap is never revealed and is not counted as a box
  const sim = reveals('ice-cream 機').sim;
  const cells = view(sim, guessers(sim)[0]).play.mask.cells;
  assert.equal(cells.filter((c) => c === ' ').length, 2);
  assert.equal(view(sim, guessers(sim)[0]).play.mask.n, 9);
  sim.advance(); sim.advance(); sim.advance();
  for (const c of view(sim, guessers(sim)[0]).play.mask.cells) assert.ok(c === '' || c === ' ' || c.length === 1);
  assert.ok(!view(sim, guessers(sim)[0]).play.mask.cells.some((c, i) => c === ' ' && Array.from('ice-cream 機')[i] !== ' ' && Array.from('ice-cream 機')[i] !== '-'));
});

test('draw-guess: pause is generic — shifting state.deadline shifts the whole hint chain and the end', () => {
  const sim = mk(4, 2, { roundSeconds: 80 }, bankOf(TRIO));
  pick(sim, '守株待兔');
  const end0 = endOf(sim);
  sim.state.deadline += 12345;                      // what Session.resume() does
  assert.equal(endOf(sim), end0 + 12345);
  assert.equal(view(sim, guessers(sim)[0]).deadline, end0 + 12345);
  const dl = sim.state.deadline;
  sim.advance();
  assert.equal(sim.now, dl);
  assert.equal(endOf(sim), end0 + 12345, 'a hint event never moves the end');
  // advance is a no-op while the deadline is in the future
  const before = JSON.stringify(sim.state);
  assert.equal(engine.advance(clone(sim.state), { rng: sim.rng, now: sim.now - 1, bag: sim.bag }) === undefined, false);
  assert.equal(JSON.stringify(engine.advance(clone(sim.state), { rng: sim.rng, now: sim.now - 1, bag: sim.bag })), before);
});

test('draw-guess: the host can add 30 s; nobody else can', () => {
  const sim = mk(5, 2, { roundSeconds: 80 }, bankOf(TRIO));
  assert.equal(sim.act('p1', { type: 'extend' }), false, 'not during choose');
  pick(sim, '守株待兔');
  const end0 = endOf(sim);
  const other = sim.state.order.find((p) => p !== 'p1');
  assert.equal(sim.act(other, { type: 'extend' }), false);
  assert.ok(sim.act('p1', { type: 'extend' }));
  assert.equal(endOf(sim), end0 + 30000);
  assert.equal(T(sim).T, 110000, 'T grows too, so r keeps its meaning');
  assert.equal(sim.state.deadline, sim.now + 20000, 'the next hint did not move');
  sim.advance(); sim.advance(); sim.advance();
  assert.equal(sim.state.deadline, endOf(sim));
  assert.ok(sim.act('p1', { type: 'extend' }), 'also after the last hint');
  assert.equal(T(sim).T, 140000);
  // a host menu may dispatch the same moves as the host itself (a single shared phone)
  const viaHost = mk(5, 2, { roundSeconds: 80 }, bankOf(TRIO), { hostPid: null });
  pick(viaHost, '守株待兔');
  const e1 = endOf(viaHost);
  assert.ok(viaHost.host({ type: 'extend' }));
  assert.equal(endOf(viaHost), e1 + 30000);
  assert.ok(viaHost.host({ type: 'void' }));
  assert.equal(T(viaHost).outcome, 'voided');
  // without a hostPid there is no host SEAT to extend or void
  const noHost = mk(5, 2, { roundSeconds: 80 }, bankOf(TRIO), { hostPid: null });
  pick(noHost, '守株待兔');
  assert.equal(noHost.act('p1', { type: 'extend' }), false);
  assert.equal(noHost.act('p1', { type: 'void' }), false);
  assert.equal(view(noHost, 'p1').mod, false);
  assert.equal(view(sim, 'p1').mod, true);
});

// ============================================================
// scoring
// ============================================================

const solver = (pid, r, T = 80000) => ({ pid, rem: Math.round(r * T), T, via: 'accept' });
const entry = (over) => ({ outcome: 'solved', level: 1, team: null, drawer: 'p1', E: 5, fouled: false, solvers: [], ...over });

test('draw-guess: scoring reproduces every worked example of the research doc', () => {
  const cases = [
    [{ level: 1, solvers: [solver('a', 0.75)], E: 1 }, { G: [25] }],
    [{ level: 1, solvers: [solver('a', 0.25)], E: 1 }, { G: [15] }],
    [{ level: 1, solvers: [solver('a', 0)], E: 1 }, { G: [10] }],
    [{ level: 3, solvers: [solver('a', 0.75)], E: 1 }, { G: [50] }],
    [{ level: 1, E: 5, solvers: [solver('a', 0.9), solver('b', 0.6), solver('c', 0.2)] }, { G: [28, 22, 14], D: 17 }],
    [{ level: 1, E: 3, solvers: [solver('a', 0.8), solver('b', 0.7), solver('c', 0.5)] }, { G: [26, 24, 20], D: 23 }],
    [{ level: 2, E: 5, solvers: [solver('a', 0.5)] }, { G: [30], D: 18 }],
  ];
  for (const [e, want] of cases) {
    const r = scoreEntry(entry(e), {});
    assert.deepEqual(e.solvers.map((x) => r.solverPts[x.pid]), want.G, JSON.stringify(e));
    if (want.D !== undefined) assert.equal(r.drawerPts, want.D, JSON.stringify(e));
  }
  // the tier ranges: easy 10–30, medium 15–45, hard 20–60
  for (const [level, lo, hi] of [[1, 10, 30], [2, 15, 45], [3, 20, 60]]) {
    assert.equal(scoreEntry(entry({ level, solvers: [solver('a', 0)] }), {}).solverPts.a, lo);
    assert.equal(scoreEntry(entry({ level, solvers: [solver('a', 1)] }), {}).solverPts.a, hi);
  }
  // earlier always pays more
  let prev = Infinity;
  for (let rem = 80000; rem >= 0; rem -= 4000) {
    const g = scoreEntry(entry({ level: 2, solvers: [{ pid: 'a', rem, T: 80000 }] }), {}).solverPts.a;
    assert.ok(g <= prev);
    prev = g;
  }
});

test('draw-guess: scoring edge cases — rounding half up, no solver, foul, abandon, void, E = 0, extended T', () => {
  // 10.5 rounds UP to 11 (integer arithmetic, no floating point)
  assert.equal(scoreEntry(entry({ level: 1, solvers: [{ pid: 'a', rem: 1, T: 40 }] }), {}).solverPts.a, 11);
  assert.equal(scoreEntry(entry({ level: 1, solvers: [{ pid: 'a', rem: 3, T: 40 }] }), {}).solverPts.a, 12);
  assert.deepEqual(scoreEntry(entry({ solvers: [] }), {}).deltas, {});
  assert.equal(scoreEntry(entry({ solvers: [solver('a', 0.5)], fouled: true }), {}).drawerPts, 0, 'foul upheld: the drawer gets nothing');
  assert.equal(scoreEntry(entry({ solvers: [solver('a', 0.5)], fouled: true }), {}).solverPts.a, 20, '…and the guesser keeps the points');
  for (const outcome of ['abandoned', 'voided']) assert.deepEqual(scoreEntry(entry({ outcome, solvers: [solver('a', 0.5)] }), {}).deltas, {}, outcome);
  assert.equal(scoreEntry(entry({ E: 0, solvers: [solver('a', 0.5)] }), {}).drawerPts, 0);
  assert.equal(scoreEntry(entry({ level: 1, solvers: [{ pid: 'a', rem: 110000, T: 110000 }] }), {}).solverPts.a, 30, 'T after +30 s');
  // team scoring
  assert.equal(scoreEntry(entry({ team: 0, level: 3, solvers: [solver('a', 0.1)] }), {}).teamPts, 1);
  assert.equal(scoreEntry(entry({ team: 0, level: 3, solvers: [solver('a', 0.1)] }), { starsAsPoints: true }).teamPts, 3);
  assert.equal(scoreEntry(entry({ team: 0, level: 3, fouled: true, solvers: [solver('a', 0.1)] }), {}).teamPts, 0);
  assert.deepEqual(scoreEntry(entry({ team: 0, solvers: [solver('a', 0.1)] }), {}).deltas, {}, 'team mode: individuals score nothing');
});

// ============================================================
// shout mode
// ============================================================

test('draw-guess shout: the drawer taps who got it; one tap opens a 3 s grace window and scores from the tap time', () => {
  const sim = mk(6, 3, { roundSeconds: 80 }, bankOf(TRIO));
  pick(sim, '摩天輪');                                  // medium
  const [a, b] = guessers(sim);
  const stranger = a;
  assert.equal(sim.act(stranger, { type: 'accept', target: b }), false, 'only the drawer may accept');
  assert.equal(sim.act(D(sim), { type: 'accept', target: D(sim) }), false, 'not themselves');
  assert.equal(sim.act(D(sim), { type: 'accept', target: 'nobody' }), false);
  assert.equal(sim.act(D(sim), { type: 'accept', target: a, gid: 3 }), true, 'a target tap is accepted (a gid is ignored in shout mode)');
  assert.equal(T(sim).sub, 'grace');
  at(sim, 0.5);   // (the tap above happened at r ≈ 1; the next lines use a fresh game)
  const s2 = mk(6, 3, { roundSeconds: 80 }, bankOf(TRIO));
  pick(s2, '摩天輪');
  at(s2, 0.5);
  const tap = s2.now;
  assert.ok(s2.act(D(s2), { type: 'accept', target: guessers(s2)[0] }));
  assert.equal(T(s2).sub, 'grace');
  assert.equal(s2.state.deadline, tap + 3000);
  assert.equal(view(s2, null).deadline, tap + 3000);
  assert.equal(view(s2, null).sub, 'grace');
  assert.deepEqual(view(s2, null).play.solved, [guessers(s2)[0]]);
  assert.equal(s2.act(D(s2), { type: 'accept', target: guessers(s2)[0] }), false, 'no double accept');
  // a co-winner inside the window takes the SAME r as the first
  s2.now += 1500;
  assert.ok(s2.act(D(s2), { type: 'accept', target: guessers(s2)[1] }));
  assert.equal(T(s2).solvers[0].rem, T(s2).solvers[1].rem);
  assert.equal(s2.state.deadline, tap + 3000, 'adding a co-winner does not extend the window');
  s2.advance();                                        // the window closes → the turn ends
  assert.equal(s2.state.phase, 'reveal');
  assert.equal(T(s2).outcome, 'solved');
  const h = s2.state.history[0];
  assert.deepEqual([h.solverPts[guessers(s2)[0]], h.solverPts[guessers(s2)[1]]], [30, 30]);    // medium, r = 0.5
  assert.equal(h.drawerPts, Math.round(30 * (0.5 + 0.5 * 2 / 5)));
  assert.equal(s2.state.scores[D(s2)], h.drawerPts);
  assert.equal(s2.state.scores[guessers(s2)[0]], 30);
});

test('draw-guess shout: the grace window can undo a mis-tap and the clock resumes exactly where it was', () => {
  const sim = mk(5, 5, { roundSeconds: 80 }, bankOf(TRIO));
  pick(sim, '守株待兔');
  sim.advance();                                       // the category hint fires at 20 s …
  sim.now += 4000;                                     // … and this tap comes at 24 s: 70% of the clock is left
  assert.equal(Math.round((endOf(sim) - sim.now) / 800), 70);
  const [a, b] = guessers(sim);
  const endBefore = endOf(sim);
  const dlBefore = sim.state.deadline;
  const pendingBefore = T(sim).pending.slice();
  const tap = sim.now;
  sim.act(D(sim), { type: 'accept', target: a });
  sim.act(D(sim), { type: 'accept', target: b });
  sim.now = tap + 1200;
  assert.equal(sim.act(a, { type: 'undo-accept' }), false, 'only the drawer undoes');
  assert.ok(sim.act(D(sim), { type: 'undo-accept', target: a }));
  assert.deepEqual(T(sim).solvers.map((x) => x.pid), [b]);
  assert.equal(T(sim).sub, 'grace');
  assert.ok(sim.act(D(sim), { type: 'undo-accept' }), 'undo the last one');
  assert.equal(T(sim).sub, 'run', 'back to play');
  assert.equal(T(sim).solvers.length, 0);
  assert.deepEqual(T(sim).pending, pendingBefore);
  assert.equal(sim.state.deadline, sim.now + (dlBefore - tap), 'the clock was frozen during the grace window');
  assert.equal(endOf(sim), sim.now + (endBefore - tap));
  assert.equal(sim.act(D(sim), { type: 'undo-accept' }), false, 'nothing left to undo');
  // after the window closed the result is final
  sim.act(D(sim), { type: 'accept', target: a });
  sim.advance();
  assert.equal(sim.state.phase, 'reveal');
  assert.equal(sim.act(D(sim), { type: 'undo-accept' }), false);
  assert.equal(sim.act(D(sim), { type: 'accept', target: b }), false);
});

test('draw-guess shout: nobody accepted by the deadline → a 2 s buzzer window; a late tap scores with r = 0', () => {
  const sim = mk(5, 5, { roundSeconds: 80 }, bankOf(TRIO));
  pick(sim, '摩天輪');
  while (T(sim).pending.length) sim.advance();
  assert.equal(T(sim).sub, 'run');
  const end = sim.state.deadline;
  sim.advance();                                       // the clock runs out
  assert.equal(T(sim).sub, 'buzzer');
  assert.equal(sim.state.deadline, end + 2000);
  assert.equal(sim.state.phase, 'play');
  assert.equal(view(sim, guessers(sim)[0]).sub, 'buzzer');
  assert.equal(sim.act(D(sim), { type: 'abandon' }), true, 'abandon is still possible in the buzzer window');

  // research B.3: every tap in the buzzer window scores r = 0, each can be undone until it closes, and the
  // turn ends when the WINDOW closes (a buzzer tap does not open a 3 s grace window of its own)
  const s2 = mk(5, 5, { roundSeconds: 80 }, bankOf(TRIO));
  pick(s2, '摩天輪');
  while (T(s2).pending.length) s2.advance();
  s2.advance();
  const closes = s2.state.deadline;
  s2.now += 1000;
  const [g1, g2, g3] = guessers(s2);
  assert.ok(s2.act(D(s2), { type: 'accept', target: g1 }));
  assert.equal(T(s2).sub, 'buzzer', 'still the buzzer window');
  assert.equal(s2.state.deadline, closes, 'a tap does not extend the window');
  assert.equal(T(s2).solvers[0].rem, 0);
  assert.ok(s2.act(D(s2), { type: 'accept', target: g2 }), 'a second shout at the buzzer counts too');
  assert.ok(s2.act(D(s2), { type: 'accept', target: g3 }));
  assert.ok(s2.act(D(s2), { type: 'undo-accept', target: g3 }), 'a mis-tap in the buzzer window can be undone');
  assert.deepEqual(T(s2).solvers.map((x) => x.pid), [g1, g2]);
  assert.ok(engine.legalActions(s2.state, D(s2)).some((a) => a.type === 'undo-accept'));
  assert.equal(view(s2, null).sub, 'buzzer');
  s2.advance();
  assert.equal(s2.state.phase, 'reveal');
  assert.equal(T(s2).outcome, 'solved');
  assert.equal(s2.state.history[0].solverPts[g1], 15, 'medium, r = 0: 15 points');
  assert.equal(s2.state.history[0].solverPts[g2], 15);
  assert.equal(s2.state.history[0].drawerPts, Math.round(15 * (0.5 + 0.5 * 2 / 4)));
  assert.equal(s2.act(D(s2), { type: 'undo-accept' }), false, 'final once the window closed');
  // every buzzer tap undone → nobody scores
  const s4 = mk(5, 5, { roundSeconds: 80 }, bankOf(TRIO));
  pick(s4, '摩天輪');
  while (T(s4).sub === 'run') s4.advance();
  s4.act(D(s4), { type: 'accept', target: guessers(s4)[0] });
  s4.act(D(s4), { type: 'undo-accept' });
  assert.equal(T(s4).sub, 'buzzer');
  assert.equal(engine.legalActions(s4.state, D(s4)).some((a) => a.type === 'undo-accept'), false, 'nothing left to undo');
  s4.advance();
  assert.equal(T(s4).outcome, 'timeout');
  // the buzzer window runs out → timeout, nobody scores, the word is still revealed
  const s3 = mk(5, 5, { roundSeconds: 80 }, bankOf(TRIO));
  pick(s3, '摩天輪');
  while (T(s3).pending.length) s3.advance();
  s3.advance();
  s3.advance();
  assert.equal(s3.state.phase, 'reveal');
  assert.equal(T(s3).outcome, 'timeout');
  assert.deepEqual(Object.values(s3.state.scores), [0, 0, 0, 0, 0]);
  assert.equal(view(s3, guessers(s3)[0]).reveal.w, '摩天輪');
  assert.equal(s3.act(D(s3), { type: 'accept', target: guessers(s3)[0] }), false, 'too late');
});

test('draw-guess shout: a tap that lands after the deadline but before its timer fired counts only within 2 s', () => {
  const mkRun = () => {
    const sim = mk(5, 5, { roundSeconds: 80 }, bankOf(TRIO));
    pick(sim, '摩天輪');
    return sim;
  };
  const a = mkRun();
  const end = endOf(a);
  a.now = end + 1500;
  assert.ok(a.act(D(a), { type: 'accept', target: guessers(a)[0] }));
  assert.equal(T(a).solvers[0].rem, 0);
  assert.equal(T(a).sub, 'buzzer', 'the tap lands in the buzzer window');
  assert.equal(a.state.deadline, end + 2000, 'which still closes 2 s after the real end');
  assert.equal(view(a, guessers(a)[1]).play.mask.cells.filter(Boolean).length, T(a).reveals.length, 'the overdue hints fired');
  a.advance();
  assert.equal(T(a).outcome, 'solved');
  const b = mkRun();
  b.now = endOf(b) + 2500;
  assert.equal(b.act(D(b), { type: 'accept', target: guessers(b)[0] }), false);
  // a tap before the end, with the hint timers still pending, restores them after an undo
  const c = mkRun();
  c.now = endOf(c) - 1000;
  c.act(D(c), { type: 'accept', target: guessers(c)[0] });
  assert.equal(T(c).solvers[0].rem, 1000);
});

test('draw-guess: abandon, void (host only, re-queued once), skipping and the stalled-drawer auto-act', () => {
  const sim = mk(4, 2, { roundSeconds: 80 }, bankOf(TRIO));
  assert.equal(sim.state.queue.length, 8);
  pick(sim, '守株待兔');
  const [a] = guessers(sim);
  assert.equal(sim.act(a, { type: 'abandon' }), false);
  assert.ok(sim.act(D(sim), { type: 'abandon' }));
  assert.equal(T(sim).outcome, 'abandoned');
  assert.deepEqual(Object.values(sim.state.scores), [0, 0, 0, 0]);
  assert.equal(sim.state.queue.length, 8, 'an abandoned turn counts as the drawer\'s turn');
  assert.equal(view(sim, a).reveal.w, '守株待兔', 'the word is still shown');
  // void: the host only; nobody scores; the drawer is queued again at the END, once
  const v = mk(4, 2, { roundSeconds: 80 }, bankOf(TRIO));
  const first = D(v);
  pick(v, '摩天輪');
  v.act(guessers(v)[0], { type: 'accept', target: guessers(v)[1] });
  assert.equal(v.act(guessers(v).find((p) => p !== 'p1'), { type: 'void' }), false, 'a player cannot void');
  assert.ok(v.act('p1', { type: 'void' }));
  assert.equal(T(v).outcome, 'voided');
  assert.equal(v.state.queue.length, 9);
  assert.deepEqual(v.state.queue[8], { drawer: first, team: null, again: true });
  assert.deepEqual(Object.values(v.state.scores), [0, 0, 0, 0]);
  assert.equal(v.state.history.at(-1).outcome, 'voided');
  // void during the choice works too; a re-queued turn that is voided again is NOT queued a third time
  const w = mk(4, 2, {}, bankOf(UBANK));
  assert.ok(w.act('p1', { type: 'void' }));
  assert.equal(w.state.queue.length, 9);
  // play to the re-queued turn and void it again
  let guard = 0;
  while (!(T(w).again && w.state.phase === 'choose') && guard++ < 200) {
    if (w.state.phase === 'choose') pick(w, 2);
    else if (w.state.phase === 'play') w.act(D(w), { type: 'abandon' });
    else toNext(w);
  }
  assert.ok(T(w).again, 'reached the re-queued turn');
  assert.equal(view(w, null).turn.again, true);
  w.act('p1', { type: 'void' });
  assert.equal(w.state.queue.length, 9, 'a second void does not queue it again');
  // the shell's 呢鋪唔計 (@void-round) is the same move, from the host menu: in the choice, in play, even in the reveal
  for (const stage of ['choose', 'play', 'reveal']) {
    const vr = mk(4, 2, { roundSeconds: 80 }, bankOf(TRIO));
    const drawer = D(vr);
    const released = [];
    vr.bag.release = (b, k) => released.push(k);
    if (stage !== 'choose') pick(vr, '摩天輪');
    if (stage === 'reveal') { vr.act(drawer, { type: 'accept', target: guessers(vr)[0] }); vr.advance(); assert.equal(T(vr).outcome, 'solved'); }
    assert.ok(vr.host({ type: ACT.VOID_ROUND }), stage);
    assert.equal(vr.state.phase, 'reveal', stage);
    assert.equal(T(vr).outcome, 'voided');
    assert.equal(vr.state.history.at(-1).outcome, 'voided');
    assert.deepEqual(Object.values(vr.state.scores), [0, 0, 0, 0], `${stage}: a voided turn scores nothing`);
    assert.deepEqual(vr.state.queue.at(-1), { drawer, team: null, again: true }, `${stage}: re-queued at the end`);
    assert.equal(vr.state.queue.length, 9);
    if (stage !== 'choose') assert.ok(released.includes('摩天輪'), `${stage}: the word goes back to the bag`);
    else assert.equal(released.length, 3, 'choice: all three offers go back');
    assert.equal(vr.host({ type: ACT.VOID_ROUND }), false, 'voiding twice changes nothing');
    assert.equal(view(vr, null).reveal.outcome, 'voided');
  }
  const ov = mk(3, 2, { cycles: 1 }, bankOf(UBANK));
  while (ov.state.phase !== 'over') { if (ov.state.phase === 'choose') pick(ov, 2); else ov.advance(); }
  assert.equal(ov.host({ type: ACT.VOID_ROUND }), false, 'nothing to void after the game');
  // the host's 下一步 skips: choice → auto pick, play → end now, reveal → next turn
  const sk = mk(4, 2, { roundSeconds: 80 }, bankOf(TRIO));
  sk.host({ type: ACT.NEXT });                         // first press acknowledges the cue
  sk.host({ type: ACT.NEXT });
  assert.equal(sk.state.phase, 'play');
  assert.equal(T(sk).word.level, 2);
  sk.host({ type: ACT.NEXT }); sk.host({ type: ACT.NEXT });
  assert.equal(sk.state.phase, 'reveal');
  assert.equal(T(sk).outcome, 'timeout');
  sk.host({ type: ACT.NEXT }); sk.host({ type: ACT.NEXT });
  assert.equal(sk.state.phase, 'choose');
  assert.equal(T(sk).n, 2);
});

test('draw-guess: blocking, autoAct and focus — the table only waits on the drawer while choosing', () => {
  const sim = mk(4, 2, { roundSeconds: 80 }, bankOf(TRIO));
  const other = guessers(sim)[0];
  assert.deepEqual(engine.focus(sim.state), { pids: [D(sim)] });
  assert.equal(engine.blocking(sim.state, D(sim)), true, 'choosing: the drawer is who the table waits for');
  for (const p of guessers(sim)) assert.equal(engine.blocking(sim.state, p), false);
  assert.equal(engine.autoAct(sim.state, other, sim.ctx()), null);
  const a1 = engine.autoAct(sim.state, D(sim), sim.ctx());
  assert.equal(T(sim).offers[a1.i].level, 2, '代佢做 picks the medium card, like the timeout');
  assert.ok(sim.act(D(sim), a1));
  assert.deepEqual(engine.focus(sim.state), { pids: [D(sim)] }, 'the drawer still holds the phone privately (pass gate on a shared phone)');
  for (const p of sim.state.order) {
    assert.equal(engine.blocking(sim.state, p), false, 'nobody blocks a drawing clock: it runs out by itself');
    assert.equal(engine.autoAct(sim.state, p, sim.ctx()), null);
  }
  sim.act(D(sim), { type: 'accept', target: other });
  for (const p of sim.state.order) assert.equal(engine.blocking(sim.state, p), false, 'nor the grace window');
  sim.advance();
  assert.equal(engine.focus(sim.state), null, 'nobody is waited for during the reveal');
  for (const p of sim.state.order) { assert.equal(engine.blocking(sim.state, p), false); assert.equal(engine.autoAct(sim.state, p, sim.ctx()), null); }
  assert.equal(engine.autoAct(sim.state, 'nobody', sim.ctx()), null);
  assert.equal(engine.blocking(sim.state, null), false);
  // the drawer cannot skip the reveal (that would also skip the 5 s foul window): the clock or the host's ⏭ does
  assert.equal(sim.act(D(sim), { type: 'next' }), false);
  assert.deepEqual(engine.legalActions(sim.state, D(sim)), []);
  // the session asks engine.blocking (stall detection ignores everything else)
  const s = new Session({ game, players: makePlayers(4), config: config.defaults(4), rng: mulberry32(1), bag: null, now: () => 5, hostPid: 'p1' });
  const drawer = s.state.turn.drawer;
  assert.equal(s.blocking(drawer), true);
  assert.equal(s.blocking(s.state.order.find((p) => p !== drawer)), false);
});

test('draw-guess: the reveal lasts 7 s for every turn (the last one too); a 5 s leaderboard follows each full cycle', () => {
  const sim = mk(4, 2, { roundSeconds: 45, cycles: 2 }, bankOf(UBANK));   // 8 turns, a cycle = 4 turns
  const seen = [];
  let guard = 0;
  while (sim.state.phase !== 'over' && guard++ < 400) {
    if (sim.state.phase === 'choose') {
      assert.deepEqual(view(sim, null).upNext, sim.state.queue.slice(sim.state.qi + 1, sim.state.qi + 4).map((q) => q.drawer), 'queue preview');
      pick(sim, 2);
      sim.act(D(sim), { type: 'abandon' });
      assert.equal(sim.state.deadline - sim.now, 7000, `turn ${T(sim).n}: 7 s reveal`);
      seen.push(`r${T(sim).n}`);
    } else if (sim.state.phase === 'reveal') {
      sim.advance();
      if (sim.state.phase === 'standings') {
        assert.equal(sim.state.deadline - sim.now, 5000, '5 s leaderboard');
        const v = view(sim, 'p2');
        assert.deepEqual(v.standings, { cycle: 1, cycles: 2 });
        assert.equal(v.title, '排名');
        assert.equal(v.reveal, null);
        assert.equal(v.play, null);
        assert.ok(v.hint.includes('排名'));
        assert.ok(sim.cue().text.startsWith('第一圈完'), sim.cue().text);
        for (const p of sim.state.order) { assert.deepEqual(engine.legalActions(sim.state, p), []); assert.equal(engine.blocking(sim.state, p), false); }
        assert.equal(engine.focus(sim.state), null);
        seen.push('standings');
      }
    } else sim.advance();
  }
  assert.deepEqual(seen, ['r1', 'r2', 'r3', 'r4', 'standings', 'r5', 'r6', 'r7', 'r8'], 'a leaderboard after the first cycle only — never after the last turn');
  assert.deepEqual(view(sim, null).upNext, []);
  // the host's ⏭ skips the leaderboard
  const sk = mk(3, 2, { cycles: 2 }, bankOf(UBANK));
  for (let i = 0; i < 3; i++) { pick(sk, 2); sk.act(D(sk), { type: 'abandon' }); if (i < 2) toNext(sk); else sk.advance(); }
  assert.equal(sk.state.phase, 'standings');
  while (sk.cue()) sk.cueDone();
  assert.ok(sk.host({ type: ACT.NEXT }));
  assert.equal(sk.state.phase, 'choose');
  assert.equal(T(sk).n, 4);
  // teams: a cycle is every team drawing once
  const tm = mk(6, 2, { teamMode: 'teams', teams: 3, teamRounds: 2 }, bankOf(UBANK));
  const phases = [];
  guard = 0;
  while (tm.state.phase !== 'over' && guard++ < 200) {
    if (tm.state.phase === 'choose') { pick(tm, 2); tm.act(D(tm), { type: 'abandon' }); } else { tm.advance(); phases.push(tm.state.phase); }
  }
  assert.deepEqual(phases.filter((x) => x !== 'play'), ['choose', 'choose', 'standings', 'choose', 'choose', 'choose', 'over']);
  // a voided turn's re-queue at the end never adds a leaderboard of its own
  const vq = mk(3, 2, { cycles: 1 }, bankOf(UBANK));
  vq.act('p1', { type: 'void' });
  guard = 0;
  const ph = [];
  while (vq.state.phase !== 'over' && guard++ < 200) {
    if (vq.state.phase === 'choose') { pick(vq, 2); vq.act(D(vq), { type: 'abandon' }); } else { vq.advance(); ph.push(vq.state.phase); }
  }
  assert.ok(!ph.includes('standings'));
  assert.equal(vq.state.history.length, 4);
});

// ============================================================
// typed mode
// ============================================================

const mkTyped = (n = 5, seed = 3, over = {}) => {
  const sim = mk(n, seed, { ...typedCfg, ...over }, bankOf(TRIO));
  pick(sim, '摩天輪');
  return sim;
};
const say = (sim, pid, text, dt = 800) => { sim.now += dt; return sim.act(pid, { type: 'guess', text }); };

test('draw-guess typed: right, close and wrong guesses land in the feed the way each seat may see them', () => {
  const sim = mkTyped(5, 3);
  const [a, b, c] = guessers(sim);
  assert.ok(say(sim, a, '太空船'));                      // wrong
  assert.ok(say(sim, b, '摩天'));                        // close
  assert.ok(say(sim, c, '摩天轮'));                      // right (simplified)
  const feedFor = (pid) => view(sim, pid).feed;
  // the table: wrong text is public, close has no text, right has no text
  const table = feedFor(null);
  assert.deepEqual(table.map((g) => [g.pid, g.kind, g.text ?? null]), [[a, 'wrong', '太空船'], [b, 'close', null], [c, 'right', null]]);
  assert.ok(!JSON.stringify(view(sim, a)).includes('摩天'), 'another guesser never sees the close text');
  assert.ok(!JSON.stringify(view(sim, null)).includes('摩天'));
  assert.equal(feedFor(b).find((g) => g.kind === 'close').text, '摩天', 'the sender sees their own close text');
  assert.equal(feedFor(c).find((g) => g.kind === 'right').text, undefined, 'a correct text is never echoed to a guesser');
  assert.deepEqual(feedFor(D(sim)).map((g) => g.text), ['太空船', '摩天', '摩天轮'], 'the drawer sees everything');
  assert.deepEqual(view(sim, null).play.solved, [c]);
  assert.equal(view(sim, c).play.mine.solved, true);
  assert.equal(view(sim, a).play.mine.solved, false);
  assert.equal(view(sim, D(sim)).play.mine, null);
  // a solved seat cannot type again; the drawer, rivals and non-seats cannot type at all
  assert.equal(say(sim, c, '再估'), false);
  assert.equal(say(sim, D(sim), '摩天輪'), false);
  assert.equal(sim.act('ghost', { type: 'guess', text: '摩天輪' }), false);
});

test('draw-guess typed: input rules — empty, over-long, duplicate, non-string, after the clock', () => {
  const sim = mkTyped(5, 3);
  const [a, b] = guessers(sim);
  for (const bad of ['', '   ', '！！！', 123, null, undefined, '字'.repeat(31)]) {
    assert.equal(sim.act(a, { type: 'guess', text: bad }), false, JSON.stringify(bad));
  }
  assert.ok(sim.act(a, { type: 'guess', text: '字'.repeat(30) }), 'exactly 30 characters is fine');
  assert.ok(say(sim, a, '大象'));
  assert.equal(say(sim, a, ' 大象！'), false, 'the same guess again is ignored silently (after normalising)');
  assert.equal(T(sim).rate[a].n, 2, 'and not counted');
  assert.ok(say(sim, b, '大象'), 'another player may say the same thing');
  sim.now = endOf(sim) + 1;
  assert.equal(say(sim, b, '老虎', 0), false, 'after the deadline (host clock) a guess is ignored');
});

test('draw-guess typed: rate limits — 700 ms apart, a burst of 7 in 10 s locks the input for 5 s, 60 per turn', () => {
  const sim = mkTyped(5, 3);
  const [a] = guessers(sim);
  assert.ok(sim.act(a, { type: 'guess', text: '一' }));
  sim.now += 699;
  assert.equal(sim.act(a, { type: 'guess', text: '二' }), false, '699 ms is too soon');
  sim.now += 1;
  assert.ok(sim.act(a, { type: 'guess', text: '二' }));
  for (const t of ['三', '四', '五', '六']) assert.ok(say(sim, a, t, 700));       // 6 guesses inside 10 s
  const before = sim.now;
  say(sim, a, '七', 700);
  assert.equal(T(sim).rate[a].n, 6, 'the 7th inside 10 s is refused (not counted)…');
  assert.equal(T(sim).guesses.length, 6);
  assert.equal(T(sim).rate[a].lock, sim.now + 5000, '…and locks the input');
  assert.equal(view(sim, a).play.mine.lockUntil, sim.now + 5000, 'the guesser can see how long');
  assert.equal(say(sim, a, '八', 3000), false, 'still locked');
  assert.ok(say(sim, a, '八', 2100), 'lock over');
  assert.ok(sim.now > before + 5000);
  // 60 per turn
  const s2 = mkTyped(5, 3, { roundSeconds: 180 });
  const [p] = guessers(s2);
  let n = 0;
  for (let i = 0; i < 80 && n < 60; i++) {
    s2.now += 1900;                                    // slow enough to never trip the burst limit
    if (s2.act(p, { type: 'guess', text: `估${i}號` })) n++;
    if (endOf(s2) - s2.now < 5000) { s2.state.deadline += 600000; }
  }
  assert.equal(n, 60);
  s2.now += 1900;
  assert.equal(s2.act(p, { type: 'guess', text: '第六十一' }), false, 'at most 60 guesses per player per turn');
  assert.equal(view(s2, p).play.mine.used, 60);
  assert.ok(!engine.legalActions(s2.state, p).some((x) => x.type === 'guess'), 'and legalActions stops offering a guess');
});

test('draw-guess typed: every eligible guesser solving ends the turn at once; points follow the research example', () => {
  // N = 6, three solvers at r = 0.9 / 0.6 / 0.2: G = 28, 22, 14 and the drawer 17 — then the other two solve too
  const sim = mkTyped(6, 3);
  sim.act(D(sim), { type: 'abandon' });                // (only to prove the helper) — restart below
  const s = mk(6, 3, { ...typedCfg }, bankOf([{ w: '老虎', alt: [], level: 1, cat: 'x' }, { w: '乙乙乙', alt: [], level: 2, cat: 'y' }, { w: '丙丙丙丙', alt: [], level: 3, cat: 'z' }]));
  pick(s, '老虎');
  const [a, b, c, d, e] = guessers(s);
  at(s, 0.9); assert.ok(s.act(a, { type: 'guess', text: '老虎' }));
  at(s, 0.6); assert.ok(s.act(b, { type: 'guess', text: '老虎' }));
  at(s, 0.2); assert.ok(s.act(c, { type: 'guess', text: '老虎' }));
  assert.equal(s.state.phase, 'play', 'two guessers have not solved yet');
  assert.deepEqual(T(s).solvers.map((x) => x.pid), [a, b, c], 'solvers are ordered by how early they solved');
  while (s.state.phase === 'play') s.advance();        // the clock runs out (typed: ends at once, no buzzer)
  assert.equal(s.state.phase, 'reveal');
  const h = s.state.history[0];
  assert.deepEqual([h.solverPts[a], h.solverPts[b], h.solverPts[c]], [28, 22, 14]);
  assert.equal(h.drawerPts, 17);
  assert.equal(d && e && true, true);
  // all five solve → the turn ends the moment the last one does
  const all = mk(6, 3, { ...typedCfg }, bankOf(TRIO));
  pick(all, '老虎');
  const gs = guessers(all);
  gs.forEach((g, i) => { all.now += 800; assert.ok(all.act(g, { type: 'guess', text: '虎' }), g); if (i < gs.length - 1) assert.equal(all.state.phase, 'play'); });
  assert.equal(all.state.phase, 'reveal');
  assert.equal(T(all).outcome, 'solved');
  assert.equal(all.state.history[0].solvers.length, 5);
  assert.equal(all.state.history[0].drawerPts > 0, true);
});

test('draw-guess typed: with the clock out the turn ends at once (no buzzer window), solved or not', () => {
  const sim = mkTyped(5, 3);
  while (T(sim).pending.length) sim.advance();
  sim.advance();
  assert.equal(sim.state.phase, 'reveal');
  assert.equal(T(sim).outcome, 'timeout');
  const s2 = mkTyped(5, 3);
  say(s2, guessers(s2)[0], '摩天輪');
  while (s2.state.phase === 'play') s2.advance();
  assert.equal(T(s2).outcome, 'solved');
});

test('draw-guess typed: the drawer can override the checker — in play and for a few seconds into the reveal', () => {
  const sim = mkTyped(5, 3);
  const [a, b] = guessers(sim);
  at(sim, 0.8);
  say(sim, a, '摩天輪機器', 0);                          // close, not accepted by the checker
  const gid = view(sim, D(sim)).feed.at(-1).id;
  const rem = T(sim).guesses.at(-1).rem;
  at(sim, 0.3);
  assert.equal(sim.act(a, { type: 'accept', gid }), false, 'only the drawer accepts');
  assert.equal(sim.act(D(sim), { type: 'accept', gid: 999 }), false);
  assert.equal(sim.act(D(sim), { type: 'accept', target: a }), false, 'typed mode accepts a guess, not a name');
  assert.ok(sim.act(D(sim), { type: 'accept', gid }));
  assert.deepEqual(T(sim).solvers, [{ pid: a, rem, T: 80000, via: 'override' }], 'it counts at the guess\'s own time');
  assert.equal(sim.act(D(sim), { type: 'accept', gid }), false, 'once');
  assert.equal(view(sim, null).feed.find((g) => g.id === gid).kind, 'right');
  // a guess the checker already rejected as WRONG can be accepted late, in the reveal
  say(sim, b, '亂估', 0);
  const gid2 = T(sim).guesses.at(-1).id;
  toReveal(sim);
  assert.equal(T(sim).outcome, 'solved');
  const aPts = sim.state.scores[a];
  assert.ok(aPts > 0);
  const late = view(sim, D(sim)).reveal.lateUntil;
  assert.equal(late, sim.state.deadline - (sim.state.revealMs - 5000));
  sim.now = late - 1;
  assert.ok(sim.act(D(sim), { type: 'accept', gid: gid2 }));
  assert.equal(sim.state.history[0].solvers.length, 2);
  assert.equal(sim.state.scores[a], aPts, 'the first solver\'s points did not change (derived from history, never double counted)');
  assert.ok(sim.state.scores[b] > 0);
  const sumNow = sum(Object.values(sim.state.scores));
  assert.equal(sumNow, sum(Object.values(sim.state.history[0].deltas)));
  // after the window it is final
  const s2 = mkTyped(5, 3);
  say(s2, guessers(s2)[0], '亂估', 0);
  const g3 = T(s2).guesses[0].id;
  toReveal(s2);
  assert.equal(T(s2).outcome, 'timeout');
  s2.now = view(s2, D(s2)).reveal.lateUntil + 1;
  assert.equal(s2.act(D(s2), { type: 'accept', gid: g3 }), false);
  assert.equal(T(s2).outcome, 'timeout');
  // and a timed-out reveal inside the window turns into a solved one
  const s3 = mkTyped(5, 3);
  say(s3, guessers(s3)[0], '亂估', 0);
  const g4 = T(s3).guesses[0].id;
  toReveal(s3);
  assert.ok(s3.act(D(s3), { type: 'accept', gid: g4 }));
  assert.equal(T(s3).outcome, 'solved');
  assert.equal(s3.state.history[0].outcome, 'solved');
  // an abandoned turn cannot be revived
  const s4 = mkTyped(5, 3);
  say(s4, guessers(s4)[0], '亂估', 0);
  const g5 = T(s4).guesses[0].id;
  s4.act(D(s4), { type: 'abandon' });
  assert.equal(s4.act(D(s4), { type: 'accept', gid: g5 }), false);
});

test('draw-guess typed: strictness reaches the engine', () => {
  const run = (strictness, text) => {
    const sim = mk(4, 3, { ...typedCfg, strictness }, bankOf(TRIO));
    pick(sim, '摩天輪');
    sim.now += 800;
    sim.act(guessers(sim)[0], { type: 'guess', text });
    return T(sim).guesses[0].kind;
  };
  assert.equal(run('standard', '係摩天輪呀'), 'right');
  assert.equal(run('strict', '係摩天輪呀'), 'close');
  assert.equal(run('loose', '摩天輪機'), 'right');
  assert.equal(run('standard', '摩天輪機'), 'close');
});

// ============================================================
// fouls
// ============================================================

test('draw-guess: foul flags — 2 and at least half of the others; upheld zeroes the drawer, never the guessers', () => {
  const need = (n) => Math.max(2, Math.ceil((n - 1) / 2));
  assert.deepEqual([3, 4, 5, 8, 12].map(need), [2, 2, 2, 4, 6]);
  const sim = mk(8, 4, { roundSeconds: 80 }, bankOf(TRIO));
  pick(sim, '老虎');
  const [a, b, c, d] = guessers(sim);
  at(sim, 0.5);
  sim.act(D(sim), { type: 'accept', target: a });
  assert.equal(sim.act(D(sim), { type: 'foul' }), false, 'the drawer cannot flag');
  assert.ok(sim.act(b, { type: 'foul' }));
  assert.equal(sim.act(b, { type: 'foul' }), false, 'one flag per player');
  assert.ok(sim.act(a, { type: 'foul' }), 'players who already solved count (they know the word)');
  assert.deepEqual(view(sim, c).play.foul, { n: 2, need: 4, mine: false, can: true });
  assert.deepEqual(view(sim, b).play.foul, { n: 2, need: 4, mine: true, can: false });
  assert.equal(view(sim, D(sim)).play.foul.can, false, 'never the drawer');
  assert.equal(view(sim, null).play.foul.can, false, 'never the table');
  assert.ok(sim.act(c, { type: 'foul' }));
  sim.advance();                                       // the grace window closes
  assert.equal(sim.state.history[0].fouled, false, '3 of 7 flags is not enough');
  assert.ok(sim.state.scores[D(sim)] > 0);
  // in the reveal window the 4th flag tips it over and the drawer loses the points
  const dPts = sim.state.scores[D(sim)];
  assert.ok(dPts > 0);
  assert.ok(sim.act(d, { type: 'foul' }));
  assert.equal(sim.state.history[0].fouled, true);
  assert.equal(sim.state.scores[D(sim)], 0);
  assert.ok(sim.state.scores[a] > 0, 'the guesser keeps the points');
  assert.equal(view(sim, null).reveal.fouled, true);
  // after the window flags are ignored
  const late = sim.state.deadline - (sim.state.revealMs - 5000);
  const e = guessers(sim)[4];
  sim.now = late + 1;
  assert.equal(sim.act(e, { type: 'foul' }), false);
  // three players: both guessers must flag
  const t3 = mk(3, 4, { roundSeconds: 80 }, bankOf(TRIO));
  pick(t3, '老虎');
  const [x, y] = guessers(t3);
  t3.act(D(t3), { type: 'accept', target: x });
  t3.act(x, { type: 'foul' });
  t3.advance();
  assert.equal(t3.state.history[0].fouled, false);
  t3.act(y, { type: 'foul' });
  assert.equal(t3.state.history[0].fouled, true);
  assert.equal(view(t3, null).reveal.foul.can, false, 'flags beyond the threshold are ignored');
  // a timed-out turn has no drawer points to take away: no flags in its reveal
  const to = mk(4, 4, { roundSeconds: 80 }, bankOf(TRIO));
  pick(to, '老虎');
  toReveal(to);
  assert.equal(T(to).outcome, 'timeout');
  assert.equal(to.act(guessers(to)[0], { type: 'foul' }), false);
});

test('draw-guess teams: a rival’s 🚩 stops the clock and the host rules — upheld scores nothing, rejected plays on', () => {
  const sim = mk(6, 5, { teamMode: 'teams', roundSeconds: 60 }, bankOf(TRIO));
  pick(sim, '摩天輪');
  sim.advance();                                       // the category hint
  sim.now += 3000;
  const team = T(sim).team;
  const [r1, r2] = sim.state.teams[1 - team].members;
  const mate = guessers(sim)[0];
  const host = 'p1';
  assert.equal(sim.act(mate, { type: 'foul' }), false, 'teammates do not flag their own drawer');
  assert.equal(view(sim, mate).play.foul.can, false);
  assert.equal(view(sim, r1).play.foul.can, true, 'a rival may');
  assert.ok(engine.legalActions(sim.state, r1).some((a) => a.type === 'foul'));
  const left = endOf(sim) - sim.now;
  const dl = sim.state.deadline - sim.now;
  assert.ok(sim.act(r1, { type: 'foul' }));
  assert.equal(T(sim).sub, 'ruling', 'the clock stops');
  assert.equal(sim.state.deadline, null);
  assert.equal(view(sim, r2).deadline, undefined, 'no running clock on any phone');
  assert.deepEqual(view(sim, mate).play.ruling, { by: r1 });
  assert.equal(engine.canInk(sim.state, D(sim)), false, 'the drawer stops drawing too');
  assert.equal(engine.blocking(sim.state, host), true, 'the table waits on the host');
  assert.equal(engine.blocking(sim.state, D(sim)), false);
  assert.deepEqual(engine.autoAct(sim.state, host, sim.ctx()), { type: 'rule', uphold: false }, '代佢做 = benefit of the doubt');
  assert.ok(sim.cue().text.includes('主持'), 'the narrator says why everything stopped');
  // nothing moves but the ruling
  assert.equal(sim.act(D(sim), { type: 'accept', target: mate }), false);
  assert.equal(sim.act(r2, { type: 'foul' }), false, 'one ruling at a time');
  assert.equal(sim.act(mate, { type: 'rule', uphold: true }), false, 'only the host rules');
  assert.equal(sim.advance(), false, 'no deadline while the ruling is pending');
  for (const p of sim.state.order) {
    const legal = engine.legalActions(sim.state, p);
    if (p === host) assert.deepEqual(legal.map((a) => a.type).sort(), ['rule', 'rule', 'void']);
    else assert.deepEqual(legal, [], p);
  }
  // rejected: the clock carries on exactly where it stopped
  sim.now += 40000;
  assert.ok(sim.act(host, { type: 'rule', uphold: false }));
  assert.equal(T(sim).sub, 'run');
  assert.equal(endOf(sim) - sim.now, left, 'the time left is what it was');
  assert.equal(sim.state.deadline - sim.now, dl);
  assert.equal(sim.act(r1, { type: 'foul' }), false, 'once per rival per turn');
  // the second rival flags; the host upholds: the turn ends, the team scores nothing even after a solve
  sim.act(D(sim), { type: 'accept', target: mate });
  assert.equal(T(sim).sub, 'grace');
  assert.ok(sim.act(r2, { type: 'foul' }), 'a flag inside the grace window works too');
  assert.ok(sim.act(host, { type: 'rule', uphold: true }));
  assert.equal(sim.state.phase, 'reveal');
  assert.equal(T(sim).outcome, 'fouled');
  assert.deepEqual(sim.state.teamScores, [0, 0]);
  assert.equal(view(sim, null).reveal.fouled, true);
  assert.ok(view(sim, null).reveal.headline.includes('犯規成立'));
  // the host's ⏭ during a ruling = not upheld
  const nx = mk(6, 5, { teamMode: 'teams', roundSeconds: 60, hints: false }, bankOf(TRIO));
  pick(nx, '老虎');
  nx.act(nx.state.teams[1 - T(nx).team].members[0], { type: 'foul' });
  while (nx.cue()) nx.cueDone();
  assert.ok(nx.host({ type: ACT.NEXT }));
  assert.equal(T(nx).sub, 'run');
  // a solved team turn can still be flagged in the reveal's first 5 s; upheld there removes the point
  const rv = mk(6, 5, { teamMode: 'teams', roundSeconds: 60 }, bankOf(TRIO));
  pick(rv, '老虎');
  rv.act(D(rv), { type: 'accept', target: guessers(rv)[0] });
  rv.advance();
  assert.equal(sum(rv.state.teamScores), 1);
  const rival = rv.state.teams[1 - T(rv).team].members[0];
  rv.now += 1000;
  const revealLeft = rv.state.deadline - rv.now;
  assert.ok(rv.act(rival, { type: 'foul' }));
  assert.equal(rv.state.deadline, null, 'the reveal waits for the ruling');
  assert.deepEqual(view(rv, null).reveal.ruling, { by: rival });
  assert.equal(engine.blocking(rv.state, 'p1'), true);
  rv.now += 9000;
  assert.ok(rv.act('p1', { type: 'rule', uphold: true }));
  assert.equal(rv.state.deadline - rv.now, revealLeft, 'and then carries on');
  assert.deepEqual(rv.state.teamScores, [0, 0], 'the point is gone');
  assert.equal(rv.state.history[0].fouled, true);
  assert.equal(rv.state.history[0].outcome, 'solved', 'they did solve it — the foul is why it scores nothing');
  assert.ok(sim.result() === null);
  // void during a ruling ends the turn as voided
  const vd = mk(6, 5, { teamMode: 'teams', roundSeconds: 60 }, bankOf(TRIO));
  pick(vd, '老虎');
  vd.act(vd.state.teams[1 - T(vd).team].members[0], { type: 'foul' });
  assert.ok(vd.host({ type: ACT.VOID_ROUND }));
  assert.equal(T(vd).outcome, 'voided');
  assert.equal(T(vd).ruling, null);
  assert.equal(typeof vd.state.deadline, 'number');
});

// ============================================================
// teams
// ============================================================

test('draw-guess teams: alternate seating, balanced draws, only teammates guess, the team scores', () => {
  const sim = mk(6, 5, { teamMode: 'teams', roundSeconds: 60 }, bankOf(TRIO));
  assert.deepEqual(sim.state.teams.map((t) => t.members), [['p1', 'p3', 'p5'], ['p2', 'p4', 'p6']], 'alternate by seat: opponents sit between teammates');
  assert.equal(sim.state.queue.length, 10);
  const perTeam = [0, 0];
  const perDrawer = {};
  for (const q of sim.state.queue) { perTeam[q.team]++; perDrawer[q.drawer] = (perDrawer[q.drawer] ?? 0) + 1; }
  assert.deepEqual(perTeam, [5, 5]);
  for (const c of Object.values(perDrawer)) assert.ok(c === 1 || c === 2, 'rotation inside a team is even to within one draw');
  assert.notEqual(sim.state.queue[0].team, sim.state.queue[1].team, 'teams alternate');
  // the drawer's teammates are the guessers; rivals watch
  const team = T(sim).team;
  assert.deepEqual(guessers(sim).sort(), sim.state.teams[team].members.filter((p) => p !== D(sim)).sort());
  pick(sim, '老虎');
  const rival = sim.state.teams[1 - team].members[0];
  const mate = guessers(sim)[0];
  assert.equal(view(sim, rival).role, 'rival');
  assert.equal(view(sim, mate).role, 'guesser');
  assert.equal(sim.act(D(sim), { type: 'accept', target: rival }), false, 'a rival cannot be accepted');
  at(sim, 0.4);
  assert.ok(sim.act(D(sim), { type: 'accept', target: mate }));
  sim.advance();
  assert.deepEqual(sim.state.teamScores, team === 0 ? [1, 0] : [0, 1]);
  assert.deepEqual(Object.values(sim.state.scores), [0, 0, 0, 0, 0, 0], 'no individual points in team mode');
  assert.equal(view(sim, null).teams.find((t) => t.i === team).score, 1);
  assert.equal(view(sim, rival).myTeam, 1 - team);
  assert.equal(view(sim, null).scoring, 'flat');
  // stars as points
  const st = mk(6, 5, { teamMode: 'teams', starsAsPoints: true }, bankOf(TRIO));
  pick(st, '守株待兔');
  st.act(D(st), { type: 'accept', target: guessers(st)[0] });
  st.advance();
  assert.equal(sum(st.state.teamScores), 3);
  assert.equal(view(st, null).scoring, 'stars');
});

test('draw-guess teams: typed guesses come from teammates only; a rival is ignored; the shuffle option partitions everybody', () => {
  const sim = mk(6, 5, { teamMode: 'teams', guessMode: 'typed', roundSeconds: 60 }, bankOf(TRIO));
  pick(sim, '老虎');
  const rival = sim.state.teams[1 - T(sim).team].members[0];
  sim.now += 800;
  assert.equal(sim.act(rival, { type: 'guess', text: '老虎' }), false);
  const mate = guessers(sim)[0];
  assert.ok(sim.act(mate, { type: 'guess', text: '老虎' }));
  assert.equal(T(sim).solvers.length, 1);
  assert.equal(sim.state.phase, 'play', 'the other teammate has not solved yet');
  sim.now += 800;
  sim.act(guessers(sim)[1], { type: 'guess', text: '虎' });
  assert.equal(sim.state.phase, 'reveal', 'every teammate solved: the turn ends');
  assert.equal(sum(sim.state.teamScores), 1);
  for (const seed of [1, 2, 3]) {
    const sh = mk(8, seed, { teamMode: 'teams', teams: 3, teamAssign: 'shuffle' });
    const all = sh.state.teams.flatMap((t) => t.members).sort();
    assert.deepEqual(all, sh.state.order.slice().sort());
    assert.deepEqual(sh.state.teams.map((t) => t.members.length).sort(), [2, 3, 3]);
    assert.equal(sh.state.queue.length, 12);
  }
  // alternate with 3 teams
  assert.deepEqual(mk(7, 1, { teamMode: 'teams', teams: 3 }).state.teams.map((t) => t.members), [['p1', 'p4', 'p7'], ['p2', 'p5'], ['p3', 'p6']]);
});

test('draw-guess teams: the result names the winning team\'s members; a tie shares', () => {
  const sim = mk(4, 5, { teamMode: 'teams', teamRounds: 2, roundSeconds: 60 }, bankOf(UBANK));
  for (let i = 0; i < 4; i++) {
    const t = i < 2 ? i : 1 - (i % 2);                  // just play it out: every turn solved by the first teammate
    assert.ok(t >= 0);
    pick(sim, 2);
    sim.act(D(sim), { type: 'accept', target: guessers(sim)[0] });
    sim.advance();
    toNext(sim);
  }
  assert.equal(sim.state.phase, 'over');
  const res = sim.result();
  assert.deepEqual(sim.state.teamScores, [2, 2]);
  assert.deepEqual(res.winners.sort(), ['p1', 'p2', 'p3', 'p4'], 'a tie after the fixed rounds shares the win');
  assert.ok(res.summary.includes('同分'));
  assert.deepEqual(res.points, { p1: 1, p2: 1, p3: 1, p4: 1 });
  assert.ok(res.lines.some((l) => l.includes('🔴 紅隊') && l.includes('2 分')));
  // a clear winner
  const w = mk(4, 5, { teamMode: 'teams', teamRounds: 1, roundSeconds: 60 }, bankOf(UBANK));
  pick(w, 2);
  const t0 = T(w).team;
  w.act(D(w), { type: 'accept', target: guessers(w)[0] });
  w.advance();
  toNext(w);
  pick(w, 2);
  w.act(D(w), { type: 'abandon' });
  toNext(w);
  const r = w.result();
  assert.deepEqual(r.winners.sort(), w.state.teams[t0].members.slice().sort());
  assert.deepEqual(r.points[w.state.teams[1 - t0].members[0]], 0);
  assert.ok(r.summary.includes(S.teamLabel(t0)));
});

// ============================================================
// results
// ============================================================

/** Play a whole game where `plan(sim)` decides each turn. */
function playGame(sim, plan) {
  let guard = 0;
  while (sim.state.phase !== 'over' && guard++ < 500) {
    if (sim.state.phase === 'choose') { pick(sim, 2); plan(sim); }
    else if (sim.state.phase === 'reveal' || sim.state.phase === 'standings') toNext(sim);
    else sim.advance();
  }
  assert.equal(sim.state.phase, 'over');
  return sim.result();
}

test('draw-guess: the result ranks by points, then correct guesses, then drawer points, and says why', () => {
  const sim = mk(3, 7, { roundSeconds: 80, cycles: 1 }, bankOf(UBANK));
  const res = playGame(sim, (s) => { s.act(D(s), { type: 'accept', target: guessers(s)[0] }); });
  assert.equal(sim.state.history.length, 3);
  assert.ok(res.winners.length >= 1);
  assert.equal(typeof res.summary, 'string');
  for (const w of res.winners) assert.ok(sim.state.order.includes(w));
  assert.deepEqual(Object.keys(res.points).sort(), ['p1', 'p2', 'p3']);
  assert.equal(sum(Object.values(res.points)), res.winners.length, 'winners get 1 evening point each');
  // each turn is in the lines: the word, who got it, the points
  for (const e of sim.state.history) {
    const line = res.lines.find((l) => l.startsWith(`第 ${e.n} 輪`));
    assert.ok(line, `turn ${e.n}`);
    assert.ok(line.includes(e.w) && line.includes('估中'), line);
  }
  // #10: sections the results screen folds — ranking first, then highlights, then one line per turn
  assert.equal(res.lines[0], S.HEAD.rank);
  assert.ok(res.lines[1].startsWith('🥇'));
  const sections = resultSections(res.lines);
  assert.deepEqual(sections.map((x) => x.title), ['排名', '亮點', '每輪重溫']);
  assert.equal(sections[0].lines.length, 3, 'one rank line per player');
  assert.equal(sections[2].lines.length, sim.state.history.length, 'one recap line per turn');
  for (const l of sections[0].lines) assert.ok(/\d+ 分（估中 \d+ 次 · 畫畫得 \d+ 分）/.test(l), l);
  // totals are the sum of the history
  for (const p of sim.state.order) assert.equal(sim.state.scores[p], sum(sim.state.history.map((e) => e.deltas[p] ?? 0)));
  // an all-zero game is a shared win
  const z = mk(4, 7, { roundSeconds: 60, cycles: 1 }, bankOf(UBANK));
  const zr = playGame(z, () => {});
  assert.equal(zr.winners.length, 4);
  assert.ok(zr.summary.includes('一齊贏'));
  assert.deepEqual(zr.points, { p1: 1, p2: 1, p3: 1, p4: 1 });
  assert.equal(z.state.history.every((e) => e.outcome === 'timeout'), true);
});

test('draw-guess: tie-breaks — more correct guesses wins, then more drawer points, otherwise shared', () => {
  const sim = mk(3, 1, { cycles: 1 }, bankOf(UBANK));
  // fabricate a finished game: p1 and p2 tie on points; p2 has more correct guesses
  const s = sim.state;
  s.phase = 'over';
  s.history = [
    { n: 1, drawer: 'p3', team: null, w: 'x', alt: [], level: 1, cat: '', outcome: 'solved', solvers: [{ pid: 'p1', rem: 0, T: 80000 }], E: 2, flags: 0, fouled: false,
      solverPts: { p1: 20 }, drawerPts: 0, teamPts: 0, deltas: { p1: 20 } },
    { n: 2, drawer: 'p3', team: null, w: 'y', alt: [], level: 1, cat: '', outcome: 'solved', solvers: [{ pid: 'p2', rem: 0, T: 80000 }, { pid: 'p2', rem: 0, T: 80000 }], E: 2, flags: 0, fouled: false,
      solverPts: { p2: 10 }, drawerPts: 0, teamPts: 0, deltas: { p2: 20 } },
  ];
  s.scores = { p1: 20, p2: 20, p3: 0 };
  assert.deepEqual(sim.result().winners, ['p2'], 'more correct guesses');
  s.history[1].solvers.pop();
  s.history[1].deltas = { p2: 20 };
  s.history[0].drawerPts = 0;
  assert.deepEqual(sim.result().winners.sort(), ['p1', 'p2'], 'fully tied: shared');
});

// ============================================================
// privacy
// ============================================================

const ALLOWED_VIEW_KEYS = ['me', 'role', 'phase', 'title', 'subtitle', 'drawMode', 'guessMode', 'hintsOn', 'scoring', 'turn', 'upNext', 'scores', 'teams',
  'myTeam', 'mod', 'last', 'sub', 'choose', 'play', 'reveal', 'standings', 'feed', 'deadline', 'timerLabel', 'hint'];

/** Characters of the live word that this seat may NOT see yet, plus every offer it may not see at all. */
function secretsFor(sim, pid) {
  const s = sim.state;
  const t = s.turn;
  const out = [];
  if (t.word && (s.phase === 'play' || s.phase === 'choose')) {
    const cs = Array.from(t.word.w);
    const shown = new Set(t.reveals.slice(0, t.shown));
    cs.forEach((c, i) => { if (!shown.has(i)) out.push(c); });
    if (t.word.cat === '' || !t.showCat) out.push(t.word.cat);
  }
  if (s.phase === 'choose' && t.offers && pid !== t.drawer) for (const o of t.offers) out.push(...Array.from(o.w), o.cat);
  return out.filter(Boolean);
}

function assertNoLeaks(sim, label = '') {
  const s = sim.state;
  if (s.phase === 'reveal' || s.phase === 'over') return;
  for (const pid of [...s.order, null]) {
    const v = sim.view(pid);
    assert.ok(v && typeof v === 'object', `${label} no view for ${pid}`);
    for (const k of Object.keys(v)) assert.ok(ALLOWED_VIEW_KEYS.includes(k), `${label} unexpected view key ${k}`);
    const json = JSON.stringify(v);
    const isDrawer = pid === s.turn.drawer;
    if (!isDrawer) {
      for (const c of secretsFor(sim, pid)) {
        // a character the seat typed itself may legitimately come back to it (and only to it)
        const own = (v.feed ?? []).some((g) => g.pid === pid && g.text && g.text.includes(c));
        if (!own) assert.ok(!json.includes(c), `${label} seat ${pid} sees secret ${c} in phase ${s.phase}: ${json.slice(0, 200)}`);
      }
      if (v.play) assert.equal(v.play.word, null, `${label} the word is only for the drawer`);
      if (v.choose) assert.equal(v.choose.offers, null);
    } else if (s.phase === 'play') {
      // the drawer never gets the unpicked offers back
      assert.ok(!('offers' in (v.play ?? {})));
      assert.equal(v.choose, null);
    }
    assert.equal(v.reveal, null, `${label} nothing is revealed before the reveal`);
  }
}

test('draw-guess privacy: no view but the drawer\'s ever contains the word, an unrevealed character or an unpicked offer', () => {
  for (const guessMode of ['shout', 'typed']) {
    const sim = mk(5, 8, { guessMode, roundSeconds: 60 }, bankOf(UBANK));
    assertNoLeaks(sim, 'choose');
    const offers = T(sim).offers.map((o) => o.w);
    pick(sim, 2);
    assertNoLeaks(sim, 'play 0%');
    const drawerView = JSON.stringify(sim.view(D(sim)));
    for (const w of offers) if (w !== T(sim).word.w) assert.ok(!drawerView.includes(w[0]), 'the drawer does not get the other offers back');
    assert.equal(sim.view(D(sim)).play.word.w, T(sim).word.w);
    while (T(sim).pending.length) { sim.advance(); assertNoLeaks(sim, 'hint'); }
    if (guessMode === 'typed') {
      for (const g of guessers(sim).slice(0, 2)) {
        sim.now += 800;
        sim.act(g, { type: 'guess', text: Array.from(T(sim).word.w).slice(0, 2).join('') });   // a close guess containing real characters
        assertNoLeaks(sim, 'typed close');
      }
    } else {
      sim.act(D(sim), { type: 'accept', target: guessers(sim)[0] });
      assertNoLeaks(sim, 'grace');
    }
  }
  // the word IS public in the reveal
  const sim = mk(4, 8, { roundSeconds: 60 }, bankOf(UBANK));
  const w = pick(sim, 2);
  sim.act(D(sim), { type: 'abandon' });
  for (const pid of [...sim.state.order, null]) assert.equal(sim.view(pid).reveal.w, w);
});

test('draw-guess privacy: ink stays with the drawer, and the cues never speak the word before the reveal', () => {
  const sim = mk(5, 8, { roundSeconds: 60 }, bankOf(UBANK));
  const cues = [];
  const note = () => { const c = sim.cue(); if (c) cues.push(c); };
  note();
  const w = pick(sim, 3);
  note();
  while (T(sim).pending.length) { sim.advance(); note(); }
  const chars = Array.from(w);
  const shownChars = T(sim).reveals.map((i) => chars[i]);
  for (const c of cues) {
    for (const ch of chars) {
      if (shownChars.includes(ch)) continue;
      assert.ok(!c.text.includes(ch), `cue ${c.id} speaks an unrevealed character: ${c.text}`);
    }
    assert.ok(!c.text.includes(w));
  }
  assert.equal(new Set(cues.map((c) => c.id)).size, cues.length, 'cue ids are unique per step');
  sim.act(D(sim), { type: 'abandon' });
  const reveal = sim.cue();
  assert.ok(reveal.text.includes(w), 'the reveal cue says the answer');
  assert.ok(reveal.id.includes('reveal'));
  // an acknowledged cue disappears; a new step brings a new one
  sim.host({ type: ACT.CUE_DONE, id: reveal.id });
  assert.equal(sim.cue(), null);
  sim.host({ type: ACT.CUE_DONE, id: 'stale' });
  assert.equal(sim.cue(), null);
});

test('draw-guess typed: the phone never speaks (quiet places), and the host 下一步 skips on the first press', () => {
  const sim = mk(4, 2, { ...typedCfg }, bankOf(TRIO));
  assert.equal(sim.cue(), null);
  pick(sim, '摩天輪');
  assert.equal(sim.cue(), null);
  while (T(sim).pending.length) { sim.advance(); assert.equal(sim.cue(), null); }
  sim.host({ type: ACT.NEXT });                        // no cue to acknowledge: skips the step straight away
  assert.equal(sim.state.phase, 'reveal');
  assert.equal(sim.cue(), null);
  sim.host({ type: ACT.NEXT });
  assert.equal(sim.state.phase, 'choose');
  // shout mode does speak
  assert.ok(mk(4, 2, {}, bankOf(TRIO)).cue().text.includes('請揀一個詞'));
});

test('draw-guess: canInk is the drawer in a canvas game, while playing — never in paper mode, choice or reveal', () => {
  const sim = mk(5, 8, { drawMode: 'canvas' }, bankOf(UBANK));
  const e0 = sim.state.inkEpoch;
  assert.equal(engine.canInk(sim.state, D(sim)), false, 'not while choosing');
  pick(sim, 2);
  assert.equal(engine.canInk(sim.state, D(sim)), true);
  assert.equal(view(sim, D(sim)).play.canDraw, true);
  for (const p of guessers(sim)) { assert.equal(engine.canInk(sim.state, p), false); assert.equal(view(sim, p).play.canDraw, false); }
  assert.equal(engine.canInk(sim.state, null), false);
  sim.act(D(sim), { type: 'abandon' });
  assert.equal(engine.canInk(sim.state, D(sim)), false, 'not in the reveal');
  toNext(sim);
  assert.ok(sim.state.inkEpoch > e0, 'a new turn is a new picture');
  const paper = mk(5, 8, { drawMode: 'paper' }, bankOf(UBANK));
  pick(paper, 2);
  assert.equal(engine.canInk(paper.state, D(paper)), false);
  assert.equal(paper.state.inkEpoch, 0, 'paper mode never clears a picture');
});

test('draw-guess: the drawer\'s word is also hidden from a SHARED phone until asked (view carries it only for the drawer seat)', () => {
  // On one device the shell shows the drawer's seat view; everything private in it is behind the UI's peek. The table view has none of it.
  const sim = mk(4, 8, {}, bankOf(UBANK));
  pick(sim, 2);
  assert.equal(view(sim, null).play.word, null);
  assert.equal(view(sim, null).role, 'spectator');
  assert.equal(view(sim, null).me, null);
  assert.equal(view(sim, 'p9').me, null, 'an unknown seat gets the table view');
});

// ============================================================
// legalActions, session integration
// ============================================================

test('draw-guess: legalActions offers only actions that change the state (no clock-dependent ones)', () => {
  for (const guessMode of ['shout', 'typed']) {
    const sim = mk(5, 9, { guessMode }, bankOf(UBANK));
    const check = () => {
      for (const p of sim.state.order) {
        for (const a of sim.legal(p)) {
          const probe = new Sim(game, { n: 5, seed: 9, banks: bankOf(UBANK), config: sim.config });
          probe.state = clone(sim.state);
          probe.now = sim.now + 800;
          if (a.type === 'guess') continue;
          assert.ok(probe.act(p, a), `${guessMode} ${sim.state.phase}/${T(sim).sub}: ${p} ${JSON.stringify(a)} changed nothing`);
        }
      }
    };
    check();
    pick(sim, 2);
    check();
    sim.now += 800;
    if (guessMode === 'typed') sim.act(guessers(sim)[0], { type: 'guess', text: '亂估一下' });
    else sim.act(D(sim), { type: 'accept', target: guessers(sim)[0] });
    check();
    sim.advance();
    check();
    assert.deepEqual(engine.legalActions(sim.state, 'nobody'), []);
    assert.deepEqual(engine.legalActions(sim.state, HOST), []);
  }
});

test('draw-guess session: pause shifts the clock, ink comes only from the drawer, snapshot/restore keeps the turn', () => {
  const clock = new FakeClock();
  const players = makePlayers(5);
  const cfg = { ...config.defaults(5), roundSeconds: 80 };
  const mkSession = () => new Session({
    game, players, config: cfg, rng: mulberry32(11), bag: null, now: clock.now, timers: clock, narrationMode: 'silent', hostPid: 'p1',
  });
  const s = mkSession().begin();
  const drawer = s.state.turn.drawer;
  const other = players.find((p) => p.id !== drawer).id;
  assert.ok(s.dispatch(drawer, { type: 'pick', i: 1 }));
  const wordBefore = s.state.turn.word.w;
  assert.equal(s.ink(drawer, { stroke: 'a-1', pts: [[10, 10], [20, 20]], end: true }), true);
  assert.equal(s.ink(other, { stroke: 'b-1', pts: [[10, 10], [20, 20]], end: true }), false, 'ink from a guesser is dropped by the host');
  assert.equal(s.drawing.strokes.length, 1);
  clock.advance(10000);
  const end0 = s.state.deadline + s.state.turn.then.reduce((x, y) => x + y, 0);
  s.pause();
  clock.advance(30000);
  s.resume();
  assert.equal(s.state.deadline + s.state.turn.then.reduce((x, y) => x + y, 0), end0 + 30000, 'a 30 s pause moves the whole chain');
  // the hint events fire on schedule through the Session
  clock.advance(25000);
  assert.ok(s.state.turn.stage >= 1, 'hints advanced by the session timer');
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  const clock2 = new FakeClock(clock.t + 5000);
  const r = Session.restore(snap, { game, rng: mulberry32(1), bag: null, now: clock2.now, timers: clock2, narrationMode: 'silent' });
  assert.equal(r.state.turn.word.w, wordBefore);
  assert.equal(r.view(drawer).play.word.w, wordBefore);
  assert.equal(r.hostPid, 'p1');
  assert.equal(r.paused, true);
  r.resume();
  assert.equal(r.dispatch(drawer, { type: 'abandon' }), true);
  assert.equal(r.state.phase, 'reveal');
  assert.equal(r.drawing.strokes.length, 1, 'the picture stays on every phone during the reveal');
  assert.equal(r.dispatch(drawer, { type: 'next' }), false, 'the drawer cannot skip the reveal');
  // the reveal runs 7 s; the next turn bumps the epoch and the session clears the picture
  clock2.advance(6999);
  assert.equal(r.state.phase, 'reveal');
  clock2.advance(1);
  assert.equal(r.state.phase, 'choose');
  assert.equal(r.drawing.strokes.length, 0);
  assert.equal(r.drawing.epoch, r.state.inkEpoch);
});

test('draw-guess session: the whole thing runs on timers alone (nobody acts) and ends with a result', () => {
  const clock = new FakeClock();
  const players = makePlayers(4);
  const s = new Session({
    game, players, config: { ...config.defaults(4), cycles: 1, roundSeconds: 45 }, rng: mulberry32(3), bag: null,
    now: clock.now, timers: clock, narrationMode: 'silent', hostPid: 'p1',
  }).begin();
  for (let i = 0; i < 500 && !s.result(); i++) clock.advance(1000);
  const res = s.result();
  assert.ok(res, 'finished');
  assert.equal(res.winners.length, 4, 'nobody solved anything: shared win');
  assert.equal(s.state.history.length, 4);
});

// ============================================================
// fuzz
// ============================================================

const COVER = { grace: 0, buzzer: 0, solved: 0, timeout: 0, abandoned: 0, voided: 0, fouled: 0, override: 0, again: 0, teamPoint: 0, typedRight: 0,
  standings: 0, ruling: 0, revealRuling: 0, teamFoulOut: 0, buzzerSolve: 0 };

/** Per-step invariants of every view: U1 hints, the stall contract, the canvas gate. */
function assertViewContract(sim, label) {
  const s = sim.state;
  for (const pid of [...s.order, null]) {
    const v = sim.view(pid);
    assert.equal(typeof v.hint, 'string', `${label} hint`);
    const len = Array.from(v.hint).length;
    assert.ok(len > 0 && len <= 40, `${label} hint for ${pid} in ${s.phase}: ${len} chars: ${v.hint}`);
    if (pid !== null) {
      const blocks = engine.blocking(s, pid);
      const want = s.phase === 'choose' ? pid === s.turn.drawer : !!s.turn.ruling && pid === s.hostPid;
      assert.equal(blocks, want, `${label} blocking(${pid}) in ${s.phase}/${s.turn.sub}`);
      if (v.play) assert.equal(v.play.canDraw, engine.canInk(s, pid));
    }
  }
}

function fuzzOne(n, seed, over, hook) {
  const sim = mk(n, seed, over, bankOf(UBANK));
  hook?.(sim, -1);
  const rnd = mulberry32(seed * 977 + n);
  const pickOf = (arr) => arr[Math.floor(rnd() * arr.length)];
  const mover = sim.state.order;
  let voids = 0;
  let solves = 0;
  const quiet = seed % 3 === 0;      // some games: the table sits on its hands, so turns run out on the clock
  for (let step = 0; step < 9000; step++) {
    const res = sim.result();
    if (res) {
      assert.ok(Array.isArray(res.winners) && res.winners.length >= 1);
      for (const w of res.winners) assert.ok(mover.includes(w));
      assert.equal(typeof res.summary, 'string');
      assert.ok(res.lines.length >= sim.state.history.length);
      assert.equal(sum(Object.values(res.points)), res.winners.length);
      JSON.stringify(sim.state);
      for (const e of sim.state.history) assert.equal(sum(Object.values(e.deltas)), sum(Object.values(e.solverPts)) + e.drawerPts);
      for (const p of mover) assert.equal(sim.state.scores[p], sum(sim.state.history.map((e) => e.deltas[p] ?? 0)));
      for (const e of sim.state.history) {
        COVER[e.outcome]++;
        if (e.fouled) COVER.fouled++;
        if (e.outcome === 'fouled') COVER.teamFoulOut++;
        if (e.again) COVER.again++;
        if (e.team != null && e.teamPts) COVER.teamPoint++;
        for (const x of e.solvers) { if (x.via === 'override') COVER.override++; if (x.via === 'typed') COVER.typedRight++; }
        if (e.outcome === 'solved' && e.solvers.every((x) => x.rem === 0 && x.via === 'accept')) COVER.buzzerSolve++;
      }
      return { steps: step, solves, voids, turns: sim.state.history.length };
    }
    // collect every legal move of every seat, weighted
    const moves = [];
    for (const p of mover) {
      for (const a of sim.legal(p)) {
        // a quiet table only wakes up at the buzzer (a shout right at the end)
        if (quiet && sim.state.phase === 'play' && ['accept', 'abandon', 'void', 'undo-accept', 'guess'].includes(a.type)
          && !(sim.state.turn.sub === 'buzzer' && (a.type === 'accept' || a.type === 'undo-accept'))) continue;
        const buzzer = sim.state.phase === 'play' && sim.state.turn.sub === 'buzzer';
        const w = a.type === 'void' ? 0.01 : a.type === 'abandon' ? 0.04 : a.type === 'extend' ? 0.03 : a.type === 'foul' ? 0.3
          : a.type === 'guess' ? 1 : (a.type === 'accept' || a.type === 'undo-accept') ? (buzzer ? 3 : 0.25) : 2;
        moves.push([p, a, w]);
      }
    }
    // the reveal's 5 s window (clock-dependent, so not in legalActions): late 🚩 and the drawer's late ✔
    if (sim.state.phase === 'reveal' && !quiet) {
      for (const p of mover) {
        const rv = sim.view(p).reveal;
        if (!rv || sim.now >= rv.lateUntil) continue;
        if (rv.foul.can) moves.push([p, { type: 'foul' }, 0.4, 'late']);
        if (p === sim.state.turn.drawer && sim.state.cfg.guessMode === 'typed' && ['solved', 'timeout'].includes(rv.outcome)) {
          const open = (sim.view(p).feed ?? []).filter((g) => g.kind !== 'right' && !rv.solvers.some((x) => x.pid === g.pid));
          if (open.length) moves.push([p, { type: 'accept', gid: open[0].id }, 0.4, 'late']);
        }
      }
    }
    // a guesser who "knows" the word sometimes types it
    const t = sim.state.turn;
    if (!quiet && sim.state.phase === 'play' && sim.state.cfg.guessMode === 'typed' && t.sub === 'run') {
      for (const p of t.eligible) {
        if (!t.solvers.some((x) => x.pid === p) && rnd() < 0.08) moves.push([p, { type: 'guess', text: t.word.w }, 6]);
      }
    }
    // time moves on, but never past the next thing the engine is waiting for
    const dl = sim.state.deadline;
    if (dl != null) {
      const room = Math.max(0, dl - sim.now);
      const fine = sim.state.phase === 'play' && sim.state.turn.sub !== 'run';    // short windows deserve short steps
      sim.tick(Math.min(room, Math.floor(rnd() * (fine ? 500 : 2600))));
    } else sim.tick(Math.floor(rnd() * 2600));
    if (sim.state.deadline != null && sim.now >= sim.state.deadline) {
      assert.ok(sim.advance() || true);
    } else if (moves.length && rnd() < 0.93) {
      // an "idle" share keeps rare moves rare even when they are the only legal ones (the host's void in a reveal)
      const total = moves.reduce((x, m) => x + m[2], 0) + 1;
      let r = rnd() * total;
      let chosen = null;
      for (const m of moves) { r -= m[2]; if (r <= 0) { chosen = m; break; } }
      if (chosen) {
        const [p, a, , late] = chosen;   // a late move may find its window closed by the tick above
        const changed = sim.act(p, a);
        if (a.type === 'void' && changed) voids++;
        if (!changed && a.type !== 'guess' && !late) throw sim.stuck(`${p} ${JSON.stringify(a)} was offered by legalActions but changed nothing`);
      }
    } else if (sim.cue() && rnd() < 0.5) sim.cueDone();
    else if (rnd() < 0.2) sim.host({ type: ACT.NEXT });
    else if (sim.state.deadline != null && rnd() < 0.25) sim.advance();

    assertNoLeaks(sim, `n=${n} seed=${seed} step ${step}`);
    if (step % 3 === 0) assertViewContract(sim, `n=${n} seed=${seed} step ${step}`);
    hook?.(sim, step);
    if (sim.state.phase === 'play') { if (sim.state.turn.sub === 'grace') COVER.grace++; if (sim.state.turn.sub === 'buzzer') COVER.buzzer++; }
    if (sim.state.phase === 'standings') COVER.standings++;
    if (sim.state.turn.ruling) { COVER.ruling++; if (sim.state.phase === 'reveal') COVER.revealRuling++; }
    if (step % 25 === 0) {
      const copy = JSON.parse(JSON.stringify(sim.state));
      assert.deepEqual(copy, sim.state, 'state is plain JSON');
    }
    solves = sim.state.history.reduce((x, e) => x + e.solvers.length, 0);
  }
  throw sim.stuck(`no result after 9000 steps (n=${n} seed=${seed} ${JSON.stringify(over)})`);
}

/** DG_SEEDS=20 node tests/run.mjs draw-guess — a wider sweep by hand; the suite keeps 2 seeds per case. */
const FUZZ_SEEDS = Math.max(1, Number(process.env.DG_SEEDS) || 2);

test('draw-guess fuzz: random legal play ends with a well-formed result for every head-count and mode, with no leaks', () => {
  const t0 = performance.now();
  const modes = [
    { guessMode: 'shout', drawMode: 'paper' },
    { guessMode: 'shout', drawMode: 'canvas' },
    { guessMode: 'typed', drawMode: 'canvas' },
    { guessMode: 'typed', drawMode: 'paper' },
    { guessMode: 'shout', teamMode: 'teams' },
    { guessMode: 'typed', teamMode: 'teams', teams: 2 },
  ];
  let games = 0;
  let solves = 0;
  let voids = 0;
  for (const n of [3, 4, 5, 6, 7, 8, 12]) {
    for (const [i, m] of modes.entries()) {
      if (m.teamMode && n < 4) continue;
      for (let seed = 1; seed <= FUZZ_SEEDS; seed++) {
        const over = { ...m, roundSeconds: 60, cycles: n > 8 ? 1 : 0 };
        const r = fuzzOne(n, seed + i * 10, over);
        games++;
        solves += r.solves;
        voids += r.voids;
      }
    }
  }
  assert.ok(solves > 20, `the fuzzer solved something (${solves})`);
  // the fuzzer must really visit the interesting corners, not just finish
  for (const k of ['grace', 'buzzer', 'solved', 'timeout', 'abandoned', 'voided', 'fouled', 'override', 'again', 'teamPoint', 'typedRight',
    'standings', 'ruling', 'revealRuling', 'teamFoulOut', 'buzzerSolve']) {
    assert.ok(COVER[k] > 0, `fuzz never produced: ${k} (${JSON.stringify(COVER)})`);
  }
  assert.ok(games >= 50);
  assert.ok(performance.now() - t0 < 20000 * FUZZ_SEEDS / 2, `fuzz took ${Math.round(performance.now() - t0)} ms`);
  void voids;
  if (process.env.DG_COVER) console.log(JSON.stringify(COVER));
});

// ============================================================
// the real Room: one phone holds every seat (pass-the-phone)
// ============================================================

function fakeClock(start = 1_700_000_000_000) {
  let now = start;
  let seq = 0;
  let timers = [];
  return {
    now: () => now,
    setTimeout: (fn, ms = 0) => { const id = ++seq; timers.push({ at: now + Math.max(0, ms), fn, id }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = Math.max(now, due.at);
        due.fn();
      }
      now = end;
    },
  };
}

test('draw-guess room: one phone, every seat — shout by default, and no seat view but the drawer’s (nor the table) holds a secret', async () => {
  const { Room } = await import('../js/core/room.js?v=1');
  const { createBag } = await import('../js/core/bag.js?v=1');
  const names = ['阿明', '阿強', '阿欣', '阿珍', '阿輝'];
  for (const drawMode of ['canvas', 'paper']) {
    const clock = fakeClock();
    const sent = [];
    const saved = {};
    const room = new Room({
      code: null, hostDeviceId: 'dev_host', names, now: clock.now, rng: mulberry32(drawMode.length), timers: clock,
      bag: createBag({ storage: new Map(), rng: mulberry32(5), banks: { draw: { name: '畫畫題目', load: async () => UBANK, key: (e) => e.w } } }),
      loadGame: async () => game, send: (deviceId, msg) => sent.push({ deviceId, msg: clone(msg) }),
      // last time this host played typed on several phones: one phone must not inherit it
      store: { get: (k) => (k === 'bgb:cfg:draw-guess' ? { guessMode: 'typed', drawMode } : saved[k] ?? null), set: (k, v) => { saved[k] = v; } },
      onCue: () => {}, narrationMode: 'silent',
    });
    const sel = await room.selectGame('draw-guess');
    assert.equal(sel.ok, true, sel.message);
    assert.equal(room.config.guessMode, 'shout', 'one phone: typed guessing is never the default');
    assert.equal(room.config.drawMode, drawMode, 'the rest of the last setup is kept');
    assert.equal(room.start().ok, true);
    const pids = room.session.state.order;
    const lastViews = () => [...sent].reverse().find((x) => x.deviceId === 'dev_host' && x.msg.t === 'views')?.msg;
    const rnd = mulberry32(31);
    let guard = 0;
    let checked = 0;
    while (room.phase === 'playing' && guard++ < 3000) {
      const st = room.session.state;
      const m = lastViews();
      assert.deepEqual(Object.keys(m.bySeat).sort(), pids.slice().sort(), 'the one phone gets every seat’s view');
      const t = st.turn;
      const secrets = [];
      if (st.phase === 'choose') for (const o of t.offers) secrets.push(...Array.from(o.w));
      if (st.phase === 'play') {
        const shown = new Set(t.reveals.slice(0, t.shown));
        Array.from(t.word.w).forEach((c, i) => { if (!shown.has(i)) secrets.push(c); });
      }
      for (const [pid, v] of [...Object.entries(m.bySeat), ['table', m.table]]) {
        const json = JSON.stringify(v);
        if (pid === t.drawer) {
          if (st.phase === 'play') assert.equal(v.play.word.w, t.word.w, 'the drawer’s seat carries the word (the UI keeps it behind a peek)');
          continue;
        }
        for (const c of secrets) assert.ok(!json.includes(c), `${drawMode}: ${pid} sees ${c} in ${st.phase}`);
        checked++;
      }
      if (st.phase === 'choose' || st.phase === 'play') assert.deepEqual(m.focus, { pids: [t.drawer] }, 'the pass gate hands the phone to the drawer');
      // ink: only the drawer, only while drawing on the phone canvas
      if (drawMode === 'canvas' && st.phase === 'play' && rnd() < 0.2) {
        const who = pids[Math.floor(rnd() * pids.length)];
        const ok = room.ink('dev_host', who, { stroke: `${who}-${guard}`, pts: [[10, 10], [200, 200]], end: true });
        assert.equal(ok, who === t.drawer && t.sub !== 'ruling', `ink from ${who}`);
      }
      if (drawMode === 'paper') assert.equal(room.ink('dev_host', t.drawer, { stroke: `x-${guard}`, pts: [[1, 1], [9, 9]], end: true }), false, 'paper: no ink at all');
      const movers = pids.filter((p) => room.session.legal(p).length);
      if (movers.length && rnd() < 0.5) {
        const pid = movers[Math.floor(rnd() * movers.length)];
        const options = room.session.legal(pid).filter((a) => a.type !== 'void');
        if (options.length) room.act('dev_host', pid, options[Math.floor(rnd() * options.length)]);
      } else clock.advance(1500);
    }
    assert.equal(room.phase, 'results', `${drawMode}: the game reached the results`);
    assert.ok(checked > 100);
    const res = [...sent].reverse().find((x) => x.msg.t === 'room').msg.room.lastResult;
    assert.equal(res.gameId, 'draw-guess');
    assert.ok(res.lines.includes(S.HEAD.turns));
  }
});

// ============================================================
// ui.js — a minimal fake DOM, one mounted UI per seat + the table, driven by the fuzzer
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
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  focus() {}
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
  : JSON.stringify([n.tag, [...n.cls].sort(), n.attrs, n.hidden, n.disabled, n.styleMap, n.children.map(serializeEl)]));
/** Visible = neither it nor an ancestor is hidden. */
const shownEl = (n) => { for (let x = n; x; x = x.parentNode) if (x.hidden) return false; return true; };
/** The text a person could read on this screen right now. */
const visibleText = (n) => (n instanceof FText ? n.data : n.hidden ? '' : n.children.map(visibleText).join(''));
const click = (n) => { for (const f of n.listeners.click ?? []) f({ preventDefault() {} }); };

/** Stub components that record what the UI asked for. Cover keeps its front OFF the tree (it is covered). */
function stubComponents(log) {
  const E = (tag, cls) => { const n = new FEl(tag); if (cls) n.className = cls; return n; };
  return {
    Cover(p0) {
      const root = E('div', 'c-cover');
      root.appendChild(new FText(p0.backLabel ?? ''));
      const api = { el: root, front: p0.front, update(p) { api.front = p.front; }, close() {}, destroy() { root.remove(); } };
      log.covers.push(api);
      return api;
    },
    Timer(p0) {
      const root = E('div', 'c-timer');
      const api = { el: root, update(p) { root.textContent = p.label ?? ''; }, destroy() { root.remove(); } };
      api.update(p0);
      log.timers++;
      return api;
    },
    Canvas(p0) {
      const root = E('div', 'c-canvas');
      const api = { el: root, props: p0, update(p) { api.props = p; }, destroy() { root.remove(); } };
      log.canvases.push(api);
      return api;
    },
  };
}

async function withUi(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node };
  globalThis.document = fakeDocument;
  globalThis.Node = FNode;
  try {
    return await fn(await import('../js/games/draw-guess/ui.js'));
  } finally {
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
    if (saved.Node === undefined) delete globalThis.Node; else globalThis.Node = saved.Node;
  }
}

function mountAll(ui, sim, log, sends = []) {
  return [...sim.state.order, null].map((pid) => {
    const root = new FEl('div');
    const api = {
      me: pid, players: sim.players, isHost: pid === 'p1', meta, config: sim.state.cfg,
      send: (a) => sends.push([pid, a]), ink() {}, now: () => sim.now, sfx: (name) => log.sfx.push(name), toast() {},
      components: stubComponents(log),
    };
    return { pid, root, handle: ui.mount(root, api) };
  });
}

/** The live Canvas stub inside this seat's screen, if any. */
const canvasOf = (log, root) => log.canvases.find((c) => findEls(root, (n) => n === c.el).length) ?? null;

test('draw-guess ui: every phase renders on every seat and the table, idempotently, and no screen shows a secret', async () => {
  await withUi(async (ui) => {
    const phases = new Set();
    const cases = [
      { guessMode: 'shout', drawMode: 'canvas' }, { guessMode: 'shout', drawMode: 'paper' },
      { guessMode: 'typed', drawMode: 'canvas' }, { guessMode: 'typed', drawMode: 'paper' },
      { guessMode: 'shout', drawMode: 'canvas', teamMode: 'teams' }, { guessMode: 'typed', drawMode: 'paper', teamMode: 'teams' },
    ];
    for (const [ci, over] of cases.entries()) {
      const log = { covers: [], canvases: [], sfx: [], timers: 0 };
      let seats = null;
      fuzzOne(5, 40 + ci, { roundSeconds: 45, cycles: 2, ...over }, (sim, step) => {
        seats ??= mountAll(ui, sim, log);
        const s = sim.state;
        const t = s.turn;
        const ink = { epoch: s.inkEpoch, strokes: [] };
        for (const seat of seats) {
          const v = sim.view(seat.pid);
          phases.add(v.phase);
          seat.handle.update(v, { focus: null, paused: false, ink });
          if (step % 7 === 0) {
            const a = serializeEl(seat.root);
            seat.handle.update(clone(v), { focus: null, paused: false, ink });
            assert.equal(serializeEl(seat.root), a, `update() not idempotent for ${seat.pid ?? 'table'} in ${v.phase}/${v.sub}`);
          }
          const text = visibleText(seat.root);
          const isDrawer = seat.pid === t.drawer;
          if ((s.phase === 'play' || s.phase === 'choose') && !isDrawer) {
            const own = (v.feed ?? []).filter((g) => g.pid === seat.pid && g.text).map((g) => g.text).join('');
            for (const c of secretsFor(sim, seat.pid)) if (!own.includes(c)) assert.ok(!text.includes(c), `${seat.pid ?? 'table'} reads ${c} on screen (${s.phase})`);
          }
          if (s.phase === 'play' && isDrawer && s.cfg.guessMode === 'shout') {
            assert.ok(!text.includes(t.word.w), 'the drawer’s screen keeps the word hidden until asked (a shared phone lies on the table)');
          }
          if (s.phase === 'play' && v.role === 'guesser' && s.cfg.guessMode === 'typed') {
            const input = findEls(seat.root, (n) => n.cls.has('dg-input'))[0];
            assert.ok(input, 'a typed guesser has an input');
            assert.equal(shownEl(input), !v.play.mine.solved, 'and it goes away once solved');
          }
          if (s.phase === 'play' && v.role !== 'guesser') assert.equal(findEls(seat.root, (n) => n.cls.has('dg-input')).length, 0, 'nobody else types');
          if (s.phase === 'play') {
            const mask = findEls(seat.root, (n) => n.cls.has('dg-mask'))[0];
            assert.ok(mask && shownEl(mask), `${seat.pid ?? 'table'}: the length mask is on every screen, the drawer’s too`);
          }
          // the canvas follows the engine: tools and ink only for the drawer, never in paper mode
          if (s.phase === 'play' && s.cfg.drawMode === 'canvas') {
            const cv = canvasOf(log, seat.root);
            assert.ok(cv, `${seat.pid ?? 'table'} sees the live picture`);
            assert.equal(cv.props.tools, isDrawer ? 'full' : 'none');
            assert.equal(cv.props.canDraw, isDrawer && engine.canInk(s, seat.pid));
            assert.equal(cv.props.ink, ink, 'the shared drawing is passed through');
            assert.equal(cv.props.minStrokeLen, 0, 'dots are marks too');
          }
        }
        if (s.cfg.drawMode === 'paper') assert.equal(log.canvases.length, 0, 'paper mode: no canvas on any phone');
      });
      if (over.guessMode === 'typed') assert.deepEqual(log.sfx, [], 'typed play makes no sound at all');
      else assert.ok(log.sfx.length > 0);
      for (const seat of seats) seat.handle.destroy();
    }
    for (const ph of ['choose', 'play', 'reveal', 'standings', 'over']) assert.ok(phases.has(ph), `ui never rendered ${ph}`);
  });
});

test('draw-guess ui: taps send what the engine accepts — pick, peek, name chips, 🚩 and the host’s ruling', async () => {
  await withUi(async (ui) => {
    const log = { covers: [], canvases: [], sfx: [], timers: 0 };
    const sends = [];
    const sim = mk(6, 5, { teamMode: 'teams', roundSeconds: 60 }, bankOf(TRIO));
    const seats = mountAll(ui, sim, log, sends);
    const render = () => { for (const seat of seats) seat.handle.update(sim.view(seat.pid), { paused: false, ink: { epoch: sim.state.inkEpoch, strokes: [] } }); };
    const seatOf = (pid) => seats.find((x) => x.pid === pid);
    const deliver = () => { for (const [pid, a] of sends.splice(0)) assert.ok(sim.act(pid, a), `${pid} ${JSON.stringify(a)} accepted`); render(); };
    render();
    // the drawer picks a card
    const drawer = seatOf(D(sim));
    const cards = findEls(drawer.root, (n) => n.cls.has('dg-offer'));
    assert.equal(cards.length, 3);
    for (const other of seats.filter((x) => x !== drawer)) assert.equal(findEls(other.root, (n) => n.cls.has('dg-offer')).length, 0);
    click(cards[1]);
    assert.deepEqual(sends.map((x) => x[1]), [{ type: 'pick', i: 1 }]);
    deliver();
    const w = T(sim).word.w;
    // canvas mode: the word chip is closed until tapped
    const chip = findEls(drawer.root, (n) => n.cls.has('dg-word-chip'))[0];
    assert.ok(!visibleText(drawer.root).includes(w));
    click(chip);
    assert.ok(visibleText(drawer.root).includes(w), 'one tap shows it');
    // a rival flags (two taps), the clock stops, the host's seat gets the ruling buttons
    const rival = seatOf(sim.state.teams[1 - T(sim).team].members.find((p) => p !== 'p1'));
    const flag = findEls(rival.root, (n) => n.cls.has('dg-foul'))[0];
    assert.ok(shownEl(flag) && !flag.disabled);
    click(flag);
    assert.equal(sends.length, 0, 'the first tap only asks');
    click(flag);
    assert.deepEqual(sends.map((x) => x[1]), [{ type: 'foul' }]);
    deliver();
    assert.equal(T(sim).sub, 'ruling');
    const host = seatOf('p1');
    const ruleRow = findEls(host.root, (n) => n.cls.has('dg-rule'))[0];
    assert.ok(shownEl(ruleRow), 'the host sees 成立 / 唔成立');
    for (const other of seats.filter((x) => x.pid !== 'p1')) {
      const r = findEls(other.root, (n) => n.cls.has('dg-rule'))[0];
      assert.ok(!r || !shownEl(r), `${other.pid ?? 'table'} cannot rule`);
      assert.ok(visibleText(other.root).includes('等主持裁決'), 'everybody sees why the clock stopped');
    }
    click(findEls(host.root, (n) => n.cls.has('dg-rule-no'))[0]);
    assert.deepEqual(sends.map((x) => x[1]), [{ type: 'rule', uphold: false }]);
    deliver();
    assert.equal(T(sim).sub, 'run');
    // the drawer taps a teammate's name chip
    const mate = guessers(sim)[0];
    const nameChip = findEls(drawer.root, (n) => n.cls.has('dg-chip-guesser') && n.textContent.includes(sim.players.find((p) => p.id === mate).name))[0];
    click(nameChip);
    assert.deepEqual(sends.map((x) => x[1]), [{ type: 'accept', target: mate }]);
    deliver();
    assert.equal(T(sim).sub, 'grace');
    sim.advance();
    render();
    assert.ok(visibleText(seatOf(null).root).includes(w), 'the reveal shows the word to everybody');
    for (const seat of seats) seat.handle.destroy();
    // paper mode: the word sits behind a hold-to-peek cover
    const paper = mk(4, 5, { drawMode: 'paper' }, bankOf(TRIO));
    const plog = { covers: [], canvases: [], sfx: [], timers: 0 };
    const pseats = mountAll(ui, paper, plog);
    pick(paper, '摩天輪');
    for (const seat of pseats) seat.handle.update(paper.view(seat.pid), { paused: false, ink: { epoch: 0, strokes: [] } });
    const pd = pseats.find((x) => x.pid === D(paper));
    assert.equal(plog.covers.length, 1, 'one cover, on the drawer’s phone');
    assert.ok(visibleText(plog.covers[0].front).includes('摩天輪'), 'the word is under the cover');
    assert.ok(!visibleText(pd.root).includes('摩天輪'), '…and not on the open screen');
    assert.equal(plog.canvases.length, 0);
    for (const seat of pseats) seat.handle.destroy();
  });
});
