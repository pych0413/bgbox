// ============================================================
// tests/core-leaf.test.mjs — the framework-polish changes to the small core
// modules: transport chunking (G23), sfx suppression (G13), narrator hooks and
// pre-flight (#1/#2), the PeerJS namespace (G7/G18), util without DOM helpers
// (G14) and storage-write results (G9), Session/Sim hostPid (G1) and carry,
// and the bag's reshuffle notice (#11).
//
// Kept apart from core.test.mjs (Room/createApp), which another pass edits.
//   node tests/run.mjs core-leaf
// ============================================================

import { test, assert, makePlayers, Sim } from './lib.mjs';
import { mulberry32, clone } from '../js/core/engine-kit.js';
import {
  HostTransport, ClientTransport, packMessage, makeUnpacker, CHUNK_OVER, CHUNK_SIZE, MESSAGE_MAX,
} from '../js/core/transport.js?v=1';
import * as sfxMod from '../js/core/sfx.js?v=1';
import { createNarrator, estimateMs, SAMPLE_LINE } from '../js/core/narrator.js?v=1';
import { PEER_NS, peerIdFor, hasPeer } from '../js/core/net.js?v=1';
import * as util from '../js/core/util.js?v=1';
import { Session } from '../js/core/session.js?v=1';
import { createBag } from '../js/core/bag.js?v=1';

// ============================================================
// transport: chunking big host → client messages (G23)
// ============================================================

/** A fat message: CJK, emoji (surrogate pairs) and escapes, `n` strokes long. */
function bigMessage(n) {
  const strokes = Array.from({ length: n }, (_, i) => ({
    id: `p2-${i}`, pid: 'p2', end: true, color: '#fff', note: `筆${i}🎨"\\`,
    pts: Array.from({ length: 30 }, (_, k) => [k * 7 % 1000, (i * 13 + k) % 1000]),
  }));
  return { t: 'inkSync', ink: { epoch: 3, strokes } };
}

test('transport: small messages go out as they are; big ones are chunked and reassemble exactly', () => {
  const small = { t: 'views', rev: 1, bySeat: {} };
  assert.deepEqual(packMessage(small, 1), [small], 'small: untouched (same object)');

  const big = bigMessage(400);
  const json = JSON.stringify(big);
  assert.ok(json.length > CHUNK_OVER, `fixture is big enough (${json.length})`);
  const parts = packMessage(big, 7);
  assert.ok(parts.length > 1);
  for (const [i, m] of parts.entries()) {
    assert.equal(m.t, 'chunk');
    assert.equal(m.id, 7);
    assert.equal(m.i, i);
    assert.equal(m.n, parts.length);
    assert.ok(m.data.length <= CHUNK_SIZE, 'every slice is at most CHUNK_SIZE');
    assert.ok(!/^[\uDC00-\uDFFF]/.test(m.data), 'no slice starts with half an emoji');
    assert.ok(!/[\uD800-\uDBFF]$/.test(m.data), 'no slice ends with half an emoji');
    assert.ok(JSON.stringify(m).length < 64_000 / 3 + 200, 'each wire message fits a 64 KB SCTP limit even at 3 bytes/unit');
  }
  const un = makeUnpacker();
  let out = null;
  for (const m of parts) { const r = un.feed(JSON.parse(JSON.stringify(m))); if (r) out = r; }
  assert.deepEqual(out, big);
});

