// ============================================================
// Spyfall (間諜) — pure rules engine. Play flow: docs/games/spyfall.md
//
// Node-importable: no DOM, no Math.random, no Date. Randomness comes from
// ctx.rng, time from ctx.now, locations from ctx.bag (bank 'spyfall').
//
// Shape of one game
//   setup  → draws ONE location list for the whole game (listSize entries),
//            then deals round 1
//   round  → reveal (everyone looks at their card)
//          → play   (clock runs; who-asks-next tracker; accusations; spy stop)
//          → vote   (an accusation, or the final vote after time-up)
//          → tally  (result of a vote stays on screen for TALLY_MS)
//          → guess  (a spy stopped the clock and names a location)
//          → roundEnd (reveal + points; moves on when every present seat has tapped 睇完,
//            or the host's 下一步) → next round, or → over
//
// Absent seats (D4, host `{ type: '@absent', pid }`, back with '@present'): public, never waited on —
// no ready check, no vote (unanimity counts present voters), no turn as final-vote suspect, no 睇完, never
// dealt the spy again. An absent SPY voids the round: it is replayed under the same number with a spare
// location (`state.spare`), exactly like the host's 呢鋪唔計 (@void-round). Nobody scores a void round.
//
// Clock bookkeeping: the session only shifts `state.deadline` when the host
// pauses. So the true end of the clock is ALWAYS derived from it:
//   clockEnd = deadline + clockLeft
// where `deadline` is the next wake-up (the one-minute warning, or the end)
// and `clockLeft` is how long after that wake-up the clock really ends.
//
// Secrets (PRIVATE, never in a view except through `mine`/`end`):
//   state.plan (the secret location + role pool of every round, drawn at setup),
//   round.loc, round.spies, round.roles
// state.list is the PUBLIC location list (name, emoji, category only).
// ============================================================

import { HOST, ACT, pick, rint, sample, shuffle, seatOrder, nextSeat } from '../../core/engine-kit.js?v=20261004005209';

// D4 host actions (the literals, so this engine does not depend on engine-kit having them)
const ABSENT = ACT.ABSENT ?? '@absent';
const PRESENT = ACT.PRESENT ?? '@present';

// ------------------------------------------------------------
// constants
// ------------------------------------------------------------

/** Category names used by the 'spyfall' bank (js/data/spyfall-locations.js). */
export const CATEGORIES = [
  '經典', '工作場所', '娛樂', '購物', '香港', '亞洲旅遊', '節日活動',
  '日本', '戶外與大自然', '奇幻科幻', '歷史',
];

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const MAX_ROUNDS = 10;
const LIST_SIZES = [16, 20, 24, 30];
const VOTE_MODES = ['phone', 'hands'];
// Who gets the +1 accuser bonus when a spy is caught (docs/research/spyfall.md, Scoring):
//   first-midround  Spyfall 2 / Time Travel (default): the FIRST player who accused that spy mid-round,
//                   paid only when the spy is caught BY A MID-ROUND VOTE (never at the final vote)
//   successful      Spyfall 1: the player whose mid-round accusation succeeded
//   first-any       house reading: first mid-round accuser, also paid on a final-vote conviction
const BONUS_MODES = ['first-midround', 'successful', 'first-any'];
// Two-spy conviction threshold: 'n-2' = one dissenter allowed (default reading), 'n-3' = two (literal reading).
const THRESHOLDS = ['n-2', 'n-3'];
const BEGINNER_MINUTES = 12;       // 2014 rulebook: first-timers may prefer 12–15 minutes
const WARN_MS = 60_000;            // "one minute left" cue
const WARN_MIN_REMAINING = 75_000; // do not bother warning when less than this is left at the start
const TALLY_MS = 3500;             // how long a vote result stays on screen
const SLACK_MS = 250;              // advance() tolerance for a timer that fires a hair early
const UNDO_DEPTH = 8;              // how many question passes can be taken back
const MIN_LIST = 8;                // never play with fewer locations than this (if the bank has them)

const GENERIC_ROLES = ['常客', '工作人員', '路人', '遊客', '小朋友', '長者', '新人'];
const SPY_WINS = new Set(['survived', 'final-innocent', 'accused-innocent', 'guess-right']);

// ------------------------------------------------------------
// meta
// ------------------------------------------------------------

export const meta = {
  id: 'spyfall',
  name: '間諜',
  emoji: '🛩️',               // same as js/games/registry.js; 🕵️ belongs to 誰是臥底
  accent: '#3aa7d9',
  // Official 3-8, and 3-12 with the two-spy option (Spyfall 2). docs/DESIGN.md §0 lists 3-8;
  // the engine supports 12 so a big table is not turned away.
  players: [MIN_PLAYERS, MAX_PLAYERS],
  minutes: [10, 45],
  narration: 'optional',
  paperMode: false,
  singleDevice: 'full',       // set 投票方式 to 舉手 and pass the phone round for the private look
  blurb: '每人都知喺邊，除咗間諜。發問、答問，睇邊個露馬腳。',
  banks: ['spyfall'],
  css: true,
};

// ------------------------------------------------------------
// rules (Cantonese)
// ------------------------------------------------------------

export const rules = {
  quick: [
    '每局有個秘密地點：人人都知，除咗間諜。',
    '輪流問答：問一個人一條問題，佢答完再問下一個，唔可以即刻問返轉頭。',
    '答得太清楚，間諜會估到；答得太含糊，會俾人懷疑。',
    '每人每局可以停鐘指控一次，其他人全部贊成先算數。',
    '間諜可以隨時停鐘估地點：估中贏，估錯輸。',
    '時間到就逐個人投票；冇人被全票通過，間諜贏。',
  ],
  roles: [
    {
      id: 'spy', name: '間諜', emoji: '🕵️', team: 'spy', teamLabel: '間諜',
      text: '你唔知地點：扮識，聽大家答嘢估出嚟；隨時可以停鐘亮身分，喺清單揀地點。'
        + '點贏：估中地點、時間到冇人揪到你，或者大家全票錯怪好人。（兩個間諜嘅話，你哋互相唔知對方。）',
    },
    {
      id: 'agent', name: '地點內嘅人', emoji: '📍', team: 'good', teamLabel: '非間諜',
      text: '你知道地點，仲有個身分（純扮演）：答嘢要令自己人信你，又唔好俾間諜聽出地點。'
        + '點贏：全票揪出間諜，或者間諜估錯地點。',
    },
  ],
  sections: [
    {
      title: '目標',
      body: '非間諜：揪出間諜。\n間諜：唔俾人揪出，或者估中地點。',
    },
    {
      title: '一局點玩',
      body: [
        '1. 每個人㩒住自己張卡睇：地點同身分，或者「你係間諜」。睇完㩒準備好。',
        '2. 全部準備好就開始計時，由發牌員問第一條問題。',
        '3. 問答期間可以指控、間諜可以停鐘猜地點。',
        '4. 時間到就最後投票。',
        '5. 揭曉地點同間諜，計分；全部人㩒「睇完」就開下一局（房主可以㩒下一步唔等）。',
        '發牌員：第一局隨機，之後每局輪到左手邊下一位。發牌員問第一條問題，最後投票都係由佢開始；發牌員都可以係間諜。',
      ].join('\n'),
    },
    {
      title: '點樣發問',
      body: [
        '問一個人一條問題，可以問任何同地點有關（或者無關）嘅嘢。答嘢隨便點答，但係唔准反問。',
        '答完嘅人要問另一個人，但係唔可以問返剛剛問自己嘅人（所以三個人玩就係 A 問 B、B 問 C、C 問 A）。',
        '畫面會顯示輪到邊個問、唔可以問返邊個。問完㩒一下被問嘅人，輪到佢。㩒錯可以「撤銷」。',
      ].join('\n'),
    },
    {
      title: '指控同投票',
      body: [
        '每個人每局只可以指控一次（間諜都可以用嚟擾亂視線）。指控會停鐘。',
        '被指控嘅人唔投票，其他人投贊成或者反對。指控人自動贊成。投票嗰陣唔好講理由，費事漏咗地點出嚟。',
        '一個間諜：所有人都贊成先成立。兩個間諜：最多可以有一個人反對。',
        '成立：被指控嘅人亮牌 — 係間諜就非間諜贏，唔係間諜就間諜贏。',
        '唔成立：鐘由停低嗰一刻繼續行，指控人用咗佢嘅一次機會；間諜又可以再停鐘估地點。',
        '唔好俾人睇你部手機證明身分：要講服大家，就靠把口。',
      ].join('\n'),
    },
    {
      title: '間諜猜地點',
      body: [
        '間諜可以喺鐘仲行緊、冇人投緊票嘅時候停鐘，亮身分，然後喺清單揀一個地點。',
        '揀啱：間諜贏。揀錯：非間諜贏。猜完即刻完局。',
        '兩個間諜：第一個間諜揀完，第二個間諜都要企出嚟揀（可以揀同一個）。其中一個揀啱，間諜就贏。',
        '時間到、或者有人指控緊嘅時候，間諜唔可以猜。',
      ].join('\n'),
    },
    {
      title: '時間到：最後投票',
      body: [
        '間諜已經唔可以再估地點。',
        '由發牌員開始，順住座位逐個人做被懷疑嘅人，其他人投贊成或者反對（被懷疑嘅人唔投）。',
        '投票之間可以傾、可以拉票，但唔好講出地點或者太明顯嘅細節。',
        '第一個被全票通過嘅人亮牌，投票即刻結束：係間諜就非間諜贏，唔係就間諜贏。',
        '如果所有人都試過，冇人被全票通過，間諜贏。',
      ].join('\n'),
    },
    {
      title: '計分（一個間諜）',
      body: [
        '間諜捱到最後（冇人被全票通過）：間諜 +2。',
        '中途指控，全票錯怪好人：間諜 +4。',
        '間諜估中地點：間諜 +4。',
        '中途指控，全票揪出間諜：每個非間諜 +1；最先指控過呢個間諜嘅人再 +1（就算佢嗰次唔通過）。',
        '最後投票先揪出間諜：每個非間諜 +1，冇指控獎勵。',
        '間諜估錯地點：每個非間諜 +1，冇指控獎勵。',
        '最後投票全票錯怪好人：間諜 +2。',
      ].join('\n'),
    },
    {
      title: '兩個間諜',
      body: [
        '建議 9 人或以上先用（最少 6 人）。兩個間諜互相唔知道對方係邊個。',
        '指控同最後投票：最多容許一個人反對。',
        '兩個間諜都計分：間諜贏每人 +2（中途全票錯怪好人每人 +4）；估中地點嗰個再 +2。',
        '其中一個間諜被揪出：另一個當自己係非間諜計 +1；如果佢係最先中途指控嗰個，指控獎勵都照攞。',
      ].join('\n'),
    },
    {
      title: '有人走開咗',
      body: [
        '房主可以將佢設做「唔喺度」（💤）：唔使等佢準備、投票或者㩒睇完；指控同最後投票只計喺度嘅人。',
        '如果佢係間諜，呢局作廢、冇人得分，用另一個地點重新派過牌（局數照計返）。',
        '房主亦可以㩒「呢鋪唔計」：同樣重新派過。',
      ].join('\n'),
    },
    {
      title: '玩法選項',
      body: [
        '指控獎勵：預設係「最先中途指控」（間諜 2／時間旅行版）；可以改用第一代規則（成功嗰次嘅指控人攞），或者自訂玩法（最後投票捉到都有）。',
        '兩個間諜嘅門檻：預設最多 1 人反對；可以改做最多 2 人反對。',
        '唔好連續做間諜：上一局嘅間諜今局唔會再做（大家都知，所以官方冇呢條，預設關）。',
      ].join('\n'),
    },
    {
      title: '貼士',
      body: [
        '做間諜：答嘢要似知道，但唔好太肯定。將問題問向有破綻嘅人。',
        '做平民：問題要夠刁，令自己人聽得明、間諜聽唔明。',
        '地點清單可以㩒一下劃走（淨係你部手機見到），用嚟排除。',
        '舊局用過嘅地點唔會再出，清單會顯示灰色。',
      ].join('\n'),
    },
  ],
};

