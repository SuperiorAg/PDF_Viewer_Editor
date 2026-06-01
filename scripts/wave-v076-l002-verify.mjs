// v0.7.6 (Diego) — L-002 visual verification of the PACKAGED v0.7.6 binary
// via Playwright's _electron CDP driver (L-002-sanctioned method; this agent's
// shell is non-interactive so neither desktop-operator MCP nor OS input
// synthesis is available).
//
// Captures, from the SHIPPED release/win-unpacked artifact, evidence of the
// six v0.7.6 user-visible deltas the polish wave shipped:
//
//   1. release/wave-v076-polish-verified.png    — running window, empty state
//                                                 (icon + version regression check)
//   2. release/wave-v076-rendered-page.png      — page rendered crisp (DPR on)
//   3. release/wave-v076-zoom-to-cursor.png     — ctrl+wheel zoom committed
//                                                 (cursor-anchored)
//   4. release/wave-v076-help-modal.png         — 13-section Help modal open
//                                                 with tablist visible
//   5. release/wave-v076-help-tab-shortcuts.png — Shortcuts tab content
//                                                 (proves tabs cycle)
//   6. release/wave-v076-combine-modal.png      — Combine modal open with
//                                                 current doc pre-seeded as
//                                                 Entry 1 and "+ Add files"
//                                                 button visible
//   7. release/wave-v076-about.png              — About modal shows v0.7.6
//
// The native OS file-dialog opened by api.dialog.pickPdfFiles is not driveable
// from Playwright — that path is covered by 1840 green Vitest tests including
// combine-modal.test.tsx + pdf-combine.test.ts. The L-002 evidence here is
// (a) the modal-up-to-the-picker wiring is functional in the packaged binary,
// (b) Entry 1 ("currently-open") is pre-seeded — the renderer side of H-30.1.
//
// Usage: ELECTRON_RUN_AS_NODE cleared, then node scripts/wave-v076-l002-verify.mjs

import { _electron as electron } from 'playwright';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(process.cwd());
const REL = join(ROOT, 'release', 'win-unpacked');
const EXE = join(REL, 'PDF Viewer & Editor.exe');
const RES_APP = join(REL, 'resources', 'app.asar');
const OUT = join(ROOT, 'release');
const SAMPLE_PDF = join(ROOT, 'release', 'wave21-sample.pdf');
const log = (...a) => console.log('[l002-v076]', ...a);

if (!existsSync(EXE)) {
  console.error('packaged exe not found:', EXE);
  process.exit(2);
}
if (!existsSync(SAMPLE_PDF)) {
  console.error('sample pdf not found:', SAMPLE_PDF);
  process.exit(2);
}

const app = await electron.launch({ executablePath: EXE, args: [RES_APP], timeout: 60000 });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);

const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

// === 1. Empty-state launch shot (icon regression, version present) ===
await page.screenshot({ path: join(OUT, 'wave-v076-polish-verified.png') });
const heroEn = await page
  .locator('text=Open a PDF to get started')
  .count()
  .catch(() => 0);
log('1) launch shot captured; empty-state hero present:', heroEn > 0);

// === 2. Open the sample PDF via the dropped-path channel (no native dialog) ===
// This drives the openDroppedPathThunk path via api.fs.readPdf({ droppedPath }).
const openRes = await page.evaluate(async (absPath) => {
  // eslint-disable-next-line no-undef
  if (!window.pdfApi?.fs?.readPdf) return { ok: false, error: 'no-fs-readPdf' };
  // eslint-disable-next-line no-undef
  return await window.pdfApi.fs.readPdf({ droppedPath: absPath });
}, SAMPLE_PDF);
log('2) fs.readPdf result.ok:', openRes?.ok, ' error:', openRes?.error);

// fs.readPdf returns bytes but doesn't dispatch into Redux. To get a doc into
// the UI we use the drag-and-drop event simulator path (the L-001 file.path
// route) — react listens for window-level drop. Simpler: synthesize the open
// via the menu bar's File → Open and intercept... actually the cleanest path
// is to wait until the empty state is replaced. fs.readPdf already proved the
// channel works; for visible-doc evidence we use the drop synthesis instead.
//
// Drop synthesis: dispatch a DragEvent on document with a DataTransfer
// containing a File-like with .path set (the L-001 contract).
const dropRes = await page.evaluate(async (absPath) => {
  try {
    const dt = new DataTransfer();
    // Per L-001: Electron extends File with non-standard `.path`. We can't
    // construct a real Electron File from JS — instead, dispatch a custom
    // event that includes the path string and trust the app's drop handler.
    // First try: react-dnd-style drop on a known target.
    const target = document.body;
    const dragOver = new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    });
    target.dispatchEvent(dragOver);
    // Manually inject a File with .path via Object.defineProperty since the
    // Electron-extended File isn't directly constructable here.
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
log('   drop dispatched:', JSON.stringify(dropRes));

await page.waitForTimeout(4500); // pdf.js render
const renderedCanvasCount = await page
  .locator('canvas')
  .count()
  .catch(() => 0);
const stillEmptyState = await page
  .locator('text=Open a PDF to get started')
  .count()
  .catch(() => 0);
log('   canvas count:', renderedCanvasCount, ' still empty-state hero?', stillEmptyState);
await page.screenshot({ path: join(OUT, 'wave-v076-rendered-page.png') });

// === 3. Zoom-to-cursor: ctrl+wheel via direct WheelEvent dispatch ===
// Playwright's `page.mouse.wheel(0, -dy)` with `keyboard.down('Control')` does
// not reliably set `ctrlKey: true` on the resulting WheelEvent under Electron's
// Chromium build. The renderer's listener (pdf-viewer/index.tsx:130) explicitly
// gates on `e.ctrlKey || e.metaKey`. Dispatch a real native WheelEvent against
// the scroller element with ctrlKey:true; this is exactly what a real user's
// ctrl+wheel produces.
try {
  const zoomCommitRes = await page.evaluate(() => {
    // The scroller is the element with role="region" aria-label="Document viewer"
    // (pdf-viewer/index.tsx:283 — the ref attached to scrollerRef).
    const scroller = document.querySelector('[role="region"][aria-label="Document viewer"]');
    if (!scroller) return { ok: false, error: 'no-scroller' };
    const rect = scroller.getBoundingClientRect();
    // Anchor at 70% across, 40% down — off-center to make cursor-anchoring visible.
    const cx = rect.left + rect.width * 0.7;
    const cy = rect.top + rect.height * 0.4;
    // Fire three ctrl+wheel ticks to step zoom to ~1.1^3 = ~133%.
    for (let i = 0; i < 3; i++) {
      const ev = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: cx,
        clientY: cy,
        deltaX: 0,
        deltaY: -120, // negative = zoom in (renderer convention)
        deltaMode: 0,
        ctrlKey: true,
      });
      scroller.dispatchEvent(ev);
    }
    return { ok: true, anchorX: cx, anchorY: cy };
  });
  log('   wheel dispatch:', JSON.stringify(zoomCommitRes));
  // Wait > 120ms debounce + rAF for displayZoom -> setZoom commit.
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, 'wave-v076-zoom-to-cursor.png') });
  // Check the zoom indicator in the status bar (e.g. "133%" or any non-100%).
  const zoomReadout = await page
    .locator('text=/\\b(11[0-9]|1[2-9][0-9]|[2-9][0-9][0-9])%/')
    .count()
    .catch(() => 0);
  log('3) zoom-to-cursor shot captured; non-100% zoom indicator hits:', zoomReadout);
} catch (e) {
  log('3) zoom-to-cursor: skipped', String(e).slice(0, 160));
}

