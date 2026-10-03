// ============================================================
// script.js — every Cantonese line of 9upper that the engine or the UI
// shares: narration cues, hint wording, reveal explanation, result blocks.
//
// Pure strings in, strings out. Nothing here may reveal a secret: cues are
// spoken from the host phone, so they only ever use public information.
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
  if (!hint) return '';
  if (hint.kind === 'one') return `提示：同${hint.options[0]}有關。`;
  return `提示：${hint.options.join('、')}，三個入面得一個啱。`;
}

export const sc = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

// ---------- narration cues ----------

export function cueLevel(n, judge) {
  return `第 ${n} 輪，${judge}做諗樣。${judge}，請揀題目難度。分數愈高，提示愈少。`;
}

export function cueRead({ judge, term, hint, readSecs }) {
  const tail = readSecs > 0 ? `你哋有 ${readSecs} 秒。` : '睇完請㩒「我睇完」。';
  return `題目係「${term}」。${hintSpoken(hint)}${judge}做諗樣，其他人望住自己部電話，㩒住張卡睇。`
    + `其中一個人係老實人，會見到真正解釋；其他人係 9upper，要自己作。${tail}`;
}

export function cueExplain({ term, names }) {
  return `睇完喇。收起電話，由${names[0]}開始，逐個解釋「${term}」。次序係：${names.join('、')}。`;
}

export function cueJudge({ judge }) {
  return `大家都解釋完喇。${judge}，你可以繼續發問；覺得邊個太離譜，就出收皮啦。決定咗就揀邊個係老實人。`;
}

/** rv = the reveal object; nameOf(pid) → display name. Spoken: no emoji, no symbols. */
export function cueReveal(rv, nameOf) {
  const J = nameOf(rv.judge);
  const H = nameOf(rv.honest);
  const P = nameOf(rv.pick);
  const parts = [`老實人係${H}。`];
  parts.push(rv.correct
    ? `${J}估中咗，${J}同${H}各得 ${rv.d} 分。`
    : `${J}揀咗${P}，但${P}係 9upper，${P}得 ${rv.d} 分。`);
  for (const c of rv.called) {
    const t = nameOf(c.pid);
    parts.push(c.hit === 'honest'
      ? `${J}對${t}出咗收皮啦，但${t}係老實人，${J}要扣 3 分。`
      : `${J}對${t}出咗收皮啦，${t}真係 9upper，${t}扣 1 分，${J}加 1 分。`);
  }
  parts.push(`真正解釋係：${rv.explain}`);
  return parts.join('');
}

// ---------- reveal explanation (UI + log) ----------

export function revealLines(rv, nameOf) {
  const J = nameOf(rv.judge);
  const H = nameOf(rv.honest);
  const P = nameOf(rv.pick);
  const out = [`老實人係 ${H} 🙋`];
  out.push(rv.correct
    ? `✅ 估中！${J} 同 ${H} 各 +${rv.d}`
    : `❌ ${J} 揀咗 ${P}，但 ${P} 係 9upper。${P} 呃到諗樣，+${rv.d}`);
  for (const c of rv.called) {
    const t = nameOf(c.pid);
    out.push(c.hit === 'honest'
      ? `🛑 收皮啦 → ${t}：中咗老實人！${J} −3`
      : `🛑 收皮啦 → ${t}：${t} 係 9upper，${t} −1，${J} +1`);
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

/** One block of lines per finished round (`h` = a history entry). */
export function roundBlock(h, nameOf, total) {
  const J = nameOf(h.judge);
  const H = nameOf(h.honest);
  const P = nameOf(h.pick);
  const out = [
    `第 ${h.n}/${total} 輪「${h.term}」${stars(h.level)}（諗樣 ${J}）`,
    `　老實人 ${H}；${J} 揀咗 ${P}${h.correct ? '，估中' : `（9upper），估錯`}`,
  ];
  for (const c of h.called) {
    out.push(`　收皮啦 → ${nameOf(c.pid)}（${c.hit === 'honest' ? '老實人，中伏' : '9upper，中'}）`);
  }
  out.push(`　真正解釋：${h.explain}`);
  if (h.src) out.push(`　來源：${h.src}`);
  out.push(`　分數：${changeLine(h.changes, nameOf)}`);
  return out;
}

export function summaryLine(winners, score, nameOf) {
  const names = winners.map(nameOf);
  if (winners.length === 1) return `${names[0]} 以 ${score} 分贏出`;
  return `${names.join('、')} 同分，一齊贏（${score} 分）`;
}
