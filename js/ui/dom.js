// ============================================================
// dom.js — tiny DOM helpers shared by the shell and every component.
//
// Deliberately self-contained (no imports): components and game UIs can
// pull this in without dragging the rest of core along.
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

export { fmtClock } from './logic.js?v=20261003075532';

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

/** A die face: pips for d6, the plain number for every other die. */
export function dieFace(value, sides = 6) {
  if (sides === 6 && PIPS[value]) {
    const d = el('div', { class: 'die pips' });
    addPips(d, value);
    return d;
  }
  return el('div', { class: 'die', text: String(value) });
}

/** Stable JSON key for "did these props change?" checks. */
export function sig(x) {
  try { return JSON.stringify(x); } catch { return String(Math.random()); }
}
