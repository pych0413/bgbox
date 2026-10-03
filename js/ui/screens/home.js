// ============================================================
// screens/home.js — home, one-phone setup, and the "connecting" waiting room.
// ============================================================

import { el, toast, restartAnim } from '../dom.js?v=20261003102525';
import { primeAudio } from '../../core/sfx.js?v=20261003102525';
import { isRoomCode } from '../../core/util.js?v=20261003102525';
import { inAppNotice, peerLooksDown } from '../status.js?v=20261003102525';
import { savedGroupNames } from '../logic.js?v=20261003102525';

const NAME_MAX = 12;
const TILES = [
  { ch: '桌', color: '#f5c518', rot: '-4deg' },
  { ch: '遊', color: '#4ec97a', rot: '3deg' },
  { ch: '盒', color: '#4aa3ff', rot: '-2deg' },
];

/**
 * Turn whatever the core threw into one calm Cantonese line. The core's own
 * messages are already Cantonese and are shown as they are; anything else (a
 * PeerJS error object, a browser error) gets the fallback plus its type.
 */
export function friendlyError(err, fallback) {
  const msg = String(err?.message ?? '');
  if (/[一-鿿]/.test(msg)) return msg;
  const raw = String(err?.type ?? msg ?? err ?? '');
  if (/Peer/i.test(raw) && /(not defined|undefined)/i.test(raw)) {
    return '載入唔到 PeerJS，要有網絡先開得房。冇網絡可以揀「一部手機玩」。';
  }
  return `${fallback}${raw ? `（${raw}）` : ''}`;
}

function nameInput(sh, { placeholder = '例如：阿聰', enterkeyhint = 'done' } = {}) {
  return el('input', {
    type: 'text', maxlength: String(NAME_MAX), placeholder, autocomplete: 'nickname',
    enterkeyhint, value: sh.drafts.name ?? '', 'aria-label': '你個名',
  });
}

// ---------- home ----------

