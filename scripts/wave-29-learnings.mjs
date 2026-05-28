import { appendFileSync, readFileSync } from 'node:fs';

const entry = {
  ts: '2026-05-28T05:10:00Z',
  agent: 'dev-ops-agent',
  project: 'PDF_Viewer_Editor',
  task: 'Wave 29 Phase 7 packaging - v0.7.0 roadmap-closing Windows build (electron-updater + i18next install, aria-proptypes warn->error, mac/linux+publish config, L-002 verify)',
  outcome: 'success',
  detail: 'Shipped v0.7.0 NSIS (135.67MB) + portable (135.44MB) + latest.yml; closed the 7-phase roadmap. Installed electron-updater@6.8.3 + i18next@26.3.0 + react-i18next@17.0.8 + i18next-resources-to-backend@1.2.1 (all MIT; 23-pkg subtree walk = zero copyleft). Flipped jsx-a11y/aria-proptypes warn->error (plugin 6.10.2 handles dynamic booleans; 0 violations, verified flip introduced zero new problems). Added mac (dmg+zip universal) + linux (AppImage+deb) + github publish PLACEHOLDER to electron-builder.yml, all loudly UNVERIFIED/placeholder. asar verified: locale bundles inlined into renderer index chunk, electron-updater+i18next bundled, app-update.yml carries owner/repo PLACEHOLDER. L-002 satisfied via Playwright _electron CDP capture (desktop-operator MCP absent + SendKeys denied): launch + Settings-General + es-ES-live-switch + About-0.7.0 screenshots, 0 page errors. FOUR+ non-obvious surprises hit this wave (see fix). Also flagged a pre-existing swarm-wide CI-lint debt (npm run lint RED at 46 errors / 402 warnings) that will fail CI until cleared - NOT a Phase-7 regression.',
  fix: [
    '(1) i18next 26 types InitOptions.lng as `lng?: string` (NOT string|undefined), so an EXPLICIT `lng: undefined` is TS2769 under exactOptionalPropertyTypes:true. react-i18next 17 peer-pins i18next>=26.2 so you CANNOT downgrade to dodge it, AND i18next 24/25/26 all type lng?:string. The ONLY fix is omitting the key (semantically identical) - a renderer-source change, not a package.json pin. LESSON: when a dep major-bump surfaces a strict-optional typecheck error in another agent file, the fix lives in THEIR file; a version pin will not help.',
    '(2) PowerShell System.Windows.Forms.SendKeys throws Access-is-denied from a non-interactive agent shell (cannot synthesize input to a foreground window). Use Playwright _electron.launch({executablePath:<packaged exe>, args:[<bundled app.asar>]}) to drive the REAL packaged renderer over CDP + page.screenshot() - no OS input synthesis, real pixels, L-002-sanctioned. This is the most reliable Electron UI-drive path on a sandboxed Windows shell, beating SendKeys (denied) and PrintWindow-only (pixels but no interaction).',
    '(3) After ANY npm install regenerates package-lock.json, `npm ci` (CI, no CLI flag) FAILS with ERESOLVE if the project carries a peer-range mismatch that prior installs only survived via --legacy-peer-deps on the CLI. Pin legacy-peer-deps=true in .npmrc so npm ci resolves identically to the committed lock.',
    '(4) electron-builder packaging fails with remove win-unpacked\\<dll>: Access is denied when lingering Electron processes from a prior win-unpacked launch hold a DLL handle. ALWAYS kill the productName process tree + clear release/win-unpacked before dist:win.',
    '(5) better-sqlite3 11.10.0 has NO Node-v137 (Node 24) prebuild (GitHub 404; only 115/127/131 published). Run vitest under portable Node 22.18.0 (ABI 127) with `prebuild-install -r node -t 22.18.0`, then RESTORE the Electron-ABI binary (test-only swap, matches Ravi Wave-20/24 discipline).',
  ].join(' '),
  locked: ['L-001 verified untouched', 'L-002 satisfied (pixel screenshots embedded + described in build-report)'],
  refs: [
    'docs/build-report.md Wave 29 - Diego',
    'electron-builder.yml',
    'release/wave-29-v070-settings.png',
    'release/wave-29-v070-es-locale.png',
    'release/wave-29-v070-about.png',
    'scripts/wave-29-l002-verify.mjs',
    'scripts/wave-29-about-verify.mjs',
  ],
};

appendFileSync('.learnings/learnings.jsonl', JSON.stringify(entry) + '\n');
const n = readFileSync('.learnings/learnings.jsonl', 'utf8').split('\n').filter(Boolean).length;
console.log('appended Diego Wave 29 learnings entry; total lines:', n);
