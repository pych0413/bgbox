// ============================================================
// script.js — every Cantonese string of 阿瓦隆 (Avalon): role texts, rules,
// config labels and preset reasons, narration cues, top-bar titles, the end
// of game recap, and the phone UI's wording.
//
// Pure strings in, strings out. No DOM, no clock, no randomness. Cues are
// spoken by the host phone, so they may only ever use PUBLIC information
// (the role list in play, the team, the votes AFTER the reveal, the quest
// pile as counts). Nothing here may name a role next to a seat before the end.
//
// Wording is original (not copied from any rulebook or official app).
// ============================================================

// ---------- numbers ----------

const NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
/** 一、二、三… for ordinals and scores ("第三個任務", "三比二"). */
export const num = (n) => NUM[n] ?? String(n);
/** 一、兩、三… for counts ("兩個人", "兩張牌"). */
export const cnt = (n) => (n === 2 ? '兩' : num(n));

export const list = (names) => names.join('、');

// ---------- roles ----------

/**
 * `short` is the one-line reminder printed on the secret card; `text` is the
 * full sentence for the rules sheet. `team` is 'good' | 'evil' (teamStyle() in
 * ui/logic.js colours both).
 */
const GOOD_WIN = '點贏：三個任務成功，而且刺客刺唔中梅林。';
const EVIL_WIN = '點贏：三個任務失敗、連續五次否決，或者刺客刺中梅林。';

export const ROLES = {
  merlin: {
    name: '梅林', emoji: '🧙', team: 'good',
    short: '收埋自己，等好人贏',
    text: `做乜：一開始見到邪惡嘅人（莫德雷德除外，唔知角色），暗中帶好人揀啱隊，但唔好俾人睇穿你係梅林。${GOOD_WIN.replace('梅林', '你')}`,
  },
  percival: {
    name: '派西維爾', emoji: '🛡️', team: 'good',
    short: '保護梅林',
    text: `做乜：知道邊個係梅林；有莫甘娜就見到兩個人，分唔出真假。幫梅林擋刺客。${GOOD_WIN}`,
  },
  servant: {
    name: '亞瑟忠臣', emoji: '⚔️', team: 'good',
    short: '靠觀察同推理',
    text: `做乜：冇情報，只可以出「成功」。睇投票同任務結果，揪出邪惡。${GOOD_WIN}`,
  },
  assassin: {
    name: '刺客', emoji: '🗡️', team: 'evil',
    short: '最後一擊：刺梅林',
    text: `做乜：識得邪惡同伴（奧伯倫除外），可以出「失敗」。好人成功三個任務之後，你揀一個人當梅林刺。${EVIL_WIN}`,
  },
  morgana: {
    name: '莫甘娜', emoji: '🔮', team: 'evil',
    short: '扮梅林，誤導派西維爾',
    text: `做乜：識得邪惡同伴（奧伯倫除外）。派西維爾會見到你同梅林一樣，扮梅林呃佢。${EVIL_WIN}`,
  },
  mordred: {
    name: '莫德雷德', emoji: '👿', team: 'evil',
    short: '梅林睇唔到你',
    text: `做乜：識得邪惡同伴（奧伯倫除外），梅林睇唔到你，可以放心扮好人。${EVIL_WIN}`,
  },
  oberon: {
    name: '奧伯倫', emoji: '👤', team: 'evil',
    short: '孤軍作戰',
    text: `做乜：邪惡，但你唔識其他邪惡，佢哋都唔識你；按預設梅林睇到你，女神驗你係邪惡。自己諗點搞破壞。${EVIL_WIN}`,
  },
  minion: {
    name: '爪牙', emoji: '😈', team: 'evil',
    short: '破壞任務，掩護同伴',
    text: `做乜：識得邪惡同伴（奧伯倫除外），混入隊伍出「失敗」，又要扮好人。${EVIL_WIN}`,
  },
};

export const ROLE_ORDER = ['merlin', 'percival', 'servant', 'assassin', 'morgana', 'mordred', 'oberon', 'minion'];

export const TEAM = {
  good: { name: '正義陣營', short: '好人', color: '#4aa3ff', emoji: '🔵' },
  evil: { name: '邪惡陣營', short: '邪惡', color: '#e4573d', emoji: '🔴' },
};

export const roleName = (id) => ROLES[id]?.name ?? '？';
export const roleLabel = (id) => (ROLES[id] ? `${ROLES[id].emoji} ${ROLES[id].name}` : '？');
export const teamOf = (id) => ROLES[id]?.team ?? 'good';

/** "梅林、派西維爾、兩位忠臣" — for narration, in deck order. */
export function deckSpoken(deck) {
  const part = (side) => deck
    .filter((d) => teamOf(d.role) === side)
    .map((d) => (d.count > 1 ? `${cnt(d.count)}位${d.role === 'servant' ? '忠臣' : roleName(d.role)}` : roleName(d.role)))
    .join('、');
  return `好人方面：${part('good')}；邪惡方面：${part('evil')}`;
}

