// ============================================================
// Canvas — batch 2 (shared drawing board for 你畫我猜 / 假畫家).
//
//   Canvas({ mode: 'draw' | 'view', ink, color, canDraw, oneStroke, onInk(payload) })
//     → { el, update(props), destroy() }
//
// This is a placeholder: it renders a "coming soon" box with the same
// footprint (fixed aspect ratio) so game UIs can already mount it. The real
// component (DESIGN §11) replaces this file without changing the props.
// ============================================================

import { el } from '../dom.js?v=20261003075532';

export function Canvas(props = {}) {
  const note = el('div', { class: 'c-canvas-note' },
    el('div', { class: 'c-canvas-emoji', text: '🎨' }),
    el('strong', { text: '畫板第二批先有' }),
    el('span', { class: 'hint', text: 'batch 2' }));
  const root = el('div', { class: 'c-canvas', role: 'img', 'aria-label': '畫板（即將推出）' }, note);

  const api = {
    el: root,
    update(next = {}) {
      root.dataset.mode = next.mode ?? 'view';
    },
    destroy() { root.remove(); },
  };
  api.update(props);
  return api;
}

export default Canvas;
