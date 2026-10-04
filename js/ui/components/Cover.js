// ============================================================
// Cover — the 「冚住」 mechanic: hold to peek, release to cover.
//
//   Cover({ front: Node, backArt: string | Node, backLabel, lockMode, locked, onOpen(open) })
//     → { el, update(props), destroy(), close(), shake(), isOpen() }
//
// Optional extras: `openSound` (sfx name, default 'flip'; null / false / 'none' = silent), `lockedMessage`
// (toast when a locked cover refuses), `ariaLabel`.
//
// The two locks guard different things. lockMode 'peek' (a role card) means
// "nobody may open this", so a press is refused with a shake. lockMode
// 'none' + locked (a dice cup) only freezes the roll: it is still your own
// number so you can keep looking, and the lock shows as a corner badge.
//
// While closed, the front is aria-hidden and die faces in it carry no 「N 點」 label (#37); both come
// back only while the cover is held open.
//
// Hard-won iOS behaviour kept from v1:
//  - setPointerCapture can throw for pointers the browser stopped tracking;
//    it must never stop the reveal.
//  - Every cover on the page closes on visibilitychange / blur / pagehide, so
//    a card is never left face-up when the phone is put down or handed over.
// ============================================================

import { el, fromHTML, restartAnim, toast, labelDice } from '../dom.js?v=20261004005209';
import { sfx } from '../../core/sfx.js?v=20261004005209';

const covers = new Set();
let hooked = false;

/** Close every open cover on the page (hand-over, backgrounding, seat switch). */
export function closeAllCovers() {
  for (const c of covers) c.close();
}

function hookGlobals() {
  if (hooked) return;
  hooked = true;
  document.addEventListener('visibilitychange', () => { if (document.hidden) closeAllCovers(); });
  window.addEventListener('blur', closeAllCovers);
  window.addEventListener('pagehide', closeAllCovers);
}

function artNode(art) {
  if (art instanceof Node) return art;
  const s = String(art ?? '');
  if (s.trimStart().startsWith('<')) return fromHTML(s) ?? el('span');
  return el('div', { class: 'c-cover-art', text: s });
}

export function Cover(props = {}) {
  hookGlobals();
  let p = { lockMode: 'none', locked: false, backLabel: '㩒住睇', ...props };
  let open = false;
  let shownFront = null;
  let shownArt = Symbol('art');   // never equal to a real value, so the first update paints

  const artHost = el('div', { class: 'c-cover-arthost' });
  const labelEl = el('span', { class: 'c-cover-label' });
  const back = el('div', { class: 'c-cover-face c-cover-back' }, artHost, labelEl);
  const front = el('div', { class: 'c-cover-face c-cover-front' });
  const root = el('div', { class: 'c-cover', role: 'button', tabindex: '0' }, front, back);

  function deny() {
    restartAnim(root, 'denied');
    sfx('deny');
    toast(p.lockedMessage ?? '鎖咗，要先解鎖');
  }

  /**
   * #37: what is under the cover says nothing while it is closed — the front is aria-hidden and every die face
   * in it loses its 「N 點」 label; both come back only while it is held open.
   */
  function syncFront() {
    front.setAttribute('aria-hidden', open ? 'false' : 'true');
    labelDice(front, open);
  }
  // a game may swap the dice under a closed cover (a re-roll) without telling us: strip those too
  const watcher = typeof MutationObserver === 'function'
    ? new MutationObserver(() => { if (!open) labelDice(front, false); })
    : null;
  watcher?.observe(front, { childList: true, subtree: true });

  function setOpen(v) {
    if (v && p.locked && p.lockMode === 'peek') { deny(); return; }   // latched shut: refuse, and say why
    if (open === v) return;
    open = v;
    root.classList.toggle('open', v);
    syncFront();
    if (v) {
      // an explicit null / false / 'none' means silent (a night peek must make no sound)
      const sound = p.openSound === undefined ? 'flip' : p.openSound;
      if (sound && sound !== 'none') sfx(sound);
    }
    p.onOpen?.(v);
  }

  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    // Capturing keeps the peek alive if the finger slides off the card.
    // It throws for pointers the browser no longer tracks — never let that
    // stop the reveal, or the card silently refuses to open.
    try { root.setPointerCapture(e.pointerId); } catch { /* peek still works */ }
    setOpen(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    root.addEventListener(ev, () => setOpen(false));
  }
  // iOS long-press would otherwise raise a callout / selection over the card.
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  // Keyboard: hold the key, same as holding a finger down.
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) setOpen(true); }
  });
  root.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(false); }
  });
  root.addEventListener('blur', () => setOpen(false));

  const api = {
    el: root,
    update(next = {}) {
      p = { lockMode: 'none', locked: false, backLabel: '㩒住睇', ...next };

      const peekLock = p.locked && p.lockMode === 'peek';
      root.classList.toggle('locked', peekLock);
      root.classList.toggle('pinned', p.locked && !peekLock);
      root.setAttribute('aria-label', p.ariaLabel ?? p.backLabel ?? '㩒住睇');
      if (peekLock && open) setOpen(false);

      if (p.backArt !== shownArt) {
        shownArt = p.backArt;
        artHost.replaceChildren(artNode(p.backArt));
      }
      labelEl.textContent = p.backLabel ?? '';
      labelEl.hidden = !p.backLabel;

      if (p.front !== shownFront) {
        shownFront = p.front;
        front.replaceChildren(...(p.front ? [p.front] : []));
      }
      syncFront();
    },
    close() {
      if (!open) return;
      open = false;
      root.classList.remove('open');
      syncFront();
      p.onOpen?.(false);
    },
    shake() { restartAnim(root, 'shaking'); },
    isOpen: () => open,
    destroy() {
      covers.delete(api);
      watcher?.disconnect();
      root.remove();
    },
  };

  covers.add(api);
  api.update(p);
  return api;
}

export default Cover;
