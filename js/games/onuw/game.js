// ============================================================
// 一夜終極狼人 (One Night Ultimate Werewolf, base roles) — PURE module:
// meta, rules, config, engine. No DOM, no Math.random, no Date.
//
// Rules: docs/research/onuw.md (with its "Verification" corrections).
// Flow, narration and anti-tell reasoning: docs/games/onuw.md.
//
// Phases   deal → night → day → vote → reveal → over
//   deal    every seat peeks at its card once and taps 記住喇
//   night   a list of steps (begin, one per role in the card set, dawn). Each step
//           has a `cue` stage (narration) and a `window` stage (fixed length). The
//           window NEVER ends early: it ends at its deadline, or when the host skips.
//   day     discussion timer
//   vote    simultaneous secret vote (changeable until the last one is in)
//   reveal  votes, deaths, every final card, why — until the host (or everyone) moves on
//   over    result()
//
// Cards, not people: every ability moves CARDS. `cards[pid]` and `centre[0..2]` hold
// { role, copied? } objects; a swap moves the whole object, so a Doppelgänger card keeps
// what it copied. Who wakes is decided by `orig[pid]` (the dealt role), never by the card
// in front of the seat at that moment.
//
// PRIVATE (never in any view before `reveal`): cards, centre, orig, dop, moves, log,
// notes (only the owner's own notes ever leave, through view()), votes of others.
// ============================================================

import { ACT, HOST, seatOrder, shuffle, rint } from '../../core/engine-kit.js?v=1';
import * as S from './script.js?v=1';

// ---------- roles ----------

export const ROLE_ORDER = ['doppelganger', 'werewolf', 'minion', 'mason', 'seer', 'robber', 'troublemaker',
  'drunk', 'insomniac', 'villager', 'hunter', 'tanner'];

/** Cards of each role in the base box. */
export const CAPS = {
  doppelganger: 1, werewolf: 2, minion: 1, mason: 2, seer: 1, robber: 1, troublemaker: 1, drunk: 1,
  insomniac: 1, villager: 3, hunter: 1, tanner: 1,
};

/** Roles the custom editor counts directly (masons are a pair toggle, villagers fill the rest). */
const CUSTOM_IDS = ['doppelganger', 'werewolf', 'minion', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac',
  'hunter', 'tanner'];

const ACTIVE_COPY = ['seer', 'robber', 'troublemaker', 'drunk'];   // roles whose action a Doppelgänger performs at once
const MIN_N = 3;
const MAX_N = 10;

const full = (partial) => Object.fromEntries(ROLE_ORDER.map((r) => [r, partial[r] ?? 0]));
const sum = (counts) => ROLE_ORDER.reduce((a, r) => a + (counts[r] ?? 0), 0);

export const faceOf = (card) => card.role;
/** A Doppelgänger card that copied nothing is a plain village card (BGG: "a plain old villager"). */
export const finalRole = (card) => (card.role === 'doppelganger' ? (card.copied ?? 'villager') : card.role);
export const teamOf = (role) => (role === 'werewolf' || role === 'minion' ? 'wolf' : role === 'tanner' ? 'tanner' : 'village');

// ---------- presets (research "Setup by player count") ----------

const RECOMMENDED = {
  3: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 1 },
  4: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 2 },
  5: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, villager: 3 },
  6: { werewolf: 2, minion: 1, seer: 1, robber: 1, troublemaker: 1, villager: 3 },
  7: { werewolf: 2, minion: 1, mason: 2, seer: 1, robber: 1, troublemaker: 1, drunk: 1, insomniac: 1 },
  8: { werewolf: 2, minion: 1, mason: 2, seer: 1, robber: 1, troublemaker: 1, drunk: 1, insomniac: 1, hunter: 1 },
  9: { werewolf: 2, minion: 1, mason: 2, tanner: 1, seer: 1, robber: 1, troublemaker: 1, insomniac: 1, villager: 2 },
  10: { werewolf: 2, minion: 1, mason: 2, seer: 1, robber: 1, troublemaker: 1, drunk: 1, insomniac: 1, hunter: 1, villager: 2 },
};

const clampN = (n) => Math.max(MIN_N, Math.min(MAX_N, Number.isInteger(n) ? n : 5));

export function recommended(n) { return full(RECOMMENDED[clampN(n)]); }

/** The recommended set with one Villager (else the Drunk) swapped for the Doppelgänger. */
export function advanced(n) {
  const c = recommended(n);
  if (c.villager > 0) c.villager -= 1; else c.drunk -= 1;
  c.doppelganger += 1;
  return c;
}

// ---------- config ----------

const PRESETS = ['auto', 'advanced', 'custom'];
const PACES = { slow: 1.5, standard: 1, fast: 0.7 };
const DEFAULTS = Object.freeze({
  preset: 'auto', custom: Object.freeze({}), customMasons: false, loneWolf: true, pace: 'standard',
  discussSec: 0, ringVote: true, antiStreak: false,
  paceAuto: false,   // hidden: the slow pace came from the one-phone default (not shown in the form)
});

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const asInt = (v) => {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof x === 'number' && Number.isInteger(x) ? x : NaN;
};

/** Discussion length by head-count (research: 3–4 → 4 min, 5–6 → 5, 7–8 → 7, 9–10 → 9). */
export const discussFor = (n) => (n <= 4 ? 240 : n <= 6 ? 300 : n <= 8 ? 420 : 540);

function keyOk(key, v) {
  switch (key) {
    case 'preset': return PRESETS.includes(v);
    case 'pace': return Object.prototype.hasOwnProperty.call(PACES, v);
    case 'customMasons': case 'loneWolf': case 'ringVote': case 'antiStreak': case 'paceAuto': return typeof v === 'boolean';
    case 'discussSec': { const x = asInt(v); return x === 0 || (x >= 30 && x <= 1800); }
    case 'custom':
      return isObj(v) && CUSTOM_IDS.every((id) => {
        if (v[id] === undefined) return true;
        const x = asInt(v[id]);
        return x >= 0 && x <= CAPS[id];
      });
    default: return false;
  }
}

const customOf = (counts) => Object.fromEntries(CUSTOM_IDS.map((id) => [id, counts[id] ?? 0]));

/** Fill gaps and coerce (the shell's <select> hands back strings). Never throws. */
function norm(cfg, n) {
  const c = isObj(cfg) ? cfg : {};
  const rec = recommended(n);
  const out = { ...DEFAULTS, custom: customOf(rec), customMasons: rec.mason > 0 };
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in c) || !keyOk(key, c[key])) continue;
    if (key === 'discussSec') out[key] = asInt(c[key]);
    else if (key === 'custom') out[key] = Object.fromEntries(CUSTOM_IDS.map((id) => [id, c.custom[id] === undefined ? 0 : asInt(c.custom[id])]));
    else out[key] = c[key];
  }
  return out;
}

