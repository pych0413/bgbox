// ============================================================
// script.js — every Cantonese string of 一夜終極狼人 (onuw): role glossary,
// rules text, config labels, narration cues, the private night notes, the
// public night log, the results report and the UI wording.
//
// Pure strings in, strings out. No DOM, no clock, no randomness.
//
// Cues are spoken from the HOST phone to a whole table, so they only ever use
// public information: the role list is public, who holds which role never is.
// Every cue is built from the step and the config alone — never from the deal —
// so a role that sits in the centre sounds exactly like one that is awake.
//
// Wording is original (HK colloquial); the rules come from docs/research/onuw.md.
// ============================================================

// ---------- roles ----------

export const ROLE_NAME = {
  doppelganger: '化身幽靈', werewolf: '狼人', minion: '爪牙', mason: '守夜人', seer: '預言家',
  robber: '強盜', troublemaker: '搗蛋鬼', drunk: '酒鬼', insomniac: '失眠者',
  villager: '村民', hunter: '獵人', tanner: '皮匠',
};

export const ROLE_EMOJI = {
  doppelganger: '👥', werewolf: '🐺', minion: '🦹', mason: '🕯️', seer: '🔮',
  robber: '🗡️', troublemaker: '🌪️', drunk: '🍺', insomniac: '🦉',
  villager: '🧑‍🌾', hunter: '🏹', tanner: '🧵',
};

/** Other names people use, shown in the glossary only. */
export const ROLE_ALIAS = {
  doppelganger: '雙面人、分身', mason: '共濟會、石匠', seer: '先知', troublemaker: '災難製造者',
  insomniac: '失眠患者', tanner: '制革匠', minion: '內奸',
};

/** One line for the role card and the night screen. */
export const ROLE_BRIEF = {
  doppelganger: '夜晚第一個醒，睇一個人張牌，變成佢嘅角色。',
  werewolf: '夜晚認同伴；獨狼可以睇中間一張。唔好俾人投中。',
  minion: '識得邊個係狼人，狼人唔識你。幫狼人隊贏。',
  mason: '成對出現，夜晚認得對方。',
  seer: '夜晚睇一個人張牌，或者中間兩張。',
  robber: '夜晚可以同人換牌，睇換返嚟嗰張。',
  troublemaker: '夜晚可以對調另外兩個人嘅牌（唔准睇）。',
  drunk: '夜晚一定要同中間一張牌對調（唔准睇）。',
  insomniac: '夜晚尾睇返自己張牌有冇變。',
  villager: '冇能力，靠推理同投票。',
  hunter: '你死咗，你投嘅人都要死。',
  tanner: '你要俾人投死先贏。',
};

export const roleName = (r) => ROLE_NAME[r] ?? String(r);
export const roleTag = (r) => `${ROLE_EMOJI[r] ?? '❔'} ${roleName(r)}`;
export const slotName = (i) => `中間第 ${Number(i) + 1} 張`;
export const nameList = (names) => names.join('、');

export const TEAM_LABEL = {
  village: '好人隊', wolf: '狼人隊', minion: '狼人隊（爪牙）', tanner: '皮匠（第三陣營）',
  minionSolo: '爪牙（冇狼人，單獨玩）',
};

/** How the village team wins (every village role shares it). */
const VILLAGE_WIN = '好人隊：有狼人死就贏；如果冇玩家係狼人，就要冇人死先贏。';

/**
 * rules.roles — the glossary the RulesSheet, the picker and the 💡 sheet show. Each role says what you DO and how
 * you WIN; the 💡 sheet splits `text` at 「點贏：」 (js/ui/logic.js roleParts), so keep that marker.
 */
export const ROLE_RULES = [
  { id: 'doppelganger', team: '#a78bfa', teamLabel: '跟住複製嘅角色',
    what: '夜晚第一個醒：揀另一個人睇佢張牌（唔換牌），你就變成佢嘅角色。複製到預言家、強盜、搗蛋鬼、酒鬼：即刻做佢嘅行動。複製到狼人、守夜人：同佢哋一齊醒。複製到爪牙、失眠者：有自己一輪。複製到村民、皮匠、獵人：冇夜晚行動。複製咗乜係跟住張牌走：夜晚尾邊個攞住呢張牌，邊個就係嗰個角色。',
    win: '同你複製咗嘅角色一樣。' },
  { id: 'werewolf', team: 'werewolf',
    what: '夜晚睜眼認同伴（你哋唔知爪牙係邊個）。淨係得你一隻醒，可以睇中間一張牌（獨狼）。日頭扮好人。',
    win: '冇狼人死、皮匠又冇死，狼人隊（連爪牙）就贏。' },
  { id: 'minion', team: 'minion',
    what: '夜晚見到邊個係狼人，但狼人唔知你係邊個。日頭幫狼人擋票，扮狼人都得。',
    win: '有玩家係狼人：狼人冇死、皮匠冇死，你就同狼人一齊贏，你自己死咗都得。冇玩家係狼人：要有其他人死、你自己活住先贏。' },
  { id: 'mason', team: 'village',
    what: '一定兩張一齊出。夜晚認得對方；見唔到另一個，即係另一張喺中間。',
    win: VILLAGE_WIN },
  { id: 'seer', team: 'village',
    what: '夜晚可以睇一個人張牌，或者睇中間兩張（二揀一）；唔想睇都得。',
    win: VILLAGE_WIN },
  { id: 'robber', team: 'village',
    what: '夜晚可以同另一個人換牌，再睇你換返嚟嗰張：你變咗嗰個角色，但唔會做佢嘅夜晚行動。被搶嗰個變咗強盜（好人），佢自己唔知。',
    win: '跟你最後張牌：搶到狼人就跟狼人隊，搶到皮匠就要死先贏，其他跟好人隊。' },
  { id: 'troublemaker', team: 'village',
    what: '夜晚可以將另外兩個人嘅牌對調（唔可以揀自己、唔可以揀中間），唔准睇。佢哋變咗對方嘅角色，自己唔知。',
    win: VILLAGE_WIN },
  { id: 'drunk', team: 'village',
    what: '夜晚一定要同中間一張牌對調（你揀邊張），唔准睇：你變咗嗰張牌嘅角色，但你自己唔知係乜。',
    win: '跟你最後張牌屬邊隊（你自己未必知）。' },
  { id: 'insomniac', team: 'village',
    what: '最後先醒，睇返自己張牌有冇俾人換過。',
    win: VILLAGE_WIN },
  { id: 'villager', team: 'village',
    what: '冇能力，冇夜晚行動，靠推理同投票。',
    win: VILLAGE_WIN },
  { id: 'hunter', team: 'village',
    what: '冇夜晚行動。你死咗嘅話，你投票揀嗰個人都會一齊死，唔理佢有幾多票。',
    win: VILLAGE_WIN },
  { id: 'tanner', team: 'tanner',
    what: '第三陣營，冇夜晚行動。日頭扮可疑，引人投你。',
    win: '你自己死咗就贏。場上有狼人而你死咗，狼人隊就贏唔到；同時有狼人死，好人同你一齊贏。' },
];

export const META = {
  name: '一夜終極狼人',
  blurb: '一晚換牌、一次投票，連自己係邊個都未必肯定。',
};

/** rules.roles with name, emoji and the aliases people use: text = 「what（別名）點贏：win」. */
export const RULES_ROLES = ROLE_RULES.map(({ what, win, ...r }) => ({
  ...r,
  name: ROLE_NAME[r.id],
  emoji: ROLE_EMOJI[r.id],
  text: `${what}${ROLE_ALIAS[r.id] ? `（別名：${ROLE_ALIAS[r.id]}）` : ''} 點贏：${win}`,
}));

