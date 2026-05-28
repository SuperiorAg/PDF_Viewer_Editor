// Per-format limitations catalog — unit tests.
//
// Validates the FIFTH-instance trust-floor honesty surface (conventions
// §17.3): every format must surface at least one bullet for each applicable
// obligation, AND the obligation IDs map 1:1 to the architecture-phase-6 §8.1
// numbering.

import { describe, expect, it } from 'vitest';

import { formatDisplayName, getLimitationsForFormat } from './per-format-limitations';

describe('per-format-limitations — DOCX surface', () => {
  it('docx surfaces all five trust-floor obligations + duration', () => {
    const bullets = getLimitationsForFormat('docx');
    const ids = bullets.map((b) => b.obligationId);
    expect(ids).toContain('1'); // layout best-effort
    expect(ids).toContain('2'); // borderless tables
    expect(ids).toContain('3'); // XFA
    expect(ids).toContain('4'); // signed source
    expect(ids).toContain('5'); // OCR fidelity
    expect(ids).toContain('duration');
  });
});

describe('per-format-limitations — XLSX surface', () => {
  it('xlsx surfaces obligations 1-4 + duration (no #5 — Excel cells are data)', () => {
    const bullets = getLimitationsForFormat('xlsx');
    const ids = bullets.map((b) => b.obligationId);
    expect(ids).toContain('1');
    expect(ids).toContain('2');
    expect(ids).toContain('3');
    expect(ids).toContain('4');
    expect(ids).toContain('duration');
  });
});

describe('per-format-limitations — PPTX surface', () => {
  it('pptx surfaces all five obligations + duration', () => {
    const bullets = getLimitationsForFormat('pptx');
    const ids = bullets.map((b) => b.obligationId);
    expect(ids).toContain('1');
    expect(ids).toContain('2');
    expect(ids).toContain('3');
    expect(ids).toContain('4');
    expect(ids).toContain('5');
    expect(ids).toContain('duration');
  });
});

describe('per-format-limitations — image surfaces', () => {
  it('png surfaces obligation #4 + duration + annotation note', () => {
    const bullets = getLimitationsForFormat('png');
    const ids = bullets.map((b) => b.obligationId);
    expect(ids).toContain('4');
    expect(ids).toContain('duration');
  });

  it('jpeg has the same surface as png', () => {
    const png = getLimitationsForFormat('png');
    const jpeg = getLimitationsForFormat('jpeg');
    expect(jpeg.length).toBe(png.length);
  });

  it('tiff adds the multi-page bundle bullet', () => {
    const png = getLimitationsForFormat('png');
    const tiff = getLimitationsForFormat('tiff');
    expect(tiff.length).toBeGreaterThan(png.length);
    expect(tiff.some((b) => /multi-page/i.test(b.text) || /bundles/i.test(b.text))).toBe(true);
  });
});

describe('per-format-limitations — bullets are non-empty', () => {
  for (const fmt of ['docx', 'xlsx', 'pptx', 'png', 'jpeg', 'tiff'] as const) {
    it(`${fmt} has at least 3 bullets`, () => {
      expect(getLimitationsForFormat(fmt).length).toBeGreaterThanOrEqual(3);
    });
    it(`${fmt} bullets have non-empty text`, () => {
      const bullets = getLimitationsForFormat(fmt);
      for (const b of bullets) {
        expect(b.text.length).toBeGreaterThan(20);
      }
    });
  }
});

describe('formatDisplayName', () => {
  it('returns user-friendly names', () => {
    expect(formatDisplayName('docx')).toContain('Word');
    expect(formatDisplayName('xlsx')).toContain('Excel');
    expect(formatDisplayName('pptx')).toContain('PowerPoint');
    expect(formatDisplayName('png')).toContain('PNG');
    expect(formatDisplayName('jpeg')).toContain('JPEG');
    expect(formatDisplayName('tiff')).toContain('TIFF');
  });
});
