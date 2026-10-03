// ============================================================
// ConfigForm — renders a game's `config.fields(cfg, n)` (DESIGN §3 Field[])
// as the lobby's setup form.
//
//   ConfigForm({ fields, value, onChange(cfg) }) → { el, update(props), destroy() }
//
// `value` is the whole config object; every edit calls onChange with the
// whole object (the edited key replaced). The form reconciles IN PLACE by
// field key, so the host's echo of an edit never rebuilds a control (and
// never steals focus from a half-typed role name).
//
// Field types and the shapes they read/write:
//   int        { key, label, min?, max?, step?, help? }        value: number
//   seconds    same as int, shown as 「90 秒」/「2 分鐘」          value: seconds
//   bool       { key, label, help? }                           value: boolean
//   select     { key, label, options: [v | {value,label}] }    value: the option's value (type kept)
//   roles      { key, label, min?, max?, fixed?, help? }
//                value: array  [{ id, name, emoji, count, filler?, desc? }]  → the v1 role editor:
//                  emoji/name inputs, count steppers, one auto-fill ("自動") role,
//                  add / delete (turned off by `fixed: true`). `max` caps each count.
//                value: object { [roleId]: count } with field.options = [{ id, name, emoji, min?, max?, auto? }]
//                  → counts only. `auto` roles show 「自動」 and are not written.
//   categories { key, label, options: [v | {value,label}], levels?: [v | {value,label}], stats?: {used,total} }
//                value: { cats: [...], levels: [...] }  (the keys `categories` / `level(s)` are
//                  honoured too if the incoming value already uses them)
//
// §15 leaves the roles / categories value shapes open; the above is the simplest
// reading and what games/custom/game.js already produces.
// ============================================================

import { el, sig, toast } from '../dom.js?v=1';
import { fmtDuration } from '../logic.js?v=1';
import { sfx } from '../../core/sfx.js?v=1';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const optValue = (o) => (o !== null && typeof o === 'object' ? (o.value ?? o.id) : o);
const optLabel = (o) => (o !== null && typeof o === 'object' ? (o.label ?? o.name ?? String(optValue(o))) : String(o));

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;
/** First `n` user-perceived characters (🧑‍🌾 counts as one). */
function graphemes(s, n) {
  const str = String(s ?? '');
  if (segmenter) return Array.from(segmenter.segment(str), (g) => g.segment).slice(0, n).join('');
  return Array.from(str).slice(0, n).join('');
}

function head(label, help) {
  return el('div', { class: 'c-configform-head' },
    label ? el('span', { class: 'field-label', text: label }) : null,
    help ? el('span', { class: 'c-configform-help', text: help }) : null);
}

// ---------- int / seconds ----------

function numberField(emit) {
  let cur = { f: {}, v: 0 };
  const headHost = el('div');
  const out = el('output');
  const minus = el('button', { class: 'step-btn', type: 'button', 'aria-label': '減少' }, '−');
  const plus = el('button', { class: 'step-btn', type: 'button', 'aria-label': '增加' }, '+');
  const root = el('div', { class: 'c-configform-field' }, headHost, el('div', { class: 'stepper' }, minus, out, plus));

  const step = (f) => f.step ?? (f.type === 'seconds' ? ((f.max ?? 120) <= 120 ? 5 : (f.max ?? 0) <= 600 ? 15 : 30) : 1);
  const bump = (dir) => {
    const { f, v } = cur;
    const next = clamp(v + dir * step(f), f.min ?? -Infinity, f.max ?? Infinity);
    if (next === v) return;
    sfx('tap');
    emit(f.key, next);
  };
  minus.addEventListener('click', () => bump(-1));
  plus.addEventListener('click', () => bump(1));

  return {
    el: root,
    update(f, value) {
      const v = Number.isFinite(Number(value)) ? Number(value) : (f.min ?? 0);
      cur = { f, v };
      headHost.replaceChildren(head(f.label, f.help));
      out.textContent = f.type === 'seconds' ? fmtDuration(v) : String(v);
      minus.disabled = v <= (f.min ?? -Infinity);
      plus.disabled = v >= (f.max ?? Infinity);
    },
  };
}

// ---------- bool ----------

