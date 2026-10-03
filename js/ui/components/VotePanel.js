// ============================================================
// VotePanel — secret vote → 「已投 4/6」 → simultaneous reveal with tallies.
//
//   VotePanel({ players, candidates: [pid], me, myVote, allowAbstain,
//               progress: { done, total }, reveal: null | { counts, top },
//               onVote(pid | null) })
//     → { el, update(props), destroy() }
//
// `myVote` (from the engine's per-seat view):
//     undefined / absent → this seat has not voted yet
//     null               → this seat abstained
//     'p3'               → this seat voted for p3
// That mirrors engine-kit's tally(), where a missing voter has not voted and
// null is an abstention. Over JSON a missing key and `undefined` look the same,
// so a view should write `myVote: state.votes[pid]` and nothing cleverer.
//
// Optional extras: `allowChange` (default true: a 改票 link after voting),
// `title`, and `reveal.votes` ({ voter: target | null }) to list who voted for
// whom under each bar.
//
// A vote is two taps on purpose — pick, then 確定 — so a stray thumb on a
// shared table does not lock somebody in.
// ============================================================

import { el } from '../dom.js?v=20261003075613';
import { sfx } from '../../core/sfx.js?v=20261003075613';

const ABSTAIN = '@abstain';

export function VotePanel(props = {}) {
  let p = props;
  let pending = null;        // pid | ABSTAIN | null — picked but not yet committed
  let changing = false;      // user pressed 改票 and is choosing again
  let lastMyVote = Symbol('init');
  let lastRevealKey;          // undefined until the first update: a reveal already on screen is history

  const root = el('div', { class: 'c-votepanel' });

  const byId = () => new Map((p.players ?? []).map((x) => [x.id, x]));
  const nameOf = (id) => byId().get(id)?.name ?? '?';
  const hasVoted = () => p.myVote !== undefined;

  function dot(player) {
    return el('span', { class: 'c-votepanel-dot', style: { '--seat': player?.color ?? 'var(--cheese)' } });
  }

  function progressNode() {
    const { done = 0, total = 0 } = p.progress ?? {};
    if (!total) return null;
    const pips = [];
    for (let i = 0; i < total; i++) pips.push(el('i', { class: i < done ? 'on' : '' }));
    return el('div', { class: 'c-votepanel-progress' },
      el('span', { text: `已投 ${done}/${total}` }),
      el('span', { class: 'c-votepanel-pips' }, pips));
  }

  function candidateList() {
    const players = byId();
    const ids = p.candidates ?? (p.players ?? []).map((x) => x.id);
    return ids.map((id) => players.get(id)).filter(Boolean);
  }

  // ----- ballot -----
  function ballot() {
    const voted = hasVoted() && !changing;
    const mine = voted ? p.myVote : pending;

    const rows = candidateList().map((pl) => {
      const on = mine === pl.id;
      return el('button', {
        class: 'c-votepanel-opt' + (on ? ' on' : ''), type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        disabled: voted,
        onclick: () => { pending = pl.id; sfx('tap'); paint(); },
      }, dot(pl),
      el('span', { class: 'c-votepanel-name', text: pl.name + (pl.id === p.me ? '（你）' : '') }),
      on ? el('span', { class: 'c-votepanel-tick', text: voted ? '✓' : '●' }) : null);
    });

    if (p.allowAbstain) {
      const on = mine === ABSTAIN || (voted && p.myVote === null);
      rows.push(el('button', {
        class: 'c-votepanel-opt is-abstain' + (on ? ' on' : ''), type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        disabled: voted,
        onclick: () => { pending = ABSTAIN; sfx('tap'); paint(); },
      }, el('span', { class: 'c-votepanel-name', text: '棄權' }),
      on ? el('span', { class: 'c-votepanel-tick', text: voted ? '✓' : '●' }) : null));
    }

    let action;
    if (voted) {
      const what = p.myVote === null ? '棄權' : nameOf(p.myVote);
      action = el('div', { class: 'c-votepanel-done' },
        el('strong', { text: p.myVote === null ? '你揀咗棄權 ✓' : `你投咗 ${what} ✓` }),
        el('span', { class: 'hint', text: '等緊其他人…' }),
        p.allowChange !== false
          ? el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => { changing = true; pending = p.myVote === null ? ABSTAIN : p.myVote; paint(); },
          }, '改票')
          : null);
    } else {
      const label = pending === ABSTAIN ? '確定棄權'
        : pending ? `確定投俾 ${nameOf(pending)}` : '揀一個先';
      action = el('button', {
        class: 'btn btn-primary', type: 'button', disabled: !pending,
        onclick: () => {
          if (!pending) return;
          const v = pending === ABSTAIN ? null : pending;
          changing = false;
          sfx('vote');
          p.onVote?.(v);
        },
      }, label);
    }

    return [
      p.title ? el('h3', { class: 'c-votepanel-title', text: p.title }) : null,
      el('div', { class: 'c-votepanel-list' }, rows),
      action,
      progressNode(),
    ];
  }

  // ----- reveal -----
  function revealView() {
    const { counts = {}, top = [], votes } = p.reveal;
    const players = byId();
    const ids = new Set([...(p.candidates ?? []), ...Object.keys(counts)]);
    const entries = [...ids]
      .map((id) => ({ id, pl: players.get(id), n: counts[id] ?? 0 }))
      .filter((e) => e.pl)
      .sort((a, b) => b.n - a.n || (a.pl.seat ?? 0) - (b.pl.seat ?? 0));
    const max = Math.max(1, ...entries.map((e) => e.n));

    const rows = entries.map((e, i) => {
      const isTop = top.includes(e.id);
      const voters = votes
        ? Object.entries(votes).filter(([, t]) => t === e.id).map(([v]) => players.get(v)).filter(Boolean)
        : [];
      return el('div', { class: 'c-votepanel-row' + (isTop ? ' top' : ''), style: { '--delay': `${i * 90}ms` } },
        el('div', { class: 'c-votepanel-rowhead' },
          dot(e.pl),
          el('span', { class: 'c-votepanel-name', text: e.pl.name }),
          isTop ? el('span', { class: 'c-votepanel-flag', text: '🎯' }) : null,
          el('span', { class: 'c-votepanel-n', text: String(e.n) })),
        el('div', { class: 'c-votepanel-bar' },
          el('i', { style: { width: `${(e.n / max) * 100}%` } })),
        voters.length
          ? el('div', { class: 'c-votepanel-voters' }, voters.map((v) => el('span', { class: 'c-votepanel-chip' }, dot(v), v.name)))
          : null);
    });

    return [
      p.title ? el('h3', { class: 'c-votepanel-title', text: p.title }) : null,
      el('div', { class: 'c-votepanel-results' }, rows),
      top.length
        ? el('p', { class: 'c-votepanel-verdict', text: `最高票：${top.map(nameOf).join('、')}` })
        : el('p', { class: 'c-votepanel-verdict', text: '冇人有票' }),
    ];
  }

  function paint() {
    root.classList.toggle('is-reveal', !!p.reveal);
    root.replaceChildren(...(p.reveal ? revealView() : ballot()).filter(Boolean));
  }

  const api = {
    el: root,
    update(next = {}) {
      p = next;
      // a committed vote (or a fresh round) clears the local pick
      if (p.myVote !== lastMyVote) {
        lastMyVote = p.myVote;
        pending = null;
        changing = false;
      }
      const rk = p.reveal ? JSON.stringify(p.reveal) : null;
      if (lastRevealKey !== undefined && rk && rk !== lastRevealKey) sfx('reveal');
      lastRevealKey = rk;
      paint();
    },
    destroy() { root.remove(); },
  };

  api.update(p);
  return api;
}

export default VotePanel;
