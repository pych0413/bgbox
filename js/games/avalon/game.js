// ============================================================
// 阿瓦隆 (The Resistance: Avalon) — PURE module: meta, rules, config, engine.
// No DOM, no Math.random, no Date. Flow and wording: docs/games/avalon.md,
// rules: docs/research/avalon.md (the "Verification" section wins).
//
// Phases
//   reveal        everybody holds-to-peek their role + what that role knows
//   pick          the leader names the team
//   vote          every seat votes approve / reject in secret
//   voted         the votes are shown with names; the leader taps 繼續
//   quest         team members play success / fail in secret
//   quest-result  the shuffled pile as counts; the leader taps 繼續
//   lady          (optional) the Lady of the Lake holder names someone
//   lady-peek     the holder privately learns that seat's loyalty
//   assassinate   after the third success: the Assassin names Merlin
//   shot          the shot is shown (a few seconds), then
//   over          result()
//
// Secrets (PRIVATE in the state, never in another seat's view):
//   role, knows, cards (who played which quest card), votes before the reveal,
//   flip, the Lady's result. The public pile only ever holds counts, built from
//   the counts and shuffled with ctx.rng, so it carries no seat information.
//
// Framework hooks: blocking() (stall detection ignores the decoy taps),
// `@void-round` (呢鋪唔計 in pick / vote / quest), `@absent` / `@present` (💤 a
// seat that left: it is not waited on — no vote, Success on a quest, skipped as
// leader), hostActions() (⏱️ 刺殺 ＋60 秒), setup's `carry` (the first leader
// rotates between games), config.defaults(n, prev, { singleDevice }) and
// config.presets(n). Every view carries a role-independent `hint` (💡).
// ============================================================

import { HOST, ACT, seatOrder, shuffle, sample, rint } from '../../core/engine-kit.js?v=1';
import * as S from './script.js?v=1';

// ---------- the rules tables (docs/research/avalon.md) ----------

export const GOOD_COUNT = Object.freeze({ 5: 3, 6: 4, 7: 4, 8: 5, 9: 6, 10: 6 });
export const EVIL_COUNT = Object.freeze({ 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 });
export const TEAM_SIZE = Object.freeze({
  5: [2, 3, 2, 3, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5],
});
/** Only quest 4, only with 7+ players, needs two Fail cards. */
export const failsNeeded = (n, questNo) => (n >= 7 && questNo === 4 ? 2 : 1);
/** Strict majority of ALL seats; a tie rejects. */
export const approvalsNeeded = (n) => Math.floor(n / 2) + 1;

export const MAX_REJECTS = 5;
const WIN_QUESTS = 3;
const SHOT_MS = 8000;
const EXTEND_MS = 60000;   // the host's ⏱️ ＋60 秒 on the assassination clock
const MAX_EXTENDS = 5;
const MIN_PRESENT = 3;     // 💤 is refused when fewer seats would be left at the table
const ABSENT = ACT.ABSENT ?? '@absent';
const PRESENT = ACT.PRESENT ?? '@present';
// 2026-10-04 (decision D8): the assassination gets a 120 s soft clock by default. A setup saved before that still
// holds the old default 0 and moves over once; the mark is kept with the setup, so a table that picks 0 keeps it.
const CFG_REV = 2;
const SPECIALS = ['percival', 'morgana', 'mordred', 'oberon'];
const EVIL_SPECIALS = ['morgana', 'mordred', 'oberon'];

/** Presets: which special roles each head-count gets (docs/games/avalon.md §2). */
export const PRESET_TABLE = Object.freeze({
  recommended: {
    5: ['percival', 'morgana'], 6: ['percival', 'morgana'], 7: ['percival', 'morgana', 'oberon'],
    8: ['percival', 'morgana'], 9: ['percival', 'morgana', 'mordred'],
    10: ['percival', 'morgana', 'mordred', 'oberon'],
  },
  plain: { 5: [], 6: [], 7: [], 8: [], 9: [], 10: [] },
  alt: {
    5: ['percival', 'mordred'], 6: ['percival', 'mordred'], 7: ['percival', 'morgana'],
    8: ['percival', 'morgana', 'mordred'], 9: ['percival', 'morgana', 'oberon'],
    10: ['percival', 'morgana', 'mordred'],
  },
});
export const PRESET_IDS = ['recommended', 'plain', 'alt', 'custom'];

// ---------- meta / rules ----------

export const meta = {
  id: 'avalon',
  name: '阿瓦隆',
  emoji: '🏰',
  accent: '#4aa3ff',
  players: [5, 10],
  minutes: [30, 45],
  narration: 'optional',     // announcements only: nothing in the game needs the narrator
  paperMode: false,
  singleDevice: 'full',      // the phone goes seat to seat, one private screen at a time
  banks: [],
  css: true,
  blurb: '組隊出任務，好人要搵出內鬼，壞人要守住梅林。',
};

export const rules = {
  quick: S.RULES_QUICK,
  roles: S.ROLE_ORDER.map((id) => ({
    id, name: S.ROLES[id].name, emoji: S.ROLES[id].emoji, team: S.ROLES[id].team, text: S.ROLES[id].text,
  })),
  sections: S.RULES_SECTIONS,
};

// ---------- config ----------

const RANGES = { revealSecs: [0, 120], questSecs: [0, 60], discussSecs: [0, 600], assassinSecs: [0, 600] };
const BOOLS = ['oberonSeenByMerlin', 'oberonReadsGoodToLady', 'flipEvil', 'passPhone'];
const LADY_VALUES = ['auto', 'on', 'off'];

const recommendedRoles = (n) => {
  const t = PRESET_TABLE.recommended[n] ?? [];
  return Object.fromEntries(SPECIALS.map((r) => [r, t.includes(r) ? 1 : 0]));
};

const DEFAULTS = Object.freeze({
  preset: 'recommended',
  roles: Object.freeze({ percival: 1, morgana: 1, mordred: 0, oberon: 0 }),
  lady: 'auto',
  oberonSeenByMerlin: true,
  oberonReadsGoodToLady: false,
  flipEvil: false,
  revealSecs: 25,
  questSecs: 12,
  discussSecs: 0,
  assassinSecs: 120,   // soft (decision D8): the clock shows, nothing happens at 0, the host can add time
  // Set by defaults() when one phone holds every seat: the two clocks were zeroed for pass-the-phone play, so
  // they come back when the table spreads over several phones again (not a form field).
  passPhone: false,
});

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function asInt(v) {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof x === 'number' && Number.isInteger(x) ? x : NaN;
}

const asBit = (v) => (v === true || v === 1 || v === '1' ? 1 : 0);

function keyOk(key, v) {
  if (key in RANGES) { const x = asInt(v); return x >= RANGES[key][0] && x <= RANGES[key][1]; }
  if (key === 'preset') return PRESET_IDS.includes(v);
  if (key === 'lady') return LADY_VALUES.includes(v);
  if (BOOLS.includes(key)) return typeof v === 'boolean';
  if (key === 'roles') {
    return isObj(v) && Object.entries(v).every(([k, x]) => SPECIALS.includes(k) && [0, 1, true, false, '0', '1'].includes(x));
  }
  return false;
}

/** Fill gaps, coerce (a <select> hands back strings), drop junk. Never throws. */
function norm(cfg) {
  const c = isObj(cfg) ? cfg : {};
  const out = { ...DEFAULTS, roles: { ...DEFAULTS.roles } };
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in c) || !keyOk(key, c[key])) continue;
    if (key in RANGES) out[key] = asInt(c[key]);
    else if (key === 'roles') out.roles = Object.fromEntries(SPECIALS.map((r) => [r, asBit(c.roles[r] ?? DEFAULTS.roles[r])]));
    else out[key] = c[key];
  }
  return out;
}

/** Which specials the config deals at n players. */
function specialsFor(cfg, n) {
  if (cfg.preset === 'custom') return cfg.roles;
  const t = PRESET_TABLE[cfg.preset]?.[n] ?? [];
  return Object.fromEntries(SPECIALS.map((r) => [r, t.includes(r) ? 1 : 0]));
}

/** The deck for n players: { ok, message, good, evil, counts } (counts include servants and minions). */
export function composition(cfg, n) {
  const good = GOOD_COUNT[n];
  const evil = EVIL_COUNT[n];
  if (!good) return { ok: false, message: S.CONFIG.badPlayers(n), good: 0, evil: 0, counts: {} };
  const sp = specialsFor(cfg, n);
  const evilSpecials = EVIL_SPECIALS.reduce((a, r) => a + sp[r], 0);
  const servant = good - 1 - sp.percival;
  const minion = evil - 1 - evilSpecials;
  const counts = {
    merlin: 1, percival: sp.percival, servant, assassin: 1,
    morgana: sp.morgana, mordred: sp.mordred, oberon: sp.oberon, minion,
  };
  if (servant < 0 || minion < 0) {
    return { ok: false, message: S.CONFIG.badComp(evil, evilSpecials), good, evil, counts };
  }
  return { ok: true, message: S.CONFIG.compOk(good, evil, counts), good, evil, counts };
}

