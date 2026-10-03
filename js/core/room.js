// ============================================================
// room.js — the host's room: players, seats, devices, lobby, game selection,
// results, scoreboard, stall detection, snapshot — and the §8 protocol.
//
// The Room is transport-agnostic. It talks to devices through ONE callback,
//   send(deviceId, msg, peerId)
// (peerId is null for the host's own device, which createApp delivers in-process)
// and it is fed by receive(peerId, msg) for remote devices or by direct method
// calls (act, setColor, ...) for the host's own device. Every public mutator
// runs inside #batch(): all changes made during one call are flushed to the
// devices once, synchronously, when the outermost call returns.
//
// Privacy: a device only ever gets the views of ITS OWN seats (plus the public
// table view). Room views are built field by field; tokens never leave here
// except to the device that owns the seat.
//
// Wire format as implemented (DESIGN §8; every message is JSON with a string `t`):
//   client → host   hello  { v: 2, deviceId, seats: [{ name, token? }] }
//                   act    { pid, action, rev }       ink { pid, stroke, pts, end?, color?, width?, eraser? | op }
//                   lobby  { op: 'color' | 'leave' | 'addSeat', ... }
//                   ping   { c }   (not `t`: that is the message type)      bye {}
//   host → client   welcome { v, device, seats: [{ id, name, token }], room, views }   (re-sent when the seat list changes)
//                   room    { room }                              public room view; `stalled` only for the host
//                   views   { rev, hostNow, bySeat, table, focus }   this device's seats only; `cue` for the host device
//                   ink { pid, stroke, pts, ... } / inkSync { ink: { epoch, strokes } }
//                   pong { c, hostNow }   notice { text } (non-fatal)   reject { reason } (fatal)
// ============================================================

import { HOST, clone, cryptoRng } from './engine-kit.js?v=1';
import { Session } from './session.js?v=1';
import { PROTOCOL } from './transport.js?v=1';
import { uid } from './util.js?v=1';

export const PALETTE = ['#f5c518', '#4ec97a', '#4aa3ff', '#ff7a59', '#c084fc', '#f472b6',
  '#2dd4bf', '#facc15', '#a3e635', '#fb923c', '#60a5fa', '#e879f9', '#94a3b8', '#fda4af', '#86efac', '#fde68a'];
export const MAX_SEATS = 16;        // players in one game
export const MAX_PEOPLE = 24;       // seats including spectators
export const NARRATION_MODES = ['voice', 'read', 'silent'];

const NAME_MAX = 12;
const DEFAULT_STALL_MS = 45_000;
const HISTORY_MAX = 100;
const ACTION_MAX_BYTES = 8192;
const INK_RESYNC_MIN_MS = 1000;

const fail = (message) => ({ ok: false, message });
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Only the seats this device owns may learn who is "in focus", and never anyone else's. */
function filterFocus(focus, seatIds) {
  if (!isObj(focus) || !Array.isArray(focus.pids)) return null;
  const mine = focus.pids.filter((id) => seatIds.includes(id));
  if (!mine.length) return null;
  const out = { pids: mine };
  if (focus.anonymous) out.anonymous = String(focus.anonymous);
  return out;
}

export class Room {
  #depth = 0;
  #dirty = { room: false, views: false };
  #flushing = false;
  #selectSeq = 0;
  #inkFrom = null;
  #stallTimer = null;
  #stallSig = '';
  #disposed = false;

  /**
   * @param {object}   o
   * @param {string|null} o.code          room code (null for local play)
   * @param {string}   o.hostDeviceId     this device's id
   * @param {string[]} [o.names]          seats on the host device; the first is the host's own
   * @param {Function} o.send             (deviceId, msg, peerId) => void
   * @param {Function} o.loadGame         (id) => Promise<game module>
   * @param {object}   [o.bag]
   * @param {Function} [o.now]            () => host ms
   * @param {Function} [o.rng]
   * @param {object}   [o.timers]         { setTimeout, clearTimeout }
   * @param {object}   [o.store]          makeStore(...) — persists last-used game configs
   * @param {Function} [o.onCue]          (cue, { replay }) => void
   * @param {Function} [o.onNotice]       (text) => void
   * @param {Function} [o.onChange]       () => void  after every flush (persist here)
   * @param {string}   [o.narrationMode]
   * @param {number}   [o.stallMs]
   * @param {object}   [o.restore]        snapshot (use Room.restore)
   * @param {object}   [o.game]           restored game module
   */
  constructor(o) {
    this.deps = o;
    this.code = o.code ?? null;
    this.hostDeviceId = o.hostDeviceId;
    this.nowFn = o.now ?? (() => Date.now());
    this.rng = o.rng ?? cryptoRng();
    this.bag = o.bag ?? null;
    this.timers = o.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    };
    this.stallMs = o.stallMs ?? DEFAULT_STALL_MS;

    this.devices = new Map();
    this.devices.set(this.hostDeviceId, { id: this.hostDeviceId, peerId: null, connected: true, local: true });

