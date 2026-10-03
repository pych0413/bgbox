// ============================================================
// client.js — createApp(): the ONLY object the UI talks to (DESIGN §15.3).
//
//   host   Room + Session run in this page; remote phones connect through a
//          HostTransport. This device is just another device of the Room, fed
//          in-process (no network hop).
//   local  the same Room, no transport at all (one phone holds every seat).
//   client a ClientTransport; the Room's messages arrive over the wire and are
//          applied by the very same handler the host uses for itself.
//
// iOS gesture rule: every entry point that can start narration calls
// narrator.prime() as its FIRST statement, before any await.
// ============================================================

import { HostTransport, ClientTransport, PROTOCOL } from './transport.js?v=20261003075613';
import { Room } from './room.js?v=20261003075613';
import { createBag } from './bag.js?v=20261003075613';
import { applyInkBatch, emptyInk, normalizeInk } from './session.js?v=20261003075613';
import { cryptoRng } from './engine-kit.js?v=20261003075613';
import { makeStore, uid, keepAwake, isRoomCode } from './util.js?v=20261003075613';
import { GAMES } from '../games/registry.js?v=20261003075613';

const RESUME_TTL = 8 * 60 * 60 * 1000;     // a night of games
const WELCOME_TIMEOUT = 12_000;
const LEAVE_GRACE = 200;                   // let the goodbye reach the wire before closing
const NOT_HOST = { ok: false, message: '淨係房主先做到呢樣' };

function emptyRoom() {
  return {
    phase: 'lobby', players: [], gameId: null, config: {}, configSummary: [],
    configValid: { ok: false, message: '未揀遊戲', warnings: [] },
    scoreboard: {}, history: [], narration: { mode: 'voice' }, paused: false,
    stalled: [], lastResult: null, loading: null,
  };
}

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
 */