/** Custom role counts that fit n: keep Percival, then Morgana, Mordred, Oberon while evil has room. */
function repairRoles(roles, n) {
  const out = { percival: asBit(roles.percival), morgana: 0, mordred: 0, oberon: 0 };
  let room = (EVIL_COUNT[n] ?? 2) - 1;
  for (const r of EVIL_SPECIALS) {
    if (asBit(roles[r]) && room > 0) { out[r] = 1; room -= 1; }
  }
  return out;
}

export const ladyOn = (cfg, n) => cfg.lady === 'on' || (cfg.lady === 'auto' && n >= 7);

const clampN = (n) => clamp(Number.isInteger(n) ? n : 5, 5, 10);

export const config = {
  /** Recommended setup for n, keeping the settings the table chose last time. */
  defaults(n, prev, env) {
    const k = clampN(n);
    const out = norm(prev);
    // The roles editor only matters on 自訂; otherwise it tracks the recommendation so that switching
    // to 自訂 starts from something sensible for this head-count.
    const hasRoles = isObj(prev) && keyOk('roles', prev.roles);
    out.roles = out.preset === 'custom' ? (hasRoles ? repairRoles(out.roles, k) : recommendedRoles(k)) : recommendedRoles(k);
    if (isObj(prev) && prev.cfgRev !== CFG_REV && out.assassinSecs === 0) out.assassinSecs = DEFAULTS.assassinSecs;
    out.cfgRev = CFG_REV;
    // One phone for everybody: a shared clock cannot time N hand-overs, so both windows become taps.
    // Several phones again (friends joined after the host opened the room alone): the clocks come back,
    // but only when they were zeroed for the shared phone; a table that chose 0 itself keeps 0.
    if (isObj(env) && env.singleDevice) {
      out.revealSecs = 0; out.questSecs = 0; out.passPhone = true;
    } else if (isObj(env) && out.passPhone) {
      out.revealSecs = DEFAULTS.revealSecs; out.questSecs = DEFAULTS.questSecs; out.passPhone = false;
    }
    return out;
  },

  /**
   * One-tap presets with a reason (BACKLOG #8). Each `cfg` is a patch over the current config and passes
   * validate() at this n; the first entry is what defaults(n) deals. 奧伯倫隱形 (the Dized reading of
   * Oberon, research "Open questions") only appears where the standard deck has Oberon.
   */
  presets(n) {
    const k = clampN(n);
    const C = S.PRESET_CHIP;
    const official = { oberonSeenByMerlin: true, oberonReadsGoodToLady: false };
    const out = [
      { id: 'standard', label: C.standard.label, reason: C.standard.reason(k), cfg: { preset: 'recommended', lady: 'auto', ...official } },
      { id: 'beginner', label: C.beginner.label, reason: C.beginner.reason(k), cfg: { preset: 'plain', lady: 'off' } },
      { id: 'alt', label: C.alt.label(k), reason: C.alt.reason(k), cfg: { preset: 'alt', lady: 'auto', ...official } },
    ];
    if (PRESET_TABLE.recommended[k].includes('oberon')) {
      out.push({
        id: 'hidden-oberon', label: C.hiddenOberon.label, reason: C.hiddenOberon.reason,
        cfg: { preset: 'recommended', lady: 'auto', oberonSeenByMerlin: false, oberonReadsGoodToLady: true },
      });
    }
    return out;
  },

  validate(cfg, n) {
    const warnings = [];
    if (!Number.isInteger(n) || n < meta.players[0] || n > meta.players[1]) {
      return { ok: false, message: S.CONFIG.badPlayers(n), warnings };
    }
    const c = isObj(cfg) ? cfg : {};
    for (const key of Object.keys(DEFAULTS)) {
      if (key in c && !keyOk(key, c[key])) {
        return { ok: false, message: S.CONFIG.badKey(S.CONFIG.labels[key] ?? key), warnings };
      }
    }
    const m = norm(c);
    const comp = composition(m, n);
    if (!comp.ok) return { ok: false, message: comp.message, warnings };

    const k = comp.counts;
    if (k.morgana && !k.percival) warnings.push(S.CONFIG.warn.morganaNoPercival);
    if (n === 5 && k.percival && !k.morgana && !k.mordred) warnings.push(S.CONFIG.warn.percival5);
    if (ladyOn(m, n) && n < 7) warnings.push(S.CONFIG.warn.ladySmall);
    if (m.revealSecs > 0 && m.revealSecs < 10) warnings.push(S.CONFIG.warn.revealShort);
    if (m.questSecs > 0 && m.questSecs < 5) warnings.push(S.CONFIG.warn.questShort);
    if (k.oberon && !m.oberonSeenByMerlin && !m.oberonReadsGoodToLady && ladyOn(m, n)) {
      warnings.push(S.CONFIG.warn.oberonHiddenBoth);
    }
    return { ok: true, message: comp.message, warnings };
  },

  fields(cfg, n) {
    const m = norm(cfg);
    const k = clampN(n);
    const comp = composition(m, k);
    const L = S.CONFIG.labels;
    const H = S.CONFIG.help;
    const out = [
      {
        key: 'preset', label: L.preset, type: 'select',
        options: PRESET_IDS.map((id) => ({ value: id, label: S.PRESET_LABEL[id] })),
        help: S.presetReason(m.preset, k),
      },
    ];
    if (m.preset === 'custom') {
      const row = (id, extra = {}) => ({ id, name: S.ROLES[id].name, emoji: S.ROLES[id].emoji, ...extra });
      out.push({
        key: 'roles', label: L.roles, type: 'roles', min: 0, max: 1,
        help: comp.message || S.CONFIG.rolesHelp,
        options: [
          row('merlin', { min: 1, max: 1 }), row('assassin', { min: 1, max: 1 }),
          row('percival', { min: 0, max: 1 }), row('morgana', { min: 0, max: 1 }),
          row('mordred', { min: 0, max: 1 }), row('oberon', { min: 0, max: 1 }),
          row('servant', { auto: true }), row('minion', { auto: true }),
        ],
      });
    }
    out.push({ key: 'lady', label: L.lady, type: 'select', options: S.LADY_OPTIONS, help: H.lady });
    if (comp.counts.oberon) {
      out.push({ key: 'oberonSeenByMerlin', label: L.oberonSeenByMerlin, type: 'bool', help: H.oberonSeenByMerlin });
      if (ladyOn(m, k)) {
        out.push({ key: 'oberonReadsGoodToLady', label: L.oberonReadsGoodToLady, type: 'bool', help: H.oberonReadsGoodToLady });
      }
    }
    out.push(
      { key: 'revealSecs', label: L.revealSecs, type: 'seconds', min: 0, max: 120, help: H.revealSecs },
      { key: 'questSecs', label: L.questSecs, type: 'seconds', min: 0, max: 60, help: H.questSecs },
      { key: 'discussSecs', label: L.discussSecs, type: 'seconds', min: 0, max: 600, help: H.discussSecs },
      { key: 'flipEvil', label: L.flipEvil, type: 'bool', help: H.flipEvil },
      { key: 'assassinSecs', label: L.assassinSecs, type: 'seconds', min: 0, max: 600, help: H.assassinSecs },
    );
    return out;
  },

  summary(cfg, n) {
    const m = norm(cfg);
    const k = clampN(n);
    const comp = composition(m, k);
    const T = S.CONFIG.summary;
    const lines = [T.players(k, GOOD_COUNT[k], EVIL_COUNT[k])];
    if (comp.ok) {
      lines.push(T.good(S.deckText(comp.counts, 'good')), T.evil(S.deckText(comp.counts, 'evil')));
    } else {
      lines.push(comp.message);
    }
    const lady = ladyOn(m, k);
    lines.push(T.lady(lady, m.lady === 'auto'));
    if (comp.ok && comp.counts.oberon) lines.push(T.oberon(m.oberonSeenByMerlin, m.oberonReadsGoodToLady && lady));
    lines.push(T.reason(S.presetReason(m.preset, k)));
    if (m.passPhone && m.revealSecs === 0 && m.questSecs === 0) lines.push(T.onePhone);
    lines.push(T.reveal(m.revealSecs), T.quest(m.questSecs));
    if (m.discussSecs > 0) lines.push(T.discuss(m.discussSecs));
    if (m.assassinSecs > 0) lines.push(T.assassin(m.assassinSecs));
    if (m.flipEvil) lines.push(T.flip);
    return lines;
  },
};

// ---------- small helpers ----------

const nowOf = (ctx) => (typeof ctx?.now === 'function' ? ctx.now() : (ctx?.now ?? 0));
const isStr = (x) => typeof x === 'string';
const isEvil = (role) => S.teamOf(role) === 'evil';
const nm = (s, pid) => s.names[pid] ?? '?';
const names = (s, pids) => pids.map((p) => nm(s, p));
const countOf = (arr, x) => arr.filter((v) => v === x).length;

