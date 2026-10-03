// ============================================================
// script.js — the night, in Hong Kong Cantonese. Pure (no DOM, no clock).
//
// Original wording, written for this app; nothing here is copied from the
// official moderator app. The lines are generic on purpose: they never say
// who is awake, so the narrator cannot give anything away.
//
// Numbers are written as Chinese numerals so the zh-HK voice reads them
// right: "兩點鐘" for the hour, "「二」" for the die face.
// ============================================================

/** Die face as spoken: 擲到「二」嘅老鼠. */
export const NUM = ['', '一', '二', '三', '四', '五', '六'];
/** Hour as spoken: 而家係兩點鐘. */
export const CLOCK = ['', '一', '兩', '三', '四', '五', '六'];

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

/** Narration text for a step. `n` is the head-count (6, 7 and 8 differ). */
export function narrate(step, n) {
  switch (step.k) {
    case 'begin':
      return '天黑請閉眼。大家將部手機放低，閉埋眼，唔好偷望。';
    case 'open':
      return `而家係${CLOCK[step.h]}點鐘。擲到「${NUM[step.h]}」嘅老鼠，請睜開眼。`;
    case 'close':
      return '請閉返眼。';
    case 'rec-pick':
      return n === 6
        ? '所有人伸一隻手出嚟，放喺枱面。大盜請睜眼，揀一位共犯，輕輕摸佢隻手。'
        : '所有人伸一隻手出嚟，放喺枱面。大盜請睜眼，揀兩位共犯，輕輕摸佢哋隻手。';
    case 'rec-tclose':
      return '大盜請閉返眼。';
    case 'rec-meet':
      if (n === 6) return '被摸到手嘅共犯，請睜眼，同大盜對望認人。';
      if (n === 7) return '兩位共犯，請睜眼，互相認人。';
      return '兩位共犯，請睜眼，同大盜三個人互相認人。';
    case 'rec-close':
      if (n === 6) return '大盜同共犯，請閉返眼。';
      if (n === 7) return '兩位共犯，請閉返眼。';
      return '大盜同兩位共犯，請閉返眼。';
    case 'dawn':
      return '天光喇，請大家睜開眼。芝士唔見咗！';
    default:
      return '';
  }
}

export const VOTE_CALL = '邊個係芝士大盜？打開手機，揀你懷疑嘅人，大家一齊投！';

/** The prompt a shared phone shows (without naming anyone) while seats are awake. */
export function anonymousPrompt(step, n) {
  switch (step.k) {
    case 'open': return `擲到「${NUM[step.h]}」嘅請拎起部手機`;
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
