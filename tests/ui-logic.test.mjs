// js/ui/logic.js — the pure rules behind the picker, role cards, scoreboard and clocks.

import { test, assert } from './lib.mjs';
import {
  fits, teamStyle, rankRows, fmtDuration, fmtClock,
  timerLeftMs, timerCue, clampTimerSec, TIMER_PRESETS, inAppBrowser, roleFor, roleParts,
} from '../js/ui/logic.js';

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