// ---------- rules text ----------

/** The 30-second version: six short lines at most (BACKLOG U1). */
export const QUICK = [
  '每人一張角色牌，中間仲有 3 張冇人知。',
  '夜晚手機逐個角色叫醒；冇叫到你都照㩒掣。',
  '有啲角色會換牌：你最後係咩，自己未必知。',
  '天光討論幾分鐘，可以講大話，然後一齊投票。',
  '最多票（至少 2 票）嘅人死，平票一齊死。',
  '有狼人死 → 好人贏；冇 → 狼人隊贏。皮匠要死先贏。',
];

export const SECTIONS = [
  { title: '玩法流程', body:
    '1. 派牌：每人㩒住張牌睇一次，記住自己係邊個。中間 3 張冇人睇到。「牌組」（有咩角色、各幾張）所有人都睇到。\n'
    + '2. 夜晚：手機按次序叫角色睜眼。叫到你先有嘢做；冇叫到你，你一樣有掣㩒（假動作），每一輪時間一樣長，所以冇人聽得出邊個醒。\n'
    + '3. 天光：大家睜眼，自由討論（有倒數，房主可以加 60 秒）。可以講大話。唔准再睇自己張牌。\n'
    + '4. 投票：每人秘密揀另一個人，全部揀完同時公開。\n'
    + '5. 開牌：死咗嘅人、所有人最後張牌、邊隊贏、點解，一次過顯示；跟住有成個夜晚嘅記錄。' },
  { title: '夜晚次序', body:
    '1 化身幽靈　2 狼人　3 爪牙　4 守夜人　5 預言家　6 強盜　7 搗蛋鬼　8 酒鬼　9 失眠者\n'
    + '額外：牌組有化身幽靈同爪牙 → 化身幽靈之後有一輪「化身幽靈（爪牙）」；牌組有化身幽靈同失眠者 → 失眠者之後有一輪「化身幽靈（失眠者）」。\n'
    + '牌組入面有嗰個角色，就一定會叫，就算嗰張牌喺中間都叫，時間一樣長。\n'
    + '邊個醒，睇「派牌嗰陣嘅角色」，唔係睇夜晚嗰陣手上張牌。例：強盜搶咗搗蛋鬼張牌，原本嘅搗蛋鬼照樣醒、照樣換牌；強盜而家雖然攞住搗蛋鬼張牌，但佢唔會再做搗蛋鬼嘅行動。' },
  { title: '換牌規則（最易搞亂）', body:
    '牌會郁，人唔會。所有能力都係對「張牌」做嘢：你最後係咩，睇夜晚尾你手上張牌。\n'
    + '你唔會自動知道自己最後張牌係咩，除非你嘅能力俾你睇（強盜換完睇新牌、失眠者睇返自己張牌）。\n'
    + '搗蛋鬼同酒鬼換牌時唔准睇；被換咗牌嘅人，變成新張牌嘅角色同陣營，但佢自己唔知。\n'
    + '日頭手機只會提醒你「派牌時係咩」同「夜晚見過咩」，唔會顯示你而家張牌。' },
  { title: '投票同死亡', body:
    '每人投另一個人：唔可以投自己，唔可以棄權，唔可以投中間。\n'
    + '1. 數票。最高票如果只有 1 票（例如人人投唔同嘅人，或者大家圍成一圈各投下一位），冇人死。\n'
    + '2. 最高票 ≥ 2：所有拎到最高票嘅人一齊死，冇重投、冇 tiebreak。\n'
    + '3. 獵人死咗，佢投嘅人都死（唔理幾多票）；如果嗰個人又係獵人，繼續開槍。已經死咗嘅人唔會再死多次。\n'
    + '4. 設定可以開「圈票」：全部人都按同意，系統就幫每人投下一位，等於全場唔殺人（懷疑兩隻狼人都喺中間嗰陣用）。' },
  { title: '邊個贏', body:
    '以夜晚尾每個人手上張牌計（化身幽靈算佢複製咗嘅角色）。\n'
    + '・好人隊：有狼人死咗 → 贏。場上冇人係狼人（兩張狼人牌都喺中間）：要冇人死先贏。\n'
    + '・狼人隊（狼人 + 爪牙）：場上有狼人，而冇狼人死、皮匠都冇死 → 贏。爪牙自己死咗都一樣跟隊，只要狼人冇死。\n'
    + '・皮匠：自己死咗先贏（可以同好人一齊贏，但唔會同狼人隊一齊贏）。\n'
    + '・爪牙，冇人係狼人嗰陣：要有其他人死，而爪牙自己活住先贏；皮匠死咗都算「其他人死」。爪牙自己死咗就輸。\n'
    + '・好人同狼人隊唔會同時贏；有時全部人都輸（例如：冇狼人，淨係爪牙死咗）。\n'
    + '・每個人睇自己最後張牌，唔係睇派牌嗰陣。多個皮匠（皮匠 + 化身幽靈做皮匠）：各自死咗先各自贏。' },
  { title: '化身幽靈', body:
    '只可以睇另一個玩家張牌（唔可以睇中間、唔可以睇自己），唔會換牌。\n'
    + '複製預言家／強盜／搗蛋鬼／酒鬼：喺佢自己嗰輪即刻做行動，之後唔會再醒；真正嘅預言家等等照樣喺佢哋嗰輪醒，面對嘅係已經郁過嘅牌。\n'
    + '複製狼人：喺狼人嗰輪醒，算有狼人醒（真狼人就唔係獨狼）。複製守夜人：喺守夜人嗰輪醒，同真守夜人互相認得。\n'
    + '複製爪牙：喺「化身幽靈（爪牙）」嗰輪睇狼人。複製失眠者：喺失眠者之後睇返自己張牌。\n'
    + '複製咗乜，係跟住張「化身幽靈」牌走：強盜搶咗佢、搗蛋鬼對調咗佢，之後攞住張牌嘅人就係嗰個角色（佢自己唔知，睇到只係「化身幽靈」）。\n'
    + '如果張化身幽靈喺中間冇人複製過，被酒鬼攞走：就係冇能力嘅普通村民。\n'
    + '第一次玩建議唔好加。' },
  { title: '配置建議（按人數）', body:
    '3 人：2 狼人、預言家、強盜、搗蛋鬼、1 村民（官方）\n'
    + '4 人：同上，村民 2 個（官方）\n'
    + '5 人：同上，村民 3 個（官方）\n'
    + '6 人：2 狼人、爪牙、預言家、強盜、搗蛋鬼、3 村民\n'
    + '7 人：2 狼人、爪牙、2 守夜人、預言家、強盜、搗蛋鬼、酒鬼、失眠者\n'
    + '8 人：7 人配置 + 獵人\n'
    + '9 人：2 狼人、爪牙、皮匠、2 守夜人、預言家、強盜、搗蛋鬼、失眠者、2 村民\n'
    + '10 人：2 狼人、爪牙、2 守夜人、預言家、強盜、搗蛋鬼、酒鬼、失眠者、獵人、2 村民\n'
    + '牌數一定係「人數 + 3」。第一次玩：唔好加化身幽靈、皮匠、獵人，之後一次加一兩個新角色。' },
  { title: '用一部手機玩', body:
    '部手機放喺枱中間，全部人閉眼。手機叫到邊個角色，嗰個角色摸到部機先睜眼，㩒一下「交接卡」、做完嘢就放返低。夜晚冇人出聲。\n'
    + '留意：冇人醒嗰輪（角色喺中間）部機唔會彈交接卡，所以夜晚最好所有人真係閉眼；有條件嘅話，一人一部手機仲穩陣好多。\n'
    + '一部手機玩，夜晚速度預設「新手（慢）」：每一步都夠時間摸部機、做嘢、放返低。\n'
    + '投票同日頭都可以逐個傳機，每人揀完先傳下一位。' },
  { title: '有部手機冇電／斷線', body:
    '夜晚唔使理：每一步時間到就自動行落去，一定要做嘅（酒鬼換牌、化身幽靈揀人）系統會隨機幫佢做。投票嗰陣房主可以㩒「代佢做」，系統幫佢隨機投一票。\n'
    + '如果覺得咁唔公平，房主可以宣佈「呢局唔計」：冇人贏、冇人有分，結果頁會公開今晚派咗咩牌、做過啲乜，然後再開過一局。' },
  { title: '唔好連續做狼人（可選）', body:
    '設定入面可以開「唔好連續做狼人」：上一局派到狼人嘅人，今局唔會再派到狼人（做得到嘅話）。\n'
    + '代價：上局邊個係狼人，開牌時大家都見到，所以大家都知佢今局一開始唔係狼人。預設閂咗，派牌完全隨機。' },
  { title: '同實體版嘅分別', body:
    '・冇實體牌：換牌、睇牌全部喺手機入面做，手機亦唔會俾人偷睇到最後張牌。\n'
    + '・夜晚冇人要摸牌或者伸大拇指，所以唔會有聲音或者動作洩露身份；每一輪所有人都有掣㩒。\n'
    + '・計時、投票、死亡同勝負全部自動計，結果會解釋點解，仲有夜晚嘅完整記錄。\n'
    + '・唔包括擴充角色（破曉、吸血鬼等），只玩基本版 12 個角色。' },
];

