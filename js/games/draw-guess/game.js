// ============================================================
// 你畫我猜 (draw-guess) — PURE module: meta, rules, config, engine.
// No DOM, no Math.random, no Date. Flow and wording: docs/games/draw-guess.md.
// Rules source: docs/research/draw-guess.md (its "## Verification" section overrides earlier text).
//
// One game = a queue of turns. Every turn:  choose → play → reveal   (then the next turn, or `over`).
//   choose     the drawer sees 3 words (easy / medium / hard), picks one (one re-roll; auto-picks the medium card)
//   play       the clock runs; the word is on the drawer's phone only; the length mask and hints are public
//   reveal     the word, who got it, the points; foul flags and late accepts stay open for a few seconds
//   standings  5 s leaderboard after every full cycle (everybody / every team drew once), not after the last turn
//
// Clock model (so host pause works without the engine knowing about pause): the ONLY absolute time in the
// state is `state.deadline` — the next thing that must happen (a hint event, the end of the turn, the end of
// a grace / buzzer window). Everything else is a duration relative to it (`turn.then`).
// A team foul flag freezes that clock (`turn.ruling`, deadline null) until the host rules.
// ============================================================

import { HOST, ACT, rint, sample, shuffle, seatOrder } from '../../core/engine-kit.js?v=20261004005209';
import * as S from './script.js?v=20261004005209';
import { analyse } from './judge.js?v=20261004005209';

// ---------- constants ----------

const CHOOSE_MS = 20000;        // research says 12 s; on a shared phone the hand-over and the pass gate eat into it, so 20
const GRACE_MS = 3000;          // after the first accept: the drawer may add co-winners or undo
const BUZZER_MS = 2000;         // shout mode: a late tap right after the buzzer still counts (r = 0)
const REVEAL_MS = 7000;
const REVEAL_PASS_MS = 10000;   // one phone (re-run N4): the reveal is the table's only big look at the answer and picture,
                                // and the 「擺返中間」 card sits in front of it first
const STANDINGS_MS = 5000;      // the leaderboard between cycles
const LATE_MS = 5000;           // foul flags and typed late-accepts stay open this long into the reveal
const EXTEND_MS = 30000;
const MAX_TOTAL_MS = 600000;
const MAX_GUESS_LEN = 30;       // code points
const GUESS_GAP_MS = 700;
const GUESS_BURST = 6;          // more than 6 in 10 s locks the input for 5 s
const BURST_WINDOW_MS = 10000;
const LOCK_MS = 5000;
const MAX_GUESSES = 60;         // per player per turn
const HINT_AT = { cat: 0.25, r1: 0.5, r2: 0.75 };
const LEVELS = [1, 2, 3];
const MULT2 = { 1: 2, 2: 3, 3: 4 };   // tier multiplier ×2 (1.0 / 1.5 / 2.0): all scoring stays in integers
const FEED_VIEW = 30;           // guesses shown in a view
const GAP = /^[\s\-－–—]$/u;

// The categories of the draw bank (js/data/draw-words.js). They feed the lobby's category filter.
// tests/draw-guess.test.mjs fails if the bank grows a category that is missing here.
export const CATEGORIES = ['陸上動物', '海洋生物', '雀鳥', '昆蟲與細小生物', '恐龍與遠古生物', '寵物', '中式食物', '西式食物',
  '日本食物', '港式小食', '甜品', '水果', '蔬菜', '飲品', '屋企用品', '廚房用具', '浴室用品', '文具', '電器與科技', '玩具',
  '交通工具', '建築與地方', '世界地標', '太空', '天氣與大自然', '植物與花', '衣服與飾物', '身體與表情', '職業', '運動',
  '運動用品', '樂器', '香港地道', '日本', '新年', '中秋與端午', '聖誕節', '萬聖節', '動作', '童話與神話', '卡通與遊戲角色',
  '魔法與奇幻', '海灘與露營', '成語', '歇後語與俗語', '抽象', '電影與故事場面'];

// Only used when the bank cannot be loaded at all (offline first run, empty bank): a turn must never die.
const FALLBACK = [
  { w: '蘋果', alt: ['苹果', 'apple'], level: 1, cat: '水果' }, { w: '貓', alt: ['貓咪', '貓仔'], level: 1, cat: '寵物' },
  { w: '太陽', alt: ['太阳', '日頭'], level: 1, cat: '天氣與大自然' }, { w: '雨傘', alt: ['遮'], level: 1, cat: '屋企用品' },
  { w: '摩天輪', alt: ['摩天轮'], level: 2, cat: '建築與地方' }, { w: '打邊爐', alt: ['火鍋', '火锅'], level: 2, cat: '中式食物' },
  { w: '自動販賣機', alt: ['販賣機', '自動售賣機'], level: 2, cat: '日本' }, { w: '新幹線', alt: ['子彈列車'], level: 2, cat: '日本' },
  { w: '守株待兔', alt: [], level: 3, cat: '成語' }, { w: '畫蛇添足', alt: ['画蛇添足'], level: 3, cat: '成語' },
  { w: '井底之蛙', alt: [], level: 3, cat: '成語' }, { w: '一石二鳥', alt: ['一石二鸟'], level: 3, cat: '成語' },
];

// ---------- meta ----------

export const meta = {
  id: 'draw-guess',
  name: '你畫我猜',
  emoji: '✏️',
  accent: '#ff6f91',
  players: [3, 12],
  minutes: [15, 30],
  narration: 'optional',
  paperMode: true,
  singleDevice: 'partial',
  banks: ['draw'],
  css: true,
  blurb: '一個人畫，其他人搶住估，畫得越快越高分。',
};

// ---------- rules text ----------

export const rules = {
  quick: [
    '每輪一個人畫，其他人估。只有畫家睇到個詞。',
    '畫畫唔准講嘢、寫字、寫數字，亦唔准扮動作。',
    '時間愈耐提示愈多：先俾字數，跟住類別，再揭開一兩隻字。',
    '估得愈快分愈高；估錯唔扣分。畫家嘅分跟估中嘅人走。',
    '每個人輪流畫，最後最高分贏。',
    '分隊玩：畫家隊友估中就得分，對手唔准估。',
  ],
  // `team` is a colour, not a side: nobody is 好人 or 壞人 in a drawing game. Text: 「做乜：… 點贏：…」 (the 💡 sheet splits it).
  roles: [
    { id: 'drawer', name: '畫家', emoji: '🎨', team: '#ff6f91',
      text: '做乜：三個詞（易／中／難）揀一個嚟畫，唔准講嘢、寫字同數字。講出口：有人講啱就㩒佢個名；打字：系統自動核對，漏咗可以㩒 ✔。'
        + '點贏：估中嘅人愈多、愈快，你嘅分就愈高；冇人估中就冇分。' },
    { id: 'guesser', name: '估嘅人', emoji: '🙋', team: '#4aa3ff',
      text: '做乜：睇住畫同提示搶住估。講出口就大聲講，畫家會㩒你個名；打字就喺格仔打。估中咗唔好講出答案。'
        + '點贏：愈快估中分愈高，估錯唔扣分；最後總分最高贏。' },
    { id: 'rival', name: '對手隊員', emoji: '🛡️', team: '#94a3b8',
      text: '做乜：分隊玩先有。對方隊畫嗰輪你唔准估，睇住佢有冇犯規，有就㩒 🚩，等主持裁決。'
        + '點贏：自己隊畫嗰輪快啲估中，隊伍總分最高就贏。' },
  ],
  sections: [
    { title: '玩法流程', body:
      '1. 輪到畫家：手機派 3 張詞（易／中／難），揀 1 張；唔鍾意可以換一批（得一次）。\n'
      + '2. 開始計時。畫家用紙筆或者手機畫板畫，其他人睇住估。\n'
      + '3. 估中就計分；時間到都冇人估中，今輪冇分。\n'
      + '4. 揭曉答案、得分，跟住下一位畫。每個人畫完一圈會睇一次排名，最後最高分贏。' },
    { title: '提示', body:
      '一開始只睇到字數（每隻字一格）。\n'
      + '・過咗 1/4 時間：出現類別。\n'
      + '・過咗 1/2 時間：揭開一隻字（2 隻字或以上嘅詞）。\n'
      + '・過咗 3/4 時間：再揭開一隻字（4 隻字或以上嘅詞）。\n'
      + '提示唔會直接扣分，時間愈耐，估中嘅分自然愈低。' },
    { title: '計分', body:
      '估中嘅人：難度 ×（10 + 20 × 剩餘時間比例）。簡單 10–30、中等 15–45、困難 20–60；愈快愈高。\n'
      + '畫家：估中者平均分 ×（一半 + 一半 × 估中人數／可估人數），冇人估中就 0 分。\n'
      + '講出口：畫家㩒第一個名之後有 3 秒確認，可以加人（同一個分數）或者撤銷。時間到之後仲有 2 秒補㩒，啱啱講中都計（最低分）。\n'
      + '放棄：今輪大家 0 分，個詞當用咗。犯規成立（至少 2 人而且過半人舉報）：畫家 0 分，估中嘅人保留分數。\n'
      + '同分：先比估中次數，再比畫畫得分，仲係同分就一齊贏。' },
    { title: '打字估', body:
      '靜嘅地方（例如新幹線）可以打字估。系統會對答案同同義詞，唔理空格、標點、大細寫、全形半形同簡繁體；'
      + '打得好接近會顯示「好接近！」，其他人睇唔到你打咗乜。估中咗嘅人唔可以再打。\n'
      + '要一部手機一個人；一部手機輪流玩就用講出口。' },
    { title: '分隊玩（Pictionary 玩法）', body:
      '4 人或以上可以分 2–4 隊（座位交錯分，或者隨機分）。輪到邊隊，就由隊內一人畫，只有隊友可以估。\n'
      + '估中：全隊得 1 分（開咗「難詞多分」就按難度 1／2／3 分）；估唔中冇分冇罰。每隊畫嘅次數一樣，總分最高嘅隊贏。\n'
      + '對手見到犯規就㩒 🚩：計時即刻停，主持判 — 成立就今輪冇分，唔成立就繼續。' },
    { title: '畫畫規矩', body:
      '唔准：講嘢或者做口形、寫字（包括中文字、數字、假名）、畫格仔代表字數、用耳仔符號扮「同音」、做動作。\n'
      + '可以：箭咀、動態線、將一個詞拆開逐隻字畫、諧音（畫「蘋果」代表「平安」）、畫相關嘅嘢。\n'
      + '開始前大家講好數字、箭咀同諧音算唔算。' },
    { title: '用一部手機玩', body:
      '一部手機輪流：用講出口（一部手機冇得打字估）。輪到邊個畫，先交俾佢揀詞，揀好就將部手機平放喺枱中間，'
      + '畫家㩒一下開始先計時；畫家喺手機上畫（或者喺紙上畫），其他人睇住字數同提示，有人估啱，畫家就㩒佢個名。\n'
      + '個詞收埋：要拎起部機，㩒住先睇到，放手即刻冚返。部手機未交到畫家手上，揀詞同畫畫嘅時間都唔會行。\n'
      + '見到犯規就當面講，主持可以作廢今輪。' },
    { title: '小貼士', body:
      '・畫家：先畫最特別嘅特徵，唔好急住畫細節。\n'
      + '・估嘅人：睇住類別同字數估，估錯唔扣分，放膽估。\n'
      + '・成語同抽象詞：畫字面嗰個畫面（井底之蛙就畫隻青蛙喺井底）。' },
  ],
};

