// v0.7.9 (Diego) — L-002 visual verification of the PACKAGED v0.7.9 binary
// via Playwright's _electron CDP driver.
//
// v0.7.9 ships a SINGLE forms-contrast fix (Riley 89ccb56). The L-002 evidence
// targets the readability of the Forms surfaces that had unreadable dark-on-dark
// buttons in v0.7.8, plus regression checks for v0.7.8 (one menu bar) and the
// About modal version string.
//
// Captures:
//   1. release/wave-v079-forms-tab-readable.png      — Forms panel default state
//   2. release/wave-v079-mail-merge-modal.png        — Mail-merge modal
//   3. release/wave-v079-form-designer-palette.png   — Form Designer palette
//   4. release/wave-v079-only-one-menu-bar.png       — Regression: one menu bar
//   5. release/wave-v079-about-v079.png              — About shows 0.7.9

import { _electron as electron } from 'playwright';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(process.cwd());
const REL = join(ROOT, 'release', 'win-unpacked');
const EXE = join(REL, 'PDF Viewer & Editor.exe');
const RES_APP = join(REL, 'resources', 'app.asar');
const OUT = join(ROOT, 'release');
const SAMPLE_PDF = join(ROOT, 'release', 'wave21-sample.pdf');
const log = (...a) => console.log('[l002-v079]', ...a);

if (!existsSync(EXE)) {
  console.error('packaged exe not found:', EXE);
  process.exit(2);
}
if (!existsSync(SAMPLE_PDF)) {
  console.error('sample pdf not found:', SAMPLE_PDF);
  process.exit(2);
}

const srgbToLin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const parseRgb = (str) => {
  const m = String(str).match(/(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const lum = (rgb) =>
  0.2126 * srgbToLin(rgb[0]) + 0.7152 * srgbToLin(rgb[1]) + 0.0722 * srgbToLin(rgb[2]);
const ratio = (rgb1, rgb2) => {
  const l1 = lum(rgb1);
  const l2 = lum(rgb2);
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
};
const fmtRatio = (fg, bgChain) => {
  const fgRgb = parseRgb(fg);
  if (!fgRgb) return 'N/A (fg unparsed)';
  // Walk the bg chain for first non-transparent.
  for (const bg of bgChain) {
    const bgRgb = parseRgb(bg);
    if (bgRgb && bgRgb.reduce((s, n) => s + n, 0) > 0 && !String(bg).match(/, *0\)/))
      return ratio(fgRgb, bgRgb).toFixed(2);
  }
  return 'N/A (transparent chain)';
};

const app = await electron.launch({ executablePath: EXE, args: [RES_APP], timeout: 60000 });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);

const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

// === 0. Regression — only ONE menu bar ===
const customMenuCount = await page.locator('nav[aria-label="Main menu"]').count().catch(() => 0);
log('0) custom in-page menu bar count:', customMenuCount, '(expect 1)');
await page.screenshot({ path: join(OUT, 'wave-v079-only-one-menu-bar.png') });

// === Open the sample PDF via drag-drop synthesis (L-001 file.path path) ===
const dropRes = await page.evaluate(async (absPath) => {
  try {
    const dt = new DataTransfer();
    const target = document.body;
    const dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
    target.dispatchEvent(dragOver);
    const fakeFile = new File([new Uint8Array(0)], 'wave21-sample.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(fakeFile, 'path', { value: absPath, configurable: true });
    dt.items.add(fakeFile);
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    target.dispatchEvent(drop);
    return { dispatched: true };
  } catch (e) {
    return { dispatched: false, error: String(e) };
  }
}, SAMPLE_PDF);
log('   pdf drop dispatched:', JSON.stringify(dropRes));
await page.waitForTimeout(4500);

// === 1. Click Forms sidebar tab ===
try {
  const formsTab = page.locator('#sidebar-tab-id-forms');
  if ((await formsTab.count()) > 0) {
    await formsTab.click();
    await page.waitForTimeout(900);
    log('1) Forms tab clicked');
  } else {
    log('1) WARN: #sidebar-tab-id-forms not found');
  }
} catch (e) {
  log('1) Forms tab click error:', String(e).slice(0, 200));
}

// Move cursor away so no hover state.
await page.mouse.move(0, 0);
await page.waitForTimeout(400);

// Sample contrast of Forms panel buttons at rest.
const formsContrast = await page.evaluate(() => {
  const panel = document.querySelector('#sidebar-panel-forms') || document.body;
  const buttons = Array.from(panel.querySelectorAll('button'));
  return buttons.slice(0, 14).map((btn) => {
    const cs = getComputedStyle(btn);
    // Walk up parents to record bg chain (first non-transparent wins).
    const bgChain = [];
    let el = btn;
    while (el && bgChain.length < 6) {
      bgChain.push(getComputedStyle(el).backgroundColor);
      el = el.parentElement;
    }
    return {
      text: (btn.textContent || '').trim().slice(0, 50),
      color: cs.color,
      background: cs.backgroundColor,
      bgChain,
      disabled: btn.disabled,
    };
  });
});

log('1) Forms-panel button contrast samples (at rest):');
formsContrast.forEach((b) => {
  const r = fmtRatio(b.color, b.bgChain);
  log('   ', JSON.stringify({ text: b.text, color: b.color, bg: b.background, contrast: r, disabled: b.disabled }));
});

await page.screenshot({ path: join(OUT, 'wave-v079-forms-tab-readable.png') });

// === 2. Mail-merge modal ===
let mmOpened = false;
try {
  // Look for mail-merge button in Forms panel
  const mmBtn = page
    .locator('#sidebar-panel-forms button')
    .filter({ hasText: /mail[\s-]?merge/i })
    .first();
  if ((await mmBtn.count()) > 0 && !(await mmBtn.isDisabled().catch(() => false))) {
    await mmBtn.click();
    await page.waitForTimeout(900);
    mmOpened = (await page.locator('[role="dialog"]').count()) > 0;
    log('2) mail-merge modal opened:', mmOpened);
  } else {
    // Fallback — open via Tools menu if it has a mail-merge entry
    log('2) mail-merge button not found or disabled in panel; trying Tools menu');
    const toolsBtn = page.locator('nav[aria-label="Main menu"] button', { hasText: /^Tools$/ }).first();
    if ((await toolsBtn.count()) > 0) {
      await toolsBtn.click();
      await page.waitForTimeout(400);
      const mm = page
        .locator('nav[aria-label="Main menu"] button')
        .filter({ hasText: /mail[\s-]?merge/i })
        .first();
      if ((await mm.count()) > 0) {
        await mm.click();
        await page.waitForTimeout(900);
        mmOpened = (await page.locator('[role="dialog"]').count()) > 0;
        log('   mail-merge via Tools menu opened:', mmOpened);
      }
    }
  }
} catch (e) {
  log('2) mail-merge open error:', String(e).slice(0, 200));
}

if (mmOpened) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const dlgContrast = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return [];
    const btns = Array.from(dlg.querySelectorAll('button')).slice(0, 10);
    return btns.map((b) => {
      const cs = getComputedStyle(b);
      const bgChain = [];
      let el = b;
      while (el && bgChain.length < 6) {
        bgChain.push(getComputedStyle(el).backgroundColor);
        el = el.parentElement;
      }
      return { text: (b.textContent || '').trim().slice(0, 40), color: cs.color, background: cs.backgroundColor, bgChain, disabled: b.disabled };
    });
  });
  log('   mail-merge button contrast samples:');
  dlgContrast.forEach((b) => {
    const r = fmtRatio(b.color, b.bgChain);
    log('   ', JSON.stringify({ text: b.text, color: b.color, bg: b.background, contrast: r, disabled: b.disabled }));
  });
}
await page.screenshot({ path: join(OUT, 'wave-v079-mail-merge-modal.png') });
if (mmOpened) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

