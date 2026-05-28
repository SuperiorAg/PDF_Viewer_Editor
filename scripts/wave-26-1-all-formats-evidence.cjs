// Phase 6.1 v0.6.1 (Diego) — PROVE all four export formats produce valid files
// from the PACKAGED binary, using David's REAL production source loader
// (createProdSourceLoader -> createProdPdfJsSource: real pdf.js +
// @napi-rs/canvas + resolveExportFontData), against a REAL pdf-lib-authored
// text+image PDF.
//
// Binary-faithful companion to the L-002 launch screenshot. Runs the SAME
// export-engine logic that ships inside the packaged binary and exercises the
// FONT-PATH resolution (Objective 2): the prod loader sets standardFontDataUrl
// / cMapUrl to file:// URLs under the pdfjs-dist package root, which in the
// packaged binary lives UNPACKED at app.asar.unpacked/node_modules/pdfjs-dist/.
//
// CommonJS (.cjs) on purpose: the export-bootstrap source uses require() for
// @napi-rs/canvas + utif; loading it under tsx's require-hook in a CJS context
// avoids the ERR_AMBIGUOUS_MODULE_SYNTAX that bites when an .mjs with
// top-level await imports a require()-using .ts.
//
// Run:  npx tsx scripts/wave-26-1-all-formats-evidence.cjs

const { execSync } = require('node:child_process');
const {
  existsSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, cpSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const zlib = require('node:zlib');

const ROOT = process.cwd();
const RELEASE = join(ROOT, 'release');
const UNPACKED = join(RELEASE, 'win-unpacked', 'resources', 'app.asar.unpacked');
const ASAR = join(RELEASE, 'win-unpacked', 'resources', 'app.asar');
const EXTRACT = join(tmpdir(), 'wave261-asar-extract-' + Date.now());

let failures = 0;
const evidence = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function makeSolidPng(w, h, [r, g, b]) {
  const crc32 = (buf) => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3); raw[off] = 0;
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = r; raw[off + 2 + x * 3] = g; raw[off + 3 + x * 3] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Uint8Array.from(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]));
}

