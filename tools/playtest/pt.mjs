#!/usr/bin/env node
// ============================================================
// tools/playtest/pt.mjs — multi-window playtest console for AI players.
//
// One headless Chrome holds one "phone" window per seat (390×844, mobile metrics).
// A small daemon keeps the CDP sessions alive; every player drives ONLY its own
// window through this CLI, like a person holding one phone.
//
//   node tools/playtest/pt.mjs start  <session> --seats p1,p2,p3 [--base URL] [--names 阿聰,阿明,…] [--shared]
//   node tools/playtest/pt.mjs setup  <session> --game <id> [--config '{"k":v}'] [--narration silent|read|voice]
//   node tools/playtest/pt.mjs see    <session> <seat>              what this phone shows (text, controls [n], overlays)
//   node tools/playtest/pt.mjs tap    <session> <seat> <n|"label">  tap control n (or the first control whose label contains the text)
//   node tools/playtest/pt.mjs hold   <session> <seat> <n|"label"> [ms]   press and hold (hold-to-peek); prints the screen WHILE held
//   node tools/playtest/pt.mjs type   <session> <seat> <n|"label"> <text> focus a text box and type
//   node tools/playtest/pt.mjs draw   <session> <seat> <n> "x,y x,y …"   drag a finger on a canvas (0–1 coordinates)
//   node tools/playtest/pt.mjs scroll <session> <seat> <dy>          scroll the page (px, negative = up)
//   node tools/playtest/pt.mjs wait   <session> <seat> [sec=25]     block (max 90 s) until this screen changes or someone speaks, then print it
//   node tools/playtest/pt.mjs key    <session> <seat> [Enter|Escape|Backspace|Tab]   press a key (Enter / Escape also answer an open dialog)
//   node tools/playtest/pt.mjs dialog <session> <seat> accept|dismiss [text]   answer the native confirm()/prompt() open on this phone
//   node tools/playtest/pt.mjs reload <session> <seat>              reload this phone's tab (the only safe way to reload — keeps tap coordinates right)
//   node tools/playtest/pt.mjs shot   <session> <seat>              save a PNG screenshot, print its path
//   node tools/playtest/pt.mjs show   <session> <seat> [off]        --shared only: the holder lays their screen face up for everyone (read-only)
//   node tools/playtest/pt.mjs say    <session> <seat> <text>       talk at the table (everyone can hear)
//   node tools/playtest/pt.mjs hear   <session> [n=30]              the last n things said at the table (the narrator too: 「🔊 旁白：…」)
//   node tools/playtest/pt.mjs eval   <session> <seat> <js>         ORCHESTRATOR ONLY (setup / final result) — players must not use it
//   node tools/playtest/pt.mjs stop   <session>
//   node tools/playtest/pt.mjs selftest                             offline self-check of the console itself (own Chrome, local page, cleans up)
//
// Native dialogs (window.confirm / prompt / alert / beforeunload):
//   * confirm / prompt  freeze the page like on a real phone. `see` shows  [dialog] confirm "…"  with controls
//     [1] OK / [2] Cancel; answer with `dialog … accept|dismiss`, `tap … 1|2|ok|cancel`, or `key … Enter|Escape`.
//     Nothing is auto-accepted: the player makes the choice. Taps never block on a dialog.
//   * alert  is dismissed automatically and reported once in the next screen as  [alert] "…" — dismissed automatically.
//   * beforeunload is accepted automatically (a reload / leave goes through) and reported the same way.
// Every phone has a fake text-to-speech: 🔊 語音 narration runs headless, and each spoken line lands in `hear`.
// --shared: ONE phone for the whole table (一部手機玩); a referee follows the app's one-phone contract (DESIGN §7.1).
//
// Node 18+ (global WebSocket: Node 22+). No packages. Rules for AI players: tools/playtest/README.md
// ============================================================

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SESS_DIR = path.join(HERE, '.sessions');
const SHOT_DIR = path.join(os.tmpdir(), 'bgbox-playtest-shots');
const CHROME = [
  process.env.PT_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && fs.existsSync(p));
const DEFAULT_BASE = 'https://pych0413.github.io/bgbox/';
const DEFAULT_NAMES = ['阿聰', '阿明', '小美', '大熊', '阿強', '阿珍', '阿文', '阿芬', '阿輝', '阿玲', '阿傑', '阿欣'];
const W = 390, H = 844;
/** `wait` never blocks longer than this: an agent's shell call times out at 120 s (T6). */
export const WAIT_MAX_S = 90;
/** --shared: how long a named pass gate must have been up before the host may act on 「X 唔喺度？」 (T5). */
const ESCAPE_AFTER_MS = Math.max(0, Number(process.env.PT_ESCAPE_AFTER ?? 60)) * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sessFile = (s) => path.join(SESS_DIR, `${s}.json`);
const chatFile = (s) => path.join(SESS_DIR, `${s}.chat.jsonl`);

function freePort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
    srv.on('error', rej);
  });
}

/** Thrown when a native dialog is (or just became) open on a seat: the page's JS is frozen, so nothing can be evaluated. */
class DialogOpen extends Error {
  constructor(seat, d) {
    super(`a native ${d?.type ?? 'dialog'} is open on ${seat}${d ? `: ${JSON.stringify(d.message)}` : ''} — answer it first (dialog <session> ${seat} accept|dismiss)`);
    this.seat = seat;
  }
}

const ACCEPT_WORDS = new Set(['1', 'accept', 'ok', 'yes', 'y', '好', '確定', '确定']);
const DISMISS_WORDS = new Set(['2', 'dismiss', 'cancel', 'no', 'n', '取消']);
/** Commands whose normal reply is "what this phone shows now" — a dialog in the way is part of that reply, not an error. */
const SCREEN_OPS = new Set(['see', 'tap', 'hold', 'type', 'key', 'draw', 'scroll', 'wait', 'reload']);

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; } else out._.push(a);
  }
  return out;
}

// ------------------------------------------------------------
// Pure helpers (exported for tests/playtest.test.mjs)
// ------------------------------------------------------------

/**
 * One phone, one finger at a time (T4): every op that touches a phone runs through that phone's queue, so two
 * players (or a `shot` and a `tap`) can never interleave their CDP calls. Not re-entrant: never run() inside run().
 */
export function makeLock() {
  let tail = Promise.resolve();
  return {
    run(fn) {
      const p = tail.then(() => fn());
      tail = p.then(() => {}, () => {});
      return p;
    },
  };
}

/** One line of `hear`. Narrator rows (the fake TTS) read 「🔊 旁白：…」; console notes everybody saw are plain. */
export function chatLine(r) {
  const t = `[${String(r?.t ?? '').slice(11, 19)}Z]`;
  if (r?.narr) return `${t} 🔊 旁白${r.from ? `（${r.from}部機）` : ''}：${r.text}`;
  if (r?.note) return `${t} ${r.text}`;
  return `${t} ${r?.name}(${r?.seat}): ${r?.text}`;
}

/** The focus signature the app uses (logic.focusSig): called seats sorted + anonymous + step + open. */
export function stepSig(focus) {
  if (!focus || typeof focus !== 'object') return '';
  const pids = Array.isArray(focus.pids) ? focus.pids.filter((x) => typeof x === 'string').sort() : [];
  return JSON.stringify([pids, focus.anonymous ? String(focus.anonymous) : '', typeof focus.step === 'string' ? focus.step : '', focus.open === true]);
}

/**
 * What a `show` is bound to: the holder, the phase, the step (focus signature), night, a gate, the header (title and
 * subtitle, digits ignored so a countdown does not count) and the holder's view stage. Any change ends the show,
 * so a public screen that turns into a private one never stays face up.
 */
export function showKey(r) {
  return JSON.stringify([r?.activeSeat ?? null, r?.phase ?? null, stepSig(r?.focus), !!r?.night, !!r?.gate,
    String(r?.header ?? '').replace(/\d+/g, '#'), r?.vstep ?? '']);
}

/** The seat a named pass gate is for, from its title: 「交俾 X」 (private / switch) or 「輪到 X · …」 (public). */
export function gateTarget(title, players) {
  const t = String(title ?? '').trim();
  let best = null;
  for (const p of players ?? []) {
    if (!p?.name) continue;
    const hit = t === `交俾 ${p.name}` || t.startsWith(`交俾 ${p.name} `) || t === `輪到 ${p.name}` || t.startsWith(`輪到 ${p.name} · `);
    if (hit && (!best || p.name.length > best.name.length)) best = p;
  }
  return best?.id ?? null;
}

/**
 * A name picker on the phone in the middle (the seat chip's list, askWho's 「邊個…？」 sheet): each person picks only
 * their own name. → null when `label` is fine for `me`, else the other person's name it carries.
 */
export function otherName(label, me, players) {
  const l = String(label ?? '');
  const hits = (players ?? []).filter((p) => p?.name && l.includes(p.name));
  const named = hits.filter((h) => !hits.some((o) => o !== h && o.name.length > h.name.length && o.name.includes(h.name)));
  if (!named.length || named.some((h) => h.id === me)) return null;
  return named[0].name;
}

/**
 * The --shared referee: who may see and touch the ONE phone, as a pure function of what the app shows (DESIGN §7.1,
 * "For the console"). `r` = the page snapshot (REF_JS), `me` / `host` = pids, `shown` = the showKey laid face up.
 * → { level, why, tap?, behind?, target?, who?, dark?, keepShow? }
 *   'full'  this person holds the phone (or is awake on the same night screen, U2): sees and touches it
 *   'table' the phone lies face up in the middle: everyone sees it, anyone may tap (a name list: only their own name)
 *   'read'  held by someone else but face up (their public one-person step, or `show`): see, no touch
 *   'gate'  a pass gate this person may look at; tap 'all' | 'escape' (the host: the 「X 唔喺度？」 row) | 'none';
 *           behind: the screen behind the card is public (data-gate public / table)
 *   'none'  not for this person's eyes (eyes closed at night, or someone else holds it privately)
 */
