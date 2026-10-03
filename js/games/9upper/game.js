// ============================================================
// 瞎掰王 9upper — PURE module: meta, rules, config, engine.
// No DOM, no Math.random, no Date. Flow and wording: docs/games/9upper.md.
// Rules source: docs/research/9upper.md (verified printed-rulebook reading).
//
// Per round:  level → term → read → explain → judge → reveal   (then the next
// round, or `over`).  `level` only exists when levelMode is 'judge'.
// ============================================================

import { HOST, ACT, rint, shuffle, sample, seatOrder } from '../../core/engine-kit.js?v=1';
import * as S from './script.js?v=1';

// ---------- constants ----------

const START_SCORE = 3;         // rulebook: everybody starts on a 3-point token (no reason given)
const MISS_PENALTY = 3;        // 收皮啦 on the honest player
const MAX_SWAPS = 3;           // 換題 per round (the rulebook just says "redraw"; this only stops endless fishing)
const OFFICIAL_READ = 9;       // printed rulebook: the eyes-closed peek lasts 9 seconds
const LEVEL_MODES = ['mix', 'judge', '1', '2', '3'];
const RANGES = { laps: [0, 3], readSecs: [5, 30], speakSecs: [0, 300], callouts: [0, 2] };
const BOOLS = ['passPhone', 'scoreFloor', 'rePeek', 'antiStreak'];

// The categories of the term bank (js/data/9upper-terms.js, built from js/data/parts/9upper-*.js). They feed
// the lobby's category filter AND the level-2 hint decoys ("three categories, only one true"): a decoy that is
// not a real bank category would be spotted at once. tests/9upper.test.mjs fails if the bank grows a
// category that is missing here.
export const CATEGORIES = ['冷門中文詞語', '成語典故', '粵語俚語由來', '外語怪詞', '天文與太空', '科學與醫學名詞',
  '心理學效應', '自然現象', '奇怪動物', '奇怪植物', '歷史冷知識', '世界怪習俗與節日', '奇怪法律'];

// Only used when the bank cannot be loaded at all (offline first run, empty bank), so a round never dies.
const FALLBACK_TERMS = [
  { term: '雞尾酒會效應', cat: '心理學效應', level: 2, src: '心理學家 Colin Cherry 1953 年嘅聽覺研究',
    explain: '喺好嘈嘅環境入面，人仍然可以集中聽住一個人講嘢；就算冇留心其他人，聽到有人叫自己個名都會即刻留意到。' },
  { term: '馬太效應', cat: '心理學效應', level: 2, src: '社會學家 Robert K. Merton 1968 年提出，名出自《馬太福音》',
    explain: '強者愈強、弱者愈弱：本身已經有優勢嘅人，會更容易得到更多資源同機會。' },
  { term: '橡皮鴨除錯法', cat: '科學與醫學名詞', level: 3, src: '《The Pragmatic Programmer》（1999）',
    explain: '寫程式嗰陣，對住一隻橡皮鴨逐行解釋自己段碼，講住講住就會自己發現問題喺邊。' },
];

// ---------- meta ----------

export const meta = {
  id: '9upper',
  name: '瞎掰王 9upper',
  emoji: '🎭',
  accent: '#ff7a59',
  players: [3, 9],
  minutes: [15, 30],
  narration: 'optional',
  paperMode: false,
  singleDevice: 'full',
  banks: ['9upper'],
  css: true,
  blurb: '一本正經噏下去，邊個講嘅係真、邊個係瞎掰？',
};

// ---------- rules text ----------

