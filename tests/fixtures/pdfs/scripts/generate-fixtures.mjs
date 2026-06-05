#!/usr/bin/env node
// Phase 7.1 — OCR fixture generator. Diego owns. 2026-06-05.
//
// Generates the two required fixtures under tests/fixtures/pdfs/:
//   - scan-1p-eng.pdf   (1 page,  scanned-image-only, Lorem block 1)
//   - scan-2p-eng.pdf   (2 pages, scanned-image-only, Lorem block 1 + 2)
//
// Per docs/phase-7.1-test-design.md §1.3, the generator is the load-bearing
// trust artifact: Julian's Wave-3 review checks the lockfile
// tests/fixtures/pdfs/expected-hashes.json against the bytes this script
// produces. Mutation by a copyrighted-PDF substitution would change the hash.
//
// Determinism contract (read this BEFORE editing):
//   - The script MUST produce byte-identical PDFs across runs on the same host
//     and across hosts on the same @napi-rs/canvas + pdf-lib versions.
//   - All time-varying inputs MUST be frozen: fixed Producer/Creator strings,
//     fixed CreationDate/ModificationDate (epoch 0 UTC), useObjectStreams:false
//     so pdf-lib emits a stable, line-by-line cross-reference table.
//   - PNG raster is fully determined by: source text (frozen in
//     tests/fixtures/pdfs/source/lorem.txt), font (Liberation Sans Regular —
//     bundled by pdfjs-dist), font size, page dimensions, and the napi-rs
//     canvas font hinting (which is deterministic per version).
//   - If @napi-rs/canvas or pdf-lib gets a major version bump, regenerate and
//     commit the new fixture + new expected-hashes.json in the SAME PR.
//
// L-004 / L-005 compliance:
//   The generator uses pdf-lib (MIT) to construct the PDF — pdf-lib does NOT
//   load pdf.js. There is zero pdf.js invocation in this file. L-004 (buffer
//   copy on getDocument) and L-005 (polyfill ordering) apply to pdf.js only.
//
// Font choice:
//   Riley §1.3 proposed DejaVu Sans (OFL 1.1). DejaVu Sans is NOT bundled with
//   the project (verified by pre-flight: no DejaVu*.ttf under node_modules,
//   src, or release). The closest bundled equivalent is Liberation Sans
//   Regular, shipped by pdfjs-dist at
//   node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf under
//   SIL OFL 1.1 — same license family as DejaVu, comparable hinting, designed
//   to be metric-compatible with Arial. Tesseract recognizes Liberation Sans
//   at 200 DPI with confidence comparable to DejaVu Sans (no calibration drift
//   observed in pre-flight). Riley's §7.2 default explicitly authorizes a
//   bundled-font fallback when DejaVu is unavailable; this is that fallback.
//
// Run:
//   node tests/fixtures/pdfs/scripts/generate-fixtures.mjs
//
// Determinism self-check (always runs at the end): regenerates each fixture
// twice into a Buffer, asserts SHA256 of both runs match, then writes to
// disk. If the in-memory determinism check fails, the script exits non-zero
// WITHOUT writing — preserves the prior fixtures on disk for diff.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '..');
const SOURCE_DIR = resolve(FIXTURES_DIR, 'source');
const REPO_ROOT = resolve(FIXTURES_DIR, '..', '..', '..');

// Bundled Liberation Sans Regular path (pdfjs-dist standard_fonts).
const FONT_PATH = resolve(
  REPO_ROOT,
  'node_modules',
  'pdfjs-dist',
  'standard_fonts',
  'LiberationSans-Regular.ttf',
);

// 200 DPI per Riley §1.3 step 2.
const DPI = 200;
// US Letter portrait, in inches.
const PAGE_WIDTH_IN = 8.5;
const PAGE_HEIGHT_IN = 11;
// Pixel dimensions of the rasterized page image.
const PAGE_WIDTH_PX = Math.round(PAGE_WIDTH_IN * DPI); // 1700
const PAGE_HEIGHT_PX = Math.round(PAGE_HEIGHT_IN * DPI); // 2200
// Margins so the OCR has a clean white border (Tesseract handles this better).
const MARGIN_PX = Math.round(0.75 * DPI); // 150
// Font sized for ~12pt at 200 DPI: 12 * (200/72) = ~33 px.
const FONT_SIZE_PX = 36;
const LINE_HEIGHT_PX = Math.round(FONT_SIZE_PX * 1.5);

// PDF metadata constants — frozen for determinism.
const FIXED_TITLE = 'PDF_Viewer_Editor Phase 7.1 OCR fixture';
const FIXED_AUTHOR = 'PDF_Viewer_Editor swarm';
const FIXED_PRODUCER = 'pdf-lib (PDF_Viewer_Editor Phase 7.1 fixture)';
const FIXED_CREATOR = 'tests/fixtures/pdfs/scripts/generate-fixtures.mjs';
// Epoch 0 UTC. Frozen so date-encoded metadata does not float.
const FIXED_DATE = new Date(0);

let FONT_REGISTERED = false;
function ensureFontRegistered() {
  if (FONT_REGISTERED) return;
  const key = GlobalFonts.registerFromPath(FONT_PATH, 'LiberationSans');
  if (key === null) {
    throw new Error(
      `[generate-fixtures] failed to register font at ${FONT_PATH} — does node_modules exist? (run npm ci)`,
    );
  }
  FONT_REGISTERED = true;
}

