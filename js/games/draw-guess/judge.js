// ============================================================
// judge.js — the typed-guess checker for 你畫我猜 (pure, no DOM, Node-importable).
//
//   analyse(text, entry, strictness) → { kind, rule, g }
//     kind: 'right' | 'close' | 'near' | 'wrong'
//     entry: { w, alt?: string[], near?: string[] }
//   maskAnswer(text, entry, revealed) → the drawer's on-screen copy of a private guess (answer characters → ＊)
//
// What it does (docs/research/draw-guess.md, "Voting & resolution A"):
//  1. normalise the guess: NFKC (full-width letters/digits), lower-case, drop whitespace,
//     punctuation and symbols, then fold Traditional characters to Simplified
//     (fold.js; the groups whose simplified form is shared by different words — 面/麵,
//     後/后, 乾/幹/干, 髮/發 — are NOT folded; instead the ANSWER is expanded to every spelling
//     of those characters, so the guess side never conflates two words).
//  2. the answers are the word plus every `alt` (regional names, synonyms, Latin aliases).
//  3. candidates = the guess, and the guess with at most one leading and one trailing filler
//     (我估 / 係 / 呀 / 嘅 ...) removed; stripping can only ADD matches.
//  4. any candidate equals an answer → right. A message listing several answers never matches
//     (no tokenising) — but it contains one, so it lands in `close` and stays hidden from the table.
//  5. else `close` when (i) answer ≥ 3 chars and edit distance is exactly 1, (ii) a 2-char
//     answer and the guess shares a character in the same place or is the answer reversed,
//     (iii) answer ≥ 3 chars, ≥ 60% of its characters are present and the length differs by
//     ≤ 1 (scrambled), (iv) the guess contains the answer, or is a ≥ 2-char piece of it;
//     `near` when the guess is in the entry's own `near` list ("right direction").
//
// Strictness:
//   strict    only exact matches (NFKC, case, spaces, punctuation) count as right. Everything that
//             the standard checker would accept or call close is `close` — never public text.
//   standard  as above.
//   loose     additionally, a (iv) hit counts as right when the guess is at most (answer + 2) long.
//
// Why `close` is never `wrong`: wrong guesses are shown to the whole table as text. A guess that
// contains the answer (in any script) must therefore never be classed wrong, or one sloppy
// message ("老虎？獅子？") would hand the word to everybody.
// ============================================================

import { FROM, TO } from './fold.js?v=1';

const FOLD = new Map();
for (let i = 0; i < FROM.length; i++) FOLD.set(FROM[i], TO[i]);

/** Groups whose members must never be folded together (see header). Every member of a group is a spelling of the others. */
export const AMBIGUOUS = ['面麵麪麺', '后後', '干乾幹榦', '发發髮'];
const GROUP_OF = new Map();
for (const g of AMBIGUOUS) for (const c of g) GROUP_OF.set(c, Array.from(g));

const DROP = /[\p{Z}\p{C}\p{P}\p{S}\s]+/gu;
const cp = (s) => Array.from(s);

export function fold(s) {
  let out = '';
  for (const c of s) out += FOLD.get(c) ?? c;
  return out;
}

/** NFKC, lower-case, whitespace / punctuation / symbols removed; folded to Simplified unless { fold: false }. */
export function normalise(text, { fold: doFold = true } = {}) {
  const t = String(text ?? '').normalize('NFKC').toLowerCase().replace(DROP, '');
  return doFold ? fold(t) : t;
}

// ---------- fillers ----------

const LEAD = ['係唔係', '是不是', '係咪', '我估', '我猜', '估', '猜', '係', '是'].map((x) => normalise(x))
  .sort((a, b) => b.length - a.length);
const TRAIL = ['呀', '啊', '嗎', '吗', '呢', '喇', '啦', '囉', '咯', '咩', '嘅'].map((x) => normalise(x));

/** The guess plus its filler-stripped forms (distinct, non-empty). */
export function candidates(g) {
  const out = new Set();
  if (g) out.add(g);
  let lead = '';
  for (const f of LEAD) { if (g.length > f.length && g.startsWith(f)) { lead = f; break; } }
  const rest = g.slice(lead.length);
  let trail = '';
  for (const f of TRAIL) { if (rest.length > f.length && rest.endsWith(f)) { trail = f; break; } }
  const core = rest.slice(0, rest.length - trail.length);
  if (lead && rest) out.add(rest);
  if (trail) out.add(g.slice(0, g.length - trail.length));
  if (core) out.add(core);
  return [...out];
}

// ---------- answers ----------

const MAX_VARIANTS = 32;

/** Every spelling of one folded answer, expanding the ambiguous characters. */
function spellings(a) {
  let combos = [''];
  for (const c of cp(a)) {
    const opts = GROUP_OF.get(c) ?? [c];
    if (opts.length === 1) { combos = combos.map((x) => x + c); continue; }
    const next = [];
    for (const x of combos) for (const o of opts) next.push(x + o);
    if (next.length > MAX_VARIANTS) { combos = combos.map((x) => x + c); continue; }   // too many: keep the written form
    combos = next;
  }
  return combos;
}

