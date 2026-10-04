// ============================================================
// script.js — the night, in Hong Kong Cantonese, plus every short line a
// first-timer may ask for. Pure (no DOM, no clock).
//
// Original wording, written for this app; nothing here is copied from the
// official moderator app. The narration is generic on purpose: it never says
// who is awake, and every hour uses the same sentence frame and length, so
// neither the words nor their timing can give anything away.
//
// Numbers are written as Chinese numerals so the zh-HK voice reads them
// right: "兩點鐘" for the hour, "兩點" for the die face.
// ============================================================

/** Hour / die face as spoken: 而家兩點鐘 · 擲到兩點. */
export const CLOCK = ['', '一', '兩', '三', '四', '五', '六'];
/** Kept for callers that want the bare numeral. */
export const NUM = ['', '一', '二', '三', '四', '五', '六'];

/** What a step is called in the top bar. */
export function stepTitle(step) {
  switch (step?.k) {
    case 'begin': return '天黑';
    case 'open': return `${CLOCK[step.h]}點鐘`;
    case 'close': return `${CLOCK[step.h]}點鐘 · 閉眼`;
    case 'rec-pick': return '共犯 · 大盜揀人';
    case 'rec-tclose': return '共犯 · 大盜閉眼';
    case 'rec-meet': return '共犯 · 認人';
    case 'rec-close': return '共犯 · 閉眼';
    case 'dawn': return '天光';
    default: return '';
  }
}

/**
 * Narration text for a step. `n` is the head-count: 4 players wake by the die
 * they chose (their 醒鐘), and the follower scripts for 6, 7 and 8 differ.
 * Read-aloud mode shows exactly these lines, so they are short enough to read
 * in one breath.
 */
export function narrate(step, n, { passPhone = false } = {}) {
  switch (step.k) {
    case 'begin':
      // one phone in the middle (cfg.passPhone): nobody has a phone in front of them
      return passPhone ? '天黑喇，請大家閉眼。部手機擺喺枱中間，唔好偷望。' : '天黑喇，請大家閉眼。手機放喺面前唔好鎖，唔好偷望。';
    case 'open':
      return n === 4
        ? `而家${CLOCK[step.h]}點鐘。醒鐘係${CLOCK[step.h]}點嘅老鼠，請睜開眼。`
        : `而家${CLOCK[step.h]}點鐘。擲到${CLOCK[step.h]}點嘅老鼠，請睜開眼。`;
    case 'close':
      return '請閉返眼。';
    case 'rec-pick':
      return n === 6
        ? '所有人伸一隻手出嚟。大盜請睜眼，喺手機揀一位共犯，再輕輕摸佢隻手。'
        : '所有人伸一隻手出嚟。大盜請睜眼，喺手機揀兩位共犯，再輕輕摸佢哋隻手。';
    case 'rec-tclose':
      return '大盜請閉返眼。';
    case 'rec-meet':
      if (n === 6) return '被摸到手嘅共犯，請睜眼，同大盜對望認人。';
      if (n === 7) return '被摸到手嘅兩位共犯，請睜眼，互相認人。';
      return '被摸到手嘅兩位共犯，請睜眼，同大盜三個互相認人。';
    case 'rec-close':
      if (n === 6) return '大盜同共犯，請閉返眼。大家收返隻手。';
      if (n === 7) return '兩位共犯，請閉返眼。大家收返隻手。';
      return '大盜同兩位共犯，請閉返眼。大家收返隻手。';
    case 'dawn':
      return '天光喇，請大家睜開眼。芝士唔見咗！';
    default:
      return '';
  }
}

export const VOTE_CALL = '夠鐘投票！邊個係芝士大盜？喺手機揀一個人，投晒先一齊公開。';
/** The same call for one phone in the middle: it goes round, one ballot each. */
export const VOTE_CALL_PASS = '夠鐘投票！邊個係芝士大盜？部手機逐個交，揀一個人，投晒先一齊公開。';

