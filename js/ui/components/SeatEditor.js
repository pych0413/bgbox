// ============================================================
// SeatEditor — the lobby's seat list: reorder it to match who really sits
// where, pick colours, remove people.
//
//   SeatEditor({ players, me, isHost, onMove(pid, index), onColor(pid, color), onKick(pid, button) })
//     → { el, update(props), destroy() }
//
// Optional extras: `mySeats` ([pid], every seat on THIS device; default [me]),
// `palette` ([css colour]), `orderHint` (a string: the selected game takes turns in seat
// order — shown to everyone, emphasised, instead of the host-only default hint).
//
// Who may do what:
//   reorder         host only            (▲ ▼ buttons, or drag the ⠿ handle)
//   colour          host, or the seat's own device
//   ✕               host on anyone else's seat; any device on its own EXTRA
//                   seats (not its first). `onKick` is called either way — the
//                   caller decides between kick and removeSeat.
//
// Drag uses pointer events on the handle only (touch-action: none there), so
// the list still scrolls normally everywhere else.
// ============================================================

import { el, sig } from '../dom.js?v=20261004224709';
import { sfx } from '../../core/sfx.js?v=20261004224709';

const DEFAULT_HINT = '跟返你哋真實坐位次序排，咁輪流嗰陣先唔會亂。';

export const SEAT_PALETTE = [
  '#f5c518', '#4ec97a', '#4aa3ff', '#ff7a59', '#c084fc', '#f472b6', '#2dd4bf', '#facc15',
  '#a3e635', '#fb923c', '#60a5fa', '#e879f9', '#94a3b8', '#fda4af', '#86efac', '#fde68a',
];

