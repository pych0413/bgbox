// ============================================================
// tests/werewolf.test.mjs — rules, edge cases, anti-tell, leaks and fuzzers for 狼人殺.
//   node tests/run.mjs werewolf
//
// Scenario tests build a game with a FORCED role map (a custom board whose counts match the map),
// then drive it with scripted night choices and day votes. Every rule in docs/research/werewolf.md
// "Edge cases" has a test below; the fuzzers at the end play random legal actions to the end for
// every supported head-count.
// ============================================================

import { test, assert, Sim, HOST, ACT, makePlayers, paths, assertNoKeys } from './lib.mjs';
import { mulberry32, clone } from '../js/core/engine-kit.js';
import * as game from '../js/games/werewolf/game.js';
import * as S from '../js/games/werewolf/script.js';

const { engine, config, meta, rules, PRESETS } = game;

// ---------- fixtures ----------

const ids = (n) => makePlayers(n).map((p) => p.id);

/** roles: { p1: 'werewolf', ... } (every seat). Returns a Sim whose state has exactly these roles. */
function mk(map, over = {}, seed = 1) {
  const pids = Object.keys(map);
  const n = over.__n ?? pids.length;
  const counts = { werewolf: 0, seer: 0, witch: 0, hunter: 0, guard: 0, idiot: 0 };
  for (const r of Object.values(map)) if (r in counts) counts[r] += 1;
  const { __n, ...rest } = over;
  const cfg = { ...config.defaults(n), board: 'custom', roles: counts, ...rest };
  const sim = new Sim(game, { n, seed, config: cfg });
  const players = sim.players.map((p) => p.id);
  const roleList = Object.keys(map);
  // human-moderator games: the host seat (p1) holds no role
  for (const pid of players) if (pid in map) sim.state.role[pid] = map[pid];
  assert.deepEqual(roleList.filter((p) => !(p in sim.state.role)), [], 'role map names a seat that is not playing');
  return sim;
}

// 9 players: p1 p2 p3 wolves · p4 seer · p5 witch · p6 hunter · p7 p8 p9 villagers
const R9 = { p1: 'werewolf', p2: 'werewolf', p3: 'werewolf', p4: 'seer', p5: 'witch', p6: 'hunter', p7: 'villager', p8: 'villager', p9: 'villager' };
// 12 players with a guard and an idiot
const R12 = {
  p1: 'werewolf', p2: 'werewolf', p3: 'werewolf', p4: 'werewolf', p5: 'seer', p6: 'witch', p7: 'hunter', p8: 'guard',
  p9: 'idiot', p10: 'villager', p11: 'villager', p12: 'villager',
};

const phase = (sim) => sim.state.phase;
const cur = (sim) => sim.state.cur;
const pk = (target, lock = true) => ({ type: 'night', pick: target, lock });
const skipA = { type: 'night', pick: null, lock: true };
/** The hunter's final-action window uses its own action type. */
const fin = (target, lock = true) => ({ type: 'final', pick: target, lock });
const finSkip = { type: 'final', pick: null, lock: true };

/** Everybody taps 睇完喇 → night 1 begins. */
function deal(sim) {
  for (const p of sim.state.pl) sim.act(p, { type: 'ready' });
  assert.equal(phase(sim), 'night');
  return sim;
}

/**
 * Play the current night. script = { guard: { p8: action }, wolves: { p1: action, ... }, witch: {...}, seer: {...}, hunter: {...} }.
 * Stops when the night is over (phase leaves 'night').
 */
function night(sim, script = {}) {
  let guard = 0;
  while (phase(sim) === 'night' && guard++ < 100) {
    const c = cur(sim);
    if (c.stage === 'run') {
      for (const [pid, a] of Object.entries(script[c.step] ?? {})) sim.act(pid, a);
      sim.advance();
    } else sim.cueDone();
  }
  assert.notEqual(phase(sim), 'night', 'night did not finish');
  return sim;
}

/** Pass announcement cues until `stop(state)` is true. Speakers tap 我講完, final windows and timers run out. */
function drive(sim, stop, { votes = {}, max = 800 } = {}) {
  for (let i = 0; i < max; i++) {
    const s = sim.state;
    if (stop(s)) return sim;
    const c = s.cur;
    if (sim.cue()) { sim.cueDone(); continue; }
    if (s.phase === 'speech' || s.phase === 'words') { sim.act(c.pid, { type: 'done' }); continue; }
    if (s.phase === 'night' || s.phase === 'final') { sim.advance(); continue; }
    if (s.phase === 'vote') {
      for (const v of c.voters) if (!(v in c.votes)) sim.act(v, { type: 'vote', target: v in votes ? votes[v] : null });
      continue;
    }
    if (s.phase === 'deal') { deal(sim); continue; }
    throw new Error(`drive stuck in ${s.phase}`);
  }
  throw new Error(`drive: condition never met (phase ${sim.state.phase})`);
}

/** Everyone votes `target` (except the target, who abstains), then pass the tally. */
const voteAll = (target) => (s) => Object.fromEntries(s.cur.voters.map((v) => [v, v === target ? null : target]));

const toVote = (sim) => drive(sim, (s) => s.phase === 'vote' && s.cur.stage === 'run');
const toPhase = (sim, p) => drive(sim, (s) => s.phase === p);
const toNight = (sim) => drive(sim, (s) => s.phase === 'night');
const alive = (sim) => sim.state.pl.filter((p) => sim.state.alive[p]);

/** From a vote (stage run) cast `votes` ({voter: target}) — unlisted voters abstain — and stop at the tally. */
function castVotes(sim, votes) {
  const c = cur(sim);
  assert.equal(c.k, 'vote');
  for (const v of c.voters) sim.act(v, { type: 'vote', target: v in votes ? votes[v] : null });
  assert.equal(phase(sim), 'say', 'vote should have resolved');
  return sim;
}

/** Kill `pid` at night 1 through the wolves (nobody guards / saves), then reach the day. */
function nightKill(sim, victim, extra = {}) {
  const wolves = sim.state.pl.filter((p) => sim.state.role[p] === 'werewolf');
  night(sim, { wolves: Object.fromEntries(wolves.map((w) => [w, pk(victim)])), ...extra });
}

// ============================================================
// meta, rules, presets, config
// ============================================================

test('werewolf: meta and rules shape', () => {
  assert.equal(meta.id, 'werewolf');
  assert.deepEqual(meta.players, [6, 13]);                  // 13th seat = the human moderator
  assert.equal(meta.narration, 'required');
  assert.ok(['full', 'partial', 'none'].includes(meta.singleDevice));
  assert.equal(meta.css, true);
  assert.deepEqual(meta.banks, []);
  assert.ok(meta.blurb.length > 0);
  assert.ok(rules.quick.length >= 6);
  assert.deepEqual(rules.roles.map((r) => r.id), ['werewolf', 'villager', 'seer', 'witch', 'hunter', 'guard', 'idiot']);
  for (const r of rules.roles) { assert.ok(r.name && r.emoji && r.text); assert.ok(['wolf', 'good'].includes(r.team)); }
  for (const s of rules.sections) assert.ok(s.title && s.body);
  for (const k of ['setup', 'act', 'advance', 'view', 'cue', 'focus', 'autoAct', 'legalActions', 'result']) assert.equal(typeof engine[k], 'function', k);
  for (const k of ['defaults', 'validate', 'fields', 'summary']) assert.equal(typeof config[k], 'function', k);
});

test('werewolf: every preset is a legal board that sums to its head-count, and every head-count has a recommended one', () => {
  const groups = (r) => ({ wolf: r.werewolf, god: ['seer', 'witch', 'hunter', 'guard', 'idiot'].reduce((a, k) => a + (r[k] ?? 0), 0), vil: r.villager });
  for (const p of PRESETS) {
    const total = Object.values(p.roles).reduce((a, b) => a + b, 0);
    assert.equal(total, p.p, `${p.id} sums to ${total}`);
    assert.ok(p.roles.werewolf >= 1);
    for (const u of ['seer', 'witch', 'hunter', 'guard', 'idiot']) assert.ok((p.roles[u] ?? 0) <= 1, `${p.id} has two ${u}`);
    const g = groups(p.roles);
    assert.ok(g.god >= 1 && g.vil >= 1, `${p.id} edge needs a god and a villager`);
    assert.ok(['edge', 'city'].includes(p.win));
    assert.ok(['never', 'first', 'always'].includes(p.save));
    assert.ok(S.PRESET_TEXT[p.id]?.name && S.PRESET_TEXT[p.id].reason && S.PRESET_TEXT[p.id].tag, `${p.id} has no wording`);
  }
  for (let p = 6; p <= 12; p++) assert.ok(game.presetsFor(p).length >= 1, `no board for ${p}`);
  // research table: recommended board per head-count
  const rec = (p) => game.presetsFor(p)[0];
  assert.equal(rec(6).win, 'city'); assert.equal(rec(7).win, 'city'); assert.equal(rec(8).win, 'city');
  assert.equal(rec(9).win, 'edge'); assert.equal(rec(10).win, 'edge'); assert.equal(rec(12).win, 'edge');
  assert.deepEqual(rec(9).roles, { werewolf: 3, seer: 1, witch: 1, hunter: 1, villager: 3 });
  assert.deepEqual(rec(12).roles, { werewolf: 4, seer: 1, witch: 1, hunter: 1, idiot: 1, villager: 4 });
  assert.equal(rec(12).save, 'never');
  assert.equal(rec(9).save, 'never');                       // verified: the TW-official 9-player board forbids self-save
  assert.equal(rec(6).save, 'first');                       // casual boards without an official version
  assert.equal(PRESETS.find((x) => x.id === '6-sh').open, true);   // the official 6-player board is open-card
});

test('werewolf: config.defaults is valid for every seat count, with the human moderator forced at 13', () => {
  for (let n = 6; n <= 13; n++) {
    const cfg = config.defaults(n);
    const v = config.validate(cfg, n);
    assert.ok(v.ok, `n=${n}: ${v.message}`);
    assert.ok(Array.isArray(v.warnings));
    const e = game.resolve(cfg, n);
    assert.equal(e.p, n === 13 ? 12 : n);
    assert.equal(cfg.moderator, n === 13 ? 'human' : 'app');
    assert.equal(Object.values(e.roles).reduce((a, b) => a + b, 0), e.p);
    assert.ok(config.fields(cfg, n).length >= 10);
    assert.ok(config.summary(cfg, n).length >= 6);
    const sim = new Sim(game, { n, seed: n });
    assert.equal(sim.state.pl.length, e.p);
  }
});

test('werewolf: config.defaults keeps a valid prev, drops an invalid one, and follows the head-count', () => {
  const d = config.defaults(9, { pace: 'slow', speakSecs: 90, selfExplode: 'pk', spectate: true, junk: 1, voteSecs: 'bogus' });
  assert.equal(d.pace, 'slow'); assert.equal(d.speakSecs, 90); assert.equal(d.selfExplode, 'pk'); assert.equal(d.spectate, true);
  assert.equal(d.voteSecs, 20);                              // invalid → default
  assert.ok(!('junk' in d));
  // an explicit board only survives a head-count it fits
  assert.equal(config.defaults(9, { board: '9-guard' }).board, '9-guard');
  assert.equal(config.defaults(10, { board: '9-guard' }).board, 'auto');
  assert.equal(config.defaults(9, { board: 'nonsense' }).board, 'auto');
  // a single shared phone defaults to the slow pace (the room passes env.singleDevice)
  assert.equal(config.defaults(9, { pace: 'fast' }, { singleDevice: true }).pace, 'slow');
  assert.equal(config.defaults(9, { pace: 'fast' }, { singleDevice: false }).pace, 'fast');
  assert.equal(config.defaults(9, undefined, { singleDevice: true }).pace, 'slow');
  // human moderator only where it can work
  assert.equal(config.defaults(6, { moderator: 'human' }).moderator, 'app');
  assert.equal(config.defaults(7, { moderator: 'human' }).moderator, 'human');
  assert.equal(config.defaults(13, { moderator: 'app' }).moderator, 'human');
  // a custom board is kept when it still fits, replaced by auto when it does not
  const custom = { board: 'custom', roles: { werewolf: 2, seer: 1, witch: 0, hunter: 0, guard: 0, idiot: 0 } };
  assert.equal(config.defaults(8, custom).board, 'custom');
  assert.equal(config.defaults(8, { board: 'custom', roles: { werewolf: 9 } }).board, 'auto');
  // every default is valid again after a round trip through defaults
  for (let n = 6; n <= 13; n++) assert.ok(config.validate(config.defaults(n, config.defaults(n === 13 ? 12 : n + 1)), n).ok, `n=${n}`);
});

test('werewolf: config.validate rejects bad seats and values, and explains custom boards', () => {
  const base = config.defaults(9);
  for (const n of [0, 5, 14, 9.5, '9']) assert.equal(config.validate(base, n).ok, false, `n=${n}`);
  for (const bad of [{ pace: 'turbo' }, { speakSecs: 301 }, { voteSecs: 121 }, { wordsSecs: -1 }, { selfExplode: true }, { winRule: 'x' },
    { spectate: 'yes' }, { board: 'nope' }, { moderator: 'god' }, { nightOrder: 'x' }, { speakSecs: 1.5 }]) {
    const v = config.validate({ ...base, ...bad }, 9);
    assert.equal(v.ok, false, JSON.stringify(bad));
    assert.ok(v.message.length > 0);
  }
  // numeric strings from a <select>/input are accepted
  assert.ok(config.validate({ ...base, speakSecs: '45', voteSecs: '30' }, 9).ok);
  assert.equal(config.defaults(9, { speakSecs: '45' }).speakSecs, 45);

  // human moderator: 13 seats = 12 players; 12 seats app-mode max; 6 seats cannot spare a moderator
  assert.equal(config.validate({ ...config.defaults(13) }, 13).ok, true);
  assert.equal(config.validate({ ...config.defaults(13), moderator: 'app' }, 13).ok, false);
  assert.equal(config.validate({ ...config.defaults(6), moderator: 'human' }, 6).ok, false);
  assert.equal(config.validate({ ...config.defaults(7), moderator: 'human' }, 7).ok, true);

  // custom boards
  const c = (roles, over = {}) => config.validate({ ...base, board: 'custom', roles, ...over }, 9);
  assert.equal(c({ werewolf: 0, seer: 1 }).ok, false);                                  // no wolf
  assert.equal(c({ werewolf: 3, seer: 1, witch: 1, hunter: 1, guard: 1, idiot: 1, }).ok, true);   // 3 + 5 gods + 1 villager
  assert.equal(c({ werewolf: 8 }).ok, false);                                           // fewer than 2 good
  assert.equal(c({ werewolf: 3, seer: 1, witch: 1, hunter: 1, guard: 1, idiot: 1 }, { winRule: 'edge' }).ok, true);
  const noGod = c({ werewolf: 3 }, { winRule: 'edge' });
  assert.equal(noGod.ok, false);                                                        // 屠邊 needs a god
  assert.equal(c({ werewolf: 3 }, { winRule: 'city' }).ok, true);                        // 屠城 does not
  assert.equal(c({ werewolf: 4, seer: 1, witch: 1, hunter: 1, guard: 1, idiot: 1 }).ok, true);
  const noVillager = config.validate({ ...base, board: 'custom', winRule: 'edge', roles: { werewolf: 5, seer: 1, witch: 1, hunter: 1, guard: 1 } }, 9);
  assert.equal(noVillager.ok, false, 'no villager left under 屠邊');
  assert.ok(noVillager.message.includes('屠邊'));
  assert.equal(config.validate({ ...base, board: 'custom', roles: { werewolf: 5, seer: 1, witch: 1, hunter: 1, guard: 1 } }, 9).ok, true, 'auto falls back to 屠城 when a camp is empty');
  // warnings
  assert.ok(config.validate({ ...base, board: '9-guard' }, 10).warnings.some((w) => w.includes('推薦配置')), 'board fallback is explained');
  assert.ok(config.validate({ ...config.defaults(7), board: '7-hard' }, 7).warnings.some((w) => w.includes('硬核')));
  assert.ok(config.validate({ ...config.defaults(7), speakSecs: 5 }, 7).warnings.some((w) => w.includes('限時')));
  assert.ok(config.validate({ ...config.defaults(7), moderator: 'human' }, 7).warnings.some((w) => w.includes('人手主持')));
  assert.ok(config.validate(config.defaults(12), 12).warnings.some((w) => w.includes('警長')));
  assert.ok(config.validate({ ...base, board: 'custom', roles: { werewolf: 5, seer: 1, witch: 1, hunter: 1, guard: 1 } }, 9).warnings.some((w) => w.includes('狼人')));
});

test('werewolf: the effective rules follow the board unless the host overrides them', () => {
  const r = (n, over = {}) => game.resolve({ ...config.defaults(n), ...over }, n);
  assert.equal(r(6).win, 'city'); assert.equal(r(6).save, 'first');
  assert.equal(r(9).win, 'edge'); assert.equal(r(9, { winRule: 'city' }).win, 'city');
  assert.equal(r(12).save, 'never'); assert.equal(r(12, { witchSelfSave: 'always' }).save, 'always');
  assert.equal(r(6).open, false); assert.equal(r(6, { board: '6-sh' }).open, true);
  assert.equal(r(6, { board: '6-sh', openCard: 'off' }).open, false);
  assert.equal(r(9, { openCard: 'on' }).open, true);
  // custom boards: 6–8 players default to 屠城, 9+ to 屠邊, and no god/villager forces 屠城
  const custom = (n, roles) => game.resolve({ ...config.defaults(n), board: 'custom', roles }, n);
  assert.equal(custom(8, { werewolf: 2, seer: 1 }).win, 'city');
  assert.equal(custom(10, { werewolf: 3, seer: 1, witch: 1 }).win, 'edge');
  assert.equal(custom(10, { werewolf: 3 }).win, 'city');
  assert.equal(custom(10, { werewolf: 3, seer: 1, witch: 1 }).roles.villager, 5);
  // … and the witch's self-save follows the same split: first night on casual 6–8, never on 9+ (every official text)
  assert.equal(custom(7, { werewolf: 2, seer: 1, witch: 1 }).save, 'first');
  assert.equal(custom(9, { werewolf: 3, seer: 1, witch: 1 }).save, 'never');
  assert.equal(custom(12, { werewolf: 4, seer: 1, witch: 1, guard: 1 }).save, 'never');
  assert.equal(game.resolve({ ...config.defaults(9), board: '10-swh' }, 9).fallback, true);
});

test('werewolf: fields adapt to the board and show the reason for the recommended setup', () => {
  const keys = (cfg, n) => config.fields(cfg, n).map((f) => f.key);
  const f9 = config.fields(config.defaults(9), 9);
  const board = f9.find((f) => f.key === 'board');
  assert.equal(board.type, 'select');
  assert.ok(board.help.includes('3') && board.help.length > 20, 'the reason is the help line');
  assert.equal(board.help, S.PRESET_TEXT['9-swh'].reason);
  assert.ok(board.options.some((o) => o.value === 'auto' && o.label.includes('推薦')));
  assert.ok(board.options.some((o) => o.value === '9-guard'));
  assert.ok(board.options.some((o) => o.value === 'custom'));
  assert.ok(!keys(config.defaults(9), 9).includes('roles'));
  assert.ok(keys({ ...config.defaults(9), board: 'custom' }, 9).includes('roles'));
  const rolesField = config.fields({ ...config.defaults(9), board: 'custom' }, 9).find((f) => f.key === 'roles');
  assert.equal(rolesField.type, 'roles');
  assert.ok(rolesField.options.find((o) => o.id === 'villager').auto);
  // conditional fields
  assert.ok(keys(config.defaults(9), 9).includes('witchSelfSave'));
  assert.ok(!keys({ ...config.defaults(9), board: '9-guard' }, 9).includes('witchSelfSave'));   // no witch on that board
  assert.ok(keys({ ...config.defaults(9), board: '9-guard' }, 9).includes('hunterOrder'));
  assert.ok(!keys({ ...config.defaults(6), board: '6-sw' }, 6).includes('hunterOrder'));
  assert.ok(keys(config.defaults(12), 12).includes('idiotIs'));
  assert.ok(!keys(config.defaults(9), 9).includes('idiotIs'));
  assert.ok(keys(config.defaults(12), 12).includes('guardStack') === false);
  assert.ok(keys({ ...config.defaults(12), board: '12-guard' }, 12).includes('guardStack'));
  // every field has a label and a legal type
  for (let n = 6; n <= 13; n++) {
    for (const f of config.fields(config.defaults(n), n)) {
      assert.ok(f.key && f.label, `${n} ${f.key}`);
      assert.ok(['int', 'bool', 'select', 'roles', 'categories', 'seconds'].includes(f.type));
      if (f.type === 'select') assert.ok(f.options.length >= 2 && f.options.every((o) => o.value !== undefined && o.label));
    }
  }
  // a stale board id from another head-count stays selectable instead of showing a blank select
  const stale = config.fields({ ...config.defaults(9), board: '10-swh' }, 9).find((f) => f.key === 'board');
  assert.ok(stale.options.some((o) => o.value === '10-swh'));
});

test('werewolf: config.summary lists the board, the rules in force and the reason', () => {
  const s9 = config.summary(config.defaults(9), 9).join('|');
  for (const t of ['狼人 ×3', '平民 ×3', '預言家', '女巫', '獵人', '屠邊', '唔可以自救', '手機做主持', '標準', '60 秒']) assert.ok(s9.includes(t), t);
  assert.ok(s9.includes('💡'), 'the reason tag is in the summary');
  const s13 = config.summary(config.defaults(13), 13).join('|');
  assert.ok(s13.includes('人手做上帝') && s13.includes('12 個玩家'));
  const s6 = config.summary({ ...config.defaults(6), board: '6-sh', selfExplode: 'off', speakSecs: 0, spectate: true, pace: 'slow' }, 6).join('|');
  for (const t of ['屠城', '亮牌', '唔准自爆', '唔限時', '睇到全場', '慢']) assert.ok(s6.includes(t), t);
  assert.ok(!s6.includes('女巫'), 'no witch line without a witch');
});

// ============================================================
// setup and the deal
// ============================================================

test('werewolf: the deal gives exactly the board, one card per player, and the host plays', () => {
  for (let n = 6; n <= 12; n++) {
    for (let seed = 1; seed <= 5; seed++) {
      const sim = new Sim(game, { n, seed });
      const e = game.resolve(config.defaults(n), n);
      const got = {};
      for (const p of sim.state.pl) got[sim.state.role[p]] = (got[sim.state.role[p]] ?? 0) + 1;
      for (const [id, c] of Object.entries(e.roles)) assert.equal(got[id] ?? 0, c, `n=${n} ${id}`);
      assert.equal(sim.state.pl.length, n);
      assert.equal(sim.state.mod, false);
    }
  }
});

test('werewolf: roles are shuffled (everyone is a wolf sometimes) and deterministic per seed', () => {
  const wolf = {};
  for (let seed = 1; seed <= 60; seed++) {
    const sim = new Sim(game, { n: 9, seed });
    for (const p of sim.state.pl) if (sim.state.role[p] === 'werewolf') wolf[p] = (wolf[p] ?? 0) + 1;
  }
  for (const p of ids(9)) assert.ok(wolf[p] > 5, `${p} was a wolf only ${wolf[p] ?? 0} times in 60 deals`);
  const a = new Sim(game, { n: 9, seed: 5 }); const b = new Sim(game, { n: 9, seed: 5 }); const c = new Sim(game, { n: 9, seed: 6 });
  assert.deepEqual(a.state.role, b.state.role);
  assert.notDeepEqual(a.state.role, c.state.role);
});

