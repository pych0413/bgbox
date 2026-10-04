// ============================================================
// script.js — every Cantonese line of 假畫家 that the engine or the UI shares:
// narration cues, phase hints, the reveal explanation and the result blocks.
//
// Pure strings in, strings out. Nothing here may reveal a secret:
//  - cues are spoken from the host phone, so they use public facts only and
//    NEVER the word before the fake's guess is locked (cueResult runs after it);
//  - a phase hint only describes what the viewer does next and is identical for
//    the fake and the real artists (the 💡 sheet is where roles are explained).
// ============================================================

export const sc = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

const names = (list, nm) => list.map(nm).join('、');

// ---------- narration cues (spoken: no emoji, no symbols) ----------

const REDO = '上一鋪唔計，重新嚟過。';

export function cueQm(n, qm, redo = false) {
  return `${redo ? REDO : ''}第 ${n} 局，${qm}做出題者。${qm}，請喺手機打一個主題同一個題目，打完㩒出題。`;
}

export function cueDeal({ n, theme, qm, redo = false }) {
  return `${redo ? REDO : ''}第 ${n} 局。${qm ? `${qm}出題。` : ''}主題係「${theme}」。有一個人係假畫家，佢唔知題目。`
    + '每個人㩒住張卡睇自己嘅，睇完㩒睇完喇。';
}

export function cueFirst(qm) {
  return `${qm}，請揀邊個先畫，之後順時針輪流。`;
}

export function cueDrawStart({ mode, first, laps }) {
  return mode === 'paper'
    ? `大家睇完卡。由${first}開始，順時針每人喺紙上畫一筆，一共畫 ${laps} 圈。畫完就㩒畫完。`
    : `大家睇完卡。由${first}開始，順時針每人畫一筆，一共畫 ${laps} 圈。`;
}

export function cueTurn({ name, lap, laps, lapStart }) {
  return lapStart ? `第 ${lap}/${laps} 圈，輪到${name}。` : `輪到${name}。`;
}

export function cueLap({ lap, laps, first }) {
  return `第 ${lap}/${laps} 圈，由${first}開始。`;
}

/** `pass`: one phone goes round (secret ballots one by one), so no 「三、二、一」 — and nobody talks until the last ballot. */
export function cueVote({ pass = false } = {}) {
  return pass
    ? '輪流投票，投完交俾下一個。全部投完先好講。'
    : '畫完喇！睇清楚幅畫，揀你覺得邊個係假畫家。三、二、一，投！';
}

export function cueRevote({ pass = false } = {}) {
  return pass
    ? '平票！冇被指嘅人輪流再投一次，只可以喺平票嘅人入面揀，全部投完先好講。'
    : '平票！冇被指嘅人再投一次，只可以喺平票嘅人入面揀。';
}

/** One phone, secret ballots: the finished picture lies in the middle first. */
export function cueLook() {
  return '畫完喇！部手機擺喺中間，大家睇清楚幅畫，可以傾，但唔好講題目。傾完就開始投票。';
}

/** 一齊指 (U7): look, talk, then the 3-2-1. */
export function cuePoint({ second = false } = {}) {
  return second
    ? '平票！冇被指嘅人再一齊指一次，只可以指平票嘅人。準備好就數三、二、一。'
    : '畫完喇！大家睇清楚幅畫，可以傾，但唔好講題目。傾完就數三、二、一，一齊指住你覺得係假畫家嘅人。';
}

export function cuePointGo() {
  return '三、二、一，指！指住唔好郁。';
}

export function cueTally({ top, caught, fake, revote }, nm) {
  if (!top.length) return '冇人投票，假畫家逃過一劫。';
  const parts = [`最高票係${names(top, nm)}。`];
  if (top.length > 1) parts.push('平票。');
  if (revote) parts.push('冇被指嘅人要再投一次。');
  else if (caught) parts.push(`${nm(fake)}係假畫家！`);
  else parts.push('假畫家逃過一劫。');
  return parts.join('');
}

