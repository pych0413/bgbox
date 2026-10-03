// ============================================================
// tests/net.test.mjs — js/core/net.js liveness and recovery (the iOS lobby drops):
// HostNet / ClientNet against a fake PeerJS and fake timers.
//
//   node tests/run.mjs net
// ============================================================

import { test, assert } from './lib.mjs';
import {
  HostNet, ClientNet, HOST_SILENT_MS, HOST_SWEEP_MS, CONNECT_MS, peerIdFor, shortId,
} from '../js/core/net.js?v=1';

/** Deterministic timers + clock (same shape as core.test.mjs). */
class FakeClock {
  constructor(start = 1_700_000_000_000) { this.t = start; this.q = []; this.seq = 0; }
  now = () => this.t;
  setTimeout = (fn, ms = 0) => { const id = ++this.seq; this.q.push({ id, at: this.t + Math.max(0, ms), fn }); return id; };
  clearTimeout = (id) => { this.q = this.q.filter((x) => x.id !== id); };
  setInterval = (fn, ms) => { const id = ++this.seq; this.q.push({ id, at: this.t + ms, fn, every: ms }); return id; };
  clearInterval = (id) => this.clearTimeout(id);
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      let next = null;
      for (const x of this.q) if (x.at <= end && (!next || x.at < next.at || (x.at === next.at && x.id < next.id))) next = x;
      if (!next) break;
      this.t = Math.max(this.t, next.at);
      if (next.every) next.at += next.every; else this.q = this.q.filter((x) => x !== next);
      next.fn();
    }
    this.t = end;
  }
}

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
/** Advance in small steps, letting promise chains run in between (dials await peers, retries await dials). */
async function run(clock, ms, step = 100) {
  for (let left = ms; left > 0; left -= step) { clock.advance(Math.min(step, left)); await settle(); }
  await settle();
}

class Em {
  h = new Map();
  on(ev, fn) { (this.h.get(ev) ?? this.h.set(ev, []).get(ev)).push(fn); return this; }
  off(ev, fn) { this.h.set(ev, (this.h.get(ev) ?? []).filter((f) => f !== fn)); return this; }
  emit(ev, ...a) { for (const fn of [...(this.h.get(ev) ?? [])]) fn(...a); }
}

function fakeConn(peer) {
  const c = new Em();
  Object.assign(c, { peer, open: false, sent: [], closed: false });
  c.send = (m) => { c.sent.push(m); };
  c.close = () => { if (c.closed) return; c.closed = true; const was = c.open; c.open = false; if (was) c.emit('close'); };
  c.accept = () => { c.open = true; c.emit('open'); };          // the far side answered
  return c;
}

/**
 * A fake PeerJS world. `world.taken` = ids the server refuses (unavailable-id) for the next N claims;
 * `world.hostUp` = whether a dial to the room finds anyone (else peer-unavailable).
 */
function fakeWorld() {
  const world = { peers: [], taken: new Map(), seq: 0 };
  world.makePeer = (id) => {
    const p = new Em();
    Object.assign(p, {
      id: id ?? `c${++world.seq}aaaaaaaa`, destroyed: false, disconnected: false, open: false, reconnects: 0, dials: [],
      destroy() { p.destroyed = true; p.open = false; },
      disconnect() { p.disconnected = true; p.open = false; p.emit('disconnected'); },
      reconnect() {
        if (p.destroyed) throw new Error('This peer cannot reconnect: it has been destroyed');
        p.disconnected = false;
        p.reconnects++;
        queueMicrotask(() => { if (!p.destroyed) { p.open = true; p.emit('open', p.id); } });
      },
      connect(to) {
        if (p.disconnected) { p.emit('error', { type: 'disconnected' }); return undefined; }
        const c = fakeConn(to);
        p.dials.push(c);
        return c;
      },
    });
    world.peers.push(p);
    queueMicrotask(() => {
      const left = world.taken.get(p.id) ?? 0;
      if (left > 0) { world.taken.set(p.id, left - 1); p.emit('error', { type: 'unavailable-id' }); return; }
      p.open = true;
      p.emit('open', p.id);
    });
    return p;
  };
  return world;
}

// ============================================================
// HOST
// ============================================================

