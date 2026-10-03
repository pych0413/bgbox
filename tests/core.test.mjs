// ============================================================
// tests/core.test.mjs — Room, Session, Bag, createApp, registry.
//
// Everything runs headless with a fake clock and a tiny fake engine defined
// below, so these tests depend on no real game.
//
//   node tests/run.mjs core
// ============================================================

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, assert, makePlayers, HOST, ACT } from './lib.mjs';
import { mulberry32, rint, clone } from '../js/core/engine-kit.js';
import { Session, emptyInk, applyInkBatch, normalizeInk } from '../js/core/session.js?v=1';
import { Room, PALETTE } from '../js/core/room.js?v=1';
import { createBag } from '../js/core/bag.js?v=1';
import { createApp } from '../js/core/client.js?v=1';
import { PROTOCOL } from '../js/core/transport.js?v=1';
import { GAMES } from '../js/games/registry.js?v=1';
import { makeStore } from '../js/core/util.js?v=1';

const here = dirname(fileURLToPath(import.meta.url));

// ============================================================
// fixtures
// ============================================================

/** Deterministic timers + clock. advance() runs due callbacks in order. */
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
      for (const x of this.q) {
        if (x.at <= end && (!next || x.at < next.at || (x.at === next.at && x.id < next.id))) next = x;
      }
      if (!next) break;
      this.t = Math.max(this.t, next.at);
      if (next.every) next.at += next.every; else this.q = this.q.filter((x) => x !== next);
      next.fn();
    }
    this.t = end;
  }
}

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

/** localStorage-shaped fake over a Map. */
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
}

const FAKE_ENTRIES = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, w: `詞${i}`, cat: i % 2 ? 'a' : 'b' }));
const FAKE_BANK = { fake: { load: async () => FAKE_ENTRIES, key: (e) => e.id } };

/**
 * A minimal game: everyone secretly picks 1–3 within a deadline, then a cue
 * reveals, then the highest pick wins. Exercises deadlines, cues, focus,
 * per-seat secrets, ink, autoAct and the bag.
 */
function makeGame({ autoAct = false, banks = ['fake'] } = {}) {
  const finish = (st) => { st.phase = 'done'; st.deadline = null; };
  const engine = {
    setup({ players, config, rng, now, bag }) {
      return {
        phase: 'pick',
        players: players.map((p) => p.id),
        secrets: Object.fromEntries(players.map((p) => [p.id, `S${p.id}_${rint(rng, 1e6)}`])),
        picks: {},
        word: bag ? bag.draw('fake')?.w ?? null : null,
        artist: (players[1] ?? players[0]).id,
        deadline: now + config.pickMs,
        cueMs: config.cueMs ?? 1500,
        inkEpoch: 0,
      };
    },
    act(state, { pid, action }, ctx) {
      // Deliberately sloppy: it never checks that pid === HOST. Keeping seats from forging these is the Room's job.
      if (action.type === ACT.NEXT || action.type === ACT.CUE_DONE) {
        if (state.phase === 'reveal' && (action.type === ACT.NEXT || action.id === 'reveal:1')) { finish(state); return state; }
        return undefined;
      }
      if (action.type === 'newpic' && pid === state.artist && state.phase === 'pick') { state.inkEpoch++; return state; }
      if (state.phase !== 'pick' || action.type !== 'pick') return undefined;
      if (!state.players.includes(pid) || pid in state.picks || ![1, 2, 3].includes(action.n)) return undefined;
      state.picks[pid] = action.n;
      if (Object.keys(state.picks).length === state.players.length) { state.phase = 'reveal'; state.deadline = null; }
      return state;
    },
    advance(state, ctx) {
      if (state.phase === 'pick' && state.deadline != null && ctx.now >= state.deadline) {
        for (const p of state.players) if (!(p in state.picks)) state.picks[p] = 1;
        state.phase = 'reveal';
        state.deadline = null;
      }
      return state;
    },
    view(state, pid) {
      const v = {
        phase: state.phase,
        picked: Object.fromEntries(state.players.map((p) => [p, p in state.picks])),
      };
      if (state.deadline != null) v.deadline = state.deadline;
      if (pid) { v.me = pid; v.secret = state.secrets[pid]; v.myPick = state.picks[pid] ?? null; v.word = state.word; }
      if (state.phase === 'done') v.picks = { ...state.picks };
      return v;
    },
    cue(state) { return state.phase === 'reveal' ? { id: 'reveal:1', text: '揭曉', minMs: state.cueMs } : null; },
    focus(state) {
      if (state.phase !== 'pick') return null;
      return { pids: state.players.filter((p) => !(p in state.picks)), anonymous: '輪到你' };
    },
    legalActions(state, pid) {
      if (state.phase !== 'pick' || !state.players.includes(pid) || pid in state.picks) return [];
      return [1, 2, 3].map((n) => ({ type: 'pick', n }));
    },
    canInk: (state, pid) => state.phase === 'pick' && pid === state.artist,
    result(state) {
      if (state.phase !== 'done') return null;
      const max = Math.max(...Object.values(state.picks));
      const winners = state.players.filter((p) => state.picks[p] === max);
      return {
        winners, summary: `最高 ${max}`, lines: winners.map((w) => `${w} 贏`),
        points: Object.fromEntries(state.players.map((p) => [p, state.picks[p]])),
      };
    },
  };
  if (autoAct) engine.autoAct = () => ({ type: 'pick', n: 3 });
  return {
    meta: { id: 'fake', name: '測試', players: [2, 5], banks },
    config: {
      defaults: (n, prev) => ({ pickMs: prev?.pickMs ?? 30_000, rounds: n }),
      validate: (cfg, n) => (cfg.pickMs >= 1000
        ? { ok: true, message: '', warnings: n === 5 ? ['人多'] : [] }
        : { ok: false, message: '時間太短' }),
      fields: () => [],
      summary: (cfg, n) => [`${n} 人`, `${cfg.pickMs / 1000} 秒`],
    },
    engine,
  };
}

// ---------- room harness ----------

function setup({ names = ['阿明'], narrationMode = 'silent', games, bag, stallMs, game } = {}) {
  const clock = new FakeClock();
  const sent = [];
  const cues = [];
  const g = games ?? { fake: game ?? makeGame() };
  const theBag = bag ?? createBag({ storage: new Map(), rng: mulberry32(5), banks: FAKE_BANK });
  const deps = {
    code: '1234', hostDeviceId: 'dev_host', names, now: clock.now, rng: mulberry32(11), bag: theBag, timers: clock,
    loadGame: async (id) => { if (!g[id]) throw new Error('no such game'); return g[id]; },
    send: (deviceId, msg, peerId) => sent.push({ deviceId, peerId, msg: clone(msg) }),
    onCue: (cue, info) => cues.push({ id: cue.id, replay: info.replay }),
    narrationMode, stallMs,
  };
  const room = new Room(deps);
  return { room, clock, sent, cues, bag: theBag, deps, games: g };
}

const hello = (room, peerId, deviceId, ...seats) => room.receive(peerId, {
  t: 'hello', v: PROTOCOL, deviceId, seats: seats.map((s) => (typeof s === 'string' ? { name: s } : s)),
});
const msgsTo = (sent, deviceId, t) => sent.filter((x) => x.deviceId === deviceId && (!t || x.msg.t === t)).map((x) => x.msg);
const lastTo = (sent, deviceId, t) => msgsTo(sent, deviceId, t).at(-1);
const player = (room, name) => room.snapshot().players.find((p) => p.name === name);
const roomOf = (sent, deviceId) => lastTo(sent, deviceId, 'room').room;
const pick = (room, deviceId, pid, n) => room.act(deviceId, pid, { type: 'pick', n });

/** host p1 + 阿花 p2 (dev_a) + 阿強 p3 (dev_b), game selected with default config. */
async function lobby3(opts = {}) {
  const t = setup(opts);
  hello(t.room, 'peer_a', 'dev_a', '阿花');
  hello(t.room, 'peer_b', 'dev_b', '阿強');
  const r = await t.room.selectGame('fake');
  assert.equal(r.ok, true, r.message);
  return t;
}

async function started3(opts = {}) {
  const t = await lobby3(opts);
  const r = t.room.start();
  assert.equal(r.ok, true, r.message);
  return t;
}

// ============================================================
// bag
// ============================================================

test('bag: draws without replacement, persists across bags, resets only when exhausted', async () => {
  const storage = fakeStorage();
  const mk = () => createBag({ storage, rng: mulberry32(3), banks: FAKE_BANK });
  const bag = mk();
  await bag.load('fake');
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const e = bag.draw('fake');
    assert.ok(e, 'draw returned null');
    assert.ok(!seen.has(e.id), `repeated ${e.id} before exhaustion`);
    seen.add(e.id);
  }
  assert.deepEqual(bag.stats('fake'), { used: 6, total: 6 });
  assert.equal(JSON.parse(storage.getItem('bgb:bag:fake')).length, 6, 'used keys persisted under bgb:bag:<bankId>');

  const again = bag.draw('fake');                       // exhausted → reshuffle, and say so
  assert.ok(again);
  assert.equal(bag.takeNotices().length, 1);
  assert.equal(bag.stats('fake').used, 1);

  const bag2 = mk();                                    // a new session on the same device remembers
  await bag2.load('fake');
  assert.equal(bag2.stats('fake').used, 1);
  const rest = new Set([again.id]);
  for (let i = 0; i < 5; i++) { const e = bag2.draw('fake'); assert.ok(!rest.has(e.id)); rest.add(e.id); }
  assert.equal(rest.size, 6);

  bag2.reset('fake');
  assert.equal(bag2.stats('fake').used, 0);
});

test('bag: filter limits the pool and only that pool resets; entries are copies', async () => {
  const bag = createBag({ storage: new Map(), rng: mulberry32(9), banks: FAKE_BANK });
  await bag.load('fake');
  const onlyA = (e) => e.cat === 'a';
  assert.deepEqual(bag.stats('fake', onlyA), { used: 0, total: 3 });
  const x = bag.draw('fake', onlyA);
  const y = bag.draw('fake', onlyA);
  const z = bag.draw('fake', onlyA);
  assert.equal(new Set([x.id, y.id, z.id]).size, 3);
  assert.ok([x, y, z].every(onlyA));
  assert.deepEqual(bag.stats('fake', onlyA), { used: 3, total: 3 });
  assert.equal(bag.draw('fake', () => false), null, 'empty filtered pool → null');
  x.w = 'mutated';
  assert.notEqual(FAKE_ENTRIES.find((e) => e.id === x.id).w, 'mutated');
  const w = bag.draw('fake', onlyA);                    // exhausted → resets just this pool
  assert.ok(w);
  assert.equal(bag.stats('fake', onlyA).used, 1);
});

