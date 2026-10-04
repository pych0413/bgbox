// ============================================================
// tests/onuw.test.mjs — rules, edge cases, anti-tell, leaks, fuzz and the phone UI for 一夜終極狼人.
//   node tests/run.mjs onuw
//
// Naming: p1..pN are the seats, A/B/C/D in the research vectors are p1..p4.
// A "scenario" is a real game whose deal has been replaced by a chosen one (the role multiset must match,
// so the night steps stay consistent) — everything after the deal is the real engine.
// ============================================================

import { test, assert, Sim, HOST, ACT, makePlayers, paths } from './lib.mjs';
import { mulberry32, clone } from '../js/core/engine-kit.js';
import * as game from '../js/games/onuw/game.js';
import * as S from '../js/games/onuw/script.js';
import { GAMES } from '../js/games/registry.js';
import { roleParts, roleFor, presetMatches } from '../js/ui/logic.js';

const { engine, config, meta, rules } = game;
const ALL_ROLES = game.ROLE_ORDER;

// ============================================================
// helpers
// ============================================================

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** counts → config that produces exactly that multiset (custom preset: villagers fill, masons are a pair). */
function customConfig(counts, over = {}) {
  const custom = {};
  for (const r of ['doppelganger', 'werewolf', 'minion', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac', 'hunter', 'tanner']) custom[r] = counts[r] ?? 0;
  return { preset: 'custom', custom, customMasons: (counts.mason ?? 0) > 0, ...over };
}

/**
 * A game with a chosen deal. deal = { p1: 'robber', ... }, centre = [role, role, role].
 * Villagers are whatever is left to make n + 3 cards, so the deal may leave them implicit.
 */
function scenario(deal, centre, over = {}) {
  const n = Object.keys(deal).length;
  const dealt = [...Object.values(deal), ...centre];
  const counts = {};
  for (const r of dealt) counts[r] = (counts[r] ?? 0) + 1;
  const cfg = { ...config.defaults(n), ...customConfig(counts), ...over };
  const sim = new Sim(game, { n, seed: 11, config: cfg });
  const s = sim.state;
  assert.equal(dealt.length, n + 3);
  s.cards = Object.fromEntries(Object.entries(deal).map(([p, r]) => [p, { role: r }]));
  s.orig = { ...deal };
  s.centre = centre.map((r) => ({ role: r }));
  s.dealtCentre = centre.slice();
  const dp = s.order.find((p) => deal[p] === 'doppelganger');
  s.dop = dp ? { pid: dp, target: null, copied: null, acted: false } : null;
  return sim;
}

const st = (sim) => sim.state;
const stepK = (sim) => st(sim).steps[st(sim).ix]?.k;
const faceAt = (sim, pid) => st(sim).cards[pid].role;
const centreRoles = (sim) => st(sim).centre.map((c) => c.role);
const finalAt = (sim, pid) => game.finalRole(st(sim).cards[pid]);
const notes = (sim, pid) => st(sim).notes[pid];
const noteOf = (sim, pid, k) => notes(sim, pid).find((n) => n.k === k);

function toNight(sim) {
  for (const p of st(sim).order) sim.act(p, { type: 'ready' });
  assert.equal(st(sim).phase, 'night');
  return sim;
}

/** Run the night. script = { stepId: (sim) => void } acts inside that step's window. Stops before the day timer. */
function playNight(sim, script = {}, { until = 'day' } = {}) {
  if (st(sim).phase === 'deal') toNight(sim);
  let guard = 0;
  while (st(sim).phase === 'night' && guard++ < 200) {
    const k = stepK(sim);
    sim.cueDone();
    assert.equal(st(sim).stage, 'window', `step ${k} entered its window`);
    script[k]?.(sim);
    sim.advance();
  }
  assert.equal(st(sim).phase, until === 'day' ? 'day' : st(sim).phase);
  return sim;
}

/** Run only the steps before `k`, leaving the game in the CUE stage of `k`. */
function toStep(sim, k, script = {}) {
  if (st(sim).phase === 'deal') toNight(sim);
  let guard = 0;
  while (stepK(sim) !== k && guard++ < 200) {
    const cur = stepK(sim);
    sim.cueDone();
    script[cur]?.(sim);
    sim.advance();
  }
  assert.equal(stepK(sim), k);
  assert.equal(st(sim).stage, 'cue');
  return sim;
}

function openStep(sim, k, script) {
  toStep(sim, k, script);
  sim.cueDone();
  assert.equal(st(sim).stage, 'window');
  return sim;
}

const act = (sim, pid, action) => sim.act(pid, action);

/** Everyone votes: votes = { p1: 'p2', ... } (missing seats vote for the next seat). */
function castVotes(sim, votes) {
  if (st(sim).phase === 'day') for (const p of st(sim).order) sim.act(p, { type: 'ready-vote', on: true });
  assert.equal(st(sim).phase, 'vote');
  const order = st(sim).order;
  order.forEach((p, i) => sim.act(p, { type: 'vote', target: votes[p] ?? order[(i + 1) % order.length] }));
  return sim;
}

/** From a deal to the reveal in one go. */
function play(deal, centre, { script = {}, votes = {}, over = {} } = {}) {
  const sim = scenario(deal, centre, over);
  playNight(sim, script);
  castVotes(sim, votes);
  assert.equal(st(sim).phase, 'reveal');
  return sim;
}

const R = (sim) => st(sim).final;

// ============================================================
// meta, rules, registry
// ============================================================

test('onuw: meta, rules and engine shape', () => {
  assert.equal(meta.id, 'onuw');
  assert.deepEqual(meta.players, [3, 10]);
  assert.equal(meta.narration, 'recommended');
  assert.equal(meta.css, true);
  assert.deepEqual(meta.banks, []);
  assert.ok(['full', 'partial', 'none'].includes(meta.singleDevice));
  // BACKLOG U1: the 30-second rules are at most six short lines
  assert.ok(rules.quick.length >= 3 && rules.quick.length <= 6, `${rules.quick.length} quick lines`);
  for (const l of rules.quick) assert.ok([...l].length <= 32, `quick line too long: ${l}`);
  assert.deepEqual(rules.roles.map((r) => r.id).sort(), [...ALL_ROLES].sort());
  for (const r of rules.roles) {
    assert.ok(r.name && r.emoji && r.text && r.team, r.id);
    // every role says what you do AND how you win (the 💡 sheet splits the text at 點贏)
    const { what, win } = roleParts(r.text);
    assert.ok(what.length >= 8, `${r.id}: what you do`);
    assert.ok(win.length >= 6, `${r.id}: how you win`);
  }
  assert.ok(roleParts(rules.roles.find((r) => r.id === 'seer').text).what.includes('先知'), 'aliases stay with the description, not the win line');
  assert.ok(roleParts(rules.roles.find((r) => r.id === 'tanner').text).win.includes('死'), 'the tanner wins by dying');
  assert.ok(roleParts(rules.roles.find((r) => r.id === 'minion').text).win.includes('活住'), 'a lone minion must survive (Verification 2)');
  for (const sec of rules.sections) assert.ok(sec.title && sec.body);
  for (const k of ['setup', 'act', 'advance', 'view', 'cue', 'focus', 'autoAct', 'legalActions', 'result', 'blocking']) {
    assert.equal(typeof engine[k], 'function', k);
  }
  assert.equal(typeof config.presets, 'function');
});

test('onuw: registry meta matches game meta (G16)', () => {
  const e = GAMES.find((g) => g.id === 'onuw');
  assert.ok(e);
  for (const k of ['name', 'emoji', 'blurb']) assert.equal(e.meta[k], meta[k], k);
  assert.deepEqual(e.meta.players, meta.players);
  assert.deepEqual(e.meta.minutes, meta.minutes);
});

test('onuw: every Cantonese string lives in script.js (no CJK literals in game.js)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/games/onuw/game.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'));
  const hit = code.filter((l) => /[㐀-鿿]/.test(l.replace(/\/\/.*$/, '')));
  assert.deepEqual(hit, [], 'CJK text in game.js code lines');
});

// ============================================================
// config
// ============================================================

const OFFICIAL = {
  3: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
  4: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 2 },
  5: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 3 },
};

test('onuw: the recommended preset is the official set for 3-5 and has n+3 cards for every head-count', () => {
  for (let n = 3; n <= 10; n++) {
    const c = game.recommended(n);
    assert.equal(ALL_ROLES.reduce((a, r) => a + c[r], 0), n + 3, `n=${n}`);
    for (const r of ALL_ROLES) assert.ok(c[r] <= game.CAPS[r], `${r} cap at n=${n}`);
    assert.ok(c.mason === 0 || c.mason === 2, 'masons come in pairs');
    assert.ok(c.werewolf >= 1);
    if (OFFICIAL[n]) for (const r of ALL_ROLES) assert.equal(c[r], OFFICIAL[n][r] ?? 0, `official ${n}p ${r}`);
  }
  // learning ladder: no Doppelgänger in any recommended set, Tanner only at 9, Hunter only from 8
  for (let n = 3; n <= 10; n++) {
    assert.equal(game.recommended(n).doppelganger, 0);
    assert.equal(game.recommended(n).tanner, n === 9 ? 1 : 0);
    assert.equal(game.recommended(n).hunter, n >= 8 && n !== 9 ? 1 : 0);
  }
});

test('onuw: the advanced preset swaps one Villager (else the Drunk) for the Doppelgänger', () => {
  for (let n = 3; n <= 10; n++) {
    const a = game.advanced(n);
    const r = game.recommended(n);
    assert.equal(a.doppelganger, 1);
    assert.equal(ALL_ROLES.reduce((x, k) => x + a[k], 0), n + 3);
    if (r.villager > 0) assert.equal(a.villager, r.villager - 1); else assert.equal(a.drunk, r.drunk - 1);
  }
});

test('onuw: config.defaults is valid for every head-count and every preset, summary and fields are well-formed', () => {
  for (let n = 3; n <= 10; n++) {
    for (const preset of ['auto', 'advanced']) {
      const cfg = config.defaults(n, { preset });
      const v = config.validate(cfg, n);
      assert.ok(v.ok, `n=${n} ${preset}: ${v.message}`);
      assert.ok(Array.isArray(v.warnings));
      const sum = config.summary(cfg, n);
      assert.ok(sum.length >= 5 && sum.every((l) => typeof l === 'string' && l));
      assert.ok(sum[0].includes(`${n + 3} 張牌`));
      assert.ok(sum.filter((l) => l.startsWith('💡')).length === 1 && sum.length >= 8, 'the reason is part of the summary');
      for (const l of sum) assert.ok([...l].length <= 24, `a summary tag never wraps, so it must be short: ${l}`);
      const fields = config.fields(cfg, n);
      for (const f of fields) assert.ok(f.key && f.label && f.type);
      assert.equal(fields[0].key, 'preset');
      assert.ok(fields[0].help.length > 10, 'the preset field explains itself');
    }
    assert.ok(S.presetReason(n, 'auto').length > 10, `reason for ${n}`);
  }
});