/** `judge` (one phone, re-run N1): who rules on a spoken guess is named, so the table knows who gets the phone next. */
export function cueGuess({ fake, mode, judge = null }, nm) {
  if (mode === 'typed') return `${nm(fake)}被揪出嚟喇！${nm(fake)}有一次機會，喺手機打出你估嘅題目。`;
  return judge
    ? `${nm(fake)}被揪出嚟喇！${nm(fake)}有一次機會，望住幅畫大聲講出你估嘅題目，講完交俾${nm(judge)}判斷。`
    : `${nm(fake)}被揪出嚟喇！${nm(fake)}有一次機會，大聲講出你估嘅題目。`;
}

export function cueJudge(judge) {
  return `${judge}，判斷吓佢估啱唔啱。`;
}

/** Spoken after the guess is locked: only now may the word be said aloud. */
export function cueResult(rv, nm) {
  const head = rv.outcome === 'escaped' ? '假畫家贏，冇人揪到佢'
    : rv.outcome === 'guess-right' ? '假畫家被揪出，但估中題目，所以假畫家贏'
      : '真畫家贏，假畫家估錯題目';
  return `${head}。題目係${rv.word}，假畫家係${nm(rv.fake)}。${pointsSpoken(rv, nm)}`;
}

function pointsSpoken(rv, nm) {
  if (rv.scoring === 'none') return '';
  const get = (role) => rv.deltas.filter((d) => d.role === role).map((d) => nm(d.pid));
  if (rv.fakeSide) {
    // 各 only when there are two of them (with a question master); one fake alone 「得 2 分」
    return rv.qm ? `${nm(rv.fake)}，出題者${nm(rv.qm)}各得 2 分。` : `${nm(rv.fake)}得 2 分。`;
  }
  const a = get('artist');
  return a.length ? `每個真畫家得 1 分。` : '';
}

// ---------- phase hints (shown only when a player taps 💡; role-neutral on purpose) ----------

/**
 * One line for a first-timer. `role` is the seat's public place: 'qm' | 'artist' | 'table'.
 * Before the fake is revealed these lines must not depend on who the fake is.
 */
export function hintFor(c) {
  const qm = c.qmName;
  if (c.away && c.phase !== 'over') return '房主當咗你唔喺度；返咗嚟就叫房主加返你。';
  switch (c.phase) {
    case 'qm-input':
      if (c.role === 'qm') return '你係出題者：打主題同題目（或㩒🎲），再㩒「出題」。';
      return `等${qm}出題。主題公開，題目淨係真畫家知。`;
    case 'deal':
      if (c.role === 'qm') return '你知題目同假畫家係邊個；等大家睇完卡就開始畫。';
      if (c.role === 'table') return '大家睇緊自己張卡，齊人就開始畫。';
      return c.acked ? '睇完喇，等其他人睇完卡。' : '㩒住張卡睇題目（假畫家只見到 ✕），睇完㩒「睇完喇」。';
    case 'first':
      return c.role === 'qm' ? '揀邊個先畫，之後順時針輪流。' : `等${qm}揀邊個先畫。`;
    case 'draw':
      if (c.drawerIsMe) {
        return c.drawMode === 'paper'
          ? '輪到你：喺紙上一筆過畫完，再㩒「畫完」。'
          : '輪到你：喺畫板一筆過畫完，放手就算一筆。';
      }
      if (c.role === 'qm') return '你唔使畫，睇住大家畫；假畫家贏，你都贏。';
      return `睇住${c.drawerName}畫；留意邊個畫得唔似。`;
    case 'vote':
      if (c.look) return '大家睇清楚幅畫，可以傾，唔好講題目；傾完㩒「開始投票」，輪流投。';
      if (c.point) return c.role === 'qm' ? '你唔使指，等大家一齊指。' : '傾完就數三、二、一，一齊指住你覺得係假畫家嘅人；一個人㩒邊個指邊個。';
      if (c.role === 'qm') return '你唔使投票，等大家投完。';
      if (c.role === 'table') return '大家揀緊邊個係假畫家。';
      return c.voted ? '投咗喇，等其他人投完。' : '揀你覺得係假畫家嘅人再確定；唔可以投自己。';
    case 'revote':
      if (c.point) return '平票：冇被指嘅人再一齊指一次，只可以指平票嘅人。';
      return c.canVote ? '平票：喺平票嘅人入面再揀一個。' : '平票：等冇被指嘅人再投一次。';
    case 'tally':
      return '睇吓邊個投邊個，幾秒後自動繼續。';
    case 'guess':
    case 'judge':
      if (c.canGuess) return '你被揪出：打出你估嘅題目，只有一次機會。';
      if (c.canJudge) return '聽佢估咗乜，啱就㩒「啱」，唔啱㩒「錯」。';
      // one phone (re-run N1): the fake's screen lies face up in the middle — names, never 「你」
      if (c.isFake && c.handOver) return `${c.fakeName}：望住幅畫大聲講出估嘅題目（得一次機會），講完交俾${c.judgeName}判斷。`;
      if (c.isFake) return '你被揪出：大聲講出你估嘅題目，只有一次機會。';
      return '假畫家有一次機會估題目：估中佢贏，估錯真畫家贏。';
    case 'result':
      if (c.seen) return c.last ? '等其他人睇完，齊人就睇總結。' : '等其他人睇完，齊人就開下一局。';
      return '睇吓題目、假畫家同邊個贏，睇完㩒「睇完」。';
    default:
      return '玩完喇！睇吓邊個贏同每局發生咩事。';
  }
}

