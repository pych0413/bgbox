// ============================================================
// games/custom/game.js — 通用派牌 + 骰盅
//
// A generic role dealer plus secret dice (the whole v1 app, as an engine):
// custom roles with one auto-fill role, presets, host plays or moderates,
// private role cards with a peek lock, secret dice (1-5 dice, d4-d20) with a
// roll lock only the host can lift, roll-all, reveal-all, next round.
//
// PURE: no DOM, no Math.random, no Date. Imports only engine-kit.
//
// Decisions where DESIGN.md §15 is silent (also listed in docs/games/custom.md):
//  - Host identity. The engine must know which seat is the host (host-only
//    actions, and who is the moderator when the host does not play). setup()
//    takes it from `hostPid`, else from a `players[i].isHost` flag, else it
//    falls back to the first seat in seat order.
//  - Presets. The config form is generic, so every preset keeps its OWN role
//    list under `roles_<presetId>`; picking a preset shows that list (edits
//    survive switching back). `fields()` points the 'roles' Field at the key of
//    the active preset.
//  - Presets are GENERIC (BACKLOG G17): the box has real 芝士大盜 / 狼人殺 /
//    誰是臥底 now, so this tool is for games it does not list. The v1 Cheese
//    Thief presets (偵探 / 守衛 were invented) and the 臥底 preset are gone.
//    Every preset is sized by k = card holders and carries a one-line reason
//    per head-count (BACKLOG #8). A preset list nobody edited follows the
//    head-count; an edited one is kept and repaired.
// ============================================================

import { seatOrder, shuffle, rollDie, note } from '../../core/engine-kit.js?v=20261003171423';

// ---------- limits ----------

const MIN_SEATS = 2;
const MAX_SEATS = 16;
const MAX_DICE = 5;
const SIDES = [4, 6, 8, 10, 12, 20];
const LOG_KEEP = 40;
const LOG_SHOWN = 25;
const DESC_MAX = 60;

// ---------- presets ----------
//
// roles(k)  → the deck for k card holders (fitCounts trims it if it is too big)
// mix(list) → the composition in a few words, from the fitted + resolved list
// why(k)    → the one-line reason shown under the preset picker
// Every desc says what you do AND how you win as '做乜：… 點贏：…' (BACKLOG U1) — the card shows it,
// and the shell's 💡 sheet splits it the same way — ≤ DESC_MAX characters.

const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const GOOD_WIN = '點贏：好人放逐晒狼人。';

const PRESETS = [
  {
    id: 'traitor', label: '🎭 一個內鬼',
    roles: (k) => [
      { name: '內鬼', emoji: '🎭', count: k >= 9 ? 2 : 1, desc: '做乜：你同其他人唔同一伙，扮自己人。點贏：去到最後都冇畀人捉到。' },
      { name: '好人', emoji: '🙂', filler: true, desc: '做乜：同大家傾，搵出邊個係內鬼。點贏：投中內鬼。' },
    ],
    mix: (r) => `${r[0].count} 內鬼 + ${r[1].count} 好人`,
    why: (k) => (k >= 9 ? '人多就兩個內鬼，冇咁易捉晒。' : '最簡單：得一個人唔同一伙，自己作題目都啱用。'),
  },
  {
    id: 'teams', label: '🔴🔵 隨機分兩隊',
    roles: (k) => [
      { name: '紅隊', emoji: '🔴', count: Math.ceil(k / 2), desc: '做乜：同紅隊隊友合作。點贏：紅隊贏咗對面。' },
      { name: '藍隊', emoji: '🔵', filler: true, desc: '做乜：同藍隊隊友合作。點贏：藍隊贏咗對面。' },
    ],
    mix: (r) => `紅 ${r[0].count} + 藍 ${r[1].count}`,
    why: (k) => `隨機分隊，唔使包剪揼；${k % 2 ? '單數人，紅隊多一個。' : '兩隊一樣多。'}`,
  },
  {
    id: 'king', label: '👑 國王遊戲',
    roles: (k) => [
      { name: '國王', emoji: '👑', count: 1, desc: '做乜：公開自己係國王，叫兩個號碼做一件事（例如 3 號同 5 號擊掌）。點贏：冇輸贏，玩得開心就得。' },
      ...Array.from({ length: Math.max(1, k - 1) }, (_, i) => ({
        name: `${i + 1} 號`, emoji: KEYCAPS[i] ?? '🔢', count: 1,
        desc: `做乜：你係 ${i + 1} 號，唔好講出嚟；國王叫到你就要照做。點贏：冇輸贏。`,
      })),
    ],
    mix: (r) => `1 國王 + ${r.filter((x) => x.count > 0).length - 1} 個號碼`,
    why: () => '國王叫號碼出題，大家照做；㩒「下一回合」重新派，換人做國王。',
  },
  {
    id: 'killer', label: '🔪 殺手遊戲',
    roles: (k) => {
      const x = Math.max(1, Math.floor(k / 4));
      return [
        { name: '殺手', emoji: '🔪', count: x, desc: '做乜：夜晚同其他殺手揀人殺，日頭扮平民。點贏：殺晒警察，或者殺晒平民。' },
        { name: '警察', emoji: '👮', count: x, desc: '做乜：夜晚驗一個人係咪殺手，法官打手勢答你。點贏：投走晒所有殺手。' },
        { name: '平民', emoji: '🧑', filler: true, desc: '做乜：冇特別能力，日頭靠推理同投票。點贏：投走晒所有殺手。' },
      ];
    },
    mix: (r) => `${r[0].count} 殺手 + ${r[1].count} 警察 + ${r[2].count} 平民`,
    why: () => '經典 1 : 1 : 2；要有個法官，建議房主唔攞牌做法官。',
    needsModerator: true,
  },
  {
    id: 'werewolf', label: '🐺 狼人殺（真人主持）',
    roles: (k) => [
      { name: '狼人', emoji: '🐺', count: k >= 10 ? 3 : k >= 6 ? 2 : 1, desc: '做乜：夜晚同狼隊友揀人殺，日頭扮好人。點贏：殺晒神職，或者殺晒平民。' },
      { name: '預言家', emoji: '🔮', count: 1, desc: `做乜：每晚驗一個人係好人定狼人。${GOOD_WIN}` },
      { name: '女巫', emoji: '🧪', count: 1, desc: `做乜：一瓶解藥救人、一瓶毒藥殺人，各用一次。${GOOD_WIN}` },
      { name: '獵人', emoji: '🏹', count: 1, desc: `做乜：出局可以開槍帶走一個人（畀毒死就唔得）。${GOOD_WIN}` },
      { name: '平民', emoji: '🧑', filler: true, desc: `做乜：冇能力，日頭靠推理同投票。${GOOD_WIN}` },
    ],
    mix: (r) => r.filter((x) => x.count > 0).map((x) => `${x.count} ${x.name}`).join(' + '),
    why: () => '真人主持叫天黑；想部機做主持就揀主頁「狼人殺」。',
    needsModerator: true,
  },
  {
    id: 'custom', label: '✏️ 自訂',
    roles: () => [
      { name: '角色 A', emoji: '🅰️', count: 1, desc: '' },
      { name: '平民', emoji: '🧑', filler: true, desc: '' },
    ],
    mix: () => '',
    why: () => '自己加減角色；開局前講清楚每個角色做咩、點樣先算贏。',
  },
];