export const rules = {
  quick: [
    '每輪一個人做諗樣；其他人得一個係老實人，其餘係 9upper。',
    '題目大家都見到，但淨係老實人睇到真正解釋（9 秒）。',
    '逐個解釋：老實人照實講，9upper 即場作。',
    '諗樣追問完，揀邊個係老實人。',
    '揀中：諗樣同老實人各得分；揀錯：被揀中嘅 9upper 得分。',
    '輪流做諗樣，最後最高分贏。',
  ],
  roles: [
    { id: 'judge', name: '諗樣', emoji: '🧠', team: 'neutral',
      text: '睇唔到真正解釋。叫人逐個解釋、隨便追問（但唔可以問人係咩身份），覺得離譜可以出收皮啦，最後揀邊個係老實人。'
        + '得分：揀中老實人，你同佢各得題目分（⭐ 數）；收皮啦中 9upper +1，中老實人 −3。' },
    { id: 'honest', name: '老實人', emoji: '🙋', team: 'good',
      text: '每輪得一個，睇到真正解釋。用自己嘅講法照實講，卡上冇寫嘅可以話「張卡冇寫」。'
        + '得分：諗樣揀中你，你同諗樣各得題目分。' },
    { id: 'bluffer', name: '9upper', emoji: '🤥', team: 'bad',
      text: '睇唔到真正解釋，要即場作一個似真嘅，扮到似老實人。'
        + '得分：諗樣揀錯咗你，淨係你得題目分；俾收皮啦中就 −1。' },
  ],
  sections: [
    { title: '玩法流程', body:
      '1. 諗樣係公開嘅，每輪向左傳。題目大家一齊睇（難度隨機，或者由設定決定）。\n'
      + '2. 有人已經識呢個詞？出聲，諗樣㩒「換題」，身份唔變。\n'
      + '3. 睇卡 9 秒：每個人㩒住自己張卡。老實人見到真正解釋，其他人（包括諗樣）見到另一段字，大家望電話嘅時間一樣長。\n'
      + '4. 解釋：諗樣叫人講，次序由佢話事。老實人照實講，9upper 即場作。諗樣可以問任何關於個詞嘅問題，但唔可以問人係咩身份；其他人都可以互相追問。\n'
      + '5. 諗樣覺得夠，隨時可以揀邊個係老實人（唔使等晒所有人講完）。\n'
      + '6. 揭曉身份、真正解釋同分數，下一位做諗樣。' },
    { title: '計分', body:
      '每個人開始有 3 分。題目有 1 至 3 粒星，D＝星數。\n'
      + '・揀中老實人：諗樣 +D，老實人 +D。\n'
      + '・揀錯（揀咗 9upper）：被揀中嗰個 9upper +D，諗樣同老實人冇分。\n'
      + '・收皮啦同揀人分開計，最後一齊結算。\n'
      + '・3–4 人每人做 3 次諗樣、5–7 人 2 次、8–9 人 1 次，玩完最高分贏；同分就一齊贏。' },
    { title: '收皮啦', body:
      '諗樣覺得某人講得太離譜，可以喺解釋或者揀人嗰陣對佢出收皮啦（每輪 1 張，設定可以改）。\n'
      + '出咗就收唔返，大家即刻見到；佢係咩身份要到揭曉先知。被出收皮啦嘅人照樣可以繼續講。\n'
      + '・對方係 9upper：佢 −1，諗樣 +1。\n'
      + '・對方係老實人：諗樣 −3。\n'
      + '冇把握唔好亂出：中老實人要賠 3 分。' },
    { title: '難度同提示', body:
      '⭐ 簡單（1 分）：提示話你知屬於邊一類。\n'
      + '⭐⭐ 中等（2 分）：提示俾三個類別，得一個啱。9upper 可以跟啱嗰個講，亦可以故意揀錯嗰個。\n'
      + '⭐⭐⭐ 困難（3 分）：冇提示。\n'
      + '說明書建議第一次玩用 ⭐ 題目（揀「新手」玩法）。' },
    { title: '用一部手機玩', body:
      '設定入面開「一部手機輪流睇」。睇卡嗰陣部手機由諗樣左手邊開始逐個傳：㩒「開始睇卡」，每人都係睇同樣秒數，夠鐘自動冚返，再交俾下一位。之後部手機放返諗樣度。' },
    { title: '小貼士', body:
      '・老實人：用自己嘅講法講，唔好照讀；唔知嘅細節可以話「張卡冇寫」。\n'
      + '・9upper：講得自信、有細節，唔好同其他人作得一模一樣。\n'
      + '・諗樣：追問細節，睇邊個答得太順或者太虛。\n'
      + '・睇卡嗰陣唔好露出表情；人人都望住電話，冇人知邊個先係睇緊真解釋。' },
  ],
};

// ---------- config ----------

export const lapsFor = (n) => (n <= 4 ? 3 : n <= 7 ? 2 : 1);

/** Named setups. A named preset fixes levelMode / laps / callouts; 'custom' shows those fields. */
export const PRESETS = Object.freeze({
  official: Object.freeze({ levelMode: 'mix', laps: 0, callouts: 1 }),
  newbie: Object.freeze({ levelMode: '1', laps: 1, callouts: 1 }),
  quick: Object.freeze({ levelMode: 'mix', laps: 1, callouts: 1 }),
});
const PRESET_IDS = ['official', 'newbie', 'quick', 'custom'];

const DEFAULTS = Object.freeze({
  preset: 'official', levelMode: 'mix', laps: 0, readSecs: OFFICIAL_READ, passPhone: false, speakSecs: 0,
  callouts: 1, scoreFloor: false, rePeek: false, antiStreak: false, topics: Object.freeze({ cats: Object.freeze([]) }),
});

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const allStrings = (a) => Array.isArray(a) && a.every((c) => typeof c === 'string');

/** The chosen categories, from the ConfigForm shape { cats: [...] } (a bare array is tolerated). */
function catsOf(v) {
  if (Array.isArray(v)) return allStrings(v) ? v : [];
  if (isObj(v)) {
    const list = Array.isArray(v.cats) ? v.cats : v.categories;
    return allStrings(list) ? list : [];
  }
  return [];
}

function asInt(v) {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof x === 'number' && Number.isInteger(x) ? x : NaN;
}

function keyOk(key, v) {
  if (key in RANGES) {
    const x = asInt(v);
    return x >= RANGES[key][0] && x <= RANGES[key][1];
  }
  if (key === 'preset') return PRESET_IDS.includes(String(v));
  if (key === 'levelMode') return LEVEL_MODES.includes(String(v));
  if (BOOLS.includes(key)) return typeof v === 'boolean';
  if (key === 'topics') {
    if (Array.isArray(v)) return allStrings(v);
    return isObj(v) && ['cats', 'categories'].every((k) => v[k] === undefined || allStrings(v[k]));
  }
  return false;
}

