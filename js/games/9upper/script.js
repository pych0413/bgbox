// ============================================================
// script.js — every Cantonese line of 9upper that the engine or the UI
// shares: narration cues, phase hints, hint wording, reveal explanation,
// result blocks.
//
// Pure strings in, strings out. Nothing here may reveal a secret: cues are
// spoken from the host phone, so they only ever use public information, and
// a phase hint only ever talks about the viewer's OWN role.
// ============================================================

export const STARS = ['', '⭐', '⭐⭐', '⭐⭐⭐'];
export const LEVEL_NAME = ['', '簡單', '中等', '困難'];

export const stars = (level) => STARS[level] ?? '';

/** On-screen hint line. `hint` is the public hint object built at draw time, or null. */
export function hintText(hint) {
  if (!hint) return '冇提示';
  if (hint.kind === 'one') return `提示：同「${hint.options[0]}」有關`;
  return `提示：${hint.options.join('／')}（三揀一，得一個啱）`;
}

/** The same hint, written for the narrator ("、" reads better than "／"). */
export function hintSpoken(hint) {
  if (!hint) return '冇提示。';
  if (hint.kind === 'one') return `提示：同${hint.options[0]}有關。`;
  return `提示：${hint.options.join('、')}，三個入面得一個啱。`;
}

export const sc = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

// ---------- the card faces: a block of about the same length on every phone (anti-tell) ----------
//
// Only the 老實人's card carries the real explanation (17–67 characters, median 36). If every other card held one
// short line, a glance at a neighbour's card — or at who is still reading heads-down — would name the 老實人. So the
// 諗樣 and the 9upper get a block of useful text of a similar length, its length varying from round to round like a
// real explanation's. The pick is stable per (round, seat), so a re-render never changes the card under a finger.

/** A stable index in [0, n) for this round and seat (views carry no randomness). */
function pickFor(key, n) {
  let x = 7;
  for (const c of String(key)) x = (x * 31 + c.codePointAt(0)) >>> 0;
  return x % n;
}

/** The 諗樣's card: question ideas. */
export function judgeDecoy(key) {
  const pool = [
    '你唔會見到解釋。諗定問咩：呢個詞點嚟？喺邊度會見到？有冇例子？',
    '你張卡冇解釋。等陣追問細節：幾時開始有？邊個整出嚟？答得太順或者太虛都可疑。',
    '冇解釋俾你睇。留意邊個講得太快、太含糊，或者同人講得太似，諗定兩三條問題。',
    '你睇唔到真正解釋，同大家一齊望住電話。諗定一條佢哋未必答到嘅問題：點解叫呢個名？',
  ];
  return pool[pickFor(key, pool.length)];
}

/** The 9upper's card: bluffing prompts built from the PUBLIC term and hint only. */
export function bluffDecoy(term, key) {
  const t = `「${term?.text ?? '呢個詞'}」`;
  const h = term?.hint;
  const cat = h?.kind === 'one' ? `，記住佢同「${h.options[0]}」有關` : h?.kind === 'three' ? '，三個類別揀一個跟' : '';
  const pool = [
    `作一個似真嘅解釋：${t}係乜嘢、喺邊度會見到、點解叫呢個名${cat}。`,
    `即場作！${t}點嚟、幾時開始有${cat}；加個人名或者地方，細節愈具體愈似真。`,
    `${t}：諗定一個來源、一個例子同一個數字${cat}，講得似讀過咁。`,
    `你要扮識${t}。諗定佢嘅用途同由來${cat}，唔好同其他人講得一模一樣。`,
  ];
  return pool[pickFor(key, pool.length)];
}

// ---------- the source of a term ----------

const SITES = [
  [/^(zh|zh-yue|yue|zh-classical)\.wikipedia\.org$/, '維基百科'],
  [/\.wikipedia\.org$/, 'Wikipedia'],
  [/^(zh|yue)\.wiktionary\.org$/, '維基詞典'],
  [/\.wiktionary\.org$/, 'Wiktionary'],
  [/\.wikisource\.org$/, '維基文庫'],
  [/^(www\.)?moedict\.tw$/, '萌典'],
  [/^dict\.idioms\.moe\.edu\.tw$/, '教育部成語典'],
  [/^(www\.)?words\.hk$/, '粵典'],
];