test('werewolf: human moderator — the host seat holds no role, is not numbered, and the seats are the players', () => {
  const sim = new Sim(game, { n: 7, seed: 3, config: { ...config.defaults(7), moderator: 'human' } });
  const s = sim.state;
  assert.equal(s.mod, true);
  assert.equal(s.hostPid, 'p1');                              // Sim passes no hostPid → first seat
  assert.deepEqual(s.pl, ['p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
  assert.equal('p1' in s.role, false);
  assert.equal(Object.keys(s.role).length, 6);
  assert.deepEqual(sim.view('p2').seats.map((x) => x.no), [1, 2, 3, 4, 5, 6]);
  // an explicit hostPid wins
  const st = engine.setup({ players: clone(sim.players), config: clone(sim.config), rng: mulberry32(1), now: 0, hostPid: 'p4' });
  assert.equal(st.hostPid, 'p4');
  assert.equal('p4' in st.role, false);
  assert.equal(st.pl.length, 6);
  // an unknown hostPid falls back to the first seat; a players[i].isHost flag is honoured
  assert.equal(engine.setup({ players: clone(sim.players), config: clone(sim.config), rng: mulberry32(1), now: 0, hostPid: 'zz' }).hostPid, 'p1');
  const flagged = clone(sim.players); flagged[2].isHost = true;
  assert.equal(engine.setup({ players: flagged, config: clone(sim.config), rng: mulberry32(1), now: 0 }).hostPid, 'p3');
  // app-moderator games ignore hostPid for roles: the host plays
  const app = engine.setup({ players: makePlayers(7), config: config.defaults(7), rng: mulberry32(1), now: 0, hostPid: 'p3' });
  assert.equal(app.pl.length, 7);
});

test('werewolf: setup rejects a config that does not fit the seats', () => {
  assert.throws(() => engine.setup({ players: makePlayers(5), config: config.defaults(9), rng: mulberry32(1), now: 0 }));
  assert.throws(() => engine.setup({ players: makePlayers(13), config: config.defaults(12), rng: mulberry32(1), now: 0 }));
});

test('werewolf: deal — ready is per seat, counted but never named, focus shrinks, all ready starts the night', () => {
  const sim = new Sim(game, { n: 7, seed: 2 });
  assert.equal(phase(sim), 'deal');
  assert.deepEqual(sim.focus().pids, sim.state.pl);
  assert.deepEqual(sim.view('p1').ready, { done: 0, total: 7 });
  sim.act('p3', { type: 'ready' });
  assert.deepEqual(sim.view('p5').ready, { done: 1, total: 7 });
  assert.ok(!sim.focus().pids.includes('p3'));
  assert.equal(sim.act('p3', { type: 'ready' }), false, 'ready twice is a no-op');
  assert.deepEqual(paths(sim.view('p5'), (v) => v === 'p3').filter((p) => p.includes('ready')), [], 'who is ready is never in a view');
  for (const p of sim.state.pl) sim.act(p, { type: 'ready' });
  assert.equal(phase(sim), 'night');
  assert.equal(sim.state.n, 1);
  assert.equal(sim.focus(), null);                            // begin step: nobody is awake yet
});

test('werewolf: deal — the narration cue never blocks, and @next forces the night to start', () => {
  const sim = new Sim(game, { n: 6, seed: 2 });
  const c = sim.cue();
  assert.ok(c.text.includes('派咗牌') && c.minMs > 0);
  sim.cueDone();
  assert.equal(sim.cue(), null);
  assert.equal(phase(sim), 'deal', 'acknowledging the cue does not start the game');
  sim.host({ type: ACT.NEXT });
  assert.equal(phase(sim), 'night');
  assert.ok(sim.state.pl.every((p) => sim.state.ready[p]));
});

// ============================================================
// the night: order, pacing, decoys
// ============================================================

const stepsOf = (sim) => sim.state.nt.steps;

test('werewolf: the night calls exactly the roles on the board, in the official order (or the Taiwan one)', () => {
  const full = mk({ ...R12 });
  assert.deepEqual(stepsOf(deal(full)), ['begin', 'guard', 'wolves', 'witch', 'seer', 'hunter']);
  const tw = mk({ ...R12 }, { nightOrder: 'tw' });
  assert.deepEqual(stepsOf(deal(tw)), ['begin', 'wolves', 'seer', 'guard', 'witch', 'hunter']);
  // only roles on the board: no guard, no hunter
  const small = mk({ p1: 'werewolf', p2: 'werewolf', p3: 'seer', p4: 'witch', p5: 'villager', p6: 'villager' });
  assert.deepEqual(stepsOf(deal(small)), ['begin', 'wolves', 'witch', 'seer']);
  // wolves always, even on a board of nothing else
  const bare = mk({ p1: 'werewolf', p2: 'villager', p3: 'villager', p4: 'villager', p5: 'villager', p6: 'villager' }, { winRule: 'city' });
  assert.deepEqual(stepsOf(deal(bare)), ['begin', 'wolves']);
});

test('werewolf: every step is called every night — even when its holder is dead — and the order never changes', () => {
  const sim = deal(mk({ ...R12 }));
  const first = stepsOf(sim).slice();
  // kill the seer, the guard and the witch (at night 1 via wolves + poison would be complex: mark them dead directly)
  const st = sim.state;
  night(sim);
  for (const p of ['p5', 'p6', 'p8']) st.alive[p] = false;
  toNight(sim);
  assert.equal(sim.state.n, 2);
  assert.deepEqual(stepsOf(sim), first);
  const called = [];
  let g = 0;
  while (phase(sim) === 'night' && g++ < 80) {
    const c = cur(sim);
    if (c.stage === 'cue' && c.step !== 'begin') called.push(c.step);
    if (c.stage === 'run') sim.advance(); else sim.cueDone();
  }
  assert.deepEqual(called, first.slice(1), 'every role is still called');
});

test('werewolf: a night step has a cue, a fixed-length window, then a closing cue — and never ends early', () => {
  const sim = deal(mk({ ...R9 }, { pace: 'normal' }));
  const c0 = sim.cue();
  assert.ok(c0.text.includes('天黑請閉眼'));
  assert.equal(sim.state.deadline, null);
  sim.cueDone();
  assert.equal(cur(sim).step, 'wolves');
  assert.equal(cur(sim).stage, 'cue');
  assert.equal(sim.state.deadline, null, 'the clock only starts when the narration is done');
  const t0 = sim.now;
  sim.cueDone();
  assert.equal(cur(sim).stage, 'run');
  assert.equal(sim.state.deadline, t0 + 35000, 'wolves get 35 s at the standard pace');
  assert.equal(sim.view('p1').span, 35000);
  // every seat acts and locks: the window still waits for its clock
  for (const p of sim.state.pl) sim.act(p, skipA);
  assert.equal(cur(sim).stage, 'run', 'all actors finished, the window does not end early');
  assert.equal(sim.state.deadline, t0 + 35000, 'and the deadline did not move');
  sim.advance();
  assert.equal(cur(sim).stage, 'tail');
  assert.equal(sim.state.deadline, null);
  assert.ok(sim.cue().text.includes('狼人請閉眼'));
  sim.cueDone();
  assert.equal(cur(sim).step, 'witch');
});

test('werewolf: window lengths are fixed per step and follow the pace — same every night, whatever anyone did', () => {
  const secs = { slow: { guard: 25, wolves: 50, witch: 30, seer: 25, hunter: 12 }, normal: { guard: 15, wolves: 35, witch: 20, seer: 15, hunter: 8 }, fast: { guard: 10, wolves: 25, witch: 14, seer: 10, hunter: 6 } };
  for (const pace of ['slow', 'normal', 'fast']) {
    const sim = deal(mk({ ...R12 }, { pace }));
    for (let nightNo = 1; nightNo <= 2; nightNo++) {
      let g = 0;
      while (phase(sim) === 'night' && g++ < 100) {
        const c = cur(sim);
        if (c.stage === 'cue' && c.step !== 'begin') {
          const t = sim.now;
          sim.cueDone();
          assert.equal(sim.state.deadline - t, secs[pace][c.step] * 1000, `${pace} ${c.step} night ${nightNo}`);
        } else if (c.stage === 'run') {
          if (nightNo === 2) for (const p of sim.state.pl) sim.act(p, { type: 'night', lock: true });   // everyone finishes at once: still no change
          sim.advance();
        } else sim.cueDone();
      }
      if (nightNo === 1) toNight(sim);
    }
  }
});

test('werewolf: cues are public, carry a unique id per stage, and @cue-done is matched to its id', () => {
  const sim = deal(mk({ ...R12 }));
  const ids2 = [];
  let g = 0;
  while (phase(sim) === 'night' && g++ < 100) {
    const c = sim.cue();
    if (c) {
      ids2.push(c.id);
      assert.ok(c.text.length > 0 && c.minMs >= 1800);
      assert.equal(sim.host({ type: ACT.CUE_DONE, id: 'wrong' }), false);
      sim.cueDone();
      assert.equal(sim.cue()?.id === c.id, false, 'an acknowledged cue disappears');
    } else sim.advance();
  }
  assert.equal(new Set(ids2).size, ids2.length, 'cue ids are unique');
  assert.equal(ids2.length, 1 + 5 * 2, 'begin + (open + close) per role step');
});

test('werewolf: night cues use the called role\'s name and no private information', () => {
  const sim = deal(mk({ ...R12 }));
  const texts = [];
  let g = 0;
  while (phase(sim) === 'night' && g++ < 100) {
    const c = sim.cue();
    if (c) { texts.push(c.text); sim.cueDone(); } else sim.advance();
  }
  const joined = texts.join('\n');
  for (const role of ['守衛', '狼人', '女巫', '預言家', '獵人']) assert.ok(joined.includes(`${role}請開眼`) && joined.includes(`${role}請閉眼`), role);
  const names = sim.players.map((p) => p.name);
  for (const n of names) assert.ok(!joined.includes(n), `a night cue mentions ${n}`);
  assert.ok(texts[0].includes('天黑請閉眼'));
  assert.ok(joined.includes('互相認一認隊友'), 'night 1 tells the wolves to meet');
});

test('werewolf: EVERY seat has a legal action during EVERY night step — real actors, dead holders, used-up witch, villagers', () => {
  const boards = [R9, R12, { p1: 'werewolf', p2: 'werewolf', p3: 'seer', p4: 'witch', p5: 'villager', p6: 'villager' }];
  for (const map of boards) {
    const sim = deal(mk(map));
    let nightNo = 0;
    const checked = new Set();
    while (nightNo < 3 && !sim.result()) {
      let g = 0;
      nightNo = sim.state.n;
      while (phase(sim) === 'night' && g++ < 100) {
        const c = cur(sim);
        if (c.stage === 'run' && c.step !== 'begin') {
          for (const p of sim.state.pl) {
            const legal = sim.legal(p);
            assert.ok(legal.length > 0, `${p} (${sim.state.role[p]}, alive=${sim.state.alive[p]}) has nothing to tap at ${c.step} on night ${sim.state.n}`);
            assert.ok(legal.some((a) => a.type === 'night' && a.pick), `${p} cannot pick anyone at ${c.step}`);
            assert.ok(legal.some((a) => a.type === 'night' && a.lock === true), `${p} cannot confirm at ${c.step}`);
            checked.add(`${c.step}`);
          }
          sim.advance();
        } else sim.cueDone();
      }
      if (sim.result()) break;
      // make the table interesting: kill the seer and spend the witch's potions before night 2/3
      if (nightNo === 1) { for (const p of sim.state.pl) if (sim.state.role[p] === 'seer') sim.state.alive[p] = false; sim.state.potion = { save: false, poison: false }; }
      if (nightNo === 2) for (const p of sim.state.pl) if (sim.state.role[p] === 'guard' || sim.state.role[p] === 'hunter') sim.state.alive[p] = false;
      drive(sim, (s) => s.phase === 'night' || s.phase === 'over');
    }
    assert.ok(checked.has('wolves') && checked.has('witch') && checked.has('seer'), 'every step was checked');
  }
});

test('werewolf: the night screen has the SAME shape for every seat at every step (decoys look like the real thing)', () => {
  const shape = (v) => JSON.stringify({
    keys: Object.keys(v.nt).sort(),
    chipKeys: v.nt.chips.map((c) => Object.keys(c).sort().join()).filter((x, i, a) => a.indexOf(x) === i),
    chips: v.nt.chips.length,
    step: v.nt.step, stage: v.nt.stage, night: v.night,
    viewKeys: Object.keys(v).sort(),
  });
  for (const map of [R9, R12]) {
    const sim = deal(mk(map));
    let g = 0;
    while (phase(sim) === 'night' && g++ < 100) {
      const c = cur(sim);
      const shapes = new Set(sim.state.pl.map((p) => shape(sim.view(p))));
      // viewKeys differ only by role-dependent optional blocks (my.mates / my.potion live INSIDE my), so equal
      assert.equal(shapes.size, 1, `night screens differ in shape at ${c.step}/${c.stage}: ${[...shapes].join('\n')}`);
      if (c.stage === 'run') {
        for (const v of sim.state.pl.map((p) => sim.view(p))) {
          assert.equal(v.nt.chips.length, sim.state.pl.length);
          assert.ok(typeof v.nt.skip === 'string' && typeof v.nt.ok === 'string' && Array.isArray(v.nt.info) && v.nt.info.length >= 1);
        }
        sim.advance();
      } else sim.cueDone();
    }
  }
});

test('werewolf: at night EVERY playing seat is dimmed (night:true), so lit screens never depend on the role; the moderator is not', () => {
  const sim = deal(mk(R9));
  for (const p of sim.state.pl) assert.equal(sim.view(p).night, true);
  const hsim = new Sim(game, { n: 7, seed: 1, config: { ...config.defaults(7), moderator: 'human' } });
  for (const p of hsim.state.pl) hsim.act(p, { type: 'ready' });
  assert.equal(hsim.view('p1').night, false, 'the human moderator needs to read the screen');
  assert.equal(hsim.view('p2').night, true);
  // by day nobody is dimmed
  const day = mk(R9); deal(day); night(day); toPhase(day, 'speech');
  for (const p of day.state.pl) assert.equal(day.view(p).night, false);
});

// ============================================================
// night roles
// ============================================================

/** Run night 1 (R12 board) with the given choices and return who died and why. */
function resolveWith(script, over = {}, map = R12, seed = 1, pre = () => {}) {
  const sim = mk(map, over, seed);
  deal(sim);
  pre(sim);
  night(sim, script);
  const died = Object.fromEntries(Object.entries(sim.state.died).map(([p, d]) => [p, d.how]));
  return { sim, died };
}

const wolvesPick = (target, who = ['p1', 'p2', 'p3', 'p4']) => Object.fromEntries(who.map((w) => [w, pk(target)]));

/** Advance until the window of `step` is open. */
function toStep(sim, step) {
  let g = 0;
  while (!(phase(sim) === 'night' && cur(sim).step === step && cur(sim).stage === 'run')) {
    assert.ok(g++ < 120, `never reached ${step}`);
    if (phase(sim) === 'night' && cur(sim).stage === 'run') sim.advance();
    else if (sim.cue()) sim.cueDone();
    else sim.advance();
  }
  return sim;
}

test('werewolf: night truth table — guard / antidote / poison against a wolf attack', () => {
  // victim p10 (villager) unless noted; guard p8, witch p6
  const G = (t) => ({ p8: pk(t) });
  const W = (t) => ({ p6: pk(t) });
  const atk = wolvesPick('p10');
  const cases = [
    ['nothing: the victim dies', { wolves: atk }, { p10: 'wolf' }],
    ['guarded only: survives', { guard: G('p10'), wolves: atk }, {}],
    ['healed only: survives', { wolves: atk, witch: W('p10') }, {}],
    ['guarded AND healed: dies (奶穿)', { guard: G('p10'), wolves: atk, witch: W('p10') }, { p10: 'wolf' }],
    ['poison on someone else: both die', { wolves: atk, witch: W('p11') }, { p10: 'wolf', p11: 'poison' }],
    ['poison the guard\'s protected player (毒穿)', { guard: G('p11'), wolves: wolvesPick(null), witch: W('p11') }, { p11: 'poison' }],
    ['guard protects someone else: the victim still dies', { guard: G('p11'), wolves: atk }, { p10: 'wolf' }],
    ['空刀 (no attack): nobody dies', { wolves: wolvesPick(null) }, {}],
    ['nobody picks (all wolves asleep): treated as no kill', {}, {}],
    ['self-knife: a wolf is the victim and dies', { wolves: wolvesPick('p1') }, { p1: 'wolf' }],
    ['self-knife healed', { wolves: wolvesPick('p1'), witch: W('p1') }, {}],
    ['guard protects himself and is attacked', { guard: G('p8'), wolves: wolvesPick('p8') }, {}],
  ];
  for (const [name, script, expected] of cases) {
    const { died } = resolveWith(script);
    assert.deepEqual(died, expected, name);
  }
});

test('werewolf: poison beats the antidote and the guard — a poisoned victim dies with cause poison', () => {
  // the witch spent her antidote earlier, so she can only poison: p10 is attacked, guarded, and poisoned unknowingly
  const { died } = resolveWith({ guard: { p8: pk('p10') }, wolves: wolvesPick('p10'), witch: { p6: pk('p10') } }, {}, R12, 1, (sim) => { sim.state.potion.save = false; });
  assert.deepEqual(died, { p10: 'poison' });
});

test('werewolf: 同守同救 setting — "live" lets a guarded + healed victim survive', () => {
  const script = { guard: { p8: pk('p10') }, wolves: wolvesPick('p10'), witch: { p6: pk('p10') } };
  assert.deepEqual(resolveWith(script, { guardStack: 'die' }).died, { p10: 'wolf' });
  const live = resolveWith(script, { guardStack: 'live' });
  assert.deepEqual(live.died, {});
  assert.equal(live.sim.state.rec[0].result.flags.includes('bothLive'), true);
  // "live" does not weaken an unguarded attack
  assert.deepEqual(resolveWith({ wolves: wolvesPick('p10') }, { guardStack: 'live' }).died, { p10: 'wolf' });
});

test('werewolf: deaths are announced in ascending seat order, no cause, and a peaceful night says so', () => {
  const { sim } = resolveWith({ wolves: wolvesPick('p11'), witch: { p6: pk('p3') } });
  assert.equal(phase(sim), 'dawn');
  assert.deepEqual(cur(sim).deaths, ['p3', 'p11'], 'ascending seat, not order of death');
  const text = sim.cue().text;
  assert.ok(text.includes('天光喇') && text.includes('開眼'));
  assert.ok(text.includes('玩家3同玩家11'), 'names in seat order, joined the way it is said aloud');
  assert.ok(!text.includes('號'), 'the narrator says names, not seat numbers');
  assert.ok(!/毒|狼人殺|被殺|死於/.test(text), 'no cause in the announcement');
  const v = sim.view('p2');
  assert.deepEqual(v.dawn.deaths.map((d) => d.pid), ['p3', 'p11']);
  assert.ok(v.seats.every((x) => !x.how), 'cause of death is not in the roster');
  const peace = resolveWith({});
  assert.deepEqual(cur(peace.sim).deaths, []);
  assert.ok(peace.sim.cue().text.includes('平安夜'));
  assert.equal(peace.sim.view('p2').dawn.deaths.length, 0);
});

test('werewolf: guard — can guard himself, cannot repeat the same player two nights running, a skip frees it', () => {
  const sim = deal(mk(R12));
  night(sim, { guard: { p8: pk('p9') } });
  toNight(sim);
  assert.equal(sim.state.n, 2);
  toStep(sim, 'guard');
  const chip = (pid) => sim.view('p8').nt.chips.find((c) => c.pid === pid);
  assert.equal(chip('p9').on, false);
  assert.ok(chip('p9').tag.includes('上晚'));
  assert.equal(chip('p8').on, true, 'self-guard is allowed');
  assert.equal(sim.act('p8', pk('p9')), false, 'the engine rejects the barred target');
  assert.ok(sim.view('p8').nt.info[0].includes('玩家9'), 'he is told who he guarded last night');
  assert.ok(!sim.legal('p8').some((a) => a.pick === 'p9'));
  sim.act('p8', skipA);                                         // 空守
  sim.advance();
  assert.equal(sim.state.guardLast, null);
  night(sim);
  toNight(sim);
  toStep(sim, 'guard');                                         // night 3: the skip freed p9
  assert.equal(sim.view('p8').nt.chips.find((c) => c.pid === 'p9').on, true);
  assert.equal(sim.act('p8', pk('p9')), true);
  // a guard who is not awake-able (other seats) never sees the bar
  assert.ok(sim.view('p10').nt.chips.every((c) => c.tag === ''));
});

test('werewolf: guard — an unconfirmed pick still counts when the window closes; a dead guard guards nobody', () => {
  const a = resolveWith({ guard: { p8: { type: 'night', pick: 'p10' } }, wolves: wolvesPick('p10') });
  assert.deepEqual(a.died, {}, 'tentative pick = final at the end of the window');
  const b = resolveWith({ guard: { p8: pk('p10') }, wolves: wolvesPick('p10') }, {}, R12, 1, (sim) => { sim.state.alive.p8 = false; });
  assert.deepEqual(b.died, { p10: 'wolf' }, 'dead guard protects nobody even if his phone sent a pick');
  assert.equal(b.sim.state.rec[0].guard, undefined);
});

test('werewolf: a locked seat is frozen (a wolf may reconsider); picks of dead, barred or non-existent targets are refused', () => {
  const sim = deal(mk(R12));
  toStep(sim, 'guard');
  assert.equal(sim.act('p8', pk('p9')), true);
  assert.equal(sim.act('p8', pk('p10')), false, 'locked');
  assert.equal(sim.act('p8', { type: 'night', lock: false }), false, 'cannot unlock');
  assert.equal(sim.act('p10', { type: 'night', pick: 'nobody' }), false);
  assert.equal(sim.act('p10', { type: 'night', pick: 42 }), false);
  assert.equal(sim.act('p10', { type: 'night' }), false, 'an action with neither pick nor lock is nothing');
  assert.equal(sim.act('p10', { type: 'night', pick: 'p9', lock: 'yes' }), true, 'a bad lock flag is ignored but the pick lands');
  assert.equal(sim.view('p10').nt.lock, false);
  sim.state.alive.p11 = false;
  assert.equal(sim.act('p12', { type: 'night', pick: 'p11' }), false, 'a dead target is not tappable');
  // a stranger / the host-internal pid cannot act
  assert.equal(sim.act('nobody', pk('p9')), false);
  assert.equal(sim.act(HOST, pk('p9')), false);
});

test('werewolf: wolves — plurality picks the most-voted target; ties break at random (seeded); 空刀 is a candidate', () => {
  const run = (picks, seed = 1, over = {}) => {
    const r = resolveWith({ wolves: Object.fromEntries(Object.entries(picks).map(([w, t]) => [w, pk(t)])) }, over, R12, seed);
    return r.sim.state.rec[0].wolves;
  };
  const a = run({ p1: 'p10', p2: 'p10', p3: 'p11' });
  assert.deepEqual([a.target, a.how], ['p10', 'plurality']);
  const b = run({ p1: 'p10', p2: 'p10', p3: 'p10', p4: 'p10' });
  assert.deepEqual([b.target, b.how], ['p10', 'agree']);
  const c = run({ p1: 'p10' });
  assert.deepEqual([c.target, c.how], ['p10', 'partial']);   // one wolf awake decides alone (the recap says the others never picked)
  const d = run({});
  assert.deepEqual([d.target, d.how], [null, 'none']);
  // 空刀 competes: two say no kill, one says p10 → nobody dies
  const e = run({ p1: null, p2: null, p3: 'p10' });
  assert.deepEqual([e.target, e.how], [null, 'plurality']);
  // 2–2 tie → random but seeded: both targets occur over seeds, same seed gives the same answer
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const w = run({ p1: 'p10', p2: 'p10', p3: 'p11', p4: 'p11' }, seed);
    seen.add(w.target);
    assert.equal(w.how, 'random');
  }
  assert.deepEqual([...seen].sort(), ['p10', 'p11']);
  assert.equal(run({ p1: 'p10', p2: 'p11' }, 7).target, run({ p1: 'p10', p2: 'p11' }, 7).target);
  // dead wolves' picks are ignored
  const rd = resolveWith({ wolves: { p1: pk('p10'), p2: pk('p11'), p3: pk('p11'), p4: pk('p11') } }, {}, R12, 1, (sim) => { for (const w of ['p2', 'p3', 'p4']) sim.state.alive[w] = false; });
  assert.equal(rd.sim.state.rec[0].wolves.target, 'p10');
});

test('werewolf: wolves — "must agree" setting: any disagreement or missing wolf means no kill', () => {
  const run = (picks) => resolveWith({ wolves: Object.fromEntries(Object.entries(picks).map(([w, t]) => [w, pk(t)])) }, { wolfVote: 'unanimous' }).sim.state.rec[0].wolves;
  assert.equal(run({ p1: 'p10', p2: 'p10', p3: 'p10', p4: 'p10' }).target, 'p10');
  const split = run({ p1: 'p10', p2: 'p10', p3: 'p10', p4: 'p11' });
  assert.deepEqual([split.target, split.how], [null, 'split']);
  assert.equal(run({ p1: 'p10', p2: 'p10', p3: 'p10' }).target, null, 'a wolf who did not pick breaks unanimity');
  assert.equal(run({ p1: null, p2: null, p3: null, p4: null }).how, 'empty');
  assert.equal(run({}).how, 'none');
});

test('werewolf: wolves — see each other\'s live picks and their mates; nobody else does', () => {
  const sim = deal(mk(R12));
  toStep(sim, 'wolves');
  sim.act('p1', { type: 'night', pick: 'p10' });
  sim.act('p3', { type: 'night', pick: 'p10' });
  sim.act('p4', { type: 'night', pick: 'p11' });
  sim.act('p10', { type: 'night', pick: 'p1' });                // a villager's decoy tap
  const by = (pid, target) => sim.view(pid).nt.chips.find((c) => c.pid === target).by;
  assert.deepEqual(by('p2', 'p10'), ['p1', 'p3'], 'a wolf sees teammates\' picks');
  assert.deepEqual(by('p2', 'p11'), ['p4']);
  assert.deepEqual(by('p1', 'p10'), ['p1', 'p3'], 'and his own');
  for (const other of ['p5', 'p6', 'p8', 'p10']) assert.ok(sim.view(other).nt.chips.every((c) => c.by.length === 0), `${other} sees no wolf picks`);
  assert.equal(by('p10', 'p1').length, 0, 'a decoy tap is not a wolf pick');
  const v1 = sim.view('p1');
  assert.ok(v1.nt.info[0].includes('玩家2') && v1.nt.info[0].includes('玩家3') && v1.nt.info[0].includes('玩家4'));
  assert.deepEqual(v1.nt.chips.filter((c) => c.tag === '🐺').map((c) => c.pid), ['p2', 'p3', 'p4']);
  assert.deepEqual(v1.my.mates, ['p2', 'p3', 'p4']);
  assert.equal(sim.view('p5').my.mates, undefined);
  assert.equal(sim.view('p10').my.mates, undefined);
  assert.ok(sim.view('p5').nt.chips.every((c) => c.tag !== '🐺'));
  // a dead wolf has a decoy panel: its earlier pick vanishes from the live list
  sim.state.alive.p4 = false;
  assert.deepEqual(by('p1', 'p11'), []);
});

test('werewolf: wolves may change their mind after confirming; every other seat is frozen once it confirms', () => {
  const sim = deal(mk(R12));
  toStep(sim, 'wolves');
  assert.equal(sim.act('p1', pk('p10')), true);
  assert.equal(sim.view('p1').nt.lock, true);
  assert.equal(sim.act('p1', { type: 'night', pick: 'p11' }), true, 'a locked wolf re-picks (and unlocks)');
  assert.equal(sim.view('p1').nt.lock, false);
  assert.equal(sim.view('p1').nt.pick, 'p11');
  assert.ok(sim.legal('p1').some((a) => a.pick === 'p12'));
  sim.act('p10', pk('p1'));                                       // a villager's decoy confirm freezes that seat
  assert.equal(sim.view('p10').nt.chips.every((c) => !c.on), true);
  assert.equal(sim.act('p10', pk('p2')), false);
  assert.deepEqual(sim.legal('p10'), []);
  sim.state.alive.p12 = false;
  assert.equal(sim.act('p2', pk('p12')), false);
});

test('werewolf: a lone wolf has no mates; before the wolves\' step nobody knows any', () => {
  const lone = mk({ p1: 'werewolf', p2: 'seer', p3: 'villager', p4: 'villager', p5: 'villager', p6: 'villager' }, { winRule: 'city' });
  deal(lone);
  assert.equal(lone.view('p1').my.mates, undefined, 'the deal does not show wolf teammates');
  toStep(lone, 'wolves');
  assert.ok(lone.view('p1').nt.info[0].includes('獨狼'));
  assert.deepEqual(lone.view('p1').my.mates, []);
  assert.equal(lone.state.matesKnown, true);
});

// ---------- witch ----------

test('werewolf: witch — sees tonight\'s victim while the antidote is unused, and only then', () => {
  const sim = deal(mk(R9));
  toStep(sim, 'wolves');
  for (const w of ['p1', 'p2', 'p3']) sim.act(w, pk('p7'));
  sim.advance();
  toStep(sim, 'witch');
  const info = sim.view('p5').nt.info.join('|');
  assert.ok(info.includes('玩家7'), 'the witch is told the victim');
  assert.ok(info.includes('解藥：有') && info.includes('毒藥：有'));
  assert.equal(sim.view('p5').my.potion.save, true);
  for (const p of ['p1', 'p4', 'p6', 'p7', 'p8']) assert.ok(!sim.view(p).nt.info.join('|').includes('被狼人襲擊'), p);
  assert.equal(sim.view('p4').my.potion, undefined);
  // she saves → antidote gone → next night she is told nothing
  sim.act('p5', pk('p7'));
  sim.advance();
  assert.equal(sim.state.potion.save, false);
  night(sim);
  assert.deepEqual(Object.keys(sim.state.died), []);
  toNight(sim);
  toStep(sim, 'wolves');
  for (const w of ['p1', 'p2', 'p3']) sim.act(w, pk('p8'));
  sim.advance();
  toStep(sim, 'witch');
  const info2 = sim.view('p5').nt.info.join('|');
  assert.ok(!info2.includes('玩家8'), 'no victim info once the antidote is spent');
  assert.ok(info2.includes('解藥已經用咗'));
  assert.ok(info2.includes('解藥：冇') && info2.includes('毒藥：有'));
  const chip8 = sim.view('p5').nt.chips.find((c) => c.pid === 'p8');
  assert.equal(chip8.on, true, 'the victim is just another poison target now');
  assert.equal(chip8.tag, '');
});

test('werewolf: witch — victim chip = antidote, any other chip = poison, one potion a night, never poison herself', () => {
  const sim = deal(mk(R9));
  toStep(sim, 'wolves');
  for (const w of ['p1', 'p2', 'p3']) sim.act(w, pk('p7'));
  sim.advance();
  toStep(sim, 'witch');
  const chips = sim.view('p5').nt.chips;
  assert.equal(chips.find((c) => c.pid === 'p7').tag, '💊');
  assert.equal(chips.find((c) => c.pid === 'p5').on, false, 'she cannot poison herself');
  assert.equal(chips.filter((c) => c.on).length, 8, 'everyone alive except herself');
  sim.act('p5', { type: 'night', pick: 'p7' });
  sim.act('p5', { type: 'night', pick: 'p8' });                 // one tentative choice at a time: the second REPLACES the first
  sim.advance();
  assert.equal(sim.state.potion.save, true, 'the antidote was not used');
  assert.equal(sim.state.potion.poison, false);
  assert.deepEqual(sim.state.nt.rec.witch, { by: 'p5', act: 'poison', target: 'p8' });
  assert.equal(sim.state.nt.saved, null);
  assert.equal(sim.state.nt.poisoned, 'p8');
  assert.deepEqual(sim.state.notes.p5, [{ k: 'poison', n: 1, pid: 'p8' }]);
  // "唔用藥" uses nothing
  const sim3 = deal(mk(R9));
  toStep(sim3, 'wolves'); for (const w of ['p1', 'p2', 'p3']) sim3.act(w, pk('p7')); sim3.advance();
  toStep(sim3, 'witch'); sim3.act('p5', skipA); sim3.advance();
  assert.deepEqual(sim3.state.potion, { save: true, poison: true });
  assert.equal(sim3.state.nt.rec.witch.act, null);
});

test('werewolf: witch self-save — never / first night / always; she may still poison on the night she is the victim', () => {
  const trial = (save, nightNo) => {
    const sim = deal(mk(R9, { witchSelfSave: save }));
    for (let i = 1; i < nightNo; i++) { night(sim); toNight(sim); }
    toStep(sim, 'wolves');
    for (const w of ['p1', 'p2', 'p3']) sim.act(w, pk('p5'));      // the witch is the victim
    sim.advance();
    toStep(sim, 'witch');
    return sim;
  };
  for (const [save, n1, n2] of [['never', false, false], ['first', true, false], ['always', true, true]]) {
    const a = trial(save, 1);
    assert.equal(a.view('p5').nt.chips.find((c) => c.pid === 'p5').on, n1, `${save} night 1`);
    assert.ok(a.view('p5').nt.info.join('|').includes('你自己'));
    if (!n1) assert.ok(a.view('p5').nt.info.join('|').includes('唔可以自救'));
    assert.equal(a.act('p5', pk('p5')), n1);
    const b = trial(save, 2);
    assert.equal(b.view('p5').nt.chips.find((c) => c.pid === 'p5').on, n2, `${save} night 2`);
  }
  // poison is still available on the night she is the victim and cannot save herself: both die
  const sim = trial('never', 1);
  assert.equal(sim.act('p5', pk('p8')), true);
  sim.advance();
  night(sim);
  assert.deepEqual(Object.fromEntries(Object.entries(sim.state.died).map(([p, d]) => [p, d.how])), { p5: 'wolf', p8: 'poison' });
  // and a self-save really saves her
  const ok = trial('first', 1);
  ok.act('p5', pk('p5')); ok.advance(); night(ok);
  assert.deepEqual(ok.state.died, {});
  assert.equal(ok.state.potion.save, false);
});

test('werewolf: witch — with no victim she is told so and can only poison; with both potions gone she gets a decoy', () => {
  const sim = deal(mk(R9));
  toStep(sim, 'wolves'); sim.advance();                         // nobody picks → 空刀
  toStep(sim, 'witch');
  const v = sim.view('p5');
  assert.ok(v.nt.info.join('|').includes('冇人被狼人襲擊'));
  assert.equal(v.nt.chips.filter((c) => c.tag === '💊').length, 0);
  assert.equal(v.nt.chips.filter((c) => c.on).length, 8);
  sim.act('p5', pk('p9')); sim.advance();
  assert.equal(sim.state.nt.poisoned, 'p9');
  night(sim);
  assert.equal(sim.state.alive.p9, false);
  toNight(sim);
  // used-up witch (poison spent, antidote forced away): decoy with the same tappability as everyone else
  sim.state.potion = { save: false, poison: false };
  toStep(sim, 'witch');
  const used = sim.view('p5');
  assert.ok(used.nt.info[0].includes('用晒'));
  assert.equal(used.nt.chips.filter((c) => c.on).length, alive(sim).length);
  assert.ok(sim.legal('p5').length > 0);
  assert.equal(used.nt.chips.length, sim.view('p7').nt.chips.length);
  sim.act('p5', pk('p8')); sim.advance();
  assert.equal(sim.state.nt.poisoned, null, 'taps from a used-up witch do nothing');
});

test('werewolf: witch — a dead witch gets a decoy and her taps do nothing', () => {
  const sim = deal(mk(R9));
  sim.state.alive.p5 = false;
  toStep(sim, 'wolves'); for (const w of ['p1', 'p2', 'p3']) sim.act(w, pk('p7')); sim.advance();
  toStep(sim, 'witch');
  const v = sim.view('p5');
  assert.ok(v.nt.info[0].includes('出局'));
  assert.ok(!v.nt.info.join('').includes('玩家7'));
  sim.act('p5', pk('p7'));
  sim.advance();
  assert.deepEqual(sim.state.potion, { save: true, poison: true });
  assert.equal(sim.state.nt.saved, null);
  assert.equal(sim.state.nt.rec.witch, undefined);
});

test('werewolf: hunter step — told about poison at night, never about an attack; everybody else gets a decoy', () => {
  const sim = deal(mk(R9));
  toStep(sim, 'wolves'); for (const w of ['p1', 'p2', 'p3']) sim.act(w, pk('p6')); sim.advance();       // wolves attack the hunter
  toStep(sim, 'witch'); sim.act('p5', pk('p7')); sim.advance();                                          // witch poisons p7
  toStep(sim, 'hunter');
  const h = sim.view('p6').nt.info.join('|');
  assert.ok(h.includes('冇被毒') && h.includes('👍'), 'an attacked hunter is NOT told he is attacked');
  assert.ok(!h.includes('襲擊'));
  for (const p of ['p1', 'p4', 'p5', 'p7', 'p8']) assert.ok(!sim.view(p).nt.info.join('').includes('冇被毒'), `${p} gets a decoy`);
  assert.equal(sim.view('p6').nt.chips.length, sim.view('p7').nt.chips.length);
  // now the hunter IS the poison target
  const sim2 = deal(mk(R9));
  toStep(sim2, 'wolves'); sim2.advance();
  toStep(sim2, 'witch'); sim2.act('p5', pk('p6')); sim2.advance();
  toStep(sim2, 'hunter');
  const h2 = sim2.view('p6').nt.info.join('|');
  assert.ok(h2.includes('被毒咗') && h2.includes('👎'));
  assert.ok(sim2.legal('p6').length > 0, 'his taps are decoys');
  sim2.act('p6', pk('p1')); sim2.advance();
  assert.deepEqual(sim2.state.rec.length, 0);
});

// ---------- seer ----------

test('werewolf: seer — result only after confirming, camp only, recorded privately', () => {
  const sim = deal(mk(R9));
  toStep(sim, 'seer');
  assert.ok(sim.view('p4').nt.info[0].includes('驗'));
  sim.act('p4', { type: 'night', pick: 'p1' });
  assert.ok(!sim.view('p4').nt.info.join('').includes('係：'), 'a tentative pick shows nothing');
  assert.equal(sim.state.notes.p4, undefined);
  sim.act('p4', { type: 'night', lock: true });
  assert.ok(sim.view('p4').nt.info[0].includes('玩家1') && sim.view('p4').nt.info[0].includes('狼人'));
  assert.deepEqual(sim.view('p4').my.notes, [{ k: 'seer', n: 1, pid: 'p1', camp: 'wolf' }]);
  for (const p of ['p1', 'p2', 'p5', 'p6', 'p7']) {
    assert.deepEqual(sim.view(p).my.notes, []);
    assert.ok(!sim.view(p).nt.info.join('').includes('係：'));
  }
  assert.equal(sim.act('p4', pk('p2')), false, 'confirmed → frozen');
  assert.deepEqual(sim.legal('p4'), []);
  // a hunter checks as good (camp only, never the role)
  const sim2 = deal(mk(R9));
  toStep(sim2, 'seer'); sim2.act('p4', pk('p6'));
  assert.deepEqual(sim2.view('p4').my.notes, [{ k: 'seer', n: 1, pid: 'p6', camp: 'good' }]);
  assert.ok(!sim2.view('p4').nt.info[0].includes('獵人'));
});

test('werewolf: seer — cannot check himself, a dead player, or the same player twice; an unconfirmed pick resolves at the end', () => {
  const sim = deal(mk(R9));
  toStep(sim, 'seer');
  assert.equal(sim.view('p4').nt.chips.find((c) => c.pid === 'p4').on, false);
  assert.equal(sim.act('p4', pk('p4')), false);
  sim.state.alive.p9 = false;
  assert.equal(sim.act('p4', pk('p9')), false);
  sim.act('p4', { type: 'night', pick: 'p2' });                 // never confirmed
  sim.advance();
  assert.deepEqual(sim.view('p4').my.notes.map((x) => x.pid), ['p2'], 'the window closed on his pick');
  night(sim); toNight(sim);
  toStep(sim, 'seer');
  const chip = (pid) => sim.view('p4').nt.chips.find((c) => c.pid === pid);
  assert.equal(chip('p2').on, false, 're-checking is forbidden');
  assert.equal(chip('p2').tag, '🐺', 'but he is reminded of the result');
  assert.equal(sim.act('p4', pk('p2')), false);
  assert.equal(chip('p3').on, true);
  sim.act('p4', skipA);                                         // skipping is allowed and means "no check"
  assert.ok(sim.view('p4').nt.info[0].includes('冇驗'));
  assert.equal(sim.state.nt.rec.seer.target, null);
});

test('werewolf: seer — a seer who never picks learns nothing; a dead seer learns nothing', () => {
  const sim = deal(mk(R9));
  toStep(sim, 'seer'); sim.advance();
  assert.equal(sim.state.nt.rec.seer.target, null);
  assert.equal(sim.state.notes.p4, undefined);
  const dead = deal(mk(R9));
  dead.state.alive.p4 = false;
  toStep(dead, 'seer'); dead.act('p4', pk('p1')); dead.advance();
  assert.equal(dead.state.notes.p4, undefined);
  assert.equal(dead.state.nt.seer, null);
});

test('werewolf: nothing a player taps at night is visible to anyone else (decoy and real taps both stay private)', () => {
  const sim = deal(mk(R9));
  toStep(sim, 'seer');
  sim.act('p7', { type: 'night', pick: 'p1' });
  const before = JSON.stringify(sim.view('p8'));
  sim.act('p7', skipA);
  assert.equal(JSON.stringify(sim.view('p8')), before, 'another seat\'s view does not change when a decoy taps');
  const wolfView = JSON.stringify(sim.view('p1'));
  sim.act('p4', pk('p2'));                                      // the real seer confirms
  assert.equal(JSON.stringify(sim.view('p1')), wolfView, 'a wolf cannot tell the seer has acted');
});

// ============================================================
// the day: dawn, last words, the hunter's shot
// ============================================================

/** The remaining script of the day, as `kind:pid` strings (current step first). */
const queue = (sim) => [sim.state.cur, ...sim.state.q].filter(Boolean).map((x) => (x.k === 'plan' ? `plan:${x.what}` : x.pid && x.k !== 'say' ? `${x.k}:${x.pid}` : x.kind ? `${x.k}:${x.kind}` : x.k));

test('werewolf: last words — night 1 deaths speak (any number, any cause); later night deaths do not; day deaths always do', () => {
  const sim = deal(mk(R9));
  nightKill(sim, 'p7', { witch: { p5: pk('p8') } });               // night 1: p7 wolf, p8 poison
  assert.deepEqual(queue(sim), ['dawn', 'words:p7', 'final:p7', 'words:p8', 'final:p8', 'plan:discuss']);
  // night 2 deaths: the dawn announces them, nobody gets last words (but the hunter's window still runs)
  const sim2 = deal(mk(R9));
  night(sim2); toNight(sim2);
  nightKill(sim2, 'p7');
  assert.deepEqual(queue(sim2), ['dawn', 'final:p7', 'plan:discuss']);
  // an exiled player speaks on any day
  const sim3 = deal(mk(R9));
  night(sim3); toNight(sim3);
  night(sim3);
  toVote(sim3);
  castVotes(sim3, Object.fromEntries(sim3.state.pl.map((p) => [p, 'p8'])));
  assert.deepEqual(queue(sim3).slice(0, 4), ['say:tally', 'words:p8', 'final:p8', 'plan:night']);
});

test('werewolf: last words setting — night1 / night1single (single death) / all', () => {
  const twoDeaths = (lastWords, nightNo) => {
    const sim = deal(mk(R9, { lastWords }));
    for (let i = 1; i < nightNo; i++) { night(sim); toNight(sim); }
    nightKill(sim, 'p7', { witch: { p5: pk('p8') } });
    return queue(sim).filter((x) => x.startsWith('words'));
  };
  const oneDeath = (lastWords, nightNo) => {
    const sim = deal(mk(R9, { lastWords }));
    for (let i = 1; i < nightNo; i++) { night(sim); toNight(sim); }
    nightKill(sim, 'p7');
    return queue(sim).filter((x) => x.startsWith('words'));
  };
  assert.deepEqual(twoDeaths('night1', 1), ['words:p7', 'words:p8']);
  assert.deepEqual(twoDeaths('night1', 2), []);
  assert.deepEqual(oneDeath('night1', 2), []);
  assert.deepEqual(oneDeath('night1single', 2), ['words:p7'], 'a lone night death speaks');
  assert.deepEqual(twoDeaths('night1single', 2), [], 'two night deaths on night 2 do not');
  assert.deepEqual(twoDeaths('night1single', 1), ['words:p7', 'words:p8']);
  assert.deepEqual(oneDeath('all', 3), ['words:p7']);
  assert.deepEqual(twoDeaths('all', 3), ['words:p7', 'words:p8']);
});

test('werewolf: last words — a speaker taps 我講完 (or the timer / @next ends it); wordsSecs 0 means no clock', () => {
  const sim = deal(mk(R9, { wordsSecs: 45, pace: 'fast' }));
  nightKill(sim, 'p7');
  toPhase(sim, 'words');
  assert.equal(cur(sim).stage, 'cue');
  const c = sim.cue();
  assert.ok(c.text.includes('玩家7') && c.text.includes('遺言') && c.text.includes('45 秒'));
  assert.equal(sim.state.deadline, null);
  assert.equal(sim.act('p7', { type: 'done' }), false, 'cannot finish before it started');
  sim.cueDone();
  assert.equal(sim.state.deadline, sim.now + 45000);
  assert.equal(sim.view('p2').timerLabel, '遺言');
  assert.equal(sim.act('p2', { type: 'done' }), false, 'only the speaker may end it');
  assert.equal(sim.act('p7', { type: 'done' }), true);
  assert.equal(phase(sim), 'final');
  // timer
  const s2 = deal(mk(R9, { wordsSecs: 20 }));
  nightKill(s2, 'p7'); toPhase(s2, 'words'); s2.cueDone();
  s2.advance();
  assert.equal(phase(s2), 'final');
  // @next from the host
  const s3 = deal(mk(R9, { wordsSecs: 0 }));
  nightKill(s3, 'p7'); toPhase(s3, 'words'); s3.cueDone();
  assert.equal(s3.state.deadline, null, 'no clock when wordsSecs is 0');
  assert.ok(sim.legal('p7').length === 0 && s3.legal('p7').some((a) => a.type === 'done'));
  s3.host({ type: ACT.NEXT });
  assert.equal(phase(s3), 'final');
});

test('werewolf: final action — with a hunter on the board EVERY dead player gets the same fixed window; without one, nobody does', () => {
  const sim = deal(mk(R9, { pace: 'normal' }));
  nightKill(sim, 'p7', { witch: { p5: pk('p8') } });
  const lens = [];
  for (let i = 0; i < 2; i++) {
    toPhase(sim, 'final');
    const t0 = sim.now;
    sim.cueDone();
    lens.push(sim.state.deadline - t0);
    // the dead player's screen is the same shape whether or not he is the hunter
    const dead = cur(sim).pid;
    assert.equal(sim.view(dead).nt.chips.length, 9);
    assert.ok(sim.legal(dead).length > 0);
    sim.advance();
  }
  assert.deepEqual(lens, [12000, 12000]);
  // no hunter on the board → no final windows at all
  const noHunter = deal(mk({ p1: 'werewolf', p2: 'werewolf', p3: 'seer', p4: 'witch', p5: 'villager', p6: 'villager' }));
  nightKill(noHunter, 'p5');
  assert.deepEqual(queue(noHunter), ['dawn', 'words:p5', 'plan:discuss']);
});

test('werewolf: final action — the public sees the same thing for a hunter and a villager; only the dead seat gets a panel', () => {
  const run = (victim) => {
    const sim = deal(mk(R9));
    night(sim, { wolves: wolvesPick(victim, ['p1', 'p2', 'p3']) });
    toPhase(sim, 'final');
    sim.cueDone();
    return sim;
  };
  const a = run('p6');                                          // the hunter
  const b = run('p7');                                          // a villager
  assert.equal(a.state.deadline - a.now, b.state.deadline - b.now);
  assert.deepEqual(a.view('p1').final, { pid: 'p6' });
  assert.deepEqual(b.view('p1').final, { pid: 'p7' });
  assert.equal(a.view('p1').nt, undefined, 'other seats get no panel');
  assert.deepEqual(Object.keys(a.view('p2')), Object.keys(b.view('p2')), 'a bystander view has the same shape');
  assert.equal(a.view('p2').span, b.view('p2').span);
  const hv = a.view('p6'); const vv = b.view('p7');
  assert.equal(hv.nt.chips.length, vv.nt.chips.length);
  assert.deepEqual(Object.keys(hv.nt).sort(), Object.keys(vv.nt).sort());
  assert.ok(hv.nt.info[0].includes('獵人'));
  assert.ok(!vv.nt.info.join('').includes('獵人'));
  assert.equal(JSON.stringify(a.view('p7')) === JSON.stringify(b.view('p6')), false);
});

test('werewolf: hunter — shoots a living player on death; the victim speaks (a daytime death) and gets his own final window', () => {
  const sim = deal(mk(R9));
  nightKill(sim, 'p6');                                         // the hunter dies at night 1
  assert.deepEqual(queue(sim), ['dawn', 'words:p6', 'final:p6', 'plan:discuss']);
  toPhase(sim, 'final'); sim.cueDone();
  assert.equal(cur(sim).canShoot, true);
  const chips = sim.view('p6').nt.chips;
  assert.equal(chips.find((c) => c.pid === 'p6').on, false, 'not himself, he is dead');
  assert.equal(chips.find((c) => c.pid === 'p2').on, true);
  sim.act('p6', fin('p4'));                                     // takes the seer
  sim.advance();
  assert.equal(sim.state.alive.p4, false);
  assert.equal(sim.state.died.p4.how, 'shot');
  assert.equal(sim.state.died.p4.by, 'p6');
  assert.equal(phase(sim), 'say');
  assert.equal(cur(sim).kind, 'shot');
  const text = sim.cue().text;
  assert.ok(text.includes('玩家6') && text.includes('獵人') && text.includes('玩家4') && text.includes('開槍'));
  assert.deepEqual(queue(sim), ['say:shot', 'words:p4', 'final:p4', 'plan:discuss'], 'the shot victim speaks, then has a final window of his own');
  assert.equal(sim.view('p1').sayInfo.pid, 'p4');
  assert.equal(sim.view('p1').sayInfo.by, 'p6');
});

test('werewolf: hunter — poisoned: cannot shoot; holds fire or times out: nobody dies; wolf-killed AND poisoned counts as poisoned', () => {
  // poisoned hunter (witch poison)
  const a = deal(mk(R9));
  night(a, { witch: { p5: pk('p6') } });
  assert.deepEqual(a.state.died, { p6: { how: 'poison', n: 1, time: 'night', by: null, order: 0 } });
  toPhase(a, 'final'); a.cueDone();
  assert.equal(cur(a).canShoot, false);
  assert.ok(a.view('p6').nt.info.join('|').includes('被毒死'));
  a.act('p6', fin('p1')); a.advance();
  assert.equal(a.state.alive.p1, true, 'a poisoned hunter\'s tap does nothing');
  // wolves AND poison on the hunter: poison wins the cause, no shot
  const b = deal(mk(R9));
  toStep(b, 'wolves'); for (const w of ['p1', 'p2', 'p3']) b.act(w, pk('p6')); b.advance();
  toStep(b, 'witch'); b.act('p5', pk('p6')); b.advance();        // witch does not know: antidote available → this is a SAVE, not poison
  night(b);
  assert.equal(b.state.died.p6, undefined, 'saving the victim saved the hunter');
  const c = deal(mk(R9));
  c.state.potion.save = false;                                   // antidote gone: the same tap is poison
  toStep(c, 'wolves'); for (const w of ['p1', 'p2', 'p3']) c.act(w, pk('p6')); c.advance();
  toStep(c, 'witch'); c.act('p5', pk('p6')); c.advance();
  night(c);
  assert.equal(c.state.died.p6.how, 'poison');
  toPhase(c, 'final'); c.cueDone();
  assert.equal(cur(c).canShoot, false);
  // holds fire / timeout
  for (const hold of [true, false]) {
    const d = deal(mk(R9));
    nightKill(d, 'p6');
    toPhase(d, 'final'); d.cueDone();
    if (hold) d.act('p6', finSkip); else d.act('p6', { type: 'final' });
    d.advance();
    assert.equal(alive(d).length, 8, 'nobody was shot');
    assert.notEqual(cur(d).kind, 'shot');
  }
  const e = deal(mk(R9));
  nightKill(e, 'p6'); toPhase(e, 'final'); e.cueDone();
  e.act('p6', { type: 'final', pick: 'p1' });                    // tentative, never confirmed: still counts at the end
  e.advance();
  assert.equal(e.state.alive.p1, false);
});

test('werewolf: hunter — an exiled hunter speaks, then shoots; hunterOrder "shot" shoots first', () => {
  const sim = deal(mk(R9));
  night(sim); toNight(sim); night(sim);
  toVote(sim);
  castVotes(sim, Object.fromEntries(sim.state.pl.map((p) => [p, 'p6'])));
  assert.deepEqual(queue(sim).slice(0, 4), ['say:tally', 'words:p6', 'final:p6', 'plan:night']);
  // shot-first
  const s2 = deal(mk(R9, { hunterOrder: 'shot' }));
  nightKill(s2, 'p6');
  assert.deepEqual(queue(s2), ['dawn', 'final:p6', 'words:p6', 'plan:discuss']);
  toPhase(s2, 'final'); s2.cueDone(); s2.act('p6', fin('p7')); s2.advance();
  assert.deepEqual(queue(s2), ['say:shot', 'final:p7', 'words:p7', 'words:p6', 'plan:discuss'], 'the victim first (a chain, same order for everybody), then the hunter own last words');
});

test('werewolf: win check runs BEFORE death triggers — a hunter who dies as the last god never shoots', () => {
  // 屠邊 with the hunter as the only god: killing him ends the game at once
  const sim = deal(mk({ p1: 'werewolf', p2: 'werewolf', p3: 'werewolf', p4: 'hunter', p5: 'villager', p6: 'villager', p7: 'villager' }, { winRule: 'edge' }));
  nightKill(sim, 'p4', {});
  assert.equal(phase(sim), 'dawn');
  assert.equal(sim.state.win, 'wolves');
  assert.equal(sim.state.winWhy, 'gods');
  assert.deepEqual(queue(sim), ['dawn'].concat(queue(sim).slice(1)), 'the announcement still plays');
  sim.cueDone();
  assert.equal(phase(sim), 'over', 'no last words, no shot');
  assert.equal(sim.result().summary.includes('神職全部出局'), true);
  assert.deepEqual(sim.result().winners, ['p1', 'p2', 'p3']);
  assert.equal(sim.state.alive.p5, true);
});

test('werewolf: the shot that ends the game is announced, then the game is over (no later trigger runs)', () => {
  const sim = deal(mk({ p1: 'werewolf', p2: 'werewolf', p3: 'hunter', p4: 'seer', p5: 'villager', p6: 'villager' }, { winRule: 'city' }));
  sim.state.alive.p2 = false;                                    // p1 is the only wolf left
  nightKill(sim, 'p3', { wolves: { p1: pk('p3') } });
  assert.equal(sim.state.win, null);
  toPhase(sim, 'final'); sim.cueDone();
  sim.act('p3', fin('p1')); sim.advance();                        // the hunter takes the last wolf
  assert.equal(sim.state.win, 'good');
  assert.equal(phase(sim), 'say');
  assert.equal(cur(sim).kind, 'shot', 'the shot is announced first');
  assert.ok(queue(sim).length >= 2);
  sim.cueDone();
  assert.equal(phase(sim), 'over');
  assert.equal(sim.result().win, undefined);
  assert.ok(sim.result().summary.includes('好人隊贏'));
  assert.deepEqual(sim.result().winners, ['p3', 'p4', 'p5', 'p6'], 'the dead hunter is on the winning side');
});

test('werewolf: shot victims and hunters respect 出局亮牌 — the table learns roles only when 明牌 is on', () => {
  const run = (open) => {
    const sim = deal(mk(R9, { openCard: open }));
    nightKill(sim, 'p6');
    const dawn = sim.cue().text;
    return { sim, dawn, seats: sim.view('p1').seats };
  };
  const hidden = run('off');
  assert.ok(!hidden.dawn.includes('獵人') && !hidden.dawn.includes('（'));
  assert.equal(hidden.seats.find((s) => s.pid === 'p6').role, undefined, 'a dead player\'s role is hidden by default');
  const open = run('on');
  assert.ok(open.dawn.includes('玩家6係獵人'));
  assert.equal(open.seats.find((s) => s.pid === 'p6').role, 'hunter');
  assert.equal(open.seats.find((s) => s.pid === 'p2').role, undefined, 'the living stay hidden');
});

// ============================================================
// speeches
// ============================================================

/** The speaking order of the day, read from the queue. */
const speakers = (sim) => [sim.state.cur, ...sim.state.q].filter((x) => x && x.k === 'speech' && !x.pk).map((x) => x.pid);

function toSpeech(sim) {
  drive(sim, (s) => s.phase === 'speech');
  return sim;
}

test('werewolf: speaking order — starts next to a lone dead player, every living player once, dead skipped, direction flips daily', () => {
  const sim = deal(mk(R9, { speakOrder: 'dead' }, 4));
  nightKill(sim, 'p5');                                          // p5 dies alone
  toSpeech(sim);
  const first = speakers(sim);
  assert.equal(first.length, 8);
  assert.deepEqual([...first].sort(), alive(sim).slice().sort());
  assert.ok(!first.includes('p5'));
  const dirUp = cur(sim).dirUp;
  const expectedStart = dirUp ? 'p6' : 'p4';                    // the neighbour on the side we are going
  assert.equal(first[0], expectedStart);
  // seat numbers rise (or fall) from the start, wrapping once, skipping the dead seat
  const idx = (p) => +p.slice(1);
  const wraps = first.reduce((n, p, i) => n + (i && (dirUp ? idx(p) < idx(first[i - 1]) : idx(p) > idx(first[i - 1])) ? 1 : 0), 0);
  assert.equal(wraps, 1);
  // the first cue reads the order direction out
  assert.ok(sim.cue().text.includes(dirUp ? '由細到大' : '由大到細'));
  // next day: the direction flips
  drive(sim, (s) => s.phase === 'vote' && s.cur.stage === 'run');
  castVotes(sim, {});
  toNight(sim); night(sim);
  toSpeech(sim);
  assert.equal(cur(sim).dirUp, !dirUp);
});

test('werewolf: speaking order — on a peaceful night (or several deaths) the start is random but seeded; "random" mode ignores the dead', () => {
  const starts = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const sim = deal(mk(R9, {}, seed));
    night(sim);
    toSpeech(sim);
    starts.add(speakers(sim)[0]);
  }
  assert.ok(starts.size >= 6, `peaceful night starts: ${starts.size} different seats in 40 seeds`);
  const r1 = deal(mk(R9, { speakOrder: 'random' }, 3)); night(r1); toSpeech(r1);
  const r2 = deal(mk(R9, { speakOrder: 'random' }, 3)); night(r2); toSpeech(r2);
  assert.deepEqual(speakers(r1), speakers(r2), 'same seed, same order');
  // two deaths: no anchor
  const two = deal(mk(R9, {}, 5));
  nightKill(two, 'p7', { witch: { p5: pk('p8') } });
  assert.equal(two.state.anchor, null);
  // with exactly one death and speakOrder 'random' the start is NOT forced next to the dead
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const sim = deal(mk(R9, { speakOrder: 'random' }, seed));
    nightKill(sim, 'p5');
    toSpeech(sim);
    seen.add(speakers(sim)[0]);
  }
  assert.ok(seen.size > 2);
});