// ------------------------------------------------------------
// config
// ------------------------------------------------------------

export function recommendedMinutes(n) {
  if (n <= 4) return 6;
  if (n <= 6) return 7;
  if (n <= 8) return 8;
  if (n <= 10) return 9;
  return 10;
}

export function recommendedSpies(n) { return n >= 9 ? 2 : 1; }

/** Selected categories from the ConfigForm shape { cats: [...] } (a bare array is tolerated). Empty = all. */
function catsOf(v) {
  const list = Array.isArray(v) ? v : (v && typeof v === 'object' ? (Array.isArray(v.cats) ? v.cats : v.categories) : null);
  return Array.isArray(list) ? [...new Set(list.filter((c) => typeof c === 'string' && c))] : [];
}
const catsValid = (v) => {
  const list = Array.isArray(v) ? v : (v && typeof v === 'object' ? (v.cats ?? v.categories ?? []) : null);
  return Array.isArray(list) && list.every((c) => typeof c === 'string');
};

const clampN = (n) => Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n | 0));
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** Why this head-count gets this setup — one short line players can read (BACKLOG #8). */
function standardReason(n) {
  const sp = recommendedSpies(n);
  const head = `${n} 人：${sp} 個間諜 · 每局 ${recommendedMinutes(n)} 分鐘`;
  if (n <= 4) return `${head} — 人少易估，當熱身`;
  if (n === 6) return `${head} — 官方建議，6 人最好玩`;
  if (n >= 9) return `${head} — 官方建議：9 人以上用 2 個間諜`;
  return `${head} — 官方建議`;
}

/** Two-spy threshold reading → how many "no" votes a conviction survives. */
const maxNoFor = (spies, threshold) => (spies === 2 ? (threshold === 'n-3' ? 2 : 1) : 0);

export const config = {
  defaults(n, prev) {
    n = clampN(n);
    const cfg = {
      rounds: 3,
      minutes: recommendedMinutes(n),
      spies: recommendedSpies(n),
      listSize: 24,
      voteMode: 'phone',
      categories: { cats: [] },
      accuserBonus: 'first-midround',
      twoSpyThreshold: 'n-2',
      antiStreak: false,
    };
    // Carry over what is a taste, not a head-count decision.
    if (prev && typeof prev === 'object') {
      if (isInt(prev.rounds, 1, MAX_ROUNDS)) cfg.rounds = prev.rounds;
      if (LIST_SIZES.includes(prev.listSize)) cfg.listSize = prev.listSize;
      if (VOTE_MODES.includes(prev.voteMode)) cfg.voteMode = prev.voteMode;
      cfg.categories = { cats: catsOf(prev.categories) };
      if (BONUS_MODES.includes(prev.accuserBonus)) cfg.accuserBonus = prev.accuserBonus;
      if (THRESHOLDS.includes(prev.twoSpyThreshold)) cfg.twoSpyThreshold = prev.twoSpyThreshold;
      if (typeof prev.antiStreak === 'boolean') cfg.antiStreak = prev.antiStreak;
    }
    return cfg;
  },

  /**
   * Head-count presets with a reason (BACKLOG #8). Each `cfg` is a patch over the current config;
   * the first entry is what `defaults(n)` already gives. Every preset passes `validate` for this n.
   */
  presets(n) {
    n = clampN(n);
    const sp = recommendedSpies(n);
    const m = recommendedMinutes(n);
    const out = [
      { id: 'standard', label: '標準', reason: standardReason(n), cfg: { spies: sp, minutes: m } },
      {
        id: 'beginner', label: '新手',
        reason: `第一次玩：${sp} 個間諜 · 每局 ${Math.max(BEGINNER_MINUTES, m)} 分鐘 — 多啲時間諗問題`,
        cfg: { spies: sp, minutes: Math.max(BEGINNER_MINUTES, m) },
      },
    ];
    if (n >= 6 && n <= 8) {
      out.push({
        id: 'two-spies', label: '兩個間諜',
        reason: `${n} 人熟手：2 個間諜互相唔知，最多 1 人反對都算通過`,
        cfg: { spies: 2, minutes: m, twoSpyThreshold: 'n-2' },
      });
    }
    out.push({ id: 'quick', label: '快玩', reason: '淨係玩一局試吓手', cfg: { rounds: 1 } });
    return out;
  },

  validate(cfg, n) {
    const warnings = [];
    const fail = (message) => ({ ok: false, message, warnings });
    if (!cfg || typeof cfg !== 'object') return fail('設定唔啱');
    if (!isInt(n, MIN_PLAYERS, MAX_PLAYERS)) return fail(`間諜要 ${MIN_PLAYERS}–${MAX_PLAYERS} 個人`);
    if (!isInt(cfg.rounds, 1, MAX_ROUNDS)) return fail(`局數要 1–${MAX_ROUNDS}`);
    if (!isInt(cfg.minutes, 2, 20)) return fail('每局時間要 2–20 分鐘');
    if (!isInt(cfg.spies, 1, 2)) return fail('間諜人數要 1 或 2');
    if (cfg.spies === 2 && n < 6) return fail('兩個間諜最少要 6 個人');
    if (!LIST_SIZES.includes(cfg.listSize)) return fail('地點清單長度唔啱');
    if (!VOTE_MODES.includes(cfg.voteMode)) return fail('投票方式唔啱');
    if (cfg.categories !== undefined && !catsValid(cfg.categories)) return fail('地點類別唔啱');
    // Older saved configs may lack the newer keys; absent = the default.
    if (cfg.accuserBonus !== undefined && !BONUS_MODES.includes(cfg.accuserBonus)) return fail('指控獎勵設定唔啱');
    if (cfg.twoSpyThreshold !== undefined && !THRESHOLDS.includes(cfg.twoSpyThreshold)) return fail('兩個間諜嘅門檻設定唔啱');
    if (cfg.antiStreak !== undefined && typeof cfg.antiStreak !== 'boolean') return fail('「唔好連續做間諜」設定唔啱');

    if (n === 3) warnings.push('3 個人玩間諜好易估到，5–8 人先最好玩');
    if (cfg.spies === 1 && n >= 9) warnings.push(`${n} 人建議 2 個間諜，1 個間諜太易俾人揪出`);
    if (cfg.spies === 2 && n < 9) warnings.push('官方建議 9 人或以上先用 2 個間諜');
    if (cfg.minutes < recommendedMinutes(n) - 2) warnings.push(`${n} 人建議每局 ${recommendedMinutes(n)} 分鐘，太短未必問得晒`);
    if (catsOf(cfg.categories).length === 1) warnings.push('只揀一個類別，地點可能唔夠多（唔夠會自動用晒其他類別補）');
    return { ok: true, message: '', warnings };
  },

  fields(cfg, n) {
    const nn = clampN(n);
    const rec = recommendedMinutes(nn);
    const recSpies = recommendedSpies(nn);
    const spyOpts = [{ value: 1, label: recSpies === 1 ? '1 個（官方建議）' : '1 個（人多會太易捉）' }];
    if (nn >= 6) spyOpts.push({ value: 2, label: recSpies === 2 ? '2 個（官方建議）' : '2 個（熟手：互相唔知對方）' });
    const out = [
      { key: 'rounds', label: '幾多局', type: 'int', min: 1, max: MAX_ROUNDS, help: '1 局就係快玩；官方建議第一次玩 5 局（大約 1 個鐘）。' },
      { key: 'minutes', label: '每局幾多分鐘', type: 'int', min: 2, max: 20, help: `${nn} 人建議 ${rec} 分鐘；第一次玩可以 ${Math.max(BEGINNER_MINUTES, rec)} 分鐘。` },
      {
        key: 'spies', label: '間諜人數', type: 'select', options: spyOpts,
        help: nn >= 6 ? standardReason(nn) : `${standardReason(nn)}（2 個間諜要 6 人或以上）`,
      },
    ];
    if (cfg && cfg.spies === 2) {
      out.push({
        key: 'twoSpyThreshold', label: '兩個間諜：幾多人反對都算通過', type: 'select',
        options: [
          { value: 'n-2', label: '最多 1 人反對（建議）' },
          { value: 'n-3', label: '最多 2 人反對' },
        ],
        help: '另一個間諜多數會投反對，所以要容許有人反對。',
      });
    }
    out.push(
      {
        key: 'voteMode', label: '投票方式', type: 'select',
        options: [
          { value: 'phone', label: '各自用手機投' },
          { value: 'hands', label: '舉手（一部手機玩就揀呢個）' },
        ],
        help: '舉手：大家同時舉手，由一個人㩒結果。',
      },
      {
        key: 'listSize', label: '地點清單長度', type: 'select',
        options: LIST_SIZES.map((v) => ({ value: v, label: `${v} 個地點` })),
        help: '清單同一場所有局都用同一份。',
      },
      {
        key: 'categories', label: '地點類別', type: 'categories',
        options: CATEGORIES.map((c) => ({ value: c, label: c })),
        help: '唔揀就係全部。',
      },
      {
        key: 'accuserBonus', label: '指控獎勵 +1 畀邊個', type: 'select',
        options: [
          { value: 'first-midround', label: '最先指控嗰個（中途捉到先有）' },
          { value: 'successful', label: '成功指控嗰個（第一代規則）' },
          { value: 'first-any', label: '最先指控嗰個，最後投票捉到都有（自訂）' },
        ],
        help: '預設跟官方間諜 2：最先中途指控過間諜嘅人，間諜要喺中途投票被捉先有。',
      },
      {
        key: 'antiStreak', label: '唔好連續做間諜', type: 'bool',
        help: '開咗：上一局嘅間諜今局唔會再做。大家都知呢點，所以預設關。',
      },
    );
    return out;
  },

  summary(cfg, n) {
    const lines = [`${cfg.rounds} 局 · 每局 ${cfg.minutes} 分鐘`, `${cfg.spies} 個間諜`];
    if (cfg.spies === 2 && cfg.twoSpyThreshold === 'n-3') lines[1] += '（最多 2 人反對）';
    const cats = catsOf(cfg.categories);
    lines.push(`${cfg.listSize} 個地點${cats.length ? `（${cats.join('、')}）` : ''}`);
    lines.push(cfg.voteMode === 'hands' ? '舉手投票' : '手機投票');
    if (cfg.accuserBonus === 'successful') lines.push('指控獎勵：成功嗰個');
    if (cfg.accuserBonus === 'first-any') lines.push('指控獎勵：最後投票都有');
    if (cfg.antiStreak === true) lines.push('唔會連續做間諜');
    return lines;
  },
};

/** Clamp a stored config into something the engine can run, whatever the lobby sent. */
function normalizeConfig(cfg, n) {
  const d = config.defaults(n);
  const c = { ...d, ...(cfg && typeof cfg === 'object' ? cfg : {}) };
  c.rounds = isInt(c.rounds, 1, MAX_ROUNDS) ? c.rounds : d.rounds;
  c.minutes = isInt(c.minutes, 1, 60) ? c.minutes : d.minutes;
  c.spies = n >= 6 && c.spies === 2 ? 2 : 1;
  c.listSize = LIST_SIZES.includes(c.listSize) ? c.listSize : d.listSize;
  c.voteMode = VOTE_MODES.includes(c.voteMode) ? c.voteMode : d.voteMode;
  c.categories = { cats: catsOf(c.categories) };
  c.accuserBonus = BONUS_MODES.includes(c.accuserBonus) ? c.accuserBonus : d.accuserBonus;
  c.twoSpyThreshold = THRESHOLDS.includes(c.twoSpyThreshold) ? c.twoSpyThreshold : d.twoSpyThreshold;
  c.antiStreak = c.antiStreak === true;
  return c;
}

// ------------------------------------------------------------
// small state helpers
// ------------------------------------------------------------

const byId = (s, id) => s.players.find((p) => p.id === id);
const isPlayer = (s, id) => !!byId(s, id);
const nameOf = (s, id) => byId(s, id)?.name ?? '?';
const namesOf = (s, ids) => ids.map((id) => nameOf(s, id)).join('、');
const maxNo = (s) => maxNoFor(s.cfg.spies, s.cfg.twoSpyThreshold);
const needYes = (s) => votersOf(s).length - maxNo(s);   // voters = every present seat but the suspect
const clockEnd = (s) => s.deadline + s.clockLeft;
const locOf = (s, i) => s.list[i];
const locLabel = (s, i) => `${locOf(s, i).emoji} ${locOf(s, i).name}`;

// ---- absent seats (D4) ----
const isAbsent = (s, id) => !!s.absent?.[id];
const presentOf = (s) => s.order.filter((id) => !isAbsent(s, id));
/** Next present seat clockwise after `from` (optionally also passing `ok`), or null. */
const nextPresent = (s, from, ok = () => true) => nextSeat(s.order, from, (id) => !isAbsent(s, id) && ok(id));
/** Fewest present seats a round still works with: 3, and enough voters that one "no" can still sink a vote. */
const minPresent = (s) => Math.max(MIN_PLAYERS, s.cfg.spies + 2, maxNo(s) + 2);
const zeros = (s) => Object.fromEntries(s.order.map((id) => [id, 0]));

function votersOf(s) {
  const v = s.round.vote;
  return s.order.filter((id) => id !== v.suspect && !isAbsent(s, id));
}

/** Where the final vote stands: the current suspect is number `index` of `of` present seats. */
function finalPos(s) {
  const r = s.round;
  const n = s.order.length;
  const start = s.order.indexOf(r.dealer);
  let before = 0;
  for (let k = 0; k < r.finalIdx; k++) if (!isAbsent(s, s.order[(start + k) % n])) before++;
  return { index: before + 1, of: Math.max(before + 1, presentOf(s).length) };
}

function setCue(s, key, text, minMs = 2500) {
  s.seq += 1;
  s.cue = { id: `sf:${s.roundNo}:${key}:${s.seq}`, text, minMs, done: false };
}

// ------------------------------------------------------------
// Cantonese lines (narration + results)
// ------------------------------------------------------------

const T = {
  deal: (s) => `${s.round.redo ? '上一鋪唔計，重新派過牌。' : ''}第${s.roundNo}局，發牌員係${nameOf(s, s.round.dealer)}。每個人㩒住張卡睇自己嘅身分，睇完㩒「準備好」。`,
  start: (s) => `大家準備好，計時${s.cfg.minutes}分鐘，開始！由${nameOf(s, s.round.floor.holder)}問第一條問題。`,
  warn: () => '仲有一分鐘。',
  accuse: (s, by, suspect) => `鐘停咗。${nameOf(s, by)}指控${nameOf(s, suspect)}，大家投票。`,
  tally(s) {
    const t = s.tally;
    if (t.convicted) return `全票通過，${nameOf(s, t.suspect)}要亮牌。`;
    return t.kind === 'accuse' ? '唔通過，鐘繼續行。' : '唔通過。';
  },
  timeUp: (s, first) => `時間到！間諜唔可以再估地點。最後投票由${nameOf(s, first)}開始，可以傾，但唔好講出地點。`,
  finalNext: (s, suspect) => `下一位：${nameOf(s, suspect)}。`,
  accuseOff: (s, suspect) => `${nameOf(s, suspect)}唔喺度，指控取消，鐘繼續行。`,
  guess: (s, pid) => `${nameOf(s, pid)}話佢係間諜！鐘停咗，等佢喺地點清單揀一個。`,
  guessNext: (s, pid) => `另一個間諜${nameOf(s, pid)}都要企出嚟，輪到佢揀。`,
  roundEnd: (s, h) => `${headlineOf(s, h)}。地點係${locOf(s, h.loc).name}，間諜係${namesOf(s, h.spies)}。`,
  over: (s) => `${s.cfg.rounds === 1 ? '呢局' : `${scoredCount(s)}局`}打完。${summaryOf(s)}。`,
};

const scoredCount = (s) => s.history.filter((h) => h.code !== 'void').length;

/** Why a round was voided, in a few words (history entry `h`, code 'void'). */
function voidWhy(s, h) {
  return h.why === 'absent' && h.absent != null ? `${nameOf(s, h.absent)} 唔喺度，佢係間諜` : '房主話呢鋪唔計';
}

function headlineOf(s, o) {
  const suspect = o.suspect != null ? nameOf(s, o.suspect) : '';
  switch (o.code) {
    case 'void': return `呢局作廢：${voidWhy(s, o)}`;
    case 'survived': return '間諜贏：冇人被全票通過';
    case 'final-innocent': return `間諜贏：最後投票錯怪咗${suspect}`;
    case 'accused-innocent': return `間諜贏：全場錯怪咗${suspect}`;
    case 'accused-spy': return `非間諜贏：捉到間諜${suspect}`;
    case 'final-spy': return `非間諜贏：最後投票揪出${suspect}`;
    case 'guess-right': return '間諜贏：估中地點';
    default: return '非間諜贏：間諜估錯地點';
  }
}

/** The "why" lines shown under the reveal. Every point is accounted for. `o` is a finished-round record. */
function explainLines(s, o) {
  const spies = o.spies;
  const spyNames = namesOf(s, spies);
  const suspect = o.suspect != null ? nameOf(s, o.suspect) : '';
  const by = o.by != null ? nameOf(s, o.by) : '';
  const two = spies.length === 2;
  const each = two ? '每人 ' : '';
  const innocent = o.suspectRole ? `（佢嘅身分係「${o.suspectRole}」）` : '';
  const accs = o.accusations ?? [];
  const lines = [];

  switch (o.code) {
    case 'void':
      lines.push(`${voidWhy(s, o)}，所以呢局作廢。`);
      lines.push('冇人得分。');
      break;
    case 'survived':
      lines.push('時間到，逐個人投過一輪，冇人被全票通過。');
      lines.push(`間諜 ${spyNames} 冇俾人揪出，${each}+2。`);
      break;
    case 'final-innocent':
      lines.push(`最後投票，${suspect} 被全票通過，但佢唔係間諜${innocent}。`);
      lines.push(`間諜 ${spyNames} 贏，${each}+2（最後投票錯怪好人冇額外分）。`);
      break;
    case 'accused-innocent':
      lines.push(`${by} 停鐘指控 ${suspect}，全票通過，但 ${suspect} 唔係間諜${innocent}。`);
      lines.push(`間諜 ${spyNames} 贏，${each}+4（贏 +2，中途錯怪好人再 +2）。`);
      break;
    case 'accused-spy':
    case 'final-spy': {
      const how = o.code === 'accused-spy' ? `${by} 停鐘指控 ${suspect}，全票通過` : `最後投票，${suspect} 被全票通過`;
      lines.push(`${how} — 佢真係間諜！`);
      lines.push('每個非間諜 +1。');
      const first = accs.find((a) => a.suspect === o.suspect) ?? null;
      if (o.bonusTo != null) {
        const who = nameOf(s, o.bonusTo);
        if (o.bonusMode === 'successful') lines.push(`${who} 成功指控 ${suspect}，額外 +1。`);
        else if (o.code === 'final-spy') lines.push(`${who} 中途最先指控過 ${suspect}，額外 +1（自訂玩法：最後投票捉到都有）。`);
        else if (o.bonusTo !== o.by) lines.push(`${who} 最先指控 ${suspect}（嗰次唔通過），額外 +1。`);
        else lines.push(`${who} 最先指控 ${suspect}，額外 +1。`);
      } else if (o.code === 'final-spy' && first) {
        lines.push(`${nameOf(s, first.by)} 中途指控過 ${suspect}，不過要中途全票捉到先有額外分。`);
      }
      if (two) {
        const other = spies.find((x) => x !== o.suspect);
        lines.push(`另一個間諜 ${nameOf(s, other)} 冇被揪出，當非間諜計 +1。`);
      }
      break;
    }
    case 'guess-right':
      lines.push(two
        ? `${by} 停鐘亮身分，兩個間諜都要估；真正地點係 ${locLabel(s, o.loc)}。`
        : `${by} 停鐘亮身分，估中地點 ${locLabel(s, o.loc)}！`);
      if (two) {
        for (const id of o.picks ? Object.keys(o.picks) : []) {
          lines.push(`${nameOf(s, id)} 揀咗「${locOf(s, o.picks[id]).name}」${o.rightSpies.includes(id) ? ' ✓' : ' ✗'}`);
        }
        lines.push('兩個間諜各 +2，估中嗰個再 +2。');
      } else lines.push('間諜 +4（贏 +2，估中地點再 +2）。');
      break;
    default: {
      lines.push(`${by} 停鐘亮身分，${two ? '兩個間諜都估錯' : `估咗「${locOf(s, o.picks[o.by]).name}」`}，真正地點係 ${locLabel(s, o.loc)}。`);
      if (two) {
        for (const id of Object.keys(o.picks)) lines.push(`${nameOf(s, id)} 揀咗「${locOf(s, o.picks[id]).name}」✗`);
      }
      lines.push('每個非間諜 +1。');
      if (accs.some((a) => spies.includes(a.suspect))) lines.push('間諜自己估錯，所以指控過佢嘅人冇額外分。');
    }
  }
  return lines;
}

/** One line per finished round for the final results screen: where, who, what happened, who scored. */
function roundLine(s, h) {
  if (h.code === 'void') return `第 ${h.n} 局 ${locLabel(s, h.loc)}（間諜：${namesOf(s, h.spies)}）— 作廢，唔計分（${voidWhy(s, h)}）`;
  const scored = s.order.filter((id) => h.deltas[id] > 0);
  const pts = scored.length > 3 && h.winTeam === 'agent'
    ? `非間諜各 +1${h.bonusTo != null ? `，${nameOf(s, h.bonusTo)} +2` : ''}`
    : scored.map((id) => `${nameOf(s, id)} +${h.deltas[id]}`).join('、');
  return `第 ${h.n} 局 ${locLabel(s, h.loc)}（間諜：${namesOf(s, h.spies)}）— ${headlineOf(s, h)}${pts ? ` · ${pts}` : ''}`;
}

// ------------------------------------------------------------
// scoring (pure, exported for tests)
// ------------------------------------------------------------

/**
 * Points for one round.
 * @param {object} o
 * @param {string[]} o.order       every seat
 * @param {string[]} o.spies       the spy seats
 * @param {string}   o.code        survived | final-innocent | accused-innocent | guess-right |
 *                                 accused-spy | final-spy | guess-wrong
 * @param {string?}  o.caught      the spy that was convicted (accused-spy / final-spy)
 * @param {string[]} o.rightSpies  spies whose guess was correct (guess-right)
 * @param {string?}  o.bonusTo     first accuser of the convicted spy
 * @returns {Object<string, number>}
 */
export function scoreRound({ order, spies, code, caught = null, rightSpies = [], bonusTo = null }) {
  const d = Object.fromEntries(order.map((id) => [id, 0]));
  if (SPY_WINS.has(code)) {
    const base = code === 'accused-innocent' ? 4 : 2;
    for (const sp of spies) d[sp] += base;
    if (code === 'guess-right') for (const sp of rightSpies) d[sp] += 2;
    return d;
  }
  for (const id of order) if (!spies.includes(id)) d[id] += 1;
  if (caught) for (const sp of spies) if (sp !== caught) d[sp] += 1;   // the uncaught spy scores as a non-spy
  if (bonusTo && caught && bonusTo !== caught && d[bonusTo] !== undefined) d[bonusTo] += 1;   // never after a wrong guess
  return d;
}

/**
 * Who earns the +1 accuser bonus (docs/research/spyfall.md, "Accuser bonus").
 * Default `first-midround`: only when the spy was caught BY A MID-ROUND VOTE (outcome
 * accused-spy), to the earliest mid-round accuser of that spy — even if that first vote failed.
 * Never on a wrong guess; never on a final-vote conviction unless the house option `first-any`.
 * @param {object} o
 * @param {string} o.code          round outcome code
 * @param {string?} o.caught       the convicted spy
 * @param {string?} o.by           accuser of the vote that succeeded (accused-spy only)
 * @param {{by:string,suspect:string}[]} o.accusations  this round's mid-round accusations, in order
 * @param {string} [o.mode]        one of BONUS_MODES
 * @returns {string|null}
 */
export function bonusFor({ code, caught = null, by = null, accusations = [], mode = 'first-midround' }) {
  if (!caught || (code !== 'accused-spy' && code !== 'final-spy')) return null;
  const first = accusations.find((a) => a.suspect === caught)?.by ?? null;
  if (mode === 'first-any') return first;
  if (code !== 'accused-spy') return null;              // caught at the final vote: no bonus
  return mode === 'successful' ? by : first;
}

function summaryOf(s) {
  const max = Math.max(...s.order.map((id) => s.totals[id]));
  const winners = s.order.filter((id) => s.totals[id] === max);
  return winners.length === 1
    ? `${nameOf(s, winners[0])} 贏咗，共 ${max} 分`
    : `${namesOf(s, winners)} 同分奪冠，各 ${max} 分`;
}

// ------------------------------------------------------------
// setup & rounds
// ------------------------------------------------------------

function sanitizeLocation(e) {
  const roles = Array.isArray(e.roles) ? e.roles.filter((r) => typeof r === 'string' && r) : [];
  return {
    name: String(e.name),
    emoji: typeof e.emoji === 'string' && e.emoji ? e.emoji : '📍',
    cat: typeof e.cat === 'string' && e.cat ? e.cat : '自訂',
    roles: roles.length ? roles : GENERIC_ROLES.slice(),
  };
}

/**
 * Draw `size` distinct locations through the bag (so the host device remembers
 * what it has used). When the filtered pool is smaller than `size` the bag
 * refills and starts handing out repeats — those are skipped, and after a few
 * misses in a row we stop and top up from the unfiltered bank if the list is
 * still too short.
 */
function drawList(bag, size, filter, minSize) {
  const seen = new Set();
  const out = [];
  const take = (f, limit) => {
    let misses = 0;
    while (out.length < limit && misses < 8) {
      const e = bag.draw('spyfall', f);
      if (!e) break;
      if (!e.name || seen.has(e.name)) { misses++; continue; }
      misses = 0;
      seen.add(e.name);
      out.push(sanitizeLocation(e));
    }
  };
  take(filter, size);
  if (out.length < minSize) take(() => true, minSize);
  return out;
}

function sortList(list) {
  const rank = (c) => { const i = CATEGORIES.indexOf(c); return i < 0 ? CATEGORIES.length : i; };
  return list.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e.cat) - rank(b.e.cat) || a.i - b.i).map((x) => x.e);
}