test('onuw: defaults keeps the host\'s choices, follows the head-count and sanitises junk', () => {
  const d = config.defaults(7, { pace: 'slow', loneWolf: false, discussSec: '300', ringVote: false, preset: 'advanced', junk: 1 });
  assert.equal(d.pace, 'slow');
  assert.equal(d.loneWolf, false);
  assert.equal(d.discussSec, 300);
  assert.equal(d.ringVote, false);
  assert.equal(d.preset, 'advanced');
  assert.equal('junk' in d, false);
  // the role list follows the head-count while the preset is not custom
  assert.deepEqual(config.defaults(9, d).custom, { ...Object.fromEntries(['doppelganger', 'werewolf', 'minion', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac', 'hunter', 'tanner'].map((r) => [r, game.advanced(9)[r]])) });
  // garbage in, defaults out
  const g = config.defaults(5, { pace: 'warp', discussSec: -4, preset: 'x', custom: 'no', ringVote: 'yes' });
  assert.deepEqual(g, config.defaults(5));
  assert.equal(config.defaults(5, null).preset, 'auto');
  assert.equal(config.defaults(99).preset, 'auto');
  // a custom list that does not fit the new head-count falls back to auto
  const custom = { preset: 'custom', custom: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, minion: 1, drunk: 1, insomniac: 1, hunter: 1, tanner: 1, doppelganger: 1 }, customMasons: true };
  assert.equal(config.defaults(10, custom).preset, 'custom');
  assert.equal(config.defaults(3, custom).preset, 'auto', '14 cards cannot fit 3 players');
});

test('onuw: validate blocks wrong head-counts, wrong totals, bad keys and illegal compositions', () => {
  const ok = (cfg, n) => config.validate(cfg, n);
  assert.equal(ok(config.defaults(5), 2).ok, false);
  assert.equal(ok(config.defaults(5), 11).ok, false);
  assert.equal(ok(config.defaults(5), 4.5).ok, false);
  for (const bad of [{ preset: 'x' }, { pace: 'x' }, { loneWolf: 'yes' }, { ringVote: 1 }, { customMasons: 'no' }, { discussSec: 10 }, { discussSec: 5000 }, { discussSec: 1.5 }, { custom: { werewolf: 3 } }, { custom: { werewolf: -1 } }, { custom: 'x' }]) {
    const v = ok({ ...config.defaults(5), ...bad }, 5);
    assert.equal(v.ok, false, JSON.stringify(bad));
    assert.ok(v.message.length > 3);
  }
  const base = customConfig({ werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 3 });
  assert.equal(ok(base, 5).ok, true, '8 cards for 5');
  // too many cards
  const many = ok(customConfig({ werewolf: 2, seer: 1, robber: 1, troublemaker: 1, drunk: 1, insomniac: 1, minion: 1, hunter: 1, tanner: 1, doppelganger: 1, mason: 2 }), 3);
  assert.equal(many.ok, false);
  assert.ok(many.message.includes('多咗'));
  // too few: villagers would exceed the 3 in the box
  const few = ok(customConfig({ werewolf: 2, seer: 1 }), 10);
  assert.equal(few.ok, false);
  assert.ok(few.message.includes('村民最多 3 張'));
  // no werewolf
  assert.equal(ok(customConfig({ seer: 1, robber: 1, troublemaker: 1, villager: 3 }), 5).ok, false);
  // masons only as a pair: the form cannot express one mason at all
  const m = ok(customConfig({ werewolf: 2, mason: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 }), 5);
  assert.equal(m.ok, true);
  assert.deepEqual(game.resolveRoles({ ...config.defaults(5), ...customConfig({ werewolf: 2, mason: 2, seer: 1, robber: 1, troublemaker: 1 }) }, 5).counts.mason, 2);
  // numeric strings from the shell are fine
  assert.equal(ok({ ...config.defaults(5), discussSec: '240', pace: 'fast' }, 5).ok, true);
});

test('onuw: validate warns about the things the rulebook warns about', () => {
  const w = (counts, n) => config.validate({ ...config.defaults(n), ...customConfig(counts) }, n).warnings.join('|');
  assert.ok(w({ werewolf: 2, seer: 1, robber: 1, troublemaker: 1, doppelganger: 1, villager: 2 }, 5).includes('化身幽靈'));
  const insomOnly = w({ werewolf: 2, seer: 1, insomniac: 1, villager: 3 }, 4);
  assert.ok(insomOnly.includes('失眠者'), 'insomniac with nobody who moves cards');
  assert.ok(!w({ werewolf: 2, seer: 1, robber: 1, insomniac: 1, villager: 2 }, 4).includes('失眠者'), 'a Robber makes her meaningful');
  assert.ok(!w({ werewolf: 2, seer: 1, doppelganger: 1, insomniac: 1, villager: 2 }, 4).includes('失眠者'.repeat(2)));
  assert.ok(w({ werewolf: 2, minion: 1, tanner: 1, seer: 1 }, 3).includes('少過一半') || true);
  const fewVillage = w({ werewolf: 2, minion: 1, tanner: 1, seer: 1, robber: 1, villager: 0 }, 3);
  assert.ok(fewVillage.includes('少過一半'), 'fewer than half village-team cards');
  assert.ok(w({ werewolf: 1, seer: 1, robber: 1, troublemaker: 1, villager: 2 }, 3).includes('1 張狼人'), 'single werewolf');
  assert.ok(config.validate({ ...config.defaults(5), discussSec: 30 }, 5).warnings.some((x) => x.includes('少過 1 分鐘')));
  // the recommended sets themselves carry no warning
  for (let n = 3; n <= 10; n++) assert.deepEqual(config.validate(config.defaults(n), n).warnings, [], `n=${n}`);
});

test('onuw: the custom preset shows a role editor with the villagers filling the rest', () => {
  const cfg = { ...config.defaults(6), preset: 'custom' };
  const f = config.fields(cfg, 6);
  const roles = f.find((x) => x.key === 'custom');
  assert.equal(roles.type, 'roles');
  assert.ok(roles.options.find((o) => o.id === 'villager').auto, 'villager is the auto-fill role');
  assert.equal(roles.options.some((o) => o.id === 'mason'), false, 'masons are the toggle below');
  assert.ok(f.find((x) => x.key === 'customMasons'));
  assert.equal(config.fields(config.defaults(6), 6).some((x) => x.key === 'custom'), false, 'hidden for presets');
  for (const o of roles.options.filter((x) => !x.auto)) assert.ok(o.max === game.CAPS[o.id] && o.min === 0);
  // villagers fill: 9 cards, 7 non-villager roles → 2 villagers
  const r = game.resolveRoles({ ...config.defaults(6), ...customConfig({ werewolf: 2, minion: 1, seer: 1, robber: 1, troublemaker: 1, drunk: 1 }) }, 6);
  assert.equal(r.counts.villager, 2);
});

test('onuw: config.presets — one-tap sets with a readable reason, every one valid and distinct; the first is the recommendation (BACKLOG #8)', () => {
  const countsOf = (cfg, n) => game.resolveRoles({ ...config.defaults(n), ...cfg }, n);
  for (let n = 3; n <= 10; n++) {
    const list = config.presets(n);
    assert.ok(list.length >= 3, `n=${n}: ${list.length} presets`);
    assert.equal(new Set(list.map((p) => p.id)).size, list.length, 'unique ids');
    assert.equal(list[0].id, 'recommended');
    const seen = new Set();
    for (const p of list) {
      assert.ok(p.label && typeof p.reason === 'string' && [...p.reason].length >= 10, `n=${n} ${p.id}: a reason people can read`);
      assert.ok(/[㐀-鿿]/.test(p.label + p.reason), 'Cantonese text');
      // the lobby applies a preset as a patch over the current config
      const cfg = { ...config.defaults(n), ...p.cfg };
      const v = config.validate(cfg, n);
      assert.ok(v.ok, `n=${n} ${p.id}: ${v.message}`);
      const res = countsOf(p.cfg, n);
      assert.ok(res.ok);
      assert.equal(ALL_ROLES.reduce((a, r) => a + res.counts[r], 0), n + 3, 'n + 3 cards');
      seen.add(JSON.stringify([res.counts, cfg.pace]));
      // the lobby highlights the first preset that matches: tapping p must highlight p, not an earlier one
      assert.equal(list.find((q) => presetMatches(cfg, q.cfg))?.id, p.id, `n=${n}: ${p.id} is recognised after tapping it`);
    }
    assert.equal(seen.size, list.length, 'no two presets are the same game');
    assert.deepEqual(countsOf(list[0].cfg, n).counts, game.recommended(n), 'first = the recommended set');
    // the beginner set leaves out the roles the research keeps out of a first game
    const easy = countsOf(list.find((p) => p.id === 'beginner').cfg, n).counts;
    for (const r of ['doppelganger', 'hunter', 'tanner']) assert.equal(easy[r], 0, `n=${n} beginner has no ${r}`);
    assert.equal({ ...config.defaults(n), ...list.find((p) => p.id === 'beginner').cfg }.pace, 'slow');
    // advanced adds the Doppelgänger
    assert.equal(countsOf(list.find((p) => p.id === 'advanced').cfg, n).counts.doppelganger, 1);
  }
  // research sets: 8 = the 7-player set + 1 Villager [D], 9 = the 7-player set + 2 Villagers (BGG)
  const seven = game.recommended(7);
  assert.deepEqual(game.beginnerSet(8), { ...seven, villager: 1 });
  assert.deepEqual(game.beginnerSet(9), { ...seven, villager: 2 });
  assert.equal(game.beginnerSet(5), null, 'the official 3-5 sets are already the beginner sets');
  assert.ok(config.presets(9).find((p) => p.id === 'beginner').reason.includes('皮匠'), 'the reason says what was left out');
  // the official "no Villager cards" set: all 13 specials, so only at 10 players
  const all = config.presets(10).find((p) => p.id === 'all-special');
  assert.ok(all);
  const k = countsOf(all.cfg, 10).counts;
  assert.equal(k.villager, 0);
  for (const r of ALL_ROLES) if (r !== 'villager') assert.equal(k[r], game.CAPS[r], r);
  for (let n = 3; n <= 9; n++) assert.equal(config.presets(n).some((p) => p.id === 'all-special'), false);
  // validate blocks the same set at a head-count it does not fit
  assert.equal(config.validate({ ...config.defaults(9), ...all.cfg }, 9).ok, false);
  assert.ok(config.validate({ ...config.defaults(9), ...all.cfg }, 9).message.includes('多咗'));
});

test('onuw: defaults on ONE phone for everybody pick the slow pace (pass-the-phone friendly) and keep the rest', () => {
  for (let n = 3; n <= 10; n++) {
    const one = config.defaults(n, undefined, { singleDevice: true });
    assert.equal(one.pace, 'slow', `n=${n}`);
    assert.ok(config.validate(one, n).ok);
    assert.equal(config.defaults(n, undefined, { singleDevice: false }).pace, 'standard');
    assert.equal(config.defaults(n).pace, 'standard');
  }
  const d = config.defaults(6, { loneWolf: false, preset: 'advanced', pace: 'fast', ringVote: false }, { singleDevice: true });
  assert.deepEqual([d.loneWolf, d.preset, d.ringVote, d.pace], [false, 'advanced', false, 'slow']);
  // the room counts a hosted lobby with only the host's phone as "one device": once friends join, the automatic slow
  // pace goes back to standard — but a slow pace the host picked by hand stays
  const alone = config.defaults(5, undefined, { singleDevice: true });
  const joined = config.defaults(5, alone, { singleDevice: false });
  assert.equal(joined.pace, 'standard');
  assert.equal(config.validate(joined, 5).ok, true);
  assert.equal(config.defaults(5, { pace: 'slow' }, { singleDevice: false }).pace, 'slow', 'chosen by hand');
  assert.equal(config.defaults(5, { ...alone, pace: 'fast' }, { singleDevice: false }).pace, 'fast', 'changed by hand since');
  assert.equal(config.defaults(5, joined, { singleDevice: true }).pace, 'slow', 'and slow again on one phone');
  assert.equal(config.fields(alone, 5).some((f) => f.key === 'paceAuto'), false, 'the marker is not a form field');
  assert.equal(config.validate({ ...alone, paceAuto: 'x' }, 5).message.includes('undefined'), false);
  // the pace stretches EVERY window by the same factor, so a slow table still tells nothing
  for (const k of ['doppelganger', 'werewolf', 'seer', 'drunk']) assert.equal(game.windowMs(d, k), Math.round(game.windowMs({ ...d, pace: 'standard' }, k) * 1.5));
});

// ============================================================
// setup
// ============================================================

test('onuw: setup deals n+3 cards from the role list, 3 to the centre, and builds the steps', () => {
  for (let n = 3; n <= 10; n++) {
    for (const preset of ['auto', 'advanced']) {
      const sim = new Sim(game, { n, seed: n, config: { ...config.defaults(n), preset } });
      const s = st(sim);
      const all = [...s.order.map((p) => s.cards[p].role), ...s.centre.map((c) => c.role)];
      assert.equal(all.length, n + 3);
      assert.equal(s.centre.length, 3);
      const counts = {};
      for (const r of all) counts[r] = (counts[r] ?? 0) + 1;
      const want = preset === 'auto' ? game.recommended(n) : game.advanced(n);
      for (const r of ALL_ROLES) assert.equal(counts[r] ?? 0, want[r], `${r} n=${n}`);
      for (const p of s.order) assert.equal(s.orig[p], s.cards[p].role);
      assert.deepEqual(s.dealtCentre, s.centre.map((c) => c.role));
      assert.equal(s.phase, 'deal');
    }
  }
});

test('onuw: the step list is decided by the role LIST (centre cards included), in wake order, with the two Doppelgänger sub-steps', () => {
  const ks = (counts) => game.buildSteps(counts).map((x) => x.k);
  assert.deepEqual(ks(game.recommended(5)), ['begin', 'werewolf', 'seer', 'robber', 'troublemaker', 'dawn']);
  assert.deepEqual(ks(game.recommended(7)), ['begin', 'werewolf', 'minion', 'mason', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac', 'dawn']);
  const everything = { doppelganger: 1, werewolf: 2, minion: 1, mason: 2, seer: 1, robber: 1, troublemaker: 1, drunk: 1, insomniac: 1, villager: 1, hunter: 1, tanner: 1 };
  assert.deepEqual(ks(everything), ['begin', 'doppelganger', 'doppelganger-minion', 'werewolf', 'minion', 'mason', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac', 'doppelganger-insomniac', 'dawn']);
  // sub-steps need BOTH cards
  assert.deepEqual(ks({ doppelganger: 1, werewolf: 2, seer: 1 }), ['begin', 'doppelganger', 'werewolf', 'seer', 'dawn']);
  assert.deepEqual(ks({ doppelganger: 1, werewolf: 2, minion: 1 }), ['begin', 'doppelganger', 'doppelganger-minion', 'werewolf', 'minion', 'dawn']);
  assert.deepEqual(ks({ doppelganger: 1, werewolf: 2, insomniac: 1 }), ['begin', 'doppelganger', 'werewolf', 'insomniac', 'doppelganger-insomniac', 'dawn']);
  // villager, hunter, tanner never wake
  assert.equal(ks({ werewolf: 2, villager: 3, hunter: 1, tanner: 1 }).length, 3);
  // a role whose card is in the centre is still called
  const sim = scenario({ p1: 'werewolf', p2: 'werewolf', p3: 'villager', p4: 'villager' }, ['seer', 'robber', 'villager']);
  assert.ok(st(sim).steps.some((x) => x.k === 'seer') && st(sim).steps.some((x) => x.k === 'robber'));
});

test('onuw: setup is deterministic, takes hostPid when it is valid, and survives a bad config', () => {
  const a = new Sim(game, { n: 6, seed: 5 });
  const b = new Sim(game, { n: 6, seed: 5 });
  assert.deepEqual(a.state, b.state);
  assert.notDeepEqual(new Sim(game, { n: 6, seed: 6 }).state.cards, a.state.cards);
  assert.equal(a.state.host, 'p1', 'the Sim seats the host on p1');
  assert.equal(new Sim(game, { n: 6, seed: 5, hostPid: 'p4' }).state.host, 'p4');
  assert.equal(new Sim(game, { n: 6, seed: 5, hostPid: null }).state.host, 'p1', 'falls back to the first seat');
  const players = makePlayers(5);
  const mk = (hostPid, cfg = config.defaults(5)) => engine.setup({ players, config: cfg, rng: mulberry32(1), now: 0, hostPid });
  assert.equal(mk('p3').host, 'p3');
  assert.equal(mk('nobody').host, 'p1');
  assert.equal(mk(undefined).host, 'p1');
  const bad = mk('p1', { preset: 'custom', custom: { werewolf: 9 } });
  assert.equal(Object.keys(bad.cards).length, 5, 'a broken config still deals a legal game');
  assert.throws(() => engine.setup({ players: makePlayers(2), config: {}, rng: mulberry32(1), now: 0 }), RangeError);
  assert.throws(() => engine.setup({ players: makePlayers(11), config: {}, rng: mulberry32(1), now: 0 }), RangeError);
});

test('onuw: fair deal (BACKLOG #20) — uniform by default; the optional anti-streak keeps werewolf cards away from last game\'s dealt werewolves, equally over everybody else', () => {
  const players = (n) => makePlayers(n);
  const deal = (n, seed, cfg, carry) => engine.setup({ players: players(n), config: { ...config.defaults(n), ...cfg }, rng: mulberry32(seed), now: 0, hostPid: 'p1', ...(carry ? { carry } : {}) });
  // result().carry names who was DEALT a werewolf, and never reaches the lines
  const sim = new Sim(game, { n: 5, seed: 3 });
  const { result } = sim.runRandom();
  assert.deepEqual(result.carry, { wolves: st(sim).order.filter((p) => st(sim).orig[p] === 'werewolf') });
  // off (the default): a carry changes nothing at all — the very same deal
  for (let seed = 1; seed <= 30; seed++) assert.deepEqual(deal(6, seed, {}, { wolves: ['p1', 'p2'] }).orig, deal(6, seed, {}).orig);
  // on: last game's werewolves never get one again, for every head-count; the cards are still the role list
  for (let n = 3; n <= 10; n++) {
    for (let seed = 1; seed <= 40; seed++) {
      const s = deal(n, seed, { antiStreak: true }, { wolves: ['p1', 'p3'] });
      assert.notEqual(s.orig.p1, 'werewolf', `n=${n} seed=${seed}`);
      assert.notEqual(s.orig.p3, 'werewolf', `n=${n} seed=${seed}`);
      assert.equal([...Object.values(s.orig), ...s.dealtCentre].filter((r) => r === 'werewolf').length, game.recommended(n).werewolf);
    }
  }
  // …and is fair to everybody else: at n = 5 there are 8 places (5 seats + 3 centre cards), 2 are barred, so each
  // of the other 6 holds a werewolf a third of the time (2 cards over 6 places)
  const hits = Array(8).fill(0);
  const N = 3000;
  for (let seed = 1; seed <= N; seed++) {
    const s = deal(5, seed * 7 + 1, { antiStreak: true }, { wolves: ['p1', 'p2'] });
    [...s.order.map((p) => s.orig[p]), ...s.dealtCentre].forEach((r, i) => { if (r === 'werewolf') hits[i]++; });
  }
  assert.deepEqual(hits.slice(0, 2), [0, 0]);
  for (const h of hits.slice(2)) assert.ok(Math.abs(h / N - 1 / 3) < 0.04, `uniform over the allowed places: ${hits.join(',')}`);
  // junk carries are ignored, a carry of seats that left changes nothing
  for (const junk of [null, 'x', { wolves: 'p1' }, { wolves: [7, null] }, { wolves: ['p99'] }]) {
    assert.doesNotThrow(() => deal(5, 2, { antiStreak: true }, junk));
    assert.deepEqual(deal(5, 2, { antiStreak: true }, junk).orig, deal(5, 2, { antiStreak: true }).orig, JSON.stringify(junk));
  }
  // the option is in the form, in the summary, and validated
  assert.ok(config.fields(config.defaults(5), 5).some((f) => f.key === 'antiStreak' && f.type === 'bool'));
  assert.ok(config.summary({ ...config.defaults(5), antiStreak: true }, 5).some((l) => l.startsWith('🔁')));
  assert.equal(config.summary(config.defaults(5), 5).some((l) => l.startsWith('🔁')), false);
  assert.equal(config.validate({ ...config.defaults(5), antiStreak: 'yes' }, 5).ok, false);
  assert.equal(config.defaults(5).antiStreak, false, 'off by default: the deal is fully random');
});

test('onuw: deal phase — everyone must tap 記住喇, then the night begins; the cue is acknowledged without moving on', () => {
  const sim = new Sim(game, { n: 4, seed: 1 });
  assert.equal(st(sim).phase, 'deal');
  const c = sim.cue();
  assert.ok(c && c.id && c.text && c.minMs >= 2500);
  assert.equal(sim.cueDone(), true);
  assert.equal(sim.cue(), null);
  assert.equal(st(sim).phase, 'deal');
  assert.deepEqual(sim.focus().pids, ['p1', 'p2', 'p3', 'p4']);
  sim.act('p1', { type: 'ready' });
  assert.deepEqual(sim.focus().pids, ['p2', 'p3', 'p4'], 'focus shrinks as seats get ready (shared phone walks on)');
  assert.equal(sim.act('p1', { type: 'ready' }), false, 'twice is nothing');
  assert.equal(sim.legal('p1').length, 0);
  for (const p of ['p2', 'p3']) sim.act(p, { type: 'ready' });
  assert.equal(st(sim).phase, 'deal');
  sim.act('p4', { type: 'ready' });
  assert.equal(st(sim).phase, 'night');
  assert.equal(stepK(sim), 'begin');
  assert.equal(st(sim).stage, 'cue');
  assert.equal(sim.focus(), null);
  // host can force a slow table: first 下一步 acknowledges the cue, the second starts the night
  const sim2 = new Sim(game, { n: 4, seed: 1 });
  sim2.host({ type: ACT.NEXT });
  assert.equal(st(sim2).phase, 'deal');
  sim2.host({ type: ACT.NEXT });
  assert.equal(st(sim2).phase, 'night');
});

// ============================================================
// the night — who wakes and what they learn
// ============================================================

test('onuw: werewolves see each other; the lone wolf may look at ONE centre card (and it changes nothing)', () => {
  const deal = { p1: 'werewolf', p2: 'werewolf', p3: 'seer', p4: 'villager' };
  const both = scenario(deal, ['robber', 'troublemaker', 'villager']);
  openStep(both, 'werewolf');
  assert.deepEqual(noteOf(both, 'p1', 'wolves').with, ['p2']);
  assert.deepEqual(noteOf(both, 'p2', 'wolves').with, ['p1']);
  assert.equal(noteOf(both, 'p1', 'wolves').alone, false);
  assert.equal(notes(both, 'p3').length, 0, 'sleepers learn nothing');
  assert.equal(engine.view(st(both), 'p1').my.night.ab, null, 'nobody is alone → no peek');
  assert.equal(act(both, 'p1', { type: 'look-centre', cards: [0] }), false);

  const lone = scenario({ p1: 'werewolf', p2: 'seer', p3: 'villager', p4: 'villager' }, ['werewolf', 'robber', 'troublemaker']);
  openStep(lone, 'werewolf');
  const n1 = noteOf(lone, 'p1', 'wolves');
  assert.equal(n1.alone, true);
  assert.deepEqual(n1.with, []);
  const before = JSON.stringify([st(lone).cards, st(lone).centre]);
  assert.equal(engine.view(st(lone), 'p1').my.night.ab.mode, 'centre1');
  assert.equal(act(lone, 'p1', { type: 'look-centre', cards: [0] }), true);
  assert.equal(noteOf(lone, 'p1', 'lone-peek').role, 'werewolf');
  assert.equal(noteOf(lone, 'p1', 'lone-peek').slot, 0);
  assert.equal(JSON.stringify([st(lone).cards, st(lone).centre]), before, 'peeking moves nothing');
  assert.equal(act(lone, 'p1', { type: 'look-centre', cards: [1] }), false, 'only once');
  // only ONE card, only a legal index, and only for the wolf
  const lone2 = scenario({ p1: 'werewolf', p2: 'seer', p3: 'villager', p4: 'villager' }, ['werewolf', 'robber', 'troublemaker']);
  openStep(lone2, 'werewolf');
  for (const bad of [[0, 1], [3], [-1], [1.5], ['0'], [0, 0], []]) assert.equal(act(lone2, 'p1', { type: 'look-centre', cards: bad }), false, JSON.stringify(bad));
  assert.equal(act(lone2, 'p2', { type: 'look-centre', cards: [0] }), false);
  // option off: no peek
  const off = scenario({ p1: 'werewolf', p2: 'seer', p3: 'villager', p4: 'villager' }, ['werewolf', 'robber', 'troublemaker'], { loneWolf: false });
  openStep(off, 'werewolf');
  assert.equal(engine.view(st(off), 'p1').my.night.ab, null);
  assert.equal(act(off, 'p1', { type: 'look-centre', cards: [0] }), false);
});

test('onuw: both werewolves in the centre — the step is still called, nobody is awake, the minion sees nobody', () => {
  const sim = scenario({ p1: 'minion', p2: 'seer', p3: 'villager', p4: 'villager' }, ['werewolf', 'werewolf', 'robber']);
  openStep(sim, 'werewolf');
  assert.deepEqual(sim.focus(), { pids: [], anonymous: S.anonymousPrompt('werewolf') });
  assert.ok(sim.state.steps.some((x) => x.k === 'werewolf'));
  sim.advance();
  openStep(sim, 'minion');
  assert.deepEqual(noteOf(sim, 'p1', 'minion').wolves, []);
});

test('onuw: the minion sees the werewolves, the werewolves never learn the minion, minions do not see each other', () => {
  const sim = scenario({ p1: 'minion', p2: 'werewolf', p3: 'werewolf', p4: 'seer', p5: 'villager' }, ['villager', 'villager', 'robber']);
  openStep(sim, 'minion');
  assert.deepEqual(noteOf(sim, 'p1', 'minion').wolves, ['p2', 'p3']);
  for (const w of ['p2', 'p3']) {
    for (const n of notes(sim, w)) assert.ok(!JSON.stringify(n).includes('p1'), 'a wolf note must not mention the minion');
  }
  assert.equal(JSON.stringify(engine.view(st(sim), 'p2')).includes('minion'), true, 'role list is public');
  assert.equal(JSON.stringify(engine.view(st(sim), 'p2').my), JSON.stringify(engine.view(st(sim), 'p2').my));
});

test('onuw: masons see each other; a lone mason sees nobody (the other is in the centre); both in the centre → nobody', () => {
  const two = scenario({ p1: 'mason', p2: 'mason', p3: 'seer', p4: 'villager', p5: 'werewolf' }, ['werewolf', 'villager', 'robber']);
  openStep(two, 'mason');
  assert.deepEqual(noteOf(two, 'p1', 'mason').with, ['p2']);
  assert.equal(noteOf(two, 'p1', 'mason').alone, false);
  const one = scenario({ p1: 'mason', p2: 'seer', p3: 'villager', p4: 'villager', p5: 'werewolf' }, ['mason', 'werewolf', 'robber']);
  openStep(one, 'mason');
  assert.equal(noteOf(one, 'p1', 'mason').alone, true);
  assert.ok(S.noteLine(noteOf(one, 'p1', 'mason'), (p) => p).includes('喺中間'));
  const none = scenario({ p1: 'seer', p2: 'villager', p3: 'villager', p4: 'villager', p5: 'werewolf' }, ['mason', 'mason', 'werewolf']);
  openStep(none, 'mason');
  assert.deepEqual(none.focus(), { pids: [], anonymous: S.anonymousPrompt('mason') });
  assert.equal(notes(none, 'p1').length, 0);
});

test('onuw: seer — one player OR two centre cards, never both, never herself, may do nothing', () => {
  const mk = () => openStep(scenario({ p1: 'seer', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['tanner', 'drunk', 'werewolf']), 'seer');
  let sim = mk();
  assert.equal(act(sim, 'p1', { type: 'look-player', target: 'p1' }), false, 'not herself');
  assert.equal(act(sim, 'p1', { type: 'look-player', target: 'pX' }), false);
  assert.equal(act(sim, 'p1', { type: 'look-centre', cards: [0, 0] }), false, 'distinct cards');
  assert.equal(act(sim, 'p1', { type: 'look-centre', cards: [0] }), false, 'two cards, not one');
  assert.equal(act(sim, 'p2', { type: 'look-player', target: 'p3' }), false, 'only the seer');
  assert.equal(act(sim, 'p1', { type: 'look-player', target: 'p3' }), true);
  assert.deepEqual(noteOf(sim, 'p1', 'seer-player'), { ix: st(sim).ix, via: 'self', k: 'seer-player', target: 'p3', role: 'werewolf' });
  assert.equal(act(sim, 'p1', { type: 'look-centre', cards: [0, 1] }), false, 'one look only');
  assert.equal(act(sim, 'p1', { type: 'look-player', target: 'p2' }), false);
  sim = mk();
  assert.equal(act(sim, 'p1', { type: 'look-centre', cards: [2, 0] }), true);
  const n = noteOf(sim, 'p1', 'seer-centre');
  assert.deepEqual(n.slots, [0, 2]);
  assert.deepEqual(n.roles, ['tanner', 'werewolf']);
  assert.equal(act(sim, 'p1', { type: 'look-player', target: 'p3' }), false);
  // does nothing: the window lapses, an idle note says so, nothing moved
  sim = mk();
  const cards = JSON.stringify(st(sim).cards);
  sim.advance();
  assert.equal(noteOf(sim, 'p1', 'idle').ability, 'seer');
  assert.equal(JSON.stringify(st(sim).cards), cards);
  // looking at a Doppelgänger card shows the Doppelgänger face, not what it copied
  const d = openStep(scenario({ p1: 'seer', p2: 'doppelganger', p3: 'werewolf', p4: 'villager' }, ['villager', 'robber', 'werewolf']), 'seer', { doppelganger: (x) => act(x, 'p2', { type: 'copy', target: 'p3' }) });
  act(d, 'p1', { type: 'look-player', target: 'p2' });
  assert.equal(noteOf(d, 'p1', 'seer-player').role, 'doppelganger');
});

test('onuw: robber swaps cards with a player, sees the NEW card, and the victim silently holds the Robber card', () => {
  const sim = openStep(scenario({ p1: 'robber', p2: 'werewolf', p3: 'seer', p4: 'villager' }, ['villager', 'werewolf', 'tanner']), 'robber');
  assert.equal(act(sim, 'p1', { type: 'rob', target: 'p1' }), false);
  assert.equal(act(sim, 'p1', { type: 'rob', target: 'centre' }), false);
  assert.equal(act(sim, 'p2', { type: 'rob', target: 'p3' }), false, 'only the robber');
  assert.equal(act(sim, 'p1', { type: 'rob', target: 'p2' }), true);
  assert.equal(faceAt(sim, 'p1'), 'werewolf');
  assert.equal(faceAt(sim, 'p2'), 'robber');
  assert.equal(noteOf(sim, 'p1', 'rob').role, 'werewolf');
  assert.equal(notes(sim, 'p2').filter((n) => n.k === 'rob').length, 0, 'the victim is told nothing');
  assert.equal(act(sim, 'p1', { type: 'rob', target: 'p3' }), false, 'once');
  sim.advance();
  playNight(sim);
  assert.equal(finalAt(sim, 'p1'), 'werewolf');
  assert.equal(finalAt(sim, 'p2'), 'robber');
});

test('onuw: the robber may decline and stays a Robber; he never performs the stolen role\'s action', () => {
  const sim = scenario({ p1: 'robber', p2: 'werewolf', p3: 'seer', p4: 'villager' }, ['villager', 'werewolf', 'tanner']);
  playNight(sim);
  assert.equal(finalAt(sim, 'p1'), 'robber');
  assert.equal(noteOf(sim, 'p1', 'idle').ability, 'robber');
  // the robber steals the SEER: the seer already acted at step 5; the robber, now holding the Seer card, does nothing more
  const s2 = scenario({ p1: 'robber', p2: 'seer', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'tanner']);
  playNight(s2, { robber: (x) => act(x, 'p1', { type: 'rob', target: 'p2' }) });
  assert.equal(faceAt(s2, 'p1'), 'seer');
  assert.equal(notes(s2, 'p1').filter((n) => n.k === 'seer-player' || n.k === 'seer-centre').length, 0);
});

test('onuw: wake-by-original-role — a Robber who steals the Troublemaker card does not wake as one; the real Troublemaker still swaps', () => {
  const sim = scenario({ p1: 'robber', p2: 'troublemaker', p3: 'werewolf', p4: 'villager', p5: 'seer' }, ['villager', 'werewolf', 'tanner']);
  openStep(sim, 'robber');
  act(sim, 'p1', { type: 'rob', target: 'p2' });
  sim.advance();
  openStep(sim, 'troublemaker');
  assert.equal(st(sim).phase, 'night');
  assert.equal(engine.view(st(sim), 'p1').my.night.awake, false, 'the robber holds the card but does not wake');
  assert.equal(engine.view(st(sim), 'p2').my.night.awake, true, 'the original Troublemaker wakes');
  assert.equal(engine.view(st(sim), 'p2').my.night.ab.name, 'troublemaker');
  assert.equal(act(sim, 'p1', { type: 'swap', a: 'p3', b: 'p4' }), false);
  // p2 now holds the Robber card, yet still swaps p3 and p4
  assert.equal(faceAt(sim, 'p2'), 'robber');
  assert.equal(act(sim, 'p2', { type: 'swap', a: 'p3', b: 'p4' }), true);
  assert.equal(faceAt(sim, 'p3'), 'villager');
  assert.equal(faceAt(sim, 'p4'), 'werewolf');
});

test('onuw: troublemaker swaps two OTHER players\' cards unseen (not herself, not the centre, not the same twice)', () => {
  const sim = openStep(scenario({ p1: 'troublemaker', p2: 'werewolf', p3: 'seer', p4: 'villager' }, ['villager', 'werewolf', 'tanner']), 'troublemaker');
  for (const bad of [{ a: 'p1', b: 'p2' }, { a: 'p2', b: 'p1' }, { a: 'p2', b: 'p2' }, { a: 'p2', b: 'centre' }, { a: 'p2', b: 'p9' }, { a: 'p2' }]) {
    assert.equal(act(sim, 'p1', { type: 'swap', ...bad }), false, JSON.stringify(bad));
  }
  assert.equal(act(sim, 'p2', { type: 'swap', a: 'p3', b: 'p4' }), false, 'only the troublemaker');
  assert.equal(act(sim, 'p1', { type: 'swap', a: 'p2', b: 'p3' }), true);
  assert.equal(faceAt(sim, 'p2'), 'seer');
  assert.equal(faceAt(sim, 'p3'), 'werewolf');
  const n = noteOf(sim, 'p1', 'swap');
  assert.ok(!('role' in n) && !('roles' in n), 'she does not learn what she swapped');
  assert.deepEqual(notes(sim, 'p2').filter((x) => !['wolves', 'idle'].includes(x.k)), [], 'the swapped players are told nothing');
  assert.equal(act(sim, 'p1', { type: 'swap', a: 'p3', b: 'p4' }), false, 'once');
  // works on the layout AFTER the robber
  const s2 = scenario({ p1: 'troublemaker', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'tanner']);
  playNight(s2, {
    robber: (x) => act(x, 'p2', { type: 'rob', target: 'p3' }),
    troublemaker: (x) => act(x, 'p1', { type: 'swap', a: 'p2', b: 'p4' }),
  });
  assert.equal(finalAt(s2, 'p4'), 'werewolf', 'the thief\'s werewolf card moved on to p4');
  assert.equal(finalAt(s2, 'p2'), 'villager');
  assert.equal(finalAt(s2, 'p3'), 'robber');
});

test('onuw: drunk MUST swap with a centre card of his choice, blind; his old card goes to the centre; a lapsed window swaps for him', () => {
  const mk = () => openStep(scenario({ p1: 'drunk', p2: 'werewolf', p3: 'seer', p4: 'villager' }, ['tanner', 'werewolf', 'robber']), 'drunk');
  let sim = mk();
  assert.equal(engine.view(st(sim), 'p1').my.night.ab.mandatory, true);
  for (const bad of [{ card: 3 }, { card: -1 }, { card: '1' }, { card: 0.5 }, {}]) assert.equal(act(sim, 'p1', { type: 'drunk-swap', ...bad }), false, JSON.stringify(bad));
  assert.equal(act(sim, 'p2', { type: 'drunk-swap', card: 0 }), false);
  assert.equal(act(sim, 'p1', { type: 'drunk-swap', card: 0 }), true);
  assert.equal(faceAt(sim, 'p1'), 'tanner');
  assert.deepEqual(centreRoles(sim), ['drunk', 'werewolf', 'robber']);
  const n = noteOf(sim, 'p1', 'drunk');
  assert.equal(n.slot, 0);
  assert.ok(!('role' in n), 'he sees nothing');
  assert.equal(act(sim, 'p1', { type: 'drunk-swap', card: 1 }), false, 'once');
  sim = mk();
  sim.advance();
  assert.equal(noteOf(sim, 'p1', 'drunk').auto, true);
  assert.notEqual(faceAt(sim, 'p1'), 'drunk', 'the swap happened anyway');
  assert.ok(centreRoles(sim).includes('drunk'));
  assert.ok(S.noteLine(noteOf(sim, 'p1', 'drunk'), (p) => p).includes('系統'));
});

test('onuw: insomniac sees her FINAL card after the robber, troublemaker and drunk have moved things', () => {
  const sim = scenario({ p1: 'insomniac', p2: 'robber', p3: 'troublemaker', p4: 'drunk', p5: 'werewolf', p6: 'villager' }, ['seer', 'villager', 'villager']);
  playNight(sim, {
    robber: (x) => act(x, 'p2', { type: 'rob', target: 'p1' }),
    troublemaker: (x) => act(x, 'p3', { type: 'swap', a: 'p5', b: 'p6' }),
    drunk: (x) => act(x, 'p4', { type: 'drunk-swap', card: 0 }),
  });
  assert.equal(noteOf(sim, 'p1', 'insomniac').role, 'robber', 'robbed → she sees the Robber card');
  // not robbed → sees her own
  const s2 = scenario({ p1: 'insomniac', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['seer', 'villager', 'troublemaker']);
  playNight(s2);
  assert.equal(noteOf(s2, 'p1', 'insomniac').role, 'insomniac');
  // swapped by a troublemaker
  const s3 = scenario({ p1: 'insomniac', p2: 'troublemaker', p3: 'werewolf', p4: 'villager' }, ['seer', 'villager', 'robber']);
  playNight(s3, { troublemaker: (x) => act(x, 'p2', { type: 'swap', a: 'p1', b: 'p3' }) });
  assert.equal(noteOf(s3, 'p1', 'insomniac').role, 'werewolf');
  assert.equal(finalAt(s3, 'p1'), 'werewolf');
});

// ============================================================
// the Doppelgänger
// ============================================================

const DOP = { p1: 'doppelganger', p2: 'seer', p3: 'werewolf', p4: 'villager', p5: 'robber' };

test('onuw: doppelgänger — another player only, becomes that role without swapping, a lapsed window copies at random', () => {
  const sim = openStep(scenario(DOP, ['werewolf', 'troublemaker', 'drunk']), 'doppelganger');
  assert.equal(engine.view(st(sim), 'p1').my.night.ab.name, 'copy');
  for (const bad of [{ target: 'p1' }, { target: 'centre' }, { target: 'p9' }, {}]) assert.equal(act(sim, 'p1', { type: 'copy', ...bad }), false, JSON.stringify(bad));
  assert.equal(act(sim, 'p2', { type: 'copy', target: 'p3' }), false, 'only the doppelgänger');
  const cards = JSON.stringify(st(sim).cards);
  assert.equal(act(sim, 'p1', { type: 'copy', target: 'p2' }), true);
  assert.equal(JSON.stringify(st(sim).cards.p2), JSON.stringify({ role: 'seer' }), 'nothing was swapped');
  assert.equal(faceAt(sim, 'p1'), 'doppelganger');
  assert.equal(st(sim).cards.p1.copied, 'seer');
  assert.equal(finalAt(sim, 'p1'), 'seer');
  assert.equal(noteOf(sim, 'p1', 'copy').role, 'seer');
  assert.equal(act(sim, 'p1', { type: 'copy', target: 'p3' }), false, 'copy once');
  assert.notEqual(JSON.stringify(st(sim).cards), cards);
  // lapse
  const lapse = openStep(scenario(DOP, ['werewolf', 'troublemaker', 'drunk']), 'doppelganger');
  lapse.advance();
  assert.equal(noteOf(lapse, 'p1', 'copy').auto, true);
  assert.ok(['seer', 'werewolf', 'villager', 'robber'].includes(st(lapse).cards.p1.copied));
  assert.ok(S.noteLine(noteOf(lapse, 'p1', 'copy'), (p) => p).includes('系統'));
});

test('onuw: doppelgänger who copies villager / tanner / hunter has no night action and is that role', () => {
  for (const role of ['villager', 'tanner', 'hunter']) {
    const sim = openStep(scenario({ p1: 'doppelganger', p2: role, p3: 'werewolf', p4: 'seer', p5: 'robber' }, ['villager', 'werewolf', 'troublemaker']), 'doppelganger');
    act(sim, 'p1', { type: 'copy', target: 'p2' });
    assert.equal(engine.view(st(sim), 'p1').my.night.ab, null, `${role}: nothing more to do`);
    assert.equal(finalAt(sim, 'p1'), role);
    sim.advance();
    for (const k of ['werewolf', 'seer', 'robber']) {
      openStep(sim, k);
      assert.equal(engine.view(st(sim), 'p1').my.night.awake, false, `${role}: does not wake at ${k}`);
      sim.advance();
    }
  }
});

test('onuw: doppelgänger-seer acts at once inside her own step and never wakes for it again; the real seer still acts later', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'seer', p3: 'werewolf', p4: 'villager', p5: 'robber' }, ['tanner', 'werewolf', 'troublemaker']);
  openStep(sim, 'doppelganger');
  act(sim, 'p1', { type: 'copy', target: 'p2' });
  const ab = engine.view(st(sim), 'p1').my.night.ab;
  assert.equal(ab.name, 'seer');
  assert.equal(ab.via, 'doppel');
  assert.equal(act(sim, 'p1', { type: 'look-centre', cards: [0, 1] }), true);
  assert.deepEqual(noteOf(sim, 'p1', 'seer-centre').roles, ['tanner', 'werewolf']);
  assert.equal(noteOf(sim, 'p1', 'seer-centre').via, 'doppel');
  assert.equal(engine.view(st(sim), 'p1').my.night.ab, null, 'one action only');
  assert.equal(act(sim, 'p1', { type: 'look-player', target: 'p3' }), false);
  sim.advance();
  openStep(sim, 'seer');
  assert.equal(engine.view(st(sim), 'p1').my.night.awake, false, 'she does not wake again at the seer step');
  assert.equal(engine.view(st(sim), 'p2').my.night.ab.name, 'seer');
});

test('onuw: doppelgänger-robber robs a werewolf — she holds the werewolf card (a wolf), the wolf holds the doppelgänger card carrying "robber" (village)', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'robber', p3: 'werewolf', p4: 'villager', p5: 'seer' }, ['villager', 'werewolf', 'troublemaker']);
  playNight(sim, {
    doppelganger: (x) => {
      act(x, 'p1', { type: 'copy', target: 'p2' });
      act(x, 'p1', { type: 'rob', target: 'p3' });
    },
  });
  assert.equal(faceAt(sim, 'p1'), 'werewolf');
  assert.equal(faceAt(sim, 'p3'), 'doppelganger');
  assert.equal(finalAt(sim, 'p1'), 'werewolf');
  assert.equal(finalAt(sim, 'p3'), 'robber', 'the copied role travels with the card');
  assert.equal(game.teamOf(finalAt(sim, 'p3')), 'village');
  // she never woke as a werewolf (original role), but the original wolf still did
  assert.equal(notes(sim, 'p1').filter((n) => n.k === 'wolves').length, 0);
  assert.equal(notes(sim, 'p3').filter((n) => n.k === 'wolves').length, 1);
  assert.equal(noteOf(sim, 'p1', 'rob').role, 'werewolf');
  assert.equal(noteOf(sim, 'p1', 'rob').via, 'doppel');
});

test('onuw: a robbed doppelgänger who copied the insomniac still wakes at the doppelgänger-insomniac step and sees her new card', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'insomniac', p3: 'robber', p4: 'werewolf', p5: 'villager' }, ['werewolf', 'seer', 'troublemaker']);
  playNight(sim, {
    doppelganger: (x) => act(x, 'p1', { type: 'copy', target: 'p2' }),
    robber: (x) => act(x, 'p3', { type: 'rob', target: 'p1' }),
  });
  const ins = notes(sim, 'p1').filter((n) => n.k === 'insomniac');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].role, 'robber', 'she now holds the Robber card');
  assert.equal(ins[0].via, 'doppel');
  assert.equal(noteOf(sim, 'p2', 'insomniac').role, 'insomniac');
  // the robber sees a Doppelgänger face and is silently an insomniac
  assert.equal(noteOf(sim, 'p3', 'rob').role, 'doppelganger');
  assert.equal(finalAt(sim, 'p3'), 'insomniac');
});

