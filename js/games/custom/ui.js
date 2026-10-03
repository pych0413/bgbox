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
// Uses only api.components (RoleCard, DiceCup, dieFace), api.send, api.sfx and
// api.players. The role card and the cup own their own sounds (flip, lock,
// roll chime keyed on rollSeq), so this file only adds game-level ones.
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

function confirmed(text) {
  return typeof globalThis.confirm === 'function' ? globalThis.confirm(text) : true;
}

export function mount(root, api) {
  const C = api.components;
  const wrap = h('div', { class: 'cu' });
  root.append(wrap);

  let last = null;          // last view
  let lastCtx = {};
  let prev = null;          // previous view, for sound transitions
  let peeking = false;      // this finger opened the role card
  let cup = null;           // DiceCup instance (card holders only)
  let card = null;          // RoleCard instance (card holders only)
  let cardDealId = null;

  // ---------- banner ----------
  const status = h('div', { class: 'cu-status' });

  // ---------- dice card ----------
  const diceHint = h('small', { class: 'cu-hint' });   // only says WHY the cup cannot roll; the cup has its own hint
  const diceSlot = h('div', { class: 'cu-slot' });
  const diceCard = h('section', { class: 'cu-card', hidden: true },
    h('div', { class: 'cu-head' }, h('h3', { text: '骰盅' }), diceHint), diceSlot);

  // ---------- role card ----------
  const roleSlot = h('div', { class: 'cu-slot' });
  const roleCard = h('section', { class: 'cu-card', hidden: true },
    h('div', { class: 'cu-head' }, h('h3', { text: '我嘅角色牌' })), roleSlot);

  // ---------- no-card note (moderator / spectator) ----------
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
    rollAll: ctlButton('🎲 全體搖骰', () => rollAll()),
    unlockDice: ctlButton('🔓 解鎖骰盅', () => api.send({ type: 'unlock-dice' })),
    revealDice: ctlButton('👁 開晒啲骰', () => sendHost('reveal-dice')),
    revealRoles: ctlButton('🔓 開晒角色', () => sendHost('reveal-roles'), 'danger'),
    redeal: ctlButton('🃏 重新派牌', () => sendHost('redeal')),
    nextRound: ctlButton('➡️ 下一回合（重新派牌）', () => api.send({ type: 'next-round' }), 'primary'),
    end: ctlButton('🏁 結束遊戲', () => sendHost('end'), 'quiet'),
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

  wrap.append(status, diceCard, roleCard, noteCard, showCard, tableCard, ctlCard, deckCard, logCard);

  function ctlButton(label, onclick, kind = '') {
    return h('button', { type: 'button', class: `cu-btn ${kind}`.trim(), onclick }, label);
  }

  // ---------- actions ----------
  function sendHost(type) {
    if (NEED_CONFIRM[type] && !confirmed(NEED_CONFIRM[type])) return;
    api.send({ type });
  }

  function rollAll() {
    if (last?.seats.some((s) => s.diceLocked) && !confirmed('有人鎖咗骰盅，全體搖骰會一齊解鎖。繼續？')) return;
    if (!last?.me?.playing) api.sfx('roll');   // a moderator has no cup to rattle
    api.send({ type: 'roll-all' });
  }

  function onLockRole() {
    const me = last?.me;
    if (me?.playing) api.send({ type: 'lock-role', on: !me.roleLocked });
  }

  // DiceCup only calls these when the roll / lock is actually possible (it handles the
  // "locked cup" nudge itself); the engine re-checks everything anyway.
  const onRoll = () => api.send({ type: 'roll' });
  const onLockDice = () => api.send({ type: 'lock-dice' });

  /** RoleCard callback. "Seen" is sent on RELEASE so a shared phone moves on only after the peek ends. */
  function onOpen(open) {
    if (open) { peeking = true; return; }
    if (!peeking) return;
    peeking = false;
    const v = last;
    if (v?.me?.playing && v.me.role && !v.me.seenRole && !v.revealRoles) api.send({ type: 'seen' });
  }

  // ---------- components ----------
  const cupProps = (v) => ({
    dice: v.me.dice, sides: v.dice.sides, rollSeq: v.me.rollSeq,
    canRoll: v.me.mayRoll, lockedRoll: v.me.diceLocked,
    onRoll, onLock: onLockDice, shakeToRoll: true,
  });

  const cardProps = (v) => ({
    role: v.me.role ? { emoji: v.me.role.emoji, name: v.me.role.name, text: v.me.role.desc } : null,
    locked: v.me.roleLocked,
    onLockToggle: v.can.lockRole || v.can.unlockRole ? onLockRole : undefined,   // no button once roles are open
    hint: v.revealRoles ? '大家嘅角色都公開咗' : undefined,
    onOpen,
  });

  function ensureCards(v) {
    const holds = !!v.me?.playing;
    if (holds && !cup) {
      cup = C.DiceCup(cupProps(v));
      diceSlot.append(cup.el);
    } else if (!holds && cup) {
      cup.destroy(); cup.el.remove(); cup = null;
    }
    // A fresh deal must come up face-down even if a finger was still on the old card.
    if (card && (!holds || cardDealId !== v.dealId)) {
      card.destroy(); card = null; peeking = false;
    }
    if (holds && !card) {
      card = C.RoleCard(cardProps(v));
      roleSlot.append(card.el);
      cardDealId = v.dealId;
    }
  }

  // ---------- rendering ----------
  const roleOf = (v, id) => v.roles.find((r) => r.id === id) ?? null;

  function playerFor(id) {
    return (api.players || []).find((p) => p.id === id) ?? null;
  }

  function statusLine(v) {
    if (v.phase === 'ended') return ['done', '🏁 遊戲完咗'];
    if (v.revealRoles) return ['ok', '🔓 角色已經公開'];
    const waiting = v.seats.filter((s) => s.playing && !s.seenRole).length;
    if (v.me?.playing && !v.me.seenRole) return ['turn', '輪到你睇牌 👇 㩒住張牌'];
    if (waiting === 0) return ['ok', '大家都睇咗牌 ✓'];
    return ['wait', `等緊 ${waiting} 個人睇牌`];
  }

  function tagsFor(v, s) {
    const tags = [];
    if (!s.playing) tags.push(['host', '主持']);
    const shown = v.revealRoles ? s.roleId : v.all?.[s.id];
    const r = shown != null ? roleOf(v, shown) : null;
    if (r) tags.push([v.revealRoles ? 'role' : 'peek', `${v.revealRoles ? '' : '👁 '}${r.emoji} ${r.name}`]);
    if (s.playing && !v.revealRoles) tags.push(s.seenRole ? ['seen', '已睇牌'] : ['unseen', '未睇牌']);
    if (s.rolled && !v.revealDice) tags.push(['dice', '🎲 已搖']);
    if (s.diceLocked) tags.push(['lock', '🔒骰']);
    if (s.roleLocked) tags.push(['lock', '🔒牌']);
    return tags;
  }

  function makeRow(id) {
    const dot = h('span', { class: 'cu-dot' });
    const name = h('span', { class: 'cu-name' });
    const tags = h('span', { class: 'cu-tags' });
    const unlock = h('button', {
      type: 'button', class: 'cu-unlock', hidden: true, 'aria-label': '解鎖佢嘅骰盅', title: '解鎖佢嘅骰盅',
      onclick: () => api.send({ type: 'unlock-dice', pid: id }),
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
      const label = `${p?.name ?? s.name}${s.id === api.me ? '（你）' : ''}`;
      if (row.name.textContent !== label) row.name.textContent = label;
      row.dot.style.background = p?.color || '';
      row.dot.classList.toggle('off', p ? p.connected === false : false);
      const tags = tagsFor(v, s);
      const sig = JSON.stringify(tags);
      if (sig !== row.sig) {
        row.sig = sig;
        row.tags.replaceChildren(...tags.map(([kind, text]) => h('span', { class: `cu-tag ${kind}`, text })));
      }
      row.unlock.hidden = !(v.controller && s.diceLocked);
      row.el.classList.toggle('me', s.id === api.me);
      if (roster.children[i] !== row.el) roster.insertBefore(row.el, roster.children[i] ?? null);
    });
    for (const [id, row] of rows) if (!alive.has(id)) { row.el.remove(); rows.delete(id); }
    countPill.textContent = String(v.seats.filter((s) => s.playing).length);
  }

  function syncShowdown(v) {
    const show = v.revealDice && v.seats.some((s) => s.dice);
    showCard.hidden = !show;
    if (!show) { showSig = ''; return; }
    const sig = JSON.stringify([v.dice.sides, v.seats.map((s) => s.dice ?? null)]);
    if (sig === showSig) return;
    showSig = sig;
    showList.replaceChildren(...v.seats.filter((s) => s.dice).map((s) => {
      const p = playerFor(s.id);
      const sum = s.dice.reduce((a, b) => a + b, 0);
      return h('li', { class: 'cu-show-row' },
        h('span', { class: 'cu-show-name', text: p?.name ?? s.name }),
        h('span', { class: 'cu-show-dice' }, s.dice.map((d) => h('span', { class: 'cu-show-die' }, C.dieFace(d, v.dice.sides)))),
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
    if (!holds) {
      noteCard.textContent = me
        ? (v.all ? '你係主持 🎙️ 今次你唔攞牌、唔擲骰。你睇到所有人嘅角色（下面）。' : '你係主持 🎙️ 今次你唔攞牌、唔擲骰，由你控制場面。')
        : '你喺度睇緊 👀 下一局先加入到。';
      return;
    }

    // dice
    cup.update(cupProps(v));
    diceHint.textContent = v.revealDice ? '已經開盅，要主持再搖'
      : !me.mayRoll ? '今次淨係主持幫大家搖'
      : '';

    // role
    card.update(cardProps(v));
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
      if (v.dealId !== prev.dealId) api.sfx('deal');
      if (v.revealRoles && !prev.revealRoles) api.sfx('reveal');
      if (v.revealDice && !prev.revealDice) api.sfx('lift');
    }
    prev = v;
  }

  return {
    update(view, ctx = {}) {
      if (!view) return;
      last = view;
      lastCtx = ctx;
      sounds(view);
      ensureCards(view);

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
    },

    destroy() {
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
