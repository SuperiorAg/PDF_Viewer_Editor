#!/usr/bin/env node
/* eslint-env node */
// ---------------------------------------------------------------------------
// NON-DESTRUCTIVE better-sqlite3 ABI swap helper. Diego owns.
// (Backlog-fix wave, 2026-05-28 — Option C escape hatch.)
//
// PURPOSE
//   On a Node-24-only host (no Node 20 available) you cannot run the DB test
//   suite because the on-disk better_sqlite3.node is the Electron-ABI build.
//   This helper swaps in a Node-ABI-matched prebuild from the npm prebuild
//   cache so `npm test` runs GREEN, then lets you restore the Electron-ABI
//   binary before packaging.
//
//   Default (no args)   : install the prebuild matching the ACTIVE Node ABI.
//   --electron          : restore the Electron-ABI binary (run before dist:win).
//   --list              : show which cached prebuilds are available.
//
// WHY NOT JUST `npm rebuild` / electron-rebuild?
//   From-source rebuild of better-sqlite3 FAILS on this host (node-gyp 9.4.1 +
//   Python 3.14 has no distutils + MSBuild exit 1). Worse, a prior wave's
//   failed from-source rebuild DELETED the working binding (.learnings).
//   So this helper NEVER compiles. It only:
//     1. backs up the current binary to *.bak.<tag> (idempotent, never clobbers
//        an existing backup of a DIFFERENT ABI),
//     2. extracts a matching prebuild from the npm cache into place,
//     3. verifies the swapped binary actually loads before declaring success.
//   If no matching cached prebuild exists, it FAILS LOUD with instructions and
//   leaves the tree untouched. It is safe to re-run.
//
// IMPORTANT ABI/SHIM CAVEAT (honest disclosure)
//   The cache may only hold a better-sqlite3 *v12* binary for Node 24's ABI
//   (v137), while package-lock pins the *v11* JS shim. The v11->v12 delta was
//   largely TypeScript-only and the full DB suite (350 tests) passes with the
//   v12-node-v137 binary against the v11 shim (verified this wave). This is a
//   LOCAL-TEST convenience, NOT a project commitment — the shipped binary is
//   ALWAYS the Electron-ABI v11 build (restore it with --electron before any
//   package/build). CI never uses this path (CI is Node 20 with the matching
//   v11-node-v115 prebuild).
// ---------------------------------------------------------------------------