async function openHost({ hidden = () => false } = {}) {
  const clock = new FakeClock();
  const world = fakeWorld();
  const logs = [];
  const net = new HostNet({ timers: clock, now: clock.now, makePeer: world.makePeer, isHidden: hidden, log: (t) => logs.push(t) });
  const events = [];
  net.on('peer-open', (id) => events.push(`open:${id}`));
  net.on('peer-close', (id) => events.push(`close:${id}`));
  net.on('status', (k) => events.push(`status:${k}`));
  const code = await net.open('1352');
  const peer = world.peers.at(-1);
  /** A phone dials in; returns its conn (already open). */
  const phone = (id) => { const c = fakeConn(id); peer.emit('connection', c); c.accept(); return c; };
  return { clock, world, net, events, logs, code, peer, phone };
}

test('HostNet: a heartbeat phone silent 15 s is closed like a real close; pings keep it; an older build (no hb) is never timed out', async () => {
  const h = await openHost();
  const a = h.phone('phoneA');
  const old = h.phone('phoneOld');
  a.emit('data', { t: 'ping', c: 1, hb: 1 });
  old.emit('data', { t: 'ping', c: 1 });                       // a phone on the previous build: 15 s pings, no hb
  for (let i = 0; i < 10; i++) { h.clock.advance(4000); a.emit('data', { t: 'ping', c: i, hb: 1 }); }
  assert.deepEqual(h.events.filter((e) => e.startsWith('close')), [], '40 s of pings every 4 s: still here');

  h.clock.advance(HOST_SILENT_MS);                             // the phone locked: its channel is dead but never said so
  assert.equal(h.events.includes('close:phoneA'), false, 'not yet: silent for exactly the limit');
  h.clock.advance(HOST_SWEEP_MS);
  assert.ok(h.events.includes('close:phoneA'), 'silent past 15 s → peer-close, the same path as a real close');
  assert.equal(a.closed, true, 'and the channel is closed for real');
  assert.equal(h.net.sendTo('phoneA', { t: 'x' }), false);
  assert.ok(h.logs.some((l) => /phone phoneA silent for 1[5-8](\.\d)? s → closed/.test(l)), h.logs.join('\n'));
  a.emit('close');                                             // its late close event changes nothing
  assert.equal(h.events.filter((e) => e === 'close:phoneA').length, 1);

  h.clock.advance(5 * 60_000);
  assert.equal(h.events.includes('close:phoneOld'), false, 'no hb → never timed out (it pings every 15 s)');
  h.net.close();
});

test('HostNet: a hidden host judges nobody, and coming back gives every phone a fresh 15 s (resume, or a frozen watchdog tick)', async () => {
  let hidden = false;
  const h = await openHost({ hidden: () => hidden });
  const a = h.phone('phoneA');
  a.emit('data', { t: 'ping', c: 1, hb: 1 });
  hidden = true;                                               // the host phone locks for two minutes
  h.clock.advance(120_000);
  assert.deepEqual(h.events.filter((e) => e.startsWith('close')), [], 'nothing is judged while hidden');
  hidden = false;
  h.net.resume('visible');
  h.clock.advance(HOST_SILENT_MS - 1000);
  assert.deepEqual(h.events.filter((e) => e.startsWith('close')), [], 'a fresh window after coming back, not a mass drop');
  a.emit('data', { t: 'ping', c: 2, hb: 1 });                  // the phone answers: it was fine all along
  h.clock.advance(HOST_SILENT_MS);
  assert.deepEqual(h.events.filter((e) => e.startsWith('close')), []);
  h.clock.advance(HOST_SWEEP_MS * 2);
  assert.ok(h.events.includes('close:phoneA'), 'really silent after the fresh window → closed');

  // frozen timers without a visibility event (the interval just fires late): a fresh window too
  const b = h.phone('phoneB');
  b.emit('data', { t: 'ping', c: 1, hb: 1 });
  const due = h.net._watch;
  h.clock.clearInterval(due);                                  // freeze the watchdog…
  h.clock.advance(60_000);
  h.net.tick();                                                // …and let it run once, a minute late
  assert.equal(h.events.includes('close:phoneB'), false, 'a late tick freshens instead of judging');
  for (let i = 0; i < 4; i++) { h.clock.advance(HOST_SWEEP_MS); h.net.tick(); }
  assert.equal(h.events.includes('close:phoneB'), false, '12 s of on-time ticks after it');
  for (let i = 0; i < 2; i++) { h.clock.advance(HOST_SWEEP_MS); h.net.tick(); }
  assert.ok(h.events.includes('close:phoneB'), 'then judged as usual');
  h.net.close();
});