// ---------- config ----------

export const cyclesFor = (n) => (n <= 3 ? 3 : n <= 6 ? 2 : 1);

/** Team sizes for n players in `teams` teams (alternate dealing: the first teams get the extra seat). */
export function teamSizes(n, teams) {
  return Array.from({ length: teams }, (_, i) => Math.floor(n / teams) + (i < n % teams ? 1 : 0));
}

/** Pictionary-style draws per team: 2 teams 5 (4 when every team has only 2 players), 3 teams 4, 4 teams 3. */
export function teamRoundsFor(n, teams) {
  if (teams === 2) return Math.max(...teamSizes(n, 2)) <= 2 ? 4 : 5;
  return teams === 3 ? 4 : 3;
}

const ENUMS = {
  drawMode: ['paper', 'canvas'],
  guessMode: ['shout', 'typed'],
  teamMode: ['ffa', 'teams'],
  teamAssign: ['alternate', 'shuffle'],
  strictness: ['strict', 'standard', 'loose'],
};
const RANGES = { teams: [2, 4], teamRounds: [0, 8], cycles: [0, 5] };
const BOOLS = ['hints', 'starsAsPoints', 'passPhone'];
const SECONDS = [30, 180];

const DEFAULTS = Object.freeze({
  drawMode: 'canvas', guessMode: 'shout', teamMode: 'ffa', teams: 2, teamAssign: 'alternate', teamRounds: 0, cycles: 0,
  roundSeconds: 0, hints: true, strictness: 'standard', starsAsPoints: false,
  topics: Object.freeze({ cats: Object.freeze([]), levels: Object.freeze([]) }),
  // hidden (no field): one phone holds every seat — set by config.defaults from env.singleDevice, read by the cues (#3, #16)
  passPhone: false,
});

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const allStrings = (a) => Array.isArray(a) && a.every((c) => typeof c === 'string');

function asInt(v) {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof x === 'number' && Number.isInteger(x) ? x : NaN;
}

const levelList = (v) => {
  const list = isObj(v) ? (v.levels ?? v.level) : null;
  return Array.isArray(list) ? list : [];
};
const levelsOk = (list) => list.every((x) => LEVELS.includes(asInt(x)));

function catsOf(v) {
  if (Array.isArray(v)) return allStrings(v) ? v : [];
  if (isObj(v)) {
    const list = Array.isArray(v.cats) ? v.cats : v.categories;
    return allStrings(list) ? list : [];
  }
  return [];
}

function keyOk(key, v) {
  if (key in ENUMS) return ENUMS[key].includes(String(v));
  if (key in RANGES) { const x = asInt(v); return x >= RANGES[key][0] && x <= RANGES[key][1]; }
  if (BOOLS.includes(key)) return typeof v === 'boolean';
  if (key === 'roundSeconds') { const x = asInt(v); return x === 0 || (x >= SECONDS[0] && x <= SECONDS[1]); }
  if (key === 'topics') {
    if (Array.isArray(v)) return allStrings(v);
    return isObj(v) && ['cats', 'categories'].every((k) => v[k] === undefined || allStrings(v[k]))
      && levelsOk(levelList(v));
  }
  return false;
}

/** Fill gaps and coerce (the shell hands back whatever the control holds). Never throws. */
function clean(cfg) {
  const c = isObj(cfg) ? cfg : {};
  const out = { ...DEFAULTS, topics: { cats: [], levels: [] } };
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in c) || !keyOk(key, c[key])) continue;
    if (key in ENUMS) out[key] = String(c[key]);
    else if (key in RANGES || key === 'roundSeconds') out[key] = asInt(c[key]);
    else if (key === 'topics') {
      out[key] = {
        cats: catsOf(c[key]).slice(),
        levels: [...new Set(levelList(c[key]).map(asInt))].sort(),
      };
    } else out[key] = c[key];
  }
  return out;
}

/** The settings the engine actually uses for n players: auto values resolved. */
function resolve(cfg, n) {
  const c = clean(cfg);
  if (c.teamMode === 'teams' && n < 4) c.teamMode = 'ffa';
  const teams = c.teamMode === 'teams' ? Math.max(2, Math.min(c.teams, Math.floor(n / 2), 4)) : 0;
  c.teams = teams || c.teams;
  c.seconds = c.roundSeconds > 0 ? c.roundSeconds
    : teams ? (c.guessMode === 'typed' ? 80 : 60) : (c.guessMode === 'typed' ? 100 : 80);
  c.cycles = c.cycles || cyclesFor(n);
  c.teamRounds = c.teamRounds || (teams ? teamRoundsFor(n, teams) : 0);
  c.totalTurns = teams ? teams * c.teamRounds : n * c.cycles;
  return c;
}

/** 「6 人：每人畫 2 次，共 12 輪，大約 22 分鐘 — 最啱玩嘅人數」 */
function headcountLine(n, m) {
  const why = n === 3 ? '人少，每人要畫 3 次先夠玩' : n <= 6 ? '最啱玩嘅人數' : n <= 9 ? '人多，每人畫一次，唔使等好耐' : '10 人或以上，分隊玩會更緊湊';
  return `${n} 人：每人畫 ${m.cycles} 次，共 ${m.totalTurns} 輪，大約 ${minutesFor(m)} 分鐘 — ${why}。`;
}

const minutesFor = (m) => Math.max(1, Math.round((m.totalTurns * (m.seconds + 30)) / 60));

/** Does a draw-bank entry fit the `topics` value (categories + tiers)? Shared by the engine and the lobby's 已用 / 總數. */
export function topicMatch(topics, e) {
  if (!e || typeof e !== 'object') return false;
  const cats = catsOf(topics);
  const levels = levelList(topics).map(asInt).filter((x) => LEVELS.includes(x));
  return (!cats.length || cats.includes(e.cat)) && (!levels.length || levels.includes(e.level));
}

const ONE_PHONE_TYPED = '一部手機冇得打字估：其他人冇得打字，請揀「講出口」。';

const LABEL = {
  drawMode: '畫喺邊', guessMode: '點樣估', teamMode: '玩法', teams: '幾多隊', teamAssign: '點分隊', teamRounds: '每隊畫幾次',
  cycles: '每人畫幾次', roundSeconds: '每輪時間', hints: '提示', strictness: '打字估嘅嚴格度', starsAsPoints: '難詞多分',
  topics: '詞庫類別', passPhone: '一部手機',
};

