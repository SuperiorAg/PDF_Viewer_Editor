#!/usr/bin/env node
// Phase 7.2 — Signed-PDF e2e fixture generator. Diego owns. 2026-06-10.
// Closes Julian finding 7.2.4 (PAdES+OCR invalidation backref unobserved at
// the e2e tier). Companion to scripts/generate-fixtures.mjs which produces the
// canonical scanned-image-only fixtures; this script extends the same recipe
// to a 1-page scanned PDF + an /FT /Sig field, then runs node-signpdf against
// a deterministic synthetic test-only PFX to embed a real PAdES signature.
//
// Output:
//   - tests/fixtures/pdfs/signed-1p-eng.pdf
//   - tests/fixtures/pdfs/keys/test-signing.pfx  (test-only, never use in prod)
//
// Determinism contract (read this BEFORE editing):
//   - The committed PFX is the source of truth. If keys/test-signing.pfx
//     already exists, the script reuses it verbatim. Regeneration is only
//     triggered when the file is absent (e.g. a contributor deleted it).
//   - On regeneration, node-forge's PRNG is replaced with a SeedablePRNG
//     wrapper keyed off a fixed seed. RSA key generation, PKCS#12 envelope
//     encryption, and cert serial number are all driven by this PRNG, so a
//     fresh PFX is byte-identical to the prior committed one.
//   - Signing: node-signpdf v3 calls `new Date()` inside its CMS authenticated
//     attributes for the signingTime field. We monkey-patch globalThis.Date
//     with a fixed-epoch shim FOR THE DURATION of the sign() call, restoring
//     the real Date in a finally block. With a deterministic PFX + a fixed
//     signing time + PKCS#1 v1.5 padding (node-forge's default, which is
//     deterministic unlike PSS), the signed bytes are deterministic too.
//   - All time-varying inputs are frozen the same way generate-fixtures.mjs
//     freezes them: epoch-0 CreationDate/ModificationDate, fixed Producer,
//     fixed Creator, useObjectStreams:false serializer.
//
// Determinism is verified at the end via the same two-pass in-memory check
// as generate-fixtures.mjs: produce the signed PDF twice, assert SHA256 match,
// then write to disk. Non-determinism aborts WITHOUT writing.
//
// L-004 / L-005 compliance: this generator uses pdf-lib (page authoring),
// @napi-rs/canvas (rasterize), node-forge (cert / PFX), and node-signpdf
// (CMS envelope). ZERO pdf.js calls. L-004 (getDocument data copy) and L-005
// (polyfill ordering before await import) apply to pdf.js call sites only.
//
// Run:
//   node tests/fixtures/pdfs/scripts/generate-signed-fixture.mjs
//
// To force PFX regeneration (rare — only when dep versions change the on-wire
// encoding), delete keys/test-signing.pfx first and re-run.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import forgeNs from 'node-forge';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import signpdfPkg from 'node-signpdf';

const forge = forgeNs.default ?? forgeNs;
const signpdf = signpdfPkg.default ?? signpdfPkg;
const { plainAddPlaceholder } = signpdfPkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '..');
const SOURCE_DIR = resolve(FIXTURES_DIR, 'source');
const KEYS_DIR = resolve(FIXTURES_DIR, 'keys');
const REPO_ROOT = resolve(FIXTURES_DIR, '..', '..', '..');
const PFX_PATH = resolve(KEYS_DIR, 'test-signing.pfx');
const FIXTURE_NAME = 'signed-1p-eng.pdf';
const FIXTURE_PATH = resolve(FIXTURES_DIR, FIXTURE_NAME);
const HASHES_PATH = resolve(FIXTURES_DIR, 'expected-hashes.json');

// Bundled Liberation Sans Regular path (pdfjs-dist standard_fonts) — same as
// generate-fixtures.mjs.
const FONT_PATH = resolve(
  REPO_ROOT,
  'node_modules',
  'pdfjs-dist',
  'standard_fonts',
  'LiberationSans-Regular.ttf',
);

// Page geometry — must match generate-fixtures.mjs so OCR calibration floors
// (20 words / 60% confidence) carry over identically.
const DPI = 200;
const PAGE_WIDTH_IN = 8.5;
const PAGE_HEIGHT_IN = 11;
const PAGE_WIDTH_PX = Math.round(PAGE_WIDTH_IN * DPI);
const PAGE_HEIGHT_PX = Math.round(PAGE_HEIGHT_IN * DPI);
const MARGIN_PX = Math.round(0.75 * DPI);
const FONT_SIZE_PX = 36;
const LINE_HEIGHT_PX = Math.round(FONT_SIZE_PX * 1.5);