function dealRoles(rng, roles, ids) {
  const out = {};
  let pool = [];
  for (const id of ids) {
    if (!pool.length) pool = shuffle(rng, roles);   // a short role list only repeats once every role is used
    out[id] = pool.pop();
  }
  return out;
}

export function setup({ players, config: rawCfg, rng, now, bag }) {
  const order = seatOrder(players);
  const cfg = normalizeConfig(rawCfg, order.length);
  const cats = new Set(cfg.categories.cats);
  const filter = (e) => cats.size === 0 || cats.has(e.cat);
  const drawn = drawList(bag, cfg.listSize, filter, Math.max(MIN_LIST, cfg.rounds));
  if (!drawn.length) throw new Error('spyfall: the location bank is empty');
  cfg.rounds = Math.min(cfg.rounds, drawn.length);   // every round needs a location that has not been used
  const entries = sortList(shuffle(rng, drawn));
  // One distinct secret per round, fixed now. Only these keep their role pool in the state.
  const plan = sample(rng, entries.map((_, i) => i), cfg.rounds).map((loc) => ({ loc, roles: entries[loc].roles }));
  // The rest of the list, kept (with roles) for a round that is voided and dealt again. Drawn without rng, so a
  // game that never voids plays exactly as before.
  const planned = new Set(plan.map((p) => p.loc));
  const spare = entries.map((e, loc) => ({ loc, roles: e.roles })).filter((x) => !planned.has(x.loc));

  const state = {
    v: 1,
    cfg,
    players: players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
    order,
    list: entries.map((e) => ({ name: e.name, emoji: e.emoji, cat: e.cat })),
    plan,                     // PRIVATE: [{ loc, roles }] — the secret of each round
    spare,                    // PRIVATE: [{ loc, roles }] — unplanned list entries, for a voided round's replay
    absent: {},               // pid → true: the host marked the seat absent (public, D4)
    roundNo: 0,
    totals: Object.fromEntries(order.map((id) => [id, 0])),
    history: [],              // finished rounds (public)
    round: null,
    tally: null,
    phase: 'reveal',
    deadline: null,
    clockLeft: 0,
    cue: null,
    seq: 0,
  };
  startRound(state, { rng, now });
  return state;
}