const PRESET_IDS = PRESETS.map((p) => p.id);
const DEFAULT_PRESET = 'traitor';
const presetOf = (id) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];
const rolesKey = (presetId) => `roles_${presetId}`;

// ---------- small coercions (config may arrive from a form, as strings) ----------

function toInt(v, fallback) {
  const x = Math.trunc(Number(v));
  return Number.isFinite(x) ? x : fallback;
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;

/** First `n` user-perceived characters (an emoji like 🧑‍🌾 is one). */
function graphemes(s, n) {
  const str = typeof s === 'string' ? s.trim() : '';
  if (segmenter) return Array.from(segmenter.segment(str), (g) => g.segment).slice(0, n).join('');
  return Array.from(str).slice(0, n).join('');
}

// ---------- roles ----------

/**
 * Normalise a role list (it comes from an editable form): unique string ids,
 * at most ONE filler, sane counts, trimmed text. Never throws.
 */
function cleanRoles(list) {
  const src = Array.isArray(list) ? list.filter((r) => r && typeof r === 'object') : [];
  const used = new Set();
  let haveFiller = false;
  return src.map((r, i) => {
    let id = typeof r.id === 'string' && r.id && !used.has(r.id) ? r.id : null;
    for (let k = i + 1; !id; k++) if (!used.has(`r${k}`)) id = `r${k}`;
    used.add(id);
    const filler = r.filler === true && !haveFiller;
    if (filler) haveFiller = true;
    return {
      id,
      name: graphemes(r.name, 16) || `角色 ${i + 1}`,
      emoji: graphemes(r.emoji, 2) || '❓',
      count: filler ? 0 : clamp(toInt(r.count, 0), 0, MAX_SEATS),
      desc: typeof r.desc === 'string' ? r.desc.trim().slice(0, DESC_MAX) : '',
      filler,
    };
  });
}

const fixedCount = (roles) => roles.reduce((s, r) => s + (r.filler ? 0 : r.count), 0);

/** v1 validateRoles, for `k` card holders. */
function checkRoles(roles, k) {
  const fixed = fixedCount(roles);
  const filler = roles.find((r) => r.filler);
  if (filler) {
    const left = k - fixed;
    if (left < 0) {
      return { ok: false, fixed, filler: 0, message: `指定角色共 ${fixed} 個，多過 ${k} 個玩家 — 減少啲。` };
    }
    return { ok: true, fixed, filler: left, message: `${fixed} 個指定角色 + ${left} 個「${filler.name}」= ${k} 人 ✓` };
  }
  if (fixed !== k) {
    return { ok: false, fixed, filler: 0, message: `角色總數 ${fixed}，但有 ${k} 個玩家 — 要啱數先開得。` };
  }
  return { ok: true, fixed, filler: 0, message: `角色總數 ${fixed} = ${k} 人 ✓` };
}

/** Shrink fixed counts from the bottom of the list until they fit `k` holders. */
function fitCounts(roles, k) {
  let fixed = fixedCount(roles);
  for (let i = roles.length - 1; i >= 0 && fixed > k; i--) {
    if (roles[i].filler) continue;
    const cut = Math.min(roles[i].count, fixed - k);
    roles[i].count -= cut;
    fixed -= cut;
  }
  return roles;
}

/**
 * Make a user's role list fit a new head-count (n changed since it was edited).
 * A list without a filler gets one (its biggest role), except a deck of
 * one-of-a-kind cards (國王 + numbers): there is no sensible role to repeat, so
 * it is only trimmed, and the caller falls back to the stock list if that is not enough.
 */
function repairRoles(roles, k) {
  const r = roles.map((x) => ({ ...x }));
  const oneOfAKind = r.every((x) => x.filler || x.count <= 1);
  if (!r.some((x) => x.filler) && !oneOfAKind) {
    const big = r.reduce((a, b) => (b.count > a.count ? b : a), r[0]);
    big.filler = true;
    big.count = 0;
  }
  return fitCounts(r, k);
}

/** The stock role list of a preset for k card holders. */
function presetRoles(presetId, k) {
  const list = presetOf(presetId).roles(k).map((r, i) => ({
    id: `${presetId}_${i + 1}`, name: r.name, emoji: r.emoji, count: r.filler ? 0 : r.count,
    desc: r.desc, filler: !!r.filler,
  }));
  return fitCounts(list, k);
}

/** Everything a player sees of a list (ids and filler counts do not matter). */
const listShape = (roles) => JSON.stringify(roles.map((r) => [r.name, r.emoji, r.filler ? 0 : r.count, r.desc, r.filler]));

/** Is this list a preset's stock list for SOME head-count (i.e. nobody edited it)? */
function isStock(presetId, roles) {
  const shape = listShape(roles);
  for (let k = 1; k <= MAX_SEATS; k++) if (listShape(presetRoles(presetId, k)) === shape) return true;
  return false;
}

/** The preset's composition and reason for k holders: '8 人：2 殺手 + 2 警察 + 4 平民 — 經典…'. */
function presetReason(presetId, k, hostPlays) {
  const p = presetOf(presetId);
  const mix = p.mix(resolveRoles(presetRoles(presetId, k), k));
  const who = hostPlays ? `${k} 人` : `${k} 人攞牌`;
  return mix ? `${who}：${mix} — ${p.why(k)}` : p.why(k);
}

/** Give the filler its real count so views and the deck agree. */
function resolveRoles(roles, k) {
  const fixed = fixedCount(roles);
  return roles.map((r) => ({ ...r, count: r.filler ? k - fixed : r.count }));
}

// ---------- config ----------

/** Coerce whatever the form sent into a well-formed config. */
function readCfg(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const preset = PRESET_IDS.includes(c.preset) ? c.preset : DEFAULT_PRESET;
  return {
    preset,
    roles: cleanRoles(c[rolesKey(preset)]),
    hostPlays: c.hostPlays !== false,
    modSees: c.modSees === true,
    diceCount: toInt(c.diceCount, 1),
    diceSides: toInt(c.diceSides, 6),
    selfRoll: c.selfRoll !== false,
    antiStreak: c.antiStreak === true,
  };
}

const holders = (c, n) => (c.hostPlays ? n : n - 1);

function freshConfig(n, hostPlays = true) {
  const k = hostPlays ? n : n - 1;
  const cfg = { preset: DEFAULT_PRESET, hostPlays, modSees: false, diceCount: 1, diceSides: 6, selfRoll: true, antiStreak: false };
  for (const p of PRESETS) cfg[rolesKey(p.id)] = presetRoles(p.id, k);
  return cfg;
}

function validate(cfg, n) {
  const bad = (message) => ({ ok: false, message, warnings: [] });
  const c = readCfg(cfg);
  if (!Number.isInteger(n) || n < MIN_SEATS || n > MAX_SEATS) return bad(`人數要 ${MIN_SEATS}–${MAX_SEATS} 個`);
  if (c.diceCount < 1 || c.diceCount > MAX_DICE) return bad(`骰仔要 1–${MAX_DICE} 粒`);
  if (!SIDES.includes(c.diceSides)) return bad(`骰仔面數要係 ${SIDES.map((s) => `d${s}`).join('、')} 其中一個`);
  if (c.roles.length < 2) return bad('最少要兩個角色');
  const k = holders(c, n);
  if (k < 2) {
    return bad(c.hostPlays ? '最少要 2 個玩家' : `房主做主持嘅話，最少要 3 個人（而家得 ${n} 個）`);
  }
  const r = checkRoles(c.roles, k);
  if (!r.ok) return bad(r.message);

  const warnings = [];
  const seen = new Set();
  const dup = new Set();
  for (const role of c.roles) {
    if (seen.has(role.name)) dup.add(role.name);
    seen.add(role.name);
  }
  if (dup.size) warnings.push(`有角色同名：${[...dup].map((d) => `「${d}」`).join('、')}，開牌嗰陣會分唔清。`);
  const filler = c.roles.find((x) => x.filler);
  if (filler && r.fixed === 0) warnings.push(`冇指定任何特殊角色，所有人都係「${filler.name}」。`);
  if (c.hostPlays && presetOf(c.preset).needsModerator) {
    warnings.push('呢個玩法要有人做主持叫天黑：建議熄咗「房主一齊玩」，由房主做主持。');
  }
  return { ok: true, message: c.hostPlays ? r.message : `${r.message}（主持唔攞牌）`, warnings };
}

/** Lobby/form label of a role list: the preset's name, marked when someone edited it. */
function deckLabel(c) {
  const p = presetOf(c.preset);
  if (p.id === 'custom') return p.label;
  return isStock(p.id, c.roles) ? p.label : `${p.label}（改過）`;
}

export const config = {
  defaults(n, prev) {
    const base = freshConfig(n);
    if (!prev || typeof prev !== 'object') return base;

    const cfg = {
      ...base,
      preset: PRESET_IDS.includes(prev.preset) ? prev.preset : DEFAULT_PRESET,   // a removed v1 preset (cheese…) → default
      hostPlays: prev.hostPlays !== false,
      modSees: prev.modSees === true,
      diceCount: clamp(toInt(prev.diceCount, 1), 1, MAX_DICE),
      diceSides: SIDES.includes(toInt(prev.diceSides, 6)) ? toInt(prev.diceSides, 6) : 6,
      selfRoll: prev.selfRoll !== false,
      antiStreak: prev.antiStreak === true,
    };
    if (holders(cfg, n) < 2) cfg.hostPlays = true;   // 2 seats cannot spare a moderator
    const k = holders(cfg, n);
    for (const p of PRESETS) {
      const key = rolesKey(p.id);
      const mine = cleanRoles(prev[key]);
      let list;
      if (mine.length < 2 || isStock(p.id, mine)) list = presetRoles(p.id, k);   // untouched: follow the head-count
      else list = checkRoles(mine, k).ok ? mine : repairRoles(mine, k);          // edited: keep, repair if needed
      cfg[key] = checkRoles(list, k).ok ? list : presetRoles(p.id, k);
    }
    return validate(cfg, n).ok ? cfg : base;
  },

  validate,

  fields(cfg, n) {
    const c = readCfg(cfg);
    const v = validate(cfg, n);
    const k = Math.max(1, holders(c, n));
    const options = PRESETS.map((p) => {
      const mix = p.mix(resolveRoles(presetRoles(p.id, k), k));
      return { value: p.id, label: mix ? `${p.label} — ${mix}` : p.label };
    });
    const out = [
      { key: 'preset', label: '預設牌組', type: 'select', options, help: presetReason(c.preset, k, c.hostPlays) },
      { key: rolesKey(c.preset), label: '角色牌', type: 'roles', min: 0, max: Math.max(MIN_SEATS, holders(c, n)), help: v.message },
      { key: 'hostPlays', label: '房主一齊玩', type: 'bool', help: '熄咗 = 房主做主持，唔攞牌、唔擲骰。' },
    ];
    if (!c.hostPlays) {
      out.push({ key: 'modSees', label: '主持睇到所有人角色', type: 'bool', help: '狼人殺之類要主持知晒邊個係邊個先開。唔開 = 主持同大家一樣唔知。' });
    }
    out.push(
      { key: 'diceCount', label: '骰仔數量', type: 'int', min: 1, max: MAX_DICE },
      { key: 'diceSides', label: '骰仔面數', type: 'select', options: SIDES.map((s) => ({ value: s, label: `d${s}` })) },
      { key: 'selfRoll', label: '玩家可以自己搖骰', type: 'bool', help: '熄咗 = 淨係主持幫大家全體搖。' },
      { key: 'antiStreak', label: '唔好連續攞同一張特別牌', type: 'bool', help: '開咗：每次派牌，上一次攞國王、內鬼呢類少數牌嘅人，唔會再攞同一張（人數夠先得）。' },
    );
    return out;
  },

  summary(cfg, n) {
    const c = readCfg(cfg);
    const r = checkRoles(c.roles, holders(c, n));
    const roleLines = [];
    for (const role of c.roles) {
      const count = role.filler ? (r.ok ? r.filler : null) : role.count;
      if (count === 0) continue;
      roleLines.push(`${role.emoji} ${role.name} ×${count ?? '自動'}`);
    }
    const lines = [deckLabel(c)];
    if (roleLines.length <= 6) lines.push(...roleLines);
    else for (let i = 0; i < roleLines.length; i += 4) lines.push(roleLines.slice(i, i + 4).join(' · '));   // 國王 + 15 numbers
    lines.push(`🎲 ${c.diceCount} × d${c.diceSides}${c.selfRoll ? '' : '（淨係主持搖得）'}`);
    lines.push(c.hostPlays ? '房主一齊玩' : `房主做主持（唔攞牌${c.modSees ? '，睇到所有人角色' : ''}）`);
    if (c.antiStreak) lines.push('唔會連續攞同一張特別牌');
    return lines;
  },
};

// ---------- meta & rules ----------

// Kept equal to the registry entry (js/games/registry.js) — BACKLOG G16, tested.
export const meta = {
  id: 'custom',
  name: '通用派牌＋骰盅',
  emoji: '🎲',
  accent: '#2dd4bf',
  players: [MIN_SEATS, MAX_SEATS],
  minutes: [5, 30],
  narration: 'none',
  paperMode: false,
  singleDevice: 'full',
  blurb: '自己設定角色牌同秘密骰仔，咩遊戲都用得。',
  banks: [],
  css: true,
};

// rules.roles: the roles of the presets plus the moderator. Ids never clash with
// dealt role ids (`<preset>_<n>`), so nothing can match a player's card to the
// wrong text — the card itself carries its own `desc`.
export const rules = {
  quick: [
    '主持揀個預設牌組，或者自己加減角色。',
    '每人一張秘密角色牌：㩒住睇，放手即刻冚返。',
    '每人一個秘密骰盅：搖部手機或者㩒 🎲 擲骰。',
    '點玩、點樣先算贏，由你哋自己講，app 唔計分。',
    '主持可以全體搖骰、開晒啲骰、開晒角色、開下一回合。',
    '一部機都玩得：app 會逐個叫人接機睇牌。',
  ],
  roles: [
    { id: 'moderator', name: '主持', emoji: '🎙️', team: '#94a3b8', text: '做乜：唔攞牌、唔擲骰，負責講規則、搖骰、開骰、開角色同開下一回合。點贏：主持唔使贏，帶得好玩就得。' },
    { id: 'traitor', name: '內鬼', emoji: '🎭', team: 'traitor', text: '做乜：你同其他人唔同一伙，扮自己人。點贏：去到最後都冇畀人捉到。' },
    { id: 'good', name: '好人', emoji: '🙂', team: 'good', text: '做乜：同大家傾，搵出邊個係內鬼。點贏：投中內鬼。' },
    { id: 'red', name: '紅隊', emoji: '🔴', team: '#ef4444', text: '做乜：同紅隊隊友合作。點贏：紅隊贏咗對面（比咩由你哋定）。' },
    { id: 'blue', name: '藍隊', emoji: '🔵', team: '#3b82f6', text: '做乜：同藍隊隊友合作。點贏：藍隊贏咗對面（比咩由你哋定）。' },
    { id: 'king', name: '國王', emoji: '👑', team: '#f5c518', text: '做乜：公開自己係國王，叫兩個號碼做一件事。點贏：冇輸贏，玩得開心就得。' },
    { id: 'number', name: '號碼牌', emoji: '🔢', team: '#f5c518', text: '做乜：記住自己幾號，唔好講出嚟；國王叫到你就照做。點贏：冇輸贏。' },
    { id: 'killer', name: '殺手', emoji: '🔪', team: 'bad', text: '做乜：夜晚同其他殺手靜靜雞揀人殺，日頭扮平民。點贏：殺晒警察，或者殺晒平民。' },
    { id: 'police', name: '警察', emoji: '👮', team: 'good', text: '做乜：夜晚驗一個人係咪殺手，法官打手勢答你。點贏：投走晒所有殺手。' },
    { id: 'civilian', name: '平民', emoji: '🧑', team: 'good', text: '做乜：冇特別能力，日頭靠推理同投票。點贏：好人一方投走晒殺手（狼人殺就係狼人）。' },
    { id: 'wolf', name: '狼人', emoji: '🐺', team: 'wolf', text: '做乜：夜晚同狼隊友揀一個人殺，日頭扮好人。點贏：殺晒神職（預言家、女巫、獵人），或者殺晒平民。' },
    { id: 'seer', name: '預言家', emoji: '🔮', team: 'good', text: '做乜：每晚驗一個人係好人定狼人。點贏：好人一方放逐晒所有狼人。' },
    { id: 'witch', name: '女巫', emoji: '🧪', team: 'good', text: '做乜：一瓶解藥救人、一瓶毒藥殺人，各用一次。點贏：好人一方放逐晒所有狼人。' },
    { id: 'hunter', name: '獵人', emoji: '🏹', team: 'good', text: '做乜：出局嗰陣可以開槍帶走一個人（畀毒死就唔得）。點贏：好人一方放逐晒所有狼人。' },
    { id: 'own', name: '自訂角色', emoji: '✏️', team: '#94a3b8', text: '做乜：由你哋自己定，開局前講清楚；張牌上面會顯示你寫嘅說明。點贏：都係由你哋自己定。' },
  ],
  sections: [
    {
      title: '呢個係咩',
      body: '一個通用嘅派牌工具，唔係一隻特定遊戲。你自己決定有啲咩角色、每個角色幾多張，同埋用唔用骰仔，之後 app 負責派牌、收埋啲牌同骰、幫你開盅。遊戲點玩、邊個贏，由你哋自己講。\n想玩芝士大盜、狼人殺、誰是臥底？主頁有齊專屬版本，會幫你主持同計輸贏。呢度係畀主頁冇嘅遊戲用。',
    },
    {
      title: '預設牌組',
      body: '🎭 一個內鬼：一個（9 人以上兩個）內鬼，其他係好人。自己作題目、估邊個係鬼都啱用。\n🔴🔵 隨機分兩隊：隨機分紅藍兩隊，單數人紅隊多一個。\n👑 國王遊戲：一個國王，其他人每人一個號碼。國王叫號碼出題，每回合重新派。\n🔪 殺手遊戲：殺手、警察、平民大約 1 : 1 : 2，房主唔攞牌做法官。\n🐺 狼人殺（真人主持）：狼人、預言家、女巫、獵人同平民，由真人主持叫天黑。\n✏️ 自訂：自己砌。\n揀咗預設之後都可以再改；冇改過嘅預設會跟住人數自動調。',
    },
    {
      title: '角色牌',
      body: '每人派一張。㩒住張牌先睇到，放手即刻冚返，所以放喺枱面都唔使怕。\n如果有朋友喺你隔離，或者你要將部機借畀人，㩒「鎖定角色牌」，鎖咗之後連你自己都睇唔到，要自己㩒返解鎖。\n其中一個角色可以設做「自動填充」：指定咗嘅角色派完，剩低幾多人就當幾多個呢個角色。',
    },
    {
      title: '骰盅',
      body: '1 至 5 粒骰，可以揀 d4、d6、d8、d10、d12 或 d20。㩒「搖我嘅骰」或者搖部手機就擲骰，結果得你自己見到。\n㩒「鎖定點數」會凍結你嘅點數：你仲睇得，但係搖極都唔會變，咁就冇人可以偷偷重搖。只有主持可以解鎖。鎖之前搖過幾多次，名單上會見到（🎲 已搖 ×3）。\n如果房主熄咗「玩家可以自己搖骰」，就淨係主持可以全體搖。',
    },
    {
      title: '主持嘅掣',
      body: '🎲 全體搖骰：一次過幫所有人搖，同時解開所有鎖。\n🔓 解鎖骰盅：解開所有人（或者單一個人）嘅骰盅鎖。\n👁 開晒啲骰：公開所有人嘅點數。開咗之後，要主持全體搖骰或者開下一回合先可以再搖。\n🔓 開晒角色：公開所有人嘅角色牌。\n➡️ 下一回合：重新派牌，大家嘅骰同鎖都清走。\n🃏 重新派牌：派錯咗先用，唔加回合數，骰唔會變。\n🏁 結束遊戲：去到結果頁，公開所有角色同骰。',
    },
    {
      title: '房主做主持',
      body: '房主可以選擇唔攞牌、唔擲骰，只係做主持。預設主持同大家一樣唔知邊個係咩角色；如果開咗「主持睇到所有人角色」，主持就睇到晒（殺手遊戲、狼人殺呢類要主持知晒邊個係邊個嘅玩法啱用）。',
    },
    {
      title: '一部機玩',
      body: '冇數據、或者有人部機冇電都得：一部機放喺枱中間，每人輪流拎起。開局之後 app 會逐個叫你交機畀下一個人睇牌，睇完就叫返下一個。\n主持嘅掣喺房主嗰個座位，要用就切返去房主嗰個位。',
    },
  ],
};

// ---------- engine ----------

const isPlainObject = (x) => x && typeof x === 'object' && !Array.isArray(x);
const seatOf = (state, pid) => (typeof pid === 'string' && Object.hasOwn(state.seats, pid) ? state.seats[pid] : null);
const isController = (state, seat) => seat.id === state.hostPid;
const playingSeats = (state) => state.order.map((id) => state.seats[id]).filter((s) => s.playing);

function say(state, text) {
  state.logSeq += 1;
  note(state, { n: state.logSeq, text }, LOG_KEEP);
}

function rollSeat(state, seat, rng) {
  seat.dice = Array.from({ length: state.dice.count }, () => rollDie(rng, state.dice.sides));
  seat.rollSeq += 1;   // counts rolls, not values: a repeat number still reads as a new roll
  seat.rolls = (seat.rolls ?? 0) + 1;   // this round's rolls — public (🎲 已搖 ×3), so a roll-till-it-fits shows
  seat.diceLocked = false;
}

const STREAK_TRIES = 60;

/**
 * The "special" cards for anti-streak: a role nobody fills in bulk — not the
 * auto-fill, and at most a third of the table (國王, every number, 內鬼, 殺手…;
 * not a 紅隊 that is half the table).
 */
function specialRoles(state, k) {
  return new Set(state.roles.filter((r) => !r.filler && r.count > 0 && r.count * 3 <= k).map((r) => r.id));
}

/**
 * Shuffle the deck onto the card holders. Resets every per-card flag.
 * With antiStreak, a seat does not get the special card it held at the last deal
 * (seat.roleId going in) when the deck allows: uniform rejection sampling, so no
 * seat is favoured; after STREAK_TRIES the shuffle with the fewest repeats wins.
 * Off = exactly one shuffle, as before.
 */
function deal(state, rng) {
  const holderSeats = playingSeats(state);
  const deck = [];
  for (const r of state.roles) for (let i = 0; i < r.count; i++) deck.push(r.id);
  const avoid = state.antiStreak ? specialRoles(state, holderSeats.length) : new Set();
  const repeats = (cards) => holderSeats.reduce((n, seat, i) => n + (avoid.has(cards[i]) && seat.roleId === cards[i] ? 1 : 0), 0);
  let shuffled = shuffle(rng, deck);
  if (avoid.size) {
    let worst = repeats(shuffled);
    for (let t = 1; t < STREAK_TRIES && worst > 0; t++) {
      const next = shuffle(rng, deck);
      const r = repeats(next);
      if (r < worst) { shuffled = next; worst = r; }
    }
  }
  holderSeats.forEach((seat, i) => { seat.roleId = shuffled[i]; });
  for (const seat of Object.values(state.seats)) {
    seat.seenRole = false;
    seat.roleLocked = false;
    if (!seat.playing) seat.roleId = null;
  }
  state.revealRoles = false;
  state.dealId += 1;
}

function resolveHost(players, hostPid) {
  if (hostPid && players.some((p) => p.id === hostPid)) return hostPid;
  const flagged = players.find((p) => p.isHost);
  return flagged ? flagged.id : seatOrder(players)[0];
}

/**
 * One handler per action type. `allowed` is the single source of truth for
 * both act() and legalActions(), so the two cannot drift apart.
 * Actions that would change nothing are NOT allowed.
 */
const HANDLERS = {
  // The player let go of their card after looking at it.
  seen: {
    allowed: (s, seat) => seat.playing && seat.roleId != null && !seat.seenRole && !s.revealRoles,
    run: (s, seat) => { seat.seenRole = true; },
  },
  // { on: boolean } — latch the role card shut (or open it again). Owner only.
  'lock-role': {
    allowed: (s, seat, a) => seat.playing && seat.roleId != null && !s.revealRoles
      && typeof a.on === 'boolean' && a.on !== seat.roleLocked,
    run: (s, seat, a) => {
      seat.roleLocked = a.on;
      if (a.on) seat.seenRole = true;   // latching a card shut means you are done with it
      say(s, `${seat.name} ${a.on ? '鎖咗' : '解鎖咗'}角色牌`);
    },
  },
  roll: {
    allowed: (s, seat) => seat.playing && !seat.diceLocked && !s.revealDice && (s.selfRoll || isController(s, seat)),
    run: (s, seat, a, ctx) => { rollSeat(s, seat, ctx.rng); say(s, `${seat.name} 搖咗骰 🎲`); },
  },
  // Freeze my roll: still readable, cannot be rolled again until the host lifts it.
  'lock-dice': {
    allowed: (s, seat) => seat.playing && seat.dice != null && !seat.diceLocked && !s.revealDice,
    run: (s, seat) => { seat.diceLocked = true; say(s, `${seat.name} 鎖定咗點數 🔒`); },
  },

  // ----- host only -----
  // Rolls every card holder, lifting their locks, and hides any revealed dice.
  'roll-all': {
    host: true,
    allowed: (s) => playingSeats(s).length > 0,
    run: (s, seat, a, ctx) => {
      for (const p of playingSeats(s)) { rollSeat(s, p, ctx.rng); p.rolls = 1; }   // a fresh start for everybody
      s.revealDice = false;
      say(s, '全體搖骰 🎲');
    },
  },
  // { pid? } — lift every dice lock, or just one seat's.
  'unlock-dice': {
    host: true,
    allowed: (s, seat, a) => {
      if (a.pid === undefined) return playingSeats(s).some((p) => p.diceLocked);
      const target = seatOf(s, a.pid);
      return !!target && target.diceLocked;
    },
    run: (s, seat, a) => {
      if (a.pid === undefined) {
        for (const p of playingSeats(s)) p.diceLocked = false;
        say(s, '🔓 主持解鎖咗所有骰盅，可以再搖');
      } else {
        const target = seatOf(s, a.pid);
        target.diceLocked = false;
        say(s, `🔓 主持解鎖咗 ${target.name} 嘅骰盅`);
      }
    },
  },
  'reveal-dice': {
    host: true,
    allowed: (s) => !s.revealDice && playingSeats(s).some((p) => p.dice != null),
    run: (s) => { s.revealDice = true; say(s, '👁 開晒啲骰'); },
  },
  'reveal-roles': {
    host: true,
    allowed: (s) => !s.revealRoles,
    run: (s) => {
      s.revealRoles = true;
      for (const p of Object.values(s.seats)) p.roleLocked = false;   // nothing left to hide
      say(s, '🔓 開晒角色！');
    },
  },
  // Same round, fresh shuffle. Dice are untouched.
  redeal: {
    host: true,
    allowed: () => true,
    run: (s, seat, a, ctx) => { deal(s, ctx.rng); say(s, `重新派牌（第 ${s.round} 回合）`); },
  },
  // New round: fresh shuffle AND a clean slate for dice (no stale numbers, no stale locks).
  'next-round': {
    host: true,
    allowed: () => true,
    run: (s, seat, a, ctx) => {
      s.round += 1;
      deal(s, ctx.rng);
      for (const p of Object.values(s.seats)) { p.dice = null; p.diceLocked = false; p.rolls = 0; }
      s.revealDice = false;
      say(s, `第 ${s.round} 回合：派咗牌`);
    },
  },
  // Ends the game: everything becomes public and the room goes to the results screen.
  end: {
    host: true,
    allowed: () => true,
    run: (s) => {
      s.phase = 'ended';
      s.revealRoles = true;
      s.revealDice = true;
      for (const p of Object.values(s.seats)) { p.roleLocked = false; p.diceLocked = false; }
      say(s, '🏁 遊戲完咗');
    },
  },
};

const handlerFor = (type) => (typeof type === 'string' && Object.hasOwn(HANDLERS, type) ? HANDLERS[type] : null);

function permitted(state, seat, action) {
  const h = handlerFor(action.type);
  if (!h || state.phase !== 'play') return false;
  if (h.host && !isController(state, seat)) return false;
  return !!h.allowed(state, seat, action);
}

function publicSeat(state, seat) {
  const out = {
    id: seat.id,
    name: seat.name,
    playing: seat.playing,
    seenRole: seat.seenRole,
    rolled: seat.dice != null,
    // how many times this round (the public log already says each roll; this makes it visible at a glance)
    rolls: seat.rolls ?? (seat.dice != null ? 1 : 0),
    roleLocked: seat.roleLocked,
    diceLocked: seat.diceLocked,
  };
  // Only after the host opened them. Absent (not null) before, so a leak is a missing-key bug.
  if (state.revealRoles && seat.playing) out.roleId = seat.roleId;
  if (state.revealDice && seat.dice) out.dice = seat.dice.slice();
  return out;
}

function myView(state, seat) {
  const role = seat.roleId != null ? state.roles.find((r) => r.id === seat.roleId) : null;
  const ctl = isController(state, seat);
  const mayRoll = seat.playing && !state.revealDice && (state.selfRoll || ctl);
  return {
    id: seat.id,
    playing: seat.playing,
    role: role ? { id: role.id, name: role.name, emoji: role.emoji, desc: role.desc } : null,
    dice: seat.dice ? seat.dice.slice() : null,
    rollSeq: seat.rollSeq,
    roleLocked: seat.roleLocked,
    diceLocked: seat.diceLocked,
    seenRole: seat.seenRole,
    mayRoll,   // may this seat roll at all (ignores the lock — the UI uses it to say *why* not)
  };
}

function canMap(state, seat) {
  const ok = (action) => permitted(state, seat, action);
  const can = {
    roll: ok({ type: 'roll' }),
    lockDice: ok({ type: 'lock-dice' }),
    lockRole: ok({ type: 'lock-role', on: true }),
    unlockRole: ok({ type: 'lock-role', on: false }),
  };
  if (isController(state, seat)) {
    can.rollAll = ok({ type: 'roll-all' });
    can.unlockDice = ok({ type: 'unlock-dice' });
    can.revealDice = ok({ type: 'reveal-dice' });
    can.revealRoles = ok({ type: 'reveal-roles' });
    can.redeal = ok({ type: 'redeal' });
    can.nextRound = ok({ type: 'next-round' });
    can.end = ok({ type: 'end' });
  }
  return can;
}

/**
 * One line for the 💡 sheet (BACKLOG U1): what to do right now, for a first-timer.
 * Built only from public facts (phase, reveals, who has looked) plus this seat's
 * own "have I looked / am I the host / do I hold a card" — never from a role, so
 * it cannot hint at anyone's card. Never shown unless the player taps 💡.
 */
function hintFor(state, me) {
  if (state.phase === 'ended') return '玩完喇：睇下結果，邊個贏由你哋自己講。';
  if (!me) return '你喺度睇緊，下一局先入到場。';
  const ctl = isController(state, me);
  if (state.revealRoles) {
    return ctl ? '角色公開咗：對完答案，㩒「下一回合」重新派牌。' : '角色公開咗：對下答案，等主持開下一回合。';
  }
  if (me.playing && !me.seenRole) return '㩒住張牌睇自己係咩角色，記住就放手，唔好講出口。';
  if (state.revealDice) return '開咗盅：睇下面「開盅」比大家嘅點數。';
  const waiting = playingSeats(state).some((s) => !s.seenRole);
  if (!me.playing) {
    return waiting ? '你係主持：等大家睇完牌，再講規則開始玩。' : '大家睇完牌喇：講規則開始玩，要時用下面嘅主持掣。';
  }
  if (waiting) return '等其他人睇完牌；記住唔好講自己係咩角色。';
  return ctl ? '大家睇完牌喇：開始玩，要時用下面嘅主持掣。' : '跟大家講好嘅規則玩；要擲骰就搖骰盅。';
}

// Every action a seat could ever send; legalActions() keeps the ones that would change something.
const CANDIDATES = [
  { type: 'seen' }, { type: 'lock-role', on: true }, { type: 'lock-role', on: false },
  { type: 'roll' }, { type: 'lock-dice' },
  { type: 'roll-all' }, { type: 'unlock-dice' }, { type: 'reveal-dice' }, { type: 'reveal-roles' },
  { type: 'redeal' }, { type: 'next-round' }, { type: 'end' },
];

export const engine = {
  setup({ players, config: cfg, rng, hostPid, carry }) {
    const v = validate(cfg, players.length);
    if (!v.ok) throw new Error(`custom: invalid config — ${v.message}`);
    const c = readCfg(cfg);
    const host = resolveHost(players, hostPid);

    const state = {
      phase: 'play',
      round: 1,
      dealId: 0,
      hostPid: host,
      selfRoll: c.selfRoll,
      antiStreak: c.antiStreak,
      modSees: c.modSees && !c.hostPlays,
      dice: { count: c.diceCount, sides: c.diceSides },
      roles: resolveRoles(c.roles, holders(c, players.length)),
      order: seatOrder(players),
      seats: {},
      revealRoles: false,
      revealDice: false,
      logSeq: 0,
      log: [],
    };
    // anti-streak across games: last game's cards (result().carry, by role NAME — ids are per deck)
    const last = isPlainObject(carry?.roles) ? carry.roles : {};
    for (const p of players) {
      const was = Object.hasOwn(last, p.id) && typeof last[p.id] === 'string' ? state.roles.find((r) => r.name === last[p.id]) : null;
      state.seats[p.id] = {
        id: p.id, name: p.name, playing: c.hostPlays || p.id !== host,
        roleId: was ? was.id : null, dice: null, rollSeq: 0, rolls: 0,
        roleLocked: false, diceLocked: false, seenRole: false,
      };
    }
    deal(state, rng);
    say(state, '第 1 回合：派咗牌');
    return state;
  },

  act(state, msg, ctx) {
    const { pid, action } = isPlainObject(msg) ? msg : {};
    if (!isPlainObject(action) || state.phase !== 'play') return state;
    const seat = seatOf(state, pid);   // also drops '@host' messages: nothing host-internal is needed here
    if (!seat || !permitted(state, seat, action)) return state;
    handlerFor(action.type).run(state, seat, action, ctx ?? {});
    return state;
  },

  advance(state) { return state; },   // no timers

  view(state, pid) {
    const me = pid != null ? seatOf(state, pid) : null;
    const ctl = !!me && isController(state, me);
    const v = {
      phase: state.phase,
      round: state.round,
      dealId: state.dealId,
      title: '通用派牌',
      subtitle: `第 ${state.round} 回合`,
      controller: ctl,
      selfRoll: state.selfRoll,
      dice: { count: state.dice.count, sides: state.dice.sides },
      roles: state.roles.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, desc: r.desc, count: r.count, filler: r.filler })),
      revealRoles: state.revealRoles,
      revealDice: state.revealDice,
      seats: state.order.map((id) => publicSeat(state, state.seats[id])),
      me: me ? myView(state, me) : null,
      can: me ? canMap(state, me) : {},
      log: state.log.slice(-LOG_SHOWN).map((l) => ({ n: l.n, text: l.text })),
      hint: hintFor(state, me),
    };
    // A moderator who chose to see everyone's role. Never for anyone else.
    if (ctl && state.modSees && !state.revealRoles) {
      v.all = {};
      for (const s of playingSeats(state)) v.all[s.id] = s.roleId;
    }
    return v;
  },

  cue() { return null; },

  // Card holders who have not looked at their card yet — drives 輪到你 and,
  // on a shared phone, walks the pass gate from seat to seat after every deal.
  focus(state) {
    if (state.phase !== 'play' || state.revealRoles) return null;
    const pids = state.order.filter((id) => HANDLERS.seen.allowed(state, state.seats[id]));
    return pids.length ? { pids } : null;
  },

  // A stalled / disconnected seat: skip their peek so it cannot hold the table up.
  autoAct(state, pid) {
    const seat = seatOf(state, pid);
    return seat && permitted(state, seat, { type: 'seen' }) ? { type: 'seen' } : null;
  },

  legalActions(state, pid) {
    const seat = seatOf(state, pid);
    if (!seat || state.phase !== 'play') return [];
    return CANDIDATES.filter((a) => permitted(state, seat, a)).map((a) => ({ ...a }));
  },

  // BACKLOG #10: say why there is no winner, then open everything that was hidden
  // during play — every card and every cup of the last round — and group the
  // repeated roles so "who were the killers" reads at a glance.
  result(state) {
    if (state.phase !== 'ended') return null;
    const lines = [
      '呢個係通用派牌：app 唔計輸贏，邊個贏由你哋自己講。',
      `最後一回合（第 ${state.round} 回合）每個人嘅牌同骰，玩緊嗰陣收埋嘅而家全部公開：`,
    ];
    const members = new Map();
    for (const id of state.order) {
      const seat = state.seats[id];
      if (!seat.playing) { lines.push(`${seat.name}：主持（冇牌）`); continue; }
      const role = state.roles.find((r) => r.id === seat.roleId);
      let dice = '';
      if (seat.dice) {
        const sum = seat.dice.reduce((a, b) => a + b, 0);
        dice = `　🎲 ${seat.dice.join(' ')}${seat.dice.length > 1 ? `（= ${sum}）` : ''}`;
      }
      lines.push(`${seat.name}：${role ? `${role.emoji} ${role.name}` : '（冇牌）'}${dice}`);
      if (role) members.set(role.id, [...(members.get(role.id) ?? []), seat.name]);
    }
    for (const role of state.roles) {
      const who = members.get(role.id) ?? [];
      if (who.length >= 2) lines.push(`${role.emoji} ${role.name}（${who.length} 個）：${who.join('、')}`);
    }
    if (!state.order.some((id) => state.seats[id].dice)) lines.push('今回合冇人擲過骰。');
    // for antiStreak in the next game (the room hands it to setup as `carry`; host only, never shown)
    const carry = { roles: {} };
    for (const id of state.order) {
      const role = state.roles.find((r) => r.id === state.seats[id].roleId);
      if (role) carry.roles[id] = role.name;
    }
    // noScore: the app keeps no score here — the shell says 「邊個贏由你哋講」 instead of a winners list
    return { winners: [], noScore: true, summary: `通用派牌：玩咗 ${state.round} 回合`, lines, carry };
  },
};
