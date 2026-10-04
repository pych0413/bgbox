// js/ui/logic.js — the pure rules behind the picker, role cards, scoreboard and clocks.

import { test, assert } from './lib.mjs';
import {
  fits, teamStyle, rankRows, fmtDuration, fmtClock,
  timerLeftMs, timerCue, clampTimerSec, TIMER_PRESETS, inAppBrowser, roleFor, roleParts,
  headingOf, resultSections, sectionsOpen, turnOrderMatters, TURN_ORDER_GAMES, pictureFileName,
  savedOrderDiffers, savedGroupNames, presetMatches,
  scoreboardMode, resultHero, confettiSet, turnBadge, skipNeedsConfirm, SKIP_CONFIRM, recentFolds,
  nightChrome, NIGHT_WORDS, hintRoleText, focusSig, walkOrder, gateSubtitle, narrationChoices,
} from '../js/ui/logic.js';
import { paintStrokes, PAPER } from '../js/ui/ink.js';
import { isIOS, motionWords, motionDeviceName } from '../js/core/shake.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

test('ui D1: nightChrome — in 靜音 every seat at night gets the same soft dim and words; 語音 / 讀稿 keep the eyes-closed dark', () => {
  const awake = { seat: 'p1', night: true, inFocus: true };
  const asleep = { seat: 'p2', night: true, inFocus: false };
  for (const mode of ['silent']) {
    assert.deepEqual(nightChrome({ ...awake, mode }), nightChrome({ ...asleep, mode }), '靜音: the awake phone looks like every other');
    assert.deepEqual(nightChrome({ ...awake, mode }), { on: true, level: 'soft', words: NIGHT_WORDS.silent });
  }
  assert.notEqual(NIGHT_WORDS.silent.title, '閉 眼', '靜音 never says 閉眼 (eyes stay open by design)');
  for (const mode of ['voice', 'read']) {
    assert.deepEqual(nightChrome({ ...awake, mode }), { on: false, level: null, words: NIGHT_WORDS.closed }, `${mode}: the called seat is lit`);
    assert.deepEqual(nightChrome({ ...asleep, mode }), { on: true, level: 'dark', words: NIGHT_WORDS.closed }, `${mode}: everyone else is dark`);
  }
  // a shared phone keeps focus for its pass gate: the last holder's screen is covered, the called seat is soft-dimmed
  assert.equal(nightChrome({ ...asleep, mode: 'silent', shared: true }).level, 'opaque');
  assert.equal(nightChrome({ ...awake, mode: 'silent', shared: true }).level, 'soft', 'no full-brightness lift even there');
  assert.equal(nightChrome({ ...asleep, mode: 'voice', shared: true }).level, 'opaque');
  // no night, or no seat (the table view, a spectator): nothing
  assert.equal(nightChrome({ seat: 'p1', night: false, mode: 'silent' }).on, false);
  assert.equal(nightChrome({ seat: null, night: true, mode: 'silent' }).on, false);
});

test('ui: 💡 role box — view.hintRoleText (this table\'s rule) wins over the generic rules text; nothing else changes', () => {
  const rules = { roles: [{ id: 'wolf', name: '狼人', emoji: '🐺', team: 'wolf', text: '做乜：夜晚殺人。點贏：睇設定。' }] };
  assert.equal(roleFor({ roleId: 'wolf' }, rules).text, '做乜：夜晚殺人。點贏：睇設定。');
  const own = roleFor({ roleId: 'wolf', hintRoleText: '做乜：夜晚殺人。點贏：殺晒所有神（屠邊）。' }, rules);
  assert.deepEqual(own, { id: 'wolf', name: '狼人', emoji: '🐺', team: 'wolf', text: '做乜：夜晚殺人。點贏：殺晒所有神（屠邊）。' });
  assert.deepEqual(roleParts(own.text), { what: '夜晚殺人。', win: '殺晒所有神（屠邊）。' });
  assert.equal(hintRoleText({ hintRoleText: { what: '揾出狼人', win: '所有狼人出局' } }), '做乜：揾出狼人 點贏：所有狼人出局');
  assert.equal(hintRoleText({ hintRoleText: { win: '所有狼人出局' } }), '點贏：所有狼人出局');
  assert.equal(hintRoleText({ hintRoleText: '  ' }), '');
  assert.equal(roleFor({ roleId: 'wolf', hintRoleText: '' }, rules).text, '做乜：夜晚殺人。點贏：睇設定。', 'empty: the rules text');
  assert.equal(roleFor({ hintRoleText: '做乜：秘密' }, rules), null, 'a text alone never invents a role (undercover)');
  assert.equal(rules.roles[0].text, '做乜：夜晚殺人。點贏：睇設定。', 'the shared rules object is never touched');
});

test('ui #38: the motion-permission lines say 「iPhone」 only on a real iPhone / iPad', () => {
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 };
  const ipad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', maxTouchPoints: 5 };
  const mac = { userAgent: ipad.userAgent, maxTouchPoints: 0 };
  const android = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', maxTouchPoints: 5 };
  assert.equal(isIOS(iphone), true);
  assert.equal(isIOS(ipad), true, 'iPadOS calls itself a Mac with a touch screen');
  assert.equal(isIOS(mac), false);
  assert.equal(isIOS(android), false);
  assert.equal(motionDeviceName(iphone), 'iPhone');
  assert.equal(motionDeviceName(ipad), 'iPad');
  const w = motionWords(iphone);
  assert.ok(w.denied.includes('iPhone') && w.ask.includes('iPhone') && w.deniedHow.includes('Safari'));
  for (const nav of [android, mac, null]) {
    const n = motionWords(nav);
    for (const line of Object.values(n)) assert.ok(!/iPhone|iPad|Safari/.test(line), `neutral wording: ${line}`);
    assert.ok(n.denied.includes('部機'));
  }
});

