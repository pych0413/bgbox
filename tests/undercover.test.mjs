// ============================================================
// tests/undercover.test.mjs — 誰是臥底
//   node tests/run.mjs undercover
// ============================================================

import { test, assert, Sim, makePlayers, makeBag, HOST, ACT } from './lib.mjs';
import * as game from '../js/games/undercover/game.js';
import { mulberry32, clone } from '../js/core/engine-kit.js';

const { engine: E, config: C, meta, rules, internals: K } = game;

// ---------- fixtures ----------

const BANK = [
  { a: '蘋果', b: '雪梨', cat: '食物', level: 1 },
  { a: '的士', b: '巴士', cat: '交通', level: 1 },
  { a: '壽司', b: '刺身', cat: '日本旅行', level: 2 },
  { a: '烏冬', b: '拉麵', cat: '日本旅行', level: 3 },
  { a: '奶茶', b: '咖啡', cat: '飲品', level: 2 },
  { a: '足球', b: '籃球', cat: '運動', level: 1 },
];
const banks = { undercover: BANK };
const N_RANGE = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const ROLE = { C: 'civilian', U: 'undercover', B: 'blank' };

function mk(n, { seed = 1, cfg = {}, bank = BANK } = {}) {
  const config = { ...C.defaults(n), ...cfg };
  return new Sim(game, { n, seed, config, banks: { undercover: bank } });
}

/** Fix the deal: `spec` is one letter per seat p1..pn (C civilian, U undercover, B blank). */
function rig(sim, spec, { starter = 'p1', civ = '蘋果', und = '雪梨' } = {}) {
  const s = sim.state;
  const pids = sim.players.map((p) => p.id);
  assert.equal(spec.length, pids.length, 'spec length');
  s.pair = { civ, und, accept: [civ], cat: '食物', level: 1 };
  pids.forEach((p, i) => {
    s.roles[p] = ROLE[spec[i]];
    s.words[p] = s.roles[p] === 'civilian' ? civ : s.roles[p] === 'undercover' ? und : null;
  });
  const count = (ch) => [...spec].filter((c) => c === ch).length;
  s.counts0 = { civilians: count('C'), undercovers: count('U'), blanks: count('B') };
  s.starter = starter;
  return sim;
}

const ready = (sim) => { for (const p of sim.players) sim.act(p.id, { type: 'ready' }); };

function speakAll(sim) {
  let guard = 0;
  while (sim.state.phase === 'speak' && guard++ < 100) {
    const s = sim.state;
    sim.act(s.order[s.turn], { type: 'done', at: s.phase === 'speak' ? E.view(s, null).speak.id : undefined });
  }
}

/** ready → speak → discuss → vote */
function toVote(sim) {
  if (sim.state.phase === 'deal') ready(sim);
  speakAll(sim);
  assert.equal(sim.state.phase, 'discuss');
  assert.ok(sim.act('p1', { type: 'start-vote' }));
  assert.equal(sim.state.phase, 'vote');
}

/** `map` voter → target | null; missing voters vote for the first candidate that is not themselves. */
function castVotes(sim, map = {}) {
  for (const v of sim.state.voters.slice()) {
    if (sim.state.phase !== 'vote') break;
    const t = v in map ? map[v] : sim.state.candidates.find((c) => c !== v);
    sim.act(v, { type: 'vote', target: t });
  }
}

/** Everybody except `target` votes for `target`; `target` votes for someone else. */
function voteOut(sim, target) {
  const other = sim.state.candidates.find((c) => c !== target);
  const map = {};
  for (const v of sim.state.voters) map[v] = v === target ? other : target;
  castVotes(sim, map);
}

/** Play a whole round that eliminates `target`, then press 繼續 (unless a guess is pending). */
function roundOut(sim, target, { proceed = true } = {}) {
  toVote(sim);
  voteOut(sim, target);
  assert.equal(sim.state.phase, 'elim');
  assert.equal(sim.state.elim.out, target);
  if (proceed && !sim.state.elim.guess?.pending) sim.act('p1', { type: 'continue' });
}

const view = (sim, pid) => sim.view(pid);
const phase = (sim) => sim.state.phase;
const unchanged = (sim, pid, action) => {
  const before = JSON.stringify(sim.state);
  const changed = sim.act(pid, action);
  assert.equal(changed, false, `${JSON.stringify(action)} by ${pid} should do nothing in ${sim.state.phase}`);
  assert.equal(JSON.stringify(sim.state), before);
};

// ============================================================
// meta, rules, config
// ============================================================

test('undercover: meta and rules are well-formed', () => {
  assert.equal(meta.id, 'undercover');
  assert.deepEqual(meta.players, [4, 12]);
  assert.deepEqual(meta.banks, ['undercover']);
  assert.equal(meta.css, true);
  assert.equal(meta.singleDevice, 'full');
  assert.ok(['required', 'recommended', 'optional', 'none'].includes(meta.narration));
  assert.ok(meta.minutes[0] < meta.minutes[1]);
  assert.ok(rules.quick.length >= 4 && rules.quick.every((l) => typeof l === 'string' && l.length > 4));
  assert.deepEqual(rules.roles.map((r) => r.id), ['civilian', 'undercover', 'blank']);
  for (const r of rules.roles) assert.ok(r.name && r.emoji && r.team && r.text);
  assert.ok(rules.sections.length >= 4 && rules.sections.every((s) => s.title && s.body));
  for (const fn of ['setup', 'act', 'advance', 'view', 'cue', 'focus', 'autoAct', 'legalActions', 'result']) {
    assert.equal(typeof E[fn], 'function', fn);
  }
});

test('undercover: defaults are valid for every head-count and follow the research table', () => {
  const expectU = { 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 3, 11: 3, 12: 3 };
  for (const n of N_RANGE) {
    const cfg = C.defaults(n);
    const v = C.validate(cfg, n);
    assert.ok(v.ok, `n=${n}: ${v.message}`);
    assert.equal(cfg.undercovers, expectU[n], `n=${n}`);
    assert.equal(cfg.blanks, 0);
    assert.equal(cfg._n, n);
    assert.ok(Array.isArray(C.summary(cfg, n)) && C.summary(cfg, n).length >= 3);
  }
});

test('undercover: defaults(n, prev) keeps edited role counts and follows the head-count otherwise', () => {
  const six = C.defaults(6);
  assert.equal(C.defaults(7, six).undercovers, 2, 'untouched recommendation follows n');
  const edited = { ...C.defaults(8), undercovers: 1, blanks: 1 };
  const nine = C.defaults(9, edited);
  assert.equal(nine.undercovers, 1);
  assert.equal(nine.blanks, 1);
  const tooBig = { ...C.defaults(12), undercovers: 3, blanks: 2 };
  const four = C.defaults(4, tooBig);
  assert.ok(C.validate(four, 4).ok, 'falls back to a valid table');
  assert.equal(four.undercovers, 1);
  const kept = C.defaults(6, { ...six, speakSec: 25, revealRole: false, tie: 'skip', words: { cats: ['食物'], levels: [1] } });
  assert.equal(kept.speakSec, 25);
  assert.equal(kept.revealRole, false);
  assert.equal(kept.tie, 'skip');
  assert.deepEqual(kept.words, { cats: ['食物'], levels: [1] });
});

test('undercover: validate accepts exactly the legal role splits', () => {
  for (const n of N_RANGE) {
    const maxInf = Math.floor((n - 1) / 2);
    const maxBlank = n >= 10 ? 2 : 1;
    for (let u = 0; u <= 6; u++) {
      for (let b = 0; b <= 3; b++) {
        const legal = u + b >= 1 && b <= maxBlank && u + b <= maxInf;
        for (const win of ['parity', 'last3']) {
          const v = C.validate({ ...C.defaults(n), undercovers: u, blanks: b, win }, n);
          assert.equal(v.ok, legal, `n=${n} u=${u} b=${b} ${win}: ${v.message}`);
          if (legal) {
            // never already decided at the deal
            assert.equal(K.infiltratorsWin(n - u - b, u + b, win), false, `n=${n} u=${u} b=${b} ${win}`);
          } else {
            assert.ok(v.message.length > 3);
          }
        }
      }
    }
  }
});

test('undercover: validate rejects head-counts outside 4..12 and coerces form strings', () => {
  assert.equal(C.validate(C.defaults(4), 3).ok, false);
  assert.equal(C.validate(C.defaults(12), 13).ok, false);
  assert.equal(C.validate({ ...C.defaults(8), undercovers: '2', blanks: '1' }, 8).ok, true);
  assert.equal(C.validate({ ...C.defaults(8), undercovers: 'abc' }, 8).ok, true, 'falls back to the recommendation');
  assert.equal(C.validate({ undercovers: -1 }, 8).ok, false);
  assert.equal(C.validate(null, 8).ok, true);
});

test('undercover: validate warns about lopsided tables but still allows them', () => {
  const w = (n, patch) => C.validate({ ...C.defaults(n), ...patch }, n).warnings.join('|');
  assert.match(w(5, { blanks: 1 }), /投錯 1 個平民/);
  assert.match(w(4, { win: 'last3' }), /投錯 1 個平民/);
  assert.match(w(10, { undercovers: 1 }), /臥底方好難贏/);
  assert.match(w(5, { blanks: 1 }), /白板/);
  assert.match(w(7, { undercovers: 0, blanks: 1 }), /冇臥底/);
  assert.equal(w(8, {}), '');
});

