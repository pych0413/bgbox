// ============================================================
// Timer — big countdown to a host-ms deadline, with beeps at the warnings
// and at zero.
//
//   Timer({ deadline, now: () => ms, label, paused, held?, warnAt: [60, 10] })
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
// The held clock (U10, DESIGN §7.1): while the room holds the game clock at a one-phone gate, every Timer stands
// still at `deadline - heldAt` and stays silent, with 「⏸ 等緊接手」 — the play screen tells every Timer at once
// (`setClockHold(heldAt | null)`, from the room view's `clockHeld` / `clockHeldAt`), so a game needs no code for it.
// A game may also pass `held` itself: `true` (freeze from now) or a host time (freeze there); `false` ignores the
// room's hold. On release the session moves the deadline on by the time held, so the count carries on from the
// same value. A multi-phone room never holds its clock, so there nothing changes.
//
// The beeps are sfx('warn') at each warning, sfx('zero') at zero and a soft
// sfx('tap') on each of the last five seconds, so they obey the sound toggle and
// the shell's night-time mute like every other sound.
// ============================================================

import { el, fmtClock } from '../dom.js?v=20261004224709';
import { sfx } from '../../core/sfx.js?v=20261004224709';

/** U10: the host time the room's held clock stands at (set by the play screen), or null. */
let roomHeldAt = null;

/** The play screen: the room clock is held at `at` (host ms), or not (null). Every Timer follows within 250 ms. */
export function setClockHold(at) {
  roomHeldAt = typeof at === 'number' && Number.isFinite(at) ? at : null;
}

/** The host time the room's held clock stands at, or null (for a game's own countdown: `deadline - (heldAt ?? now)`). */
export function clockHeldAt() { return roomHeldAt; }

/**
 * Which beep one repaint makes, from the seconds left at the last paint and now: 'zero' when it reaches zero, 'warn'
 * when it crosses a `warnAt` mark, 'tap' on each of the last five seconds, else null. Only crossings count, so the
 * first reading and a jump up are silent — and so is a paused or held clock (U10: never a beep behind a gate).
 */
export function timerBeep(prev, rem, warnAt = [60, 10], { paused = false, held = false } = {}) {
  if (rem == null || prev == null || paused || held) return null;
  if (prev > 0 && rem <= 0) return 'zero';
  for (const t of warnAt ?? []) {
    if (prev > t && rem <= t) return 'warn';
  }
  if (rem > 0 && rem <= 5 && Math.ceil(prev) !== Math.ceil(rem)) return 'tap';
  return null;
}

export function Timer(props = {}) {
  let p = { warnAt: [60, 10], ...props };
  let frozen = null;          // remaining seconds captured when a pause began
  let lastRemaining = null;   // for crossing detection
  let wasPaused = false;
  let ownHeldAt = null;       // `held: true` → the moment this Timer first saw it
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

  /** The host time a held clock stands at, or null while it runs. */
  function heldAt() {
    if (p.held === false) return null;
    if (typeof p.held === 'number' && Number.isFinite(p.held)) return p.held;
    if (p.held === true) return ownHeldAt ?? (ownHeldAt = nowMs());
    return roomHeldAt;
  }

  function remainingSec() {
    if (p.deadline == null) return null;
    if (p.paused && frozen != null) return frozen;
    const at = heldAt();
    return Math.max(0, (p.deadline - (at ?? nowMs())) / 1000);
  }

  function warnings(rem, quiet) {
    const prev = lastRemaining;
    lastRemaining = rem;
    const beep = timerBeep(prev, rem, p.warnAt, { paused: !!p.paused, held: quiet });
    if (beep) sfx(beep);
  }

  function paint() {
    const held = !p.paused && p.deadline != null && heldAt() !== null;
    const rem = remainingSec();
    warnings(rem, held);
    clock.textContent = rem == null ? '–:––' : fmtClock(rem);
    const marks = p.warnAt?.length ? p.warnAt : [10];
    const first = Math.max(...marks);
    const last = Math.min(...marks);
    root.classList.toggle('warn', rem != null && rem > last && rem <= first);
    root.classList.toggle('urgent', rem != null && rem > 0 && rem <= last);
    root.classList.toggle('done', rem === 0);
    root.classList.toggle('paused', !!p.paused || held);
    root.classList.toggle('held', held);
    pauseTag.hidden = !p.paused && !held;
    const tagText = p.paused ? '⏸ 暫停緊' : '⏸ 等緊接手';
    if (pauseTag.textContent !== tagText) pauseTag.textContent = tagText;
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
        const at = heldAt();
        frozen = p.deadline == null ? null : Math.max(0, (p.deadline - (at ?? nowMs())) / 1000);
      }
      if (!p.paused) frozen = null;
      wasPaused = !!p.paused;
      if (p.held !== true) ownHeldAt = null;

      labelEl.textContent = p.label ?? '';
      labelEl.hidden = !p.label;
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