/** Normalised answers of an entry: the word and every alt, with ambiguous characters expanded. */
export function answersOf(entry) {
  const raw = [entry?.w, ...(Array.isArray(entry?.alt) ? entry.alt : [])];
  const set = new Set();
  for (const r of raw) {
    if (typeof r !== 'string') continue;
    const a = normalise(r);
    if (a) for (const v of spellings(a)) set.add(v);
  }
  return [...set];
}

// ---------- the drawer's copy of a private guess ----------

const STAR = '＊';

/**
 * A near-miss guess as the DRAWER's feed shows it. The drawer's phone sits on the table (typed + paper play) or is
 * held out while drawing, so a private (close / near) text must not spell the answer to whoever glances at it: every
 * character that occurs in the word or an alias (compared after the fold, the ambiguous groups expanded) becomes ＊,
 * unless the hint mask already made it public (`revealed`: the revealed characters). The drawer knows the word, so
 * 「＊龍化石」 still reads as the near miss it was and can still be ✔'d.
 *
 * Only for private texts. A WRONG guess is shown verbatim on every phone, so masking it on the drawer's phone alone
 * would let anyone compare the two screens and read off which characters are in the answer.
 */
export function maskAnswer(text, entry, revealed = []) {
  const s = String(text ?? '');
  const secret = new Set();
  for (const a of answersOf(entry)) for (const c of cp(a)) secret.add(c);
  const pub = new Set();
  for (const r of revealed) {
    for (const c of cp(normalise(String(r ?? '')))) for (const v of GROUP_OF.get(c) ?? [c]) pub.add(v);
  }
  let out = '';
  for (const c of s) {
    const n = cp(normalise(c));
    out += n.some((x) => secret.has(x) && !pub.has(x)) ? STAR : c;
  }
  return out;
}

// ---------- distance helpers ----------

export function editDistance(a, b) {
  const x = typeof a === 'string' ? cp(a) : a;
  const y = typeof b === 'string' ? cp(b) : b;
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

function overlap(x, y) {
  const count = new Map();
  for (const c of y) count.set(c, (count.get(c) ?? 0) + 1);
  let n = 0;
  for (const c of x) {
    const k = count.get(c) ?? 0;
    if (k > 0) { n++; count.set(c, k - 1); }
  }
  return n;
}

/** Which closeness rule (if any) says `c` is a near miss of the answer `a`. */
function closeRule(c, a) {
  if (c === a) return '';
  const x = cp(c);
  const y = cp(a);
  const L = y.length;
  if (L >= 3 && editDistance(x, y) === 1) return 'edit';
  if (L === 2 && x.length === 2 && (x[0] === y[0] || x[1] === y[1] || (x[0] === y[1] && x[1] === y[0]))) return 'pair';
  if (L >= 3 && Math.abs(x.length - L) <= 1 && overlap(x, y) / L >= 0.6) return 'scramble';
  if (c.includes(a)) return 'contains';
  if (x.length >= 2 && a.includes(c)) return 'part';
  return '';
}

// ---------- the checker ----------

export function analyse(text, entry, strictness = 'standard') {
  const g = normalise(text);
  const out = { kind: 'wrong', rule: '', g };
  if (!g) return out;
  const answers = answersOf(entry);
  if (!answers.length) return out;
  const aSet = new Set(answers);
  const cands = candidates(g);

  if (strictness === 'strict') {
    const raw = normalise(text, { fold: false });
    const exact = [entry?.w, ...(Array.isArray(entry?.alt) ? entry.alt : [])]
      .filter((x) => typeof x === 'string').map((x) => normalise(x, { fold: false }));
    if (raw && exact.includes(raw)) return { kind: 'right', rule: 'exact', g };
    // everything the standard checker would let through is only "close" here (and stays hidden)
    const std = analyse(text, entry, 'standard');
    return std.kind === 'wrong' ? std : { kind: 'close', rule: std.rule || 'folded', g };
  }

  if (cands.some((c) => aSet.has(c))) return { kind: 'right', rule: 'match', g };

  if (strictness === 'loose') {
    // contained either way, but never longer than the answer + 2: a message that lists several answers still fails
    for (const c of cands) {
      for (const a of answers) {
        const len = cp(c).length;
        if (c !== a && len <= cp(a).length + 2 && (c.includes(a) || (len >= 2 && a.includes(c)))) return { kind: 'right', rule: 'loose', g };
      }
    }
  }
  for (const c of cands) {
    for (const a of answers) {
      const rule = closeRule(c, a);
      if (rule) return { kind: 'close', rule, g };
    }
  }

  const near = Array.isArray(entry?.near) ? entry.near.map((x) => normalise(x)).filter(Boolean) : [];
  if (near.some((x) => cands.includes(x))) return { kind: 'near', rule: 'near', g };
  return out;
}
