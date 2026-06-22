#!/usr/bin/env node
// scripts/fetch-qpdf-binaries.mjs — Phase 7.5 Wave 11 (Diego).
//
// Downloads the per-OS qpdf binary from the upstream GitHub release pinned in
// scripts/qpdf-version.json, verifies SHA256 against the manifest, and lays
// the binary + supporting files out under vendor/qpdf/<platform>/ in the
// shape electron-builder's extraResources block expects.
//
// Usage:
//   node scripts/fetch-qpdf-binaries.mjs                 # current host platform
//   node scripts/fetch-qpdf-binaries.mjs --all           # every platform with a pinned URL
//   node scripts/fetch-qpdf-binaries.mjs --platform=linux-x64
//   node scripts/fetch-qpdf-binaries.mjs --check         # verify already-present binaries
//
// Idempotent — re-running on an already-vendored, sha-matching tree is a fast
// no-op. Refuses to overwrite a SHA mismatch (treats it as tampering).
//
// License notes:
//   qpdf is Apache-2.0 (LICENSE: https://github.com/qpdf/qpdf/blob/v11.9.1/LICENSE.txt).
//   This script downloads the upstream prebuilt binary and lays it out in the
//   vendor tree; the LICENSE file is mirrored into vendor/qpdf/<platform>/
//   alongside the binary so the redistributable obligation (Apache-2.0 §4) is
//   met in the packaged installer.
//
// macOS note:
//   Upstream qpdf publishes no macOS prebuilt binary. On darwin-x64 / darwin-
//   arm64 the manifest's url is null, this script logs that fact and exits 0
//   without writing anything. Runtime falls back to system PATH (typically
//   populated by `brew install qpdf`); if absent, the engine returns
//   engine_unavailable. Documented in scripts/qpdf-version.json _layoutNotes.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join as joinPath, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const MANIFEST_PATH = joinPath(__dirname, 'qpdf-version.json');
const VENDOR_ROOT = joinPath(REPO_ROOT, 'vendor', 'qpdf');
const CACHE_ROOT = joinPath(REPO_ROOT, 'node_modules', '.cache', 'qpdf-downloads');

const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_RESET = '\x1b[0m';

function log(msg) {
  process.stdout.write(`[fetch-qpdf] ${msg}\n`);
}
function logOk(msg) {
  log(`${ANSI_GREEN}OK${ANSI_RESET} ${msg}`);
}
function logWarn(msg) {
  log(`${ANSI_YELLOW}WARN${ANSI_RESET} ${msg}`);
}
function logErr(msg) {
  process.stderr.write(`[fetch-qpdf] ${ANSI_RED}ERR${ANSI_RESET} ${msg}\n`);
}
function logInfo(msg) {
  log(`${ANSI_CYAN}INFO${ANSI_RESET} ${msg}`);
}

function currentPlatformKey() {
  // electron-builder uses the same `${process.platform}-${process.arch}` convention.
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32' && a === 'x64') return 'win32-x64';
  if (p === 'linux' && a === 'x64') return 'linux-x64';
  if (p === 'darwin' && a === 'x64') return 'darwin-x64';
  if (p === 'darwin' && a === 'arm64') return 'darwin-arm64';
  return `${p}-${a}`;
}

function parseArgs(argv) {
  const args = { mode: 'platform', target: null, all: false, check: false };
  for (const a of argv.slice(2)) {
    if (a === '--all') {
      args.all = true;
      args.mode = 'all';
    } else if (a === '--check') {
      args.check = true;
      args.mode = 'check';
    } else if (a.startsWith('--platform=')) {
      args.target = a.slice('--platform='.length);
    } else if (a === '--help' || a === '-h') {
      args.mode = 'help';
    } else {
      logWarn(`unrecognized arg: ${a}`);
    }
  }
  return args;
}

async function loadManifest() {
  const raw = await readFile(MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw);
  return manifest;
}

