// ============================================================
// RulesSheet — bottom-sheet modal built from `game.rules`.
//
//   RulesSheet.open(game)    game = a loaded game module { meta, rules }
//   RulesSheet.close()
//   RulesSheet.isOpen()
//
// Shows the blurb, the 30-second rules (rules.quick), the role glossary
// (rules.roles, grouped by team) and the full reference (rules.sections,
// collapsible). Closes on ✕, on a tap outside the sheet, and on Escape.
// ============================================================

import { el, lockScroll, unlockScroll } from '../dom.js?v=20261003164441';
import { teamStyle } from './RoleCard.js?v=20261003164441';

let current = null;

function quickBlock(quick) {
  if (!quick?.length) return null;
  return el('section', { class: 'c-rulessheet-block' },
    el('h3', { text: '⚡ 30 秒學識' }),
    el('ol', { class: 'c-rulessheet-quick' }, quick.map((line) => el('li', { text: line }))));
}

function rolesBlock(roles) {
  if (!roles?.length) return null;
  const groups = new Map();
  for (const r of roles) {
    const label = teamStyle(r).label ?? (r.team && !/^(#|rgb|hsl)/i.test(r.team) ? String(r.team) : '角色');
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(r);
  }
  return el('section', { class: 'c-rulessheet-block' },
    el('h3', { text: '🎭 角色' }),
    [...groups].map(([label, list]) => el('div', { class: 'c-rulessheet-group' },
      groups.size > 1 ? el('div', { class: 'c-rulessheet-team', text: label }) : null,
      list.map((r) => el('div', { class: 'c-rulessheet-role', style: { '--team': teamStyle(r).color ?? 'var(--line)' } },
        el('span', { class: 'c-rulessheet-emoji', text: r.emoji ?? '❔' }),
        el('div', {},
          el('strong', { text: r.name ?? '' }),
          r.text ? el('p', { text: r.text }) : null))))));
}

function sectionsBlock(sections) {
  if (!sections?.length) return null;
  return el('section', { class: 'c-rulessheet-block' },
    el('h3', { text: '📖 詳細規則' }),
    sections.map((s) => el('details', { class: 'c-rulessheet-section' },
      el('summary', { text: s.title ?? '' }),
      el('div', { class: 'c-rulessheet-body', text: s.body ?? '' }))));
}

function open(game) {
  close();
  const meta = game?.meta ?? {};
  const rules = game?.rules ?? {};

  const closeBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': '閂咗佢', onclick: close }, '✕');
  const body = el('div', { class: 'c-rulessheet-scroll' },
    meta.blurb ? el('p', { class: 'c-rulessheet-blurb', text: meta.blurb }) : null,
    quickBlock(rules.quick),
    rolesBlock(rules.roles),
    sectionsBlock(rules.sections),
    !rules.quick?.length && !rules.roles?.length && !rules.sections?.length
      ? el('p', { class: 'hint', text: '呢隻遊戲暫時未有規則說明。' }) : null);

  const sheet = el('div', { class: 'c-rulessheet-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '規則' },
    el('header', { class: 'c-rulessheet-head' },
      el('span', { class: 'c-rulessheet-icon', text: meta.emoji ?? '📖' }),
      el('h2', { text: meta.name ?? '規則' }),
      closeBtn),
    body);

  const root = el('div', { class: 'c-rulessheet', style: meta.accent ? { '--accent': meta.accent } : {} }, sheet);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  document.body.append(root);
  lockScroll();
  requestAnimationFrame(() => root.classList.add('in'));
  closeBtn.focus({ preventScroll: true });
  current = { root, onKey };
}

function close() {
  if (!current) return;
  const { root, onKey } = current;
  current = null;
  document.removeEventListener('keydown', onKey);
  unlockScroll();
  root.classList.remove('in');
  setTimeout(() => root.remove(), 180);
}

export const RulesSheet = { open, close, isOpen: () => !!current };
export default RulesSheet;