/** Fill gaps and coerce (the shell's <select> hands back strings). Raw: the preset is NOT applied. Never throws. */
function clean(cfg) {
  const c = isObj(cfg) ? cfg : {};
  const out = { ...DEFAULTS, topics: { cats: [] } };
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in c) || !keyOk(key, c[key])) continue;
    if (key in RANGES) out[key] = asInt(c[key]);
    else if (key === 'preset' || key === 'levelMode') out[key] = String(c[key]);
    else if (key === 'topics') out[key] = { cats: catsOf(c[key]).slice() };
    else out[key] = c[key];
  }
  return out;
}

/** The settings the game actually uses: raw values with the named preset laid over them. */
function norm(cfg) {
  const out = clean(cfg);
  if (out.preset !== 'custom') Object.assign(out, PRESETS[out.preset]);
  return out;
}

const lapsOf = (cfg, n) => cfg.laps || lapsFor(n);
const totalRoundsFor = (cfg, n) => n * lapsOf(cfg, n);

/** 「6 人：1 諗樣 + 1 老實人 + 4 個 9upper — 最啱玩嘅人數」 */
function headcountLine(n) {
  const why = n === 3 ? '人少，諗樣盲估都有一半機會中'
    : n === 4 ? '人少，追問更針對'
      : n <= 7 ? '最啱玩嘅人數'
        : '好熱鬧，諗樣最難估';
  return `${n} 人：1 諗樣 + 1 老實人 + ${n - 2} 個 9upper — ${why}`;
}

function presetHelp(id, n) {
  const L = lapsFor(n);
  switch (id) {
    case 'official': return `跟說明書：${n} 人每人做 ${L} 次諗樣（共 ${n * L} 輪），難度隨機，每輪 1 張收皮啦。`;
    case 'newbie': return `第一次玩：全部 ⭐ 簡單題（說明書建議第一局咁玩），每人做 1 次諗樣（共 ${n} 輪）。`;
    case 'quick': return `快玩：每人做 1 次諗樣（共 ${n} 輪），難度隨機。`;
    default: return '自己揀難度、輪數同收皮啦張數。';
  }
}

const PRESET_LABEL = { official: '官方玩法', newbie: '新手（第一次玩）', quick: '快玩', custom: '自訂' };

export const config = {
  defaults(n, prev, env) {
    const out = clean(prev);
    if (env && env.singleDevice) out.passPhone = true;
    return out;
  },

  validate(cfg, n) {
    const warnings = [];
    if (!Number.isInteger(n) || n < meta.players[0] || n > meta.players[1]) {
      return { ok: false, message: `瞎掰王要 ${meta.players[0]}–${meta.players[1]} 個人玩。`, warnings };
    }
    const c = isObj(cfg) ? cfg : {};
    const label = {
      preset: '玩法', levelMode: '題目難度', laps: '做諗樣次數', readSecs: '睇卡時間', passPhone: '一部手機輪流睇',
      speakSecs: '解釋時限', callouts: '收皮啦張數', scoreFloor: '分數下限', rePeek: '再睇一次',
      antiStreak: '老實人唔連續做', topics: '題目類別',
    };
    for (const key of Object.keys(DEFAULTS)) {
      if (key in c && !keyOk(key, c[key])) return { ok: false, message: `「${label[key]}」設定唔啱。`, warnings };
    }
    const m = norm(c);
    if (m.readSecs < OFFICIAL_READ) warnings.push(`睇卡時間短過官方嘅 ${OFFICIAL_READ} 秒，老實人可能睇唔切。`);
    if (totalRoundsFor(m, n) > 20) warnings.push(`一共 ${totalRoundsFor(m, n)} 輪，會玩好耐。`);
    if (m.callouts === 2 && n === 3) warnings.push('3 個人玩，出兩張收皮啦一定會中老實人。');
    if (m.antiStreak && n <= 4) warnings.push('3–4 個人玩，「老實人唔連續做」唔會生效（會等於話俾諗樣知邊個係老實人）。');
    return { ok: true, message: '', warnings };
  },

  fields(cfg, n) {
    const m = norm(cfg);
    const out = [
      { key: 'preset', label: '玩法', type: 'select', help: presetHelp(m.preset, n),
        options: PRESET_IDS.map((id) => ({ value: id, label: PRESET_LABEL[id] })) },
    ];
    if (m.preset === 'custom') {
      out.push(
        { key: 'levelMode', label: '題目難度', type: 'select',
          options: [
            { value: 'mix', label: '每輪隨機（說明書玩法）' },
            { value: 'judge', label: '諗樣每輪自己揀' },
            { value: '1', label: '固定 ⭐ 簡單' },
            { value: '2', label: '固定 ⭐⭐ 中等' },
            { value: '3', label: '固定 ⭐⭐⭐ 困難' },
          ],
          help: '星愈多提示愈少，分數愈高。' },
        { key: 'laps', label: '每人做幾次諗樣', type: 'int', min: 0, max: 3,
          help: `0＝跟說明書（3–4 人 3 次、5–7 人 2 次、8–9 人 1 次）。而家共 ${totalRoundsFor(m, n)} 輪。` },
        { key: 'callouts', label: '收皮啦（每輪張數）', type: 'int', min: 0, max: 2,
          help: '說明書每輪 1 張；0＝唔玩收皮啦。' },
      );
    }
    out.push(
      { key: 'readSecs', label: '睇卡時間（秒）', type: 'seconds', min: 5, max: 30, step: 1,
        help: `說明書係 ${OFFICIAL_READ} 秒。每個人睇嘅時間一樣長。` },
      { key: 'passPhone', label: '一部手機輪流睇', type: 'bool',
        help: '得一部手機就開：睇卡嗰陣逐個傳，每人睇同樣秒數。' },
      { key: 'speakSecs', label: '每人解釋時限（秒）', type: 'seconds', min: 0, max: 300, help: '0＝唔限時。' },
      { key: 'scoreFloor', label: '分數唔會低過 0', type: 'bool' },
      { key: 'rePeek', label: '老實人解釋途中可以再睇', type: 'bool', help: '說明書係睇一次就冇得再睇。' },
      { key: 'antiStreak', label: '老實人唔連續做', type: 'bool',
        help: '上一輪嘅老實人呢輪唔會再做（5 人或以上先生效）。諗樣會少咗一個人要估。' },
      { key: 'topics', label: '題目類別', type: 'categories', help: '唔揀＝全部類別。',
        options: CATEGORIES.map((c) => ({ value: c, label: c })) },
    );
    return out;
  },

  summary(cfg, n) {
    const m = norm(cfg);
    const total = totalRoundsFor(m, n);
    const lines = [headcountLine(n), `${PRESET_LABEL[m.preset]}：共 ${total} 輪（每人做 ${lapsOf(m, n)} 次諗樣）`];
    lines.push({
      judge: '難度：諗樣自己揀', mix: '難度：隨機', 1: '難度：⭐ 簡單', 2: '難度：⭐⭐ 中等', 3: '難度：⭐⭐⭐ 困難',
    }[m.levelMode]);
    lines.push(m.passPhone ? `一部手機輪流睇，每人 ${m.readSecs} 秒` : `睇卡 ${m.readSecs} 秒`);
    if (m.speakSecs > 0) lines.push(`每人解釋限時 ${m.speakSecs} 秒`);
    lines.push(m.callouts > 0 ? `收皮啦 ${m.callouts} 張` : '唔玩收皮啦');
    if (m.topics.cats.length) lines.push(`類別：${m.topics.cats.join('、')}`);
    if (m.scoreFloor) lines.push('分數唔會低過 0');
    if (m.rePeek) lines.push('老實人可以再睇');
    if (m.antiStreak) lines.push('老實人唔連續做');
    return lines;
  },
};

