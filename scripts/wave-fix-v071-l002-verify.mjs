// Backlog-Fix v0.7.1 (Diego) — L-002 visual verification of the PACKAGED v0.7.1
// binary via Playwright's _electron CDP driver (an L-002-sanctioned method;
// this agent's shell is non-interactive so OS input synthesis is unavailable).
//
// Captures, from the SHIPPED release/win-unpacked artifact:
//   1. release/wave-fix-v071-launch-shot.png  — running window, empty state
//   2. release/wave-fix-v071-es-locale.png     — Settings flipped to es-ES
//
// es-ES is the 28c regression check (Riley grew the i18n denominator to 816 keys;
// the locale switch must still flip the UI to Spanish in the packaged binary).
//
// Usage: ELECTRON_RUN_AS_NODE cleared, then node scripts/wave-fix-v071-l002-verify.mjs

import { _electron as electron } from 'playwright';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(process.cwd());
const REL = join(ROOT, 'release', 'win-unpacked');
const EXE = join(REL, 'PDF Viewer & Editor.exe');
const RES_APP = join(REL, 'resources', 'app.asar');
const OUT = join(ROOT, 'release');
const log = (...a) => console.log('[l002-v071]', ...a);

if (!existsSync(EXE)) { console.error('packaged exe not found:', EXE); process.exit(2); }

const app = await electron.launch({ executablePath: EXE, args: [RES_APP], timeout: 60000 });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);

const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

// 1. Launch / empty-state shot.
await page.screenshot({ path: join(OUT, 'wave-fix-v071-launch-shot.png') });
const heroEn = await page.locator('text=Open a PDF to get started').count().catch(() => 0);
log('launch shot captured; empty-state hero present:', heroEn > 0);

// 2. Open Settings (Ctrl+,) and switch to es-ES.
await page.keyboard.press('Control+Comma');
await page.waitForTimeout(1200);
const dialogCount = await page.getByRole('dialog').count().catch(() => 0);
log('settings dialog open:', dialogCount > 0);

const langSelect = page.locator('select').filter({ has: page.locator('option[value="es-ES"]') }).first();
const hasLangPicker = await langSelect.count().catch(() => 0);
log('language picker (es-ES option) present:', hasLangPicker > 0);

if (hasLangPicker > 0) {
  await langSelect.selectOption('es-ES');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, 'wave-fix-v071-es-locale.png') });
  const spanishHit = await page.locator('text=/Idioma|Privacidad|Actualiz|Herramientas|Ajustes|Configuraci|Cancelar|Cerrar/i').count().catch(() => 0);
  log('es-ES shot captured; visible Spanish strings:', spanishHit);
}

log('pageerror count:', errs.length);
if (errs.length) log('errors:', errs.slice(0, 5));
await app.close();
log('done');
