// ============================================================
// 狼人殺 (Werewolf) — PURE module: meta, rules, config, engine.
// No DOM, no Math.random, no Date. Flow, wording and anti-tell reasoning live in
// docs/games/werewolf.md; every Cantonese string is in script.js.
//
// The app is the moderator (上帝/法官): it deals, calls the night, resolves it,
// announces deaths, times speeches, counts votes and judges the win. With
// config.moderator === 'human' the HOST seat holds no role and sees everything
// (the engine builds that `god` block only for the host seat).
//
// Shape of a game
//   deal      everyone looks at their card
//   night N   begin → one step per role on the board (every night, even if its
//             holder is dead / out of potions) → resolve at dawn
//   dawn      deaths announced (ascending seat, no cause)
//   …         per dead player: 遺言 and a fixed-length 最後行動 (hunter shot)
//   speech    every living player once
//   vote      secret ballots, public tally; tie → PK speeches → revote
//   say       announcements (tally, shot, idiot flip, self-explode)
//   over      result()
//
// The day is a QUEUE of steps (state.q). A death inserts its own steps, a hunter's
// shot inserts the victim's steps at the FRONT (a chain), and a win check runs
// BEFORE any death trigger, so a hunter who dies as the last god never shoots.
//
// Pacing and anti-tell (DESIGN §4): every night step in the rules happens every
// night with a fixed length; EVERY seat has a legal action during EVERY step
// (decoys with exactly the same view shape); the final-action window after a
// death is the same length whether the dead player was the hunter or not. Because every
// seat can always tap something at night, the room's stall detector must not read legality:
// engine.blocking() names only the seats a step truly waits on (never at night).
//
// PRIVATE state (only ever leaves through view()): role, nt (night bookkeeping),
// potion, guardLast, notes, rec (recap), cur.sel / cur.votes before the reveal.
// ============================================================

import { ACT, HOST, seatOrder, shuffle, rint, pick as pickOne, tally } from '../../core/engine-kit.js?v=20261003171423';
import * as S from './script.js?v=20261003171423';

// ---------- constants ----------

const MIN_SEATS = 6;
const MAX_SEATS = 13;                 // 12 players + the human moderator
const MAX_PLAYERS = 12;
const UNIQUE = ['seer', 'witch', 'hunter', 'guard', 'idiot'];
const ROLE_IDS = S.ROLE_IDS;
const EXPLODE_WORDS_SECS = 30;
const STALEMATE_ROUNDS = 6;           // consecutive day+night cycles with nobody leaving → draw

/** Seconds per night step, per pace. Fixed: a step never ends early because the actor finished. */
const PACE = {
  slow: { guard: 25, wolves: 50, witch: 30, seer: 25, hunter: 12, final: 18 },
  normal: { guard: 15, wolves: 35, witch: 20, seer: 15, hunter: 8, final: 12 },
  fast: { guard: 10, wolves: 25, witch: 14, seer: 10, hunter: 6, final: 8 },
};

const ENUMS = {
  moderator: ['app', 'human'],
  winRule: ['auto', 'edge', 'city'],
  witchSelfSave: ['auto', 'never', 'first', 'always'],
  guardStack: ['die', 'live'],
  idiotIs: ['god', 'villager'],
  wolfVote: ['plurality', 'unanimous'],
  nightOrder: ['official', 'tw'],
  pace: ['slow', 'normal', 'fast'],
  lastWords: ['night1', 'night1single', 'all'],
  hunterOrder: ['words', 'shot'],
  speakOrder: ['dead', 'random'],
  selfExplode: ['off', 'on', 'pk'],
  openCard: ['auto', 'on', 'off'],
};
const RANGES = { speakSecs: [0, 300], wordsSecs: [0, 300], voteSecs: [0, 120] };

const DEFAULTS = Object.freeze({
  moderator: 'app', board: 'auto', winRule: 'auto', witchSelfSave: 'auto',
  guardStack: 'die', idiotIs: 'god', wolfVote: 'plurality', nightOrder: 'official', pace: 'normal',
  lastWords: 'night1', hunterOrder: 'words', speakOrder: 'dead', selfExplode: 'on', openCard: 'auto',
  spectate: false, speakSecs: 60, wordsSecs: 45, voteSecs: 20,
});

// ---------- meta & rules ----------

export const meta = {
  id: 'werewolf',
  name: '狼人殺',
  emoji: '🐺',
  accent: '#9b87f5',
  players: [MIN_SEATS, MAX_SEATS],   // seats: with a human moderator the 13th seat is the moderator
  minutes: [25, 60],
  narration: 'required',             // the night is called out; still works in 讀稿 and 靜音
  paperMode: false,
  singleDevice: 'partial',           // phone in the middle; wolves hand it round, votes go seat by seat
  banks: [],
  css: true,
  blurb: '手機做上帝：夜晚閉眼、天光投票，揪出狼人。',
};

export const rules = S.RULES;

// ---------- boards ----------
// roles = counts including the villagers (they always sum to p). win/save are the board's own
// recommendation; the host can override both. `open` = official open-card board.

export const PRESETS = [
  { id: '6-sw', p: 6, roles: { werewolf: 2, seer: 1, witch: 1, villager: 2 }, win: 'city', save: 'first' },
  { id: '6-sh', p: 6, roles: { werewolf: 2, seer: 1, hunter: 1, villager: 2 }, win: 'city', save: 'never', open: true },
  { id: '7-swh', p: 7, roles: { werewolf: 2, seer: 1, witch: 1, hunter: 1, villager: 2 }, win: 'city', save: 'first' },
  { id: '7-hard', p: 7, roles: { werewolf: 2, seer: 1, witch: 1, hunter: 1, guard: 1, villager: 1 }, win: 'edge', save: 'never' },
  { id: '8-swh', p: 8, roles: { werewolf: 3, seer: 1, witch: 1, hunter: 1, villager: 2 }, win: 'city', save: 'first' },
  { id: '8-easy', p: 8, roles: { werewolf: 2, seer: 1, witch: 1, hunter: 1, villager: 3 }, win: 'city', save: 'first' },
  { id: '9-swh', p: 9, roles: { werewolf: 3, seer: 1, witch: 1, hunter: 1, villager: 3 }, win: 'edge', save: 'never' },
  { id: '9-guard', p: 9, roles: { werewolf: 3, seer: 1, hunter: 1, guard: 1, villager: 3 }, win: 'edge', save: 'never' },
  { id: '10-swh', p: 10, roles: { werewolf: 3, seer: 1, witch: 1, hunter: 1, villager: 4 }, win: 'edge', save: 'never' },
  { id: '10-idiot', p: 10, roles: { werewolf: 3, seer: 1, witch: 1, hunter: 1, idiot: 1, villager: 3 }, win: 'edge', save: 'first' },
  { id: '11-swhi', p: 11, roles: { werewolf: 4, seer: 1, witch: 1, hunter: 1, idiot: 1, villager: 3 }, win: 'edge', save: 'never' },
  { id: '11-easy', p: 11, roles: { werewolf: 3, seer: 1, witch: 1, hunter: 1, idiot: 1, villager: 4 }, win: 'edge', save: 'never' },
  { id: '11-guard', p: 11, roles: { werewolf: 4, seer: 1, witch: 1, hunter: 1, guard: 1, villager: 3 }, win: 'edge', save: 'never' },
  { id: '12-std', p: 12, roles: { werewolf: 4, seer: 1, witch: 1, hunter: 1, idiot: 1, villager: 4 }, win: 'edge', save: 'never' },
  { id: '12-guard', p: 12, roles: { werewolf: 4, seer: 1, witch: 1, hunter: 1, guard: 1, villager: 4 }, win: 'edge', save: 'never' },
  { id: '12-noh', p: 12, roles: { werewolf: 4, seer: 1, witch: 1, guard: 1, idiot: 1, villager: 4 }, win: 'edge', save: 'never' },
];

export const presetsFor = (p) => PRESETS.filter((x) => x.p === p);

// ---------- config: normalise / resolve / validate ----------

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isStr = (x) => typeof x === 'string';

function asInt(v) {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof x === 'number' && Number.isInteger(x) ? x : NaN;
}

function keyOk(key, v) {
  if (key in ENUMS) return ENUMS[key].includes(String(v));
  if (key in RANGES) { const x = asInt(v); return x >= RANGES[key][0] && x <= RANGES[key][1]; }
  if (key === 'spectate') return typeof v === 'boolean';
  if (key === 'board') return isStr(v) && (v === 'auto' || v === 'custom' || PRESETS.some((p) => p.id === v));
  if (key === 'roles') {   // unknown keys (the form's auto-fill 'villager') are ignored
    return isObj(v) && ['werewolf', ...UNIQUE].every((k) => !(k in v) || (Number.isInteger(asInt(v[k])) && asInt(v[k]) >= 0));
  }
  return false;
}

function cleanRoles(v) {
  const out = {};
  const src = isObj(v) ? v : {};
  const w = asInt(src.werewolf);
  out.werewolf = Number.isInteger(w) ? Math.max(0, Math.min(MAX_PLAYERS, w)) : 0;
  for (const id of UNIQUE) {
    const c = asInt(src[id]);
    out[id] = Number.isInteger(c) && c > 0 ? 1 : 0;
  }
  return out;
}

/** Fill gaps and coerce (the shell's <select> hands strings back). Never throws. */
function norm(cfg) {
  const c = isObj(cfg) ? cfg : {};
  const out = { ...DEFAULTS, roles: null };
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in c) || !keyOk(key, c[key])) continue;
    if (key in RANGES) out[key] = asInt(c[key]);
    else if (key in ENUMS) out[key] = String(c[key]);
    else out[key] = c[key];
  }
  out.roles = 'roles' in c && keyOk('roles', c.roles) ? cleanRoles(c.roles) : null;
  return out;
}