// PDF metadata — frozen for determinism.
const FIXED_TITLE = 'PDF_Viewer_Editor Phase 7.2 signed-PDF OCR fixture';
const FIXED_AUTHOR = 'PDF_Viewer_Editor swarm';
const FIXED_PRODUCER = 'pdf-lib + node-signpdf (PDF_Viewer_Editor Phase 7.2 fixture)';
const FIXED_CREATOR = 'tests/fixtures/pdfs/scripts/generate-signed-fixture.mjs';
const FIXED_DATE = new Date(0);

// Signature widget placement — top-right corner of page 1, away from the OCR
// text body. The widget is non-visual (no appearance stream); viewers render
// an empty rectangle and tesseract ignores it.
const SIG_FIELD_NAME = 'TestSignature';
const SIG_WIDGET_RECT = { x: 400, y: 700, width: 150, height: 50 };

// Test-only PFX password. NOT a secret — the PFX itself is committed under
// tests/fixtures/pdfs/keys/. Documenting it here so reviewers can re-derive
// the artifact without spelunking through the PRNG seed.
const PFX_PASSWORD = 'PDF_VIEWER_EDITOR_TEST_FIXTURE_ONLY';

// Fixed seed for the seedable PRNG that drives PFX regeneration. Any byte
// string works; the value is locked once the committed PFX is in place.
const PRNG_SEED = 'pdf-viewer-editor phase 7.2 signed-fixture deterministic seed v1 2026-06-10';

// ============================================================================
// Seedable PRNG — drives node-forge during PFX regeneration so the resulting
// bytes are deterministic. node-forge accepts a `prng` option on its
// generateKeyPair + pkcs12.toPkcs12Asn1 paths; we plug this in there.
//
// Implementation: SHA-256 in counter mode. Cryptographically weak (intentional
// — the resulting keypair is for test fixtures only and must never sign
// anything outside this repo), but deterministic and dependency-free.
// ============================================================================
function makeSeededPrng(seedStr) {
  const seed = Buffer.from(seedStr, 'utf8');
  let counter = 0;
  let buffer = Buffer.alloc(0);
  return {
    getBytesSync(n) {
      const out = Buffer.alloc(n);
      let filled = 0;
      while (filled < n) {
        if (buffer.length === 0) {
          const ctrBuf = Buffer.alloc(8);
          ctrBuf.writeBigUInt64BE(BigInt(counter), 0);
          counter += 1;
          buffer = createHash('sha256').update(seed).update(ctrBuf).digest();
        }
        const take = Math.min(buffer.length, n - filled);
        buffer.copy(out, filled, 0, take);
        buffer = buffer.subarray(take);
        filled += take;
      }
      return out.toString('binary');
    },
  };
}

// ============================================================================
// PFX generation. Runs only when keys/test-signing.pfx is absent.
// ============================================================================
function generateTestPfx() {
  console.log(
    '[generate-signed-fixture] keys/test-signing.pfx not found — regenerating with seeded PRNG',
  );
  const prng = makeSeededPrng(PRNG_SEED);

  // Generate a 2048-bit RSA keypair seeded by the deterministic PRNG.
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001, prng });

  // Build a self-signed cert. Fixed serial + fixed validity window so the
  // DER encoding is byte-identical across runs.
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.UTC(2026, 0, 1));
  // 50-year window; the e2e never checks expiry but a wide window keeps
  // node-signpdf happy even if dev clocks drift.
  cert.validity.notAfter = new Date(Date.UTC(2076, 0, 1));
  const attrs = [
    { name: 'commonName', value: 'PDF_Viewer_Editor Test Signer' },
    { name: 'countryName', value: 'US' },
    { name: 'organizationName', value: 'PDF_Viewer_Editor' },
    { shortName: 'OU', value: 'Test Fixtures' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
    },
    { name: 'extKeyUsage', clientAuth: true, codeSigning: true, emailProtection: true },
  ]);
  // Self-sign with SHA-256. PKCS#1 v1.5 padding (forge default) is
  // deterministic; PSS would not be.
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Wrap in PKCS#12 using the same seeded PRNG so envelope salts/IVs are
  // deterministic. forge's toPkcs12Asn1 also calls Date.now() once for the
  // friendlyName attribute; we patch globalThis.Date for the call.
  const realDate = globalThis.Date;
  globalThis.Date = makeFixedDateShim(realDate);
  let p12Asn1;
  try {
    p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PFX_PASSWORD, {
      friendlyName: 'pdf-viewer-editor-test-signer',
      algorithm: '3des',
      prng,
    });
  } finally {
    globalThis.Date = realDate;
  }
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();

  mkdirSync(KEYS_DIR, { recursive: true });
  writeFileSync(PFX_PATH, Buffer.from(p12Der, 'binary'));
  console.log(`[generate-signed-fixture] wrote ${PFX_PATH} (${p12Der.length} bytes)`);
}

