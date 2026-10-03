// ============================================================
// PassGate — the full-screen 「交俾 阿明 ・ 其他人唔好望」 card that sits in
// front of a shared phone until the right person takes it and taps.
//
//   PassGate.show({ title, subtitle, button? }) → Promise<void>
//       resolves when the receiver taps (or when hide() / another show() replaces it)
//   PassGate.hide()
//   PassGate.isOpen()
//
// The gate is opaque: nothing of the screen behind it can be read. It carries
// no secret itself — for eyes-closed steps the caller passes an anonymous
// title ('預言家請拎起部手機') so the gate never announces who holds a role.
// A caller that can be re-entered should keep its own token to tell whether a
// resolved promise is still the gate it asked for.
// ============================================================

import { el, lockScroll, unlockScroll } from '../dom.js?v=20261003090241';
import { sfx } from '../../core/sfx.js?v=20261003090241';

let current = null;

function show({ title = '交俾下一位', subtitle = '其他人唔好望', button = '準備好喇，㩒一下' } = {}) {
  hide();   // never stack two gates

  return new Promise((resolve) => {
    const btn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, button);
    const root = el('div', { class: 'c-passgate', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'c-passgate-card' },
        el('div', { class: 'c-passgate-lock', text: '🔒' }),
        el('h2', { text: title }),
        el('p', { text: subtitle }),
        btn));

    const done = () => {
      if (!current || current.root !== root) return;
      sfx('flip');
      hide();
    };
    btn.addEventListener('click', done);

    document.body.append(root);
    lockScroll();
    requestAnimationFrame(() => root.classList.add('in'));
    btn.focus({ preventScroll: true });
    current = { root, resolve };
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

export const PassGate = { show, hide, isOpen: () => !!current };
export default PassGate;