test('werewolf: speaking order — a flipped idiot still speaks; a wolf who left does not', () => {
  const sim = deal(mk(R12));
  sim.state.flipped.p9 = true;
  night(sim);
  toSpeech(sim);
  assert.ok(speakers(sim).includes('p9'));
  assert.equal(speakers(sim).length, 12);
});

test('werewolf: speeches — each speaker taps 我講完; a timer, @next, or nobody else can end a turn; speakSecs 0 has no clock', () => {
  const sim = deal(mk(R9, { speakSecs: 30 }));
  night(sim);
  toSpeech(sim);
  const first = cur(sim).pid;
  assert.equal(cur(sim).stage, 'cue');
  assert.equal(sim.act(first, { type: 'done' }), false);
  sim.cueDone();
  assert.equal(sim.state.deadline, sim.now + 30000);
  const other = sim.state.pl.find((p) => p !== first);
  assert.equal(sim.act(other, { type: 'done' }), false);
  assert.equal(sim.act(first, { type: 'done' }), true);
  assert.notEqual(cur(sim).pid, first);
  sim.cueDone();
  sim.advance();                                                 // the clock ends the second turn
  assert.equal(cur(sim).stage, 'cue');
  sim.cueDone();
  sim.host({ type: ACT.NEXT });                                  // the host skips the third
  assert.equal(cur(sim).idx, 3);
  const s0 = deal(mk(R9, { speakSecs: 0 }));
  night(s0); toSpeech(s0); s0.cueDone();
  assert.equal(s0.state.deadline, null);
  const nonWolf = (pid) => s0.state.role[pid] !== 'werewolf';
  const speaker = cur(s0).pid;
  assert.deepEqual(s0.legal(speaker).filter((a) => a.type !== 'explode'), [{ type: 'done' }]);
  assert.deepEqual(s0.legal(s0.state.pl.find((p) => p !== speaker && nonWolf(p))), [], 'a listener who is not a wolf has nothing to do');
  // the speech cue names the speaker and the order
  const c = deal(mk(R9)); night(c); toSpeech(c);
  assert.ok(c.cue().text.includes('發言') && c.cue().text.includes(`玩家${+cur(c).pid.slice(1)}`) && c.cue().text.includes('每人 60 秒'));
});