const leaderOf = (s) => s.order[s.leaderIx];
/** 💤 marked absent by the host (public). */
const isAway = (s, pid) => (s.absent ?? []).includes(pid);
/** The seats a vote counts: everybody who is at the table (a seat marked 💤 simply does not vote). */
const votersOf = (s) => s.order.filter((p) => !isAway(s, p));
/** The index of the next seat after `ix` that is at the table (the leader token skips a seat marked 💤). */
function nextPresentIx(s, ix) {
  for (let k = 1; k <= s.n; k++) {
    const j = (ix + k) % s.n;
    if (!isAway(s, s.order[j])) return j;
  }
  return (ix + 1) % s.n;
}
const nextLeaderOf = (s) => s.order[nextPresentIx(s, s.leaderIx)];
/**
 * Who may tap 繼續 on a public screen: the leader — or, when the leader is 💤, anybody at the table. On one phone
 * (passPhone, re-run F2) anybody at the table: the result lies face up in the middle, so the table does not wait on
 * whoever led to tap it twice.
 */
const tableContinues = (s) => !!s.cfg.passPhone || isAway(s, leaderOf(s));
const mayContinue = (s, pid) => pid === leaderOf(s) || (tableContinues(s) && !isAway(s, pid));
const sizeOf = (s) => TEAM_SIZE[s.n][s.questNo - 1];
const needOf = (s) => failsNeeded(s.n, s.questNo);
const wins = (s) => countOf(s.results, true);
const losses = (s) => countOf(s.results, false);
const roleOwner = (s, role) => s.order.find((p) => s.role[p] === role) ?? null;
const evilSeats = (s) => s.order.filter((p) => isEvil(s.role[p]));
/** Who Merlin cannot see, from the PUBLIC deck and setup only: Mordred in play, Oberon hidden by the setting (#28). */
const merlinBlind = (s) => ({
  mordred: s.deck.some((d) => d.role === 'mordred'),
  oberon: s.deck.some((d) => d.role === 'oberon') && !s.cfg.oberonSeenByMerlin,
});

/**
 * Who takes the shot: the Assassin — or, if the host marked the Assassin 💤, the next evil seat at the table (in seat
 * order after the Assassin), as a real table would let another evil player point. Every screen stays the same; only
 * that seat's own confirm becomes real. null when no evil seat is left at the table.
 */
function shooterOf(s) {
  const a = roleOwner(s, 'assassin');
  if (a && !isAway(s, a)) return a;
  const i = Math.max(0, s.order.indexOf(a));
  for (let k = 1; k <= s.n; k++) {
    const p = s.order[(i + k) % s.n];
    if (isEvil(s.role[p]) && !isAway(s, p)) return p;
  }
  return null;
}

/** Lady of the Lake reads loyalty from the character card; Oberon is the only switchable one. */
function loyaltyOf(s, pid) {
  const r = s.role[pid];
  if (r === 'oberon' && s.cfg.oberonReadsGoodToLady) return 'good';
  return isEvil(r) ? 'evil' : 'good';
}

/** What a seat is told at the start. Lists are shuffled once here, so seat order never leaks a role. */
export function knowledgeFor(s, pid, rng) {
  const r = s.role[pid];
  const others = s.order.filter((p) => p !== pid);
  if (r === 'merlin') {
    const seen = others.filter((p) => isEvil(s.role[p]) && s.role[p] !== 'mordred'
      && (s.role[p] !== 'oberon' || s.cfg.oberonSeenByMerlin));
    return { kind: 'seesEvil', pids: shuffle(rng, seen) };
  }
  if (r === 'percival') {
    return { kind: 'seesMerlin', pids: shuffle(rng, others.filter((p) => s.role[p] === 'merlin' || s.role[p] === 'morgana')) };
  }
  if (r === 'oberon') return { kind: 'alone', pids: [] };
  if (isEvil(r)) {
    return { kind: 'allies', pids: shuffle(rng, others.filter((p) => isEvil(s.role[p]) && s.role[p] !== 'oberon')) };
  }
  return { kind: 'none', pids: [] };
}

function combos(list, k) {
  if (k === 0) return [[]];
  if (list.length < k) return [];
  const [head, ...rest] = list;
  return [...combos(rest, k - 1).map((c) => [head, ...c]), ...combos(rest, k)];
}

// ---------- phase transitions ----------

function setTimer(s, ctx, secs, label) {
  if (secs > 0) { s.deadline = nowOf(ctx) + secs * 1000; s.timerLabel = label; } else { s.deadline = null; s.timerLabel = ''; }
}

function startPick(s, ctx) {
  if (isAway(s, leaderOf(s))) s.leaderIx = nextPresentIx(s, s.leaderIx);   // 💤 never leads (e.g. away before the first pick)
  s.phase = 'pick';
  s.team = [];
  s.votes = {};
  s.reveal = null;
  setTimer(s, ctx, s.cfg.discussSecs, S.T.pick.timerLabel);   // a nudge only: advance() leaves `pick` alone
}

/** Leader token moves one seat per proposal, approved or not (skipping a seat marked 💤). */
function nextProposal(s, ctx) {
  s.leaderIx = nextPresentIx(s, s.leaderIx);
  s.proposalNo += 1;
  startPick(s, ctx);
}

function startQuest(s, ctx) {
  s.phase = 'quest';
  s.cards = {};
  s.auto = [];
  s.flip = {};
  s.windowOver = false;   // the timed window is a MINIMUM: results come at the later of the clock and the last card
  for (const p of s.team) s.flip[p] = ctx.rng() < 0.5;   // only that seat's tiles are mirrored; harmless to every other seat
  s.outcome = null;
  setTimer(s, ctx, s.cfg.questSecs, S.T.quest.timerLabel);
  // a member marked 💤 plays Success at once (the dead-phone rule), recorded in `auto` like every system card
  for (const p of s.team) if (isAway(s, p)) { s.cards[p] = 'success'; s.auto.push(p); }
  if (s.cfg.questSecs === 0 && s.team.every((p) => p in s.cards)) resolveQuest(s, ctx);
}

function tallyVotes(s) {
  // a seat marked 💤 does not vote: the majority is over the seats at the table (decision D4)
  const voters = votersOf(s);
  const votes = {};
  for (const p of voters) votes[p] = s.votes[p];
  const approves = voters.filter((p) => votes[p] === 'approve').length;
  const rejects = voters.length - approves;
  const approved = approves >= approvalsNeeded(voters.length);
  // no = the game-wide proposal id (internal); k = which proposal of THIS quest it was, the number every screen shows
  // (「任務 3 · 第 2 次提議」, matching the 連續否決 track: a quest always starts on 0 rejections)
  const entry = {
    q: s.questNo, no: s.proposalNo, k: s.rejects + 1, leader: leaderOf(s), team: s.team.slice(), votes, approves, rejects, approved,
  };
  const away = s.order.filter((p) => !voters.includes(p));
  if (away.length) entry.absent = away;
  s.voteLog.push(entry);
  const before = s.rejects;
  s.rejects = approved ? 0 : s.rejects + 1;
  const ends = !approved && s.rejects >= MAX_REJECTS;
  s.reveal = { approves, rejects, approved, needed: approvalsNeeded(voters.length), before, after: s.rejects, ends: ends ? 'five-rejections' : null };
  if (ends) s.pendingEnd = { winner: 'evil', reason: 'five-rejections' };
  s.phase = 'voted';
  s.deadline = null;
  s.timerLabel = '';
}

/** Play every missing card as success (a dead phone), then count. The pile is built from counts only. */
function resolveQuest(s, ctx) {
  for (const p of s.team) {
    if (!(p in s.cards)) { s.cards[p] = 'success'; s.auto.push(p); }
  }
  const played = {};
  for (const p of s.team) played[p] = s.cards[p];
  const fails = s.team.filter((p) => played[p] === 'fail').length;
  const successes = s.team.length - fails;
  const need = needOf(s);
  const success = fails < need;
  const pile = shuffle(ctx.rng, [...Array(successes).fill('success'), ...Array(fails).fill('fail')]);
  s.results[s.questNo - 1] = success;
  s.quests.push({
    no: s.questNo, leader: leaderOf(s), team: s.team.slice(), successes, fails, need, success, pile,
    played, auto: s.auto.slice(),
  });
  s.outcome = { no: s.questNo, team: s.team.slice(), leader: leaderOf(s), successes, fails, need, success, pile: pile.slice() };
  s.phase = 'quest-result';
  s.deadline = null;
  s.timerLabel = '';
}

