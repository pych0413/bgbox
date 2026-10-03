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
// ============================================================

import { seatOrder, shuffle, rollDie, note } from '../../core/engine-kit.js?v=1';

// ---------- limits ----------

const MIN_SEATS = 2;
const MAX_SEATS = 16;
const MAX_DICE = 5;
const SIDES = [4, 6, 8, 10, 12, 20];
const LOG_KEEP = 40;
const LOG_SHOWN = 25;

// ---------- presets (ported from v1 js/roles.js) ----------

const PRESETS = [
  {
    id: 'cheese', label: '🧀 Cheese Thief',
    roles: () => [
      { name: '芝士小偷', emoji: '🐭', count: 1, desc: '偷芝士嗰個。唔好畀人捉到。' },
      { name: '偵探', emoji: '🔍', count: 1, desc: '揾出邊個係小偷。' },
      { name: '村民', emoji: '🧑‍🌾', filler: true, desc: '無特殊能力，靠一張嘴。' },
    ],
  },
  {
    id: 'cheeseGang', label: '🧀 Cheese Thief（雙賊）',
    roles: () => [
      { name: '芝士小偷', emoji: '🐭', count: 2, desc: '兩個賊識得對方，夾埋做嘢。' },
      { name: '偵探', emoji: '🔍', count: 1, desc: '揾出邊個係小偷。' },
      { name: '守衛', emoji: '🛡️', count: 1, desc: '每晚保護一個人。' },
      { name: '村民', emoji: '🧑‍🌾', filler: true, desc: '無特殊能力，靠一張嘴。' },
    ],
  },
  {
    id: 'werewolf', label: '🐺 狼人殺（基本）',
    roles: (n) => [
      { name: '狼人', emoji: '🐺', count: n >= 10 ? 3 : n >= 6 ? 2 : 1, desc: '夜晚殺人，白天扮好人。' },
      { name: '預言家', emoji: '🔮', count: 1, desc: '每晚查一個人嘅身份。' },
      { name: '女巫', emoji: '🧪', count: 1, desc: '一瓶解藥、一瓶毒藥。' },
      { name: '獵人', emoji: '🏹', count: 1, desc: '死嗰陣可以帶走一個人。' },
      { name: '平民', emoji: '🧑', filler: true, desc: '無能力，投票靠推理。' },
    ],
  },
  {
    id: 'undercover', label: '🕵️ 臥底',
    roles: (n) => [
      { name: '臥底', emoji: '🕵️', count: n >= 9 ? 2 : 1, desc: '你攞到嘅題目同大家唔同。' },
      { name: '白板', emoji: '⬜', count: n >= 7 ? 1 : 0, desc: '乜都無，靠聽人講去溝。' },
      { name: '平民', emoji: '🧑', filler: true, desc: '大多數人。' },
    ],
  },
  {
    id: 'custom', label: '✏️ 自訂',
    roles: () => [
      { name: '角色 A', emoji: '🅰️', count: 1, desc: '' },
      { name: '平民', emoji: '🧑', filler: true, desc: '' },
    ],
  },
];

const PRESET_IDS = PRESETS.map((p) => p.id);
const DEFAULT_PRESET = 'cheese';
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
      desc: typeof r.desc === 'string' ? r.desc.trim().slice(0, 60) : '',
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

/** Make a user's role list fit a new head-count (n changed since it was edited). */
function repairRoles(roles, k) {
  const r = roles.map((x) => ({ ...x }));
  if (!r.some((x) => x.filler)) {
    const big = r.reduce((a, b) => (b.count > a.count ? b : a), r[0]);
    big.filler = true;
    big.count = 0;
  }
  return fitCounts(r, k);
}

function presetRoles(presetId, n, k) {
  const p = PRESETS.find((x) => x.id === presetId);
  const list = p.roles(n).map((r, i) => ({
    id: `${presetId}_${i + 1}`, name: r.name, emoji: r.emoji, count: r.filler ? 0 : r.count,
    desc: r.desc, filler: !!r.filler,
  }));
  return fitCounts(list, k);
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
  };
}

const holders = (c, n) => (c.hostPlays ? n : n - 1);

function freshConfig(n, hostPlays = true) {
  const k = hostPlays ? n : n - 1;
  const cfg = { preset: DEFAULT_PRESET, hostPlays, modSees: false, diceCount: 1, diceSides: 6, selfRoll: true };
  for (const p of PRESETS) cfg[rolesKey(p.id)] = presetRoles(p.id, n, k);
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
  return { ok: true, message: c.hostPlays ? r.message : `${r.message}（主持唔攞牌）`, warnings };
}