export const playersOf = (c, n) => (c.moderator === 'human' ? n - 1 : n);

function customCounts(roles, p) {
  const r = roles ?? { werewolf: Math.max(1, Math.round(p / 3)), seer: 0, witch: 0, hunter: 0, guard: 0, idiot: 0 };
  const out = { werewolf: r.werewolf, villager: 0 };
  let fixed = r.werewolf;
  for (const id of UNIQUE) { out[id] = r[id] ?? 0; fixed += out[id]; }
  out.villager = p - fixed;
  return out;
}

function groupOf(role, idiotIs) {
  if (role === 'werewolf') return 'wolf';
  if (role === 'villager') return 'villager';
  if (role === 'idiot') return idiotIs === 'villager' ? 'villager' : 'god';
  return 'god';
}

function groupCounts(counts, idiotIs) {
  const g = { wolf: 0, god: 0, villager: 0 };
  for (const id of ROLE_IDS) g[groupOf(id, idiotIs)] += counts[id] ?? 0;
  return g;
}

/** The effective rule set for `n` seats (everything the engine and the views need). */
export function resolve(raw, n) {
  const c = norm(raw);
  const p = playersOf(c, n);
  let preset = null;
  let fallback = false;
  if (c.board !== 'custom') {
    if (c.board !== 'auto') {
      preset = PRESETS.find((x) => x.id === c.board && x.p === p) ?? null;
      if (!preset) fallback = true;
    }
    preset ??= PRESETS.find((x) => x.p === p) ?? null;
  }
  const counts = preset ? { ...preset.roles } : customCounts(c.roles, p);
  for (const id of ROLE_IDS) counts[id] ??= 0;
  const g = groupCounts(counts, c.idiotIs);
  const dflt = g.god === 0 || g.villager === 0 ? 'city' : p <= 8 ? 'city' : 'edge';
  const win = c.winRule !== 'auto' ? c.winRule : preset ? preset.win : dflt;
  // custom boards follow the research's per-size default: casual 6–8 = first night, 9+ = never (every official text)
  const save = c.witchSelfSave !== 'auto' ? c.witchSelfSave : preset ? preset.save : (p <= 8 ? 'first' : 'never');
  const open = c.openCard === 'auto' ? !!preset?.open : c.openCard === 'on';
  return {
    ...c, mod: c.moderator === 'human', n, p, roles: counts, preset: preset?.id ?? null, win, save, open, fallback,
  };
}

const presetText = (id) => S.PRESET_TEXT[id] ?? { name: S.CFG.board.custom, reason: '', tag: '' };

function validate(cfg, n) {
  const warnings = [];
  const bad = (message) => ({ ok: false, message, warnings });
  if (!Number.isInteger(n) || n < MIN_SEATS || n > MAX_SEATS) return bad(S.MSG.badCount(MIN_SEATS, MAX_SEATS));
  const c0 = isObj(cfg) ? cfg : {};
  for (const key of [...Object.keys(DEFAULTS), 'roles']) {
    if (key in c0 && c0[key] !== undefined && c0[key] !== null && !keyOk(key, c0[key])) return bad(S.MSG.badValue(S.cfgLabel(key)));
  }
  const e = resolve(c0, n);
  if (!e.mod && n > MAX_PLAYERS) return bad(S.MSG.appMax);
  if (e.mod && e.p < MIN_SEATS) return bad(S.MSG.humanMin(MIN_SEATS));

  const g = groupCounts(e.roles, e.idiotIs);
  if (e.board === 'custom') {
    if (e.roles.werewolf < 1) return bad(S.MSG.noWolf);
    const fixed = ROLE_IDS.filter((id) => id !== 'villager').reduce((a, id) => a + e.roles[id], 0);
    if (fixed > e.p) return bad(S.MSG.tooMany(fixed, e.p));
    if (e.p - e.roles.werewolf < 2) return bad(S.MSG.noGood);
  }
  if (e.win === 'edge' && (g.god < 1 || g.villager < 1)) return bad(S.MSG.noGod);

  if (e.fallback) warnings.push(S.MSG.boardFallback(presetText(e.preset).name));
  if (e.preset === '7-hard') warnings.push(S.MSG.hard);
  if (e.roles.werewolf * 2 >= e.p) warnings.push(S.MSG.wolvesMany);
  if (e.mod) warnings.push(S.MSG.humanHint);
  if (e.speakSecs > 0 && e.speakSecs < 15) warnings.push(S.MSG.shortTimer);
  if (e.p >= 10) warnings.push(S.MSG.sheriff);
  return { ok: true, message: S.MSG.ok(e.p, e.mod), warnings };
}

function boardOptions(c, n) {
  const p = playersOf(c, n);
  const rec = presetsFor(p)[0];
  const opts = [{ value: 'auto', label: `${S.CFG.board.recPrefix}${rec ? presetText(rec.id).name : S.CFG.board.custom}` }];
  for (const x of presetsFor(p)) opts.push({ value: x.id, label: presetText(x.id).name });
  opts.push({ value: 'custom', label: S.CFG.board.custom });
  // A saved board for another head-count stays selectable so the select never shows blank.
  if (c.board !== 'auto' && c.board !== 'custom' && !opts.some((o) => o.value === c.board)) {
    opts.push({ value: c.board, label: `（${presetText(c.board).name}：唔啱而家人數）` });
  }
  return opts;
}

const optList = (key) => Object.entries(S.CFG[key].options).map(([value, label]) => ({ value, label }));

export const config = {
  defaults(n, prev, env) {
    const c = norm(prev);
    const d = {};
    for (const key of Object.keys(DEFAULTS)) d[key] = c[key];
    // One phone passed round the table: every night step takes longer (a hand-over each time), and a vote
    // clock would make the last people in the queue abstain while the phone is still on its way to them.
    if (env && env.singleDevice) { d.pace = 'slow'; d.voteSecs = 0; }
    const nn = Math.max(MIN_SEATS, Math.min(MAX_SEATS, Number.isInteger(n) ? n : MIN_SEATS));
    // 13 seats can only be 12 players + a human moderator; 6 seats cannot spare a moderator.
    if (nn >= MAX_SEATS) d.moderator = 'human';
    else if (nn < MIN_SEATS + 1) d.moderator = 'app';
    const p = playersOf(d, nn);

    if (d.board !== 'auto' && d.board !== 'custom' && !PRESETS.some((x) => x.id === d.board && x.p === p)) d.board = 'auto';
    // The custom role counts always travel with the config, so switching to 自訂 starts from the
    // recommended board (or whatever the host last typed) instead of an empty table.
    const roles = c.roles ?? cleanRoles(presetsFor(p)[0]?.roles);
    if (d.board === 'custom') {
      const fixed = UNIQUE.reduce((a, id) => a + roles[id], roles.werewolf);
      if (fixed > p || roles.werewolf < 1 || p - roles.werewolf < 2) d.board = 'auto';
    }
    d.roles = roles;
    return d;
  },

  /**
   * Head-count presets with a reason (BACKLOG #8): each `cfg` is a patch over the current config and passes
   * `validate` for this n. The first board is the recommended one (what `defaults(n)` gives).
   */
  presets(n) {
    const nn = Math.max(MIN_SEATS, Math.min(MAX_SEATS, Number.isInteger(n) ? n : MIN_SEATS));
    const human = nn >= MAX_SEATS;
    const p = human ? nn - 1 : nn;
    // A board chip is a board for n PLAYERS, so it also says who moderates (a board for 9 picked while the
    // host is the human moderator would otherwise be read as 8 players and fall back).
    const moderator = human ? 'human' : 'app';
    const out = presetsFor(p).map((x, i) => ({
      id: x.id, label: presetText(x.id).name, reason: presetText(x.id).reason,
      cfg: { board: i === 0 ? 'auto' : x.id, moderator },
    }));
    out.push({ id: 'beginner', label: S.PRESET_EXTRA.beginner.label, reason: S.PRESET_EXTRA.beginner.reason, cfg: { pace: 'slow', speakSecs: 0, wordsSecs: 0, voteSecs: 0 } });
    out.push({ id: 'quick', label: S.PRESET_EXTRA.quick.label, reason: S.PRESET_EXTRA.quick.reason, cfg: { pace: 'fast', speakSecs: 30, wordsSecs: 30, voteSecs: 15 } });
    if (!human && nn >= MIN_SEATS + 1) {
      // n seats = n − 1 players: the board follows the recommendation for that head-count
      out.push({ id: 'god', label: S.PRESET_EXTRA.god.label, reason: S.PRESET_EXTRA.god.reason, cfg: { moderator: 'human', board: 'auto' } });
    }
    return out;
  },

  validate,

  fields(cfg, n) {
    const c = norm(cfg);
    const e = resolve(cfg, n);
    const rec = e.preset ? presetText(e.preset) : null;
    const f = [];
    f.push({ key: 'moderator', label: S.CFG.moderator.label, type: 'select', options: optList('moderator'), help: S.CFG.moderator.help });
    f.push({
      key: 'board', label: S.CFG.board.label, type: 'select', options: boardOptions(c, n),
      help: e.board === 'custom' ? S.CFG.roles.help : (rec?.reason ?? ''),
    });
    if (e.board === 'custom') {
      const cap = Math.max(1, e.p - 2);
      f.push({
        key: 'roles', label: S.CFG.roles.label, type: 'roles', help: S.CFG.roles.help,
        options: [
          { id: 'werewolf', name: S.roleName('werewolf'), emoji: S.ROLES.werewolf.emoji, min: 1, max: cap },
          ...UNIQUE.map((id) => ({ id, name: S.roleName(id), emoji: S.ROLES[id].emoji, min: 0, max: 1 })),
          { id: 'villager', name: S.roleName('villager'), emoji: S.ROLES.villager.emoji, auto: true },
        ],
      });
    }
    const resolvedWin = S.CFG.winRule.resolved[e.win];
    f.push({
      key: 'winRule', label: S.CFG.winRule.label, type: 'select', help: S.CFG.winRule.help,
      options: optList('winRule').map((o) => (o.value === 'auto' ? { ...o, label: `${o.label}（${resolvedWin}）` } : o)),
    });
    if (e.roles.witch) {
      f.push({
        key: 'witchSelfSave', label: S.CFG.witchSelfSave.label, type: 'select', help: S.CFG.witchSelfSave.help,
        options: optList('witchSelfSave').map((o) => (o.value === 'auto' ? { ...o, label: `${o.label}（${S.CFG.witchSelfSave.resolved[e.save]}）` } : o)),
      });
    }
    if (e.roles.witch && e.roles.guard) {
      f.push({ key: 'guardStack', label: S.CFG.guardStack.label, type: 'select', options: optList('guardStack'), help: S.CFG.guardStack.help });
    }
    if (e.roles.idiot) f.push({ key: 'idiotIs', label: S.CFG.idiotIs.label, type: 'select', options: optList('idiotIs'), help: S.CFG.idiotIs.help });
    f.push({ key: 'wolfVote', label: S.CFG.wolfVote.label, type: 'select', options: optList('wolfVote'), help: S.CFG.wolfVote.help });
    f.push({ key: 'nightOrder', label: S.CFG.nightOrder.label, type: 'select', options: optList('nightOrder'), help: S.CFG.nightOrder.help });
    f.push({ key: 'pace', label: S.CFG.pace.label, type: 'select', options: optList('pace'), help: S.CFG.pace.help });
    f.push({ key: 'lastWords', label: S.CFG.lastWords.label, type: 'select', options: optList('lastWords'), help: S.CFG.lastWords.help });
    if (e.roles.hunter) f.push({ key: 'hunterOrder', label: S.CFG.hunterOrder.label, type: 'select', options: optList('hunterOrder') });
    f.push({ key: 'speakOrder', label: S.CFG.speakOrder.label, type: 'select', options: optList('speakOrder'), help: S.CFG.speakOrder.help });
    f.push({ key: 'selfExplode', label: S.CFG.selfExplode.label, type: 'select', options: optList('selfExplode'), help: S.CFG.selfExplode.help });
    f.push({ key: 'openCard', label: S.CFG.openCard.label, type: 'select', options: optList('openCard') });
    f.push({ key: 'spectate', label: S.CFG.spectate.label, type: 'bool', help: S.CFG.spectate.help });
    f.push({ key: 'speakSecs', label: S.CFG.speakSecs.label, type: 'seconds', min: 0, max: 300, help: S.CFG.speakSecs.help });
    f.push({ key: 'wordsSecs', label: S.CFG.wordsSecs.label, type: 'seconds', min: 0, max: 300, help: S.CFG.wordsSecs.help });
    f.push({ key: 'voteSecs', label: S.CFG.voteSecs.label, type: 'seconds', min: 0, max: 120, help: S.CFG.voteSecs.help });
    return f;
  },

  summary(cfg, n) {
    const e = resolve(cfg, n);
    return S.summaryLines({ ...e, reasonTag: e.preset ? presetText(e.preset).tag : '' });
  },
};