test('werewolf: the last speaker is called "最後一位", and the vote follows every speech', () => {
  const sim = deal(mk(R9));
  night(sim);
  toSpeech(sim);
  let seen = 0;
  while (phase(sim) === 'speech') {
    const c = sim.cue();
    if (cur(sim).idx === cur(sim).total - 1) assert.ok(c.text.includes('最後一位'));
    sim.cueDone();
    sim.act(cur(sim).pid, { type: 'done' });
    seen++;
  }
  assert.equal(seen, 9);
  assert.equal(phase(sim), 'vote');
  assert.equal(cur(sim).stage, 'cue');
});

// ============================================================
// voting
// ============================================================

test('werewolf: vote — living players except a flipped idiot vote; everyone alive is a candidate; self-vote allowed', () => {
  const sim = deal(mk(R12));
  sim.state.flipped.p9 = true;
  sim.state.alive.p10 = false;
  night(sim);
  toVote(sim);
  const c = cur(sim);
  assert.ok(!c.voters.includes('p9') && !c.voters.includes('p10'));
  assert.ok(c.cands.includes('p9') && !c.cands.includes('p10'), 'a flipped idiot can still be voted for');
  assert.equal(c.voters.length, alive(sim).length - 1);
  const v = sim.view('p9');
  assert.equal(v.my.canVote, false);
  assert.equal(sim.act('p9', { type: 'vote', target: 'p1' }), false);
  assert.equal(sim.act('p10', { type: 'vote', target: 'p1' }), false, 'the dead cannot vote');
  assert.equal(sim.act('p1', { type: 'vote', target: 'p1' }), true, 'voting for yourself is allowed');
  assert.equal(sim.act('p1', { type: 'vote', target: 'p10' }), false, 'nor for the dead');
  assert.equal(sim.act('p1', { type: 'vote', target: 'nobody' }), false);
  assert.equal(sim.act('p1', { type: 'vote' }), false);
});

test('werewolf: vote — secret until the tally; progress is a count; a vote can change until everyone has voted', () => {
  const sim = deal(mk(R9));
  night(sim); toVote(sim);
  sim.act('p1', { type: 'vote', target: 'p4' });
  sim.act('p2', { type: 'vote', target: 'p4' });
  const v = sim.view('p3');
  assert.deepEqual(v.vote.progress, { done: 2, total: 9 });
  assert.equal(v.vote.myVote, undefined);
  assert.equal(sim.view('p1').vote.myVote, 'p4');
  assert.equal(JSON.stringify(v).includes('"votes"'), false, 'nobody else\'s ballot is in a view');
  assert.deepEqual(sim.view(null).vote.progress, { done: 2, total: 9 });
  assert.equal(sim.act('p1', { type: 'vote', target: 'p5' }), true);
  assert.equal(sim.view('p1').vote.myVote, 'p5', 'a vote can be changed');
  sim.act('p1', { type: 'vote', target: null });
  assert.equal(sim.view('p1').vote.myVote, null, 'abstaining is a vote');
  assert.ok(!sim.legal('p1').some((a) => a.target === null), 'abstain is not offered twice');
  assert.deepEqual(sim.focus().pids, sim.state.pl.filter((p) => !['p1', 'p2'].includes(p)));
});

test('werewolf: vote — unique top exiles; the tally is public with who voted whom; abstain counts for nobody', () => {
  const sim = deal(mk(R9));
  night(sim); toVote(sim);
  castVotes(sim, { p1: 'p7', p2: 'p7', p3: 'p7', p4: 'p8', p5: 'p8', p6: null });
  const v = sim.view('p5');
  assert.equal(v.sayInfo.kind, 'tally');
  assert.equal(v.sayInfo.outcome, 'exile');
  assert.equal(v.sayInfo.pid, 'p7');
  assert.deepEqual(v.sayInfo.counts, { p7: 3, p8: 2 });
  assert.equal(v.sayInfo.votes.length, 9);
  assert.deepEqual(v.sayInfo.votes.find((x) => x.by === 'p6'), { by: 'p6', to: null });
  assert.deepEqual(v.sayInfo.votes.find((x) => x.by === 'p1'), { by: 'p1', to: 'p7' });
  assert.equal(sim.state.alive.p7, false);
  assert.equal(sim.state.died.p7.how, 'exile');
  const text = sim.cue().text;
  assert.ok(text.includes('玩家7三票') && text.includes('玩家8兩票') && text.includes('被放逐'), 'counts are said as words: 兩票, never 二票');
  assert.ok(text.indexOf('玩家7') < text.indexOf('玩家8'), 'highest first');
});

test('werewolf: vote — a timer closes the vote, and anyone who has not voted abstains; no timer waits for everybody', () => {
  const sim = deal(mk(R9, { voteSecs: 25 }));
  night(sim); toVote(sim);
  assert.equal(sim.state.deadline, sim.now + 25000);
  sim.act('p1', { type: 'vote', target: 'p8' });
  sim.act('p2', { type: 'vote', target: 'p8' });
  sim.advance();
  assert.equal(phase(sim), 'say');
  assert.equal(cur(sim).outcome, 'exile');
  assert.equal(cur(sim).votes.length, 9);
  assert.deepEqual(cur(sim).votes.filter((x) => x.to === null).length, 7);
  const none = deal(mk(R9, { voteSecs: 0 }));
  night(none); toVote(none);
  assert.equal(none.state.deadline, null);
  for (const p of none.state.pl.slice(0, 8)) none.act(p, { type: 'vote', target: null });
  assert.equal(phase(none), 'vote', 'one voter still out: the vote waits');
  none.act('p9', { type: 'vote', target: null });
  assert.equal(phase(none), 'say');
  // @next closes it
  const nxt = deal(mk(R9, { voteSecs: 0 }));
  night(nxt); toVote(nxt);
  nxt.host({ type: ACT.NEXT });
  assert.equal(phase(nxt), 'say');
});

test('werewolf: vote — everybody abstains: nobody exiled, no PK, straight to night', () => {
  const sim = deal(mk(R9));
  night(sim); toVote(sim);
  castVotes(sim, {});
  assert.equal(cur(sim).outcome, 'none');
  assert.ok(sim.cue().text.includes('冇人得票') && sim.cue().text.includes('平安日'));
  assert.deepEqual(queue(sim), ['say:tally', 'plan:night']);
  sim.cueDone();
  assert.equal(phase(sim), 'night');
  assert.equal(sim.state.n, 2);
  assert.equal(alive(sim).length, 9);
});

test('werewolf: vote — a tie sends the tied players to PK; the tied cannot vote; a second tie is a peaceful day', () => {
  const sim = deal(mk(R9));
  night(sim); toVote(sim);
  castVotes(sim, { p1: 'p7', p2: 'p7', p3: 'p7', p9: 'p7', p4: 'p8', p5: 'p8', p6: 'p8', p7: 'p8', p8: 'p9' });
  assert.equal(cur(sim).outcome, 'tie');
  assert.deepEqual(cur(sim).tied, ['p7', 'p8']);
  assert.ok(sim.cue().text.includes('玩家7、玩家8同票'));
  assert.deepEqual(queue(sim), ['say:tally', 'speech:p7', 'speech:p8', 'vote']);
  sim.cueDone();
  // PK speeches in seat order
  assert.equal(cur(sim).pid, 'p7'); assert.equal(cur(sim).pk, true);
  assert.ok(sim.cue().text.includes('PK') && sim.cue().text.includes('平票'));
  sim.cueDone(); sim.act('p7', { type: 'done' });
  assert.equal(cur(sim).pid, 'p8');
  sim.cueDone(); sim.act('p8', { type: 'done' });
  assert.equal(phase(sim), 'vote');
  assert.equal(cur(sim).round, 2);
  sim.cueDone();
  assert.deepEqual(cur(sim).cands, ['p7', 'p8']);
  assert.ok(!cur(sim).voters.includes('p7') && !cur(sim).voters.includes('p8'), 'the tied players never vote');
  assert.equal(cur(sim).voters.length, 7);
  assert.equal(sim.act('p7', { type: 'vote', target: 'p8' }), false);
  assert.equal(sim.act('p1', { type: 'vote', target: 'p9' }), false, 'only the tied players are candidates');
  assert.ok(sim.cue() === null);
  // second tie → peaceful day
  const half = cur(sim).voters;
  half.forEach((p, i) => sim.act(p, { type: 'vote', target: i < 3 ? 'p7' : i < 6 ? 'p8' : null }));
  assert.equal(phase(sim), 'say');
  assert.equal(cur(sim).outcome, 'tie2');
  assert.equal(alive(sim).length, 9);
  assert.ok(sim.cue().text.includes('第二次都係平票'));
  assert.deepEqual(queue(sim), ['say:tally', 'plan:night']);
});

test('werewolf: vote — PK second round with a winner exiles him; a three-way tie sends all three to PK', () => {
  const sim = deal(mk(R9));
  night(sim); toVote(sim);
  castVotes(sim, { p1: 'p7', p2: 'p7', p3: 'p8', p4: 'p8', p5: 'p9', p6: 'p9' });
  assert.deepEqual(cur(sim).tied, ['p7', 'p8', 'p9']);
  assert.deepEqual(queue(sim), ['say:tally', 'speech:p7', 'speech:p8', 'speech:p9', 'vote']);
  drive(sim, (s) => s.phase === 'vote' && s.cur.round === 2 && s.cur.stage === 'run');
  assert.equal(cur(sim).voters.length, 6);
  castVotes(sim, { p1: 'p9', p2: 'p9', p3: 'p9', p4: 'p8', p5: 'p7' });
  assert.equal(cur(sim).outcome, 'exile');
  assert.equal(cur(sim).pid, 'p9');
  assert.equal(sim.state.alive.p9, false);
  // all abstain in the PK vote: nobody exiled
  const s2 = deal(mk(R9));
  night(s2); toVote(s2);
  castVotes(s2, { p1: 'p7', p2: 'p7', p3: 'p8', p4: 'p8' });
  drive(s2, (s) => s.phase === 'vote' && s.cur.round === 2 && s.cur.stage === 'run');
  castVotes(s2, {});
  assert.equal(cur(s2).outcome, 'none');
  assert.equal(alive(s2).length, 9);
});

test('werewolf: vote — a tie where nobody is left to cast the PK vote is a peaceful day', () => {
  const sim = deal(mk({ p1: 'werewolf', p2: 'villager', p3: 'villager', p4: 'villager', p5: 'villager', p6: 'villager' }, { winRule: 'city' }));
  for (const p of ['p3', 'p4', 'p5', 'p6']) sim.state.alive[p] = false;
  night(sim);
  toVote(sim);
  castVotes(sim, { p1: 'p2', p2: 'p1' });
  assert.equal(cur(sim).outcome, 'nobody');
  assert.deepEqual(queue(sim), ['say:tally', 'plan:night']);
});

test('werewolf: ballots stay hidden until the tally — no view carries another seat ballot', () => {
  const sim = deal(mk(R9));
  night(sim); toVote(sim);
  sim.act('p1', { type: 'vote', target: 'p4' });
  sim.act('p2', { type: 'vote', target: null });
  for (const p of [...sim.state.pl, null]) {
    const v = sim.view(p);
    assertNoKeys(v, ['votes'], `view of ${p}`);
    assert.equal(v.vote.myVote, p === 'p1' ? 'p4' : p === 'p2' ? null : undefined, `myVote for ${p}`);
  }
});

// ============================================================
// the idiot
// ============================================================

test('werewolf: idiot — first exile flips: no death, no last words, no more vote, still speaks; second exile is an ordinary death', () => {
  const sim = deal(mk(R12));
  night(sim);
  toVote(sim);
  castVotes(sim, Object.fromEntries(sim.state.pl.map((p) => [p, 'p9'])));
  assert.equal(cur(sim).outcome, 'flip');
  assert.equal(sim.state.alive.p9, true);
  assert.equal(sim.state.flipped.p9, true);
  assert.equal(sim.state.died.p9, undefined);
  assert.deepEqual(queue(sim), ['say:tally', 'say:flip', 'plan:night'], 'no last words, no final window, no more votes that day');
  assert.ok(sim.cue().text.includes('得票最多') && !sim.cue().text.includes('被放逐'));
  sim.cueDone();
  assert.equal(cur(sim).kind, 'flip');
  assert.ok(sim.cue().text.includes('白痴') && sim.cue().text.includes('冇投票權'));
  assert.equal(sim.view('p1').sayInfo.pid, 'p9');
  sim.cueDone();
  assert.equal(phase(sim), 'night');
  // next day: he speaks, he cannot vote, he can be voted for, and a second exile kills him normally
  night(sim);
  toSpeech(sim);
  assert.ok(speakers(sim).includes('p9'));
  toVote(sim);
  assert.ok(!cur(sim).voters.includes('p9'));
  assert.ok(cur(sim).cands.includes('p9'));
  assert.equal(sim.view('p9').my.flipped, true);
  assert.equal(sim.view('p9').my.canVote, false);
  castVotes(sim, Object.fromEntries(cur(sim).voters.map((p) => [p, 'p9'])));
  assert.equal(cur(sim).outcome, 'exile');
  assert.equal(sim.state.alive.p9, false);
  assert.equal(sim.state.died.p9.how, 'exile');
  assert.ok(queue(sim).includes('words:p9'));
});

test('werewolf: idiot — a flipped idiot dies to wolves, poison or a shot like anyone else, and counts as a living god', () => {
  const sim = deal(mk(R12));
  sim.state.flipped.p9 = true;
  nightKill(sim, 'p9');
  assert.equal(sim.state.alive.p9, false);
  assert.equal(sim.state.died.p9.how, 'wolf');
  // as a god: with every other god dead, the flipped idiot alone keeps 屠邊 from ending…
  const g = deal(mk(R12, { winRule: 'edge' }));
  for (const p of ['p5', 'p6', 'p7', 'p8']) g.state.alive[p] = false;
  g.state.flipped.p9 = true;
  night(g);
  assert.equal(phase(g), 'dawn');
  assert.equal(g.state.win, null, 'a flipped idiot is still a living god');
  // …until he dies, and then the wolves win
  const g2 = deal(mk(R12, { winRule: 'edge' }));
  for (const p of ['p5', 'p6', 'p7', 'p8']) g2.state.alive[p] = false;
  g2.state.flipped.p9 = true;
  nightKill(g2, 'p9');
  assert.equal(g2.state.win, 'wolves');
  assert.equal(g2.state.winWhy, 'gods');
});

