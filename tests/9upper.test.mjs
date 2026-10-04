// ============================================================
// tests/9upper.test.mjs — rules, edge cases, leak checks and a fuzzer for 瞎掰王 9upper.
//   node tests/run.mjs 9upper
// Tests named "rule: …" pin a rule from docs/research/9upper.md (verified rulebook reading).
// ============================================================

import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { test, assert, Sim, HOST, ACT, makePlayers, paths } from './lib.mjs';
import { createBag } from '../js/core/bag.js';
import { mulberry32, clone } from '../js/core/engine-kit.js';
import * as game from '../js/games/9upper/game.js';
import * as S from '../js/games/9upper/script.js';

const { engine, config, meta, rules, CATEGORIES, PRESETS } = game;

// ---------- fixtures ----------

const CATS = ['地理', '科學', '歷史', '生活'];
// every explanation / source carries a unique, delimiter-wrapped token so substring leak checks are exact
const BANK = Array.from({ length: 60 }, (_, i) => ({
  term: `詞語${i}號`, explain: `真解釋【E${i}】`, cat: CATS[i % 4], level: 1 + (i % 3), src: `來源【S${i}】`,
}));
const banks = { '9upper': BANK };
const PRESET_KEYS = ['levelMode', 'laps', 'callouts'];

/** A Sim with config.defaults(n) + `over`. Overriding a preset-controlled key switches to the 'custom' preset. */
function mk(n, seed = 1, over = {}, b = banks) {
  const cfg = { ...config.defaults(n), ...over };
  if (!('preset' in over) && PRESET_KEYS.some((k) => k in over)) cfg.preset = 'custom';
  return new Sim(game, { n, seed, banks: b, config: cfg });
}

const J = (sim) => sim.state.round.judge;
const phase = (sim) => sim.state.phase;
const nameOf = (sim, pid) => sim.players.find((p) => p.id === pid).name;

/** Play the read phase out (together: the clock; pass: every reader peeks, then the clock). */
function finishRead(sim) {
  if (sim.state.cfg.passPhone) {
    let guard = 0;
    while (phase(sim) === 'read' && guard++ < 20) {
      assert.equal(sim.act(sim.state.round.reader, { type: 'peek' }), true);
      sim.advance();
    }
  } else sim.advance();
}
function toRead(sim, level = 2) {
  if (phase(sim) === 'level') sim.act(J(sim), { type: 'level', level });
  if (phase(sim) === 'term') sim.act(J(sim), { type: 'start' });
  assert.equal(phase(sim), 'read');
}
function toExplain(sim, level = 2) {
  toRead(sim, level);
  finishRead(sim);
  assert.equal(phase(sim), 'explain');
}
function toJudge(sim, level = 2) {
  toExplain(sim, level);
  sim.act(J(sim), { type: 'decide' });
  assert.equal(phase(sim), 'judge');
}
const bluffers = (sim) => sim.state.round.explainers.filter((p) => p !== sim.state.round.honest);

// ---------- meta, rules text (U1) ----------

test('9upper: meta, rules and banks shape', () => {
  assert.equal(meta.id, '9upper');
  assert.deepEqual(meta.players, [3, 9]);
  assert.deepEqual(meta.banks, ['9upper']);
  assert.equal(meta.singleDevice, 'full');
  assert.equal(meta.css, true);
  assert.deepEqual(rules.roles.map((r) => r.id), ['judge', 'honest', 'bluffer']);
  for (const s of rules.sections) assert.ok(s.title && s.body);
  for (const k of ['setup', 'act', 'advance', 'view', 'cue', 'focus', 'autoAct', 'legalActions', 'result']) {
    assert.equal(typeof engine[k], 'function', k);
  }
});

test('9upper: U1 — rules.quick is at most 6 short lines; every role says what you do and how you score', () => {
  assert.ok(rules.quick.length >= 4 && rules.quick.length <= 6, `${rules.quick.length} quick lines`);
  for (const l of rules.quick) assert.ok(l.length <= 32 && !l.includes('\n'), `quick line too long: ${l}`);
  for (const r of rules.roles) {
    assert.ok(r.name && r.emoji && r.team && r.text, r.id);
    assert.ok(r.text.includes('得分：'), `${r.id} does not say how it scores`);
    assert.ok(r.text.split('得分：')[0].length >= 10, `${r.id} does not say what it does`);
    assert.ok(r.text.length <= 110, `${r.id} text is long (${r.text.length})`);
  }
  // the rule the engine cannot enforce is at least written down for the 諗樣
  assert.ok(rules.roles[0].text.includes('唔可以問人係咩身份'));
});

// ---------- config (#8 presets) ----------

test('9upper: D5 — 快玩 (each seat is 諗樣 once) is the default for every head-count; 官方玩法 follows the rulebook table', () => {
  const rounds = { 3: 9, 4: 12, 5: 10, 6: 12, 7: 14, 8: 8, 9: 9 };
  for (let n = 3; n <= 9; n++) {
    const cfg = config.defaults(n);
    assert.equal(cfg.preset, 'quick', `n=${n}`);
    const v = config.validate(cfg, n);
    assert.ok(v.ok, `n=${n}: ${v.message}`);
    assert.deepEqual(v.warnings, [], `n=${n}: the recommended setup warns ${v.warnings}`);
    const sim = mk(n);
    assert.equal(sim.state.totalRounds, n, `n=${n}: 快玩 = one lap`);
    assert.equal(sim.state.cfg.laps, 1);
    assert.ok(config.summary(cfg, n)[1].startsWith(`快玩：共 ${n} 輪`), config.summary(cfg, n)[1]);
    assert.ok(config.fields(cfg, n).length >= 6);
    // 官方玩法 is the next option of the same select
    const off = mk(n, 1, { preset: 'official' });
    assert.equal(off.state.totalRounds, rounds[n], `n=${n}`);
    assert.equal(off.state.cfg.laps, game.lapsFor(n));
    assert.ok(config.summary({ ...cfg, preset: 'official' }, n)[1].includes(`共 ${rounds[n]} 輪`));
  }
});

test('9upper: D5 — a setup saved before 快玩 became the default moves over once; a later 官方玩法 pick is kept', () => {
  const old = { preset: 'official', readSecs: 12, speakOrder: 'system' };   // saved by an older build (no mark)
  const d = config.defaults(5, old);
  assert.equal(d.preset, 'quick');
  assert.equal(d.readSecs, 12, 'the rest of the old setup is kept');
  assert.equal(d.speakOrder, 'system');
  assert.ok(d.presetRev, 'the setup carries the mark from now on');
  const picked = config.defaults(5, { ...d, preset: 'official' });   // the host chose 官方玩法 since
  assert.equal(picked.preset, 'official');
  assert.equal(config.defaults(5, { preset: 'newbie' }).preset, 'newbie', 'other old presets stay');
  assert.equal(config.defaults(5, { preset: 'custom', laps: 2 }).preset, 'custom');
  assert.ok(config.validate(d, 5).ok);
  const sim = new Sim(game, { n: 5, seed: 1, banks, config: d });
  assert.ok(!('presetRev' in sim.state.cfg), 'the mark is lobby bookkeeping only');
});

test('9upper: #8 — the lobby summary opens with the head-count line and a reason players can read', () => {
  for (let n = 3; n <= 9; n++) {
    const line = config.summary(config.defaults(n), n)[0];
    assert.ok(line.startsWith(`${n} 人：1 諗樣 + 1 老實人 + ${n - 2} 個 9upper — `), line);
    assert.ok(line.split(' — ')[1].length >= 4, `no reason in ${line}`);
  }
});

test('9upper: #8 — presets fix level mode, laps and 收皮啦; custom shows those fields', () => {
  for (const [id, p] of Object.entries(PRESETS)) {
    for (const n of [3, 5, 9]) {
      const cfg = { ...config.defaults(n), preset: id, levelMode: 'judge', laps: 3, callouts: 2 };   // stale raw values
      assert.ok(config.validate(cfg, n).ok);
      const sim = new Sim(game, { n, seed: 3, banks, config: cfg });
      assert.equal(sim.state.cfg.levelMode, p.levelMode, `${id} n=${n}`);
      assert.equal(sim.state.cfg.callouts, p.callouts);
      assert.equal(sim.state.cfg.laps, p.laps || game.lapsFor(n));
      const keys = config.fields(cfg, n).map((f) => f.key);
      for (const k of PRESET_KEYS) assert.ok(!keys.includes(k), `${id} shows ${k}`);
      const help = config.fields(cfg, n).find((f) => f.key === 'preset').help;
      assert.ok(help.includes(`${sim.state.totalRounds} 輪`), `${id} help does not say how long: ${help}`);
    }
  }
  const custom = { ...config.defaults(5), preset: 'custom', levelMode: 'judge', laps: 3, callouts: 2 };
  const keys = config.fields(custom, 5).map((f) => f.key);
  for (const k of PRESET_KEYS) assert.ok(keys.includes(k), `custom hides ${k}`);
  const sim = new Sim(game, { n: 5, seed: 3, banks, config: custom });
  assert.equal(sim.state.cfg.levelMode, 'judge');
  assert.equal(sim.state.totalRounds, 15);
  assert.equal(phase(sim), 'level');
  // newbie: only ⭐ terms (the rulebook's advice for a first game), 1 lap
  const nb = mk(6, 2, { preset: 'newbie' });
  assert.equal(nb.state.totalRounds, 6);
  assert.equal(nb.state.round.term.level, 1);
  // the preset select offers every preset, each with a label
  const sel = config.fields(config.defaults(5), 5).find((f) => f.key === 'preset');
  assert.deepEqual(sel.options.map((o) => o.value), ['quick', 'official', 'newbie', 'custom'], '快玩 first, 官方玩法 next');
  for (const o of sel.options) assert.ok(o.label);
});

test('9upper: config.defaults keeps prev, sanitises it and honours singleDevice', () => {
  const d = config.defaults(5, { preset: 'custom', levelMode: '3', readSecs: 25, callouts: 2, laps: 'bogus',
    topics: { cats: ['地理'] }, junk: 1 });
  assert.equal(d.preset, 'custom');
  assert.equal(d.levelMode, '3');
  assert.equal(d.readSecs, 25);
  assert.equal(d.callouts, 2);
  assert.equal(d.laps, 0);          // invalid → default
  assert.deepEqual(d.topics, { cats: ['地理'] });
  assert.ok(!('junk' in d));
  const fresh = config.defaults(5);
  assert.equal(fresh.preset, 'quick');
  assert.deepEqual(fresh.topics, { cats: [] });
  assert.equal(fresh.passPhone, false);
  assert.equal(fresh.antiStreak, false);
  assert.equal(fresh.speakOrder, 'judge', 'the rulebook: the 諗樣 decides the order');
  assert.equal(config.defaults(5, { speakOrder: 'system' }).speakOrder, 'system');
  assert.equal(config.defaults(5, { speakOrder: 'free' }, { singleDevice: true }).speakOrder, 'free', 'one phone does not change it');
  assert.equal(config.defaults(5, { speakOrder: 'random' }).speakOrder, 'judge', 'unknown value → default');
  assert.deepEqual(config.defaults(5, { topics: ['地理'] }).topics, { cats: ['地理'] });          // bare array tolerated
  assert.deepEqual(config.defaults(5, { topics: { categories: ['地理'] } }).topics, { cats: ['地理'] });
  assert.equal(config.defaults(5, {}, { singleDevice: true }).passPhone, true);
  assert.equal(config.defaults(5, { readSecs: 0 }).readSecs, 9);                                // old tap-mode value
});

test('9upper: config.validate rejects bad player counts and bad values, warns on odd ones', () => {
  const base = config.defaults(5);
  for (const n of [0, 1, 2, 10, 12, 4.5]) assert.equal(config.validate(base, n).ok, false, `n=${n}`);
  for (const bad of [{ laps: 4 }, { laps: -1 }, { readSecs: 4 }, { readSecs: 31 }, { readSecs: 0 }, { readSecs: 9.5 },
    { speakSecs: 301 }, { callouts: 3 }, { levelMode: '4' }, { preset: 'pro' }, { scoreFloor: 'yes' }, { passPhone: 1 },
    { antiStreak: 'on' }, { speakOrder: 'random' }, { speakOrder: 1 }, { speakOrder: '' }, { topics: 'x' }, { topics: { cats: [1] } }, { topics: [1] }]) {
    const v = config.validate({ ...base, ...bad }, 5);
    assert.equal(v.ok, false, JSON.stringify(bad));
    assert.ok(v.message.length > 0);
  }
  assert.ok(config.validate({ ...base, readSecs: 5 }, 5).warnings.length >= 1);
  assert.ok(config.validate({ ...base, preset: 'custom', laps: 3 }, 8).warnings.length >= 1);        // 24 rounds
  assert.ok(config.validate({ ...base, preset: 'custom', callouts: 2 }, 3).warnings.length >= 1);
  assert.ok(config.validate({ ...base, antiStreak: true }, 4).warnings.length >= 1);
  assert.deepEqual(config.validate({ ...base, antiStreak: true }, 6).warnings, []);
  for (const speakOrder of ['judge', 'system', 'free']) {
    assert.deepEqual(config.validate({ ...base, speakOrder }, 5).warnings, [], speakOrder);
    const v1 = config.validate({ ...base, passPhone: true, speakOrder, speakSecs: 0 }, 5, { singleDevice: true });
    assert.ok(v1.ok, speakOrder);
    assert.deepEqual(v1.warnings, [], speakOrder);
  }
  assert.deepEqual(config.validate({ ...base, speakOrder: 'system', speakSecs: 45 }, 5).warnings, [], 'a clock works with 系統派');
  const freeClock = config.validate({ ...base, speakOrder: 'free', speakSecs: 45 }, 5);
  assert.ok(freeClock.ok && freeClock.warnings.length === 1 && freeClock.warnings[0].includes('自己決定'), 'no clock in 自己決定');
  // numeric strings from a <select> / input are accepted
  assert.ok(config.validate({ ...base, readSecs: '20', callouts: '2' }, 5).ok);
  assert.equal(config.defaults(5, { readSecs: '20' }).readSecs, 20);
});

test('9upper: config.summary reflects the settings', () => {
  const s = config.summary({ ...config.defaults(6), preset: 'custom', levelMode: 'judge', passPhone: true, speakSecs: 45,
    callouts: 0, topics: { cats: ['地理', '科學'] }, scoreFloor: true, rePeek: true, antiStreak: true }, 6).join('|');
  for (const t of ['6 人', '自訂', '共 12 輪', '諗樣自己揀', '一部手機輪流睇，每人 9 秒', '45 秒', '唔玩收皮啦', '地理、科學',
    '低過 0', '再睇', '唔連續']) {
    assert.ok(s.includes(t), t);
  }
  assert.ok(config.summary(config.defaults(5), 5).join('|').includes('睇卡 9 秒'));
  const order = (speakOrder) => config.summary({ ...config.defaults(5), speakOrder }, 5).filter((l) => l.startsWith('發言次序'));
  assert.deepEqual(order('judge'), ['發言次序：諗樣揀']);
  assert.deepEqual(order('system'), ['發言次序：系統隨機派']);
  assert.deepEqual(order('free'), ['發言次序：自己決定']);
});

// ---------- setup and rotation ----------

