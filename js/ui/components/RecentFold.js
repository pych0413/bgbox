// ============================================================
// RecentFold — public "what just happened" folds (#10): 📜 之前嘅投票, 🌅 昨晚 …
//
//   RecentFold({ recent, players }) → { el, update(props), destroy() }
//
//   recent   one fold or an array of them (the `view.recent` shape, DESIGN §15.2):
//            { id?, title, lines?: Line[], entries?: [{ title?, lines: Line[] }], open? }
//   Line     string | { text } | { from: pid, to: pid | null }   — a ballot reads 「阿明 → 小美」, null = 棄權
//   players  room players: names and colours for ballots
//
// Optional: `colorOf(pid)` — a game's own colour per seat (假畫家's pens), wins over player.color.
//
// Results flash for a few seconds on screen, but deduction runs on them all game long ("you voted 阿明 last
// round — why?"). One <details> per fold, CLOSED unless the fold says `open: true`: the facts are a tap away,
// never in the way. A fold keeps its open / closed state across updates — the <details> element stays, only
// its content is replaced, and only when it changed. Entries keep the game's order (put the newest first).
//
// Everything in here must be PUBLIC — the play screen renders `view.recent` the same way on every phone.
// ============================================================

import { el, sig } from '../dom.js?v=20261004005209';
import { recentFolds } from '../logic.js?v=20261004005209';

export function RecentFold(props = {}) {
  let p = props;
  const root = el('div', { class: 'c-recent' });
  const shown = new Map();      // key → { details, summary, body, sig }

  const byId = () => new Map((p.players ?? []).map((x) => [x.id, x]));
  const colorFor = (pl) => {
    let c = null;
    try { c = typeof p.colorOf === 'function' ? p.colorOf(pl.id) : null; } catch { c = null; }
    return c ?? pl?.color ?? 'var(--cheese)';
  };

  function who(players, pid) {
    const pl = players.get(pid);
    return [
      el('span', { class: 'c-recent-dot', style: { '--seat': pl ? colorFor(pl) : 'var(--text-dim)' } }),
      el('span', { class: 'c-recent-name', text: pl?.name ?? '?' }),
    ];
  }

  function lineNode(players, l) {
    if (l.from) {
      return el('li', { class: 'c-recent-vote' },
        ...who(players, l.from),
        el('span', { class: 'c-recent-arrow', text: '→' }),
        ...(l.to ? who(players, l.to) : [el('span', { class: 'c-recent-name is-abstain', text: '棄權' })]));
    }
    return el('li', { text: l.text });
  }

  function bodyOf(fold) {
    const players = byId();
    return fold.entries.map((e) => el('div', { class: 'c-recent-entry' },
      e.title ? el('div', { class: 'c-recent-entry-title', text: e.title }) : null,
      el('ul', { class: 'c-recent-lines' }, e.lines.map((l) => lineNode(players, l)))));
  }

  function paint() {
    const folds = recentFolds(p.recent);
    const keep = new Set(folds.map((f) => f.key));
    for (const [k, s] of shown) if (!keep.has(k)) { s.details.remove(); shown.delete(k); }
    const playersSig = sig((p.players ?? []).map((x) => [x.id, x.name, colorFor(x)]));
    for (const f of folds) {
      let s = shown.get(f.key);
      if (!s) {
        const summary = el('summary', {});
        const body = el('div', { class: 'c-recent-body' });
        const details = el('details', { class: 'c-recent-fold', open: f.open || null }, summary, body);
        s = { details, summary, body, sig: null };
        shown.set(f.key, s);
      }
      const k = sig([f.title, f.entries, playersSig]);
      if (k !== s.sig) {
        s.sig = k;
        s.summary.replaceChildren(el('span', { text: f.title }), el('small', { text: String(f.entries.length) }));
        s.body.replaceChildren(...bodyOf(f));
      }
      root.append(s.details);      // (re-)appending keeps the order of `recent` and never resets `open`
    }
    root.hidden = !folds.length;
  }

  const api = {
    el: root,
    update(next = {}) { p = next; paint(); },
    destroy() { shown.clear(); root.remove(); },
  };
  api.update(p);
  return api;
}

export default RecentFold;