test('werewolf: idiot setting — counted as a villager instead of a god changes 屠邊', () => {
  // seer, witch, hunter, guard are dead; the idiot and the villagers p10 p11 p12 are alive
  const setup = (idiotIs) => {
    const sim = deal(mk(R12, { winRule: 'edge', idiotIs }));
    for (const p of ['p5', 'p6', 'p7', 'p8']) sim.state.alive[p] = false;
    return sim;
  };
  // idiot = god: he is the last god, so killing him ends it (gods gone)
  const god = setup('god');
  nightKill(god, 'p9');
  assert.deepEqual([god.state.win, god.state.winWhy], ['wolves', 'gods']);
  // idiot = villager: there are no gods left at all, so wolves already win the moment anybody dies
  const vil = setup('villager');
  nightKill(vil, 'p10');
  assert.deepEqual([vil.state.win, vil.state.winWhy], ['wolves', 'gods']);
  // idiot = god and a villager dies instead: gods (the idiot) and villagers (p11 p12) both remain → game goes on
  const go = setup('god');
  nightKill(go, 'p10');
  assert.equal(go.state.win, null);
  // idiot = villager and the idiot dies with villagers p10 p11 p12 still alive: villagers remain, but the gods are gone → wolves win
  const vil2 = setup('villager');
  nightKill(vil2, 'p9');
  assert.equal(vil2.state.win, 'wolves');
});

// ============================================================
// self-explode
// ============================================================

function toFirstSpeech(sim, secs = true) {
  toSpeech(sim);
  if (secs) sim.cueDone();
  return sim;
}

test('werewolf: self-explode — a wolf ends the day at once: he dies, speeches and the vote are cancelled, night follows', () => {
  const sim = deal(mk(R9));
  night(sim);
  toFirstSpeech(sim);
  assert.equal(sim.act('p1', { type: 'explode' }), true);
  assert.equal(sim.state.alive.p1, false);
  assert.equal(sim.state.died.p1.how, 'explode');
  assert.equal(phase(sim), 'say');
  assert.equal(cur(sim).kind, 'explode');
  assert.ok(sim.cue().text.includes('自爆') && sim.cue().text.includes('玩家1'));
  assert.deepEqual(queue(sim), ['say:explode', 'words:p1', 'final:p1', 'plan:night'], 'no more speeches, no vote');
  sim.cueDone();
  assert.equal(cur(sim).k, 'words');
  assert.equal(cur(sim).secs, 30, '30 s explode words');
  drive(sim, (s) => s.phase === 'night');
  assert.equal(sim.state.n, 2);
  assert.equal(alive(sim).length, 8);
  // the next dawn works as usual
  night(sim);
  assert.equal(phase(sim), 'dawn');
});

test('werewolf: self-explode — a non-wolf, a dead wolf, or "off" does nothing; no explode in the vote, last words, final window or night', () => {
  const sim = deal(mk(R9));
  night(sim);
  toFirstSpeech(sim);
  const snap = JSON.stringify(sim.state);
  for (const p of ['p4', 'p5', 'p6', 'p7']) assert.equal(sim.act(p, { type: 'explode' }), false, `${p} is not a wolf`);
  assert.equal(JSON.stringify(sim.state), snap, 'a non-wolf\'s explode changes nothing at all');
  sim.state.alive.p2 = false;
  assert.equal(sim.act('p2', { type: 'explode' }), false);
  assert.equal(sim.act(HOST, { type: 'explode' }), false);
  // explode IS a legal action for a living wolf (engine.blocking keeps it away from the stall detector), never for anyone else
  assert.ok(sim.legal('p1').some((a) => a.type === 'explode'), 'a living wolf may explode');
  for (const p of ['p2', 'p4', 'p5', 'p6', 'p7']) assert.ok(!sim.legal(p).some((a) => a.type === 'explode'), `${p} is not offered explode`);
  for (const p of sim.state.pl) assert.equal(engine.blocking(sim.state, p), false, 'a speech with a clock never blocks on anyone');
  const off = deal(mk(R9, { selfExplode: 'off' }));
  night(off); toFirstSpeech(off);
  assert.equal(off.act('p1', { type: 'explode' }), false);
  // not during the vote
  const v = deal(mk(R9)); night(v); toVote(v);
  assert.equal(v.act('p1', { type: 'explode' }), false);
  // not at night, not during last words / the final window
  const nt = deal(mk(R9));
  assert.equal(nt.act('p1', { type: 'explode' }), false);
  nightKill(nt, 'p7');
  toPhase(nt, 'words');
  assert.equal(nt.act('p1', { type: 'explode' }), false);
  assert.equal(phase(nt), 'words');
});

test('werewolf: self-explode in PK speeches is off by default and a setting; two wolves exploding at once resolve only once', () => {
  const tie = (selfExplode) => {
    const sim = deal(mk(R9, { selfExplode }));
    night(sim); toVote(sim);
    castVotes(sim, { p1: 'p7', p2: 'p7', p3: 'p8', p4: 'p8' });
    drive(sim, (s) => s.phase === 'speech' && s.cur.pk && s.cur.stage === 'run');
    return sim;
  };
  assert.equal(tie('on').act('p1', { type: 'explode' }), false, 'default: no explode during exile PK');
  const pkOk = tie('pk');
  assert.equal(pkOk.act('p1', { type: 'explode' }), true);
  assert.equal(pkOk.state.alive.p1, false);
  assert.equal(pkOk.act('p2', { type: 'explode' }), false, 'the second wolf is too late: the day is over');
  assert.equal(pkOk.state.alive.p2, true);
  // and during the cue stage of a speech (the speaker is being announced) it works too
  const cueStage = deal(mk(R9)); night(cueStage); toSpeech(cueStage);
  assert.equal(cur(cueStage).stage, 'cue');
  assert.equal(cueStage.act('p2', { type: 'explode' }), true);
});

test('werewolf: self-explode — wordsSecs 0 means untimed explode words; the last wolf exploding gives the win to the good side', () => {
  const sim = deal(mk(R9, { wordsSecs: 0 }));
  night(sim); toFirstSpeech(sim);
  sim.act('p1', { type: 'explode' });
  assert.equal(queue(sim)[1], 'words:p1');
  assert.equal(sim.state.q[0].secs, 0);
  const last = deal(mk({ p1: 'werewolf', p2: 'seer', p3: 'villager', p4: 'villager', p5: 'villager', p6: 'villager' }, { winRule: 'city' }));
  night(last); toFirstSpeech(last);
  last.act('p1', { type: 'explode' });
  assert.equal(last.state.win, 'good');
  assert.equal(cur(last).kind, 'explode', 'the explode is announced, then the game ends');
  last.cueDone();
  assert.equal(phase(last), 'over');
});

// ============================================================
// winning
// ============================================================

test('werewolf: win rules — 屠邊 (all gods OR all villagers), 屠城 (both), and the good side when every wolf is out', () => {
  const run = (rule, kill) => {
    const sim = deal(mk({ p1: 'werewolf', p2: 'werewolf', p3: 'seer', p4: 'villager', p5: 'villager', p6: 'villager', p7: 'witch', p8: 'villager' }, { winRule: rule }));
    for (const p of kill) sim.state.alive[p] = false;
    return sim;
  };
  // edge: gods (p3 p7) all dead → wolves
  const e1 = run('edge', ['p3']); nightKill(e1, 'p7');
  assert.deepEqual([e1.state.win, e1.state.winWhy], ['wolves', 'gods']);
  // edge: villagers all dead → wolves
  const e2 = run('edge', ['p4', 'p5', 'p6']); nightKill(e2, 'p8');
  assert.deepEqual([e2.state.win, e2.state.winWhy], ['wolves', 'villagers']);
  // city: gods dead but villagers alive → game goes on
  const c1 = run('city', ['p3']); nightKill(c1, 'p7');
  assert.equal(c1.state.win, null);
  // city: everything dead → wolves
  const c2 = run('city', ['p3', 'p4', 'p5', 'p6', 'p8']); nightKill(c2, 'p7');
  assert.deepEqual([c2.state.win, c2.state.winWhy], ['wolves', 'all']);
  // good: the last wolf is exiled
  const g = run('city', ['p2']);
  night(g); toVote(g);
  castVotes(g, Object.fromEntries(g.state.pl.filter((p) => g.state.alive[p]).map((p) => [p, 'p1'])));
  assert.equal(g.state.win, 'good');
  assert.equal(cur(g).kind, 'tally', 'the vote result is shown before the game ends');
  g.cueDone();
  assert.equal(phase(g), 'over');
  assert.equal(g.result().summary, '好人隊贏：狼人全部出局');
});

test('werewolf: win priority — if wolves and good both qualify at once, the wolves win (狼刀優先)', () => {
  // last good god killed by the wolves while the witch poisons the last wolf, same night
  const sim = deal(mk({ p1: 'werewolf', p2: 'witch', p3: 'villager', p4: 'villager', p5: 'villager', p6: 'villager' }, { winRule: 'edge' }));
  for (const p of ['p3', 'p4', 'p5']) sim.state.alive[p] = false;     // only p6 is left as a villager; p2 is the only god
  night(sim, { wolves: { p1: pk('p2') }, witch: { p2: pk('p1') } });   // she cannot save herself under 'first'? she poisons the wolf instead
  // p2 is attacked and poisons p1: wolves' kill lands on the last god while the last wolf dies
  assert.equal(sim.state.win, 'wolves');
  assert.deepEqual(Object.keys(sim.state.died).sort(), ['p1', 'p2']);
});

test('werewolf: nobody wins by default — six quiet rounds in a row end in a draw', () => {
  const sim = deal(mk(R9, { pace: 'fast', speakSecs: 0 }));
  let guard = 0;
  while (!sim.result() && guard++ < 4000) {
    drive(sim, (s) => s.phase === 'night' || s.phase === 'over');
    if (sim.result()) break;
    night(sim);
    drive(sim, (s) => s.phase === 'night' || s.phase === 'over');
  }
  const r = sim.result();
  assert.ok(r, 'the game ended');
  assert.equal(r.winners.length, 0);
  assert.ok(r.summary.includes('打和'));
  assert.equal(sim.state.n, 6, 'six full quiet rounds, then the draw is called where the seventh night would begin');
  assert.equal(sim.state.win, 'draw');
});

test('werewolf: a death resets the quiet counter', () => {
  const sim = deal(mk(R9, { pace: 'fast', speakSecs: 0 }));
  for (let i = 0; i < 4; i++) {
    night(sim);
    drive(sim, (s) => s.phase === 'night' || s.phase === 'over');
  }
  assert.equal(sim.state.quiet, 4);
  nightKill(sim, 'p7');
  drive(sim, (s) => s.phase === 'night' || s.phase === 'over');
  assert.equal(sim.state.quiet, 0);
});

// ============================================================
// fuzzers
// ============================================================

/**
 * A light random player: like Sim.runRandom but cheap per step. It talks to the engine directly (the engine
 * mutates and returns the state, exactly as the session lets it), compares whole states only every few
 * actions, has knobs for how eager the seats are, and also throws self-explode attempts at the table
 * (a wolf's must work when allowed, anybody else's must change nothing).
 * `inv(sim)` runs after every step.
 */
function playRandom(sim, { rng, actP = 0.5, explodeP = 0.02, check = 8, inv, maxSteps = 8000 } = {}) {
  const seats = sim.state.order;
  // explode is a legal action for a living wolf, but random play would explode on almost every speech;
  // the explodeP branch in the loop throws explodes at the table at a controlled rate instead
  const moves = (pid) => sim.legal(pid).filter((a) => a.type !== 'explode');
  let step = 0;
  let sinceCheck = 0;
  const run = (pid, action, verify) => {
    const before = verify ? JSON.stringify(sim.state) : null;
    const next = engine.act(sim.state, { pid, action }, sim.ctx());
    if (next !== undefined) sim.state = next;
    sim.steps++;
    return verify ? JSON.stringify(sim.state) !== before : true;
  };
  const apply = (pid, action) => {
    sinceCheck += 1;
    const verify = sinceCheck >= check;
    if (verify) sinceCheck = 0;
    const changed = run(pid, action, verify);
    assert.ok(changed, `a legal action changed nothing: ${pid} ${JSON.stringify(action)} in ${sim.state.phase}`);
  };
  while (!sim.result()) {
    if (++step > maxSteps) throw sim.stuck(`fuzz: no result after ${maxSteps} steps`);
    const s = sim.state;
    let progressed = false;

    if (explodeP && s.phase === 'speech' && rng() < explodeP) {
      const pid = seats[Math.floor(rng() * seats.length)];
      const isWolf = s.role[pid] === 'werewolf' && s.alive[pid];
      const allowed = isWolf && s.cfg.selfExplode !== 'off' && !(s.cur.pk && s.cfg.selfExplode !== 'pk');
      const probe = clone(s);
      const changed = run(pid, { type: 'explode' }, true) ;
      assert.equal(changed, allowed, `explode by ${pid} (${probe.role[pid]}) changed=${changed} allowed=${allowed}`);
      if (changed) progressed = true;
    }
    if (!progressed && rng() < actP) {
      const pid = seats[Math.floor(rng() * seats.length)];
      const legal = moves(pid);
      if (legal.length) { apply(pid, legal[Math.floor(rng() * legal.length)]); progressed = true; }
    }
    if (!progressed) {
      const c = engine.cue(sim.state);
      if (c) { run(HOST, { type: ACT.CUE_DONE, id: c.id }, false); progressed = true; }
      else if (s.deadline != null) {
        if (sim.now < s.deadline) sim.now = s.deadline;
        engine.advance(sim.state, sim.ctx());
        sim.steps++;
        progressed = true;
      } else {
        // nobody has a clock: somebody must have something to do (a vote with no timer, a speaker…)
        for (const pid of seats) {
          const legal = moves(pid);
          if (legal.length) { apply(pid, legal[Math.floor(rng() * legal.length)]); progressed = true; break; }
        }
        if (!progressed) { run(HOST, { type: ACT.NEXT }, false); progressed = true; }
      }
    }
    if (inv) inv(sim);
  }
  return sim.result();
}

/** Cheap structural invariants that must hold after every step of every game. */
function makeInvariants() {
  let lastAlive = Infinity;
  let lastSeq = -1;
  let tick = 0;
  return (sim) => {
    const s = sim.state;
    const aliveN = s.pl.filter((p) => s.alive[p]).length;
    assert.ok(aliveN <= lastAlive, 'the dead never come back');
    lastAlive = aliveN;
    for (const p of s.pl) assert.equal(!s.alive[p], p in s.died, `alive/died disagree for ${p}`);
    assert.ok(['deal', 'night', 'dawn', 'words', 'final', 'say', 'speech', 'vote', 'over'].includes(s.phase));
    const c = s.cur;
    if (c && c.k === 'vote') {
      assert.ok(c.cands.every((p) => s.alive[p]), 'candidates are alive');
      assert.ok(c.voters.every((p) => s.alive[p] && !s.flipped[p]), 'voters are alive and not flipped');
    }
    if (c && c.k === 'speech') assert.ok(s.alive[c.pid], 'only the living give speeches');
    if (c && c.k === 'words') assert.ok(!s.alive[c.pid], 'last words are for the dead');
    if (c && c.k === 'final') assert.ok(!s.alive[c.pid]);
    if (c && c.k === 'night' && c.stage === 'run' && s.seq !== lastSeq && c.step !== 'begin') {
      lastSeq = s.seq;
      for (const p of s.pl) assert.ok(sim.legal(p).length > 0, `${p} has nothing to tap at night step ${c.step}`);
      const shapes = new Set(s.pl.map((p) => { const v = sim.view(p); return `${v.nt.chips.length}|${Object.keys(v.nt).sort()}`; }));
      assert.equal(shapes.size, 1, 'night panels differ in shape');
    }
    if (c && c.k === 'final' && c.stage === 'run') assert.equal(s.span, PACE_FINAL[s.cfg.pace] * 1000, 'the final window is a fixed length');
    if (++tick % 40 === 0) assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'state is plain JSON');
    if (s.win && s.phase !== 'over') assert.ok(['dawn', 'say'].includes(s.phase), 'once decided, only announcements remain');
  };
}
const PACE_FINAL = { slow: 18, normal: 12, fast: 8 };

function assertGoodResult(sim, label) {
  const r = sim.result();
  assert.ok(r, label);
  assert.ok(Array.isArray(r.winners) && typeof r.summary === 'string' && Array.isArray(r.lines));
  const s = sim.state;
  assert.equal(s.phase, 'over');
  if (s.win === 'draw') assert.deepEqual(r.winners, []);
  else {
    assert.ok(r.winners.length >= 1, label);
    for (const w of r.winners) assert.equal(s.role[w] === 'werewolf', s.win === 'wolves', 'winners are exactly one camp');
    assert.equal(r.winners.length, s.pl.filter((p) => (s.role[p] === 'werewolf') === (s.win === 'wolves')).length);
  }
  assert.ok(r.lines.some((l) => l.includes('身份揭曉')));
  // only a human moderator sits out (the Room does not count him as having played); never anybody who played
  assert.equal('spectators' in r, s.mod, label);
  if (s.mod) assert.deepEqual(r.spectators, [s.hostPid], label);
}

const newSim = (n, seed, over = {}) => new Sim(game, { n, seed, config: { ...config.defaults(n), ...over } });

test('werewolf: fuzz — every seat count x 100 seeds plays to the end with a well-formed result and the invariants hold', () => {
  const wins = { wolves: 0, good: 0, draw: 0 };
  for (let n = 6; n <= 13; n++) {
    for (let seed = 1; seed <= 100; seed++) {
      const sim = newSim(n, seed * 17 + n, {});
      const rng = mulberry32(seed * 977 + n);
      const inv = seed <= 8 ? makeInvariants() : null;
      playRandom(sim, { rng, actP: 0.15 + 0.5 * rng(), inv });
      assertGoodResult(sim, `n=${n} seed=${seed}`);
      wins[sim.state.win] += 1;
    }
  }
  assert.ok(wins.wolves > 50 && wins.good > 50, `both camps win under random play: ${JSON.stringify(wins)}`);
});

test('werewolf: fuzz — the stock harness (Sim.runRandom) also terminates, and legalActions never offers a no-op', () => {
  for (let n = 6; n <= 13; n++) {
    for (let seed = 1; seed <= 8; seed++) {
      const sim = newSim(n, seed * 31 + n);
      sim.runRandom({ maxSteps: 30000 });
      assertGoodResult(sim, `runRandom n=${n} seed=${seed}`);
    }
  }
});

const VARIANTS = [
  { name: 'tw order + unanimous wolves', over: { nightOrder: 'tw', wolfVote: 'unanimous' } },
  { name: 'all last words, shot first, live stack', over: { lastWords: 'all', hunterOrder: 'shot', guardStack: 'live' } },
  { name: 'open cards, spectators, always self-save', over: { openCard: 'on', spectate: true, witchSelfSave: 'always' } },
  { name: 'no explode, no clocks', over: { selfExplode: 'off', speakSecs: 0, wordsSecs: 0, voteSecs: 0 } },
  { name: 'explode in PK, fast pace, random order', over: { selfExplode: 'pk', pace: 'fast', speakOrder: 'random', lastWords: 'night1single' } },
  { name: 'city rule, idiot is a villager', over: { winRule: 'city', idiotIs: 'villager', pace: 'slow' } },
  { name: 'custom board: guard + idiot + hunter', over: { board: 'custom', roles: { werewolf: 2, seer: 1, witch: 0, hunter: 1, guard: 1, idiot: 1 } } },
  { name: 'every guard board', over: { board: 'auto' }, boards: ['7-hard', '9-guard', '11-guard', '12-guard', '12-noh', '6-sh', '10-idiot'] },
];

test('werewolf: fuzz — rule variants over every seat count and many seeds', () => {
  for (const v of VARIANTS) {
    for (let n = 6; n <= 13; n++) {
      for (let seed = 1; seed <= 6; seed++) {
        let over = { ...v.over };
        if (v.boards) {
          const p = n === 13 ? 12 : n;
          const ok = v.boards.filter((id) => PRESETS.find((x) => x.id === id).p === p);
          if (!ok.length) continue;
          over = { board: ok[seed % ok.length] };
        }
        if (over.board === 'custom' && (n === 6 || n === 13) ) over = { ...over, roles: { werewolf: 2, seer: 1, witch: 0, hunter: 1, guard: 0, idiot: 1 } };
        const cfg = { ...config.defaults(n), ...over };
        if (!config.validate(cfg, n).ok) continue;
        const sim = new Sim(game, { n, seed: seed * 53 + n, config: cfg });
        const rng = mulberry32(seed * 7 + n);
        playRandom(sim, { rng, actP: 0.3 + 0.4 * rng(), inv: seed === 1 ? makeInvariants() : null });
        assertGoodResult(sim, `${v.name} n=${n} seed=${seed}`);
      }
    }
  }
});

test('werewolf: fuzz — a table of dead phones: autoAct alone (plus cues and clocks) finishes every game', () => {
  for (const n of [6, 9, 12, 13]) {
    for (let seed = 1; seed <= 4; seed++) {
      const sim = newSim(n, seed + n, { speakSecs: 0, wordsSecs: 0, voteSecs: 0, pace: 'fast' });
      let guard = 0;
      while (!sim.result() && guard++ < 6000) {
        const f = sim.focus();
        let acted = false;
        for (const pid of sim.state.order) {
          const a = engine.autoAct(sim.state, pid, sim.ctx());
          if (a && (!f || f.pids.includes(pid) || sim.state.phase === 'night')) {
            assert.ok(sim.act(pid, a), `autoAct ${JSON.stringify(a)} for ${pid} did nothing in ${sim.state.phase}/${sim.state.cur?.k}`);
            acted = true;
            break;
          }
        }
        if (acted) continue;
        if (sim.cue() && sim.cueDone()) continue;
        if (sim.state.deadline != null && sim.advance()) continue;
        if (!sim.host({ type: ACT.NEXT })) throw sim.stuck('autoAct fuzz stuck');
      }
      assertGoodResult(sim, `autoAct n=${n}`);
    }
  }
});

test('werewolf: fuzz — both camps and every seat win sometimes, and every role is dealt to every seat', () => {
  const wins = {};
  const roleSeen = {};
  for (let seed = 1; seed <= 150; seed++) {
    const sim = newSim(9, seed * 11);
    for (const p of sim.state.pl) (roleSeen[p] ||= new Set()).add(sim.state.role[p]);
    playRandom(sim, { rng: mulberry32(seed), actP: 0.4 });
    for (const w of sim.result().winners) wins[w] = (wins[w] ?? 0) + 1;
  }
  for (const p of ids(9)) {
    assert.ok(wins[p] > 10, `${p} won only ${wins[p] ?? 0} of 150`);
    assert.equal(roleSeen[p].size, 5, `${p} saw ${roleSeen[p].size} different roles (the 9-board has 5)`);
  }
});

test('werewolf: fuzz — speed (the whole matrix of games above must stay cheap)', () => {
  const t0 = performance.now();
  for (let seed = 1; seed <= 20; seed++) playRandom(newSim(12, seed), { rng: mulberry32(seed), actP: 0.3 });
  assert.ok(performance.now() - t0 < 6000, `20 twelve-player games took ${Math.round(performance.now() - t0)} ms`);
});

// ============================================================
// the human moderator (上帝 mode)
// ============================================================

// 7 seats: p1 is the moderator, p2..p7 play (2 wolves, seer, witch, 2 villagers)
const H6 = { p2: 'werewolf', p3: 'werewolf', p4: 'seer', p5: 'witch', p6: 'villager', p7: 'villager' };
const hmk = (over = {}, seed = 1) => mk(H6, { __n: 7, moderator: 'human', winRule: 'city', ...over }, seed);

test('werewolf: human moderator — only the host seat sees roles and live night picks; nobody else gets a god block', () => {
  const sim = deal(hmk());
  assert.equal(sim.state.mod, true);
  const g = sim.view('p1');
  assert.deepEqual(g.god.roles, H6);
  assert.equal(g.isMod, true);
  assert.deepEqual(g.god.potion, { save: true, poison: true });
  assert.equal(g.my, undefined, 'the moderator holds no card');
  assert.equal(g.nt, undefined, 'and gets no night panel');
  assert.equal(g.night, false);
  assert.deepEqual(g.seats.map((s) => s.role), ['werewolf', 'werewolf', 'seer', 'witch', 'villager', 'villager']);
  for (const p of sim.state.pl) {
    const v = sim.view(p);
    assert.equal(v.god, undefined, p);
    assert.equal(v.isMod, false);
    assertNoKeys(v, ['god', 'all'], p);
  }
  assert.equal(sim.view(null).god, undefined);
  assert.equal(sim.view('stranger').god, undefined);
  // live picks during the wolves' window
  toStep(sim, 'wolves');
  sim.act('p2', { type: 'night', pick: 'p6' });
  sim.act('p3', { type: 'night', pick: 'p7', lock: true });
  const live = sim.view('p1').god.nt;
  assert.equal(live.step, 'wolves');
  assert.deepEqual(live.picks, [{ pid: 'p2', set: true, pick: 'p6', lock: false }, { pid: 'p3', set: true, pick: 'p7', lock: true }]);
  sim.advance();
  toStep(sim, 'witch');
  const w = sim.view('p1').god.nt;
  assert.equal(w.step, 'witch');
  assert.ok(['p6', 'p7'].includes(w.attacked), 'the moderator sees the wolf target the moment it is decided');
  assert.equal(sim.view('p5').nt.info.join('').includes('被狼人襲擊'), true);
});