/** Role counts for a config at head-count n. `ok:false` carries why. */
export function resolveRoles(c, n) {
  if (c.preset === 'auto') return { ok: true, counts: recommended(n) };
  if (c.preset === 'advanced') return { ok: true, counts: advanced(n) };
  const counts = {};
  for (const id of ROLE_ORDER) counts[id] = 0;
  for (const id of CUSTOM_IDS) counts[id] = c.custom[id] ?? 0;
  counts.mason = c.customMasons ? 2 : 0;
  counts.villager = n + 3 - sum(counts);
  if (counts.villager < 0) return { ok: false, kind: 'tooMany', over: -counts.villager, counts };
  if (counts.villager > CAPS.villager) return { ok: false, kind: 'villagerOver', need: counts.villager - CAPS.villager, counts };
  if (!counts.werewolf) return { ok: false, kind: 'noWolf', counts };
  return { ok: true, counts };
}

const rolePairs = (counts) => ROLE_ORDER.filter((r) => counts[r] > 0).map((r) => [r, counts[r]]);

/** Roles a first game leaves out (research "learning ladder": no Doppelgänger, Tanner or Hunter at first). */
const BEGINNER_DROP = ['hunter', 'tanner'];

/**
 * A first game's set: the recommended one without the Hunter / Tanner, built from the research's sets:
 *   8 → the 7-player set + 1 Villager (the research's gentler [D] row)
 *   9 → the 7-player set + 2 Villagers (BGG thread 1860094)
 *   10 → the BGG 10-player set with its Hunter swapped for the third Villager (derived)
 * Returns null when the recommended set has nothing to drop (3-7 players).
 */
export function beginnerSet(n) {
  const nn = clampN(n);
  if (nn === 8) return full({ ...RECOMMENDED[7], villager: 1 });
  if (nn === 9) return full({ ...RECOMMENDED[7], villager: 2 });
  if (nn === 10) return full({ ...RECOMMENDED[10], hunter: 0, villager: 3 });
  return null;
}

/** Every non-Villager card of the box: the official "no Villager cards" set, 13 cards → exactly 10 players. */
const ALL_SPECIAL = Object.fromEntries(ROLE_ORDER.map((r) => [r, r === 'villager' ? 0 : CAPS[r]]));

const customPatch = (counts) => ({ preset: 'custom', custom: customOf(counts), customMasons: counts.mason > 0 });

export const config = {
  /**
   * Recommended setup for n (and keeps what the host chose before). `prev` = last used.
   * `env.singleDevice` (one phone holds every seat): the phone is picked up from the middle of the table at every
   * night step, so every window gets the slow pace (×1.5) — the same for every step, so it still tells nothing.
   */
  defaults(n, prev, env) {
    const nn = clampN(n);
    const out = norm(prev, nn);
    if (out.preset === 'custom') {
      if (!resolveRoles(out, nn).ok) out.preset = 'auto';
    }
    if (out.preset !== 'custom') {
      const counts = resolveRoles(out, nn).counts;
      out.custom = customOf(counts);
      out.customMasons = counts.mason > 0;
    }
    // The room counts a hosted lobby with only the host's phone as one device, so the slow pace this sets must
    // go back to standard once other phones join — unless the host has picked a pace by hand since.
    if (env && env.singleDevice) {
      if (out.pace !== 'slow') { out.pace = 'slow'; out.paceAuto = true; }
    } else if (env && out.paceAuto) {
      if (out.pace === 'slow') out.pace = 'standard';
      out.paceAuto = false;
    }
    return out;
  },

  /**
   * One-tap presets with a reason (BACKLOG #8). Each `cfg` is a patch over the current config and passes
   * `validate` for this n; the first one is the recommendation `defaults(n)` gives.
   */
  presets(n) {
    const nn = clampN(n);
    const out = [
      { id: 'recommended', label: S.PRESET_CHIP.recommended.label, reason: S.PRESET_CHIP.recommended.reason(nn),
        cfg: { preset: 'auto', pace: 'standard' } },
    ];
    const easy = beginnerSet(nn);
    const rec = recommended(nn);
    const names = (pred) => (easy ? ROLE_ORDER.filter(pred).map(S.roleName).join('、') : '');
    const dropped = names((r) => BEGINNER_DROP.includes(r) && rec[r] > easy[r]);
    const added = names((r) => r !== 'villager' && easy[r] > rec[r]);
    out.push({
      id: 'beginner', label: S.PRESET_CHIP.beginner.label, reason: S.PRESET_CHIP.beginner.reason(nn, dropped, added),
      cfg: easy ? { ...customPatch(easy), pace: 'slow' } : { preset: 'auto', pace: 'slow' },
    });
    out.push({ id: 'advanced', label: S.PRESET_CHIP.advanced.label, reason: S.PRESET_CHIP.advanced.reason(nn),
      cfg: { preset: 'advanced', pace: 'standard' } });
    if (nn === MAX_N) {
      out.push({ id: 'all-special', label: S.PRESET_CHIP.allSpecial.label, reason: S.PRESET_CHIP.allSpecial.reason(nn),
        cfg: { ...customPatch(ALL_SPECIAL), pace: 'standard' } });
    }
    return out;
  },

  validate(cfg, n) {
    const warnings = [];
    if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) {
      return { ok: false, message: S.CFG.msg.players(MIN_N, MAX_N), warnings };
    }
    const c = isObj(cfg) ? cfg : {};
    for (const key of Object.keys(DEFAULTS)) {
      if (key in c && !keyOk(key, c[key])) return { ok: false, message: S.CFG.msg.badKey(S.CFG.label[key]), warnings };
    }
    const m = norm(c, n);
    const res = resolveRoles(m, n);
    if (!res.ok) {
      const msg = { tooMany: S.CFG.msg.tooMany(n, res.over), villagerOver: S.CFG.msg.villagerOver(res.need), noWolf: S.CFG.msg.noWolf }[res.kind];
      return { ok: false, message: msg, warnings };
    }
    const k = res.counts;
    for (const id of ROLE_ORDER) if (k[id] > CAPS[id]) return { ok: false, message: S.CFG.msg.cap(id, CAPS[id]), warnings };
    if (k.mason !== 0 && k.mason !== 2) return { ok: false, message: S.CFG.msg.cap('mason', 2), warnings };

    if (k.doppelganger) warnings.push(S.CFG.warn.doppel);
    if (k.insomniac && !k.robber && !k.troublemaker && !k.drunk && !k.doppelganger) warnings.push(S.CFG.warn.insomniac);
    const village = (n + 3) - k.werewolf - k.minion - k.tanner;
    if (village * 2 < n + 3) warnings.push(S.CFG.warn.fewVillage(village, n + 3));
    if (k.werewolf === 1) warnings.push(S.CFG.warn.singleWolf);
    if (m.discussSec > 0 && m.discussSec < 60) warnings.push(S.CFG.warn.shortDiscuss);
    return { ok: true, message: '', warnings };
  },

  fields(cfg, n) {
    const nn = clampN(n);
    const m = norm(cfg, nn);
    const res = resolveRoles(m, nn);
    const auto = S.discussText(discussFor(nn));
    const f = [
      { key: 'preset', label: S.CFG.label.preset, type: 'select', options: S.PRESET_OPTIONS,
        help: S.presetReason(nn, m.preset, { villagers: res.counts?.villager }) },
    ];
    if (m.preset === 'custom') {
      f.push({
        key: 'custom', label: S.CFG.label.custom, type: 'roles',
        options: [
          ...CUSTOM_IDS.map((id) => ({ id, name: S.roleName(id), emoji: S.ROLE_EMOJI[id], min: 0, max: CAPS[id] })),
          { id: 'villager', name: S.roleName('villager'), emoji: S.ROLE_EMOJI.villager, auto: true },
        ],
        help: S.CFG.help.custom(res.counts?.villager ?? 0),
      });
      f.push({ key: 'customMasons', label: S.CFG.label.customMasons, type: 'bool', help: S.CFG.help.customMasons });
    }
    f.push({ key: 'loneWolf', label: S.CFG.label.loneWolf, type: 'bool', help: S.CFG.help.loneWolf });
    f.push({ key: 'pace', label: S.CFG.label.pace, type: 'select', options: S.PACE_OPTIONS, help: S.CFG.help.pace });
    f.push({ key: 'discussSec', label: S.CFG.label.discussSec, type: 'seconds', min: 0, max: 1800, step: 30,
      help: S.CFG.help.discussSec(auto) });
    f.push({ key: 'ringVote', label: S.CFG.label.ringVote, type: 'bool', help: S.CFG.help.ringVote });
    f.push({ key: 'antiStreak', label: S.CFG.label.antiStreak, type: 'bool', help: S.CFG.help.antiStreak });
    return f;
  },

  summary(cfg, n) {
    const nn = clampN(n);
    const m = norm(cfg, nn);
    let res = resolveRoles(m, nn);
    const preset = res.ok ? m.preset : 'auto';
    if (!res.ok) res = { ok: true, counts: recommended(nn) };
    return S.summaryLines({
      n: nn, preset, roles: rolePairs(res.counts), reasonShort: S.presetReasonShort(nn, preset, { villagers: res.counts.villager }),
      pace: m.pace, discussSec: m.discussSec || discussFor(nn), loneWolf: m.loneWolf, ringVote: m.ringVote,
      antiStreak: m.antiStreak,
    });
  },
};