// ---------- small helpers ----------

const nowOf = (ctx) => (typeof ctx?.now === 'function' ? ctx.now() : (ctx?.now ?? 0));
const seatIx = (s, pid) => s.pl.indexOf(pid);
const seatNo = (s, pid) => seatIx(s, pid) + 1;
const nm = (s, pid) => (s.pl.includes(pid) ? `${seatNo(s, pid)}號${s.names[pid] ?? '?'}` : (s.names[pid] ?? '?'));
/** How the narrator says a player: the NAME only (names are unique in a room). "3號阿明" reads badly in a zh-HK
 *  voice and people at the table know each other by name; screens still show the seat number on every chip. */
const spk = (s, pid) => s.names[pid] ?? '?';
const hasRole = (s, id) => (s.cfg.roles[id] ?? 0) > 0;
const holder = (s, id) => s.pl.find((p) => s.role[p] === id) ?? null;
const wolvesOf = (s) => s.pl.filter((p) => s.role[p] === 'werewolf');
const aliveOf = (s) => s.pl.filter((p) => s.alive[p]);
const bySeat = (s) => (a, b) => seatIx(s, a) - seatIx(s, b);
const paceOf = (s) => PACE[s.cfg.pace] ?? PACE.normal;
const selfSaveAllowed = (s) => s.cfg.save === 'always' || (s.cfg.save === 'first' && s.nt.n === 1);
const revealRole = (s, pid) => (s.cfg.open ? S.roleName(s.role[pid]) : null);

// ---------- setup ----------

function setup({ players, config: cfg, rng, hostPid }) {
  const order = seatOrder(players);
  const n = order.length;
  const v = validate(cfg, n);
  if (!v.ok) throw new Error(`werewolf: invalid config — ${v.message}`);
  const eff = resolve(cfg, n);

  const host = hostPid && order.includes(hostPid) ? hostPid : (players.find((p) => p.isHost)?.id ?? order[0]);
  const pl = eff.mod ? order.filter((id) => id !== host) : order.slice();
  const deck = [];
  for (const id of ROLE_IDS) for (let i = 0; i < (eff.roles[id] ?? 0); i++) deck.push(id);
  const dealt = shuffle(rng, deck);

  const g = groupCounts(eff.roles, eff.idiotIs);
  const cfgOut = { ...eff };
  delete cfgOut.fallback;

  const s = {
    game: 'werewolf',
    gid: rint(rng, 1e6),
    cfg: cfgOut,
    names: Object.fromEntries(players.map((p) => [p.id, p.name])),
    order, pl, mod: eff.mod, hostPid: host,
    tot: g,                                  // initial camp sizes (for the win check)
    role: Object.fromEntries(pl.map((id, i) => [id, dealt[i]])),   // PRIVATE
    alive: Object.fromEntries(pl.map((id) => [id, true])),
    flipped: {},
    died: {},
    deathCount: 0,
    phase: 'deal', cur: null, q: [], seq: 0, cueAck: '',
    deadline: null, span: 0, timerLabel: '',
    n: 0, d: 0,
    speechOrder: [],                         // today's speaking order (public)
    ready: {},
    matesKnown: false,
    potion: { save: true, poison: true },    // PRIVATE (the witch's)
    guardLast: null,                         // PRIVATE
    notes: {},                               // PRIVATE per seat: what that seat learned
    rec: [],                                 // PRIVATE until the game is over
    nt: null,
    dirCw: rng() < 0.5, anchor: null,
    quiet: 0, roundDeaths: 0,
    win: null, winWhy: null, outcome: null,
  };
  return s;
}

// ---------- win check ----------

function checkWin(s) {
  let w = 0; let gd = 0; let vl = 0;
  for (const pid of s.pl) {
    if (!s.alive[pid]) continue;
    const grp = groupOf(s.role[pid], s.cfg.idiotIs);
    if (grp === 'wolf') w++; else if (grp === 'god') gd++; else vl++;
  }
  const t = s.tot;
  let wolvesWin;
  let why = null;
  if (s.cfg.win === 'city') {
    wolvesWin = gd === 0 && vl === 0;
    why = 'all';
  } else {
    const godsGone = t.god > 0 && gd === 0;
    const villGone = t.villager > 0 && vl === 0;
    wolvesWin = godsGone || villGone;
    why = godsGone ? 'gods' : 'villagers';
  }
  if (wolvesWin) { s.winWhy = why; return 'wolves'; }   // wolves first when both sides qualify
  if (w === 0) { s.winWhy = 'wolves-dead'; return 'good'; }
  return null;
}

// ---------- the step machine ----------

const RUNNABLE = new Set(['night', 'words', 'final', 'speech', 'vote']);
const PHASE_OF = { night: 'night', dawn: 'dawn', words: 'words', final: 'final', say: 'say', speech: 'speech', vote: 'vote' };

function cueText(s) {
  const c = s.cur;
  if (!c) return null;
  switch (c.k) {
    case 'night':
      if (c.stage === 'tail') return S.cueTail(c.step);
      return c.step === 'begin' ? S.cueBegin(s.nt.n) : S.cueOpen(c.step, s.nt.n);
    case 'dawn':
      return S.cueDawn(c.deaths.map((pid) => ({ who: spk(s, pid), role: revealRole(s, pid) })));
    case 'words': return S.cueWords(spk(s, c.pid), c.secs);
    case 'final': return S.cueFinal(spk(s, c.pid), paceOf(s).final);
    case 'speech':
      return S.cueSpeech({
        who: spk(s, c.pid), idx: c.idx, total: c.total, pk: c.pk, secs: c.secs, dirUp: c.dirUp,
        tied: (c.tied ?? []).map((p) => spk(s, p)),
      });
    case 'vote': return S.cueVote({ round: c.round, tied: (c.tied ?? []).map((p) => spk(s, p)) });
    case 'say':
      switch (c.kind) {
        case 'tally': {
          const entries = Object.entries(c.counts)
            .sort((a, b) => b[1] - a[1] || seatIx(s, a[0]) - seatIx(s, b[0]))
            .map(([pid, n]) => ({ who: spk(s, pid), n }));
          return S.cueTally({
            entries, outcome: c.outcome, who: c.pid ? spk(s, c.pid) : '', tied: (c.tied ?? []).map((p) => spk(s, p)),
          });
        }
        case 'flip': return S.cueFlip(spk(s, c.pid));
        case 'shot': return S.cueShot(spk(s, c.by), spk(s, c.pid), revealRole(s, c.pid));
        case 'explode': return S.cueExplode(spk(s, c.pid), s.cfg.open ? S.roleName(s.role[c.pid]) : null);
        default: return null;
      }
    default: return null;
  }
}