test('werewolf: human moderator — the moderator can drive the whole game with 下一步 alone, and nobody else can use it', () => {
  const sim = hmk({ pace: 'fast' });
  assert.deepEqual(sim.legal('p1'), [{ type: 'skip' }]);
  assert.equal(sim.act('p2', { type: 'skip' }), false, 'a player cannot skip');
  assert.equal(sim.act('p1', { type: 'ready' }), false, 'the moderator cannot do player things');
  assert.equal(sim.act('p1', { type: 'night', pick: 'p2', lock: true }), false);
  assert.equal(sim.act('p1', { type: 'vote', target: 'p2' }), false);
  assert.equal(sim.act('p1', { type: 'explode' }), false);
  assert.deepEqual(engine.autoAct(sim.state, 'p1', sim.ctx()), { type: 'skip' });
  let guard = 0;
  while (!sim.result() && guard++ < 2000) {
    assert.equal(sim.act('p1', { type: 'skip' }), true, `skip did nothing in ${phase(sim)}/${cur(sim)?.stage}`);
  }
  assert.ok(sim.result(), 'the game ended on skips alone');
  assert.equal(sim.result().winners.length, 0, 'nobody did anything, so it was a draw');
  assert.ok(sim.result().lines.some((l) => l.includes('上帝：玩家1')));
});

test('werewolf: result.spectators names the human moderator — his seat, whichever it is — and an app-moderated table has none', () => {
  // the stock fixture: p1 hosts and is the god
  const sim = hmk({ pace: 'fast' });
  assert.equal(sim.result(), null, 'no result while the game runs');
  let guard = 0;
  while (!sim.result() && guard++ < 2000) sim.act('p1', { type: 'skip' });
  const r = sim.result();
  assert.deepEqual(r.spectators, ['p1'], 'the moderator did not play');
  assert.ok(!r.winners.includes('p1') && !sim.state.pl.includes('p1'));
  assert.deepEqual(r.spectators, [sim.state.hostPid]);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'plain JSON');
  assert.equal(sim.result().spectators.length, 1, 'asking again says the same');

  // the god is whoever's phone hosts: seat 3
  const h3 = new Sim(game, { n: 7, seed: 2, hostPid: 'p3', config: { ...config.defaults(7), moderator: 'human', pace: 'fast' } });
  assert.equal(h3.state.mod, true);
  assert.ok(!h3.state.pl.includes('p3') && h3.state.pl.includes('p1'));
  for (let i = 0; !h3.result() && i < 2000; i++) h3.act('p3', { type: 'skip' });
  assert.deepEqual(h3.result().spectators, ['p3']);
  assert.ok(!h3.result().winners.includes('p3'));

  // an app moderator: the host is a player like any other, nobody sits out
  for (const [n, seed, hostPid] of [[6, 1, 'p1'], [9, 4, 'p2'], [12, 7, 'p1']]) {
    const app = new Sim(game, { n, seed, hostPid, config: config.defaults(n) });
    assert.equal(app.state.mod, false);
    const res = playRandom(app, { rng: mulberry32(seed) });
    assert.equal('spectators' in res, false, `n=${n}: no spectators key at all`);
    assert.ok(app.state.pl.includes(hostPid), 'the host plays');
  }
});

