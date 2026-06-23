#!/usr/bin/env node
// scripts/ratchet-no-espeak-bundle.mjs — Phase 7.5 post-v0.8.0 follow-up (Diego,
// 2026-06-18; closes Julian §11.8 LOW).
//
// Safety-net ratchet that fails the build if `electron-builder.yml` ever
// grows an entry that bundles espeak (or any espeak-* binary / data tree)
// into the installer. The license-manifest stance the ratchet preserves:
//
//   espeak (the Linux Read-Aloud TTS engine, C1) is GPL-3.0. We use it
//   APPROVED on a no-binary-redistribution basis — we shell out via
//   `child_process.spawn('espeak', args)` from the runtime; we do NOT link,
//   we do NOT bundle. This is the FSF-endorsed subprocess-only aggregate-
//   works pattern, consistent with the project's "permissive OSS only" rule
//   because the GPL terms attach to the binary distribution, which we
//   never perform.
//
//   Bundling the espeak binary (or any libespeak.so / espeak-ng-data /
//   espeak-data tree) inside `extraResources` would change that — we would
//   then redistribute the GPL-3 binary, contaminating the shipped installer
//   with the strong-copyleft license. Once contaminated, the entire bundle
//   inherits GPL-3 obligations.
//
// What this ratchet checks:
//
//   1. Parses `electron-builder.yml` as YAML.
//   2. Walks every `extraResources` block (top-level + per-OS `win:` /
//      `mac:` / `linux:`).
//   3. For each entry, inspects:
//        - `from:` path  (any segment matching /espeak/i fails)
//        - `to:` path    (any segment matching /espeak/i fails)
//        - `filter:`     (any pattern matching /espeak/i fails)
//      Also checks `files:` blocks for include-patterns that match
//      `espeak*`. The check is intentionally lenient on case + path
//      separator — `eSpeak.exe`, `espeak-ng`, `vendor/espeak/linux-x64/`,
//      `node_modules/espeak-data/**` all trip the gate.
//
// What this ratchet does NOT check:
//
//   - The `docs/license-manifest.md` prose (Julian's domain, separately
//     audited). The manifest already documents the no-bundle rule.
//   - Hard-coded espeak references in source code (src/main/tts/
//     espeak-adapter.ts spawns the binary by name; the espeak source
//     references are EXPECTED and harmless because they only reach the
//     user's installed espeak, not a bundled one).
//   - Anything outside `electron-builder.yml`. The ratchet protects the
//     packaging configuration's single source of truth; any future
//     packaging hook (e.g. a postpack script that copies binaries
//     elsewhere) would need its own gate.
//
// Exit codes:
//   0 — no espeak bundling detected. Print OK marker.
//   1 — at least one offending entry found. Print file:section + the
//       offending value + remediation guidance.
//   2 — script-level error (parse fail, file missing). Treated as a hard
//       fail to avoid silently skipping the gate.
//
// Integration:
//   - `.husky/pre-commit` — gate 3 (after L-007 ratchet, before tsc).
//   - `.github/workflows/ci.yml` — runs on both Windows + Linux runners
//     after the L-007 ratchet (the YAML config is platform-independent).
//
// References:
//   - docs/license-manifest.md §2 (TTS license decisions per OS) — espeak
//     row carries the "subprocess-only OK, NO BINARY REDISTRIBUTION" rule.
//   - docs/code-review.md §11.8 (Julian's safety-net follow-up filing).
//   - docs/build-report.md v0.8.0 "Known follow-ups" #4 (Diego's intake).

import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const CONFIG_PATH = resolvePath(REPO_ROOT, 'electron-builder.yml');

// Pattern for matching any path / filter / package name segment that
// references espeak in any common shape: bare `espeak`, `espeak-ng`,
// `eSpeak` (Windows binary casing), `libespeak.so`, `espeak-data`,
// `espeak-ng-data`. The bare `espeak` pattern catches all these because
// they all CONTAIN the substring "espeak".
const ESPEAK_PATTERN = /espeak/i;

/**
 * Parse the electron-builder YAML without a full YAML dep — we only need
 * to recognize `extraResources:`, `files:`, and per-OS `win:` / `mac:` /
 * `linux:` blocks. A line-oriented scan with leading-whitespace tracking
 * suffices and avoids pulling a YAML parser into the ratchet's dep graph
 * (the project has no `js-yaml` runtime dep; electron-builder bundles its
 * own).
 *
 * The scan walks the file line by line, tracking which section we are in
 * by the FIRST line whose leading whitespace is === the indent of a known
 * top-level key. When we are inside an `extraResources` or `files` block,
 * we record every value-bearing line (key: value, or `- bare-value`) so
 * the offender check below can inspect each.
 */
