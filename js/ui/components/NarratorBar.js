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
//  - voice  the phone speaks; the line is shown small, 🔁 replays it, 下一步 skips.
//  - read   a human narrator reads the big text aloud and presses 下一步.
//  - silent on-screen prompt only; steps advance on timers (下一步 still skips).
//
// The bar never speaks by itself: the app speaks cues and reports them done.
// ============================================================

import { el } from '../dom.js?v=1';

const MODES = [
  ['voice', '🔊 語音'],
  ['read', '📜 讀稿'],
  ['silent', '🔇 靜音'],
];

export function NarratorBar(props = {}) {
  let p = props;
  let lastCueId;

  const icon = el('span', { class: 'c-narratorbar-icon', 'aria-hidden': 'true' });
  const textEl = el('div', { class: 'c-narratorbar-text' });
  const replayBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': '再讀一次' }, '🔁 重講');
  const pauseBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' });
  const nextBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, '下一步 ⏭');
  const actions = el('div', { class: 'c-narratorbar-actions' }, replayBtn, pauseBtn, nextBtn);
  const modeRow = el('div', { class: 'c-narratorbar-modes', role: 'group', 'aria-label': '旁白方式' },
    MODES.map(([m, label]) => el('button', {
      class: 'c-narratorbar-mode', type: 'button', 'data-mode': m,
      onclick: () => { if (p.mode !== m) p.onMode?.(m); },
    }, label)));
  const root = el('div', { class: 'c-narratorbar' },
    el('div', { class: 'c-narratorbar-line' }, icon, textEl),
    actions, modeRow);

  replayBtn.addEventListener('click', () => p.onReplay?.());
  nextBtn.addEventListener('click', () => p.onNext?.());
  pauseBtn.addEventListener('click', () => p.onPause?.());

  const api = {
    el: root,
    update(next = {}) {
      p = next;
      const mode = p.mode ?? 'voice';
      root.hidden = !!p.hidden;
      root.dataset.mode = mode;
      root.classList.toggle('has-cue', !!p.cue);

      icon.textContent = mode === 'voice' ? '🔊' : mode === 'read' ? '📜' : '💬';
      textEl.textContent = p.cue?.text ?? '（暫時冇旁白）';
      textEl.classList.toggle('is-empty', !p.cue);

      replayBtn.hidden = mode !== 'voice' || !p.cue || !p.onReplay;
      pauseBtn.hidden = !p.onPause;
      pauseBtn.textContent = p.paused ? '▶ 繼續' : '⏸ 暫停';
      nextBtn.hidden = !p.onNext;
      nextBtn.classList.toggle('btn-lg', mode === 'read');
      nextBtn.classList.toggle('btn-sm', mode !== 'read');
      nextBtn.disabled = !p.cue && mode !== 'read';

      for (const b of modeRow.children) b.classList.toggle('on', b.dataset.mode === mode);
      modeRow.hidden = !p.onMode;

      // a new line gets a little entrance so a read-aloud narrator notices it
      if (p.cue?.id !== lastCueId) {
        lastCueId = p.cue?.id;
        root.classList.remove('fresh');
        void root.offsetWidth;
        if (p.cue) root.classList.add('fresh');
      }
    },
    destroy() { root.remove(); },
  };

  api.update(p);
  return api;
}

export default NarratorBar;
