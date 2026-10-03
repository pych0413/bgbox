// ============================================================
// net.js — WebRTC transport over the public PeerJS cloud.
//
// Topology: star. The host's phone IS the server; every other phone
// opens one reliable DataChannel to it. No accounts, no backend.
//
// The room code doubles as the host's PeerJS id, so joining is just
// "connect to bgbox-v2-<CODE>".
//
// The namespace changed from v1's `cheesethief-v1-` (G7): a v2 phone can never
// dial a v1 host (which would seat it as a nameless ghost) and a phone still
// running v1 simply does not find a v2 room. Hosts also refuse a v1-shaped
// hello politely, should one ever get through.
//
// Liveness (iOS). A phone that locks or switches app has its page suspended; its
// DataChannel dies, often WITHOUT a 'close' event on either side, and its socket to
// the signalling server dies too. So nothing here trusts 'close' alone:
//   client  the app pings every 4 s (client.js) and calls reset() when the host goes
//           quiet; nudge() on every return to the foreground. A re-dial reconnects a
//           Peer that lost the signalling server, replaces one that was destroyed, and
//           never gives up on a transient PeerJS error — only close() stops it.
//   host    records when each phone was last heard from; a phone on the 4 s heartbeat
//           (its pings carry `hb`) that is silent for HOST_SILENT_MS while this page is
//           visible is closed, as if its channel had closed. Time this page spent hidden
//           never counts (resume() gives everyone a fresh window). resume() also puts the
//           room back on the signalling server — reconnecting, or re-claiming the same code
//           if the Peer was destroyed — so phones can re-dial the same four dice.
// Every event worth knowing about afterwards goes to `log` (the ⚙️ 連線記錄); ids are
// shortened there and no token ever is.
// ============================================================

import { makeRoomCode } from './util.js?v=1';

export const PEER_NS = 'bgbox-v2-';
export const peerIdFor = (code) => PEER_NS + String(code);

/** True when the PeerJS script has loaded. Only multi-phone rooms need it; one-phone play never asks. */
export const hasPeer = () => typeof globalThis.Peer === 'function';

/** Host: a heartbeat phone silent this long (while the host page is visible) is treated as gone. */
export const HOST_SILENT_MS = 15_000;
/** Host: how often the liveness / signalling watchdog runs. */
export const HOST_SWEEP_MS = 3000;
/** Client: one dial waits this long for the channel to open. */
export const DIAL_TIMEOUT_MS = 15_000;
/** Client: the first connect() keeps trying (a host that is just refreshing) for this long. */
export const CONNECT_MS = 15_000;
/** Waiting for a Peer to be open on the signalling server. */
export const PEER_OPEN_MS = 10_000;

/** PeerJS errors that no retry can fix. Everything else (network, socket-*, server-error, disconnected, webrtc…) is weather. */
const FATAL = new Set(['browser-incompatible', 'invalid-id', 'invalid-key', 'ssl-unavailable']);
export const isFatalPeerError = (err) => FATAL.has(err?.type);

// STUN gets us through most NATs; the free TURN relays rescue the
// carrier-grade NATs that mobile data loves to sit behind.
const ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80',            username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443',           username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