test('9upper: every seat is the 諗樣 `laps` times and the 諗樣 rotates to the left', () => {
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

test('9upper: rule: round 1 諗樣 is random (the 諗樣 card is dealt with the others)', () => {
  const firsts = new Set();
  for (let seed = 1; seed <= 40; seed++) firsts.add(J(mk(5, seed)));
  assert.equal(firsts.size, 5, `only ${firsts.size} distinct first judges`);
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

test('9upper: rule: everybody starts on 3 points', () => {
  const sim = mk(6, 3);
  for (const p of sim.players) assert.equal(sim.state.scores[p.id], 3);
});

test('9upper: #20 — the first speaker is random over every 玩家 (老實人 included); order then goes round the table', () => {
  const firstBySeat = {};
  let honestFirst = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const sim = mk(5, seed);
    const r = sim.state.round;
    const order = sim.state.order;
    const ring = [1, 2, 3, 4].map((k) => order[(order.indexOf(r.judge) + k) % 5]);
    assert.deepEqual(r.explainers.slice().sort(), ring.slice().sort());
    const k = ring.indexOf(r.explainers[0]);
    assert.deepEqual(r.explainers, [...ring.slice(k), ...ring.slice(0, k)], 'round the table from the first speaker');
    (firstBySeat[r.judge] ||= new Set()).add(k);
    if (r.explainers[0] === r.honest) honestFirst++;
  }
  for (const [j, ks] of Object.entries(firstBySeat)) assert.equal(ks.size, 4, `judge ${j}: first speaker not spread`);
  assert.ok(honestFirst > 40 && honestFirst < 110, `老實人 spoke first ${honestFirst}/300 times`);
});

test('9upper: #20 — anti-streak (off by default) keeps last round\'s 老實人 out when ≥3 candidates remain', () => {
  const streaks = (n, antiStreak) => {
    let repeat = 0;
    let chances = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const sim = mk(n, seed, { antiStreak, levelMode: '2' });
      let prev = null;
      while (phase(sim) !== 'over') {
        const r = sim.state.round;
        if (prev && r.explainers.includes(prev)) { chances++; if (r.honest === prev) repeat++; }
        toJudge(sim);
        sim.act(J(sim), { type: 'pick', target: sim.state.round.explainers[0] });
        prev = sim.state.round.honest;
        sim.act(J(sim), { type: 'next' });
      }
    }
    return { repeat, chances };
  };
  assert.ok(streaks(6, false).repeat > 0, 'without the option a 老實人 can repeat');
  const on = streaks(6, true);
  assert.ok(on.chances > 50);
  assert.equal(on.repeat, 0, 'anti-streak let a 老實人 repeat');
  assert.ok(streaks(4, true).repeat > 0, 'at 4 players it must not apply (it would nearly name the 老實人)');
});

// ---------- the happy path ----------

test('9upper: one round end to end (official setup)', () => {
  const sim = mk(4, 2);
  const judge = J(sim);
  assert.equal(phase(sim), 'term');
  assert.ok(sim.state.round.term);
  assert.equal(sim.state.deadline, null);
  sim.act(judge, { type: 'start' });
  assert.equal(phase(sim), 'read');
  assert.equal(sim.state.deadline, sim.now + 9000);
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
  assert.equal(phase(sim), 'term');
});

test('9upper: rule: level selection defaults to a random mix (rulebook: shuffled pile, top card)', () => {
  const levels = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const sim = mk(5, seed);
    assert.equal(sim.state.cfg.levelMode, 'mix');
    assert.equal(phase(sim), 'term', 'no level phase in the official setup');
    levels.add(sim.state.round.term.level);
  }
  assert.equal(levels.size, 3);
  const fixed = mk(5, 1, { levelMode: '2' });
  assert.equal(phase(fixed), 'term');
  assert.equal(fixed.state.round.term.level, 2);
  const chosen = mk(5, 1, { levelMode: 'judge' });
  assert.equal(phase(chosen), 'level');
  assert.equal(chosen.state.round.term, null);
  chosen.act(J(chosen), { type: 'level', level: 3 });
  assert.equal(phase(chosen), 'term');
  assert.equal(chosen.state.round.term.level, 3);
});

// ---------- act validation ----------

test('9upper: garbage, wrong phase, wrong seat and illegal targets never change state or throw', () => {
  const sim = mk(5, 7, { levelMode: 'judge' });
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
    { pid: judge, action: { type: 'start' } }, { pid: judge, action: { type: 'swap' } },
    { pid: other, action: { type: 'peek' } }, { pid: judge, action: { type: 'call', target: other } },
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
  const term = snap();
  for (const m of [{ pid: judge, action: { type: 'level', level: 1 } }, { pid: other, action: { type: 'start' } },
    { pid: other, action: { type: 'swap' } }, { pid: other, action: { type: 'peek' } }, { pid: other, action: { type: 'done' } },
    { pid: judge, action: { type: 'callout', target: other } }, { pid: other, action: { type: 'callout', target: judge } }]) {
    assert.equal(JSON.stringify(engine.act(clone(sim.state), m, sim.ctx())), term, JSON.stringify(m));
  }
});

test('9upper: the engine accepts a numeric-string level', () => {
  const sim = mk(4, 1, { levelMode: 'judge' });
  sim.act(J(sim), { type: 'level', level: '3' });
  assert.equal(phase(sim), 'term');
  assert.equal(sim.state.round.term.level, 3);
});

// ---------- terms ----------

test('9upper: judge-chosen level draws that level; cats filter applies', () => {
  for (const level of [1, 2, 3]) {
    const sim = mk(4, level, { levelMode: 'judge', topics: { cats: ['地理'] } });
    sim.act(J(sim), { type: 'level', level });
    const t = sim.state.round.term;
    assert.equal(t.level, level);
    assert.equal(t.cat, '地理');
  }
});

test('9upper: empty pools relax level, then category, then fall back to an emergency card', () => {
  const only1 = { '9upper': BANK.filter((e) => e.level === 1) };
  const s1 = mk(4, 1, { levelMode: 'judge' }, only1);
  s1.act(J(s1), { type: 'level', level: 3 });
  assert.equal(s1.state.round.term.level, 1);                      // level relaxed

  const geo = { '9upper': BANK.filter((e) => e.cat === '地理') };
  const s2 = mk(4, 1, { levelMode: 'judge', topics: { cats: ['科學'] } }, geo);
  s2.act(J(s2), { type: 'level', level: 2 });
  assert.equal(s2.state.round.term.cat, '地理');                   // category relaxed

  const s3 = mk(4, 1, {}, { '9upper': [] });
  assert.equal(phase(s3), 'term');
  assert.ok(s3.state.round.term.term && s3.state.round.term.explain);   // emergency card

  const s4 = mk(4, 1, {}, {});                                     // bank never loaded
  assert.equal(phase(s4), 'term');
  assert.ok(s4.state.round.term.explain);

  const broken = { '9upper': [{ term: 'x' }, { explain: 'y' }, null, { term: '', explain: '' }] };
  const s5 = mk(4, 1, {}, broken);
  assert.ok(s5.state.round.term.explain.length > 2);               // unusable entries are never dealt
});

test('9upper: rule: hints — level 1 one true category, level 2 three with exactly one true, level 3 none', () => {
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
  // the newbie preset draws ⭐ terms only: there must be enough of them for a few evenings
  assert.ok(bank.filter((e) => e.level === 1).length >= 20, 'too few ⭐ terms for the 新手 preset');
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
  const sim = mk(5, 7);
  sim.bag = bag;
  const seen = [];
  sim.runRandom({ onStep: (x) => { const t = x.state.round.term; if (t && seen[seen.length - 1] !== t.term) seen.push(t.term); } });
  assert.ok(seen.length >= 9);
  assert.equal(new Set(seen).size, seen.length, 'a term repeated');
  assert.ok(bag.stats('9upper').used >= seen.length - 1);
  // a bank that was never loaded makes core/bag.js throw: the round still gets an emergency card
  const unloaded = createBag({ storage: new Map(), banks: { '9upper': { load: async () => BANK, key: (e) => e.term } } });
  const s2 = mk(4, 2, { levelMode: 'judge' });
  s2.bag = unloaded;
  s2.act(J(s2), { type: 'level', level: 2 });
  assert.equal(phase(s2), 'term');
  assert.ok(s2.state.round.term.explain);
  const throwing = { draw() { throw new Error('boom'); }, stats() { return { used: 0, total: 0 }; } };
  const s3 = mk(4, 2);
  s3.bag = throwing;
  s3.runRandom();
});

test('9upper: a game never repeats a term while the bank has enough', () => {
  const sim = mk(5, 4);
  const seen = [];
  sim.runRandom({ onStep: (x) => { const t = x.state.round.term; if (t && seen[seen.length - 1] !== t.term) seen.push(t.term); } });
  assert.equal(new Set(seen).size, seen.length, `repeated: ${seen.join(',')}`);
});

// ---------- term + swap ----------

test('9upper: rule: the term is public before the 9-second step and is redrawn only then (roles kept, no score)', () => {
  const sim = mk(5, 8, { levelMode: '2' });
  assert.equal(phase(sim), 'term');
  assert.equal(sim.state.deadline, null, 'no clock while people read the term');
  for (const p of sim.players) {
    const v = sim.view(p.id);
    assert.equal(v.term.text, sim.state.round.term.term);
    assert.equal(v.mine, null, 'nobody holds a card yet');
    assert.ok(!JSON.stringify(v).includes(sim.state.round.term.explain));
  }
  const honest = sim.state.round.honest;
  const explainers = sim.state.round.explainers.slice();
  const first = sim.state.round.term.term;
  const scores = { ...sim.state.scores };
  assert.equal(sim.act(sim.state.round.explainers[0], { type: 'swap' }), false, 'only the 諗樣 swaps');
  const cue1 = sim.cue().id;
  assert.equal(sim.act(J(sim), { type: 'swap' }), true);
  assert.notEqual(sim.state.round.term.term, first);
  assert.equal(sim.state.round.term.level, 2, 'same difficulty');
  assert.equal(sim.state.round.honest, honest);
  assert.deepEqual(sim.state.round.explainers, explainers);
  assert.equal(phase(sim), 'term');
  assert.notEqual(sim.cue().id, cue1, 'the narrator reads the new term');
  assert.ok(sim.cue().text.includes(sim.state.round.term.term));
  assert.equal(sim.view(J(sim)).swapsLeft, 2);
  sim.act(J(sim), { type: 'swap' });
  sim.act(J(sim), { type: 'swap' });
  assert.equal(sim.view(J(sim)).canSwap, false);
  assert.equal(sim.act(J(sim), { type: 'swap' }), false, 'swap limit');
  assert.ok(!sim.legal(J(sim)).some((a) => a.type === 'swap'));
  assert.deepEqual(sim.state.scores, scores);
  assert.equal(sim.act(J(sim), { type: 'start' }), true);
  assert.equal(sim.view(honest).mine.explain, sim.state.round.term.explain, 'honest reads the NEW explanation');
  assert.equal(sim.act(J(sim), { type: 'swap' }), false, 'no swap once the peek has started');
});

// ---------- read phase ----------

test('9upper: rule: the peek lasts 9 seconds, for everybody at once, and never ends early', () => {
  const sim = mk(5, 3);
  sim.act(J(sim), { type: 'start' });
  const s = sim.state;
  assert.equal(s.deadline, 1_000_000 + 9000);
  for (const p of sim.players) assert.deepEqual(sim.legal(p.id), [], `${p.id} could end the window early`);
  assert.deepEqual(sim.focus().pids, s.round.explainers);
  assert.equal(JSON.stringify(engine.advance(clone(s), { ...sim.ctx(), now: s.deadline - 1 })), JSON.stringify(s));
  sim.advance();
  assert.equal(phase(sim), 'explain');

  const skip = mk(5, 3);
  skip.act(J(skip), { type: 'start' });
  assert.equal(skip.host({ type: ACT.NEXT }), true);                 // first 下一步 only acknowledges the cue
  assert.equal(phase(skip), 'read');
  assert.equal(skip.cue(), null);
  assert.equal(skip.host({ type: ACT.NEXT }), true);                 // second one skips the wait
  assert.equal(phase(skip), 'explain');
});

test('9upper: rule: one phone passed round — every reader gets the same fixed window, no early finish', () => {
  const sim = mk(5, 3, { passPhone: true });
  sim.act(J(sim), { type: 'start' });
  const r = sim.state.round;
  const order = sim.state.order;
  const left = [1, 2, 3, 4].map((k) => order[(order.indexOf(r.judge) + k) % 5]);
  assert.deepEqual(r.readers, left, 'the phone goes left from the 諗樣');
  const windows = [];
  for (const reader of left) {
    assert.equal(sim.state.round.reader, reader);
    assert.deepEqual(sim.focus().pids, [reader]);
    assert.equal(sim.state.deadline, null, 'the window waits for the reader to take the phone');
    for (const p of sim.players) {
      const legal = sim.legal(p.id);
      assert.deepEqual(legal, p.id === reader ? [{ type: 'peek' }] : [], `${p.id}`);
    }
    assert.equal(sim.view(reader).mine, null, 'no card before your turn');
    assert.equal(sim.act(reader, { type: 'peek' }), true);
    assert.equal(sim.act(reader, { type: 'peek' }), false);
    windows.push(sim.state.deadline - sim.now);
    assert.deepEqual(sim.legal(reader), [], 'no 我睇完 button: the clock ends every window');
    assert.equal(sim.view(reader).mine.honest, reader === r.honest);
    assert.equal('explain' in sim.view(reader).mine, reader === r.honest);
    sim.tick(4000);
    assert.equal(sim.act(reader, { type: 'done' }), false);
    sim.advance();
    if (reader === r.honest && phase(sim) === 'read') {
      assert.equal('explain' in sim.view(reader).mine, false, 'the text is gone after your window');
    }
  }
  assert.deepEqual(windows, [9000, 9000, 9000, 9000]);
  assert.equal(phase(sim), 'explain');
  // @next never skips a reader: it starts the window, then ends it
  const nx = mk(4, 5, { passPhone: true });
  nx.act(J(nx), { type: 'start' });
  nx.host({ type: ACT.NEXT });                                   // ack the cue
  const first = nx.state.round.reader;
  nx.host({ type: ACT.NEXT });
  assert.equal(nx.state.round.readStarted, true);
  assert.equal(nx.state.round.reader, first);
  nx.host({ type: ACT.NEXT });
  assert.notEqual(nx.state.round.reader, first);
});

// ---------- explain phase ----------

test('9upper: speakers follow the queue; done by the speaker or the 諗樣 only', () => {
  const sim = mk(5, 6);
  toExplain(sim);
  const ex = sim.state.round.explainers;
  assert.deepEqual(sim.view(null).turn, { pid: ex[0], spoken: [], total: 4, skipped: [], no: 0, next: ex[1] });
  assert.equal(sim.act(ex[1], { type: 'done' }), false);              // not your turn
  assert.equal(sim.act(ex[0], { type: 'done' }), true);
  assert.equal(sim.view(null).turn.pid, ex[1]);
  assert.equal(sim.act(J(sim), { type: 'done' }), true);              // the judge may end any turn — that is a skip
  assert.equal(sim.view(null).turn.pid, ex[2]);
  assert.deepEqual(sim.view(null).turn.skipped, [ex[1]]);
  assert.ok(sim.legal(ex[2]).some((a) => a.type === 'done'));
  assert.deepEqual(sim.legal(ex[3]), []);
  sim.act(ex[2], { type: 'done' });
  assert.equal(sim.view(null).turn.next, ex[1], 'after the last one waiting, the skipped player is next');
  sim.act(ex[3], { type: 'done' });
  assert.equal(phase(sim), 'explain', 'the skipped player gets the floor back once nobody else is waiting');
  assert.equal(sim.view(null).turn.pid, ex[1]);
  assert.deepEqual(sim.view(null).turn.skipped, []);
  sim.act(ex[1], { type: 'done' });
  assert.equal(phase(sim), 'judge');
  assert.equal(sim.view(null).turn, null);
});

test('9upper: a skipped speaker shows as skipped, comes back once, and the 諗樣 can call them back', () => {
  // 諗樣揀: the 諗樣's 下一位 skips; the skipped one stays callable
  const sim = mk(5, 6);
  toExplain(sim);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  assert.ok(sim.act(judge, { type: 'done', turn: 0 }));
  assert.deepEqual(sim.view(null).turn.skipped, [ex[0]]);
  assert.deepEqual(sim.view(null).turn.spoken, [ex[0]]);
  assert.ok(sim.legal(judge).some((a) => a.type === 'call' && a.target === ex[0]), 'a skipped player is callable');
  assert.ok(sim.act(judge, { type: 'call', target: ex[0] }));
  assert.equal(sim.view(null).turn.pid, ex[0]);
  assert.deepEqual(sim.view(null).turn.skipped, []);
  assert.deepEqual(sim.view(null).turn.spoken, [], 'called back: a full turn again');
  assert.ok(sim.act(ex[0], { type: 'done' }));
  assert.deepEqual(sim.view(null).turn.spoken, [ex[0]]);
  assert.equal(sim.act(judge, { type: 'call', target: ex[0] }), false, 'spoken for real: not callable');
  // a second skip after the one come-back is final (no endless loop), but the 諗樣 may still call them
  const sys = mk(4, 3, { speakOrder: 'system' });
  toExplain(sys);
  const sx = sys.state.round.explainers;
  sys.act(J(sys), { type: 'done' });                       // skip sx[0]
  sys.act(sx[1], { type: 'done' });
  sys.act(sx[2], { type: 'done' });
  assert.equal(sys.view(null).turn.pid, sx[0], 'back once');
  sys.act(J(sys), { type: 'done' });                       // skipped again
  assert.equal(phase(sys), 'judge', 'only once');
  // a speaking clock that runs out is not a skip; the host's 下一步 is
  const clock = mk(4, 3, { speakOrder: 'system', speakSecs: 30 });
  toExplain(clock);
  const cx = clock.state.round.explainers;
  clock.advance();
  assert.deepEqual(clock.view(null).turn.skipped, [], 'time up: they had the floor');
  clock.cueDone();
  clock.host({ type: ACT.NEXT });
  assert.deepEqual(clock.view(null).turn.skipped, [cx[1]], 'the host moved past a stuck speaker');
  // the turn number keeps counting through a come-back, so a stale double tap never ends the wrong turn
  const dbl = mk(4, 3, { speakOrder: 'system' });
  toExplain(dbl);
  const dx = dbl.state.round.explainers;
  dbl.act(J(dbl), { type: 'done', turn: 0 });              // skip dx[0]
  dbl.act(dx[1], { type: 'done', turn: 1 });
  dbl.act(dx[2], { type: 'done', turn: 2 });
  assert.equal(dbl.view(null).turn.pid, dx[0]);
  assert.equal(dbl.view(null).turn.no, 3);
  assert.equal(dbl.act(J(dbl), { type: 'done', turn: 2 }), false, 'a stale 下一位 from the turn before');
  assert.equal(dbl.view(null).turn.pid, dx[0]);
});

test('9upper: rule: the 諗樣 chooses who speaks and in what order', () => {
  const sim = mk(5, 6);
  toExplain(sim);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.act(ex[1], { type: 'call', target: ex[2] }), false, 'only the 諗樣 calls');
  assert.equal(sim.act(judge, { type: 'call', target: ex[0] }), false, 'already speaking');
  assert.equal(sim.act(judge, { type: 'call', target: judge }), false);
  assert.equal(sim.act(judge, { type: 'call', target: ex[3] }), true);
  assert.equal(sim.view(null).turn.pid, ex[3]);
  assert.deepEqual(sim.view(null).turn.spoken, [], 'the interrupted speaker goes back to waiting');
  assert.equal(sim.act(ex[0], { type: 'done' }), false, 'no longer their turn');
  sim.act(ex[3], { type: 'done' });
  assert.equal(sim.view(null).turn.pid, ex[0], 'then the first waiting one in queue order');
  assert.equal(sim.act(judge, { type: 'call', target: ex[3] }), false, 'cannot call somebody who has spoken');
  assert.ok(sim.legal(judge).filter((a) => a.type === 'call').map((a) => a.target).every((t) => [ex[1], ex[2]].includes(t)));
  sim.act(judge, { type: 'call', target: ex[2] });
  sim.act(ex[2], { type: 'done' });
  sim.act(ex[0], { type: 'done' });
  sim.act(ex[1], { type: 'done' });
  assert.equal(phase(sim), 'judge');
  assert.equal(sim.act(judge, { type: 'call', target: ex[1] }), false, 'no calling in the judge phase');
});

test('9upper: speakSecs puts a deadline on every turn (also after a call) and advance() ends the turn', () => {
  const sim = mk(4, 2, { speakSecs: 30 });
  toExplain(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.state.deadline, sim.now + 30000);
  assert.ok(sim.state.timerLabel.includes(nameOf(sim, ex[0])));
  assert.equal(sim.view(ex[0]).deadline, sim.state.deadline);
  sim.tick(10000);
  sim.act(J(sim), { type: 'call', target: ex[2] });
  assert.equal(sim.state.deadline, sim.now + 30000, 'a called speaker gets a full turn');
  assert.ok(sim.state.timerLabel.includes(nameOf(sim, ex[2])));
  sim.advance();
  assert.equal(sim.view(null).turn.pid, ex[0]);
  sim.advance();
  sim.advance();
  assert.equal(phase(sim), 'judge');
  assert.equal(sim.state.deadline, null);
  assert.equal(sim.view(null).deadline, undefined);
});

test('9upper: rule: the 諗樣 may accuse at any moment after the peek; no clock without speakSecs', () => {
  const sim = mk(4, 2);
  toExplain(sim);
  assert.equal(sim.state.deadline, null);
  assert.equal(sim.act(sim.state.round.explainers[0], { type: 'decide' }), false);
  assert.equal(sim.act(J(sim), { type: 'decide' }), true);
  assert.equal(phase(sim), 'judge');
});

// ---------- who decides the speaking order: 諗樣揀 / 系統派 / 自己決定 ----------

/** The 玩家 in seat order from the 諗樣's left. */
const ringOf = (sim) => {
  const order = sim.state.order;
  const j = order.indexOf(J(sim));
  return [...order.slice(j + 1), ...order.slice(0, j)];
};
const isRotation = (queue, ring) => ring.some((_, k) => queue.every((p, i) => p === ring[(i + k) % ring.length]));

test('9upper: 發言次序 field — always visible, three options, one help line that follows the mode, not part of any preset', () => {
  for (const preset of ['official', 'newbie', 'quick', 'custom']) {
    for (const speakOrder of ['judge', 'system', 'free']) {
      const cfg = { ...config.defaults(5), preset, speakOrder };
      const f = config.fields(cfg, 5).find((x) => x.key === 'speakOrder');
      assert.ok(f, `${preset} hides the field`);
      assert.equal(f.type, 'select');
      assert.deepEqual(f.options.map((o) => o.value), ['judge', 'system', 'free']);
      for (const o of f.options) assert.ok(o.label);
      assert.ok(f.label && f.help && !f.help.includes('\n') && f.help.length <= 40, `help: ${f.help}`);
    }
  }
  const help = (speakOrder) => config.fields({ ...config.defaults(5), speakOrder }, 5).find((x) => x.key === 'speakOrder').help;
  assert.equal(new Set(['judge', 'system', 'free'].map(help)).size, 3, 'the help follows the chosen mode');
  assert.ok(help('system').includes('隨機'));
  assert.ok(help('judge').includes('諗樣'));
  const keys = config.fields(config.defaults(5), 5).map((x) => x.key);
  assert.ok(keys.indexOf('speakOrder') > keys.indexOf('preset') && keys.indexOf('speakOrder') < keys.indexOf('readSecs'));
  // the time-limit field says it does not apply to 自己決定
  const clock = (speakOrder) => config.fields({ ...config.defaults(5), speakOrder }, 5).find((x) => x.key === 'speakSecs').help;
  assert.ok(clock('free').includes('自己決定') && !clock('system').includes('自己決定'));
  // presets leave it alone, the engine honours it under every preset
  for (const id of Object.keys(PRESETS)) {
    for (const speakOrder of ['judge', 'system', 'free']) {
      assert.equal(mk(5, 3, { preset: id, speakOrder }).state.cfg.speakOrder, speakOrder, `${id}/${speakOrder}`);
    }
  }
  // the env argument of defaults / validate changes nothing about it
  const one = config.defaults(5, undefined, { singleDevice: true });
  assert.ok(config.validate({ ...one, speakOrder: 'system' }, 5, { singleDevice: true }).ok);
  // one phone (passPhone): the help says the 諗樣 ticks the speakers off — nobody else can reach 我講完 (#11)
  const passHelp = (speakOrder) => config.fields({ ...one, speakOrder }, 5).find((x) => x.key === 'speakOrder').help;
  assert.ok(passHelp('system').includes('諗樣㩒') && !passHelp('system').includes('我講完'), passHelp('system'));
  assert.ok(passHelp('free').includes('諗樣㩒') && !passHelp('free').includes('我講完'), passHelp('free'));
  for (const m of ['judge', 'system', 'free']) assert.ok(passHelp(m).length <= 40, passHelp(m));
});

