// ============================================================
// status.js — the thin layer of notices that sit over every screen:
//
//   G10  「有新版本 — 請重新整理」 when this phone and the host run different builds
//        (or 「叫佢重新整理」 when it is the other phone that is behind)
//   G9   the host's snapshot could not be saved (storage full)
//   G18  「請用 Safari 開」 inside LINE / Instagram / Facebook / WeChat browsers
//   #5   a brief 「✓ 已經同步」 chip after the phone comes back and re-syncs
//   G4   「⏳ 傳送緊…」 while an action has been waiting > 1.5 s for the host
//   #6   (host) 「阿明 想攞返個位」 approve / reject cards
//
// Everything reads app.state with optional chaining: a core without one of
// these fields simply shows nothing.
// ============================================================

import { el, toast } from './dom.js?v=20261003090241';
import { inAppBrowser } from './logic.js?v=20261003090241';

const OUTBOX_GRACE_MS = 1500;
const SYNC_CHIP_MS = 1800;

export function createStatus(sh) {
  const { app } = sh;
  const layer = el('div', { class: 'status-layer', 'aria-live': 'polite' });
  const versionText = el('span', { class: 'grow' });
  const reloadBtn = el('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => location.reload() }, '重新整理');
  const versionBar = el('div', { class: 'app-banner warn', role: 'alert', hidden: true }, versionText, reloadBtn);
  const saveBar = el('div', { class: 'app-banner err', role: 'alert', hidden: true },
    el('span', { class: 'grow', text: '⚠️ 部機儲存唔到（空間唔夠）— 千祈唔好 refresh，唔係會冇咗呢局' }));
  const claimBox = el('div', { class: 'claim-stack' });
  const chip = el('div', { class: 'sync-chip', hidden: true });
  layer.append(versionBar, saveBar, claimBox, chip);

  let lastResync = undefined;     // undefined until the first update: an old value is history, not news
  let chipTimer = null;
  let outboxSince = 0;
  let outboxTimer = null;
  let chipKind = null;
  let claimsKey = '';
  const answered = new Set();
  // 「已經同步」 is news only after the phone was away (screen off, app switched), not on entering a room
  let backAt = 0;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) backAt = Date.now(); });

  function showChip(kind, text) {
    chipKind = kind;
    chip.textContent = text;
    chip.dataset.kind = kind;
    chip.hidden = false;
    chip.classList.remove('in');
    void chip.offsetWidth;
    chip.classList.add('in');
  }
  function hideChip(kind) {
    if (kind && chipKind !== kind) return;
    chipKind = null;
    chip.classList.remove('in');
    chip.hidden = true;
  }

  /** G10: who has to refresh — this phone (button), or another phone (name it if we can). */
  function paintVersion(st) {
    const on = !!st.versionMismatch && !!st.mode;
    versionBar.hidden = !on;
    if (!on) return;
    const info = st.versionInfo ?? {};
    if (info.refreshMe === false) {
      const names = (info.seats ?? []).map((pid) => st.room?.players?.find((p) => p.id === pid)?.name).filter(Boolean);
      versionText.textContent = names.length
        ? `🔄 ${names.join('、')} 部手機用緊舊版 — 叫佢重新整理`
        : '🔄 有部手機用緊舊版 — 叫佢重新整理';
      reloadBtn.hidden = true;
    } else {
      versionText.textContent = '🔄 有新版本 — 請重新整理';
      reloadBtn.hidden = false;
    }
  }

  function paintOutbox(st) {
    const n = Number(st.outbox) || 0;
    if (!st.mode || n <= 0) {
      outboxSince = 0;
      clearTimeout(outboxTimer);
      outboxTimer = null;
      hideChip('outbox');
      return;
    }
    if (!outboxSince) {
      outboxSince = Date.now();
      clearTimeout(outboxTimer);
      outboxTimer = setTimeout(() => paintOutbox(app.state), OUTBOX_GRACE_MS + 50);
      return;
    }
    if (Date.now() - outboxSince >= OUTBOX_GRACE_MS && chipKind !== 'outbox') showChip('outbox', '⏳ 傳送緊…');
  }

  function paintResync(st) {
    const at = st.resyncedAt ?? null;
    if (lastResync === undefined) { lastResync = at; return; }
    if (at === lastResync) return;
    lastResync = at;
    if (!at || !st.mode || chipKind === 'outbox') return;
    if (!backAt || Date.now() - backAt > 15_000) return;
    backAt = 0;
    showChip('sync', '✓ 已經同步');
    clearTimeout(chipTimer);
    chipTimer = setTimeout(() => hideChip('sync'), SYNC_CHIP_MS);
  }

  function paintClaims(st) {
    const claims = st.isHost && Array.isArray(st.room?.claims) ? st.room.claims.filter((c) => c && !answered.has(`${c.pid}@${c.deviceId ?? ''}`)) : [];
    const key = JSON.stringify(claims.map((c) => [c.pid, c.name, c.deviceId]));
    if (key === claimsKey) return;
    claimsKey = key;
    claimBox.replaceChildren(...claims.map((c) => {
      const tag = `${c.pid}@${c.deviceId ?? ''}`;
      const answer = (ok) => {
        answered.add(tag);
        let res;
        try { res = ok ? app.lobby?.approveClaim?.(c.pid) : app.lobby?.rejectClaim?.(c.pid); } catch (err) { console.error(err); }
        if (res && res.ok === false && res.message) toast(res.message, 2200);
        else if (ok) toast(`${c.name ?? ''} 返嚟喇`);
        claimsKey = '';
        paintClaims(app.state);
      };
      return el('div', { class: 'claim-card', role: 'alertdialog' },
        el('div', { class: 'claim-text' },
          el('b', { text: `📲 ${c.name ?? '有人'} 想攞返個位` }),
          el('small', { text: '佢話自己之前斷咗線、換咗部機。真係佢先好批。' })),
        el('div', { class: 'claim-btns' },
          el('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => answer(true) }, '批准'),
          el('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => answer(false) }, '唔批')));
    }));
  }

  return {
    el: layer,
    update(st) {
      paintVersion(st);
      saveBar.hidden = !(st.saveFailed && st.mode);
      paintClaims(st);
      paintOutbox(st);
      paintResync(st);
      if (!st.mode) { answered.clear(); }
    },
  };
}

/** The 「請用 Safari 開」 card for the home and join screens, or null in a real browser. */
export function inAppNotice(link = location.href) {
  const which = inAppBrowser(globalThis.navigator?.userAgent);
  if (!which) return null;
  return el('div', { class: 'warn inapp-note' },
    el('b', { text: `你喺 ${which} 入面開緊 — 請用 Safari 開` }),
    el('div', { text: '呢度可能冇聲、會熄屏、連唔到房。㩒右上角「⋯」揀「用 Safari 開」，或者複製條連結去 Safari 貼。' }),
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', style: { marginTop: '.5rem' },
      onclick: async () => {
        try { await navigator.clipboard.writeText(link); toast('連結已複製，去 Safari 貼'); }
        catch { window.prompt('複製呢條連結，去 Safari 貼：', link); }
      },
    }, '📋 複製連結'));
}

/** True when PeerJS is unusable right now: its script failed, or the phone is offline. */
export function peerLooksDown() {
  const tag = document.getElementById('peerjs');
  if (window.Peer) return navigator.onLine === false;
  return tag?.dataset.s === 'fail' || navigator.onLine === false;
}