test('ui #3: no native prompt / alert anywhere in the shell or core (a blocking dialog freezes the host phone)', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');
  const files = [];
  const walkDir = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walkDir(p);
      else if (f.endsWith('.js')) files.push(p);
    }
  };
  walkDir(join(root, 'ui'));
  walkDir(join(root, 'core'));
  assert.ok(files.length > 20);
  for (const f of files) {
    const code = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/\b(?:window|globalThis)\.(?:prompt|alert)\s*\(|(?<![.\w])(?:prompt|alert)\s*\(/.test(code), `${f} calls a native prompt / alert`);
  }
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
  get lastElementChild() { return [...this.children].reverse().find((c) => c instanceof FEl) ?? null; }
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

// ---------- round 2: the play screen at night (D1), absent seats (D4), why a void / skip did nothing ----------

/**
 * The play screen on one phone, under the fake DOM (call inside withDom). `seat` is this phone's only seat; `st`
 * patches the app state; `hostCtl` patches the host controls. Every sh.sound.night(on, opts) call is recorded.
 */
async function playPhone(dom, clock, { seat = 'p1', st: patch = {}, hostCtl = {} } = {}) {
  const { mountPlay } = await import('../js/ui/screens/play.js?v=1');
  const calls = [];
  const nights = [];
  const players = [
    { id: 'p1', name: '阿明', seat: 0, color: '#111', connected: true },
    { id: 'p2', name: '小美', seat: 1, color: '#222', connected: true },
    { id: 'p3', name: '大熊', seat: 2, color: '#333', connected: true },
  ];
  const room = { phase: 'playing', gameId: 'g', players, paused: false, narration: { mode: 'silent' }, stalled: [], absent: [] };
  const st = {
    mode: 'host', isHost: seat === 'p1', mySeats: [seat], activeSeat: seat, conn: 'online',
    views: { [seat]: { phase: 'night', title: '夜晚', subtitle: '大盜揀人', night: true } },
    focus: null, cue: null, waiting: false, hostActions: [],
    ...patch,
    room: { ...room, ...(patch.room ?? {}) },
  };
  const app = {
    state: st,
    hostCtl: {
      next: () => { calls.push('next'); return true; }, voidRound: () => { calls.push('void'); return true; },
      pause() {}, resume() {}, autoAct: (pid) => calls.push(`auto:${pid}`),
      markAbsent: (pid) => { calls.push(`absent:${pid}`); return true; },
      markPresent: (pid) => { calls.push(`present:${pid}`); return true; },
      ...hostCtl,
    },
    narration: { setMode() {} }, act: () => true, ink() {}, clock: { now: () => clock.t }, setActiveSeat() {},
  };
  const game = { meta: { id: 'g', name: '測試' }, ui: { mount: () => ({ update() {}, destroy() {} }) } };
  const sh = {
    app, narrator: { cancel() {}, prime() {}, speak() {} }, cameFrom: null,
    timer: { button: () => new FEl('button'), strip: () => new FEl('div'), available: () => false, open() {}, openBig() {} },
    soundButton: () => new FEl('button'),
    sound: { isOn: () => true, toggle() {}, night: (on, opts) => nights.push([on, opts]) },
    gameMeta: () => ({ id: 'g', name: '測試', emoji: '🧪', narration: 'voice' }),
    cached: () => game, loadGame: async () => game,
    confirm: (text, node = null, opts = {}) => dom.confirmTap(text, { node, ...opts }),
    leave: () => false,
  };
  const screen = mountPlay(sh);
  fakeDocument.body.append(screen.el);
  screen.update(st);
  const menu = () => findAll(fakeDocument.body, (n) => n.cls.has('menu-sheet')).at(-1);
  const openMenu = () => tap(findAll(screen.el, (n) => n.attrs['aria-label'] === '選項')[0]);
  const toastText = () => fakeDocument.getElementById('toast')?.textContent ?? '';
  return { screen, st, app, calls, nights, menu, openMenu, toastText };
}

async function withRaf(fn) {
  const saved = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (f) => f();
  try { return await fn(); } finally {
    if (saved === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = saved;
  }
}

test('ui D1: in 靜音 every seat\'s night chrome is identical — the awake phone gets no lift and the same overlay words', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const { createNightDim } = await import('../js/ui/night.js?v=1');
    const header = (screen) => findAll(screen.el, (n) => n.tag === 'header')[0].outerHTML;
    /** What a glance at this phone shows at night: the overlay as painted, and the top bar. */
    const glance = async (seat, mode, awake) => {
      const ph = await playPhone(dom, clock, {
        seat, st: { room: { narration: { mode } }, focus: awake ? { pids: [seat], anonymous: '大盜請醒' } : { pids: [], anonymous: '大盜請醒' } },
      });
      const [on, opts] = ph.nights.at(-1);
      const nd = createNightDim();
      nd.set({ on, ...opts });
      const out = { night: [on, opts], overlay: nd.el.outerHTML, cls: nd.el.className, header: header(ph.screen), badge: findAll(ph.screen.el, (n) => n.cls.has('turn-badge')).length };
      ph.screen.destroy();
      return out;
    };
    // the thief (p2, awake) and a sleepyhead (p3) on their own phones, same view shape
    const thief = await glance('p2', 'silent', true);
    const sleepy = await glance('p3', 'silent', false);
    assert.deepEqual(thief.night, sleepy.night, 'the same dim call on both phones');
    assert.equal(thief.overlay, sleepy.overlay, 'the overlay is identical, word for word');
    assert.equal(thief.header, sleepy.header, 'and so is the top bar');
    assert.equal(thief.badge, 0, 'no 輪到你 pill on the awake phone');
    assert.equal(thief.night[0], true, 'the awake phone is dimmed too');
    assert.equal(thief.night[1].level, 'soft', 'a readable ~70 % dim, not the near-black one');
    assert.ok(thief.overlay.includes('夜 晚') && !thief.overlay.includes('閉 眼'), '靜音 never says 閉眼');
    assert.deepEqual(thief.cls.split(' ').sort(), ['night-dim', 'on', 'soft'], 'shown, soft, never opaque');

    // 語音 keeps today's behaviour: the called seat is lit, the others dark with 閉 眼
    const voiceAwake = await glance('p2', 'voice', true);
    const voiceAsleep = await glance('p3', 'voice', false);
    assert.equal(voiceAwake.night[0], false);
    assert.equal(voiceAsleep.night[0], true);
    assert.equal(voiceAsleep.night[1].level, 'dark');
    assert.ok(voiceAsleep.overlay.includes('閉 眼'));
  }));
});

test('ui D4: a dead phone\'s banner offers 💤 當佢缺席 (two taps) next to 代佢做 · 呢鋪唔計 · 再等; a connected, silent seat is listed in ⋯ only', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await playPhone(dom, clock, { st: { views: { p1: { phase: 'pick', title: '揀人' } }, room: { stalled: [{ pid: 'p2', since: 5 }] } } });
    const banner = () => findAll(ph.screen.el, (n) => n.cls.has('banner') && n.cls.has('stall'))[0];
    assert.ok(banner().textContent.includes('小美 斷咗線，成個遊戲等緊佢'));
    for (const label of ['代佢做', '💤 當佢缺席', '呢鋪唔計', '再等']) assert.ok(btnWith(banner(), label), label);
    tap(btnWith(banner(), '💤 當佢缺席'));
    assert.deepEqual(ph.calls, [], 'the first tap only arms');
    assert.ok(btnWith(banner(), '再㩒一次：當 小美 缺席？'));
    ph.screen.update(ph.st);
    assert.ok(btnWith(banner(), '再㩒一次：當 小美 缺席？'), 'a state update keeps the armed button');
    clock.advance(600);
    tap(btnWith(banner(), '再㩒一次：當 小美 缺席？'));
    assert.deepEqual(ph.calls, ['absent:p2']);
    assert.ok(ph.toastText().includes('💤 小美 缺席'));

    // #9: connected but silent — no banner (a long talk before a pick looks the same), but ⋯ lists it
    clock.advance(4000);
    Object.assign(ph.st.room, { stalled: [], idle: [{ pid: 'p3', since: 9 }] });   // app.state is what the screen reads
    ph.screen.update(ph.st);
    assert.equal(banner(), undefined, 'never shouts');
    ph.openMenu();
    assert.ok(ph.menu().textContent.includes('斷咗線 / 無反應'));
    tap(btnWith(ph.menu(), '🤖 代 大熊 做'));
    assert.ok(ph.calls.includes('auto:p3'));
    ph.openMenu();
    tap(btnWith(ph.menu(), '💤 當 大熊 缺席'));
    clock.advance(600);
    tap(btnWith(ph.menu(), '再㩒一次：當 大熊 缺席？'));
    assert.ok(ph.calls.includes('absent:p3'));
    ph.screen.destroy();

    // an engine without @absent: nothing changes, and the host is told
    const no = await playPhone(dom, clock, { st: { views: { p1: { phase: 'pick' } }, room: { stalled: [{ pid: 'p2', since: 5 }] } }, hostCtl: { markAbsent: () => false } });
    const b2 = findAll(no.screen.el, (n) => n.cls.has('stall'))[0];
    clock.advance(4000);
    tap(btnWith(b2, '💤 當佢缺席'));
    clock.advance(600);
    tap(btnWith(b2, '再㩒一次：當 小美 缺席？'));
    assert.ok(no.toastText().includes('而家標記唔到 小美 缺席'), no.toastText());
    no.screen.destroy();
  }));
});

