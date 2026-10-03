// ============================================================
// DiceCup — secret dice under an upside-down cup.
//
//   DiceCup({ dice: [n] | null, sides, rollSeq, canRoll, lockedRoll,
//             onRoll, onLock, shakeToRoll: true })
//     → { el, update(props), destroy(), cover }
//
// Hold the cup to peek at your own dice; 🎲 rolls; 🔓 pins the roll so
// nobody can re-roll it (the cup still lifts — it is your own number).
//
// Behaviour carried over from v1:
//  - the roll chime is keyed on `rollSeq` (a per-player roll counter that the
//    engine bumps on every roll), NOT on the dice values: a re-deal pushes the
//    same dice again and must stay silent, while a re-roll that lands on the
//    same number is still a real roll. The first update is history, not news.
//  - shake-to-roll reads the accelerometer. On iOS the permission prompt only
//    appears from inside a tap, so requestMotionPermission() must be the FIRST
//    await in the button handler — nothing may be awaited before it.
//  - shaking a locked cup says so, but not once per jolt (2.5 s throttle).
//
// Several cups can exist at once (shared phone). They share ONE detector, and
// a shake only rolls the cup that is actually on screen.
// ============================================================

import { el, dieFace, fromHTML, restartAnim, toast, uniqueId } from '../dom.js?v=1';
import { sfx } from '../../core/sfx.js?v=1';
import { lsGet, lsSet } from '../../core/util.js?v=1';
import {
  ShakeDetector, motionSupported, needsMotionPermission, requestMotionPermission,
} from '../../core/shake.js?v=1';
import { Cover } from './Cover.js?v=1';

// The cup is drawn upside-down: wide rim at the bottom, flat base on top.
function cupSvg() {
  const id = uniqueId('cupBody');   // unique per instance: a gradient in a display:none SVG renders nothing
  return fromHTML(`
    <svg class="c-cover-cup" viewBox="0 0 120 108" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0"    stop-color="#5c341a"/>
          <stop offset="0.30" stop-color="#b0702f"/>
          <stop offset="0.58" stop-color="#8a5223"/>
          <stop offset="1"    stop-color="#4e2c15"/>
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="97" rx="40" ry="7" fill="rgba(0,0,0,.25)"/>
      <path d="M42 16 h36 l14 72 h-64 z" fill="url(#${id})"/>
      <ellipse cx="60" cy="16" rx="18" ry="6" fill="#c9853f"/>
      <ellipse cx="60" cy="16" rx="11" ry="3.4" fill="#7a4720"/>
      <rect x="33" y="58" width="54" height="7" fill="rgba(0,0,0,.18)"/>
      <ellipse cx="60" cy="90" rx="32" ry="9" fill="#341d0e"/>
      <ellipse cx="60" cy="87" rx="32" ry="9" fill="#b0702f"/>
    </svg>`);
}

// ---------- shake hub: one detector for every cup on the page ----------
const cups = new Set();
const hub = {
  shakeOn: lsGet('ct:shake', true),
  perm: lsGet('ct:motionPerm', 'unknown'),   // iOS 13+ only; elsewhere the sensor is just there
  stalled: false,                            // armed, but no readings are coming through
  detector: null,
};

function visible(cup) {
  const n = cup.el;
  return n.isConnected && n.getClientRects().length > 0;
}

function ensureDetector() {
  hub.detector ??= new ShakeDetector({
    // Tuned by feel: a phone set down hard is one jolt, a shake is many.
    threshold: 10,
    hits: 3,
    onShake() {
      const target = [...cups].find((c) => c.wantsShake() && visible(c));
      target?.shakeRoll();
    },
    onSensorOk() {
      if (!hub.stalled) return;
      hub.stalled = false;
      syncHub();
    },
    onNoSensor() {
      // Armed but nothing arriving. On iOS that means a remembered grant has
      // lapsed, not that the hardware is missing — so send them back to the
      // button rather than telling them their phone has no accelerometer.
      hub.stalled = true;
      if (needsMotionPermission()) { hub.perm = 'unknown'; lsSet('ct:motionPerm', 'unknown'); }
      syncHub();
    },
  });
  return hub.detector;
}

function armed() {
  return hub.shakeOn && (hub.perm === 'granted' || !needsMotionPermission());
}

/** Start/stop the shared detector, then let every cup repaint its shake controls. */
function syncHub() {
  const wanted = [...cups].some((c) => c.wantsShake());
  const det = ensureDetector();
  if (motionSupported() && hub.perm !== 'denied' && armed() && wanted) det.start();
  else det.stop();
  for (const c of cups) c.paintShake();
}

async function onShakeButton() {
  hub.stalled = false;   // they are retrying; give it a clean shot
  // iOS only grants this from inside the tap itself, so the request must be
  // the very first await in this handler — do not put anything before it.
  if (needsMotionPermission() && hub.perm !== 'granted') {
    const res = await requestMotionPermission();
    hub.perm = res;
    lsSet('ct:motionPerm', res);
    if (res !== 'granted') { hub.shakeOn = false; lsSet('ct:shake', false); syncHub(); return; }
    hub.shakeOn = true;
  } else {
    hub.shakeOn = !hub.shakeOn;
  }
  lsSet('ct:shake', hub.shakeOn);
  syncHub();
}

