// ============================================================
// util.js — DOM helpers, crypto-grade randomness, local storage
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

// ---------- DOM ----------
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

let toastTimer = null;
export function toast(msg, ms = 2000) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
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
    set(key, value) { try { rawSet(key, JSON.stringify(value)); } catch { /* quota / private mode */ } },
    del(key) { try { rawDel(key); } catch { /* ignore */ } },
  };
}

// ---------- screen wake lock (stops the host's phone from killing the room) ----------
let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (on) {
      if (wakeLock || !('wakeLock' in navigator)) return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}
export function wakeLockActive() { return !!wakeLock; }

/** Simple deterministic sleep for retry backoff. */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
