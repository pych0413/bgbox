#!/usr/bin/env node
// ============================================================
// tools/playtest/pt.mjs — multi-window playtest console for AI players.
//
// One headless Chrome holds one "phone" window per seat (390×844, mobile metrics).
// A small daemon keeps the CDP sessions alive; every player drives ONLY its own
// window through this CLI, like a person holding one phone.
//
//   node tools/playtest/pt.mjs start  <session> --seats p1,p2,p3 [--base URL] [--names 阿聰,阿明,…]
//   node tools/playtest/pt.mjs setup  <session> --game <id> [--config '{"k":v}'] [--narration silent|read|voice]
//   node tools/playtest/pt.mjs see    <session> <seat>              what this phone shows (text, controls [n], overlays)
//   node tools/playtest/pt.mjs tap    <session> <seat> <n|"label">  tap control n (or the first control whose label contains the text)
//   node tools/playtest/pt.mjs hold   <session> <seat> <n|"label"> [ms]   press and hold (hold-to-peek); prints the screen WHILE held
//   node tools/playtest/pt.mjs type   <session> <seat> <n|"label"> <text> focus a text box and type
//   node tools/playtest/pt.mjs draw   <session> <seat> <n> "x,y x,y …"   drag a finger on a canvas (0–1 coordinates)
//   node tools/playtest/pt.mjs scroll <session> <seat> <dy>          scroll the page (px, negative = up)
//   node tools/playtest/pt.mjs wait   <session> <seat> [sec=25]     block until this screen changes, then print it
//   node tools/playtest/pt.mjs key    <session> <seat> [Enter|Escape|Backspace|Tab]   press a key (Enter / Escape also answer an open dialog)
//   node tools/playtest/pt.mjs dialog <session> <seat> accept|dismiss [text]   answer the native confirm()/prompt() open on this phone
//   node tools/playtest/pt.mjs reload <session> <seat>              reload this phone's tab (the only safe way to reload — keeps tap coordinates right)
//   node tools/playtest/pt.mjs shot   <session> <seat>              save a PNG screenshot, print its path
//   node tools/playtest/pt.mjs say    <session> <seat> <text>       talk at the table (everyone can hear)
//   node tools/playtest/pt.mjs hear   <session> [n=30]              the last n things said at the table
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
// In-page helpers (serialised into Runtime.evaluate)
// ------------------------------------------------------------

/** Everything a person would see on this phone: visible text, numbered controls, covering overlays. */
function pageSee() {
  const vcache = new Map();
  const styleVisible = (el) => {
    if (vcache.has(el)) return vcache.get(el);
    let ok = true;
    if (el.hidden) ok = false;
    else {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) ok = false;
      else if (el.parentElement && el.parentElement !== document.documentElement) ok = styleVisible(el.parentElement);
    }
    vcache.set(el, ok);
    return ok;
  };
  const boxVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

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
    const op = parseFloat(s.opacity) * alpha;
    if (op < 0.3 && !(el.innerText || '').trim()) continue;
    if (el.id === 'app' || el.closest('#app') === el.parentElement && s.position === 'absolute' && op < 0.3) continue;
    overlays.push({ cls: String(el.className || el.tagName).slice(0, 40), cover: Math.round(op * 100), pe: s.pointerEvents, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) });
  }

  document.querySelectorAll('[data-pt]').forEach((e) => e.removeAttribute('data-pt'));
  const SEL = 'button, [role=button], a[href], input, textarea, select, summary, canvas';
  const items = [];
  let n = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (!styleVisible(el) || !boxVisible(el)) continue;
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
  }

  // visible text in reading order, one line per block
  const lines = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let last = null, buf = '';
  const flush = () => { const t = buf.replace(/\s+/g, ' ').trim(); if (t) lines.push(t); buf = ''; };
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const p = t.parentElement;
    if (!p || !t.nodeValue.trim()) continue;
    if (p.closest('script, style, noscript')) continue;
    if (p.closest('details:not([open])') && !p.closest('summary')) continue;   // folded: not on screen
    if (!styleVisible(p) || !boxVisible(p)) continue;
    const block = p.closest('p, li, h1, h2, h3, h4, button, [role=button], label, summary, td, th, .tag, div, section');
    if (block !== last) { flush(); last = block; }
    buf += ' ' + t.nodeValue;
  }
  flush();
  const dedup = lines.filter((l, i) => l !== lines[i - 1]);
  const text = dedup.join('\n').slice(0, 6000);
  const norm = (s) => s.replace(/\d+/g, '#');
  let h = 0;
  for (const ch of norm(text + items.join('|'))) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return {
    title: document.title, scroll: `${Math.round(scrollY)}/${Math.max(0, document.documentElement.scrollHeight - innerHeight)}`,
    overlays, items, text, hash: h,
  };
}

// ------------------------------------------------------------
// Daemon: Chrome + CDP sessions + HTTP command server
// ------------------------------------------------------------

