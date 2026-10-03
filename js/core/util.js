// ============================================================
// util.js — crypto-grade randomness, room codes, local storage, the
// connection log, wake lock.
//
// No DOM helpers here: the UI has exactly one set, in js/ui/dom.js (G14).
// Everything in this file runs under Node too (tests), except keepAwake,
// which is a no-op without navigator.wakeLock (and without a document for its fallback).
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

// ---------- connection log (⚙️ 連線記錄) ----------
//
// A small ring buffer of connection events — status changes, re-dials and why, page visibility,
// wake lock, heartbeat timeouts — that a player can copy from the settings sheet after a bad
// night. Lines are `<UTC ISO time> <text>`, newest last. Never put a token or secret in it.
export const CONN_LOG_MAX = 40;

export function makeConnLog({ max = CONN_LOG_MAX, now = () => Date.now() } = {}) {
  const lines = [];
  return {
    add(text) {
      let at;
      try { at = new Date(now()).toISOString(); } catch { at = '????-??-??T??:??:??Z'; }
      lines.push(`${at} ${String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)}`);
      if (lines.length > max) lines.splice(0, lines.length - max);
    },
    lines: () => lines.slice(),
    clear() { lines.length = 0; },
  };
}

/** This page's log: createApp writes here by default, and so does the wake lock below. */
export const connLog = makeConnLog();

// ---------- screen wake lock (stops the host's phone from killing the room) ----------
//
// Several places ask for it (core on entering a room and on every return to the foreground,
// the shell when the screen changes), often in the same tick. Every call only records what is
// WANTED; one worker at a time reconciles that with the real lock. Two overlapping requests
// used to create two sentinels and lose track of one, which then kept the screen on after
// the room was left.
//
// Fallback (UNVERIFIED on a real iPhone): on a phone where the Screen Wake Lock is missing, refused, or
// released while the page is still on screen — and on iOS wherever WebKit may grant it without honouring
// it (Chrome / Google app / in-app browsers are all WKWebView; Home Screen apps before 18.4) — a tiny muted,
// inline <video> plays a 2×2 canvas stream. WebKit keeps the display awake while a <video> whose srcObject
// has a video track is playing, audio or not; there is no media file, no sound, no download. Autoplay may
// need a tap (Low Power Mode), so the first tap after a refusal — and the very first tap on the page —
// starts it inside that gesture. Desktops never get it. Which path was taken goes to the connection log.
let wakeLock = null;
let wakeWanted = false;
let wakeWork = null;
let wakeRefused = false;   // the last native request was refused
let wakeReleased = false;  // the system took the lock back while the page was visible: not to be trusted on this phone
let wakeVideo = null;      // { video, stream, timer } while the fallback exists
let wakePath = '';         // what the connection log last said about it
let gestureArmed = false;

/** iOS / iPadOS version from a user agent: [major, minor]; [0, 0] for an iPad that hides it; null when not iOS. */
export function iosVersion(ua = '', touchPoints = 0) {
  const s = String(ua ?? '');
  let m = /\b(?:iPhone|iPad|iPod)\b.*?\bOS (\d+)[_.](\d+)/.exec(s);
  if (m) return [Number(m[1]), Number(m[2])];
  if (/\bMacintosh\b/.test(s) && touchPoints > 1) {     // iPadOS 13+ asks for the desktop site
    m = /\bVersion\/(\d+)\.(\d+)/.exec(s);
    return m ? [Number(m[1]), Number(m[2])] : [0, 0];
  }
  return null;
}

/**
 * Which iOS browser a user agent is: 'safari' | 'chrome' | 'google' (the Google app, where a scanned QR code
 * often opens) | 'firefox' | 'edge' | 'webview' (an app's in-app browser, or a Home Screen app); null off iOS.
 * All but Safari are WKWebView.
 */
