// ============================================================
// tests/custom.test.mjs — 通用派牌 + 骰盅
//   node tests/run.mjs custom
// ============================================================

import { test, assert, Sim, makePlayers, assertNoKeys, HOST, ACT } from './lib.mjs';
import { mulberry32, clone } from '../js/core/engine-kit.js';
import * as game from '../js/games/custom/game.js';

const { engine, config, meta, rules } = game;

// ---------- helpers ----------

/** Defaults for n players with some keys overridden. */
function cfgFor(n, patch = {}) {
  const base = config.defaults(n);
  const merged = { ...base, ...patch };
  // re-fit the role lists to the patched head-count rules (moderator mode etc.)
  return config.defaults(n, merged);
}

function mk(n, { seed = 1, patch = {}, config: cfg } = {}) {
  return new Sim(game, { n, seed, config: cfg ?? cfgFor(n, patch) });
}

const ids = (n) => makePlayers(n).map((p) => p.id);
const seatOf = (sim, pid) => sim.state.seats[pid];
const holderIds = (sim) => sim.state.order.filter((id) => seatOf(sim, id).playing);
const unchanged = (sim, pid, action) => assert.equal(sim.act(pid, action), false, `${pid} ${JSON.stringify(action)} should do nothing`);
const changed = (sim, pid, action) => assert.equal(sim.act(pid, action), true, `${pid} ${JSON.stringify(action)} should change state`);

function roleCounts(sim) {
  const counts = {};
  for (const id of holderIds(sim)) counts[seatOf(sim, id).roleId] = (counts[seatOf(sim, id).roleId] || 0) + 1;
  return counts;
}

const strip = (v) => { const { me, controller, all, can, ...rest } = v; return rest; };   // eslint-disable-line no-unused-vars

/** Nobody's view carries another seat's secret. */
function checkLeaks(sim) {
  const st = sim.state;
  const table = sim.view(null);
  assert.equal(table.me, null);
  assert.equal(table.controller, false);
  assert.equal(table.all, undefined);
  if (!st.revealRoles) assertNoKeys(table.seats, ['roleId'], 'table');
  if (!st.revealDice) assertNoKeys(table.seats, ['dice'], 'table');
  for (const p of sim.players) {
    const v = sim.view(p.id);
    const own = st.seats[p.id];
    // everything outside `me`/`all`/`can`/`controller` is identical to what the table sees
    assert.deepEqual(strip(v), strip(table), `public part of ${p.id}'s view differs from the table view`);
    assert.equal(v.me.id, p.id);
    assert.equal(v.me.role?.id ?? null, own.roleId);
    assert.deepEqual(v.me.dice, own.dice);
    if (!st.revealRoles) assertNoKeys(v.seats, ['roleId'], `${p.id} seats`);
    if (!st.revealDice) assertNoKeys(v.seats, ['dice'], `${p.id} seats`);
    const mayAll = p.id === st.hostPid && st.modSees && !st.revealRoles;
    assert.equal(v.all !== undefined, mayAll, `${p.id}: 'all' present=${v.all !== undefined} expected=${mayAll}`);
    assert.equal(v.controller, p.id === st.hostPid);
    assert.deepEqual(Object.keys(v.me).sort(),
      ['dice', 'diceLocked', 'id', 'mayRoll', 'playing', 'role', 'roleLocked', 'rollSeq', 'seenRole'].sort());
    // a role object only ever carries presentation fields
    if (v.me.role) assert.deepEqual(Object.keys(v.me.role).sort(), ['desc', 'emoji', 'id', 'name']);
  }
}

function checkInvariants(sim) {
  const st = sim.state;
  const holders = holderIds(sim);
  const expected = {};
  for (const r of st.roles) if (r.count) expected[r.id] = r.count;
  assert.deepEqual(roleCounts(sim), expected, 'dealt cards do not match the deck');
  assert.equal(st.roles.reduce((s, r) => s + r.count, 0), holders.length);
  for (const seat of Object.values(st.seats)) {
    if (!seat.playing) {
      assert.equal(seat.roleId, null);
      assert.equal(seat.dice, null);
      assert.equal(seat.roleLocked, false);
      assert.equal(seat.diceLocked, false);
    }
    if (seat.diceLocked) assert.ok(seat.dice, 'a lock needs a roll');
    if (seat.dice) assert.equal(seat.dice.length, st.dice.count);
    for (const d of seat.dice ?? []) assert.ok(Number.isInteger(d) && d >= 1 && d <= st.dice.sides);
    if (st.revealRoles) assert.equal(seat.roleLocked, false, 'revealed roles leave no card latched');
  }
  assert.deepEqual(JSON.parse(JSON.stringify(st)), st, 'state must be plain JSON');
}

// ---------- meta / rules ----------

test('custom: meta and rules are well-formed', () => {
  assert.equal(meta.id, 'custom');
  assert.deepEqual(meta.players, [2, 16]);
  assert.equal(meta.narration, 'none');
  assert.equal(meta.singleDevice, 'full');
  assert.ok(Array.isArray(meta.banks));
  assert.ok(rules.quick.length >= 3 && rules.quick.every((l) => typeof l === 'string' && l));
  assert.ok(rules.sections.length >= 3 && rules.sections.every((s) => s.title && s.body));
  for (const r of rules.roles) assert.ok(r.id && r.name && r.emoji && r.team && r.text);
  for (const k of ['setup', 'act', 'advance', 'view', 'cue', 'focus', 'autoAct', 'legalActions', 'result']) {
    assert.equal(typeof engine[k], 'function', `engine.${k}`);
  }
});

// ---------- config ----------