    const snap = o.restore;
    if (snap) {
      this.code = snap.code ?? this.code;
      this.pidSeq = snap.pidSeq ?? 0;
      this.hostPid = snap.hostPid;
      // The host's device id may have been regenerated (cleared storage); seats on the old one follow it.
      this.players = snap.players.map((p) => {
        const deviceId = p.deviceId === snap.hostDeviceId ? this.hostDeviceId : p.deviceId;
        return { ...p, deviceId, connected: deviceId === this.hostDeviceId };
      });
      this.phase = snap.phase;
      this.gameId = snap.gameId ?? null;
      this.game = o.game ?? null;
      this.config = snap.config ?? {};
      this.configDirty = !!snap.configDirty;
      this.lastConfigs = snap.lastConfigs ?? {};
      this.scoreboard = snap.scoreboard ?? {};
      this.history = snap.history ?? [];
      this.lastResult = snap.lastResult ?? null;
      this.narration = { mode: snap.narration?.mode ?? 'voice' };
      this.rev = snap.rev ?? 0;
      this.banned = new Set(snap.banned ?? []);
      this.session = null;
      if (snap.session && this.game) {
        this.session = Session.restore(snap.session, this.#sessionDeps());
      } else if (this.phase === 'playing') {
        this.phase = 'lobby';   // the game module is gone; do not strand the table
      }
    } else {
      this.pidSeq = 0;
      this.players = [];
      this.phase = 'lobby';
      this.gameId = null;
      this.game = null;
      this.config = {};
      this.configDirty = false;
      this.lastConfigs = {};
      this.scoreboard = {};
      this.history = [];
      this.lastResult = null;
      this.narration = { mode: NARRATION_MODES.includes(o.narrationMode) ? o.narrationMode : 'voice' };
      this.rev = 0;
      this.banned = new Set();
      this.session = null;
      this.hostPid = null;
      const names = (o.names ?? []).map((n) => this.#cleanName(n)).filter(Boolean);
      for (const name of names.length ? names : ['房主']) {
        const p = this.#addPlayer(this.#uniqueName(name), this.hostDeviceId);
        this.hostPid ??= p.id;
      }
    }
    this.loading = null;
    this.waiting = new Map();   // pid → { since, rev } seats the engine is waiting on while their phone is away
  }

  /** Rebuild a room from snapshot() under the same code. The session comes back PAUSED. */
  static async restore(snap, deps) {
    let game = null;
    if (snap.gameId) {
      game = await deps.loadGame(snap.gameId);
      for (const b of game?.meta?.banks ?? []) await deps.bag?.load(b);
    }
    const room = new Room({ ...deps, restore: snap, game });
    return room;
  }

  // ============================================================
  // batching + delivery
  // ============================================================

  #batch(fn) {
    this.#depth++;
    try { return fn(); } finally {
      if (--this.#depth === 0) this.#flush();
    }
  }

  #mark(room = true, views = false) {
    if (room) this.#dirty.room = true;
    if (views) this.#dirty.views = true;
  }

  #flush() {
    if (this.#flushing || this.#disposed) return;
    this.#flushing = true;
    try {
      for (let guard = 0; (this.#dirty.room || this.#dirty.views) && guard < 20; guard++) {
        const d = this.#dirty;
        this.#dirty = { room: false, views: false };
        this.#deliver(d);
      }
    } finally { this.#flushing = false; }
    try { this.deps.onChange?.(); } catch (e) { console.error('[room] onChange threw', e); }
  }

  #send(dev, msg) {
    try { this.deps.send(dev.id, msg, dev.peerId ?? null); } catch (e) { console.error('[room] send threw', e); }
  }

  #sendPeer(peerId, msg) {
    try { this.deps.send(null, msg, peerId); } catch (e) { console.error('[room] send threw', e); }
  }