// ---------- config ----------

export const PRESET_OPTIONS = [
  { value: 'auto', label: '推薦（跟人數）' },
  { value: 'advanced', label: '進階（加化身幽靈）' },
  { value: 'custom', label: '自訂角色' },
];
export const presetLabel = (p) => PRESET_OPTIONS.find((o) => o.value === p)?.label ?? p;

/** Why the recommended set looks like this, per head-count. Shown in the lobby. */
const REASON = {
  3: '官方 3 人配置：牌少，兩隻狼人有八成機會至少一隻喺中間，靠強盜同搗蛋鬼製造混亂。',
  4: '官方 4 人配置：同 3 人一樣，多 1 個村民（共 2 個）。',
  5: '官方 5 人配置：再多 1 個村民（共 3 個），好人牌夠多，新手友善。',
  6: '社群常用 6 人配置（Nerdist）：加爪牙（識狼人，狼人唔識佢）；9 張牌入面 6 張係好人牌。',
  7: '社群常用 7 人配置（BGG）：加一對守夜人、酒鬼同失眠者，換牌多咗，連自己張牌都要懷疑。',
  8: '7 人配置再加獵人（BGG）：獵人死咗會帶走佢投嘅人，投票要小心。',
  9: '社群常用 9 人配置（Nerdist）：加皮匠（佢想俾人投死，狼人唔可以亂推人出去），仲有 2 個村民。',
  10: '社群常用 10 人配置（BGG）：13 張牌入面得 2 張村民，幾乎人人有嘢做。',
};

/**
 * The same reason in two short pieces for the lobby's summary tags (a tag never wraps: about 17 characters each).
 * The long form (presetReason) is shown to the host under the preset select.
 */
const REASON_SHORT = {
  3: ['💡 官方 3 人配置', '牌少，狼人 8 成有一隻喺中間'],
  4: ['💡 官方 4 人配置', '同 3 人一樣，多 1 個村民'],
  5: ['💡 官方 5 人配置', '3 個村民，好人牌夠多，新手友善'],
  6: ['💡 社群常用 6 人配置', '加爪牙：識狼人，狼人唔識佢'],
  7: ['💡 社群常用 7 人配置', '加守夜人、酒鬼、失眠者，換牌多'],
  8: ['💡 7 人配置 + 獵人', '獵人死會帶走佢投嘅人'],
  9: ['💡 9 人配置：加皮匠', '皮匠想俾人投死，狼人唔敢亂推'],
  10: ['💡 社群常用 10 人配置', '13 張牌得 2 張村民，人人有嘢做'],
};

export function presetReasonShort(n, preset, extra = {}) {
  if (preset === 'advanced') return ['💡 進階：加化身幽靈', '一張村民（或酒鬼）換咗佢'];
  if (preset === 'custom') return ['💡 自訂角色', `村民自動補 ${extra.villagers ?? 0} 張`];
  return REASON_SHORT[n] ?? [];
}

/** One-tap presets in the lobby (config.presets): label + a readable reason. */
export const PRESET_CHIP = {
  recommended: { label: '推薦', reason: (n) => REASON[n] ?? '' },
  beginner: {
    label: '新手',
    reason: (n, dropped, added) => (dropped
      ? `第一次玩：唔加${dropped}${added ? `（改加${added}）` : ''}，夜晚每步慢 1.5 倍。`
      : '第一次玩：角色跟推薦，夜晚每步慢 1.5 倍，夠時間諗。'),
  },
  advanced: { label: '進階', reason: () => '加化身幽靈（換走一張村民，冇村民就換酒鬼），夜晚會長啲。' },
  allSpecial: { label: '全部特殊角色', reason: () => '官方建議玩法之一：13 張全部係特殊角色、冇村民，人人有嘢做，最亂。' },
};

export function presetReason(n, preset, extra = {}) {
  if (preset === 'advanced') {
    return '進階：將一張村民（冇村民就換酒鬼）換成化身幽靈。化身幽靈夜晚會長啲，第一次玩建議唔好加。';
  }
  if (preset === 'custom') return `自訂：自己揀角色，村民自動補夠 ${n + 3} 張（${n} 人 + 中間 3 張）${extra.villagers != null ? `，而家補 ${extra.villagers} 張` : ''}。`;
  return REASON[n] ?? '';
}

export const PACE_OPTIONS = [
  { value: 'slow', label: '新手（慢）' },
  { value: 'standard', label: '標準' },
  { value: 'fast', label: '快' },
];
export const PACE_LABEL = { slow: '慢', standard: '標準', fast: '快' };

export const CFG = {
  label: {
    preset: '角色配置', custom: '自訂角色', customMasons: '守夜人', loneWolf: '獨狼睇牌', pace: '夜晚速度',
    discussSec: '討論時間', ringVote: '圈票', antiStreak: '唔好連續做狼人', paceAuto: '夜晚速度',
  },
  help: {
    custom: (villagers) => `每個角色幾張。村民自動補夠牌數（而家 ${villagers} 張，盒入面最多 3 張）。`,
    customMasons: '加入一對守夜人（一定係 2 張）。',
    loneWolf: '淨係得一隻狼人醒嗰陣，可以睇中間一張牌（官方選項，社群視為必備）。',
    pace: '每個角色嘅夜晚時間（所有角色一樣長，冇人醒都照行）。第一次玩揀「新手」。',
    discussSec: (auto) => `0＝跟人數（3–4 人 4 分鐘、5–6 人 5 分鐘、7–8 人 7 分鐘、9–10 人 9 分鐘）。而家 ${auto}。`,
    ringVote: '全部人都按同意，就會每人投下一位，成場冇人死。',
    antiStreak: '上局派到狼人嘅人，今局唔會再派到狼人。代價：大家都知佢今局唔係狼人。預設閂咗（完全隨機）。',
  },
  msg: {
    players: (lo, hi) => `一夜終極狼人要 ${lo}–${hi} 個人玩。`,
    badKey: (label) => `「${label}」設定唔啱。`,
    total: (n, total) => `角色牌要 ${n + 3} 張（${n} 個人 + 中間 3 張），而家得 ${total} 張。`,
    tooMany: (n, over) => `角色牌多咗 ${over} 張（要 ${n + 3} 張）。請減少一啲角色。`,
    villagerOver: (need) => `村民最多 3 張（盒入面得 3 張），仲要再加 ${need} 張其他角色。`,
    noWolf: '最少要有 1 張狼人。',
    cap: (role, max) => `${roleName(role)}最多 ${max} 張。`,
  },
  warn: {
    doppel: '有化身幽靈：夜晚會長啲，第一次玩建議唔好加。',
    insomniac: '失眠者而家冇人會換佢張牌（冇強盜、搗蛋鬼、酒鬼、化身幽靈），佢永遠只會睇到自己派到嗰張。',
    fewVillage: (v, total) => `好人牌得 ${v}/${total} 張，少過一半，狼人好易贏（社群經驗）。`,
    singleWolf: '只有 1 張狼人（官方變體）：好大機會場上冇人係狼人。',
    shortDiscuss: '討論少過 1 分鐘，好難搵到線索。',
  },
};