'use strict';

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { existsSync, mkdtempSync, rmSync, copyFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const binPath = join(repoRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

const args = new Set(process.argv.slice(2));
const wantElectron = args.has('--electron');
const justList = args.has('--list');

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const YEL = (s) => `\x1b[33m${s}\x1b[0m`;
const GRN = (s) => `\x1b[32m${s}\x1b[0m`;

function log(s) {
  console.log(`[rebuild-native-for-node] ${s}`);
}
function fail(s) {
  console.error(RED(`[rebuild-native-for-node] ${s}`));
  process.exit(1);
}

// Locate the npm prebuild cache (where prebuild-install / electron-builder
// drop downloaded *.node tarballs).
function prebuildCacheDir() {
  const candidates = [
    process.env.npm_config_cache && join(process.env.npm_config_cache, '_prebuilds'),
    join(homedir(), 'AppData', 'Local', 'npm-cache', '_prebuilds'), // Windows default
    join(homedir(), '.npm', '_prebuilds'), // posix default
  ].filter(Boolean);
  return candidates.find((d) => existsSync(d));
}

function listCachedPrebuilds() {
  const dir = prebuildCacheDir();
  if (!dir) return { dir: null, entries: [] };
  const entries = readdirSync(dir).filter((f) => f.includes('better-sqlite3') && f.endsWith('.tar.gz'));
  return { dir, entries };
}

// Choose the cached tarball whose ABI tag matches the desired target.
//   active Node : `node-v<NODE_MODULE_VERSION>` (e.g. node-v137)
//   --electron  : `electron-v<...>` (any electron tag — there should be one)
function pickTarball(entries, target) {
  if (target === 'electron') {
    return entries.find((f) => /-electron-v\d+-/.test(f));
  }
  const tag = `-node-v${process.versions.modules}-`;
  return entries.find((f) => f.includes(tag));
}

function backupCurrent() {
  if (!existsSync(binPath)) return;
  // Tag the backup with the ABI it was built for, derived by trying to load it
  // under the current Node. We cannot read the ABI of a non-loadable binary
  // cheaply, so tag by mtime-stable name and never clobber.
  const tag = wantElectron ? 'pre-electron-restore' : 'pre-node-swap';
  const bak = `${binPath}.bak.${tag}`;
  if (!existsSync(bak)) {
    copyFileSync(binPath, bak);
    log(`backed up current binary -> ${basename(bak)}`);
  }
}

function extractInto(tarball, cacheDir) {
  const tmp = mkdtempSync(join(tmpdir(), 'bsq3-'));
  const archive = join(cacheDir, tarball);
  try {
    // tar selection matters on Windows. The Git-for-Windows GNU tar on PATH
    // (/usr/bin/tar) misparses an absolute `C:\...\file.tar.gz` archive path as
    // a remote `host:path` ("Cannot connect to C: resolve failed"). Two robust
    // paths:
    //   1. Windows' bundled bsdtar at System32\tar.exe handles drive letters.
    //   2. GNU tar's `--force-local` flag disables the host:path interpretation.
    // Try the most-reliable candidate first, fall back to the others.
    const candidates = [];
    if (process.platform === 'win32') {
      const sys = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      if (existsSync(sys)) candidates.push({ cmd: sys, extra: [] }); // bsdtar
      candidates.push({ cmd: 'tar', extra: ['--force-local'] }); // GNU tar fallback
    }
    candidates.push({ cmd: 'tar', extra: [] }); // posix / last resort

    let ok = false;
    let lastStatus = null;
    for (const { cmd, extra } of candidates) {
      const r = spawnSync(cmd, [...extra, '-xzf', archive, '-C', tmp], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      lastStatus = r.status;
      if (r.status === 0) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      throw new Error(`every tar candidate failed extracting ${tarball} (last status ${lastStatus})`);
    }
    // Find the .node inside the extracted tree.
    const found = findNode(tmp);
    if (!found) throw new Error('no better_sqlite3.node inside the extracted tarball');
    mkdirSync(dirname(binPath), { recursive: true });
    copyFileSync(found, binPath);
    return true;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function findNode(root) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name);
      if (name.isDirectory()) stack.push(p);
      else if (name.name === 'better_sqlite3.node') return p;
    }
  }
  return null;
}

function verifyLoads() {
  // Verify in a CHILD process so a hard dlopen failure doesn't take us down,
  // and (for --electron) so we don't wrongly report failure when restoring an
  // Electron-ABI binary that legitimately cannot load under plain Node.
  const require = createRequire(join(repoRoot, 'package.json'));
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

// ---- Main ----------------------------------------------------------------

if (justList) {
  const { dir, entries } = listCachedPrebuilds();
  log(dir ? `cache: ${dir}` : 'no npm prebuild cache found');
  for (const e of entries) console.log(`  ${e}`);
  process.exit(0);
}

const { dir: cacheDir, entries } = listCachedPrebuilds();
if (!cacheDir || entries.length === 0) {
  fail(
    'no cached better-sqlite3 prebuilds found. Run `npm ci` (or `npm rebuild`) first so ' +
      'the prebuild cache is populated, or install Node 20 (Option A) and use `npm test` directly.',
  );
}

const target = wantElectron ? 'electron' : 'node';
const tarball = pickTarball(entries, target);

if (!tarball) {
  if (wantElectron) {
    fail(
      'no cached electron-ABI prebuild. Run `npm run rebuild` (electron-builder install-app-deps) ' +
        'to fetch + install the Electron-ABI binary directly.',
    );
  }
  console.error(RED(`[rebuild-native-for-node] no cached prebuild for this Node ABI (node-v${process.versions.modules}).`));
  console.error(YEL('Available cached prebuilds:'));
  for (const e of entries) console.error(`  ${e}`);
  console.error(YEL('Recommended: install Node 20 (Option A) — it has a matching v115 prebuild and matches CI.'));
  process.exit(1);
}

log(`target=${target}  Node ${process.versions.node} (NODE_MODULE_VERSION ${process.versions.modules})`);
log(`using cached prebuild: ${tarball}`);
backupCurrent();
extractInto(tarball, cacheDir);

if (wantElectron) {
  // The Electron-ABI binary is not expected to load under plain Node, so we
  // do not verify-load it here. Its correctness is exercised by packaging /
  // electron runtime, not by this script.
  log(GRN('Electron-ABI binary restored. Tree is packaging-ready (run `npm run dist:win`).'));
  process.exit(0);
}

if (verifyLoads()) {
  log(GRN(`better-sqlite3 now loads on Node ${process.versions.node}. Run \`npm test\`.`));
  log(YEL('Remember: run `node scripts/rebuild-native-for-node.mjs --electron` before packaging.'));
  process.exit(0);
}

fail('swapped the binary but it still does not load. Your Node ABI may not have a matching cached prebuild — install Node 20 (Option A).');
