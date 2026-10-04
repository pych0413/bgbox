// ============================================================
// 狼人殺 — every Cantonese line of the game: rules text, config labels, the
// narrator's script, announcements, the recap, and the on-screen wording.
//
// Pure strings in, strings out (no DOM, no clock). Original wording written
// for this app; nothing is copied from the official rulebook or moderator apps.
//
// IMPORTANT: narration cues are spoken from the host phone, so everything in
// the `cue*` functions may only use PUBLIC information (names, seat numbers,
// who died, the vote). Secrets live in the private panels (`PANEL`) only.
// ============================================================

// ---------- numbers & names ----------

const DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 0–99 in Chinese numerals (十二, 二十一); anything else stays as digits. */
function zh(n) {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 10) return DIGIT[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return `${t === 1 ? '' : DIGIT[t]}十${u ? DIGIT[u] : ''}`;
}
/** Ordinal-style numerals ("第二晚"). */
export const numZh = (n) => zh(n);
/** A COUNT read aloud: 2 is 「兩」 in Cantonese (「兩票」, never 「二票」, which is how a voice reads "2 票"). */
export const countZh = (n) => (n === 2 ? '兩' : zh(n));
/** 「阿明、阿B同阿C」 — a spoken list. */
export const andZh = (list) => (list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join('、')}同${list[list.length - 1]}`);
/** 「阿明或者阿B」 — a spoken choice. */
export const orZh = (list) => (list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join('、')}或者${list[list.length - 1]}`);

// ---------- roles ----------

export const ROLE_IDS = ['werewolf', 'villager', 'seer', 'witch', 'hunter', 'guard', 'idiot'];
export const GOD_IDS = ['seer', 'witch', 'hunter', 'guard', 'idiot'];

// The 📖 rules sheet has no table, so it states both win rules; the role card (roleCardText) prints this table's rule only.
const WIN_WOLF = '殺晒神職或者平民（屠邊），或者殺晒所有好人（屠城）— 睇房主設定。';
const WIN_GOOD = '所有狼人出局。';
/** 點贏 for one side under one win rule ('edge' 屠邊 | 'city' 屠城). */
const WIN_BY = {
  wolf: {
    city: '今局屠城，要殺晒所有好人（神職同平民）。',
    edge: '今局屠邊，殺晒所有神職或者殺晒所有平民就贏。',
  },
  good: {
    city: '所有狼人出局。（今局屠城：狼人要殺晒所有好人先贏）',
    edge: '所有狼人出局。（今局屠邊：神職或者平民死晒，狼人就贏）',
  },
};

const roleText = (what, win) => `做乜：${what} 點贏：${win}`;
const mk = (id, name, emoji, team, what, win) => ({ id, name, emoji, team, what, win, text: roleText(what, win) });

export const ROLES = {
  werewolf: mk('werewolf', '狼人', '🐺', 'wolf', '夜晚同隊友一齊揀一個人殺，日頭扮好人；發言時可以自爆。', WIN_WOLF),
  villager: mk('villager', '平民', '🧑', 'good', '冇技能，靠聽人發言、推理同投票。', WIN_GOOD),
  seer: mk('seer', '預言家', '🔮', 'good', '每晚驗一個人：佢係好人定狼人（唔會知具體角色）。', WIN_GOOD),
  witch: mk('witch', '女巫', '🧪', 'good', '一支解藥、一支毒藥，各用一次，同一晚淨係用一支。', WIN_GOOD),
  hunter: mk('hunter', '獵人', '🏹', 'good', '出局時可以開槍帶走一個人（被毒死除外），亦可以唔開。', WIN_GOOD),
  guard: mk('guard', '守衛', '🛡️', 'good', '每晚守一個人（可守自己），唔可以連續兩晚守同一個；擋唔到毒藥。', WIN_GOOD),
  idiot: mk('idiot', '白痴', '🤡', 'good', '被投票放逐時翻牌：唔出局，但以後冇票；其他死法照死。', WIN_GOOD),
};

export const roleName = (id) => ROLES[id]?.name ?? '?';
export const roleTag = (id) => (ROLES[id] ? `${ROLES[id].emoji} ${ROLES[id].name}` : '?');
export const campName = (camp) => (camp === 'wolf' ? '🐺 狼人' : '✅ 好人');

/**
 * The role card's text, with a line about what this board adds for that role. With `win` ('edge' | 'city') the
 * 點贏 part states THIS table's rule only (a wolf is never told 「睇設定」 on a table that has already decided).
 */
export function roleCardText(roleId, { hasWitch, hasGuard, win } = {}) {
  const r = ROLES[roleId];
  if (!r) return '';
  const side = r.team === 'wolf' ? 'wolf' : 'good';
  const base = WIN_BY[side][win] ? roleText(r.what, WIN_BY[side][win]) : r.text;
  const extra = boardExtra(roleId, { hasWitch, hasGuard });
  return extra ? `${base} ${extra}` : base;
}

/** The line this board adds to a role (public facts only: the board and the role itself). */
function boardExtra(roleId, { hasWitch, hasGuard } = {}) {
  if (roleId === 'werewolf') return '第一晚你會知邊個係隊友。';
  if (roleId === 'guard' && hasWitch) return '你同女巫又守又救同一個人，個人會死。';
  if (roleId === 'witch' && hasGuard) return '同守衛又守又救同一個人，個人會死。';
  return '';
}

/**
 * The 💡 sheet's role box for THIS table (view.hintRoleText → { what, win }): the same words as the role card, with the
 * board's extra line under 做乜 and only this table's rule under 點贏. Built from the role, the board and the win rule —
 * so every seat holding the same card gets exactly the same text, and nothing in it depends on a hidden fact.
 */
export function roleHintText(roleId, { hasWitch, hasGuard, win } = {}) {
  const r = ROLES[roleId];
  if (!r) return null;
  const side = r.team === 'wolf' ? 'wolf' : 'good';
  const extra = boardExtra(roleId, { hasWitch, hasGuard });
  return { what: extra ? `${r.what} ${extra}` : r.what, win: WIN_BY[side][win] ?? r.win };
}

// ---------- rules (the shell's 規則 sheet) ----------

