// js/ui/logic.js — the pure rules behind the picker, role cards, scoreboard and clocks.

import { test, assert } from './lib.mjs';
import {
  fits, teamStyle, rankRows, fmtDuration, fmtClock,
  timerLeftMs, timerCue, clampTimerSec, TIMER_PRESETS, inAppBrowser, roleFor, roleParts,
  headingOf, resultSections, sectionsOpen, turnOrderMatters, TURN_ORDER_GAMES, pictureFileName,
  savedOrderDiffers, savedGroupNames, presetMatches,
  scoreboardMode, resultHero, confettiSet, turnBadge, skipNeedsConfirm, SKIP_CONFIRM, recentFolds,
} from '../js/ui/logic.js';
import { paintStrokes, PAPER } from '../js/ui/ink.js';

test('ui: picker greys out games that do not fit the head-count, and says why', () => {
  const meta = { players: [6, 12] };
  assert.deepEqual(fits(meta, 6, 'host'), { ok: true, reason: '' });
  assert.deepEqual(fits(meta, 12, 'host'), { ok: true, reason: '' });

  const few = fits(meta, 4, 'host');
  assert.equal(few.ok, false);
  assert.match(few.reason, /要 6 人以上/);
  assert.match(few.reason, /而家 4 人/);

  const many = fits(meta, 13, 'host');
  assert.equal(many.ok, false);
  assert.match(many.reason, /最多 12 人/);

  assert.match(fits({ players: [5, 5] }, 4, 'host').reason, /^要 5 人（/, 'a fixed head-count reads 要 5 人, not 5 人以上');
  assert.equal(fits({}, 3, 'host').ok, true, 'no player range = no restriction');
});

test('ui: one-phone mode greys out games that need several phones', () => {
  const none = { players: [3, 8], singleDevice: 'none' };
  assert.equal(fits(none, 5, 'local').ok, false);
  assert.equal(fits(none, 5, 'host').ok, true);
  assert.equal(fits({ players: [3, 8], singleDevice: 'partial' }, 5, 'local').ok, true);
  assert.equal(fits({ players: [3, 8], singleDevice: 'full' }, 5, 'local').ok, true);
});

test('ui: team colours — known teams, explicit colour, colour-as-team, unknown', () => {
  assert.deepEqual(teamStyle({ team: 'wolf' }), { color: '#e4573d', label: '壞人陣營' });
  assert.deepEqual(teamStyle({ team: 'Village' }), { color: '#4ec97a', label: '好人陣營' }, 'case-insensitive');
  assert.equal(teamStyle({ team: 'solo' }).label, '第三陣營');
  assert.deepEqual(teamStyle({ team: 'wolf', color: '#123456', teamLabel: '狼群' }), { color: '#123456', label: '狼群' }, 'role overrides win');
  assert.deepEqual(teamStyle({ team: '#abcdef' }), { color: '#abcdef', label: null }, 'a colour used as the team has no label');
  assert.deepEqual(teamStyle({ team: 'mystery' }), { color: null, label: null });
  assert.deepEqual(teamStyle(null), { color: null, label: null });
});

test('ui: scoreboard ranks by points, then wins, then fewer games; ties share a rank', () => {
  const players = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, name: id, seat: i }));
  const scoreboard = {
    a: { played: 3, wins: 1, points: 4 },
    b: { played: 3, wins: 2, points: 4 },     // same points, more wins → above a
    c: { played: 3, wins: 1, points: 4 },     // ties a exactly
    d: { played: 2, wins: 0, points: 0 },
    // e has never played: missing record = zeros
  };
  const rows = rankRows(players, scoreboard);
  assert.deepEqual(rows.map((r) => r.pl.id), ['b', 'a', 'c', 'e', 'd'], 'e (0 played) ranks above d (2 played) on equal points');
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 2, 4, 5], 'a and c share rank 2, next rank skips to 4');
  assert.equal(rankRows([], {}).length, 0);
  assert.equal(rankRows(players, undefined).length, 5);
});

test('ui: time formatting', () => {
  assert.equal(fmtDuration(45), '45 秒');
  assert.equal(fmtDuration(120), '2 分鐘');
  assert.equal(fmtDuration(90), '1 分 30 秒');

  assert.equal(fmtClock(65), '1:05');
  assert.equal(fmtClock(0.2), '0:01', 'ceil: the display reaches 0:00 only at zero');
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(-5), '0:00');
  assert.equal(fmtClock(NaN), '0:00');
  assert.equal(fmtClock(3600), '60:00');
});

test('ui: table timer — time left is frozen while paused, never negative, null without a timer', () => {
  assert.equal(timerLeftMs(null, 1000), null);
  assert.equal(timerLeftMs({ endsAt: 31_000, paused: false }, 1_000), 30_000);
  assert.equal(timerLeftMs({ endsAt: 31_000, paused: false }, 40_000), 0);
  assert.equal(timerLeftMs({ endsAt: 31_000, paused: true, remainingMs: 12_345 }, 99_999), 12_345, 'a paused clock ignores the wall clock');
  assert.equal(timerLeftMs({ paused: false, remainingMs: 5_000 }, 0), 5_000, 'no endsAt: fall back to remainingMs');
  assert.equal(timerLeftMs({ endsAt: 31_000, paused: false, done: true }, 20_000), 0, 'a timer that rang reads 0 even if this clock lags');
  assert.deepEqual(TIMER_PRESETS.map((p) => p.sec), [30, 60, 180, 300]);
  assert.equal(clampTimerSec(3), 10);
  assert.equal(clampTimerSec(99_999), 3600);
  assert.equal(clampTimerSec('90'), 90);
});

test('ui: table timer — sounds fire on crossings only (warn at 10 s, ticks in the last 5 s, alarm at zero)', () => {
  assert.equal(timerCue(null, 9_000), null, 'the first reading is history');
  assert.equal(timerCue(10_200, 9_900), 'warn');
  assert.equal(timerCue(9_900, 9_700), null, 'no second warning in the same second');
  assert.equal(timerCue(5_100, 4_900), 'tick');
  assert.equal(timerCue(4_900, 4_700), null, 'one tick per second');
  assert.equal(timerCue(300, 0), 'alarm');
  assert.equal(timerCue(0, 0), null, 'zero stays silent once it has rung');
  assert.equal(timerCue(5_000, 35_000), null, '+30 秒 jumps up silently');
  assert.equal(timerCue(12_000, 12_000), null, 'a paused clock is silent');
  assert.equal(timerCue(60_000, 0), 'alarm', 'a long gap (throttled tab) still rings once at zero');
});