test('bag: custom entries are mixed in, de-duplicated and removable', async () => {
  const bag = createBag({ storage: new Map(), rng: mulberry32(2), banks: FAKE_BANK });
  await bag.load('fake');
  assert.equal(bag.addCustom('fake', { id: 'mine', w: '自訂', cat: 'a' }), 'mine');
  assert.equal(bag.addCustom('fake', { id: 'mine', w: '自訂', cat: 'a' }), null, 'duplicate key');
  assert.equal(bag.addCustom('fake', { id: 'e1', w: 'x', cat: 'a' }), null, 'clashes with shipped entry');
  assert.deepEqual(bag.custom('fake').map((e) => e.id), ['mine']);
  assert.equal(bag.stats('fake').total, 7);
  const ids = new Set();
  for (let i = 0; i < 7; i++) ids.add(bag.draw('fake').id);
  assert.ok(ids.has('mine'));
  assert.equal(bag.removeCustom('fake', 'mine'), true);
  assert.equal(bag.stats('fake').total, 6);
  assert.equal(bag.removeCustom('fake', 'mine'), false);
});

test('bag: storage can be a Map; unknown or unloaded banks fail loudly', async () => {
  const m = new Map();
  const bag = createBag({ storage: m, banks: FAKE_BANK });
  await bag.load('fake');
  bag.draw('fake');
  assert.ok(m.has('bgb:bag:fake'), 'Map-backed storage was written');
  await assert.rejects(() => bag.load('nope'), /unknown bank/);
  assert.throws(() => bag.draw('nope'), /unknown bank/);
  assert.throws(() => createBag({ storage: new Map() }).draw('undercover'), /not loaded/);
});

test('bag: real banks use the §15.5 ids, files and keys', async () => {
  const m = new Map();
  const bag = createBag({ storage: m, rng: mulberry32(4) });
  const dataDir = join(here, '..', 'js', 'data');
  const spec = {
    undercover: { file: 'undercover-words.js', key: (e) => [e.a, e.b].sort().join('|'), field: 'a' },
    spyfall: { file: 'spyfall-locations.js', key: (e) => e.name, field: 'name' },
    draw: { file: 'draw-words.js', key: (e) => e.w, field: 'w' },
    '9upper': { file: '9upper-terms.js', key: (e) => e.term, field: 'term' },
  };
  for (const [id, s] of Object.entries(spec)) {
    if (!existsSync(join(dataDir, s.file))) continue;    // content ships in a later task
    const n = await bag.load(id);
    assert.ok(n > 0, `${id} loaded empty`);
    const e = bag.draw(id);
    assert.ok(e && e[s.field] !== undefined, `${id}: entry has ${s.field}`);
    const k = s.key(e);
    assert.equal(typeof k, 'string');
    assert.deepEqual(JSON.parse(m.get(`bgb:bag:${id}`)), [k], `${id}: used key stored under bgb:bag:${id}`);
    if (id === 'draw') assert.ok(Array.isArray(e.alt) && e.cat && e.level, 'draw entries are flattened { w, alt, level, cat }');
  }
});

// ============================================================
// session
// ============================================================

function makeSession(game, clock, { n = 3, narrationMode = 'voice', config, extra = {} } = {}) {
  const calls = { change: 0, cues: [], ink: [] };
  const s = new Session({
    game, players: makePlayers(n), config: config ?? game.config.defaults(n),
    rng: mulberry32(1), bag: null, now: clock.now, timers: clock, narrationMode,
    onChange: () => { calls.change++; },
    onCue: (c, i) => calls.cues.push([c.id, i.replay]),
    onInk: (b) => calls.ink.push(b),
    ...extra,
  });
  s.begin();
  return { s, calls };
}

const allPick = (s) => { s.dispatch('p1', { type: 'pick', n: 1 }); s.dispatch('p2', { type: 'pick', n: 2 }); s.dispatch('p3', { type: 'pick', n: 3 }); };

test('session: clones before every call, ignores illegal actions, survives engine exceptions', () => {
  const clock = new FakeClock();
  const game = makeGame();
  const { s, calls } = makeSession(game, clock);
  const rev0 = s.rev;
  assert.equal(s.dispatch('p1', { type: 'pick', n: 9 }), false, 'illegal target');
  assert.equal(s.dispatch('nobody', { type: 'pick', n: 1 }), false, 'wrong player');
  assert.equal(s.dispatch('p1', { type: 'bogus' }), false);
  assert.equal(s.rev, rev0, 'nothing changed, nothing emitted');
  const changes = calls.change;
  assert.equal(s.dispatch('p1', { type: 'pick', n: 2 }), true);
  assert.equal(s.dispatch('p1', { type: 'pick', n: 3 }), false, 'second pick refused');
  assert.equal(calls.change, changes + 1);
  assert.equal(s.state.picks.p1, 2);

  // An engine that mutates its input and then throws must not corrupt the committed state.
  const bad = makeGame();
  const act = bad.engine.act;
  bad.engine.act = (st, a, c) => { st.picks.zzz = 1; if (a.action.type === 'boom') throw new Error('boom'); return act(st, a, c); };
  const t2 = makeSession(bad, clock);
  const quiet = console.error;
  console.error = () => {};
  try { assert.equal(t2.s.dispatch('p1', { type: 'boom' }), false); } finally { console.error = quiet; }
  assert.ok(t2.s.lastError instanceof Error);
  assert.deepEqual(t2.s.state.picks, {}, 'the mutated clone was discarded');
});

test('session: the deadline fires advance() through the injected timers', () => {
  const clock = new FakeClock();
  const { s, calls } = makeSession(makeGame(), clock);
  const d = s.deadline();
  assert.equal(d, clock.t + 30_000);
  s.dispatch('p1', { type: 'pick', n: 2 });
  clock.advance(29_999);
  assert.equal(s.state.phase, 'pick');
  clock.advance(1);
  assert.equal(s.state.phase, 'reveal');
  assert.deepEqual(s.state.picks, { p1: 2, p2: 1, p3: 1 }, 'advance filled in the idle seats');
  assert.equal(s.state.deadline, null);
  assert.deepEqual(calls.cues, [['reveal:1', false]], 'the cue was announced once');
  clock.advance(10 * 60_000);
  assert.equal(s.state.phase, 'reveal', 'voice mode: nothing completes the cue until cueDone');
  assert.equal(s.cueDone('wrong-id'), false);
  assert.equal(s.cueDone('reveal:1'), true);
  const res = s.result();
  assert.deepEqual(res.winners, ['p1']);
});

test('session: pause freezes the deadline, resume shifts it by the time paused', () => {
  const clock = new FakeClock();
  const { s, calls } = makeSession(makeGame(), clock);
  const d0 = s.deadline();
  clock.advance(10_000);
  assert.equal(s.pause(), true);
  assert.equal(s.pause(), false, 'already paused');
  assert.equal(s.dispatch('p1', { type: 'pick', n: 1 }), false, 'paused sessions refuse input');
  clock.advance(60_000);
  assert.equal(s.state.phase, 'pick', 'the clock did not run while paused');
  const changes = calls.change;
  assert.equal(s.resume(), true);
  assert.equal(s.deadline(), d0 + 60_000);
  assert.equal(calls.change, changes + 1, 'the shifted deadline was announced');
  clock.advance(19_999);
  assert.equal(s.state.phase, 'pick', '20 s were left when it was paused');
  clock.advance(1);
  assert.equal(s.state.phase, 'reveal');
});

test('session: silent mode completes cues after minMs; voice waits; pause carries the remainder; next() skips', () => {
  const clock = new FakeClock();
  const silent = makeSession(makeGame(), clock, { narrationMode: 'silent' });
  allPick(silent.s);
  assert.equal(silent.s.state.phase, 'reveal');
  clock.advance(1499);
  assert.equal(silent.s.state.phase, 'reveal');
  clock.advance(1);
  assert.equal(silent.s.state.phase, 'done');

  const paused = makeSession(makeGame(), clock, { narrationMode: 'silent' });
  allPick(paused.s);
  clock.advance(1000);
  paused.s.pause();
  clock.advance(60_000);
  assert.equal(paused.s.state.phase, 'reveal');
  paused.s.resume();
  assert.deepEqual(paused.calls.cues.at(-1), ['reveal:1', true], 'resume replays the cue (speech was cut by the pause)');
  clock.advance(499);
  assert.equal(paused.s.state.phase, 'reveal');
  clock.advance(1);
  assert.equal(paused.s.state.phase, 'done', '500 ms of the 1500 were left');

  const voice = makeSession(makeGame(), clock, { narrationMode: 'voice' });
  allPick(voice.s);
  clock.advance(60_000);
  assert.equal(voice.s.state.phase, 'reveal');
  assert.equal(voice.s.next(), true);
  assert.equal(voice.s.state.phase, 'done');

  const sw = makeSession(makeGame(), clock, { narrationMode: 'voice' });   // switching mode mid-cue
  allPick(sw.s);
  clock.advance(1000);
  sw.s.setNarrationMode('silent');
  clock.advance(499);
  assert.equal(sw.s.state.phase, 'reveal');
  clock.advance(1);
  assert.equal(sw.s.state.phase, 'done');
});

test('session: autoAct uses engine.autoAct, falls back to legalActions[0], and @auto routes to it', () => {
  const clock = new FakeClock();
  const withAuto = makeSession(makeGame({ autoAct: true }), clock);
  assert.equal(withAuto.s.autoAct('p2'), true);
  assert.equal(withAuto.s.state.picks.p2, 3, 'engine.autoAct chose 3');

  const plain = makeSession(makeGame(), clock);
  assert.equal(plain.s.dispatch(HOST, { type: ACT.AUTO, pid: 'p3' }), true);
  assert.equal(plain.s.state.picks.p3, 1, 'first legal action');
  assert.equal(plain.s.autoAct('p3'), false, 'nothing legal any more');
  assert.equal(plain.s.autoAct('ghost'), false);
});

test('session: snapshot restores PAUSED with the clock stopped at the save, so timers carry on', () => {
  const clock = new FakeClock();
  const game = makeGame();
  const { s } = makeSession(game, clock);
  s.dispatch('p1', { type: 'pick', n: 2 });
  clock.advance(10_000);
  const d = s.deadline();
  const snap = JSON.parse(JSON.stringify(s.snapshot()));

  const clock2 = new FakeClock(clock.t + 40_000);        // the host was away for 40 s
  const calls = [];
  const r = Session.restore(snap, {
    game, rng: mulberry32(1), bag: null, now: clock2.now, timers: clock2, narrationMode: 'voice',
    onChange: () => calls.push('change'), onCue: () => calls.push('cue'),
  });
  assert.equal(r.paused, true);
  assert.equal(r.deadline(), d);
  assert.equal(r.dispatch('p2', { type: 'pick', n: 1 }), false);
  clock2.advance(5_000);
  assert.equal(r.resume(), true);
  assert.equal(r.deadline(), d + 45_000, 'shifted by downtime + paused time');
  clock2.advance(19_999);
  assert.equal(r.state.phase, 'pick');
  clock2.advance(1);
  assert.equal(r.state.phase, 'reveal');
  assert.deepEqual(r.state.picks, { p1: 2, p2: 1, p3: 1 });
});