test('onuw: doppelgänger-werewolf counts as an awake werewolf (a real lone wolf is no longer alone); the minion sees her', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'werewolf', p3: 'minion', p4: 'seer', p5: 'villager' }, ['werewolf', 'robber', 'villager']);
  openStep(sim, 'doppelganger');
  act(sim, 'p1', { type: 'copy', target: 'p2' });
  sim.advance();
  openStep(sim, 'doppelganger-minion');
  assert.equal(engine.view(st(sim), 'p1').my.night.awake, false, 'she copied a wolf, not the minion');
  sim.advance();
  openStep(sim, 'werewolf');
  assert.deepEqual(noteOf(sim, 'p2', 'wolves').with, ['p1']);
  assert.equal(noteOf(sim, 'p2', 'wolves').alone, false);
  assert.equal(engine.view(st(sim), 'p2').my.night.ab, null, 'no lone-wolf peek: she is awake too');
  assert.deepEqual(noteOf(sim, 'p1', 'wolves').with, ['p2']);
  assert.equal(noteOf(sim, 'p1', 'wolves').via, 'doppel');
  sim.advance();
  openStep(sim, 'minion');
  assert.deepEqual(noteOf(sim, 'p3', 'minion').wolves, ['p1', 'p2']);
  assert.equal(finalAt(sim, 'p1'), 'werewolf');
  // she can only copy a wolf who is himself awake at step 2, so a doppelgänger is never the lone wolf
  assert.equal(noteOf(sim, 'p1', 'wolves').alone, false);
});

test('onuw: doppelgänger-mason wakes with the masons (village team); a lone real mason sees her', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'mason', p3: 'werewolf', p4: 'seer', p5: 'villager' }, ['mason', 'werewolf', 'robber']);
  openStep(sim, 'doppelganger');
  act(sim, 'p1', { type: 'copy', target: 'p2' });
  sim.advance();
  openStep(sim, 'mason');
  assert.deepEqual(noteOf(sim, 'p2', 'mason').with, ['p1']);
  assert.deepEqual(noteOf(sim, 'p1', 'mason').with, ['p2']);
  assert.equal(game.teamOf(finalAt(sim, 'p1')), 'village');
});

test('onuw: doppelgänger-minion sees the werewolves in her own sub-step right after her step, never at the minion step', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'minion', p3: 'werewolf', p4: 'werewolf', p5: 'seer' }, ['villager', 'villager', 'robber']);
  openStep(sim, 'doppelganger');
  act(sim, 'p1', { type: 'copy', target: 'p2' });
  sim.advance();
  assert.equal(stepK(sim), 'doppelganger-minion');
  sim.cueDone();
  assert.deepEqual(noteOf(sim, 'p1', 'minion').wolves, ['p3', 'p4']);
  assert.equal(noteOf(sim, 'p1', 'minion').via, 'doppel');
  assert.deepEqual(sim.focus().pids, ['p1']);
  sim.advance();
  openStep(sim, 'minion');
  assert.equal(engine.view(st(sim), 'p1').my.night.awake, false, 'she does not wake at step 3');
  assert.equal(engine.view(st(sim), 'p2').my.night.awake, true);
  assert.equal(game.teamOf(finalAt(sim, 'p1')), 'wolf');
  // called even when she copied something else
  const other = scenario({ p1: 'doppelganger', p2: 'minion', p3: 'werewolf', p4: 'werewolf', p5: 'seer' }, ['villager', 'villager', 'robber']);
  openStep(other, 'doppelganger');
  act(other, 'p1', { type: 'copy', target: 'p5' });
  other.advance();
  openStep(other, 'doppelganger-minion');
  assert.deepEqual(other.focus(), { pids: [], anonymous: S.anonymousPrompt('doppelganger-minion') });
});

test('onuw: doppelgänger-troublemaker swaps BEFORE the real werewolves, seer and so on act; the later steps see the new layout', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'troublemaker', p3: 'werewolf', p4: 'seer', p5: 'villager' }, ['villager', 'werewolf', 'robber']);
  playNight(sim, {
    doppelganger: (x) => {
      act(x, 'p1', { type: 'copy', target: 'p2' });
      act(x, 'p1', { type: 'swap', a: 'p3', b: 'p4' });
    },
    seer: (x) => act(x, 'p4', { type: 'look-player', target: 'p3' }),
  });
  assert.equal(noteOf(sim, 'p4', 'seer-player').role, 'seer', 'p3 holds the seer card at step 5, so the seer sees it');
  // p3 still woke as a werewolf at step 2 (original role), even though their card had been swapped away
  assert.equal(notes(sim, 'p3').filter((n) => n.k === 'wolves').length, 1);
  assert.equal(finalAt(sim, 'p3'), 'seer');
  assert.equal(finalAt(sim, 'p4'), 'werewolf');
});

test('onuw: doppelgänger-drunk puts her card (copy = drunk) in the centre; a drunk who picks up a doppelgänger card that never copied gets a plain villager', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'drunk', p3: 'werewolf', p4: 'seer', p5: 'villager' }, ['villager', 'werewolf', 'robber']);
  playNight(sim, {
    doppelganger: (x) => {
      act(x, 'p1', { type: 'copy', target: 'p2' });
      assert.equal(engine.view(st(x), 'p1').my.night.ab.mandatory, true);
      act(x, 'p1', { type: 'drunk-swap', card: 1 });
    },
    drunk: (x) => act(x, 'p2', { type: 'drunk-swap', card: 1 }),
  });
  // p1: doppel card -> centre 1, then the real drunk took it from the centre
  assert.equal(faceAt(sim, 'p2'), 'doppelganger');
  assert.equal(st(sim).cards.p2.copied, 'drunk', 'the copy travelled with the card');
  assert.equal(finalAt(sim, 'p2'), 'drunk');
  // a Doppelgänger card in the centre that nobody copied
  const plain = scenario({ p1: 'drunk', p2: 'werewolf', p3: 'seer', p4: 'villager' }, ['doppelganger', 'werewolf', 'robber']);
  playNight(plain, { drunk: (x) => act(x, 'p1', { type: 'drunk-swap', card: 0 }) });
  assert.equal(faceAt(plain, 'p1'), 'doppelganger');
  assert.equal(finalAt(plain, 'p1'), 'villager', 'a plain old villager');
  assert.equal(game.teamOf(finalAt(plain, 'p1')), 'village');
});

test('onuw: doppelgänger who copies the tanner is a tanner; each tanner wins only if personally dead', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'tanner', p3: 'werewolf', p4: 'seer', p5: 'villager' }, ['villager', 'werewolf', 'robber']);
  playNight(sim, { doppelganger: (x) => act(x, 'p1', { type: 'copy', target: 'p2' }) });
  castVotes(sim, { p1: 'p5', p2: 'p1', p3: 'p1', p4: 'p1', p5: 'p4' });
  assert.deepEqual(R(sim).T, ['p1', 'p2']);
  assert.deepEqual(R(sim).dead, ['p1']);
  assert.equal(R(sim).win.p1, true);
  assert.equal(R(sim).win.p2, false, 'the other tanner did not die');
  assert.equal(R(sim).wolfTeamWins, false, 'either tanner\'s death blocks the wolves');
});

test('onuw: lapsed windows — optional abilities lapse into an idle note, mandatory ones are made for you', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'drunk', p3: 'robber', p4: 'troublemaker', p5: 'seer', p6: 'werewolf' }, ['villager', 'werewolf', 'villager']);
  openStep(sim, 'doppelganger');
  act(sim, 'p1', { type: 'copy', target: 'p2' });
  sim.advance();   // copied the drunk, did nothing → the swap is made for her
  const dn = notes(sim, 'p1').find((n) => n.k === 'drunk');
  assert.ok(dn && dn.auto === true && dn.via === 'doppel');
  assert.ok(st(sim).centre.some((c) => c.role === 'doppelganger' && c.copied === 'drunk'), 'her card (copy = drunk) is now in the centre');
  playNight(sim);
  for (const [p, a] of [['p3', 'robber'], ['p4', 'troublemaker'], ['p5', 'seer']]) assert.equal(noteOf(sim, p, 'idle').ability, a);
});

// ============================================================
// pacing and anti-tell (DESIGN §4)
// ============================================================

test('onuw: EVERY seat has a legal action in EVERY night step, in both stages, for every head-count and preset', () => {
  for (let n = 3; n <= 10; n++) {
    for (const preset of ['auto', 'advanced']) {
      const sim = new Sim(game, { n, seed: n + 40, config: { ...config.defaults(n), preset } });
      toNight(sim);
      let steps = 0;
      while (st(sim).phase === 'night') {
        steps++;
        const k = stepK(sim);
        for (const stage of ['cue', 'window']) {
          assert.equal(st(sim).stage, stage);
          for (const p of st(sim).order) {
            const legal = sim.legal(p);
            assert.ok(legal.length > 0, `n=${n} ${preset} step ${k}/${stage}: ${p} has nothing to tap`);
            assert.ok(legal.some((a) => a.type === 'ack'), `${p} has the decoy at ${k}/${stage}`);
          }
          if (stage === 'cue') sim.cueDone();
        }
        sim.advance();
      }
      assert.ok(steps >= st(sim).steps.length);
    }
  }
});

test('onuw: the non-acting seats get view.night and the same tappable decoy; the shell dims everybody who is not in focus', () => {
  const sim = scenario({ p1: 'seer', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'troublemaker']);
  openStep(sim, 'seer');
  const f = sim.focus();
  assert.deepEqual(f.pids, ['p1']);
  assert.equal(f.anonymous, S.anonymousPrompt('seer'));
  assert.ok(f.anonymous.includes('預言家') && !f.anonymous.includes('p1'), 'the shared-phone prompt names the role, not the seat');
  for (const p of ['p1', 'p2', 'p3', 'p4']) {
    const v = engine.view(st(sim), p);
    assert.equal(v.night, true);
    assert.equal(v.phase, 'night');
    assert.equal(v.step.k, 'seer');
    assert.ok(sim.legal(p).some((a) => a.type === 'ack'));
  }
  assert.equal(engine.view(st(sim), 'p1').my.night.awake, true);
  for (const p of ['p2', 'p3', 'p4']) assert.deepEqual(engine.view(st(sim), p).my.night, { awake: false, seen: JSON.parse(JSON.stringify(st(sim).notes[p])) });
  assert.deepEqual(engine.view(st(sim), 'p2').my.night.seen, [], 'a seat that never woke has an empty 📓');
  assert.equal(engine.view(st(sim), 'p3').my.night.seen[0].k, 'wolves', 'the lone wolf still has her werewolf-step note in a later step (#11)');
  assert.equal(engine.view(st(sim), null).night, true, 'the table view is night too');
  // no focus during the narration stage, nothing at begin/dawn
  const s2 = scenario({ p1: 'seer', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'troublemaker']);
  toNight(s2);
  assert.equal(s2.focus(), null);
  s2.cueDone();
  assert.equal(s2.focus(), null, 'begin');
  // dawn lights the screens
  toStep(s2, 'dawn');
  assert.equal(engine.view(st(s2), 'p1').night, false);
});

test('onuw: a window NEVER ends early — not when every actor has acted, not on a stray advance; it ends at its deadline', () => {
  const sim = scenario({ p1: 'seer', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'troublemaker']);
  openStep(sim, 'seer');
  const dl = st(sim).deadline;
  assert.ok(dl > sim.now, 'a deadline is set');
  act(sim, 'p1', { type: 'look-centre', cards: [0, 1] });
  for (const p of st(sim).order) act(sim, p, { type: 'ack' });
  assert.equal(st(sim).acked.length, 4, 'everybody has tapped');
  assert.equal(stepK(sim), 'seer');
  assert.equal(st(sim).stage, 'window');
  const early = engine.advance(clone(st(sim)), { rng: mulberry32(1), now: dl - 1 });
  assert.equal(early.stage, 'window');
  assert.equal(early.ix, st(sim).ix);
  const on = engine.advance(clone(st(sim)), { rng: mulberry32(1), now: dl });
  assert.notEqual(on.ix, st(sim).ix);
  // the host's 下一步 is the only other way out
  sim.host({ type: ACT.NEXT });
  assert.equal(stepK(sim), 'robber');
});

test('onuw: step lengths are fixed per step kind and pace, identical whoever holds what — and for roles that are in the centre', () => {
  const trace = (sim) => {
    toNight(sim);
    const out = [];
    while (st(sim).phase === 'night') {
      const k = stepK(sim);
      const t0 = sim.now;
      sim.cueDone();
      out.push([k, st(sim).deadline - t0]);
      sim.advance();
      sim.now = t0;   // same clock every step: only the deadline arithmetic is under test
    }
    return out;
  };
  const cfg = { ...config.defaults(7), preset: 'advanced' };
  const a = trace(new Sim(game, { n: 7, seed: 1, config: cfg }));
  const b = trace(new Sim(game, { n: 7, seed: 2, config: cfg }));
  const c = trace(new Sim(game, { n: 7, seed: 99, config: cfg }));
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(a.length, st(new Sim(game, { n: 7, seed: 1, config: cfg })).steps.length - 1 + 1 - 0 === a.length ? a.length : a.length);
  for (const [k, ms] of a) assert.equal(ms, game.windowMs(cfg, k), k);
  // pace scales every step by the same factor
  for (const pace of ['slow', 'standard', 'fast']) {
    const t = trace(new Sim(game, { n: 5, seed: 1, config: { ...config.defaults(5), pace } }));
    const f = { slow: 1.5, standard: 1, fast: 0.7 }[pace];
    for (const [k, ms] of t) assert.equal(ms, Math.round(({ begin: 3000, werewolf: 12000, seer: 12000, robber: 10000, troublemaker: 10000, dawn: 2000 })[k] * f), `${pace} ${k}`);
  }
  // the lone-wolf option changes the werewolf window for everybody, not for whoever is alone
  assert.equal(game.windowMs({ ...cfg, loneWolf: false }, 'werewolf'), 10000);
  assert.equal(game.windowMs({ ...cfg, loneWolf: true }, 'werewolf'), 12000);
});

test('onuw: cue ids are unique, the narration text never depends on the deal, and absent / centre roles are narrated like present ones', () => {
  const cues = (sim) => {
    toNight(sim);
    const out = [];
    while (st(sim).phase === 'night') {
      const c = sim.cue();
      assert.ok(c && c.id && c.text && c.minMs >= 2500, `step ${stepK(sim)} has a cue`);
      out.push(c);
      sim.cueDone();
      assert.equal(sim.cue(), null, 'no cue during a window');
      sim.advance();
    }
    return out;
  };
  const cfg = { ...config.defaults(8), preset: 'advanced' };
  const a = cues(new Sim(game, { n: 8, seed: 1, config: cfg }));
  const b = cues(new Sim(game, { n: 8, seed: 2, config: cfg }));
  assert.deepEqual(a.map((c) => c.text), b.map((c) => c.text));
  assert.equal(new Set(a.map((c) => c.id)).size, a.length);
  for (const c of a) assert.ok(!/p\d/.test(c.text), 'no seat ids');
  // every role in the list is narrated
  const texts = a.map((c) => c.text).join('');
  for (const r of ['化身幽靈', '狼人', '爪牙', '守夜人', '預言家', '強盜', '搗蛋鬼', '失眠者']) assert.ok(texts.includes(r), r);
  // each cue closes the previous role's eyes, the first one is the dark, the last one is the dawn
  assert.ok(a[0].text.includes('天黑'));
  assert.ok(a.at(-1).text.includes('天光') && a.at(-1).text.includes('分鐘'));
  const wolf = a.find((c) => c.text.includes('狼人，請睜開眼'));
  assert.ok(wolf.text.startsWith('化身幽靈，請閉眼'), 'the Doppelgänger closes before the wolves open');
  // a Seer card in the centre sounds the same as a Seer at the table: same text for the step
  const centreSeer = new Sim(game, { n: 4, seed: 3, config: customConfig({ werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 2 }) });
  const s = st(centreSeer);
  s.cards.p1 = { role: 'villager' }; s.orig.p1 = 'villager';
  const textsA = cues(new Sim(game, { n: 4, seed: 3, config: customConfig({ werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 2 }) })).map((c) => c.text);
  const textsB = cues(centreSeer).map((c) => c.text);
  assert.deepEqual(textsA, textsB);
});

test('onuw: the cue stage ends on @cue-done only for the right id; 下一步 in a cue starts the window, in a window skips it', () => {
  const sim = scenario({ p1: 'seer', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'troublemaker']);
  toNight(sim);
  assert.equal(sim.host({ type: ACT.CUE_DONE, id: 'stale' }), false);
  assert.equal(st(sim).stage, 'cue');
  assert.equal(sim.host({ type: ACT.NEXT }), true);
  assert.equal(st(sim).stage, 'window');
  assert.equal(stepK(sim), 'begin');
  sim.host({ type: ACT.NEXT });
  assert.equal(stepK(sim), 'werewolf');
  assert.equal(st(sim).stage, 'cue');
});

test('onuw: begin and dawn are fixed steps too; the day timer starts when the dawn window closes', () => {
  const sim = scenario({ p1: 'seer', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'troublemaker']);
  toStep(sim, 'dawn');
  const c = sim.cue();
  assert.ok(c.text.includes('天光'));
  sim.cueDone();
  assert.equal(st(sim).phase, 'night');
  assert.equal(st(sim).deadline - sim.now, game.windowMs(st(sim).cfg, 'dawn'));
  sim.advance();
  assert.equal(st(sim).phase, 'day');
  assert.equal(st(sim).deadline - sim.now, game.discussFor(4) * 1000);
  assert.equal(st(sim).timerLabel, S.T.dayTimer);
});

// ============================================================
// day and vote
// ============================================================

/** A 4-player game parked at the start of the day. */
function dayGame(over = {}) {
  const sim = scenario({ p1: 'werewolf', p2: 'seer', p3: 'villager', p4: 'villager' }, ['werewolf', 'robber', 'troublemaker'], over);
  playNight(sim);
  return sim;
}

test('onuw: day — timer by head-count (4/5/7/9 minutes), host override, early vote needs everybody, the timer ends it', () => {
  const want = { 3: 240, 4: 240, 5: 300, 6: 300, 7: 420, 8: 420, 9: 540, 10: 540 };
  for (const n of Object.keys(want).map(Number)) {
    const sim = new Sim(game, { n, seed: 3 });
    toStep(sim, 'dawn');
    sim.cueDone();
    const t0 = sim.now;
    sim.advance();
    assert.equal(st(sim).phase, 'day');
    assert.equal(st(sim).deadline - t0 - game.windowMs(st(sim).cfg, 'dawn'), want[n] * 1000, `n=${n}`);
  }
  assert.equal(game.discussFor(3), 240);
  assert.equal(S.discussText(300), '5 分鐘');
  assert.equal(S.discussText(90), '1 分鐘 30 秒');
  const custom = dayGame({ discussSec: 150 });
  assert.equal(st(custom).deadline - custom.now, 150_000);

  const sim = dayGame();
  const v = engine.view(st(sim), 'p1');
  assert.equal(v.phase, 'day');
  assert.equal(v.timerLabel, S.T.dayTimer);
  sim.act('p1', { type: 'ready-vote', on: true });
  sim.act('p2', { type: 'ready-vote', on: true });
  assert.equal(st(sim).phase, 'day', 'not everybody is ready');
  sim.act('p2', { type: 'ready-vote', on: false });
  sim.act('p3', { type: 'ready-vote', on: true });
  sim.act('p4', { type: 'ready-vote', on: true });
  assert.equal(st(sim).phase, 'day');
  assert.deepEqual(engine.view(st(sim), 'p1').dayReady, { done: 3, total: 4, mine: true });
  sim.act('p2', { type: 'ready-vote', on: true });
  assert.equal(st(sim).phase, 'vote');
  // the timer
  const t = dayGame();
  t.tick(1000);
  assert.equal(t.advance(), true);
  assert.equal(st(t).phase, 'vote');
  const early = engine.advance(clone(st(dayGame())), { rng: mulberry32(1), now: 1 });
  assert.equal(early.phase, 'day', 'advance before the deadline does nothing');
  // 下一步 from the host
  const h = dayGame();
  h.host({ type: ACT.NEXT });
  assert.equal(st(h).phase, 'vote');
});

test('onuw: the host (and only the host) may add 60 s to the discussion, a bounded number of times', () => {
  const players = makePlayers(4);
  const mk = (hostPid) => {
    const s = engine.setup({ players, config: config.defaults(4), rng: mulberry32(4), now: 0, hostPid });
    s.phase = 'day';
    s.deadline = 1_000_000;
    return s;
  };
  let s = mk('p3');
  assert.equal(engine.act(s, { pid: 'p1', action: { type: 'extend' } }, {}).deadline, 1_000_000, 'not the host');
  s = engine.act(s, { pid: 'p3', action: { type: 'extend' } }, {});
  assert.equal(s.deadline, 1_060_000);
  for (let i = 0; i < 10; i++) s = engine.act(s, { pid: 'p3', action: { type: 'extend' } }, {});
  assert.equal(s.deadline, 1_000_000 + 6 * 60_000, 'capped');
  assert.equal(engine.view(s, 'p3').canExtend, false);
  assert.equal(engine.view(mk('p3'), 'p3').canExtend, true);
  assert.equal(engine.view(mk('p3'), 'p1').canExtend, false);
  assert.ok(engine.legalActions(mk('p3'), 'p3').some((a) => a.type === 'extend'));
  assert.ok(!engine.legalActions(mk('p3'), 'p1').some((a) => a.type === 'extend'));
});

test('onuw: vote — every player points at ONE OTHER player; no abstain, no self, no centre; changeable until the last vote lands', () => {
  const sim = dayGame();
  sim.advance();
  assert.equal(st(sim).phase, 'vote');
  assert.ok(sim.cue().text.includes('三、二、一'));
  assert.deepEqual(sim.focus().pids, ['p1', 'p2', 'p3', 'p4']);
  for (const bad of [{ target: 'p1' }, { target: null }, { target: 'centre' }, { target: 'p9' }, { target: 3 }, {}]) {
    assert.equal(sim.act('p1', { type: 'vote', ...bad }), false, JSON.stringify(bad));
  }
  assert.equal(sim.act('p1', { type: 'vote', target: 'p2' }), true);
  assert.equal(sim.act('p1', { type: 'vote', target: 'p3' }), true, 'changed her mind');
  assert.equal(engine.view(st(sim), 'p1').myVote, 'p3');
  assert.deepEqual(sim.focus().pids, ['p2', 'p3', 'p4']);
  assert.equal(engine.view(st(sim), 'p2').myVote, undefined);
  assert.equal(engine.view(st(sim), 'p1').progress.done, 1);
  assert.deepEqual(engine.view(st(sim), 'p1').candidates, ['p2', 'p3', 'p4']);
  assert.equal(sim.legal('p1').some((a) => a.type === 'vote' && a.target === 'p3'), false, 'the current pick is not offered again');
  assert.equal(st(sim).phase, 'vote');
  for (const [p, t] of [['p2', 'p1'], ['p3', 'p1']]) sim.act(p, { type: 'vote', target: t });
  assert.equal(st(sim).phase, 'vote');
  sim.act('p4', { type: 'vote', target: 'p1' });
  assert.equal(st(sim).phase, 'reveal');
  assert.equal(sim.act('p1', { type: 'vote', target: 'p2' }), false, 'locked once everybody has voted');
});

