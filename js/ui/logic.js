// ============================================================
// logic.js — the small pure rules the UI applies, kept free of the DOM so
// they run (and are tested) under Node.
// ============================================================

import { needsEyesClosed } from '../core/engine-kit.js?v=20261004224709';

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

/**
 * How the evening's table reads (#39). `points`: did any game tonight award points? If not, the 分 column is
 * hidden (a column of zeros says nothing) and the board effectively ranks by wins. `earned(row)`: may this row
 * wear a medal — only for something actually won (points above 0, or wins on a night without points); a tie
 * at 0 is not a 🥈.
 */
export function scoreboardMode(rows) {
  const points = (rows ?? []).some((r) => (r?.points ?? 0) !== 0);
  return { points, earned: (r) => ((points ? r?.points : r?.wins) ?? 0) > 0 };
}

// ---------- results hero (#39) ----------

/**
 * The results screen's headline, stating the RESULT (never 「<game> — 贏家」, which on 芝士大盜 read as "the
 * thief won" right after the thief was caught). The game's emoji + name go in a small kicker line above.
 *   void            → 🚫 「呢鋪唔計」
 *   noScore         → the game's emoji, 「邊個贏由你哋講」 (a tool that does not judge: 通用派牌)
 *   a summary line  → 🏆 / 🤝 and the summary itself (every scoring game writes it as the result)
 *   else            → 🏆 「贏家」 / 🤝 「冇人贏」
 * `summaryBelow` says whether the summary still needs its own line under the winners.
 */
export function resultHero(res, meta = {}) {
  const summary = typeof res?.summary === 'string' ? res.summary.trim() : '';
  const winners = Array.isArray(res?.winners) ? res.winners.length : 0;
  if (res?.void === true) return { trophy: '🚫', heading: '呢鋪唔計', summaryBelow: !!summary };
  if (res?.noScore === true || meta?.noScore === true) {
    return { trophy: meta?.emoji ?? '🎲', heading: '邊個贏由你哋講', summaryBelow: !!summary };
  }
  const trophy = winners ? '🏆' : '🤝';
  if (summary) return { trophy, heading: summary, summaryBelow: false };
  return { trophy, heading: winners ? '贏家' : '冇人贏', summaryBelow: false };
}

/** The confetti for a win: the game's own emoji in place of the cheese mascot (#39). */
export function confettiSet(meta) {
  const own = typeof meta?.emoji === 'string' && meta.emoji.trim() ? meta.emoji.trim() : '⭐';
  return ['🎉', '✨', own, '🎊', '⭐'];
}

// ---------- play screen: 輪到你 and the host's ⏭ (#13, #14) ----------

/**
 * Does the header show 「輪到你」 for `seat`? Only for a real turn — the engine waits on this seat ALONE.
 * Never at night (the brightest thing on a lit phone), never in an eyes-closed / secret step (`anonymous`: in
 * the Avalon assassination only the Assassin's phone would light up), and never in a step that calls several
 * seats at once (`together`, added by the room; or `simultaneous`, if an engine says so itself): a deal or a
 * vote is everybody's, a pulsing pill on each phone is noise.
 */
export function turnBadge(focus, seat, { night = false } = {}) {
  if (!seat || night || !focus || typeof focus !== 'object') return false;
  if (focus.anonymous || focus.together || focus.simultaneous) return false;
  const pids = Array.isArray(focus.pids) ? focus.pids : [];
  return pids.length === 1 && pids[0] === seat;
}

/** The armed label's text for the host's skip: 「再㩒一次：跳過？未做嘅當冇做」. */
export const SKIP_CONFIRM = '跳過？未做嘅當冇做';

/**
 * Does the host's ⏭ 跳過呢步 need a second tap (#13)? When skipping would cut somebody off: the engine is
 * waiting on a seat (`waiting` — the room tells the host device; its own `focus` is filtered to its seats),
 * an eyes-closed step, or night. Not the 讀稿 narrator's tap on a line not yet acknowledged (`cueId` differs
 * from `ackedCueId`, the line the host last moved past): that tap only says "I have read it out".
 */
