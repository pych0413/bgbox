#!/usr/bin/env node
// check-imports.mjs — fail if the app would be half-broken on GitHub Pages.
//
//   node tools/check-imports.mjs [--same-stamp]
//
// Scans index.html, sw.js, js/**, css/** and manifest.webmanifest for every relative reference to
// one of our own files (static import, export-from, import('...'), new URL(..., import.meta.url),
// href/src, CSS @import/url(), manifest icons, the service worker's PRECACHE list) and reports:
//   ERROR  target file is missing, or its name differs only in letter case (Windows is
//          case-insensitive, GitHub Pages is not), or it is a directory
//   ERROR  a .js/.mjs/.css reference has no ?v=<digits> (tools/bump-version.sh could not restamp it)
//   ERROR  a bare specifier ('lodash') or a root-absolute path ('/js/x.js'): neither resolves
//          under https://<user>.github.io/<repo>/
//   WARN   a dynamic specifier that cannot be resolved statically (still checked for ?v=)
//   WARN   a file under js/ or css/ that is not in the PRECACHE list (offline gap)
//   WARN   more than one ?v= stamp in the tree (ERROR with --same-stamp, which bump-version.sh uses)
//
// Exit code 1 if any ERROR. Pure Node, no dependencies.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAME_STAMP = process.argv.includes('--same-stamp');

const errors = [];
const warnings = [];
const stamps = new Map(); // stamp -> [where, ...]
let refCount = 0;

// ---- file system helpers ----------------------------------------------------------------------

const toPosix = (p) => p.split(sep).join('/');
const rel = (abs) => toPosix(relative(ROOT, abs));

function walk(dir, exts) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(abs);
  }
  return out;
}

const dirCache = new Map();
function listDir(dir) {
  if (!dirCache.has(dir)) {
    try { dirCache.set(dir, readdirSync(dir)); } catch { dirCache.set(dir, null); }
  }
  return dirCache.get(dir);
}

/** 'ok' | 'missing' | 'directory' | 'outside' | 'case:<real name>' — letter case is enforced. */
function probe(abs) {
  const r = relative(ROOT, abs);
  if (r.startsWith('..')) return 'outside';
  let cur = ROOT;
  for (const seg of r.split(sep).filter(Boolean)) {
    const names = listDir(cur);
    if (!names) return 'missing';
    if (!names.includes(seg)) {
      const alt = names.find((n) => n.toLowerCase() === seg.toLowerCase());
      return alt ? `case:${alt}` : 'missing';
    }
    cur = join(cur, seg);
  }
  return statSync(abs).isFile() ? 'ok' : 'directory';
}

// ---- source scanning --------------------------------------------------------------------------

const lineOf = (text, index) => {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
};

/**
 * Replace comments with spaces (newlines kept, so offsets and line numbers survive). Strings and
 * template literals are skipped over; a '/' starts a regex literal when the previous significant
 * character cannot end an expression.
 */
function stripJsComments(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  const templateDepths = []; // brace depth at each open `${`
  let braces = 0;
  let prev = '';             // previous significant (non-space, non-comment) character
  let i = 0;

  const skipString = (quote) => {
    i++;
    while (i < src.length && src[i] !== quote && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
    i++;
  };
  const skipTemplate = () => { // from just after a backtick or a closing `}` of a ${ }
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') { templateDepths.push(braces); braces++; i += 2; return; }
      i++;
    }
  };

  while (i < src.length) {
    const ch = src[i];
    const nx = src[i + 1];
    if (ch === '/' && nx === '/') {
      const end = src.indexOf('\n', i);
      const to = end === -1 ? src.length : end;
      blank(i, to); i = to; continue;
    }
    if (ch === '/' && nx === '*') {
      const end = src.indexOf('*/', i + 2);
      const to = end === -1 ? src.length : end + 2;
      blank(i, to); i = to; continue;
    }
    if (ch === '\'' || ch === '"') { skipString(ch); prev = ch; continue; }
    if (ch === '`') { i++; skipTemplate(); prev = '`'; continue; }
    if (ch === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      i++; // regex literal
      let inClass = false;
      while (i < src.length && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        i++;
      }
      i++; prev = '/'; continue;
    }
    if (ch === '{') braces++;
    if (ch === '}') {
      braces--;
      if (templateDepths.length && templateDepths[templateDepths.length - 1] === braces) {
        templateDepths.pop(); i++; skipTemplate(); prev = '`'; continue;
      }
    }
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  return out.join('');
}

/**
 * Read the first argument of a call whose '(' is at src[open]. String literals contribute their
 * text, anything else becomes '${}', so  './g/' + id + '/index.js?v=1'  -> './g/${}/index.js?v=1'.
 */
function readFirstArg(src, open) {
  let i = open + 1;
  let value = '';
  let depth = 0;
  let pendingExpr = false;
  const flushExpr = () => { if (pendingExpr) { value += '${}'; pendingExpr = false; } };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\'' || ch === '"' || ch === '`') {
      flushExpr();
      let j = i + 1;
      while (j < src.length && src[j] !== ch) { if (src[j] === '\\') j++; j++; }
      value += src.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; pendingExpr = true; }
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break;
      depth--;
    } else if (ch === ',' && depth === 0) break;
    else if (ch === '+' && depth === 0) { /* concatenation */ }
    else if (!/\s/.test(ch)) pendingExpr = true;
    i++;
  }
  flushExpr();
  return value;
}