export function mountHome(sh) {
  const { app } = sh;
  const name = nameInput(sh);
  const status = el('p', { class: 'status' });
  let busy = false;

  const hostBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' },
    el('span', { class: 'btn-icon', text: '🏠' }), '開房');
  const joinBtn = el('button', { class: 'btn btn-ghost btn-lg', type: 'button' },
    el('span', { class: 'btn-icon', text: '🚪' }), '入房');
  const localBtn = el('button', { class: 'btn btn-ghost btn-lg', type: 'button' },
    el('span', { class: 'btn-icon', text: '📱' }), '一部手機玩');

  const resumeSlot = el('div');
  // G18: rooms across phones need PeerJS (internet); one-phone play never does
  const netNote = el('p', { class: 'warn net-note', text: '📡 多部手機玩要上網。而家冇網？揀「📱 一部手機玩」，唔使網絡都玩到。' });
  const paintNet = () => { netNote.hidden = !peerLooksDown(); };
  const peerTag = document.getElementById('peerjs');
  // BACKLOG #12: the service worker has the whole app cached → it opens (and one phone plays) with no signal
  const offlineBadge = el('div', { class: 'offline-badge', role: 'note' },
    el('b', { text: '✅ 可離線玩' }),
    el('span', { text: '冇網都開到；一部手機玩唔使網絡，多部手機一齊玩先要上網。' }));
  const sw = globalThis.navigator?.serviceWorker ?? null;
  const paintOffline = () => { offlineBadge.hidden = !sw?.controller; };

  const currentName = () => name.value.trim().slice(0, NAME_MAX);
  const needName = () => {
    toast('填返個名先');
    name.focus();
    restartAnim(name, 'denied');
  };

  function setBusy(v, text = '') {
    busy = v;
    for (const b of [hostBtn, joinBtn, localBtn]) b.disabled = v;
    status.textContent = text;
    status.className = 'status';
  }

  hostBtn.addEventListener('click', async () => {
    // iOS gesture rule: prime speech and audio before the first await of this tap
    sh.narrator.prime();
    primeAudio();
    const n = currentName();
    if (!n) return needName();
    sh.saveName(n);
    setBusy(true, '開緊房…');
    try {
      if (!(await sh.whenPeer())) throw new Error(sh.peerMissing);
      await app.host({ names: [n] });
    } catch (err) {
      console.error(err);
      // while the room was being claimed the router showed the connecting screen, so this
      // home screen may already be a new instance: park the message where update() will find it
      sh.drafts.homeError = '❌ ' + friendlyError(err, '開唔到房，試下 refresh 或者換個網絡。');
      setBusy(false);
      showHomeError();
    }
  });
  joinBtn.addEventListener('click', () => { sh.saveName(currentName()); sh.go('join'); });
  localBtn.addEventListener('click', () => { sh.saveName(currentName()); sh.go('local'); });
  name.addEventListener('input', () => { sh.drafts.name = name.value; });

  function showHomeError() {
    if (!sh.drafts.homeError) return;
    status.textContent = sh.drafts.homeError;
    status.className = 'status err';
    sh.drafts.homeError = '';
  }

  let resumeKey = null;
  function paintResume() {
    const r = busy ? null : sh.readResume();
    const key = r ? JSON.stringify([r.mode, r.code, r.gameId, r.phase]) : null;
    if (key === resumeKey) return;                 // update() runs on every change: keep the card (and a finger on it)
    resumeKey = key;
    if (!r) { resumeSlot.replaceChildren(); return; }
    const where = r.mode === 'host' ? '你之前開緊房' : r.mode === 'local' ? '你之前有一局一部手機玩' : '你之前喺房';
    const meta = r.gameId ? sh.gameMeta(r.gameId) : null;
    const what = meta ? `${meta.emoji ?? ''} ${meta.name ?? ''}${r.phase === 'playing' ? '（玩緊）' : ''}`.trim() : '';
    resumeSlot.replaceChildren(el('div', { class: 'card resume-card' },
      el('div', { class: 'setup-line' }, el('span', { text: where }),
        r.code ? el('strong', { text: r.code.split('').join(' ') }) : null),
      what ? el('div', { class: 'hint resume-what', text: what }) : null,
      el('div', { class: 'btns' },
        el('button', {
          class: 'btn btn-primary btn-sm', type: 'button',
          onclick: async () => {
            sh.narrator.prime();
            setBusy(true, '返緊去…');
            let failed = '';
            try {
              if (r.mode !== 'local' && !(await sh.whenPeer())) {
                // no network yet: keep the card (and a host's snapshot) so 返去 works once it is back
                failed = '❌ ' + sh.peerMissing;
              } else {
                const ok = await app.resume();   // false: nothing there any more · null: 取消 meanwhile
                if (ok === false) { sh.clearResume(); toast('揾唔返上一局'); }
              }
            } catch (err) {
              console.error(err);
              if (err?.code !== 'no-peer') sh.clearResume();   // a missing network is worth a retry later
              failed = '❌ ' + friendlyError(err, '返唔到去。');
            }
            setBusy(false, failed);
            if (failed) status.className = 'status err';
            resumeKey = null;
            paintResume();
          },
        }, '↩︎ 返去'),
        el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => { sh.clearResume(); resumeKey = null; paintResume(); },
        }, '✕ 唔要'))));
  }

  const root = el('section', { class: 'screen', 'data-screen': 'home' },
    el('div', { class: 'home-tools' }, sh.settingsButton({ preflight: () => sh.openPreflight({}) })),
    inAppNotice(location.origin + location.pathname),
    el('div', { class: 'hub-hero' },
      el('div', { class: 'hub-dice', 'aria-hidden': 'true' },
        ['🎲', '🧀', '🐺', '🕵️', '🎨'].map((e, i) => el('span', { style: { '--i': String(i) }, text: e }))),
      el('h1', { class: 'hub-title', 'aria-label': '桌遊盒' },
        TILES.map((t) => el('span', { style: { '--t': t.color, '--r': t.rot }, text: t.ch }))),
      el('p', { class: 'hub-sub', text: '幾部手機，變成一盒桌遊' }),
      offlineBadge),
    el('div', { class: 'card' },
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: '你個名' }), name)),
    el('div', { class: 'stack' }, hostBtn, joinBtn, localBtn),
    netNote,
    status,
    resumeSlot,
    el('p', { class: 'fineprint' },
      '唔使註冊、唔使裝 app。房主部手機就係 server —', el('br'), '玩緊嗰陣唔好熄屏或者切走個 browser。'));

  paintResume();
  showHomeError();
  paintNet();
  paintOffline();
  window.addEventListener('online', paintNet);
  window.addEventListener('offline', paintNet);
  peerTag?.addEventListener('error', paintNet);
  peerTag?.addEventListener('load', paintNet);
  sw?.addEventListener?.('controllerchange', paintOffline);

  return {
    el: root,
    update() { showHomeError(); paintResume(); paintNet(); paintOffline(); },
    destroy() {
      window.removeEventListener('online', paintNet);
      window.removeEventListener('offline', paintNet);
      peerTag?.removeEventListener('error', paintNet);
      peerTag?.removeEventListener('load', paintNet);
      sw?.removeEventListener?.('controllerchange', paintOffline);
    },
  };
}

// ---------- one-phone setup ----------

