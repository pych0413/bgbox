// ============================================================
// 狼人殺 — game UI.   mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view: update() may be called with the same view any number of times and is
// idempotent. Long-lived widgets (the role card, the vote panel, the night grid) are created
// once per screen and only ever updated — rebuilding a Cover under a thumb would snap the
// peek shut. The body is rebuilt only when the step (view.seq) changes; the NIGHT body is one
// persistent screen that is repainted for every step.
//
// Night rules this file keeps (docs/games/werewolf.md §3, "anti-tell"):
//  - every phone draws the SAME boxes at every night step: stage card, info card, the grid of
//    seats, two buttons. Only the words inside differ — and that is decided by the engine, this
//    file never knows whether a seat is "real" or a decoy.
//  - nothing here makes a sound at night (no api.sfx, no Timer, no PlayerPicker): their taps and
//    beeps would tell the room who is awake. The night clock is a silent bar.
//  - no optimistic state: a tap is sent, and the screen changes when the host echoes the view.
//
// Day rule (playtest #2): a phone lies face-up on the table all day, so NOTHING secret is drawn in the open. Your role,
// a wolf's mates, the witch's potions and every night record sit behind a hold-to-peek cover (the RoleCard and the
// 📓 notes cover); your own seat chip is marked only by the is-me ring. The uncovered screen is the same whatever
// your card is (a UI test swaps the card and compares).
//
// Only api.components (RoleCard, Cover, VotePanel, Timer) and plain DOM are used. Every Cantonese line is in
// script.js. Flow and wording: docs/games/werewolf.md.
// ============================================================

import { el } from '../../ui/dom.js?v=1';
import * as S from './script.js?v=1';

const sig = (x) => JSON.stringify(x ?? null);
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node.hidden !== !!hidden) node.hidden = !!hidden; };

const PHASE_ICON = {
  deal: '🃏', dawn: '🌅', words: '🗣️', final: '🏹', speech: '🎙️', vote: '🗳️', over: '🏁',
};
const SAY_ICON = { tally: '📊', shot: '🏹', flip: '🤡', explode: '💥' };

