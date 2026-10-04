// ============================================================
// script.js — every Cantonese line of 你畫我猜 that the engine or the UI shares:
// narration cues, first-timer hints (view.hint), reveal / result wording.
//
// Pure strings in, strings out. Nothing here may reveal the word early: cues are spoken
// from the host phone, so they only use public information (the mask length, the category
// and characters AFTER they were revealed by the hint clock, and — only in the reveal —
// the answer). A phase hint only ever talks about the viewer's own part.
// ============================================================

export const STARS = ['', '⭐', '⭐⭐', '⭐⭐⭐'];
export const LEVEL_NAME = ['', '簡單', '中等', '困難'];
export const stars = (level) => STARS[level] ?? '';

export const TEAM_EMOJI = ['🔴', '🔵', '🟢', '🟡'];
export const TEAM_NAME = ['紅隊', '藍隊', '綠隊', '黃隊'];
export const teamLabel = (i) => `${TEAM_EMOJI[i] ?? '⚪'} ${TEAM_NAME[i] ?? `第 ${i + 1} 隊`}`;

const NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];
export const numWord = (n) => NUM[n] ?? String(n);

export const sc = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
export const joinNames = (names) => names.join('、');

// ---------- narration cues (host voice; always public information) ----------

export function cueChoose({ n, drawer, team }) {
  const who = team ? `${team}嘅${drawer}` : drawer;
  return `第 ${n} 輪，${who}畫。${drawer}，請揀一個詞。`;
}

export function cuePlay({ secs, boxes, typed, pass = false }) {
  const len = boxes > 0 ? `答案有 ${boxes} 隻字。` : '';
  // one phone (#16): the table watches the drawer's phone, so it lies flat in the middle
  return `開始！${pass ? '部手機擺喺中間。' : ''}限時 ${secs} 秒。${len}${typed ? '打字估，估中咗唔好出聲。' : '估到就大聲講出嚟。'}`;
}

export function cueCat({ cat }) {
  return `提示：類別係「${cat}」。`;
}

/** `pos` is the 1-based position of the revealed character among the boxes. */
export function cueChar({ pos, ch }) {
  return `提示：第${numWord(pos)}隻字係「${ch}」。`;
}

export function cueGot({ names }) {
  return `${joinNames(names)}估中咗！`;
}

export function cueReveal({ outcome, word, names, drawer, fouled, teams }) {
  switch (outcome) {
    case 'solved':
      return `答案係「${word}」。${joinNames(names)}估中。${fouled ? (teams ? '不過犯規成立，今輪冇分。' : '不過犯規成立，畫家冇分。') : ''}`;
    case 'fouled': return `犯規成立，今輪冇分。答案係「${word}」。`;
    case 'abandoned': return `${drawer}放棄咗今輪，答案係「${word}」。`;
    case 'voided': return '今輪作廢，唔計分，之後會補返。';
    default: return `時間到，冇人估中。答案係「${word}」。`;
  }
}

/** A rival flagged the drawing team's drawer: the clock stops for the host's ruling. */
export function cueRuling({ team }) {
  return `暫停！${team}話畫家犯規，請主持裁決。`;
}

/** Between cycles: who leads. `leaders` = { names, top }. */
export function cueStandings({ k, leaders, teams }) {
  const lead = leaders.top > 0
    ? `${joinNames(leaders.names)}${leaders.names.length > 1 ? '同分' : ''}領先，${leaders.top} 分。`
    : `${teams ? '兩邊' : '大家'}都仲係 0 分。`;
  return `第${numWord(k)}圈完。${lead}`;
}

// ---------- phase hints (shown only when a player taps 💡) ----------

/**
 * One line (≤ 40 characters) for a first-timer: 「而家要做咩」. Built only from what that seat's view knows.
 * c = { phase, role: 'drawer'|'guesser'|'rival'|'spectator', drawMode, guessMode, teams, solved, sub, drawerName,
 *       ruling, mod (this seat is the host's), canFlag, outcome }
 */
