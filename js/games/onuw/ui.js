// ============================================================
// 一夜終極狼人 — game UI.   mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view: update() may be called with the same view twice and must be
// idempotent. Every long-lived widget (the role card, the covers, the timer, the
// vote panel) is created once per screen and only ever .update()d: rebuilding a
// Cover while a thumb holds it would snap the peek shut.
//
// Night rules this file keeps (docs/games/onuw.md §3, anti-tell):
//  - ONE layout for every phone at every night step: header, countdown bar, info
//    card, the other seats, the three centre cards, one big button. Only what is
//    live differs: a seat with nothing to do sees the same boxes, greyed out.
//  - nothing here makes a sound at night (no api.sfx, no PlayerPicker, no Timer):
//    their taps and ticks would tell the room who is awake.
//  - what a seat LEARNED sits behind ONE hold-to-peek 📓 cover that every phone has
//    at every step, holding everything it learned tonight so far (a sleeper's says
//    「今晚未見過嘢」); the big button is the decoy for everybody ("ack") and also the
//    confirm button for whoever has a choice.
//  - a Doppelgänger's copy (a hidden team change) and its instructions are only ever
//    behind that cover; her plain line and her confirm labels never name the role.
//  - the day screen never shows a current card: only what you were dealt and what
//    you learned, with a warning that it may be out of date.
//
// All wording lives in script.js. Uses only api.components + plain DOM.
// ============================================================

import { rules } from './game.js?v=20261004224709';
import * as S from './script.js?v=20261004224709';

const T = S.T;
const ROLE_RULE = Object.fromEntries(rules.roles.map((r) => [r.id, r]));

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

// write only when something changed (keeps focus, selection and animations alone)
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node.hidden !== !!hidden) node.hidden = !!hidden; };
const sig = (x) => JSON.stringify(x ?? null);

/** CSS class for a role's team colour (the Doppelgänger has her own). */
function teamClass(role) {
  const t = ROLE_RULE[role]?.team ?? '';
  return t.startsWith('#') ? 'doppel' : t;
}

/** The role card face for a dealt role: Cover + emoji + name + team colour + a one-line brief. */
function cardFace(role) {
  const r = ROLE_RULE[role];
  if (!r) return null;
  return { emoji: r.emoji, name: r.name, team: r.team, teamLabel: r.teamLabel, color: r.color, text: S.ROLE_BRIEF[role] ?? '' };
}

// ============================================================
// shared bits
// ============================================================

function makeEnv(api, local, refresh) {
  const players = () => api.players ?? [];
  const nameOf = (pid) => players().find((p) => p.id === pid)?.name ?? '?';
  const colorOf = (pid) => players().find((p) => p.id === pid)?.color ?? 'var(--accent)';
  /** The players for a VotePanel: an absent seat's name carries the public 💤 (D4). */
  const markedPlayers = (view) => {
    const away = new Set(view?.absent ?? []);
    return players().map((p) => (away.has(p.id) ? { ...p, name: `${p.name} ${T.absentMark}` } : p));
  };
  /** One public line naming the 💤 seats, or '' when nobody is away. */
  const awayText = (view) => (view?.absent?.length ? T.absentLine(view.absent.map(nameOf).join('、')) : '');
  // §7.1 one phone: a phone holding 2+ seats (the whole table: every seated player). A single-seat phone sees neither.
  const shared = () => !!api.shared;
  const whole = () => !!api.wholeTable;
  /** Who a screen the table reads calls 「你」: nobody on a shared phone (#20) — everybody reads it at once. */
  const me = () => (shared() ? null : api.me);
  return { api, C: api.components, local, refresh, players, nameOf, colorOf, markedPlayers, awayText, shared, whole, me };
}

/**
 * The night countdown: a plain bar (no sound, no Timer — its ticks would tell the room who is awake) drawn from the
 * step's FIXED length (`view.step.windowMs`, #7), so a screen that mounts half-way through a window — a shared phone,
 * after its gate — shows the time already gone. The seconds left are written next to it; when they run out on a shared
 * phone the line says to put the phone back. Every phone's bar is the same (the length is public).
 */
function makeBar(E) {
  const fill = h('i');
  const bar = h('div', { class: 'on-bar', role: 'progressbar', 'aria-valuemin': '0' }, fill);
  const words = h('span', { class: 'on-bar-text', 'aria-hidden': 'true' });
  const el = h('div', { class: 'on-barwrap' }, bar, words);
  let total = 1;
  let seen = null;
  return {
    el,
    tick(view, ctx) {
      const dl = view?.deadline;
      if (dl == null || view.step?.stage !== 'window') {
        seen = null;
        bar.classList.add('is-wait');
        fill.style.transform = 'scaleX(1)';
        setText(words, '');
        return;
      }
      if (ctx?.paused) return;                 // the host paused: the bar stays where it is
      const fixed = Number(view.step.windowMs);
      if (dl !== seen) { seen = dl; total = Math.max(1, fixed > 0 ? fixed : dl - E.api.now()); }
      const left = Math.max(0, dl - E.api.now());
      const sec = Math.ceil(left / 1000);
      const text = sec > 0 ? T.barLeft(sec) : E.shared() ? T.timeUpShared : T.timeUp;
      bar.classList.remove('is-wait');
      fill.style.transform = `scaleX(${Math.min(1, left / total).toFixed(3)})`;
      setText(words, text);
      bar.setAttribute('aria-valuemax', String(Math.round(total / 1000)));
      bar.setAttribute('aria-valuenow', String(sec));
      bar.setAttribute('aria-valuetext', text);
    },
  };
}