// ---------- engine helpers ----------

const nameOf = (s, pid) => s.players.find((p) => p.id === pid)?.name ?? '?';
const namer = (s) => (pid) => nameOf(s, pid);

/** Seats after `pid`, going round the table, excluding `pid`. */
function after(order, pid) {
  const i = order.indexOf(pid);
  return [...order.slice(i + 1), ...order.slice(0, i)];
}

const speaker = (s) => (s.phase === 'explain' ? s.round.speaker ?? null : null);

function usable(e) {
  return !!e && typeof e.term === 'string' && e.term !== '' && typeof e.explain === 'string' && e.explain !== '';
}

function buildHint(ctx, cat, level) {
  if (!cat) return null;
  if (level === 1) return { kind: 'one', options: [cat] };
  if (level === 2) {
    const decoys = sample(ctx.rng, CATEGORIES.filter((c) => c !== cat), 2);
    return { kind: 'three', options: shuffle(ctx.rng, [cat, ...decoys]) };
  }
  return null;
}

/** core/bag.js throws if the bank was never loaded; a round must survive that. */
function safeDraw(bag, predicate) {
  if (!bag) return null;
  try { return bag.draw('9upper', predicate); } catch { return null; }
}

/** Draw the round's term. Relaxes level, then category, then everything, then the emergency card. */
function drawTerm(s, ctx) {
  const want = s.round.levelWanted;
  const cats = s.cfg.topics.cats;
  const okCat = (e) => !cats.length || cats.includes(e.cat);
  const okLevel = (e) => !want || e.level === want;
  const tries = [(e) => okCat(e) && okLevel(e), okLevel, okCat, () => true];
  let e = null;
  for (const f of tries) {
    e = safeDraw(ctx.bag, (x) => usable(x) && f(x));
    if (usable(e)) break;
    e = null;
  }
  if (!e) e = FALLBACK_TERMS[rint(ctx.rng, FALLBACK_TERMS.length)];
  const level = [1, 2, 3].includes(e.level) ? e.level : 2;
  const cat = typeof e.cat === 'string' ? e.cat : '';
  s.round.term = {
    term: e.term, explain: e.explain, cat, level, src: typeof e.src === 'string' ? e.src : '',
    hint: buildHint(ctx, cat, level),
  };
}

function clearTimer(s) {
  s.deadline = null;
  s.timerLabel = '';
}

/** Term on the table: everybody reads it, anybody who already knows it says so (→ swap). */
function showTerm(s, ctx) {
  drawTerm(s, ctx);
  s.phase = 'term';
  clearTimer(s);
}

/** The 9-second step. Together: one window for every phone. Pass: one equal window per reader, in turn. */
function startRead(s, ctx) {
  const r = s.round;
  s.phase = 'read';
  r.readDone = [];
  r.readStarted = false;
  if (s.cfg.passPhone) {
    r.reader = r.readers[0];
    clearTimer(s);
  } else {
    r.reader = null;
    s.deadline = ctx.now + s.cfg.readSecs * 1000;
    s.timerLabel = '睇卡時間';
  }
}