/**
 * A readable label for a term's source (the bank keeps URLs, many percent-encoded):
 *   https://zh.wikipedia.org/wiki/%E6%B7%B1%E6%B0%B4%E5%9F%97 → { text: '維基百科：深水埗', href: <the url> }
 *   https://en.wikipedia.org/wiki/Blazar                       → { text: 'Wikipedia：Blazar', … }
 *   any other site → its host name; a non-URL source (the emergency cards) → its own text, no link.
 */
export function srcLabel(src) {
  const raw = String(src ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return { text: raw, href: null };
  let u;
  try { u = new URL(raw); } catch { return { text: raw, href: null }; }
  const host = u.hostname.toLowerCase();
  const site = SITES.find(([re]) => re.test(host))?.[1];
  if (!site) return { text: host.replace(/^www\./, ''), href: u.href };
  let path = u.pathname.replace(/^\/(wiki|zidin|zi)\//, '/').replace(/^\/+|\/+$/g, '');
  try { path = decodeURIComponent(path); } catch { /* keep it encoded */ }
  // a script page (…/idiomView.jsp?ID=…) has no readable title: the site's name says enough
  const title = /\.(jsp|php|aspx?|html?)$/i.test(path) ? '' : path.replace(/^['~:!]/, '').replace(/_/g, ' ').trim();
  const short = Array.from(title).length > 32 ? `${Array.from(title).slice(0, 30).join('')}…` : title;   // the link keeps the rest
  return { text: short ? `${site}：${short}` : site, href: u.href };
}

// ---------- narration cues ----------

export function cueLevel(n, judge) {
  return `第 ${n} 輪，${judge}做諗樣。${judge}，請揀題目難度：星愈多，提示愈少，分數愈高。`;
}

export function cueTerm({ n, judge, term, hint, intro, swapped }) {
  const head = intro ? `第 ${n} 輪，${judge}做諗樣。` : '';
  const swap = swapped ? '換咗題。' : '';
  return `${head}${swap}題目係「${term}」。${hintSpoken(hint)}有冇人已經識？識就出聲換題；冇人識就由${judge}㩒開始睇卡。`;
}

export function cueRead({ readSecs, pass, first }) {
  if (pass) return `部手機由${first}開始逐個傳，每人睇 ${readSecs} 秒，夠鐘自動冚返。`;
  return `開始睇卡！大家一齊數 ${readSecs} 秒。`;
}

/**
 * Start of the explaining step. `mode` = who decides the order: 'judge' (default), 'system', 'free'.
 * Only public facts: the order of a 系統派 round is public to everybody.
 */
export function cueExplain({ mode, term, first, judge }) {
  const ask = `${judge}可以追問，但唔可以問人係咩身份。`;
  if (mode === 'system') return `睇卡完。收起電話，今輪由電話隨機派人，第一位係${first}，解釋「${term}」。${ask}`;
  if (mode === 'free') return `睇卡完。收起電話，大家自己傾好邊個先講，逐個解釋「${term}」，講完㩒「我講完」。${ask}`;
  return `睇卡完。收起電話，由${first}開始解釋「${term}」。${judge}可以叫人、追問，但唔可以問人係咩身份。`;
}

/** 系統派: one short line each time somebody finishes and the phone deals the next speaker. */
export function cueNextSpeaker({ name, last }) {
  return last ? `最後一位，輪到${name}。` : `輪到${name}。`;
}

export function cueJudge({ judge }) {
  return `${judge}，決定咗就揀邊個係老實人；揀之前仲可以繼續問。`;
}

/** rv = the reveal object; nameOf(pid) → display name. Spoken: no emoji, no symbols. */
export function cueReveal(rv, nameOf) {
  const J = nameOf(rv.judge);
  const H = nameOf(rv.honest);
  const P = nameOf(rv.pick);
  const parts = [`老實人係${H}。`];
  parts.push(rv.correct
    ? `${J}估中咗，${J}同${H}各得 ${rv.d} 分。`
    : `${J}揀咗${P}，但${P}係 9upper，${P}呃到諗樣，得 ${rv.d} 分。`);
  for (const c of rv.called) {
    const t = nameOf(c.pid);
    parts.push(c.hit === 'honest'
      ? `${J}對${t}出咗收皮啦，但${t}係老實人，${J}要扣 3 分。`
      : `${J}對${t}出咗收皮啦，${t}真係 9upper，${t}扣 1 分，${J}加 1 分。`);
  }
  parts.push(`真正解釋係：${rv.explain}`);
  return parts.join('');
}

// ---------- phase hints (U1: shown only when the player taps 💡) ----------

/**
 * One line for a first-timer: 「而家要做咩」. `role` is the seat's place this round
 * ('judge' | 'player' | 'table'); `myRole` is 'honest' / 'bluffer' only once that player has their card.
 */
export function hintFor(c) {
  const honest = c.myRole === 'honest';
  const cardTip = honest
    ? '記住張卡寫乜，等陣用自己嘅講法講。唔好露出表情！'
    : '你睇唔到真解釋，趁而家諗定點作。唔好露出表情！';
  switch (c.phase) {
    case 'level':
      return c.role === 'judge'
        ? '你係諗樣：揀一個難度。星愈多，提示愈少，估中得分愈多。'
        : `等 ${c.judgeName} 揀難度，之後大家一齊睇題目。`;
    case 'term':
      if (c.role === 'judge') return '大家睇吓題目：有人已經識就㩒「換題」，冇人識就㩒「開始睇卡」。';
      if (c.role === 'table') return '大家睇題目；有人已經識就換題。';
      return '睇吓題目。已經識呢個詞？出聲或者㩒「我識呢條」，諗樣決定換唔換。';
    case 'read':
      if (c.role === 'table') return c.pass ? '部手機逐個傳，每人睇卡時間一樣。' : '大家望住自己部電話睇卡。';
      if (c.role === 'judge') {
        return c.pass ? '部手機逐個傳，大家睇完就交返俾你。' : '你都㩒住張卡望住電話，等大家睇完（你張卡冇解釋）。';
      }
      if (!c.pass) return cardTip;
      if (c.readerIsMe && !c.readStarted) return `輪到你：㩒「開始睇卡」，有 ${c.readSecs} 秒，夠鐘自動冚返。`;
      if (c.readerIsMe) return cardTip;
      if (c.readDone) return '睇完喇，等其他人輪流睇。';
      return `等 ${c.readerName || '其他人'} 睇卡，輪到你會叫你。`;
    case 'explain': return explainHint(c, honest);
    case 'judge':
      if (c.role === 'judge') return '揀你覺得係老實人嗰個；揀之前仲可以繼續問。';
      if (c.role === 'table') return '等諗樣揀邊個係老實人。';
      return honest ? '等諗樣揀人：揀中你，你同諗樣都有分。' : '等諗樣揀人：揀中你就係呃到佢，淨係你有分！';
    case 'reveal':
      if (c.role === 'judge') return `睇吓答案同分數，㩒「${c.last ? '睇總結' : '下一輪'}」繼續。`;
      return '睇吓真正解釋同分數，等諗樣繼續。';
    default:
      return '玩完喇！最高分嘅贏，下面有每輪發生咩事。';
  }
}

/** The explaining step, for each way of ordering it. */
function explainHint(c, honest) {
  const system = c.speakOrder === 'system';
  const free = c.speakOrder === 'free';
  if (c.role === 'judge') {
    const tail = c.callouts > 0 ? '覺得離譜就出收皮啦。' : '問夠就揀人。';
    if (system) return `電話派人講，你追問（唔可以問身份）；${tail}`;
    if (free) return `大家自己傾次序，講完㩒佢個名；${c.callouts > 0 ? '覺得離譜出收皮啦。' : '問夠就揀人。'}`;
    return `㩒名叫人解釋、隨便追問（唔可以問身份）；${tail}`;
  }
  if (c.role === 'table') {
    return system ? '電話隨機派人輪流解釋，諗樣負責追問。'
      : free ? '大家自己傾好次序輪流解釋，諗樣負責追問。' : '大家輪流解釋，諗樣負責追問。';
  }
  if (c.speakingNow) {
    return honest
      ? '輪到你：照張卡講，唔記得可以話「張卡冇寫」。講完㩒「我講完」。'
      : '輪到你：自信咁作一個解釋，講完㩒「我講完」。';
  }
  if (c.skippedMe) {
    return free || system ? '你俾人跳過咗：其他人講完會再輪到你。' : '你俾人跳過咗：諗樣可以叫返你，或者最尾再輪到你。';
  }
  if (free && !c.spokenMe) {
    return honest
      ? '自己傾好次序先講：照張卡講，講完㩒「我講完」。'
      : '自己傾好次序先講：自信咁作，講完㩒「我講完」。';
  }
  if ((free || system) && c.spokenMe) {
    return honest ? '你講完喇；聽住其他人，諗樣問你就照實答。' : '你講完喇；聽住其他人，諗樣問你就繼續作。';
  }
  if (system) {
    return honest ? '等電話派到你；聽住其他人講，諗樣問你就照實答。' : '等電話派到你；聽住其他人講，諗樣問你就繼續作。';
  }
  return honest ? '聽住其他人講；諗樣問你就照實答。' : '聽住其他人講，可以幫手追問；諗樣問你就繼續作。';
}

// ---------- reveal explanation (UI + log) ----------

export function revealLines(rv, nameOf) {
  const J = nameOf(rv.judge);
  const H = nameOf(rv.honest);
  const P = nameOf(rv.pick);
  const out = [`老實人係 ${H} 🙋`];
  // the rulebook turns every card face up: name the 9uppers too
  if (rv.bluffers?.length) out.push(`🤥 9upper：${rv.bluffers.map(nameOf).join('、')}`);
  out.push(rv.correct
    ? `✅ ${J} 揀中老實人：${J} 同 ${H} 各 +${rv.d}`
    : `❌ ${J} 揀咗 ${P}，但 ${P} 係 9upper：${P} 呃到諗樣 +${rv.d}，${J} 同 ${H} 冇分`);
  for (const c of rv.called) {
    const t = nameOf(c.pid);
    out.push(c.hit === 'honest'
      ? `🛑 收皮啦 → ${t}：佢係老實人！${J} −3`
      : `🛑 收皮啦 → ${t}：真係 9upper，${t} −1、${J} +1`);
  }
  const clipped = rv.changes.filter((c) => c.delta !== c.nominal).map((c) => nameOf(c.pid));
  if (clipped.length) out.push(`（分數唔會低過 0：${clipped.join('、')} 實際扣少咗）`);
  return out;
}

/** "阿明 +3 · 阿B +2" — only players whose score actually moved. */
export function changeLine(changes, nameOf) {
  const moved = changes.filter((c) => c.delta !== 0);
  return moved.length ? moved.map((c) => `${nameOf(c.pid)} ${sc(c.delta)}`).join(' · ') : '今輪冇人變分';
}

// ---------- results ----------

const WHY = {
  judgeHit: '做諗樣估中', honestHit: '做老實人被揀中', fool: '呃到諗樣',
  callHit: '收皮啦中 9upper', callMiss: '收皮啦中老實人', called: '俾人收皮', floor: '唔會低過 0 補返',
};

/** 「🏆 阿明 11 分：開局 3、做諗樣估中 +4、收皮啦中 9upper +1」 — why a player has the score they have. */
export function scoreBreakdown(pid, score, start, history, nameOf, isWinner) {
  const sum = {};
  for (const h of history) {
    for (const p of h.parts ?? []) if (p.pid === pid) sum[p.why] = (sum[p.why] ?? 0) + p.pts;
    for (const c of h.changes ?? []) if (c.pid === pid && c.delta !== c.nominal) sum.floor = (sum.floor ?? 0) + c.delta - c.nominal;
  }
  const bits = Object.keys(WHY).filter((k) => sum[k]).map((k) => `${WHY[k]} ${sc(sum[k])}`);
  const head = `${isWinner ? '🏆 ' : ''}${nameOf(pid)} ${score} 分`;
  return bits.length ? `${head}：開局 ${start}、${bits.join('、')}` : `${head}：開局 ${start}，冇加冇減`;
}

/** One block of lines per finished round (`h` = a history entry). */
export function roundBlock(h, nameOf, total) {
  const J = nameOf(h.judge);
  const H = nameOf(h.honest);
  const P = nameOf(h.pick);
  const out = [
    `第 ${h.n}/${total} 輪「${h.term}」${stars(h.level)}（諗樣 ${J}）`,
    h.correct
      ? `　老實人係 ${H}；${J} 揀中佢 → ${J}、${H} 各 +${h.d}`
      : `　老實人係 ${H}；${J} 揀咗 ${P}（9upper）→ ${P} 呃到諗樣 +${h.d}`,
  ];
  for (const c of h.called) {
    const t = nameOf(c.pid);
    out.push(c.hit === 'honest' ? `　🛑 收皮啦 → ${t}：係老實人 → ${J} −3` : `　🛑 收皮啦 → ${t}：係 9upper → ${t} −1、${J} +1`);
  }
  out.push(`　真正解釋：${h.explain}`);
  if (h.src) out.push(`　來源：${srcLabel(h.src).text}`);
  const clipped = (h.changes ?? []).filter((c) => c.delta !== c.nominal).map((c) => nameOf(c.pid));
  if (clipped.length) out.push(`　（分數唔會低過 0：${clipped.join('、')} 實際扣少咗）`);
  return out;
}

// ---------- 呢輪作廢 / 💤 唔喺度 (public) ----------

/** Above a fresh deal: why it is a fresh deal. `redo` = { how, judge, kept }; `judgeNow` = this deal's 諗樣. */
export function redoLine(redo, nameOf, judgeNow) {
  if (!redo) return '';
  const J = nameOf(redo.judge);
  const N = nameOf(judgeNow);
  switch (redo.how) {
    case 'absent': return `💤 ${J} 唔喺度：呢鋪由 ${N} 做諗樣`;
    case 'stuck': return redo.kept ? `🗑️ 上一鋪作廢：${J} 遲啲先做諗樣，呢鋪由 ${N} 做` : `🗑️ 上一鋪作廢：呢鋪由 ${N} 做諗樣`;
    default: return '🗑️ 上一鋪作廢：新題目、重新派身份';
  }
}

/** One results line per round thrown away (`x` = a state.voids entry). */
export function voidLine(x, nameOf) {
  const J = nameOf(x.judge);
  const t = x.term ? `（「${x.term}」）` : '';
  switch (x.how) {
    case 'skip': return `💤 第 ${x.n} 輪：${J} 唔喺度，冇做諗樣`;
    case 'absent': return `💤 第 ${x.n} 輪作廢${t}：${J} 唔喺度，換人做諗樣`;
    case 'stuck': return `🗑️ 第 ${x.n} 輪作廢${t}：${J} ${x.kept ? '遲啲先做諗樣' : '今個圈冇做到諗樣'}`;
    default: return `🗑️ 第 ${x.n} 輪作廢${t}，重新派過（諗樣 ${J}）`;
  }
}

export function summaryLine(winners, score, nameOf) {
  const names = winners.map(nameOf);
  if (winners.length === 1) return `${names[0]} 以 ${score} 分贏出`;
  return `${names.join('、')} 同分，一齊贏（${score} 分）`;
}
