// ============================================================
// tests/run.mjs — run every tests/*.test.mjs (Node 18+, no deps).
//   node tests/run.mjs            all tests
//   node tests/run.mjs spyfall    only files whose name contains "spyfall"
// ============================================================

import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { TESTS } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs') && f.includes(filter)).sort();

for (const f of files) await import(pathToFileURL(join(here, f)).href);

let pass = 0;
let fail = 0;
for (const t of TESTS) {
  const t0 = performance.now();
  try {
    await t.fn();
    pass++;
    console.log(`  ok   ${t.name}  (${Math.round(performance.now() - t0)} ms)`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${t.name}\n${String(e && e.stack || e).split('\n').map((l) => '       ' + l).join('\n')}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed, ${files.length} files`);
process.exit(fail ? 1 : 0);