test('ui D4: ⋯ → 💤 標記缺席… picks a seat in place (two taps, never a native dialog); an absent seat shows 👋 返咗嚟', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await playPhone(dom, clock, { st: { views: { p1: { phase: 'vote', title: '投票' } }, room: { absent: ['p3'] } } });
    ph.openMenu();
    tap(btnWith(ph.menu(), '💤 標記缺席…'));
    assert.ok(ph.menu().textContent.includes('💤 標記缺席'), 'the same sheet turns into the seat picker');
    assert.ok(btnWith(ph.menu(), '💤 阿明') && btnWith(ph.menu(), '💤 小美'));
    assert.ok(btnWith(ph.menu(), '👋 大熊 返咗嚟'), 'an absent seat can come back');
    assert.ok(!btnWith(ph.menu(), '💤 大熊'));
    tap(btnWith(ph.menu(), '💤 小美'));
    assert.deepEqual(ph.calls, []);
    ph.screen.update(ph.st);
    clock.advance(600);
    tap(btnWith(ph.menu(), '再㩒一次：當 小美 缺席？'));
    assert.deepEqual(ph.calls, ['absent:p2']);

    clock.advance(4000);
    ph.openMenu();
    tap(btnWith(ph.menu(), '💤 標記缺席…'));
    tap(btnWith(ph.menu(), '👋 大熊 返咗嚟'));
    assert.deepEqual(ph.calls, ['absent:p2', 'present:p3'], 'one tap: it only undoes 💤');
    assert.ok(ph.toastText().includes('👋 大熊 返咗嚟'));
    tap(btnWith(ph.menu(), '‹ 返回'));
    assert.ok(btnWith(ph.menu(), '🗑️ 呢輪作廢'), '‹ 返回 goes back to the main menu');

    // the connection list marks the absent seat
    assert.ok(findAll(ph.menu(), (n) => n.tag === 'li' && n.cls.has('absent'))[0]?.textContent.includes('💤 缺席'));
    ph.screen.destroy();

    // a guest's ⋯ has no 💤
    const guest = await playPhone(dom, clock, { seat: 'p2', st: { views: { p2: { phase: 'vote' } } } });
    guest.openMenu();
    assert.ok(!btnWith(guest.menu(), '💤 標記缺席…'));
    guest.screen.destroy();
  }));
});

test('ui #9: 呢輪作廢 says why not (engine.canVoid) without arming; ⏭ that changes nothing says so', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const msg = '呢輪已經計咗分，㩒「下一輪」就得';
    const ph = await playPhone(dom, clock, {
      st: { views: { p1: { phase: 'result', title: '結果' } } },
      hostCtl: { canVoid: () => ({ ok: false, message: msg }), next: () => { ph.calls.push('next'); return false; } },
    });
    ph.openMenu();
    tap(btnWith(ph.menu(), '🗑️ 呢輪作廢'));
    assert.equal(ph.toastText(), msg, 'the game\'s own reason, at once');
    assert.ok(!ph.calls.includes('void'), 'nothing sent');
    assert.ok(!findAll(fakeDocument.body, (n) => n.cls.has('armed')).length, 'nothing armed either');

    clock.advance(4000);
    ph.openMenu();
    tap(btnWith(ph.menu(), '⏭ 跳過呢步'));
    assert.deepEqual(ph.calls, ['next']);
    assert.ok(ph.toastText().startsWith('跳唔到呢步 — 要等人自己做'), `a skip that did nothing says so: ${ph.toastText()}`);
    clock.advance(4000);
    Object.assign(ph.st.room, { idle: [{ pid: 'p3', since: 1 }] });
    ph.screen.update(ph.st);
    ph.openMenu();
    tap(btnWith(ph.menu(), '⏭ 跳過呢步'));
    assert.ok(ph.toastText().includes('等緊 大熊'), `…and names the seat the table waits on: ${ph.toastText()}`);
    ph.screen.destroy();

    // no reason from the game and the void did nothing: the generic line
    const plain = await playPhone(dom, clock, { st: { views: { p1: { phase: 'x' } } }, hostCtl: { voidRound: () => false } });
    clock.advance(4000);
    plain.openMenu();
    tap(btnWith(plain.menu(), '🗑️ 呢輪作廢'));
    clock.advance(600);
    tap(btnWith(plain.menu(), '再㩒一次：呢輪作廢'));
    assert.equal(plain.toastText(), '呢個遊戲唔支援呢輪作廢');
    plain.screen.destroy();
  }));
});

test('ui #3: 📋 複製連結 — when the clipboard refuses, the link shows in the page, selected; no native prompt', async () => {
  await withDom(async ({ dom }) => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const savedPrompt = globalThis.prompt;
    globalThis.prompt = () => { throw new Error('a native prompt must never run'); };
    let refuse = true;
    let copied = null;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText: async (t) => { if (refuse) throw new Error('NotAllowedError'); copied = t; } } },
    });
    try {
      const box = dom.copyBox();
      fakeDocument.body.append(box.el);
      assert.equal(box.el.hidden, true, 'nothing until it is needed');
      assert.equal(await box.copy('https://example.test/?r=1352'), false);
      assert.equal(box.el.hidden, false);
      assert.equal(box.field.value, 'https://example.test/?r=1352');
      assert.equal(box.field.attrs.readonly, '', 'read-only: nobody edits it by accident');
      assert.ok(fakeDocument.getElementById('toast').textContent.includes('自動複製唔到'));
      refuse = false;
      assert.equal(await box.copy('https://example.test/?r=2461', '連結已複製'), true);
      assert.equal(copied, 'https://example.test/?r=2461');
      assert.equal(box.el.hidden, true, 'copied: the field goes away');
      assert.equal(fakeDocument.getElementById('toast').textContent, '連結已複製');
    } finally {
      if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator;
      if (savedPrompt === undefined) delete globalThis.prompt; else globalThis.prompt = savedPrompt;
    }
  });
});

// ============================================================
// one phone in the middle (docs/playtest/single/SUMMARY.md, DESIGN §7.1) — the shell side
// ============================================================

test('§7.1 logic: focusSig ignores `together`; walkOrder goes clockwise from the holder; gateSubtitle; narrationChoices (U1)', () => {
  assert.equal(focusSig(null), '');
  assert.equal(focusSig({ pids: ['p3', 'p2'] }), focusSig({ pids: ['p2', 'p3'], together: true }), 'other phones\' progress never re-gates');
  assert.notEqual(focusSig({ pids: ['p2'] }), focusSig({ pids: ['p2'], open: true }), 'open → private is a new step (#2)');
  assert.notEqual(focusSig({ pids: ['p2'], step: 'pick' }), focusSig({ pids: ['p2'], step: 'vote' }), 'a new step key for the same seat');
  assert.notEqual(focusSig({ pids: [], anonymous: 'a' }), focusSig({ pids: [], anonymous: 'b' }));

  const order = ['p1', 'p2', 'p3', 'p4', 'p5'];
  assert.deepEqual(walkOrder(['p1', 'p2', 'p3', 'p4', 'p5'], order, { from: 'p3' }), ['p3', 'p4', 'p5', 'p1', 'p2'], 'the holder first while called');
  assert.deepEqual(walkOrder(['p1', 'p2', 'p4', 'p5'], order, { from: 'p3' }), ['p4', 'p5', 'p1', 'p2'], 'then round the table');
  assert.deepEqual(walkOrder(['p5', 'p1'], order, {}), ['p1', 'p5'], 'nobody held it yet: seat order');
  assert.deepEqual(walkOrder(['p5', 'p1'], order, { from: 'p3', ordered: true }), ['p5', 'p1'], 'ordered keeps the engine order');
  assert.deepEqual(walkOrder(['p1', 'p2', 'p4'], order, { from: 'p1', deferred: ['p1'] }), ['p2', 'p4', 'p1'], '#18 a skipped seat goes last');

  assert.equal(gateSubtitle(), '其他人唔好望');
  assert.equal(gateSubtitle({ label: '第 1 輪投票', done: 2, total: 5 }), '其他人唔好望 · 第 1 輪投票 · 搞掂 2/5');
  assert.equal(gateSubtitle({ done: 0, total: 1 }), '其他人唔好望', 'a lone hand-over has no progress');

  const eyes = { narration: 'required' };
  assert.deepEqual(narrationChoices(eyes, { singleDevice: true }).modes, ['voice', 'read']);
  assert.match(narrationChoices(eyes, { singleDevice: true }).note, /要搵個唔玩嘅人讀/);
  assert.deepEqual(narrationChoices(eyes, { singleDevice: false }).modes, ['voice', 'read', 'silent'], 'phones of their own keep 靜音 (D1)');
  assert.deepEqual(narrationChoices({ narration: 'recommended', eyesClosed: true }, { singleDevice: true }).modes, ['voice', 'read']);
  assert.deepEqual(narrationChoices({ narration: 'optional' }, { singleDevice: true }).modes, ['voice', 'read', 'silent']);
});