/** What comes after the quest-result screen. */
function nextAfterQuest(s) {
  if (losses(s) >= WIN_QUESTS) return 'over';
  if (wins(s) >= WIN_QUESTS) return 'assassinate';
  if (s.ladyOn && [2, 3, 4].includes(s.quests.length) && !isAway(s, s.lady.holder)) return 'lady';
  return 'pick';
}

function afterQuest(s, ctx) {
  switch (nextAfterQuest(s)) {
    case 'over': s.pendingEnd = { winner: 'evil', reason: 'three-fails' }; return toOver(s);
    case 'assassinate': return startAssassinate(s, ctx);
    case 'lady': return startLady(s, ctx);
    default: return nextQuest(s, ctx);
  }
}

function nextQuest(s, ctx) {
  s.questNo += 1;
  s.rejects = 0;
  nextProposal(s, ctx);
  return s;
}

function startLady(s, ctx) {
  // the holder is 💤: no check this time (the token stays with them), on to the next quest
  if (isAway(s, s.lady.holder)) return nextQuest(s, ctx);
  s.phase = 'lady';
  s.lady.step = { holder: s.lady.holder, target: null, loyalty: null };
  s.deadline = null;
  s.timerLabel = '';
  return s;
}

/**
 * The assassination. `assassinSecs` (default 120) is a SOFT clock (decision D8): it shows how long the table agreed to
 * talk, and at 0 nothing happens — advance() leaves the step alone, the clock stays on 0:00 and every screen says
 * 「夠鐘」, the Assassin can still take as long as they need, and the host can add 60 s (hostActions). Nothing ever
 * picks for the Assassin by itself; only the host's 代佢做 for a seat whose phone is gone does (a random shot).
 */
function startAssassinate(s, ctx) {
  s.phase = 'assassinate';
  s.decoyed = [];
  s.extends = 0;
  s.talk = false;
  if (!shooterOf(s)) {   // every evil seat is 💤: nobody is left to point at Merlin
    s.pendingEnd = { winner: 'good', reason: 'no-shot' };
    return toOver(s);
  }
  // #27, one phone in the middle: evil talks it over first, out loud and face up (the clock shows), and only a tap on
  // 「傾好喇」 calls the Assassin behind the eyes-closed card — never eyes closed before evil has talked
  if (s.cfg.passPhone) s.talk = true;
  setTimer(s, ctx, s.cfg.assassinSecs, S.T.assassinate.timerLabel);
  return s;
}

function toShot(s, ctx, target) {
  const hit = s.role[target] === 'merlin';
  s.shot = { assassin: shooterOf(s), target, hit, merlin: roleOwner(s, 'merlin') };
  s.pendingEnd = { winner: hit ? 'evil' : 'good', reason: hit ? 'assassinated-merlin' : 'assassin-missed' };
  s.phase = 'shot';
  s.deadline = nowOf(ctx) + SHOT_MS;
  s.timerLabel = '';
  return s;
}

function toOver(s) {
  const end = s.pendingEnd ?? { winner: 'evil', reason: 'three-fails' };
  s.winner = end.winner;
  s.reason = end.reason;
  s.phase = 'over';
  s.deadline = null;
  s.timerLabel = '';
  s.final = explain(s);
  return s;
}

// ---------- cues (public information only) ----------

function rawCue(s) {
  const id = (k) => `av${s.gid}:${k}`;
  const text = (t, k) => ({ id: id(k), text: t, minMs: S.cueMinMs(t) });
  // After a 呢鋪唔計 the same step starts again: a new id (so it is announced again) and a short preface.
  const voids = s.voids ?? [];   // a snapshot from before 呢鋪唔計 existed has none
  // a leader token moved on past a seat marked 💤 restarts `pick` under the same proposal number: a fresh id too
  const vk = (voids.length ? `~${voids.length}` : '') + (s.leaderSkips ? `^${s.leaderSkips}` : '');
  const redo = (ph) => ph === s.phase && redoing(s);
  switch (s.phase) {
    case 'reveal':
      return text(S.cueReveal({ n: s.n, deck: s.deck, secs: s.cfg.revealSecs, pass: !!s.cfg.passPhone }), 'reveal');
    case 'pick':
      return text(S.cuePick({
        q: s.questNo, size: sizeOf(s), need: needOf(s), leader: nm(s, leaderOf(s)), rejects: s.rejects, redo: redo('pick'),
      }), `pick:${s.proposalNo}${vk}`);
    case 'vote':
      return text(S.cueVote({
        leader: nm(s, leaderOf(s)), team: s.team.map((p) => (p === leaderOf(s) ? '自己' : nm(s, p))), redo: redo('vote'),
      }), `vote:${s.proposalNo}${vk}`);
    case 'voted': {
      const r = s.reveal;
      const rejecters = s.order.filter((p) => s.voteLog[s.voteLog.length - 1].votes[p] === 'reject');
      return text(S.cueVoted({
        approved: r.approved, approves: r.approves, rejects: r.rejects, rejecters: names(s, rejecters),
        ends: !!r.ends, nextLeader: nm(s, nextLeaderOf(s)), k: r.after, secondLast: r.after === MAX_REJECTS - 1,
      }), `voted:${s.proposalNo}`);
    }
    case 'quest':
      return text(S.cueQuest({ team: names(s, s.team), secs: s.cfg.questSecs, redo: redo('quest') }), `quest:${s.questNo}${vk}`);
    case 'quest-result': {
      const o = s.outcome;
      return text(S.cueResult({
        successes: o.successes, fails: o.fails, success: o.success, need: o.need, wins: wins(s), losses: losses(s),
        next: nextAfterQuest(s),
      }), `result:${s.questNo}`);
    }
    case 'lady':
      return text(S.cueLady({ holder: nm(s, s.lady.holder) }), `lady:${s.lady.log.length}`);
    case 'lady-peek':
      return text(S.cueLadyPeek({ holder: nm(s, s.lady.step.holder), target: nm(s, s.lady.step.target) }), `ladypeek:${s.lady.log.length}`);
    case 'assassinate':
      // one phone: the talk is announced first; once the table taps 傾好喇, the eyes-closed call for the Assassin
      if (s.cfg.passPhone && !s.talk) return text(S.cueAssassinPick(), 'assassinate:pick');
      return text(S.cueAssassinate({ flip: s.cfg.flipEvil, talk: !!s.talk }), 'assassinate');
    case 'shot':
      return text(S.cueShot({
        assassin: nm(s, s.shot.assassin), target: nm(s, s.shot.target), hit: s.shot.hit, merlin: nm(s, s.shot.merlin),
      }), 'shot');
    default:
      return null;
  }
}

// ---------- host-internal actions ----------

function skipStep(s, ctx) {
  switch (s.phase) {
    case 'reveal': startPick(s, ctx); break;
    case 'voted': continueVoted(s, ctx); break;
    case 'quest': resolveQuest(s, ctx); break;
    case 'quest-result': afterQuest(s, ctx); break;
    case 'lady-peek': finishLady(s, ctx); break;
    case 'shot': toOver(s); break;
    case 'assassinate': s.talk = false; break;   // ends evil's talk (one phone); the shot itself needs the Assassin
    default: break;   // pick / vote / lady need a real decision: use autoAct for a stalled seat
  }
  return s;
}

function hostAct(s, a, ctx) {
  if (a.type === ACT.CUE_DONE) {
    const c = rawCue(s);
    if (c && a.id === c.id) s.cueAck = c.id;
    return s;
  }
  if (a.type === ACT.NEXT) {
    const c = rawCue(s);
    if (c && c.id !== s.cueAck) { s.cueAck = c.id; return s; }   // 下一步 first means "I read it out"
    return skipStep(s, ctx);
  }
  if (a.type === ACT.VOID_ROUND) return voidRound(s, ctx);
  if (a.type === ABSENT) return setAway(s, ctx, a.pid, true);
  if (a.type === PRESENT) return setAway(s, ctx, a.pid, false);
  if (a.type === 'extend') {
    // ⏱️ ＋60 秒 (hostActions): only on a running (or run-out) assassination clock
    if (s.phase === 'assassinate' && s.deadline != null && (s.extends ?? 0) < MAX_EXTENDS) {
      s.deadline = Math.max(s.deadline, nowOf(ctx)) + EXTEND_MS;
      s.extends = (s.extends ?? 0) + 1;
    }
    return s;
  }
  return s;   // ACT.AUTO is resolved by the session through autoAct()
}

/**
 * 💤 (@absent) / back (@present), host only, public (decision D4). A seat marked absent is not waited on for the rest
 * of the game: it does not vote (the majority is over the seats at the table), its quest card is Success (the
 * dead-phone rule), the leader token and the Lady skip it, and if it is the Assassin another evil seat takes the shot.
 * Nothing here depends on a role in a way anybody can see. Refused (state unchanged) when fewer than 3 seats would be
 * left at the table.
 */