  #deliver({ room, views }) {
    if (views) this.rev++;
    const hostNow = this.nowFn();
    const base = room ? this.#roomBase() : null;
    const cache = {};
    for (const dev of this.devices.values()) {
      if (!dev.local && !dev.peerId) continue;
      const isHost = dev.id === this.hostDeviceId;
      if (room) this.#send(dev, { t: 'room', room: this.#roomFor(base, isHost) });
      if (views) this.#send(dev, { t: 'views', ...this.#viewsFor(dev, cache, hostNow, isHost) });
    }
  }

  // ============================================================
  // views
  // ============================================================

  #publicPlayer(p) {
    return {
      id: p.id, name: p.name, seat: p.seat, color: p.color, connected: p.connected,
      deviceId: p.deviceId, isHost: p.id === this.hostPid, spectator: !!p.spectator,
    };
  }

  #roomBase() {
    const n = this.#seated().length;
    let summary = [];
    if (this.game) {
      try {
        const s = this.game.config.summary?.(clone(this.config), n);
        if (Array.isArray(s)) summary = s.map(String);
      } catch (e) { console.error('[room] config.summary threw', e); }
    }
    return {
      phase: this.phase,
      players: this.players.map((p) => this.#publicPlayer(p)),
      gameId: this.gameId,
      config: clone(this.config),
      configSummary: summary,
      configValid: this.#configStatus(),
      scoreboard: clone(this.scoreboard),
      history: clone(this.history),
      narration: { mode: this.narration.mode },
      paused: !!(this.session && this.phase === 'playing' && this.session.paused),
      lastResult: this.lastResult ? clone(this.lastResult) : null,
      loading: this.loading,
    };
  }

  #roomFor(base, isHost) {
    // Fresh top-level object per device; nested parts are shared but only ever serialised or read.
    return { ...base, stalled: isHost ? this.#stalledList() : [] };
  }

  #viewsFor(dev, cache, hostNow, isHost) {
    const s = this.session;
    const out = { rev: this.rev, hostNow, bySeat: {}, table: null, focus: null };
    if (s) {
      const seats = this.#seatsOf(dev.id);
      cache.table ??= s.table();
      cache.focus ??= s.focus();
      out.table = dev.local ? clone(cache.table) : cache.table;
      for (const p of seats) if (!p.spectator) out.bySeat[p.id] = s.view(p.id);
      out.focus = filterFocus(cache.focus, seats.map((p) => p.id));
    }
    if (isHost) {
      const cue = s && this.phase === 'playing' ? s.cue() : null;
      out.cue = cue ? { id: cue.id, text: cue.text } : null;
    }
    return out;
  }

  #welcomeFor(dev) {
    const isHost = dev.id === this.hostDeviceId;
    return {
      t: 'welcome', v: PROTOCOL, device: dev.id,
      seats: this.#seatsOf(dev.id).map((p) => ({ id: p.id, name: p.name, ...(dev.local ? {} : { token: p.token }) })),
      room: this.#roomFor(this.#roomBase(), isHost),
      views: this.#viewsFor(dev, {}, this.nowFn(), isHost),
    };
  }

  /** Send a device the full picture: welcome (seats + room + views) and the drawing. */
  welcome(deviceId) {
    const dev = this.devices.get(deviceId);
    if (!dev || (!dev.local && !dev.peerId)) return;
    this.#send(dev, this.#welcomeFor(dev));
    this.#sendInkSync(dev);
  }

  #sendInkSync(dev) {
    if (!this.session || this.phase === 'lobby') return;
    this.#send(dev, { t: 'inkSync', ink: clone(this.session.drawing) });
  }

  /** Push everything to everyone (after construction / restore). */
  sync() { this.#batch(() => this.#mark(true, true)); }

  // ============================================================
  // lookups
  // ============================================================

  #seated() { return this.players.filter((p) => !p.spectator); }
  #byId(pid) { return this.players.find((p) => p.id === pid) ?? null; }
  #seatsOf(deviceId) { return this.players.filter((p) => p.deviceId === deviceId); }
  #deviceByPeer(peerId) {
    for (const d of this.devices.values()) if (d.peerId === peerId && peerId != null) return d;
    return null;
  }

  #cleanName(n) { return String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX); }
  #nameTaken(name) { return this.players.some((p) => p.name === name); }
  #uniqueName(name) {
    let out = name;
    for (let i = 2; this.#nameTaken(out); i++) out = `${name.slice(0, NAME_MAX - 2)}${i}`;
    return out;
  }

  #freeColor() {
    const used = new Set(this.players.map((p) => p.color));
    return PALETTE.find((c) => !used.has(c)) ?? PALETTE[this.players.length % PALETTE.length];
  }

  #addPlayer(name, deviceId, { spectator = false } = {}) {
    const p = {
      id: `p${++this.pidSeq}`, name, token: uid('t'), seat: 0, color: this.#freeColor(),
      deviceId, connected: true, spectator, kicked: false,
    };
    this.players.push(p);
    this.scoreboard[p.id] ??= { played: 0, wins: 0, points: 0 };
    this.#renumber();
    return p;
  }

  /** Seated players first (in order), spectators after; seat = index. */
  #renumber() {
    const seated = this.players.filter((p) => !p.spectator);
    const spect = this.players.filter((p) => p.spectator);
    this.players = [...seated, ...spect];
    this.players.forEach((p, i) => { p.seat = i; });
  }

  #gcDevices() {
    for (const d of [...this.devices.values()]) {
      if (!d.local && !this.#seatsOf(d.id).length) this.devices.delete(d.id);
    }
  }

  // ============================================================
  // protocol (remote devices)
  // ============================================================

  /** Entry point for everything a remote device sends (DESIGN §8). */
  receive(peerId, msg) {
    if (this.#disposed || !isObj(msg) || typeof msg.t !== 'string') return;
    if (msg.t === 'hello') { this.#batch(() => this.#hello(peerId, msg)); return; }
    const dev = this.#deviceByPeer(peerId);
    if (!dev) {
      if (msg.t !== 'ping') this.#sendPeer(peerId, { t: 'reject', reason: '未打招呼，refresh 一下' });
      return;
    }
    switch (msg.t) {
      case 'act': this.act(dev.id, msg.pid, msg.action); break;
      case 'ink': this.ink(dev.id, msg.pid, msg); break;
      case 'lobby': this.#remoteLobby(dev, msg); break;
      case 'ping': this.#send(dev, { t: 'pong', c: msg.c, hostNow: this.nowFn() }); break;
      case 'bye': this.#batch(() => this.#bye(dev)); break;
      default: break;
    }
  }

  /** The data channel for `peerId` closed. The seats are kept; only the presence changes. */
  peerClosed(peerId) {
    const dev = this.#deviceByPeer(peerId);
    if (!dev) return;
    this.#batch(() => {
      dev.peerId = null;
      dev.connected = false;
      for (const p of this.#seatsOf(dev.id)) p.connected = false;
      this.#mark();
      this.#refreshStalls();
    });
  }

  #hello(peerId, msg) {
    const reject = (reason) => this.#sendPeer(peerId, { t: 'reject', reason });
    if (msg.v !== PROTOCOL) return reject('版本唔同，兩邊都 refresh 一下個頁面');
    const seats = Array.isArray(msg.seats) ? msg.seats.slice(0, 8) : [];
    if (!seats.length) return reject('要填返個名先');
    const wanted = typeof msg.deviceId === 'string' && /^[\w-]{4,64}$/.test(msg.deviceId) ? msg.deviceId : null;
    if (wanted && this.banned.has(wanted)) return reject('你已經被請出咗房');

    const owned = [];
    const fresh = [];
    for (const s of seats) {
      const p = typeof s?.token === 'string' ? this.players.find((x) => x.token === s.token && !x.kicked) : null;
      if (p) { if (!owned.includes(p)) owned.push(p); continue; }
      const name = this.#cleanName(s?.name);
      if (name) fresh.push(name);
    }
    if (!owned.length && !fresh.length) return reject('要填返個名先');

    const taken = new Set();
    for (const name of fresh) {
      if (this.#nameTaken(name) || taken.has(name)) return reject(`已經有人叫「${name}」，改個名啦`);
      taken.add(name);
    }
    if (this.players.length + fresh.length > MAX_PEOPLE) return reject('房滿咗');
    if (this.phase === 'lobby' && this.#seated().length + fresh.length > MAX_SEATS) return reject('房滿咗');

    // Which device is this? A claimed id is only honoured if the tokens prove it (the id is visible to
    // everyone in the room view, so it is a label, not a credential).
    let dev = wanted ? this.devices.get(wanted) : null;
    if (dev && (dev.local || !(owned.some((p) => p.deviceId === dev.id) || !this.#seatsOf(dev.id).length))) dev = null;
    if (!dev) {
      const id = wanted && !this.devices.has(wanted) ? wanted : uid('d');
      dev = { id, peerId: null, connected: false, local: false };
      this.devices.set(id, dev);
    }

    for (const d of this.devices.values()) {
      if (d !== dev && d.peerId === peerId) { d.peerId = null; d.connected = false; }
    }
    dev.peerId = peerId;
    dev.connected = true;
    const losers = new Set(owned.filter((p) => p.deviceId && p.deviceId !== dev.id).map((p) => p.deviceId));
    for (const p of owned) p.deviceId = dev.id;
    for (const name of fresh) this.#addPlayer(name, dev.id, { spectator: this.phase !== 'lobby' });
    for (const p of this.#seatsOf(dev.id)) p.connected = true;

    this.#gcDevices();
    this.#afterHeadcount();
    this.welcome(dev.id);
    for (const id of losers) if (this.devices.has(id)) this.welcome(id);   // their seat list just shrank
    this.#mark();
    this.#refreshStalls();
  }

  /** The device is leaving on purpose: free its seats between games, mid-game just treat it as gone (it may come back). */
  #bye(dev) {
    if (dev.local) return;
    if (this.phase !== 'playing') {
      for (const p of this.#seatsOf(dev.id)) this.#removePlayer(p);
      this.devices.delete(dev.id);
      this.#afterHeadcount();
    } else {
      dev.peerId = null;
      dev.connected = false;
      for (const p of this.#seatsOf(dev.id)) p.connected = false;
      this.#refreshStalls();
    }
    this.#mark();
  }

  #remoteLobby(dev, msg) {
    switch (msg.op) {
      case 'color': this.#reply(dev, this.setColor(dev.id, msg.pid, msg.color)); break;
      case 'leave': this.#reply(dev, this.removeSeat(dev.id, msg.pid)); break;
      case 'addSeat': this.#reply(dev, this.addSeat(dev.id, msg.name)); break;
      default: break;
    }
  }

  /** Non-fatal answer to a lobby op from a remote device. */
  #reply(dev, res) {
    if (res && res.ok === false && res.message) this.#send(dev, { t: 'notice', text: res.message });
  }

  // ============================================================
  // lobby (host methods unless noted)
  // ============================================================

  /** Load the game module + its banks, then apply config.defaults(n, lastUsed). Async. */
  async selectGame(id) {
    if (this.phase !== 'lobby') return fail('遊戲進行緊，先返大廳');
    const seq = ++this.#selectSeq;
    this.loading = id;
    this.#batch(() => this.#mark());
    let game;
    try {
      game = await this.deps.loadGame(id);
      if (!game?.engine || !game.config) throw new Error('not a game module');
    } catch (e) {
      console.warn('[room] game failed to load', id, e);
      if (seq === this.#selectSeq) { this.loading = null; this.#batch(() => this.#mark()); }
      return fail('呢隻遊戲即將推出');
    }
    try {
      for (const b of game.meta?.banks ?? []) await this.bag?.load(b);
    } catch (e) {
      console.warn('[room] bank failed to load', id, e);
      if (seq === this.#selectSeq) { this.loading = null; this.#batch(() => this.#mark()); }
      return fail('載入唔到詞庫，試多次');
    }
    if (seq !== this.#selectSeq || this.phase !== 'lobby') return fail('已經改咗揀第二隻');
    return this.#batch(() => {
      const prev = this.lastConfigs[id] ?? this.deps.store?.get(`bgb:cfg:${id}`) ?? null;
      this.game = game;
      this.gameId = id;
      this.config = this.#defaults(this.#seated().length, prev);
      this.configDirty = false;
      this.loading = null;
      this.#mark();
      return { ok: true, message: '' };
    });
  }

  #defaults(n, prev) {
    if (!this.game) return {};
    const [min, max] = this.game.meta?.players ?? [1, MAX_SEATS];
    try {
      return clone(this.game.config.defaults(Math.max(min, Math.min(max, n)), prev ? clone(prev) : undefined) ?? {});
    } catch (e) {
      console.error('[room] config.defaults threw', e);
      return {};
    }
  }

  setConfig(cfg) {
    if (this.phase !== 'lobby' || !this.game) return fail('而家改唔到設定');
    if (!isObj(cfg)) return fail('設定唔啱格式');
    return this.#batch(() => {
      this.config = clone(cfg);
      this.configDirty = true;
      this.#mark();
      return { ok: true, message: '' };
    });
  }

  /** Head-count changed in the lobby: untouched settings follow the recommendation for the new n. */
  #afterHeadcount() {
    if (this.phase !== 'lobby' || !this.game || this.configDirty) return;
    this.config = this.#defaults(this.#seated().length, this.config);
  }

  #configStatus() {
    if (!this.game) return { ok: false, message: '未揀遊戲', warnings: [] };
    const seated = this.#seated();
    const n = seated.length;
    const [min, max] = this.game.meta?.players ?? [1, MAX_SEATS];
    const warnings = [];
    const away = seated.filter((p) => !p.connected).map((p) => p.name);
    if (away.length) warnings.push(`${away.join('、')} 斷咗線`);
    if (n < min) return { ok: false, message: `最少要 ${min} 個人（而家 ${n}）`, warnings };
    if (n > max) return { ok: false, message: `最多 ${max} 個人（而家 ${n}）`, warnings };
    let v;
    try { v = this.game.config.validate(clone(this.config), n); } catch (e) {
      console.error('[room] config.validate threw', e);
      v = { ok: false, message: '設定有問題' };
    }
    return { ok: !!v?.ok, message: String(v?.message ?? ''), warnings: [...(v?.warnings ?? []).map(String), ...warnings] };
  }

  /** Reorder the table. Seats are renumbered; only in the lobby or after a game. */
  moveSeat(pid, index) {
    if (this.phase === 'playing') return fail('玩緊嘅時候唔可以換位');
    const p = this.#byId(pid);
    if (!p || p.spectator) return fail('搵唔到呢個位');
    return this.#batch(() => {
      const seated = this.#seated().filter((x) => x !== p);
      const to = Math.max(0, Math.min(seated.length, Math.trunc(Number(index)) || 0));
      seated.splice(to, 0, p);
      this.players = [...seated, ...this.players.filter((x) => x.spectator)];
      this.#renumber();
      this.#mark();
      return { ok: true, message: '' };
    });
  }

  /** Host, or the seat's own device. Colours are unique and come from PALETTE. */
  setColor(deviceId, pid, color) {
    if (this.phase === 'playing') return fail('玩緊嘅時候唔可以換顏色');
    const p = this.#byId(pid);
    if (!p) return fail('搵唔到呢個位');
    if (deviceId !== this.hostDeviceId && p.deviceId !== deviceId) return fail('唔係你嘅位');
    if (!PALETTE.includes(color)) return fail('呢個顏色用唔到');
    if (this.players.some((x) => x.id !== pid && x.color === color)) return fail('呢個顏色有人用咗');
    return this.#batch(() => { p.color = color; this.#mark(); return { ok: true, message: '' }; });
  }

  /** Any device: add a seat on THAT device (a shared phone). Mid-game it joins as a spectator. */
  addSeat(deviceId, name) {
    const dev = this.devices.get(deviceId);
    if (!dev) return fail('部機未入房');
    const clean = this.#cleanName(name);
    if (!clean) return fail('填返個名先');
    if (this.#nameTaken(clean)) return fail(`已經有人叫「${clean}」，改個名啦`);
    if (this.players.length >= MAX_PEOPLE || (this.phase === 'lobby' && this.#seated().length >= MAX_SEATS)) return fail('房滿咗');
    return this.#batch(() => {
      const p = this.#addPlayer(clean, deviceId, { spectator: this.phase !== 'lobby' });
      p.connected = dev.connected;
      this.#afterHeadcount();
      this.welcome(deviceId);   // the device needs the new seat (and its token)
      this.#mark();
      this.#refreshStalls();
      return { ok: true, message: '', pid: p.id };
    });
  }

  /** The seat's own device, or the host (anyone but the host's own seat). Mid-game the seat is orphaned, not deleted. */
  removeSeat(deviceId, pid) {
    const p = this.#byId(pid);
    if (!p) return fail('搵唔到呢個位');
    if (p.id === this.hostPid) return fail('房主個位走唔到');
    if (deviceId !== this.hostDeviceId && p.deviceId !== deviceId) return fail('唔係你嘅位');
    return this.#batch(() => {
      const devId = p.deviceId;
      this.#removePlayer(p);
      this.#afterRemove(devId, '你已經離開咗房間');
      return { ok: true, message: '' };
    });
  }

  kick(pid) {
    const p = this.#byId(pid);
    if (!p) return fail('搵唔到呢個位');
    if (p.id === this.hostPid || p.deviceId === this.hostDeviceId) return fail('自己部機嘅位踢唔到');
    return this.#batch(() => {
      const devId = p.deviceId;
      this.#removePlayer(p);
      this.#afterRemove(devId, '你已經被請出咗房', true);
      return { ok: true, message: '' };
    });
  }

  #removePlayer(p) {
    if (this.phase === 'lobby' || this.phase === 'results' || p.spectator) {
      this.players = this.players.filter((x) => x !== p);
      this.#renumber();
    } else {
      // The engine still has this seat. Keep it, detach the phone, let stall detection auto-act it.
      p.deviceId = null;
      p.connected = false;
      p.kicked = true;
      p.token = uid('t');   // belt and braces: hello() also refuses kicked seats
    }
  }

  /** After seats left a device: tell it, drop it if empty, ban it if kicked and empty. */
  #afterRemove(deviceId, reason, ban = false) {
    const dev = deviceId ? this.devices.get(deviceId) : null;
    if (dev?.local) {
      this.welcome(dev.id);   // the host's own device: its seat list changed
    } else if (dev) {
      if (!this.#seatsOf(dev.id).length) {
        if (ban) this.banned.add(dev.id);
        if (dev.peerId) this.#send(dev, { t: 'reject', reason });
        this.devices.delete(dev.id);
      } else {
        this.welcome(dev.id);
      }
    }
    this.#afterHeadcount();
    this.#mark();
    this.#refreshStalls();
  }

  /** Lobby: start the selected game. Returns { ok, message }. */
  start() {
    if (this.phase !== 'lobby') return fail('已經喺度玩');
    return this.#batch(() => this.#begin());
  }

  #sessionDeps() {
    return {
      game: this.game, rng: this.rng, bag: this.bag, now: this.nowFn, timers: this.timers,
      narrationMode: this.narration.mode,
      onChange: () => this.#onSessionChange(),
      onCue: (cue, info) => { try { this.deps.onCue?.(cue, info); } catch (e) { console.error('[room] onCue threw', e); } },
      onInk: (batch) => this.#relayInk(batch),
    };
  }

  #begin() {
    const st = this.#configStatus();
    if (!st.ok) return fail(st.message || '未準備好');
    this.#renumber();
    const players = this.#seated().map((p) => ({ id: p.id, name: p.name, seat: p.seat, color: p.color }));
    let session;
    try {
      session = new Session({ ...this.#sessionDeps(), players, config: this.config });
    } catch (e) {
      console.error('[room] engine.setup threw', e);
      return fail(`開唔到局：${e?.message ?? e}`);
    }
    this.session = session;
    this.phase = 'playing';
    this.lastResult = null;
    this.waiting.clear();
    this.lastConfigs[this.gameId] = clone(this.config);
    this.deps.store?.set(`bgb:cfg:${this.gameId}`, this.config);
    this.#mark(true, true);
    session.begin();
    this.#relayInk(null);   // everyone starts from a blank drawing, whatever the last game left on their screen
    return { ok: true, message: '' };
  }

  // ============================================================
  // play
  // ============================================================

  /** A seat sends an action. Only the device that owns the seat may; host-internal types are refused. */
  act(deviceId, pid, action) {
    if (this.phase !== 'playing' || !this.session) return false;
    const p = this.#byId(pid);
    if (!p || p.spectator || p.deviceId !== deviceId) return false;
    if (!isObj(action)) return false;
    if (typeof action.type === 'string' && action.type.startsWith('@')) return false;
    try { if (JSON.stringify(action).length > ACTION_MAX_BYTES) return false; } catch { return false; }
    return this.#batch(() => this.session.dispatch(pid, action));
  }

  /** A seat sends strokes. The sender already drew them locally, so they are relayed to everyone else. */
  ink(deviceId, pid, payload) {
    if (this.phase !== 'playing' || !this.session) return false;
    const p = this.#byId(pid);
    const dev = this.devices.get(deviceId);
    if (!p || !dev || p.spectator || p.deviceId !== deviceId) return false;
    this.#inkFrom = deviceId;
    let ok = false;
    try { ok = this.session.ink(pid, payload); } finally { this.#inkFrom = null; }
    if (!ok && (dev.local || dev.peerId) && this.nowFn() - (dev.lastInkFix ?? -Infinity) >= INK_RESYNC_MIN_MS) {
      dev.lastInkFix = this.nowFn();
      this.#sendInkSync(dev);   // undo the sender's optimistic strokes (throttled: a stuck client must not flood us)
    }
    return ok;
  }

  #relayInk(batch) {
    if (!this.session) return;
    if (!batch) {
      for (const dev of this.devices.values()) if (dev.local || dev.peerId) this.#sendInkSync(dev);
      return;
    }
    for (const dev of this.devices.values()) {
      if (dev.id === this.#inkFrom || (!dev.local && !dev.peerId)) continue;
      this.#send(dev, { t: 'ink', ...batch });
    }
  }

  #onSessionChange() {
    this.#batch(() => {
      this.#mark(false, true);
      if (this.phase === 'playing' && this.session) {
        const res = this.session.result();
        if (res) this.#finish(res);
      }
      this.#refreshStalls();
    });
  }

  #finish(res) {
    const winners = Array.isArray(res.winners) ? res.winners.map(String) : [];
    const points = isObj(res.points) ? res.points : {};
    this.session.stop();
    this.phase = 'results';
    for (const p of this.#seated()) {
      const sb = (this.scoreboard[p.id] ??= { played: 0, wins: 0, points: 0 });
      sb.played += 1;
      if (winners.includes(p.id)) sb.wins += 1;
      sb.points += Number(points[p.id]) || 0;
    }
    this.lastResult = {
      gameId: this.gameId, winners, summary: String(res.summary ?? ''),
      lines: Array.isArray(res.lines) ? clone(res.lines) : [], points: clone(points),
    };
    this.history.push({ gameId: this.gameId, winners: [...winners], summary: this.lastResult.summary });
    if (this.history.length > HISTORY_MAX) this.history.splice(0, this.history.length - HISTORY_MAX);
    this.waiting.clear();
    this.#mark();
  }

  // ============================================================
  // results → next
  // ============================================================

  #endSession() {
    this.session?.stop();
    this.session = null;
    this.waiting.clear();
  }

  /** Spectators sit down, orphaned (kicked/left) seats go. */
  #promote() {
    this.players = this.players.filter((p) => !p.kicked);
    for (const p of this.players) p.spectator = false;
    this.#renumber();
    this.#gcDevices();
  }

  /** 再玩一局: same game, same table (spectators now play). Falls back to the lobby if it no longer fits. */
  again() {
    if (this.phase !== 'results') return fail('未玩完');
    return this.#batch(() => {
      this.#endSession();
      this.#promote();
      this.phase = 'lobby';
      this.#afterHeadcount();
      const r = this.#begin();
      this.#mark(true, true);
      return r;
    });
  }

  /** 換遊戲 — also works as "abort" while playing (nothing is scored). */
  toLobby() {
    if (this.phase === 'lobby') return fail('已經喺大廳');
    return this.#batch(() => {
      this.#endSession();
      this.#promote();
      this.phase = 'lobby';
      this.#afterHeadcount();
      this.#mark(true, true);
      this.#refreshStalls();
      return { ok: true, message: '' };
    });
  }

  // ============================================================
  // host controls
  // ============================================================

  pause() {
    if (this.phase !== 'playing' || !this.session) return false;
    return this.#batch(() => {
      const ok = this.session.pause();
      this.#mark();
      this.#refreshStalls();
      return ok;
    });
  }

  resume() {
    if (this.phase !== 'playing' || !this.session) return false;
    return this.#batch(() => {
      const ok = this.session.resume();
      this.#mark(true, true);
      this.#refreshStalls();
      return ok;
    });
  }

  next() {
    if (this.phase !== 'playing' || !this.session) return false;
    return this.#batch(() => this.session.next());
  }

  cueDone(id) {
    if (this.phase !== 'playing' || !this.session) return false;
    return this.#batch(() => this.session.cueDone(id));
  }

  /** 代佢做: act for a seat that is not answering. */
  autoAct(pid) {
    const p = this.#byId(pid);
    if (this.phase !== 'playing' || !this.session || !p || p.spectator) return false;
    return this.#batch(() => this.session.dispatch(HOST, { type: '@auto', pid }));
  }

  setNarrationMode(mode) {
    if (!NARRATION_MODES.includes(mode)) return false;
    return this.#batch(() => {
      this.narration.mode = mode;
      this.session?.setNarrationMode(mode);
      this.#mark();
      return true;
    });
  }

  /** The page came back to the foreground: timers may have been throttled. */
  poke() { this.session?.poke(); this.#batch(() => this.#refreshStalls()); }

  // ============================================================
  // stall detection
  // ============================================================

  /**
   * A seat is "waited on" when its phone is away AND the engine would accept an action from it.
   * The clock restarts whenever the game state changes, so only a table that is genuinely idle on
   * that seat gets flagged, after stallMs.
   */
  #refreshStalls() {
    if (this.#stallTimer !== null) { this.timers.clearTimeout(this.#stallTimer); this.#stallTimer = null; }
    const s = this.session;
    const now = this.nowFn();
    const live = new Set();
    if (s && this.phase === 'playing' && !s.paused) {
      for (const p of this.#seated()) {
        if (p.connected) continue;
        if (!s.legal(p.id).length) continue;
        live.add(p.id);
        const w = this.waiting.get(p.id);
        if (!w || w.rev !== s.rev) this.waiting.set(p.id, { since: now, rev: s.rev });
      }
    }
    for (const pid of [...this.waiting.keys()]) if (!live.has(pid)) this.waiting.delete(pid);

    const sig = JSON.stringify(this.#stalledList());
    if (sig !== this.#stallSig) { this.#stallSig = sig; this.#mark(); }

    const limit = this.#stallLimit();
    let next = Infinity;
    for (const w of this.waiting.values()) if (w.since + limit > now) next = Math.min(next, w.since + limit - now);
    if (Number.isFinite(next)) {
      this.#stallTimer = this.timers.setTimeout(() => {
        this.#stallTimer = null;
        if (!this.#disposed) this.#batch(() => this.#refreshStalls());
      }, next);
    }
  }

  #stallLimit() {
    const v = this.config?.stallMs;
    return Number.isFinite(v) && v > 0 ? v : this.stallMs;
  }

  #stalledList() {
    const now = this.nowFn();
    const limit = this.#stallLimit();
    const out = [];
    for (const [pid, w] of this.waiting) if (now - w.since >= limit) out.push({ pid, since: w.since });
    return out;
  }

  // ============================================================
  // persistence & shutdown
  // ============================================================

  /** Everything needed to rebuild this room under the same code. Contains tokens: device-local storage only. */
  snapshot() {
    return {
      v: 2,
      savedAt: this.nowFn(),
      code: this.code,
      hostDeviceId: this.hostDeviceId,
      hostPid: this.hostPid,
      pidSeq: this.pidSeq,
      players: this.players.map((p) => ({ ...p, connected: false })),
      phase: this.phase,
      gameId: this.gameId,
      config: clone(this.config),
      configDirty: this.configDirty,
      lastConfigs: clone(this.lastConfigs),
      scoreboard: clone(this.scoreboard),
      history: clone(this.history),
      lastResult: this.lastResult ? clone(this.lastResult) : null,
      narration: { mode: this.narration.mode },
      rev: this.rev,
      banned: [...this.banned],
      session: this.session ? this.session.snapshot() : null,
    };
  }

  /** The host left on purpose: tell every device, stop every timer. */
  close(reason = '房主解散咗房') {
    if (this.#disposed) return;
    for (const dev of this.devices.values()) if (!dev.local && dev.peerId) this.#send(dev, { t: 'reject', reason });
    this.dispose();
  }

  dispose() {
    this.#disposed = true;
    this.session?.stop();
    if (this.#stallTimer !== null) { this.timers.clearTimeout(this.#stallTimer); this.#stallTimer = null; }
  }

  // ---------- small read-only helpers for the app / tests ----------
  /** The narration line the table is on right now (null if none, paused, or not playing). */
  currentCue() {
    return this.phase === 'playing' && this.session && !this.session.paused ? this.session.cue() : null;
  }
  get seatedCount() { return this.#seated().length; }
  player(pid) { return this.#byId(pid) ? this.#publicPlayer(this.#byId(pid)) : null; }
  seatsOfDevice(deviceId) { return this.#seatsOf(deviceId).map((p) => p.id); }
  deviceOfPeer(peerId) { return this.#deviceByPeer(peerId)?.id ?? null; }
}
