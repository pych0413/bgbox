// ============================================================
// settings.js — per-device preferences: 字體 (標準 / 大) and 聲效, plus the
// way into the pre-flight check. Opened from ⚙️ (home, lobby) and the ⋯ menu.
//
// Text size scales the root font-size (everything is rem), so the whole app
// grows evenly. main.js applies the saved size before the first paint.
// ============================================================

import { el } from './dom.js?v=20261003102525';
import { lsGet, lsSet } from '../core/util.js?v=20261003102525';
import { openSheet } from './sheet.js?v=20261003102525';

export const TEXT_KEY = 'bgb:text';

export function textSize() {
  return lsGet(TEXT_KEY, 'normal') === 'large' ? 'large' : 'normal';
}

export function applyTextSize(size = textSize()) {
  const v = size === 'large' ? 'large' : 'normal';
  if (v === 'large') document.documentElement.dataset.text = 'large';
  else delete document.documentElement.dataset.text;
  return v;
}

export function setTextSize(size) {
  const v = applyTextSize(size);
  lsSet(TEXT_KEY, v);
  return v;
}

/**
 * The settings sheet. `opts.preflight` (a function) adds 「🔧 開波前檢查」;
 * `opts.extra()` may return more rows (e.g. the host's connection list).
 */
export function openSettings(sh, opts = {}) {
  let sheet = null;
  const seg = (pairs, current, onPick) => el('div', { class: 'seg' }, pairs.map(([v, label]) => el('button', {
    type: 'button', class: v === current ? 'on' : '',
    onclick: () => { onPick(v); sheet?.refresh(); },
  }, label)));

  const render = () => [
    el('div', { class: 'sheet-list' },
      el('div', { class: 'sec', text: '字體' }),
      seg([['normal', 'Aa 標準'], ['large', 'Aa 大']], textSize(), (v) => setTextSize(v)),
      el('p', { class: 'hint', text: '光線暗、或者睇唔清嘅時候揀「大」。只影響呢部手機。' }),
      el('div', { class: 'sec', text: '聲效' }),
      seg([['on', '🔊 開'], ['off', '🔇 閂']], sh.sound.isOn() ? 'on' : 'off', (v) => { if ((v === 'on') !== sh.sound.isOn()) sh.sound.toggle(); }),
      el('p', { class: 'hint', text: 'iPhone 側邊靜音掣撥咗去靜音嘅話，聲效會冇聲。' }),
      opts.preflight ? el('div', { class: 'sec', text: '檢查' }) : null,
      opts.preflight ? el('button', {
        class: 'btn btn-ghost', type: 'button',
        onclick: () => { sheet?.close(); opts.preflight(); },
      }, '🔧 開波前檢查（語音、靜音掣、唔熄屏）') : null,
      ...(opts.extra?.() ?? [])),
  ];

  sheet = openSheet({ title: '⚙️ 設定', render });
  return sheet;
}