class Emitter {
  #handlers = new Map();
  on(ev, fn) { (this.#handlers.get(ev) ?? this.#handlers.set(ev, []).get(ev)).push(fn); return this; }
  emit(ev, ...args) { for (const fn of this.#handlers.get(ev) ?? []) { try { fn(...args); } catch (e) { console.error(e); } } }
}

function newPeer(id) {
  return new Peer(id, { debug: 1, config: ICE });
}

const realTimers = () => ({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
});
const pageHidden = () => !!globalThis.document?.hidden;
const noop = () => {};

/** A peer id for the log: the room code for a room, the first 6 characters otherwise. Never a token. */
export const shortId = (id) => {
  const s = String(id ?? '');
  return s.startsWith(PEER_NS) ? s.slice(PEER_NS.length) : s.slice(0, 6);
};
const why = (err) => String(err?.type || err?.message || err || 'unknown').slice(0, 60);
const secs = (ms) => `${Math.round(ms / 100) / 10} s`;

/** Resolve once the peer is open, or reject with the PeerJS error (or after `ms`, when timers are given). */
function peerReady(peer, t = null, ms = 0) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const ok = (id) => { cleanup(); resolve(id); };
    const bad = (err) => { cleanup(); reject(err); };
    const cleanup = () => { peer.off?.('open', ok); peer.off?.('error', bad); if (timer !== null) t.clearTimeout(timer); };
    peer.on('open', ok);
    peer.on('error', bad);
    if (t && ms) timer = t.setTimeout(() => { timer = null; bad(Object.assign(new Error('signalling server too slow'), { type: 'timeout' })); }, ms);
  });
}

// ------------------------------------------------------------
// HOST
// ------------------------------------------------------------
export class HostNet extends Emitter {
  /**
   * @param {object} [o]
   * @param {object} [o.timers]    { setTimeout, clearTimeout, setInterval, clearInterval } (tests)
   * @param {Function} [o.now]     () => ms
   * @param {Function} [o.isHidden] () => is this page hidden now? (default: document.hidden)
   * @param {Function} [o.makePeer] (id) => Peer (tests)
   * @param {Function} [o.log]     (text) => void — the connection log
   */
  constructor(o = {}) {
    super();
    this.peer = null; this.code = null; this.conns = new Map();
    this.seen = new Map();     // peerId → when it was last heard from (ms)
    this.beats = new Set();    // peerIds on the 4 s heartbeat (pings carry `hb`): only these are timed out — an older build pings every 15 s
    this.t = { ...realTimers(), ...(o.timers ?? {}) };
    this.now = o.now ?? (() => Date.now());
    this.isHidden = o.isHidden ?? pageHidden;
    this.makePeer = o.makePeer ?? newPeer;
    this.log = o.log ?? noop;
    this.closed = false;
    this._watch = null;
    this._reclaim = null;
    this._lastTick = 0;
    this._wasHidden = false;
    this._reconnectAt = -Infinity;
  }

  #sleep(ms) { return new Promise((r) => this.t.setTimeout(r, ms)); }

  /** Claim `preferred` (or a fresh code) on the signalling server; resolves { peer, code } without wiring it. */
  async #claim(preferred, tries) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      if (this.closed) throw new Error('closed');
      const code = preferred ?? makeRoomCode();
      const peer = this.makePeer(peerIdFor(code));
      try {
        await peerReady(peer);
        return { peer, code };
      } catch (err) {
        lastErr = err;
        try { peer.destroy(); } catch { /* already dead */ }
        if (err?.type === 'unavailable-id') {
          // Reclaiming our own id: the server holds it for a few seconds
          // after a refresh, so wait it out instead of changing the code.
          if (preferred) { await this.#sleep(1200 * (i + 1)); continue; }
          continue; // fresh room: just try another code
        }
        if (err?.type === 'network' || err?.type === 'server-error' || err?.type === 'socket-error' || err?.type === 'socket-closed') {
          await this.#sleep(700 * (i + 1));
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error('開唔到房');
  }

  /**
   * Claim a room code on the signalling server.
   * @param {string|null} preferred reuse this code (host refreshed the page); null = pick a fresh one
   */
  async open(preferred = null) {
    const { peer, code } = await this.#claim(preferred, preferred ? 6 : 14);   // only 1296 codes exist, so collisions are normal
    if (this.closed) { try { peer.destroy(); } catch { /* gone */ } throw new Error('closed'); }
    this.peer = peer;
    this.code = code;
    this.#wire(peer);
    this.#startWatch();
    this.log(`host: room ${code} open`);
    return code;
  }

  #wire(peer) {
    peer.on('connection', (conn) => {
      // v2: a phone on flaky data re-dials before the host notices the old channel died. The old
      // channel's late 'close' must not evict the new one, so every handler checks it is still current.
      const current = () => this.conns.get(conn.peer) === conn;
      conn.on('open', () => {
        if (this.closed) { try { conn.close(); } catch { /* gone */ } return; }
        const old = this.conns.get(conn.peer);
        this.conns.set(conn.peer, conn);
        this.seen.set(conn.peer, this.now());
        if (old && old !== conn) { try { old.close(); } catch { /* already dead */ } }
        this.emit('peer-open', conn.peer);
      });
      conn.on('data', (msg) => {
        if (!current()) return;
        this.seen.set(conn.peer, this.now());
        if (msg && msg.t === 'ping' && msg.hb) this.beats.add(conn.peer);
        this.emit('message', conn.peer, msg);
      });
      conn.on('close', () => this.#gone(conn));
      conn.on('error', () => this.#gone(conn));
    });

    peer.on('disconnected', () => {
      if (this.peer !== peer || this.closed) return;
      this.emit('status', 'reconnecting');
      this.#reconnect('signalling lost');
    });
    peer.on('open', () => { if (this.peer === peer && !this.closed) { this.log('host: signalling online'); this.emit('status', 'online'); } });
    peer.on('error', (err) => {
      if (this.peer !== peer || this.closed) return;
      // peer-unavailable just means one client vanished; not fatal for the room.
      if (err?.type === 'peer-unavailable') return;
      this.log(`host: peer error ${why(err)}`);
      // Only a hopeless error is an error. The rest is the signalling socket coming and going (PeerJS follows
      // those with 'disconnected', handled above) or one phone's negotiation failing: the phones already
      // connected keep talking, and the watchdog puts the room back on the server.
      if (isFatalPeerError(err)) this.emit('status', 'error', err);
    });
  }

  /** The data channel `conn` is finished (closed, errored, or timed out by us). */
  #gone(conn) {
    if (this.conns.get(conn.peer) !== conn) return;
    this.conns.delete(conn.peer);
    this.seen.delete(conn.peer);
    this.beats.delete(conn.peer);
    this.emit('peer-close', conn.peer);
  }

  /** Treat a silent channel as closed: same path as a real close, then close it for real. */
  #drop(conn, reason) {
    if (this.conns.get(conn.peer) !== conn) return;
    this.log(`host: phone ${shortId(conn.peer)} ${reason} → closed`);
    this.#gone(conn);
    try { conn.close(); } catch { /* already dead */ }
  }

  /** Give every phone a fresh window: time this page could not hear anyone does not count against them. */
  #freshen() {
    const now = this.now();
    for (const id of this.conns.keys()) this.seen.set(id, now);
  }

