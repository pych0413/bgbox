// ============================================================
// bag.js — draw-without-replacement over the content banks (js/data/*.js).
//
//   const bag = createBag({ storage });          // storage: localStorage-like, a Map, or omitted
//   await bag.load('undercover');                 // dynamic import of the bank file
//   bag.draw('undercover', (e) => e.level <= 2);  // → entry | null, never repeats until exhausted
//   bag.stats('undercover');                      // → { used, total }
//   bag.release('draw', '蘋果');                  // an offered-but-unused entry goes back into the pool
//
// Used keys are persisted per bank on this device (`bgb:bag:<bankId>` = array of
// keys), so a bank keeps not-repeating across evenings. When the filtered pool is
// exhausted the used keys for that pool are forgotten and a notice is queued:
// onNotice(text, { kind: 'bag-reshuffle', bankId }), so the UI can offer
// 重置 / 揀多啲類別 next to the toast.
//
// Engines receive the bag in ctx and must draw during setup/act/advance only,
// never inside view().
// ============================================================

import { makeStore } from './util.js?v=20261003102525';
import { cryptoRng, clone } from './engine-kit.js?v=20261003102525';

/** Bank id → file, key function, loader. Literal import() strings so tooling can stamp ?v=. */
export const BANKS = {
  undercover: {
    name: '臥底詞庫',
    file: 'undercover-words.js',
    load: () => import('../data/undercover-words.js?v=20261003102525'),
    key: (e) => [e.a, e.b].sort().join('|'),
  },
  spyfall: {
    name: '間諜地點',
    file: 'spyfall-locations.js',
    load: () => import('../data/spyfall-locations.js?v=20261003102525'),
    key: (e) => e.name,
  },
  draw: {
    name: '畫畫題目',
    file: 'draw-words.js',
    load: () => import('../data/draw-words.js?v=20261003102525'),
    key: (e) => e.w,
  },
  '9upper': {
    name: '瞎掰王題目',
    file: '9upper-terms.js',
    load: () => import('../data/9upper-terms.js?v=20261003102525'),
    key: (e) => e.term,
  },
};

const USED_KEY = (id) => `bgb:bag:${id}`;
const CUSTOM_KEY = (id) => `bgb:bagcustom:${id}`;

/** The draw bank ships as [{ cat, words: [{ w, alt, level }] }]; engines want flat { w, alt, level, cat }. */
function flatten(entries) {
  const out = [];
  for (const e of entries) {
    if (e && Array.isArray(e.words)) {
      for (const w of e.words) out.push({ w: w.w, alt: w.alt ?? [], level: w.level ?? 1, cat: e.cat });
    } else {
      out.push(e);
    }
  }
  return out;
}

/**
 * @param {object} [opts]
 * @param {*}        [opts.storage]  Web-Storage-like, Map, or omitted (localStorage if present)
 * @param {Function} [opts.rng]      () => [0,1); defaults to crypto
 * @param {object}   [opts.banks]    extra/override banks: { id: { load: async () => entries, key: (e) => string } }
 * @param {Function} [opts.onNotice] (text) => void, called when a pool is exhausted and reshuffled
 */
export function createBag({ storage, rng = cryptoRng(), banks: extra = {}, onNotice } = {}) {
  const store = makeStore(storage);
  const table = { ...BANKS, ...extra };
  const loaded = new Map();     // id → entries[] (flattened, shipped content)
  const usedSets = new Map();   // id → Set(key)
  const notices = [];

  const spec = (id) => {
    const s = table[id];
    if (!s) throw new Error(`unknown bank: ${id}`);
    return s;
  };
  const used = (id) => {
    let s = usedSets.get(id);
    if (!s) { s = new Set(store.get(USED_KEY(id), [])); usedSets.set(id, s); }
    return s;
  };
  const saveUsed = (id) => store.set(USED_KEY(id), [...used(id)]);
  const customList = (id) => {
    const list = store.get(CUSTOM_KEY(id), []);
    return Array.isArray(list) ? list : [];
  };
  const pool = (id, filter) => {
    if (!loaded.has(id)) throw new Error(`bank not loaded: ${id}`);
    const all = [...loaded.get(id), ...customList(id)];
    return filter ? all.filter(filter) : all;
  };

  const bag = {
    /** Import the bank file (idempotent). Resolves to the number of shipped entries. */
    async load(id) {
      const s = spec(id);
      if (!loaded.has(id)) {
        const mod = await s.load();
        const raw = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
        if (!Array.isArray(raw)) throw new Error(`bank ${id} (${s.file ?? 'custom'}) did not export an array`);
        loaded.set(id, flatten(raw));
      }
      return loaded.get(id).length;
    },

    isLoaded: (id) => loaded.has(id),

    /** One entry, without replacement. null when the (filtered) pool is empty. */
    draw(id, filter) {
      const { key } = spec(id);
      const entries = pool(id, filter);
      if (!entries.length) return null;
      const u = used(id);
      let fresh = entries.filter((e) => !u.has(key(e)));
      if (!fresh.length) {
        for (const e of entries) u.delete(key(e));
        fresh = entries;
        const text = `「${table[id].name ?? id}」揀嘅題目用晒，已經重新洗牌`;
        notices.push(text);
        if (notices.length > 20) notices.splice(0, notices.length - 20);   // nobody may ever take them
        try { onNotice?.(text, { kind: 'bag-reshuffle', bankId: id }); } catch (e) { console.error('[bag] onNotice threw', e); }
      }
      const pick = fresh[Math.min(fresh.length - 1, Math.floor(rng() * fresh.length))];
      u.add(key(pick));
      saveUsed(id);
      return clone(pick);
    },

    /** { used, total } over the filtered pool (shipped + custom entries). */
    stats(id, filter) {
      const { key } = spec(id);
      const entries = pool(id, filter);
      const u = used(id);
      return { used: entries.filter((e) => u.has(key(e))).length, total: entries.length };
    },

    /** The bank's display name (e.g. 臥底詞庫), or its id. */
    label: (id) => table[id]?.name ?? String(id),

    /** Forget every used key for this bank. */
    reset(id) {
      spec(id);
      usedSets.set(id, new Set());
      saveUsed(id);
    },

    /**
     * Put one drawn entry back (by key, e.g. a word that was offered but not chosen), so it can come
     * up again. Returns true if it was marked used. Draw-guess offers three words and keeps one.
     */
    release(id, k) {
      spec(id);
      if (typeof k !== 'string' || !used(id).delete(k)) return false;
      saveUsed(id);
      return true;
    },

    /** Queued "pool exhausted" messages since the last call. */
    takeNotices() { return notices.splice(0); },

    // ----- custom entries (stored locally, mixed into draws) -----
    custom: (id) => customList(id).map((e) => clone(e)),

    /** Returns the entry's key, or null if it has no key or already exists. */
    addCustom(id, entry) {
      const { key } = spec(id);
      if (!entry || typeof entry !== 'object') return null;
      let k;
      try { k = key(entry); } catch { return null; }
      if (typeof k !== 'string' || !k.replace(/\|/g, '')) return null;
      const exists = [...(loaded.get(id) ?? []), ...customList(id)].some((e) => key(e) === k);
      if (exists) return null;
      store.set(CUSTOM_KEY(id), [...customList(id), clone(entry)]);
      return k;
    },

    removeCustom(id, k) {
      const { key } = spec(id);
      const list = customList(id);
      const next = list.filter((e) => key(e) !== k);
      if (next.length === list.length) return false;
      store.set(CUSTOM_KEY(id), next);
      used(id).delete(k);
      saveUsed(id);
      return true;
    },
  };
  return bag;
}