function startPeek(s, ctx) {
  s.round.readStarted = true;
  s.deadline = ctx.now + s.cfg.readSecs * 1000;
  s.timerLabel = `${nameOf(s, s.round.reader)} 睇卡`;
}

function endPeek(s, ctx) {
  const r = s.round;
  r.readDone.push(r.reader);
  r.readStarted = false;
  const next = r.readers.find((p) => !r.readDone.includes(p)) ?? null;
  r.reader = next;
  if (next) clearTimer(s);
  else startExplain(s, ctx);
}

function setTurnTimer(s, ctx) {
  if (s.cfg.speakSecs > 0) {
    s.deadline = ctx.now + s.cfg.speakSecs * 1000;
    s.timerLabel = `${nameOf(s, speaker(s))} 講緊`;
  } else clearTimer(s);
}

function startExplain(s, ctx) {
  const r = s.round;
  s.phase = 'explain';
  r.reader = null;
  r.spoken = [];
  r.speaker = r.explainers[0];
  setTurnTimer(s, ctx);
}

function toJudge(s) {
  s.phase = 'judge';
  s.round.speaker = null;
  clearTimer(s);
}

function endTurn(s, ctx) {
  const r = s.round;
  if (r.speaker && !r.spoken.includes(r.speaker)) r.spoken.push(r.speaker);
  r.speaker = r.explainers.find((p) => !r.spoken.includes(p)) ?? null;
  if (!r.speaker) toJudge(s);
  else setTurnTimer(s, ctx);
}

/** The 諗樣 decides who speaks next (rulebook: any order he likes). The interrupted speaker goes back to waiting. */
function callSpeaker(s, ctx, target) {
  s.round.speaker = target;
  setTurnTimer(s, ctx);
}

function chooseHonest(s, ctx, explainers) {
  let pool = explainers;
  // optional anti-streak: only when at least 3 candidates remain, so it never comes close to naming the 老實人
  if (s.cfg.antiStreak && s.lastHonest && pool.includes(s.lastHonest) && pool.length - 1 >= 3) {
    pool = pool.filter((p) => p !== s.lastHonest);
  }
  return pool[rint(ctx.rng, pool.length)];
}

function startRound(s, ctx) {
  s.roundNo += 1;
  const judge = s.judges[s.roundNo - 1];
  const ring = after(s.order, judge);
  const first = rint(ctx.rng, ring.length);              // backlog #20: first speaker random over every 玩家
  const explainers = [...ring.slice(first), ...ring.slice(0, first)];
  s.round = {
    n: s.roundNo, judge, explainers, readers: ring,
    honest: chooseHonest(s, ctx, ring),
    term: null, levelWanted: 0, swaps: 0,
    reader: null, readStarted: false, readDone: [],
    speaker: null, spoken: [], called: [], pick: null, reveal: null,
  };
  clearTimer(s);
  if (s.cfg.levelMode === 'judge') {
    s.phase = 'level';
    return;
  }
  s.round.levelWanted = s.cfg.levelMode === 'mix' ? 0 : Number(s.cfg.levelMode);
  showTerm(s, ctx);
}

function chooseLevel(s, ctx, level) {
  s.round.levelWanted = level;
  showTerm(s, ctx);
}

function nextRound(s, ctx) {
  if (s.roundNo >= s.totalRounds) {
    s.phase = 'over';
    clearTimer(s);
    return;
  }
  startRound(s, ctx);
}

/** Settle the round atomically: net deltas per player, then apply (optionally floored at 0). */
function resolve(s, target) {
  const r = s.round;
  const d = r.term.level;
  const correct = target === r.honest;
  const parts = [];   // why each point moved — feeds the reveal lines and the end-of-game breakdown
  if (correct) parts.push({ pid: r.judge, why: 'judgeHit', pts: d }, { pid: r.honest, why: 'honestHit', pts: d });
  else parts.push({ pid: target, why: 'fool', pts: d });
  const called = r.called.map((pid) => ({ pid, hit: pid === r.honest ? 'honest' : 'bluffer' }));
  for (const c of called) {
    if (c.hit === 'honest') parts.push({ pid: r.judge, why: 'callMiss', pts: -MISS_PENALTY });
    else parts.push({ pid: r.judge, why: 'callHit', pts: 1 }, { pid: c.pid, why: 'called', pts: -1 });
  }
  const nominal = {};
  for (const p of parts) nominal[p.pid] = (nominal[p.pid] ?? 0) + p.pts;

  const changes = [];
  for (const pid of s.order) {
    if (!(pid in nominal)) continue;
    const before = s.scores[pid];
    const now = s.cfg.scoreFloor ? Math.max(0, before + nominal[pid]) : before + nominal[pid];
    s.scores[pid] = now;
    if (nominal[pid] !== 0 || now !== before) changes.push({ pid, delta: now - before, nominal: nominal[pid] });
  }

  const st = s.stats;
  st[r.judge].judged += 1;
  if (correct) st[r.judge].caught += 1; else st[target].fooled += 1;
  for (const c of called) st[r.judge][c.hit === 'honest' ? 'callMiss' : 'callHit'] += 1;

  const rv = {
    judge: r.judge, honest: r.honest, pick: target, correct, d,
    term: r.term.term, explain: r.term.explain, src: r.term.src, cat: r.term.cat, level: d,
    called, changes,
  };
  rv.lines = S.revealLines(rv, namer(s));
  r.pick = target;
  r.reveal = rv;
  s.lastHonest = r.honest;
  s.history.push({
    n: r.n, judge: r.judge, honest: r.honest, pick: target, correct, d, term: rv.term, explain: rv.explain,
    src: rv.src, cat: rv.cat, level: d, swaps: r.swaps, called: called.map((c) => ({ ...c })),
    changes: changes.map((c) => ({ ...c })), parts: parts.map((p) => ({ ...p })),
  });
  s.phase = 'reveal';
  clearTimer(s);
}