export function skipNeedsConfirm({ waiting = false, focus = null, night = false, mode = 'voice', cueId = null, ackedCueId = null } = {}) {
  const risky = !!waiting || !!focus?.anonymous || (Array.isArray(focus?.pids) && focus.pids.length > 0) || !!night;
  if (!risky) return false;
  if (mode === 'read' && cueId && cueId !== ackedCueId) return false;
  return true;
}

// ---------- the night dim (D1) ----------

/** What the night overlay says. Identical on every phone of a mode: it can never tell who is awake. */
export const NIGHT_WORDS = Object.freeze({
  closed: Object.freeze({ title: '閉 眼', hint: '🌙 可以將螢幕調暗啲' }),     // 語音 / 讀稿: eyes shut between your steps
  silent: Object.freeze({ title: '夜 晚', hint: '🌙 可以將螢幕調暗啲' }),     // 靜音: eyes stay open, every phone alike
  // a shared phone's opaque cover (§7.1): whoever holds it when it comes on puts it back in the middle
  middle: Object.freeze({ title: '📱 擺返中間', hint: '部手機放返枱中間，閉埋眼' }),
  middleOpen: Object.freeze({ title: '📱 擺返中間', hint: '部手機放返枱中間' }),   // the same in 靜音 (eyes open)
});

/**
 * How dark this phone is at night (`view.night`), → `{ on, level, words }`:
 *  - `level` 'dark' (near-black, still tappable) · 'soft' (D1: one readable ~70 % dim, still tappable) ·
 *    'opaque' (a shared phone: covers the last holder's screen, swallows taps) · null (off).
 *  - 語音 / 讀稿 (eyes closed): dark between the seat's own steps, lifted while `focus` calls it (`inFocus`).
 *  - 靜音 (D1, eyes stay open): the SAME soft dim on every single-seat phone all night — the awake seat gets no
 *    lift, so a glance across a dark table never shows who woke. A shared phone (`shared`, 2+ seats) keeps
 *    focus for its pass gate: soft for the seat that is called, opaque otherwise.
 *  - `words` (title + hint) depend on the mode only, never on the seat.
 * No seat (a spectator, the table view) or no night → off.
 */
export function nightChrome({ seat = null, night = false, inFocus = false, mode = 'voice', shared = false, table = false } = {}) {
  const silent = mode === 'silent';
  const words = silent ? NIGHT_WORDS.silent : NIGHT_WORDS.closed;
  const middle = silent ? NIGHT_WORDS.middleOpen : NIGHT_WORDS.middle;
  if (!night) return { on: false, level: null, words };
  // §7.1: a shared phone lying in the middle (no seat on screen) at night is covered, whatever the mode
  if (shared && (table || !seat)) return { on: true, level: 'opaque', words: middle };
  if (!seat) return { on: false, level: null, words };
  if (silent) return shared && !inFocus ? { on: true, level: 'opaque', words: middle } : { on: true, level: 'soft', words };
  if (inFocus) return { on: false, level: null, words };
  return shared ? { on: true, level: 'opaque', words: middle } : { on: true, level: 'dark', words };
}

// ---------- one phone in the middle (DESIGN §7.1) ----------

/**
 * What makes a focus "another step" on a shared phone: this phone's called seats (sorted), `anonymous`, `step`
 * and `open` — never `together`, which follows other phones' progress. '' = no focus.
 */
export function focusSig(focus) {
  if (!focus || typeof focus !== 'object') return '';
  const pids = Array.isArray(focus.pids) ? focus.pids.filter((x) => typeof x === 'string').sort() : [];
  return JSON.stringify([pids, focus.anonymous ? String(focus.anonymous) : '', typeof focus.step === 'string' ? focus.step : '', focus.open === true]);
}

/**
 * #17: the order a shared phone goes round for one named step. `called` = this phone's called seats (engine
 * order), `seatOrder` = every seat id round the table, `from` = the holder (else the last holder): clockwise from
 * there, `from` itself first while it is still called. `ordered` keeps the engine's order. `deferred` seats (#18
 * 「⏭ 跳過佢」) go to the end.
 */