test('undercover: infiltrators-win truth table (parity and last3, every split of 4..12)', () => {
  const { infiltratorsWin: win, lossAfter } = K;
  assert.equal(win(3, 0, 'parity'), false);
  assert.equal(win(3, 1, 'parity'), false);
  assert.equal(win(2, 1, 'parity'), false);
  assert.equal(win(1, 1, 'parity'), true);
  assert.equal(win(2, 2, 'parity'), true);
  assert.equal(win(3, 1, 'last3'), false);           // 4 left
  assert.equal(win(2, 1, 'last3'), true);            // 3 left
  assert.equal(win(1, 2, 'last3'), true);
  assert.equal(win(3, 3, 'last3'), false, 'pure last3: parity alone is not enough');
  assert.equal(win(3, 3, 'parity'), true);
  assert.equal(win(0, 4, 'last3'), true, 'nobody left to vote them out');
  assert.equal(win(0, 1, 'parity'), true);
  assert.equal(win(5, 0, 'last3'), false, 'no infiltrators never wins for them');
  for (const n of N_RANGE) {
    for (let inf = 1; inf <= Math.floor((n - 1) / 2); inf++) {
      const civ = n - inf;
      assert.equal(lossAfter(civ, inf, 'parity'), civ - inf, `parity n=${n} inf=${inf}`);
      const l3 = lossAfter(civ, inf, 'last3');
      assert.ok(l3 >= 1 && l3 <= civ);
      assert.equal(win(civ - l3, inf, 'last3'), true);
      assert.equal(win(civ - l3 + 1, inf, 'last3'), false);
    }
  }
});

test('undercover: fields describe the form and respect the head-count', () => {
  for (const n of N_RANGE) {
    const cfg = C.defaults(n);
    const fields = C.fields(cfg, n);
    const keys = fields.map((f) => f.key);
    for (const k of ['undercovers', 'blanks', 'blankGuess', 'win', 'tie', 'revealRole', 'abstain', 'speakSec', 'discussSec', 'voteSec', 'words']) {
      assert.ok(keys.includes(k), `${k} missing`);
    }
    assert.equal(new Set(keys).size, keys.length);
    for (const f of fields) {
      assert.ok(['int', 'bool', 'select', 'seconds', 'categories'].includes(f.type), f.type);
      assert.ok(f.label);
      if (f.type === 'select') assert.ok(f.options.length >= 2 && f.options.every((o) => 'value' in o && o.label));
    }
    const u = fields.find((f) => f.key === 'undercovers');
    assert.equal(u.max, Math.floor((n - 1) / 2) - cfg.blanks);
    const b = fields.find((f) => f.key === 'blanks');
    assert.equal(b.max, Math.min(n >= 10 ? 2 : 1, Math.floor((n - 1) / 2) - cfg.undercovers));
    const w = fields.find((f) => f.key === 'words');
    assert.equal(w.type, 'categories');
    assert.equal(w.bank, 'undercover');
    assert.ok(w.options.length >= 10);
    assert.equal(w.matches({ cats: ['交通'], levels: [] }, { a: 'x', b: 'y', cat: '交通', level: 3 }), true);
    assert.equal(w.matches({ cats: ['交通'], levels: [] }, { a: 'x', b: 'y', cat: '食物', level: 3 }), false);
    assert.equal(w.matches({ cats: [], levels: [1, 2] }, { cat: '食物', level: 3 }), false);
  }
});

test('undercover: the words field carries 已用/總數 when the lobby hands over the bag', () => {
  const bag = makeBag(banks);
  const none = C.fields(C.defaults(6), 6).find((f) => f.key === 'words');
  assert.equal(none.stats, undefined);
  const all = C.fields(C.defaults(6), 6, { bag }).find((f) => f.key === 'words');
  assert.deepEqual(all.stats, { used: 0, total: BANK.length });
  bag.draw('undercover', (e) => e.cat === '交通');
  const traffic = C.fields({ ...C.defaults(6), words: { cats: ['交通'], levels: [] } }, 6, { bag }).find((f) => f.key === 'words');
  assert.deepEqual(traffic.stats, { used: 1, total: 1 });
  const lv = C.fields({ ...C.defaults(6), words: { cats: [], levels: [1, 3] } }, 6, { bag }).find((f) => f.key === 'words');
  assert.equal(lv.stats.total, BANK.filter((e) => e.level !== 2).length);
  const broken = C.fields(C.defaults(6), 6, { bag: { stats() { throw new Error('bank not loaded'); } } }).find((f) => f.key === 'words');
  assert.equal(broken.stats, undefined);
});

test('undercover: summary lines mention what the host changed', () => {
  const cfg = {
    ...C.defaults(8), blanks: 1, undercovers: 1, revealRole: false, abstain: true, win: 'last3', tie: 'skip',
    speakSec: 30, discussSec: 90, voteSec: 20, words: { cats: ['食物', '飲品'], levels: [1, 2] },
  };
  const text = C.summary(cfg, 8).join('\n');
  for (const frag of ['平民 6', '臥底 1', '白板 1', '剩 3 人', '平票即係冇人出局', '食物、飲品', '簡單、中等', '唔公開身份', '容許棄票', '發言限時 30', '討論限時 90', '投票限時 20', '白板出局可以猜詞']) {
    assert.ok(text.includes(frag), `summary lacks ${frag}\n${text}`);
  }
});

test('undercover: word filter normalisation accepts forms and garbage', () => {
  assert.deepEqual(K.normaliseWords(undefined), { cats: [], levels: [] });
  assert.deepEqual(K.normaliseWords(['食物', '食物', 5]), { cats: ['食物'], levels: [] });
  assert.deepEqual(K.normaliseWords({ cats: ['x'], levels: ['2', 3, 9, 'a'] }), { cats: ['x'], levels: [2, 3] });
  assert.deepEqual(K.normaliseWords('食物'), { cats: [], levels: [] });
  assert.equal(K.matches(undefined, { cat: 'anything' }), true);
});

// ============================================================
// setup
// ============================================================

test('undercover: setup deals the configured table with one shared civilian word', () => {
  for (const n of N_RANGE) {
    for (const blanks of [0, 1]) {
      const cfg = { ...C.defaults(n), blanks };
      if (!C.validate(cfg, n).ok) continue;
      const sim = mk(n, { seed: n * 10 + blanks, cfg });
      const s = sim.state;
      const by = { civilian: [], undercover: [], blank: [] };
      for (const p of sim.players) by[s.roles[p.id]].push(p.id);
      assert.equal(by.undercover.length, cfg.undercovers);
      assert.equal(by.blank.length, blanks);
      assert.equal(by.civilian.length, n - cfg.undercovers - blanks);
      assert.notEqual(s.pair.civ, s.pair.und);
      for (const p of by.civilian) assert.equal(s.words[p], s.pair.civ);
      for (const p of by.undercover) assert.equal(s.words[p], s.pair.und);
      for (const p of by.blank) assert.equal(s.words[p], null);
      assert.ok(BANK.some((e) => [e.a, e.b].includes(s.pair.civ) && [e.a, e.b].includes(s.pair.und)));
      assert.equal(s.phase, 'deal');
      assert.equal(s.round, 1);
    }
  }
});

test('undercover: which word the civilians get is random, roles are shuffled', () => {
  let civIsA = 0;
  const holder = new Set();
  for (let seed = 1; seed <= 80; seed++) {
    const sim = mk(6, { seed, bank: [BANK[0]] });
    if (sim.state.pair.civ === '蘋果') civIsA++;
    holder.add(Object.keys(sim.state.roles).find((p) => sim.state.roles[p] === 'undercover'));
  }
  assert.ok(civIsA > 20 && civIsA < 60, `orientation ${civIsA}/80`);
  assert.equal(holder.size, 6, 'every seat gets to be the undercover');
});

test('undercover: category and level filters narrow the draw', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const t = mk(6, { seed, cfg: { words: { cats: ['交通'], levels: [] } } });
    assert.ok(['的士', '巴士'].includes(t.state.pair.civ));
    assert.equal(E.view(t.state, 'p1').relaxed, undefined);
    const l = mk(6, { seed, cfg: { words: { cats: [], levels: [3] } } });
    assert.ok(['烏冬', '拉麵'].includes(l.state.pair.civ));
    const both = mk(6, { seed, cfg: { words: { cats: ['日本旅行'], levels: [2] } } });
    assert.ok(['壽司', '刺身'].includes(both.state.pair.civ));
  }
});

test('undercover: a filter that matches nothing is relaxed and flagged; an empty bank falls back', () => {
  const relaxed = mk(6, { cfg: { words: { cats: ['節日'], levels: [] } } });
  assert.ok(BANK.some((e) => e.a === relaxed.state.pair.civ || e.b === relaxed.state.pair.civ));
  assert.equal(E.view(relaxed.state, 'p1').relaxed, true);
  const empty = mk(6, { bank: [] });
  assert.ok(empty.state.pair.civ && empty.state.pair.und && empty.state.pair.civ !== empty.state.pair.und);
  const junk = mk(6, { bank: [{ a: '同', b: '同', cat: '食物', level: 1 }, { a: '', b: 'x' }] });
  assert.notEqual(junk.state.pair.civ, junk.state.pair.und);
  // a bank that never draws still works
  const noBag = E.setup({ players: makePlayers(6), config: C.defaults(6), rng: mulberry32(3), now: 0, bag: undefined });
  assert.equal(noBag.phase, 'deal');
});

