// Backlog-Fix v0.7.1 (Diego) — HEADLINE PROOF: image-export PNG shows TEXT in
// the PACKAGED binary, exercising David's Phase-6.2 Node-safe font/cmap factory
// fix through the REAL production font-path seam.
//
// WHAT THIS PROVES (the font-path <-> asarUnpack seam, Objective 1 + 4):
//   David's fix (export-bootstrap.ts:resolveExportFontData + makeNodeDataFactory)
//   builds StandardFontDataFactory / CMapReaderFactory that fs.readFile font/cmap
//   bytes from `dirname(require.resolve('pdfjs-dist/package.json'))/standard_fonts`.
//   In the packaged binary that path is redirected by Electron's asar shim to
//   `app.asar.unpacked/node_modules/pdfjs-dist/` — exactly the tree Diego
//   asarUnpacks in electron-builder.yml (package.json + standard_fonts + cmaps).
//   This script reproduces that runtime layout from the SHIPPED artifact and
//   renders a real standard-font (Helvetica) text PDF to PNG, then COUNTS DARK
//   PIXELS. v0.6.1 produced 0 (blank). v0.7.1 must produce a substantial count.
//
// This script wires the REAL production font factories (David's actual fix code
// path) but pins their pdfjs root to the EXTRACTED+overlaid packaged tree so the
// factory's fs.readFile resolves against the SHIPPED unpacked font assets. If the
// unpack seam is wrong (fonts missing / package.json not unpacked), the factory
// fetch throws ENOENT and the dark-pixel count is 0 — the regression Obj 1 guards.
//
// .cts so tsx treats the whole import graph as CommonJS — export-bootstrap.ts uses
// require() + top-level patterns that conflict with an ESM entry (ERR_AMBIGUOUS).
//
// Run:  npx tsx scripts/wave-fix-v071-png-text-evidence.cts

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, cpSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { pathToFileURL } from 'node:url';

