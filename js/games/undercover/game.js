// ============================================================
// undercover/game.js — 誰是臥底 (Who Is the Undercover). PURE engine.
//
// No DOM, no Math.random, no Date: randomness comes from ctx.rng, time from
// ctx.now, words from ctx.bag (bank 'undercover', entries { a, b, cat, level }).
// Imports only engine-kit. Play flow and wording: docs/games/undercover.md.
// Rules: docs/research/undercover.md (its "## Verification" section wins).
//
// Phases:  deal → speak → discuss → vote → elim → (speak | over)
//   deal     everybody looks at their own word, taps 記住喇
//   speak    alive players describe their word one by one (kind 'round'),
//            or the tied candidates defend themselves (kind 'pk')
//   discuss  free talk; any seat can open the vote, or the optional timer does
//   vote     secret ballots (kind 'main', or 'pk' among the tied)
//   elim     the result: tallies, who is out (+ role), the white-card guess
//   over     everything is revealed; result() is non-null only here
//
// Decisions where DESIGN.md §15 is silent (also in docs/games/undercover.md):
//  - Public control actions (`done`, `start-vote`, `continue`) are accepted from
//    ANY seat, not only the speaker: on a shared phone the device acts as whoever
//    is active, which is rarely the speaker. The UI decides who is shown the button.
//  - `@next` first completes the current narration cue (so a human narrator in
//    read-aloud mode pressing 下一步 after reading does not skip a step), and only
//    a second press skips the step (speaker, discussion, vote, guess, result).
//  - Re-reading your own word needs no engine action: every seat's view carries its
//    own word, the UI keeps it behind a hold-to-peek card, and on a shared phone the
//    shell's seat switcher (with its pass gate) puts the right seat on screen.
//  - config.words = { cats: string[], levels: number[] }, empty array = all. The
//    'categories' Field carries `bank` and `matches(value, entry)` so the form can
//    compute 已用/總數 without knowing the entry shape.
//  - config.preset = 'std' | 'blank' | 'custom'. A named preset fixes the role counts
//    for the current head-count (they follow n); only 'custom' reads undercovers/blanks.
//  - Anti-streak needs last game's special seats: setup() reads them from an optional
//    `carry` argument, and result().carry hands them over for the next game.
//  - view.hint is per seat but built from public facts only (phase, alive, whose turn,
//    voted or not, the announced white card) — never from a role or a word.
//  - result.points = { pid: n } for winners only.
// ============================================================

import { HOST, ACT, seatOrder, shuffle, pick, nextSeat, tally } from '../../core/engine-kit.js?v=20261003102525';
import WORDS from '../../data/undercover-words.js?v=20261003102525';   // only to list the categories; words are drawn through ctx.bag

// ---------- constants ----------

const BANK = 'undercover';
const MIN_N = 4;
const MAX_N = 12;
const GUESS_MS = 90_000;        // the eliminated white card has this long to type a guess
const RESULT_MS = 20_000;       // the result screen moves on by itself after this
const MAX_NO_ELIM = 2;          // after this many rounds in a row without an elimination, force one
const MAX_SECS = 600;
const SIZE_CUTOFF = 7;          // size_based (3DM 565026): fewer than 7 at the start → last 2, otherwise last 3

/** Categories in the order the bank lists them (the curator keeps adding some, so never hard-code them). */
const CATEGORIES = [...new Set(WORDS.map((e) => e?.cat).filter((c) => typeof c === 'string' && c))];
const LEVELS = [{ value: 1, label: '簡單' }, { value: 2, label: '中等' }, { value: 3, label: '困難' }];

/** Infiltrator win thresholds (research "Scoring & win conditions"). `parity` is the project default. */
const WIN_MODES = ['parity', 'last3', 'last3OrParity', 'civ_le_2', 'one_civ', 'size_based'];
const TIE_MODES = ['pk', 'pk-random', 'skip'];
/** Who votes in a PK: everybody alive (research default ALL_ALIVE, the CN classic 「大家」) or only the non-tied (NON_TIED). */
const PK_VOTERS = ['all', 'others'];
/** Who wins on a correct white-card guess: the whole infiltrator side (default) or that white card alone (Yanstar). */
const GUESS_WINNERS = ['team', 'blank'];
const PRESETS = ['std', 'blank', 'custom'];

const ROLE_NAME = { civilian: '平民', undercover: '臥底', blank: '白板' };
const FALLBACK_PAIR = { a: '士多啤梨', b: '車厘子', cat: '食物', level: 1 };

/** Research setup table, "Project default (no blank)" column: undercovers by head-count. */
const REC_UNDERCOVERS = { 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 3, 11: 3, 12: 3 };
/** Research setup table, "Blank-on option" column: [undercovers, blanks]. Not allowed at 4 (2 v 2 is already parity). */
const REC_WITH_BLANK = { 5: [1, 1], 6: [1, 1], 7: [1, 1], 8: [1, 1], 9: [2, 1], 10: [2, 1], 11: [2, 1], 12: [3, 1] };

// ---------- meta & rules ----------

export const meta = {
  id: 'undercover',
  name: '誰是臥底',
  emoji: '🕵️',
  accent: '#a78bfa',
  players: [MIN_N, MAX_N],
  minutes: [15, 30],
  narration: 'optional',
  paperMode: false,
  singleDevice: 'full',
  blurb: '人人一個詞，臥底嘅詞好似但唔同 — 一句嘢形容，投出臥底！',
  banks: [BANK],
  css: true,
};