const PRESET_OPTIONS = PRESETS.map((p) => ({ value: p.id, label: p.label }));

export const config = {
  defaults(n, prev) {
    const base = freshConfig(n);
    if (!prev || typeof prev !== 'object') return base;

    const cfg = {
      ...base,
      preset: PRESET_IDS.includes(prev.preset) ? prev.preset : DEFAULT_PRESET,
      hostPlays: prev.hostPlays !== false,
      modSees: prev.modSees === true,
      diceCount: clamp(toInt(prev.diceCount, 1), 1, MAX_DICE),
      diceSides: SIDES.includes(toInt(prev.diceSides, 6)) ? toInt(prev.diceSides, 6) : 6,
      selfRoll: prev.selfRoll !== false,
    };
    if (holders(cfg, n) < 2) cfg.hostPlays = true;   // 2 seats cannot spare a moderator
    const k = holders(cfg, n);
    for (const p of PRESETS) {
      const key = rolesKey(p.id);
      const mine = cleanRoles(prev[key]);
      if (mine.length < 2) cfg[key] = presetRoles(p.id, n, k);
      else cfg[key] = checkRoles(mine, k).ok ? mine : repairRoles(mine, k);
    }
    return validate(cfg, n).ok ? cfg : base;
  },

  validate,

  fields(cfg, n) {
    const c = readCfg(cfg);
    const v = validate(cfg, n);
    const out = [
      { key: 'preset', label: '預設牌組', type: 'select', options: PRESET_OPTIONS, help: '揀咗之後都可以再改角色，每個預設各自記住。' },
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
    );
    return out;
  },

  summary(cfg, n) {
    const c = readCfg(cfg);
    const r = checkRoles(c.roles, holders(c, n));
    const lines = [];
    for (const role of c.roles) {
      const count = role.filler ? (r.ok ? r.filler : null) : role.count;
      if (count === 0) continue;
      lines.push(`${role.emoji} ${role.name} ×${count ?? '自動'}`);
    }
    lines.push(`🎲 ${c.diceCount} × d${c.diceSides}${c.selfRoll ? '' : '（淨係主持搖得）'}`);
    lines.push(c.hostPlays ? '房主一齊玩' : `房主做主持（唔攞牌${c.modSees ? '，睇到所有人角色' : ''}）`);
    return lines;
  },
};

// ---------- meta & rules ----------

export const meta = {
  id: 'custom',
  name: '通用派牌 + 骰盅',
  emoji: '🎴',
  accent: '#2dd4bf',
  players: [MIN_SEATS, MAX_SEATS],
  minutes: [5, 180],
  narration: 'none',
  paperMode: false,
  singleDevice: 'full',
  blurb: '自己砌角色牌 + 秘密骰盅，乜遊戲都用得。',
  banks: [],
  css: true,
};

