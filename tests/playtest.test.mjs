// tools/playtest/pt.mjs — the console's pure parts: the --shared referee (DESIGN §7.1 "For the console"), the fake
// text-to-speech every phone gets, the per-phone lock (T4) and the table talk lines. The browser side is covered by
// `node tools/playtest/pt.mjs selftest` and a live --shared run.

import { test, assert } from './lib.mjs';
import { createNarrator, estimateMs } from '../js/core/narrator.js';
import { focusSig } from '../js/ui/logic.js';
import { decide, gateTarget, otherName, showKey, stepSig, makeLock, chatLine, fakeTTS, WAIT_MAX_S } from '../tools/playtest/pt.mjs';

// ---------- a 4-seat one-phone table ----------
const PLAYERS = [
  { id: 'p1', name: '阿聰', spectator: false },
  { id: 'p2', name: '阿明', spectator: false },
  { id: 'p3', name: '小美', spectator: false },
  { id: 'p4', name: '大熊', spectator: false },
];
const ALL = PLAYERS.map((p) => p.id);
/** A page snapshot as REF_JS reads it: playing, by day, phone in the middle, nothing on it. */
const snap = (over = {}) => ({
  mode: 'local', phase: 'playing', activeSeat: null, mySeats: ALL, night: false, narration: 'voice',
  gate: null, focus: null, header: '誰是臥底 第 1 輪', vstep: '', players: PLAYERS, ...over,
});
const as = (r, me, extra = {}) => decide(r, { me, host: 'p1', ...extra });
const levels = (r, extra = {}) => Object.fromEntries(ALL.map((pid) => [pid, as(r, pid, extra).level]));

test('playtest referee: off the one-phone table (no local room yet) nothing is refereed', () => {
  assert.equal(decide({ mode: null }, { me: 'p2' }).level, 'full');
  assert.equal(decide(null, { me: 'p2' }).level, 'full');
  assert.equal(decide({ mode: 'host' }, { me: 'p2' }).level, 'full');
});

test('playtest referee: the lobby and the results lie face up in the middle for everybody', () => {
  for (const phase of ['lobby', 'results']) {
    const r = snap({ phase, activeSeat: 'p3' });
    assert.deepEqual(levels(r), { p1: 'table', p2: 'table', p3: 'table', p4: 'table' }, phase);
  }
});

test('playtest referee (T1): the phone in the middle by day is face up — everybody reads it and may tap', () => {
  const r = snap();
  assert.deepEqual(levels(r), { p1: 'table', p2: 'table', p3: 'table', p4: 'table' });
  assert.match(as(r, 'p4').why, /枱中間/);
});

test('playtest referee: a seat on screen is private to its holder; the others are told who holds it', () => {
  const r = snap({ activeSeat: 'p2', focus: { pids: ['p2'], anonymous: null, open: false, step: 'vote:1' } });
  assert.deepEqual(levels(r), { p1: 'none', p2: 'full', p3: 'none', p4: 'none' });
  assert.match(as(r, 'p3').why, /阿明 拎緊部手機/);
});

test('playtest referee (T1, #4): a public one-person step (focus.open) is watched by everyone, touched by its seat only', () => {
  const r = snap({ activeSeat: 'p3', focus: { pids: ['p3'], anonymous: null, open: true, step: 'stroke' } });
  assert.deepEqual(levels(r), { p1: 'read', p2: 'read', p3: 'full', p4: 'read' });
  // the same seat in a private step is private again
  const priv = snap({ activeSeat: 'p3', focus: { pids: ['p3'], anonymous: null, open: false, step: 'vote' } });
  assert.equal(as(priv, 'p1').level, 'none');
});

