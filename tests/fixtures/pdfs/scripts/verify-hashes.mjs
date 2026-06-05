#!/usr/bin/env node
// Phase 7.1 — fixture hash verifier. Diego owns. 2026-06-05.
//
// CI runs this before the e2e job. It re-hashes each fixture on disk and
// compares to expected-hashes.json. Mutation (e.g. someone substituted a
// copyrighted PDF) trips the verifier and the build fails BEFORE the e2e
// job even launches Electron, saving ~3-4 minutes of runner time per false
// alarm.
//
// Zero external deps — node:crypto + node:fs only. Safe to run pre-`npm ci`.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '..');
const LOCKFILE = resolve(FIXTURES_DIR, 'expected-hashes.json');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function main() {
  const lock = JSON.parse(readFileSync(LOCKFILE, 'utf8'));
  const failures = [];
  for (const [name, meta] of Object.entries(lock.fixtures)) {
    const path = resolve(FIXTURES_DIR, name);
    const bytes = readFileSync(path);
    const actual = sha256(bytes);
    if (actual !== meta.sha256) {
      failures.push(
        `  ${name}\n    expected: ${meta.sha256}\n    actual:   ${actual}\n    bytes:    ${String(bytes.length)} (expected ${String(meta.bytes)})`,
      );
    } else {
      console.log(`[verify-hashes] OK  ${name} sha256=${actual.slice(0, 16)}...`);
    }
  }
  if (failures.length > 0) {
    console.error('[verify-hashes] FAIL — fixture hash mismatch:');
    for (const f of failures) console.error(f);
    console.error(
      '\nIf you intentionally regenerated a fixture, run `node tests/fixtures/pdfs/scripts/generate-fixtures.mjs` and commit the new bytes + the new expected-hashes.json in the SAME commit.',
    );
    process.exit(1);
  }
  console.log(`[verify-hashes] all ${String(Object.keys(lock.fixtures).length)} fixture(s) match lockfile.`);
}

main();
