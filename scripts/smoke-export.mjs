// Manual smoke harness for Phase 6 export — bypasses the broken vitest
// environment (Node 24 + vitest 1.6 test-discovery regression) by directly
// exercising the engine + writers + handlers via dynamic import.
//
// Run: `npx tsx scripts/smoke-export.mjs`

import { createLayoutExtractor } from '../src/main/export/layout-extract.ts';
import { createTableDetector } from '../src/main/export/table-detect.ts';
import { createImageExtractor, OPS_NAMES } from '../src/main/export/image-extract.ts';
import {
  createDocxWriter,
} from '../src/main/export/writers/docx-writer.ts';
import {
  createXlsxWriter,
} from '../src/main/export/writers/xlsx-writer.ts';
import {
  createPptxWriter,
} from '../src/main/export/writers/pptx-writer.ts';
import {
  createImageWriter,
} from '../src/main/export/writers/image-writer.ts';
import {
  createExportEngine,
  writeAtomic,
} from '../src/main/export/export-engine.ts';
import { handleExportListFormats } from '../src/ipc/handlers/export-list-formats.ts';
import { handleExportToDocx } from '../src/ipc/handlers/export-to-docx.ts';
import { handleExportCancelJob } from '../src/ipc/handlers/export-cancel-job.ts';
import { handleDialogPickExportOutputPath } from '../src/ipc/handlers/dialog-pick-export-output-path.ts';

const PAGE = { widthPt: 612, heightPt: 792 };
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
}

// ---- layout-extract ----------------------------------------------------------
const extract = createLayoutExtractor();
check('layout: empty page returns null', extract.extract({ items: [] }, PAGE) === null);

const single = extract.extract({
  items: [{
    str: 'Hello world',
    transform: [12, 0, 0, 12, 72, 720],
    width: 80,
    height: 12,
    fontName: 'Helvetica',
  }]
}, PAGE);
check('layout: single line → 1 paragraph', single && single.paragraphs.length === 1);
check('layout: LayoutRect non-null', single && single.paragraphs[0].rect !== null);

const headingDoc = extract.extract({
  items: [
    { str: 'Heading', transform: [24, 0, 0, 24, 72, 740], width: 100, height: 24, fontName: 'Helvetica' },
    { str: 'Body 1', transform: [10, 0, 0, 10, 72, 680], width: 150, height: 10, fontName: 'Helvetica' },
    { str: 'Body 2', transform: [10, 0, 0, 10, 72, 660], width: 150, height: 10, fontName: 'Helvetica' },
    { str: 'Body 3', transform: [10, 0, 0, 10, 72, 640], width: 150, height: 10, fontName: 'Helvetica' },
  ]
}, PAGE);
const h1 = headingDoc && headingDoc.paragraphs.find(p => p.heading === 'H1');
check('layout: H1 detected by 1.8x font-size', !!h1);

const bold = extract.extract({
  items: [{ str: 'Bold', transform: [12, 0, 0, 12, 72, 720], width: 50, height: 12, fontName: 'Helvetica-Bold' }]
}, PAGE);
check('layout: bold font detected', bold && bold.paragraphs[0].fontHints.bold === true);

const multi = extract.extract({
  items: [
    { str: 'Left col 1', transform: [12, 0, 0, 12, 72, 720], width: 100, height: 12, fontName: 'Helvetica' },
    { str: 'Left col 2', transform: [12, 0, 0, 12, 72, 700], width: 100, height: 12, fontName: 'Helvetica' },
    { str: 'Right col 1', transform: [12, 0, 0, 12, 350, 720], width: 100, height: 12, fontName: 'Helvetica' },
    { str: 'Right col 2', transform: [12, 0, 0, 12, 350, 700], width: 100, height: 12, fontName: 'Helvetica' },
  ]
}, PAGE);
check('layout: multi-column detected', multi && multi.columnsDetected === 2);

// ---- table-detect ------------------------------------------------------------
const detect = createTableDetector();
check('table: zero segments returns []', detect.detect([], { items: [] }, PAGE).length === 0);

