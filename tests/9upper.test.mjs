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

test('9upper: config.defaults is valid for every head-count; laps follow the official table', () => {
  const rounds = { 3: 9, 4: 12, 5: 10, 6: 12, 7: 14, 8: 8, 9: 9 };
  for (let n = 3; n <= 9; n++) {
    const cfg = config.defaults(n);
    const v = config.validate(cfg, n);
    assert.ok(v.ok, `n=${n}: ${v.message}`);
    assert.deepEqual(v.warnings, [], `n=${n}: the recommended setup warns ${v.warnings}`);
    const sim = mk(n);
    assert.equal(sim.state.totalRounds, rounds[n], `n=${n}`);
    assert.equal(sim.state.cfg.laps, game.lapsFor(n));
    assert.ok(config.summary(cfg, n)[1].includes(`共 ${rounds[n]} 輪`));
    assert.ok(config.fields(cfg, n).length >= 6);
  }
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
  assert.deepEqual(sel.options.map((o) => o.value), ['official', 'newbie', 'quick', 'custom']);
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
  assert.equal(fresh.preset, 'official');
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
    assert.deepEqual(config.validate({ ...base, speakOrder, speakSecs: 0 }, 5, { singleDevice: true }).warnings, [], speakOrder);
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
  assert.deepEqual(sim.view(null).turn, { pid: ex[0], spoken: [], total: 4 });
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
  assert.ok(config.validate({ ...config.defaults(5), speakOrder: 'system' }, 5, { singleDevice: true }).ok);
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
  assert.deepEqual(sim.view(null).turn, { pid: ex[0], spoken: [], total: 4 });
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
  assert.deepEqual(sim.legal(ex[3]), [{ type: 'done' }]);
  assert.deepEqual(sim.legal(ex[0]), []);
  assert.equal(sim.act(ex[3], { type: 'done' }), true);
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
  assert.deepEqual(engine.autoAct(sim.state, ex[1], sim.ctx()), { type: 'done' });
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
  sim.act(J(sim), { type: 'done' });
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
  assert.deepEqual(sim.view(null).turn, { pid: null, spoken: [], total: 4 });
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
  assert.deepEqual(engine.autoAct(sim.state, ex[1], sim.ctx()), { type: 'done' });
  assert.deepEqual(engine.autoAct(sim.state, judge, sim.ctx()), { type: 'done', target: ex[0] });
  assert.deepEqual(sim.focus(), { pids: [judge] });
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
  sim.host({ type: ACT.NEXT });
  assert.equal(phase(sim), 'judge');
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
  assert.deepEqual(sim.focus(), { pids: [judge] });                    // level
  sim.act(judge, { type: 'level', level: 2 });
  assert.deepEqual(sim.focus(), { pids: [judge] });                    // term
  sim.act(judge, { type: 'start' });
  assert.deepEqual(sim.focus().pids, ex);                              // read (together): every 玩家
  sim.advance();
  assert.deepEqual(sim.focus(), { pids: [judge] });                    // explain
  sim.act(judge, { type: 'decide' });
  assert.deepEqual(sim.focus(), { pids: [judge] });                    // judge
  sim.act(judge, { type: 'pick', target: ex[0] });
  assert.deepEqual(sim.focus(), { pids: [judge] });                    // reveal
  assert.equal(sim.focus().anonymous, undefined);
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
    const holdsCard = p !== null && p !== r.judge && (s.phase === 'explain' || s.phase === 'judge'
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
    assert.deepEqual(Object.keys(v.round), ['n', 'total']);
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
    buttons(judge.root).find((b) => b.className.includes('g9-chip') && b.textContent.includes('再㩒')).click();
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