/** "梅林、派西維爾、忠臣 ×2" — for lobby and config lines. */
export function deckText(counts, side) {
  return ROLE_ORDER
    .filter((id) => teamOf(id) === side && counts[id] > 0)
    .map((id) => `${ROLES[id].name}${counts[id] > 1 ? ` ×${counts[id]}` : ''}`)
    .join('、');
}

// ---------- rules sheet ----------

export const RULES_QUICK = [
  '好人（藍）對邪惡（紅），一共五個任務。',
  '隊長揀隊員，全部人投票，過半贊成先出發。',
  '隊員秘密出牌：好人只出成功，邪惡可以出失敗。',
  '三個任務失敗，或者連續五次否決，邪惡贏。',
  '三個任務成功之後，刺客刺中梅林就反敗為勝。',
  '㩒住張卡先睇到身份，放手即刻冚返。',
];

export const RULES_SECTIONS = [
  {
    title: '大局',
    body: '好人要完成五個任務入面嘅三個，邪惡要破壞三個，或者令隊伍連續五次通過唔到。好人完成三個任務之後仲未贏：邪惡有最後一擊，刺客要揾出梅林。',
  },
  {
    title: '一個任務點行',
    body: '1. 隊長（由座位次序輪流）喺電話揀指定人數嘅隊員，可以包括自己。大家可以自由討論。\n'
      + '2. 所有人（隊長同隊員都要）秘密投贊成或者反對，投完同時公開，每個人投咩都睇到。贊成多過反對先通過，平手算否決。\n'
      + '3. 被否決：隊長傳去下一位，重新揀隊。連續五次被否決，邪惡直接贏。\n'
      + '4. 通過：隊員秘密出一張「成功」或者「失敗」牌。好人只可以出成功，邪惡兩樣都可以。\n'
      + '5. 公佈：只會顯示有幾多張成功、幾多張失敗，唔會講邊個出咩。有一張失敗牌，任務就失敗（第四個任務有特別規定，見下面）。',
  },
  {
    title: '兩張失敗嘅任務',
    body: '7 人或以上嘅第四個任務，要兩張失敗牌先算失敗。得一張失敗，任務照樣成功，不過大家會見到有一張失敗，等你推理。其他任務一張失敗就夠。',
  },
  {
    title: '人數同隊員數量',
    body: '5 人：3 好 2 壞，每個任務 2、3、2、3、3 人。\n'
      + '6 人：4 好 2 壞，每個任務 2、3、4、3、4 人。\n'
      + '7 人：4 好 3 壞，每個任務 2、3、3、4、4 人（第四個要兩張失敗）。\n'
      + '8 人：5 好 3 壞，每個任務 3、4、4、5、5 人（第四個要兩張失敗）。\n'
      + '9 人：6 好 3 壞，每個任務 3、4、4、5、5 人（第四個要兩張失敗）。\n'
      + '10 人：6 好 4 壞，每個任務 3、4、4、5、5 人（第四個要兩張失敗）。',
  },
  {
    title: '夜晚情報（喺你部電話睇，唔使閉眼）',
    body: '梅林：見到邪惡嘅人（莫德雷德除外），但唔知角色。\n'
      + '派西維爾：見到梅林；如果有莫甘娜，就見到兩個人，分唔出邊個先係真梅林。\n'
      + '邪惡（奧伯倫除外）：互相識得，但唔知對方角色。\n'
      + '奧伯倫：乜都唔知，邪惡同伴都唔識佢。\n'
      + '忠臣：冇情報。\n'
      + '睇身份嗰段時間每個人都有同樣長，冇人可以靠「睇得快唔快」估到邊個有情報。',
  },
  {
    title: '湖中女神（可選，7 人或以上建議用）',
    body: '喺第二、第三、第四個任務完成之後，而且遊戲未完，女神持有人揀一個人驗身份。持有人會秘密睇到佢係「好人」定「邪惡」（睇唔到角色），之後被驗嘅人拎走女神。已經持有過女神嘅人（包括一開始嗰個）唔可以再被驗。\n'
      + '女神持有人可以將結果講真話，亦可以呃人，但係唔可以畀人睇電話。\n'
      + '起始持有人係第一任隊長右手邊（上一位）嘅人。',
  },
  {
    title: '刺殺梅林',
    body: '好人完成三個任務之後，邪惡陣營可以商量，刺客揀一個人。揀中梅林，邪惡贏；揀錯，好人贏。好人同梅林喺呢段時間保持安靜。\n'
      + '設定入面可以打開「刺殺前邪惡亮牌」：刺客落手前，所有邪惡玩家嘅角色公開。',
  },
  {
    title: '手機點用',
    body: '・隊長按座位次序輪流，開局之前喺大廳將座位排得同你哋真實坐位一樣。\n'
      + '・睇身份：㩒住張卡先睇到，放手即刻冚返。電話放低、換人、返桌面都會自動冚返。\n'
      + '・身份卡全場都喺畫面下面，唔記得可以隨時㩒住睇返。\n'
      + '・出任務牌：所有隊員嘅畫面一模一樣，好人嗰張「失敗」牌喺度但㩒唔到，咁旁人睇你畫面都估唔到你係邊邊。\n'
      + '・一部手機玩：「睇身份時間」同「出牌時間」會自動變 0 秒（唔計時），電話傳嚟傳去，每次只畀被叫到嘅人拎。\n'
      + '・有人部電話死咗：主持可以「代佢做」（投贊成、出成功），或者「呢鋪唔計」——揀隊嗰陣隊長傳俾下一位（唔算否決），投票或者出牌就成輪重新嚟過。',
  },
  {
    title: '唔包括嘅玩法',
    body: '蘭斯洛特、王者之劍（Excalibur）、揀任務（Targeting）、陰謀牌同 Loyalty 牌暫時未做；只做基本遊戲加湖中女神。',
  },
];

