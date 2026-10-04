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

let current = null;

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
    };
    btn.addEventListener('click', done);

    document.body.append(root);
    lockScroll();
    requestAnimationFrame(() => root.classList.add('in'));
    btn.focus?.({ preventScroll: true });
    current = { root, resolve, kind: k };
  });
}

function hide() {
  if (!current) return;
  const { root, resolve } = current;
  current = null;
  unlockScroll();
  root.remove();
  resolve();
}

export const PassGate = { show, hide, isOpen: () => !!current, kind: () => current?.kind ?? null };
export default PassGate;