export function decide(r, { me = null, host = null, shown = null } = {}) {
  if (!r || r.mode !== 'local') return { level: 'full' };
  const players = Array.isArray(r.players) ? r.players : [];
  const mine = Array.isArray(r.mySeats) ? r.mySeats : [];
  const nameOf = (pid) => players.find((p) => p.id === pid)?.name ?? '?';
  const playing = players.filter((p) => !p.spectator && mine.includes(p.id)).map((p) => p.id);
  if (r.phase !== 'playing') {
    return { level: 'table', why: r.phase === 'results'
      ? '📱 完咗 — 部手機擺喺枱中間：人人睇到，邊個都可以㩒'
      : '📱 部手機擺喺枱中間：人人睇到，邊個都可以㩒' };
  }
  const f = r.focus && typeof r.focus === 'object' ? r.focus : null;
  const anon = !!f?.anonymous;
  const called = (Array.isArray(f?.pids) ? f.pids : []).filter((pid) => playing.includes(pid));
  const dark = anon || !!r.night;
  const closed = r.narration === 'silent'
    ? '🌙 夜晚 — 部手機冚住擺喺枱中間，叫到你先好拎'
    : '🌙 你閉緊眼 — 部手機喺枱中間。聽旁白（hear / wait），叫到你先好拎部手機';
  const current = r.activeSeat && playing.includes(r.activeSeat) ? r.activeSeat : null;
  const isHost = !!me && me === host;

  if (r.gate) {
    const kind = String(r.gate.kind || 'private');
    const title = String(r.gate.title ?? '');
    if (kind === 'anon' || dark) {
      // eyes closed: only a seat this step calls looks — the real gate and a decoy look the same to everyone else
      if (me && called.includes(me)) return { level: 'gate', tap: 'all', behind: false, why: '🌙 叫到你 — 張卡係俾你㩒（同一步醒嘅人都可以㩒）' };
      return { level: 'none', dark: true, why: closed };
    }
    if (kind === 'table') {
      return { level: 'gate', tap: 'all', behind: true, why: `[交接卡 · 公開] 「${title}」— 人人睇到，邊個㩒都得（一下就得）` };
    }
    const target = gateTarget(title, players);
    const may = target ? [target] : called.length ? called : playing;
    const behind = kind === 'public';
    if (me && may.includes(me)) {
      return { level: 'gate', tap: 'all', behind, target, why: behind
        ? `[交接卡 · 公開步驟] 「${title}」— 輪到你，㩒一下開始（大家一齊睇）`
        : `[交接卡] 「${title}」— 係俾你嘅，㩒一下接部手機` };
    }
    const who = target ? nameOf(target) : '被叫嗰個';
    const hostNote = isHost ? `；你係房主：佢真係唔喺度先好㩒「${who} 唔喺度？」` : '';
    return { level: 'gate', tap: isHost ? 'escape' : 'none', behind, target, who, why: behind
      ? `[交接卡 · 公開步驟] 「${title}」— 後面個畫面人人睇到，只有 ${who} 可以㩒張卡${hostNote}`
      : `[交接卡] 「${title}」— 張卡人人睇到（後面乜都睇唔到），只有 ${who} 可以㩒${hostNote}` };
  }
  if (dark) {
    // U2: everyone an eyes-closed (anonymous) step calls on this phone shares ONE screen. A NAMED step at night is a
    // walk (the shell hands the phone to one seat at a time), so there only the holder looks.
    if (me && called.includes(me) && current && called.includes(current) && (anon || me === current)) {
      return { level: 'full', why: called.length > 1 ? '🌙 同一步醒緊：你哋一齊睇同一個畫面' : '' };
    }
    return { level: 'none', dark: true, why: closed };
  }
  if (!current) return { level: 'table', why: '📱 部手機擺喺枱中間 — 人人睇到，邊個都可以㩒枱面嘅掣（揀名就揀返你自己個名）' };
  const key = showKey(r);
  if (me === current) return { level: 'full', keepShow: shown === key };
  if (f?.open === true && (f.pids ?? []).includes(current)) {
    return { level: 'read', keepShow: shown === key, why: `（輪到 ${nameOf(current)} · 公開步驟 — 大家一齊睇，唔可以㩒）` };
  }
  if (shown && shown === key) return { level: 'read', keepShow: true, why: `（${nameOf(current)} 將部手機擺咗出嚟俾大家睇 — 睇得，唔㩒得）` };
  return { level: 'none', why: `📱 ${nameOf(current)} 拎緊部手機 — 等佢交俾你，或者佢㩒「📱 擺返中間」；想睇佢個畫面就叫佢 show` };
}

/**
 * A fake text-to-speech for headless phones, installed before any page script on every phone: speechSynthesis and
 * SpeechSynthesisUtterance that "speak" for a length-based time (well inside the narrator's own fallback) and fire
 * start / end / error like a real engine, so 🔊 語音 narration works headless. Each line spoken out loud (not empty,
 * volume > 0) is handed to the daemon through the binding `__ptNarr` and lands in the table talk as 「🔊 旁白：…」 —
 * that is how eyes-closed players hear the narrator. Self-contained (it is serialised into the page);
 * `opts.scale` shrinks the timing for tests.
 */
export function fakeTTS(win, opts = {}) {
  if (!win || win.__ptTTS) return;
  const scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
  const later = (fn, ms) => win.setTimeout(fn, ms);
  const voice = Object.freeze({ voiceURI: 'pt-fake-yue', name: '模擬粵語（playtest）', lang: 'zh-HK', localService: true, default: true });
  const synthListeners = {};
  const queue = [];
  let current = null;
  let timer = null;
  let paused = false;
  const emit = (target, listeners, type, extra) => {
    const ev = { type, target, ...extra };
    const run = (fn) => { try { fn.call(target, ev); } catch (e) { later(() => { throw e; }, 0); } };
    if (typeof target['on' + type] === 'function') run(target['on' + type]);
    for (const fn of [...(listeners[type] ?? [])]) run(fn);
  };
  const duration = (u) => {
    const s = String(u.text ?? '');
    const cjk = (s.match(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g) ?? []).length;
    const pauses = (s.match(/[，。！？、；：…,.!?;:\n]/g) ?? []).length;
    const other = Math.max(0, s.replace(/\s/g, '').length - cjk - pauses);
    const rate = Math.min(2, Math.max(0.5, Number(u.rate) || 1));
    return Math.max(300, Math.round((cjk * 200 + other * 70 + pauses * 280) / rate + 300)) * scale;
  };
  const report = (u) => {
    const text = String(u.text ?? '').trim();
    if (!text || Number(u.volume) <= 0) return;
    try { if (typeof win.__ptNarr === 'function') win.__ptNarr(JSON.stringify({ text: text.slice(0, 500) })); } catch { /* nobody listening */ }
  };
  const pump = () => {
    if (current || paused || !queue.length) return;
    const u = queue.shift();
    current = u;
    timer = later(() => {
      if (current !== u) return;
      emit(u, u.__l, 'start', { utterance: u, charIndex: 0, elapsedTime: 0, name: '' });
      report(u);
      const ms = duration(u);
      timer = later(() => {
        if (current !== u) return;
        current = null;
        timer = null;
        emit(u, u.__l, 'end', { utterance: u, charIndex: String(u.text ?? '').length, elapsedTime: ms, name: '' });
        pump();
      }, ms);
    }, 30 * scale);
  };
  class SpeechSynthesisUtterance {
    constructor(text) {
      this.text = text == null ? '' : String(text);
      this.lang = '';
      this.voice = null;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      for (const k of ['onstart', 'onend', 'onerror', 'onpause', 'onresume', 'onboundary', 'onmark']) this[k] = null;
      Object.defineProperty(this, '__l', { value: {}, enumerable: false });
    }
    addEventListener(type, fn) { if (typeof fn === 'function') (this.__l[type] ??= []).push(fn); }
    removeEventListener(type, fn) { const a = this.__l[type]; const i = a ? a.indexOf(fn) : -1; if (i >= 0) a.splice(i, 1); }
    dispatchEvent() { return true; }
  }
  const synth = {
    get speaking() { return !!current; },
    get pending() { return queue.length > 0; },
    get paused() { return paused; },
    onvoiceschanged: null,
    getVoices: () => [voice],
    speak(u) {
      if (!(u instanceof SpeechSynthesisUtterance)) throw new TypeError("Failed to execute 'speak' on 'SpeechSynthesis': parameter 1 is not of type 'SpeechSynthesisUtterance'.");
      queue.push(u);
      pump();
    },
    cancel() {
      const gone = [current, ...queue].filter(Boolean);
      queue.length = 0;
      current = null;
      if (timer !== null) win.clearTimeout(timer);
      timer = null;
      for (const u of gone) emit(u, u.__l, 'error', { utterance: u, error: 'canceled', charIndex: 0, elapsedTime: 0, name: '' });
    },
    pause() { paused = true; },
    resume() { if (paused) { paused = false; pump(); } },
    addEventListener(type, fn) { if (typeof fn === 'function') (synthListeners[type] ??= []).push(fn); },
    removeEventListener(type, fn) { const a = synthListeners[type]; const i = a ? a.indexOf(fn) : -1; if (i >= 0) a.splice(i, 1); },
    dispatchEvent() { return true; },
  };
  const define = (name, desc) => {
    try { Object.defineProperty(win, name, { configurable: true, enumerable: true, ...desc }); } catch { /* not configurable */ }
  };
  define('speechSynthesis', { get: () => synth });
  define('SpeechSynthesisUtterance', { writable: true, value: SpeechSynthesisUtterance });
  define('__ptTTS', { value: true });
  later(() => emit(synth, synthListeners, 'voiceschanged', {}), 0);
}
const FAKE_TTS_SRC = `(${fakeTTS.toString()})(window);`;

// ------------------------------------------------------------
// In-page helpers (serialised into Runtime.evaluate)
// ------------------------------------------------------------