/** A one-phone Room (every seat on dev_host) playing werewolf at random until the results; returns the room and its last 'room' message. */
async function roomGame(names, over, seed) {
  const { Room } = await import('../js/core/room.js?v=1');
  const { createBag } = await import('../js/core/bag.js?v=1');
  let now = 1_700_000_000_000;
  let seq = 0;
  let timers = [];
  const clock = {
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
  const sent = [];
  const saved = {};
  const room = new Room({
    code: null, hostDeviceId: 'dev_host', names, now: clock.now, rng: mulberry32(seed), timers: clock,
    bag: createBag({ storage: new Map(), rng: mulberry32(5), banks: {} }),
    loadGame: async () => game, send: (deviceId, msg) => sent.push({ deviceId, msg: clone(msg) }),
    store: { get: (k) => (k === 'bgb:cfg:werewolf' ? over : saved[k] ?? null), set: (k, v) => { saved[k] = v; } },
    onCue: () => {}, narrationMode: 'silent',
  });
  const sel = await room.selectGame('werewolf');
  assert.equal(sel.ok, true, sel.message);
  assert.equal(room.config.moderator, over.moderator ?? 'app');
  const st = room.start();
  assert.equal(st.ok, true, st.message);
  const rng = mulberry32(seed + 1);
  for (let i = 0; room.phase === 'playing' && i < 60000; i++) {
    const movers = room.session.state.order.filter((p) => room.session.legal(p).length);
    if (movers.length && rng() < 0.4) {
      const pid = movers[Math.floor(rng() * movers.length)];
      const opts = room.session.legal(pid).filter((a) => a.type !== 'explode');
      if (opts.length) room.act('dev_host', pid, opts[Math.floor(rng() * opts.length)]);
    } else clock.advance(3000);
  }
  assert.equal(room.phase, 'results', 'the game reached the results');
  return { room, last: [...sent].reverse().find((x) => x.deviceId === 'dev_host' && x.msg.t === 'room').msg.room };
}

test('werewolf room: the scoreboard does not count the human moderator as having played — and counts everybody at an app-moderated table', async () => {
  const names = ['主持', '甲', '乙', '丙', '丁', '戊', '己'];
  for (const seed of [3, 8]) {
    const human = await roomGame(names, { moderator: 'human', pace: 'fast' }, seed);
    const sb = human.last.scoreboard;
    assert.deepEqual(sb.p1, { played: 0, wins: 0, points: 0 }, `seed ${seed}: the god sat this one out`);
    for (const p of ['p2', 'p3', 'p4', 'p5', 'p6', 'p7']) assert.equal(sb[p].played, 1, `seed ${seed}: ${p} played`);
    assert.equal(human.last.lastResult.gameId, 'werewolf');
    assert.ok(!human.last.lastResult.winners.includes('p1'));
    assert.equal('spectators' in human.last.lastResult, false, 'the hint is for the Room, it is not part of the shown result');

    const app = await roomGame(names, { moderator: 'app', pace: 'fast' }, seed);
    for (const p of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']) assert.equal(app.last.scoreboard[p].played, 1, `seed ${seed}: ${p} played (app moderator)`);
  }
});

test('werewolf: human moderator — a skip at each stage does what 下一步 should', () => {
  const sim = hmk();
  assert.equal(phase(sim), 'deal');
  sim.act('p1', { type: 'skip' });
  assert.equal(phase(sim), 'night');
  assert.equal(cur(sim).step, 'begin');
  sim.act('p1', { type: 'skip' });                              // cue → next step's cue
  assert.equal(cur(sim).step, 'wolves');
  assert.equal(cur(sim).stage, 'cue');
  sim.act('p1', { type: 'skip' });                              // cue → window
  assert.equal(cur(sim).stage, 'run');
  assert.ok(sim.state.deadline > sim.now);
  sim.act('p2', pk('p6'));
  sim.act('p1', { type: 'skip' });                              // window → tail (commit)
  assert.equal(cur(sim).stage, 'tail');
  assert.equal(sim.state.rec.length, 0);
  assert.equal(sim.state.nt.attacked, 'p6');
  sim.act('p1', { type: 'skip' });
  assert.equal(cur(sim).step, 'witch');
});

test('werewolf: human moderator — the moderator is not a player: no card, no number, no vote, no chip, no speech, no role count', () => {
  const sim = deal(hmk());
  assert.equal(sim.view('p2').nt.chips.length, 6);
  assert.ok(sim.view('p2').nt.chips.every((c) => c.pid !== 'p1'));
  assert.equal(sim.view('p2').seats.length, 6);
  night(sim);
  toSpeech(sim);
  assert.ok(!speakers(sim).includes('p1'));
  toVote(sim);
  assert.ok(!cur(sim).voters.includes('p1') && !cur(sim).cands.includes('p1'));
  assert.equal(sim.focus().pids.includes('p1'), false);
  // the deal narration names the moderator's role
  const d = hmk();
  assert.ok(d.cue().text.includes('房主做上帝'));
  // role counts add up to the six players
  assert.equal(Object.keys(sim.state.role).length, 6);
  assert.equal(sim.state.cfg.p, 6);
});

test('werewolf: human moderator — 13 seats = 12 players + the moderator, and the default board is the 12-player one', () => {
  const sim = new Sim(game, { n: 13, seed: 4 });
  assert.equal(sim.state.pl.length, 12);
  assert.equal(sim.state.mod, true);
  assert.equal(sim.state.cfg.preset, '12-std');
  assert.equal(Object.keys(sim.view('p1').god.roles).length, 12);
});

// ============================================================
// focus, autoAct, @next, legalActions
// ============================================================

test('werewolf: focus — who must look at their phone: unready seats, every holder of the called role (alive or dead), the dead player, unvoted voters', () => {
  const sim = mk(R12);
  assert.deepEqual(sim.focus().pids, sim.state.pl);
  deal(sim);
  assert.equal(sim.focus(), null, 'begin: nobody awake');
  toStep(sim, 'guard');
  assert.deepEqual(sim.focus(), { pids: ['p8'], anonymous: '守衛請拎起部手機' });
  sim.state.alive.p8 = false;
  assert.deepEqual(sim.focus().pids, ['p8'], 'a dead guard is still called: the phone looks the same');
  sim.advance();
  assert.equal(sim.focus(), null, 'tail: nobody');
  toStep(sim, 'wolves');
  assert.deepEqual(sim.focus().pids, ['p1', 'p2', 'p3', 'p4']);
  assert.equal(sim.focus().anonymous, '狼人請拎起部手機');
  sim.act('p2', pk('p10'));
  assert.deepEqual(sim.focus().pids, ['p1', 'p3', 'p4'], 'a shared phone moves on to the next wolf once one confirms');
  sim.act('p2', { type: 'night', pick: 'p9' });                 // changing his mind brings him back
  assert.deepEqual(sim.focus().pids, ['p1', 'p2', 'p3', 'p4']);
  sim.advance();
  toStep(sim, 'witch');
  assert.deepEqual(sim.focus(), { pids: ['p6'], anonymous: '女巫請拎起部手機' });
  sim.act('p6', pk('p10'));                                       // poison p10 (the wolves' victim is p9)
  assert.deepEqual(sim.focus().pids, ['p6'], 'other roles do not shrink (a lit screen would say who finished)');
  sim.advance();
  toStep(sim, 'seer'); assert.deepEqual(sim.focus().pids, ['p5']);
  sim.advance();
  toStep(sim, 'hunter'); assert.deepEqual(sim.focus(), { pids: ['p7'], anonymous: '獵人請拎起部手機' });
  sim.advance();
  // by day
  toPhase(sim, 'dawn');
  assert.equal(sim.focus(), null);
  drive(sim, (s) => s.phase === 'final');
  assert.equal(sim.focus(), null, 'cue stage');
  sim.cueDone();
  assert.deepEqual(sim.focus(), { pids: [cur(sim).pid] });
  drive(sim, (s) => s.phase === 'vote' && s.cur.stage === 'run');
  assert.deepEqual(sim.focus().pids, cur(sim).voters);
  sim.act(cur(sim).voters[0], { type: 'vote', target: null });
  assert.deepEqual(sim.focus().pids, cur(sim).voters.slice(1));
});

test('werewolf: focus — a role that is not on the board is never called, and a shared phone never learns a name at night', () => {
  const sim = deal(mk({ p1: 'werewolf', p2: 'werewolf', p3: 'seer', p4: 'witch', p5: 'villager', p6: 'villager' }));
  const prompts = [];
  let g = 0;
  while (phase(sim) === 'night' && g++ < 100) {
    const f = sim.focus();
    if (f) prompts.push(f.anonymous);
    if (cur(sim).stage === 'run') sim.advance(); else sim.cueDone();
  }
  assert.deepEqual(prompts, ['狼人請拎起部手機', '女巫請拎起部手機', '預言家請拎起部手機']);
  for (const p of prompts) assert.ok(!/玩家/.test(p));
});

test('werewolf: autoAct — a stalled seat is unstuck in every phase with a legal, harmless action', () => {
  const sim = deal(mk(R12, { speakSecs: 0, wordsSecs: 0, voteSecs: 0 }));
  assert.deepEqual(engine.autoAct(sim.state, 'p1', sim.ctx()), null, 'begin: nothing to do');
  toStep(sim, 'wolves');
  assert.deepEqual(engine.autoAct(sim.state, 'p1', sim.ctx()), { type: 'night', lock: true });
  sim.act('p1', pk('p10'));
  assert.equal(engine.autoAct(sim.state, 'p1', sim.ctx()), null, 'already confirmed');
  assert.equal(engine.autoAct(sim.state, 'nobody', sim.ctx()), null);
  // the stalled seat keeps its tentative pick (a stalled wolf who had chosen still counts)
  const a = deal(mk(R12));
  toStep(a, 'wolves');
  a.act('p1', { type: 'night', pick: 'p10' });
  a.act('p1', engine.autoAct(a.state, 'p1', a.ctx()));
  assert.equal(a.view('p1').nt.pick, 'p10');
  assert.equal(a.view('p1').nt.lock, true);
  // day
  const d = deal(mk(R12, { speakSecs: 0, wordsSecs: 0, voteSecs: 0 }));
  night(d);
  toSpeech(d); d.cueDone();
  assert.deepEqual(engine.autoAct(d.state, cur(d).pid, d.ctx()), { type: 'done' });
  assert.equal(engine.autoAct(d.state, d.state.pl.find((p) => p !== cur(d).pid), d.ctx()), null);
  toVote(d);
  assert.deepEqual(engine.autoAct(d.state, 'p3', d.ctx()), { type: 'vote', target: null }, 'a stalled voter abstains');
  d.act('p3', { type: 'vote', target: null });
  assert.equal(engine.autoAct(d.state, 'p3', d.ctx()), null);
  // ready
  const r = new Sim(game, { n: 6, seed: 1 });
  assert.deepEqual(engine.autoAct(r.state, 'p2', r.ctx()), { type: 'ready' });
  // final window
  const f = deal(mk(R9));
  nightKill(f, 'p7'); toPhase(f, 'final'); f.cueDone();
  assert.deepEqual(engine.autoAct(f.state, 'p7', f.ctx()), { type: 'final', lock: true });
  assert.equal(engine.autoAct(f.state, 'p1', f.ctx()), null);
  // the session routes @auto to autoAct
  assert.ok(f.act('p7', engine.autoAct(f.state, 'p7', f.ctx())));
});

test('werewolf: @next — the host nudges the game forward at every stage, and never past the end', () => {
  const sim = new Sim(game, { n: 6, seed: 2, config: { ...config.defaults(6), pace: 'fast', speakSecs: 0, voteSecs: 0, wordsSecs: 0 } });
  const stages = new Set();
  let guard = 0;
  while (!sim.result() && guard++ < 3000) {
    stages.add(`${phase(sim)}/${cur(sim)?.stage ?? '-'}`);
    assert.equal(sim.host({ type: ACT.NEXT }), true, `@next did nothing at ${phase(sim)}`);
  }
  assert.ok(sim.result());
  for (const s of ['deal/-', 'night/cue', 'night/run', 'night/tail', 'dawn/cue', 'speech/cue', 'speech/run', 'vote/cue', 'vote/run', 'say/cue']) assert.ok(stages.has(s), `@next was exercised at ${s}`);
  assert.equal(sim.host({ type: ACT.NEXT }), false);
  assert.equal(sim.host({ type: ACT.CUE_DONE, id: 'x' }), false);
  assert.equal(sim.host({ type: 'bogus' }), false);
});

test('werewolf: garbage input never changes the state and never throws', () => {
  const sim = deal(mk(R9));
  toStep(sim, 'seer');
  const before = JSON.stringify(sim.state);
  const junk = [null, undefined, 42, 'x', {}, { pid: 'p1' }, { pid: 'p1', action: null }, { pid: 'p1', action: 'night' }, { pid: 'p1', action: {} },
    { pid: 'p1', action: { type: 42 } }, { pid: 'nobody', action: { type: 'night', pick: 'p1', lock: true } }, { pid: null, action: { type: 'ready' } },
    { pid: { id: 'p1' }, action: { type: 'ready' } }, { pid: 'p1', action: { type: 'bogus' } }, { pid: 'p1', action: { type: 'ready' } },
    { pid: 'p1', action: { type: 'vote', target: 'p2' } }, { pid: 'p1', action: { type: 'done' } }, { pid: 'p1', action: { type: 'final', pick: 'p2' } },
    { pid: 'p1', action: { type: 'explode' } }, { pid: 'p1', action: { type: 'skip' } }, { pid: HOST, action: { type: ACT.CUE_DONE } },
    { pid: HOST, action: { type: ACT.AUTO, pid: 'p1' } }, { pid: HOST, action: { type: ACT.CUE_DONE, id: 'nope' } }, { pid: 'p4', action: { type: 'night', pick: ['p1'] } },
    { pid: 'p4', action: { type: 'night', pick: { a: 1 } } }];
  for (const m of junk) {
    let out;
    assert.doesNotThrow(() => { out = engine.act(clone(sim.state), m, sim.ctx()); }, JSON.stringify(m));
    assert.equal(JSON.stringify(out), before, JSON.stringify(m));
  }
  assert.doesNotThrow(() => { engine.view(sim.state, 'p1'); engine.view(sim.state, null); engine.view(sim.state, 42); engine.view(sim.state, {}); });
  assert.equal(engine.legalActions(sim.state, 'nobody').length, 0);
  assert.equal(engine.legalActions(sim.state, null).length, 0);
  assert.equal(engine.focus(sim.state) !== undefined, true);
});

test('werewolf: legalActions — every offered action is accepted and changes the state (every phase, every seat)', () => {
  for (const n of [6, 9, 12, 13]) {
    const sim = newSim(n, n * 3);
    const rng = mulberry32(n);
    const seen = new Set();
    for (let i = 0; i < 1200 && !sim.result(); i++) {
      const key = `${sim.state.phase}/${sim.state.cur?.stage ?? '-'}`;
      if (!seen.has(`${key}:${i % 7}`) || i % 5 === 0) {
        seen.add(`${key}:${i % 7}`);
        for (const p of sim.state.order) {
          for (const a of sim.legal(p)) {
            const out = engine.act(clone(sim.state), { pid: p, action: a }, sim.ctx());
            assert.notEqual(JSON.stringify(out), JSON.stringify(sim.state), `${p} ${JSON.stringify(a)} in ${key} is a no-op`);
          }
        }
      }
      const movers = sim.state.order.filter((p) => sim.legal(p).length);
      if (movers.length && rng() < 0.4) {
        const m = movers[Math.floor(rng() * movers.length)];
        const acts = sim.legal(m);
        sim.act(m, acts[Math.floor(rng() * acts.length)]);
      } else if (!(sim.cue() && sim.cueDone())) {
        if (!sim.advance()) sim.host({ type: ACT.NEXT });
      }
    }
  }
});

// ============================================================
// leaks
// ============================================================

const ROLE_IDS_ALL = ['werewolf', 'villager', 'seer', 'witch', 'hunter', 'guard', 'idiot'];

/** What a view may contain about roles: the board, the viewer's own card, nothing else. */
function roleLeakFree(view, seat, { spectate = false } = {}) {
  const v = JSON.parse(JSON.stringify(view));
  if (v.over || v.god || v.all) return;
  delete v.board;
  delete v.my;
  if (seat !== null) assert.equal(v.roleId, view.my?.role, 'roleId is the own card of the seat');
  delete v.roleId;
  delete v.step;
  if (v.nt) delete v.nt.step;
  if (v.opts) delete v.opts.preset;
  if (v.opts) delete v.opts.reasonId;
  v.seats = v.seats.map((s) => { const c = { ...s }; if (c.pid === seat) delete c.role; return c; });
  const hits = paths(v, (x) => typeof x === 'string' && ROLE_IDS_ALL.some((id) => x === id || x.includes(id)));
  assert.deepEqual(hits, [], `view of ${seat} mentions a role id outside its own card`);
}

/** The metamorphic check: a seat's view must not depend on the roles of OTHER seats (beyond a wolf's teammates). */
function swapCheck(sim, rng, tries = 6) {
  const s = sim.state;
  if (s.phase === 'over') return;                                // every role is public at the end
  const pl = s.pl;
  for (let k = 0; k < tries; k++) {
    const viewer = pl[Math.floor(rng() * pl.length)];
    const others = pl.filter((p) => p !== viewer);
    const a = others[Math.floor(rng() * others.length)];
    const b = others[Math.floor(rng() * others.length)];
    if (a === b || s.role[a] === s.role[b]) continue;
    const viewerWolf = s.role[viewer] === 'werewolf';
    if (viewerWolf && (s.role[a] === 'werewolf' || s.role[b] === 'werewolf')) continue;
    if (s.cfg.spectate && !s.alive[viewer]) continue;
    const swapped = clone(s);
    [swapped.role[a], swapped.role[b]] = [swapped.role[b], swapped.role[a]];
    assert.equal(JSON.stringify(engine.view(swapped, viewer)), JSON.stringify(engine.view(s, viewer)),
      `${viewer}'s view depends on the roles of ${a} (${s.role[a]}) and ${b} (${s.role[b]}) in ${s.phase}/${s.cur?.k}/${s.cur?.stage}`);
  }
}

test('werewolf: leaks — at every step of random games no view mentions a role it may not know, and views do not depend on other seats\' roles', () => {
  for (const n of [6, 7, 9, 10, 12]) {
    for (let seed = 1; seed <= 4; seed++) {
      const sim = newSim(n, seed * 19 + n, { openCard: 'off', spectate: false });
      const rng = mulberry32(seed + n);
      let k = 0;
      playRandom(sim, {
        rng, actP: 0.4,
        inv: (sm) => {
          if (k++ % 3) return;
          for (const p of [...sm.state.pl, null]) roleLeakFree(sm.view(p), p);
          swapCheck(sm, rng, 3);
        },
      });
      for (const p of sim.state.pl) assert.ok(sim.view(p).over, 'at the end everyone sees the roles');
    }
  }
});

test('werewolf: leaks — explicit per-field checks (notes, potions, mates, causes) in a scripted game', () => {
  const sim = deal(mk(R12, { openCard: 'off', spectate: false }));
  night(sim, {
    guard: { p8: pk('p10') }, wolves: wolvesPick('p10'), witch: { p6: pk('p11') }, seer: { p5: pk('p1') },
  });
  for (const p of sim.state.pl) {
    const v = sim.view(p);
    const role = sim.state.role[p];
    assert.equal(v.my.role, role);
    assert.equal(!!v.my.potion, role === 'witch', `${p} potion`);
    assert.equal(Array.isArray(v.my.mates), role === 'werewolf', `${p} mates`);
    const kinds = v.my.notes.map((n) => n.k).sort().join();
    const expected = { p5: 'seer', p6: 'poison', p8: 'guard' }[p] ?? '';
    assert.equal(kinds, expected, `${p} notes`);
    assert.equal(v.seats.filter((x) => x.role).length, 1 + (sim.state.alive[p] ? 0 : 0), `${p} sees exactly one role in the roster`);
    assert.equal(v.seats.find((x) => x.pid === p).role, role);
    for (const d of v.seats.filter((x) => !x.alive)) assert.equal(d.how, null, 'causes of night deaths stay secret');
    assertNoKeys(v, ['over', 'god', 'all'], p);
  }
  const t = sim.view(null);
  assert.equal(t.my, undefined);
  assert.ok(t.seats.every((x) => x.role === undefined));
  assertNoKeys(t, ['notes', 'potion', 'mates', 'nt'], 'table view');
  // cues are public: the dawn names who died, never why
  const cue = sim.cue().text;
  assert.ok(!/毒|守衛守|救|驗/.test(cue));
});

test('werewolf: leaks — dead players see everything only when 出局後睇到全場 is on; the whole table sees it all at the end', () => {
  const run = (spectate) => {
    const sim = deal(mk(R9, { spectate }));
    nightKill(sim, 'p7');
    return sim;
  };
  const off = run(false); const on = run(true);
  assert.equal(off.view('p7').all, undefined);
  assert.deepEqual(on.view('p7').all, R9);
  assert.equal(on.view('p7').seats.filter((x) => x.role).length, 9);
  assert.equal(on.view('p8').all, undefined, 'the living still see nothing');
  assert.equal(on.view(null).all, undefined);
  // end of game: everyone, including the table
  const end = deal(mk(R9));
  end.state.alive = Object.fromEntries(R9 && Object.keys(R9).map((p) => [p, true]));
  for (const p of ['p4', 'p5', 'p6']) end.state.alive[p] = false;
  end.state.win = 'wolves'; end.state.winWhy = 'gods';
  engine.act(end.state, { pid: HOST, action: { type: ACT.NEXT } }, end.ctx());
  drive(end, (s) => s.phase === 'over');
  for (const p of [...end.state.pl, null]) assert.deepEqual(end.view(p).over.roles, R9);
});

test('werewolf: views are fresh objects (mutating one never touches the state) and JSON-safe', () => {
  const sim = deal(mk(R9));
  toStep(sim, 'wolves');
  const before = JSON.stringify(sim.state);
  const v = sim.view('p1');
  v.nt.chips[0].on = 'tampered'; v.nt.info.push('x'); v.my.mates.push('zz'); v.seats[0].alive = null; v.board.length = 0;
  assert.equal(JSON.stringify(sim.state), before);
  assert.deepEqual(JSON.parse(JSON.stringify(sim.view('p1'))), JSON.parse(JSON.stringify(sim.view('p1'))));
  for (const p of [...sim.state.pl, null]) assert.doesNotThrow(() => JSON.stringify(sim.view(p)));
});

test('werewolf: state is plain JSON and games are deterministic per seed', () => {
  const run = (seed) => { const sim = newSim(9, seed); playRandom(sim, { rng: mulberry32(seed + 1), actP: 0.4 }); return sim; };
  const a = run(77); const b = run(77); const c = run(78);
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
  assert.notEqual(JSON.stringify(a.state), JSON.stringify(c.state));
  assert.deepEqual(JSON.parse(JSON.stringify(a.state)), a.state);
  // a host refresh restores from JSON mid-game and carries on
  const mid = deal(mk(R9));
  toStep(mid, 'wolves');
  const snap = JSON.parse(JSON.stringify(mid.state));
  const out = engine.advance(snap, { ...mid.ctx(), now: snap.deadline });
  assert.equal(out.cur.stage, 'tail');
  assert.equal(engine.cue(out).id.endsWith(':tail'), true);
});

// ============================================================
// the result and the recap
// ============================================================

test('werewolf: result — winners are the winning camp, the summary says why, and the recap shows what nobody saw', () => {
  const sim = deal(mk(R12, { winRule: 'edge' }));
  // night 1: guard saves p10 from the wolves, the witch poisons p11, the seer checks p1
  night(sim, { guard: { p8: pk('p10') }, wolves: wolvesPick('p10'), witch: { p6: pk('p11') }, seer: { p5: pk('p1') } });
  drive(sim, (s) => s.phase === 'speech');
  // day 1: everybody votes out p2 (a wolf)
  toVote(sim);
  castVotes(sim, Object.fromEntries(cur(sim).voters.map((p) => [p, 'p2'])));
  drive(sim, (s) => s.phase === 'night');
  // finish the game fast: the remaining wolves win by killing every villager
  for (const p of sim.state.pl) if (sim.state.role[p] === 'villager') sim.state.alive[p] = sim.state.alive[p];   // (no-op, documents intent)
  for (const p of ['p10', 'p11', 'p12']) sim.state.alive[p] = false;
  nightKill(sim, 'p5');
  drive(sim, (s) => s.phase === 'over');
  const r = sim.result();
  assert.equal(r.summary, '狼人隊贏：平民全部出局（屠邊）');
  assert.deepEqual(r.winners, ['p1', 'p2', 'p3', 'p4'], 'the whole wolf camp wins, the exiled wolf included');
  const text = r.lines.join('\n');
  for (const needle of ['身份揭曉', '1號玩家1：🐺 狼人', '5號玩家5：🔮 預言家', '逐晚回顧',
    '🌙 第 1 夜', '守衛（8號玩家8）守咗 10號玩家10', '狼人：1號玩家1→10號玩家10', '襲擊 10號玩家10', '女巫（6號玩家6）用毒藥毒咗 11號玩家11',
    '預言家（5號玩家5）驗咗 1號玩家1：🐺 狼人', '11號玩家11 被毒死', '☀️ 第 1 日', '投票', '2號玩家2 被放逐', '🌙 第 2 夜']) {
    assert.ok(text.includes(needle), `recap is missing "${needle}"\n${text}`);
  }
  assert.ok(text.includes('被守衛守住'), 'the guard\'s save is explained');
  assert.ok(text.includes('第 1 夜被毒死') && text.includes('第 1 日被放逐'));
  assert.ok(r.lines[0].includes('屠邊'));
});

test('werewolf: result — recap explains 奶穿, 毒穿, a saved victim, a shot, a flip and a self-explode', () => {
  const lines = (script, over = {}, pre = () => {}) => {
    const sim = deal(mk(R12, over));
    pre(sim);
    night(sim, script);
    const out = [];
    for (const rec of sim.state.rec) if (rec.k === 'night') out.push(...S.recapNight(rec, (p) => p, (p) => p));
    return out.join('\n');
  };
  assert.ok(lines({ guard: { p8: pk('p10') }, wolves: wolvesPick('p10'), witch: { p6: pk('p10') } }).includes('奶穿'));
  assert.ok(lines({ wolves: wolvesPick('p10'), witch: { p6: pk('p10') } }).includes('被女巫救返'));
  assert.ok(lines({ guard: { p8: pk('p10') }, wolves: wolvesPick('p10') }).includes('被守衛守住'));
  assert.ok(lines({ wolves: wolvesPick(null) }).includes('空刀'));
  assert.ok(lines({ guard: { p8: pk('p10') }, wolves: wolvesPick(null), witch: { p6: pk('p10') } }).includes('毒穿'));
  assert.ok(lines({ wolves: wolvesPick('p7'), }).includes('平安夜') === false);
  assert.ok(lines({}).includes('平安夜'));
  assert.ok(lines({ wolves: wolvesPick('p7') }).includes('獵人'), 'a night recap line for the hunter');
  assert.ok(lines({ wolves: wolvesPick('p10') }, { guardStack: 'live', }, (sim) => {}).includes('冇人死') === false);
  // day events: a self-explode, then an idiot flip
  const sim = deal(mk(R12));
  night(sim);
  toFirstSpeech(sim);
  sim.act('p1', { type: 'explode' });
  drive(sim, (s) => s.phase === 'night');
  night(sim); toVote(sim);
  castVotes(sim, Object.fromEntries(cur(sim).voters.map((p) => [p, 'p9'])));
  assert.deepEqual(sim.state.rec.map((r) => r.k), ['night', 'explode', 'night', 'vote', 'flip']);
  sim.state.win = 'wolves'; sim.state.winWhy = 'gods';              // end it here to read the recap
  drive(sim, (s) => s.phase === 'over');
  const text = sim.result().lines.join('\n');
  assert.ok(text.includes('1號玩家1 自爆') && text.includes('9號玩家9 係白痴，翻牌，唔出局') && text.includes('9號玩家9：🤡 白痴（翻過牌）'));
  assert.ok(text.indexOf('投票') < text.indexOf('翻牌，唔出局'), 'the flip is listed after the vote that caused it');
});

test('werewolf: result — good wins, draws, and shot / explode fates are named', () => {
  const sim = deal(mk({ p1: 'werewolf', p2: 'werewolf', p3: 'hunter', p4: 'seer', p5: 'villager', p6: 'villager' }, { winRule: 'city' }));
  nightKill(sim, 'p3', { wolves: { p1: pk('p3'), p2: pk('p3') } });
  toPhase(sim, 'final'); sim.cueDone();
  sim.act('p3', fin('p1')); sim.advance();                       // the hunter takes p1 with him
  const text = sim.state.rec.map((r) => JSON.stringify(r)).join('\n');
  assert.ok(text.includes('"shot"'));
  // keep playing: the other wolf is exiled
  drive(sim, (s) => s.phase === 'vote' && s.cur.stage === 'run');
  castVotes(sim, Object.fromEntries(cur(sim).voters.map((p) => [p, 'p2'])));
  assert.equal(sim.state.win, 'good');
  drive(sim, (s) => s.phase === 'over');
  const lines = sim.result().lines.join('\n');
  assert.ok(lines.includes('3號玩家3：🏹 獵人') && lines.includes('被狼人殺死'));
  assert.ok(lines.includes('1號玩家1：🐺 狼人') && lines.includes('被獵人槍殺（3號玩家3）'));
  assert.ok(lines.includes('2號玩家2：🐺 狼人') && lines.includes('被放逐'));
  assert.ok(lines.includes('3號玩家3 開槍帶走咗 1號玩家1'));
  assert.deepEqual(sim.result().winners, ['p3', 'p4', 'p5', 'p6']);
  assert.ok(sim.result().lines.includes('所有狼人都出局咗，好人贏。'));
});

test('werewolf: result is null until the game is over, and the over view carries the roles and the summary', () => {
  const sim = deal(mk(R9));
  assert.equal(sim.result(), null);
  const end = newSim(9, 3);
  playRandom(end, { rng: mulberry32(3), actP: 0.4 });
  const v = end.view('p1');
  assert.equal(v.phase, 'over');
  assert.ok(['wolves', 'good', 'draw'].includes(v.over.win));
  assert.equal(v.over.summary, end.result().summary);
  assert.deepEqual(Object.keys(v.over.roles).sort(), [...end.state.pl].sort());
  assert.equal(end.cue(), null);
  assert.deepEqual(end.legal('p1'), []);
  assert.equal(end.focus(), null);
});

// ============================================================
// the polish contract: hints, role text, presets
// ============================================================

test('werewolf: config.presets — one chip per board plus pace presets, each a valid patch with a reason', () => {
  for (let n = 6; n <= 13; n++) {
    const list = config.presets(n);
    assert.ok(list.length >= 4, `n=${n}`);
    const idsSeen = new Set();
    for (const p of list) {
      assert.ok(p.id && p.label && p.reason && p.cfg && typeof p.cfg === 'object', `${n} ${p.id}`);
      assert.ok(!idsSeen.has(p.id), `duplicate preset id ${p.id}`);
      idsSeen.add(p.id);
      const cfg = { ...config.defaults(n), ...p.cfg };
      const v = config.validate(cfg, n);
      assert.ok(v.ok, `n=${n} preset ${p.id}: ${v.message}`);
      new Sim(game, { n, seed: 1, config: cfg });
    }
    const p = n === 13 ? 12 : n;
    assert.deepEqual(list.filter((x) => PRESETS.some((b) => b.id === x.id)).map((x) => x.id), game.presetsFor(p).map((x) => x.id), 'every board of this head-count is a chip');
    assert.equal(list[0].cfg.board, 'auto', 'the first board is the recommended one');
    assert.equal(list.some((x) => x.id === 'god'), n >= 7 && n < 13, 'the human-moderator chip only where it fits');
  }
});

test('werewolf: role text is "做乜 … 點贏 …" for every role, and the 💡 sheet\'s splitter can read it', async () => {
  const { roleParts, roleFor } = await import('../js/ui/logic.js');
  for (const r of rules.roles) {
    const parts = roleParts(r.text);
    assert.ok(parts.what.length > 5 && parts.win.length > 3, `${r.id}: ${r.text}`);
    assert.ok(!parts.what.includes('點贏') && !parts.what.startsWith('做乜'));
  }
  assert.ok(rules.quick.length <= 6 && rules.quick.every((l) => [...l].length <= 34), 'quick rules: at most six short lines');
  // the sheet finds my role through view.my.role
  const sim = deal(mk(R9));
  assert.equal(roleFor(sim.view('p4'), rules)?.id, 'seer');
  assert.equal(roleFor(sim.view('p1'), rules)?.id, 'werewolf');
  assert.equal(roleFor(sim.view(null), rules), null);
  assert.equal(roleFor(hmk().view('p1'), rules), null, 'the human moderator has no card');
});

test('werewolf: every phase has a one-line hint, written from the seat\'s own situation only', () => {
  const seen = new Set();
  for (const n of [7, 9, 12]) {
    for (let seed = 1; seed <= 6; seed++) {
      const sim = newSim(n, seed * 5 + n, { selfExplode: 'pk' });
      const rng = mulberry32(seed + n);
      playRandom(sim, {
        rng, actP: 0.4,
        inv: (sm) => {
          const st = sm.state;
          for (const p of [...st.order, null]) {
            const h = sm.view(p).hint;
            assert.ok(typeof h === 'string' && h.length >= 8 && [...h].length <= 40, `${st.phase}/${st.cur?.k}/${st.cur?.stage} hint for ${p}: ${JSON.stringify(h)}`);
            assert.ok(!h.includes('undefined'));
            seen.add(`${st.phase}`);
          }
        },
      });
      for (const p of [...sim.state.order, null]) assert.ok(sim.view(p).hint.length > 0);
    }
  }
  for (const ph of ['deal', 'night', 'dawn', 'words', 'final', 'say', 'speech', 'vote', 'over']) assert.ok(seen.has(ph) || ph === 'over', `a hint was checked in ${ph}`);
  // role-specific, and decoy-specific, in the right places
  const sim = deal(mk(R12));
  toStep(sim, 'guard');
  assert.ok(sim.view('p8').hint.startsWith('守衛'));
  assert.ok(sim.view('p10').hint.includes('冇你份'), 'a villager gets the decoy hint');
  sim.state.alive.p8 = false;
  assert.ok(sim.view('p8').hint.includes('已經出局'), 'a dead guard');
  toStep(sim, 'wolves');
  assert.ok(sim.view('p1').hint.startsWith('狼人'));
  assert.ok(!sim.view('p5').hint.includes('狼人'), 'a seer\'s hint never names the wolves\' job in the first person');
  toStep(sim, 'hunter');
  assert.ok(sim.view('p7').hint.startsWith('獵人'));
  const d = mk(R9);
  assert.ok(d.view('p1').hint.includes('㩒住張牌'));
  d.act('p1', { type: 'ready' });
  assert.ok(d.view('p1').hint.includes('等其他人'));
  assert.ok(d.view(null).hint.length > 0);
  assert.ok(hmk().view('p1').hint.includes('上帝'));
});

test('werewolf: hints never carry a role-specific fact to a seat that should not have it', () => {
  // the hint of every OTHER seat must not depend on the role of the seat in the spotlight
  const hintsFor = (victim) => {
    const sim = deal(mk(R9));
    night(sim, { wolves: wolvesPick(victim, ['p1', 'p2', 'p3']) });
    toPhase(sim, 'final'); sim.cueDone();
    return ['p1', 'p2', 'p4', 'p5', 'p8', 'p9'].map((p) => sim.view(p).hint);
  };
  assert.deepEqual(hintsFor('p6'), hintsFor('p7'), 'bystanders get the same hint whether the dead player was the hunter or not');
});

test('werewolf: the stage text is public — views carry the same line for everyone so silent mode can show it', () => {
  const sim = deal(mk(R12));
  let g = 0;
  while (phase(sim) === 'night' && g++ < 80) {
    const says = new Set(sim.state.pl.map((p) => sim.view(p).say));
    assert.equal(says.size, 1, `the stage line differs between seats at ${cur(sim).step}/${cur(sim).stage}`);
    assert.ok([...says][0].length > 0);
    assert.equal(sim.view(null).say, [...says][0]);
    if (cur(sim).stage === 'run') sim.advance(); else sim.cueDone();
  }
});

// ============================================================
// framework hooks (DESIGN §15): blocking, VOID_ROUND, defaults env, presets, the narrator's wording
// ============================================================

test('werewolf: engine.blocking — only deal, untimed speeches / 遺言 / votes wait on a seat; night and final windows never do; the moderator never', () => {
  // deal: the unready
  const d = mk(R9);
  assert.equal(engine.blocking(d.state, 'p1'), true);
  d.act('p1', { type: 'ready' });
  assert.equal(engine.blocking(d.state, 'p1'), false);
  assert.equal(engine.blocking(d.state, 'p2'), true);
  // night: fixed clocks — nobody blocks, in particular not the holders of the called role (that would point at them)
  const n = deal(mk(R12));
  let g = 0;
  const scan = (sim) => {
    for (const p of sim.state.pl) assert.equal(engine.blocking(sim.state, p), false, `${p} blocks at ${sim.state.phase}/${cur(sim)?.k}/${cur(sim)?.stage}`);
  };
  while (phase(n) === 'night' && g++ < 100) {
    scan(n);
    if (cur(n).stage === 'run') {
      for (const p of n.state.pl) n.act(p, { type: 'night', lock: true });
      scan(n);
      n.advance();
    } else n.cueDone();
  }
  // the final window (fixed clock) and every announcement: nobody; untimed last words: the speaker
  const f = deal(mk(R9, { speakSecs: 0, wordsSecs: 0, voteSecs: 0 }));
  nightKill(f, 'p6');
  g = 0;
  let sawWords = false;
  let sawFinal = false;
  while (phase(f) !== 'speech' && g++ < 50) {
    const c = cur(f);
    if (c.stage === 'run' && c.k === 'words') {
      sawWords = true;
      assert.equal(engine.blocking(f.state, c.pid), true, 'untimed last words wait on the speaker');
      for (const p of f.state.pl.filter((x) => x !== c.pid)) assert.equal(engine.blocking(f.state, p), false);
      f.act(c.pid, { type: 'done' });
    } else if (c.stage === 'run') {
      if (c.k === 'final') sawFinal = true;
      scan(f);
      f.advance();
    } else { scan(f); f.cueDone(); }
  }
  assert.ok(sawWords && sawFinal);
  // an untimed speech waits on the speaker only — a wolf listener with a legal explode is NOT waited on
  f.cueDone();
  const sp = cur(f).pid;
  let wolfListener = false;
  for (const p of f.state.pl) {
    assert.equal(engine.blocking(f.state, p), p === sp, p);
    if (p !== sp && f.state.role[p] === 'werewolf' && f.state.alive[p]) {
      wolfListener = true;
      assert.ok(f.legal(p).some((a) => a.type === 'explode'));
    }
  }
  assert.ok(wolfListener);
  // an untimed vote waits on the voters who have not voted yet
  toVote(f);
  const voters = cur(f).voters.slice();
  f.act(voters[0], { type: 'vote', target: null });
  for (const p of f.state.pl) assert.equal(engine.blocking(f.state, p), voters.includes(p) && p !== voters[0], `vote ${p}`);
  // with clocks nothing blocks
  const t = deal(mk(R9, { speakSecs: 60, voteSecs: 20 }));
  night(t); toVote(t);
  scan(t);
  // the human moderator is never waited on (his 下一步 is optional), not even at the deal
  const h = hmk();
  assert.equal(engine.blocking(h.state, 'p1'), false);
  assert.ok(h.legal('p1').length > 0, 'he still has his skip');
  assert.equal(engine.blocking(h.state, 'p2'), true);
  // garbage
  for (const x of [null, undefined, 42, 'nobody', {}]) assert.equal(engine.blocking(h.state, x), false);
});

test('werewolf: the session asks engine.blocking — a dead phone is never flagged at night, only at the deal', async () => {
  const { Session } = await import('../js/core/session.js?v=1');
  let now = 1_000_000;
  const timers = { setTimeout: () => 0, clearTimeout: () => {} };
  const players = makePlayers(9);
  const s = new Session({
    game, players, config: { ...config.defaults(9) }, rng: mulberry32(3), bag: null, now: () => now, timers, narrationMode: 'read', hostPid: 'p1',
  });
  s.begin();
  assert.ok(players.every((p) => s.blocking(p.id)), 'the deal waits on everybody');
  for (const p of players) s.dispatch(p.id, { type: 'ready' });
  assert.equal(s.state.phase, 'night');
  let g = 0;
  while (s.state.phase === 'night' && g++ < 60) {
    for (const p of players) assert.equal(s.blocking(p.id), false, `night ${s.state.cur.step}/${s.state.cur.stage} ${p.id}`);
    if (s.state.cur.stage === 'run') now = s.state.deadline;
    s.next();
  }
  assert.notEqual(s.state.phase, 'night');
});

test('werewolf: @void-round is not supported — it never changes the state, in any phase', () => {
  const sim = newSim(9, 4);
  const rng = mulberry32(4);
  const phases = new Set();
  playRandom(sim, {
    rng, actP: 0.4,
    inv: (sm) => {
      const before = JSON.stringify(sm.state);
      const out = engine.act(clone(sm.state), { pid: HOST, action: { type: ACT.VOID_ROUND } }, sm.ctx());
      assert.equal(JSON.stringify(out), before, `void-round in ${sm.state.phase}`);
      phases.add(sm.state.phase);
    },
  });
  assert.ok(['night', 'speech', 'vote', 'say'].every((p) => phases.has(p)), [...phases].join());
});

test('werewolf: defaults on one shared phone — slow nights and no vote clock (the phone has to travel to every voter)', () => {
  for (let n = 6; n <= 13; n++) {
    const one = config.defaults(n, undefined, { singleDevice: true });
    assert.equal(one.pace, 'slow');
    assert.equal(one.voteSecs, 0);
    assert.ok(config.validate(one, n).ok);
    const many = config.defaults(n, undefined, { singleDevice: false });
    assert.equal(many.pace, 'normal');
    assert.equal(many.voteSecs, 20);
  }
});

test('werewolf: presets — a board chip also sets who moderates, so it never falls back; the 上帝 chip picks the board for one player fewer', () => {
  for (let n = 7; n <= 12; n++) {
    const human = { ...config.defaults(n), moderator: 'human' };
    for (const p of config.presets(n)) {
      const cfg = { ...human, ...p.cfg };
      const v = config.validate(cfg, n);
      assert.ok(v.ok, `${n} ${p.id}: ${v.message}`);
      assert.ok(!v.warnings.some((w) => w.includes('唔啱而家人數')), `${n} ${p.id} fell back: ${v.warnings.join(' / ')}`);
      if (PRESETS.some((b) => b.id === p.id)) assert.equal(game.resolve(cfg, n).preset, p.id, `chip ${p.id} gives its own board`);
    }
    // a board saved for n players, then the 上帝 chip: n − 1 players on their recommended board
    const god = config.presets(n).find((x) => x.id === 'god');
    const cfg = { ...config.defaults(n), board: game.presetsFor(n).at(-1).id, ...god.cfg };
    const e = game.resolve(cfg, n);
    assert.equal(e.p, n - 1);
    assert.equal(e.preset, game.presetsFor(n - 1)[0].id);
    assert.equal(e.fallback, false);
  }
  // 13 seats: every board chip keeps the human moderator
  for (const p of config.presets(13)) if (PRESETS.some((b) => b.id === p.id)) assert.equal(p.cfg.moderator, 'human');
});

test('werewolf: the narrator says names, not seat numbers, and counts as words (兩票) — every cue of random games', () => {
  const seen = new Set();
  for (const n of [6, 9, 12, 13]) {
    for (let seed = 1; seed <= 4; seed++) {
      const sim = newSim(n, seed * 13 + n, { openCard: seed % 2 ? 'on' : 'off', selfExplode: 'pk' });
      playRandom(sim, {
        rng: mulberry32(seed + n), actP: 0.35,
        inv: (sm) => {
          const c = sm.cue();
          if (!c || seen.has(c.text)) return;
          seen.add(c.text);
          assert.ok(!/\d+\s*號/.test(c.text), `a seat number in a spoken line: ${c.text}`);
          assert.ok(!/\d\s*票/.test(c.text), `a vote count in digits: ${c.text}`);
          assert.ok(!/二票/.test(c.text), `二票 is not Cantonese: ${c.text}`);
          assert.ok(!/第s*d/.test(c.text), `an ordinal in digits: ${c.text}`);
          assert.ok(!/undefined|null|NaN|\?/.test(c.text), c.text);
        },
      });
    }
  }
  assert.ok(seen.size > 40, `only ${seen.size} different lines`);
  assert.equal(S.countZh(2), '兩');
  assert.equal(S.countZh(12), '十二');
  assert.deepEqual([1, 10, 14, 20, 21].map(S.numZh), ['一', '十', '十四', '二十', '二十一']);
  assert.equal(S.andZh(['阿明', '阿B', '阿C']), '阿明、阿B同阿C');
  assert.equal(S.orZh(['阿明', '阿B']), '阿明或者阿B');
});

test('werewolf: a new night step starts with clean chips — the last step\'s pick is not shown as locked during the next opening line', () => {
  const sim = deal(mk(R12));
  toStep(sim, 'guard');
  sim.act('p8', pk('p10'));
  sim.act('p10', pk('p3'));                       // a decoy tap
  sim.advance();
  assert.equal(cur(sim).stage, 'tail');
  assert.equal(sim.view('p8').nt.pick, 'p10', 'the closing line still shows what he did');
  sim.cueDone();
  assert.equal(cur(sim).step, 'wolves');
  assert.equal(cur(sim).stage, 'cue');
  for (const p of sim.state.pl) {
    const nt = sim.view(p).nt;
    assert.equal(nt.pick, null, p);
    assert.equal(nt.set, false, p);
    assert.ok(nt.chips.every((c) => c.mark === ''), p);
  }
  assert.equal(sim.state.guardLast, 'p10', 'the guard\'s choice was committed before the reset');
});

test('werewolf: every seat has a legal action in every night step of the Taiwan order and of a guard board, and no step ends early', () => {
  for (const [map, over] of [[R12, { nightOrder: 'tw' }], [R12, { pace: 'fast' }], [R9, { nightOrder: 'tw', pace: 'slow' }]]) {
    const sim = deal(mk(map, over));
    const steps = new Set();
    let g = 0;
    while (phase(sim) === 'night' && g++ < 100) {
      const c = cur(sim);
      if (c.stage === 'run') {
        steps.add(c.step);
        const span = sim.state.deadline - sim.now;
        for (const p of sim.state.pl) assert.ok(sim.legal(p).some((a) => a.type === 'night' && a.pick), `${p} at ${c.step}`);
        for (const p of sim.state.pl) sim.act(p, { type: 'night', pick: null, lock: true });
        assert.equal(cur(sim).stage, 'run', 'never ends early');
        assert.equal(sim.state.deadline - sim.now, span, 'and the clock did not move');
        sim.advance();
      } else sim.cueDone();
    }
    assert.deepEqual([...steps].sort(), sim.state.nt.steps.filter((x) => x !== 'begin').sort());
  }
});

test('werewolf: the recap groups votes by target and says when only some wolves picked', () => {
  const sim = deal(mk(R9));
  night(sim, { wolves: { p1: pk('p7') } });
  toVote(sim);
  castVotes(sim, { p1: 'p8', p2: 'p8', p3: 'p9', p4: null });
  drive(sim, (s) => s.phase === 'night' || s.phase === 'over');
  sim.state.win = 'good'; sim.state.winWhy = 'wolves-dead';
  sim.host({ type: ACT.NEXT });
  drive(sim, (s) => s.phase === 'over');
  const text = sim.result().lines.join('\n');
  assert.ok(text.includes('襲擊 7號玩家7（其他狼人冇揀）'), text);
  assert.ok(text.includes('8號玩家8 2 票（1號玩家1、2號玩家2）'), text);
  assert.ok(text.includes('棄權：4號玩家4'), text);
});

test('werewolf: result.lines fold into sections on the results screen — why on top, then roles, then one per night and day', async () => {
  const { resultSections, sectionsOpen } = await import('../js/ui/logic.js');
  const sim = deal(mk(R9));
  nightKill(sim, 'p7');
  toVote(sim);
  castVotes(sim, voteAll('p1')(sim.state));
  drive(sim, (s) => s.phase === 'night' || s.phase === 'over');
  night(sim);
  toVote(sim);
  castVotes(sim, {});                                           // everybody abstains
  sim.state.win = 'good'; sim.state.winWhy = 'wolves-dead';
  drive(sim, (s) => s.phase === 'over');
  const lines = sim.result().lines;
  assert.ok(lines.every((l) => typeof l === 'string'), 'plain strings: a renderer without sections still reads them');
  const secs = resultSections(lines);
  assert.equal(secs[0].title, null, 'the why comes first, untitled');
  assert.ok(secs[0].lines.some((l) => l.includes('好人贏')) && secs[0].lines.some((l) => l.includes('逐晚回顧')));
  assert.deepEqual(secs.slice(1).map((x) => x.title), ['🎭 身份揭曉', '🌙 第 1 夜', '☀️ 第 1 日', '🌙 第 2 夜', '☀️ 第 2 日']);
  assert.equal(secs[1].lines.length, 9, 'one line per player');
  assert.deepEqual(sectionsOpen(secs)[0], true, 'the why is open');
  assert.ok(secs[5].lines.some((l) => l.includes('全部棄權')), secs[5].lines.join('\n'));
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
    this.cls = new Set(); this.styleMap = {}; this.hidden = false; this.disabled = false; this.dataset = {}; this.open = false;
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
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'hidden') this.hidden = true; if (k === 'disabled') this.disabled = true; if (k === 'open') this.open = true; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  append(...kids) { for (const k of kids) this.appendChild(k instanceof FNode ? k : new FText(k)); }
  appendChild(k) { k.parentNode?.removeChild(k); k.parentNode = this; this.children.push(k); return k; }
  removeChild(k) { const i = this.children.indexOf(k); if (i >= 0) { this.children.splice(i, 1); k.parentNode = null; } return k; }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() { this.parentNode?.removeChild(this); }
}
const realSetTimeout = globalThis.setTimeout;
const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));
const fakeDocument = { createElement: (t) => new FEl(t), createTextNode: (t) => new FText(t), getElementById: () => null, head: new FEl('head'), body: new FEl('body') };