// ---------- config ----------

export const PRESET_LABEL = {
  recommended: '推薦配置（跟人數）',
  plain: '基本版（新手）',
  alt: '另一款配置',
  custom: '自訂',
};

/** Why a preset is good for this head-count. Shown to the whole lobby. */
export function presetReason(preset, n) {
  if (preset === 'plain') {
    return '基本版：冇派西維爾同莫甘娜，淨係梅林識邪惡，最易上手。第一次玩、或者有新朋友，建議用呢個。';
  }
  if (preset === 'custom') {
    return '自己揀派西維爾、莫甘娜、莫德雷德、奧伯倫，忠臣同爪牙會自動補夠人數。';
  }
  if (preset === 'alt') {
    return {
      5: '改用莫德雷德代替莫甘娜：梅林睇唔到佢，派西維爾就一眼認到梅林，邪惡更易收埋。',
      6: '改用莫德雷德代替莫甘娜：梅林睇唔到佢，派西維爾就一眼認到梅林，邪惡更易收埋。',
      7: '用普通爪牙代替奧伯倫（台灣常見）：邪惡人人識得自己人，比推薦配置易配合。',
      8: '用莫德雷德代替普通爪牙（英文圈常見）：梅林睇唔到莫德雷德，邪惡更易收埋。',
      9: '用奧伯倫代替莫德雷德：邪惡其中一人孤軍作戰，好人更易搵出內鬼。',
      10: '唔用奧伯倫，改用一個普通爪牙：邪惡四人互相識晒，易啲配合。',
    }[n] ?? '另一款配置。';
  }
  return {
    5: '5 人好人只得 3 個。派西維爾幫好人，莫甘娜扮梅林搗亂，官方建議兩個一齊用，咁邪惡先唔會太弱。',
    6: '6 人好人 4 對邪惡 2，好人佔優。派西維爾配莫甘娜，令佢分唔清邊個先係真梅林，雙方就差唔多。',
    7: '7 人係好人最辛苦嘅人數（4 對 3）。派西維爾幫好人，莫甘娜牽制佢；奧伯倫唔識自己人，邪惡要靠估，場面更平衡。',
    8: '8 人（5 對 3）用華人圈最常見嘅標準配置：派西維爾、莫甘娜，再加一個普通爪牙。',
    9: '9 人好人 6 對 3，好人偏強，所以加莫甘娜同莫德雷德（梅林睇唔到佢）幫邪惡。',
    10: '10 人好人 6 對 4，場上有莫甘娜、莫德雷德同奧伯倫，場面最複雜，適合玩過幾次嘅人。',
  }[n] ?? '跟人數嘅標準配置。';
}

/**
 * One-tap presets above the setup form (BACKLOG #8): a short label and a one-line reason per head-count.
 * game.js config.presets(n) pairs each with its config patch.
 */
export const PRESET_CHIP = {
  standard: {
    label: '標準',
    reason: (n) => ({
      5: '派西維爾＋莫甘娜：5 人官方建議一齊加',
      6: '派西維爾＋莫甘娜：派西維爾要分邊個先係真梅林',
      7: '加埋奧伯倫：7 人好人最蝕，孤軍嘅奧伯倫幫到好人',
      8: '派西維爾、莫甘娜加一個爪牙：華人圈最常見',
      9: '加莫甘娜同莫德雷德：9 人好人偏強，幫吓邪惡',
      10: '莫甘娜、莫德雷德、奧伯倫全上：最複雜，熟手先玩',
    }[n] ?? '跟人數嘅標準配置'),
  },
  beginner: {
    label: '新手',
    reason: (n) => (n >= 7 ? '冇特別角色、冇湖中女神：淨係梅林對刺客，最易上手' : '冇特別角色：淨係梅林對刺客，最易上手'),
  },
  alt: {
    label: (n) => ({ 5: '莫德雷德版', 6: '莫德雷德版', 7: '冇奧伯倫版', 8: '莫德雷德版', 9: '奧伯倫版', 10: '冇奧伯倫版' }[n] ?? '另一款'),
    reason: (n) => ({
      5: '用莫德雷德代莫甘娜：梅林睇唔到佢',
      6: '用莫德雷德代莫甘娜：梅林睇唔到佢',
      7: '用爪牙代奧伯倫：邪惡三個互相識，易配合',
      8: '用莫德雷德代爪牙（英文圈常見）：邪惡易匿啲',
      9: '用奧伯倫代莫德雷德：邪惡有個孤軍，好人易啲',
      10: '用爪牙代奧伯倫：邪惡四個互相識晒',
    }[n] ?? '另一款配置'),
  },
  hiddenOberon: {
    label: '奧伯倫隱形',
    reason: '另一種講法：梅林睇唔到奧伯倫，女神驗佢係好人',
  },
};