// ---------- meta + rules ----------

export const meta = {
  id: 'onuw',
  name: S.META.name,
  emoji: '🐺',
  accent: '#8b7bff',
  players: [MIN_N, MAX_N],
  minutes: [10, 20],
  narration: 'recommended',   // every step is fixed-length and runs on timers, so silent mode works too
  paperMode: false,
  singleDevice: 'partial',    // phone in the middle; see docs/games/onuw.md §4 for what leaks
  banks: [],
  css: true,
  blurb: S.META.blurb,
};

export const rules = {
  quick: S.QUICK,
  roles: S.RULES_ROLES,
  sections: S.SECTIONS,
};

// ---------- small helpers ----------

const nowOf = (ctx) => (typeof ctx?.now === 'function' ? ctx.now() : (ctx?.now ?? 0));
const isStr = (x) => typeof x === 'string';
const nm = (s, pid) => s.names[pid] ?? '?';
const prog = (done, total) => ({ done, total });
const countTrue = (o) => Object.values(o).filter(Boolean).length;
const stepOf = (s) => s.steps[s.ix] ?? null;
const cueIdOf = (s) => `on${s.gid}:night:${s.ix}:${stepOf(s).k}`;
const dealCueId = (s) => `on${s.gid}:deal`;
const voteCueId = (s) => `on${s.gid}:vote`;
const revealCueId = (s) => `on${s.gid}:reveal`;
const discussMs = (s) => (s.cfg.discussSec || discussFor(s.n)) * 1000;
const cueMinMs = (text) => Math.max(2500, Math.min(9000, text.length * 150));

const MAX_EXTENDS = 6;          // host's +60 s presses per day
const REVEAL_MS = 180_000;      // the reveal waits for the host, but never forever

/** Fixed per step kind (and pace) — never depends on who is awake or what they did. */
const BASE_MS = {
  begin: 3000, doppelganger: 20000, 'doppelganger-minion': 8000, werewolf: 12000, minion: 8000, mason: 8000,
  seer: 12000, robber: 10000, troublemaker: 10000, drunk: 8000, insomniac: 8000, 'doppelganger-insomniac': 8000,
  dawn: 2000,
};
export function windowMs(cfg, k) {
  const base = k === 'werewolf' && !cfg.loneWolf ? 10000 : BASE_MS[k];
  return Math.round(base * PACES[cfg.pace]);
}

const expand = (counts) => ROLE_ORDER.flatMap((r) => Array.from({ length: counts[r] ?? 0 }, () => r));

