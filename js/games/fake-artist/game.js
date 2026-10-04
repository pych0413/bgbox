// ============================================================
// 假畫家 (A Fake Artist Goes to New York) — PURE module: meta, rules, config, engine.
// No DOM, no Math.random, no Date. Flow and wording: docs/games/fake-artist.md.
// Rules source: docs/research/fake-artist.md ("## Verification" overrides the draft):
//   question master picks the theme (public) and the title (secret), the fake gets an X;
//   clockwise, one stroke per turn, two laps; everyone but the QM votes at once;
//   a caught fake gets exactly one guess; points-v1 (fake + QM +2, or every real artist +1),
//   first to 5 — or, like the current print, no points at all (each round is just won or lost).
//
// Per round:  [qm-input] → deal → [first] → draw → vote → tally → [revote → tally] →
//             [guess → [judge]] → result      (then the next round, or `over`)
// Host 「呢鋪唔計」 (@void-round, a phone died) discards the round in play and deals a fresh one.
// The tally (who voted for whom) stays 7 s (D12) and the result keeps it. The result moves on when every present
// seat of the round has tapped 睇完 (D3, 「睇完 3 / 5」), or on the host's 下一步.
// Absent seats (D4, host `{ type: '@absent', pid }`, back with '@present'): public (💤), never waited on — no
// 睇完喇, their drawing turns are skipped, they do not vote and cannot be voted for (they are not the fake), no
// 睇完. An absent FAKE (before it is caught) or question master voids the round, like 呢鋪唔計; a fake that leaves
// after being caught simply gives no answer (a wrong guess). Later rounds deal around them (never fake, never QM).
//
// The shared drawing never enters state (DESIGN §15.10). In 📱 phone mode the UI sends
// { type: 'stroke', length } after its Canvas finished a stroke; in 📝 paper mode the
// drawer sends { type: 'done' } after drawing on the real paper.
// ============================================================

import { HOST, ACT, rint, seatOrder, tally, nextSeat } from '../../core/engine-kit.js?v=20261004005209';
import * as S from './script.js?v=20261004005209';

// D4 host actions (the literals, so this engine does not depend on engine-kit having them)
const ABSENT = ACT.ABSENT ?? '@absent';
const PRESENT = ACT.PRESENT ?? '@present';

// ---------- constants ----------

export const MIN_STROKE_LEN = 20;     // 0–1000 canvas units: a shorter stroke is an accidental tap (Canvas undoes it)
const STROKE_SLACK = 10;              // the engine only refuses a stroke shorter than this (the Canvas is the real gate)
export const TALLY_MS = 7000;         // who voted for whom stays this long before the next step (D12; the result keeps it)
const FAKE_PTS = 2;                   // fake artist and question master when the fake side wins
const ARTIST_PTS = 1;                 // every real artist when the artists win
const THEME_MAX = 12;
const WORD_MAX = 16;
const MIN_ARTISTS = 3;
const RANGES = { laps: [1, 3], target: [1, 15], rounds: [0, 20], turnSecs: [0, 60] };
const SCORING_MODES = ['points', 'none'];   // points-v1 (v1 print, first to target) · none-v2 (later prints: no points)
const DRAW_MODES = ['phone', 'paper'];
const QM_MODES = ['app', 'player'];
const TIE_RULES = ['must-guess', 'escape', 'revote'];
const GUESS_MODES = ['spoken', 'typed'];
const END_MODES = ['target', 'rounds'];
const FIRST_MODES = ['auto', 'random', 'qm'];
const LEVEL_IDS = [1, 2, 3];

// The categories of js/data/draw-words.js that make a drawable, concrete title. The bank also has charades-style
// categories (成語, 歇後語, 抽象, 電影場面, 動作) that nobody can draw one stroke at a time; they are left out.
// tests/fake-artist.test.mjs fails if the bank loses one of these or grows a category missing from both lists.
export const CATEGORIES = ['陸上動物', '海洋生物', '雀鳥', '昆蟲與細小生物', '恐龍與遠古生物', '寵物', '中式食物', '西式食物',
  '日本食物', '港式小食', '甜品', '水果', '蔬菜', '飲品', '屋企用品', '廚房用具', '浴室用品', '文具', '電器與科技', '玩具',
  '交通工具', '建築與地方', '世界地標', '太空', '天氣與大自然', '植物與花', '衣服與飾物', '身體與表情', '職業', '運動',
  '運動用品', '樂器', '香港地道', '日本', '新年', '中秋與端午', '聖誕節', '萬聖節', '童話與神話', '卡通與遊戲角色',
  '魔法與奇幻', '海灘與露營'];
export const EXCLUDED_CATEGORIES = ['動作', '成語', '歇後語與俗語', '抽象', '電影與故事場面'];

// Only used when the bank cannot be loaded at all (offline first run, empty bank), so a round never dies.
const FALLBACK_WORDS = [
  { w: '貓', alt: ['貓咪', '貓仔'], level: 1, cat: '寵物' }, { w: '狗', alt: ['狗仔', '小狗'], level: 1, cat: '寵物' },
  { w: '蘋果', alt: [], level: 1, cat: '水果' }, { w: '香蕉', alt: [], level: 1, cat: '水果' },
  { w: '雨傘', alt: ['遮'], level: 1, cat: '屋企用品' }, { w: '雪櫃', alt: ['冰箱'], level: 1, cat: '電器與科技' },
  { w: '巴士', alt: ['公共汽車', '大巴'], level: 1, cat: '交通工具' }, { w: '單車', alt: ['腳踏車', '自行車'], level: 1, cat: '交通工具' },
  { w: '大象', alt: ['象'], level: 1, cat: '陸上動物' }, { w: '長頸鹿', alt: [], level: 1, cat: '陸上動物' },
  { w: '吉他', alt: ['結他'], level: 1, cat: '樂器' }, { w: '太陽', alt: ['日頭'], level: 1, cat: '天氣與大自然' },
];

// ---------- pens: one distinct colour per seat on the cream sheet ----------
//
// A stroke's colour is how everybody knows who drew it, so two seats must never get look-alike pens.
// The lobby palette has near twins (two yellows, two blues, pinks, greens) and pale colours that vanish
// on the paper, so each seat gets one of these 12 pens instead — the free one closest to its lobby
// colour, in seat order. Every pen is ≥ 3.5:1 against the paper and ≥ 24 ΔE from every other pen
// (tests/fake-artist.test.mjs). 12 pens ≥ meta.players[1], so nobody ever shares one.

export const PENS = Object.freeze(['#d62828', '#e8590c', '#b07d00', '#5c940d', '#2b8a3e', '#0c8599',
  '#1c7ed6', '#3b3bc4', '#9c36b5', '#d6336c', '#8b4513', '#343a40']);

const HEX6 = /^#([0-9a-f]{6})$/i;