/** Collect module-level references from JavaScript (comments already blanked). */
function jsRefs(src) {
  const refs = [];
  const add = (index, spec, kind, base) => refs.push({ index, spec, kind, base });
  let m;

  const fromRe = /\b(?:import(?!\s*[.(])|export)\b[^'"`;()]*?\bfrom\s*(['"])([^'"\n]*)\1/g;
  while ((m = fromRe.exec(src))) add(m.index, m[2], 'import', 'file');

  const bareRe = /\bimport\s*(['"])([^'"\n]*)\1/g;
  while ((m = bareRe.exec(src))) add(m.index, m[2], 'import', 'file');

  const dynRe = /\bimport\s*\(/g;
  while ((m = dynRe.exec(src))) add(m.index, readFirstArg(src, m.index + m[0].length - 1), 'import()', 'file');

  const urlRe = /\bnew\s+URL\s*\(\s*(['"`])([^'"`\n]*)\1\s*,\s*import\.meta\.url/g;
  while ((m = urlRe.exec(src))) add(m.index, m[2], 'new URL', 'file');

  // DOM-ish string literals: resolved against the page (site root), not the module.
  const attrRe = /\b(?:href|src)\s*[:=]\s*(['"`])([^'"`\n]*)\1/g;
  while ((m = attrRe.exec(src))) {
    if (/\.[a-z0-9]{2,5}(?:[?#]|$)/i.test(m[2])) add(m.index, m[2], 'href/src', 'root');
  }
  const setRe = /setAttribute\(\s*['"](?:href|src)['"]\s*,\s*(['"`])([^'"`\n]*)\1/g;
  while ((m = setRe.exec(src))) add(m.index, m[2], 'setAttribute', 'root');
  return refs;
}

const cssRefs = (src) => {
  const refs = [];
  let m;
  const importRe = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1/g;
  while ((m = importRe.exec(src))) refs.push({ index: m.index, spec: m[2], kind: '@import', base: 'file' });
  const urlRe = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;
  while ((m = urlRe.exec(src))) refs.push({ index: m.index, spec: m[2], kind: 'url()', base: 'file' });
  return refs;
};

function htmlRefs(src) {
  const refs = [];
  const scripts = [];
  const blanked = src.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  const body = blanked.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs, code, offset) => {
    if (!/\bsrc\s*=/.test(attrs)) scripts.push({ code, offset: offset + all.indexOf(code) });
    return all.replace(code, code.replace(/[^\n]/g, ' ')); // inline code is scanned as JS below
  });
  const attrRe = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = attrRe.exec(body))) refs.push({ index: m.index, spec: m[1] ?? m[2], kind: 'href/src', base: 'root', strictAbs: true });
  for (const { code, offset } of scripts) {
    for (const r of jsRefs(stripJsComments(code))) refs.push({ ...r, index: r.index + offset });
  }
  return refs;
}

// ---- reference checking -----------------------------------------------------------------------

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i; // https:, data:, blob:, node:, //cdn...
const NEEDS_STAMP = /\.(?:m?js|css)$/i;

function check(fileAbs, text, ref) {
  const spec = ref.spec.trim();
  const where = `${rel(fileAbs)}:${lineOf(text, ref.index)}`;
  const label = `${ref.kind} '${spec}'`;
  const bad = (msg) => errors.push(`${where}  ${label}  ${msg}`);
  if (spec === '' || spec.startsWith('#') || EXTERNAL.test(spec)) return;
  refCount++;

  if (ref.kind === 'import' || ref.kind === 'import()') {
    if (!spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('/') && !spec.includes('${')) {
      return bad('bare specifier: browsers cannot resolve it without an import map');
    }
  }
  if (spec.startsWith('/')) {
    if (ref.kind === 'href/src' && !ref.strictAbs) return; // 'x' + '/y.css' string pieces: cannot tell
    return bad('root-absolute path breaks under the /<repo>/ subpath of GitHub Pages');
  }

  const [pathAndQuery] = spec.split('#');
  const [p, query = ''] = pathAndQuery.split('?');
  const dynamic = p.includes('${');

  if (NEEDS_STAMP.test(p) || (dynamic && /\.(?:m?js|css)$/i.test(p))) {
    const stamp = /(?:^|&)v=(\d+|\$\{[^}]*\})$/.exec(query);
    if (!stamp) bad('has no ?v=<digits> stamp');
    else if (/^\d+$/.test(stamp[1])) {
      if (!stamps.has(stamp[1])) stamps.set(stamp[1], []);
      stamps.get(stamp[1]).push(where);
    }
  }
  if (dynamic) { warnings.push(`${where}  ${label}  dynamic path: existence not checked`); return; }

  const baseDir = ref.base === 'root' ? ROOT : dirname(fileAbs);
  const target = resolve(baseDir, p);
  const state = probe(target);
  if (state === 'ok') return;
  const shown = rel(target);
  if (state === 'missing') bad(`-> ${shown} does not exist`);
  else if (state === 'directory') bad(`-> ${shown} is a directory`);
  else if (state === 'outside') bad('-> points outside the repository');
  else bad(`-> ${shown} differs in letter case from ${state.slice(5)} (breaks on GitHub Pages)`);
}

function scanFile(abs) {
  const raw = readFileSync(abs, 'utf8');
  const ext = abs.slice(abs.lastIndexOf('.'));
  let refs;
  let text = raw;
  if (ext === '.css') { text = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')); refs = cssRefs(text); }
  else if (ext === '.html') refs = htmlRefs(raw);
  else { text = stripJsComments(raw); refs = jsRefs(text); }
  for (const ref of refs) check(abs, ext === '.html' ? raw : text, ref);
}

// ---- service worker, manifest -----------------------------------------------------------------

function checkServiceWorker(files) {
  const swPath = join(ROOT, 'sw.js');
  if (!existsSync(swPath)) { errors.push('sw.js does not exist'); return; }
  const sw = readFileSync(swPath, 'utf8');
  const block = /\/\/ BEGIN PRECACHE\r?\n([\s\S]*?)\/\/ END PRECACHE/.exec(sw);
  if (!block) { errors.push('sw.js: BEGIN/END PRECACHE markers not found'); return; }
  const entries = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const listed = new Set();
  for (const entry of entries) {
    const [p, query = ''] = entry.split('?');
    const target = p === './' ? join(ROOT, 'index.html') : resolve(ROOT, p);
    listed.add(rel(target));
    const state = probe(target);
    if (state !== 'ok') errors.push(`sw.js  PRECACHE '${entry}'  -> ${rel(target)} (${state})`);
    if (NEEDS_STAMP.test(p)) {
      const stamp = /(?:^|&)v=(\d+)$/.exec(query);
      if (!stamp) errors.push(`sw.js  PRECACHE '${entry}'  has no ?v=<digits> stamp (cache key would never match)`);
      else { if (!stamps.has(stamp[1])) stamps.set(stamp[1], []); stamps.get(stamp[1]).push(`sw.js PRECACHE ${entry}`); }
    }
  }
  const version = /^const VERSION = '([^']*)'/m.exec(sw)?.[1];
  if (version === undefined) errors.push('sw.js: const VERSION line not found');
  else {
    if (!stamps.has(version) && stamps.size) {
      (SAME_STAMP ? errors : warnings).push(`sw.js  VERSION '${version}' is not the stamp used by the sources (run tools/bump-version.sh)`);
    }
  }
  const unlisted = files.map(rel).filter((f) => /\.(?:js|css)$/.test(f) && !listed.has(f));
  if (unlisted.length) {
    warnings.push(`sw.js  ${unlisted.length} file(s) not in PRECACHE, so not available offline until bump-version.sh runs: ${unlisted.slice(0, 5).join(', ')}${unlisted.length > 5 ? ', ...' : ''}`);
  }
}

function checkManifest() {
  const path = join(ROOT, 'manifest.webmanifest');
  if (!existsSync(path)) { warnings.push('manifest.webmanifest does not exist'); return; }
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { errors.push(`manifest.webmanifest  invalid JSON: ${e.message}`); return; }
  for (const icon of manifest.icons ?? []) {
    refCount++;
    const state = probe(resolve(ROOT, icon.src));
    if (state !== 'ok') errors.push(`manifest.webmanifest  icon '${icon.src}'  (${state})`);
  }
}

// ---- main -------------------------------------------------------------------------------------

const sources = [
  ...walk(join(ROOT, 'js'), ['.js', '.mjs', '.css', '.html']),
  ...walk(join(ROOT, 'css'), ['.css']),
];
const pages = ['index.html', 'sw.js'].map((f) => join(ROOT, f)).filter(existsSync);
for (const f of [...pages, ...sources]) scanFile(f);
checkServiceWorker(sources);
checkManifest();

if (stamps.size > 1) {
  const detail = [...stamps].map(([s, w]) => `${s} (${w.length}x)`).join(', ');
  (SAME_STAMP ? errors : warnings).push(`mixed ?v= stamps: ${detail}. Run tools/bump-version.sh to unify them.`);
}

const uniqueErrors = [...new Set(errors)];
const uniqueWarnings = [...new Set(warnings)];
for (const e of uniqueErrors) console.error(`ERROR  ${e}`);
for (const w of uniqueWarnings) console.warn(`WARN   ${w}`);
console.log(`check-imports: ${pages.length + sources.length} files, ${refCount} references, ${stamps.size} stamp(s): ${uniqueErrors.length} error(s), ${uniqueWarnings.length} warning(s)`);
process.exit(uniqueErrors.length ? 1 : 0);
