// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { VisualAppearanceSpec } from '../../ipc/contracts.js';

import { composeAppearance, drawAppearanceOnPage } from './signature-appearance.js';

// Tiny valid PNG (1x1 transparent) for image-embed tests. The bytes are a
// well-known PNG header + IDAT for a 1x1 transparent pixel.
const ONE_PX_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function baseSpec(): VisualAppearanceSpec {
  return {
    source: { kind: 'drawn', pngBytes: ONE_PX_PNG, widthPx: 1, heightPx: 1 },
    showName: true,
    showDate: true,
    showReason: false,
    showSubjectCN: false,
    showIssuerCN: false,
    showTsaInfo: false,
  };
}

describe('composeAppearance', () => {
  it('happy path: drawn source + date row', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const r = await composeAppearance(doc, {
      ...baseSpec(),
      rect: { x: 50, y: 50, width: 200, height: 80 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.image).not.toBeNull();
      expect(r.value.rows.some((row) => row.startsWith('Date:'))).toBe(true);
    }
  });

  it('drops lower-priority rows when rect cannot fit all', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const r = await composeAppearance(doc, {
      ...baseSpec(),
      showSubjectCN: true,
      showIssuerCN: true,
      showReason: true,
      showTsaInfo: true,
      reason: 'Reason X',
      subjectCN: 'CN-A',
      issuerCN: 'CN-B',
      tsaUrl: 'https://tsa.example.com',
      rect: { x: 0, y: 0, width: 200, height: 30 }, // very small
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Drop policy: TSA + Reason + Issuer drop first; SubjectCN highest priority.
      const joined = r.value.rows.join('\n');
      // SubjectCN must be present (highest priority).
      expect(joined).toContain('Signed by: CN-A');
      // Warnings include a drop notice.
      expect(r.value.warnings.some((w) => w.includes('dropped'))).toBe(true);
    }
  });

  it('rejects an invalid source (empty pngBytes)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const r = await composeAppearance(doc, {
      ...baseSpec(),
      source: { kind: 'drawn', pngBytes: new Uint8Array(0), widthPx: 0, heightPx: 0 },
      rect: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_source');
  });

  it('rejects rect with zero width', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const r = await composeAppearance(doc, {
      ...baseSpec(),
      rect: { x: 0, y: 0, width: 0, height: 100 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('rect_too_small');
  });
});

describe('drawAppearanceOnPage', () => {
  it('renders + returns the embedded font', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const composed = await composeAppearance(doc, {
      ...baseSpec(),
      rect: { x: 50, y: 50, width: 200, height: 80 },
    });
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const drew = await drawAppearanceOnPage(doc, 0, composed.value, {
      x: 50,
      y: 50,
      width: 200,
      height: 80,
    });
    expect(drew.ok).toBe(true);
  });

  it('rejects out-of-range pageIndex', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const composed = await composeAppearance(doc, {
      ...baseSpec(),
      rect: { x: 0, y: 0, width: 100, height: 100 },
    });
    if (!composed.ok) throw new Error('test setup');
    const drew = await drawAppearanceOnPage(doc, 7, composed.value, {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(drew.ok).toBe(false);
    if (!drew.ok) expect(drew.error).toBe('page_out_of_range');
  });
});
