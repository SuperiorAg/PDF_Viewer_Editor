#!/usr/bin/env node
// Wave 25 (Diego) — hand-rolled license walk.
// license-checker@25.0.1 is broken on Node 24 (slide module resolution
// failure per Phase 5 LICENSES.md walk). This script recursively reads
// every package.json in node_modules/ and prints a license-by-package
// table + a license-rollup count. It also flags any non-permissive license.
//
// Run via: `node scripts/wave25-license-walk.mjs`

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\//, '');
const NODE_MODULES = join(ROOT, 'node_modules');

// Permissive whitelist per ARCHITECTURE.md §3.
const PERMISSIVE_PATTERNS = [
  /^MIT($|\s|-)/,
  /^Apache-2\.0$/,
  /^BSD-2-Clause$/,
  /^BSD-3-Clause$/,
  /^BSD$/,
  /^ISC$/,
  /^0BSD$/,
  /^CC0-1\.0$/,
  /^CC-BY-4\.0$/,
  /^Unlicense$/,
  /^WTFPL$/,
  /^Python-2\.0$/,
  /^MPL-2\.0$/,
  /^BlueOak-1\.0\.0$/,
  /^MIT-0$/,
  /^MIT\/X11$/,
  /^Zlib$/,
];
// Forbidden (copyleft / commercial / no-license).
const FORBIDDEN_PATTERNS = [/AGPL/, /^GPL-?[0-9]/, /^LGPL/, /^EPL/, /Commercial/];

function isPermissive(license) {
  if (!license) return false;
  // Dual-license SPDX expressions: at least one arm must be permissive.
  // We accept (X OR Y) where any of X|Y is permissive, even if the other arm is GPL etc.
  // We REJECT (X AND Y) where any arm is forbidden.
  const expr = String(license).replace(/[()]/g, '').trim();

  if (expr.includes(' AND ')) {
    const parts = expr.split(/\s+AND\s+/);
    return parts.every((p) => isSinglePermissive(p.trim()));
  }
  if (expr.includes(' OR ')) {
    const parts = expr.split(/\s+OR\s+/);
    return parts.some((p) => isSinglePermissive(p.trim()));
  }
  return isSinglePermissive(expr);
}

function isSinglePermissive(license) {
  if (!license) return false;
  if (FORBIDDEN_PATTERNS.some((re) => re.test(license))) return false;
  return PERMISSIVE_PATTERNS.some((re) => re.test(license));
}

function isForbidden(license) {
  if (!license) return false;
  const expr = String(license).replace(/[()]/g, '').trim();
  if (expr.includes(' OR ')) {
    const parts = expr.split(/\s+OR\s+/);
    // OR: only forbidden if EVERY arm is forbidden (no permissive escape).
    return parts.every((p) => FORBIDDEN_PATTERNS.some((re) => re.test(p.trim())));
  }
  // AND or single: forbidden if any arm is forbidden.
  return FORBIDDEN_PATTERNS.some((re) => re.test(expr));
}

function readLicense(pkgPath) {
  try {
    const pjson = JSON.parse(readFileSync(join(pkgPath, 'package.json'), 'utf8'));
    let license = pjson.license;
    if (!license && Array.isArray(pjson.licenses) && pjson.licenses.length > 0) {
      license = pjson.licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ');
    }
    if (typeof license === 'object' && license !== null) {
      license = license.type || JSON.stringify(license);
    }
    return { name: pjson.name, version: pjson.version, license: license || 'UNKNOWN' };
  } catch {
    return null;
  }
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = join(dir, e.name);
    if (e.name.startsWith('@')) {
      // scope dir — recurse into orgs
      walk(sub, out);
      continue;
    }
    const info = readLicense(sub);
    if (info && info.name) {
      const key = `${info.name}@${info.version}`;
      if (!out.has(key)) out.set(key, info);
    }
    // recurse into nested node_modules
    const nested = join(sub, 'node_modules');
    try {
      if (statSync(nested).isDirectory()) walk(nested, out);
    } catch {
      // no nested
    }
  }
}

const out = new Map();
walk(NODE_MODULES, out);

const rollup = new Map();
const forbidden = [];
const unknowns = [];
for (const info of out.values()) {
  const license = info.license || 'UNKNOWN';
  rollup.set(license, (rollup.get(license) || 0) + 1);
  if (license === 'UNKNOWN' || license === '') {
    unknowns.push(`${info.name}@${info.version}`);
  } else if (isForbidden(license)) {
    forbidden.push(`${info.name}@${info.version}: ${license}`);
  } else if (!isPermissive(license)) {
    forbidden.push(`${info.name}@${info.version}: ${license} (not in permissive whitelist)`);
  }
}

console.log(`Total packages scanned: ${out.size}`);
console.log('');
console.log('License rollup:');
const sorted = [...rollup.entries()].sort((a, b) => b[1] - a[1]);
for (const [license, count] of sorted) {
  console.log(`  ${count.toString().padStart(4)}  ${license}`);
}

if (forbidden.length > 0) {
  console.log('');
  console.log('FORBIDDEN / NON-PERMISSIVE LICENSES (must be reviewed):');
  for (const item of forbidden) console.log(`  - ${item}`);
  process.exitCode = 1;
}

if (unknowns.length > 0) {
  console.log('');
  console.log(`Packages with NO license declared (${unknowns.length}):`);
  for (const u of unknowns) console.log(`  - ${u}`);
}

// Wave 25 — specifically log the NEW Phase-6 newcomers vs Wave 21 baseline.
const PHASE_6_DIRECT = ['docx', 'pptxgenjs', 'vitest', '@vitest/ui'];
console.log('');
console.log('Phase 6 direct deps + their licenses (wave-25 audit):');
for (const name of PHASE_6_DIRECT) {
  for (const info of out.values()) {
    if (info.name === name) console.log(`  ${info.name}@${info.version}: ${info.license}`);
  }
}
