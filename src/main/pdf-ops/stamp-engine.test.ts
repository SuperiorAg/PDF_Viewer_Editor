// Unit tests for the Phase 7.5 Wave 3 B7 Stamp engine.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, beforeEach } from 'vitest';

import { applyStamp, _resetStampInstanceCounterForTests, type StampEntry } from './stamp-engine.js';

async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([200, 300]);
  return doc.save();
}

const APPROVED: StampEntry = {
  id: 1,
  builtinKey: 'builtin:approved',
  kind: 'text',
  textValue: 'APPROVED',
  imageBytes: null,
  widthPt: 144,
  heightPt: 36,
  color: '#C2272D',
};

beforeEach(() => {
  _resetStampInstanceCounterForTests();
});

describe('applyStamp', () => {
  it('rejects page-index out of range', async () => {
    const bytes = await makePdf(2);
    const res = await applyStamp({
      pdfBytes: bytes,
      stamp: APPROVED,
      placement: { pageIndex: 5, xPt: 10, yPt: 10, rotationDegrees: 0, opacity: 1 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('page_out_of_range');
  });

  it('rejects text stamp with empty textValue', async () => {
    const bytes = await makePdf(1);
    const res = await applyStamp({
      pdfBytes: bytes,
      stamp: { ...APPROVED, textValue: '' },
      placement: { pageIndex: 0, xPt: 10, yPt: 10, rotationDegrees: 0, opacity: 1 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('applies a text stamp and survives round-trip', async () => {
    const bytes = await makePdf(3);
    const res = await applyStamp({
      pdfBytes: bytes,
      stamp: APPROVED,
      placement: { pageIndex: 1, xPt: 30, yPt: 50, rotationDegrees: 0, opacity: 1 },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.annotationId).toMatch(/^1:\d+$/);
      const reload = await PDFDocument.load(res.value.bytes);
      expect(reload.getPageCount()).toBe(3);
    }
  });

  it('produces monotonically-increasing annotation instance counters', async () => {
    const bytes = await makePdf(1);
    const a = await applyStamp({
      pdfBytes: bytes,
      stamp: APPROVED,
      placement: { pageIndex: 0, xPt: 10, yPt: 10, rotationDegrees: 0, opacity: 1 },
    });
    const b = await applyStamp({
      pdfBytes: bytes,
      stamp: APPROVED,
      placement: { pageIndex: 0, xPt: 10, yPt: 10, rotationDegrees: 0, opacity: 1 },
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      const aIx = Number(a.value.annotationId.split(':')[1]);
      const bIx = Number(b.value.annotationId.split(':')[1]);
      expect(bIx).toBeGreaterThan(aIx);
    }
  });

  it('rejects opacity outside [0,1]', async () => {
    const bytes = await makePdf(1);
    const res = await applyStamp({
      pdfBytes: bytes,
      stamp: APPROVED,
      placement: { pageIndex: 0, xPt: 10, yPt: 10, rotationDegrees: 0, opacity: 2 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects image stamp with null imageBytes', async () => {
    const bytes = await makePdf(1);
    const res = await applyStamp({
      pdfBytes: bytes,
      stamp: { ...APPROVED, kind: 'image', imageBytes: null, textValue: null },
      placement: { pageIndex: 0, xPt: 10, yPt: 10, rotationDegrees: 0, opacity: 1 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });
});
