// ============================================================
// util.js — crypto-grade randomness, room codes, local storage, wake lock.
//
// No DOM helpers here: the UI has exactly one set, in js/ui/dom.js (G14).
// Everything in this file runs under Node too (tests), except keepAwake,
// which is a no-op without navigator.wakeLock.
// ============================================================

/**
 * Room codes are four dice, so every digit is 1-6 and the join screen
 * can be a keypad made of dice faces. That is only 6^4 = 1296 rooms —
 * plenty for concurrent games, and HostNet retries on a taken code.
 */
export const CODE_ALPHABET = '123456';
export const CODE_LEN = 4;
export const isRoomCode = (s) => typeof s === 'string' && /^[1-6]{4}$/.test(s);

/** Uniform integer in [0, max) using rejection sampling on crypto bytes. */
export function randInt(max) {
  if (max <= 0) throw new RangeError('max must be > 0');
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
  return v % max;
}

/** Fisher-Yates using crypto randomness. Returns a new array. */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function rollDie(sides) { return randInt(sides) + 1; }

export function makeRoomCode(len = CODE_LEN) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randInt(CODE_ALPHABET.length)];
  return s;
}

export function uid(prefix = 'p') {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return prefix + '_' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

export function buzz(pattern = 18) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

export function hhmm(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ---------- storage (never throws: Safari private mode, blocked cookies) ----------
export function lsGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
export function lsDel(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * JSON key/value store over any of: Web Storage (getItem/setItem/removeItem), a
 * plain Map (get/set/delete), or nothing (falls back to memory). Injected so the
 * host/bag code runs under Node tests with a fake. Never throws.
 */
export function makeStore(storage) {
  let backend = storage;
  if (backend === undefined) {
    try { backend = globalThis.localStorage; } catch { backend = null; }
  }
  const memory = new Map();
  const web = backend && typeof backend.getItem === 'function';
  const map = !web && backend && typeof backend.get === 'function' && typeof backend.set === 'function';
  const rawGet = (k) => (web ? backend.getItem(k) : map ? backend.get(k) : memory.get(k));
  const rawSet = (k, v) => (web ? backend.setItem(k, v) : map ? backend.set(k, v) : memory.set(k, v));
  const rawDel = (k) => (web ? backend.removeItem(k) : map ? backend.delete(k) : memory.delete(k));
  return {
    get(key, fallback = null) {
      try {
        const raw = rawGet(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    /** Returns false if the write failed (quota exceeded, private mode). */
    set(key, value) {
      try { rawSet(key, JSON.stringify(value)); return true; } catch { return false; }
    },
    /** Write an already-serialised JSON string (saves a second stringify of a big snapshot). */
    setRaw(key, json) {
      try { rawSet(key, String(json)); return true; } catch { return false; }
    },
    /** Is anything stored under `key`? (Cheap: never parses a big snapshot.) */
    has(key) { try { return rawGet(key) != null; } catch { return false; } },
    del(key) { try { rawDel(key); } catch { /* ignore */ } },
  };
}

// ---------- screen wake lock (stops the host's phone from killing the room) ----------
//
// Several places ask for it (core on entering a room and on every return to the foreground,
// the shell when the screen changes), often in the same tick. Every call only records what is
// WANTED; one worker at a time reconciles that with the real lock. Two overlapping requests
// used to create two sentinels and lose track of one, which then kept the screen on after
// the room was left.
let wakeLock = null;
let wakeWanted = false;
let wakeWork = null;

export function keepAwake(on) {
  wakeWanted = !!on;
  if (wakeWork) return wakeWork;          // the running worker re-reads wakeWanted before it stops
  wakeWork = (async () => {
    await null;                           // let `wakeWork` be assigned before `finally` can clear it
    try {
      for (let guard = 0; guard < 4; guard++) {
        if (wakeWanted && !wakeLock) {
          const wl = globalThis.navigator?.wakeLock;
          if (!wl || globalThis.document?.hidden) break;     // unsupported, or a hidden page (the request would fail)
          const lock = await wl.request('screen');
          lock.addEventListener?.('release', () => { if (wakeLock === lock) wakeLock = null; });
          wakeLock = lock;
        } else if (!wakeWanted && wakeLock) {
          const lock = wakeLock;
          wakeLock = null;
          await lock.release();
        } else break;
      }
    } catch { /* refused: low battery, no permission, page hidden meanwhile */ }
    finally { wakeWork = null; }
  })();
  return wakeWork;
}
export function wakeLockActive() { return !!wakeLock; }

/** Simple deterministic sleep for retry backoff. */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