export const LADY_OPTIONS = [
  { value: 'auto', label: '跟人數（7 人或以上開）' },
  { value: 'on', label: '開' },
  { value: 'off', label: '關' },
];

export const CONFIG = {
  badPlayers: (n) => `阿瓦隆要 5–10 個人玩（而家 ${n}）。`,
  badKey: (label) => `「${label}」設定唔啱。`,
  badComp: (evil, k) => `邪惡陣營得 ${evil} 人，刺客之外最多再揀 ${evil - 1} 個特別角色（莫甘娜、莫德雷德、奧伯倫），而家揀咗 ${k} 個。`,
  compOk: (good, evil, counts) => `好人 ${good}（${deckText(counts, 'good')}）／邪惡 ${evil}（${deckText(counts, 'evil')}）✓`,
  labels: {
    preset: '角色配置', roles: '特別角色', lady: '湖中女神',
    oberonSeenByMerlin: '梅林睇到奧伯倫', oberonReadsGoodToLady: '湖中女神驗奧伯倫會顯示好人',
    flipEvil: '刺殺前邪惡亮牌', revealSecs: '睇身份時間', questSecs: '出牌時間',
    discussSecs: '組隊討論時間', assassinSecs: '刺殺商量時間', passPhone: '一部手機玩',
  },
  help: {
    oberonSeenByMerlin: '官方規則係睇到。熄咗＝奧伯倫連梅林都睇唔到（另一種講法）。',
    oberonReadsGoodToLady: '官方規則係顯示邪惡。開咗＝女神驗到奧伯倫會話佢係好人。',
    flipEvil: '華人圈常用玩法：刺客落手前，所有邪惡玩家嘅角色公開。預設唔亮。',
    revealSecs: '每個人睇同一段時間，唔會因為有人睇完就提早完。0＝冇倒數，每人睇完自己㩒「我睇完」（一部手機玩會自動用 0）。',
    questSecs: '隊員喺呢段時間內出牌，時間到先公佈結果，咁就睇唔出邊個出得快慢。0＝全部出完即刻公佈（一部手機玩會自動用 0）。',
    discussSecs: '0＝唔計時。時間到只係響鬧提醒，唔會自動決定隊伍。',
    assassinSecs: '夠鐘只係提醒：唔會自動揀，刺客幾時揀都得，房主可以加時。0＝唔計時。',
    lady: '官方建議 7 人或以上先用。',
  },
  warn: {
    morganaNoPercival: '有莫甘娜但冇派西維爾：莫甘娜嘅能力用唔着。',
    percival5: '5 人局有派西維爾，但冇莫甘娜或者莫德雷德：官方唔建議，好人會太易贏。',
    ladySmall: '湖中女神官方建議 7 人或以上先用，人少嘅時候好人會太強。',
    revealShort: '睇身份時間咁短，梅林可能記唔晒。',
    questShort: '出牌時間咁短，隊員可能㩒唔切。',
    oberonHiddenBoth: '奧伯倫對梅林同湖中女神都隱形，邪惡會好強。',
  },
  summary: {
    players: (n, good, evil) => `${n} 人：${good} 好 ${evil} 壞`,
    good: (txt) => `🔵 好人：${txt}`,
    evil: (txt) => `🔴 邪惡：${txt}`,
    lady: (on, auto) => (on ? `🌊 湖中女神：開${auto ? '（人數夠，自動開）' : ''}` : '🌊 湖中女神：關'),
    reason: (txt) => `💡 ${txt}`,
    reveal: (s) => (s > 0 ? `⏱ 睇身份 ${s} 秒（人人一樣長）` : '⏱ 睇身份：每人睇完自己㩒'),
    quest: (s) => (s > 0 ? `出牌 ${s} 秒（時間到先公佈）` : '出牌：出齊即公佈'),
    discuss: (s) => `組隊討論 ${s} 秒（只係提醒）`,
    assassin: (s) => `刺殺商量 ${s} 秒（只係提醒，唔會自動揀）`,
    flip: '刺殺前邪惡亮牌',
    onePhone: '📱 一部手機玩：唔計時，逐個交電話',
    oberon: (merlin, lady) => `奧伯倫：梅林${merlin ? '睇到' : '睇唔到'}，女神驗到${lady ? '好人' : '邪惡'}`,
  },
  rolesHelp: '忠臣同爪牙自動補夠人數。',
};

// ---------- top bar ----------