test('ui: in-app browsers are recognised, Safari and Chrome are not', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  assert.equal(inAppBrowser(`${iphone} Mobile/15E148 Safari Line/14.9.0`), 'LINE');
  assert.equal(inAppBrowser(`${iphone} Mobile/15E148 Instagram 330.0.3.12.235`), 'Instagram');
  assert.equal(inAppBrowser(`${iphone} Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]`), 'Facebook');
  assert.equal(inAppBrowser(`${iphone} Mobile/15E148 MicroMessenger/8.0.49`), 'WeChat');
  assert.equal(inAppBrowser(`${iphone} Version/17.5 Mobile/15E148 Safari/604.1`), null);
  assert.equal(inAppBrowser(`${iphone} CriOS/126.0 Mobile/15E148 Safari/604.1`), null);
  assert.equal(inAppBrowser(undefined), null);
});

test('ui: 💡 sheet finds the seat own role from the fields games use, and never invents one', () => {
  const rules = { roles: [
    { id: 'thief', name: '芝士大盜', emoji: '🧀', text: '做乜：偷芝士。點贏：唔喺最高票。' },
    { id: 'follower', name: '共犯', emoji: '🤝', text: '做乜：幫大盜。點贏：同大盜一齊贏。' },
    { id: 'spy', name: '間諜', emoji: '🕵️', text: '估地點' },
  ] };
  assert.equal(roleFor({ role: 'spy' }, rules).name, '間諜');
  assert.equal(roleFor({ mine: { role: 'thief' } }, rules).name, '芝士大盜');
  assert.equal(roleFor({ my: { role: 'sleepyhead', follower: true } }, rules).id, 'follower', 'a recruited sleepyhead is a 共犯');
  assert.equal(roleFor({ roleId: 'spy', role: 'thief' }, rules).id, 'spy', 'an explicit roleId wins');
  const custom = roleFor({ role: { id: 'r3', name: '偵探', emoji: '🔎', desc: '每晚查一個人' } }, rules);
  assert.deepEqual([custom.name, custom.emoji, custom.text], ['偵探', '🔎', '每晚查一個人'], 'a custom deck role is shown as dealt');
  assert.equal(roleFor({ me: { word: '蘋果' } }, rules), null, 'undercover keeps the role secret even from its holder');
  assert.equal(roleFor({ role: 'nobody' }, rules), null, 'an unknown id string is not a role card');
  assert.equal(roleFor(null, rules), null);

  assert.deepEqual(roleParts('做乜：偷芝士。點贏：唔喺最高票。'), { what: '偷芝士。', win: '唔喺最高票。' });
  assert.deepEqual(roleParts('估地點'), { what: '估地點', win: '' });
  assert.deepEqual(roleParts('做乜：留意。'), { what: '留意。', win: '' });
});

test('ui: results — { h } and 「── 標題 ──」 lines start sections; a long recap starts folded except its first part', () => {
  assert.equal(headingOf({ h: ' 夜晚記錄 ' }), '夜晚記錄');
  assert.equal(headingOf('── 最後張牌 ──'), '最後張牌', 'the ONUW style, dashes trimmed both ends');
  assert.equal(headingOf('──  夜晚'), '夜晚');
  assert.equal(headingOf('阿明 ── 投咗阿花'), null, 'a dash in the middle is just text');
  assert.equal(headingOf({ h: '' }), null);
  assert.equal(headingOf('普通一句'), null);

  const lines = ['狼人輸咗', '因為阿明投中', '── 最後張牌 ──', '阿明：狼人', { text: '阿花：預言家' }, { h: '冇嘢' }, { h: '夜晚記錄' }, '強盜換咗牌', '', 42];
  const secs = resultSections(lines);
  assert.deepEqual(secs, [
    { title: null, lines: ['狼人輸咗', '因為阿明投中'] },
    { title: '最後張牌', lines: ['阿明：狼人', '阿花：預言家'] },
    { title: '夜晚記錄', lines: ['強盜換咗牌', '42'] },
  ], 'lead lines untitled; an empty heading is dropped; { text } and odd values become text');
  assert.deepEqual(resultSections(['a', 'b']), [{ title: null, lines: ['a', 'b'] }], 'no headings: one plain list, as before');
  assert.deepEqual(resultSections(null), []);
  assert.deepEqual(resultSections([{ h: 'A' }, 'x']), [{ title: 'A', lines: ['x'] }], 'a recap may start with a heading');

  assert.deepEqual(sectionsOpen(secs), [true, true, true], 'short: everything open');
  const long = [{ title: null, lines: ['1', '2', '3'] }, { title: 'A', lines: ['4', '5', '6'] }, { title: 'B', lines: ['7', '8', '9'] }];
  assert.deepEqual(sectionsOpen(long), [true, false, false], 'long: only the first section');
});

test('ui: turn-order games get the 「座位次序＝輪流次序」 lobby hint; meta.turnOrder overrides the list', () => {
  for (const id of ['undercover', 'spyfall', '9upper', 'avalon', 'werewolf', 'fake-artist', 'draw-guess']) {
    assert.equal(turnOrderMatters(id, {}), true, id);
  }
  assert.ok(TURN_ORDER_GAMES.length === 7);
  assert.equal(turnOrderMatters('cheese-thief', {}), false);
  assert.equal(turnOrderMatters('custom', undefined), false);
  assert.equal(turnOrderMatters('custom', { turnOrder: true }), true, 'a game can opt in');
  assert.equal(turnOrderMatters('spyfall', { turnOrder: false }), false, 'and out');
});