/**
 * Deal a round. `redo` = the last one was voided (an absent spy, or the host's 呢鋪唔計): same number and dealer
 * (the next present seat if the dealer is away), the fresh location already put in `plan` by voidRound.
 */
function startRound(s, ctx, { redo = false } = {}) {
  if (!redo) s.roundNo += 1;
  const order = s.order;
  const present = presentOf(s);
  // Dealer = first asker and first final-vote suspect: random over ALL seats in round 1 (drawn
  // before and independently of the spies), then the next seat clockwise (Spyfall 2 rotation). Absent seats are
  // passed over.
  let dealer;
  if (!s.round) dealer = pick(ctx.rng, order);
  else if (redo) dealer = isAbsent(s, s.round.dealer) ? nextPresent(s, s.round.dealer) : s.round.dealer;
  else dealer = nextPresent(s, s.round.dealer) ?? nextSeat(order, s.round.dealer);
  const { loc, roles: pool } = s.plan[s.roundNo - 1];
  // Spies uniform over the present seats. Optional anti-streak: the last scored round's spies sit out when enough
  // others remain.
  const lastScored = s.history.filter((h) => h.code !== 'void');
  const lastSpies = lastScored.length ? lastScored[lastScored.length - 1].spies : [];
  const others = present.filter((id) => !lastSpies.includes(id));
  const spyPool = s.cfg.antiStreak && lastSpies.length && others.length >= s.cfg.spies ? others : present;
  const spies = sample(ctx.rng, spyPool, s.cfg.spies);
  const roles = dealRoles(ctx.rng, pool, order.filter((id) => !spies.includes(id)));

  s.round = {
    n: s.roundNo, dealer, loc, spies, roles,
    redo,                     // this deal replaces a voided one (public)
    seen: {},                 // pid → true: tapped 睇完 on the round's reveal (public)
    ready: {},                // pid → true (public)
    accUsed: {},              // pid → true (public)
    accusations: [],          // [{ by, suspect, result: null | 'passed' | 'failed' }] (public)
    floor: null,              // { holder, prev } once the clock starts
    askHist: [],              // stack of earlier floors, for undo
    warned: false,
    frozen: null,             // ms left while the clock is stopped
    vote: null,
    guess: null,
    finalIdx: 0,
  };
  s.tally = null;
  s.phase = 'reveal';
  s.deadline = null;
  s.clockLeft = 0;
  setCue(s, 'deal', T.deal(s));
}