test('transport: a missing or out-of-order chunk drops that message, and the next one still arrives', () => {
  const big = bigMessage(300);
  const a = packMessage(big, 1);
  const b = packMessage({ ...big, t: 'welcome' }, 2);
  const un = makeUnpacker();
  const got = [];
  const feed = (m) => { const r = un.feed(m); if (r) got.push(r.t); };
  feed(a[0]); feed(a[2]);                               // a[1] was lost
  for (const m of a.slice(3)) feed(m);
  for (const m of b) feed(m);
  assert.deepEqual(got, ['welcome'], 'the broken message is dropped, never mis-assembled');
  assert.equal(un.feed({ t: 'chunk', id: 3, i: 0, n: 2, data: 5 }), null, 'garbage is ignored');
  assert.equal(un.feed({ t: 'chunk', id: 3, i: 0, n: 1e9, data: '' }), null, 'absurd part counts are refused');
  assert.equal(packMessage({ t: 'x', blob: 'a'.repeat(MESSAGE_MAX + 1) }, 9), null, 'absurdly big: refused, not sent');
  const cyc = { t: 'x' }; cyc.self = cyc;
  assert.equal(packMessage(cyc, 9), null, 'not JSON: refused');
});

test('transport: HostTransport chunks on send and ClientTransport hands the client the whole message', () => {
  class Em {
    h = new Map();
    on(ev, fn) { (this.h.get(ev) ?? this.h.set(ev, []).get(ev)).push(fn); return this; }
    emit(ev, ...a) { for (const fn of this.h.get(ev) ?? []) fn(...a); }
  }
  const clientNet = new Em();
  clientNet.send = () => true;
  const wire = [];
  const hostNet = new Em();
  hostNet.sendTo = (peer, m) => { wire.push(JSON.parse(JSON.stringify(m))); clientNet.emit('message', wire.at(-1)); return true; };
  const ht = new HostTransport(hostNet);
  const ct = new ClientTransport(clientNet);
  const seen = [];
  ct.on('message', (m) => seen.push(m));

  const big = bigMessage(300);
  assert.equal(ht.send('peer1', big), true);
  assert.ok(wire.length > 1 && wire.every((m) => m.t === 'chunk'), 'chunked on the wire');
  assert.equal(ht.send('peer1', { t: 'pong', c: 1, hostNow: 2 }), true);
  assert.deepEqual(seen, [big, { t: 'pong', c: 1, hostNow: 2 }], 'in order, whole');

  // a reconnect in the middle of a chunked message: the half is thrown away
  const parts = packMessage(big, 99);
  clientNet.emit('message', parts[0]);
  clientNet.emit('open');
  for (const m of parts.slice(1)) clientNet.emit('message', m);
  assert.equal(seen.length, 2, 'a half message from before the reconnect never surfaces');

  hostNet.sendTo = () => false;
  assert.equal(ht.send('gone', big), false, 'a gone peer reports false');
});

// ============================================================
// sfx: the app's suppression is not the user's mute (G13)
// ============================================================

test('sfx: setSuppressed is independent of setMuted; force rings through suppression only', () => {
  const { setMuted, isMuted, setSuppressed, isSuppressed, audible, sfx, SOUND_NAMES } = sfxMod;
  try {
    setMuted(false); setSuppressed(false);
    assert.equal(audible(), true);
    setSuppressed(true);
    assert.equal(isSuppressed(), true);
    assert.equal(isMuted(), false, 'suppressing never touches the user\'s mute');
    assert.equal(audible(), false);
    assert.equal(audible({ force: true }), true, 'an alarm the whole table set rings through the night');
    setSuppressed(false);
    assert.equal(audible(), true, 'lifting the suppression restores exactly what the user had');

    setMuted(true);
    setSuppressed(true);
    setSuppressed(false);
    assert.equal(isMuted(), true, 'a muted user stays muted after a night');
    assert.equal(audible({ force: true }), false, 'force never beats the user\'s mute');
    for (const n of ['alarm', 'tick', 'warn', 'zero', 'tap', 'turn', 'ding', 'hint']) assert.ok(SOUND_NAMES.includes(n), `sound ${n}`);
    sfx('alarm'); sfx('alarm', { force: true }); sfx('nope');   // Node: no window, no AudioContext — never throws
  } finally { setMuted(false); setSuppressed(false); }
});

// ============================================================
// narrator: start/end reporting and the pre-flight helpers (#1, #2)
// ============================================================