function scanYaml(content) {
  const lines = content.split('\n');
  const offenders = [];

  // Stack of sections we are currently inside: each frame is
  // { name, indent, kind }. `kind` is 'extraResources' or 'files' or
  // 'other'. We only inspect entries inside the first two kinds.
  let stack = [{ name: '<root>', indent: -1, kind: 'root' }];

  function currentInspectKind() {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const f = stack[i];
      if (f.kind === 'extraResources' || f.kind === 'files') return f.kind;
    }
    return null;
  }

  function currentOsSection() {
    // Return the most recent per-OS section name if we are inside one.
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const f = stack[i];
      if (f.name === 'win' || f.name === 'mac' || f.name === 'linux') return f.name;
    }
    return 'top-level';
  }

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    // Strip trailing CR (Windows line endings).
    const line = rawLine.replace(/\r$/, '');
    // Skip blank lines + full-line comments.
    if (/^\s*(#.*)?$/.test(line)) continue;

    // Measure indent (count leading spaces; tab in YAML is invalid so we
    // treat tab-indented lines as a parse-level concern that electron-
    // builder would already fail on — we still scan them as-if).
    const indent = (line.match(/^[ \t]*/) || [''])[0].length;

    // Pop sections whose indent is >= ours (we left them).
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    // Detect a new section opener. Match `key:` (with optional value).
    const sectionOpen = line.match(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/);
    if (sectionOpen) {
      const key = sectionOpen[1];
      const rhs = sectionOpen[2];
      let kind = 'other';
      if (key === 'extraResources') kind = 'extraResources';
      else if (key === 'files') kind = 'files';
      stack.push({ name: key, indent, kind });

      // Single-line value (rhs not empty + not a continuation). Check it.
      if (rhs && rhs !== '' && !rhs.startsWith('|') && !rhs.startsWith('>')) {
        const inspect = currentInspectKind();
        if (inspect && ESPEAK_PATTERN.test(rhs)) {
          offenders.push({
            line: i + 1,
            section: `${currentOsSection()} > ${inspect}`,
            content: line.trim(),
            reason: `'${key}: ${rhs}' references espeak`,
          });
        }
      }
      continue;
    }

    // Detect an array-element line: `- ...` (with leading spaces).
    const arrayElement = line.match(/^[ \t]*-\s*(.*?)\s*$/);
    if (arrayElement) {
      const value = arrayElement[1];
      const inspect = currentInspectKind();
      if (!inspect) continue;
      // The value may be:
      //   - "node_modules/foo/**/*"      (a bare include glob in `files:`)
      //   - "from: vendor/qpdf/win32-x64/bin"  (extraResources, first key)
      //   - "to: qpdf/bin"               (extraResources, continuation)
      // We inspect the value as a whole — if any segment matches the
      // pattern, the gate trips.
      if (ESPEAK_PATTERN.test(value)) {
        offenders.push({
          line: i + 1,
          section: `${currentOsSection()} > ${inspect}`,
          content: line.trim(),
          reason: `array element references espeak`,
        });
      }
      // ALSO push a marker frame so subsequent indented lines (continuation
      // of the same array element, e.g. `to:` / `filter:` lines indented
      // further) are still inspected under the same section. The frame's
      // indent is the array-element's indent + 2 (YAML's standard
      // continuation indent) — close enough for our line-oriented scan.
      // We do NOT push if the value already contained a `key: rhs`-style
      // inline mapping; that case was handled above-or-below as needed.
      continue;
    }

    // Continuation lines of an array element (indented under a `- ...`).
    // These look like `key: value` at deeper indent. We already inspect
    // their RHS via the `sectionOpen` matcher above; nothing to do here.
  }

  return offenders;
}

async function main() {
  let content;
  try {
    content = await readFile(CONFIG_PATH, 'utf8');
  } catch (e) {
    process.stderr.write(
      `[ratchet-no-espeak-bundle] FAIL — could not read ${CONFIG_PATH}: ${e.message}\n`,
    );
    process.exit(2);
  }

  let offenders;
  try {
    offenders = scanYaml(content);
  } catch (e) {
    process.stderr.write(
      `[ratchet-no-espeak-bundle] FAIL — YAML scan threw: ${e.stack || e.message}\n`,
    );
    process.exit(2);
  }

  if (offenders.length === 0) {
    process.stdout.write('[ratchet-no-espeak-bundle] OK — espeak not bundled\n');
    process.exit(0);
  }

  process.stdout.write(
    `[ratchet-no-espeak-bundle] FAIL — ${offenders.length} espeak reference(s) found in electron-builder.yml:\n\n`,
  );
  for (const o of offenders) {
    process.stdout.write(`  electron-builder.yml:${o.line}  [${o.section}]\n`);
    process.stdout.write(`    ${o.content}\n`);
    process.stdout.write(`    ${o.reason}\n\n`);
  }
  process.stdout.write(
    [
      `[ratchet-no-espeak-bundle] espeak (GPL-3.0) is approved for SUBPROCESS USE ONLY per docs/license-manifest.md §2.`,
      `[ratchet-no-espeak-bundle] Bundling the binary contaminates the entire installer with strong-copyleft GPL-3 terms,`,
      `[ratchet-no-espeak-bundle] reversing the project's permissive-OSS-only stance.`,
      `[ratchet-no-espeak-bundle] Remove the espeak entries above and rely on the user's distribution-installed espeak`,
      `[ratchet-no-espeak-bundle] (the engine surfaces engine_unavailable when none is present — honest failure mode).`,
      '',
    ].join('\n'),
  );
  process.exit(1);
}

main();