export function discussText(sec) {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  if (!r) return `${m} 分鐘`;
  return m ? `${m} 分鐘 ${r} 秒` : `${r} 秒`;
}

/** One short tag per role, in wake order: roles = [[roleId, count], ...]. */
export function roleTags(roles) {
  return roles.map(([r, c]) => `${ROLE_EMOJI[r]} ${roleName(r)}${c > 1 ? ` ×${c}` : ''}`);
}

/** The lobby's summary: every line becomes one tag (they do not wrap), so each stays short. */
export function summaryLines({ n, preset, roles, reasonShort, pace, discussSec, loneWolf, ringVote, antiStreak }) {
  const lines = [`🃏 ${n + 3} 張牌（${n}+3）`, presetLabel(preset)];
  lines.push(...roleTags(roles));
  lines.push(...reasonShort);
  lines.push(`🌙 夜晚${PACE_LABEL[pace]}`, `☀️ 討論 ${discussText(discussSec)}`);
  lines.push(loneWolf ? '🐺 獨狼可睇中間一張' : '🐺 獨狼唔可以睇牌');
  if (ringVote) lines.push('⭕ 可以圈票');
  if (antiStreak) lines.push('🔁 唔會連續派到狼人');
  return lines;
}

// ---------- the night ----------

export const STEP_TITLE = {
  begin: '天黑', doppelganger: '化身幽靈', 'doppelganger-minion': '化身幽靈（爪牙）', werewolf: '狼人',
  minion: '爪牙', mason: '守夜人', seer: '預言家', robber: '強盜', troublemaker: '搗蛋鬼', drunk: '酒鬼',
  insomniac: '失眠者', 'doppelganger-insomniac': '化身幽靈（失眠者）', dawn: '天光',
};

export const STEP_ICON = {
  begin: '🌙', doppelganger: '👥', 'doppelganger-minion': '👥', werewolf: '🐺', minion: '🦹', mason: '🕯️',
  seer: '🔮', robber: '🗡️', troublemaker: '🌪️', drunk: '🍺', insomniac: '🦉', 'doppelganger-insomniac': '👥',
  dawn: '🌅',
};

/** The role a step is called by (the sub-steps are the Doppelgänger's). */
export const STEP_ROLE = {
  doppelganger: 'doppelganger', 'doppelganger-minion': 'doppelganger', 'doppelganger-insomniac': 'doppelganger',
  werewolf: 'werewolf', minion: 'minion', mason: 'mason', seer: 'seer', robber: 'robber',
  troublemaker: 'troublemaker', drunk: 'drunk', insomniac: 'insomniac',
};

export const stepTitle = (k) => STEP_TITLE[k] ?? '';

/** The top bar of the play screen: [title, subtitle]. The night's subtitle is the step being called. */
export function phaseTitle(phase, k) {
  switch (phase) {
    case 'deal': return [T.dealTitle, T.dealSub];
    case 'night': return ['🌙 夜晚', stepTitle(k)];
    case 'day': return ['☀️ 日頭討論', '夜晚完咗，自由討論'];
    case 'vote': return ['🗳️ 投票', '邊個係狼人？'];
    default: return ['🎯 開牌', ''];
  }
}

/** What a shared phone shows (without a name) while seats are awake. */
export function anonymousPrompt(k) {
  const r = STEP_ROLE[k];
  return r ? `${roleName(r)}請拎起部手機` : '';
}

const OPEN = {
  begin: '天黑請閉眼。大家將部手機放低，閉埋眼，夜晚唔准出聲，唔好偷望。',
  doppelganger: '化身幽靈，請睜開眼。揀一個人，睇佢張牌，你就變成佢嘅角色；如果佢有夜晚行動，你即刻做。',
  'doppelganger-minion': '如果化身幽靈複製咗爪牙，請睜開眼，睇邊個係狼人。其他人繼續閉眼。',
  werewolf: (ctx) => '狼人，請睜開眼，睇下有冇其他狼人。'
    + (ctx.loneWolf ? '如果淨係得你一隻，你可以睇中間一張牌。' : ''),
  minion: '爪牙，請睜開眼，睇邊個係狼人。狼人唔會知你係邊個。',
  mason: '守夜人，請睜開眼，睇下另一個守夜人係邊個。',
  seer: '預言家，請睜開眼。你可以睇一個人嘅牌，或者睇中間兩張牌。',
  robber: '強盜，請睜開眼。你可以同另一個人換牌，然後睇你換返嚟嗰張。',
  troublemaker: '搗蛋鬼，請睜開眼。你可以將另外兩個人嘅牌對調，唔准睇。',
  drunk: '酒鬼，請睜開眼。你一定要同中間一張牌對調，唔准睇。',
  insomniac: '失眠者，請睜開眼，睇返自己而家張牌有冇變。',
  'doppelganger-insomniac': '如果化身幽靈複製咗失眠者，請睜開眼，睇返自己而家張牌。',
  dawn: (ctx) => `天光喇，大家睜開眼！由而家開始自由討論，限時 ${discussText(ctx.discussSec)}。夜晚完咗，唔准再睇自己張牌。`,
};

/** "請閉眼" for the step that just ended; baked into the next cue so there is one line per step. */
function closeLine(k) {
  const r = STEP_ROLE[k];
  return r ? `${roleName(r)}，請閉眼。` : '';
}

/** The narration for a step. `prev` is the step before it (or null); ctx = { loneWolf, discussSec }. */
export function cueNight(k, prev, ctx = {}) {
  const open = OPEN[k];
  const body = typeof open === 'function' ? open(ctx) : (open ?? '');
  // the Doppelgänger's own sub-steps follow her main step directly: no "請閉眼" in between
  const close = prev && STEP_ROLE[prev] !== STEP_ROLE[k] ? closeLine(prev) : '';
  return `${close}${body}`;
}

export const cueDeal = () => '派牌喇。㩒住張牌睇自己係邊個，記住佢。夜晚你張牌可能會被換走，手機唔會再話你知。睇完㩒「記住喇」，全部人好咗，天就會黑。';

export const cueVote = () => '時間到！打開手機，揀你覺得係狼人嘅人。三、二、一，投票！';

