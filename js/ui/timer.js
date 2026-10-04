// ============================================================
// timer.js — the table timer (BACKLOG T1), usable in every game and in the
// lobby, whether or not the game has a timer of its own.
//
// The countdown is ROOM state (app.state.room.timer = { endsAt, label, paused,
// remainingMs }, host clock), so every phone shows the same seconds; this
// module only draws it and makes noise:
//
//   ⏱️ button   host only, in the lobby and play top bars → the timer sheet
//               (30 秒 / 1 / 3 / 5 分鐘 / 自訂, then ⏸ / +30 秒 / ⏹ / 枱中大時鐘)
//   strip      every phone, while a timer exists; tap → 枱中大時鐘
//   big clock  full-screen digits for a phone lying in the middle of the table
//   sounds     'warn' at 10 s, a soft 'tick' in the last 5 s, 'alarm' at zero (once per
//              timer id; a timer that rang lingers 60 s as 「時間到」, then the core clears it) —
//              all through core/sfx (G13), so the user's mute is obeyed; the
//              warn and alarm ring through the night suppression on purpose
//              (every phone rings at once, so it gives nothing away)
//   flash      at zero, a few amber pulses over the whole screen (never white,
//              no vibration: iPhone has none). Tap to dismiss.
//
// Honest limit (shown in the sheet): the alarm only rings while the app is open.
// ============================================================

import { el, fmtClock, toast } from './dom.js?v=20261004224709';
import { sfx, primeAudio } from '../core/sfx.js?v=20261004224709';
import { TIMER_PRESETS, timerLeftMs, timerCue, clampTimerSec, timerStep, fmtDuration } from './logic.js?v=20261004224709';
import { openSheet } from './sheet.js?v=20261004224709';

const TICK_MS = 200;
const LATE_ALARM_MS = 4000;    // a phone that wakes up long after zero shows 時間到 but does not ring
const FLASH_MS = 2600;