function boolField(emit) {
  let cur = { f: {} };
  const strong = el('strong');
  const small = el('small');
  const box = el('input', { type: 'checkbox' });
  const root = el('label', { class: 'switch-row c-configform-field' },
    el('span', {}, strong, small), box, el('span', { class: 'switch' }));
  box.addEventListener('change', () => { sfx('tap'); emit(cur.f.key, box.checked); });
  return {
    el: root,
    update(f, value) {
      cur = { f };
      strong.textContent = f.label ?? '';
      small.textContent = f.help ?? '';
      small.hidden = !f.help;
      box.checked = !!value;
    },
  };
}

// ---------- select ----------

function selectField(emit) {
  let cur = { f: {} };
  let optsKey = null;
  const headHost = el('div');
  const sel = el('select', { class: 'sel' });
  const root = el('div', { class: 'c-configform-field' }, headHost, sel);
  sel.addEventListener('change', () => {
    const hit = (cur.f.options ?? []).find((o) => String(optValue(o)) === sel.value);
    if (hit !== undefined) { sfx('tap'); emit(cur.f.key, optValue(hit)); }
  });
  return {
    el: root,
    update(f, value) {
      cur = { f };
      headHost.replaceChildren(head(f.label, f.help));
      const k = sig(f.options);
      if (k !== optsKey) {
        optsKey = k;
        sel.replaceChildren(...(f.options ?? []).map((o) => el('option', { value: String(optValue(o)) }, optLabel(o))));
      }
      sel.value = String(value);
    },
  };
}

// ---------- roles ----------