export function cueReveal(f, nm) {
  const parts = ['全部人投晒票喇。'];
  if (f.nobodyDied) parts.push('冇人拎到兩票或以上，冇人死。');
  else if (f.tied.length > 1) parts.push(`平票，${nameList(f.tied.map(nm))}一齊死。`);
  else parts.push(`${nm(f.tied[0])}拎到最高票，死咗。`);
  for (const sh of f.shots) {
    if (sh.fresh) parts.push(`獵人${nm(sh.hunter)}開槍，帶走${nm(sh.target)}。`);
  }
  parts.push(`${headline(f, nm)}。`);
  return parts.join('');
}

// ---------- private night notes (the recap a seat may keep) ----------

const viaPre = (n) => (n.via === 'doppel' ? '化身幽靈 → ' : '');

/** One private note as a sentence. `nm(pid)` → display name. */
export function noteLine(n, nm) {
  const pre = viaPre(n);
  switch (n.k) {
    case 'dealt':
      return `派牌：你本來係 ${roleTag(n.role)}。`;
    case 'copy':
      return `化身幽靈：你睇咗 ${nm(n.target)} 張牌，係 ${roleTag(n.role)}，所以你變成 ${roleName(n.role)}。${n.auto ? '（時間到，系統幫你隨機揀）' : ''}`;
    case 'wolves':
      if (n.alone) return `${pre}狼人：冇其他狼人醒${n.copies >= 2 && n.via !== 'doppel' ? '，另一張狼人牌一開始喺中間' : ''}。`;
      return `${pre}狼人：同你一齊醒嘅狼人係 ${nameList(n.with.map(nm))}。`;
    case 'lone-peek':
      return `${pre}獨狼睇牌：${slotName(n.slot)}係 ${roleTag(n.role)}。`;
    case 'minion':
      return n.wolves.length
        ? `${pre}爪牙：狼人係 ${nameList(n.wolves.map(nm))}。`
        : `${pre}爪牙：冇狼人醒（冇玩家派到狼人牌）。`;
    case 'mason':
      if (n.alone) return `${pre}守夜人：冇其他守夜人醒${n.copies >= 2 && n.via !== 'doppel' ? '（另一張守夜人牌一開始喺中間）' : ''}。`;
      return `${pre}守夜人：另一個守夜人係 ${nameList(n.with.map(nm))}。`;
    case 'seer-player':
      return `${pre}預言家：你睇咗 ${nm(n.target)} 張牌，係 ${roleTag(n.role)}。`;
    case 'seer-centre':
      return `${pre}預言家：${slotName(n.slots[0])}係 ${roleTag(n.roles[0])}，${slotName(n.slots[1])}係 ${roleTag(n.roles[1])}。`;
    case 'rob':
      return `${pre}強盜：你同 ${nm(n.target)} 換咗牌，換到 ${roleTag(n.role)}。`;
    case 'swap':
      return `${pre}搗蛋鬼：你將 ${nm(n.a)} 同 ${nm(n.b)} 嘅牌對調咗（你冇睇到）。`;
    case 'drunk':
      return `${pre}酒鬼：你同${slotName(n.slot)}對調咗（你冇睇到）。${n.auto ? '（時間到，系統幫你隨機揀）' : ''}`;
    case 'insomniac':
      return `${pre}失眠者：天光前你張牌係 ${roleTag(n.role)}。`;
    case 'idle':
      return `${pre}${roleName(n.ability === 'loneWolf' ? 'werewolf' : n.ability)}：今晚你冇用能力。`;
    default:
      return '';
  }
}

// ---------- the public night log (shown after the vote) ----------

function actor(ev, nm) {
  return `${nm(ev.pid)}（${ev.via === 'doppel' ? '化身幽靈 → ' : ''}${roleName(ev.as)}）`;
}

export function logLine(ev, nm) {
  switch (ev.k) {
    case 'copy':
      return `${nm(ev.pid)} 睇咗 ${nm(ev.target)} 張牌：${roleTag(ev.role)}，所以變成 ${roleName(ev.role)}${ev.auto ? '（時間到，系統隨機揀）' : ''}`;
    case 'wolves':
      if (ev.pids.length > 1) return `狼人 ${nameList(ev.pids.map(nm))} 互相認得`;
      return ev.pids.length ? `狼人 ${nm(ev.pids[0])} 淨係得自己醒（獨狼）` : '冇玩家派到狼人牌';
    case 'lone-peek':
      return `獨狼 ${nm(ev.pid)} 睇咗${slotName(ev.slot)}：${roleTag(ev.role)}`;
    case 'minion':
      return ev.wolves.length
        ? `${actor(ev, nm)} 見到狼人：${nameList(ev.wolves.map(nm))}`
        : `${actor(ev, nm)} 冇見到狼人（冇玩家派到狼人牌）`;
    case 'mason':
      if (ev.pids.length > 1) return `守夜人 ${nameList(ev.pids.map(nm))} 互相認得`;
      return ev.pids.length ? `守夜人 ${nm(ev.pids[0])} 淨係得自己醒` : '冇玩家派到守夜人牌';
    case 'seer-player':
      return `${actor(ev, nm)} 睇咗 ${nm(ev.target)} 張牌：${roleTag(ev.role)}`;
    case 'seer-centre':
      return `${actor(ev, nm)} 睇咗${slotName(ev.slots[0])}、${slotName(ev.slots[1])}：${roleTag(ev.roles[0])}、${roleTag(ev.roles[1])}`;
    case 'rob':
      return `${actor(ev, nm)} 同 ${nm(ev.target)} 換牌，睇到新張牌係 ${roleTag(ev.role)}`;
    case 'swap':
      return `${actor(ev, nm)} 將 ${nm(ev.a)} 同 ${nm(ev.b)} 嘅牌對調`;
    case 'drunk':
      return `${actor(ev, nm)} 同${slotName(ev.slot)}對調${ev.auto ? '（時間到，系統隨機揀）' : ''}`;
    case 'insomniac':
      return `${actor(ev, nm)} 睇返自己張牌：${roleTag(ev.role)}`;
    case 'idle':
      return `${actor(ev, nm)} 冇用能力`;
    default:
      return '';
  }
}

// ---------- results ----------

/** A short sentence describing how a player's card travelled. `moves` filtered to those touching `pid`. */
function trailText(moves, pid, nm) {
  const out = [];
  for (const m of moves) {
    const who = `${nm(m.by)}（${m.via === 'doppel' ? '化身幽靈 → ' : ''}${roleName(m.k === 'rob' ? 'robber' : m.k === 'swap' ? 'troublemaker' : 'drunk')}）`;
    if (m.k === 'rob') out.push(pid === m.by ? `搶咗 ${nm(m.ps[1])} 張牌` : `俾 ${who} 搶咗張牌`);
    else if (m.k === 'swap') out.push(`俾 ${who} 同 ${nm(m.ps[0] === pid ? m.ps[1] : m.ps[0])} 對調咗`);
    else if (m.k === 'drunk') out.push(`同${slotName(m.c)}對調咗`);
  }
  return out;
}

/** Who won, as one line. */
export function headline(f, nm) {
  const names = (ids) => nameList(ids.map(nm));
  const tanner = f.winners.filter((p) => f.cards[p].final === 'tanner');
  const extra = tanner.length && f.headline === 'village' ? `；皮匠 ${names(tanner)} 都贏` : '';
  switch (f.headline) {
    case 'village': return `好人隊贏${extra}`;
    case 'wolves': return '狼人隊贏';
    case 'minion': {
      const ms = f.winners.filter((p) => f.cards[p].final === 'minion');
      const t = tanner.length ? `；皮匠 ${names(tanner)} 都贏` : '';
      return `爪牙 ${names(ms)} 贏${t}`;
    }
    case 'tanner': return `皮匠 ${names(tanner)} 贏`;
    default: return '冇人贏';
  }
}

