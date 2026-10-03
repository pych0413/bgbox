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

// ---------- lobby ----------

/** Seat order (names) remembered from the last game: `order` if it holds names, else `names`. */
function savedNames(group) {
  const pick = (a) => (Array.isArray(a) && a.every((x) => typeof x === 'string') ? a : null);
  return pick(group?.order) ?? pick(group?.names) ?? [];
}

/**
 * Should the lobby offer 「用返上次座位」? Only when at least two of tonight's
 * seated names sat together last time and they are now in a different order.
 */
export function savedOrderDiffers(players, group) {
  const saved = savedNames(group);
  if (saved.length < 2) return false;
  const here = (players ?? []).filter((p) => !p.spectator).map((p) => p.name).filter((n) => saved.includes(n));
  if (here.length < 2) return false;
  const want = saved.filter((n) => here.includes(n));
  return want.some((n, i) => n !== here[i]);
}

/** Names to pre-fill one-phone setup with, from the saved group (seat order), or null. */
export function savedGroupNames(group) {
  const names = savedNames(group).map((n) => String(n).trim()).filter(Boolean);
  return names.length >= 2 ? names : null;
}

/** Is a one-tap config preset (`config.presets(n)` entry's cfg) what the config holds now? */
export function presetMatches(cfg, presetCfg) {
  if (!presetCfg || typeof presetCfg !== 'object') return false;
  const same = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
  return Object.keys(presetCfg).every((k) => same(cfg?.[k], presetCfg[k]));
}

// ---------- table timer (BACKLOG T1) ----------

/** The host's one-tap presets, in seconds. 自訂 is a stepper on top of these. */
export const TIMER_PRESETS = Object.freeze([
  { sec: 30, label: '30 秒' },
  { sec: 60, label: '1 分鐘' },
  { sec: 180, label: '3 分鐘' },
  { sec: 300, label: '5 分鐘' },
]);

/** The 自訂 stepper: 10 s … 60 min, in 15 s steps below 2 min and 30 s steps above. */
export function timerStep(sec) { return sec < 120 ? 15 : 30; }
export function clampTimerSec(sec) {
  const s = Math.round(Number(sec) || 0);
  return Math.max(10, Math.min(3600, s));
}

/**
 * Milliseconds left on the room timer `{ endsAt, paused, remainingMs, done }` at host time `now`.
 * 0 once it rang, frozen at remainingMs while paused, never negative, null when there is no timer.
 */
export function timerLeftMs(timer, now) {
  if (!timer || typeof timer !== 'object') return null;
  if (timer.done) return 0;
  const frozen = Math.max(0, Number(timer.remainingMs) || 0);
  if (timer.paused) return frozen;
  const end = Number(timer.endsAt);
  if (!Number.isFinite(end)) return frozen;
  return Math.max(0, end - now);
}

/**
 * Which sound one tick of the clock should make, from the ms left at the
 * previous tick and now: 'alarm' when it reaches zero, 'warn' when it crosses
 * `warnSec`, 'tick' on each of the last `tickSec` seconds, else null. Only
 * CROSSINGS count, so the first reading, a jump up (+30 秒) and a paused clock
 * are silent.
 */
export function timerCue(prevMs, ms, { warnSec = 10, tickSec = 5 } = {}) {
  if (prevMs == null || ms == null || ms >= prevMs) return null;
  if (prevMs > 0 && ms <= 0) return 'alarm';
  if (prevMs > warnSec * 1000 && ms <= warnSec * 1000) return 'warn';
  if (ms > 0 && ms <= tickSec * 1000 && Math.ceil(prevMs / 1000) !== Math.ceil(ms / 1000)) return 'tick';
  return null;
}

// ---------- browsers (BACKLOG G10 / G18) ----------

/**
 * The in-app browser a link was opened in (they often lack service workers,
 * wake lock and speech), or null for a real browser. WhatsApp and Telegram on
 * iOS open links in Safari's own view, which looks like Safari and is fine.
 */
export function inAppBrowser(ua) {
  const s = String(ua ?? '');
  if (/\bLine\//.test(s)) return 'LINE';
  if (/Instagram/i.test(s)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS/.test(s)) return 'Facebook';
  if (/MicroMessenger/i.test(s)) return 'WeChat';
  if (/WhatsApp/i.test(s)) return 'WhatsApp';
  return null;
}

// ---------- 💡 hint sheet (BACKLOG U1) ----------

const roleIdOf = (x) => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof x.id === 'string' ? x.id : null);

/**
 * The role this seat holds, as a card for the 💡 sheet: the game's own
 * `rules.roles` entry when the id matches, else the role object the view
 * carries (custom decks), else null. Only fields the view puts there on
 * purpose are read (`roleId`, `role`, `mine.role`, `my.role`, `me.role`,
 * `my.dealt`), so a game that keeps the role secret even from its holder
 * (undercover) yields null.
 */
export function roleFor(view, rules) {
  if (!view || typeof view !== 'object') return null;
  const roles = Array.isArray(rules?.roles) ? rules.roles : [];
  const byId = (id) => roles.find((r) => r && r.id === id) ?? null;
  const mine = view.mine ?? view.my ?? null;
  // 芝士大盜: a sleepyhead the thief recruited is a 共犯 now
  if (mine && mine.follower === true && byId('follower')) return byId('follower');
  const candidates = [view.roleId, view.role, view.mine?.role, view.my?.role, view.me?.role, view.my?.dealt];
  for (const c of candidates) {
    const id = roleIdOf(c);
    if (!id) continue;
    const hit = byId(id);
    if (hit) return hit;
    if (c && typeof c === 'object' && (c.name || c.emoji)) {
      return { id, name: c.name ?? '', emoji: c.emoji ?? '❔', team: c.team, text: c.text ?? c.desc ?? '' };
    }
  }
  return null;
}

/**
 * Split a role's text into 「做乜」 and 「點贏」 when the game wrote it as
 * '做乜：… 點贏：…'; otherwise all of it is 「做乜」.
 */
export function roleParts(text) {
  const s = String(text ?? '').trim();
  const m = /^(?:做乜[:：]\s*)?([\s\S]*?)\s*點(?:樣)?贏[:：]\s*([\s\S]*)$/.exec(s);
  if (m) return { what: m[1].trim(), win: m[2].trim() };
  return { what: s.replace(/^做乜[:：]\s*/, ''), win: '' };
}