const voice = (lang, name = lang) => ({ voiceURI: `uri:${name}`, name, lang });
function fakeEngine({ fireStart = true, fireEnd = true, voices = [voice('en-US'), voice('zh-HK', 'Sinji')] } = {}) {
  const spoken = [];
  globalThis.speechSynthesis = {
    speak(u) {
      spoken.push(u);
      if (fireStart) setTimeout(() => u.onstart?.(), 0);
      if (fireEnd) setTimeout(() => u.onend?.(), 5);
    },
    cancel() { for (const u of spoken.splice(0)) u.onerror?.({ error: 'canceled' }); },
    getVoices: () => voices,
    resume() {},
    addEventListener() {},
  };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  return spoken;
}
function dropEngine() { delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance; }

test('narrator: speak reports onstart then onend("end") once, and resolves with how it ended', async () => {
  fakeEngine();
  try {
    const n = createNarrator();
    const events = [];
    const how = await n.speak('各位請閉眼', { onstart: () => events.push('start'), onend: (h) => events.push(`end:${h}`) });
    assert.equal(how, 'end');
    assert.deepEqual(events, ['start', 'end:end']);
    assert.equal(await n.speak('   '), undefined, 'empty text: nothing to report');
    const bad = await n.speak('好', { onstart: () => { throw new Error('hook bug'); }, onend: () => { throw new Error('hook bug'); } });
    assert.equal(bad, 'end', 'a throwing hook never breaks speech');
  } finally { dropEngine(); }
});

test('narrator: cancel reports "cancel"; a missing onend reports "timeout"; no engine reports "unsupported" without onstart', async () => {
  fakeEngine({ fireEnd: false });
  try {
    const n = createNarrator();
    const ends = [];
    const p = n.speak('第一句', { onend: (h) => ends.push(h) });
    n.cancel();
    assert.equal(await p, 'cancel');
    assert.deepEqual(ends, ['cancel'], 'onend fires exactly once');
    const t0 = performance.now();
    assert.equal(await n.speak('好'), 'timeout');
    assert.ok(performance.now() - t0 >= estimateMs('好') - 100);
  } finally { dropEngine(); }

  const n = createNarrator();
  let started = false;
  assert.equal(await n.speak('好', { onstart: () => { started = true; } }), 'unsupported');
  assert.equal(started, false, 'no engine → no onstart, so the app\'s watchdog shows the line on screen');
});

test('narrator: info() and test() give a pre-flight screen what it needs', async () => {
  const spoken = fakeEngine();
  try {
    const n = createNarrator();
    const info = n.info();
    assert.equal(info.supported, true);
    assert.equal(info.cantonese, true);
    assert.deepEqual(info.voice, { name: 'Sinji', lang: 'zh-HK' });
    assert.equal(info.rate, 1);
    n.set({ volume: 0.4 });
    assert.equal(n.info().volume, 0.4);
    const r = await n.test();
    assert.deepEqual(r, { started: true, how: 'end', voice: { name: 'Sinji', lang: 'zh-HK' } });
    assert.equal(spoken.at(-1).text, SAMPLE_LINE, 'default line');
    await n.test('今晚好開心');
    assert.equal(spoken.at(-1).text, '今晚好開心', 'test(text) speaks the given line');
  } finally { dropEngine(); }

  fakeEngine({ voices: [voice('zh-TW', 'Meijia')] });
  try {
    const n = createNarrator();
    assert.equal(n.info().cantonese, false, 'no 粵語 voice installed');
    assert.equal(n.info().voice.lang, 'zh-TW', 'falls back to zh-TW');
  } finally { dropEngine(); }

  const silent = createNarrator();
  const r = await silent.test('好');
  assert.equal(r.started, false, 'nobody heard anything');
  assert.equal(r.how, 'unsupported');
  assert.equal(r.voice, null);
});

