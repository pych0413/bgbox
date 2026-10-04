// ============================================================
// screens/play.js — the in-game screen: top bar, host menu, banners, pass
// gates, night dim, and the mount point for the game's own UI.
//
// What this screen decides, from app.state only:
//  - which seat this phone is showing (state.activeSeat) and its view
//  - when to put a PassGate in front of the phone (focus names another seat
//    that lives on this device, or the player switched seats by hand)
//  - when to go dark and silent (that seat's view.night → logic.nightChrome: between its own steps in 語音 /
//    讀稿; in 靜音 (D1) the same readable dim on every phone all night, the awake seat included)
//  - host-only extras: pause / next / narration mode / auto-act for a stalled seat / 💤 mark a seat absent (D4)
//  - every risky host tap (⏭ 跳過呢步 while somebody would be cut off, 🗑️ 呢輪作廢, 🚪 離開) is the in-page
//    arm-then-confirm (sh.confirm, playtest #3/#13): never a native dialog on the phone that is the server
//  - 「輪到你」 only for a real turn (logic.turnBadge, #14); `view.recent` folds under the game UI (#10)
//  - one phone in the middle (DESIGN §7.1): on a shared phone (2+ seats) the phone either lies in the middle
//    (activeSeat null → the public table view, api.me null) or one seat holds it; which gate opens when
//    (private / public / table card / eyes-closed), walks clockwise from the holder, co-wakers on one combined
//    screen (U2), hand-picked seats that hold (#9), the host's 「X 唔喺度？」 escape (#18), whole-table taps
//    (api.tableSend, U5), askWho (U3), the clock hold at a gate (U10) and the night's noise bed (U8)
//
// The game UI is mounted once per (game, seat). Switching seat destroys it and
// mounts a fresh one, so api.me is always the seat being shown and no
// half-picked target can leak from one seat's screen to the next on a shared phone.
// ============================================================

import { el, toast, lockScroll, unlockScroll, sig } from '../dom.js?v=20261004224709';
import { sfx } from '../../core/sfx.js?v=20261004224709';
import { wantsNightAmbient } from '../../core/engine-kit.js?v=20261004224709';
import { components, NarratorBar, PassGate, RulesSheet, RecentFold, closeAllCovers } from '../components/index.js?v=20261004224709';
import { setClockHold } from '../components/Timer.js?v=20261004224709';
import { HintSheet } from '../hints.js?v=20261004224709';
import { textSize, setTextSize } from '../settings.js?v=20261004224709';
import {
  turnBadge, skipNeedsConfirm, SKIP_CONFIRM, nightChrome, focusSig, walkOrder, gateSubtitle, narrationChoices,
  openStepChip, tableConfirmText,
} from '../logic.js?v=20261004224709';

const NO_VOID = '呢個遊戲唔支援呢輪作廢';
const NO_SKIP = '跳唔到呢步 — 要等人自己做（⋯ 可以代佢做或者標記缺席）';
const noSkipFor = (name) => `跳唔到呢步 — 等緊 ${name}（⋯ 可以代佢做或者當佢缺席）`;

/** A failed action, in words a player understands (the core's own short Cantonese message wins). */
function sendFailedText(err) {
  const msg = String(err?.message ?? '');
  return /[一-鿿]/.test(msg) && msg.length <= 24 ? `⚠️ ${msg}` : '⚠️ 冇送到 — 重連緊，等陣再㩒';
}

/**
 * #20 (DESIGN §7.1): on a shared phone the whole table reads the screen, so the vote and seat pickers never print
 * 「（你）」 there — the same components with `youTag: false` forced on every render.
 */
const noYou = (Factory) => (props = {}) => {
  const c = Factory({ ...props, youTag: false });
  const update = c.update;
  c.update = (next = {}) => update.call(c, { ...next, youTag: false });
  return c;
};
const sharedComponents = Object.freeze({ ...components, VotePanel: noYou(components.VotePanel), PlayerPicker: noYou(components.PlayerPicker) });

const cssLoaded = new Set();

/** games/<id>/style.css, once, for games whose meta says css: true. */
function ensureGameCss(id) {
  if (cssLoaded.has(id)) return;
  cssLoaded.add(id);
  document.head.append(el('link', { rel: 'stylesheet', href: `js/games/${id}/style.css?v=20261004224709` }));
}

