// ============================================================
// Scoreboard — evening totals and the per-game history.
//
//   Scoreboard({ players, scoreboard, history })
//     → { el, update(props), destroy() }
//
//   scoreboard  { [pid]: { played, wins, points } }
//   history     [{ gameId, winners: [pid], summary, void? }]   oldest first (void: 呢鋪唔計)
//
// Optional extras: `games` ({ [gameId]: meta }) so history rows can show the
// game's emoji and name, `me` (highlights your row), `showHistory` (default true).
//
// Sorted by points, then wins, then fewer games played, then seat order.
// Ties share a rank. Medals only for something won (#39, logic.scoreboardMode): points above 0, or wins
// on a night where no game awarded points — and on such a night the 分 column (all zeros) is left out.
// History rows: `{ gameId, winners, summary, void?, noScore? }` (noScore: a tool that does not judge,
// 「唔計輸贏」).
// ============================================================

import { el, sig } from '../dom.js?v=20261004005209';
import { rankRows, scoreboardMode } from '../logic.js?v=20261004005209';

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

export function Scoreboard(props = {}) {
  let p = props;
  let shown = null;
  const root = el('div', { class: 'c-scoreboard' });

  function paint() {
    const key = sig([p.players, p.scoreboard, p.history, p.games, p.me, p.showHistory]);
    if (key === shown) return;
    shown = key;

    const rows = rankRows(p.players, p.scoreboard);
    const anyPlayed = rows.some((r) => r.played > 0);
    const mode = scoreboardMode(rows);
    const byId = new Map((p.players ?? []).map((x) => [x.id, x]));
    // a medal for something won; a rank number for the rest of the scorers; '·' for nothing at all
    const rankText = (r) => (!anyPlayed || !mode.earned(r) ? '·' : (MEDAL[r.rank] ?? String(r.rank)));

    const table = el('table', { class: 'c-scoreboard-table' },
      el('thead', {}, el('tr', {},
        el('th', { text: '' }), el('th', { class: 'l', text: '玩家' }),
        el('th', { text: '局' }), el('th', { text: '贏' }), mode.points ? el('th', { text: '分數' }) : null)),
      el('tbody', {}, rows.map((r) => el('tr', { class: r.pl.id === p.me ? 'me' : '' },
        el('td', { class: 'rk', text: rankText(r) }),
        el('td', { class: 'l' },
          el('span', { class: 'c-scoreboard-dot', style: { '--seat': r.pl.color ?? 'var(--cheese)' } }),
          el('span', { class: 'nm', text: r.pl.name + (r.pl.id === p.me ? '（你）' : '') })),
        el('td', { text: String(r.played) }),
        el('td', { text: String(r.wins) }),
        mode.points ? el('td', { class: 'pts', text: String(r.points) }) : null))));

    const hist = (p.history ?? []).slice().reverse();
    const history = p.showHistory === false || !hist.length ? null : el('div', { class: 'c-scoreboard-history' },
      el('h4', { text: '今晚玩過' }),
      el('ol', {}, hist.map((h, i) => {
        const g = p.games?.[h.gameId];
        const names = (h.winners ?? []).map((id) => byId.get(id)?.name).filter(Boolean);
        return el('li', {},
          el('span', { class: 'g', text: `${g?.emoji ?? '🎲'} ${g?.name ?? h.gameId}` }),
          el('span', { class: 'w', text: h.void ? '🚫 唔計' : h.noScore ? '唔計輸贏' : names.length ? `🏆 ${names.join('、')}` : '冇人贏' }),
          h.summary ? el('span', { class: 'hint s', text: h.summary }) : null);
      })));

    root.replaceChildren(table, ...(history ? [history] : []));
  }

  const api = {
    el: root,
    update(next = {}) { p = next; paint(); },
    destroy() { root.remove(); },
  };
  api.update(p);
  return api;
}

export default Scoreboard;