export const RULES = {
  quick: [
    '每人一張身份牌：狼人夜晚殺人，日頭扮好人。',
    '天黑閉眼，手機逐個角色叫醒；人人都有掣㩒，冇人露底。',
    '天光報死訊 → 遺言 → 輪流發言 → 投票放逐一個人。',
    '平票就 PK 再投；再平票，今日冇人出局。',
    '獵人出局可以開槍（被毒除外）；白痴被放逐翻牌唔死。',
    '狼人全部出局，好人贏；殺晒神職或平民（細局要殺晒好人），狼人贏。',
  ],
  // Every role: what you do (做乜) and how you win (點贏), in that order (the 💡 sheet splits on it).
  roles: ['werewolf', 'villager', 'seer', 'witch', 'hunter', 'guard', 'idiot'].map((id) => ({
    id, name: ROLES[id].name, emoji: ROLES[id].emoji, team: ROLES[id].team, text: ROLES[id].text,
  })),
  sections: [
    {
      title: '玩法流程',
      body: '1. 房主揀人數同配置（每個人數都有一個推薦配置，同埋點解）。座位次序要同你哋真係坐嘅次序一樣，因為發言次序按座位計。\n'
        + '2. 派牌：每人㩒住張牌睇身份，睇完㩒「睇完喇」。\n'
        + '3. 夜晚 → 天光 → 日頭（遺言、發言、投票）→ 夜晚……一直輪，直到有一邊贏。\n'
        + '4. 贏咗之後，手機會公開晒所有人身份，同埋逐晚發生咩事（包括你哋睇唔到嘅操作）。',
    },
    {
      title: '夜晚點行',
      body: '手機按次序叫醒角色：守衛 → 狼人 → 女巫 → 預言家 → 獵人（設定可以轉做：狼人 → 預言家 → 守衛 → 女巫 → 獵人）。\n'
        + '配置入面有嘅角色，每一晚都會叫，就算嗰個人已經出局、或者藥用晒；配置入面冇嘅角色就唔叫。咁樣每個人都唔會因為「叫唔叫」而露底。\n'
        + '每一步時間固定，唔會因為有人做完就提早完。冇嘢做嘅人，手機一樣有人可以揀、有掣可以㩒，㩒完冇任何效果。\n'
        + '所有動作要等到天光先一齊結算。',
    },
    {
      title: '各角色嘅夜晚',
      body: '🛡️ 守衛：揀一個人守（可以守自己），或者空守。唔可以連續兩晚守同一個人。被守嘅人唔會被狼人殺到，但擋唔到毒藥。\n'
        + '🐺 狼人：全部狼人一齊揀一個人殺（可以揀隊友或者自己，亦可以空刀）。你哋會即時見到隊友揀咗邊個。意見唔一致就按設定處理（預設：票數最多嘅人，同票隨機）。\n'
        + '🧪 女巫：只要解藥未用，你會見到今晚被襲擊嘅人，可以㩒佢用解藥；㩒其他人就係用毒藥。同一晚只可以用一支。解藥用咗之後，你唔會再知道邊個被襲擊。\n'
        + '🔮 預言家：揀一個人驗，確定之後見到佢係好人定狼人。同一個人唔可以驗兩次。\n'
        + '🏹 獵人：每晚都會叫醒你睇你嘅槍：「冇被毒」就係可以開槍，被毒就開唔到。',
    },
    {
      title: '夜晚結算（天光先知）',
      body: '・狼人殺咗人、冇人守又冇人救：死。\n'
        + '・被守衛守住：生。　被女巫救：生。\n'
        + '・又守又救同一個人：死（俗稱「奶穿」，設定可以改做生）。\n'
        + '・被毒藥毒中：死，不論有冇守、有冇救（「毒穿」）。被毒死嘅獵人開唔到槍。\n'
        + '・死咗幾個，按座位號由細到大公佈，唔講點死。',
    },
    {
      title: '天光同日頭',
      body: '1. 公佈昨晚死咗邊個，或者平安夜。\n'
        + '2. 遺言：第一晚死嘅人有遺言；之後夜晚死嘅冇（設定可以改）。白天出局嘅人（放逐、被獵人槍殺、自爆）都有遺言。\n'
        + '3. 獵人出局：有「最後行動」時間，獵人可以開槍。為咗唔露底，每個出局嘅人都有同樣長嘅最後行動時間。\n'
        + '4. 發言：所有仍然生存嘅人逐個講（包括翻咗牌嘅白痴）。次序由死者隔離開始（平安夜隨機），每日轉方向。\n'
        + '5. 投票放逐。',
    },
    {
      title: '投票同 PK',
      body: '所有生存嘅人（翻咗牌嘅白痴除外）同時秘密投票，可以棄權。投完公開晒邊個投邊個。\n'
        + '・最高票得一個：放逐。冇人得票（全部棄權）：今日冇人出局。\n'
        + '・平票：平票嘅人逐個 PK 發言，然後其他人（平票嘅人唔可以投）再投一次。再平票：今日冇人出局。\n'
        + '・白痴第一次被放逐：翻牌，唔出局，以後冇票，仲可以發言。再被放逐就照死。',
    },
    {
      title: '自爆',
      body: '白天發言嗰陣，狼人可以㩒住「自爆」掣：佢即刻出局（有 30 秒遺言），剩低嘅發言同投票全部取消，直接入夜。\n'
        + '投票開始之後唔可以自爆。每個人畫面都有一樣嘅自爆掣；唔係狼人㩒咗冇任何反應。預設淨係日頭發言可以自爆，PK 發言可以喺設定打開。\n'
        + '一部手機玩：發言緊嗰個先拎住部手機，所以只可以喺自己發言嗰陣自爆。',
    },
    {
      title: '勝負',
      body: '・狼人全部出局：好人贏。\n'
        + '・屠邊（9 人或以上嘅標準）：所有神職出局，或者所有平民出局，狼人贏。\n'
        + '・屠城（6–8 人、新手局）：要所有神職同平民都出局，狼人先贏。\n'
        + '・白痴預設算神職，翻咗牌仲生存都要殺（設定可以改算平民）。\n'
        + '・兩邊條件同時達成：狼人贏。每次有人出局都即時檢查，獵人如果係最後一個神職，死咗都開唔到槍。',
    },
    {
      title: '手機點做主持',
      body: '手機係上帝：派牌、叫夜晚、結算、報死訊、計時、計票、判勝負。\n'
        + '你嘅身份、女巫嘅藥、預言家嘅結果、狼人隊友同狼刀，只會喺你自己嘅畫面出現，其他人睇唔到。\n'
        + '房主部手機都係一部普通玩家手機（技術上存住全場資料，但畫面唔會顯示）。如果你唔信得過房主，可以揀「人手主持」。\n'
        + '旁白（語音／讀稿／靜音）喺選單揀：靜音嘅話，每一步都會喺畫面上寫出嚟。一部手機玩冇靜音（大家閉埋眼，冇聲就唔知叫緊邊個）。',
    },
    {
      title: '人手主持（上帝模式）',
      body: '房主唔攞牌，用自己部手機睇到所有人身份同夜晚嘅一舉一動，自己用口講旁白（手機會顯示稿，旁白揀「讀稿」，㩒「下一步」）。\n'
        + '玩家仍然用自己部手機操作，所以主持唔使睇手勢。人手主持最多 12 個玩家（連主持 13 部手機）。\n'
        + '主持可以隨時㩒「下一步」跳過等緊嘅步驟；有人斷線，選單可以「代佢做」。',
    },
    {
      title: '一部機玩',
      body: '手機擺喺枱中間，旁白要開聲：揀 🔊 語音，或者搵個唔玩嘅人 📜 讀稿（一部機冇靜音）。夜晚節奏會自動用「慢」。\n'
        + '夜晚叫到邊個角色，嗰個人拎起部手機做嘢，做完㩒「睇完，放返中間」再放低。卡上面只會寫「預言家請拎起部手機」，唔會寫名；角色出局咗都照叫、照拎機，咁就冇人露底。\n'
        + '狼人多過一隻：叫到狼人，未出局嘅狼人一齊睇同一部手機，一齊指一個人，㩒一下「確定」就計晒。出咗局嘅狼人唔使拎。\n'
        + '天光部手機擺返中間，大家一齊睇。發言同遺言：輪到邊個講，部手機就交俾邊個，講完佢自己㩒「我講完」；自爆都係講緊嗰個先㩒得。\n'
        + '投票逐個交部手機，每人一張交接卡。',
    },
    {
      title: '呢個版本未有',
      body: '・警長（上警、警徽、1.5 票、歸票）：官方 10–12 人局有，呢版暫時冇，直接由死者隔離開始發言。\n'
        + '・狼王、白狼王同其他進階角色（騎士、狼美人、丘比特……）。\n'
        + '・女巫同一晚用兩支藥（米勒山谷版）。\n'
        + '・遺言規則「被槍殺者跟開槍者」變體。',
    },
    {
      title: '小貼士',
      body: '・夜晚真係閉眼，手機放低；偷望只會害自己冇癮。\n'
        + '・就算你冇角色，每一步都照㩒下掣、揀下人，咁樣聽唔出邊個係狼。\n'
        + '・女巫、預言家：結果只得你見到，你可以跟大家講真或者講假。\n'
        + '・發言嗰陣唔好打開自己嘅身份牌畀人睇。',
    },
  ],
};