export const rules = {
  quick: [
    '大部分人同一個詞（平民），一兩個人嘅詞好似但唔同（臥底）。',
    '冇人知自己係邊邊，要聽其他人點講。',
    '輪流講一句形容自己個詞，唔可以講出個詞或者入面嘅字。',
    '講完一輪就投票，最多票嗰個出局。',
    '白板冇詞要扮有；出局可以估平民個詞，估中即刻贏。',
    '臥底同白板全部出局，平民贏；佢哋人數追上平民，臥底方贏。',
  ],
  roles: [
    {
      id: 'civilian', name: '平民', emoji: '🧑', team: 'civilians',
      text: '你攞到大部分人嘅詞，但唔知自己係平民。講一句形容個詞，聽邊個講得怪。點贏：投晒所有臥底同白板出局。',
    },
    {
      id: 'undercover', name: '臥底', emoji: '🕵️', team: 'infiltrators',
      text: '你個詞同大家好似但唔同，而你一開始唔知。聽人點講，覺得唔對路就扮同大家一樣。點贏：捱到臥底方人數追上平民（預設規則）。',
    },
    {
      id: 'blank', name: '白板', emoji: '⬜', team: 'infiltrators',
      text: '你冇詞，淨係你自己知。聽人點講，扮到似有。點贏：同臥底一齊捱到人數追上平民；出局嗰陣有一次機會估平民個詞，估中即刻贏。',
    },
  ],
  sections: [
    {
      title: '點玩',
      body: '1. 每人用自己部手機睇詞語，記住就㩒「記住喇」，張卡會自動鎖住。\n'
        + '2. 隨機揀一個人開始（任何人都可以係第一個），跟座位次序，每人講一句形容自己個詞。\n'
        + '3. 大家都講完，自由討論：邊個最似臥底？\n'
        + '4. 一齊投票，最多票嗰個出局，並公開身份。\n'
        + '5. 未分勝負就再嚟一輪，由上輪第一個講嘅人下一位開始，淨係未出局嘅人講嘢同投票。',
    },
    {
      title: '形容嘅規矩',
      body: '一人一句，要真係講緊自己個詞：臥底唔可以為咗收埋自己而亂講無關嘅嘢。\n'
        + '唯一硬規矩：唔可以講出自己個詞，或者入面任何一個字。\n'
        + '好多人仲會加（開波前講好）：唔可以翻譯做其他語言、唔可以講幾多個字、唔可以抄前面嘅人講過嘅。\n'
        + '呢啲靠大家自覺，App 聽唔到你講乜。',
    },
    {
      title: '平票',
      body: '預設：最高票平手嘅人再講多一句（PK），然後全部人只喺佢哋之間再投一次（佢哋自己都要投，唔可以投自己）；再平票就今輪冇人出局。\n'
        + '可以改成：淨係冇份 PK 嘅人投；PK 再平票就隨機抽一個；或者平票即係冇人出局。\n'
        + '全部人都同票（例如大家輪住投下一個）就唔使 PK，今輪冇人出局。\n'
        + '亦可以開「要過半數先出局」：最高票都唔夠一半就冇人出局，咁就唔會有 PK。\n'
        + '連續兩輪冇人出局，第三輪一定有人出局（喺最高票嘅人入面隨機抽），避免無限循環。',
    },
    {
      title: '白板',
      body: '白板冇詞語，自己知道。被投出局之後可以用手機打出一次平民個詞：估中即刻贏（就算平民仲佔多數）；估錯就照出局，遊戲繼續。\n'
        + '估中邊個贏：預設係臥底同白板一齊贏，亦可以改成淨係白板自己贏。估中臥底個詞唔算。\n'
        + '白板要估詞，所以出局嗰陣身份一定公開，就算設定咗唔公開身份。',
    },
    {
      title: '勝負',
      body: '平民贏：所有臥底同白板都出局。\n'
        + '臥底方贏（預設）：未出局嘅臥底同白板人數 ≥ 未出局嘅平民。\n'
        + '其他玩法：「剩 3 個人」（經典：剩 3 人臥底方仲喺度就贏；臥底方 2 個以上嗰陣，人數追上都未算贏）、'
        + '「剩 3 人或者人數追上」（邊個先到都得，多臥底局建議用）、「平民剩 2 個」、「平民剩 1 個」、'
        + '「6 人或以下剩 2 人、7 人以上剩 3 人」。\n'
        + '所有玩法：平民全部出局，臥底方即刻贏；白板估中平民詞語，即刻贏。',
    },
    {
      title: '公平',
      body: '第一個講嘅人喺所有人入面隨機揀，臥底同白板都有機會。\n'
        + '可以開「白板唔會第一個講」：但咁樣第一個講嘅人就一定唔係白板。\n'
        + '可以開「避免連續做臥底／白板」：上局做臥底或白板嘅人，今局盡量做平民 — 但佢哋會因此估到自己係平民。',
    },
    {
      title: '單機玩法',
      body: '一部手機傳住玩都得：派詞語時逐個接手機睇，投票亦係逐個投。發言時部手機放喺枱中間，講完㩒「講完喇」。\n'
        + '想再睇返自己個詞：㩒上面嘅座位掣換返自己（會有交接卡，要本人接機），再㩒「睇返我個詞」。',
    },
  ],
};

// ---------- config ----------

const toInt = (v, fallback) => {
  const x = Math.trunc(Number(v));
  return v !== '' && v != null && Number.isFinite(x) ? x : fallback;
};
const secs = (v) => Math.max(0, Math.min(MAX_SECS, toInt(v, 0)));
const clampN = (n) => Math.max(MIN_N, Math.min(MAX_N, toInt(n, MIN_N)));

function limits(n) {
  return { maxInf: Math.max(0, Math.floor((n - 1) / 2)), maxBlank: n >= 10 ? 2 : 1 };
}

function recommended(n) {
  return { undercovers: REC_UNDERCOVERS[clampN(n)], blanks: 0 };
}

/** Role counts of a named preset at head-count n, or null ('custom', or 'blank' at 4 players). */
function presetCounts(id, n) {
  if (id === 'std') return recommended(n);
  if (id === 'blank') {
    const r = REC_WITH_BLANK[clampN(n)];
    return r ? { undercovers: r[0], blanks: r[1] } : null;
  }
  return null;
}

/**
 * Do the infiltrators win with `c` civilians and `i` infiltrators (undercovers + white cards) alive?
 * Every threshold needs `i >= 1`. Safety net for all of them: no civilian left (`c == 0`) is a win —
 * pure last3 (and size_based) could otherwise never end with 4+ infiltrators alive.
 * `n0` = head-count at the start (size_based only).
 */
function infiltratorsWin(c, i, win, n0) {
  if (i <= 0) return false;
  if (c <= 0) return true;
  const t = c + i;
  switch (win) {
    case 'last3': return t <= 3;
    case 'last3OrParity': return t <= 3 || i >= c;
    case 'civ_le_2': return c <= 2;
    case 'one_civ': return c <= 1;
    case 'size_based': return t <= ((n0 ?? t) < SIZE_CUTOFF ? 2 : 3);
    default: return i >= c;                         // parity: equal or more
  }
}

/** Which rule ended it (for the explanation). Call only when infiltratorsWin() is true. */
function winWhy(c, i, win, n0) {
  if (c <= 0) return 'wipe';
  switch (win) {
    case 'last3': return 'last3';
    case 'last3OrParity': return i >= c ? 'parity' : 'last3';
    case 'civ_le_2': return 'civ2';
    case 'one_civ': return 'civ1';
    case 'size_based': return (n0 ?? c + i) < SIZE_CUTOFF ? 'last2' : 'last3';
    default: return 'parity';
  }
}

/** How many civilians the table may wrongly vote out before the infiltrators win, +1 (= the fatal one). */
function lossAfter(c, i, win, n0 = c + i) {
  let k = 1;
  while (!infiltratorsWin(c - k, i, win, n0)) k++;
  return k;
}

const winText = (win) => ({
  parity: '臥底方人數追上平民就贏',
  last3: '剩 3 個人臥底方仲喺度就贏',
  last3OrParity: '剩 3 個人或者人數追上平民就贏',
  civ_le_2: '平民剩 2 個或以下就贏',
  one_civ: '平民剩 1 個就贏',
  size_based: '6 人或以下剩 2 人、7 人以上剩 3 人就贏',
}[win]);
const winLabel = (win) => ({
  parity: '人數追上平民（預設）',
  last3: '剩 3 個人（經典）',
  last3OrParity: '剩 3 人或者人數追上（邊個先到）',
  civ_le_2: '平民剩 2 個',
  one_civ: '平民剩 1 個',
  size_based: '人少剩 2 人、人多剩 3 人',
}[win]);
const tieText = (tie) => ({ pk: 'PK 再投，再平票冇人出局', 'pk-random': 'PK 再投，再平票隨機抽一個', skip: '平票即係冇人出局' }[tie]);
const lossText = (loss) => (loss <= 1 ? '平民投錯一次就輸' : `平民投錯 ${loss} 次先輸`);

/** Accept { cats, levels }, or a bare array of categories; anything else = no filter. */
function normaliseWords(w) {
  const src = Array.isArray(w) ? { cats: w } : (w && typeof w === 'object' ? w : {});
  const cats = Array.isArray(src.cats) ? [...new Set(src.cats.filter((c) => typeof c === 'string' && c))] : [];
  const levels = Array.isArray(src.levels)
    ? [...new Set(src.levels.map(Number).filter((l) => l === 1 || l === 2 || l === 3))].sort()
    : [];
  return { cats, levels };
}

function matches(words, e) {
  const w = normaliseWords(words);
  if (w.cats.length && !w.cats.includes(e?.cat)) return false;
  if (w.levels.length && !w.levels.includes(e?.level)) return false;
  return true;
}

/**
 * Fill defaults and coerce (the form may send strings). Does NOT clamp: validate() reports problems.
 * A named preset decides the role counts; without a preset, explicit counts mean 'custom'.
 */