test('custom: config.defaults is valid for every head-count and every preset', () => {
  for (let n = 2; n <= 16; n++) {
    const base = config.defaults(n);
    const v = config.validate(base, n);
    assert.ok(v.ok, `n=${n}: ${v.message}`);
    for (const preset of ['cheese', 'cheeseGang', 'werewolf', 'undercover', 'custom']) {
      const c = { ...base, preset };
      const vv = config.validate(c, n);
      assert.ok(vv.ok, `n=${n} preset=${preset}: ${vv.message}`);
    }
  }
});

test('custom: defaults(n, prev) keeps the last setup and repairs it for a new head-count', () => {
  const prev = config.defaults(8, { preset: 'werewolf', diceCount: 3, diceSides: 12, selfRoll: false });
  prev.roles_werewolf[0].name = '大灰狼';
  for (const n of [3, 8, 16]) {
    const c = config.defaults(n, prev);
    assert.ok(config.validate(c, n).ok, `n=${n}`);
    assert.equal(c.preset, 'werewolf');
    assert.equal(c.diceCount, 3);
    assert.equal(c.diceSides, 12);
    assert.equal(c.selfRoll, false);
    assert.equal(c.roles_werewolf[0].name, '大灰狼');
  }
  // a head-count too small for fixed roles shrinks them instead of failing
  const small = config.defaults(3, prev);
  assert.ok(small.roles_werewolf.reduce((s, r) => s + (r.filler ? 0 : r.count), 0) <= 3);
});

test('custom: defaults repairs a no-filler list and a moderator that no longer fits', () => {
  const prev = config.defaults(5);
  prev.roles_cheese = [
    { id: 'a', name: 'A', emoji: '🅰️', count: 2, desc: '', filler: false },
    { id: 'b', name: 'B', emoji: '🅱️', count: 3, desc: '', filler: false },
  ];
  assert.ok(config.validate(prev, 5).ok);
  const c7 = config.defaults(7, prev);
  assert.ok(config.validate(c7, 7).ok, 'no-filler list must be repaired to fit 7');
  const mod = config.defaults(5, { ...prev, hostPlays: false });
  assert.equal(mod.hostPlays, false);
  assert.ok(config.validate(mod, 5).ok);
  const two = config.defaults(2, { ...prev, hostPlays: false });
  assert.equal(two.hostPlays, true, '2 seats cannot spare a moderator');
  assert.ok(config.validate(two, 2).ok);
  // garbage prev is ignored
  assert.deepEqual(config.defaults(4, 'nope'), config.defaults(4));
  assert.ok(config.validate(config.defaults(4, { preset: 'zzz', diceSides: 7, diceCount: 99, roles_cheese: [1, null] }), 4).ok);
});

test('custom: validate catches every bad setup with a Cantonese message', () => {
  const n = 5;
  const good = config.defaults(n);
  assert.equal(config.validate(good, n).ok, true);
  assert.deepEqual(config.validate(good, n).warnings, []);

  const tooMany = clone(good);
  tooMany.roles_cheese[0].count = 6;
  let v = config.validate(tooMany, n);
  assert.equal(v.ok, false);
  assert.match(v.message, /減少啲/);

  const noFiller = clone(good);
  noFiller.roles_cheese[2].filler = false; noFiller.roles_cheese[2].count = 1;
  v = config.validate(noFiller, n);
  assert.equal(v.ok, false);
  assert.match(v.message, /啱數/);
  noFiller.roles_cheese[2].count = 3;
  assert.equal(config.validate(noFiller, n).ok, true, '1+1+3 = 5 exactly');

  assert.equal(config.validate({ ...good, diceCount: 0 }, n).ok, false);
  assert.equal(config.validate({ ...good, diceCount: 6 }, n).ok, false);
  assert.equal(config.validate({ ...good, diceCount: 5 }, n).ok, true);
  assert.equal(config.validate({ ...good, diceSides: 7 }, n).ok, false);
  for (const s of [4, 6, 8, 10, 12, 20]) assert.equal(config.validate({ ...good, diceSides: s }, n).ok, true);

  const oneRole = { ...good, roles_cheese: [good.roles_cheese[0]] };
  assert.equal(config.validate(oneRole, n).ok, false);
  assert.equal(config.validate({ ...good, roles_cheese: undefined }, n).ok, false);

  // head-counts and moderator
  assert.equal(config.validate(good, 1).ok, false);
  assert.equal(config.validate(good, 17).ok, false);
  assert.equal(config.validate({ ...good, hostPlays: false }, 2).ok, false);
  v = config.validate({ ...good, hostPlays: false }, 2);
  assert.match(v.message, /3/);
  assert.equal(config.validate(cfgFor(3, { hostPlays: false }), 3).ok, true);
  assert.match(config.validate(cfgFor(5, { hostPlays: false }), 5).message, /主持/);
});

test('custom: validate warns on duplicate names and an all-same deck, and accepts form-typed numbers', () => {
  const n = 6;
  const c = config.defaults(n);
  c.roles_cheese[1].name = c.roles_cheese[0].name;
  let v = config.validate(c, n);
  assert.equal(v.ok, true);
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0], /同名/);

  const flat = config.defaults(n);
  flat.roles_cheese[0].count = 0; flat.roles_cheese[1].count = 0;
  v = config.validate(flat, n);
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => /所有人都係/.test(w)));

  // a <select>/<input> hands strings back
  const typed = { ...config.defaults(n), diceCount: '3', diceSides: '8' };
  typed.roles_cheese = typed.roles_cheese.map((r) => ({ ...r, count: String(r.count) }));
  assert.equal(config.validate(typed, n).ok, true);
  const s = new Sim(game, { n, seed: 2, config: typed });
  assert.equal(s.state.dice.count, 3);
  assert.equal(s.state.dice.sides, 8);
});