test('playtest referee: a private / switch gate — everyone sees the card only, only the named seat taps it', () => {
  for (const kind of ['private', 'switch']) {
    const r = snap({ gate: { kind, title: '交俾 阿明' }, focus: { pids: ALL, anonymous: null, open: false, step: 'deal' } });
    const named = as(r, 'p2');
    assert.equal(named.level, 'gate');
    assert.equal(named.tap, 'all', kind);
    assert.equal(named.behind, false, `${kind}: nothing behind the card can be read`);
    assert.equal(as(r, 'p3').tap, 'none', `${kind}: a bystander cannot tap`);
    assert.equal(as(r, 'p3').level, 'gate', `${kind}: …but sees the card on the table`);
    assert.equal(as(r, 'p3').target, 'p2');
  }
});

test('playtest referee (T5): the host may reach only the 「X 唔喺度？」 row of somebody else\'s gate', () => {
  const r = snap({ gate: { kind: 'private', title: '交俾 小美' }, focus: { pids: ['p3'], anonymous: null, open: false, step: 'vote' } });
  const host = as(r, 'p1');
  assert.equal(host.tap, 'escape');
  assert.equal(host.who, '小美');
  assert.match(host.why, /小美 唔喺度？/);
  assert.equal(as(r, 'p2').tap, 'none', 'not the host: no escape');
  // the host's own gate: the host taps it like anybody named
  assert.equal(as(snap({ gate: { kind: 'private', title: '交俾 阿聰' } }), 'p1').tap, 'all');
});

test('playtest referee: a public gate (open step) keeps the screen behind readable; the table card is anyone\'s tap', () => {
  const pub = snap({ gate: { kind: 'public', title: '輪到 小美 · 畫一筆' }, focus: { pids: ['p3'], anonymous: null, open: true, step: 'stroke' } });
  assert.equal(as(pub, 'p3').tap, 'all');
  assert.equal(as(pub, 'p2').tap, 'none');
  assert.equal(as(pub, 'p2').behind, true);
  assert.equal(as(pub, 'p1').tap, 'escape');
  const card = snap({ gate: { kind: 'table', title: '天光喇' } });
  for (const pid of ALL) {
    const g = as(card, pid);
    assert.equal(g.level, 'gate');
    assert.equal(g.tap, 'all', `${pid} may tap the table card`);
    assert.equal(g.behind, true);
  }
});

test('playtest referee: an eyes-closed gate is seen only by the seats the step calls — a decoy by nobody', () => {
  const r = snap({ night: true, gate: { kind: 'anon', title: '狼人請拎起部手機' }, focus: { pids: ['p2', 'p4'], anonymous: '狼人請拎起部手機' } });
  assert.deepEqual(levels(r), { p1: 'none', p2: 'gate', p3: 'none', p4: 'gate' });
  assert.equal(as(r, 'p4').tap, 'all', 'either co-waker may take the phone (U2)');
  // what the sleepers get says nothing about the step: no role call, no name (the werewolf playtest's 「交俾 阿珍」 slip)
  const sleeper = as(r, 'p1');
  assert.ok(sleeper.dark);
  assert.doesNotMatch(sleeper.why, /狼人|阿明|大熊/);
  // a decoy (the role is not on this phone): the same for everyone, and nobody may touch it
  const decoy = snap({ night: true, gate: { kind: 'anon', title: '預言家請拎起部手機' }, focus: { pids: [], anonymous: '預言家請拎起部手機' } });
  assert.deepEqual(levels(decoy), { p1: 'none', p2: 'none', p3: 'none', p4: 'none' });
  assert.equal(as(decoy, 'p1').why, sleeper.why, 'a decoy and a real step read the same to a sleeper');
});

