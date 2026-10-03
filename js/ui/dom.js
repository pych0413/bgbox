// ============================================================
// dom.js — tiny DOM helpers shared by the shell and every component.
//
// Deliberately self-contained (no imports but logic.js): components and game UIs can
// pull this in without dragging the rest of core along. Nothing here touches the
// DOM at import time (tests import it under minimal fake DOMs).
// ============================================================

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * el('div', { class: 'x', onclick: fn, style: { '--c': 'red' } }, kid, kid…)
 * null / false attrs and kids are skipped; arrays of kids are flattened.
 * `value` is applied last so it works on <select> (options must exist first).
 */
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'value') value = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) n.style.setProperty(sk, sv);
        else n.style[sk] = sv;
      }
    } else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  if (value !== undefined) n.value = value;
  return n;
}

/** Parse a trusted SVG/HTML string (our own art, never user input) into one element. */
export function fromHTML(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

/** Restart a CSS animation that is driven by a class (shake, denied…). */
export function restartAnim(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

let idSeq = 0;
export const uniqueId = (prefix = 'u') => `${prefix}${++idSeq}`;

export { fmtClock } from './logic.js?v=1';

// ---------- modal scroll lock (counted: a sheet and a gate may overlap) ----------
let scrollLocks = 0;
export function lockScroll() {
  if (scrollLocks++ === 0) document.body.classList.add('modal-open');
}
export function unlockScroll() {
  if (scrollLocks > 0 && --scrollLocks === 0) document.body.classList.remove('modal-open');
}

// ---------- toast ----------
let toastTimer = null;

/** Self-installing: works in the app and in the gallery without markup. */
export function toast(text, ms = 2000) {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('div', { class: 'toast', id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- dice faces ----------
const PIPS = {
  1: ['c'], 2: ['tl', 'br'], 3: ['tl', 'c', 'br'],
  4: ['tl', 'tr', 'bl', 'br'], 5: ['tl', 'tr', 'c', 'bl', 'br'],
  6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
};
const PIP_POS = { tl: [1, 1], tr: [1, 3], ml: [2, 1], c: [2, 2], mr: [2, 3], bl: [3, 1], br: [3, 3] };

/** Fill `node` (a 3x3 grid) with the pips of a d6 face. */
export function addPips(node, value) {
  for (const k of PIPS[value] ?? []) {
    const [r, c] = PIP_POS[k];
    const pip = el('span', { class: 'pip' });
    pip.style.gridRow = r;
    pip.style.gridColumn = c;
    node.append(pip);
  }
}

/**
 * A die face: pips for d6, the plain number for every other die. A face on its own is shown, so it carries
 * role="img" + aria-label 「N 點」 (#37: pips alone are slow to count and say nothing to a screen reader);
 * a `Cover` strips the label from every die inside it while it is closed (labelDice), so a covered die never
 * says its number.
 */
export function dieFace(value, sides = 6) {
  const d = sides === 6 && PIPS[value] ? el('div', { class: 'die pips' }) : el('div', { class: 'die', text: String(value) });
  if (d.classList.contains('pips')) addPips(d, value);
  d.setAttribute('role', 'img');
  d.setAttribute('aria-label', `${value} 點`);
  return d;
}

/** The value a die face shows: its pips, or its text. */
function dieValue(d) {
  if (!d.classList.contains('pips')) return String(d.textContent ?? '').trim();
  let n = 0;
  for (const c of d.children ?? []) if (c.classList?.contains('pip')) n++;
  return String(n);
}

/**
 * Label (on) or unlabel (off) every die face under `root` — `Cover` calls it as it opens and closes.
 * Walks `children` only, so it also runs on the tests' minimal fake DOMs.
 */
export function labelDice(root, on) {
  const walk = (n) => {
    for (const c of n?.children ?? []) {
      if (c.classList?.contains('die')) {
        const v = dieValue(c);
        if (on && /^\d+$/.test(v)) {                // a placeholder face (「–」 before the first roll) says nothing
          c.setAttribute('role', 'img');
          c.setAttribute('aria-label', `${v} 點`);
        } else if (typeof c.removeAttribute === 'function') {
          c.removeAttribute('role');
          c.removeAttribute('aria-label');
        }
      }
      walk(c);
    }
  };
  walk(root);
}

// ---------- arm-then-confirm (#3) ----------
// The host's phone IS the room's server. While a native confirm() is up, iOS stops its JavaScript: guests
// get 冇送到 after 4 s and 同房主斷咗 after 12 s. So nothing in the app may block. A risky tap asks twice
// instead: the first tap ARMS it (the button reads 「再㩒一次：…」 for ARM_MS — or a toast says so when there
// is no button to relabel), and the same tap again within that time does it. A second tap sooner than
// ARM_GAP_MS is the same thumb bouncing, not a decision: it is ignored and the arm stays.

export const ARM_MS = 3000;
export const ARM_GAP_MS = 350;
let armedNow = null;      // { key, node, at, saved, timer, onDisarm }

const firstLine = (text) => String(text ?? '').split('\n')[0].trim();

/** Drop the current arm (if any): the button gets its own label back. */
export function disarmConfirm() {
  const a = armedNow;
  if (!a) return;
  armedNow = null;
  clearTimeout(a.timer);
  if (a.node) {
    a.node.classList?.remove('armed');
    if (a.saved) a.node.replaceChildren(...a.saved);
  }
  try { a.onDisarm?.(); } catch (err) { console.error(err); }
}

/** Is `key` armed right now (optionally: on this node)? */
export function isArmed(key, node) {
  return !!armedNow && armedNow.key === key && (!node || armedNow.node === node);
}

/**
 * Arm-then-confirm, never blocking. Returns true only for the confirming tap:
 *   if (!confirmTap('踢走 阿明？', { node: btn })) return;   // first tap: arms, returns false
 * `node` — the button that was tapped (relabelled 「再㩒一次：<first line of text>」 while armed, unless
 * `inline: false`, e.g. a ✕ icon, which keeps its face and gets a toast); `key` (default: the text) — what
 * must be tapped again; `onDisarm` — runs when the arm ends (expired, replaced or confirmed).
 * A different button with the same key re-arms on that button, unless the first one has left the page
 * (its screen re-rendered it).
 */
export function confirmTap(text, { node = null, key, inline = true, ms = ARM_MS, onDisarm = null } = {}) {
  const k = key ?? String(text ?? '');
  const t = Date.now();
  const a = armedNow;
  if (a && a.key === k && (!node || !a.node || a.node === node || a.node.isConnected === false)) {
    if (t - a.at < ARM_GAP_MS) return false;
    if (t - a.at <= ms) { disarmConfirm(); return true; }
  }
  disarmConfirm();
  const label = `再㩒一次：${firstLine(text)}`;
  const entry = { key: k, node, at: t, saved: null, timer: null, onDisarm };
  if (node && inline) {
    entry.saved = [...(node.childNodes ?? node.children ?? [])];
    node.textContent = label;
  } else {
    toast(label, ms);
  }
  node?.classList?.add('armed');
  entry.timer = setTimeout(() => { if (armedNow === entry) disarmConfirm(); }, ms);
  armedNow = entry;
  return false;
}

/**
 * The safety net (#3): `win.confirm` becomes confirmTap on the button tapped in the last second — false now,
 * true on the second tap — so a confirm() left in a game UI can never freeze the host phone. The shell
 * installs it once at boot. Returns false if this window will not let confirm be replaced.
 */
export function installConfirmShim(win, doc) {
  let lastTap = null;
  doc.addEventListener('click', (e) => {
    lastTap = { node: e.target?.closest?.('button, [role="button"]') ?? null, at: Date.now() };
  }, true);
  try {
    win.confirm = (text) => confirmTap(String(text ?? ''), { node: lastTap && Date.now() - lastTap.at < 1000 ? lastTap.node : null });
    return true;
  } catch {
    return false;
  }
}

/** Stable JSON key for "did these props change?" checks. */
export function sig(x) {
  try { return JSON.stringify(x); } catch { return String(Math.random()); }
}