/** A small public line under a count: 「💤 暫時離開（唔使等）：阿明」 while anybody is marked absent. */
function makeAway(E) {
  const el = h('p', { class: 'on-count on-away', hidden: true });
  return { el, update(view) { setText(el, E.awayText(view)); setHidden(el, !el.textContent); } };
}

/** The public role list ("今局角色"): the official tokens that sit next to the centre. */
function makeRoleList() {
  const chips = h('div', { class: 'on-chips' });
  const el = h('div', { class: 'on-rolelist' }, h('div', { class: 'on-rolelist-title', text: T.roleListTitle }), chips);
  return {
    el,
    update(list) {
      const k = sig(list);
      if (chips.dataset.key === k) return;
      chips.dataset.key = k;
      chips.replaceChildren(...list.map((r) => h('span', { class: `on-rchip team-${teamClass(r.role)}` },
        h('span', { class: 'on-rchip-emoji', text: S.ROLE_EMOJI[r.role] }),
        h('span', { text: S.roleName(r.role) }),
        r.count > 1 ? h('b', { text: `×${r.count}` }) : null)));
    },
  };
}

/** The private recap behind a cover: what I was dealt and what I learned. */
function makeRecap(E, { compact = false } = {}) {
  const C = E.C;
  const front = h('div', { class: 'on-recap' });
  const cover = C.Cover({ front, backArt: '📓', backLabel: T.recapBack, lockMode: 'none', locked: false, openSound: 'flip' });
  const warn = h('p', { class: 'on-warn', text: T.recapWarn });
  const el = h('div', { class: `on-recapwrap${compact ? ' is-compact' : ''}` }, h('h3', { class: 'on-h', text: T.recapTitle }), cover.el, warn);
  return {
    el,
    update(notes) {
      const lines = (notes ?? []).map((n) => S.noteLine(n, E.nameOf)).filter(Boolean);
      if (lines.length <= 1) lines.push(T.recapNothing);
      const k = sig(lines);
      if (front.dataset.key !== k) {
        front.dataset.key = k;
        front.replaceChildren(h('ul', {}, lines.map((t) => h('li', { text: t }))));
      }
      cover.update({ front, backArt: '📓', backLabel: T.recapBack, lockMode: 'none', locked: false, openSound: 'flip' });
    },
    destroy() { cover.destroy(); el.remove(); },
  };
}

/** The role card, shared by the deal screen. */
function makeRoleCard(E) {
  const card = E.C.RoleCard({ role: null, locked: E.local.roleLocked, onLockToggle: () => { E.local.roleLocked = !E.local.roleLocked; E.refresh(); } });
  return {
    el: card.el,
    update(dealt) {
      card.update({
        role: dealt ? cardFace(dealt) : null,
        locked: E.local.roleLocked,
        onLockToggle: () => { E.local.roleLocked = !E.local.roleLocked; E.refresh(); },
        hint: E.local.roleLocked ? T.lockedHint : T.peekHint,
        backLabel: T.roleCardBack,
      });
    },
    destroy() { card.destroy(); },
  };
}

function makeTimer(E, slot) {
  let timer = null;
  return {
    update(view, ctx, extra = {}) {
      if (view.deadline != null) {
        const props = { deadline: view.deadline, now: E.api.now, label: view.timerLabel ?? '', paused: !!ctx?.paused, warnAt: [60, 10], ...extra };
        if (!timer) { timer = E.C.Timer(props); slot.replaceChildren(timer.el); } else timer.update(props);
      } else if (timer) { timer.destroy(); timer = null; slot.replaceChildren(); }
      setHidden(slot, view.deadline == null);
    },
    destroy() { timer?.destroy(); timer = null; },
  };
}

// ============================================================
// deal: look at your card once, tap 記住喇
// ============================================================

function buildDeal(E) {
  const { api } = E;
  const lead = h('p', { class: 'on-lead', text: T.dealLead });
  const roleCard = makeRoleCard(E);
  const list = makeRoleList();
  const readyBtn = h('button', { class: 'btn btn-primary btn-lg on-ready', type: 'button', onclick: () => { api.sfx('lock'); api.send({ type: 'ready' }); } });
  const count = h('p', { class: 'on-count' });
  const away = makeAway(E);
  const tip = h('details', { class: 'on-tip' }, h('summary', { text: '夜晚點玩？' }), h('p', { text: E.shared() ? T.dealTipShared : T.dealTip }));
  const el = h('div', { class: 'on-screen on-deal' }, lead, roleCard.el, list.el, readyBtn, count, away.el, tip);
  return {
    el,
    update(view) {
      roleCard.update(view.my?.dealt);
      list.update(view.roleList);
      const done = !!view.my?.ready;
      readyBtn.disabled = done;
      setText(readyBtn, done ? T.dealReadyDone : T.dealReady);
      setText(count, T.dealCount(view.ready.done, view.ready.total));
      away.update(view);
    },
    destroy() { roleCard.destroy(); el.remove(); },
  };
}

// ============================================================
// night: one layout for everybody, decoys for everyone with nothing to do
// ============================================================

