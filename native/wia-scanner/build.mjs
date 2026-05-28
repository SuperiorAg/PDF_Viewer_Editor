#!/usr/bin/env node
/* eslint-env node */
// ---------------------------------------------------------------------------
// WIA scanner addon build helper. David owns (lives under native/wia-scanner/,
// which is David's domain). Diego wraps this from a package.json script + the
// electron-rebuild flow in Wave 5.2 (see native/wia-scanner/README.md §Diego).
//
// WHY A DEDICATED SCRIPT (not just `node-gyp rebuild`)?
//   1. Python selection. The project-local node-gyp (9.4.1) bundles an OLD gyp
//      that `import distutils.version` — DEAD on Python >=3.12 (distutils was
//      removed in 3.12, NOT just 3.14 as the better-sqlite3 lore implied). We
//      therefore invoke node-gyp@latest (>=10, no distutils dep) via npx, AND
//      pin --python to a 3.12 interpreter via the `py` launcher when present.
//   2. ABI target. Local `npm test` needs the Node ABI; packaging needs the
//      Electron ABI. `--electron` rebuilds against the installed Electron's
//      headers (mirrors better-sqlite3's two-ABI dance, L-003).
//   3. Windows-only reality. On non-Windows the binding.gyp compiles the stub
//      so this still succeeds (the JS loader degrades to scanner_unavailable).
//
// USAGE
//   node native/wia-scanner/build.mjs              # Node ABI (for `npm test`)
//   node native/wia-scanner/build.mjs --electron   # Electron ABI (for packaging)
//   node native/wia-scanner/build.mjs --verify     # build (Node ABI) + load + listDevices
// ---------------------------------------------------------------------------

'use strict';

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const args = new Set(process.argv.slice(2));
const wantElectron = args.has('--electron');
const wantVerify = args.has('--verify');

function log(s) {
  console.log(`[build-wia-addon] ${s}`);
}

// Find a Python <3.12 if available (distutils-free gyp doesn't strictly need
// it, but some MSVC toolchains are happier; 3.12 is fine for node-gyp@latest).
// Prefer the `py` launcher's 3.12, then PATH python.
function resolvePython() {
  if (process.platform !== 'win32') return null;
  const probe = spawnSync('py', ['-3.12', '-c', 'import sys;print(sys.executable)'], {
    encoding: 'utf8',
  });
  if (probe.status === 0 && probe.stdout) {
    const p = probe.stdout.trim();
    if (existsSync(p)) return p;
  }
  return null; // let node-gyp auto-detect
}

function runNodeGyp(extraArgs) {
  const python = resolvePython();
  const useShell = process.platform === 'win32'; // npx is a .cmd shim on Windows
  // When shell:true, spawnSync concatenates argv with spaces and the shell
  // re-splits — so any arg containing a space (e.g. "C:\Program Files\...")
  // MUST be quoted by us. node's automatic quoting only applies when shell:false.
  const quote = (a) => (useShell && /\s/.test(a) ? `"${a}"` : a);
  const rawArgs = ['-y', 'node-gyp@latest', 'rebuild', ...extraArgs];
  if (python) rawArgs.push('--python', python);
  const gypArgs = rawArgs.map(quote);
  log(`npx ${gypArgs.join(' ')}`);
  const r = spawnSync('npx', gypArgs, {
    cwd: here,
    stdio: 'inherit',
    shell: useShell,
  });
  return r.status === 0;
}

function electronVersion() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = join(repoRoot, 'node_modules', 'electron', 'package.json');
    if (existsSync(pkg)) {
      return JSON.parse(spawnSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(pkg)}).version)`], { encoding: 'utf8' }).stdout);
    }
  } catch {
    /* fall through */
  }
  return null;
}

const extra = [];
if (wantElectron) {
  const ev = electronVersion();
  if (!ev) {
    console.error('[build-wia-addon] electron not installed; cannot target Electron ABI.');
    process.exit(1);
  }
  extra.push(`--target=${ev}`, '--dist-url=https://electronjs.org/headers', '--arch=x64');
  log(`targeting Electron ABI (electron ${ev})`);
} else {
  log(`targeting Node ABI (node ${process.versions.node}, NODE_MODULE_VERSION ${process.versions.modules})`);
}

if (!runNodeGyp(extra)) {
  console.error('[build-wia-addon] node-gyp build FAILED. See README.md §Toolchain for prerequisites.');
  process.exit(1);
}

const artifact = join(here, 'build', 'Release', 'wia_scanner.node');
if (!existsSync(artifact)) {
  console.error(`[build-wia-addon] build reported OK but artifact missing: ${artifact}`);
  process.exit(1);
}
log(`OK -> ${artifact}`);

if (wantVerify && !wantElectron && process.platform === 'win32') {
  log('verify: loading addon + calling listDevices()...');
  const verify = spawnSync(
    process.execPath,
    [
      '-e',
      `const a=require(${JSON.stringify(artifact)});a.listDevices().then(r=>{console.log('[build-wia-addon] listDevices ->',JSON.stringify(r));process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})`,
    ],
    { stdio: 'inherit' },
  );
  process.exit(verify.status ?? 1);
}