test('ui: keepsake — a picture paints like the live board onto paper; file names are safe', () => {
  const calls = [];
  const g = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }),
    set: (t, k, v) => { t[k] = v; calls.push([`=${String(k)}`, v]); return true; },
  });
  const strokes = [
    { id: 'a', pid: 'p2', pts: [[0, 0], [100, 100], [200, 50]], end: true },
    { id: 'b', pid: 'p3', pts: [[500, 500]], end: true, color: '#e4573d', width: 20 },
    { id: 'c', pid: 'p2', pts: [], end: true },
    { id: 'd', pid: 'p2', pts: [[10, 10], [20, 20]], end: true, eraser: true, width: 27 },
  ];
  const n = paintStrokes(g, strokes, { colorOf: (pid) => (pid === 'p2' ? '#2e7de0' : null) });
  assert.equal(n, 3, 'empty strokes are skipped');
  assert.deepEqual(calls.slice(0, 2), [['=fillStyle', PAPER], ['fillRect', 0, 0, 1000, 1000]], 'paper first, over the whole 0–1000 square');
  const colours = calls.filter((c) => c[0] === '=strokeStyle').map((c) => c[1]);
  assert.deepEqual(colours, ['#2e7de0', '#e4573d', PAPER], 'colorOf for strokes without colour; own colour wins; the eraser paints paper');
  assert.ok(calls.some((c) => c[0] === 'quadraticCurveTo'), 'smoothed like the live board');
  const bare = [];
  paintStrokes(new Proxy({}, { get: () => (...a) => bare.push(a), set: () => true }), strokes, { paper: false });
  assert.ok(!bare.some((a) => a[2] === 1000 && a[3] === 1000), 'paper: false leaves the background alone');

  const d = new Date(2026, 9, 3);
  assert.equal(pictureFileName('假畫家', 0, d), '假畫家-2026-10-03.png');
  assert.equal(pictureFileName('瞎掰王 9upper', 2, d), '瞎掰王9upper-2026-10-03-3.png', 'spaces go; the index counts from 1 after the first');
  assert.equal(pictureFileName('a/b:c*?', 0, d), 'abc-2026-10-03.png');
  assert.equal(pictureFileName('', 0, d), '桌遊盒-2026-10-03.png');
});

test('ui: lobby / home helpers the screens now share — saved order, saved names, preset match', () => {
  const g = { names: ['甲', '乙', '丙'], order: ['甲', '乙', '丙'] };
  const seat = (names) => names.map((name, i) => ({ id: `p${i}`, name, spectator: false }));
  assert.equal(savedOrderDiffers(seat(['乙', '甲', '丁']), g), true);
  assert.equal(savedOrderDiffers(seat(['甲', '丁', '乙']), g), false, 'the same relative order');
  assert.equal(savedOrderDiffers(seat(['甲']), g), false, 'fewer than two of them here');
  assert.deepEqual(savedGroupNames(g), ['甲', '乙', '丙']);
  assert.equal(savedGroupNames({ names: ['甲'] }), null);
  assert.equal(presetMatches({ a: 1, b: [1, 2], c: 3 }, { a: 1, b: [1, 2] }), true);
  assert.equal(presetMatches({ a: 1, b: [2, 1] }, { b: [1, 2] }), false);
  assert.equal(presetMatches({}, null), false);
});

// ============================================================
// playtest fixes (docs/playtest/multi/SUMMARY.md #3 #4 #10 #13 #14 #15 #37 #39) — pure rules
// ============================================================

test('ui #39: the scoreboard gives medals only for something won, and drops the 分 column on a night without points', () => {
  const players = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, name: id, seat: i }));
  // a points game: 1, 1, 0, 0, 0 — the zeros are not 🥉
  const pts = rankRows(players, { a: { played: 1, wins: 1, points: 1 }, b: { played: 1, wins: 1, points: 1 }, c: { played: 1 }, d: { played: 1 }, e: { played: 1 } });
  const m1 = scoreboardMode(pts);
  assert.equal(m1.points, true);
  assert.deepEqual(pts.map((r) => m1.earned(r)), [true, true, false, false, false], 'no medal for 0 points');
  // werewolf only: no points anywhere — the column goes, and wins earn the medal
  const wins = rankRows(players, { a: { played: 1, wins: 1 }, b: { played: 1, wins: 1 }, c: { played: 1 }, d: { played: 1 }, e: { played: 1 } });
  const m2 = scoreboardMode(wins);
  assert.equal(m2.points, false, 'no game tonight awarded points');
  assert.deepEqual(wins.map((r) => m2.earned(r)), [true, true, false, false, false], 'winners still get their medal');
  // custom (nobody wins, nobody scores): nothing earned at all
  const none = rankRows(players.slice(0, 3), { a: { played: 1 }, b: { played: 1 }, c: { played: 1 } });
  assert.deepEqual(none.map((r) => scoreboardMode(none).earned(r)), [false, false, false], 'never 🥇 for all three');
  // a negative score (9upper's wrong 收皮啦) is points awarded, and earns nothing
  const neg = rankRows(players.slice(0, 2), { a: { played: 1, points: -3 }, b: { played: 1 } });
  assert.equal(scoreboardMode(neg).points, true);
  assert.deepEqual(neg.map((r) => scoreboardMode(neg).earned(r)), [false, false]);
  assert.equal(scoreboardMode([]).points, false);
});

test('ui #39: the results headline states the result; the game name is never followed by 「— 贏家」', () => {
  const meta = { emoji: '🧀', name: '芝士大盜' };
  const caught = resultHero({ winners: ['p2', 'p3'], summary: '貪瞓鼠贏 — 大盜 阿明 畀人揪出' }, meta);
  assert.deepEqual(caught, { trophy: '🏆', heading: '貪瞓鼠贏 — 大盜 阿明 畀人揪出', summaryBelow: false }, 'the summary is the headline, said once');
  assert.ok(!caught.heading.includes('贏家'));
  assert.deepEqual(resultHero({ winners: ['p1'], summary: '' }, meta), { trophy: '🏆', heading: '贏家', summaryBelow: false });
  assert.deepEqual(resultHero({ winners: [], summary: '' }, meta), { trophy: '🤝', heading: '冇人贏', summaryBelow: false });
  assert.deepEqual(resultHero({ winners: [], summary: '開咗新一鋪', void: true }, meta), { trophy: '🚫', heading: '呢鋪唔計', summaryBelow: true });
  const tool = resultHero({ winners: [], summary: '通用派牌：玩咗 3 回合', noScore: true }, { emoji: '🎲', name: '通用派牌' });
  assert.deepEqual(tool, { trophy: '🎲', heading: '邊個贏由你哋講', summaryBelow: true }, 'a tool that does not judge never says 冇人贏');
  assert.equal(resultHero({ winners: [] }, { emoji: '🎲', noScore: true }).heading, '邊個贏由你哋講', 'meta.noScore works too');
  assert.equal(resultHero(null, {}).heading, '冇人贏');
});