function prepare(s, step) {
  if (step.k === 'vote') {
    const alive = aliveOf(s);
    step.votes = {};
    step.cands = step.round === 1 ? alive : (step.tied ?? []).slice();
    step.voters = alive.filter((p) => !s.flipped[p] && !(step.round === 2 && (step.tied ?? []).includes(p)));
  }
  if (step.k === 'final') step.sel = {};
}

function enter(s, step, ctx) {
  s.cur = step;
  step.stage = 'cue';
  s.seq += 1;
  s.phase = PHASE_OF[step.k];
  s.deadline = null;
  s.span = 0;
  s.timerLabel = '';
  prepare(s, step);
  // A new night step starts with clean chips: the last step's picks must not show as "locked" during this
  // step's opening line (the closing line of the old step still shows them — that is the seat's own record).
  if (step.k === 'night') s.nt.sel = {};
  if (step.k === 'night' && step.step === 'wolves') s.matesKnown = true;
  if (!cueText(s)) return cueFinished(s, ctx);
  return s;
}

function setTimer(s, ctx, secs, label) {
  s.span = secs * 1000;
  s.deadline = secs > 0 ? nowOf(ctx) + secs * 1000 : null;
  s.timerLabel = label;
}

function startRun(s, ctx) {
  const c = s.cur;
  c.stage = 'run';
  switch (c.k) {
    case 'night':
      if (c.step === 'begin') return nightStepDone(s, ctx);
      s.nt.sel = {};
      setTimer(s, ctx, paceOf(s)[c.step], '');
      s.deadline ??= nowOf(ctx);
      break;
    case 'words': setTimer(s, ctx, c.secs, '遺言'); break;
    case 'final': setTimer(s, ctx, paceOf(s).final, ''); s.deadline ??= nowOf(ctx); break;
    case 'speech': setTimer(s, ctx, c.secs, c.pk ? 'PK 發言' : '發言'); break;
    case 'vote':
      setTimer(s, ctx, s.cfg.voteSecs, '投票');
      if (!c.voters.length) return finishRun(s, ctx);
      break;
    default: return finishStep(s, ctx);
  }
  return s;
}

/** The blocking narration of the current stage is over (or was skipped). */
function cueFinished(s, ctx) {
  const c = s.cur;
  if (!c) return s;
  if (c.k === 'night' && c.stage === 'tail') return nightStepDone(s, ctx);
  if (RUNNABLE.has(c.k)) return startRun(s, ctx);
  return finishStep(s, ctx);
}

/** An announce-only step is over. */
function finishStep(s, ctx) { return next(s, ctx); }

function finishRun(s, ctx) {
  const c = s.cur;
  switch (c.k) {
    case 'night':
      commit(s, ctx);
      c.stage = 'tail';
      s.deadline = null;
      s.span = 0;
      s.seq += 1;
      if (!cueText(s)) return nightStepDone(s, ctx);
      return s;
    case 'final': return resolveFinal(s, ctx);
    case 'vote': return resolveVote(s, ctx);
    default: return next(s, ctx);   // words, speech
  }
}

function skip(s, ctx) {
  if (s.phase === 'over') return s;
  if (s.phase === 'deal') {
    for (const pid of s.pl) s.ready[pid] = true;
    return startNight(s, ctx);
  }
  const c = s.cur;
  if (!c) return s;
  if (c.stage === 'run') return finishRun(s, ctx);
  return cueFinished(s, ctx);
}

function next(s, ctx) {
  for (let guard = 0; guard < 60; guard++) {
    const item = s.q.shift();
    if (!item) return s.win ? toOver(s) : startNight(s, ctx);   // an empty queue only happens after a win
    // Once the game is decided only the announcements still play (the dawn list, the shot, the vote
    // result); every death trigger, speech and vote behind them is dropped — the win check came first.
    if (s.win && item.k !== 'dawn' && item.k !== 'say') continue;
    if (item.k === 'plan') {
      if (item.what === 'night') return startNight(s, ctx);
      if (item.what === 'discuss') planDiscuss(s, ctx);
      continue;
    }
    return enter(s, item, ctx);
  }
  return s;
}

function toOver(s) {
  s.phase = 'over';
  s.cur = null;
  s.q = [];
  s.deadline = null;
  s.span = 0;
  s.timerLabel = '';
  if (!s.outcome) s.outcome = buildResult(s);
  return s;
}

// ---------- night ----------

function nightSteps(s) {
  const order = s.cfg.nightOrder === 'tw'
    ? ['wolves', 'seer', 'guard', 'witch', 'hunter']
    : ['guard', 'wolves', 'witch', 'seer', 'hunter'];
  return ['begin', ...order.filter((id) => id === 'wolves' || hasRole(s, id))];
}

function startNight(s, ctx) {
  if (s.n > 0) {
    s.quiet = s.roundDeaths === 0 ? s.quiet + 1 : 0;
    if (s.quiet >= STALEMATE_ROUNDS && !s.win) s.win = 'draw';
    if (s.win) return toOver(s);
  }
  s.roundDeaths = 0;
  s.n += 1;
  s.q = [];
  s.nt = {
    n: s.n, steps: nightSteps(s), ix: 0, sel: {},
    guardPrev: s.guardLast, attacked: null, guarded: null, saved: null, poisoned: null, seer: null,
    rec: { k: 'night', n: s.n },
  };
  return enter(s, { k: 'night', step: 'begin' }, ctx);
}

function nightStepDone(s, ctx) {
  s.nt.ix += 1;
  if (s.nt.ix >= s.nt.steps.length) return resolveNight(s, ctx);
  return enter(s, { k: 'night', step: s.nt.steps[s.nt.ix] }, ctx);
}

/**
 * What ONE seat sees and may tap during a night step (or the final-action window).
 * Real actors and decoys go through the same function, so their views have exactly the
 * same shape; only the content differs. `real` never leaves the engine.
 */
function panel(s, pid) {
  const c = s.cur;
  const open = c.stage === 'run';
  const step = c.k === 'night' ? c.step : 'final';
  const alive = (t) => !!s.alive[t];
  const P = {
    step, open, real: false, retarget: false, info: [], hint: '', skip: S.PANEL.skipDefault, ok: S.PANEL.ok,
    tags: {}, by: {}, on: () => false,
  };
  const decoy = (lines) => {
    P.info = lines.slice();
    P.hint = S.PANEL.decoyHint;
    P.skip = S.PANEL.skipDefault;
    P.on = (t) => open && alive(t);
  };
  const isMe = (id) => s.role[pid] === id;
  const sel = c.k === 'night' ? s.nt.sel[pid] : c.sel?.[pid];

  switch (step) {
    case 'begin': P.info = S.PANEL.begin.slice(); break;

    case 'guard':
      if (!isMe('guard')) { decoy(S.PANEL.decoy); break; }
      if (!alive(pid)) { decoy(S.PANEL.dead); break; }
      P.real = true;
      P.info = [s.nt.guardPrev ? S.PANEL.guard.last(nm(s, s.nt.guardPrev)) : (s.nt.n === 1 ? S.PANEL.guard.first : S.PANEL.guard.lastNone)];
      P.hint = S.PANEL.guard.hint;
      P.skip = S.PANEL.guard.skip;
      P.on = (t) => open && alive(t) && t !== s.nt.guardPrev;
      if (s.nt.guardPrev) P.tags[s.nt.guardPrev] = S.PANEL.guard.barred;
      break;

    case 'wolves': {
      if (!isMe('werewolf')) { decoy(S.PANEL.decoy); break; }
      const mates = wolvesOf(s).filter((w) => w !== pid);
      const mateLine = mates.length ? S.PANEL.wolves.mates(mates.map((w) => nm(s, w)).join('、')) : S.PANEL.wolves.matesAlone;
      const gone = mates.filter((w) => !alive(w));
      for (const w of mates) P.tags[w] = '🐺';
      if (!alive(pid)) {
        decoy([...S.PANEL.dead, mateLine]);
        break;
      }
      P.real = true;
      P.retarget = true;
      const rule = s.cfg.wolfVote === 'unanimous' ? S.PANEL.wolves.ruleUnanimous : S.PANEL.wolves.rulePlurality;
      P.info = [mateLine + (gone.length ? S.PANEL.wolves.deadMates(gone.map((w) => nm(s, w)).join('、')) : ''), S.PANEL.wolves.pick];
      P.hint = rule;
      P.skip = S.PANEL.wolves.skip;
      P.on = (t) => open && alive(t);
      for (const w of wolvesOf(s)) {
        const ws = s.nt.sel[w];
        if (alive(w) && ws && ws.pick) (P.by[ws.pick] ||= []).push(w);
      }
      break;
    }

    case 'witch': {
      if (!isMe('witch')) { decoy(S.PANEL.decoy); break; }
      if (!alive(pid)) { decoy(S.PANEL.dead); break; }
      if (!s.potion.save && !s.potion.poison) { decoy([S.PANEL.witch.empty, S.PANEL.decoy[1]]); break; }
      P.real = true;
      const atk = s.nt.attacked;
      const saveOk = s.potion.save && !!atk && (atk !== pid || selfSaveAllowed(s));
      const lines = [];
      if (s.potion.save) {
        lines.push(atk ? S.PANEL.witch.victim(nm(s, atk), atk === pid) : S.PANEL.witch.victimNone);
        if (atk === pid && !selfSaveAllowed(s)) lines.push(S.PANEL.witch.noSelfSave);
        if (atk) P.tags[atk] = '💊';
      } else lines.push(S.PANEL.witch.victimHidden);
      lines.push(S.PANEL.witch.potions(s.potion.save, s.potion.poison));
      P.info = lines;
      P.hint = S.PANEL.witch.hint;
      P.skip = S.PANEL.witch.skip;
      P.on = (t) => open && alive(t) && ((saveOk && t === atk) || (s.potion.poison && t !== pid && !(saveOk && t === atk)));
      break;
    }

    case 'seer': {
      if (!isMe('seer')) { decoy(S.PANEL.decoy); break; }
      if (!alive(pid)) { decoy(S.PANEL.dead); break; }
      P.real = true;
      const seen = new Map((s.notes[pid] ?? []).filter((x) => x.k === 'seer').map((x) => [x.pid, x.camp]));
      for (const [t, camp] of seen) P.tags[t] = S.PANEL.seer.seen(camp);
      const done = s.nt.seer && s.nt.seer.by === pid;
      if (done) {
        P.info = [s.nt.seer.target ? S.PANEL.seer.result(nm(s, s.nt.seer.target), s.nt.seer.camp) : S.PANEL.seer.skipped];
      } else P.info = [S.PANEL.seer.pick];
      P.hint = '';
      P.skip = S.PANEL.seer.skip;
      P.on = (t) => open && !done && alive(t) && t !== pid && !seen.has(t);
      break;
    }

    case 'hunter': {
      if (!isMe('hunter')) { decoy(S.PANEL.decoy); break; }
      if (!alive(pid)) { decoy(S.PANEL.hunter.dead.filter(Boolean)); break; }
      decoy(s.nt.poisoned === pid ? S.PANEL.hunter.poisoned : S.PANEL.hunter.ok);
      P.hint = S.PANEL.decoyHint;
      P.skip = S.PANEL.hunter.skip;
      break;
    }

    case 'final': {
      if (pid !== c.pid) break;
      const hunter = isMe('hunter');
      if (c.canShoot) {
        P.real = true;
        P.info = S.PANEL.final.hunter.slice();
        P.skip = S.PANEL.final.skip;
        P.on = (t) => open && alive(t);
      } else {
        P.info = (hunter ? S.PANEL.final.poisoned : S.PANEL.final.other).slice();
        P.skip = S.PANEL.final.skipDecoy;
        P.on = (t) => open && alive(t);
      }
      P.hint = '';
      break;
    }

    default: break;
  }
  if (sel?.lock && !P.retarget) P.on = () => false;
  return P;
}