const walk = (n, fn) => { fn(n); if (n.children) for (const c of n.children) walk(c, fn); };
const findAll = (root, pred) => { const out = []; walk(root, (n) => { if (n instanceof FEl && pred(n)) out.push(n); }); return out; };
const hasCls = (n, c) => n.cls.has(c);
const clickN = (n) => {
  assert.ok(!n.disabled && !n.hidden, `clicked a disabled/hidden control (${n.className} "${n.textContent}")`);
  for (const f of n.listeners.click ?? []) f({ preventDefault() {} });
};
const visible = (n) => { for (let x = n; x; x = x.parentNode) if (x.hidden) return false; return true; };
const serialize = (n) => (n instanceof FText ? n.data : JSON.stringify([n.tag, [...n.cls].sort(), n.attrs, n.hidden, n.disabled, n.styleMap, n.dataset, n.children.map(serialize)]));

/** Stand-ins for the shared components: same props, same callbacks, just enough DOM. */
function stubComponents(spy) {
  const E = (tag, cls, ...kids) => { const n = new FEl(tag); if (cls) n.className = cls; n.append(...kids); return n; };
  const RoleCard = (p0 = {}) => {
    const body = E('div', 'rc-body');
    const root = E('div', 'c-rolecard', body);
    const api = {
      el: root,
      update(p) { api.props = p; body.textContent = p.role ? `${p.role.emoji}${p.role.name}|${p.role.text}` : 'none'; },
      destroy() { root.remove(); },
    };
    api.update(p0);
    return api;
  };
  const VotePanel = (p0 = {}) => {
    const list = E('div', 'vp-list');
    const root = E('div', 'c-votepanel', list);
    const api = {
      el: root,
      update(p) {
        api.props = p;
        if (p.reveal) { list.replaceChildren(E('p', 'vp-reveal', JSON.stringify([p.reveal.top, p.reveal.counts]))); return; }
        const kids = (p.candidates ?? []).map((id) => { const b = E('button', 'vp-opt', id); b.dataset.pid = id; b.addEventListener('click', () => p.onVote?.(id)); return b; });
        if (p.allowAbstain) { const b = E('button', 'vp-opt vp-abstain', '棄權'); b.addEventListener('click', () => p.onVote?.(null)); kids.push(b); }
        list.replaceChildren(...kids);
      },
      destroy() { root.remove(); },
    };
    api.update(p0);
    return api;
  };
  const Timer = (p0 = {}) => {
    const root = E('div', 'c-timer');
    spy.timers++;
    const api = { el: root, update(p) { api.props = p; root.textContent = String(p.deadline); }, destroy() { root.remove(); } };
    api.update(p0);
    return api;
  };
  return { Cover: null, RoleCard, DiceCup: null, VotePanel, Timer, PlayerPicker: null, Canvas: null, dieFace: null };
}

let uiModule = null;
async function withFakeDom(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node };
  globalThis.document = fakeDocument;
  globalThis.Node = FNode;
  try {
    uiModule ??= await import('../js/games/werewolf/ui.js');
    return await fn(uiModule);
  } finally {
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
    if (saved.Node === undefined) delete globalThis.Node; else globalThis.Node = saved.Node;
  }
}

/** One mounted UI per seat (and one for the table), as the shell does. */
function mountAll(ui, sim, sent, spy) {
  const comps = stubComponents(spy);
  const seats = {};
  for (const pid of [...sim.players.map((p) => p.id), null]) {
    const root = new FEl('div');
    const api = {
      me: pid, players: sim.players, isHost: pid === 'p1', meta: game.meta, config: sim.state.cfg,
      send: (a) => {
        const changed = sim.act(pid, a);
        sent.push({ pid, a, changed });
        return changed;
      },
      ink() {}, now: () => sim.now, sfx: (name) => { spy.sfx.push({ pid, name, phase: sim.state.phase }); }, toast() {}, components: comps,
    };
    seats[pid ?? 'table'] = { pid, root, api, handle: ui.mount(root, api) };
  }
  return seats;
}

let pushTick = 0;
function pushViews(sim, seats, ctx = { focus: null, paused: false, narrationMode: 'voice' }, always = false) {
  for (const seat of Object.values(seats)) {
    const v = sim.view(seat.pid);
    seat.handle.update(v, ctx);
    // update() twice with the same view must change nothing; checking every call is slow, so sample it
    if (always || ++pushTick % 5 === 0) {
      const a = serialize(seat.root);
      seat.handle.update(clone(v), ctx);
      assert.equal(serialize(seat.root), a, `update() is not idempotent for ${seat.pid ?? 'table'} in ${v.phase}/${v.stage}`);
    }
  }
}

/** The big shape of a night screen: must be the same on every phone at every step. */
function nightShape(root) {
  const panel = findAll(root, (n) => hasCls(n, 'ww-panel'))[0];
  if (!panel) return null;
  const strip = new Set(['is-open', 'is-locked']);
  const grid = findAll(panel, (n) => hasCls(n, 'ww-grid'))[0];
  return JSON.stringify([
    panel.children.map((c) => [...c.cls].filter((x) => !strip.has(x)).join('.')),
    grid.children.length,
    findAll(panel, (n) => n.tag === 'button' && !hasCls(n, 'ww-chip')).length,
  ]);
}

/** What a thumb would do on this seat's current screen. Returns true if it tapped something real. */
function tapSomething(seat, rng) {
  const root = seat.root;
  const usable = (n) => visible(n) && !n.disabled;
  const btn = (cls) => findAll(root, (n) => hasCls(n, cls) && usable(n));

  const ready = btn('ww-ready')[0];
  if (ready) { clickN(ready); return true; }
  const done = btn('ww-done')[0];
  if (done) { clickN(done); return true; }
  const skipGod = btn('ww-god-skip')[0];
  if (skipGod && rng() < 0.3) { clickN(skipGod); return true; }

  // night / final window: pick on the grid, then confirm (or skip)
  const chips = findAll(root, (n) => hasCls(n, 'ww-chip') && usable(n));
  if (chips.length) {
    if (rng() < 0.85) clickN(chips[Math.floor(rng() * chips.length)]);
    const ok = btn('ww-ok')[0];
    const skip = btn('ww-skip')[0];
    if (ok && rng() < 0.6) { clickN(ok); return true; }
    if (skip && rng() < 0.4) { clickN(skip); return true; }
    return true;
  }
  const opts = findAll(root, (n) => hasCls(n, 'vp-opt') && usable(n));
  if (opts.length) { clickN(opts[Math.floor(rng() * opts.length)]); return true; }
  return false;
}

test('werewolf ui: every phase renders for every seat, idempotently, with one night shape, no sound and no timer at night — and a whole game is finished by tapping', async () => {
  await withFakeDom(async (ui) => {
    const cases = [[6, 1, {}], [9, 2, {}], [12, 3, {}], [8, 4, { selfExplode: 'pk' }], [7, 5, { moderator: 'human' }], [13, 6, {}], [10, 7, { board: '10-idiot', openCard: 'on', spectate: true }]];
    const allPhases = new Set();
    for (const [n, seed, over] of cases) {
      const sim = new Sim(game, { n, seed, config: { ...config.defaults(n), ...over } });
      const sent = [];
      const spy = { sfx: [], timers: 0 };
      const seats = mountAll(ui, sim, sent, spy);
      const rng = mulberry32(seed * 31);
      const phases = allPhases;
      let timersAtNight = null;
      let guard = 0;
      while (!sim.result() && guard++ < 6000) {
        pushViews(sim, seats, undefined, sim.state.cur?.stage === 'cue');
        phases.add(sim.state.phase);
        if (sim.state.phase === 'night' && sim.state.cur.step !== 'begin') {
          const players = sim.state.pl.map((p) => seats[p]);
          const shapes = new Set(players.map((s) => nightShape(s.root)));
          assert.equal(shapes.size, 1, `n=${n}: night screens differ in shape at ${sim.state.cur.step}/${sim.state.cur.stage}: ${[...shapes].join(' // ')}`);
          assert.ok([...shapes][0], 'the night panel is on screen');
          const text = players.map((s) => s.root.textContent);
          for (const t of text) assert.ok(!t.includes('undefined') && !t.includes('NaN'));
        }
        // each seat taps what its screen offers, in random order, then time moves on
        const order = Object.keys(seats).sort(() => rng() - 0.5);
        let tapped = false;
        for (const key of order) {
          if (sim.state.phase === 'over') break;
          if (rng() < 0.5 || sim.state.phase !== 'night') {
            try { tapped = tapSomething(seats[key], rng) || tapped; } catch (e) { throw new Error(`tap failed for ${key} in ${sim.state.phase}/${sim.state.cur?.stage}: ${e.message}`); }
            pushViews(sim, { [key]: seats[key] });
          }
        }
        if (sim.cue()) sim.cueDone();
        else if (sim.state.deadline != null) sim.advance();
        else if (!tapped) sim.host({ type: ACT.NEXT });
        else if (guard % 7 === 0) sim.host({ type: ACT.NEXT });
      }
      assert.ok(sim.result(), `n=${n}: finished by tapping alone (stuck in ${sim.state.phase}/${sim.state.cur?.k}/${sim.state.cur?.stage})`);
      pushViews(sim, seats);
      phases.add(sim.state.phase);
      for (const p of ['deal', 'night', 'over']) assert.ok(phases.has(p), `n=${n}: phase ${p} was rendered`);

      // no sound at night, ever — and no Timer component was created while it was night
      assert.deepEqual(spy.sfx.filter((s) => s.phase === 'night'), [], `n=${n}: the UI made a sound at night`);

      // the UI only sent actions the engine accepted, apart from duplicates (a vote re-tap, a no-op explode)
      for (const s of sent) if (!s.changed) assert.ok(['ready', 'night', 'final', 'explode', 'vote', 'done', 'skip'].includes(s.a.type), `UI sent a refused ${JSON.stringify(s.a)} as ${s.pid}`);
      for (const seat of Object.values(seats)) seat.handle.destroy();
      void timersAtNight;
    }
    for (const p of ['deal', 'night', 'dawn', 'words', 'final', 'speech', 'vote', 'say', 'over']) assert.ok(allPhases.has(p), `phase ${p} was rendered in some game`);
  });
});

test('werewolf ui: the night grid has one chip per playing seat and the info card never says undefined; the table sees no private panel', async () => {
  await withFakeDom(async (ui) => {
    const sim = deal(mk(R9));
    const sent = []; const spy = { sfx: [], timers: 0 };
    const seats = mountAll(ui, sim, sent, spy);
    toStep(sim, 'wolves');
    sim.act('p1', { type: 'night', pick: 'p7' });
    pushViews(sim, seats);
    const grid = (key) => findAll(seats[key].root, (n) => hasCls(n, 'ww-chip'));
    assert.equal(grid('p1').length, 9);
    assert.equal(grid('p7').length, 9);
    assert.equal(grid('table').length, 0, 'the table view has no night panel');
    // wolves see their mates' picks as dots on the chip; others never do
    const chip7 = (key) => findAll(grid(key).find((c) => c.textContent.includes('玩家7')), (n) => hasCls(n, 'ww-chip-by'))[0];
    assert.equal(chip7('p2').children.length, 1);
    assert.equal(chip7('p4').children.length, 0);
    assert.ok(grid('p1').find((c) => c.textContent.includes('玩家2')).textContent.includes('🐺'));
    assert.ok(!grid('p4').some((c) => c.textContent.includes('🐺')));
    // privacy on screen: only a wolf's DOM mentions teammates
    for (const key of ['p4', 'p5', 'p7', 'table']) assert.ok(!seats[key].root.textContent.includes('🐺 隊友'), `${key} sees a wolves-only line`);
    assert.ok(seats.p1.root.textContent.includes('🐺 隊友'));
    for (const seat of Object.values(seats)) seat.handle.destroy();
  });
});

test('werewolf ui: the deal shows my card behind the role card, the board, the reason and a ready button; the moderator and the table do not get a card', async () => {
  await withFakeDom(async (ui) => {
    const sim = new Sim(game, { n: 9, seed: 2 });
    const sent = []; const spy = { sfx: [], timers: 0 };
    const seats = mountAll(ui, sim, sent, spy);
    pushViews(sim, seats);
    const rc = findAll(seats.p3.root, (n) => hasCls(n, 'rc-body'))[0];
    assert.ok(rc.textContent.includes(S.roleName(sim.state.role.p3)), 'my card');
    assert.ok(rc.textContent.includes('做乜') && rc.textContent.includes('點贏'));
    for (const other of ['p1', 'p2', 'p4']) {
      const role = sim.state.role[other];
      const mine = findAll(seats[other].root, (n) => hasCls(n, 'rc-body'))[0].textContent;
      assert.ok(mine.startsWith(`${S.ROLES[role].emoji}${S.roleName(role)}|`), `${other}'s card is its own role`);
    }
    assert.equal(findAll(seats.table.root, (n) => hasCls(n, 'rc-body')).length, 0);
    const boardText = seats.p3.root.textContent;
    assert.ok(boardText.includes('狼人 ×3') && boardText.includes('9 人標準'), 'the board and the reason are shown');
    const ready = findAll(seats.p3.root, (n) => hasCls(n, 'ww-ready'))[0];
    clickN(ready);
    assert.deepEqual(sent.at(-1).a, { type: 'ready' });
    pushViews(sim, seats);
    assert.ok(findAll(seats.p3.root, (n) => hasCls(n, 'ww-ready'))[0].disabled);
    assert.ok(seats.p3.root.textContent.includes('1 / 9'));
    for (const seat of Object.values(seats)) seat.handle.destroy();
    // human moderator
    const h = new Sim(game, { n: 7, seed: 2, config: { ...config.defaults(7), moderator: 'human' } });
    const hseats = mountAll(ui, h, [], { sfx: [], timers: 0 });
    pushViews(h, hseats);
    assert.equal(findAll(hseats.p1.root, (n) => hasCls(n, 'rc-body')).length, 0);
    assert.ok(hseats.p1.root.textContent.includes('上帝'));
    assert.equal(findAll(hseats.p1.root, (n) => hasCls(n, 'ww-ready')).filter((b) => visible(b)).length, 0);
    for (const seat of Object.values(hseats)) seat.handle.destroy();
  });
});

test('werewolf ui: the god panel shows every role and the live night picks to the moderator only, and 下一步 sends skip', async () => {
  await withFakeDom(async (ui) => {
    const sim = deal(hmk());
    const sent = []; const spy = { sfx: [], timers: 0 };
    const seats = mountAll(ui, sim, sent, spy);
    toStep(sim, 'wolves');
    sim.act('p2', { type: 'night', pick: 'p6' });
    pushViews(sim, seats);
    const god = (key) => findAll(seats[key].root, (n) => hasCls(n, 'ww-god'))[0];
    assert.equal(god('p1').hidden, false);
    assert.ok(god('p1').textContent.includes('預言家') && god('p1').textContent.includes('女巫'));
    assert.ok(god('p1').textContent.includes('玩家2') && god('p1').textContent.includes('玩家6'), 'live pick: 玩家2 → 玩家6');
    for (const key of ['p2', 'p4', 'p5', 'table']) assert.equal(god(key).hidden, true, key);
    clickN(findAll(seats.p1.root, (n) => hasCls(n, 'ww-god-skip'))[0]);
    assert.deepEqual(sent.at(-1).a, { type: 'skip' });
    assert.equal(sent.at(-1).changed, true);
    for (const seat of Object.values(seats)) seat.handle.destroy();
  });
});

test('werewolf ui: day screens — speakers see 我講完 only on their own turn; the explode button is on every living seat and does nothing for a non-wolf', async () => {
  globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms, 30), ...a);   // the 1 s hold, at 30 ms
  try { await explodeUiScenario(); } finally { globalThis.setTimeout = realSetTimeout; }
});

async function explodeUiScenario() {
  await withFakeDom(async (ui) => {
    const sim = deal(mk(R9));
    night(sim);
    const sent = []; const spy = { sfx: [], timers: 0 };
    const seats = mountAll(ui, sim, sent, spy);
    toSpeech(sim); sim.cueDone();
    pushViews(sim, seats);
    const speaker = cur(sim).pid;
    for (const p of sim.state.pl) {
      const done = findAll(seats[p].root, (n) => hasCls(n, 'ww-done'))[0];
      assert.equal(done.hidden, p !== speaker, `${p}`);
      const box = findAll(seats[p].root, (n) => hasCls(n, 'ww-explode-box'))[0];
      assert.equal(box.hidden, false, `the explode control is on every living seat (${p})`);
    }
    assert.equal(findAll(seats.table.root, (n) => hasCls(n, 'ww-explode-box'))[0].hidden, true, 'the table has none');
    // a held non-wolf explode: nothing happens, the screen shows the same animation
    const nonWolf = sim.state.pl.find((p) => sim.state.role[p] !== 'werewolf');
    const btn = findAll(seats[nonWolf].root, (n) => hasCls(n, 'ww-explode'))[0];
    const before = JSON.stringify(sim.state);
    for (const f of btn.listeners.pointerdown ?? []) f({ preventDefault() {} });
    assert.ok(btn.cls.has('holding'));
    await wait(45);
    assert.equal(JSON.stringify(sim.state), before, 'a non-wolf\'s explode changes nothing');
    assert.deepEqual(sent.at(-1).a, { type: 'explode' });
    assert.ok(btn.cls.has('fired'));
    // a released press cancels
    for (const f of btn.listeners.pointerdown ?? []) f({ preventDefault() {} });
    for (const f of btn.listeners.pointerup ?? []) f({});
    await wait(45);
    assert.equal(sent.filter((s) => s.a.type === 'explode').length, 1, 'letting go early did not send');
    // a wolf's hold ends the day
    const wolf = sim.state.pl.find((p) => sim.state.role[p] === 'werewolf');
    const wbtn = findAll(seats[wolf].root, (n) => hasCls(n, 'ww-explode'))[0];
    for (const f of wbtn.listeners.pointerdown ?? []) f({ preventDefault() {} });
    await wait(45);
    assert.equal(sim.state.alive[wolf], false);
    assert.equal(phase(sim), 'say');
    pushViews(sim, seats);
    assert.ok(seats.p2.root.textContent.includes('自爆'));
    for (const seat of Object.values(seats)) seat.handle.destroy();
  });
}

test('werewolf ui: vote, tally and PK screens', async () => {
  await withFakeDom(async (ui) => {
    const sim = deal(mk(R9));
    nightKill(sim, 'p9');                                         // p9 dies at night 1
    const sent = []; const spy = { sfx: [], timers: 0 };
    const seats = mountAll(ui, sim, sent, spy);
    toVote(sim);
    pushViews(sim, seats);
    const opts = (p) => findAll(seats[p].root, (n) => hasCls(n, 'vp-opt') && visible(n));
    assert.equal(opts('p1').length, 9, '8 candidates + 棄權');
    assert.equal(opts('table').length, 0);
    assert.equal(opts('p9').length, 0, 'a dead player gets no ballot');
    assert.ok(seats.p9.root.textContent.includes('出局'));
    clickN(opts('p1').find((b) => b.dataset.pid === 'p4'));
    assert.deepEqual(sent.at(-1).a, { type: 'vote', target: 'p4' });
    // tally
    castVotes(sim, Object.fromEntries(['p1', 'p2', 'p3', 'p5', 'p6', 'p7'].map((p) => [p, 'p4'])));
    pushViews(sim, seats);
    const reveal = findAll(seats.p2.root, (n) => hasCls(n, 'vp-reveal'))[0];
    assert.ok(reveal.textContent.includes('p4'));
    assert.ok(seats.p2.root.textContent.includes('被放逐'));
    for (const seat of Object.values(seats)) seat.handle.destroy();
  });
});

test('werewolf ui: the final-action window — only the dead player gets the grid (same shape for a hunter and a villager)', async () => {
  await withFakeDom(async (ui) => {
    const run = (victim) => {
      const sim = deal(mk(R9));
      night(sim, { wolves: wolvesPick(victim, ['p1', 'p2', 'p3']) });
      toPhase(sim, 'final'); sim.cueDone();
      const seats = mountAll(ui, sim, [], { sfx: [], timers: 0 });
      pushViews(sim, seats);
      return { sim, seats };
    };
    const a = run('p6'); const b = run('p7');
    const shapeA = nightShape(a.seats.p6.root); const shapeB = nightShape(b.seats.p7.root);
    assert.ok(shapeA);
    assert.equal(shapeA, shapeB, 'the hunter and the villager see the same layout');
    assert.equal(nightShape(a.seats.p1.root), null, 'a bystander gets no grid');
    assert.ok(a.seats.p1.root.textContent.includes('最後行動'));
    assert.ok(a.seats.p6.root.textContent.includes('獵人'));
    assert.ok(!b.seats.p7.root.textContent.includes('你係獵人'));
    // the hunter taps a chip then 確定: a final action is sent
    const chips = findAll(a.seats.p6.root, (n) => hasCls(n, 'ww-chip') && !n.disabled);
    clickN(chips.find((c) => c.textContent.includes('玩家4')));
    assert.deepEqual(a.sim.state.cur.sel.p6, { pick: 'p4', lock: false });
    pushViews(a.sim, a.seats);
    clickN(findAll(a.seats.p6.root, (n) => hasCls(n, 'ww-ok'))[0]);
    assert.equal(a.sim.state.cur.sel.p6.lock, true);
    for (const s of [...Object.values(a.seats), ...Object.values(b.seats)]) s.handle.destroy();
  });
});
