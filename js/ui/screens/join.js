// ============================================================
// screens/join.js — enter a room code on a keypad made of dice (v1 design:
// neon frame around the display, the next empty slot pulses, a tapped die
// drops in), then your name.
// ============================================================

import { el, dieFace, addPips, toast } from '../dom.js?v=20261003075613';
import { sfx } from '../../core/sfx.js?v=20261003075613';
import { isRoomCode, CODE_LEN } from '../../core/util.js?v=20261003075613';
import { friendlyError } from './home.js?v=20261003075613';

const NAME_MAX = 12;

export function mountJoin(sh) {
  const { app, drafts } = sh;
  let busy = false;
  let watchdog = null;

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
      // success: the shell swaps this screen for the lobby as soon as the host welcomes us.
      // If the host never does, do not leave the keypad frozen.
      watchdog = setTimeout(() => { if (busy) failJoin('連到，但房主冇回應。佢可能已經熄咗個頁面。'); }, 20000);
    } catch (err) {
      console.error(err);
      failJoin(friendlyError(err, '入唔到房 — 睇下啲骰啱唔啱，房主係咪仲開緊個頁面。'));
    }
  }

  /** A failed dial must not leave the app half-joined, or the router would wait for a welcome forever. */
  function failJoin(message) {
    clearTimeout(watchdog);
    // join() tears itself down on failure; leave() is only needed if it is still half-joined
    try { if (app.state.mode) app.leave(); } catch { /* already clean */ }
    busy = false;
    name.disabled = false;
    paintSlots();
    setStatus('❌ ' + message, 'err');
  }

  joinBtn.addEventListener('click', doJoin);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  name.addEventListener('input', () => { drafts.name = name.value; });

  const root = el('section', { class: 'screen', 'data-screen': 'join' },
    el('header', { class: 'topbar' },
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': '返回',
        onclick: () => { if (!busy) sh.go('home'); else toast('連緊線，等一等'); },
      }, '‹'),
      el('h2', { text: '入房' }),
      el('span', { class: 'spacer' })),
    el('div', { class: 'card' },
      el('span', { class: 'field-label', text: '房間號碼 — 照住房主部機㩒' }),
      frame, hint, pad,
      el('div', { class: 'pad-actions' }, backBtn, clearBtn)),
    el('div', { class: 'card' },
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: '你個名' }), name)),
    joinBtn, status);

  paintSlots();
  if (drafts.joinError) { setStatus('❌ ' + drafts.joinError, 'err'); drafts.joinError = ''; }

  return {
    el: root,
    update(st) {
      if (!busy) return;
      // the host can refuse after the dial succeeded (room full, game running…)
      if (st.conn === 'error') failJoin(st.connMessage || '入唔到房，房主拒絕咗。');
      // otherwise show what the core says it is doing (e.g. "揾唔到房主 — 佢可能熄咗個頁面")
      else if (st.connMessage) setStatus(st.connMessage);
    },
    destroy() { clearTimeout(watchdog); },
  };
}