/** Shared by the night windows and the final-action window. */
function selectAct(s, pid, a, selMap, P) {
  if (!isObj(a)) return false;
  const hasPick = 'pick' in a;
  const hasLock = typeof a.lock === 'boolean';
  if (!hasPick && !hasLock) return false;
  const cur = selMap[pid];
  if (cur?.lock && !P.retarget) return false;      // a locked seat is done (wolves may change their mind)
  if (!hasPick && !a.lock && !cur) return false;   // "unlock" with nothing chosen is nothing
  if (hasPick) {
    if (a.pick !== null && !(isStr(a.pick) && P.on(a.pick))) return false;
    selMap[pid] = { pick: a.pick, lock: false };
  }
  if (hasLock) {
    const sel = (selMap[pid] ??= { pick: null, lock: false });
    sel.lock = a.lock;
  }
  return true;
}

function nightAct(s, pid, a) {
  const c = s.cur;
  if (!c || c.k !== 'night' || c.stage !== 'run' || c.step === 'begin') return s;
  const P = panel(s, pid);
  if (!selectAct(s, pid, a, s.nt.sel, P)) return s;
  if (c.step === 'seer' && P.real && s.nt.sel[pid]?.lock) revealSeer(s, pid);
  return s;
}

function revealSeer(s, pid) {
  if (s.nt.seer) return;
  const pk = s.nt.sel[pid]?.pick ?? null;
  const camp = pk && s.role[pk] === 'werewolf' ? 'wolf' : 'good';
  s.nt.seer = { by: pid, target: pk, camp };
  s.nt.rec.seer = { by: pid, target: pk, camp: pk ? camp : null };
  if (pk) (s.notes[pid] ||= []).push({ k: 'seer', n: s.nt.n, pid: pk, camp });
}

/** The window is over: settle this step's choices. */
function commit(s, ctx) {
  const step = s.cur.step;
  const sel = s.nt.sel;
  const rec = s.nt.rec;
  switch (step) {
    case 'guard': {
      const g = holder(s, 'guard');
      if (!g || !s.alive[g]) break;
      const pk = sel[g]?.pick ?? null;
      s.nt.guarded = pk;
      s.guardLast = pk;
      rec.guard = { by: g, pick: pk };
      (s.notes[g] ||= []).push({ k: 'guard', n: s.nt.n, pid: pk });
      break;
    }
    case 'wolves': {
      const ws = wolvesOf(s).filter((w) => s.alive[w]);
      const picks = ws.map((w) => ({ by: w, set: !!sel[w], pick: sel[w] ? sel[w].pick : null }));
      const ballots = picks.filter((x) => x.set);
      let target = null;
      let how = 'none';
      if (s.cfg.wolfVote === 'unanimous') {
        if (ballots.length && ballots.length === picks.length && picks.every((x) => x.pick === picks[0].pick)) {
          target = picks[0].pick;
          how = target ? 'agree' : 'empty';
        } else how = ballots.length ? 'split' : 'none';
      } else if (ballots.length) {
        const counts = new Map();
        for (const b of ballots) counts.set(b.pick ?? '@none', (counts.get(b.pick ?? '@none') ?? 0) + 1);
        const max = Math.max(...counts.values());
        const top = [...counts.keys()].filter((k) => counts.get(k) === max)
          .sort((x, y) => (x === '@none' ? 99 : seatIx(s, x)) - (y === '@none' ? 99 : seatIx(s, y)));
        const key = top.length === 1 ? top[0] : pickOne(ctx.rng, top);
        target = key === '@none' ? null : key;
        // 'agree' = every living wolf picked the same; 'partial' = the ones who picked agree, the rest never picked
        how = top.length > 1 ? 'random' : counts.size > 1 ? 'plurality' : ballots.length < picks.length ? 'partial' : 'agree';
        if (!target && (how === 'agree' || how === 'partial')) how = 'empty';
      }
      s.nt.attacked = target;
      rec.wolves = { picks, target, how };
      break;
    }
    case 'witch': {
      const w = holder(s, 'witch');
      if (!w || !s.alive[w] || (!s.potion.save && !s.potion.poison)) break;
      const pk = sel[w]?.pick ?? null;
      const atk = s.nt.attacked;
      let act = null;
      if (pk) {
        const saveOk = s.potion.save && !!atk && (atk !== w || selfSaveAllowed(s));
        if (saveOk && pk === atk) { act = 'save'; s.potion.save = false; s.nt.saved = pk; }
        else if (s.potion.poison && pk !== w && s.alive[pk]) { act = 'poison'; s.potion.poison = false; s.nt.poisoned = pk; }
      }
      rec.witch = { by: w, act, target: act ? pk : null };
      if (act) (s.notes[w] ||= []).push({ k: act, n: s.nt.n, pid: pk });
      break;
    }
    case 'seer': {
      const sr = holder(s, 'seer');
      if (!sr || !s.alive[sr]) break;
      if (!s.nt.seer) {
        const pk = sel[sr]?.pick ?? null;
        const ok = pk && s.alive[pk] && pk !== sr && !(s.notes[sr] ?? []).some((x) => x.k === 'seer' && x.pid === pk);
        if (ok) { sel[sr] = { pick: pk, lock: true }; revealSeer(s, sr); }
        else { sel[sr] = { pick: null, lock: true }; revealSeer(s, sr); }
      }
      break;
    }
    case 'hunter': {
      const h = holder(s, 'hunter');
      if (h && s.alive[h]) rec.hunter = { by: h, poisoned: s.nt.poisoned === h };
      break;
    }
    default: break;
  }
}

function resolveNight(s, ctx) {
  const { attacked, guarded, saved, poisoned } = s.nt;
  const G = !!attacked && attacked === guarded;
  const H = !!attacked && attacked === saved;
  const wolfDies = !!attacked && (s.cfg.guardStack === 'live' ? !(G || H) : G === H);
  const how = new Map();
  if (wolfDies) how.set(attacked, 'wolf');
  if (poisoned) how.set(poisoned, 'poison');

  const flags = [];
  if (G && H) flags.push(s.cfg.guardStack === 'live' ? 'bothLive' : 'both');
  else if (G) flags.push('guard');
  else if (H) flags.push('save');
  if (poisoned && poisoned === guarded) flags.push('poisonThrough');
  if (poisoned && s.role[poisoned] === 'hunter') flags.push('poisonHunter');

  const dead = [...how.keys()].sort(bySeat(s));
  s.nt.rec.result = {
    attacked, guarded, saved, poisoned, flags, deaths: dead.map((pid) => ({ pid, how: how.get(pid) })),
  };
  s.rec.push(s.nt.rec);

  const wordsOk = s.cfg.lastWords === 'all' || s.n === 1 || (s.cfg.lastWords === 'night1single' && dead.length === 1);
  s.d = s.n;
  s.dirCw = !s.dirCw;
  s.anchor = dead.length === 1 ? dead[0] : null;
  s.q = [];
  const steps = applyDeaths(s, dead.map((pid) => ({ pid, how: how.get(pid), time: 'night', wordsOk })));
  s.q = [{ k: 'dawn', deaths: dead }, ...steps, { k: 'plan', what: 'discuss' }];
  return next(s, ctx);
}

// ---------- deaths, last words, the hunter's shot ----------