test('session: ink is accepted only from the seat the engine allows, normalised, and epoch resets clear it', () => {
  const clock = new FakeClock();
  const { s, calls } = makeSession(makeGame(), clock);    // artist is p2
  assert.equal(s.ink('p1', { stroke: 'a', pts: [[1, 1]] }), false, 'not the artist');
  assert.equal(s.ink('p2', { pts: [[1, 1]] }), false, 'no stroke id');
  assert.equal(s.ink('p2', { stroke: 'a', pts: [[1, 'x']] }), false, 'bad point');
  assert.equal(s.ink('p2', { stroke: 'a' }), false, 'nothing to add');
  assert.equal(s.ink('p2', { stroke: 'a', pts: [[-5, 2000.6], [10.4, 20.5]], color: '#fff', width: 6 }), true);
  assert.equal(s.ink('p2', { stroke: 'a', pts: [[30, 30]], end: true }), true);
  assert.deepEqual(s.drawing.strokes[0].pts, [[0, 1000], [10, 21], [30, 30]], 'clamped to 0–1000 integers');
  assert.equal(s.drawing.strokes[0].end, true);
  assert.equal(s.drawing.strokes[0].color, '#fff');
  assert.equal(calls.ink.length, 2);

  s.ink('p2', { stroke: 'b', pts: [[5, 5]], end: true });
  assert.equal(s.drawing.strokes.length, 2);
  s.ink('p2', { op: 'undo' });
  assert.equal(s.drawing.strokes.length, 1);
  s.ink('p2', { op: 'clear' });
  assert.equal(s.drawing.strokes.length, 0);

  s.ink('p2', { stroke: 'c', pts: [[5, 5]] });
  assert.equal(s.dispatch('p2', { type: 'newpic' }), true);   // engine bumps inkEpoch
  assert.deepEqual(s.drawing, emptyInk(1));
  assert.equal(calls.ink.at(-1), null, 'null = clients need a full resync');

  const mine = emptyInk();                                     // the client copy converges on the same strokes
  for (const b of [normalizeInk('p2', { stroke: 'z', pts: [[1, 2], [3, 4]] }), normalizeInk('p2', { stroke: 'z', pts: [[5, 6]], end: true })]) applyInkBatch(mine, b);
  assert.deepEqual(mine.strokes, [{ id: 'z', pid: 'p2', pts: [[1, 2], [3, 4], [5, 6]], end: true }]);
});

// ============================================================
// room
// ============================================================