export function walkOrder(called, seatOrder, { from = null, ordered = false, deferred = [] } = {}) {
  const list = (Array.isArray(called) ? called : []).filter((x, i, a) => typeof x === 'string' && a.indexOf(x) === i);
  const order = Array.isArray(seatOrder) ? seatOrder : [];
  let out = list.slice();
  if (!ordered && list.length > 1) {
    const i0 = from ? order.indexOf(from) : -1;
    const n = order.length;
    const rank = (id) => {
      const j = order.indexOf(id);
      if (j < 0) return n + list.indexOf(id);          // not round the table (cannot happen): last, engine order
      return i0 < 0 ? j : (j - i0 + n) % n;
    };
    out.sort((a, b) => rank(a) - rank(b));
  }
  const later = new Set(Array.isArray(deferred) ? deferred : []);
  return [...out.filter((x) => !later.has(x)), ...out.filter((x) => later.has(x))];
}

/** #33: the private gate's subtitle: 「其他人唔好望 · 第 1 輪投票 · 搞掂 2/5」 (label / progress when known). */
export function gateSubtitle({ label = '', done = 0, total = 0 } = {}) {
  const parts = ['其他人唔好望'];
  if (typeof label === 'string' && label.trim()) parts.push(label.trim());
  if (total > 1) parts.push(`搞掂 ${Math.max(0, Math.min(done, total))}/${total}`);
  return parts.join(' · ');
}

/**
 * Re-run #6: the seat chip during a public one-person step (`focus.open`) on a shared phone — the phone lies face up
 * in the middle, so it never says who "holds" it: 「📱 枱中間 — 阿明 畫緊」. The verb comes from the step's public
 * `label` (畫 → 畫緊, 講 / 發言 / 遺言 / 解釋 → 講緊, 揀 → 揀緊, 估 → 估緊), else 「輪到 X」.
 */
export function openStepChip(name, label = '') {
  const l = typeof label === 'string' ? label : '';
  const who = String(name ?? '?');
  const verb = /畫/.test(l) ? '畫緊' : /講|發言|遺言|解釋|描述/.test(l) ? '講緊' : /揀/.test(l) ? '揀緊' : /估/.test(l) ? '估緊' : '';
  return verb ? `📱 枱中間 — ${who} ${verb}` : `📱 枱中間 — 輪到 ${who}`;
}

export const TABLE_CONFIRM = '全枱傾夠未？';

/**
 * Re-run #2: `api.tableSend(action, { confirm })` — the question the armed button asks. A leading 「再㩒一次：」 is
 * dropped (the arm adds it), so `'開始投票？'` and `'再㩒一次：開始投票？'` both read 「再㩒一次：開始投票？」. `true` asks
 * 「全枱傾夠未？」. '' = no confirm.
 */
export function tableConfirmText(text) {
  if (text === true) return TABLE_CONFIRM;
  if (typeof text !== 'string') return '';
  return text.trim().replace(/^再㩒一次[:：]\s*/, '').trim();
}

export const ONE_PHONE_NARRATION = '一部手機：大家要閉眼，所以冇靜音 · 📜 讀稿要搵個唔玩嘅人讀';

/**
 * U1: the narration modes a host may pick for `meta` → `{ modes, note }`. On a whole-table phone a game whose night
 * needs eyes closed (`engine-kit.needsEyesClosed`) has no 靜音, and `note` says why in one line.
 */
export function narrationChoices(meta, { singleDevice = false } = {}) {
  const barred = !!singleDevice && !!meta && needsEyesClosed(meta);
  return barred
    ? { modes: ['voice', 'read'], note: ONE_PHONE_NARRATION }
    : { modes: ['voice', 'read', 'silent'], note: '' };
}

// ---------- public "recent events" folds (#10) ----------

const MAX_FOLDS = 4;
const MAX_ENTRIES = 30;
const MAX_LINES = 40;

/** One line of a fold: a string, `{ text }`, or a ballot `{ from: pid, to: pid | null }` (null = 棄權). */
function foldLine(l) {
  if (typeof l === 'string') return l.trim() ? { text: l } : null;
  if (!l || typeof l !== 'object') return l == null ? null : { text: String(l) };
  if (typeof l.from === 'string') return { from: l.from, to: typeof l.to === 'string' ? l.to : null };
  if (typeof l.text === 'string' && l.text.trim()) return { text: l.text };
  return null;
}
const foldLines = (ls) => (Array.isArray(ls) ? ls.map(foldLine).filter(Boolean).slice(0, MAX_LINES) : []);