/** Everything a person would see on this phone: visible text, numbered controls, covering overlays. */
function pageSee() {
  // lax: a modal (a pass gate, a sheet) and its fade-in wrappers count at any opacity — the gate's backdrop is opaque
  // from the first frame while the card fades in, so a person sees the card, never the screen behind it (T3). Only
  // those: inside the modal opacity still counts, so a closed hold-to-peek cover (front at opacity .001, e.g. the
  // 💡 sheet's role card) stays closed.
  const MODAL = '[aria-modal="true"], .c-passgate';
  const fades = (el) => el.matches(`${MODAL}, .c-passgate-card`) || !!el.querySelector(MODAL);
  const caches = [new Map(), new Map()];
  const styleVisible = (el, lax = false) => {
    const cache = caches[lax ? 1 : 0];
    if (cache.has(el)) return cache.get(el);
    let ok = true;
    if (el.hidden) ok = false;
    else {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || (parseFloat(s.opacity) < 0.05 && !(lax && fades(el)))) ok = false;
      else if (el.parentElement && el.parentElement !== document.documentElement) ok = styleVisible(el.parentElement, lax);
    }
    cache.set(el, ok);
    return ok;
  };
  const boxVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  // visible text in reading order, one line per block; die faces and other pictures say their label ([4 點]),
  // progress bars their value ([⏳ 仲有 8 秒])
  const BLOCK = 'p, li, h1, h2, h3, h4, button, [role=button], label, summary, td, th, .tag, div, section';
  const readText = (root, laxV, skip) => {
    const lines = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      { acceptNode: (x) => (skip && x === skip ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let last = null, buf = '';
    const flush = () => { const t = buf.replace(/\s+/g, ' ').trim(); if (t) lines.push(t); buf = ''; };
    const at = (block) => { if (block !== last) { flush(); last = block; } };
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (t.nodeType === 1) {
        const role = t.getAttribute('role');
        if (role !== 'img' && role !== 'progressbar' && role !== 'meter') continue;
        if (t.closest('details:not([open])') && !t.closest('summary')) continue;
        if (!styleVisible(t, laxV) || !boxVisible(t)) continue;
        let label = (t.getAttribute('aria-label') || '').trim();
        if (role !== 'img') {
          const vt = t.getAttribute('aria-valuetext');
          const now = t.getAttribute('aria-valuenow');
          const max = t.getAttribute('aria-valuemax');
          label = `⏳ ${[label, vt || (now != null ? (max != null ? `${now}/${max}` : now) : '')].filter(Boolean).join(' ')}`.trim();
        }
        if (!label || label === '⏳') continue;
        at(t.parentElement?.closest(BLOCK) ?? null);
        buf += ` [${label}]`;
        continue;
      }
      const p = t.parentElement;
      if (!p || !t.nodeValue.trim()) continue;
      if (p.closest('script, style, noscript')) continue;
      if (p.closest('details:not([open])') && !p.closest('summary')) continue;   // folded: not on screen
      if (!styleVisible(p, laxV) || !boxVisible(p)) continue;
      at(p.closest(BLOCK));
      buf += ' ' + t.nodeValue;
    }
    flush();
    return lines.filter((l, i) => l !== lines[i - 1]).join('\n').slice(0, 6000);
  };

  // full-screen-ish covers (night dim, sheets, pass gates): a person sees these first
  const overlays = [];
  for (const el of document.body.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'absolute') continue;
    if (!styleVisible(el) || !boxVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (area < innerWidth * innerHeight * 0.5) continue;
    const bg = s.backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    const alpha = m ? (m[1].split(',')[3] !== undefined ? parseFloat(m[1].split(',')[3]) : 1) : 0;
    // a fixed backdrop painted with a gradient is not see-through, whatever its background-color says (T3)
    const img = s.position === 'fixed' && !!s.backgroundImage && s.backgroundImage !== 'none';
    const op = parseFloat(s.opacity) * (img ? 1 : alpha);
    if (el.id === 'app' || el.closest('#app') === el.parentElement && s.position === 'absolute' && op < 0.3) continue;
    // its text as a person sees it — not innerText, which ignores opacity and would print a closed cover's face
    const otext = readText(el, true, null).replace(/\s+/g, ' ').trim();
    if (op < 0.3 && !otext) continue;
    overlays.push({ cls: String(el.className || el.tagName).slice(0, 40), cover: Math.round(op * 100), pe: s.pointerEvents, text: otext.slice(0, 80) });
  }

  document.querySelectorAll('[data-pt]').forEach((e) => e.removeAttribute('data-pt'));
  // A full-screen modal (pass gate, alert dialog) hides everything behind it: read only what it shows — at any
  // opacity (T3). A PUBLIC pass gate (data-gate public / table, DESIGN §7.1) leaves the screen behind readable.
  const modal = [...document.querySelectorAll(MODAL)].reverse().find((el) => styleVisible(el, true) && boxVisible(el));
  const gateEl = modal && modal.matches('.c-passgate') ? modal : null;
  const gate = gateEl ? { kind: gateEl.getAttribute('data-gate') || 'private', title: gateEl.getAttribute('aria-label') || '', public: gateEl.classList.contains('is-public') } : null;
  const scope = modal ?? document.body;
  const lax = !!modal;
  const SEL = 'button, [role=button], a[href], input, textarea, select, summary, canvas';
  const items = [];
  const meta = [];
  let n = 0;
  for (const el of scope.querySelectorAll(SEL)) {
    if (!styleVisible(el, lax) || !boxVisible(el)) continue;
    if (el.closest('details:not([open])') && !el.closest('summary')) continue;
    if (el.matches('summary') && el.closest('button')) continue;
    const id = ++n;
    el.setAttribute('data-pt', String(id));
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let covered = false;
    if (cy >= 0 && cy <= innerHeight && cx >= 0 && cx <= innerWidth) {
      const top = document.elementFromPoint(cx, cy);
      covered = !!top && top !== el && !el.contains(top) && !top.contains(el);
    }
    const tag = el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label') || el.innerText || el.placeholder || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 70);
    let kind = tag === 'button' || el.getAttribute('role') === 'button' ? 'button' : tag;
    if (tag === 'input' || tag === 'textarea') kind = `${el.type === 'range' ? 'slider' : 'textbox'}=${JSON.stringify(el.value)}${el.type === 'checkbox' ? (el.checked ? ' ☑' : ' ☐') : ''}`;
    if (tag === 'select') kind = `select=${JSON.stringify(el.options[el.selectedIndex]?.text ?? '')} options: ${[...el.options].map((o) => o.text).join(' | ').slice(0, 160)}`;
    if (el.classList.contains('c-cover')) kind = 'hold-to-peek cover';
    if (tag === 'canvas') kind = `canvas ${Math.round(r.width)}×${Math.round(r.height)}`;
    const fl = [];
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') fl.push('disabled');
    if (el.getAttribute('aria-pressed') === 'true' || el.classList.contains('on') || el.classList.contains('selected') || el.classList.contains('is-on')) fl.push('selected');
    if (el.getAttribute('aria-expanded') === 'true' || el.closest('details')?.open && tag === 'summary') fl.push('open');
    if (cy < 0) fl.push('above-screen'); else if (cy > innerHeight) fl.push('below-screen');
    if (covered) fl.push('COVERED');
    items.push(`[${id}] ${kind}${label ? ` "${label}"` : ''}${fl.length ? ` (${fl.join(', ')})` : ''}`);
    // for the --shared referee: the host's 「X 唔喺度？」 row on a gate, and a name in a seat / askWho name list
    meta.push({
      label,
      esc: !!el.closest('.c-passgate-escape'),
      pick: !!el.closest('.menu-sheet') && !!el.querySelector('.dot') && !el.closest('.absent-pick'),
    });
  }

  const text = readText(scope, lax, null);
  // a public card sits over a public screen: that screen is part of what everybody sees (taps on it are blocked)
  const behind = gate && gate.public ? readText(document.body, false, gateEl) : null;
  const norm = (s) => s.replace(/\d+/g, '#');
  let h = 0;
  for (const ch of norm(text + (behind ?? '') + items.join('|') + (gate ? gate.kind : ''))) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return {
    title: document.title, scroll: `${Math.round(scrollY)}/${Math.max(0, document.documentElement.scrollHeight - innerHeight)}`,
    overlays, items, meta, text, behind, gate, hash: h,
  };
}

/**
 * --shared: what the referee needs from the app, read in the SAME evaluation as the screen (OBSERVE_JS), so a
 * decision and the screen it lets through can never belong to two different moments.
 */
const REF_JS = `(() => { const a = window.__app; const s = a && a.state;
  if (!s || s.mode !== 'local') return { mode: s ? s.mode : null };
  const g = document.querySelector('.c-passgate');
  const views = s.views || {};
  const night = !!(s.table && s.table.night) || Object.values(views).some((v) => !!(v && v.night));
  const mine = s.mySeats || [];
  const cur = s.activeSeat && mine.includes(s.activeSeat) ? s.activeSeat : null;
  const v = cur ? views[cur] : s.table;
  const stage = (x) => (typeof x === 'string' || typeof x === 'number' ? x : x && typeof x === 'object' && typeof x.kind === 'string' ? x.kind : null);
  const f = s.focus;
  const head = document.querySelector('.play-name');
  return { mode: 'local', phase: s.room.phase, activeSeat: cur, mySeats: mine, night,
    narration: (s.room.narration && s.room.narration.mode) || 'voice',
    gate: g ? { kind: g.getAttribute('data-gate') || 'private', title: g.getAttribute('aria-label') || '' } : null,
    focus: f ? { pids: Array.isArray(f.pids) ? f.pids : [], anonymous: f.anonymous || null, open: f.open === true, step: typeof f.step === 'string' ? f.step : null, label: f.label || null } : null,
    header: head ? head.innerText : '',
    vstep: v ? JSON.stringify([stage(v.stage), stage(v.phase), stage(v.step), stage(v.round)]) : '',
    players: (s.room.players || []).map((p) => ({ id: p.id, name: p.name, spectator: !!p.spectator })) }; })()`;
