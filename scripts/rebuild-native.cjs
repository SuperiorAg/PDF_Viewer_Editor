#!/usr/bin/env node
/* eslint-env node */
// Rebuild native modules (better-sqlite3) against Electron 30's Node ABI.
//
// Why this exists:
//   - npm install ships prebuilds for Node's stable ABI.
//   - Electron 30 bundles a different Node version with its own ABI.
//   - Loading the Node-ABI binary into Electron throws ERR_DLOPEN_FAILED.
//   - Either `electron-builder install-app-deps` OR `electron-rebuild`
//     produces the Electron-ABI binary. We prefer the former because
//     electron-builder is already a dep and it handles all native deps
//     transitively.
//
// Usage:
//   node scripts/rebuild-native.cjs
//
// Idempotent: runs are cheap-no-op if the binary is already correct.

'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const cwd = process.cwd();
const nodeModulesBin = join(cwd, 'node_modules', '.bin');

function tryRun(cmd, args, label) {
  console.log(`[rebuild-native] ${label}: ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return r.status === 0;
}

// Prefer electron-builder's native-dep rebuilder. Fall back to electron-rebuild.
const ebBin = join(nodeModulesBin, process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const erBin = join(nodeModulesBin, process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild');

let ok = false;
if (existsSync(ebBin)) {
  ok = tryRun(ebBin, ['install-app-deps'], 'electron-builder install-app-deps');
}
if (!ok && existsSync(erBin)) {
  ok = tryRun(erBin, ['-f', '-w', 'better-sqlite3'], 'electron-rebuild -f -w better-sqlite3');
}

if (!ok) {
  console.error('[rebuild-native] FAILED — neither electron-builder nor electron-rebuild produced a clean rebuild.');
  console.error('[rebuild-native] On Windows, ensure Visual Studio Build Tools with "Desktop development with C++" workload is installed.');
  process.exit(1);
}

console.log('[rebuild-native] OK');