test('custom: role lists are sanitised (ids, single filler, counts, names)', () => {
  const n = 5;
  const c = config.defaults(n);
  c.roles_cheese = [
    { id: 'x', name: '  ', emoji: '', count: -3, desc: 5, filler: false },
    { id: 'x', name: '一二三四五六七八九十一二三四五六七八九十', emoji: '🧑‍🌾🧑‍🌾🧑‍🌾', count: 1.9, filler: true },
    { name: 'C', emoji: '🐱', count: '2', filler: true },   // second filler must lose its flag
    { id: 'y', name: 'D', emoji: '🐶', count: 2 },
  ];
  const sim = new Sim(game, { n, seed: 3, config: c });
  const roles = sim.state.roles;
  assert.equal(new Set(roles.map((r) => r.id)).size, roles.length, 'ids unique');
  assert.equal(roles.filter((r) => r.filler).length, 1);
  assert.equal(roles[0].count, 0);
  assert.equal(roles[0].name, '角色 1');
  assert.equal(roles[0].emoji, '❓');
  assert.equal(roles[1].name.length, 16);
  assert.equal(roles[1].emoji, '🧑‍🌾🧑‍🌾');
  assert.equal(roles.reduce((s, r) => s + r.count, 0), n);
});

test('custom: fields and summary describe the setup', () => {
  const n = 6;
  const c = config.defaults(n);
  let fields = config.fields(c, n);
  const keys = fields.map((f) => f.key);
  assert.deepEqual(keys, ['preset', 'roles_cheese', 'hostPlays', 'diceCount', 'diceSides', 'selfRoll']);
  const rolesField = fields.find((f) => f.type === 'roles');
  assert.equal(rolesField.max, n);
  assert.match(rolesField.help, /✓/);
  const preset = fields.find((f) => f.key === 'preset');
  assert.deepEqual(preset.options.map((o) => o.value), ['cheese', 'cheeseGang', 'werewolf', 'undercover', 'custom']);
  // the roles editor follows the preset, and its key exists in the config
  const w = { ...c, preset: 'werewolf' };
  fields = config.fields(w, n);
  assert.equal(fields.find((f) => f.type === 'roles').key, 'roles_werewolf');
  assert.ok(Array.isArray(w.roles_werewolf));
  // moderator mode adds the peek option
  const m = cfgFor(n, { hostPlays: false });
  assert.ok(config.fields(m, n).some((f) => f.key === 'modSees'));
  assert.ok(!config.fields(c, n).some((f) => f.key === 'modSees'));
  assert.ok(config.fields(c, n).every((f) => ['int', 'bool', 'select', 'roles'].includes(f.type)));

  const lines = config.summary(c, n);
  assert.deepEqual(lines, ['🐭 芝士小偷 ×1', '🔍 偵探 ×1', '🧑‍🌾 村民 ×4', '🎲 1 × d6', '房主一齊玩']);
  const lines2 = config.summary({ ...cfgFor(n, { hostPlays: false, modSees: true, selfRoll: false, diceCount: 2, diceSides: 10 }) }, n);
  assert.ok(lines2.includes('🎲 2 × d10（淨係主持搖得）'));
  assert.ok(lines2.some((l) => /主持/.test(l) && /睇到所有人角色/.test(l)));
  // an invalid setup still summarises
  const bad = clone(c); bad.roles_cheese[0].count = 9;
  assert.ok(config.summary(bad, n).length >= 3);
});

// ---------- setup & dealing ----------

test('custom: setup deals exactly the configured deck, one card per holder', () => {
  for (let n = 2; n <= 16; n++) {
    const sim = mk(n, { seed: n });
    checkInvariants(sim);
    assert.equal(sim.state.phase, 'play');
    assert.equal(sim.state.round, 1);
    assert.equal(holderIds(sim).length, n);
    assert.equal(sim.result(), null);
  }
});

test('custom: werewolf preset deals 2 wolves, seer, witch, hunter and the rest 平民 at 8 players', () => {
  const sim = mk(8, { patch: { preset: 'werewolf' } });
  const byName = {};
  for (const id of holderIds(sim)) {
    const r = sim.state.roles.find((x) => x.id === seatOf(sim, id).roleId);
    byName[r.name] = (byName[r.name] || 0) + 1;
  }
  assert.deepEqual(byName, { 狼人: 2, 預言家: 1, 女巫: 1, 獵人: 1, 平民: 3 });
});

test('custom: same seed gives the same deal, different seeds differ', () => {
  const a = mk(8, { seed: 5 });
  const b = mk(8, { seed: 5 });
  assert.deepEqual(a.state, b.state);
  const deals = new Set();
  for (let s = 1; s <= 30; s++) deals.add(JSON.stringify(Object.values(mk(8, { seed: s }).state.seats).map((x) => x.roleId)));
  assert.ok(deals.size > 20, 'dealing looks shuffled');
});

test('custom: every seat is equally likely to hold the single thief (no seat bias)', () => {
  const n = 5;
  const hits = Array(n).fill(0);
  for (let s = 1; s <= 2000; s++) {
    const sim = mk(n, { seed: s });
    const thief = sim.state.roles[0].id;
    holderIds(sim).forEach((id, i) => { if (seatOf(sim, id).roleId === thief) hits[i]++; });
  }
  for (const h of hits) assert.ok(h > 300 && h < 500, `seat bias: ${hits}`);
});

test('custom: setup throws on an invalid config (the room validates first)', () => {
  const bad = config.defaults(5);
  bad.roles_cheese[0].count = 9;
  assert.throws(() => engine.setup({ players: makePlayers(5), config: bad, rng: mulberry32(1), now: 0 }), /invalid config/);
});

// ---------- who is the host ----------