function setAway(s, ctx, pid, away) {
  if (!isStr(pid) || !s.order.includes(pid) || away === isAway(s, pid)) return s;
  s.absent ??= [];
  if (!away) {
    s.absent.splice(s.absent.indexOf(pid), 1);
    return s;   // back: votes from now on (an open vote waits for them), leads when the token comes round
  }
  if (votersOf(s).length - 1 < MIN_PRESENT) return s;
  s.absent.push(pid);
  switch (s.phase) {
    case 'reveal':
      if (s.cfg.revealSecs === 0 && votersOf(s).every((p) => s.seen.includes(p))) startPick(s, ctx);
      break;
    case 'pick':
      if (pid === leaderOf(s)) {   // the token moves on — not a rejection, not a new proposal
        s.leaderIx = nextPresentIx(s, s.leaderIx);
        s.leaderSkips = (s.leaderSkips ?? 0) + 1;
        startPick(s, ctx);
      }
      break;
    case 'vote':
      delete s.votes[pid];   // a ballot not yet public: it simply does not count
      if (votersOf(s).every((p) => s.votes[p] !== undefined)) tallyVotes(s);
      break;
    case 'quest':
      if (s.team.includes(pid) && !(pid in s.cards)) {
        s.cards[pid] = 'success';
        s.auto.push(pid);
        if ((s.cfg.questSecs === 0 || s.windowOver) && s.team.every((p) => p in s.cards)) resolveQuest(s, ctx);
      }
      break;
    case 'lady':
      if (pid === s.lady.step.holder) { s.lady.step = null; nextQuest(s, ctx); }
      break;
    case 'lady-peek':
      if (pid === s.lady.step.holder) finishLady(s, ctx);
      break;
    case 'assassinate':
      if (!shooterOf(s)) { s.pendingEnd = { winner: 'good', reason: 'no-shot' }; toOver(s); }
      break;
    default: break;
  }
  return s;
}

/** The current pick / vote / quest is a re-run after the host's 呢鋪唔計 (public: the host did it in front of everybody). */
function redoing(s) {
  const last = s.voids?.[s.voids.length - 1];
  return !!last && last.phase === s.phase && last.q === s.questNo && last.no === s.proposalNo;
}

/**
 * 呢鋪唔計 (`@void-round`, a phone died): throw away the step that is still collecting a secret or a decision,
 * with no consequence for the score or the vote track.
 *   pick  — the leader cannot pick: the token moves on one seat; it is NOT a rejection.
 *   vote  — the votes cast so far are discarded (none was public yet); the same team is voted on again.
 *   quest — the cards played so far are discarded (none was public yet); the same team plays again.
 * Everything else is left alone: public screens are skipped with 下一步, and the Lady's check and the shot
 * need the real person (代佢做 covers a dead phone there).
 */
function voidRound(s, ctx) {
  const record = () => { (s.voids ??= []).push({ q: s.questNo, no: s.proposalNo, k: s.rejects + 1, phase: s.phase, leader: leaderOf(s) }); };
  switch (s.phase) {
    case 'pick':
      record();
      s.leaderIx = nextPresentIx(s, s.leaderIx);
      startPick(s, ctx);
      return s;
    case 'vote':
      if (!Object.keys(s.votes).length) return s;   // nothing cast yet: nothing to throw away
      record();
      s.votes = {};
      return s;
    case 'quest':
      // only the system's Success for a seat marked 💤 is in: nothing anybody played to throw away
      if (!Object.keys(s.cards).some((p) => !(s.auto ?? []).includes(p))) return s;
      record();
      startQuest(s, ctx);
      return s;
    default:
      return s;
  }
}

// ---------- seat actions ----------

function continueVoted(s, ctx) {
  if (s.pendingEnd) return toOver(s);
  if (s.reveal.approved) return startQuest(s, ctx);
  return nextProposal(s, ctx);
}

function finishLady(s, ctx) {
  const st = s.lady.step;
  s.lady.log.push({ q: s.questNo, holder: st.holder, target: st.target, loyalty: st.loyalty });
  s.lady.holder = st.target;
  s.lady.held.push(st.target);
  s.lady.step = null;
  return nextQuest(s, ctx);
}

const validTeam = (s, team) => Array.isArray(team) && team.length === sizeOf(s)
  && new Set(team).size === team.length && team.every((p) => isStr(p) && s.order.includes(p));

function act(state, msg, ctx = {}) {
  const s = state;
  const pid = msg?.pid;
  const a = msg?.action;
  if (!a || typeof a !== 'object' || typeof a.type !== 'string' || s.phase === 'over') return s;
  if (pid === HOST) return hostAct(s, a, ctx);
  if (typeof pid !== 'string' || !s.order.includes(pid) || isAway(s, pid)) return s;   // 💤: the host brings them back

  switch (s.phase) {
    case 'reveal':
      if (a.type === 'seen' && !s.seen.includes(pid)) {
        s.seen.push(pid);
        if (s.cfg.revealSecs === 0 && votersOf(s).every((p) => s.seen.includes(p))) startPick(s, ctx);
      }
      return s;

    case 'pick':
      if (a.type === 'pick' && pid === leaderOf(s) && validTeam(s, a.team)) {
        s.team = s.order.filter((p) => a.team.includes(p));
        s.phase = 'vote';
        s.votes = {};
        s.deadline = null;
        s.timerLabel = '';
      }
      return s;

    case 'vote':
      if (a.type === 'vote' && (a.vote === 'approve' || a.vote === 'reject')) {
        s.votes[pid] = a.vote;
        if (votersOf(s).every((p) => s.votes[p] !== undefined)) tallyVotes(s);
      }
      return s;

    case 'voted':
      if (a.type === 'continue' && mayContinue(s, pid)) continueVoted(s, ctx);
      return s;

    case 'quest':
      if (a.type === 'quest' && s.team.includes(pid) && !(pid in s.cards) && (a.card === 'success' || a.card === 'fail')) {
        if (a.card === 'fail' && !isEvil(s.role[pid])) return s;   // good can only succeed; the UI never offers it either
        s.cards[pid] = a.card;
        if ((s.cfg.questSecs === 0 || s.windowOver) && s.team.every((p) => p in s.cards)) resolveQuest(s, ctx);
      }
      return s;

    case 'quest-result':
      if (a.type === 'continue' && mayContinue(s, pid)) afterQuest(s, ctx);
      return s;

    case 'lady': {
      const st = s.lady.step;
      if (a.type === 'lady' && pid === st.holder && isStr(a.target) && s.order.includes(a.target)
        && a.target !== st.holder && !s.lady.held.includes(a.target)) {
        st.target = a.target;
        st.loyalty = loyaltyOf(s, a.target);
        s.phase = 'lady-peek';
      }
      return s;
    }

    case 'lady-peek':
      if (a.type === 'lady-done' && pid === s.lady.step.holder) finishLady(s, ctx);
      return s;

    case 'assassinate': {
      if (s.talk) {
        // anybody at the table says the talk is over (one phone: a table tap); nobody can shoot or decoy before that
        if (a.type === 'talked') s.talk = false;
        return s;
      }
      const assassin = shooterOf(s);
      if (a.type === 'assassinate' && pid === assassin && isStr(a.target) && s.order.includes(a.target)) {
        toShot(s, ctx, a.target);
      } else if (a.type === 'decoy' && pid !== assassin && !s.decoyed.includes(pid)) {
        s.decoyed.push(pid);   // same tap, same screen, no effect: finger noise tells nothing
      }
      return s;
    }

    case 'shot':
      if (a.type === 'continue' && pid === s.shot.assassin) toOver(s);
      return s;

    default:
      return s;
  }
}

function advance(state, ctx) {
  const s = state;
  if (s.deadline == null) return s;
  if (typeof ctx?.now === 'number' && ctx.now < s.deadline) return s;
  // `pick` and `assassinate` carry a soft deadline (a nudge): nothing happens when it passes — in particular nothing
  // ever picks for the Assassin (decision D8). The clock stays on 0:00 until the shot or the host's ＋60 秒.
  if (s.phase === 'reveal') startPick(s, ctx);
  else if (s.phase === 'quest') {
    // The clock only guarantees a minimum time. A card still missing is waited for (代佢做 / 下一步 settle a dead phone).
    s.windowOver = true;
    s.deadline = null;
    s.timerLabel = '';
    if (s.team.every((p) => p in s.cards)) resolveQuest(s, ctx);
  } else if (s.phase === 'shot') toOver(s);
  return s;
}

// ---------- views (whitelist) ----------

const publicVoteEntry = (e) => ({
  q: e.q, no: e.no, leader: e.leader, team: e.team.slice(), votes: { ...e.votes },
  approves: e.approves, rejects: e.rejects, approved: e.approved, absent: (e.absent ?? []).slice(),
});

const publicQuest = (q) => ({
  no: q.no, leader: q.leader, team: q.team.slice(), successes: q.successes, fails: q.fails,
  need: q.need, success: q.success, pile: q.pile.slice(),
});