/** A grid of seats / centre cards. Silent on purpose (PlayerPicker clicks). */
function makeChips(className) {
  const grid = h('div', { class: className });
  let key = '';
  let chips = [];
  let onTap = () => {};
  function ensure(list) {
    const k = sig(list.map((p) => [p.id, p.name, p.color]));
    if (k === key) return;
    key = k;
    chips = list.map((p) => {
      const b = h('button', { class: 'on-chip', type: 'button', style: { '--seat': p.color ?? 'var(--accent)' } },
        p.color ? h('span', { class: 'dot' }) : null, h('span', { class: 'on-chip-name', text: p.name }));
      b.addEventListener('click', () => onTap(p.id));
      return { id: p.id, b };
    });
    grid.replaceChildren(...chips.map((c) => c.b));
  }
  return {
    el: grid,
    paint(list, { selectable, selected, tap }) {
      ensure(list);
      onTap = tap;
      for (const c of chips) {
        const can = selectable.includes(c.id);
        c.b.disabled = !can;
        c.b.classList.toggle('on', selected.includes(c.id));
        c.b.classList.toggle('live', can);
      }
    },
  };
}

function buildNight(E) {
  const { api, C } = E;
  const icon = h('span', { class: 'on-n-icon' });
  const title = h('b', { class: 'on-n-title' });
  const head = h('div', { class: 'on-n-head' }, icon, title);
  const bar = makeBar(E);

  const lines = h('div', { class: 'on-lines' });
  const peekFront = h('div', { class: 'on-peekfront' });
  const peekCover = C.Cover({ front: peekFront, backArt: T.nightPeekBack, backLabel: T.nightPeekLabel, lockMode: 'none', locked: false, openSound: 'none' });
  // the same 📓 cover on every phone at every step, all night: a result stays peekable after its window closes
  // (playtest #11), and a seat with nothing behind it looks exactly like one with something
  const peekWrap = h('div', { class: 'on-peekwrap' }, peekCover.el);
  const panel = h('div', { class: 'on-panel' }, lines, peekWrap);

  const players = makeChips('on-grid');
  const centre = makeChips('on-centre');
  players.el.setAttribute('aria-label', T.pickPlayers);
  centre.el.setAttribute('aria-label', T.pickCentre);
  const pick = h('div', { class: 'on-pick' }, players.el, centre.el);

  const ackLabel = h('span', { class: 'on-ack-main' });
  const ackSub = h('span', { class: 'on-ack-sub' });
  const ack = h('button', { class: 'on-ack', type: 'button' }, ackLabel, ackSub);
  const help = h('p', { class: 'on-help' });
  const node = h('div', { class: 'on-screen on-night' }, head, bar.el, panel, pick, ack, help);

  let sel = { players: [], centre: [] };   // local, uncommitted: where the thumb is
  let modeKey = '';
  let current = null;

  const mode = () => (current?.my?.night?.awake ? current.my.night.ab?.mode ?? null : null);

  function tapPlayer(pid) {
    const m = mode();
    if (m === 'player' || m === 'seer') sel = { players: sel.players[0] === pid ? [] : [pid], centre: [] };
    else if (m === 'pair') {
      if (sel.players.includes(pid)) sel = { players: sel.players.filter((x) => x !== pid), centre: [] };
      else sel = { players: [...sel.players, pid].slice(-2), centre: [] };
    }
    paint();
  }

  function tapCentre(id) {
    const i = Number(id);
    const m = mode();
    if (m === 'seer') {
      if (sel.centre.includes(i)) sel = { players: [], centre: sel.centre.filter((x) => x !== i) };
      else sel = { players: [], centre: [...sel.centre, i].slice(-2) };
    } else if (m === 'centre1') sel = { players: [], centre: sel.centre[0] === i ? [] : [i] };
    paint();
  }

  /** The action the current selection would send, or null (then the big button is the decoy tap). */
  function pending() {
    const ab = current?.my?.night?.awake ? current.my.night.ab : null;
    if (!ab) return null;
    const p = sel.players;
    const c = sel.centre.slice().sort((a, b) => a - b);
    switch (ab.name) {
      case 'copy': return p.length === 1 ? { type: 'copy', target: p[0] } : null;
      case 'seer':
        if (p.length === 1) return { type: 'look-player', target: p[0] };
        return c.length === 2 ? { type: 'look-centre', cards: c } : null;
      case 'robber': return p.length === 1 ? { type: 'rob', target: p[0] } : null;
      case 'troublemaker': return p.length === 2 ? { type: 'swap', a: p[0], b: p[1] } : null;
      case 'drunk': return c.length === 1 ? { type: 'drunk-swap', card: c[0] } : null;
      case 'loneWolf': return c.length === 1 ? { type: 'look-centre', cards: [c[0]] } : null;
      default: return null;
    }
  }

  function labelFor(a) {
    const nm = E.nameOf;
    // a Doppelgänger acting as her copy: the label names the pick only — 🔮 / 🗡️ / 🌪️ / 🍺 would name the copied role
    if (a.type !== 'copy' && current?.step?.k === 'doppelganger') {
      const picks = a.target ? [nm(a.target)] : a.a ? [nm(a.a), nm(a.b)] : (a.cards ?? [a.card]).map((i) => S.slotName(i));
      return S.confirmNeutral(picks);
    }
    switch (a.type) {
      case 'copy': return T.confirmCopy(nm(a.target));
      case 'look-player': return T.confirmLookPlayer(nm(a.target));
      case 'look-centre': return a.cards.length === 2 ? T.confirmLookCentre(S.slotName(a.cards[0]), S.slotName(a.cards[1])) : T.confirmLookOne(S.slotName(a.cards[0]));
      case 'rob': return T.confirmRob(nm(a.target));
      case 'swap': return T.confirmSwap(nm(a.a), nm(a.b));
      case 'drunk-swap': return T.confirmDrunk(S.slotName(a.card));
      default: return T.ackMain;
    }
  }

  ack.addEventListener('click', () => {
    const a = pending();
    if (a) { sel = { players: [], centre: [] }; api.send(a); } else api.send({ type: 'ack' });
  });

  function paint() {
    const view = current;
    const night = view.my.night;
    const step = view.step;
    const awake = !!night.awake;
    const ab = awake ? night.ab : null;

    const [ic, tt] = S.stepHead(step.k);
    setText(icon, ic);
    setText(title, tt);
    node.classList.toggle('is-awake', awake);

    const ls = awake ? S.awakeLines(step, night) : S.sleepLines(step);
    const lk = sig(ls);
    if (lines.dataset.key !== lk) {
      lines.dataset.key = lk;
      lines.replaceChildren(...ls.map(([cls, text]) => h('p', { class: `on-line ${cls}`, text })));
    }

    // what I learned tonight: behind the cover, so a neighbour with open eyes cannot read it
    const book = S.nightBook(step, night, E.nameOf);
    const bk = sig(book);
    if (peekFront.dataset.key !== bk) {
      peekFront.dataset.key = bk;
      peekFront.replaceChildren(h('ul', {}, book.map(([t, cls]) => h('li', { class: cls || null, text: t }))));
    }

    // the seats and the centre: live only while I have a choice
    const m = ab ? ab.mode : null;
    const others = E.players().filter((p) => p.id !== api.me);
    const key = `${step.ix}|${step.stage}|${ab?.name ?? ''}|${night.info?.length ?? 0}`;
    if (key !== modeKey) { modeKey = key; sel = { players: [], centre: [] }; }
    const pSelectable = m === 'player' || m === 'seer' || m === 'pair' ? others.map((p) => p.id) : [];
    const cSelectable = m === 'seer' || m === 'centre1' ? ['0', '1', '2'] : [];
    node.classList.toggle('many', others.length > 6);   // 3 columns from 8 players, so ten seats still fit one screen
    players.paint(others, { selectable: pSelectable, selected: sel.players, tap: tapPlayer });
    centre.paint([0, 1, 2].map((i) => ({ id: String(i), name: T.centreChip(i) })), { selectable: cSelectable, selected: sel.centre.map(String), tap: tapCentre });
    node.classList.toggle('has-live-grid', pSelectable.length > 0 || cSelectable.length > 0);

    // the one big button: the same shape for everybody
    const a = pending();
    setText(ackLabel, a ? labelFor(a) : T.ackMain);
    // a shared phone (#19): nobody taps a decoy there — the plain tap means "done", and the phone goes back
    setText(ackSub, a ? T.ackConfirm : E.shared() && awake ? T.ackSubShared : T.ackSub);
    ack.classList.toggle('is-action', !!a);
    ack.classList.toggle('is-done', !!view.my.acked);

    setText(help, nightHelp(E, view));
  }

  const timer = setInterval(() => { if (current) bar.tick(current, current.__ctx); }, 120);

  return {
    el: node,
    update(view, ctx) {
      current = { ...view, __ctx: ctx };
      paint();
      bar.tick(current, ctx);
    },
    destroy() { clearInterval(timer); peekCover.destroy(); node.remove(); },
  };
}