// ---------- presets (names + the reason shown to everybody) ----------

export const PRESET_TEXT = {
  '6-sw': {
    name: '預言家 + 女巫',
    reason: '6 人最易上手：2 狼對 2 平民加預言家同女巫。好人得 4 個，屠邊殺 2 個就完，所以用屠城（要殺晒所有好人）。',
    tag: '6 人用屠城，免得 2 刀就完',
  },
  '6-sh': {
    name: '預言家 + 獵人（官方明牌）',
    reason: '官方 6 人明牌局：冇女巫，出局要亮牌，資訊公開，推理更直接。屠城。',
    tag: '官方明牌 6 人局',
  },
  '7-swh': {
    name: '預女獵',
    reason: '7 人教學局：2 狼，預言家、女巫、獵人加 2 平民。有神職撐住，用屠城比較公平。',
    tag: '7 人教學局',
  },
  '7-hard': {
    name: '預女獵守（硬核）',
    reason: '只有 1 個平民，屠邊好易就被一刀屠邊，神職要靠隱藏同配合。官方呢個配置有白狼王，呢版用普通狼代替。',
    tag: '硬核：只有 1 個平民',
  },
  '8-swh': {
    name: '預女獵（3 狼）',
    reason: '8 人最常見：3 狼對 2 平民加 3 神職，狼人要殺晒好人先贏（屠城）。',
    tag: '8 人最常見：屠城',
  },
  '8-easy': {
    name: '預女獵（2 狼）',
    reason: '2 狼 + 3 平民，好人易啲，適合新手或者想輕鬆玩。',
    tag: '好人易玩',
  },
  '9-swh': {
    name: '預女獵（3/3/3）',
    reason: '9 人標準：狼人、神職、平民各 3，天然平衡，所以用屠邊。屠邊對狼人有利，新手可以改屠城。',
    tag: '3 狼 3 神 3 民，屠邊',
  },
  '9-guard': {
    name: '預獵守',
    reason: '守衛局：用守衛代替女巫，冇毒冇解，夜晚資訊少啲，更考判斷。',
    tag: '守衛局',
  },
  '10-swh': {
    name: '預女獵（官方 10 人）',
    reason: '官方 10 人速推局：3 狼、預女獵、4 平民，屠邊，女巫唔可以自救。官方有警長，呢版暫時未有。',
    tag: '官方 10 人局（未有警長）',
  },
  '10-idiot': {
    name: '預女獵白',
    reason: '用白痴換走 1 個平民：4 神職對 3 平民，屠邊嘅平民邊只有 3 刀，所以女巫第一晚可以自救補返。',
    tag: '4 神職，女巫首夜可自救',
  },
  '11-swhi': {
    name: '預女獵白（4 狼）',
    reason: '11 人常見配置：4 狼、預女獵白、3 平民，屠邊。',
    tag: '11 人常見配置',
  },
  '11-easy': {
    name: '預女獵白（3 狼）',
    reason: '3 狼 + 4 平民，好人易啲。',
    tag: '好人易玩',
  },
  '11-guard': {
    name: '預女獵守',
    reason: '4 狼；守衛代替白痴，守得準可以救到神職。',
    tag: '守衛局',
  },
  '12-std': {
    name: '預女獵白（官方標準）',
    reason: '官方 12 人標準場：4 狼、預女獵白、4 平民，屠邊，女巫唔可以自救。官方有警長，呢版暫時未有。',
    tag: '官方 12 人標準（未有警長）',
  },
  '12-guard': {
    name: '預女獵守',
    reason: '官方「狼王守衛」去咗狼王（呢版未有狼王）：4 普通狼 + 預女獵守 + 4 平民。',
    tag: '守衛局',
  },
  '12-noh': {
    name: '預女守白',
    reason: '冇獵人嘅 12 人局：預言家、女巫、守衛、白痴，冇人可以死後開槍。',
    tag: '冇獵人',
  },
};

/** The non-board one-tap presets (config.presets). */
export const PRESET_EXTRA = {
  beginner: { label: '新手慢慢嚟', reason: '夜晚節奏慢，發言、遺言、投票都唔限時：第一次玩，慢慢睇、慢慢諗。' },
  quick: { label: '快玩', reason: '夜晚節奏快，發言 30 秒、投票 15 秒：一晚可以玩多幾局。' },
  god: { label: '人手上帝', reason: '房主唔攞牌，部手機睇晒全場，自己讀旁白（旁白揀「讀稿」）；玩家少一個。' },
};

// ---------- config wording ----------

export const CFG = {
  moderator: {
    label: '主持方式',
    help: '手機做主持：人人有牌，手機叫夜晚。人手主持：房主唔攞牌，睇到全場，自己用口講旁白（旁白揀「讀稿」）。',
    options: { app: '手機做主持（人人玩）', human: '房主人手做上帝（唔攞牌）' },
  },
  board: { label: '角色配置', custom: '自訂配置', recPrefix: '推薦：' },
  roles: { label: '自訂角色', help: '狼人最少 1 個；神職各最多 1 個；剩低嘅人數自動做平民。' },
  winRule: {
    label: '勝負規則',
    help: '屠邊＝殺晒神職或者殺晒平民；屠城＝要殺晒所有好人。',
    options: { auto: '跟配置', edge: '屠邊（殺晒神職或平民）', city: '屠城（殺晒所有好人）' },
    resolved: { edge: '屠邊', city: '屠城' },
  },
  witchSelfSave: {
    label: '女巫自救',
    help: '官方：女巫唔可以自救。',
    options: { auto: '跟配置', never: '唔可以自救', first: '第一晚可以自救', always: '一直可以自救' },
    resolved: { never: '唔可以自救', first: '第一晚可以自救', always: '可以自救' },
  },
  guardStack: {
    label: '同守同救',
    help: '守衛守咗、女巫又救同一個人。',
    options: { die: '會死（官方，俗稱奶穿）', live: '都生存' },
  },
  idiotIs: {
    label: '白痴計邊個陣營',
    help: '影響屠邊：算神職就要殺晒神職（連白痴）。',
    options: { god: '算神職（官方）', villager: '算平民' },
  },
  wolfVote: {
    label: '狼人意見唔一致',
    help: '狼人各自揀咗唔同嘅人。',
    options: { plurality: '票數最多嘅人被殺（同票隨機）', unanimous: '一定要揀同一個，否則空刀' },
  },
  nightOrder: {
    label: '夜晚次序',
    help: '官方：守衛 → 狼人 → 女巫 → 預言家 → 獵人。另一種：狼人 → 預言家 → 守衛 → 女巫 → 獵人。只影響叫醒次序，唔影響結果。',
    options: { official: '守衛先（官方）', tw: '狼人先' },
  },
  pace: {
    label: '夜晚節奏',
    help: '每一步嘅時間（固定，唔會提早完）。新手同一部機玩揀「慢」。',
    options: { slow: '慢（新手／一部機）', normal: '標準', fast: '快' },
    names: { slow: '慢', normal: '標準', fast: '快' },
  },
  lastWords: {
    label: '遺言',
    help: '白天出局嘅人一定有遺言。',
    options: { night1: '第一晚死嘅有，之後夜晚死嘅冇（官方）', night1single: '第一晚，或者當晚只死一個嘅有', all: '所有死者都有' },
  },
  hunterOrder: {
    label: '獵人次序',
    options: { words: '先遺言，再開槍', shot: '先開槍，再遺言' },
  },
  speakOrder: {
    label: '發言次序',
    help: '每日轉方向。',
    options: { dead: '由死者隔離開始（平安夜隨機）', random: '隨機開始' },
  },
  selfExplode: {
    label: '狼人自爆',
    help: '自爆＝白天即刻出局，今日完結入夜。',
    options: { off: '唔准自爆', on: '日頭發言可以自爆', pk: '連 PK 發言都可以自爆' },
  },
  openCard: {
    label: '出局亮牌（明牌局）',
    options: { auto: '跟配置', on: '亮牌', off: '唔亮牌' },
  },
  spectate: { label: '出局後睇到全場身份', help: '預設唔開：出局嘅人部機都有可能畀人睇到。' },
  speakSecs: { label: '發言限時（秒）', help: '0＝唔限時，講完自己㩒「我講完」。' },
  wordsSecs: { label: '遺言限時（秒）', help: '0＝唔限時。' },
  voteSecs: { label: '投票限時（秒）', help: '0＝等晒所有人。時間到未投嘅人當棄權。' },
};