test('undercover: the first speaker is never the white card unless allowed', () => {
  let blankFirst = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const a = mk(6, { seed, cfg: { blanks: 1 } });
    assert.notEqual(a.state.roles[a.state.starter], 'blank');
    const b = mk(6, { seed, cfg: { blanks: 1, blankNeverFirst: false } });
    if (b.state.roles[b.state.starter] === 'blank') blankFirst++;
  }
  assert.ok(blankFirst > 5, `blank started ${blankFirst}/150 times when allowed`);
});

test('undercover: setup survives nonsense config by clamping it', () => {
  for (const n of [4, 7, 12]) {
    const s = E.setup({ players: makePlayers(n), config: { undercovers: 99, blanks: 99, win: 'x', tie: 5 }, rng: mulberry32(1), now: 0, bag: makeBag(banks) });
    const infiltrators = Object.values(s.roles).filter((r) => r !== 'civilian').length;
    assert.ok(infiltrators <= Math.floor((n - 1) / 2));
    assert.ok(infiltrators >= 1);
    assert.equal(s.cfg.win, 'parity');
    assert.equal(s.cfg.tie, 'pk');
  }
  const s = E.setup({ players: makePlayers(6), config: { undercovers: 0, blanks: 0 }, rng: mulberry32(1), now: 0, bag: makeBag(banks) });
  assert.equal(Object.values(s.roles).filter((r) => r === 'undercover').length, 1);
});

// ============================================================
// deal
// ============================================================

