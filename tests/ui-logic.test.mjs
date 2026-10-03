// js/ui/logic.js — the pure rules behind the picker, role cards, scoreboard and clocks.

import { test, assert } from './lib.mjs';
import { fits, teamStyle, rankRows, fmtDuration, fmtClock } from '../js/ui/logic.js';

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