function merge(cfg, n) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const explicit = c.undercovers != null || c.blanks != null;
  const preset = PRESETS.includes(c.preset) ? c.preset : (explicit ? 'custom' : 'std');
  const rec = recommended(n);
  const pc = preset === 'custom' ? null : (presetCounts(preset, n) ?? rec);   // a preset this n lacks: validate() refuses it
  return {
    preset,
    undercovers: pc ? pc.undercovers : toInt(c.undercovers, rec.undercovers),
    blanks: pc ? pc.blanks : toInt(c.blanks, rec.blanks),
    blankGuess: c.blankGuess !== false,
    guessWinner: GUESS_WINNERS.includes(c.guessWinner) ? c.guessWinner : 'team',
    win: WIN_MODES.includes(c.win) ? c.win : 'parity',
    tie: TIE_MODES.includes(c.tie) ? c.tie : 'pk',
    pkVoters: PK_VOTERS.includes(c.pkVoters) ? c.pkVoters : 'all',
    majority: c.majority === true,
    revealRole: c.revealRole !== false,
    abstain: c.abstain === true,
    blankNeverFirst: c.blankNeverFirst === true,     // house rule, off by default (BACKLOG #20; it tells everyone the first speaker is no white card)
    antiStreak: c.antiStreak === true,
    speakSec: secs(c.speakSec),
    discussSec: secs(c.discussSec),
    voteSec: secs(c.voteSec),
    words: normaliseWords(c.words),
  };
}

/** merge() + clamp the role counts so setup() can never deal an impossible table. */
function fit(cfg, n) {
  const c = merge(cfg, n);
  const lim = limits(n);
  c.blanks = Math.max(0, Math.min(lim.maxBlank, c.blanks));
  c.undercovers = Math.max(0, Math.min(lim.maxInf - c.blanks, c.undercovers));
  if (c.undercovers + c.blanks < 1) c.undercovers = 1;
  return c;
}

/** Legal role split for n (counts only; the threshold check is in validate). */
function countsFit(u, b, n) {
  const lim = limits(n);
  return u >= 0 && b >= 0 && u + b >= 1 && b <= lim.maxBlank && u + b <= lim.maxInf;
}

function presetTag(id, n, win) {
  const pc = presetCounts(id, n);
  if (!pc) return null;
  const loss = lossAfter(n - pc.undercovers - pc.blanks, pc.undercovers + pc.blanks, win, n);
  if (id === 'std') return '新手友善';
  return loss <= 1 ? '好刺激' : '多啲變化';
}

function presetLabel(id, n, win) {
  if (id === 'custom') return '自訂人數';
  const pc = presetCounts(id, n);
  return `${n} 人：${pc.undercovers} 臥底${pc.blanks ? ` + ${pc.blanks} 白板` : ''} — ${presetTag(id, n, win)}`;
}

/** The one-line reason under the preset picker. */
function presetReason(c, n) {
  if (c.preset === 'custom') return '自己揀臥底同白板人數。';
  const civ = n - c.undercovers - c.blanks;
  const loss = lossAfter(civ, c.undercovers + c.blanks, c.win, n);
  if (c.preset === 'std') return `冇白板，最易上手；${lossText(loss)}。`;
  return loss <= 1 ? `加白板好刺激：${lossText(loss)}。` : `加個白板，多啲變化；${lossText(loss)}。`;
}

function wordsText(words) {
  const w = normaliseWords(words);
  const cats = w.cats.length ? w.cats.join('、') : '全部類別';
  const lv = w.levels.length ? w.levels.map((l) => LEVELS.find((x) => x.value === l).label).join('、') : '全部難度';
  return `詞庫：${cats}（${lv}）`;
}

function wordStats(bag, words) {
  try {
    const s = bag?.stats?.(BANK, (e) => matches(words, e));
    return s && Number.isFinite(s.total) ? { stats: { used: s.used ?? 0, total: s.total } } : {};
  } catch {
    return {};                                      // bank not loaded yet: show no numbers rather than fail the form
  }
}

function describeRoles(c, n) {
  return `平民 ${n - c.undercovers - c.blanks} · 臥底 ${c.undercovers}${c.blanks ? ` · 白板 ${c.blanks}` : ''}`;
}