/** The help line under the big button. A shared phone never says 「望住自己部機」 (#19). */
function nightHelp(E, view) {
  const silent = view.__ctx?.narrationMode === 'silent';
  if (E.shared()) return silent ? T.helpSilentShared : T.helpVoiceShared;
  return silent ? T.helpSilent : T.helpVoice;
}

// ============================================================
// night on a shared phone, several of its seats awake in one step (U2): ONE combined screen
// ============================================================
//
// Two werewolves or two Masons (a Doppelgänger who copied one wakes with them) have their eyes open together and may
// see each other: the team is written once, for all of them. What each one learned tonight stays behind that seat's own
// 📓 cover (the others look away), because it may hold what the others must not know (a Doppelgänger's copy). Nobody
// on this screen has a choice to make (a lone wolf is alone by definition), so the one big button acks for all of them
// at once (`seats`). Nothing here ends the window early.

/** The co-wakers on this screen and their own views (the mounted seat's is `view`). */
function coList(E, view, ctx) {
  const co = Array.isArray(ctx?.coWakers) ? ctx.coWakers : [];
  return co
    .map((pid) => ({ pid, v: ctx?.views?.[pid] ?? (pid === E.api.me ? view : null) }))
    .filter((x) => x.v?.my?.night?.awake);
}

/** May this step be shown as ONE screen? Only while none of them has an ability to use (each pick is its own). */
const coFits = (list) => list.length >= 2 && list.every((x) => !x.v.my.night.ab);

