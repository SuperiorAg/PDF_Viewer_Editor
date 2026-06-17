// Unit tests for the Phase 7.5 Wave 5 B18 font-swap engine.

import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { swapEmbeddedFont } from './font-swap-engine.js';

async function makePdfWithFont(fontName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 300]);
  // Inject a synthetic /Font dict referencing the named font.
  const fontDict = PDFDict.withContext(doc.context);
  fontDict.set(PDFName.of('Type'), PDFName.of('Font'));
  fontDict.set(PDFName.of('Subtype'), PDFName.of('TrueType'));
  fontDict.set(PDFName.of('BaseFont'), PDFName.of(fontName));
  // Mimic an embedded-subset's FontDescriptor + Widths so we can verify they
  // are dropped after the swap.
  const desc = PDFDict.withContext(doc.context);
  desc.set(PDFName.of('Type'), PDFName.of('FontDescriptor'));
  fontDict.set(PDFName.of('FontDescriptor'), desc);
  fontDict.set(PDFName.of('Widths'), doc.context.obj([500, 500, 500]));
  fontDict.set(PDFName.of('FirstChar'), doc.context.obj(0));
  fontDict.set(PDFName.of('LastChar'), doc.context.obj(2));
  doc.context.register(fontDict);
  return doc.save({ useObjectStreams: false });
}

describe('swapEmbeddedFont', () => {
  it('rejects empty bytes', async () => {
    const res = await swapEmbeddedFont({
      pdfBytes: new Uint8Array(0),
      fromFontName: 'CustomFont',
      toFontName: 'Helvetica',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects non-standard toFontName', async () => {
    const bytes = await makePdfWithFont('Arial');
    const res = await swapEmbeddedFont({
      pdfBytes: bytes,
      fromFontName: 'Arial',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional invalid input
      toFontName: 'NotAStandardFont' as any,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('to_font_invalid');
  });

  it('reports from_font_not_found when source font absent', async () => {
    const bytes = await makePdfWithFont('Arial');
    const res = await swapEmbeddedFont({
      pdfBytes: bytes,
      fromFontName: 'NonExistentFont',
      toFontName: 'Helvetica',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('from_font_not_found');
  });

  it('swaps a non-standard font for Helvetica and drops subset metadata', async () => {
    const bytes = await makePdfWithFont('ArialCustom-Regular');
    const res = await swapEmbeddedFont({
      pdfBytes: bytes,
      fromFontName: 'ArialCustom-Regular',
      toFontName: 'Helvetica',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.fontsRewritten).toBeGreaterThan(0);

    // Re-open and verify no crash + the /Font dict now points at Helvetica.
    const out = await PDFDocument.load(res.value.bytes);
    let foundHelvetica = false;
    for (const [, obj] of out.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const t = obj.lookupMaybe(PDFName.of('Type'), PDFName);
      if (!t || t.asString() !== '/Font') continue;
      const bf = obj.lookupMaybe(PDFName.of('BaseFont'), PDFName);
      if (bf && bf.asString() === '/Helvetica') {
        foundHelvetica = true;
        // FontDescriptor + Widths should be dropped — standard fonts don't use them.
        expect(obj.has(PDFName.of('FontDescriptor'))).toBe(false);
        expect(obj.has(PDFName.of('Widths'))).toBe(false);
        // Subtype should be Type1 (standard fonts).
        const st = obj.lookupMaybe(PDFName.of('Subtype'), PDFName);
        expect(st?.asString()).toBe('/Type1');
      }
    }
    expect(foundHelvetica).toBe(true);
  });

  it('matches subset-prefixed BaseFont (XXXXXX+ActualName)', async () => {
    const bytes = await makePdfWithFont('ABCDEF+MyCustomFont');
    const res = await swapEmbeddedFont({
      pdfBytes: bytes,
      fromFontName: 'MyCustomFont',
      toFontName: 'Times-Roman',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.fontsRewritten).toBeGreaterThan(0);
  });

  it('surfaces non-Latin hint warning for CJK-suspicious font names', async () => {
    const bytes = await makePdfWithFont('SimSunCN');
    const res = await swapEmbeddedFont({
      pdfBytes: bytes,
      fromFontName: 'SimSunCN',
      toFontName: 'Helvetica',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.warnings.some((w) => w.toLowerCase().includes('non-latin'))).toBe(true);
  });

  it('always emits the glyph-width warning', async () => {
    const bytes = await makePdfWithFont('Foo');
    const res = await swapEmbeddedFont({
      pdfBytes: bytes,
      fromFontName: 'Foo',
      toFontName: 'Courier',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.warnings.some((w) => w.toLowerCase().includes('glyph widths'))).toBe(true);
  });
});
