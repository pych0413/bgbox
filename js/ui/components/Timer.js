// ============================================================
// Timer — big countdown to a host-ms deadline, with beeps at the warnings
// and at zero.
//
//   Timer({ deadline, now: () => ms, label, paused, warnAt: [60, 10] })
//     → { el, update(props), destroy() }
//
// Optional extras: `onExtend()` (shows a +60 秒 button) and `onTogglePause()`
// (shows a pause/resume button) — for the host, when a game wants them.
//
// `deadline` is in host time and `now()` should be the host-synced clock
// (api.now). While `paused` the display freezes at the value it had when the
// pause began: the session shifts `deadline` on resume, so nothing else is
// needed. A warning fires when the remaining time CROSSES its threshold, so
// jumping the deadline (+60 s, a new phase) neither replays old warnings
// nor stays silent when the clock runs down again.
//
// The beeps are sfx('warn') at each warning, sfx('zero') at zero and a soft
// sfx('tap') on each of the last five seconds, so they obey the sound toggle and
// the shell's night-time mute like every other sound.
// ============================================================

import { el, fmtClock } from '../dom.js?v=20261004005209';
import { sfx } from '../../core/sfx.js?v=20261004005209';

export function Timer(props = {}) {
  let p = { warnAt: [60, 10], ...props };
  let frozen = null;          // remaining seconds captured when a pause began
  let lastRemaining = null;   // for crossing detection
  let wasPaused = false;
  let timerId = null;

  const clock = el('div', { class: 'c-timer-clock' });
  const labelEl = el('div', { class: 'c-timer-label' });
  const pauseTag = el('div', { class: 'c-timer-paused', text: '⏸ 暫停緊' });
  const extendBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '＋60 秒');
  const pauseBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' });
  const tools = el('div', { class: 'c-timer-tools' }, pauseBtn, extendBtn);
  const root = el('div', { class: 'c-timer', role: 'timer' }, labelEl, clock, pauseTag, tools);

  extendBtn.addEventListener('click', () => p.onExtend?.());
  pauseBtn.addEventListener('click', () => p.onTogglePause?.());

  const nowMs = () => (typeof p.now === 'function' ? p.now() : Date.now());

  function remainingSec() {
    if (p.deadline == null) return null;
    if (p.paused && frozen != null) return frozen;
    return Math.max(0, (p.deadline - nowMs()) / 1000);
  }

  function warnings(rem) {
    const prev = lastRemaining;
    lastRemaining = rem;
    if (rem == null || prev == null || p.paused) return;   // the first reading is history
    if (prev > 0 && rem <= 0) { sfx('zero'); return; }
    for (const t of p.warnAt ?? []) {
      if (prev > t && rem <= t) { sfx('warn'); return; }
    }
    // a soft tick on each of the last five seconds
    if (rem > 0 && rem <= 5 && Math.ceil(prev) !== Math.ceil(rem)) sfx('tap');
  }

  function paint() {
    const rem = remainingSec();
    warnings(rem);
    clock.textContent = rem == null ? '–:––' : fmtClock(rem);
    const marks = p.warnAt?.length ? p.warnAt : [10];
    const first = Math.max(...marks);
    const last = Math.min(...marks);
    root.classList.toggle('warn', rem != null && rem > last && rem <= first);
    root.classList.toggle('urgent', rem != null && rem > 0 && rem <= last);
    root.classList.toggle('done', rem === 0);
    root.classList.toggle('paused', !!p.paused);
  }

  function start() {
    stop();
    timerId = setInterval(paint, 250);
  }
  function stop() {
    if (timerId != null) { clearInterval(timerId); timerId = null; }
  }

  const api = {
    el: root,
    update(next = {}) {
      p = { warnAt: [60, 10], ...next };
      if (p.paused && !wasPaused) {
        frozen = p.deadline == null ? null : Math.max(0, (p.deadline - nowMs()) / 1000);
      }
      if (!p.paused) frozen = null;
      wasPaused = !!p.paused;

      labelEl.textContent = p.label ?? '';
      labelEl.hidden = !p.label;
      pauseTag.hidden = !p.paused;
      extendBtn.hidden = !p.onExtend;
      pauseBtn.hidden = !p.onTogglePause;
      pauseBtn.textContent = p.paused ? '▶ 繼續' : '⏸ 暫停';
      tools.hidden = !p.onExtend && !p.onTogglePause;
      paint();
    },
    destroy() { stop(); root.remove(); },
  };

  api.update(p);
  start();
  return api;
}

export default Timer;
