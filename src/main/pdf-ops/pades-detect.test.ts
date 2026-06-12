// @vitest-environment node
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  PDFDocument,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { detectPriorPadesSignatures } from './pades-detect.js';

describe('detectPriorPadesSignatures', () => {
  it('returns empty array for a fresh blank PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const r = detectPriorPadesSignatures(doc);
    expect(r).toEqual([]);
  });

  it('returns empty array for a PDF with no AcroForm', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const r = detectPriorPadesSignatures(doc);
    expect(r).toHaveLength(0);
  });

  it('returns empty array for a PDF with non-Sig fields (text field only)', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    const text = form.createTextField('username');
    text.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
    const r = detectPriorPadesSignatures(doc);
    expect(r).toEqual([]);
  });

  it('NEVER throws even on malformed AcroForm (defensive)', async () => {
    // Create a doc, then deliberately leave it without invoking getForm()
    // so that internal acroForm dict access exercises the catch path.
    const doc = await PDFDocument.create();
    expect(() => detectPriorPadesSignatures(doc)).not.toThrow();
  });

  // --------------------------------------------------------------------
  // Phase 7.2 7.2.5 (David, 2026-06-10) — indirect /V handling.
  //
  // Background: node-signpdf v3 `plainAddPlaceholder`, Adobe Acrobat,
  // DocuSign, and Adobe Sign all serialize the /V signature value as an
  // INDIRECT REFERENCE (PDFRef pointing at a separate object), not as an
  // inline PDFDict. The prior detector implementation read /V via
  // `dict.get(PDFName.of('V'))` which returns the raw PDFRef and then
  // tried `vAny.get(...)` / `vAny.dict?.get?.(...)` to reach /Contents.
  // PDFRef has neither method, so the detector silently fell through and
  // returned `[]` for every real-world signed PDF — the downstream
  // signature-audit invalidation backref was unreachable in production.
  // Diego caught it 2026-06-10 (Phase 7.2 7.2.4 fixture generation) and
  // worked around it by re-loading the signed PDF and inlining /V in
  // tests/fixtures/pdfs/scripts/generate-signed-fixture.mjs. These tests
  // exercise the production-shape (indirect-ref) /V directly so the
  // workaround can be retired.
  // --------------------------------------------------------------------

  // Helper: hand-author a /FT /Sig field with the given /V representation.
  // Mirrors the structural pattern in
  // tests/fixtures/pdfs/scripts/generate-signed-fixture.mjs (buildUnsignedPdfWithSigField).
  function authorSigField(
    doc: PDFDocument,
    fieldName: string,
    vValue: PDFDict | { kind: 'indirect-ref'; dict: PDFDict },
  ): void {
    const ctx = doc.context;
    const page = doc.addPage([612, 792]);

    const fieldDict = PDFDict.fromMapWithContext(
      new Map([
        [PDFName.of('FT'), PDFName.of('Sig')],
        [PDFName.of('T'), PDFString.of(fieldName)],
        [PDFName.of('Ff'), PDFNumber.of(0)],
      ]),
      ctx,
    );
    // Set /V either as the inline dict OR as an indirect ref to it.
    if (vValue instanceof PDFDict) {
      fieldDict.set(PDFName.of('V'), vValue);
    } else {
      const vRef = ctx.register(vValue.dict);
      fieldDict.set(PDFName.of('V'), vRef);
    }
    const fieldRef = ctx.register(fieldDict);

    const widgetDict = PDFDict.withContext(ctx);
    widgetDict.set(PDFName.of('Type'), PDFName.of('Annot'));
    widgetDict.set(PDFName.of('Subtype'), PDFName.of('Widget'));
    const rectArray = PDFArray.withContext(ctx);
    rectArray.push(PDFNumber.of(50));
    rectArray.push(PDFNumber.of(700));
    rectArray.push(PDFNumber.of(150));
    rectArray.push(PDFNumber.of(750));
    widgetDict.set(PDFName.of('Rect'), rectArray);
    widgetDict.set(PDFName.of('F'), PDFNumber.of(4));
    widgetDict.set(PDFName.of('P'), page.ref);
    widgetDict.set(PDFName.of('Parent'), fieldRef);
    const widgetRef = ctx.register(widgetDict);

    const kidsArray = PDFArray.withContext(ctx);
    kidsArray.push(widgetRef);
    fieldDict.set(PDFName.of('Kids'), kidsArray);

    // Wire /AcroForm /Fields.
    const fieldsArr = PDFArray.withContext(ctx);
    fieldsArr.push(fieldRef);
    const acroForm = PDFDict.fromMapWithContext(
      new Map([
        [PDFName.of('Fields'), fieldsArr],
        [PDFName.of('SigFlags'), PDFNumber.of(3)],
      ]),
      ctx,
    );
    doc.catalog.set(PDFName.of('AcroForm'), acroForm);

    // Wire widget into page /Annots.
    const annots = PDFArray.withContext(ctx);
    annots.push(widgetRef);
    page.node.set(PDFName.of('Annots'), annots);
  }

  it('detects a signature with INLINE /V (canonical hand-authored shape, regression baseline)', async () => {
    const doc = await PDFDocument.create();
    const vInline = PDFDict.fromMapWithContext(
      new Map<PDFName, PDFHexString>([
        [PDFName.of('Contents'), PDFHexString.of('aabbccdd'.repeat(64))],
      ]),
      doc.context,
    );
    authorSigField(doc, 'Signature1', vInline);
    // Round-trip through save+load so pdf-lib re-instantiates the typed
    // subclass exactly as the production handler sees it.
    const bytes = await doc.save({ useObjectStreams: false });
    const reloaded = await PDFDocument.load(bytes);
    const r = detectPriorPadesSignatures(reloaded);
    expect(r).toEqual(['Signature1']);
  });

  it('detects a signature with INDIRECT /V (PDFRef → /V dict — the production shape)', async () => {
    const doc = await PDFDocument.create();
    // /V is registered as a SEPARATE object; the field's /V entry is the
    // PDFRef. This is the exact shape node-signpdf v3 produces (and the
    // shape Adobe Acrobat / DocuSign / Adobe Sign emit in practice).
    const vDict = PDFDict.fromMapWithContext(
      new Map<PDFName, PDFHexString>([
        [PDFName.of('Contents'), PDFHexString.of('aabbccdd'.repeat(64))],
      ]),
      doc.context,
    );
    authorSigField(doc, 'Signature1', { kind: 'indirect-ref', dict: vDict });
    const bytes = await doc.save({ useObjectStreams: false });
    const reloaded = await PDFDocument.load(bytes);
    const r = detectPriorPadesSignatures(reloaded);
    expect(r).toEqual(['Signature1']);
  });

  it('detects a signature when /Contents is also indirect (object-stream-packed shape)', async () => {
    // Defensive coverage: object-stream-aggressive serializers can store the
    // /Contents hex string as its own indirect object. lookupMaybe resolves
    // both /V → PDFDict AND /Contents → PDFHexString transparently.
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const contentsHex = PDFHexString.of('aabbccdd'.repeat(64));
    const contentsRef = ctx.register(contentsHex);
    const vDict = PDFDict.withContext(ctx);
    vDict.set(PDFName.of('Contents'), contentsRef);
    authorSigField(doc, 'Signature1', { kind: 'indirect-ref', dict: vDict });
    const bytes = await doc.save({ useObjectStreams: false });
    const reloaded = await PDFDocument.load(bytes);
    const r = detectPriorPadesSignatures(reloaded);
    expect(r).toEqual(['Signature1']);
  });

  it('returns empty when /V is indirect but /Contents is the empty `<>` placeholder', async () => {
    // The unsigned-placeholder shape: /V dict exists with /Contents <>.
    // Real signature applications use this layout right before sign() fills
    // the placeholder. We must NOT report it as a signature.
    const doc = await PDFDocument.create();
    const vDict = PDFDict.fromMapWithContext(
      new Map<PDFName, PDFHexString>([
        [PDFName.of('Contents'), PDFHexString.of('')], // empty placeholder
      ]),
      doc.context,
    );
    authorSigField(doc, 'Signature1', { kind: 'indirect-ref', dict: vDict });
    const bytes = await doc.save({ useObjectStreams: false });
    const reloaded = await PDFDocument.load(bytes);
    const r = detectPriorPadesSignatures(reloaded);
    expect(r).toEqual([]);
  });

  // Note: testing a doc with a real prior PAdES signature requires
  // either a fixture or generating one via the Wave 16 signature engine.
  // That integration test belongs in the OCR handler test which uses
  // the Phase 4 corpus. The detector's "found signature" branch is
  // covered there via end-to-end.
});