test('§7.1 nightChrome: a shared phone in the middle at night is covered in every mode, with 「擺返中間」 words; single-seat phones unchanged', () => {
  for (const mode of ['voice', 'read', 'silent']) {
    const c = nightChrome({ seat: null, night: true, mode, shared: true, table: true });
    assert.equal(c.on, true);
    assert.equal(c.level, 'opaque');
    assert.equal(c.words, mode === 'silent' ? NIGHT_WORDS.middleOpen : NIGHT_WORDS.middle);
  }
  assert.equal(nightChrome({ seat: null, night: false, shared: true, table: true }).on, false, 'by day the table view is lit');
  assert.equal(nightChrome({ seat: 'p2', night: true, inFocus: false, mode: 'voice', shared: true }).words, NIGHT_WORDS.middle);
  assert.deepEqual(nightChrome({ seat: 'p2', night: true, inFocus: false, mode: 'voice' }), { on: true, level: 'dark', words: NIGHT_WORDS.closed }, 'a phone of your own: as before');
  assert.ok(!NIGHT_WORDS.middle.title.includes('你') && !NIGHT_WORDS.middle.hint.includes('你'));
});

test('§7.1 PassGate kinds: data-gate, a public card that keeps the screen visible, the escape row; opaque from frame one (#34)', async () => {
  await withDom(async () => withRaf(async () => {
    const { PassGate } = await import('../js/ui/components/PassGate.js?v=1');
    const gateEl = () => findAll(fakeDocument.body, (n) => n.cls.has('c-passgate'))[0];
    let done = false;
    PassGate.show({ title: '交俾 阿明', subtitle: '其他人唔好望' }).then(() => { done = true; });
    assert.equal(gateEl().attrs['data-gate'], 'private');
    assert.ok(!gateEl().cls.has('is-public'));
    assert.ok(gateEl().textContent.includes('🔒'));
    assert.equal(PassGate.kind(), 'private');
    PassGate.show({ title: '輪到 小美', subtitle: '大家一齊睇', kind: 'public', extra: Object.assign(new FEl('div'), {}) });
    await Promise.resolve();
    assert.equal(done, true, 'a new gate replaces (and resolves) the old one');
    assert.equal(findAll(fakeDocument.body, (n) => n.cls.has('c-passgate')).length, 1, 'never two');
    assert.ok(gateEl().cls.has('is-public'));
    assert.equal(gateEl().attrs['data-gate'], 'public');
    assert.ok(!gateEl().textContent.includes('🔒'));
    PassGate.show({ title: '狼人請醒', kind: 'anon' });
    assert.equal(gateEl().attrs['data-gate'], 'anon');
    PassGate.show({ title: 'x', kind: 'nonsense' });
    assert.equal(gateEl().attrs['data-gate'], 'private', 'an unknown kind is the safe one');
    PassGate.hide();
    assert.equal(PassGate.isOpen(), false);
    assert.equal(PassGate.kind(), null);
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'css', 'base.css'), 'utf8');
    const rule = css.slice(css.indexOf('.c-passgate {'), css.indexOf('}', css.indexOf('.c-passgate {')));
    assert.ok(!/opacity:\s*0/.test(rule), '#34: the backdrop is not faded in');
    assert.ok(/\.c-passgate\.in \.c-passgate-card/.test(css), 'only the card fades');
  }));
});

test('§7.1 NarratorBar: `modes` hides 靜音 (U1); `hideSkip` drops the ghost ⏭ but keeps the 讀稿 下一步 (#35)', async () => {
  await withDom(async ({ NarratorBar }) => {
    const bar = NarratorBar({ cue: { id: 'c', text: '天黑請閉眼' }, mode: 'voice', onNext() {}, onMode() {}, modes: ['voice', 'read'], hideSkip: true });
    fakeDocument.body.append(bar.el);
    const modeBtn = (m) => findAll(bar.el, (n) => n.attrs['data-mode'] === m)[0];
    assert.equal(modeBtn('silent').hidden, true);
    assert.equal(modeBtn('read').hidden, false);
    const next = () => findAll(bar.el, (n) => n.cls.has('c-narratorbar-next'))[0];
    assert.equal(next().hidden, true, 'no ghost skip on a whole-table phone');
    bar.update({ cue: { id: 'c', text: '天黑請閉眼' }, mode: 'read', onNext() {}, onMode() {}, hideSkip: true });
    assert.equal(next().hidden, false, 'the 讀稿 narrator still moves the table on');
    assert.equal(modeBtn('silent').hidden, false, 'no `modes`: all three');
    bar.destroy();
  });
});

test('§7.1 #20 SeatEditor: 「（你）」 only on a phone of your own', async () => {
  await withDom(async () => {
    const { SeatEditor } = await import('../js/ui/components/SeatEditor.js?v=1');
    const players = [{ id: 'p1', name: '阿明', seat: 0, color: '#111' }, { id: 'p2', name: '小美', seat: 1, color: '#222' }];
    const one = SeatEditor({ players, me: 'p1', isHost: true, onMove() {}, onColor() {}, onKick() {} });
    assert.ok(one.el.textContent.includes('阿明（你）'));
    const shared = SeatEditor({ players, me: 'p1', mySeats: ['p1', 'p2'], isHost: true, onMove() {}, onColor() {}, onKick() {} });
    assert.ok(!shared.el.textContent.includes('（你）'), 'a shared phone is read by everybody');
    one.destroy(); shared.destroy();
  });
});

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

/**
 * The play screen on ONE shared phone (call inside withDom + withRaf). Every seat is on this phone (a whole-table
 * phone unless `room.singleDevice: false`). setActiveSeat changes the state at once, like the real app; `up(patch)`
 * applies a state patch and re-renders. The game UI records every mount (its api) and every update (view, ctx).
 */