test('room: lobby → start → actions → result → again → lobby', async () => {
  const { room, clock, sent, bag } = setup();
  assert.equal(room.phase, 'lobby');
  hello(room, 'peer_a', 'dev_a', '阿花');
  hello(room, 'peer_b', 'dev_b', '阿強');

  const w = lastTo(sent, 'dev_a', 'welcome');
  assert.equal(w.device, 'dev_a');
  assert.equal(w.seats.length, 1);
  assert.ok(w.seats[0].token, 'a remote seat gets its token');
  assert.deepEqual(w.room.players.map((p) => p.name), ['阿明', '阿花'], 'welcome carries the room as it was');
  const seen = roomOf(sent, 'dev_a');
  assert.deepEqual(seen.players.map((p) => p.name), ['阿明', '阿花', '阿強'], 'A was told when B joined');
  assert.deepEqual(seen.players.map((p) => p.seat), [0, 1, 2]);
  assert.equal(new Set(seen.players.map((p) => p.color)).size, 3, 'colours are unique');
  assert.equal(seen.players[0].isHost, true);
  assert.equal(room.start().ok, false, 'no game chosen yet');

  const sel = await room.selectGame('fake');
  assert.equal(sel.ok, true);
  assert.equal(bag.isLoaded('fake'), true, 'meta.banks were loaded');
  const lobbyView = roomOf(sent, 'dev_host');
  assert.equal(lobbyView.gameId, 'fake');
  assert.deepEqual(lobbyView.config, { pickMs: 30_000, rounds: 3 });
  assert.deepEqual(lobbyView.configSummary, ['3 人', '30 秒']);
  assert.equal(lobbyView.configValid.ok, true);
  assert.equal(roomOf(sent, 'dev_a').gameId, 'fake', 'everyone sees the game change');

  room.setConfig({ pickMs: 500, rounds: 3 });
  assert.deepEqual(roomOf(sent, 'dev_host').configValid, { ok: false, message: '時間太短', warnings: [] });
  const bad = room.start();
  assert.equal(bad.ok, false);
  assert.equal(bad.message, '時間太短');
  room.setConfig({ pickMs: 20_000, rounds: 3 });

  const sentBefore = sent.length;
  const started = room.start();
  assert.deepEqual(started, { ok: true, message: '' });
  assert.equal(room.phase, 'playing');
  const fresh = sent.slice(sentBefore);
  const vA = fresh.filter((x) => x.deviceId === 'dev_a' && x.msg.t === 'views').at(-1).msg;
  assert.deepEqual(Object.keys(vA.bySeat), ['p2']);
  assert.equal(vA.bySeat.p2.phase, 'pick');
  assert.equal(vA.table.phase, 'pick');
  assert.ok(typeof vA.rev === 'number' && typeof vA.hostNow === 'number');
  assert.deepEqual(vA.focus, { pids: ['p2'], anonymous: '輪到你' }, 'focus is filtered to this device');
  const vH = lastTo(sent, 'dev_host', 'views');
  assert.deepEqual(vH.focus, { pids: ['p1'], anonymous: '輪到你' });
  assert.equal(vH.cue, null);
  const word1 = vH.bySeat.p1.word;
  assert.ok(word1, 'ctx.bag reached engine.setup');

  assert.equal(pick(room, 'dev_a', 'p2', 2), true);
  assert.equal(pick(room, 'dev_b', 'p3', 3), true);
  assert.equal(pick(room, 'dev_host', 'p1', 1), true);
  assert.equal(room.phase, 'playing');
  assert.equal(lastTo(sent, 'dev_host', 'views').cue.text, '揭曉', 'the host sees the narration line');
  assert.equal(lastTo(sent, 'dev_a', 'views').cue, undefined, 'other devices never get the cue');
  clock.advance(1500);                                    // silent narration completes the cue

  assert.equal(room.phase, 'results');
  const res = roomOf(sent, 'dev_a');
  assert.equal(res.phase, 'results');
  assert.deepEqual(res.lastResult.winners, ['p3']);
  assert.equal(res.lastResult.summary, '最高 3');
  assert.deepEqual(res.scoreboard.p3, { played: 1, wins: 1, points: 3 });
  assert.deepEqual(res.scoreboard.p1, { played: 1, wins: 0, points: 1 });
  assert.deepEqual(res.history, [{ gameId: 'fake', winners: ['p3'], summary: '最高 3' }]);
  const revAtEnd = lastTo(sent, 'dev_a', 'views').rev;
  assert.equal(lastTo(sent, 'dev_a', 'views').bySeat.p2.picks.p3, 3, 'the final views reveal the table');

  const again = room.again();
  assert.equal(again.ok, true, again.message);
  assert.equal(room.phase, 'playing');
  assert.equal(roomOf(sent, 'dev_host').lastResult, null);
  assert.deepEqual(roomOf(sent, 'dev_host').scoreboard.p3, { played: 1, wins: 1, points: 3 }, 'the scoreboard outlives the game');
  assert.ok(lastTo(sent, 'dev_a', 'views').rev > revAtEnd, 'rev only goes up, across games too');
  assert.notEqual(lastTo(sent, 'dev_host', 'views').bySeat.p1.word, word1, 'the bag does not repeat');

  pick(room, 'dev_a', 'p2', 3); pick(room, 'dev_b', 'p3', 3); pick(room, 'dev_host', 'p1', 3);
  clock.advance(1500);
  assert.equal(room.phase, 'results');
  assert.deepEqual(roomOf(sent, 'dev_host').scoreboard.p1, { played: 2, wins: 1, points: 4 });
  assert.equal(roomOf(sent, 'dev_host').history.length, 2);

  assert.equal(room.toLobby().ok, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(roomOf(sent, 'dev_host').gameId, 'fake', 'the game stays selected');
  assert.equal(room.again().ok, false);
});

test('room: only the seat\'s own device may act, host-internal actions are refused, bad input never throws', async () => {
  const { room, sent } = await started3();
  assert.equal(pick(room, 'dev_a', 'p3', 1), false, 'A cannot act for B');
  assert.equal(pick(room, 'dev_a', 'p1', 1), false, 'nor for the host');
  assert.equal(pick(room, 'dev_ghost', 'p2', 1), false);
  assert.equal(room.act('dev_a', 'p2', { type: ACT.NEXT }), false, '@-prefixed types are host-only');
  assert.equal(room.act('dev_a', 'p2', { type: ACT.CUE_DONE, id: 'x' }), false);
  assert.equal(room.act('dev_a', 'p2', 'pick'), false);
  assert.equal(room.act('dev_a', 'p2', null), false);
  assert.equal(room.act('dev_a', 'p2', { type: 'pick', n: 1, junk: 'x'.repeat(20_000) }), false, 'oversized');
  assert.equal(pick(room, 'dev_a', 'p2', 99), false, 'engine rejects an illegal pick');
  // the same rules over the wire
  room.receive('peer_a', { t: 'act', pid: 'p3', action: { type: 'pick', n: 1 }, rev: 1 });
  room.receive('peer_a', { t: 'act', pid: 'p2', action: { type: 'pick', n: 2 }, rev: 1 });
  room.receive('peer_unknown', { t: 'act', pid: 'p2', action: { type: 'pick', n: 1 } });
  assert.equal(lastTo(sent, 'dev_host', 'views').table.picked.p2, true);
  assert.equal(lastTo(sent, 'dev_host', 'views').table.picked.p3, false);
  assert.equal(pick(room, 'dev_a', 'p2', 1), false, 'a second pick is refused');
  assert.equal(sent.some((x) => x.peerId === 'peer_unknown' && x.msg.t === 'reject'), true, 'strangers are told to say hello first');
  room.receive('peer_a', { t: 'act' });
  room.receive('peer_a', 'garbage');
  room.receive('peer_a', { t: 42 });
});

test('room: a seat cannot forge @next / @cue-done / @auto to skip a narration step', async () => {
  const { room } = await started3({ narrationMode: 'voice' });      // voice: nothing completes a cue by itself
  pick(room, 'dev_a', 'p2', 1); pick(room, 'dev_b', 'p3', 1); pick(room, 'dev_host', 'p1', 1);
  assert.equal(room.session.state.phase, 'reveal');
  assert.equal(room.act('dev_a', 'p2', { type: ACT.NEXT }), false);
  assert.equal(room.act('dev_a', 'p2', { type: ACT.CUE_DONE, id: 'reveal:1' }), false);
  assert.equal(room.act('dev_a', 'p2', { type: ACT.AUTO, pid: 'p3' }), false);
  assert.equal(room.session.state.phase, 'reveal', 'the step is still running');
  assert.equal(room.next(), true, 'the host itself can');
  assert.equal(room.phase, 'results');
});

test('room: a device can hold several seats; its views carry exactly those seats', async () => {
  const { room, sent } = setup({ names: ['阿明'] });
  hello(room, 'peer_x', 'dev_x', '甲', '乙');
  const w = lastTo(sent, 'dev_x', 'welcome');
  assert.deepEqual(w.seats.map((s) => s.name), ['甲', '乙']);
  assert.ok(w.seats.every((s) => s.token));
  const ps = roomOf(sent, 'dev_host').players;
  assert.equal(ps.filter((p) => p.deviceId === 'dev_x').length, 2);
  await room.selectGame('fake');
  assert.equal(room.start().ok, true);
  const v = lastTo(sent, 'dev_x', 'views');
  assert.deepEqual(Object.keys(v.bySeat).sort(), ['p2', 'p3']);
  assert.deepEqual(v.focus.pids.sort(), ['p2', 'p3']);
  assert.equal(v.bySeat.p2.me, 'p2');
  assert.equal(v.bySeat.p3.me, 'p3');
  assert.equal(pick(room, 'dev_x', 'p2', 1), true);
  assert.equal(pick(room, 'dev_x', 'p3', 2), true);
  assert.equal(pick(room, 'dev_x', 'p1', 3), false, 'but not the host\'s seat');
  assert.deepEqual(lastTo(sent, 'dev_x', 'views').focus, null, 'both seats done → no focus left on this device');
});

test('room: addSeat (shared phone), names must be unique, kick, leave and colours', async () => {
  const { room, sent } = setup();
  hello(room, 'peer_a', 'dev_a', '阿花');
  assert.equal(room.addSeat('dev_host', '阿媽').ok, true);
  assert.equal(room.addSeat('dev_host', '阿媽').ok, false, 'duplicate name');
  assert.equal(room.addSeat('dev_nobody', 'x').ok, false);
  const w = lastTo(sent, 'dev_host', 'welcome');
  assert.deepEqual(w.seats.map((s) => s.name), ['阿明', '阿媽']);
  assert.ok(w.seats.every((s) => !('token' in s)), 'the host device never needs tokens');

  hello(room, 'peer_z', 'dev_z', '阿花');
  assert.match(lastTo(sent, null, 'reject').reason, /已經有人叫「阿花」/);
  assert.equal(room.deviceOfPeer('peer_z'), null, 'a rejected hello creates no device');

  // a remote device adds its own extra seat and learns its token through a fresh welcome
  room.receive('peer_a', { t: 'lobby', op: 'addSeat', name: '阿花妹' });
  const wa = lastTo(sent, 'dev_a', 'welcome');
  assert.deepEqual(wa.seats.map((s) => s.name), ['阿花', '阿花妹']);
  assert.ok(wa.seats.every((s) => s.token));
  room.receive('peer_a', { t: 'lobby', op: 'addSeat', name: '阿明' });
  assert.match(lastTo(sent, 'dev_a', 'notice').text, /已經有人叫/, 'non-fatal errors arrive as notices, not rejects');

  // colours
  const [c0, c1] = [PALETTE[0], PALETTE[1]];
  const mine = player(room, '阿花');
  const host = player(room, '阿明');
  assert.equal(host.color, c0);
  assert.equal(room.setColor('dev_a', mine.id, c0).ok, false, 'taken');
  assert.equal(room.setColor('dev_a', mine.id, '#123456').ok, false, 'not in the palette');
  assert.equal(room.setColor('dev_a', host.id, PALETTE[15]).ok, false, 'not your seat');
  assert.equal(room.setColor('dev_a', mine.id, PALETTE[15]).ok, true);
  room.receive('peer_a', { t: 'lobby', op: 'color', pid: mine.id, color: PALETTE[14] });
  assert.equal(player(room, '阿花').color, PALETTE[14]);
  assert.equal(room.setColor('dev_host', mine.id, c1).ok, true, 'the host may recolour anyone');
  assert.equal(new Set(roomOf(sent, 'dev_host').players.map((p) => p.color)).size, roomOf(sent, 'dev_host').players.length);

  // moving seats
  const order = () => roomOf(sent, 'dev_host').players.map((p) => p.name);
  assert.deepEqual(order(), ['阿明', '阿花', '阿媽', '阿花妹']);
  room.moveSeat(player(room, '阿花').id, 0);
  assert.deepEqual(order(), ['阿花', '阿明', '阿媽', '阿花妹']);
  assert.deepEqual(roomOf(sent, 'dev_host').players.map((p) => p.seat), [0, 1, 2, 3]);

  // leaving and kicking in the lobby free the seat
  room.receive('peer_a', { t: 'lobby', op: 'leave', pid: player(room, '阿花妹').id });
  assert.deepEqual(order(), ['阿花', '阿明', '阿媽']);
  assert.equal(room.removeSeat('dev_a', player(room, '阿明').id).ok, false);
  assert.equal(room.kick(player(room, '阿明').id).ok, false, 'the host cannot be kicked');
  assert.equal(room.kick(player(room, '阿花').id).ok, true);
  assert.equal(lastTo(sent, 'dev_a', 'reject').reason, '你已經被請出咗房');
  assert.deepEqual(order(), ['阿明', '阿媽']);
  hello(room, 'peer_a2', 'dev_a', '阿花');
  assert.match(lastTo(sent, null, 'reject').reason, /請出/, 'a kicked device stays out');
});

test('room: reconnect by token keeps the seat; a stolen device id does not', async () => {
  const { room, sent } = await started3();
  const secretA = lastTo(sent, 'dev_a', 'views').bySeat.p2.secret;
  const tokenA = player(room, '阿花').token;

  room.peerClosed('peer_a');
  assert.equal(roomOf(sent, 'dev_host').players.find((p) => p.id === 'p2').connected, false);
  assert.equal(room.phase, 'playing', 'the game goes on');

  // same device id, new connection
  hello(room, 'peer_a2', 'dev_a', { name: '阿花', token: tokenA });
  const w = lastTo(sent, 'dev_a', 'welcome');
  assert.deepEqual(w.seats.map((s) => s.id), ['p2']);
  assert.equal(w.views.bySeat.p2.secret, secretA, 'the private view comes back');
  assert.equal(roomOf(sent, 'dev_host').players.find((p) => p.id === 'p2').connected, true);
  assert.equal(room.deviceOfPeer('peer_a2'), 'dev_a');

  // device id lost (cleared storage) but the token survived: the seat moves to the new device
  room.peerClosed('peer_a2');
  hello(room, 'peer_a3', 'dev_new', { name: '阿花', token: tokenA });
  const w3 = lastTo(sent, 'dev_new', 'welcome');
  assert.equal(w3.device, 'dev_new');
  assert.deepEqual(w3.seats.map((s) => s.id), ['p2']);
  assert.equal(pick(room, 'dev_new', 'p2', 1), true);
  assert.equal(pick(room, 'dev_a', 'p2', 1), false, 'the old device id no longer owns it');

  // somebody claims B's device id without B's token: they get a different id and none of B's views
  const before = sent.length;
  hello(room, 'peer_evil', 'dev_b', '路人');
  const we = sent.slice(before).find((x) => x.msg.t === 'welcome' && x.peerId === 'peer_evil').msg;
  assert.notEqual(we.device, 'dev_b');
  assert.equal(we.seats[0].name, '路人');
  assert.deepEqual(we.views.bySeat, {}, 'mid-game newcomers watch from the table view');
  const leaked = JSON.stringify(sent.slice(before).filter((x) => x.peerId === 'peer_evil'));
  assert.ok(!leaked.includes(room.session.state.secrets.p3), "B's secret did not reach the impostor");
  assert.ok(!leaked.includes(player(room, '阿強').token), "nor B's token");
  // and nobody can claim the host's device
  hello(room, 'peer_evil2', 'dev_host', '路人乙');
  const we2 = sent.filter((x) => x.msg.t === 'welcome' && x.peerId === 'peer_evil2').at(-1).msg;
  assert.notEqual(we2.device, 'dev_host');
  assert.equal(room.act(we2.device, 'p1', { type: 'pick', n: 1 }), false);
});

test('room: a protocol mismatch or an empty hello is rejected', () => {
  const { room, sent } = setup();
  room.receive('p1', { t: 'hello', deviceId: 'dev_old', name: '舊版' });
  assert.match(lastTo(sent, null, 'reject').reason, /版本/);
  room.receive('p2', { t: 'hello', v: PROTOCOL, deviceId: 'dev_q', seats: [] });
  assert.match(lastTo(sent, null, 'reject').reason, /名/);
  room.receive('p3', { t: 'hello', v: PROTOCOL, deviceId: 'dev_q', seats: [{ name: '   ' }] });
  assert.equal(sent.filter((x) => x.msg.t === 'reject').length, 3);
  assert.equal(room.seatedCount, 1);
});

test('room: stall detection flags a seat whose phone is away, then autoAct unblocks the table', async () => {
  const t = await lobby3({ game: makeGame({ autoAct: true }) });
  const { room, clock, sent } = t;
  room.setConfig({ pickMs: 10 * 60_000, rounds: 3 });
  room.start();
  room.peerClosed('peer_a');
  const t0 = clock.t;
  clock.advance(44_000);
  assert.deepEqual(roomOf(sent, 'dev_host').stalled, []);
  clock.advance(1_000);
  assert.deepEqual(roomOf(sent, 'dev_host').stalled, [{ pid: 'p2', since: t0 }]);
  assert.deepEqual(roomOf(sent, 'dev_b').stalled, [], 'only the host is told');

  assert.equal(room.autoAct('p2'), true);
  assert.equal(room.session.state.picks.p2, 3);
  assert.deepEqual(roomOf(sent, 'dev_host').stalled, []);
  pick(room, 'dev_b', 'p3', 1); pick(room, 'dev_host', 'p1', 1);
  clock.advance(1500);
  assert.equal(room.phase, 'results');
  assert.deepEqual(room.autoAct('p2'), false, 'nothing to auto-act after the game');
});

test('room: the stall clock restarts whenever the game moves, and a connected seat is never "stalled"', async () => {
  const { room, clock, sent } = await lobby3();
  room.setConfig({ pickMs: 10 * 60_000, rounds: 3 });
  room.start();
  room.peerClosed('peer_a');
  clock.advance(30_000);
  pick(room, 'dev_host', 'p1', 2);                          // the table moved on
  clock.advance(44_000);
  assert.deepEqual(roomOf(sent, 'dev_host').stalled, [], '44 s since the last change');
  clock.advance(1_000);
  assert.equal(roomOf(sent, 'dev_host').stalled.length, 1);
  assert.equal(roomOf(sent, 'dev_host').stalled[0].pid, 'p2');
  hello(room, 'peer_a2', 'dev_a', { name: '阿花', token: player(room, '阿花').token });
  assert.deepEqual(roomOf(sent, 'dev_host').stalled, [], 'back online → no longer stalled');
  assert.equal(roomOf(sent, 'dev_host').players.find((p) => p.id === 'p3').connected, true);
});

test('room: without autoAct, the default is the first legal action (stalledMs from config wins)', async () => {
  const { room, clock, sent } = await lobby3({ stallMs: 1000 });
  room.setConfig({ pickMs: 10 * 60_000, rounds: 3, stallMs: 5_000 });
  room.start();
  room.peerClosed('peer_b');
  clock.advance(4_999);
  assert.equal(roomOf(sent, 'dev_host').stalled.length, 0);
  clock.advance(1);
  assert.equal(roomOf(sent, 'dev_host').stalled.length, 1);
  assert.equal(room.autoAct('p3'), true);
  assert.equal(room.session.state.picks.p3, 1);
});

test('room: pause freezes the table and shifts the deadline on resume', async () => {
  const { room, clock, sent } = await lobby3();
  room.setConfig({ pickMs: 20_000, rounds: 3 });
  room.start();
  clock.advance(5_000);
  assert.equal(room.pause(), true);
  assert.equal(roomOf(sent, 'dev_a').paused, true, 'everyone sees the pause');
  assert.equal(pick(room, 'dev_a', 'p2', 1), false, 'input is refused while paused');
  assert.equal(room.next(), false);
  clock.advance(100_000);
  assert.equal(room.session.state.phase, 'pick');
  assert.equal(room.resume(), true);
  assert.equal(roomOf(sent, 'dev_a').paused, false);
  assert.equal(lastTo(sent, 'dev_a', 'views').table.deadline, room.session.deadline());
  clock.advance(14_999);
  assert.equal(room.session.state.phase, 'pick');
  clock.advance(1);
  assert.equal(room.session.state.phase, 'reveal');
});

test('room: a device never receives another device\'s views, secrets or tokens', async () => {
  const { room, sent, clock } = await lobby3();
  room.start();
  hello(room, 'peer_c', 'dev_c', '遲到');                    // late joiner → spectator
  pick(room, 'dev_a', 'p2', 2);
  room.peerClosed('peer_b');
  pick(room, 'dev_host', 'p1', 3);
  hello(room, 'peer_b2', 'dev_b', { name: '阿強', token: player(room, '阿強').token });
  pick(room, 'dev_b', 'p3', 1);
  clock.advance(1500);

  const secrets = room.session.state.secrets;
  const tokens = Object.fromEntries(room.snapshot().players.map((p) => [p.id, p.token]));
  const owner = { dev_host: ['p1'], dev_a: ['p2'], dev_b: ['p3'], dev_c: ['p4'] };
  let checked = 0;
  for (const { deviceId, msg } of sent) {
    if (!owner[deviceId]) continue;
    const text = JSON.stringify(msg);
    for (const [dev, pids] of Object.entries(owner)) {
      if (dev === deviceId) continue;
      for (const pid of pids) {
        if (secrets[pid]) assert.ok(!text.includes(secrets[pid]), `${deviceId} got ${pid}'s secret in ${msg.t}`);
        assert.ok(!text.includes(tokens[pid]), `${deviceId} got ${pid}'s token in ${msg.t}`);
      }
    }
    const v = msg.t === 'views' ? msg : msg.t === 'welcome' ? msg.views : null;
    if (v) {
      checked++;
      assert.ok(Object.keys(v.bySeat).every((pid) => owner[deviceId].includes(pid)), `${deviceId} bySeat: ${Object.keys(v.bySeat)}`);
      if (v.focus) assert.ok(v.focus.pids.every((pid) => owner[deviceId].includes(pid)));
      assert.ok(!JSON.stringify(v.table).includes('secret'), 'the table view holds no private fields');
    }
  }
  assert.ok(checked > 8, 'the scan looked at a meaningful number of messages');
  assert.deepEqual(Object.keys(lastTo(sent, 'dev_c', 'views').bySeat), [], 'a spectator only gets the table view');
  assert.ok(lastTo(sent, 'dev_c', 'views').table);
});

test('room: late joiners spectate mid-game and sit down for the next one', async () => {
  const { room, clock, sent } = await started3();
  hello(room, 'peer_d', 'dev_d', '阿D');
  const w = lastTo(sent, 'dev_d', 'welcome');
  const me = w.room.players.find((p) => p.name === '阿D');
  assert.equal(me.spectator, true);
  assert.deepEqual(w.views.bySeat, {});
  assert.equal(pick(room, 'dev_d', me.id, 1), false, 'a spectator cannot act');
  assert.equal(room.session.state.players.length, 3, 'the engine does not know about spectators');

  pick(room, 'dev_a', 'p2', 1); pick(room, 'dev_b', 'p3', 1); pick(room, 'dev_host', 'p1', 1);
  clock.advance(1500);
  assert.equal(room.phase, 'results');
  assert.equal(roomOf(sent, 'dev_d').scoreboard[me.id].played, 0, 'spectators are not scored');
  assert.equal(room.again().ok, true);
  assert.equal(room.session.state.players.length, 4, 'now they play');
  assert.deepEqual(roomOf(sent, 'dev_host').config, { pickMs: 30_000, rounds: 4 }, 'untouched config follows the head-count');
  assert.deepEqual(Object.keys(lastTo(sent, 'dev_d', 'views').bySeat), [me.id]);
});

test('room: a game that no longer fits drops back to the lobby with the reason', async () => {
  const { room, clock, sent } = await started3();
  for (const [i, n] of ['阿D', '阿E', '阿F'].entries()) hello(room, `peer_x${i}`, `dev_x${i}`, n);   // 3 + 3 spectators
  pick(room, 'dev_a', 'p2', 1); pick(room, 'dev_b', 'p3', 1); pick(room, 'dev_host', 'p1', 1);
  clock.advance(1500);
  const r = room.again();                                  // 6 players, the game takes 2–5
  assert.equal(r.ok, false);
  assert.match(r.message, /最多 5/);
  assert.equal(room.phase, 'lobby');
  assert.equal(roomOf(sent, 'dev_host').configValid.ok, false);
  assert.equal(room.kick('p4').ok, true);
  assert.equal(room.kick('p5').ok, true);
  const go = room.start();
  assert.equal(go.ok, true, go.message);
});

test('room: config follows the head-count until the host edits it; the picker can survive bad games', async () => {
  const { room, sent } = setup();
  hello(room, 'peer_a', 'dev_a', '阿花');
  assert.equal((await room.selectGame('fake')).ok, true);
  assert.equal(roomOf(sent, 'dev_host').config.rounds, 2);
  hello(room, 'peer_b', 'dev_b', '阿強');
  assert.equal(roomOf(sent, 'dev_host').config.rounds, 3, 'defaults(n) re-applied while untouched');
  room.setConfig({ pickMs: 5_000, rounds: 9 });
  hello(room, 'peer_c', 'dev_c', '阿C');
  assert.deepEqual(roomOf(sent, 'dev_host').config, { pickMs: 5_000, rounds: 9 }, 'edited config is left alone');
  assert.equal((await room.selectGame('fake')).ok, true);
  assert.deepEqual(roomOf(sent, 'dev_host').config, { pickMs: 30_000, rounds: 4 }, 'choosing a game recomputes the recommendation');

  const miss = await room.selectGame('missing');
  assert.equal(miss.ok, false);
  assert.match(miss.message, /即將推出/);
  assert.equal(roomOf(sent, 'dev_host').gameId, 'fake', 'a failed load changes nothing');
  assert.equal(roomOf(sent, 'dev_host').loading, null);

  // a game outside its player range is selectable but not startable, and says why
  for (const [i, n] of ['D', 'E', 'F'].entries()) hello(room, `peer_y${i}`, `dev_y${i}`, n);
  assert.deepEqual(roomOf(sent, 'dev_host').configValid.message, '最多 5 個人（而家 7）');
  assert.equal(room.start().ok, false);
});

test('room: the last-used config of a game is remembered for next time', async () => {
  const t = await lobby3();
  t.room.setConfig({ pickMs: 7_000, rounds: 3 });
  t.room.start();
  t.room.toLobby();
  assert.equal((await t.room.selectGame('fake')).ok, true);
  assert.deepEqual(roomOf(t.sent, 'dev_host').config, { pickMs: 7_000, rounds: 3 }, 'defaults(n, prev) received the config of the last game');
});

test('room: selecting games concurrently — the last choice wins, a slow load cannot clobber it', async () => {
  const gate = {};
  const slow = new Promise((r) => { gate.release = r; });
  const t = setup();
  const loaded = { fast: makeGame(), slow: makeGame() };
  loaded.slow.meta = { ...loaded.slow.meta, id: 'slow' };
  loaded.fast.meta = { ...loaded.fast.meta, id: 'fast' };
  const room = new Room({ ...t.deps, loadGame: async (id) => { if (id === 'slow') await slow; return loaded[id]; } });
  hello(room, 'peer_a', 'dev_a', '阿花');
  const p1 = room.selectGame('slow');
  const p2 = room.selectGame('fast');
  assert.equal((await p2).ok, true);
  gate.release();
  const r1 = await p1;
  assert.equal(r1.ok, false);
  assert.equal(room.snapshot().gameId, 'fast');
});

test('room: snapshot → restore under the same code; the session comes back paused and carries on', async () => {
  const t = await started3();
  const { room, clock, sent } = t;
  clock.advance(10_000);
  pick(room, 'dev_a', 'p2', 2);
  const d = room.session.deadline();
  const secretB = lastTo(sent, 'dev_b', 'views').bySeat.p3.secret;
  const snap = JSON.parse(JSON.stringify(room.snapshot()));
  assert.equal(snap.code, '1234');
  assert.equal(snap.v, 2);

  const clock2 = new FakeClock(clock.t + 40_000);
  const sent2 = [];
  const room2 = await Room.restore(snap, {
    hostDeviceId: 'dev_host', now: clock2.now, rng: mulberry32(2), bag: t.bag, timers: clock2, narrationMode: 'silent',
    loadGame: t.deps.loadGame, send: (deviceId, msg, peerId) => sent2.push({ deviceId, peerId, msg: clone(msg) }),
  });
  assert.equal(room2.code, '1234');
  assert.equal(room2.phase, 'playing');
  room2.welcome('dev_host');
  const wh = lastTo(sent2, 'dev_host', 'welcome');
  assert.equal(wh.room.paused, true, 'restored paused: the host taps 繼續');
  assert.deepEqual(wh.room.players.map((p) => p.connected), [true, false, false]);
  assert.equal(wh.views.bySeat.p1.phase, 'pick');
  assert.equal(pick(room2, 'dev_host', 'p1', 1), false, 'paused');

  hello(room2, 'peer_b9', 'dev_b', { name: '阿強', token: player(room2, '阿強').token });   // reconnects with the old token
  const wb = lastTo(sent2, 'dev_b', 'welcome');
  assert.equal(wb.views.bySeat.p3.secret, secretB);
  assert.equal(wb.room.paused, true);

  assert.equal(room2.resume(), true);
  assert.equal(room2.session.deadline(), d + 40_000, 'the clock stopped when the host went away');
  assert.equal(pick(room2, 'dev_host', 'p1', 1), true);
  assert.equal(pick(room2, 'dev_b', 'p3', 3), true);
  hello(room2, 'peer_a9', 'dev_a', { name: '阿花', token: player(room2, '阿花').token });
  clock2.advance(1500);
  assert.equal(room2.phase, 'results');
  assert.deepEqual(room2.snapshot().scoreboard.p3, { played: 1, wins: 1, points: 3 });

  // a lobby snapshot restores the chosen game and its config
  const l = await lobby3();
  l.room.setConfig({ pickMs: 7_000, rounds: 3 });
  const lsnap = JSON.parse(JSON.stringify(l.room.snapshot()));
  const lroom = await Room.restore(lsnap, { ...l.deps, send: () => {} });
  lroom.welcome('dev_host');
  assert.equal(lroom.phase, 'lobby');
  assert.equal(lroom.snapshot().gameId, 'fake');
  assert.deepEqual(lroom.snapshot().config, { pickMs: 7_000, rounds: 3 });
  assert.equal(lroom.start().ok, true);
});

test('room: ink is relayed to everyone but the sender, rejected strokes are corrected, newcomers are synced', async () => {
  const { room, sent } = await started3();           // the artist is p2 (device dev_a)
  const n0 = sent.length;
  assert.equal(room.ink('dev_a', 'p2', { stroke: 's1', pts: [[10, 10], [20, 20]] }), true);
  const out = sent.slice(n0).filter((x) => x.msg.t === 'ink');
  assert.deepEqual(out.map((x) => x.deviceId).sort(), ['dev_b', 'dev_host']);
  assert.deepEqual(out[0].msg.pts, [[10, 10], [20, 20]]);
  assert.equal(out[0].msg.pid, 'p2');

  const n1 = sent.length;
  assert.equal(room.ink('dev_b', 'p3', { stroke: 's9', pts: [[1, 1]] }), false);
  assert.equal(sent.slice(n1).filter((x) => x.msg.t === 'inkSync' && x.deviceId === 'dev_b').length, 1, 'the sender gets the real drawing back');
  assert.equal(sent.slice(n1).filter((x) => x.msg.t === 'ink').length, 0);
  const n2 = sent.length;
  assert.equal(room.ink('dev_b', 'p3', { stroke: 's10', pts: [[1, 1]] }), false);
  assert.equal(sent.slice(n2).filter((x) => x.msg.t === 'inkSync').length, 0, 'resyncs are throttled');

  room.receive('peer_a', { t: 'ink', pid: 'p2', stroke: 's1', pts: [[30, 30]], end: true });     // over the wire
  assert.equal(room.session.drawing.strokes[0].pts.length, 3);

  hello(room, 'peer_n', 'dev_n', '新人');                      // a newcomer is synced with the drawing
  const sync = lastTo(sent, 'dev_n', 'inkSync');
  assert.equal(sync.ink.strokes.length, 1);
  assert.equal(sync.ink.strokes[0].pts.length, 3);

});

test('room: ink epoch bump clears the drawing for everyone', async () => {
  const { room, sent } = await started3();
  room.ink('dev_a', 'p2', { stroke: 's1', pts: [[10, 10]], end: true });
  const n = sent.length;
  assert.equal(room.act('dev_a', 'p2', { type: 'newpic' }), true);
  const syncs = sent.slice(n).filter((x) => x.msg.t === 'inkSync');
  assert.deepEqual(syncs.map((x) => x.deviceId).sort(), ['dev_a', 'dev_b', 'dev_host']);
  assert.ok(syncs.every((x) => x.msg.ink.epoch === 1 && x.msg.ink.strokes.length === 0));
});

test('room: every new game starts all devices on a blank drawing', async () => {
  const { room, sent, clock } = await started3();
  room.ink('dev_a', 'p2', { stroke: 's1', pts: [[10, 10]], end: true });
  pick(room, 'dev_a', 'p2', 1); pick(room, 'dev_b', 'p3', 1); pick(room, 'dev_host', 'p1', 1);
  clock.advance(1500);
  const n = sent.length;
  assert.equal(room.again().ok, true);
  const syncs = sent.slice(n).filter((x) => x.msg.t === 'inkSync');
  assert.deepEqual(syncs.map((x) => x.deviceId).sort(), ['dev_a', 'dev_b', 'dev_host']);
  assert.ok(syncs.every((x) => x.msg.ink.strokes.length === 0), 'the engine epoch restarts at 0, so the Room must say so itself');
  assert.deepEqual(room.session.drawing, emptyInk(0));
});

test('room: ping gets a pong with the host clock; close() tells every device', async () => {
  const { room, sent, clock } = await started3();
  room.receive('peer_a', { t: 'ping', c: 123 });
  assert.deepEqual(lastTo(sent, 'dev_a', 'pong'), { t: 'pong', c: 123, hostNow: clock.t });
  room.peerClosed('peer_b');
  room.close('收工');
  assert.equal(lastTo(sent, 'dev_a', 'reject').reason, '收工');
  assert.equal(msgsTo(sent, 'dev_b', 'reject').length, 0, 'disconnected devices have nobody to tell');
});

test('room: bye in the lobby frees the seat, mid-game it only disconnects', async () => {
  const { room, sent } = setup();
  hello(room, 'peer_a', 'dev_a', '阿花');
  hello(room, 'peer_b', 'dev_b', '阿強');
  room.receive('peer_a', { t: 'bye' });
  assert.deepEqual(roomOf(sent, 'dev_host').players.map((p) => p.name), ['阿明', '阿強']);
  await room.selectGame('fake');
  room.start();
  room.receive('peer_b', { t: 'bye' });
  const p = roomOf(sent, 'dev_host').players.find((x) => x.name === '阿強');
  assert.equal(p.connected, false);
  hello(room, 'peer_b2', 'dev_b', { name: '阿強', token: player(room, '阿強').token });
  assert.equal(roomOf(sent, 'dev_host').players.find((x) => x.name === '阿強').connected, true, 'it can come back');
});

test('room: kicking mid-game orphans the seat so stall detection can play it', async () => {
  const { room, sent, clock } = await lobby3();
  room.setConfig({ pickMs: 10 * 60_000, rounds: 3 });
  room.start();
  const oldToken = player(room, '阿強').token;
  assert.equal(room.kick('p3').ok, true);
  assert.equal(lastTo(sent, 'dev_b', 'reject').reason, '你已經被請出咗房');
  const n = sent.length;
  hello(room, 'peer_b_again', 'dev_b_new', { name: '阿強', token: oldToken });
  assert.equal(sent.slice(n).some((x) => x.msg.t === 'welcome'), false, 'the old token does not reclaim the orphaned seat');
  assert.match(lastTo(sent, null, 'reject').reason, /已經有人叫/);
  assert.equal(room.session.state.players.length, 3, 'the engine still has the seat');
  assert.equal(pick(room, 'dev_b', 'p3', 3), false);
  clock.advance(45_000);
  assert.equal(roomOf(sent, 'dev_host').stalled[0].pid, 'p3');
  assert.equal(room.autoAct('p3'), true);
  pick(room, 'dev_a', 'p2', 1); pick(room, 'dev_host', 'p1', 1);
  clock.advance(1500);
  assert.equal(room.phase, 'results');
  assert.equal(room.toLobby().ok, true);
  assert.deepEqual(roomOf(sent, 'dev_host').players.map((p) => p.name), ['阿明', '阿花'], 'orphans are gone after the game');
});

// ============================================================
// createApp (host + client over an in-memory net)
// ============================================================

function makeLoopback() {
  const hosts = new Map();
  let n = 0;
  class Em {
    h = new Map();
    on(ev, fn) { (this.h.get(ev) ?? this.h.set(ev, []).get(ev)).push(fn); return this; }
    emit(ev, ...a) { for (const fn of this.h.get(ev) ?? []) fn(...a); }
  }
  class LoopHost extends Em {
    conns = new Map();
    async open(preferred) { this.code = preferred ?? '1352'; hosts.set(this.code, this); return this.code; }
    sendTo(peerId, msg) { const c = this.conns.get(peerId); if (!c) return false; c.deliver(msg); return true; }
    close() { hosts.delete(this.code); for (const c of this.conns.values()) c.drop(); this.conns.clear(); }
  }
  class LoopClient extends Em {
    async connect(code) { this.code = code; this.dial(); }
    dial() {
      const host = hosts.get(this.code);
      if (!host) throw new Error('no such room');
      this.host = host;
      this.peerId = `peer${++n}`;
      host.conns.set(this.peerId, this);
      host.emit('peer-open', this.peerId);
      this.emit('status', 'online');
      this.emit('open');
    }
    /** What the real ClientNet does by itself after a drop. */
    redial() { this.dial(); }
    send(msg) { if (!this.host) return false; const m = clone(msg); const { host, peerId } = this; queueMicrotask(() => host.emit('message', peerId, m)); return true; }
    deliver(msg) { const m = clone(msg); queueMicrotask(() => this.emit('message', m)); }
    drop() { const { host, peerId } = this; this.host = null; if (host) { host.conns.delete(peerId); host.emit('peer-close', peerId); } this.emit('status', 'offline'); }
    close() { this.drop(); }
  }
  const clients = [];
  return {
    hosts,
    clients,
    makeHostNet: () => new LoopHost(),
    makeClientNet: () => { const c = new LoopClient(); clients.push(c); return c; },
  };
}

function appFixture({ narrator = null, storage = new Map(), clientSkew = 0, clock = new FakeClock(), hostTimers, loop = makeLoopback(), game = makeGame() } = {}) {
  const registry = [
    { id: 'fake', meta: { name: '測試', emoji: '🧪', players: [2, 5], minutes: [1, 2], batch: 1 }, load: async () => ({ default: game }) },
    { id: 'later', meta: { name: '未有', emoji: '🚧', players: [2, 5], minutes: [1, 2], batch: 2 }, load: async () => { throw new Error('404'); } },
  ];
  const common = { registry, timers: clock, now: clock.now, rng: mulberry32(21), banks: FAKE_BANK, makeHostNet: loop.makeHostNet, makeClientNet: loop.makeClientNet };
  const host = createApp({ ...common, timers: hostTimers ?? clock, narrator, storage });
  const client = (clientStorage = new Map()) => createApp({ ...common, now: () => clock.now() + clientSkew, storage: clientStorage });
  return { host, client, clock, loop, registry, storage, common, game };
}

test('app: host + client — join, lobby, play, results, clock sync, privacy', async () => {
  const f = appFixture({ clientSkew: 5_000 });
  const host = f.host;
  const code = await host.host({ names: ['阿明'] });
  assert.equal(code, '1352');
  assert.equal(host.state.mode, 'host');
  assert.equal(host.state.conn, 'online');
  assert.equal(host.state.isHost, true);
  assert.deepEqual(host.state.mySeats, ['p1']);
  assert.equal(host.state.activeSeat, 'p1');

  const a = f.client();
  await a.join(code, { names: ['阿花'] });
  await settle();
  assert.equal(a.state.mode, 'client');
  assert.equal(a.state.conn, 'online');
  assert.equal(a.state.isHost, false);
  assert.deepEqual(a.state.mySeats, ['p2']);
  assert.notEqual(a.state.deviceId, host.state.deviceId);
  assert.deepEqual(a.state.room.players.map((p) => p.name), ['阿明', '阿花']);
  assert.deepEqual(host.state.room.players.map((p) => p.name), ['阿明', '阿花'], 'the host saw the join');

  const b = f.client();
  await b.join(code, { names: ['阿強'] });
  await settle();

  // lobby
  assert.deepEqual(a.lobby.start(), { ok: false, message: '淨係房主先做到呢樣' });
  assert.equal((await a.lobby.selectGame('fake')).ok, false);
  const none = await host.lobby.selectGame('later');
  assert.equal(none.ok, false);
  assert.match(none.message, /即將推出/);
  assert.equal((await host.lobby.selectGame('fake')).ok, true);
  await settle();
  assert.equal(a.state.room.gameId, 'fake');
  assert.deepEqual(a.state.room.configSummary, ['3 人', '30 秒']);
  assert.equal((await host.game('fake')).meta.id, 'fake');
  assert.equal(await host.game('fake'), await host.game('fake'), 'cached');
  await assert.rejects(() => host.game('later'));

  // colours from a client
  const free = PALETTE[12];
  a.lobby.setColor('p2', free);
  await settle();
  assert.equal(host.state.room.players.find((p) => p.id === 'p2').color, free);
  assert.deepEqual(a.lobby.setColor('p1', PALETTE[11]).ok, false, 'not your seat');

  // play
  assert.deepEqual(host.lobby.start(), { ok: true, message: '' });
  await settle();
  assert.equal(a.state.room.phase, 'playing');
  assert.deepEqual(Object.keys(a.state.views), ['p2']);
  assert.equal(a.state.views.p2.phase, 'pick');
  assert.ok(a.state.table);
  assert.deepEqual(a.state.focus, { pids: ['p2'], anonymous: '輪到你' });
  assert.equal(a.state.cue, null);

  const hostSecret = host.state.views.p1.secret;
  assert.ok(!JSON.stringify(a.state).includes(hostSecret), 'the client never saw the host\'s secret');
  assert.equal(a.act('p1', { type: 'pick', n: 1 }), false, 'not my seat');

  assert.equal(a.act('p2', { type: 'pick', n: 2 }), true);
  b.act('p3', { type: 'pick', n: 3 });
  host.act('p1', { type: 'pick', n: 1 });
  await settle();
  assert.equal(host.state.cue.text, '揭曉');
  assert.equal(a.state.cue, null);
  f.clock.advance(1500);                                    // no narrator → silent mode paces the cue
  await settle();

  assert.equal(a.state.room.phase, 'results');
  assert.deepEqual(a.state.room.lastResult.winners, ['p3']);
  assert.deepEqual(b.state.room.scoreboard.p3, { played: 1, wins: 1, points: 3 });
  assert.equal(a.state.views.p2.picks.p3, 3);
  assert.equal(host.state.rev, a.state.rev, 'both sides are on the same rev');

  // clock sync: the client's wall clock runs 5 s fast; clock.now() is host time
  assert.equal(a.clock.now(), host.clock.now());
  assert.equal(host.clock.now(), f.clock.now());

  // results controls are host-only
  assert.deepEqual(a.results.again(), { ok: false, message: '淨係房主先做到呢樣' });
  assert.equal(a.hostCtl.pause(), false);
  assert.equal(host.results.again().ok, true);
  await settle();
  assert.equal(a.state.room.phase, 'playing');
  assert.equal(host.results.toLobby().ok, true);
  await settle();
  assert.equal(a.state.room.phase, 'lobby');
  assert.deepEqual(a.state.views, {});
  assert.equal(a.state.table, null);
});

test('app: a dropped client reconnects by token and gets its private view back', async () => {
  const f = appFixture();
  const host = f.host;
  const code = await host.host({ names: ['阿明'] });
  const a = f.client();
  await a.join(code, { names: ['阿花'] });
  await host.lobby.selectGame('fake');
  host.lobby.start();
  await settle();
  const secret = a.state.views.p2.secret;

  f.loop.clients[0].drop();                                  // the network blips
  await settle();
  assert.equal(a.state.conn, 'reconnecting');
  assert.equal(host.state.room.players.find((p) => p.id === 'p2').connected, false);
  assert.equal(a.state.views.p2.secret, secret, 'the last views stay on screen meanwhile');

  f.loop.clients[0].redial();                                // the real ClientNet re-dials by itself
  await settle();
  assert.equal(a.state.conn, 'online');
  assert.deepEqual(a.state.mySeats, ['p2'], 'same seat, found by token');
  assert.equal(a.state.views.p2.secret, secret);
  assert.equal(host.state.room.players.find((p) => p.id === 'p2').connected, true);
  assert.equal(host.state.room.players.length, 2, 'no ghost seat was created');
});

test('app: a client page reload resumes by token — same seat, same private view, no ghost', async () => {
  const f = appFixture();
  const code = await f.host.host({ names: ['阿明'] });
  const storage = new Map();
  const a = f.client(storage);
  await a.join(code, { names: ['阿花'] });
  await f.host.lobby.selectGame('fake');
  f.host.lobby.start();
  await settle();
  const secret = a.state.views.p2.secret;
  const device = a.state.deviceId;
  assert.equal(JSON.parse(storage.get('bgb:resume')).mode, 'client');
  assert.equal(JSON.parse(storage.get('bgb:seats:1352'))[0].name, '阿花');

  f.loop.clients[0].drop();                                  // the old page is gone
  await settle();
  const a2 = f.client(storage);                              // a fresh page over the same localStorage
  assert.equal(await a2.resume(), true);
  assert.equal(a2.state.mode, 'client');
  assert.equal(a2.state.deviceId, device);
  assert.deepEqual(a2.state.mySeats, ['p2']);
  assert.equal(a2.state.views.p2.secret, secret);
  assert.equal(f.host.state.room.players.length, 2, 'no ghost seat');
  assert.equal(f.host.state.room.players.find((p) => p.id === 'p2').connected, true);
  assert.equal(a2.act('p2', { type: 'pick', n: 2 }), true);
  await settle();
  assert.equal(f.host.state.views.p1.picked.p2, true);
});

test('app: leaving in the lobby frees the seat and forgets the tokens; the host leaving tells everyone', async () => {
  const storage = new Map();
  const f = appFixture({ storage });
  const code = await f.host.host({ names: ['阿明'] });
  const a = f.client();
  await a.join(code, { names: ['阿花'] });
  const b = f.client();
  await b.join(code, { names: ['阿強'] });
  await settle();
  assert.equal(f.host.state.room.players.length, 3);
  a.leave();
  await settle();
  assert.equal(a.state.mode, null);
  assert.equal(a.state.conn, 'idle');
  assert.deepEqual(f.host.state.room.players.map((p) => p.name), ['阿明', '阿強']);
  assert.equal(await a.resume(), false, 'nothing left to resume');

  f.host.leave();
  await settle();
  assert.equal(b.state.conn, 'error');
  assert.equal(b.state.connMessage, '房主解散咗房');
  assert.equal(f.host.state.mode, null);
  assert.equal(storage.has('bgb:host:1352'), false);
  b.leave();
});

test('app: voice narration speaks each cue once, waits out minMs, pauses and replays on resume', async () => {
  const spoken = [];
  const waits = [];
  let primed = 0;
  let cancelled = 0;
  const narrator = {
    prime() { primed++; },
    speak(text) { spoken.push(text); return new Promise((r) => waits.push(r)); },
    cancel() { cancelled++; },
  };
  const f = appFixture({ narrator });
  const app = f.host;
  app.local({ names: ['甲', '乙', '丙'] });
  assert.equal(app.state.room.narration.mode, 'voice');
  await app.lobby.selectGame('fake');
  const primedBefore = primed;
  assert.equal(app.lobby.start().ok, true);
  assert.ok(primed > primedBefore, 'start() primed the narrator inside the tap');
  for (const [pid, n] of [['p1', 1], ['p2', 2], ['p3', 3]]) app.act(pid, { type: 'pick', n });
  await settle();
  assert.deepEqual(spoken, ['揭曉']);
  f.clock.advance(10_000);
  assert.equal(app._room.session.state.phase, 'reveal', 'a speaking narrator holds the cue open');

  assert.equal(app.hostCtl.pause(), true);
  assert.equal(cancelled, 1, 'pausing cuts the speech');
  waits[0]();                                                // the cancelled speak() resolves late; it must be ignored
  await settle();
  f.clock.advance(10_000);
  assert.equal(app._room.session.state.phase, 'reveal');
  assert.equal(app.hostCtl.resume(), true);
  assert.deepEqual(spoken, ['揭曉', '揭曉'], 'resume says the line again');
  waits[1]();                                                // speech ended; the cue still lasts its minMs (1500)
  await settle();
  f.clock.advance(1499);
  assert.equal(app._room.session.state.phase, 'reveal');
  f.clock.advance(1);
  assert.equal(app._room.session.state.phase, 'done');
  assert.equal(app.state.room.phase, 'results');

  // read mode: the host taps 下一步
  assert.equal(app.results.again().ok, true);
  assert.equal(app.narration.setMode('read'), true);
  for (const [pid, n] of [['p1', 1], ['p2', 2], ['p3', 3]]) app.act(pid, { type: 'pick', n });
  await settle();
  assert.equal(app.state.cue.id, 'reveal:1');
  assert.equal(spoken.length, 2, 'read mode does not speak');
  f.clock.advance(60_000);
  assert.equal(app.state.room.phase, 'playing');
  assert.equal(app.hostCtl.next(), true);
  assert.equal(app.state.room.phase, 'results');
});

test('app: local mode runs a whole game on one device, no network', async () => {
  const f = appFixture();
  const app = f.host;
  const changes = [];
  app.on('change', (s) => changes.push(s.room.phase));
  app.local({ names: ['甲', '乙', '丙'] });
  await settle();
  assert.equal(app.state.mode, 'local');
  assert.equal(app.state.code, null);
  assert.equal(app.state.conn, 'online');
  assert.deepEqual(app.state.mySeats, ['p1', 'p2', 'p3']);
  assert.equal(app.state.room.players.every((p) => p.deviceId === app.state.deviceId), true);
  assert.equal(app.lobby.addSeat('丁').ok, true);
  assert.deepEqual(app.state.mySeats.length, 4);
  assert.equal(app.lobby.removeSeat('p4').ok, true);
  assert.equal(app.lobby.removeSeat('p1').ok, false, 'the host seat stays');
  await app.lobby.selectGame('fake');
  assert.equal(app.lobby.start().ok, true);
  assert.deepEqual(Object.keys(app.state.views), ['p1', 'p2', 'p3'], 'every seat on this device has its own view');
  assert.deepEqual(app.state.focus.pids, ['p1', 'p2', 'p3']);
  app.setActiveSeat('p2');
  assert.equal(app.state.activeSeat, 'p2');
  app.setActiveSeat('nobody');
  assert.equal(app.state.activeSeat, 'p2');
  app.act('p1', { type: 'pick', n: 1 });
  assert.deepEqual(app.state.focus.pids, ['p2', 'p3']);
  app.act('p2', { type: 'pick', n: 1 });
  app.act('p3', { type: 'pick', n: 2 });
  f.clock.advance(1500);
  assert.equal(app.state.room.phase, 'results');
  assert.deepEqual(app.state.room.lastResult.winners, ['p3']);
  await settle();
  assert.ok(changes.includes('results'));
  assert.equal(app.hostCtl.autoAct('p1'), false);
});

test('app: ink — the sender sees strokes at once, others get them relayed, drawing games sync on join', async () => {
  const f = appFixture();
  const host = f.host;
  const code = await host.host({ names: ['阿明'] });
  const a = f.client();
  await a.join(code, { names: ['阿花'] });
  const b = f.client();
  await b.join(code, { names: ['阿強'] });
  await host.lobby.selectGame('fake');
  host.lobby.start();
  await settle();
  assert.equal(a.ink('p2', { stroke: 'x', pts: [[100, 100], [200, 200]] }), true);
  assert.equal(a.state.ink.strokes.length, 1, 'optimistic local copy');
  await settle();
  assert.equal(host.state.ink.strokes.length, 1);
  assert.deepEqual(host.state.ink.strokes[0].pts, [[100, 100], [200, 200]]);
  assert.equal(b.state.ink.strokes.length, 1);
  assert.equal(a.state.ink.strokes[0].pts.length, 2, 'not applied twice on the sender');
  host.results.toLobby();                                    // back in the lobby the old picture is gone on every screen
  await settle();
  assert.equal(a.state.ink.strokes.length, 0);
  assert.equal(host.state.ink.strokes.length, 0);
  host.lobby.start();
  a.ink('p2', { stroke: 'x', pts: [[100, 100], [200, 200]] });
  await settle();
  a.ink('p2', { stroke: 'x', pts: [[300, 300]], end: true });
  await settle();
  assert.equal(b.state.ink.strokes[0].pts.length, 3);
  assert.equal(b.state.ink.strokes[0].end, true);
  assert.equal(b.ink('p3', { stroke: 'y', pts: [[1, 1]] }), true, 'accepted locally, then undone by the host');
  await settle();
  assert.equal(b.state.ink.strokes.length, 1, 'the host corrected b\'s optimistic stroke');
  assert.equal(host.ink('p9', { stroke: 'z', pts: [[1, 1]] }), false);
});

test('app: resume — the host comes back from its snapshot under the same code, clients reattach by token', async () => {
  const storage = new Map();
  const f = appFixture({ storage, hostTimers: new FakeClock() });   // the old page's timers die with it
  const host = f.host;
  const code = await host.host({ names: ['阿明'] });
  const a = f.client();
  await a.join(code, { names: ['阿花'] });
  await host.lobby.selectGame('fake');
  host.lobby.start();
  f.clock.advance(5_000);
  host.act('p1', { type: 'pick', n: 2 });
  await settle();
  const deadline = host.state.views.p1.deadline;
  const secret = a.state.views.p2.secret;
  assert.ok(storage.has('bgb:host:1352'), 'snapshot written under bgb:host:<code>');
  assert.equal(JSON.parse(storage.get('bgb:resume')).mode, 'host');

  // the host's page is reloaded: a fresh app over the same storage, 30 s later
  f.loop.hosts.get(code).close();
  await settle();                                            // the dying page's last save happens now, not 30 s later
  f.clock.advance(30_000);
  assert.equal(a.state.conn, 'reconnecting');
  const host2 = createApp({ ...f.common, storage });
  assert.equal(await host2.resume(), true);
  assert.equal(host2.state.mode, 'host');
  assert.equal(host2.state.code, code);
  assert.equal(host2.state.room.phase, 'playing');
  assert.equal(host2.state.room.paused, true, 'restored paused; the host taps 繼續');
  assert.equal(host2.state.deviceId, host.state.deviceId);
  assert.deepEqual(host2.state.mySeats, ['p1']);
  assert.equal(host2.state.views.p1.myPick, 2);
  assert.equal(host2.act('p1', { type: 'pick', n: 1 }), false);

  f.loop.clients[0].redial();                                // the client's transport finds the new host
  await settle();
  assert.equal(a.state.conn, 'online');
  assert.deepEqual(a.state.mySeats, ['p2']);
  assert.equal(a.state.views.p2.secret, secret);
  assert.equal(a.state.room.paused, true);

  assert.equal(host2.hostCtl.resume(), true);
  await settle();
  assert.equal(host2.state.views.p1.deadline, deadline + 30_000);
  assert.equal(a.state.room.paused, false);
  assert.equal(a.state.views.p2.deadline, deadline + 30_000);

  // nothing to resume once you leave on purpose
  host2.leave();
  assert.equal(storage.has('bgb:host:1352'), false);
  assert.equal(await createApp({ ...f.common, storage }).resume(), false);
});

test('app: a rejected hello surfaces the reason and join() throws', async () => {
  const f = appFixture();
  const code = await f.host.host({ names: ['阿明'] });
  const a = f.client();
  const quiet = console.error;
  console.error = () => {};                                  // join() logs the failures it also throws
  try {
    await assert.rejects(() => a.join(code, { names: ['阿明'] }), /已經有人叫「阿明」/);
    assert.equal(a.state.conn, 'error');
    assert.match(a.state.connMessage, /已經有人叫/);
    await assert.rejects(() => a.join('9999', { names: ['x'] }), /房間號碼/);
    await assert.rejects(() => a.join(code, { names: [] }), /填返個名/);
    const c = f.client();
    await assert.rejects(() => c.join('1111', { names: ['x'] }), /no such room/);
    assert.equal(c.state.conn, 'error');
  } finally { console.error = quiet; }
});

// ============================================================
// registry, util
// ============================================================

test('registry: lists all ten games with inline meta; load() is lazy', async () => {
  assert.deepEqual(GAMES.map((g) => g.id), ['cheese-thief', 'onuw', 'werewolf', 'avalon', 'undercover', 'spyfall',
    'fake-artist', 'draw-guess', '9upper', 'custom']);
  for (const g of GAMES) {
    const m = g.meta;
    assert.ok(m.name && m.emoji && m.blurb, `${g.id}: name/emoji/blurb`);
    assert.ok(Array.isArray(m.players) && m.players[0] <= m.players[1], `${g.id}: players`);
    assert.ok(Array.isArray(m.minutes) && m.minutes[0] <= m.minutes[1], `${g.id}: minutes`);
    assert.ok(m.batch === 1 || m.batch === 2, `${g.id}: batch`);
    assert.equal(typeof g.load, 'function');
  }
  assert.deepEqual(GAMES.filter((g) => g.meta.batch === 2).map((g) => g.id), ['fake-artist', 'draw-guess', '9upper']);
});

test('util.makeStore: Web Storage, Map and nothing all behave the same and never throw', () => {
  for (const backend of [fakeStorage(), new Map(), null]) {
    const s = makeStore(backend);
    assert.equal(s.get('k', 'dflt'), 'dflt');
    s.set('k', { a: [1, 2] });
    assert.deepEqual(s.get('k'), { a: [1, 2] });
    s.del('k');
    assert.equal(s.get('k'), null);
  }
  const throwing = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } };
  const s = makeStore(throwing);
  s.set('k', 1);
  s.del('k');
  assert.equal(s.get('k', 7), 7);
});