export function SeatEditor(props = {}) {
  let p = props;
  let shownKey = null;
  let openColorFor = null;
  let dragging = false;
  let deferred = null;

  const list = el('ul', { class: 'c-seateditor-list' });
  const hint = el('p', { class: 'c-seateditor-hint', text: DEFAULT_HINT });
  const root = el('div', { class: 'c-seateditor' }, list, hint);

  const mySeats = () => p.mySeats ?? (p.me ? [p.me] : []);
  const canMove = () => !!p.isHost && !!p.onMove;
  const canColor = (pl) => !!p.onColor && (p.isHost || mySeats().includes(pl.id));
  const canRemove = (pl) => !!p.onKick && !pl.isHost
    && ((p.isHost && !mySeats().includes(pl.id)) || mySeats().indexOf(pl.id) > 0);

  function swatches(pl) {
    const taken = new Set((p.players ?? []).filter((x) => x.id !== pl.id).map((x) => x.color));
    return el('div', { class: 'c-seateditor-palette' }, (p.palette ?? SEAT_PALETTE).map((c) => el('button', {
      class: 'c-seateditor-swatch' + (c === pl.color ? ' on' : ''),
      type: 'button', disabled: taken.has(c), 'aria-label': '揀顏色',
      style: { '--seat': c },
      onclick: () => { sfx('tap'); openColorFor = null; p.onColor?.(pl.id, c); paint(true); },
    })));
  }

  function startDrag(e, li, index) {
    e.preventDefault();
    if (openColorFor) return;   // an open palette row would skew the row spacing
    const rows = [...list.children].filter((r) => r.classList.contains('c-seateditor-row'));
    if (rows.length < 2) return;
    const step = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
    const handle = e.currentTarget;
    const startY = e.clientY;
    let target = index;
    dragging = true;
    li.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch { /* the drag still follows the finger */ }

    const move = (ev) => {
      const dy = ev.clientY - startY;
      target = Math.max(0, Math.min(rows.length - 1, Math.round(index + dy / step)));
      li.style.transform = `translateY(${dy}px)`;
      rows.forEach((r, i) => {
        if (r === li) return;
        let shift = 0;
        if (index < target && i > index && i <= target) shift = -step;
        else if (index > target && i >= target && i < index) shift = step;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const end = (cancel) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      dragging = false;
      li.classList.remove('dragging');
      rows.forEach((r) => { r.style.transform = ''; });
      const pending = deferred;
      deferred = null;
      if (!cancel && target !== index) { sfx('tap'); p.onMove?.(li.dataset.pid, target); }
      if (pending) { p = pending; paint(true); }
    };
    const onUp = () => end(false);
    const onCancel = () => end(true);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  }

  function rowFor(pl, i, n) {
    const mine = mySeats().includes(pl.id);
    const li = el('li', {
      class: 'c-seateditor-row' + (mine ? ' mine' : '') + (pl.connected === false ? ' offline' : ''),
      'data-pid': pl.id,
    });

    if (canMove()) {
      const handle = el('span', { class: 'c-seateditor-handle', 'aria-hidden': 'true', text: '⠿' });
      handle.addEventListener('pointerdown', (e) => startDrag(e, li, i));
      li.append(handle);
    }

    li.append(el('span', { class: 'c-seateditor-n', text: String(i + 1) }));

    const dot = el('button', {
      class: 'c-seateditor-dot', type: 'button', disabled: !canColor(pl),
      'aria-label': `${pl.name} 嘅顏色`, style: { '--seat': pl.color ?? 'var(--cheese)' },
      onclick: () => { openColorFor = openColorFor === pl.id ? null : pl.id; paint(true); },
    });
    li.append(dot);

    li.append(el('span', { class: 'c-seateditor-name' },
      // #20: 「（你）」 only on a phone of your own — on a shared phone every seat here would say it
      el('span', { class: 'c-seateditor-label', text: pl.name + (mine && mySeats().length === 1 ? '（你）' : '') }),
      pl.isHost ? el('span', { class: 'tag host', text: '房主' }) : null,
      pl.spectator ? el('span', { class: 'tag', text: '旁觀' }) : null,
      pl.connected === false ? el('span', { class: 'tag off', text: '斷咗線' }) : null));

    if (canMove()) {
      li.append(
        el('button', {
          class: 'c-seateditor-btn', type: 'button', 'aria-label': '上移', disabled: i === 0,
          onclick: () => { sfx('tap'); p.onMove(pl.id, i - 1); },
        }, '▲'),
        el('button', {
          class: 'c-seateditor-btn', type: 'button', 'aria-label': '下移', disabled: i === n - 1,
          onclick: () => { sfx('tap'); p.onMove(pl.id, i + 1); },
        }, '▼'));
    }
    if (canRemove(pl)) {
      li.append(el('button', {
        class: 'c-seateditor-btn del', type: 'button', 'aria-label': `移走 ${pl.name}`,
        onclick: (e) => p.onKick(pl.id, e?.currentTarget ?? null),
      }, '✕'));
    }
    return li;
  }

  function paint(force = false) {
    const key = sig([p.players, p.me, p.isHost, p.mySeats, openColorFor, !!p.onMove, !!p.onColor, !!p.onKick, p.orderHint ?? null]);
    if (!force && key === shownKey) return;
    shownKey = key;

    const players = p.players ?? [];
    const rows = [];
    players.forEach((pl, i) => {
      rows.push(rowFor(pl, i, players.length));
      if (openColorFor === pl.id && canColor(pl)) {
        rows.push(el('li', { class: 'c-seateditor-colorrow' }, swatches(pl)));
      }
    });
    if (!players.length) rows.push(el('li', { class: 'empty', text: '仲未有人…' }));
    list.replaceChildren(...rows);
    const order = typeof p.orderHint === 'string' && p.orderHint ? p.orderHint : '';
    hint.textContent = order || DEFAULT_HINT;
    hint.classList.toggle('strong', !!order);
    hint.hidden = players.length < 2 || (!order && !canMove());
  }

  const api = {
    el: root,
    update(next = {}) {
      if (dragging) { deferred = next; return; }   // never rebuild the list under a finger
      p = next;
      if (openColorFor && !(p.players ?? []).some((x) => x.id === openColorFor)) openColorFor = null;
      paint();
    },
    destroy() { root.remove(); },
  };

  api.update(p);
  return api;
}

export default SeatEditor;