export const config = {
  /** `env.singleDevice` (the Room passes it): one phone holds every seat, so typed guessing is never kept. */
  defaults(n, prev, env) {
    const out = clean(prev);
    if (out.teamMode === 'teams') {
      if (n < 4) out.teamMode = 'ffa';
      else out.teams = Math.max(2, Math.min(out.teams, Math.floor(n / 2), 4));
    }
    if (env && env.singleDevice && out.guessMode === 'typed') out.guessMode = 'shout';   // one phone cannot type for everybody
    out.passPhone = !!(env && env.singleDevice);   // hidden: the cues say 「部手機擺喺中間」 on one phone (#16)
    return out;
  },

  /** `env` is optional ({ singleDevice }): typed guessing on one phone is an error (#21, nobody else can type); without
   *  env a typed game gets the generic one-phone-each warning. */
  validate(cfg, n, env) {
    const warnings = [];
    if (!Number.isInteger(n) || n < meta.players[0] || n > meta.players[1]) {
      return { ok: false, message: `你畫我猜要 ${meta.players[0]}–${meta.players[1]} 個人玩。`, warnings };
    }
    const c = isObj(cfg) ? cfg : {};
    for (const key of Object.keys(DEFAULTS)) {
      if (key in c && !keyOk(key, c[key])) return { ok: false, message: `「${LABEL[key]}」設定唔啱。`, warnings };
    }
    const m = resolve(c, n);
    const wantsTeams = clean(c).teamMode === 'teams';
    if (wantsTeams) {
      const t = clean(c).teams;
      if (n < 4) return { ok: false, message: '分隊最少要 4 個人。', warnings };
      if (t * 2 > n) return { ok: false, message: `${t} 隊每隊最少 2 人，要 ${t * 2} 個人或以上。`, warnings };
    }
    if (m.guessMode === 'typed' && env && env.singleDevice) return { ok: false, message: ONE_PHONE_TYPED, warnings };
    if (m.guessMode === 'typed') warnings.push('打字估要每人用自己部手機；一部手機輪流玩請用講出口。');
    if (m.guessMode === 'typed' && m.drawMode === 'paper') warnings.push('打字估＋紙筆：大家望住張紙，用自己部手機打答案。');
    if (m.totalTurns > 16) warnings.push(`一共 ${m.totalTurns} 輪，大約 ${minutesFor(m)} 分鐘。`);
    if (m.teamMode === 'teams') {
      const sizes = teamSizes(n, m.teams);
      if (new Set(sizes).size > 1) warnings.push(`隊伍人數唔平均（${sizes.join('、')}），每隊畫嘅次數一樣，細隊嘅人要畫多啲。`);
    } else if (n >= 10) warnings.push('10 人或以上，分隊玩會更緊湊。');
    if (m.guessMode === 'typed' && n === 3) warnings.push('3 個人打字估，只有 2 個人估，好易估中。');
    if (m.topics.cats.length === 1) warnings.push('只揀咗一個類別，會冇類別提示，詞庫都較細。');
    return { ok: true, message: '', warnings };
  },

  fields(cfg, n) {
    const m = resolve(cfg, n);
    const teamsOn = m.teamMode === 'teams';
    const out = [
      { key: 'drawMode', label: '畫喺邊', type: 'select',
        help: m.drawMode === 'canvas' ? '畫家喺手機上畫，大家睇住同一幅畫（各自部機，或者擺喺中間嗰部）。' : '畫家用真紙真筆畫，手機負責派詞、計時、計分。',
        options: [{ value: 'canvas', label: '📱 手機畫板' }, { value: 'paper', label: '📝 實體紙筆' }] },
      { key: 'guessMode', label: '點樣估', type: 'select',
        help: m.guessMode === 'shout'
          ? '大家用口講，畫家㩒邊個估中；可以多人同時估中。'
          : '每人打字，系統自動核對；估近咗會提示「好接近」，其他人睇唔到你打咗乜。',
        options: [{ value: 'shout', label: '🗣️ 講出口' }, { value: 'typed', label: '⌨️ 打字估（靜靜哋玩）' }] },
      { key: 'teamMode', label: '玩法', type: 'select',
        help: n < 4 ? '分隊最少要 4 個人。' : teamsOn ? '輪到邊隊就由隊內一人畫，只有隊友估；估中全隊得分。' : '各自為政：搶得快分高，畫家跟住估中嘅人得分。',
        options: [{ value: 'ffa', label: '各自為政' }, { value: 'teams', label: '分隊（Pictionary 玩法）' }] },
    ];
    if (teamsOn) {
      out.push(
        { key: 'teams', label: '幾多隊', type: 'int', min: 2, max: Math.max(2, Math.min(4, Math.floor(n / 2))),
          help: `${n} 人分 ${m.teams} 隊：${teamSizes(n, m.teams).join('、')} 人。` },
        { key: 'teamAssign', label: '點分隊', type: 'select',
          help: '按座位交錯分，對手就坐喺隊友中間；改座位次序就會改隊。',
          options: [{ value: 'alternate', label: '按座位交錯分（A B A B…）' }, { value: 'shuffle', label: '隨機分' }] },
        { key: 'teamRounds', label: '每隊畫幾次', type: 'int', min: 0, max: 8,
          help: `0＝自動（${teamRoundsFor(n, m.teams)} 次）。而家共 ${m.totalTurns} 輪。` },
        { key: 'starsAsPoints', label: '難詞多分', type: 'bool', help: '估中得 1／2／3 分（跟難度），唔開就每次 1 分。' },
      );
    } else {
      out.push({ key: 'cycles', label: '每人畫幾次', type: 'int', min: 0, max: 5,
        help: `${headcountLine(n, m)} 0＝自動（${cyclesFor(n)} 次）。` });
    }
    out.push(
      { key: 'roundSeconds', label: '每輪時間', type: 'select',
        help: `而家每輪 ${m.seconds} 秒。自動：${teamsOn ? '分隊 60 秒（打字 80）' : '講出口 80 秒（打字 100，打字慢啲）'}。`,
        options: [{ value: 0, label: '自動（按玩法）' }, ...[45, 60, 80, 100, 120, 150, 180].map((v) => ({ value: v, label: `${v} 秒` }))] },
      { key: 'hints', label: '提示（類別、揭開字）', type: 'bool', help: '關咗就淨係睇到字數。' },
    );
    if (m.guessMode === 'typed') {
      out.push({ key: 'strictness', label: '打字估嘅嚴格度', type: 'select',
        help: m.strictness === 'strict' ? '要一模一樣先算（只容許空格、標點、大細寫）。'
          : m.strictness === 'loose' ? '答案嘅一部分或者多咗幾隻字都算中。' : '容許簡繁體、語氣詞（「係老虎呀」）同同義詞。',
        options: [{ value: 'strict', label: '嚴格' }, { value: 'standard', label: '標準' }, { value: 'loose', label: '寬鬆' }] });
    }
    out.push({ key: 'topics', label: '詞庫類別', type: 'categories',
      help: '唔揀＝全部。每輪派 3 張詞（易／中／難）；難度可以只揀其中幾種。',
      options: CATEGORIES.map((c) => ({ value: c, label: c })),
      levels: LEVELS.map((v) => ({ value: v, label: `${S.stars(v)} ${S.LEVEL_NAME[v]}` })),
      bank: 'draw', matches: (value, e) => topicMatch(value, e) });   // the lobby prints 已用 / 總數 from the bag (#11)
    return out;
  },

  /**
   * Named setups with a reason (BACKLOG #8): `[{ id, label, reason, cfg }]`, `cfg` a patch over the current config.
   * Every one is valid for the head-count it is offered for (tested for 3–12). `env.singleDevice` drops typed play.
   */
  presets(n, env) {
    const out = [
      { id: 'classic', label: '經典：講出口＋紙筆', cfg: { guessMode: 'shout', drawMode: 'paper', teamMode: 'ffa' },
        reason: `${n} 人：一張紙、一支筆，手機派詞、計時、計分 — 最似真 Pictionary` },
      { id: 'phone', label: '手機畫板', cfg: { guessMode: 'shout', drawMode: 'canvas', teamMode: 'ffa' },
        reason: `${n} 人：冇紙冇筆都玩到，大家望住同一幅畫，用口講` },
    ];
    if (!(env && env.singleDevice)) {
      out.push({ id: 'quiet', label: '靜靜哋（打字）', cfg: { guessMode: 'typed', drawMode: 'canvas', teamMode: 'ffa' },
        reason: `${n} 人，新幹線、餐廳咁嘅地方：每人用自己部手機打字估，畫即時傳到每部手機` });
    }
    if (n >= 4) {
      out.push({ id: 'teams', label: '分隊（Pictionary）', cfg: { teamMode: 'teams', teams: 2 },
        reason: `${n} 人分 2 隊（${teamSizes(n, 2).join('、')}）：合作多啲、搶分少啲${n >= 8 ? '，人多最啱' : ''}` });
    }
    return out;
  },

  summary(cfg, n) {
    const m = resolve(cfg, n);
    const lines = [];
    if (m.teamMode === 'teams') {
      lines.push(`${n} 人分 ${m.teams} 隊（${teamSizes(n, m.teams).join('、')}）：每隊畫 ${m.teamRounds} 次，共 ${m.totalTurns} 輪 · 約 ${minutesFor(m)} 分鐘`);
    } else {
      lines.push(`${n} 人：每人畫 ${m.cycles} 次，共 ${m.totalTurns} 輪 · 約 ${minutesFor(m)} 分鐘`);
    }
    lines.push(m.drawMode === 'canvas' ? '📱 手機畫板' : '📝 實體紙筆');
    lines.push(m.guessMode === 'shout' ? '🗣️ 講出口' : `⌨️ 打字估（${{ strict: '嚴格', standard: '標準', loose: '寬鬆' }[m.strictness]}）`);
    lines.push(`每輪 ${m.seconds} 秒`);
    if (!m.hints) lines.push('冇提示');
    if (m.teamMode === 'teams' && m.starsAsPoints) lines.push('難詞多分');
    if (m.topics.cats.length) lines.push(`類別：${m.topics.cats.join('、')}`);
    if (m.topics.levels.length && m.topics.levels.length < 3) lines.push(`難度：${m.topics.levels.map((v) => S.LEVEL_NAME[v]).join('、')}`);
    return lines;
  },
};

// ---------- small helpers ----------

const cp = (str) => Array.from(String(str));
const nameOf = (s, pid) => s.players.find((p) => p.id === pid)?.name ?? '?';
const namer = (s) => (pid) => nameOf(s, pid);
const teamNamer = () => (i) => S.teamLabel(i);

/** Round half up of a / b for integers a >= 0, b > 0 — no floating point. */
const roundDiv = (a, b) => Math.floor((2 * a + b) / (2 * b));

const usable = (e) => !!e && typeof e.w === 'string' && e.w.trim() !== '';

function cleanEntry(e) {
  return {
    w: String(e.w),
    alt: Array.isArray(e.alt) ? e.alt.filter((x) => typeof x === 'string') : [],
    level: LEVELS.includes(e.level) ? e.level : 2,
    cat: typeof e.cat === 'string' ? e.cat : '',
  };
}

/** core/bag.js throws if the bank was never loaded; a turn must survive that. */
function safeDraw(bag, predicate) {
  if (!bag) return null;
  try { return bag.draw('draw', predicate); } catch { return null; }
}

/** Give a word back to the persistent bag (unpicked offers / a voided turn). A no-op until the bag grows `release`. */
function release(bag, w) {
  try { bag?.release?.('draw', w); } catch { /* best effort */ }
}