test('custom: host identity comes from hostPid, then an isHost flag, then the first seat', () => {
  const players = makePlayers(5);
  const cfg = cfgFor(5, { hostPlays: false });
  const rng = () => mulberry32(4);
  assert.equal(engine.setup({ players, config: cfg, rng: rng(), now: 0 }).hostPid, 'p1');
  assert.equal(engine.setup({ players: players.map((p) => ({ ...p, isHost: p.id === 'p3' })), config: cfg, rng: rng(), now: 0 }).hostPid, 'p3');
  const viaParam = engine.setup({ players: players.map((p) => ({ ...p, isHost: p.id === 'p3' })), config: cfg, rng: rng(), now: 0, hostPid: 'p4' });
  assert.equal(viaParam.hostPid, 'p4');
  assert.equal(viaParam.seats.p4.playing, false, 'the moderator holds no card');
  assert.equal(viaParam.seats.p3.playing, true);
  assert.equal(engine.setup({ players, config: cfg, rng: rng(), now: 0, hostPid: 'ghost' }).hostPid, 'p1');
  // seat order, not array order, decides the fallback
  const shuffled = [players[3], players[0], players[4], players[2], players[1]].map((p, i) => ({ ...p, seat: [3, 0, 4, 2, 1][i] }));
  assert.equal(engine.setup({ players: shuffled, config: cfg, rng: rng(), now: 0 }).hostPid, 'p1');
});

test('custom: only the host seat can use host actions', () => {
  const sim = mk(5);
  const before = JSON.stringify(sim.state);
  for (const pid of ['p2', 'p3', 'p4', 'p5']) {
    for (const type of ['roll-all', 'unlock-dice', 'reveal-dice', 'reveal-roles', 'redeal', 'next-round', 'end']) {
      unchanged(sim, pid, { type });
    }
  }
  assert.equal(JSON.stringify(sim.state), before);
  changed(sim, 'p1', { type: 'roll-all' });
});

// ---------- the role card ----------

test('custom: peeking is public as 已睇牌 and drives focus in seat order', () => {
  const sim = mk(4);
  assert.deepEqual(sim.focus(), { pids: ['p1', 'p2', 'p3', 'p4'] });
  assert.equal(sim.view('p3').seats[1].seenRole, false);
  changed(sim, 'p2', { type: 'seen' });
  assert.equal(sim.view('p3').seats[1].seenRole, true);
  assert.deepEqual(sim.focus(), { pids: ['p1', 'p3', 'p4'] });
  unchanged(sim, 'p2', { type: 'seen' });   // already seen: no-op
  for (const p of ['p1', 'p3', 'p4']) changed(sim, p, { type: 'seen' });
  assert.equal(sim.focus(), null);
});

test('custom: autoAct skips a stalled seat\'s peek and nothing else', () => {
  const sim = mk(4);
  assert.deepEqual(engine.autoAct(sim.state, 'p3', sim.ctx()), { type: 'seen' });
  changed(sim, 'p3', engine.autoAct(sim.state, 'p3', sim.ctx()));
  assert.equal(engine.autoAct(sim.state, 'p3', sim.ctx()), null);
  assert.equal(engine.autoAct(sim.state, 'ghost', sim.ctx()), null);
  const mod = mk(4, { patch: { hostPlays: false } });
  assert.equal(engine.autoAct(mod.state, 'p1', mod.ctx()), null, 'the moderator has no card to look at');
});

test('custom: role lock latches the card, only its owner toggles it', () => {
  const sim = mk(4);
  unchanged(sim, 'p2', { type: 'lock-role', on: false });   // not locked yet
  unchanged(sim, 'p2', { type: 'lock-role' });              // needs an explicit boolean
  unchanged(sim, 'p2', { type: 'lock-role', on: 'yes' });
  changed(sim, 'p2', { type: 'lock-role', on: true });
  assert.equal(seatOf(sim, 'p2').roleLocked, true);
  assert.equal(seatOf(sim, 'p2').seenRole, true, 'latching counts as done looking');
  assert.equal(sim.view('p3').seats[1].roleLocked, true);
  assert.equal(sim.view('p2').me.roleLocked, true);
  unchanged(sim, 'p2', { type: 'lock-role', on: true });
  unchanged(sim, 'p3', { type: 'lock-role', on: false });   // someone else cannot unlock p2's card
  assert.equal(seatOf(sim, 'p2').roleLocked, true);
  assert.deepEqual(sim.view('p2').can.unlockRole, true);
  assert.deepEqual(sim.view('p2').can.lockRole, false);
  changed(sim, 'p2', { type: 'lock-role', on: false });
  assert.equal(seatOf(sim, 'p2').roleLocked, false);
});

test('custom: redeal reshuffles the same round, resets looks and locks, keeps the dice', () => {
  const sim = mk(6, { seed: 11 });
  changed(sim, 'p2', { type: 'roll' });
  changed(sim, 'p3', { type: 'lock-role', on: true });
  changed(sim, 'p4', { type: 'seen' });
  const dice = clone(seatOf(sim, 'p2').dice);
  const dealId = sim.state.dealId;
  let reshuffled = false;
  for (let i = 0; i < 10 && !reshuffled; i++) {
    const before = holderIds(sim).map((id) => seatOf(sim, id).roleId).join();
    changed(sim, 'p1', { type: 'redeal' });
    reshuffled = holderIds(sim).map((id) => seatOf(sim, id).roleId).join() !== before;
  }
  assert.ok(reshuffled, 'redeal eventually changes who holds what');
  assert.equal(sim.state.round, 1);
  assert.ok(sim.state.dealId > dealId);
  assert.deepEqual(seatOf(sim, 'p2').dice, dice);
  assert.equal(seatOf(sim, 'p3').roleLocked, false);
  assert.equal(seatOf(sim, 'p4').seenRole, false);
  assert.equal(sim.focus().pids.length, 6);
  checkInvariants(sim);
});

