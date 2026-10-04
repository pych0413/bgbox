// ============================================================
// undercover/ui.js — 誰是臥底: what a phone shows in every phase.
//
//   mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view and idempotent: the same view twice changes nothing. Only
// api.components (RoleCard, VotePanel, Timer) and the dom helper are used.
// The shell mounts one UI per seat, so api.me is always the seat on screen.
// The word card and the guess box live as long as their screen, so a half-peeked
// card or half-typed guess survives every update; a screen is rebuilt only when
// the step itself changes (its `key`).
//
// The phases and the wording: docs/games/undercover.md.
// ============================================================

import { el, restartAnim } from '../../ui/dom.js?v=1';

const ROLE = {
  civilian: { emoji: '🧑', name: '平民' },
  undercover: { emoji: '🕵️', name: '臥底' },
  blank: { emoji: '⬜', name: '白板' },
};
const ACCENT = '#a78bfa';
/** Why a vote put nobody out (engine `elim.reason`). */
const NO_OUT = { nobody: '冇人投票', nomajority: '冇人過半數', alltied: '全部人同票', pktie: 'PK 再平票', tie: '平票' };
const BANNER = { civilians: ['is-civ', '🧑 平民贏！'], infiltrators: ['is-inf', '🕵️ 臥底方贏！'], blank: ['is-inf', '⬜ 白板贏！'] };
/** U5: 開始投票 on a whole-table phone is two taps; the armed button reads 「再㩒一次：開始投票？全枱傾夠未？」. */
const START_ASK = '開始投票？全枱傾夠未？';
const LOCKOUT_MS = 1500;           // 睇完 after a result appears, and a shared phone's next 「X 講完喇」, stay dead this long
const RETRY_MS = 4000;             // a tap the host never confirmed comes back as a button after this long
const AWAY = '💤 房主當咗你唔喺度。返咗嚟就叫房主加返你。';
/** Nobody here holds a role, only a word: the card's own words (RoleCard says 角色牌). */
const CARD_TEXT = {
  lock: '🔓 鎖定詞語卡',
  locked: '🔒 已鎖 — 㩒一下解鎖',
  refused: '詞語卡鎖咗，要自己解鎖',
  aria: '㩒住睇詞語',
};

