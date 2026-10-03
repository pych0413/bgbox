// ============================================================
// screens/play.js — the in-game screen: top bar, host menu, banners, pass
// gates, night dim, and the mount point for the game's own UI.
//
// What this screen decides, from app.state only:
//  - which seat this phone is showing (state.activeSeat) and its view
//  - when to put a PassGate in front of the phone (focus names another seat
//    that lives on this device, or the player switched seats by hand)
//  - when to go dark and silent (that seat's view.night, unless focus names it)
//  - host-only extras: pause / next / narration mode / auto-act for a stalled seat
//
// The game UI is mounted once per (game, seat). Switching seat destroys it and
// mounts a fresh one, so api.me is always the seat being shown and no
// half-picked target can leak from one seat's screen to the next on a shared phone.
// ============================================================

import { el, toast, lockScroll, unlockScroll } from '../dom.js?v=1';
import { sfx } from '../../core/sfx.js?v=1';
import { components, NarratorBar, PassGate, RulesSheet, closeAllCovers } from '../components/index.js?v=1';

const cssLoaded = new Set();

/** games/<id>/style.css, once, for games whose meta says css: true. */
function ensureGameCss(id) {
  if (cssLoaded.has(id)) return;
  cssLoaded.add(id);
  document.head.append(el('link', { rel: 'stylesheet', href: `js/games/${id}/style.css?v=1` }));
}