test('custom: next round deals fresh cards and clears dice, dice locks and the reveal', () => {
  const sim = mk(5, { seed: 8 });
  for (const p of ['p2', 'p3']) { changed(sim, p, { type: 'roll' }); }
  changed(sim, 'p2', { type: 'lock-dice' });
  const seq = seatOf(sim, 'p3').rollSeq;
  changed(sim, 'p1', { type: 'reveal-dice' });
  changed(sim, 'p1', { type: 'reveal-roles' });
  changed(sim, 'p1', { type: 'next-round' });
  assert.equal(sim.state.round, 2);
  assert.equal(sim.state.revealRoles, false);
  assert.equal(sim.state.revealDice, false);
  for (const s of Object.values(sim.state.seats)) {
    assert.equal(s.dice, null);
    assert.equal(s.diceLocked, false);
    assert.equal(s.roleLocked, false);
    assert.equal(s.seenRole, false);
  }
  assert.equal(seatOf(sim, 'p3').rollSeq, seq, 'the roll counter is never reset (chime logic keys on it)');
  assert.equal(sim.view('p2').subtitle, '第 2 回合');
  assert.equal(sim.focus().pids.length, 5);
  changed(sim, 'p3', { type: 'roll' });   // the table can roll again
  assert.equal(seatOf(sim, 'p3').rollSeq, seq + 1);
  checkInvariants(sim);
});

test('custom: reveal roles opens every card, drops the card latches, and is final for the round', () => {
  const sim = mk(5, { seed: 9 });
  changed(sim, 'p2', { type: 'lock-role', on: true });
  assertNoKeys(sim.view('p3').seats, ['roleId']);
  changed(sim, 'p1', { type: 'reveal-roles' });
  unchanged(sim, 'p1', { type: 'reveal-roles' });
  assert.equal(seatOf(sim, 'p2').roleLocked, false);
  const v = sim.view('p3');
  assert.equal(v.revealRoles, true);
  for (const s of v.seats) assert.equal(s.roleId, seatOf(sim, s.id).roleId);
  unchanged(sim, 'p2', { type: 'lock-role', on: true });
  unchanged(sim, 'p3', { type: 'seen' });
  assert.equal(sim.focus(), null);
  assert.equal(engine.autoAct(sim.state, 'p3', sim.ctx()), null);
});

// ---------- dice ----------

test('custom: rolls are in range, hidden from others, and the counter counts rolls not values', () => {
  for (const sides of [4, 6, 8, 10, 12, 20]) {
    const sim = mk(3, { seed: sides, patch: { diceCount: 5, diceSides: sides } });
    assert.equal(sim.view('p2').me.dice, null);
    changed(sim, 'p2', { type: 'roll' });
    const mine = sim.view('p2').me.dice;
    assert.equal(mine.length, 5);
    for (const d of mine) assert.ok(d >= 1 && d <= sides);
    assert.equal(sim.view('p2').me.rollSeq, 1);
    assert.equal(sim.view('p3').seats[1].rolled, true);
    assert.equal(sim.view('p3').me.dice, null);
    checkLeaks(sim);
  }
  // a d4 re-rolled many times repeats a number; the counter still moves every time
  const sim = mk(2, { seed: 1, patch: { diceSides: 4 } });
  let last = null;
  let repeats = 0;
  for (let i = 1; i <= 60; i++) {
    changed(sim, 'p2', { type: 'roll' });
    const cur = JSON.stringify(sim.view('p2').me.dice);
    if (cur === last) repeats++;
    last = cur;
    assert.equal(sim.view('p2').me.rollSeq, i);
  }
  assert.ok(repeats > 0, 'expected at least one repeated roll among 60 d4 rolls');
});

test('custom: dice are fair enough (each face of a d6 within 20% of even)', () => {
  const sim = mk(2, { seed: 77 });
  const tally = Array(7).fill(0);
  for (let i = 0; i < 6000; i++) { sim.act('p2', { type: 'roll' }); tally[sim.state.seats.p2.dice[0]]++; }
  for (let f = 1; f <= 6; f++) assert.ok(tally[f] > 800 && tally[f] < 1200, `face ${f}: ${tally}`);
});

test('custom: a locked cup keeps its roll, refuses to roll, and only the host can lift it', () => {
  const sim = mk(5, { seed: 3 });
  unchanged(sim, 'p2', { type: 'lock-dice' });   // nothing rolled yet, nothing to freeze
  changed(sim, 'p2', { type: 'roll' });
  const frozen = clone(seatOf(sim, 'p2').dice);
  changed(sim, 'p2', { type: 'lock-dice' });
  unchanged(sim, 'p2', { type: 'lock-dice' });
  for (let i = 0; i < 5; i++) unchanged(sim, 'p2', { type: 'roll' });
  assert.deepEqual(seatOf(sim, 'p2').dice, frozen);
  assert.deepEqual(sim.view('p2').me.dice, frozen, 'a locked cup can still be read by its owner');
  assert.equal(sim.view('p2').me.diceLocked, true);
  assert.equal(sim.view('p3').seats[1].diceLocked, true);
  assert.equal(sim.view('p2').can.roll, false);
  assert.equal(sim.view('p2').me.mayRoll, true, 'it may roll in general, the lock is what blocks it');
  // nobody but the host lifts it — not even the owner
  unchanged(sim, 'p2', { type: 'unlock-dice' });
  unchanged(sim, 'p2', { type: 'unlock-dice', pid: 'p2' });
  unchanged(sim, 'p3', { type: 'unlock-dice' });
  assert.equal(seatOf(sim, 'p2').diceLocked, true);
  // the host can target one seat, and cannot "unlock" a seat that is not locked
  unchanged(sim, 'p1', { type: 'unlock-dice', pid: 'p3' });
  unchanged(sim, 'p1', { type: 'unlock-dice', pid: 'ghost' });
  unchanged(sim, 'p1', { type: 'unlock-dice', pid: {} });
  changed(sim, 'p1', { type: 'unlock-dice', pid: 'p2' });
  assert.equal(seatOf(sim, 'p2').diceLocked, false);
  assert.deepEqual(seatOf(sim, 'p2').dice, frozen, 'unlocking does not touch the roll');
  changed(sim, 'p2', { type: 'roll' });
  // unlock-all
  for (const p of ['p2', 'p3', 'p4']) { if (!seatOf(sim, p).dice) sim.act(p, { type: 'roll' }); sim.act(p, { type: 'lock-dice' }); }
  changed(sim, 'p1', { type: 'unlock-dice' });
  for (const p of ['p2', 'p3', 'p4']) assert.equal(seatOf(sim, p).diceLocked, false);
  unchanged(sim, 'p1', { type: 'unlock-dice' });
});