export function cfgLabel(key) { return CFG[key]?.label ?? key; }

export const MSG = {
  badCount: (min, max) => `狼人殺要 ${min}–${max} 個人（座位）。`,
  appMax: '手機做主持最多 12 個玩家。13 個人要揀「人手主持」（1 個主持 + 12 個玩家）。',
  humanMin: (min) => `人手主持要 ${min + 1} 個人或以上（1 個主持 + ${min} 個玩家）。`,
  humanOnePhone: '人手主持要自己拎一部手機（佢睇到全場身份）：一部手機玩請揀「手機做主持」，或者主持用另一部手機入房。',
  badValue: (label) => `「${label}」設定唔啱。`,
  noWolf: '最少要 1 個狼人。',
  tooMany: (fixed, p) => `指定咗 ${fixed} 個角色，多過 ${p} 個玩家，減少啲。`,
  noGod: '屠邊要最少 1 個神職同 1 個平民，否則一開局就分勝負。改用屠城或者加減角色。',
  noGood: '好人最少要 2 個。',
  boardFallback: (name) => `之前揀嘅配置唔啱而家人數，已經轉用推薦配置「${name}」。`,
  hard: '硬核局：只有 1 個平民，好易被屠邊。',
  wolvesMany: '狼人去到一半，好人好難贏。',
  humanHint: '人手主持：房主唔攞牌；主持用口講旁白，旁白揀「讀稿」，㩒「下一步」推進。',
  shortTimer: '發言限時咁短，講唔晒嘢。',
  sheriff: '官方 10 人或以上有警長，呢版暫時未有。',
  ok: (p, mod) => (mod ? `${p} 個玩家 + 房主主持` : `${p} 個玩家`),
};

// ---------- lobby summary (tags) ----------

export function summaryLines(e) {
  const lines = [];
  const per = [];
  for (const id of ROLE_IDS) {
    const c = e.roles[id] ?? 0;
    if (c > 0) per.push(`${ROLES[id].emoji} ${ROLES[id].name}${c > 1 ? ` ×${c}` : ''}`);
  }
  lines.push(...per);
  lines.push(e.mod ? `🎙️ 房主人手做上帝（${e.p} 個玩家）` : '🎙️ 手機做主持');
  lines.push(`⚖️ ${CFG.winRule.resolved[e.win]}`);
  if (e.roles.witch) lines.push(`🧪 女巫${CFG.witchSelfSave.resolved[e.save]}`);
  if (e.roles.guard && e.roles.witch && e.guardStack === 'live') lines.push('🛡️ 同守同救都生存');
  if (e.roles.idiot && e.idiotIs === 'villager') lines.push('🤡 白痴算平民');
  lines.push(`⏱ 夜晚節奏：${CFG.pace.names[e.pace]}`);
  lines.push(e.speakSecs > 0 ? `🗣 發言 ${e.speakSecs} 秒` : '🗣 發言唔限時');
  if (e.selfExplode === 'off') lines.push('💥 唔准自爆');
  else if (e.selfExplode === 'pk') lines.push('💥 PK 都可以自爆');
  if (e.open) lines.push('🂠 出局亮牌');
  if (e.spectate && !e.passPhone) lines.push('👻 出局後睇到全場');
  if (e.passPhone) lines.push('📱 一部手機：發言交俾講緊嗰個，狼人一齊睇');
  if (e.reasonTag) lines.push(`💡 ${e.reasonTag}`);
  return lines;
}

// ---------- the night: step names and prompts ----------

export const STEP_ICON = { begin: '🌙', guard: '🛡️', wolves: '🐺', witch: '🧪', seer: '🔮', hunter: '🏹' };

export function stepTitle(step) {
  switch (step) {
    case 'begin': return '天黑請閉眼';
    case 'guard': return '守衛請開眼';
    case 'wolves': return '狼人請開眼';
    case 'witch': return '女巫請開眼';
    case 'seer': return '預言家請開眼';
    case 'hunter': return '獵人請開眼';
    default: return '';
  }
}

export function stepClosed(step) {
  switch (step) {
    case 'guard': return '守衛請閉眼';
    case 'wolves': return '狼人請閉眼';
    case 'witch': return '女巫請閉眼';
    case 'seer': return '預言家請閉眼';
    case 'hunter': return '獵人請閉眼';
    default: return '天黑請閉眼';
  }
}

/**
 * The public names of the named steps, for a shared phone's hand-over card (focus.label, ≤ 24 characters, DESIGN §7.1):
 * 「交俾 阿明 · 其他人唔好望 · 第 1 日投票 · 搞掂 2/6」 / 「輪到 阿明 · 發言」.
 */
export const FOCUS = {
  deal: '睇身份',
  vote: (d) => `第 ${d} 日投票`,
  votePk: (d) => `第 ${d} 日 PK 投票`,
  speech: '發言',
  pk: 'PK 發言',
  words: '遺言',
  final: '最後行動',
};

/** What a shared phone shows (never a name) while a role is awake. */
export function anonymousPrompt(step) {
  switch (step) {
    case 'guard': return '守衛請拎起部手機';
    case 'wolves': return '狼人請拎起部手機';
    case 'witch': return '女巫請拎起部手機';
    case 'seer': return '預言家請拎起部手機';
    case 'hunter': return '獵人請拎起部手機';
    default: return '';
  }
}

// ---------- narration cues (PUBLIC information only) ----------
// Written to be READ ALOUD by a zh-HK voice (and by a human in 讀稿 mode): players are called by NAME (the seat
// number is on every chip), counts are words (「兩票」 — a voice reads "2 票" as 「二票」), lists end in 「同」.
// Seconds stay as digits: 「45 秒」 is read 「四十五秒」, which is right.

export function cueDeal({ mod }) {
  return mod
    ? '派咗牌喇。每個玩家㩒住張牌睇自己身份，睇完就㩒「睇完喇」。今局房主做上帝，唔攞牌。'
    : '派咗牌喇。每人㩒住張牌睇自己身份，睇完就㩒「睇完喇」。全部人睇完，就會天黑。';
}

/** `pass` = one phone in the middle of the table (cfg.passPhone): nobody has a phone of their own to put down. */
export function cueBegin(n, { pass = false } = {}) {
  // one phone (re-run #4): from night 2 the 遺言 speaker may still hold the phone — every night says where it goes
  if (n !== 1) return pass ? `第${numZh(n)}晚，天黑請閉眼。部手機擺返枱中間，大家閉埋眼，叫到你嘅角色先拎起佢。` : `第${numZh(n)}晚，天黑請閉眼。`;
  return pass
    ? '天黑請閉眼。部手機擺喺枱中間，大家閉埋眼，叫到你嘅角色先拎起佢。'
    : '天黑請閉眼。大家將部手機放喺面前，閉埋眼，唔好偷望。';
}