// ---------- cues ----------

function rawCue(s) {
  const r = s.round;
  if (!r) return null;
  const nm = namer(s);
  switch (s.phase) {
    case 'level':
      return { id: `r${r.n}:level`, text: S.cueLevel(r.n, nm(r.judge)), minMs: 2500 };
    case 'term':
      return { id: `r${r.n}:term:${r.swaps}`, minMs: 3000,
        text: S.cueTerm({ n: r.n, judge: nm(r.judge), term: r.term.term, hint: r.term.hint,
          intro: s.cfg.levelMode !== 'judge' && r.swaps === 0, swapped: r.swaps > 0 }) };
    case 'read':
      return { id: `r${r.n}:read`, minMs: 1500,
        text: S.cueRead({ readSecs: s.cfg.readSecs, pass: s.cfg.passPhone, first: nm(r.readers[0]) }) };
    case 'explain':
      return { id: `r${r.n}:explain`, minMs: 2500,
        text: S.cueExplain({ term: r.term.term, first: nm(r.explainers[0]), judge: nm(r.judge) }) };
    case 'judge':
      return { id: `r${r.n}:judge`, text: S.cueJudge({ judge: nm(r.judge) }), minMs: 2500 };
    case 'reveal':
      return { id: `r${r.n}:reveal`, text: S.cueReveal(r.reveal, nm), minMs: 4000 };
    default:
      return null;
  }
}

// ---------- actions ----------

function skipStep(s, ctx) {
  const r = s.round;
  switch (s.phase) {
    case 'level': chooseLevel(s, ctx, 1 + rint(ctx.rng, 3)); break;
    case 'term': startRead(s, ctx); break;
    case 'read':
      if (!s.cfg.passPhone) startExplain(s, ctx);
      else if (r.readStarted) endPeek(s, ctx);
      else startPeek(s, ctx);   // never skip a reader: the 老實人 must get to see the card
      break;
    case 'explain': endTurn(s, ctx); break;
    case 'reveal': nextRound(s, ctx); break;
    default: break;   // `judge` needs a real decision; use autoAct for a stalled 諗樣
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
  return s;   // ACT.AUTO is resolved by the session through autoAct()
}

function act(state, msg, ctx) {
  const s = state;
  const pid = msg?.pid;
  const a = msg?.action;
  if (!a || typeof a !== 'object' || typeof a.type !== 'string' || s.phase === 'over') return s;
  if (pid === HOST) return hostAct(s, a, ctx);
  if (typeof pid !== 'string' || !s.order.includes(pid)) return s;

  const r = s.round;
  const isJudge = pid === r.judge;
  const isTarget = (t) => typeof t === 'string' && r.explainers.includes(t);

  switch (a.type) {
    case 'level': {
      const lv = typeof a.level === 'string' ? Number(a.level) : a.level;
      if (s.phase === 'level' && isJudge && [1, 2, 3].includes(lv)) chooseLevel(s, ctx, lv);
      return s;
    }
    case 'swap':
      // rulebook: if anybody already knows the term, redraw BEFORE the 9-second step; roles stay, nothing scores
      if (s.phase === 'term' && isJudge && r.swaps < MAX_SWAPS) {
        r.swaps += 1;
        drawTerm(s, ctx);
      }
      return s;
    case 'start':
      if (s.phase === 'term' && isJudge) startRead(s, ctx);
      return s;
    case 'peek':
      if (s.phase === 'read' && s.cfg.passPhone && pid === r.reader && !r.readStarted) startPeek(s, ctx);
      return s;
    case 'done':
      if (s.phase === 'explain' && (isJudge || pid === speaker(s))) endTurn(s, ctx);
      return s;
    case 'call':
      if (s.phase === 'explain' && isJudge && isTarget(a.target) && a.target !== r.speaker
        && !r.spoken.includes(a.target)) callSpeaker(s, ctx, a.target);
      return s;
    case 'decide':
      if (s.phase === 'explain' && isJudge) toJudge(s);
      return s;
    case 'callout':
      // the called player keeps talking: muting is an app-only house rule, not in the rulebook
      if ((s.phase === 'explain' || s.phase === 'judge') && isJudge && isTarget(a.target)
        && !r.called.includes(a.target) && r.called.length < s.cfg.callouts) r.called.push(a.target);
      return s;
    case 'pick':
      if (s.phase === 'judge' && isJudge && isTarget(a.target)) resolve(s, a.target);
      return s;
    case 'next':
      if (s.phase === 'reveal' && isJudge) nextRound(s, ctx);
      return s;
    default:
      return s;
  }
}

// ---------- engine ----------

function setup({ players, config: cfg, rng, now, bag }) {
  const c = norm(cfg);
  const order = seatOrder(players);
  const n = order.length;
  c.laps = lapsOf(c, n);
  const start = rint(rng, n);   // round 1: the 諗樣 card is dealt at random with the others
  const judges = Array.from({ length: n * c.laps }, (_, i) => order[(start + i) % n]);
  const s = {
    game: '9upper', cfg: c,
    players: players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, color: p.color })),
    order, phase: 'term', deadline: null, timerLabel: '',
    totalRounds: judges.length, roundNo: 0, judges, lastHonest: null,
    scores: Object.fromEntries(order.map((id) => [id, START_SCORE])),
    stats: Object.fromEntries(order.map((id) => [id, { judged: 0, caught: 0, fooled: 0, callHit: 0, callMiss: 0 }])),
    history: [], cueAck: '', round: null,
  };
  startRound(s, { rng, now, bag });
  return s;
}