function runClock(s, now, remaining) {
  const r = s.round;
  r.frozen = null;
  if (!r.warned && remaining > WARN_MIN_REMAINING) {
    s.deadline = now + remaining - WARN_MS;
    s.clockLeft = WARN_MS;
  } else {
    s.deadline = now + remaining;
    s.clockLeft = 0;
    r.warned = true;
  }
}

function stopClock(s, now) {
  s.round.frozen = Math.max(0, clockEnd(s) - now);
  s.deadline = null;
  s.clockLeft = 0;
}

function startPlay(s, ctx) {
  s.phase = 'play';
  const d = s.round.dealer;
  s.round.floor = { holder: isAbsent(s, d) ? (nextPresent(s, d) ?? d) : d, prev: null };
  runClock(s, ctx.now, s.cfg.minutes * 60_000);
  setCue(s, 'start', T.start(s));
}

// ------------------------------------------------------------
// votes
// ------------------------------------------------------------

/** Hands mode: who taps the result — the dealer, else the next present seat that is not the suspect. */
function reporterFor(s, suspect) {
  const d = s.round.dealer;
  const ok = (id) => id !== suspect && !isAbsent(s, id);
  return ok(d) ? d : nextSeat(s.order, d, ok);
}

function openVote(s, kind, suspect, by) {
  const hands = s.cfg.voteMode === 'hands';
  const vote = {
    kind, suspect, by: by ?? null, mode: s.cfg.voteMode, votes: {}, noCount: null,
    reporter: hands ? (kind === 'accuse' ? by : reporterFor(s, suspect)) : null,
  };
  if (kind === 'accuse' && !hands) vote.votes[by] = true;   // the accuser counts as a yes
  s.round.vote = vote;
  s.phase = 'vote';
  s.deadline = null;
  s.clockLeft = 0;
}

/** The next final-vote suspect from `finalIdx` on (absent seats are passed over), or null when nobody is left. */
function openFinalVote(s) {
  const r = s.round;
  const n = s.order.length;
  const start = s.order.indexOf(r.dealer);
  while (r.finalIdx < n && isAbsent(s, s.order[(start + r.finalIdx) % n])) r.finalIdx += 1;
  if (r.finalIdx >= n) return null;
  const suspect = s.order[(start + r.finalIdx) % n];
  openVote(s, 'final', suspect, null);
  return suspect;
}

/** The final vote on one suspect failed (or they left): the next present seat, or the spy survives. */
function nextFinal(s, ctx) {
  const r = s.round;
  r.finalIdx += 1;
  const next = r.finalIdx < s.order.length ? openFinalVote(s) : null;
  if (next == null) return endRound(s, ctx, { code: 'survived' });
  setCue(s, 'final', T.finalNext(s, next), 1500);
  return s;
}