// ============================================================================
// Page rasterizer (mirrors generate-fixtures.mjs:rasterizeTextPagePng).
// ============================================================================
let FONT_REGISTERED = false;
function ensureFontRegistered() {
  if (FONT_REGISTERED) return;
  const key = GlobalFonts.registerFromPath(FONT_PATH, 'LiberationSans');
  if (key === null) {
    throw new Error(
      `[generate-signed-fixture] failed to register font at ${FONT_PATH} — run npm ci first`,
    );
  }
  FONT_REGISTERED = true;
}

function rasterizeTextPagePng(text) {
  ensureFontRegistered();
  const canvas = createCanvas(PAGE_WIDTH_PX, PAGE_HEIGHT_PX);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_WIDTH_PX, PAGE_HEIGHT_PX);
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
  return canvas.toBuffer('image/png');
}

// ============================================================================
// PDF authoring: rasterized page + /FT /Sig field. Mirrors the hand-author
// pattern in src/main/pdf-ops/field-dict-authoring.ts:createSignaturePlaceholder
// — kept inline here so the fixture script has no dependency on src/.
// ============================================================================
async function buildUnsignedPdfWithSigField(pageText) {
  const doc = await PDFDocument.create();
  doc.setTitle(FIXED_TITLE);
  doc.setAuthor(FIXED_AUTHOR);
  doc.setProducer(FIXED_PRODUCER);
  doc.setCreator(FIXED_CREATOR);
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const pageW = PAGE_WIDTH_IN * 72;
  const pageH = PAGE_HEIGHT_IN * 72;

  const pngBytes = rasterizeTextPagePng(pageText);
  const image = await doc.embedPng(pngBytes);
  const page = doc.addPage([pageW, pageH]);
  page.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH });

  // ---- Hand-author /FT /Sig field + widget annotation ----
  const ctx = doc.context;
  const fieldDict = PDFDict.fromMapWithContext(
    new Map([
      [PDFName.of('FT'), PDFName.of('Sig')],
      [PDFName.of('T'), PDFString.of(SIG_FIELD_NAME)],
      [PDFName.of('TU'), PDFString.of(SIG_FIELD_NAME)],
      [PDFName.of('Ff'), PDFNumber.of(0)],
    ]),
    ctx,
  );
  const fieldRef = ctx.register(fieldDict);

  const widgetDict = PDFDict.withContext(ctx);
  widgetDict.set(PDFName.of('Type'), PDFName.of('Annot'));
  widgetDict.set(PDFName.of('Subtype'), PDFName.of('Widget'));
  const rectArray = PDFArray.withContext(ctx);
  rectArray.push(PDFNumber.of(SIG_WIDGET_RECT.x));
  rectArray.push(PDFNumber.of(SIG_WIDGET_RECT.y));
  rectArray.push(PDFNumber.of(SIG_WIDGET_RECT.x + SIG_WIDGET_RECT.width));
  rectArray.push(PDFNumber.of(SIG_WIDGET_RECT.y + SIG_WIDGET_RECT.height));
  widgetDict.set(PDFName.of('Rect'), rectArray);
  widgetDict.set(PDFName.of('F'), PDFNumber.of(4));
  widgetDict.set(PDFName.of('P'), page.ref);
  widgetDict.set(PDFName.of('Parent'), fieldRef);
  const widgetRef = ctx.register(widgetDict);

  const kidsArray = PDFArray.withContext(ctx);
  kidsArray.push(widgetRef);
  fieldDict.set(PDFName.of('Kids'), kidsArray);

  // Wire /AcroForm /Fields. pdf-lib's getForm().acroForm.dict.get exposes the
  // same low-level shape; reaching through doc.catalog keeps the fixture
  // independent of pdf-lib's PDFForm materialization path.
  const catalog = doc.catalog;
  let acroForm = catalog.get(PDFName.of('AcroForm'));
  if (!acroForm) {
    const fieldsArr = PDFArray.withContext(ctx);
    fieldsArr.push(fieldRef);
    acroForm = PDFDict.fromMapWithContext(
      new Map([
        [PDFName.of('Fields'), fieldsArr],
        // /SigFlags = 3 (SignaturesExist=1 | AppendOnly=2) per ISO 32000 §12.7.
        [PDFName.of('SigFlags'), PDFNumber.of(3)],
      ]),
      ctx,
    );
    catalog.set(PDFName.of('AcroForm'), acroForm);
  } else if (acroForm instanceof PDFDict) {
    let fieldsArr = acroForm.get(PDFName.of('Fields'));
    if (!(fieldsArr instanceof PDFArray)) {
      fieldsArr = PDFArray.withContext(ctx);
      acroForm.set(PDFName.of('Fields'), fieldsArr);
    }
    fieldsArr.push(fieldRef);
    acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  // Wire widget into page /Annots.
  let annots = page.node.get(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) {
    annots = PDFArray.withContext(ctx);
    page.node.set(PDFName.of('Annots'), annots);
  }
  annots.push(widgetRef);

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// ============================================================================
// Date shim — fixes new Date() / Date.now() to a fixed epoch for the duration
// of the wrapped block. node-signpdf v3 calls `new Date()` in its CMS
// authenticated-attributes (signingTime); pinning the value at epoch-0 makes
// the CMS envelope byte-deterministic.
// ============================================================================
function makeFixedDateShim(RealDate) {
  const FIXED_MS = 0;
  function FixedDate(...args) {
    if (!(this instanceof FixedDate)) return new RealDate(FIXED_MS).toString();
    if (args.length === 0) return Reflect.construct(RealDate, [FIXED_MS], FixedDate);
    return Reflect.construct(RealDate, args, FixedDate);
  }
  FixedDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(FixedDate, RealDate);
  FixedDate.now = () => FIXED_MS;
  FixedDate.parse = RealDate.parse;
  FixedDate.UTC = RealDate.UTC;
  return FixedDate;
}

// ============================================================================
// Sign with node-signpdf. The /Contents placeholder + /ByteRange [0 0 0 0]
// are added first; signpdf.sign() then locates the placeholder, computes the
// real byte-range, builds the CMS envelope, and patches the placeholder.
//
// Non-determinism sources we have to neutralize:
//
//   1. node-signpdf v3 calls `new Date()` for the signingTime CMS auth-attr.
//      Fixed via the globalThis.Date shim.
//
//   2. node-forge RSA signing applies cryptographic BLINDING (rsa.js:457-468):
//      a fresh random `r` is multiplied into the signing computation and
//      cancelled out at the end, defending against timing side-channels. The
//      random `r` is drawn from `forge.random.getBytes()` and changes every
//      call, producing a different (but still valid) ciphertext each time —
//      RSA signatures are not deterministic in this implementation even with
//      PKCS#1 v1.5 padding. Fixed by overriding `forge.random.getBytes` /
//      `getBytesSync` with our seeded PRNG for the duration of sign(). The
//      ciphertext is still cryptographically valid (the signature still
//      verifies against the public key); we just sacrifice the side-channel
//      blinding's randomness, which is acceptable for a test fixture.
// ============================================================================
function signPdf(unsignedBytes) {
  const pfxBytes = readFileSync(PFX_PATH);

  // Shim 1: Date — covers BOTH
  //   - plainAddPlaceholder -> pdfkitAddPlaceholder which writes /M (sig dict
  //     modification date) via `new Date()`, AND
  //   - signpdf.sign() which writes the CMS signingTime auth-attr.
  // We apply the shim FOR THE FULL DURATION of placeholder-add + sign so
  // both Date reads see epoch-0 deterministically.
  const realDate = globalThis.Date;
  globalThis.Date = makeFixedDateShim(realDate);

  // Shim 2: forge.random — RSA signing applies cryptographic BLINDING
  // (rsa.js:457-468): a fresh random `r` is multiplied into the signing
  // computation and cancelled out at the end as side-channel defence. Without
  // overriding `forge.random.getBytes`, the ciphertext varies per call even
  // with deterministic PKCS#1 v1.5 padding. The seeded PRNG used here is
  // distinct from the one used for PFX generation so the byte streams don't
  // collide.
  const signPrng = makeSeededPrng(`${PRNG_SEED}::sign-rsa-blinding`);
  const origGetBytes = forge.random.getBytes;
  const origGetBytesSync = forge.random.getBytesSync;
  forge.random.getBytes = (n) => signPrng.getBytesSync(n);
  forge.random.getBytesSync = (n) => signPrng.getBytesSync(n);

  let signed;
  try {
    const buffered = plainAddPlaceholder({
      pdfBuffer: unsignedBytes,
      reason: 'Phase 7.2 e2e fixture',
      location: '',
      name: 'PDF_Viewer_Editor Test Signer',
      signatureLength: 8192,
    });
    signed = signpdf.sign(buffered, pfxBytes, { passphrase: PFX_PASSWORD });
  } finally {
    globalThis.Date = realDate;
    forge.random.getBytes = origGetBytes;
    forge.random.getBytesSync = origGetBytesSync;
  }
  return Buffer.from(signed);
}

// ============================================================================
// Top-level orchestrator.
//
// HISTORICAL NOTE (Phase 7.2 7.2.5, David, 2026-06-10): an earlier version
// of this script included an `inlineSignatureDict(signedBytes)` post-pass
// that re-loaded the signed PDF, resolved /V (an indirect PDFRef as emitted
// by node-signpdf's `plainAddPlaceholder`) into its inline-dict form, and
// re-saved. The post-pass existed to work around a bug in
// `src/main/pdf-ops/pades-detect.ts` which only handled inline /V and
// silently returned [] for indirect-ref /V — meaning the production
// signature-audit invalidation backref never fired against real-world
// PAdES-signed PDFs (Acrobat / DocuSign / Adobe Sign all emit indirect /V).
// Side effect: pdf-lib's re-serialize shifted the /ByteRange offsets, so
// the resulting CMS envelope was cryptographically invalid (byte-range no
// longer covered the right bytes). The e2e didn't care because nothing
// verifies the signature, but it left an inconsistent fixture on disk.
//
// David's Phase 7.2 7.2.5 fix routes pades-detect's reads through
// `dict.lookupMaybe(name, Type)` which transparently resolves PDFRefs.
// The detector now handles both inline and indirect /V correctly, so the
// post-pass is no longer needed AND the resulting fixture's /ByteRange
// stays intact (cryptographically valid CMS — useful for any future
// signature-verify smoke test). See pades-detect.test.ts for the
// indirect-ref coverage.
// ============================================================================
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function buildSignedFixture(pageText) {
  const unsigned = await buildUnsignedPdfWithSigField(pageText);
  return signPdf(unsigned);
}

async function main() {
  console.log('[generate-signed-fixture] Phase 7.2 signed-PDF OCR fixture generator — Diego');

  if (!existsSync(PFX_PATH)) {
    generateTestPfx();
  } else {
    console.log(`[generate-signed-fixture] reusing committed PFX at ${PFX_PATH}`);
  }

  const sourcePath = resolve(SOURCE_DIR, 'lorem.txt');
  const pageText = readFileSync(sourcePath, 'utf8');

  // Two-pass determinism check — same discipline as generate-fixtures.mjs.
  const first = await buildSignedFixture(pageText);
  const second = await buildSignedFixture(pageText);
  const h1 = sha256(first);
  const h2 = sha256(second);
  if (h1 !== h2) {
    throw new Error(
      `[generate-signed-fixture] non-determinism detected: hashFirst=${h1} hashSecond=${h2}. ` +
        'Did node-signpdf or node-forge bump? Investigate the Date shim or PRNG plumbing before committing.',
    );
  }

  writeFileSync(FIXTURE_PATH, first);
  console.log(
    `[generate-signed-fixture] wrote ${FIXTURE_NAME} bytes=${String(first.length)} sha256=${h1.slice(0, 16)}...`,
  );

  // Patch expected-hashes.json — merge our entry without disturbing the
  // existing scan-1p / scan-2p rows that generate-fixtures.mjs owns.
  const lock = JSON.parse(readFileSync(HASHES_PATH, 'utf8'));
  lock.fixtures[FIXTURE_NAME] = { sha256: h1, bytes: first.length };
  writeFileSync(HASHES_PATH, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`[generate-signed-fixture] lockfile updated: ${HASHES_PATH}`);
}

main().catch((err) => {
  console.error('[generate-signed-fixture] FAILED');
  console.error(err);
  process.exit(1);
});