export function buildSteps(counts) {
  const has = (r) => (counts[r] ?? 0) > 0;
  const steps = [{ k: 'begin' }];
  if (has('doppelganger')) steps.push({ k: 'doppelganger' });
  if (has('doppelganger') && has('minion')) steps.push({ k: 'doppelganger-minion' });
  for (const r of ['werewolf', 'minion', 'mason', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac']) {
    if (has(r)) steps.push({ k: r });
  }
  if (has('doppelganger') && has('insomniac')) steps.push({ k: 'doppelganger-insomniac' });
  steps.push({ k: 'dawn' });
  return steps;
}

// ---------- who is awake ----------

/** Seats with real content in step `k` (seat order). Decided by ORIGINAL role (+ the Doppelgänger's copy). */
function awakeFor(s, k) {
  const orig = (role) => s.order.filter((p) => s.orig[p] === role);
  const dop = s.dop;
  const dopAs = (role) => (dop && dop.copied === role ? [dop.pid] : []);
  let ids;
  switch (k) {
    case 'doppelganger': ids = dop ? [dop.pid] : []; break;
    case 'doppelganger-minion': ids = dopAs('minion'); break;
    case 'werewolf': ids = [...orig('werewolf'), ...dopAs('werewolf')]; break;
    case 'mason': ids = [...orig('mason'), ...dopAs('mason')]; break;
    case 'minion': case 'seer': case 'robber': case 'troublemaker': case 'drunk': case 'insomniac': ids = orig(k); break;
    case 'doppelganger-insomniac': ids = dopAs('insomniac'); break;
    default: ids = [];
  }
  return s.order.filter((p) => ids.includes(p));
}

const viaOf = (s, pid) => (s.dop && s.dop.pid === pid ? 'doppel' : 'self');

/** Werewolves a Minion sees: original werewolves plus a Doppelgänger who copied Werewolf. */
function wolvesAwake(s) {
  return s.order.filter((p) => s.orig[p] === 'werewolf' || (s.dop && s.dop.pid === p && s.dop.copied === 'werewolf'));
}

const MODE = { copy: 'player', seer: 'seer', robber: 'player', troublemaker: 'pair', drunk: 'centre1', loneWolf: 'centre1' };

/** The ability seat `pid` may still use in the current window, or null. */
function abilityOf(s, pid) {
  if (s.phase !== 'night' || s.stage !== 'window') return null;
  const k = stepOf(s).k;
  const awake = awakeFor(s, k);
  if (!awake.includes(pid)) return null;
  switch (k) {
    case 'doppelganger':
      if (s.dop.copied == null) return { ab: 'copy', via: 'self', mandatory: true };
      if (s.dop.acted || !ACTIVE_COPY.includes(s.dop.copied)) return null;
      return { ab: s.dop.copied, via: 'doppel', mandatory: s.dop.copied === 'drunk' };
    case 'werewolf':
      if (s.cfg.loneWolf && awake.length === 1 && !s.did[pid]) return { ab: 'loneWolf', via: viaOf(s, pid), mandatory: false };
      return null;
    case 'seer': case 'robber': case 'troublemaker': case 'drunk':
      return s.did[pid] ? null : { ab: k, via: 'self', mandatory: k === 'drunk' };
    default:
      return null;
  }
}

// ---------- private notes + the public log ----------

function addNote(s, pid, note) { (s.notes[pid] ||= []).push({ ix: s.ix, ...note }); }
function addLog(s, ev) { s.log.push({ step: stepOf(s)?.k ?? null, ...ev }); }

/** Both at once for a single actor. */
function record(s, pid, as, via, note) {
  addNote(s, pid, { via, ...note });
  addLog(s, { pid, as, via, ...note });
}

// ---------- setup ----------

/**
 * Shuffle the n + 3 cards: seats in order, then the three centre cards. A plain uniform shuffle — unless the
 * optional anti-streak is on (BACKLOG #20): then nobody who was DEALT a werewolf last game (`avoid`) is dealt one
 * again. Rejection sampling keeps every allowed deal equally likely; it is always possible (at most two seats are
 * avoided and there are always at least two other places for the werewolf cards), and the bounded loop has a
 * deterministic repair as a last resort so a pathological rng can never hang the host.
 */
function dealDeck(rng, counts, order, avoid) {
  const cards = expand(counts);
  let deck = shuffle(rng, cards);
  const slots = avoid.map((p) => order.indexOf(p)).filter((i) => i >= 0);
  if (!slots.length || !counts.werewolf) return deck;
  const bad = (d) => slots.some((i) => d[i] === 'werewolf');
  for (let tries = 0; tries < 200 && bad(deck); tries++) deck = shuffle(rng, cards);
  if (bad(deck)) {
    for (const i of slots) {
      if (deck[i] !== 'werewolf') continue;
      const j = deck.findIndex((r, k) => r !== 'werewolf' && !slots.includes(k));
      if (j >= 0) [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  return deck;
}

/** `carry` = the previous onuw game's result().carry ({ wolves: [pid] }), handed over by the room. */
function setup({ players, config: cfg, rng, now, hostPid, carry }) {
  const order = seatOrder(players);
  const n = order.length;
  if (n < MIN_N || n > MAX_N) throw new RangeError(`onuw needs ${MIN_N}-${MAX_N} players, got ${n}`);
  const c = norm(cfg, n);
  let res = resolveRoles(c, n);
  if (!res.ok) res = { ok: true, counts: recommended(n) };   // setup must survive a hand-edited config
  const counts = res.counts;

  const avoid = c.antiStreak && isObj(carry) && Array.isArray(carry.wolves) ? carry.wolves.filter((p) => isStr(p)) : [];
  const deck = dealDeck(rng, counts, order, avoid);
  const cards = {};
  const orig = {};
  order.forEach((pid, i) => { cards[pid] = { role: deck[i] }; orig[pid] = deck[i]; });
  const centre = [0, 1, 2].map((i) => ({ role: deck[n + i] }));
  const dp = order.find((p) => orig[p] === 'doppelganger');

  return {
    game: 'onuw',
    gid: Math.floor(rng() * 1e6),
    n,
    cfg: c,
    order,
    names: Object.fromEntries(players.map((p) => [p.id, p.name])),
    host: isStr(hostPid) && order.includes(hostPid) ? hostPid : order[0],
    phase: 'deal',
    counts,                                             // public: the role list
    cards, centre, orig,                                // PRIVATE
    dealtCentre: centre.map((x) => x.role),             // PRIVATE until reveal
    dop: dp ? { pid: dp, target: null, copied: null, acted: false } : null,   // PRIVATE
    steps: buildSteps(counts), ix: 0, stage: 'cue',
    acked: [], did: {},
    notes: Object.fromEntries(order.map((p) => [p, []])),   // PRIVATE per seat
    log: [], moves: [],                                 // PRIVATE until reveal
    ready: {}, dealCue: true,
    dayReady: {}, extends: 0,
    votes: {}, ringAgree: {}, voteCue: true,
    revealDone: {}, revealCue: true,
    final: null, report: null, outcome: null, voided: false,
    deadline: null, timerLabel: null,
  };
}

// ---------- phase: deal ----------

function dealAct(s, pid, a, ctx) {
  if (a.type !== 'ready' || s.ready[pid]) return s;
  s.ready[pid] = true;
  if (s.order.every((p) => s.ready[p])) startNight(s, ctx);
  return s;
}

function startNight(s) {
  s.phase = 'night';
  s.ix = 0;
  s.stage = 'cue';
  s.acked = [];
  s.did = {};
  s.deadline = null;
  s.timerLabel = null;
  return s;
}

// ---------- phase: night ----------

function enterWindow(s, ctx) {
  const st = stepOf(s);
  s.stage = 'window';
  s.acked = [];
  s.did = {};
  s.deadline = nowOf(ctx) + windowMs(s.cfg, st.k);
  s.timerLabel = null;
  if (st.k !== 'begin' && st.k !== 'dawn') {
    addLog(s, { k: 'step', step: st.k, awake: awakeFor(s, st.k) });
    openInfo(s, st.k);
  }
  return s;
}

/** Roles that only LEARN something learn it the moment their window opens. */
function openInfo(s, k) {
  const awake = awakeFor(s, k);
  switch (k) {
    case 'werewolf': {
      for (const p of awake) {
        addNote(s, p, { k: 'wolves', via: viaOf(s, p), with: awake.filter((x) => x !== p), alone: awake.length === 1, copies: s.counts.werewolf });
      }
      addLog(s, { k: 'wolves', pids: awake.slice() });
      break;
    }
    case 'minion': {
      const wolves = wolvesAwake(s);
      for (const p of awake) record(s, p, 'minion', 'self', { k: 'minion', wolves });
      break;
    }
    case 'doppelganger-minion': {
      const wolves = s.order.filter((p) => s.orig[p] === 'werewolf');
      for (const p of awake) record(s, p, 'minion', 'doppel', { k: 'minion', wolves });
      break;
    }
    case 'mason': {
      for (const p of awake) {
        addNote(s, p, { k: 'mason', via: viaOf(s, p), with: awake.filter((x) => x !== p), alone: awake.length === 1, copies: s.counts.mason });
      }
      addLog(s, { k: 'mason', pids: awake.slice() });
      break;
    }
    case 'insomniac': case 'doppelganger-insomniac': {
      const via = k === 'insomniac' ? 'self' : 'doppel';
      for (const p of awake) record(s, p, 'insomniac', via, { k: 'insomniac', role: faceOf(s.cards[p]) });
      break;
    }
    default: break;
  }
}

function swapLoc(s, a, b) {
  const get = (l) => (l.p !== undefined ? s.cards[l.p] : s.centre[l.c]);
  const set = (l, card) => { if (l.p !== undefined) s.cards[l.p] = card; else s.centre[l.c] = card; };
  const ca = get(a);
  const cb = get(b);
  set(a, cb);
  set(b, ca);
}

function markDone(s, pid, ab) {
  s.did[pid] = true;
  if (s.dop && s.dop.pid === pid && stepOf(s).k === 'doppelganger' && ab.ab !== 'copy') s.dop.acted = true;
  if (!s.acked.includes(pid)) s.acked.push(pid);
}

function doCopy(s, pid, target, auto) {
  const role = s.cards[target].role;
  s.dop.target = target;
  s.dop.copied = role;
  if (s.cards[pid].role === 'doppelganger') s.cards[pid].copied = role;
  addNote(s, pid, { k: 'copy', target, role, auto: !!auto });
  addLog(s, { k: 'copy', pid, target, role, auto: !!auto });
  if (!s.acked.includes(pid)) s.acked.push(pid);
}

function doLookPlayer(s, pid, target, ab) {
  record(s, pid, 'seer', ab.via, { k: 'seer-player', target, role: faceOf(s.cards[target]) });
  markDone(s, pid, ab);
}

function doLookCentre(s, pid, cards, ab) {
  if (ab.ab === 'loneWolf') {
    record(s, pid, 'werewolf', ab.via, { k: 'lone-peek', slot: cards[0], role: faceOf(s.centre[cards[0]]) });
  } else {
    record(s, pid, 'seer', ab.via, { k: 'seer-centre', slots: cards.slice(), roles: cards.map((i) => faceOf(s.centre[i])) });
  }
  markDone(s, pid, ab);
}

function doRob(s, pid, target, ab) {
  swapLoc(s, { p: pid }, { p: target });
  s.moves.push({ k: 'rob', by: pid, via: ab.via, ps: [pid, target], c: null });
  record(s, pid, 'robber', ab.via, { k: 'rob', target, role: faceOf(s.cards[pid]) });
  markDone(s, pid, ab);
}

function doSwap(s, pid, a, b, ab) {
  swapLoc(s, { p: a }, { p: b });
  s.moves.push({ k: 'swap', by: pid, via: ab.via, ps: [a, b], c: null });
  record(s, pid, 'troublemaker', ab.via, { k: 'swap', a, b });
  markDone(s, pid, ab);
}

function doDrunk(s, pid, card, ab, auto) {
  swapLoc(s, { p: pid }, { c: card });
  s.moves.push({ k: 'drunk', by: pid, via: ab.via, ps: [pid], c: card });
  record(s, pid, 'drunk', ab.via, { k: 'drunk', slot: card, auto: !!auto });
  markDone(s, pid, ab);
}

const validPlayer = (s, pid, t) => isStr(t) && t !== pid && s.order.includes(t);
const validCentre = (i) => Number.isInteger(i) && i >= 0 && i <= 2;

function nightAct(s, pid, a, ctx) {
  const st = stepOf(s);
  if (!st) return s;
  if (a.type === 'ack') {
    if (!s.acked.includes(pid)) s.acked.push(pid);
    return s;
  }
  if (s.stage !== 'window') return s;
  const ab = abilityOf(s, pid);
  if (!ab) return s;

  switch (a.type) {
    case 'copy':
      if (ab.ab === 'copy' && validPlayer(s, pid, a.target)) doCopy(s, pid, a.target, false);
      return s;
    case 'look-player':
      if (ab.ab === 'seer' && validPlayer(s, pid, a.target)) doLookPlayer(s, pid, a.target, ab);
      return s;
    case 'look-centre': {
      if (!Array.isArray(a.cards) || !a.cards.every(validCentre) || new Set(a.cards).size !== a.cards.length) return s;
      if (ab.ab === 'seer' && a.cards.length === 2) doLookCentre(s, pid, a.cards.slice().sort((x, y) => x - y), ab);
      else if (ab.ab === 'loneWolf' && a.cards.length === 1) doLookCentre(s, pid, a.cards.slice(), ab);
      return s;
    }
    case 'rob':
      if (ab.ab === 'robber' && validPlayer(s, pid, a.target)) doRob(s, pid, a.target, ab);
      return s;
    case 'swap':
      if (ab.ab === 'troublemaker' && validPlayer(s, pid, a.a) && validPlayer(s, pid, a.b) && a.a !== a.b) doSwap(s, pid, a.a, a.b, ab);
      return s;
    case 'drunk-swap':
      if (ab.ab === 'drunk' && validCentre(a.card)) doDrunk(s, pid, a.card, ab, false);
      return s;
    default:
      return s;
  }
}

/** The window is over: mandatory choices nobody made are made for them; optional ones lapse. */
function resolveWindow(s, ctx) {
  const k = stepOf(s).k;
  const rng = ctx && typeof ctx.rng === 'function' ? ctx.rng : () => 0;
  if (k === 'doppelganger' && s.dop && s.dop.copied == null) {
    const others = s.order.filter((p) => p !== s.dop.pid);
    doCopy(s, s.dop.pid, others[rint(rng, others.length)], true);
  }
  for (const p of awakeFor(s, k)) {
    const ab = abilityOf(s, p);
    if (!ab) continue;
    if (ab.mandatory) {
      doDrunk(s, p, rint(rng, 3), ab, true);
    } else {
      record(s, p, ab.ab === 'loneWolf' ? 'werewolf' : ab.ab, ab.via, { k: 'idle', ability: ab.ab });
    }
  }
}

function finishWindow(s, ctx) {
  resolveWindow(s, ctx);
  if (stepOf(s).k === 'dawn') return startDay(s, ctx);
  s.ix += 1;
  s.stage = 'cue';
  s.deadline = null;
  s.acked = [];
  s.did = {};
  return s;
}

// ---------- phase: day, vote ----------

function startDay(s, ctx) {
  s.phase = 'day';
  s.stage = 'day';
  s.acked = [];
  s.did = {};
  s.dayReady = {};
  s.deadline = nowOf(ctx) + discussMs(s);
  s.timerLabel = S.T.dayTimer;
  return s;
}

function startVote(s) {
  s.phase = 'vote';
  s.deadline = null;
  s.timerLabel = null;
  s.votes = {};
  s.ringAgree = {};
  s.voteCue = true;
  return s;
}

function dayAct(s, pid, a) {
  if (a.type === 'ready-vote') {
    s.dayReady[pid] = a.on !== false;
    if (s.order.every((p) => s.dayReady[p])) return startVote(s);
    return s;
  }
  if (a.type === 'extend') {
    if (s.host && pid !== s.host) return s;
    if (s.deadline == null || s.extends >= MAX_EXTENDS) return s;
    s.deadline += 60_000;
    s.extends += 1;
  }
  return s;
}

function voteAct(s, pid, a, ctx) {
  if (a.type === 'vote') {
    if (!validPlayer(s, pid, a.target)) return s;
    s.votes[pid] = a.target;
    delete s.ringAgree[pid];                       // choosing a person is leaving the circle
    if (s.order.every((p) => s.votes[p] !== undefined)) return toReveal(s, ctx);
    return s;
  }
  if (a.type === 'ring' && s.cfg.ringVote) {
    // Agreeing never touches a ballot: if the circle falls through, everybody's own vote stands.
    if (a.on === false) { delete s.ringAgree[pid]; return s; }
    s.ringAgree[pid] = true;
    if (s.order.every((p) => s.ringAgree[p])) {
      // everybody agreed to point one seat clockwise: every player ends on exactly one vote
      s.order.forEach((p, i) => { s.votes[p] = s.order[(i + 1) % s.n]; });
      return toReveal(s, ctx);
    }
  }
  return s;
}

/** Everybody has voted or agreed, but not everybody agreed: those who only agreed must pick somebody. */
function ringStuck(s) {
  return s.order.every((p) => s.votes[p] !== undefined || s.ringAgree[p])
    && s.order.some((p) => s.ringAgree[p] && s.votes[p] === undefined);
}

// ---------- phase: reveal ----------

/**
 * The whole end-of-night analysis from final cards and votes — a pure function so the rules can be
 * tested against the research vectors without playing a game.
 *   { order, cards: {pid: card}, centre: [card], orig: {pid: role}, dealtCentre?: [role], votes: {pid: target} }
 */
export function analyse({ order, cards, centre, orig, dealtCentre, votes }) {
  const counts = Object.fromEntries(order.map((p) => [p, 0]));
  for (const p of order) {
    const t = votes[p];
    if (isStr(t) && t in counts) counts[t] += 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  const tied = max >= 2 ? order.filter((p) => counts[p] === max) : [];
  const dead = tied.slice();
  const roleOf = (p) => finalRole(cards[p]);

  // Hunter cascade: every dead Hunter shoots the player he voted for, regardless of that player's votes.
  const shots = [];
  const queue = dead.filter((p) => roleOf(p) === 'hunter');
  while (queue.length) {
    const h = queue.shift();
    const t = votes[h];
    if (!isStr(t) || !order.includes(t)) continue;
    const fresh = !dead.includes(t);
    shots.push({ hunter: h, target: t, fresh });
    if (fresh) {
      dead.push(t);
      if (roleOf(t) === 'hunter') queue.push(t);
    }
  }

  const W = order.filter((p) => roleOf(p) === 'werewolf');
  const M = order.filter((p) => roleOf(p) === 'minion');
  const T = order.filter((p) => roleOf(p) === 'tanner');
  const wolfDied = W.some((p) => dead.includes(p));
  const tannerDied = T.some((p) => dead.includes(p));
  const villageWins = wolfDied || (W.length === 0 && dead.length === 0);
  const wolfTeamWins = W.length > 0 && !tannerDied && !wolfDied;

  const win = {};
  for (const p of order) {
    const role = roleOf(p);
    if (role === 'tanner') win[p] = dead.includes(p);
    else if (role === 'werewolf') win[p] = wolfTeamWins;
    else if (role === 'minion') win[p] = W.length > 0 ? wolfTeamWins : (!dead.includes(p) && dead.length >= 1);
    else win[p] = villageWins;
  }
  const winners = order.filter((p) => win[p]);

  let headline = 'none';
  if (villageWins) headline = 'village';
  else if (wolfTeamWins) headline = 'wolves';
  else if (winners.some((p) => roleOf(p) === 'minion')) headline = 'minion';
  else if (winners.some((p) => roleOf(p) === 'tanner')) headline = 'tanner';

  return {
    votes: { ...votes }, counts, max, tied, dead, shots, nobodyDied: dead.length === 0,
    cards: Object.fromEntries(order.map((p) => [p, {
      orig: orig[p], face: faceOf(cards[p]), copied: cards[p].copied ?? null, final: roleOf(p), team: teamOf(roleOf(p)),
    }])),
    centre: centre.map((c, i) => ({
      dealt: dealtCentre ? dealtCentre[i] : faceOf(c), face: faceOf(c), copied: c.copied ?? null, final: finalRole(c),
    })),
    W, M, T, wolfDied, tannerDied, villageWins, wolfTeamWins, win, winners, headline,
  };
}

function toReveal(s, ctx) {
  s.phase = 'reveal';
  s.final = analyse({ order: s.order, cards: s.cards, centre: s.centre, orig: s.orig, dealtCentre: s.dealtCentre, votes: s.votes });
  const names = (p) => nm(s, p);
  s.report = S.report({ f: s.final, log: s.log, moves: s.moves, order: s.order, nm: names });
  s.revealDone = {};
  s.revealCue = true;
  s.deadline = nowOf(ctx) + REVEAL_MS;
  s.timerLabel = null;
  return s;
}

function revealAct(s, pid, a) {
  if (a.type !== 'done' || s.revealDone[pid]) return s;
  s.revealDone[pid] = true;
  if (pid === s.host || s.order.every((p) => s.revealDone[p])) return toOver(s);
  return s;
}

/** For the next game of onuw (anti-streak): who was DEALT a werewolf card this time. Never shown to anyone. */
const carryOf = (s) => ({ wolves: s.order.filter((p) => s.orig[p] === 'werewolf') });

function toOver(s) {
  s.phase = 'over';
  s.deadline = null;
  s.timerLabel = null;
  const f = s.final;
  s.outcome = {
    winners: f.winners.slice(),
    summary: s.report.summary,
    lines: s.report.lines.slice(),
    points: Object.fromEntries(s.order.map((p) => [p, f.win[p] ? 1 : 0])),
    headline: f.headline,
    carry: carryOf(s),
  };
  return s;
}

/**
 * 呢局唔計 (host `@void-round`, e.g. a phone died and the table wants a fresh deal). ONUW is one round per game,
 * so voiding ends the game unscored: nobody wins, nobody scores, and the lines lay open what was hidden so far.
 * Too late once the votes are revealed — the result is known by then.
 */
const VOIDABLE = ['deal', 'night', 'day', 'vote'];

function toVoid(s) {
  const phase = s.phase;
  s.phase = 'over';
  s.voided = true;
  s.deadline = null;
  s.timerLabel = null;
  s.outcome = {
    winners: [],
    summary: S.VOID.summary,
    lines: S.voidLines({
      phase, order: s.order, dealt: s.order.map((p) => s.orig[p]), dealtCentre: s.dealtCentre.slice(),
      faces: s.order.map((p) => faceOf(s.cards[p])), centreFaces: s.centre.map(faceOf), log: s.log, nm: (p) => nm(s, p),
    }),
    points: Object.fromEntries(s.order.map((p) => [p, 0])),
    headline: 'void',
    void: true,
    carry: carryOf(s),
  };
  return s;
}

// ---------- engine entry points ----------

function hostAct(s, a, ctx) {
  switch (a.type) {
    case ACT.VOID_ROUND:
      return VOIDABLE.includes(s.phase) ? toVoid(s) : s;
    case ACT.CUE_DONE:
      if (s.phase === 'deal' && a.id === dealCueId(s)) s.dealCue = false;
      else if (s.phase === 'night' && s.stage === 'cue' && a.id === cueIdOf(s)) return enterWindow(s, ctx);
      else if (s.phase === 'vote' && a.id === voteCueId(s)) s.voteCue = false;
      else if (s.phase === 'reveal' && a.id === revealCueId(s)) s.revealCue = false;
      return s;
    case ACT.NEXT:
      switch (s.phase) {
        case 'deal':
          if (s.dealCue) { s.dealCue = false; return s; }
          for (const p of s.order) s.ready[p] = true;
          return startNight(s, ctx);
        case 'night': return s.stage === 'cue' ? enterWindow(s, ctx) : finishWindow(s, ctx);
        case 'day': return startVote(s);
        case 'reveal':
          if (s.revealCue) { s.revealCue = false; return s; }
          return toOver(s);
        default: return s;
      }
    default:
      return s;   // ACT.AUTO is resolved by the session through autoAct()
  }
}

function act(state, msg, ctx) {
  const s = state;
  const pid = msg?.pid;
  const a = msg?.action;
  if (!a || typeof a !== 'object' || !isStr(a.type)) return s;
  if (pid === HOST) return hostAct(s, a, ctx ?? {});
  if (!isStr(pid) || !s.order.includes(pid)) return s;
  switch (s.phase) {
    case 'deal': return dealAct(s, pid, a, ctx ?? {});
    case 'night': return nightAct(s, pid, a, ctx ?? {});
    case 'day': return dayAct(s, pid, a);
    case 'vote': return voteAct(s, pid, a, ctx ?? {});
    case 'reveal': return revealAct(s, pid, a);
    default: return s;
  }
}

function advance(state, ctx) {
  const s = state;
  if (s.deadline == null) return s;
  if (nowOf(ctx) < s.deadline) return s;
  switch (s.phase) {
    case 'night': return s.stage === 'window' ? finishWindow(s, ctx ?? {}) : s;
    case 'day': return startVote(s);
    case 'reveal': return toOver(s);
    default: return s;
  }
}

function cue(s) {
  switch (s.phase) {
    case 'deal': {
      if (!s.dealCue) return null;
      const text = S.cueDeal();
      return { id: dealCueId(s), text, minMs: cueMinMs(text) };
    }
    case 'night': {
      if (s.stage !== 'cue') return null;
      const st = stepOf(s);
      const prev = s.ix > 0 ? s.steps[s.ix - 1].k : null;
      const text = S.cueNight(st.k, prev, { loneWolf: s.cfg.loneWolf, discussSec: s.cfg.discussSec || discussFor(s.n) });
      return { id: cueIdOf(s), text, minMs: cueMinMs(text) };
    }
    case 'vote': {
      if (!s.voteCue) return null;
      const text = S.cueVote();
      return { id: voteCueId(s), text, minMs: cueMinMs(text) };
    }
    case 'reveal': {
      if (!s.revealCue) return null;
      const text = S.cueReveal(s.final, (p) => nm(s, p));
      return { id: revealCueId(s), text, minMs: cueMinMs(text) };
    }
    default: return null;
  }
}

function focus(s) {
  switch (s.phase) {
    case 'deal': {
      const pids = s.order.filter((p) => !s.ready[p]);
      return pids.length ? { pids } : null;
    }
    case 'night': {
      const k = stepOf(s).k;
      if (s.stage !== 'window' || k === 'begin' || k === 'dawn') return null;
      // An empty step still answers (pids: []), so a shared phone looks the same whether or not anyone is awake.
      return { pids: awakeFor(s, k), anonymous: S.anonymousPrompt(k) };
    }
    case 'vote': {
      // seats that have neither voted nor agreed to the circle; once only agreers are left, they have to choose
      const undecided = s.order.filter((p) => s.votes[p] === undefined && !s.ringAgree[p]);
      const pids = undecided.length ? undecided : s.order.filter((p) => s.votes[p] === undefined);
      return pids.length ? { pids } : null;
    }
    default: return null;
  }
}

function legalActions(s, pid) {
  if (!isStr(pid) || !s.order.includes(pid)) return [];
  const others = s.order.filter((p) => p !== pid);
  const out = [];
  switch (s.phase) {
    case 'deal':
      if (!s.ready[pid]) out.push({ type: 'ready' });
      break;
    case 'night': {
      if (!s.acked.includes(pid)) out.push({ type: 'ack' });
      const ab = abilityOf(s, pid);
      if (!ab) break;
      switch (ab.ab) {
        case 'copy': for (const t of others) out.push({ type: 'copy', target: t }); break;
        case 'seer':
          for (const t of others) out.push({ type: 'look-player', target: t });
          for (const c of [[0, 1], [0, 2], [1, 2]]) out.push({ type: 'look-centre', cards: c });
          break;
        case 'robber': for (const t of others) out.push({ type: 'rob', target: t }); break;
        case 'troublemaker':
          for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) out.push({ type: 'swap', a: others[i], b: others[j] });
          break;
        case 'drunk': for (const c of [0, 1, 2]) out.push({ type: 'drunk-swap', card: c }); break;
        case 'loneWolf': for (const c of [0, 1, 2]) out.push({ type: 'look-centre', cards: [c] }); break;
        default: break;
      }
      break;
    }
    case 'day':
      if (!s.dayReady[pid]) out.push({ type: 'ready-vote', on: true });
      if ((!s.host || pid === s.host) && s.deadline != null && s.extends < MAX_EXTENDS) out.push({ type: 'extend' });
      break;
    case 'vote':
      for (const t of others) if (s.votes[pid] !== t) out.push({ type: 'vote', target: t });
      if (s.cfg.ringVote) out.push({ type: 'ring', on: !s.ringAgree[pid] });
      break;
    case 'reveal':
      if (!s.revealDone[pid]) out.push({ type: 'done' });
      break;
    default: break;
  }
  return out;
}

/** What to do for a stalled seat: the harmless choice (decline / ack), or a random one where a choice is mandatory. */
function autoAct(s, pid, ctx) {
  if (!s.order.includes(pid)) return null;
  const others = s.order.filter((p) => p !== pid);
  const rnd = (n) => (ctx && ctx.rng ? rint(ctx.rng, n) : 0);
  switch (s.phase) {
    case 'deal': return s.ready[pid] ? null : { type: 'ready' };
    case 'night': {
      const ab = abilityOf(s, pid);
      if (ab && ab.ab === 'copy') return { type: 'copy', target: others[rnd(others.length)] };
      if (ab && ab.ab === 'drunk') return { type: 'drunk-swap', card: rnd(3) };
      if (ab && ab.ab === 'seer') return { type: 'look-centre', cards: [[0, 1], [0, 2], [1, 2]][rnd(3)] };
      return s.acked.includes(pid) ? null : { type: 'ack' };
    }
    case 'day': return s.dayReady[pid] ? null : { type: 'ready-vote', on: true };
    case 'vote': return s.votes[pid] === undefined ? { type: 'vote', target: others[rnd(others.length)] } : null;
    case 'reveal': return s.revealDone[pid] ? null : { type: 'done' };
    default: return null;
  }
}

function result(s) { return s.phase === 'over' ? s.outcome : null; }

/**
 * Is the game WAITING on this seat (so a dead phone stalls the table)? Only where nothing else moves the game:
 * the deal (everybody must tap 記住喇) and the vote (the seats `focus` still asks). Every night window, the day
 * and the reveal run on deadlines — and at night every seat has the decoy, so "has a legal action" would flag
 * (and tell the host about) exactly the seats that are awake.
 */
function blocking(s, pid) {
  if (!isStr(pid) || !s.order.includes(pid)) return false;
  switch (s.phase) {
    case 'deal': return !s.ready[pid];
    case 'vote': return (focus(s)?.pids ?? []).includes(pid);
    default: return false;
  }
}

// ---------- views (whitelist) ----------

function roleList(s) {
  return ROLE_ORDER.filter((r) => s.counts[r] > 0).map((r) => ({ role: r, count: s.counts[r] }));
}

function clonePlain(x) { return JSON.parse(JSON.stringify(x ?? null)); }

/**
 * What this seat sees on its phone during the current night step. Only ever its own information.
 * `seen` = every note this seat has had tonight, for EVERY seat in every step and stage: the night screen keeps it
 * behind one 📓 cover that every phone has, so a result outlives the window it came in (playtest #11), and a seat
 * that learned nothing has the same cover (「今晚未見過嘢」) — the cover itself says nothing about who woke.
 */
function nightFor(s, pid) {
  const st = stepOf(s);
  const seen = clonePlain(s.notes[pid] || []);
  if (s.stage !== 'window' || !awakeFor(s, st.k).includes(pid)) return { awake: false, seen };
  const ab = abilityOf(s, pid);
  const out = {
    awake: true,
    info: clonePlain((s.notes[pid] || []).filter((n) => n.ix === s.ix)),
    ab: ab ? { name: ab.ab, via: ab.via, mandatory: ab.mandatory, mode: MODE[ab.ab] } : null,
    copied: st.k === 'doppelganger' && s.dop && s.dop.pid === pid ? s.dop.copied : null,
    seen,
  };
  return out;
}

function publicReveal(s) {
  const f = s.final;
  return {
    votes: { ...f.votes },
    counts: { ...f.counts },
    tied: f.tied.slice(),
    dead: f.dead.slice(),
    shots: f.shots.map((x) => ({ ...x })),
    nobodyDied: f.nobodyDied,
    headline: f.headline,
    winners: f.winners.slice(),
    cards: s.order.map((p) => ({ pid: p, ...f.cards[p], won: !!f.win[p], dead: f.dead.includes(p) })),
    centre: f.centre.map((c) => ({ ...c })),
    summary: s.report.summary,
    why: s.report.why.slice(),
    cardLines: s.report.cards.slice(),
    recap: s.report.recap.slice(),
  };
}

function buildView(s, pid) {
  const seat = pid != null && s.order.includes(pid) ? pid : null;
  const [title, subtitle] = S.phaseTitle(s.phase, s.phase === 'night' ? stepOf(s).k : null);
  const v = {
    seat, phase: s.phase, n: s.n, title, subtitle, night: false,
    roleList: roleList(s),
    opts: { loneWolf: s.cfg.loneWolf, ringVote: s.cfg.ringVote, pace: s.cfg.pace },
  };
  if (s.deadline != null) { v.deadline = s.deadline; if (s.timerLabel) v.timerLabel = s.timerLabel; }

  switch (s.phase) {
    case 'deal':
      v.ready = prog(countTrue(s.ready), s.n);
      if (seat) v.my = { dealt: s.orig[seat], ready: !!s.ready[seat] };
      break;
    case 'night': {
      const st = stepOf(s);
      v.night = st.k !== 'dawn';
      v.step = { ix: s.ix, total: s.steps.length, k: st.k, stage: s.stage };
      // no night counter in any view (playtest #18): an action counts as an ack, so 「n / m」 would tell a seatless
      // table screen how many seats are awake (0 / 5 at the werewolf step = no player holds a werewolf)
      if (seat) v.my = { dealt: s.orig[seat], acked: s.acked.includes(seat), night: nightFor(s, seat) };
      break;
    }
    case 'day':
      v.dayReady = { ...prog(countTrue(s.dayReady), s.n), mine: seat ? !!s.dayReady[seat] : false };
      v.canExtend = !!seat && (!s.host || seat === s.host) && s.extends < MAX_EXTENDS;
      if (seat) v.my = { dealt: s.orig[seat], notes: [{ k: 'dealt', role: s.orig[seat] }, ...clonePlain(s.notes[seat])] };
      break;
    case 'vote':
      v.progress = prog(Object.keys(s.votes).length, s.n);
      v.ring = { on: s.cfg.ringVote, ...prog(countTrue(s.ringAgree), s.n), mine: seat ? !!s.ringAgree[seat] : false, stuck: ringStuck(s) };
      if (seat) {
        v.candidates = s.order.filter((p) => p !== seat);
        if (s.votes[seat] !== undefined) v.myVote = s.votes[seat];
        v.my = { dealt: s.orig[seat], notes: [{ k: 'dealt', role: s.orig[seat] }, ...clonePlain(s.notes[seat])] };
      }
      break;
    case 'reveal': case 'over':
      if (s.voided) {
        v.voided = true;              // a voided game never computed a reveal; the results screen carries the lines
        if (seat) v.my = { dealt: s.orig[seat] };
        break;
      }
      v.reveal = publicReveal(s);
      v.revealDone = { ...prog(countTrue(s.revealDone), s.n), mine: seat ? !!s.revealDone[seat] : false };
      if (seat) v.my = { dealt: s.orig[seat] };
      break;
    default: break;
  }
  // every seat view that carries the dealt role names it so on the 💡 sheet (cards change hands at night); the table has none
  if (v.my?.dealt) v.hintRoleLabel = S.HINT_ROLE_LABEL;
  v.hint = hintFor(s, seat, v);
  return v;
}

/**
 * The 💡 line (BACKLOG U1): what to do right now, for a first-timer, in one short line. Built only from what this
 * view already carries (the phase, the step being called, this seat's own ability and vote), so it can never say
 * more than the screen does.
 */
function hintFor(s, seat, v) {
  const H = S.HINT;
  if (!seat) return s.voided ? H.void : (H.table[s.phase] ?? '');
  switch (s.phase) {
    case 'deal': return s.ready[seat] ? H.deal.wait : H.deal.look;
    case 'night': {
      const k = stepOf(s).k;
      if (k === 'begin') return H.night.begin;
      if (k === 'dawn') return H.night.dawn;
      if (s.stage !== 'window') return H.night.cue;
      const nf = v.my.night;
      if (!nf.awake) return H.night.sleep;
      // a Doppelgänger who has copied: what she became stays behind the cover, the 💡 sheet included (playtest #8)
      if (k === 'doppelganger' && nf.copied != null) return H.night.copied;
      if (nf.ab) return H.night[nf.ab.name] ?? H.night.awake;
      return nf.info.length ? H.night.info : H.night.awake;
    }
    case 'day': return H.day;
    case 'vote':
      if (v.ring.stuck && v.ring.mine) return H.vote.stuck;
      if (v.myVote !== undefined) return H.vote.voted;
      return v.ring.mine ? H.vote.ring : H.vote.pick;
    case 'reveal': return s.revealDone[seat] ? H.revealDone : H.reveal;
    case 'over': return s.voided ? H.void : H.over;
    default: return '';
  }
}

export const engine = {
  setup,
  act,
  advance,
  view: (s, pid) => buildView(s, pid),
  cue,
  focus,
  autoAct,
  legalActions,
  result,
  blocking,
};