// ============================================================
// net hardening
// ============================================================

test('net: a stale channel closing late does not evict the phone\'s newer channel', async () => {
  class Em {
    h = new Map();
    on(ev, fn) { (this.h.get(ev) ?? this.h.set(ev, []).get(ev)).push(fn); return this; }
    off(ev, fn) { this.h.set(ev, (this.h.get(ev) ?? []).filter((f) => f !== fn)); return this; }
    emit(ev, ...a) { for (const fn of [...(this.h.get(ev) ?? [])]) fn(...a); }
  }
  const peers = [];
  globalThis.Peer = class FakePeer extends Em {
    constructor(id) { super(); this.id = id; this.destroyed = false; peers.push(this); queueMicrotask(() => this.emit('open', id)); }
    destroy() { this.destroyed = true; }
    reconnect() {}
  };
  const fakeConn = (peer) => {
    const c = new Em();
    Object.assign(c, { peer, open: true, sent: [], closed: false });
    c.send = (m) => c.sent.push(m);
    c.close = () => { c.closed = true; c.emit('close'); };
    return c;
  };
  const { HostNet } = await import('../js/core/net.js?v=1');
  const net = new HostNet();
  try {
    await net.open();
    const events = [];
    net.on('peer-open', (p) => events.push(`open:${p}`));
    net.on('peer-close', (p) => events.push(`close:${p}`));
    net.on('message', (p, m) => events.push(`msg:${p}:${m}`));
    const peer = peers[0];

    const c1 = fakeConn('peerA');
    peer.emit('connection', c1); c1.emit('open');
    const c2 = fakeConn('peerA');                            // the phone re-dialled before the host noticed
    peer.emit('connection', c2); c2.emit('open');
    assert.equal(c1.closed, true, 'the superseded channel is closed');
    c1.emit('close');                                        // …and its late close event arrives
    c1.emit('data', 'old');
    c2.emit('data', 'new');
    assert.deepEqual(events, ['open:peerA', 'open:peerA', 'msg:peerA:new'], 'no peer-close, no stale message');
    assert.equal(net.sendTo('peerA', { x: 1 }), true);
    assert.equal(c2.sent.length, 1);
    assert.equal(c1.sent.length, 0);
    c2.emit('close');
    assert.deepEqual(events.at(-1), 'close:peerA', 'the current channel closing is a real disconnect');
    assert.equal(net.sendTo('peerA', { x: 2 }), false);
  } finally {
    net.close();
    delete globalThis.Peer;
  }
});