// ============================================================
// net, util
// ============================================================

test('net: the v2 PeerJS namespace cannot meet a v1 room; hasPeer() is a pure check', () => {
  assert.equal(PEER_NS, 'bgbox-v2-');
  assert.equal(peerIdFor('1352'), 'bgbox-v2-1352');
  assert.ok(!peerIdFor('1352').startsWith('cheesethief-v1-'));
  const had = Object.getOwnPropertyDescriptor(globalThis, 'Peer');
  try {
    delete globalThis.Peer;
    assert.equal(hasPeer(), false);
    globalThis.Peer = function FakePeer() {};
    assert.equal(hasPeer(), true);
  } finally {
    delete globalThis.Peer;
    if (had) Object.defineProperty(globalThis, 'Peer', had);
  }
});

test('util: no DOM helpers left in core (G14); store.set/setRaw report failed writes (G9)', () => {
  for (const k of ['$', '$$', 'el', 'toast']) assert.equal(k in util, false, `core/util must not export ${k}`);
  for (const k of ['isRoomCode', 'makeStore', 'uid', 'keepAwake', 'lsGet', 'lsSet', 'lsDel']) assert.equal(typeof util[k], 'function', `${k} kept`);

  const ok = util.makeStore(new Map());
  assert.equal(ok.set('k', { a: 1 }), true);
  assert.equal(ok.setRaw('r', '{"b":2}'), true);
  assert.deepEqual(ok.get('r'), { b: 2 });
  const full = util.makeStore({ getItem: () => null, setItem() { throw new Error('QuotaExceededError'); }, removeItem() {} });
  assert.equal(full.set('k', 1), false, 'a full storage says so instead of failing silently');
  assert.equal(full.setRaw('k', '1'), false);
  util.keepAwake(true);   // Node: no navigator → quietly nothing
});

// ============================================================
// Session + Sim: hostPid (G1) and carry (anti-streak)
// ============================================================

function spyGame() {
  const seen = [];
  return {
    seen,
    meta: { id: 'spy', players: [2, 8] },
    config: { defaults: () => ({}), validate: () => ({ ok: true, message: '' }), fields: () => [], summary: () => [] },
    engine: {
      setup(args) {
        seen.push({ hostPid: args.hostPid, carry: args.carry, hasCarry: 'carry' in args, players: args.players.length });
        return { phase: 'p', host: args.hostPid ?? null, prev: args.carry ?? null };
      },
      act: () => undefined, advance: () => undefined, view: (s) => ({ phase: s.phase }),
      legalActions: () => [], result: () => null,
    },
  };
}