async function fileSha256(path) {
  const hash = createHash('sha256');
  const fd = await import('node:fs').then((m) => m.createReadStream(path));
  await new Promise((res, rej) => {
    fd.on('data', (c) => hash.update(c));
    fd.on('end', res);
    fd.on('error', rej);
  });
  return hash.digest('hex');
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  // Use built-in fetch (Node 20+). Follow redirects automatically.
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const writer = createWriteStream(dest);
  await pipeline(res.body, writer);
}

async function ensureUnzip() {
  // We shell out to a real unzip implementation — Node has no built-in zip.
  // On Windows, PowerShell's Expand-Archive is built in. On Linux/macOS,
  // `unzip` is universally available. We don't depend on a npm package
  // because this script must run in CI before `npm ci` completes
  // (postinstall ordering — qpdf vendoring runs out-of-band).
  return process.platform === 'win32' ? 'powershell' : 'unzip';
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', rej);
    child.on('close', (code) => {
      if (code === 0) res({ stdout, stderr });
      else rej(new Error(`${cmd} exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function unzipArchive(archivePath, destDir) {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  const tool = await ensureUnzip();
  if (tool === 'powershell') {
    await runCmd('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destDir}' -Force`,
    ]);
  } else {
    await runCmd('unzip', ['-q', '-o', archivePath, '-d', destDir]);
  }
}

async function copyVendorLayout(extractDir, platformKey, binSpec, manifest) {
  const platDir = joinPath(VENDOR_ROOT, platformKey);
  // Wipe + recreate the platform tree so a re-run gives a deterministic layout.
  await rm(platDir, { recursive: true, force: true });
  await mkdir(joinPath(platDir, 'bin'), { recursive: true });
  if (platformKey.startsWith('linux')) {
    await mkdir(joinPath(platDir, 'lib'), { recursive: true });
  }

  // Copy binary + supporting files. We preserve the bin/<file> + lib/<file>
  // split for linux (RUNPATH dependency) and flatten Windows into bin/.
  const allFiles = [binSpec.binaryPathInArchive, ...binSpec.supportingFiles];
  for (const archivePath of allFiles) {
    const src = joinPath(extractDir, archivePath);
    // Output path strategy:
    //   - Windows: every file lands in <platDir>/bin/<basename>
    //   - Linux: preserve bin/ vs lib/ split — archive uses bin/<file>
    //     and lib/<file> already, so strip nothing.
    let dest;
    if (platformKey === 'win32-x64') {
      dest = joinPath(platDir, 'bin', archivePath.split('/').pop());
    } else {
      // Linux archive is FLAT (no archiveRoot), so archivePath is already
      // 'bin/qpdf' or 'lib/libqpdf.so.29.9.1'.
      dest = joinPath(platDir, archivePath);
    }
    await mkdir(dirname(dest), { recursive: true });
    if (await pathExists(src)) {
      // Linux symlink: libqpdf.so.29 -> libqpdf.so.29.9.1. The unzip step on
      // most tools preserves it as a real file containing the link target name
      // (17 bytes — see the layout dump). Recreate as a real symlink on
      // linux/darwin extraction; on Windows we leave it as the unzipped file
      // (Windows doesn't ship qpdf at all from this branch).
      const srcStat = await stat(src);
      if (srcStat.isSymbolicLink() && process.platform !== 'win32') {
        const target = (await readFile(src, 'utf8')).trim();
        await symlink(target, dest);
      } else {
        await copyFile(src, dest);
      }
    } else {
      logWarn(`expected file not found in extract: ${archivePath}`);
    }
  }

  // Mirror upstream LICENSE.txt into the vendor tree (Apache-2.0 §4
  // redistribution obligation). The qpdf binary archives do NOT ship the
  // LICENSE file (only manuals + examples under share/doc/qpdf/) — confirmed
  // by manual extract of qpdf-11.9.1-msvc64.zip + qpdf-11.9.1-bin-linux-
  // x86_64.zip on 2026-06-18. The LICENSE.txt lives in the source tarball
  // only (qpdf-11.9.1/LICENSE.txt). So we either (a) ship the canonical
  // copy that already lives in the repo at scripts/qpdf-LICENSE.txt (the
  // source-of-truth we committed in Wave 11) and copy it into the per-
  // platform vendor tree, or (b) write the same pointer note we used
  // pre-fix. Strategy (a) is the honest one — operators verify the copy
  // matches upstream by SHA in CI.
  const canonicalLicensePath = joinPath(REPO_ROOT, 'scripts', 'qpdf-LICENSE.txt');
  if (await pathExists(canonicalLicensePath)) {
    await copyFile(canonicalLicensePath, joinPath(platDir, 'LICENSE.txt'));
    logOk(`${platformKey}: copied canonical Apache-2.0 LICENSE from scripts/qpdf-LICENSE.txt`);
  } else {
    // Pre-fix fallback — kept for the bootstrap case when running the
    // script for the very first time on a clean checkout.
    await writeFile(
      joinPath(platDir, 'LICENSE.txt.pointer'),
      `This qpdf binary is Apache-2.0 licensed.\nUpstream LICENSE: https://github.com/qpdf/qpdf/blob/v${manifest?.qpdfVersion ?? '11.9.1'}/LICENSE.txt\nFetch a copy by running: curl -sL https://raw.githubusercontent.com/qpdf/qpdf/v${manifest?.qpdfVersion ?? '11.9.1'}/LICENSE.txt -o scripts/qpdf-LICENSE.txt then rerun this script.\n`,
      'utf8',
    );
    logWarn(`${platformKey}: scripts/qpdf-LICENSE.txt missing — wrote pointer file (Apache-2.0 §4 redistribution gap until canonical LICENSE is checked in)`);
  }

  // Stamp the platform tree with the version we vendored, for the runtime
  // discovery + a future "is this fresh?" check.
  await writeFile(
    joinPath(platDir, 'VERSION'),
    `qpdf ${binSpec._version ?? ''}\nsha256 ${binSpec.sha256}\n`,
    'utf8',
  );

  return platDir;
}

async function fetchPlatform(manifest, platformKey, opts = {}) {
  const spec = manifest.binaries[platformKey];
  if (!spec) {
    logErr(`unknown platform key: ${platformKey}`);
    return { ok: false, reason: 'unknown_platform' };
  }
  if (spec.url === null) {
    logInfo(`${platformKey}: no upstream prebuilt binary — see manifest _layoutNotes.darwin. Runtime falls back to system PATH.`);
    return { ok: true, skipped: true };
  }

  const archiveBase = spec.url.split('/').pop();
  const archivePath = joinPath(CACHE_ROOT, platformKey, archiveBase);
  const extractDir = joinPath(CACHE_ROOT, platformKey, 'extract');

  // 1. Download (cached).
  if (await pathExists(archivePath)) {
    const sha = await fileSha256(archivePath);
    if (sha === spec.sha256) {
      logOk(`${platformKey}: cached archive SHA256 matches`);
    } else {
      logWarn(`${platformKey}: cached archive SHA256 mismatch (${sha} != ${spec.sha256}); re-downloading`);
      await rm(archivePath, { force: true });
    }
  }
  if (!(await pathExists(archivePath))) {
    log(`${platformKey}: downloading ${spec.url} (${(spec.sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
    await downloadToFile(spec.url, archivePath);
    const sha = await fileSha256(archivePath);
    if (sha !== spec.sha256) {
      // SHA mismatch — refuse to proceed. This is the "non-negotiable" gate
      // per the Wave 11 brief: a mismatched binary is either a tampered
      // download or an out-of-date manifest. Either way, don't write it to
      // the vendor tree.
      await rm(archivePath, { force: true });
      throw new Error(
        `${platformKey}: SHA256 mismatch — expected ${spec.sha256}, got ${sha}. Refusing to install. ` +
          `Verify the manifest pin against https://github.com/qpdf/qpdf/releases/download/v${manifest.qpdfVersion}/qpdf-${manifest.qpdfVersion}.sha256 and re-run.`,
      );
    }
    logOk(`${platformKey}: downloaded + SHA256 verified`);
  }

  // 2. Extract.
  log(`${platformKey}: extracting to ${extractDir}`);
  await unzipArchive(archivePath, extractDir);

  // 3. Lay out vendor tree.
  const platDir = await copyVendorLayout(
    extractDir,
    platformKey,
    {
      ...spec,
      _version: manifest.qpdfVersion,
    },
    manifest,
  );
  logOk(`${platformKey}: vendor tree at ${platDir}`);

  return { ok: true, platDir };
}