export function hintFor(c) {
  const typed = c.guessMode === 'typed';
  const paper = c.drawMode === 'paper';
  const board = paper ? '張紙' : '個畫板';
  switch (c.phase) {
    case 'choose':
      if (c.role === 'drawer') return paper ? '揀一個詞，準備好紙筆；揀完即刻開始計時。' : '揀一個你畫得出嘅詞，星多分高；可以換一批。';
      return `${c.drawerName} 揀緊詞，等一陣就開始估。`;
    case 'play':
      if (c.ruling) return c.mod ? '有人話畫家犯規：你係主持，㩒「成立」或者「唔成立」。' : '有人舉報畫家犯規，計時停咗，等主持裁決。';
      if (c.role === 'drawer') {
        if (c.sub === 'grace') return '確認緊：同時估中可以加多個，㩒錯可以撤銷。';
        if (c.sub === 'buzzer') return '時間到！啱啱有人講中就即刻㩒佢個名。';
        return typed
          ? `${paper ? '用紙筆畫' : '喺畫板畫'}，唔准寫字；系統自動對答案，漏咗可㩒 ✔。`
          : `${paper ? '用紙筆畫' : '喺畫板畫'}，唔准講嘢寫字；有人講啱就㩒佢個名。`;
      }
      if (c.role === 'guesser') {
        if (c.solved) return '你估中咗！千祈唔好講出答案。';
        if (c.sub === 'grace') return '畫家確認緊邊個估中，等一等。';
        if (c.sub === 'buzzer') return '時間到，等畫家㩒最後一下。';
        return typed ? `睇住${board}，喺格仔打答案再㩒送出，錯咗唔扣分。` : `睇住${board}，大聲講答案，畫家會㩒你個名。`;
      }
      if (c.role === 'rival') return '對方隊畫同估，你唔使估；見到犯規可以㩒 🚩。';
      return `睇住 ${c.drawerName} 畫，留意上面嘅提示。`;
    case 'reveal':
      if (c.ruling) return c.mod ? '有人話畫家犯規：你係主持，㩒「成立」或者「唔成立」。' : '有人舉報畫家犯規，等主持裁決。';
      if (c.role === 'drawer' && typed && (c.outcome === 'solved' || c.outcome === 'timeout')) return '睇吓答案；系統漏咗嘅答案，頭 5 秒可以㩒 ✔ 補返。';
      if (c.canFlag) return '睇吓答案；覺得畫家犯規，頭 5 秒可以㩒 🚩。';
      return '睇吓答案同得分，幾秒後自動下一位。';
    case 'standings':
      return '睇吓而家嘅排名，下一圈即刻開始。';
    case 'over':
      return '遊戲完，睇成績。';
    default:
      return '';
  }
}

// ---------- reveal / results wording ----------

/** Section headings for result.lines (the results screen folds a long recap by these). */
export const HEAD = { rank: '── 排名 ──', high: '── 亮點 ──', turns: '── 每輪重溫 ──' };

/** entry = a history entry (see game.js `entryOf`); nm(pid) → name; tn(teamIndex) → team label. */
export function outcomeLine(e, nm, tn) {
  switch (e.outcome) {
    case 'solved': {
      const names = e.solvers.map((x) => nm(x.pid));
      return e.team != null
        ? `${tn(e.team)} 估中（${joinNames(names)}）${e.teamPts ? `，+${e.teamPts} 分` : ''}`
        : `${joinNames(names)} 估中`;
    }
    case 'fouled': return e.team != null ? `犯規成立，${tn(e.team)} 今輪冇分` : '犯規成立';
    case 'abandoned': return `${nm(e.drawer)} 放棄咗呢條`;
    case 'voided': return `作廢（唔計分，${nm(e.drawer)} 稍後補畫）`;
    default: return '時間到，冇人估中';
  }
}

/** 「阿B +28 · 阿C +22 · 阿明（畫）+17」 — individual scoring only. */
export function pointsLine(e, nm) {
  const bits = [];
  for (const x of e.solvers) bits.push(`${nm(x.pid)} ${sc(e.solverPts?.[x.pid] ?? 0)}`);
  if (e.team == null && (e.drawerPts > 0 || e.solvers.length)) bits.push(`${nm(e.drawer)}（畫）${sc(e.drawerPts)}`);
  return bits.join(' · ');
}

export function revealHeadline(e, nm, tn) {
  if (e.outcome === 'solved') return `🎉 ${outcomeLine(e, nm, tn)}`;
  if (e.outcome === 'fouled') return `🚩 ${outcomeLine(e, nm, tn)}`;
  if (e.outcome === 'abandoned') return `🏳️ ${outcomeLine(e, nm, tn)}`;
  if (e.outcome === 'voided') return `⚠️ ${outcomeLine(e, nm, tn)}`;
  return `⏰ ${outcomeLine(e, nm, tn)}`;
}

/** One line per turn for the end-of-game recap: the word, who got it, the points. */
export function turnLine(e, nm, tn) {
  const head = `第 ${e.n} 輪 · ${e.team != null ? `${tn(e.team)} ` : ''}${nm(e.drawer)} 畫「${e.w || '（未揀詞）'}」${stars(e.level)}`;
  const tail = [outcomeLine(e, nm, tn)];
  const pts = e.team == null ? pointsLine(e, nm) : '';
  if (pts) tail.push(pts);
  if (e.fouled && e.outcome === 'solved') tail.push(e.team != null ? '🚩 犯規成立，今輪冇分' : '🚩 犯規成立，畫家冇分');
  return `${head} — ${tail.join(' ｜ ')}`;
}

export function rankLine({ rank, name, score, solved, drawerPts, tie }) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
  return `${medal}${tie ? '（同分）' : ''} ${name} ${score} 分（估中 ${solved} 次 · 畫畫得 ${drawerPts} 分）`;
}

export function teamRankLine({ rank, label, score, members, tie }) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
  return `${medal}${tie ? '（同分）' : ''} ${label} ${score} 分（${joinNames(members)}）`;
}

export function summaryLine({ winners, top, allZero }) {
  if (allZero) return '冇人得到分 — 大家一齊贏（0 分）';
  return winners.length === 1 ? `${winners[0]} 贏咗，${top} 分` : `${joinNames(winners)} 同分，一齊贏（${top} 分）`;
}
