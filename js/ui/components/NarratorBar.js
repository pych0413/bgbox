// ============================================================
// NarratorBar — the host's strip showing the current narration line, with
// replay, skip and the 語音 · 讀稿 · 靜音 mode switch.
//
//   NarratorBar({ cue, mode, onReplay, onNext, onMode })
//     → { el, update(props), destroy() }
//
//   cue   { id, text } | null      mode   'voice' | 'read' | 'silent'
//
// Optional extras: `paused` + `onPause` (a ⏸ button), `hidden`, and `confirmNext` (see #13 below).
// One phone (DESIGN §7.1): `modes` = the mode buttons offered (default all three; U1 drops 'silent' for an
// eyes-closed night on a whole-table phone); `hideSkip` = no ghost 「⏭ 跳過呢步」 — on a whole-table phone it is in
// reach of whoever holds the phone, so the skip lives in ⋯ only (#35). The 讀稿 narrator's 下一步 always stays.
//
// Watchdog (BACKLOG #1): `stalled: true` (+ `line`, `reason`) means the phone was asked
// to speak and nothing came out (no start within 1.5 s, the length timeout hit,
// or no voice at all). The bar then never stalls silently: it shows the line in
// big text for a human to read out, with 🔁 重講, ⏭ 跳過 (`onSkip`, finishes
// just this line) and 下一步.
//
//  - voice  the phone speaks; the line is shown small, 🔁 replays it, ⏭ 跳過呢步 skips.
//  - read   a human narrator reads the big text aloud and presses 下一步.
//  - silent on-screen prompt only; steps advance on timers (⏭ 跳過呢步 still skips).
//
// The bar never speaks by itself: the app speaks cues and reports them done.
//
// 下一步 ignores a second tap within NEXT_COOLDOWN_MS (qa:werewolf): in 讀稿 a double tap would
// otherwise acknowledge the line AND cut the night window that follows it short.
//
// #13: the host's skip is not the screen's main action. It is a ghost 「⏭ 跳過呢步」 — except for the
// 讀稿 narrator (and a stalled line), whose big 「下一步 ⏭」 IS the main action. `confirmNext` (a string,
// the play screen sets it while skipping would cut somebody off: an open vote, a night window) makes the
// first tap arm the button (「再㩒一次：…」, dom.js confirmTap) and only the second one call onNext.
//
// `compact: true` (the play screen sets it while this phone's seat can draw on a Canvas) folds the
// bar to ONE line — icon, the line cut short, 下一步 — so it never covers the drawing sheet. A ▴
// button opens it for this turn; the next time `compact` switches on it folds again.
// ============================================================

import { el, confirmTap, isArmed, disarmConfirm } from '../dom.js?v=20261004224709';

/** Why the line did not come out (app.state.narration.reason) → what the host is told. */
const STALL_TEXT = {
  muted: '🔇 部手機冇聲（音量 0？）— 調大聲，或者你讀出嚟：',
  timeout: '⚠️ 讀咗好耐都未讀完 — 你幫手讀出嚟：',
  unsupported: '📢 呢部機唔識讀出聲 — 你讀出嚟：',
};
const STALL_DEFAULT = '⚠️ 部手機冇讀出聲 — 麻煩你讀出嚟：';
const NEXT_COOLDOWN_MS = 1500;
const NEXT_KEY = 'narrator-next';
const SKIP_LABEL = '⏭ 跳過呢步';
const READ_LABEL = '下一步 ⏭';

const MODES = [
  ['voice', '🔊 語音'],
  ['read', '📜 讀稿'],
  ['silent', '🔇 靜音'],
];