function maskOf(w) {
  const chars = cp(w);
  const boxIdx = [];
  chars.forEach((c, i) => { if (!GAP.test(c)) boxIdx.push(i); });
  return { chars, boxIdx };
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
const solvedBy = (t, pid) => t.solvers.some((x) => x.pid === pid);
/** FFA foul threshold: at least 2 flags and at least half of the E eligible guessers (E = 2 → 2, E = 7 → 4). */
const foulNeed = (E) => Math.max(2, Math.ceil(E / 2));
const isHostPid = (s, pid) => s.hostPid !== null && pid === s.hostPid;
const LIVE_SUBS = ['run', 'buzzer', 'grace'];

/**
 * May this seat raise 🚩 now (the clock aside: the reveal's 5 s window is checked in act)?
 * FFA: any non-drawer seat, until the threshold is met. Teams: a RIVAL, once per turn, which freezes the
 * clock for a host ruling (research "Voting & resolution D"). In the reveal only a solved turn can be fouled.
 */
function canFlag(s, pid) {
  const t = s.turn;
  if (!t || typeof pid !== 'string' || !s.order.includes(pid) || pid === t.drawer || t.fouls.includes(pid) || t.ruling) return false;
  if (s.teams) {
    if (s.teamOf[pid] === t.team) return false;
    if (s.phase === 'play') return LIVE_SUBS.includes(t.sub);
    return s.phase === 'reveal' && t.outcome === 'solved' && !t.upheld;
  }
  if (t.fouls.length >= foulNeed(t.eligible.length)) return false;     // flags beyond the threshold are ignored
  if (s.phase === 'play') return LIVE_SUBS.includes(t.sub);
  return s.phase === 'reveal' && t.outcome === 'solved';
}

/** Host ms at which the current turn's clock runs out (only meaningful while sub === 'run'). */
function endOf(s) {
  const t = s.turn;
  return t.sub === 'run' ? s.deadline + sum(t.then) : s.deadline;
}

// ---------- scoring (docs: "RECOMMENDED FFA scoring") ----------

/**
 * Points of one turn from its recorded facts. Integers only:
 *   G = round(m × (10 + 20 r)),  r = remaining / T,  m = 1 / 1.5 / 2 by tier
 *   D = round(mean(G) × (0.5 + 0.5 k / E))  for k ≥ 1 solvers out of E eligible guessers
 * Team mode: 1 point (or the tier's stars) for the drawing team, nothing for individuals.
 * Abandoned and voided turns score nothing; an upheld foul zeroes the drawer (or the team's point).
 */
export function scoreEntry(e, cfg) {
  const out = { solverPts: {}, drawerPts: 0, teamPts: 0, deltas: {} };
  if (e.outcome === 'abandoned' || e.outcome === 'voided' || e.outcome === 'fouled' || !e.solvers.length) return out;
  if (e.team != null) {
    if (!e.fouled) out.teamPts = cfg.starsAsPoints ? e.level : 1;
    return out;
  }
  const m2 = MULT2[e.level] ?? 3;
  let total = 0;
  for (const x of e.solvers) {
    const T = Math.max(1, x.T);
    const rem = Math.max(0, Math.min(T, x.rem));
    const G = roundDiv(m2 * (10 * T + 20 * rem), 2 * T);
    out.solverPts[x.pid] = G;
    out.deltas[x.pid] = (out.deltas[x.pid] ?? 0) + G;
    total += G;
  }
  const k = e.solvers.length;
  const E = e.E;
  if (k > 0 && E > 0 && !e.fouled) {
    out.drawerPts = roundDiv(total * (E + k), 2 * k * E);
    out.deltas[e.drawer] = (out.deltas[e.drawer] ?? 0) + out.drawerPts;
  }
  return out;
}

function entryOf(s) {
  const t = s.turn;
  const e = {
    n: t.n, drawer: t.drawer, team: t.team, w: t.word?.w ?? '', alt: t.word ? t.word.alt.slice() : [],
    level: t.word?.level ?? 0, cat: t.word?.cat ?? '', outcome: t.outcome,
    solvers: t.solvers.map((x) => ({ ...x })), E: t.eligible.length, flags: t.fouls.length,
    fouled: s.teams ? !!t.upheld : t.fouls.length >= foulNeed(t.eligible.length), again: !!t.again,
  };
  return Object.assign(e, scoreEntry(e, s.cfg));
}

/** Scores are always derived from the history, so a late accept or foul can never double count. */
function recompute(s) {
  const sc = Object.fromEntries(s.order.map((id) => [id, 0]));
  const ts = s.teams ? s.teams.map(() => 0) : [];
  for (const e of s.history) {
    for (const [pid, d] of Object.entries(e.deltas)) if (pid in sc) sc[pid] += d;
    if (e.team != null && e.team in ts) ts[e.team] += e.teamPts;
  }
  s.scores = sc;
  s.teamScores = ts;
}

/** Rebuild the CURRENT turn's history entry after something changed during the reveal. */
function syncEntry(s) {
  s.history[s.history.length - 1] = entryOf(s);
  recompute(s);
}

// ---------- queue and teams ----------

function buildTeams(order, cfg, rng) {
  const base = cfg.teamAssign === 'shuffle' ? shuffle(rng, order) : order;
  const teams = Array.from({ length: cfg.teams }, () => ({ members: [] }));
  base.forEach((pid, i) => teams[i % cfg.teams].members.push(pid));
  for (const t of teams) t.members.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return teams;
}

function buildQueue(order, teams, cfg, rng) {
  const q = [];
  if (teams) {
    const start = rint(rng, teams.length);
    const offset = teams.map((t) => rint(rng, t.members.length));
    for (let r = 0; r < cfg.teamRounds; r++) {
      for (let k = 0; k < teams.length; k++) {
        const ti = (start + k) % teams.length;
        const m = teams[ti].members;
        q.push({ drawer: m[(offset[ti] + r) % m.length], team: ti });
      }
    }
  } else {
    const start = rint(rng, order.length);   // round 1: random over ALL seats (backlog #20)
    for (let c = 0; c < cfg.cycles; c++) {
      for (let i = 0; i < order.length; i++) q.push({ drawer: order[(start + i) % order.length], team: null });
    }
  }
  return q;
}

// ---------- offering words ----------

/** One entry at `level`: exact tier → other allowed tiers → any tier → any category. Never a word seen this game. */
function drawOne(s, ctx, level) {
  const cats = s.cfg.topics.cats;
  const allowed = s.cfg.topics.levels.length ? s.cfg.topics.levels : LEVELS;
  const seen = new Set(s.seen);
  const base = (e) => usable(e) && !seen.has(e.w);
  const okCat = (e) => !cats.length || cats.includes(e.cat);
  const near = allowed.slice().sort((a, b) => Math.abs(a - level) - Math.abs(b - level) || a - b);
  const tries = [
    (e) => base(e) && okCat(e) && e.level === level,
    ...near.filter((l) => l !== level).map((l) => (e) => base(e) && okCat(e) && e.level === l),
    (e) => base(e) && okCat(e) && allowed.includes(e.level),
    (e) => base(e) && okCat(e),
    (e) => base(e),
  ];
  let got = null;
  for (const f of tries) {
    got = safeDraw(ctx.bag, f);
    if (usable(got)) break;
    got = null;
  }
  if (!got) {
    const fresh = FALLBACK.filter((e) => !seen.has(e.w));
    const pool = fresh.length ? fresh : FALLBACK;
    const lv = pool.filter((e) => e.level === level);
    got = (lv.length ? lv : pool)[rint(ctx.rng, (lv.length ? lv : pool).length)];
  }
  const e = cleanEntry(got);
  s.seen.push(e.w);
  return e;
}

function dealOffers(s, ctx) {
  const allowed = s.cfg.topics.levels.length ? s.cfg.topics.levels : LEVELS;
  const slots = allowed.slice();
  while (slots.length < 3) slots.push(allowed[slots.length % allowed.length]);
  const offers = slots.slice(0, 3).map((lv) => drawOne(s, ctx, lv));
  offers.sort((a, b) => a.level - b.level);
  s.turn.offers = offers;
}

// ---------- the turn machine ----------

function newTurn(s, q) {
  const team = q.team ?? null;
  const eligible = team !== null
    ? s.teams[team].members.filter((p) => p !== q.drawer)
    : s.order.filter((p) => p !== q.drawer);
  return {
    n: s.qi + 1, drawer: q.drawer, team, eligible, again: !!q.again,
    offers: null, rerolls: 0, word: null,
    boxes: 0, reveals: [], shown: 0, showCat: false, stage: 0, log: [],
    T: 0, sub: 'choose', pending: [], then: [], grace: null,
    solvers: [], guesses: [], gid: 0, rate: {}, seenG: {}, fouls: [], outcome: null,
    ruling: null, upheld: false, acked: [],
  };
}

function startTurn(s, ctx) {
  s.turn = newTurn(s, s.queue[s.qi]);
  s.phase = 'choose';
  if (s.cfg.drawMode === 'canvas') s.inkEpoch += 1;     // the session clears the shared picture
  dealOffers(s, ctx);
  s.deadline = ctx.now + CHOOSE_MS;
  s.timerLabel = '揀詞';
}

function autoIndex(offers) {
  const i = offers.findIndex((o) => o.level === 2);
  return i >= 0 ? i : Math.min(1, offers.length - 1);
}

function pickWord(s, ctx, i) {
  const t = s.turn;
  const chosen = t.offers[i];
  t.offers.forEach((o, j) => { if (j !== i) release(ctx.bag, o.w); });
  t.word = { w: chosen.w, alt: chosen.alt.slice(), level: chosen.level, cat: chosen.cat };
  t.offers = null;
  startPlay(s, ctx);
}

function startPlay(s, ctx) {
  const t = s.turn;
  const { boxIdx } = maskOf(t.word.w);
  t.boxes = boxIdx.length;
  const maxReveals = Math.min(2, Math.floor(boxIdx.length / 2));
  t.reveals = sample(ctx.rng, boxIdx, maxReveals);
  t.shown = 0;
  t.showCat = false;
  t.stage = 0;
  t.log = [];
  t.T = s.cfg.seconds * 1000;

  const evs = [];
  if (s.cfg.hints) {
    const oneCat = s.cfg.topics.cats.length === 1;
    if (!oneCat && t.word.cat) evs.push({ kind: 'cat', at: HINT_AT.cat });
    if (maxReveals >= 1) evs.push({ kind: 'r', at: HINT_AT.r1 });
    if (maxReveals >= 2) evs.push({ kind: 'r', at: HINT_AT.r2 });
  }
  const times = evs.map((e) => Math.round(t.T * e.at));
  t.pending = evs.map((e) => e.kind);
  t.then = times.map((x, i) => (i + 1 < times.length ? times[i + 1] : t.T) - x);
  s.deadline = ctx.now + (times.length ? times[0] : t.T);
  t.sub = 'run';
  s.phase = 'play';
  s.timerLabel = '';
}

function fireHint(s) {
  const t = s.turn;
  const kind = t.pending.shift();
  const d = t.then.shift();
  if (kind === 'cat') t.showCat = true;
  else if (kind === 'r') t.shown += 1;
  t.log.push(kind);
  t.stage += 1;
  s.deadline += d;
}

function clockOut(s, ctx) {
  const t = s.turn;
  if (s.cfg.guessMode === 'typed') {
    finishTurn(s, ctx, t.solvers.length ? 'solved' : 'timeout');
    return;
  }
  // shout mode: nobody was accepted → a short buzzer window for a late tap
  openBuzzer(s, ctx.now + BUZZER_MS);
}

/** The 2 s buzzer window (shout): taps in it score with r = 0, can be undone, and the turn ends when it closes. */
function openBuzzer(s, until) {
  const t = s.turn;
  t.sub = 'buzzer';
  t.pending = [];
  t.then = [];
  s.deadline = until;
  s.timerLabel = '補㩒時間';
}

/** The first tap before the deadline: a 3 s window to add co-winners or undo. The turn clock is frozen meanwhile. */
function openGrace(s, ctx, pid, rem) {
  const t = s.turn;
  t.grace = { rem, T: t.T, restore: { in: Math.max(0, s.deadline - ctx.now), pending: t.pending.slice(), then: t.then.slice() } };
  t.sub = 'grace';
  t.pending = [];
  t.then = [];
  s.deadline = ctx.now + GRACE_MS;
  s.timerLabel = '確認中';
  insertSolver(t, { pid, rem, T: t.T, via: 'accept' });
}

/** Every tap in the grace window was undone: the turn carries on with the clock exactly where it stopped. */
function restoreFromGrace(s, ctx) {
  const t = s.turn;
  const r = t.grace.restore;
  t.sub = 'run';
  t.pending = r.pending.slice();
  t.then = r.then.slice();
  s.deadline = ctx.now + r.in;
  s.timerLabel = '';
  t.grace = null;
}

// ---------- team fouls: a rival's 🚩 freezes the clock until the host rules ----------

function openRuling(s, ctx, pid) {
  const t = s.turn;
  t.ruling = {
    by: pid, phase: s.phase, sub: t.sub, label: s.timerLabel,
    in: typeof s.deadline === 'number' ? Math.max(0, s.deadline - ctx.now) : 0,
  };
  if (s.phase === 'play') t.sub = 'ruling';
  s.deadline = null;
  s.timerLabel = '';
}

/** Close a pending ruling and restart the frozen clock where it stopped. */
function closeRuling(s, ctx) {
  const t = s.turn;
  const r = t.ruling;
  if (!r) return;
  t.ruling = null;
  if (r.phase === 'play' && t.sub === 'ruling') t.sub = r.sub;
  s.deadline = ctx.now + r.in;
  s.timerLabel = r.label;
}

/** The host rules on a team foul: upheld → the drawing team scores nothing this turn; rejected → play resumes. */
function rule(s, ctx, uphold) {
  const t = s.turn;
  if (!t?.ruling) return s;
  const phase = t.ruling.phase;
  closeRuling(s, ctx);
  if (!uphold) return s;
  t.upheld = true;
  if (phase === 'play') finishTurn(s, ctx, 'fouled');
  else syncEntry(s);
  return s;
}

/** Solvers stay ordered by how early they solved (more time remaining first); ties keep arrival order. */
function insertSolver(t, x) {
  let i = t.solvers.length;
  while (i > 0 && t.solvers[i - 1].rem < x.rem) i--;
  t.solvers.splice(i, 0, x);
}

/** A voided turn: the word (and any offers still on the table) goes back to the bag; the drawer is re-queued once. */
function voidBookkeeping(s, ctx) {
  const t = s.turn;
  if (t.word) release(ctx.bag, t.word.w);
  for (const o of t.offers ?? []) release(ctx.bag, o.w);
  t.offers = null;
  if (!t.again) s.queue.push({ drawer: t.drawer, team: t.team, again: true });   // re-queued once, at the end
}

function finishTurn(s, ctx, outcome) {
  const t = s.turn;
  t.outcome = outcome;
  t.sub = 'done';
  t.pending = [];
  t.then = [];
  t.grace = null;
  t.ruling = null;
  if (outcome === 'voided') voidBookkeeping(s, ctx);
  s.revealMs = s.cfg.passPhone ? REVEAL_PASS_MS : REVEAL_MS;
  s.phase = 'reveal';
  s.deadline = ctx.now + s.revealMs;
  s.timerLabel = '';
  s.history.push(entryOf(s));
  recompute(s);
}

/** Turns per cycle: everybody draws once (FFA), or every team draws once. */
const perCycle = (s) => (s.teams ? s.teams.length : s.order.length);

/** After the reveal: the leaderboard if a cycle just ended (never after the last turn), else the next turn. */
function afterReveal(s, ctx) {
  const done = s.qi + 1;
  if (done < s.queue.length && done < s.cfg.totalTurns && done % perCycle(s) === 0) {
    s.phase = 'standings';
    s.deadline = ctx.now + STANDINGS_MS;
    s.timerLabel = '';
    return;
  }
  nextTurn(s, ctx);
}

function nextTurn(s, ctx) {
  if (s.qi + 1 >= s.queue.length) {
    s.phase = 'over';
    s.deadline = null;
    s.timerLabel = '';
    return;
  }
  s.qi += 1;
  startTurn(s, ctx);
}

const lateOpen = (s, ctx) => s.phase === 'reveal' && typeof s.deadline === 'number' && s.deadline - ctx.now > s.revealMs - LATE_MS;

// ---------- cues (narration; public information only) ----------

function charPos(t, idx) {
  const { boxIdx } = maskOf(t.word.w);
  return boxIdx.indexOf(idx) + 1;
}

function rawCue(s) {
  const t = s.turn;
  if (!t) return null;
  const nm = namer(s);
  const tn = teamNamer();
  switch (s.phase) {
    case 'choose':
      return { id: `t${t.n}:choose:${t.again ? 'again' : 'first'}`, minMs: 2500,
        text: S.cueChoose({ n: t.n, drawer: nm(t.drawer), team: t.team !== null ? tn(t.team) : '' }) };
    case 'play': {
      if (t.sub === 'ruling') {
        return { id: `t${t.n}:ruling:${t.fouls.length}`, minMs: 1500, text: S.cueRuling({ team: tn(s.teamOf[t.ruling.by]) }) };
      }
      if (t.sub === 'grace' || (t.sub === 'buzzer' && t.solvers.length)) {
        return { id: `t${t.n}:got:${t.solvers.map((x) => x.pid).join('+')}`, minMs: 1500,
          text: S.cueGot({ names: t.solvers.map((x) => nm(x.pid)) }) };
      }
      if (t.sub === 'buzzer') return null;
      if (t.stage === 0) {
        return { id: `t${t.n}:play`, minMs: 2500,
          text: S.cuePlay({ secs: Math.round(t.T / 1000), boxes: t.boxes, typed: s.cfg.guessMode === 'typed', pass: !!s.cfg.passPhone,
            drawer: nm(t.drawer) }) };
      }
      const kind = t.log[t.stage - 1];
      if (kind === 'cat') return { id: `t${t.n}:s${t.stage}`, minMs: 1500, text: S.cueCat({ cat: t.word.cat }) };
      if (kind === 'r') {
        const idx = t.reveals[t.shown - 1];
        return { id: `t${t.n}:s${t.stage}`, minMs: 1500,
          text: S.cueChar({ pos: charPos(t, idx), ch: cp(t.word.w)[idx] }) };
      }
      return null;
    }
    case 'reveal': {
      const fouled = !!s.history[s.history.length - 1]?.fouled;
      return { id: `t${t.n}:reveal:${t.outcome}${fouled ? ':foul' : ''}`, minMs: 3000,
        text: S.cueReveal({ outcome: t.outcome, word: t.word?.w ?? '', drawer: nm(t.drawer), fouled, teams: !!s.teams,
          names: t.solvers.map((x) => nm(x.pid)) }) };
    }
    case 'standings': {
      const k = Math.floor((s.qi + 1) / perCycle(s));
      return { id: `c${k}:standings`, minMs: 2000, text: S.cueStandings({ k, leaders: leadersOf(s), teams: !!s.teams }) };
    }
    default:
      return null;
  }
}

/** Who leads right now (names or team labels) and with how many points — public. */
function leadersOf(s) {
  if (s.teams) {
    const top = Math.max(...s.teamScores);
    return { names: s.teams.map((_, i) => i).filter((i) => s.teamScores[i] === top).map((i) => S.teamLabel(i)), top };
  }
  const top = Math.max(...s.order.map((p) => s.scores[p]));
  return { names: s.order.filter((p) => s.scores[p] === top).map(namer(s)), top };
}

// ---------- actions ----------

/** +30 s on the clock (host). T grows too, so r keeps its meaning and an already shown hint never goes away. */
function extendClock(s) {
  const t = s.turn;
  if (s.phase !== 'play' || t.sub !== 'run' || t.T + EXTEND_MS > MAX_TOTAL_MS) return s;
  t.T += EXTEND_MS;
  if (t.then.length) t.then[t.then.length - 1] += EXTEND_MS; else s.deadline += EXTEND_MS;
  return s;
}

/**
 * Void a broken turn (host, or the shell's 呢鋪唔計 = @void-round): no points, the word goes back to the bag,
 * the drawer is queued once more at the end. Also in the reveal (a dead phone noticed only when the clock ran out).
 */
function voidTurn(s, ctx) {
  const t = s.turn;
  if (!t) return s;
  if (s.phase === 'choose' || (s.phase === 'play' && t.sub !== 'done')) {
    finishTurn(s, ctx, 'voided');
  } else if (s.phase === 'reveal' && t.outcome !== 'voided') {
    closeRuling(s, ctx);
    t.outcome = 'voided';
    voidBookkeeping(s, ctx);
    syncEntry(s);
  }
  return s;
}

/** What the narrator sees. Typed play is for quiet places (the shinkansen): the phone never speaks there. */
const shownCue = (s) => (s.cfg.guessMode === 'typed' ? null : rawCue(s));

/** The cue still to be spoken: a line acknowledged once this turn never comes back (e.g. after a ruling resumes play). */
function pendingCue(s) {
  const c = shownCue(s);
  if (!c || c.id === s.cueAck || (s.turn?.acked ?? []).includes(c.id)) return null;
  return c;
}

function ackCue(s, id) {
  s.cueAck = id;
  const t = s.turn;
  if (t && !t.acked.includes(id)) { t.acked.push(id); if (t.acked.length > 24) t.acked.shift(); }
}

/** The host's ⏭ 下一步 (after any pending line was acknowledged): end this step now. */
function skipStep(s, ctx) {
  const t = s.turn;
  switch (s.phase) {
    case 'choose': pickWord(s, ctx, autoIndex(t.offers)); break;
    case 'play':
      if (t.ruling) rule(s, ctx, false);            // skipping a ruling = not upheld, play on
      else finishTurn(s, ctx, t.solvers.length ? 'solved' : 'timeout');
      break;
    case 'reveal':
      if (t.ruling) rule(s, ctx, false);
      else afterReveal(s, ctx);
      break;
    case 'standings': nextTurn(s, ctx); break;
    default: break;
  }
  return s;
}

function hostAct(s, a, ctx) {
  if (a.type === ACT.CUE_DONE) {
    const c = pendingCue(s);
    if (c && a.id === c.id) ackCue(s, c.id);
    return s;
  }
  if (a.type === ACT.NEXT) {
    const c = pendingCue(s);
    if (c) { ackCue(s, c.id); return s; }           // 下一步 first means "I read it out"
    return skipStep(s, ctx);
  }
  if (a.type === ACT.VOID_ROUND) return voidTurn(s, ctx);
  // the seat-level moderator moves, for a host menu that dispatches them as the host itself (single phone)
  if (a.type === 'extend') return extendClock(s);
  if (a.type === 'void') return voidTurn(s, ctx);
  if (a.type === 'rule' && typeof a.uphold === 'boolean') return rule(s, ctx, a.uphold);
  return s;   // ACT.AUTO is resolved by the session through autoAct()
}

function act(state, msg, ctx) {
  const s = state;
  const pid = msg?.pid;
  const a = msg?.action;
  if (!a || typeof a !== 'object' || typeof a.type !== 'string' || s.phase === 'over') return s;
  if (pid === HOST) return hostAct(s, a, ctx);
  if (typeof pid !== 'string' || !s.order.includes(pid)) return s;

  const t = s.turn;
  const isDrawer = pid === t.drawer;
  const typed = s.cfg.guessMode === 'typed';

  switch (a.type) {
    case 'pick': {
      if (s.phase !== 'choose' || !isDrawer || !Number.isInteger(a.i) || a.i < 0 || a.i >= t.offers.length) return s;
      pickWord(s, ctx, a.i);
      return s;
    }
    case 'reroll': {
      if (s.phase !== 'choose' || !isDrawer || t.rerolls >= 1) return s;
      for (const o of t.offers) release(ctx.bag, o.w);
      t.rerolls += 1;
      dealOffers(s, ctx);
      s.deadline = ctx.now + CHOOSE_MS;
      return s;
    }
    case 'accept': {
      if (!isDrawer) return s;
      return typed ? acceptGuess(s, ctx, a) : acceptTarget(s, ctx, a);
    }
    case 'undo-accept': {
      if (s.phase !== 'play' || (t.sub !== 'grace' && t.sub !== 'buzzer') || !isDrawer || typed) return s;
      const idx = typeof a.target === 'string' ? t.solvers.findIndex((x) => x.pid === a.target) : t.solvers.length - 1;
      if (idx < 0) return s;
      t.solvers.splice(idx, 1);
      if (t.sub === 'grace' && !t.solvers.length) restoreFromGrace(s, ctx);
      return s;
    }
    case 'guess':
      return guess(s, ctx, pid, a);
    case 'foul': {
      if (!canFlag(s, pid)) return s;
      if (s.phase === 'reveal' && !lateOpen(s, ctx)) return s;
      t.fouls.push(pid);
      if (s.teams) openRuling(s, ctx, pid);           // teams: the clock stops, the host rules
      else if (s.phase === 'reveal') syncEntry(s);    // FFA: the threshold decides, the turn goes on
      return s;
    }
    case 'rule': return isHostPid(s, pid) && typeof a.uphold === 'boolean' ? rule(s, ctx, a.uphold) : s;
    case 'abandon': {
      if (s.phase === 'play' && isDrawer && (t.sub === 'run' || t.sub === 'buzzer')) finishTurn(s, ctx, 'abandoned');
      return s;
    }
    case 'extend': return isHostPid(s, pid) ? extendClock(s) : s;
    case 'void': return isHostPid(s, pid) ? voidTurn(s, ctx) : s;
    default:
      return s;
  }
}

/**
 * Shout mode: the drawer taps who said it.
 *   run     the first tap opens the 3 s grace window (its time left is everybody's r); the clock freezes meanwhile
 *   grace   a further tap is a co-winner with the SAME r
 *   buzzer  (the 2 s after the deadline, nobody tapped before it) every tap scores with r = 0 and can be undone
 *           until the window closes; the turn ends when it closes (research "Voting & resolution B")
 */
function acceptTarget(s, ctx, a) {
  const t = s.turn;
  if (s.phase !== 'play' || !LIVE_SUBS.includes(t.sub)) return s;
  const target = a.target;
  if (typeof target !== 'string' || !t.eligible.includes(target) || solvedBy(t, target)) return s;

  if (t.sub === 'grace') {
    insertSolver(t, { pid: target, rem: t.grace.rem, T: t.grace.T, via: 'accept' });
    return s;
  }
  if (t.sub === 'buzzer') {
    insertSolver(t, { pid: target, rem: 0, T: t.T, via: 'accept' });
    return s;
  }
  // sub === 'run'
  const end = endOf(s);
  if (ctx.now > end) {
    // the clock ran out but its timer has not fired yet: this tap lands in the buzzer window
    if (ctx.now - end > BUZZER_MS) return s;
    while (t.pending.length) fireHint(s);           // every hint was due before the end
    openBuzzer(s, end + BUZZER_MS);
    insertSolver(t, { pid: target, rem: 0, T: t.T, via: 'accept' });
    return s;
  }
  openGrace(s, ctx, target, Math.max(0, Math.min(t.T, end - ctx.now)));
  return s;
}

/** Typed mode: the drawer overrides the checker for one guess (counts at that guess's own time). */
function acceptGuess(s, ctx, a) {
  const t = s.turn;
  if (s.phase === 'reveal') {
    if (!lateOpen(s, ctx) || (t.outcome !== 'solved' && t.outcome !== 'timeout')) return s;
  } else if (s.phase !== 'play' || t.sub !== 'run') return s;
  const g = t.guesses.find((x) => x.id === a.gid);
  if (!g || g.kind === 'right' || solvedBy(t, g.pid)) return s;
  g.kind = 'right';
  g.via = 'override';
  insertSolver(t, { pid: g.pid, rem: g.rem, T: g.T, via: 'override' });
  if (s.phase === 'reveal') {
    t.outcome = 'solved';
    syncEntry(s);
  } else if (t.eligible.every((p) => solvedBy(t, p))) finishTurn(s, ctx, 'solved');
  return s;
}

function guess(s, ctx, pid, a) {
  const t = s.turn;
  if (s.cfg.guessMode !== 'typed' || s.phase !== 'play' || t.sub !== 'run') return s;
  if (!t.eligible.includes(pid) || solvedBy(t, pid) || typeof a.text !== 'string') return s;
  const text = a.text.trim();
  if (!text || cp(text).length > MAX_GUESS_LEN) return s;
  const end = endOf(s);
  if (ctx.now > end) return s;                          // after the clock: its advance is about to end the turn

  // the revealed characters are public: a near miss on them alone is not 好接近 (D9, docs/research/draw-guess.md A.5)
  const res = analyse(text, t.word, s.cfg.strictness, maskView(t).cells);
  if (!res.g) return s;                                 // nothing left after dropping punctuation and symbols
  const seen = (t.seenG[pid] ??= []);
  if (seen.includes(res.g)) return s;                   // identical guess this turn: ignored silently

  const r = (t.rate[pid] ??= { last: null, recent: [], lock: 0, n: 0 });
  if (r.lock && ctx.now < r.lock) return s;
  if (r.last !== null && ctx.now - r.last < GUESS_GAP_MS) return s;
  if (r.n >= MAX_GUESSES) return s;
  r.recent = r.recent.filter((x) => ctx.now - x < BURST_WINDOW_MS);
  if (r.recent.length >= GUESS_BURST) { r.lock = ctx.now + LOCK_MS; return s; }

  r.last = ctx.now;
  r.recent.push(ctx.now);
  r.n += 1;
  seen.push(res.g);
  const rem = Math.max(0, Math.min(t.T, end - ctx.now));
  t.gid += 1;
  t.guesses.push({ id: t.gid, pid, text, kind: res.kind, rem, T: t.T });
  if (res.kind === 'right') {
    insertSolver(t, { pid, rem, T: t.T, via: 'typed' });
    if (t.eligible.every((p) => solvedBy(t, p))) finishTurn(s, ctx, 'solved');
  }
  return s;
}

// ---------- engine ----------

function setup({ players, config: cfg, rng, now, bag, hostPid }) {
  const order = seatOrder(players);
  const n = order.length;
  const c = resolve(cfg, n);
  const teams = c.teamMode === 'teams' ? buildTeams(order, c, rng) : null;
  const queue = buildQueue(order, teams, c, rng);
  const s = {
    game: 'draw-guess', cfg: c,
    players: players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, color: p.color })),
    order, hostPid: typeof hostPid === 'string' && order.includes(hostPid) ? hostPid : null,
    teams, teamOf: teams ? Object.fromEntries(teams.flatMap((t, i) => t.members.map((p) => [p, i]))) : {},
    queue, qi: 0, phase: 'choose', deadline: null, timerLabel: '', revealMs: REVEAL_MS, inkEpoch: 0,
    scores: Object.fromEntries(order.map((id) => [id, 0])), teamScores: teams ? teams.map(() => 0) : [],
    seen: [], history: [], cueAck: '', turn: null,
  };
  startTurn(s, { rng, now, bag });
  return s;
}