async function daemon(session, seats, base, names) {
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
    }
  });

  for (const [i, seat] of seats.entries()) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true, width: W, height: H });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const p = phones[seat] = { targetId, sessionId, name: names[i] ?? seat, shots: 0, dialog: null, watchers: new Set(), notices: [], pendingRelease: null, navs: 0, vp: null };
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await applyEmulation(p);
    const url = `${base}${base.includes('?') ? '&' : '?'}as=${encodeURIComponent(`${session}-${seat}`)}`;
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
    items: ['[1] button "OK" (accept)', '[2] button "Cancel" (dismiss)'],
  });
  const see = async (seat) => {
    const p = phoneOf(seat);
    if (p.dialog) return dialogScreen(p.dialog);
    return evaluate(seat, `(${pageSee.toString()})()`);
  };
  const fmt = (seat, s) => {
    const p = phones[seat];
    const out = [`== ${seat} ${p.name} | ${s.title} | scroll ${s.scroll} ==`];
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
    out.push('--- screen text ---', s.text || '(no text)', '--- controls ---', ...(s.items.length ? s.items : ['(none)']));
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
  const answerAndShow = async (seat, accept, text) => {
    const d = await answerDialog(seat, accept, text);
    if (!d) return `(no dialog is open on ${seat})\n${fmt(seat, await see(seat))}`;
    await sleep(450);
    return `[dialog] ${d.type} ${JSON.stringify(d.message)} — ${accept ? 'accepted' : 'dismissed'}${d.type === 'prompt' && accept ? ` with ${JSON.stringify(text || d.defaultPrompt)}` : ''}\n${fmt(seat, await see(seat))}`;
  };

  const ops = {
    async see({ seat }) { return fmt(seat, await see(seat)); },
    async tap({ seat, args }) {
      const p = phoneOf(seat);
      if (p.dialog) {   // only the dialog's own buttons can be pressed while it is up
        const w = String(args[0] ?? '').trim().toLowerCase();
        // a dialog the player has not been shown yet is never answered by a tap meant for the page ("tap 1")
        if (p.dialog.seen && ACCEPT_WORDS.has(w)) return answerAndShow(seat, true);
        if (p.dialog.seen && DISMISS_WORDS.has(w)) return answerAndShow(seat, false);
        return `(your tap did not reach the page: a native ${p.dialog.type} dialog is open — tap 1 = OK, tap 2 = Cancel)\n${fmt(seat, await see(seat))}`;
      }
      const b = await resolve(seat, args[0]);
      await mouse(seat, 'mouseMoved', b.x, b.y, { buttons: 0 });
      await mouse(seat, 'mousePressed', b.x, b.y);
      await sleep(60);
      await mouse(seat, 'mouseReleased', b.x, b.y);
      await sleep(450);
      return fmt(seat, await see(seat));
    },
    async hold({ seat, args }) {
      const p = phoneOf(seat);
      const b = await resolve(seat, args[0]);
      const ms = Math.min(8000, Math.max(300, Number(args[1]) || 1500));
      await mouse(seat, 'mouseMoved', b.x, b.y, { buttons: 0 });
      await mouse(seat, 'mousePressed', b.x, b.y);
      await sleep(ms);
      const during = fmt(seat, await see(seat));
      await mouse(seat, 'mouseReleased', b.x, b.y);
      await sleep(300);
      return `--- WHILE HOLDING [${args[0]}] for ${ms} ms ---\n${during}\n${p.dialog ? `--- released; a native dialog is open now ---\n${fmt(seat, await see(seat))}` : '--- released ---'}`;
    },
    async type({ seat, args }) {
      const b = await resolve(seat, args[0]);
      await mouse(seat, 'mousePressed', b.x, b.y);
      await mouse(seat, 'mouseReleased', b.x, b.y);
      await evaluate(seat, `(() => { const el = document.activeElement; if (el && typeof el.select === 'function') el.select(); })()`);
      await send('Input.insertText', { text: String(args.slice(1).join(' ')) }, phones[seat].sessionId);
      await sleep(300);
      return fmt(seat, await see(seat));
    },
    async key({ seat, args }) {
      const key = args[0] || 'Enter';
      const p = phoneOf(seat);
      if (p.dialog?.seen && (key === 'Enter' || key === 'Escape')) return answerAndShow(seat, key === 'Enter');
      const code = { Enter: 13, Backspace: 8, Escape: 27, Tab: 9 }[key] ?? 0;
      for (const type of ['keyDown', 'keyUp']) await input(seat, 'Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code, ...(key === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) });
      await sleep(300);
      return fmt(seat, await see(seat));
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
      return `(${seat} reloaded${abandoned ? `; the open ${abandoned.type} was dismissed` : ''})\n${fmt(seat, await see(seat))}`;
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
      return fmt(seat, await see(seat));
    },
    async scroll({ seat, args }) {
      await evaluate(seat, `window.scrollBy(0, ${Number(args[0]) || 400})`);
      await sleep(250);
      return fmt(seat, await see(seat));
    },
    async wait({ seat, args }) {
      const limit = Math.min(120, Math.max(1, Number(args[0]) || 25)) * 1000;
      const first = await see(seat);
      if (first.dialog) return `(nothing will change until the dialog is answered)\n${fmt(seat, first)}`;
      const t0 = Date.now();
      while (Date.now() - t0 < limit) {
        await sleep(500);
        const s = await see(seat);
        if (s.hash !== first.hash) { await sleep(400); return fmt(seat, await see(seat)); }
      }
      return `(nothing changed in ${limit / 1000} s)\n${fmt(seat, await see(seat))}`;
    },
    async shot({ seat }) {
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
      fs.appendFileSync(chatFile(session), JSON.stringify({ t: new Date().toISOString(), seat, name: phones[seat]?.name ?? seat, text }) + '\n');
      return `(${phones[seat]?.name ?? seat} said it out loud)`;
    },
    async hear({ args }) {
      const n = Math.min(200, Number(args[0]) || 30);
      if (!fs.existsSync(chatFile(session))) return '(nobody has said anything yet)';
      const rows = fs.readFileSync(chatFile(session), 'utf8').trim().split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l));
      return rows.map((r) => `[${r.t.slice(11, 19)}Z] ${r.name}(${r.seat}): ${r.text}`).join('\n') || '(nobody has said anything yet)';
    },
    async eval({ seat, args }) {
      const v = await evaluate(seat, `(async () => { ${args.join(' ')} })()`);
      return typeof v === 'string' ? v : JSON.stringify(v, null, 1);
    },
    async setup({ args }) {
      const o = JSON.parse(args[0]);
      const seatsList = Object.keys(phones);
      const host = seatsList[0];
      const boot = `for (let i = 0; i < 80 && !window.__app; i++) await new Promise(r => setTimeout(r, 250)); if (!window.__app) throw new Error('app did not boot');`;
      const code = await evaluate(host, `(async () => { ${boot} const a = window.__app; if (a.state.mode) { a.leave(); await new Promise(r => setTimeout(r, 300)); }
        await a.host({ names: [${JSON.stringify(phones[host].name)}] }); for (let i = 0; i < 80 && !a.state.code; i++) await new Promise(r => setTimeout(r, 250)); return a.state.code; })()`);
      if (!code) throw new Error('host got no room code');
      for (const seat of seatsList.slice(1)) {
        await evaluate(seat, `(async () => { ${boot} const a = window.__app; if (a.state.mode) { a.leave(); await new Promise(r => setTimeout(r, 300)); }
          await a.join(${JSON.stringify(code)}, { names: [${JSON.stringify(phones[seat].name)}] }); return a.state.conn; })()`);
      }
      const res = await evaluate(host, `(async () => { const a = window.__app; const sleep = (t) => new Promise(r => setTimeout(r, t));
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

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const { op, seat, args } = JSON.parse(body || '{}');
        if (!ops[op]) throw new Error(`unknown op ${op}`);
        let out;
        try { out = await ops[op]({ seat, args: args ?? [] }); } catch (e) {
          if (!(e instanceof DialogOpen) || !SCREEN_OPS.has(op)) throw e;
          // a dialog in the way is part of what this phone shows, not a failure
          out = `(${op} stopped: a native dialog is open on this phone)\n${fmt(seat, await see(seat))}`;
        }
        res.end(JSON.stringify({ ok: true, out }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, out: String(e?.message ?? e) }));
      }
    });
  });
  server.listen(hport, '127.0.0.1');
  chrome.on('exit', finish);
  fs.writeFileSync(sessFile(session), JSON.stringify({ hport, dport, pid: process.pid, chromePid: chrome.pid, profile, seats: Object.fromEntries(Object.entries(phones).map(([k, v]) => [k, v.name])), base, started: new Date().toISOString() }, null, 1));
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

async function startSession(session, seats, names, base) {
  if (fs.existsSync(sessFile(session))) throw new Error(`session ${session} is already running (stop it first)`);
  if (!CHROME) throw new Error('no Chrome/Edge found (set PT_CHROME)');
  // a new table starts with an empty `hear`: an earlier match under the same name keeps its talk, under a UTC-stamped name
  if (fs.existsSync(chatFile(session))) fs.renameSync(chatFile(session), path.join(SESS_DIR, `${session}.chat.${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`));
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '__daemon', session, '--seats', seats.join(','), '--base', base, '--names', names.join(',')], { detached: true, stdio: 'ignore' });
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
<button id="c">count</button>
<p id="out">idle</p>
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
    check((await out('see', 'a')).includes('"ask"'), 'see: the local page is up');

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

    // phone metrics: taps land where the finger is
    check((await tapLands('a')) === true, 'tap lands on the control centre');
    check((await out('reload', 'a')).includes('reloaded') && (await out('eval', 'a', 'return location.search')).includes(`as=${session}-a`), 'reload keeps the seat identity');
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
    await daemon(session, f.seats.split(','), f.base, f.names.split(','));
    return;
  }
  if (op === 'start') {
    const f = flags(rest);
    const seats = String(f.seats ?? 'p1,p2,p3').split(',').map((s) => s.trim()).filter(Boolean);
    const names = f.names ? String(f.names).split(',') : DEFAULT_NAMES.slice(0, seats.length);
    await startSession(session, seats, names, f.base ?? DEFAULT_BASE);
    console.log(`session ${session} up: ${seats.map((s, i) => `${s}=${names[i]}`).join(', ')}`);
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

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