async function sharedPhone(dom, clock, { st: patch = {}, hostCtl = {}, meta = {}, seats = ['p1', 'p2', 'p3', 'p4'] } = {}) {
  const { mountPlay } = await import('../js/ui/screens/play.js?v=1');
  const { PassGate } = await import('../js/ui/components/PassGate.js?v=1');
  const calls = [];
  const acts = [];
  const mounts = [];
  const ambient = [];
  const players = [
    { id: 'p1', name: '阿明', seat: 0, color: '#111', connected: true },
    { id: 'p2', name: '小美', seat: 1, color: '#222', connected: true },
    { id: 'p3', name: '大熊', seat: 2, color: '#333', connected: true },
    { id: 'p4', name: '阿珍', seat: 3, color: '#444', connected: true },
  ];
  const room = { phase: 'playing', gameId: 'g', players, paused: false, narration: { mode: 'voice' }, stalled: [], idle: [], absent: [], singleDevice: true };
  const dayViews = () => Object.fromEntries(seats.map((pid) => [pid, { phase: 'day', title: '日頭', me: pid, secret: `秘密-${pid}` }]));
  const st = {
    mode: 'local', isHost: true, mySeats: seats, activeSeat: null, conn: 'online',
    views: dayViews(), table: { phase: 'day', title: '枱中間' }, focus: null, cue: null, waiting: false, hostActions: [],
    ...patch,
    room: { ...room, ...(patch.room ?? {}) },
  };
  const app = {
    state: st,
    hostCtl: {
      next: () => true, voidRound: () => true, pause() {}, resume() {},
      autoAct: (pid) => { calls.push(`auto:${pid}`); return true; },
      markAbsent: (pid) => { calls.push(`absent:${pid}`); return true; },
      markPresent: () => true,
      holdClock: (on) => { calls.push(`hold:${on}`); return true; },
      ...hostCtl,
    },
    narration: { setMode() {} },
    act: (pid, action) => { acts.push({ pid, action }); return Promise.resolve(true); },
    ink() {}, clock: { now: () => clock.t },
    setActiveSeat(pid) {
      if (pid === null ? st.mySeats.length < 2 : !st.mySeats.includes(pid)) return;
      st.activeSeat = pid;
    },
  };
  const game = {
    meta: { id: 'g', name: '測試', ...meta },
    ui: {
      mount: (root, api) => {
        const m = { api, updates: [], destroyed: false };
        mounts.push(m);
        return { update: (view, ctx) => m.updates.push({ view, ctx }), destroy() { m.destroyed = true; } };
      },
    },
  };
  const sh = {
    app, narrator: { cancel() {}, prime() {}, speak() {} }, cameFrom: null,
    timer: { button: () => new FEl('button'), strip: () => new FEl('div'), available: () => false, open() {}, openBig() {} },
    soundButton: () => new FEl('button'),
    sound: { isOn: () => true, toggle() {}, night() {}, ambient: (on) => ambient.push(on) },
    gameMeta: () => ({ id: 'g', name: '測試', emoji: '🧪', narration: 'optional', ...meta }),
    cached: () => game, loadGame: async () => game,
    confirm: (text, node = null, opts = {}) => dom.confirmTap(text, { node, ...opts }),
    leave: () => false,
  };
  const screen = mountPlay(sh);
  fakeDocument.body.append(screen.el);
  const render = async () => { screen.update(st); await settle(); screen.update(st); await settle(); };
  const up = async (p = {}) => {
    const { room: r, ...rest } = p;
    Object.assign(st, rest);
    if (r) Object.assign(st.room, r);
    await render();
  };
  const gateEl = () => findAll(fakeDocument.body, (n) => n.cls.has('c-passgate'))[0] ?? null;
  const gateKind = () => gateEl()?.attrs['data-gate'] ?? null;
  const gateText = () => gateEl()?.textContent ?? '';
  const tapGate = async () => {
    const b = findAll(gateEl(), (n) => n.tag === 'button' && n.cls.has('btn-primary'))[0];
    tap(b);
    await settle();
    await render();
  };
  const live = () => mounts.filter((m) => !m.destroyed).at(-1) ?? null;
  const ctx = () => live()?.updates.at(-1)?.ctx ?? null;
  const viewNow = () => live()?.updates.at(-1)?.view ?? null;
  const chip = () => findAll(screen.el, (n) => n.cls.has('seat-chip'))[0];
  const home = () => findAll(screen.el, (n) => n.cls.has('seat-home'))[0];
  const menu = () => findAll(fakeDocument.body, (n) => n.cls.has('menu-sheet')).at(-1);
  const destroy = () => { screen.destroy(); PassGate.hide(); };
  await render();
  return { screen, st, app, calls, acts, mounts, ambient, up, render, gateEl, gateKind, gateText, tapGate, live, ctx, viewNow, chip, home, menu, destroy };
}

test('§7.1 #1: a shared phone starts in the middle — the public table view, api.me null, 「📱 枱中間」; a pick of your name goes through a gate', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await sharedPhone(dom, clock, { st: { activeSeat: 'p3' } });   // a stale seat from before
    assert.equal(ph.st.activeSeat, null, 'never a seat\'s private screen without a gate');
    assert.equal(ph.live().api.me, null);
    assert.equal(ph.live().api.atTable, true);
    assert.equal(ph.live().api.shared, true);
    assert.equal(ph.live().api.wholeTable, true);
    assert.deepEqual(ph.live().api.mySeats, ['p1', 'p2', 'p3', 'p4']);
    assert.equal(ph.viewNow().title, '枱中間', 'the table view, nothing private');
    assert.equal(ph.ctx().atTable, true);
    assert.ok(ph.chip().textContent.includes('📱 枱中間 — 㩒你個名睇自己'));
    assert.ok(ph.chip().cls.has('at-table'));
    assert.equal(ph.home().hidden, true);
    // api.send at the table does nothing but say how
    ph.live().api.send({ type: 'x' });
    assert.equal(ph.acts.length, 0);
    assert.ok(fakeDocument.getElementById('toast').textContent.includes('部手機喺枱中間'));
    // 㩒你個名 → the private gate → that seat (hand-picked)
    tap(ph.chip());
    assert.ok(ph.menu().textContent.includes('邊個要睇自己？'));
    tap(btnWith(ph.menu(), '大熊'));
    await ph.render();
    assert.equal(ph.gateKind(), 'switch');
    assert.ok(ph.gateText().includes('交俾 大熊') && ph.gateText().includes('其他人唔好望'));
    assert.equal(ph.st.activeSeat, null, 'nothing changes until 大熊 taps');
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, 'p3');
    assert.equal(ph.live().api.me, 'p3');
    assert.ok(ph.chip().textContent.includes('而家睇：大熊'));
    assert.equal(ph.home().hidden, false, '📱 擺返中間 beside the chip');
    // back to the middle: the public table card, whole-table taps locked until it is tapped (U5)
    tap(ph.home());
    await ph.render();
    assert.equal(ph.st.activeSeat, null);
    assert.equal(ph.gateKind(), 'table');
    assert.ok(ph.gateEl().cls.has('is-public'));
    assert.equal(ph.ctx().tableLocked, true);
    assert.equal(ph.live().api.tableSend({ type: 'seen' }), false, 'locked behind the card');
    assert.equal(ph.acts.length, 0);
    await ph.tapGate();
    assert.equal(ph.gateEl(), null);
    assert.equal(ph.ctx().tableLocked, false);
    ph.live().api.tableSend({ type: 'seen' });
    assert.deepEqual(ph.acts.at(-1), { pid: 'p1', action: { type: 'seen', seats: ['p1', 'p2', 'p3', 'p4'], table: true } }, '#5: one tap for the whole table');
    ph.destroy();
  }));
});

test('§7.1 #2 #17 #33: private steps gate every time (also the seat on screen); walks go clockwise from the holder with progress; the focus leaving sends the phone to the middle (U4)', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await sharedPhone(dom, clock);
    // a hand-picked seat first (大熊, p3), then the vote calls everybody
    tap(ph.chip()); tap(btnWith(ph.menu(), '大熊')); await ph.render(); await ph.tapGate();
    await ph.up({ focus: { pids: ['p1', 'p2', 'p3', 'p4'], together: true, label: '第 1 輪投票' } });
    assert.equal(ph.gateKind(), 'private');
    assert.ok(ph.gateText().includes('交俾 大熊'), `#2 + #17: the holder first, gated although on screen: ${ph.gateText()}`);
    assert.ok(ph.gateText().includes('其他人唔好望 · 第 1 輪投票 · 搞掂 0/4'), ph.gateText());
    assert.equal(ph.st.activeSeat, null, 'behind the gate lies the table view');
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, 'p3');
    await ph.up({ focus: { pids: ['p1', 'p2', 'p4'], together: true, label: '第 1 輪投票' } });
    assert.ok(ph.gateText().includes('交俾 阿珍'), `clockwise: 大熊 → 阿珍: ${ph.gateText()}`);
    assert.ok(ph.gateText().includes('搞掂 1/4'));
    await ph.tapGate();
    await ph.up({ focus: { pids: ['p1', 'p2'], together: true, label: '第 1 輪投票' } });
    assert.ok(ph.gateText().includes('交俾 阿明'), 'then round to seat 1');
    await ph.tapGate();
    await ph.up({ focus: { pids: ['p2'], label: '第 1 輪投票' } });
    assert.ok(ph.gateText().includes('交俾 小美') && ph.gateText().includes('搞掂 3/4'), ph.gateText());
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, 'p2');
    // the same step for the same seat again: no new gate; a NEW step for her: gated again (#2)
    await ph.up({ focus: { pids: ['p2'], label: '第 1 輪投票' } });
    assert.equal(ph.gateEl(), null);
    await ph.up({ focus: { pids: ['p2'], step: 'quest' } });
    assert.equal(ph.gateKind(), 'private', 'voted → quest for the same seat: a new private step');
    await ph.tapGate();
    // the focus leaves this phone by day → to the middle behind the table card
    await ph.up({ focus: null });
    assert.equal(ph.st.activeSeat, null);
    assert.equal(ph.gateKind(), 'table');
    assert.ok(ph.gateText().includes('部手機擺返中間'));
    assert.ok(!ph.gateText().includes('其他人唔好望'));
    ph.destroy();
  }));
});