export const config = {
  defaults(n, prev) {
    const k = clampN(n);
    const base = merge(prev, k);
    let preset = base.preset;
    if (preset !== 'custom' && !presetCounts(preset, k)) preset = 'std';          // e.g. 'blank' at 4 players
    if (preset === 'custom' && !countsFit(base.undercovers, base.blanks, k)) preset = 'std';
    const counts = presetCounts(preset, k) ?? { undercovers: base.undercovers, blanks: base.blanks };
    return { ...base, preset, ...counts };
  },

  validate(cfg, n) {
    const warnings = [];
    if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) {
      return { ok: false, message: `誰是臥底要 ${MIN_N} 至 ${MAX_N} 人。`, warnings };
    }
    const c = merge(cfg, n);
    const lim = limits(n);
    if (c.preset !== 'custom' && !presetCounts(c.preset, n)) {
      return { ok: false, message: `${n} 人唔可以加白板，揀過第二個組合。`, warnings };
    }
    if (c.undercovers < 0 || c.blanks < 0) return { ok: false, message: '人數唔可以係負數。', warnings };
    if (c.undercovers + c.blanks < 1) return { ok: false, message: '臥底同白板加埋最少要有 1 個。', warnings };
    if (c.blanks > lim.maxBlank) {
      return { ok: false, message: n >= 10 ? '白板最多 2 個。' : '10 人以下白板最多 1 個。', warnings };
    }
    if (c.undercovers + c.blanks > lim.maxInf) {
      return {
        ok: false,
        message: `${n} 人局臥底同白板加埋最多 ${lim.maxInf} 個，平民一定要過半。`,
        warnings,
      };
    }
    const civ = n - c.undercovers - c.blanks;
    const inf = c.undercovers + c.blanks;
    if (infiltratorsWin(civ, inf, c.win, n)) {
      return { ok: false, message: '咁樣一開波臥底方就已經贏咗，揀過第二個組合或者勝負玩法。', warnings };
    }
    const loss = lossAfter(civ, inf, c.win, n);
    if (loss <= 1) warnings.push('平民投錯 1 個平民，臥底方就贏 — 好難平民。');
    else if (loss >= 8) warnings.push(`平民要投錯 ${loss} 個平民先會輸 — 臥底方好難贏，可以加多個臥底。`);
    if (c.win === 'last3' && inf >= 3) {
      warnings.push('臥底方 3 個或以上，「剩 3 個人」會好難贏（人數追上都未算）。多臥底建議揀「剩 3 人或者人數追上」。');
    }
    if (n <= 5 && c.blanks > 0) warnings.push('人少加白板會好難玩，建議 6 人以上先加。');
    if (c.undercovers === 0) warnings.push('冇臥底，淨係得白板：平民個詞全部人都有，只有白板要扮。');
    if (!c.blankGuess && c.blanks > 0) warnings.push('白板出局唔可以估詞，白板會弱啲。');
    return { ok: true, message: `${describeRoles(c, n)} ✓`, warnings };
  },

  /**
   * `extra.bag` (optional, third argument): when the lobby passes the content bag, the 'categories' field also
   * carries `stats: { used, total }` for the current filter (the form prints 已用 / 總數). Without it the field
   * still has `bank` and `matches`, so the caller can work the numbers out itself.
   * Role counts are edited only under the 自訂 preset; white-card settings only show when there is a white card.
   */
  fields(cfg, n, extra) {
    const c = merge(cfg, n);
    const lim = limits(n);
    const civ = n - c.undercovers - c.blanks;
    const loss = civ > 0 && c.undercovers + c.blanks > 0 ? lossAfter(civ, c.undercovers + c.blanks, c.win, n) : null;
    const secHelp = '0 = 唔限時。';
    const presetIds = PRESETS.filter((id) => id === 'custom' || presetCounts(id, n));
    const out = [
      {
        key: 'preset', label: '角色組合', type: 'select',
        options: presetIds.map((id) => ({ value: id, label: presetLabel(id, n, c.win) })),
        help: presetReason(c, n),
      },
    ];
    if (c.preset === 'custom') {
      out.push(
        {
          key: 'undercovers', label: '臥底人數', type: 'int',
          min: c.blanks > 0 ? 0 : 1, max: Math.max(0, lim.maxInf - c.blanks),
          help: `平民 ${Math.max(0, civ)} 人${loss ? `，${lossText(loss)}` : ''}。`,
        },
        {
          key: 'blanks', label: '白板人數', type: 'int',
          min: 0, max: Math.max(0, Math.min(lim.maxBlank, lim.maxInf - c.undercovers)),
          help: '白板冇詞語，要扮到似有。10 人以下最多 1 個。',
        },
      );
    }
    out.push({
      key: 'win', label: '臥底方點樣贏', type: 'select',
      options: WIN_MODES.map((v) => ({ value: v, label: winLabel(v) })),
      help: '預設：臥底同白板人數 ≥ 平民就贏。「剩 3 個人」係經典玩法，但臥底多嘅時候好難贏。',
    });
    if (c.blanks > 0) {
      out.push({ key: 'blankGuess', label: '白板出局可以估詞', type: 'bool', help: '估中平民個詞即刻贏。' });
      if (c.blankGuess) {
        out.push({
          key: 'guessWinner', label: '白板估中，邊個贏', type: 'select',
          options: [{ value: 'team', label: '臥底同白板一齊贏（預設）' }, { value: 'blank', label: '淨係白板自己贏' }],
        });
      }
    }
    out.push(
      {
        key: 'tie', label: '平票點算', type: 'select',
        options: TIE_MODES.map((v) => ({ value: v, label: tieText(v) })),
        help: 'PK：平票嘅人再講多一句，然後再投一次，只可以投佢哋。',
      },
      {
        key: 'pkVoters', label: 'PK 邊個投', type: 'select',
        options: [{ value: 'all', label: '全部人（預設）' }, { value: 'others', label: '淨係冇份 PK 嘅人' }],
        help: '兩個人平票嗰陣兩樣一樣；三個或以上平票先有分別。',
      },
      {
        key: 'majority', label: '要過半數先出局', type: 'bool',
        help: '最高票都唔夠一半就冇人出局（大陸部分玩法）。開咗就唔會有 PK。',
      },
      {
        key: 'revealRole', label: '出局者公開身份', type: 'bool',
        help: '熄咗就只話「出局」，唔講係平民定臥底。白板要估詞，身份一定公開。',
      },
      { key: 'abstain', label: '容許棄票', type: 'bool', help: '熄咗就一定要投一個人。' },
    );
    if (c.blanks > 0) {
      out.push({
        key: 'blankNeverFirst', label: '白板唔會第一個講', type: 'bool',
        help: '民間玩法。開咗之後，第一個講嘅人一定唔係白板（大家都會知）。',
      });
    }
    out.push(
      {
        key: 'antiStreak', label: '避免連續做臥底／白板', type: 'bool',
        help: '上局做臥底或白板嘅人，今局盡量做平民。佢哋會因此估到自己係平民。',
      },
      { key: 'speakSec', label: '每人發言限時（秒）', type: 'seconds', min: 0, max: 120, help: `${secHelp}時間到就跳過。` },
      { key: 'discussSec', label: '討論限時（秒）', type: 'seconds', min: 0, max: 300, help: `${secHelp}時間到自動開始投票。` },
      { key: 'voteSec', label: '投票限時（秒）', type: 'seconds', min: 0, max: 120, help: `${secHelp}未投嘅人當棄票。` },
      {
        key: 'words', label: '詞庫', type: 'categories', bank: BANK,
        options: CATEGORIES.map((v) => ({ value: v, label: v })),
        levels: LEVELS,
        matches: (value, entry) => matches(value, entry),
        help: '唔揀 = 全部。已用過嘅詞暫時唔會再出。',
        ...wordStats(extra?.bag, c.words),
      },
    );
    return out;
  },

  summary(cfg, n) {
    const c = merge(cfg, n);
    const tag = c.preset === 'custom' ? '自訂' : presetTag(c.preset, n, c.win);
    const lines = [
      `${describeRoles(c, n)}${tag ? `（${tag}）` : ''}`,
      `勝負：${winText(c.win)}`,
      `平票：${tieText(c.tie)}`,
      wordsText(c.words),
    ];
    if (c.pkVoters === 'others') lines.push('PK 淨係冇份 PK 嘅人投');
    if (c.majority) lines.push('要過半數先出局');
    if (c.blanks > 0) {
      lines.push(c.blankGuess ? '白板出局可以估詞' : '白板出局唔可以估詞');
      if (c.blankGuess && c.guessWinner === 'blank') lines.push('白板估中淨係白板自己贏');
      if (c.blankNeverFirst) lines.push('白板唔會第一個講');
    }
    if (c.antiStreak) lines.push('避免同一個人連續做臥底／白板');
    if (!c.revealRole) lines.push('出局者唔公開身份');
    if (c.abstain) lines.push('容許棄票');
    if (c.speakSec) lines.push(`發言限時 ${c.speakSec} 秒`);
    if (c.discussSec) lines.push(`討論限時 ${c.discussSec} 秒`);
    if (c.voteSec) lines.push(`投票限時 ${c.voteSec} 秒`);
    return lines;
  },
};

// ---------- words ----------