function advance(state, ctx) {
  const s = state;
  if (s.deadline == null) return s;
  if (typeof ctx?.now === 'number' && ctx.now < s.deadline) return s;
  const t = s.turn;
  switch (s.phase) {
    case 'choose': pickWord(s, ctx, autoIndex(t.offers)); break;
    case 'play':
      if (t.sub === 'run') {
        if (t.pending.length) fireHint(s);
        else clockOut(s, ctx);
      } else if (t.sub === 'buzzer') finishTurn(s, ctx, t.solvers.length ? 'solved' : 'timeout');
      else if (t.sub === 'grace') finishTurn(s, ctx, 'solved');
      break;
    case 'reveal': afterReveal(s, ctx); break;
    case 'standings': nextTurn(s, ctx); break;
    default: break;
  }
  return s;
}

/** Only the drawer inks, only while drawing in canvas mode, and not while a foul ruling holds the clock. */
const canInk = (s, pid) => s.cfg.drawMode === 'canvas' && s.phase === 'play' && s.turn.drawer === pid && s.turn.sub !== 'ruling';

// ---------- views (whitelist-built) ----------

function maskView(t) {
  const shown = new Set(t.reveals.slice(0, t.shown));
  const cells = cp(t.word.w).map((c, i) => (GAP.test(c) ? ' ' : shown.has(i) ? c : ''));
  return { n: t.boxes, cells };
}

