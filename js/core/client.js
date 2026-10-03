// ============================================================
// client.js — createApp(): the ONLY object the UI talks to (DESIGN §15.3).
//
//   host   Room + Session run in this page; remote phones connect through a
//          HostTransport. This device is just another device of the Room, fed
//          in-process (no network hop).
//   local  the same Room, no transport at all (one phone holds every seat).
//          Never touches PeerJS (G18): one-phone play works with no signal.
//   client a ClientTransport; the Room's messages arrive over the wire and are
//          applied by the very same handler the host uses for itself.
//
// iOS gesture rule: every entry point that can start narration calls
// narrator.prime() as its FIRST statement, before any await.
//
// Polish-pass surface (docs/BACKLOG.md "Polish contract"), all on `app`:
//   state.room.timer            table timer (T1); app.hostCtl.timer.start/pause/resume/add/stop
//   state.narration             { mode, status: idle|speaking|stalled, line, cueId, reason } (#1)
//   app.narration.replay/skip   重講 / 跳過 for the stalled-line panel
//   act() → Promise<boolean>    resolves with "the host accepted it" after its views; rejects
//                               (err.code 'offline' | 'timeout') when it never got there (G4);
//                               state.outbox = actions still waiting for the host
//   app.resync()                also run on visibilitychange → state.resyncedAt (#5)
//   app.claimSeat(code, pid)    lost token → ask the host for the seat back; state.claimable /
//                               state.claim; host: state.room.claims + lobby.approveClaim/rejectClaim (#6)
//   state.savedGroup            last seating on this phone; lobby.applySavedOrder() (#9)
//   app.bag.stats/reset         safe on any device (null/false where there is no host bag) (#11)
//   state.versionMismatch       build stamps differ between host and a phone (G10); state.versionInfo
//   app.canNetwork()            PeerJS loaded (multi-phone needs it; local never does)
//   state.saveFailed            the host snapshot could not be written (storage full) (G9)
//   lobby.keepSeat(pid)         keep an offline lobby seat past the 180 s grace (G3)
//   hostCtl.voidRound()         `@void-round` for engines that support it
//   resumeInfo() / forgetResume()  what 「返去上一局」 would resume (read through THIS app's store, so a
//                               `?as=` testing identity sees its own), and dropping it
//   prefs.get/set               small per-identity preferences (the name draft) in the same store
//   state.pictures / keepsake() the drawing game's earlier pictures this game (kept as the ink epoch moves
//                               on), and all of them incl. the current one — the results screen's souvenir
//   state.canInk                this device's seats engine.canInk lets draw now (the narrator bar folds)
//   state.hostActions / hostCtl.hostAction(i, label)   the game's own host buttons (engine.hostActions)
//   connLog()                   the last ~40 connection events as `<UTC ISO> text` lines (⚙️ 連線記錄); no tokens
//
// Liveness (iOS locks phones and suspends pages; a dead DataChannel often never says 'close'):
//   client  a seated device pings every PING_MS while in a room — every reply (and every other message) is
//           proof of life. Nothing at all from the host for SILENT_MS → the channel is dead: close it and
//           re-dial (ClientTransport.reset); the seat tokens re-seat this device, the screen never goes back to
//           join. Back in the foreground (visibilitychange / pageshow / online): ping at once, re-dial if
//           there is no reply within PROBE_MS.
//   host    net.js times out silent phones; on the way back from hidden every phone gets a fresh window
//           (HostTransport.resume) and offline lobby seats do not lose the time this page was away
//           (room.hostBack). The signalling server is rejoined at once (same code).
// ============================================================

import { HostTransport, ClientTransport, PROTOCOL } from './transport.js?v=20261003171423';
import { hasPeer } from './net.js?v=20261003171423';
import { Room } from './room.js?v=20261003171423';
import { createBag } from './bag.js?v=20261003171423';
import { applyInkBatch, emptyInk, normalizeInk } from './session.js?v=20261003171423';
import { cryptoRng } from './engine-kit.js?v=20261003171423';
import { makeStore, uid, keepAwake, isRoomCode, connLog as pageLog } from './util.js?v=20261003171423';
import { GAMES } from '../games/registry.js?v=20261003171423';

const RESUME_TTL = 8 * 60 * 60 * 1000;     // a night of games
const WELCOME_TIMEOUT = 12_000;
const LEAVE_GRACE = 200;                   // let the goodbye reach the wire before closing
const ACK_TIMEOUT = 4000;                  // an action the host has not confirmed by now did not get there (G4)
const NARR_START_MS = 1500;                // speech that has not started by now is "stalled" (#1)
const PING_MS = 4000;                      // a seated client pings the host this often: clock sync + proof of life
const SILENT_MS = 12_000;                  // nothing at all from the host for this long = the channel is dead → re-dial
const PROBE_MS = 3000;                     // back in the foreground: no reply to a fresh ping by then → re-dial
const SNAP_SOFT_MAX = 1_500_000;           // JSON chars; past this the drawing is left out of the snapshot (G9)
const PICTURES_MAX = 24;                   // earlier pictures kept for the results screen's keepsake
const NOT_HOST = { ok: false, message: '淨係房主先做到呢樣' };
const NO_PEER = '多部手機玩要上網 — 連線元件載入唔到。冇網絡可以揀「一部手機玩」。';

function emptyRoom() {
  return {
    phase: 'lobby', players: [], gameId: null, config: {}, configSummary: [],
    configValid: { ok: false, message: '未揀遊戲', warnings: [] },
    scoreboard: {}, history: [], narration: { mode: 'voice' }, paused: false,
    stalled: [], lastResult: null, loading: null,
    timer: null, claims: [], versionMismatch: [], singleDevice: false,
  };
}

const idleNarration = (mode = 'voice') => ({ mode, status: 'idle', line: null, cueId: null, reason: null });

/**
 * This build's stamp (G10): the `?v=` of js/main.js — every import carries the same stamp
 * (tools/bump-version.sh), so this module's own URL is the fallback (and what Node tests see).
 */
function detectBuild() {
  try {
    const tag = globalThis.document?.querySelector?.('script[src*="js/main.js"]');
    const v = tag ? new URL(tag.getAttribute('src'), globalThis.location?.href).searchParams.get('v') : null;
    if (v) return v;
  } catch { /* no DOM */ }
  try { return new URL(import.meta.url).searchParams.get('v') ?? ''; } catch { return ''; }
}

/** How two build stamps relate. null when they match (or ours is unknown). */
export function compareBuilds(mine, theirs) {
  const a = String(mine ?? '');
  const b = String(theirs ?? '');
  if (!a || a === b) return null;
  let newer = 'unknown';
  if (!b) newer = 'mine';                                   // a peer from before stamps were sent
  else if (/^\d+$/.test(a) && /^\d+$/.test(b)) newer = Number(a) > Number(b) ? 'mine' : 'theirs';
  return { mine: a, theirs: b, newer, refreshMe: newer !== 'mine' };
}

const safeJSON = (x) => { try { return JSON.stringify(x); } catch { return null; } };