export function createTableTimer(sh) {
  const { app } = sh;
  const buttons = new Set();
  const strips = new Set();
  let loop = null;
  let prevMs = null;
  let prevTimer = null;
  let sheet = null;
  let big = null;
  let flashEl = null;
  let customSec = 120;
  let customLabel = '';

  const ctl = () => app.hostCtl?.timer ?? null;
  const timerOf = (st = app.state) => {
    const t = st?.room?.timer;
    return t && typeof t === 'object' ? t : null;
  };
  const nowMs = () => { try { return app.clock?.now?.() ?? Date.now(); } catch { return Date.now(); } };
  const available = () => !!ctl()?.start;
  const canControl = (st = app.state) => !!st?.isHost && available();
  const report = (res) => {
    if (res && res.ok === false && res.message) toast(res.message, 2200);
    return res;
  };

  // ---------- host actions ----------
  const act = {
    start(sec, label = '') {
      primeAudio();   // inside the host's tap: iOS unlocks Web Audio here
      report(ctl()?.start?.(clampTimerSec(sec) * 1000, String(label || '').trim().slice(0, 12)));
      sfx('tap');
    },
    toggle() {
      const t = timerOf();
      if (!t) return;
      report(t.paused ? ctl()?.resume?.() : ctl()?.pause?.());
    },
    add30() { report(ctl()?.add?.(30_000)); sfx('tap'); },
    stop() { report(ctl()?.stop?.()); },
  };

  // ---------- painting ----------
  function stateOf(ms, t) {
    if (!t) return 'none';
    if (ms <= 0) return 'done';
    if (t.paused) return 'paused';
    if (ms <= 10_000) return 'urgent';
    return 'run';
  }

  function paintStrip(strip, ms, t) {
    strip.hidden = !t;
    if (!t) return;
    const s = stateOf(ms, t);
    strip.dataset.state = s;
    strip.querySelector('.ts-label').textContent = t.label ? `⏱️ ${t.label}` : '⏱️ 計時';
    strip.querySelector('.ts-clock').textContent = s === 'done' ? '⏰ 時間到' : fmtClock(ms / 1000);
    strip.querySelector('.ts-note').textContent = s === 'paused' ? '暫停緊' : '';
  }

  function paintButton(b, st) {
    b.hidden = !canControl(st);
    b.classList.toggle('on', !!timerOf(st));
  }

  function tick() {
    const st = app.state;
    const t = timerOf(st);
    const ms = t ? timerLeftMs(t, nowMs()) : null;

    // a new countdown (its id changes) starts from scratch: its first reading is history
    if (t && prevTimer && t.id !== undefined && t.id !== prevTimer.id) prevMs = null;
    // sounds and the flash: only on a downward crossing of this phone's own reading
    const cue = timerCue(prevMs, ms);
    if (cue === 'alarm') {
      const endedAt = Number(t?.endsAt);
      const late = Number.isFinite(endedAt) ? nowMs() - endedAt : 0;
      if (late < LATE_ALARM_MS) { sfx('alarm', { force: true }); flash(); }
    } else if (cue === 'warn') sfx('warn', { force: true });
    else if (cue === 'tick') sfx('tick');
    prevMs = ms;
    prevTimer = t;

    for (const s of strips) paintStrip(s, ms ?? 0, t);
    paintBig(ms ?? 0, t, st);
    if (sheet?.isOpen()) {
      sheet.refresh();   // only rebuilds when the controls changed (the live digits are not part of the markup)
      const c = sheet.panel.querySelector('.tt-live');
      if (c) c.textContent = t ? (ms <= 0 ? '⏰ 時間到' : fmtClock(ms / 1000)) : '';
    }
    if (!t && !big && loop !== null) { clearInterval(loop); loop = null; }
  }

  function ensureLoop() {
    if (loop === null) loop = setInterval(tick, TICK_MS);
  }

  function flash() {
    if (flashEl) flashEl.remove();
    const node = el('div', { class: 'timer-flash', role: 'alert', onclick: () => node.remove() },
      el('div', { class: 'timer-flash-text' }, el('div', { text: '⏰' }), el('div', { text: '時間到！' })));
    flashEl = node;
    document.body.append(node);
    setTimeout(() => { node.remove(); if (flashEl === node) flashEl = null; }, FLASH_MS);
  }

  // ---------- the sheet (host) ----------
  function presetRow() {
    return el('div', { class: 'tt-presets' }, TIMER_PRESETS.map((p) => el('button', {
      class: 'btn btn-ghost', type: 'button', onclick: () => { act.start(p.sec, customLabel); },
    }, p.label)));
  }

  function customRow() {
    const out = el('output', { text: fmtDuration(customSec) });
    const bump = (dir) => {
      customSec = clampTimerSec(customSec + dir * timerStep(dir < 0 ? customSec - 1 : customSec));
      out.textContent = fmtDuration(customSec);
      sfx('tap');
    };
    const label = el('input', {
      type: 'text', maxlength: '12', placeholder: '用嚟做咩（可以唔填）', value: customLabel,
      enterkeyhint: 'done', 'aria-label': '計時用途', autocomplete: 'off',
      oninput: (e) => { customLabel = e.target.value; },
    });
    return el('div', { class: 'tt-custom' },
      el('span', { class: 'field-label', text: '自訂' }),
      el('div', { class: 'tt-custom-row' },
        el('div', { class: 'stepper' },
          el('button', { class: 'step-btn', type: 'button', 'aria-label': '減少', onclick: () => bump(-1) }, '−'),
          out,
          el('button', { class: 'step-btn', type: 'button', 'aria-label': '增加', onclick: () => bump(1) }, '+')),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => act.start(customSec, customLabel) }, '開始')),
      label);
  }

  function runningRows(t) {
    return [
      el('div', { class: 'tt-now' },
        el('div', { class: 'tt-now-label', text: t.label ? `⏱️ ${t.label}` : '⏱️ 計緊時' }),
        el('div', { class: 'tt-live' })),
      el('div', { class: 'tt-controls' + (t.done ? ' two' : '') },
        t.done ? null : el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => act.toggle() }, t.paused ? '▶ 繼續' : '⏸ 暫停'),
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => act.add30() }, '＋30 秒'),
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => act.stop() }, t.done ? '✓ 收起' : '⏹ 停')),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => { closeSheet(); openBig(); } }, '🕰️ 枱中大時鐘'),
      el('div', { class: 'sec', text: '重新計' }),
    ];
  }

  function openTimerSheet() {
    if (sheet?.isOpen()) return;
    sheet = openSheet({
      title: '⏱️ 計時',
      cls: 'timer-sheet',
      render: () => {
        const t = timerOf();
        return [el('div', { class: 'sheet-list' },
          ...(t ? runningRows(t) : []),
          presetRow(),
          customRow(),
          t ? null : el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { closeSheet(); openBig(); } }, '🕰️ 枱中大時鐘'),
          el('p', { class: 'hint tt-help', text: '每部手機都會同步倒數。10 秒前「嘟嘟」提你，夠鐘全部手機一齊響 + 閃。要開住呢個 app 先會響（玩緊會保持唔熄屏）。' }))];
      },
      onClose: () => { sheet = null; },
    });
    ensureLoop();
    tick();
  }
  const closeSheet = () => { sheet?.close(); sheet = null; };

  // ---------- 枱中大時鐘 ----------
  function openBig() {
    if (big) return;
    const clock = el('div', { class: 'bc-clock' });
    const label = el('div', { class: 'bc-label' });
    const note = el('div', { class: 'bc-note' });
    const tools = el('div', { class: 'bc-tools' });
    const bar = el('div', { class: 'bc-bar' }, el('i'));
    const node = el('div', { class: 'bigclock', role: 'timer' },
      el('button', { class: 'icon-btn bc-close', type: 'button', 'aria-label': '閂咗佢', onclick: closeBig }, '✕'),
      label, clock, bar, note, tools);
    document.body.append(node);
    big = { node, clock, label, note, tools, bar: bar.firstChild, toolsKey: null, total: null };
    requestAnimationFrame(() => node.classList.add('in'));
    ensureLoop();
    tick();
  }

  function closeBig() {
    if (!big) return;
    const node = big.node;
    big = null;
    node.classList.remove('in');
    setTimeout(() => node.remove(), 200);
  }

  function paintBig(ms, t, st) {
    if (!big) return;
    const s = stateOf(ms, t);
    big.node.dataset.state = s;
    big.label.textContent = t ? (t.label || '計時') : '未有計時';
    big.clock.textContent = !t ? '–:––' : s === 'done' ? '0:00' : fmtClock(ms / 1000);
    big.note.textContent = s === 'paused' ? '⏸ 暫停緊' : s === 'done' ? '⏰ 時間到！' : !t
      ? (canControl(st) ? '揀個時間開始' : '等主持開計時')
      : '部手機放枱中間，大家都睇到';
    // the bar shrinks from the largest time seen for this timer
    if (!t) big.total = null;
    else if (big.total == null || ms > big.total) big.total = Math.max(ms, 1);
    big.bar.style.transform = `scaleX(${t && big.total ? Math.max(0, Math.min(1, ms / big.total)) : 0})`;

    const key = `${canControl(st)}|${!!t}|${!!t?.paused}|${!!t?.done}`;
    if (key === big.toolsKey) return;
    big.toolsKey = key;
    if (!canControl(st)) { big.tools.replaceChildren(); return; }
    big.tools.replaceChildren(...(t
      ? [
        t.done ? null : el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => act.toggle() }, t.paused ? '▶ 繼續' : '⏸ 暫停'),
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => act.add30() }, '＋30 秒'),
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => act.stop() }, t.done ? '✓ 收起' : '⏹ 停'),
      ].filter(Boolean)
      : TIMER_PRESETS.map((p) => el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => act.start(p.sec) }, p.label))));
  }

  // ---------- pieces the screens embed ----------
  return {
    /** ⏱️ for a top bar. Hidden unless this phone is the host and the core has a timer. */
    button() {
      const b = el('button', { class: 'icon-btn timer-btn', type: 'button', 'aria-label': '計時', onclick: openTimerSheet }, '⏱️');
      buttons.add(b);
      paintButton(b, app.state);
      return b;
    },
    /** The synced countdown strip; tap → 枱中大時鐘. Hidden while there is no timer. */
    strip() {
      const s = el('button', { class: 'timer-strip', type: 'button', 'aria-label': '睇大時鐘', onclick: openBig },
        el('span', { class: 'ts-label' }), el('span', { class: 'ts-note' }), el('span', { class: 'ts-clock' }));
      s.hidden = true;
      strips.add(s);
      tick();
      return s;
    },
    open: openTimerSheet,
    openBig,
    available,
    /** The router dropped a screen: forget its pieces. */
    forgetScreen() { buttons.clear(); strips.clear(); },
    update(st) {
      for (const b of buttons) paintButton(b, st);
      if (timerOf(st) || big) ensureLoop();
      if (sheet && !canControl(st)) closeSheet();
      tick();
    },
    /** Leaving the room: nothing may keep ringing or covering the screen. */
    reset() {
      closeSheet();
      closeBig();
      flashEl?.remove();
      flashEl = null;
      prevMs = null;
      prevTimer = null;
    },
  };
}
