// ============================================================
// sheet.js — one bottom-sheet helper for the shell's own sheets (timer, 💡,
// settings, pre-flight). Same look as the play screen's ⋯ menu.
//
//   const s = openSheet({ title, cls, render: () => Node[], onClose })
//   s.refresh()   re-runs render(); the DOM is only touched when the markup
//                 changed, so a button is never swapped out from under a finger
//   s.close()     s.isOpen()   s.panel
//
// Closes on ✕, a tap on the backdrop, and Escape. Several sheets may be open
// at once (the newest is on top); each locks page scroll while it lives.
// ============================================================

import { el, lockScroll, unlockScroll } from './dom.js?v=20261003164441';

export function openSheet({ title = '', cls = '', render = () => [], onClose } = {}) {
  let open = true;
  let html = '';
  const body = el('div', { class: 'sheet-body' });
  const closeBtn = el('button', { class: 'icon-btn sm', type: 'button', 'aria-label': '閂咗佢', onclick: () => api.close() }, '✕');
  const panel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '選項' },
    el('div', { class: 'sheet-head' }, el('h3', { text: title }), closeBtn),
    body);
  const root = el('div', { class: `menu-sheet ${cls}`.trim() }, panel);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) api.close(); });
  const onKey = (e) => { if (e.key === 'Escape') api.close(); };
  document.addEventListener('keydown', onKey);

  const api = {
    el: root,
    panel,
    body,
    isOpen: () => open,
    refresh() {
      if (!open) return;
      let nodes;
      try { nodes = (render() ?? []).filter(Boolean); } catch (err) { console.error('[sheet] render failed', err); return; }
      const next = nodes.map((n) => (n instanceof Node ? (n.outerHTML ?? n.textContent) : String(n))).join('');
      if (next === html) return;
      html = next;
      body.replaceChildren(...nodes);
    },
    close() {
      if (!open) return;
      open = false;
      document.removeEventListener('keydown', onKey);
      unlockScroll();
      root.classList.remove('in');
      setTimeout(() => root.remove(), 160);
      try { onClose?.(); } catch (err) { console.error(err); }
    },
  };

  document.body.append(root);
  lockScroll();
  api.refresh();
  requestAnimationFrame(() => root.classList.add('in'));
  return api;
}

/** A row of a sheet: big ghost button. */
export const sheetBtn = (label, onclick, cls = '') =>
  el('button', { class: `btn btn-ghost ${cls}`.trim(), type: 'button', onclick }, label);

export default openSheet;
