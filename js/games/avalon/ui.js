// ============================================================
// 阿瓦隆 — game UI.   mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view: update() may be called with the same view any number of
// times and must be idempotent. The persistent chrome (quest track, rejection
// track, seat chips, my identity card, the proposal log) is repainted from the
// view every time; the body under it is rebuilt only when (phase, proposal /
// quest number, my part in it) changes, so a Cover a player is holding down,
// or a half-picked team, is never torn out from under their finger.
//
// Only api.components (Cover, PlayerPicker, Timer) and plain DOM are used.
// Every string comes from script.js. Flow and anti-tell reasoning:
// docs/games/avalon.md.
//
// Anti-tell, in this file:
//  - the identity card has one layout for every role (the same five rows, the
//    names grid always reserves its space)
//  - the quest screen is the same two tiles for good and evil; for good the
//    「失敗」 tile is simply inert (same look, same tap sound)
//  - the assassination screen is the same picker for every seat; only the
//    Assassin's confirm is real, everybody else's records a decoy
// ============================================================

import * as S from './script.js?v=20261003102525';

const T = S.T;

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) n.style.setProperty(sk, sv); else n.style[sk] = sv;
      }
    } else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export function mount(root, api) {
  const { Cover, PlayerPicker, Timer } = api.components;
  const byId = (pid) => api.players.find((p) => p.id === pid);
  const nameOf = (pid) => byId(pid)?.name ?? '?';
  const colorOf = (pid) => byId(pid)?.color ?? '#f5c518';

  let view = null;
  let ctx = {};
  let bodyKey = '';
  let body = null;
  const timers = new Set();      // setTimeout handles owned by the UI

  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  };
  const rerender = () => { if (body && view) body.update(view, ctx); };

  /** Debounce for buttons that send an action: blocks re-taps while the answer is in flight, lets go after 3.5 s. */
  function sendGuard() {
    let on = false;
    return {
      get busy() { return on; },
      fire(send) {
        if (on) return false;
        on = true;
        send();
        later(() => { on = false; rerender(); }, 3500);
        return true;
      },
    };
  }

  // ---------- persistent chrome ----------

  const questRow = h('div', { class: 'av-quests', role: 'list', 'aria-label': '任務' });
  const trackRow = h('div', { class: 'av-track', 'aria-label': T.board.track });
  const trackLabel = h('span', { class: 'av-track-label', text: T.board.track });
  const ladyBadge = h('div', { class: 'av-lady-badge' });
  const board = h('section', { class: 'av-board' },
    questRow,
    h('div', { class: 'av-board-sub' }, h('div', { class: 'av-track-wrap' }, trackLabel, trackRow), ladyBadge));
  const roster = h('div', { class: 'av-roster', role: 'list', 'aria-label': '座位' });
  const bodyHost = h('div', { class: 'av-body' });
  const miniSlot = h('div', { class: 'av-mini' });
  const historyBody = h('div', { class: 'av-history-body' });
  const historySum = h('summary', { text: T.history.title });
  const historyBox = h('details', { class: 'av-history' }, historySum, historyBody);
  const deckRow = h('div', { class: 'av-deck' });
  const wrap = h('div', { class: 'av' }, board, roster, bodyHost, miniSlot, historyBox, deckRow);
  root.replaceChildren(wrap);

  let boardSig = '';
  function paintBoard(v) {
    const sig = JSON.stringify([v.board, v.track, v.lady?.holder, v.phase === 'over']);
    if (sig === boardSig) return;
    boardSig = sig;
    questRow.replaceChildren(...v.board.sizes.map((size, i) => {
      const r = v.board.results[i];
      const now = r === null && i + 1 === v.board.questNo && v.phase !== 'over';
      return h('div', {
        class: 'av-q' + (r === true ? ' ok' : r === false ? ' bad' : '') + (now ? ' now' : ''), role: 'listitem',
        'aria-label': `任務 ${i + 1}：${size} 人${r === true ? '，成功' : r === false ? '，失敗' : ''}`,
      },
      h('span', { class: 'av-q-no', text: String(i + 1) }),
      h('span', { class: 'av-q-size', text: r === null ? String(size) : (r ? '✓' : '✗') }),
      h('span', { class: 'av-q-sub', text: `${size} 人` }),
      v.board.need[i] > 1 ? h('span', { class: 'av-q-two', title: T.board.twoFail, text: '2✖' }) : null);
    }));
    trackRow.replaceChildren(...Array.from({ length: v.track.max }, (_, i) => h('i', {
      class: (i < v.track.rejects ? 'on' : '') + (i === v.track.max - 1 ? ' last' : ''),
    })));
    trackLabel.textContent = `${T.board.track} ${T.board.trackSuffix(v.track.rejects)}`;
    ladyBadge.hidden = !v.lady;
    if (v.lady) ladyBadge.textContent = `🌊 ${T.board.lady}：${nameOf(v.lady.holder)}`;
  }

  let rosterSig = '';
  function paintRoster(v) {
    const team = v.vote?.team ?? v.voted?.team ?? v.quest?.team ?? v.outcome?.team ?? [];
    const sig = JSON.stringify([v.order, v.leader, v.lady?.holder, team, v.me, api.players.map((p) => [p.id, p.name, p.color])]);
    if (sig === rosterSig) return;
    rosterSig = sig;
    roster.replaceChildren(...v.order.map((pid) => h('div', {
      class: 'av-seat' + (pid === v.leader ? ' leader' : '') + (team.includes(pid) ? ' team' : '') + (pid === v.me ? ' me' : ''),
      role: 'listitem', style: { '--seat': colorOf(pid) },
    },
    h('span', { class: 'av-seat-dot' }),
    h('span', { class: 'av-seat-name', text: nameOf(pid) }),
    pid === v.leader ? h('span', { class: 'av-seat-tag', title: T.board.leader, text: '👑' }) : null,
    v.lady && pid === v.lady.holder ? h('span', { class: 'av-seat-tag', title: T.board.lady, text: '🌊' }) : null,
    team.includes(pid) ? h('span', { class: 'av-seat-tag', title: T.board.team, text: '🛡' }) : null)));
  }

  let historySig = '';
  function paintHistory(v) {
    const sig = JSON.stringify([v.history, v.quests]);
    if (sig === historySig) return;
    historySig = sig;
    historyBox.hidden = v.history.length === 0;
    const rows = [];
    let lastQ = 0;
    let nth = 0;
    for (const e of v.history) {
      if (e.q !== lastQ) {
        lastQ = e.q;
        nth = 0;
        const q = v.quests.find((x) => x.no === e.q);
        rows.push(h('div', { class: 'av-hq' }, `任務 ${e.q}`,
          q ? h('span', { class: q.success ? 'ok' : 'bad', text: ` ${q.success ? '✓ 成功' : '✗ 失敗'}（${q.successes} 成功 · ${q.fails} 失敗）` }) : null));
      }
      nth += 1;
      const rejecters = v.order.filter((p) => e.votes[p] === 'reject');
      rows.push(h('div', { class: 'av-hp' + (e.approved ? ' ok' : ' bad') },
        h('b', { text: `${T.history.row(e.q, nth)} · ${e.approved ? T.history.approved : T.history.rejected} ${e.approves}:${e.rejects}` }),
        h('span', { text: ` ${nameOf(e.leader)} 揀 ${e.team.map(nameOf).join('、')}` }),
        rejecters.length ? h('small', { text: `　${T.voted.no}：${rejecters.map(nameOf).join('、')}` }) : null));
    }
    historyBody.replaceChildren(...rows);
  }

  let deckSig = '';
  function paintDeck(v) {
    const sig = JSON.stringify(v.deck);
    if (sig === deckSig) return;
    deckSig = sig;
    const chip = (d) => h('span', { class: `av-deck-chip ${S.teamOf(d.role)}` }, S.ROLES[d.role].emoji, ` ${S.ROLES[d.role].name}`, d.count > 1 ? ` ×${d.count}` : '');
    deckRow.replaceChildren(
      h('span', { class: 'av-deck-label', text: T.deck }),
      ...v.deck.filter((d) => S.teamOf(d.role) === 'good').map(chip),
      h('span', { class: 'av-deck-sep', text: '｜' }),
      ...v.deck.filter((d) => S.teamOf(d.role) === 'evil').map(chip));
  }

  // ---------- small shared builders ----------

  function makeTimer() {
    let t = null;
    const host = h('div', { class: 'av-timer' });
    return {
      el: host,
      update(v, c, warnAt) {
        if (v.deadline == null) {
          if (t) { t.destroy(); t = null; }
          host.hidden = true;
          return;
        }
        host.hidden = false;
        const props = { deadline: v.deadline, now: api.now, label: v.timerLabel ?? '', paused: !!c?.paused, warnAt };
        if (!t) { t = Timer(props); host.append(t.el); } else t.update(props);
      },
      destroy() { if (t) t.destroy(); host.remove(); },
    };
  }

  const waitBlock = (emoji) => {
    const t = h('p', { class: 'av-wait-text' });
    const el = h('div', { class: 'av-wait' }, h('div', { class: 'av-wait-emoji', text: emoji }), t);
    return { el, set(s) { t.textContent = s; } };
  };

  const chipsFor = (pids, cls = '') => h('div', { class: `av-chips ${cls}`.trim() }, pids.map((pid) => h('span', {
    class: 'av-chip', style: { '--seat': colorOf(pid) },
  }, h('i', { class: 'av-chip-dot' }), nameOf(pid))));

  /** A player picker with a second, armed tap when `armed` is set (the shot, the Lady). */
  function makePicker({ count, confirmLabel, armLabel = null, exclude = () => [], onSend }) {
    let sel = [];
    let armed = false;
    let handle = null;
    const guard = sendGuard();
    const picker = PlayerPicker({ players: [], me: null, count, exclude: [], selected: [], disabled: false });
    let last = null;
    const paint = (v, extra = {}) => {
      last = { v, extra };
      picker.update({
        players: v.order.map((id) => byId(id)).filter(Boolean),
        me: v.me, count, exclude: exclude(v), selected: sel, disabled: guard.busy || !!extra.disabled,
        confirmLabel: armed && armLabel ? armLabel : (typeof confirmLabel === 'function' ? confirmLabel(sel, v) : confirmLabel),
        onChange(s) { sel = s; armed = false; clearTimeout(handle); if (last) paint(last.v, last.extra); },
        onConfirm(s) {
          if (s.length < (extra.min ?? count)) return;
          if (armLabel && !armed) {
            armed = true;
            handle = later(() => { armed = false; if (last) paint(last.v, last.extra); }, 3000);
            paint(v, extra);
            return;
          }
          armed = false;
          clearTimeout(handle);
          guard.fire(() => onSend(s));
          paint(v, extra);
        },
      });
    };
    return { el: picker.el, update: paint, get selected() { return sel; }, destroy() { clearTimeout(handle); picker.destroy(); } };
  }

  // ---------- the identity card (one layout for every role) ----------

  /** The five rows of a card face. The names grid always keeps its height, so no role has a smaller card. */
  function makeFace() {
    const roleEl = h('div', { class: 'av-face-role' });
    const teamEl = h('span', { class: 'av-face-team' });
    const labelEl = h('div', { class: 'av-face-label' });
    const namesEl = h('div', { class: 'av-face-names' });
    const noteEl = h('div', { class: 'av-face-note' });
    const el = h('div', { class: 'av-face' }, roleEl, teamEl, labelEl, namesEl, noteEl);
    let sig = '';
    return {
      el,
      set(mine) {
        const s2 = JSON.stringify(mine);
        if (s2 === sig) return;
        sig = s2;
        const info = S.ROLES[mine.role];
        const team = S.TEAM[info.team];
        el.style.setProperty('--team', team.color);
        el.classList.toggle('evil', info.team === 'evil');
        roleEl.textContent = `${info.emoji} ${info.name}`;
        teamEl.textContent = team.name;
        const k = mine.knows;
        const C = T.card;
        let label = C.knowsNone;
        let note = C.knowsNoneNote;
        if (k.kind === 'seesEvil') { label = C.knowsEvil; note = C.knowsEvilNote; }
        else if (k.kind === 'seesMerlin') { label = k.pids.length === 1 ? C.knowsMerlin1 : C.knowsMerlin2; note = k.pids.length === 1 ? info.short : C.knowsMerlinNote; }
        else if (k.kind === 'allies') { label = C.knowsAllies; note = k.pids.length ? C.knowsAlliesNote : C.knowsAlliesNone; }
        else if (k.kind === 'alone') { label = C.knowsAlone; note = C.knowsAloneNote; }
        labelEl.textContent = label;
        noteEl.textContent = note;
        namesEl.replaceChildren(...k.pids.map((pid) => h('span', { class: 'av-chip', style: { '--seat': colorOf(pid) } },
          h('i', { class: 'av-chip-dot' }), nameOf(pid))));
        namesEl.dataset.count = String(k.pids.length);
      },
    };
  }

  /** A hold-to-peek card around a face. Releasing it calls onRelease() once per press. */
  function makeCard({ backLabel, onRelease, big }) {
    const face = makeFace();
    const props = { front: face.el, backArt: '🏰', backLabel, lockMode: 'none', locked: false, ariaLabel: backLabel, onOpen: null };
    let peeked = false;
    props.onOpen = (open) => {
      if (open) { peeked = true; return; }
      if (peeked) { peeked = false; onRelease?.(); }
    };
    const cover = Cover(props);
    const el = h('div', { class: 'av-card' + (big ? ' big' : '') }, cover.el);
    return {
      el,
      set(mine) { face.set(mine); cover.update(props); },
      close: () => cover.close(),
      destroy: () => cover.destroy(),
    };
  }

  // ---------- bodies ----------

  function revealBody(seat) {
    const timer = makeTimer();
    const note = h('p', { class: 'av-note' });
    const guard = sendGuard();
    let sentSeen = false;
    const send = () => { if (view?.mine && !view.mine.seen && !sentSeen) { sentSeen = true; api.send({ type: 'seen' }); } };
    const card = seat ? makeCard({
      backLabel: T.card.back, big: true,
      // timed window: a release is just a harmless "I looked" (every seat sends the same thing)
      onRelease: () => { if (view?.opts.reveal === 'timer') send(); },
    }) : null;
    const doneBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-act': 'seen', text: T.reveal.done });
    doneBtn.addEventListener('click', () => { guard.fire(() => { doneBtn.disabled = true; sentSeen = true; api.send({ type: 'seen' }); }); });
    const el = h('div', { class: 'av-stack' }, h('h2', { class: 'av-h', text: T.reveal.title }), card?.el, timer.el, doneBtn, note);
    return {
      el,
      update(v, c) {
        if (card) card.set(v.mine);
        timer.update(v, c, [5]);
        const tap = v.opts.reveal === 'tap';
        doneBtn.hidden = !(seat && tap);
        if (v.mine?.seen) { doneBtn.disabled = true; doneBtn.textContent = T.reveal.doneWait; } else { doneBtn.disabled = guard.busy; doneBtn.textContent = T.reveal.done; sentSeen = false; }
        note.textContent = !seat ? T.reveal.noteTable : tap ? T.reveal.noteTap : T.reveal.note;
      },
      destroy() { card?.destroy(); timer.destroy(); },
    };
  }

  function pickBody(isLeader) {
    const timer = makeTimer();
    const head = h('h2', { class: 'av-h' });
    const hint = h('p', { class: 'av-note' });
    const banner = h('div', { class: 'av-banner' });
    const wait = isLeader ? null : waitBlock('🧭');
    const slot = h('div', { class: 'av-picker' });
    let pk = null;   // the picker is built once the view says how many seats to pick
    const ensurePicker = (v) => {
      if (pk && pk.size === v.pick.size) return;
      pk?.picker.destroy();
      const made = makePicker({
        count: v.pick.size,
        confirmLabel: T.pick.confirm(v.pick.size),
        onSend: (team) => { api.send({ type: 'pick', team }); },
      });
      pk = { size: v.pick.size, picker: made };
      slot.replaceChildren(made.el);
    };
    const el = h('div', { class: 'av-stack' }, head, banner, timer.el, isLeader ? hint : wait.el, slot);
    return {
      el,
      update(v, c) {
        head.textContent = T.pick.title(v.pick.size);
        hint.textContent = T.pick.mineHint(v.pick.size);
        const lines = [];
        if (v.redo) lines.push(T.redo.pick);
        if (v.pick.need > 1) lines.push(T.pick.twoFail);
        if (v.track.rejects >= v.track.max - 1) lines.push(T.pick.lastChance);
        banner.hidden = !lines.length;
        banner.classList.toggle('danger', v.track.rejects >= v.track.max - 1);
        banner.textContent = lines.join(' ');
        timer.update(v, c, [30]);
        if (isLeader) { ensurePicker(v); pk.picker.update(v); } else {
          wait.set(v.me === null ? T.pick.table(nameOf(v.leader)) : T.pick.others(nameOf(v.leader)));
          slot.replaceChildren();
        }
      },
      destroy() { pk?.picker.destroy(); timer.destroy(); },
    };
  }

  function voteBody() {
    let pending = null;
    const guard = sendGuard();
    const head = h('h2', { class: 'av-h', text: T.vote.title });
    const teamLine = h('div', { class: 'av-teamline' });
    const hint = h('p', { class: 'av-note', text: T.vote.hint });
    const redo = h('div', { class: 'av-banner', text: T.redo.vote });
    const mk = (kind, label) => {
      const b = h('button', { class: `av-vote ${kind}`, type: 'button', text: label, 'aria-pressed': 'false', 'data-act': `vote-${kind}` });
      b.addEventListener('click', () => {
        if (view?.vote?.mine && !changing) return;
        pending = kind;
        api.sfx('tap');
        rerender();
      });
      return b;
    };
    let changing = false;
    const approve = mk('approve', T.vote.approve);
    const reject = mk('reject', T.vote.reject);
    const confirm = h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-act': 'vote-confirm' });
    confirm.addEventListener('click', () => {
      if (!pending) return;
      guard.fire(() => { api.sfx('vote'); changing = false; api.send({ type: 'vote', vote: pending }); });
    });
    const status = h('div', { class: 'av-voted' });
    const changeBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-act': 'vote-change', text: T.vote.change });
    changeBtn.addEventListener('click', () => { changing = true; pending = view?.vote?.mine ?? null; rerender(); });
    const progress = h('p', { class: 'av-progress' });
    const choices = h('div', { class: 'av-votes' }, approve, reject);
    const el = h('div', { class: 'av-stack' }, head, redo, teamLine, choices, confirm, status, changeBtn, progress, hint);
    let lastMine;
    return {
      el,
      update(v) {
        const vo = v.vote;
        redo.hidden = !v.redo;
        teamLine.replaceChildren(h('span', { class: 'av-teamline-label', text: T.board.team }), chipsFor(vo.team));
        const seat = v.me !== null;
        const mine = vo.mine;
        if (mine !== lastMine) { lastMine = mine; changing = false; pending = null; }
        const locked = seat && mine && !changing;
        const shown = locked ? mine : pending;
        for (const [b, kind] of [[approve, 'approve'], [reject, 'reject']]) {
          b.classList.toggle('on', shown === kind);
          b.setAttribute('aria-pressed', shown === kind ? 'true' : 'false');
          b.disabled = !seat || !!locked;
        }
        choices.hidden = !seat;
        confirm.hidden = !seat || !!locked;
        confirm.disabled = !pending || guard.busy;
        confirm.textContent = pending === 'approve' ? T.vote.confirmApprove : pending === 'reject' ? T.vote.confirmReject : T.vote.pick;
        status.hidden = !locked;
        status.textContent = locked ? `${T.vote.voted(mine)}　${T.vote.waiting}` : '';
        changeBtn.hidden = !locked;
        progress.textContent = T.vote.progress(vo.progress.done, vo.progress.total);
      },
      destroy() {},
    };
  }

  function votedBody(isLeader) {
    const guard = sendGuard();
    const verdict = h('div', { class: 'av-verdict' });
    const tally = h('div', { class: 'av-tally' });
    const grid = h('div', { class: 'av-votegrid' });
    const trackLine = h('p', { class: 'av-note' });
    const needLine = h('p', { class: 'av-note' });
    const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-act': 'continue' });
    btn.addEventListener('click', () => { guard.fire(() => { btn.disabled = true; api.send({ type: 'continue' }); }); });
    const waitTxt = h('p', { class: 'av-note' });
    later(() => api.sfx('reveal'), 250);
    const el = h('div', { class: 'av-stack av-voted-screen' }, verdict, tally, grid, needLine, trackLine, isLeader ? btn : waitTxt);
    return {
      el,
      update(v) {
        const r = v.voted;
        verdict.textContent = r.ends ? T.voted.ends : r.approved ? T.voted.approved : T.voted.rejected;
        verdict.className = `av-verdict ${r.approved ? 'ok' : 'bad'}`;
        tally.textContent = T.voted.tally(r.approves, r.rejects);
        const col = (kind) => v.order.filter((p) => r.votes[p] === kind);
        grid.replaceChildren(
          h('div', { class: 'av-votecol yes' }, h('div', { class: 'av-votecol-head', text: `👍 ${T.voted.yes} ${r.approves}` }), chipsFor(col('approve'), 'stack')),
          h('div', { class: 'av-votecol no' }, h('div', { class: 'av-votecol-head', text: `👎 ${T.voted.no} ${r.rejects}` }), chipsFor(col('reject'), 'stack')));
        needLine.textContent = T.voted.needed(r.needed);
        trackLine.textContent = r.approved ? T.voted.track(r.before, 0) : T.voted.track(r.before, r.after);
        btn.textContent = r.ends ? T.voted.nextEnd : T.voted.next;
        btn.disabled = guard.busy;
        waitTxt.textContent = T.voted.waiting(nameOf(v.leader));
      },
      destroy() {},
    };
  }

  function questBody(member) {
    const timer = makeTimer();
    const head = h('h2', { class: 'av-h', text: T.quest.title });
    const teamLine = h('div', { class: 'av-teamline' });
    const banner = h('div', { class: 'av-banner' });
    const guard = sendGuard();
    let choice = null;
    const tile = (kind, emoji, label, sub) => {
      const b = h('button', { class: `av-tile ${kind}`, type: 'button', 'aria-pressed': 'false', 'data-act': `tile-${kind}` },
        h('span', { class: 'av-tile-emoji', text: emoji }), h('span', { class: 'av-tile-label', text: label }), h('span', { class: 'av-tile-sub', text: sub }));
      b.addEventListener('click', () => {
        api.sfx('tap');                       // same sound whether or not the tile can be picked
        if (!view?.quest?.mine || view.quest.mine.done) return;
        if (kind === 'fail' && !view.quest.mine.canFail) return;   // inert for good: same look, nothing happens
        choice = kind;
        rerender();
      });
      return b;
    };
    const success = tile('success', '✅', T.quest.success, T.quest.successSub);
    const fail = tile('fail', '❌', T.quest.fail, T.quest.failSub);
    const tiles = h('div', { class: 'av-tiles' });
    const rule = h('p', { class: 'av-note', text: T.quest.rule });
    const play = h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-act': 'play' });
    play.addEventListener('click', () => {
      if (!choice) return;
      guard.fire(() => { api.sfx('lock'); api.send({ type: 'quest', card: choice }); });
    });
    const doneBox = h('div', { class: 'av-done' });
    const progress = h('p', { class: 'av-progress' });
    const wait = member ? null : waitBlock('🛡');
    const el = h('div', { class: 'av-stack' }, head, teamLine, banner, timer.el,
      member ? [tiles, play, doneBox, rule] : wait.el, progress);
    let lastFlip = null;
    return {
      el,
      update(v, c) {
        const q = v.quest;
        teamLine.replaceChildren(h('span', { class: 'av-teamline-label', text: T.board.team }), chipsFor(q.team));
        const lines = [v.redo ? T.redo.quest : '', q.need > 1 ? T.quest.twoFail : ''].filter(Boolean);
        banner.hidden = !lines.length;
        banner.textContent = lines.join(' ');
        timer.update(v, c, [5]);
        progress.hidden = !q.progress;
        if (q.progress) progress.textContent = T.quest.progress(q.progress.done, q.progress.total);
        if (!member) { wait.set(v.me === null ? T.quest.tableWait : T.quest.notMember); return; }
        const m = q.mine;
        if (m.flip !== lastFlip) { lastFlip = m.flip; tiles.replaceChildren(...(m.flip ? [fail, success] : [success, fail])); }
        const done = m.done;
        if (done) choice = null;
        for (const [b, kind] of [[success, 'success'], [fail, 'fail']]) {
          b.classList.toggle('on', !done && choice === kind);
          b.classList.toggle('spent', done);
          b.setAttribute('aria-pressed', !done && choice === kind ? 'true' : 'false');
        }
        play.hidden = done;
        play.disabled = !choice || guard.busy;
        play.textContent = T.quest.play(choice);
        doneBox.hidden = !done;
        doneBox.textContent = done ? `${T.quest.played}　${q.mode === 'timer' && v.deadline != null ? T.quest.playedWaitTimer : T.quest.playedWait}` : '';
      },
      destroy() { timer.destroy(); },
    };
  }

  function resultBody(isLeader) {
    const guard = sendGuard();
    const o0 = view.outcome;
    const pile = h('div', { class: 'av-pile' }, o0.pile.map((card, i) => h('div', {
      class: `av-pcard ${card}`, style: { '--i': i },
    }, h('span', { class: 'av-pcard-mark', text: card === 'fail' ? '✗' : '✓' }))));
    const verdict = h('div', { class: 'av-verdict' });
    const counts = h('div', { class: 'av-tally' });
    const noteTwo = h('p', { class: 'av-note' });
    const score = h('p', { class: 'av-note' });
    const late = h('div', { class: 'av-late', style: { '--n': o0.pile.length } }, verdict, counts, noteTwo, score);
    const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-act': 'continue' });
    btn.addEventListener('click', () => { guard.fire(() => { btn.disabled = true; api.send({ type: 'continue' }); }); });
    const waitTxt = h('p', { class: 'av-note' });
    const pileNote = h('p', { class: 'av-note', text: T.result.pileHint });
    // the pile turns over one card at a time, then the verdict
    o0.pile.forEach((card, i) => later(() => api.sfx(card === 'fail' ? 'deny' : 'flip'), 350 * (i + 1)));
    later(() => api.sfx(o0.success ? 'reveal' : 'zero'), 350 * (o0.pile.length + 1));
    const el = h('div', { class: 'av-stack av-result' }, h('h2', { class: 'av-h', text: T.result.title(o0.no) }), pile, pileNote, late, isLeader ? btn : waitTxt);
    return {
      el,
      update(v) {
        const o = v.outcome;
        verdict.textContent = o.success ? T.result.success : T.result.fail;
        verdict.className = `av-verdict ${o.success ? 'ok' : 'bad'}`;
        counts.textContent = T.result.counts(o.successes, o.fails);
        noteTwo.hidden = !(o.need > 1 && o.fails === 1);
        noteTwo.textContent = T.result.twoFailNote;
        score.textContent = T.result.score(v.board.wins, v.board.losses);
        btn.textContent = T.result.next[o.next] ?? T.result.next.pick;
        btn.disabled = guard.busy;
        waitTxt.textContent = T.result.waiting(nameOf(v.leader));
      },
      destroy() {},
    };
  }

  function ladyPickBody(isHolder) {
    const head = h('h2', { class: 'av-h' });
    const note = h('p', { class: 'av-note' });
    const wait = isHolder ? null : waitBlock('🌊');
    const picker = isHolder ? makePicker({
      count: 1,
      confirmLabel: T.lady.confirm,
      exclude: (v) => v.order.filter((p) => !v.ladyStep.candidates.includes(p)),
      onSend: (sel) => api.send({ type: 'lady', target: sel[0] }),
    }) : null;
    const el = h('div', { class: 'av-stack' }, head, isHolder ? note : wait.el, picker?.el);
    return {
      el,
      update(v) {
        head.textContent = T.lady.pickTitle(nameOf(v.ladyStep.holder));
        if (isHolder) { note.textContent = T.lady.pickMine; picker.update(v); } else wait.set(T.lady.pickOthers(nameOf(v.ladyStep.holder)));
      },
      destroy() { picker?.destroy(); },
    };
  }

  function ladyPeekBody(isHolder) {
    const head = h('h2', { class: 'av-h' });
    const guard = sendGuard();
    const loyaltyEl = h('div', { class: 'av-loyalty' });
    const front = h('div', { class: 'av-face av-loyalty-face' }, loyaltyEl);
    const props = { front, backArt: '🌊', backLabel: T.lady.peekBack, lockMode: 'none', locked: false, ariaLabel: T.lady.peekBack };
    const cover = isHolder ? Cover(props) : null;
    const note = h('p', { class: 'av-note' });
    const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-act': 'lady-done', text: T.lady.peekDone });
    btn.addEventListener('click', () => { guard.fire(() => { btn.disabled = true; api.send({ type: 'lady-done' }); }); });
    const wait = isHolder ? null : waitBlock('🌊');
    const el = h('div', { class: 'av-stack' }, head, isHolder ? h('div', { class: 'av-card big' }, cover.el) : wait.el, note, isHolder ? btn : null);
    return {
      el,
      update(v) {
        const st = v.ladyStep;
        head.textContent = T.lady.peekTitle(nameOf(st.target));
        if (isHolder && st.mine) {
          const evil = st.mine.loyalty === 'evil';
          loyaltyEl.textContent = evil ? T.lady.peekEvil : T.lady.peekGood;
          front.classList.toggle('evil', evil);
          front.style.setProperty('--team', evil ? S.TEAM.evil.color : S.TEAM.good.color);
          cover.update(props);
          note.textContent = T.lady.peekNote;
          btn.disabled = guard.busy;
        } else {
          wait.set(T.lady.peekOthers(nameOf(st.holder), nameOf(st.target)));
          note.textContent = T.lady.token(nameOf(st.target));
        }
      },
      destroy() { cover?.destroy(); },
    };
  }

  function assassinateBody() {
    const timer = makeTimer();
    const head = h('h2', { class: 'av-h', text: T.assassinate.title });
    const sub = h('p', { class: 'av-note', text: T.assassinate.sub });
    const flipBox = h('div', { class: 'av-flip' });
    const recorded = h('p', { class: 'av-recorded' });
    // The same picker on every phone. Only the Assassin's confirm is a real shot; everybody else's is a decoy.
    const picker = makePicker({
      count: 1,
      confirmLabel: (sel, v) => (sel.length ? T.assassinate.confirm(nameOf(sel[0])) : T.assassinate.pick),
      armLabel: T.assassinate.confirmArmed,
      exclude: (v) => (v.me ? [v.me] : v.order),
      onSend: (sel) => {
        api.sfx('lock');
        if (view.assassinate.canShoot) api.send({ type: 'assassinate', target: sel[0] });
        else api.send({ type: 'decoy' });
      },
    });
    const el = h('div', { class: 'av-stack' }, head, sub, timer.el, flipBox, picker.el, recorded);
    return {
      el,
      update(v, c) {
        const a = v.assassinate;
        timer.update(v, c, [30]);
        picker.update(v, { disabled: v.me === null || (!a.canShoot && a.tapped) });
        recorded.hidden = !(a.tapped && !a.canShoot);
        recorded.textContent = T.assassinate.recorded;
        flipBox.hidden = !a.flipped;
        if (a.flipped) {
          flipBox.replaceChildren(h('div', { class: 'av-flip-head', text: T.assassinate.flipped }),
            ...a.flipped.map((f) => h('div', { class: 'av-flip-row' }, h('b', { text: nameOf(f.pid) }), ` ${S.roleLabel(f.role)}`)));
        }
      },
      destroy() { picker.destroy(); timer.destroy(); },
    };
  }

  function shotBody(canContinue) {
    const guard = sendGuard();
    const line = h('div', { class: 'av-shot-line' });
    const out = h('div', { class: 'av-verdict' });
    const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-act': 'continue', text: T.shot.next });
    btn.addEventListener('click', () => { guard.fire(() => { btn.disabled = true; api.send({ type: 'continue' }); }); });
    const waitTxt = h('p', { class: 'av-note', text: T.shot.waiting });
    const late = h('div', { class: 'av-late', style: { '--n': 2 } }, out);
    later(() => api.sfx(view?.shot?.hit ? 'reveal' : 'deny'), 1400);
    const el = h('div', { class: 'av-stack av-result' }, h('h2', { class: 'av-h', text: T.shot.title }), line, late, canContinue ? btn : waitTxt);
    return {
      el,
      update(v) {
        const s = v.shot;
        line.textContent = T.shot.line(nameOf(s.assassin), nameOf(s.target));
        out.textContent = s.hit ? T.shot.hit(nameOf(s.target)) : T.shot.miss(nameOf(s.target), nameOf(s.merlin));
        out.className = `av-verdict ${s.hit ? 'bad' : 'ok'}`;
        btn.disabled = guard.busy;
      },
      destroy() {},
    };
  }

  function overBody() {
    const out = h('div', { class: 'av-verdict' });
    const see = h('p', { class: 'av-note', text: T.over.see });
    return {
      el: h('div', { class: 'av-stack' }, h('h2', { class: 'av-h', text: T.over.title }), out, see),
      update(v) { out.textContent = v.end.summary; out.className = `av-verdict ${v.end.winner === 'good' ? 'ok' : 'bad'}`; },
      destroy() {},
    };
  }

  function keyFor(v) {
    const seat = v.me !== null;
    const isLeader = seat && v.me === v.leader;
    switch (v.phase) {
      case 'reveal': return `reveal|${seat}`;
      case 'pick': return `pick|${v.proposalNo}|${isLeader}`;
      case 'vote': return `vote|${v.proposalNo}`;
      case 'voted': return `voted|${v.proposalNo}|${isLeader}`;
      case 'quest': return `quest|${v.quest.no}|${!!v.quest.mine}`;
      case 'quest-result': return `result|${v.outcome.no}|${isLeader}`;
      case 'lady': return `lady|${v.lady.log.length}|${seat && v.me === v.ladyStep.holder}`;
      case 'lady-peek': return `peek|${v.lady.log.length}|${seat && v.me === v.ladyStep.holder}`;
      case 'assassinate': return 'assassinate';
      case 'shot': return `shot|${v.shot.canContinue}`;
      default: return 'over';
    }
  }

  function makeBody(v) {
    const seat = v.me !== null;
    const isLeader = seat && v.me === v.leader;
    switch (v.phase) {
      case 'reveal': return revealBody(seat);
      case 'pick': return pickBody(isLeader);
      case 'vote': return voteBody();
      case 'voted': return votedBody(isLeader);
      case 'quest': return questBody(!!v.quest.mine);
      case 'quest-result': return resultBody(isLeader);
      case 'lady': return ladyPickBody(seat && v.me === v.ladyStep.holder);
      case 'lady-peek': return ladyPeekBody(seat && v.me === v.ladyStep.holder);
      case 'assassinate': return assassinateBody();
      case 'shot': return shotBody(v.shot.canContinue);
      default: return overBody();
    }
  }

  // ---------- the mini identity card (everything after the reveal) ----------

  let mini = null;
  function paintMini(v) {
    const show = !!v.mine && v.phase !== 'reveal' && v.phase !== 'over';
    miniSlot.hidden = !show;
    if (!show) return;
    if (!mini) {
      mini = makeCard({ backLabel: T.card.backMini, big: false });
      miniSlot.append(h('div', { class: 'av-mini-label', text: T.me }), mini.el);
    }
    mini.set(v.mine);
  }

  // ---------- update / destroy ----------

  let lastKey = null;
  function enter(prev, v) {
    if (prev === null) return;   // the first view a phone gets is history, not news
    const seat = v.me !== null;
    const isLeader = seat && v.me === v.leader;
    if (v.phase === 'pick' && isLeader) api.sfx('turn');
    if (v.phase === 'lady' && seat && v.me === v.ladyStep.holder) api.sfx('turn');
    if (v.phase === 'lady-peek' && seat && v.me === v.ladyStep.holder) api.sfx('reveal');
  }

  return {
    update(nextView, nextCtx) {
      view = nextView;
      ctx = nextCtx ?? {};
      if (!view) return;
      paintBoard(view);
      paintRoster(view);
      paintHistory(view);
      paintDeck(view);
      paintMini(view);

      const key = keyFor(view);
      if (key !== bodyKey) {
        body?.destroy();
        body = makeBody(view);
        bodyHost.replaceChildren(body.el);
        const prev = lastKey;
        bodyKey = key;
        lastKey = key;
        enter(prev, view);
      }
      body.update(view, ctx);
    },
    destroy() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      body?.destroy();
      mini?.destroy();
      body = null;
      mini = null;
      root.replaceChildren();
    },
  };
}
