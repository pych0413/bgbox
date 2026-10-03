// ============================================================
// screens/join.js — enter a room code on a keypad made of dice (v1 design:
// neon frame around the display, the next empty slot pulses, a tapped die
// drops in), then your name.
// ============================================================

import { el, dieFace, addPips, toast } from '../dom.js?v=20261003164441';
import { sfx } from '../../core/sfx.js?v=20261003164441';
import { isRoomCode, CODE_LEN } from '../../core/util.js?v=20261003164441';
import { friendlyError } from './home.js?v=20261003164441';
import { inAppNotice, peerLooksDown } from '../status.js?v=20261003164441';

const NAME_MAX = 12;

export function mountJoin(sh) {
  const { app, drafts } = sh;
  let busy = false;

  const slots = el('div', { class: 'code-slots', 'aria-label': '已輸入嘅房間號碼' });
  const frame = el('div', { class: 'code-frame' }, slots);
  const hint = el('div', { class: 'pad-hint' });
  const pad = el('div', { class: 'dice-pad' });
  const backBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '⌫ 刪一粒');
  const clearBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '✕ 清空');
  const name = el('input', {
    type: 'text', maxlength: String(NAME_MAX), placeholder: '例如：阿聰', autocomplete: 'nickname',
    enterkeyhint: 'go', value: drafts.name ?? '', 'aria-label': '你個名',
  });
  const joinBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, '加入');
  const status = el('p', { class: 'status' });
  // #6: the name belongs to a seat that dropped off — offer to take it back (the host approves)
  const claimBox = el('div');
  const cancelBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: { margin: '.5rem auto 0' } }, '取消');
  cancelBtn.hidden = true;
  let claiming = false;
  // G18: multi-phone play needs the internet (PeerJS)
  const netNote = el('p', { class: 'warn', text: '📡 多部手機玩要上網。冇網絡可以返去揀「一部手機玩」。' });
  const paintNet = () => { netNote.hidden = !peerLooksDown(); };

  const codeString = () => drafts.joinCode.join('');

  function paintSlots() {
    const code = drafts.joinCode;
    const full = code.length === CODE_LEN;
    slots.replaceChildren(...Array.from({ length: CODE_LEN }, (_, i) => {
      const v = code[i];
      // exactly one slot is "next" — it pulses so the thumb knows where it lands
      const cls = v ? ' filled' : (i === code.length ? ' next' : '');
      return el('div', { class: 'code-slot' + cls }, v ? dieFace(v) : null);
    }));
    frame.classList.toggle('ready', full);
    hint.textContent = full ? '夠數喇，㩒「加入」✓' : '㩒下面啲骰仔 ↓';
    hint.classList.toggle('done', full);
    joinBtn.disabled = !full || busy;
    backBtn.disabled = code.length === 0 || busy;
    clearBtn.disabled = code.length === 0 || busy;
  }

  for (let v = 1; v <= 6; v++) {
    const b = el('button', { class: 'pad-die', type: 'button', 'aria-label': `輸入 ${v}` });
    addPips(b, v);
    b.addEventListener('click', () => {
      if (busy || drafts.joinCode.length >= CODE_LEN) return;
      drafts.joinCode.push(v);
      sfx('tap');
      paintSlots();
      if (drafts.joinCode.length === CODE_LEN) name.focus({ preventScroll: true });
    });
    pad.append(b);
  }
  backBtn.addEventListener('click', () => { drafts.joinCode.pop(); paintSlots(); });
  clearBtn.addEventListener('click', () => { drafts.joinCode = []; paintSlots(); });

  function setStatus(text, kind = '') {
    status.textContent = text;
    status.className = 'status' + (kind ? ` ${kind}` : '');
  }

  async function doJoin() {
    if (busy) return;
    claimBox.replaceChildren();
    sh.narrator.prime();   // iOS gesture rule: before the first await of this tap
    const code = codeString();
    const n = name.value.trim().slice(0, NAME_MAX);
    if (!isRoomCode(code)) return setStatus('❌ 房間號碼係 4 粒骰（1-6）', 'err');
    if (!n) { setStatus('❌ 填返個名先', 'err'); name.focus(); return; }
    sh.saveName(n);

    busy = true;
    paintSlots();
    name.disabled = true;
    setStatus(`連緊 ${code.split('').join('-')} …`);
    try {
      if (!(await sh.whenPeer())) throw new Error(sh.peerMissing);
      await app.join(code, { names: [n] });
      // join() resolves only once the host has welcomed us (it has its own 12 s timeout), and by then the
      // shell has already swapped this screen for the lobby and called destroy(). A 20 s timer started
      // here used to outlive the screen and call app.leave() — the "drops out of the lobby" bug from the
      // first real-phone game (2026-10-03). Nothing is left to wait for.
      busy = false;
    } catch (err) {
      console.error(err);
      failJoin(friendlyError(err, '入唔到房 — 睇下啲骰啱唔啱，房主係咪仲開緊個頁面。'));
    }
  }

  /** A failed dial must not leave the app half-joined, or the router would wait for a welcome forever. */
  function failJoin(message) {
    // join() tears itself down on failure; leave() is only needed if it is still half-joined
    try { if (app.state.mode) app.leave(); } catch { /* already clean */ }
    busy = false;
    claiming = false;
    cancelBtn.hidden = true;
    name.disabled = false;
    paintSlots();
    setStatus('❌ ' + message, 'err');
    paintClaim();
    // the offer card explains it better than 「已經有人叫…」
    if (claimBox.childElementCount) setStatus('');
  }

  /** After a refused join: if the host says the name is an offline seat of this room, offer to reclaim it. */
  function paintClaim() {
    const c = app.state.claimable;
    const ok = !busy && c && typeof c.pid === 'string' && c.code === codeString() && typeof app.claimSeat === 'function';
    if (!ok) { claimBox.replaceChildren(); return; }
    const who = c.name || name.value.trim() || '我';
    claimBox.replaceChildren(el('div', { class: 'card claim-offer' },
      el('p', { text: `「${who}」個位而家斷咗線。係你嘅話，可以攞返個位 — 房主㩒「批准」就得。` }),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => doClaim(c) }, `🙋 我係 ${who}，之前斷咗線`)));
  }

  async function doClaim(c) {
    if (busy) return;
    sh.narrator.prime();
    busy = true;
    claiming = true;
    claimBox.replaceChildren();
    paintSlots();
    name.disabled = true;
    setStatus('問緊房主…');
    try {
      if (!(await sh.whenPeer())) throw new Error(sh.peerMissing);
      const res = await app.claimSeat(c.code, c.pid);
      if (!busy) return;                       // cancelled meanwhile
      if (res?.status !== 'approved') {
        setStatus('⏳ 等緊房主批准… 叫房主㩒「批准」');
        cancelBtn.hidden = false;
      }
    } catch (err) {
      console.error(err);
      if (busy) failJoin(friendlyError(err, '問唔到房主。'));
    }
  }

  cancelBtn.addEventListener('click', () => {
    try { if (app.state.mode) app.leave(); } catch { /* already clean */ }
    busy = false;
    claiming = false;
    cancelBtn.hidden = true;
    name.disabled = false;
    paintSlots();
    setStatus('已經取消');
  });

  joinBtn.addEventListener('click', doJoin);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  name.addEventListener('input', () => { drafts.name = name.value; });

  const inApp = inAppNotice(drafts.joinCode.length === CODE_LEN ? sh.roomLink(codeString()) : location.href);
  const root = el('section', { class: 'screen', 'data-screen': 'join' },
    el('header', { class: 'topbar' },
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': '返回',
        onclick: () => { if (!busy) sh.go('home'); else toast('連緊線，等一等'); },
      }, '‹'),
      el('h2', { text: '入房' }),
      el('span', { class: 'spacer' })),
    inApp,
    netNote,
    el('div', { class: 'card' },
      el('span', { class: 'field-label', text: '房間號碼 — 照住房主部機㩒' }),
      frame, hint, pad,
      el('div', { class: 'pad-actions' }, backBtn, clearBtn)),
    el('div', { class: 'card' },
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: '你個名' }), name)),
    joinBtn, status, claimBox, cancelBtn);

  paintSlots();
  paintNet();
  window.addEventListener('online', paintNet);
  window.addEventListener('offline', paintNet);
  const peerTag = document.getElementById('peerjs');
  peerTag?.addEventListener('error', paintNet);
  peerTag?.addEventListener('load', paintNet);
  if (drafts.joinError) { setStatus('❌ ' + drafts.joinError, 'err'); drafts.joinError = ''; }

  return {
    el: root,
    update(st) {
      if (!busy) return;
      // the host can refuse after the dial succeeded (room full, game running, claim refused…)
      if (st.conn === 'error') failJoin(st.connMessage || (claiming ? '房主唔批准。' : '入唔到房，房主拒絕咗。'));
      // otherwise show what the core says it is doing (e.g. "揾唔到房主 — 佢可能熄咗個頁面", 「等緊房主批准…」)
      else if (st.connMessage) setStatus(claiming && st.claim?.status === 'waiting' ? `⏳ ${st.connMessage}` : st.connMessage);
    },
    destroy() {
        window.removeEventListener('online', paintNet);
      window.removeEventListener('offline', paintNet);
      peerTag?.removeEventListener('error', paintNet);
      peerTag?.removeEventListener('load', paintNet);
    },
  };
}