test('playtest referee (U2): every seat a secret step calls shares the combined night screen; the rest sleep', () => {
  const r = snap({ night: true, activeSeat: 'p2', focus: { pids: ['p2', 'p4'], anonymous: '狼人請揀人' } });
  assert.deepEqual(levels(r), { p1: 'none', p2: 'full', p3: 'none', p4: 'full' });
  // the engine drops p2 (done): p2 closes their eyes, p4 stays
  const after = snap({ night: true, activeSeat: 'p4', focus: { pids: ['p4'], anonymous: '狼人請揀人' } });
  assert.deepEqual(levels(after), { p1: 'none', p2: 'none', p3: 'none', p4: 'full' });
  // at night with nobody called, the phone is under the dim: nobody looks
  assert.deepEqual(levels(snap({ night: true })), { p1: 'none', p2: 'none', p3: 'none', p4: 'none' });
  // a called seat that is not yet on screen does not see somebody else's screen
  assert.equal(as(snap({ night: true, activeSeat: 'p3', focus: { pids: ['p2'], anonymous: '預言家' } }), 'p2').level, 'none');
  // a NAMED step at night is a walk, not a combined screen: the next seat in it does not see the holder's screen
  const walk = snap({ night: true, activeSeat: 'p2', focus: { pids: ['p2', 'p4'], anonymous: null, open: false } });
  assert.deepEqual(levels(walk), { p1: 'none', p2: 'full', p3: 'none', p4: 'none' });
});

test('playtest referee: a named gate at night carries no name — only the seats the step calls may look', () => {
  const r = snap({ night: true, gate: { kind: 'private', title: '叫到嘅人請拎起部手機' }, focus: { pids: ['p3'], anonymous: null, open: false } });
  assert.deepEqual(levels(r), { p1: 'none', p2: 'none', p3: 'gate', p4: 'none' });
  assert.equal(as(r, 'p1').tap, undefined, 'no escape at night');
});

test('playtest referee: 靜音 keeps eyes open, so the night message does not say 閉眼', () => {
  const r = snap({ night: true, narration: 'silent' });
  assert.doesNotMatch(as(r, 'p1').why, /閉緊眼/);
  assert.match(as(snap({ night: true }), 'p1').why, /閉緊眼/);
});

test('playtest referee (show): a shown screen is read-only for the others and ends the moment the screen leaves its step', () => {
  const held = snap({ activeSeat: 'p2', focus: null, header: '間諜 第 1 輪' });
  const key = showKey(held);
  assert.equal(as(held, 'p3', { shown: key }).level, 'read');
  assert.equal(as(held, 'p3', { shown: key }).keepShow, true);
  assert.equal(as(held, 'p2', { shown: key }).keepShow, true, 'the holder keeps showing while nothing changed');
  // a countdown in the header is not a new step
  assert.equal(showKey({ ...held, header: '間諜 第 1 輪 · 仲有 42 秒' }), showKey({ ...held, header: '間諜 第 1 輪 · 仲有 41 秒' }));
  // the screen turns private (a new step for the same seat), a gate comes up, night falls, the phone moves on
  const leaves = [
    { focus: { pids: ['p2'], anonymous: null, open: false, step: 'vote' } },
    { header: '間諜 投票' },
    { vstep: JSON.stringify(['vote', null, null, 1]) },
    { activeSeat: 'p4' },
    { night: true },
    { gate: { kind: 'private', title: '交俾 小美' } },
  ];
  for (const change of leaves) {
    const now = { ...held, ...change };
    assert.notEqual(showKey(now), key, JSON.stringify(change));
    for (const pid of ['p1', 'p2', 'p3']) assert.ok(!as(now, pid, { shown: key }).keepShow, `${pid} after ${JSON.stringify(change)}`);
    assert.notEqual(as(now, 'p3', { shown: key }).level, 'read', `no longer shown after ${JSON.stringify(change)}`);
  }
});

test('playtest referee: gate titles name their seat exactly (longest name wins, no prefix mix-ups)', () => {
  const ps = [...PLAYERS, { id: 'p5', name: '阿明仔' }];
  assert.equal(gateTarget('交俾 阿明', ps), 'p2');
  assert.equal(gateTarget('交俾 阿明仔', ps), 'p5');
  assert.equal(gateTarget('輪到 小美 · 第 1 輪投票', ps), 'p3');
  assert.equal(gateTarget('輪到 小美', ps), 'p3');
  assert.equal(gateTarget('天光喇', ps), null);
  assert.equal(gateTarget('叫到嘅人請拎起部手機', ps), null);
});