export const TITLE = {
  reveal: ['🏰 睇身份', '㩒住張卡睇你嘅身份同情報'],
  quest: (q) => `第 ${q} 個任務`,
  pick: (leader, k) => `隊長 ${leader} · 第 ${k} 次提議`,
  vote: (leader, k) => `隊長 ${leader} · 投票緊（第 ${k} 次提議）`,
  voted: (leader, k) => `隊長 ${leader} · 投票結果（第 ${k} 次提議）`,
  playing: '任務進行緊',
  result: '任務結果',
  lady: '🌊 湖中女神',
  ladyHolder: (name) => `${name} 驗人`,
  assassinate: '🗡️ 刺殺梅林',
  assassinateSub: '邪惡商量，好人安靜',
  shot: '🗡️ 刺殺結果',
  over: ['🏰 完咗', ''],
};

// ---------- narration (host phone only; public information only) ----------

/** Minimum on-screen time of a cue when nobody speaks it (silent mode). */
export const cueMinMs = (text) => Math.max(2000, Math.min(9000, text.length * 150));

export function cueReveal({ n, deck, secs }) {
  const tail = secs > 0 ? `你哋有 ${secs} 秒。` : '睇完請㩒「我睇完」。';
  return `新一局阿瓦隆，一共${cnt(n)}個人。今局角色：${deckSpoken(deck)}。`
    + `大家望住自己部電話，㩒住張卡睇你嘅身份同情報，睇咗唔好露出表情。${tail}`;
}

export function cuePick({ q, size, need, leader, rejects, redo = false }) {
  const parts = [`${redo ? '隊長換人，唔算否決。' : ''}第${num(q)}個任務，要${cnt(size)}個人出。`];
  if (need > 1) parts.push('呢個任務要兩張失敗牌先算失敗。');
  parts.push(`隊長係${leader}，請喺電話揀隊員。大家可以先討論。`);
  if (rejects >= 4) parts.push('呢個係最後一次提議，再被否決，邪惡陣營就即刻贏。');
  else if (rejects > 0) parts.push(`呢個任務已經連續${cnt(rejects)}次被否決，到第五次邪惡陣營就贏。`);
  return parts.join('');
}

/** `team` lists the leader as 自己 when they put themself on it. */
export function cueVote({ leader, team, redo = false }) {
  return `${redo ? '啱啱嘅投票唔計，重新投過。' : ''}${leader}提議${list(team)}出任務。大家請投票：贊成定反對？`;
}

export function cueVoted({ approved, approves, rejects, rejecters, ends, nextLeader, k, secondLast }) {
  const tally = `${cnt(approves)}個贊成，${cnt(rejects)}個反對`;
  const who = rejecters.length ? `反對嘅人：${list(rejecters)}。` : '全票贊成。';
  if (approved) return `投票結果：${tally}，隊伍通過。${who}`;
  if (ends) return `投票結果：${tally}，隊伍被否決。呢個任務連續五次被否決，邪惡陣營勝利！`;
  return `投票結果：${tally}，隊伍被否決。${who}隊長傳俾${nextLeader}，呢個任務已經連續${cnt(k)}次被否決。${secondLast ? '下一次係最後一次提議。' : ''}`;
}

export function cueQuest({ team, secs, redo = false }) {
  const t = secs > 0 ? `你哋有 ${secs} 秒。` : '';
  return `${redo ? '啱啱出嘅牌唔計，重新出過。' : '隊伍通過喇。'}${list(team)}，請喺電話揀「成功」或者「失敗」。好人只可以出成功。${t}`;
}

export function cueResult({ successes, fails, success, need, wins, losses, next }) {
  const parts = [`任務結果：${cnt(successes)}張成功，${cnt(fails)}張失敗。${success ? '任務成功。' : '任務失敗。'}`];
  if (need > 1 && fails === 1) parts.push('呢個任務要兩張失敗先算失敗，所以一張失敗都算成功。');
  parts.push(`而家成功${cnt(wins)}次，失敗${cnt(losses)}次。`);
  if (next === 'over') parts.push('邪惡陣營完成三次破壞，邪惡陣營勝利！');
  else if (next === 'assassinate') parts.push('好人完成咗三個任務！不過邪惡陣營仲有最後機會：刺殺梅林。');
  return parts.join('');
}

export function cueLady({ holder }) {
  return `湖中女神喺${holder}手上。${holder}，請揀一個未攞過女神嘅人，驗佢係好人定邪惡。`;
}

export function cueLadyPeek({ holder, target }) {
  return `${holder}驗咗${target}，結果得${holder}一個人知，${holder}可以講真話，亦可以呃人。${target}而家攞住湖中女神。`;
}

export function cueAssassinate({ flip }) {
  return '好人完成咗三個任務，但係梅林仲未安全。邪惡陣營可以商量，刺客請揀一個人。好人同梅林請保持安靜，唔好出聲。'
    + (flip ? '邪惡陣營嘅角色已經公開。' : '');
}

export function cueShot({ assassin, target, hit, merlin }) {
  return hit
    ? `刺客${assassin}刺咗${target}。${target}正正係梅林！邪惡陣營反敗為勝！`
    : `刺客${assassin}刺咗${target}。${target}唔係梅林，梅林係${merlin}。好人贏！`;
}

// ---------- 💡 「而家要做咩」 (BACKLOG U1) ----------