/** The rule that decided it, as plain sentences. */
function whyLines(f, nm) {
  const names = (ids) => nameList(ids.map(nm));
  const out = [];
  const wolfDeadNames = f.W.filter((p) => f.dead.includes(p));
  const none = f.W.length === 0;

  if (none) out.push('最後冇任何玩家攞住狼人牌（狼人牌全部喺中間）。');
  else out.push(`攞住狼人牌嘅玩家：${names(f.W)}。`);
  if (f.M.length) out.push(`爪牙：${names(f.M)}。`);
  if (f.T.length) out.push(`皮匠：${names(f.T)}。`);

  if (!none) {
    if (wolfDeadNames.length) {
      out.push(`狼人 ${names(wolfDeadNames)} 死咗 → 好人贏，狼人隊（包括爪牙）輸。`);
      if (f.tannerDied) out.push(`皮匠 ${names(f.T.filter((p) => f.dead.includes(p)))} 死咗都算贏：有狼人死，好人同皮匠一齊贏。`);
    } else if (f.tannerDied) {
      out.push(`皮匠 ${names(f.T.filter((p) => f.dead.includes(p)))} 死咗，而冇狼人死 → 狼人隊唔可以贏（爪牙都一樣），好人又冇狼人死 → 只有皮匠贏。`);
    } else if (f.nobodyDied) {
      out.push('冇人死，場上有狼人 → 狼人隊贏，好人輸。');
    } else {
      const m = f.M.filter((p) => f.dead.includes(p));
      out.push(m.length && f.dead.every((p) => f.M.includes(p))
        ? `淨係爪牙 ${names(m)} 死咗，冇狼人死 → 爪牙照樣跟狼人隊贏，好人輸。`
        : '死咗嘅人入面冇狼人 → 狼人隊贏，好人輸。');
    }
  } else if (f.nobodyDied) {
    out.push('場上冇狼人，而且冇人死 → 好人贏。');
  } else {
    out.push('場上冇狼人，但有人死咗 → 好人輸。');
    if (f.M.length) {
      for (const m of f.M) {
        if (f.dead.includes(m)) out.push(`爪牙 ${nm(m)} 自己死咗 → 輸。`);
        else out.push(`爪牙 ${nm(m)} 活住，而且有其他人死咗 → 贏。`);
      }
    }
    if (f.tannerDied) {
      const dt = names(f.T.filter((p) => f.dead.includes(p)));
      out.push(f.M.length
        ? `皮匠 ${dt} 死咗 → 皮匠贏；冇狼人嗰陣，佢唔會阻住爪牙贏。`
        : `皮匠 ${dt} 死咗 → 皮匠贏。`);
    }
  }
  // several Tanners (Tanner + Doppelgänger-Tanner): each wins only if he or she personally died
  const aliveTanners = f.T.filter((p) => !f.dead.includes(p));
  if (f.tannerDied && aliveTanners.length) out.push(`皮匠 ${names(aliveTanners)} 冇死 → 佢輸（每個皮匠要自己死先贏）。`);
  if (!f.winners.length) out.push('今局冇人贏。');
  return out;
}

/** The full report: summary, why-lines, per-player cards, the night recap, plus the flat `lines`. */
export function report({ f, log, moves, order, nm }) {
  const summaryTail = (() => {
    const wolfDeadNames = f.W.filter((p) => f.dead.includes(p));
    if (f.headline === 'village') return f.W.length ? `狼人 ${nameList(wolfDeadNames.map(nm))} 死咗` : '冇狼人、冇人死';
    if (f.headline === 'wolves') return f.nobodyDied ? '冇人死' : '冇狼人死';
    if (f.headline === 'tanner') return '佢一心想死，真係死咗';
    if (f.headline === 'minion') return '冇玩家係狼人，爪牙冇死而有人死咗';
    return f.W.length ? '' : '場上冇狼人但有人死';
  })();
  const summary = `${headline(f, nm)}${summaryTail ? ` — ${summaryTail}` : ''}`;

  const why = [];
  why.push(`🗳️ 票數：${order.map((p) => `${nm(p)} ${f.counts[p]}`).join(' · ')}`);
  why.push(`🗳️ 邊個投邊個：${order.filter((p) => f.votes[p]).map((p) => `${nm(p)}→${nm(f.votes[p])}`).join(' · ')}`);
  if (f.nobodyDied) why.push('☠️ 冇人死（冇人拎到 2 票或以上）');
  else why.push(`☠️ 投票死咗：${nameList(f.tied.map((p) => `${nm(p)}（${roleName(f.cards[p].final)}）`))}${f.tied.length > 1 ? '（平票全部死）' : ''}`);
  for (const sh of f.shots) {
    why.push(sh.fresh
      ? `🏹 獵人 ${nm(sh.hunter)} 死咗，開槍帶走佢投嘅 ${nm(sh.target)}（${roleName(f.cards[sh.target].final)}）`
      : `🏹 獵人 ${nm(sh.hunter)} 開槍，但 ${nm(sh.target)} 本身已經死咗`);
  }
  why.push(...whyLines(f, nm));

  const cards = order.map((p) => {
    const c = f.cards[p];
    const trail = trailText(moves.filter((m) => m.ps.includes(p)), p, nm);
    const copy = c.face === 'doppelganger'
      ? (c.copied ? `（複製咗 ${roleName(c.copied)}）` : '（冇複製過，當村民）') : '';
    const team = c.final === 'minion' ? (f.W.length ? TEAM_LABEL.minion : TEAM_LABEL.minionSolo) : TEAM_LABEL[c.team];
    return `${nm(p)}：派到 ${roleTag(c.orig)}${trail.length ? `，${trail.join('，')}` : ''} → 最後張牌 ${roleTag(c.face)}${copy} → ${team}${f.win[p] ? ' ✅贏' : ' ❌輸'}`;
  });
  cards.push(`中間三張：${f.centre.map((c, i) => `第 ${i + 1} 張 ${roleTag(c.dealt)}${c.face !== c.dealt ? ` → ${roleTag(c.face)}` : ''}`).join('　')}`);

  const recap = [
    dealtLine(order.map((p) => f.cards[p].orig), f.centre.map((c) => c.dealt), order, nm),
    ...recapLines(log, nm),
  ];

  const lines = [...why, '── 最後張牌 ──', ...cards, '── 夜晚記錄 ──', ...recap];
  return { summary, why, cards, recap, lines };
}

function dealtLine(dealt, centre, order, nm) {
  return `派牌：${order.map((p, i) => `${nm(p)} ${roleName(dealt[i])}`).join('、')}；中間 ${centre.map(roleName).join('、')}`;
}

/** The night as it happened: one header per step (also the empty ones), then what each actor did or saw. */
function recapLines(log, nm) {
  const out = [];
  for (const ev of log) {
    if (ev.k === 'step') out.push(`▸ ${STEP_ICON[ev.step] ?? ''} ${stepTitle(ev.step)}${ev.awake.length ? '' : '：冇人醒'}`);
    else out.push(`　${logLine(ev, nm)}`);
  }
  return out;
}

// ---------- 呢局唔計 (@void-round) ----------

const VOID_AT = { deal: '派牌', night: '夜晚', day: '日頭討論', vote: '投票' };

export const VOID = {
  summary: '呢局唔計 — 房主宣佈作廢，冇人贏、冇人有分',
  title: '🚫 呢局唔計',
  body: '房主宣佈呢局作廢（例如有部手機冇電）。冇人贏、冇人有分，再開過一局就得。',
};