test('playtest referee: on a name list each person picks only their own name', () => {
  const ps = [...PLAYERS, { id: 'p5', name: '阿明仔' }];
  assert.equal(otherName('阿明', 'p2', ps), null);
  assert.equal(otherName('阿明 輪到 （而家）', 'p2', ps), null);
  assert.equal(otherName('小美', 'p2', ps), '小美');
  assert.equal(otherName('阿明仔', 'p2', ps), '阿明仔', '阿明 is not 阿明仔');
  assert.equal(otherName('阿明仔', 'p5', ps), null);
  assert.equal(otherName('取消', 'p2', ps), null);
});

test('playtest: stepSig matches the app\'s focus signature rules (sorted pids, anonymous, step, open)', () => {
  assert.equal(stepSig(null), '');
  assert.equal(stepSig({ pids: ['p3', 'p1'] }), stepSig({ pids: ['p1', 'p3'] }));
  assert.notEqual(stepSig({ pids: ['p1'], step: 'pick' }), stepSig({ pids: ['p1'], step: 'vote' }));
  assert.notEqual(stepSig({ pids: ['p1'], open: true }), stepSig({ pids: ['p1'] }));
  assert.equal(stepSig({ pids: ['p1'], together: 3 }), stepSig({ pids: ['p1'], together: 4 }), 'together never counts');
  // the same string as the shell's own signature, so `show` ends exactly when the shell sees a new step
  for (const f of [null, { pids: [] }, { pids: ['p3', 'p1'], step: 'vote:2', label: '第 2 輪投票' }, { pids: ['p2'], open: true, hold: true },
    { pids: ['p4', 'p2'], anonymous: '狼人請拎起部手機' }, { pids: ['p1'], step: 7 }]) {
    assert.equal(stepSig(f), focusSig(f), JSON.stringify(f));
  }
});

test('playtest (T4): the per-phone lock runs ops one at a time, in order, and survives a failing op', async () => {
  const lock = makeLock();
  const log = [];
  const op = (name, ms, fail = false) => lock.run(async () => {
    log.push(`${name}<`);
    await new Promise((r) => setTimeout(r, ms));
    log.push(`>${name}`);
    if (fail) throw new Error(name);
    return name;
  });
  const results = await Promise.allSettled([op('a', 30), op('b', 5, true), op('c', 1)]);
  assert.deepEqual(log, ['a<', '>a', 'b<', '>b', 'c<', '>c'], 'no interleaving');
  assert.deepEqual(results.map((x) => x.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(await op('d', 1), 'd', 'still usable after a failure');
});

test('playtest: hear lines — the narrator reads 「🔊 旁白：…」, people speak in their own name', () => {
  const t = '2026-10-04T12:34:56.789Z';
  assert.equal(chatLine({ t, seat: 'p1', name: '🔊 旁白', text: '各位請閉眼', narr: true }), '[12:34:56Z] 🔊 旁白：各位請閉眼');
  assert.equal(chatLine({ t, seat: 'p2', name: '🔊 旁白', text: '試聽', narr: true, from: '阿明' }), '[12:34:56Z] 🔊 旁白（阿明部機）：試聽');
  assert.equal(chatLine({ t, seat: 'p2', name: '阿明', text: '我講完' }), '[12:34:56Z] 阿明(p2): 我講完');
  assert.equal(chatLine({ t, seat: 'p1', name: '阿聰', note: true, text: '📱 阿聰（房主）㩒咗「小美 唔喺度？」' }), '[12:34:56Z] 📱 阿聰（房主）㩒咗「小美 唔喺度？」');
  assert.equal(WAIT_MAX_S, 90, 'wait stays under an agent shell call (120 s)');
});

// ---------- the fake text-to-speech, driven by the app's own narrator ----------
function withFakeTTS(fn, scale = 0.02) {
  const heard = [];
  const win = { setTimeout, clearTimeout, __ptNarr: (payload) => heard.push(JSON.parse(payload).text) };
  fakeTTS(win, { scale });
  const keep = { s: Object.getOwnPropertyDescriptor(globalThis, 'speechSynthesis'), u: Object.getOwnPropertyDescriptor(globalThis, 'SpeechSynthesisUtterance') };
  Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, get: () => win.speechSynthesis });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: win.SpeechSynthesisUtterance });
  const restore = () => {
    for (const [k, d] of [['speechSynthesis', keep.s], ['SpeechSynthesisUtterance', keep.u]]) {
      if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
    }
  };
  return Promise.resolve().then(() => fn({ win, heard })).finally(restore);
}

