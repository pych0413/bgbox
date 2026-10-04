// ============================================================
// tests/custom.test.mjs — 通用派牌 + 骰盅
//   node tests/run.mjs custom
// ============================================================

import { test, assert, Sim, makePlayers, assertNoKeys, HOST, ACT } from './lib.mjs';
import { mulberry32, clone } from '../js/core/engine-kit.js';
import * as game from '../js/games/custom/game.js';
import { GAMES } from '../js/games/registry.js';
import { roleParts, roleFor } from '../js/ui/logic.js';

const { engine, config, meta, rules } = game;
const PRESETS = ['traitor', 'teams', 'king', 'killer', 'werewolf', 'custom'];

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

const strip = (v) => { const { me, controller, all, can, hint, ...rest } = v; return rest; };   // eslint-disable-line no-unused-vars

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

test('custom: registry meta matches game meta (G16)', () => {
  const e = GAMES.find((g) => g.id === 'custom');
  assert.ok(e);
  for (const k of ['name', 'emoji', 'blurb']) assert.equal(e.meta[k], meta[k], k);
  assert.deepEqual(e.meta.players, meta.players);
  assert.deepEqual(e.meta.minutes, meta.minutes);
});

test('custom: U1 — quick rules are ≤ 6 short lines and every role says what you do and how you win', () => {
  assert.ok(rules.quick.length <= 6, `${rules.quick.length} quick lines`);
  for (const l of rules.quick) assert.ok(l.length <= 30, `quick line too long: ${l}`);
  for (const r of rules.roles) {
    assert.match(r.text, /做乜/, `${r.id}: what you do`);
    assert.match(r.text, /點贏/, `${r.id}: how you win`);
    const { what, win } = roleParts(r.text);   // as the 💡 sheet shows it
    assert.ok(what && win && !/做乜|點贏/.test(what + win), `${r.id}: splits cleanly into 做乜 / 點贏`);
    assert.notEqual(r.team, 'neutral', `${r.id}: 'neutral' renders as 第三陣營`);
  }
  // rules.roles ids never clash with dealt role ids (<preset>_<n>), so nothing can show the wrong text for a card
  const dealt = new Set(PRESETS.flatMap((p) => config.defaults(16, { preset: p })[`roles_${p}`].map((r) => r.id)));
  for (const r of rules.roles) assert.ok(!dealt.has(r.id), r.id);
});

test('custom: G17 — no invented Cheese Thief presets or roles (偵探 / 守衛); a saved v1 cheese setup falls back to the default', () => {
  const everything = [JSON.stringify(rules)];
  for (let n = 2; n <= 16; n++) {
    const c = config.defaults(n);
    everything.push(JSON.stringify(c), JSON.stringify(config.fields(c, n)), JSON.stringify(config.summary(c, n)));
  }
  const text = everything.join('\n');
  for (const bad of ['偵探', '守衛', '芝士小偷', 'Cheese Thief', 'cheese']) assert.ok(!text.includes(bad), `still mentions ${bad}`);
  assert.match(rules.sections[0].body, /芝士大盜/, 'points people to the real game');
  const v1 = config.defaults(6, {
    preset: 'cheeseGang', diceCount: 2,
    roles_cheese: [{ id: 'a', name: '偵探', emoji: '🔍', count: 1 }, { id: 'b', name: '村民', emoji: '🧑', filler: true }],
  });
  assert.equal(v1.preset, 'traitor');
  assert.equal(v1.diceCount, 2, 'the rest of the saved setup survives');
  assert.equal(v1.roles_cheese, undefined);
  assert.ok(config.validate(v1, 6).ok);
});

// ---------- presets (BACKLOG #8) ----------

