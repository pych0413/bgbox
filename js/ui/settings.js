// ============================================================
// settings.js — per-device preferences: 字體 (標準 / 大) and 聲效, plus the
// way into the pre-flight check. Opened from ⚙️ (home, lobby) and the ⋯ menu.
//
// 連線記錄 (folded): the core's last ~40 connection events (app.connLog(), UTC times, no
// tokens) with 複製, so a player can send what happened after a night of drop-outs.
//
// Text size scales the root font-size (everything is rem), so the whole app
// grows evenly. main.js applies the saved size before the first paint.
// ============================================================

import { el, toast } from './dom.js?v=20261003171423';
import { lsGet, lsSet } from '../core/util.js?v=20261003171423';
import { openSheet } from './sheet.js?v=20261003171423';

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

/** What 複製 copies: one line about this phone and build, then the log (oldest first). */
function connLogText(app) {
  const st = app?.state ?? {};
  let lines = [];
  try { lines = app?.connLog?.() ?? []; } catch { /* an older core */ }
  const head = `桌遊盒 build ${app?.build || '?'} · mode ${st.mode ?? '-'} · conn ${st.conn ?? '-'} · copied ${new Date().toISOString()}`;
  return [head, globalThis.navigator?.userAgent ?? '', ...lines].join('\n');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* no permission (http, older iOS): the old way */ }
  const ta = el('textarea', { readonly: true, 'aria-hidden': 'true', style: { position: 'fixed', top: '0', left: '-9999px', fontSize: '16px' } });
  ta.value = text;
  document.body.append(ta);
  let ok = false;
  try { ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/**
 * The settings sheet. `opts.preflight` (a function) adds 「🔧 開波前檢查」;
 * `opts.extra()` may return more rows (e.g. the host's connection list).
 */
export function openSettings(sh, opts = {}) {
  let sheet = null;
  let logOpen = false;
  const logLines = () => { try { return sh.app?.connLog?.() ?? []; } catch { return []; } };
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
      ...(opts.extra?.() ?? []),
      typeof sh.app?.connLog === 'function' ? el('details', {
        class: 'conn-log', open: logOpen, ontoggle: (e) => { logOpen = e.currentTarget.open; },
      },
      el('summary', { class: 'sec', text: '連線記錄' }),
      el('p', { class: 'hint', text: '成日斷線嘅話，㩒「複製」再 send 俾搞手睇。' }),
      el('pre', { class: 'conn-log-text', text: logLines().join('\n') || '暫時冇記錄' }),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: async () => { toast(await copyText(connLogText(sh.app)) ? '複製咗' : '複製唔到 — 㩒住上面段字自己複製', 2600); },
      }, '📋 複製')) : null),
  ];

  sheet = openSheet({ title: '⚙️ 設定', render });
  return sheet;
}