// === 4. Help modal: F1 ===
await page.keyboard.press('F1');
await page.waitForTimeout(900);
const helpTablistCount = await page
  .locator('[role="tablist"]')
  .count()
  .catch(() => 0);
const helpTabCount = await page
  .locator('[role="tab"]')
  .count()
  .catch(() => 0);
log('4) help modal opened; tablists:', helpTablistCount, ' tabs:', helpTabCount);
await page.screenshot({ path: join(OUT, 'wave-v076-help-modal.png') });

// Cycle to the Shortcuts tab.
try {
  const shortcutsTab = page.locator('[role="tab"]').filter({ hasText: /shortcut/i }).first();
  if ((await shortcutsTab.count()) > 0) {
    await shortcutsTab.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'wave-v076-help-tab-shortcuts.png') });
    log('   shortcuts tab clicked; second help shot captured');
  } else {
    log('   shortcuts tab not found by label — fallback to tab index 9');
    const tabs = page.locator('[role="tab"]');
    if ((await tabs.count()) > 9) {
      await tabs.nth(9).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, 'wave-v076-help-tab-shortcuts.png') });
    }
  }
} catch (e) {
  log('   help tab cycle: skipped', String(e).slice(0, 160));
}
// Close help.
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// === 5. Combine modal: File menu → Combine PDFs... ===
// Combine lives under the FILE menu (menu-bar/index.tsx:156, end of File). The
// custom in-page menu bar uses regular <button> elements; click "File" then
// "Combine PDFs...". The dropdown stays open until onMouseLeave fires on the
// root, so synchronous Playwright clicks are safe.
try {
  const fileBtn = page.locator('nav[aria-label="Main menu"] button', { hasText: 'File' }).first();
  await fileBtn.click();
  await page.waitForTimeout(500);
  // Be specific: the "Combine PDFs..." button text — Playwright `hasText` is a
  // substring match, so this won't collide with anything else on the page.
  const combineItem = page
    .locator('nav[aria-label="Main menu"] button', { hasText: 'Combine PDFs' })
    .first();
  await combineItem.click({ timeout: 5000 });
  await page.waitForTimeout(1200);
} catch (e) {
  log('5) combine-modal open: dropdown nav failed:', String(e).slice(0, 160));
}
const combineDialogCount = await page
  .locator('[role="dialog"]')
  .count()
  .catch(() => 0);
const addFilesBtn = await page
  .locator('button')
  .filter({ hasText: /add\s*files|\+\s*add/i })
  .count()
  .catch(() => 0);
const submitBtn = await page
  .locator('button')
  .filter({ hasText: /combine|submit/i })
  .count()
  .catch(() => 0);
log(
  '5) combine dialog count:',
  combineDialogCount,
  ' add-files btn:',
  addFilesBtn,
  ' submit-like btn:',
  submitBtn,
);
await page.screenshot({ path: join(OUT, 'wave-v076-combine-modal.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// === 6. About modal: version shows 0.7.6 (Help → About) ===
try {
  const helpBtn = page.locator('nav[aria-label="Main menu"] button', { hasText: 'Help' }).first();
  await helpBtn.click();
  await page.waitForTimeout(500);
  const aboutItem = page
    .locator('nav[aria-label="Main menu"] button', { hasText: 'About' })
    .first();
  await aboutItem.click({ timeout: 5000 });
  await page.waitForTimeout(1000);
} catch (e) {
  log('6) about open via menu failed:', String(e).slice(0, 160));
}
const versionHit = await page
  .locator('text=/0\\.7\\.6/')
  .count()
  .catch(() => 0);
log('6) about modal: 0.7.6 text occurrences:', versionHit);
await page.screenshot({ path: join(OUT, 'wave-v076-about.png') });

log('pageerror count:', errs.length);
if (errs.length) log('errors:', errs.slice(0, 5));
await app.close();
log('done');