/** The feed of typed guesses as `seat` may see it. */
function feedFor(t, seat, isDrawer) {
  return t.guesses.slice(-FEED_VIEW).map((g) => {
    const mine = g.pid === seat;
    if (isDrawer) return { id: g.id, pid: g.pid, kind: g.kind, text: g.text, by: g.via ?? '' };
    if (g.kind === 'right') return { id: g.id, pid: g.pid, kind: 'right' };
    if (g.kind === 'wrong') return { id: g.id, pid: g.pid, kind: 'wrong', text: g.text };
    // close / near: the text is private to the sender and the drawer; the table only sees "X is close"
    return mine ? { id: g.id, pid: g.pid, kind: g.kind, text: g.text } : { id: g.id, pid: g.pid, kind: 'close' };
  });
}

function revealView(s, seat) {
  const e = s.history[s.history.length - 1];
  const t = s.turn;
  const rv = {
    w: e.w, alt: e.alt.slice(), level: e.level, cat: e.cat, drawer: e.drawer, team: e.team, outcome: e.outcome,
    solvers: e.solvers.map((x) => ({ pid: x.pid, pts: e.solverPts[x.pid] ?? 0, via: x.via })),
    drawerPts: e.drawerPts, teamPts: e.teamPts, fouled: e.fouled, flags: e.flags, again: e.again,
    foul: foulView(s, seat),
    ruling: t.ruling ? { by: t.ruling.by } : null,
    // the end of the 5 s window for late flags / late ✔ (host ms); 0 while a ruling holds the clock (nothing is open then)
    lateUntil: s.phase === 'reveal' && typeof s.deadline === 'number' ? s.deadline - (s.revealMs - LATE_MS) : 0,
  };
  const nm = namer(s);
  const tn = teamNamer();
  rv.headline = S.revealHeadline(e, nm, tn);
  rv.points = e.team == null ? S.pointsLine(e, nm) : '';
  return rv;
}