function closeVote(s, ctx) {
  const r = s.round;
  const v = r.vote;
  const voters = votersOf(s);
  let yes = null;
  let no = null;
  let noCount = v.noCount;
  if (v.mode === 'phone') {
    yes = voters.filter((id) => v.votes[id]);
    no = voters.filter((id) => !v.votes[id]);
    noCount = no.length;
  }
  const convicted = noCount <= maxNo(s);
  const pos = v.kind === 'final' ? finalPos(s) : null;
  s.tally = {
    kind: v.kind, suspect: v.suspect, by: v.by, mode: v.mode, yes, no, noCount, voters: voters.length, convicted,
    index: pos ? pos.index : null, of: pos ? pos.of : presentOf(s).length,
  };
  if (v.kind === 'accuse') r.accusations[r.accusations.length - 1].result = convicted ? 'passed' : 'failed';
  r.vote = null;
  s.phase = 'tally';
  s.deadline = ctx.now + TALLY_MS;
  s.clockLeft = 0;
  setCue(s, 'tally', T.tally(s));
}

function finishTally(s, ctx) {
  const t = s.tally;
  const r = s.round;
  s.tally = null;
  if (t.convicted) {
    const isSpy = r.spies.includes(t.suspect);
    const code = t.kind === 'accuse'
      ? (isSpy ? 'accused-spy' : 'accused-innocent')
      : (isSpy ? 'final-spy' : 'final-innocent');
    return endRound(s, ctx, { code, suspect: t.suspect, by: t.by });
  }
  if (t.kind === 'accuse') {
    s.phase = 'play';
    runClock(s, ctx.now, r.frozen);
    return s;
  }
  return nextFinal(s, ctx);
}

function timeUp(s, ctx) {
  const r = s.round;
  r.frozen = 0;
  r.finalIdx = 0;
  const first = openFinalVote(s);
  if (first == null) { endRound(s, ctx, { code: 'survived' }); return; }   // (never: a round keeps ≥ 3 present seats)
  setCue(s, 'timeup', T.timeUp(s, first));
}

// ------------------------------------------------------------
// round end
// ------------------------------------------------------------

function endRound(s, ctx, o) {
  const r = s.round;
  const caught = o.code === 'accused-spy' || o.code === 'final-spy' ? o.suspect : null;
  const mode = s.cfg.accuserBonus;
  const bonusTo = bonusFor({ code: o.code, caught, by: o.by ?? null, accusations: r.accusations, mode });
  const rightSpies = o.rightSpies ?? [];
  const deltas = scoreRound({ order: s.order, spies: r.spies, code: o.code, caught, rightSpies, bonusTo });
  const h = {
    n: r.n,
    loc: r.loc,
    dealer: r.dealer,
    spies: r.spies.slice(),
    code: o.code,
    winTeam: SPY_WINS.has(o.code) ? 'spy' : 'agent',
    suspect: o.suspect ?? null,
    suspectRole: o.suspect != null && !r.spies.includes(o.suspect) ? r.roles[o.suspect] ?? null : null,
    by: o.by ?? null,
    caught,
    bonusTo,
    bonusMode: mode,
    accusations: r.accusations.map((a) => ({ by: a.by, suspect: a.suspect })),   // public already; explains the bonus
    picks: o.picks ?? null,
    rightSpies,
    deltas,
  };
  for (const id of s.order) s.totals[id] += deltas[id];
  s.history.push(h);
  r.vote = null;
  r.guess = null;
  s.tally = null;
  s.phase = 'roundEnd';
  s.deadline = null;
  s.clockLeft = 0;
  setCue(s, 'end', T.roundEnd(s, h), 4000);
  return s;
}

// ------------------------------------------------------------
// void round (absent spy, or the host's 呢鋪唔計) and absent seats (D4)
// ------------------------------------------------------------

const LIVE = new Set(['reveal', 'play', 'vote', 'tally', 'guess']);

/**
 * Throw the round in play away: nobody scores, its location and spies go into the history (the round is dead, so
 * they are public now and the location greys out), and the same round number is dealt again with a spare location.
 * With no spare left the round simply does not count and the game moves on.
 * `why` = 'absent' (`who` = the absent spy) | 'host'.
 */
function voidRound(s, ctx, why, who = null) {
  const r = s.round;
  s.history.push({
    n: r.n, loc: r.loc, dealer: r.dealer, spies: r.spies.slice(), code: 'void', why, absent: who,
    winTeam: null, suspect: null, suspectRole: null, by: null, caught: null, bonusTo: null,
    bonusMode: s.cfg.accuserBonus, accusations: r.accusations.map((a) => ({ by: a.by, suspect: a.suspect })),
    picks: null, rightSpies: [], deltas: zeros(s),
  });
  r.vote = null;
  r.guess = null;
  s.tally = null;
  const spare = Array.isArray(s.spare) ? s.spare : [];
  if (spare.length && ctx && typeof ctx.rng === 'function') {
    const [next] = spare.splice(rint(ctx.rng, spare.length), 1);
    s.plan[s.roundNo - 1] = next;
    startRound(s, ctx, { redo: true });
    return s;
  }
  if (r.n >= s.cfg.rounds) {
    s.phase = 'over';
    s.deadline = null;
    s.clockLeft = 0;
    setCue(s, 'over', T.over(s), 3000);
    return s;
  }
  startRound(s, ctx);
  return s;
}

/** The round's reveal: `pids` tapped 睇完; once every present seat has, the next round (or the end). */
function markSeen(s, pids, ctx) {
  const r = s.round;
  r.seen ??= {};                // (a round restored from a snapshot taken before 睇完 existed)
  let any = false;
  for (const id of pids) {
    if (!isPlayer(s, id) || isAbsent(s, id) || r.seen[id]) continue;
    r.seen[id] = true;
    any = true;
  }
  if (any && presentOf(s).every((id) => r.seen[id])) doNextRound(s, ctx);
  return s;
}

/** Host `@absent`: stop waiting on `pid` for the rest of this game. Unchanged state = refused. */
function markAbsent(s, pid, ctx) {
  if (!isPlayer(s, pid) || isAbsent(s, pid) || s.phase === 'over') return s;
  if (presentOf(s).length - 1 < minPresent(s)) return s;       // too few left to play a round
  s.absent = { ...(s.absent ?? {}), [pid]: true };
  const r = s.round;
  if (LIVE.has(s.phase) && r.spies.includes(pid)) return voidRound(s, ctx, 'absent', pid);

  // the question card never rests on an empty chair
  if (r.floor && r.floor.holder === pid) r.floor = { holder: nextPresent(s, pid) ?? pid, prev: null };

  switch (s.phase) {
    case 'reveal':
      if (presentOf(s).every((id) => r.ready[id])) startPlay(s, ctx);
      break;
    case 'vote': {
      const v = r.vote;
      if (pid === v.suspect) {
        if (v.kind === 'final') return nextFinal(s, ctx);
        // an accusation of a seat that has left: called off, the accuser keeps the one try, the clock resumes
        r.accusations.pop();
        delete r.accUsed[v.by];
        r.vote = null;
        s.phase = 'play';
        runClock(s, ctx.now, r.frozen);
        setCue(s, 'accuse-off', T.accuseOff(s, pid), 2000);
        break;
      }
      // (a ballot already cast stays on file: it counts again if the seat comes back before the vote closes)
      if (v.mode === 'hands') {
        if (v.reporter === pid) v.reporter = reporterFor(s, v.suspect);
      } else if (votersOf(s).every((id) => id in v.votes)) closeVote(s, ctx);
      break;
    }
    case 'roundEnd':
      if (presentOf(s).every((id) => r.seen?.[id])) doNextRound(s, ctx);
      break;
    default:
  }
  return s;
}

/** Host `@present`: the seat is back and is waited on again from now on. */
function markPresent(s, pid) {
  if (!isPlayer(s, pid) || !isAbsent(s, pid) || s.phase === 'over') return s;
  const next = { ...s.absent };
  delete next[pid];
  s.absent = next;
  return s;
}

/** Would 呢鋪唔計 (@void-round) do anything now? (engine.canVoid, read by the shell for its message.) */
export function canVoid(state) {
  const s = state;
  if (!s || s.phase === 'over') return { ok: false, message: '遊戲已經完咗' };
  if (s.phase === 'roundEnd') return { ok: false, message: '呢局已經計咗分，㩒「睇完」就得' };
  return { ok: true };
}

// ------------------------------------------------------------
// act
// ------------------------------------------------------------

export function act(state, msg, ctx) {
  const s = state;
  if (!s || !msg || typeof msg !== 'object') return s;
  const { pid, action } = msg;
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return s;
  ctx = ctx || {};

  if (pid === HOST) return hostAct(s, action, ctx);
  if (!isPlayer(s, pid) || isAbsent(s, pid)) return s;      // an absent seat acts again once the host marks it back

  switch (s.phase) {
    case 'reveal': return action.type === 'ready' ? doReady(s, pid, ctx) : s;
    case 'play': return playAct(s, pid, action, ctx);
    case 'vote': return voteAct(s, pid, action, ctx);
    case 'guess': return action.type === 'guess' ? doGuess(s, pid, action, ctx) : s;
    case 'roundEnd': {
      // 睇完. `seats` = the other seats this same phone holds (a passed-round phone reads the reveal once for all)
      if (action.type !== 'next-round' || s.round.seen?.[pid]) return s;
      const also = Array.isArray(action.seats) ? action.seats.filter((x) => typeof x === 'string') : [];
      return markSeen(s, [pid, ...also], ctx);
    }
    default: return s;
  }
}

