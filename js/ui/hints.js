// ============================================================
// hints.js — the 💡 sheet (BACKLOG U1). ON DEMAND ONLY: it opens when the
// player taps 💡 and never by itself.
//
//   而家要做咩   the game's one-line phase hint (view.hint), for a first-timer
//   你嘅角色     the seat's own role — what you do and how you win — behind the
//                same hold-to-peek Cover as a role card (release = hidden), so a
//                glance from the next seat sees nothing. Games that keep the
//                role secret even from its holder (誰是臥底) expose no own-role
//                field; the sheet then lists every role of the game instead. A game where
//                cards change hands may name the heading itself with `view.hintRoleLabel`
//                (e.g. 「你派到嘅角色」), so the sheet never claims to know the card you hold now.
//   📖           the full rules
//
// The sheet follows the live view while open (a new phase updates the hint),
// and closes whenever the phone changes hands (seat switch, pass gate).
// ============================================================

import { el, sig } from './dom.js?v=1';
import { roleFor, roleParts, teamStyle } from './logic.js?v=1';
import { Cover } from './components/Cover.js?v=1';
import { openSheet } from './sheet.js?v=1';

/** view.hint may be a string or { text }; anything else is no hint. */
function hintText(view) {
  const h = view?.hint;
  if (typeof h === 'string') return h.trim();
  if (h && typeof h === 'object' && typeof h.text === 'string') return h.text.trim();
  return '';
}

function roleFront(role) {
  const { what, win } = roleParts(role.text);
  const { color, label } = teamStyle(role);
  return el('div', { class: 'hint-role-front', style: color ? { '--team': color } : {} },
    el('div', { class: 'hint-role-name' },
      el('span', { class: 'hint-role-emoji', text: role.emoji ?? '❔' }),
      el('b', { text: role.name ?? '' }),
      label ? el('span', { class: 'c-rolecard-team', text: label }) : null),
    what ? el('p', {}, el('span', { class: 'hint-k', text: '做乜' }), what) : null,
    win ? el('p', {}, el('span', { class: 'hint-k', text: '點贏' }), win) : null);
}

function allRoles(rules) {
  const roles = (rules?.roles ?? []).filter((r) => r && r.name);
  if (!roles.length) return null;
  return el('div', { class: 'hint-roles' }, roles.map((r) => {
    const { what, win } = roleParts(r.text);
    return el('div', { class: 'hint-roles-row', style: { '--team': teamStyle(r).color ?? 'var(--line)' } },
      el('span', { class: 'hint-role-emoji', text: r.emoji ?? '❔' }),
      el('div', {},
        el('b', { text: r.name }),
        what ? el('p', { text: what }) : null,
        win ? el('p', { class: 'hint-win', text: `點贏：${win}` }) : null));
  }));
}

/**
 * HintSheet(sh, { onRules }) → { open(game, view), update(game, view), close(), isOpen() }
 * `game` is the loaded game module ({ meta, rules }); `view` the seat's current view.
 */
export function HintSheet(sh, { onRules } = {}) {
  let sheet = null;
  let cover = null;
  let roleKey = null;
  let hintEl = null;
  let roleHost = null;

  function paint(game, view) {
    if (!sheet) return;
    const text = hintText(view);
    hintEl.textContent = text || '跟住畫面上面嘅提示做就得。唔肯定可以問主持。';
    hintEl.classList.toggle('is-empty', !text);

    const role = roleFor(view, game?.rules);
    const label = typeof view?.hintRoleLabel === 'string' && view.hintRoleLabel.trim() ? view.hintRoleLabel.trim().slice(0, 20) : '你嘅角色';
    const key = sig([game?.meta?.id, role, label]);
    if (key === roleKey) return;
    roleKey = key;
    cover?.destroy();
    cover = null;
    if (role) {
      cover = Cover({
        front: roleFront(role), backArt: '🤫', backLabel: '㩒住睇你嘅角色',
        lockMode: 'none', ariaLabel: '㩒住睇你嘅角色', openSound: 'flip',
      });
      roleHost.replaceChildren(
        el('div', { class: 'hint-h', text: `🎭 ${label}` }),
        cover.el,
        el('p', { class: 'hint', text: '㩒住先見到，放手即刻冚返 — 唔好俾隔離望到。' }));
    } else {
      const list = allRoles(game?.rules);
      roleHost.replaceChildren(...(list ? [el('div', { class: 'hint-h', text: '🎭 呢局有咩角色' }), list] : []));
    }
  }

  function open(game, view) {
    close();
    hintEl = el('p', { class: 'hint-now' });
    roleHost = el('div', { class: 'hint-rolebox' });
    roleKey = null;
    const body = el('div', { class: 'hint-sheet' },
      el('div', { class: 'hint-h', text: '👉 而家要做咩' }),
      hintEl,
      roleHost,
      el('button', {
        class: 'btn btn-ghost', type: 'button',
        onclick: () => { close(); onRules?.(); },
      }, '📖 睇晒成套規則'));
    sheet = openSheet({
      title: '💡 提示',
      cls: 'hint-sheet-wrap',
      render: () => [body],
      onClose: () => { cover?.destroy(); cover = null; sheet = null; },
    });
    paint(game, view);
  }

  function close() {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    cover?.destroy();
    cover = null;
    s.close();
  }

  return {
    open,
    close,
    isOpen: () => !!sheet,
    update(game, view) { if (sheet) paint(game, view); },
  };
}