test('undercover: nobody speaks until every seat has confirmed its word', () => {
  const sim = mk(5, { seed: 3 });
  rig(sim, 'CCCCU');
  assert.equal(phase(sim), 'deal');
  assert.deepEqual(sim.focus().pids, ['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.ok(sim.act('p3', { type: 'ready' }));
  assert.equal(sim.act('p3', { type: 'ready' }), false, 'ready is idempotent');
  assert.deepEqual(sim.focus().pids, ['p1', 'p2', 'p4', 'p5']);
  for (const p of ['p1', 'p2', 'p4']) sim.act(p, { type: 'ready' });
  assert.equal(phase(sim), 'deal');
  assert.deepEqual(view(sim, null).deal, { ready: ['p1', 'p2', 'p3', 'p4'], total: 5 });
  sim.act('p5', { type: 'ready' });
  assert.equal(phase(sim), 'speak');
  assert.equal(sim.focus(), null);
  assert.equal(sim.state.round, 1);
  assert.equal(view(sim, null).speak.pid, 'p1');
});

test('undercover: foreign seats, garbage and out-of-phase actions change nothing', () => {
  const sim = mk(5, { seed: 3 });
  rig(sim, 'CCCCU');
  const junk = [
    undefined, null, 'ready', 7, {}, { type: 5 }, { type: 'nope' }, { type: 'vote', target: 'p2' }, { type: 'done' },
    { type: 'continue' }, { type: 'start-vote' }, { type: 'guess', word: '蘋果' }, { type: 'review-end' },
    { type: ACT.NEXT }, { type: ACT.CUE_DONE, id: 'x' }, { type: ACT.AUTO, pid: 'p1' },
  ];
  for (const a of junk) {
    unchanged(sim, 'p1', a);
    unchanged(sim, 'ghost', { type: 'ready' });
  }
  for (const pid of [undefined, null, 5, '@host-ish', '__proto__']) unchanged(sim, pid, { type: 'ready' });
  assert.throws(() => { throw new Error('x'); }); // sanity: assert.throws works in this harness
  assert.doesNotThrow(() => E.act(clone(sim.state), undefined, { rng: mulberry32(1), now: 1 }));
  assert.doesNotThrow(() => E.act(clone(sim.state), { pid: 'p1' }, { rng: mulberry32(1), now: 1 }));
});

// ============================================================
// speaking
// ============================================================

test('undercover: speaking starts at the starter, follows seat order and wraps', () => {
  const sim = mk(6, { seed: 4 });
  rig(sim, 'CCCCCU', { starter: 'p4' });
  ready(sim);
  assert.deepEqual(sim.state.order, ['p4', 'p5', 'p6', 'p1', 'p2', 'p3']);
  assert.equal(view(sim, 'p2').speak.pid, 'p4');
  assert.deepEqual(sim.legal('p4').map((a) => a.type).filter((t) => t === 'done'), ['done']);
  assert.deepEqual(sim.legal('p5').filter((a) => a.type === 'done'), []);
  speakAll(sim);
  assert.equal(phase(sim), 'discuss');
  assert.equal(view(sim, null).speak, undefined);
});

test('undercover: a stale or double tap on 講完喇 cannot skip the next speaker', () => {
  const sim = mk(5, { seed: 5 });
  rig(sim, 'CCCCU');
  ready(sim);
  const at0 = view(sim, 'p1').speak.id;
  assert.ok(sim.act('p1', { type: 'done', at: at0 }));
  unchanged(sim, 'p1', { type: 'done', at: at0 });
  assert.equal(sim.state.turn, 1);
  assert.ok(sim.act('p3', { type: 'done' }), 'any seat may press it (shared phone); no step id = unguarded');
  assert.equal(sim.state.turn, 2);
});

test('undercover: later rounds start after the previous first speaker and skip the eliminated', () => {
  const sim = mk(7, { seed: 6 });
  rig(sim, 'CCCCCUU', { starter: 'p3' });
  ready(sim);
  assert.deepEqual(sim.state.order, ['p3', 'p4', 'p5', 'p6', 'p7', 'p1', 'p2']);
  roundOut(sim, 'p4');                                   // civilian p4 leaves
  assert.equal(phase(sim), 'speak');
  assert.equal(sim.state.round, 2);
  assert.deepEqual(sim.state.order, ['p5', 'p6', 'p7', 'p1', 'p2', 'p3'], 'next alive after p3 is p5, dead p4 skipped');
  roundOut(sim, 'p5');
  assert.deepEqual(sim.state.order, ['p6', 'p7', 'p1', 'p2', 'p3'], 'rotation continues from the previous FIRST speaker');
  assert.ok(!sim.state.order.includes('p4') && !sim.state.order.includes('p5'));
});

test('undercover: speaking timer skips a slow speaker; no timer means no deadline', () => {
  const none = mk(5, { seed: 7 });
  rig(none, 'CCCCU');
  ready(none);
  assert.equal(none.state.deadline, null);
  assert.equal(view(none, 'p1').deadline, undefined);
  assert.equal(none.advance(), false);

  const sim = mk(5, { seed: 7, cfg: { speakSec: 20 } });
  rig(sim, 'CCCCU');
  ready(sim);
  const t0 = sim.now;
  assert.equal(sim.state.deadline, t0 + 20_000);
  assert.equal(view(sim, 'p2').timerLabel, '發言');
  assert.equal(E.advance(clone(sim.state), { rng: sim.rng, now: t0 + 19_999 }).turn, 0, 'too early is a no-op');
  assert.ok(sim.advance());
  assert.equal(sim.state.turn, 1);
  assert.equal(sim.state.deadline, sim.now + 20_000, 'every turn gets a fresh clock');
  while (phase(sim) === 'speak') sim.advance();
  assert.equal(phase(sim), 'discuss');
  assert.equal(sim.state.deadline, null, 'discussion is untimed by default');
});

test('undercover: discussion ends when any seat opens the vote, or when its timer runs out', () => {
  const sim = mk(5, { seed: 8, cfg: { discussSec: 60 } });
  rig(sim, 'CCCCU');
  ready(sim);
  speakAll(sim);
  assert.equal(phase(sim), 'discuss');
  assert.equal(sim.state.deadline, sim.now + 60_000);
  assert.equal(view(sim, 'p1').timerLabel, '討論');
  assert.ok(sim.advance());
  assert.equal(phase(sim), 'vote');

  const manual = mk(5, { seed: 8 });
  rig(manual, 'CCCCU');
  ready(manual);
  speakAll(manual);
  assert.ok(manual.act('p5', { type: 'start-vote' }));
  assert.equal(phase(manual), 'vote');
  unchanged(manual, 'p1', { type: 'start-vote' });
});

// ============================================================
// voting
// ============================================================

test('undercover: ballots are validated (self, dead, unknown, abstain, wrong phase)', () => {
  const sim = mk(6, { seed: 9 });
  rig(sim, 'CCCCCU');
  unchanged(sim, 'p1', { type: 'vote', target: 'p2' });             // not voting yet
  toVote(sim);
  unchanged(sim, 'p1', { type: 'vote', target: 'p1' });             // self
  unchanged(sim, 'p1', { type: 'vote', target: 'nobody' });
  unchanged(sim, 'p1', { type: 'vote', target: 7 });
  unchanged(sim, 'p1', { type: 'vote', target: null });             // abstain is off
  unchanged(sim, 'p1', { type: 'vote' });
  unchanged(sim, 'p1', { type: 'vote', target: { x: 1 } });
  unchanged(sim, 'ghost', { type: 'vote', target: 'p2' });
  assert.ok(sim.act('p1', { type: 'vote', target: 'p2' }));
  assert.equal(view(sim, 'p1').me.myVote, 'p2');
  assert.equal(view(sim, 'p2').me.myVote, undefined, 'a ballot is private');
  assert.deepEqual(view(sim, 'p3').vote.done, ['p1']);
  assert.equal(JSON.stringify(view(sim, 'p3')).includes('"p1":"p2"'), false);
});

test('undercover: a dead seat cannot be voted for or vote', () => {
  const sim = mk(7, { seed: 10 });
  rig(sim, 'CCCCCUU');
  roundOut(sim, 'p6');
  toVote(sim);
  assert.ok(!sim.state.voters.includes('p6'));
  assert.ok(!sim.state.candidates.includes('p6'));
  unchanged(sim, 'p6', { type: 'vote', target: 'p1' });
  unchanged(sim, 'p1', { type: 'vote', target: 'p6' });
  assert.equal(view(sim, 'p6').me.canVote, false);
  assert.deepEqual(view(sim, 'p6').me.targets, []);
  assert.deepEqual(view(sim, 'p1').me.targets, ['p2', 'p3', 'p4', 'p5', 'p7']);
});

test('undercover: abstaining only works when allowed; a ballot can be changed until the last one lands', () => {
  const sim = mk(6, { seed: 11, cfg: { abstain: true } });
  rig(sim, 'CCCCCU');
  toVote(sim);
  assert.ok(sim.act('p1', { type: 'vote', target: null }));
  assert.equal(view(sim, 'p1').me.myVote, null);
  assert.ok(sim.act('p1', { type: 'vote', target: 'p2' }), 'change of mind');
  assert.equal(sim.act('p1', { type: 'vote', target: 'p2' }), false, 'same ballot is no change');
  assert.equal(sim.focus().pids.includes('p1'), false);
  assert.deepEqual(sim.legal('p1').filter((a) => a.type === 'vote').map((a) => a.target).sort(), [null, 'p3', 'p4', 'p5', 'p6']);
});

test('undercover: the vote resolves the moment the last voter has voted', () => {
  const sim = mk(5, { seed: 12 });
  rig(sim, 'CCCCU');
  toVote(sim);
  for (const v of ['p1', 'p2', 'p3', 'p4']) {
    sim.act(v, { type: 'vote', target: 'p5' });
    assert.equal(phase(sim), 'vote');
  }
  assert.deepEqual(sim.focus().pids, ['p5']);
  sim.act('p5', { type: 'vote', target: 'p1' });
  assert.equal(phase(sim), 'elim');
  assert.equal(sim.state.elim.out, 'p5');
  assert.deepEqual(sim.state.elim.counts, { p5: 4, p1: 1 });
  assert.equal(sim.focus(), null);
});

test('undercover: a vote timer counts missing ballots as abstentions', () => {
  const sim = mk(5, { seed: 13, cfg: { voteSec: 30 } });
  rig(sim, 'CCCCU');
  toVote(sim);
  assert.equal(sim.state.deadline, sim.now + 30_000);
  assert.equal(view(sim, 'p1').timerLabel, '投票');
  sim.act('p1', { type: 'vote', target: 'p5' });
  sim.act('p2', { type: 'vote', target: 'p5' });
  assert.ok(sim.advance());
  assert.equal(phase(sim), 'elim');
  assert.equal(sim.state.elim.out, 'p5');
  assert.deepEqual(sim.state.elim.ballots, { p1: 'p5', p2: 'p5', p3: null, p4: null, p5: null });
});

test('undercover: nobody voting means nobody leaves', () => {
  const sim = mk(5, { seed: 14, cfg: { voteSec: 30 } });
  rig(sim, 'CCCCU');
  toVote(sim);
  sim.advance();
  assert.equal(sim.state.elim.kind, 'none');
  assert.equal(sim.state.elim.reason, 'nobody');
  assert.equal(sim.state.alive.length, 5);
  assert.match(sim.cue().text, /冇人投票/);
  sim.act('p2', { type: 'continue' });
  assert.equal(sim.state.round, 2);
  assert.equal(phase(sim), 'speak');
});

// ============================================================
// ties
// ============================================================

/** 8 players, p1..p4 vs p5..p8: a clean 4–4 split between p7 and p8 is impossible with 8 ballots on 2 targets only if nobody else is voted, so use 3/3/2. */
function tieMain(sim, a, b) {
  const voters = sim.state.voters.slice();
  const map = {};
  // first half votes a, second half votes b, last two voters vote each other's target so a and b tie
  const rest = voters.filter((v) => v !== a && v !== b);
  rest.forEach((v, i) => { map[v] = i % 2 === 0 ? a : b; });
  map[a] = b;
  map[b] = a;
  castVotes(sim, map);
}

test('undercover: a tie goes to PK — the tied speak again, then everybody re-votes between them', () => {
  const sim = mk(8, { seed: 15 });
  rig(sim, 'CCCCCCUU');
  toVote(sim);
  tieMain(sim, 'p7', 'p8');
  assert.equal(phase(sim), 'elim');
  const e = view(sim, 'p1').elim;
  assert.equal(e.kind, 'pk');
  assert.deepEqual(e.cands.slice().sort(), ['p7', 'p8']);
  assert.equal(e.out, null);
  assert.equal(sim.state.alive.length, 8, 'nobody left yet');
  assert.match(sim.cue().text, /平票/);
  sim.act('p2', { type: 'continue' });
  assert.equal(phase(sim), 'speak');
  assert.equal(sim.state.speakKind, 'pk');
  assert.deepEqual(sim.state.order, ['p7', 'p8'], 'only the tied, in the round order');
  assert.equal(sim.state.round, 1, 'PK belongs to the same round');
  assert.match(sim.cue().text, /再用一句嘢/);
  speakAll(sim);
  assert.equal(phase(sim), 'vote', 'no free discussion before the PK vote');
  assert.equal(sim.state.voteKind, 'pk');
  assert.deepEqual(sim.state.candidates, ['p7', 'p8']);
  assert.equal(sim.state.voters.length, 8, 'everybody alive votes (research default ALL_ALIVE)');
  unchanged(sim, 'p1', { type: 'vote', target: 'p2' });
  unchanged(sim, 'p7', { type: 'vote', target: 'p7' });
  assert.deepEqual(view(sim, 'p7').me.targets, ['p8'], 'a tied player can only vote for the other');
  assert.deepEqual(view(sim, 'p1').me.targets, ['p7', 'p8']);
  castVotes(sim, { p1: 'p7', p2: 'p7', p3: 'p7', p4: 'p7', p5: 'p8', p6: 'p8', p7: 'p8', p8: 'p7' });
  assert.equal(sim.state.elim.out, 'p7');
  assert.equal(sim.state.elim.voteKind, 'pk');
  assert.equal(sim.state.alive.length, 7);
});

test('undercover: a second tie ends the round with nobody out (pk), or picks at random (pk-random)', () => {
  const tieTwice = (cfg, seed) => {
    const sim = mk(8, { seed, cfg });
    rig(sim, 'CCCCCCUU');
    toVote(sim);
    tieMain(sim, 'p7', 'p8');
    sim.act('p1', { type: 'continue' });
    speakAll(sim);
    castVotes(sim, { p1: 'p7', p2: 'p7', p3: 'p7', p4: 'p8', p5: 'p8', p6: 'p8', p7: 'p8', p8: 'p7' });
    return sim;
  };
  const pk = tieTwice({}, 16);
  assert.equal(pk.state.elim.kind, 'none');
  assert.equal(pk.state.alive.length, 8);
  assert.equal(pk.state.noElimStreak, 1);
  assert.match(pk.cue().text, /再次平票/);
  pk.act('p1', { type: 'continue' });
  assert.equal(pk.state.round, 2);

  const outs = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const r = tieTwice({ tie: 'pk-random' }, seed);
    assert.equal(r.state.elim.kind, 'out');
    assert.equal(r.state.elim.random, true);
    assert.ok(['p7', 'p8'].includes(r.state.elim.out));
    assert.match(r.cue().text, /隨機抽中/);
    outs.add(r.state.elim.out);
  }
  assert.equal(outs.size, 2, 'both tied players get picked sometimes');
});

test('undercover: tie = skip means no PK, nobody leaves', () => {
  const sim = mk(8, { seed: 17, cfg: { tie: 'skip' } });
  rig(sim, 'CCCCCCUU');
  toVote(sim);
  tieMain(sim, 'p7', 'p8');
  assert.equal(sim.state.elim.kind, 'none');
  assert.equal(sim.state.elim.reason, 'tie');
  assert.match(sim.cue().text, /平票，今輪冇人出局/);
  sim.act('p1', { type: 'continue' });
  assert.equal(sim.state.round, 2);
  assert.equal(sim.state.speakKind, 'round');
});

test('undercover: a vote where everybody ties (a cycle) is not worth a PK', () => {
  const sim = mk(5, { seed: 18 });
  rig(sim, 'CCCCU');
  toVote(sim);
  castVotes(sim, { p1: 'p2', p2: 'p3', p3: 'p4', p4: 'p5', p5: 'p1' });
  assert.equal(sim.state.elim.kind, 'none');
  assert.equal(sim.state.elim.top.length, 5);
  assert.equal(sim.state.alive.length, 5);
});

test('undercover: after two rounds without an elimination the third must eliminate somebody', () => {
  const sim = mk(5, { seed: 19, cfg: { tie: 'skip' } });
  rig(sim, 'CCCCU');
  const cycle = { p1: 'p2', p2: 'p3', p3: 'p4', p4: 'p5', p5: 'p1' };
  for (let r = 1; r <= 2; r++) {
    toVote(sim);
    castVotes(sim, cycle);
    assert.equal(sim.state.elim.kind, 'none');
    assert.equal(sim.state.noElimStreak, r);
    sim.act('p1', { type: 'continue' });
    assert.equal(sim.state.round, r + 1);
  }
  toVote(sim);
  castVotes(sim, cycle);
  const e = sim.state.elim;
  assert.equal(e.kind, 'out');
  assert.equal(e.forced, true);
  assert.equal(sim.state.noElimStreak, 0);
  assert.equal(sim.state.alive.length, 4);
  assert.match(sim.cue().text, /連續幾輪冇人出局/);
  // and nobody voting at all is forced too
  const idle = mk(5, { seed: 20, cfg: { voteSec: 10 } });
  rig(idle, 'CCCCU');
  idle.state.noElimStreak = 2;
  toVote(idle);
  idle.advance();
  assert.equal(idle.state.elim.kind, 'out');
  assert.equal(idle.state.elim.forced, true);
});

// ============================================================
// elimination and reveal
// ============================================================

test('undercover: the eliminated role is announced by default', () => {
  const sim = mk(6, { seed: 21 });
  rig(sim, 'CCCCCU');
  roundOut(sim, 'p2', { proceed: false });
  for (const pid of [null, 'p1', 'p6']) {
    const v = view(sim, pid);
    assert.equal(v.elim.out, 'p2');
    assert.equal(v.elim.role, 'civilian');
    assert.deepEqual(v.outs, [{ pid: 'p2', round: 1, role: 'civilian' }]);
  }
  assert.match(sim.cue().text, /玩家2 出局。佢係平民/);
  assert.deepEqual(view(sim, 'p1').seats.filter((s) => !s.alive).map((s) => s.id), ['p2']);
});

test('undercover: with reveal off nothing is said about the role, except a white card that must guess', () => {
  const sim = mk(7, { seed: 22, cfg: { revealRole: false, blanks: 1, undercovers: 1 } });
  rig(sim, 'CCCCCUB');
  roundOut(sim, 'p2', { proceed: false });
  const v = view(sim, 'p1');
  assert.equal(v.elim.role, null);
  assert.deepEqual(v.outs, [{ pid: 'p2', round: 1, role: null }]);
  assert.equal(/"(civilian|undercover|blank)"/.test(JSON.stringify(v)), false);
  assert.doesNotMatch(sim.cue().text, /平民|臥底|白板/);
  sim.act('p1', { type: 'continue' });
  roundOut(sim, 'p7', { proceed: false });
  assert.equal(view(sim, 'p3').elim.role, 'blank', 'the guess announces the white card');
  assert.equal(view(sim, 'p3').outs[1].role, 'blank');

  const noGuess = mk(7, { seed: 22, cfg: { revealRole: false, blanks: 1, undercovers: 1, blankGuess: false } });
  rig(noGuess, 'CCCCCUB');
  roundOut(noGuess, 'p7', { proceed: false });
  assert.equal(view(noGuess, 'p3').elim.role, null);
  assert.equal(view(noGuess, 'p3').elim.guess, null);
  assert.equal(noGuess.state.elim.next, 'round');
});

test('undercover: the history keeps every vote with who voted for whom, once it is over', () => {
  const sim = mk(6, { seed: 23 });
  rig(sim, 'CCCCCU');
  toVote(sim);
  voteOut(sim, 'p3');
  const h = view(sim, 'p1').history;
  assert.equal(h.length, 1);
  assert.equal(h[0].out, 'p3');
  assert.equal(h[0].outcome, 'out');
  assert.equal(h[0].role, 'civilian');
  assert.equal(h[0].ballots.p1, 'p3');
  assert.equal(h[0].ballots.p3, 'p1');
  assert.equal(h[0].counts.p3, 5);
});

// ============================================================
// white card guess
// ============================================================

function blankOut(cfg = {}, { seed = 24, spec = 'CCCCUB' } = {}) {
  const sim = mk(spec.length, { seed, cfg: { blanks: 1, undercovers: 1, ...cfg } });
  rig(sim, spec);
  roundOut(sim, `p${spec.indexOf('B') + 1}`, { proceed: false });
  return sim;
}

test('undercover: an eliminated white card must guess — everybody else waits', () => {
  const sim = blankOut();
  const e = sim.state.elim;
  assert.equal(e.guess.pending, true);
  assert.deepEqual(sim.focus(), { pids: ['p6'] });
  assert.equal(view(sim, 'p6').me.mustGuess, true);
  assert.equal(view(sim, 'p1').me.mustGuess, undefined);
  assert.equal(view(sim, 'p1').elim.guess.pending, true);
  assert.equal(sim.state.deadline, sim.now + 90_000);
  assert.equal(view(sim, 'p1').timerLabel, '猜詞');
  assert.match(sim.cue().text, /白板 玩家6.*打出/);
  unchanged(sim, 'p1', { type: 'continue' });
  unchanged(sim, 'p1', { type: 'guess', word: '蘋果' });
  unchanged(sim, 'p5', { type: 'guess', word: '蘋果' });
  assert.deepEqual(sim.legal('p1').filter((a) => a.type === 'continue' || a.type === 'guess'), []);
  assert.ok(sim.legal('p6').some((a) => a.type === 'guess'));
  assert.equal(JSON.stringify(view(sim, null)).includes('蘋果'), false, 'the word stays secret while the guess is open');
});

test('undercover: a correct guess wins for the infiltrators at once, even with civilians in the majority', () => {
  const sim = blankOut();
  assert.ok(sim.act('p6', { type: 'guess', word: '蘋果' }));
  assert.deepEqual(view(sim, 'p1').elim.guess, { pending: false, word: '蘋果', correct: true, timeout: false });
  assert.equal(sim.state.elim.next, 'over');
  assert.match(sim.cue().text, /猜「蘋果」，猜中喇/);
  assert.equal(sim.result(), null, 'the table sees the guess before the result');
  sim.act('p1', { type: 'continue' });
  assert.equal(phase(sim), 'over');
  const r = sim.result();
  assert.deepEqual(r.winners.sort(), ['p5', 'p6']);
  assert.match(r.lines[0], /猜中平民嘅詞語「蘋果」/);
  assert.equal(sim.state.win.why, 'guess');
  assert.equal(sim.state.alive.length, 5, 'four civilians and an undercover were still alive');
});

test('undercover: a wrong guess changes nothing else — and may hand the civilians the win', () => {
  // the white card was the last infiltrator
  const sim = blankOut({ undercovers: 0 }, { spec: 'CCCCCB' });
  sim.act('p6', { type: 'guess', word: '雪梨' });          // the undercover word is wrong too
  assert.equal(sim.state.elim.guess.correct, false);
  assert.equal(sim.state.elim.next, 'over');
  sim.act('p1', { type: 'continue' });
  assert.deepEqual(sim.result().winners, ['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.match(sim.result().lines[0], /白板被投出局，平民贏/);

  // the game goes on when an undercover is still alive
  const on = blankOut();
  on.act('p6', { type: 'guess', word: '西瓜' });
  assert.equal(on.state.elim.next, 'round');
  assert.match(on.cue().text, /猜「西瓜」，唔啱/);
  on.act('p2', { type: 'continue' });
  assert.equal(phase(on), 'speak');
  assert.equal(on.state.round, 2);
  assert.equal(on.state.alive.length, 5);
});

test('undercover: guesses ignore spaces, punctuation, width and case; blank or timed-out ones are wrong', () => {
  const tries = [
    ['蘋果', true], ['  蘋果 ', true], ['蘋 果', true], ['「蘋果」', true], ['蘋果。', true], ['雪梨', false],
    ['', false], ['   ', false], ['蘋', false], ['蘋果汁', false],
  ];
  for (const [word, ok] of tries) {
    const sim = blankOut();
    sim.act('p6', { type: 'guess', word });
    assert.equal(sim.state.elim.guess.correct, ok, JSON.stringify(word));
  }
  const wide = blankOut({}, { seed: 24 });
  wide.state.pair.civ = 'iPhone';
  wide.state.pair.accept = ['iPhone'];
  wide.act('p6', { type: 'guess', word: 'ＩＰＨＯＮＥ' });
  assert.equal(wide.state.elim.guess.correct, true);
  const alias = blankOut();
  alias.state.pair.accept = ['蘋果', '平果'];
  alias.act('p6', { type: 'guess', word: '平果' });
  assert.equal(alias.state.elim.guess.correct, true, 'bank aliases count');

  const notString = blankOut();
  unchanged(notString, 'p6', { type: 'guess', word: 42 });
  assert.equal(notString.state.elim.guess.pending, true, 'a malformed guess leaves the question open');
  const long = blankOut();
  long.act('p6', { type: 'guess', word: '蘋'.repeat(500) });
  assert.ok(long.state.elim.guess.word.length <= 40);

  const timeout = blankOut();
  assert.ok(timeout.advance());
  assert.deepEqual(timeout.state.elim.guess, { pending: false, word: '', correct: false, timeout: true });
  assert.match(timeout.cue().text, /冇作答/);
  assert.equal(timeout.state.elim.next, 'round');
});

test('undercover: one guess only, and only by the white card that was voted out', () => {
  const sim = blankOut();
  sim.act('p6', { type: 'guess', word: '西瓜' });
  unchanged(sim, 'p6', { type: 'guess', word: '蘋果' });
  assert.equal(sim.state.elim.guess.correct, false);
});

test('undercover: with guessing off the white card just leaves', () => {
  const sim = blankOut({ blankGuess: false });
  assert.equal(sim.state.elim.guess, null);
  assert.equal(sim.focus(), null);
  assert.equal(sim.state.elim.next, 'round');
  assert.ok(sim.act('p1', { type: 'continue' }));
});

test('undercover: the host can skip a white card that will not answer', () => {
  const sim = blankOut();
  sim.host({ type: ACT.CUE_DONE, id: sim.cue().id });
  assert.ok(sim.host({ type: ACT.NEXT }));
  assert.equal(sim.state.elim.guess.timeout, true);
  assert.equal(sim.state.elim.next, 'round');
});

// ============================================================
// winning
// ============================================================

test('undercover: voting out the last undercover wins for the civilians', () => {
  const sim = mk(6, { seed: 25 });
  rig(sim, 'CCCCCU');
  roundOut(sim, 'p6', { proceed: false });
  assert.equal(sim.state.elim.next, 'over');
  assert.equal(sim.result(), null);
  sim.act('p3', { type: 'continue' });
  assert.equal(phase(sim), 'over');
  const r = sim.result();
  assert.deepEqual(r.winners, ['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.match(r.summary, /^平民贏/);
  assert.match(r.lines[0], /所有臥底都被投出局/);
});

test('undercover: civilians must remove the undercover AND the white card', () => {
  const sim = mk(7, { seed: 26, cfg: { undercovers: 1, blanks: 1 } });
  rig(sim, 'CCCCCUB');
  roundOut(sim, 'p6');                                    // undercover out, white card still in
  assert.equal(phase(sim), 'speak');
  roundOut(sim, 'p7', { proceed: false });
  sim.act('p7', { type: 'guess', word: 'x' });
  sim.act('p1', { type: 'continue' });
  assert.equal(phase(sim), 'over');
  assert.match(sim.result().lines[0], /所有臥底同白板都被投出局/);
});

test('undercover: parity — infiltrators win when they are as many as the civilians left', () => {
  const sim = mk(5, { seed: 27 });
  rig(sim, 'CCCCU');
  roundOut(sim, 'p1');
  roundOut(sim, 'p2');                                    // 2 civilians vs 1: not yet
  assert.equal(phase(sim), 'speak');
  roundOut(sim, 'p3', { proceed: false });                // 1 v 1
  assert.equal(sim.state.elim.next, 'over');
  sim.act('p4', { type: 'continue' });
  const r = sim.result();
  assert.deepEqual(r.winners, ['p5']);
  assert.match(r.lines[0], /剩低 1 個平民、1 個臥底方，臥底方人數追上平民/);
  assert.match(r.summary, /^臥底方贏/);
});

test('undercover: last3 — infiltrators win as soon as 3 are left, parity is not enough', () => {
  const sim = mk(5, { seed: 28, cfg: { win: 'last3' } });
  rig(sim, 'CCCCU');
  roundOut(sim, 'p1');                                    // 4 left
  assert.equal(phase(sim), 'speak');
  roundOut(sim, 'p2', { proceed: false });                // 3 left, undercover still in
  assert.equal(sim.state.elim.next, 'over');
  sim.act('p3', { type: 'continue' });
  assert.match(sim.result().lines[0], /淨係剩 3 個人/);
  assert.deepEqual(sim.result().winners, ['p5']);

  // 6 players, 2 undercovers: parity would already be decided at 2 v 2, last3 plays on
  const par = mk(6, { seed: 28, cfg: { undercovers: 2, win: 'parity' } });
  rig(par, 'CCCCUU');
  roundOut(par, 'p1');
  roundOut(par, 'p2', { proceed: false });
  assert.equal(par.state.elim.next, 'over', 'parity: 2 v 2');
  const l3 = mk(6, { seed: 28, cfg: { undercovers: 2, win: 'last3' } });
  rig(l3, 'CCCCUU');
  roundOut(l3, 'p1');
  roundOut(l3, 'p2');
  assert.equal(phase(l3), 'speak', 'last3: 2 v 2 is still 4 players');
  roundOut(l3, 'p3', { proceed: false });
  assert.equal(l3.state.elim.next, 'over');
});

test('undercover: a game with only a white card (no undercover) works', () => {
  const sim = mk(6, { seed: 29, cfg: { undercovers: 0, blanks: 1 } });
  rig(sim, 'CCCCCB');
  assert.equal(sim.state.counts0.undercovers, 0);
  roundOut(sim, 'p6', { proceed: false });
  sim.act('p6', { type: 'guess', word: '蘋果' });
  sim.act('p1', { type: 'continue' });
  const r = sim.result();
  assert.deepEqual(r.winners, ['p6']);
  assert.equal(r.points.p6, 10, 'a lone white card is paid like an undercover');
  assert.match(r.lines.join('\n'), /今局冇臥底/);
  assert.doesNotMatch(r.summary, /臥底詞/);
});

// ============================================================
// result
// ============================================================

test('undercover: the result explains both words, who held what and what happened', () => {
  const sim = mk(7, { seed: 30, cfg: { undercovers: 1, blanks: 1 } });
  rig(sim, 'CCCCCUB', { civ: '壽司', und: '刺身' });
  sim.state.pair.cat = '日本旅行';
  roundOut(sim, 'p1');
  roundOut(sim, 'p7', { proceed: false });
  sim.act('p7', { type: 'guess', word: '壽司' });
  sim.act('p2', { type: 'continue' });
  assert.equal(phase(sim), 'over');
  const r = sim.result();
  const text = r.lines.join('\n');
  assert.match(r.summary, /臥底方贏！平民詞「壽司」，臥底詞「刺身」/);
  assert.ok(text.includes('平民詞語「壽司」，臥底詞語「刺身」（日本旅行）'));
  assert.ok(text.includes('平民：玩家1、玩家2、玩家3、玩家4、玩家5'));
  assert.ok(text.includes('臥底：玩家6'));
  assert.ok(text.includes('白板：玩家7'));
  assert.ok(text.includes('第 1 輪：玩家1 出局（平民）'));
  assert.ok(text.includes('第 2 輪：玩家7 出局（白板）；白板猜「壽司」，猜中'));
  assert.deepEqual(r.winners, ['p6', 'p7']);
  const o = view(sim, 'p3').over;
  assert.equal(o.civ, '壽司');
  assert.equal(o.und, '刺身');
  assert.equal(o.rows.length, 7);
  assert.equal(o.rows.find((x) => x.id === 'p7').role, 'blank');
  assert.equal(o.rows.find((x) => x.id === 'p7').word, null);
  assert.equal(o.rows.find((x) => x.id === 'p6').word, '刺身');
});

test('undercover: points — civilians 2 each, undercovers share the table, a white card gets 3', () => {
  const civWin = mk(6, { seed: 31 });
  rig(civWin, 'CCCCCU');
  roundOut(civWin, 'p6', { proceed: false });
  civWin.act('p1', { type: 'continue' });
  assert.deepEqual(civWin.result().points, { p1: 2, p2: 2, p3: 2, p4: 2, p5: 2 });

  const infWin = mk(8, { seed: 31, cfg: { undercovers: 2 } });
  rig(infWin, 'CCCCCCUU');
  for (const p of ['p1', 'p2', 'p3']) roundOut(infWin, p);
  assert.equal(phase(infWin), 'speak');
  roundOut(infWin, 'p4', { proceed: false });
  infWin.act('p5', { type: 'continue' });
  assert.equal(phase(infWin), 'over', '2 v 2');
  assert.deepEqual(infWin.result().points, { p7: 6, p8: 6 }, 'round(2 * 6 / 2)');

  const mixed = mk(7, { seed: 31, cfg: { undercovers: 1, blanks: 1 } });
  rig(mixed, 'CCCCCUB');
  roundOut(mixed, 'p7', { proceed: false });
  mixed.act('p7', { type: 'guess', word: '蘋果' });
  mixed.act('p1', { type: 'continue' });
  assert.deepEqual(mixed.result().points, { p6: 10, p7: 3 });
});

test('undercover: result is null until the game is over', () => {
  const sim = mk(6, { seed: 32 });
  rig(sim, 'CCCCCU');
  assert.equal(sim.result(), null);
  ready(sim);
  assert.equal(sim.result(), null);
  toVote(sim);
  voteOut(sim, 'p6');
  assert.equal(sim.result(), null);
  assert.equal(view(sim, 'p1').over, undefined);
});

// ============================================================
// cues, focus, host actions
// ============================================================

test('undercover: every phase has a cue, ids are unique per step and never come back', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = mk(6 + (seed % 3), { seed, cfg: { blanks: seed % 2 } });
    const seen = [];
    const record = () => {
      const c = sim.cue();
      assert.ok(c && c.id && c.text && c.minMs >= 0, `no cue in ${sim.state.phase}`);
      if (seen[seen.length - 1] !== c.id) {
        assert.equal(seen.includes(c.id), false, `cue id ${c.id} came back`);
        seen.push(c.id);
      }
    };
    record();
    sim.runRandom({ onStep: record });
    record();
    assert.ok(seen.length >= 5);
    assert.equal(sim.cue().id, 'over');
  }
});

test('undercover: cues never say a word, or a role of someone still in the game', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const sim = mk(7, { seed, cfg: { blanks: seed % 2 } });
    const { civ, und } = sim.state.pair;
    sim.runRandom({
      onStep: (s) => {
        const st = s.state;
        if (st.phase === 'over' || (st.phase === 'elim' && st.elim.guess && !st.elim.guess.pending)) return;
        const text = s.cue().text;
        assert.equal(text.includes(civ) || text.includes(und), false, text);
        if (st.phase !== 'elim') assert.doesNotMatch(text, /平民個|臥底個|白板個|佢係/);
      },
    });
  }
});

test('undercover: @next first finishes the narration line, only a second press skips the step', () => {
  const sim = mk(5, { seed: 33 });
  rig(sim, 'CCCCU');
  ready(sim);
  const id0 = sim.cue().id;
  assert.ok(sim.host({ type: ACT.NEXT }), 'first press: line read');
  assert.equal(sim.state.turn, 0);
  assert.equal(sim.state.cueDone, id0);
  assert.ok(sim.host({ type: ACT.NEXT }), 'second press: skips p1');
  assert.equal(sim.state.turn, 1);
  assert.notEqual(sim.cue().id, id0);
  assert.equal(sim.host({ type: ACT.CUE_DONE, id: 'old' }), false, 'a stale cue-done is ignored');
  assert.ok(sim.host({ type: ACT.CUE_DONE, id: sim.cue().id }));
  assert.ok(sim.host({ type: ACT.NEXT }));
  assert.equal(sim.state.turn, 2);
  // a seat cannot send host actions
  unchanged(sim, 'p1', { type: ACT.NEXT });
  unchanged(sim, 'p1', { type: ACT.CUE_DONE, id: sim.cue().id });
});

test('undercover: the host can push every step through with @next', () => {
  const sim = mk(5, { seed: 34, cfg: { abstain: true } });
  rig(sim, 'CCCCU');
  const next = () => { sim.host({ type: ACT.CUE_DONE, id: sim.cue().id }); return sim.host({ type: ACT.NEXT }); };
  assert.ok(next());                                       // deal → force start
  assert.equal(phase(sim), 'speak');
  for (let i = 0; i < 5; i++) next();                      // five turns skipped
  assert.equal(phase(sim), 'discuss');
  assert.ok(next());
  assert.equal(phase(sim), 'vote');
  sim.act('p1', { type: 'vote', target: 'p5' });
  assert.ok(next());                                       // vote resolved with the missing ballots abstaining
  assert.equal(phase(sim), 'elim');
  assert.equal(sim.state.elim.out, 'p5');
  assert.ok(next());                                       // continue
  assert.equal(phase(sim), 'over');
  assert.equal(next(), false);
});

test('undercover: focus names exactly the seats that must look at their phone', () => {
  const sim = mk(5, { seed: 35 });
  rig(sim, 'CCCCU');
  assert.deepEqual(sim.focus(), { pids: ['p1', 'p2', 'p3', 'p4', 'p5'] });
  ready(sim);
  assert.equal(sim.focus(), null, 'speaking is public');
  speakAll(sim);
  assert.equal(sim.focus(), null, 'discussion is public');
  sim.act('p1', { type: 'start-vote' });
  assert.deepEqual(sim.focus(), { pids: ['p1', 'p2', 'p3', 'p4', 'p5'] });
  sim.act('p2', { type: 'vote', target: 'p5' });
  assert.deepEqual(sim.focus().pids, ['p1', 'p3', 'p4', 'p5']);
  assert.equal(sim.focus().anonymous, undefined, 'no eyes-closed prompts in this game');
});

test('undercover: autoAct gives a stalled seat a sensible move in every phase', () => {
  const rng = mulberry32(5);
  const sim = mk(5, { seed: 36 });
  rig(sim, 'CCCCU');
  const auto = (pid) => E.autoAct(clone(sim.state), pid, { rng, now: sim.now, bag: null });
  assert.deepEqual(auto('p2'), { type: 'ready' });
  sim.act('p2', { type: 'ready' });
  assert.equal(auto('p2'), null);
  for (const p of ['p1', 'p3', 'p4', 'p5']) sim.host({ type: ACT.AUTO, pid: p });
  assert.equal(phase(sim), 'speak');
  assert.equal(auto('p3'), null, 'only the speaker is stalling the table');
  assert.equal(auto('p1').type, 'done');
  sim.host({ type: ACT.AUTO, pid: 'p1' });
  assert.equal(sim.state.turn, 1);
  while (phase(sim) === 'speak') sim.host({ type: ACT.AUTO, pid: sim.state.order[sim.state.turn] });
  assert.equal(phase(sim), 'discuss');
  assert.equal(auto('p4').type, 'start-vote');
  sim.host({ type: ACT.AUTO, pid: 'p4' });
  assert.equal(phase(sim), 'vote');
  const v = auto('p4');
  assert.equal(v.type, 'vote');
  assert.ok(sim.state.candidates.includes(v.target) && v.target !== 'p4');
  for (const p of sim.state.voters.slice()) sim.host({ type: ACT.AUTO, pid: p });
  assert.equal(phase(sim), 'elim', 'auto-acting every voter completes the vote');
  assert.equal(auto('p1').type, 'continue');
  assert.equal(auto('ghost'), null);

  const abst = mk(5, { seed: 36, cfg: { abstain: true } });
  rig(abst, 'CCCCU');
  toVote(abst);
  assert.deepEqual(E.autoAct(clone(abst.state), 'p2', { rng }), { type: 'vote', target: null }, 'abstain when allowed');

  const guess = blankOut();
  assert.deepEqual(E.autoAct(clone(guess.state), 'p6', { rng }), { type: 'guess', word: '' });
  assert.equal(E.autoAct(clone(guess.state), 'p1', { rng }), null);
  guess.host({ type: ACT.AUTO, pid: 'p6' });
  assert.equal(guess.state.elim.guess.pending, false);
  assert.equal(guess.state.elim.guess.correct, false);
});

// ============================================================
// views never leak
// ============================================================

const ME_KEYS = ['id', 'alive', 'word', 'ready', 'blank', 'canVote', 'targets', 'myVote', 'mustGuess'];
const ROLE_WORDS = ['civilian', 'undercover', 'blank'];

function stripMe(v) { const c = clone(v); delete c.me; return c; }

/** Throws if any seat's view carries more than its own secret. */
function checkViews(sim) {
  const s = sim.state;
  const table = sim.view(null);
  assert.equal(table.me, null, 'the table view has no seat');
  const tableJson = JSON.stringify(stripMe(table));
  const over = s.phase === 'over';
  const guessShown = s.phase === 'elim' && s.elim.guess && !s.elim.guess.pending;
  if (!over) {
    if (!guessShown) {
      assert.equal(tableJson.includes(s.pair.civ) || tableJson.includes(s.pair.und), false, `a word is public in ${s.phase}`);
    }
    // role names may only appear where an eliminated player is announced
    const walk = (o, path) => {
      if (typeof o === 'string' && ROLE_WORDS.includes(o)) {
        assert.ok(/^\$\.(outs\.\d+\.role|history\.\d+\.role|elim\.role)$/.test(path), `role leaked at ${path}`);
      } else if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
      }
    };
    walk(stripMe(table), '$');
    for (const o of table.outs) {
      const out = s.outs.find((x) => x.pid === o.pid);
      assert.equal(s.alive.includes(o.pid), false);
      assert.equal(o.role, s.cfg.revealRole || (out.role === 'blank' && s.cfg.blankGuess) ? out.role : null);
    }
  }
  for (const p of sim.players) {
    const v = sim.view(p.id);
    assert.deepEqual(stripMe(v), stripMe(table), `${p.id}: the public part must be identical for every seat`);
    assert.equal(v.me.id, p.id);
    assert.equal(v.me.word, s.words[p.id] ?? null, 'own word only');
    assert.equal(!!v.me.blank, s.roles[p.id] === 'blank');
    for (const k of Object.keys(v.me)) assert.ok(ME_KEYS.includes(k), `unexpected me.${k}`);
    if (v.me.myVote !== undefined) assert.equal(s.phase, 'vote');
    if (v.me.mustGuess) assert.equal(s.elim.out, p.id);
    // the view is detached from the state
    const before = JSON.stringify(s);
    const copy = sim.view(p.id);
    const mutate = (o) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (Array.isArray(o[k])) o[k].push('x'); mutate(o[k]); } };
    mutate(copy);
    assert.equal(JSON.stringify(s), before, 'a view aliases engine state');
  }
}