/** Same hue, deepened (lightness ≤ 0.42, saturation ≥ 0.65): what a pale lobby colour looks like as ink. */
export function penColor(hex) {
  const m = HEX6.exec(String(hex ?? '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let l = (max + min) / 2;
  let s = 0;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue /= 6;
  }
  l = Math.min(l, 0.42);
  s = Math.max(s, 0.65);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t0) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(hue + 1 / 3))}${to(f(hue))}${to(f(hue - 1 / 3))}`;
}

/** CIE L*a*b* of a #rrggbb colour (D65), or null. */
export function labOf(hex) {
  const m = HEX6.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const fy = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const fz = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** ΔE76 between two #rrggbb colours (Infinity if either is not one). */
export function colorDistance(a, b) {
  const x = labOf(a);
  const y = labOf(b);
  return x && y ? Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) : Infinity;
}

/** Distance in the a*b* (hue + chroma) plane only: a pale lobby colour and a dark pen of the same hue are close. */
function hueDistance(a, b) {
  const x = labOf(a);
  const y = labOf(b);
  return x && y ? Math.hypot(x[1] - y[1], x[2] - y[2]) : Infinity;
}

/**
 * { pid: pen } for players in seat order. The closest (seat, pen) pair is matched first, then the next closest
 * among what is left, so a pen goes to the seat whose lobby colour it resembles most. Ties: seat order, then pen
 * order — every phone computes the same map.
 */
export function assignPens(players) {
  const seats = players.filter((p) => p && typeof p.id === 'string');
  const pairs = [];
  seats.forEach((p, i) => {
    PENS.forEach((pen, j) => pairs.push({ i, j, d: hueDistance(p.color, pen) }));
  });
  pairs.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  const out = {};
  const usedSeat = new Set();
  const usedPen = new Set();
  for (const { i, j } of pairs) {
    if (usedSeat.has(i) || usedPen.has(j)) continue;
    usedSeat.add(i);
    usedPen.add(j);
    out[seats[i].id] = PENS[j];
  }
  for (const p of seats) out[p.id] ??= penColor(p.color) ?? PENS[0];   // never: 12 pens ≥ meta.players[1]
  return out;
}

// ---------- meta ----------

export const meta = {
  id: 'fake-artist',
  name: '假畫家',
  emoji: '🎨',
  accent: '#f472b6',
  players: [3, 10],
  minutes: [15, 25],
  narration: 'optional',
  paperMode: true,
  singleDevice: 'full',
  banks: ['draw'],
  css: true,
  blurb: '大家輪流落一筆畫同一幅畫，但有個人唔知畫乜。',
};

// ---------- rules text ----------

export const rules = {
  quick: [
    '每輪一個題目：真畫家知，假畫家淨係知主題。',
    '順時針輪流，每人畫一筆，一共畫兩圈。',
    '畫到令真畫家睇得明，但唔好太明顯。',
    '畫完同時投票，揪出邊個係假畫家。',
    '揪到假畫家，佢仲有一次機會估題目。',
    '假畫家贏 +2（有出題者，佢都 +2）；真畫家贏每人 +1。',
  ],
  roles: [
    { id: 'artist', name: '真畫家', emoji: '🎨', team: 'good', teamLabel: '真畫家',
      text: '知道主題同題目。輪到你就一筆過畫一筆，畫到其他真畫家知你識，但唔好明顯到假畫家估到。畫完一齊投票揪假畫家。'
        + '點贏：揪出假畫家，而佢估錯題目（每個真畫家 +1）。' },
    { id: 'fake', name: '假畫家', emoji: '🕶️', team: 'bad', teamLabel: '假畫家',
      text: '只知主題，唔知題目（你張卡係 ✕）。照樣畫一筆，扮識畫，跟住人哋啲線落筆；唔好畫得太離譜。'
        + '點贏：冇俾人揪出；或者被揪出但估中題目（+2）。' },
    { id: 'question-master', name: '出題者', emoji: '🧑‍🎨', team: 'bad', teamLabel: '出題者（輪流做）',
      text: '唔畫、唔投票。打主題（公開）同題目（秘密），知道邊個係假畫家，要扮冇嘢。假畫家被揪出估題目，由你判啱定錯。'
        + '點贏：假畫家贏，你同佢一齊贏（各 +2）。' },
  ],
  sections: [
    { title: '玩法流程', body:
      '1. 每輪有一個主題（大家都知）同一個題目（真畫家先知）。有人出題就由佢打；冇人出題就由手機抽。\n'
      + '2. 每個畫家㩒住張卡睇：真畫家見到題目，假畫家見到 ✕。睇完㩒「睇完喇」，齊人先開始畫。\n'
      + '3. 順時針輪流，每人一筆（一筆過，筆離開就算完），畫兩圈。用自己嘅顏色，所以邊筆係邊個畫一睇就知。\n'
      + '4. 畫完同時投票，揀你覺得係假畫家嘅人（唔可以投自己，出題者唔投）。\n'
      + '5. 揭曉票數（邊個投邊個會留喺結果度）；假畫家被揪出就有一次機會估題目。\n'
      + '6. 揭曉題目、假畫家同分數；全部人㩒「睇完」就開下一輪。' },
    { title: '兩種畫法', body:
      '📱 手機畫板：畫喺手機上，其他人即時睇到；一筆太短（碰一碰）唔算，可以再畫。\n'
      + '📝 實體紙筆：用真紙真筆畫，手機只負責派題、報「輪到邊個（邊個顏色）」同第幾圈，畫完嗰個㩒「畫完」。' },
    { title: '出題者', body:
      '「手機出題」：手機由詞庫抽一個題目，主題係詞庫嘅類別，人人都畫、人人都投票。\n'
      + '「輪流有人出題」：出題者打主題同題目（可以㩒 🎲 由詞庫抽一個再改），佢唔畫、唔投票，但知道假畫家係邊個。每輪向左傳。\n'
      + '主題唔可以包住題目（例如主題「獅子」題目「獅子」）。' },
    { title: '投票同平票', body:
      '票數最高嘅人就係被揪出嘅人。平票點算由設定決定：\n'
      + '・現行規則（預設）：假畫家喺最高票入面（包括平票）就要估題目；最高票唔包括佢，佢就贏。\n'
      + '・舊版規則：平票一律當冇揪到。\n'
      + '・民間玩法：平票再投一次，只有冇被指嘅人投，只可以揀平票嘅人；再平就照現行規則。' },
    { title: '估題目', body:
      '假畫家被揪出，有且只有一次機會估題目。估中，假畫家贏；估錯，真畫家贏。\n'
      + '「開口講」：佢大聲講，出題者（冇出題者就係房主）㩒啱／錯。\n'
      + '「打字」：佢喺手機打，同詞庫答案（包括近義寫法）一樣就自動啱；唔一樣就由出題者／房主決定算唔算。' },
    { title: '計分同贏', body:
      '・假畫家冇被揪出，或者被揪出但估中：假畫家 +2，出題者（如果有）+2。\n'
      + '・假畫家被揪出而且估錯：每個真畫家 +1，假畫家同出題者 0。\n'
      + '・先到目標分數（預設 5 分）贏；同一輪有幾個人超過，最高分贏，同分就一齊贏。\n'
      + '・亦可以改做打固定輪數，玩完比總分。\n'
      + '・「唔計分」（新版盒嘅玩法）：每輪淨係分邊隊贏；打完指定輪數，贏得最多輪嘅人贏。' },
    { title: '有人部手機冇電', body:
      '房主可以㩒「呢鋪唔計」：呢輪作廢、冇人得分，換下一個出題者重新派過題目。輪數照計返。\n'
      + '睇緊結果嗰陣，呢輪已經計咗分，唔可以作廢；大家㩒「睇完」就得。\n'
      + '有人走開咗：房主可以將佢設做「唔喺度」（💤）。輪到佢畫就跳過，佢唔使投票，亦唔會再做假畫家或者出題者；'
      + '如果佢係今輪嘅假畫家（未被揪出）或者出題者，呢輪就唔計，重新嚟過。' },
    { title: '小貼士', body:
      '・真畫家：第一筆唔好太明顯，細節留返後面；睇吓邊個畫得似是而非。\n'
      + '・假畫家：先睇人哋畫乜，筆劃盡量延伸前面嘅線，唔好第一個落筆太具體。\n'
      + '・投票之前可以講嘢，但唔可以直接講出題目。' },
  ],
};

// ---------- config ----------

const DEFAULTS = Object.freeze({
  draw: 'phone', qm: 'app', laps: 2, tieRule: 'must-guess', guess: 'spoken', scoring: 'points',
  endMode: 'target', target: 5, rounds: 0, first: 'qm', turnSecs: 0, antiStreak: false,
  topics: Object.freeze({ cats: Object.freeze([]), levels: Object.freeze([]) }),
});

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const allStrings = (a) => Array.isArray(a) && a.every((c) => typeof c === 'string');

function asInt(v) {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof x === 'number' && Number.isInteger(x) ? x : NaN;
}

const levelsOf = (list) => (Array.isArray(list) ? list.map(asInt).filter((x) => LEVEL_IDS.includes(x)) : []);

/** The chosen categories / levels, from the ConfigForm shape { cats, levels } (a bare array = categories). */
function topicsOf(v) {
  if (Array.isArray(v)) return { cats: allStrings(v) ? v.slice() : [], levels: [] };
  if (!isObj(v)) return { cats: [], levels: [] };
  const cats = Array.isArray(v.cats) ? v.cats : v.categories;
  const lv = v.levels ?? v.level;
  return { cats: allStrings(cats) ? cats.slice() : [], levels: [...new Set(levelsOf(lv))].sort() };
}

function keyOk(key, v) {
  if (key in RANGES) {
    const x = asInt(v);
    return x >= RANGES[key][0] && x <= RANGES[key][1];
  }
  switch (key) {
    case 'draw': return DRAW_MODES.includes(v);
    case 'qm': return QM_MODES.includes(v);
    case 'tieRule': return TIE_RULES.includes(v);
    case 'guess': return GUESS_MODES.includes(v);
    case 'scoring': return SCORING_MODES.includes(v);
    case 'endMode': return END_MODES.includes(v);
    case 'first': return FIRST_MODES.includes(v);
    case 'antiStreak': return typeof v === 'boolean';
    case 'topics':
      if (Array.isArray(v)) return allStrings(v);
      return isObj(v) && ['cats', 'categories'].every((k) => v[k] === undefined || allStrings(v[k]))
        && ['levels', 'level'].every((k) => v[k] === undefined || (Array.isArray(v[k]) && v[k].every((x) => LEVEL_IDS.includes(asInt(x)))));
    default: return false;
  }
}

/** Fill gaps and coerce (the shell's <select> hands back strings). Never throws. */
function clean(cfg) {
  const c = isObj(cfg) ? cfg : {};
  const out = { ...DEFAULTS, topics: { cats: [], levels: [] } };
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in c) || !keyOk(key, c[key])) continue;
    if (key in RANGES) out[key] = asInt(c[key]);
    else if (key === 'topics') out.topics = topicsOf(c.topics);
    else out[key] = c[key];
  }
  return out;
}

/** The settings the game actually uses for n players (a human QM needs 3 artists, 「出題者揀」 needs a QM). */
function norm(cfg, n) {
  const out = clean(cfg);
  if (out.qm === 'player' && n < MIN_ARTISTS + 1) out.qm = 'app';
  if (out.first === 'qm' && out.qm !== 'player') out.first = 'auto';
  if (out.scoring === 'none') out.endMode = 'rounds';     // no points, no target: a fixed number of rounds
  return out;
}

const artistsFor = (cfg, n) => (cfg.qm === 'player' ? n - 1 : n);
const totalRoundsFor = (cfg, n) => (cfg.endMode === 'rounds' || cfg.scoring === 'none' ? (cfg.rounds || n) : 0);

/** 「6 人：手機出題，6 個畫家 — 最啱玩嘅人數」 */
function headcountLine(cfg, n) {
  const a = artistsFor(cfg, n);
  const who = cfg.qm === 'player' ? `1 個出題者 + ${a} 個畫家` : `手機出題，${a} 個畫家`;
  return `${n} 人：${who} — ${headcountWhy(a)}`;
}

/** Why this head-count plays the way it does (research: best 6–7, ties common with 4 voters, hard to catch from 9). */
function headcountWhy(a) {
  return a <= 3 ? '人少，假畫家好易俾人睇穿'
    : a === 4 ? '人少，平票好常見'
      : a <= 8 ? '最啱玩嘅人數'
        : '人多，假畫家較難揪';
}

export const config = {
  /**
   * Recommended setup for n players. Keeps every taste from `prev` (the last game) that still fits the head-count.
   * `env.singleDevice` (one phone holds every seat): the app is the question master (a QM on a passed-round phone
   * has nobody to hide the fake from) and there is no stroke clock (handing the phone over eats into it).
   */
  defaults(n, prev, env) {
    // `first` stays as asked even without a QM: the official 「出題者揀」 is what you get when you switch to a QM game
    // (the engine's norm() treats it as `auto` while there is no QM)
    const c = clean(prev);
    if (c.qm === 'player' && n < MIN_ARTISTS + 1) c.qm = 'app';
    if (env && env.singleDevice) { c.qm = 'app'; c.turnSecs = 0; }
    return c;
  },

  /** Head-count presets with a reason (BACKLOG #8); each cfg is a patch over the current config. */
  presets(n) {
    const a = n;                                        // with the app as QM every seat draws
    const out = [
      { id: 'standard', label: '標準', reason: `${n} 人：人人都畫，先到 5 分 — ${headcountWhy(a)}`,
        cfg: { draw: 'phone', qm: 'app', laps: 2, scoring: 'points', endMode: 'target', target: 5 } },
      { id: 'paper', label: '紙筆', reason: '有紙有筆：大家望住同一張紙，手機淨係派題同投票', cfg: { draw: 'paper' } },
    ];
    if (n >= 5) {                                       // the official minimum with a question master is 5
      out.push({ id: 'host', label: '輪流出題', reason: '官方玩法：輪流做出題者，佢唔畫，但知邊個係假畫家', cfg: { qm: 'player' } });
    }
    out.push(
      { id: 'quick', label: '快玩', reason: '時間唔多：淨係玩 3 輪，比總分', cfg: { scoring: 'points', endMode: 'rounds', rounds: 3 } },
      { id: 'noscore', label: '唔計分', reason: '新版盒玩法：每輪淨係分勝負，每人一輪', cfg: { scoring: 'none', rounds: 0 } },
    );
    return out;
  },

  validate(cfg, n) {
    const warnings = [];
    if (!Number.isInteger(n) || n < meta.players[0] || n > meta.players[1]) {
      return { ok: false, message: `假畫家要 ${meta.players[0]}–${meta.players[1]} 個人玩。`, warnings };
    }
    const c = isObj(cfg) ? cfg : {};
    const label = {
      draw: '畫法', qm: '出題方式', laps: '畫幾圈', tieRule: '平票點算', guess: '估題目方式', scoring: '計分', endMode: '結束方式',
      target: '目標分數', rounds: '輪數', first: '邊個先畫', turnSecs: '每筆限時', antiStreak: '假畫家唔連續做', topics: '題目類別',
    };
    for (const key of Object.keys(DEFAULTS)) {
      if (key in c && !keyOk(key, c[key])) return { ok: false, message: `「${label[key]}」設定唔啱。`, warnings };
    }
    if (c.qm === 'player' && n < MIN_ARTISTS + 1) {
      return { ok: false, message: `輪流出題最少要 ${MIN_ARTISTS + 1} 個人（${MIN_ARTISTS} 個畫家 + 出題者）。`, warnings };
    }
    const m = norm(c, n);
    const a = artistsFor(m, n);
    if (a <= 3) {
      warnings.push(m.qm === 'player'
        ? `出題者 + ${a} 個畫家：官方最少要 5 人，假畫家好易俾人睇穿`
        : `${a} 個畫家玩，假畫家好易俾人睇穿；5 人或以上更好玩`);
    }
    if (a >= 9) warnings.push(`${a} 個畫家，假畫家好難揪出`);
    if (m.tieRule === 'escape' && a <= 5) warnings.push('舊版規則（平票當冇揪到）人少嗰陣好偏幫假畫家');
    if (a * m.laps > 24) warnings.push(`一共 ${a * m.laps} 筆，會畫好耐`);
    if (m.endMode === 'target' && m.target > 8) warnings.push('目標分數高，會玩好耐');
    if (m.endMode === 'rounds' && totalRoundsFor(m, n) > 12) warnings.push(`一共 ${totalRoundsFor(m, n)} 輪，會玩好耐`);
    if (m.turnSecs > 0 && m.turnSecs < 5) warnings.push('每筆限時太短，未必畫得切');
    if (m.antiStreak && a <= 3) warnings.push('3 個畫家嘅時候，「唔連續做」唔會生效');
    return { ok: true, message: '', warnings };
  },

  fields(cfg, n) {
    const m = norm(cfg, n);
    const a = artistsFor(m, n);
    const out = [
      { key: 'draw', label: '畫法', type: 'select',
        help: m.draw === 'paper' ? '手機淨係派題、報輪次、投票；畫喺真紙上，畫完㩒「畫完」。' : '畫喺手機上，其他人即時睇到；一筆太短唔算，可以再畫。',
        options: [{ value: 'phone', label: '📱 手機畫板' }, { value: 'paper', label: '📝 實體紙筆' }] },
      { key: 'qm', label: '出題方式', type: 'select',
        help: m.qm === 'player'
          ? '出題者打主題同題目，唔畫、唔投票，知道假畫家係邊個，假畫家贏佢都有分。'
          : '手機由詞庫抽題目，主題係詞庫類別；人人都畫、人人都投票。',
        options: [{ value: 'app', label: '手機出題（人人都畫）' },
          ...(n >= MIN_ARTISTS + 1 ? [{ value: 'player', label: '輪流有人出題（出題者唔畫）' }] : [])] },
      { key: 'laps', label: '畫幾圈', type: 'int', min: 1, max: 3,
        help: `官方畫 2 圈。${a} 個畫家共 ${a * m.laps} 筆。` },
      { key: 'tieRule', label: '平票點算', type: 'select',
        help: '最高票平手嗰陣，假畫家算唔算被揪出。',
        options: [{ value: 'must-guess', label: '現行官方：假畫家喺最高票入面就要估' },
          { value: 'escape', label: '舊版：平票當冇揪到' },
          { value: 'revote', label: '民間：平票再投一次' }] },
      { key: 'guess', label: '估題目方式', type: 'select',
        help: m.guess === 'typed' ? '假畫家打字；同詞庫答案一樣就自動啱，否則由出題者／房主判。' : '假畫家開口講，出題者（冇就係房主）㩒啱或者錯。',
        options: [{ value: 'spoken', label: '開口講（唔使打字）' }, { value: 'typed', label: '打字（自動對詞庫）' }] },
      { key: 'scoring', label: '計分', type: 'select',
        help: m.scoring === 'none'
          ? '新版盒冇分數：每輪淨係分邊隊贏。打完指定輪數，贏得最多輪嘅人贏。'
          : m.qm === 'player'
            ? '舊版盒有分：假畫家同出題者贏各 +2，真畫家贏每人 +1。'
            : '舊版盒有分：假畫家贏 +2，真畫家贏每人 +1。',
        options: [{ value: 'points', label: '計分（舊版）' }, { value: 'none', label: '唔計分（新版：每輪分勝負）' }] },
    ];
    if (m.scoring === 'points') {
      out.push({ key: 'endMode', label: '結束方式', type: 'select',
        options: [{ value: 'target', label: '先到目標分數' }, { value: 'rounds', label: '打固定輪數' }] });
    }
    if (m.endMode === 'target') {
      out.push({ key: 'target', label: '目標分數', type: 'int', min: 1, max: 15, help: '官方係 5 分。假畫家贏 +2，真畫家贏每人 +1。' });
    } else {
      out.push({ key: 'rounds', label: '打幾多輪', type: 'int', min: 0, max: 20,
        help: `0＝每人一輪（而家 ${n} 輪）。玩完${m.scoring === 'none' ? '贏得最多輪' : '最高分'}嘅人贏。` });
    }
    if (m.qm === 'player') {
      out.push({ key: 'first', label: '邊個先畫', type: 'select',
        options: [{ value: 'qm', label: '出題者揀（官方）' }, { value: 'auto', label: '自動（出題者左手邊）' }, { value: 'random', label: '隨機' }] });
    }
    out.push(
      { key: 'turnSecs', label: '每筆限時（秒）', type: 'seconds', min: 0, max: 60, step: 5,
        help: '0＝唔限時。超時就當放棄呢一筆，輪到下一個。' },
      { key: 'antiStreak', label: '上一輪嘅假畫家呢輪唔做', type: 'bool', help: '4 個畫家或以上先生效。' },
      { key: 'topics', label: '題目類別', type: 'categories',
        help: '唔揀類別＝全部；唔揀難度＝簡單同中等。只影響手機抽嘅題目。',
        options: CATEGORIES.map((c) => ({ value: c, label: c })),
        levels: [{ value: 1, label: '簡單' }, { value: 2, label: '中等' }, { value: 3, label: '困難' }] },
    );
    return out;
  },

  summary(cfg, n) {
    const m = norm(cfg, n);
    const lines = [headcountLine(m, n)];
    lines.push(m.draw === 'paper' ? '實體紙筆（手機報輪次）' : '手機畫板');
    lines.push(`每人畫 ${m.laps} 圈`);
    lines.push({ 'must-guess': '平票：假畫家喺最高票入面就要估', escape: '平票當冇揪到（舊版）', revote: '平票再投一次' }[m.tieRule]);
    lines.push(m.guess === 'typed' ? '打字估題目' : '開口估題目');
    if (m.scoring === 'none') lines.push(`唔計分：打 ${totalRoundsFor(m, n)} 輪，每輪分勝負`);
    else lines.push(m.endMode === 'target' ? `先到 ${m.target} 分` : `打 ${totalRoundsFor(m, n)} 輪，比總分`);
    if (m.turnSecs > 0) lines.push(`每筆限時 ${m.turnSecs} 秒`);
    if (m.topics.cats.length) lines.push(`類別：${m.topics.cats.join('、')}`);
    if (m.topics.levels.length) lines.push(`難度：${m.topics.levels.map((l) => ['', '簡單', '中等', '困難'][l]).join('、')}`);
    if (m.first !== 'auto') lines.push(m.first === 'qm' ? '出題者揀邊個先畫' : '隨機邊個先畫');
    if (m.antiStreak) lines.push('假畫家唔連續做');
    return lines;
  },
};

// ---------- text helpers (shared with the UI) ----------

/** Trim, collapse inner whitespace, drop control characters. */
export function tidy(x) {
  return String(x ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
export const textLen = (s) => Array.from(String(s ?? '')).length;

/** For comparing a guess / a theme with a word: width-folded, lower-cased, punctuation and spaces removed. */
export function normText(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** Validate what the question master typed. Never throws. → { ok, message, theme, word } */
export function checkEntry(themeRaw, wordRaw) {
  const theme = tidy(themeRaw);
  const word = tidy(wordRaw);
  const bad = (message) => ({ ok: false, message, theme, word });
  if (!theme || !word) return bad('主題同題目都要填。');
  if (textLen(theme) > THEME_MAX) return bad(`主題最多 ${THEME_MAX} 個字。`);
  if (textLen(word) > WORD_MAX) return bad(`題目最多 ${WORD_MAX} 個字。`);
  const t = normText(theme);
  const w = normText(word);
  if (!t || !w) return bad('主題同題目都要有字。');
  if (t === w || t.includes(w)) return bad('主題唔可以包住題目，會洩露答案。');
  return { ok: true, message: '', theme, word };
}

/** Does the typed guess equal the title or one of its aliases? */
export function matchesWord(guess, word, alt = []) {
  const g = normText(guess);
  if (!g) return false;
  return [word, ...alt].some((x) => normText(x) === g);
}

/** Length of a polyline of [x, y] points, in canvas units (what a Canvas reports as a stroke's length). */
export function strokeLength(pts) {
  let len = 0;
  for (let i = 1; i < (pts?.length ?? 0); i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

// ---------- engine helpers ----------

const nameOf = (s, pid) => s.players.find((p) => p.id === pid)?.name ?? '?';
const namer = (s) => (pid) => nameOf(s, pid);
const isAbsent = (s, pid) => !!s.absent?.[pid];
const here = (s, list) => list.filter((p) => !isAbsent(s, p));
/** The fewest present seats a round still works with: 3 artists, plus the question master when there is one. */
const minPresent = (s) => MIN_ARTISTS + (s.cfg.qm === 'player' ? 1 : 0);
/** Who reads the result and taps 睇完: the round's artists and its question master, if they are at the table. */
const readers = (s) => here(s, [...s.round.artists, ...(s.round.qm ? [s.round.qm] : [])]);

/** Seats after `pid`, going round the table, excluding `pid`. */
function after(order, pid) {
  const i = order.indexOf(pid);
  return [...order.slice(i + 1), ...order.slice(0, i)];
}

function rotateTo(list, first) {
  const i = list.indexOf(first);
  return i <= 0 ? list.slice() : [...list.slice(i), ...list.slice(0, i)];
}

function clearTimer(s) {
  s.deadline = null;
  s.timerLabel = '';
}

// (a state restored from before pens / round wins existed still renders)
const pensOf = (s) => s.pens ?? assignPens(s.order.map((id) => s.players.find((p) => p.id === id)));
const winsOf = (s) => s.wins ?? Object.fromEntries(s.order.map((id) => [id, 0]));

const drawerOf = (r) => (r.turnOrder.length ? r.turnOrder[r.turn % r.turnOrder.length] : null);
const lapOf = (r) => (r.turnOrder.length ? Math.floor(r.turn / r.turnOrder.length) + 1 : 0);
const strokesTotal = (s) => s.round.turnOrder.length * s.cfg.laps;
const lastTally = (r) => r.tally2 ?? r.tally1;

/** A leaky entry would hand the fake the answer: the theme (= category) naming the word or one of its aliases. */
function leaks(e) {
  const cat = normText(e.cat);
  const w = normText(e.w);
  if (!cat || !w) return true;
  if (cat.includes(w) || w.includes(cat)) return true;
  return (e.alt ?? []).some((a) => { const x = normText(a); return x && cat.includes(x); });
}

function usable(e) {
  return !!e && typeof e.w === 'string' && e.w !== '' && typeof e.cat === 'string' && e.cat !== '' && !leaks(e);
}

/** core/bag.js throws if the bank was never loaded; a round must survive that. */
function safeDraw(bag, predicate) {
  if (!bag) return null;
  try { return bag.draw('draw', predicate); } catch { return null; }
}

/** One { theme, word, alt, cat, level } from the draw bank: relaxes level, then category, then everything. */
function drawEntry(s, ctx) {
  const cats = s.cfg.topics.cats;
  const levels = s.cfg.topics.levels.length ? s.cfg.topics.levels : [1, 2];
  const okCat = (e) => (cats.length ? cats.includes(e.cat) : CATEGORIES.includes(e.cat));
  const okLevel = (e) => levels.includes(e.level);
  const tries = [(e) => okCat(e) && okLevel(e), okCat, (e) => CATEGORIES.includes(e.cat) && okLevel(e), (e) => CATEGORIES.includes(e.cat), () => true];
  let e = null;
  for (const f of tries) {
    e = safeDraw(ctx.bag, (x) => usable(x) && f(x));
    if (usable(e)) break;
    e = null;
  }
  if (!e) e = FALLBACK_WORDS[rint(ctx.rng, FALLBACK_WORDS.length)];
  return { theme: e.cat, word: e.w, alt: Array.isArray(e.alt) ? e.alt.filter((a) => typeof a === 'string') : [], cat: e.cat, level: e.level };
}

function pickFake(s, ctx) {
  const r = s.round;
  let pool = here(s, r.artists);
  // optional anti-streak: only while at least 3 candidates remain, so it never comes close to naming the fake
  if (s.cfg.antiStreak && s.lastFake && pool.includes(s.lastFake) && pool.length - 1 >= 3) pool = pool.filter((p) => p !== s.lastFake);
  return pool[rint(ctx.rng, pool.length)];
}

// ---------- round flow ----------

/**
 * A new round. `redo` = the host voided the last one (a phone died): same round number again, a fresh word, a
 * fresh fake and — in QM mode — the next question master (research: a QM whose phone is gone is replaced by the
 * next in order and the round restarts). `key` counts every round started, so cue ids never repeat.
 */
function startRound(s, ctx, redo = false) {
  if (!redo) s.roundNo += 1;
  s.started = (s.started ?? s.roundNo - 1) + 1;
  if (s.started > 1) s.inkEpoch += 1;                      // a fresh picture; the session clears the old ink
  // the question master rotates left, passing over absent seats; absent seats sit the round out (D4)
  if (s.cfg.qm === 'player') {
    for (let k = 0; k < s.order.length && isAbsent(s, s.order[s.qmPtr]); k++) s.qmPtr = (s.qmPtr + 1) % s.order.length;
  }
  const qm = s.cfg.qm === 'player' ? s.order[s.qmPtr] : null;
  if (qm) s.qmPtr = (s.qmPtr + 1) % s.order.length;
  const artists = here(s, qm ? after(s.order, qm) : s.order.slice());
  s.round = {
    n: s.roundNo, key: s.started, redo, qm, artists,
    seen: {},                // result: pid → true, tapped 睇完 (public)
    theme: '', word: '', alt: [], fake: null,
    draft: null, draftSeq: 0, acks: {},
    turnOrder: [], turn: 0, strokes: [],
    vote: null, tally1: null, tally2: null, caught: null, revotePending: false, next: null,
    judge: null, guess: null, rv: null,
  };
  clearTimer(s);
  s.ending = false;
  if (qm) { s.phase = 'qm-input'; return; }
  dealWord(s, ctx, drawEntry(s, ctx));
}

function dealWord(s, ctx, e) {
  const r = s.round;
  r.theme = e.theme;
  r.word = e.word;
  r.alt = e.alt;
  r.draft = null;
  r.fake = pickFake(s, ctx);
  r.acks = {};
  s.phase = 'deal';
  clearTimer(s);
}

function startDraw(s, ctx) {
  const r = s.round;
  const mode = s.cfg.first;
  if (mode === 'qm' && r.qm) { s.phase = 'first'; clearTimer(s); return; }
  const first = mode === 'auto' && r.qm ? r.artists[0] : r.artists[rint(ctx.rng, r.artists.length)];
  beginDraw(s, ctx, first);
}

function beginDraw(s, ctx, first) {
  const r = s.round;
  r.turnOrder = rotateTo(r.artists, first);
  r.turn = 0;
  r.strokes = [];
  s.phase = 'draw';
  nextDrawer(s, ctx);
}

/** The turn lands on the next drawer who is at the table (an absent artist's strokes are skipped, D4). */
function nextDrawer(s, ctx) {
  const r = s.round;
  while (r.turn < strokesTotal(s) && isAbsent(s, drawerOf(r))) {
    r.strokes.push({ pid: drawerOf(r), lap: lapOf(r), kind: 'away' });
    r.turn += 1;
  }
  if (r.turn >= strokesTotal(s)) startVote(s, ctx);
  else setTurnTimer(s, ctx);
}

function setTurnTimer(s, ctx) {
  if (s.cfg.turnSecs > 0 && s.phase === 'draw') {
    s.deadline = ctx.now + s.cfg.turnSecs * 1000;
    s.timerLabel = `${nameOf(s, drawerOf(s.round))} 畫緊`;
  } else clearTimer(s);
}

/** One stroke slot is used up: drawn ('ink' / 'paper') or given up ('forfeit'). */
function advanceTurn(s, ctx, kind) {
  const r = s.round;
  r.strokes.push({ pid: drawerOf(r), lap: lapOf(r), kind });
  r.turn += 1;
  nextDrawer(s, ctx);
}

/** Everyone at the table votes; an absent artist is no candidate either (were it the fake, the round was voided). */
function startVote(s, ctx) {
  const r = s.round;
  const present = here(s, r.artists);
  r.vote = { round: 1, voters: present, candidates: present.slice(), votes: {} };
  s.phase = 'vote';
  clearTimer(s);
  if (allVoted(r.vote)) resolveVote(s, ctx);
}

function startRevote(s, ctx) {
  const r = s.round;
  const top = r.tally1.top;
  r.vote = { round: 2, voters: here(s, r.artists).filter((a) => !top.includes(a)), candidates: top.slice(), votes: {} };
  s.phase = 'revote';
  clearTimer(s);
  if (allVoted(r.vote)) resolveVote(s, ctx);             // nobody left to re-vote: the second-tie rule decides
}

const allVoted = (v) => v.voters.every((p) => p in v.votes);

/** Close the ballot: tally, decide whether the fake is caught (tie rule), show the result for a few seconds. */
function resolveVote(s, ctx) {
  const r = s.round;
  const v = r.vote;
  const F = r.fake;
  const votes = {};
  for (const pid of v.voters) votes[pid] = pid in v.votes ? v.votes[pid] : null;
  const t = tally(votes);
  const rec = { round: v.round, counts: t.counts, top: t.top, votes, abstained: v.voters.filter((p) => votes[p] === null) };

  if (v.round === 1) {
    r.tally1 = rec;
    let caught = false;
    let revote = false;
    if (!t.top.length) caught = false;                      // nobody pointed at anybody
    else if (t.top.length === 1) caught = t.top[0] === F;
    else if (!t.top.includes(F)) caught = false;            // the fake was not among the most-pointed
    else if (s.cfg.tieRule === 'escape') caught = false;    // v1 booklet: any tie at the top = not caught
    else if (s.cfg.tieRule === 'revote') {
      if (here(s, r.artists).some((a) => !t.top.includes(a))) revote = true;
      else caught = true;                                   // everybody is tied: nobody left to re-vote
    } else caught = true;                                   // must-guess (current print): in the top = caught
    r.caught = revote ? null : caught;
    r.revotePending = revote;
    r.next = revote ? 'revote' : caught ? 'guess' : 'score';
  } else {
    r.tally2 = rec;
    // a unique winner decides; a second tie (or no ballots) falls back to must-guess — the fake WAS in the first top
    const caught = t.top.length === 1 ? t.top[0] === F : true;
    r.caught = caught;
    r.revotePending = false;
    r.next = caught ? 'guess' : 'score';
  }
  s.phase = 'tally';
  s.deadline = ctx.now + TALLY_MS;
  s.timerLabel = '';
}

function afterTally(s, ctx) {
  const r = s.round;
  clearTimer(s);
  if (r.next === 'revote') startRevote(s, ctx);
  else if (r.next === 'guess') startGuess(s, ctx);
  else finishRound(s, ctx);
}

/** Who rules on the guess: the human QM; otherwise the host seat (if it is a real artist), else the next artist after the fake. */
function pickJudge(s) {
  const r = s.round;
  if (r.qm && !isAbsent(s, r.qm)) return r.qm;
  if (s.host && r.artists.includes(s.host) && s.host !== r.fake && !isAbsent(s, s.host)) return s.host;
  return nextSeat(r.artists, r.fake, (p) => p !== r.fake && !isAbsent(s, p));
}

function startGuess(s, ctx) {
  const r = s.round;
  r.judge = pickJudge(s);
  r.guess = { text: '', mode: s.cfg.guess, correct: null, by: null };
  s.phase = 'guess';
  clearTimer(s);
  if (isAbsent(s, r.fake)) noAnswer(s, ctx);               // caught, then left: no answer (D4)
}

/** The caught fake is not at the table to answer: a wrong guess, said as such. */
function noAnswer(s, ctx) {
  const g = s.round.guess;
  g.text = '';
  g.correct = false;
  g.by = 'away';
  finishRound(s, ctx);
}

/** The fake typed (or skipped) its one guess. */
function submitGuess(s, ctx, textRaw) {
  const r = s.round;
  const text = tidy(textRaw).slice(0, 40);
  r.guess.text = text;
  if (!text) { r.guess.correct = false; r.guess.by = 'none'; finishRound(s, ctx); return; }
  if (matchesWord(text, r.word, r.alt)) { r.guess.correct = true; r.guess.by = 'match'; finishRound(s, ctx); return; }
  s.phase = 'judge';                                        // not the same words: the judge decides (synonyms, dialect)
}

function giveVerdict(s, ctx, correct, by) {
  const g = s.round.guess;
  g.correct = !!correct;
  g.by = by;
  finishRound(s, ctx);
}

/** Settle the round: points (points-v1) or just who won (none-v2), stats, the reveal object, game-end check. */
function finishRound(s, ctx) {
  const r = s.round;
  const caught = r.caught === true;
  const right = caught && r.guess?.correct === true;
  const outcome = !caught ? 'escaped' : right ? 'guess-right' : 'guess-wrong';
  const fakeSide = outcome !== 'guess-wrong';
  const scoring = s.cfg.scoring === 'none' ? 'none' : 'points';

  // who won this round: the fake (+ the human QM), or every real artist — whatever they voted
  const winners = fakeSide ? [r.fake, ...(r.qm ? [r.qm] : [])] : r.artists.filter((a) => a !== r.fake);
  s.wins ??= Object.fromEntries(s.order.map((id) => [id, 0]));
  for (const w of winners) s.wins[w] += 1;

  const deltas = [];
  if (scoring === 'points') {
    if (fakeSide) {
      deltas.push({ pid: r.fake, delta: FAKE_PTS, role: 'fake' });
      if (r.qm) deltas.push({ pid: r.qm, delta: FAKE_PTS, role: 'qm' });
    } else {
      for (const a of winners) deltas.push({ pid: a, delta: ARTIST_PTS, role: 'artist' });
    }
  }
  for (const d of deltas) s.scores[d.pid] += d.delta;

  const st = s.stats;
  st[r.fake].fake += 1;
  if (fakeSide) st[r.fake].fakeWins += 1;
  if (caught) st[r.fake].caught += 1;
  if (r.qm) st[r.qm].qm += 1;
  for (const [voter, target] of Object.entries(r.tally1.votes)) if (target === r.fake) st[voter].spotted += 1;

  const rv = {
    n: r.n, qm: r.qm, fake: r.fake, word: r.word, theme: r.theme, outcome, fakeSide, caught,
    tieRule: s.cfg.tieRule, judge: r.judge, scoring, winners: winners.slice(),
    round1: { counts: { ...r.tally1.counts }, top: r.tally1.top.slice(), votes: { ...r.tally1.votes }, abstained: r.tally1.abstained.slice() },
    round2: r.tally2
      ? { counts: { ...r.tally2.counts }, top: r.tally2.top.slice(), votes: { ...r.tally2.votes }, abstained: r.tally2.abstained.slice() }
      : null,
    guess: caught && r.guess ? { text: r.guess.text, mode: r.guess.mode, correct: r.guess.correct === true, by: r.guess.by } : null,
    deltas: deltas.map((d) => ({ ...d })),
    turns: r.strokes.map((x) => ({ pid: x.pid, lap: x.lap, kind: x.kind })),
    lines: [],
  };
  rv.lines = S.revealLines(rv, namer(s));
  r.rv = rv;
  s.lastFake = r.fake;
  const { lines, turns, ...compact } = rv;
  s.history.push(compact);

  const top = Math.max(...s.order.map((id) => s.scores[id]));
  s.ending = scoring === 'points' && s.cfg.endMode === 'target' ? top >= s.cfg.target : s.roundNo >= s.totalRounds;
  s.phase = 'result';
  r.seen = {};
  clearTimer(s);
}

/** 睇完 on the result (D3): once every present seat of the round has tapped, the next round (or the end). */
function markSeen(s, ctx, pids) {
  const r = s.round;
  r.seen ??= {};
  const who = readers(s);
  let any = false;
  for (const p of pids) {
    if (!who.includes(p) || r.seen[p]) continue;
    r.seen[p] = true;
    any = true;
  }
  if (any && who.every((p) => r.seen[p])) nextRound(s, ctx);
  return s;
}

function nextRound(s, ctx) {
  if (s.ending) { s.phase = 'over'; clearTimer(s); return; }
  startRound(s, ctx);
}

/**
 * Host 「呢鋪唔計」 (ACT.VOID_ROUND): a phone died mid-round. The round in play is thrown away — no points, no
 * stats, no streak — and a fresh one is dealt under the same number (research: void the round when the fake or an
 * artist drops; a QM who drops is replaced by the next in order). What was secret goes into the final recap.
 * A round that is already scored (result) or a finished game is left alone.
 */
function voidRound(s, ctx, why = 'host', who = null) {
  const r = s.round;
  if (!r || s.phase === 'result' || s.phase === 'over') return s;
  const dealt = !!r.word;
  s.history.push({
    n: r.n, voided: true, qm: r.qm, word: dealt ? r.word : null, theme: dealt ? r.theme : null, fake: dealt ? r.fake : null,
    phase: s.phase, why, absent: who,
  });
  startRound(s, ctx, true);
  return s;
}

const LIVE = new Set(['qm-input', 'deal', 'first', 'draw', 'vote', 'revote', 'tally', 'guess', 'judge']);

/**
 * Host `@absent` (D4): stop waiting on the seat for the rest of the game. Refused (unchanged state) when too few
 * would be left to draw, or once the game is over.
 */
function markAbsent(s, pid, ctx) {
  if (!s.order.includes(pid) || isAbsent(s, pid) || s.phase === 'over') return s;
  if (here(s, s.order).length - 1 < minPresent(s)) return s;
  s.absent = { ...(s.absent ?? {}), [pid]: true };
  const r = s.round;
  const live = LIVE.has(s.phase);
  // Decided already: the fake was caught (it only owes its guess), or it escaped and the tally is on screen.
  const decided = r.caught === true || (s.phase === 'tally' && r.next === 'score');
  // the question master, or a fake, before the round is decided: the round cannot go on — deal it again
  if (live && !decided && (pid === r.qm || pid === r.fake)) return voidRound(s, ctx, 'absent', pid);
  switch (s.phase) {
    case 'deal':
      if (here(s, r.artists).every((p) => r.acks[p])) startDraw(s, ctx);
      break;
    case 'draw':
      if (drawerOf(r) === pid) advanceTurn(s, ctx, 'away');
      break;
    case 'vote': case 'revote': {
      const v = r.vote;
      if (!(pid in v.votes)) v.voters = v.voters.filter((p) => p !== pid);    // a ballot already cast stays
      if (allVoted(v)) resolveVote(s, ctx);
      break;
    }
    case 'guess': case 'judge':
      if (pid === r.fake) noAnswer(s, ctx);
      else if (pid === r.judge) r.judge = pickJudge(s);
      break;
    case 'result': {
      const who = readers(s);
      if (who.every((p) => r.seen?.[p])) nextRound(s, ctx);
      break;
    }
    default:
  }
  return s;
}

/** Host `@present`: back at the table — from the next round, or for what is still open in this one. */
function markPresent(s, pid) {
  if (!s.order.includes(pid) || !isAbsent(s, pid) || s.phase === 'over') return s;
  const next = { ...s.absent };
  delete next[pid];
  s.absent = next;
  const r = s.round;
  // back in time for an open ballot it belongs to
  if ((s.phase === 'vote' || s.phase === 'revote') && r.artists.includes(pid) && !r.vote.voters.includes(pid)
    && (r.vote.round === 1 || !r.vote.candidates.includes(pid))) {
    r.vote.voters = r.artists.filter((p) => r.vote.voters.includes(p) || p === pid);
  }
  return s;
}

// ---------- cues ----------

function rawCue(s) {
  const r = s.round;
  if (!r) return null;
  const nm = namer(s);
  switch (s.phase) {
    case 'qm-input':
      return { id: `r${r.key ?? r.n}:qm`, text: S.cueQm(r.n, nm(r.qm), !!r.redo), minMs: 2500 };
    case 'deal':
      return { id: `r${r.key ?? r.n}:deal`, minMs: 4000, text: S.cueDeal({ n: r.n, theme: r.theme, qm: r.qm ? nm(r.qm) : '', redo: !!r.redo && !r.qm }) };
    case 'first':
      return { id: `r${r.key ?? r.n}:first`, text: S.cueFirst(nm(r.qm)), minMs: 2000 };
    case 'draw': {
      const len = r.turnOrder.length;
      const lap = lapOf(r);
      if (r.turn === 0) {
        return { id: `r${r.key ?? r.n}:draw`, minMs: 3000, text: S.cueDrawStart({ mode: s.cfg.draw, first: nm(r.turnOrder[0]), laps: s.cfg.laps }) };
      }
      const lapStart = r.turn % len === 0;
      if (s.cfg.draw === 'paper') {
        return { id: `r${r.key ?? r.n}:turn:${r.turn}`, minMs: 1200, text: S.cueTurn({ name: nm(drawerOf(r)), lap, laps: s.cfg.laps, lapStart }) };
      }
      if (lapStart) return { id: `r${r.key ?? r.n}:lap:${lap}`, minMs: 1500, text: S.cueLap({ lap, laps: s.cfg.laps, first: nm(drawerOf(r)) }) };
      return null;
    }
    case 'vote':
      return { id: `r${r.key ?? r.n}:vote`, text: S.cueVote(), minMs: 3000 };
    case 'revote':
      return { id: `r${r.key ?? r.n}:revote`, text: S.cueRevote(), minMs: 2500 };
    case 'tally': {
      const t = lastTally(r);
      return { id: `r${r.key ?? r.n}:tally:${t.round}`, minMs: 2500,
        text: S.cueTally({ top: t.top, caught: r.caught === true, fake: r.fake, revote: r.revotePending }, nm) };
    }
    case 'guess':
      return { id: `r${r.key ?? r.n}:guess`, text: S.cueGuess({ fake: r.fake, mode: s.cfg.guess }, nm), minMs: 3000 };
    case 'judge':
      return { id: `r${r.key ?? r.n}:judge`, text: S.cueJudge(nm(r.judge)), minMs: 2000 };
    case 'result':
      return { id: `r${r.key ?? r.n}:result`, text: S.cueResult(r.rv, nm), minMs: 4000 };
    default:
      return null;
  }
}

// ---------- actions ----------

/** The host (or the table) moves a step along without waiting for the seat. Never decides a vote for anyone. */
function skipStep(s, ctx) {
  const r = s.round;
  switch (s.phase) {
    case 'qm-input': dealWord(s, ctx, drawEntry(s, ctx)); break;
    case 'deal':
      for (const a of r.artists) r.acks[a] = true;
      startDraw(s, ctx);
      break;
    case 'first': beginDraw(s, ctx, r.artists[rint(ctx.rng, r.artists.length)]); break;
    case 'draw': advanceTurn(s, ctx, s.cfg.draw === 'paper' ? 'paper' : 'forfeit'); break;
    case 'vote': case 'revote':
      for (const p of r.vote.voters) if (!(p in r.vote.votes)) r.vote.votes[p] = null;   // an abstention, flagged in the reveal
      resolveVote(s, ctx);
      break;
    case 'tally': afterTally(s, ctx); break;
    case 'guess':
      if (s.cfg.guess === 'typed') submitGuess(s, ctx, ''); else giveVerdict(s, ctx, false, 'auto');
      break;
    case 'judge': giveVerdict(s, ctx, false, 'auto'); break;
    case 'result': nextRound(s, ctx); break;          // the host forces it while somebody is still reading (D3)
    default: break;
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
  if (a.type === ABSENT) return markAbsent(s, a.pid, ctx);
  if (a.type === PRESENT) return markPresent(s, a.pid);
  return s;   // ACT.AUTO is resolved by the session through autoAct()
}

function act(state, msg, ctx) {
  const s = state;
  const pid = msg?.pid;
  const a = msg?.action;
  if (!a || typeof a !== 'object' || typeof a.type !== 'string' || s.phase === 'over') return s;
  if (pid === HOST) return hostAct(s, a, ctx);
  if (typeof pid !== 'string' || !s.order.includes(pid) || isAbsent(s, pid)) return s;   // absent: until marked back

  const r = s.round;
  const isQm = pid === r.qm;
  const isArtist = r.artists.includes(pid);

  switch (a.type) {
    case 'qm-random':
      if (s.phase === 'qm-input' && isQm) {
        const e = drawEntry(s, ctx);
        r.draftSeq += 1;
        r.draft = { seq: r.draftSeq, theme: e.theme, word: e.word, alt: e.alt };
      }
      return s;
    case 'qm-auto':
      if (s.phase === 'qm-input' && isQm) dealWord(s, ctx, drawEntry(s, ctx));
      return s;
    case 'qm-set':
      if (s.phase === 'qm-input' && isQm && typeof a.theme === 'string' && typeof a.word === 'string') {
        const c = checkEntry(a.theme, a.word);
        if (!c.ok) return s;
        // keep the bank's aliases when the QM kept the 🎲 word as it was
        const alt = r.draft && normText(r.draft.word) === normText(c.word) ? r.draft.alt : [];
        dealWord(s, ctx, { theme: c.theme, word: c.word, alt });
      }
      return s;
    case 'ready':
      if (s.phase === 'deal' && isArtist && !r.acks[pid]) {
        r.acks[pid] = true;
        if (here(s, r.artists).every((p) => r.acks[p])) startDraw(s, ctx);
      }
      return s;
    case 'first':
      if (s.phase === 'first' && isQm && typeof a.target === 'string' && r.artists.includes(a.target) && !isAbsent(s, a.target)) beginDraw(s, ctx, a.target);
      return s;
    case 'stroke': {
      // 📱 phone mode: the Canvas finished one accepted stroke for the current drawer
      const len = typeof a.length === 'number' ? a.length : Number.NaN;
      if (s.phase === 'draw' && s.cfg.draw === 'phone' && pid === drawerOf(r) && Number.isFinite(len) && len >= STROKE_SLACK) {
        advanceTurn(s, ctx, 'ink');
      }
      return s;
    }
    case 'done':
      // 📝 paper mode: the drawer (or the human QM keeping the table moving) says the stroke on the real paper is done
      if (s.phase === 'draw' && s.cfg.draw === 'paper' && (pid === drawerOf(r) || isQm)) advanceTurn(s, ctx, 'paper');
      return s;
    case 'skip':
      // the drawer gives this stroke up (their slot is used; no second chance)
      if (s.phase === 'draw' && pid === drawerOf(r)) advanceTurn(s, ctx, 'forfeit');
      return s;
    case 'vote': {
      if ((s.phase === 'vote' || s.phase === 'revote') && r.vote.voters.includes(pid) && !(pid in r.vote.votes)) {
        const t = a.target;
        if (t === null || (typeof t === 'string' && r.vote.candidates.includes(t) && t !== pid)) {
          r.vote.votes[pid] = t;
          if (allVoted(r.vote)) resolveVote(s, ctx);
        }
      }
      return s;
    }
    case 'guess':
      if (s.phase === 'guess' && s.cfg.guess === 'typed' && pid === r.fake && typeof a.text === 'string') submitGuess(s, ctx, a.text);
      return s;
    case 'verdict':
      if (typeof a.correct === 'boolean' && pid === r.judge
        && ((s.phase === 'guess' && s.cfg.guess === 'spoken') || s.phase === 'judge')) giveVerdict(s, ctx, a.correct, 'judge');
      return s;
    case 'next': {
      // 睇完 (D3). `seats`: the other seats of a passed-round phone, which reads the result once for all of them
      if (s.phase !== 'result' || !(isArtist || isQm) || r.seen?.[pid]) return s;
      const also = Array.isArray(a.seats) ? a.seats.filter((x) => typeof x === 'string') : [];
      return markSeen(s, ctx, [pid, ...also]);
    }
    default:
      return s;
  }
}

// ---------- engine ----------

/**
 * `hostPid` = the seat on the host phone (it judges the fake's guess when the app is the question master).
 * `carry`   = the last game's result().carry: { lastFake, nextQm } — the QM rotation carries on where the last
 *             game of 假畫家 stopped, and antiStreak also covers the first round. Junk is ignored.
 */
function setup({ players, config: cfg, rng, now, bag, hostPid, carry }) {
  const order = seatOrder(players);
  const n = order.length;
  const c = norm(cfg, n);
  const seatIn = (x) => (typeof x === 'string' && order.includes(x) ? x : null);
  const nextQm = isObj(carry) ? seatIn(carry.nextQm) : null;
  const s = {
    game: 'fake-artist', cfg: c,
    players: players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, color: p.color })),
    order, host: seatIn(hostPid),
    pens: assignPens(order.map((id) => players.find((p) => p.id === id))),
    phase: 'deal', deadline: null, timerLabel: '',
    roundNo: 0, started: 0, totalRounds: totalRoundsFor(c, n), ending: false,
    // the first QM: where the last game's rotation stopped, else random; then it goes left
    qmPtr: c.qm === 'player' ? (nextQm ? order.indexOf(nextQm) : rint(rng, n)) : -1,
    inkEpoch: 1,
    scores: Object.fromEntries(order.map((id) => [id, 0])),
    wins: Object.fromEntries(order.map((id) => [id, 0])),
    stats: Object.fromEntries(order.map((id) => [id, { fake: 0, fakeWins: 0, caught: 0, qm: 0, spotted: 0 }])),
    lastFake: isObj(carry) ? seatIn(carry.lastFake) : null, history: [], cueAck: '', round: null,
    absent: {},              // pid → true: the host marked the seat absent (public, D4)
  };
  startRound(s, { rng, now, bag });
  return s;
}

function advance(state, ctx) {
  const s = state;
  if (s.deadline == null) return s;
  if (typeof ctx?.now === 'number' && ctx.now < s.deadline) return s;
  if (s.phase === 'draw') advanceTurn(s, ctx, s.cfg.draw === 'paper' ? 'paper' : 'forfeit');   // a timed-out stroke is given up
  else if (s.phase === 'tally') afterTally(s, ctx);
  return s;
}

function canInk(state, pid) {
  const s = state;
  return s.phase === 'draw' && s.cfg.draw === 'phone' && typeof pid === 'string' && pid === drawerOf(s.round);
}

function view(state, pid) {
  const s = state;
  const r = s.round;
  const cfg = s.cfg;
  const seat = typeof pid === 'string' && s.order.includes(pid) ? pid : null;
  const isQm = seat !== null && seat === r.qm;
  const isArtist = seat !== null && r.artists.includes(seat);
  const isFake = isArtist && seat === r.fake;
  const themeKnown = s.phase !== 'qm-input';
  const done = s.phase === 'result' || s.phase === 'over';
  const fakeShown = done || r.caught === true;            // public once caught (or once the round is over)
  const drawer = s.phase === 'draw' ? drawerOf(r) : null;

  const v = {
    me: seat,
    phase: s.phase,
    title: `第 ${r.n}${s.totalRounds ? `/${s.totalRounds}` : ''} 輪`,
    subtitle: themeKnown ? `主題：${r.theme}${s.phase === 'draw' ? ` · 第 ${lapOf(r)}/${cfg.laps} 圈` : ''}` : `${nameOf(s, r.qm)} 出題`,
    round: { n: r.n, total: s.totalRounds, key: r.key ?? r.n, redo: !!r.redo },
    mode: { draw: cfg.draw, qm: cfg.qm, laps: cfg.laps, tieRule: cfg.tieRule, guess: cfg.guess, scoring: cfg.scoring, endMode: cfg.endMode, target: cfg.target, first: cfg.first },
    qm: r.qm,
    artists: r.artists.slice(),
    seats: s.order.slice(),
    pens: { ...pensOf(s) },
    scores: { ...s.scores },
    wins: { ...winsOf(s) },
    absent: s.order.filter((p) => isAbsent(s, p)),     // public (D4): shown as 💤, never waited on
    theme: themeKnown ? r.theme : null,
    fake: fakeShown ? r.fake : null,
    myRole: isQm ? 'question-master' : isArtist && themeKnown ? (isFake ? 'fake' : 'artist') : null,
    mine: null,
    draft: null,
    last: !!s.ending,
  };
  if (s.deadline != null) { v.deadline = s.deadline; v.timerLabel = s.timerLabel; }

  // the card: the same shape for the fake and the real artists (the fake's word is null)
  if (themeKnown && isQm) v.mine = { role: 'question-master', theme: r.theme, word: r.word, fake: r.fake };
  else if (themeKnown && isArtist) v.mine = { role: isFake ? 'fake' : 'artist', theme: r.theme, word: isFake ? null : r.word };
  if (s.phase === 'qm-input' && isQm && r.draft) v.draft = { seq: r.draft.seq, theme: r.draft.theme, word: r.draft.word };

  if (s.phase === 'deal') {
    const looking = here(s, r.artists);
    v.ready = { done: looking.filter((p) => r.acks[p]).length, total: looking.length, mine: seat !== null && !!r.acks[seat] };
  }
  if (s.phase === 'first') v.first = { candidates: here(s, r.artists) };
  // the result: who has tapped 睇完, of the round's seats at the table (D3)
  if (s.phase === 'result') v.seen = { who: readers(s).filter((p) => r.seen?.[p]), total: readers(s).length };

  if (r.turnOrder.length) {
    const counts = {};
    for (const p of r.turnOrder) counts[p] = r.strokes.filter((x) => x.pid === p && x.kind !== 'away').length;
    v.draw = {
      mode: cfg.draw, laps: cfg.laps, total: strokesTotal(s), turn: r.turn, order: r.turnOrder.slice(),
      current: drawer, lap: drawer ? lapOf(r) : cfg.laps, counts, minLen: MIN_STROKE_LEN,
      canDraw: seat !== null && drawer === seat && cfg.draw === 'phone',
      canDone: cfg.draw === 'paper' && seat !== null && (drawer === seat || isQm) && s.phase === 'draw',
    };
  }

  if ((s.phase === 'vote' || s.phase === 'revote') && r.vote) {
    const vt = r.vote;
    const voted = seat !== null && seat in vt.votes;
    v.vote = {
      round: vt.round, candidates: vt.candidates.slice(), voters: vt.voters.slice(),
      done: vt.voters.filter((p) => p in vt.votes).length, total: vt.voters.length,
      canVote: seat !== null && vt.voters.includes(seat) && !voted,
    };
    if (voted) v.vote.myVote = vt.votes[seat];           // null = abstained (autoAct); a pid otherwise
  }

  if (r.tally1 && ['tally', 'guess', 'judge', 'result', 'over'].includes(s.phase)) {
    const pub = (t) => (t ? { counts: { ...t.counts }, top: t.top.slice(), votes: { ...t.votes }, abstained: t.abstained.slice() } : null);
    v.tally = { round1: pub(r.tally1), round2: pub(r.tally2), caught: r.caught, revote: r.revotePending, tieRule: cfg.tieRule };
  }

  let canGuess = false;
  let canJudge = false;
  if ((s.phase === 'guess' || s.phase === 'judge') && r.guess) {
    const typed = cfg.guess === 'typed';
    canGuess = s.phase === 'guess' && typed && seat === r.fake;
    canJudge = seat === r.judge && (s.phase === 'judge' || !typed);
    v.guess = {
      mode: cfg.guess, judge: r.judge, stage: s.phase === 'guess' && typed ? 'fake' : 'judge',
      text: r.guess.text || null, canGuess, canJudge,
    };
    if (seat === r.judge) v.guess.word = r.word;          // the judge never is the fake, so the fake never gets the word here
  }

  if (done && r.rv) v.reveal = JSON.parse(JSON.stringify(r.rv));

  v.hint = S.hintFor({
    phase: s.phase,
    // a seat that sits this round out (it was away when it was dealt) watches like the table
    role: seat === null ? 'table' : isQm ? 'qm' : isArtist ? 'artist' : 'table',
    away: seat !== null && isAbsent(s, seat),
    seen: seat !== null && !!r.seen?.[seat],
    qmName: r.qm ? nameOf(s, r.qm) : '',
    drawMode: cfg.draw,
    drawerIsMe: seat !== null && seat === drawer,
    drawerName: drawer ? nameOf(s, drawer) : '',
    acked: seat !== null && !!r.acks[seat],
    voted: !!v.vote && seat !== null && !v.vote.canVote && v.vote.voters.includes(seat),
    canVote: !!v.vote?.canVote,
    canGuess, canJudge,
    isFake: isFake && fakeShown,
    last: !!s.ending,
  });
  return v;
}

function cue(state) {
  const c = rawCue(state);
  return c && c.id !== state.cueAck ? c : null;
}

function focus(state) {
  const s = state;
  const r = s.round;
  switch (s.phase) {
    case 'qm-input': case 'first': return { pids: [r.qm] };
    case 'deal': return { pids: here(s, r.artists).filter((p) => !r.acks[p]) };
    case 'draw': return { pids: [drawerOf(r)] };
    case 'vote': case 'revote': return { pids: r.vote.voters.filter((p) => !(p in r.vote.votes)) };
    case 'guess': return { pids: [s.cfg.guess === 'typed' ? r.fake : r.judge] };
    case 'judge': return { pids: [r.judge] };
    default: return null;
  }
}

function legalActions(state, pid) {
  const s = state;
  if (s.phase === 'over' || typeof pid !== 'string' || !s.order.includes(pid) || isAbsent(s, pid)) return [];
  const r = s.round;
  const isQm = pid === r.qm;
  const isArtist = r.artists.includes(pid);
  const out = [];
  switch (s.phase) {
    case 'qm-input':
      if (isQm) out.push({ type: 'qm-random' }, { type: 'qm-set', theme: '動物', word: '貓' }, { type: 'qm-auto' });
      break;
    case 'deal':
      if (isArtist && !r.acks[pid]) out.push({ type: 'ready' });
      break;
    case 'first':
      if (isQm) for (const a of here(s, r.artists)) out.push({ type: 'first', target: a });
      break;
    case 'draw':
      if (pid === drawerOf(r) && s.cfg.draw === 'phone') out.push({ type: 'stroke', length: 120 });
      if (s.cfg.draw === 'paper' && (pid === drawerOf(r) || isQm)) out.push({ type: 'done' });
      break;
    case 'vote': case 'revote': {
      const v = r.vote;
      if (v.voters.includes(pid) && !(pid in v.votes)) for (const t of v.candidates) if (t !== pid) out.push({ type: 'vote', target: t });
      break;
    }
    case 'guess':
      if (s.cfg.guess === 'typed') {
        if (pid === r.fake) out.push({ type: 'guess', text: r.word }, { type: 'guess', text: '（亂估）' });
      } else if (pid === r.judge) out.push({ type: 'verdict', correct: true }, { type: 'verdict', correct: false });
      break;
    case 'judge':
      if (pid === r.judge) out.push({ type: 'verdict', correct: true }, { type: 'verdict', correct: false });
      break;
    case 'result':
      if ((isArtist || isQm) && !r.seen?.[pid]) out.push({ type: 'next' });
      break;
    default: break;
  }
  return out;
}

/** What the host does for a stalled seat. Never decides a vote and never hands the fake a win by itself. */
function autoAct(state, pid) {
  const s = state;
  if (s.phase === 'over' || !s.order.includes(pid) || isAbsent(s, pid)) return null;
  const r = s.round;
  switch (s.phase) {
    case 'qm-input': return pid === r.qm ? { type: 'qm-auto' } : null;
    case 'deal': return r.artists.includes(pid) && !r.acks[pid] ? { type: 'ready' } : null;
    case 'first': return pid === r.qm ? { type: 'first', target: here(s, r.artists)[0] } : null;
    case 'draw':
      if (pid !== drawerOf(r)) return null;
      return s.cfg.draw === 'paper' ? { type: 'done' } : { type: 'skip' };
    case 'vote': case 'revote':
      return r.vote.voters.includes(pid) && !(pid in r.vote.votes) ? { type: 'vote', target: null } : null;
    case 'guess':
      if (s.cfg.guess === 'typed') return pid === r.fake ? { type: 'guess', text: '' } : null;
      return pid === r.judge ? { type: 'verdict', correct: false } : null;
    case 'judge': return pid === r.judge ? { type: 'verdict', correct: false } : null;
    case 'result': return (r.artists.includes(pid) || pid === r.qm) && !r.seen?.[pid] ? { type: 'next' } : null;
    default: return null;
  }
}

/**
 * Is the table really waiting on this seat? (Stall detection: 「阿明斷咗線 — 代佢做／再等」.) The seats in focus: the
 * QM while typing / picking, artists who have not looked, the drawer, voters still to vote, the guesser or the
 * judge — and, on the result, a present seat that has not tapped 睇完 yet (D3). Never during the tally linger.
 */
function blocking(state, pid) {
  const s = state;
  if (typeof pid !== 'string' || isAbsent(s, pid)) return false;
  if (s.phase === 'result') return readers(s).includes(pid) && !s.round.seen?.[pid];
  const f = focus(s);
  return !!f && f.pids.includes(pid);
}

/**
 * Would 呢鋪唔計 (@void-round) do anything right now? A scored round (result) or a finished game is left alone, and
 * the host should hear why instead of 「呢個遊戲唔支援」. Optional hook for the shell:
 * `engine.canVoid?.(state)` → { ok: true } | { ok: false, message } (the shape of a refused lobby op).
 */
function canVoid(state) {
  const s = state;
  // the result screen's button reads 睇總結 when this round decided the game (view.last)
  if (s.phase === 'result') return { ok: false, message: '呢輪已經計咗分，大家㩒「睇完」就得' };
  if (s.phase === 'over' || !s.round) return { ok: false, message: '遊戲已經完咗' };
  return { ok: true };
}

function result(state) {
  const s = state;
  if (s.phase !== 'over') return null;
  const nm = namer(s);
  const scoring = s.cfg.scoring === 'none' ? 'none' : 'points';
  const tally = scoring === 'none' ? winsOf(s) : s.scores;   // no points: the most rounds won takes the evening
  const top = Math.max(...s.order.map((id) => tally[id]));
  const winners = s.order.filter((id) => tally[id] === top);
  const lines = [];

  for (const h of s.history) lines.push(...S.roundBlock(h, nm, s.totalRounds));

  const best = (key, label) => {
    const max = Math.max(...s.order.map((id) => s.stats[id][key]));
    if (max <= 0) return;
    const ids = s.order.filter((id) => s.stats[id][key] === max);
    lines.push(`${label}：${ids.map(nm).join('、')}（${max} 次）`);
  };
  best('fakeWins', '🕶️ 最勁假畫家（做假畫家贏）');
  best('spotted', '🔍 最醒目（一眼睇穿假畫家）');

  return {
    winners,
    summary: S.summaryLine(winners, top, nm, scoring),
    lines,
    points: scoring === 'none' ? {} : { ...s.scores },
    // for the next game of 假畫家 (the room hands it to setup; host only, never shown): rotation + anti-streak
    carry: { lastFake: s.lastFake, nextQm: s.cfg.qm === 'player' && s.qmPtr >= 0 ? s.order[s.qmPtr] : null },
  };
}

export const engine = { setup, act, advance, view, cue, focus, blocking, autoAct, legalActions, result, canInk, canVoid };