/**
 * One line (≤ 40 characters) for a first-timer, opened only from the 💡 sheet. Built from what the
 * seat's own view already shows; it never depends on the seat's role, so a glance at the sheet tells
 * nothing either (the reveal, the quest tiles and the assassination read the same for everybody).
 */
export const HINT = {
  revealTimed: '㩒住張卡睇身份同情報，記熟佢，唔好露表情。',
  revealTap: '㩒住張卡睇身份，睇完㩒「我睇完」交俾下一位。',
  revealDone: '睇完喇，等其他人。張卡之後都可以㩒住睇返。',
  revealTable: '大家睇緊自己嘅身份。',
  pickLeader: (size) => `你係隊長：揀 ${size} 個人出任務，可以揀埋自己。`,
  pickLeaderLast: (size) => `最後一次提議：揀 ${size} 個人，要大家肯通過。`,
  pickOthers: '隊長揀緊隊員，你可以出聲講想邊個去。',
  pickLast: '第五次提議：再被否決，邪惡即刻贏。',
  vote: '睇清楚隊員有冇可疑，㩒贊成或者反對。',
  voteLast: '第五次提議：一否決，邪惡就即刻贏。',
  voteDone: '投咗喇，等齊人就會公開邊個投咩。',
  voteTable: '大家投緊票，齊人先公開。',
  votedLeader: '記住邊個投反對，再㩒「繼續」。',
  voted: '記住邊個投咩，呢啲係推理嘅線索。',
  votedEnd: '連續五次否決，邪惡贏咗。',
  questMember: '揀一張牌：好人只出得成功，邪惡可以搞破壞。',
  questDone: '出咗牌喇，等公佈結果。',
  questOthers: '隊員秘密出牌，之後只會公佈幾多張失敗。',
  resultLeader: '睇吓有幾多張失敗，諗吓邊個可疑，再㩒繼續。',
  result: '睇吓有幾多張失敗，諗吓隊入面邊個可疑。',
  ladyHolder: '揀一個人，私下睇佢係好人定邪惡。',
  ladyOthers: '女神持有人揀緊驗邊個。',
  peekHolder: '㩒住睇結果；你可以講真話，亦可以呃人。',
  peekOthers: '只有持有人知結果，佢講嘅未必係真。',
  assassinate: '邪惡傾計，刺客揀邊個係梅林；人人都要㩒，得刺客嗰下先算。',
  shot: '睇吓刺客有冇刺中梅林。',
  over: '完咗！去結果頁睇晒每個人嘅身份。',
};

// ---------- public chips on screen ----------

export const loyaltyName = (loyalty) => (loyalty === 'evil' ? '邪惡' : '好人');

// ---------- end-of-game recap ----------

export function endSummary({ reason, assassin, target, merlin }) {
  switch (reason) {
    case 'three-fails': return '邪惡陣營贏 — 三個任務失敗';
    case 'five-rejections': return '邪惡陣營贏 — 同一個任務連續五次被否決';
    case 'assassinated-merlin': return `邪惡陣營反敗為勝 — 刺客 ${assassin} 刺中梅林 ${target}`;
    case 'assassin-missed': return `好人贏 — 刺客 ${assassin} 刺錯 ${target}，梅林係 ${merlin}`;
    case 'no-shot': return '好人贏 — 邪惡陣營冇人喺度刺殺';
    default: return '完咗';
  }
}

export function endWhy({ reason, assassin, target, targetRole, merlin, failedNos, rejectLeaders }) {
  switch (reason) {
    case 'three-fails':
      return `邪惡陣營贏：任務 ${list(failedNos)} 都失敗，三個失敗，唔使刺殺。`;
    case 'five-rejections':
      return `邪惡陣營贏：同一個任務連續五次提議都被否決（隊長：${list(rejectLeaders)}），邪惡直接贏。`;
    case 'assassinated-merlin':
      return `好人完成咗三個任務，但係刺客 ${assassin} 刺中梅林 ${merlin}，邪惡陣營反敗為勝。`;
    case 'assassin-missed':
      return `好人完成咗三個任務，刺客 ${assassin} 刺咗 ${target}（${roleLabel(targetRole)}），但係梅林係 ${merlin}，好人贏。`;
    case 'no-shot':
      return '好人完成咗三個任務；邪惡陣營全部都唔喺度（💤），冇人刺殺，好人贏。';
    default: return '';
  }
}

/** What a seat saw at the start, for the recap ("night recap players could not see live"). */
export function knowsLine(kind, names, { oberonSeen } = {}) {
  switch (kind) {
    case 'seesEvil': return names.length ? `夜晚見到邪惡：${list(names)}` : '夜晚冇見到任何邪惡';
    case 'seesMerlin': return names.length === 1 ? `夜晚見到梅林：${names[0]}` : `夜晚見到梅林同莫甘娜（唔知邊個真）：${list(names)}`;
    case 'allies': return names.length ? `夜晚識得邪惡同伴：${list(names)}` : '夜晚冇識得任何同伴';
    case 'alone': return oberonSeen === false ? '孤軍作戰，連梅林都睇唔到佢' : '孤軍作戰，冇人識佢';
    default: return '冇夜晚情報';
  }
}

