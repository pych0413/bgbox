// ============================================================
// transport.js — thin, testable wrappers over the PeerJS nets in net.js.
//
// Room and createApp only ever talk to these two classes, so a test can hand
// them an in-memory net (anything shaped like HostNet / ClientNet) and run a
// whole host + client conversation in Node.
//
// Wire format: every message is a plain JSON object with a string `t` (the
// message type, DESIGN §8). Anything else is dropped here, before it reaches
// the Room. Local play (one device) has no transport at all — createApp calls
// the Room directly.
//
// Big messages (G23). PeerJS 'json' connections send one DataChannel message
// per send(), and a browser refuses (throws → silently dropped) a message over
// the peer's SCTP max-message-size — as low as 64 KB on some WebKit builds.
// So the host splits any message whose JSON is over CHUNK_OVER code units into
//   { t: 'chunk', id, i, n, data }   (data = a slice of the JSON text)
// and ClientTransport reassembles them in order before emitting the original
// message. Only host → client is chunked: nothing a client may send is large
// (the Room caps actions at 8 KB and ink batches at 400 points).
// ============================================================

import { HostNet, ClientNet } from './net.js?v=1';

export const PROTOCOL = 2;

/** Messages whose JSON is longer than this (UTF-16 units) are chunked. Worst case 3 bytes/unit ≈ 60 KB. */
export const CHUNK_OVER = 20_000;
/** Slice size; even all-CJK (3 B) or all-escaped (2 units) it stays well under 64 KB on the wire. */
export const CHUNK_SIZE = 12_000;
/** Refuse to send anything bigger than this at all (a bug, not a game). */
export const MESSAGE_MAX = 4_000_000;
const MAX_PARTS = Math.ceil(MESSAGE_MAX / CHUNK_SIZE);

const isMessage = (m) => m !== null && typeof m === 'object' && !Array.isArray(m) && typeof m.t === 'string';

/**
 * Split `msg` into wire messages: [msg] itself when small, else chunk messages.
 * Returns null if it cannot be serialised or is absurdly large.
 */
export function packMessage(msg, id) {
  let json;
  try { json = JSON.stringify(msg); } catch { return null; }
  if (typeof json !== 'string') return null;
  if (json.length <= CHUNK_OVER) return [msg];
  if (json.length > MESSAGE_MAX) return null;
  const parts = [];
  for (let at = 0; at < json.length;) {
    let end = Math.min(json.length, at + CHUNK_SIZE);
    // never cut a surrogate pair in two
    if (end < json.length && /[\uDC00-\uDFFF]/.test(json[end])) end--;
    parts.push(json.slice(at, end));
    at = end;
  }
  return parts.map((data, i) => ({ t: 'chunk', id, i, n: parts.length, data }));
}

/** Reassembles chunk messages; feed() returns the original message when its last part arrives, else null. */
export function makeUnpacker() {
  let cur = null;   // { id, n, parts: [] }
  return {
    feed(m) {
      if (!Number.isInteger(m.i) || !Number.isInteger(m.n) || m.n < 1 || m.n > MAX_PARTS || typeof m.data !== 'string') return null;
      if (m.i === 0) cur = { id: m.id, n: m.n, parts: [] };
      if (!cur || cur.id !== m.id || cur.n !== m.n || m.i !== cur.parts.length) { cur = null; return null; }   // out of order: drop it
      cur.parts.push(m.data);
      if (cur.parts.length < cur.n) return null;
      const text = cur.parts.join('');
      cur = null;
      try { const out = JSON.parse(text); return isMessage(out) ? out : null; } catch { return null; }
    },
    reset() { cur = null; },
  };
}

class Emitter {
  #h = new Map();
  on(ev, fn) { (this.#h.get(ev) ?? this.#h.set(ev, []).get(ev)).push(fn); return this; }
  off(ev, fn) { this.#h.set(ev, (this.#h.get(ev) ?? []).filter((f) => f !== fn)); return this; }
  emit(ev, ...args) {
    for (const fn of this.#h.get(ev) ?? []) {
      try { fn(...args); } catch (e) { console.error(`[transport] ${ev} handler threw`, e); }
    }
  }
}

/**
 * Host side. Events:
 *   'message' (peerId, msg)   a well-formed message from a remote device
 *   'open'    (peerId)        a data channel opened
 *   'close'   (peerId)        a data channel closed — or went silent past the heartbeat (net.js)
 *   'status'  (kind, err?)    'online' | 'reconnecting' | 'error'  (signalling server)
 * `opts` ({ log, timers, … }) go to the default HostNet; an injected net ignores them.
 */
export class HostTransport extends Emitter {
  constructor(net = null, opts = {}) {
    super();
    net ??= new HostNet(opts);
    this.net = net;
    this.code = null;
    this.chunkSeq = 0;
    net.on('message', (peerId, msg) => { if (isMessage(msg)) this.emit('message', peerId, msg); });
    net.on('peer-open', (peerId) => this.emit('open', peerId));
    net.on('peer-close', (peerId) => this.emit('close', peerId));
    net.on('status', (kind, err) => this.emit('status', kind, err));
  }

  /** Claim a room code. `preferred` reuses a code (host refreshed); null picks a fresh one. */
  async open(preferred = null) {
    this.code = await this.net.open(preferred);
    return this.code;
  }

  /** @returns {boolean} false if the peer is gone (or the message could not be sent at all) */
  send(peerId, msg) {
    const wire = packMessage(msg, ++this.chunkSeq);
    if (!wire) { console.error('[transport] message too large or not JSON; dropped', msg?.t); return false; }
    let ok = true;
    for (const m of wire) ok = this.net.sendTo(peerId, m) && ok;
    return ok;
  }

  /** The page is back (visible / pageshow / online): fresh heartbeat windows, signalling back now. */
  resume(reason) { this.net.resume?.(reason); }

  close() { this.net.close(); }
}

/**
 * Client side. Events:
 *   'message' (msg)
 *   'rx' ()                   any wire message arrived, chunk parts included — the host is alive (heartbeat)
 *   'open' ()                 data channel open — fires on every (re)connect, so say hello again
 *   'status' (kind, err?)     'online' | 'offline' | 'reconnecting' | 'host-gone' | 'error'
 */
export class ClientTransport extends Emitter {
  constructor(net = null, opts = {}) {
    super();
    net ??= new ClientNet(opts);
    this.net = net;
    const unpack = makeUnpacker();
    net.on('message', (msg) => {
      if (!isMessage(msg)) return;
      this.emit('rx');
      if (msg.t !== 'chunk') { this.emit('message', msg); return; }
      const whole = unpack.feed(msg);
      if (whole) this.emit('message', whole);
    });
    net.on('open', () => { unpack.reset(); this.emit('open'); });
    net.on('status', (kind, err) => this.emit('status', kind, err));
  }

  /** Resolves once the channel is open (the 'open' event has already fired by then). */
  connect(code) { return this.net.connect(code); }

  send(msg) { return this.net.send(msg); }

  /** The host went quiet: drop the channel and dial again now. false if the net cannot (or is closed). */
  reset(reason) { return typeof this.net.reset === 'function' ? !!this.net.reset(reason) : false; }

  /** The page came back / the network returned: if there is no channel, dial now (not in up to 6 s). */
  nudge(reason) { return typeof this.net.nudge === 'function' ? !!this.net.nudge(reason) : false; }

  close() { this.net.close(); }
}