test('custom: #8 — every preset is valid for every head-count, host playing or moderating, with a reason in the picker', () => {
  for (let n = 2; n <= 16; n++) {
    for (const hostPlays of [true, false]) {
      if (!hostPlays && n < 3) continue;
      const k = hostPlays ? n : n - 1;
      for (const preset of PRESETS) {
        const c = config.defaults(n, { preset, hostPlays });
        const v = config.validate(c, n);
        assert.ok(v.ok, `n=${n} host=${hostPlays} ${preset}: ${v.message}`);
        assert.equal(c.preset, preset);
        assert.equal(c.hostPlays, hostPlays);
        const f = config.fields(c, n).find((x) => x.key === 'preset');
        if (preset !== 'custom') assert.ok(f.help.startsWith(hostPlays ? `${k} 人：` : `${k} 人攞牌：`), `${preset}: ${f.help}`);
        assert.ok(f.help.length <= 75, `reason too long: ${f.help}`);
        for (const o of f.options) if (o.value !== 'custom') assert.match(o.label, / — \S.*\d/, `option shows the mix: ${o.label}`);
        // the stock text is complete (not cut by the 60-character limit) and says how you win
        for (const r of c[`roles_${preset}`]) {
          if (preset === 'custom') continue;
          assert.ok(r.desc.length <= 60 && r.desc.endsWith('。'), `${preset}/${r.name}: ${r.desc}`);
          const parts = roleParts(r.desc);   // the shell's 💡 sheet splits the card text the same way
          assert.ok(parts.what && parts.win, `${preset}/${r.name} says what you do and how you win: ${r.desc}`);
        }
        // the mix in the picker adds up to the card holders
        const opt = f.options.find((o) => o.value === preset);
        if (!['custom', 'king'].includes(preset)) {
          const sum = [...opt.label.split(' — ')[1].matchAll(/(\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);
          assert.equal(sum, k, `${preset} n=${n}: ${opt.label}`);
        }
      }
    }
  }
});

test('custom: #8 — an untouched preset follows the head-count; an edited one is kept and repaired', () => {
  const at8 = config.defaults(8, { preset: 'werewolf' });
  const wolves = (c) => c.roles_werewolf.find((r) => r.name === '狼人' || r.name === '大灰狼').count;
  assert.equal(wolves(at8), 2);
  assert.equal(wolves(config.defaults(12, at8)), 3, 'untouched: 12 players get 3 wolves');
  assert.equal(wolves(config.defaults(5, at8)), 1);
  const edited = clone(at8);
  edited.roles_werewolf[0].name = '大灰狼';
  const e12 = config.defaults(12, edited);
  assert.equal(e12.roles_werewolf[0].name, '大灰狼');
  assert.equal(wolves(e12), 2, 'edited: the count is the host\'s choice');
  // a one-of-a-kind deck (國王 + numbers) is trimmed, never padded with a repeated card
  const k5 = config.defaults(5, { preset: 'king' });
  assert.equal(k5.roles_king.length, 5);
  assert.equal(config.defaults(9, k5).roles_king.length, 9, 'untouched king deck grows with the table');
  const renamed = clone(k5);
  renamed.roles_king[0].name = '皇帝';
  const r4 = config.defaults(4, renamed);
  assert.ok(config.validate(r4, 4).ok);
  assert.equal(r4.roles_king[0].name, '皇帝', 'trimmed, rename kept');
  assert.ok(r4.roles_king.every((r) => !r.filler && r.count <= 1));
  const r9 = config.defaults(9, renamed);
  assert.ok(config.validate(r9, 9).ok);
  assert.ok(r9.roles_king.every((r) => !r.filler && r.count <= 1), 'never two kings or two 3 號');
});

test('custom: king preset deals one 國王 and a different number to everybody else', () => {
  for (let n = 2; n <= 16; n++) {
    for (const hostPlays of [true, false]) {
      if (!hostPlays && n < 3) continue;
      const sim = mk(n, { seed: n, patch: { preset: 'king', hostPlays } });
      const names = holderIds(sim).map((id) => sim.state.roles.find((r) => r.id === seatOf(sim, id).roleId).name);
      assert.equal(names.filter((x) => x === '國王').length, 1);
      assert.equal(new Set(names).size, names.length, `n=${n}: numbers are unique`);
      const k = hostPlays ? n : n - 1;
      assert.deepEqual(names.filter((x) => x !== '國王').map((x) => parseInt(x, 10)).sort((a, b) => a - b), Array.from({ length: k - 1 }, (_, i) => i + 1));
    }
  }
  const lines = config.summary(config.defaults(16, { preset: 'king' }), 16);
  assert.ok(lines.length <= 8, `16-player king summary stays short: ${lines.length} lines`);
  assert.ok(lines.join(' ').includes('15 號'));
});

test('custom: killer preset is 1 : 1 : 2 and asks for a moderator only while the host plays', () => {
  const count = (c) => c.roles_killer.map((r) => r.count);
  const p8 = config.defaults(8, { preset: 'killer' });
  assert.deepEqual(count(p8).slice(0, 2), [2, 2]);
  assert.match(config.summary(p8, 8).join('|'), /平民 ×4/);
  assert.ok(config.validate(p8, 8).warnings.some((w) => /主持/.test(w)));
  const m9 = config.defaults(9, { preset: 'killer', hostPlays: false });
  assert.deepEqual(count(m9).slice(0, 2), [2, 2], '9 seats, 8 card holders');
  assert.deepEqual(config.validate(m9, 9).warnings, []);
  assert.deepEqual(count(config.defaults(3, { preset: 'killer' })).slice(0, 2), [1, 1]);
  assert.ok(config.validate(config.defaults(6, { preset: 'werewolf' }), 6).warnings.length === 1);
  assert.deepEqual(config.validate(config.defaults(6, { preset: 'traitor' }), 6).warnings, [], 'the default asks for nothing');
});

test('custom: #20 — anti-streak (off by default) keeps a special card from going to the same seat twice running', () => {
  assert.equal(config.defaults(6).antiStreak, false);
  const kingOf = (sim) => holderIds(sim).find((id) => sim.state.roles.find((r) => r.id === seatOf(sim, id).roleId).name === '國王');
  // on: never the same 國王 (or the same number) twice running, and still no seat bias
  const sim = mk(5, { seed: 3, patch: { preset: 'king', antiStreak: true } });
  const kings = Array(5).fill(0);
  let prev = kingOf(sim);
  let prevCards = clone(sim.state.seats);
  for (let r = 0; r < 1500; r++) {
    changed(sim, 'p1', { type: r % 2 ? 'redeal' : 'next-round' });
    const k = kingOf(sim);
    assert.notEqual(k, prev, `round ${r}: same king twice`);
    for (const id of holderIds(sim)) assert.notEqual(seatOf(sim, id).roleId, prevCards[id].roleId, 'same number twice');
    kings[Number(k.slice(1)) - 1]++;
    prev = k;
    prevCards = clone(sim.state.seats);
  }
  for (const n of kings) assert.ok(n > 230 && n < 370, `king spread ${kings}`);
  // off: repeats happen (plain shuffle)
  const free = mk(5, { seed: 3, patch: { preset: 'king' } });
  let repeats = 0;
  let last = kingOf(free);
  for (let r = 0; r < 300; r++) { changed(free, 'p1', { type: 'next-round' }); if (kingOf(free) === last) repeats++; last = kingOf(free); }
  assert.ok(repeats > 20, `plain shuffle repeats sometimes (${repeats})`);
  // a big group (紅隊 is half the table) is not "special": no forced flip-flop
  const teams = mk(6, { seed: 2, patch: { preset: 'teams', antiStreak: true } });
  let stay = 0;
  for (let r = 0; r < 200; r++) {
    const before = seatOf(teams, 'p2').roleId;
    changed(teams, 'p1', { type: 'next-round' });
    if (seatOf(teams, 'p2').roleId === before) stay++;
  }
  assert.ok(stay > 50 && stay < 150, `teams stay random (${stay}/200)`);
});

test('custom: #20 — anti-streak carries over to the next game through result().carry, by role name', () => {
  const cfg = cfgFor(6, { preset: 'traitor', antiStreak: true });
  let carried = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const g1 = new Sim(game, { n: 6, seed, config: cfg });
    const traitor = holderIds(g1).find((id) => seatOf(g1, id).roleId === g1.state.roles[0].id);
    changed(g1, 'p1', { type: 'end' });
    const carry = g1.result().carry;
    assert.equal(carry.roles[traitor], '內鬼');
    assert.ok(!g1.result().lines.join('').includes('carry'));
    const g2 = new Sim(game, { n: 6, seed: seed + 1000, config: cfg, carry });
    assert.notEqual(seatOf(g2, traitor).roleId, g2.state.roles[0].id, 'the last game\'s 內鬼 is not the 內鬼 again');
    // switched off, or garbage carry: a plain deal
    const off = new Sim(game, { n: 6, seed: seed + 1000, config: { ...cfg, antiStreak: false }, carry });
    if (seatOf(off, traitor).roleId === off.state.roles[0].id) carried++;
    assert.doesNotThrow(() => new Sim(game, { n: 6, seed, config: cfg, carry: { roles: { p1: 5, __proto__: 'x' } } }));
    assert.doesNotThrow(() => new Sim(game, { n: 6, seed, config: cfg, carry: 'nope' }));
  }
  assert.ok(carried > 0, 'without anti-streak the same 內鬼 can come back');
  assert.match(config.summary(cfg, 6).join('|'), /唔會連續攞同一張特別牌/);
});

test('custom: teams preset splits the table evenly (an odd table gives red one more)', () => {
  for (let n = 2; n <= 16; n++) {
    const sim = mk(n, { seed: n + 40, patch: { preset: 'teams' } });
    const red = holderIds(sim).filter((id) => sim.state.roles.find((r) => r.id === seatOf(sim, id).roleId).name === '紅隊').length;
    assert.equal(red, Math.ceil(n / 2));
    assert.equal(n - red, Math.floor(n / 2));
  }
});

// ---------- config ----------

test('custom: config.defaults is valid for every head-count and every preset', () => {
  for (let n = 2; n <= 16; n++) {
    const base = config.defaults(n);
    const v = config.validate(base, n);
    assert.ok(v.ok, `n=${n}: ${v.message}`);
    for (const preset of PRESETS) {
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
  prev.roles_traitor = [
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
  assert.ok(config.validate(config.defaults(4, { preset: 'zzz', diceSides: 7, diceCount: 99, roles_traitor: [1, null] }), 4).ok);
});

test('custom: validate catches every bad setup with a Cantonese message', () => {
  const n = 5;
  const good = config.defaults(n);
  assert.equal(config.validate(good, n).ok, true);
  assert.deepEqual(config.validate(good, n).warnings, []);

  const tooMany = clone(good);
  tooMany.roles_traitor[0].count = 6;
  let v = config.validate(tooMany, n);
  assert.equal(v.ok, false);
  assert.match(v.message, /減少啲/);

  const noFiller = clone(good);
  noFiller.roles_traitor[1].filler = false; noFiller.roles_traitor[1].count = 1;
  v = config.validate(noFiller, n);
  assert.equal(v.ok, false);
  assert.match(v.message, /啱數/);
  noFiller.roles_traitor[1].count = 4;
  assert.equal(config.validate(noFiller, n).ok, true, '1+4 = 5 exactly');

  assert.equal(config.validate({ ...good, diceCount: 0 }, n).ok, false);
  assert.equal(config.validate({ ...good, diceCount: 6 }, n).ok, false);
  assert.equal(config.validate({ ...good, diceCount: 5 }, n).ok, true);
  assert.equal(config.validate({ ...good, diceSides: 7 }, n).ok, false);
  for (const s of [4, 6, 8, 10, 12, 20]) assert.equal(config.validate({ ...good, diceSides: s }, n).ok, true);

  const oneRole = { ...good, roles_traitor: [good.roles_traitor[0]] };
  assert.equal(config.validate(oneRole, n).ok, false);
  assert.equal(config.validate({ ...good, roles_traitor: undefined }, n).ok, false);

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
  c.roles_traitor[1].name = c.roles_traitor[0].name;
  let v = config.validate(c, n);
  assert.equal(v.ok, true);
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0], /同名/);

  const flat = config.defaults(n);
  flat.roles_traitor[0].count = 0;
  v = config.validate(flat, n);
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => /所有人都係/.test(w)));

  // a <select>/<input> hands strings back
  const typed = { ...config.defaults(n), diceCount: '3', diceSides: '8' };
  typed.roles_traitor = typed.roles_traitor.map((r) => ({ ...r, count: String(r.count) }));
  assert.equal(config.validate(typed, n).ok, true);
  const s = new Sim(game, { n, seed: 2, config: typed });
  assert.equal(s.state.dice.count, 3);
  assert.equal(s.state.dice.sides, 8);
});