test('undercover: no view carries anything but its own seat\'s private facts, at every step', () => {
  for (const [n, blanks, seed] of [[5, 0, 1], [6, 1, 2], [8, 0, 3], [8, 1, 4], [10, 2, 5], [12, 1, 6]]) {
    const cfg = { blanks, revealRole: seed % 2 === 0 };
    if (!C.validate({ ...C.defaults(n), ...cfg }, n).ok) continue;
    for (let s = 0; s < 4; s++) {
      const sim = mk(n, { seed: seed * 100 + s, cfg });
      checkViews(sim);
      sim.runRandom({ onStep: checkViews });
      checkViews(sim);
    }
  }
});

test('undercover: your own word shows up only in your own view', () => {
  const sim = mk(6, { seed: 40, cfg: { blanks: 1, undercovers: 1 } });
  rig(sim, 'CCCCUB', { civ: '烏冬', und: '拉麵' });
  const json = (p) => JSON.stringify(sim.view(p));
  assert.ok(json('p1').includes('烏冬') && !json('p1').includes('拉麵'));
  assert.ok(json('p5').includes('拉麵') && !json('p5').includes('烏冬'));
  assert.ok(!json('p6').includes('烏冬') && !json('p6').includes('拉麵'), 'the white card holds nothing');
  assert.equal(sim.view('p6').me.word, null);
  assert.equal(sim.view('p6').me.blank, true);
  assert.equal(sim.view('p5').me.blank, undefined);
  assert.ok(!JSON.stringify(sim.view(null)).includes('烏冬') && !JSON.stringify(sim.view(null)).includes('拉麵'));
  assert.deepEqual(sim.view('ghost').me, null, 'an unknown seat gets the table view');
  roundOut(sim, 'p1');
  assert.ok(!JSON.stringify(sim.view('p6')).includes('烏冬'), 'still hidden after the first round');
});