test('9upper: 系統派 — a fresh random order every round that says nothing about who the 老實人 is', () => {
  const N = 5;
  const SEEDS = 500;
  const honestAt = Array(N - 1).fill(0);
  const firstAt = Array(N - 1).fill(0);
  let rotations = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const sim = mk(N, seed, { speakOrder: 'system' });
    const r = sim.state.round;
    const ring = ringOf(sim);
    assert.deepEqual(r.explainers.slice().sort(), ring.slice().sort(), 'every 玩家, the 諗樣 never');
    honestAt[r.explainers.indexOf(r.honest)]++;
    firstAt[ring.indexOf(r.explainers[0])]++;
    if (isRotation(r.explainers, ring)) rotations++;
  }
  // 125 expected per cell (sd about 10): a real bias would be far outside this
  for (const c of [...honestAt, ...firstAt]) assert.ok(c > 80 && c < 170, `uneven: honest ${honestAt} / first ${firstAt}`);
  // the suggested 諗樣揀 queue is always a rotation; the random one is a rotation only 4 times in 24
  assert.ok(rotations > 40 && rotations < 140, `${rotations}/${SEEDS} rotations`);
  for (let seed = 1; seed <= 40; seed++) {
    const sim = mk(N, seed, { speakOrder: 'judge' });
    assert.ok(isRotation(sim.state.round.explainers, ringOf(sim)), 'judge mode keeps the round-the-table suggestion');
  }
});

test('9upper: 系統派 — queue position and seat position of the 老實人 are independent (no tell, n = 4 and n = 3)', () => {
  const joint = {};
  for (let seed = 1; seed <= 900; seed++) {
    const sim = mk(4, seed, { speakOrder: 'system' });
    const r = sim.state.round;
    const key = `${ringOf(sim).indexOf(r.honest)}:${r.explainers.indexOf(r.honest)}`;
    joint[key] = (joint[key] ?? 0) + 1;
  }
  assert.equal(Object.keys(joint).length, 9, 'every (seat, position) pair happens');
  for (const [k, c] of Object.entries(joint)) assert.ok(c > 55 && c < 150, `cell ${k}: ${c} of 900 (expected 100)`);
  let honestFirst = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const sim = mk(3, seed, { speakOrder: 'system' });
    if (sim.state.round.explainers[0] === sim.state.round.honest) honestFirst++;
  }
  assert.ok(honestFirst > 170 && honestFirst < 230, `老實人 first ${honestFirst}/400 at 3 players`);
});

test('9upper: 系統派 — a new order is drawn in every round of a game', () => {
  const sim = mk(6, 11, { speakOrder: 'system', levelMode: '2', laps: 2 });
  const queues = new Set();
  while (phase(sim) !== 'over') {
    queues.add(JSON.stringify(sim.state.round.explainers.map((p) => ringOf(sim).indexOf(p))));
    toJudge(sim);
    sim.act(J(sim), { type: 'pick', target: sim.state.round.explainers[0] });
    sim.act(J(sim), { type: 'next' });
  }
  assert.ok(queues.size >= 6, `only ${queues.size} different orders in 12 rounds`);
});

test('9upper: 系統派 — the phone deals the speakers, nobody can call out of turn, the speaker or the 諗樣 ends a turn', () => {
  const sim = mk(5, 6, { speakOrder: 'system', callouts: 2 });
  toExplain(sim);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.view(null).speakOrder, 'system');
  assert.deepEqual(sim.view(null).turn, { pid: ex[0], spoken: [], total: 4, skipped: [], no: 0, next: ex[1] });
  assert.equal(sim.act(judge, { type: 'call', target: ex[2] }), false, 'no calling out of turn');
  assert.ok(!sim.legal(judge).some((a) => a.type === 'call'));
  assert.equal(sim.act(ex[1], { type: 'done' }), false, 'not your turn');
  assert.equal(sim.act(ex[0], { type: 'done', turn: 0 }), true);
  assert.equal(sim.view(null).turn.pid, ex[1]);
  // the 下一位 tapped at the same moment as 我講完 carries the old turn number and changes nothing
  assert.equal(sim.act(judge, { type: 'done', turn: 0 }), false);
  assert.equal(sim.view(null).turn.pid, ex[1]);
  assert.equal(sim.act(judge, { type: 'done', turn: 1 }), true);
  assert.equal(sim.view(null).turn.pid, ex[2]);
  assert.equal(sim.act(judge, { type: 'done' }), true, 'no turn number: a plain done');
  assert.equal(sim.view(null).turn.pid, ex[3]);
  assert.deepEqual(sim.view(null).turn.skipped, [ex[1], ex[2]], 'the 諗樣 moved past them');
  assert.deepEqual(sim.legal(ex[3]), [{ type: 'done' }]);
  assert.deepEqual(sim.legal(ex[0]), []);
  assert.equal(sim.act(ex[3], { type: 'done' }), true);
  // 系統派 re-queues the skipped ones after everybody else, in the order they were skipped
  assert.equal(sim.view(null).turn.pid, ex[1]);
  assert.equal(sim.view(null).turn.next, ex[2]);
  assert.equal(sim.act(ex[1], { type: 'done' }), true);
  assert.equal(sim.view(null).turn.pid, ex[2]);
  assert.equal(sim.act(ex[2], { type: 'done' }), true);
  assert.equal(phase(sim), 'judge');
  // 收皮啦 and 決定 work as in the other modes
  const again = mk(5, 6, { speakOrder: 'system', callouts: 2 });
  toExplain(again);
  assert.equal(again.act(J(again), { type: 'callout', target: again.state.round.explainers[3] }), true);
  assert.equal(again.act(J(again), { type: 'decide' }), true);
  assert.equal(phase(again), 'judge');
});

test('9upper: 系統派 — speakSecs clocks every dealt turn; @next and autoAct end the turn', () => {
  const sim = mk(4, 2, { speakOrder: 'system', speakSecs: 30 });
  toExplain(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.state.deadline, sim.now + 30000);
  assert.ok(sim.state.timerLabel.includes(nameOf(sim, ex[0])));
  sim.advance();
  assert.equal(sim.view(null).turn.pid, ex[1]);
  assert.ok(sim.state.timerLabel.includes(nameOf(sim, ex[1])));
  // 代佢做 for the speaker is a skip (⏭ 跳過咗), never their own 我講完 (✅ 已講)
  assert.deepEqual(engine.autoAct(sim.state, ex[1], sim.ctx()), { type: 'away', turn: sim.view(null).turn.no });
  assert.equal(engine.autoAct(sim.state, ex[2], sim.ctx()), null);
  assert.deepEqual(engine.autoAct(sim.state, J(sim), sim.ctx()), { type: 'done' });
  sim.host({ type: ACT.NEXT });                          // acknowledges the cue
  sim.host({ type: ACT.NEXT });                          // ends the turn
  assert.equal(sim.view(null).turn.pid, ex[2]);
});

test('9upper: 系統派 cues — the first line names the first speaker, every later turn gets its own short line', () => {
  const sim = mk(5, 6, { speakOrder: 'system' });
  toExplain(sim);
  const ex = sim.state.round.explainers;
  const ids = [];
  const take = () => { const c = sim.cue(); if (c) ids.push(c.id); return c; };
  let c = take();
  assert.equal(c.id, 'r1:explain');
  assert.ok(c.text.includes('隨機') && c.text.includes(nameOf(sim, ex[0])) && c.text.includes(sim.state.round.term.term));
  assert.ok(c.text.includes('唔可以問人係咩身份'));
  assert.ok(!c.text.includes(sim.state.round.term.explain));
  assert.ok(!ex.slice(1).some((p) => c.text.includes(nameOf(sim, p))), 'only the first speaker is named up front');
  assert.equal(sim.cueDone(), true);
  assert.equal(sim.cue(), null);
  sim.act(ex[0], { type: 'done' });
  c = take();
  assert.equal(c.id, 'r1:explain:1');
  assert.equal(c.text, `輪到${nameOf(sim, ex[1])}。`);
  assert.ok(c.minMs > 0);
  sim.act(ex[1], { type: 'done' });
  assert.equal(take().text, `輪到${nameOf(sim, ex[2])}。`);
  sim.act(ex[2], { type: 'done' });
  assert.equal(take().text, `最後一位，輪到${nameOf(sim, ex[3])}。`);
  sim.act(ex[3], { type: 'done' });
  assert.equal(take().id, 'r1:judge');
  assert.equal(new Set(ids).size, ids.length, 'unique per step');
  // 諗樣揀 keeps the single line of before
  const judgeMode = mk(4, 6);
  toExplain(judgeMode);
  const jm = judgeMode.state.round.explainers;
  assert.equal(judgeMode.cue().id, 'r1:explain');
  assert.ok(judgeMode.cue().text.includes('可以叫人'));
  judgeMode.act(jm[0], { type: 'done' });
  assert.equal(judgeMode.cue().id, 'r1:explain', 'no per-turn line in 諗樣揀');
});

test('9upper: 自己決定 — nobody is up; players tick themselves off, the 諗樣 can tick anybody off', () => {
  const sim = mk(5, 6, { speakOrder: 'free', speakSecs: 30 });
  toExplain(sim);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  assert.deepEqual(ex, ringOf(sim), 'listed in seat order from the 諗樣\'s left');
  assert.equal(sim.view(null).speakOrder, 'free');
  assert.deepEqual(sim.view(null).turn, { pid: null, spoken: [], total: 4, skipped: [], no: 0, next: null });
  assert.equal(sim.state.deadline, null, 'no clock without anybody on the floor');
  assert.equal(sim.view(ex[0]).deadline, undefined);
  assert.equal(sim.act(judge, { type: 'call', target: ex[1] }), false, 'no calling in 自己決定');
  assert.equal(sim.act(judge, { type: 'done' }), false, 'the 諗樣 must say whom');
  assert.equal(sim.act(judge, { type: 'done', target: judge }), false);
  assert.equal(sim.act(judge, { type: 'done', target: 'nobody' }), false);
  assert.equal(sim.act(ex[2], { type: 'done' }), true, 'anybody, in any order');
  assert.deepEqual(sim.view(null).turn.spoken, [ex[2]]);
  assert.equal(sim.act(ex[2], { type: 'done' }), false, 'once only');
  assert.equal(sim.act(ex[0], { type: 'done', target: ex[1] }), true);
  assert.deepEqual(sim.view(null).turn.spoken, [ex[2], ex[0]], 'a 玩家 can only tick themselves');
  assert.equal(sim.act(judge, { type: 'done', target: ex[1] }), true, 'the 諗樣 ticks a name');
  assert.equal(phase(sim), 'explain');
  assert.equal(sim.state.deadline, null);
  assert.equal(sim.act(judge, { type: 'done', target: ex[3] }), true);
  assert.equal(phase(sim), 'judge', 'everybody ticked → the pick');
  assert.equal(sim.view(null).turn, null);
  // the 諗樣 may also decide at any time, and play 收皮啦
  const early = mk(5, 6, { speakOrder: 'free', callouts: 2 });
  toExplain(early);
  assert.equal(early.act(J(early), { type: 'callout', target: early.state.round.explainers[1] }), true);
  assert.equal(early.act(early.state.round.explainers[0], { type: 'decide' }), false);
  assert.equal(early.act(J(early), { type: 'decide' }), true);
  assert.equal(phase(early), 'judge');
});

test('9upper: 自己決定 — legalActions, autoAct, @next and the cue', () => {
  const sim = mk(4, 6, { speakOrder: 'free', callouts: 0 });
  toExplain(sim);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  assert.deepEqual(sim.legal(ex[1]), [{ type: 'done' }]);
  assert.deepEqual(sim.legal(judge), [
    { type: 'done', target: ex[0] }, { type: 'done', target: ex[1] }, { type: 'done', target: ex[2] }, { type: 'decide' }]);
  assert.deepEqual(engine.autoAct(sim.state, ex[1], sim.ctx()), { type: 'away' }, '代佢做 skips them, it does not tick them off');
  assert.deepEqual(engine.autoAct(sim.state, judge, sim.ctx()), { type: 'done', target: ex[0] });
  assert.deepEqual(sim.focus(), { pids: [judge], open: true, label: '解釋' });
  const c = sim.cue();
  assert.equal(c.id, 'r1:explain');
  assert.ok(c.text.includes('自己傾') && c.text.includes('我講完') && c.text.includes('唔可以問人係咩身份'));
  assert.ok(!ex.some((p) => c.text.includes(nameOf(sim, p))), 'nobody is named: nobody is first');
  sim.act(ex[0], { type: 'done' });
  assert.deepEqual(engine.autoAct(sim.state, ex[0], sim.ctx()), null, 'already ticked');
  assert.deepEqual(engine.autoAct(sim.state, judge, sim.ctx()), { type: 'done', target: ex[1] });
  assert.equal(sim.cue().id, 'r1:explain', 'one line for the whole step');
  sim.cueDone();
  sim.host({ type: ACT.NEXT });                          // skip: ticks the first one still waiting
  assert.deepEqual(sim.view(null).turn.spoken, [ex[0], ex[1]]);
  assert.deepEqual(sim.view(null).turn.skipped, [ex[1]]);
  sim.host({ type: ACT.NEXT });
  assert.equal(phase(sim), 'explain', 'nobody new is waiting: the skipped one is back on the list');
  assert.deepEqual(sim.view(null).turn.spoken, [ex[0], ex[2]]);
  assert.deepEqual(sim.legal(ex[1]), [{ type: 'done' }], 'and can tick themselves off');
  assert.deepEqual(engine.autoAct(sim.state, ex[1], sim.ctx()), { type: 'away' });
  let presses = 0;
  while (phase(sim) === 'explain' && presses < 5) { sim.host({ type: ACT.NEXT }); presses += 1; }
  assert.equal(phase(sim), 'judge');
  assert.equal(presses, 2, 'each skipped player comes back once, then the pick');
});

test('9upper: 發言次序 hints (≤ 40 chars) and cues stay right in every mode and never leak', () => {
  const seen = {};
  for (const speakOrder of ['judge', 'system', 'free']) {
    for (const callouts of [0, 1]) {
      const sim = mk(5, 7 + callouts, { speakOrder, callouts });
      toExplain(sim);
      const ex = sim.state.round.explainers;
      const H = sim.state.round.honest;
      const check = () => {
        for (const pid of [...sim.players.map((p) => p.id), null]) {
          const v = sim.view(pid);
          assert.ok(v.hint.length >= 8 && v.hint.length <= 40, `${speakOrder} hint ${v.hint.length}: ${v.hint}`);
          if (v.myRole !== 'honest') assert.ok(!v.hint.includes('照張卡'), v.hint);
          assert.ok(!v.hint.includes(sim.state.round.term.explain));
          // only the 老實人 may hold a line about the card: the 諗樣 and the table never name anybody as the 老實人
          if (pid === null || pid === J(sim)) assert.equal(v.hint.includes(nameOf(sim, H)), false, v.hint);
          if (sim.state.phase === 'explain') (seen[`${speakOrder}|${v.myRole ?? 'table'}`] ||= new Set()).add(v.hint);
        }
      };
      check();
      if (speakOrder === 'free') {
        for (const p of [H, ...ex.filter((x) => x !== H)]) { sim.act(p, { type: 'done' }); check(); }
      } else {
        for (let i = 0; i < ex.length - 1; i++) { sim.act(ex[i], { type: 'done' }); check(); }
        sim.act(J(sim), { type: 'decide' });
      }
      check();
    }
  }
  const only = (k) => [...seen[k]];
  assert.ok(only('system|judge').every((h) => h.includes('電話派人')), 'the 諗樣 is told the phone deals');
  assert.ok(only('system|table').every((h) => h.includes('隨機派人')));
  assert.ok(only('free|judge').every((h) => h.includes('自己傾')));
  assert.ok(only('free|honest').some((h) => h.includes('我講完')) && only('free|bluffer').some((h) => h.includes('我講完')));
  assert.ok(only('free|honest').some((h) => h.startsWith('你講完喇')), 'after ticking off, the hint moves on');
  assert.ok(only('system|bluffer').some((h) => h.startsWith('等電話派到你')));
  assert.ok(only('system|bluffer').some((h) => h.startsWith('你講完喇')));
  assert.ok(only('judge|honest').every((h) => !h.includes('電話派') && !h.includes('自己傾')), 'the official hints did not change');
});

test('9upper: leak check at every step of a scripted round — 系統派 and 自己決定', () => {
  for (const speakOrder of ['system', 'free']) {
    for (const over of [{ rePeek: false }, { rePeek: true, passPhone: true }]) {
      const sim = mk(6, 12, { ...over, speakOrder, levelMode: 'judge', callouts: 2 });
      leakCheck(sim);
      sim.act(J(sim), { type: 'level', level: 3 }); leakCheck(sim);
      sim.act(J(sim), { type: 'start' }); leakCheck(sim);
      while (phase(sim) === 'read') {
        if (over.passPhone) { sim.act(sim.state.round.reader, { type: 'peek' }); leakCheck(sim); }
        sim.advance(); leakCheck(sim);
      }
      const ex = sim.state.round.explainers;
      sim.act(ex[0], { type: 'done' }); leakCheck(sim);
      sim.act(J(sim), { type: 'done', ...(speakOrder === 'free' ? { target: ex[3] } : {}) }); leakCheck(sim);
      sim.act(J(sim), { type: 'callout', target: ex[2] }); leakCheck(sim);
      sim.act(J(sim), { type: 'decide' }); leakCheck(sim);
      sim.act(J(sim), { type: 'pick', target: ex[1] }); leakCheck(sim);
      sim.act(J(sim), { type: 'next' }); leakCheck(sim);
    }
  }
});

// ---------- 收皮啦 ----------

test('9upper: rule: 收皮啦 — 諗樣 only, after the peek and before the pick, once per round, never on self', () => {
  const sim = mk(5, 9);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.act(judge, { type: 'callout', target: ex[0] }), false);       // term phase
  sim.act(judge, { type: 'start' });
  assert.equal(sim.act(judge, { type: 'callout', target: ex[0] }), false);       // during the peek
  finishRead(sim);
  assert.equal(sim.act(ex[1], { type: 'callout', target: ex[2] }), false);        // not the judge
  assert.equal(sim.act(judge, { type: 'callout', target: judge }), false);        // never self
  assert.equal(sim.act(judge, { type: 'callout', target: 'zzz' }), false);
  assert.equal(sim.act(judge, { type: 'callout', target: ex[2] }), true);
  assert.deepEqual(sim.view(ex[3]).callouts, { max: 1, left: 0, used: [ex[2]] });
  assert.equal(sim.act(judge, { type: 'callout', target: ex[3] }), false, 'default: one per round');
  assert.ok(!sim.legal(judge).some((a) => a.type === 'callout'));
  sim.act(judge, { type: 'decide' });
  assert.equal(sim.act(judge, { type: 'callout', target: ex[1] }), false);
});

test('9upper: callouts = 2 (house reading) allows two different targets; 0 disables 收皮啦', () => {
  const two = mk(5, 9, { callouts: 2 });
  toExplain(two);
  const ex = two.state.round.explainers;
  assert.equal(two.act(J(two), { type: 'callout', target: ex[2] }), true);
  assert.equal(two.act(J(two), { type: 'callout', target: ex[2] }), false, 'once per target');
  two.act(J(two), { type: 'decide' });
  assert.equal(two.act(J(two), { type: 'callout', target: ex[3] }), true, 'also in the judge phase');
  assert.equal(two.act(J(two), { type: 'callout', target: ex[1] }), false, 'cap of 2');

  const off = mk(5, 2, { callouts: 0 });
  toJudge(off);
  assert.equal(off.act(J(off), { type: 'callout', target: off.state.round.explainers[0] }), false);
  assert.ok(!off.legal(J(off)).some((a) => a.type === 'callout'));
  assert.deepEqual(off.view(null).callouts, { max: 0, left: 0, used: [] });
});