export function mount(root, api) {
  const C = api.components;
  const players = () => api.players ?? [];
  const nameOf = (pid) => players().find((p) => p.id === pid)?.name ?? '?';
  const colorOf = (pid) => players().find((p) => p.id === pid)?.color ?? 'var(--accent)';

  let view = null;
  let ctx = {};
  let prev = null;
  let bodyKey = '';
  let body = null;
  let roleLocked = false;                 // the role card's own 🔒 (local, per screen)
  const timers = new Set();

  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  };
  const rerender = () => { if (view) apply(view, ctx); };

  const seatOf = (v, pid) => v.seats.find((s) => s.pid === pid) ?? null;
  const seatName = (v, pid) => `${seatOf(v, pid)?.no ?? ''}號${nameOf(pid)}`;
  const labelOf = (v, pid) => {
    const s = seatOf(v, pid);
    return `${s ? `${s.no}號 ` : ''}${nameOf(pid)}${pid === v.me ? S.UI.common.you : ''}`;
  };

  // ============================================================
  // persistent chrome
  // ============================================================

  // ---- stage card: what the table is doing right now (public) ----
  const stageIcon = el('div', { class: 'ww-stage-icon' });
  const stageTitle = el('div', { class: 'ww-stage-title' });
  const stageSay = el('p', { class: 'ww-stage-say' });
  const stageNight = el('p', { class: 'ww-stage-night', hidden: true });   // 🌅 昨晚：… — public, all day
  const barFill = el('i');
  const bar = el('div', { class: 'ww-bar', hidden: true }, barFill);
  const timerHost = el('div', { class: 'ww-timer', hidden: true });
  const stage = el('section', { class: 'ww-stage' },
    el('div', { class: 'ww-stage-head' }, stageIcon, el('div', { class: 'ww-stage-text' }, stageTitle, stageSay, stageNight)),
    bar, timerHost);

  let timer = null;
  let barTimer = null;
  let barInfo = null;

  function paintBar() {
    if (!barInfo || barInfo.deadline == null || !barInfo.span) { barFill.style.transform = 'scaleX(1)'; return; }
    const left = Math.max(0, barInfo.deadline - api.now());
    const f = Math.max(0, Math.min(1, left / barInfo.span));
    barFill.style.transform = `scaleX(${f.toFixed(3)})`;
  }
  function setBar(info) {
    barInfo = info;
    setHidden(bar, !info);
    if (info && !barTimer) barTimer = setInterval(paintBar, 250);
    if (!info && barTimer) { clearInterval(barTimer); barTimer = null; }
    if (info) paintBar();
    bar.classList.toggle('is-wait', !!info && info.deadline == null);
  }
  function setTimer(v, c) {
    if (v.deadline == null || v.phase === 'night') {
      if (timer) { timer.destroy(); timer = null; }
      setHidden(timerHost, true);
      return;
    }
    setHidden(timerHost, false);
    const props = { deadline: v.deadline, now: api.now, label: v.timerLabel ?? '', paused: !!c?.paused, warnAt: [10] };
    if (!timer) { timer = C.Timer(props); timerHost.append(timer.el); } else timer.update(props);
  }

  function paintStage(v, c) {
    const night = v.phase === 'night';
    const icon = night ? (S.STEP_ICON[v.step?.k] ?? '🌙') : v.phase === 'say' ? (SAY_ICON[v.sayInfo?.kind] ?? '📣') : (PHASE_ICON[v.phase] ?? '🐺');
    setText(stageIcon, icon);
    setText(stageTitle, v.subtitle || v.title || '');
    setText(stageSay, v.say ?? '');
    setHidden(stageSay, !v.say);
    // who left last night, kept on every day screen (the dawn card itself has the list, so not twice there)
    const ln = v.phase !== 'dawn' ? v.lastNight : null;
    const lnText = !ln ? '' : ln.deaths.length ? S.UI.day.lastNightDead(ln.deaths.map((p) => seatName(v, p)).join('、')) : S.UI.day.lastNightPeace;
    setText(stageNight, lnText);
    setHidden(stageNight, !lnText);
    stage.classList.toggle('is-night', night);
    if (night) {
      setTimer(v, c);
      setBar(v.stage === 'run' ? { deadline: v.deadline ?? null, span: v.span ?? 0 } : (v.stage ? { deadline: null, span: 0 } : null));
    } else {
      setBar(null);
      setTimer(v, c);
    }
  }

  // ---- roster ----
  const rosterHead = el('span', { class: 'ww-roster-head' });
  const rosterList = el('div', { class: 'ww-roster-list' });
  const roster = el('section', { class: 'ww-roster' }, rosterHead, rosterList);
  let rosterSig = '';

  function paintRoster(v) {
    const sg = sig([v.seats, v.me, v.alive, v.isMod]);
    if (sg === rosterSig) return;
    rosterSig = sg;
    setText(rosterHead, `${S.UI.roster.head} · ${S.UI.roster.alive(v.alive, v.seats.length)}`);
    rosterList.replaceChildren(...v.seats.map((s) => {
      const role = s.role ? S.ROLES[s.role] : null;
      return el('span', {
        class: `ww-seat${s.alive ? '' : ' is-dead'}${s.pid === v.me ? ' is-me' : ''}${s.flipped ? ' is-flip' : ''}`,
        style: { '--seat': colorOf(s.pid) },
      },
      el('b', { text: String(s.no) }),
      el('span', { class: 'ww-seat-name', text: nameOf(s.pid) }),
      s.flipped ? el('em', { text: S.UI.roster.flipped }) : null,
      !s.alive ? el('em', { text: S.UI.roster.dead }) : null,
      role ? el('small', { text: role.emoji }) : null);
    }));
  }

  // ---- "me": role card, then mates / potions / notes behind a 📓 cover (never in plain text by day) ----
  const meRoleHost = el('div', { class: 'ww-me-card' });
  const notesHost = el('div', { class: 'ww-me-notes' });
  const notesFront = el('div', { class: 'ww-notes' });   // one node for the cover's life: the Cover swaps fronts by identity
  const meLines = el('div', { class: 'ww-me-lines' });
  const meBanner = el('p', { class: 'ww-banner', hidden: true });
  // closed by default: a face-up phone shows only the 「我嘅身份」 summary
  const meBox = el('details', { class: 'ww-me' },
    el('summary', { text: S.UI.me.head }), meBanner, meRoleHost, notesHost, meLines);
  let roleCard = null;
  let notesCover = null;
  let meSig = '';
  let notesSig = '';

  function roleProps(v) {
    const id = v.my.role;
    const r = S.ROLES[id];
    const board = Object.fromEntries(v.board.map((b) => [b.id, b.count]));
    return {
      role: { emoji: r.emoji, name: r.name, team: r.team, text: S.roleCardText(id, { hasWitch: !!board.witch, hasGuard: !!board.guard, win: v.opts.win }) },
      locked: roleLocked,
      onLockToggle: () => { roleLocked = !roleLocked; rerender(); },
      hint: roleLocked ? undefined : (v.phase === 'deal' ? S.UI.deal.cardBack : undefined),
      backLabel: S.UI.deal.cardBack,
    };
  }

  function paintMe(v) {
    const my = v.my;
    const hide = !my || v.phase === 'night' || v.phase === 'over' || v.phase === 'deal';
    setHidden(meBox, hide);
    if (hide) return;
    if (!roleCard) { roleCard = C.RoleCard(roleProps(v)); meRoleHost.append(roleCard.el); } else roleCard.update(roleProps(v));

    const banner = !my.alive ? S.UI.me.deadBanner : my.flipped ? S.UI.me.idiotBanner : '';
    setText(meBanner, banner);
    setHidden(meBanner, !banner);

    // Secret lines go on the 📓 cover's hidden face. EVERY seat with a card gets the cover (a villager's says
    // 「冇夜晚記錄」), so having one tells nothing; it shares the role card's 🔒.
    const notes = [];
    if (my.mates) {
      const names = my.mates.map((p) => `${seatName(v, p)}${seatOf(v, p)?.alive === false ? S.UI.roster.dead : ''}`).join('、');
      notes.push(['mates', my.mates.length ? S.UI.me.mates(names) : S.PANEL.wolves.matesAlone]);
    }
    if (my.potion) notes.push(['potion', S.UI.me.potions(my.potion.save, my.potion.poison)]);
    for (const n of my.notes) {
      const who = seatName(v, n.pid);
      if (n.k === 'seer') notes.push(['note', S.UI.me.seer(n.n, who, n.camp)]);
      else if (n.k === 'save') notes.push(['note', S.UI.me.witchSave(n.n, who)]);
      else if (n.k === 'poison') notes.push(['note', S.UI.me.witchPoison(n.n, who)]);
      else if (n.k === 'guard') notes.push(['note', S.UI.me.guard(n.n, n.pid ? who : null)]);
    }
    if (!notes.length) notes.push(['none', S.UI.me.notesNone]);
    const ns = sig(notes);
    if (ns !== notesSig) {
      notesSig = ns;
      notesFront.replaceChildren(el('p', { class: 'ww-notes-head', text: `📓 ${S.UI.me.notesHead}` }),
        ...notes.map(([k, text]) => el('p', { class: `ww-me-line ${k}`, text })));
    }
    const coverProps = {
      front: notesFront, backArt: '📓', backLabel: S.UI.me.notesBack, lockMode: 'peek', locked: roleLocked,
      lockedMessage: S.UI.me.notesLocked, ariaLabel: S.UI.me.notesBack, openSound: null,
    };
    if (!notesCover) { notesCover = C.Cover(coverProps); notesHost.append(notesCover.el); } else notesCover.update(coverProps);

    // Only what this seat may see in the open: the whole table's roles once dead with 出局後睇到全場 (the roster
    // shows them too; the setting's help warns the table about it).
    const lines = [];
    if (v.all) {
      lines.push(['head', S.UI.me.spectateAll]);
      for (const s of v.seats) lines.push(['all', `${s.no} ${nameOf(s.pid)}：${S.roleTag(v.all[s.pid])}`]);
    }
    const sg = sig(lines);
    if (sg !== meSig) {
      meSig = sg;
      meLines.replaceChildren(...lines.map(([k, text]) => el('p', { class: `ww-me-line ${k}`, text })));
    }
  }

  // ---- god panel (human moderator) ----
  const godInfo = el('div', { class: 'ww-god-info' });
  const godRoles = el('div', { class: 'ww-god-roles' });
  const skipBtn = el('button', { class: 'btn btn-primary btn-lg ww-god-skip', type: 'button', onclick: () => api.send({ type: 'skip' }) });
  const godBox = el('section', { class: 'ww-god', hidden: true },
    el('h3', { text: S.UI.god.head }), skipBtn, el('small', { class: 'ww-god-sub', text: S.UI.god.skipHint }), godInfo, godRoles);
  let godSig = '';

  function paintGod(v) {
    setHidden(godBox, !v.isMod);
    if (!v.isMod) return;
    setText(skipBtn, S.UI.god.skip);
    skipBtn.disabled = v.phase === 'over';
    const g = v.god;
    const pick = (p) => (p ? labelOf(v, p) : null);
    const info = [];
    if (g.nt) {
      info.push(['head', `${S.UI.god.live}：${S.stepTitle(g.nt.step)}`]);
      for (const x of g.nt.picks) {
        const what = !x.set ? S.UI.god.noPick : x.pick ? labelOf(v, x.pick) : S.UI.god.skipPick;
        info.push(['pick', `${labelOf(v, x.pid)} → ${what}${x.lock ? ` ${S.UI.god.lock}` : ''}`]);
      }
      if (g.nt.attacked !== undefined && (g.nt.step === 'witch' || g.nt.step === 'seer' || g.nt.step === 'hunter')) info.push(['line', S.UI.god.attacked(pick(g.nt.attacked))]);
      if (g.nt.guarded) info.push(['line', S.UI.god.guarded(pick(g.nt.guarded))]);
      if (g.nt.saved) info.push(['line', S.UI.god.saved(pick(g.nt.saved))]);
      if (g.nt.poisoned) info.push(['line', S.UI.god.poisoned(pick(g.nt.poisoned))]);
      if (g.nt.seer) info.push(['line', S.PANEL.seer.result(pick(g.nt.seer.target) ?? '—', g.nt.seer.camp)]);
    }
    info.push(['dim', S.UI.god.potions(g.potion.save, g.potion.poison)]);
    if (v.opts.hasHunter || g.guardLast !== null) info.push(['dim', S.UI.god.guardLast(pick(g.guardLast))]);
    const sg = sig([info, g.roles, v.seats.map((s) => s.alive)]);
    if (sg === godSig) return;
    godSig = sg;
    godInfo.replaceChildren(...info.map(([k, text]) => el('p', { class: `ww-god-line ${k}`, text })));
    godRoles.replaceChildren(...v.seats.map((s) => el('span', { class: `ww-god-role${s.alive ? '' : ' is-dead'}`, style: { '--seat': colorOf(s.pid) } },
      el('b', { text: String(s.no) }), el('span', { text: nameOf(s.pid) }), el('small', { text: S.roleTag(g.roles[s.pid]) }))));
  }

  // ============================================================
  // shared builders
  // ============================================================

  /** The grid of seats: one chip per playing seat, silent (no PlayerPicker clicks at night). */
  function makeGrid() {
    const grid = el('div', { class: 'ww-grid' });
    let key = '';
    let nodes = new Map();
    let tap = () => {};
    function ensure(items) {
      const k = sig(items.map((i) => [i.pid, i.no, i.name, i.color]));
      if (k === key) return;
      key = k;
      nodes = new Map();
      grid.replaceChildren(...items.map((i) => {
        const dots = el('span', { class: 'ww-chip-by' });
        const tag = el('small', { class: 'ww-chip-tag' });
        const b = el('button', { class: 'ww-chip', type: 'button', style: { '--seat': i.color } },
          el('b', { class: 'ww-chip-no', text: String(i.no) }),
          el('span', { class: 'ww-chip-name', text: i.name }),
          dots, tag);
        b.addEventListener('click', () => tap(i.pid));
        nodes.set(i.pid, { b, dots, tag });
        return b;
      }));
    }
    return {
      el: grid,
      paint(items, onTap) {
        ensure(items);
        tap = onTap;
        for (const i of items) {
          const n = nodes.get(i.pid);
          n.b.disabled = !i.on;
          // 'can' = tappable now (the old 'on' read as "selected" to tools); the pick itself is aria-pressed
          n.b.classList.toggle('can', i.on);
          n.b.setAttribute('aria-pressed', i.mark ? 'true' : 'false');
          n.b.classList.toggle('pick', i.mark === 'pick');
          n.b.classList.toggle('lock', i.mark === 'lock');
          n.b.classList.toggle('dead', !!i.dead);
          setText(n.tag, i.tag);
          const bySig = sig(i.by);
          if (n.dots.dataset.k !== bySig) {
            n.dots.dataset.k = bySig;
            n.dots.replaceChildren(...i.by.map((w) => el('i', { style: { '--c': w.color }, title: w.name })));
          }
        }
      },
    };
  }

  /**
   * The night / final-action screen. ONE layout for every seat: info card, grid, two buttons, a hint.
   * `type` is the action type the engine expects ('night' or 'final').
   */
  function panelBody(type) {
    const info = el('div', { class: 'ww-info' });
    const hint = el('p', { class: 'ww-hint' });
    const grid = makeGrid();
    const skip = el('button', { class: 'btn btn-ghost ww-skip', type: 'button' });
    const ok = el('button', { class: 'btn btn-primary ww-ok', type: 'button' });
    const foot = el('div', { class: 'ww-foot' }, skip, ok);
    const node = el('div', { class: `ww-panel ww-${type}` }, info, grid.el, foot, hint);
    let infoSig = '';

    skip.addEventListener('click', () => api.send({ type, pick: null, lock: true }));
    ok.addEventListener('click', () => api.send({ type, lock: true }));

    return {
      el: node,
      update(v) {
        const nt = v.nt;
        if (!nt) return;
        const lines = nt.info;
        const sg = sig(lines);
        if (sg !== infoSig) {
          infoSig = sg;
          info.replaceChildren(...lines.map((l, i) => el('p', { class: `ww-info-line${i === 0 ? ' head' : ''}`, text: l })));
        }
        setText(hint, nt.hint);
        setHidden(hint, !nt.hint);
        const items = nt.chips.map((c) => ({
          ...c,
          no: seatOf(v, c.pid)?.no ?? 0,
          name: nameOf(c.pid),
          color: colorOf(c.pid),
          dead: seatOf(v, c.pid)?.alive === false,
          by: c.by.map((w) => ({ name: nameOf(w), color: colorOf(w) })),
        }));
        grid.paint(items, (pid) => {
          if (nt.stage !== 'run') return;
          api.send({ type, pick: nt.pick === pid ? null : pid });
        });
        const open = nt.stage === 'run';
        const frozen = nt.lock && !nt.chips.some((c) => c.on);
        setText(skip, nt.skip);
        skip.disabled = !open || frozen;
        setText(ok, nt.lock ? S.PANEL.okDone : nt.ok);
        ok.disabled = !open || nt.lock || nt.pick == null;
        node.classList.toggle('is-locked', nt.lock);
        node.classList.toggle('is-open', open);
      },
      destroy() {},
    };
  }

  // ============================================================
  // bodies
  // ============================================================

  function textBody(build) {
    const node = el('div', { class: 'ww-card' });
    return { el: node, update(v) { build(node, v); }, destroy() {} };
  }

  function bigCard(emoji, headText, bodyText, cls = '') {
    return [
      el('div', { class: 'ww-big-emoji', text: emoji }),
      el('h2', { class: 'ww-big-head', text: headText }),
      bodyText ? el('p', { class: 'ww-big-text', text: bodyText }) : null,
    ].filter(Boolean).map((n) => { if (cls) n.classList.add(cls); return n; });
  }

  // ---- deal ----
  function dealBody() {
    const note = el('p', { class: 'ww-note' });
    const cardHost = el('div', { class: 'ww-deal-card' });
    const boardList = el('div', { class: 'ww-board-list' });
    const reason = el('p', { class: 'ww-reason' });
    const board = el('section', { class: 'ww-card ww-board' }, el('h3', { text: S.UI.deal.board }), boardList, reason);
    const ready = el('button', { class: 'btn btn-primary btn-lg ww-ready', type: 'button', onclick: () => api.send({ type: 'ready' }) });
    const count = el('p', { class: 'ww-count' });
    const node = el('div', { class: 'ww-deal' }, cardHost, board, ready, count, note);
    let card = null;
    let boardSig = '';
    return {
      el: node,
      update(v) {
        const my = v.my;
        // the stage card above already says what to do; only the people without a card need a note
        setText(note, v.isMod ? S.UI.deal.modNote : !my ? S.UI.deal.spectator : '');
        setHidden(note, !!my);
        setHidden(cardHost, !my);
        if (my) {
          if (!card) { card = C.RoleCard(roleProps(v)); cardHost.append(card.el); } else card.update(roleProps(v));
        }
        const sg = sig(v.board);
        if (sg !== boardSig) {
          boardSig = sg;
          boardList.replaceChildren(...v.board.map((b) => el('span', { class: 'ww-board-role' },
            el('b', { text: S.ROLES[b.id].emoji }), el('span', { text: `${S.ROLES[b.id].name}${b.count > 1 ? ` ×${b.count}` : ''}` }))));
        }
        const text = v.opts.preset ? (S.PRESET_TEXT[v.opts.preset]?.reason ?? '') : '';
        setText(reason, text);
        setHidden(reason, !text);
        setHidden(ready, !my);
        ready.disabled = !!my?.ready;
        setText(ready, my?.ready ? S.UI.deal.readyDone : S.UI.deal.ready);
        setText(count, S.UI.deal.count(v.ready.done, v.ready.total));
      },
      destroy() { card?.destroy(); },
    };
  }

  // ---- dawn ----
  function dawnBody() {
    return textBody((node, v) => {
      const list = v.dawn.deaths;
      const head = list.length ? S.UI.day.dawnDead : S.UI.day.dawnPeace;
      const chips = list.map((d) => {
        const role = d.role ? S.ROLES[d.role] : null;
        return el('span', { class: 'ww-dead-chip', style: { '--seat': colorOf(d.pid) } },
          el('b', { text: String(seatOf(v, d.pid)?.no ?? '') }), el('span', { text: nameOf(d.pid) }), role ? el('small', { text: role.emoji + role.name }) : null);
      });
      const sg = sig([head, list]);
      if (node.dataset.k === sg) return;
      node.dataset.k = sg;
      node.replaceChildren(el('h2', { class: 'ww-big-head', text: head }), el('div', { class: 'ww-dead-list' }, chips));
    });
  }

  // ---- last words / speeches ----
  function speakBody(kind) {
    const list = el('div', { class: 'ww-speakers' });
    const done = el('button', { class: 'btn btn-primary btn-lg ww-done', type: 'button', onclick: () => api.send({ type: 'done' }) });
    const note = el('p', { class: 'ww-note' });
    const explode = kind === 'speech' ? makeExplode() : null;
    const node = el('div', { class: 'ww-speak' }, list, done, note, explode?.el);
    return {
      el: node,
      update(v) {
        const cur = kind === 'speech' ? v.speech : v.words;
        const mine = v.me && cur.pid === v.me;
        const order = kind === 'speech' ? cur.order : [cur.pid];
        const sg = sig([order, cur.idx, cur.pid, v.me]);
        if (node.dataset.k !== sg) {
          node.dataset.k = sg;
          list.replaceChildren(...order.map((pid, i) => {
            const state = kind === 'speech' ? (i < cur.idx ? 'done' : i === cur.idx ? 'now' : 'todo') : 'now';
            return el('div', { class: `ww-speaker ${state}`, style: { '--seat': colorOf(pid) } },
              el('b', { text: String(seatOf(v, pid)?.no ?? '') }),
              el('span', { class: 'ww-speaker-name', text: labelOf(v, pid) }),
              el('small', { text: state === 'done' ? S.UI.day.speakSpoke : state === 'now' ? S.UI.day.speakNow : S.UI.day.speakNext }));
          }));
        }
        const running = v.stage === 'run';
        setHidden(done, !mine);
        done.disabled = !running;
        setText(done, S.UI.day.speakDone);
        setText(note, mine ? (S.HINT.day[kind === 'speech' ? 'speech' : 'words'].me) : '');
        setHidden(note, !mine);
        if (explode) explode.update(v);
      },
      destroy() { explode?.destroy(); },
    };
  }

  /** 💥 — the same control on every living seat; only a wolf's press does anything. */
  function makeExplode() {
    const btn = el('button', { class: 'ww-explode', type: 'button' },
      el('span', { class: 'ww-explode-main', text: S.UI.day.explode }), el('small', { text: S.UI.day.explodeHold }));
    const fill = el('i', { class: 'ww-explode-fill' });
    btn.append(fill);
    const note = el('p', { class: 'ww-explode-note', text: S.UI.day.explodeNote });
    const box = el('div', { class: 'ww-explode-box' }, btn, note);
    let hold = null;
    const cancel = () => { if (hold) { clearTimeout(hold); timers.delete(hold); hold = null; } btn.classList.remove('holding'); };
    const press = (e) => {
      e?.preventDefault?.();
      if (btn.disabled || hold) return;
      btn.classList.add('holding');
      hold = later(() => {
        hold = null;
        btn.classList.remove('holding');
        btn.classList.add('fired');
        api.send({ type: 'explode' });
        later(() => btn.classList.remove('fired'), 700);
      }, 1000);
    };
    btn.addEventListener('pointerdown', press);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, cancel);
    btn.addEventListener('contextmenu', (e) => e.preventDefault?.());
    return {
      el: box,
      update(v) {
        const me = seatOf(v, v.me);
        const show = !!me && me.alive && v.opts.explode !== 'off' && !(v.speech.pk && v.opts.explode !== 'pk') && !v.isMod;
        setHidden(box, !show);
        btn.disabled = v.stage === 'tail';
      },
      destroy() { cancel(); },
    };
  }

  // ---- the dead player's final action / everybody else's wait ----
  function finalWaitBody() {
    return textBody((node, v) => {
      const sg = sig([v.final.pid, v.seq]);
      if (node.dataset.k === sg) return;
      node.dataset.k = sg;
      node.replaceChildren(
        el('div', { class: 'ww-big-emoji', text: '🏹' }),
        el('h2', { class: 'ww-big-head', text: S.UI.day.shotWho(labelOf(v, v.final.pid)) }),
        el('p', { class: 'ww-big-text', text: S.UI.day.shotNote }));
    });
  }

  // ---- votes ----
  function voteBody() {
    const info = el('p', { class: 'ww-note' });
    const panelHost = el('div', { class: 'ww-votehost' });
    const progress = el('p', { class: 'ww-count' });
    const node = el('div', { class: 'ww-vote' }, info, panelHost, progress);
    let panel = null;
    return {
      el: node,
      update(v) {
        const vt = v.vote;
        const me = v.me;
        const can = !!me && vt.voters.includes(me);
        const tied = vt.round === 2;
        const text = can ? S.UI.day.votePick : !me ? '' : (seatOf(v, me)?.alive === false ? S.UI.day.voteDead : (tied ? S.UI.day.voteNoPk : S.UI.day.voteNo));
        setText(info, text);
        setHidden(info, !text);
        setHidden(panelHost, !can);
        if (can) {
          const props = {
            players: players().filter((p) => v.seats.some((s) => s.pid === p.id)),
            candidates: vt.cands, me,
            myVote: 'myVote' in vt ? vt.myVote : undefined,
            allowAbstain: true, allowChange: true,
            progress: vt.progress, reveal: null,
            onVote: (t) => api.send({ type: 'vote', target: t }),
          };
          if (!panel) { panel = C.VotePanel(props); panelHost.append(panel.el); } else panel.update(props);
        }
        setText(progress, `已投 ${vt.progress.done}/${vt.progress.total}`);
        setHidden(progress, can);
      },
      destroy() { panel?.destroy(); },
    };
  }

  // ---- announcements ----
  function sayBody() {
    const head = el('div', { class: 'ww-say-head' });
    const panelHost = el('div', { class: 'ww-votehost' });
    const outcome = el('p', { class: 'ww-outcome' });
    const abstain = el('p', { class: 'ww-note' });
    const node = el('div', { class: 'ww-say' }, head, panelHost, outcome, abstain);
    let panel = null;
    return {
      el: node,
      update(v) {
        const s = v.sayInfo;
        if (s.kind === 'tally') {
          const votes = Object.fromEntries(s.votes.map((x) => [x.by, x.to]));
          const top = s.outcome === 'exile' || s.outcome === 'flip' ? [s.pid] : s.outcome === 'tie' ? s.tied : [];
          const props = {
            players: players().filter((p) => v.seats.some((x) => x.pid === p.id)), candidates: [], me: v.me,
            allowAbstain: false, progress: null, reveal: { counts: s.counts, top, votes },
            title: s.round === 1 ? S.UI.day.tallyHead : S.UI.day.voteHeadPk,
          };
          if (!panel) { panel = C.VotePanel(props); panelHost.append(panel.el); } else panel.update(props);
          const text = s.outcome === 'exile' ? S.UI.day.tallyExile(labelOf(v, s.pid))
            : s.outcome === 'tie' ? S.UI.day.tallyTie(s.tied.map((p) => labelOf(v, p)).join('、'))
              : s.outcome === 'flip' ? S.UI.day.tallyNoExile(labelOf(v, s.pid))
                : s.outcome === 'tie2' ? S.UI.day.tallyTie2 : s.outcome === 'nobody' ? S.UI.day.tallyNobody : S.UI.day.tallyPeace;
          setText(outcome, text);
          setHidden(outcome, false);
          const abst = s.votes.filter((x) => x.to === null).map((x) => labelOf(v, x.by));
          setText(abstain, abst.length ? `${S.UI.day.abstain}：${abst.join('、')}` : '');
          setHidden(abstain, !abst.length);
          setHidden(panelHost, false);
          head.replaceChildren();
        } else {
          setHidden(panelHost, true);
          setHidden(outcome, true);
          setHidden(abstain, true);
          const emoji = SAY_ICON[s.kind] ?? '📣';
          const headText = s.kind === 'shot' ? S.UI.day.shotAnnounce : s.kind === 'flip' ? S.UI.day.flipHead : S.UI.day.explodeHead;
          const sg = sig([s, v.seq]);
          if (head.dataset.k !== sg) {
            head.dataset.k = sg;
            head.replaceChildren(el('div', { class: 'ww-big-emoji', text: emoji }), el('h2', { class: 'ww-big-head', text: headText }),
              el('p', { class: 'ww-big-text', text: v.say }));
          }
        }
      },
      destroy() { panel?.destroy(); },
    };
  }

  // ---- over ----
  function overBody() {
    const banner = el('div', { class: 'ww-over-banner' });
    const list = el('div', { class: 'ww-over-list' });
    const node = el('div', { class: 'ww-over' }, banner, list);
    return {
      el: node,
      update(v) {
        const o = v.over;
        const sg = sig([o, v.seats]);
        if (node.dataset.k === sg) return;
        node.dataset.k = sg;
        const headText = o.win === 'wolves' ? S.UI.over.wolves : o.win === 'good' ? S.UI.over.good : S.UI.over.draw;
        banner.replaceChildren(el('div', { class: 'ww-big-emoji', text: o.win === 'wolves' ? '🐺' : o.win === 'good' ? '🧑‍🌾' : '🤝' }),
          el('h2', { class: 'ww-big-head', text: headText }), el('p', { class: 'ww-big-text', text: o.summary }));
        list.replaceChildren(el('h3', { text: S.UI.over.roles }), ...v.seats.map((s) => {
          const wolf = o.roles[s.pid] === 'werewolf';
          const won = o.win !== 'draw' && (o.win === 'wolves') === wolf;
          return el('div', { class: `ww-over-row${wolf ? ' wolf' : ''}${won ? ' won' : ''}${s.alive ? '' : ' is-dead'}`, style: { '--seat': colorOf(s.pid) } },
            el('b', { text: String(s.no) }), el('span', { class: 'ww-over-name', text: nameOf(s.pid) + (s.pid === v.me ? S.UI.common.you : '') }),
            el('span', { class: 'ww-over-role', text: S.roleTag(o.roles[s.pid]) }),
            el('small', { text: s.alive ? S.UI.over.alive : `${s.at ? `第 ${s.at.n} ${s.at.time === 'night' ? '夜' : '日'}` : ''}${s.how ? S.HOW[s.how] : ''}` }));
        }));
      },
      destroy() {},
    };
  }

  // ============================================================
  // routing
  // ============================================================

  function bodyFor(v) {
    switch (v.phase) {
      case 'deal': return ['deal', dealBody];
      case 'night': return v.nt ? ['night', () => panelBody('night')] : [`night-wait`, () => waitBody(v)];
      case 'dawn': return [`dawn:${v.seq}`, dawnBody];
      case 'words': return [`words:${v.seq}`, () => speakBody('words')];
      case 'final': return v.nt ? [`final-me:${v.seq}`, () => panelBody('final')] : [`final:${v.seq}`, finalWaitBody];
      case 'say': return [`say:${v.seq}`, sayBody];
      case 'speech': return [`speech:${v.seq}`, () => speakBody('speech')];
      case 'vote': return [`vote:${v.seq}`, voteBody];
      default: return ['over', overBody];
    }
  }

  /** The table / spectator / moderator view of the night: nothing to tap, just the step. */
  function waitBody() {
    return textBody((node, v) => {
      const sg = sig([v.step, v.isMod]);
      if (node.dataset.k === sg) return;
      node.dataset.k = sg;
      node.replaceChildren(el('div', { class: 'ww-big-emoji', text: S.STEP_ICON[v.step?.k] ?? '🌙' }),
        el('h2', { class: 'ww-big-head', text: v.subtitle }),
        el('p', { class: 'ww-big-text', text: v.isMod ? S.UI.night.modLive : S.UI.night.hintAll }));
    });
  }

  function sounds(v) {
    if (!prev) { prev = v; return; }
    const day = v.phase !== 'night' && prev.phase !== 'night' && !v.night;
    if (day) {
      const turnNow = (x) => (x.speech?.pid ?? x.words?.pid ?? x.final?.pid);
      if (v.me && v.seq !== prev.seq && turnNow(v) === v.me && turnNow(prev) !== v.me) api.sfx('turn');
      if (v.phase === 'over' && prev.phase !== 'over') api.sfx('win');
    }
    prev = v;
  }

  function apply(v, c) {
    ctx = c ?? {};
    root.classList.toggle('is-paused', !!ctx.paused);
    root.classList.toggle('is-night', v.phase === 'night');
    root.classList.toggle('is-mod', !!v.isMod);

    paintStage(v, ctx);
    paintGod(v);
    paintMe(v);
    const showRoster = v.phase !== 'night' && v.phase !== 'deal';
    setHidden(roster, !showRoster);
    if (showRoster) paintRoster(v);

    const [key, make] = bodyFor(v);
    if (key !== bodyKey) {
      body?.destroy();
      body = make();
      bodyHost.replaceChildren(body.el);
      bodyKey = key;
    }
    body.update(v, ctx);
  }

  const bodyHost = el('div', { class: 'ww-body' });
  // (the 🗳 之前嘅投票 fold is the shell's: view.recent, rendered under this UI by the play screen)
  const wrap = el('div', { class: 'ww' }, godBox, stage, bodyHost, roster, meBox);
  root.replaceChildren(wrap);

  return {
    update(nextView, nextCtx) {
      if (!nextView) return;
      view = nextView;
      sounds(nextView);
      apply(nextView, nextCtx);
    },
    destroy() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (barTimer) { clearInterval(barTimer); barTimer = null; }
      timer?.destroy();
      body?.destroy();
      roleCard?.destroy();
      notesCover?.destroy();
      body = null;
      root.replaceChildren();
    },
  };
}