test('custom: roll-all rolls every card holder, lifts every lock, and hides revealed dice', () => {
  const sim = mk(4, { seed: 6 });
  changed(sim, 'p2', { type: 'roll' });
  changed(sim, 'p2', { type: 'lock-dice' });
  const seqs = sim.state.order.map((id) => seatOf(sim, id).rollSeq);
  changed(sim, 'p1', { type: 'roll-all' });
  sim.state.order.forEach((id, i) => {
    assert.equal(seatOf(sim, id).rollSeq, seqs[i] + 1);
    assert.ok(seatOf(sim, id).dice);
    assert.equal(seatOf(sim, id).diceLocked, false);
  });
  changed(sim, 'p1', { type: 'reveal-dice' });
  changed(sim, 'p1', { type: 'roll-all' });
  assert.equal(sim.state.revealDice, false);
  assertNoKeys(sim.view('p2').seats, ['dice']);
});

test('custom: selfRoll off lets only the host roll (own cup or everyone)', () => {
  const sim = mk(4, { seed: 2, patch: { selfRoll: false } });
  for (const p of ['p2', 'p3', 'p4']) {
    unchanged(sim, p, { type: 'roll' });
    assert.equal(sim.view(p).me.mayRoll, false);
  }
  assert.equal(sim.view('p1').me.mayRoll, true);
  changed(sim, 'p1', { type: 'roll' });
  changed(sim, 'p1', { type: 'roll-all' });
  for (const p of ['p2', 'p3', 'p4']) assert.ok(seatOf(sim, p).dice);
  changed(sim, 'p2', { type: 'lock-dice' });   // locking what the host rolled for you is still fine
});

test('custom: reveal dice shows every roll, needs a roll, and freezes the table until the host moves on', () => {
  const sim = mk(4, { seed: 12 });
  unchanged(sim, 'p1', { type: 'reveal-dice' });   // nobody has rolled
  changed(sim, 'p2', { type: 'roll' });
  changed(sim, 'p3', { type: 'roll' });
  changed(sim, 'p1', { type: 'reveal-dice' });
  unchanged(sim, 'p1', { type: 'reveal-dice' });
  const v = sim.view('p4');
  assert.deepEqual(v.seats[1].dice, seatOf(sim, 'p2').dice);
  assert.deepEqual(v.seats[2].dice, seatOf(sim, 'p3').dice);
  assert.equal('dice' in v.seats[3], false, 'a seat that never rolled has nothing to show');
  assert.equal(v.revealDice, true);
  // once the cups are open, re-rolling or locking one cup would be a swap
  unchanged(sim, 'p2', { type: 'roll' });
  unchanged(sim, 'p4', { type: 'roll' });
  unchanged(sim, 'p3', { type: 'lock-dice' });
  assert.equal(sim.view('p2').me.mayRoll, false);
  // the way forward is the host
  changed(sim, 'p1', { type: 'roll-all' });
  changed(sim, 'p2', { type: 'roll' });
});

test('custom: the moderator holds no card and no dice but runs the table', () => {
  const sim = mk(5, { seed: 4, patch: { hostPlays: false } });
  assert.equal(seatOf(sim, 'p1').playing, false);
  assert.equal(holderIds(sim).length, 4);
  assert.equal(sim.view('p1').me.role, null);
  assert.equal(sim.view('p1').me.playing, false);
  assert.equal(sim.view('p1').me.mayRoll, false);
  for (const a of [{ type: 'roll' }, { type: 'seen' }, { type: 'lock-dice' }, { type: 'lock-role', on: true }]) unchanged(sim, 'p1', a);
  assert.ok(!sim.focus().pids.includes('p1'));
  changed(sim, 'p1', { type: 'roll-all' });
  assert.equal(seatOf(sim, 'p1').dice, null, 'roll-all skips the moderator');
  assert.ok(seatOf(sim, 'p2').dice);
  changed(sim, 'p1', { type: 'next-round' });
  assert.equal(seatOf(sim, 'p1').roleId, null);
  checkInvariants(sim);
  checkLeaks(sim);
  // a one-card-holder deck cannot even be started
  assert.equal(config.validate(config.defaults(3), 3).ok, true);
  assert.equal(config.validate({ ...config.defaults(3), hostPlays: false }, 2).ok, false);
});

test('custom: the moderator sees every role only when asked to, and only until the reveal', () => {
  const blind = mk(5, { patch: { hostPlays: false } });
  assert.equal(blind.view('p1').all, undefined);
  const sees = mk(5, { seed: 5, patch: { hostPlays: false, modSees: true } });
  const all = sees.view('p1').all;
  assert.deepEqual(Object.keys(all).sort(), ['p2', 'p3', 'p4', 'p5']);
  for (const [pid, roleId] of Object.entries(all)) assert.equal(roleId, seatOf(sees, pid).roleId);
  for (const p of ['p2', 'p3', 'p4', 'p5']) assert.equal(sees.view(p).all, undefined);
  assert.equal(sees.view(null).all, undefined);
  changed(sees, 'p1', { type: 'reveal-roles' });
  assert.equal(sees.view('p1').all, undefined, 'after the reveal it is in the public seats instead');
  checkLeaks(sees);
  // modSees means nothing while the host plays
  const plays = mk(5, { patch: { hostPlays: true, modSees: true } });
  assert.equal(plays.state.modSees, false);
  assert.equal(plays.view('p1').all, undefined);
});

