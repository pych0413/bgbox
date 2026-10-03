// ============================================================
// preflight.js — the 30-second check before the first narrated game of the
// evening (BACKLOG #2). Shown once per session on the host's 開始 tap, never
// again on this phone after 「唔使再問」, and always reachable from ⚙️.
//
//   粵語語音   installed? (if not: where to get 善怡; falls back to zh-TW)
//   試聽       one line at the current voice, rate and volume
//   靜音掣     Web Audio obeys the ringer switch
//   唔熄屏     wake lock, and the Auto-Lock setting as a fallback
//   主畫面     Add to Home Screen tip (outside standalone mode)
//   搖骰       iOS motion permission, for dice games (must come from a tap)
// ============================================================

import { el } from './dom.js?v=20261003090241';
import { lsGet, lsSet, wakeLockActive } from '../core/util.js?v=20261003090241';
import { primeAudio, sfx } from '../core/sfx.js?v=20261003090241';
import { openSheet } from './sheet.js?v=20261003090241';
import { shakeStatus, enableShake } from './components/DiceCup.js?v=20261003090241';

const SKIP_KEY = 'bgb:preflight:skip';     // per device, forever
const DONE_KEY = 'bgb:preflight:done';     // per session (sessionStorage)
const DICE_GAMES = new Set(['cheese-thief', 'custom']);

const usesDice = (meta) => meta?.dice === true || DICE_GAMES.has(meta?.id);
const isStandalone = () => globalThis.navigator?.standalone === true
  || !!globalThis.matchMedia?.('(display-mode: standalone)')?.matches;

function sessionDone() {
  try { return sessionStorage.getItem(DONE_KEY) === '1'; } catch { return false; }
}
function markSessionDone() {
  try { sessionStorage.setItem(DONE_KEY, '1'); } catch { /* private mode */ }
}

/** Should the 開始 tap show the check first? Host, voice narration, a narrated game, not done or skipped. */
export function wantsPreflight(st, meta) {
  if (!st?.isHost || !meta) return false;
  if (!meta.narration || meta.narration === 'none') return false;
  if ((st.room?.narration?.mode ?? 'voice') !== 'voice') return false;
  return !sessionDone() && !lsGet(SKIP_KEY, false);
}

/**
 * Open the check. `onGo` (optional) is the real start: the big button then reads
 * 「開始 ▶」 and calls it from its own tap (iOS gesture rule); without it the
 * button just closes the sheet.
 */
export function openPreflight(sh, { meta = null, onGo = null } = {}) {
  const { narrator } = sh;
  let sheet = null;
  let testState = null;    // null | 'busy' | { started, voice }
  let skip = !!lsGet(SKIP_KEY, false);
  let motion = shakeStatus?.() ?? 'unsupported';

  const info = () => {
    try { if (typeof narrator.info === 'function') return narrator.info(); } catch { /* old narrator */ }
    return { supported: narrator.supported !== false, cantonese: !!narrator.hasCantonese?.(), voice: null };
  };

  const row = (icon, title, ok, body, extra = null) => el('div', { class: 'pf-row' + (ok === true ? ' ok' : ok === false ? ' bad' : '') },
    el('span', { class: 'pf-icon', text: icon }),
    el('div', { class: 'pf-text' },
      el('b', { text: title }),
      body ? el('p', { text: body }) : null,
      extra));

  async function runTest() {
    narrator.prime?.();      // first, inside the tap
    primeAudio();
    testState = 'busy';
    sheet?.refresh();
    let res = null;
    try { res = await narrator.test?.(); } catch { res = null; }
    testState = res && typeof res === 'object' ? res : { started: res !== null, voice: null };
    sheet?.refresh();
  }

  async function askMotion() {
    // enableShake() makes the iOS permission request its first await
    try { motion = await enableShake(); } catch { motion = 'denied'; }
    sheet?.refresh();
  }

  function render() {
    const i = info();
    const voiceName = i.voice ? `${i.voice.name}（${i.voice.lang}）` : '';
    const rows = [];

    if (i.supported === false) {
      rows.push(row('🗣️', '呢部機唔識讀出聲', false, '可以喺旁白揀「📜 讀稿」，由一個人睇住手機讀。'));
    } else if (i.cantonese) {
      rows.push(row('🗣️', '有粵語語音', true, voiceName ? `會用：${voiceName}` : ''));
    } else {
      rows.push(row('🗣️', '未裝粵語語音', false,
        'iPhone：設定 › 輔助使用 › 朗讀內容 › 聲音 › 中文（香港），下載「善怡」。未裝都玩得，會用台灣／普通話聲。'));
    }

    const t = testState;
    rows.push(row('🔊', '試聽一句', t && t !== 'busy' ? (t.started ? true : false) : null,
      t === 'busy' ? '讀緊…'
        : t ? (t.started ? '聽到就得。太細聲就㩒手機側邊大聲掣。' : '冇聲出到 — 試下大聲啲、或者再㩒一次。')
          : '用而家嘅聲同語速讀一句。',
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: t === 'busy', onclick: runTest }, '▶ 試聽')));

    rows.push(row('🔕', '靜音掣', null, 'iPhone 側邊個掣要撥去有聲（見唔到橙色），聲效同計時器先會響。'));

    const awake = (() => { try { return wakeLockActive(); } catch { return false; } })();
    const canWake = !!globalThis.navigator?.wakeLock;
    rows.push(row('🔆', awake ? '玩緊唔會熄屏' : '記住唔好鎖機', awake ? true : null,
      awake ? '' : `${canWake ? '暫時未鎖到亮屏' : '呢部機唔識自動保持亮屏'}：設定 › 螢幕與亮度 › 自動鎖定，揀「永不」最穩陣。`));

    if (!isStandalone()) {
      rows.push(row('📲', '加到主畫面', null, 'Safari 下面「分享」› 加至主畫面。下次一㩒就開，全螢幕，冇網都開到。'));
    }

    if (usesDice(meta) && motion !== 'unsupported' && motion !== 'not-needed') {
      rows.push(row('🎲', '搖手機擲骰', motion === 'granted' ? true : motion === 'denied' ? false : null,
        motion === 'granted' ? '已經允許。' : motion === 'denied' ? '畀拒絕咗：可以照㩒掣擲骰。' : '允許咗就可以搖手機擲骰。',
        motion === 'granted' ? null : el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: askMotion }, '允許搖手機')));
    }

    const skipBox = el('label', { class: 'switch-row pf-skip' },
      el('span', {}, el('strong', { text: '呢部機下次唔使再問' })),
      el('input', { type: 'checkbox', checked: skip, onchange: (e) => { skip = e.target.checked; lsSet(SKIP_KEY, skip); } }),
      el('span', { class: 'switch' }));

    const go = el('button', {
      class: 'btn btn-primary btn-lg', type: 'button',
      onclick: () => {
        markSessionDone();
        sheet?.close();
        sfx('tap');
        onGo?.();
      },
    }, onGo ? '開始 ▶' : '搞掂 ✓');

    return [el('div', { class: 'pf' },
      el('p', { class: 'hint pf-lead', text: '開波前 30 秒檢查一次，夜晚旁白先唔會甩轆。' }),
      ...rows, skipBox, go)];
  }

  sheet = openSheet({ title: '🔧 開波前檢查', cls: 'pf-sheet', render, onClose: () => { sheet = null; } });
  const off = narrator.onVoices?.(() => sheet?.refresh());
  const prevClose = sheet.close;
  sheet.close = () => { try { off?.(); } catch { /* listener gone */ } prevClose(); };
  return sheet;
}
