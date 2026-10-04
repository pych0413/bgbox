// ============================================================
// games/custom/ui.js — 通用派牌 + 骰盅, the phone screen.
//
//   mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view: update() may be called with the same view twice and is
// idempotent. The only local state is the peek bookkeeping (did this finger
// open the card) and DOM caches. Everything is drawn from the whitelisted
// view built by game.js; this file never invents state.
//
// Uses only api.components (RoleCard, DiceCup, dieFace), api.send, api.sfx, api.confirm and
// api.players. The role card and the cup own their own sounds (flip, lock,
// roll chime keyed on rollSeq), so this file only adds game-level ones.
//
// Defensive on purpose: the shell can hand update() a view that is not ours
// (on a P2P client the `room` message that switches the game can arrive before
// the `views` message, so for a moment app.state.views still holds the last
// game's views) — that used to throw "Cannot read properties of undefined
// (reading 'filter')" in statusLine. A view without a `seats` array is ignored
// (the right one is on its way), and every other field is defaulted.
// view.hint is for the shell's 💡 sheet only; this UI never shows it.
// ============================================================

const NEED_CONFIRM = {
  'reveal-dice': '公開所有人嘅骰？',
  'reveal-roles': '開晒所有角色？呢個回合就完喇。',
  redeal: '重新派牌（唔加回合數）？大家要重新睇牌，骰唔會變。',
  end: '結束遊戲？會去結果頁，所有角色同骰都會公開。',
};

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const objects = (xs) => (Array.isArray(xs) ? xs.filter(isObj) : []);

/**
 * Our view, with every field the renderer touches defaulted — or null when the
 * view is not one of ours (no `seats` array), so update() can skip it.
 */
export function normaliseView(view) {
  if (!isObj(view) || !Array.isArray(view.seats)) return null;
  const sides = Number(view.dice?.sides);
  const count = Number(view.dice?.count);
  return {
    ...view,
    phase: typeof view.phase === 'string' ? view.phase : 'play',
    seats: view.seats.filter((s) => isObj(s) && typeof s.id === 'string'),
    roles: objects(view.roles),
    log: objects(view.log),
    can: isObj(view.can) ? view.can : {},
    dice: { count: Number.isInteger(count) && count > 0 ? count : 1, sides: Number.isInteger(sides) && sides > 0 ? sides : 6 },
    me: isObj(view.me) ? view.me : null,
    all: isObj(view.all) ? view.all : undefined,
    controller: view.controller === true,
    revealRoles: view.revealRoles === true,
    revealDice: view.revealDice === true,
  };
}

