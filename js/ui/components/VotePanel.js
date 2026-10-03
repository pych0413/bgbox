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
// `title`, `reveal.votes` ({ voter: target | null }) to list who voted for
// whom under each bar, and (#15):
//   `colorOf(pid)`  the colour for a seat's dot (假畫家 passes its PEN colours, so a dot matches the strokes);
//                   falls back to player.color
//   `secretChoice`  (default false) your own phone never prints whom you picked: the button reads 「確定投票」
//                   and the voted state 「已投 ✓」 with no row lit — a neighbour's glance learns nothing
//
// A vote is two taps on purpose — pick, then 確定 — so a stray thumb on a
// shared table does not lock somebody in.
//
// Ballots arrive within a second of each other at a 3-2-1 vote. Only the progress line changes then, and it
// is updated IN PLACE: the rows and the 確定 button are rebuilt only when what they show changes (candidates,
// myVote, the local pick, the reveal…), so a friend's press never lands on a button that was swapped out
// between press and release (#15).
// ============================================================

import { el, sig } from '../dom.js?v=1';
import { sfx } from '../../core/sfx.js?v=1';

const ABSTAIN = '@abstain';

export function VotePanel(props = {}) {
  let p = props;
  let pending = null;        // pid | ABSTAIN | null — picked but not yet committed
  let changing = false;      // user pressed 改票 and is choosing again
  let lastMyVote = Symbol('init');
  let lastRevealKey;          // undefined until the first update: a reveal already on screen is history
  let shownKey = null;        // what the rows were last built from

  const root = el('div', { class: 'c-votepanel' });
  // the progress line lives across rebuilds and is only ever edited in place
  const progText = el('span');
  const progPips = el('span', { class: 'c-votepanel-pips' });
  const progEl = el('div', { class: 'c-votepanel-progress' }, progText, progPips);
  let pipCount = -1;

  const byId = () => new Map((p.players ?? []).map((x) => [x.id, x]));
  const nameOf = (id) => byId().get(id)?.name ?? '?';
  const hasVoted = () => p.myVote !== undefined;

  function colorFor(player) {
    let c = null;
    try { c = player && typeof p.colorOf === 'function' ? p.colorOf(player.id) : null; } catch { c = null; }
    return c ?? player?.color ?? 'var(--cheese)';
  }

  function dot(player) {
    return el('span', { class: 'c-votepanel-dot', style: { '--seat': colorFor(player) } });
  }

  function paintProgress() {
    const { done = 0, total = 0 } = p.progress ?? {};
    progEl.hidden = !total || !!p.reveal;
    if (!total) return;
    const text = `已投 ${done}/${total}`;
    if (progText.textContent !== text) progText.textContent = text;
    if (pipCount !== total) {
      pipCount = total;
      progPips.replaceChildren(...Array.from({ length: total }, () => el('i')));
    }
    for (const [i, pip] of [...progPips.children].entries()) pip.classList.toggle('on', i < done);
  }

  function candidateList() {
    const players = byId();
    const ids = p.candidates ?? (p.players ?? []).map((x) => x.id);
    return ids.map((id) => players.get(id)).filter(Boolean);
  }

  // ----- ballot -----
  function ballot() {
    const voted = hasVoted() && !changing;
    const secret = !!p.secretChoice;
    // secretChoice: once your vote is in, no row stays lit — the highlight would say whom you picked
    const mine = voted ? (secret ? Symbol('hidden') : p.myVote) : pending;

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
      const on = mine === ABSTAIN || (voted && !secret && p.myVote === null);
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
      const said = secret ? '已投 ✓'
        : p.myVote === null ? '你揀咗棄權 ✓' : `你投咗 ${nameOf(p.myVote)} ✓`;
      action = el('div', { class: 'c-votepanel-done' },
        el('strong', { text: said }),
        el('span', { class: 'hint', text: '等緊其他人…' }),
        p.allowChange !== false
          ? el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button',
            onclick: () => { changing = true; pending = p.myVote === null ? ABSTAIN : p.myVote; paint(); },
          }, '改票')
          : null);
    } else {
      const label = !pending ? '揀一個先'
        : secret ? '確定投票'
          : pending === ABSTAIN ? '確定棄權' : `確定投俾 ${nameOf(pending)}`;
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
      progEl,
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

  /** Everything the rows and buttons show — NOT the progress, which is edited in place. */
  function structureKey() {
    const players = candidateList().map((pl) => [pl.id, pl.name, colorFor(pl)]);
    if (p.reveal) {
      const all = (p.players ?? []).map((pl) => [pl.id, pl.name, colorFor(pl), pl.seat ?? 0]);
      return sig(['reveal', p.reveal, all, p.candidates ?? null, p.title ?? null]);
    }
    return sig(['ballot', players, p.me ?? null, hasVoted() ? (p.myVote ?? '@null') : '@none', pending, changing,
      !!p.allowAbstain, p.allowChange !== false, p.title ?? null, !!p.secretChoice]);
  }

  function paint() {
    shownKey = structureKey();
    root.classList.toggle('is-reveal', !!p.reveal);
    root.replaceChildren(...(p.reveal ? revealView() : ballot()).filter(Boolean));
    paintProgress();
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
      if (structureKey() !== shownKey) paint();
      else paintProgress();
    },
    destroy() { root.remove(); },
  };

  api.update(p);
  return api;
}

export default VotePanel;
