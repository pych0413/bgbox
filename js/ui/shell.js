// ============================================================
// shell.js — startShell(app, root, { narrator }): the router and the chrome
// every screen shares. The screens themselves live in ./screens/.
//
//   pre-room   home · join · local (one-phone setup) · connecting
//   in a room  lobby → play → results   (state.room.phase)
//
// The shell is a pure function of `app.state` plus a little UI-only state
// (`route` before a room exists, form drafts). Each screen is a controller
// { el, update(state), destroy() }; the router swaps controllers when the
// target screen changes and otherwise just calls update(), so a half-typed
// name, an open palette or a playing game UI is never rebuilt by an echo.
//
// Contract notes (DESIGN §15):
//  - `startShell(app, root)` takes a third, optional argument { narrator }.
//    The shell needs the narrator to prime it inside the 開始 tap (iOS) and to
//    replay a line; main.js passes the same instance given to createApp().
//    Without it the shell falls back to `app.narrator`, then to a silent stub.
//  - The shell never speaks cues itself — the app speaks them where the
//    session runs and calls cueDone.
//  - 「返去上一局」 asks the core: app.resumeInfo() says what app.resume() would come
//    back to, app.forgetResume() drops it. Both go through the app's own store, so a
//    `?as=` testing tab (main.js) sees its own identity, never the plain one (G20).
//    The same goes for the name draft (app.prefs). Device-wide preferences (mute,
//    voice, text size, pre-flight skip) stay in plain localStorage on purpose.
//  - Games come from `app.games` (the registry). Batch-2 games (meta.batch === 2)
//    are probed once with app.game(id): if the module loads they are playable,
//    if it is missing they stay greyed out as 「即將推出」.
//  - No native dialogs (playtest #3): on the host phone a confirm() stops the room's server. sh.confirm /
//    sh.leave are the in-page arm-then-confirm (dom.js confirmTap); window.confirm itself is replaced by
//    the same thing as a safety net. The connection bar pushes the page down (body.has-netbar, #4).
// ============================================================

import { el, toast, confirmTap, installConfirmShim } from './dom.js?v=20261004005209';
import { lsGet, lsSet, keepAwake, isRoomCode } from '../core/util.js?v=20261004005209';
import * as sfxMod from '../core/sfx.js?v=20261004005209';
import { createTableTimer } from './timer.js?v=20261004005209';
import { createNightDim } from './night.js?v=20261004005209';
import { createStatus } from './status.js?v=20261004005209';
import { openSettings, applyTextSize } from './settings.js?v=20261004005209';
import { openPreflight } from './preflight.js?v=20261004005209';
import { mountHome, mountLocalSetup, mountConnecting } from './screens/home.js?v=20261004005209';
import { mountJoin } from './screens/join.js?v=20261004005209';
import { mountLobby } from './screens/lobby.js?v=20261004005209';
import { mountPlay } from './screens/play.js?v=20261004005209';
import { mountResults } from './screens/results.js?v=20261004005209';

const MUTE_KEY = 'ct:muted';             // v1 key, so the preference survives the upgrade
const NARR_KEY = 'bgb:narr';
const NAME_KEY = 'ct:name';              // v1 key; per identity (app.prefs) so ?as= tabs keep their own

// Accent colour per game for the picker, before its module (which carries
// meta.accent) has been loaded. The registry's inline meta has no colour.
const ACCENTS = {
  'cheese-thief': '#f5c518', onuw: '#8b7bff', werewolf: '#e4573d', avalon: '#4aa3ff',
  undercover: '#4ec97a', spyfall: '#2dd4bf', 'fake-artist': '#f472b6', 'draw-guess': '#fb923c',
  '9upper': '#c084fc', custom: '#2dd4bf',
};

const { sfx, setMuted, primeAudio } = sfxMod;

const silentNarrator = () => ({
  prime() {}, voices: () => [], pickDefault: () => null, set() {}, speak: () => Promise.resolve(),
  cancel() {}, hasCantonese: () => false, onVoices: () => () => {}, test: () => Promise.resolve(),
  settings: { voiceURI: null, rate: 1, volume: 1 }, supported: false,
});