function advance(state, ctx) {
  const s = state;
  if (s.deadline == null) return s;
  if (typeof ctx?.now === 'number' && ctx.now < s.deadline) return s;
  if (s.phase === 'read') {
    if (!s.cfg.passPhone) startExplain(s, ctx);
    else if (s.round.readStarted) endPeek(s, ctx);
  } else if (s.phase === 'explain') endTurn(s, ctx);
  return s;
}

/** May this seat's phone show the explanation right now? (Only ever the 老實人.) */
function mayRead(s, seat) {
  const r = s.round;
  if (seat !== r.honest) return false;
  if (s.phase === 'read') return !s.cfg.passPhone || (r.reader === seat && r.readStarted);
  return s.cfg.rePeek && (s.phase === 'explain' || s.phase === 'judge');
}

/** Has this 玩家 been dealt their card yet (it opens at the 9-second step)? */
function hasCard(s, seat) {
  const r = s.round;
  if (s.phase === 'explain' || s.phase === 'judge') return true;
  if (s.phase !== 'read') return false;
  return !s.cfg.passPhone || r.readDone.includes(seat) || (r.reader === seat && r.readStarted);
}

function view(state, pid) {
  const s = state;
  const r = s.round;
  const seat = typeof pid === 'string' && s.order.includes(pid) ? pid : null;
  const isJudge = seat !== null && seat === r.judge;
  const pass = !!s.cfg.passPhone;

  const v = {
    me: seat,
    phase: s.phase,
    title: `第 ${r.n}/${s.totalRounds} 輪`,
    subtitle: `${nameOf(s, r.judge)} 做諗樣`,
    round: { n: r.n, total: s.totalRounds },
    judge: r.judge,
    explainers: r.explainers.slice(),
    scores: { ...s.scores },
    term: r.term ? {
      text: r.term.term, level: r.term.level,
      hint: r.term.hint ? { kind: r.term.hint.kind, options: r.term.hint.options.slice() } : null,
    } : null,
    readMode: pass ? 'pass' : 'together',
    readSecs: s.cfg.readSecs,
    reading: s.phase === 'read' && pass
      ? { pid: r.reader, started: r.readStarted, done: r.readDone.slice(), order: r.readers.slice() }
      : null,
    turn: s.phase === 'explain'
      ? { pid: r.speaker, spoken: r.spoken.slice(), total: r.explainers.length }
      : null,
    callouts: {
      max: s.cfg.callouts, left: Math.max(0, s.cfg.callouts - r.called.length), used: r.called.slice(),
    },
    canSwap: s.phase === 'term' && isJudge && r.swaps < MAX_SWAPS,
    swapsLeft: MAX_SWAPS - r.swaps,
    last: r.n >= s.totalRounds,
    rePeek: s.cfg.rePeek,
    mine: null,
    myRole: isJudge ? 'judge' : null,
    reveal: null,
  };
  if (s.deadline != null) { v.deadline = s.deadline; v.timerLabel = s.timerLabel; }

  if (seat && !isJudge && hasCard(s, seat)) {
    const honest = seat === r.honest;
    const mine = { honest };
    // the explanation is only ever on the honest seat's phone: during its window, or later with rePeek
    if (mayRead(s, seat)) mine.explain = r.term.explain;
    v.mine = mine;
    v.myRole = honest ? 'honest' : 'bluffer';
  }

  if ((s.phase === 'reveal' || s.phase === 'over') && r.reveal) {
    const rv = r.reveal;
    v.reveal = {
      judge: rv.judge, honest: rv.honest, pick: rv.pick, correct: rv.correct, d: rv.d,
      term: rv.term, explain: rv.explain, src: rv.src, cat: rv.cat, level: rv.level,
      called: rv.called.map((c) => ({ pid: c.pid, hit: c.hit })),
      changes: rv.changes.map((c) => ({ pid: c.pid, delta: c.delta, nominal: c.nominal })),
      lines: rv.lines.slice(),
    };
  }

  v.hint = S.hintFor({
    phase: s.phase,
    role: seat === null ? 'table' : isJudge ? 'judge' : 'player',
    myRole: v.myRole,
    pass,
    readSecs: s.cfg.readSecs,
    readerIsMe: !!seat && r.reader === seat,
    readStarted: r.readStarted,
    readDone: !!seat && r.readDone.includes(seat),
    speakingNow: !!seat && speaker(s) === seat,
    callouts: s.cfg.callouts,
    judgeName: nameOf(s, r.judge),
    readerName: r.reader ? nameOf(s, r.reader) : '',
    last: r.n >= s.totalRounds,
  });
  return v;
}

