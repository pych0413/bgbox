// js/ui/logic.js — the pure rules behind the picker, role cards, scoreboard and clocks.

import { test, assert } from './lib.mjs';
import {
  fits, teamStyle, rankRows, fmtDuration, fmtClock,
  timerLeftMs, timerCue, clampTimerSec, TIMER_PRESETS, inAppBrowser, roleFor, roleParts,
  headingOf, resultSections, sectionsOpen, turnOrderMatters, TURN_ORDER_GAMES, pictureFileName,
  savedOrderDiffers, savedGroupNames, presetMatches,
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