/** The prompt a shared phone shows (without naming anyone) while seats are awake. */
export function anonymousPrompt(step, n) {
  switch (step.k) {
    case 'open':
      return n === 4
        ? `醒鐘係${CLOCK[step.h]}點嘅請拎起部手機`
        : `擲到${CLOCK[step.h]}點嘅請拎起部手機`;
    case 'rec-pick': return '大盜請拎起部手機';
    case 'rec-meet':
      if (n === 7) return '共犯請拎起部手機';
      return '大盜同共犯請拎起部手機';
    default: return '';
  }
}

/** How long the narration needs on screen when nobody speaks it (silent mode). */
export function cueMinMs(text) {
  return Math.max(1800, Math.min(7000, text.length * 160));
}

// ---------- head-count notes (lobby: why this set-up) ----------

/** One line per head-count: what is different and why it is worth knowing. `opts.pick5`: the 5p 家規. */
export function headCountNote(n, opts = {}) {
  switch (n) {
    case 4: return '4 人：官方兩粒骰變體 — 大盜醒兩次、冇共犯、唔可以偷睇，平票算大盜贏。';
    case 5: return opts.pick5
      ? '5 人（家規）：實有共犯 — 夜尾大盜揀 1 位，兩個互相認得，好似 6 人局。'
      : '5 人：共犯靠撞 — 大盜偷芝士嗰陣有人一齊醒先有，大盜一個醒就冇（家規可改做夜尾揀）。';
    case 6: return '6 人：最啱新手 — 夜尾大盜揀 1 位共犯，兩個互相認得。';
    case 7: return '7 人：推理最多 — 2 位共犯互相認得，但唔知大盜係邊個。';
    case 8: return '8 人：最熱鬧 — 2 位共犯同大盜三個互相認得。';
    default: return '';
  }
}

// ---------- 💡 hints: one line each, only shown when a player taps 💡 ----------

export const HINT = {
  roll: {
    look: '㩒住張牌睇身份，再搖骰（搖部機或者㩒掣都得）。',
    choose: '兩粒骰揀一粒做醒鐘：夜晚報到嗰個點你先醒。',
    ready: '記住身份同點數，就㩒「準備好」。',
    wait: '等其他人準備好，夜晚就會開始。',
  },
  night: {
    sleep: '未到你：閉住眼，每一步都照㩒一下大掣。',
    awake: '你醒咗：記住邊個同你一齊醒、芝士仲喺唔喺度。',
    peek: '淨係得你醒：㩒一個名再㩒大掣，睇佢粒骰（得一次）。',
    thief: '你係大盜：記住邊個見到你偷，天光要諗定點講。',
    steal: '而家㩒大掣就偷；唔㩒就等下一次醒先偷。',
    recruit: '揀共犯：㩒名再㩒大掣；唔揀，時間到會幫你隨機揀。',
    meet: '記住你嘅隊友，天光幫大盜脫身。',
  },
  // one line for every seat (the 💡 sheet is not covered: a per-role line would show who is a follower)
  day: {
    all: '再㩒住身份牌睇一次，然後講你幾點醒、見到邊個。',
  },
  vote: '揀一個你覺得係大盜嘅人，再㩒確定。唔可以投自己。',
  voted: '投咗喇，等其他人；投晒之前仲可以改。',
  // the host marked this seat 💤 (D4): it casts no vote until the host marks it back
  absent: '房主當咗你暫時離開：今次唔使投，返嚟就同房主講聲。',
  reveal: '最高票嘅人開牌，等陣就知邊個贏。',
  over: '睇下「點解會咁」同夜晚重溫，再嚟一局。',
  table: {
    roll: '大家睇緊牌、搖緊骰。',
    night: '夜晚入面，等天光。',
    day: '自由討論緊，夠鐘就投票。',
    vote: '大家投緊票，投晒先公開。',
  },
};