test('playtest fake TTS: the narrator speaks through it — onstart, a clean end, and the line reaches the table', () => withFakeTTS(async ({ win, heard }) => {
  const n = createNarrator();
  assert.equal(n.supported, true);
  assert.equal(n.hasCantonese(), true, 'a zh-HK voice is offered');
  assert.equal(n.info().voice.lang, 'zh-HK');
  let started = 0;
  const how = await n.speak('各位請閉眼，芝士大盜請拎起部手機。', { onstart: () => { started++; } });
  assert.equal(how, 'end', 'ends on its own, not on the narrator\'s timeout');
  assert.equal(started, 1);
  assert.deepEqual(heard, ['各位請閉眼，芝士大盜請拎起部手機。']);
  assert.equal(win.speechSynthesis.speaking, false);
}));

test('playtest fake TTS: speaking takes a length-based time inside the narrator\'s own fallback', () => withFakeTTS(async ({ win }) => {
  for (const line of ['好', '各位請閉眼。', '天光喇，大家打開眼。昨晚冇人死，請大家開始討論，講完就投票。']) {
    const u = new win.SpeechSynthesisUtterance(line);
    const t0 = Date.now();
    const ended = new Promise((r) => { u.onend = (e) => r(e); });
    win.speechSynthesis.speak(u);
    const e = await ended;
    const unscaled = e.elapsedTime / 0.02;
    assert.ok(unscaled >= 300, `${line}: at least 0.3 s`);
    assert.ok(unscaled < estimateMs(line), `${line}: ${unscaled} ms < the narrator's ${estimateMs(line)} ms fallback`);
    assert.ok(Date.now() - t0 >= e.elapsedTime - 5);
  }
}, 0.02));

test('playtest fake TTS: lines queue in order, cancel settles every pending one, silent lines are not heard', () => withFakeTTS(async ({ win, heard }) => {
  const s = win.speechSynthesis;
  const events = [];
  const say = (text, volume = 1) => {
    const u = new win.SpeechSynthesisUtterance(text);
    u.volume = volume;
    u.addEventListener('start', () => events.push(`start ${text}`));
    u.onend = () => events.push(`end ${text}`);
    u.onerror = (e) => events.push(`error ${text} ${e.error}`);
    s.speak(u);
    return u;
  };
  say('一');
  say('', 1);
  say('靜', 0);
  say('二');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(events.filter((e) => e.startsWith('end')), ['end 一', 'end ', 'end 靜', 'end 二'], 'in order');
  assert.deepEqual(heard, ['一', '二'], 'empty and volume-0 lines are not heard (the narrator\'s prime() is silent)');
  events.length = 0;
  say('三');
  say('四');
  s.cancel();
  assert.deepEqual(events, ['error 三 canceled', 'error 四 canceled']);
  assert.equal(s.speaking, false);
  assert.equal(s.pending, false);
  assert.throws(() => s.speak({ text: 'x' }), TypeError);
  // the narrator's cancel() settles its promise as 'cancel'
  const n = createNarrator();
  const p = n.speak('長長長長長長長長長長長長長長長長長長長長');
  n.cancel();
  assert.equal(await p, 'cancel');
}));

test('playtest fake TTS: it installs once, and tells voice lists that voices are ready', async () => {
  const win = { setTimeout, clearTimeout };
  fakeTTS(win);
  const first = win.speechSynthesis;
  fakeTTS(win);
  assert.equal(win.speechSynthesis, first, 'a second run changes nothing');
  let changed = 0;
  win.speechSynthesis.addEventListener('voiceschanged', () => { changed++; });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(changed, 1);
  assert.deepEqual(win.speechSynthesis.getVoices().map((v) => v.lang), ['zh-HK']);
});