export function createApp(opts = {}) {
  const {
    narrator = null, storage, now = () => Date.now(), rng = cryptoRng(), registry = GAMES,
    makeHostNet, makeClientNet, saveEveryMs = 5000, banks,
  } = opts;
  const T = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    ...(opts.timers ?? {}),
  };
  const store = makeStore(storage);
  const listeners = { change: new Set(), notice: new Set() };

  // ---------- state ----------
  const state = {
    mode: null, conn: 'idle', connMessage: '',
    code: null, isHost: false, deviceId: '',
    mySeats: [], activeSeat: null,
    room: emptyRoom(), views: {}, table: null, focus: null, cue: null,
    ink: emptyInk(), rev: 0,
  };
  state.deviceId = store.get('bgb:device') || uid('d');
  store.set('bgb:device', state.deviceId);

  let room = null;                 // host / local
  let hostT = null;                // HostTransport
  let clientT = null;              // ClientTransport
  let seatRecs = [];               // client: [{ name, token?, id? }] sent in every hello
  let welcomeWaiter = null;
  let heartbeat = null;
  let clockTimer = null;
  let clockOffset = 0;
  let clockSamples = [];
  let pendingHostMsgs = null;

  const bag = createBag({ storage, rng, banks, onNotice: (text) => emit('notice', text) });
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
    state.conn = conn;
    state.connMessage = message;
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

  function narrationStop() {
    speakToken++;
    if (narrationTimer !== null) { T.clearTimeout(narrationTimer); narrationTimer = null; }
    if (speaking) {
      speaking = false;
      try { narrator?.cancel?.(); } catch { /* narrator is optional garnish */ }
    }
  }

  /** Voice mode: speak the cue, wait out its minMs, then tell the session it is done. */
  function narrate(cue) {
    narrationStop();
    const token = speakToken;
    const started = now();
    const finish = () => {
      if (token !== speakToken) return;
      speaking = false;
      const wait = Math.max(0, (cue.minMs ?? 0) - (now() - started));
      narrationTimer = T.setTimeout(() => {
        narrationTimer = null;
        if (token === speakToken) room?.cueDone(cue.id);
      }, wait);
    };
    if (!narrator?.speak) { finish(); return; }
    let p;
    try { speaking = true; p = narrator.speak(cue.text); } catch { speaking = false; p = null; }
    Promise.resolve(p).then(finish, finish);
  }

  function onCue(cue, info) {
    if (!room) return;
    if (room.narration.mode === 'voice') narrate(cue, info);
    else narrationStop();
  }

  // ---------- host persistence ----------
  let saveQueued = false;
  function saveNow() {
    if (!isHostish()) return;
    store.set(`bgb:host:${room.code ?? 'local'}`, room.snapshot());
    store.set('bgb:resume', { mode: state.mode, code: room.code, savedAt: now() });
  }
  function queueSave() {
    if (saveQueued) return;
    saveQueued = true;
    queueMicrotask(() => { saveQueued = false; saveNow(); });
  }

  function onRoomChange() {
    if (room && room.phase !== 'playing') narrationStop();
    queueSave();
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
    if ('cue' in v) state.cue = v.cue ?? null;
    if (state.mode === 'client' && typeof v.hostNow === 'number' && !clockSamples.length) clockOffset = v.hostNow - now();
    touch();
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
    state.room = { ...emptyRoom(), ...msg.room };
    applyViews(msg.views, { fresh: true });
    if (state.mode === 'client') {
      seatRecs = seats.map((s) => ({ id: s.id, name: s.name, token: s.token }));
      store.set(`bgb:seats:${state.code}`, seatRecs);
      store.set('bgb:resume', { mode: 'client', code: state.code, savedAt: now() });
      setConn('online');
      if (clockTimer === null) startClock();
    }
    welcomeWaiter?.resolve();
    welcomeWaiter = null;
    touch();
  }

  function handleMessage(msg) {
    switch (msg?.t) {
      case 'welcome': onWelcome(msg); break;
      case 'room':
        state.room = { ...emptyRoom(), ...msg.room };
        if (state.room.phase === 'lobby' && state.ink.strokes.length) state.ink = emptyInk();
        touch();
        break;
      case 'views': applyViews(msg); break;
      case 'ink':
        applyInkBatch(state.ink, msg);
        state.ink = { epoch: state.ink.epoch, strokes: state.ink.strokes };
        touch();
        break;
      case 'inkSync':
        if (msg.ink && Array.isArray(msg.ink.strokes)) { state.ink = { epoch: msg.ink.epoch ?? 0, strokes: msg.ink.strokes }; touch(); }
        break;
      case 'pong': onPong(msg); break;
      case 'notice': if (msg.text) emit('notice', String(msg.text)); break;
      case 'reject': if (state.mode === 'client') fatal(String(msg.reason || '連唔到房'), { clearSeats: true }); break;
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
    setConn('error', reason);
    welcomeWaiter?.reject(new Error(reason));
    welcomeWaiter = null;
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

  function startClock() {
    stopClock();
    let n = 0;
    const tick = () => {
      clientT?.send({ t: 'ping', c: now() });
      n++;
      clockTimer = T.setTimeout(tick, n < 4 ? 250 : 15_000);
    };
    tick();
  }
  function stopClock() { if (clockTimer !== null) { T.clearTimeout(clockTimer); clockTimer = null; } }

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
      hostDeviceId: state.deviceId, now, rng, bag, timers: T, store,
      loadGame: game, send: deliver, onCue, onChange: onRoomChange,
      onNotice: (text) => emit('notice', text),
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
    t.on('message', (peerId, msg) => {
      if (!room) { pendingHostMsgs?.push([peerId, msg]); return; }
      room.receive(peerId, msg);
    });
    t.on('close', (peerId) => room?.peerClosed(peerId));
    t.on('status', (kind) => {
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
      ink: emptyInk(), rev: 0,
    });
    seatRecs = [];
    clockOffset = 0;
    clockSamples = [];
  }

  function teardown({ graceful = false } = {}) {
    narrationStop();
    stopClock();
    if (heartbeat !== null) { T.clearInterval(heartbeat); heartbeat = null; }
    welcomeWaiter?.reject(new Error('cancelled'));
    welcomeWaiter = null;
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

  // ============================================================
  // entry points
  // ============================================================

  /** Create a P2P room. The first name is the host's own seat; more names are extra seats on this phone. */
  async function host({ names = [] } = {}) {
    narrator?.prime?.();
    teardown();
    state.mode = 'host';
    setConn('connecting', '開緊房…');
    try {
      pendingHostMsgs = [];
      hostT = new HostTransport(makeHostNet?.());
      wireHost(hostT);
      const code = await hostT.open(null);
      state.code = code;
      room = new Room(roomDeps({ code, names }));
      beginHosting();
      drainPending();
      setConn('online');
      return code;
    } catch (err) {
      console.error(err);
      const msg = `開唔到房：${err?.type || err?.message || '未知錯誤'}。試下 refresh 或者換個網絡。`;
      teardown();
      setConn('error', msg);
      throw err;
    }
  }

  /** The whole game on this phone, no network. */
  function local({ names = [] } = {}) {
    narrator?.prime?.();
    teardown();
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
      t: 'hello', v: PROTOCOL, deviceId: state.deviceId,
      seats: seatRecs.map((s) => ({ name: s.name, ...(s.token ? { token: s.token } : {}) })),
    });
  }

  function onClientStatus(kind) {
    if (!clientT) return;
    if (kind === 'online') { if (!state.mySeats.length) setConn('connecting', '入緊房…'); }
    else if (kind === 'host-gone') { stopClock(); setConn('reconnecting', '揾唔到房主 — 佢可能熄咗個頁面'); }
    else if (kind === 'offline' || kind === 'reconnecting') { stopClock(); setConn('reconnecting', '同房主斷咗，重連緊…'); }
    else { stopClock(); setConn('error', '連線出咗問題'); }
  }

  /** Join a room with one or more seats on this device. Resolves once the host has seated us. */
  async function join(code, { names = [] } = {}) {
    const c = String(code ?? '').trim();
    if (!isRoomCode(c)) throw new Error('房間號碼係 4 粒骰（1-6）');
    teardown();
    state.mode = 'client';
    state.code = c;
    seatRecs = buildHelloSeats(c, names);
    if (!seatRecs.length) {
      resetState();
      throw new Error('填返個名先');
    }
    setConn('connecting', `連緊 ${c.split('').join('-')} …`);
    try {
      const welcomed = new Promise((resolve, reject) => { welcomeWaiter = { resolve, reject }; });
      welcomed.catch(() => { /* surfaced through the awaited race below */ });
      clientT = new ClientTransport(makeClientNet?.());
      clientT.on('message', handleMessage);
      clientT.on('status', onClientStatus);
      clientT.on('open', sendHello);
      await clientT.connect(c);
      let timer;
      const timeout = new Promise((_, reject) => { timer = T.setTimeout(() => reject(new Error('房主冇回應，等咗好耐')), WELCOME_TIMEOUT); });
      try { await Promise.race([welcomed, timeout]); } finally { T.clearTimeout(timer); }
      keepAwake(true);
    } catch (err) {
      console.error(err);
      const msg = state.connMessage && state.conn === 'error' ? state.connMessage : (err?.message || '入唔到房 — 睇下啲骰啱唔啱，房主係咪仲開緊個頁面。');
      teardown();
      setConn('error', msg);
      throw err;
    }
  }

  /** Come back after a refresh: the host's own snapshot, or this device's seat tokens. false if there is nothing to resume. */
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
      const snap = store.get(`bgb:host:${r.code ?? 'local'}`);
      if (!snap || snap.v !== 2) return false;
      teardown();
      state.mode = r.mode;
      state.deviceId = snap.hostDeviceId || state.deviceId;
      store.set('bgb:device', state.deviceId);
      setConn('connecting', '恢復緊房間…');
      try {
        room = await Room.restore(snap, roomDeps({ code: snap.code ?? null }));
        if (r.mode === 'host') {
          pendingHostMsgs = [];
          hostT = new HostTransport(makeHostNet?.());
          wireHost(hostT);
          state.code = await hostT.open(snap.code);
        }
        beginHosting();
        drainPending();
        setConn('online');
        return true;
      } catch (err) {
        console.error(err);
        const msg = `恢復唔到：${err?.type || err?.message || '未知'}`;
        teardown();
        setConn('error', msg);
        throw err;
      }
    }
    return false;
  }

  /** Leave on purpose: the host dissolves the room, a client says goodbye. Forgets what it saved. */
  function leave() {
    if (!state.mode && !room) return;   // nothing to leave; do not wipe the resume breadcrumb of a past room
    if (state.mode === 'client') {
      clientT?.send({ t: 'bye' });
      store.del(`bgb:seats:${state.code}`);
    } else if (room) {
      store.del(`bgb:host:${room.code ?? 'local'}`);
      room.close();
    }
    store.del('bgb:resume');
    teardown({ graceful: true });
    keepAwake(false);
    touch();
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
    start() {
      narrator?.prime?.();       // inside the 開始遊戲 tap — the first speak() depends on it
      return isHostish() ? room.start() : NOT_HOST;
    },
  };

  function act(pid, action) {
    if (!state.mySeats.includes(pid)) return false;
    if (state.mode === 'client') return clientT?.send({ t: 'act', pid, action, rev: state.rev }) ?? false;
    return isHostish() ? room.act(state.deviceId, pid, action) : false;
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
  };

  const clock = {
    now: () => (state.mode === 'client' ? now() + clockOffset : now()),
  };

  // ---------- page lifecycle (browser only) ----------
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { saveNow(); return; }
      if (state.mode) keepAwake(true);
      room?.poke();
    });
    window.addEventListener('pagehide', saveNow);
  }

  return {
    state,
    on(ev, fn) { listeners[ev]?.add(fn); return this; },
    off(ev, fn) { listeners[ev]?.delete(fn); return this; },
    host, join, local, resume, leave,
    lobby, act, ink, setActiveSeat, results, hostCtl, narration, clock,
    game,
    /** The registry, so the picker can draw cards without loading any module. */
    games: registry,
    /** The narrator createApp was given (the shell falls back to this one). */
    narrator,
    bag,
    /** Test/debug access to the in-process Room (host / local only). */
    get _room() { return room; },
  };
}