const segs = [
  { x1: 100, y1: 400, x2: 300, y2: 400 },
  { x1: 100, y1: 450, x2: 300, y2: 450 },
  { x1: 100, y1: 500, x2: 300, y2: 500 },
  { x1: 100, y1: 400, x2: 100, y2: 500 },
  { x1: 200, y1: 400, x2: 200, y2: 500 },
  { x1: 300, y1: 400, x2: 300, y2: 500 },
];
const tables = detect.detect(segs, {
  items: [
    { str: 'A', transform: [10, 0, 0, 10, 110, 470], width: 10, height: 10, fontName: 'Helvetica' },
    { str: 'B', transform: [10, 0, 0, 10, 210, 470], width: 10, height: 10, fontName: 'Helvetica' },
    { str: 'C', transform: [10, 0, 0, 10, 110, 420], width: 10, height: 10, fontName: 'Helvetica' },
    { str: 'D', transform: [10, 0, 0, 10, 210, 420], width: 10, height: 10, fontName: 'Helvetica' },
  ]
}, PAGE);
check('table: 2x2 grid detected', tables.length === 1 && tables[0].rows === 2 && tables[0].columns === 2);
check('table: cells populated from text content', tables[0]?.cells[0][0]?.text?.includes('A'));

const diag = detect.detect([
  { x1: 0, y1: 0, x2: 100, y2: 100 },
], { items: [] }, PAGE);
check('table: diagonal-only inputs rejected (fail-soft)', diag.length === 0);

// ---- image-extract -----------------------------------------------------------
const png = (rgba, w, h) => {
  const out = new Uint8Array(8);
  out[0] = 0x89; out[1] = 0x50; out[2] = 0x4e; out[3] = 0x47;
  out[4] = w & 0xff; out[5] = h & 0xff; out[6] = rgba.length & 0xff; out[7] = 0;
  return out;
};
const imgExtract = createImageExtractor(png);
const opList = {
  fnArray: [OPS_NAMES.save, OPS_NAMES.transform, OPS_NAMES.paintImageXObject, OPS_NAMES.restore],
  argsArray: [[], [100, 0, 0, 100, 50, 200], ['Im0'], []],
};
const objs = { get: (n) => n === 'Im0' ? { data: new Uint8Array(64 * 64 * 3), width: 64, height: 64, kind: 'rgb' } : null };
const imgs = imgExtract.extract(opList, objs, PAGE);
check('image: XObject extracted at CTM-determined rect', imgs.length === 1 && imgs[0].rect.x === 50);

// 4x4 → too small
const tinyList = { fnArray: [OPS_NAMES.transform, OPS_NAMES.paintImageXObject], argsArray: [[100, 0, 0, 100, 0, 0], ['tiny']] };
const tinyObjs = { get: () => ({ data: new Uint8Array(4 * 4 * 3), width: 4, height: 4, kind: 'rgb' }) };
const tinyImgs = imgExtract.extract(tinyList, tinyObjs, PAGE);
check('image: <8x8 px skipped', tinyImgs.length === 0);

// ---- list-formats handler ----------------------------------------------------
const fmts = await handleExportListFormats({});
check('handler: listFormats returns 6 formats', fmts.ok && fmts.value.formats.length === 6);
check('handler: docx defaults to layout-preserving', fmts.ok && fmts.value.formats.find(f => f.format === 'docx').defaultQualityTier === 'layout-preserving');
check('handler: xlsx defaults to text-only (Q-D)', fmts.ok && fmts.value.formats.find(f => f.format === 'xlsx').defaultQualityTier === 'text-only');

// ---- cancel-job handler ------------------------------------------------------
const cancelInvalid = await handleExportCancelJob({ jobId: 'abc' });
check('handler: cancel rejects non-numeric jobId', !cancelInvalid.ok && cancelInvalid.error === 'invalid_payload');

const cancelMissing = await handleExportCancelJob({ jobId: 99999 });
check('handler: cancel returns job_not_found when missing', !cancelMissing.ok && cancelMissing.error === 'job_not_found');

// ---- dialog handler ----------------------------------------------------------
const dlgCancel = await handleDialogPickExportOutputPath(
  { defaultBasename: 'doc', format: 'docx' },
  { showSaveDialog: async () => ({ canceled: true }), sanitizePath: (p) => String(p) },
);
check('handler: dialog returns outputPath: null on cancel', dlgCancel.ok && dlgCancel.value.outputPath === null);

const dlgPick = await handleDialogPickExportOutputPath(
  { defaultBasename: 'doc', format: 'pptx' },
  { showSaveDialog: async () => ({ canceled: false, filePath: 'C:\\out\\doc.pptx' }), sanitizePath: (p) => String(p) },
);
check('handler: dialog returns sanitized path', dlgPick.ok && dlgPick.value.outputPath === 'C:\\out\\doc.pptx');

const dlgBad = await handleDialogPickExportOutputPath(
  { defaultBasename: '../sneaky', format: 'docx' },
  { showSaveDialog: async () => ({ canceled: true }), sanitizePath: (p) => String(p) },
);
check('handler: dialog rejects path-separator in basename', !dlgBad.ok);