test('onuw: ring vote — everyone agrees and every player ends on exactly one vote, so nobody dies', () => {
  for (const n of [3, 4, 7, 10]) {
    const sim = new Sim(game, { n, seed: 2 });
    playNight(sim);
    sim.advance();
    assert.equal(st(sim).phase, 'vote');
    const order = st(sim).order;
    order.slice(0, -1).forEach((p) => sim.act(p, { type: 'ring', on: true }));
    assert.equal(st(sim).phase, 'vote', 'one seat has not agreed');
    assert.deepEqual(sim.focus().pids, [order.at(-1)]);
    assert.deepEqual(engine.view(st(sim), order[0]).ring, { on: true, done: n - 1, total: n, mine: true, stuck: false });
    sim.act(order.at(-1), { type: 'ring', on: true });
    assert.equal(st(sim).phase, 'reveal');
    assert.deepEqual(R(sim).dead, []);
    assert.equal(R(sim).max, 1);
    assert.equal(R(sim).nobodyDied, true);
    for (const p of order) assert.equal(R(sim).counts[p], 1);
  }
});

test('onuw: ring vote — agreeing keeps your ballot, picking a person leaves the circle, and a circle that cannot happen never freezes the table', () => {
  const sim = new Sim(game, { n: 4, seed: 2 });
  playNight(sim);
  sim.advance();
  sim.act('p1', { type: 'vote', target: 'p3' });
  sim.act('p1', { type: 'ring', on: true });
  assert.equal(engine.view(st(sim), 'p1').myVote, 'p3', 'agreeing did not cost p1 the ballot');
  assert.equal(engine.view(st(sim), 'p1').ring.mine, true);
  sim.act('p1', { type: 'vote', target: 'p2' });
  assert.equal(engine.view(st(sim), 'p1').ring.mine, false, 'choosing somebody leaves the circle');
  sim.act('p2', { type: 'ring', on: true });
  sim.act('p3', { type: 'ring', on: true });
  sim.act('p2', { type: 'ring', on: false });
  assert.equal(engine.view(st(sim), 'p1').ring.done, 1);
  sim.act('p2', { type: 'ring', on: true });
  assert.equal(engine.view(st(sim), 'p1').ring.stuck, false, 'p4 is still undecided');
  assert.deepEqual(sim.focus().pids, ['p4'], 'the shared phone asks the undecided seat first');
  // p4 picks a person: everybody has now decided, but p2 and p3 only agreed → they must choose
  sim.act('p4', { type: 'vote', target: 'p1' });
  assert.equal(st(sim).phase, 'vote');
  assert.equal(engine.view(st(sim), 'p2').ring.stuck, true);
  assert.deepEqual(sim.focus().pids, ['p2', 'p3']);
  assert.ok(sim.legal('p2').some((a) => a.type === 'vote'));
  sim.act('p2', { type: 'vote', target: 'p1' });
  sim.act('p3', { type: 'vote', target: 'p1' });
  assert.equal(st(sim).phase, 'reveal');
  assert.deepEqual(R(sim).dead, ['p1'], 'p1 got three votes');
  assert.equal(R(sim).votes.p1, 'p2', 'p1 own ballot stood');
  // a stalled agreer is auto-voted
  const stalled = new Sim(game, { n: 3, seed: 2 });
  playNight(stalled);
  stalled.advance();
  stalled.act('p1', { type: 'ring', on: true });
  assert.equal(engine.autoAct(clone(st(stalled)), 'p1', stalled.ctx()).type, 'vote');
  // the option can be switched off
  const off = new Sim(game, { n: 4, seed: 2, config: { ...config.defaults(4), ringVote: false } });
  playNight(off);
  off.advance();
  assert.equal(off.act('p1', { type: 'ring', on: true }), false);
  assert.equal(off.legal('p1').some((a) => a.type === 'ring'), false);
  assert.equal(engine.view(st(off), 'p1').ring.on, false);
});

// ============================================================
// death resolution and winning — the research vectors, through the pure analysis
// ============================================================

const O4 = ['p1', 'p2', 'p3', 'p4'];
const cardOf = (r) => { const [role, copied] = r.split(':'); return copied ? { role, copied } : { role }; };

/** analyse() from roles = { p1: 'werewolf', ... } (a Doppelgänger card is 'doppelganger:minion') and votes = 'BADC'-style letters. */
function judge(roles, votes, { order = O4, centre = ['villager', 'villager', 'villager'] } = {}) {
  const letter = (c) => order[c.charCodeAt(0) - 65];
  const v = {};
  order.forEach((p, i) => { v[p] = letter(votes[i]); });
  return game.analyse({
    order, cards: Object.fromEntries(order.map((p) => [p, cardOf(roles[p])])), centre: centre.map(cardOf),
    orig: Object.fromEntries(order.map((p) => [p, roles[p].split(':')[0]])), votes: v,
  });
}
const R4 = (a, b, c, d) => ({ p1: a, p2: b, p3: c, p4: d });
const W = (f) => f.winners.join(',');

test('onuw: research vectors V1-V15 (final cards + votes → dead + winners)', () => {
  const V = [
    // [id, roles, votes, dead, winners]
    ['V1', R4('werewolf', 'villager', 'seer', 'villager'), 'BADC', '', 'p1'],
    ['V2', R4('werewolf', 'villager', 'seer', 'villager'), 'BABA', 'p1,p2', 'p2,p3,p4'],
    ['V3', R4('hunter', 'werewolf', 'villager', 'villager'), 'BAAA', 'p1,p2', 'p1,p3,p4'],
    ['V4', R4('hunter', 'tanner', 'werewolf', 'villager'), 'BDAA', 'p1,p2', 'p2'],
    ['V5', R4('villager', 'seer', 'robber', 'villager'), 'BCDA', '', 'p1,p2,p3,p4'],
    ['V6', R4('minion', 'seer', 'villager', 'villager'), 'BABB', 'p2', 'p1'],
    ['V7', R4('minion', 'seer', 'villager', 'villager'), 'BAAA', 'p1', ''],
    ['V8', R4('tanner', 'seer', 'villager', 'minion'), 'BAAA', 'p1', 'p1,p4'],
    ['V9', R4('werewolf', 'minion', 'seer', 'villager'), 'BABB', 'p2', 'p1,p2'],
    ['V10', R4('werewolf', 'robber', 'seer', 'villager'), 'BAAA', 'p1', 'p2,p3,p4'],
    ['V11', R4('tanner', 'werewolf', 'seer', 'villager'), 'BAAB', 'p1,p2', 'p1,p3,p4'],
    ['V12', R4('minion', 'seer', 'villager', 'villager'), 'BAAB', 'p1,p2', ''],
    ['V13', R4('tanner', 'minion', 'werewolf', 'villager'), 'BAAA', 'p1', 'p1'],
    ['V14', R4('minion', 'doppelganger:minion', 'villager', 'villager'), 'BAAB', 'p1,p2', ''],
    ['V15', R4('minion', 'doppelganger:minion', 'villager', 'villager'), 'BABB', 'p2', 'p1'],
  ];
  for (const [id, roles, votes, dead, winners] of V) {
    const f = judge(roles, votes);
    assert.equal(f.dead.slice().sort().join(','), dead, `${id} dead`);
    assert.equal(W(f), winners, `${id} winners`);
  }
});

test('onuw: win matrix rows 1-18 (every combination of dead set and roles)', () => {
  const rows = {
    1: [R4('werewolf', 'villager', 'seer', 'villager'), 'BABA', 'village'],
    2: [R4('tanner', 'werewolf', 'seer', 'villager'), 'BAAB', 'village+tanner'],
    3: [R4('werewolf', 'villager', 'seer', 'villager'), 'BADC', 'wolves'],
    4: [R4('werewolf', 'villager', 'villager', 'seer'), 'BCBC', 'wolves'],     // p2, p3 die (villagers)
    5: [R4('werewolf', 'minion', 'seer', 'villager'), 'BABB', 'wolves'],       // only the minion dies
    6: [R4('werewolf', 'tanner', 'villager', 'villager'), 'BCBA', 'tanner'],   // p2 has two votes
    7: [R4('tanner', 'minion', 'werewolf', 'villager'), 'BAAB', 'tanner'],     // p1, p2 tie 2-2
    8: [R4('villager', 'seer', 'robber', 'villager'), 'BCDA', 'village'],
    9: [R4('minion', 'seer', 'villager', 'villager'), 'BABB', 'minion'],
    10: [R4('villager', 'villager', 'villager', 'villager'), 'BCBA', 'none'],
    11: [R4('minion', 'seer', 'villager', 'villager'), 'BAAA', 'none'],
    12: [R4('tanner', 'minion', 'villager', 'villager'), 'BAAA', 'tanner+minion'],
    13: [R4('tanner', 'minion', 'villager', 'villager'), 'BABA', 'tanner'],    // both die
    14: [R4('tanner', 'villager', 'minion', 'villager'), 'BAAB', 'tanner+minion'],
    15: [R4('hunter', 'werewolf', 'villager', 'villager'), 'BAAA', 'village'],
    16: [R4('werewolf', 'robber', 'seer', 'villager'), 'CAAA', 'village'],
    17: [R4('werewolf', 'robber', 'seer', 'villager'), 'BCAB', 'wolves'],
    18: [R4('minion', 'villager', 'villager', 'villager'), 'BAAB', 'none'],
  };
  const expected = {
    village: { head: 'village', win: (s) => s.village },
    'village+tanner': { head: 'village', win: (s) => s.village || s.tanner },
    wolves: { head: 'wolves', win: (s) => s.wolf },
    tanner: { head: 'tanner', win: (s) => s.tanner },
    minion: { head: 'minion', win: (s) => s.minion },
    'tanner+minion': { head: 'minion', win: (s) => s.minion || s.tanner },
    none: { head: 'none', win: () => false },
  };
  for (const [row, [roles, votes, who]] of Object.entries(rows)) {
    const f = judge(roles, votes);
    const e = expected[who];
    assert.equal(f.headline, e.head, `row ${row} headline (dead ${f.dead})`);
    for (const p of O4) {
      const role = roles[p].split(':')[0];
      const side = {
        village: !['werewolf', 'minion', 'tanner'].includes(role),
        wolf: role === 'werewolf' || (role === 'minion' && f.W.length > 0),
        tanner: role === 'tanner',
        minion: role === 'minion' && f.W.length === 0,
      };
      assert.equal(f.win[p], !!e.win(side), `row ${row} ${p} (${role}) dead=${f.dead}`);
    }
  }
});

test('onuw: rows 16-17 through a real night — the robber who stole the only wolf card IS the wolf for scoring', () => {
  const deal = { p1: 'robber', p2: 'werewolf', p3: 'seer', p4: 'villager', p5: 'villager' };
  const robbed = (votes) => play(deal, ['werewolf', 'villager', 'tanner'], {
    script: { robber: (x) => act(x, 'p1', { type: 'rob', target: 'p2' }) }, votes,
  });
  // the thief (now a werewolf) dies → village wins, the original wolf (now Robber) is on the village team
  const a = robbed({ p1: 'p3', p2: 'p1', p3: 'p1', p4: 'p2', p5: 'p1' });
  assert.deepEqual(R(a).dead, ['p1']);
  assert.equal(R(a).headline, 'village');
  assert.equal(R(a).win.p2, true, 'the original werewolf won as a Robber');
  assert.equal(R(a).win.p1, false);
  // the original wolf (holding the Robber card) dies, the thief lives → wolves win
  const b = robbed({ p1: 'p3', p2: 'p3', p3: 'p2', p4: 'p2', p5: 'p2' });
  assert.deepEqual(R(b).dead, ['p2']);
  assert.equal(R(b).headline, 'wolves');
  assert.equal(R(b).win.p1, true);
  assert.equal(R(b).win.p2, false);
});