test('session: setup receives hostPid (only when it is a seated player) and carry; both survive a snapshot', () => {
  const g = spyGame();
  const base = { game: g, players: makePlayers(3), config: {}, rng: mulberry32(1), bag: null, now: () => 1000 };
  const s1 = new Session({ ...base, hostPid: 'p2', carry: { special: ['p3'] } });
  assert.deepEqual(g.seen.at(-1), { hostPid: 'p2', carry: { special: ['p3'] }, hasCarry: true, players: 3 });
  assert.equal(s1.state.host, 'p2');

  new Session({ ...base, hostPid: 'ghost' });
  assert.equal(g.seen.at(-1).hostPid, null, 'a host seat that is not playing is not passed');
  assert.equal(g.seen.at(-1).hasCarry, false, 'no carry → no key at all');

  const carry = { special: ['p1'] };
  new Session({ ...base, hostPid: 'p1', carry });
  g.seen.at(-1).carry.special.push('mutated');
  assert.deepEqual(carry, { special: ['p1'] }, 'the engine gets a copy');

  const snap = JSON.parse(JSON.stringify(s1.snapshot()));
  assert.equal(snap.hostPid, 'p2');
  const r = Session.restore(snap, { ...base, timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  assert.equal(r.hostPid, 'p2');
  assert.equal(g.seen.length, 3, 'restore never calls setup again');
});

test('Sim: passes hostPid p1 by default (as the Room would), null on request, and carry when given', () => {
  const g = spyGame();
  new Sim(g, { n: 4 });
  assert.equal(g.seen.at(-1).hostPid, 'p1');
  assert.equal(g.seen.at(-1).hasCarry, false);
  new Sim(g, { n: 4, hostPid: null });
  assert.equal(g.seen.at(-1).hostPid, null);
  const sim = new Sim(g, { n: 4, carry: { special: ['p2'] } });
  assert.deepEqual(g.seen.at(-1).carry, { special: ['p2'] });
  assert.deepEqual(sim.state.prev, { special: ['p2'] });
});

// ============================================================
// bag: the reshuffle notice says which bank, in words people know (#11)
// ============================================================

test('bag: an exhausted pool reshuffles with a friendly notice carrying { kind, bankId }; label() names banks', async () => {
  const notices = [];
  const entries = [{ id: 'a' }, { id: 'b' }];
  const bag = createBag({
    storage: new Map(), rng: mulberry32(3),
    banks: { mini: { name: '迷你詞庫', load: async () => entries, key: (e) => e.id } },
    onNotice: (text, info) => notices.push({ text, info }),
  });
  await bag.load('mini');
  bag.draw('mini'); bag.draw('mini');
  assert.equal(notices.length, 0);
  bag.draw('mini');
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].info, { kind: 'bag-reshuffle', bankId: 'mini' });
  assert.match(notices[0].text, /迷你詞庫/);
  assert.match(notices[0].text, /重新洗牌/);
  assert.equal(bag.label('mini'), '迷你詞庫');
  assert.equal(bag.label('undercover'), '臥底詞庫');
  assert.equal(bag.label('spyfall'), '間諜地點');
  assert.equal(bag.label('nope'), 'nope');

  const quiet = console.error;
  console.error = () => {};
  try {
    const loud = createBag({ storage: new Map(), banks: { mini: { load: async () => entries, key: (e) => e.id } }, onNotice: () => { throw new Error('listener bug'); } });
    await loud.load('mini');
    for (let i = 0; i < 3; i++) assert.ok(loud.draw('mini'), 'a throwing listener never stops the draw');
  } finally { console.error = quiet; }
  assert.equal(clone(notices).length, 1);
});

test('bag.release: an offered-but-unused entry goes back into the pool (draw-guess calls it for the 2 words not chosen)', async () => {
  const entries = [{ w: '蘋果' }, { w: '香蕉' }, { w: '橙' }];
  const store = new Map();
  const bag = createBag({ storage: store, rng: mulberry32(9), banks: { words: { load: async () => entries, key: (e) => e.w } } });
  await bag.load('words');
  const offered = [bag.draw('words'), bag.draw('words')];
  assert.deepEqual(bag.stats('words'), { used: 2, total: 3 });
  assert.equal(bag.release('words', offered[1].w), true);
  assert.deepEqual(bag.stats('words'), { used: 1, total: 3 }, 'released');
  assert.equal(bag.release('words', offered[1].w), false, 'twice: nothing to release');
  assert.equal(bag.release('words', 42), false, 'keys are strings');
  assert.deepEqual(JSON.parse(store.get('bgb:bag:words')), [offered[0].w], 'persisted');
  assert.throws(() => bag.release('nope', 'x'), /unknown bank/);
});

test('util.keepAwake: overlapping requests hold ONE wake lock, and turning it off releases that one', async () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const made = [];
  const fake = {
    wakeLock: {
      async request() {
        await Promise.resolve();
        const lock = { released: false, async release() { this.released = true; }, addEventListener() {} };
        made.push(lock);
        return lock;
      },
    },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, get: () => fake });
  try {
    await Promise.all([util.keepAwake(true), util.keepAwake(true), util.keepAwake(true)]);
    assert.equal(made.length, 1, 'three callers in one tick, one lock');
    assert.equal(util.wakeLockActive(), true);
    util.keepAwake(true);
    util.keepAwake(false);                          // on → off before the worker even ran
    await util.keepAwake(false);
    assert.equal(made.length, 1);
    assert.equal(made[0].released, true, 'the lock we hold is the one released');
    assert.equal(util.wakeLockActive(), false);
  } finally {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc); else delete globalThis.navigator;
  }
});