function titleFor(s) {
  const T = S.TITLE;
  const leader = nm(s, leaderOf(s));
  switch (s.phase) {
    case 'reveal': return T.reveal;
    case 'pick': return [T.quest(s.questNo), T.pick(leader, s.rejects + 1)];
    case 'vote': return [T.quest(s.questNo), T.vote(leader, s.rejects + 1)];
    case 'voted': return [T.quest(s.questNo), T.voted(leader, s.reveal.before + 1)];
    case 'quest': return [T.quest(s.questNo), T.playing];
    case 'quest-result': return [T.quest(s.questNo), T.result];
    case 'lady': return [T.lady, T.ladyHolder(nm(s, s.lady.holder))];
    case 'lady-peek': return [T.lady, T.ladyHolder(nm(s, s.lady.step.holder))];
    case 'assassinate': return [T.assassinate, T.assassinateSub];
    case 'shot': return [T.shot, ''];
    default: return T.over;
  }
}

/**
 * 💡 「而家要做咩」 (BACKLOG U1): one short line for a first-timer, shown only when the seat opens the hint
 * sheet. It is chosen from what this seat's view shows anyway (leader, team membership, own vote / card
 * done, Lady holder) and never from the seat's role: the reveal, the quest tiles and the assassination read
 * the same for good and evil, like their screens.
 */
function hintOf(s, seat) {
  const H = S.HINT;
  const isLeader = seat !== null && seat === leaderOf(s);
  const last = s.rejects >= MAX_REJECTS - 1;
  switch (s.phase) {
    case 'reveal':
      if (seat === null) return H.revealTable;
      if (s.cfg.revealSecs > 0) return H.revealTimed;
      return s.seen.includes(seat) ? H.revealDone : H.revealTap;
    case 'pick':
      if (isLeader) return last ? H.pickLeaderLast(sizeOf(s)) : H.pickLeader(sizeOf(s));
      return last ? H.pickLast : H.pickOthers;
    case 'vote':
      if (seat === null) return H.voteTable;
      if (s.votes[seat] !== undefined) return H.voteDone;
      return last ? H.voteLast : H.vote;
    case 'voted':
      if (s.reveal.ends) return H.votedEnd;
      return isLeader ? H.votedLeader : s.cfg.passPhone ? H.votedTable : H.voted;
    case 'quest':
      if (seat === null || !s.team.includes(seat)) return H.questOthers;
      return seat in s.cards ? H.questDone : H.questMember;
    case 'quest-result': return isLeader ? H.resultLeader : s.cfg.passPhone ? H.resultTable : H.result;
    case 'lady': return seat !== null && seat === s.lady.step.holder ? H.ladyHolder : H.ladyOthers;
    case 'lady-peek': return seat !== null && seat === s.lady.step.holder ? H.peekHolder : H.peekOthers;
    case 'assassinate': return s.talk ? H.assassinateTalk : H.assassinate;
    case 'shot': return H.shot;
    default: return H.over;
  }
}

function ladyPublic(s) {
  if (!s.ladyOn) return null;
  return {
    holder: s.lady.holder,
    held: s.lady.held.slice(),
    log: s.lady.log.map((l) => ({ q: l.q, holder: l.holder, target: l.target })),   // never the loyalty
    step: s.lady.step ? { holder: s.lady.step.holder, target: s.lady.step.target } : null,
  };
}

function endView(s) {
  const quests = s.quests.map((q) => ({ ...publicQuest(q), played: { ...q.played }, auto: q.auto.slice() }));
  const roles = Object.fromEntries(s.order.map((p) => [p, s.role[p]]));
  const knows = Object.fromEntries(s.order.map((p) => [p, { kind: s.knows[p].kind, pids: s.knows[p].pids.slice() }]));
  return {
    winner: s.winner, reason: s.reason, summary: s.final.summary, roles, knows, quests,
    lady: s.lady.log.map((l) => ({ q: l.q, holder: l.holder, target: l.target, loyalty: l.loyalty })),
    shot: s.shot ? { ...s.shot } : null,
  };
}

function view(state, pid) {
  const s = state;
  const seat = isStr(pid) && s.order.includes(pid) ? pid : null;
  const [title, subtitle] = titleFor(s);

  const v = {
    me: seat,
    phase: s.phase,
    n: s.n,
    title,
    subtitle,
    hint: hintOf(s, seat),
    order: s.order.slice(),
    deck: s.deck.map((d) => ({ role: d.role, count: d.count })),
    // the 💡 sheet's 「呢局有咩角色」 (DESIGN §7.1 re-run #5): the public deck
    rolesInPlay: s.deck.map((d) => ({ id: d.role, count: d.count })),
    board: {
      sizes: TEAM_SIZE[s.n].slice(),
      need: TEAM_SIZE[s.n].map((_, i) => failsNeeded(s.n, i + 1)),
      results: s.results.slice(),
      questNo: s.questNo,
      wins: wins(s),
      losses: losses(s),
    },
    track: { rejects: s.rejects, max: MAX_REJECTS },
    leader: leaderOf(s),
    // 繼續 on the public result screens is anybody's (one phone, or the leader is 💤) — else only the leader's
    tableContinue: tableContinues(s),
    absent: (s.absent ?? []).slice(),   // 💤 marked absent by the host (public)
    proposalNo: s.proposalNo,
    lady: ladyPublic(s),
    history: s.voteLog.map(publicVoteEntry),
    quests: s.quests.map(publicQuest),
    opts: {
      reveal: s.cfg.revealSecs > 0 ? 'timer' : 'tap',
      quest: s.cfg.questSecs > 0 ? 'timer' : 'tap',
      flipEvil: s.cfg.flipEvil,
    },
  };
  if (s.deadline != null) { v.deadline = s.deadline; v.timerLabel = s.timerLabel; }
  if (redoing(s)) v.redo = true;   // the host's 呢鋪唔計 restarted this step: every screen says so

  if (seat) {
    const knows = { kind: s.knows[seat].kind, pids: s.knows[seat].pids.slice() };
    // #28: Merlin is told who he CANNOT see from the public deck and setup only (never a seat): Mordred in play, Oberon
    // hidden by the setting, or nobody — so a deck without Mordred never sends him looking for a third evil. Every role
    // gets the same two flags (both false for the others), so the card still travels in one shape to every phone, and
    // no role name ever appears in a view outside the deck and the seat's own card.
    knows.blind = knows.kind === 'seesEvil' ? merlinBlind(s) : { mordred: false, oberon: false };
    v.mine = { role: s.role[seat], knows, seen: s.seen.includes(seat) };
  }

  switch (s.phase) {
    case 'pick':
      v.pick = { leader: leaderOf(s), size: sizeOf(s), need: needOf(s), canPick: seat !== null && seat === leaderOf(s) };
      break;
    case 'vote': {
      const voters = votersOf(s);
      v.vote = {
        leader: leaderOf(s), team: s.team.slice(),
        progress: { done: voters.filter((p) => s.votes[p] !== undefined).length, total: voters.length },
        mine: seat !== null ? (s.votes[seat] ?? null) : null,
      };
      break;
    }
    case 'voted': {
      const e = s.voteLog[s.voteLog.length - 1];
      v.voted = {
        leader: e.leader, team: e.team.slice(), votes: { ...e.votes },
        approves: e.approves, rejects: e.rejects, approved: e.approved, needed: s.reveal.needed,
        before: s.reveal.before, after: s.reveal.after, ends: s.reveal.ends,
        nextLeader: nextLeaderOf(s), absent: (e.absent ?? []).slice(),
      };
      break;
    }
    case 'quest': {
      const member = seat !== null && s.team.includes(seat);
      v.quest = {
        no: s.questNo, team: s.team.slice(), size: s.team.length, need: needOf(s), mode: s.cfg.questSecs > 0 ? 'timer' : 'tap',
        mine: member ? { member: true, done: seat in s.cards, flip: !!s.flip[seat], canFail: isEvil(s.role[seat]) } : null,
      };
      // A running count is only a tell inside the timed window (it shows who is slow); after it, and in tap mode, people wait for each other anyway.
      if (s.cfg.questSecs === 0 || s.windowOver) v.quest.progress = { done: Object.keys(s.cards).length, total: s.team.length };
      break;
    }
    case 'quest-result': {
      const o = s.outcome;
      v.outcome = {
        no: o.no, team: o.team.slice(), leader: o.leader, successes: o.successes, fails: o.fails, need: o.need,
        success: o.success, pile: o.pile.slice(), next: nextAfterQuest(s),
      };
      break;
    }
    case 'lady': {
      const st = s.lady.step;
      v.ladyStep = {
        stage: 'pick', holder: st.holder, target: null,
        candidates: seat === st.holder ? s.order.filter((p) => p !== st.holder && !s.lady.held.includes(p)) : [],
        held: s.lady.held.slice(),
        mine: null,
      };
      break;
    }
    case 'lady-peek': {
      const st = s.lady.step;
      v.ladyStep = {
        stage: 'peek', holder: st.holder, target: st.target, candidates: [], held: s.lady.held.slice(),
        mine: seat === st.holder ? { loyalty: st.loyalty } : null,
      };
      break;
    }
    case 'assassinate': {
      const assassin = shooterOf(s);
      v.assassinate = {
        canShoot: seat !== null && seat === assassin,
        tapped: seat !== null && s.decoyed.includes(seat),
        candidates: s.order.filter((p) => p !== seat),
        flipped: s.cfg.flipEvil ? evilSeats(s).map((p) => ({ pid: p, role: s.role[p] })) : null,
        talk: !!s.talk,   // one phone: evil is still talking, face up (public, the same in every view)
      };
      break;
    }
    case 'shot':
      v.shot = {
        assassin: s.shot.assassin, target: s.shot.target, hit: s.shot.hit, merlin: s.shot.merlin,
        canContinue: seat !== null && seat === s.shot.assassin,
      };
      break;
    case 'over':
      v.end = endView(s);
      break;
    default: break;
  }
  return v;
}

