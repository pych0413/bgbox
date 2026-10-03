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
// ============================================================

import { HostNet, ClientNet } from './net.js?v=1';

export const PROTOCOL = 2;

const isMessage = (m) => m !== null && typeof m === 'object' && !Array.isArray(m) && typeof m.t === 'string';

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
 *   'close'   (peerId)        a data channel closed
 *   'status'  (kind, err?)    'online' | 'reconnecting' | 'error'  (signalling server)
 */
export class HostTransport extends Emitter {
  constructor(net = new HostNet()) {
    super();
    this.net = net;
    this.code = null;
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

  /** @returns {boolean} false if the peer is gone */
  send(peerId, msg) { return this.net.sendTo(peerId, msg); }

  close() { this.net.close(); }
}

/**
 * Client side. Events:
 *   'message' (msg)
 *   'open' ()                 data channel open — fires on every (re)connect, so say hello again
 *   'status' (kind, err?)     'online' | 'offline' | 'reconnecting' | 'host-gone' | 'error'
 */
export class ClientTransport extends Emitter {
  constructor(net = new ClientNet()) {
    super();
    this.net = net;
    net.on('message', (msg) => { if (isMessage(msg)) this.emit('message', msg); });
    net.on('open', () => this.emit('open'));
    net.on('status', (kind, err) => this.emit('status', kind, err));
  }

  /** Resolves once the channel is open (the 'open' event has already fired by then). */
  connect(code) { return this.net.connect(code); }

  send(msg) { return this.net.send(msg); }

  close() { this.net.close(); }
}
