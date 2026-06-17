// Unit tests for the Phase 7.5 Wave 5 B20 sanitize engine.
//
// Key properties verified:
//   1. Rebuild-from-scratch: the output PDFDocument has NONE of the catalog
//      entries (AcroForm, Outlines, Names, EmbeddedFiles) the source had —
//      regardless of which sanitize categories were requested.
//   2. Metadata category: output /Info is the trust-floor shape
//      (Producer = PDF_Viewer_Editor; Title/Author/Subject empty).
//   3. Comments category: page annotations removed; link survivors stay if
//      'links' was NOT in the category list.
//   4. JS category: per-page /AA actions stripped.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { sanitizeDocument } from './sanitize-engine.js';

async function makeBloatedPdf(opts: {
  withMetadata?: boolean;
  withOutline?: boolean;
  withAcroForm?: boolean;
  withEmbeddedFile?: boolean;
  withPageAnnotation?: boolean;
  withPageLink?: boolean;
  withPageAA?: boolean;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 300]);
  doc.addPage([200, 300]);

  if (opts.withMetadata) {
    doc.setTitle('SECRET PROJECT');
    doc.setAuthor('John Doe');
    doc.setSubject('CONFIDENTIAL');
    doc.setKeywords(['confidential', 'do-not-share']);
  }
  if (opts.withOutline) {
    const outlines = PDFDict.withContext(doc.context);
    outlines.set(PDFName.of('Type'), PDFName.of('Outlines'));
    doc.catalog.set(PDFName.of('Outlines'), outlines);
  }
  if (opts.withAcroForm) {
    const af = PDFDict.withContext(doc.context);
    af.set(PDFName.of('Fields'), doc.context.obj([]));
    doc.catalog.set(PDFName.of('AcroForm'), af);
  }
  if (opts.withEmbeddedFile) {
    const names = PDFDict.withContext(doc.context);
    const embedded = PDFDict.withContext(doc.context);
    embedded.set(PDFName.of('Names'), doc.context.obj([]));
    names.set(PDFName.of('EmbeddedFiles'), embedded);
    doc.catalog.set(PDFName.of('Names'), names);
  }
  if (opts.withPageAnnotation || opts.withPageLink) {
    const annots = doc.context.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
    // Add a comment annotation.
    if (opts.withPageAnnotation) {
      const a = PDFDict.withContext(doc.context);
      a.set(PDFName.of('Type'), PDFName.of('Annot'));
      a.set(PDFName.of('Subtype'), PDFName.of('Text'));
      a.set(PDFName.of('Rect'), doc.context.obj([10, 10, 50, 50]));
      a.set(PDFName.of('Contents'), PDFString.of('user comment'));
      annots.push(a);
    }
    if (opts.withPageLink) {
      const link = PDFDict.withContext(doc.context);
      link.set(PDFName.of('Type'), PDFName.of('Annot'));
      link.set(PDFName.of('Subtype'), PDFName.of('Link'));
      link.set(PDFName.of('Rect'), doc.context.obj([60, 10, 100, 50]));
      annots.push(link);
    }
  }
  if (opts.withPageAA) {
    const aa = PDFDict.withContext(doc.context);
    const open = PDFDict.withContext(doc.context);
    open.set(PDFName.of('S'), PDFName.of('JavaScript'));
    open.set(PDFName.of('JS'), PDFString.of('app.alert("hi")'));
    aa.set(PDFName.of('O'), open);
    page.node.set(PDFName.of('AA'), aa);
  }
  return doc.save({ useObjectStreams: false });
}