/** 🚩 as one seat sees it: the count, what tips it, whether I flagged, whether I may flag (the clock aside). */
function foulView(s, seat) {
  const t = s.turn;
  return {
    n: t.fouls.length,
    need: s.teams ? 1 : foulNeed(t.eligible.length),
    mine: seat !== null && t.fouls.includes(seat),
    can: seat !== null && canFlag(s, seat),
  };
}

function view(state, pid) {
  const s = state;
  const t = s.turn;
  const seat = typeof pid === 'string' && s.order.includes(pid) ? pid : null;
  const isDrawer = seat !== null && seat === t.drawer;
  const eligible = seat !== null && t.eligible.includes(seat);
  const role = seat === null ? 'spectator' : isDrawer ? 'drawer' : eligible ? 'guesser' : 'rival';
  const teamsOn = !!s.teams;
  const over = s.phase === 'over';

  const standings = s.phase === 'standings';
  const cycleNo = Math.floor((s.qi + 1) / perCycle(s));
  const cycles = Math.max(1, Math.floor(s.cfg.totalTurns / perCycle(s)));
  const v = {
    me: seat,
    role,
    phase: s.phase,
    title: over ? '遊戲完' : standings ? '排名' : `第 ${t.n}/${s.queue.length} 輪`,
    subtitle: over ? '' : standings ? `第 ${cycleNo}/${cycles} 圈完`
      : (teamsOn ? `${S.teamLabel(t.team)}：${nameOf(s, t.drawer)} 畫` : `${nameOf(s, t.drawer)} 畫`),
    drawMode: s.cfg.drawMode,
    guessMode: s.cfg.guessMode,
    hintsOn: s.cfg.hints,
    scoring: s.teams ? (s.cfg.starsAsPoints ? 'stars' : 'flat') : 'time',
    turn: { n: t.n, total: s.queue.length, drawer: t.drawer, team: t.team, again: t.again },
    upNext: over ? [] : s.queue.slice(s.qi + 1, s.qi + 4).map((q) => q.drawer),   // the queue preview (public)
    // the 💡 sheet's 「呢局有咩角色」 (DESIGN §7.1 re-run #5): this turn's parts, all public
    rolesInPlay: [
      { id: 'drawer', count: 1 },
      { id: 'guesser', count: t.eligible.length },
      ...(teamsOn ? [{ id: 'rival', count: Math.max(0, s.order.length - 1 - t.eligible.length) }] : []),
    ].filter((r) => r.count > 0),
    scores: { ...s.scores },
    teams: teamsOn ? s.teams.map((tm, i) => ({ i, members: tm.members.slice(), score: s.teamScores[i] })) : null,
    myTeam: teamsOn && seat !== null ? s.teamOf[seat] : null,
    mod: isHostPid(s, seat),
    last: s.qi >= s.queue.length - 1,
    sub: '',
    choose: null,
    play: null,
    reveal: null,
    standings: standings ? { cycle: cycleNo, cycles } : null,
    feed: null,
  };
  if (s.deadline != null) {
    v.deadline = s.phase === 'play' ? endOf(s) : s.deadline;
    v.timerLabel = s.timerLabel;
  }

  if (s.phase === 'choose') {
    v.choose = {
      offers: isDrawer ? t.offers.map((o, i) => ({ i, w: o.w, level: o.level, cat: o.cat, len: maskOf(o.w).boxIdx.length })) : null,
      canReroll: isDrawer && t.rerolls < 1,
    };
  }

  if (s.phase === 'play') {
    v.sub = t.sub;
    const rate = seat !== null ? t.rate[seat] : null;
    v.play = {
      sub: t.sub,
      T: t.T,
      mask: maskView(t),
      cat: t.showCat ? t.word.cat : null,
      solved: t.solvers.map((x) => x.pid),
      eligible: t.eligible.slice(),
      canDraw: seat !== null && canInk(s, seat),
      foul: foulView(s, seat),
      ruling: t.ruling ? { by: t.ruling.by } : null,
      word: isDrawer ? { w: t.word.w, alt: t.word.alt.slice(), level: t.word.level, cat: t.word.cat } : null,
      mine: eligible ? {
        solved: solvedBy(t, seat),
        lockUntil: rate && rate.lock ? rate.lock : 0,
        used: rate ? rate.n : 0,
        max: MAX_GUESSES,
      } : null,
    };
    if (s.cfg.guessMode === 'typed') v.feed = feedFor(t, seat, isDrawer);
  }

  if ((s.phase === 'reveal' || over) && t.outcome) {
    v.reveal = revealView(s, seat);
    if (s.phase === 'reveal' && isDrawer && s.cfg.guessMode === 'typed') v.feed = feedFor(t, seat, true);
  }

  v.hint = S.hintFor({
    phase: s.phase, role, drawMode: s.cfg.drawMode, guessMode: s.cfg.guessMode, teams: teamsOn,
    solved: seat !== null && solvedBy(t, seat), sub: t.sub, drawerName: nameOf(s, t.drawer),
    ruling: !!t.ruling, mod: v.mod, canFlag: seat !== null && canFlag(s, seat), outcome: t.outcome,
  });
  return v;
}

function cue(state) {
  return pendingCue(state);
}

/**
 * Who must hold their phone now: the drawer while choosing (private: the offers) and drawing. Drawing is a public
 * one-person step (§7.1 #4): on a shared phone the drawer gets the public card and lays the phone in the middle for
 * the table (#16). `hold` (U10, #23): on a whole-table phone neither clock runs while its card is still unanswered.
 */