  #reconnect(reason, force = false) {
    const p = this.peer;
    if (!p || p.destroyed || this.closed) return;
    const now = this.now();
    if (!force && now - this._reconnectAt < 2000) return;    // a socket that fails at once must not spin; the watchdog comes back
    this._reconnectAt = now;
    this.log(`host: reconnect to signalling (${reason})`);
    try { p.reconnect(); } catch { /* the watchdog tries again */ }
  }

  /** The Peer was destroyed: claim the same code again so the phones can re-dial the same four dice. */
  #reclaimCode(reason) {
    if (this.closed || !this.code || this._reclaim) return this._reclaim;
    this.log(`host: peer gone (${reason}) → re-claim room ${this.code}`);
    this.emit('status', 'reconnecting');
    const old = this.peer;
    this._reclaim = this.#claim(this.code, 6).then(({ peer }) => {
      this._reclaim = null;
      if (this.closed) { try { peer.destroy(); } catch { /* gone */ } return false; }
      if (old && old !== peer) { try { old.destroy(); } catch { /* gone */ } }
      this.peer = peer;
      this.#wire(peer);
      this.log(`host: room ${this.code} re-claimed`);
      this.emit('status', 'online');
      return true;
    }, (err) => {
      this._reclaim = null;
      if (!this.closed) this.log(`host: re-claim failed (${why(err)}); the watchdog tries again`);
      return false;
    });
    return this._reclaim;
  }

  #startWatch() {
    if (this._watch !== null) return;
    this._lastTick = this.now();
    this._watch = this.t.setInterval(() => this.tick(), HOST_SWEEP_MS);
  }

  /** The watchdog (every HOST_SWEEP_MS; public for tests): signalling, then silent phones. */
  tick() {
    if (this.closed) return;
    const now = this.now();
    const late = now - this._lastTick > HOST_SWEEP_MS * 3;   // this page's timers were frozen (locked, suspended)
    this._lastTick = now;

    // Signalling sockets die silently when a phone sleeps. Nudge it back.
    const p = this.peer;
    if (!p || p.destroyed) this.#reclaimCode('watchdog');
    else if (p.disconnected) this.#reconnect('watchdog');

    if (this.isHidden()) { this._wasHidden = true; return; }   // nothing is judged while this page is hidden
    if (late || this._wasHidden) {
      this._wasHidden = false;
      this.#freshen();
      return;
    }
    for (const [id, conn] of [...this.conns]) {
      if (!this.beats.has(id)) continue;
      const quiet = now - (this.seen.get(id) ?? now);
      if (quiet > HOST_SILENT_MS) this.#drop(conn, `silent for ${secs(quiet)}`);
    }
  }

  /**
   * This page is back (visible, pageshow, online): fresh windows for every phone, and the room back on
   * the signalling server right away — reconnect, or re-claim the same code if the Peer was destroyed.
   */
  resume(reason = 'resume') {
    if (this.closed || !this.code) return;
    this._wasHidden = false;
    this._lastTick = this.now();
    this.#freshen();
    const p = this.peer;
    if (!p || p.destroyed) this.#reclaimCode(reason);
    else if (p.disconnected) this.#reconnect(reason, true);
  }

  sendTo(peerId, msg) {
    const c = this.conns.get(peerId);
    if (c?.open) { try { c.send(msg); return true; } catch { /* dropped */ } }
    return false;
  }

  broadcast(msg) { for (const id of this.conns.keys()) this.sendTo(id, msg); }

  close() {
    this.closed = true;
    if (this._watch !== null) { this.t.clearInterval(this._watch); this._watch = null; }
    for (const c of this.conns.values()) { try { c.close(); } catch { /* ignore */ } }
    this.conns.clear();
    this.seen.clear();
    this.beats.clear();
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.peer = null;
  }
}