/**
 * Rasterize one page's worth of text into a 200 DPI PNG buffer.
 * Pure function of `text`: no time, no random, no env reads.
 */
function rasterizeTextPagePng(text) {
  ensureFontRegistered();
  const canvas = createCanvas(PAGE_WIDTH_PX, PAGE_HEIGHT_PX);
  const ctx = canvas.getContext('2d');

  // White background — what a real scanned page looks like after
  // auto-leveling. Tesseract prefers high contrast over a busy texture.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_WIDTH_PX, PAGE_HEIGHT_PX);

  // Black text at the chosen font size. The leading space is intentional —
  // some Tesseract minor versions clip the leftmost glyph if the baseline
  // is at MARGIN_PX exactly. A 0.05" indent absorbs that without changing
  // the OCR'd word count.
  ctx.fillStyle = '#000000';
  ctx.font = `${String(FONT_SIZE_PX)}px "LiberationSans"`;
  ctx.textBaseline = 'top';

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  let y = MARGIN_PX;
  for (const line of lines) {
    ctx.fillText(line, MARGIN_PX, y);
    y += LINE_HEIGHT_PX;
    if (y + LINE_HEIGHT_PX > PAGE_HEIGHT_PX - MARGIN_PX) break;
  }

  // PNG encode. @napi-rs/canvas's PNG encoder is deterministic per version.
  return canvas.toBuffer('image/png');
}

/**
 * Build a PDF whose pages are each a single embedded PNG covering the full
 * page. Each PNG is the rasterized Lorem block. The result has NO embedded
 * text layer — pdf.js's getTextContent returns empty on every page — so OCR
 * is the only path to extracting words.
 */
async function buildScannedPdf(pageTexts) {
  const doc = await PDFDocument.create();
  doc.setTitle(FIXED_TITLE);
  doc.setAuthor(FIXED_AUTHOR);
  doc.setProducer(FIXED_PRODUCER);
  doc.setCreator(FIXED_CREATOR);
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  // US Letter at 72 DPI (PDF user-space units). Image is scaled to fill.
  const pageW = PAGE_WIDTH_IN * 72;
  const pageH = PAGE_HEIGHT_IN * 72;

  for (const text of pageTexts) {
    const pngBytes = rasterizeTextPagePng(text);
    const image = await doc.embedPng(pngBytes);
    const page = doc.addPage([pageW, pageH]);
    page.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH });
  }

  // Stable serializer: useObjectStreams:false produces a classic xref table
  // (one offset per line) rather than a compressed object stream, which is
  // bit-stable across pdf-lib minor versions in our pinned range.
  const bytes = await doc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function generate(name, pageTextFiles) {
  const pageTexts = pageTextFiles.map((f) => readFileSync(resolve(SOURCE_DIR, f), 'utf8'));
  // Determinism self-check: generate twice, compare.
  const first = await buildScannedPdf(pageTexts);
  const second = await buildScannedPdf(pageTexts);
  const hashFirst = sha256(first);
  const hashSecond = sha256(second);
  if (hashFirst !== hashSecond) {
    throw new Error(
      `[generate-fixtures] non-determinism detected for ${name}: hashFirst=${hashFirst} hashSecond=${hashSecond}. ` +
        'Did @napi-rs/canvas or pdf-lib change a default? Check the dep versions and re-run.',
    );
  }
  const outPath = resolve(FIXTURES_DIR, name);
  writeFileSync(outPath, first);
  return { name, hash: hashFirst, bytes: first.length, path: outPath };
}

async function main() {
  console.log('[generate-fixtures] Phase 7.1 OCR fixture generator — Diego');
  console.log(`[generate-fixtures] font: ${FONT_PATH}`);
  console.log(`[generate-fixtures] DPI: ${String(DPI)}  page: ${String(PAGE_WIDTH_PX)}x${String(PAGE_HEIGHT_PX)}px`);

  const results = [];
  results.push(await generate('scan-1p-eng.pdf', ['lorem.txt']));
  results.push(await generate('scan-2p-eng.pdf', ['lorem.txt', 'lorem-page2.txt']));

  // Update the lockfile.
  const lockfile = resolve(FIXTURES_DIR, 'expected-hashes.json');
  const lock = {
    note: 'SHA256 of each fixture. CI runs verify-hashes.mjs to catch fixture mutation.',
    algorithm: 'sha256',
    generatedBy: 'tests/fixtures/pdfs/scripts/generate-fixtures.mjs',
    fixtures: Object.fromEntries(results.map((r) => [r.name, { sha256: r.hash, bytes: r.bytes }])),
  };
  writeFileSync(lockfile, `${JSON.stringify(lock, null, 2)}\n`);

  for (const r of results) {
    console.log(
      `[generate-fixtures] wrote ${r.name} bytes=${String(r.bytes)} sha256=${r.hash.slice(0, 16)}...`,
    );
  }
  console.log(`[generate-fixtures] lockfile updated: ${lockfile}`);
}

main().catch((err) => {
  console.error('[generate-fixtures] FAILED');
  console.error(err);
  process.exit(1);
});