test('HostNet.resume: a disconnected Peer reconnects at once; a destroyed one re-claims the SAME code so phones can re-dial it', async () => {
  const h = await openHost();
  h.peer.disconnect();                                         // the signalling socket died while the phone slept
  assert.ok(h.events.includes('status:reconnecting'));
  const before = h.peer.reconnects;
  h.peer.disconnected = true;                                  // (the immediate reconnect failed again)
  h.net.resume('visible');
  assert.equal(h.peer.reconnects, before + 1, 'reconnect() at once, not on the next watchdog tick');
  await settle();
  assert.equal(h.events.at(-1), 'status:online');

  h.peer.destroy();                                            // gone for good
  h.world.taken.set(peerIdFor('1352'), 1);                     // the server still holds the id for a moment
  h.net.resume('pageshow');
  await settle();
  assert.equal(h.world.peers.length, 2, 'a new Peer under the same id');
  assert.equal(h.world.peers[1].id, peerIdFor('1352'));
  await run(h.clock, 1300);                                    // waits out unavailable-id, then claims it
  assert.equal(h.world.peers.length, 3);
  assert.equal(h.net.peer, h.world.peers[2]);
  assert.equal(h.net.code, '1352', 'the code never changes');
  assert.equal(h.events.at(-1), 'status:online');
  assert.ok(h.logs.some((l) => /re-claimed/.test(l)));
  const c = fakeConn('phoneA');                                // a phone re-dials the same four dice
  h.net.peer.emit('connection', c); c.accept();
  assert.ok(h.events.includes('open:phoneA'));
  h.net.close();
});

test('HostNet: a transient PeerJS error is not "error" (the watchdog recovers); a hopeless one is', async () => {
  const h = await openHost();
  h.peer.emit('error', { type: 'network' });
  h.peer.emit('error', { type: 'server-error' });
  h.peer.emit('error', { type: 'peer-unavailable' });
  assert.equal(h.events.includes('status:error'), false);
  h.peer.disconnected = true;
  h.clock.advance(HOST_SWEEP_MS);
  assert.ok(h.peer.reconnects >= 1, 'the watchdog reconnects');
  h.peer.emit('error', { type: 'browser-incompatible' });
  assert.equal(h.events.at(-1), 'status:error');
  h.net.close();
  h.clock.advance(60_000);
  assert.equal(h.net.peer, null, 'closed: no watchdog left running');
});

// ============================================================
// CLIENT
// ============================================================

function makeClient() {
  const clock = new FakeClock();
  const world = fakeWorld();
  const logs = [];
  const statuses = [];
  const net = new ClientNet({ timers: clock, now: clock.now, makePeer: world.makePeer, log: (t) => logs.push(t) });
  net.on('status', (k) => statuses.push(k));
  let opens = 0;
  net.on('open', () => { opens++; });
  /** The newest dial of the newest Peer. */
  const lastDial = () => world.peers.at(-1)?.dials.at(-1);
  return { clock, world, net, logs, statuses, lastDial, opens: () => opens };
}

async function connected() {
  const c = makeClient();
  const p = c.net.connect('1352');
  await settle();
  assert.equal(c.lastDial().peer, peerIdFor('1352'));
  c.lastDial().accept();
  await p;
  return c;
}

test('ClientNet: a transient PeerJS error never ends in "error" — it keeps re-dialling until close()', async () => {
  const c = await connected();
  const peer = c.world.peers[0];
  peer.emit('error', { type: 'network' });                     // "Lost connection to server." — the phone locked
  peer.disconnect();
  assert.equal(c.statuses.includes('error'), false, 'the channel is still fine: no error, no reconnecting');
  assert.deepEqual(c.statuses, ['online']);

  c.lastDial().close();                                        // later the channel goes too
  assert.deepEqual(c.statuses.slice(-2), ['offline', 'reconnecting']);
  await run(c.clock, 1000);
  assert.equal(peer.reconnects, 1, 'the re-dial first gets the signalling socket back');
  const d2 = c.lastDial();
  assert.ok(d2 && !d2.open, 'then dials the room again');
  peer.emit('error', { type: 'server-error' });                // weather during the retry
  d2.emit('error', new Error('negotiation failed'));
  await run(c.clock, 6000);
  assert.ok(c.lastDial() !== d2, 'still trying');
  c.lastDial().accept();
  assert.equal(c.statuses.at(-1), 'online');
  assert.equal(c.statuses.includes('error'), false);
  assert.equal(c.opens(), 2, 'open fires on every reconnect (the app says hello again)');

  c.net.close();
  const dials = peer.dials.length;
  await run(c.clock, 30_000, 1000);
  assert.equal(peer.dials.length, dials, 'closed: nothing dials any more');
});