function cue(state) {
  const c = rawCue(state);
  return c && c.id !== state.cueAck ? c : null;
}

function focus(state) {
  const r = state.round;
  switch (state.phase) {
    case 'read':
      return { pids: state.cfg.passPhone ? (r.reader ? [r.reader] : []) : r.explainers.slice() };
    case 'level': case 'term': case 'explain': case 'judge': case 'reveal':
      return { pids: [r.judge] };
    default:
      return null;
  }
}

function legalActions(state, pid) {
  const s = state;
  if (s.phase === 'over' || typeof pid !== 'string' || !s.order.includes(pid)) return [];
  const r = s.round;
  const isJudge = pid === r.judge;
  const out = [];
  const callouts = () => {
    if (r.called.length >= s.cfg.callouts) return;
    for (const t of r.explainers) if (!r.called.includes(t)) out.push({ type: 'callout', target: t });
  };
  switch (s.phase) {
    case 'level':
      if (isJudge) for (const level of [1, 2, 3]) out.push({ type: 'level', level });
      break;
    case 'term':
      if (isJudge) {
        out.push({ type: 'start' });
        if (r.swaps < MAX_SWAPS) out.push({ type: 'swap' });
      }
      break;
    case 'read':
      if (s.cfg.passPhone && pid === r.reader && !r.readStarted) out.push({ type: 'peek' });
      break;
    case 'explain':
      if (isJudge || pid === speaker(s)) out.push({ type: 'done' });
      if (isJudge) {
        out.push({ type: 'decide' });
        for (const t of r.explainers) {
          if (t !== r.speaker && !r.spoken.includes(t)) out.push({ type: 'call', target: t });
        }
        callouts();
      }
      break;
    case 'judge':
      if (isJudge) {
        for (const t of r.explainers) out.push({ type: 'pick', target: t });
        callouts();
      }
      break;
    case 'reveal':
      if (isJudge) out.push({ type: 'next' });
      break;
    default:
      break;
  }
  return out;
}

function autoAct(state, pid, ctx) {
  const s = state;
  if (s.phase === 'over' || !s.order.includes(pid)) return null;
  const r = s.round;
  const isJudge = pid === r.judge;
  const rnd = (n) => (ctx && ctx.rng ? rint(ctx.rng, n) : 0);
  switch (s.phase) {
    case 'level': return isJudge ? { type: 'level', level: 1 + rnd(3) } : null;
    case 'term': return isJudge ? { type: 'start' } : null;
    case 'read': return s.cfg.passPhone && pid === r.reader && !r.readStarted ? { type: 'peek' } : null;
    case 'explain': return isJudge || pid === speaker(s) ? { type: 'done' } : null;
    case 'judge': return isJudge ? { type: 'pick', target: r.explainers[rnd(r.explainers.length)] } : null;
    case 'reveal': return isJudge ? { type: 'next' } : null;
    default: return null;
  }
}

function result(state) {
  const s = state;
  if (s.phase !== 'over') return null;
  const nm = namer(s);
  const top = Math.max(...s.order.map((id) => s.scores[id]));
  const winners = s.order.filter((id) => s.scores[id] === top);
  const lines = [];

  // why everybody ended where they did: start + every reason points moved
  const ranked = s.order.slice().sort((a, b) => s.scores[b] - s.scores[a] || s.order.indexOf(a) - s.order.indexOf(b));
  for (const id of ranked) lines.push(S.scoreBreakdown(id, s.scores[id], START_SCORE, s.history, nm, winners.includes(id)));

  const best = (key) => {
    const max = Math.max(...s.order.map((id) => s.stats[id][key]));
    return max > 0 ? { max, ids: s.order.filter((id) => s.stats[id][key] === max) } : null;
  };
  const fooled = best('fooled');
  if (fooled) lines.push(`🤥 最勁 9up：${fooled.ids.map(nm).join('、')}（呃過諗樣 ${fooled.max} 次）`);

  const judges = s.order.filter((id) => s.stats[id].judged > 0);
  const ratio = (id) => s.stats[id].caught / s.stats[id].judged;
  const bestRatio = judges.length ? Math.max(...judges.map(ratio)) : 0;
  if (bestRatio > 0) {
    const ids = judges.filter((id) => ratio(id) === bestRatio);
    lines.push(`🧠 最準諗樣：${ids.map((id) => `${nm(id)}（估中 ${s.stats[id].caught}/${s.stats[id].judged}）`).join('、')}`);
  }
  const hits = s.order.reduce((a, id) => a + s.stats[id].callHit, 0);
  const misses = s.order.reduce((a, id) => a + s.stats[id].callMiss, 0);
  if (hits + misses > 0) lines.push(`🛑 收皮啦出咗 ${hits + misses} 次：中 9upper ${hits} 次，中老實人 ${misses} 次`);

  for (const h of s.history) lines.push(...S.roundBlock(h, nm, s.totalRounds));

  return {
    winners,
    summary: S.summaryLine(winners, top, nm),
    lines,
    points: { ...s.scores },
  };
}

export const engine = { setup, act, advance, view, cue, focus, autoAct, legalActions, result };
