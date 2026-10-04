// ============================================================
// PassGate — the full-screen 「交俾 阿明 ・ 其他人唔好望」 card that sits in
// front of a shared phone until the right person takes it and taps.
//
//   PassGate.show({ title, subtitle, button?, kind?, icon?, extra? }) → Promise<void>
//       resolves when the receiver taps (or when hide() / another show() replaces it)
//   PassGate.hide()
//   PassGate.isOpen()
//   PassGate.kind()      the kind on screen, or null
//
// `kind` (DESIGN §7.1; it is the `data-gate` attribute, which the playtest console reads):
//   'private' (default) — opaque, 🔒: nothing of the screen behind can be read
//   'switch'            — the same look, for a seat picked by hand
//   'anon'              — an eyes-closed step: the same card whether a seat here is called or it is a decoy
//   'public'            — a public one-person step: a light card at the bottom, the (public) screen stays
//                         visible behind a translucent layer that still swallows taps
//   'table'             — the phone goes back to the middle (擺返中間 / 天光喇): public, anyone taps it
// The backdrop is in place from the first frame; only the card fades in (#34), so no frame shows what is behind.
// `extra` is a node shown under the button (the host's 「X 唔喺度？」 row, #18).
//
// Two one-phone touches (re-run #3):
//  - after a card is TAPPED away, a transparent shield swallows every tap for SHIELD_MS (~400 ms), so a bounce or
//    a second hand on the phone never lands on the control underneath (💡, a vote button, the next gate);
//  - a bottom-anchored (public / table) card never hides the bottom of the screen: the page is not scroll-locked,
//    the backdrop lets a vertical drag through, and `body.has-gate-card` + `--gate-card-h` (the card's height)
//    pad the page while it shows, so the last row can scroll up above the card. Taps are still swallowed.
//
// The gate carries no secret itself — for eyes-closed steps the caller passes an anonymous
// title ('預言家請拎起部手機') so the gate never announces who holds a role.
// A caller that can be re-entered should keep its own token to tell whether a
// resolved promise is still the gate it asked for.
// ============================================================

import { el, lockScroll, unlockScroll } from '../dom.js?v=1';
import { sfx } from '../../core/sfx.js?v=1';

const KINDS = ['private', 'switch', 'anon', 'public', 'table'];
const PUBLIC = new Set(['public', 'table']);
const ICON = { private: '🔒', switch: '🔒', anon: '🔒', public: '👉', table: '📱' };
export const SHIELD_MS = 400;

let current = null;
let shieldUntil = 0;
let shieldEl = null;
let shieldTimer = null;

/** Swallow every tap for `ms` (a bounce after a card was tapped away). */
function shield(ms = SHIELD_MS) {
  shieldUntil = Date.now() + ms;
  if (!shieldEl || shieldEl.isConnected === false) {
    const eat = (e) => { e.preventDefault?.(); e.stopPropagation?.(); };
    shieldEl = el('div', { class: 'c-passgate-shield', 'aria-hidden': 'true' });
    for (const t of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'click']) shieldEl.addEventListener(t, eat);
    document.body.append(shieldEl);
  }
  clearTimeout(shieldTimer);
  shieldTimer = setTimeout(dropShield, ms);
}

function dropShield() {
  clearTimeout(shieldTimer);
  shieldTimer = null;
  shieldUntil = 0;
  shieldEl?.remove();
  shieldEl = null;
}

/** Pad the page under a bottom-anchored card while it shows (its measured height; a fallback before layout). */
function padFor(root, on) {
  const body = document.body;
  body.classList?.toggle('has-gate-card', on);
  if (!on) { body.style?.removeProperty?.('--gate-card-h'); return; }
  const card = root.firstElementChild;
  const h = card?.offsetHeight ?? 0;
  if (h > 0) body.style?.setProperty?.('--gate-card-h', `${Math.ceil(h)}px`);
}

function show({ title = '交俾下一位', subtitle = '其他人唔好望', button = '準備好喇，㩒一下', kind = 'private', icon = null, extra = null } = {}) {
  hide();   // never stack two gates
  const k = KINDS.includes(kind) ? kind : 'private';

  return new Promise((resolve) => {
    const btn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, button);
    const root = el('div', {
      class: 'c-passgate' + (PUBLIC.has(k) ? ' is-public' : ''),
      role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title, 'data-gate': k,
    },
    el('div', { class: 'c-passgate-card' },
      el('div', { class: 'c-passgate-lock', text: icon ?? ICON[k] }),
      el('h2', { text: title }),
      subtitle ? el('p', { text: subtitle }) : null,
      btn,
      extra ?? null));

    const done = () => {
      if (!current || current.root !== root) return;
      sfx('flip');
      hide();
      shield();
    };
    btn.addEventListener('click', done);

    const pub = PUBLIC.has(k);
    document.body.append(root);
    if (pub) padFor(root, true);
    else lockScroll();
    requestAnimationFrame(() => { root.classList.add('in'); if (pub && current?.root === root) padFor(root, true); });
    btn.focus?.({ preventScroll: true });
    current = { root, resolve, kind: k, pub };
  });
}

function hide() {
  if (!current) return;
  const { root, resolve, pub } = current;
  current = null;
  if (pub) padFor(root, false);
  else unlockScroll();
  root.remove();
  resolve();
}

export const PassGate = {
  show, hide, isOpen: () => !!current, kind: () => current?.kind ?? null,
  /** Is the post-tap shield up (taps are being swallowed)? */
  shielded: () => Date.now() < shieldUntil,
};
export default PassGate;