export function cueOpen(step, n) {
  switch (step) {
    case 'guard': return '守衛請開眼。今晚你想守邊個？';
    case 'wolves': return n === 1
      ? '狼人請開眼。互相認一認隊友，再揀今晚殺邊個。'
      : '狼人請開眼。揀今晚殺邊個。';
    case 'witch': return '女巫請開眼。睇吓手機，決定今晚用唔用藥。';
    case 'seer': return '預言家請開眼。今晚你想驗邊個？';
    case 'hunter': return '獵人請開眼。睇吓今晚你開唔開到槍。';
    default: return '';
  }
}

export function cueTail(step) {
  return `${stepClosed(step)}。`;
}

/** list = [{ who, role? }] in seat order (role only when 出局亮牌 is on). */
export function cueDawn(list) {
  if (!list.length) return '天光喇，請大家開眼。昨晚係平安夜，冇人死。';
  const roles = list.filter((d) => d.role).map((d) => `${d.who}係${d.role}`);
  return `天光喇，請大家開眼。昨晚死咗嘅係${andZh(list.map((d) => d.who))}。${roles.length ? `${roles.join('，')}。` : ''}`;
}

export function cueWords(who, secs) {
  return `${who}，請講遺言。${secs > 0 ? `你有 ${secs} 秒。` : ''}`;
}

export function cueFinal(who, secs) {
  return `${who}出局。最後行動時間，${secs > 0 ? `有技能嘅人請喺 ${secs} 秒內使用。` : '有技能嘅人而家使用。'}`;
}

export function cueShot(hunter, target, role) {
  return `${hunter}係獵人，開槍帶走咗${target}！${role ? `${target}係${role}。` : ''}`;
}

export function cueFlip(who) {
  return `${who}翻牌，係白痴！唔使出局，不過以後冇投票權。`;
}

export function cueExplode(who, role) {
  return `${who}自爆！佢係${role ?? '狼人'}。今日即刻完結，直接入夜。`;
}

/**
 * The first speaker gets the order and the clock read out; after that a speaker is just called. The order is said by
 * NAMING the next speakers: 「按座位號由大到細，由阿聰開始」 sounds wrong when 阿聰 is seat 1 and the order wraps
 * round to 6, 5, 4 … (playtest p3), while 「跟住係阿珍、阿強」 is right whatever the start.
 */
export function cueSpeech({ who, idx, total, pk, secs, dirUp, tied, next = [] }) {
  const timer = secs > 0 ? `每人 ${secs} 秒。` : '';
  if (pk) {
    return idx === 0
      ? `${andZh(tied)}平票，要 PK 發言。${who}先講。${timer}`
      : `到${who} PK 發言。`;
  }
  if (idx === 0) {
    const more = total > next.length + 1 ? `，之後按座位號${dirUp ? '順數' : '倒數'}落去` : '';
    return `而家開始發言，由${who}開始${next.length ? `，跟住係${next.join('、')}${more}` : ''}。${timer}`;
  }
  if (idx === total - 1) return `最後一位，${who}請發言。`;
  return `${who}請發言。`;
}

export function cueVote({ round, tied }) {
  return round === 1
    ? '發言完畢，請大家投票。揀你覺得係狼人嘅人，唔想投可以棄權。'
    : `再投一次，淨係可以揀${orZh(tied)}。PK 嘅人今次唔投。`;
}

/** entries = [{ who, n }] highest first; outcome = 'exile' | 'flip' | 'tie' | 'none' | 'tie2' | 'nobody' */
export function cueTally({ entries, outcome, who, tied }) {
  const head = entries.length
    ? `投票結果：${entries.map((e) => `${e.who}${countZh(e.n)}票`).join('，')}。`
    : '冇人得票。';
  switch (outcome) {
    case 'exile': return `${head}${who}得票最多，被放逐。`;
    case 'flip': return `${head}${who}得票最多。`;
    case 'tie': return `${head}${tied.join('、')}同票，要 PK。`;
    case 'tie2': return `${head}第二次都係平票，今日係平安日，冇人出局。`;
    case 'nobody': return `${head}除咗同票嘅人，冇人可以再投，今日係平安日。`;
    default: return `${head}今日係平安日，冇人出局。`;
  }
}

export function cueOver(summary) { return `遊戲完。${summary}`; }

/** How long a cue needs on screen when nobody speaks it (silent mode). */
export function cueMinMs(text) {
  return Math.max(1800, Math.min(7000, String(text).length * 160));
}

/**
 * One phone (re-run #4): the 天黑 line stays up at least as long as night 1's, every night, so the phone is back in the
 * middle before 「狼人請開眼」 (night 2 used to give 3 s against night 1's 8 s).
 */
export const BEGIN_PASS_MIN_MS = cueMinMs(cueBegin(1, { pass: true }));

/**
 * The dawn result is THE public fact of the night and, in 靜音, the only place it is said: people pick their phones up
 * at different moments, so it stays on screen at least this long (playtest: ≈3 s was missed by half the table).
 */
export const DAWN_MIN_MS = 8000;

/**
 * The 票型 (who voted whom) is read ballot by ballot and argued over: it stays up 4 s plus 0.8 s per voter, at most 15 s
 * (decision D7). The text's own reading time still counts when it is longer.
 */
export const TALLY_MIN_MS = Object.freeze({ base: 4000, perVoter: 800, max: 15000 });
export const tallyMinMs = (voters) => Math.min(TALLY_MIN_MS.max, TALLY_MIN_MS.base + TALLY_MIN_MS.perVoter * Math.max(0, Math.floor(Number(voters) || 0)));

// ---------- private night panels (what ONE phone shows; decoys use the same slots) ----------