/** result.lines for a voided game: why, then everything that was hidden (the deal, the cards now, the night so far). */
export function voidLines({ phase, order, dealt, dealtCentre, faces, centreFaces, log, nm }) {
  const out = [`🚫 房主喺${VOID_AT[phase] ?? '遊戲中途'}宣佈呢局唔計：冇人贏、冇人有分。`];
  out.push('── 今局嘅牌 ──');
  out.push(dealtLine(dealt, dealtCentre, order, nm));
  const moved = order.filter((p, i) => faces[i] !== dealt[i]);
  if (moved.length) out.push(`作廢嗰陣：${moved.map((p) => `${nm(p)} 手上係 ${roleTag(faces[order.indexOf(p)])}`).join('、')}`);
  if (centreFaces.some((c, i) => c !== dealtCentre[i])) out.push(`作廢嗰陣中間：${centreFaces.map(roleName).join('、')}`);
  const night = recapLines(log, nm);
  if (night.length) out.push('── 夜晚記錄 ──', ...night);
  return out;
}

// ---------- what a night screen says ----------

/** Header of the night screen: [icon, title] — public, the same for every seat. */
export function stepHead(k) {
  if (k === 'begin') return T.nightBegin;
  return [STEP_ICON[k] ?? '🌙', STEP_TITLE[k] ?? ''];
}

/** The lines a seat WITHOUT anything to do sees. Same height as the awake card. */
export function sleepLines(step) {
  if (step.k === 'begin') return [['head', T.beginHead], ['sub', T.beginSub]];
  if (step.k === 'dawn') return [['head', T.dawnHead], ['sub', T.dawnSub]];
  if (step.stage === 'cue') return [['head', T.waitHead], ['sub', T.waitSub]];
  return [['head', T.sleepHead], ['sub', T.sleepSub]];
}

/** The roles a Doppelgänger wakes for later, and the step they are called in. */
const LATER = { werewolf: STEP_TITLE.werewolf, mason: STEP_TITLE.mason, minion: STEP_TITLE['doppelganger-minion'], insomniac: STEP_TITLE['doppelganger-insomniac'] };

/**
 * The lines an awake seat sees (instructions only; what it LEARNED sits behind a cover).
 * A Doppelgänger who has copied gets ONE neutral line for the rest of her step, whatever she copied and whether or not
 * she has acted: the copied role is a hidden team change, so it and its instructions live behind the cover (playtest #8).
 */
export function awakeLines(step, night) {
  const out = [['head', T.awakeHead]];
  const ab = night.ab;
  const learned = night.info.length > 0;
  if (step.k === 'doppelganger') {
    out.push(['role', night.copied == null ? T.hint.copy : T.hint.copied]);
    return out;
  }
  if (ab) out.push(['role', T.hint[ab.name]]);
  else if (learned) out.push(['note', T.hint.done]);
  return out;
}

/**
 * What the Doppelgänger's copy means for her, said only behind the cover: act now (and how), wake later, or nothing.
 * Kept short: it sits under the copy note (which already names the role) in a fixed 2:1 cover that a finger holds
 * open, so it cannot scroll on a phone — copy note + this line must fit in about four lines at 360–414 px.
 */
export function doppelLine(step, night) {
  if (step.k !== 'doppelganger' || !night?.awake || night.copied == null) return null;
  const c = night.copied;
  if (night.ab) return T.hint.doppelNow(night.ab.name, night.ab.mandatory);
  if (night.info.some((n) => n.k !== 'copy')) return null;   // she used the copied ability: its note is in the list already
  return LATER[c] ? T.hint.later(c, LATER[c]) : T.hint.noAction(c);
}

/**
 * Behind the night screen's 📓 cover, the same cover on every phone at every step (playtest #11): everything this seat
 * learned tonight so far, NEWEST FIRST — the cover is a fixed box a finger holds open and cannot scroll, so when three
 * or more notes do not all fit (a Doppelgänger who became a lone wolf: copy, wolves, the centre card) it is the oldest
 * that runs off the bottom, never what she just learned. For a Doppelgänger in her own step, what her copy means sits
 * right under the newest note (her copy). [text, cls] pairs.
 */
export function nightBook(step, night, nm) {
  const out = (night?.seen ?? []).map((n) => [noteLine(n, nm), '']).filter(([t]) => t).reverse();
  const d = doppelLine(step, night);
  if (d) out.splice(Math.min(1, out.length), 0, [d, 'do']);
  if (!out.length) out.push([T.nightNothing, 'none']);
  return out;
}

/** The confirm label of a Doppelgänger's copied ability: the pick only, never the role's verb or emoji (playtest #8). */
export const confirmNeutral = (picks) => `👆 確定：${picks.join('、')}`;

// ---------- 💡 hints (view.hint): one line each, for a first-timer, never more than the view knows ----------

export const HINT = {
  deal: {
    look: '㩒住張牌睇你係乜角色，記住佢，再㩒「記住喇」。',
    wait: '等其他人睇完張牌，夠晒人天就會黑。',
  },
  night: {
    begin: '天黑喇：閉埋眼，部手機放低。',
    cue: '閉住眼聽報；叫到你嘅角色先睜眼。',
    sleep: '呢輪冇你份：照㩒大掣，扮有嘢做。',
    awake: '你醒咗：記住見到嘅嘢，再㩒大掣。',
    info: '㩒住 📓 格仔睇你見到乜，記住佢。',
    copy: '揀一個人睇佢張牌，你就變成佢嘅角色。',
    copied: '㩒住 📓 格仔睇你變咗乜、仲要唔要做嘢。',
    seer: '睇一個人張牌，或者中間兩張（二揀一）。',
    robber: '可以同一個人換牌，再睇你新嗰張。',
    troublemaker: '可以對調另外兩個人嘅牌，唔准睇。',
    drunk: '一定要同中間一張牌對調，唔准睇。',
    loneWolf: '得你一隻狼醒：可以睇中間一張牌。',
    dawn: '天光喇：可以睜眼，準備討論。',
  },
  day: '講你係乜、見過乜（可以講大話），搵出狼人。',
  vote: {
    pick: '揀一個你覺得係狼人嘅人，再㩒確定。',
    voted: '投咗喇：等其他人，全部投完一齊公開。',
    ring: '你同意咗圈票：等其他人決定。',
    stuck: '圈票唔成：你要自己揀一個人。',
    // the host marked this seat 💤 (D4)
    absent: '房主當咗你暫時離開：今次唔使投，返嚟就同房主講聲。',
  },
  reveal: '睇下邊個死咗、點解；睇完㩒「睇完整個結果」。',
  revealDone: '等房主去結果頁。',
  over: '今局完咗，睇下結果同分數。',
  void: '呢局唔計，房主可以再開過一局。',
  table: {
    deal: '大家睇緊自己張牌。',
    night: '夜晚：邊個醒、做咗乜，只有佢自己知。',
    day: '自由討論緊，夠鐘就投票。',
    vote: '大家投緊票，投完一齊公開。',
    reveal: '開牌：睇下邊個死咗、點解。',
    over: '今局完咗，睇下結果。',
  },
};

/**
 * The 💡 sheet's heading over the seat's role card (view.hintRoleLabel). Cards change hands at night, so the sheet
 * must not claim 「你嘅角色」: what it shows is the role this seat was DEALT.
 */
export const HINT_ROLE_LABEL = '你派到嘅角色';

// ---------- UI wording ----------