// ------------------------------------------------------------
// CLIENT
// ------------------------------------------------------------
/**
 * Events: 'message' (msg) · 'open' () on every (re)connect · 'status' (kind, err?):
 *   'online'        the channel to the host is open
 *   'offline'       it closed (a re-dial is scheduled at once)
 *   'reconnecting'  a re-dial is scheduled
 *   'host-gone'     a re-dial is scheduled, and the last one found no host under that code
 *   'error'         hopeless (a browser without WebRTC…) — the only status that stops the retries
 */
export class ClientNet extends Emitter {
  /** @param {object} [o] { timers, now, makePeer, log } — see HostNet */
  constructor(o = {}) {
    super();
    this.peer = null; this.conn = null; this.code = null; this.dead = false;
    this.retries = 0;
    this.t = { ...realTimers(), ...(o.timers ?? {}) };
    this.now = o.now ?? (() => Date.now());
    this.makePeer = o.makePeer ?? newPeer;
    this.log = o.log ?? noop;
    this._retryTimer = null;
    this._busy = false;        // a dial attempt is in flight
    this._connecting = false;  // connect() is running its own tries: no background retries meanwhile
    this._failDial = null;     // fails the in-flight dial early (the host is not there)
  }

  /** First connection. Keeps trying for CONNECT_MS (the host may be mid-refresh), then rejects with the last error. */
  async connect(code) {
    this.code = String(code);
    this.dead = false;
    this._connecting = true;
    const t0 = this.now();
    try {
      for (let i = 1; ; i++) {
        try { await this.#attempt(); return; } catch (err) {
          if (this.dead || isFatalPeerError(err) || this.now() - t0 >= CONNECT_MS) throw err;
          if (err?.type === 'peer-unavailable') this.emit('status', 'host-gone');
          await new Promise((r) => this.t.setTimeout(r, Math.min(1000 * i, 3000)));
          if (this.dead) throw err;
        }
      }
    } finally { this._connecting = false; }
  }

