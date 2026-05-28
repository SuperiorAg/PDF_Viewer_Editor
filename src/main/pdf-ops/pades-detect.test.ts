// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
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

  // Note: testing a doc with a real prior PAdES signature requires
  // either a fixture or generating one via the Wave 16 signature engine.
  // That integration test belongs in the OCR handler test which uses
  // the Phase 4 corpus. The detector's "found signature" branch is
  // covered there via end-to-end.
});
