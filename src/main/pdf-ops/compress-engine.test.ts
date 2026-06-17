// Unit tests for the Phase 7.5 Wave 4 B6 Compress engine.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { compressDocument } from './compress-engine.js';

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Embed a built-in font's title so the doc context has at least one
  // object that's reachable via the catalog and one we'd want to keep.
  doc.setTitle('test');
  for (let i = 0; i < pageCount; i += 1) doc.addPage([200, 300]);
  // Bloat: register one indirect object per page that is NOT wired into the
  // catalog. pdf-lib's standard save emits ALL of these; the rebuild path
  // discards them. This is the load-bearing signal for "rebuild shrinks".
  for (let i = 0; i < pageCount; i += 1) {
    const orphan = doc.context.obj({ Foo: 'orphan-payload-' + 'X'.repeat(200) });
    doc.context.register(orphan);
  }
  return doc.save({ useObjectStreams: false });
}

describe('compressDocument', () => {
  it('rejects empty bytes', async () => {
    const res = await compressDocument({
      pdfBytes: new Uint8Array(0),
      imageDownsampleDpi: null,
      jpegRecompressQuality: null,
      fontSubsetting: false,
      removeUnusedObjects: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects out-of-range jpegRecompressQuality', async () => {
    const bytes = await makePdf(1);
    const res = await compressDocument({
      pdfBytes: bytes,
      imageDownsampleDpi: null,
      jpegRecompressQuality: 2,
      fontSubsetting: false,
      removeUnusedObjects: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rebuilds and shrinks a bloated PDF, preserving page count', async () => {
    const input = await makePdf(5);
    const res = await compressDocument({
      pdfBytes: input,
      imageDownsampleDpi: null,
      jpegRecompressQuality: null,
      fontSubsetting: false,
      removeUnusedObjects: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.originalBytes).toBe(input.byteLength);
    expect(res.value.compressedBytes).toBe(res.value.bytes.byteLength);
    // Rebuild discards the orphan objects we registered above — output must
    // be strictly smaller than the deliberately bloated input.
    expect(res.value.compressedBytes).toBeLessThan(res.value.originalBytes);
    expect(res.value.reductionPercent).toBeGreaterThan(0);
    expect(res.value.reductionPercent).toBeLessThanOrEqual(100);

    // Page count must survive the rebuild.
    const round = await PDFDocument.load(res.value.bytes);
    expect(round.getPageCount()).toBe(5);
  });

  it('reports honest warnings for unimplemented options', async () => {
    const input = await makePdf(1);
    const res = await compressDocument({
      pdfBytes: input,
      imageDownsampleDpi: 150,
      jpegRecompressQuality: 0.7,
      fontSubsetting: true,
      removeUnusedObjects: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.warnings.length).toBeGreaterThanOrEqual(3);
    const joined = res.value.warnings.join('\n');
    expect(joined).toMatch(/downsampl/i);
    expect(joined).toMatch(/JPEG/i);
    expect(joined).toMatch(/subset/i);
  });

  it('non-rebuild path still saves and reports sizes', async () => {
    const input = await makePdf(2);
    const res = await compressDocument({
      pdfBytes: input,
      imageDownsampleDpi: null,
      jpegRecompressQuality: null,
      fontSubsetting: false,
      removeUnusedObjects: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.compressedBytes).toBe(res.value.bytes.byteLength);
    // Non-rebuild may not shrink (it just re-saves), but must report sizes
    // honestly. reductionPercent in [0,100].
    expect(res.value.reductionPercent).toBeGreaterThanOrEqual(0);
    expect(res.value.reductionPercent).toBeLessThanOrEqual(100);
    const round = await PDFDocument.load(res.value.bytes);
    expect(round.getPageCount()).toBe(2);
  });

  it('surfaces pdf_load_failed on garbage bytes', async () => {
    const res = await compressDocument({
      pdfBytes: new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]),
      imageDownsampleDpi: null,
      jpegRecompressQuality: null,
      fontSubsetting: false,
      removeUnusedObjects: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('pdf_load_failed');
  });
});