test('ui #39: confetti rains the game\'s own emoji, not the cheese mascot', () => {
  assert.deepEqual(confettiSet({ emoji: '🏰' }), ['🎉', '✨', '🏰', '🎊', '⭐']);
  assert.ok(!confettiSet({ emoji: '🎨' }).includes('🧀'));
  assert.ok(confettiSet({ emoji: '🧀' }).includes('🧀'), '芝士大盜 keeps its own cheese');
  assert.ok(!confettiSet({}).includes('🧀'), 'no meta: no stray cheese either');
});

test('ui #14: 輪到你 is for a real turn only — never anonymous, never at night, never a step everybody does at once', () => {
  assert.equal(turnBadge({ pids: ['p2'] }, 'p2'), true, 'the engine waits on this seat alone');
  assert.equal(turnBadge({ pids: ['p2'] }, 'p3'), false);
  assert.equal(turnBadge({ pids: ['p2'], anonymous: '刺客請拎起部手機' }, 'p2'), false, 'the Assassin\'s phone looks like everyone else\'s');
  assert.equal(turnBadge({ pids: ['p2'] }, 'p2', { night: true }), false, 'no bright pill on a lit phone at night');
  assert.equal(turnBadge({ pids: ['p2'], together: true }, 'p2'), false, 'a deal or a vote calls every seat: no pill on each phone');
  assert.equal(turnBadge({ pids: ['p2'], simultaneous: true }, 'p2'), false, 'an engine may say so itself');
  assert.equal(turnBadge({ pids: ['p2', 'p3'] }, 'p2'), false, 'a shared phone with two seats called: not one seat\'s turn');
  assert.equal(turnBadge(null, 'p2'), false);
  assert.equal(turnBadge({ pids: ['p2'] }, null), false, 'a watching phone has no turn');
});

test('ui #13: the host\'s ⏭ takes two taps only when skipping would cut somebody off', () => {
  assert.equal(skipNeedsConfirm({}), false, 'nobody waited on, daytime: one tap');
  assert.equal(skipNeedsConfirm({ waiting: true }), true, 'an open vote (the room says the engine waits on some seat)');
  assert.equal(skipNeedsConfirm({ focus: { pids: ['p1'] } }), true, 'the host\'s own seat is called');
  assert.equal(skipNeedsConfirm({ focus: { pids: [], anonymous: '狼人請拎起部手機' } }), true, 'an eyes-closed window, even an empty one');
  assert.equal(skipNeedsConfirm({ night: true }), true, 'night: a seated host\'s stray tap must not cut a peek short');
  // 讀稿: the narrator's tap on a fresh line only says "read" — no confirm; once moved past it, skipping is a skip
  assert.equal(skipNeedsConfirm({ waiting: true, mode: 'read', cueId: 'c1', ackedCueId: null }), false);
  assert.equal(skipNeedsConfirm({ waiting: true, mode: 'read', cueId: 'c1', ackedCueId: 'c1' }), true);
  assert.equal(skipNeedsConfirm({ waiting: true, mode: 'read', cueId: null }), true, 'no line: the tap would skip the window');
  assert.equal(skipNeedsConfirm({ waiting: true, mode: 'silent', cueId: 'c1' }), true, '靜音 / 語音 lines finish by themselves');
  assert.ok(SKIP_CONFIRM.length <= 16 && /跳過/.test(SKIP_CONFIRM));
});

test('ui #10: view.recent → folds; empty ones are dropped, ballots are kept as from → to', () => {
  assert.deepEqual(recentFolds(null), []);
  assert.deepEqual(recentFolds({ title: '📜 之前嘅投票', entries: [] }), [], 'nothing yet: no empty fold');
  const folds = recentFolds([
    { id: 'votes', title: '📜 之前嘅投票', entries: [
      { title: '第 2 輪', lines: [{ from: 'p1', to: 'p3' }, { from: 'p2', to: null }, { from: 'p3' }] },
      { title: '第 1 輪', lines: ['阿明 → 小美', '', null] },
      { title: '空', lines: [] },
    ] },
    { title: '🌅 昨晚', lines: ['平安夜', { text: '冇人出局' }], open: true },
    'junk',
  ]);
  assert.deepEqual(folds, [
    { key: 'votes', title: '📜 之前嘅投票', open: false, entries: [
      { title: '第 2 輪', lines: [{ from: 'p1', to: 'p3' }, { from: 'p2', to: null }, { from: 'p3', to: null }] },
      { title: '第 1 輪', lines: [{ text: '阿明 → 小美' }] },
    ] },
    { key: '1:🌅 昨晚', title: '🌅 昨晚', open: true, entries: [{ title: null, lines: [{ text: '平安夜' }, { text: '冇人出局' }] }] },
  ]);
  assert.equal(recentFolds({ lines: ['x'] })[0].title, '📜 之前發生咗咩', 'a fold without a title still gets one');
  assert.equal(recentFolds(Array.from({ length: 9 }, (_, i) => ({ title: `f${i}`, lines: ['x'] }))).length, 4, 'at most 4 folds');
});

// ============================================================
// fake DOM for the shared components (#3 #13 #15 #37 #39 #10)
// ============================================================