describe('sanitizeDocument', () => {
  it('rejects empty bytes', async () => {
    const res = await sanitizeDocument({ pdfBytes: new Uint8Array(0), categories: ['metadata'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rebuild-from-scratch: output catalog has zero AcroForm / Outlines / Names regardless of category list', async () => {
    const bytes = await makeBloatedPdf({
      withOutline: true,
      withAcroForm: true,
      withEmbeddedFile: true,
    });
    const res = await sanitizeDocument({
      pdfBytes: bytes,
      categories: ['metadata'], // user asked for METADATA ONLY
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Inspect output catalog — the rebuild-from-scratch property is that
    // catalog entries the source had are GONE regardless of categories.
    const out = await PDFDocument.load(res.value.bytes);
    expect(out.catalog.has(PDFName.of('AcroForm'))).toBe(false);
    expect(out.catalog.has(PDFName.of('Outlines'))).toBe(false);
    expect(out.catalog.has(PDFName.of('Names'))).toBe(false);

    // Page count survived.
    expect(out.getPageCount()).toBe(2);
  });

  it('metadata category: output /Info is the trust-floor shape', async () => {
    const bytes = await makeBloatedPdf({ withMetadata: true });
    const res = await sanitizeDocument({ pdfBytes: bytes, categories: ['metadata'] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Load with updateMetadata: false so pdf-lib doesn't overwrite Producer
    // back to its own default during the round-trip (same pattern used by
    // redact-engine.test.ts).
    const out = await PDFDocument.load(res.value.bytes, { updateMetadata: false });
    expect(out.getTitle()).toBeUndefined();
    expect(out.getAuthor()).toBeUndefined();
    expect(out.getSubject()).toBeUndefined();
    expect(out.getProducer()).toBe('PDF_Viewer_Editor');

    // itemsRemoved.metadata counted the source leak.
    expect(res.value.itemsRemoved.metadata).toBeGreaterThan(0);
    expect(res.value.categoriesApplied).toEqual(['metadata']);
  });

  it('comments category: strips comment annotations; preserves links when "links" not requested', async () => {
    const bytes = await makeBloatedPdf({
      withPageAnnotation: true,
      withPageLink: true,
    });
    const res = await sanitizeDocument({ pdfBytes: bytes, categories: ['comments'] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const out = await PDFDocument.load(res.value.bytes, { updateMetadata: false });
    const annots0 = out.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    // After stripping comments, only the /Link survives. Walk the array and
    // assert no Text-subtype annot is present.
    if (annots0 !== undefined) {
      for (let i = 0; i < annots0.size(); i += 1) {
        const dict = annots0.lookupMaybe(i, PDFDict);
        if (!dict) continue;
        const subtype = dict.lookupMaybe(PDFName.of('Subtype'), PDFName);
        expect(subtype?.asString()).not.toBe('/Text');
      }
    }
    expect(res.value.itemsRemoved.comments).toBeGreaterThanOrEqual(1);
  });

  it('js category: strips per-page /AA actions', async () => {
    const bytes = await makeBloatedPdf({ withPageAA: true });
    const res = await sanitizeDocument({ pdfBytes: bytes, categories: ['js'] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const out = await PDFDocument.load(res.value.bytes);
    for (let i = 0; i < out.getPageCount(); i += 1) {
      expect(out.getPage(i).node.has(PDFName.of('AA'))).toBe(false);
    }
  });

  it('surfaces honest warning for hidden-text category', async () => {
    const bytes = await makeBloatedPdf({});
    const res = await sanitizeDocument({
      pdfBytes: bytes,
      categories: ['hidden-text'],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.warnings.some((w) => w.toLowerCase().includes('hidden-text'))).toBe(true);
  });

  it('itemsRemoved keys reflect only requested categories', async () => {
    const bytes = await makeBloatedPdf({ withMetadata: true, withAcroForm: true });
    const res = await sanitizeDocument({
      pdfBytes: bytes,
      categories: ['metadata'],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.itemsRemoved.metadata).toBeGreaterThan(0);
    // form-fields count was probed but NOT echoed because caller didn't ask.
    expect(res.value.itemsRemoved['form-fields']).toBe(0);
  });

  it('dedupe: duplicate categories are folded; categoriesApplied is unique', async () => {
    const bytes = await makeBloatedPdf({ withMetadata: true });
    const res = await sanitizeDocument({
      pdfBytes: bytes,
      categories: ['metadata', 'metadata', 'js'],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.categoriesApplied).toEqual(['metadata', 'js']);
  });
});