export const PANEL = {
  skipDefault: '跳過',
  ok: '確定',
  okDone: '已確定 ✓',
  /** A shared phone, once this seat has confirmed (real or decoy alike): the same button puts the phone back in the middle. */
  okHome: '📱 睇完，放返中間',
  decoy: [
    '呢一步同你冇關係，繼續閉眼。',
    '想㩒就㩒：揀個人、㩒確定，扮有嘢做都得。',
  ],
  decoyHint: '大家都要㩒，咁就冇人聽得出邊個真係醒咗。',
  /** Every seat, during a step's opening line: the chips are grey until the narrator has finished. */
  cueWait: '準備緊…旁白讀完先㩒得。',
  dead: ['你已經出局，今晚冇得揀。', '照㩒都得，唔會有任何效果。'],
  guard: {
    hint: '被你守住嘅人，今晚唔會被狼人殺死（但擋唔到毒藥）。',
    skip: '空守（今晚唔守人）',
    first: '你可以守任何人，包括自己。',
    last: (who) => `上一晚你守咗 ${who}，今晚唔可以再守佢。`,
    lastNone: '上一晚你空守，今晚冇限制。',
    barred: '🚫 上晚',
  },
  wolves: {
    skip: '空刀（唔殺人）',
    mates: (names) => `🐺 隊友：${names}`,
    matesAlone: '🐺 你係獨狼，冇隊友。',
    deadMates: (names) => `（已出局：${names}）`,
    pick: '揀今晚要殺邊個。你揀嘅同隊友揀嘅會即時顯示。',
    // U2: every living wolf on ONE shared phone looks at one combined screen (these replace the two info lines)
    together: (names) => `🐺 你哋一齊揀：${names}`,
    togetherPick: '一齊指一個人，㩒一下「確定」就計晒你哋。',
    // re-run #3b: on ONE screen the wolves cannot disagree, so the split-vote rule is replaced by what does apply
    ruleTogether: '時間到未㩒確定，都照計你哋指住嗰個；冇指人就空刀。',
    // re-run #3a: on one screen 空刀 locks every wolf at once, so it takes a second tap
    skipConfirm: '今晚空刀？',
    rulePlurality: '意見唔一致：票數最多嘅人被殺，同票隨機。',
    ruleUnanimous: '一定要全部狼人揀同一個人先殺到人，否則空刀。',
    first: '第一晚：認清楚你嘅隊友。',
  },
  witch: {
    skip: '唔用藥',
    victim: (who, self) => `今晚被狼人襲擊嘅係：${who}${self ? '（你自己）' : ''}`,
    victimNone: '今晚冇人被狼人襲擊。',
    victimHidden: '解藥已經用咗，唔會再知道邊個被襲擊。',
    // re-run #6: name the rule this table plays
    noSelfSave: (save) => (save === 'first' ? '今局淨係第一晚可以自救。' : '今局女巫唔可以自救。'),
    potions: (save, poison) => `解藥：${save ? '有' : '冇'}　毒藥：${poison ? '有' : '冇'}`,
    // the hint follows what she can still do tonight
    hint: '㩒被襲擊嗰位＝用解藥救佢；㩒其他人＝用毒藥。同一晚淨係用得一支。',
    hintPoison: '㩒一個人＝用毒藥毒佢。唔想用就㩒「唔用藥」。',
    hintSave: '㩒被襲擊嗰位＝用解藥救佢。毒藥已經用咗。',
    hintNone: '今晚冇藥用得，㩒「唔用藥」就得。',
    // her 確定 button and a line on her own panel name the potion a tap would spend
    okSave: (who) => `💊 用解藥救 ${who}`,
    okPoison: (who) => `☠️ 用毒藥毒 ${who}`,
    pickedSave: (who) => `💊 揀咗救 ${who}：時間到都會用，再㩒佢一次取消。`,
    pickedPoison: (who) => `☠️ 揀咗毒 ${who}：時間到都會用，再㩒佢一次取消。`,
    lockedSave: (who) => `💊 已確定：用解藥救 ${who}`,
    lockedPoison: (who) => `☠️ 已確定：用毒藥毒 ${who}`,
    lockedNone: '已確定：今晚唔用藥',
    // the closing line: what she actually did
    didSave: (who) => `💊 今晚你用咗解藥救 ${who}。`,
    didPoison: (who) => `☠️ 今晚你用咗毒藥毒 ${who}。`,
    didNone: '今晚你冇用藥。',
    save: '💊 救',
    poison: '☠️ 毒',
    empty: '兩支藥都用晒喇，今晚冇嘢做。',
  },
  seer: {
    skip: '今晚唔驗',
    pick: '揀一個人驗，睇佢係好人定狼人。確定之後唔可以改。',
    result: (who, camp) => `${who} 係：${campName(camp)}`,
    skipped: '今晚你冇驗人。',
    seen: (camp) => (camp === 'wolf' ? '🐺' : '✅'),
  },
  hunter: {
    skip: '知道喇',
    ok: ['你今晚冇被毒 👍', '如果你出局，可以開槍帶走一個人。'],
    poisoned: ['你今晚被毒咗 👎', '就算出局都開唔到槍。'],
    dead: ['你已經出局。', ''],
  },
  begin: ['🌙 天黑，閉眼', '部手機放低，唔好偷望。'],
  tail: ['😴 閉返眼', '等下一步。'],
  // The dead player's own panel by DAY, while the table watches: the SAME words for a hunter, a poisoned hunter and
  // anybody else (「你係獵人」 on a face-up phone would out a hunter who holds fire). He knows his own card.
  final: {
    skip: '唔開槍',
    info: ['🏹 最後行動時間', '獵人可以揀一個人開槍帶走（被毒死就開唔到）。其他人等時間過，照㩒都冇效果。'],
  },
};

// ---------- phase hints (U1: shown only when a player taps 💡) ----------
// One line for a first-timer: 「而家要做咩」. Built from the seat's OWN view only, so a hint can
// never say more than that seat's screen already does.

export const HINT = {
  deal: {
    look: '㩒住張牌睇你嘅身份，放手即冚返；睇完㩒「睇完喇」。',
    wait: '等其他人睇完牌，夜晚就會開始。',
    mod: '你係上帝：睇住大家準備好，或者㩒「下一步」直接開始。',
    table: '大家睇緊自己嘅身份牌。',
  },
  night: {
    begin: '天黑喇：閉埋眼，部手機放低，等旁白叫到你嘅角色。',
    sleep: '呢一步冇你份：閉住眼，想㩒就㩒（揀個人再㩒確定），扮有嘢做。',
    dead: '你已經出局：繼續閉眼唔出聲，想㩒就㩒，冇任何效果。',
    guard: '守衛：揀一個人守（可以守自己），再㩒「確定」；唔想守就㩒「空守」。',
    wolves: '狼人：同隊友揀同一個人殺，睇住隊友揀咗邊個；揀好㩒「確定」，仲可以改。',
    witch: '女巫：㩒被襲擊嗰位＝用解藥救佢，㩒其他人＝用毒藥；唔想用就㩒「唔用藥」。',
    seer: '預言家：揀一個人再㩒「確定」，先睇到佢係好人定狼人；唔可以驗自己同驗過嘅人。',
    hunter: '獵人：睇吓你今晚有冇被毒；被毒嘅話，出局都開唔到槍。',
    tail: '閉返眼，等下一步。',
    mod: '你係上帝：用口讀旁白、睇住面板，夠鐘就㩒「下一步」。',
    table: '夜晚：大家閉埋眼，等手機逐個角色叫。',
  },
  // By day the 💡 sheet's 「而家要做咩」 is plain text (only its role box is covered) and a phone lies face-up, so no
  // day line depends on the seat's card: each is worded to serve BOTH sides (a wolf is not told to hunt wolves, and
  // nobody's line says 「扮好人」 or 「你係獵人」 for a neighbour to read).
  day: {
    dawn: '睇下昨晚邊個出局（唔會講點死），然後準備發言。',
    words: { me: '輪到你講遺言：講完㩒「我講完」。', other: '安靜聽佢講遺言，記低有用嘅資料。' },
    final: {
      // the dead player's own window: one line for a hunter, a poisoned hunter and anybody else (like the panel)
      me: '最後行動：獵人揀一個人開槍（被毒死除外），其他人等時間過。',
      table: '最後行動時間：有技能嘅人而家用，其他人等住。',
    },
    shot: '獵人開槍帶走咗一個人，繼續。',
    tally: '投票結果公開：睇清楚邊個投邊個，記住用嚟推理。',
    flip: '白痴翻牌：佢唔出局，但以後冇票。',
    explode: '狼人自爆：今日完結，直接入夜。',
    speech: {
      me: '輪到你發言：講你嘅分析，想報身份都得；講完㩒「我講完」。',
      other: '聽人發言：記低邊個講咩，諗吓邊個似狼、邊個似神職。',
    },
    vote: '揀一個你想放逐嘅人，再㩒確定；唔想投就棄權。',
    voted: '投咗喇，等其他人；投晒之前仲可以改。',
    cannotFlip: '你翻咗牌，冇投票權，睇住大家投。',
    cannotPk: '你係 PK 嘅人，今次唔投，等結果。',
    absent: '房主當咗你暫時離開：今次唔使投，返嚟就同房主講聲。',
    watchVote: '大家投緊票，等結果。',
    pk: '平票：PK 嘅人逐個發言，之後其他人再投一次。',
    dead: '你已經出局：可以睇，但唔好出聲。',
    mod: '你係上帝：讀旁白、睇住流程，需要就㩒「下一步」。',
  },
  over: '睇下全場身份同逐晚回顧，再嚟一局。',
};

// ---------- on-screen wording (public + generic) ----------