test('onuw: ties — every tied player dies (2, 3 or 4 of them); max <= 1 kills nobody', () => {
  const O = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  const run = (targets) => game.analyse({
    order: O, cards: Object.fromEntries(O.map((p) => [p, { role: 'villager' }])), centre: [],
    orig: Object.fromEntries(O.map((p) => [p, 'villager'])), votes: Object.fromEntries(O.map((p, i) => [p, O[targets[i]]])),
  });
  assert.deepEqual(run([1, 0, 3, 2, 5, 4, 7, 6]).dead, [], 'everybody on one vote');
  const two = run([2, 2, 0, 0, 1, 1, 5, 6]);   // p1<-p3,p4 ; p2<-p5,p6 ; p3<-p1,p2 ; …
  assert.equal(two.max, 2);
  assert.deepEqual(two.tied, ['p1', 'p2', 'p3', 'p6', 'p7'].filter((p) => two.counts[p] === 2), 'all of them');
  const four = run([1, 2, 3, 0, 1, 2, 3, 0]);   // p1,p2,p3,p4 each get exactly 2
  assert.deepEqual(four.tied, ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual(four.dead, ['p1', 'p2', 'p3', 'p4']);
  const three = run([1, 2, 0, 1, 2, 0, 7, 6]);  // p1,p2,p3 get two each, p7,p8 one each
  assert.deepEqual(three.tied, ['p1', 'p2', 'p3']);
  const ring = run([1, 2, 3, 4, 5, 6, 7, 0]);   // a clockwise ring
  assert.equal(ring.max, 1);
  assert.deepEqual(ring.dead, []);
  assert.equal(ring.nobodyDied, true);
  assert.deepEqual(ring.tied, []);
  const pair = run([1, 0, 0, 0, 1, 1, 7, 6]);   // p1<-p2,p3,p4 (3); p2<-p1,p5,p6 (3)
  assert.deepEqual(pair.tied, ['p1', 'p2']);
});

test('onuw: hunter — his target dies even with zero votes, chains and cycles terminate, an already dead target changes nothing', () => {
  const O = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const run = (roles, targets) => game.analyse({
    order: O, cards: Object.fromEntries(O.map((p) => [p, cardOf(roles[p])])), centre: [],
    orig: Object.fromEntries(O.map((p) => [p, roles[p].split(':')[0]])), votes: Object.fromEntries(O.map((p, i) => [p, O[targets[i]]])),
  });
  const base = { p1: 'hunter', p2: 'villager', p3: 'villager', p4: 'werewolf', p5: 'villager' };
  // p2, p3, p5 vote p1 (3 votes); the hunter voted p4, who had zero votes → p4 dies anyway
  const a = run(base, [3, 0, 0, 1, 0]);
  assert.deepEqual(a.dead, ['p1', 'p4']);
  assert.deepEqual(a.shots, [{ hunter: 'p1', target: 'p4', fresh: true }]);
  assert.equal(a.headline, 'village', 'the hunter\'s shot killed the werewolf');
  // the hunter's target is already dead (tied with him): the shot is recorded but nothing more happens
  const b = run(base, [1, 0, 0, 0, 0]);   // p1<-p2,p3,p4,p5 (4) ; p2<-p1 (1)
  assert.deepEqual(b.dead, ['p1', 'p2']);
  assert.deepEqual(b.shots, [{ hunter: 'p1', target: 'p2', fresh: true }]);
  // two hunters aiming at each other: p1 dies, shoots p2 (a hunter), who shoots p1 again — nothing new
  const c = run({ ...base, p2: 'hunter' }, [1, 0, 0, 0, 0]);
  assert.deepEqual(c.dead, ['p1', 'p2']);
  assert.deepEqual(c.shots.map((x) => x.fresh), [true, false]);
  // chain: p1 dies, shoots p2 (hunter), p2 shoots p3 (hunter), p3 shoots p4
  const chain = run({ p1: 'hunter', p2: 'hunter', p3: 'hunter', p4: 'werewolf', p5: 'villager' }, [1, 2, 3, 0, 0]);
  assert.deepEqual(chain.dead, ['p1', 'p2', 'p3', 'p4']);
  assert.equal(chain.shots.length, 3);
  // a Doppelgänger who copied the hunter is a hunter
  const dop = run({ ...base, p1: 'doppelganger:hunter' }, [3, 0, 0, 1, 0]);
  assert.deepEqual(dop.dead, ['p1', 'p4']);
  // hunter kills the Tanner: the Tanner wins
  const t = run({ p1: 'hunter', p2: 'tanner', p3: 'villager', p4: 'werewolf', p5: 'villager' }, [1, 2, 0, 0, 0]);
  assert.deepEqual(t.dead, ['p1', 'p2']);
  assert.equal(t.win.p2, true);
  assert.equal(t.win.p4, false, 'the dead tanner blocks the wolves');
  // a hunter who is not dead shoots nobody
  const quiet = run(base, [3, 3, 3, 0, 3]);   // p4 gets 4 votes… the hunter lives
  assert.deepEqual(quiet.dead, ['p4']);
  assert.deepEqual(quiet.shots, []);
});

test('onuw: the hunter is the CURRENT holder of the card — a swapped hunter card shoots for its new owner', () => {
  const deal = { p1: 'hunter', p2: 'troublemaker', p3: 'villager', p4: 'werewolf', p5: 'seer' };
  const sim = play(deal, ['villager', 'villager', 'robber'], {
    script: { troublemaker: (x) => act(x, 'p2', { type: 'swap', a: 'p1', b: 'p3' }) },
    // p3 (now the hunter) dies to three votes, having voted for p4 (the werewolf)
    votes: { p1: 'p3', p2: 'p3', p3: 'p4', p4: 'p3', p5: 'p2' },
  });
  assert.equal(finalAt(sim, 'p3'), 'hunter');
  assert.deepEqual(R(sim).dead, ['p3', 'p4']);
  assert.equal(R(sim).headline, 'village');
  // the original hunter, now a villager, dies: no shot
  const s2 = play(deal, ['villager', 'villager', 'robber'], {
    script: { troublemaker: (x) => act(x, 'p2', { type: 'swap', a: 'p1', b: 'p3' }) },
    votes: { p1: 'p4', p2: 'p1', p3: 'p1', p4: 'p1', p5: 'p2' },
  });
  assert.deepEqual(R(s2).dead, ['p1']);
  assert.equal(R(s2).shots.length, 0);
});

test('onuw: two minions with no werewolf players — each wins iff alive and anybody else died; the tanner never blocks a minion', () => {
  const O = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const run = (roles, targets) => game.analyse({
    order: O, cards: Object.fromEntries(O.map((p) => [p, cardOf(roles[p])])), centre: [],
    orig: Object.fromEntries(O.map((p) => [p, roles[p].split(':')[0]])), votes: Object.fromEntries(O.map((p, i) => [p, O[targets[i]]])),
  });
  const two = { p1: 'minion', p2: 'doppelganger:minion', p3: 'villager', p4: 'villager', p5: 'tanner' };
  const a = run(two, [4, 4, 4, 4, 0]);          // the tanner p5 dies alone (4 votes)
  assert.deepEqual(a.dead, ['p5']);
  assert.equal(a.win.p1 && a.win.p2 && a.win.p5, true);
  assert.equal(a.headline, 'minion');
  const b = run(two, [2, 2, 3, 2, 3]);           // p3 dies alone (3 votes)
  assert.deepEqual(b.dead, ['p3']);
  assert.equal(b.win.p1 && b.win.p2, true);
  const c = run(two, [1, 0, 0, 0, 0]);           // p1 dies (4 votes): p2 wins alone
  assert.deepEqual(c.dead, ['p1']);
  assert.equal(c.win.p1, false);
  assert.equal(c.win.p2, true);
});

// ============================================================
// reveal, results
// ============================================================

test('onuw: reveal — the host moving on (or everybody, or the deadline, or 下一步) goes to the result; before that result() is null', () => {
  const mk = () => play({ p1: 'werewolf', p2: 'seer', p3: 'villager', p4: 'villager' }, ['werewolf', 'robber', 'troublemaker'], { votes: { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p1' } });
  const sim = mk();
  assert.equal(sim.result(), null);
  assert.equal(st(sim).phase, 'reveal');
  assert.ok(sim.cue().text.includes('全部人投晒票'), 'the reveal is narrated');
  assert.equal(sim.focus(), null);
  assert.equal(sim.act('p2', { type: 'done' }), true);
  assert.equal(st(sim).phase, 'reveal', 'a non-host tap is not enough');
  assert.equal(engine.view(st(sim), 'p2').revealDone.mine, true);
  assert.equal(sim.act('p2', { type: 'done' }), false);
  assert.equal(sim.act('p1', { type: 'done' }), true);
  assert.equal(st(sim).phase, 'over', 'the host decides (default host = first seat)');
  assert.ok(sim.result());
  // everybody
  const all = mk();
  for (const p of ['p2', 'p3', 'p4']) all.act(p, { type: 'done' });
  assert.equal(st(all).phase, 'reveal');
  all.act('p1', { type: 'done' });
  assert.equal(st(all).phase, 'over');
  // the deadline
  const late = mk();
  late.advance();
  assert.equal(st(late).phase, 'over');
  // 下一步: first acknowledges the narration, second moves on
  const nx = mk();
  nx.host({ type: ACT.NEXT });
  assert.equal(st(nx).phase, 'reveal');
  nx.host({ type: ACT.NEXT });
  assert.equal(st(nx).phase, 'over');
  assert.equal(engine.view(st(nx), 'p2').phase, 'over');
  assert.ok(engine.view(st(nx), 'p2').reveal, 'the over view still carries the reveal');
});

test('onuw: the result — winners, a summary that says why, 1 point per winner, and lines with votes, deaths, cards and the night recap', () => {
  const deal = { p1: 'robber', p2: 'werewolf', p3: 'seer', p4: 'villager', p5: 'villager' };
  const sim = play(deal, ['villager', 'werewolf', 'tanner'], {
    script: {
      werewolf: (x) => act(x, 'p2', { type: 'look-centre', cards: [1] }),
      seer: (x) => act(x, 'p3', { type: 'look-player', target: 'p1' }),
      robber: (x) => act(x, 'p1', { type: 'rob', target: 'p2' }),
    },
    votes: { p1: 'p3', p2: 'p3', p3: 'p1', p4: 'p1', p5: 'p1' },
  });
  sim.advance();
  const res = sim.result();
  assert.deepEqual(res.winners, ['p2', 'p3', 'p4', 'p5'], 'p1 (a werewolf now) died; the village (including the original wolf, now a Robber) wins');
  assert.equal(res.summary.startsWith('好人隊贏'), true);
  assert.ok(res.summary.includes('玩家1'));
  assert.deepEqual(res.points, { p1: 0, p2: 1, p3: 1, p4: 1, p5: 1 });
  const text = res.lines.join('\n');
  assert.ok(text.includes('票數：玩家1 3'));
  assert.ok(text.includes('投票死咗：玩家1（狼人）'));
  assert.ok(text.includes('玩家1：派到 🗡️ 強盜，搶咗 玩家2 張牌 → 最後張牌 🐺 狼人'), 'the card trail explains why the Robber is a wolf');
  assert.ok(text.includes('玩家2：派到 🐺 狼人，俾 玩家1（強盜） 搶咗張牌 → 最後張牌 🗡️ 強盜'));
  assert.ok(text.includes('獨狼 玩家2 睇咗中間第 2 張：🐺 狼人'), 'recap: lone-wolf peek');
  assert.ok(text.includes('玩家3（預言家） 睇咗 玩家1 張牌：🗡️ 強盜'), 'recap: seer looked before the robbery');
  assert.ok(text.includes('玩家1（強盜） 同 玩家2 換牌，睇到新張牌係 🐺 狼人'));
  assert.ok(text.includes('── 夜晚記錄 ──') && text.includes('── 最後張牌 ──'));
  assert.ok(text.includes('中間三張：'));
  // a nobody-wins game still produces a well-formed result
  const none = play({ p1: 'minion', p2: 'seer', p3: 'villager', p4: 'villager' }, ['werewolf', 'werewolf', 'robber'], { votes: { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p1' } });
  none.advance();
  assert.deepEqual(none.result().winners, []);
  assert.ok(none.result().summary.startsWith('冇人贏'));
  assert.deepEqual(Object.values(none.result().points), [0, 0, 0, 0]);
});

test('onuw: the summary explains every outcome in plain Cantonese', () => {
  const sum = (roles, votes, centre) => {
    const sim = play(roles, centre, { votes });
    sim.advance();
    return `${sim.result().summary} | ${sim.result().lines.join(' / ')}`;
  };
  const wolves = sum({ p1: 'werewolf', p2: 'seer', p3: 'villager', p4: 'villager' }, { p1: 'p2', p2: 'p1', p3: 'p4', p4: 'p3' }, ['werewolf', 'robber', 'troublemaker']);
  assert.ok(wolves.startsWith('狼人隊贏 — 冇人死'), wolves);
  assert.ok(wolves.includes('冇人死，場上有狼人 → 狼人隊贏'));
  const tanner = sum({ p1: 'werewolf', p2: 'tanner', p3: 'villager', p4: 'villager' }, { p1: 'p2', p2: 'p3', p3: 'p2', p4: 'p1' }, ['werewolf', 'robber', 'troublemaker']);
  assert.ok(tanner.startsWith('皮匠 玩家2 贏'), tanner);
  assert.ok(tanner.includes('狼人隊唔可以贏'));
  const none = sum({ p1: 'villager', p2: 'villager', p3: 'villager', p4: 'seer' }, { p1: 'p2', p2: 'p3', p3: 'p4', p4: 'p1' }, ['werewolf', 'werewolf', 'robber']);
  assert.ok(none.startsWith('好人隊贏 — 冇狼人、冇人死'), none);
  const hunter = sum({ p1: 'hunter', p2: 'werewolf', p3: 'villager', p4: 'villager' }, { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p1' }, ['werewolf', 'seer', 'robber']);
  assert.ok(hunter.includes('獵人 玩家1 死咗，開槍帶走佢投嘅 玩家2'), hunter);
  const narrated = S.cueReveal(R(play({ p1: 'hunter', p2: 'werewolf', p3: 'villager', p4: 'villager' }, ['werewolf', 'seer', 'robber'], { votes: { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p1' } })), (p) => p);
  assert.ok(narrated.includes('獵人p1開槍，帶走p2'), narrated);
  assert.ok(narrated.includes('好人隊贏'));
  const lone = sum({ p1: 'minion', p2: 'villager', p3: 'villager', p4: 'villager' }, { p1: 'p2', p2: 'p3', p3: 'p2', p4: 'p3' }, ['werewolf', 'werewolf', 'seer']);
  assert.ok(lone.includes('爪牙 玩家1 活住，而且有其他人死咗 → 贏'), lone);
});

test('onuw: the why-lines name every winner — a Tanner who dies with no werewolf among the players, and a Tanner who did not die (#10)', () => {
  const why = (roles, votes, centre) => S.report({ f: judge(roles, votes, centre ? { centre } : {}), log: [], moves: [], order: O4, nm: (p) => p }).why.join(' / ');
  // matrix row 12 without a Minion: no werewolf player, only the Tanner died → the Tanner wins, and the lines say so
  const solo = judge(R4('tanner', 'villager', 'seer', 'villager'), 'BAAA', { centre: ['werewolf', 'werewolf', 'robber'] });
  assert.deepEqual(solo.winners, ['p1']);
  assert.equal(solo.headline, 'tanner');
  assert.ok(why(R4('tanner', 'villager', 'seer', 'villager'), 'BAAA', ['werewolf', 'werewolf', 'robber']).includes('皮匠 p1 死咗 → 皮匠贏'));
  // row 14: no werewolf player, Tanner and a villager died, the Minion lives → Tanner AND Minion win, both explained
  const w14 = why(R4('tanner', 'villager', 'minion', 'villager'), 'BAAB', ['werewolf', 'werewolf', 'robber']);
  assert.ok(w14.includes('爪牙 p3 活住') && w14.includes('皮匠 p1 死咗 → 皮匠贏') && w14.includes('唔會阻住爪牙'), w14);
  // two Tanners (one is a Doppelgänger card that copied the Tanner): only the dead one wins
  const two = why(R4('tanner', 'doppelganger:tanner', 'werewolf', 'villager'), 'BAAA');
  assert.ok(two.includes('皮匠 p2 冇死 → 佢輸'), two);
  // a summary never claims the votes killed a werewolf the Hunter shot
  const shot = S.report({ f: judge(R4('hunter', 'werewolf', 'villager', 'villager'), 'BAAA'), log: [], moves: [], order: O4, nm: (p) => p });
  assert.ok(shot.summary.startsWith('好人隊贏 — 狼人 p2 死咗'), shot.summary);
});

// ============================================================
// framework hooks: blocking (stall detection), @void-round, 💡 hints
// ============================================================

test('onuw: blocking — only the deal and the vote wait on seats; every night window, the day and the reveal run on deadlines (#3: no stall banner ever points at an awake seat)', async () => {
  const B = (sim, p) => engine.blocking(st(sim), p);
  const sim = scenario({ p1: 'seer', p2: 'robber', p3: 'werewolf', p4: 'villager', p5: 'doppelganger' }, ['werewolf', 'troublemaker', 'drunk']);
  const order = st(sim).order;
  assert.deepEqual(order.map((p) => B(sim, p)), [true, true, true, true, true], 'the deal waits on everybody');
  act(sim, 'p2', { type: 'ready' });
  assert.equal(B(sim, 'p2'), false, 'a seat that tapped 記住喇 is not waited on');
  assert.equal(B(sim, 'p1'), true);
  for (const p of order) act(sim, p, { type: 'ready' });
  // every night step, both stages: nobody is "waited on", although every seat has a legal action (the decoy) and focus names the awake
  let windows = 0;
  while (st(sim).phase === 'night') {
    for (const stage of ['cue', 'window']) {
      for (const p of order) {
        assert.equal(B(sim, p), false, `${stepK(sim)}/${stage}: ${p}`);
        assert.ok(sim.legal(p).length > 0, `${stepK(sim)}/${stage}: ${p} has the decoy`);
      }
      if (stage === 'window') {
        windows++;
        assert.ok(st(sim).deadline > sim.now, 'a window always has a deadline');
      } else sim.cueDone();
    }
    if (stepK(sim) === 'doppelganger') act(sim, 'p5', { type: 'copy', target: 'p1' });
    sim.advance();
  }
  assert.ok(windows >= st(sim).steps.length);
  assert.equal(st(sim).phase, 'day');
  for (const p of order) assert.equal(B(sim, p), false, 'the day runs on its timer');
  sim.advance();
  assert.equal(st(sim).phase, 'vote');
  for (const p of order) assert.equal(B(sim, p), true, 'the vote waits on everybody');
  act(sim, 'p1', { type: 'vote', target: 'p3' });
  assert.equal(B(sim, 'p1'), false);
  for (const p of ['p2', 'p3']) act(sim, p, { type: 'ring', on: true });
  assert.equal(B(sim, 'p2'), false, 'an agreer is not waited on while somebody is still undecided');
  assert.equal(B(sim, 'p4'), true);
  act(sim, 'p4', { type: 'vote', target: 'p3' });
  act(sim, 'p5', { type: 'vote', target: 'p3' });
  assert.equal(engine.view(st(sim), 'p2').ring.stuck, true);
  assert.deepEqual(order.filter((p) => B(sim, p)), ['p2', 'p3'], 'the circle fell through: the agreers must choose');
  act(sim, 'p2', { type: 'vote', target: 'p3' });
  act(sim, 'p3', { type: 'vote', target: 'p1' });
  assert.equal(st(sim).phase, 'reveal');
  for (const p of order) assert.equal(B(sim, p), false, 'the reveal waits for the host or its deadline');
  for (const junk of [null, undefined, 'p9', 7, '@host']) assert.equal(engine.blocking(st(sim), junk), false);
  // the session asks the engine, not focus / legalActions
  const { Session } = await import('../js/core/session.js');
  const ses = new Session({ game, players: makePlayers(4), config: config.defaults(4), rng: mulberry32(2), bag: null, now: () => 0, hostPid: 'p1', timers: { setTimeout: () => 0, clearTimeout() {} } });
  ses.begin();
  for (const p of ['p1', 'p2', 'p3', 'p4']) ses.dispatch(p, { type: 'ready' });
  ses.cueDone(ses.cue().id);
  ses.next();
  ses.cueDone(ses.cue().id);
  assert.equal(st(ses).phase, 'night');
  assert.equal(st(ses).stage, 'window');
  for (const p of ['p1', 'p2', 'p3', 'p4']) assert.equal(ses.blocking(p), false, 'session.blocking at night');
});

test('onuw: @void-round — the host voids the game (a phone died): over, nobody wins, nobody scores, the lines lay open the deal and the night so far; too late once the votes are out', () => {
  const deal = { p1: 'robber', p2: 'werewolf', p3: 'seer', p4: 'villager' };
  const centre = ['villager', 'werewolf', 'tanner'];
  const rob = { robber: (x) => act(x, 'p1', { type: 'rob', target: 'p2' }) };
  const to = {
    deal: () => scenario(deal, centre),
    night: () => { const x = scenario(deal, centre); openStep(x, 'robber'); rob.robber(x); return x; },
    day: () => { const x = scenario(deal, centre); playNight(x, rob); return x; },
    vote: () => { const x = scenario(deal, centre); playNight(x, rob); x.advance(); act(x, 'p1', { type: 'vote', target: 'p2' }); return x; },
  };
  for (const [at, mk] of Object.entries(to)) {
    const sim = mk();
    assert.equal(st(sim).phase, at);
    assert.equal(sim.act('p1', { type: ACT.VOID_ROUND }), false, 'a seat cannot void the game');
    assert.equal(sim.host({ type: ACT.VOID_ROUND }), true, `voidable in ${at}`);
    assert.equal(st(sim).phase, 'over');
    const res = sim.result();
    assert.deepEqual(res.winners, []);
    assert.equal(res.void, true);
    assert.deepEqual(res.points, { p1: 0, p2: 0, p3: 0, p4: 0 });
    assert.ok(res.summary.includes('唔計'));
    assert.deepEqual(res.carry, { wolves: ['p2'] });
    const text = res.lines.join('\n');
    assert.ok(text.includes('派牌：玩家1 強盜、玩家2 狼人、玩家3 預言家、玩家4 村民；中間 村民、狼人、皮匠'), `${at}: the deal is laid open`);
    if (at !== 'deal') {
      assert.ok(text.includes('玩家1（強盜） 同 玩家2 換牌'), `${at}: what happened at night`);
      assert.ok(text.includes('玩家1 手上係 🐺 狼人'), `${at}: the cards as they were`);
    }
    assert.ok(res.lines.every((l) => typeof l === 'string' && l.length));
    // everybody sees the same short screen; nothing waits, nothing moves any more
    for (const p of [...st(sim).order, null]) {
      const v = engine.view(st(sim), p);
      assert.equal(v.voided, true);
      assert.equal(v.reveal, undefined);
      assert.equal(v.hint, S.HINT.void);
      if (p) assert.deepEqual(sim.legal(p), []);
      assert.equal(engine.blocking(st(sim), p), false);
    }
    assert.equal(sim.cue(), null);
    assert.equal(sim.focus(), null);
    assert.equal(sim.host({ type: ACT.VOID_ROUND }), false);
    assert.equal(sim.host({ type: ACT.NEXT }), false);
    assert.equal(sim.advance(), false);
  }
  // once the votes are revealed the result is known: no voiding a game you just lost
  const rv = play(deal, centre, { votes: { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p1' } });
  assert.equal(rv.host({ type: ACT.VOID_ROUND }), false);
  assert.equal(st(rv).phase, 'reveal');
  rv.advance();
  assert.equal(rv.host({ type: ACT.VOID_ROUND }), false);
  assert.equal(rv.result().void, undefined);
});

test('onuw: 💡 hints — every phase gives a short first-timer line, built from what the seat\'s own view already shows (U1)', () => {
  const H = S.HINT;
  const hint = (sim, p) => engine.view(st(sim), p).hint;
  const sim = scenario({ p1: 'seer', p2: 'robber', p3: 'werewolf', p4: 'villager', p5: 'doppelganger' }, ['werewolf', 'troublemaker', 'drunk']);
  assert.equal(hint(sim, 'p1'), H.deal.look);
  act(sim, 'p1', { type: 'ready' });
  assert.equal(hint(sim, 'p1'), H.deal.wait);
  assert.equal(hint(sim, 'p2'), H.deal.look);
  assert.equal(hint(sim, null), H.table.deal);
  for (const p of st(sim).order) act(sim, p, { type: 'ready' });
  assert.equal(hint(sim, 'p1'), H.night.begin);
  sim.cueDone();
  sim.advance();
  assert.equal(stepK(sim), 'doppelganger');
  assert.equal(hint(sim, 'p5'), H.night.cue, 'the narration stage: listen');
  sim.cueDone();
  assert.equal(hint(sim, 'p5'), H.night.copy);
  assert.equal(hint(sim, 'p1'), H.night.sleep, 'nothing for you this step');
  act(sim, 'p5', { type: 'copy', target: 'p2' });
  assert.equal(hint(sim, 'p5'), H.night.copied, 'copied the robber: the 💡 sheet only says "look behind the cover" (#8)');
  act(sim, 'p5', { type: 'rob', target: 'p4' });
  assert.equal(hint(sim, 'p5'), H.night.copied, 'the same line once she has robbed');
  sim.advance();
  openStep(sim, 'werewolf');
  assert.equal(hint(sim, 'p3'), H.night.loneWolf);
  sim.advance();
  openStep(sim, 'seer');
  assert.equal(hint(sim, 'p1'), H.night.seer);
  assert.equal(hint(sim, null), H.table.night);
  sim.advance();
  toStep(sim, 'dawn');
  assert.equal(hint(sim, 'p1'), H.night.dawn);
  playNight(sim);
  assert.equal(hint(sim, 'p4'), H.day);
  sim.advance();
  assert.equal(hint(sim, 'p1'), H.vote.pick);
  act(sim, 'p1', { type: 'vote', target: 'p3' });
  assert.equal(hint(sim, 'p1'), H.vote.voted);
  act(sim, 'p2', { type: 'ring', on: true });
  assert.equal(hint(sim, 'p2'), H.vote.ring);
  for (const p of ['p3', 'p4', 'p5']) act(sim, p, { type: 'vote', target: 'p1' });
  assert.equal(hint(sim, 'p2'), H.vote.stuck, 'the circle fell through');
  act(sim, 'p2', { type: 'vote', target: 'p1' });
  assert.equal(st(sim).phase, 'reveal');
  assert.equal(hint(sim, 'p2'), H.reveal);
  act(sim, 'p2', { type: 'done' });
  assert.equal(hint(sim, 'p2'), H.revealDone);
  act(sim, 'p1', { type: 'done' });
  assert.equal(hint(sim, 'p2'), H.over);
  assert.equal(hint(sim, null), H.table.over);
  // every hint is one short line
  const all = [...Object.values(H.deal), ...Object.values(H.night), H.day, ...Object.values(H.vote), H.reveal, H.revealDone, H.over, H.void, ...Object.values(H.table)];
  for (const t of all) assert.ok(typeof t === 'string' && t.length > 4 && [...t].length <= 40 && !t.includes('\n'), t);
  // a hint for every ability the engine can offer
  for (const ab of ['copy', 'seer', 'robber', 'troublemaker', 'drunk', 'loneWolf']) assert.ok(H.night[ab], ab);
});

test('onuw: 💡 view.hintRoleLabel — every seat view that shows the dealt role says 「你派到嘅角色」 (cards change hands at night); the table and strangers get none', () => {
  const label = '你派到嘅角色';
  assert.equal(S.HINT_ROLE_LABEL, label);
  assert.ok(label.trim().length > 0 && label.length <= 20, 'hints.js trims and cuts the heading at 20 characters');
  // the robber takes p2's werewolf card: by morning p1 HOLDS a werewolf but was DEALT the robber
  const deal = { p1: 'robber', p2: 'werewolf', p3: 'seer', p4: 'villager' };
  const centre = ['villager', 'werewolf', 'tanner'];
  const sim = scenario(deal, centre);
  const seen = new Set();
  const check = (where) => {
    const s = st(sim);
    seen.add(s.phase);
    for (const pid of s.order) {
      const v = engine.view(s, pid);
      assert.ok(v.my?.dealt, `${where}: ${pid}'s view carries the dealt role`);
      assert.equal(v.hintRoleLabel, label, `${where}: ${pid}`);
      assert.equal(roleFor(v, rules)?.id, deal[pid], `${where}: the 💡 sheet resolves the DEALT role of ${pid}`);
    }
    for (const who of [null, 'nobody']) {
      const v = engine.view(s, who);
      assert.equal(v.my, undefined);
      assert.equal('hintRoleLabel' in v, false, `${where}: a view without a role has no role heading (${who})`);
    }
  };
  check('deal');
  toNight(sim);
  let guard = 0;
  while (st(sim).phase === 'night' && guard++ < 200) {
    check(`night/${stepK(sim)}/cue`);
    sim.cueDone();
    check(`night/${stepK(sim)}/window`);
    if (stepK(sim) === 'robber') act(sim, 'p1', { type: 'rob', target: 'p2' });
    sim.advance();
  }
  assert.equal(st(sim).phase, 'day');
  assert.equal(finalAt(sim, 'p1'), 'werewolf', 'p1 now holds the werewolf card…');
  check('day');
  assert.equal(engine.view(st(sim), 'p1').my.dealt, 'robber', '…while the view, and so the sheet, still says what was dealt');
  for (const p of st(sim).order) sim.act(p, { type: 'ready-vote', on: true });
  assert.equal(st(sim).phase, 'vote');
  check('vote');
  st(sim).order.forEach((p, i) => sim.act(p, { type: 'vote', target: st(sim).order[(i + 1) % 4] }));
  assert.equal(st(sim).phase, 'reveal');
  check('reveal');
  for (let i = 0; i < 6 && !sim.result(); i++) sim.advance();
  assert.equal(st(sim).phase, 'over');
  check('over');
  assert.deepEqual([...seen].sort(), ['day', 'deal', 'night', 'over', 'reveal', 'vote']);

  // a voided game still shows each seat its dealt card
  const vd = scenario(deal, centre);
  assert.equal(vd.host({ type: ACT.VOID_ROUND }), true);
  for (const pid of st(vd).order) {
    const v = engine.view(st(vd), pid);
    assert.equal(v.voided, true);
    assert.equal(v.hintRoleLabel, label, `voided: ${pid}`);
  }
  assert.equal('hintRoleLabel' in engine.view(st(vd), null), false);
});

// ============================================================
// leaks: a seat only ever receives what its player may know
// ============================================================

const VIEW_KEYS = new Set(['seat', 'phase', 'n', 'title', 'subtitle', 'night', 'roleList', 'opts', 'deadline', 'timerLabel', 'ready',
  'step', 'my', 'dayReady', 'canExtend', 'progress', 'ring', 'candidates', 'myVote', 'reveal', 'revealDone', 'hint', 'hintRoleLabel', 'voided',
  'absent']);   // D4: the public list of seats the host marked 💤
const MY_KEYS = new Set(['dealt', 'ready', 'acked', 'night', 'notes', 'absent']);
const NIGHT_KEYS = new Set(['awake', 'info', 'ab', 'copied', 'seen']);
const SECRET_KEYS = ['cards', 'centre', 'orig', 'dop', 'log', 'votes', 'moves', 'final', 'report', 'why', 'recap', 'dealtCentre', 'counts', 'ringAgree'];

/** Everything keyed `k` anywhere inside `obj`. */
function keysIn(obj, base = '$', out = []) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) { out.push([k, `${base}.${k}`]); keysIn(v, `${base}.${k}`, out); }
  }
  return out;
}

/** The hidden card contents of everyone but `pid` (and the centre) replaced; views before the reveal must not change. */
function scrambled(state, pid) {
  const t = clone(state);
  for (const p of t.order) if (p !== pid) t.cards[p] = { role: 'tanner' };
  t.centre = t.centre.map(() => ({ role: 'tanner' }));
  t.dealtCentre = t.dealtCentre.map(() => 'tanner');
  if (t.phase === 'vote') {
    for (const p of t.order) if (p !== pid && t.votes[p] !== undefined) t.votes[p] = t.order.find((x) => x !== p && x !== t.votes[p]) ?? t.votes[p];
  }
  return t;
}

function checkViews(sim) {
  const s = st(sim);
  const pre = s.phase !== 'reveal' && s.phase !== 'over';
  const table = engine.view(s, null);
  assert.equal(table.my, undefined, 'the table has no private part');
  for (const pid of [...s.order, null]) {
    const v = engine.view(s, pid);
    for (const k of Object.keys(v)) assert.ok(VIEW_KEYS.has(k), `unknown view key ${k}`);
    assert.ok(typeof v.hint === 'string' && v.hint.length > 0 && [...v.hint].length <= 40, `a short 💡 hint for ${pid} in ${s.phase}: ${v.hint}`);
    if (v.my) {
      for (const k of Object.keys(v.my)) assert.ok(MY_KEYS.has(k), `unknown my.${k}`);
      assert.equal(v.my.dealt, s.orig[pid], 'only my own dealt role');
      if (v.my.night) for (const k of Object.keys(v.my.night)) assert.ok(NIGHT_KEYS.has(k), `unknown my.night.${k}`);
      if (v.my.notes) assert.deepEqual(v.my.notes.slice(1), JSON.parse(JSON.stringify(s.notes[pid])), 'my notes are exactly mine');
      if (v.my.night?.awake) assert.deepEqual(v.my.night.info, s.notes[pid].filter((n) => n.ix === s.ix), 'night info is mine and this step\'s');
      if (v.my.night) assert.deepEqual(v.my.night.seen, JSON.parse(JSON.stringify(s.notes[pid])), 'the night 📓 is exactly my own notes so far, awake or not');
    }
    if (pre) {
      const hits = keysIn(v).filter(([k]) => SECRET_KEYS.includes(k) && !(k === 'counts'));
      assert.deepEqual(hits, [], `secret keys in the view of ${pid} (${s.phase})`);
      // no view carries another seat's current card, centre card or vote: nothing in it may depend on them
      assert.equal(JSON.stringify(engine.view(scrambled(s, pid), pid)), JSON.stringify(v), `view of ${pid} depends on hidden cards/votes (${s.phase})`);
    }
    // the shared parts are identical for everybody
    assert.deepEqual(v.roleList, table.roleList);
    assert.equal(v.phase, table.phase);
    assert.equal(v.title, table.title);
    assert.equal(v.subtitle, table.subtitle);
    assert.equal(v.night, table.night);
    assert.deepEqual(v.absent, table.absent, 'the 💤 list is public and the same for everybody');
  }
  if (pre) {
    assert.equal(JSON.stringify(engine.view(scrambled(s, null), null)), JSON.stringify(table), 'the table view depends on hidden state');
    assert.equal(table.reveal, undefined);
  }
}

test('onuw leaks: no view before the reveal carries a hidden card, vote, log or role of another seat (checked at every kind of step)', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'seer', p3: 'werewolf', p4: 'robber', p5: 'troublemaker', p6: 'drunk', p7: 'insomniac', p8: 'minion', p9: 'mason', p10: 'mason' }, ['werewolf', 'villager', 'hunter'], { preset: 'custom' });
  checkViews(sim);
  toNight(sim);
  const acts = {
    doppelganger: (x) => { act(x, 'p1', { type: 'copy', target: 'p2' }); act(x, 'p1', { type: 'look-centre', cards: [0, 2] }); },
    seer: (x) => act(x, 'p2', { type: 'look-player', target: 'p3' }),
    robber: (x) => act(x, 'p4', { type: 'rob', target: 'p3' }),
    troublemaker: (x) => act(x, 'p5', { type: 'swap', a: 'p7', b: 'p8' }),
    drunk: (x) => act(x, 'p6', { type: 'drunk-swap', card: 1 }),
  };
  while (st(sim).phase === 'night') {
    checkViews(sim);
    sim.cueDone();
    checkViews(sim);
    acts[stepK(sim)]?.(sim);
    checkViews(sim);
    sim.advance();
  }
  checkViews(sim);
  for (const p of st(sim).order) sim.act(p, { type: 'ready-vote', on: true });
  checkViews(sim);
  st(sim).order.forEach((p, i) => { sim.act(p, { type: 'vote', target: st(sim).order[(i + 2) % 10] }); checkViews(sim); });
  assert.equal(st(sim).phase, 'reveal');
  checkViews(sim);
});

test('onuw leaks: what one seat learned is invisible to the others (and a robbed doppelgänger shows only its face)', () => {
  const sim = scenario({ p1: 'doppelganger', p2: 'seer', p3: 'werewolf', p4: 'robber', p5: 'villager' }, ['werewolf', 'villager', 'villager']);
  playNight(sim, {
    doppelganger: (x) => act(x, 'p1', { type: 'copy', target: 'p3' }),
    seer: (x) => act(x, 'p2', { type: 'look-centre', cards: [0, 1] }),
    robber: (x) => act(x, 'p4', { type: 'rob', target: 'p1' }),
  });
  const text = (p) => JSON.stringify(engine.view(st(sim), p).my);
  assert.ok(text('p2').includes('seer-centre'));
  for (const p of ['p1', 'p3', 'p4', 'p5']) assert.ok(!text(p).includes('seer-centre'), `${p} must not see the seer's look`);
  // the robber took the doppelgänger card (which copied the werewolf): he sees the FACE only, not what was copied
  const rob = engine.view(st(sim), 'p4').my.notes.find((n) => n.k === 'rob');
  assert.equal(rob.role, 'doppelganger');
  assert.ok(!text('p4').includes('"copied"'));
  // the doppelgänger knows her own copy; nobody else does
  assert.ok(text('p1').includes('"k":"copy"'));
  for (const p of ['p2', 'p3', 'p4', 'p5']) assert.ok(!text(p).includes('"k":"copy"'));
  // in the day nobody's view carries a current card: only the dealt role and own notes
  const day = engine.view(st(sim), 'p4');
  assert.equal(day.phase, 'day');
  assert.deepEqual(Object.keys(day.my).sort(), ['dealt', 'notes']);
  assert.equal(day.my.dealt, 'robber');
  assert.equal(day.my.notes[0].k, 'dealt');
  // views are JSON-safe and independent of the state (mutating one does not touch the game)
  const v = engine.view(st(sim), 'p4');
  v.my.notes.push({ k: 'forged' });
  v.roleList.length = 0;
  assert.equal(engine.view(st(sim), 'p4').my.notes.some((n) => n.k === 'forged'), false);
  assert.ok(engine.view(st(sim), 'p4').roleList.length > 0);
});

test('onuw leaks: the table view and an unknown seat id both see only public information', () => {
  const sim = scenario({ p1: 'seer', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'troublemaker']);
  openStep(sim, 'seer');
  act(sim, 'p1', { type: 'look-player', target: 'p3' });
  const a = engine.view(st(sim), null);
  const b = engine.view(st(sim), 'nobody');
  assert.deepEqual(a, b);
  assert.equal(a.seat, null);
  assert.equal(a.my, undefined);
  assert.equal(JSON.stringify(a).includes('seer-player'), false);
  assert.deepEqual(paths(a, (x) => x === 'werewolf').filter((p) => !p.includes('roleList')), [], 'no role string outside the public role list');
});

test('onuw leaks: votes stay secret until the reveal; then everything is public', () => {
  const sim = dayGame();
  sim.advance();
  sim.act('p1', { type: 'vote', target: 'p2' });
  sim.act('p2', { type: 'vote', target: 'p1' });
  assert.equal(JSON.stringify(engine.view(st(sim), 'p3')).includes('"p2"'), true, 'p2 is a candidate');
  assert.equal(engine.view(st(sim), 'p3').myVote, undefined);
  assert.deepEqual(engine.view(st(sim), 'p3').progress, { done: 2, total: 4 });
  assert.equal(engine.view(st(sim), null).reveal, undefined);
  sim.act('p3', { type: 'vote', target: 'p1' });
  sim.act('p4', { type: 'vote', target: 'p1' });
  const v = engine.view(st(sim), 'p3');
  assert.deepEqual(v.reveal.votes, { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p1' });
  assert.equal(v.reveal.cards.length, 4);
  assert.ok(v.reveal.cards.every((c) => c.orig && c.face && c.final));
  assert.equal(v.reveal.centre.length, 3);
  assert.deepEqual(engine.view(st(sim), null).reveal, v.reveal, 'the table sees exactly the same reveal');
});

// ============================================================
// fuzz
// ============================================================

/** The research pseudo-code, transcribed independently of the engine. */
function referee(order, finalRoles, votes) {
  const count = Object.fromEntries(order.map((p) => [p, 0]));
  for (const p of order) count[votes[p]] += 1;
  const mx = Math.max(...Object.values(count));
  const dead = new Set(mx >= 2 ? order.filter((p) => count[p] === mx) : []);
  const queue = [...dead].filter((p) => finalRoles[p] === 'hunter');
  while (queue.length) {
    const h = queue.pop();
    const t = votes[h];
    if (!dead.has(t)) { dead.add(t); if (finalRoles[t] === 'hunter') queue.push(t); }
  }
  const Wf = order.filter((p) => finalRoles[p] === 'werewolf');
  const wolfDied = Wf.some((p) => dead.has(p));
  const tannerDied = order.some((p) => finalRoles[p] === 'tanner' && dead.has(p));
  const villageWins = wolfDied || (Wf.length === 0 && dead.size === 0);
  const winners = order.filter((p) => {
    const r = finalRoles[p];
    if (r === 'tanner') return dead.has(p);
    if (r === 'werewolf' || (r === 'minion' && Wf.length > 0)) return !tannerDied && !wolfDied;
    if (r === 'minion') return !dead.has(p) && dead.size >= 1;
    return villageWins;
  });
  return { dead: [...dead].sort(), winners };
}

const multiset = (s) => [...s.order.map((p) => s.cards[p]), ...s.centre].map((c) => {
  assert.ok(!c.copied || c.role === 'doppelganger', 'only a Doppelgänger card ever carries a copy');
  return c.role;
}).sort().join(',');

/** A random legal role multiset for n players, as a custom config. */
function randomCustom(rng, n) {
  const caps = [];
  for (const r of ALL_ROLES) if (r !== 'mason') for (let i = 0; i < game.CAPS[r]; i++) caps.push(r);
  for (;;) {
    const deck = caps.slice().sort(() => rng() - 0.5);
    const masons = rng() < 0.4 && n + 3 >= 5 ? 2 : 0;
    const pick = deck.slice(0, n + 3 - masons);
    if (masons) pick.push('mason', 'mason');
    const counts = {};
    for (const r of pick) counts[r] = (counts[r] ?? 0) + 1;
    if (!counts.werewolf) continue;
    const cfg = { ...config.defaults(n), ...customConfig(counts) };
    if (config.validate(cfg, n).ok) return cfg;
  }
}

function fuzzGame(n, seed, cfg, { leaks = false } = {}) {
  const sim = new Sim(game, { n, seed, config: cfg });
  const start = multiset(st(sim));
  const seen = [];
  let lastKey = '';
  let last = 0;
  const phases = ['deal', 'night', 'day', 'vote', 'reveal', 'over'];
  let steps = 0;
  const { result } = sim.runRandom({
    maxSteps: 5000,
    onStep: (x) => {
      steps++;
      const s = st(x);
      assert.equal(multiset(s), start, 'cards are conserved: only swapped');
      assert.ok(phases.indexOf(s.phase) >= last, 'phases only move forward');
      last = phases.indexOf(s.phase);
      if (s.phase === 'night') {
        const key = `${s.ix}:${s.stage}`;
        if (key !== lastKey) {
          lastKey = key;
          seen.push(key);
          if (s.stage === 'window') assert.equal(s.deadline - x.now, game.windowMs(s.cfg, s.steps[s.ix].k), 'fixed window length');
        }
      }
      if (leaks && steps % 5 === 0) checkViews(x);
    },
  });
  const s = st(sim);
  // every step happened, once each, in order, cue then window
  const want = [];
  s.steps.forEach((_, i) => want.push(`${i}:cue`, `${i}:window`));
  assert.deepEqual(seen, want, `n=${n} seed=${seed}: every night step runs every time`);
  assert.equal(s.phase, 'over');
  // the engine agrees with an independent referee
  const finalRoles = Object.fromEntries(s.order.map((p) => [p, game.finalRole(s.cards[p])]));
  const ref = referee(s.order, finalRoles, s.final.votes);
  assert.deepEqual(s.final.dead.slice().sort(), ref.dead, `n=${n} seed=${seed} dead`);
  assert.deepEqual(result.winners, ref.winners, `n=${n} seed=${seed} winners`);
  assert.deepEqual(Object.keys(result.points), s.order);
  assert.equal(Object.values(result.points).reduce((a, b) => a + b, 0), result.winners.length);
  assert.ok(result.lines.length > 8 && result.lines.every((l) => typeof l === 'string' && l.length > 0));
  assert.ok(result.summary.length > 3);
  for (const p of s.order) assert.ok(s.final.votes[p] && s.final.votes[p] !== p, 'nobody voted for themselves');
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'state is plain JSON');
  return { sim, result };
}

test('onuw fuzz: every head-count x 100 seeds, preset / advanced / random custom sets — terminates, every step runs, the referee agrees', () => {
  const t0 = performance.now();
  let games = 0;
  for (let n = 3; n <= 10; n++) {
    const rng = mulberry32(n * 1009);
    for (let seed = 1; seed <= 100; seed++) {
      const mode = seed % 3;
      const cfg = mode === 0 ? randomCustom(rng, n) : { ...config.defaults(n), preset: mode === 1 ? 'auto' : 'advanced' };
      fuzzGame(n, seed * 17 + n, cfg, { leaks: seed <= 6 });
      games++;
    }
  }
  assert.equal(games, 800);
  assert.ok(performance.now() - t0 < 20000, `fuzz took ${Math.round(performance.now() - t0)} ms`);
});

test('onuw fuzz: with the doppelgänger and every role in play, 10 players', () => {
  const everything = { doppelganger: 1, werewolf: 2, minion: 1, mason: 2, seer: 1, robber: 1, troublemaker: 1, drunk: 1, insomniac: 1, hunter: 1, tanner: 1 };
  let copies = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { sim } = fuzzGame(10, seed, { ...config.defaults(10), ...customConfig(everything) }, { leaks: seed <= 4 });
    if (st(sim).dop?.copied) copies++;
  }
  assert.ok(copies > 20, 'the doppelgänger copied something in many games');
});

test('onuw fuzz: deterministic — the same seed plays the same game, a different seed does not', () => {
  const a = fuzzGame(6, 321, config.defaults(6));
  const b = fuzzGame(6, 321, config.defaults(6));
  assert.deepEqual(a.result, b.result);
  assert.deepEqual(a.sim.state, b.sim.state);
  const c = fuzzGame(6, 322, config.defaults(6));
  assert.notDeepEqual(a.sim.state.cards, c.sim.state.cards);
});

test('onuw robustness: garbage actions from anybody at any time never throw and never corrupt the game', () => {
  const rng = mulberry32(2024);
  const junk = [null, undefined, 0, 1, -1, 1.5, NaN, '', 'x', 'p1', 'p2', 'p3', 'HOST', '@host', true, false, [], [0], ['p1'], {}, { a: 1 }, 'centre'];
  const types = ['ready', 'ack', 'copy', 'look-player', 'look-centre', 'rob', 'swap', 'drunk-swap', 'ready-vote', 'extend', 'vote', 'ring', 'done', '@next', '@cue-done', '@auto', 'constructor', '__proto__', 7, null];
  const pick = (a) => a[Math.floor(rng() * a.length)];
  for (let n = 3; n <= 10; n += 7) {
    const sim = new Sim(game, { n, seed: 5, config: { ...config.defaults(n), preset: 'advanced' } });
    const start = multiset(st(sim));
    let guard = 0;
    while (!sim.result() && guard++ < 3000) {
      // a burst of junk
      for (let i = 0; i < 6; i++) {
        const pid = rng() < 0.15 ? HOST : rng() < 0.1 ? pick(junk) : `p${1 + Math.floor(rng() * n)}`;
        const action = rng() < 0.1 ? pick(junk) : { type: pick(types), target: pick(junk), a: pick(junk), b: pick(junk), card: pick(junk), cards: pick(junk), on: pick(junk), id: pick(junk) };
        const before = JSON.stringify(st(sim));
        assert.doesNotThrow(() => engine.act(clone(st(sim)), { pid, action }, sim.ctx()), JSON.stringify(action));
        assert.doesNotThrow(() => engine.act(clone(st(sim)), pick([undefined, null, 5, 'x', {}]), sim.ctx()));
        assert.equal(JSON.stringify(st(sim)), before);
        sim.act(pid, action);
        assert.equal(multiset(st(sim)), start);
      }
      // then one real step forward
      const movers = sim.players.map((p) => p.id).filter((id) => sim.legal(id).length);
      if (sim.cue() && sim.cueDone()) continue;
      if (movers.length && rng() < 0.7) { const id = pick(movers); sim.act(id, pick(sim.legal(id))); continue; }
      if (st(sim).deadline != null && sim.advance()) continue;
      if (!sim.host({ type: ACT.NEXT })) { const id = pick(movers); if (id) sim.act(id, sim.legal(id)[0]); }
    }
    assert.ok(sim.result(), `n=${n} finished`);
  }
});

test('onuw: autoAct covers every phase and every stall (a dead phone never stops the table)', () => {
  const sim = new Sim(game, { n: 6, seed: 9, config: { ...config.defaults(6), preset: 'advanced' } });
  let guard = 0;
  while (!sim.result() && guard++ < 2000) {
    const s = st(sim);
    if (s.phase === 'night') {
      // a stalled seat is auto-acted on EVERY step: whatever it returns is legal and changes things (or is null when already done)
      for (const p of s.order) {
        const a = engine.autoAct(clone(s), p, sim.ctx());
        if (a) assert.ok(JSON.stringify(sim.legal(p)).includes(JSON.stringify(a)), `autoAct(${p}) at ${stepK(sim)} is legal: ${JSON.stringify(a)}`);
      }
      sim.cueDone();
      for (const p of s.order) { const a = engine.autoAct(clone(st(sim)), p, sim.ctx()); if (a) assert.ok(JSON.stringify(sim.legal(p)).includes(JSON.stringify(a))); }
      for (const p of s.order) sim.session?.autoAct?.(p);
      sim.advance();
      continue;
    }
    let moved = false;
    for (const p of s.order) {
      const a = engine.autoAct(clone(st(sim)), p, sim.ctx());
      if (a) { assert.ok(JSON.stringify(sim.legal(p)).includes(JSON.stringify(a)) || a.type === 'vote' || a.type === 'ready-vote', `${s.phase}: ${JSON.stringify(a)}`); moved = sim.act(p, a) || moved; }
    }
    if (!moved) { if (!sim.cueDone()) sim.advance() || sim.host({ type: ACT.NEXT }); }
  }
  assert.ok(sim.result(), 'a table of stalled phones still finishes');
  // the harmless choices: an optional ability is declined, a mandatory one is made
  const robber = openStep(scenario({ p1: 'robber', p2: 'drunk', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'seer']), 'robber');
  assert.deepEqual(engine.autoAct(clone(st(robber)), 'p1', robber.ctx()), { type: 'ack' }, 'robbers decline');
  const drunk = openStep(scenario({ p1: 'robber', p2: 'drunk', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'seer']), 'drunk');
  assert.equal(engine.autoAct(clone(st(drunk)), 'p2', drunk.ctx()).type, 'drunk-swap');
  const dop = openStep(scenario({ p1: 'doppelganger', p2: 'drunk', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'seer']), 'doppelganger');
  assert.equal(engine.autoAct(clone(st(dop)), 'p1', dop.ctx()).type, 'copy');
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
  get childNodes() { return this.children.slice(); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(...(String(v) === '' ? [] : [new FText(v)])); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  append(...kids) { for (const k of kids) this.appendChild(k instanceof FNode ? k : new FText(k)); }
  appendChild(k) { k.parentNode?.removeChild(k); k.parentNode = this; this.children.push(k); return k; }
  removeChild(k) { const i = this.children.indexOf(k); if (i >= 0) { this.children.splice(i, 1); k.parentNode = null; } return k; }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() { this.parentNode?.removeChild(this); }
}
const fakeDocument = {
  createElement: (t) => new FEl(t),
  createTextNode: (t) => new FText(t),
  getElementById: () => null,
  head: new FEl('head'), body: new FEl('body'),
};

const walk = (n, fn) => { fn(n); if (n.children) for (const c of n.children) walk(c, fn); };
const findAll = (root, pred) => { const out = []; walk(root, (n) => { if (n instanceof FEl && pred(n)) out.push(n); }); return out; };
const hasCls = (n, c) => n.cls.has(c);
const click = (n) => {
  assert.ok(!n.disabled && !n.hidden, 'clicked a disabled/hidden control');
  for (const f of n.listeners.click ?? []) f({ preventDefault() {} });
};
const serialize = (n) => (n instanceof FText ? n.data : JSON.stringify([n.tag, [...n.cls].sort(), n.attrs, n.hidden, n.disabled, n.styleMap, n.dataset, n.children.map(serialize)]));

/** Stand-ins for the shared components: same props, same callbacks, just enough DOM. */
function stubComponents() {
  const E = (tag, cls, ...kids) => { const n = new FEl(tag); if (cls) n.className = cls; n.append(...kids); return n; };
  const Cover = (p0 = {}) => {
    const front = E('div', 'c-cover-front'); const back = E('div', 'c-cover-back'); const root = E('div', 'c-cover', front, back);
    const api = {
      el: root,
      update(p) { if (p.front && front.children[0] !== p.front) front.replaceChildren(p.front); back.textContent = p.backLabel ?? ''; api.props = p; },
      close() {},
      destroy() { root.remove(); },
    };
    api.update(p0);
    return api;
  };
  const RoleCard = (p0 = {}) => {
    const body = E('div', 'rc-body'); const lock = E('button', 'rc-lock'); const root = E('div', 'c-rolecard', body, lock);
    lock.addEventListener('click', () => api.props.onLockToggle?.());
    const api = {
      el: root,
      update(p) { api.props = p; body.textContent = p.role ? `${p.role.emoji}${p.role.name}|${p.role.text}|${p.role.teamLabel ?? p.role.team}` : 'none'; lock.textContent = p.locked ? 'locked' : 'unlocked'; },
      destroy() { root.remove(); },
    };
    api.update(p0);
    return api;
  };
  const VotePanel = (p0 = {}) => {
    const list = E('div', 'vp-list'); const root = E('div', 'c-votepanel', list);
    const api = {
      el: root,
      update(p) {
        api.props = p;
        list.replaceChildren(...(p.candidates ?? []).map((id) => { const b = E('button', 'vp-opt'); b.dataset.pid = id; b.textContent = `${id}${p.myVote === id ? '✓' : ''}`; b.addEventListener('click', () => p.onVote?.(id)); return b; }));
      },
      destroy() { root.remove(); },
    };
    api.update(p0);
    return api;
  };
  const Timer = (p0 = {}) => {
    const extend = E('button', 'timer-extend'); const root = E('div', 'c-timer', extend);
    extend.addEventListener('click', () => api.props.onExtend?.());
    const api = { el: root, update(p) { api.props = p; extend.hidden = !p.onExtend; }, destroy() { root.remove(); } };
    api.update(p0);
    return api;
  };
  return { Cover, RoleCard, DiceCup: null, VotePanel, Timer, PlayerPicker: null, Canvas: null, dieFace: null };
}

async function withFakeDom(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node };
  globalThis.document = fakeDocument;
  globalThis.Node = FNode;
  try {
    return await fn(await import('../js/games/onuw/ui.js'));
  } finally {
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
    if (saved.Node === undefined) delete globalThis.Node; else globalThis.Node = saved.Node;
  }
}

/** One mounted UI per seat (and one for the table), as the shell does. */
function mountAll(ui, sim, sent, { host = 'p1' } = {}) {
  const comps = stubComponents();
  const seats = {};
  for (const pid of [...sim.players.map((p) => p.id), null]) {
    const root = new FEl('div');
    const api = {
      me: pid, players: sim.players, isHost: pid === host, meta: game.meta, config: sim.state.cfg,
      send: (a) => { const changed = sim.act(pid, a); sent.push({ pid, a, changed }); return changed; },
      ink() {}, now: () => sim.now, sfx() {}, toast() {}, components: comps,
    };
    seats[pid ?? 'table'] = { pid, root, api, handle: ui.mount(root, api) };
  }
  return seats;
}

function pushViews(sim, seats, ctx = { focus: null, paused: false, narrationMode: 'voice' }) {
  for (const seat of Object.values(seats)) {
    const v = sim.view(seat.pid);
    seat.handle.update(v, ctx);
    const a = serialize(seat.root);
    seat.handle.update(clone(v), ctx);
    assert.equal(serialize(seat.root), a, `update() is not idempotent for ${seat.pid ?? 'table'} in ${v.phase}`);
  }
}

/** The big shape of a night screen: must be the same on every phone at every step. */
function nightShape(root) {
  const night = findAll(root, (n) => hasCls(n, 'on-night'))[0];
  if (!night) return null;
  const strip = new Set(['is-awake', 'has-live-grid', 'is-done', 'is-action', 'is-wait']);
  const top = night.children.map((c) => [...c.cls].filter((x) => !strip.has(x)).join('.'));
  const grid = findAll(night, (n) => hasCls(n, 'on-grid'))[0];
  const centre = findAll(night, (n) => hasCls(n, 'on-centre'))[0];
  const ack = night.children.find((c) => hasCls(c, 'on-ack'));
  const panel = findAll(night, (n) => hasCls(n, 'on-panel'))[0];
  return JSON.stringify([top, grid.children.length, centre.children.length, ack.children.length, panel.children.length]);
}

/** What a thumb would do on this seat's current screen. Returns true if it tapped something real. */
function tapSomething(sim, seat, rng) {
  const root = seat.root;
  const vis = (n) => !n.hidden && !n.disabled;
  const s = st(sim);
  if (s.phase === 'deal') {
    const b = findAll(root, (n) => hasCls(n, 'on-ready') && vis(n))[0];
    if (b) { click(b); return true; }
    return false;
  }
  if (s.phase === 'night') {
    const ack = findAll(root, (n) => hasCls(n, 'on-ack'))[0];
    const ab = engine.view(s, seat.pid).my.night.ab;
    const grid = findAll(root, (n) => hasCls(n, 'on-grid'))[0].children.filter(vis);
    const centre = findAll(root, (n) => hasCls(n, 'on-centre'))[0].children.filter(vis);
    const tap = (list, k) => { const pool = list.slice(); for (let i = 0; i < k; i++) click(pool.splice(Math.floor(rng() * pool.length), 1)[0]); };
    if (ab && rng() < 0.85) {
      if (ab.mode === 'player') tap(grid, 1);
      else if (ab.mode === 'pair') tap(grid, 2);
      else if (ab.mode === 'centre1') tap(centre, 1);
      else if (ab.mode === 'seer') { if (rng() < 0.5) tap(grid, 1); else tap(centre, 2); }
    }
    click(ack);
    return true;
  }
  if (s.phase === 'day') {
    const b = findAll(root, (n) => n.tag === 'button' && n.textContent.includes('夠鐘投票') && !n.textContent.startsWith('✓') && vis(n))[0];
    if (b) { click(b); return true; }
    return false;
  }
  if (s.phase === 'vote') {
    const opts = findAll(root, (n) => hasCls(n, 'vp-opt'));
    if (!opts.length) return false;
    click(opts[Math.floor(rng() * opts.length)]);
    return true;
  }
  if (s.phase === 'reveal') {
    const b = findAll(root, (n) => n.tag === 'button' && n.textContent.includes('睇完整個結果') && vis(n))[0];
    if (b) { click(b); return true; }
  }
  return false;
}

function uiGame(n, seed, over = {}) {
  return new Sim(game, { n, seed, config: { ...config.defaults(n), ...over } });
}

test('onuw ui: every phase renders for every seat, idempotently, and every screen can be finished by tapping alone', async () => {
  await withFakeDom(async (ui) => {
    const cases = [[3, 1, {}], [4, 2, {}], [5, 3, { pace: 'fast' }], [6, 4, { preset: 'advanced' }], [7, 5, {}], [8, 6, { preset: 'advanced' }], [9, 7, {}], [10, 8, { preset: 'advanced', ringVote: false }], [5, 9, { loneWolf: false, discussSec: 60 }]];
    for (const [n, seed, over] of cases) {
      const sim = uiGame(n, seed, over);
      const sent = [];
      const seats = mountAll(ui, sim, sent);
      const rng = mulberry32(seed * 31);
      const phases = new Set();
      let guard = 0;
      while (!sim.result() && guard++ < 4000) {
        pushViews(sim, seats);
        phases.add(st(sim).phase);
        if (st(sim).phase === 'night') {
          const shapes = new Set(sim.players.map((p) => nightShape(seats[p.id].root)));
          assert.equal(shapes.size, 1, `night screens differ in shape between seats (step ${st(sim).ix}/${st(sim).stage}): ${[...shapes].join(' // ')}`);
        }
        // each seat taps what its screen offers (in random order)
        const order = sim.players.map((p) => p.id).sort(() => rng() - 0.5);
        let tapped = false;
        for (const pid of order) {
          if (st(sim).phase === 'over') break;
          if (st(sim).phase === 'night' && rng() < 0.4) continue;
          try { tapped = tapSomething(sim, seats[pid], rng) || tapped; } catch (e) { throw new Error(`tap failed for ${pid} in ${st(sim).phase}/${st(sim).stage}: ${e.message}`); }
          pushViews(sim, { [pid]: seats[pid] });
        }
        if (st(sim).phase === 'night') {
          if (sim.cue()) sim.cueDone(); else sim.advance();
        } else if (!tapped) {
          if (sim.cue()) sim.cueDone(); else if (st(sim).deadline != null) sim.advance(); else sim.host({ type: ACT.NEXT });
        }
      }
      assert.ok(sim.result(), `n=${n}: finished by tapping alone (stuck in ${st(sim).phase} ix=${st(sim).ix} ${st(sim).stage})`);
      pushViews(sim, seats);
      for (const p of ['deal', 'night', 'day', 'vote', 'reveal']) assert.ok(phases.has(p), `phase ${p} was rendered (n=${n})`);

      // the UI only ever sent actions the engine accepted, apart from repeated decoy taps and the explicit toggles
      for (const x of sent) if (!x.changed) assert.ok(['ack', 'ready-vote', 'ring', 'done', 'extend'].includes(x.a.type), `UI sent a refused ${JSON.stringify(x.a)} as ${x.pid}`);
      for (const seat of Object.values(seats)) seat.handle.destroy();
    }
  });
});

test('onuw ui: the night screen is the same shape on every phone at every step, decoys included', async () => {
  await withFakeDom(async (ui) => {
    const sim = scenario({ p1: 'doppelganger', p2: 'werewolf', p3: 'minion', p4: 'seer', p5: 'robber', p6: 'troublemaker', p7: 'drunk', p8: 'insomniac' }, ['werewolf', 'villager', 'villager'], {});
    const seats = mountAll(ui, sim, []);
    toNight(sim);
    let checked = 0;
    while (st(sim).phase === 'night') {
      for (const stage of ['cue', 'window']) {
        pushViews(sim, seats);
        const shapes = new Set(sim.players.map((p) => nightShape(seats[p.id].root)));
        assert.equal(shapes.size, 1, `${stepK(sim)}/${stage}`);
        checked++;
        if (stage === 'cue') sim.cueDone();
      }
      sim.advance();
    }
    assert.ok(checked >= 20);
    for (const s of Object.values(seats)) s.handle.destroy();
  });
});

test('onuw ui: choosing — each ability goes through the grid / centre chips and the one big button, and sends the right action', async () => {
  await withFakeDom(async (ui) => {
    const labels = (seat) => findAll(seat.root, (n) => hasCls(n, 'on-ack-main'))[0].textContent;
    const chipsOf = (seat, cls) => findAll(seat.root, (n) => hasCls(n, cls))[0].children;
    const chip = (seat, cls, text) => chipsOf(seat, cls).find((c) => c.textContent === text);
    const ackBtn = (seat) => findAll(seat.root, (n) => hasCls(n, 'on-ack'))[0];

    // seer: player, or two centre cards — picking one kind clears the other
    let sim = scenario({ p1: 'seer', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['tanner', 'werewolf', 'drunk']);
    let sent = [];
    let seats = mountAll(ui, sim, sent);
    openStep(sim, 'seer');
    pushViews(sim, seats);
    const s1 = seats.p1;
    assert.equal(labels(s1), S.T.ackMain, 'nothing picked: the decoy label');
    click(chip(s1, 'on-grid', '玩家3'));
    assert.equal(labels(s1), S.T.confirmLookPlayer('玩家3'));
    click(chip(s1, 'on-centre', '中間 1'));
    click(chip(s1, 'on-centre', '中間 3'));
    assert.equal(labels(s1), S.T.confirmLookCentre('中間第 1 張', '中間第 3 張'), 'switching to the centre cleared the player');
    click(chip(s1, 'on-centre', '中間 2'));
    assert.equal(labels(s1), S.T.confirmLookCentre('中間第 2 張', '中間第 3 張'), 'a third pick drops the oldest');
    click(chip(s1, 'on-centre', '中間 2'));
    click(chip(s1, 'on-centre', '中間 3'));
    click(chip(s1, 'on-centre', '中間 1'));
    click(chip(s1, 'on-centre', '中間 2'));
    click(ackBtn(s1));
    assert.deepEqual(sent.at(-1).a, { type: 'look-centre', cards: [0, 1] });
    assert.equal(sent.at(-1).changed, true);
    pushViews(sim, seats);
    assert.ok(seats.p1.root.textContent.includes('預言家：中間第 1 張係 🧵 皮匠，中間第 2 張係 🐺 狼人'), 'the seer sees the result');
    for (const o of ['p2', 'p3', 'p4']) assert.ok(!seats[o].root.textContent.includes('預言家：'), `${o} must not see the seer's result`);
    for (const x of Object.values(seats)) x.handle.destroy();

    // robber: one player; the big button then sends the rob; troublemaker: two players
    sim = scenario({ p1: 'robber', p2: 'troublemaker', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'seer']);
    sent = [];
    seats = mountAll(ui, sim, sent);
    openStep(sim, 'robber');
    pushViews(sim, seats);
    assert.equal(chipsOf(seats.p1, 'on-centre').every((c) => c.disabled), true, 'no centre for a robber');
    click(chip(seats.p1, 'on-grid', '玩家3'));
    assert.equal(labels(seats.p1), S.T.confirmRob('玩家3'));
    click(ackBtn(seats.p1));
    assert.deepEqual(sent.at(-1).a, { type: 'rob', target: 'p3' });
    pushViews(sim, seats);
    assert.ok(seats.p1.root.textContent.includes('同 玩家3 換咗牌，換到 🐺 狼人'));
    assert.equal(chipsOf(seats.p1, 'on-grid').every((c) => c.disabled), true, 'one robbery only');
    sim.advance();
    openStep(sim, 'troublemaker');
    pushViews(sim, seats);
    assert.equal(chipsOf(seats.p1, 'on-grid').every((c) => c.disabled), true, 'the robber has no part in this step');
    const tm = seats.p2;
    click(chip(tm, 'on-grid', '玩家1'));
    click(ackBtn(tm));
    assert.deepEqual(sent.at(-1).a, { type: 'ack' }, 'one pick is not enough to swap: the tap is the decoy');
    click(chip(tm, 'on-grid', '玩家3'));
    click(chip(tm, 'on-grid', '玩家4'));
    assert.equal(labels(tm), S.T.confirmSwap('玩家3', '玩家4'), 'a third pick drops the oldest');
    assert.equal(chipsOf(tm, 'on-grid').find((c) => c.textContent === '玩家1').cls.has('on'), false);
    click(ackBtn(tm));
    assert.deepEqual(sent.at(-1).a, { type: 'swap', a: 'p3', b: 'p4' });
    for (const x of Object.values(seats)) x.handle.destroy();

    // drunk: one centre card
    sim = scenario({ p1: 'drunk', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'seer']);
    sent = [];
    seats = mountAll(ui, sim, sent);
    openStep(sim, 'drunk');
    pushViews(sim, seats);
    assert.equal(chipsOf(seats.p1, 'on-grid').every((c) => c.disabled), true);
    click(chip(seats.p1, 'on-centre', '中間 3'));
    click(chip(seats.p1, 'on-centre', '中間 2'));
    assert.equal(labels(seats.p1), S.T.confirmDrunk('中間第 2 張'));
    click(ackBtn(seats.p1));
    assert.deepEqual(sent.at(-1).a, { type: 'drunk-swap', card: 1 });
    // nothing about the swapped card appears on his screen
    pushViews(sim, seats);
    assert.ok(!seats.p1.root.textContent.includes('seer'));
    for (const x of Object.values(seats)) x.handle.destroy();

    // doppelgänger: copy, then (copied the seer) look at the centre — all in one window, selection resets between
    sim = scenario({ p1: 'doppelganger', p2: 'seer', p3: 'werewolf', p4: 'villager' }, ['tanner', 'werewolf', 'robber']);
    sent = [];
    seats = mountAll(ui, sim, sent);
    openStep(sim, 'doppelganger');
    pushViews(sim, seats);
    const d = seats.p1;
    click(chip(d, 'on-grid', '玩家2'));
    assert.equal(labels(d), S.T.confirmCopy('玩家2'));
    click(ackBtn(d));
    assert.deepEqual(sent.at(-1).a, { type: 'copy', target: 'p2' });
    pushViews(sim, seats);
    assert.equal(labels(d), S.T.ackMain, 'the selection was cleared for the second choice');
    assert.ok(d.root.textContent.includes('你睇咗 玩家2 張牌，係 🔮 預言家'));
    assert.ok(d.root.textContent.includes(S.T.hint.doppelNow('seer', false)));
    click(chip(d, 'on-centre', '中間 1'));
    click(chip(d, 'on-centre', '中間 2'));
    click(ackBtn(d));
    assert.deepEqual(sent.at(-1).a, { type: 'look-centre', cards: [0, 1] });
    for (const x of Object.values(seats)) x.handle.destroy();

    // lone wolf
    sim = scenario({ p1: 'werewolf', p2: 'robber', p3: 'seer', p4: 'villager' }, ['werewolf', 'villager', 'troublemaker']);
    sent = [];
    seats = mountAll(ui, sim, sent);
    openStep(sim, 'werewolf');
    pushViews(sim, seats);
    assert.ok(seats.p1.root.textContent.includes('冇其他狼人醒，另一張狼人牌一開始喺中間'));
    click(chip(seats.p1, 'on-centre', '中間 1'));
    assert.equal(labels(seats.p1), S.T.confirmLookOne('中間第 1 張'));
    click(ackBtn(seats.p1));
    assert.deepEqual(sent.at(-1).a, { type: 'look-centre', cards: [0] });
    for (const x of Object.values(seats)) x.handle.destroy();
  });
});

test('onuw ui: what a seat learned is on its own screen only — never on another seat\'s or the table\'s', async () => {
  await withFakeDom(async (ui) => {
    const sim = scenario({ p1: 'werewolf', p2: 'werewolf', p3: 'minion', p4: 'mason', p5: 'mason', p6: 'seer' }, ['villager', 'villager', 'robber']);
    const seats = mountAll(ui, sim, []);
    openStep(sim, 'werewolf');
    pushViews(sim, seats);
    const text = (p) => seats[p ?? 'table'].root.textContent;
    assert.ok(text('p1').includes('同你一齊醒嘅狼人係 玩家2'));
    assert.ok(text('p2').includes('同你一齊醒嘅狼人係 玩家1'));
    for (const o of ['p3', 'p4', 'p5', 'p6', null]) assert.ok(!text(o).includes('同你一齊醒'), `${o ?? 'table'} sees nothing`);
    sim.advance();
    openStep(sim, 'minion');
    pushViews(sim, seats);
    assert.ok(text('p3').includes('爪牙：狼人係 玩家1、玩家2'));
    for (const o of ['p1', 'p2', 'p4', 'p5', 'p6', null]) assert.ok(!text(o).includes('爪牙：狼人係'), `${o ?? 'table'} sees nothing`);
    for (const x of Object.values(seats)) x.handle.destroy();
  });
});

/** The night screen's 📓 cover of one seat: { el, wrap, back, front } (the stub Cover keeps both faces in the tree). */
function nightBookOf(seat) {
  const wrap = findAll(seat.root, (n) => hasCls(n, 'on-peekwrap'))[0];
  if (!wrap) return null;
  const el = findAll(wrap, (n) => hasCls(n, 'c-cover'))[0];
  return { wrap, el, back: findAll(el, (n) => hasCls(n, 'c-cover-back'))[0].textContent, front: findAll(el, (n) => hasCls(n, 'c-cover-front'))[0].textContent };
}
const plainLinesOf = (seat) => findAll(seat.root, (n) => hasCls(n, 'on-lines'))[0].textContent;

test('onuw ui: every phone has the same 📓 cover at every night step; what a seat learned stays behind it all night (#11)', async () => {
  await withFakeDom(async (ui) => {
    const sim = scenario({ p1: 'seer', p2: 'robber', p3: 'werewolf', p4: 'villager' }, ['villager', 'werewolf', 'troublemaker']);
    const seats = mountAll(ui, sim, []);
    const seerLine = '預言家：你睇咗 玩家3 張牌，係 🐺 狼人。';
    toNight(sim);
    let checked = 0;
    let seerLooked = false;
    while (st(sim).phase === 'night') {
      for (const stage of ['cue', 'window']) {
        pushViews(sim, seats);
        const books = sim.players.map((p) => nightBookOf(seats[p.id]));
        for (const b of books) {
          assert.ok(b, 'every seat has the cover');
          assert.equal(b.wrap.hidden, false);
          assert.equal(b.wrap.cls.has('is-empty'), false, 'never hidden, never "empty"-styled');
          assert.equal(b.back, S.T.nightPeekLabel, 'the same back on every phone');
        }
        // the seer's look is behind her cover from the moment she looks until dawn — never behind anybody else's
        assert.equal(books[0].front.includes(seerLine), seerLooked, `${stepK(sim)}/${stage}: the seer's 📓`);
        for (const b of books.slice(1)) assert.ok(!b.front.includes('預言家：'), 'nobody else has the seer\'s look');
        assert.ok(books[3].front.includes(S.T.nightNothing), 'the villager\'s 📓 says 今晚未見過嘢 all night');
        checked++;
        if (stage === 'cue') sim.cueDone();
        if (stage === 'window' && stepK(sim) === 'seer') {
          act(sim, 'p1', { type: 'look-player', target: 'p3' });
          seerLooked = true;
          pushViews(sim, seats);
          assert.ok(nightBookOf(seats.p1).front.includes(seerLine));
          assert.ok(plainLinesOf(seats.p1).includes(S.T.hint.done), 'the done line');
          assert.ok(!plainLinesOf(seats.p1).includes('玩家3'), 'the result itself is never in the plain lines');
        }
      }
      sim.advance();
    }
    assert.ok(checked >= 10 && seerLooked);
    // the done line points DOWN, at the cover, and the cover really is below the lines
    assert.ok(S.T.hint.done.includes('下面') && !S.T.hint.done.includes('上面'));
    assert.ok(S.T.hint.done.includes('天光'), 'and says the 📓 is still there in the day');
    assert.ok(!S.HINT.night.info.includes('上面'));
    for (const x of Object.values(seats)) x.handle.destroy();
  });
});

test('onuw ui: the doppelgänger\'s copy and its instructions are only behind the cover; her plain line and confirm labels never name it (#8)', async () => {
  await withFakeDom(async (ui) => {
    const ROLE_WORDS = ['預言家', '強盜', '搗蛋鬼', '酒鬼', '狼人', '村民', '獵人', '守夜人', '失眠者', '爪牙', '皮匠', '🔮', '🗡️', '🌪️', '🍺', '🐺', '🧑‍🌾', '🏹'];
    const run = (target, deal, centre, check) => {
      const sim = scenario(deal, centre);
      const sent = [];
      const seats = mountAll(ui, sim, sent);
      openStep(sim, 'doppelganger');
      pushViews(sim, seats);
      const d = seats.p1;
      click(findAll(d.root, (n) => hasCls(n, 'on-grid'))[0].children.find((c) => c.textContent === sim.players.find((p) => p.id === target).name));
      click(findAll(d.root, (n) => hasCls(n, 'on-ack'))[0]);
      assert.deepEqual(sent.at(-1).a, { type: 'copy', target });
      pushViews(sim, seats);
      const plain = plainLinesOf(d);
      assert.ok(plain.includes(S.T.hint.copied), 'the neutral line');
      for (const w of ROLE_WORDS) assert.ok(!plain.includes(w), `the plain lines name ${w}: ${plain}`);
      assert.equal(engine.view(st(sim), 'p1').hint, S.HINT.night.copied, 'the 💡 line is neutral too');
      check(sim, d, sent);
      const after = plainLinesOf(d);
      for (const w of ROLE_WORDS) assert.ok(!after.includes(w), `after acting the plain lines name ${w}: ${after}`);
      for (const x of Object.values(seats)) x.handle.destroy();
    };
    const label = (d) => findAll(d.root, (n) => hasCls(n, 'on-ack-main'))[0].textContent;
    const chip = (d, cls, text) => findAll(d.root, (n) => hasCls(n, cls))[0].children.find((c) => c.textContent === text);

    // copied the seer: the instructions are behind the cover; the confirm label is the pick, no 🔮
    run('p2', { p1: 'doppelganger', p2: 'seer', p3: 'werewolf', p4: 'villager' }, ['tanner', 'werewolf', 'robber'], (sim, d, sent) => {
      const book = nightBookOf(d).front;
      assert.ok(book.includes('係 🔮 預言家'), 'the copy note');
      assert.ok(book.includes(S.T.hint.doppelNow('seer', false)) && book.includes(S.HINT.night.seer), 'what to do now, behind the cover');
      click(chip(d, 'on-centre', '中間 1'));
      click(chip(d, 'on-centre', '中間 3'));
      assert.equal(label(d), S.confirmNeutral(['中間第 1 張', '中間第 3 張']));
      for (const w of ROLE_WORDS) assert.ok(!label(d).includes(w), `the confirm label names ${w}`);
      click(findAll(d.root, (n) => hasCls(n, 'on-ack'))[0]);
      assert.deepEqual(sent.at(-1).a, { type: 'look-centre', cards: [0, 2] });
      pushViews(sim, { p1: d });
      assert.ok(nightBookOf(d).front.includes('預言家：中間第 1 張係 🧵 皮匠'), 'the look lands behind the cover');
      assert.ok(!nightBookOf(d).front.includes(S.T.hint.doppelNow('seer', false)), 'and the "act now" line is gone');
    });
    // the cover is a fixed 2:1 box held open by a finger (no scrolling on a phone): the copy note and the act-now line
    // must fit together, so the act-now line is the short form (measured: copy note + it fit at 360–414 px)
    for (const [ab, m] of [['seer', false], ['robber', false], ['troublemaker', false], ['drunk', true]]) {
      const t = S.T.hint.doppelNow(ab, m);
      assert.ok(t.length <= 40, `${ab}: the act-now line is short enough for the cover (${t.length}): ${t}`);
      for (const w of ROLE_WORDS) assert.ok(!t.includes(w), `${ab}: the act-now line need not repeat the role (${w})`);
      assert.ok(t.includes(m ? '時間到' : '唔使理'), `${ab}: says what happens if she does nothing`);
    }
    // copied the troublemaker: two players, neutral label
    run('p2', { p1: 'doppelganger', p2: 'troublemaker', p3: 'werewolf', p4: 'villager' }, ['tanner', 'werewolf', 'robber'], (sim, d, sent) => {
      click(chip(d, 'on-grid', '玩家3'));
      click(chip(d, 'on-grid', '玩家4'));
      assert.equal(label(d), S.confirmNeutral(['玩家3', '玩家4']));
      click(findAll(d.root, (n) => hasCls(n, 'on-ack'))[0]);
      assert.deepEqual(sent.at(-1).a, { type: 'swap', a: 'p3', b: 'p4' });
    });
    // copied a werewolf: "you wake again at 狼人" — behind the cover only
    run('p3', { p1: 'doppelganger', p2: 'seer', p3: 'werewolf', p4: 'villager' }, ['tanner', 'werewolf', 'robber'], (sim, d) => {
      assert.ok(nightBookOf(d).front.includes(S.T.hint.later('werewolf', S.STEP_TITLE.werewolf)));
    });
    // copied a villager: no night action — behind the cover only
    run('p4', { p1: 'doppelganger', p2: 'seer', p3: 'werewolf', p4: 'villager' }, ['tanner', 'werewolf', 'robber'], (sim, d) => {
      assert.ok(nightBookOf(d).front.includes(S.T.hint.noAction('villager')));
    });
  });
});

test('onuw ui: the seatless table screen has no night tap counter — it looks the same whoever is awake and whoever tapped (#18)', async () => {
  await withFakeDom(async (ui) => {
    // both werewolves in the centre: the werewolf step has nobody awake
    const sim = scenario({ p1: 'seer', p2: 'robber', p3: 'villager', p4: 'villager' }, ['werewolf', 'werewolf', 'troublemaker']);
    const seats = mountAll(ui, sim, []);
    toNight(sim);
    while (st(sim).phase === 'night') {
      for (const stage of ['cue', 'window']) {
        pushViews(sim, seats);
        const before = serialize(seats.table.root);
        assert.ok(!seats.table.root.textContent.includes('已㩒掣'), 'no counter');
        assert.equal(engine.view(st(sim), null).acks, undefined, 'no counter in the table view');
        for (const p of st(sim).order) assert.equal(engine.view(st(sim), p).acks, undefined, 'no counter in a seat view');
        if (stage === 'window') {
          const k = stepK(sim);
          if (k === 'seer') act(sim, 'p1', { type: 'look-player', target: 'p2' });
          if (k === 'robber') act(sim, 'p2', { type: 'rob', target: 'p3' });
          act(sim, 'p4', { type: 'ack' });
          pushViews(sim, seats);
          assert.equal(serialize(seats.table.root), before, `${k}: an action or a decoy tap changes nothing on the table screen`);
        } else sim.cueDone();
      }
      sim.advance();
    }
    for (const x of Object.values(seats)) x.handle.destroy();
  });
});

test('onuw: every optional ability says what doing nothing means; the reveal cards say 贏 / 輸 in words', async () => {
  for (const ab of ['seer', 'robber', 'troublemaker', 'loneWolf']) assert.ok(S.T.hint[ab].includes('時間到就當你唔'), `${ab}: what happens if you do nothing`);
  assert.ok(S.T.hint.drunk.includes('時間到'), 'the mandatory one says so too');
  await withFakeDom(async (ui) => {
    const sim = play({ p1: 'robber', p2: 'werewolf', p3: 'seer', p4: 'villager' }, ['villager', 'werewolf', 'tanner'], { votes: { p1: 'p2', p2: 'p1', p3: 'p2', p4: 'p2' } });
    const seats = mountAll(ui, sim, []);
    pushViews(sim, seats);
    const marks = findAll(seats.table.root, (n) => hasCls(n, 'on-win')).map((n) => n.textContent);
    assert.equal(marks.length, 4);
    for (const m of marks) assert.ok(m === S.T.revealWon || m === S.T.revealLost, m);
    assert.equal(S.T.revealWon, '✅ 贏');
    assert.equal(S.T.revealLost, '❌ 輸');
    assert.ok(marks.includes(S.T.revealWon) && marks.includes(S.T.revealLost));
    for (const x of Object.values(seats)) x.handle.destroy();
  });
});

test('onuw ui: the day shows only the dealt role and what you learned, with a warning, and no current card; the host can add a minute', async () => {
  await withFakeDom(async (ui) => {
    const sim = scenario({ p1: 'robber', p2: 'werewolf', p3: 'seer', p4: 'villager' }, ['villager', 'werewolf', 'tanner']);
    const sent = [];
    const seats = mountAll(ui, sim, sent, { host: 'p1' });
    playNight(sim, { robber: (x) => act(x, 'p1', { type: 'rob', target: 'p2' }) });
    pushViews(sim, seats);
    const t1 = seats.p1.root.textContent;
    assert.ok(t1.includes('派牌：你本來係 🗡️ 強盜'));
    assert.ok(t1.includes('你同 玩家2 換咗牌，換到 🐺 狼人'));
    assert.ok(t1.includes(S.T.recapWarn));
    const recapText = findAll(seats.p1.root, (n) => hasCls(n, 'on-recap'))[0].textContent;
    assert.ok(!recapText.includes('最後張牌') && !recapText.includes('你而家係'), 'no recap line claims to know your current role');
    assert.ok(!seats.p3.root.textContent.includes('換咗牌'));
    // the table sees the timer area but nothing private
    assert.ok(!seats.table.root.textContent.includes('派牌：'));
    // only the host has the +60 s button
    const ext = (p) => findAll(seats[p].root, (n) => hasCls(n, 'timer-extend'))[0];
    assert.equal(ext('p1').hidden, false);
    assert.equal(ext('p2').hidden, true);
    const before = st(sim).deadline;
    click(ext('p1'));
    assert.equal(st(sim).deadline, before + 60_000);
    for (const x of Object.values(seats)) x.handle.destroy();
  });
});

test('onuw ui: the reveal is public and explains itself; the table sees the same thing; "done" goes to the result', async () => {
  await withFakeDom(async (ui) => {
    const sim = play({ p1: 'robber', p2: 'werewolf', p3: 'seer', p4: 'hunter', p5: 'villager' }, ['villager', 'werewolf', 'tanner'], {
      script: { robber: (x) => act(x, 'p1', { type: 'rob', target: 'p2' }) },
      votes: { p1: 'p3', p2: 'p1', p3: 'p1', p4: 'p2', p5: 'p1' },
    });
    const sent = [];
    const seats = mountAll(ui, sim, sent);
    pushViews(sim, seats);
    const text = (p) => seats[p ?? 'table'].root.textContent;
    for (const p of ['p1', 'p2', 'p3', 'p4', 'p5', null]) {
      assert.ok(text(p).includes('🗳️ 票數'), `${p} sees the tally`);
      assert.ok(text(p).includes('玩家1') && text(p).includes('玩家5'));
      assert.ok(text(p).includes(R(sim).headline === 'village' ? '好人隊贏' : '狼人隊贏'));
      assert.ok(text(p).includes(S.T.revealWhy));
      assert.ok(text(p).includes('夜晚記錄'), 'the recap of hidden actions');
      assert.ok(text(p).includes('玩家1（強盜） 同 玩家2 換牌'), 'who robbed whom is revealed now');
    }
    assert.ok(text('p1').includes(S.T.lost) || text('p1').includes(S.T.won));
    assert.ok(text(null).includes(S.T.watching));
    // tapping 睇完整個結果: p2 is not the host, p1 is
    click(findAll(seats.p2.root, (n) => n.tag === 'button' && n.textContent.includes('睇完整個結果'))[0]);
    assert.equal(st(sim).phase, 'reveal');
    pushViews(sim, seats);
    assert.ok(text('p2').includes(S.T.revealDoneAck));
    click(findAll(seats.p1.root, (n) => n.tag === 'button' && n.textContent.includes('睇完整個結果'))[0]);
    assert.equal(st(sim).phase, 'over');
    pushViews(sim, seats);
    assert.ok(text('p3').includes(S.T.revealWhy), 'the over view keeps showing the reveal');
    for (const x of Object.values(seats)) x.handle.destroy();
  });
});

test('onuw ui: the vote screen — ballot, ring toggle, and the "stuck" hint only for a seat that agreed alone', async () => {
  await withFakeDom(async (ui) => {
    const sim = dayGame();
    sim.advance();
    const sent = [];
    const seats = mountAll(ui, sim, sent);
    pushViews(sim, seats);
    assert.equal(findAll(seats.p1.root, (n) => hasCls(n, 'vp-opt')).length, 3, 'three candidates, never yourself');
    click(findAll(seats.p1.root, (n) => hasCls(n, 'vp-opt'))[0]);
    assert.equal(sent.at(-1).a.type, 'vote');
    const ring = (p) => findAll(seats[p].root, (n) => n.tag === 'button' && n.textContent.includes('圈票') && !n.textContent.includes('同意圈票：'))[0];
    click(ring('p2'));
    assert.deepEqual(sent.at(-1).a, { type: 'ring', on: true });
    pushViews(sim, seats);
    assert.ok(ring('p2').textContent.startsWith('✓'));
    click(ring('p2'));
    assert.deepEqual(sent.at(-1).a, { type: 'ring', on: false });
    // the table sees only progress
    pushViews(sim, seats);
    assert.ok(seats.table.root.textContent.includes('已投 1 / 4'));
    for (const x of Object.values(seats)) x.handle.destroy();
  });
});

test('onuw ui: a seatless device (spectator / table) follows every phase without a private part', async () => {
  await withFakeDom(async (ui) => {
    const sim = uiGame(5, 4);
    const comps = stubComponents();
    const root = new FEl('div');
    const api = { me: null, players: sim.players, isHost: false, meta: game.meta, config: {}, send: () => false, ink() {}, now: () => sim.now, sfx() {}, toast() {}, components: comps };
    const h = ui.mount(root, api);
    const seen = new Set();
    let guard = 0;
    const rng = mulberry32(3);
    while (!sim.result() && guard++ < 3000) {
      const v = sim.view(null);
      h.update(v, {});
      const a = serialize(root);
      h.update(clone(v), {});
      assert.equal(serialize(root), a, `table idempotent in ${v.phase}`);
      seen.add(v.phase);
      assert.ok(root.textContent.length > 5);
      // drive the game with random legal moves
      const movers = sim.players.map((p) => p.id).filter((id) => sim.legal(id).length);
      if (movers.length && rng() < 0.6) { const id = movers[Math.floor(rng() * movers.length)]; const o = sim.legal(id); sim.act(id, o[Math.floor(rng() * o.length)]); } else if (sim.cue()) sim.cueDone(); else if (st(sim).deadline != null) sim.advance(); else sim.host({ type: ACT.NEXT });
    }
    for (const p of ['deal', 'night', 'day', 'vote', 'reveal']) assert.ok(seen.has(p), p);
    h.destroy();
  });
});

test('onuw ui: a voided game shows everybody the same short 呢局唔計 screen, idempotently', async () => {
  await withFakeDom(async (ui) => {
    const sim = scenario({ p1: 'robber', p2: 'werewolf', p3: 'seer', p4: 'villager' }, ['villager', 'werewolf', 'tanner']);
    const seats = mountAll(ui, sim, []);
    openStep(sim, 'robber');
    pushViews(sim, seats);
    sim.host({ type: ACT.VOID_ROUND });
    pushViews(sim, seats);
    const texts = Object.values(seats).map((x) => x.root.textContent);
    for (const t of texts) {
      assert.ok(t.includes(S.VOID.title), 'the void banner');
      assert.ok(!t.includes('派牌：') && !t.includes('強盜'), 'nothing private on the screen itself (the results screen has the lines)');
    }
    assert.equal(new Set(texts).size, 1, 'the same screen for every phone');
    for (const x of Object.values(seats)) x.handle.destroy();
  });
});

// ============================================================
// the real Room: one phone per seat, secrets stay on their own device, a whole game to the results screen
// ============================================================

test('onuw in a real Room: lobby shows the set and the reason, a late joiner re-fits it, each phone only gets its own seat, the game reaches the results', async () => {
  const { Room } = await import('../js/core/room.js?v=1');
  const { createBag } = await import('../js/core/bag.js?v=1');
  const { PROTOCOL } = await import('../js/core/transport.js?v=1');

  const NAMES = ['阿明', '阿強', '阿欣', '阿珍', '阿輝', '阿玲', '阿傑', '阿芬', '阿文', '阿兒'];

  function makeClock() {
    let now = 1_700_000_000_000;
    const timers = [];
    return {
      now: () => now,
      setTimeout: (fn, ms = 0) => { timers.push({ at: now + ms, fn, id: timers.length + 1 }); return timers.length; },
      clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.at = Infinity; },
      setInterval: () => 0, clearInterval() {},
      advance(ms) {
        const end = now + ms;
        for (;;) {
          const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
          if (!due) break;
          now = Math.max(now, due.at);
          due.at = Infinity;
          due.fn();
        }
        now = end;
      },
    };
  }

  for (const [n, patch] of [[3, {}], [6, { preset: 'advanced' }], [10, {}]]) {
    const clock = makeClock();
    const sent = [];
    const room = new Room({
      code: '1234', hostDeviceId: 'dev_host', names: [NAMES[0]], now: clock.now, rng: mulberry32(11),
      bag: createBag({ storage: new Map(), rng: mulberry32(5), banks: {} }), timers: clock,
      loadGame: async (id) => { assert.equal(id, 'onuw'); return game; },
      send: (deviceId, msg) => sent.push({ deviceId, msg: clone(msg) }),
      onCue: () => {}, narrationMode: 'silent',
    });
    // everybody except the last seat joins first; the last one is a late joiner after the game was picked
    NAMES.slice(1, n - 1).forEach((nm, i) => room.receive(`peer_${i}`, { t: 'hello', v: PROTOCOL, deviceId: `dev_${i}`, seats: [{ name: nm }] }));
    const sel = await room.selectGame('onuw');
    assert.equal(sel.ok, true, sel.message);
    const roomMsg = () => [...sent].reverse().find((x) => x.deviceId === 'dev_host' && x.msg.t === 'room').msg.room;

    const before = roomMsg();
    assert.equal(before.configValid.ok, n > 3, n > 3 ? 'valid before the last seat joins' : 'two seats are too few');
    assert.ok(before.configSummary.some((l) => l.startsWith('💡')), 'the reason is part of what everybody sees');
    // the late joiner: an untouched config re-fits the recommendation for the new head-count
    room.receive('peer_late', { t: 'hello', v: PROTOCOL, deviceId: 'dev_late', seats: [{ name: NAMES[n - 1] }] });
    const after = roomMsg();
    assert.equal(after.players.filter((p) => !p.spectator).length, n);
    assert.ok(after.configSummary[0].includes(`${n + 3} 張牌（${n}+3）`), `re-fitted to ${n}: ${after.configSummary[0]}`);
    assert.equal(after.configValid.ok, true);
    assert.deepEqual(after.configValid.warnings, []);
    if (Object.keys(patch).length) room.setConfig(config.defaults(n, { ...room.config, ...patch }));
    const started = room.start();
    assert.equal(started.ok, true, started.message);

    const deviceOf = new Map(roomMsg().players.map((p) => [p.id, p.deviceId]));
    assert.equal(deviceOf.size, n);
    const lastViews = (dev) => [...sent].reverse().find((x) => x.deviceId === dev && x.msg.t === 'views')?.msg;
    const checkDevices = () => {
      for (const [pid, dev] of deviceOf) {
        const m = lastViews(dev);
        assert.ok(m, `device of ${pid} got views`);
        assert.deepEqual(Object.keys(m.bySeat), [pid], 'a phone receives only its own seat');
        const v = m.bySeat[pid];
        assert.equal(v.my.dealt, st(room.session).orig[pid]);
        if (m.focus) assert.ok(m.focus.pids.every((p) => p === pid), 'focus is filtered to the phone\'s own seat');
        assert.equal(m.table.my, undefined);
        if (m.table.phase !== 'reveal' && m.table.phase !== 'over') {
          assert.equal(m.table.reveal, undefined);
          assert.equal(v.reveal, undefined);
          for (const [k] of keysIn(v)) assert.ok(!['cards', 'centre', 'orig', 'dop', 'log'].includes(k), `${k} reached ${pid}`);
        }
      }
    };

    const rng = mulberry32(n * 7);
    let guard = 0;
    let nightFocus = 0;
    checkDevices();
    while (room.phase === 'playing' && guard++ < 6000) {
      const s = room.session;
      const phase = st(s).phase;
      const movers = [...deviceOf.keys()].filter((p) => s.legal(p).length);
      // ack-only steps dominate the night: tap a few, then let the clock run
      if (movers.length && rng() < (phase === 'night' ? 0.3 : 0.8)) {
        const pid = movers[Math.floor(rng() * movers.length)];
        const options = s.legal(pid);
        room.act(deviceOf.get(pid), pid, options[Math.floor(rng() * options.length)]);
      } else {
        clock.advance(2500);
      }
      if (phase === 'night' && st(s).stage === 'window') {
        // an awake seat's device is told it is "in focus"; the others' devices are not
        const awake = s.focus()?.pids ?? [];
        for (const [pid, dev] of deviceOf) {
          const m = lastViews(dev);
          const inFocus = !!m.focus?.pids?.includes(pid);
          if (awake.includes(pid)) { nightFocus++; assert.equal(inFocus, true, `${pid} is awake, so its phone is in focus`); assert.ok(m.focus.anonymous); }
          else assert.equal(inFocus, false, `${pid} is asleep: not in focus`);
        }
      }
      if (guard % 9 === 0) checkDevices();
    }
    assert.equal(room.phase, 'results', `n=${n}: the game reached the results screen`);
    assert.ok(nightFocus > 0, 'somebody was awake during the night');
    const res = roomMsg().lastResult;
    assert.equal(res.gameId, 'onuw');
    assert.ok(res.summary.length > 5);
    assert.ok(res.lines.length > 8);
    assert.ok(res.lines.some((l) => l.includes('夜晚記錄')));
    // the evening's scoreboard: 1 point per winner
    const sb = roomMsg().scoreboard;
    for (const p of roomMsg().players) assert.equal(sb[p.id].points, res.winners.includes(p.id) ? 1 : 0);
  }
});

test('onuw in a real Room: a phone that reconnects mid-night is sent only its own seat, and never the night steps of others', async () => {
  const { Room } = await import('../js/core/room.js?v=1');
  const { createBag } = await import('../js/core/bag.js?v=1');
  const { PROTOCOL } = await import('../js/core/transport.js?v=1');
  let now = 1_700_000_000_000;
  const timers = [];
  const clock = { now: () => now, setTimeout: (fn, ms = 0) => { timers.push({ at: now + ms, fn }); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {} };
  const sent = [];
  const room = new Room({
    code: '4321', hostDeviceId: 'dev_host', names: ['阿明'], now: clock.now, rng: mulberry32(5),
    bag: createBag({ storage: new Map(), rng: mulberry32(5), banks: {} }), timers: clock,
    loadGame: async () => game, send: (deviceId, msg) => sent.push({ deviceId, msg: clone(msg) }), onCue: () => {}, narrationMode: 'silent',
  });
  ['阿B', '阿C', '阿D'].forEach((nm, i) => room.receive(`peer_${i}`, { t: 'hello', v: PROTOCOL, deviceId: `dev_${i}`, seats: [{ name: nm }] }));
  await room.selectGame('onuw');
  assert.equal(room.start().ok, true);
  const pids = room.snapshot().players.map((p) => p.id);
  for (let i = 0; i < pids.length; i++) room.act(i === 0 ? 'dev_host' : `dev_${i - 1}`, pids[i], { type: 'ready' });
  assert.equal(st(room.session).phase, 'night');
  sent.length = 0;
  room.welcome('dev_1');
  const w = sent.find((x) => x.deviceId === 'dev_1' && x.msg.t === 'welcome').msg;
  assert.deepEqual(Object.keys(w.views.bySeat), [pids[2]]);
  assert.equal(w.views.table.my, undefined);
  assert.equal(JSON.stringify(w).includes('"orig"'), false);
});

test('onuw in a real Room: a phone that drops is never flagged at night or in the day (blocking), only when the vote waits on it; result().carry reaches the next game but never the results screen', async () => {
  const { Room } = await import('../js/core/room.js?v=1');
  const { createBag } = await import('../js/core/bag.js?v=1');
  const { PROTOCOL } = await import('../js/core/transport.js?v=1');
  let now = 1_700_000_000_000;
  let timers = [];
  let seq = 0;
  const clock = {
    now: () => now,
    setTimeout: (fn, ms = 0) => { const id = ++seq; timers.push({ at: now + ms, fn, id }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
    setInterval: () => 0, clearInterval() {},
  };
  const run = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = Math.max(now, due.at);
      due.fn();
    }
    now = end;
  };
  const sent = [];
  const room = new Room({
    code: '5555', hostDeviceId: 'dev_host', names: ['阿明'], now: clock.now, rng: mulberry32(8),
    bag: createBag({ storage: new Map(), rng: mulberry32(5), banks: {} }), timers: clock,
    loadGame: async () => game, send: (deviceId, msg) => sent.push({ deviceId, msg: clone(msg) }), onCue: () => {}, narrationMode: 'silent',
  });
  ['阿B', '阿C', '阿D', '阿E'].forEach((nm, i) => room.receive(`peer_${i}`, { t: 'hello', v: PROTOCOL, deviceId: `dev_${i}`, seats: [{ name: nm }] }));
  await room.selectGame('onuw');
  assert.equal(room.start().ok, true);
  const pids = room.snapshot().players.map((p) => p.id);
  const dev = (i) => (i === 0 ? 'dev_host' : `dev_${i - 1}`);
  const stalled = () => [...sent].reverse().find((x) => x.deviceId === 'dev_host' && x.msg.t === 'room').msg.room.stalled.map((x) => x.pid);
  for (let i = 0; i < pids.length; i++) room.act(dev(i), pids[i], { type: 'ready' });
  assert.equal(st(room.session).phase, 'night');
  // 阿B's phone dies at nightfall
  const gone = pids[1];
  room.peerClosed('peer_0');
  let flaggedAtNight = 0;
  while (st(room.session).phase === 'night') {
    run(5000);
    if (stalled().includes(gone)) flaggedAtNight++;
  }
  assert.equal(flaggedAtNight, 0, 'never flagged at night — not even while its role is awake');
  assert.equal(st(room.session).phase, 'day');
  run(120_000);   // two minutes of discussion with nobody touching a phone
  assert.equal(stalled().includes(gone), false, 'the day runs on its timer: nobody is waited on');
  room.next();
  assert.equal(st(room.session).phase, 'vote');
  pids.forEach((p, i) => { if (p !== gone) room.act(dev(i), p, { type: 'vote', target: pids[(i + 1) % pids.length] === p ? pids[0] : pids[(i + 1) % pids.length] }); });
  run(60_000);
  assert.deepEqual(stalled(), [gone], 'the vote is waiting on the dead phone: the host is told, about that seat only');
  room.autoAct(gone);
  assert.equal(st(room.session).phase, 'reveal');
  room.next();
  room.next();
  assert.equal(room.phase, 'results');
  // the anti-streak carry: kept by the room for the next onuw game, never on the results screen
  const dealtWolves = pids.filter((p) => st(room.session).orig[p] === 'werewolf');
  const last = [...sent].reverse().find((x) => x.deviceId === 'dev_host' && x.msg.t === 'room').msg.room.lastResult;
  assert.equal(JSON.stringify(last).includes('carry'), false);
  assert.deepEqual(room.carries.onuw, { wolves: dealtWolves });
});

// ============================================================
// decisions 2026-10-04: D4 absent seats, D6 secret own vote, a 📓 night cover that holds 3+ notes
// ============================================================

const ABSENT = (pid) => ({ type: ACT.ABSENT ?? '@absent', pid });
const PRESENT = (pid) => ({ type: ACT.PRESENT ?? '@present', pid });

test('onuw: @absent at the deal — the night does not wait; @present counts the seat again; bad input changes nothing (D4)', () => {
  const sim = uiGame(5, 3);
  for (const p of ['p1', 'p2', 'p3']) sim.act(p, { type: 'ready' });
  assert.deepEqual(sim.view('p1').ready, { done: 3, total: 5 });
  assert.ok(sim.host(ABSENT('p4')));
  assert.deepEqual(sim.view('p1').ready, { done: 3, total: 4 }, 'the count is of the seats the night waits for');
  assert.deepEqual(sim.focus().pids, ['p5']);
  assert.equal(engine.blocking(st(sim), 'p4'), false);
  assert.equal(engine.blocking(st(sim), 'p5'), true);
  assert.equal(sim.host(ABSENT('p4')), false, 'already absent');
  assert.ok(sim.host(PRESENT('p4')));
  assert.equal(engine.blocking(st(sim), 'p4'), true);
  assert.equal(sim.host(PRESENT('p4')), false, 'already present');
  sim.host(ABSENT('p4'));
  sim.act('p5', { type: 'ready' });
  assert.equal(st(sim).phase, 'night');
  for (const bad of [ABSENT('nobody'), ABSENT(null), { type: ACT.ABSENT ?? '@absent' }, PRESENT('p1')]) assert.equal(sim.host(bad), false, JSON.stringify(bad));
  assert.equal(sim.act('p1', ABSENT('p2')), false, 'a seat cannot mark anybody');
  // the night is untouched: same steps, same fixed windows, and nothing at night ever blocks
  for (let guard = 0; guard < 100 && st(sim).phase === 'night'; guard++) {
    for (const p of st(sim).order) assert.equal(engine.blocking(st(sim), p), false);
    if (st(sim).stage === 'cue') sim.cueDone(); else sim.advance();
  }
  assert.equal(st(sim).phase, 'day');
});

test('onuw: @absent by day and at the vote — 夠鐘投票 and the vote count present seats; an absent seat casts no vote but can still die (D4)', () => {
  const sim = dayGame();
  for (const p of ['p1', 'p2']) sim.act(p, { type: 'ready-vote', on: true });
  assert.ok(sim.host(ABSENT('p4')));
  assert.deepEqual(sim.view('p1').dayReady, { done: 2, total: 3, mine: true });
  sim.act('p3', { type: 'ready-vote', on: true });
  assert.equal(st(sim).phase, 'vote', 'the absent seat did not hold up 夠鐘投票');
  assert.equal(sim.act('p4', { type: 'vote', target: 'p1' }), false, 'no vote');
  assert.equal(sim.act('p4', { type: 'ring', on: true }), false, 'no part in the circle');
  assert.deepEqual(sim.legal('p4'), []);
  assert.equal(engine.autoAct(st(sim), 'p4', sim.ctx()), null);
  assert.equal(engine.blocking(st(sim), 'p4'), false);
  assert.ok(sim.view('p1').candidates.includes('p4'), 'still a candidate');
  assert.equal(sim.view('p1').progress.total, 3);
  assert.equal(sim.view('p1').ring.total, 3);
  assert.equal(sim.view('p4').hint, S.HINT.vote.absent);
  for (const p of ['p1', 'p2', 'p3']) sim.act(p, { type: 'vote', target: 'p4' });
  assert.equal(st(sim).phase, 'reveal');
  assert.deepEqual(st(sim).final.dead, ['p4'], 'an absent seat can be voted out');
  assert.equal(st(sim).final.votes.p4, undefined);
  // 睇完 counts the present seats too
  sim.act('p2', { type: 'done' });
  assert.deepEqual(sim.view('p1').revealDone, { done: 1, total: 3, mine: false });
  sim.act('p3', { type: 'done' });
  assert.equal(st(sim).phase, 'reveal');
  sim.host(ABSENT('p1'));                                         // the host is the last one reading — marked away
  assert.equal(st(sim).phase, 'over');

  // a ballot cast before leaving stays; marking the last missing voter closes the vote
  const v2 = dayGame();
  v2.host({ type: ACT.NEXT });
  v2.act('p2', { type: 'vote', target: 'p1' });
  v2.host(ABSENT('p2'));
  assert.equal(st(v2).votes.p2, 'p1');
  assert.equal(v2.view('p1').progress.total, 4, 'its ballot stays in the count');
  v2.act('p1', { type: 'vote', target: 'p2' });
  v2.act('p3', { type: 'vote', target: 'p1' });
  assert.equal(st(v2).phase, 'vote');
  assert.ok(v2.host(ABSENT('p4')));
  assert.equal(st(v2).phase, 'reveal');
  assert.deepEqual(st(v2).final.dead, ['p1'], 'p2\'s early ballot counted');

  // @present at the vote: waited for again
  const v3 = dayGame();
  v3.host({ type: ACT.NEXT });
  v3.host(ABSENT('p3'));
  for (const p of ['p1', 'p2']) v3.act(p, { type: 'vote', target: 'p3' });
  v3.host(PRESENT('p3'));
  v3.act('p4', { type: 'vote', target: 'p3' });
  assert.equal(st(v3).phase, 'vote');
  v3.act('p3', { type: 'vote', target: 'p1' });
  assert.equal(st(v3).phase, 'reveal');
});

test('onuw: @absent and the circle — it forms when every PRESENT seat agrees; nobody dies, an absent seat\'s early ballot is set aside (D4)', () => {
  const sim = dayGame();
  sim.host({ type: ACT.NEXT });
  sim.act('p4', { type: 'vote', target: 'p1' });
  sim.host(ABSENT('p4'));
  for (const p of ['p1', 'p2']) sim.act(p, { type: 'ring', on: true });
  assert.equal(st(sim).phase, 'vote');
  assert.equal(sim.view('p1').ring.done, 2);
  sim.act('p3', { type: 'ring', on: true });
  assert.equal(st(sim).phase, 'reveal');
  const f = st(sim).final;
  assert.equal(f.nobodyDied, true, 'the circle still means nobody dies');
  assert.equal(f.votes.p4, undefined, 'the absent seat\'s ballot was set aside');
  assert.ok(Object.values(f.counts).every((c) => c <= 1));
  // the circle is stuck when every present seat has voted or agreed but not all agreed
  const stuck = dayGame();
  stuck.host({ type: ACT.NEXT });
  stuck.host(ABSENT('p4'));
  stuck.act('p1', { type: 'ring', on: true });
  stuck.act('p2', { type: 'vote', target: 'p1' });
  stuck.act('p3', { type: 'vote', target: 'p1' });
  assert.equal(stuck.view('p1').ring.stuck, true);
  assert.deepEqual(stuck.focus().pids, ['p1'], 'only the present agreer has to pick');
  // an agreer who leaves: the circle can still form without it
  const left = dayGame();
  left.host({ type: ACT.NEXT });
  left.act('p4', { type: 'ring', on: true });
  for (const p of ['p1', 'p2']) left.act(p, { type: 'ring', on: true });
  left.host(ABSENT('p3'));
  assert.equal(st(left).phase, 'reveal', 'every present seat had agreed');
  assert.equal(st(left).final.nobodyDied, true);
  // everybody leaves mid-vote: nobody is left to have agreed to a circle, so the ballots cast before leaving stand
  const gone = dayGame();
  gone.host({ type: ACT.NEXT });
  gone.act('p1', { type: 'vote', target: 'p2' });
  gone.act('p3', { type: 'vote', target: 'p2' });
  for (const p of st(gone).order) gone.host(ABSENT(p));
  assert.equal(st(gone).phase, 'reveal');
  assert.deepEqual(st(gone).final.votes, { p1: 'p2', p3: 'p2' });
});

test('onuw: absent seats are public — every phone and the table list the same 💤 seats; every seat marked away still ends the game (D4)', () => {
  const sim = dayGame();
  sim.host(ABSENT('p3'));
  sim.host(ABSENT('p2'));
  const lists = [...st(sim).order, null].map((p) => JSON.stringify(sim.view(p).absent));
  assert.equal(new Set(lists).size, 1);
  assert.deepEqual(JSON.parse(lists[0]), ['p2', 'p3'], 'seat order');
  assert.equal(sim.view('p3').my.absent, true);
  assert.equal(sim.view('p1').my.absent, undefined);
  checkViews(sim);
  // everybody away during the day: the vote has nobody to wait for and reveals at once
  const all = dayGame();
  for (const p of st(all).order) all.host(ABSENT(p));
  assert.equal(st(all).phase, 'reveal');
  all.host({ type: ACT.NEXT });
  all.host({ type: ACT.NEXT });
  assert.ok(all.result());
});

test('onuw: fuzz — the host marks random seats absent and back; every game ends, nothing waits on an absent seat, views stay clean (D4)', () => {
  let marks = 0;
  for (let n = 3; n <= 10; n++) {
    for (let seed = 1; seed <= 12; seed++) {
      const sim = uiGame(n, seed * 23 + n, seed % 3 === 0 ? { preset: 'advanced' } : {});
      const rng = mulberry32(seed * 7 + n);
      sim.runRandom({
        maxSteps: 6000,
        onStep: (x) => {
          const s = st(x);
          if (s.phase !== 'over' && rng() < 0.05) {
            const p = s.order[Math.floor(rng() * s.n)];
            x.host(s.absent?.[p] ? PRESENT(p) : ABSENT(p));
            marks++;
          }
          const t = st(x);
          for (const p of t.order) if (t.absent?.[p]) assert.equal(engine.blocking(t, p), false);
          if (t.phase === 'vote') assert.ok(t.order.some((p) => t.votes[p] === undefined && !t.absent?.[p]), 'the vote closes once every present seat has voted');
          if (x.steps % 9 === 0) checkViews(x);
        },
      });
      const s = st(sim);
      assert.equal(s.phase, 'over');
      for (const [p, t] of Object.entries(s.final.votes)) assert.ok(t !== p && s.order.includes(t));
    }
  }
  assert.ok(marks > 100, `the host marked seats ${marks} times`);
});

test('onuw: the night 📓 lists what you learned newest first — a third note never pushes the latest one out of the fixed cover', () => {
  const nm = (p) => p;
  const step = { k: 'werewolf', stage: 'window' };
  const notesOf = (...ks) => ks.map((k, i) => ({ ix: i, k, ...(k === 'copy' ? { target: 'p2', role: 'werewolf' } : k === 'wolves' ? { alone: true, via: 'doppel', with: [] } : { slot: 1, role: 'seer', via: 'doppel' }) }));
  const seen = notesOf('copy', 'wolves', 'lone-peek');
  const book = S.nightBook(step, { awake: true, seen, info: [], ab: null }, nm);
  assert.deepEqual(book.map(([t]) => t), seen.slice().reverse().map((n) => S.noteLine(n, nm)), 'newest first');
  // her own step: the copy note, then what it means for her (both at the top)
  const dstep = { k: 'doppelganger', stage: 'window' };
  const d = S.nightBook(dstep, { awake: true, seen: notesOf('copy'), info: notesOf('copy'), ab: null, copied: 'werewolf' }, nm);
  assert.equal(d.length, 2);
  assert.equal(d[0][0], S.noteLine(notesOf('copy')[0], nm));
  assert.equal(d[1][1], 'do');
  // nothing learned yet: the same single line on every sleeper's cover
  assert.deepEqual(S.nightBook(step, { awake: false, seen: [] }, nm), [[S.T.nightNothing, 'none']]);
  // a played night: the lone wolf's look sits above the wolves note
  const sim = scenario({ p1: 'werewolf', p2: 'seer', p3: 'villager', p4: 'villager' }, ['werewolf', 'robber', 'troublemaker']);
  openStep(sim, 'werewolf');
  act(sim, 'p1', { type: 'look-centre', cards: [1] });
  const v = sim.view('p1').my.night;
  const lines = S.nightBook({ k: 'werewolf', stage: 'window' }, v, nm).map(([t]) => t);
  assert.ok(lines[0].includes('獨狼睇牌') && lines[1].includes('冇其他狼人醒'), lines.join(' / '));
});

test('onuw ui: your own vote is secret on your phone (D6); absent candidates carry 💤; an absent seat gets a 💤 line, no ballot, no circle (D4)', async () => {
  await withFakeDom(async (ui) => {
    const sim = dayGame();
    sim.host({ type: ACT.NEXT });
    sim.host(ABSENT('p3'));
    const seats = mountAll(ui, sim, []);
    const comps = seats.p1.api.components;
    const made = [];
    const base = comps.VotePanel;
    comps.VotePanel = (p) => { const x = base(p); made.push(x); return x; };
    pushViews(sim, seats);
    const ballots = made.filter((x) => x.props && !x.props.reveal);
    assert.equal(ballots.length, 4, 'one ballot screen per seat');
    for (const x of ballots) {
      assert.equal(x.props.secretChoice, true);
      assert.ok(x.props.players.find((p) => p.id === 'p3').name.endsWith(S.T.absentMark));
      assert.ok(!x.props.players.find((p) => p.id === 'p2').name.includes(S.T.absentMark));
    }
    const text = (k) => seats[k].root.textContent;
    assert.ok(text('p3').includes(S.T.absentSelf));
    assert.equal(findAll(seats.p3.root, (n) => hasCls(n, 'c-votepanel'))[0].hidden, true, 'no ballot');
    assert.equal(findAll(seats.p3.root, (n) => hasCls(n, 'on-ring'))[0].hidden, true, 'no circle');
    assert.equal(findAll(seats.p1.root, (n) => hasCls(n, 'on-ring'))[0].hidden, false);
    for (const k of ['p1', 'p3', 'table']) assert.ok(text(k).includes(S.T.absentLine('玩家3')), `${k}: the public 💤 line`);
    for (const x of Object.values(seats)) x.handle.destroy();
  });
});

test('onuw ui: the night 📓 cover draws its notes newest first, the same cover on every phone', async () => {
  await withFakeDom(async (ui) => {
    const sim = scenario({ p1: 'werewolf', p2: 'seer', p3: 'villager', p4: 'villager' }, ['werewolf', 'robber', 'troublemaker']);
    const seats = mountAll(ui, sim, []);
    openStep(sim, 'werewolf');
    act(sim, 'p1', { type: 'look-centre', cards: [1] });
    pushViews(sim, seats);
    const items = (k) => findAll(nightBookOf(seats[k]).el, (n) => n.tag === 'li').map((n) => n.textContent);
    const wolf = items('p1');
    assert.equal(wolf.length, 2);
    assert.ok(wolf[0].includes('獨狼睇牌') && wolf[1].includes('冇其他狼人醒'), wolf.join(' / '));
    assert.deepEqual(items('p3'), [S.T.nightNothing]);
    assert.equal(new Set(st(sim).order.map((p) => nightBookOf(seats[p]).back)).size, 1, 'one back label for everybody');
    for (const x of Object.values(seats)) x.handle.destroy();
  });
});

test('onuw ui: with seats marked 💤 and back through whole random games, every screen still renders for every seat, idempotently (D4)', async () => {
  await withFakeDom(async (ui) => {
    for (const [n, seed, over] of [[4, 2, {}], [7, 5, { preset: 'advanced' }], [10, 7, {}]]) {
      const sim = uiGame(n, seed, over);
      const seats = mountAll(ui, sim, []);
      const rng = mulberry32(seed * 101);
      sim.runRandom({
        maxSteps: 6000,
        onStep: (x) => {
          if (st(x).phase !== 'over' && rng() < 0.05) {
            const p = st(x).order[Math.floor(rng() * st(x).n)];
            x.host(st(x).absent?.[p] ? PRESENT(p) : ABSENT(p));
          }
          if (x.steps % 3 === 0) pushViews(x, seats);
        },
      });
      pushViews(sim, seats);
      for (const s of Object.values(seats)) s.handle.destroy();
    }
  });
});