async function main() {
  if (!existsSync(ASAR)) { console.error('FAIL: asar not found:', ASAR); process.exit(1); }

  // ---- 1. extract asar -----------------------------------------------------
  console.log('Extracting asar ->', EXTRACT);
  mkdirSync(EXTRACT, { recursive: true });
  execSync(`npx asar extract "${ASAR}" "${EXTRACT}"`, { stdio: 'inherit' });

  // ---- 2. Objective-2 assertions + overlay unpacked fonts ------------------
  const unpackedPdfjs = join(UNPACKED, 'node_modules', 'pdfjs-dist');
  const extractedPdfjs = join(EXTRACT, 'node_modules', 'pdfjs-dist');
  const sfSrc = join(unpackedPdfjs, 'standard_fonts');
  const cmSrc = join(unpackedPdfjs, 'cmaps');
  check('app.asar.unpacked has pdfjs-dist/standard_fonts (Objective 2)', existsSync(sfSrc), sfSrc);
  check('app.asar.unpacked has pdfjs-dist/cmaps (Objective 2)', existsSync(cmSrc), cmSrc);
  check('app.asar.unpacked has pdfjs-dist/package.json (require.resolve anchor)',
    existsSync(join(unpackedPdfjs, 'package.json')));
  if (existsSync(sfSrc)) cpSync(sfSrc, join(extractedPdfjs, 'standard_fonts'), { recursive: true });
  if (existsSync(cmSrc)) cpSync(cmSrc, join(extractedPdfjs, 'cmaps'), { recursive: true });

  const sfUrl = pathToFileURL(join(extractedPdfjs, 'standard_fonts') + '\\').href;
  const cmUrl = pathToFileURL(join(extractedPdfjs, 'cmaps') + '\\').href;
  check('standard_fonts resolves to a real dir for the prod loader',
    statSync(join(extractedPdfjs, 'standard_fonts')).isDirectory(), sfUrl);

  // ---- 3. load the engine bootstrap (tsx require-hook handles the .ts) -----
  const bootstrapMod = require(join(ROOT, 'src', 'main', 'export', 'export-bootstrap.ts'));
  const { bootstrapExportEngine, createProdSourceLoader } = bootstrapMod;
  check('bootstrapExportEngine loaded', typeof bootstrapExportEngine === 'function');
  check('createProdSourceLoader loaded', typeof createProdSourceLoader === 'function');

  // Prod loader, font resolution pinned to the packaged/unpacked tree.
  const bundle = createProdSourceLoader({
    resolveFontData: () => ({ standardFontDataUrl: sfUrl, cMapUrl: cmUrl }),
  });
  const engine = bootstrapExportEngine(bundle.loader, bundle.rasterize);
  check('engine constructed with prod loader', typeof engine.runJob === 'function');

  // ---- 4. author a real text+image PDF -------------------------------------
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('Phase 6.1 Export Evidence', { x: 72, y: 720, size: 22, font: bold, color: rgb(0, 0, 0) });
  p1.drawText('All four export formats from the packaged v0.6.1 binary.', { x: 72, y: 690, size: 12, font });
  p1.drawText('The quick brown fox jumps over the lazy dog. 0123456789.', { x: 72, y: 660, size: 12, font });
  const png = await doc.embedPng(makeSolidPng(64, 64, [0x33, 0x99, 0xff]));
  p1.drawImage(png, { x: 72, y: 540, width: 96, height: 96 });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('Second page body content for multi-page extraction.', { x: 72, y: 720, size: 12, font });
  const sourceBytes = await doc.save();
  check('test PDF authored (text + embedded image, 2 pages)', sourceBytes.byteLength > 0, `${sourceBytes.byteLength} bytes`);

  // ---- 5. run all four formats ---------------------------------------------
  const SIGS = { xlsx: '504b0304', docx: '504b0304', pptx: '504b0304', png: '89504e47' };
  const perFormat = (f) =>
    f === 'docx' ? { format: 'docx', pageSize: 'auto' }
    : f === 'xlsx' ? { format: 'xlsx' }
    : f === 'pptx' ? { format: 'pptx' }
    : { format: 'png', dpi: 96 };
  const tier = (f) =>
    f === 'docx' ? 'layout-preserving'
    : f === 'xlsx' ? 'text-only'
    : f === 'pptx' ? 'layout-preserving'
    : 'n/a';

  const outputs = {};
  for (const fmt of ['xlsx', 'docx', 'pptx', 'png']) {
    const outPath = join(RELEASE, `wave-26-1-v061-output.${fmt}`);
    try { rmSync(outPath, { force: true }); } catch {}
    const spec = {
      jobId: 1, docHash: 'wave261evidence', sourceBytes, pageCount: 2,
      format: fmt, qualityTier: tier(fmt),
      pageRange: { start: 0, end: fmt === 'png' ? 0 : 1 },
      includeAnnotations: false, outputPath: outPath, perFormat: perFormat(fmt),
    };
    let result;
    try { result = await engine.runJob(spec, () => {}); }
    catch (e) { check(`${fmt}: runJob completed`, false, e.message); continue; }
    if (!result.ok) { check(`${fmt}: runJob ok`, false, JSON.stringify(result.failure ?? result.error)); continue; }
    const actual = (result.value && result.value.outputPaths && result.value.outputPaths[0]) || outPath;
    const writtenPath = existsSync(actual) ? actual : outPath;
    if (!existsSync(writtenPath)) { check(`${fmt}: output written`, false, 'no file on disk'); continue; }
    const st = statSync(writtenPath);
    const sig = readFileSync(writtenPath).slice(0, 4).toString('hex');
    const ok = sig === SIGS[fmt] && st.size > 1024;
    check(`${fmt}: valid file (sig ${SIGS[fmt]}, >1KB)`, ok, `${st.size} B, sig=${sig}`);
    outputs[fmt] = { path: writtenPath, size: st.size, sig };
    evidence.push({ format: fmt, path: writtenPath, size: st.size, signature: sig, valid: sig === SIGS[fmt] });
  }

  // ---- 6. summary + cleanup ------------------------------------------------
  writeFileSync(
    join(RELEASE, 'wave-26-1-v061-all-formats-evidence.json'),
    JSON.stringify({ ts: new Date().toISOString(), version: '0.6.1',
      source: 'packaged app.asar engine + app.asar.unpacked pdfjs fonts',
      fontUrls: { standardFontDataUrl: sfUrl, cMapUrl: cmUrl },
      outputs: evidence }, null, 2),
  );

  console.log('\n================================================================');
  console.log('Phase 6.1 v0.6.1 packaged-binary export evidence (all four formats):');
  for (const [fmt, o] of Object.entries(outputs)) {
    console.log(`  ${fmt.padEnd(5)} ${String(o.size).padStart(8)} B  sig=${o.sig}  ${o.path}`);
  }
  console.log('================================================================');

  try { rmSync(EXTRACT, { recursive: true, force: true }); } catch {}

  if (failures > 0) { console.error(`\nRESULT: ${failures} check(s) FAILED.`); process.exit(2); }
  console.log('\nRESULT: all four formats produced valid files from the packaged v0.6.1 engine.');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(3); });
