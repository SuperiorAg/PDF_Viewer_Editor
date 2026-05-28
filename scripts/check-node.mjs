#!/usr/bin/env node
/* eslint-env node */
// ---------------------------------------------------------------------------
// Node-version + native-ABI guard. Diego owns. (Backlog-fix wave, 2026-05-28)
//
// WHY THIS EXISTS
//   The dev host on this machine runs Node 24 (NODE_MODULE_VERSION 137).
//   `better-sqlite3@11.10.0` publishes Node-ABI prebuilds only up to Node 22
//   (v131) plus the Electron ABI (v123, installed by the `postinstall`
//   `electron-builder install-app-deps`). So `npx vitest run src/db` under
//   Node 24 cannot dlopen the binary -> ~350 DB-dependent tests fail locally
//   with ERR_DLOPEN_FAILED / NODE_MODULE_VERSION mismatch.
//
//   CI is the test-of-record and runs on **Node 20** (matches `.nvmrc` +
//   `engines.node`), where a Node-ABI prebuild exists AND the Electron ABI
//   matches, so CI is green. This guard makes the local-vs-CI skew LOUD and
//   actionable instead of a silent "355 tests failed" mystery that has bitten
//   every DB-touching wave (13, 21, 24, 25, 28a, 30).
//
//   This is OPTION A from the backlog brief: enforce/standardize on Node 20
//   locally (matches CI), with a clear guard. The recovery messaging below
//   also documents OPTION C (the cache-prebuild escape hatch) for hosts that
//   genuinely cannot install Node 20.
//
// WHAT THIS DOES NOT DO (deliberately)
//   It NEVER triggers a from-source rebuild of better-sqlite3. On Node 24 the
//   from-source path FAILS (node-gyp 9.4.1 + Python 3.14 dropped distutils +
//   MSBuild exit 1) AND a prior wave's failed rebuild DELETED the working
//   Electron-ABI binding. So the guard only DIAGNOSES + INSTRUCTS; it never
//   mutates node_modules. See `scripts/rebuild-native-for-node.mjs` for the
//   opt-in, non-destructive escape hatch a developer can run by hand.
//
// EXIT CODES
//   0  -> Node major is the supported one (20), OR --warn-only and the user
//         accepted the risk. (pretest uses strict mode -> non-20 is a hard
//         stop only when the DB binding also fails; otherwise a loud warning.)
//   1  -> Hard stop: the active Node cannot load better-sqlite3 AND we are in
//         a test context (the suite would fail ~350 tests with a cryptic error).
// ---------------------------------------------------------------------------

'use strict';

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SUPPORTED_MAJOR = 20; // matches .nvmrc + engines.node + CI matrix
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

// Parse args. `--strict` (used by pretest) escalates a failed DB binding into
// a hard exit so the suite does not run and emit 350 confusing failures.
const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');

const nodeMajor = Number(process.versions.node.split('.')[0]);
const moduleVersion = process.versions.modules; // NODE_MODULE_VERSION

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const YEL = (s) => `\x1b[33m${s}\x1b[0m`;
const GRN = (s) => `\x1b[32m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

function probeBetterSqlite3() {
  // Returns { ok: true } if the native binding loads on THIS Node, else
  // { ok: false, code, message }. Never throws.
  try {
    const require = createRequire(join(repoRoot, 'package.json'));
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code,
      message: (err && err.message ? String(err.message) : String(err)).split('\n')[0],
    };
  }
}

function printRecovery() {
  const sep = '-'.repeat(74);
  console.error(sep);
  console.error(BOLD('  HOW TO RUN THE FULL TEST SUITE GREEN ON THIS MACHINE'));
  console.error(sep);
  console.error('');
  console.error(BOLD('  Option A (recommended) — use Node 20, which matches CI:'));
  console.error('    1. Install Node 20 LTS (nvm-windows / fnm / volta, or the .msi).');
  console.error('         nvm install 20 && nvm use 20      (nvm-windows)');
  console.error('         fnm install 20 && fnm use 20      (fnm)');
  console.error('    2. npm ci');
  console.error('    3. npm test            -> full suite GREEN (db tests load the');
  console.error('                              Node-20 / v115 prebuild).');
  console.error('');
  console.error(BOLD('  Option C (escape hatch) — stay on Node 24, swap the DB binding:'));
  console.error('    node scripts/rebuild-native-for-node.mjs');
  console.error('       -> drops a Node-ABI-matched better_sqlite3.node into place from');
  console.error('          the npm prebuild cache (NON-destructive: backs up + restores).');
  console.error('    npm test               -> full suite GREEN under Node 24.');
  console.error('    node scripts/rebuild-native-for-node.mjs --electron');
  console.error('       -> restores the Electron-ABI binary afterwards (needed before');
  console.error('          `npm run dist:win` / packaging).');
  console.error('');
  console.error('  CI is the test-of-record: it runs on Node 20 and is GREEN. This');
  console.error('  guard exists only because local dev on Node 24 hits the documented');
  console.error('  better-sqlite3 ABI skew. Full background:');
  console.error('    .learnings/failures/2026-05-27-vitest-node24-discovery-regression.md');
  console.error(sep);
}

// ---- Main ----------------------------------------------------------------

if (nodeMajor === SUPPORTED_MAJOR) {
  // The happy path. Confirm the binding loads (it should: v115 prebuild).
  const probe = probeBetterSqlite3();
  if (probe.ok) {
    console.log(GRN(`[check-node] Node ${process.versions.node} (NODE_MODULE_VERSION ${moduleVersion}) — supported; better-sqlite3 loads. OK.`));
    process.exit(0);
  }
  // On Node 20 but binding is the Electron-ABI binary (e.g. right after a
  // `dist:win`). Tell the dev to re-fetch the Node prebuild.
  console.warn(YEL(`[check-node] Node ${process.versions.node} is supported, but better-sqlite3 failed to load (${probe.code || probe.message}).`));
  console.warn(YEL('[check-node] The on-disk binary is probably the Electron-ABI build (after packaging). Run: npm run rebuild:node'));
  process.exit(strict ? 1 : 0);
}

// Not on Node 20.
console.warn('');
console.warn(YEL(BOLD(`[check-node] WARNING: this project targets Node ${SUPPORTED_MAJOR} (see .nvmrc + engines.node + CI).`)));
console.warn(YEL(`[check-node] You are on Node ${process.versions.node} (NODE_MODULE_VERSION ${moduleVersion}).`));

const probe = probeBetterSqlite3();
if (probe.ok) {
  // Some non-20 Node where the binding happens to load (e.g. a host that ran
  // the escape hatch). Warn but allow.
  console.warn(YEL('[check-node] better-sqlite3 currently loads on this Node — tests can run, but you are off the CI baseline.'));
  console.warn('');
  process.exit(0);
}

// The headline failure mode: off-20 AND the DB binding will not load.
console.error('');
console.error(RED(BOLD('[check-node] better-sqlite3 will NOT load on this Node — the DB test suite (~350 tests) WOULD fail with ERR_DLOPEN_FAILED.')));
console.error(RED(`[check-node] Cause: ${probe.code || probe.message}`));
console.error('');
printRecovery();

// In strict (pretest) mode, stop before vitest emits a wall of cryptic
// failures. Otherwise (e.g. a bare `node scripts/check-node.mjs` diagnostic),
// exit non-zero so callers can detect, but the message is the deliverable.
process.exit(1);