// ---------- the component ----------
export function DiceCup(props = {}) {
  let p = { sides: 6, shakeToRoll: true, ...props };
  let heardSeq = null;        // null until the first update: history is not news
  let lastLocalRoll = 0;      // so a roll is not announced twice on this phone
  let lastLockNudge = 0;
  let shownDice = Symbol('dice');

  const row = el('div', { class: 'dice-row' });
  const sum = el('div', { class: 'dice-sum' });
  const frontNode = el('div', { class: 'c-dicecup-front' }, row, sum);

  const cupArt = cupSvg();
  const cover = Cover({ lockMode: 'none', openSound: 'lift', backArt: cupArt, backLabel: '㩒住掀起' });
  const hintEl = el('p', { class: 'c-dicecup-hint' });
  const rollBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, '🎲 搖我嘅骰');
  const lockBtn = el('button', { class: 'btn btn-ghost', type: 'button' });
  const buttons = el('div', { class: 'grid2 tight' }, rollBtn, lockBtn);
  const shakeBtn = el('button', { class: 'btn btn-ghost btn-shake', type: 'button' });
  const shakeNote = el('p', { class: 'shake-note' });
  const root = el('div', { class: 'c-dicecup' }, hintEl, cover.el, buttons, shakeBtn, shakeNote);

  /** Shaking a locked cup should say so, but not once per jolt. */
  function nudgeLocked() {
    const now = Date.now();
    if (now - lastLockNudge < 2500) return;
    lastLockNudge = now;
    sfx('deny');
    toast('點數鎖咗，搖極都唔會變');
    restartAnim(cover.el, 'denied');
  }

  function doRoll() {
    if (p.lockedRoll) return nudgeLocked();
    if (!p.canRoll) return;
    lastLocalRoll = Date.now();
    cover.shake();
    sfx('roll');
    p.onRoll?.();
  }

  rollBtn.addEventListener('click', doRoll);
  lockBtn.addEventListener('click', () => {
    if (p.lockedRoll || !p.dice?.length) return;
    sfx('lock');
    p.onLock?.();
  });
  shakeBtn.addEventListener('click', onShakeButton);

  function paintDice() {
    const key = JSON.stringify([p.dice, p.sides]);
    if (key === shownDice) return;
    shownDice = key;
    row.replaceChildren();
    if (p.dice?.length) {
      for (const v of p.dice) row.append(dieFace(v, p.sides));
      sum.textContent = p.dice.length > 1 ? `總和 ${p.dice.reduce((a, b) => a + b, 0)}` : '';
    } else {
      row.append(el('div', { class: 'die', text: '–' }));
      sum.textContent = '未搖過';
    }
  }

  function paintShake() {
    const show = p.shakeToRoll !== false && !!p.canRoll && motionSupported();
    shakeBtn.hidden = !show;
    shakeNote.hidden = !show;
    if (!show) return;

    shakeNote.classList.remove('warn-text');
    shakeBtn.classList.remove('btn-locked');
    const warn = (text) => { shakeNote.textContent = text; shakeNote.classList.add('warn-text'); };

    if (hub.perm === 'denied') {
      shakeBtn.textContent = '📳 iPhone 拒絕咗動作權限';
      shakeBtn.disabled = true;
      warn('Safari 記住咗個「唔准」。喺網址列㩒「ㄅA」→ 網站設定 開返「動作與方向」，或者清除本站資料再 refresh。');
      return;
    }
    shakeBtn.disabled = false;

    if (armed()) {
      shakeBtn.textContent = '📳 搖骰已開 — 㩒一下熄';
      shakeBtn.classList.add('btn-locked');
      if (hub.stalled) warn('收唔到動作數據 — 部機可能冇感應器，用上面粒掣搖啦。');
      else shakeNote.textContent = p.lockedRoll ? '點數鎖咗，搖極都唔會變' : '搖下部手機就當搖骰';
    } else {
      shakeBtn.textContent = '📳 開啟搖骰';
      if (hub.stalled) {
        warn(needsMotionPermission()
          ? 'iPhone 未送緊動作數據 — 㩒一下重新批准。'
          : '部機好似冇動作感應器 — 用上面粒掣搖啦。');
      } else {
        shakeNote.textContent = needsMotionPermission() && hub.perm !== 'granted'
          ? '㩒一下，iPhone 會問你畀唔畀動作權限'
          : '搖部機擲骰（而家熄咗）';
      }
    }
  }

  /** Dice that arrived because somebody else rolled for us. */
  function chimeForSeq() {
    const seq = p.rollSeq ?? 0;
    const prev = heardSeq;
    heardSeq = seq;
    if (prev === null || seq === prev || !p.dice?.length) return;
    if (Date.now() - lastLocalRoll < 1200) return;   // this phone already played it
    cover.shake();
    sfx('roll');
  }

  const api = {
    el: root,
    cover,
    // hub hooks
    wantsShake: () => p.shakeToRoll !== false && !!p.canRoll,
    shakeRoll: doRoll,
    paintShake,

    update(next = {}) {
      p = { sides: 6, shakeToRoll: true, ...next };
      chimeForSeq();
      paintDice();

      cover.update({
        front: frontNode,
        backArt: cupArt,
        backLabel: '㩒住掀起',
        lockMode: 'none',
        locked: !!p.lockedRoll,
        openSound: 'lift',
        ariaLabel: '㩒住睇骰仔',
      });

      hintEl.textContent = p.lockedRoll ? '㩒住睇得，但搖唔到新骰' : '㩒住掀起個盅';
      rollBtn.hidden = !p.canRoll;
      rollBtn.disabled = !!p.lockedRoll;
      lockBtn.textContent = p.lockedRoll ? '🔒 已鎖，主持解鎖' : '🔓 鎖定點數';
      lockBtn.classList.toggle('btn-locked', !!p.lockedRoll);
      lockBtn.disabled = !!p.lockedRoll || !p.dice?.length;
      lockBtn.hidden = !p.onLock;

      syncHub();
    },
    destroy() {
      cups.delete(api);
      syncHub();
      cover.destroy();
      root.remove();
    },
  };

  cups.add(api);
  api.update(p);
  return api;
}

export default DiceCup;
