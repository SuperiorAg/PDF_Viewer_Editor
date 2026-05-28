// Wave 29 (Diego) — L-002 Phase-7-surface visual verification of the PACKAGED
// v0.7.0 binary, driven via Playwright's _electron CDP driver.
//
// Why Playwright and not PowerShell SendKeys: this agent's shell is non-
// interactive, so System.Windows.Forms.SendKeys throws "Access is denied"
// (no rights to synthesize input to a foreground window). Playwright drives
// the real renderer DOM over the DevTools protocol — no OS input synthesis —
// and page.screenshot() captures real pixels. This is one of the three capture
// methods L-002 explicitly sanctions.
//
// It launches the ACTUAL packaged main entry from release/win-unpacked (the
// shipped artifact), not the dev dist, so the screenshots prove the packaged
// binary's Phase-7 UI renders.
//
// Usage: node scripts/wave-29-l002-verify.mjs

import { _electron as electron } from 'playwright';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(process.cwd());
const REL = join(ROOT, 'release', 'win-unpacked');
const EXE = join(REL, 'PDF Viewer & Editor.exe');
const RES_APP = join(REL, 'resources', 'app.asar');
const OUT = join(ROOT, 'release');

function log(...a) { console.log('[l002]', ...a); }

if (!existsSync(EXE)) { console.error('packaged exe not found:', EXE); process.exit(2); }

const app = await electron.launch({
  executablePath: EXE,
  // The packaged main reads its app from the bundled asar; pass the asar path
  // as the app arg so Electron loads the SHIPPED renderer, not dev dist.
  args: [RES_APP],
  timeout: 60000,
});

const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
// Let the React tree + i18next settle.
await page.waitForTimeout(2500);

const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

// --- 1. Empty-state regression shot ----------------------------------------
await page.screenshot({ path: join(OUT, 'wave-29-v070-pw-launch.png') });
const emptyText = await page.locator('text=Open a PDF to get started').count().catch(() => 0);
log('empty-state hero present:', emptyText > 0);

// --- 2. Open Settings (Ctrl+,) ----------------------------------------------
await page.keyboard.press('Control+Comma');
await page.waitForTimeout(1200);

// The settings modal routes through modal-shell (role="dialog"). The General
// tab is default-selected; the language picker is a <select> with a stable
// aria-label.
const dialogCount = await page.getByRole('dialog').count().catch(() => 0);
log('settings dialog open:', dialogCount > 0);

// Make sure we're on the General tab (it is the first/default tab).
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'wave-29-v070-settings.png') });
log('captured settings General tab');

// Probe the Phase-7 controls.
const langSelect = page.locator('select').filter({ has: page.locator('option[value="es-ES"]') }).first();
const hasLangPicker = await langSelect.count().catch(() => 0);
log('language picker (with es-ES option) present:', hasLangPicker > 0);

const telemetryCheckboxes = await page.locator('input[type="checkbox"]').count().catch(() => 0);
log('checkbox controls present (telemetry opt-in among them):', telemetryCheckboxes);

const checkNow = await page.getByRole('button').filter({ hasText: /check/i }).count().catch(() => 0);
log('a "Check for updates" button present:', checkNow > 0);

// --- 3. Switch language to es-ES --------------------------------------------
if (hasLangPicker > 0) {
  await langSelect.selectOption('es-ES');
  // Allow i18next live-switch + Suspense to swap strings.
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, 'wave-29-v070-es-locale.png') });
  log('captured es-ES locale switch');
  // Sample: does any visible Spanish string appear?
  const spanishHit = await page.locator('text=/Idioma|Privacidad|Actualiz|Herramientas|Ajustes|Configuraci/i').count().catch(() => 0);
  log('visible Spanish string(s) detected after switch:', spanishHit);
}

log('pageerror count:', errs.length);
if (errs.length) log('errors:', errs.slice(0, 5));

await app.close();
log('done');