async function checkPlatform(manifest, platformKey) {
  const spec = manifest.binaries[platformKey];
  if (!spec) return { ok: false, reason: 'unknown_platform' };
  if (spec.url === null) return { ok: true, skipped: true };

  const platDir = joinPath(VENDOR_ROOT, platformKey);
  if (!(await pathExists(platDir))) {
    logErr(`${platformKey}: vendor tree missing at ${platDir}`);
    return { ok: false, reason: 'missing' };
  }
  // Spot-check the binary exists.
  const binBase = spec.binaryPathInArchive.split('/').pop();
  const binPath = platformKey === 'win32-x64'
    ? joinPath(platDir, 'bin', binBase)
    : joinPath(platDir, 'bin', binBase);
  if (!(await pathExists(binPath))) {
    logErr(`${platformKey}: binary missing at ${binPath}`);
    return { ok: false, reason: 'binary_missing' };
  }
  // The VERSION stamp file is the cheap "are these the right bits" check.
  const versionFile = joinPath(platDir, 'VERSION');
  if (!(await pathExists(versionFile))) {
    logWarn(`${platformKey}: VERSION stamp missing — vendor tree is from an unknown fetch`);
    return { ok: false, reason: 'no_version_stamp' };
  }
  const stamp = await readFile(versionFile, 'utf8');
  if (!stamp.includes(spec.sha256)) {
    logErr(`${platformKey}: VERSION stamp does not reference manifest SHA256 (manifest changed since fetch)`);
    return { ok: false, reason: 'stale' };
  }
  logOk(`${platformKey}: vendor tree healthy`);
  return { ok: true };
}