function focus(state) {
  if (state.phase === 'choose') return { pids: [state.turn.drawer], label: '揀詞', hold: true };
  if (state.phase === 'play') {
    return { pids: [state.turn.drawer], open: true, label: state.cfg.passPhone ? '擺喺枱中間畫' : '畫畫', hold: true };
  }
  return null;
}

/**
 * Is the table genuinely waiting on this seat (stall detection, 「代佢做」)? Only the drawer while choosing, and
 * the host's seat while a team foul ruling holds the clock. Nobody during a drawing clock: it runs out by itself.
 */
function blocking(state, pid) {
  const s = state;
  const t = s.turn;
  if (!t || typeof pid !== 'string') return false;
  if (s.phase === 'choose') return pid === t.drawer;
  if (t.ruling && (s.phase === 'play' || s.phase === 'reveal')) return isHostPid(s, pid);
  return false;
}

function legalActions(state, pid) {
  const s = state;
  if (s.phase === 'over' || typeof pid !== 'string' || !s.order.includes(pid)) return [];
  const t = s.turn;
  const isDrawer = pid === t.drawer;
  const typed = s.cfg.guessMode === 'typed';
  const host = isHostPid(s, pid);
  const out = [];
  if (t.ruling) {
    // a team foul holds the clock: only the host's ruling (or voiding the turn) moves anything
    if (host) out.push({ type: 'rule', uphold: true }, { type: 'rule', uphold: false }, { type: 'void' });
    return out;
  }
  switch (s.phase) {
    case 'choose':
      if (isDrawer) {
        t.offers.forEach((o, i) => out.push({ type: 'pick', i }));
        if (t.rerolls < 1) out.push({ type: 'reroll' });
      }
      if (host) out.push({ type: 'void' });
      break;
    case 'play': {
      if (!LIVE_SUBS.includes(t.sub)) break;
      if (isDrawer) {
        if (typed) {
          if (t.sub === 'run') {
            for (const g of t.guesses) if (g.kind !== 'right' && !solvedBy(t, g.pid)) out.push({ type: 'accept', gid: g.id });
          }
        } else {
          for (const p of t.eligible) if (!solvedBy(t, p)) out.push({ type: 'accept', target: p });
          if (t.sub === 'grace' || (t.sub === 'buzzer' && t.solvers.length)) out.push({ type: 'undo-accept' });
        }
        if (t.sub === 'run' || t.sub === 'buzzer') out.push({ type: 'abandon' });
      } else if (typed && t.sub === 'run' && t.eligible.includes(pid) && !solvedBy(t, pid)
        && (t.rate[pid]?.n ?? 0) < MAX_GUESSES && !(t.rate[pid]?.lock)) {
        out.push({ type: 'guess', text: `估${(t.rate[pid]?.n ?? 0) + 1}號` });   // a representative valid example, unique per call
      }
      if (canFlag(s, pid)) out.push({ type: 'foul' });
      if (host) {
        if (t.sub === 'run' && t.T + EXTEND_MS <= MAX_TOTAL_MS) out.push({ type: 'extend' });
        out.push({ type: 'void' });
      }
      break;
    }
    case 'reveal':
      // late ✔ and late 🚩 are not listed: whether their 5 s window is still open depends on the clock
      if (host && t.outcome !== 'voided') out.push({ type: 'void' });
      break;
    default:
      break;
  }
  return out;
}

/**
 * The host phone's own buttons (the ⋯ menu), dispatched as @host: on one shared phone the host seat's on-screen 「主持」
 * bar is out of reach while another seat's screen is up. Only what changes the state right now: ＋30 秒 while a
 * drawing clock runs, the two rulings while a team foul is pending. Never 呢題作廢: the shell's 🗑️ 呢輪作廢 sits in the
 * same menu (with its confirm) and sends @void-round, which voids exactly the same turns, so a second one would only
 * double it — and skip the confirm.
 */
function hostActions(state) {
  const s = state;
  const t = s.turn;
  if (!t || s.phase === 'over') return [];
  if (t.ruling) {
    return [
      { label: '🚩 犯規成立（今輪冇分）', action: { type: 'rule', uphold: true } },
      { label: '▶️ 犯規唔成立，繼續', action: { type: 'rule', uphold: false } },
    ];
  }
  if (s.phase === 'play' && t.sub === 'run' && t.T + EXTEND_MS <= MAX_TOTAL_MS) {
    return [{ label: '⏱️ ＋30 秒', action: { type: 'extend' } }];
  }
  return [];
}

/** 「代佢做」 for a seat the table is waiting on (see `blocking`): the medium card, or "not upheld". */
function autoAct(state, pid) {
  const s = state;
  if (s.phase === 'over' || typeof pid !== 'string' || !s.order.includes(pid)) return null;
  const t = s.turn;
  if (s.phase === 'choose' && pid === t.drawer) return { type: 'pick', i: autoIndex(t.offers) };
  if (t.ruling && isHostPid(s, pid)) return { type: 'rule', uphold: false };
  return null;
}

// ---------- result ----------

function statsOf(s) {
  const st = Object.fromEntries(s.order.map((id) => [id, { drew: 0, drawerPts: 0, solved: 0, lvl3: 0 }]));
  let fastest = null;
  for (const e of s.history) {
    if (e.outcome === 'voided') continue;
    st[e.drawer].drew += 1;
    st[e.drawer].drawerPts += e.drawerPts;
    for (const x of e.solvers) {
      st[x.pid].solved += 1;
      if (e.level === 3) st[x.pid].lvl3 += 1;
      const ms = Math.max(0, x.T - x.rem);
      if (!fastest || ms < fastest.ms) fastest = { pid: x.pid, ms, w: e.w, T: x.T };
    }
  }
  return { st, fastest };
}

function result(state) {
  const s = state;
  if (s.phase !== 'over') return null;
  const nm = namer(s);
  const tn = teamNamer();
  const { st, fastest } = statsOf(s);
  const lines = [S.HEAD.rank];       // '── 標題 ──' lines start a foldable section on the results screen
  let winners;
  let summary;

  if (s.teams) {
    const order = s.teams.map((_, i) => i).sort((a, b) => s.teamScores[b] - s.teamScores[a] || a - b);
    const top = Math.max(...s.teamScores);
    const topTeams = order.filter((i) => s.teamScores[i] === top);
    winners = topTeams.flatMap((i) => s.teams[i].members);
    let rank = 0;
    order.forEach((i, idx) => {
      if (idx === 0 || s.teamScores[i] !== s.teamScores[order[idx - 1]]) rank = idx + 1;
      lines.push(S.teamRankLine({
        rank, label: tn(i), score: s.teamScores[i], members: s.teams[i].members.map(nm),
        tie: order.filter((j) => s.teamScores[j] === s.teamScores[i]).length > 1,
      }));
    });
    summary = S.summaryLine({ winners: topTeams.map(tn), top, allZero: top === 0 });
  } else {
    const key = (id) => [s.scores[id], st[id].solved, st[id].drawerPts];
    const cmp = (a, b) => { const x = key(a); const y = key(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || s.order.indexOf(a) - s.order.indexOf(b); };
    const ranked = s.order.slice().sort(cmp);
    const same = (a, b) => key(a).every((v, i) => v === key(b)[i]);
    winners = ranked.filter((id) => same(id, ranked[0]));
    let rank = 0;
    ranked.forEach((id, idx) => {
      if (idx === 0 || !same(id, ranked[idx - 1])) rank = idx + 1;
      lines.push(S.rankLine({
        rank, name: nm(id), score: s.scores[id], solved: st[id].solved, drawerPts: st[id].drawerPts,
        tie: ranked.filter((j) => same(j, id)).length > 1,
      }));
    });
    summary = S.summaryLine({
      winners: winners.map(nm), top: s.scores[ranked[0]], allZero: Math.max(...Object.values(s.scores)) === 0,
    });
  }

  // highlights — one shared by more than half the table highlights nobody, so it is left out
  const high = [];
  const standsOut = (ids) => ids.length > 0 && ids.length * 2 <= s.order.length;
  const avg = (id) => (st[id].drew ? st[id].drawerPts / st[id].drew : 0);
  const bestAvg = Math.max(...s.order.map(avg));
  if (!s.teams && bestAvg > 0) {
    const ids = s.order.filter((id) => avg(id) === bestAvg);
    if (standsOut(ids)) high.push(`🎨 最勁畫家：${S.joinNames(ids.map(nm))}（平均每次畫得 ${bestAvg.toFixed(1)} 分）`);
  }
  // only a real quick one: a solve in the first half of its turn (D10 — 「最快」 at 73 s of 80 reads as a joke)
  if (fastest && fastest.ms * 2 <= fastest.T) high.push(`⚡ 最快反應：${nm(fastest.pid)}（${(fastest.ms / 1000).toFixed(1)} 秒估中「${fastest.w}」）`);
  const most3 = Math.max(...s.order.map((id) => st[id].lvl3));
  const hardest = s.order.filter((id) => st[id].lvl3 === most3);
  if (most3 > 0 && standsOut(hardest)) {
    high.push(`⭐ 最多困難詞估中：${S.joinNames(hardest.map(nm))}（${most3} 條）`);
  }
  if (high.length) lines.push(S.HEAD.high, ...high);
  // one line per turn: who drew which word, who got it, the points — what the table could not all see live
  lines.push(S.HEAD.turns);
  for (const e of s.history) lines.push(S.turnLine(e, nm, tn));

  return {
    winners,
    summary,
    lines,
    linesTitle: '分數點嚟',      // the shell's default 「點解會咁」 suits a hidden-role reveal, not a ranking
    points: Object.fromEntries(s.order.map((id) => [id, winners.includes(id) ? 1 : 0])),
  };
}

export const engine = { setup, act, advance, view, cue, focus, blocking, canInk, autoAct, legalActions, hostActions, result };