function buildCoNight(E) {
  const { api, C } = E;
  const icon = h('span', { class: 'on-n-icon' });
  const title = h('b', { class: 'on-n-title' });
  const head = h('div', { class: 'on-n-head' }, icon, title);
  const bar = makeBar(E);
  const lines = h('div', { class: 'on-lines' });
  const books = h('div', { class: 'on-co-books' });
  const panel = h('div', { class: 'on-panel on-co-panel' }, lines, h('p', { class: 'on-co-booktitle', text: T.coBookTitle }), books);
  const ackSub = h('span', { class: 'on-ack-sub', text: T.coAckSub });
  const ack = h('button', { class: 'on-ack', type: 'button' }, h('span', { class: 'on-ack-main', text: T.ackMain }), ackSub);
  const help = h('p', { class: 'on-help' });
  const node = h('div', { class: 'on-screen on-night on-co is-awake' }, head, bar.el, panel, ack, help);
  let current = null;
  const covers = new Map();       // pid → { wrap, front, cover }: one 📓 per co-waker, kept across updates

  const listNow = () => (current ? coList(E, current, current.__ctx) : []);
  ack.addEventListener('click', () => {
    // "we have all seen it": one ack for every co-waker (never ends the window)
    api.send({ type: 'ack', seats: listNow().map((x) => x.pid) });
  });

  function paintBooks(step, list) {
    const want = list.map((x) => x.pid);
    for (const [pid, c] of covers) if (!want.includes(pid)) { c.cover.destroy(); covers.delete(pid); }
    for (const x of list) {
      let c = covers.get(x.pid);
      if (!c) {
        const front = h('div', { class: 'on-peekfront' });
        const cover = C.Cover({ front, backArt: '📓', backLabel: T.coBookBack(E.nameOf(x.pid)), lockMode: 'none', locked: false, openSound: 'none' });
        c = { front, cover, wrap: h('div', { class: 'on-peekwrap on-co-book' }, cover.el) };
        covers.set(x.pid, c);
      }
      const book = S.nightBook(step, x.v.my.night, E.nameOf);
      const bk = sig(book);
      if (c.front.dataset.key !== bk) {
        c.front.dataset.key = bk;
        c.front.replaceChildren(h('ul', {}, book.map(([t, cls]) => h('li', { class: cls || null, text: t }))));
      }
      c.cover.update({ front: c.front, backArt: '📓', backLabel: T.coBookBack(E.nameOf(x.pid)), lockMode: 'none', locked: false, openSound: 'none' });
    }
    const order = list.map((x) => covers.get(x.pid).wrap);
    if (order.some((w, i) => books.children[i] !== w) || books.children.length !== order.length) books.replaceChildren(...order);
  }

  function paint() {
    const view = current;
    const step = view.step;
    const list = listNow();
    const [ic, tt] = S.stepHead(step.k);
    setText(icon, ic);
    setText(title, tt);
    // the team: every co-waker here, plus anyone their own notes name awake with them on another phone
    const here = list.map((x) => x.pid);
    const elsewhere = new Set();
    for (const x of list) for (const n of x.v.my.night.info ?? []) for (const p of n.with ?? []) if (!here.includes(p)) elsewhere.add(p);
    const names = (ids) => ids.map(E.nameOf).join('、');
    const ls = [['head', T.coHead(step.k)], ['with', T.coWith(names(here))]];
    if (elsewhere.size) ls.push(['note', T.coOthers(names(E.players().map((p) => p.id).filter((p) => elsewhere.has(p))))]);
    const lk = sig(ls);
    if (lines.dataset.key !== lk) {
      lines.dataset.key = lk;
      lines.replaceChildren(...ls.map(([cls, text]) => h('p', { class: `on-line ${cls}`, text })));
    }
    paintBooks(step, list);
    ack.classList.toggle('is-done', list.length > 0 && list.every((x) => !!x.v.my.acked));
    setText(help, nightHelp(E, view));
  }

  const timer = setInterval(() => { if (current) bar.tick(current, current.__ctx); }, 120);
  return {
    el: node,
    update(view, ctx) {
      current = { ...view, __ctx: ctx };
      paint();
      bar.tick(current, ctx);
    },
    destroy() { clearInterval(timer); for (const c of covers.values()) c.cover.destroy(); node.remove(); },
  };
}

// ============================================================
// day: the timer, what I remember, ready-to-vote
// ============================================================

function buildDay(E) {
  const { api } = E;
  const banner = h('div', { class: 'on-banner', text: T.dayBanner });
  const timerSlot = h('div', { class: 'on-timer', hidden: true });
  const timer = makeTimer(E, timerSlot);
  const lead = h('p', { class: 'on-lead', text: T.dayLead });
  const recap = makeRecap(E);
  const list = makeRoleList();
  let mine = false;
  const readyBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => api.send({ type: 'ready-vote', on: !mine }) });
  const count = h('p', { class: 'on-count' });
  const away = makeAway(E);
  const hostNote = h('p', { class: 'on-count', text: T.hostSkip });
  const el = h('div', { class: 'on-screen on-day' }, banner, timerSlot, lead, recap.el, list.el, readyBtn, count, away.el, hostNote);
  return {
    el,
    update(view, ctx) {
      timer.update(view, ctx, view.canExtend ? { onExtend: () => api.send({ type: 'extend' }) } : {});
      recap.update(view.my?.notes);
      list.update(view.roleList);
      mine = !!view.dayReady.mine;
      // a shared phone (#5): 夠鐘投票 is one table decision on the screen in the middle — a seat's own screen says where
      setHidden(readyBtn, E.shared());
      readyBtn.classList.toggle('btn-locked', mine);
      setText(readyBtn, mine ? T.readyVoteDone : T.readyVote);
      setText(count, E.shared() ? T.seatToTable : T.readyVoteCount(view.dayReady.done, view.dayReady.total, view.deadline != null));
      setHidden(hostNote, !api.isHost || E.shared());
      away.update(view);
    },
    destroy() { timer.destroy(); recap.destroy(); el.remove(); },
  };
}

// ============================================================
// vote
// ============================================================