function printHelp() {
  process.stdout.write(
    `usage:\n  node scripts/fetch-qpdf-binaries.mjs              # fetch the current host platform\n  node scripts/fetch-qpdf-binaries.mjs --all        # fetch every platform with a pinned url\n  node scripts/fetch-qpdf-binaries.mjs --platform=<key>\n  node scripts/fetch-qpdf-binaries.mjs --check      # verify already-fetched vendor tree\n\nSupported platform keys: win32-x64, linux-x64, darwin-x64, darwin-arm64\n  (darwin-* are pass-through: upstream qpdf 11.9.1 publishes no macOS binary)\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.mode === 'help') {
    printHelp();
    return;
  }
  const manifest = await loadManifest();

  let targets;
  if (args.all) {
    targets = Object.keys(manifest.binaries);
  } else if (args.target !== null) {
    targets = [args.target];
  } else {
    targets = [currentPlatformKey()];
  }

  let failed = 0;
  for (const t of targets) {
    if (args.check) {
      const r = await checkPlatform(manifest, t);
      if (!r.ok && !r.skipped) failed++;
    } else {
      try {
        const r = await fetchPlatform(manifest, t);
        if (!r.ok && !r.skipped) failed++;
      } catch (e) {
        logErr(`${t}: ${e.message}`);
        failed++;
      }
    }
  }

  if (failed > 0) {
    logErr(`${failed} platform(s) failed`);
    process.exitCode = 1;
  } else {
    logOk(`done (${targets.length} target(s))`);
  }
}

main().catch((e) => {
  logErr(`unhandled: ${e.stack || e.message}`);
  process.exitCode = 1;
});
