// ============================================================
// RoleCard — Cover + emoji + name + team colour + ability text, with a
// 🔒 button underneath.
//
//   RoleCard({ role: { emoji, name, team, text } | null, locked, onLockToggle, hint })
//     → { el, update(props), destroy(), close(), cover }
//
// Optional extras: `backArt` (default 🎴), `backLabel`, `onOpen(open)` (fires
// when the card is lifted — games use it to report "seen"), and on `role`:
// `color` (any CSS colour, wins over the team table) and `teamLabel`.
//
// `team` is whatever the game uses. The common ids below get a colour and a
// Cantonese label; anything else renders neutral unless the role carries
// `color` / `teamLabel` itself.
// ============================================================

import { el, sig } from '../dom.js?v=20261003085536';
import { teamStyle } from '../logic.js?v=20261003085536';
import { sfx } from '../../core/sfx.js?v=20261003085536';
import { Cover } from './Cover.js?v=20261003085536';

export { teamStyle };

function frontFor(role) {
  if (!role) {
    return el('div', { class: 'c-rolecard-front is-empty' },
      el('div', { class: 'role-emoji', text: '❔' }),
      el('div', { class: 'role-name', text: '未派牌' }));
  }
  const { label } = teamStyle(role);
  return el('div', { class: 'c-rolecard-front' },
    el('div', { class: 'role-emoji', text: role.emoji ?? '❔' }),
    el('div', { class: 'role-name', text: role.name ?? '' }),
    label ? el('span', { class: 'c-rolecard-team', text: label }) : null,
    role.text ? el('div', { class: 'role-desc', text: role.text }) : null);
}

export function RoleCard(props = {}) {
  let p = props;
  let shownRole = Symbol('role');
  let frontNode = null;

  const hintEl = el('p', { class: 'c-rolecard-hint' });
  const lockBtn = el('button', { class: 'btn btn-ghost c-rolecard-lock', type: 'button' });
  const cover = Cover({ lockMode: 'peek', backLabel: '㩒住睇' });
  const root = el('div', { class: 'c-rolecard' }, hintEl, cover.el, lockBtn);

  lockBtn.addEventListener('click', () => {
    sfx(p.locked ? 'unlock' : 'lock');
    if (!p.locked) cover.close();   // locking hides the card straight away
    p.onLockToggle?.();
  });

  const api = {
    el: root,
    cover,
    update(next = {}) {
      p = next;
      const k = sig(p.role ?? null);
      if (k !== shownRole) {
        shownRole = k;
        frontNode = frontFor(p.role);
        // on the root so the cover's border and the team pill both pick it up
        const { color } = teamStyle(p.role);
        if (color) root.style.setProperty('--team', color); else root.style.removeProperty('--team');
      }

      cover.update({
        front: frontNode,
        backArt: p.backArt ?? '🎴',
        backLabel: p.backLabel ?? '㩒住睇',
        lockMode: 'peek',
        locked: !!p.locked,
        lockedMessage: '角色牌鎖咗，要自己解鎖',
        ariaLabel: '㩒住睇角色牌',
        openSound: 'flip',
        onOpen: (o) => p.onOpen?.(o),
      });

      hintEl.textContent = p.hint ?? (p.locked ? '已鎖定，㩒下面解鎖' : '㩒住先睇到，放手即刻冚返');

      lockBtn.hidden = !p.onLockToggle;
      lockBtn.disabled = !p.role;
      lockBtn.textContent = p.locked ? '🔒 已鎖 — 㩒一下解鎖' : '🔓 鎖定角色牌';
      lockBtn.classList.toggle('btn-locked', !!p.locked);
    },
    close: () => cover.close(),
    destroy() { cover.destroy(); root.remove(); },
  };

  api.update(p);
  return api;
}

export default RoleCard;