export function mountLocalSetup(sh) {
  const { app } = sh;
  const MIN = 2;
  const MAX = 16;
  // #9: the group that played last time on this phone, in their seat order
  const savedNames = (savedGroupNames(sh.savedGroup?.() ?? null) ?? []).slice(0, MAX);
  let prefilled = false;
  if (!sh.drafts.localNames && savedNames.length >= MIN) {
    sh.drafts.localNames = savedNames.slice();
    prefilled = true;
  }
  const names = (sh.drafts.localNames ??= [sh.drafts.name ?? '', '', '', '']).slice();
  const list = el('div', { class: 'local-names' });
  const clearBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '✕ 清空重填');
  const savedNote = el('div', { class: 'saved-note' },
    el('span', { class: 'hint', text: '已經填返上次嗰班人，可以照改。' }), clearBtn);
  savedNote.hidden = !prefilled;
  clearBtn.addEventListener('click', () => {
    names.splice(0, names.length, sh.drafts.name ?? '', '', '', '');
    save();
    savedNote.hidden = true;
    paint();
  });
  const addBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '＋ 加一個人');
  const startBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, '開始');
  const status = el('p', { class: 'status' });
  // smoke test 2026-10-03: the 「玩家 N」 placeholders looked like defaults — so they are: every row is a player
  const blankNote = el('p', { class: 'hint', style: { margin: '.5rem 0 0' }, text: '唔填名就叫「玩家 1」、「玩家 2」… 多咗嘅位㩒 ✕ 移走。' });

  const save = () => { sh.drafts.localNames = names.slice(); };
  /** Every row is a seat; a blank one is called by its placeholder. */
  const finalNames = () => names.map((n, i) => n.trim().slice(0, NAME_MAX) || `玩家 ${i + 1}`);

  function paint() {
    list.replaceChildren(...names.map((n, i) => {
      const input = el('input', {
        type: 'text', maxlength: String(NAME_MAX), placeholder: `玩家 ${i + 1}`,
        value: n, enterkeyhint: i === names.length - 1 ? 'done' : 'next', 'aria-label': `第 ${i + 1} 個人`,
        oninput: (e) => { names[i] = e.target.value; save(); },
      });
      return el('div', { class: 'row' },
        el('span', { class: 'n', text: String(i + 1) }), input,
        names.length > MIN
          ? el('button', {
            class: 'icon-btn', type: 'button', 'aria-label': '移走',
            onclick: () => { names.splice(i, 1); save(); paint(); },
          }, '✕')
          : null);
    }));
    addBtn.hidden = names.length >= MAX;
    startBtn.textContent = `開始（${names.length} 人）`;
  }

  addBtn.addEventListener('click', () => {
    names.push('');
    save();
    paint();
    list.querySelector('.row:last-child input')?.focus();
  });

  startBtn.addEventListener('click', () => {
    primeAudio();
    const filled = finalNames();
    if (filled.length < MIN) { toast(`最少要 ${MIN} 個人`); return; }
    if (new Set(filled).size !== filled.length) { toast('有兩個人同名，改一改啦'); return; }
    if (names[0]?.trim()) sh.saveName(filled[0]);
    try {
      app.local({ names: filled });
    } catch (err) {
      console.error(err);
      status.textContent = '❌ ' + friendlyError(err, '開唔到。');
      status.className = 'status err';
    }
  });

  const root = el('section', { class: 'screen', 'data-screen': 'local' },
    el('header', { class: 'topbar' },
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': '返回', onclick: () => sh.go('home') }, '‹'),
      el('h2', { text: '一部手機玩' }),
      el('span', { class: 'spacer' })),
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', { text: '邊個玩？' }), el('span', { class: 'hint', text: '按坐位次序填' })),
      savedNote, list, blankNote, addBtn),
    el('p', { class: 'fineprint', text: '一部手機傳嚟傳去玩，唔使上網。夜晚、秘密行動會叫你交俾指定嗰個人。' }),
    el('p', { class: 'hint local-note', text: '📡 想每人用自己部手機玩？就要有網絡 — 返去揀「🏠 開房」。' }),
    startBtn, status);

  paint();
  return { el: root, update() {}, destroy() {} };
}

// ---------- connecting (a resume in flight, or a room not yet welcomed) ----------

export function mountConnecting(sh) {
  const title = el('p');
  const label = el('div', { class: 'status' });
  const cancel = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', style: { margin: '1rem auto 0' },
    // leave() forgets this room's resume data itself (forgetResume() refuses while a room is live)
    onclick: () => { try { sh.app.leave(); } catch (e) { console.error(e); } sh.go('home'); },
  }, '取消');
  const root = el('section', { class: 'screen connecting', 'data-screen': 'connecting' },
    el('div', { class: 'spin', text: '🎲' }), title, label, cancel);

  return {
    el: root,
    update(st) {
      title.textContent = st.mode === 'host' ? '開緊房…' : '連緊房…';
      label.textContent = (st.code && isRoomCode(st.code) ? st.code.split('').join(' ') : '') || (st.connMessage ?? '');
      // cancelling a room that is still being claimed would race the core, so only offer it to a client
      cancel.hidden = st.mode === 'host';
    },
    destroy() {},
  };
}
