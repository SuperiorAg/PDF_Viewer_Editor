// Wave 25 Diego — produce a real .xlsx file via the packaged export engine
// from the EXTRACTED app.asar. This is a "binary-faithful" companion to the
// L-002 launch screenshot: it proves the packaged export-bootstrap CJS
// shim actually works end-to-end by invoking the SAME bytes that ship in
// release/win-unpacked/resources/app.asar.
//
// Strategy:
//   1. asar extract resources/app.asar to a temp dir
//   2. require() the extracted dist/main/export/export-bootstrap.js
//   3. Build an in-memory PDF source with text spans (the layout-extract
//      input shape — bypasses pdf.js)
//   4. Call the engine's xlsx writer directly
//   5. Write the bytes to release/wave-25-v060-xlsx-output.xlsx
//   6. Verify file size > 0 and signature begins with "PK" (xlsx == zip)

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const RELEASE_DIR = join(process.cwd(), 'release');
const ASAR = join(RELEASE_DIR, 'win-unpacked', 'resources', 'app.asar');
const EXTRACT_DIR = join(tmpdir(), 'wave25-asar-extract-' + Date.now());
const OUT_XLSX = join(RELEASE_DIR, 'wave-25-v060-xlsx-output.xlsx');

if (!existsSync(ASAR)) {
  console.error('FAIL: asar not found:', ASAR);
  process.exit(1);
}

console.log('Extracting asar to', EXTRACT_DIR);
mkdirSync(EXTRACT_DIR, { recursive: true });
execSync(`npx asar extract "${ASAR}" "${EXTRACT_DIR}"`, { stdio: 'inherit' });

const bootstrapPath = join(EXTRACT_DIR, 'dist', 'main', 'export', 'export-bootstrap.js');
if (!existsSync(bootstrapPath)) {
  console.error('FAIL: export-bootstrap.js missing in asar:', bootstrapPath);
  process.exit(2);
}
const siblingPkg = join(EXTRACT_DIR, 'dist', 'main', 'export', 'package.json');
if (!existsSync(siblingPkg)) {
  console.error('FAIL: sibling package.json missing in asar:', siblingPkg);
  process.exit(3);
}
const pkgScope = JSON.parse(readFileSync(siblingPkg, 'utf8'));
if (pkgScope.type !== 'commonjs') {
  console.error('FAIL: sibling package.json wrong type:', pkgScope);
  process.exit(4);
}
console.log('PASS: dist/main/export/package.json scope =', pkgScope.type);

// Patch the extracted package.json to NOT have type:module so the bootstrap
// loads cleanly via require from this Node CLI session.
// Actually the sibling package.json overrides — try direct require.

const requireFromExtract = createRequire(join(EXTRACT_DIR, 'dist', 'main', 'index.js'));
// node_modules from the extracted asar must be on the resolution path. asar
// extract preserves node_modules verbatim, so the createRequire above
// should find them.

let bootstrap;
try {
  bootstrap = requireFromExtract('./export/export-bootstrap.js');
} catch (e) {
  console.error('FAIL: require export-bootstrap.js threw:', e.message);
  process.exit(5);
}
console.log('PASS: export-bootstrap.js loaded; exports =', Object.keys(bootstrap).sort().join(', '));

const { bootstrapExportEngine } = bootstrap;
if (typeof bootstrapExportEngine !== 'function') {
  console.error('FAIL: bootstrapExportEngine is not a function');
  process.exit(6);
}

// Stub source-loader: a PageSourceLoader (per export-engine.ts interface)
// that returns a minimal text-content payload per page.
const stubSourceLoader = {
  async getPageSize(_pageIndex) {
    return { widthPt: 612, heightPt: 792 };
  },
  async getTextContent(pageIndex) {
    return {
      items: [
        {
          str: `Wave 25 v0.6.0 packaged xlsx evidence (page ${pageIndex + 1})`,
          transform: [12, 0, 0, 12, 72, 720],
          width: 320,
          height: 12,
          fontName: 'Helvetica',
        },
        {
          str: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
          transform: [10, 0, 0, 10, 72, 700],
          width: 280,
          height: 10,
          fontName: 'Helvetica',
        },
      ],
    };
  },
  async getOperatorList(_pageIndex) {
    return { fnArray: [], argsArray: [] };
  },
  async getImageResolver(_pageIndex) {
    return { resolve: async () => null };
  },
  async getLineSegments(_pageIndex) {
    return [];
  },
};

const rasterizeStub = async () => {
  throw new Error('rasterize not used for xlsx');
};

const engine = bootstrapExportEngine(stubSourceLoader, rasterizeStub);
console.log('PASS: engine constructed; methods =', Object.keys(engine).sort().join(', '));

// Drive the xlsx writer end-to-end (ExportJobSpec per src/main/export/types.ts).
const job = {
  jobId: 1,
  docHash: 'wave25evidence',
  sourceBytes: new Uint8Array(0), // text-only path doesn't read bytes (no images)
  pageCount: 2,
  format: 'xlsx',
  qualityTier: 'text-only',
  pageRange: { start: 0, end: 1 },
  includeAnnotations: false,
  outputPath: OUT_XLSX,
  perFormat: { format: 'xlsx' },
};

const onProgress = (e) => {
  console.log(`  progress: ${e.phase} ${e.pageIndex ?? ''}`);
};

try {
  const result = await engine.runJob(job, onProgress);
  console.log('PASS: engine.runJob returned:', JSON.stringify(result, null, 2).slice(0, 400));
  if (!result.ok) {
    console.error('FAIL: engine returned ok:false:', JSON.stringify(result.failure));
    process.exit(7);
  }
} catch (e) {
  console.error('FAIL: engine.runJob threw:', e.message);
  console.error(e.stack);
  process.exit(7);
}

if (!existsSync(OUT_XLSX)) {
  console.error('FAIL: output xlsx not written');
  process.exit(8);
}
const stat = statSync(OUT_XLSX);
console.log(`PASS: output xlsx size = ${stat.size} bytes`);
const head = readFileSync(OUT_XLSX).slice(0, 4);
const sig = head.toString('hex');
// xlsx = zip = PK\x03\x04
if (sig !== '504b0304') {
  console.error(`FAIL: xlsx signature mismatch (expected 504b0304, got ${sig})`);
  process.exit(9);
}
console.log('PASS: xlsx ZIP signature 504b0304 (PK) verified');

console.log('');
console.log('================================================================');
console.log('Wave 25 v0.6.0 packaged xlsx export evidence:');
console.log('  Output: ' + OUT_XLSX);
console.log('  Size:   ' + stat.size + ' bytes');
console.log('  Source: packaged app.asar (extracted to ' + EXTRACT_DIR + ')');
console.log('================================================================');

// Cleanup extract dir.
try { rmSync(EXTRACT_DIR, { recursive: true, force: true }); } catch {}
