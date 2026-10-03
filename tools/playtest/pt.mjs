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
//   node tools/playtest/pt.mjs shot   <session> <seat>              save a PNG screenshot, print its path
//   node tools/playtest/pt.mjs say    <session> <seat> <text>       talk at the table (everyone can hear)
//   node tools/playtest/pt.mjs hear   <session> [n=30]              the last n things said at the table
//   node tools/playtest/pt.mjs eval   <session> <seat> <js>         ORCHESTRATOR ONLY (setup / final result) — players must not use it
//   node tools/playtest/pt.mjs stop   <session>
//
// Node 18+ (global WebSocket: Node 22+). No packages.
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
  for (const [i, seat] of seats.entries()) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true, width: W, height: H });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true }, sessionId);
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId).catch(() => {});
    const url = `${base}${base.includes('?') ? '&' : '?'}as=${encodeURIComponent(`${session}-${seat}`)}`;
    await send('Page.navigate', { url }, sessionId);
    phones[seat] = { targetId, sessionId, name: names[i] ?? seat, shots: 0 };
  }

  const evaluate = async (seat, expr, awaitPromise = true) => {
    const p = phones[seat];
    if (!p) throw new Error(`unknown seat ${seat} (seats: ${Object.keys(phones).join(', ')})`);
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true }, p.sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const see = (seat) => evaluate(seat, `(${pageSee.toString()})()`);
  const fmt = (seat, s) => {
    const p = phones[seat];
    const out = [`== ${seat} ${p.name} | ${s.title} | scroll ${s.scroll} ==`];
    for (const o of s.overlays) out.push(`[overlay] ${o.cls} — covers the screen at ${o.cover}% darkness${o.pe === 'none' ? ' (taps pass through)' : ''}${o.text ? ` · "${o.text}"` : ''}`);
    out.push('--- screen text ---', s.text || '(no text)', '--- controls ---', ...(s.items.length ? s.items : ['(none)']));
    return out.join('\n');
  };
  const resolve = async (seat, ref) => {
    const s = await see(seat);   // renumbers controls to match what the player last saw
    let n = Number(ref);
    if (!Number.isInteger(n) || String(n) !== String(ref).trim()) {
      const hit = s.items.find((line) => line.includes(String(ref)));
      if (!hit) throw new Error(`no control matching ${JSON.stringify(ref)}\n${fmt(seat, s)}`);
      n = Number(hit.match(/^\[(\d+)\]/)[1]);
    }
    const box = await evaluate(seat, `(() => { const el = document.querySelector('[data-pt="${n}"]'); if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top }; })()`);
    if (!box) throw new Error(`control [${n}] is gone — run see again`);
    await sleep(120);
    return box;
  };
  const mouse = (seat, type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra }, phones[seat].sessionId);

  const ops = {
    async see({ seat }) { return fmt(seat, await see(seat)); },
    async tap({ seat, args }) {
      const b = await resolve(seat, args[0]);
      await mouse(seat, 'mouseMoved', b.x, b.y, { buttons: 0 });
      await mouse(seat, 'mousePressed', b.x, b.y);
      await sleep(60);
      await mouse(seat, 'mouseReleased', b.x, b.y);
      await sleep(450);
      return fmt(seat, await see(seat));
    },
    async hold({ seat, args }) {
      const b = await resolve(seat, args[0]);
      const ms = Math.min(8000, Math.max(300, Number(args[1]) || 1500));
      await mouse(seat, 'mouseMoved', b.x, b.y, { buttons: 0 });
      await mouse(seat, 'mousePressed', b.x, b.y);
      await sleep(ms);
      const during = fmt(seat, await see(seat));
      await mouse(seat, 'mouseReleased', b.x, b.y);
      await sleep(300);
      return `--- WHILE HOLDING [${args[0]}] for ${ms} ms ---\n${during}\n--- released ---`;
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
      const code = { Enter: 13, Backspace: 8, Escape: 27, Tab: 9 }[key] ?? 0;
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code, ...(key === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) }, phones[seat].sessionId);
      await sleep(300);
      return fmt(seat, await see(seat));
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
      const p = phones[seat];
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

  const shutdown = () => {
    try { ws.close(); } catch { /* gone */ }
    try { chrome.kill(); } catch { /* gone */ }
    try { fs.unlinkSync(sessFile(session)); } catch { /* gone */ }
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ } process.exit(0); }, 800);
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const { op, seat, args } = JSON.parse(body || '{}');
        if (!ops[op]) throw new Error(`unknown op ${op}`);
        const out = await ops[op]({ seat, args: args ?? [] });
        res.end(JSON.stringify({ ok: true, out }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, out: String(e?.message ?? e) }));
      }
    });
  });
  server.listen(hport, '127.0.0.1');
  chrome.on('exit', () => { try { fs.unlinkSync(sessFile(session)); } catch { /* gone */ } process.exit(0); });
  fs.writeFileSync(sessFile(session), JSON.stringify({ hport, dport, pid: process.pid, chromePid: chrome.pid, seats: Object.fromEntries(Object.entries(phones).map(([k, v]) => [k, v.name])), base, started: new Date().toISOString() }, null, 1));
}

// ------------------------------------------------------------
// CLI
// ------------------------------------------------------------

async function call(session, op, seat, args) {
  if (!fs.existsSync(sessFile(session))) throw new Error(`no running session "${session}" — start it first`);
  const { hport } = JSON.parse(fs.readFileSync(sessFile(session), 'utf8'));
  const r = await fetch(`http://127.0.0.1:${hport}/`, { method: 'POST', body: JSON.stringify({ op, seat, args }) });
  const j = await r.json();
  if (!j.ok) { console.error(j.out); process.exit(1); }
  console.log(j.out);
}

async function main() {
  const [op, session, ...rest] = process.argv.slice(2);
  if (!op || op === 'help' || !session) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 26).join('\n')); return; }
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
    if (fs.existsSync(sessFile(session))) throw new Error(`session ${session} is already running (stop it first)`);
    if (!CHROME) throw new Error('no Chrome/Edge found (set PT_CHROME)');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '__daemon', session, '--seats', seats.join(','), '--base', f.base ?? DEFAULT_BASE, '--names', names.join(',')], { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 120 && !fs.existsSync(sessFile(session)); i++) await sleep(250);
    if (!fs.existsSync(sessFile(session))) throw new Error('daemon did not come up');
    await sleep(1500);
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