export function NarratorBar(props = {}) {
  let p = props;
  let lastCueId;
  let wasCompact = false;
  let unfolded = false;          // the host opened a compact bar for this drawing turn

  const icon = el('span', { class: 'c-narratorbar-icon', 'aria-hidden': 'true' });
  const textEl = el('div', { class: 'c-narratorbar-text' });
  const stallEl = el('div', { class: 'c-narratorbar-stall', text: '⚠️ 部手機冇讀出聲 — 麻煩你讀出嚟：' });
  const replayBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': '再讀一次' }, '🔁 重講');
  const skipBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': '跳過呢句' }, '⏭ 跳過');
  const pauseBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' });
  const nextBtn = el('button', { class: 'btn btn-ghost btn-sm c-narratorbar-next', type: 'button' }, SKIP_LABEL);
  const foldBtn = el('button', { class: 'c-narratorbar-fold', type: 'button' });
  const actions = el('div', { class: 'c-narratorbar-actions' }, replayBtn, skipBtn, pauseBtn, nextBtn);
  const modeRow = el('div', { class: 'c-narratorbar-modes', role: 'group', 'aria-label': '旁白方式' },
    MODES.map(([m, label]) => el('button', {
      class: 'c-narratorbar-mode', type: 'button', 'data-mode': m,
      onclick: () => { if (p.mode !== m) p.onMode?.(m); },
    }, label)));
  const root = el('div', { class: 'c-narratorbar' },
    stallEl,
    el('div', { class: 'c-narratorbar-line' }, icon, textEl, foldBtn),
    actions, modeRow);

  foldBtn.addEventListener('click', () => { unfolded = !unfolded; api.update(p); });
  replayBtn.addEventListener('click', () => p.onReplay?.());
  skipBtn.addEventListener('click', () => p.onSkip?.());
  let nextAt = -Infinity;
  let coolTimer = null;
  nextBtn.addEventListener('click', () => {
    const now = Date.now();
    if (now - nextAt < NEXT_COOLDOWN_MS) return;          // a double tap: the first one already moved the table on
    // skipping would cut somebody off: the first tap only arms (#13)
    if (p.confirmNext && !confirmTap(p.confirmNext, { node: nextBtn, key: NEXT_KEY, onDisarm: () => paintNext() })) return;
    nextAt = now;
    root.classList.add('cooling');
    clearTimeout(coolTimer);
    coolTimer = setTimeout(() => root.classList.remove('cooling'), NEXT_COOLDOWN_MS);
    p.onNext?.();
  });
  pauseBtn.addEventListener('click', () => p.onPause?.());

  /**
   * 下一步 / 跳過呢步. The 讀稿 narrator with a line to read (or a stalled line someone reads out) moves the
   * table on with it: big and primary, 「下一步 ⏭」. Anywhere else it is the host skipping a step: a small ghost
   * 「⏭ 跳過呢步」, never the brightest thing on the screen. An armed button keeps its 「再㩒一次」 label.
   */
  function paintNext() {
    // nothing to confirm any more (the last ballot came in): an armed label would only mislead
    if (!p.confirmNext && isArmed(NEXT_KEY, nextBtn)) { disarmConfirm(); return; }   // (onDisarm repaints)
    const mode = p.mode ?? 'voice';
    const stalled = !!p.stalled && mode === 'voice';
    const line = (stalled && p.line) || p.cue?.text || '';
    const reading = (mode === 'read' && !!line) || stalled;
    const compact = !!p.compact && !unfolded;
    const big = reading && !compact;                    // a skip with no line to read stays small, even in 讀稿
    nextBtn.hidden = !p.onNext || (!!p.hideSkip && !reading);
    nextBtn.disabled = !line && mode !== 'read';
    nextBtn.classList.toggle('btn-primary', reading);
    nextBtn.classList.toggle('btn-ghost', !reading);
    nextBtn.classList.toggle('btn-lg', big);
    nextBtn.classList.toggle('btn-sm', !big);
    if (!isArmed(NEXT_KEY, nextBtn)) {
      const label = reading ? READ_LABEL : SKIP_LABEL;
      if (nextBtn.textContent !== label) nextBtn.textContent = label;
    }
  }

  const api = {
    el: root,
    update(next = {}) {
      p = next;
      const mode = p.mode ?? 'voice';
      root.hidden = !!p.hidden;
      root.dataset.mode = mode;
      const stalled = !!p.stalled && mode === 'voice';
      const line = (stalled && p.line) || p.cue?.text || '';
      root.classList.toggle('has-cue', !!line);
      root.classList.toggle('is-stalled', stalled);
      stallEl.hidden = !stalled;
      stallEl.textContent = STALL_TEXT[p.reason] ?? STALL_DEFAULT;

      icon.textContent = stalled ? '📢' : mode === 'voice' ? '🔊' : mode === 'read' ? '📜' : '💬';
      textEl.textContent = line || '（暫時冇旁白）';
      textEl.classList.toggle('is-empty', !line);

      replayBtn.hidden = mode !== 'voice' || !line || !p.onReplay;
      skipBtn.hidden = !stalled || !p.onSkip;
      pauseBtn.hidden = !p.onPause || stalled;
      pauseBtn.textContent = p.paused ? '▶ 繼續' : '⏸ 暫停';

      const offered = Array.isArray(p.modes) && p.modes.length ? p.modes : null;
      for (const b of modeRow.children) {
        b.classList.toggle('on', b.dataset.mode === mode);
        b.hidden = !!offered && !offered.includes(b.getAttribute('data-mode'));
      }
      modeRow.hidden = !p.onMode;

      // compact while this phone draws: one line, 下一步 only (unless the host unfolded it this turn)
      if (p.compact && !wasCompact) unfolded = false;
      wasCompact = !!p.compact;
      const compact = !!p.compact && !unfolded;
      root.classList.toggle('is-compact', compact);
      foldBtn.hidden = !p.compact;
      foldBtn.textContent = compact ? '▴' : '▾';
      foldBtn.setAttribute('aria-label', compact ? '打開旁白' : '收細旁白');
      if (compact) {
        replayBtn.hidden = true;
        skipBtn.hidden = true;
        pauseBtn.hidden = true;
        modeRow.hidden = true;
        stallEl.hidden = true;                 // the 📢 icon still says it; ▴ shows the whole story
      }
      paintNext();

      // a new line gets a little entrance so a read-aloud narrator notices it
      if (p.cue?.id !== lastCueId) {
        lastCueId = p.cue?.id;
        root.classList.remove('fresh');
        void root.offsetWidth;
        if (p.cue) root.classList.add('fresh');
      }
    },
    destroy() {
      clearTimeout(coolTimer);
      if (isArmed(NEXT_KEY, nextBtn)) disarmConfirm();
      root.remove();
    },
  };

  api.update(p);
  return api;
}

export default NarratorBar;
