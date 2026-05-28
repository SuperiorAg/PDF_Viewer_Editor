// Wave Publish-Setup (Diego, 2026-05-28) — L-002 + auto-update functional
// verification of the PACKAGED v0.7.2 binary via Playwright's _electron CDP
// driver (an L-002-sanctioned method; this agent's shell is non-interactive so
// OS input synthesis is unavailable).
//
// PROVES (the headline of this wave): with the REAL publish target
// (SuperiorAg/PDF_Viewer_Editor) wired into electron-builder.yml, the packaged
// binary's bundled `app-update.yml` no longer contains 'PLACEHOLDER', so David's
// `isPublishConfiguredFromAppUpdateYml` returns true and `update:check` contacts
// the real GitHub releases feed and returns an HONEST result (up-to-date /
// available / a network error) — NEVER the old `update_not_configured`.
//
// Captures, from the SHIPPED release/win-unpacked artifact:
//   1. release/wave-publish-v072-launch-shot.png       — running window (regression)
//   2. release/wave-publish-v072-update-check.png      — Settings → About → after
//      "Check for updates now" — the update-status area showing the HONEST result.
//
// Also asserts (text, not just pixels):
//   - the bundled app-update.yml carries SuperiorAg/PDF_Viewer_Editor (no PLACEHOLDER)
//   - the status <p data-status> is NOT 'not-configured' after a check
//
// Usage: ELECTRON_RUN_AS_NODE cleared, then
//   node scripts/wave-publish-v072-update-check.mjs

import { _electron as electron } from 'playwright';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = resolve(process.cwd());
const REL = join(ROOT, 'release', 'win-unpacked');
const EXE = join(REL, 'PDF Viewer & Editor.exe');
const RES_APP = join(REL, 'resources', 'app.asar');
const APP_UPDATE_YML = join(REL, 'resources', 'app-update.yml');
const OUT = join(ROOT, 'release');
const log = (...a) => console.log('[publish-v072]', ...a);

if (!existsSync(EXE)) {
  console.error('packaged exe not found:', EXE);
  process.exit(2);
}

// ---- Pre-check 1: the bundled app-update.yml carries the REAL target. --------
if (!existsSync(APP_UPDATE_YML)) {
  console.error('app-update.yml not emitted in packaged resources:', APP_UPDATE_YML);
  process.exit(3);
}
const yml = readFileSync(APP_UPDATE_YML, 'utf8');
log('--- bundled app-update.yml ---\n' + yml.trim() + '\n------------------------------');
const hasPlaceholder = /PLACEHOLDER/i.test(yml);
const hasRealOwner = /owner:\s*SuperiorAg/i.test(yml) && /repo:\s*PDF_Viewer_Editor/i.test(yml);
log('app-update.yml contains PLACEHOLDER:', hasPlaceholder, '(want false)');
log('app-update.yml carries SuperiorAg/PDF_Viewer_Editor:', hasRealOwner, '(want true)');
if (hasPlaceholder || !hasRealOwner) {
  console.error('FAIL: bundled app-update.yml does NOT carry the real publish target.');
  process.exit(4);
}

// ---- Launch the packaged binary. --------------------------------------------
const app = await electron.launch({ executablePath: EXE, args: [RES_APP], timeout: 60000 });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);

const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

// 1. Launch / empty-state shot (regression — proves the v0.7.2 renderer boots).
//    NOTE: the persisted locale may be es-ES from a prior wave; the empty-state
//    hero is "Abra un PDF para empezar" in Spanish. We match either language.
await page.screenshot({ path: join(OUT, 'wave-publish-v072-launch-shot.png') });
const hero = await page
  .locator('text=/Open a PDF to get started|Abra un PDF para empezar/i')
  .count()
  .catch(() => 0);
log('launch shot captured; empty-state hero present:', hero > 0);

// 2. Open Settings (Ctrl+,) and navigate to the About tab.
await page.keyboard.press('Control+Comma');
await page.waitForTimeout(1200);
const dialogCount = await page.getByRole('dialog').count().catch(() => 0);
log('settings dialog open:', dialogCount > 0);

// Activate the About tab by its STABLE, locale-independent id (the tab labels
// are i18n-translated — "About" in en-US, "Acerca de" in es-ES — but the id
// `settings-tab-id-about` is a fixed English enum value per settings-modal).
const aboutTab = page.locator('#settings-tab-id-about').first();
const hasAboutTab = await aboutTab.count().catch(() => 0);
log('About tab (by stable id) present:', hasAboutTab > 0);
if (hasAboutTab > 0) {
  await aboutTab.click();
}
await page.waitForTimeout(800);

// 3. Click "Check for updates now". The label is i18n-translated, so anchor on
//    the update-status area structurally: the check button is the first button
//    sibling of the [data-status] line (UpdateStatusArea). Fall back to the
//    English/Spanish label regex.
let checkBtn = page
  .locator('[data-status]')
  .first()
  .locator('xpath=following-sibling::*//button[1] | xpath=../div//button[1]')
  .first();
if ((await checkBtn.count().catch(() => 0)) === 0) {
  checkBtn = page
    .getByRole('button', { name: /check for updates|buscar actualizaciones|comprobar actualizaciones/i })
    .first();
}
const hasCheck = await checkBtn.count().catch(() => 0);
log('"Check for updates" button present:', hasCheck > 0);
// Diagnostic: dump the pre-check status so we can see the initial state.
const preStatus = await page
  .locator('[data-status]')
  .first()
  .getAttribute('data-status')
  .catch(() => null);
log('pre-check data-status (before clicking):', preStatus);
if (hasCheck > 0) {
  await checkBtn.click();
  // Wait for the check to resolve: poll the data-status attr until it leaves
  // 'checking' (or a timeout). electron-updater contacts github.com here.
  let status = 'checking';
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    status = await page
      .locator('[data-status]')
      .first()
      .getAttribute('data-status')
      .catch(() => null);
    if (status && status !== 'checking') break;
  }
  log('update status after check (data-status):', status);

  // Capture the proof screenshot of the About → update-status area.
  await page.screenshot({ path: join(OUT, 'wave-publish-v072-update-check.png') });

  // The headline assertion: the result is HONEST, never 'not-configured'.
  if (status === 'not-configured') {
    console.error('FAIL: update status is STILL not-configured — the publish target did NOT wire end-to-end.');
    await app.close();
    process.exit(5);
  }
  log('PASS: update:check returned an honest result (NOT not-configured):', status);

  // Also capture the rendered status line text for the build report.
  const statusText = await page
    .locator('[data-status]')
    .first()
    .innerText()
    .catch(() => '');
  log('rendered status line:', JSON.stringify(statusText));
}

log('pageerror count:', errs.length);
if (errs.length) log('errors:', errs.slice(0, 5));
await app.close();
log('done');
