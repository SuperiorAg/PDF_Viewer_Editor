// Wave 29 (Diego) — L-002 About-modal capture (Objective 7.4).
// Launches the packaged v0.7.0 binary, opens Help -> About, captures the
// version (0.7.0) + the honest update-status placeholder. Companion to
// wave-29-l002-verify.mjs.

import { _electron as electron } from 'playwright';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const REL = join(ROOT, 'release', 'win-unpacked');
const EXE = join(REL, 'PDF Viewer & Editor.exe');
const RES_APP = join(REL, 'resources', 'app.asar');
const OUT = join(ROOT, 'release');

function log(...a) { console.log('[about]', ...a); }

const app = await electron.launch({ executablePath: EXE, args: [RES_APP], timeout: 60000 });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);

const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

// Open the Help menu (top in-renderer menu-bar). It is a click-to-open custom
// dropdown. The app persists the locale across launches, so the trigger may be
// "Help" (en-US) OR "Ayuda" (es-ES). Match either.
const helpBtn = page.getByText(/^(help|ayuda)$/i).first();
const helpCount = await helpBtn.count().catch(() => 0);
log('Help/Ayuda menu trigger present:', helpCount > 0);
if (helpCount > 0) {
  await helpBtn.click();
  await page.waitForTimeout(600);
  // Click the "About" / "Acerca de" item.
  const aboutItem = page.getByText(/^(about|acerca de)/i).first();
  if (await aboutItem.count().catch(() => 0) > 0) {
    await aboutItem.click();
    await page.waitForTimeout(1800);
  } else {
    log('About/Acerca-de item not found in open menu');
  }
}

const dialog = await page.getByRole('dialog').count().catch(() => 0);
log('About dialog open:', dialog > 0);

await page.screenshot({ path: join(OUT, 'wave-29-v070-about.png') });
log('captured About modal');

const versionHit = await page.getByText('0.7.0', { exact: false }).count().catch(() => 0);
log('version 0.7.0 visible:', versionHit > 0);
// The honest not-configured copy (placeholder); should NOT say "up to date".
const notConfigured = await page.locator('text=/placeholder|not configured|no configurado|will not download|won.t download|configurad/i').count().catch(() => 0);
log('honest update placeholder copy visible:', notConfigured);
const fakeUpToDate = await page.getByText(/up to date|actualizado/i).count().catch(() => 0);
log('FAKE "up to date" present (should be 0):', fakeUpToDate);
// Acknowledgments must name the Phase-7 MIT deps.
const ack = await page.locator('text=/i18next|electron-updater/i').count().catch(() => 0);
log('Phase-7 dep acknowledgments visible:', ack);

log('pageerror count:', errs.length);
if (errs.length) log('errors:', errs.slice(0, 5));
await app.close();
log('done');