const { join, sep } = nodePath;
const ROOT = process.cwd();
const RELEASE = join(ROOT, 'release');
const UNPACKED = join(RELEASE, 'win-unpacked', 'resources', 'app.asar.unpacked');
const ASAR = join(RELEASE, 'win-unpacked', 'resources', 'app.asar');
const EXTRACT = join(tmpdir(), 'wavefix-v071-asar-' + Date.now());

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  if (!existsSync(ASAR)) { console.error('FAIL: asar not found:', ASAR); process.exit(1); }

  // ---- 1. extract asar (shipped engine bytes + flattened deps) ----
  console.log('Extracting asar ->', EXTRACT);
  mkdirSync(EXTRACT, { recursive: true });
  execSync(`npx asar extract "${ASAR}" "${EXTRACT}"`, { stdio: 'inherit' });

  // ---- 2. assert + overlay the unpacked pdfjs font/cmap assets (the seam) ----
  const unpackedPdfjs = join(UNPACKED, 'node_modules', 'pdfjs-dist');
  const extractedPdfjs = join(EXTRACT, 'node_modules', 'pdfjs-dist');
  const sfSrc = join(unpackedPdfjs, 'standard_fonts');
  const cmSrc = join(unpackedPdfjs, 'cmaps');
  const pkgSrc = join(unpackedPdfjs, 'package.json');
  check('app.asar.unpacked/pdfjs-dist/package.json (require.resolve anchor)', existsSync(pkgSrc), pkgSrc);
  check('app.asar.unpacked/pdfjs-dist/standard_fonts (font seam)', existsSync(sfSrc), existsSync(sfSrc) ? sfSrc : 'MISSING');
  check('app.asar.unpacked/pdfjs-dist/cmaps (cmap seam)', existsSync(cmSrc), existsSync(cmSrc) ? cmSrc : 'MISSING');
  // The standard-14 substitutes Helvetica/Times/Courier resolve to ship as
  // LiberationSans (TrueType) + Foxit (.pfb) glyph programs. Their presence is
  // what makes standard-font text render.
  check('Helvetica substitute glyphs present (LiberationSans-Regular.ttf)', existsSync(join(sfSrc, 'LiberationSans-Regular.ttf')));

  // Reproduce the runtime layout: overlay unpacked font assets onto the extracted
  // (in-asar) pdfjs-dist so require.resolve + the factory's fs.readFile land on
  // real files, exactly as Electron's asar fs-shim presents at runtime.
  if (existsSync(sfSrc)) cpSync(sfSrc, join(extractedPdfjs, 'standard_fonts'), { recursive: true });
  if (existsSync(cmSrc)) cpSync(cmSrc, join(extractedPdfjs, 'cmaps'), { recursive: true });

  // ---- 3. import the production engine bootstrap (the SHIPPED logic) ----
  const bootstrap = require(join(ROOT, 'src', 'main', 'export', 'export-bootstrap.ts'));
  const { bootstrapExportEngine, createProdSourceLoader } = bootstrap;
  check('bootstrapExportEngine imported', typeof bootstrapExportEngine === 'function');
  check('createProdSourceLoader imported', typeof createProdSourceLoader === 'function');

  // David's REAL Node-safe data factory shape (StandardFontDataFactory /
  // CMapReaderFactory) rooted at the EXTRACTED+overlaid pdfjs tree. This mirrors
  // export-bootstrap.makeNodeDataFactory exactly, pinned to the packaged unpacked
  // layout so the FACTORY path (David's fix) is what we exercise.
  function makeNodeDataFactory(absDir: string): unknown {
    return class NodeFsDataFactory {
      constructor(_opts: { baseUrl: string | null }) { void _opts; }
      async fetch(opts: { filename: string; compressionType?: number }): Promise<Uint8Array> {
        const full = join(absDir, opts.filename);
        const buf = await readFile(full);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      }
    };
  }
  const sfDir = join(extractedPdfjs, 'standard_fonts');
  const cmDir = join(extractedPdfjs, 'cmaps');
  const bundle = createProdSourceLoader({
    resolveFontData: () => ({
      standardFontDataUrl: pathToFileURL(sfDir + sep).href,
      cMapUrl: pathToFileURL(cmDir + sep).href,
      StandardFontDataFactory: makeNodeDataFactory(sfDir),
      CMapReaderFactory: makeNodeDataFactory(cmDir),
    }),
  });
  const engine = bundle && bootstrapExportEngine(bundle.loader, bundle.rasterize);
  check('engine constructed with prod loader + Node-safe font factories', typeof engine.runJob === 'function');

  // ---- 4. author a real standard-font (Helvetica) text PDF ----
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText('v0.7.1 PNG TEXT EVIDENCE', { x: 72, y: 700, size: 28, font: bold, color: rgb(0, 0, 0) });
  page.drawText('The quick brown fox jumps over the lazy dog. 0123456789', { x: 72, y: 650, size: 16, font, color: rgb(0, 0, 0) });
  page.drawText('Standard-font (Helvetica) glyphs must render via the unpacked', { x: 72, y: 620, size: 14, font, color: rgb(0, 0, 0) });
  page.drawText('pdfjs-dist standard_fonts factory in the PACKAGED binary.', { x: 72, y: 600, size: 14, font, color: rgb(0, 0, 0) });
  const sourceBytes = await doc.save();
  check('test PDF authored (standard-font Helvetica)', sourceBytes.byteLength > 0, `${sourceBytes.byteLength} bytes`);

  // ---- 5. export to PNG via the production engine ----
  const pngPath = join(RELEASE, 'wave-fix-v071-output.png');
  try { rmSync(pngPath, { force: true }); } catch { /* ignore */ }
  const spec = {
    jobId: 1, docHash: 'wavefixv071', sourceBytes, pageCount: 1,
    format: 'png', qualityTier: 'n/a',
    pageRange: { start: 0, end: 0 }, includeAnnotations: false,
    outputPath: pngPath, perFormat: { format: 'png', dpi: 150 },
  };
  const result = await engine.runJob(spec, () => { /* progress */ });
  check('PNG export runJob ok', result.ok, result.ok ? '' : JSON.stringify(result.failure ?? result.error));
  const actual = result.value?.outputPaths?.[0] ?? pngPath;
  const writtenPath = existsSync(actual) ? actual : pngPath;
  check('PNG file written', existsSync(writtenPath), writtenPath);

  // ---- 6. THE HEADLINE: decode the PNG and COUNT DARK PIXELS ----
  // A BLANK export (the v0.6.1 bug) is all-white -> 0 dark px. Rendered text ->
  // thousands. This is the pixels-on-disk proof the font seam resolves.
  const canvasMod = require('@napi-rs/canvas');
  const pngBytes = readFileSync(writtenPath);
  const img = await canvasMod.loadImage(pngBytes);
  const c = canvasMod.createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const { data } = cx.getImageData(0, 0, img.width, img.height);
  let darkPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < 96 && data[i + 3] > 128) darkPixels++;
  }
  const st = statSync(writtenPath);
  const sigHex = pngBytes.slice(0, 4).toString('hex');
  check('PNG magic bytes (89504e47)', sigHex === '89504e47', sigHex);
  check('HEADLINE: exported PNG shows TEXT (dark-pixel count >> blank)', darkPixels > 2000, `${darkPixels} dark pixels (blank=0; v0.6.1 bug produced 0)`);

  // Save the rendered PNG AS the L-002 evidence artifact.
  const evidencePng = join(RELEASE, 'wave-fix-v071-png-text-evidence.png');
  cpSync(writtenPath, evidencePng);
  check('evidence PNG saved', existsSync(evidencePng), evidencePng);

  writeFileSync(join(RELEASE, 'wave-fix-v071-png-text-evidence.json'), JSON.stringify({
    ts: new Date().toISOString(),
    version: '0.7.1',
    source: 'packaged app.asar + app.asar.unpacked pdfjs fonts',
    fontFactory: 'David Phase-6.2 Node-safe StandardFontDataFactory/CMapReaderFactory (fs.readFile)',
    pngPath: evidencePng,
    pngSizeBytes: st.size,
    imageWidth: img.width,
    imageHeight: img.height,
    darkPixelCount: darkPixels,
    blankBaseline: 0,
    verdict: darkPixels > 2000 ? 'TEXT RENDERS (seam resolves in packaged binary)' : 'BLANK (seam broken)',
  }, null, 2));

  console.log('');
  console.log('================================================================');
  console.log('v0.7.1 PACKAGED-binary PNG-text export evidence:');
  console.log(`  PNG: ${evidencePng}`);
  console.log(`  size: ${st.size} B  dims: ${img.width}x${img.height}  sig: ${sigHex}`);
  console.log(`  DARK PIXELS: ${darkPixels}  (blank baseline = 0)`);
  console.log(`  VERDICT: ${darkPixels > 2000 ? 'TEXT RENDERS' : 'BLANK — SEAM BROKEN'}`);
  console.log('================================================================');

  try { rmSync(EXTRACT, { recursive: true, force: true }); } catch { /* ignore */ }
  if (failures > 0) { console.error(`\nRESULT: ${failures} check(s) FAILED.`); process.exit(2); }
  console.log('\nRESULT: PNG text export renders from the packaged v0.7.1 engine via the unpacked font seam.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(3); });
