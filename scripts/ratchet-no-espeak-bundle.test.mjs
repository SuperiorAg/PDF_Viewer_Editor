#!/usr/bin/env node
// scripts/ratchet-no-espeak-bundle.test.mjs — self-test (Diego, 2026-06-18).
//
// Validates the ratchet correctly DETECTS an espeak bundle attempt by
// running it against a synthesised electron-builder.yml that contains
// representative offending entries. The test forks the ratchet script as
// a child process with a CWD whose `electron-builder.yml` is the
// synthesised fixture; the ratchet's CONFIG_PATH resolves relative to the
// script's own location, so we instead invoke an inline JS wrapper that
// imports the ratchet's scanYaml function and exercises it on string
// inputs. This keeps the self-test hermetic (no filesystem mutation).
//
// To run: `node scripts/ratchet-no-espeak-bundle.test.mjs`. Exit 0 = pass,
// non-zero = fail. The test is invoked from the same gates that run the
// ratchet itself, so a regression in the ratchet's detector trips the
// self-test on every commit.
//
// Why an .mjs self-test instead of a vitest case under src/**: the ratchet
// is a stand-alone packaging-time script, not a runtime module. Wiring it
// through vitest would force the .mjs into the typecheck graph (the
// vitest config's `include` pattern only matches .ts/.tsx today). The
// self-test mirrors the L-007 ratchet's testing posture (which has no
// vitest coverage either; both ratchets are self-contained scripts with
// self-tests that run from the same gate).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join as joinPath, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const RATCHET = resolvePath(__dirname, 'ratchet-no-espeak-bundle.mjs');

let pass = 0;
let fail = 0;

function expect(label, cond, detail = '') {
  if (cond) {
    pass += 1;
    process.stdout.write(`  ok  ${label}\n`);
  } else {
    fail += 1;
    process.stdout.write(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}\n`);
  }
}

/**
 * Run the ratchet from a temporary CWD whose `electron-builder.yml` is
 * the supplied content. The ratchet resolves its config path relative
 * to its OWN location, so we instead copy the ratchet into the tmp dir
 * and run THAT copy (so __dirname/.. lands in the tmp dir). Hermetic.
 */
function runRatchetWithYaml(yaml) {
  const tmp = mkdtempSync(joinPath(tmpdir(), 'espeak-ratchet-test-'));
  try {
    // Layout:
    //   <tmp>/
    //     electron-builder.yml   <- synthesised
    //     scripts/
    //       ratchet-no-espeak-bundle.mjs    <- copy
    const scriptsDir = joinPath(tmp, 'scripts');
    writeFileSync(joinPath(tmp, 'electron-builder.yml'), yaml, 'utf8');
    cpSync(RATCHET, joinPath(scriptsDir, 'ratchet-no-espeak-bundle.mjs'), {
      recursive: false,
    });
    const out = spawnSync(process.execPath, [joinPath(scriptsDir, 'ratchet-no-espeak-bundle.mjs')], {
      cwd: tmp,
      encoding: 'utf8',
    });
    return { code: out.status, stdout: out.stdout, stderr: out.stderr };
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

process.stdout.write('[self-test] ratchet-no-espeak-bundle\n');

// Sanity: the real script exists.
expect('ratchet script exists at canonical path', existsSync(RATCHET));

// Case 1 — clean config (no espeak) MUST exit 0.
{
  const clean = `
appId: com.example.app
extraResources:
  - from: vendor/qpdf/win32-x64/bin
    to: qpdf/bin
    filter: ["**/*"]
  - from: node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz
    to: tessdata/eng.traineddata.gz
win:
  target:
    - target: nsis
linux:
  target:
    - AppImage
`;
  const r = runRatchetWithYaml(clean);
  expect('clean config exits 0', r.code === 0, `code=${r.code}, stdout=${r.stdout}`);
  expect('clean config prints OK marker', /OK — espeak not bundled/.test(r.stdout));
}

// Case 2 — top-level extraResources with an espeak from-path MUST exit 1.
{
  const dirty = `
extraResources:
  - from: vendor/espeak/linux-x64/bin
    to: espeak/bin
    filter: ["**/*"]
`;
  const r = runRatchetWithYaml(dirty);
  expect('top-level espeak bundle exits 1', r.code === 1, `code=${r.code}`);
  expect('top-level espeak bundle flags from: path', /espeak/i.test(r.stdout));
}

// Case 3 — per-OS linux extraResources with libespeak.so MUST exit 1.
{
  const dirtyLinux = `
linux:
  target:
    - AppImage
  extraResources:
    - from: vendor/libespeak.so
      to: lib/libespeak.so
`;
  const r = runRatchetWithYaml(dirtyLinux);
  expect('linux-block libespeak bundle exits 1', r.code === 1);
  expect('linux-block libespeak bundle flags the entry', /libespeak/i.test(r.stdout));
}

// Case 4 — files: include pattern referencing espeak-data MUST exit 1.
{
  const dirtyFiles = `
files:
  - "dist/**/*"
  - "node_modules/espeak-data/**"
  - "!**/*.{ts,map}"
`;
  const r = runRatchetWithYaml(dirtyFiles);
  expect('files: espeak-data include exits 1', r.code === 1);
  expect('files: espeak-data include flags the entry', /espeak-data/.test(r.stdout));
}

// Case 5 — case-insensitive: an Acrobat-style "eSpeak.exe" path tripped.
{
  const mixedCase = `
extraResources:
  - from: vendor/eSpeak/win32-x64/eSpeak.exe
    to: tts/eSpeak.exe
`;
  const r = runRatchetWithYaml(mixedCase);
  expect('mixed-case eSpeak.exe bundle exits 1', r.code === 1);
}

// Case 6 — the real config (canonical) MUST stay clean. This is the
// regression that fires if a future packaging-config edit slips an espeak
// entry past code review.
{
  const realConfig = (() => {
    try {
      // Read synchronously via a small shim — we want to fork the
      // canonical ratchet against the canonical config without any
      // synthesis. spawnSync the script in its OWN repo CWD.
      const out = spawnSync(process.execPath, [RATCHET], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      return out;
    } catch (e) {
      return { status: 99, stdout: '', stderr: e.message };
    }
  })();
  expect(
    'canonical electron-builder.yml stays clean',
    realConfig.status === 0,
    `code=${realConfig.status}, stdout=${realConfig.stdout}, stderr=${realConfig.stderr}`,
  );
}

process.stdout.write(`[self-test] ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