/**
 * @param {object}  [opts]
 * @param {object}  [opts.narrator]       createNarrator() — optional; without it voice mode paces cues by minMs
 * @param {*}       [opts.storage]        Web-Storage-like, Map, or omitted (localStorage)
 * @param {Function}[opts.now]            () => ms; wall clock (default Date.now)
 * @param {Function}[opts.rng]            () => [0,1) (default crypto)
 * @param {Array}   [opts.registry]       game list (default GAMES)
 * @param {Function}[opts.makeHostNet]    () => HostNet-like   (tests inject an in-memory net)
 * @param {Function}[opts.makeClientNet]  () => ClientNet-like
 * @param {object}  [opts.timers]         { setTimeout, clearTimeout, setInterval, clearInterval }
 * @param {number}  [opts.saveEveryMs]    host snapshot heartbeat (default 5000)
 * @param {object}  [opts.banks]          extra content banks for the bag (tests)
 * @param {string}  [opts.build]          build stamp override (tests); default: detected
 * @param {object}  [opts.connLog]        makeConnLog() — where connection events go (default: this page's util.connLog)
 */
export function createApp(opts = {}) {
  const {
    narrator = null, storage, now = () => Date.now(), rng = cryptoRng(), registry = GAMES,
    makeHostNet, makeClientNet, saveEveryMs = 5000, banks,
  } = opts;
  const BUILD = String(opts.build ?? detectBuild());
  const T = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    ...(opts.timers ?? {}),
  };
  const store = makeStore(storage);
  const listeners = { change: new Set(), notice: new Set() };
  const log = opts.connLog ?? pageLog;
  const note = (text) => { try { log.add(text); } catch { /* the log is a nicety */ } };
  const secs = (ms) => `${Math.round(ms / 100) / 10} s`;

  // ---------- state ----------
  const state = {
    mode: null, conn: 'idle', connMessage: '',
    code: null, isHost: false, deviceId: '',
    mySeats: [], activeSeat: null,
    room: emptyRoom(), views: {}, table: null, focus: null, cue: null,
    ink: emptyInk(), rev: 0,
    pictures: [],             // earlier pictures of this game ([{ epoch, strokes }]); the current one is `ink`
    canInk: [],               // this device's seats that may draw right now (engine.canInk)
    hostActions: [],          // host: the game's own extra buttons right now ([{ i, label }], engine.hostActions)
    // polish pass
    narration: idleNarration(),
    outbox: 0,
    resyncedAt: 0,
    build: BUILD,
    versionMismatch: false,
    versionInfo: null,
    savedGroup: Room.readGroup(store),
    claimable: null,          // { code, pid, name } — the last join was refused because this seat is ours but offline
    claim: null,              // { code, pid, name, status: 'sending' | 'waiting' } while asking for a seat back
    saveFailed: false,
  };
  state.deviceId = store.get('bgb:device') || uid('d');
  store.set('bgb:device', state.deviceId);

  let room = null;                 // host / local
  let hostT = null;                // HostTransport
  let clientT = null;              // ClientTransport
  let seatRecs = [];               // client: [{ name, token?, id? }] sent in every hello
  let welcomeWaiter = null;
  let claimWaiter = null;
  let heartbeat = null;
  let clockTimer = null;
  let clockOffset = 0;
  let clockSamples = [];
  let pendingHostMsgs = null;
  let resyncPending = false;
  let lastRx = 0;                  // client: when anything last arrived from the host (heartbeat)
  let watchFrom = 0;               // client: the heartbeat window opens at the later of lastRx and this (a (re)start of pinging)
  let lastTick = 0;                // client: when the ping loop last ran (a late tick = this page's timers were frozen)
  let probeTimer = null;           // client: a wake-up ping's deadline
  let pageHidden = !!globalThis.document?.hidden;
  let hiddenAt = 0;

  const bag = createBag({ storage, rng, banks, onNotice: (text, info) => emit('notice', text, info) });
  const gameCache = new Map();

  // ---------- events ----------
  function emit(ev, ...args) {
    for (const fn of [...listeners[ev]]) { try { fn(...args); } catch (e) { console.error(`[app] ${ev} listener threw`, e); } }
  }
  let touched = false;
  function touch() {
    if (touched) return;
    touched = true;
    queueMicrotask(() => { touched = false; emit('change', state); });
  }
  const isHostish = () => (state.mode === 'host' || state.mode === 'local') && !!room;

  function setConn(conn, message = '') {
    if (conn !== state.conn || message !== state.connMessage) note(`conn ${state.conn} → ${conn}${message ? ` (${message})` : ''}`);
    state.conn = conn;
    state.connMessage = message;
    if (conn !== 'online') failOutbox('offline');
    touch();
  }

  // ---------- games ----------
  function game(id) {
    let p = gameCache.get(id);
    if (!p) {
      const entry = registry.find((g) => g.id === id);
      if (!entry) return Promise.reject(new Error(`unknown game: ${id}`));
      p = Promise.resolve().then(() => entry.load()).then((mod) => mod?.default ?? mod);
      gameCache.set(id, p);
      p.catch(() => gameCache.delete(id));
    }
    return p;
  }

  // ---------- narration (host / local only) ----------
  let speakToken = 0;
  let speaking = false;
  let narrationTimer = null;
  let startWatch = null;

  function setNarration(patch) {
    const n = state.narration;
    if (Object.keys(patch).every((k) => n[k] === patch[k])) return;
    state.narration = { ...n, ...patch };
    touch();
  }
  const narrationIdle = () => setNarration({ status: 'idle', line: null, cueId: null, reason: null });

  function narrationStop() {
    speakToken++;
    if (narrationTimer !== null) { T.clearTimeout(narrationTimer); narrationTimer = null; }
    if (startWatch !== null) { T.clearTimeout(startWatch); startWatch = null; }
    if (speaking) {
      speaking = false;
      try { narrator?.cancel?.(); } catch { /* narrator is optional garnish */ }
    }
    narrationIdle();
  }

  /**
   * Voice mode: speak the cue, wait out its minMs, then tell the session it is done.
   * Watchdog (#1): no onstart within NARR_START_MS, the narrator's length timeout, volume 0 or no
   * narrator at all → state.narration.status = 'stalled' (the host sees the line big, with
   * 重講 / 跳過 / 下一步). The cue still completes on the fallback timer, so the table never freezes.
   */
  function narrate(cue) {
    narrationStop();
    const token = speakToken;
    const started = now();
    let heard = false;
    setNarration({ status: 'speaking', line: cue.text, cueId: cue.id, reason: null });

    const finish = (how) => {
      if (token !== speakToken) return;
      speaking = false;
      if (startWatch !== null) { T.clearTimeout(startWatch); startWatch = null; }
      if (how === 'timeout' || how === 'error' || how === 'unsupported') {
        if (state.narration.status !== 'stalled') setNarration({ status: 'stalled', reason: how });
      } else if (state.narration.status === 'speaking') {
        setNarration({ status: 'idle', reason: null });
      }
      const wait = Math.max(0, (cue.minMs ?? 0) - (now() - started));
      narrationTimer = T.setTimeout(() => {
        narrationTimer = null;
        if (token !== speakToken) return;
        room?.cueDone(cue.id);
        if (token === speakToken) narrationIdle();
      }, wait);
    };

    if (!narrator?.speak) {
      setNarration({ status: 'stalled', reason: 'unsupported' });
      finish('none');
      return;
    }
    const vol = narrator.settings?.volume;
    if (typeof vol === 'number' && vol <= 0) setNarration({ status: 'stalled', reason: 'muted' });
    startWatch = T.setTimeout(() => {
      startWatch = null;
      if (token === speakToken && speaking && !heard && state.narration.status !== 'stalled') {
        setNarration({ status: 'stalled', reason: 'nostart' });
      }
    }, NARR_START_MS);

    const hooks = {
      onstart: () => {
        if (token !== speakToken) return;
        heard = true;
        if (startWatch !== null) { T.clearTimeout(startWatch); startWatch = null; }
        if (state.narration.reason !== 'muted') setNarration({ status: 'speaking', reason: null });
      },
    };
    let p;
    try { speaking = true; p = narrator.speak(cue.text, hooks); } catch { speaking = false; p = null; }
    Promise.resolve(p).then((how) => finish(typeof how === 'string' ? how : 'end'), () => finish('error'));
  }

  function onCue(cue, info) {
    if (!room) return;
    if (room.narration.mode === 'voice') narrate(cue, info);
    else narrationStop();
  }

  // ---------- host persistence ----------
  const hostKey = (code) => `bgb:host:${code ?? 'local'}`;
  const withoutInk = (snap) => ({ ...snap, session: { ...snap.session, ink: emptyInk(snap.session.ink?.epoch ?? 0) } });

  /** Write the snapshot; drop the drawing first if it is huge or the write fails (G9). */
  function saveNow() {
    if (!isHostish()) return;
    const key = hostKey(room.code);
    let snap = room.snapshot();
    const hasInk = () => (snap.session?.ink?.strokes?.length ?? 0) > 0;
    let json = safeJSON(snap);
    if (json && json.length > SNAP_SOFT_MAX && hasInk()) { snap = withoutInk(snap); json = safeJSON(snap); }
    let ok = !!json && store.setRaw(key, json);
    if (!ok) {
      store.del(key);                         // never leave an OLD snapshot behind for a later resume to pick up
      if (hasInk()) { snap = withoutInk(snap); json = safeJSON(snap); }
      ok = !!json && store.setRaw(key, json);
    }
    store.set('bgb:resume', { mode: state.mode, code: room.code, savedAt: now(), gameId: room.gameId ?? null, phase: room.phase });
    if (!ok && !state.saveFailed) {
      state.saveFailed = true;
      emit('notice', '部手機儲存空間唔夠 — 呢局如果 refresh 咗可能救唔返', { kind: 'save-failed' });
      touch();
    } else if (ok && state.saveFailed) {
      state.saveFailed = false;
      touch();
    }
  }
  let saveQueued = false;
  function queueSave() {
    if (saveQueued) return;
    saveQueued = true;
    queueMicrotask(() => { saveQueued = false; saveNow(); });
  }

  function onRoomChange() {
    if (room && room.phase !== 'playing') narrationStop();
    queueSave();
  }

  /** A new room replaces the previous one on this phone: its snapshot is dead weight in a 5 MB store. */
  function forgetPreviousHostSnapshot() {
    const r = store.get('bgb:resume');
    if (r && (r.mode === 'host' || r.mode === 'local')) store.del(hostKey(r.code));
  }

  // ---------- applying messages (host's own device and clients alike) ----------
  function ensureActive() {
    if (!state.mySeats.includes(state.activeSeat)) state.activeSeat = state.mySeats[0] ?? null;
  }

  function applyViews(v, { fresh = false } = {}) {
    if (!v) return;
    if (!fresh && typeof v.rev === 'number' && v.rev < state.rev) return;   // stale
    state.rev = v.rev ?? state.rev;
    state.views = v.bySeat && typeof v.bySeat === 'object' ? v.bySeat : {};
    state.table = v.table ?? null;
    state.focus = v.focus ?? null;
    state.canInk = Array.isArray(v.canInk) ? v.canInk.filter((pid) => state.mySeats.includes(pid)) : [];
    if ('cue' in v) state.cue = v.cue ?? null;
    if ('hostActions' in v) state.hostActions = Array.isArray(v.hostActions) ? v.hostActions : [];
    if (state.mode === 'client' && typeof v.hostNow === 'number' && !clockSamples.length) clockOffset = v.hostNow - now();
    touch();
  }

  function applyRoom(r) {
    const wasPlaying = state.room.phase === 'playing';
    state.room = { ...emptyRoom(), ...r };
    // a new game began: the last one's souvenir pictures are history (its blank inkSync came first)
    if (state.room.phase === 'playing' && !wasPlaying && state.pictures.length) state.pictures = [];
    const mode = state.room.narration?.mode ?? 'voice';
    if (state.narration.mode !== mode) setNarration({ mode });
    if (isHostish()) {
      // the host learns about mismatched phones from its own room view
      const list = Array.isArray(state.room.versionMismatch) ? state.room.versionMismatch : [];
      if (list.length) {
        const newer = list.find((x) => compareBuilds(BUILD, x.build)?.newer === 'theirs');
        const info = compareBuilds(BUILD, (newer ?? list[0]).build) ?? { mine: BUILD, theirs: '', newer: 'unknown', refreshMe: false };
        state.versionInfo = { ...info, seats: list.map((x) => x.pid) };
        state.versionMismatch = true;
      } else if (state.versionMismatch) {
        state.versionMismatch = false;
        state.versionInfo = null;
      }
    }
  }

  function onWelcome(msg) {
    if (state.mode === 'client' && msg.v !== PROTOCOL) {
      fatal('版本唔同，兩邊都 refresh 一下個頁面', { keepSeats: true });
      return;
    }
    if (typeof msg.device === 'string' && msg.device) {
      state.deviceId = msg.device;
      store.set('bgb:device', msg.device);
    }
    const seats = Array.isArray(msg.seats) ? msg.seats : [];
    state.mySeats = seats.map((s) => s.id);
    ensureActive();
    applyRoom(msg.room);
    applyViews(msg.views, { fresh: true });
    if (state.mode === 'client') {
      seatRecs = seats.map((s) => ({ id: s.id, name: s.name, token: s.token }));
      store.set(`bgb:seats:${state.code}`, seatRecs);
      store.set('bgb:resume', { mode: 'client', code: state.code, savedAt: now(), gameId: state.room.gameId ?? null, phase: state.room.phase });
      const info = compareBuilds(BUILD, typeof msg.build === 'string' ? msg.build : '');
      state.versionMismatch = !!info;
      state.versionInfo = info;
      state.claim = null;
      state.claimable = null;
      setConn('online');
      if (clockTimer === null) startClock();
    }
    if (resyncPending) { resyncPending = false; state.resyncedAt = now(); }
    welcomeWaiter?.resolve();
    welcomeWaiter = null;
    claimWaiter?.resolve();
    claimWaiter = null;
    touch();
  }

  const copyStrokes = (strokes) => strokes.map((s) => ({ ...s, pts: Array.isArray(s.pts) ? s.pts.slice() : [] }));

  /** The drawing is about to be replaced by a new picture (epoch moved on) mid-game: keep it for the results screen. */
  function keepPicture() {
    if (state.room.phase !== 'playing' || !state.ink.strokes.length) return;
    state.pictures = [...state.pictures, { epoch: state.ink.epoch, strokes: copyStrokes(state.ink.strokes) }].slice(-PICTURES_MAX);
  }

  /** Every picture of this (or the game just finished): the earlier ones, then the current drawing. Copies. */
  function keepsake() {
    const all = state.pictures.map((p) => ({ epoch: p.epoch, strokes: copyStrokes(p.strokes) }));
    if (state.ink.strokes.length && state.room.phase !== 'lobby') all.push({ epoch: state.ink.epoch, strokes: copyStrokes(state.ink.strokes) });
    return all;
  }

  function handleMessage(msg) {
    switch (msg?.t) {
      case 'welcome': onWelcome(msg); break;
      case 'room':
        applyRoom(msg.room);
        if (state.room.phase === 'lobby') {
          if (state.ink.strokes.length) state.ink = emptyInk();
          if (state.pictures.length) state.pictures = [];
        }
        touch();
        break;
      case 'views': applyViews(msg); break;
      case 'ack': settleOutbox(msg.id, (o) => o.resolve(!!msg.ok)); break;
      case 'ink':
        applyInkBatch(state.ink, msg);
        state.ink = { epoch: state.ink.epoch, strokes: state.ink.strokes };
        touch();
        break;
      case 'inkSync':
        if (msg.ink && Array.isArray(msg.ink.strokes)) {
          const epoch = msg.ink.epoch ?? 0;
          if (epoch !== state.ink.epoch) keepPicture();
          state.ink = { epoch, strokes: msg.ink.strokes };
          touch();
        }
        break;
      case 'pong': onPong(msg); break;
      case 'notice': if (msg.text) emit('notice', String(msg.text)); break;
      case 'claimWait':
        if (state.mode === 'client' && state.claim) {
          const name = String(msg.name ?? state.claim.name ?? '');
          state.claim = { ...state.claim, pid: String(msg.pid ?? state.claim.pid), name, status: 'waiting' };
          setConn('connecting', `等緊房主批准你做返「${name}」…`);
          claimWaiter?.resolve();
          claimWaiter = null;
        }
        break;
      case 'reject':
        if (state.mode !== 'client') break;
        if (msg.claimable && typeof msg.claimable.pid === 'string') {
          state.claimable = { code: state.code, pid: msg.claimable.pid, name: String(msg.claimable.name ?? '') };
        }
        fatal(String(msg.reason || '連唔到房'), { clearSeats: true });
        break;
      default: break;
    }
  }

  /** The host will not have us. Stop retrying, remember why. */
  function fatal(reason, { clearSeats = false, keepSeats = false } = {}) {
    if (!clientT) return;   // already failed; messages still in flight must not overwrite the first reason
    if (clearSeats && !keepSeats && state.code) {
      store.del(`bgb:seats:${state.code}`);
      store.del('bgb:resume');
    }
    stopClock();
    const t = clientT;
    clientT = null;
    try { t?.close(); } catch { /* already gone */ }
    state.claim = null;
    setConn('error', reason);
    welcomeWaiter?.reject(new Error(reason));
    welcomeWaiter = null;
    claimWaiter?.reject(new Error(reason));
    claimWaiter = null;
  }

  // ---------- actions with acknowledgement (G4) ----------
  let actSeq = 0;
  const outbox = new Map();        // id → { resolve, reject, timer }

  function actError(code) {
    const e = new Error(code === 'timeout' ? '冇送到 — 房主冇回應' : '冇送到 — 重連緊');
    e.code = code;
    return e;
  }
  function settleOutbox(id, fn) {
    const o = outbox.get(id);
    if (!o) return;
    outbox.delete(id);
    T.clearTimeout(o.timer);
    state.outbox = outbox.size;
    touch();
    fn(o);
  }
  function failOutbox(code) {
    for (const id of [...outbox.keys()]) settleOutbox(id, (o) => o.reject(actError(code)));
  }

  // ---------- clock ----------
  function onPong(msg) {
    if (typeof msg.c !== 'number' || typeof msg.hostNow !== 'number') return;
    const rtt = now() - msg.c;
    if (!(rtt >= 0)) return;
    clockSamples.push({ rtt, offset: msg.hostNow - (msg.c + rtt / 2) });
    if (clockSamples.length > 8) clockSamples.shift();
    clockOffset = clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
  }

  /**
   * The ping loop (client, while in a room): four quick pings to learn the clock, then one every PING_MS.
   * Every ping carries `hb` (the host may then time this device out after 15 s of silence; an older host
   * ignores it). Any message from the host is proof of life; none for SILENT_MS → channelDead().
   */
  function startClock() {
    stopClock();
    let n = 0;
    lastTick = watchFrom = now();
    const tick = () => {
      clockTimer = null;
      if (!clientT) return;
      const t = now();
      const late = t - lastTick > PING_MS * 2.5;     // this page's timers were frozen (locked, suspended): not the host's fault
      lastTick = t;
      if (late) {
        watchFrom = t;
        probe('timers resumed');
      } else if (state.mySeats.length && t - Math.max(lastRx, watchFrom) > SILENT_MS) {
        channelDead(`heard nothing from the host for ${secs(t - Math.max(lastRx, watchFrom))}`);
        return;
      } else {
        clientT.send({ t: 'ping', c: t, hb: 1 });
      }
      n++;
      clockTimer = T.setTimeout(tick, n < 4 ? 250 : PING_MS);
    };
    tick();
  }
  function stopClock() {
    if (clockTimer !== null) { T.clearTimeout(clockTimer); clockTimer = null; }
    if (probeTimer !== null) { T.clearTimeout(probeTimer); probeTimer = null; }
  }

  /** The channel is dead (open or not): drop it and re-dial now. The seat tokens re-seat this device; no join screen. */
  function channelDead(why) {
    if (!clientT) return;
    stopClock();
    note(`client: heartbeat timeout — ${why} → re-dial`);
    setConn('reconnecting', '同房主斷咗，重連緊…');
    clientT.reset(why);
  }

  /** Back in the foreground (or the network returned): is the channel still alive? Ping now, verdict in PROBE_MS. */
  function probe(reason) {
    if (state.mode !== 'client' || !clientT || !state.mySeats.length) return;
    clientT.nudge(reason);                      // no channel: dial now, not in up to 6 s; signalling lost: rejoin it now
    if (state.conn !== 'online') return;         // a re-dial is under way; its own heartbeat watches it
    const sentAt = now();
    clientT.send({ t: 'ping', c: sentAt, hb: 1 });
    if (probeTimer !== null) T.clearTimeout(probeTimer);
    probeTimer = T.setTimeout(() => {
      probeTimer = null;
      if (clientT && state.conn === 'online' && lastRx < sentAt) channelDead(`no reply ${secs(PROBE_MS)} after ${reason}`);
    }, PROBE_MS);
  }

  // ---------- delivery from the Room ----------
  /** Room → device. The host's own device is delivered in-process; everyone else over the wire. */
  function deliver(deviceId, msg, peerId) {
    if (peerId == null && (deviceId === state.deviceId || deviceId == null)) { handleMessage(msg); return; }
    hostT?.send(peerId, msg);
  }

  function roomDeps(extra = {}) {
    const savedMode = store.get('bgb:narration')?.mode;
    const mode = ['voice', 'read', 'silent'].includes(savedMode) ? savedMode : 'voice';
    return {
      hostDeviceId: state.deviceId, now, rng, bag, timers: T, store, build: BUILD,
      loadGame: game, send: deliver, onCue, onChange: onRoomChange,
      onNotice: (text) => emit('notice', text),
      onGroup: (group) => { state.savedGroup = group; touch(); },
      narrationMode: narrator ? mode : 'silent',
      ...extra,
    };
  }

  function beginHosting() {
    state.isHost = true;
    keepAwake(true);
    heartbeat = T.setInterval(saveNow, saveEveryMs);
    room.welcome(state.deviceId);
    saveNow();
  }

  function wireHost(t) {
    // every handler checks it is still THE transport: a superseded one must never feed a newer room
    t.on('message', (peerId, msg) => {
      if (hostT !== t) return;
      if (!room) { pendingHostMsgs?.push([peerId, msg]); return; }
      room.receive(peerId, msg);
    });
    t.on('close', (peerId) => { if (hostT === t) room?.peerClosed(peerId); });
    t.on('status', (kind) => {
      if (hostT !== t) return;
      if (kind === 'online') setConn('online');
      else if (kind === 'reconnecting') setConn('reconnecting', '同 signalling server 斷咗，重連緊…');
      else setConn('error', '連線出咗問題，試下 refresh');
    });
  }

  function drainPending() {
    const q = pendingHostMsgs ?? [];
    pendingHostMsgs = null;
    for (const [peerId, msg] of q) room?.receive(peerId, msg);
  }

  // ---------- teardown ----------
  function resetState() {
    Object.assign(state, {
      mode: null, conn: 'idle', connMessage: '', code: null, isHost: false,
      mySeats: [], activeSeat: null, room: emptyRoom(), views: {}, table: null, focus: null, cue: null,
      ink: emptyInk(), rev: 0, pictures: [], canInk: [], hostActions: [],
      narration: idleNarration(), outbox: 0, versionMismatch: false, versionInfo: null, claim: null, saveFailed: false,
    });
    seatRecs = [];
    clockOffset = 0;
    clockSamples = [];
    resyncPending = false;
  }

  /**
   * Bumped by every teardown. An async entry point (host / join / claimSeat / resume) notes it before its
   * first await and checks it after each one: if the user left — or started something else — meanwhile,
   * it closes what it made and touches nothing (no zombie room, no PeerJS id left claimed).
   */
  let generation = 0;

  function teardown({ graceful = false } = {}) {
    generation++;
    narrationStop();
    stopClock();
    failOutbox('offline');
    if (heartbeat !== null) { T.clearInterval(heartbeat); heartbeat = null; }
    welcomeWaiter?.reject(new Error('cancelled'));
    welcomeWaiter = null;
    claimWaiter?.reject(new Error('cancelled'));
    claimWaiter = null;
    pendingHostMsgs = null;
    const closing = [hostT, clientT].filter(Boolean);
    hostT = null;
    clientT = null;
    if (room) { room.dispose(); room = null; }
    for (const t of closing) {
      if (graceful) T.setTimeout(() => { try { t.close(); } catch { /* gone */ } }, LEAVE_GRACE);
      else { try { t.close(); } catch { /* gone */ } }
    }
    resetState();
  }

  /** Multi-phone rooms need PeerJS (or an injected net). One-phone play never asks. */
  const canNetwork = () => !!(makeHostNet && makeClientNet) || hasPeer();

  function noNetwork() {
    const err = new Error(NO_PEER);
    err.code = 'no-peer';
    return err;
  }

  // ============================================================
  // entry points
  // ============================================================

  /** Create a P2P room. The first name is the host's own seat; more names are extra seats on this phone. */
  async function host({ names = [] } = {}) {
    narrator?.prime?.();
    if (!makeHostNet && !hasPeer()) { teardown(); setConn('error', NO_PEER); throw noNetwork(); }
    teardown();
    const gen = generation;
    state.claimable = null;
    state.mode = 'host';
    setConn('connecting', '開緊房…');
    let t = null;
    try {
      pendingHostMsgs = [];
      t = hostT = new HostTransport(makeHostNet?.(), { log: note });
      wireHost(t);
      const code = await t.open(null);
      if (gen !== generation) { try { t.close(); } catch { /* gone */ } return null; }   // left meanwhile
      forgetPreviousHostSnapshot();
      state.code = code;
      room = new Room(roomDeps({ code, names }));
      beginHosting();
      drainPending();
      setConn('online');
      return code;
    } catch (err) {
      console.error(err);
      if (gen !== generation) { try { t?.close(); } catch { /* gone */ } throw err; }   // not ours to tear down any more
      const msg = `開唔到房：${err?.type || err?.message || '未知錯誤'}。試下 refresh 或者換個網絡。`;
      teardown();
      setConn('error', msg);
      throw err;
    }
  }

  /** The whole game on this phone, no network (never touches PeerJS). */
  function local({ names = [] } = {}) {
    narrator?.prime?.();
    teardown();
    state.claimable = null;
    forgetPreviousHostSnapshot();
    state.mode = 'local';
    room = new Room(roomDeps({ code: null, names }));
    beginHosting();
    setConn('online');
  }

  function buildHelloSeats(code, names) {
    const saved = store.get(`bgb:seats:${code}`, []);
    const savedList = Array.isArray(saved) ? saved.filter((s) => s && typeof s.token === 'string') : [];
    const want = names.map((n) => String(n ?? '').trim()).filter(Boolean);
    if (!want.length) return savedList.map((s) => ({ id: s.id, name: s.name, token: s.token }));
    return want.map((name) => {
      const s = savedList.find((x) => x.name === name);
      return s ? { id: s.id, name, token: s.token } : { name };
    });
  }

  function sendHello() {
    clientT?.send({
      t: 'hello', v: PROTOCOL, build: BUILD, deviceId: state.deviceId,
      seats: seatRecs.map((s) => ({ name: s.name, ...(s.token ? { token: s.token } : {}) })),
    });
  }

  function sendClaim() {
    if (!state.claim) return;
    clientT?.send({ t: 'claim', v: PROTOCOL, build: BUILD, deviceId: state.deviceId, pid: state.claim.pid });
  }

  /**
   * Every (re)connect: seated devices say hello again (and start pinging: a channel that opened but whose
   * host never answers is caught by the heartbeat too); a device still asking for its seat re-asks.
   */
  function onClientOpen() {
    lastRx = now();
    if (seatRecs.length) { sendHello(); startClock(); }
    else if (state.claim) sendClaim();
  }

  function onClientStatus(kind) {
    if (!clientT) return;
    if (kind === 'online') { if (!state.mySeats.length && !state.claim) setConn('connecting', '入緊房…'); }
    else if (kind === 'host-gone') { stopClock(); setConn('reconnecting', '揾唔到房主 — 佢可能熄咗個頁面'); }
    else if (kind === 'offline' || kind === 'reconnecting') { stopClock(); setConn('reconnecting', '同房主斷咗，重連緊…'); }
    else { stopClock(); setConn('error', '連線出咗問題'); }
  }

  function openClient(code) {
    const t = new ClientTransport(makeClientNet?.(), { log: note });
    clientT = t;
    // a transport that was closed (leave, a new join) must never write into the next session's state
    t.on('rx', () => { if (clientT === t) lastRx = now(); });
    t.on('message', (msg) => { if (clientT === t) handleMessage(msg); });
    t.on('status', (kind) => { if (clientT === t) onClientStatus(kind); });
    t.on('open', () => { if (clientT === t) onClientOpen(); });
    return t.connect(code);
  }

  /** Wait for `waiter` (a promise settled by a host message), or give up after WELCOME_TIMEOUT. */
  async function within(waiter) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = T.setTimeout(() => reject(new Error('房主冇回應，等咗好耐')), WELCOME_TIMEOUT); });
    try { await Promise.race([waiter, timeout]); } finally { T.clearTimeout(timer); }
  }

  /** Join a room with one or more seats on this device. Resolves once the host has seated us. */
  async function join(code, { names = [] } = {}) {
    const c = String(code ?? '').trim();
    if (!isRoomCode(c)) throw new Error('房間號碼係 4 粒骰（1-6）');
    if (!makeClientNet && !hasPeer()) { teardown(); setConn('error', NO_PEER); throw noNetwork(); }
    teardown();
    state.claimable = null;
    state.mode = 'client';
    state.code = c;
    seatRecs = buildHelloSeats(c, names);
    if (!seatRecs.length) {
      resetState();
      throw new Error('填返個名先');
    }
    setConn('connecting', `連緊 ${c.split('').join('-')} …`);
    const gen = generation;
    try {
      const welcomed = new Promise((resolve, reject) => { welcomeWaiter = { resolve, reject }; });
      welcomed.catch(() => { /* surfaced through the awaited race below */ });
      await openClient(c);
      await within(welcomed);
      keepAwake(true);
    } catch (err) {
      console.error(err);
      if (gen !== generation) throw err;   // cancelled: the user left or started something else; leave that alone
      const msg = state.connMessage && state.conn === 'error' ? state.connMessage : (err?.message || '入唔到房 — 睇下啲骰啱唔啱，房主係咪仲開緊個頁面。');
      teardown();
      setConn('error', msg);
      throw err;
    }
  }

  /**
   * #6 — this phone lost its token (new tab, cleared storage) and its old seat is offline in the room.
   * Ask the host for it back. Resolves { ok: true, status: 'waiting' } once the host has the request
   * (state.claim.status === 'waiting', the host sees it in state.room.claims); when the host approves,
   * a normal welcome seats this phone. A refusal arrives as a reject (state.conn 'error').
   */
  async function claimSeat(code, pid) {
    const c = String(code ?? '').trim();
    if (!isRoomCode(c)) throw new Error('房間號碼係 4 粒骰（1-6）');
    if (typeof pid !== 'string' || !pid) throw new Error('揀返你個位先');
    if (!makeClientNet && !hasPeer()) { teardown(); setConn('error', NO_PEER); throw noNetwork(); }
    const known = state.claimable?.pid === pid ? state.claimable : null;
    teardown();
    state.claimable = null;
    state.mode = 'client';
    state.code = c;
    state.claim = { code: c, pid, name: known?.name ?? '', status: 'sending' };
    setConn('connecting', '問緊房主…');
    const gen = generation;
    try {
      const asked = new Promise((resolve, reject) => { claimWaiter = { resolve, reject }; });
      asked.catch(() => { /* surfaced through the awaited race below */ });
      await openClient(c);
      await within(asked);
      keepAwake(true);
      return { ok: true, status: state.mySeats.length ? 'approved' : 'waiting' };
    } catch (err) {
      console.error(err);
      if (gen !== generation) throw err;   // cancelled meanwhile (取消): nothing of ours left to tear down
      const msg = state.connMessage && state.conn === 'error' ? state.connMessage : (err?.message || '問唔到房主');
      teardown();
      setConn('error', msg);
      throw err;
    }
  }

  /**
   * Come back after a refresh: the host's own snapshot, or this device's seat tokens. false if there is nothing
   * to resume; null if the user left (取消) while it was still reconnecting.
   */
  async function resume() {
    const r = store.get('bgb:resume');
    if (!r || typeof r !== 'object' || now() - (r.savedAt ?? 0) > RESUME_TTL) return false;

    if (r.mode === 'client') {
      if (!isRoomCode(r.code)) return false;
      const saved = store.get(`bgb:seats:${r.code}`, []);
      if (!Array.isArray(saved) || !saved.length) return false;
      await join(r.code, { names: [] });
      return true;
    }

    if (r.mode === 'host' || r.mode === 'local') {
      const snap = store.get(hostKey(r.code));
      if (!snap || snap.v !== 2) return false;
      if (r.mode === 'host' && !makeHostNet && !hasPeer()) { setConn('error', NO_PEER); throw noNetwork(); }
      teardown();
      const gen = generation;
      state.mode = r.mode;
      state.deviceId = snap.hostDeviceId || state.deviceId;
      store.set('bgb:device', state.deviceId);
      setConn('connecting', '恢復緊房間…');
      let restored = null;
      let t = null;
      const abandon = () => { try { restored?.dispose(); } catch { /* gone */ } try { t?.close(); } catch { /* gone */ } return null; };   // null = cancelled (not "nothing to resume")
      try {
        restored = await Room.restore(snap, roomDeps({ code: snap.code ?? null }));
        if (gen !== generation) return abandon();          // left meanwhile (取消): this restore is nobody's
        room = restored;
        if (r.mode === 'host') {
          pendingHostMsgs = [];
          t = hostT = new HostTransport(makeHostNet?.(), { log: note });
          wireHost(t);
          const code = await t.open(snap.code);
          if (gen !== generation) return abandon();
          state.code = code;
        }
        beginHosting();
        drainPending();
        setConn('online');
        return true;
      } catch (err) {
        console.error(err);
        if (gen !== generation) { abandon(); throw err; }
        const msg = `恢復唔到：${err?.type || err?.message || '未知'}`;
        teardown();
        setConn('error', msg);
        throw err;
      }
    }
    return false;
  }

  /**
   * What resume() would come back to, without doing it: { mode, code, savedAt, gameId, phase } or null
   * (nothing saved, older than a night, malformed, its snapshot / seat tokens gone, or already in a room).
   * Read through this app's own store, so a `?as=` testing tab sees its own identity (G20).
   */
  function resumeInfo() {
    if (state.mode) return null;
    const r = store.get('bgb:resume');
    if (!r || typeof r !== 'object' || !['host', 'client', 'local'].includes(r.mode)) return null;
    const savedAt = Number(r.savedAt) || 0;
    if (now() - savedAt > RESUME_TTL) return null;
    const out = {
      mode: r.mode, code: r.mode === 'local' ? null : r.code, savedAt,
      gameId: typeof r.gameId === 'string' ? r.gameId : null,
      phase: ['lobby', 'playing', 'results'].includes(r.phase) ? r.phase : null,
    };
    if (r.mode === 'client') {
      if (!isRoomCode(r.code)) return null;
      const saved = store.get(`bgb:seats:${r.code}`, []);
      return Array.isArray(saved) && saved.some((s) => s && typeof s.token === 'string') ? out : null;
    }
    if (r.mode === 'host' && !isRoomCode(r.code)) return null;
    return store.has(hostKey(r.code)) ? out : null;
  }

  /**
   * 「唔要」 / a resume that failed: drop the breadcrumb, and a host's snapshot with it (nothing could ever
   * reach that again, and it is the biggest thing in a 5 MB store). A client's seat tokens stay: typing
   * the same code and name later still gets the old seat back. Refused (false) while in a room.
   */
  function forgetResume() {
    if (state.mode) return false;
    const r = store.get('bgb:resume');
    if (r && typeof r === 'object' && (r.mode === 'host' || r.mode === 'local')) store.del(hostKey(r.mode === 'local' ? null : r.code));
    store.del('bgb:resume');
    touch();
    return true;
  }

  /** Leave on purpose: the host dissolves the room, a client says goodbye. Forgets what it saved. */
  function leave() {
    if (!state.mode && !room) return;   // nothing to leave; do not wipe the resume breadcrumb of a past room
    if (state.mode === 'client') {
      clientT?.send({ t: 'bye' });
      store.del(`bgb:seats:${state.code}`);
    } else if (room) {
      store.del(hostKey(room.code));
      room.close();
    }
    store.del('bgb:resume');
    teardown({ graceful: true });
    keepAwake(false);
    touch();
  }

  /**
   * #5 — the page came back to the foreground (visibilitychange, pageshow, online; the UI may call it too).
   * Host/local: re-check every timer now (phones throttle them in the background); a host that was away
   * `awayMs` does not count that time against offline lobby seats, gives every phone a fresh heartbeat
   * window and gets back on the signalling server at once.
   * Client: re-learn the clock and ask the host for everything again (state.resyncedAt is set when it arrives),
   * and probe the channel: no reply within PROBE_MS → re-dial.
   */
  function resync(reason = 'resync', awayMs = 0) {
    if (!state.mode) return false;
    keepAwake(true);
    if (isHostish()) {
      if (awayMs > 0) room.hostBack(awayMs); else room.poke();
      hostT?.resume(reason);
      state.resyncedAt = now();
      touch();
      return true;
    }
    if (state.mode === 'client' && clientT && state.mySeats.length) {
      resyncPending = true;     // a reconnect's welcome counts too, if the channel died in the background
      if (state.conn === 'online') {
        startClock();
        clientT.send({ t: 'sync' });
      }
      probe(reason);
      return true;
    }
    return false;
  }

  /**
   * Page lifecycle → connection work. kind: 'hidden' | 'visible' | 'pageshow' (bfcache) | 'resume' (unfrozen)
   * | 'online' | 'offline'. Wired to the real events below; tests call it as app._page(kind).
   */
  function onPage(kind, info = '') {
    if (kind === 'hidden') {
      if (!pageHidden) { pageHidden = true; hiddenAt = now(); note('page hidden'); }
      saveNow();
      return;
    }
    if (kind === 'offline') { note('network offline'); return; }
    let away = 0;
    // 'visible' means visible; an unfrozen or bfcache-restored page may still be in the background
    if (kind === 'visible' || (kind !== 'online' && !globalThis.document?.hidden)) {
      if (pageHidden) away = Math.max(0, now() - hiddenAt);
      pageHidden = false;
    }
    note(`${kind === 'online' ? 'network online' : `page ${kind}`}${info}${away ? ` after ${secs(away)} hidden` : ''}`);
    if (pageHidden) {                // the network came back while this page is still hidden: just get ready
      hostT?.resume('online');
      clientT?.nudge('online');
      return;
    }
    resync(kind, away);
  }

  // ============================================================
  // lobby / play / results / host controls
  // ============================================================

  const lobby = {
    selectGame: async (id) => (isHostish() ? room.selectGame(id) : NOT_HOST),
    setConfig: (cfg) => (isHostish() ? room.setConfig(cfg) : NOT_HOST),
    moveSeat: (pid, index) => (isHostish() ? room.moveSeat(pid, index) : NOT_HOST),
    kick: (pid) => (isHostish() ? room.kick(pid) : NOT_HOST),
    /** Host, or the seat's own device. */
    setColor(pid, color) {
      if (isHostish()) return room.setColor(state.deviceId, pid, color);
      if (!state.mySeats.includes(pid)) return { ok: false, message: '唔係你嘅位' };
      return { ok: clientT?.send({ t: 'lobby', op: 'color', pid, color }) ?? false, message: '' };
    },
    /** Any device: add a seat on THIS device (a shared phone). */
    addSeat(name) {
      if (isHostish()) return room.addSeat(state.deviceId, name);
      return { ok: clientT?.send({ t: 'lobby', op: 'addSeat', name }) ?? false, message: '' };
    },
    removeSeat(pid) {
      if (isHostish()) return room.removeSeat(state.deviceId, pid);
      if (!state.mySeats.includes(pid)) return { ok: false, message: '唔係你嘅位' };
      return { ok: clientT?.send({ t: 'lobby', op: 'leave', pid }) ?? false, message: '' };
    },
    /** Returns { ok, message, warnings? } — warnings name seats that are offline (the game starts anyway). */
    start() {
      narrator?.prime?.();       // inside the 開始遊戲 tap — the first speak() depends on it
      return isHostish() ? room.start() : NOT_HOST;
    },
    /** #6 host: give a disconnected seat to the phone that asked for it (state.room.claims). */
    approveClaim: (pid) => (isHostish() ? room.approveClaim(pid) : NOT_HOST),
    rejectClaim: (pid) => (isHostish() ? room.rejectClaim(pid) : NOT_HOST),
    /** G3 host: an offline lobby seat is dropped 180 s after it went away (players[].dropAt) unless kept. */
    keepSeat: (pid, keep = true) => (isHostish() ? room.keepSeat(pid, keep) : NOT_HOST),
    /** #9 host: seat order and colours of the last game started on this phone (state.savedGroup). */
    applySavedOrder: () => (isHostish() ? room.applySavedOrder() : NOT_HOST),
  };

  /**
   * Send an action for one of this device's seats (G4). Returns a Promise:
   *   resolves true   the host applied it (its views have already arrived)
   *   resolves false  the host refused it (wrong phase, illegal, not your seat) — it did get there
   *   rejects         it never got there: err.code 'offline' (no connection) or 'timeout' (no answer in 4 s)
   * Fire-and-forget callers are fine: a rejection is never "unhandled".
   */
  function act(pid, action) {
    let p;
    if (!state.mySeats.includes(pid)) {
      p = Promise.resolve(false);
    } else if (state.mode === 'client') {
      if (!clientT || state.conn !== 'online') {
        p = Promise.reject(actError('offline'));
      } else {
        const id = ++actSeq;
        p = new Promise((resolve, reject) => {
          if (!clientT.send({ t: 'act', pid, action, rev: state.rev, id })) { reject(actError('offline')); return; }
          const timer = T.setTimeout(() => settleOutbox(id, (o) => o.reject(actError('timeout'))), ACK_TIMEOUT);
          outbox.set(id, { resolve, reject, timer });
          state.outbox = outbox.size;
          touch();
        });
      }
    } else {
      p = Promise.resolve(isHostish() ? !!room.act(state.deviceId, pid, action) : false);
    }
    p.catch(() => { /* handled for fire-and-forget callers; awaiting callers still see it */ });
    return p;
  }

  function ink(pid, payload) {
    if (!state.mySeats.includes(pid)) return false;
    const batch = normalizeInk(pid, payload);
    if (!batch) return false;
    // The sender draws locally at once; the host relays to everyone ELSE.
    applyInkBatch(state.ink, batch);
    state.ink = { epoch: state.ink.epoch, strokes: state.ink.strokes };
    touch();
    if (state.mode === 'client') return clientT?.send({ t: 'ink', ...batch }) ?? false;
    return isHostish() ? room.ink(state.deviceId, pid, batch) : false;
  }

  function setActiveSeat(pid) {
    if (!state.mySeats.includes(pid) || state.activeSeat === pid) return;
    state.activeSeat = pid;
    touch();
  }

  const results = {
    again() { narrator?.prime?.(); return isHostish() ? room.again() : NOT_HOST; },
    toLobby() { return isHostish() ? room.toLobby() : NOT_HOST; },
  };

  const hostCtl = {
    pause() {
      if (!isHostish()) return false;
      narrationStop();
      return room.pause();
    },
    /** Resuming replays the current cue (the pause cut it off), so this is the tap that re-primes speech. */
    resume() {
      narrator?.prime?.();
      return isHostish() ? room.resume() : false;
    },
    next() {
      if (!isHostish()) return false;
      narrationStop();
      return room.next();
    },
    autoAct(pid) { return isHostish() ? room.autoAct(pid) : false; },
    /** One of the game's own host buttons (state.hostActions[k]): pass its `i` and `label`. */
    hostAction(i, label) { return isHostish() ? room.hostAction(i, label) : false; },
    /** `@void-round`: engines that support it discard the current round (a phone died); others ignore it → false. */
    voidRound() { return isHostish() ? room.voidRound() : false; },
    /**
     * T1 — the table timer, in every phase, on every phone (state.room.timer). Host only; all return booleans.
     * start(ms 1 s–3 h, label?) replaces any running timer; add(ms) after it rang starts a new countdown.
     * 暫停 (hostCtl.pause) also holds it, and 繼續 releases it.
     */
    timer: {
      start: (ms, label = '') => (isHostish() ? room.timerStart(ms, label) : false),
      pause: () => (isHostish() ? room.timerPause() : false),
      resume: () => (isHostish() ? room.timerResume() : false),
      add: (ms) => (isHostish() ? room.timerAdd(ms) : false),
      stop: () => (isHostish() ? room.timerStop() : false),
    },
  };

  const narration = {
    setMode(mode) {
      narrator?.prime?.();
      if (!isHostish() || !room.setNarrationMode(mode)) return false;
      store.set('bgb:narration', { mode });
      if (mode === 'voice') {
        const cue = room.currentCue();
        if (cue) narrate(cue);
      } else {
        narrationStop();
      }
      return true;
    },
    /** 重講: say the current line again (voice mode). A real tap, so it also re-primes iOS speech. */
    replay() {
      narrator?.prime?.();
      if (!isHostish() || room.narration.mode !== 'voice') return false;
      const cue = room.currentCue();
      if (!cue) return false;
      narrate(cue);
      return true;
    },
    /** 跳過: stop talking and count the current line as said (the step itself carries on; 下一步 skips the step). */
    skip() {
      if (!isHostish()) return false;
      const cue = room.currentCue();
      narrationStop();
      return cue ? !!room.cueDone(cue.id) : false;
    },
  };

  const clock = {
    now: () => (state.mode === 'client' ? now() + clockOffset : now()),
  };

  /**
   * #11 — the content bag. stats/reset only mean something where the bag draws (host / local);
   * elsewhere, or before a bank is loaded, stats() is null and reset() false, so a form can just try.
   */
  const bagApi = {
    ...bag,
    stats(id, filter) {
      if (state.mode === 'client') return null;
      try { return bag.isLoaded(id) ? bag.stats(id, filter) : null; } catch { return null; }
    },
    reset(id) {
      if (state.mode === 'client') return false;
      try { bag.reset(id); } catch { return false; }
      touch();
      return true;
    },
  };

  // ---------- page lifecycle (browser only) ----------
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => onPage(document.hidden ? 'hidden' : 'visible'));
    document.addEventListener('resume', () => onPage('resume'));                         // Chrome: unfrozen
    window.addEventListener('pageshow', (e) => { if (e.persisted) onPage('pageshow', ' (bfcache)'); });
    window.addEventListener('online', () => onPage('online'));
    window.addEventListener('offline', () => onPage('offline'));
    window.addEventListener('pagehide', saveNow);
  }

  return {
    state,
    on(ev, fn) { listeners[ev]?.add(fn); return this; },
    off(ev, fn) { listeners[ev]?.delete(fn); return this; },
    host, join, local, resume, leave, claimSeat, resync,
    resumeInfo, forgetResume, keepsake,
    lobby, act, ink, setActiveSeat, results, hostCtl, narration, clock,
    game,
    /** Small per-identity preferences (e.g. 'ct:name'), in the same store as everything else. */
    prefs: {
      get: (key, fallback = null) => store.get(String(key), fallback),
      set: (key, value) => store.set(String(key), value),
    },
    /** The registry, so the picker can draw cards without loading any module. */
    games: registry,
    /** The narrator createApp was given (the shell falls back to this one). */
    narrator,
    bag: bagApi,
    canNetwork,
    build: BUILD,
    /** The last ~40 connection events, `<UTC ISO time> text`, oldest first (⚙️ 連線記錄). Never holds a token. */
    connLog: () => log.lines(),
    /** Test/debug access to the in-process Room (host / local only). */
    get _room() { return room; },
    /** Test hook: feed a page-lifecycle event ('hidden' | 'visible' | 'pageshow' | 'resume' | 'online' | 'offline'). */
    _page: onPage,
  };
}
