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
//
// The game UI is mounted once per (game, seat). Switching seat destroys it and
// mounts a fresh one, so api.me is always the seat being shown and no
// half-picked target can leak from one seat's screen to the next on a shared phone.
// ============================================================

import { el, toast, lockScroll, unlockScroll, sig } from '../dom.js?v=20261004005209';
import { sfx } from '../../core/sfx.js?v=20261004005209';
import { components, NarratorBar, PassGate, RulesSheet, RecentFold, closeAllCovers } from '../components/index.js?v=20261004005209';
import { HintSheet } from '../hints.js?v=20261004005209';
import { textSize, setTextSize } from '../settings.js?v=20261004005209';
import { turnBadge, skipNeedsConfirm, SKIP_CONFIRM, nightChrome } from '../logic.js?v=20261004005209';

const NO_VOID = '呢個遊戲唔支援呢輪作廢';
const NO_SKIP = '跳唔到呢步 — 要等人自己做（⋯ 可以代佢做或者標記缺席）';
const noSkipFor = (name) => `跳唔到呢步 — 等緊 ${name}（⋯ 可以代佢做或者當佢缺席）`;

/** A failed action, in words a player understands (the core's own short Cantonese message wins). */
function sendFailedText(err) {
  const msg = String(err?.message ?? '');
  return /[一-鿿]/.test(msg) && msg.length <= 24 ? `⚠️ ${msg}` : '⚠️ 冇送到 — 重連緊，等陣再㩒';
}

const cssLoaded = new Set();

/** games/<id>/style.css, once, for games whose meta says css: true. */
function ensureGameCss(id) {
  if (cssLoaded.has(id)) return;
  cssLoaded.add(id);
  document.head.append(el('link', { rel: 'stylesheet', href: `js/games/${id}/style.css?v=20261004005209` }));
}