export function iosBrowser(ua = '', touchPoints = 0) {
  const s = String(ua ?? '');
  if (!iosVersion(s, touchPoints)) return null;
  if (/\bCriOS\//.test(s)) return 'chrome';
  if (/\bGSA\//.test(s)) return 'google';
  if (/\bFxiOS\//.test(s)) return 'firefox';
  if (/\bEdgiOS\//.test(s)) return 'edge';
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(s) && !/\b(?:FBAN|FBAV|Instagram|Line|MicroMessenger|WhatsApp)\b/.test(s)) return 'safari';
  return 'webview';
}

/**
 * Why this page needs the video fallback to keep the screen on — '' when it does not. Pure, for tests.
 * @param {object} env { mobile, hasNative, refused, released, standalone, ios: [major, minor] | null, browser }
 */
export function wakeFallbackReason({ mobile = false, hasNative = false, refused = false, released = false, standalone = false, ios = null, browser = null } = {}) {
  if (!mobile) return '';                                    // desktops: the native lock or nothing
  if (!hasNative) return 'no Screen Wake Lock API';
  if (refused) return 'wake lock refused';
  if (released) return 'wake lock released while visible';
  if (browser && browser !== 'safari') return `iOS ${browser} (WKWebView) may ignore the wake lock`;
  if (standalone && ios && (ios[0] < 18 || (ios[0] === 18 && ios[1] < 4))) return `Home Screen app on iOS ${ios.join('.')} (< 18.4) ignores the wake lock`;
  return '';
}
export const wakeNeedsFallback = (env) => !!wakeFallbackReason(env);

function wakeEnv() {
  const nav = globalThis.navigator ?? {};
  const ua = String(nav.userAgent ?? '');
  const ios = iosVersion(ua, nav.maxTouchPoints);
  return {
    mobile: !!ios || /\bAndroid\b/i.test(ua), hasNative: !!nav.wakeLock, refused: wakeRefused, released: wakeReleased,
    standalone: nav.standalone === true, ios, browser: iosBrowser(ua, nav.maxTouchPoints),
  };
}

const wakeWhere = (env) => (env.ios ? `iOS ${env.ios.join('.')} ${env.browser}${env.standalone ? ' Home Screen' : ''}` : env.mobile ? 'Android' : 'desktop');

/** Say in the connection log which way the screen is being kept on, once per change. */
function notePath(path) {
  if (path === wakePath) return;
  wakePath = path;
  connLog.add(`wake: ${path}`);
}

function makeWakeVideo() {
  const doc = globalThis.document;
  if (!doc?.createElement || !doc.body) return null;
  const canvas = doc.createElement('canvas');
  if (typeof canvas.captureStream !== 'function') return null;
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext?.('2d');
  let n = 0;
  const paint = () => { if (ctx) { ctx.fillStyle = n++ % 2 ? '#000' : '#010101'; ctx.fillRect(0, 0, 2, 2); } };
  paint();
  let stream;
  try { stream = canvas.captureStream(1); } catch { return null; }
  const video = doc.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  for (const a of ['muted', 'playsinline', 'webkit-playsinline', 'disablepictureinpicture', 'disableremoteplayback']) video.setAttribute(a, '');
  video.setAttribute('aria-hidden', 'true');
  video.tabIndex = -1;
  // on screen (an off-screen autoplaying video gets paused), but 2 px, see-through and untouchable
  video.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none;';
  video.srcObject = stream;
  doc.body.append(video);
  return { video, stream, timer: setInterval(paint, 4000) };   // a fresh frame now and then keeps the stream live
}

/** Start (or keep) the fallback playing; resolves whether it plays. Called inside a tap when it can be. */
function playWakeVideo() {
  if (!wakeVideo) {
    wakeVideo = makeWakeVideo();
    if (!wakeVideo) { notePath('video fallback impossible here (no canvas.captureStream)'); return Promise.resolve(false); }
  }
  const v = wakeVideo.video;
  if (!v.paused) return Promise.resolve(true);
  let p;
  try { p = v.play(); } catch (e) { p = Promise.reject(e); }
  return Promise.resolve(p).then(() => {
    if (!wakeWanted) { try { v.pause(); } catch { /* gone */ } return false; }   // primed by a tap before a room existed
    connLog.add('wake: video fallback playing');
    return true;
  }, (e) => {
    connLog.add(`wake: video fallback refused (${e?.name || 'error'}) — retry on the next tap`);
    armWakeGesture();
    return false;
  });
}

function stopWakeVideo() {
  if (!wakeVideo) return;
  const { video, stream, timer } = wakeVideo;
  wakeVideo = null;
  clearInterval(timer);
  try { video.pause(); } catch { /* gone */ }
  try { for (const tr of stream.getTracks?.() ?? []) tr.stop(); } catch { /* gone */ }
  try { video.srcObject = null; video.remove(); } catch { /* gone */ }
  connLog.add('wake: video fallback off');
}

/** The next tap anywhere starts the fallback inside that gesture (autoplay refused, or Low Power Mode). */
function armWakeGesture() {
  const doc = globalThis.document;
  if (gestureArmed || !doc?.addEventListener) return;
  gestureArmed = true;
  const evs = ['touchend', 'pointerup', 'click'];
  const onTap = () => {
    for (const ev of evs) doc.removeEventListener(ev, onTap, true);
    gestureArmed = false;
    if (!doc.hidden && wakeNeedsFallback(wakeEnv()) && (wakeWanted || !wakeVideo)) playWakeVideo();
  };
  for (const ev of evs) doc.addEventListener(ev, onTap, true);
}

/** The fallback follows what is wanted now (and the log says which path). Hidden: iOS pauses it anyway; it is kept for the return. */
function syncWakeVideo() {
  const hidden = !!globalThis.document?.hidden;
  if (wakeWanted && !hidden) {
    const env = wakeEnv();
    const reason = wakeFallbackReason(env);
    if (reason) {
      notePath(`video fallback — ${reason} (${wakeWhere(env)})${wakeLock ? ', native lock held too' : ''}`);
      return playWakeVideo();
    }
    notePath(wakeLock ? `native wake lock (${wakeWhere(env)})` : `nothing keeps the screen on (${wakeWhere(env)}${env.hasNative ? '' : ', no Screen Wake Lock API'})`);
  }
  if (!wakeWanted) wakePath = '';
  if (!wakeWanted || !hidden) stopWakeVideo();
  return Promise.resolve(false);
}

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
          let lock;
          try { lock = await wl.request('screen'); } catch (e) {
            // refused: low battery, no permission, page hidden meanwhile
            if (!wakeRefused) connLog.add(`wake: wake lock refused (${e?.name || 'error'})`);
            wakeRefused = true;
            break;
          }
          lock.addEventListener?.('release', () => {
            if (wakeLock !== lock) return;
            wakeLock = null;
            if (wakeWanted && !globalThis.document?.hidden) {
              // taken back while still on screen (a WKWebView, Low Power Mode): from now on the video keeps it on too
              wakeReleased = true;
              connLog.add('wake: wake lock released while visible');
              syncWakeVideo().catch(() => { /* nothing else to try */ });
            } else connLog.add('wake: wake lock released by the system');
          });
          wakeLock = lock;
          wakeRefused = false;
          connLog.add('wake: wake lock on');
        } else if (!wakeWanted && wakeLock) {
          const lock = wakeLock;
          wakeLock = null;
          await lock.release();
          connLog.add('wake: wake lock off');
        } else break;
      }
    } catch { /* release failed: the sentinel is gone either way */ }
    finally { wakeWork = null; }
    try { await syncWakeVideo(); } catch { /* no DOM, or the browser said no: nothing else to try */ }
  })();
  return wakeWork;
}

/** Is the screen being kept on? (A native lock that may be ignored here — see wakeFallbackReason — does not count.) */
export function wakeLockActive() {
  const native = !!wakeLock && !wakeNeedsFallback({ ...wakeEnv(), refused: false, released: false });
  return native || (!!wakeVideo && !wakeVideo.video.paused);
}

// The join / host tap is the best gesture there is: catch the very first tap where the fallback will be needed.
if (globalThis.document?.addEventListener && globalThis.navigator && wakeNeedsFallback(wakeEnv())) armWakeGesture();

/** Simple deterministic sleep for retry backoff. */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