test('§7.1 #4: a public one-person step gets the light card (no 「其他人唔好望」, the screen stays visible); open → private gates again', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await sharedPhone(dom, clock);
    await ph.up({ focus: { pids: ['p2'], open: true, label: '畫一筆', step: 'stroke:1' } });
    assert.equal(ph.gateKind(), 'public');
    assert.ok(ph.gateEl().cls.has('is-public'));
    assert.ok(ph.gateText().includes('輪到 小美 · 畫一筆'), ph.gateText());
    assert.ok(ph.gateText().includes('大家一齊睇'));
    assert.ok(!ph.gateText().includes('其他人唔好望') && !ph.gateText().includes('🔒'));
    assert.equal(ph.viewNow().title, '枱中間', 'the public table view behind it');
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, 'p2');
    await ph.up({ focus: { pids: ['p3'], open: true, label: '畫一筆', step: 'stroke:2' } });
    assert.ok(ph.gateText().includes('輪到 大熊'));
    await ph.tapGate();
    await ph.up({ focus: { pids: ['p3'], step: 'vote' } });
    assert.equal(ph.gateKind(), 'private', 'from a public step into a private one: gated');
    ph.destroy();
  }));
});

test('§7.1 #9: a hand-picked seat keeps the phone while the step is the same — no bounce; the step moving on takes it back', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await sharedPhone(dom, clock, { st: { focus: { pids: ['p1'] } } });
    assert.ok(ph.gateText().includes('交俾 阿明'));
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, 'p1');
    // 阿明 (the 諗樣) lets 小美 check her role
    tap(ph.chip());
    tap(btnWith(ph.menu(), '小美'));
    await ph.render();
    assert.equal(ph.gateKind(), 'switch');
    await ph.up({ cue: { id: 'tick' } });                      // any state change meanwhile
    assert.equal(ph.gateKind(), 'switch', 'the hand-picked gate is not replaced by 阿明\'s');
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, 'p2');
    await ph.up({ cue: { id: 'tick2' } });
    assert.equal(ph.st.activeSeat, 'p2', 'no bounce back to 阿明');
    assert.equal(ph.gateEl(), null);
    // 小美 hands it back by hand: no extra gate for 阿明 after that
    tap(ph.chip()); tap(btnWith(ph.menu(), '阿明')); await ph.render(); await ph.tapGate();
    await ph.up({ cue: { id: 'tick3' } });
    assert.equal(ph.st.activeSeat, 'p1');
    assert.equal(ph.gateEl(), null);
    // the step moves on to somebody else: the gate goes to them
    await ph.up({ focus: { pids: ['p4'] } });
    assert.ok(ph.gateText().includes('交俾 阿珍'));
    ph.destroy();
  }));
});

test('§7.1 U2 + #1: the night — one gate per eyes-closed step, co-wakers on ONE combined screen, chip disabled; dawn opens the same 天光 card whoever acted', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const nightViews = (seats) => Object.fromEntries(seats.map((pid) => [pid, { phase: 'night', night: true, title: '夜晚', me: pid }]));
    const run = async (wolves) => {
      const ph = await sharedPhone(dom, clock, { st: { views: nightViews(['p1', 'p2', 'p3', 'p4']), table: { phase: 'night', night: true, title: '夜晚' } } });
      assert.ok(ph.chip().disabled, 'at night the chip cannot be tapped');
      assert.ok(ph.chip().textContent.includes('🌙') && !ph.chip().textContent.includes('阿明'));
      await ph.up({ focus: { pids: wolves, anonymous: '狼人請醒' } });
      assert.equal(ph.gateKind(), 'anon');
      assert.ok(ph.gateText().includes('狼人請醒') && ph.gateText().includes('其他人閉埋眼'));
      assert.ok(!['阿明', '小美', '大熊', '阿珍'].some((n) => ph.gateText().includes(n)), 'never a name');
      assert.ok(ph.chip().textContent.includes('🤫 而家係秘密步驟'));
      await ph.tapGate();
      assert.equal(ph.st.activeSeat, wolves[0], 'the first called seat is mounted');
      assert.equal(ph.gateEl(), null, 'ONE gate for both wolves: no chained walk');
      assert.deepEqual(ph.ctx().coWakers, wolves);
      assert.deepEqual(Object.keys(ph.ctx().views), wolves, 'their own views, this phone\'s seats only');
      // an action as the other wolf
      ph.live().api.sendAs(wolves[1], { type: 'kill', target: 'p4' });
      assert.deepEqual(ph.acts.at(-1), { pid: wolves[1], action: { type: 'kill', target: 'p4' } });
      const sleeper = ['p1', 'p2', 'p3', 'p4'].find((pid) => !wolves.includes(pid));
      assert.equal(ph.live().api.sendAs(sleeper, { type: 'kill' }), false, 'never as a seat that is not awake');
      // the engine drops the mounted wolf (done): the other stays awake on the same screen, no new gate
      await ph.up({ focus: { pids: [wolves[1]], anonymous: '狼人請醒' } });
      assert.equal(ph.st.activeSeat, wolves[1]);
      assert.equal(ph.gateEl(), null);
      // the next step calls nobody here: a decoy gate, the phone back in the middle under the dim
      await ph.up({ focus: { pids: [], anonymous: '預言家請醒' } });
      assert.equal(ph.st.activeSeat, null);
      assert.equal(ph.gateKind(), 'anon', 'the decoy looks the same');
      await ph.tapGate();
      assert.equal(ph.st.activeSeat, null, 'tapping a decoy changes nothing');
      // dawn
      await ph.up({ focus: null, views: Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((pid) => [pid, { phase: 'day', title: '天光', me: pid }])), table: { phase: 'day', title: '天光' } });
      const dawn = { holder: ph.st.activeSeat, gate: ph.gateKind(), text: ph.gateText(), chip: ph.chip().textContent };
      ph.destroy();
      return dawn;
    };
    const a = await run(['p1', 'p3']);
    const b = await run(['p2', 'p4']);
    assert.deepEqual(a, b, 'the dawn holder, card and chip are the same for every role assignment');
    assert.equal(a.holder, null);
    assert.equal(a.gate, 'table');
    assert.ok(a.text.includes('天光喇'));
    assert.ok(a.chip.includes('📱 枱中間'));
  }));
});