export function mountPlay(sh) {
  const { app, narrator } = sh;

  let ui = null;              // the game's { update, destroy }
  let uiKey = null;           // `${gameId}|${seat}` the current ui was mounted for
  let uiToken = 0;
  let gateToken = 0;
  let gateKind = null;        // 'auto' (focus) | 'switch' (player chose)
  let gatedFor = null;        // focus signature we already opened a gate for
  let anonShown = null;       // the eyes-closed prompt a gate was already shown for (one decoy per step)
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
  const timerStrip = sh.timer.strip();
  const banners = el('div');
  const gameRoot = el('div', { class: 'play-game' });
  // #10: the game's public 「📜 之前嘅投票」 / 「🌅 昨晚」 (view.recent), folded under its UI
  const recent = RecentFold({});
  const narratorBar = NarratorBar({ hidden: true });
  const hints = HintSheet(sh, { onRules: () => openRules() });

  const root = el('section', { class: 'screen play', 'data-screen': 'play' },
    top, seatChip, timerStrip, banners, gameRoot, recent.el, narratorBar.el);

  // ---------- derived state ----------
  const currentSeat = (st) => st.activeSeat ?? st.mySeats?.[0] ?? null;
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
  const ctxFor = (st) => ({
    focus: st.focus ?? null,
    paused: !!st.room.paused,
    narrationMode: st.room.narration?.mode ?? 'voice',
    ink: st.ink ?? { epoch: 0, strokes: [] },
  });

  // ---------- 💡 hints (never opened by the app itself) ----------
  async function openHints() {
    const id = app.state.room?.gameId;
    if (!id) return;
    let game;
    try { game = sh.cached(id) ?? await sh.loadGame(id); } catch (err) { console.error(err); toast('載入唔到提示'); return; }
    hints.open(game, viewFor(app.state));
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
  function makeApi(game, seat) {
    return {
      me: seat,
      meta: game.meta,
      get players() { return app.state.room?.players ?? []; },
      get isHost() { return !!app.state.isHost; },
      get config() { return app.state.room?.config ?? {}; },
      send(action) {
        if (!seat) { toast('旁觀緊，做唔到嘢'); return; }
        const res = app.act(seat, action);
        // G4: the core's act() resolves once the host has taken it and rejects when it did not
        // get through. Never pretend: say so (a game UI may still await the same promise).
        if (res && typeof res.then === 'function') {
          res.then(null, (err) => { if (app.state.mode) toast(sendFailedText(err), 2600); });
        } else if (res === false && app.state.mode === 'client' && app.state.conn !== 'online') {
          toast('⚠️ 冇送到 — 重連緊，等陣再㩒', 2600);
        }
        return res;
      },
      // #3: arm-then-confirm, never window.confirm (it freezes the host phone, which is the room's server)
      confirm: (text, node = null, opts = {}) => sh.confirm(text, node, opts),
      ink(payload) { if (seat) return app.ink(seat, payload); },
      now: () => app.clock.now(),
      sfx,
      toast,
      components,
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
    const view = viewFor(st);
    if (!view) return;
    try { ui.update(view, ctxFor(st)); } catch (err) { console.error('[play] ui.update failed', err); }
  }

  // ---------- pass gate ----------
  /**
   * kind: 'auto' (focus names a seat here) · 'decoy' (an eyes-closed step calls nobody on this phone —
   * the same gate, so a shared phone never shows whether the role is here, elsewhere or in the centre;
   * tapping it changes nothing) · 'switch' (the player chose another seat).
   */
  async function openGate(kind, target, text) {
    const token = ++gateToken;
    gateKind = kind;
    hints.close();          // the phone is changing hands: the 💡 sheet belonged to the last holder
    closeAllCovers();
    await PassGate.show(text);
    if (token !== gateToken) return;                   // replaced or cancelled meanwhile
    gateKind = null;
    if (!target) return;                               // the decoy: nobody to switch to
    if (kind === 'auto' && !focusWants(app.state, target)) return;
    app.setActiveSeat(target);
  }

  function closeAutoGate() {
    if ((gateKind === 'auto' || gateKind === 'decoy') && PassGate.isOpen()) { gateToken++; gateKind = null; PassGate.hide(); }
  }

  /** Seats named by focus that live on THIS device, in seat order. */
  function focusSeatsHere(st) {
    const pids = st.focus?.pids;
    if (!pids?.length) return [];
    return st.room.players.map((p) => p.id).filter((id) => pids.includes(id) && st.mySeats.includes(id));
  }

  const focusWants = (st, target) => focusSeatsHere(st)[0] === target && currentSeat(st) !== target;

  /**
   * A shared phone (2+ seats) hands itself over when focus names one of its seats.
   * Eyes-closed (anonymous) steps are stricter: the gate shows the role prompt for EVERY such step —
   * also when the active seat is already the one called, when the role sits on another phone, and when
   * it is in the centre (the core sends { pids: [], anonymous } then) — once per step, so how the shared
   * phone behaves never depends on who holds the role. Only the receiver's tap reveals anything.
   */
  function evaluateFocusGate(st) {
    if ((st.mySeats?.length ?? 0) < 2) { gatedFor = null; anonShown = null; return; }   // a gate only makes sense when phones are shared
    const here = focusSeatsHere(st);
    const seat = currentSeat(st);
    const anon = st.focus?.anonymous || '';

    if (anon) {
      const target = here[0] ?? null;
      const sig = `${target ?? '-'}|${anon}`;
      if (gatedFor === sig) return;                    // already asked (and maybe answered) for this
      // the decoy opens once per step; a real seat of this phone gets its own gate as the walk reaches it
      if (!target && anonShown === anon) return;
      gatedFor = sig;
      anonShown = anon;
      openGate(target ? 'auto' : 'decoy', target, { title: anon, subtitle: '其他人閉埋眼，唔好望' });
      return;
    }
    anonShown = null;
    if (!here.length || here.includes(seat)) { gatedFor = null; closeAutoGate(); return; }

    const target = here[0];
    const sig = `${target}|`;
    if (gatedFor === sig) return;
    gatedFor = sig;
    openGate('auto', target, { title: `交俾 ${nameOf(st, target)}`, subtitle: '其他人唔好望' });
  }

  function switchSeat(pid) {
    const st = app.state;
    closeMenu();
    if (pid === currentSeat(st)) return;
    openGate('switch', pid, { title: `交俾 ${nameOf(st, pid)}`, subtitle: '其他人唔好望' });
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
    const nodes = menuKind === 'seats' ? seatMenu(st) : menuKind === 'absent' ? absentMenu(st) : mainMenu(st);
    // state changes stream in all the time (timers); only touch the DOM when the menu itself changed,
    // so a button is never swapped out from under a finger
    const html = nodes.map((n) => n.outerHTML).join('');
    if (html === menuHtml) return;
    menuHtml = html;
    panel.replaceChildren(...nodes);
  }

  function seatMenu(st) {
    const seat = currentSeat(st);
    const here = new Set(focusSeatsHere(st));
    const anon = !!st.focus?.anonymous;
    return [
      el('h3', { text: '換邊個睇' }),
      el('div', { class: 'sheet-list' }, st.mySeats.map((pid) => {
        const p = st.room.players.find((x) => x.id === pid);
        return el('button', {
          class: 'btn btn-ghost' + (pid === seat ? ' btn-locked' : ''), type: 'button',
          style: { '--seat': p?.color ?? 'var(--cheese)' }, onclick: () => switchSeat(pid),
        }, el('span', { class: 'dot' }),
        anon ? `座位 ${(p?.seat ?? 0) + 1}` : (p?.name ?? '?'),
        here.has(pid) && !anon ? el('span', { class: 'turn-badge', text: '輪到' }) : null,
        pid === seat ? el('span', { class: 'hint', text: '（而家）' }) : null);
      })),
      el('p', { class: 'hint', style: { marginTop: '.75rem' }, text: '換人之前會有張交接卡，接機嗰個㩒一下先睇到自己嘅畫面。' }),
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
        list.push(el('div', { class: 'sec', text: '旁白' }));
        list.push(el('div', { class: 'seg' }, [['voice', '🔊 語音'], ['read', '📜 讀稿'], ['silent', '🔇 靜音']].map(([m, label]) => el('button', {
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
    const myTurn = turnBadge(st.focus, seat, { night: !!view?.night });
    subEl.replaceChildren(...[
      myTurn ? el('span', { class: 'turn-badge', style: { marginRight: view?.subtitle ? '.5rem' : '0' }, text: '輪到你' }) : null,
      view?.subtitle || null,
    ].filter(Boolean));

    const anon = !!st.focus?.anonymous;
    const seatsHere = st.mySeats?.length ?? 0;
    if (!seat) {
      seatChip.hidden = false;
      seatChip.disabled = true;
      seatChip.replaceChildren(el('span', { class: 'who', text: '👀 旁觀緊 — 下一局先入到場' }));
    } else if (seatsHere > 1) {
      const p = st.room.players.find((x) => x.id === seat);
      seatChip.hidden = false;
      seatChip.disabled = false;
      seatChip.replaceChildren(
        el('span', { class: 'dot', style: { '--seat': anon ? 'var(--text-dim)' : (p?.color ?? 'var(--cheese)') } }),
        el('span', { class: 'who', text: anon ? '🤫 而家係秘密步驟' : `而家睇：${p?.name ?? '?'}` }),
        el('span', { class: 'swap', text: '換人 ⇄' }));
    } else {
      seatChip.hidden = true;
    }
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
      const seat = playsAs(st);
      const meta = sh.gameMeta(room.gameId) ?? {};
      const view = viewFor(st);

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
      const night = nightChrome({
        seat, night: !!view?.night, inFocus: !!seat && !!st.focus?.pids?.includes(seat),
        mode: room.narration?.mode ?? 'voice', shared: (st.mySeats?.length ?? 0) > 1,
      });
      sh.sound.night(night.on, { level: night.level, words: night.words });

      const key = `${room.gameId}|${seat ?? 'table'}`;
      if (key !== uiKey && view) {
        uiKey = key;
        mountUI(st, key, seat);
      } else {
        pushUpdate();
      }

      evaluateFocusGate(st);
      refreshMenu();
      if (hints.isOpen()) hints.update(sh.cached(room.gameId), viewFor(st));
    },
    destroy() {
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