export const RECAP = {
  rolesHead: '── 🎭 身份同夜晚情報 ──',
  roleRow: (name, role, knows) => `${name}：${roleLabel(role)}（${TEAM[teamOf(role)].short}）— ${knows}`,
  questsHead: '── 📜 任務記錄（連出咗咩牌） ──',
  quest: ({ no, size, leader, team, success, successes, fails }) =>
    `任務 ${no}（${size} 人，隊長 ${leader}）：${list(team)} → ${success ? '成功' : '失敗'}（${successes} 成功、${fails} 失敗）`,
  played: (rows) => `　出牌：${rows.map(([n, c]) => `${n} ${c === 'fail' ? '失敗' : '成功'}`).join('、')}`,
  twoFail: '　（呢個任務要兩張失敗先算失敗，得一張失敗所以仍然成功）',
  autoPlayed: (names) => `　（${list(names)} 冇出牌，由系統代出成功）`,
  votesHead: '── 🗳 提議同投票記錄 ──',
  proposal: ({ q, no, leader, team, approved, approves, rejects, yes, no_, away = [] }) =>
    `任務 ${q} · 第 ${no} 次提議：隊長 ${leader} 揀 ${list(team)} → ${approved ? '通過' : '否決'} ${approves}:${rejects}`
    + `（贊成：${yes.length ? list(yes) : '冇'}；反對：${no_.length ? list(no_) : '冇'}${away.length ? `；💤 冇投：${list(away)}` : ''}）`,
  absent: (names) => `💤 中途唔喺度：${list(names)}（冇投票、出牌當成功）`,
  voidsHead: '── ⏭ 主持「呢鋪唔計」 ──',
  voided: ({ q, no, phase, leader }) => (phase === 'pick'
    ? `任務 ${q}：隊長 ${leader} 冇揀到隊，傳俾下一位（唔算否決）`
    : phase === 'vote'
      ? `任務 ${q} · 第 ${no} 次提議：投票取消，重新投過`
      : `任務 ${q}：出牌取消，隊員重新出過`),
  firstLeader: (name, lady) => `👑 第一任隊長：${name}${lady ? `；湖中女神由 ${lady} 開始` : ''}`,
  ladyHead: '── 🌊 湖中女神 ──',
  lady: ({ holder, target, loyalty }) => `${holder} 驗 ${target} → 睇到${loyaltyName(loyalty)}`,
  shotHead: '── 🗡️ 刺殺 ──',
  shot: ({ assassin, target, targetRole, hit }) =>
    `${assassin} 刺咗 ${target}（${roleLabel(targetRole)}）→ ${hit ? '刺中梅林' : '刺錯咗'}`,
};

// ---------- phone UI wording ----------