test('§7.1: after an eyes-closed step by day (avalon\'s Assassin) every shared phone shows the same table card — the called seat\'s phone and a decoy phone alike', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const run = async (called) => {
      const ph = await sharedPhone(dom, clock, { seats: ['p1', 'p2'], st: { room: { singleDevice: false } } });
      await ph.up({ focus: { pids: called, anonymous: '刺客請拎起部手機' } });
      assert.equal(ph.gateKind(), 'anon');
      await ph.tapGate();
      await ph.up({ focus: null });
      const out = { holder: ph.st.activeSeat, gate: ph.gateKind(), text: ph.gateText(), chip: ph.chip().textContent };
      ph.destroy();
      return out;
    };
    const real = await run(['p2']);
    const decoy = await run([]);
    assert.deepEqual(real, decoy, 'nothing on this phone says whether the Assassin sat here');
    assert.equal(real.holder, null);
    assert.equal(real.gate, 'table');
  }));
});

test('§7.1 #18: the host\'s 「X 唔喺度？」 on a named gate — skip them in this walk, 💤 (two taps), 代佢做 (two taps); never on an eyes-closed gate', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await sharedPhone(dom, clock, { st: { focus: { pids: ['p1', 'p2', 'p3'], together: true } } });
    assert.ok(ph.gateText().includes('交俾 阿明'));
    const esc = () => findAll(ph.gateEl(), (n) => n.cls.has('c-passgate-escape'))[0];
    assert.ok(esc(), 'the host device gets the escape');
    const acts = () => findAll(esc(), (n) => n.cls.has('c-passgate-escape-acts'))[0];
    assert.equal(acts().hidden, true, 'quiet until asked');
    tap(btnWith(esc(), '阿明 唔喺度？'));
    assert.equal(acts().hidden, false);
    tap(btnWith(esc(), '⏭ 跳過佢（交俾 小美）'));
    await ph.render();
    assert.ok(ph.gateText().includes('交俾 小美'), '阿明 goes to the end of this walk');
    await ph.tapGate();
    await ph.up({ focus: { pids: ['p1', 'p3'], together: true } });
    assert.ok(ph.gateText().includes('交俾 大熊'), `still after the others: ${ph.gateText()}`);
    await ph.tapGate();
    await ph.up({ focus: { pids: ['p1'], together: true } });
    assert.ok(ph.gateText().includes('交俾 阿明'), 'and finally back to 阿明');
    tap(btnWith(esc(), '阿明 唔喺度？'));
    assert.equal(btnWith(esc(), '⏭ 跳過佢'), undefined, 'nobody left to skip to');
    tap(btnWith(esc(), '💤 當佢缺席'));
    assert.deepEqual(ph.calls.filter((c) => c.startsWith('absent')), [], 'two taps');
    clock.advance(600);
    tap(btnWith(esc(), '再㩒一次：當 阿明 缺席？'));
    assert.ok(ph.calls.includes('absent:p1'));
    clock.advance(4000);
    tap(btnWith(esc(), '🤖 代佢做'));
    clock.advance(600);
    tap(btnWith(esc(), '再㩒一次：代 阿明 做？'));
    assert.ok(ph.calls.includes('auto:p1'));
    // an eyes-closed gate never carries it
    await ph.up({ focus: { pids: ['p2'], anonymous: '預言家請醒' } });
    assert.equal(ph.gateKind(), 'anon');
    assert.equal(findAll(ph.gateEl(), (n) => n.cls.has('c-passgate-escape')).length, 0);
    ph.destroy();
  }));
});

test('§7.1 U3 askWho: anyone taps, picks their own name → gate → their screen with ctx.asked; 取消 resolves null', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await sharedPhone(dom, clock, { st: { room: { absent: ['p4'] } } });
    let got = 'pending';
    ph.live().api.askWho({ key: 'stop', title: '邊個要停鐘？' }).then((v) => { got = v; });
    assert.ok(ph.menu().textContent.includes('邊個要停鐘？'));
    assert.ok(btnWith(ph.menu(), '大熊'));
    assert.equal(btnWith(ph.menu(), '阿珍'), undefined, 'an absent seat is not offered');
    tap(btnWith(ph.menu(), '大熊'));
    await ph.render();
    assert.equal(ph.gateKind(), 'switch');
    assert.equal(got, 'pending');
    await ph.tapGate();
    assert.equal(got, 'p3');
    assert.equal(ph.st.activeSeat, 'p3');
    assert.deepEqual(ph.ctx().asked, { key: 'stop', pid: 'p3' });
    // the game puts it back: ctx.asked is gone with the hand-over
    ph.live().api.toTable({ card: false });
    await ph.render();
    assert.equal(ph.st.activeSeat, null);
    assert.equal(ph.gateEl(), null, 'card: false → no table card');
    assert.equal(ph.ctx().asked, null);
    let again = 'pending';
    ph.live().api.askWho({ key: 'word', title: '邊個睇返個詞？' }).then((v) => { again = v; });
    tap(btnWith(ph.menu(), '取消'));
    await settle();
    assert.equal(again, null);
    // a second askWho while the first sheet is still open: the first gets null, the second is the live one
    let first = 'pending';
    let second = 'pending';
    ph.live().api.askWho({ key: 'a', title: '第一個？' }).then((v) => { first = v; });
    ph.live().api.askWho({ key: 'b', title: '第二個？' }).then((v) => { second = v; });
    await settle();
    assert.equal(first, null);
    assert.equal(second, 'pending', 'the new request is not answered by closing the old sheet');
    assert.ok(ph.menu().textContent.includes('第二個？'));
    tap(btnWith(ph.menu(), '小美'));
    await ph.render();
    await ph.tapGate();
    assert.equal(second, 'p2');
    assert.deepEqual(ph.ctx().asked, { key: 'b', pid: 'p2' });
    ph.destroy();
  }));
});

test('§7.1 U10: a `hold: true` step holds the clock while its gate is unanswered on a whole-table phone — and only there', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await sharedPhone(dom, clock);
    await ph.up({ focus: { pids: ['p2'], hold: true } });
    assert.deepEqual(ph.calls, ['hold:true']);
    await ph.tapGate();
    assert.deepEqual(ph.calls, ['hold:true', 'hold:false'], 'released the moment the gate is tapped');
    await ph.up({ focus: { pids: ['p3'] } });
    assert.deepEqual(ph.calls, ['hold:true', 'hold:false'], 'a step without hold never holds');
    ph.destroy();
    // two phones (not a whole-table phone): never
    const multi = await sharedPhone(dom, clock, { st: { room: { singleDevice: false } } });
    await multi.up({ focus: { pids: ['p2'], hold: true } });
    assert.equal(multi.gateKind(), 'private');
    assert.deepEqual(multi.calls, []);
    multi.destroy();
  }));
});

test('§7.1 #20 #35 U1 U8: no 輪到你 on a shared phone; ⋯ and the bar offer no 靜音 for an eyes-closed night; the night bed follows meta.nightAmbient', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await sharedPhone(dom, clock, { meta: { narration: 'required', nightAmbient: true }, st: { cue: { id: 'c', text: '天黑' }, focus: { pids: ['p2'] } } });
    await ph.tapGate();
    assert.equal(findAll(ph.screen.el, (n) => n.cls.has('turn-badge')).length, 0, 'the gate said whose turn it is');
    // the vote / seat pickers a game gets on a shared phone never print 「（你）」
    const { VotePanel, PlayerPicker } = ph.live().api.components;
    const people = ph.st.room.players;
    const vp = VotePanel({ players: people, candidates: ['p1', 'p2'], me: 'p2', progress: { done: 0, total: 4 }, onVote() {} });
    vp.update({ players: people, candidates: ['p1', 'p2'], me: 'p2', progress: { done: 1, total: 4 }, onVote() {} });
    const pp = PlayerPicker({ players: people, me: 'p2', count: 1 });
    assert.ok(vp.el.textContent.includes('小美') && !vp.el.textContent.includes('（你）'), vp.el.textContent);
    assert.ok(!pp.el.textContent.includes('（你）'));
    vp.destroy(); pp.destroy();
    tap(findAll(ph.screen.el, (n) => n.attrs['aria-label'] === '選項')[0]);
    assert.ok(btnWith(ph.menu(), '🔊 語音') && btnWith(ph.menu(), '📜 讀稿'));
    assert.equal(btnWith(ph.menu(), '🔇 靜音'), undefined, 'U1');
    const bar = findAll(ph.screen.el, (n) => n.cls.has('c-narratorbar'))[0];
    assert.equal(findAll(bar, (n) => n.attrs['data-mode'] === 'silent')[0].hidden, true);
    assert.equal(findAll(bar, (n) => n.cls.has('c-narratorbar-next'))[0].hidden, true, '#35: ⏭ only in ⋯ on a whole-table phone');
    assert.deepEqual(ph.ambient, [], 'no bed by day');
    await ph.up({ focus: { pids: [], anonymous: '狼人請醒' }, table: { phase: 'night', night: true } });
    assert.deepEqual(ph.ambient, [true], 'all night on a shared phone');
    await ph.up({ focus: { pids: [], anonymous: '預言家請醒' } });
    assert.deepEqual(ph.ambient, [true], 'the same at every step');
    await ph.up({ room: { narration: { mode: 'silent' } } });
    assert.deepEqual(ph.ambient, [true, false], 'never in 靜音');
    ph.destroy();
  }));
});