function rolesField(emit) {
  let cur = { f: {}, v: [] };
  let rowIds = null;          // structural key of the array editor
  const rows = new Map();     // id → row view
  const headHost = el('div');
  const list = el('div', { class: 'role-list' });
  const fillerLabel = el('span', { class: 'field-label', text: '剩低嘅人數自動當' });
  const fillerSel = el('select', { class: 'sel', 'aria-label': '自動填充角色' });
  const fillerPick = el('div', { class: 'filler-pick' }, fillerLabel, fillerSel);
  const addBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '＋ 加一個角色');
  const root = el('div', { class: 'c-configform-field c-configform-roles' }, headHost, list, fillerPick, addBtn);

  const roles = () => (Array.isArray(cur.v) ? cur.v : []);
  const isArrayShape = () => Array.isArray(cur.v) || !cur.f.options;
  const patchRole = (id, patch) => emit(cur.f.key, roles().map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const maxCount = () => cur.f.max ?? 99;
  const minCount = () => cur.f.min ?? 0;

  function arrayRow(id) {
    const emoji = el('input', { class: 'emoji-btn', type: 'text', 'aria-label': '角色 emoji', autocomplete: 'off' });
    const name = el('input', { class: 'role-name-in', type: 'text', maxlength: '16', 'aria-label': '角色名', autocomplete: 'off' });
    const minus = el('button', { type: 'button', 'aria-label': '減少' }, '−');
    const num = el('span');
    const plus = el('button', { type: 'button', 'aria-label': '增加' }, '+');
    const auto = el('span', { class: 'auto', text: '自動' });
    const cnt = el('div', { class: 'cnt' }, minus, num, plus, auto);
    const del = el('button', { class: 'del', type: 'button', 'aria-label': '刪除角色' }, '✕');
    const root2 = el('div', { class: 'role-row' }, emoji, name, cnt, del);

    const me = () => roles().find((r) => r.id === id);
    // Typing edits go out as the user types; update() never overwrites a focused input.
    emoji.addEventListener('input', () => {
      const e = graphemes(emoji.value, 2);
      if (e !== emoji.value) emoji.value = e;   // an input must not overflow what the engine keeps
      patchRole(id, { emoji: e || '❓' });
    });
    name.addEventListener('input', () => {
      const n = graphemes(name.value, 8);
      if (n !== name.value) name.value = n;
      patchRole(id, { name: n });
    });
    emoji.addEventListener('change', () => { emoji.value = me()?.emoji ?? ''; });
    minus.addEventListener('click', () => patchRole(id, { count: clamp((me()?.count ?? 0) - 1, minCount(), maxCount()) }));
    plus.addEventListener('click', () => patchRole(id, { count: clamp((me()?.count ?? 0) + 1, minCount(), maxCount()) }));
    del.addEventListener('click', () => {
      if (roles().length <= 2) { toast('最少要兩個角色'); return; }
      sfx('tap');
      emit(cur.f.key, roles().filter((r) => r.id !== id));
    });

    return {
      el: root2,
      update(r) {
        if (document.activeElement !== emoji) emoji.value = r.emoji ?? '';
        if (document.activeElement !== name) name.value = r.name ?? '';
        const locked = cur.f.fixed === true;
        emoji.disabled = locked; name.disabled = locked; del.hidden = locked;
        root2.classList.toggle('is-filler', !!r.filler);
        minus.hidden = plus.hidden = num.hidden = !!r.filler;
        auto.hidden = !r.filler;
        num.textContent = String(r.count ?? 0);
        minus.disabled = (r.count ?? 0) <= minCount();
        plus.disabled = (r.count ?? 0) >= maxCount();
      },
    };
  }

  function updateArray() {
    const list0 = roles();
    const key = list0.map((r) => r.id).join('|');
    if (key !== rowIds) {
      rowIds = key;
      for (const [id, row] of rows) if (!list0.some((r) => r.id === id)) { row.el.remove(); rows.delete(id); }
      for (const r of list0) if (!rows.has(r.id)) rows.set(r.id, arrayRow(r.id));
      list.replaceChildren(...list0.map((r) => rows.get(r.id).el));
    }
    for (const r of list0) rows.get(r.id).update(r);

    // which role soaks up the leftover seats
    const fk = sig(list0.map((r) => [r.id, r.emoji, r.name]));
    if (fillerSel.dataset.k !== fk) {
      fillerSel.dataset.k = fk;
      fillerSel.replaceChildren(
        ...list0.map((r) => el('option', { value: r.id }, `${r.emoji} ${r.name}`)),
        el('option', { value: '' }, '（唔自動填充）'));
    }
    fillerSel.value = list0.find((r) => r.filler)?.id ?? '';
    fillerPick.hidden = cur.f.fixed === true;
    addBtn.hidden = cur.f.fixed === true;
  }

  fillerSel.addEventListener('change', () => {
    emit(cur.f.key, roles().map((r) => ({ ...r, filler: r.id === fillerSel.value })));
  });
  addBtn.addEventListener('click', () => {
    const ids = new Set(roles().map((r) => r.id));
    let n = roles().length + 1;
    while (ids.has(`r${n}`)) n++;
    const fresh = { id: `r${n}`, name: '新角色', emoji: '❓', count: 1, desc: '' };
    const at = roles().findIndex((r) => r.filler);
    const next = roles().slice();
    next.splice(at < 0 ? next.length : at, 0, fresh);
    sfx('tap');
    emit(cur.f.key, next);
  });

  // object-of-counts shape (fixed role list from field.options)
  function updateMap() {
    const defs = cur.f.options ?? [];
    const key = 'map:' + sig(defs.map((d) => d.id ?? d.value));
    if (key !== rowIds) {
      rowIds = key;
      rows.clear();
      list.replaceChildren(...defs.map((d) => {
        const id = String(d.id ?? d.value);
        const minus = el('button', { type: 'button', 'aria-label': '減少' }, '−');
        const num = el('span');
        const plus = el('button', { type: 'button', 'aria-label': '增加' }, '+');
        const nameEl = el('span', { class: 'role-name-static' });
        const root2 = el('div', { class: 'role-row' },
          el('span', { class: 'emoji-btn static', text: d.emoji ?? '❔' }), nameEl,
          d.auto ? el('div', { class: 'cnt' }, el('span', { class: 'auto', text: '自動' }))
            : el('div', { class: 'cnt' }, minus, num, plus));
        const n = () => Number((cur.v ?? {})[id] ?? d.min ?? 0);
        const lim = () => [d.min ?? cur.f.min ?? 0, d.max ?? cur.f.max ?? 99];
        minus.addEventListener('click', () => emit(cur.f.key, { ...(cur.v ?? {}), [id]: clamp(n() - 1, ...lim()) }));
        plus.addEventListener('click', () => emit(cur.f.key, { ...(cur.v ?? {}), [id]: clamp(n() + 1, ...lim()) }));
        rows.set(id, {
          el: root2,
          update() {
            nameEl.textContent = d.name ?? d.label ?? id;
            num.textContent = String(n());
            minus.disabled = n() <= lim()[0];
            plus.disabled = n() >= lim()[1];
          },
        });
        return root2;
      }));
    }
    for (const row of rows.values()) row.update();
    fillerPick.hidden = true;
    addBtn.hidden = true;
  }

  return {
    el: root,
    update(f, value) {
      cur = { f, v: value };
      headHost.replaceChildren(head(f.label, f.help));
      if (isArrayShape()) updateArray(); else updateMap();
    },
  };
}