export const T = {
  // deal
  dealTitle: '🃏 派牌', dealSub: '睇咗自己張牌就㩒「記住喇」',
  dealLead: '㩒住張牌睇你係邊個，記住佢。夜晚你張牌可能會被換走，手機唔會再話你知。',
  dealReady: '記住喇', dealReadyDone: '✓ 記住喇 — 等緊其他人',
  dealCount: (d, t) => `已記住 ${d} / ${t}`,
  roleListTitle: '今局角色（中間有 3 張）',
  dealTip: '夜晚點玩？手機會逐個角色叫醒，叫到你先有嘢做。每一輪都喺手機下半部大掣㩒一下（冇做嘢都要㩒），咁就冇人聽得出邊個醒。',
  peekHint: '㩒住先睇到，放手即刻冚返', lockedHint: '已鎖定，㩒下面解鎖',
  roleCardBack: '㩒住睇我係邊個',
  // night
  nightBegin: ['🌙', '天黑，閉眼'],
  sleepHead: '💤 瞓緊', sleepSub: '呢一輪冇你份。閉住眼，等下一輪。',
  waitHead: '🌙 聽住報…', waitSub: '如果叫到你，等報完就會有嘢睇。',
  dawnHead: '🌅 天光喇', dawnSub: '可以睜眼喇。',
  beginHead: '🌙 天黑', beginSub: '閉埋眼，部手機放低，唔好偷望。',
  ackMain: '👆 㩒一下', ackSub: '每一輪都㩒，咁就冇人聽得出邊個醒',
  ackConfirm: '㩒落去就定案',
  helpVoice: '夜晚唔好講嘢。個掣有冇用都照㩒，咁就冇人知邊個醒。',
  helpSilent: '靜音模式：唔使閉眼，望住自己部機 — 輪到你嗰陣佢會自動亮起。',
  nightPeekBack: '📓', nightPeekLabel: '㩒住睇你今晚見過乜',
  nightNothing: '今晚未見過嘢。',
  awakeHead: '👀 你醒咗',
  hint: {
    copy: '你係化身幽靈：揀一個人睇佢張牌，你就變成佢嘅角色（唔會換牌）。喺下面揀人，再㩒大掣。',
    seer: '🔮 你可以睇一個人張牌，或者睇中間兩張（二揀一）。喺下面揀，再㩒大掣。唔想睇就唔使理，時間到就當你唔睇。',
    robber: '🗡️ 你可以同一個人換牌，然後睇你換返嚟嗰張。揀人，再㩒大掣。唔想換就唔使理，時間到就當你唔換。',
    troublemaker: '🌪️ 你可以將另外兩個人嘅牌對調（唔准睇）。揀兩個人，再㩒大掣。唔想換就唔使理，時間到就當你唔換。',
    drunk: '🍺 你一定要同中間一張牌對調（唔准睇）。揀一張，再㩒大掣。時間到仲未揀，系統幫你隨機揀。',
    loneWolf: '🐺 淨係得你一隻狼人醒：可以睇中間一張牌（只得一次）。揀一張，再㩒大掣。唔想睇就唔使理，時間到就當你唔睇。',
    // behind the cover only, right under the copy note: the short 💡 form of the ability, so the whole cover fits
    doppelNow: (ab, mandatory) => `即刻用新角色嘅能力：${HINT.night[ab]}${mandatory ? '時間到系統幫你揀。' : '唔想用就唔使理。'}`,
    noAction: (role) => `你複製咗 ${roleTag(role)}，呢個角色夜晚冇行動。照㩒大掣就得（當假動作）。`,
    later: (role, step) => `你複製咗 ${roleTag(role)}。到「${step}」嗰一輪你會再醒。`,
    copied: '你複製咗一個角色 — 㩒住下面 📓 睇係乜、仲要唔要做嘢。',
    done: '✓ 搞掂。㩒住下面 📓 睇返；天光之後都仲睇到。',
  },
  confirmCopy: (n) => `👥 複製 ${n}`,
  confirmLookPlayer: (n) => `🔮 睇 ${n} 張牌`,
  confirmLookCentre: (a, b) => `🔮 睇${a}、${b}`,
  confirmLookOne: (c) => `👁 睇${c}`,
  confirmRob: (n) => `🗡️ 同 ${n} 換牌`,
  confirmSwap: (a, b) => `🌪️ 對調 ${a} 同 ${b}`,
  confirmDrunk: (c) => `🍺 同${c}對調`,
  pickPlayers: '其他玩家', pickCentre: '中間三張',
  centreChip: (i) => `中間 ${i + 1}`,
  // table
  tableNightTitle: (s) => `🌙 ${s}`,
  tableNightBody: '夜晚入面。邊個醒、做咗乜，只有佢自己知。',
  // day
  dayBanner: '☀️ 天光喇！',
  dayLead: '自由討論，可以講大話。唔准再睇自己張牌 — 你而家張牌可能已經換咗。',
  dayTimer: '討論時間',
  recapTitle: '📓 你嘅夜晚記錄', recapBack: '㩒住睇你嘅夜晚記錄',
  recapNothing: '你夜晚冇醒過，咩都冇見到。',
  recapWarn: '⚠️ 呢度只係「派牌時係咩」同「夜晚見過咩」。你最後張牌可能已經被換咗，唔好當佢係你而家嘅角色。',
  readyVote: '🗳️ 我哋夠鐘投票', readyVoteDone: '✓ 我夠鐘投票 — 等緊其他人（㩒一下取消）',
  readyVoteCount: (d, t, timed) => `想投票：${d} / ${t}（全部人都想先會開始${timed ? '，或者時間到' : ''}）`,
  hostSkip: '房主：想即刻投票？㩒右上角 ⋯ →「下一步」。',
  // vote
  voteLead: '邊個係狼人？揀一個，確定。全部人投晒就同時公開。',
  voteTitle: '投票',
  ringTitle: '⭕ 圈票',
  ringHelp: '懷疑兩隻狼人都喺中間？全部人都按同意，每人就會投下一位，成場冇人死。',
  ringOn: '✓ 我同意圈票（㩒一下取消）', ringOff: '⭕ 我同意圈票',
  ringCount: (d, t) => `同意圈票：${d} / ${t}（要全部人同意先生效，唔成就照各人揀嘅票計）`,
  ringStuck: '圈票未成立：其他人已經揀咗人。你要自己揀一個人（或者叫其他人改按同意）。',
  // reveal
  revealVotes: '🗳️ 票數',
  revealNobody: '冇人死',
  revealNobodySub: '冇人拎到 2 票或以上',
  revealDead: '☠️ 死咗',
  revealShot: (h, t) => `🏹 ${h} 係獵人，帶走 ${t}`,
  revealCards: '🃏 最後張牌',
  revealCentre: '中間三張',
  revealWhy: '點解會咁',
  revealRecap: '夜晚記錄（邊個做咗乜）',
  revealDealt: '派到', revealFinal: '最後',
  revealWon: '✅ 贏', revealLost: '❌ 輸',
  won: '🎉 你贏咗！', lost: '😿 你輸咗', watching: '🐺 開牌',
  revealDone: '睇完整個結果', revealDoneAck: '✓ 等緊房主…',
  revealCount: (d, t) => `睇完：${d} / ${t}（房主㩒就即刻去結果頁）`,
  tableDay: '☀️ 日頭討論', tableDayBody: '夜晚完咗，自由討論。',
  tableVote: '🗳️ 投票', tableVoteBody: '大家揀緊邊個係狼人。',
  tableDeal: '🃏 派牌', tableDealBody: '大家睇緊自己張牌。',
  votedCount: (d, t) => `已投 ${d} / ${t}`,
  // 💤 seats the host marked absent (D4): public, the same on every phone
  absentMark: '💤',
  absentLine: (names) => `💤 暫時離開（唔使等）：${names}`,
  absentSelf: '💤 房主當咗你暫時離開，今次唔使投票。返嚟咗就同房主講聲。',
};