export const T = {
  deck: '今局角色',
  board: {
    track: '連續否決',
    trackSuffix: (k) => `${k}/5`,
    twoFail: '兩張失敗先算失敗',
    leader: '隊長',
    away: '唔喺度',
    lady: '湖中女神',
    team: '隊員',
  },
  card: {
    back: '㩒住睇身份',
    backMini: '㩒住睇返我係咩',
    yourRole: '你係',
    knowsEvil: '你睇到嘅邪惡',
    knowsEvilNote: '（睇唔到莫德雷德，亦唔知有幾多個冇俾你睇到）',
    knowsMerlin1: '梅林係',
    knowsMerlin2: '其中一個係梅林，另一個係莫甘娜',
    knowsMerlinNote: '（你分唔出邊個真邊個假）',
    knowsAllies: '你嘅邪惡同伴',
    knowsAlliesNone: '（冇人認得你，你都唔識其他人）',
    knowsAlliesNote: '（唔知佢哋嘅角色）',
    knowsNone: '你冇特別情報',
    knowsNoneNote: '靠觀察、投票同推理',
    knowsAlone: '你唔識任何人',
    knowsAloneNote: '邪惡同伴都唔識你',
    release: '放手就冚返，唔好露出表情',
    keep: '睇完喇？可以隨時㩒住睇返',
  },
  reveal: {
    title: '睇你嘅身份',
    timerLabel: '睇身份時間',
    done: '我睇完',
    doneWait: '睇完喇，等緊其他人…',
    note: '㩒住張卡睇，放手就冚返。每個人嘅卡一樣大、一樣長，有冇情報都要照睇。',
    noteTable: '大家望住自己部電話睇身份。',
    noteTap: '睇完先㩒「我睇完」，部手機會交俾下一位。',
  },
  pick: {
    title: (size) => `揀 ${size} 位隊員`,
    mineHint: (size) => `你係隊長。揀 ${size} 個人（可以包括自己），大家一齊討論之後先確定。`,
    confirm: (size) => `確定 ${size} 位隊員`,
    others: (leader) => `等 ${leader} 揀隊員…`,
    table: (leader) => `${leader} 揀緊隊員，大家可以討論。`,
    twoFail: '呢個任務要兩張失敗牌先算失敗。',
    lastChance: '最後一次提議！再被否決，邪惡直接贏。',
    timerLabel: '討論時間',
  },
  vote: {
    title: '投票：贊成定反對？',
    approve: '👍 贊成',
    reject: '👎 反對',
    confirmApprove: '確定：贊成',
    confirmReject: '確定：反對',
    pick: '揀一個先',
    voted: '已投 ✓',
    change: '改票',
    waiting: '等緊其他人…',
    progress: (d, t) => `已投 ${d}/${t}`,
    hint: '全部人投完先會同時公開，每個人投咩都會見到。',
  },
  voted: {
    approved: '✅ 隊伍通過',
    rejected: '❌ 隊伍被否決',
    ends: '🔴 連續五次被否決 — 邪惡陣營贏',
    tally: (a, r) => `贊成 ${a} · 反對 ${r}`,
    needed: (k) => `過半（${k} 票以上）先通過，平手算否決`,
    track: (before, after) => (after === 0 && before > 0
      ? `連續否決歸零（之前 ${before} 次）`
      : `連續否決：${after}/5`),
    next: '繼續',
    nextEnd: '睇結果',
    waiting: (leader) => `等 ${leader} 繼續…`,
    yes: '贊成',
    no: '反對',
    away: (names) => `💤 冇投：${names}`,
  },
  quest: {
    title: '出任務牌',
    success: '成功',
    fail: '失敗',
    successSub: '幫任務成功',
    failSub: '破壞任務',
    rule: '只有邪惡陣營先出得「失敗」。其他人㩒「失敗」冇反應。',
    play: (card) => (card ? '確定出牌' : '揀一張牌先'),   // never names the card: the label is readable from the next seat
    played: '已經出牌 ✓',
    playedWait: '等緊其他隊員…',
    playedWaitTimer: '時間到先公佈結果。',
    notMember: '你唔喺隊入面，等隊員出牌。',
    tableWait: '隊員正喺各自部電話秘密出牌。',
    progress: (d, t) => `已出牌 ${d}/${t}`,
    timerLabel: '出牌時間',
    twoFail: '呢個任務要兩張失敗先算失敗。',
  },
  result: {
    title: (no) => `任務 ${no} 結果`,
    success: '✅ 任務成功',
    fail: '❌ 任務失敗',
    counts: (s, f) => `成功 ${s} 張 · 失敗 ${f} 張`,
    twoFailNote: '呢個任務要兩張失敗先算失敗，所以一張失敗仍然成功。',
    score: (w, l) => `而家：成功 ${w} · 失敗 ${l}`,
    pileHint: '牌已經洗亂，睇唔出邊個出咩。',
    next: { pick: '下一個任務', lady: '去湖中女神', assassinate: '去刺殺階段', over: '睇結果' },
    waiting: (leader) => `等 ${leader} 繼續…`,
  },
  lady: {
    pickTitle: (holder) => `${holder} 手持湖中女神`,
    pickMine: '揀一個人驗身份。有 🚫 嘅係已經持有過女神嘅人，唔可以揀。',
    pickOthers: (holder) => `等 ${holder} 揀人驗身份…`,
    confirm: '驗佢！',
    peekTitle: (target) => `你驗咗 ${target}`,
    peekBack: '㩒住睇結果',
    peekGood: '佢係好人',
    peekEvil: '佢係邪惡',
    peekNote: '結果得你一個人知。你可以講真話，亦可以呃人，但係唔可以畀人睇電話。',
    peekDone: '睇完喇，交出女神',
    peekOthers: (holder, target) => `${holder} 驗緊 ${target}，結果只有 ${holder} 睇到。`,
    token: (target) => `${target} 而家攞住湖中女神`,
  },
  assassinate: {
    title: '邪惡陣營商量，刺客揀人',
    sub: '只有刺客嘅選擇先算數。好人同梅林請保持安靜。',
    confirm: (name) => `確定刺殺 ${name}`,
    pick: '揀一個先',
    recorded: '已記低（只有刺客嘅選擇先算數）',
    confirmArmed: '再㩒一下確定',
    flipped: '已公開嘅邪惡角色',
    timerLabel: '商量時間',
    anonymous: '刺客請拎起部手機',
    overtime: '⏰ 夠鐘 — 等刺客揀，唔會自動揀',
    extend: '⏱️ 刺殺 ＋60 秒',
  },
  shot: {
    title: '刺殺結果',
    line: (assassin, target) => `刺客 ${assassin} 刺咗 ${target}…`,
    hit: (target) => `${target} 係梅林！邪惡陣營反敗為勝！`,
    miss: (target, merlin) => `${target} 唔係梅林，梅林係 ${merlin}。好人贏！`,
    next: '睇結果',
    waiting: '等緊睇結果…',
  },
  over: { title: '完咗', see: '去結果頁睇完整記錄' },
  redo: {
    pick: '上一位隊長冇揀到隊，主持叫咗下一位（唔算否決）。',
    vote: '主持取消咗啱啱嘅投票，請重新投。',
    quest: '主持取消咗啱啱出嘅牌，請重新出。',
  },
  history: {
    title: '🗂 提議記錄',
    row: (q, no) => `任務 ${q} · 第 ${no} 次`,
    approved: '通過',
    rejected: '否決',
  },
  me: '我嘅身份',
};