/** Same word, ignoring spaces, punctuation, width and case. (No 簡繁 folding — see docs, open issue.) */
function normaliseWord(w) {
  return String(w ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function validPair(e) {
  return e && typeof e.a === 'string' && typeof e.b === 'string'
    && normaliseWord(e.a) !== '' && normaliseWord(e.b) !== '' && normaliseWord(e.a) !== normaliseWord(e.b);
}

function drawPair(bag, cfg) {
  const filter = (e) => matches(cfg.words, e);
  let e = bag?.draw?.(BANK, filter) ?? null;
  let relaxed = false;
  if (!validPair(e)) {
    relaxed = true;                                  // nothing matches the filter: ignore it rather than fail
    e = bag?.draw?.(BANK) ?? null;
  }
  if (!validPair(e)) e = FALLBACK_PAIR;
  return { entry: e, relaxed };
}

// ---------- helpers on state ----------

const nameOf = (s, pid) => s.names[pid] ?? String(pid);
const names = (s, pids) => pids.map((p) => nameOf(s, p)).join('、');
const isSeat = (s, pid) => typeof pid === 'string' && s.seats.includes(pid);
const isAlive = (s, pid) => s.alive.includes(pid);
const isBlank = (s, pid) => s.roles[pid] === 'blank';
const isInfiltrator = (s, pid) => s.roles[pid] === 'undercover' || s.roles[pid] === 'blank';
const roleLabel = (r) => ROLE_NAME[r] ?? '?';

function aliveCounts(s) {
  let c = 0;
  let u = 0;
  let b = 0;
  for (const p of s.alive) {
    if (s.roles[p] === 'civilian') c++;
    else if (s.roles[p] === 'undercover') u++;
    else b++;
  }
  return { c, u, b, i: u + b, t: c + u + b };
}

/** Research win-check order, steps 2–3 (step 1, the guess, is in finishElim). */
function winnerNow(s) {
  const { c, i } = aliveCounts(s);
  const n0 = s.seats.length;
  if (i === 0) return { side: 'civilians', why: 'allOut', c, i };
  if (!infiltratorsWin(c, i, s.cfg.win, n0)) return null;
  return { side: 'infiltrators', why: winWhy(c, i, s.cfg.win, n0), c, i };
}

/** Roles of eliminated players are announced unless the host turned that off — a white card must guess, so it is always public. */
function disclose(s, role) {
  return s.cfg.revealRole || (role === 'blank' && s.cfg.blankGuess) ? role : null;
}

function setTimer(s, ctx, sec, label) {
  if (sec > 0) {
    s.deadline = (ctx?.now ?? 0) + sec * 1000;
    s.timerLabel = label;
  } else {
    s.deadline = null;
    s.timerLabel = null;
  }
}

/** Unique per speaking step; doubles as the narration cue id. */
const speakId = (s) => `speak:${s.round}:${s.speakKind}:${s.turn}`;

/** Views must not alias engine state. */
const dup = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

const rotateFrom = (list, first) => {
  const i = list.indexOf(first);
  return i <= 0 ? list.slice() : list.slice(i).concat(list.slice(0, i));
};

// ---------- phase transitions ----------

function startRound(s, ctx) {
  const first = s.round === 1 ? s.starter : nextSeat(s.seats, s.firstSeat, (p) => isAlive(s, p));
  s.firstSeat = first;
  s.roundOrder = rotateFrom(s.alive, first);
  beginSpeaking(s, ctx, 'round', s.roundOrder);
}

function beginSpeaking(s, ctx, kind, order) {
  s.phase = 'speak';
  s.speakKind = kind;
  s.order = order.slice();
  s.turn = 0;
  setTimer(s, ctx, s.cfg.speakSec, '發言');
}

function endTurn(s, ctx) {
  s.turn++;
  if (s.turn < s.order.length) { setTimer(s, ctx, s.cfg.speakSec, '發言'); return; }
  if (s.speakKind === 'round') beginDiscuss(s, ctx);
  else beginVote(s, ctx, 'pk');
}

function beginDiscuss(s, ctx) {
  s.phase = 'discuss';
  setTimer(s, ctx, s.cfg.discussSec, '討論');
}

function beginVote(s, ctx, kind) {
  s.phase = 'vote';
  s.voteKind = kind;
  s.ballots = {};
  if (kind === 'main') {
    s.candidates = s.alive.slice();
    s.voters = s.alive.slice();
  } else {
    s.candidates = s.pkCands.slice();
    // ALL_ALIVE (default): everybody votes, the tied only for each other. NON_TIED: only the others vote.
    // Never empty: a PK needs fewer tied players than alive ones (a full-table tie skips it).
    s.voters = s.cfg.pkVoters === 'others' ? s.alive.filter((p) => !s.pkCands.includes(p)) : s.alive.slice();
  }
  setTimer(s, ctx, s.cfg.voteSec, '投票');
}

const targetsFor = (s, pid) => s.candidates.filter((c) => c !== pid);

/** Research "Voting & resolution": resolveVote + resolveTie, plus the no-elimination streak guard. */
function resolveVote(s, ctx) {
  const ballots = {};
  for (const v of s.voters) ballots[v] = s.ballots[v] ?? null;     // a missing ballot (timeout, host skip) is an abstention
  const { counts, top, max } = tally(ballots);
  const valid = Object.values(ballots).filter((t) => t != null).length;

  const e = {
    seq: s.history.length, round: s.round, voteKind: s.voteKind, kind: 'none',
    out: null, cands: [], counts, ballots, top, forced: false, random: false, reason: null, guess: null, next: null,
  };

  if (max === 0) {
    e.reason = 'nobody';
  } else if (s.voteKind === 'main' && s.cfg.majority && max * 2 <= valid) {
    e.reason = 'nomajority';                        // ss911 / Sina: only more than half the votes puts somebody out
  } else if (top.length === 1) {
    e.kind = 'out';
    e.out = top[0];
  } else if (s.voteKind === 'pk') {
    if (s.cfg.tie === 'pk-random') {
      e.kind = 'out';
      e.out = pick(ctx.rng, top);
      e.random = true;
    } else {
      e.reason = 'pktie';
    }
  } else if (top.length >= s.alive.length) {
    e.reason = 'alltied';                           // everybody tied (a vote cycle): a PK would be meaningless
  } else if (s.cfg.tie === 'skip') {
    e.reason = 'tie';
  } else {
    e.kind = 'pk';
    e.cands = s.seats.filter((p) => top.includes(p));       // seat order, for the PK ballot
  }

  // Loop guard: too many rounds in a row without anybody leaving.
  if (e.kind === 'none' && s.noElimStreak >= MAX_NO_ELIM) {
    e.kind = 'out';
    e.out = pick(ctx.rng, top.length ? top : s.alive);
    e.forced = true;
  }

  s.elim = e;
  s.history.push({
    seq: e.seq, round: e.round, voteKind: e.voteKind, outcome: e.kind, out: e.out, reason: e.reason,
    cands: e.cands.slice(), forced: e.forced, random: e.random, counts, ballots, guess: null,
  });
  s.phase = 'elim';
  s.timerLabel = null;

  if (e.kind === 'out') eliminate(s, ctx, e);
  else {
    if (e.kind === 'pk') s.pkCands = e.cands.slice();
    else s.noElimStreak++;
    finishElim(s, ctx, e);
  }
}

function eliminate(s, ctx, e) {
  s.alive = s.alive.filter((p) => p !== e.out);
  s.noElimStreak = 0;
  s.outs.push({ pid: e.out, round: s.round, role: s.roles[e.out] });
  if (isBlank(s, e.out) && s.cfg.blankGuess) {
    // The guess runs before the win check, even when this elimination would hand the civilians the win.
    e.guess = { pending: true, word: null, correct: null, timeout: false };
    s.deadline = (ctx?.now ?? 0) + GUESS_MS;
    s.timerLabel = '估詞';
  } else {
    finishElim(s, ctx, e);
  }
}

/** The elimination (and any guess) is settled: decide what `continue` leads to. */
function finishElim(s, ctx, e) {
  let w = null;
  if (e.guess?.correct) {
    w = s.cfg.guessWinner === 'blank'
      ? { side: 'blank', why: 'guess', guesser: e.out, ...aliveCounts(s) }
      : { side: 'infiltrators', why: 'guess', guesser: e.out, ...aliveCounts(s) };
  } else if (e.kind === 'out') {
    w = winnerNow(s);
  }
  if (w) { s.win = w; e.next = 'over'; } else e.next = e.kind === 'pk' ? 'pk' : 'round';
  s.deadline = (ctx?.now ?? 0) + RESULT_MS;
  s.timerLabel = null;
}

function leaveElim(s, ctx) {
  const e = s.elim;
  if (e.next === 'over') { toOver(s); return; }
  if (e.next === 'pk') {
    beginSpeaking(s, ctx, 'pk', s.roundOrder.filter((p) => e.cands.includes(p)));
    return;
  }
  s.round++;
  startRound(s, ctx);
}

function toOver(s) {
  s.phase = 'over';
  s.deadline = null;
  s.timerLabel = null;
}

function settleGuess(s, ctx, word, timeout) {
  const e = s.elim;
  const correct = !timeout && word !== '' && s.pair.accept.some((w) => normaliseWord(w) === normaliseWord(word));
  e.guess = { pending: false, word, correct, timeout };
  s.history[e.seq].guess = { word, correct, timeout };
  finishElim(s, ctx, e);
}

// ---------- narration & explanations ----------

function countsText(c) {
  const parts = [`${c.civilians} 個平民`];
  if (c.undercovers) parts.push(`${c.undercovers} 個臥底`);
  if (c.blanks) parts.push(`${c.blanks} 個白板`);
  return parts.join('、');
}

function reasonText(s) {
  const w = s.win;
  switch (w.why) {
    case 'allOut':
      if (s.counts0.undercovers && s.counts0.blanks) return '所有臥底同白板都被投出局，平民贏。';
      return s.counts0.blanks ? '白板被投出局，平民贏。' : '所有臥底都被投出局，平民贏。';
    case 'parity': return `場上剩低 ${w.c} 個平民、${w.i} 個臥底方，臥底方人數追上平民，臥底方贏。`;
    case 'last3':
    case 'last2': return `場上淨係剩 ${w.c + w.i} 個人，臥底方仲有人喺度，臥底方贏。`;
    case 'civ2': return `平民淨係剩 ${w.c} 個，臥底方仲有人喺度，臥底方贏。`;
    case 'civ1': return '平民淨係剩 1 個，臥底方贏。';
    case 'wipe': return '平民全部出局，臥底方贏。';
    case 'guess': {
      const who = nameOf(s, w.guesser);
      return w.side === 'blank'
        ? `白板 ${who} 出局之後估中平民嘅詞語「${s.pair.civ}」，白板自己贏。`
        : `白板 ${who} 出局之後估中平民嘅詞語「${s.pair.civ}」，臥底方即刻贏。`;
    }
    default: return '';
  }
}

const SIDE_NAME = { civilians: '平民', infiltrators: '臥底方', blank: '白板' };

/** Why a vote put nobody out, in a few words. */
function noOutText(s, reason) {
  switch (reason) {
    case 'nobody': return '冇人投票';
    case 'nomajority': return '冇人過半數';
    case 'alltied': return '全部人同票';
    case 'pktie': return 'PK 再平票';
    default: return '平票';
  }
}

function elimCue(s) {
  const e = s.elim;
  const who = nameOf(s, e.out);
  const id = (stage) => `elim:${e.seq}:${stage}`;
  if (e.kind === 'out') {
    const role = disclose(s, s.roles[e.out]);
    let lead;
    if (e.forced) lead = `連續幾輪冇人出局，今次隨機抽中 ${who} 出局。`;
    else if (e.random) lead = `PK 再投都平票，隨機抽中 ${who} 出局。`;
    else lead = `投票結果：${who} 出局。`;
    if (e.guess?.pending) {
      return { id: id('guess'), text: `${lead}白板 ${who}，你有一次機會，用手機打出你估嘅平民詞語。`, minMs: 3000 };
    }
    if (e.guess) {
      const g = e.guess;
      const said = g.timeout || !g.word ? `白板 ${who} 冇作答，當估錯。` : `白板 ${who} 估「${g.word}」，${g.correct ? '估中喇！' : '唔啱。'}`;
      return { id: id('verdict'), text: said, minMs: 2500 };
    }
    return { id: id('result'), text: `${lead}${role ? `佢係${roleLabel(role)}。` : ''}`, minMs: 2500 };
  }
  if (e.kind === 'pk') {
    const voters = s.cfg.pkVoters === 'others' ? '其他人再投一次' : '大家再投一次';
    return { id: id('result'), text: `平票！${names(s, e.cands)} 同票。佢哋要再講多一句，然後${voters}，只可以投佢哋其中一個。`, minMs: 3000 };
  }
  return { id: id('result'), text: `${noOutText(s, e.reason)}，今輪冇人出局，繼續下一輪。`, minMs: 2500 };
}

function currentCue(s) {
  switch (s.phase) {
    case 'deal':
      return {
        id: 'deal',
        text: `準備開始。今局有 ${countsText(s.counts0)}。大家用自己部手機睇詞語，睇完記住就㩒「記住喇」。`,
        minMs: 3000,
      };
    case 'speak': {
      const who = nameOf(s, s.order[s.turn]);
      const id = speakId(s);
      if (s.speakKind === 'pk') {
        return s.turn === 0
          ? { id, text: `${names(s, s.order)}，你哋再用一句嘢形容自己嘅詞語。先講嘅係 ${who}。`, minMs: 2000 }
          : { id, text: `輪到 ${who}。`, minMs: 1500 };
      }
      return s.turn === 0
        ? { id, text: `第 ${s.round} 輪。由 ${who} 開始，跟座位次序，每人用一句嘢形容自己嘅詞語。`, minMs: 3000 }
        : { id, text: `輪到 ${who}。`, minMs: 1500 };
    }
    case 'discuss':
      return {
        id: `discuss:${s.round}`,
        text: `大家都講完喇。自由討論一下，邊個最似臥底？${s.cfg.discussSec ? `限時 ${s.cfg.discussSec} 秒。` : ''}`,
        minMs: 2500,
      };
    case 'vote':
      return s.voteKind === 'main'
        ? { id: `vote:${s.round}:main:${s.history.length}`, text: '投票時間。揀一個你覺得係臥底嘅人，全部人投晒就會公佈。', minMs: 2500 }
        : { id: `vote:${s.round}:pk:${s.history.length}`, text: `再投一次。只可以投 ${names(s, s.candidates)} 其中一個。`, minMs: 2500 };
    case 'elim': return elimCue(s);
    case 'over':
      return { id: 'over', text: `遊戲完結，${SIDE_NAME[s.win.side]}贏。${reasonText(s)}`, minMs: 3000 };
    default: return null;
  }
}

/**
 * 「而家要做咩」 for the 💡 sheet (BACKLOG U1): one line for a first-timer. Built ONLY from public facts
 * about the seat (alive, whose turn, voted, the announced white card), so it can never hint at a role.
 */
function hintFor(s, pid) {
  const seat = isSeat(s, pid);
  const alive = seat && isAlive(s, pid);
  switch (s.phase) {
    case 'deal':
      if (!seat) return '大家逐個睇緊自己個詞。';
      return s.ready[pid] ? '等其他人睇完。唔記得個詞，可以㩒 🔓 再睇。' : '㩒住張卡睇你個詞，記住咗就㩒「記住喇」。';
    case 'speak': {
      if (seat && s.order[s.turn] === pid) {
        return s.speakKind === 'pk'
          ? '輪到你：再講一句形容你個詞，話俾大家知你唔係臥底，講完㩒「講完喇」。'
          : '輪到你：講一句形容你個詞，唔可以講出個詞或者入面嘅字，講完㩒「講完喇」。';
      }
      if (!seat) return '大家輪流講緊，一人一句。';
      if (!alive) return '你出咗局，靜靜聽就得，唔好爆料。';
      return s.speakKind === 'pk' ? '平票嘅人再講多一句，聽清楚先投。' : '聽佢點講，諗下佢個詞同你嘅係咪一樣。';
    }
    case 'discuss':
      if (seat && !alive) return '你出咗局，聽就得，唔好爆料。';
      return '自由傾：邊個最可疑？傾夠就㩒「開始投票」。';
    case 'vote':
      if (!seat) return '大家投緊票，投晒先公佈。';
      if (!alive) return '你出咗局，唔使投。';
      if (!s.voters.includes(pid)) return '你喺 PK 入面，今次由其他人投。';
      if (pid in s.ballots) return '投咗喇，等其他人。未公佈之前仲可以改。';
      return s.voteKind === 'pk' ? '喺平票嗰幾個入面揀一個你覺得係臥底嘅，再㩒確定。' : '揀一個你覺得係臥底嘅人，再㩒確定。';
    case 'elim': {
      const e = s.elim;
      if (e.guess?.pending) return seat && e.out === pid ? '你係白板！打出你估嘅平民詞語，估中就贏。' : '等白板估平民個詞。';
      if (seat && e.out === pid) return '你出局喇，之後唔使講嘢同投票，可以繼續睇。㩒「繼續」。';
      if (e.kind === 'pk') return '平票：佢哋再講一句，之後再投一次。㩒「繼續」。';
      if (e.kind === 'none') return '今輪冇人出局，㩒「繼續」開下一輪。';
      return '睇下邊個出局、邊個投咗邊個，然後㩒「繼續」。';
    }
    case 'over': return '完咗！睇下兩個詞係乜、邊個係臥底。';
    default: return '';
  }
}

// ---------- views ----------

function subtitleOf(s) {
  const r = `第 ${s.round} 輪`;
  switch (s.phase) {
    case 'deal': return '派詞語';
    case 'speak': return s.speakKind === 'pk' ? `${r} · PK 發言` : `${r} · 發言`;
    case 'discuss': return `${r} · 討論`;
    case 'vote': return s.voteKind === 'pk' ? `${r} · PK 投票` : `${r} · 投票`;
    case 'elim': return `${r} · 結果`;
    default: return '遊戲完結';
  }
}

function elimView(s) {
  const e = s.elim;
  return {
    seq: e.seq,
    kind: e.kind,
    voteKind: e.voteKind,
    out: e.out,
    role: e.out ? disclose(s, s.roles[e.out]) : null,
    counts: dup(e.counts),
    ballots: dup(e.ballots),
    top: e.top.slice(),
    cands: e.cands.slice(),
    forced: e.forced,
    random: e.random,
    reason: e.reason,
    guess: e.guess ? { pending: e.guess.pending, word: e.guess.word, correct: e.guess.correct, timeout: e.guess.timeout } : null,
  };
}

function meView(s, pid) {
  const m = {
    id: pid,
    alive: isAlive(s, pid),
    word: s.words[pid] ?? null,
    ready: !!s.ready[pid],
  };
  if (isBlank(s, pid)) m.blank = true;            // the white card knows what it is
  if (s.phase === 'vote') {
    m.canVote = s.voters.includes(pid);
    m.targets = m.canVote ? targetsFor(s, pid) : [];
    if (pid in s.ballots) m.myVote = s.ballots[pid];       // null = abstained; absent = not voted yet
  }
  if (s.phase === 'elim' && s.elim?.guess?.pending && s.elim.out === pid) m.mustGuess = true;
  return m;
}

function overView(s) {
  return {
    side: s.win.side,
    why: s.win.why,
    reason: reasonText(s),
    civ: s.pair.civ,
    und: s.counts0.undercovers ? s.pair.und : null,
    cat: s.pair.cat ?? null,
    rows: s.seats.map((id) => {
      const o = s.outs.find((x) => x.pid === id);
      return { id, role: s.roles[id], word: s.words[id] ?? null, alive: isAlive(s, id), outRound: o ? o.round : null };
    }),
  };
}

function view(s, pid) {
  const v = {
    phase: s.phase,
    title: meta.name,
    subtitle: subtitleOf(s),
    hint: hintFor(s, pid),
    round: s.round,
    counts: { ...s.counts0 },
    flags: {
      revealRole: s.cfg.revealRole,
      abstain: s.cfg.abstain,
      blankGuess: s.cfg.blankGuess,
      guessWinner: s.cfg.guessWinner,
      tie: s.cfg.tie,
      pkVoters: s.cfg.pkVoters,
      majority: s.cfg.majority,
      win: s.cfg.win,
    },
    seats: s.seats.map((id) => ({ id, alive: isAlive(s, id) })),
    outs: s.outs.map((o) => ({ pid: o.pid, round: o.round, role: disclose(s, o.role) })),
    history: s.history.map((h) => ({
      seq: h.seq, round: h.round, voteKind: h.voteKind, outcome: h.outcome, out: h.out, reason: h.reason ?? null,
      role: h.out ? disclose(s, s.roles[h.out]) : null,
      cands: h.cands.slice(), forced: h.forced, random: h.random, counts: dup(h.counts), ballots: dup(h.ballots), guess: dup(h.guess),
    })),
    me: pid != null && isSeat(s, pid) ? meView(s, pid) : null,
  };
  if (typeof s.deadline === 'number') {
    v.deadline = s.deadline;
    if (s.timerLabel) v.timerLabel = s.timerLabel;
  }
  if (s.relaxed) v.relaxed = true;
  switch (s.phase) {
    case 'deal':
      v.deal = { ready: s.seats.filter((p) => s.ready[p]), total: s.seats.length };
      break;
    case 'speak':
      v.speak = { id: speakId(s), kind: s.speakKind, order: s.order.slice(), turn: s.turn, pid: s.order[s.turn] ?? null, spoke: s.order.slice(0, s.turn) };
      break;
    case 'vote':
      v.vote = {
        kind: s.voteKind,
        candidates: s.candidates.slice(),
        voters: s.voters.slice(),
        done: s.voters.filter((p) => p in s.ballots),
        total: s.voters.length,
      };
      break;
    case 'elim':
      v.elim = elimView(s);
      break;
    case 'over':
      v.over = overView(s);
      break;
    default:
  }
  return v;
}

// ---------- result ----------

function winnersOf(s) {
  if (s.win.side === 'blank') return [s.win.guesser];
  return s.seats.filter((p) => (s.win.side === 'civilians' ? s.roles[p] === 'civilian' : isInfiltrator(s, p)));
}

/** Equalised preset (research): civilians +2 each; undercovers share the civilians' total; a white card 3. */
function pointsFor(s) {
  const pts = {};
  const { civilians: c0, undercovers: u0, blanks: b0 } = s.counts0;
  for (const p of winnersOf(s)) {
    if (s.win.side === 'civilians') pts[p] = 2;
    else if (s.roles[p] === 'undercover') pts[p] = Math.max(1, Math.round((2 * c0) / u0));
    else pts[p] = u0 > 0 ? 3 : Math.max(1, Math.round((2 * c0) / b0));
  }
  return pts;
}

function historyLine(s, h) {
  const r = `第 ${h.round} 輪${h.voteKind === 'pk' ? ' PK' : ''}`;
  if (h.outcome === 'out') {
    const votes = h.counts?.[h.out] ?? 0;
    const tag = h.forced ? '，連續冇人出局所以隨機抽' : h.random ? '，PK 再平票所以隨機抽' : `，${votes} 票`;
    let g = '';
    if (h.guess) g = h.guess.timeout || !h.guess.word ? '；白板冇作答' : `；白板估「${h.guess.word}」，${h.guess.correct ? '估中' : '估錯'}`;
    return `${r}：${nameOf(s, h.out)} 出局（${roleLabel(s.roles[h.out])}${tag}）${g}`;
  }
  if (h.outcome === 'pk') return `${r}：${names(s, h.cands)} 同票，要 PK`;
  return `${r}：${noOutText(s, h.reason)}，冇人出局`;
}

function result(s) {
  if (s.phase !== 'over' || !s.win) return null;
  const winners = winnersOf(s);
  const civs = s.seats.filter((p) => s.roles[p] === 'civilian');
  const unds = s.seats.filter((p) => s.roles[p] === 'undercover');
  const blanks = s.seats.filter((p) => s.roles[p] === 'blank');
  const wordsLine = unds.length
    ? `平民「${s.pair.civ}」，臥底「${s.pair.und}」${s.pair.cat ? `（${s.pair.cat}）` : ''}`
    : `平民「${s.pair.civ}」${s.pair.cat ? `（${s.pair.cat}）` : ''}，今局冇臥底`;
  const lines = [reasonText(s), `詞語：${wordsLine}`, `平民：${names(s, civs)}`];
  if (unds.length) lines.push(`臥底：${names(s, unds)}（佢哋一開始都唔知自己係臥底）`);
  if (blanks.length) lines.push(`白板：${names(s, blanks)}`);
  // Mis-votes are what decides this game: say how many civilians the table threw out.
  const civOut = s.outs.filter((o) => o.role === 'civilian').map((o) => o.pid);
  if (civOut.length) lines.push(`平民投走咗 ${civOut.length} 個自己人：${names(s, civOut)}。`);
  else if (s.win.side === 'civilians') lines.push('平民一個自己人都冇投錯！');
  if (!s.cfg.revealRole && s.outs.length) lines.push('今局出局嗰陣冇公開身份，下面係真身份。');
  for (const h of s.history) lines.push(historyLine(s, h));
  return {
    winners,
    summary: `${SIDE_NAME[s.win.side]}贏！平民詞「${s.pair.civ}」${unds.length ? `，臥底詞「${s.pair.und}」` : ''}`,
    lines,
    points: pointsFor(s),
    carry: { special: s.seats.filter((p) => isInfiltrator(s, p)) },     // for antiStreak in the next game (setup's `carry`)
  };
}

// ---------- engine ----------

function hostAct(s, a, ctx) {
  switch (a?.type) {
    case ACT.CUE_DONE: {
      const c = currentCue(s);
      if (c && a.id === c.id) s.cueDone = c.id;
      return s;
    }
    case ACT.NEXT: {
      const c = currentCue(s);
      if (c && s.cueDone !== c.id) { s.cueDone = c.id; return s; }     // first press = "I finished reading this line"
      return skipStep(s, ctx);
    }
    case ACT.AUTO: {
      const act = autoAct(s, a.pid, ctx);
      return act ? engine.act(s, { pid: a.pid, action: act }, ctx) : s;
    }
    default: return s;
  }
}

/** Host skipped the current step: the same thing the clock running out would do. */
function skipStep(s, ctx) {
  switch (s.phase) {
    case 'deal':
      for (const p of s.seats) s.ready[p] = true;
      startRound(s, ctx);
      break;
    case 'speak': endTurn(s, ctx); break;
    case 'discuss': beginVote(s, ctx, 'main'); break;
    case 'vote': resolveVote(s, ctx); break;
    case 'elim':
      if (s.elim.guess?.pending) settleGuess(s, ctx, '', true);
      else leaveElim(s, ctx);
      break;
    default:
  }
  return s;
}

function autoAct(s, pid, ctx) {
  if (!isSeat(s, pid)) return null;
  switch (s.phase) {
    case 'deal': return s.ready[pid] ? null : { type: 'ready' };
    case 'speak': return s.order[s.turn] === pid ? { type: 'done', at: speakId(s) } : null;
    case 'discuss': return { type: 'start-vote' };
    case 'vote': {
      if (!s.voters.includes(pid) || pid in s.ballots) return null;
      if (s.cfg.abstain) return { type: 'vote', target: null };
      const t = targetsFor(s, pid);
      return { type: 'vote', target: ctx?.rng ? pick(ctx.rng, t) : t[0] };
    }
    case 'elim':
      if (s.elim.guess?.pending) return s.elim.out === pid ? { type: 'guess', word: '' } : null;
      return { type: 'continue' };
    default: return null;
  }
}

/**
 * Deal the roles. Plain shuffle; with antiStreak, last game's undercovers / white cards (`carry.special`)
 * go to the back of the queue so they become civilians whenever enough other seats exist.
 */
function dealRoles(rng, seats, cfg, carry) {
  let order = shuffle(rng, seats);
  if (cfg.antiStreak && Array.isArray(carry?.special)) {
    const prev = carry.special.filter((p) => seats.includes(p));
    order = order.filter((p) => !prev.includes(p)).concat(order.filter((p) => prev.includes(p)));
  }
  const roles = {};
  let k = 0;
  for (let i = 0; i < cfg.undercovers; i++) roles[order[k++]] = 'undercover';
  for (let i = 0; i < cfg.blanks; i++) roles[order[k++]] = 'blank';
  for (; k < order.length; k++) roles[order[k]] = 'civilian';
  return roles;
}

export const engine = {
  /** `carry` (optional) = the previous game's result().carry; only antiStreak reads it. */
  setup({ players, config: cfgIn, rng, bag, carry }) {
    const seats = seatOrder(players);
    const n = seats.length;
    const cfg = fit(cfgIn, n);

    const { entry, relaxed } = drawPair(bag, cfg);
    const civIsA = rng() < 0.5;
    const civSide = civIsA ? 'a' : 'b';
    const pair = {
      civ: civIsA ? entry.a : entry.b,
      und: civIsA ? entry.b : entry.a,
      // Optional bank field entry.alias = { a: [..], b: [..] }: other ways to write the word, also a correct guess.
      accept: [civIsA ? entry.a : entry.b, ...(Array.isArray(entry.alias?.[civSide]) ? entry.alias[civSide].filter((w) => typeof w === 'string') : [])],
      cat: entry.cat ?? null,
      level: entry.level ?? null,
    };

    const roles = dealRoles(rng, seats, cfg, carry);
    const words = {};
    for (const p of seats) {
      words[p] = roles[p] === 'civilian' ? pair.civ : roles[p] === 'undercover' ? pair.und : null;
    }

    // BACKLOG #20: the first speaker is random over ALL seats, undercover and white card included.
    // The house rule blankNeverFirst (off by default, announced in the summary) narrows the pool.
    const pool = cfg.blankNeverFirst ? seats.filter((p) => roles[p] !== 'blank') : seats;
    const starter = pick(rng, pool);
    const counts0 = { civilians: n - cfg.undercovers - cfg.blanks, undercovers: cfg.undercovers, blanks: cfg.blanks };

    return {
      phase: 'deal',
      cfg,
      seats,
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      roles,                                    // PRIVATE
      words,                                    // PRIVATE
      pair,                                     // PRIVATE until phase 'over'
      relaxed,
      counts0,
      alive: seats.slice(),
      ready: {},
      round: 1,
      starter,                                  // first speaker of round 1
      firstSeat: null,
      roundOrder: [],
      order: [],
      turn: 0,
      speakKind: 'round',
      ballots: {},
      candidates: [],
      voters: [],
      voteKind: 'main',
      pkCands: [],
      elim: null,
      outs: [],
      history: [],
      noElimStreak: 0,
      win: null,
      cueDone: null,
      deadline: null,
      timerLabel: null,
    };
  },

  act(s, input, ctx) {
    const pid = input?.pid;
    const a = input?.action;
    if (!a || typeof a !== 'object' || typeof a.type !== 'string') return s;
    if (pid === HOST) return hostAct(s, a, ctx);
    if (!isSeat(s, pid)) return s;

    switch (a.type) {
      case 'ready': {
        if (s.phase !== 'deal' || s.ready[pid]) return s;
        s.ready[pid] = true;
        if (s.seats.every((p) => s.ready[p])) startRound(s, ctx);
        return s;
      }
      case 'done': {
        // `at` (the step id from the view) stops a double tap from skipping the next speaker.
        if (s.phase !== 'speak' || (a.at !== undefined && a.at !== speakId(s))) return s;
        endTurn(s, ctx);
        return s;
      }
      case 'start-vote': {
        if (s.phase !== 'discuss') return s;
        beginVote(s, ctx, 'main');
        return s;
      }
      case 'vote': {
        if (s.phase !== 'vote' || !s.voters.includes(pid)) return s;
        const t = a.target ?? null;
        if (t === null) {
          if (!s.cfg.abstain) return s;
        } else if (typeof t !== 'string' || !targetsFor(s, pid).includes(t)) {
          return s;
        }
        s.ballots[pid] = t;
        if (s.voters.every((v) => v in s.ballots)) resolveVote(s, ctx);
        return s;
      }
      case 'guess': {
        const g = s.phase === 'elim' ? s.elim?.guess : null;
        if (!g?.pending || s.elim.out !== pid) return s;
        if (typeof a.word !== 'string') return s;          // malformed: leave the guess open ('' is how you give up)
        settleGuess(s, ctx, a.word.trim().slice(0, 40), false);
        return s;
      }
      case 'continue': {
        if (s.phase !== 'elim' || s.elim.guess?.pending) return s;
        leaveElim(s, ctx);
        return s;
      }
      default: return s;
    }
  },

  advance(s, ctx) {
    if (s.deadline == null || (ctx?.now ?? 0) < s.deadline) return s;
    return skipStep(s, ctx);
  },

  view,

  cue(s) {
    return currentCue(s);
  },

  focus(s) {
    switch (s.phase) {
      case 'deal': {
        const pids = s.seats.filter((p) => !s.ready[p]);
        return pids.length ? { pids } : null;
      }
      case 'vote': {
        const pids = s.voters.filter((p) => !(p in s.ballots));
        return pids.length ? { pids } : null;
      }
      case 'elim': return s.elim.guess?.pending ? { pids: [s.elim.out] } : null;
      default: return null;
    }
  },

  autoAct,

  legalActions(s, pid) {
    if (!isSeat(s, pid)) return [];
    const out = [];
    switch (s.phase) {
      case 'deal':
        if (!s.ready[pid]) out.push({ type: 'ready' });
        break;
      case 'speak':
        if (s.order[s.turn] === pid) out.push({ type: 'done', at: speakId(s) });
        break;
      case 'discuss':
        out.push({ type: 'start-vote' });
        break;
      case 'vote':
        if (s.voters.includes(pid)) {
          for (const t of targetsFor(s, pid)) if (s.ballots[pid] !== t) out.push({ type: 'vote', target: t });
          if (s.cfg.abstain && s.ballots[pid] !== null) out.push({ type: 'vote', target: null });
        }
        break;
      case 'elim':
        if (s.elim.guess?.pending) {
          // Free text: one wrong and one right example. Only the fuzzer ever sees these.
          if (s.elim.out === pid) out.push({ type: 'guess', word: '（答錯示範）' }, { type: 'guess', word: s.pair.civ });
        } else {
          out.push({ type: 'continue' });
        }
        break;
      default:
    }
    return out;
  },

  result,
};

/** Exposed for tests only. */
export const internals = {
  normaliseWord, infiltratorsWin, winWhy, lossAfter, limits, recommended, presetCounts, fit, merge, normaliseWords, matches,
  hintFor, CATEGORIES, WIN_MODES, PRESETS, REC_WITH_BLANK,
};