// === 3. Form Designer palette ===
let designerOpened = false;
try {
  // Re-click Forms tab in case modal close changed focus.
  await page.locator('#sidebar-tab-id-forms').click().catch(() => {});
  await page.waitForTimeout(400);

  const designerLabels = [/design/i, /create field/i, /new field/i, /add field/i];
  for (const lbl of designerLabels) {
    const b = page.locator('#sidebar-panel-forms button').filter({ hasText: lbl }).first();
    if ((await b.count()) > 0 && !(await b.isDisabled().catch(() => false))) {
      await b.click();
      await page.waitForTimeout(800);
      designerOpened = true;
      log('3) form-designer toggle clicked:', lbl);
      break;
    }
  }
  if (!designerOpened) log('3) no form-designer toggle clickable in panel');
} catch (e) {
  log('3) form-designer error:', String(e).slice(0, 200));
}

await page.mouse.move(0, 0);
await page.waitForTimeout(300);

// Sample any palette buttons inside the Forms panel
const paletteContrast = await page.evaluate(() => {
  const root =
    document.querySelector('[class*="formDesigner"], [class*="form-designer"], [class*="palette"]') ||
    document.querySelector('#sidebar-panel-forms') ||
    document.body;
  const btns = Array.from(root.querySelectorAll('button')).slice(0, 14);
  return btns.map((b) => {
    const cs = getComputedStyle(b);
    const bgChain = [];
    let el = b;
    while (el && bgChain.length < 6) {
      bgChain.push(getComputedStyle(el).backgroundColor);
      el = el.parentElement;
    }
    return { text: (b.textContent || '').trim().slice(0, 40), color: cs.color, background: cs.backgroundColor, bgChain, disabled: b.disabled };
  });
});
log('   form-designer / palette contrast samples:');
paletteContrast.forEach((b) => {
  const r = fmtRatio(b.color, b.bgChain);
  log('   ', JSON.stringify({ text: b.text, color: b.color, bg: b.background, contrast: r, disabled: b.disabled }));
});
await page.screenshot({ path: join(OUT, 'wave-v079-form-designer-palette.png') });

// === 5. About modal — version 0.7.9 ===
try {
  // Close any open dialog/dropdown first
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const helpBtn = page.locator('nav[aria-label="Main menu"] button', { hasText: 'Help' }).first();
  await helpBtn.click();
  await page.waitForTimeout(500);
  const aboutItem = page
    .locator('nav[aria-label="Main menu"] button', { hasText: 'About' })
    .first();
  await aboutItem.click({ timeout: 5000 });
  await page.waitForTimeout(1000);
} catch (e) {
  log('5) about open via menu failed:', String(e).slice(0, 200));
}
const versionHit = await page.locator('text=/0\\.7\\.9/').count().catch(() => 0);
log('5) about modal: 0.7.9 text occurrences:', versionHit);
await page.screenshot({ path: join(OUT, 'wave-v079-about-v079.png') });

log('pageerror count:', errs.length);
if (errs.length) log('errors:', errs.slice(0, 5));
await app.close();
log('done');