async function loadRegistry(app) {
  if (Array.isArray(app.games)) return app.games;
  try {
    const m = await import('../games/registry.js?v=20261004005209');
    return Array.isArray(m.GAMES) ? m.GAMES : [];
  } catch (err) {
    console.warn('[shell] games/registry.js not available', err);
    return [];
  }
}

export async function startShell(app, root, opts = {}) {
  const narrator = opts.narrator ?? app.narrator ?? silentNarrator();
  // { id, meta (registry), ready } — `ready` is false for batch-2 games until their module proves it loads
  const catalog = (await loadRegistry(app)).map((g) => ({ id: g.id, meta: g.meta ?? { name: g.id }, ready: g.meta?.batch !== 2 }));
  const loaded = new Map();     // game id → loaded module
  const loading = new Map();    // game id → Promise
  const soundButtons = new Set();
  const host = el('main', { class: 'screen-host' });
  // The night overlay (BACKLOG #4, D1): near-black / a soft dim / opaque, fades only, never a white flash.
  const nightDim = createNightDim();
  const netbarEl = document.getElementById('netbar') ?? el('div', { class: 'netbar hidden', id: 'netbar', role: 'alert' });

  // ---------- sound: the user's toggle, plus the night-time silence on top ----------
  // G13: the night uses core/sfx's separate "suppressed" flag, so it never touches
  // (or persists over) the user's own mute. An older core without it falls back to muting.
  let userMuted = !!lsGet(MUTE_KEY, false);
  let nightMuted = false;
  const canSuppress = typeof sfxMod.setSuppressed === 'function';
  const applyMute = () => {
    if (canSuppress) { setMuted(userMuted); sfxMod.setSuppressed(nightMuted); }
    else setMuted(userMuted || nightMuted);
  };
  const paintSoundButtons = () => {
    for (const b of soundButtons) {
      b.textContent = userMuted ? '🔇' : '🔊';
      b.classList.toggle('off', userMuted);
      b.setAttribute('aria-label', userMuted ? '開聲效' : '閂聲效');
    }
  };
  applyMute();

  // narrator preferences (voice, rate) are per device
  const savedNarr = lsGet(NARR_KEY, null);
  if (savedNarr) narrator.set(savedNarr);

  // per-identity preferences go through the app's store when it has one (G20)
  const prefGet = (k, fb) => (app.prefs?.get ? app.prefs.get(k, fb) : lsGet(k, fb));
  const prefSet = (k, v) => (app.prefs?.set ? app.prefs.set(k, v) : lsSet(k, v));

  // ---------- shared services handed to every screen ----------
  const sh = {
    app, root, narrator, catalog,
    route: 'home',                                   // pre-room route: home | join | local
    cameFrom: null,                                  // key of the screen this one replaced
    drafts: { name: prefGet(NAME_KEY, '') ?? '', joinCode: [], localNames: null, joinError: '', homeError: '' },

    go(route) { sh.route = route; render(); },
    rerender() { render(); },

    /** Registry meta with the loaded module's (authoritative) meta laid over it, plus an accent. */
    gameMeta(id) {
      const e = catalog.find((c) => c.id === id);
      if (!e) return null;
      return { accent: ACCENTS[id] ?? '#f5c518', ...e.meta, ...(loaded.get(id)?.meta ?? {}) };
    },
    isReady: (id) => catalog.find((c) => c.id === id)?.ready === true,
    cached: (id) => loaded.get(id) ?? null,
    loadGame(id) {
      if (loaded.has(id)) return Promise.resolve(loaded.get(id));
      if (!loading.has(id)) {
        loading.set(id, Promise.resolve(app.game(id)).then((m) => {
          loaded.set(id, m);
          loading.delete(id);
          render();
          return m;
        }, (err) => { loading.delete(id); throw err; }));
      }
      return loading.get(id);
    },
    gamesById: () => Object.fromEntries(catalog.map((c) => [c.id, sh.gameMeta(c.id)])),

    sound: {
      isOn: () => !userMuted,
      toggle() {
        userMuted = !userMuted;
        lsSet(MUTE_KEY, userMuted);
        applyMute();
        paintSoundButtons();
        if (!userMuted) { primeAudio(); sfx('tap'); }   // the tap itself unlocks iOS audio
      },
      /**
       * Night on this phone: dimmed and silent (logic.nightChrome decides, play.js calls). `level`: 'dark'
       * (eyes-closed, between this seat's steps) · 'soft' (靜音, D1: the same readable dim on every phone, the
       * awake seat included) · 'opaque' (a shared phone — the view underneath belongs to whoever held it last, so
       * it is covered completely and swallows taps). `words`: the overlay's title + hint (one per mode, never
       * per seat). `opaque: true` is the old spelling of level 'opaque'.
       */
      night(on, { level, words = null, opaque = false } = {}) {
        nightDim.set({ on: !!on, level: level ?? (opaque ? 'opaque' : 'dark'), words });
        if (nightMuted === !!on) return;
        nightMuted = !!on;
        applyMute();
        document.body.classList.toggle('is-night', nightMuted);
      },
    },
    soundButton() {
      const b = el('button', { class: 'icon-btn sound-btn', type: 'button', onclick: () => sh.sound.toggle() });
      soundButtons.add(b);
      paintSoundButtons();
      return b;
    },

    saveNarration() { lsSet(NARR_KEY, narrator.settings); },
    saveName(name) { sh.drafts.name = name; if (name) prefSet(NAME_KEY, name); },

    /**
     * Arm-then-confirm (#3), never a native dialog: on the host's phone that would freeze the room's server.
     * `if (!sh.confirm(text, btn)) return;` — the first tap arms `btn` (「再㩒一次：…」 for ~3 s) and returns
     * false; the same tap again in time returns true. `node` may be omitted (a toast says it then); opts go to
     * dom.js confirmTap ({ key, inline, onDisarm }).
     */
    confirm: (text, node = null, opts = {}) => confirmTap(text, { node, ...opts }),

    /** 🚪 — two taps (sh.confirm) on `node`, then leave the room. Returns true once it left. */
    leave(node = null, opts = {}) {
      if (!sh.confirm('真係要離開？', node, { key: 'leave-room', ...opts })) return false;
      narrator.cancel();                            // app.leave() forgets the room's resume data itself
      try { app.leave(); } catch (err) { console.error(err); }
      sh.route = 'home';
      sh.drafts.joinError = '';
      render();
      return true;
    },

    /**
     * Resolves true once PeerJS is available, false if its script failed or took too
     * long. Multi-phone entry points await this; one-phone play never needs it.
     * NOTE for callers: do anything that needs a tap's gesture (narrator.prime) BEFORE awaiting.
     */
    whenPeer() {
      if (window.Peer) return Promise.resolve(true);
      const tag = document.getElementById('peerjs');
      if (!tag || tag.dataset.s === 'fail') return Promise.resolve(false);
      return new Promise((resolve) => {
        const done = () => resolve(!!window.Peer);
        tag.addEventListener('load', done, { once: true });
        tag.addEventListener('error', done, { once: true });
        setTimeout(done, 12000);
      });
    },
    peerMissing: '載入唔到 PeerJS，要有網絡先開得房／入得房。冇網絡可以揀「一部手機玩」。',

    roomLink(code) { return `${location.origin}${location.pathname}?r=${code}`; },

    /** What 「返去」 would come back to: { mode, code, savedAt, gameId, phase } or null (core decides). */
    readResume() {
      try { return app.resumeInfo?.() ?? null; } catch (err) { console.error(err); return null; }
    },
    clearResume() { try { app.forgetResume?.(); } catch (err) { console.error(err); } },
  };

  // ---------- services every screen shares ----------
  sh.timer = createTableTimer(sh);
  const status = createStatus(sh);
  /** ⚙️ — text size, sound, and (host) the pre-flight check. */
  sh.openSettings = (opts = {}) => openSettings(sh, {
    preflight: () => sh.openPreflight({ meta: app.state.room?.gameId ? sh.gameMeta(app.state.room.gameId) : null }),
    ...opts,
  });
  sh.openPreflight = (opts = {}) => openPreflight(sh, opts);
  sh.settingsButton = (opts) => el('button', { class: 'icon-btn sm', type: 'button', 'aria-label': '設定', onclick: () => sh.openSettings(opts) }, '⚙️');
  /** The group saved at the last start on this device: { names, colours, order } | null (BACKLOG #9). */
  sh.savedGroup = () => {
    const g = app.state.savedGroup;
    return g && typeof g === 'object' && Array.isArray(g.names) && g.names.length ? g : null;
  };

  // ---------- routing ----------
  const MOUNT = {
    home: mountHome, join: mountJoin, local: mountLocalSetup, connecting: mountConnecting,
    lobby: mountLobby, play: mountPlay, results: mountResults,
  };

  function screenKey(st) {
    // a host whose room is still being claimed on the signalling server has no code yet
    if (st.mode === 'host' && !st.code) return 'connecting';
    if (st.mode) {
      const seated = st.mode !== 'client' || (st.mySeats?.length ?? 0) > 0;
      if (seated && st.room) {
        return st.room.phase === 'playing' ? 'play' : st.room.phase === 'results' ? 'results' : 'lobby';
      }
      // a client that has dialled but not been welcomed yet: the join screen
      // owns its own progress; a resume has no screen of its own, so it gets one
      return sh.route === 'join' ? 'join' : 'connecting';
    }
    return sh.route;
  }

  let current = null;
  let queued = false;

  function mount(key) {
    try {
      const ctl = MOUNT[key](sh);
      current = { key, ctl };
      host.replaceChildren(ctl.el);
      window.scrollTo(0, 0);
    } catch (err) {
      console.error(`[shell] cannot mount ${key}`, err);
      current = { key, ctl: { el: errorCard(`${key} 畫面出咗事`, err), update() {}, destroy() {} } };
      host.replaceChildren(current.ctl.el);
    }
  }

  function render() {
    const st = app.state;
    const key = screenKey(st);
    if (!current || current.key !== key) {
      try { current?.ctl.destroy(); } catch (err) { console.error(err); }
      soundButtons.clear();   // the old screen's buttons die with it
      sh.timer.forgetScreen();
      // leaving play: nothing may stay dimmed or muted
      if (current?.key === 'play') sh.sound.night(false);
      // leaving the room altogether: no clock may keep ringing or covering the screen
      if (!st.mode) sh.timer.reset();
      sh.cameFrom = current?.key ?? null;
      mount(key);
    }
    try { current.ctl.update(st); } catch (err) { console.error(`[shell] ${key}.update failed`, err); }
    chrome(st);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; render(); });
  }

  // ---------- chrome: connection bar and wake lock ----------
  let awake = false;

  function chrome(st) {
    netbar(st);
    try { status.update(st); } catch (err) { console.error('[shell] status failed', err); }
    try { sh.timer.update(st); } catch (err) { console.error('[shell] timer failed', err); }
    const inRoom = !!st.mode;
    if (inRoom !== awake) { awake = inRoom; keepAwake(inRoom); }
  }

  // #4: the bar pushes the page (and the sticky play header with its ⋯ → 🚪) down instead of covering it;
  // body.has-netbar + --netbar-h (its measured height, safe area included) drive the CSS. A guest stuck
  // behind it for NETBAR_LEAVE_MS (the host has gone) also gets a 🚪 離開 inside the bar.
  const NETBAR_LEAVE_MS = 30_000;
  const netText = el('span', { class: 'netbar-text' });
  const netLeave = el('button', {
    class: 'btn btn-sm netbar-leave', type: 'button',
    onclick: () => sh.leave(netLeave, { onDisarm: () => schedule() }),
  }, '🚪 離開');
  netLeave.hidden = true;
  let netSince = null;
  let netTimer = null;

  function netbar(st) {
    const msg = st.mode ? connectionMessage(st) : null;
    netbarEl.classList.toggle('hidden', !msg);
    document.body.classList.toggle('has-netbar', !!msg);
    if (!msg) {
      netSince = null;
      clearTimeout(netTimer);
      netLeave.hidden = true;
      return;
    }
    if (netText.parentNode !== netbarEl) netbarEl.replaceChildren(netText, netLeave);
    netbarEl.classList.toggle('warn', msg.kind === 'warn');
    if (netText.textContent !== msg.text) netText.textContent = msg.text;
    const now = Date.now();
    netSince ??= now;
    const stuck = st.mode === 'client' && now - netSince >= NETBAR_LEAVE_MS;
    netLeave.hidden = !stuck;
    clearTimeout(netTimer);
    if (st.mode === 'client' && !stuck) netTimer = setTimeout(schedule, NETBAR_LEAVE_MS - (now - netSince) + 50);
    const h = netbarEl.offsetHeight;
    if (h > 0) document.body.style.setProperty('--netbar-h', `${h}px`);
  }

  const CONN_DEFAULT = {
    connecting: ['warn', '⏳', '連緊線…'],
    reconnecting: ['warn', '⚠️', '斷咗線，重連緊…'],
    offline: ['warn', '📡', '冇網絡，等網絡返嚟…'],
    error: ['err', '❌', '連線出咗問題，試下 refresh'],
  };

  /** The core words its own connection messages (in Cantonese); the bar adds the icon and the colour. */
  function connectionMessage(st) {
    const d = CONN_DEFAULT[st.conn];
    if (!d || (st.conn === 'connecting' && st.mode === 'local')) return null;
    return { kind: d[0], text: `${d[1]} ${st.connMessage || d[2]}` };
  }

  function errorCard(title, err) {
    return el('div', { class: 'boot' },
      el('div', { class: 'boot-emoji', text: '🧀' }),
      el('div', { text: title }),
      el('div', { class: 'boot-err', text: String(err?.message ?? err) }),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => location.reload() }, '重新載入'));
  }

  // ---------- boot ----------
  // #3 safety net: a window.confirm() anywhere (a game UI) must not freeze the host phone, which is the room's
  // server. It becomes the same arm-then-confirm on the button just tapped: false now, true on the second tap.
  installConfirmShim(window, document);

  applyTextSize();
  root.replaceChildren(host);
  document.body.append(nightDim.el, status.el);
  if (!netbarEl.isConnected) document.body.append(netbarEl);

  // deep link ?r=1352 → join screen with the code filled in
  const linked = new URLSearchParams(location.search).get('r');
  if (isRoomCode(linked)) {
    sh.drafts.joinCode = linked.split('').map(Number);
    sh.route = 'join';
    // taken once: a later refresh should land on home (with 「返去」 if we are in a room), not re-ask for this code
    // keep ?as= (testing identity) so a refresh stays the same "phone"
    const as = new URLSearchParams(location.search).get('as');
    try { history.replaceState(null, '', location.pathname + (as ? `?as=${encodeURIComponent(as)}` : '') + location.hash); } catch { /* sandboxed frame */ }
  }

  app.on('change', schedule);
  // one-line news from the core (a content bank ran out and reshuffled, a seat was handed over…)
  app.on('notice', (text, info) => {
    toast(String(text), info?.kind === 'save-failed' ? 4200 : 3200);
    if (info?.kind === 'bag-reshuffle') schedule();   // the lobby's 已用 / 總數 changed
  });

  // Batch-2 games: playable the moment their module exists, 「即將推出」 until then.
  for (const entry of catalog.filter((c) => !c.ready)) {
    Promise.resolve(app.game(entry.id)).then(
      (m) => { loaded.set(entry.id, m); entry.ready = true; },
      () => { entry.ready = false; },
    ).finally(schedule);
  }

  // (wake lock on return to the foreground: core/client.js resync() re-arms it — not here too)

  window.addEventListener('beforeunload', (e) => {
    if (app.state.isHost && app.state.room?.phase === 'playing') {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  render();
  return sh;
}