function applyDeaths(s, list) {
  const sorted = list.slice().sort((a, b) => seatIx(s, a.pid) - seatIx(s, b.pid));
  for (const d of sorted) {
    s.alive[d.pid] = false;
    s.died[d.pid] = { how: d.how, n: s.n, time: d.time, by: d.by ?? null, order: s.deathCount++ };
    s.roundDeaths += 1;
  }
  if (!s.win) { const w = checkWin(s); if (w) s.win = w; }
  const steps = [];
  for (const d of sorted) steps.push(...deathSteps(s, d));
  return steps;
}

/** Order per research default: 遺言 then the shot; config can flip it. */
function deathSteps(s, d) {
  const words = d.wordsOk ? { k: 'words', pid: d.pid, secs: d.wordsSecs ?? s.cfg.wordsSecs } : null;
  // With a hunter on the board EVERY dead player gets the same final-action window (decoy for everyone
  // who cannot shoot) so nobody can tell the hunter from how long the table waits.
  const fin = hasRole(s, 'hunter')
    ? { k: 'final', pid: d.pid, canShoot: s.role[d.pid] === 'hunter' && d.how !== 'poison' }
    : null;
  return (s.cfg.hunterOrder === 'shot' ? [fin, words] : [words, fin]).filter(Boolean);
}

function finalAct(s, pid, a) {
  const c = s.cur;
  if (!c || c.k !== 'final' || c.stage !== 'run' || pid !== c.pid) return s;
  const P = panel(s, pid);
  selectAct(s, pid, a, c.sel, P);
  return s;
}

function resolveFinal(s, ctx) {
  const c = s.cur;
  const sel = c.sel[c.pid];
  if (c.canShoot && sel && sel.pick && s.alive[sel.pick]) {
    const target = sel.pick;
    s.rec.push({ k: 'shot', d: s.d, by: c.pid, pid: target });
    const steps = applyDeaths(s, [{ pid: target, how: 'shot', time: 'day', wordsOk: true, by: c.pid }]);
    s.q.unshift({ k: 'say', kind: 'shot', by: c.pid, pid: target }, ...steps);
  }
  return next(s, ctx);
}

// ---------- the day ----------

function speakingOrder(s, ctx) {
  const alive = aliveOf(s);
  const list = s.dirCw ? alive : alive.slice().reverse();
  let start = null;
  if (s.cfg.speakOrder === 'dead' && s.anchor) {
    const dir = s.dirCw ? 1 : -1;
    const n = s.pl.length;
    for (let i = 1; i <= n; i++) {
      const cand = s.pl[(((seatIx(s, s.anchor) + dir * i) % n) + n) % n];
      if (s.alive[cand]) { start = cand; break; }
    }
  }
  if (start === null) start = list[rint(ctx.rng, list.length)];
  const at = list.indexOf(start);
  return [...list.slice(at), ...list.slice(0, at)];
}

function planDiscuss(s, ctx) {
  const order = speakingOrder(s, ctx);
  s.speechOrder = order.slice();
  const steps = order.map((pid, idx) => ({
    k: 'speech', pid, idx, total: order.length, pk: false, secs: s.cfg.speakSecs, dirUp: s.dirCw,
  }));
  s.q.unshift(...steps, { k: 'vote', round: 1 });
}

function doneAct(s, pid, ctx) {
  const c = s.cur;
  if (!c || (c.k !== 'speech' && c.k !== 'words') || c.stage !== 'run' || pid !== c.pid) return s;
  return finishRun(s, ctx);
}

function voteAct(s, pid, a, ctx) {
  const c = s.cur;
  if (!c || c.k !== 'vote' || c.stage !== 'run' || !c.voters.includes(pid)) return s;
  if (!('target' in a)) return s;
  if (a.target !== null && !(isStr(a.target) && c.cands.includes(a.target))) return s;
  c.votes[pid] = a.target;
  if (c.voters.every((p) => p in c.votes)) return finishRun(s, ctx);
  return s;
}

function resolveVote(s, ctx) {
  const c = s.cur;
  const votes = {};
  for (const p of c.voters) votes[p] = p in c.votes ? c.votes[p] : null;
  const t = tally(votes);
  const top = t.top.slice().sort(bySeat(s));
  const rec = {
    k: 'vote', d: s.d, round: c.round,
    votes: c.voters.map((p) => ({ by: p, to: votes[p] })), counts: { ...t.counts },
    outcome: 'none', pid: null, tied: [],
  };
  const say = { k: 'say', kind: 'tally', round: c.round, counts: { ...t.counts }, votes: rec.votes, outcome: 'none', pid: null, tied: [] };
  const steps = [];
  let flipped = null;

  if (!top.length) {
    say.outcome = 'none';
    steps.push(say, { k: 'plan', what: 'night' });
  } else if (top.length > 1) {
    if (c.round === 1) {
      const alive = aliveOf(s);
      const voters2 = alive.filter((p) => !s.flipped[p] && !top.includes(p));
      if (voters2.length) {
        say.outcome = 'tie';
        say.tied = top.slice();
        steps.push(say);
        top.forEach((pid, idx) => steps.push({
          k: 'speech', pid, idx, total: top.length, pk: true, tied: top.slice(), secs: s.cfg.speakSecs, dirUp: true,
        }));
        steps.push({ k: 'vote', round: 2, tied: top.slice() });
      } else {
        say.outcome = 'nobody';
        steps.push(say, { k: 'plan', what: 'night' });
      }
    } else {
      say.outcome = 'tie2';
      steps.push(say, { k: 'plan', what: 'night' });
    }
  } else {
    const x = top[0];
    say.pid = x;
    if (s.role[x] === 'idiot' && !s.flipped[x]) {
      s.flipped[x] = true;
      say.outcome = 'flip';
      steps.push(say, { k: 'say', kind: 'flip', pid: x }, { k: 'plan', what: 'night' });
      flipped = x;
    } else {
      say.outcome = 'exile';
      steps.push(say, ...applyDeaths(s, [{ pid: x, how: 'exile', time: 'day', wordsOk: true }]), { k: 'plan', what: 'night' });
    }
  }
  rec.outcome = say.outcome;
  rec.pid = say.pid;
  rec.tied = say.tied.slice();
  s.rec.push(rec);
  if (flipped) s.rec.push({ k: 'flip', d: s.d, pid: flipped });   // after the vote that caused it
  s.q.unshift(...steps);
  return next(s, ctx);
}

/** May `pid` self-explode right now? (Only during a day speech — PK speeches with selfExplode 'pk' — and only a living wolf.) */
function canExplode(s, pid) {
  const c = s.cur;
  if (!c || c.k !== 'speech' || s.cfg.selfExplode === 'off' || (c.pk && s.cfg.selfExplode !== 'pk')) return false;
  return !!s.alive[pid] && s.role[pid] === 'werewolf';
}

function explodeAct(s, pid, ctx) {
  if (!canExplode(s, pid)) return s;
  s.rec.push({ k: 'explode', d: s.d, pid });
  const secs = s.cfg.wordsSecs > 0 ? EXPLODE_WORDS_SECS : 0;
  const steps = applyDeaths(s, [{ pid, how: 'explode', time: 'day', wordsOk: true, wordsSecs: secs }]);
  s.q = [{ k: 'say', kind: 'explode', pid }, ...steps, { k: 'plan', what: 'night' }];
  return next(s, ctx);
}

// ---------- host-internal actions and the entry point ----------

function hostAct(s, a, ctx) {
  if (a.type === ACT.CUE_DONE) {
    const c = cue(s);
    if (!c || a.id !== c.id) return s;
    if (s.phase === 'deal') { s.cueAck = c.id; return s; }
    return cueFinished(s, ctx);
  }
  if (a.type === ACT.NEXT) return skip(s, ctx);
  // ACT.VOID_ROUND (呢鋪唔計) is deliberately unsupported: a werewolf game has no round that can be undone
  // (deaths and potions are permanent, and replaying a vote would let the host overturn an exile). A dead
  // phone is handled by the clocks, autoAct and 下一步 instead. ACT.AUTO is resolved by the session.
  return s;
}

function readyAct(s, pid, ctx) {
  if (s.phase !== 'deal' || s.ready[pid]) return s;
  s.ready[pid] = true;
  if (s.pl.every((p) => s.ready[p])) return startNight(s, ctx);
  return s;
}

function act(state, msg, ctx) {
  const s = state;
  const pid = msg?.pid;
  const a = msg?.action;
  if (!isObj(a) || !isStr(a.type) || s.phase === 'over') return s;
  if (pid === HOST) return hostAct(s, a, ctx ?? {});
  if (!isStr(pid) || !s.order.includes(pid)) return s;
  if (s.mod && pid === s.hostPid) return a.type === 'skip' ? skip(s, ctx ?? {}) : s;   // the human moderator
  if (!s.pl.includes(pid)) return s;
  switch (a.type) {
    case 'ready': return readyAct(s, pid, ctx ?? {});
    case 'night': return nightAct(s, pid, a);
    case 'final': return finalAct(s, pid, a);
    case 'done': return doneAct(s, pid, ctx ?? {});
    case 'vote': return voteAct(s, pid, a, ctx ?? {});
    case 'explode': return explodeAct(s, pid, ctx ?? {});
    default: return s;
  }
}

function advance(state, ctx) {
  const s = state;
  if (s.phase === 'over' || s.deadline == null) return s;
  if (typeof ctx?.now === 'number' && ctx.now < s.deadline) return s;
  const c = s.cur;
  if (!c || c.stage !== 'run') return s;
  return finishRun(s, ctx ?? {});
}

// ---------- cue / focus / autoAct / legalActions ----------

function cue(state) {
  const s = state;
  if (s.phase === 'over') return null;
  if (s.phase === 'deal') {
    const text = S.cueDeal({ mod: s.mod });
    const id = `${s.gid}:deal`;
    return id === s.cueAck ? null : { id, text, minMs: S.cueMinMs(text) };
  }
  const c = s.cur;
  if (!c || c.stage === 'run') return null;
  const text = cueText(s);
  if (!text) return null;
  return { id: `${s.gid}:${s.seq}:${c.stage}`, text, minMs: S.cueMinMs(text) };
}