// ---------- reveal explanation (UI + log) ----------

function voteLine(t, nm) {
  const entries = Object.entries(t.counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '冇人投票';
  return entries.map(([pid, n]) => `${nm(pid)} ${n} 票`).join('、');
}

/** The "why" of one finished round. `rv` is the reveal object built by the engine. */
export function revealLines(rv, nm) {
  const out = [];
  const head = {
    escaped: '🕶️ 假畫家贏：冇人揪到佢',
    'guess-right': '🕶️ 假畫家贏：被揪出，但估中咗題目',
    'guess-wrong': '🎨 真畫家贏：假畫家估錯題目',
  }[rv.outcome];
  out.push(head);
  out.push(`題目「${rv.word}」· 主題「${rv.theme}」· 假畫家：${nm(rv.fake)}${rv.qm ? ` · 出題者：${nm(rv.qm)}` : ''}`);

  const r1 = rv.round1;
  out.push(`投票：${voteLine(r1, nm)}${r1.abstained.length ? `（${names(r1.abstained, nm)} 冇投）` : ''}`);
  const tied = r1.top.length > 1;
  const fakeIn = r1.top.includes(rv.fake);
  if (!r1.top.length) out.push('冇人投票，所以冇人被揪出。');
  else if (!tied && fakeIn) out.push('假畫家得最多票，被揪出咗。');
  else if (!fakeIn) out.push(`最高票係 ${names(r1.top, nm)}，但${r1.top.length > 1 ? '佢哋都' : '佢'}唔係假畫家，所以假畫家逃脫。`);
  else if (rv.tieRule === 'escape') out.push(`平票（${names(r1.top, nm)}），舊版規則當冇揪到假畫家。`);
  else if (rv.tieRule === 'revote') {
    if (!rv.round2) out.push(`平票（${names(r1.top, nm)}），冇人可以再投，所以照現行規則：假畫家要估題目。`);
    else {
      out.push(`平票（${names(r1.top, nm)}），冇被指嘅人再投一次：${voteLine(rv.round2, nm)}。`);
      const t2 = rv.round2.top;
      if (t2.length === 1) out.push(t2[0] === rv.fake ? '再投之後假畫家得最多票，被揪出。' : `再投之後 ${nm(t2[0])} 得最多票，唔係假畫家，假畫家逃脫。`);
      else out.push('再投仍然平票，照現行規則：假畫家要估題目。');
    }
  } else out.push(`平票（${names(r1.top, nm)}），但假畫家喺最高票入面，所以都要估題目。`);

  if (rv.guess) {
    const g = rv.guess;
    const said = g.text ? `估「${g.text}」` : '口頭估咗';
    if (g.by === 'away') out.push(`${nm(rv.fake)} 唔喺度，冇估到，當估錯。`);
    else {
      const by = g.by === 'match' ? '，同詞庫答案一樣' : g.by === 'auto' ? '（冇人判，當估錯）' : g.by === 'none' ? '（冇答）' : `，${nm(rv.judge)} 判：${g.correct ? '啱' : '錯'}`;
      out.push(`${nm(rv.fake)} ${said}${by}。`);
    }
  }

  if (rv.scoring === 'none') {
    out.push(rv.fakeSide
      ? `唔計分：呢局 ${names(rv.winners, nm)} 贏。`
      : `唔計分：呢局真畫家贏（${names(rv.winners, nm)}）。`);
  } else if (rv.fakeSide) {
    out.push(rv.qm
      ? `假畫家 ${nm(rv.fake)} 同出題者 ${nm(rv.qm)} 各 +2。`
      : `假畫家 ${nm(rv.fake)} +2。`);
  } else {
    out.push(`每個真畫家 +1：${names(rv.deltas.filter((d) => d.role === 'artist').map((d) => d.pid), nm)}。假畫家${rv.qm ? '同出題者' : ''}冇分。`);
  }
  return out;
}

// ---------- result blocks ----------

const OUTCOME_SHORT = { escaped: '假畫家逃脫', 'guess-right': '被揪出但估中', 'guess-wrong': '估錯，真畫家贏' };

/** Votes in one short run: 「阿明 3、阿B 1」 (+ how many did not vote). */
function votesShort(t, nm) {
  if (!t) return '';
  const e = Object.entries(t.counts).sort((a, b) => b[1] - a[1]);
  const s = e.length ? e.map(([pid, n]) => `${nm(pid)} ${n}`).join('、') : '冇人投';
  return t.abstained?.length ? `${s}（${t.abstained.length} 人冇投）` : s;
}

/** Why the round went the way it did, in one line (votes → caught or not → the guess). */
function whyShort(h, nm) {
  const r1 = h.round1;
  const parts = [`投票：${votesShort(r1, nm)}`];
  if (h.round2) parts.push(`再投：${votesShort(h.round2, nm)}`);
  const tied = r1.top.length > 1 && r1.top.includes(h.fake);
  if (!h.caught) {
    parts.push(!r1.top.length ? '冇人投票，冇揪到'
      : !r1.top.includes(h.fake) ? '最高票唔係假畫家'
        : h.round2 ? '再投都揪唔到' : '平票當冇揪到（舊版）');
  } else {
    parts.push(h.round2 && h.round2.top.length !== 1 ? '再投都平票，都要估'
      : tied && !h.round2 ? '平票都要估，算揪到' : '揪到');
    const g = h.guess;
    if (g) parts.push(g.by === 'none' ? '冇估' : g.by === 'away' ? '唔喺度，冇估' : `${g.text ? `估「${g.text}」` : '開口估'}${g.correct ? '，啱' : '，錯'}`);
  }
  return `　↳ ${parts.join(' → ')}`;
}

/** Two lines per finished round for result.lines (what was hidden during play, and why it ended so). */
export function roundBlock(h, nm, total) {
  const n = `第 ${h.n}${total ? `/${total}` : ''} 局`;
  if (h.voided) {
    const what = h.word ? `「${h.word}」（${h.theme}）· 假畫家：${nm(h.fake)}` : '未出題';
    const why = h.why === 'absent' && h.absent ? `（${nm(h.absent)} 唔喺度）` : '';
    return [`${n}（作廢，唔計）${what}${h.qm ? ` · 出題：${nm(h.qm)}` : ''}${why}`];
  }
  const gains = h.scoring === 'none'
    ? `${names(h.winners ?? [], nm)} 贏`
    : h.deltas.filter((d) => d.delta !== 0).map((d) => `${nm(d.pid)} ${sc(d.delta)}`).join('、') || '冇人得分';
  return [
    `${n} 「${h.word}」（${h.theme}）· 假畫家：${nm(h.fake)}${h.qm ? ` · 出題：${nm(h.qm)}` : ''} — ${OUTCOME_SHORT[h.outcome]} · ${gains}`,
    whyShort(h, nm),
  ];
}

export function summaryLine(winners, top, nm, scoring = 'points') {
  if (!winners.length) return '冇人贏';
  if (scoring === 'none') {
    return winners.length === 1 ? `${nm(winners[0])} 贏得最多局（${top} 局）` : `${names(winners, nm)} 一樣咁多，各贏 ${top} 局`;
  }
  if (winners.length === 1) return `${nm(winners[0])} 贏咗，共 ${top} 分`;
  return `${names(winners, nm)} 同分奪冠，各 ${top} 分`;
}

export function overHint() {
  return '玩完喇！睇吓邊個贏同每局發生咩事。';
}
