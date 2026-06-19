// Tests for listEmbeddedFonts (Phase 7.5 Wave 6 — B18 listing helper).

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { listEmbeddedFonts } from './font-list.js';

async function makeStandardFontPdf(pageCount = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(`page ${i + 1}`, { x: 50, y: 700, size: 24, font: helv });
    if (i === pageCount - 1) {
      page.drawText('times', { x: 50, y: 650, size: 12, font: times });
    }
  }
  return doc.save();
}

describe('listEmbeddedFonts', () => {
  it('rejects an empty buffer', async () => {
    const r = await listEmbeddedFonts(new Uint8Array());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_payload');
  });

  it('returns the standard fonts referenced across pages', async () => {
    const bytes = await makeStandardFontPdf(2);
    const r = await listEmbeddedFonts(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.value.map((f) => f.name);
    expect(names).toContain('Helvetica');
    expect(names).toContain('Times-Roman');
    // Standard PDF fonts are NEVER embedded (they're referenced by name).
    for (const f of r.value) {
      expect(f.isEmbedded).toBe(false);
      // Standard fonts don't carry a subset prefix.
      expect(f.isSubset).toBe(false);
    }
  });

  it('reports page indices each font is referenced from', async () => {
    const bytes = await makeStandardFontPdf(2);
    const r = await listEmbeddedFonts(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const helv = r.value.find((f) => f.name === 'Helvetica');
    expect(helv).toBeDefined();
    expect(helv!.pageRefs).toEqual([0, 1]);
    const times = r.value.find((f) => f.name === 'Times-Roman');
    expect(times).toBeDefined();
    // Times only used on the last page.
    expect(times!.pageRefs).toEqual([1]);
  });

  it('returns an empty list for a PDF with no fonts', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]); // No text content => no /Font resources.
    const bytes = await doc.save();
    const r = await listEmbeddedFonts(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });
});