function focus(state) {
  const s = state;
  switch (s.phase) {
    case 'deal': {
      const pids = s.pl.filter((p) => !s.ready[p]);
      return pids.length ? { pids } : null;
    }
    case 'night': {
      const c = s.cur;
      if (c.stage !== 'run' || c.step === 'begin') return null;
      // Everyone who holds this role is "awake" — alive or dead, potions left or not — so a lit
      // screen / a shared-phone hand-over never depends on whether the role can still act.
      const role = { guard: 'guard', wolves: 'werewolf', witch: 'witch', seer: 'seer', hunter: 'hunter' }[c.step];
      let pids = s.pl.filter((p) => s.role[p] === role);
      if (c.step === 'wolves') pids = pids.filter((p) => !s.nt.sel[p]?.lock);   // a shared phone moves on to the next wolf
      return { pids, anonymous: S.anonymousPrompt(c.step) };
    }
    case 'final': return s.cur.stage === 'run' ? { pids: [s.cur.pid] } : null;
    case 'vote': {
      const c = s.cur;
      if (c.stage !== 'run') return null;
      const pids = c.voters.filter((p) => !(p in c.votes));
      return pids.length ? { pids } : null;
    }
    default: return null;
  }
}

function autoAct(state, pid) {
  const s = state;
  if (s.phase === 'over' || !s.order.includes(pid)) return null;
  if (s.mod && pid === s.hostPid) return { type: 'skip' };
  if (!s.pl.includes(pid)) return null;
  const c = s.cur;
  switch (s.phase) {
    case 'deal': return s.ready[pid] ? null : { type: 'ready' };
    case 'night': {
      if (c.stage !== 'run' || c.step === 'begin') return null;
      return s.nt.sel[pid]?.lock ? null : { type: 'night', lock: true };
    }
    case 'final':
      return c.stage === 'run' && c.pid === pid && !c.sel[pid]?.lock ? { type: 'final', lock: true } : null;
    case 'speech': case 'words':
      return c.stage === 'run' && c.pid === pid ? { type: 'done' } : null;
    case 'vote':
      return c.stage === 'run' && c.voters.includes(pid) && !(pid in c.votes) ? { type: 'vote', target: null } : null;
    default: return null;
  }
}

/**
 * Is the game WAITING on this seat (so a dead phone would stall the table)? Used by the room's stall detector
 * (「阿明斷咗線 — 代佢做／再等」). Only steps that cannot end without the seat count:
 *   deal                    an unready seat (nothing starts the night but 睇完喇 or 下一步)
 *   speech / 遺言, no clock  the speaker
 *   vote, no clock          a voter who has not voted
 * Never: a night window or the final-action window (fixed clocks; every seat's decoy tap is optional, and
 * flagging the holders of the called role would point at them), a step with a running deadline, a narration
 * line, an announcement, a self-explode chance, or the human moderator (the game never needs his tap).
 */
function blocking(state, pid) {
  const s = state;
  if (!s || s.phase === 'over' || !isStr(pid) || !s.pl.includes(pid)) return false;
  const c = s.cur;
  switch (s.phase) {
    case 'deal': return !s.ready[pid];
    case 'speech': case 'words':
      return c.stage === 'run' && c.pid === pid && s.deadline == null;
    case 'vote':
      return c.stage === 'run' && s.deadline == null && c.voters.includes(pid) && !(pid in c.votes);
    default: return false;
  }
}

function selectOptions(s, pid, type, selMap) {
  const P = panel(s, pid);
  const sel = selMap[pid];
  if (sel?.lock && !P.retarget) return [];
  const out = [];
  for (const t of s.pl) if (P.on(t) && !(sel && sel.pick === t)) out.push({ type, pick: t });
  if (!sel?.lock) out.push({ type, lock: true });
  if (!(sel && sel.pick === null && sel.lock)) out.push({ type, pick: null, lock: true });
  return out;
}

function legalActions(state, pid) {
  const s = state;
  if (s.phase === 'over' || !s.order.includes(pid)) return [];
  if (s.mod && pid === s.hostPid) return [{ type: 'skip' }];
  if (!s.pl.includes(pid)) return [];
  const c = s.cur;
  switch (s.phase) {
    case 'deal': return s.ready[pid] ? [] : [{ type: 'ready' }];
    case 'night':
      return c.stage === 'run' && c.step !== 'begin' ? selectOptions(s, pid, 'night', s.nt.sel) : [];
    case 'final':
      return c.stage === 'run' && c.pid === pid ? selectOptions(s, pid, 'final', c.sel) : [];
    case 'speech': {
      // Self-explode is a real option for a living wolf. It is safe to list here: legalActions never leaves the
      // host, and the stall detector asks engine.blocking() first, which never looks at explode.
      const out = c.stage === 'run' && c.pid === pid ? [{ type: 'done' }] : [];
      if (canExplode(s, pid)) out.push({ type: 'explode' });
      return out;
    }
    case 'words':
      return c.stage === 'run' && c.pid === pid ? [{ type: 'done' }] : [];
    case 'vote': {
      if (c.stage !== 'run' || !c.voters.includes(pid)) return [];
      const out = c.cands.filter((t) => c.votes[pid] !== t).map((t) => ({ type: 'vote', target: t }));
      if (!(pid in c.votes) || c.votes[pid] !== null) out.push({ type: 'vote', target: null });
      return out;
    }
    default: return [];
  }
}

// ---------- views (whitelist: built field by field, never spread from state) ----------

function titleOf(s) {
  const c = s.cur;
  switch (s.phase) {
    case 'deal': return ['🐺 狼人殺', '睇你嘅身份牌'];
    case 'night': return [S.UI.night.title(s.n), c.stage === 'tail' ? S.stepClosed(c.step) : S.stepTitle(c.step)];
    case 'dawn': return [S.UI.day.title(s.d), '天光'];
    case 'words': return [S.UI.day.title(s.d), `${nm(s, c.pid)} 遺言`];
    case 'final': return [S.UI.day.title(s.d), S.UI.day.shotHead];
    case 'say': return [S.UI.day.title(s.d), c.kind === 'tally' ? S.UI.day.tallyHead : c.kind === 'shot' ? S.UI.day.shotAnnounce : c.kind === 'flip' ? S.UI.day.flipHead : S.UI.day.explodeHead];
    case 'speech': return [S.UI.day.title(s.d), S.UI.day.speechHead(c.idx, c.total, c.pk)];
    case 'vote': return [S.UI.day.title(s.d), c.round === 1 ? S.UI.day.voteHead : S.UI.day.voteHeadPk];
    case 'over': return ['🐺 狼人殺', S.UI.over.head];
    default: return ['🐺 狼人殺', ''];
  }
}

function seesAllRoles(s, seat) {
  if (s.phase === 'over') return true;
  if (!seat) return false;
  if (s.mod && seat === s.hostPid) return true;
  return !!s.cfg.spectate && s.pl.includes(seat) && !s.alive[seat];
}

function rosterOf(s, seat) {
  const all = seesAllRoles(s, seat);
  return s.pl.map((pid) => {
    const r = { pid, no: seatNo(s, pid), alive: !!s.alive[pid], flipped: !!s.flipped[pid] };
    if (!s.alive[pid]) {
      // Only causes that happened in public: a wolf kill and a poisoning stay secret until the end.
      const how = s.died[pid]?.how;
      r.how = s.phase === 'over' || how === 'exile' || how === 'shot' || how === 'explode' ? (how ?? null) : null;
      r.at = s.died[pid] ? { n: s.died[pid].n, time: s.died[pid].time } : null;
    }
    if (all || pid === seat || (s.cfg.open && !s.alive[pid])) r.role = s.role[pid];
    return r;
  });
}

function chipsOf(s, P, sel) {
  return s.pl.map((t) => ({
    pid: t,
    on: P.on(t),
    mark: sel && sel.pick === t ? (sel.lock ? 'lock' : 'pick') : '',
    tag: P.tags[t] ?? '',
    by: P.by[t] ? P.by[t].slice() : [],
  }));
}

function panelView(s, pid, sel) {
  const P = panel(s, pid);
  const v = {
    step: P.step, stage: s.cur.stage, chips: chipsOf(s, P, sel),
    info: P.info.slice(), hint: P.hint, skip: P.skip, ok: P.ok,
    // always present, so a seat that never tapped has exactly the same view shape as one that did
    pick: sel ? sel.pick : null, set: !!sel, lock: !!sel?.lock,
  };
  return v;
}

function myBlock(s, pid) {
  const role = s.role[pid];
  const my = {
    role, alive: !!s.alive[pid], flipped: !!s.flipped[pid],
    ready: !!s.ready[pid], notes: JSON.parse(JSON.stringify(s.notes[pid] ?? [])),
  };
  if (role === 'werewolf' && s.matesKnown) my.mates = wolvesOf(s).filter((w) => w !== pid);
  if (role === 'witch') my.potion = { save: s.potion.save, poison: s.potion.poison };
  my.canVote = !!s.alive[pid] && !s.flipped[pid];
  return my;
}