export function mountPlay(sh) {
  const { app, narrator } = sh;

  let ui = null;              // the game's { update, destroy }
  let uiKey = null;           // `${gameId}|${seat}` the current ui was mounted for
  let uiToken = 0;
  let gateToken = 0;
  let gateKind = null;        // 'auto' (focus) | 'switch' (player chose)
  let gatedFor = null;        // focus signature we already opened a gate for
  let menuEl = null;
  let menuKind = null;
  let menuHtml = '';          // what the open menu currently shows (see refreshMenu)
  let wasMyTurn = null;       // null until the first update: a turn already under way is history, not news
  const dismissedStalled = new Set();

  // ---------- skeleton ----------
  const emojiEl = el('span', { class: 'play-emoji' });
  const titleEl = el('b');
  const subEl = el('small');
  const rulesBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': '規則', onclick: openRules }, '📖');
  const menuBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': '選項', onclick: () => openMenu('main') }, '⋯');
  const top = el('header', { class: 'play-top' },
    el('div', { class: 'play-title' }, emojiEl, el('div', { class: 'play-name' }, titleEl, subEl)),
    el('div', { class: 'play-tools' }, rulesBtn, sh.soundButton(), menuBtn));

  const seatChip = el('button', { class: 'seat-chip', type: 'button', onclick: () => openMenu('seats') });
  const banners = el('div');
  const gameRoot = el('div', { class: 'play-game' });
  const narratorBar = NarratorBar({ hidden: true });

  const root = el('section', { class: 'screen play', 'data-screen': 'play' },
    top, seatChip, banners, gameRoot, narratorBar.el);

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
        return app.act(seat, action);
      },
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
  async function openGate(kind, target, text) {
    const token = ++gateToken;
    gateKind = kind;
    closeAllCovers();
    await PassGate.show(text);
    if (token !== gateToken) return;                   // replaced or cancelled meanwhile
    gateKind = null;
    if (kind === 'auto' && !focusWants(app.state, target)) return;
    app.setActiveSeat(target);
  }

  function closeAutoGate() {
    if (gateKind === 'auto' && PassGate.isOpen()) { gateToken++; gateKind = null; PassGate.hide(); }
  }

  /** Seats named by focus that live on THIS device, in seat order. */
  function focusSeatsHere(st) {
    const pids = st.focus?.pids;
    if (!pids?.length) return [];
    return st.room.players.map((p) => p.id).filter((id) => pids.includes(id) && st.mySeats.includes(id));
  }

  const focusWants = (st, target) => focusSeatsHere(st)[0] === target && currentSeat(st) !== target;

  function evaluateFocusGate(st) {
    if ((st.mySeats?.length ?? 0) < 2) { gatedFor = null; return; }   // a gate only makes sense when phones are shared
    const here = focusSeatsHere(st);
    const seat = currentSeat(st);
    if (!here.length || here.includes(seat)) { gatedFor = null; closeAutoGate(); return; }

    const target = here[0];
    const anon = st.focus?.anonymous || '';
    const sig = `${target}|${anon}`;
    if (gatedFor === sig) return;                      // already asked (and maybe answered) for this
    gatedFor = sig;
    openGate('auto', target, anon
      ? { title: anon, subtitle: '其他人閉埋眼，唔好望' }
      : { title: `交俾 ${nameOf(st, target)}`, subtitle: '其他人唔好望' });
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

  function refreshMenu() {
    if (!menuEl) return;
    const st = app.state;
    const panel = menuEl.firstElementChild;
    const nodes = menuKind === 'seats' ? seatMenu(st) : mainMenu(st);
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

  function mainMenu(st) {
    const room = st.room;
    const meta = sh.gameMeta(room.gameId) ?? {};
    const rows = [el('h3', { text: '選項' })];
    const list = [];

    if (st.isHost) {
      list.push(menuBtnRow(room.paused ? '▶ 繼續' : '⏸ 暫停', () => { room.paused ? app.hostCtl.resume() : app.hostCtl.pause(); closeMenu(); }));
      list.push(menuBtnRow('⏭ 下一步（跳過今個步驟）', () => { narrator.cancel(); app.hostCtl.next(); closeMenu(); }));

      if (meta.narration && meta.narration !== 'none') {
        const mode = room.narration?.mode ?? 'voice';
        list.push(el('div', { class: 'sec', text: '旁白' }));
        list.push(el('div', { class: 'seg' }, [['voice', '🔊 語音'], ['read', '📜 讀稿'], ['silent', '🔇 靜音']].map(([m, label]) => el('button', {
          type: 'button', class: m === mode ? 'on' : '',
          onclick: () => { if (m === 'silent') narrator.cancel(); app.narration.setMode(m); },
        }, label))));
      }

      const stalled = room.stalled ?? [];
      if (stalled.length) {
        list.push(el('div', { class: 'sec', text: '斷咗線 / 無反應' }));
        for (const s of stalled) {
          list.push(menuBtnRow(`🤖 代 ${nameOf(st, s.pid)} 做`, () => { app.hostCtl.autoAct(s.pid); closeMenu(); }));
        }
      }
    }

    list.push(el('div', { class: 'sec', text: '其他' }));
    list.push(menuBtnRow('📖 規則', () => { closeMenu(); openRules(); }));
    list.push(menuBtnRow('🚪 離開房間', () => { closeMenu(); sh.leave(); }, 'btn-danger'));
    return [...rows, el('div', { class: 'sheet-list' }, list)];
  }

  // ---------- banners ----------
  function paintBanners(st) {
    const room = st.room;
    const rows = [];

    if (room.paused) {
      rows.push(el('div', { class: 'banner' },
        el('span', { class: 'grow', text: '⏸ 主持暫停咗遊戲' }),
        st.isHost ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => app.hostCtl.resume() }, '▶ 繼續') : null));
    }

    if (st.isHost) {
      for (const s of room.stalled ?? []) {
        const key = `${s.pid}@${s.since}`;
        if (dismissedStalled.has(key)) continue;
        rows.push(el('div', { class: 'banner err' },
          el('span', { class: 'grow', text: `⚠️ ${nameOf(st, s.pid)} 斷咗線，成個遊戲等緊佢` }),
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => app.hostCtl.autoAct(s.pid) }, '代佢做'),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { dismissedStalled.add(key); paintBanners(app.state); } }, '再等')));
      }
    }
    banners.replaceChildren(...rows);
  }

  // ---------- narration ----------
  function paintNarrator(st) {
    const room = st.room;
    const meta = sh.gameMeta(room.gameId) ?? {};
    const mode = room.narration?.mode ?? 'voice';
    const wanted = st.isHost && meta.narration !== 'none' && (!!st.cue || mode !== 'silent');
    root.classList.toggle('has-narrator', wanted);
    narratorBar.update({
      hidden: !wanted,
      cue: st.cue ?? null,
      mode,
      paused: !!room.paused,
      // The app speaks cues and reports them done. Replay only queues the line again.
      onReplay: () => { if (st.cue?.text) narrator.speak(st.cue.text); },
      onNext: () => { narrator.cancel(); app.hostCtl.next(); },
      onPause: () => (app.state.room.paused ? app.hostCtl.resume() : app.hostCtl.pause()),
      onMode: (m) => { if (m === 'silent') narrator.cancel(); app.narration.setMode(m); },
    });
  }

  // ---------- header ----------
  function paintHeader(st, meta, view, seat) {
    root.style.setProperty('--accent', meta.accent ?? '#f5c518');
    emojiEl.textContent = meta.emoji ?? '🎲';
    titleEl.textContent = view?.title ?? meta.name ?? '';

    const myTurn = !!seat && !!st.focus?.pids?.includes(seat);
    subEl.replaceChildren(...[
      view?.subtitle || null,
      myTurn ? el('span', { class: 'turn-badge', style: { marginLeft: view?.subtitle ? '.5rem' : '0' }, text: '輪到你' }) : null,
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
      chimeForTurn(st, view, seat);
      paintBanners(st);
      paintNarrator(st);

      // dark and silent between this seat's own steps (decoys stay tappable underneath)
      const inFocus = !!seat && !!st.focus?.pids?.includes(seat);
      sh.sound.night(!!seat && !!view?.night && !inFocus);

      const key = `${room.gameId}|${seat ?? 'table'}`;
      if (key !== uiKey && view) {
        uiKey = key;
        mountUI(st, key, seat);
      } else {
        pushUpdate();
      }

      evaluateFocusGate(st);
      refreshMenu();
    },
    destroy() {
      uiToken++;
      gateToken++;
      closeMenu();
      PassGate.hide();
      RulesSheet.close();
      closeAllCovers();
      ui?.destroy?.();
      ui = null;
      narratorBar.destroy();
    },
  };
}