// ---- handleExportToDocx end-to-end ------------------------------------------
const syntheticEngine = {
  async runJob(spec, onProgress) {
    onProgress({ jobId: spec.jobId, format: spec.format, phase: 'starting', totalPages: 1 });
    return {
      ok: true,
      value: {
        summary: {
          jobId: spec.jobId,
          format: 'docx',
          qualityTier: 'layout-preserving',
          pageCount: 1,
          durationMs: 100,
          outputBasename: 'out.docx',
          outputDirHint: 'tmp',
          outputSizeBytes: 1024,
          contentStats: { paragraphsExtracted: 5, tablesDetected: 1, imagesEmbedded: 2 },
          perPageProgress: null,
        },
        outputPaths: [spec.outputPath],
      },
    };
  },
};
const commonDeps = {
  engine: syntheticEngine,
  getBytes: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  getPageCount: () => 10,
  getDocHash: () => 'abc',
  exportJobsRepo: null,
  emitProgress: () => {},
  getMaxQueueSize: () => 50,
  getActiveJobCount: () => 0,
};

const docxOk = await handleExportToDocx(
  { handle: 1, pageRange: { start: 0, end: 0 }, qualityTier: 'layout-preserving', includeAnnotations: false, pageSize: 'auto', outputPath: '/tmp/out.docx' },
  commonDeps,
);
check('handler: toDocx happy path', docxOk.ok && docxOk.value.summary.contentStats !== null);

const docxBadTier = await handleExportToDocx(
  { handle: 1, pageRange: { start: 0, end: 0 }, qualityTier: 'high-fidelity', includeAnnotations: false, pageSize: 'auto', outputPath: '/tmp/out.docx' },
  commonDeps,
);
check('handler: toDocx rejects non-enum qualityTier', !docxBadTier.ok && docxBadTier.error === 'invalid_payload');

const docxBadRange = await handleExportToDocx(
  { handle: 1, pageRange: { start: 0, end: 999 }, qualityTier: 'layout-preserving', includeAnnotations: false, pageSize: 'auto', outputPath: '/tmp/out.docx' },
  commonDeps,
);
check('handler: toDocx rejects out-of-range pages', !docxBadRange.ok && docxBadRange.error === 'page_range_out_of_range');

const docxQueueFull = await handleExportToDocx(
  { handle: 1, pageRange: { start: 0, end: 0 }, qualityTier: 'layout-preserving', includeAnnotations: false, pageSize: 'auto', outputPath: '/tmp/out.docx' },
  { ...commonDeps, getActiveJobCount: () => 50, getMaxQueueSize: () => 50 },
);
check('handler: toDocx rejects queue_full', !docxQueueFull.ok && docxQueueFull.error === 'queue_full');

// ---- writeAtomic helper ------------------------------------------------------
let written = [];
let renamed = [];
let unlinked = [];
const fsRecorder = {
  async writeFile(p, b) { written.push({ path: p, size: b.length }); },
  async rename(from, to) { renamed.push({ from, to }); },
  async unlink(p) { unlinked.push(p); },
  async access() {},
};
await writeAtomic('/tmp/foo.docx', new Uint8Array([1, 2, 3]), fsRecorder);
check('engine: writeAtomic writes temp then renames', written[0]?.path === '/tmp/foo.docx.export-temp' && renamed[0]?.to === '/tmp/foo.docx');

// ---- writer recorder dispatch -----------------------------------------------
const docxLib = {
  lastChildren: null,
  async compose(opts) { this.lastChildren = opts.children; return new Uint8Array([0x50, 0x4b]); },
};
const docxWriter = createDocxWriter(docxLib);
await docxWriter.write({
  pageCount: 1,
  pageRange: { start: 0, end: 0 },
  pages: [{
    pageIndex: 0,
    pageSize: PAGE,
    text: {
      paragraphs: [{
        text: 'Heading',
        rect: { x: 72, y: 740, w: 100, h: 24 },
        heading: 'H1',
        alignment: 'left',
        fontHints: { bold: true },
      }],
      columnsDetected: 1,
    },
    tables: [],
    images: [],
    annotations: [],
  }],
}, { pageSize: 'auto', includeAnnotations: false, qualityTier: 'layout-preserving' });
check('writer: docx Heading1 mapped correctly', docxLib.lastChildren[0].spec.heading === 'Heading1');
check('writer: docx bold passed through', docxLib.lastChildren[0].spec.bold === true);

console.log('\n===== SUMMARY =====');
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`Passed: ${passed} / ${results.length}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
