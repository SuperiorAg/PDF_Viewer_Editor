// Tests for pdf:identifyTextSpan handler — Phase 2 (Wave 7, David) +
// Phase 2.5 (Wave 10, D-10.2) real text-span scanner.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { handlePdfIdentifyTextSpan } from './pdf-identify-text-span.js';
import { expectErr, expectOk } from './test-support.js';

async function createPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText('hello world', { x: 50, y: 700, size: 12 });
  return doc.save();
}

async function createMultiRunPdf(): Promise<Uint8Array> {
  // Two text runs on the same page so the scanner has to resolve runIndex.
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText('alpha', { x: 50, y: 700, size: 14 });
  page.drawText('beta', { x: 50, y: 600, size: 14 });
  return doc.save();
}

function deps(bytes: Uint8Array | null) {
  return {
    hasHandle: (_h: number) => bytes !== null,
    getBytes: (_h: number) => bytes,
  };
}

describe('pdf:identifyTextSpan handler', () => {
  it('rejects non-integer handle', async () => {
    const r = await handlePdfIdentifyTextSpan(
      { handle: 'bad' as unknown as number, pageIndex: 0, x: 0, y: 0 },
      deps(new Uint8Array([1])),
    );
    expectErr(r, 'invalid_payload');
  });

  it('rejects unknown handle (hasHandle returns false)', async () => {
    const r = await handlePdfIdentifyTextSpan({ handle: 1, pageIndex: 0, x: 0, y: 0 }, deps(null));
    expectErr(r, 'handle_not_found');
  });

  it('rejects non-finite x/y', async () => {
    const r = await handlePdfIdentifyTextSpan(
      { handle: 1, pageIndex: 0, x: NaN, y: 0 },
      deps(new Uint8Array([1])),
    );
    expectErr(r, 'invalid_payload');
  });

  it('returns out_of_range for pageIndex beyond pageCount', async () => {
    const bytes = await createPdf();
    const r = await handlePdfIdentifyTextSpan(
      { handle: 1, pageIndex: 99, x: 0, y: 0 },
      deps(bytes),
    );
    expectErr(r, 'out_of_range');
  });

  // -----------------------------------------------------------------
  // Wave 10 / Phase 2.5 (D-10.2) — real text-span scanner.
  // -----------------------------------------------------------------

  it('in-bounds single-run hit returns a real objectId + text', async () => {
    const bytes = await createPdf();
    // pdf-lib's drawText draws "hello world" with origin (50, 700) at size 12.
    // The bbox extends right ~33pt (11 chars × 0.5 × 12) and up 12pt.
    const r = await handlePdfIdentifyTextSpan(
      { handle: 1, pageIndex: 0, x: 55, y: 705 },
      deps(bytes),
    );
    const value = expectOk(r);
    expect(value.currentText).toBe('hello world');
    expect(value.font.size).toBe(12);
    // objectId must follow pageObjectNumber/contentStreamIndex/runIndex.
    expect(value.objectId).toMatch(/^\d+\/\d+\/\d+$/);
    expect(value.runBoundingRect.x).toBeCloseTo(50, 0);
    expect(value.runBoundingRect.y).toBeCloseTo(700, 0);
    expect(value.runBoundingRect.width).toBeGreaterThan(0);
    expect(value.runBoundingRect.height).toBeGreaterThan(0);
  });

  it('multi-run page resolves the correct runIndex for the clicked run', async () => {
    const bytes = await createMultiRunPdf();
    // First run "alpha" at y=700, second run "beta" at y=600.
    const hitAlpha = await handlePdfIdentifyTextSpan(
      { handle: 1, pageIndex: 0, x: 55, y: 705 },
      deps(bytes),
    );
    const va = expectOk(hitAlpha);
    expect(va.currentText).toBe('alpha');

    const hitBeta = await handlePdfIdentifyTextSpan(
      { handle: 1, pageIndex: 0, x: 55, y: 605 },
      deps(bytes),
    );
    const vb = expectOk(hitBeta);
    expect(vb.currentText).toBe('beta');

    // objectIds must differ in runIndex (the third segment).
    const aId = va.objectId.split('/');
    const bId = vb.objectId.split('/');
    expect(aId[2]).not.toBe(bId[2]);
  });

  it('out-of-bounds coordinates return no_text_at_point', async () => {
    const bytes = await createPdf();
    // Pick a point well outside the "hello world" bbox (origin 50,700).
    const r = await handlePdfIdentifyTextSpan(
      { handle: 1, pageIndex: 0, x: 500, y: 100 },
      deps(bytes),
    );
    expectErr(r, 'no_text_at_point');
  });
});