class FNode {
  constructor() { this.parentNode = null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === fakeDocument.body; }
}
class FText extends FNode {
  constructor(t) { super(); this.data = String(t); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
class FEl extends FNode {
  constructor(tag) {
    super();
    this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.cls = new Set();
    this.styleMap = {}; this.hidden = false; this.disabled = false; this.dataset = {};
    const self = this;
    this.style = new Proxy({}, {
      get: (_, k) => (k === 'setProperty' ? (n, v) => { self.styleMap[n] = String(v); }
        : k === 'removeProperty' ? (n) => { delete self.styleMap[n]; } : self.styleMap[k]),
      set: (_, k, v) => { self.styleMap[k] = String(v); return true; },
    });
    this.classList = {
      add: (...c) => c.forEach((x) => self.cls.add(x)),
      remove: (...c) => c.forEach((x) => self.cls.delete(x)),
      toggle: (c, on) => { const want = on === undefined ? !self.cls.has(c) : !!on; if (want) self.cls.add(c); else self.cls.delete(c); return want; },
      contains: (c) => self.cls.has(c),
    };
  }
  get childNodes() { return this.children; }
  get firstElementChild() { return this.children.find((c) => c instanceof FEl) ?? null; }
  get outerHTML() { return `<${this.tag} ${JSON.stringify([this.className, this.attrs, this.hidden, this.disabled])}>${this.children.map((c) => (c instanceof FEl ? c.outerHTML : c.data)).join('')}</${this.tag}>`; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(...(String(v) === '' ? [] : [new FText(v)])); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  append(...kids) { for (const k of kids) this.appendChild(k instanceof FNode ? k : new FText(k)); }
  appendChild(k) { k.parentNode?.removeChild(k); k.parentNode = this; this.children.push(k); return k; }
  removeChild(k) { const i = this.children.indexOf(k); if (i >= 0) { this.children.splice(i, 1); k.parentNode = null; } return k; }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() { this.parentNode?.removeChild(this); }
}
const fakeDocument = {
  createElement: (t) => new FEl(t),
  createTextNode: (t) => new FText(t),
  getElementById: (id) => findAll(fakeDocument.body, (n) => n.attrs.id === id)[0] ?? null,
  addEventListener() {}, removeEventListener() {},
  hidden: false,
  body: new FEl('body'), head: new FEl('head'),
};
const walk = (n, fn) => { fn(n); if (n.children) for (const c of n.children) walk(c, fn); };
const findAll = (root, pred) => { const out = []; walk(root, (n) => { if (n instanceof FEl && pred(n)) out.push(n); }); return out; };
const shown = (n) => { for (let x = n; x; x = x.parentNode) if (x.hidden) return false; return true; };
const tap = (n) => {
  assert.ok(n, 'nothing to tap');
  assert.ok(!n.disabled && shown(n), 'tapped a disabled / hidden control');
  for (const f of n.listeners.click ?? []) f({ preventDefault() {}, currentTarget: n, target: n });
};
const press = (n, type) => { for (const f of n.listeners[type] ?? []) f({ preventDefault() {}, pointerId: 1 }); };
const btnWith = (root, text) => findAll(root, (n) => n.tag === 'button' && shown(n) && n.textContent.includes(text))[0];

/** Run `fn(mods, clock)` under the fake DOM and a controllable Date.now; everything is put back after. */
async function withDom(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node, window: globalThis.window };
  const realNow = Date.now;
  const clock = { t: 1_000_000, advance(ms) { this.t += ms; } };
  globalThis.document = fakeDocument;
  globalThis.Node = FNode;
  globalThis.window = { addEventListener() {}, AudioContext: undefined };
  Date.now = () => clock.t;
  fakeDocument.body.replaceChildren();
  const dom = await import('../js/ui/dom.js?v=1');
  try {
    const mods = {
      dom,
      NarratorBar: (await import('../js/ui/components/NarratorBar.js?v=1')).NarratorBar,
      VotePanel: (await import('../js/ui/components/VotePanel.js?v=1')).VotePanel,
      Scoreboard: (await import('../js/ui/components/Scoreboard.js?v=1')).Scoreboard,
      Cover: (await import('../js/ui/components/Cover.js?v=1')).Cover,
      RecentFold: (await import('../js/ui/components/RecentFold.js?v=1')).RecentFold,
      RoleCard: (await import('../js/ui/components/RoleCard.js?v=1')).RoleCard,
    };
    return await fn(mods, clock);
  } finally {
    dom.disarmConfirm();
    Date.now = realNow;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

test('ui #3: arm-then-confirm — the first tap arms 「再㩒一次：…」, only a second tap in time does it; nothing blocks', async () => {
  await withDom(async ({ dom }, clock) => {
    const btn = new FEl('button');
    btn.textContent = '🗑️ 呢輪作廢';
    fakeDocument.body.append(btn);
    const text = '呢輪作廢、重新嚟過？\n（有人部手機死咗先用）';
    assert.equal(dom.confirmTap(text, { node: btn }), false, 'first tap: armed, nothing done');
    assert.equal(btn.textContent, '再㩒一次：呢輪作廢、重新嚟過？', 'the button says what a second tap does (first line only)');
    assert.ok(btn.cls.has('armed'));
    clock.advance(100);
    assert.equal(dom.confirmTap(text, { node: btn }), false, 'a bounce 0.1 s later is not a decision');
    clock.advance(900);
    assert.equal(dom.confirmTap(text, { node: btn }), true, 'the second tap within ~3 s does it');
    assert.equal(btn.textContent, '🗑️ 呢輪作廢', 'and the button gets its own label back');
    assert.ok(!btn.cls.has('armed'));

    // too late: the arm has run out, so the tap arms again
    assert.equal(dom.confirmTap(text, { node: btn }), false);
    clock.advance(3500);
    assert.equal(dom.confirmTap(text, { node: btn }), false, 'after ~3 s it starts over');
    clock.advance(500);
    assert.equal(dom.confirmTap(text, { node: btn }), true);

    // another button with the same text re-arms there; a re-rendered (detached) button still counts
    const a = new FEl('button'); a.textContent = '踢走';
    const b = new FEl('button'); b.textContent = '踢走';
    fakeDocument.body.append(a, b);
    assert.equal(dom.confirmTap('踢走 阿明？', { node: a }), false);
    clock.advance(500);
    assert.equal(dom.confirmTap('踢走 阿明？', { node: b }), false, 'a different button is a different tap');
    assert.equal(a.textContent, '踢走', 'the first one let go of its armed label');
    b.remove();                                               // the screen rebuilt it…
    const b2 = new FEl('button'); b2.textContent = '踢走'; fakeDocument.body.append(b2);
    clock.advance(500);
    assert.equal(dom.confirmTap('踢走 阿明？', { node: b2 }), true, '…so its replacement takes the second tap');

    // an icon keeps its face; a toast says it instead
    const x = new FEl('button'); x.textContent = '✕'; fakeDocument.body.append(x);
    assert.equal(dom.confirmTap('踢走 阿強？', { node: x, inline: false }), false);
    assert.equal(x.textContent, '✕');
    assert.ok(x.cls.has('armed'));
    assert.equal(fakeDocument.getElementById('toast')?.textContent, '再㩒一次：踢走 阿強？');
    assert.equal(dom.isArmed('踢走 阿強？', x), true);
    dom.disarmConfirm();
    assert.ok(!x.cls.has('armed'));
  });
});

test('ui #13: NarratorBar — the skip is a ghost 「⏭ 跳過呢步」; 讀稿 keeps a primary 下一步; confirmNext needs two taps', async () => {
  await withDom(async ({ NarratorBar }, clock) => {
    let nexts = 0;
    const props = (extra = {}) => ({ cue: { id: 'c1', text: '投票開始' }, mode: 'silent', onNext: () => { nexts++; }, onMode() {}, ...extra });
    const bar = NarratorBar(props());
    fakeDocument.body.append(bar.el);
    const next = () => findAll(bar.el, (n) => n.cls.has('c-narratorbar-next'))[0];
    assert.equal(next().textContent, '⏭ 跳過呢步');
    assert.ok(next().cls.has('btn-ghost') && !next().cls.has('btn-primary'), 'never the brightest button on the host\'s screen');

    bar.update(props({ mode: 'read' }));
    assert.equal(next().textContent, '下一步 ⏭', 'the 讀稿 narrator\'s 下一步 is the main action');
    assert.ok(next().cls.has('btn-primary') && next().cls.has('btn-lg'));
    bar.update(props({ mode: 'read', cue: null }));
    assert.equal(next().textContent, '⏭ 跳過呢步', 'with no line to read it skips the window: ghost again');
    assert.ok(next().cls.has('btn-ghost') && next().cls.has('btn-sm') && !next().cls.has('btn-lg'), '…and small, even in 讀稿');

    // no confirm wanted: one tap
    bar.update(props());
    tap(next());
    assert.equal(nexts, 1);
    clock.advance(2000);

    // an open vote: the first tap arms, the second moves on
    bar.update(props({ confirmNext: '跳過？未做嘅當冇做' }));
    tap(next());
    assert.equal(nexts, 1, 'the first tap only arms');
    assert.equal(next().textContent, '再㩒一次：跳過？未做嘅當冇做');
    bar.update(props({ confirmNext: '跳過？未做嘅當冇做' }));
    assert.equal(next().textContent, '再㩒一次：跳過？未做嘅當冇做', 'a state update does not wipe the armed label');
    clock.advance(800);
    tap(next());
    assert.equal(nexts, 2, 'the second tap skips');
    assert.equal(next().textContent, '⏭ 跳過呢步');
    clock.advance(300);
    tap(next());
    assert.equal(nexts, 2, 'the 1.5 s cool-down still swallows a double tap');
    bar.destroy();
  });
});

test('ui #15: VotePanel — a ballot arriving mid-press never swaps the buttons; secretChoice; colorOf', async () => {
  await withDom(async ({ VotePanel }) => {
    const players = [
      { id: 'p1', name: '阿明', seat: 0, color: '#111111' },
      { id: 'p2', name: '小美', seat: 1, color: '#222222' },
      { id: 'p3', name: '大熊', seat: 2, color: '#333333' },
    ];
    const votes = [];
    const base = { players, candidates: ['p2', 'p3'], me: 'p1', onVote: (v) => votes.push(v) };
    const vp = VotePanel({ ...base, progress: { done: 1, total: 3 } });
    fakeDocument.body.append(vp.el);
    tap(btnWith(vp.el, '大熊'));
    const confirm = btnWith(vp.el, '確定投俾 大熊');
    assert.ok(confirm, 'the default panel names your pick');
    const rowsBefore = findAll(vp.el, (n) => n.cls.has('c-votepanel-opt'));
    // someone else's ballot lands between press and release
    vp.update({ ...base, progress: { done: 2, total: 3 } });
    assert.equal(btnWith(vp.el, '確定投俾 大熊'), confirm, 'the same 確定 node: the finger\'s release still lands on it');
    assert.deepEqual(findAll(vp.el, (n) => n.cls.has('c-votepanel-opt')), rowsBefore, 'rows untouched');
    assert.ok(vp.el.textContent.includes('已投 2/3'), 'the count moved on in place');
    assert.equal(findAll(vp.el, (n) => n.tag === 'i' && n.cls.has('on')).length, 2);
    tap(confirm);
    assert.deepEqual(votes, ['p3']);
    vp.update({ ...base, myVote: 'p3', progress: { done: 3, total: 3 } });
    assert.ok(vp.el.textContent.includes('你投咗 大熊 ✓'), 'default: your own phone says whom you voted for');

    // secretChoice: a glance at your phone learns nothing
    const sp = VotePanel({ ...base, secretChoice: true, progress: { done: 0, total: 3 } });
    tap(btnWith(sp.el, '小美'));
    assert.ok(btnWith(sp.el, '確定投票'), 'the button does not name the pick');
    assert.ok(!btnWith(sp.el, '確定投俾'));
    sp.update({ ...base, secretChoice: true, myVote: 'p2', progress: { done: 1, total: 3 } });
    assert.ok(sp.el.textContent.includes('已投 ✓'));
    assert.ok(!findAll(sp.el, (n) => n.tag === 'strong')[0].textContent.includes('小美'), 'the voted line has no name');
    assert.equal(findAll(sp.el, (n) => n.cls.has('c-votepanel-opt') && n.cls.has('on')).length, 0, 'no row stays lit');

    // colorOf: the game's own colour per seat (假畫家's pens) wins over the lobby colour
    const cp = VotePanel({ ...base, colorOf: (pid) => (pid === 'p2' ? '#ff0000' : null) });
    const dots = findAll(cp.el, (n) => n.cls.has('c-votepanel-dot')).map((d) => d.styleMap['--seat']);
    assert.deepEqual(dots, ['#ff0000', '#333333'], 'pen colour for p2, lobby colour where the game has none');
    cp.update({ ...base, colorOf: (pid) => (pid === 'p2' ? '#ff0000' : null), reveal: { counts: { p2: 2 }, top: ['p2'], votes: { p1: 'p2', p3: 'p2' } } });
    const chips = findAll(cp.el, (n) => n.cls.has('c-votepanel-dot')).map((d) => d.styleMap['--seat']);
    assert.equal(chips[0], '#ff0000', 'the reveal uses it too');
  });
});

test('ui #39: Scoreboard — no medal for 0, no 分 column of zeros, a no-score game is 唔計輸贏', async () => {
  await withDom(async ({ Scoreboard }) => {
    const players = ['a', 'b', 'c'].map((id, i) => ({ id, name: id, seat: i }));
    const cells = (sb) => findAll(sb.el, (n) => n.tag === 'tr').map((tr) => tr.children.map((c) => c.textContent));
    const wolves = Scoreboard({ players, scoreboard: { a: { played: 1, wins: 1 }, b: { played: 1 }, c: { played: 1 } },
      history: [{ gameId: 'werewolf', winners: ['a'], summary: '狼人隊贏' }] });
    assert.deepEqual(cells(wolves)[0], ['', '玩家', '局', '贏'], 'no game tonight gave points: no 分 column');
    assert.deepEqual(cells(wolves).slice(1).map((r) => r[0]), ['🥇', '·', '·'], 'the losers are not 🥈 / 🥉');
    const spy = Scoreboard({ players, scoreboard: { a: { played: 1, points: 4 }, b: { played: 1 }, c: { played: 1 } } });
    assert.deepEqual(cells(spy)[0], ['', '玩家', '局', '贏', '分數']);
    assert.deepEqual(cells(spy).slice(1).map((r) => r[0]), ['🥇', '·', '·']);
    const tool = Scoreboard({ players, scoreboard: { a: { played: 1 }, b: { played: 1 }, c: { played: 1 } },
      history: [{ gameId: 'custom', winners: [], summary: '', noScore: true }] });
    assert.deepEqual(cells(tool).slice(1).map((r) => r[0]), ['·', '·', '·'], 'never 🥇 for everybody');
    assert.ok(tool.el.textContent.includes('唔計輸贏') && !tool.el.textContent.includes('冇人贏'));
  });
});

test('ui #37: a die face says 「N 點」 only while it is uncovered', async () => {
  await withDom(async ({ dom, Cover }) => {
    const d6 = dom.dieFace(5);
    assert.equal(d6.attrs.role, 'img');
    assert.equal(d6.attrs['aria-label'], '5 點', 'a face on its own (the room code, an open showdown) is labelled');
    assert.equal(dom.dieFace(11, 12).attrs['aria-label'], '11 點');
    const front = new FEl('div');
    front.append(dom.dieFace(3), dom.dieFace(6));
    const cover = Cover({ front, backArt: '🎲', backLabel: '㩒住睇' });
    fakeDocument.body.append(cover.el);
    const faces = () => findAll(front, (n) => n.cls.has('die'));
    assert.deepEqual(faces().map((f) => f.attrs['aria-label'] ?? null), [null, null], 'covered: no number anywhere in the markup');
    assert.equal(findAll(cover.el, (n) => n.cls.has('c-cover-front'))[0].attrs['aria-hidden'], 'true');
    press(cover.el, 'pointerdown');
    assert.deepEqual(faces().map((f) => f.attrs['aria-label']), ['3 點', '6 點'], 'held open: the numbers are there');
    assert.equal(findAll(cover.el, (n) => n.cls.has('c-cover-front'))[0].attrs['aria-hidden'], 'false');
    press(cover.el, 'pointerup');
    assert.deepEqual(faces().map((f) => f.attrs['aria-label'] ?? null), [null, null], 'let go: gone again');
    // a re-roll swaps the faces while covered; the next update strips them
    front.replaceChildren(dom.dieFace(2));
    cover.update({ front, backArt: '🎲', backLabel: '㩒住睇' });
    assert.equal(faces()[0].attrs['aria-label'] ?? null, null);
    cover.destroy();
  });
});

test('ui #10: RecentFold — closed by default, keeps its open state across updates, ballots read 「阿明 → 小美」', async () => {
  await withDom(async ({ RecentFold }) => {
    const players = [{ id: 'p1', name: '阿明', color: '#111' }, { id: 'p2', name: '小美', color: '#222' }];
    const recent = { id: 'votes', title: '📜 之前嘅投票', entries: [{ title: '第 1 輪', lines: [{ from: 'p1', to: 'p2' }, { from: 'p2', to: null }] }] };
    const rf = RecentFold({ recent, players });
    const details = () => findAll(rf.el, (n) => n.tag === 'details');
    assert.equal(details().length, 1);
    assert.equal(details()[0].attrs.open, undefined, 'help on demand: folded until tapped');
    assert.ok(rf.el.textContent.includes('阿明→小美') && rf.el.textContent.includes('小美→棄權'));
    const d = details()[0];
    d.attrs.open = '';                                        // the player opened it
    rf.update({ recent: { ...recent, entries: [{ title: '第 2 輪', lines: ['阿明 出局'] }, ...recent.entries] }, players });
    assert.equal(details()[0], d, 'the same <details> element…');
    assert.equal(d.attrs.open, '', '…so it stays open');
    assert.ok(rf.el.textContent.indexOf('第 2 輪') < rf.el.textContent.indexOf('第 1 輪'), 'the game\'s order (newest first)');
    rf.update({ recent: null, players });
    assert.equal(details().length, 0);
    assert.equal(rf.el.hidden, true, 'nothing to show: nothing on screen');
    const open = RecentFold({ recent: { title: '🌅 昨晚', lines: ['平安夜'], open: true }, players });
    assert.equal(findAll(open.el, (n) => n.tag === 'details')[0].attrs.open, '', 'a fold may start open');
  });
});

test('ui #39: RoleCard — lockLabels and ariaLabel for a card that is not a role', async () => {
  await withDom(async ({ RoleCard }) => {
    const rc = RoleCard({ role: { emoji: '🃏', name: '蘋果' }, locked: false, onLockToggle() {},
      lockLabels: { lock: '🔓 鎖定詞語卡', locked: '🔒 已鎖', message: '詞語卡鎖咗' }, ariaLabel: '㩒住睇詞語', hint: '' });
    assert.ok(btnWith(rc.el, '🔓 鎖定詞語卡'));
    assert.equal(findAll(rc.el, (n) => n.cls.has('c-cover'))[0].attrs['aria-label'], '㩒住睇詞語');
    assert.equal(findAll(rc.el, (n) => n.cls.has('c-rolecard-hint'))[0].hidden, true, 'hint: \'\' hides the line');
    rc.update({ role: { emoji: '🃏', name: '蘋果' }, locked: true, onLockToggle() {}, lockLabels: { lock: '🔓 鎖定詞語卡', locked: '🔒 已鎖', message: '詞語卡鎖咗' } });
    assert.ok(btnWith(rc.el, '🔒 已鎖'));
    const plain = RoleCard({ role: { emoji: '🐺', name: '狼人' }, onLockToggle() {} });
    assert.ok(btnWith(plain.el, '🔓 鎖定角色牌'), 'the default wording is unchanged');
    rc.destroy(); plain.destroy();
  });
});

test('ui #3: the window.confirm safety net — a game\'s confirm() arms the button it came from instead of freezing the host', async () => {
  await withDom(async ({ dom }, clock) => {
    const listeners = [];
    const doc = { addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }) };
    const win = { confirm: () => { throw new Error('the native dialog must never run'); } };
    assert.equal(dom.installConfirmShim(win, doc), true);
    assert.ok(listeners.some((l) => l.type === 'click' && l.capture === true), 'it watches taps in the capture phase');
    const btn = new FEl('button');
    btn.textContent = '👁 開晒啲骰';
    fakeDocument.body.append(btn);
    const tapThenConfirm = () => {
      for (const l of listeners) l.fn({ target: { closest: () => btn } });
      return win.confirm('公開所有人嘅骰？');
    };
    assert.equal(tapThenConfirm(), false, 'the first tap only arms — and returns at once');
    assert.equal(btn.textContent, '再㩒一次：公開所有人嘅骰？');
    clock.advance(700);
    assert.equal(tapThenConfirm(), true, 'the second tap goes through');
    assert.equal(btn.textContent, '👁 開晒啲骰');
    clock.advance(5000);
    assert.equal(win.confirm('冇㩒掣都問？'), false, 'no recent tap: a toast arms it, and the answer is no');
  });
});

test('ui #13 #14 #10 #3: the play screen — 輪到你 only for a lone turn, view.recent folds under the game, two-tap skips and menu rows', async () => {
  await withDom(async ({ dom }, clock) => {
    const savedRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (fn) => fn();
    try {
      const { mountPlay } = await import('../js/ui/screens/play.js?v=1');
      const calls = [];
      const players = [{ id: 'p1', name: '阿明', seat: 0, color: '#111', connected: true }, { id: 'p2', name: '小美', seat: 1, color: '#222', connected: true }];
      const st = {
        mode: 'host', isHost: true, mySeats: ['p1'], activeSeat: 'p1', conn: 'online',
        room: { phase: 'playing', gameId: 'g', players, paused: false, narration: { mode: 'silent' }, stalled: [] },
        views: { p1: { phase: 'vote', title: '投票', subtitle: '揀一個' } },
        focus: { pids: ['p1'] }, cue: { id: 'c1', text: '投票開始' }, waiting: true, hostActions: [],
      };
      const app = {
        state: st,
        hostCtl: { next: () => calls.push('next'), voidRound: () => { calls.push('void'); return true; }, pause() {}, resume() {}, autoAct() {} },
        narration: { setMode() {} }, act: () => true, ink() {}, clock: { now: () => clock.t }, setActiveSeat() {},
      };
      const game = { meta: { id: 'g', name: '測試' }, ui: { mount: () => ({ update() {}, destroy() {} }) } };
      const sh = {
        app, narrator: { cancel() {}, prime() {}, speak() {} }, cameFrom: null,
        timer: { button: () => new FEl('button'), strip: () => new FEl('div'), available: () => false, open() {}, openBig() {} },
        soundButton: () => new FEl('button'),
        sound: { isOn: () => true, toggle() {}, night() {} },
        gameMeta: () => ({ id: 'g', name: '測試', emoji: '🧪', narration: 'voice' }),
        cached: () => game, loadGame: async () => game,
        confirm: (text, node = null, opts = {}) => dom.confirmTap(text, { node, ...opts }),
        leave: (node, opts) => dom.confirmTap('真係要離開？', { node, key: 'leave-room', ...opts }) && (calls.push('leave'), true),
      };
      const screen = mountPlay(sh);
      fakeDocument.body.append(screen.el);
      const sub = () => findAll(screen.el, (n) => n.tag === 'small')[0];
      const badge = () => findAll(screen.el, (n) => n.cls.has('turn-badge'));

      screen.update(st);
      assert.equal(badge().length, 1, 'a lone turn: 輪到你');
      assert.equal(sub().children[0].cls?.has('turn-badge'), true, 'the pill comes before the subtitle, so an ellipsis never hides it');
      screen.update({ ...st, focus: { pids: ['p1'], together: true } });
      assert.equal(badge().length, 0, 'a step every seat does at once: no pill');
      screen.update({ ...st, focus: { pids: ['p1'], anonymous: '刺客請拎起部手機' } });
      assert.equal(badge().length, 0, 'a secret step: no pill');

      // #10: the game's public folds appear under its UI, closed
      screen.update({ ...st, views: { p1: { ...st.views.p1, recent: { id: 'v', title: '📜 之前嘅投票', entries: [{ title: '第 1 輪', lines: ['阿明 → 小美'] }] } } } });
      const fold = findAll(screen.el, (n) => n.tag === 'details');
      assert.equal(fold.length, 1);
      assert.equal(fold[0].attrs.open, undefined);

      // #13: an open vote — the narrator bar's skip arms first
      screen.update(st);
      const skip = findAll(screen.el, (n) => n.cls.has('c-narratorbar-next'))[0];
      assert.equal(skip.textContent, '⏭ 跳過呢步');
      tap(skip);
      assert.deepEqual(calls, [], 'the first tap only arms');
      clock.advance(600);
      tap(skip);
      assert.deepEqual(calls, ['next'], 'the second tap skips');
      clock.advance(2000);
      screen.update({ ...st, waiting: false, focus: null });
      tap(skip);
      assert.deepEqual(calls, ['next', 'next'], 'nobody to cut off: one tap');
      clock.advance(2000);

      // #3: ⋯ menu rows arm in place; the sheet stays open until the second tap
      tap(findAll(screen.el, (n) => n.attrs['aria-label'] === '選項')[0]);
      const sheet = () => findAll(fakeDocument.body, (n) => n.cls.has('menu-sheet')).at(-1);   // a closed one lingers 160 ms
      assert.ok(sheet(), 'the menu is open');
      screen.update(st);
      tap(btnWith(sheet(), '⏭ 跳過呢步'));
      assert.deepEqual(calls, ['next', 'next']);
      assert.ok(btnWith(sheet(), '再㩒一次：跳過？'), 'armed in place, the menu still open');
      clock.advance(600);
      tap(btnWith(sheet(), '再㩒一次：跳過？'));
      assert.deepEqual(calls, ['next', 'next', 'next']);
      clock.advance(2000);
      tap(findAll(screen.el, (n) => n.attrs['aria-label'] === '選項')[0]);
      tap(btnWith(sheet(), '🗑️ 呢輪作廢'));
      assert.ok(!calls.includes('void'), '呢輪作廢 needs a second tap');
      clock.advance(600);
      tap(btnWith(sheet(), '再㩒一次：呢輪作廢'));
      assert.ok(calls.includes('void'));
      screen.destroy();
    } finally {
      if (savedRaf === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = savedRaf;
    }
  });
});
