// ============================================================
// NarratorBar — the host's strip showing the current narration line, with
// replay, skip and the 語音 · 讀稿 · 靜音 mode switch.
//
//   NarratorBar({ cue, mode, onReplay, onNext, onMode })
//     → { el, update(props), destroy() }
//
//   cue   { id, text } | null      mode   'voice' | 'read' | 'silent'
//
// Optional extras: `paused` + `onPause` (a ⏸ button) and `hidden`.
//
// Watchdog (BACKLOG #1): `stalled: true` (+ `line`, `reason`) means the phone was asked
// to speak and nothing came out (no start within 1.5 s, the length timeout hit,
// or no voice at all). The bar then never stalls silently: it shows the line in
// big text for a human to read out, with 🔁 重講, ⏭ 跳過 (`onSkip`, finishes
// just this line) and 下一步.
//
//  - voice  the phone speaks; the line is shown small, 🔁 replays it, 下一步 skips.
//  - read   a human narrator reads the big text aloud and presses 下一步.
//  - silent on-screen prompt only; steps advance on timers (下一步 still skips).
//
// The bar never speaks by itself: the app speaks cues and reports them done.
//
// 下一步 ignores a second tap within NEXT_COOLDOWN_MS (qa:werewolf): in 讀稿 a double tap would
// otherwise acknowledge the line AND cut the night window that follows it short.
//
// `compact: true` (the play screen sets it while this phone's seat can draw on a Canvas) folds the
// bar to ONE line — icon, the line cut short, 下一步 — so it never covers the drawing sheet. A ▴
// button opens it for this turn; the next time `compact` switches on it folds again.
// ============================================================

import { el } from '../dom.js?v=20261003090241';

/** Why the line did not come out (app.state.narration.reason) → what the host is told. */
const STALL_TEXT = {
  muted: '🔇 部手機冇聲（音量 0？）— 調大聲，或者你讀出嚟：',
  timeout: '⚠️ 讀咗好耐都未讀完 — 你幫手讀出嚟：',
  unsupported: '📢 呢部機唔識讀出聲 — 你讀出嚟：',
};
const STALL_DEFAULT = '⚠️ 部手機冇讀出聲 — 麻煩你讀出嚟：';
const NEXT_COOLDOWN_MS = 1500;

const MODES = [
  ['voice', '🔊 語音'],
  ['read', '📜 讀稿'],
  ['silent', '🔇 靜音'],
];

export function NarratorBar(props = {}) {
  let p = props;
  let lastCueId;
  let wasCompact = false;
  let unfolded = false;          // the host opened a compact bar for this drawing turn

  const icon = el('span', { class: 'c-narratorbar-icon', 'aria-hidden': 'true' });
  const textEl = el('div', { class: 'c-narratorbar-text' });
  const stallEl = el('div', { class: 'c-narratorbar-stall', text: '⚠️ 部手機冇讀出聲 — 麻煩你讀出嚟：' });
  const replayBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': '再讀一次' }, '🔁 重講');
  const skipBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': '跳過呢句' }, '⏭ 跳過');
  const pauseBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' });
  const nextBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, '下一步 ⏭');
  const foldBtn = el('button', { class: 'c-narratorbar-fold', type: 'button' });
  const actions = el('div', { class: 'c-narratorbar-actions' }, replayBtn, skipBtn, pauseBtn, nextBtn);
  const modeRow = el('div', { class: 'c-narratorbar-modes', role: 'group', 'aria-label': '旁白方式' },
    MODES.map(([m, label]) => el('button', {
      class: 'c-narratorbar-mode', type: 'button', 'data-mode': m,
      onclick: () => { if (p.mode !== m) p.onMode?.(m); },
    }, label)));
  const root = el('div', { class: 'c-narratorbar' },
    stallEl,
    el('div', { class: 'c-narratorbar-line' }, icon, textEl, foldBtn),
    actions, modeRow);

  foldBtn.addEventListener('click', () => { unfolded = !unfolded; api.update(p); });
  replayBtn.addEventListener('click', () => p.onReplay?.());
  skipBtn.addEventListener('click', () => p.onSkip?.());
  let nextAt = -Infinity;
  let coolTimer = null;
  nextBtn.addEventListener('click', () => {
    const now = Date.now();
    if (now - nextAt < NEXT_COOLDOWN_MS) return;          // a double tap: the first one already moved the table on
    nextAt = now;
    root.classList.add('cooling');
    clearTimeout(coolTimer);
    coolTimer = setTimeout(() => root.classList.remove('cooling'), NEXT_COOLDOWN_MS);
    p.onNext?.();
  });
  pauseBtn.addEventListener('click', () => p.onPause?.());

  const api = {
    el: root,
    update(next = {}) {
      p = next;
      const mode = p.mode ?? 'voice';
      root.hidden = !!p.hidden;
      root.dataset.mode = mode;
      const stalled = !!p.stalled && mode === 'voice';
      const line = (stalled && p.line) || p.cue?.text || '';
      root.classList.toggle('has-cue', !!line);
      root.classList.toggle('is-stalled', stalled);
      stallEl.hidden = !stalled;
      stallEl.textContent = STALL_TEXT[p.reason] ?? STALL_DEFAULT;

      icon.textContent = stalled ? '📢' : mode === 'voice' ? '🔊' : mode === 'read' ? '📜' : '💬';
      textEl.textContent = line || '（暫時冇旁白）';
      textEl.classList.toggle('is-empty', !line);

      replayBtn.hidden = mode !== 'voice' || !line || !p.onReplay;
      skipBtn.hidden = !stalled || !p.onSkip;
      pauseBtn.hidden = !p.onPause || stalled;
      pauseBtn.textContent = p.paused ? '▶ 繼續' : '⏸ 暫停';
      nextBtn.hidden = !p.onNext;
      const big = mode === 'read' || stalled;
      nextBtn.classList.toggle('btn-lg', big);
      nextBtn.classList.toggle('btn-sm', !big);
      nextBtn.disabled = !line && mode !== 'read';

      for (const b of modeRow.children) b.classList.toggle('on', b.dataset.mode === mode);
      modeRow.hidden = !p.onMode;

      // compact while this phone draws: one line, 下一步 only (unless the host unfolded it this turn)
      if (p.compact && !wasCompact) unfolded = false;
      wasCompact = !!p.compact;
      const compact = !!p.compact && !unfolded;
      root.classList.toggle('is-compact', compact);
      foldBtn.hidden = !p.compact;
      foldBtn.textContent = compact ? '▴' : '▾';
      foldBtn.setAttribute('aria-label', compact ? '打開旁白' : '收細旁白');
      if (compact) {
        replayBtn.hidden = true;
        skipBtn.hidden = true;
        pauseBtn.hidden = true;
        modeRow.hidden = true;
        stallEl.hidden = true;                 // the 📢 icon still says it; ▴ shows the whole story
        nextBtn.classList.remove('btn-lg');
        nextBtn.classList.add('btn-sm');
      }

      // a new line gets a little entrance so a read-aloud narrator notices it
      if (p.cue?.id !== lastCueId) {
        lastCueId = p.cue?.id;
        root.classList.remove('fresh');
        void root.offsetWidth;
        if (p.cue) root.classList.add('fresh');
      }
    },
    destroy() { clearTimeout(coolTimer); root.remove(); },
  };

  api.update(p);
  return api;
}

export default NarratorBar;