export function mountPlay(sh) {
  const { app, narrator } = sh;

  let ui = null;              // the game's { update, destroy }
  let uiKey = null;           // `${gameId}|${seat}` the current ui was mounted for
  let uiToken = 0;
  let gateToken = 0;
  // ---- one phone in the middle (DESIGN §7.1); all of it stays idle on a single-seat phone ----
  let gate = null;            // the gate on screen: { kind, target, key, hold } (kind: private · public · anon · decoy · switch · table)
  let lastSig;                // the focus signature last evaluated (undefined = not yet: the phone starts in the middle)
  let handedKey = null;       // `${sig}|${seat}` the phone was last handed over for (a gate tapped, a switch landed)
  let picked = null;          // { seat, sig }: chosen by hand (換人 / handTo / askWho) — holds while the signature stays (#9)
  let lastHolder = null;      // the last seat on screen BY DAY: walks go clockwise from here (#17)
  let heldInSecret = false;   // the seat on screen got the phone in a secret step (night / eyes closed): it is never
                              // a walk's start or a lastHolder — the first gate after a quiet day would name it (re-run N1/R1)
  let wasNight = false;       // the last evaluation was at night (night → day = dawn → the 天光 card)
  let tableCard = false;      // the public 擺返中間 / 天光 card is up: whole-table taps locked, focus gates wait (U5)
  let anonStep = null;        // the eyes-closed prompt whose gate was opened (one gate per step, real or decoy)
  let coWakers = [];          // U2: this phone's seats called together in this secret step (combined screen)
  let asked = null;           // U3: { key, pid } — the seat askWho put on screen
  let who = null;             // U3: the open askWho sheet { key, title, subtitle, open, resolve }
  let walk = null;            // { stepKey, set, total }: the named step this phone is walking round (#33 progress)
  const deferred = new Set(); // #18 「⏭ 跳過佢」: seats sent to the end of this walk
  let holding = false;        // U10: this screen asked the room to hold the clock
  let heldSeenAt = null;      // U10: when this screen first saw the room clock held (a core without clockHeldAt)
  let lastTap = null;         // { node, at }: the last button tapped on the play screen (tableSend's confirm arms it)
  let ambientOn = false;      // U8: the night's noise bed is on
  let menuEl = null;
  let menuKind = null;
  let menuHtml = '';          // what the open menu currently shows (see refreshMenu)
  let wasMyTurn = null;       // null until the first update: a turn already under way is history, not news
  let ackedCueId = null;      // the narration line the host last moved past with 下一步 (#13: 讀稿 needs no confirm for a fresh line)
  let bannerSig = null;       // what the banners were last built from (a button is never swapped out from under a finger)
  const dismissedStalled = new Set();

  // ---------- skeleton ----------
  const emojiEl = el('span', { class: 'play-emoji' });
  const titleEl = el('b');
  const subEl = el('small');
  // Top bar: 💡 (on demand only) · 📖 · host: ⏱️ ⏸ · others: 🔊 · ⋯
  const hintBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': '提示：而家要做咩', onclick: () => openHints() }, '💡');
  const rulesBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': '規則', onclick: () => openRules() }, '📖');
  const pauseBtn = el('button', { class: 'icon-btn pause-btn', type: 'button', 'aria-label': '暫停', onclick: () => togglePause() }, '⏸');
  const soundBtn = sh.soundButton();
  const menuBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': '選項', onclick: () => openMenu('main') }, '⋯');
  const top = el('header', { class: 'play-top' },
    el('div', { class: 'play-title' }, emojiEl, el('div', { class: 'play-name' }, titleEl, subEl)),
    el('div', { class: 'play-tools' }, hintBtn, rulesBtn, sh.timer.button(), pauseBtn, soundBtn, menuBtn));

  const seatChip = el('button', { class: 'seat-chip', type: 'button', onclick: () => openMenu('seats') });
  // §7.1: a hand-picked seat puts the shared phone back in the middle with one tap
  const homeBtn = el('button', { class: 'btn btn-ghost btn-sm seat-home', type: 'button', onclick: () => toTable() }, '📱 擺返中間');
  homeBtn.hidden = true;
  const seatRow = el('div', { class: 'seat-row' }, seatChip, homeBtn);
  const timerStrip = sh.timer.strip();
  const banners = el('div');
  const gameRoot = el('div', { class: 'play-game' });
  // #10: the game's public 「📜 之前嘅投票」 / 「🌅 昨晚」 (view.recent), folded under its UI
  const recent = RecentFold({});
  const narratorBar = NarratorBar({ hidden: true });
  const hints = HintSheet(sh, { onRules: () => openRules() });

  const root = el('section', { class: 'screen play', 'data-screen': 'play' },
    top, seatRow, timerStrip, banners, gameRoot, recent.el, narratorBar.el);
  // the button a whole-table tap came from, so tableSend's confirm can arm it (re-run #2)
  root.addEventListener('click', (e) => {
    const node = e.target?.closest?.('button, [role="button"]') ?? null;
    lastTap = node ? { node, at: app.clock.now() } : null;
  }, true);

  // ---------- derived state ----------
  /** This phone's playing seats, in seat order. */
  const playingSeats = (st) => (st.room?.players ?? []).filter((p) => !p.spectator && st.mySeats?.includes(p.id)).map((p) => p.id);
  /** §7.1 a shared phone: 2+ playing seats. Everything one-phone keys off this; a single-seat phone never changes. */
  const isShared = (st) => playingSeats(st).length > 1;
  /** …that holds every seated player (room.singleDevice). */
  const isWholeTable = (st) => isShared(st) && !!st.room?.singleDevice;
  /** The seat on screen; null on a shared phone lying in the middle. */
  const currentSeat = (st) => {
    if (st.activeSeat && st.mySeats?.includes(st.activeSeat)) return st.activeSeat;
    return isShared(st) ? null : (st.mySeats?.[0] ?? null);
  };
  /** Night on a shared phone: any of its seats' views, or the table view, says so. */
  const nightNow = (st) => !!st.table?.night || Object.values(st.views ?? {}).some((v) => !!v?.night);
  /** A step nobody may be named in (an eyes-closed step, or the whole night on a shared phone). */
  const secretNow = (st) => !!st.focus?.anonymous || (isShared(st) && nightNow(st));
  /** The seat this phone ACTS as, or null when it only watches (no seat, or a spectator seat). */
  const playsAs = (st) => {
    const seat = currentSeat(st);
    return seat && !st.room.players.find((p) => p.id === seat)?.spectator ? seat : null;
  };
  const viewFor = (st) => {
    const seat = playsAs(st);
    return seat ? (st.views?.[seat] ?? null) : (st.table ?? null);
  };
  const nameOf = (st, pid) => st.room.players.find((p) => p.id === pid)?.name ?? '?';
  const keyFor = (st) => `${st.room?.gameId}|${playsAs(st) ?? 'table'}`;
  const ctxFor = (st) => {
    const shared = isShared(st);
    const seat = playsAs(st);
    // U2: the combined night screen — only while the mounted seat is one of them
    const co = shared && seat && coWakers.length > 1 && coWakers.includes(seat) ? coWakers.slice() : [];
    return {
      focus: st.focus ?? null,
      paused: !!st.room.paused,
      narrationMode: st.room.narration?.mode ?? 'voice',
      ink: st.ink ?? { epoch: 0, strokes: [] },
      // §7.1 one phone
      shared,
      wholeTable: isWholeTable(st),
      atTable: shared && !seat,
      tableLocked: tableCard,
      coWakers: co,
      views: Object.fromEntries(co.map((pid) => [pid, st.views?.[pid] ?? null])),
      asked: asked && seat && asked.pid === seat ? { ...asked } : null,
      clockHeld: !!st.room.clockHeld,
      clockHeldAt: heldAtOf(st),
    };
  };

  /**
   * U10: the host time the held game clock stands at (room view `clockHeldAt`), or null while it runs. Every
   * `Timer` freezes there by itself (setClockHold); a game's own countdown uses `api.clockNow()`.
   */
  function heldAtOf(st) {
    if (!st.room?.clockHeld) { heldSeenAt = null; return null; }
    if (Number.isFinite(st.room.clockHeldAt)) return st.room.clockHeldAt;
    return heldSeenAt ?? (heldSeenAt = app.clock.now());
  }

  /** A public one-person step (`focus.open`) for the seat on screen of a shared phone: it still lies face up in the middle. */
  const openStepNow = (st) => {
    const seat = playsAs(st);
    return isShared(st) && !!seat && !secretNow(st) && st.focus?.open === true && !!st.focus.pids?.includes(seat);
  };
  /** The seat on screen may ink now (engine.canInk via the core; view.canDraw / view.draw.canDraw for a core without it). */
  const inkingNow = (st, view) => {
    const seat = playsAs(st);
    return !!seat && !!(st.canInk?.includes(seat) || view?.canDraw || view?.draw?.canDraw);
  };

  /** 💡 on a shared phone in the middle, or on a public (`open`) step for the seat on screen: never a role cover. */
  function hintOpts(st) {
    const seat = playsAs(st);
    const pub = isShared(st) && (!seat || (st.focus?.open === true && !!st.focus.pids?.includes(seat)));
    return { hideOwn: pub };
  }

  // ---------- 💡 hints (never opened by the app itself) ----------
  async function openHints() {
    const id = app.state.room?.gameId;
    if (!id) return;
    let game;
    try { game = sh.cached(id) ?? await sh.loadGame(id); } catch (err) { console.error(err); toast('載入唔到提示'); return; }
    hints.open(game, viewFor(app.state), hintOpts(app.state));
  }

  /** engine.canVoid through the core: { ok, message } | null (the game does not say). */
  function voidCheck() {
    try { return app.hostCtl?.canVoid?.() ?? null; } catch (err) { console.error(err); return null; }
  }

  /**
   * 🗑️ 呢輪作廢 — `@void-round` for a round a dead phone (or a mix-up) spoilt. Engines opt in.
   * Two taps on `node` (sh.confirm, #3: never a native dialog on the room's server). Returns false while it
   * is only armed, true once it is done with (acted, or refused with a toast). A game that says why not
   * (engine.canVoid → 「呢輪已經計咗分…」) is heard at once, without arming.
   */
  function voidRound(node = null, onDisarm = null) {
    const st = app.state;
    if (!st.isHost) return true;
    if (st.room.paused) { toast('暫停緊 — 先㩒「繼續」', 2200); return true; }
    const can = voidCheck();
    if (can?.ok === false) { toast(can.message || NO_VOID, 2600); return true; }
    if (!sh.confirm('呢輪作廢、重新嚟過？\n（有人部手機死咗、或者搞錯咗先用）', node, { key: 'void-round', onDisarm })) return false;
    let ok = false;
    try { ok = app.hostCtl?.voidRound?.() === true; } catch (err) { console.error(err); }
    // (no narrator.cancel() here: the app already stopped the old line and may be saying the new one)
    toast(ok ? '🗑️ 呢輪作廢咗，重新嚟過' : (voidCheck()?.message || NO_VOID), 2600);
    return true;
  }

  // ---------- 💤 absent seats (D4) ----------
  /**
   * 💤 當佢缺席 — `@absent`: the table stops waiting on this seat for the rest of the game. Two taps on `node`
   * (sh.confirm). Returns false while it is only armed. A game that cannot do it changes nothing, and says so.
   */
  function markAbsent(pid, node = null, onDisarm = null) {
    const st = app.state;
    if (!st.isHost) return true;
    if (st.room.paused) { toast('暫停緊 — 先㩒「繼續」', 2200); return true; }
    const who = nameOf(st, pid);
    if (!sh.confirm(`當 ${who} 缺席？\n呢局唔再等佢`, node, { key: `absent:${pid}`, onDisarm })) return false;
    let ok = false;
    try { ok = app.hostCtl?.markAbsent?.(pid) === true; } catch (err) { console.error(err); }
    toast(ok ? `💤 ${who} 缺席 — 呢局唔再等佢` : `而家標記唔到 ${who} 缺席 — 可以代佢做或者呢鋪唔計`, 2600);
    return true;
  }

  /** 👋 the absent seat is back (`@present`, optional for engines). One tap: it only undoes 💤. */
  function markPresent(pid) {
    const st = app.state;
    if (!st.isHost) return;
    if (st.room.paused) { toast('暫停緊 — 先㩒「繼續」', 2200); return; }
    let ok = false;
    try { ok = app.hostCtl?.markPresent?.(pid) === true; } catch (err) { console.error(err); }
    toast(ok ? `👋 ${nameOf(st, pid)} 返咗嚟` : `${nameOf(st, pid)} 要等下一局先入得返`, 2600);
  }

  // ---------- ⏭ skip (#13) ----------
  /** Would skipping now cut somebody off (an open vote, a night window)? Then it takes two taps. */
  function skipNeedsTwo(st) {
    return skipNeedsConfirm({
      waiting: !!st.waiting,
      focus: st.focus,
      night: !!viewFor(st)?.night,
      mode: st.room?.narration?.mode ?? 'voice',
      cueId: st.cue?.id ?? null,
      ackedCueId,
    });
  }

  function doSkip() {
    ackedCueId = app.state.cue?.id ?? null;
    narrator.cancel();
    let moved = true;
    try { moved = app.hostCtl.next() !== false; } catch (err) { console.error(err); }
    // #9: a step only a seat can finish (9upper's 揀人) does not move — say so instead of doing nothing, and name
    // the seat when the room already knows whom the table waits on
    const st = app.state;
    if (!moved && st.isHost && !st.room?.paused) {
      const waitedOn = [...(st.room?.stalled ?? []), ...(st.room?.idle ?? [])];
      toast(waitedOn.length === 1 ? noSkipFor(nameOf(st, waitedOn[0].pid)) : NO_SKIP, 3200);
    }
  }

  /** ⋯ → ⏭ 跳過呢步. Returns false while it is only armed. */
  function skipFromMenu(node) {
    if (skipNeedsTwo(app.state) && !sh.confirm(SKIP_CONFIRM, node, { key: 'skip-step', onDisarm: refreshSoon })) return false;
    doSkip();
    return true;
  }

  function togglePause() {
    const st = app.state;
    if (!st.isHost) return;
    if (st.room.paused) app.hostCtl.resume();
    else { narrator.cancel(); app.hostCtl.pause(); }
  }

  // ---------- rules ----------
  async function openRules() {
    const id = app.state.room?.gameId;
    if (!id) return;
    try { RulesSheet.open(sh.cached(id) ?? await sh.loadGame(id)); }
    catch (err) { console.error(err); toast('載入唔到規則'); }
  }

  // ---------- game UI ----------
  /** app.act for one of this phone's seats, saying so when it never got through (G4). */
  function sendFor(pid, action) {
    const res = app.act(pid, action);
    // G4: the core's act() resolves once the host has taken it and rejects when it did not
    // get through. Never pretend: say so (a game UI may still await the same promise).
    if (res && typeof res.then === 'function') {
      res.then(null, (err) => { if (app.state.mode) toast(sendFailedText(err), 2600); });
    } else if (res === false && app.state.mode === 'client' && app.state.conn !== 'online') {
      toast('⚠️ 冇送到 — 重連緊，等陣再㩒', 2600);
    }
    return res;
  }

  /**
   * §7.1 #5 — one tap for the whole table: `{ ...action, seats: [every playing seat here], table: true }`, sent as
   * this phone's first present seat. Locked while the table card is up (U5); nothing on a single-seat phone.
   * `opts.confirm` (re-run #2, U5): a tap that ENDS a discussion or STARTS a vote takes a second tap on a whole-table
   * phone — the first arms the button (`opts.node`, else the button just tapped) to read 「再㩒一次：<confirm>」 and
   * sends nothing (false); the same button again within ~3 s sends. A phone that holds only part of the table sends
   * at once (the other phones still have their say).
   */
  function tableSend(action, { confirm = '', node = null } = {}) {
    const st = app.state;
    const seats = playingSeats(st);
    if (seats.length < 2 || !action || typeof action !== 'object') return false;
    if (tableCard) { toast('先㩒「大家睇緊」張卡', 1800); return false; }
    const ask = tableConfirmText(confirm);
    if (ask && isWholeTable(st)) {
      const btn = node ?? (lastTap && app.clock.now() - lastTap.at < 1000 ? lastTap.node : null);
      if (!sh.confirm(ask, btn, { key: `table:${action.type ?? ''}` })) return false;
    }
    const away = new Set(st.room?.absent ?? []);
    const from = seats.find((pid) => !away.has(pid)) ?? seats[0];
    return sendFor(from, { ...action, seats, table: true });
  }

  function makeApi(game, seat) {
    return {
      me: seat,
      meta: game.meta,
      get players() { return app.state.room?.players ?? []; },
      get isHost() { return !!app.state.isHost; },
      get config() { return app.state.room?.config ?? {}; },
      send(action) {
        if (!seat) {
          toast(isShared(app.state) ? '📱 部手機喺枱中間 — 先㩒上面揀你個名' : '旁觀緊，做唔到嘢');
          return;
        }
        return sendFor(seat, action);
      },
      // ---- one phone (DESIGN §7.1) ----
      get shared() { return isShared(app.state); },
      get wholeTable() { return isWholeTable(app.state); },
      atTable: !seat && isShared(app.state),
      get mySeats() { return playingSeats(app.state); },
      handTo: (pid, opts) => handTo(pid, opts),
      toTable: (opts) => toTable(opts),
      tableSend: (action, opts) => tableSend(action, opts),
      /** U2: act as one of the co-wakers on this combined screen (or as the seat on screen). */
      sendAs(pid, action) {
        if (!seat || (pid !== seat && !(coWakers.includes(seat) && coWakers.includes(pid)))) return false;
        return sendFor(pid, action);
      },
      askWho: (opts) => askWho(opts),
      // #3: arm-then-confirm, never window.confirm (it freezes the host phone, which is the room's server)
      confirm: (text, node = null, opts = {}) => sh.confirm(text, node, opts),
      ink(payload) { if (seat) return app.ink(seat, payload); },
      now: () => app.clock.now(),
      /** U10: the game clock — api.now(), except while the room holds it at a gate: then the time it stands at. */
      clockNow: () => heldAtOf(app.state) ?? app.clock.now(),
      sfx,
      toast,
      components: isShared(app.state) ? sharedComponents : components,
    };
  }

  function gameFailed(err, what = '呢隻遊戲') {
    console.error(`[play] ${what} failed`, err);
    ui = null;
    gameRoot.replaceChildren(el('div', { class: 'card' },
      el('p', { text: `${what}出咗事，載入唔到。` }),
      el('p', { class: 'hint', text: String(err?.message ?? err) }),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => location.reload() }, '重新載入')));
  }

  async function mountUI(st, key, seat) {
    const token = ++uiToken;
    const gameId = st.room.gameId;
    hints.close();
    closeAllCovers();
    ui?.destroy?.();
    ui = null;
    gameRoot.replaceChildren(el('div', { class: 'play-loading', text: '載入緊遊戲…' }));

    let game;
    try { game = await sh.loadGame(gameId); } catch (err) { if (token === uiToken) gameFailed(err); return; }
    if (token !== uiToken) return;                     // seat or game changed while loading
    if (typeof game?.ui?.mount !== 'function') { gameFailed(new Error('呢隻遊戲仲未有介面'), '介面'); return; }

    if (game.meta?.css) ensureGameCss(gameId);
    gameRoot.replaceChildren();
    try { ui = game.ui.mount(gameRoot, makeApi(game, seat)); } catch (err) { gameFailed(err, '遊戲介面'); return; }
    pushUpdate();
  }

  function pushUpdate() {
    if (!ui) return;
    const st = app.state;
    if (keyFor(st) !== uiKey) return;           // the phone changed hands: this UI is about to go (never feed it another seat's view)
    const view = viewFor(st);
    if (!view) return;
    try { ui.update(view, ctxFor(st)); } catch (err) { console.error('[play] ui.update failed', err); }
  }

  // ---------- pass gates and the phone in the middle (DESIGN §7.1) ----------
  const scrollTop = () => { try { if (typeof window !== 'undefined') window.scrollTo?.(0, 0); } catch { /* not a browser */ } };

  /** The public card's words: 「輪到 小美 · 畫一筆」 · 「大家一齊睇 · 小美 㩒一下開始」. */
  const publicText = (name, label) => ({
    title: `輪到 ${name}${label ? ` · ${label}` : ''}`,
    subtitle: `大家一齊睇 · ${name} 㩒一下開始`,
    button: `▶ ${name} 開始`,
  });

  /**
   * Remember the seat leaving the screen as the walks' start (#17) — never one that got the phone in a secret step
   * (re-run N1/R1: after a quiet day the first gate would name the last night holder).
   */
  function noteHolder(seat) { if (seat && !heldInSecret) lastHolder = seat; }

  /** The phone goes to the middle (no seat on screen). */
  function putDown() { app.setActiveSeat(null); heldInSecret = false; }

  /** Where a walk starts from right now: the seat on screen, unless it got the phone in a secret step. */
  const walkFrom = (st) => (heldInSecret ? null : currentSeat(st));

  /** Seats a NAMED focus calls on this phone, in the order the phone goes round (#17, #18). */
  function walkHere(st, holder) {
    const f = st.focus;
    if (!f || f.anonymous) return [];
    const mine = playingSeats(st);
    const called = (f.pids ?? []).filter((pid) => mine.includes(pid));
    const order = (st.room?.players ?? []).filter((p) => !p.spectator).map((p) => p.id);
    return walkOrder(called, order, { from: holder ?? lastHolder, ordered: f.ordered === true, deferred: [...deferred] });
  }

  /** The walk this phone is in (progress for the gate subtitle, #33): a smaller set of the same step is the same walk. */
  function trackWalk(f, here) {
    const stepKey = `${f.step ?? ''}|${f.open ? 1 : 0}`;
    if (walk && walk.stepKey === stepKey && here.every((pid) => walk.set.has(pid))) return;
    walk = { stepKey, set: new Set(here), total: here.length };
    deferred.clear();
  }

  /** The phone lands on `pid` after its gate was tapped. */
  function land(pid, { key = null, pick = false, ask = null } = {}) {
    app.setActiveSeat(pid);
    heldInSecret = secretNow(app.state);
    if (!heldInSecret) lastHolder = pid;
    handedKey = key ?? `${lastSig ?? ''}|${pid}`;
    picked = pick ? { seat: pid, sig: lastSig ?? '' } : null;
    asked = ask;
    scrollTop();            // #26: the new holder starts at the top of the page
  }

  /**
   * Put a gate in front of the phone. kind: 'private' (focus, 「其他人唔好望」) · 'public' (focus.open: light card) ·
   * 'anon' / 'decoy' (an eyes-closed step: one card, real or not) · 'switch' (a seat chosen by hand / askWho).
   * The phone goes to the middle first: behind every gate lies the public table view, so a gate that is taken
   * away unanswered leaves nothing private on screen.
   */
  async function openGate(kind, target, text, { key = null, pick = false, ask = null, hold = false, escape = false, onLand = null, onCancel = null } = {}) {
    const token = ++gateToken;
    const st = app.state;
    gate = { kind, target, key, hold: !!hold, sig: lastSig ?? '', manual: !!pick };   // manual: chosen by hand, not by focus
    tableCard = false;
    hints.close();          // the phone is changing hands: the 💡 sheet belonged to the last holder
    closeAllCovers();
    const holder = currentSeat(st);
    if (holder !== null && isShared(st)) { noteHolder(holder); putDown(); }
    const extra = escape && st.isHost && target ? escapeRow(target) : null;
    const shown = PassGate.show({ ...text, kind: kind === 'decoy' ? 'anon' : kind, extra });
    syncHold();
    await shown;
    if (token !== gateToken) { onCancel?.(); return; }  // replaced or cancelled meanwhile
    gate = null;
    syncHold();
    const now = app.state;
    if (kind === 'anon' || kind === 'decoy') {
      // the decoy changes nothing; a real eyes-closed gate hands the phone to whoever of this phone is still called
      if (!now.focus?.anonymous || now.focus.anonymous !== anonStep) return;
      const t = coWakers.find((pid) => now.focus.pids?.includes(pid));
      if (t) land(t, { key });
      pushUpdate();
      return;
    }
    if (!target) return;
    if ((kind === 'private' || kind === 'public') && key && currentKey(now) !== key) { evaluateFocusGate(now); return; }
    land(target, { key, pick, ask });
    onLand?.();
  }

  /** `${sig}|${first seat of the walk}` for the state as it is now (is a focus gate still wanted?). */
  function currentKey(st) {
    const here = walkHere(st, walkFrom(st));
    return here.length ? `${focusSig(st.focus)}|${here[0]}` : null;
  }

  /** Take a focus gate away (the step it was for has gone). Hand-picked gates and the table card stay. */
  function closeAutoGate() {
    if (gate && !gate.manual && ['private', 'public', 'anon', 'decoy'].includes(gate.kind) && PassGate.isOpen()) {
      gateToken++;
      gate = null;
      PassGate.hide();
      syncHold();
    }
  }

  /**
   * §7.1 the phone goes to the middle: kind 'card' (📱 擺返中間), 'dawn' (☀️ 天光喇) — the public table card, which
   * locks whole-table taps until it is tapped once (U4, U5) — or 'silent' (night, the game's start).
   */
  function goTable(kind) {
    const st = app.state;
    const holder = currentSeat(st);
    noteHolder(holder);
    picked = null;
    asked = null;
    if (holder !== null) {
      hints.close();
      closeAllCovers();
      putDown();
    }
    // dawn: the day's first walk starts from seat order, never from whoever held the phone at night (re-run N1/R1)
    if (kind === 'dawn') lastHolder = null;
    if (kind !== 'silent') openTableCard(kind);
  }

  async function openTableCard(kind) {
    const token = ++gateToken;
    gate = { kind: 'table', target: null, key: null, hold: false };
    tableCard = true;
    const shown = PassGate.show(kind === 'dawn'
      ? { kind: 'table', icon: '☀️', title: '天光喇', subtitle: '部手機擺返枱中間 · 大家一齊睇', button: '👀 大家睇緊 · 㩒一下' }
      : { kind: 'table', icon: '📱', title: '部手機擺返中間', subtitle: '擺喺枱中間 · 大家一齊睇', button: '👀 大家睇緊 · 㩒一下' });
    syncHold();
    pushUpdate();           // ctx.tableLocked
    await shown;
    if (token !== gateToken) return;
    gate = null;
    tableCard = false;
    scrollTop();
    evaluateFocusGate(app.state);   // a step that waited behind the card gets its gate now
    syncHold();
    pushUpdate();
  }

  /** U10: hold the room clock while a `hold: true` step's gate (or the table card before it) is unanswered. */
  function syncHold() {
    const st = app.state;
    const want = !!(st.isHost && st.room?.phase === 'playing' && isWholeTable(st) && !nightNow(st) && st.focus?.hold
      && PassGate.isOpen() && (gate?.hold || tableCard));
    if (want === holding) return;
    let ok = false;
    try { ok = app.hostCtl?.holdClock?.(want) === true; } catch (err) { console.error(err); }
    if (ok || !want) holding = want;
  }

  /** #18: the host's quiet 「X 唔喺度？」 under a named gate — skip them in this walk, 💤, or 代佢做 (never switching seat). */
  function escapeRow(target) {
    const st = app.state;
    const name = nameOf(st, target);
    const next = walkHere(st, null).find((pid) => pid !== target) ?? null;
    const acts = el('div', { class: 'c-passgate-escape-acts' });
    acts.hidden = true;
    const row = el('div', { class: 'c-passgate-escape' },
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { acts.hidden = !acts.hidden; } }, `${name} 唔喺度？`),
      acts);
    if (next) {
      acts.append(el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => { deferred.add(target); evaluateFocusGate(app.state); },
      }, `⏭ 跳過佢（交俾 ${nameOf(st, next)}）`));
    }
    acts.append(
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: (e) => markAbsent(target, e.currentTarget) }, '💤 當佢缺席'),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: (e) => {
          if (!sh.confirm(`代 ${name} 做？`, e.currentTarget, { key: `auto:${target}` })) return;
          let ok = false;
          try { ok = app.hostCtl?.autoAct?.(target) !== false; } catch (err) { console.error(err); }
          if (!ok) toast('而家做唔到', 1800);
        },
      }, '🤖 代佢做'));
    return row;
  }

  /** Forget everything one-phone (a single-seat phone, or the game is not on). */
  function resetShared() {
    lastSig = undefined;
    lastHolder = null;
    heldInSecret = false;
    handedKey = null;
    picked = null;
    asked = null;
    anonStep = null;
    coWakers = [];
    walk = null;
    deferred.clear();
    wasNight = false;
    closeAutoGate();
    if (tableCard && PassGate.isOpen()) { gateToken++; PassGate.hide(); }
    tableCard = false;
    if (gate?.kind === 'table') gate = null;
    syncHold();
  }

  /**
   * Who holds a shared phone, re-decided on every state change (§7.1):
   *  - the game's first look: the phone starts in the middle;
   *  - dawn (night → day): to the middle behind the 天光 card, whoever held it;
   *  - an eyes-closed step: to the middle, ONE gate per step (decoy or real), co-wakers on one screen (U2);
   *  - a named step that calls seats here: the private gate — also for the seat already on screen when the step
   *    changed (#2) — or the public card for `open` steps (#4), clockwise from the holder (#17);
   *  - a step that calls nobody here: by day, if the focus moved on, to the middle behind the table card (U4); at
   *    night, silently under the dim. A hand-picked seat holds while the focus signature stays the same (#9).
   */
  function evaluateFocusGate(st) {
    if (!isShared(st) || st.room?.phase !== 'playing') { resetShared(); return; }
    const f = st.focus ?? null;
    const anon = f?.anonymous ? String(f.anonymous) : '';
    const night = nightNow(st);
    const sig = focusSig(f);
    const first = lastSig === undefined;
    const changed = !first && sig !== lastSig;
    lastSig = sig;
    let holder = currentSeat(st);
    // the game's first look: the phone starts in the middle, and the deal walks from seat order
    if (first && holder !== null) { putDown(); holder = null; }
    if (first) lastHolder = null;

    // dawn (U4): the night is over — the phone goes to the middle behind the public 天光 card
    const dawn = wasNight && !night && !anon;
    wasNight = night;
    if (!dawn && !secretNow(st)) noteHolder(holder);
    if (dawn) {
      anonStep = null;
      coWakers = [];
      closeAutoGate();
      goTable('dawn');
      return;
    }
    if (tableCard && !anon) { syncHold(); return; }      // focus gates wait for the table card (U5)
    // a seat picked by hand (換人 / handTo / askWho) is on its way: its gate stays while the step is the same (#9)
    if (gate?.manual && PassGate.isOpen() && gate.sig === sig && !anon) { syncHold(); return; }

    if (anon) { anonGate(st, f, anon, holder); syncHold(); return; }
    const afterAnon = anonStep !== null;   // an eyes-closed step just ended (real gate or decoy alike)
    anonStep = null;
    if (coWakers.length) coWakers = [];

    const here = walkHere(st, heldInSecret ? null : holder);
    if (!here.length) {
      walk = null;
      deferred.clear();
      closeAutoGate();
      // by day only when the focus moved on (a hand-picked seat keeps the phone while it does not, #9). After an
      // eyes-closed step every shared phone gets the same card — also a decoy phone, or one whose waker was
      // already done — so the card never tells the table whether the called role sat here (§7 anti-tell)
      if ((holder !== null || afterAnon) && (night || changed)) goTable(night ? 'silent' : 'card');
      syncHold();
      return;
    }

    trackWalk(f, here);
    const target = here[0];
    const key = `${sig}|${target}`;
    if (picked && picked.seat === holder && picked.sig === sig) { syncHold(); return; }   // #9: chosen by hand
    if (gate && gate.key === key && PassGate.isOpen()) { syncHold(); return; }           // already asking
    if (holder === target && handedKey === key) { syncHold(); return; }                  // already handed over
    const name = nameOf(st, target);
    if (night) {
      // a named step at night (engines should call night steps `anonymous`): still never a name on the card (#9)
      openGate('private', target, { title: f.label || '叫到嘅人請拎起部手機', subtitle: '其他人閉埋眼，唔好望' }, { key });
    } else if (f.open === true) {
      openGate('public', target, publicText(name, f.label), { key, hold: f.hold === true, escape: true });
    } else {
      openGate('private', target, {
        title: `交俾 ${name}`,
        subtitle: gateSubtitle({ label: f.label, done: walk.total - here.length, total: walk.total }),
      }, { key, hold: f.hold === true, escape: true });
    }
  }

  /** An eyes-closed step on a shared phone (§7, U2). */
  function anonGate(st, f, anon, holder) {
    const mine = playingSeats(st);
    const here = (f.pids ?? []).filter((pid) => mine.includes(pid));   // the engine's order: the first is mounted
    walk = null;
    deferred.clear();
    picked = null;
    const text = { title: anon, subtitle: '其他人閉埋眼，唔好望' };
    if (anonStep !== anon) {
      // a new step: to the middle, then ONE gate — the same whether a seat here is called or not
      anonStep = anon;
      coWakers = here.slice();
      openGate(here.length ? 'anon' : 'decoy', here[0] ?? null, text, { key: `anon|${anon}` });
      return;
    }
    const gateUp = !!gate && PassGate.isOpen() && (gate.kind === 'anon' || gate.kind === 'decoy');
    // the same step: rarely the engine calls one more of this phone's seats…
    if (here.some((pid) => !coWakers.includes(pid))) {
      coWakers = here.slice();
      if (!gateUp && !here.includes(holder)) openGate('anon', here[0], text, { key: `anon|${anon}` });
      else pushUpdate();
      return;
    }
    // …more often it drops one that is done: the others stay awake on the same screen, no new gate
    const left = coWakers.filter((pid) => here.includes(pid));
    if (left.length !== coWakers.length) coWakers = left;
    if (gateUp) return;
    if (holder !== null && !here.includes(holder)) {
      if (left.length) { app.setActiveSeat(left[0]); heldInSecret = true; }   // a co-waker: never a walk's start
      else putDown();       // nobody here is called any more: back to the middle, under the dim
    }
    pushUpdate();
  }

  /** 換人: hand the phone to one of this phone's seats by hand (it then holds, #9). Never at night or in a secret step. */
  function switchSeat(pid) {
    const st = app.state;
    closeMenu();
    if (secretNow(st) || pid === currentSeat(st)) return;
    openGate('switch', pid, { title: `交俾 ${nameOf(st, pid)}`, subtitle: '其他人唔好望' }, { pick: true });
  }

  /** api.handTo — a game hands the phone to one of this phone's seats (custom 「✓ 搞掂 · 交俾 阿明」). */
  function handTo(pid, { open = false, why = '' } = {}) {
    const st = app.state;
    if (!isShared(st) || !playingSeats(st).includes(pid) || secretNow(st)) return false;
    const name = nameOf(st, pid);
    openGate(open ? 'public' : 'switch', pid, open
      ? publicText(name, '')
      : { title: `交俾 ${name}`, subtitle: why ? `其他人唔好望 · ${why}` : '其他人唔好望' }, { pick: true });
    return true;
  }

  /** api.toTable / 📱 擺返中間 — back to the middle (behind the table card unless `card: false`, or at night). */
  function toTable({ card = true } = {}) {
    const st = app.state;
    if (!isShared(st)) return false;
    closeMenu();
    goTable(card && !secretNow(st) ? 'card' : 'silent');
    return true;
  }

  /**
   * api.askWho (U3) — anyone taps a table control, then picks their own name: a public name list → the private gate
   * (public card with `open`) → that seat's screen with ctx.asked = { key, pid }. Resolves the pid, or null.
   */
  function askWho({ key = '', title = '邊個？', subtitle = '', open = false } = {}) {
    const st = app.state;
    if (!isShared(st) || secretNow(st)) return Promise.resolve(null);
    if (who) { const old = who; who = null; old.resolve(null); }
    closeMenu();            // before the new request exists: closing an open sheet must not answer the NEW one with null
    return new Promise((resolve) => {
      who = { key: String(key), title: String(title || '邊個？'), subtitle: String(subtitle || ''), open: !!open, resolve };
      openMenu('who');
    });
  }

  function pickWho(pid) {
    const req = who;
    who = null;
    closeMenu();
    if (!req) return;
    const st = app.state;
    const name = nameOf(st, pid);
    openGate(req.open ? 'public' : 'switch', pid, req.open ? publicText(name, '') : { title: `交俾 ${name}`, subtitle: '其他人唔好望' }, {
      pick: true, ask: { key: req.key, pid }, onLand: () => req.resolve(pid), onCancel: () => req.resolve(null),
    });
  }

  // ---------- menus (host options / seat switcher) ----------
  function openMenu(kind) {
    closeMenu();
    menuKind = kind;
    menuHtml = '';
    const panel = el('div', { class: 'panel' });
    menuEl = el('div', { class: 'menu-sheet' }, panel);
    menuEl.addEventListener('pointerdown', (e) => { if (e.target === menuEl) closeMenu(); });
    document.body.append(menuEl);
    lockScroll();
    requestAnimationFrame(() => menuEl?.classList.add('in'));
    refreshMenu();
  }

  function closeMenu() {
    if (!menuEl) return;
    if (menuKind === 'who' && who) { const req = who; who = null; req.resolve(null); }   // U3: closed unanswered
    const node = menuEl;
    menuEl = null;
    menuKind = null;
    unlockScroll();
    node.classList.remove('in');
    setTimeout(() => node.remove(), 160);
  }

  const menuBtnRow = (label, onclick, cls = '') => el('button', { class: `btn btn-ghost ${cls}`.trim(), type: 'button', onclick }, label);
  const refreshSoon = () => queueMicrotask(() => refreshMenu());

  function refreshMenu() {
    if (!menuEl) return;
    const st = app.state;
    const panel = menuEl.firstElementChild;
    // a row armed for its second tap (「再㩒一次」) keeps its node until the arm ends (onDisarm refreshes)
    if (panel.querySelector?.('.armed')) return;
    const nodes = (menuKind === 'seats' ? seatMenu(st) : menuKind === 'absent' ? absentMenu(st)
      : menuKind === 'who' ? whoMenu(st) : mainMenu(st)).filter(Boolean);
    // state changes stream in all the time (timers); only touch the DOM when the menu itself changed,
    // so a button is never swapped out from under a finger
    const html = nodes.map((n) => n.outerHTML).join('');
    if (html === menuHtml) return;
    menuHtml = html;
    panel.replaceChildren(...nodes);
  }

  function seatMenu(st) {
    const seat = currentSeat(st);
    // #9: never at night or in a secret step — a stray tap would strand the waker or name somebody
    if (secretNow(st)) {
      return [el('h3', { text: '換人' }), el('p', { class: 'hint', text: '🤫 秘密步驟 — 而家換唔到人，部手機擺返中間。' })];
    }
    const here = new Set(walkHere(st, seat));
    const shared = isShared(st);
    const open = openStepNow(st);    // re-run #6: the phone lies face up in the middle for X's public step
    return [
      el('h3', { text: shared && (!seat || open) ? '邊個要睇自己？' : '換邊個睇' }),
      el('div', { class: 'sheet-list' },
        shared && seat && !open ? menuBtnRow('📱 擺返枱中間', () => toTable(), 'seat-home-row') : null,
        playingSeats(st).map((pid) => {
          const p = st.room.players.find((x) => x.id === pid);
          return el('button', {
            class: 'btn btn-ghost' + (pid === seat ? ' btn-locked' : ''), type: 'button',
            style: { '--seat': p?.color ?? 'var(--cheese)' }, onclick: () => switchSeat(pid),
          }, el('span', { class: 'dot' }),
          p?.name ?? '?',
          here.has(pid) ? el('span', { class: 'turn-badge', text: '輪到' }) : null,
          pid === seat ? el('span', { class: 'hint', text: '（而家）' }) : null);
        })),
      el('p', { class: 'hint', style: { marginTop: '.75rem' }, text: '揀咗名會有張交接卡，接機嗰個㩒一下先睇到自己嘅畫面。' }),
    ];
  }

  /** U3 askWho: a public list of this phone's present seats — the tapper picks their own name. */
  function whoMenu(st) {
    const away = new Set(st.room.absent ?? []);
    return [
      el('h3', { text: who?.title ?? '邊個？' }),
      who?.subtitle ? el('p', { class: 'hint', style: { margin: '0 0 .625rem' }, text: who.subtitle }) : null,
      el('div', { class: 'sheet-list who-sheet' },
        playingSeats(st).filter((pid) => !away.has(pid)).map((pid) => {
          const p = st.room.players.find((x) => x.id === pid);
          return el('button', {
            class: 'btn btn-ghost', type: 'button', style: { '--seat': p?.color ?? 'var(--cheese)' }, onclick: () => pickWho(pid),
          }, el('span', { class: 'dot' }), p?.name ?? '?');
        }),
        menuBtnRow('取消', () => closeMenu())),
    ];
  }

  /** In place: the open sheet turns into another of its pages (the 💤 seat picker and back). */
  function menuPage(kind) {
    if (!menuEl) return;
    menuKind = kind;
    menuHtml = '';
    refreshMenu();
  }

  /** ⋯ → 💤 標記缺席… (D4): every playing seat; an absent one can come back (👋). */
  function absentMenu(st) {
    const away = new Set(st.room.absent ?? []);
    const seats = st.room.players.filter((p) => !p.spectator);
    return [
      el('h3', { text: '💤 標記缺席' }),
      el('p', { class: 'hint', style: { margin: '0 0 .625rem' }, text: '缺席嘅人呢局唔使再等佢。' }),
      el('div', { class: 'sheet-list absent-pick' },
        seats.map((p) => (away.has(p.id)
          ? menuBtnRow(`👋 ${p.name} 返咗嚟`, () => { markPresent(p.id); refreshSoon(); }, 'is-absent')
          : menuBtnRow(`💤 ${p.name}`, (e) => { if (markAbsent(p.id, e.currentTarget, refreshSoon)) closeMenu(); }))),
        menuBtnRow('‹ 返回', () => menuPage('main'))),
    ];
  }

  function mainMenu(st) {
    const room = st.room;
    const meta = sh.gameMeta(room.gameId) ?? {};
    const rows = [el('h3', { text: '選項' })];
    const list = [];

    if (st.isHost) {
      list.push(menuBtnRow(room.paused ? '▶ 繼續' : '⏸ 暫停', () => { togglePause(); closeMenu(); }));
      list.push(menuBtnRow('⏭ 跳過呢步', (e) => { if (skipFromMenu(e.currentTarget)) closeMenu(); }));
      list.push(menuBtnRow('🗑️ 呢輪作廢', (e) => { if (voidRound(e.currentTarget, refreshSoon)) closeMenu(); }));
      list.push(menuBtnRow('💤 標記缺席…', () => menuPage('absent')));
      // the game's own host buttons (engine.hostActions), e.g. 你畫我猜 ＋30 秒 / 呢題作廢
      for (const h of st.hostActions ?? []) {
        list.push(menuBtnRow(`🎛️ ${h.label}`, () => {
          closeMenu();
          let ok = false;
          try { ok = app.hostCtl?.hostAction?.(h.i, h.label) === true; } catch (err) { console.error(err); }
          if (!ok) toast('而家做唔到', 1800);
        }));
      }
      if (sh.timer.available()) list.push(menuBtnRow('⏱️ 計時', () => { closeMenu(); sh.timer.open(); }));

      if (meta.narration && meta.narration !== 'none') {
        const mode = room.narration?.mode ?? 'voice';
        // U1 (§7.1): an eyes-closed night on a whole-table phone has no 靜音
        const offered = narrationChoices(meta, { singleDevice: !!room.singleDevice }).modes;
        list.push(el('div', { class: 'sec', text: '旁白' }));
        list.push(el('div', { class: 'seg' }, [['voice', '🔊 語音'], ['read', '📜 讀稿'], ['silent', '🔇 靜音']].filter(([m]) => offered.includes(m)).map(([m, label]) => el('button', {
          type: 'button', class: m === mode ? 'on' : '',
          onclick: () => { if (m === 'silent') narrator.cancel(); app.narration.setMode(m); },
        }, label))));
      }

      // seats the table waits on: phone gone (room.stalled, also a banner) or connected but silent (room.idle, #9 —
      // only here: a long talk before a pick looks the same, so it never shouts)
      const waitedOn = [...(room.stalled ?? []), ...(room.idle ?? [])];
      if (waitedOn.length) {
        list.push(el('div', { class: 'sec', text: '斷咗線 / 無反應' }));
        for (const s of waitedOn) {
          const who = nameOf(st, s.pid);
          list.push(menuBtnRow(`🤖 代 ${who} 做`, () => { app.hostCtl.autoAct(s.pid); closeMenu(); }));
          list.push(menuBtnRow(`💤 當 ${who} 缺席`, (e) => { if (markAbsent(s.pid, e.currentTarget, refreshSoon)) closeMenu(); }));
        }
      }
    }

    if (st.isHost && st.mode !== 'local') list.push(...connectedRows(st));

    list.push(el('div', { class: 'sec', text: '其他' }));
    list.push(menuBtnRow('💡 提示：而家要做咩', () => { closeMenu(); openHints(); }));
    list.push(menuBtnRow('📖 規則', () => { closeMenu(); openRules(); }));
    if (room.timer) list.push(menuBtnRow('🕰️ 枱中大時鐘', () => { closeMenu(); sh.timer.openBig(); }));
    list.push(el('div', { class: 'seg', role: 'group', 'aria-label': '聲效' },
      [[true, '🔊 聲效開'], [false, '🔇 聲效閂']].map(([on, label]) => el('button', {
        type: 'button', class: sh.sound.isOn() === on ? 'on' : '',
        onclick: () => { if (sh.sound.isOn() !== on) sh.sound.toggle(); refreshMenu(); },
      }, label))));
    list.push(el('div', { class: 'seg', role: 'group', 'aria-label': '字體' },
      [['normal', 'Aa 標準字'], ['large', 'Aa 大字']].map(([v, label]) => el('button', {
        type: 'button', class: textSize() === v ? 'on' : '',
        onclick: () => { setTextSize(v); refreshMenu(); },
      }, label))));
    list.push(menuBtnRow('🚪 離開房間', (e) => { if (sh.leave(e.currentTarget, { onDisarm: refreshSoon })) closeMenu(); }, 'btn-danger'));
    return [...rows, el('div', { class: 'sheet-list' }, list)];
  }

  /** #25: who is connected right now, with the battery reminder. */
  function connectedRows(st) {
    const players = st.room.players.filter((p) => !p.spectator);
    const away = players.filter((p) => !p.connected);
    const absent = new Set(st.room.absent ?? []);
    return [
      el('div', { class: 'sec', text: away.length ? `連線（${away.length} 個斷咗）` : '連線（全部都喺度）' }),
      el('ul', { class: 'conn-list' }, players.map((p) => el('li', { class: `${p.connected ? 'on' : 'off'}${absent.has(p.id) ? ' absent' : ''}` },
        el('span', { class: 'dot', style: { '--seat': p.color ?? 'var(--cheese)' } }),
        el('span', { class: 'nm', text: p.name }),
        st.mySeats.includes(p.id) ? el('span', { class: 'tag', text: '呢部機' }) : null,
        absent.has(p.id) ? el('span', { class: 'tag', text: '💤 缺席' }) : null,
        el('span', { class: 'conn-state', text: p.connected ? '🟢 喺度' : '🔴 斷咗線' })))),
      el('p', { class: 'hint conn-tip', text: '🔋 提大家：電量低過 20% 就叉電，或者開「低耗電模式」。房主部機一熄，成個遊戲就停。' }),
    ];
  }

  // ---------- banners ----------
  function paintBanners(st) {
    const room = st.room;
    const shownStalls = st.isHost ? (room.stalled ?? []).filter((s) => !dismissedStalled.has(`${s.pid}@${s.since}`)) : [];
    const bannerKey = sig([!!room.paused, !!st.isHost, shownStalls.map((s) => [s.pid, s.since, nameOf(st, s.pid)])]);
    if (bannerKey === bannerSig) return;       // unchanged: keep the nodes (an armed 呢鋪唔計 keeps its label)
    bannerSig = bannerKey;
    const rows = [];

    if (room.paused) {
      rows.push(el('div', { class: 'banner' },
        el('span', { class: 'grow', text: '⏸ 主持暫停咗遊戲' }),
        st.isHost ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => app.hostCtl.resume() }, '▶ 繼續') : null));
    }

    if (st.isHost) {
      // a seat the table waits on while its phone is gone (a connected, silent one is only listed in ⋯, #9)
      for (const s of shownStalls) {
        const key = `${s.pid}@${s.since}`;
        const who = nameOf(st, s.pid);
        rows.push(el('div', { class: 'banner err stall' },
          el('span', { class: 'grow', text: `⚠️ ${who} 斷咗線，成個遊戲等緊佢` }),
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => app.hostCtl.autoAct(s.pid) }, '代佢做'),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: (e) => markAbsent(s.pid, e.currentTarget) }, '💤 當佢缺席'),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: (e) => voidRound(e.currentTarget) }, '呢鋪唔計'),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { dismissedStalled.add(key); paintBanners(app.state); } }, '再等')));
      }
    }
    banners.replaceChildren(...rows);
  }

  // ---------- narration ----------
  function paintNarrator(st, view) {
    const room = st.room;
    const meta = sh.gameMeta(room.gameId) ?? {};
    const mode = room.narration?.mode ?? 'voice';
    const wanted = st.isHost && meta.narration !== 'none' && (!!st.cue || mode !== 'silent');
    // this phone's seat is drawing: fold the bar to one line so it never covers the sheet
    // (engine.canInk via the core; view.canDraw / view.draw.canDraw for a core without it)
    const seat = playsAs(st);
    const compact = !!seat && !!(st.canInk?.includes(seat) || view?.canDraw || view?.draw?.canDraw);
    root.classList.toggle('has-narrator', wanted);
    root.classList.toggle('narrator-compact', wanted && compact);
    // #1 watchdog: the app reports narration = { status: 'idle' | 'speaking' | 'stalled', line }
    const stalled = st.narration?.status === 'stalled';
    const line = (stalled && st.narration?.line) || st.cue?.text || '';
    const nar = app.narration ?? {};
    narratorBar.update({
      hidden: !wanted,
      compact,
      // U1: no 靜音 for an eyes-closed night on a whole-table phone; #35: there the ghost ⏭ is in reach of whoever
      // holds the phone, so it lives in ⋯ only (the 讀稿 narrator's 下一步 stays)
      modes: narrationChoices(meta, { singleDevice: !!room.singleDevice }).modes,
      hideSkip: isWholeTable(st),
      cue: st.cue ?? null,
      mode,
      stalled,
      line,
      reason: st.narration?.reason ?? null,
      paused: !!room.paused,
      // The app speaks cues and reports them done; replay goes through the app when it can, so the watchdog sees it.
      onReplay: () => {
        narrator.prime?.();
        if (typeof nar.replay === 'function') nar.replay();
        else if (line) narrator.speak(line);
      },
      onSkip: typeof nar.skip === 'function' ? () => { narrator.cancel(); nar.skip(); } : null,
      // #13: a skip that would cut somebody off takes two taps (the bar arms itself)
      confirmNext: skipNeedsTwo(st) ? SKIP_CONFIRM : null,
      onNext: () => doSkip(),
      onPause: () => togglePause(),
      onMode: (m) => { if (m === 'silent') narrator.cancel(); app.narration.setMode(m); },
    });
  }

  // ---------- header ----------
  /** Host: ⏸ one tap away (#25) and ⏱️ (T1); the sound toggle moves into ⋯ to make room. */
  function paintTools(st) {
    const host = !!st.isHost;
    pauseBtn.hidden = !host;
    pauseBtn.textContent = st.room.paused ? '▶' : '⏸';
    pauseBtn.setAttribute('aria-label', st.room.paused ? '繼續' : '暫停');
    pauseBtn.classList.toggle('on', !!st.room.paused);
    soundBtn.hidden = host;
  }

  function paintHeader(st, meta, view, seat) {
    root.style.setProperty('--accent', meta.accent ?? '#f5c518');
    emojiEl.textContent = meta.emoji ?? '🎲';
    titleEl.textContent = view?.title ?? meta.name ?? '';

    // 輪到你 only for a real turn (#14, logic.turnBadge): never at night (the brightest thing on a lit phone
    // across a dark table), never in a secret step (focus.anonymous), never in a step everybody does at once.
    // Before the subtitle, so a long subtitle's ellipsis never cuts it off.
    // #20: never on a shared phone — the whole table reads it, and the pass gate already says whose turn it is
    const shared = isShared(st);
    const myTurn = !shared && turnBadge(st.focus, seat, { night: !!view?.night });
    subEl.replaceChildren(...[
      myTurn ? el('span', { class: 'turn-badge', style: { marginRight: view?.subtitle ? '.5rem' : '0' }, text: '輪到你' }) : null,
      view?.subtitle || null,
    ].filter(Boolean));

    const anon = !!st.focus?.anonymous;
    const atTable = shared && !seat;
    // re-run #6: a public one-person step (focus.open) is on the phone in the middle for everyone — the chip says so,
    // never 「而家睇：X」, and there is no 📱 擺返中間. While X draws on it the chip cannot be tapped (a 換人 would take
    // the canvas off the table's screen); otherwise anyone may still pick their own name to peek (9upper's role
    // reminder during the 諗樣's explain, #9) — a hand-picked seat, as from the table chip
    const openStep = openStepNow(st);
    seatChip.classList.toggle('at-table', atTable || openStep);
    root.classList.toggle('at-table', atTable);
    homeBtn.hidden = !(shared && seat && !secretNow(st) && !openStep);
    if (shared && secretNow(st)) {
      // #9 / #1: at night and in a secret step the chip names nobody and cannot be tapped (the dawn chip is the
      // same whoever acted last)
      seatChip.hidden = false;
      seatChip.disabled = true;
      seatChip.replaceChildren(
        el('span', { class: 'dot', style: { '--seat': 'var(--text-dim)' } }),
        el('span', { class: 'who', text: anon ? '🤫 而家係秘密步驟' : '🌙 夜晚 · 部手機擺喺中間' }));
    } else if (openStep) {
      const drawing = inkingNow(st, view);
      seatChip.hidden = false;
      seatChip.disabled = drawing;
      seatChip.replaceChildren(...[
        el('span', { class: 'who', text: openStepChip(nameOf(st, seat), st.focus.label) }),
        drawing ? null : el('span', { class: 'swap', text: '揀名 ⇄' }),
      ].filter(Boolean));
    } else if (atTable) {
      seatChip.hidden = false;
      seatChip.disabled = false;
      seatChip.replaceChildren(
        el('span', { class: 'who', text: '📱 枱中間 — 㩒你個名睇自己' }),
        el('span', { class: 'swap', text: '揀名 ⇄' }));
    } else if (!seat) {
      seatChip.hidden = false;
      seatChip.disabled = true;
      seatChip.replaceChildren(el('span', { class: 'who', text: '👀 旁觀緊 — 下一局先入到場' }));
    } else if (shared) {
      const p = st.room.players.find((x) => x.id === seat);
      seatChip.hidden = false;
      seatChip.disabled = false;
      seatChip.replaceChildren(
        el('span', { class: 'dot', style: { '--seat': p?.color ?? 'var(--cheese)' } }),
        el('span', { class: 'who', text: `而家睇：${p?.name ?? '?'}` }),
        el('span', { class: 'swap', text: '換人 ⇄' }));
    } else {
      seatChip.hidden = true;
    }
    seatRow.hidden = seatChip.hidden && homeBtn.hidden;
  }

  /**
   * A chime when it becomes this phone's turn. Never at night (a chime from the
   * one awake phone tells the whole table who it is), never for an anonymous
   * prompt, and not on a shared phone (the pass gate already announces it).
   */
  function chimeForTurn(st, view, seat) {
    const mine = !!seat && !!st.focus?.pids?.includes(seat);
    if (mine && wasMyTurn === false && (st.mySeats?.length ?? 0) === 1 && !view?.night && !st.focus?.anonymous) sfx('turn');
    wasMyTurn = mine;
  }

  // ---------- first paint sound ----------
  if (sh.cameFrom === 'lobby' || sh.cameFrom === 'results') sfx('start');

  return {
    el: root,
    update(st) {
      if (!st.room) return;
      const room = st.room;
      // §7.1: who holds a shared phone is settled FIRST, so nothing is ever painted for a seat that just lost it
      // (setActiveSeat changes app.state at once; the screen below reads the result)
      evaluateFocusGate(st);
      setClockHold(room.phase === 'playing' ? heldAtOf(st) : null);   // U10: every Timer stands still while held
      const seat = playsAs(st);
      const meta = sh.gameMeta(room.gameId) ?? {};
      const view = viewFor(st);
      const shared = isShared(st);

      paintHeader(st, meta, view, seat);
      paintTools(st);
      chimeForTurn(st, view, seat);
      paintBanners(st);
      paintNarrator(st, view);
      try {
        recent.update({ recent: view?.recent ?? null, players: room.players });
      } catch (err) { console.error('[play] recent folds failed', err); }

      // dark and silent between this seat's own steps (decoys stay tappable underneath); 靜音 (D1): one readable
      // dim on every phone all night, the awake seat included — logic.nightChrome
      // a shared phone lying in the middle at night is covered (§7.1); its night is any of its seats' (or the table's)
      const mode = room.narration?.mode ?? 'voice';
      const isNight = shared ? nightNow(st) : !!view?.night;
      const night = nightChrome({
        seat, night: isNight, inFocus: !!seat && !!st.focus?.pids?.includes(seat),
        mode, shared, table: shared && !seat,
      });
      sh.sound.night(night.on, { level: night.level, words: night.words });
      // U8: the night's neutral noise bed on the phone in the middle, when the game asks for it — meta.nightAmbient,
      // which defaults to an eyes-closed night (engine-kit.wantsNightAmbient) — never in 靜音; a multi-phone table is
      // left as it was
      const bed = isWholeTable(st) && room.phase === 'playing' && isNight && mode !== 'silent'
        && (wantsNightAmbient(meta) || st.table?.ambient === true);
      if (bed !== ambientOn) { ambientOn = bed; sh.sound.ambient?.(bed); }

      const key = `${room.gameId}|${seat ?? 'table'}`;
      if (key !== uiKey) {
        if (view) {
          uiKey = key;
          mountUI(st, key, seat);
        } else if (ui || uiKey) {
          // no view for whoever holds the phone now: never leave the last holder's screen up meanwhile
          uiToken++;
          ui?.destroy?.();
          ui = null;
          uiKey = null;
          gameRoot.replaceChildren(el('div', { class: 'play-loading', text: shared && !seat ? '📱 部手機擺喺枱中間' : '載入緊遊戲…' }));
        }
      } else {
        pushUpdate();
      }

      refreshMenu();
      if (hints.isOpen()) hints.update(sh.cached(room.gameId), viewFor(st), hintOpts(st));
    },
    destroy() {
      if (holding) { try { app.hostCtl?.holdClock?.(false); } catch (err) { console.error(err); } holding = false; }
      setClockHold(null);
      if (ambientOn) { ambientOn = false; sh.sound.ambient?.(false); }
      if (who) { const req = who; who = null; req.resolve(null); }
      uiToken++;
      gateToken++;
      closeMenu();
      hints.close();
      PassGate.hide();
      RulesSheet.close();
      closeAllCovers();
      ui?.destroy?.();
      ui = null;
      narratorBar.destroy();
      recent.destroy();
    },
  };
}