/**
 * `view.recent` → folds the play screen can render: [{ key, title, open, entries: [{ title, lines }] }].
 * Accepts one fold or an array of them; a fold is `{ id?, title, lines? , entries?: [{ title?, lines }], open? }`.
 * Folds with nothing in them are dropped (no empty 「📜 之前嘅投票」 before the first vote).
 */
export function recentFolds(recent) {
  const list = Array.isArray(recent) ? recent : recent && typeof recent === 'object' ? [recent] : [];
  const out = [];
  for (const [i, f] of list.entries()) {
    if (!f || typeof f !== 'object') continue;
    const entries = [];
    const top = foldLines(f.lines);
    if (top.length) entries.push({ title: null, lines: top });
    for (const e of Array.isArray(f.entries) ? f.entries.slice(0, MAX_ENTRIES) : []) {
      if (!e || typeof e !== 'object') continue;
      const lines = foldLines(e.lines);
      if (!lines.length) continue;
      entries.push({ title: typeof e.title === 'string' && e.title.trim() ? e.title.trim() : null, lines });
    }
    if (!entries.length) continue;
    const title = typeof f.title === 'string' && f.title.trim() ? f.title.trim() : '📜 之前發生咗咩';
    out.push({ key: typeof f.id === 'string' && f.id ? f.id : `${i}:${title}`, title, open: f.open === true, entries });
    if (out.length >= MAX_FOLDS) break;
  }
  return out;
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

/**
 * Games where the seat order IS the order people take turns (speaking, drawing, leading a team),
 * so the lobby tells the host to arrange the seats first. A game may say so itself with
 * `meta.turnOrder: true | false`; the list covers the games that do not (yet).
 */
export const TURN_ORDER_GAMES = Object.freeze(['undercover', 'spyfall', '9upper', 'avalon', 'werewolf', 'fake-artist', 'draw-guess']);
export function turnOrderMatters(id, meta) {
  if (typeof meta?.turnOrder === 'boolean') return meta.turnOrder;
  return TURN_ORDER_GAMES.includes(id);
}

/** Is a one-tap config preset (`config.presets(n)` entry's cfg) what the config holds now? */
export function presetMatches(cfg, presetCfg) {
  if (!presetCfg || typeof presetCfg !== 'object') return false;
  const same = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
  return Object.keys(presetCfg).every((k) => same(cfg?.[k], presetCfg[k]));
}

// ---------- results (BACKLOG build:avalon / build:onuw) ----------

const HEAD_RE = /^──\s+/;

/** One result line as display text: strings as they are, { text } objects by their text. */
function lineText(l) {
  if (typeof l === 'string') return l;
  if (l && typeof l === 'object' && typeof l.text === 'string') return l.text;
  return l == null ? '' : String(l);
}

/** A section heading, or null: `{ h: '標題' }`, or a string '── 標題 ──' (the dashes are trimmed). */
export function headingOf(l) {
  if (l && typeof l === 'object' && typeof l.h === 'string') return l.h.trim() || null;
  if (typeof l === 'string' && HEAD_RE.test(l)) return l.replace(HEAD_RE, '').replace(/\s*─+\s*$/, '').trim() || null;
  return null;
}

/**
 * result.lines → [{ title, lines: [string] }]. Lines before the first heading form an untitled first
 * section; a heading with nothing under it is dropped; empty lines are skipped.
 */
export function resultSections(lines) {
  const out = [];
  let cur = { title: null, lines: [] };
  for (const l of Array.isArray(lines) ? lines : []) {
    const h = headingOf(l);
    if (h !== null) {
      if (cur.lines.length) out.push(cur);
      cur = { title: h, lines: [] };
      continue;
    }
    const text = lineText(l).trim();
    if (text) cur.lines.push(text);
  }
  if (cur.lines.length) out.push(cur);
  return out;
}

/** Which sections start open: all of a short recap; only the first of a long one (> longOver lines). */
export function sectionsOpen(sections, longOver = 8) {
  const total = (sections ?? []).reduce((n, s) => n + s.lines.length, 0);
  return (sections ?? []).map((_, i) => total <= longOver || i === 0);
}

/** 「假畫家-2026-10-03-2.png」 — a file name for a keepsake picture (no characters iOS / Windows dislike). */
export function pictureFileName(gameName, index, date = new Date()) {
  const safe = String(gameName ?? '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 24) || '桌遊盒';
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${safe}-${ymd}${index > 0 ? `-${index + 1}` : ''}.png`;
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
 * (undercover) yields null. `view.hintRoleText` (this table's rule for the
 * card, e.g. 狼人殺's win condition) replaces the generic rules text.
 */
export function roleFor(view, rules) {
  if (!view || typeof view !== 'object') return null;
  const role = ownRole(view, rules);
  if (!role) return null;
  // this table's version of the card (e.g. 狼人殺's win rule): the seat's own view may override the rules text
  const own = hintRoleText(view);
  return own ? { ...role, text: own } : role;
}

function ownRole(view, rules) {
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
 * `view.hintRoleText` — the seat's own role text for THIS table (a string written 「做乜：… 點贏：…」, or
 * `{ what, win }`), preferred over the generic `rules.roles` text. '' when the view has none.
 */
export function hintRoleText(view) {
  const t = view?.hintRoleText;
  if (typeof t === 'string') return t.trim().slice(0, 400);
  if (t && typeof t === 'object') {
    const what = typeof t.what === 'string' ? t.what.trim() : '';
    const win = typeof t.win === 'string' ? t.win.trim() : '';
    if (!what && !win) return '';
    return `${what ? `做乜：${what}` : ''}${what && win ? ' ' : ''}${win ? `點贏：${win}` : ''}`.slice(0, 400);
  }
  return '';
}

/**
 * The 💡 sheet's role list → `{ roles: [{ ...role, count }], inPlay }` | null (no roles at all).
 * `view.rolesInPlay` names the roles in THIS game, in the order to list them: ids (`'seer'`; an id given twice
 * counts twice) or `{ id | role, count | n }` objects (an object with its own `name` / `emoji` / `text` / `team` is a
 * role the rules do not list, e.g. a custom deck). Onuw's existing `view.roleList` (`{ role, count }`) is read the
 * same way. Then only those roles are listed (`inPlay: true`, heading 「呢局有咩角色」); ids the rules do not know
 * are skipped. Without it every role of the game (`inPlay: false`, heading 「呢個遊戲有咩角色」). `count` is a
 * number when the view gave one (or an id repeated), else null.
 */
export function hintRoles(view, rules) {
  const all = (Array.isArray(rules?.roles) ? rules.roles : []).filter((r) => r && typeof r === 'object' && r.name);
  const src = Array.isArray(view?.rolesInPlay) ? view.rolesInPlay : Array.isArray(view?.roleList) ? view.roleList : null;
  if (src) {
    const out = new Map();
    for (const x of src.slice(0, 60)) {
      const obj = x && typeof x === 'object' ? x : null;
      const id = typeof x === 'string' ? x : typeof obj?.id === 'string' ? obj.id : typeof obj?.role === 'string' ? obj.role : null;
      if (!id) continue;
      const given = Number(obj?.count ?? obj?.n);
      const n = Number.isFinite(given) && given > 0 ? Math.floor(given) : null;
      const had = out.get(id);
      if (had) { had.count = (had.count ?? 1) + (n ?? 1); continue; }
      const known = all.find((r) => r.id === id);
      const role = known ?? (obj && (obj.name || obj.emoji)
        ? { id, name: String(obj.name ?? ''), emoji: obj.emoji ?? '❔', team: obj.team, text: String(obj.text ?? obj.desc ?? '') }
        : null);
      if (role) out.set(id, { ...role, count: n });
    }
    if (out.size) return { roles: [...out.values()], inPlay: true };
  }
  return all.length ? { roles: all.map((r) => ({ ...r, count: null })), inPlay: false } : null;
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