// ============================================================
// fuzz
// ============================================================

const VARIANTS = [
  {},
  { blanks: 1 },
  { tie: 'pk-random', abstain: true },
  { tie: 'skip', revealRole: false },
  { win: 'last3' },
  { speakSec: 20, discussSec: 60, voteSec: 30 },
  { blanks: 1, blankGuess: false, revealRole: false, blankNeverFirst: false },
  { blanks: 1, win: 'last3', abstain: true, tie: 'pk-random' },
  { undercovers: 1, blanks: 1, voteSec: 15, speakSec: 10 },
];

function fuzzConfig(n, seed) {
  const patch = VARIANTS[seed % VARIANTS.length];
  const cfg = { ...C.defaults(n), ...patch };
  return C.validate(cfg, n).ok ? cfg : C.defaults(n);
}

test('undercover: random legal play ends for every head-count (9 counts x 120 seeds)', () => {
  const stats = { civilians: 0, infiltrators: 0, guess: 0, forced: 0, pk: 0, none: 0, rounds: 0, games: 0 };
  for (const n of N_RANGE) {
    for (let seed = 1; seed <= 120; seed++) {
      const config = fuzzConfig(n, seed);
      const sim = new Sim(game, { n, seed: n * 1000 + seed, config, banks });
      const { result } = sim.runRandom({ maxSteps: 40000 });
      stats.games++;
      stats.rounds += sim.state.round;
      assert.equal(sim.state.phase, 'over');
      const side = sim.state.win.side;
      stats[side === 'civilians' ? 'civilians' : 'infiltrators']++;
      if (sim.state.win.why === 'guess') stats.guess++;
      for (const h of sim.state.history) {
        if (h.forced) stats.forced++;
        if (h.outcome === 'pk') stats.pk++;
        if (h.outcome === 'none') stats.none++;
      }
      // invariants of a finished game
      assert.ok(result.winners.length >= 1);
      const roles = result.winners.map((w) => sim.state.roles[w]);
      if (side === 'civilians') assert.ok(roles.every((r) => r === 'civilian'));
      else assert.ok(roles.every((r) => r !== 'civilian'));
      const total = Object.values(result.points).reduce((a, b) => a + b, 0);
      assert.ok(total > 0);
      assert.deepEqual(Object.keys(result.points).sort(), result.winners.slice().sort());
      assert.equal(sim.state.outs.length + sim.state.alive.length, n);
      assert.equal(new Set(sim.state.outs.map((o) => o.pid)).size, sim.state.outs.length);
      assert.equal(sim.focus(), null);
      assert.equal(sim.state.deadline, null);
      assert.ok(sim.cue().id === 'over');
      // the win condition really holds at the end
      const alive = sim.state.alive.map((p) => sim.state.roles[p]);
      const c = alive.filter((r) => r === 'civilian').length;
      const i = alive.length - c;
      if (side === 'civilians') assert.equal(i, 0);
      else if (sim.state.win.why !== 'guess') assert.equal(K.infiltratorsWin(c, i, config.win), true, `n=${n} seed=${seed} c=${c} i=${i}`);
      else assert.ok(sim.state.history.some((h) => h.guess?.correct));
    }
  }
  assert.equal(stats.games, 9 * 120);
  assert.ok(stats.civilians > 100 && stats.infiltrators > 100, JSON.stringify(stats));
  assert.ok(stats.guess > 5 && stats.pk > 20 && stats.none > 20, `the fuzzer should reach the rare branches: ${JSON.stringify(stats)}`);
});