export function mount(root, api) {
  const C = api.components ?? {};
  const wrap = h('div', { class: 'cu' });
  root.append(wrap);

  // api.send returns app.act's Promise, which rejects when the action did not get through (G4).
  // The shell already toasts 冇送到; here we only make sure the rejection is never unhandled.
  const send = (action) => {
    try { Promise.resolve(api.send?.(action)).catch(() => {}); } catch (err) { console.error('[custom] send failed', err); }
  };
  const sfx = (name) => { try { api.sfx?.(name); } catch { /* sound is never worth a crash */ } };

  let last = null;          // last view
  let lastCtx = {};
  let prev = null;          // previous view, for sound transitions
  let peeking = false;      // this finger opened the role card
  let peekedDeal = null;    // shared phone: the deal whose card this seat has looked at (then 「✓ 搞掂」 shows, #15)
  let sentDeal = null;      // …and whose 「✓ 搞掂」 was just tapped (one tap only)
  let sentTimer = null;
  let cup = null;           // DiceCup instance (card holders only)
  let card = null;          // RoleCard instance (card holders only)
  let cardDealId = null;

  /** §7.1: a phone holding 2+ seats is passed round the table and read by everybody — never 「你」 to the table. */
  const shared = () => api.shared === true;
  const isMe = (id) => id != null && id === api.me && !shared();

  // ---------- banner ----------
  const status = h('div', { class: 'cu-status wait', text: '載入緊…' });

  // ---------- dice card ----------
  const diceHint = h('small', { class: 'cu-hint' });   // only says WHY the cup cannot roll; the cup has its own hint
  // a locked cup is a STATE, shown as a badge — not as two greyed-out buttons that look broken
  const lockBadge = h('span', { class: 'cu-badge lock', hidden: true });
  const diceSlot = h('div', { class: 'cu-slot' });
  const diceCard = h('section', { class: 'cu-card', hidden: true },
    h('div', { class: 'cu-head' }, h('h3', { text: '骰盅' }), lockBadge, diceHint), diceSlot);

  // ---------- shared phone: one hand-over per seat for the peek AND the dice (#15) ----------
  const doneBtn = h('button', { type: 'button', class: 'cu-btn primary cu-done' });
  const doneNote = h('small', { class: 'cu-hint cu-done-note' });
  const doneBox = h('div', { class: 'cu-donebox', hidden: true }, doneBtn, doneNote);
  doneBtn.addEventListener('click', () => handOn());

  // ---------- role card ----------
  const roleSlot = h('div', { class: 'cu-slot' });
  const roleCard = h('section', { class: 'cu-card', hidden: true },
    h('div', { class: 'cu-head' }, h('h3', { text: '我嘅角色牌' })), roleSlot, doneBox);

  // ---------- no-card note (moderator / spectator / the table) ----------
  const noteCard = h('section', { class: 'cu-card cu-notecard', hidden: true });

  // ---------- showdown (dice revealed) ----------
  const showList = h('ul', { class: 'cu-show' });
  const showCard = h('section', { class: 'cu-card', hidden: true },
    h('div', { class: 'cu-head' }, h('h3', { text: '開盅 🎲' })), showList);
  let showSig = '';

  // ---------- table ----------
  const countPill = h('span', { class: 'cu-pill' });
  const roster = h('ul', { class: 'cu-roster' });
  const tableCard = h('section', { class: 'cu-card' },
    h('div', { class: 'cu-head' }, h('h3', { text: '場上玩家' }), countPill), roster);
  const rows = new Map();

  // ---------- host controls ----------
  const btns = {
    rollAll: ctlButton('🎲 全體搖骰', (b) => rollAll(b)),
    unlockDice: ctlButton('🔓 解鎖骰盅', () => send({ type: 'unlock-dice' })),
    revealDice: ctlButton('👁 開晒啲骰', (b) => sendHost('reveal-dice', b)),
    revealRoles: ctlButton('🔓 開晒角色', (b) => sendHost('reveal-roles', b), 'danger'),
    redeal: ctlButton('🃏 重新派牌', (b) => sendHost('redeal', b)),
    nextRound: ctlButton('➡️ 下一回合（重新派牌）', () => send({ type: 'next-round' }), 'primary'),
    end: ctlButton('🏁 結束遊戲', (b) => sendHost('end', b), 'quiet'),
  };
  const ctlCard = h('section', { class: 'cu-card', hidden: true },
    h('div', { class: 'cu-head' }, h('h3', { text: '主持控制' })),
    h('div', { class: 'cu-grid' }, btns.rollAll, btns.unlockDice, btns.revealDice, btns.redeal),
    btns.revealRoles, btns.nextRound, btns.end);

  // ---------- deck + log ----------
  const deckList = h('ul', { class: 'cu-deck' });
  const deckSum = h('summary', { text: '🃏 本局牌組' });
  const deckCard = h('details', { class: 'cu-card cu-fold' }, deckSum, deckList);
  let deckSig = '';
  const logList = h('ul', { class: 'cu-log' });
  const logCard = h('details', { class: 'cu-card cu-fold' }, h('summary', { text: '📜 記錄' }), logList);
  let logSig = null;

  // the cup stays ABOVE the role card; once the host opens the dice, the 開盅 list sits right under the cup, on the
  // first screen, instead of below the role card where nobody would scroll to it
  wrap.append(status, noteCard, diceCard, showCard, roleCard, tableCard, ctlCard, deckCard, logCard);

  /** A host button; `onclick(button)` gets the button itself, for the in-page confirm on it. */
  function ctlButton(label, onclick, kind = '') {
    const b = h('button', { type: 'button', class: `cu-btn ${kind}`.trim() }, label);
    b.addEventListener('click', () => onclick(b));
    return b;
  }

  /**
   * #3: never a native dialog — on the host phone it would freeze the room's server. api.confirm(text, button) is the
   * shell's arm-then-confirm: the first tap arms the button (「再㩒一次：…」) and returns false, the second returns true.
   * Without it (an older shell) the action simply goes ahead; globalThis.confirm is never called.
   */
  function confirmed(text, node, key) {
    if (typeof api.confirm !== 'function') return true;
    try { return api.confirm(text, node, { key: `custom:${key}` }) === true; } catch (err) { console.error(err); return true; }
  }

  // ---------- actions ----------
  function sendHost(type, node) {
    if (NEED_CONFIRM[type] && !confirmed(NEED_CONFIRM[type], node, type)) return;
    send({ type });
    // §7.1 #22: on a shared phone the dice / roles are shown from the table screen, never by laying the host's own
    // seat (card, cup, controls) face up
    if ((type === 'reveal-dice' || type === 'reveal-roles') && shared()) {
      try { api.toTable?.(); } catch (err) { console.error(err); }
    }
  }

  /**
   * Where 「✓ 搞掂」 sends the phone (#15): the next seat of this phone that still has to look, clockwise from this one
   * (the shell's walk goes the same way), else back to the host (the controls live on that seat), else the middle.
   * → { kind: 'next' | 'host' | 'table', pid }
   */
  function handTarget(v) {
    const me = api.me;
    const order = (Array.isArray(api.players) ? api.players : []).filter((p) => p && !p.spectator).map((p) => p.id);
    const waiting = (lastCtx.focus?.pids ?? []).filter((id) => id !== me);
    if (waiting.length) {
      const i = order.indexOf(me);
      const rank = (id) => { const j = order.indexOf(id); return j < 0 ? order.length : (j - i + order.length) % order.length; };
      return { kind: 'next', pid: waiting.slice().sort((a, b) => rank(a) - rank(b))[0] };
    }
    const mine = Array.isArray(api.mySeats) ? api.mySeats : [];
    if (v.host && v.host !== me && mine.includes(v.host)) return { kind: 'host', pid: v.host };
    return { kind: 'table', pid: null };
  }

  /** 「✓ 搞掂」: this seat is done with its card and dice; the shell's walk (or handTo) moves the phone on. */
  function handOn() {
    const v = last;
    if (!v?.me?.playing || v.me.seenRole || v.revealRoles || sentDeal === v.dealId) return;
    const to = handTarget(v);
    // one tap only (a double tap would hand the phone over twice); let go after 3.5 s in case it never got through
    sentDeal = v.dealId;
    clearTimeout(sentTimer);
    sentTimer = setTimeout(() => { sentDeal = null; if (last) render(last); }, 3500);
    render(v);
    send({ type: 'seen' });
    if (to.kind === 'host') {
      try { api.handTo?.(to.pid, { why: '大家睇完牌' }); } catch (err) { console.error(err); }
    }
  }

  function rollAll(node) {
    if (last?.seats.some((s) => s.diceLocked) && !confirmed('有人鎖咗骰盅，全體搖骰會一齊解鎖。繼續？', node, 'roll-all')) return;
    if (!last?.me?.playing) sfx('roll');   // a moderator has no cup to rattle
    send({ type: 'roll-all' });
  }

  function onLockRole() {
    const me = last?.me;
    if (me?.playing) send({ type: 'lock-role', on: !me.roleLocked });
  }

  // DiceCup only calls these when the roll / lock is actually possible (it handles the
  // "locked cup" nudge itself); the engine re-checks everything anyway.
  const onRoll = () => send({ type: 'roll' });
  const onLockDice = () => send({ type: 'lock-dice' });

  /**
   * RoleCard callback. "Seen" is sent on RELEASE so the table moves on only after the peek ends. On a shared phone the
   * release sends nothing: the seat also rolls and locks its dice in the same turn, then taps 「✓ 搞掂」 (#15).
   */
  function onOpen(open) {
    if (open) { peeking = true; return; }
    if (!peeking) return;
    peeking = false;
    const v = last;
    if (!(v?.me?.playing && v.me.role && !v.me.seenRole && !v.revealRoles)) return;
    if (shared()) {
      if (peekedDeal !== v.dealId) { peekedDeal = v.dealId; render(v); }
      return;
    }
    send({ type: 'seen' });
  }

  // ---------- components ----------
  // Locked: no roll button and no lock button at all (the cup's corner badge and our head badge say it); the cup
  // still lifts, it is your own number.
  const cupProps = (v) => ({
    dice: v.me.dice, sides: v.dice.sides, rollSeq: v.me.rollSeq,
    canRoll: v.me.mayRoll && !v.me.diceLocked, lockedRoll: v.me.diceLocked,
    onRoll, onLock: v.me.diceLocked ? undefined : onLockDice, shakeToRoll: true,
  });

  /** Shared phone: this seat still owes its look (and its dice) — the walk is waiting for its 「✓ 搞掂」. */
  const inWalk = (v) => shared() && !!v.me?.playing && !v.me.seenRole && !v.revealRoles && v.phase === 'play';

  const cardProps = (v) => ({
    role: v.me.role ? { emoji: v.me.role.emoji, name: v.me.role.name, text: v.me.role.desc } : null,
    locked: v.me.roleLocked,
    // no button once roles are open; on a shared phone none while the walk waits for this seat either (latching the
    // card counts as 「looked」 and would hand the phone on before the dice)
    onLockToggle: (v.can.lockRole || v.can.unlockRole) && !inWalk(v) ? onLockRole : undefined,
    hint: v.revealRoles ? '大家嘅角色都公開咗' : undefined,
    onOpen,
  });

  function ensureCards(v) {
    const holds = !!v.me?.playing;
    if (holds && !cup && typeof C.DiceCup === 'function') {
      cup = C.DiceCup(cupProps(v));
      diceSlot.append(cup.el);
    } else if (!holds && cup) {
      cup.destroy(); cup.el.remove(); cup = null;
    }
    // A fresh deal must come up face-down even if a finger was still on the old card.
    if (card && (!holds || cardDealId !== v.dealId)) {
      card.destroy(); card = null; peeking = false;
    }
    if (holds && !card && typeof C.RoleCard === 'function') {
      card = C.RoleCard(cardProps(v));
      roleSlot.append(card.el);
      cardDealId = v.dealId;
    }
  }

  // ---------- rendering ----------
  const roleOf = (v, id) => v.roles.find((r) => r.id === id) ?? null;
  const face = (value, sides) => (typeof C.dieFace === 'function' ? C.dieFace(value, sides) : h('span', { text: String(value) }));

  function playerFor(id) {
    const players = api.players;
    return (Array.isArray(players) ? players : []).find((p) => p && p.id === id) ?? null;
  }

  function statusLine(v) {
    if (v.phase === 'ended') return ['done', '🏁 遊戲完咗'];
    if (v.revealRoles) return ['ok', '🔓 角色已經公開'];
    const waiting = v.seats.filter((s) => s.playing && !s.seenRole).length;
    if (inWalk(v) && peekedDeal === v.dealId) {
      return ['turn', v.me.mayRoll && !v.revealDice ? '睇完牌 ✓ 要搖骰就而家搖，搞掂㩒下面「✓ 搞掂」' : '睇完牌 ✓ 搞掂㩒下面「✓ 搞掂」'];
    }
    if (v.me?.playing && !v.me.seenRole) return ['turn', '輪到你睇牌 👇 㩒住張牌'];
    if (v.revealDice) return ['ok', '👁 開咗盅 — 睇下面「開盅」'];
    if (waiting === 0) return ['ok', '大家都睇咗牌 ✓'];
    return ['wait', `等緊 ${waiting} 個人睇牌`];
  }

  function tagsFor(v, s) {
    const tags = [];
    if (!s.playing) tags.push(['host', '主持']);
    const shown = v.revealRoles ? s.roleId : v.all?.[s.id];
    const r = shown != null ? roleOf(v, shown) : null;
    if (r) tags.push([v.revealRoles ? 'role' : 'peek', `${v.revealRoles ? '' : '👁 '}${r.emoji} ${r.name}`, explain(r)]);
    if (s.playing && !v.revealRoles) tags.push(s.seenRole ? ['seen', '已睇牌'] : ['unseen', '未睇牌']);
    // the count is public anyway (every roll is in the 📜 log); at a glance it shows a roll-until-it-fits before a lock
    if (s.rolled && !v.revealDice) tags.push(s.rolls > 1 ? ['dice many', `🎲 已搖 ×${s.rolls}`] : ['dice', '🎲 已搖']);
    if (s.diceLocked) tags.push(['lock', '🔒骰']);
    if (s.roleLocked) tags.push(['lock', '🔒牌']);
    return tags;
  }

  /** '🔪 殺手：做乜：… 點贏：…' — what a long-press on a role name shows (U1). */
  const explain = (r) => (typeof r.desc === 'string' && r.desc ? `${r.emoji ?? ''} ${r.name ?? ''}：${r.desc}`.trim() : null);

  /** Long-press (≈ ½ s) a role name → its one-line ability as a toast; a tap or a scroll does nothing. */
  function holdToExplain(node, text) {
    let timer = null;
    let at = null;
    const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
    node.setAttribute('title', text);
    node.addEventListener('pointerdown', (e) => {
      cancel();
      at = [e?.clientX ?? 0, e?.clientY ?? 0];
      timer = setTimeout(() => { timer = null; try { api.toast?.(text, 3200); } catch { /* never worth a crash */ } }, 450);
    });
    // a resting finger jitters; only a real move (a scroll) cancels
    node.addEventListener('pointermove', (e) => {
      if (timer && at && Math.hypot((e?.clientX ?? 0) - at[0], (e?.clientY ?? 0) - at[1]) > 10) cancel();
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) node.addEventListener(ev, cancel);
    node.addEventListener('contextmenu', (e) => e.preventDefault?.());   // no iOS / Android menu over the name
  }

  function makeRow(id) {
    const dot = h('span', { class: 'cu-dot' });
    const name = h('span', { class: 'cu-name' });
    const tags = h('span', { class: 'cu-tags' });
    const unlock = h('button', {
      type: 'button', class: 'cu-unlock', hidden: true, 'aria-label': '解鎖佢嘅骰盅', title: '解鎖佢嘅骰盅',
      onclick: () => send({ type: 'unlock-dice', pid: id }),
    }, '🔓');
    const el = h('li', { class: 'cu-row' }, dot, name, tags, unlock);
    return { el, dot, name, tags, unlock, sig: '' };
  }

  function syncRoster(v) {
    const alive = new Set();
    v.seats.forEach((s, i) => {
      alive.add(s.id);
      let row = rows.get(s.id);
      if (!row) { row = makeRow(s.id); rows.set(s.id, row); }
      const p = playerFor(s.id);
      const label = `${p?.name ?? s.name}${isMe(s.id) ? '（你）' : ''}`;
      if (row.name.textContent !== label) row.name.textContent = label;
      row.dot.style.background = p?.color || '';
      row.dot.classList.toggle('off', p ? p.connected === false : false);
      const tags = tagsFor(v, s);
      const sig = JSON.stringify(tags);
      if (sig !== row.sig) {
        row.sig = sig;
        row.tags.replaceChildren(...tags.map(([kind, text, more]) => {
          const tag = h('span', { class: `cu-tag ${kind}`, text });
          if (more) holdToExplain(tag, more);
          return tag;
        }));
      }
      row.unlock.hidden = !(v.controller && s.diceLocked);
      row.el.classList.toggle('me', isMe(s.id));
      if (roster.children[i] !== row.el) roster.insertBefore(row.el, roster.children[i] ?? null);
    });
    for (const [id, row] of rows) if (!alive.has(id)) { row.el.remove(); rows.delete(id); }
    countPill.textContent = String(v.seats.filter((s) => s.playing).length);
  }

  function syncShowdown(v) {
    const show = v.revealDice && v.seats.some((s) => Array.isArray(s.dice));
    showCard.hidden = !show;
    if (!show) { showSig = ''; return; }
    const sig = JSON.stringify([v.dice.sides, v.seats.map((s) => s.dice ?? null)]);
    if (sig === showSig) return;
    showSig = sig;
    showList.replaceChildren(...v.seats.filter((s) => Array.isArray(s.dice)).map((s) => {
      const p = playerFor(s.id);
      const sum = s.dice.reduce((a, b) => a + b, 0);
      return h('li', { class: 'cu-show-row' },
        h('span', { class: 'cu-show-name', text: p?.name ?? s.name }),
        h('span', { class: 'cu-show-dice' }, s.dice.map((d) => h('span', { class: 'cu-show-die' }, face(d, v.dice.sides)))),
        s.dice.length > 1 ? h('span', { class: 'cu-show-sum', text: `= ${sum}` }) : null);
    }));
  }

  function syncDeck(v) {
    const sig = JSON.stringify(v.roles);
    if (sig === deckSig) return;
    deckSig = sig;
    deckSum.textContent = `🃏 本局牌組（${v.roles.filter((r) => r.count > 0).length} 款）`;
    deckList.replaceChildren(...v.roles.filter((r) => r.count > 0).map((r) =>
      h('li', {}, h('span', { class: 'cu-deck-emoji', text: r.emoji }),
        h('span', { class: 'cu-deck-body' }, h('b', { text: `${r.name} ×${r.count}` }), r.desc ? h('small', { text: r.desc }) : null))));
  }

  function syncLog(v) {
    const sig = v.log.length ? v.log[v.log.length - 1].n : 0;
    if (sig === logSig) return;
    logSig = sig;
    logList.replaceChildren(...v.log.slice().reverse().map((l) => h('li', { text: l.text })));
  }

  function syncMine(v) {
    const me = v.me;
    const holds = !!me?.playing;
    diceCard.hidden = !holds;
    roleCard.hidden = !holds;
    noteCard.hidden = holds;
    syncDone(v);
    if (!holds) {
      noteCard.textContent = me
        ? (v.all ? '你係主持 🎙️ 今次你唔攞牌、唔擲骰。你睇到所有人嘅角色（下面）。' : '你係主持 🎙️ 今次你唔攞牌、唔擲骰，由你控制場面。')
        // the table screen of a shared phone (§7.1): nobody's card or cup, only what is public
        : api.atTable === true && shared() ? '📱 部機喺枱中間：開咗嘅骰同角色喺度一齊睇。'
          : '你喺度睇緊 👀 下一局先加入到。';
      return;
    }

    // dice
    cup?.update(cupProps(v));
    diceHint.textContent = v.revealDice ? '已經開盅，要主持再搖'
      : !me.mayRoll ? '今次淨係主持幫大家搖'
      : '';
    lockBadge.hidden = !me.diceLocked || v.revealDice;
    lockBadge.textContent = v.controller ? '🔒 鎖定咗點數' : '🔒 鎖定咗點數 · 主持先解得';

    // role
    card?.update(cardProps(v));
  }

  /** Shared phone, this seat's walk turn, after its first peek: 「✓ 搞掂 · 交俾 阿明」 under the card (#15). */
  function syncDone(v) {
    const show = inWalk(v) && peekedDeal === v.dealId;
    doneBox.hidden = !show;
    if (!show) return;
    const to = handTarget(v);
    const name = to.pid ? (playerFor(to.pid)?.name ?? v.seats.find((s) => s.id === to.pid)?.name ?? '?') : '';
    doneBtn.textContent = to.kind === 'next' ? `✓ 搞掂 · 交俾 ${name}`
      : to.kind === 'host' ? `✓ 搞掂 · 交返俾房主 ${name}` : '✓ 搞掂 · 擺返中間';
    doneBtn.disabled = sentDeal === v.dealId;
    doneNote.textContent = v.me.mayRoll && !v.revealDice ? '要搖骰就而家搖、鎖埋先交' : '';
    doneNote.hidden = !doneNote.textContent;
  }

  function syncControls(v) {
    ctlCard.hidden = !v.controller || v.phase !== 'play';
    if (ctlCard.hidden) return;
    const can = v.can;
    btns.rollAll.disabled = !can.rollAll;
    btns.unlockDice.disabled = !can.unlockDice;
    btns.revealDice.disabled = !can.revealDice;
    btns.revealRoles.disabled = !can.revealRoles;
    btns.redeal.disabled = !can.redeal;
    btns.nextRound.disabled = !can.nextRound;
    btns.end.disabled = !can.end;
  }

  function sounds(v) {
    if (prev) {   // the first view a phone gets is history, not news
      if (v.dealId !== prev.dealId) sfx('deal');
      if (v.revealRoles && !prev.revealRoles) sfx('reveal');
      if (v.revealDice && !prev.revealDice) sfx('lift');
    }
    prev = v;
  }

  /** Paint everything from a view (update, or a local change such as the first peek on a shared phone). */
  function render(view) {
    const [kind, text] = statusLine(view);
    status.className = `cu-status ${kind}`;
    status.textContent = text;
    if (lastCtx.paused) status.textContent += '（暫停緊）';

    syncMine(view);
    syncShowdown(view);
    syncRoster(view);
    syncControls(view);
    syncDeck(view);
    syncLog(view);
  }

  return {
    update(raw, ctx) {
      const view = normaliseView(raw);
      if (!view) return;   // not our view (another game's, or nothing yet): the right one is on its way
      last = view;
      lastCtx = isObj(ctx) ? ctx : {};
      sounds(view);
      ensureCards(view);
      render(view);
    },

    destroy() {
      clearTimeout(sentTimer);
      sentTimer = null;
      cup?.destroy();
      card?.destroy();
      cup = null;
      card = null;
      for (const row of rows.values()) row.el.remove();
      rows.clear();
      wrap.remove();
    },
  };
}
