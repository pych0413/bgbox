// ============================================================
// PlayerPicker — pick k of n seats, in seat order, with exclusions.
//
//   PlayerPicker({ players, me, count: 1, exclude: [pid], selected: [pid],
//                  disabled, onChange(sel), confirmLabel, onConfirm(sel) })
//     → { el, update(props), destroy() }
//
// Optional extras: `min` (fewest picks that enable the confirm button,
// default = count), `hint` (line under the grid) and `youTag` (default true: 「（你）」 after `me`; the play
// screen turns it off on a shared phone, which the whole table reads — DESIGN §7.1 #20).
//
// Works controlled or not. The internal selection follows `selected` only
// when that prop's CONTENT changes, so a game UI may either keep its own
// state and pass it back, or ignore `selected` and let the picker remember.
// count = 1 behaves like radio buttons (a new tap replaces the pick); for
// count > 1 a full selection ignores further taps — drop one first.
// `onChange` receives picks in tap order; the grid itself is in seat order.
// ============================================================

import { el, restartAnim } from '../dom.js?v=1';
import { sfx } from '../../core/sfx.js?v=1';

export function PlayerPicker(props = {}) {
  let p = props;
  let sel = [];
  let lastSelectedProp = null;

  const grid = el('div', { class: 'c-playerpicker-grid' });
  const countEl = el('p', { class: 'c-playerpicker-count' });
  const confirmBtn = el('button', { class: 'btn btn-primary', type: 'button' });
  const root = el('div', { class: 'c-playerpicker' }, grid, countEl, confirmBtn);

  const need = () => Math.max(1, p.count ?? 1);
  const minNeeded = () => Math.min(need(), Math.max(1, p.min ?? need()));

  function tap(pid, chip) {
    if (p.disabled || (p.exclude ?? []).includes(pid)) return;
    let next;
    if (sel.includes(pid)) next = sel.filter((x) => x !== pid);
    else if (need() === 1) next = [pid];
    else if (sel.length >= need()) {
      restartAnim(chip, 'denied');
      sfx('deny');
      return;
    } else next = [...sel, pid];
    sfx('tap');
    sel = next;
    paint();
    p.onChange?.(sel.slice());
  }

  function chipFor(player) {
    const excluded = (p.exclude ?? []).includes(player.id);
    const idx = sel.indexOf(player.id);
    const on = idx >= 0;
    const chip = el('button', {
      class: 'c-playerpicker-chip' + (on ? ' on' : '') + (excluded ? ' excluded' : ''),
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      disabled: p.disabled || excluded,
      style: { '--seat': player.color ?? 'var(--cheese)' },
    },
    el('span', { class: 'c-playerpicker-dot' }),
    el('span', { class: 'c-playerpicker-name', text: player.name + (player.id === p.me && p.youTag !== false ? '（你）' : '') }),
    on && need() > 1 ? el('span', { class: 'c-playerpicker-order', text: String(idx + 1) }) : null,
    excluded ? el('span', { class: 'c-playerpicker-ban', text: '🚫' }) : null);
    chip.addEventListener('click', () => tap(player.id, chip));
    return chip;
  }

  function paint() {
    grid.replaceChildren(...(p.players ?? []).map(chipFor));
    const n = need();
    countEl.textContent = p.hint ?? (n > 1 ? `揀咗 ${sel.length} / ${n}` : '');
    countEl.hidden = !countEl.textContent;

    confirmBtn.hidden = !p.onConfirm;
    confirmBtn.textContent = p.confirmLabel ?? '確定';
    confirmBtn.disabled = !!p.disabled || sel.length < minNeeded();
  }

  confirmBtn.addEventListener('click', () => {
    if (p.disabled || sel.length < minNeeded()) return;
    p.onConfirm?.(sel.slice());
  });

  const api = {
    el: root,
    update(next = {}) {
      p = next;
      const pids = new Set((p.players ?? []).map((x) => x.id));
      const key = p.selected ? p.selected.join('|') : null;
      if (key !== lastSelectedProp) {
        lastSelectedProp = key;
        if (p.selected) sel = p.selected.filter((x) => pids.has(x));
      }
      // never keep a pick that left the table or became excluded
      sel = sel.filter((x) => pids.has(x) && !(p.exclude ?? []).includes(x));
      paint();
    },
    destroy() { root.remove(); },
  };

  api.update(p);
  return api;
}

export default PlayerPicker;
