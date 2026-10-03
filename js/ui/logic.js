// ============================================================
// logic.js — the small pure rules the UI applies, kept free of the DOM so
// they run (and are tested) under Node.
// ============================================================

/**
 * Does a game fit the table right now? { ok, reason }.
 * `reason` is shown on the greyed-out picker card. `n` counts seated players
 * (spectators excluded); `mode` is app.state.mode.
 */
export function fits(meta, n, mode) {
  const [min, max] = meta?.players ?? [1, 99];
  if (n < min) return { ok: false, reason: min === max ? `要 ${min} 人（而家 ${n} 人）` : `要 ${min} 人以上（而家 ${n} 人）` };
  if (n > max) return { ok: false, reason: `最多 ${max} 人（而家 ${n} 人）` };
  if (mode === 'local' && meta?.singleDevice === 'none') return { ok: false, reason: '一部手機玩唔到' };
  return { ok: true, reason: '' };
}

// ---------- team colours ----------

const GOOD = { color: '#4ec97a', label: '好人陣營' };
const BAD = { color: '#e4573d', label: '壞人陣營' };
const SOLO = { color: '#c084fc', label: '第三陣營' };
const TEAMS = {
  good: GOOD, village: GOOD, villager: GOOD, villagers: GOOD, town: GOOD, loyal: GOOD,
  sleepyhead: GOOD, sleepyheads: GOOD, civilian: GOOD, innocent: GOOD, human: GOOD,
  evil: BAD, bad: BAD, wolf: BAD, wolves: BAD, werewolf: BAD, minion: BAD, minions: BAD,
  spy: BAD, undercover: BAD, thief: BAD, traitor: BAD, impostor: BAD,
  neutral: SOLO, solo: SOLO, third: SOLO, tanner: SOLO,
};

const COLOR_LIKE = /^(#|rgb|hsl)/i;

/**
 * Colour + Cantonese label for a role. `role.color` / `role.teamLabel` win;
 * then the table above; a `team` that is itself a CSS colour is used as the
 * colour (no label); anything else is neutral.
 */
export function teamStyle(role) {
  const team = String(role?.team ?? '');
  const known = TEAMS[team.toLowerCase()];
  const isColor = COLOR_LIKE.test(team);
  return {
    color: role?.color ?? (isColor ? team : known?.color) ?? null,
    label: role?.teamLabel ?? (known && !isColor ? known.label : null),
  };
}

// ---------- scoreboard ----------

/**
 * Rows sorted by points, then wins, then fewer games played, then seat order.
 * Equal (points, wins, played) share a rank (1, 1, 3 …).
 */
export function rankRows(players, scoreboard) {
  const rows = (players ?? []).map((pl, i) => {
    const s = scoreboard?.[pl.id] ?? {};
    return { pl, seat: pl.seat ?? i, played: s.played ?? 0, wins: s.wins ?? 0, points: s.points ?? 0, rank: 0 };
  });
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.played - b.played || a.seat - b.seat);
  let rank = 0;
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const tie = prev && prev.points === r.points && prev.wins === r.wins && prev.played === r.played;
    if (!tie) rank = i + 1;
    r.rank = rank;
  });
  return rows;
}

// ---------- time ----------

/** 45 → 「45 秒」, 120 → 「2 分鐘」, 90 → 「1 分 30 秒」. */
export function fmtDuration(sec) {
  const s = Math.round(sec);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} 分 ${r} 秒` : `${m} 分鐘`;
}

/** Seconds → "m:ss" (ceil, so the display reaches 0:00 only at zero). Bad input clamps to 0:00. */
export function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(Number.isFinite(sec) ? sec : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
