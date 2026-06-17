// Handler tests for pdf:applyWatermark (Phase 7.5 Wave 3 B4).

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import type { applyWatermark } from '../../main/pdf-ops/watermark-engine.js';
import { ok } from '../../shared/result.js';

import { handlePdfApplyWatermark, type PdfApplyWatermarkDeps } from './pdf-apply-watermark.js';
import { expectErr, expectOk } from './test-support.js';

async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([200, 300]);
  return doc.save();
}

function makeDeps(overrides: Partial<PdfApplyWatermarkDeps> = {}): PdfApplyWatermarkDeps {
  return {
    getBytes: vi.fn().mockReturnValue(new Uint8Array([0])),
    setBytes: vi.fn(),
    ...overrides,
  };
}

describe('handlePdfApplyWatermark', () => {
  it('rejects invalid payload', async () => {
    const res = await handlePdfApplyWatermark({ handle: 'bad' }, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('returns handle_not_found when documentStore has no bytes', async () => {
    const deps = makeDeps({ getBytes: () => null });
    const res = await handlePdfApplyWatermark(
      {
        handle: 1,
        target: 'all',
        source: { kind: 'text', text: 'X', fontSize: 12, fontColor: '#000000', rotationDegrees: 0 },
        opacity: 1,
        position: 'center',
      },
      deps,
    );
    expectErr(res, 'handle_not_found');
  });

  it('applies watermark end-to-end and updates store', async () => {
    const bytes = await makePdf(2);
    const setBytes = vi.fn();
    const deps = makeDeps({
      getBytes: () => bytes,
      setBytes,
    });
    const res = await handlePdfApplyWatermark(
      {
        handle: 7,
        target: 'all',
        source: {
          kind: 'text',
          text: 'DRAFT',
          fontSize: 18,
          fontColor: '#C2272D',
          rotationDegrees: 0,
        },
        opacity: 0.5,
        position: 'center',
      },
      deps,
    );
    const v = expectOk(res);
    expect(v.pagesAffected).toBe(2);
    expect(setBytes).toHaveBeenCalledTimes(1);
    expect(setBytes.mock.calls[0]![0]).toBe(7);
  });

  it('uses injected engine in failure path', async () => {
    const fakeEngine: typeof applyWatermark = async () =>
      ok({ bytes: new Uint8Array(), pagesAffected: 0, warnings: ['stub'] });
    const deps = makeDeps({ getBytes: () => new Uint8Array([0x25]), watermarkEngine: fakeEngine });
    const res = await handlePdfApplyWatermark(
      {
        handle: 1,
        target: 'all',
        source: { kind: 'text', text: 'X', fontSize: 12, fontColor: '#000000', rotationDegrees: 0 },
        opacity: 1,
        position: 'center',
      },
      deps,
    );
    const v = expectOk(res);
    expect(v.warnings).toEqual(['stub']);
  });
});