export const rules = {
  quick: [
    '主持揀好角色牌同骰仔，大家入房就派牌。',
    '㩒住張牌先睇到，放手即刻冚返。怕有人偷睇就㩒鎖。',
    '骰盅一樣：㩒住掀盅，搖下部機就擲骰。鎖咗之後要主持解鎖先再搖得。',
    '主持可以一鍵全體搖骰、開晒啲骰、開晒角色，再開下一回合。',
    '冇數據或者有人電話冇電？一部機都玩得，傳嚟傳去睇牌。',
  ],
  roles: [
    { id: 'thief', name: '芝士小偷', emoji: '🐭', team: 'neutral', text: '偷芝士嗰個。唔好畀人捉到。' },
    { id: 'detective', name: '偵探', emoji: '🔍', team: 'neutral', text: '揾出邊個係小偷。' },
    { id: 'guard', name: '守衛', emoji: '🛡️', team: 'neutral', text: '每晚保護一個人。' },
    { id: 'villager', name: '村民', emoji: '🧑‍🌾', team: 'neutral', text: '無特殊能力，靠一張嘴。' },
    { id: 'wolf', name: '狼人', emoji: '🐺', team: 'neutral', text: '夜晚殺人，白天扮好人。' },
    { id: 'seer', name: '預言家', emoji: '🔮', team: 'neutral', text: '每晚查一個人嘅身份。' },
    { id: 'witch', name: '女巫', emoji: '🧪', team: 'neutral', text: '一瓶解藥、一瓶毒藥。' },
    { id: 'hunter', name: '獵人', emoji: '🏹', team: 'neutral', text: '死嗰陣可以帶走一個人。' },
    { id: 'civilian', name: '平民', emoji: '🧑', team: 'neutral', text: '無能力，投票靠推理。' },
    { id: 'spy', name: '臥底', emoji: '🕵️', team: 'neutral', text: '你攞到嘅題目同大家唔同。' },
    { id: 'blank', name: '白板', emoji: '⬜', team: 'neutral', text: '乜都無，靠聽人講去溝。' },
  ],
  sections: [
    {
      title: '呢個係咩',
      body: '一個通用嘅派牌工具，唔係一隻特定遊戲。你自己決定有啲咩角色、每個角色幾多張，同埋用唔用骰仔，之後 app 負責派牌、收埋啲牌同骰、幫你開盅。遊戲點玩、邊個贏，由你哋自己講。',
    },
    {
      title: '角色牌',
      body: '每人派一張。㩒住張牌先睇到，放手即刻冚返，所以放喺枱面都唔使怕。\n如果有朋友喺你隔離，或者你要將部機借畀人，㩒「鎖定角色牌」，鎖咗之後連你自己都睇唔到，要自己㩒返解鎖。\n其中一個角色可以設做「自動填充」：指定咗嘅角色派完，剩低幾多人就當幾多個呢個角色。',
    },
    {
      title: '骰盅',
      body: '1 至 5 粒骰，可以揀 d4、d6、d8、d10、d12 或 d20。㩒「搖我嘅骰」或者搖部手機就擲骰，結果得你自己見到。\n㩒「鎖定骰盅」會凍結你嘅點數：你仲睇得，但係搖極都唔會變，咁就冇人可以偷偷重搖。只有主持可以解鎖。\n如果房主熄咗「玩家可以自己搖骰」，就淨係主持可以全體搖。',
    },
    {
      title: '主持嘅掣',
      body: '🎲 全體搖骰：一次過幫所有人搖，同時解開所有鎖。\n🔓 解鎖骰盅：解開所有人（或者單一個人）嘅骰盅鎖。\n👁 開晒啲骰：公開所有人嘅點數。開咗之後，要主持全體搖骰或者開下一回合先可以再搖。\n🔓 開晒角色：公開所有人嘅角色牌。\n➡️ 下一回合：重新派牌，大家嘅骰同鎖都清走。\n🃏 重新派牌：派錯咗先用，唔加回合數，骰唔會變。\n🏁 結束遊戲：去到結果頁，公開所有角色同骰。',
    },
    {
      title: '房主做主持',
      body: '房主可以選擇唔攞牌、唔擲骰，只係做主持。預設主持同大家一樣唔知邊個係咩角色；如果開咗「主持睇到所有人角色」，主持就睇到晒（狼人殺、臥底之類要有人掌控夜晚嗰啲玩法適用）。',
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
  seat.diceLocked = false;
}

/** Shuffle the deck onto the card holders. Resets every per-card flag. */
function deal(state, rng) {
  const holderSeats = playingSeats(state);
  const deck = [];
  for (const r of state.roles) for (let i = 0; i < r.count; i++) deck.push(r.id);
  const shuffled = shuffle(rng, deck);
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
      for (const p of playingSeats(s)) rollSeat(s, p, ctx.rng);
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
      for (const p of Object.values(s.seats)) { p.dice = null; p.diceLocked = false; }
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

// Every action a seat could ever send; legalActions() keeps the ones that would change something.
const CANDIDATES = [
  { type: 'seen' }, { type: 'lock-role', on: true }, { type: 'lock-role', on: false },
  { type: 'roll' }, { type: 'lock-dice' },
  { type: 'roll-all' }, { type: 'unlock-dice' }, { type: 'reveal-dice' }, { type: 'reveal-roles' },
  { type: 'redeal' }, { type: 'next-round' }, { type: 'end' },
];

export const engine = {
  setup({ players, config: cfg, rng, hostPid }) {
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
    for (const p of players) {
      state.seats[p.id] = {
        id: p.id, name: p.name, playing: c.hostPlays || p.id !== host,
        roleId: null, dice: null, rollSeq: 0,
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

  result(state) {
    if (state.phase !== 'ended') return null;
    const lines = ['呢個玩法冇輸贏。下面係最後一回合嘅牌同骰：'];
    for (const id of state.order) {
      const seat = state.seats[id];
      if (!seat.playing) { lines.push(`${seat.name}：主持（冇牌）`); continue; }
      const role = state.roles.find((r) => r.id === seat.roleId);
      const dice = seat.dice ? `　🎲 ${seat.dice.join(' ')}` : '';
      lines.push(`${seat.name}：${role ? `${role.emoji} ${role.name}` : '（冇牌）'}${dice}`);
    }
    return { winners: [], summary: `通用派牌：玩咗 ${state.round} 回合`, lines };
  },
};
