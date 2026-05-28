#!/usr/bin/env node
// Wave 25 (Diego) — vitest failure triage.
// Reads the JSON reporter output from `npm test -- --reporter=json` and
// surfaces failing test files grouped by domain (src/db, src/main, src/ipc,
// src/preload, src/client) so Diego can identify which failures are pre-
// existing brittle tests vs Phase-6 regressions vs vitest 2.x API drift.

import { readFileSync } from 'node:fs';

const SOURCE = process.argv[2] || '/tmp/vitest-results.json';
const raw = readFileSync(SOURCE, 'utf8');
// Skip npm noise lines before the JSON body.
const jsonStart = raw.indexOf('{');
const r = JSON.parse(raw.slice(jsonStart));

console.log('Test suites:', r.numPassedTestSuites, 'passed /', r.numFailedTestSuites, 'failed of', r.numTotalTestSuites);
console.log('Test cases :', r.numPassedTests, 'passed /', r.numFailedTests, 'failed of', r.numTotalTests);
console.log('');

const buckets = { 'src/db': [], 'src/main': [], 'src/ipc': [], 'src/preload': [], 'src/client': [], 'other': [] };
for (const tr of r.testResults) {
  if (tr.status !== 'failed') continue;
  const file = String(tr.name).replace(/\\\\/g, '/').replace(/\\/g, '/');
  const rel = file.split('PDF_Viewer_Editor/')[1] || file;
  const failed = tr.assertionResults.filter((a) => a.status === 'failed').length;
  const passed = tr.assertionResults.filter((a) => a.status === 'passed').length;
  const entry = { file: rel, failed, passed };
  let placed = false;
  for (const key of Object.keys(buckets)) {
    if (key !== 'other' && rel.startsWith(key + '/')) {
      buckets[key].push(entry);
      placed = true;
      break;
    }
  }
  if (!placed) buckets.other.push(entry);
}

for (const [bucket, entries] of Object.entries(buckets)) {
  if (entries.length === 0) continue;
  entries.sort((a, b) => b.failed - a.failed);
  const totalFailed = entries.reduce((s, e) => s + e.failed, 0);
  const totalPassed = entries.reduce((s, e) => s + e.passed, 0);
  console.log(`=== ${bucket} === (${entries.length} files, ${totalFailed} failed, ${totalPassed} passed in failing files)`);
  for (const e of entries) {
    console.log(`  ${e.failed.toString().padStart(3)} failed / ${e.passed.toString().padStart(3)} passed  ${e.file}`);
  }
  console.log('');
}

// Quick assertion-message clustering.
const messages = new Map();
for (const tr of r.testResults) {
  if (tr.status !== 'failed') continue;
  for (const a of tr.assertionResults) {
    if (a.status !== 'failed') continue;
    for (const m of a.failureMessages || []) {
      // Take just first non-stack line.
      const firstLine = String(m).split('\n').find((l) => l.trim() && !l.includes('at '))?.trim().slice(0, 160) || '';
      messages.set(firstLine, (messages.get(firstLine) || 0) + 1);
    }
  }
}
console.log('=== Top 15 unique error message prefixes ===');
const top = [...messages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [msg, n] of top) {
  console.log(`  ${n.toString().padStart(4)}x  ${msg}`);
}
