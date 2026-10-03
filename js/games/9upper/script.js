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

export function cueExplain({ term, first, judge }) {
  return `睇卡完。收起電話，由${first}開始解釋「${term}」。${judge}可以叫人、追問，但唔可以問人係咩身份。`;
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
      return '睇吓題目。你已經識呢個詞？即刻出聲，諗樣會換題。';
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
    case 'explain':
      if (c.role === 'judge') {
        return c.callouts > 0
          ? '㩒名叫人解釋、隨便追問（唔可以問身份）；覺得離譜就出收皮啦。'
          : '㩒名叫人解釋、隨便追問（唔可以問身份）；問夠就揀人。';
      }
      if (c.role === 'table') return '大家輪流解釋，諗樣負責追問。';
      if (c.speakingNow) {
        return honest
          ? '輪到你：照張卡講，唔記得可以話「張卡冇寫」。講完㩒「我講完」。'
          : '輪到你：自信咁作一個解釋，講完㩒「我講完」。';
      }
      return honest ? '聽住其他人講；諗樣問你就照實答。' : '聽住其他人講，可以幫手追問；諗樣問你就繼續作。';
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

// ---------- reveal explanation (UI + log) ----------

export function revealLines(rv, nameOf) {
  const J = nameOf(rv.judge);
  const H = nameOf(rv.honest);
  const P = nameOf(rv.pick);
  const out = [`老實人係 ${H} 🙋`];
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
  if (h.src) out.push(`　來源：${h.src}`);
  const clipped = (h.changes ?? []).filter((c) => c.delta !== c.nominal).map((c) => nameOf(c.pid));
  if (clipped.length) out.push(`　（分數唔會低過 0：${clipped.join('、')} 實際扣少咗）`);
  return out;
}

export function summaryLine(winners, score, nameOf) {
  const names = winners.map(nameOf);
  if (winners.length === 1) return `${names[0]} 以 ${score} 分贏出`;
  return `${names.join('、')} 同分，一齊贏（${score} 分）`;
}