// ---------- cue / focus / auto-act / legal actions ----------

function cue(state) {
  const c = rawCue(state);
  return c && c.id !== state.cueAck ? c : null;
}

/**
 * Who must look at or touch their phone now (DESIGN §4). The one-phone hints only change what a SHARED phone does
 * (DESIGN §7.1; a phone of its own ignores them):
 *   open   — the public one-person steps (#4): the leader's pick, the vote reveal with names, the quest result, the Lady's
 *            choice, the shot. A shared phone shows a light card 「輪到 X · 投票結果 · 大家一齊睇」, never 「其他人唔好望」.
 *   step   — a new key for the same seat gates again (#2): pick → the leader's own ballot, voted → their own quest card,
 *            lady → lady-peek, and a re-run after 呢鋪唔計.
 *   label  — the step's public name on the hand-over card (#33).
 */
function focus(state) {
  const s = state;
  const L = S.FOCUS;
  const redo = `~${(s.voids ?? []).length}`;
  switch (s.phase) {
    case 'reveal': {
      const pids = votersOf(s).filter((p) => !s.seen.includes(p));
      return pids.length ? { pids, label: L.reveal } : null;
    }
    case 'pick': return { pids: [leaderOf(s)], open: true, step: `pick:${s.proposalNo}${redo}`, label: L.pick };
    // a leader marked 💤 is never called (a shared phone's gate must not ask for them): anybody may tap 繼續. One phone
    // (re-run F2): nobody is called either — the result goes to the middle, and the table taps 繼續 once
    case 'voted':
      return tableContinues(s) ? null : { pids: [leaderOf(s)], open: true, step: `voted:${s.proposalNo}`, label: L.voted };
    case 'quest-result':
      return tableContinues(s) ? null : { pids: [leaderOf(s)], open: true, step: `result:${s.questNo}`, label: L.result(s.questNo) };
    case 'vote': {
      const pids = votersOf(s).filter((p) => s.votes[p] === undefined);
      return pids.length ? { pids, step: `vote:${s.proposalNo}${redo}`, label: L.vote(s.questNo) } : null;
    }
    case 'quest': {
      const pids = s.team.filter((p) => !(p in s.cards));
      return pids.length ? { pids, step: `quest:${s.questNo}${redo}`, label: L.quest(s.questNo) } : null;
    }
    case 'lady': return { pids: [s.lady.step.holder], open: true, step: `lady:${s.lady.log.length}`, label: L.lady };
    case 'lady-peek': return { pids: [s.lady.step.holder], step: `peek:${s.lady.log.length}`, label: L.lady };
    // #27, one phone: evil talks first, face up in the middle — nobody is called until the table taps 傾好喇
    case 'assassinate':
      if (s.talk) return null;
      // The gate on a shared phone must not name the Assassin: it says what the Assassin is called instead.
      return { pids: [shooterOf(s)], anonymous: S.T.assassinate.anonymous };
    case 'shot': return { pids: [s.shot.assassin], open: true, step: 'shot', label: L.shot };
    default: return null;
  }
}

/**
 * Is the game really waiting on this seat? Stall detection (Session.blocking) asks this instead of
 * legalActions, because the anti-tell taps — `seen` in the timed reveal, `decoy` in the assassination —
 * give every seat something legal to do. A disconnected seat whose only legal action is such a tap must
 * never be reported as holding up the table.
 */
function blocking(state, pid) {
  const s = state;
  if (s.phase === 'over' || !isStr(pid) || !s.order.includes(pid) || isAway(s, pid)) return false;
  switch (s.phase) {
    case 'reveal': return s.cfg.revealSecs === 0 && !s.seen.includes(pid);   // timed: the clock ends it, `seen` is a decoy
    case 'pick': return pid === leaderOf(s);
    // one phone: the table's pace (anybody taps 繼續), nobody in particular
    case 'voted': case 'quest-result': return !s.cfg.passPhone && pid === leaderOf(s);
    case 'vote': return s.votes[pid] === undefined;
    case 'quest': return s.team.includes(pid) && !(pid in s.cards);
    case 'lady': case 'lady-peek': return pid === s.lady.step.holder;
    // everybody else only has a decoy; while evil talks (one phone) the table decides, nobody in particular
    case 'assassinate': return !s.talk && pid === shooterOf(s);
    default: return false;                                                   // shot: its clock ends it
  }
}

function legalActions(state, pid) {
  const s = state;
  if (s.phase === 'over' || !isStr(pid) || !s.order.includes(pid) || isAway(s, pid)) return [];
  const leader = leaderOf(s);
  const out = [];
  switch (s.phase) {
    case 'reveal':
      if (!s.seen.includes(pid)) out.push({ type: 'seen' });
      break;
    case 'pick':
      if (pid === leader) for (const team of combos(s.order, sizeOf(s))) out.push({ type: 'pick', team });
      break;
    case 'vote':
      for (const vote of ['approve', 'reject']) if (s.votes[pid] !== vote) out.push({ type: 'vote', vote });
      break;
    case 'voted': case 'quest-result':
      if (mayContinue(s, pid)) out.push({ type: 'continue' });
      break;
    case 'quest':
      if (s.team.includes(pid) && !(pid in s.cards)) {
        out.push({ type: 'quest', card: 'success' });
        if (isEvil(s.role[pid])) out.push({ type: 'quest', card: 'fail' });
      }
      break;
    case 'lady':
      if (pid === s.lady.step.holder) {
        for (const t of s.order) if (t !== pid && !s.lady.held.includes(t)) out.push({ type: 'lady', target: t });
      }
      break;
    case 'lady-peek':
      if (pid === s.lady.step.holder) out.push({ type: 'lady-done' });
      break;
    case 'assassinate':
      if (s.talk) out.push({ type: 'talked' });
      else if (pid === shooterOf(s)) {
        for (const t of s.order) if (t !== pid) out.push({ type: 'assassinate', target: t });
      } else if (!s.decoyed.includes(pid)) {
        out.push({ type: 'decoy' });
      }
      break;
    case 'shot':
      if (pid === s.shot.assassin) out.push({ type: 'continue' });
      break;
    default: break;
  }
  return out;
}

/** What to do for a stalled seat. A dead voter approves, a dead quest member plays success (never a surprise sabotage). */
function autoAct(state, pid, ctx) {
  const s = state;
  if (s.phase === 'over' || !isStr(pid) || !s.order.includes(pid) || isAway(s, pid)) return null;
  const rnd = (k) => (ctx && ctx.rng ? rint(ctx.rng, k) : 0);
  const leader = leaderOf(s);
  switch (s.phase) {
    case 'reveal': return s.seen.includes(pid) ? null : { type: 'seen' };
    case 'pick': return pid === leader ? { type: 'pick', team: ctx && ctx.rng ? sample(ctx.rng, s.order, sizeOf(s)) : s.order.slice(0, sizeOf(s)) } : null;
    case 'vote': return s.votes[pid] === undefined ? { type: 'vote', vote: 'approve' } : null;
    case 'voted': case 'quest-result': return pid === leader ? { type: 'continue' } : null;
    case 'quest': return s.team.includes(pid) && !(pid in s.cards) ? { type: 'quest', card: 'success' } : null;
    case 'lady': {
      if (pid !== s.lady.step.holder) return null;
      const cand = s.order.filter((t) => t !== pid && !s.lady.held.includes(t));
      return { type: 'lady', target: cand[rnd(cand.length)] };
    }
    case 'lady-peek': return pid === s.lady.step.holder ? { type: 'lady-done' } : null;
    case 'assassinate': {
      if (s.talk) return { type: 'talked' };   // the talk is the table's, and ending it shoots nobody
      // only ever for a seat the host acts for (代佢做: its phone is gone) — the soft clock never shoots by itself
      if (pid !== shooterOf(s)) return s.decoyed.includes(pid) ? null : { type: 'decoy' };
      const cand = s.order.filter((t) => t !== pid);
      return { type: 'assassinate', target: cand[rnd(cand.length)] };
    }
    case 'shot': return pid === s.shot.assassin ? { type: 'continue' } : null;
    default: return null;
  }
}