function buildVote(E) {
  const { api, C } = E;
  const lead = h('p', { class: 'on-lead', text: T.voteLead });
  const panel = C.VotePanel({ players: [], candidates: [], me: api.me, progress: { done: 0, total: 0 }, reveal: null, onVote: () => {} });
  const away = makeAway(E);
  const ringTitle = h('h3', { class: 'on-h', text: T.ringTitle });
  const ringHelp = h('p', { class: 'on-note', text: T.ringHelp });
  let ringMine = false;
  const ringBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => api.send({ type: 'ring', on: !ringMine }) });
  const ringCount = h('p', { class: 'on-count' });
  const ringStuck = h('p', { class: 'on-warn', text: T.ringStuck });
  const ring = h('div', { class: 'on-ring' }, ringTitle, ringHelp, ringBtn, ringCount, ringStuck);
  const recap = makeRecap(E, { compact: true });
  const el = h('div', { class: 'on-screen on-vote' }, lead, panel.el, away.el, ring, recap.el);
  return {
    el,
    update(view) {
      // 💤 an absent seat casts no vote (D4): its phone says so instead of offering a ballot or the circle
      const benched = !!view.my?.absent && view.myVote === undefined;
      // a shared phone (re-run R5): the ballots go round one by one — quiet until the last one is in
      setText(lead, benched ? T.absentSelf : E.shared() ? T.voteLeadShared : T.voteLead);
      setHidden(panel.el, benched);
      panel.update({
        players: E.markedPlayers(view), candidates: view.candidates ?? [], me: api.me,
        myVote: view.myVote, allowAbstain: false, allowChange: true,
        // your own phone never prints whom you picked (D6): 「已投 ✓」 until the reveal
        secretChoice: true,
        progress: view.progress, reveal: null, title: T.voteTitle,
        onVote: (pid) => { if (pid) api.send({ type: 'vote', target: pid }); },
      });
      away.update(view);
      setHidden(ring, !view.ring.on || benched);
      ringMine = !!view.ring.mine;
      ringBtn.classList.toggle('btn-locked', ringMine);
      // one phone (#24): agreeing comes with a fallback ballot in the same turn, so nobody needs the phone twice
      const fallback = !!view.ring.fallback;
      setText(ringBtn, ringMine ? (fallback ? T.ringOnFallback : T.ringOn) : T.ringOff);
      setText(ringHelp, fallback ? T.ringHelpFallback : T.ringHelp);
      setText(ringCount, T.ringCount(view.ring.done, view.ring.total));
      setHidden(ringStuck, !(view.ring.stuck && ringMine));
      recap.update(view.my?.notes);
    },
    destroy() { panel.destroy(); recap.destroy(); el.remove(); },
  };
}

// ============================================================
// reveal / over — public, the same for seats and the table screen
// ============================================================