export const UI = {
  deal: {
    lead: '㩒住張牌睇你嘅身份，放手即刻冚返。睇完㩒「睇完喇」。',
    ready: '睇完喇',
    readyDone: '✓ 睇完 — 等其他人',
    count: (d, t) => `${d} / ${t} 人睇完`,
    board: '今局配置',
    cardBack: '㩒住睇身份',
    hint: '配置同入面有咩角色係公開嘅。',
    modNote: '你係上帝：唔攞牌，睇到全場身份。',
    spectator: '你喺度旁觀，下一局先加入到。',
    table: '部手機逐個交，大家輪流睇自己嘅身份牌。',
  },
  night: {
    title: (n) => `🌙 第 ${n} 夜`,
    eyes: '閉眼',
    hintAll: '部手機放低，閉埋眼。',
    infoHead: '只有你自己睇到',
    modLive: '而家：',
  },
  day: {
    title: (d) => `☀️ 第 ${d} 日`,
    dawnPeace: '🌅 平安夜，冇人死',
    dawnDead: '🌅 昨晚出局',
    dead: '💀 出局',
    wordsHead: '🗣 遺言',
    wordsWho: (who) => `${who} 講遺言`,
    speakDone: '我講完',
    // a shared phone: the speaker's screen is the table's screen (#20: names, never 「輪到你」)
    speakShared: (who) => `🎙 ${who} 發言緊 — 講完㩒「我講完」`,
    wordsShared: (who) => `🗣 ${who} 講緊遺言 — 講完㩒「我講完」`,
    speakWait: '等緊發言…',
    speakNow: '🎙 講緊',
    // a whole-table phone holds the speech clock until the speaker takes the phone (U10, re-run #1)
    speakHeld: '⏳ 等緊開始',
    speakNext: '⏳ 等緊',
    speakSpoke: '✅ 已講',
    speechHead: (idx, total, pk) => (pk ? `PK 發言 ${idx + 1}/${total}` : `發言 ${idx + 1}/${total}`),
    explode: '💥 自爆',
    explodeHold: '㩒住 1 秒自爆',
    explodeNote: '白天發言嗰陣，狼人可以自爆（即刻出局，今日完結）。人人都有呢粒掣，唔係狼人㩒咗冇反應。',
    explodeNoteShared: '一部手機：發言緊嗰個先自爆得（即刻出局，今日完結）。每個發言嘅人都有呢粒掣，唔係狼人㩒咗冇反應。',
    explodeNoReaction: '（冇反應）',
    voteHead: '🗳 投票',
    voteHeadPk: '🗳 PK 投票',
    voteNo: '你冇票（白痴翻咗牌），睇住大家投。',
    voteNoPk: '你係 PK 嘅人，今次唔可以投。',
    voteDead: '你已經出局，唔可以投。',
    // the host marked this seat 💤 (D4): it casts no ballot until the host marks it back
    voteAbsent: '💤 房主當咗你暫時離開，今次唔使投票。返嚟咗就同房主講聲。',
    votePick: '揀一個你覺得係狼人嘅人，或者棄權。',
    shotHead: '最後行動',
    shotWho: (who) => `${who} 出局，最後行動時間`,
    shotNote: '有最後技能嘅人而家用。其他人等時間過。',
    shotAnnounce: '🏹 獵人開槍',
    flipHead: '🤡 翻牌！',
    explodeHead: '💥 自爆！',
    tallyHead: '📊 投票結果',
    tallyNone: '冇人得票',
    tallyExile: (who) => `${who} 被放逐`,
    tallyNoExile: (who) => `${who} 得票最多`,
    tallyTie: (names) => `${names} 同票 → PK`,
    tallyPeace: '今日平安日，冇人出局',
    tallyTie2: '第二次都平票：今日平安日',
    tallyNobody: '除咗同票嘅人冇人可以投：今日平安日',
    // public facts kept on the day screens (the dawn card and the tally are up for seconds only)
    lastNightPeace: '🌅 昨晚：平安夜',
    lastNightDead: (names) => `🌅 昨晚出局：${names}`,
    voteLogHead: '🗳 之前嘅投票（票型）',
    voteLogRound: (d, round) => `第 ${d} 日・${round === 1 ? '投票' : 'PK 投票'}`,
    abstain: '棄權',
    abstainProxy: '（代做）',
    continue: '下一步',
    waitHost: '等主持繼續…',
  },
  me: {
    head: '我嘅身份',
    mates: (names) => `🐺 隊友：${names}`,
    notesHead: '我嘅記錄',
    notesBack: '㩒住睇我嘅記錄',
    notesLocked: '記錄鎖咗，要先解鎖身份牌',
    notesNone: '冇夜晚記錄。',
    seer: (n, who, camp) => `第 ${n} 夜驗 ${who}：${campName(camp)}`,
    witchSave: (n, who) => `第 ${n} 夜用解藥救咗 ${who}`,
    witchPoison: (n, who) => `第 ${n} 夜用毒藥毒咗 ${who}`,
    guard: (n, who) => (who ? `第 ${n} 夜守咗 ${who}` : `第 ${n} 夜空守`),
    potions: (save, poison) => `🧪 解藥${save ? '有' : '冇'}・毒藥${poison ? '有' : '冇'}`,
    deadBanner: '👻 你已經出局：可以睇，唔可以講嘢、投票或者提示。',
    idiotBanner: '🤡 你翻咗牌：仲可以發言，但冇投票權。',
    spectatorBanner: '👀 你係旁觀者，下一局先加入到。',
    spectateAll: '出局後睇到嘅全場身份',
  },
  roster: {
    head: '座位',
    alive: (a, t) => `生存 ${a}/${t}`,
    dead: '💀',
    flipped: '🤡',
    absent: '💤',
    me: '（你）',
  },
  god: {
    head: '🎙 上帝面板',
    skip: '⏭ 下一步',
    skipHint: '跳過而家等緊嘅步驟',
    roles: '所有身份',
    live: '夜晚實況',
    picks: '各人揀咗',
    attacked: (who) => `狼人襲擊：${who ?? '空刀'}`,
    guarded: (who) => `守衛守：${who ?? '冇人'}`,
    saved: (who) => `女巫救：${who}`,
    poisoned: (who) => `女巫毒：${who}`,
    none: '（未有）',
    potions: (save, poison) => `女巫藥：解藥${save ? '有' : '冇'}・毒藥${poison ? '有' : '冇'}`,
    guardLast: (who) => `守衛上晚守：${who ?? '冇'}`,
    lock: '🔒',
    noPick: '未揀',
    skipPick: '唔揀',
  },
  over: {
    head: '遊戲完',
    wolves: '🐺 狼人隊贏',
    good: '🧑‍🌾 好人隊贏',
    draw: '🤝 打和',
    roles: '全場身份',
    died: (how) => how,
    alive: '生存到最後',
  },
  common: {
    seat: (no) => `${no} 號`,
    you: '（你）',
    wait: '等緊…',
  },
};

// ---------- how a player left the game (recap + roster) ----------

export const HOW = {
  wolf: '被狼人殺死',
  poison: '被毒死',
  exile: '被放逐',
  shot: '被獵人槍殺',
  explode: '自爆',
};

// ---------- result / recap ----------

/** A section heading in result.lines: the results screen starts a foldable section at 「── 標題 ──」. */
export const section = (title) => `── ${title} ──`;

export const RECAP = {
  intro: '📜 下面逐晚回顧，包括你哋睇唔到嘅操作（㩒標題打開）。',
  roles: '🎭 身份揭曉',
};

