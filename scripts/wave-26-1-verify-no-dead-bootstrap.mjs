// Phase 6.1 v0.6.1 (Diego) — verify the dead `emitExportBootstrapCjs` plugin
// removal. After David converted `src/main/index.ts`'s runtime
// `require('./export/export-bootstrap.js')` to a top-level static import, Vite
// bundles the bootstrap INLINE into dist/main/index.js. This script asserts:
//
//   1. dist/main/index.js INLINES the bootstrap — it references
//      `createProdPdfJsSource` and/or `bootstrapExportEngine` directly.
//   2. dist/main/index.js has ZERO dangling
//      `require('./export/export-bootstrap.js')` (the old runtime-require site).
//   3. The standalone CJS sibling `dist/main/export/export-bootstrap.js` is NOT
//      emitted (the plugin that produced it is gone). A residual sibling means
//      the plugin removal didn't take.
//
// Run after `npm run build`:
//   node scripts/wave-26-1-verify-no-dead-bootstrap.mjs

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const INDEX = join(ROOT, 'dist', 'main', 'index.js');
const DEAD_SIBLING = join(ROOT, 'dist', 'main', 'export', 'export-bootstrap.js');
const DEAD_SIBLING_PKG = join(ROOT, 'dist', 'main', 'export', 'package.json');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

if (!existsSync(INDEX)) {
  console.error('FAIL: dist/main/index.js missing — run `npm run build` first.');
  process.exit(1);
}

const src = readFileSync(INDEX, 'utf8');

// 1. Bootstrap inlined.
const inlinedRefs = (src.match(/createProdPdfJsSource|bootstrapExportEngine/g) ?? []).length;
check(
  'bootstrap inlined into dist/main/index.js',
  inlinedRefs > 0,
  `${inlinedRefs} ref(s) to createProdPdfJsSource/bootstrapExportEngine`,
);

// 2. No dangling runtime require of the old sibling path.
const danglingRequire = /require\(\s*['"]\.\/export\/export-bootstrap\.js['"]\s*\)/.test(src);
check(
  'no dangling require("./export/export-bootstrap.js")',
  !danglingRequire,
  danglingRequire ? 'FOUND a runtime require — David did not convert the call site' : 'clean',
);

// 3. Dead CJS sibling not emitted (the plugin is gone).
check(
  'dead CJS sibling dist/main/export/export-bootstrap.js NOT emitted',
  !existsSync(DEAD_SIBLING),
  existsSync(DEAD_SIBLING) ? 'sibling STILL present — plugin not fully removed' : 'absent',
);
check(
  'dead sibling package.json dist/main/export/package.json NOT emitted',
  !existsSync(DEAD_SIBLING_PKG),
  existsSync(DEAD_SIBLING_PKG) ? 'sibling pkg STILL present' : 'absent',
);

console.log('');
if (failures > 0) {
  console.error(`RESULT: ${failures} check(s) FAILED.`);
  process.exit(2);
}
console.log('RESULT: all checks PASS — plugin removal verified, bootstrap inlined.');