test('9upper: rule: 收皮啦 does not silence anybody (muting is an app-only house rule)', () => {
  const sim = mk(4, 5);
  toExplain(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.act(J(sim), { type: 'callout', target: ex[0] }), true);
  assert.equal(sim.view(null).turn.pid, ex[0], 'the called speaker keeps the floor');
  assert.equal(phase(sim), 'explain');
  assert.ok(sim.legal(ex[0]).some((a) => a.type === 'done'));
});

test('9upper: rule: rules text gives the 收皮啦 break-even and does not call a blind 收皮啦 bad at 6+ players', () => {
  const body = rules.sections.find((x) => x.title === '收皮啦').body;
  assert.ok(body.includes('七成半'), 'break-even (p = 0.75) is stated');
  assert.ok(body.includes('6 人或以上'), 'large tables: a blind 收皮啦 is not a loss');
  assert.ok(!body.includes('唔好亂出'));
  assert.ok(body.includes('繼續講'), 'the called player is not silenced');
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

test('9upper: rule: research golden vectors (N=5, D=2) settle exactly', () => {
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

test('9upper: rule: D follows the term level (1, 2, 3)', () => {
  for (const level of [1, 2, 3]) {
    const sim = mk(4, 3, { levelMode: String(level) });
    toJudge(sim);
    const H = sim.state.round.honest;
    sim.act(J(sim), { type: 'pick', target: H });
    assert.equal(sim.state.scores[H], 3 + level);
    assert.equal(sim.state.scores[J(sim)], 3 + level);
  }
});

test('9upper: rule: only the 諗樣 picks, one 玩家, once; reveal carries the explanation and source', () => {
  const sim = mk(5, 4);
  toExplain(sim);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.act(judge, { type: 'pick', target: ex[0] }), false);           // still explaining
  sim.act(judge, { type: 'decide' });
  assert.equal(sim.act(judge, { type: 'pick', target: judge }), false);
  assert.equal(sim.act(judge, { type: 'pick', target: 'zzz' }), false);
  assert.equal(sim.act(ex[0], { type: 'pick', target: ex[1] }), false);           // nobody else votes
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

test('9upper: rule: main result and 收皮啦 are netted once per player', () => {
  const sim = mk(5, 11, { levelMode: '2' });
  toJudge(sim);
  const X = bluffers(sim)[0];
  sim.act(J(sim), { type: 'callout', target: X });
  sim.act(J(sim), { type: 'pick', target: X });
  assert.equal(sim.state.scores[X], 3 + 2 - 1);
  assert.deepEqual(sim.view(null).reveal.changes.filter((c) => c.pid === X).length, 1);
});

// ---------- end of game (#10) ----------

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

/** Sum "開局 3、做諗樣估中 +4、俾人收皮 −1" back into a number. */
function breakdownTotal(line) {
  const tail = line.split('：').slice(1).join('：');
  let total = Number(/開局 (\d+)/.exec(tail)[1]);
  for (const m of tail.matchAll(/([+−])(\d+)/g)) total += (m[1] === '+' ? 1 : -1) * Number(m[2]);
  return total;
}

test('9upper: #10 — results explain every final score (start + each reason adds up), winners first', () => {
  for (const over of [{ callouts: 2 }, { scoreFloor: true, callouts: 2, levelMode: '3' }]) {
    for (let seed = 1; seed <= 25; seed++) {
      const sim = mk(5, seed, over);
      const { result } = sim.runRandom();
      const lines = result.lines;
      for (const p of sim.players) {
        const line = lines.find((l) => l.replace('🏆 ', '').startsWith(`${p.name} ${sim.state.scores[p.id]} 分`));
        assert.ok(line, `no breakdown line for ${p.name}`);
        assert.equal(breakdownTotal(line), sim.state.scores[p.id], line);
        assert.equal(line.startsWith('🏆'), result.winners.includes(p.id));
      }
      assert.ok(lines[0].startsWith('🏆'), 'a winner comes first');
    }
  }
});

test('9upper: #10 — each round says who was the 老實人, why points moved, and what the 收皮啦 hit', () => {
  const sim = mk(5, 11, { levelMode: '2', callouts: 2 });
  toJudge(sim);
  const judge = J(sim);
  const H = sim.state.round.honest;
  const [X, Y] = bluffers(sim);
  sim.act(judge, { type: 'callout', target: H });
  sim.act(judge, { type: 'callout', target: Y });
  sim.act(judge, { type: 'pick', target: X });
  const rv = sim.view(null).reveal.lines.join('\n');
  assert.ok(rv.includes(`老實人係 ${nameOf(sim, H)}`));
  assert.ok(rv.includes(`${nameOf(sim, X)} 呃到諗樣 +2`));
  assert.ok(rv.includes('佢係老實人') && rv.includes('−3'));
  assert.ok(rv.includes(`${nameOf(sim, Y)} −1`));
  const block = game.engine.result({ ...clone(sim.state), phase: 'over' }).lines.join('\n');
  assert.ok(block.includes(`老實人係 ${nameOf(sim, H)}；${nameOf(sim, judge)} 揀咗 ${nameOf(sim, X)}（9upper）`));
  assert.ok(block.includes('收皮啦 →'));
  assert.ok(block.includes(`真正解釋：${sim.state.round.term.explain}`));
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
  assert.ok(lines.includes('最勁 9up'));
  assert.ok(lines.includes('呃過諗樣'));
});

// ---------- cues, focus, auto-act ----------

test('9upper: cues are public, unique per step, acknowledged ones disappear, @next acknowledges first', () => {
  const sim = mk(4, 6, { levelMode: 'judge' });
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
  assert.equal(c.id, 'r1:term:0');
  assert.ok(c.text.includes(sim.state.round.term.term));
  assert.ok(!c.text.includes(sim.state.round.term.explain));
  sim.act(J(sim), { type: 'start' });
  c = note();
  assert.equal(c.id, 'r1:read');
  assert.ok(c.text.includes('9 秒'));
  sim.advance();
  c = note();
  assert.equal(c.id, 'r1:explain');
  assert.ok(c.text.includes(nameOf(sim, sim.state.round.explainers[0])));
  assert.ok(c.text.includes('唔可以問人係咩身份'));
  sim.act(J(sim), { type: 'decide' });
  assert.equal(note().id, 'r1:judge');
  sim.act(J(sim), { type: 'pick', target: sim.state.round.honest });
  c = note();
  assert.equal(c.id, 'r1:reveal');
  assert.ok(c.text.includes(sim.state.round.term.explain));            // read out loud after the reveal
  assert.equal(new Set(ids).size, ids.length);
  // official setup: the term cue opens the round
  const off = mk(4, 6);
  assert.ok(off.cue().text.startsWith('第 1 輪'));
});

test('9upper: pass-mode cue says the phone goes round', () => {
  const sim = mk(4, 6, { passPhone: true });
  sim.act(J(sim), { type: 'start' });
  assert.ok(sim.cue().text.includes('逐個傳'));
});

test('9upper: focus per phase', () => {
  const sim = mk(5, 2, { levelMode: 'judge' });
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  // the 諗樣's steps are public (the 諗樣 never sees a secret): a shared phone shows the public card (§7.1 #4)
  const pub = (label) => ({ pids: [judge], open: true, label });
  assert.deepEqual(sim.focus(), pub('揀難度'));                        // level
  sim.act(judge, { type: 'level', level: 2 });
  assert.deepEqual(sim.focus(), pub('睇題目'));                        // term
  sim.act(judge, { type: 'start' });
  assert.deepEqual(sim.focus(), { pids: ex });                         // read (together): every 玩家, private
  sim.advance();
  assert.deepEqual(sim.focus(), pub('解釋'));                          // explain
  sim.act(judge, { type: 'decide' });
  assert.deepEqual(sim.focus(), pub('揀老實人'));                      // judge
  sim.act(judge, { type: 'pick', target: ex[0] });
  assert.deepEqual(sim.focus(), pub('揭曉'));                          // reveal (phones of their own)
  assert.equal(sim.focus().anonymous, undefined);
});

// ---------- one phone in the middle (DESIGN §7.1; one-phone playtest #1 #4 #5 #11 #12 #19) ----------

/** A one-phone table: the defaults the Room gives a whole-table phone (passPhone on). */
const mkOne = (n, seed = 1, over = {}) => {
  const cfg = { ...config.defaults(n, undefined, { singleDevice: true }), ...over };
  if (PRESET_KEYS.some((k) => k in over)) cfg.preset = 'custom';
  return new Sim(game, { n, seed, banks, config: cfg });
};

test('9upper: one phone — #12 「一部手機輪流睇」 cannot be off in a one-phone room (validate says why); phones of their own may', () => {
  const one = config.defaults(5, undefined, { singleDevice: true });
  assert.equal(one.passPhone, true);
  assert.ok(config.validate(one, 5, { singleDevice: true }).ok);
  const off = config.validate({ ...one, passPhone: false }, 5, { singleDevice: true });
  assert.equal(off.ok, false, 'only the first 玩家 would ever read');
  assert.ok(off.message.includes('一部手機輪流睇'), off.message);
  assert.equal(config.validate({}, 5, { singleDevice: true }).ok, false, 'a setup without the key is off too');
  assert.ok(config.validate({ ...one, passPhone: false }, 5, { singleDevice: false }).ok, 'phones of their own: off is fine');
  assert.ok(config.validate({ ...one, passPhone: false }, 5).ok, 'no env (older callers): unchanged');
  const f = config.fields(one, 5).find((x) => x.key === 'passPhone');
  assert.ok(f.help.includes('得一部手機就要開'), f.help);
});

test('9upper: one phone — focus: the reader\'s gate says how far round it is; the 諗樣\'s steps are public; the reveal calls nobody', () => {
  const sim = mkOne(5, 3, { speakSecs: 30 });
  const judge = J(sim);
  assert.deepEqual(sim.focus(), { pids: [judge], open: true, label: '睇題目' });
  sim.act(judge, { type: 'start' });
  const readers = sim.state.round.readers;
  readers.forEach((reader, i) => {
    assert.deepEqual(sim.focus(), { pids: [reader], label: `睇卡 ${i + 1}/${readers.length}` }, 'private, one reader at a time');
    sim.act(reader, { type: 'peek' });
    sim.advance();
  });
  assert.equal(phase(sim), 'explain');
  assert.deepEqual(sim.focus(), { pids: [judge], open: true, label: '解釋', hold: true }, 'U10: the speaking clock waits for the 諗樣\'s card');
  sim.act(judge, { type: 'decide' });
  sim.act(judge, { type: 'pick', target: sim.state.round.explainers[0] });
  assert.equal(phase(sim), 'reveal');
  assert.equal(sim.focus(), null, 'the phone goes to the middle: the table reads the reveal together');
  // no speaking clock (or 自己決定): nothing to hold
  const free = mkOne(4, 2, { speakOrder: 'free', speakSecs: 30 });
  toExplain(free);
  assert.equal(free.focus().hold, undefined);
  const noClock = mkOne(4, 2);
  toExplain(noClock);
  assert.equal(noClock.focus().hold, undefined);
});

test('9upper: one phone — #5 the reveal\'s 下一輪 is one tap from the table (seats + table: true); a lone seat cannot speak for the 諗樣', () => {
  const sim = mkOne(4, 5);
  toJudge(sim);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  sim.act(judge, { type: 'pick', target: ex[0] });
  const all = sim.players.map((p) => p.id);
  const other = ex[1];
  assert.equal(sim.act(other, { type: 'next' }), false, 'a 玩家 alone is not the 諗樣');
  assert.equal(sim.act(other, { type: 'next', seats: all }), false, 'seats without table: true is no table tap');
  assert.equal(sim.act(other, { type: 'next', seats: ex, table: true }), false, 'the table tap must include the 諗樣');
  assert.equal(sim.act(other, { type: 'next', seats: all, table: true }), true, 'the whole table tapped once');
  assert.equal(sim.state.round.n, 2);
  assert.notEqual(J(sim), judge);
  // phones of their own: unchanged — only the 諗樣 (or anybody while the 諗樣 is 💤)
  const own = mk(4, 5);
  toJudge(own);
  own.act(J(own), { type: 'pick', target: own.state.round.explainers[0] });
  assert.equal(own.act(own.state.round.explainers[1], { type: 'next' }), false);
  assert.equal(own.act(J(own), { type: 'next' }), true);
});

test('9upper: one phone — #11 the 諗樣\'s 「✅ 講完 · 下一位」 marks ✅ 已講 (no second lap); ⏭ is a separate skip; nobody is 冇反應', () => {
  for (const speakOrder of ['judge', 'system']) {
    const sim = mkOne(5, 4, { speakOrder });
    toExplain(sim);
    const judge = J(sim);
    const r = () => sim.state.round;
    const first = r().speaker;
    assert.equal(engine.blocking(sim.state, first), false, `${speakOrder}: the speaker never holds the phone, so is never 冇反應`);
    assert.equal(engine.blocking(sim.state, judge), false);
    assert.ok(sim.legal(judge).some((a) => a.type === 'done' && !a.skip) && sim.legal(judge).some((a) => a.type === 'done' && a.skip));
    assert.equal(sim.act(judge, { type: 'done', turn: r().turnNo }), true);
    assert.ok(r().spoken.includes(first) && !r().skipped.includes(first), `${speakOrder}: ✅ 已講, not ⏭`);
    const second = r().speaker;
    assert.equal(sim.act(judge, { type: 'done', turn: r().turnNo, skip: true }), true);
    assert.ok(r().skipped.includes(second), '⏭ 佢唔喺度，跳過 is a skip: back once at the end');
    let guard = 0;
    while (phase(sim) === 'explain' && guard++ < 20) sim.act(judge, { type: 'done', turn: r().turnNo });
    assert.equal(phase(sim), 'judge', 'one lap (+ the one skipped player once), then 揀人 — never a second lap of everybody');
    assert.deepEqual(sim.state.round.back, [second], 'only the skipped player came back');
    assert.equal(sim.view(judge).readMode, 'pass');
  }
  // 代佢做 for the 諗樣 never claims the speaker finished — on one phone it never plays the 諗樣's part at all (re-run #2 N1)
  const s2 = mkOne(4, 7);
  toExplain(s2);
  assert.deepEqual(engine.autoAct(s2.state, J(s2), s2.ctx()), { type: 'step-down' });
  // phones of their own: the 諗樣's 下一位 still skips, and the speaker on the floor is still the one waited on
  const own = mk(5, 4);
  toExplain(own);
  const sp = own.state.round.speaker;
  assert.equal(engine.blocking(own.state, sp), true);
  own.act(J(own), { type: 'done' });
  assert.ok(own.state.round.skipped.includes(sp));
  assert.deepEqual(engine.autoAct(own.state, J(own), own.ctx()), { type: 'done' });
});

test('9upper: one phone — #19 the explaining cues never say 「收起電話」; the phone goes back to the 諗樣, who ticks the speakers off', () => {
  for (const speakOrder of ['judge', 'system', 'free']) {
    const one = mkOne(4, 2, { speakOrder });
    toExplain(one);
    const t = one.cue().text;
    assert.ok(!t.includes('收起電話') && t.includes('部手機交返俾') && t.includes(nameOf(one, J(one))), `${speakOrder}: ${t}`);
    assert.ok(!t.includes('我講完'), `${speakOrder}: a 玩家 cannot reach 我講完 on one phone: ${t}`);
    const own = mk(4, 2, { speakOrder });
    toExplain(own);
    assert.ok(own.cue().text.includes('收起電話'), 'phones of their own: unchanged');
  }
  const one = mkOne(4, 2, { speakOrder: 'system' });
  toExplain(one);
  assert.ok(one.view(J(one)).hint.includes('✅ 講完'), one.view(J(one)).hint);
  const rule = rules.sections.find((x) => x.title === '用一部手機玩').body;
  assert.ok(rule.includes('✅ 講完') && rule.includes('⏭ 跳過') && rule.includes('枱中間'), rule);
});

test('9upper: autoAct unsticks every phase, so a dead phone cannot stop the table', () => {
  for (const over of [{}, { passPhone: true }, { levelMode: 'judge', speakSecs: 0 }, { speakOrder: 'system', speakSecs: 15 },
    { speakOrder: 'free', passPhone: true }]) {
    const sim = mk(5, 4, over);
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
    assert.ok(sim.result(), JSON.stringify(over));
  }
  const sim = mk(4, 4);
  assert.deepEqual(engine.autoAct(sim.state, J(sim), sim.ctx()), { type: 'start' });
  assert.equal(engine.autoAct(sim.state, 'nobody', sim.ctx()), null);
});

test('9upper: @next from the host never gets stuck in judge, and skips level/term/read/explain/reveal', () => {
  const sim = mk(4, 3, { levelMode: 'judge' });
  const twice = () => { sim.host({ type: ACT.NEXT }); sim.host({ type: ACT.NEXT }); };
  twice();                                                             // level → auto level → term
  assert.equal(phase(sim), 'term');
  twice();                                                             // term → read
  assert.equal(phase(sim), 'read');
  twice();                                                             // read → explain
  assert.equal(phase(sim), 'explain');
  const spoken = sim.view(null).turn.spoken.length;
  twice();
  assert.equal(sim.view(null).turn.spoken.length, spoken + 1);
  sim.act(J(sim), { type: 'decide' });
  sim.host({ type: ACT.NEXT });
  assert.equal(sim.host({ type: ACT.NEXT }), false);                   // judge phase: nothing to skip
  assert.equal(phase(sim), 'judge');
});

// ---------- D4: 呢輪作廢 (@void-round) and 💤 唔喺度 (@absent / @present) ----------

const VOID = { type: ACT.VOID_ROUND };
const ABSENT = (pid) => ({ type: ACT.ABSENT ?? '@absent', pid });
const PRESENT = (pid) => ({ type: ACT.PRESENT ?? '@present', pid });
/** Every seat's turns as 諗樣 per lap, from the plan. */
const lapCounts = (s) => {
  const out = {};
  s.judges.forEach((pid, i) => { const k = `${s.judgeLaps[i]}|${pid}`; out[k] = (out[k] ?? 0) + 1; });
  return out;
};

test('9upper: D4 — 呢輪作廢 while a 玩家 is stuck: same 諗樣, fresh term, roles and order, no score, fresh cue ids', () => {
  const sim = mk(5, 3, { speakOrder: 'system' });
  toExplain(sim);
  const before = clone(sim.state);
  const judge = J(sim);
  const oldTerm = sim.state.round.term.term;
  assert.deepEqual(engine.canVoid(sim.state), { ok: true });
  assert.equal(sim.host(VOID), true);
  const s = sim.state;
  assert.equal(phase(sim), 'term');
  assert.equal(s.roundNo, 1, 'the same round number');
  assert.equal(J(sim), judge, 'the same 諗樣');
  assert.notEqual(s.round.term.term, oldTerm, 'a fresh term');
  assert.deepEqual(s.scores, before.scores, 'nothing scores');
  assert.deepEqual(s.stats, before.stats);
  assert.deepEqual(s.history, []);
  assert.deepEqual(s.judges, before.judges, 'the plan is untouched');
  assert.equal(s.round.key, '1v1');
  assert.equal(sim.cue().id, 'r1v1:term:0', 'a fresh cue id: the narrator reads the new term');
  assert.deepEqual(sim.view(null).redo, { how: 'redeal', judge, kept: false });
  assert.equal(sim.view(null).round.key, '1v1');
  assert.equal(sim.view(null).title, '第 1/5 輪');
  assert.deepEqual(s.voids, [{ n: 1, judge, term: oldTerm, how: 'redeal' }]);
  // the void round is played out normally and the game ends with every seat judging once
  const res = sim.runRandom().result;
  assert.equal(sim.state.history.length, 5);
  assert.ok(res.lines.some((l) => l.includes('第 1 輪作廢') && l.includes(oldTerm)), 'the results list the void');
  assert.ok(!sim.state.history.some((h) => h.term === oldTerm), 'the voided term never comes back');
});

test('9upper: D4 — 呢輪作廢 while the 諗樣 is stuck hands the seat on; their turn moves to the end of the lap, once', () => {
  const sim = mk(4, 5, { preset: 'official' });   // 3 laps of 4
  const order0 = sim.state.judges.slice();
  toJudge(sim);
  const stuck = J(sim);
  assert.equal(sim.host(VOID), true);
  let s = sim.state;
  assert.equal(phase(sim), 'term');
  assert.equal(J(sim), order0[1], 'the next seat is 諗樣 now');
  assert.deepEqual(s.judges.slice(0, 4), [order0[1], order0[2], order0[3], stuck], 'the stuck one judges last in this lap');
  assert.deepEqual(s.judges.slice(4), order0.slice(4), 'later laps unchanged');
  assert.equal(s.totalRounds, 12);
  assert.deepEqual(lapCounts(s), lapCounts({ judges: order0, judgeLaps: order0.map((_, i) => Math.floor(i / 4)) }),
    'nobody judges twice in a lap, nobody loses a turn');
  assert.deepEqual(sim.view(null).redo, { how: 'stuck', judge: stuck, kept: true });
  assert.ok(S.redoLine(sim.view(null).redo, (p) => nameOf(sim, p), J(sim)).includes('遲啲先做諗樣'));
  // play the lap through to the stuck one's deferred turn; stuck again → the turn is lost (no second move)
  for (let k = 0; k < 3; k++) {
    toJudge(sim);
    sim.act(J(sim), { type: 'pick', target: sim.state.round.explainers[0] });
    sim.act(J(sim), { type: 'next' });
  }
  assert.equal(J(sim), stuck);
  assert.equal(sim.state.roundNo, 4);
  sim.host(VOID);   // in `term`: only the 諗樣 can start, so the 諗樣 is the stuck seat
  s = sim.state;
  assert.equal(s.totalRounds, 11, 'moved once already this lap: the turn is dropped');
  assert.equal(J(sim), order0[4], 'lap 2 starts');
  assert.equal(s.roundNo, 4);
  assert.deepEqual(s.voids.map((x) => [x.how, x.kept]), [['stuck', true], ['stuck', false]]);
  const res = sim.runRandom().result;
  assert.equal(sim.state.history.length, 11);
  assert.ok(res.lines.some((l) => l.includes('今個圈冇做到諗樣')));
});

test('9upper: D4 — the host can name the stuck seat; the last of a lap who is stuck loses the turn; the last round ends the game', () => {
  const sim = mk(4, 2);
  toJudge(sim);
  const judge = J(sim);
  sim.host({ ...VOID, pid: sim.state.round.explainers[0] });   // in 揀人, but a 玩家's phone is named: same 諗樣
  assert.equal(J(sim), judge);
  assert.equal(sim.state.voids[0].how, 'redeal');
  toExplain(sim);
  sim.host({ ...VOID, pid: judge });                            // during the explaining, the 諗樣 named: moved on
  assert.notEqual(J(sim), judge);
  assert.equal(sim.state.voids[1].how, 'stuck');
  // a 4-round game: void every round's 諗樣 until nobody is left → the game ends with no extra rounds
  let guard = 0;
  while (phase(sim) !== 'over' && guard++ < 20) { toJudge(sim); sim.host(VOID); }
  assert.equal(phase(sim), 'over');
  assert.equal(sim.state.history.length, 0);
  assert.ok(sim.result(), 'a well-formed result even with no round played');
  assert.equal(sim.host(VOID), false, 'nothing to void after the end');
});

test('9upper: D4 — a scored round is never voided; canVoid says why', () => {
  const sim = mk(4, 2);
  toJudge(sim);
  sim.act(J(sim), { type: 'pick', target: sim.state.round.explainers[0] });
  assert.equal(phase(sim), 'reveal');
  const c = engine.canVoid(sim.state);
  assert.equal(c.ok, false);
  assert.ok(c.message.includes('計咗分') && c.message.includes('下一輪'), c.message);
  assert.equal(sim.host(VOID), false, 'reveal: state unchanged');
  assert.equal(engine.canVoid({ ...sim.state, phase: 'over' }).ok, false);
});

test('9upper: D4 — 💤 an absent 諗樣: the round is void, the seat moves on, their turns are dropped; no card for them later', () => {
  const sim = mk(5, 4, { preset: 'official' });   // 2 laps of 5
  toExplain(sim);
  const away = J(sim);
  const total = sim.state.totalRounds;
  assert.equal(sim.host(ABSENT(away)), true);
  assert.deepEqual(sim.view(null).absent, [away]);
  assert.notEqual(J(sim), away);
  assert.equal(phase(sim), 'term');
  assert.equal(sim.state.totalRounds, total - 1);
  assert.deepEqual(sim.view(null).redo, { how: 'absent', judge: away, kept: false });
  assert.ok(!sim.state.round.explainers.includes(away), 'no card for a seat that is away');
  assert.equal(sim.view(away).mine, null);
  assert.equal(engine.blocking(sim.state, away), false);
  assert.equal(engine.autoAct(sim.state, away, sim.ctx()), null);
  // their lap-2 turn is dropped when it comes up; everybody else still judges twice
  const res = sim.runRandom({ onStep: leakCheck }).result;
  const judged = sim.state.history.map((h) => h.judge);
  assert.ok(!judged.includes(away));
  for (const p of sim.state.order.filter((x) => x !== away)) assert.equal(judged.filter((x) => x === p).length, 2, p);
  assert.ok(!sim.state.history.some((h) => h.honest === away || h.pick === away));
  assert.ok(res.lines.filter((l) => l.startsWith('💤')).length === 2, res.lines.join('\n'));
});

test('9upper: D4 — 💤 a 玩家 who is away: skipped when explaining (never ✅ 已講), back once with @present', () => {
  const sim = mk(5, 7, { speakOrder: 'system' });
  toExplain(sim);
  const ex = sim.state.round.explainers;
  sim.host(ABSENT(ex[2]));                         // not on the floor yet: marked skipped, never called
  let t = sim.view(null).turn;
  assert.ok(t.skipped.includes(ex[2]) && t.spoken.includes(ex[2]));
  assert.equal(t.pid, ex[0]);
  assert.equal(engine.blocking(sim.state, ex[0]), true, 'the speaker on the floor is waited on');
  sim.host(ABSENT(ex[0]));                         // the speaker goes: the turn ends as a skip
  t = sim.view(null).turn;
  assert.equal(t.pid, ex[1]);
  assert.ok(t.skipped.includes(ex[0]));
  sim.act(ex[1], { type: 'done', turn: t.no });
  assert.equal(sim.view(null).turn.pid, ex[3]);
  sim.host(PRESENT(ex[2]));                        // back in time: gets the floor once after everybody else
  sim.act(ex[3], { type: 'done', turn: sim.view(null).turn.no });
  assert.equal(sim.view(null).turn.pid, ex[2]);
  sim.act(ex[2], { type: 'done', turn: sim.view(null).turn.no });
  assert.equal(phase(sim), 'judge', 'the one still away is never waited for');
  // 揀人: an absent 玩家's card stands — they can still be picked
  assert.ok(sim.legal(J(sim)).some((a) => a.type === 'pick' && a.target === ex[0]));
});

test('9upper: D4 — 💤 before the read deals the cards again without them; back before the read deals them in', () => {
  const sim = mk(5, 9);
  assert.equal(phase(sim), 'term');
  const ex = sim.state.round.explainers.slice();
  const away = ex[1];
  sim.host(ABSENT(away));
  assert.ok(!sim.state.round.explainers.includes(away));
  assert.notEqual(sim.state.round.honest, away);
  assert.equal(sim.state.round.explainers.length, 3);
  assert.equal(sim.view(away).hint.length > 0, true);
  sim.host(PRESENT(away));
  assert.ok(sim.state.round.explainers.includes(away), 'dealt in again');
  assert.equal(sim.state.round.explainers.length, 4);
  // pass-the-phone read (re-run #2 N2): a reader marked away before their look may have been the only one to read the
  // truth — the round is dealt again without them (same 諗樣), whoever they were; one who already read keeps the round
  const pp = mk(5, 2, { passPhone: true });
  toRead(pp);
  const judge = J(pp);
  const first = pp.state.round.reader;
  assert.equal(pp.host(ABSENT(first)), true);
  assert.equal(phase(pp), 'term', 'a fresh deal');
  assert.equal(J(pp), judge, 'same 諗樣');
  assert.ok(!pp.state.round.explainers.includes(first) && !pp.state.round.readers.includes(first));
  assert.deepEqual(pp.state.voids.at(-1), { n: 1, judge, term: pp.state.voids.at(-1).term, how: 'away', pid: first });
  assert.deepEqual(pp.view(null).redo, { how: 'away', judge, kept: false, pid: first });
  assert.ok(S.redoLine(pp.view(null).redo, (p) => nameOf(pp, p), judge).includes(`${nameOf(pp, first)} 唔喺度`));
  assert.ok(pp.cue().text.startsWith(`${nameOf(pp, first)}唔喺度，呢輪重新派過`), pp.cue().text);
  assert.equal(pp.state.totalRounds, 5, 'nobody lost a turn as 諗樣');
  // a reader who has read (or is reading) keeps the round
  const kept = mk(5, 3, { passPhone: true });
  toRead(kept);
  const r1 = kept.state.round.reader;
  kept.act(r1, { type: 'peek' });
  const r2 = kept.state.round.readers.find((p) => p !== r1);
  kept.advance();
  assert.ok(kept.state.round.readDone.includes(r1));
  kept.host(ABSENT(r1));
  assert.equal(phase(kept), 'read', 'already read: the round stands');
  kept.act(kept.state.round.reader, { type: 'peek' });
  assert.equal(kept.host(ABSENT(kept.state.round.reader)), true);
  assert.equal(phase(kept), 'read', 'mid-look counts as read');
  assert.ok(kept.state.round.readDone.includes(r2));
});

test('9upper: D4 — 💤 is refused when fewer than 3 seats would be left; an absent 諗樣 on the reveal lets anybody go on', () => {
  const three = mk(3, 1);
  assert.equal(three.host(ABSENT('p2')), false, '3 players: nobody can be away');
  const sim = mk(4, 1);
  toJudge(sim);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  assert.equal(sim.host(ABSENT(ex[0])), true);
  assert.equal(sim.host(ABSENT(ex[1])), false, 'a second one would leave 2');
  assert.equal(sim.host(ABSENT('nobody')), false);
  assert.equal(sim.host(ABSENT(ex[0])), false, 'already away');
  sim.act(judge, { type: 'pick', target: ex[0] });
  assert.equal(phase(sim), 'reveal');
  sim.host(PRESENT(ex[0]));
  assert.deepEqual(sim.focus(), { pids: [judge], open: true, label: '揭曉' });
  assert.equal(sim.host(ABSENT(judge)), true, 'the reveal is scored: no void, just marked');
  assert.equal(phase(sim), 'reveal');
  assert.equal(sim.focus(), null, 'focus never names a seat that is away (a shared phone would ask for them)');
  assert.ok(sim.legal(ex[1]).some((a) => a.type === 'next'), 'anybody present may press 下一輪');
  assert.equal(sim.act(ex[1], { type: 'next' }), true);
  assert.notEqual(J(sim), judge);
});

test('9upper: D5 — 「我識呢條」 only flags the 諗樣\'s 換題 button: public, no swap, no role in sight, cleared by a swap', () => {
  const sim = mk(5, 2);
  const judge = J(sim);
  const ex = sim.state.round.explainers;
  const term = sim.state.round.term.term;
  const honest = sim.state.round.honest;
  assert.deepEqual(sim.legal(ex[0]), [{ type: 'know', on: true }]);
  assert.equal(sim.act(ex[0], { type: 'know' }), true);
  assert.equal(sim.state.round.term.term, term, 'never swaps by itself');
  assert.equal(sim.state.round.swaps, 0);
  assert.equal(sim.state.round.honest, honest);
  for (const p of [...sim.players.map((x) => x.id), null]) assert.deepEqual(sim.view(p).knows, [ex[0]]);
  assert.equal(sim.view(ex[0]).mine, null, 'no card yet: the flag cannot say anything about a role');
  assert.deepEqual(sim.legal(ex[0]), [{ type: 'know', on: false }]);
  assert.equal(sim.act(ex[0], { type: 'know' }), false, 'idempotent');
  assert.equal(sim.act(judge, { type: 'know' }), false, 'the 諗樣 just swaps');
  sim.act(ex[1], { type: 'know' });
  sim.act(ex[0], { type: 'know', on: false });
  assert.deepEqual(sim.view(null).knows, [ex[1]]);
  sim.act(judge, { type: 'swap' });
  assert.deepEqual(sim.view(null).knows, [], 'a new term: the flags go');
  sim.act(ex[2], { type: 'know' });
  sim.act(judge, { type: 'start' });
  assert.equal(phase(sim), 'read');
  assert.deepEqual(sim.view(null).knows, []);
  assert.equal(sim.act(ex[2], { type: 'know' }), false, 'only before the read');
});

test('9upper: D4 — blocking names exactly the seat the table waits on, never one that is away', () => {
  const sim = mk(5, 3, { levelMode: 'judge', speakOrder: 'system' });
  const judge = J(sim);
  const ids = sim.players.map((p) => p.id);
  const waitedOn = () => ids.filter((p) => engine.blocking(sim.state, p));
  assert.deepEqual(waitedOn(), [judge]);                    // level
  sim.act(judge, { type: 'level', level: 2 });
  assert.deepEqual(waitedOn(), [judge]);                    // term
  sim.act(judge, { type: 'start' });
  assert.deepEqual(waitedOn(), [], 'the shared read has a clock');
  sim.advance();
  assert.deepEqual(waitedOn(), [sim.state.round.speaker], 'explaining: the speaker on the floor');
  sim.act(judge, { type: 'decide' });
  assert.deepEqual(waitedOn(), [judge]);
  const free = mk(4, 1, { speakOrder: 'free' });
  toExplain(free);
  assert.deepEqual(free.players.map((p) => p.id).filter((p) => engine.blocking(free.state, p)), [], '自己決定: nobody is up');
});

test('9upper: D4 — fuzz: random voids, absences and returns never leak, never stall, and keep one 諗樣 turn per seat per lap', () => {
  const seen = { redeal: 0, stuck: 0, absent: 0, skip: 0, away: 0 };
  for (const over of [{}, { preset: 'official' }, { speakOrder: 'system', passPhone: true }, { speakOrder: 'free', levelMode: 'judge' }]) {
    for (let seed = 1; seed <= 25; seed++) {
      for (const n of [4, 6]) {
        const sim = mk(n, seed, over);
        const plan0 = lapCounts(sim.state);
        const rng = mulberry32(seed * 31 + n);
        let i = 0;
        sim.runRandom({
          onStep(x) {
            leakCheck(x);
            const s = x.state;
            if (s.phase === 'over' || (i++ % 7) !== 0) return;
            const pid = x.players[Math.floor(rng() * n)].id;
            const roll = rng();
            if (roll < 0.15) x.host(VOID);
            else if (roll < 0.25) x.host(ABSENT(pid));
            else if (roll < 0.4) x.host(PRESENT(pid));
            if (x.state.phase !== 'over') {
              assert.ok(!x.state.absent.includes(x.state.round.judge) || x.state.phase === 'reveal', 'a 諗樣 who is away');
            }
            for (const [k, c] of Object.entries(lapCounts(x.state))) assert.ok(c <= (plan0[k] ?? 0), `lap turn ${k} ×${c}`);
          },
        });
        const played = sim.state.history.length;
        assert.equal(played, sim.state.totalRounds, JSON.stringify({ over, seed, n }));
        for (const v of sim.state.voids) seen[v.how] += 1;
      }
    }
  }
  for (const [k, c] of Object.entries(seen)) assert.ok(c > 0, `the fuzz never hit a ${k}`);
});

// ---------- U1 phase hints ----------

test('9upper: U1 — every phase gives every seat (and the table) a one-line hint that never leaks', () => {
  const seen = new Set();
  for (const over of [{}, { passPhone: true }, { levelMode: 'judge', callouts: 0 }, { speakOrder: 'system' },
    { speakOrder: 'system', passPhone: true, callouts: 0 }, { speakOrder: 'free' }, { speakOrder: 'free', callouts: 0, passPhone: true }]) {
    for (let seed = 1; seed <= 4; seed++) {
      const sim = mk(5, seed, over);
      const check = (x) => {
        const s = x.state;
        for (const pid of [...x.players.map((p) => p.id), null]) {
          const v = x.view(pid);
          assert.equal(typeof v.hint, 'string', `${s.phase} ${pid}`);
          assert.ok(v.hint.length >= 8 && v.hint.length <= 40, `hint length ${v.hint.length}: ${v.hint}`);
          assert.ok(!v.hint.includes('\n'));
          if (s.round.term) assert.ok(!v.hint.includes(s.round.term.explain));
          // a hint never talks about a role the viewer does not hold
          if (v.myRole !== 'honest') assert.ok(!v.hint.includes('照張卡') && !v.hint.includes('記住張卡'), v.hint);
          seen.add(`${s.phase}|${v.myRole ?? 'none'}`);
        }
      };
      check(sim);
      sim.runRandom({ onStep: check });
    }
  }
  for (const ph of ['term', 'read', 'explain', 'judge', 'reveal', 'over', 'level']) {
    assert.ok([...seen].some((k) => k.startsWith(`${ph}|`)), `no hint seen in ${ph}`);
  }
  for (const k of ['read|honest', 'read|bluffer', 'explain|honest', 'explain|bluffer', 'judge|judge']) assert.ok(seen.has(k), k);
});

test('9upper: U1 — myRole is the viewer\'s own rules.roles id, only once they hold their card', () => {
  const sim = mk(5, 2);
  const ids = rules.roles.map((r) => r.id);
  assert.equal(sim.view(J(sim)).myRole, 'judge');
  for (const p of sim.state.round.explainers) assert.equal(sim.view(p).myRole, null, 'no card before the peek');
  assert.equal(sim.view(null).myRole, null);
  sim.act(J(sim), { type: 'start' });
  for (const p of sim.state.round.explainers) {
    const role = sim.view(p).myRole;
    assert.ok(ids.includes(role));
    assert.equal(role, p === sim.state.round.honest ? 'honest' : 'bluffer');
  }
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
  const pass = s.cfg.passPhone;
  for (const p of [...sim.players.map((x) => x.id), null]) {
    const v = sim.view(p);
    const json = JSON.stringify(v);
    const isHonest = p === r.honest;
    const myWindow = s.phase === 'read' && (!pass || (r.reader === p && r.readStarted));
    const mayRead = isHonest && (myWindow || ((s.phase === 'explain' || s.phase === 'judge') && s.cfg.rePeek));
    const holdsCard = p !== null && p !== r.judge && r.explainers.includes(p) && (s.phase === 'explain' || s.phase === 'judge'
      || (s.phase === 'read' && (!pass || r.readDone.includes(p) || (r.reader === p && r.readStarted))));
    assert.equal(json.includes(secret), revealed || mayRead,
      `phase ${s.phase}: seat ${p} ${json.includes(secret) ? 'has' : 'lacks'} the explanation`);
    assert.equal(json.includes(src), revealed, `source shown outside the reveal to ${p} in ${s.phase}`);
    if (!revealed) {
      assert.equal(v.reveal, null);
      const hk = keysIn(v, 'honest');
      if (holdsCard) {
        assert.deepEqual(hk, ['$.mine.honest'], `seat ${p}`);
        assert.equal(v.mine.honest, isHonest);
        assert.equal('explain' in v.mine, mayRead);
        assert.equal(v.myRole, isHonest ? 'honest' : 'bluffer');
      } else {
        assert.deepEqual(hk, [], `seat ${p} carries an honest flag in ${s.phase}`);
        assert.equal(v.mine, null);
        assert.ok(v.myRole === null || (v.myRole === 'judge' && p === r.judge), `myRole ${v.myRole} for ${p}`);
      }
    }
    // never any private state key by name
    for (const bad of ['cfg', 'stats', 'cueAck', 'judges', 'players', 'history', 'lastHonest', 'readers']) {
      assert.equal(bad in v, false, `view leaks ${bad}`);
    }
    assert.deepEqual(Object.keys(v.round), ['n', 'total', 'key']);
    if (!revealed && !mayRead) assert.deepEqual(paths(v, (x) => x === secret), []);
  }
}

test('9upper: leak check at every step of a scripted round', () => {
  for (const over of [{ rePeek: false }, { rePeek: true }, { passPhone: true, rePeek: true }]) {
    const sim = mk(6, 12, { ...over, levelMode: 'judge' });
    leakCheck(sim);
    sim.act(J(sim), { type: 'level', level: 2 }); leakCheck(sim);
    sim.act(J(sim), { type: 'swap' }); leakCheck(sim);
    sim.act(J(sim), { type: 'start' }); leakCheck(sim);
    while (phase(sim) === 'read') {
      if (over.passPhone) { sim.act(sim.state.round.reader, { type: 'peek' }); leakCheck(sim); }
      sim.advance(); leakCheck(sim);
    }
    sim.act(sim.state.round.explainers[0], { type: 'done' }); leakCheck(sim);
    sim.act(J(sim), { type: 'call', target: sim.state.round.explainers[3] }); leakCheck(sim);
    sim.act(J(sim), { type: 'callout', target: sim.state.round.explainers[2] }); leakCheck(sim);
    sim.act(J(sim), { type: 'decide' }); leakCheck(sim);
    sim.act(J(sim), { type: 'pick', target: sim.state.round.explainers[1] }); leakCheck(sim);
    sim.act(J(sim), { type: 'next' }); leakCheck(sim);
  }
});

test('9upper: rule: only the 老實人 sees the explanation, only during the peek (unless rePeek)', () => {
  const sim = mk(5, 21, { levelMode: '3' });
  sim.act(J(sim), { type: 'start' });
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
  lenient.act(J(lenient), { type: 'start' });
  lenient.advance();
  assert.equal(lenient.view(lenient.state.round.honest).mine.explain, lenient.state.round.term.explain);
  for (const p of lenient.players) {
    if (p.id !== lenient.state.round.honest) assert.equal(JSON.stringify(lenient.view(p.id)).includes(lenient.state.round.term.explain), false);
  }
});

test('9upper: rule: the term, hint, 諗樣 and speaking order are public to everybody (spectators too)', () => {
  const sim = mk(5, 2, { levelMode: '2' });
  const t = sim.state.round.term;
  for (const pid of [...sim.players.map((p) => p.id), null, 'stranger']) {
    const v = sim.view(pid);
    assert.equal(v.term.text, t.term);
    assert.equal(v.term.level, 2);
    assert.deepEqual(v.term.hint.options, t.hint.options);
    assert.equal(v.judge, J(sim));
    assert.deepEqual(v.explainers, sim.state.round.explainers);
    assert.equal(v.phase, 'term');
    assert.ok(v.title.includes('1/'));
    assert.ok(v.subtitle.includes('做諗樣'));
  }
  assert.equal(sim.view('stranger').me, null);
  assert.equal(sim.view(null).me, null);
});

test('9upper: views are fresh objects (mutating one never touches the state)', () => {
  const sim = mk(5, 2, { levelMode: '2' });
  sim.act(J(sim), { type: 'start' });
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
  mid.act(J(mid), { type: 'start' });
  const snap = JSON.parse(JSON.stringify(mid.state));                  // a host refresh restores from JSON
  const out = engine.advance(snap, { ...mid.ctx(), now: snap.deadline });
  assert.equal(out.phase, 'explain');
});

// ---------- fuzzers ----------

const MODES = [
  { name: 'official', over: {} },
  { name: 'pass', over: { passPhone: true } },
  { name: 'busy', over: { levelMode: '3', speakSecs: 20, callouts: 2, scoreFloor: true, rePeek: true, antiStreak: true } },
  { name: 'judge-picks', over: { levelMode: 'judge', laps: 1, callouts: 0 } },
  { name: 'newbie', over: { preset: 'newbie', passPhone: true, readSecs: 15 } },
  { name: 'system-order', over: { speakOrder: 'system', speakSecs: 20, callouts: 2 } },
  { name: 'free-order', over: { speakOrder: 'free', speakSecs: 20, passPhone: true, rePeek: true } },
];

test('9upper: fuzz — every player count x 110 seeds terminates with a well-formed result', () => {
  for (let n = 3; n <= 9; n++) {
    for (let seed = 1; seed <= 110; seed++) {
      const sim = mk(n, seed * 31 + n);
      const { result } = sim.runRandom();
      assert.ok(result.winners.length >= 1);
      assert.equal(sim.state.history.length, sim.state.totalRounds);
      assert.equal(Object.keys(result.points).length, n);
      for (const v of Object.values(result.points)) assert.ok(Number.isFinite(v));
      // role-count invariant (#8): every round had exactly 1 諗樣, 1 老實人 and n−2 9upper
      for (const h of sim.state.history) assert.notEqual(h.judge, h.honest);
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
      for (let seed = 1; seed <= 12; seed++) {
        const sim = mk(n, seed * 13 + n, mode.over);
        const { result } = sim.runRandom();
        assert.ok(result);
      }
    }
  }
});

test('9upper: fuzz — an empty or missing bank still plays to the end (emergency cards)', () => {
  for (const b of [{ '9upper': [] }, {}]) {
    for (let n = 3; n <= 9; n += 3) {
      const sim = mk(n, n, {}, b);
      sim.runRandom();
    }
  }
});

test('9upper: fuzz — every seat sometimes wins (no dead seats)', () => {
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
  for (const over of [{ callouts: 2 }, { passPhone: true, levelMode: 'judge' }, { speakOrder: 'system', callouts: 2 },
    { speakOrder: 'free', callouts: 2, passPhone: true }]) {
    for (let n = 3; n <= 9; n++) {
      const sim = mk(n, n * 3, over);
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
  }
});

// ---------- UI smoke test (tiny DOM shim; no browser) ----------

/** Just enough DOM for js/games/9upper/ui.js: elements, text, classes, listeners. */
function installDom() {
  class FakeNode {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.parent = null; this.attrs = {}; this.listeners = {};
      this.style = { cssText: '' }; this._text = ''; this.hidden = false; this.disabled = false; this.className = '';
      const set = new Set();
      this.classList = {
        add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c),
        toggle: (c, on = !set.has(c)) => { if (on) set.add(c); else set.delete(c); return on; },
      };
    }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = []; this._text = String(v ?? ''); }
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
    click() { if (!this.disabled) for (const fn of this.listeners.click ?? []) fn({}); }
    /** Visible text only (skips hidden subtrees), like what a player could read. */
    visibleText() { return this.hidden ? '' : this._text + this.children.map((c) => c.visibleText()).join(''); }
    all() { return [this, ...this.children.flatMap((c) => c.all())]; }
    static text(s) { const n = new FakeNode('#text'); n._text = s; return n; }
  }
  const prev = { Node: globalThis.Node, document: globalThis.document };
  globalThis.Node = FakeNode;
  globalThis.document = { createElement: (t) => new FakeNode(t), createTextNode: (s) => FakeNode.text(s) };
  return { FakeNode, restore() { globalThis.Node = prev.Node; globalThis.document = prev.document; } };
}

function fakeComponents(FakeNode) {
  const pickers = [];
  return {
    pickers,
    components: {
      Cover(props) {
        const el = new FakeNode('div');
        el.append(props.front);   // the real Cover keeps the front in the DOM too (hidden until held)
        return { el, update() {}, close() {}, destroy() { el.remove(); } };
      },
      PlayerPicker() {
        const el = new FakeNode('div');
        const me = { el, props: null, update(p) { me.props = p; el.textContent = p.players.map((x) => x.name).join(','); }, destroy() {} };
        pickers.push(me);
        return me;
      },
      Timer() { const el = new FakeNode('div'); return { el, update() {}, destroy() {} }; },
    },
  };
}

const buttons = (root) => root.all().filter((n) => n.tagName === 'button' && !n.hidden);
const button = (root, text) => buttons(root).find((b) => b.textContent.includes(text));

test('9upper: UI renders every phase for every seat, never shows the explanation to the wrong seat, and sends the right actions', async () => {
  const dom = installDom();
  const mounted = [];
  try {
    const { mount } = await import('../js/games/9upper/ui.js');
    for (const over of [{}, { passPhone: true }, { levelMode: 'judge', callouts: 2, speakSecs: 20, rePeek: true },
      { speakOrder: 'system', callouts: 2, speakSecs: 20, rePeek: true }, { speakOrder: 'free', passPhone: true, rePeek: true }]) {
      for (let seed = 1; seed <= 3; seed++) {
        const sim = mk(5, seed, over);
        const seats = [...sim.players.map((p) => p.id), null];
        const uis = seats.map((me) => {
          const root = new dom.FakeNode('div');
          const sent = [];
          const fc = fakeComponents(dom.FakeNode);
          const ui = mount(root, { me, players: sim.players, isHost: me === 'p1', send: (a) => sent.push(a),
            sfx() {}, toast() {}, now: () => sim.now, components: fc.components, meta, config: sim.config });
          mounted.push(ui);
          return { me, root, ui, sent, fc };
        });
        const paint = () => {
          const s = sim.state;
          for (const u of uis) {
            u.ui.update(sim.view(u.me), { focus: sim.focus(), paused: false });
            const text = u.root.visibleText();
            assert.ok(text.length > 0, `empty screen for ${u.me} in ${s.phase}`);
            const r = s.round;
            const revealed = s.phase === 'reveal' || s.phase === 'over';
            const may = u.me === r.honest && (s.phase === 'read'
              ? (!s.cfg.passPhone || (r.reader === u.me && r.readStarted))
              : s.cfg.rePeek && (s.phase === 'explain' || s.phase === 'judge'));
            if (r.term && s.phase !== 'over') {
              assert.equal(text.includes(r.term.explain), revealed || may, `${u.me} in ${s.phase} (explanation on screen)`);
            }
          }
        };
        paint();
        sim.runRandom({ onStep: paint });
      }
    }

    // wiring: each new control sends the action the engine expects
    const sim = mk(4, 2, { passPhone: true, callouts: 1 });
    const seatUi = (pid) => {
      const root = new dom.FakeNode('div');
      const sent = [];
      const fc = fakeComponents(dom.FakeNode);
      const ui = mount(root, { me: pid, players: sim.players, isHost: true, send: (a) => sent.push(a), sfx() {}, toast() {},
        now: () => sim.now, components: fc.components, meta, config: sim.config });
      mounted.push(ui);
      return { root, sent, fc, show() { ui.update(sim.view(pid), {}); } };
    };
    const judge = seatUi(J(sim));
    judge.show();
    button(judge.root, '開始睇卡').click();
    assert.deepEqual(judge.sent.pop(), { type: 'start' });
    sim.act(J(sim), { type: 'start' });
    const reader = seatUi(sim.state.round.reader);
    reader.show();
    button(reader.root, '開始睇卡').click();
    assert.deepEqual(reader.sent.pop(), { type: 'peek' });
    finishRead(sim);
    judge.show();
    const ex = sim.state.round.explainers;
    const callRow = judge.root.all().find((n) => n.tagName === 'button' && n.className.includes('callable')
      && n.textContent.includes(nameOf(sim, ex[2])));
    callRow.click();
    assert.deepEqual(judge.sent.pop(), { type: 'call', target: ex[2] });
    const chip = buttons(judge.root).find((b) => b.className.includes('g9-chip') && b.textContent === nameOf(sim, ex[1]));
    chip.click();
    assert.equal(judge.sent.length, 0, '收皮啦 needs a second tap');
    judge.show();
    assert.ok(buttons(judge.root).some((b) => b.className.includes('g9-chip') && b.textContent === `確定收皮 ${nameOf(sim, ex[1])}？`),
      'the armed chip names its target');
    buttons(judge.root).find((b) => b.className.includes('g9-chip') && b.textContent.includes('確定收皮')).click();
    assert.deepEqual(judge.sent.pop(), { type: 'callout', target: ex[1] });
    button(judge.root, '我決定咗').click();
    assert.deepEqual(judge.sent.pop(), { type: 'decide' });
    sim.act(J(sim), { type: 'decide' });
    judge.show();
    judge.fc.pickers.at(-1).props.onConfirm([ex[0]]);
    assert.deepEqual(judge.sent.pop(), { type: 'pick', target: ex[0] });
  } finally {
    for (const ui of mounted) ui.destroy();
    dom.restore();
  }
});

test('9upper: UI — 系統派 announces the speaker and has no 叫佢講; 自己決定 has 我講完 and name ticks', async () => {
  const dom = installDom();
  const mounted = [];
  try {
    const { mount } = await import('../js/games/9upper/ui.js');
    const seatUi = (sim, pid) => {
      const root = new dom.FakeNode('div');
      const sent = [];
      const sfxs = [];
      const fc = fakeComponents(dom.FakeNode);
      const ui = mount(root, { me: pid, players: sim.players, isHost: pid === 'p1', send: (a) => sent.push(a),
        sfx: (n) => sfxs.push(n), toast() {}, now: () => sim.now, components: fc.components, meta, config: sim.config });
      mounted.push(ui);
      return { root, sent, sfxs, show() { ui.update(sim.view(pid), {}); return root.visibleText(); } };
    };
    const callable = (root) => root.all().filter((n) => n.className.includes('callable') && !n.hidden);

    // ---- 系統派
    const sys = mk(5, 6, { speakOrder: 'system', callouts: 1 });
    toExplain(sys);
    const ex = sys.state.round.explainers;
    const jd = seatUi(sys, J(sys));
    const first = seatUi(sys, ex[0]);
    const second = seatUi(sys, ex[1]);
    const table = seatUi(sys, null);
    let t = jd.show();
    assert.ok(t.includes(`輪到 ${nameOf(sys, ex[0])}`), 'the 諗樣 sees who is dealt');
    assert.ok(t.includes(`下一位：${nameOf(sys, ex[1])}`));
    assert.ok(t.includes('1. ') && t.includes('4. '), 'the dealt order is numbered');
    assert.equal(callable(jd.root).length, 0, 'no 叫佢講 in 系統派');
    assert.ok(!t.includes('叫佢講'));
    assert.ok(button(jd.root, '下一位') && button(jd.root, '我決定咗'));
    button(jd.root, '下一位').click();
    assert.deepEqual(jd.sent.pop(), { type: 'done', turn: 0 });
    t = first.show();
    assert.ok(t.includes('輪到你講！'));
    assert.deepEqual(first.sfxs, ['turn'], 'a soft chime for the one called');
    assert.ok(button(first.root, '我講完'));
    button(first.root, '我講完').click();
    assert.deepEqual(first.sent.pop(), { type: 'done', turn: 0 });
    t = second.show();
    assert.equal(button(second.root, '我講完'), undefined, 'not their turn');
    assert.ok(t.includes(`輪到 ${nameOf(sys, ex[0])}`) && !second.sfxs.includes('turn'));
    t = table.show();
    assert.ok(t.includes(`輪到 ${nameOf(sys, ex[0])}`));
    assert.equal(buttons(table.root).length, 0, 'the table has nothing to tap');
    // the dealt speaker advances → the next phone chimes, the old announcement is replaced
    sys.act(ex[0], { type: 'done', turn: 0 });
    t = second.show();
    assert.ok(t.includes('輪到你講！') && button(second.root, '我講完'));
    assert.deepEqual(second.sfxs, ['turn']);
    second.show();
    assert.deepEqual(second.sfxs, ['turn'], 'one chime per turn, not per update');
    t = jd.show();
    assert.ok(t.includes(`輪到 ${nameOf(sys, ex[1])}`) && t.includes(`下一位：${nameOf(sys, ex[2])}`));
    assert.ok(t.includes('✅ 已講'));
    for (const pid of [ex[1], ex[2]]) sys.act(pid, { type: 'done' });
    t = jd.show();
    assert.ok(t.includes(`輪到 ${nameOf(sys, ex[3])}`) && t.includes('之後就到諗樣揀人'), 'last speaker');

    // ---- 自己決定
    const fr = mk(5, 6, { speakOrder: 'free', callouts: 1 });
    toExplain(fr);
    const fx = fr.state.round.explainers;
    const fj = seatUi(fr, J(fr));
    const fp = seatUi(fr, fx[2]);
    const ft = seatUi(fr, null);
    t = fj.show();
    assert.ok(t.includes('自己決定次序'));
    assert.ok(!t.includes('輪到'), 'nobody is announced');
    assert.equal(button(fj.root, '下一位'), undefined);
    assert.ok(button(fj.root, '我決定咗'));
    const ticks = callable(fj.root);
    assert.equal(ticks.length, 4, 'every waiting name is a tick button for the 諗樣');
    assert.ok(ticks.every((n) => n.textContent.includes('講完喇')));
    ticks.find((n) => n.textContent.includes(nameOf(fr, fx[1]))).click();
    assert.deepEqual(fj.sent.pop(), { type: 'done', target: fx[1] });
    t = fp.show();
    assert.ok(button(fp.root, '我講完'), 'a 玩家 ticks themselves');
    assert.equal(callable(fp.root).length, 0);
    button(fp.root, '我講完').click();
    assert.deepEqual(fp.sent.pop(), { type: 'done' });
    fr.act(fx[2], { type: 'done' });
    t = fp.show();
    assert.equal(button(fp.root, '我講完'), undefined, 'ticked → the button goes');
    assert.ok(t.includes('✅ 已講'));
    t = fj.show();
    assert.equal(callable(fj.root).length, 3);
    t = ft.show();
    assert.equal(buttons(ft.root).length, 0);
    assert.ok(t.includes('自己傾'));
    // 諗樣揀 is unchanged: tap a name to call
    const off = mk(5, 6);
    toExplain(off);
    const oj = seatUi(off, J(off));
    t = oj.show();
    assert.equal(callable(oj.root).length, 3, 'the waiting names (not the one talking) are 叫佢講 buttons');
    assert.ok(t.includes('叫佢講') && button(oj.root, '下一位'));
    assert.ok(!t.includes('輪到'));
  } finally {
    for (const ui of mounted) ui.destroy();
    dom.restore();
  }
});

test('9upper: UI — same-length cards, an honest read the phone can vouch for, skips, the callout row, source and swap', async () => {
  const dom = installDom();
  const mounted = [];
  try {
    const { mount } = await import('../js/games/9upper/ui.js');
    const covers = [];
    const seatUi = (sim, pid) => {
      const root = new dom.FakeNode('div');
      const sent = [];
      const sfxs = [];
      const fc = fakeComponents(dom.FakeNode);
      const Cover0 = fc.components.Cover;
      fc.components.Cover = (props) => { const c = Cover0(props); covers.push({ pid, props }); return c; };
      const ui = mount(root, { me: pid, players: sim.players, isHost: pid === 'p1', send: (a) => sent.push(a),
        sfx: (n) => sfxs.push(n), toast() {}, now: () => sim.now, components: fc.components, meta, config: sim.config });
      mounted.push(ui);
      return { root, sent, sfxs, show() { ui.update(sim.view(pid), {}); return root.visibleText(); } };
    };
    const faceText = (root) => root.all().find((n) => n.className === 'g9-face-text')?.textContent ?? '';
    const len = (t) => Array.from(t).length;

    // #16: during the read every card holds a block of similar length (a real explanation is 17–67 characters)
    const real = '喺好嘈嘅環境入面，人仍然可以集中聽住一個人講嘢；聽到有人叫自己個名都會即刻留意到。';
    const bank = { '9upper': BANK.map((e) => ({ ...e, explain: `${real}【${e.term}】` })) };
    for (let seed = 1; seed <= 6; seed++) {
      const sim = mk(5, seed, {}, bank);
      const seats = sim.players.map((p) => seatUi(sim, p.id));
      toRead(sim);
      for (const u of seats) u.show();
      const lens = seats.map((u) => len(faceText(u.root)));
      for (const n of lens) assert.ok(n >= 25 && n <= 70, `every card holds a block (${lens})`);
      // #21: the window opens with the same sound and flash on every phone, the 諗樣's included
      for (const u of seats) {
        assert.deepEqual(u.sfxs, ['deal']);
        assert.ok(u.root.all().some((n) => n.classList.contains('g9-flash')));
      }
      for (const u of seats) u.show();
      assert.ok(seats.every((u) => u.sfxs.length === 1), 'once, not on every update');
    }

    // #21: an honest player whose phone watched the window and never opened the card is not told they read it
    const told = (opened) => {
      const sim = mk(4, 3);
      toRead(sim);
      const H = sim.state.round.honest;
      const u = seatUi(sim, H);
      u.show();
      if (opened) covers.filter((c) => c.pid === H).at(-1).props.onOpen(true);
      finishRead(sim);
      u.show();
      return faceText(u.root);
    };
    assert.ok(told(true).includes('你睇過真正解釋喇'));
    const missed = told(false);
    assert.ok(missed.includes('你冇打開到張卡') && !missed.includes('你睇過真正解釋喇'), missed);
    // a phone that joined after the window does not know: the usual line
    {
      const sim = mk(4, 3);
      toExplain(sim);
      const u = seatUi(sim, sim.state.round.honest);
      u.show();
      assert.ok(faceText(u.root).includes('你睇過真正解釋喇'));
    }
    // a phone that re-mounted half way through the window cannot know whether the card was opened before the reload:
    // no second start sound, no flash, and afterwards the usual line (never a false 「你冇打開到張卡」)
    {
      const sim = mk(4, 3);
      toRead(sim);
      sim.tick(4000);
      const u = seatUi(sim, sim.state.round.honest);
      u.show();
      assert.deepEqual(u.sfxs, [], 'no start sound on a re-mount mid-window');
      assert.ok(!u.root.all().some((n) => n.classList.contains('g9-flash')));
      finishRead(sim);
      u.show();
      assert.ok(faceText(u.root).includes('你睇過真正解釋喇'), faceText(u.root));
    }

    // #23: a skipped speaker is shown as such, and in 諗樣揀 the 諗樣 can call them back
    const sim = mk(5, 6, { callouts: 1 });
    toExplain(sim);
    const ex = sim.state.round.explainers;
    const jd = seatUi(sim, J(sim));
    sim.act(J(sim), { type: 'done', turn: 0 });
    let t = jd.show();
    assert.ok(t.includes('⏭ 跳過咗'), t);
    const back = jd.root.all().find((n) => n.tagName === 'button' && n.className.includes('skipped') && n.textContent.includes(nameOf(sim, ex[0])));
    assert.ok(back && back.textContent.includes('叫返佢'));
    back.click();
    assert.deepEqual(jd.sent.pop(), { type: 'call', target: ex[0] });
    // #22: the 收皮啦 chips follow seat order (the 揀人 list's order), and the armed chip names its target
    const chips = buttons(jd.root).filter((b) => b.className.includes('g9-chip')).map((b) => b.textContent);
    const seatOrdered = sim.players.map((p) => p.id).filter((p) => ex.includes(p)).map((p) => nameOf(sim, p));
    assert.deepEqual(chips, seatOrdered);
    buttons(jd.root).find((b) => b.textContent === seatOrdered[1]).click();
    jd.show();
    assert.ok(buttons(jd.root).some((b) => b.textContent === `確定收皮 ${seatOrdered[1]}？`));
    // the others' 揀人 screen says the questions go on
    sim.act(J(sim), { type: 'decide' });
    const other = seatUi(sim, ex[1]);
    assert.ok(other.show().includes('諗樣仲可以追問'));
    // the reveal names the 9uppers and shows the source as a readable label
    sim.act(J(sim), { type: 'pick', target: ex[2] });
    t = other.show();
    const nine = sim.state.round.explainers.filter((p) => p !== sim.state.round.honest);
    assert.ok(t.includes(`🤥 9upper：${sim.players.filter((p) => nine.includes(p.id)).map((p) => p.name).join('、')}`), t);
    assert.ok(t.includes(`來源：${sim.state.round.term.src}`), 'a non-URL source stays as written');
    const link = mk(4, 1, {}, { '9upper': [{ term: '深水埗', explain: '九龍西北部一區。', cat: CATS[0], level: 1,
      src: 'https://zh.wikipedia.org/wiki/%E6%B7%B1%E6%B0%B4%E5%9F%97' }] });
    toJudge(link);
    link.act(J(link), { type: 'pick', target: link.state.round.explainers[0] });
    const lu = seatUi(link, J(link));
    t = lu.show();
    assert.ok(t.includes('來源：維基百科：深水埗') && !t.includes('%E6'), t);
    const a = lu.root.all().find((n) => n.tagName === 'a');
    assert.equal(a.attrs.href, 'https://zh.wikipedia.org/wiki/%E6%B7%B1%E6%B0%B4%E5%9F%97');
    assert.equal(a.attrs.rel, 'noopener noreferrer');

    // polish: a 換題 is announced on every phone
    const sw = mk(4, 2);
    const p2 = seatUi(sw, sw.state.round.explainers[0]);
    p2.show();
    sw.act(J(sw), { type: 'swap' });
    t = p2.show();
    assert.ok(t.includes('🔄 換咗題（仲可以換 2 次）'), t);
  } finally {
    for (const ui of mounted) ui.destroy();
    dom.restore();
  }
});

test('9upper: UI — 我識呢條, 💤, a fresh deal after 呢輪作廢, and 代佢做 for a speaker shows ⏭ 跳過咗', async () => {
  const dom = installDom();
  const mounted = [];
  try {
    const { mount } = await import('../js/games/9upper/ui.js');
    const seatUi = (sim, pid) => {
      const root = new dom.FakeNode('div');
      const sent = [];
      const fc = fakeComponents(dom.FakeNode);
      const ui = mount(root, { me: pid, players: sim.players, isHost: pid === 'p1', send: (a) => sent.push(a),
        sfx() {}, toast() {}, now: () => sim.now, components: fc.components, meta, config: sim.config });
      mounted.push(ui);
      return { root, sent, show() { ui.update(sim.view(pid), {}); return root.visibleText(); } };
    };
    const sim = mk(5, 4, { speakOrder: 'system' });
    const judge = J(sim);
    const ex = sim.state.round.explainers;
    const seats = Object.fromEntries(sim.players.map((p) => [p.id, seatUi(sim, p.id)]));
    // D5: every 玩家 has the same 「我識呢條」 button; the 諗樣 has none
    const texts = ex.map((p) => seats[p].show());
    assert.ok(texts.every((t) => t === texts[0]), 'the term step looks the same on every 玩家\'s phone');
    assert.ok(!seats[judge].show().includes('我識呢條'));
    button(seats[ex[1]].root, '我識呢條').click();
    assert.deepEqual(seats[ex[1]].sent.pop(), { type: 'know', on: true });
    sim.act(ex[1], { type: 'know', on: true });
    assert.ok(seats[judge].show().includes(`🙋 ${nameOf(sim, ex[1])} 話識 · 換題`), 'the 諗樣\'s 換題 names who knows it');
    assert.ok(buttons(seats[judge].root).some((b) => b.className.includes('g9-swap') && b.classList.contains('flagged')));
    assert.ok(seats[ex[1]].show().includes('已話咗識'));
    button(seats[ex[1]].root, '已話咗識').click();
    assert.deepEqual(seats[ex[1]].sent.pop(), { type: 'know', on: false }, 'a second tap takes it back');
    assert.equal(sim.state.round.term.term, sim.view(null).term.text, 'nothing swapped');

    // 呢輪作廢 → every phone says why there is a fresh deal
    toExplain(sim);
    sim.host({ type: ACT.VOID_ROUND });
    for (const p of sim.players) assert.ok(seats[p.id].show().includes('上一鋪作廢'), p.id);
    toExplain(sim);
    for (const p of sim.players) assert.ok(!seats[p.id].show().includes('上一鋪作廢'), 'only over the fresh deal');

    // 代佢做 for the speaker (autoAct) → ⏭ 跳過咗, never ✅ 已講
    const speaker = sim.state.round.speaker;
    const auto = engine.autoAct(sim.state, speaker, sim.ctx());
    assert.equal(sim.act(speaker, auto), true);
    const row = (u, pid) => u.root.all().find((n) => n.className?.startsWith('g9-speaker ') && n.textContent.includes(nameOf(sim, pid)));
    seats[judge].show();
    assert.ok(row(seats[judge], speaker).textContent.includes('⏭ 跳過咗'));
    assert.ok(!row(seats[judge], speaker).textContent.includes('✅ 已講'));

    // 💤: the list and the scores say so on every phone; the seat itself keeps its card this round
    const gone = sim.state.round.speaker;
    sim.host({ type: ACT.ABSENT ?? '@absent', pid: gone });
    seats[judge].show();
    assert.ok(row(seats[judge], gone).textContent.includes('💤 唔喺度'));
    assert.ok(seats[judge].root.all().some((n) => n.className === 'g9-score-name' && n.textContent.endsWith('💤')));
    // the reveal: the 諗樣 goes too — every other seated phone gets 下一輪
    sim.act(judge, { type: 'decide' });
    sim.act(judge, { type: 'pick', target: sim.state.round.explainers[0] });
    const other = sim.state.round.explainers.find((p) => p !== gone);
    seats[other].show();
    assert.ok(!button(seats[other].root, '下一輪'), 'only the 諗樣 while they are here');
    sim.host({ type: ACT.ABSENT ?? '@absent', pid: judge });
    seats[other].show();
    button(seats[other].root, '下一輪').click();
    assert.deepEqual(seats[other].sent.pop(), { type: 'next' });
    sim.act(other, { type: 'next' });
    // next deal: the seat that is away holds no card and sees the table's screen
    toRead(sim);
    sim.now += 1000;
    const txt = seats[gone].show();
    assert.ok(!txt.includes('你係 9upper') && !txt.includes('你係老實人'), txt);
  } finally {
    for (const ui of mounted) ui.destroy();
    dom.restore();
  }
});

test('9upper: UI on one phone (§7.1) — 「✅ 講完 · 下一位」 + ⏭, no 「（你）」, and the reveal\'s 下一輪 is one table tap behind the card', async () => {
  const dom = installDom();
  const mounted = [];
  try {
    const { mount } = await import('../js/games/9upper/ui.js');
    /** A seat (or the table, pid null) on a phone. `phone` = { shared, mySeats } — a whole-table phone by default. */
    const onPhone = (sim, pid, phone = {}) => {
      const root = new dom.FakeNode('div');
      const sent = [];
      const table = [];
      const toasts = [];
      const sfxs = [];
      const fc = fakeComponents(dom.FakeNode);
      const mySeats = phone.mySeats ?? sim.players.map((p) => p.id);
      const shared = phone.shared ?? true;
      const ui = mount(root, {
        me: pid, players: sim.players, isHost: true, send: (a) => sent.push(a), sfx: (n) => sfxs.push(n),
        toast: (t) => toasts.push(t), now: () => sim.now, components: fc.components, meta, config: sim.config,
        shared, wholeTable: shared, atTable: shared && pid === null, mySeats,
        tableSend: (a) => { table.push(a); return Promise.resolve(true); },
      });
      mounted.push(ui);
      return { root, sent, table, toasts, sfxs, show(ctx = {}) { ui.update(sim.view(pid), { shared, ...ctx }); return root.visibleText(); } };
    };
    const mkOne = (n, seed, over = {}) => new Sim(game, { n, seed, banks,
      config: { ...config.defaults(n, undefined, { singleDevice: true }), ...over } });

    // #20: a shared phone never says 「你」 to the table — any seat's screen, any phase
    for (const speakOrder of ['judge', 'system', 'free']) {
      const sim = mkOne(5, 3, { speakOrder, callouts: 2, rePeek: true });
      const seats = [...sim.players.map((p) => p.id), null].map((pid) => ({ pid, ui: onPhone(sim, pid) }));
      const paint = () => {
        for (const s of seats) {
          const t = s.ui.show();
          assert.ok(!t.includes('（你）'), `${speakOrder} ${s.pid ?? 'table'} in ${sim.state.phase}: ${t}`);
          assert.ok(!t.includes('輪到你講'), 'the 系統派 banner names the speaker');
        }
      };
      paint();
      sim.runRandom({ onStep: paint });
      for (const s of seats) assert.ok(!s.ui.sfxs.includes('turn'), 'no 「your turn」 chime on a phone everybody shares');
    }

    // #11: the 諗樣 holds the phone and ticks the speakers off; the skip is its own small button
    const sim = mkOne(4, 2, { speakOrder: 'system' });
    toExplain(sim);
    const judge = onPhone(sim, J(sim));
    const text = judge.show();
    assert.ok(text.includes('⏭ 跳過') && !text.includes('「下一位」'), 'the note points at ⏭ for a friend who is away');
    button(judge.root, '✅ 講完 · 下一位').click();
    assert.deepEqual(judge.sent.pop(), { type: 'done', turn: 0 });
    assert.equal(sim.act(J(sim), { type: 'done', turn: 0 }), true);
    const judge2 = onPhone(sim, J(sim));   // (the first screen's send guard holds for 3.5 s)
    judge2.show();
    button(judge2.root, '⏭ 佢唔喺度，跳過').click();
    assert.deepEqual(judge2.sent.pop(), { type: 'done', turn: 1, skip: true });
    // phones of their own (passPhone off): the 諗樣's 下一位 is the old skip, and there is no second button
    const own = mk(4, 2, { speakOrder: 'system' });
    toExplain(own);
    const ownJudge = onPhone(own, J(own), { shared: false, mySeats: [J(own)] });
    ownJudge.show();
    assert.ok(button(ownJudge.root, '下一位') && !button(ownJudge.root, '✅ 講完') && !button(ownJudge.root, '⏭ 佢唔喺度'));

    // #1/#5: the reveal lies in the middle — one table tap, locked while the 「擺返中間」 card is up (U5)
    const rv = mkOne(4, 6);
    toJudge(rv);
    rv.act(J(rv), { type: 'pick', target: rv.state.round.explainers[0] });
    const tableUi = onPhone(rv, null);
    let t = tableUi.show({ tableLocked: true });
    const tap = () => button(tableUi.root, '大家睇完 ✓');
    assert.ok(tap() && tap().textContent.includes('下一輪') && tap().textContent.includes('一下就得'), t);
    assert.equal(tap().disabled, true, 'locked behind the table card');
    tap().click();
    assert.deepEqual(tableUi.table, [], 'nothing sent while locked');
    t = tableUi.show({ tableLocked: false });
    assert.equal(tap().disabled, false);
    assert.ok(!t.includes(`等 ${nameOf(rv, J(rv))}`), 'no 「等 X 開下一輪」 when the table itself can go on');
    tap().click();
    assert.deepEqual(tableUi.table, [{ type: 'next' }]);
    assert.deepEqual(tableUi.sent, [], 'never api.send from the table');
    assert.equal(rv.act(rv.state.round.explainers[1], { type: 'next', seats: rv.players.map((p) => p.id), table: true }), true,
      'what tableSend becomes is accepted');
    // the 諗樣 is on another phone: the table tap would not count for them, so it is not offered
    const rv2 = mkOne(4, 6);
    toJudge(rv2);
    rv2.act(J(rv2), { type: 'pick', target: rv2.state.round.explainers[0] });
    const others = rv2.players.map((p) => p.id).filter((p) => p !== J(rv2));
    const elsewhere = onPhone(rv2, null, { mySeats: others });
    t = elsewhere.show();
    assert.ok(!button(elsewhere.root, '大家睇完 ✓') && t.includes(`等 ${nameOf(rv2, J(rv2))}`));
    // a spectator phone (not shared): unchanged, no table tap
    const spect = onPhone(rv2, null, { shared: false, mySeats: [] });
    spect.show();
    assert.ok(!button(spect.root, '大家睇完 ✓'));
    // the term step at the table: no 「我識呢條」 button there, so the note does not point at one
    const tm = mkOne(4, 1);
    const term = onPhone(tm, null);
    t = term.show();
    assert.ok(!t.includes('㩒「我識呢條」') && t.includes('出聲'), t);
  } finally {
    for (const ui of mounted) ui.destroy();
    dom.restore();
  }
});

test('9upper: srcLabel turns bank URLs into readable labels; decoys are stable per round and seat', async () => {
  assert.deepEqual(S.srcLabel('https://zh.wikipedia.org/wiki/%E6%B7%B1%E6%B0%B4%E5%9F%97'),
    { text: '維基百科：深水埗', href: 'https://zh.wikipedia.org/wiki/%E6%B7%B1%E6%B0%B4%E5%9F%97' });
  assert.equal(S.srcLabel('https://en.wikipedia.org/wiki/Cocktail_party_effect').text, 'Wikipedia：Cocktail party effect');
  assert.equal(S.srcLabel('https://www.moedict.tw/%E9%9D%89%E9%9D%86').text, '萌典：靉靆');
  assert.equal(S.srcLabel('https://dict.idioms.moe.edu.tw/idiomView.jsp?ID=1').text, '教育部成語典');
  assert.equal(S.srcLabel('https://www.space.com/blazar').text, 'space.com');
  assert.deepEqual(S.srcLabel('《The Pragmatic Programmer》（1999）'), { text: '《The Pragmatic Programmer》（1999）', href: null });
  // every bank source gets a short label, never a percent-encoded one
  for (const x of (await realBank())?.bank ?? []) {
    if (!x.src) continue;
    const l = S.srcLabel(x.src).text;
    assert.ok(l && !/%[0-9A-F]{2}/i.test(l) && Array.from(l).length <= 60, `${x.src} → ${l}`);
  }
  const term = { text: '深水埗', level: 1, hint: { kind: 'one', options: ['香港冷知識'] } };
  assert.equal(S.bluffDecoy(term, '1|p2'), S.bluffDecoy(term, '1|p2'));
  assert.equal(S.judgeDecoy('3|p1'), S.judgeDecoy('3|p1'));
  assert.ok(S.bluffDecoy(term, '1|p2').includes('深水埗'));
  const lens = new Set(Array.from({ length: 12 }, (_, i) => Array.from(S.bluffDecoy(term, `${i}|p2`)).length));
  assert.ok(lens.size >= 3, 'decoy lengths vary like real explanations do');
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
    this.styleMap = {}; this.hidden = false; this.disabled = false; this.dataset = {}; this.open = false;
    if (tag === 'template') this.content = { firstElementChild: new ShEl('svg') };   // dom.fromHTML (the dice cup's art)
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
  get firstElementChild() { return this.children.find((c) => c instanceof ShEl) ?? null; }
  get lastElementChild() { return [...this.children].reverse().find((c) => c instanceof ShEl) ?? null; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(...(String(v) === '' ? [] : [new ShText(v)])); }
  /** Enough for the shell's menus, which compare outerHTML before they rebuild. */
  get outerHTML() {
    return `<${this.tag} class="${this.className}">${this.children.map((c) => (c instanceof ShEl ? c.outerHTML : c.textContent)).join('')}</${this.tag}>`;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  setPointerCapture() {}
  focus() {}
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
/** Hold a cover down and let go (Cover listens for pointerdown / pointerup). */
const shPeek = (cover) => {
  assert.ok(cover, 'no cover to hold');
  for (const f of cover.listeners.pointerdown ?? []) f({ preventDefault() {}, pointerId: 1 });
  for (const f of cover.listeners.pointerup ?? []) f({ preventDefault() {}, pointerId: 1 });
};
const shSettle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

async function withShell(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node, window: globalThis.window, raf: globalThis.requestAnimationFrame };
  globalThis.document = shDoc;
  globalThis.Node = ShNode;
  globalThis.window = { addEventListener() {}, AudioContext: undefined, scrollTo() {} };
  globalThis.requestAnimationFrame = (f) => f();
  shDoc.body.replaceChildren();
  const dom = await import('../js/ui/dom.js?v=1');
  try {
    return await fn(dom);
  } finally {
    dom.disarmConfirm?.();
    const { PassGate } = await import('../js/ui/components/PassGate.js?v=1');
    PassGate.hide();
    for (const [k, v] of Object.entries({ document: saved.document, Node: saved.Node, window: saved.window, requestAnimationFrame: saved.raf })) {
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
  const holds = [];
  let screen = null;
  const render = async () => { sync(); screen.update(st); await shSettle(); screen.update(st); await shSettle(); };
  const app = {
    state: st,
    hostCtl: {
      next: () => true, voidRound: () => false, pause() {}, resume() {}, autoAct: () => true, markAbsent: () => true, markPresent: () => true,
      holdClock: (on) => { holds.push(on); return true; },
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
  return {
    st, acts, holds, render,
    gate: () => gateEl()?.attrs['data-gate'] ?? null,
    gateText: () => gateEl()?.textContent ?? '',
    tapGate: async () => { shTap(shFind(gateEl(), (n) => n.tag === 'button' && n.cls.has('btn-primary'))[0]); await shSettle(); await render(); },
    game: gameEl,
    text: () => shText(gameEl()),
    find: (pred) => shFind(gameEl(), pred),
    tapIn: async (pred) => { shTap(shFind(gameEl(), (n) => n.tag === 'button' && shShown(n) && pred(n))[0]); await shSettle(); await render(); },
    chip: () => shFind(screen.el, (n) => n.cls.has('seat-chip'))[0],
    home: () => shFind(screen.el, (n) => n.cls.has('seat-home'))[0],
    menu: () => shFind(shDoc.body, (n) => n.cls.has('menu-sheet')).at(-1) ?? null,
    destroy: () => screen.destroy(),
  };
}

test('9upper, one phone through the real play screen: public cards for the 諗樣, a private gate per reader (睇卡 k/n), ✅ 講完, 換人 holds, and one table tap after the reveal in the middle', async () => {
  await withShell(async (dom) => {
    const { mount } = await import('../js/games/9upper/ui.js?v=1');
    const sim = new Sim(game, { n: 4, seed: 3, banks, config: config.defaults(4, undefined, { singleDevice: true }) });
    const ph = await onePhoneShell(dom, sim, mount);
    const name = (pid) => sim.players.find((p) => p.id === pid).name;
    const judge = J(sim);
    // term: the 諗樣's public card — the table watches, nobody is told to look away
    assert.equal(ph.gate(), 'public');
    assert.ok(ph.gateText().includes(`輪到 ${name(judge)}`) && ph.gateText().includes('睇題目') && !ph.gateText().includes('其他人唔好望'), ph.gateText());
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, judge);
    await ph.tapIn((n) => n.textContent.includes('開始睇卡'));
    // read: one private gate per reader, saying how far round the table it is
    const readers = sim.state.round.readers.slice();
    for (const [i, r] of readers.entries()) {
      assert.equal(ph.gate(), 'private', `reader ${i + 1}`);
      assert.ok(ph.gateText().includes(`交俾 ${name(r)}`) && ph.gateText().includes(`睇卡 ${i + 1}/${readers.length}`), ph.gateText());
      await ph.tapGate();
      assert.equal(ph.st.activeSeat, r);
      await ph.tapIn((n) => n.textContent.startsWith('開始睇卡'));
      sim.advance();   // the window closes by the clock
      await ph.render();
    }
    // explain: back to the 諗樣, again a public card
    assert.equal(sim.state.phase, 'explain');
    assert.equal(ph.gate(), 'public');
    assert.ok(ph.gateText().includes('解釋'), ph.gateText());
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, judge);
    const first = sim.state.round.speaker;
    await ph.tapIn((n) => n.textContent === '✅ 講完 · 下一位');
    assert.ok(sim.state.round.spoken.includes(first) && !sim.state.round.skipped.includes(first), '#11: ✅ 已講, not ⏭');
    // #9: 換人 to a 玩家 — they keep the phone (their role card), no auto gate bounces it back to the 諗樣
    const player = sim.state.round.explainers.find((p) => p !== sim.state.round.speaker);
    shTap(ph.chip());
    shTap(shFind(ph.menu(), (n) => n.tag === 'button' && n.textContent.includes(name(player)))[0]);
    await ph.render();
    assert.equal(ph.gate(), 'switch');
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, player);
    assert.equal(ph.gate(), null, 'not bounced back');
    assert.ok(ph.text().includes('㩒住睇返我係咩'), 'the role reminder is reachable');
    // back to the middle, and the 諗樣 is called again with the public card
    shTap(ph.home());
    await ph.render();
    assert.equal(ph.gate(), 'table');
    await ph.tapGate();
    assert.equal(ph.gate(), 'public');
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, judge);
    await ph.tapIn((n) => n.textContent.includes('我決定咗'));
    const target = sim.state.round.explainers[0];
    await ph.tapIn((n) => n.cls.has('c-playerpicker-chip') && n.textContent.includes(name(target)));
    await ph.tapIn((n) => n.textContent === '就係佢！');
    // the reveal lies in the middle behind the table card; one tap for the whole table, never before the card
    assert.equal(sim.state.phase, 'reveal');
    assert.equal(ph.gate(), 'table');
    assert.equal(ph.st.activeSeat, null);
    const tableBtn = () => ph.find((n) => n.cls.has('g9-tablenext'))[0];
    assert.ok(tableBtn() && tableBtn().disabled, 'locked while the 擺返中間 card is up (U5)');
    assert.ok(ph.text().includes('老實人係'), 'the reveal is the table screen');
    assert.ok(!ph.text().includes('（你）'));
    await ph.tapGate();
    assert.equal(tableBtn().disabled, false);
    await ph.tapIn((n) => n.cls.has('g9-tablenext'));
    assert.deepEqual(ph.acts.at(-1).action, { type: 'next', seats: sim.players.map((p) => p.id), table: true });
    assert.equal(sim.state.round.n, 2, 'the next round');
    assert.equal(ph.gate(), 'public', 'the next 諗樣 gets their card');
    assert.ok(ph.gateText().includes(name(J(sim))));
    ph.destroy();
  });
});

// ---------- one-phone re-run #2 (docs/playtest/single/9upper-rerun.md) ----------

test('9upper: one phone — re-run #2 N1: 代佢做 on an absent 諗樣 never plays a ghost round: the round is void, the seat moves on (turn kept to the end of the lap, once)', () => {
  for (const at of ['level', 'term', 'explain', 'judge']) {
    const sim = mkOne(4, 11, at === 'level' ? { levelMode: 'judge' } : {});
    const judge = J(sim);
    const total = sim.state.totalRounds;
    if (at === 'explain') toExplain(sim);
    if (at === 'judge') toJudge(sim);
    assert.equal(phase(sim), at);
    const a = engine.autoAct(sim.state, judge, sim.ctx());
    assert.deepEqual(a, { type: 'step-down' }, at);
    assert.equal(sim.act(judge, a), true);
    assert.notEqual(J(sim), judge, `${at}: the next seat judges`);
    assert.ok(['term', 'level'].includes(phase(sim)), `${at}: a fresh deal`);
    assert.equal(sim.state.history.length, 0, 'nobody scored for a round nobody judged');
    assert.equal(sim.state.totalRounds, total, `${at}: their turn moved to the end of the lap, not lost`);
    assert.ok(sim.state.judges.slice(sim.state.roundNo).includes(judge), 'still to judge later in the lap');
    assert.equal(sim.state.voids.at(-1).how, 'stuck');
    const cue = sim.cue().text;
    assert.ok(cue.startsWith(`呢輪重新嚟過：${nameOf(sim, judge)}遲啲先做諗樣，而家由${nameOf(sim, J(sim))}做。`), cue);
  }
  // the second time in the same lap the turn is lost, and the game says how many rounds are left
  const sim = mkOne(4, 12);
  const judge = J(sim);
  sim.act(judge, { type: 'step-down' });
  while (J(sim) !== judge) sim.act(J(sim), { type: 'step-down' });
  const before = sim.state.totalRounds;
  sim.act(judge, { type: 'step-down' });
  assert.equal(sim.state.totalRounds, before - 1);
  // never with phones of their own (unchanged), never for a 玩家, never in the read / reveal
  const own = mk(4, 11);
  assert.deepEqual(engine.autoAct(own.state, J(own), own.ctx()), { type: 'start' });
  assert.equal(own.act(J(own), { type: 'step-down' }), false, 'phones of their own: a 諗樣 cannot step down');
  const one = mkOne(4, 13);
  const p = one.state.round.explainers[0];
  assert.equal(one.act(p, { type: 'step-down' }), false, 'only the 諗樣');
  toRead(one);
  assert.equal(one.act(J(one), { type: 'step-down' }), false, 'not in the read');
  assert.ok(!one.legal(J(one)).some((x) => x.type === 'step-down'), 'not a player choice: only 代佢做 sends it');
});

test('9upper: one phone — re-run #2 N2: 代佢做 on a reader never runs a look with nobody at the phone; offered again at the end, then the round is dealt again whoever they were', () => {
  const sim = mkOne(5, 14);
  toRead(sim);
  const readers = sim.state.round.readers.slice();
  const judge = J(sim);
  const gone = sim.state.round.reader;
  assert.equal(gone, readers[0]);
  const a = engine.autoAct(sim.state, gone, sim.ctx());
  assert.deepEqual(a, { type: 'later' });
  assert.equal(sim.act(gone, a), true);
  assert.equal(sim.state.round.readStarted, false, 'no window runs behind the gate');
  assert.equal(sim.state.deadline, null);
  assert.equal(sim.state.round.reader, readers[1], 'the next reader is called');
  assert.equal(sim.focus().label, '睇卡 1/4', 'the gate counts looks taken');
  for (const pid of readers.slice(1)) {
    assert.equal(sim.state.round.reader, pid);
    sim.act(pid, { type: 'peek' });
    sim.advance();
  }
  assert.equal(phase(sim), 'read', 'their look is offered again before anybody explains');
  assert.equal(sim.state.round.reader, gone);
  assert.equal(sim.focus().label, '睇卡 4/4');
  // back now: they read like everybody else
  const back = clone(sim.state);
  sim.act(gone, { type: 'peek' });
  sim.advance();
  assert.equal(phase(sim), 'explain');
  assert.ok(sim.state.round.readDone.includes(gone));
  // still not there: the second 代佢做 deals the round again — same 諗樣, nobody loses a turn, the table is told
  sim.state = back;
  const key = sim.state.round.key;
  assert.equal(sim.act(gone, engine.autoAct(sim.state, gone, sim.ctx())), true);
  assert.equal(phase(sim), 'term');
  assert.equal(J(sim), judge);
  assert.notEqual(sim.state.round.key, key, 'fresh cue ids');
  assert.ok(sim.state.round.explainers.includes(gone), 'not marked away: dealt in again (💤 is the host\'s call)');
  assert.deepEqual(sim.view(null).redo, { how: 'unread', judge, kept: false, pid: gone });
  const nm = (p) => nameOf(sim, p);
  assert.ok(S.redoLine(sim.view(null).redo, nm, judge).includes(`${nm(gone)} 冇睇到張卡`));
  assert.ok(sim.cue().text.startsWith(`${nm(gone)}冇睇到張卡，呢輪重新派過`), sim.cue().text);
  assert.ok(S.voidLine(sim.state.voids.at(-1), nm).includes('冇睇到張卡'));
  // the same thing whether or not the one who never looked was the 老實人 (nothing leaks)
  for (let seed = 20; seed < 40; seed++) {
    const t = mkOne(4, seed);
    toRead(t);
    const r0 = t.state.round.reader;
    t.act(r0, { type: 'later' });
    while (t.state.round.reader !== r0) { t.act(t.state.round.reader, { type: 'peek' }); t.advance(); }
    t.act(r0, { type: 'later' });
    assert.equal(phase(t), 'term', `seed ${seed}`);
    assert.equal(t.state.voids.at(-1).how, 'unread');
  }
  // phones of their own and the together read: unchanged
  const own = mk(4, 14, { passPhone: true });
  toRead(own);
  assert.deepEqual(engine.autoAct(own.state, own.state.round.reader, own.ctx()), { type: 'later' }, 'passPhone means one phone goes round');
  const tog = mk(4, 14);
  toRead(tog);
  assert.equal(engine.autoAct(tog.state, tog.state.round.explainers[0], tog.ctx()), null);
});

test('9upper: one phone — re-run #2 N3: 💤 on the 諗樣 says aloud that the round starts again and how many rounds are left', () => {
  const sim = mkOne(4, 15);
  toExplain(sim);
  const gone = J(sim);
  sim.host(ABSENT(gone));
  const next = J(sim);
  const cue = sim.cue().text;
  assert.ok(cue.startsWith(`${nameOf(sim, gone)}唔喺度，呢輪重新嚟過，由${nameOf(sim, next)}做諗樣，一共 ${sim.state.totalRounds} 輪。題目係「`), cue);
  assert.ok(!cue.includes('第 1 輪，'), 'the 諗樣 is named once');
  // a normal round: unchanged opening
  const plain = mkOne(4, 15);
  assert.ok(plain.cue().text.startsWith(`第 1 輪，${nameOf(plain, J(plain))}做諗樣。題目係「`), plain.cue().text);
  // 揀難度 mode: the level cue carries it
  const lv = mkOne(4, 16, { levelMode: 'judge' });
  const g2 = J(lv);
  lv.host(ABSENT(g2));
  assert.ok(lv.cue().text.startsWith(`${nameOf(lv, g2)}唔喺度，呢輪重新嚟過`), lv.cue().text);
  // N7: after 換題 only the new term and the question
  const sw = mkOne(4, 17);
  sw.act(J(sw), { type: 'swap' });
  const t = sw.cue().text;
  assert.ok(t.startsWith('換咗題：「') && !t.includes('做諗樣') && t.includes('仲有冇人識'), t);
});

test('9upper: one phone — re-run #2 N4: 👉 叫佢講 keeps ✅ for a speaker who had the floor, and a ✅ player can be called again', () => {
  const sim = mkOne(5, 18, { speakOrder: 'judge' });
  toExplain(sim);
  const judge = J(sim);
  const r = () => sim.state.round;
  const first = r().speaker;
  const ex = r().explainers;
  const second = ex.find((p) => p !== first);
  // called away at once (only "up" by the queue): back to waiting, as before
  sim.tick(1000);
  assert.equal(sim.act(judge, { type: 'call', target: second }), true);
  assert.ok(!r().spoken.includes(first), 'never spoke: no ✅');
  // had the floor: the 諗樣 calls the next one by name → ✅ 已講
  sim.tick(20000);
  const third = ex.find((p) => p !== first && p !== second);
  assert.equal(sim.act(judge, { type: 'call', target: third }), true);
  assert.ok(r().spoken.includes(second) && !r().skipped.includes(second), 'spoke: ✅ 已講');
  assert.equal(sim.view(null).turn.pid, third);
  // a follow-up question to a ✅ player keeps the ✅
  sim.tick(20000);
  assert.equal(sim.act(judge, { type: 'call', target: second }), true);
  assert.ok(r().spoken.includes(second) && r().spoken.includes(third));
  assert.ok(sim.legal(judge).some((a) => a.type === 'call' && a.target === third), 'a ✅ player is callable on one phone');
  // phones of their own: unchanged
  const own = mk(5, 18, { speakOrder: 'judge' });
  toExplain(own);
  const f = own.state.round.speaker;
  const s2 = own.state.round.explainers.find((p) => p !== f);
  own.tick(20000);
  own.act(J(own), { type: 'call', target: s2 });
  assert.ok(!own.state.round.spoken.includes(f), 'phones of their own: the speaker taps 我講完 themselves');
});

test('9upper: one phone — re-run #2 N8: the reveal hint says anybody taps 下一輪', () => {
  const sim = mkOne(4, 19);
  toJudge(sim);
  sim.act(J(sim), { type: 'pick', target: sim.state.round.explainers[0] });
  for (const pid of [null, sim.state.round.explainers[1]]) {
    assert.ok(sim.view(pid).hint.includes('任何一個㩒'), sim.view(pid).hint);
  }
  const own = mk(4, 19);
  toJudge(own);
  own.act(J(own), { type: 'pick', target: own.state.round.explainers[0] });
  assert.ok(own.view(null).hint.includes('等諗樣繼續'), 'phones of their own: unchanged');
});

test('9upper: UI on one phone — re-run #2: ✅ rows stay callable, spent 收皮啦 chips go, and the 老實人\'s card only says 「你睇過」 when the card was opened (N4, N5, N6)', async () => {
  const dom = installDom();
  const mounted = [];
  try {
    const { mount } = await import('../js/games/9upper/ui.js');
    const covers = [];
    const onPhone = (sim, pid, { shared = true } = {}) => {
      const root = new dom.FakeNode('div');
      const sent = [];
      const fc = fakeComponents(dom.FakeNode);
      const Cover0 = fc.components.Cover;
      fc.components.Cover = (props) => { const c = Cover0(props); covers.push({ pid, props }); return c; };
      const ui = mount(root, {
        me: pid, players: sim.players, isHost: true, send: (a) => sent.push(a), sfx() {}, toast() {},
        now: () => sim.now, components: fc.components, meta, config: sim.config,
        shared, wholeTable: shared, atTable: shared && pid === null, mySeats: shared ? sim.players.map((p) => p.id) : [pid],
        tableSend: () => Promise.resolve(true),
      });
      mounted.push(ui);
      return { root, sent, ui, show(ctx = {}) { ui.update(sim.view(pid), { shared, ...ctx }); return root.visibleText(); } };
    };
    const faceText = (root) => root.all().find((n) => n.className === 'g9-face-text')?.textContent ?? '';

    // N4: on one phone a ✅ player is a 「再問佢」 button for the 諗樣
    const sim = mkOne(5, 21, { speakOrder: 'judge', callouts: 1 });
    toExplain(sim);
    const done = sim.state.round.speaker;
    sim.act(J(sim), { type: 'done', turn: 0 });
    const jd = onPhone(sim, J(sim));
    const t = jd.show();
    assert.ok(t.includes('✅ 已講 · 再問佢'), t);
    const again = buttons(jd.root).find((b) => b.textContent.includes('再問佢'));
    again.click();
    assert.deepEqual(jd.sent.pop(), { type: 'call', target: done });
    assert.equal(sim.act(J(sim), { type: 'call', target: done }), true);
    // N6: once the 收皮啦 card is used the chips go
    sim.act(J(sim), { type: 'callout', target: done });
    const jd2 = onPhone(sim, J(sim));
    const t2 = jd2.show();
    assert.ok(t2.includes('🛑 收皮啦 · 用晒'), t2);
    assert.equal(jd2.root.all().find((n) => n.className === 'g9-callrow-chips').hidden, true, 'no disabled chips left on screen');

    // N5: the 老實人 on a shared phone — the record survives the remount at every hand-over
    const told = (seed, open) => {
      const s = mkOne(4, seed);
      toRead(s);
      const H = s.state.round.honest;
      while (s.state.round.reader !== H) { s.act(s.state.round.reader, { type: 'peek' }); s.advance(); }
      const reader = onPhone(s, H);
      reader.show();
      s.act(H, { type: 'peek' });
      reader.show();
      if (open) covers.filter((c) => c.pid === H).at(-1).props.onOpen(true);
      s.advance();
      if (phase(s) === 'read') finishRead(s);
      reader.ui.destroy();
      const later = onPhone(s, H);   // the 老實人 takes the phone back later: a fresh mount
      later.show();
      return faceText(later.root);
    };
    assert.ok(told(31, true).includes('你睇過真正解釋喇'), 'opened: it says so, even after the remount');
    const missed = told(32, false);
    assert.ok(missed.includes('你冇打開到張卡') && !missed.includes('你睇過'), missed);
    // a shared phone that never watched the look (a reload, or a look nobody took) does not claim a read
    const s = mkOne(4, 33);
    toExplain(s);
    const cold = onPhone(s, s.state.round.honest);
    cold.show();
    const cf = faceText(cold.root);
    assert.ok(!cf.includes('你睇過') && cf.includes('張卡冇寫'), cf);
    // a phone of your own: unchanged (the usual line)
    const ownSim = mk(4, 33);
    toExplain(ownSim);
    const own = onPhone(ownSim, ownSim.state.round.honest, { shared: false });
    own.show();
    assert.ok(faceText(own.root).includes('你睇過真正解釋喇'));
  } finally {
    for (const ui of mounted) ui.destroy();
    dom.restore();
  }
});