function buildReveal(E) {
  const { api } = E;
  const banner = h('div', { class: 'on-banner big' });
  const summary = h('p', { class: 'on-lead strong' });
  const votesBox = h('section', { class: 'on-box on-votes' });
  const deadBox = h('section', { class: 'on-box on-dead' });
  const cardsBox = h('section', { class: 'on-box on-cards' });
  const whyBox = h('section', { class: 'on-box on-why' });
  const recapBox = h('details', { class: 'on-box on-recapbox' });
  let done = false;
  // the phone in the middle of a shared table (#5): one tap (and a second to confirm) finishes it for every seat here
  const doneBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: (e) => {
    if (E.shared() && api.atTable) {
      const ask = E.whole() ? T.revealDoneConfirm : T.revealDoneConfirmPart;
      if (typeof api.confirm === 'function' && !api.confirm(ask, e?.currentTarget ?? doneBtn)) return;
      api.tableSend?.({ type: 'done' });
      return;
    }
    api.send({ type: 'done' });
  } });
  const count = h('p', { class: 'on-count' });
  const away = makeAway(E);
  const el = h('div', { class: 'on-screen on-reveal' }, banner, summary, votesBox, deadBox, cardsBox, whyBox, recapBox, doneBtn, count, away.el);
  let chime = null;       // the reveal fanfare plays once, only for a screen that was there when the cards turned over

  const dot = (pid) => h('span', { class: 'dot', style: { '--seat': E.colorOf(pid) } });
  const fillKey = (box, k, build) => {
    if (box.dataset.key === k) return;
    box.dataset.key = k;
    box.replaceChildren(...build());
  };

  return {
    el,
    update(view, ctx) {
      const rv = view.reveal;
      if (!rv) return;
      if (chime === null && view.phase === 'reveal') chime = setTimeout(() => api.sfx('reveal'), 700);
      // a shared phone is read by the whole table: no 「你贏咗」 and no 「（你）」 there (#20)
      const me = E.me();
      const won = me ? rv.winners.includes(me) : null;
      setText(banner, won == null ? T.watching : won ? T.won : T.lost);
      el.classList.toggle('won', !!won);
      setText(summary, rv.summary);

      const order = E.players().map((p) => p.id).filter((p) => p in rv.counts);
      const rows = order.slice().sort((a, b) => rv.counts[b] - rv.counts[a]);
      const max = Math.max(1, ...Object.values(rv.counts));
      fillKey(votesBox, sig([rv.votes, rv.tied, rv.dead, order]), () => [
        h('h3', { class: 'on-h', text: T.revealVotes }),
        ...rows.map((pid, i) => h('div', { class: `on-vrow${rv.tied.includes(pid) ? ' top' : ''}${rv.dead.includes(pid) ? ' dead' : ''}`, style: { '--delay': `${i * 90}ms` } },
          h('div', { class: 'on-vhead' }, dot(pid), h('span', { class: 'on-vname', text: E.nameOf(pid) + (pid === me ? '（你）' : '') }),
            rv.dead.includes(pid) ? h('span', { class: 'on-skull', text: '☠️' }) : null, h('b', { text: String(rv.counts[pid]) })),
          h('div', { class: 'on-vbar' }, h('i', { style: { width: `${(rv.counts[pid] / max) * 100}%` } })),
          h('div', { class: 'on-voters' }, order.filter((v) => rv.votes[v] === pid).map((v) => h('span', { class: 'on-voter' }, dot(v), E.nameOf(v)))))),
      ]);

      fillKey(deadBox, sig([rv.dead, rv.shots, rv.nobodyDied, rv.cards.map((c) => [c.pid, c.final])]), () => {
        if (rv.nobodyDied) return [h('div', { class: 'on-nobody' }, h('b', { text: T.revealNobody }), h('span', { text: T.revealNobodySub }))];
        return [
          h('h3', { class: 'on-h', text: T.revealDead }),
          h('div', { class: 'on-deadcards' }, rv.dead.map((pid) => {
            const c = rv.cards.find((x) => x.pid === pid);
            return h('div', { class: `on-dcard role-${c.final}` },
              h('div', { class: 'on-dname', text: E.nameOf(pid) }),
              h('div', { class: 'on-drole', text: S.roleTag(c.final) }));
          })),
          ...rv.shots.filter((x) => x.fresh).map((x) => h('p', { class: 'on-shot', text: T.revealShot(E.nameOf(x.hunter), E.nameOf(x.target)) })),
        ];
      });

      fillKey(cardsBox, sig([rv.cards, rv.centre]), () => [
        h('h3', { class: 'on-h', text: T.revealCards }),
        h('div', { class: 'on-cardlist' }, rv.cards.map((c) => h('div', { class: `on-fcard ${c.won ? 'win' : 'lose'}${c.dead ? ' dead' : ''}` },
          h('div', { class: 'on-fhead' }, dot(c.pid), h('b', { text: E.nameOf(c.pid) + (c.pid === me ? '（你）' : '') }), c.dead ? h('span', { text: '☠️' }) : null,
            h('span', { class: `on-win ${c.won ? 'ok' : 'no'}`, text: c.won ? T.revealWon : T.revealLost })),
          h('div', { class: 'on-ftrail' }, h('span', { text: `${T.revealDealt} ${S.roleTag(c.orig)}` }), h('span', { class: 'arrow', text: '→' }), h('b', { text: `${T.revealFinal} ${S.roleTag(c.face)}` })),
          c.face === 'doppelganger' ? h('div', { class: 'on-fnote', text: c.copied ? `複製咗 ${S.roleName(c.copied)}` : '冇複製過，當村民' }) : null,
          h('div', { class: 'on-fteam', text: c.final === 'minion' ? (rv.cards.some((x) => x.final === 'werewolf') ? S.TEAM_LABEL.minion : S.TEAM_LABEL.minionSolo) : S.TEAM_LABEL[c.team] })))),
        h('div', { class: 'on-centre-final' }, h('b', { text: `${T.revealCentre}：` }),
          rv.centre.map((c, i) => h('span', { class: 'on-ccard', text: `${i + 1}. ${S.roleTag(c.face)}` }))),
      ]);

      fillKey(whyBox, sig(rv.why), () => [
        h('h3', { class: 'on-h', text: T.revealWhy }),
        h('ul', {}, rv.why.map((t) => h('li', { text: t }))),
      ]);
      fillKey(recapBox, sig(rv.recap), () => [
        h('summary', { text: T.revealRecap }),
        h('ul', { class: 'on-recaplist' }, rv.recap.map((t) => h('li', { class: t.startsWith('▸') ? 'step' : '', text: t }))),
      ]);

      done = !!view.revealDone?.mine;
      const table = E.shared() && !!api.atTable;
      // a seat of its own taps for itself; a shared phone does it once, from the middle (its seats' screens point there)
      const seat = !!api.me && !E.shared();
      setHidden(doneBtn, !seat && !table);
      doneBtn.disabled = table ? !!ctx?.tableLocked : done;
      setText(doneBtn, table ? (E.whole() ? T.revealDoneTable : T.revealDoneTablePart) : done ? T.revealDoneAck : T.revealDone);
      setText(count, table && E.whole() ? '' : T.revealCount(view.revealDone?.done ?? 0, view.revealDone?.total ?? 0));
      setHidden(count, !count.textContent);
      away.update(view.phase === 'reveal' ? view : null);
    },
    destroy() { clearTimeout(chime); el.remove(); },
  };
}

// ============================================================
// 呢局唔計 (the host voided the game): the same short screen for everybody
// ============================================================

function buildVoid() {
  const el = h('div', { class: 'on-screen on-void' },
    h('div', { class: 'on-banner big', text: S.VOID.title }),
    h('p', { class: 'on-lead', text: S.VOID.body }));
  return { el, update() {}, destroy() { el.remove(); } };
}

// ============================================================
// table screen (spectators, a device without a seat)
// ============================================================