test('util.iosVersion / iosBrowser / wakeFallbackReason: which phones get the video fallback, and why', () => {
  const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1';
  const IPHONE_GOOGLE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/336.0.672814960 Mobile/15E148 Safari/604.1';
  const IPHONE_INAPP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]';
  const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15';
  assert.deepEqual(util.iosVersion(IPHONE_SAFARI), [17, 5]);
  assert.deepEqual(util.iosVersion('Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15'), [18, 4]);
  assert.deepEqual(util.iosVersion(IPAD_DESKTOP, 5), [18, 3], 'iPadOS posing as a Mac');
  assert.deepEqual(util.iosVersion('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)', 5), [0, 0], 'a Home Screen iPad hides its version');
  assert.equal(util.iosVersion(IPAD_DESKTOP, 0), null, 'a real Mac');
  assert.equal(util.iosVersion('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129.0 Mobile Safari/537.36'), null);
  assert.equal(util.iosBrowser(IPHONE_SAFARI), 'safari');
  assert.equal(util.iosBrowser(IPHONE_CHROME), 'chrome');
  assert.equal(util.iosBrowser(IPHONE_GOOGLE), 'google', 'the Google app (where a scanned QR code opens)');
  assert.equal(util.iosBrowser(IPHONE_INAPP), 'webview');
  assert.equal(util.iosBrowser(IPAD_DESKTOP, 5), 'safari');
  assert.equal(util.iosBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0'), null);

  const why = util.wakeFallbackReason;
  const iphone = (browser, ios = [17, 5], extra = {}) => ({ mobile: true, hasNative: true, ios, browser, ...extra });
  assert.equal(why(iphone('safari')), '', 'a Safari tab that got the lock: the native lock is enough');
  assert.match(why(iphone('safari', [16, 2], { hasNative: false })), /no Screen Wake Lock API/);
  assert.match(why(iphone('safari', [17, 5], { refused: true })), /refused/);
  assert.match(why(iphone('safari', [17, 5], { released: true })), /released while visible/);
  assert.match(why(iphone('chrome', [18, 6])), /iOS chrome \(WKWebView\)/, 'Chrome iOS, even with a granted lock');
  assert.match(why(iphone('google', [17, 4])), /iOS google/);
  assert.match(why(iphone('webview', [17, 4], { standalone: true })), /WKWebView/);
  assert.equal(why({ mobile: true, hasNative: true, ios: [18, 4], browser: 'safari', standalone: true }), '', 'Home Screen fixed in 18.4');
  assert.match(why({ mobile: true, hasNative: true, ios: [18, 3], browser: 'safari', standalone: true }), /Home Screen app on iOS 18\.3/);
  assert.match(why({ mobile: true, hasNative: false, ios: null }), /no Screen Wake Lock API/, 'an Android WebView without it');
  assert.equal(why({ mobile: false, hasNative: false }), '', 'desktops never get the video');
  assert.equal(why({ mobile: false, hasNative: true, refused: true }), '');
  assert.equal(util.wakeNeedsFallback(iphone('chrome')), true);
  assert.equal(util.wakeNeedsFallback(iphone('safari')), false);
});