  /** One try: a Peer that is open on the signalling server, then a channel to the host. */
  async #attempt() {
    this._busy = true;
    try {
      await this.#ensurePeer();
      await this.#dial();
    } finally { this._busy = false; }
  }

  /** A Peer open on the signalling server: the same one, reconnected if it lost the server, or a new one if destroyed. */
  async #ensurePeer() {
    let p = this.peer;
    let fresh = false;
    if (!p || p.destroyed) {
      if (p) this.log('client: peer destroyed → new peer');
      p = this.peer = this.makePeer(undefined);
      fresh = true;
      this.#wirePeer(p);
    } else if (p.disconnected) {
      this.log('client: reconnect to signalling');
      try { p.reconnect(); } catch { /* destroyed meanwhile: the next attempt replaces it */ }
    }
    if (fresh || p.open === false) await peerReady(p, this.t, PEER_OPEN_MS);
    if (this.dead) throw new Error('closed');
  }

  #wirePeer(p) {
    // The signalling socket is only needed to dial: a lost one is reconnected lazily, by the next
    // attempt or nudge(). The data channel does not depend on it.
    p.on('disconnected', () => { if (this.peer === p && !this.dead) this.log('client: signalling lost'); });
    p.on('error', (err) => {
      if (this.peer !== p || this.dead) return;
      if (err?.type === 'peer-unavailable') {
        // the room's code is not on the server (host page closed, locked, or refreshing): fail this dial now
        if (this._failDial) { this._failDial(err); return; }
      } else {
        this.log(`client: peer error ${why(err)}`);
        if (isFatalPeerError(err)) { this._failDial?.(err); if (!this.conn && !this._busy) this.emit('status', 'error', err); return; }
      }
      if (!this.conn && !this._busy) this.#scheduleRetry(null, err?.type === 'peer-unavailable' ? 'host-gone' : 'reconnecting');
    });
  }

  #dial() {
    return new Promise((resolve, reject) => {
      if (this.dead) { reject(new Error('closed')); return; }
      let conn;
      try { conn = this.peer.connect(peerIdFor(this.code), { reliable: true, serialization: 'json' }); } catch (e) { reject(e); return; }
      if (!conn) { reject(Object.assign(new Error('連唔到房主'), { type: 'disconnected' })); return; }

      let settled = false;
      const settle = (err) => {
        if (settled) return;
        settled = true;
        this.t.clearTimeout(timer);
        if (this._failDial === fail) this._failDial = null;
        if (err) reject(err); else resolve();
      };
      const fail = (err) => { settle(err); try { conn.close(); } catch { /* ignore */ } };   // settle first: a fake (or future) close() may emit 'close' at once
      this._failDial = fail;
      const timer = this.t.setTimeout(() => fail(Object.assign(new Error('連線逾時'), { type: 'timeout' })), DIAL_TIMEOUT_MS);

      conn.on('open', () => {
        if (settled || this.dead) { try { conn.close(); } catch { /* ignore */ } return; }
        this.conn = conn;
        this.retries = 0;
        this.log(`client: channel to ${shortId(peerIdFor(this.code))} open`);
        this.emit('status', 'online');
        this.emit('open');
        settle();
      });
      conn.on('data', (msg) => { if (this.conn === conn) this.emit('message', msg); });
      conn.on('close', () => {
        if (!settled) { settle(Object.assign(new Error('連線斷咗'), { type: 'closed' })); return; }
        if (this.conn !== conn) return;   // a stale channel closing after we already re-dialled (or gave it up)
        this.conn = null;
        this.log('client: channel closed');
        this.emit('status', 'offline');
        this.#scheduleRetry();
      });
      conn.on('error', (e) => { if (!settled) fail(e); /* after open: its 'close', or the app's heartbeat, decides */ });
    });
  }

  #scheduleRetry(ms = null, kind = 'reconnecting') {
    if (this.dead || this.conn || this._busy || this._connecting || this._retryTimer !== null) return;
    this.retries += 1;
    const wait = ms ?? Math.min(1000 * this.retries, 6000);
    this.emit('status', kind);
    this._retryTimer = this.t.setTimeout(() => {
      this._retryTimer = null;
      if (this.dead || this.conn || this._busy) return;
      this.log(`client: re-dial #${this.retries}`);
      this.#attempt().catch((err) => {
        if (this.dead) return;
        this.log(`client: re-dial failed (${why(err)})`);
        // never give up on the weather: only close() (leave, or a host 'reject') stops this
        this.#scheduleRetry(null, err?.type === 'peer-unavailable' ? 'host-gone' : 'reconnecting');
      });
    }, wait);
  }

  /** The app heard nothing from the host for too long: drop this channel (it is dead, closed or not) and dial again now. */
  reset(reason = '') {
    if (this.dead) return false;
    const c = this.conn;
    this.conn = null;                    // its late 'close' is now a stale channel's
    if (c) { try { c.close(); } catch { /* already dead */ } }
    this.log(`client: reset channel${reason ? ` (${reason})` : ''}`);
    if (this._retryTimer !== null) { this.t.clearTimeout(this._retryTimer); this._retryTimer = null; }
    this.retries = 0;
    this.#scheduleRetry(0);
    return true;
  }

  /** The page came back / the network returned: get the signalling socket back, and if there is no channel, dial now. */
  nudge(reason = '') {
    if (this.dead) return false;
    const p = this.peer;
    if (p && !p.destroyed && p.disconnected && !this._busy) {
      this.log(`client: reconnect to signalling (${reason || 'nudge'})`);
      try { p.reconnect(); } catch { /* the next attempt replaces it */ }
    }
    if (this.conn || this._busy) return false;
    if (this._retryTimer !== null) { this.t.clearTimeout(this._retryTimer); this._retryTimer = null; }
    this.#scheduleRetry(0);
    return true;
  }

  send(msg) {
    if (this.conn?.open) { try { this.conn.send(msg); return true; } catch { /* dropped */ } }
    return false;
  }

  close() {
    this.dead = true;
    if (this._retryTimer !== null) { this.t.clearTimeout(this._retryTimer); this._retryTimer = null; }
    this._failDial?.(new Error('closed'));
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conn = null; this.peer = null;
  }
}
