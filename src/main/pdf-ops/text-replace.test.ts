// Tests for text-replace.ts — Phase 2 (Wave 7, David).

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { applyTextReplace, encodeObjectId, parseObjectId, listTextRuns } from './text-replace.js';

describe('text-replace — objectId encoding', () => {
  it('encodes pageObjectNumber/contentStreamIndex/runIndex', () => {
    expect(encodeObjectId(7, 0, 3)).toBe('7/0/3');
  });

  it('round-trips through parseObjectId', () => {
    const s = encodeObjectId(7, 0, 3);
    const parsed = parseObjectId(s);
    expect(parsed).toEqual({ pageObjectNumber: 7, contentStreamIndex: 0, runIndex: 3 });
  });

  it('parseObjectId rejects malformed', () => {
    expect(parseObjectId('bad')).toBeNull();
    expect(parseObjectId('1/2')).toBeNull();
    expect(parseObjectId('a/b/c')).toBeNull();
    expect(parseObjectId('-1/0/0')).toBeNull();
  });
});

describe('text-replace — listTextRuns (Phase-2 conservative)', () => {
  it('returns an empty array for a freshly-created page (Phase-2.5 upgrade pending)', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText('hello', { x: 50, y: 700, size: 12 });
    const runs = listTextRuns(page, 0, 0);
    expect(Array.isArray(runs)).toBe(true);
    // Phase 2 ships the conservative scanner — runs are empty until 2.5.
    expect(runs).toEqual([]);
  });
});

describe('text-replace — applyTextReplace', () => {
  it('returns text_span_not_found when no runs are detected', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const ctx = { warnings: [] as string[] };
    const r = await applyTextReplace(doc, 0, '5/0/0', 'new text', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('text_span_not_found');
    }
  });

  it('returns invalid_payload for malformed objectId', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const ctx = { warnings: [] as string[] };
    const r = await applyTextReplace(doc, 0, 'not-an-id', 'x', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('invalid_payload');
    }
  });

  it('returns op_apply_failed when pageIndex is out of range', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const ctx = { warnings: [] as string[] };
    const r = await applyTextReplace(doc, 99, '5/0/0', 'x', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('op_apply_failed');
    }
  });
});