function godBlock(s) {
  const g = {
    roles: Object.fromEntries(s.pl.map((p) => [p, s.role[p]])),
    potion: { save: s.potion.save, poison: s.potion.poison },
    guardLast: s.guardLast,
    nt: null,
  };
  if (s.phase === 'night' && s.cur.step !== 'begin') {
    const step = s.cur.step;
    const role = { guard: 'guard', wolves: 'werewolf', witch: 'witch', seer: 'seer', hunter: 'hunter' }[step];
    g.nt = {
      step, stage: s.cur.stage,
      picks: s.pl.filter((p) => s.role[p] === role && s.alive[p]).map((p) => {
        const sel = s.nt.sel[p];
        return { pid: p, set: !!sel, pick: sel ? sel.pick : null, lock: !!sel?.lock };
      }),
      attacked: s.nt.attacked, guarded: s.nt.guarded, saved: s.nt.saved, poisoned: s.nt.poisoned,
      seer: s.nt.seer ? { target: s.nt.seer.target, camp: s.nt.seer.camp } : null,
    };
  }
  return g;
}

function view(state, pid) {
  const s = state;
  const seat = isStr(pid) && s.order.includes(pid) ? pid : null;
  const isMod = s.mod && seat === s.hostPid;
  const me = seat && s.pl.includes(seat) ? seat : null;
  const c = s.cur;
  const [title, subtitle] = titleOf(s);
  const stageText = s.phase === 'deal' ? S.cueDeal({ mod: s.mod }) : (s.phase !== 'over' ? cueText(s) : null);

  const v = {
    me: seat, mod: s.mod, isMod,
    phase: s.phase, n: s.n, d: s.d, seq: s.seq,
    title, subtitle,
    night: s.phase === 'night' && !isMod,
    say: stageText ?? '',
    board: ROLE_IDS.filter((id) => (s.cfg.roles[id] ?? 0) > 0).map((id) => ({ id, count: s.cfg.roles[id] })),
    opts: {
      win: s.cfg.win, save: s.cfg.save, open: s.cfg.open, explode: s.cfg.selfExplode, spectate: !!s.cfg.spectate,
      guardStack: s.cfg.guardStack, hasHunter: hasRole(s, 'hunter'), preset: s.cfg.preset, pace: s.cfg.pace,
    },
    seats: rosterOf(s, seat),
    alive: aliveOf(s).length,
    stage: c ? c.stage : null,
  };
  if (s.cfg.preset) v.opts.reasonId = s.cfg.preset;
  if (s.deadline != null) { v.deadline = s.deadline; if (s.timerLabel) v.timerLabel = s.timerLabel; }
  if (s.span) v.span = s.span;

  if (me) {
    v.my = myBlock(s, me);
    v.roleId = s.role[me];   // the seat's own card (the shell's 💡 sheet reads it); never anybody else's
  }
  if (isMod) v.god = godBlock(s);
  if (seesAllRoles(s, seat) && s.phase !== 'over') v.all = Object.fromEntries(s.pl.map((p) => [p, s.role[p]]));

  switch (s.phase) {
    case 'deal':
      v.ready = { done: s.pl.filter((p) => s.ready[p]).length, total: s.pl.length };
      break;
    case 'night':
      v.step = { k: c.step, stage: c.stage, ix: s.nt.ix, total: s.nt.steps.length };
      if (me) v.nt = panelView(s, me, s.nt.sel[me]);
      break;
    case 'dawn':
      v.dawn = { deaths: c.deaths.map((p) => ({ pid: p, role: s.cfg.open ? s.role[p] : undefined })) };
      break;
    case 'words':
      v.words = { pid: c.pid, secs: c.secs };
      break;
    case 'final':
      v.final = { pid: c.pid };
      if (me === c.pid) v.nt = panelView(s, me, c.sel[me]);
      break;
    case 'say': {
      const say = { kind: c.kind };
      if (c.kind === 'tally') {
        say.round = c.round; say.counts = { ...c.counts }; say.outcome = c.outcome;
        say.votes = c.votes.map((x) => ({ by: x.by, to: x.to }));
        say.pid = c.pid; say.tied = c.tied.slice();
      } else if (c.kind === 'shot') {
        say.by = c.by; say.pid = c.pid; if (s.cfg.open) say.role = s.role[c.pid];
      } else if (c.kind === 'flip') {
        say.pid = c.pid;
      } else if (c.kind === 'explode') {
        say.pid = c.pid; if (s.cfg.open) say.role = s.role[c.pid];
      }
      v.sayInfo = say;
      break;
    }
    case 'speech': {
      v.speech = {
        pid: c.pid, idx: c.idx, total: c.total, pk: c.pk, secs: c.secs,
        order: c.pk ? c.tied.slice() : s.speechOrder.slice(),
      };
      if (c.tied) v.speech.tied = c.tied.slice();
      break;
    }
    case 'vote': {
      v.vote = {
        round: c.round, cands: c.cands.slice(), voters: c.voters.slice(),
        progress: { done: Object.keys(c.votes).length, total: c.voters.length },
      };
      if (me && c.voters.includes(me) && me in c.votes) v.vote.myVote = c.votes[me];
      break;
    }
    case 'over':
      v.over = {
        win: s.win, why: s.winWhy,
        roles: Object.fromEntries(s.pl.map((p) => [p, s.role[p]])),
        summary: s.outcome.summary,
      };
      break;
    default: break;
  }
  v.hint = hintFor(s, seat, v);
  return v;
}

/**
 * One line for the 💡 sheet (BACKLOG U1): what to do right now, for a first-timer. Built from the seat's
 * own situation only, so it can never say more than that seat's screen already does.
 */
function hintFor(s, seat, v) {
  const H = S.HINT;
  const c = s.cur;
  const me = seat && s.pl.includes(seat) ? seat : null;
  switch (s.phase) {
    case 'over': return H.over;
    case 'deal':
      if (v.isMod) return H.deal.mod;
      if (!me) return H.deal.table;
      return s.ready[me] ? H.deal.wait : H.deal.look;
    case 'night': {
      if (v.isMod || !me) return v.isMod ? H.night.mod : H.night.table;
      if (c.step === 'begin') return H.night.begin;
      if (c.stage === 'tail') return H.night.tail;
      if (panel(s, me).real) return H.night[c.step];
      if (c.step === 'hunter' && s.role[me] === 'hunter' && s.alive[me]) return H.night.hunter;
      return s.alive[me] ? H.night.sleep : H.night.dead;
    }
    default: break;
  }
  // the day: the moderator and a dead seat have their own line, except for a dead player's own turn
  if (v.isMod) return H.day.mod;
  if (s.phase === 'final' && me === c.pid) {
    if (c.canShoot) return H.day.final.hunter;
    return s.role[me] === 'hunter' ? H.day.final.poisoned : H.day.final.other;
  }
  if (s.phase === 'words' && me === c.pid) return H.day.words.me;
  if (me && !s.alive[me]) return H.day.dead;
  switch (s.phase) {
    case 'dawn': return H.day.dawn;
    case 'words': return H.day.words.other;
    case 'final': return H.day.final.table;
    case 'say':
      if (c.kind === 'tally') return c.outcome === 'tie' ? H.day.pk : H.day.tally;
      return H.day[c.kind] ?? '';
    case 'speech':
      if (me === c.pid) return H.day.speech.me;
      return c.pk ? H.day.pk : H.day.speech.other;
    case 'vote':
      if (!me) return H.day.watchVote;
      if (s.flipped[me]) return H.day.cannotFlip;
      if (!c.voters.includes(me)) return H.day.cannotPk;
      return me in c.votes ? H.day.voted : H.day.vote;
    default: return '';
  }
}

// ---------- result and recap ----------

function buildResult(s) {
  const win = s.win;
  const nameOf = (pid) => nm(s, pid);
  const roleName = (pid) => S.roleName(s.role[pid]);
  const winners = win === 'draw' ? [] : s.pl.filter((p) => (win === 'wolves') === (s.role[p] === 'werewolf'));
  const summary = S.summaryLine(win, s.winWhy);
  // Sections (the results screen folds them): the why + a pointer to the recap stay open on top; then the roles;
  // then one section per night and per day. A heading is a plain string 「── 標題 ──」, so a renderer without
  // sections still shows a readable list.
  const lines = [...S.explainLines(win, s.winWhy, s.cfg.win), S.RECAP.intro];

  lines.push(S.section(S.RECAP.roles));
  for (const pid of s.pl) {
    const dd = s.died[pid];
    const fate = dd
      ? `第 ${dd.n} ${dd.time === 'night' ? '夜' : '日'}${S.HOW[dd.how] ?? '出局'}${dd.how === 'shot' && dd.by ? `（${nameOf(dd.by)}）` : ''}`
      : S.UI.over.alive;
    lines.push(`　${nameOf(pid)}：${S.roleTag(s.role[pid])}${s.flipped[pid] ? '（翻過牌）' : ''}　${fate}`);
  }
  if (s.mod) lines.push(`　🎙️ 上帝：${s.names[s.hostPid]}`);

  let lastDay = 0;
  const dayHeader = (d) => { if (d !== lastDay) { lastDay = d; lines.push(S.recapDay(d)); } };
  for (const r of s.rec) {
    if (r.k === 'night') { lines.push(...S.recapNight(r, nameOf, roleName)); continue; }
    dayHeader(r.d);
    if (r.k === 'vote') lines.push(...S.recapVote(r, nameOf));
    else if (r.k === 'shot') lines.push(S.recapShot(r.by, r.pid, nameOf));
    else if (r.k === 'explode') lines.push(S.recapExplode(r.pid, nameOf));
    else if (r.k === 'flip') lines.push(S.recapFlip(r.pid, nameOf));
  }
  return { winners, summary, lines, win, why: s.winWhy };
}

function result(state) {
  const s = state;
  if (s.phase !== 'over') return null;
  const o = s.outcome ?? buildResult(s);
  // a human moderator is a seated non-player: the Room must not count him as having played (scoreboard "played")
  return { winners: o.winners.slice(), summary: o.summary, lines: o.lines.slice(), ...(s.mod ? { spectators: [s.hostPid] } : {}) };
}

export const engine = { setup, act, advance, view, cue, focus, autoAct, legalActions, blocking, result };