/**
 * The host phone's own buttons (⋯ menu, dispatched as @host): ⏱️ ＋60 秒 while the assassination clock runs or has run
 * out (decision D8: the Assassin may always take longer; the host can say so on the clock too).
 */
function hostActions(state) {
  const s = state;
  if (s.phase === 'assassinate' && s.deadline != null && (s.extends ?? 0) < MAX_EXTENDS) {
    return [{ label: S.T.assassinate.extend, action: { type: 'extend' } }];
  }
  return [];
}

// ---------- result and the "why" ----------

/**
 * Which proposal of its quest a vote-log entry or a 呢鋪唔計 record was: the stored `k`, or — for a snapshot from before
 * `k` existed — the count of earlier proposals of the same quest + 1 (the game-wide `no` would read like rejections).
 */
function perQuestNo(s, e) {
  if (Number.isInteger(e.k)) return e.k;
  return s.voteLog.filter((x) => x.q === e.q && x.no < e.no).length + 1;
}

function explain(s) {
  const nmx = (p) => nm(s, p);
  const assassin = roleOwner(s, 'assassin');
  const merlin = roleOwner(s, 'merlin');
  const failedNos = s.quests.filter((q) => !q.success).map((q) => q.no);
  const lastNo = s.questNo;
  const rejectLeaders = s.voteLog.filter((e) => e.q === lastNo && !e.approved).map((e) => nmx(e.leader));
  const target = s.shot?.target ?? null;

  const winners = s.order.filter((p) => S.teamOf(s.role[p]) === s.winner);
  const summary = S.endSummary({
    reason: s.reason, assassin: assassin ? nmx(assassin) : '', target: target ? nmx(target) : '', merlin: merlin ? nmx(merlin) : '',
  });

  const lines = [];
  lines.push(S.endWhy({
    reason: s.reason, assassin: assassin ? nmx(assassin) : '', target: target ? nmx(target) : '',
    targetRole: target ? s.role[target] : null, merlin: merlin ? nmx(merlin) : '', failedNos, rejectLeaders,
  }));

  lines.push(S.RECAP.rolesHead);
  for (const p of s.order) {
    const k = s.knows[p];
    lines.push(S.RECAP.roleRow(nmx(p), s.role[p],
      S.knowsLine(k.kind, names(s, k.pids), { oberonSeen: s.cfg.oberonSeenByMerlin })));
  }

  if (s.quests.length) {
    lines.push(S.RECAP.questsHead);
    for (const q of s.quests) {
      lines.push(S.RECAP.quest({
        no: q.no, size: q.team.length, leader: nmx(q.leader), team: names(s, q.team),
        success: q.success, successes: q.successes, fails: q.fails,
      }));
      lines.push(S.RECAP.played(q.team.map((p) => [nmx(p), q.played[p]])));
      if (q.need > 1 && q.fails === 1) lines.push(S.RECAP.twoFail);
      if (q.auto.length) lines.push(S.RECAP.autoPlayed(names(s, q.auto)));
    }
  }

  if (s.voteLog.length) {
    lines.push(S.RECAP.votesHead);
    lines.push(S.RECAP.firstLeader(nmx(s.order[s.startIx]), s.ladyOn ? nmx(s.lady.held[0]) : null));
    for (const e of s.voteLog) {
      lines.push(S.RECAP.proposal({
        q: e.q, no: perQuestNo(s, e), leader: nmx(e.leader), team: names(s, e.team), approved: e.approved,
        approves: e.approves, rejects: e.rejects,
        yes: names(s, s.order.filter((p) => e.votes[p] === 'approve')),
        no_: names(s, s.order.filter((p) => e.votes[p] === 'reject')),
        away: names(s, e.absent ?? []),
      }));
    }
  }

  if (s.absent?.length) lines.push(S.RECAP.absent(names(s, s.absent)));

  if (s.voids?.length) {
    lines.push(S.RECAP.voidsHead);
    for (const x of s.voids) lines.push(S.RECAP.voided({ q: x.q, no: perQuestNo(s, x), phase: x.phase, leader: nmx(x.leader) }));
  }

  if (s.lady.log.length) {
    lines.push(S.RECAP.ladyHead);
    for (const l of s.lady.log) lines.push(S.RECAP.lady({ holder: nmx(l.holder), target: nmx(l.target), loyalty: l.loyalty }));
  }

  if (s.shot) {
    lines.push(S.RECAP.shotHead);
    lines.push(S.RECAP.shot({ assassin: nmx(s.shot.assassin), target: nmx(s.shot.target), targetRole: s.role[s.shot.target], hit: s.shot.hit }));
  }

  const points = Object.fromEntries(s.order.map((p) => [p, winners.includes(p) ? 1 : 0]));
  // carry (BACKLOG #20): the next game of 阿瓦隆 in this room lets somebody else lead first
  return { winners, summary, lines, points, carry: { firstLeader: s.order[s.startIx] } };
}

function result(state) {
  return state.phase === 'over' ? state.final : null;
}

// ---------- setup ----------

/**
 * The first leader: uniform over every seat, except that the seat which led first last game (carry,
 * BACKLOG #20; the research's "rotate the start leader between games") is skipped when it is still here.
 * That seat is public information, so skipping it tells nobody anything. Roles get no anti-streak on
 * purpose: last game's roles are public after the results, so "less likely evil again" would be a tell.
 */
function firstLeader(order, rng, carry) {
  const avoid = isObj(carry) && isStr(carry.firstLeader) ? order.indexOf(carry.firstLeader) : -1;
  if (avoid < 0) return rint(rng, order.length);
  const ix = rint(rng, order.length - 1);
  return ix >= avoid ? ix + 1 : ix;
}

function setup({ players, config: cfg, rng, now, carry }) {
  const order = seatOrder(players);
  const n = order.length;
  if (n < meta.players[0] || n > meta.players[1]) throw new RangeError(`avalon needs 5-10 players, got ${n}`);
  const c = norm(cfg);
  const comp = composition(c, n);
  if (!comp.ok) throw new Error(`avalon: invalid config — ${comp.message}`);

  const deckCards = [];
  for (const id of S.ROLE_ORDER) for (let i = 0; i < comp.counts[id]; i++) deckCards.push(id);
  const dealt = shuffle(rng, deckCards);
  const role = {};
  order.forEach((p, i) => { role[p] = dealt[i]; });

  const startIx = firstLeader(order, rng, carry);
  const on = ladyOn(c, n);
  const s = {
    game: 'avalon',
    gid: Math.floor(rng() * 1e6),
    cfg: c,
    n,
    order,
    names: Object.fromEntries(players.map((p) => [p.id, p.name])),
    role,                                   // PRIVATE
    knows: {},                              // PRIVATE (each seat's own entry only)
    deck: S.ROLE_ORDER.filter((id) => comp.counts[id] > 0).map((id) => ({ role: id, count: comp.counts[id] })),
    ladyOn: on,
    phase: 'reveal',
    deadline: null,
    timerLabel: '',
    cueAck: '',
    questNo: 1,
    proposalNo: 1,
    startIx,
    leaderIx: startIx,
    rejects: 0,
    team: [],
    votes: {},                              // PRIVATE until the reveal
    reveal: null,
    flip: {},                               // PRIVATE per seat
    cards: {},                              // PRIVATE: who played what
    auto: [],
    windowOver: false,
    outcome: null,
    results: [null, null, null, null, null],
    quests: [],                             // played holds PRIVATE card choices until `over`
    voteLog: [],
    seen: [],
    decoyed: [],
    voids: [],                              // the host's 呢鋪唔計: [{ q, no, phase, leader }] (public)
    absent: [],                             // 💤 seats the host marked absent (public, D4)
    leaderSkips: 0,                         // times the leader token moved past a seat that went 💤 in `pick`
    extends: 0,                             // the host's ⏱️ ＋60 秒 on this assassination clock
    talk: false,                            // one phone (passPhone): evil is still talking before the Assassin is called (#27)
    // The Lady starts with the seat to the right of the first leader (the one who will lead last).
    lady: { holder: on ? order[(startIx - 1 + n) % n] : null, held: on ? [order[(startIx - 1 + n) % n]] : [], step: null, log: [] },
    shot: null,
    pendingEnd: null,
    winner: null,
    reason: null,
    final: null,
  };
  for (const p of order) s.knows[p] = knowledgeFor(s, p, rng);
  setTimer(s, { now }, c.revealSecs, S.T.reveal.timerLabel);
  return s;
}

export const engine = { setup, act, advance, view, cue, focus, blocking, autoAct, legalActions, hostActions, result };
