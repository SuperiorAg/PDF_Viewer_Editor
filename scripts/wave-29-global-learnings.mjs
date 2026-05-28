import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dir = join(homedir(), '.claude', 'learnings');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const file = join(dir, 'global.jsonl');

const entries = [
  {
    ts: '2026-05-28T05:12:00Z',
    agent: 'dev-ops-agent',
    project: 'PDF_Viewer_Editor',
    scope: 'cross-project',
    topic: 'Electron GUI verification from a sandboxed/non-interactive shell',
    lesson: 'PowerShell System.Windows.Forms.SendKeys throws "Access is denied" when the agent shell is non-interactive (no rights to synthesize input to a foreground window). To DRIVE (not just screenshot) a packaged Electron app for visual verification, use Playwright _electron.launch({ executablePath: <packaged exe>, args: [<bundled app.asar>] }) -> firstWindow() -> page.keyboard / page.click / page.selectOption -> page.screenshot(). It drives the REAL packaged renderer over the DevTools protocol with NO OS input synthesis, captures real pixels, and is L-002-sanctioned. Ranking of capture paths on a sandboxed Windows shell: Playwright CDP (drive + pixels) > PrintWindow(hwnd,hdc,0x2) (pixels only, no interaction, works when inactive) > GDI CopyFromScreen (needs desktop DC) > SendKeys/SendInput (needs interactive session, usually denied).',
  },
  {
    ts: '2026-05-28T05:12:30Z',
    agent: 'dev-ops-agent',
    project: 'PDF_Viewer_Editor',
    scope: 'cross-project',
    topic: 'npm ci ERESOLVE after a lock regeneration',
    lesson: 'When a project survives a peer-range mismatch only because installs pass --legacy-peer-deps on the CLI, the moment ANY npm install regenerates package-lock.json, `npm ci` (which CI runs with NO CLI flag) FAILS with ERESOLVE. Fix: pin `legacy-peer-deps=true` in .npmrc so npm ci resolves identically to the committed lock. This does not mask a real conflict when the packages are verified runtime-compatible; it only relaxes npm strict peer enforcement to match how the lock was generated. Check this proactively after adding deps to any project that has a known peer mismatch (e.g. a plugin whose peer range excludes the pinned major).',
  },
  {
    ts: '2026-05-28T05:13:00Z',
    agent: 'dev-ops-agent',
    project: 'PDF_Viewer_Editor',
    scope: 'cross-project',
    topic: 'Dep major-bump surfacing exactOptionalPropertyTypes typecheck errors',
    lesson: 'A library major-version bump can re-type an optional property from `x?: T | undefined` to `x?: T`. Under tsconfig exactOptionalPropertyTypes:true, any call site that passes an EXPLICIT `x: undefined` then fails TS2769 even though omitting the key compiles. When react-i18next-style peer pins force the new major (e.g. react-i18next 17 requires i18next>=26.2), you cannot downgrade to dodge it, and the older majors often share the same `x?: T` shape anyway - so the fix is at the call site (omit the key), NOT a package.json version pin. If that call site is owned by another agent, the fix belongs in their file; disclose + request ratification rather than weakening the global strictness flag.',
  },
];

for (const e of entries) appendFileSync(file, JSON.stringify(e) + '\n');
const n = readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
console.log('appended', entries.length, 'global learnings; global.jsonl total lines:', n);