export function summaryLine(win, why) {
  if (win === 'draw') return '打和：連續幾日夜都冇人出局';
  if (win === 'good') return '好人隊贏：狼人全部出局';
  switch (why) {
    case 'gods': return '狼人隊贏：神職全部出局（屠邊）';
    case 'villagers': return '狼人隊贏：平民全部出局（屠邊）';
    case 'all': return '狼人隊贏：好人全部出局（屠城）';
    default: return '狼人隊贏';
  }
}

/**
 * @param both  the wolves won with the same deaths that took out their last wolf (狼刀優先): the roles list shows
 *              every wolf dead, so without this line the win reads like a bug (playtest p5).
 */
export function explainLines(win, why, rule, { both = false } = {}) {
  const out = [];
  if (win === 'draw') {
    out.push('連續幾個日夜都冇人出局，今場打和。');
    return out;
  }
  if (win === 'good') {
    out.push('所有狼人都出局咗，好人贏。');
    return out;
  }
  out.push(rule === 'edge'
    ? '屠邊：神職全部出局，或者平民全部出局，狼人就贏。'
    : '屠城：所有好人（神職同平民）都出局，狼人先贏。');
  if (why === 'gods') out.push('今次係神職先俾殺晒。');
  else if (why === 'villagers') out.push('今次係平民先俾殺晒。');
  if (both) out.push('最後一隻狼同一晚都出咗局，不過狼人嘅條件同時達成：兩邊一齊達成，算狼人贏（狼刀優先）。');
  return out;
}

/**
 * One block of recap lines per night / day.
 * rec  = a record built by the engine (see game.js), nm = pid → "3 號阿明", rl = pid → role name.
 */
export function recapNight(rec, nm, rl) {
  const L = [section(`🌙 第 ${rec.n} 夜`)];
  const G = rec.guard;
  if (G) L.push(G.pick ? `　🛡️ 守衛（${nm(G.by)}）守咗 ${nm(G.pick)}` : `　🛡️ 守衛（${nm(G.by)}）空守`);
  const W = rec.wolves;
  if (W) {
    const what = (p) => (p.pick == null ? (p.set ? '空刀' : '冇揀') : nm(p.pick));
    // re-run #3c: wolves on ONE shared screen made one pick together — named as a group, never each as its author
    const grp = Array.isArray(W.shared) ? W.picks.filter((p) => W.shared.includes(p.by)) : [];
    const together = grp.length > 1 && grp.every((p) => p.set === grp[0].set && p.pick === grp[0].pick);
    const picks = together
      ? [`${grp.map((p) => nm(p.by)).join('、')}（一齊揀）→${what(grp[0])}`, ...W.picks.filter((p) => !W.shared.includes(p.by)).map((p) => `${nm(p.by)}→${what(p)}`)].join('、')
      : W.picks.map((p) => `${nm(p.by)}→${what(p)}`).join('、');
    const how = together && grp.length === W.picks.length && (W.how === 'agree' || W.how === 'empty') ? ''
      : W.target
        ? { agree: '一致', partial: '其他狼人冇揀', plurality: '票數最多', random: '同票，隨機揀' }[W.how]
        : { none: '冇狼人揀', split: '意見唔一致', random: '同票，隨機揀中空刀' }[W.how];
    L.push(`　🐺 狼人：${picks}　⇒ ${W.target ? `襲擊 ${nm(W.target)}` : '空刀'}${how ? `（${how}）` : ''}`);
  }
  const T = rec.witch;
  if (T) {
    if (T.act === 'save') L.push(`　🧪 女巫（${nm(T.by)}）用解藥救咗 ${nm(T.target)}`);
    else if (T.act === 'poison') L.push(`　🧪 女巫（${nm(T.by)}）用毒藥毒咗 ${nm(T.target)}`);
    else L.push(`　🧪 女巫（${nm(T.by)}）今晚冇用藥`);
  }
  const R = rec.seer;
  if (R) L.push(R.target ? `　🔮 預言家（${nm(R.by)}）驗咗 ${nm(R.target)}：${campName(R.camp)}` : `　🔮 預言家（${nm(R.by)}）今晚冇驗人`);
  const H = rec.hunter;
  if (H) L.push(`　🏹 獵人（${nm(H.by)}）${H.poisoned ? '被毒咗，開唔到槍' : '冇被毒'}`);
  const x = rec.result;
  if (x) {
    const notes = [];
    if (x.flags.includes('both')) notes.push('同守同救，個人死咗（奶穿）');
    if (x.flags.includes('guard')) notes.push(`${nm(x.attacked)} 被守衛守住，冇事`);
    if (x.flags.includes('save')) notes.push(`${nm(x.attacked)} 被女巫救返`);
    if (x.flags.includes('bothLive')) notes.push('又守又救，兩樣都有效（設定：生存）');
    if (x.flags.includes('poisonThrough')) notes.push('毒藥穿過守衛（毒穿）');
    if (x.flags.includes('poisonHunter')) notes.push('獵人被毒，開唔到槍');
    if (!x.deaths.length) notes.push('平安夜');
    L.push(`　➜ 結果：${x.deaths.length ? x.deaths.map((d) => `${nm(d.pid)} ${HOW[d.how] ?? ''}`).join('、') : '冇人死'}${notes.length ? `（${notes.join('；')}）` : ''}`);
  }
  return L;
}

/** A proxied abstain in the 票型 (one phone, the host's 🤖 代佢做 at a vote gate). */
export const PROXY_ABSTAIN = '代做（當棄權）';

/** 票型 grouped by target, most votes first: 「7號阿G 3 票（1號阿A、2號阿B）」, then the abstainers, then proxied abstains. */
export function voteParts(rec, nm) {
  const by = new Map();
  const abstain = [];
  const proxied = [];   // one phone: 🤖 代佢做 at a vote gate — an abstain the seat never chose (re-run #5)
  for (const v of rec.votes) {
    if (!v.to) { (v.proxy ? proxied : abstain).push(v.by); continue; }
    if (!by.has(v.to)) by.set(v.to, []);
    by.get(v.to).push(v.by);
  }
  const parts = [...by.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([t, vs]) => `${nm(t)} ${vs.length} 票（${vs.map(nm).join('、')}）`);
  if (abstain.length && (by.size || proxied.length)) parts.push(`棄權：${abstain.map(nm).join('、')}`);
  else if (abstain.length) parts.push('全部棄權');
  if (proxied.length) parts.push(`${PROXY_ABSTAIN}：${proxied.map(nm).join('、')}`);
  return parts;
}

/** What a vote decided, in one line. */
export function voteOutcome(rec, nm) {
  switch (rec.outcome) {
    case 'exile': return `${nm(rec.pid)} 被放逐`;
    case 'flip': return `${nm(rec.pid)} 係白痴，翻牌，唔出局`;
    case 'tie': return `${rec.tied.map(nm).join('、')} 同票，PK`;
    case 'tie2': return '第二次都平票，平安日';
    case 'nobody': return '平票但冇人可以再投，平安日';
    default: return '冇人得票，平安日';
  }
}

export function recapVote(rec, nm) {
  const label = rec.round === 1 ? '投票' : 'PK 投票';
  return [`　🗳 ${label}：${voteParts(rec, nm).join('；') || '（冇人投）'}`, `　　➜ ${voteOutcome(rec, nm)}`];
}

export const recapDay = (d) => section(`☀️ 第 ${d} 日`);
export const recapShot = (by, target, nm) => `　🏹 ${nm(by)} 開槍帶走咗 ${nm(target)}`;
export const recapExplode = (pid, nm) => `　💥 ${nm(pid)} 自爆`;
export const recapFlip = (pid, nm) => `　🤡 ${nm(pid)} 翻牌（白痴）`;

export const recapDeathNote = (pid, how, at, nm, role) => `${nm(pid)}（${role}）${at}${HOW[how] ?? '出局'}`;