test('undercover: every action the engine lists is accepted, and nothing else is needed to finish', () => {
  for (const n of [4, 7, 12]) {
    for (let seed = 1; seed <= 9; seed++) {
      const sim = new Sim(game, { n, seed, config: fuzzConfig(n, seed), banks });
      sim.runRandom({
        maxSteps: 40000,
        onStep: (s) => {
          for (const p of s.players) {
            for (const a of s.legal(p.id)) {
              const next = E.act(clone(s.state), { pid: p.id, action: a }, s.ctx());
              assert.notEqual(JSON.stringify(next), JSON.stringify(s.state), `${JSON.stringify(a)} by ${p.id} in ${s.state.phase} is listed but does nothing`);
            }
          }
        },
      });
    }
  }
});

test('undercover: garbage thrown at every phase never throws and never changes the state', () => {
  const junk = (s) => [
    undefined, null, 0, 'x', [], {}, { type: null }, { type: {} }, { type: 'vote', target: s.seats[0] === 'p1' ? 'p99' : 'p1', extra: 1 },
    { type: 'vote', target: [] }, { type: 'guess', word: {} }, { type: 'done', at: 'nope' }, { type: '__proto__' }, { type: 'constructor' },
    { type: ACT.AUTO }, { type: ACT.NEXT },
  ];
  const sim = mk(6, { seed: 41, cfg: { blanks: 1, undercovers: 1 } });
  const probe = () => {
    const s = clone(sim.state);
    for (const a of junk(s)) {
      for (const pid of ['ghost', 'p1', 'p6', 5, null, undefined, '__proto__']) {
        const before = JSON.stringify(s);
        let out;
        assert.doesNotThrow(() => { out = E.act(clone(s), { pid, action: a }, { rng: mulberry32(1), now: 5, bag: null }); });
        const after = JSON.stringify(out ?? s);
        if (typeof a === 'object' && a && a.type === ACT.NEXT) continue;      // host-only types from a seat are ignored (checked below)
        assert.equal(after, before, `${JSON.stringify(a)} by ${String(pid)} in ${s.phase}`);
      }
    }
    for (const pid of ['p1', 'ghost', null]) {
      assert.doesNotThrow(() => { E.view(s, pid); E.legalActions(s, pid); E.autoAct(clone(s), pid, { rng: mulberry32(1) }); });
    }
    assert.doesNotThrow(() => { E.cue(s); E.focus(s); E.result(s); });
  };
  probe();
  sim.runRandom({ onStep: probe });
  probe();
});

test('undercover: the same seed plays out the same way', () => {
  for (const n of [5, 9]) {
    const a = new Sim(game, { n, seed: 77, config: fuzzConfig(n, 77), banks });
    const b = new Sim(game, { n, seed: 77, config: fuzzConfig(n, 77), banks });
    a.runRandom();
    b.runRandom();
    assert.deepEqual(a.state, b.state);
    assert.deepEqual(a.result(), b.result());
  }
});

test('undercover: engine state is plain JSON the session can snapshot and clone', () => {
  const sim = mk(7, { seed: 42, cfg: { blanks: 1 } });
  sim.runRandom({
    onStep: (s) => {
      assert.deepEqual(JSON.parse(JSON.stringify(s.state)), s.state, 'state must survive a JSON round trip');
    },
  });
});

test('undercover: act returns the state it was given (the session clones before calling)', () => {
  const sim = mk(5, { seed: 43 });
  const s = clone(sim.state);
  const out = E.act(s, { pid: 'p1', action: { type: 'ready' } }, sim.ctx());
  assert.equal(out, s);
  assert.equal(E.act(s, { pid: 'p1', action: { type: 'nope' } }, sim.ctx()), s);
});