const OBSERVE_JS = `(() => ({ r: ${REF_JS}, s: (${pageSee.toString()})() }))()`;

// ------------------------------------------------------------
// Daemon: Chrome + CDP sessions + HTTP command server
// ------------------------------------------------------------

async function daemon(session, seats, base, names, shared = false) {
  fs.mkdirSync(SESS_DIR, { recursive: true });
  const dport = await freePort();
  const hport = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `pt-${session}-`));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--window-size=${W},${H}`, 'about:blank',
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 60 && !ver; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${dport}/json/version`)).json(); } catch { await sleep(250); }
  }
  if (!ver) throw new Error('Chrome did not start');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
    } else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const phones = {};
  const phoneOf = (seat) => {
    const p = phones[seat];
    if (!p) throw new Error(`unknown seat ${seat} (seats: ${Object.keys(phones).join(', ')})`);
    return p;
  };

  // ---------- table talk (say / hear, and the narrator) ----------
  const appendChat = (row) => fs.appendFileSync(chatFile(session), JSON.stringify({ t: new Date().toISOString(), ...row }) + '\n');
  const chatRows = () => {
    let raw = '';
    try { raw = fs.readFileSync(chatFile(session), 'utf8'); } catch { return []; }
    return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  };

  // Phone metrics: applied at start, after every reload, and again on every main-frame navigation, so a tab that was
  // reloaded by something else (a second CDP client) cannot leave this seat's taps at half coordinates.
  // force: clear first. Setting identical params again is a no-op inside Chrome, which would not undo a reset
  // caused by another client detaching (the page drops to DPR 1 while Chrome still believes our override is live).
  const applyEmulation = async (p, force = false) => {
    if (force) await send('Emulation.clearDeviceMetricsOverride', {}, p.sessionId).catch(() => {});
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true }, p.sessionId);
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }, p.sessionId).catch(() => {});
  };

  // Native dialogs. Chrome blocks the page's JS (and any CDP call that needs it) until a dialog is answered, so
  // the daemon tracks them per session and every other op checks before it touches the page.
  const watch = (p) => {   // resolves when a dialog that needs the player opens on this phone
    let fn;
    const promise = new Promise((res) => { fn = res; p.watchers.add(fn); });
    return { promise, off: () => p.watchers.delete(fn) };
  };
  const note = (p, type, message, how) => { p.notices.push({ type, message: String(message ?? '').slice(0, 300), how }); if (p.notices.length > 8) p.notices.shift(); };
  const seatNames = Object.fromEntries(seats.map((seat, i) => [seat, names[i] ?? seat]));
  const nameOf = (seat) => seatNames[seat] ?? seat;
  listeners.add((msg) => {
    const p = Object.values(phones).find((x) => x.sessionId === msg.sessionId);
    if (!p) return;
    if (msg.method === 'Page.javascriptDialogOpening') {
      const { type, message, defaultPrompt } = msg.params;
      if (type === 'alert' || type === 'beforeunload') {
        note(p, type, message || (type === 'beforeunload' ? 'leave this page?' : ''), type === 'alert' ? 'dismissed automatically' : 'accepted automatically so the page can leave');
        send('Page.handleJavaScriptDialog', { accept: true }, p.sessionId).catch(() => {});
      } else {
        p.dialog = { type, message: String(message ?? ''), defaultPrompt: defaultPrompt ?? '' };
        for (const w of [...p.watchers]) w();
      }
    } else if (msg.method === 'Page.javascriptDialogClosed') {
      p.dialog = null;
    } else if (msg.method === 'Page.frameNavigated' && !msg.params.frame.parentId) {
      p.navs++;
      p.vp = null;   // a new document: measure the phone again on the next tap
      p.dialog = null; p.pendingRelease = null;   // the old document's dialog and half-done press went with it
      applyEmulation(p, true).catch(() => {});
    } else if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__ptNarr') {
      // the fake TTS said a line out loud: the whole table hears it
      let text = '';
      try { text = String(JSON.parse(msg.params.payload)?.text ?? '').trim().slice(0, 500); } catch { /* not ours */ }
      const seat = Object.keys(phones).find((k) => phones[k] === p) ?? '?';
      if (text) appendChat({ seat, name: '🔊 旁白', text, narr: true, ...(!shared && seat !== seats[0] ? { from: nameOf(seat) } : {}) });
    }
  });

  // --shared: ONE phone passed around the table. Every seat drives the same window, and the referee below
  // decides what each person may see or touch (DESIGN §7.1: the phone in the middle, pass gates, eyes closed at night).
  for (const [i, seat] of seats.entries()) {
    if (shared && i > 0) { phones[seat] = phones[seats[0]]; continue; }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true, width: W, height: H });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const p = phones[seat] = { targetId, sessionId, name: shared ? 'phone' : (names[i] ?? seat), shots: 0, dialog: null, watchers: new Set(), notices: [], pendingRelease: null, navs: 0, vp: null, lock: makeLock() };
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Runtime.addBinding', { name: '__ptNarr' }, sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_TTS_SRC }, sessionId);
    await applyEmulation(p);
    const url = `${base}${base.includes('?') ? '&' : '?'}as=${encodeURIComponent(`${session}-${shared ? 'phone' : seat}`)}`;
    await send('Page.navigate', { url }, sessionId);
  }

  const evaluate = async (seat, expr, awaitPromise = true) => {
    const p = phoneOf(seat);
    if (p.dialog) throw new DialogOpen(seat, p.dialog);
    const w = watch(p);
    try {
      const sp = send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true }, p.sessionId);
      sp.catch(() => {});   // if a dialog wins the race this one settles later, after the player answers
      const r = await Promise.race([sp, w.promise.then(() => { throw new DialogOpen(seat, p.dialog); })]);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    } finally { w.off(); }
  };
  const dialogScreen = (d) => ({
    dialog: d, title: 'dialog open', scroll: '-', overlays: [], text: '', hash: `dialog:${d.type}:${d.message}`,
    items: ['[1] button "OK" (accept)', '[2] button "Cancel" (dismiss)'], meta: [],
  });
  const see = async (seat) => {
    const p = phoneOf(seat);
    if (p.dialog) return dialogScreen(p.dialog);
    return evaluate(seat, `(${pageSee.toString()})()`);
  };
  const fmt = (seat, s) => {
    const p = phones[seat];
    const out = [`== ${seat} ${nameOf(seat)}${shared ? ' | 📱 shared phone' : ''} | ${s.title} | scroll ${s.scroll} ==`];
    for (const n of p.notices.splice(0)) out.push(`[${n.type}] "${n.message}" — ${n.how}`);
    if (s.dialog) {
      const d = s.dialog;
      d.seen = true;   // from now on tap 1 / tap 2 / key Enter / Escape answer it
      out.push(`[dialog] ${d.type} ${JSON.stringify(d.message)}${d.type === 'prompt' ? ` (default ${JSON.stringify(d.defaultPrompt)})` : ''}`,
        'the page behind it is frozen until this is answered — on the host phone that stalls the whole room',
        '--- controls ---', ...s.items,
        `answer: dialog <session> ${seat} accept|dismiss${d.type === 'prompt' ? ' [text]' : ''}   (or tap 1 / tap 2, key Enter / Escape)`);
      return out.join('\n');
    }
    for (const o of s.overlays) out.push(`[overlay] ${o.cls} — covers the screen at ${o.cover}% darkness${o.pe === 'none' ? ' (taps pass through)' : ''}${o.text ? ` · "${o.text}"` : ''}`);
    if (s.gate) out.push(`[pass gate: ${s.gate.kind}] ${s.gate.public ? 'a light card — the screen behind stays visible, taps on it are blocked' : 'covers the whole screen'}`);
    out.push('--- screen text ---', s.text || '(no text)');
    if (s.behind != null) out.push('--- behind the card (everyone sees it; taps blocked) ---', s.behind || '(no text)');
    out.push('--- controls ---', ...(s.items.length ? s.items : ['(none)']));
    return out.join('\n');
  };
  const resolve = async (seat, ref) => {
    const s = await see(seat);   // renumbers controls to match what the player last saw
    if (s.dialog) throw new DialogOpen(seat, s.dialog);
    let n = Number(ref);
    if (!Number.isInteger(n) || String(n) !== String(ref).trim()) {
      const hit = s.items.find((line) => line.includes(String(ref)));
      if (!hit) throw new Error(`no control matching ${JSON.stringify(ref)}\n${fmt(seat, s)}`);
      n = Number(hit.match(/^\[(\d+)\]/)[1]);
    }
    const measure = () => evaluate(seat, `(() => { const el = document.querySelector('[data-pt="${n}"]'); if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top, vp: [innerWidth, innerHeight, devicePixelRatio] }; })()`);
    let box = await measure();
    if (!box) throw new Error(`control [${n}] is gone — run see again`);
    // The phone's metrics belong to this daemon's CDP session. If something else replaced or cleared them (a second
    // CDP client), taps land in the wrong place: notice the drift and put the phone back before tapping.
    const p = phones[seat];
    const drifted = box.vp[2] !== 2 || (p.vp && (box.vp[0] !== p.vp[0] || box.vp[1] !== p.vp[1]));
    if (drifted) { await applyEmulation(p, true); await sleep(300); box = await measure() ?? box; }
    // The numbers above can all look right while input is still mapped wrong: an outside client's `scale` override
    // or a page zoom puts every tap at half (or double) the coordinates. Hover the target and ask the page where it
    // felt the finger; if that is off, reset the phone once, and refuse to tap blind if it is still off.
    // Two moves (1 px apart) so at least one is a real move; a move mapped off the screen is not felt at all.
    const feel = async () => {
      await evaluate(seat, `(() => { window.__ptFelt = null; if (!window.__ptFeel) { window.__ptFeel = (e) => { window.__ptFelt = [e.clientX, e.clientY]; }; addEventListener('mousemove', window.__ptFeel, true); } })()`);
      for (const d of [1, 0]) await input(seat, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + d, y: box.y + d, button: 'none', buttons: 0 });
      // mouse moves reach the page on its next animation frame, not with the CDP reply: give it a few frames
      const f = await evaluate(seat, `(async () => { for (let i = 0; i < 12 && !window.__ptFelt; i++) await new Promise((r) => setTimeout(r, 25)); return window.__ptFelt; })()`);
      return !f ? 'unfelt' : Math.hypot(f[0] - box.x, f[1] - box.y) > 3 ? f : 'ok';
    };
    const onScreen = box.x >= 0 && box.y >= 0 && box.x < box.vp[0] && box.y < box.vp[1];   // a move off the screen is never felt
    if (onScreen && await feel() !== 'ok') {
      await applyEmulation(p, true);
      await send('Emulation.resetPageScaleFactor', {}, p.sessionId).catch(() => {});
      await sleep(300);
      box = await measure() ?? box;
      const still = await feel();
      if (Array.isArray(still)) throw new Error(`taps on ${seat} are landing in the wrong place (aimed at ${Math.round(box.x)},${Math.round(box.y)}, the page felt ${Math.round(still[0])},${Math.round(still[1])}): something outside this console (another CDP client) is changing this phone. Close it, then run reload.`);
    }
    p.vp = box.vp.slice(0, 2);
    await sleep(120);
    return box;
  };
  // Input never waits for the page's handler: a click that opens confirm() would otherwise hold the reply back
  // until the dialog is answered. Race the reply against "a dialog opened" (and a ceiling) instead.
  const input = async (seat, method, params, releaseAt) => {
    const p = phoneOf(seat);
    if (p.dialog) {   // modal: touches and keys do not reach the page; a skipped finger-lift is replayed once the dialog is answered
      if (releaseAt) p.pendingRelease = releaseAt;
      return;
    }
    const w = watch(p);
    try {
      const sp = send(method, params, p.sessionId);
      sp.catch(() => {});
      await Promise.race([sp, w.promise, sleep(4000)]);
    } finally { w.off(); }
  };
  const mouse = (seat, type, x, y, extra = {}) => input(seat, 'Input.dispatchMouseEvent',
    { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra }, type === 'mouseReleased' ? { x, y } : null);

  const answerDialog = async (seat, accept, text) => {
    const p = phoneOf(seat);
    const d = p.dialog;
    if (!d) return null;
    try {
      await send('Page.handleJavaScriptDialog', { accept, ...(d.type === 'prompt' && accept ? { promptText: text || d.defaultPrompt } : {}) }, p.sessionId);
    } catch (e) {
      if (!/no dialog is showing/i.test(e.message)) throw e;
      p.dialog = null;
    }
    for (let i = 0; i < 20 && p.dialog === d; i++) await sleep(25);   // wait for Page.javascriptDialogClosed
    if (p.dialog === d) p.dialog = null;
    if (p.pendingRelease) { const r = p.pendingRelease; p.pendingRelease = null; await mouse(seat, 'mouseReleased', r.x, r.y); }
    return d;
  };

  // ---------- referee for --shared (one phone, many people; DESIGN §7.1 "For the console") ----------
  // The app says where the phone is: app.state.activeSeat === null = face up in the middle (everyone reads it, anyone
  // taps a table control); a seat on screen = that person holds it; .c-passgate[data-gate] = a card on the table:
  // table (anyone taps; the screen behind is public) · public (only the named seat taps; everyone watches) ·
  // private / switch (only the named seat looks and taps) · anon (eyes closed: only the seats the step calls).
  // `decide` above is the whole rule; this part feeds it and keeps the bits of memory it needs.
  let shown = null;                          // the showKey of a holder's screen laid face up with `show`
  let gateSeen = { key: null, at: 0 };       // when the console first saw the gate that is up now (T5)
  const lastG = new Map();                   // seat → its last decision (what it may see while a native dialog is up)
  const lastNarration = () => {
    const rows = chatRows();
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].narr) return rows[i];
    return null;
  };
  const judge = (seat, r) => {
    const pidOf = (name) => r?.players?.find((p) => p.name === name)?.id ?? null;
    const me = pidOf(nameOf(seat));
    const host = pidOf(nameOf(seats[0]));
    if (r?.gate) {
      const k = `${r.gate.kind}|${r.gate.title}`;
      if (gateSeen.key !== k) gateSeen = { key: k, at: Date.now() };
    } else gateSeen = { key: null, at: 0 };
    const g = decide(r, { me, host, shown });
    if (!g.keepShow) shown = null;
    if (g.dark) {
      const n = lastNarration();
      if (n) g.why += `\n最近旁白（${String(n.t).slice(11, 19)}Z）：「${n.text}」`;
    }
    g.me = me;
    g.players = r?.players ?? [];
    g.gateAge = gateSeen.at ? Date.now() - gateSeen.at : 0;
    return g;
  };
  /** The referee's decision and the screen, from ONE evaluation of the page. */
  const observe = async (seat) => {
    const p = phoneOf(seat);
    if (p.dialog) {
      const last = lastG.get(seat);
      const g = last && ['full', 'table', 'read'].includes(last.level) ? last
        : { level: 'none', why: '📱 部手機彈咗個對話框出嚟 — 等拎住部手機嗰個答' };
      return { g, r: null, s: dialogScreen(p.dialog) };
    }
    const { r, s } = await evaluate(seat, OBSERVE_JS);
    const g = judge(seat, r);
    lastG.set(seat, g);
    return { g, r, s };
  };
  const refusal = (seat, g) => `== ${seat} ${nameOf(seat)} | 📱 shared phone ==\n${g.why}`;
  const readOnly = (seat, s, g) => `${g.why}\n${fmt(seat, { ...s, items: ['(read-only: the phone is not in your hands)'] })}`;
  const gateView = (seat, s, g) => {
    const items = s.items.map((line, i) => (g.tap === 'all' || (g.tap === 'escape' && s.meta?.[i]?.esc) ? line : `${line} — 唔係你㩒`));
    return `${g.why}\n${fmt(seat, { ...s, items })}`;
  };
  /** What this person gets to see, given the referee's decision. */
  const present = (seat, g, s) => {
    if (g.level === 'full') return g.why ? `${g.why}\n${fmt(seat, s)}` : fmt(seat, s);
    if (g.level === 'table') return `${g.why}\n${fmt(seat, s)}`;
    if (g.level === 'read') return readOnly(seat, s, g);
    if (g.level === 'gate') return gateView(seat, s, g);
    return refusal(seat, g);
  };
  /** The screen as this seat may see it now (multi-phone: simply its own phone). */
  const screen = async (seat) => {
    if (!shared) return fmt(seat, await see(seat));
    const { g, s } = await observe(seat);
    return present(seat, g, s);
  };
  const answerAndShow = async (seat, accept, text) => {
    const d = await answerDialog(seat, accept, text);
    if (!d) return `(no dialog is open on ${seat})\n${await screen(seat)}`;
    await sleep(450);
    return `[dialog] ${d.type} ${JSON.stringify(d.message)} — ${accept ? 'accepted' : 'dismissed'}${d.type === 'prompt' && accept ? ` with ${JSON.stringify(text || d.defaultPrompt)}` : ''}\n${await screen(seat)}`;
  };
  const itemOf = (s, ref) => {
    const n = Number(ref);
    const i = Number.isInteger(n) && String(n) === String(ref).trim()
      ? s.items.findIndex((l) => l.startsWith(`[${n}] `))
      : s.items.findIndex((l) => l.includes(String(ref)));
    return i >= 0 ? { line: s.items[i], meta: s.meta?.[i] ?? {} } : null;
  };
  const TOUCH_OPS = new Set(['tap', 'hold', 'type', 'key', 'draw', 'scroll', 'dialog', 'reload']);
  /** --shared: may this seat do `op` on the phone right now? → null (go ahead) or the refusal to print. */
  const guard = async (seat, op, args) => {
    const { g, s } = await observe(seat);
    if (g.level === 'full') return null;
    const deny = (msg) => `${msg}\n${present(seat, g, s)}`;
    if (g.level === 'table') {
      if (['tap', 'hold', 'type', 'draw'].includes(op)) {
        const it = itemOf(s, args[0]);
        const other = it?.meta?.pick ? otherName(it.meta.label, g.me, g.players) : null;
        if (other) return deny(`(「${other}」唔係你 — 揀名就揀返你自己個名)`);
      }
      return null;
    }
    if (g.level === 'gate' && op === 'tap') {
      if (g.tap === 'all') return null;
      const it = itemOf(s, args[0]);
      if (!it) return null;   // the tap itself says "no control matching"
      if (g.tap === 'escape' && it.meta.esc) {
        const toggle = /唔喺度？$/.test(it.meta.label ?? '');
        const left = ESCAPE_AFTER_MS - g.gateAge;
        if (!toggle && left > 0) {
          return deny(`(張卡先出咗 ${Math.round(g.gateAge / 1000)} 秒 — 先大聲叫吓 ${g.who}（say），再等 ${Math.ceil(left / 1000)} 秒先好㩒「${g.who} 唔喺度？」下面啲掣)`);
        }
        // a tap on the card in the middle is seen by everybody
        appendChat({ seat, name: nameOf(seat), note: true, text: `📱 ${nameOf(seat)}（房主）喺交接卡「${s.gate?.title ?? ''}」㩒咗「${it.meta.label}」` });
        return null;
      }
      return deny(`(你唔可以㩒呢個 — 只有 ${g.who ?? '被叫嗰個'} 可以㩒${g.tap === 'escape' ? '；你係房主，可以㩒「唔喺度？」嗰行' : ''})`);
    }
    return deny('(你唔可以掂部手機)');
  };

  const ops = {
    async see({ seat }) {
      return screen(seat);
    },
    async show({ seat, args }) {
      if (!shared) return '(show is for --shared tables: every seat already has its own phone)';
      const { g, r, s } = await observe(seat);
      if (g.level === 'table') return `(部手機已經擺喺枱中間，大家都睇到)\n${present(seat, g, s)}`;
      if (g.level !== 'full' || !r || r.activeSeat !== g.me) return `(要拎住部手機先可以 show)\n${present(seat, g, s)}`;
      if (r.night || r.focus?.anonymous) return '(夜晚 / 秘密步驟唔可以 show)';
      const off = String(args[0] ?? '').toLowerCase() === 'off';
      shown = off ? null : showKey(r);
      return off ? `(${nameOf(seat)} 收返部手機)` : `(${nameOf(seat)} 將部手機擺喺枱中間：大家睇到，唔可以㩒 — 一換步驟、換人、出交接卡或者入夜就自動收返)`;
    },
    async tap({ seat, args }) {
      const p = phoneOf(seat);
      if (p.dialog) {   // only the dialog's own buttons can be pressed while it is up
        const w = String(args[0] ?? '').trim().toLowerCase();
        // a dialog the player has not been shown yet is never answered by a tap meant for the page ("tap 1")
        if (p.dialog.seen && ACCEPT_WORDS.has(w)) return answerAndShow(seat, true);
        if (p.dialog.seen && DISMISS_WORDS.has(w)) return answerAndShow(seat, false);
        return `(your tap did not reach the page: a native ${p.dialog.type} dialog is open — tap 1 = OK, tap 2 = Cancel)\n${await screen(seat)}`;
      }
      const b = await resolve(seat, args[0]);
      await mouse(seat, 'mouseMoved', b.x, b.y, { buttons: 0 });
      await mouse(seat, 'mousePressed', b.x, b.y);
      await sleep(60);
      await mouse(seat, 'mouseReleased', b.x, b.y);
      await sleep(450);
      return screen(seat);
    },
    async hold({ seat, args }) {
      const p = phoneOf(seat);
      const b = await resolve(seat, args[0]);
      const ms = Math.min(8000, Math.max(300, Number(args[1]) || 1500));
      await mouse(seat, 'mouseMoved', b.x, b.y, { buttons: 0 });
      await mouse(seat, 'mousePressed', b.x, b.y);
      await sleep(ms);
      const during = await screen(seat);
      await mouse(seat, 'mouseReleased', b.x, b.y);
      await sleep(300);
      return `--- WHILE HOLDING [${args[0]}] for ${ms} ms ---\n${during}\n${p.dialog ? `--- released; a native dialog is open now ---\n${await screen(seat)}` : '--- released ---'}`;
    },
    async type({ seat, args }) {
      const b = await resolve(seat, args[0]);
      await mouse(seat, 'mousePressed', b.x, b.y);
      await mouse(seat, 'mouseReleased', b.x, b.y);
      await evaluate(seat, `(() => { const el = document.activeElement; if (el && typeof el.select === 'function') el.select(); })()`);
      await send('Input.insertText', { text: String(args.slice(1).join(' ')) }, phones[seat].sessionId);
      await sleep(300);
      return screen(seat);
    },
    async key({ seat, args }) {
      const key = args[0] || 'Enter';
      const p = phoneOf(seat);
      if (p.dialog?.seen && (key === 'Enter' || key === 'Escape')) return answerAndShow(seat, key === 'Enter');
      const code = { Enter: 13, Backspace: 8, Escape: 27, Tab: 9 }[key] ?? 0;
      for (const type of ['keyDown', 'keyUp']) await input(seat, 'Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code, ...(key === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) });
      await sleep(300);
      return screen(seat);
    },
    async dialog({ seat, args }) {
      const word = String(args[0] ?? '').trim().toLowerCase();
      if (!ACCEPT_WORDS.has(word) && !DISMISS_WORDS.has(word)) throw new Error('dialog needs accept or dismiss (prompt text may follow accept)');
      return answerAndShow(seat, ACCEPT_WORDS.has(word), args.slice(1).join(' '));
    },
    async reload({ seat }) {
      const p = phoneOf(seat);
      const abandoned = p.dialog ? await answerDialog(seat, false) : null;   // leaving the page abandons its dialog (counts as cancel)
      p.pendingRelease = null;
      const navs = p.navs;
      await send('Page.reload', { ignoreCache: false }, p.sessionId);
      for (let i = 0; i < 100 && p.navs === navs; i++) await sleep(100);
      await applyEmulation(p, true);   // the override belongs to the session, not the document: re-assert it explicitly
      const ready = async (js, ms) => {
        for (let i = 0; i < ms / 250; i++) {
          try { if (await evaluate(seat, js)) return true; } catch (e) { if (e instanceof DialogOpen) return false; }
          await sleep(250);
        }
        return false;
      };
      if (await ready(`document.readyState === 'complete'`, 10000)) await ready(`!!window.__app`, 6000);
      await sleep(600);
      return `(${seat} reloaded${abandoned ? `; the open ${abandoned.type} was dismissed` : ''})\n${await screen(seat)}`;
    },
    async draw({ seat, args }) {
      const b = await resolve(seat, args[0]);
      const pts = String(args.slice(1).join(' ')).trim().split(/\s+/).map((p) => p.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
      if (pts.length < 2) throw new Error('draw needs at least two points "x,y x,y" in 0–1');
      const at = ([x, y]) => [b.l + Math.min(1, Math.max(0, x)) * b.w, b.t + Math.min(1, Math.max(0, y)) * b.h];
      let [x0, y0] = at(pts[0]);
      await mouse(seat, 'mouseMoved', x0, y0, { buttons: 0 });
      await mouse(seat, 'mousePressed', x0, y0);
      for (const p of pts.slice(1)) {
        const [x1, y1] = at(p);
        const steps = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 6));
        for (let i = 1; i <= steps; i++) { await mouse(seat, 'mouseMoved', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(8); }
        [x0, y0] = [x1, y1];
      }
      await mouse(seat, 'mouseReleased', x0, y0);
      await sleep(400);
      return screen(seat);
    },
    async scroll({ seat, args }) {
      await evaluate(seat, `window.scrollBy(0, ${Number(args[0]) || 400})`);
      await sleep(250);
      return screen(seat);
    },
    // Runs WITHOUT the phone's lock: it takes the lock for each look only, so the others keep playing meanwhile.
    async wait({ seat, args }) {
      const limit = Math.min(WAIT_MAX_S, Math.max(1, Number(args[0]) || 25)) * 1000;
      const p = phoneOf(seat);
      const said0 = chatRows().length;
      const look = () => p.lock.run(async () => {
        if (shared) {
          const { g, s } = await observe(seat);
          return { key: g.level === 'none' ? `none|${g.why}` : `${g.level}|${s.hash}`, out: () => present(seat, g, s) };
        }
        const s = await see(seat);
        return { key: String(s.hash), dialog: !!s.dialog, out: () => fmt(seat, s) };
      });
      // anything said at the table meanwhile (people, the narrator) wakes the waiter too (T6)
      const heard = () => {
        const rows = chatRows().slice(said0);
        return rows.length ? `\n--- said at the table while you waited ---\n${rows.map(chatLine).join('\n')}` : '';
      };
      const first = await look();
      if (!shared && first.dialog) return `(nothing will change until the dialog is answered)\n${first.out()}`;
      const t0 = Date.now();
      while (Date.now() - t0 < limit) {
        await sleep(500);
        if (chatRows().length > said0) { await sleep(300); return `${(await look()).out()}${heard()}`; }
        const v = await look();
        if (v.key !== first.key) { await sleep(400); return `${(await look()).out()}${heard()}`; }
      }
      return `(nothing changed in ${limit / 1000} s)\n${(await look()).out()}${heard()}`;
    },
    async shot({ seat }) {
      if (shared) {
        const { g } = await observe(seat);
        if (g.level === 'none') return refusal(seat, g);
      }
      fs.mkdirSync(path.join(SHOT_DIR, session), { recursive: true });
      const p = phoneOf(seat);
      if (p.dialog) throw new DialogOpen(seat, p.dialog);   // the frozen page cannot be painted behind a native dialog
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, p.sessionId);
      const file = path.join(SHOT_DIR, session, `${seat}-${String(++p.shots).padStart(3, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },
    async say({ seat, args }) {
      const text = args.join(' ').trim().slice(0, 500);
      if (!text) throw new Error('say what?');
      phoneOf(seat);
      appendChat({ seat, name: nameOf(seat), text });
      return `(${nameOf(seat)} said it out loud)`;
    },
    async hear({ args }) {
      const n = Math.min(200, Number(args[0]) || 30);
      const rows = chatRows().slice(-n);
      return rows.map(chatLine).join('\n') || '(nobody has said anything yet)';
    },
    async eval({ seat, args }) {
      const v = await evaluate(seat, `(async () => { ${args.join(' ')} })()`);
      return typeof v === 'string' ? v : JSON.stringify(v, null, 1);
    },
    async setup({ args }) {
      const o = JSON.parse(args[0]);
      const seatsList = Object.keys(phones);
      const host = seatsList[0];
      const ev = (seat, expr) => phoneOf(seat).lock.run(() => evaluate(seat, expr));
      const boot = `for (let i = 0; i < 80 && !window.__app; i++) await new Promise(r => setTimeout(r, 250)); if (!window.__app) throw new Error('app did not boot');`;
      if (shared) {   // 一部手機玩: one local room holding every seat, in table order
        const res = await ev(host, `(async () => { ${boot} const a = window.__app; const sleep = (t) => new Promise(r => setTimeout(r, t));
          if (a.state.mode) { a.leave(); await sleep(300); }
          a.local({ names: ${JSON.stringify(seatsList.map(nameOf))} }); await sleep(800);
          ${o.game ? `await a.lobby.selectGame(${JSON.stringify(o.game)}); await sleep(800);` : ''}
          ${o.config ? `a.lobby.setConfig({ ...a.state.room.config, ...${JSON.stringify(o.config)} }); await sleep(400);` : ''}
          let narrationSet = null;
          ${o.narration ? `narrationSet = a.narration.setMode(${JSON.stringify(o.narration)}); await sleep(200);` : ''}
          return { mode: a.state.mode, players: a.state.room.players.map(p => p.name), holder: a.state.room.players.find(p => p.id === a.state.activeSeat)?.name ?? null,
            game: a.state.room.gameId, config: a.state.room.config, valid: a.state.room.configValid, summary: a.state.room.configSummary,
            narration: a.state.room.narration, narrationSet, singleDevice: !!a.state.room.singleDevice }; })()`);
        return JSON.stringify(res, null, 1);
      }
      const code = await ev(host, `(async () => { ${boot} const a = window.__app; if (a.state.mode) { a.leave(); await new Promise(r => setTimeout(r, 300)); }
        await a.host({ names: [${JSON.stringify(nameOf(host))}] }); for (let i = 0; i < 80 && !a.state.code; i++) await new Promise(r => setTimeout(r, 250)); return a.state.code; })()`);
      if (!code) throw new Error('host got no room code');
      for (const seat of seatsList.slice(1)) {
        await ev(seat, `(async () => { ${boot} const a = window.__app; if (a.state.mode) { a.leave(); await new Promise(r => setTimeout(r, 300)); }
          await a.join(${JSON.stringify(code)}, { names: [${JSON.stringify(nameOf(seat))}] }); return a.state.conn; })()`);
      }
      const res = await ev(host, `(async () => { const a = window.__app; const sleep = (t) => new Promise(r => setTimeout(r, t));
        for (let i = 0; i < 40 && a.state.room.players.filter(p => p.connected).length < ${seatsList.length}; i++) await sleep(250);
        ${o.game ? `await a.lobby.selectGame(${JSON.stringify(o.game)}); await sleep(800);` : ''}
        ${o.config ? `const r = a.lobby.setConfig({ ...a.state.room.config, ...${JSON.stringify(o.config)} }); await sleep(400);` : ''}
        ${o.narration ? `a.narration.setMode(${JSON.stringify(o.narration)}); await sleep(200);` : ''}
        return { code: a.state.code, players: a.state.room.players.map(p => p.name + (p.connected ? '' : ' (offline)')), game: a.state.room.gameId,
          config: a.state.room.config, valid: a.state.room.configValid, summary: a.state.room.configSummary, narration: a.state.room.narration }; })()`);
      return JSON.stringify(res, null, 1);
    },
    async stop() { setTimeout(() => shutdown(), 50); return 'stopping'; },
  };

  // Chrome's exit (from stop, or a crash) ends the daemon. The profile goes too: Chrome's helper processes hold
  // files in it for a moment after the browser exits, so retry instead of leaving ~60 MB in tmp per session.
  let finishing = false;
  const finish = () => {
    if (finishing) return;
    finishing = true;
    try { fs.unlinkSync(sessFile(session)); } catch { /* gone */ }
    setTimeout(() => {
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch { /* still locked */ }
      process.exit(0);
    }, 300);
  };
  const shutdown = () => {
    try { ws.close(); } catch { /* gone */ }
    try { chrome.kill(); } catch { /* gone */ }
    try { fs.unlinkSync(sessFile(session)); } catch { /* gone */ }
    setTimeout(finish, 3000);   // in case Chrome's exit is never reported
  };

  // Ops that never touch a phone, or (wait) take its lock for each look themselves.
  const UNLOCKED = new Set(['say', 'hear', 'stop', 'setup', 'wait']);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const { op, seat, args } = JSON.parse(body || '{}');
        if (!ops[op]) throw new Error(`unknown op ${op}`);
        const a = args ?? [];
        const exec = async () => {
          if (shared && TOUCH_OPS.has(op)) {
            const deny = await guard(seat, op, a);
            if (deny) return deny;
          }
          try { return await ops[op]({ seat, args: a }); } catch (e) {
            if (!(e instanceof DialogOpen) || !SCREEN_OPS.has(op)) throw e;
            // a dialog in the way is part of what this phone shows, not a failure
            const now = UNLOCKED.has(op) ? await phoneOf(seat).lock.run(() => screen(seat)) : await screen(seat);
            return `(${op} stopped: a native dialog is open on this phone)\n${now}`;
          }
        };
        // T4: one op at a time per phone — with --shared every seat queues on the same phone
        const out = UNLOCKED.has(op) || seat == null ? await exec() : await phoneOf(seat).lock.run(exec);
        res.end(JSON.stringify({ ok: true, out }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, out: String(e?.message ?? e) }));
      }
    });
  });
  server.listen(hport, '127.0.0.1');
  chrome.on('exit', finish);
  fs.writeFileSync(sessFile(session), JSON.stringify({ hport, dport, pid: process.pid, chromePid: chrome.pid, profile, seats: seatNames, shared, base, started: new Date().toISOString() }, null, 1));
}

// ------------------------------------------------------------
// CLI
// ------------------------------------------------------------

async function rpc(session, op, seat, args, timeoutMs) {
  if (!fs.existsSync(sessFile(session))) throw new Error(`no running session "${session}" — start it first`);
  const { hport } = JSON.parse(fs.readFileSync(sessFile(session), 'utf8'));
  const r = await fetch(`http://127.0.0.1:${hport}/`, { method: 'POST', body: JSON.stringify({ op, seat, args }), ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
  return r.json();
}

async function call(session, op, seat, args) {
  const j = await rpc(session, op, seat, args);
  if (!j.ok) { console.error(j.out); process.exit(1); }
  console.log(j.out);
}

async function startSession(session, seats, names, base, sharedTable = false) {
  if (fs.existsSync(sessFile(session))) throw new Error(`session ${session} is already running (stop it first)`);
  if (!CHROME) throw new Error('no Chrome/Edge found (set PT_CHROME)');
  // a new table starts with an empty `hear`: an earlier match under the same name keeps its talk, under a UTC-stamped name
  if (fs.existsSync(chatFile(session))) fs.renameSync(chatFile(session), path.join(SESS_DIR, `${session}.chat.${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`));
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '__daemon', session, '--seats', seats.join(','), '--base', base, '--names', names.join(','), '--shared', sharedTable ? '1' : '0'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 120 && !fs.existsSync(sessFile(session)); i++) await sleep(250);
  if (!fs.existsSync(sessFile(session))) throw new Error('daemon did not come up');
  await sleep(1500);
}

// ------------------------------------------------------------
// selftest — the console checks itself against a local page (no network, no app), then cleans up
// ------------------------------------------------------------

const SELFTEST_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>pt selftest</title>
<style>body{font:16px sans-serif;margin:0;padding:16px}button{display:block;width:100%;height:44px;margin:8px 0}</style>
<script>window.__app = true;</script>
<button onclick="document.title = 'confirm:' + confirm('公開所有人嘅骰？')">ask</button>
<button onclick="alert('得閒再玩'); document.title = 'alerted'">warn</button>
<button onclick="document.title = 'prompt:' + prompt('個名？', '阿聰')">name</button>
<button onclick="setTimeout(() => { document.title = 'later:' + confirm('再玩多一局？'); }, 1500)">later</button>
<button onclick="const u = new SpeechSynthesisUtterance('各位請閉眼。'); u.onstart = () => { document.title = 'tts:start'; }; u.onend = () => { document.title = 'tts:end'; }; speechSynthesis.speak(u);">speak</button>
<button onclick="const u = new SpeechSynthesisUtterance('靜音測試'); u.volume = 0; u.onend = () => { document.title = 'mute:end'; }; speechSynthesis.speak(u);">hush</button>
<button onclick="document.getElementById('m').hidden = false">modal</button>
<button id="c">count</button>
<p id="out">idle</p>
<div role="img" aria-label="4 點">⚃</div>
<div id="m" aria-modal="true" hidden style="position:fixed;inset:0;background:#111;color:#fff;padding:16px">
<div class="c-passgate-card" style="opacity:0">交俾 阿明<button onclick="document.getElementById('m').hidden = true">close</button></div>
<div class="c-cover"><div class="c-cover-front" style="opacity:.001">秘密角色</div></div></div>
<script>document.addEventListener('click', (e) => { document.getElementById('out').textContent = 'click@' + Math.round(e.clientX) + ',' + Math.round(e.clientY); });</script>`;

async function selftest() {
  const session = `selftest-${process.pid}`;
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(SELFTEST_PAGE); });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) throw new Error(`selftest failed: ${what}`); };
  const out = async (op, seat, ...args) => {
    const j = await rpc(session, op, seat, args, 30000);
    if (!j.ok) throw new Error(`${op} ${seat} ${args.join(' ')} → ${j.out}`);
    return j.out;
  };
  const title = (seat) => out('eval', seat, 'return document.title');
  const until = async (seat, want, ms = 4000) => { for (let t = 0; t < ms && (await title(seat)) !== want; t += 100) await sleep(100); return (await title(seat)) === want; };
  /** a tap on the "count" button must land on its centre (±2 px) — the half-coordinates bug lands at x/2, y/2 */
  const tapLands = async (seat) => {
    await out('tap', seat, 'count');
    const [msg, cx, cy] = JSON.parse(await out('eval', seat, `const r = document.getElementById('c').getBoundingClientRect(); return [document.getElementById('out').textContent, r.left + r.width / 2, r.top + r.height / 2]`));
    const m = msg.match(/click@(\d+),(\d+)/);
    return !!m && Math.abs(m[1] - cx) <= 2 && Math.abs(m[2] - cy) <= 2 ? true : `${msg} vs centre ${Math.round(cx)},${Math.round(cy)}`;
  };
  let chromePid, daemonPid, profile;
  try {
    await startSession(session, ['a', 'b'], ['阿聰', '阿明'], base);
    ({ chromePid, pid: daemonPid, profile } = JSON.parse(fs.readFileSync(sessFile(session), 'utf8')));
    const first = await out('see', 'a');
    check(first.includes('"ask"'), 'see: the local page is up');
    check(first.includes('[4 點]'), 'see: a picture (role=img, e.g. a die face) says its label');
    // T3: a modal's fading card is read at any opacity — but a closed hold-to-peek cover inside it stays closed
    const modal = await out('tap', 'a', 'modal');
    check(modal.includes('交俾 阿明') && modal.includes('"close"'), 'see: a modal whose card is still fading in is read (T3)');
    check(!modal.includes('秘密角色'), 'see: a closed cover inside a modal (opacity .001) is not read');
    check(!(await out('tap', 'a', 'close')).includes('交俾 阿明'), 'the modal closes');

    // confirm: tap returns promptly with the dialog in view; nothing hangs behind it
    let t0 = Date.now();
    let r = await out('tap', 'a', 'ask');
    check(Date.now() - t0 < 4000 && r.includes('[dialog] confirm "公開所有人嘅骰？"') && r.includes('[2] button "Cancel"'), 'tap on a confirm button returns at once, showing [dialog] confirm');
    check((await out('see', 'a')).includes('[dialog] confirm'), 'see still works while the dialog is open');
    check((await out('see', 'b')).includes('"ask"'), 'the other seat is not blocked');
    const ev = await rpc(session, 'eval', 'a', ['return 1'], 5000);
    check(!ev.ok && /dialog/.test(ev.out), 'eval during a dialog fails fast instead of hanging');
    check((await out('tap', 'a', 'count')).includes('did not reach the page'), 'a tap on the page is refused while a dialog is up');
    check((await out('dialog', 'a', 'dismiss')).includes('dismissed') && (await title('a')) === 'confirm:false', 'dialog dismiss -> confirm() returned false');
    await out('tap', 'a', 'ask');
    check((await out('tap', 'a', 'ok')).includes('accepted') && (await title('a')) === 'confirm:true', 'tap ok answers the dialog -> confirm() returned true');
    await out('tap', 'a', 'ask');
    check((await out('key', 'a', 'Escape')).includes('dismissed') && (await title('a')) === 'confirm:false', 'key Escape dismisses');

    // alert: dismissed for the player, reported once
    r = await out('tap', 'a', 'warn');
    check(r.includes('[alert] "得閒再玩" — dismissed automatically') && (await title('a')) === 'alerted', 'alert is auto-dismissed and reported');
    check(!(await out('see', 'a')).includes('[alert]'), 'the alert notice is shown once');

    // prompt with text
    r = await out('tap', 'a', 'name');
    check(r.includes('[dialog] prompt "個名？" (default "阿聰")'), 'prompt shows its text and default');
    await out('dialog', 'a', 'accept', '阿明');
    check((await title('a')) === 'prompt:阿明', 'dialog accept <text> answers a prompt');

    // a dialog that opens on finger-lift while holding
    r = await out('hold', 'a', 'ask', '400');
    check(r.includes('WHILE HOLDING') && (await out('see', 'a')).includes('[dialog] confirm'), 'hold that ends in a confirm does not hang');
    await out('dialog', 'a', 'dismiss');
    check((await out('dialog', 'a', 'dismiss')).includes('no dialog is open'), 'dialog with nothing open says so');

    // a dialog that opens after the tap's reply: "tap 1" meant for the page must not answer it unseen
    check(!(await out('tap', 'a', 'later')).includes('[dialog]'), 'precondition: the late confirm is not open when the tap returns');
    await sleep(2200);
    r = await out('tap', 'a', '1');
    check(r.includes('did not reach the page') && r.includes('[dialog] confirm "再玩多一局？"'), 'a tap on an unseen dialog is refused and shows the dialog instead of answering it');
    check((await out('tap', 'a', '1')).includes('accepted') && (await title('a')) === 'later:true', 'once shown, tap 1 accepts it');

    // the fake text-to-speech: a line is "spoken" (start, end) and the whole table hears it; a silent one is not heard
    check((await out('eval', 'a', 'return speechSynthesis.getVoices()[0].lang')) === 'zh-HK', 'fake TTS: a Cantonese voice is offered');
    await out('tap', 'a', 'speak');
    check(await until('a', 'tts:end'), 'fake TTS: an utterance fires start and end');
    check((await out('hear', null)).includes('🔊 旁白：各位請閉眼。'), 'fake TTS: the spoken line is in hear as 「🔊 旁白：…」');
    await out('tap', 'b', 'hush');
    check(await until('b', 'mute:end'), 'fake TTS: a silent utterance still ends');
    check(!(await out('hear', null)).includes('靜音測試'), 'fake TTS: a volume-0 utterance is not heard');
    // wait wakes when something is said at the table
    const w = rpc(session, 'wait', 'b', ['20'], 30000);
    await sleep(800);
    await out('say', 'a', '我講完');
    t0 = Date.now();
    const wr = await w;
    check(wr.ok && wr.out.includes('阿聰(a): 我講完') && Date.now() - t0 < 4000, 'wait wakes on table talk and prints what was said');

    // phone metrics: taps land where the finger is
    check((await tapLands('a')) === true, 'tap lands on the control centre');
    // T4: concurrent players on one phone never interleave their CDP calls
    const [, landed] = await Promise.all([out('shot', 'b'), tapLands('b'), out('see', 'b'), out('shot', 'b')]);
    check(landed === true, 'a tap still lands on the centre while screenshots and looks run at the same time');
    check((await out('reload', 'a')).includes('reloaded') && (await out('eval', 'a', 'return location.search')).includes(`as=${session}-a`), 'reload keeps the seat identity');
    check((await out('eval', 'a', 'return typeof speechSynthesis.speak + ":" + speechSynthesis.getVoices().length')) === 'function:1', 'the fake TTS is back after a reload');
    check((await tapLands('a')) === true, 'tap still lands on the centre after reload');
    // a second CDP client (what a player's own script would be) must not be able to break the seat
    const { dport } = JSON.parse(fs.readFileSync(sessFile(session), 'utf8'));
    const outside = async (seat, cmds, whileAttached) => {
      const tab = (await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json()).find((t) => t.url.includes(`as=${session}-${seat}`));
      const raw = new WebSocket(tab.webSocketDebuggerUrl);
      await new Promise((res, rej) => { raw.onopen = res; raw.onerror = rej; });
      cmds.forEach(([method, params], i) => raw.send(JSON.stringify({ id: i + 1, method, params })));
      await sleep(2500);
      try { if (whileAttached) await whileAttached(); } finally {
        raw.close();   // detaching also drops the overrides that client set
        await sleep(500);
      }
    };
    const metrics = async (seat) => (await out('eval', seat, 'return [innerWidth, innerHeight, devicePixelRatio].join("x")'));
    await outside('b', [['Page.reload', {}]]);
    check((await tapLands('b')) === true, 'tap lands on the centre after an outside reload');
    await outside('b', [['Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }]]);
    check((await metrics('b')) !== '390x844x2', 'precondition: the outside client really did change the phone metrics');
    check((await tapLands('b')) === true && (await metrics('b')) === '390x844x2', 'after outside metrics tampering the next tap puts the phone back to 390x844 @2 and lands on the centre');
    // the playtest's half-coordinates case: innerWidth / DPR read 390x844 @2, yet input is mapped at half scale
    await outside('b', [['Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, scale: 2 }]], async () => {
      check((await metrics('b')) === '390x844x2', 'precondition: an outside `scale` override leaves the metrics reading 390x844 @2');
      check((await tapLands('b')) === true, 'with that client still attached, the tap still lands on the centre (not at half coordinates)');
    });
    await outside('b', [['Emulation.setPageScaleFactor', { pageScaleFactor: 2 }]]);
    check((await tapLands('b')) === true && (await out('eval', 'b', 'return visualViewport.scale')) === '1', 'after an outside page zoom the tap resets the zoom and lands on the centre');
  } finally {
    try { await rpc(session, 'stop', null, [], 5000); } catch { /* already stopped */ }
    srv.close();
  }
  const running = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 60 && (running(daemonPid) || running(chromePid)); i++) await sleep(250);   // the daemon exits once the profile is gone
  check(!running(chromePid) && !running(daemonPid) && !fs.existsSync(sessFile(session)) && !fs.existsSync(profile), 'stop leaves no Chrome, no daemon, no session file and no Chrome profile behind');
  try { fs.unlinkSync(chatFile(session)); } catch { /* nothing said */ }
  console.log('selftest passed');
}

async function main() {
  const [op, session, ...rest] = process.argv.slice(2);
  if (op === 'selftest') return selftest();
  if (!op || op === 'help' || !session) {
    const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    console.log(lines.slice(1, lines.findIndex((l) => l.startsWith('// Node 18+')) + 1).join('\n'));
    return;
  }
  if (!/^[\w-]{1,40}$/.test(session)) throw new Error('session name: letters, digits, - and _ only');

  if (op === '__daemon') {
    const f = flags(rest);
    await daemon(session, f.seats.split(','), f.base, f.names.split(','), f.shared === '1');
    return;
  }
  if (op === 'start') {
    const sharedTable = rest.includes('--shared');
    const f = flags(rest.filter((x) => x !== '--shared'));
    const seats = String(f.seats ?? 'p1,p2,p3').split(',').map((s) => s.trim()).filter(Boolean);
    const names = f.names ? String(f.names).split(',') : DEFAULT_NAMES.slice(0, seats.length);
    await startSession(session, seats, names, f.base ?? DEFAULT_BASE, sharedTable);
    console.log(`session ${session} up${sharedTable ? ' (ONE shared phone)' : ''}: ${seats.map((s, i) => `${s}=${names[i]}`).join(', ')}`);
    return;
  }
  if (op === 'setup') {
    const f = flags(rest);
    const o = { game: f.game, config: f.config ? JSON.parse(f.config) : null, narration: f.narration };
    return call(session, 'setup', null, [JSON.stringify(o)]);
  }
  if (op === 'hear' || op === 'stop') return call(session, op, null, rest);
  const [seat, ...args] = rest;
  if (!seat) throw new Error(`${op} needs a seat`);
  return call(session, op, seat, args);
}

// run as a command (not when tests import the helpers above)
const invoked = (() => {
  try {
    const a = path.resolve(process.argv[1] ?? '');
    const b = fileURLToPath(import.meta.url);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch { return false; }
})();
if (invoked) main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
