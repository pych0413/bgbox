// ============================================================
// night.js — the night overlay (BACKLOG #4, playtest #1 / decision D1).
//
// One fixed layer over the play screen, driven by logic.nightChrome():
//   dark    語音 / 讀稿 between this seat's own steps: near-black (95 %), still tappable (decoys keep working)
//   soft    靜音 (D1): ONE readable ~70 % dim on every phone all night — the awake seat gets no lift
//   opaque  a shared phone: covers the last holder's screen completely and swallows taps
// It only fades (in slowly, out a little faster), never flashes white, and its words depend on the narration
// mode only — never on the seat — so two phones side by side look the same whoever is awake.
// ============================================================

import { el } from './dom.js?v=1';
import { NIGHT_WORDS } from './logic.js?v=1';

const LEVELS = ['dark', 'soft', 'opaque'];

/** createNightDim() → { el, set({ on, level, words }), state() } */
export function createNightDim() {
  const title = el('span', { class: 'nd-title', text: NIGHT_WORDS.closed.title });
  const hint = el('span', { class: 'nd-hint', text: NIGHT_WORDS.closed.hint });
  const node = el('div', { class: 'night-dim', 'aria-hidden': 'true' }, title, hint);
  let now = { on: false, level: null };

  return {
    el: node,
    /** `level` is kept while it fades out, so the fade looks like the night it ends. */
    set({ on = false, level = 'dark', words = null } = {}) {
      const lv = LEVELS.includes(level) ? level : 'dark';
      if (on) for (const l of LEVELS) node.classList.toggle(l, l === lv);
      // `on` = visible; `.on.opaque` swallows taps (only while on — the level class stays for the fade-out)
      node.classList.toggle('on', !!on);
      const w = words ?? NIGHT_WORDS.closed;
      if (title.textContent !== w.title) title.textContent = w.title;
      if (hint.textContent !== w.hint) hint.textContent = w.hint;
      now = { on: !!on, level: on ? lv : null };
    },
    state: () => ({ ...now }),
  };
}