function hostAct(s, a, ctx) {
  switch (a.type) {
    case ACT.CUE_DONE:
      if (s.cue && !s.cue.done && s.cue.id === a.id) s.cue.done = true;
      return s;
    case ACT.NEXT:
      // 下一步: first it finishes the narration; on the round's reveal it then moves everybody on (D3: the host can
      // force it while somebody is still reading). Nothing else waits on it.
      if (s.cue && !s.cue.done) s.cue.done = true;
      else if (s.phase === 'roundEnd') doNextRound(s, ctx);
      return s;
    case ACT.VOID_ROUND:
      return LIVE.has(s.phase) ? voidRound(s, ctx, 'host') : s;
    case ABSENT: return markAbsent(s, a.pid, ctx);
    case PRESENT: return markPresent(s, a.pid);
    default: return s;
  }
}

function doReady(s, pid, ctx) {
  const r = s.round;
  if (r.ready[pid]) return s;
  r.ready[pid] = true;
  if (presentOf(s).every((id) => r.ready[id])) startPlay(s, ctx);
  return s;
}

function playAct(s, pid, a, ctx) {
  const r = s.round;
  switch (a.type) {
    case 'ask': {
      const f = r.floor;
      if (!isPlayer(s, a.target) || isAbsent(s, a.target) || a.target === f.holder || a.target === f.prev) return s;
      r.askHist.push({ holder: f.holder, prev: f.prev });
      if (r.askHist.length > UNDO_DEPTH) r.askHist.shift();
      r.floor = { holder: a.target, prev: f.holder };
      return s;
    }
    case 'undo-ask':
      if (!r.askHist.length) return s;
      r.floor = r.askHist.pop();
      return s;
    case 'accuse': {
      if (r.accUsed[pid] || !isPlayer(s, a.target) || isAbsent(s, a.target) || a.target === pid) return s;
      if (ctx.now >= clockEnd(s)) return s;          // 0:00 already passed, the final vote is coming
      r.accUsed[pid] = true;
      r.accusations.push({ by: pid, suspect: a.target, result: null });
      stopClock(s, ctx.now);
      openVote(s, 'accuse', a.target, pid);
      setCue(s, 'accuse', T.accuse(s, pid, a.target));
      return s;
    }
    case 'spy-stop': {
      if (!r.spies.includes(pid) || ctx.now >= clockEnd(s)) return s;
      stopClock(s, ctx.now);
      r.guess = { order: [pid, ...r.spies.filter((x) => x !== pid)], idx: 0, picks: {} };
      s.phase = 'guess';
      setCue(s, 'guess', T.guess(s, pid));
      return s;
    }
    default: return s;
  }
}

function voteAct(s, pid, a, ctx) {
  const v = s.round.vote;
  if (a.type === 'vote') {
    if (v.mode !== 'phone' || typeof a.yes !== 'boolean') return s;
    if (!votersOf(s).includes(pid) || pid in v.votes) return s;
    v.votes[pid] = a.yes;
    if (votersOf(s).every((id) => id in v.votes)) closeVote(s, ctx);
    return s;
  }
  if (a.type === 'verdict') {
    if (v.mode !== 'hands' || pid !== v.reporter) return s;
    if (!Number.isInteger(a.no) || a.no < 0 || a.no > votersOf(s).length) return s;
    v.noCount = a.no;
    closeVote(s, ctx);
    return s;
  }
  return s;
}

function doGuess(s, pid, a, ctx) {
  const g = s.round.guess;
  if (pid !== g.order[g.idx]) return s;
  if (!Number.isInteger(a.loc) || a.loc < 0 || a.loc >= s.list.length) return s;
  g.picks[pid] = a.loc;
  g.idx += 1;
  if (g.idx < g.order.length) {
    setCue(s, 'guess2', T.guessNext(s, g.order[g.idx]));
    return s;
  }
  const right = g.order.filter((id) => g.picks[id] === s.round.loc);
  return endRound(s, ctx, {
    code: right.length ? 'guess-right' : 'guess-wrong',
    by: g.order[0],
    picks: { ...g.picks },
    rightSpies: right,
  });
}

function doNextRound(s, ctx) {
  if (s.round.n >= s.cfg.rounds) {
    s.phase = 'over';
    setCue(s, 'over', T.over(s), 3000);
    return s;
  }
  startRound(s, ctx);
  return s;
}

// ------------------------------------------------------------
// advance (deadline reached)
// ------------------------------------------------------------

export function advance(state, ctx) {
  const s = state;
  if (!s || s.deadline == null || !ctx || ctx.now + SLACK_MS < s.deadline) return s;
  if (s.phase === 'play') {
    if (s.clockLeft > 0) {                       // the one-minute warning
      s.deadline = clockEnd(s);
      s.clockLeft = 0;
      s.round.warned = true;
      setCue(s, 'warn', T.warn(), 1500);
      return s;
    }
    timeUp(s, ctx);
    return s;
  }
  if (s.phase === 'tally') return finishTally(s, ctx);
  return s;
}

// ------------------------------------------------------------
// legal actions / auto-act / focus / cue / result
// ------------------------------------------------------------

export function legalActions(state, pid) {
  const s = state;
  if (!s || !isPlayer(s, pid) || isAbsent(s, pid)) return [];
  const r = s.round;
  const out = [];
  const here = presentOf(s);
  switch (s.phase) {
    case 'reveal':
      if (!r.ready[pid]) out.push({ type: 'ready' });
      break;
    case 'play': {
      const f = r.floor;
      for (const id of here) if (id !== f.holder && id !== f.prev) out.push({ type: 'ask', target: id });
      if (r.askHist.length) out.push({ type: 'undo-ask' });
      if (!r.accUsed[pid]) for (const id of here) if (id !== pid) out.push({ type: 'accuse', target: id });
      if (r.spies.includes(pid)) out.push({ type: 'spy-stop' });
      break;
    }
    case 'vote': {
      const v = r.vote;
      if (v.mode === 'phone') {
        if (votersOf(s).includes(pid) && !(pid in v.votes)) out.push({ type: 'vote', yes: true }, { type: 'vote', yes: false });
      } else if (pid === v.reporter) {
        for (let no = 0; no <= votersOf(s).length; no++) out.push({ type: 'verdict', no });
      }
      break;
    }
    case 'guess': {
      const g = r.guess;
      if (pid === g.order[g.idx]) for (let loc = 0; loc < s.list.length; loc++) out.push({ type: 'guess', loc });
      break;
    }
    case 'roundEnd':
      if (!r.seen?.[pid]) out.push({ type: 'next-round' });       // 睇完 (the UI may add `seats` on a shared phone)
      break;
    default:
  }
  return out;
}

/** What to do for a stalled seat. Never convicts, never moves the question around. */
export function autoAct(state, pid, ctx) {
  const s = state;
  const opts = legalActions(s, pid);
  if (!opts.length) return null;
  switch (s.phase) {
    case 'reveal': return { type: 'ready' };
    case 'vote':
      return s.round.vote.mode === 'phone'
        ? { type: 'vote', yes: false }
        : { type: 'verdict', no: Math.min(votersOf(s).length, maxNo(s) + 1) };   // one more "no" than a conviction can survive
    case 'guess': return ctx && ctx.rng ? pick(ctx.rng, opts) : opts[0];
    case 'roundEnd': return { type: 'next-round' };
    default: return null;
  }
}

export function focus(state) {
  const s = state;
  const r = s.round;
  if (s.phase === 'reveal') {
    const wait = presentOf(s).filter((id) => !r.ready[id]);
    return wait.length ? { pids: wait } : null;
  }
  if (s.phase === 'vote') {
    const v = r.vote;
    if (v.mode === 'hands') return { pids: [v.reporter] };
    const wait = votersOf(s).filter((id) => !(id in v.votes));
    return wait.length ? { pids: wait } : null;
  }
  if (s.phase === 'guess') return { pids: [r.guess.order[r.guess.idx]] };
  return null;
}

export function cue(state) {
  const c = state && state.cue;
  return c && !c.done ? { id: c.id, text: c.text, minMs: c.minMs } : null;
}

export function result(state) {
  const s = state;
  if (s.phase !== 'over') return null;
  const max = Math.max(...s.order.map((id) => s.totals[id]));
  const winners = s.order.filter((id) => s.totals[id] === max);
  const lines = s.history.map((h) => roundLine(s, h));
  const last = s.history[s.history.length - 1];
  if (last) {
    if (s.history.length > 1) lines.push(`第 ${last.n} 局點解咁計：`);
    lines.push(...explainLines(s, last));
  }
  return { winners, summary: summaryOf(s), lines, points: { ...s.totals } };
}

// ------------------------------------------------------------
// view — whitelist only. `mine` is the single place a seat's secret lives.
// ------------------------------------------------------------