export function mount(root, api) {
  const C = api.components;
  const sfx = (name) => { try { api.sfx?.(name); } catch { /* sound is a bonus */ } };

  let view = null;
  let ctx = {};
  let screen = null;                 // { key, el, update(view, ctx), destroy() }
  let lastSpeakStep = null;
  let relaxedShown = false;
  let locked = false;                // the word card's lock
  let wordOpen = false;              // the 睇返我個詞 panel

  // ---------- page skeleton ----------
  const counts = el('p', { class: 'uc-counts' });
  const seatsBox = el('div', { class: 'uc-seats', role: 'list' });
  const body = el('div', { class: 'uc-body' });
  const wordBox = el('div', { class: 'uc-word' });
  const page = el('div', { class: 'uc' }, counts, seatsBox, body, wordBox);
  root.replaceChildren(page);

  // ---------- helpers ----------
  const players = () => api.players ?? [];
  const byId = (id) => players().find((p) => p.id === id);
  const nameOf = (id) => byId(id)?.name ?? '?';
  const namesOf = (ids) => ids.map(nameOf).join('、');
  const meId = () => view?.me?.id ?? api.me ?? null;
  /** 💤 = the host marked the seat absent (public): never waited on, no clue turn, no vote. */
  const away = (id) => !!view?.absent?.includes(id);
  /** The other seats this same phone holds (a passed-round phone): one tap counts for all of them. */
  const deviceMates = () => {
    const dev = byId(meId())?.deviceId;
    return dev ? players().filter((p) => p.deviceId === dev && p.id !== meId()).map((p) => p.id) : [];
  };
  const withMates = (action) => { const m = deviceMates(); return m.length ? { ...action, seats: m } : action; };

  /**
   * More than one seat on this phone? Then it is passed around, and every public control goes to whoever holds it.
   * The shell says so (api.shared, DESIGN §7.1); an older shell is read from the seats' devices.
   */
  function sharedDevice() {
    if (typeof api.shared === 'boolean') return api.shared;
    const me = byId(meId());
    if (!me?.deviceId) return false;
    return players().filter((p) => p.deviceId === me.deviceId).length > 1;
  }
  /** §7.1: this mount is the shared phone lying in the middle of the table (no seat on screen). */
  const atTable = () => !!api.atTable && api.me == null;
  /** …and that phone holds every seated player: one tap there is the table's decision (U5). */
  const wholeTable = () => atTable() && !!api.wholeTable;
  /** A whole-table tap from the table screen (api.tableSend); false while the table card is still up (U5). */
  const tableTap = (action, opts) => (ctx.tableLocked ? false : api.tableSend?.(action, opts) ?? false);

  /** "That is you" only means something on a phone of your own; on a shared one the seat on screen is just whoever held it last. */
  const isMe = (id) => id != null && id === meId() && !sharedDevice();

  const roleChip = (role) => (role && ROLE[role]
    ? el('span', { class: `uc-role uc-role-${role}` }, `${ROLE[role].emoji} ${ROLE[role].name}`)
    : null);

  function button(label, onClick, cls = 'btn btn-primary btn-lg') {
    const b = el('button', { class: cls, type: 'button' }, label);
    b.addEventListener('click', () => { sfx('tap'); onClick(); });
    return b;
  }

  const dot = (id) => el('span', { class: 'uc-dot', style: { '--seat': byId(id)?.color ?? ACCENT } });

  // ---------- the word card (one instance, moved between places) ----------
  function wordRole() {
    const w = view?.me?.word;
    return {
      emoji: '🃏',
      name: w ?? '白板',                         // same size, same place: only the text tells the white card apart
      team: 'word',
      color: ACCENT,
      teamLabel: '',
      text: w != null ? '用一句嘢形容佢，但唔好直接講出嚟。' : '你冇詞語。聽清楚其他人點形容，扮到似有。',
    };
  }

  function cardProps() {
    return {
      role: wordRole(),
      locked,
      ariaLabel: CARD_TEXT.aria,
      // no onLockToggle: RoleCard's own lock button says 「鎖定角色牌」, so the lock button below is the game's
      // On a passed-around phone every peek ends locked again, so the next person to hold it sees nothing.
      onOpen: (open) => { if (!open && sharedDevice() && !locked) { locked = true; paintCard(); } },
    };
  }

  // RoleCard words its lock for a ROLE card (「鎖定角色牌」, 「角色牌鎖咗」, 「㩒住睇角色牌」). This card holds a word, so
  // the lock button is the game's own (RoleCard's classes, so it looks the same), a press on the locked card is
  // refused here with the word-card message (before the cover would say 角色牌), and the label is renamed.
  const card = C.RoleCard({ role: null, locked: false });
  const lockBtn = el('button', { class: 'btn btn-ghost c-rolecard-lock uc-lock', type: 'button' });
  lockBtn.addEventListener('click', () => {
    sfx(locked ? 'unlock' : 'lock');
    if (!locked) card.close();                 // locking hides the card straight away
    locked = !locked;
    paintCard();
  });
  const cardBox = el('div', { class: 'uc-card' }, card.el, lockBtn);

  function refuseLocked(e) {
    const cover = card.cover?.el;
    if (!locked || !cover || !cover.contains?.(e.target)) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault?.();
    e.stopPropagation?.();                     // the cover never sees the press, so it never says 角色牌
    if (e.repeat) return;
    restartAnim(cover, 'denied');
    sfx('deny');
    api.toast?.(CARD_TEXT.refused);
  }
  card.el.addEventListener('pointerdown', refuseLocked, true);
  card.el.addEventListener('keydown', refuseLocked, true);

  function paintCard() {
    if (!view?.me) return;
    card.update(cardProps());
    card.cover?.el?.setAttribute?.('aria-label', CARD_TEXT.aria);
    lockBtn.textContent = locked ? CARD_TEXT.locked : CARD_TEXT.lock;
    lockBtn.classList.toggle('btn-locked', locked);
  }

  function placeCard(container) {
    if (cardBox.parentNode === container) return;
    card.close();
    container.append(cardBox);
  }

  // ---------- timer slot ----------
  function timerSlot() {
    const box = el('div', { class: 'uc-timer' });
    let t = null;
    return {
      el: box,
      update(v, c) {
        if (typeof v.deadline !== 'number' || !v.timerLabel) {
          t?.destroy();
          t = null;
          box.hidden = true;
          return;
        }
        box.hidden = false;
        const props = {
          deadline: v.deadline,
          now: api.now,
          label: v.timerLabel,
          paused: !!c.paused,
          warnAt: v.timerLabel === '討論' ? [60, 10] : [10],
        };
        if (!t) { t = C.Timer(props); box.append(t.el); } else t.update(props);
      },
      destroy() { t?.destroy(); t = null; },
    };
  }

  // ============================================================
  // screens
  // ============================================================

  // ---- deal: look at your word, tap 記住喇 ----
  function dealScreen() {
    // the card's own hint already says how to peek (「㩒住先睇到，放手即刻冚返」): say it once
    const lead = el('p', { class: 'uc-lead', text: '睇清楚你個詞，記住就㩒「記住喇」。' });
    const slot = el('div', { class: 'uc-cardslot' });
    const action = el('div', { class: 'uc-action' });
    const note = el('p', { class: 'uc-note' });
    const status = el('p', { class: 'uc-status' });
    const box = el('section', { class: 'uc-screen' }, el('h2', { class: 'uc-title', text: atTable() ? '睇詞語' : '你嘅詞語' }), lead, slot, action, status, note);
    let readyShown = null;

    function remember() {
      locked = true;                        // lock the card the moment you are done with it
      sfx('lock');
      paintCard();
      api.send({ type: 'ready' });
    }

    return {
      el: box,
      update(v) {
        const me = v.me;
        slot.hidden = !me;
        if (!me) {
          lead.textContent = atTable() ? '部手機逐個傳：輪到嘅人睇自己個詞。' : '大家逐個睇緊自己嘅詞語，你係旁觀者。';
          action.replaceChildren();
          note.textContent = '';
        } else {
          placeCard(slot);
          const state = away(me.id) ? 'away' : me.ready;
          if (readyShown !== state) {
            readyShown = state;
            action.replaceChildren(state === 'away' ? el('p', { class: 'uc-note' }, AWAY)
              : me.ready ? el('p', { class: 'uc-done' }, '✓ 你已經記住咗') : button('記住喇 ✓', remember));
          }
          lead.hidden = me.ready;
          note.textContent = me.ready
            ? '想再睇一次？㩒 🔓 解鎖，睇完記得再鎖返。'
            : '記住之後張卡會自動鎖住，唔怕隔離個人㩒到。';
        }
        const waiting = v.seats.filter((s) => !v.deal.ready.includes(s.id) && !away(s.id)).map((s) => s.id);
        status.textContent = waiting.length
          ? `已有 ${v.deal.ready.filter((id) => !away(id)).length} / ${v.deal.total} 人記住咗 · 等緊：${namesOf(waiting)}`
          : '大家都記住喇，即刻開始！';
      },
      destroy() {},
    };
  }

  // ---- speak: whose turn it is ----
  function speakScreen() {
    const who = el('div', { class: 'uc-who' });
    const sub = el('p', { class: 'uc-sub' });
    const timer = timerSlot();
    const hint = el('p', { class: 'uc-note' });
    const order = el('ol', { class: 'uc-order' });
    const action = el('div', { class: 'uc-action' });
    const box = el('section', { class: 'uc-screen' }, who, sub, timer.el, action, hint, order);
    let actionStep = null;
    let tableBtn = null;
    let doneBtn = null;               // the 「X 講完喇 ▸」 on screen (table or shared seat): the bounce lock applies to it
    let bounce = false;               // re-run #2 N1: the new speaker's button is dead for a moment after an advance
    let bounceTimer = null;
    const paintLock = () => {
      if (tableBtn) tableBtn.disabled = bounce || !!ctx.tableLocked;     // U5: not while the 「擺返中間」 card is up
      else if (doneBtn) doneBtn.disabled = bounce;
      who.classList.toggle('is-new', bounce);                           // the new speaker's name pulses meanwhile
    };

    return {
      el: box,
      update(v, c) {
        const sp = v.speak;
        const mine = isMe(sp.pid);
        who.className = `uc-who${mine ? ' is-me' : ''}`;
        who.replaceChildren(dot(sp.pid), el('strong', {}, mine ? '輪到你講！' : `${nameOf(sp.pid)} 講緊…`));
        sub.textContent = sp.kind === 'pk'
          ? `PK 發言 · 第 ${sp.turn + 1} / ${sp.order.length} 個`
          : `第 ${v.round} 輪 · 第 ${sp.turn + 1} / ${sp.order.length} 個`;
        timer.update(v, c);
        hint.textContent = sp.kind === 'pk'
          ? '平票嘅人再講多一句：點解你唔係臥底？'
          : '一人一句。唔可以講出個詞，或者入面任何一個字。';
        // an absent seat's clue turn is skipped (D4): 💤 instead of ✓
        order.replaceChildren(...sp.order.map((id, i) => el('li', {
          class: `uc-order-item${i < sp.turn ? ' is-done' : ''}${i === sp.turn ? ' is-now' : ''}${isMe(id) ? ' is-me' : ''}${away(id) ? ' is-away' : ''}`,
        }, dot(id), el('span', { class: 'uc-order-name' }, nameOf(id)),
        away(id) && i >= sp.turn ? el('span', { class: 'uc-order-tick' }, '💤')
          : i < sp.turn ? el('span', { class: 'uc-order-tick' }, sp.spoke.includes(id) ? '✓' : '💤') : null)));

        if (actionStep !== sp.id) {
          // re-run #2 N1: on a shared phone the button for the NEXT speaker is rebuilt in the same spot the moment a
          // turn ends, so a double tap (or two people tapping together) would end that turn too. Each tap carries the
          // step it was made on (`at`, stale ones are dropped by the engine), and after an advance the new button stays
          // dead for LOCKOUT_MS while the new name pulses. Not on the first paint, not on a phone of your own.
          const advanced = actionStep !== null;
          actionStep = sp.id;
          tableBtn = null;
          doneBtn = null;
          const at = sp.id;
          if (atTable()) {
            // §7.1: the phone lies in the middle while the clues go round — anyone taps for the speaker who finished
            tableBtn = button(`${nameOf(sp.pid)} 講完喇 ▸`, () => { if (!bounce) tableTap({ type: 'done', at }); });
            action.replaceChildren(tableBtn);
          } else {
            const canDone = v.me && (mine || sharedDevice());
            doneBtn = canDone
              ? button(mine ? '講完喇 ▸' : `${nameOf(sp.pid)} 講完喇 ▸`, () => { if (!bounce) api.send({ type: 'done', at }); })
              : null;
            action.replaceChildren(doneBtn ?? (v.me && !v.me.alive ? el('p', { class: 'uc-note' }, '你已經出局，聽住大家講。') : ''));
          }
          clearTimeout(bounceTimer);
          bounce = advanced && (atTable() || sharedDevice());
          if (bounce) bounceTimer = setTimeout(() => { bounce = false; paintLock(); }, LOCKOUT_MS);
        }
        paintLock();
      },
      destroy() { timer.destroy(); clearTimeout(bounceTimer); },
    };
  }

  // ---- discuss: the vote opens when a majority of the alive seats has tapped 開始投票 (D2) ----
  function discussScreen() {
    const timer = timerSlot();
    const action = el('div', { class: 'uc-action' });
    const status = el('p', { class: 'uc-status uc-want' });
    const box = el('section', { class: 'uc-screen' },
      el('h2', { class: 'uc-title', text: '自由討論' }),
      el('p', { class: 'uc-lead', text: '大家都講完喇。邊個最似臥底？傾夠就開始投票。' }),
      timer.el, action, status);
    let shown = null;
    let pending = false;               // tapped, not yet confirmed by the host
    let retry = null;
    let tableBtn = null;
    /**
     * §7.1 the shared phone in the middle: one tap counts for every seat it holds (api.tableSend). A phone that holds
     * the whole table opens the vote with it, so it takes a second tap there (U5): the shell's confirm arms the button
     * as 「再㩒一次：開始投票？全枱傾夠未？」 (re-run #2 N3: the armed label still says what the second tap does).
     */
    function tableStart() {
      if (ctx.tableLocked) return;
      if (tableTap({ type: 'start-vote' }, { confirm: START_ASK, node: tableBtn }) === false) return;
      pending = true;
      clearTimeout(retry);
      retry = setTimeout(() => { pending = false; render(); }, RETRY_MS);
      render();
    }
    /** A seat's own 開始投票 (it also counts the phone's other seats). On a whole-table phone it is the table's call: two taps (U5). */
    function seatStartBtn() {
      const b = button('開始投票 🗳️', () => {
        if (api.wholeTable && api.confirm && !api.confirm(START_ASK, b)) return;
        pending = true;
        api.send(withMates({ type: 'start-vote' }));
        clearTimeout(retry);
        retry = setTimeout(() => { pending = false; render(); }, RETRY_MS);
        render();
      });
      return b;
    }
    return {
      el: box,
      update(v, c) {
        timer.update(v, c);
        const d = v.discuss;
        const me = v.me;
        const mine = !!me && d.want.includes(me.id);
        if (mine) pending = false;
        const mates = atTable() ? (api.mySeats ?? []).filter((id) => v.seats.some((s) => s.id === id && s.alive) && !away(id)) : [];
        const tableAsked = atTable() && mates.length > 0 && mates.every((id) => d.want.includes(id));
        if (tableAsked) pending = false;
        const state = atTable() ? (!mates.length ? 'table' : tableAsked || pending ? 'tableAsked' : 'tableAsk')
          : !me ? 'table' : away(me.id) ? 'away' : !me.alive ? 'dead' : mine || pending ? 'asked' : 'ask';
        if (state !== shown) {
          shown = state;
          tableBtn = state === 'tableAsk' ? button('開始投票 🗳️', tableStart) : null;
          action.replaceChildren(
            state === 'tableAsk' ? tableBtn
              : state === 'tableAsked' ? el('p', { class: 'uc-done' }, wholeTable() ? '✓ 開始投票' : '✓ 呢部機嘅人想開始投票')
            : state === 'table' ? el('p', { class: 'uc-note' }, '等大家開始投票。')
              : state === 'away' ? el('p', { class: 'uc-note' }, AWAY)
                : state === 'dead' ? el('p', { class: 'uc-note' }, '你已經出局，由未出局嘅人決定幾時投票。')
                  : state === 'asked' ? el('p', { class: 'uc-done' }, '✓ 你想開始投票')
                    : seatStartBtn());
        }
        if (tableBtn) tableBtn.disabled = !!ctx.tableLocked;   // U5: not while the 「擺返中間」 card is up
        // every phone shows the same count: 「想開始投票 2 / 3」 (more than half of the alive seats at the table) — not on
        // a phone that holds the whole table, where the one (confirmed) tap opens the vote
        status.hidden = wholeTable();
        status.textContent = `想開始投票 ${d.want.length} / ${d.need}${d.want.length ? ` · ${namesOf(d.want)}` : ''}`;
      },
      destroy() { timer.destroy(); clearTimeout(retry); },
    };
  }

  // ---- vote ----
  function voteScreen() {
    const title = el('h2', { class: 'uc-title' });
    const lead = el('p', { class: 'uc-lead' });
    const timer = timerSlot();
    const panelSlot = el('div', { class: 'uc-panel' });
    const wait = el('p', { class: 'uc-status' });
    const box = el('section', { class: 'uc-screen' }, title, lead, timer.el, panelSlot, wait);
    let panel = null;

    return {
      el: box,
      update(v, c) {
        const vt = v.vote;
        const me = v.me;
        const pk = vt.kind === 'pk';
        title.textContent = pk ? 'PK 投票' : '投票';
        timer.update(v, c);
        if (me?.canVote) {
          lead.textContent = pk
            ? `只可以投 ${namesOf(vt.candidates)} 其中一個${vt.candidates.includes(me.id) ? '（你自己都要投對方）' : ''}。`
            : '揀你覺得係臥底嘅人，唔可以投自己。全部人投晒先會公佈。';
          const props = {
            players: players(),
            candidates: me.targets,
            me: me.id,
            myVote: me.myVote,
            secretChoice: true,              // D6: your phone says 已投 ✓, never whom — a glance learns nothing
            allowAbstain: !!v.flags.abstain,
            progress: { done: vt.done.length, total: vt.total },
            reveal: null,
            onVote: (target) => api.send({ type: 'vote', target }),
          };
          if (!panel) { panel = C.VotePanel(props); panelSlot.append(panel.el); } else panel.update(props);
          panelSlot.hidden = false;
        } else {
          if (!me) lead.textContent = atTable() ? '大家輪流投緊票：部手機會逐個交，全部投完先公佈。' : '大家投緊票。';
          else if (away(me.id)) lead.textContent = AWAY;
          else if (me.alive) lead.textContent = '你喺 PK 入面，今次唔使投，等其他人決定。';
          else lead.textContent = '你已經出局，唔使投票，睇住大家投。';
          panel?.destroy();
          panel = null;
          panelSlot.hidden = true;
        }
        const pending = vt.voters.filter((id) => !vt.done.includes(id));
        wait.textContent = pending.length
          ? `已投 ${vt.done.length} / ${vt.total} · 仲未投：${namesOf(pending)}`
          : '投晒喇，公佈緊…';
      },
      destroy() { timer.destroy(); panel?.destroy(); },
    };
  }

  // ---- elim: the result of the vote ----
  function elimScreen() {
    const title = el('h2', { class: 'uc-title' });
    const panelSlot = el('div', { class: 'uc-panel' });
    const verdict = el('div', { class: 'uc-verdict' });
    const guessBox = el('div', { class: 'uc-guess' });
    const timer = timerSlot();
    const action = el('div', { class: 'uc-action' });
    const box = el('section', { class: 'uc-screen' }, title, verdict, guessBox, timer.el, panelSlot, action);

    let panel = null;
    let input = null;
    let submit = null;
    let guessMode = null;             // 'write' | 'wait' | 'done' | null
    let unlocked = false;             // the lockout on 睇完 is over
    let waiting = false;
    let canContinue = false;
    let mineSeen = false;
    let pending = false;              // 睇完 tapped, not yet confirmed by the host
    let retry = null;
    // D3: the result stays until every present seat has tapped 睇完 (the host's 下一步 can force it). On the table
    // screen of a shared phone it is one tap for every seat the phone holds (api.tableSend, §7.1) — the whole table
    // on a one-phone table: 「大家睇完 ✓（一下就得）」, locked while the 「擺返中間」 card is still up (U5)
    const table = atTable();
    const proceed = button(table ? (wholeTable() ? '大家睇完 ✓（一下就得）' : '睇完 ✓（呢部機嘅人）') : '睇完 ✓', () => {
      if (table ? tableTap({ type: 'continue' }) === false : api.send(withMates({ type: 'continue' })) === false) return;
      pending = true;
      clearTimeout(retry);
      retry = setTimeout(() => { pending = false; paintProceed(); }, RETRY_MS);
      paintProceed();
    });
    proceed.disabled = true;
    const doneNote = el('p', { class: 'uc-done' }, table && wholeTable() ? '✓ 睇完' : '✓ 睇完 · 等緊其他人');
    doneNote.hidden = true;
    const seenLine = el('p', { class: 'uc-status uc-seen' });
    action.append(proceed, doneNote, seenLine);
    const unlockTimer = setTimeout(() => { unlocked = true; paintProceed(); }, LOCKOUT_MS);

    function paintProceed() {
      const done = mineSeen || pending;
      proceed.hidden = waiting || !canContinue || done;
      proceed.disabled = !unlocked || (table && !!ctx.tableLocked);
      doneNote.hidden = waiting || !canContinue || !done;
    }

    /** 「睇完 3 / 5 · 等緊：阿明、小美」 — the same on every phone (not on the one phone of the whole table: one tap does it). */
    function paintSeen(v) {
      const s = v.elim.seen;
      seenLine.hidden = waiting || !s || wholeTable();
      if (!s || waiting) return;
      const left = v.seats.map((x) => x.id).filter((id) => !s.who.includes(id) && !away(id));
      seenLine.textContent = `睇完 ${s.who.length} / ${s.total}${left.length ? ` · 等緊：${namesOf(left)}` : ''}`;
    }

    function paintVerdict(e, v) {
      const kids = [];
      if (e.kind === 'out') {
        kids.push(el('div', { class: 'uc-out' }, dot(e.out), el('strong', {}, `${nameOf(e.out)} 出局`)));
        kids.push(e.role ? roleChip(e.role) : el('span', { class: 'uc-role uc-role-hidden' }, '身份唔公開'));
        if (e.forced) kids.push(el('p', { class: 'uc-note' }, '連續幾輪冇人出局，今次隨機抽中。'));
        else if (e.random) kids.push(el('p', { class: 'uc-note' }, 'PK 再投都平票，隨機抽中。'));
        if (isMe(e.out) && !e.guess?.pending) kids.push(el('p', { class: 'uc-note' }, '你出局喇。可以繼續睇住，但唔使再講嘢或者投票。'));
      } else if (e.kind === 'pk') {
        kids.push(el('div', { class: 'uc-out' }, el('strong', {}, `平票！${namesOf(e.cands)} 同票`)));
        kids.push(el('p', { class: 'uc-note' }, v.flags.pkVoters === 'others'
          ? '佢哋要再講多一句，然後其他人只喺佢哋之間再投一次。'
          : '佢哋要再講多一句，然後全部人只喺佢哋之間再投一次。'));
      } else {
        kids.push(el('div', { class: 'uc-out' }, el('strong', {}, `${NO_OUT[e.reason] ?? '平票'}，今輪冇人出局`)));
        kids.push(el('p', { class: 'uc-note' }, '剩低嘅人繼續下一輪。'));
      }
      verdict.replaceChildren(...kids);
    }

    function sendGuess() {
      if (!input) return;
      submit.disabled = true;
      api.send({ type: 'guess', word: input.value });
    }

    function paintGuess(e, v) {
      const g = e.guess;
      if (!g) { guessMode = null; guessBox.replaceChildren(); guessBox.hidden = true; return; }
      guessBox.hidden = false;
      const mode = g.pending ? (v.me?.mustGuess ? 'write' : 'wait') : 'done';
      if (mode === 'write') {
        if (guessMode !== 'write') {
          guessMode = 'write';
          input = el('input', {
            class: 'uc-guess-input', type: 'text', maxlength: '20', autocomplete: 'off', autocapitalize: 'off',
            autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done', placeholder: '打出你覺得嘅平民詞語',
            'aria-label': '平民詞語',
          });
          submit = button('提交答案', sendGuess, 'btn btn-primary');
          input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); sendGuess(); } });
          const who = v.flags.guessWinner === 'blank' ? '你自己' : '臥底方';
          guessBox.replaceChildren(
            el('p', { class: 'uc-lead' }, `你係白板！你有一次機會估平民個詞，估中${who}即刻贏。`),
            input, submit,
            el('p', { class: 'uc-note' }, '要同個詞一樣先算（例如「士多啤梨」）。想放棄就留空再㩒。'));
        }
      } else if (mode === 'wait') {
        guessMode = 'wait';
        guessBox.replaceChildren(el('p', { class: 'uc-lead' }, `白板 ${nameOf(e.out)} 諗緊平民個詞…`));
      } else {
        guessMode = 'done';
        const silent = g.timeout || !g.word;
        guessBox.replaceChildren(
          el('p', { class: 'uc-lead' }, silent ? `白板 ${nameOf(e.out)} 冇作答，當估錯。` : `白板 ${nameOf(e.out)} 估「${g.word}」`),
          silent ? null : el('p', { class: `uc-guess-result ${g.correct ? 'is-right' : 'is-wrong'}` }, g.correct ? '估中喇！🎯' : '唔啱 ✗'));
      }
    }

    return {
      el: box,
      update(v, c) {
        const e = v.elim;
        title.textContent = e.voteKind === 'pk' ? 'PK 投票結果' : '投票結果';
        if (!panel) {
          panel = C.VotePanel({
            players: players(),
            candidates: Object.keys(e.counts),
            me: meId(),
            reveal: { counts: e.counts, top: e.top, votes: e.ballots },
          });
          panelSlot.append(panel.el);
        }
        paintVerdict(e, v);
        paintGuess(e, v);
        timer.update(v, c);
        waiting = !!e.guess?.pending;
        if (table) {
          const mates = (api.mySeats ?? []).filter((id) => !away(id));
          canContinue = mates.length > 0;
          mineSeen = canContinue && mates.every((id) => e.seen?.who.includes(id));
        } else {
          canContinue = !!v.me && !away(v.me.id);
          mineSeen = !!v.me && !!e.seen?.who.includes(v.me.id);
        }
        if (mineSeen) pending = false;
        paintProceed();
        paintSeen(v);
      },
      destroy() {
        clearTimeout(unlockTimer);
        clearTimeout(retry);
        timer.destroy();
        panel?.destroy();
      },
    };
  }

  // ---- over: everything is revealed ----
  function overScreen() {
    const box = el('section', { class: 'uc-screen uc-over' });
    let painted = false;
    return {
      el: box,
      update(v) {
        if (painted) return;
        painted = true;
        const o = v.over;
        const [bannerCls, bannerText] = BANNER[o.side] ?? BANNER.infiltrators;
        const rows = o.rows.map((r) => el('li', { class: `uc-row${r.alive ? '' : ' is-out'}${isMe(r.id) ? ' is-me' : ''}` },
          dot(r.id),
          el('span', { class: 'uc-row-name' }, nameOf(r.id)),
          roleChip(r.role),
          el('span', { class: 'uc-row-word' }, r.word ?? '（冇詞語）'),
          el('span', { class: 'uc-row-out' }, r.outRound ? `第 ${r.outRound} 輪出局` : '一直生還')));
        box.replaceChildren(
          el('h2', { class: `uc-banner ${bannerCls}` }, bannerText),
          el('p', { class: 'uc-lead' }, o.reason),
          el('div', { class: 'uc-words' },
            el('div', { class: 'uc-word-pill' }, el('small', {}, '平民詞語'), el('strong', {}, o.civ)),
            o.und ? el('div', { class: 'uc-word-pill' }, el('small', {}, '臥底詞語'), el('strong', {}, o.und)) : null),
          el('ul', { class: 'uc-rows' }, rows),
          el('p', { class: 'uc-note' }, '臥底同平民都唔知自己個詞係咪同大家唔同 — 呢個就係好玩嘅地方。'));
      },
      destroy() {},
    };
  }

  // ============================================================
  // routing
  // ============================================================

  function screenKey(v) {
    switch (v.phase) {
      case 'deal': return 'deal';
      case 'speak': return `speak:${v.round}:${v.speak.kind}`;
      case 'discuss': return `discuss:${v.round}`;
      case 'vote': return `vote:${v.round}:${v.vote.kind}:${v.history.length}`;
      case 'elim': return `elim:${v.elim.seq}`;
      default: return 'over';
    }
  }

  function build(v) {
    switch (v.phase) {
      case 'deal': return dealScreen();
      case 'speak': return speakScreen();
      case 'discuss': return discussScreen();
      case 'vote': return voteScreen();
      case 'elim': return elimScreen();
      default: return overScreen();
    }
  }

  function paintHeader(v) {
    const c = v.counts;
    counts.textContent = `今局：平民 ${c.civilians}${c.undercovers ? ` · 臥底 ${c.undercovers}` : ''}${c.blanks ? ` · 白板 ${c.blanks}` : ''}`;
    const outs = new Map(v.outs.map((o) => [o.pid, o.role]));
    const speaking = v.phase === 'speak' ? v.speak : null;
    seatsBox.replaceChildren(...v.seats.map((s) => {
      const p = byId(s.id);
      const cls = ['uc-seat'];
      if (!s.alive) cls.push('is-out');
      if (speaking?.pid === s.id) cls.push('is-turn');
      if (speaking?.spoke.includes(s.id)) cls.push('is-spoke');
      if (isMe(s.id)) cls.push('is-me');
      if (away(s.id)) cls.push('is-away');
      const role = !s.alive ? outs.get(s.id) : null;
      return el('span', { class: cls.join(' '), role: 'listitem', style: { '--seat': p?.color ?? ACCENT } },
        el('i', { class: 'uc-dot' }),
        el('span', {}, p?.name ?? '?'),
        role ? el('em', {}, ROLE[role].emoji) : null,
        away(s.id) ? el('em', { title: '唔喺度' }, '💤') : null);
    }));
  }

  /**
   * 睇返我個詞 once the deal is over. A phone with its own screen: a collapsible card.
   * A passed-around phone: the same card, but it re-locks after every peek and says whose it is,
   * because the seat on screen is whoever last held the phone.
   */
  let wordInner = null;
  let wordToggle = null;
  let wordHome = null;
  let askedOpened = false;

  /**
   * #22 (one-phone playtest): the shared phone in the middle never shows a seat's word. Its 「🃏 睇返我個詞」 asks who
   * wants it (api.askWho → the private hand-over card → that seat's screen with ctx.asked.key === 'word'), where the
   * card is open to peek and 「📱 睇完 · 擺返中間」 puts the phone back.
   */
  function askWord() {
    sfx('tap');
    api.askWho?.({ key: 'word', title: '邊個睇返個詞？', subtitle: '揀你自己個名，部手機會交俾你' });
  }

  function paintWordPanel(v) {
    const live = v.phase !== 'deal' && v.phase !== 'over';
    const tableAsk = atTable() && live && v.phase !== 'vote' && typeof api.askWho === 'function';
    const show = (!!v.me && live) || tableAsk;
    wordBox.hidden = !show;
    if (!show) { if (wordInner && wordBox.contains(card.el)) card.close(); return; }
    if (!wordInner) {
      wordToggle = el('button', { class: 'btn btn-ghost btn-sm uc-wordtoggle', type: 'button' });
      wordInner = el('div', { class: 'uc-wordinner' });
      wordHome = el('button', { class: 'btn btn-ghost btn-sm uc-wordhome', type: 'button' }, '📱 睇完 · 擺返中間');
      wordToggle.addEventListener('click', () => {
        if (atTable()) { askWord(); return; }
        sfx('tap');
        wordOpen = !wordOpen;
        if (wordOpen && sharedDevice()) { locked = true; paintCard(); }
        paintWordPanel(view);
      });
      wordHome.addEventListener('click', () => { sfx('tap'); card.close(); api.toTable?.(); });
      wordBox.replaceChildren(wordToggle, wordInner, wordHome);
    }
    if (atTable()) {
      wordToggle.hidden = false;
      wordToggle.textContent = '🃏 睇返我個詞';
      wordInner.hidden = true;
      wordHome.hidden = true;
      return;
    }
    // handed over for it (askWho): the card is ready to peek, and one tap puts the phone back in the middle
    const asked = sharedDevice() && ctx.asked?.key === 'word';
    if (asked && !askedOpened) { askedOpened = true; wordOpen = true; }
    wordToggle.hidden = asked;
    wordHome.hidden = !asked;
    wordToggle.textContent = wordOpen ? '🃏 收埋個詞' : '🃏 睇返我個詞';
    wordInner.hidden = !wordOpen;
    if (wordOpen) placeCard(wordInner); else card.close();
  }

  function render() {
    if (!view) return;
    const v = view;
    const key = screenKey(v);
    if (!screen || screen.key !== key) {
      const prev = screen;
      const next = build(v);
      next.key = key;
      card.close();                                   // never carry a face-up card into the next step
      prev?.destroy();
      screen = next;
      body.replaceChildren(next.el);
      if (prev?.key.startsWith('vote') && key.startsWith('elim')) sfx('reveal');   // the same sound whoever is out
      window.scrollTo?.(0, 0);
    }
    paintHeader(v);
    paintCard();
    screen.update(v, ctx);
    paintWordPanel(v);

    const step = v.phase === 'speak' ? v.speak.id : null;
    if (step && step !== lastSpeakStep && isMe(v.speak.pid)) sfx('join');           // your turn
    lastSpeakStep = step;
    if (v.relaxed && !relaxedShown) { relaxedShown = true; api.toast?.('所揀類別嘅詞已經冇晒，今局用咗其他類別'); }
  }

  return {
    update(nextView, nextCtx) {
      if (!nextView) return;
      view = nextView;
      ctx = nextCtx || {};
      render();
    },
    destroy() {
      screen?.destroy();
      screen = null;
      card.destroy();
      root.replaceChildren();
    },
  };
}
