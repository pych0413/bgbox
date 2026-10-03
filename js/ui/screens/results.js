// ============================================================
// screens/results.js — who won and why, this game's points, the evening's
// scoreboard, and (host only) 再玩一局 / 換遊戲.
// ============================================================

import { el } from '../dom.js?v=20261003090241';
import { sfx } from '../../core/sfx.js?v=20261003090241';
import { Scoreboard } from '../components/index.js?v=20261003090241';

const CONFETTI = ['🎉', '✨', '🧀', '🎊', '⭐'];

function confetti() {
  const n = 22;
  return el('div', { class: 'confetti', 'aria-hidden': 'true' }, Array.from({ length: n }, (_, i) => el('i', {
    style: {
      '--x': `${(i * 100) / n + ((i * 37) % 7)}%`,
      '--d': `${2.6 + ((i * 53) % 18) / 10}s`,
      '--w': `${((i * 29) % 14) / 10}s`,
      '--r': `${(i % 2 ? 1 : -1) * (240 + ((i * 41) % 200))}deg`,
    },
    text: CONFETTI[i % CONFETTI.length],
  })));
}

export function mountResults(sh) {
  const { app, narrator } = sh;
  let shownKey = null;

  const hero = el('div');
  const linesCard = el('div', { class: 'card' });
  const pointsCard = el('div', { class: 'card' });
  const board = Scoreboard({});
  const boardCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '今晚戰績' })), board.el);

  const againBtn = el('button', {
    class: 'btn btn-primary btn-lg', type: 'button',
    onclick: async () => {
      narrator.prime();   // a fresh tap is a free chance to keep iOS speech unlocked
      try { await app.results.again(); } catch (err) { console.error(err); }
    },
  }, '🔁 再玩一局');
  const lobbyBtn = el('button', {
    class: 'btn btn-ghost btn-lg', type: 'button',
    onclick: async () => { try { await app.results.toLobby(); } catch (err) { console.error(err); } },
  }, '🎲 換遊戲');
  const waiting = el('p', { class: 'status', text: '等房主揀，再玩一局定換遊戲…' });
  const leaveBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: { margin: '1rem auto 0' }, onclick: () => sh.leave() }, '🚪 離開房間');

  // a table timer keeps running between games (T1): its strip stays on screen here too
  const timerStrip = sh.timer?.strip?.() ?? null;
  const timerRow = el('div', { class: 'results-tools' }, timerStrip, sh.timer?.button?.() ?? null);
  const root = el('section', { class: 'screen results', 'data-screen': 'results' },
    timerRow, hero, linesCard, pointsCard, boardCard, againBtn, lobbyBtn, waiting, leaveBtn);

  const confettiHost = el('div');
  root.append(confettiHost);

  function paint(st) {
    const room = st.room;
    const res = room.lastResult;
    const names = new Map(room.players.map((p) => [p.id, p]));
    const meta = sh.gameMeta(res?.gameId ?? room.gameId) ?? {};
    const key = JSON.stringify([res, room.players.map((p) => [p.id, p.name, p.color])]);
    if (key === shownKey) return;
    const first = shownKey === null;
    shownKey = key;

    const winners = (res?.winners ?? []).map((id) => names.get(id)).filter(Boolean);
    const winnerIds = new Set(res?.winners ?? []);
    const iWon = (st.mySeats ?? []).some((id) => winnerIds.has(id));

    hero.replaceChildren(...[
      el('div', { class: 'results-trophy', text: winners.length ? '🏆' : '🤝' }),
      el('h2', { text: winners.length ? `${meta.emoji ?? ''} ${meta.name ?? ''} — 贏家` : `${meta.emoji ?? ''} ${meta.name ?? ''} — 冇人贏` }),
      el('div', { class: 'winners' }, winners.map((p, i) => el('span', {
        class: 'winner-chip', style: { '--seat': p.color ?? 'var(--cheese)', '--delay': `${i * 120}ms` },
        text: p.name,
      }))),
      res?.summary ? el('p', { class: 'results-summary', text: res.summary }) : null,
    ].filter(Boolean));

    const lines = res?.lines ?? [];
    linesCard.hidden = !lines.length;
    linesCard.replaceChildren(
      el('div', { class: 'card-head' }, el('h3', { text: '點解會咁' })),
      el('ul', { class: 'results-lines' }, lines.map((l) => el('li', { text: l }))));

    const pts = Object.entries(res?.points ?? {}).filter(([id]) => names.has(id));
    pointsCard.hidden = !pts.length;
    pointsCard.replaceChildren(
      el('div', { class: 'card-head' }, el('h3', { text: '呢局得分' })),
      el('div', { class: 'points-list' }, pts
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => el('span', { class: 'tag' }, names.get(id).name, el('b', { text: n > 0 ? `+${n}` : String(n) })))));

    // celebrate once, for people on the winning side; everyone else gets the fanfare only
    if (first) {
      sfx(iWon ? 'win' : 'reveal');
      if (iWon) {
        confettiHost.replaceChildren(confetti());
        setTimeout(() => confettiHost.replaceChildren(), 6000);
      }
    }
  }

  return {
    el: root,
    update(st) {
      const room = st.room;
      if (!room) return;
      paint(st);
      board.update({
        players: room.players, scoreboard: room.scoreboard, history: room.history,
        games: sh.gamesById(), me: st.activeSeat ?? st.mySeats?.[0],
      });
      againBtn.hidden = !st.isHost;
      lobbyBtn.hidden = !st.isHost;
      waiting.hidden = st.isHost;
    },
    destroy() { board.destroy(); },
  };
}