test('util.keepAwake: Chrome iOS (or a refused / released lock) also plays a muted inline canvas-stream video, logs the path; off removes it; desktops never', async () => {
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const docDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const appended = [];
  const doc = {
    hidden: false,
    body: { append: (n) => { n.parent = 'body'; appended.push(n); } },
    addEventListener() {}, removeEventListener() {},
    createElement(tag) {
      const n = { tag, attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.parent = null; } };
      if (tag === 'canvas') {
        n.getContext = () => ({ fillRect() {} });
        n.captureStream = (fps) => ({ fps, getTracks: () => [{ stop() { n.trackStopped = true; } }] });
      }
      if (tag === 'video') { n.paused = true; n.play = async () => { n.paused = false; }; n.pause = () => { n.paused = true; }; }
      return n;
    },
  };
  const locks = [];
  let refuse = false;
  const nav = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
    wakeLock: {
      async request() {
        if (refuse) throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
        const lock = { released: false, h: [], async release() { this.released = true; }, addEventListener(ev, fn) { if (ev === 'release') this.h.push(fn); } };
        locks.push(lock);
        return lock;
      },
    },
  };
  const videos = () => appended.filter((n) => n.tag === 'video');
  const logged = (re) => util.connLog.lines().some((l) => re.test(l));
  Object.defineProperty(globalThis, 'navigator', { configurable: true, get: () => nav });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  try {
    // Chrome on iOS: the lock is granted, and the video runs too (a WKWebView may not honour the lock)
    await util.keepAwake(true);
    assert.equal(locks.length, 1, 'the native lock is still asked for');
    const video = videos()[0];
    assert.ok(video, 'and the fallback video is on the page');
    assert.equal(video.muted, true);
    assert.equal(video.playsInline, true);
    assert.ok('playsinline' in video.attrs && 'muted' in video.attrs);
    assert.equal(video.srcObject.fps, 1, 'its source is a canvas stream — no media file');
    assert.equal(video.paused, false, 'playing');
    assert.match(video.style.cssText, /pointer-events:none/);
    assert.equal(util.wakeLockActive(), true);
    assert.ok(logged(/wake: video fallback — iOS chrome \(WKWebView\) may ignore the wake lock \(iOS 18\.6 chrome\), native lock held too/), util.connLog.lines().join('\n'));
    assert.ok(logged(/wake: video fallback playing/));

    await util.keepAwake(false);
    assert.equal(locks[0].released, true);
    assert.equal(video.parent, null, 'removed');
    assert.equal(video.paused, true);
    assert.equal(appended.find((n) => n.tag === 'canvas')?.parent, undefined, 'the canvas never joins the page');
    assert.equal(util.wakeLockActive(), false);

    // Safari on iOS: a granted lock is enough…
    nav.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    await util.keepAwake(true);
    assert.equal(videos().length, 1, 'no video for a Safari tab holding the lock');
    assert.ok(logged(/wake: native wake lock \(iOS 17\.5 safari\)/));
    // …until the system takes it back while the page is still on screen
    for (const fn of locks.at(-1).h) fn();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(videos().length, 2, 'released while visible → the video keeps the screen on');
    assert.equal(videos()[1].paused, false);
    assert.ok(logged(/wake lock released while visible/));
    await util.keepAwake(false);

    // Android, lock refused → the video too
    nav.userAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36';
    refuse = true;
    await util.keepAwake(true);
    assert.equal(videos().length, 3);
    assert.equal(videos()[2].paused, false);
    assert.ok(logged(/wake lock refused \(NotAllowedError\)/));
    await util.keepAwake(false);

    // a desktop: refused means nothing more is tried
    nav.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36';
    await util.keepAwake(true);
    assert.equal(videos().length, 3, 'desktops never get the video');
    assert.ok(logged(/wake: nothing keeps the screen on \(desktop\)/));
    refuse = false;
    await util.keepAwake(true);
    assert.equal(util.wakeLockActive(), true);
  } finally {
    await util.keepAwake(false);
    if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc); else delete globalThis.navigator;
    if (docDesc) Object.defineProperty(globalThis, 'document', docDesc); else delete globalThis.document;
  }
});