test('custom: role lists are sanitised (ids, single filler, counts, names)', () => {
  const n = 5;
  const c = config.defaults(n);
  c.roles_traitor = [
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
  assert.deepEqual(keys, ['preset', 'roles_traitor', 'hostPlays', 'diceCount', 'diceSides', 'selfRoll', 'antiStreak']);
  const rolesField = fields.find((f) => f.type === 'roles');
  assert.equal(rolesField.max, n);
  assert.match(rolesField.help, /✓/);
  const preset = fields.find((f) => f.key === 'preset');
  assert.deepEqual(preset.options.map((o) => o.value), PRESETS);
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
  assert.deepEqual(lines, ['🎭 一個內鬼', '🎭 內鬼 ×1', '🙂 好人 ×5', '🎲 1 × d6', '房主一齊玩']);
  const edited = clone(c); edited.roles_traitor[0].name = '鬼';
  assert.equal(config.summary(edited, n)[0], '🎭 一個內鬼（改過）', 'an edited preset says so in the lobby');
  const lines2 = config.summary({ ...cfgFor(n, { hostPlays: false, modSees: true, selfRoll: false, diceCount: 2, diceSides: 10 }) }, n);
  assert.ok(lines2.includes('🎲 2 × d10（淨係主持搖得）'));
  assert.ok(lines2.some((l) => /主持/.test(l) && /睇到所有人角色/.test(l)));
  // an invalid setup still summarises
  const bad = clone(c); bad.roles_traitor[0].count = 9;
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
  for (let s = 1; s <= 30; s++) deals.add(JSON.stringify(Object.values(mk(8, { seed: s, patch: { preset: 'werewolf' } }).state.seats).map((x) => x.roleId)));
  assert.ok(deals.size > 20, 'dealing looks shuffled');
});

test('custom: every seat is equally likely to hold the single 內鬼 (no seat bias)', () => {
  const n = 5;
  const hits = Array(n).fill(0);
  for (let s = 1; s <= 2000; s++) {
    const sim = mk(n, { seed: s });
    const thief = sim.state.roles[0].id;   // 🎭 內鬼 ×1 at n = 5
    holderIds(sim).forEach((id, i) => { if (seatOf(sim, id).roleId === thief) hits[i]++; });
  }
  for (const h of hits) assert.ok(h > 300 && h < 500, `seat bias: ${hits}`);
});

test('custom: setup throws on an invalid config (the room validates first)', () => {
  const bad = config.defaults(5);
  bad.roles_traitor[0].count = 9;
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
  // G1: the room now passes the host's seat — a host who moved off seat 0 still moderates and holds the controls
  const moved = new Sim(game, { n: 5, seed: 1, config: cfg, hostPid: 'p3' });
  assert.equal(moved.state.seats.p3.playing, false);
  assert.equal(moved.view('p3').controller, true);
  assert.equal(moved.view('p1').controller, false);
  unchanged(moved, 'p1', { type: 'roll-all' });
  changed(moved, 'p3', { type: 'roll-all' });
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
  // `label` names the step on a shared phone's gate (§7.1 #33): the walk is for the card AND the dice (#15)
  assert.deepEqual(sim.focus(), { pids: ['p1', 'p2', 'p3', 'p4'], label: '睇牌、搖骰' });
  assert.equal(sim.view('p3').seats[1].seenRole, false);
  changed(sim, 'p2', { type: 'seen' });
  assert.equal(sim.view('p3').seats[1].seenRole, true);
  assert.deepEqual(sim.focus(), { pids: ['p1', 'p3', 'p4'], label: '睇牌、搖骰' });
  assert.equal(mk(4, { patch: { selfRoll: false } }).focus().label, '睇牌', 'only the host rolls: just the card');
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
  assert.match(res.lines[0], /唔計輸贏/);
  assert.match(res.lines[1], /第 2 回合/);
  for (const id of sim.state.order) {
    const seat = seatOf(sim, id);
    const role = sim.state.roles.find((r) => r.id === seat.roleId);
    const line = res.lines.find((l) => l.startsWith(`${seat.name}：`));
    assert.ok(line.includes(role.name), line);
    if (seat.dice) assert.ok(line.includes(`🎲 ${seat.dice.join(' ')}（= ${seat.dice[0] + seat.dice[1]}）`), line);
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

test('custom: #10 — the result says why nobody wins, opens every card and cup, and groups repeated roles', () => {
  const sim = mk(9, { seed: 3, patch: { preset: 'killer', hostPlays: false } });   // 8 card holders: 2 殺手 2 警察 4 平民
  changed(sim, 'p1', { type: 'end' });
  const res = sim.result();
  assert.match(res.lines[0], /app 唔計輸贏，邊個贏由你哋自己講/);
  assert.ok(res.lines.includes('今回合冇人擲過骰。'));
  for (const name of ['殺手', '警察', '平民']) {
    const holders = holderIds(sim).filter((id) => sim.state.roles.find((r) => r.id === seatOf(sim, id).roleId).name === name);
    const line = res.lines.find((l) => l.includes(`${name}（${holders.length} 個）：`));
    assert.ok(line, `grouped line for ${name}`);
    for (const id of holders) assert.ok(line.includes(seatOf(sim, id).name));
  }
  // one-of-a-kind roles are not grouped (the seat lines already say it)
  const king = mk(5, { seed: 1, patch: { preset: 'king' } });
  changed(king, 'p1', { type: 'end' });
  assert.ok(!king.result().lines.some((l) => /個）：/.test(l)));
  for (const l of [...res.lines, ...king.result().lines]) assert.ok(!l.includes('\n'));
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
  const topKeys = ['all', 'can', 'controller', 'dealId', 'dice', 'hint', 'host', 'log', 'me', 'phase', 'revealDice', 'revealRoles', 'roles', 'round', 'seats', 'selfRoll', 'subtitle', 'title'];
  assert.deepEqual(Object.keys(sim.view('p1')).sort(), topKeys);
  assert.deepEqual(Object.keys(sim.view('p2')).sort(), topKeys.filter((k) => k !== 'all'));
  assert.deepEqual(Object.keys(sim.view(null)).sort(), topKeys.filter((k) => k !== 'all'));
  const seatKeys = ['diceLocked', 'id', 'name', 'playing', 'roleLocked', 'rolled', 'rolls', 'seenRole'];
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
  const presets = PRESETS;
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
        antiStreak: seed % 7 === 0,
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

// ---------- U1: the 💡 hint ----------

test('custom: U1 — every view in every phase has a one-line hint that never depends on who holds which card', () => {
  const swapRoles = (state) => {
    const st = clone(state);
    const hs = st.order.filter((id) => st.seats[id].playing);
    const first = st.seats[hs[0]].roleId;
    hs.forEach((id, i) => { st.seats[id].roleId = i + 1 < hs.length ? st.seats[hs[i + 1]].roleId : first; });
    return st;
  };
  const phases = new Set();
  for (const [n, patch] of [[4, {}], [6, { hostPlays: false, modSees: true }], [5, { preset: 'killer', selfRoll: false }], [3, { preset: 'king' }]]) {
    for (let seed = 1; seed <= 5; seed++) {
      const sim = mk(n, { seed, patch });
      const check = (s) => {
        const other = swapRoles(s.state);
        for (const pid of [...s.players.map((p) => p.id), null]) {
          const v = s.view(pid);
          phases.add(v.phase);
          assert.equal(typeof v.hint, 'string');
          assert.ok(v.hint.length > 0 && v.hint.length <= 30 && !v.hint.includes('\n'), `hint: ${v.hint}`);
          assert.equal(engine.view(other, pid).hint, v.hint, 'the hint changed when the cards moved');
          for (const r of s.state.roles) if (r.name.length > 1) assert.ok(!v.hint.includes(r.name), `hint names a role: ${v.hint}`);
        }
      };
      check(sim);
      sim.runRandom({ onStep: check });
    }
  }
  assert.deepEqual([...phases].sort(), ['ended', 'play']);
  // the lines a first-timer needs
  const sim = mk(4, { patch: { hostPlays: false } });
  assert.match(sim.view('p2').hint, /㩒住張牌/);
  assert.match(sim.view('p1').hint, /主持/);
  assert.match(sim.view(null).hint, /睇緊/);
  // 「你嘅角色」 in the 💡 sheet: the shell reads view.me.role, i.e. this seat's own card and its text
  const k = mk(6, { seed: 4, patch: { preset: 'killer', hostPlays: false } });
  for (const p of k.players) {
    const v = k.view(p.id);
    const shownRole = roleFor(v, rules);
    if (!v.me.playing) { assert.equal(shownRole, null, 'the moderator has no card'); continue; }
    const own = k.state.roles.find((r) => r.id === seatOf(k, p.id).roleId);
    assert.equal(shownRole.name, own.name);
    assert.equal(shownRole.text, own.desc);
    assert.ok(roleParts(shownRole.text).win, 'the sheet can show 點贏');
  }
  assert.equal(roleFor(k.view(null), rules), null);
  changed(sim, 'p1', { type: 'end' });
  assert.match(sim.view('p2').hint, /結果/);
});

// ============================================================
// phone UI (ui.js) — a fake DOM, stub components, driven only by "taps"
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
    this.cls = new Set(); this.styleMap = {}; this.hidden = false; this.disabled = false;
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
  click() { for (const fn of this.listeners.click ?? []) fn({ type: 'click' }); }
}
const fakeDocument = { createElement: (t) => new FEl(t), createTextNode: (t) => new FText(t) };
const walkEl = (n, fn) => { fn(n); if (n.children) for (const c of n.children) walkEl(c, fn); };
const findEls = (root, pred) => { const out = []; walkEl(root, (n) => { if (n instanceof FEl && pred(n)) out.push(n); }); return out; };
const serializeEl = (n) => (n instanceof FText ? n.data
  : JSON.stringify([n.tag, [...n.cls].sort(), n.attrs, n.hidden, n.disabled, n.styleMap, n.children.map(serializeEl)]));
const shown = (n) => { for (let x = n; x; x = x.parentNode) if (x.hidden) return false; return true; };
const button = (root, label) => findEls(root, (x) => x.tag === 'button' && x.textContent.startsWith(label))[0];

/** Stub RoleCard / DiceCup / dieFace that remember their last props, so a test can "press" them. */
function stubComponents() {
  const made = { cards: [], cups: [] };
  const E = (tag, cls) => { const n = new FEl(tag); n.className = cls; return n; };
  const RoleCard = (p0) => {
    const root = E('div', 'c-rolecard');
    const api = {
      el: root, props: p0,
      update(p) { api.props = p; root.textContent = p.role ? `${p.role.emoji}${p.role.name}|${p.locked ? 'L' : ''}` : '—'; },
      destroy() { api.dead = true; root.remove(); },
    };
    api.update(p0);
    made.cards.push(api);
    return api;
  };
  const DiceCup = (p0) => {
    const root = E('div', 'c-dicecup');
    const api = {
      el: root, props: p0,
      update(p) { api.props = p; root.textContent = `${p.rollSeq}|${p.canRoll ? 'R' : ''}|${p.lockedRoll ? 'L' : ''}`; },
      destroy() { api.dead = true; root.remove(); },
    };
    api.update(p0);
    made.cups.push(api);
    return api;
  };
  const dieFace = (v) => { const d = E('span', 'die'); d.textContent = String(v); return d; };
  return { made, components: { RoleCard, DiceCup, dieFace } };
}

async function withCustomUi(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node, confirm: globalThis.confirm };
  globalThis.document = fakeDocument;
  globalThis.Node = FNode;
  globalThis.confirm = () => true;
  try {
    return await fn(await import('../js/games/custom/ui.js'));
  } finally {
    for (const k of ['document', 'Node', 'confirm']) {
      if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k];
    }
  }
}

function mountFor(ui, sim, pid, extra = {}) {
  const root = new FEl('div');
  const sent = [];
  const sounds = [];
  const stub = stubComponents();
  const api = {
    me: pid, players: sim.players, isHost: pid === sim.state.hostPid, meta, config: sim.config,
    send: (a) => { sent.push(a); return true; }, ink() {}, now: () => sim.now, sfx: (s) => sounds.push(s), toast() {},
    components: stub.components, ...extra,
  };
  return { pid, root, sent, sounds, stub, handle: ui.mount(root, api) };
}

test('custom ui: every seat and the table render through random games, idempotently, never showing the 💡 hint', async () => {
  await withCustomUi(async (ui) => {
    const cases = [[4, {}], [6, { hostPlays: false, modSees: true }], [5, { preset: 'king', diceCount: 3, diceSides: 20 }], [3, { selfRoll: false, diceCount: 2 }]];
    for (const [n, patch] of cases) {
      for (let seed = 1; seed <= 3; seed++) {
        const sim = mk(n, { seed: seed * 7 + n, patch });
        const phones = [...ids(n), null].map((pid) => mountFor(ui, sim, pid));
        const render = (s) => {
          for (const ph of phones) {
            const v = s.view(ph.pid);
            ph.handle.update(v, { focus: s.focus(), paused: false });
            const a = serializeEl(ph.root);
            ph.handle.update(clone(v), { focus: s.focus(), paused: false });
            assert.equal(serializeEl(ph.root), a, `update() not idempotent for ${ph.pid ?? 'table'}`);
            const text = ph.root.textContent;
            assert.ok(!text.includes(v.hint), `the hint is for the 💡 sheet only: ${v.hint}`);
            const mustTurn = v.phase === 'play' && !v.revealRoles && v.me?.playing && !v.me.seenRole;
            assert.equal(text.includes('輪到你睇牌'), !!mustTurn, `${ph.pid}: turn banner`);
            const hostCtl = button(ph.root, '🎲 全體搖骰');
            assert.equal(shown(hostCtl), v.controller && v.phase === 'play', `${ph.pid}: host controls only on the host seat`);
          }
        };
        render(sim);
        sim.runRandom({ onStep: render });
        for (const ph of phones) ph.handle.destroy();
      }
    }
  });
});

test('custom ui: a view that is not ours is ignored instead of crashing statusLine (stale views from the last game)', async () => {
  await withCustomUi(async (ui) => {
    const sim = mk(4, { seed: 2 });
    const ph = mountFor(ui, sim, 'p2');
    // what the shell can hand us between the `room` and `views` messages, or a broken one
    for (const odd of [undefined, null, 0, 'x', [], {}, { phase: 'night', players: [] }, { phase: 'play', seats: 'p1' }, { seats: null }]) {
      assert.doesNotThrow(() => ph.handle.update(odd, { focus: null }), `update(${JSON.stringify(odd)})`);
    }
    assert.match(ph.root.textContent, /載入緊/);
    assert.equal(ph.stub.made.cards.length, 0, 'nothing drawn from a foreign view');
    ph.handle.update(sim.view('p2'), null);   // a null ctx is fine too
    assert.match(ph.root.textContent, /輪到你睇牌/);
    const before = serializeEl(ph.root);
    ph.handle.update({ phase: 'vote', votes: {}, round: 3 }, {});   // the old game's view again, late
    assert.equal(serializeEl(ph.root), before, 'a late foreign view changes nothing');
    assert.deepEqual(ph.sounds, [], 'and makes no sound');
    // a half-filled view of ours: defaults, no throw
    assert.doesNotThrow(() => ph.handle.update({ phase: 'play', seats: [{ id: 'p1', name: 'A', playing: true }, null, 7] }, {}));
    assert.doesNotThrow(() => ph.handle.update({ seats: [], me: { playing: true }, dice: 'x', roles: 'y', log: 5, can: null }, {}));
    ph.handle.destroy();
    // odd api: players not an array, no sfx, a send that throws
    const odd = mountFor(ui, sim, 'p1', { players: { p1: 1 }, sfx: undefined, send: () => { throw new Error('offline'); } });
    odd.handle.update(sim.view('p1'), {});
    const quiet = console.error;
    console.error = () => {};
    try { assert.doesNotThrow(() => button(odd.root, '🎲 全體搖骰').click()); } finally { console.error = quiet; }
    odd.handle.destroy();
    const { normaliseView } = ui;
    assert.equal(normaliseView({ phase: 'night' }), null);
    const nv = normaliseView({ seats: [{ id: 'p1' }, 'x'] });
    assert.deepEqual([nv.seats.length, nv.roles, nv.log, nv.can, nv.dice, nv.me], [1, [], [], {}, { count: 1, sides: 6 }, null]);
  });
});

test('custom ui: taps send the actions the engine accepts — peek on release, latch, roll, host buttons', async () => {
  await withCustomUi(async (ui) => {
    const sim = mk(4, { seed: 9 });
    const host = mountFor(ui, sim, 'p1');
    const p2 = mountFor(ui, sim, 'p2');
    const sync = () => { host.handle.update(sim.view('p1'), {}); p2.handle.update(sim.view('p2'), {}); };
    const play = (ph) => { while (ph.sent.length) changed(sim, ph.pid, ph.sent.shift()); sync(); };
    sync();
    const card = () => p2.stub.made.cards.at(-1);
    // press = nothing yet; release = seen
    card().props.onOpen(true);
    assert.deepEqual(p2.sent, []);
    card().props.onOpen(false);
    assert.deepEqual(p2.sent, [{ type: 'seen' }]);
    play(p2);
    card().props.onOpen(false);   // a release without a press does nothing
    assert.deepEqual(p2.sent, []);
    // latch, roll, lock the cup
    card().props.onLockToggle();
    play(p2);
    assert.equal(seatOf(sim, 'p2').roleLocked, true);
    p2.stub.made.cups.at(-1).props.onRoll();
    play(p2);
    p2.stub.made.cups.at(-1).props.onLock();
    play(p2);
    assert.equal(seatOf(sim, 'p2').diceLocked, true);
    // the host: per-seat unlock, then every button
    const unlock = findEls(host.root, (x) => x.cls.has('cu-unlock') && !x.hidden);
    assert.equal(unlock.length, 1);
    unlock[0].click();
    assert.deepEqual(host.sent, [{ type: 'unlock-dice', pid: 'p2' }]);
    play(host);
    for (const label of ['🎲 全體搖骰', '👁 開晒啲骰', '🃏 重新派牌', '🔓 開晒角色', '➡️ 下一回合']) {
      button(host.root, label).click();
      assert.equal(host.sent.length, 1, label);
      play(host);
    }
    assert.ok(p2.stub.made.cards.length >= 3, 'a fresh card per deal (redeal + next round)');
    assert.ok(host.sounds.includes('deal') && host.sounds.includes('reveal') && host.sounds.includes('lift'));
    button(host.root, '🏁 結束遊戲').click();
    play(host);
    assert.equal(sim.state.phase, 'ended');
    assert.ok(!shown(button(host.root, '🎲 全體搖骰')), 'no host controls once it is over');
    assert.match(p2.root.textContent, /遊戲完咗/);
  });
});

test('custom ui: #3 — host buttons confirm in the page (api.confirm on the tapped button), never with a native dialog', async () => {
  await withCustomUi(async (ui) => {
    const native = globalThis.confirm;
    globalThis.confirm = () => { throw new Error('a native confirm() froze the host phone'); };
    try {
      const sim = mk(4, { seed: 3 });
      const asked = [];
      const armed = new Set();
      // the shell's arm-then-confirm: the first tap on a button arms it (false), the second goes ahead (true)
      const confirm = (text, node, opts) => {
        asked.push({ text, node, key: opts?.key });
        if (armed.has(node)) { armed.delete(node); return true; }
        armed.add(node);
        return false;
      };
      const host = mountFor(ui, sim, 'p1', { confirm });
      host.handle.update(sim.view('p1'), {});
      for (const [label, type] of [['👁 開晒啲骰', 'reveal-dice'], ['🃏 重新派牌', 'redeal'], ['🔓 開晒角色', 'reveal-roles'], ['🏁 結束遊戲', 'end']]) {
        const b = button(host.root, label);
        b.click();
        assert.deepEqual(host.sent, [], `${label}: the first tap only arms it`);
        assert.equal(asked.at(-1).node, b, `${label}: the confirm sits on the tapped button`);
        assert.ok(asked.at(-1).text.length > 4 && asked.at(-1).key === `custom:${type}`);
        b.click();
        assert.deepEqual(host.sent, [{ type }], `${label}: the second tap sends`);
        host.sent.length = 0;
      }
      // 全體搖骰 only asks when somebody's cup is locked
      button(host.root, '🎲 全體搖骰').click();
      assert.deepEqual(host.sent, [{ type: 'roll-all' }]);
      // an older shell without api.confirm: the action goes ahead, still no native dialog
      const bare = mountFor(ui, sim, 'p1');
      bare.handle.update(sim.view('p1'), {});
      button(bare.root, '🏁 結束遊戲').click();
      assert.deepEqual(bare.sent, [{ type: 'end' }]);
    } finally {
      globalThis.confirm = native;
    }
  });
});

// ---------- one phone in the middle (DESIGN §7.1; one-phone playtest #15, #22, custom C1–C3, C8) ----------

/** A seat (or the table, pid null) on a phone holding `mySeats` (every seat by default: a whole-table phone). */
function mountShared(ui, sim, pid, { mySeats = sim.state.order, extra = {} } = {}) {
  const handed = [];
  const tables = [];
  const ph = mountFor(ui, sim, pid, {
    shared: mySeats.length > 1, wholeTable: mySeats.length === sim.state.order.length, atTable: pid === null && mySeats.length > 1,
    mySeats, handTo: (to, opts) => { handed.push([to, opts]); return true; }, toTable: (opts) => { tables.push(opts ?? {}); return true; },
    ...extra,
  });
  sharedMounts.push(ph);
  return { ...ph, handed, tables };
}
const sharedMounts = [];
/** Destroy every shared-phone screen a test mounted (their one-tap guards hold a 3.5 s timer). */
const destroyShared = () => { for (const ph of sharedMounts.splice(0)) ph.handle.destroy(); };
/** What the shell hands a UI on a shared phone: the focus filtered to this phone's seats. */
const ctxOne = (sim, mySeats = sim.state.order) => {
  const f = sim.focus();
  const pids = (f?.pids ?? []).filter((p) => mySeats.includes(p));
  return { focus: pids.length ? { ...f, pids } : null, paused: false, shared: true };
};

test('custom ui: one phone — re-run #2 F1/F2/F3: 主持掣 from the middle, two taps for 下一回合 / 全體搖骰, the controls folded on the host\'s own walk turn, the 只有主持搖 note', async () => {
  await withCustomUi(async (ui) => {
    const sim = mk(4, { seed: 21 });   // p1 is the host and holds a card
    const show = (ph) => ph.handle.update(sim.view(ph.pid), ctxOne(sim));
    const asks = [];
    let armed = null;
    const confirm = (text, node, opts) => { if (armed === opts?.key) { armed = null; return true; } armed = opts?.key; asks.push(text); return false; };
    const ctlBody = (ph) => findEls(ph.root, (x) => x.cls.has('cu-ctlbody'))[0];
    const toggle = (ph) => findEls(ph.root, (x) => x.cls.has('cu-ctltoggle'))[0];

    // F2: the host's own walk turn — the controls are folded behind one button
    const host = mountShared(ui, sim, 'p1', { extra: { confirm } });
    show(host);
    assert.ok(shown(findEls(host.root, (x) => x.cls.has('c-rolecard'))[0]));
    assert.ok(shown(toggle(host)) && !shown(ctlBody(host)), 'folded while the walk waits for the host');
    toggle(host).click();
    assert.ok(shown(ctlBody(host)), 'one tap opens them');
    toggle(host).click();
    assert.ok(!shown(ctlBody(host)));
    // F3: 只有主持搖 — the host's turn says when to roll for everybody
    const solo = mk(3, { seed: 22, patch: { selfRoll: false } });
    const sh = mountShared(ui, solo, 'p1', { mySeats: solo.state.order });
    sh.handle.update(solo.view('p1'), ctxOne(solo));
    sh.stub.made.cards.at(-1).props.onOpen(true);
    sh.stub.made.cards.at(-1).props.onOpen(false);
    const note = findEls(sh.root, (x) => x.cls.has('cu-done-note'))[0];
    assert.ok(shown(note) && note.textContent.includes('全體搖骰就而家㩒'), note.textContent);
    // after the walk: unfolded; 下一回合 and 全體搖骰 take a second tap on a shared phone
    for (const pid of sim.state.order) changed(sim, pid, { type: 'seen' });
    show(host);
    assert.ok(!shown(toggle(host)) && shown(ctlBody(host)), 'not folded once the host has had his turn');
    button(host.root, '➡️ 下一回合').click();
    assert.deepEqual(host.sent, [], 'the first tap only arms');
    assert.deepEqual(asks, ['下一回合？大家嘅骰會清晒、重新派牌。']);
    button(host.root, '➡️ 下一回合').click();
    assert.deepEqual(host.sent.at(-1), { type: 'next-round' });
    host.sent.length = 0;
    button(host.root, '🎲 全體搖骰').click();
    assert.deepEqual(host.sent, []);
    assert.equal(asks.at(-1), '全體搖骰？大家嘅骰會重新搖。');
    button(host.root, '🎲 全體搖骰').click();
    assert.deepEqual(host.sent, [{ type: 'roll-all' }]);
    // phones of their own: unchanged — one tap each
    const own = mk(4, { seed: 23 });
    const ownHost = mountFor(ui, own, 'p1', { confirm });
    ownHost.handle.update(own.view('p1'), { focus: own.focus(), paused: false });
    button(ownHost.root, '➡️ 下一回合').click();
    button(ownHost.root, '🎲 全體搖骰').click();
    assert.deepEqual(ownHost.sent, [{ type: 'next-round' }, { type: 'roll-all' }]);
    assert.ok(!shown(findEls(ownHost.root, (x) => x.cls.has('cu-ctltoggle'))[0]), 'never folded on a phone of your own');
    ownHost.handle.destroy();

    // F1: the table screen hands the phone to the host for the controls — a public card
    const table = mountShared(ui, sim, null);
    show(table);
    const hb = findEls(table.root, (x) => x.cls.has('cu-tohost'))[0];
    assert.ok(shown(hb) && hb.textContent === '🎛 主持掣 · 交俾 玩家1', hb?.textContent);
    hb.click();
    assert.deepEqual(table.handed, [['p1', { open: true, why: '主持掣' }]]);
    // …private when the host is a moderator who sees every role (the 👁 tags are on that screen)
    const mod = mk(5, { seed: 24, patch: { hostPlays: false, modSees: true } });
    const mt = mountShared(ui, mod, null);
    mt.handle.update(mod.view(null), ctxOne(mod));
    findEls(mt.root, (x) => x.cls.has('cu-tohost'))[0].click();
    assert.deepEqual(mt.handed, [['p1', { open: false, why: '主持掣' }]]);
    // not on a phone that does not hold the host's seat, not on a spectator's phone
    const part = mountShared(ui, sim, null, { mySeats: ['p2', 'p3'] });
    part.handle.update(sim.view(null), ctxOne(sim, ['p2', 'p3']));
    assert.ok(!shown(findEls(part.root, (x) => x.cls.has('cu-tohost'))[0]));
    const spect = mountFor(ui, sim, null);
    spect.handle.update(sim.view(null), { focus: null, paused: false });
    assert.ok(!shown(findEls(spect.root, (x) => x.cls.has('cu-tohost'))[0]));
    spect.handle.destroy();
    destroyShared();
  });
});

test('custom ui: one phone — #15 the walk covers peek, roll and lock: 「✓ 搞掂 · 交俾 X」 after the peek; the last seat hands back to the host', async () => {
  await withCustomUi(async (ui) => {
    const sim = mk(4, { seed: 9 });   // p1 is the host and holds a card
    const show = (ph) => ph.handle.update(sim.view(ph.pid), ctxOne(sim));
    const play = (ph) => { while (ph.sent.length) changed(sim, ph.pid, ph.sent.shift()); show(ph); };
    const done = (ph) => findEls(ph.root, (x) => x.cls.has('cu-done'))[0];
    // the host looks first (the walk starts with the holder): release sends nothing on a shared phone
    const host = mountShared(ui, sim, 'p1');
    show(host);
    assert.ok(!shown(done(host)), 'no 搞掂 before the card was looked at');
    assert.equal(host.stub.made.cards.at(-1).props.onLockToggle, undefined, 'no latch while the walk waits for this seat (a latch counts as looked)');
    host.stub.made.cards.at(-1).props.onOpen(true);
    host.stub.made.cards.at(-1).props.onOpen(false);
    assert.deepEqual(host.sent, [], 'the phone does not move on at the release');
    assert.ok(shown(done(host)) && done(host).textContent === '✓ 搞掂 · 交俾 玩家2', done(host).textContent);
    const note = findEls(host.root, (x) => x.cls.has('cu-done-note'))[0];
    assert.ok(shown(note) && note.textContent === '要搖骰就而家搖、鎖埋先交');
    assert.ok(findEls(host.root, (x) => x.cls.has('cu-status'))[0].textContent.includes('搞掂㩒下面「✓ 搞掂」'), 'the banner says what comes next');
    // roll and lock in the same turn, then hand on
    host.stub.made.cups.at(-1).props.onRoll();
    play(host);
    host.stub.made.cups.at(-1).props.onLock();
    play(host);
    assert.equal(seatOf(sim, 'p1').diceLocked, true);
    assert.ok(shown(done(host)), 'still there after rolling');
    done(host).click();
    assert.deepEqual(host.sent, [{ type: 'seen' }]);
    assert.deepEqual(host.handed, [], 'the walk itself hands the phone to the next seat (with its 搞掂 k/n on the gate)');
    play(host);
    assert.ok(!shown(done(host)), 'done: gone');
    // the middle seats: 交俾 the next one round the table
    for (const [pid, next] of [['p2', '玩家3'], ['p3', '玩家4']]) {
      const ph = mountShared(ui, sim, pid);
      show(ph);
      ph.stub.made.cards.at(-1).props.onOpen(true);
      ph.stub.made.cards.at(-1).props.onOpen(false);
      assert.equal(done(ph).textContent, `✓ 搞掂 · 交俾 ${next}`);
      done(ph).click();
      play(ph);
      assert.deepEqual(ph.handed, []);
    }
    // the last seat: back to the host, whose seat has the controls
    const last = mountShared(ui, sim, 'p4');
    show(last);
    last.stub.made.cards.at(-1).props.onOpen(true);
    last.stub.made.cards.at(-1).props.onOpen(false);
    assert.equal(done(last).textContent, '✓ 搞掂 · 交返俾房主 玩家1');
    done(last).click();
    assert.equal(done(last).disabled, true, 'one tap only');
    done(last).click();   // a double tap hands the phone over once
    assert.deepEqual(last.sent, [{ type: 'seen' }]);
    assert.deepEqual(last.handed, [['p1', { open: true, why: '大家睇完牌' }]], 're-run #2 F1: a public card — nothing secret is face up there');
    play(last);
    assert.equal(sim.focus(), null, 'everybody has looked');
    // a fresh deal comes up face down: the button waits for a new look
    changed(sim, 'p1', { type: 'next-round' });
    show(host);
    assert.ok(!shown(done(host)));
    // the host is the last one: the phone goes to the middle (the shell's table card), nobody to hand it to
    for (const pid of ['p2', 'p3', 'p4']) changed(sim, pid, { type: 'seen' });
    show(host);
    host.stub.made.cards.at(-1).props.onOpen(true);
    host.stub.made.cards.at(-1).props.onOpen(false);
    assert.equal(done(host).textContent, '✓ 搞掂 · 擺返中間');
    host.sent.length = 0;
    done(host).click();
    assert.deepEqual(host.sent, [{ type: 'seen' }]);
    assert.deepEqual(host.handed, []);
    // a phone shared by two seats in a room of phones: the last seat here puts it in the middle (the host is elsewhere)
    const sim2 = mk(4, { seed: 2 });
    const pair = ['p3', 'p4'];
    changed(sim2, 'p3', { type: 'seen' });
    const p4 = mountShared(ui, sim2, 'p4', { mySeats: pair });
    p4.handle.update(sim2.view('p4'), ctxOne(sim2, pair));
    p4.stub.made.cards.at(-1).props.onOpen(true);
    p4.stub.made.cards.at(-1).props.onOpen(false);
    assert.equal(findEls(p4.root, (x) => x.cls.has('cu-done'))[0].textContent, '✓ 搞掂 · 擺返中間');
    // only the host rolls: no dice line under the button
    const sim3 = mk(3, { seed: 4, patch: { selfRoll: false } });
    const s3 = mountShared(ui, sim3, 'p2');
    s3.handle.update(sim3.view('p2'), ctxOne(sim3));
    s3.stub.made.cards.at(-1).props.onOpen(true);
    s3.stub.made.cards.at(-1).props.onOpen(false);
    const note3 = findEls(s3.root, (x) => x.cls.has('cu-done-note'))[0];
    assert.ok(!shown(note3) || !note3.textContent, 'no dice line under the button');
    const status3 = findEls(s3.root, (x) => x.cls.has('cu-status'))[0].textContent;
    assert.ok(!status3.includes('要搖骰') && status3.includes('✓ 搞掂'), status3);
    destroyShared();
  });
});

test('custom ui: one phone — #22 the table screen holds nobody\'s card or cup; 開盅 / 開角色 send the phone to the middle; never 「你」', async () => {
  await withCustomUi(async (ui) => {
    const sim = mk(4, { seed: 9 });
    for (const pid of ['p1', 'p2', 'p3', 'p4']) changed(sim, pid, { type: 'seen' });
    for (const pid of ['p1', 'p2', 'p3']) changed(sim, pid, { type: 'roll' });
    const table = mountShared(ui, sim, null);
    table.handle.update(sim.view(null), ctxOne(sim));
    assert.equal(table.stub.made.cards.length + table.stub.made.cups.length, 0, 'no card, no cup in the middle');
    assert.ok(table.root.textContent.includes('部機喺枱中間'), table.root.textContent);
    assert.ok(!table.root.textContent.includes('下一局先加入到'), 'the table is not a spectator');
    assert.ok(!shown(button(table.root, '🎲 全體搖骰')), 'host controls stay on the host\'s seat');
    // the host opens the dice on a shared phone → the phone goes to the middle (the table card), not the host's seat face up
    const confirm = () => true;
    const host = mountShared(ui, sim, 'p1', { extra: { confirm } });
    host.handle.update(sim.view('p1'), ctxOne(sim));
    button(host.root, '👁 開晒啲骰').click();
    assert.deepEqual(host.sent, [{ type: 'reveal-dice' }]);
    assert.deepEqual(host.tables, [{}], 'api.toTable(): the public 擺返中間 card');
    changed(sim, 'p1', host.sent.shift());
    table.handle.update(sim.view(null), ctxOne(sim));
    assert.ok(table.root.textContent.includes('開盅'), 'the 開盅 list is on the table screen');
    for (const pid of ['p1', 'p2', 'p3']) assert.ok(table.root.textContent.includes(String(sim.state.seats[pid].dice[0])));
    host.handle.update(sim.view('p1'), ctxOne(sim));
    button(host.root, '🔓 開晒角色').click();
    assert.equal(host.tables.length, 2, '開角色 too');
    button(host.root, '🃏 重新派牌').click();
    assert.equal(host.tables.length, 2, 'a re-deal is no reveal');
    // #20: no 「（你）」 on any screen of a shared phone
    for (const pid of ['p1', 'p2', null]) {
      const ph = mountShared(ui, sim, pid);
      ph.handle.update(sim.view(pid), ctxOne(sim));
      assert.ok(!ph.root.textContent.includes('（你）'), `${pid ?? 'table'}`);
      assert.equal(findEls(ph.root, (x) => x.cls.has('cu-row') && x.cls.has('me')).length, 0);
    }
    // phones of their own: unchanged — the release sends seen, the host's reveal stays on its own phone, 「（你）」
    const own = mk(4, { seed: 9 });
    const p2 = mountFor(ui, own, 'p2');
    p2.handle.update(own.view('p2'), { focus: own.focus() });
    assert.ok(p2.root.textContent.includes('玩家2（你）'));
    p2.stub.made.cards.at(-1).props.onOpen(true);
    p2.stub.made.cards.at(-1).props.onOpen(false);
    assert.deepEqual(p2.sent, [{ type: 'seen' }]);
    assert.equal(findEls(p2.root, (x) => x.cls.has('cu-done') && shown(x)).length, 0);
    let toTable = 0;
    const ownHost = mountFor(ui, own, 'p1', { confirm, toTable: () => { toTable++; return false; } });
    changed(own, 'p1', { type: 'roll' });
    ownHost.handle.update(own.view('p1'), { focus: own.focus() });
    button(ownHost.root, '👁 開晒啲骰').click();
    assert.equal(toTable, 0, 'a phone of your own stays where it is');
    destroyShared();
    for (const ph of [p2, ownHost]) ph.handle.destroy();
  });
});

test('custom: re-run #2 F4/F5 — the recap is headed 「今局嘅牌同骰」; two holders with two different cards get a warning', () => {
  const sim = mk(3, { seed: 4 });
  sim.act(sim.state.hostPid ?? 'p1', { type: 'end' });
  assert.equal(sim.result().linesTitle, '今局嘅牌同骰', 'not 「點解會咁」 for a game that judges nothing');
  const warn = (c, n) => config.validate(c, n).warnings.some((w) => w.includes('睇完自己張牌就知對方係咩'));
  assert.ok(warn(config.defaults(2), 2), '2 players, 內鬼 + 好人');
  assert.ok(warn(config.defaults(3, { preset: 'traitor', hostPlays: false }), 3), 'a moderator and 2 holders');
  assert.ok(config.validate(config.defaults(2), 2).ok, 'a warning, never a refusal');
  assert.ok(!warn(config.defaults(3), 3), '3 holders: your card says nothing for sure');
  const same = { ...config.defaults(2), preset: 'custom', roles_custom: [
    { name: '好人', emoji: '🙂', filler: true, count: 0, desc: '' }, { name: '內鬼', emoji: '🎭', count: 0, desc: '' }] };
  assert.ok(!warn(same, 2), 'both cards the same: nothing to tell');
});

test('custom: result() says the app keeps no score (noScore), so the shell can say 「邊個贏由你哋講」', () => {
  const sim = mk(4, { seed: 2 });
  assert.equal(sim.result(), null);
  sim.act(sim.state.hostPid ?? 'p1', { type: 'end' });
  const res = sim.result();
  assert.ok(res, 'ended');
  assert.equal(res.noScore, true);
  assert.deepEqual(res.winners, []);
  assert.equal(res.points, undefined, 'no points either');
});

test('custom ui: U1 — long-pressing a role name on the roster explains it; a tap or a scroll does not', async () => {
  await withCustomUi(async (ui) => {
    const sim = mk(5, { seed: 6, patch: { preset: 'killer', hostPlays: false, modSees: true } });
    const toasts = [];
    const ph = mountFor(ui, sim, 'p1', { toast: (t) => toasts.push(t) });   // the moderator sees 👁 tags
    ph.handle.update(sim.view('p1'), {});
    const fire = (node, type, x = 0, y = 0) => { for (const fn of node.listeners[type] ?? []) fn({ type, clientX: x, clientY: y }); };
    const tag = findEls(ph.root, (x) => x.cls.has('cu-tag') && x.cls.has('peek'))[0];
    assert.ok(tag, 'a role tag on the moderator roster');
    const role = sim.state.roles.find((r) => tag.textContent.includes(r.name));
    assert.equal(tag.attrs.title, `${role.emoji} ${role.name}：${role.desc}`);
    fire(tag, 'pointerdown'); fire(tag, 'pointerup');                         // a tap
    fire(tag, 'pointerdown', 0, 0); fire(tag, 'pointermove', 0, 40);          // a scroll
    fire(tag, 'pointerdown', 0, 0); fire(tag, 'pointermove', 2, 3);           // a resting finger jitters
    await new Promise((r) => setTimeout(r, 520));
    assert.deepEqual(toasts, [tag.attrs.title], 'only the held press explains');
    ph.handle.destroy();
  });
});

test('custom: the roster counts this round\'s rolls (🎲 已搖 ×3), so rolling until a number fits shows before a lock', () => {
  const sim = mk(4, { seed: 3 });
  const rollsOf = (pid) => sim.view('p3').seats.find((s) => s.id === pid).rolls;
  assert.equal(rollsOf('p2'), 0);
  for (let i = 1; i <= 3; i++) changed(sim, 'p2', { type: 'roll' });
  assert.equal(rollsOf('p2'), 3, 'public: everybody sees the count (the log says each roll anyway)');
  assert.equal(sim.view(null).seats.find((s) => s.id === 'p2').rolls, 3);
  changed(sim, 'p2', { type: 'lock-dice' });
  assert.equal(rollsOf('p2'), 3, 'the lock keeps the count');
  changed(sim, 'p1', { type: 'unlock-dice', pid: 'p2' });
  changed(sim, 'p2', { type: 'roll' });
  assert.equal(rollsOf('p2'), 4, 'a roll after an unlock counts too');
  changed(sim, 'p1', { type: 'redeal' });
  assert.equal(rollsOf('p2'), 4, 'a re-deal leaves the dice and the count');
  changed(sim, 'p1', { type: 'roll-all' });
  for (const pid of ['p1', 'p2', 'p3', 'p4']) assert.equal(rollsOf(pid), 1, 'the host rolled for everybody: a fresh start');
  changed(sim, 'p1', { type: 'next-round' });
  for (const pid of ['p1', 'p2', 'p3', 'p4']) assert.equal(rollsOf(pid), 0, 'a new round starts from nothing');
  assert.equal(sim.view('p3').seats[1].rolled, false);
  checkLeaks(sim);
});

test('custom ui: 已搖 ×N, the 開盅 status line, the locked-cup badge and the showdown under the cup', async () => {
  await withCustomUi(async (ui) => {
    const sim = mk(4, { seed: 9 });
    const host = mountFor(ui, sim, 'p1');
    const p2 = mountFor(ui, sim, 'p2');
    const p3 = mountFor(ui, sim, 'p3');
    const sync = () => { for (const ph of [host, p2, p3]) ph.handle.update(sim.view(ph.pid), {}); };
    sync();
    for (const pid of ['p2', 'p3']) changed(sim, pid, { type: 'seen' });
    changed(sim, 'p2', { type: 'roll' });
    changed(sim, 'p2', { type: 'roll' });
    changed(sim, 'p2', { type: 'roll' });
    changed(sim, 'p3', { type: 'roll' });
    sync();
    const tagsOf = (ph, pid) => findEls(ph.root, (x) => x.cls.has('cu-row'))[sim.state.order.indexOf(pid)].textContent;
    assert.ok(tagsOf(p3, 'p2').includes('🎲 已搖 ×3'), tagsOf(p3, 'p2'));
    assert.ok(tagsOf(p3, 'p3').includes('🎲 已搖') && !tagsOf(p3, 'p3').includes('×'), 'one roll: no count');
    // a locked cup: no roll / lock buttons on the cup, a badge says why
    changed(sim, 'p2', { type: 'lock-dice' });
    sync();
    const cup = p2.stub.made.cups.at(-1).props;
    assert.equal(cup.lockedRoll, true);
    assert.equal(cup.canRoll, false, 'no greyed-out roll button');
    assert.equal(cup.onLock, undefined, 'no greyed-out lock button');
    const badge = findEls(p2.root, (x) => x.cls.has('cu-badge'))[0];
    assert.ok(badge && shown(badge) && badge.textContent.includes('鎖定咗點數') && badge.textContent.includes('主持'));
    const free = findEls(p3.root, (x) => x.cls.has('cu-badge'))[0];
    assert.ok(!shown(free), 'an unlocked cup has no badge');
    assert.equal(p3.stub.made.cups.at(-1).props.canRoll, true);
    assert.equal(typeof p3.stub.made.cups.at(-1).props.onLock, 'function');
    // the host opens the dice: a status line says so, and 開盅 sits right under the cup (above the role card)
    changed(sim, 'p1', { type: 'reveal-dice' });
    sync();
    const status = findEls(p3.root, (x) => x.cls.has('cu-status'))[0];
    assert.ok(status.textContent.includes('開咗盅'), status.textContent);
    const cards = findEls(p3.root, (x) => x.cls.has('cu-card') && shown(x)).map((x) => x.textContent);
    const at = (s) => cards.findIndex((t) => t.includes(s));
    assert.ok(at('骰盅') < at('開盅 🎲') && at('開盅 🎲') < at('我嘅角色牌'), 'cup → 開盅 → role card');
    assert.ok(!shown(badge), 'the badge goes once the dice are open');
    for (const ph of [host, p2, p3]) ph.handle.destroy();
  });
});

test('custom: the rules call the dice lock by the button\'s name (鎖定點數)', () => {
  const text = rules.sections.map((s) => s.body).join('\n');
  assert.ok(text.includes('㩒「鎖定點數」'));
  assert.ok(!text.includes('鎖定骰盅'));
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

test('custom, one phone through the real play screen: one hand-over per seat covers card and dice (#15), the last hands back to the host, the middle shows nobody\'s card (#22)', async () => {
  await withShell(async (dom) => {
    const { mount } = await import('../js/games/custom/ui.js?v=1');
    const sim = mk(3, { seed: 5 });   // p1 is the host and holds a card
    const ph = await onePhoneShell(dom, sim, mount);
    const name = (pid) => sim.players.find((p) => p.id === pid).name;
    const doneBtn = () => ph.find((n) => n.cls.has('cu-done'))[0];
    assert.equal(ph.st.activeSeat, null, 'the phone starts in the middle');
    for (const [i, pid] of ['p1', 'p2', 'p3'].entries()) {
      assert.equal(ph.gate(), 'private', `${pid}: the private gate`);
      const g = ph.gateText();
      assert.ok(g.includes(`交俾 ${name(pid)}`) && g.includes('睇牌、搖骰') && g.includes(`搞掂 ${i}/3`), g);
      await ph.tapGate();
      assert.equal(ph.st.activeSeat, pid);
      const before = ph.acts.length;
      assert.ok(!doneBtn() || !shShown(doneBtn()), 'no 搞掂 before the look');
      const card = ph.find((n) => n.cls.has('c-rolecard'))[0];
      shPeek(shFind(card, (n) => n.cls.has('c-cover'))[0]);
      assert.equal(ph.acts.length, before, 'the release does not hand the phone on');
      assert.equal(ph.gate(), null, 'still this seat\'s phone: time to roll');
      // roll in the same turn
      await ph.tapIn((n) => n.textContent.includes('🎲 搖我嘅骰'));
      assert.deepEqual(ph.acts.at(-1), { pid, action: { type: 'roll' } });
      assert.ok(sim.state.seats[pid].dice, 'rolled');
      assert.equal(ph.st.activeSeat, pid, 'a roll keeps the phone here');
      const want = pid === 'p3' ? `✓ 搞掂 · 交返俾房主 ${name('p1')}` : `✓ 搞掂 · 交俾 ${name(`p${i + 2}`)}`;
      assert.equal(doneBtn().textContent, want);
      await ph.tapIn((n) => n.cls.has('cu-done'));
      assert.deepEqual(ph.acts.at(-1), { pid, action: { type: 'seen' } });
    }
    // the walk is over: back to the host (a public card naming them, re-run #2 F1), whose seat has the controls
    assert.equal(ph.gate(), 'public');
    assert.ok(ph.gateText().includes(name('p1')) && !ph.gateText().includes('其他人唔好望'), ph.gateText());
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, 'p1');
    assert.ok(ph.text().includes('主持控制') && ph.text().includes('大家都睇咗牌'), ph.text());
    assert.ok(!ph.text().includes('（你）'), 'a shared phone never says 你');
    // 📱 擺返中間: the table screen — nobody's card, cup or controls
    shTap(ph.home());
    await ph.render();
    assert.equal(ph.gate(), 'table');
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, null);
    assert.equal(ph.find((n) => n.cls.has('c-rolecard') || n.cls.has('c-dicecup')).filter(shShown).length, 0);
    assert.ok(ph.text().includes('部機喺枱中間') && !ph.text().includes('主持控制'), ph.text());
    // re-run #2 F1: the controls are one tap from the middle — 「🎛 主持掣 · 交俾 玩家1」, a public card, the host's screen
    await ph.tapIn((n) => n.cls.has('cu-tohost'));
    assert.equal(ph.gate(), 'public');
    assert.ok(ph.gateText().includes(name('p1')), ph.gateText());
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, 'p1');
    assert.ok(ph.text().includes('主持控制'), ph.text());
    ph.destroy();
  });
});