test('§7.1: a single-seat phone is untouched — no gates, no table mode, no table taps', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await sharedPhone(dom, clock, { seats: ['p2'], st: { activeSeat: 'p2', mode: 'host', isHost: false, room: { singleDevice: false } } });
    await ph.up({ focus: { pids: ['p2'], open: true } });
    assert.equal(ph.gateEl(), null);
    assert.equal(ph.st.activeSeat, 'p2');
    assert.equal(ph.live().api.shared, false);
    assert.equal(ph.live().api.tableSend({ type: 'x' }), false);
    assert.equal(ph.live().api.handTo('p2'), false);
    assert.equal(findAll(ph.screen.el, (n) => n.cls.has('turn-badge')).length, 1, '輪到你 as before');
    const pp = ph.live().api.components.PlayerPicker({ players: ph.st.room.players, me: 'p2', count: 1 });
    assert.ok(pp.el.textContent.includes('小美（你）'), 'a phone of your own keeps 「（你）」');
    pp.destroy();
    await ph.up({ focus: null });
    assert.equal(ph.st.activeSeat, 'p2', 'no table mode');
    assert.equal(ph.gateEl(), null);
    ph.destroy();
  }));
});

test('§7.1 #3 api.handTo: a game hands the phone on (private, or public with open); refused at night, for a seat elsewhere, and on a phone of your own', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await sharedPhone(dom, clock);
    tap(ph.chip()); tap(btnWith(ph.menu(), '阿明')); await ph.render(); await ph.tapGate();
    assert.equal(ph.live().api.handTo('p2', { why: '搖骰' }), true);
    await ph.render();
    assert.equal(ph.gateKind(), 'switch');
    assert.ok(ph.gateText().includes('交俾 小美') && ph.gateText().includes('其他人唔好望 · 搖骰'), ph.gateText());
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, 'p2');
    await ph.up({ cue: { id: 'x' } });
    assert.equal(ph.st.activeSeat, 'p2', 'it holds (#9)');
    assert.equal(ph.live().api.handTo('p3', { open: true }), true);
    await ph.render();
    assert.equal(ph.gateKind(), 'public');
    assert.ok(ph.gateText().includes('輪到 大熊'));
    await ph.tapGate();
    assert.equal(ph.live().api.handTo('p9'), false, 'not a seat of this phone');
    await ph.up({ table: { phase: 'night', night: true } });
    assert.equal(ph.live()?.api.handTo('p1') ?? false, false, 'never at night');
    ph.destroy();
  }));
});

test('§7.1 #9: a NAMED step at night still never puts a name on the card', async () => {
  await withDom(async ({ dom }, clock) => withRaf(async () => {
    const ph = await sharedPhone(dom, clock, { st: { table: { phase: 'night', night: true } } });
    await ph.up({ focus: { pids: ['p3'] } });
    assert.equal(ph.gateKind(), 'private');
    assert.ok(!ph.gateText().includes('大熊'), ph.gateText());
    assert.ok(ph.gateText().includes('其他人閉埋眼'));
    assert.equal(findAll(ph.gateEl(), (n) => n.cls.has('c-passgate-escape')).length, 0, 'no 「大熊 唔喺度？」 either');
    await ph.tapGate();
    assert.equal(ph.st.activeSeat, 'p3');
    ph.destroy();
  }));
});

test('§7.1 U1 lobby: one phone + an eyes-closed night hides 🔇 靜音 and says 讀稿 needs a non-player; phones of their own keep it', async () => {
  await withDom(async ({ dom }) => withRaf(async () => {
    const { mountLobby } = await import('../js/ui/screens/lobby.js?v=1');
    const players = [{ id: 'p1', name: '阿明', seat: 0, color: '#111', connected: true, deviceId: 'd' }, { id: 'p2', name: '小美', seat: 1, color: '#222', connected: true, deviceId: 'd' }];
    const meta = { id: 'night', name: '夜', emoji: '🌙', players: [2, 8], minutes: [5, 10], narration: 'required', singleDevice: 'full', blurb: '' };
    const game = { meta, rules: { quick: [], roles: [], sections: [] }, config: { fields: () => [], summary: () => [] } };
    const room = {
      phase: 'lobby', gameId: 'night', players, config: {}, configSummary: [], configValid: { ok: true, message: '', warnings: [] },
      scoreboard: {}, history: [], narration: { mode: 'voice' }, singleDevice: true, stalled: [], idle: [], absent: [], claims: [],
    };
    const st = { mode: 'local', isHost: true, code: null, mySeats: ['p1', 'p2'], activeSeat: null, room };
    const app = {
      state: st, prefs: { get: () => null, set() {} }, bag: { stats: () => null },
      lobby: new Proxy({}, { get: () => () => ({ ok: true }) }), narration: { setMode() {} },
    };
    const narrator = {
      cancel() {}, prime() {}, test() {}, set() {}, voices: () => [], hasCantonese: () => true, supported: true,
      settings: { voiceURI: null, rate: 1 }, onVoices: () => () => {},
    };
    const sh = {
      app, narrator, catalog: [{ id: 'night', meta, ready: true }],
      gameMeta: () => meta, cached: () => game, loadGame: async () => game, gamesById: () => ({ night: meta }),
      confirm: (text, node, opts) => dom.confirmTap(text, { node, ...opts }), leave: () => false, rerender() {},
      openPreflight() {}, roomLink: () => '', saveNarration() {}, savedGroup: () => null,
      settingsButton: () => new FEl('button'), soundButton: () => new FEl('button'),
      timer: { button: () => new FEl('button'), strip: () => new FEl('div') },
    };
    const lobby = mountLobby(sh);
    fakeDocument.body.append(lobby.el);
    lobby.update(st);
    const seg = () => findAll(lobby.el, (n) => n.attrs['aria-label'] === '旁白方式')[0];
    const modeBtn = (m) => findAll(seg(), (n) => n.attrs['data-mode'] === m)[0];
    assert.equal(modeBtn('silent').hidden, true, 'no 靜音 when nobody could hear their call');
    assert.equal(modeBtn('read').hidden, false);
    assert.ok(lobby.el.textContent.includes('要搵個唔玩嘅人讀'), 'one line says why and what 讀稿 needs');
    // phones of their own: 靜音 is back (D1) and the note goes
    lobby.update({ ...st, room: { ...room, singleDevice: false } });
    assert.equal(modeBtn('silent').hidden, false);
    assert.ok(!lobby.el.textContent.includes('要搵個唔玩嘅人讀'));
    lobby.destroy();
  }));
});