// ---------- categories ----------

function categoriesField(emit) {
  let cur = { f: {}, v: {} };
  const headHost = el('div');
  const catHost = el('div', { class: 'c-configform-chips' });
  const levelHead = el('span', { class: 'field-label', text: '難度' });
  const levelHost = el('div', { class: 'c-configform-chips' });
  const stats = el('p', { class: 'c-configform-stats' });
  const allBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '全選');
  const root = el('div', { class: 'c-configform-field' }, headHost, catHost, allBtn, levelHead, levelHost, stats);

  const keyOf = (names, v) => names.find((k) => v && k in v) ?? names[0];
  const get = (names) => { const k = keyOf(names, cur.v); return Array.isArray(cur.v?.[k]) ? cur.v[k] : []; };
  const write = (names, list) => {
    const base = { ...(cur.v ?? {}) };
    base[keyOf(names, cur.v)] = list;
    emit(cur.f.key, base);
  };
  const CATS = ['cats', 'categories'];
  const LEVELS = ['levels', 'level'];

  function chips(host, options, names) {
    const picked = new Set(get(names).map(String));
    host.replaceChildren(...options.map((o) => {
      const val = optValue(o);
      return el('button', {
        class: 'c-configform-chip' + (picked.has(String(val)) ? ' on' : ''), type: 'button',
        'aria-pressed': picked.has(String(val)) ? 'true' : 'false',
        onclick: () => {
          sfx('tap');
          const now = new Set(get(names).map(String));
          if (now.has(String(val))) now.delete(String(val)); else now.add(String(val));
          write(names, options.map(optValue).filter((x) => now.has(String(x))));
        },
      }, optLabel(o));
    }));
  }

  allBtn.addEventListener('click', () => {
    const all = (cur.f.options ?? []).map(optValue);
    const allOn = get(CATS).length === all.length;
    sfx('tap');
    write(CATS, allOn ? [] : all);
  });

  return {
    el: root,
    update(f, value) {
      cur = { f, v: value && typeof value === 'object' ? value : {} };
      headHost.replaceChildren(head(f.label, f.help));
      chips(catHost, f.options ?? [], CATS);
      allBtn.hidden = (f.options ?? []).length < 3;
      allBtn.textContent = get(CATS).length === (f.options ?? []).length ? '全部取消' : '全選';
      levelHead.hidden = levelHost.hidden = !f.levels?.length;
      if (f.levels?.length) chips(levelHost, f.levels, LEVELS);
      const s = f.stats;
      stats.hidden = !s;
      if (s) stats.textContent = `已用 ${Number(s.used ?? 0).toLocaleString('en-US')} / ${Number(s.total ?? 0).toLocaleString('en-US')}`;
    },
  };
}

function unknownField() {
  const root = el('div', { class: 'c-configform-field' });
  return {
    el: root,
    update(f) { root.textContent = `（未支援嘅設定類型：${f.type}）`; },
  };
}

const BUILDERS = {
  int: numberField, seconds: numberField, bool: boolField, select: selectField,
  roles: rolesField, categories: categoriesField,
};

export function ConfigForm(props = {}) {
  let p = props;
  let local = {};
  const views = new Map();   // key → { type, view }
  const root = el('div', { class: 'c-configform' });

  // Keep a local copy so two quick taps before the host echoes do not lose the first.
  const emit = (key, val) => {
    local = { ...local, [key]: val };
    p.onChange?.({ ...local });
  };

  const api = {
    el: root,
    update(next = {}) {
      p = next;
      local = { ...(p.value ?? {}) };
      const fields = (p.fields ?? []).filter((f) => f && f.key);

      for (const f of fields) {
        let entry = views.get(f.key);
        if (!entry || entry.type !== f.type) {
          entry = { type: f.type, view: (BUILDERS[f.type] ?? unknownField)(emit) };
          views.set(f.key, entry);
        }
        entry.view.update(f, local[f.key]);
      }
      for (const k of [...views.keys()]) {
        if (!fields.some((f) => f.key === k)) { views.get(k).view.el.remove(); views.delete(k); }
      }

      const wanted = fields.map((f) => views.get(f.key).view.el);
      const same = wanted.length === root.children.length && wanted.every((n, i) => root.children[i] === n);
      if (!same) root.replaceChildren(...wanted);   // re-appending would blur a focused input, so only when needed
    },
    destroy() { root.remove(); },
  };

  api.update(p);
  return api;
}

export default ConfigForm;