test('ClientNet.reset: drops a silent (still "open") channel and dials again at once; a destroyed Peer is replaced', async () => {
  const c = await connected();
  const d1 = c.lastDial();
  c.world.peers[0].destroy();
  assert.equal(c.net.reset('no pong'), true);
  assert.equal(d1.closed, true, 'the dead channel is closed');
  assert.equal(c.statuses.includes('offline'), false, 'its own close is a stale channel\'s');
  await run(c.clock, 100);
  assert.equal(c.world.peers.length, 2, 'a destroyed Peer is replaced by a new one');
  const d2 = c.lastDial();
  assert.equal(d2.peer, peerIdFor('1352'));
  d2.accept();
  assert.equal(c.statuses.at(-1), 'online');
  assert.ok(c.logs.some((l) => /reset channel \(no pong\)/.test(l)));
  assert.ok(c.logs.some((l) => /peer destroyed → new peer/.test(l)));
  c.net.close();
  assert.equal(c.net.reset('late'), false, 'closed: reset does nothing');
});

test('ClientNet.nudge: no channel -> dial now, not after the backoff; a lost signalling socket is rejoined at once', async () => {
  const c = await connected();
  const peer = c.world.peers[0];
  c.lastDial().close();                                        // channel lost: first re-dial in 1 s
  await run(c.clock, 1000);
  assert.equal(peer.dials.length, 2);
  c.lastDial().emit('error', new Error('negotiation failed')); // that one failed: the next is 2 s away
  await settle();
  assert.equal(c.net.nudge('visible'), true);
  await run(c.clock, 100);
  assert.equal(peer.dials.length, 3, 'dialled at once');
  c.lastDial().accept();
  await settle();
  peer.disconnect();                                           // signalling lost while the channel is fine
  assert.equal(c.net.nudge('online'), false, 'a channel is open: no dial');
  assert.equal(peer.reconnects, 1, 'but the signalling socket is rejoined now, ready for the next re-dial');
  c.net.close();
});

test('ClientNet.connect: keeps trying a room whose host is not there yet (peer-unavailable fails a dial fast), then gives up', async () => {
  const c = makeClient();
  const p = c.net.connect('1352');
  await settle();
  const peer = c.world.peers[0];
  peer.emit('error', { type: 'peer-unavailable' });            // the host is still re-claiming its code
  await settle();
  assert.equal(c.statuses.at(-1), 'host-gone');
  await run(c.clock, 1000);
  assert.equal(peer.dials.length, 2, 'tried again a second later');
  c.lastDial().accept();
  await p;
  assert.equal(c.statuses.at(-1), 'online');
  c.net.close();

  const g = makeClient();
  let err = null;
  const q = g.net.connect('6666').catch((e) => { err = e; });
  for (let t = 0; t < CONNECT_MS + 5000 && !err; t += 250) {
    await settle();
    const d = g.lastDial();
    if (d && !d.closed && !d.failed) { d.failed = true; g.world.peers[0].emit('error', { type: 'peer-unavailable' }); }
    await run(g.clock, 250, 250);
  }
  await q;
  assert.ok(err, 'gives up');
  assert.equal(err.type, 'peer-unavailable');
  assert.ok(g.world.peers[0].dials.length >= 4, 'after several tries');
  g.net.close();
});

test('net: log ids are short and never a token', () => {
  assert.equal(shortId(peerIdFor('1352')), '1352');
  assert.equal(shortId('3f2a9c71-aaaa-bbbb'), '3f2a9c');
  assert.equal(shortId(undefined), '');
});