function subtitleOf(s) {
  const r = s.round;
  switch (s.phase) {
    case 'reveal': return '睇身分';
    case 'play': return `${nameOf(s, r.floor.holder)} 發問`;
    case 'vote': {
      if (r.vote.kind === 'accuse') return `${nameOf(s, r.vote.by)} 指控 ${nameOf(s, r.vote.suspect)}`;
      const pos = finalPos(s);
      return `最後投票 ${pos.index}/${pos.of}`;
    }
    case 'tally': return '投票結果';
    case 'guess': return '間諜猜地點';
    case 'roundEnd': return '本局結果';
    default: return '總結';
  }
}

/**
 * 「而家要做咩」 — one line for a first-timer, shown only when the player taps 💡 (BACKLOG U1).
 * Built from PUBLIC facts only (phase, who holds the question, who is accused / reporting /
 * guessing, whether this seat has readied or voted) so it can never hint at who the spy is.
 */
function hintOf(s, pid) {
  const r = s.round;
  const me = pid != null && isPlayer(s, pid) ? pid : null;
  const v = r.vote;
  if (me && isAbsent(s, me) && s.phase !== 'over') return '房主當咗你唔喺度；返咗嚟就叫房主加返你。';
  switch (s.phase) {
    case 'reveal':
      if (!me) return '大家睇緊身分，齊人準備好就開始。';
      return r.ready[me] ? '等其他人睇完，齊人就開始計時。' : '㩒住張卡睇自己身分，睇完㩒「準備好」。';
    case 'play':
      if (me && r.floor.holder === me) return '輪到你：揀一個人問一條關於地點嘅問題，再㩒佢個名。';
      return `聽${nameOf(s, r.floor.holder)}問同大家答；覺得邊個係間諜，可以㩒「🙋 指控」。`;
    case 'vote': {
      const sus = nameOf(s, v.suspect);
      const final = v.kind === 'final';
      if (me && me === v.suspect) return final ? '輪到大家投你，你唔使投；可以解釋，但唔好講出地點。' : '你被指控，唔使投票，等大家決定。';
      if (v.mode === 'hands') {
        if (me && me === v.reporter) return `叫大家一齊舉手（覺得${sus}係間諜先舉），數吓幾多人冇舉，㩒結果。`;
        return `覺得${sus}係間諜就舉手，等${nameOf(s, v.reporter)}㩒結果。`;
      }
      if (!me) return '大家投緊票。';
      if (me in v.votes) return !final && me === v.by ? `你指控咗${sus}，自動當贊成，等其他人投。` : '投咗喇，等其他人投完。';
      return final
        ? `最後投票：覺得${sus}係間諜就㩒贊成；可以傾，但唔好講出地點。`
        : `${sus}係唔係間諜？係就㩒贊成，唔係就反對；唔好講理由。`;
    }
    case 'tally': return '睇吓投票結果，幾秒後自動繼續。';
    case 'guess': {
      const cur = r.guess.order[r.guess.idx];
      if (me && me === cur) return '喺地點清單揀你估嘅地點，再㩒「就係…」確定。';
      return `等${nameOf(s, cur)}喺清單揀地點：估中間諜贏，估錯大家贏。`;
    }
    case 'roundEnd':
      if (me && r.seen?.[me]) return r.n >= s.cfg.rounds ? '等其他人睇完，齊人就睇總分。' : '等其他人睇完，齊人就開下一局。';
      return '睇吓地點、間諜同點計分，睇完㩒「睇完」。';
    default: return '打完喇！睇吓總分同每局發生咩事。';
  }
}

function viewVote(s) {
  const v = s.round.vote;
  if (!v) return null;
  const voters = votersOf(s);
  const pos = v.kind === 'final' ? finalPos(s) : null;
  return {
    kind: v.kind,
    suspect: v.suspect,
    by: v.by,
    mode: v.mode,
    voters,
    voted: v.mode === 'phone' ? voters.filter((id) => id in v.votes) : [],
    need: needYes(s),
    maxNo: maxNo(s),
    reporter: v.reporter,
    index: pos ? pos.index : null,
    of: pos ? pos.of : presentOf(s).length,
  };
}

function viewTally(s) {
  const t = s.tally;
  if (!t) return null;
  return {
    kind: t.kind, suspect: t.suspect, by: t.by, mode: t.mode,
    yes: t.yes ? t.yes.slice() : null,
    no: t.no ? t.no.slice() : null,
    noCount: t.noCount, voters: t.voters, convicted: t.convicted,
    index: t.index, of: t.of ?? s.order.length,
  };
}

function viewGuess(s) {
  const g = s.round.guess;
  if (!g) return null;
  return {
    current: g.order[g.idx],
    shown: g.order.slice(0, g.idx + 1),     // a second spy stays hidden until it is their turn
    picks: { ...g.picks },
  };
}

function viewEnd(s) {
  const r = s.round;
  const h = s.history[s.history.length - 1];
  if (!h || h.n !== r.n) return null;
  const loc = locOf(s, h.loc);
  return {
    n: h.n,
    last: h.n >= s.cfg.rounds,
    location: { i: h.loc, name: loc.name, emoji: loc.emoji },
    dealer: h.dealer,
    spies: h.spies.slice(),
    roles: { ...r.roles },
    code: h.code, winTeam: h.winTeam, suspect: h.suspect, by: h.by, caught: h.caught, bonusTo: h.bonusTo,
    picks: h.picks ? { ...h.picks } : null,
    rightSpies: h.rightSpies.slice(),
    deltas: { ...h.deltas },
    headline: headlineOf(s, h),
    lines: explainLines(s, h),
  };
}

function viewMine(s, pid) {
  if (!pid || !isPlayer(s, pid)) return null;
  const r = s.round;
  const isSpy = r.spies.includes(pid);
  const loc = locOf(s, r.loc);
  const card = isSpy
    ? { spy: true, emoji: '🕵️', name: '你係間諜', text: '靠大家嘅問答諗出地點，唔好俾人睇穿。' }
    : { spy: false, emoji: loc.emoji, name: loc.name, text: `你嘅身分：${r.roles[pid]}` };
  const v = r.vote;
  return {
    pid,
    card,
    isSpy,
    role: isSpy ? 'spy' : 'agent',      // rules.roles id (for the 💡 sheet; private like the card)
    ready: !!r.ready[pid],
    accUsed: !!r.accUsed[pid],
    isVoter: !!v && votersOf(s).includes(pid),
    vote: v && v.mode === 'phone' && pid in v.votes ? v.votes[pid] : null,
    seen: !!r.seen?.[pid],
  };
}

export function view(state, pid) {
  const s = state;
  const r = s.round;
  const running = s.phase === 'play';
  const pastRounds = s.history.map((h) => h.loc);
  const f = r.floor;
  const here = presentOf(s);
  const lastVoid = r.redo ? s.history.filter((h) => h.code === 'void' && h.n === r.n).pop() : null;
  return {
    phase: s.phase,
    title: `間諜 · 第 ${r.n}/${s.cfg.rounds} 局`,
    subtitle: subtitleOf(s),
    hint: hintOf(s, pid),
    round: { n: r.n, of: s.cfg.rounds },
    rules: { minutes: s.cfg.minutes, spies: s.cfg.spies, voteMode: s.cfg.voteMode, maxNo: maxNo(s) },
    seats: s.order.slice(),
    dealer: r.dealer,
    locations: s.list.map((e, i) => ({ i, name: e.name, emoji: e.emoji, cat: e.cat, used: pastRounds.includes(i) })),
    deadline: running ? clockEnd(s) : null,
    frozen: !running && r.frozen != null && ['vote', 'tally', 'guess'].includes(s.phase) ? r.frozen : null,
    ready: s.phase === 'reveal'
      ? { done: here.filter((id) => r.ready[id]).length, total: here.length, who: s.order.filter((id) => r.ready[id]) }
      : null,
    // the round's reveal: who has tapped 睇完 (present seats only), so every phone shows 「睇完 3 / 5」
    seen: s.phase === 'roundEnd'
      ? { done: here.filter((id) => r.seen?.[id]).length, total: here.length, who: here.filter((id) => r.seen?.[id]) }
      : null,
    absent: s.order.filter((id) => isAbsent(s, id)),     // public (D4): shown as 💤, never waited on
    // this deal replaces a voided one: what was thrown away (all of it public now)
    redo: lastVoid ? {
      why: lastVoid.why, absent: lastVoid.absent ?? null, spies: lastVoid.spies.slice(),
      location: { i: lastVoid.loc, name: locOf(s, lastVoid.loc).name, emoji: locOf(s, lastVoid.loc).emoji },
    } : null,
    accUsed: s.order.filter((id) => r.accUsed[id]),
    accusations: r.accusations.map((a) => ({ by: a.by, suspect: a.suspect, result: a.result })),
    floor: f ? {
      holder: f.holder,
      prev: f.prev,
      trail: r.askHist.slice(-4).map((h) => h.holder).concat(f.holder),
      canUndo: r.askHist.length > 0,
    } : null,
    vote: viewVote(s),
    tally: viewTally(s),
    guess: viewGuess(s),
    end: s.phase === 'roundEnd' || s.phase === 'over' ? viewEnd(s) : null,
    totals: { ...s.totals },
    history: s.history.map((h) => ({
      n: h.n, loc: h.loc, spies: h.spies.slice(), code: h.code, winTeam: h.winTeam, deltas: { ...h.deltas },
    })),
    mine: viewMine(s, pid),
  };
}

export const engine = { setup, act, advance, view, cue, focus, autoAct, legalActions, result, canVoid };