function buildTable(E) {
  const { api } = E;
  const title = h('h2', { class: 'on-table-title' });
  const body = h('p', { class: 'on-lead' });
  const bar = makeBar(E);
  setHidden(bar.el, true);
  const count = h('p', { class: 'on-count' });
  const timerSlot = h('div', { class: 'on-timer', hidden: true });
  const timer = makeTimer(E, timerSlot);
  const list = makeRoleList();
  const away = makeAway(E);
  // §7.1 the phone in the middle of a shared table: by day the table's own taps (#5, #24) — each one counts for every
  // seat on the phone; locked while the 「擺返中間」 card is up (U5). 夠鐘投票 ends the talk for everybody, so on a
  // whole-table phone the shell asks for a second tap, naming the time still on the clock (re-run R2)
  const readyBtn = h('button', { class: 'btn btn-primary btn-lg on-table-ready', type: 'button', onclick: () => {
    const dl = current?.phase === 'day' ? current.deadline : null;
    const now = typeof api.clockNow === 'function' ? api.clockNow() : api.now();
    api.tableSend?.({ type: 'ready-vote', on: true }, { confirm: T.tableReadyConfirm(dl != null ? dl - now : NaN), node: readyBtn });
  } });
  const ringBtn = h('button', { class: 'btn btn-ghost on-table-ring', type: 'button', onclick: (e) => {
    if (typeof api.confirm === 'function' && !api.confirm(T.tableRingConfirm, e?.currentTarget ?? ringBtn)) return;
    api.tableSend?.({ type: 'ring', on: true });
  } });
  setHidden(readyBtn, true);
  setHidden(ringBtn, true);
  const el = h('div', { class: 'on-screen on-table' }, title, body, bar.el, timerSlot, readyBtn, ringBtn, count, away.el, list.el);
  let current = null;

  const iv = setInterval(() => { if (current?.phase === 'night') bar.tick(current, current.__ctx); }, 120);

  return {
    el,
    update(view, ctx) {
      current = { ...view, __ctx: ctx };
      list.update(view.roleList);
      setHidden(bar.el, view.phase !== 'night');
      const table = E.shared() && view.phase === 'day';
      switch (view.phase) {
        case 'deal':
          setText(title, T.tableDeal);
          setText(body, T.tableDealBody);
          setText(count, T.dealCount(view.ready.done, view.ready.total));
          break;
        case 'night':
          // no tap counter at night (playtest #18): actions count as taps, so it would say how many seats are awake
          setText(title, T.tableNightTitle(view.subtitle));
          setText(body, T.tableNightBody);
          setText(count, '');
          break;
        case 'day':
          setText(title, T.tableDay);
          setText(body, T.tableDayBody);
          // the whole table on this phone: one tap is everybody's, so no n / m waiting list (#5)
          setText(count, table && E.whole() ? '' : T.readyVoteCount(view.dayReady.done, view.dayReady.total, view.deadline != null));
          break;
        case 'vote':
          setText(title, T.tableVote);
          setText(body, E.shared() ? T.tableVoteBodyShared : T.tableVoteBody);
          setText(count, T.votedCount(view.progress.done, view.progress.total));
          break;
        default: break;
      }
      setHidden(count, !count.textContent);
      setHidden(readyBtn, !table);
      // 「全枱同意圈票」 needs every seat at once: only a phone holding the whole table can say it in one tap
      setHidden(ringBtn, !(table && E.whole() && view.opts?.ringVote));
      if (table) {
        // not while the shell has it armed (「再㩒一次：…」): a repaint would hide the question
        if (!readyBtn.classList.contains('armed')) setText(readyBtn, E.whole() ? T.tableReady : T.tableReadyPart);
        readyBtn.disabled = !!ctx?.tableLocked;
        setText(ringBtn, T.tableRing);
        ringBtn.disabled = !!ctx?.tableLocked;
      }
      away.update(view.phase === 'night' ? null : view);
      // the host's +60 s from the middle of a phone that holds the host's seat (the engine checks the seat)
      const extend = table && api.isHost && !ctx?.tableLocked ? { onExtend: () => api.tableSend?.({ type: 'extend' }) } : {};
      timer.update(view.phase === 'day' ? view : { deadline: null }, ctx, extend);
      if (view.phase === 'night') bar.tick(current, ctx);
    },
    destroy() { clearInterval(iv); timer.destroy(); el.remove(); },
  };
}

// ============================================================
// mount
// ============================================================

const SEAT_SCREENS = { deal: buildDeal, night: buildNight, day: buildDay, vote: buildVote, reveal: buildReveal, over: buildReveal };

export function mount(root, api) {
  const wrap = h('div', { class: 'on' });
  root.append(wrap);

  const local = { roleLocked: false };    // survives screen changes: a locked card stays locked
  let screen = null;
  let key = null;
  let lastView = null;
  let lastCtx = {};

  const refresh = () => { if (lastView && screen) screen.update(lastView, lastCtx); };
  const E = makeEnv(api, local, refresh);

  function update(view, ctx = {}) {
    lastView = view;
    lastCtx = ctx;
    const seat = !!view.seat && !!view.my;
    const isReveal = view.phase === 'reveal' || view.phase === 'over';
    // U2: two werewolves / Masons of this shared phone awake in one step share ONE screen
    const co = seat && view.phase === 'night' && coFits(coList(E, view, ctx));
    const k = view.voided ? 'void' : `${seat ? 'seat' : 'table'}:${isReveal ? 'reveal' : view.phase}${co ? ':co' : ''}`;
    if (k !== key) {
      screen?.destroy();
      key = k;
      const build = view.voided ? buildVoid : isReveal ? buildReveal : co ? buildCoNight : seat ? (SEAT_SCREENS[view.phase] ?? buildTable) : buildTable;
      screen = build(E);
      wrap.replaceChildren(screen.el);
    }
    wrap.dataset.phase = view.phase;
    wrap.classList.toggle('is-paused', !!ctx.paused);
    screen.update(view, ctx);
  }

  return {
    update,
    destroy() {
      screen?.destroy();
      screen = null;
      wrap.remove();
    },
  };
}