// ---------- ending ----------

test('custom: ending reveals everything, produces a result and shuts the table', () => {
  const sim = mk(4, { seed: 21, patch: { diceCount: 2 } });
  changed(sim, 'p2', { type: 'roll' });
  changed(sim, 'p2', { type: 'lock-dice' });
  changed(sim, 'p1', { type: 'next-round' });
  changed(sim, 'p2', { type: 'roll' });
  changed(sim, 'p3', { type: 'roll' });
  assert.equal(sim.result(), null);
  changed(sim, 'p1', { type: 'end' });
  const res = sim.result();
  assert.deepEqual(res.winners, []);
  assert.match(res.summary, /2 回合/);
  assert.equal(res.lines.length, 1 + 4);
  for (const id of sim.state.order) {
    const seat = seatOf(sim, id);
    const role = sim.state.roles.find((r) => r.id === seat.roleId);
    const line = res.lines.find((l) => l.startsWith(`${seat.name}：`));
    assert.ok(line.includes(role.name), line);
    if (seat.dice) assert.ok(line.includes(`🎲 ${seat.dice.join(' ')}`), line);
    else assert.ok(!line.includes('🎲'), line);
  }
  assert.equal(sim.state.phase, 'ended');
  assert.equal(sim.view('p3').phase, 'ended');
  assert.equal(sim.view('p3').revealRoles, true);
  assert.equal(sim.view('p3').revealDice, true);
  for (const p of sim.players) {
    assert.deepEqual(sim.legal(p.id), []);
    for (const type of ['roll', 'seen', 'roll-all', 'next-round', 'redeal', 'end']) unchanged(sim, p.id, { type });
  }
  assert.equal(sim.focus(), null);
});

test('custom: the result names a moderator as 主持 and leaves winners empty', () => {
  const sim = mk(4, { seed: 2, patch: { hostPlays: false } });
  changed(sim, 'p1', { type: 'end' });
  const res = sim.result();
  assert.ok(res.lines.some((l) => l === `${sim.players[0].name}：主持（冇牌）`));
  assert.deepEqual(res.winners, []);
});

// ---------- robustness ----------

test('custom: garbage from the network never throws and never changes the state', () => {
  const sim = mk(4, { seed: 1 });
  const before = JSON.stringify(sim.state);
  const msgs = [
    undefined, null, 0, 'roll', [], {}, { pid: 'p1' }, { action: { type: 'roll' } },
    { pid: 'p1', action: null }, { pid: 'p1', action: 'roll' }, { pid: 'p1', action: [] }, { pid: 'p1', action: {} },
    { pid: 'p1', action: { type: 5 } }, { pid: 'p1', action: { type: null } },
    { pid: 'p1', action: { type: '__proto__' } }, { pid: 'p1', action: { type: 'constructor' } },
    { pid: 'p1', action: { type: 'toString' } }, { pid: 'p1', action: { type: 'hasOwnProperty' } },
    { pid: 'constructor', action: { type: 'roll' } }, { pid: '__proto__', action: { type: 'roll' } },
    { pid: 'toString', action: { type: 'seen' } }, { pid: 'ghost', action: { type: 'roll-all' } },
    { pid: 7, action: { type: 'roll' } }, { pid: ['p1'], action: { type: 'roll-all' } },
    { pid: 'p1', action: { type: 'unlock-dice', pid: '__proto__' } },
    { pid: 'p1', action: { type: 'unlock-dice', pid: 'constructor' } },
    { pid: 'p2', action: { type: 'lock-role', on: 1 } },
    { pid: HOST, action: { type: ACT.NEXT } }, { pid: HOST, action: { type: ACT.CUE_DONE, id: 'x' } },
    { pid: HOST, action: { type: ACT.AUTO, pid: 'p2' } }, { pid: HOST, action: { type: 'roll-all' } },
  ];
  for (const m of msgs) {
    const next = engine.act(clone(sim.state), m, sim.ctx());
    assert.equal(JSON.stringify(next ?? sim.state), before, `message ${JSON.stringify(m)} changed the state`);
  }
  // views for odd pids are the public table view
  for (const odd of [undefined, 'ghost', 'constructor', '__proto__', 42]) {
    const v = engine.view(sim.state, odd);
    assert.equal(v.me, null);
    assert.equal(v.controller, false);
  }
  assert.deepEqual(engine.legalActions(sim.state, 'constructor'), []);
  assert.equal(engine.advance(clone(sim.state), sim.ctx()) === undefined, false);
  assert.equal(engine.cue(sim.state), null);
});

test('custom: views are whitelist-built (no state field leaks through by name)', () => {
  const sim = mk(5, { seed: 3, patch: { hostPlays: false, modSees: true } });
  const topKeys = ['all', 'can', 'controller', 'dealId', 'dice', 'log', 'me', 'phase', 'revealDice', 'revealRoles', 'roles', 'round', 'seats', 'selfRoll', 'subtitle', 'title'];
  assert.deepEqual(Object.keys(sim.view('p1')).sort(), topKeys);
  assert.deepEqual(Object.keys(sim.view('p2')).sort(), topKeys.filter((k) => k !== 'all'));
  assert.deepEqual(Object.keys(sim.view(null)).sort(), topKeys.filter((k) => k !== 'all'));
  const seatKeys = ['diceLocked', 'id', 'name', 'playing', 'roleLocked', 'rolled', 'seenRole'];
  for (const s of sim.view('p3').seats) assert.deepEqual(Object.keys(s).sort(), seatKeys);
  assert.equal(sim.view('p1').deadline, undefined, 'no timers here');
  for (const r of sim.view('p3').roles) assert.deepEqual(Object.keys(r).sort(), ['count', 'desc', 'emoji', 'filler', 'id', 'name']);
  // internals stay internal
  const json = JSON.stringify(sim.view('p3'));
  for (const k of ['hostPid', 'logSeq', 'order', 'roleId']) assert.ok(!json.includes(`"${k}"`), `view leaks "${k}"`);
  // the public log never contains a number a die showed or a role name from a deal
  changed(sim, 'p2', { type: 'roll' });
  changed(sim, 'p2', { type: 'lock-dice' });
  const text = sim.view('p3').log.map((l) => l.text).join('\n');
  assert.match(text, /搖咗骰/);
  assert.ok(!/[0-9]+\s*(點|,)/.test(text.replace(/第 \d+ 回合/g, '')));
});

test('custom: the log is bounded, ordered, and every entry is unique', () => {
  const sim = mk(3, { seed: 1 });
  for (let i = 0; i < 100; i++) changed(sim, 'p1', { type: 'redeal' });   // identical text each time
  assert.ok(sim.state.log.length <= 40);
  const v = sim.view('p2');
  assert.equal(v.log.length, 25);
  const ns = v.log.map((l) => l.n);
  assert.deepEqual(ns, [...ns].sort((a, b) => a - b));
  assert.equal(new Set(ns).size, ns.length);
});

test('custom: state survives a JSON round trip mid-game (host snapshot)', () => {
  const sim = mk(6, { seed: 31, patch: { hostPlays: false, modSees: true, diceCount: 3 } });
  for (const [p, a] of [['p2', { type: 'roll' }], ['p2', { type: 'lock-dice' }], ['p3', { type: 'seen' }], ['p4', { type: 'lock-role', on: true }], ['p1', { type: 'roll-all' }]]) sim.act(p, a);
  const restored = JSON.parse(JSON.stringify(sim.state));
  assert.deepEqual(restored, sim.state);
  for (const p of sim.players) assert.deepEqual(engine.view(restored, p.id), sim.view(p.id));
  const next = engine.act(restored, { pid: 'p1', action: { type: 'next-round' } }, sim.ctx());
  assert.equal(next.round, 2);
});

test('custom: legalActions only offers actions that change something, for every seat in every state', () => {
  const sim = mk(5, { seed: 14 });
  const script = [['p2', { type: 'roll' }], ['p2', { type: 'lock-dice' }], ['p3', { type: 'lock-role', on: true }], ['p1', { type: 'reveal-dice' }],
    ['p1', { type: 'unlock-dice' }], ['p1', { type: 'roll-all' }], ['p1', { type: 'reveal-roles' }], ['p1', { type: 'next-round' }]];
  const sweep = () => {
    for (const p of sim.players) {
      for (const a of sim.legal(p.id)) {
        const probe = engine.act(clone(sim.state), { pid: p.id, action: a }, { ...sim.ctx(), rng: mulberry32(1) });
        assert.notEqual(JSON.stringify(probe), JSON.stringify(sim.state), `${p.id} ${JSON.stringify(a)} is legal but does nothing`);
      }
    }
  };
  sweep();
  for (const [pid, a] of script) { sim.act(pid, a); sweep(); }
});

// ---------- fuzz ----------

test('custom: fuzz — every head-count x 100 seeds plays to the end without leaking', () => {
  const presets = ['cheese', 'cheeseGang', 'werewolf', 'undercover', 'custom'];
  let games = 0;
  for (let n = 2; n <= 16; n++) {
    for (let seed = 1; seed <= 100; seed++) {
      const moderator = n >= 3 && seed % 3 === 0;
      const cfg = config.defaults(n, {
        ...config.defaults(n),
        preset: presets[seed % presets.length],
        hostPlays: !moderator,
        modSees: moderator && seed % 2 === 0,
        diceCount: 1 + (seed % 5),
        diceSides: [4, 6, 8, 10, 12, 20][seed % 6],
        selfRoll: seed % 4 !== 0,
      });
      assert.ok(config.validate(cfg, n).ok, `n=${n} seed=${seed}: ${config.validate(cfg, n).message}`);
      const sim = new Sim(game, { n, seed, config: cfg });
      const deep = seed <= 2 || seed === 6 || seed === 12;   // 6 and 12 are moderator + modSees runs   // full leak sweep after every step on a subset; invariants on every step for seeds <= 10, every 4th otherwise
      const { result, steps } = sim.runRandom({
        onStep: (s) => { if (seed <= 10 || s.steps % 4 === 0) checkInvariants(s); if (deep) checkLeaks(s); },
      });
      assert.ok(steps > 0);
      assert.ok(Array.isArray(result.lines) && result.lines.length >= 2);
      checkLeaks(sim);
      assert.equal(sim.state.phase, 'ended');
      games++;
    }
  }
  assert.equal(games, 15 * 100);
});

test('custom: fuzz — long games with many rounds stay consistent', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const n = 2 + (seed % 15);
    const sim = mk(n, { seed });
    const host = sim.state.hostPid;
    let rounds = 1;
    for (let step = 0; step < 400; step++) {
      const pid = sim.players[Math.floor(sim.rng() * sim.players.length)].id;
      const options = sim.legal(pid).filter((a) => a.type !== 'end');
      if (!options.length) continue;
      const a = options[Math.floor(sim.rng() * options.length)];
      if (pid === host && a.type === 'next-round') rounds++;
      sim.act(pid, a);
      checkInvariants(sim);
      if (step % 20 === 0) checkLeaks(sim);
    }
    assert.equal(sim.state.round, rounds);
    assert.equal(sim.result(), null);
  }
});
