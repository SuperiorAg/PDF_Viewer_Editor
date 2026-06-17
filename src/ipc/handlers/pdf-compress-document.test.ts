// Handler tests for pdf:compressDocument (Phase 7.5 Wave 4 — B6).

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import type { compressDocument } from '../../main/pdf-ops/compress-engine.js';
import { fail, ok } from '../../shared/result.js';

import {
  handlePdfCompressDocument,
  type PdfCompressDocumentDeps,
} from './pdf-compress-document.js';
import { expectErr, expectOk } from './test-support.js';

async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([100, 100]);
  return doc.save();
}

function makeDeps(overrides: Partial<PdfCompressDocumentDeps> = {}): PdfCompressDocumentDeps {
  return {
    getBytes: vi.fn().mockReturnValue(new Uint8Array([0])),
    setBytes: vi.fn(),
    ...overrides,
  };
}

describe('handlePdfCompressDocument', () => {
  it('rejects invalid payload', async () => {
    const res = await handlePdfCompressDocument({ handle: 'bad' }, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('rejects jpegRecompressQuality > 1', async () => {
    const res = await handlePdfCompressDocument(
      {
        handle: 1,
        imageDownsampleDpi: null,
        jpegRecompressQuality: 2,
        fontSubsetting: false,
        removeUnusedObjects: true,
      },
      makeDeps(),
    );
    expectErr(res, 'invalid_payload');
  });

  it('returns handle_not_found when documentStore has no bytes', async () => {
    const deps = makeDeps({ getBytes: () => null });
    const res = await handlePdfCompressDocument(
      {
        handle: 1,
        imageDownsampleDpi: null,
        jpegRecompressQuality: null,
        fontSubsetting: false,
        removeUnusedObjects: true,
      },
      deps,
    );
    expectErr(res, 'handle_not_found');
  });

  it('compresses end-to-end and updates store', async () => {
    const bytes = await makePdf(3);
    const setBytes = vi.fn();
    const deps = makeDeps({ getBytes: () => bytes, setBytes });
    const res = await handlePdfCompressDocument(
      {
        handle: 7,
        imageDownsampleDpi: null,
        jpegRecompressQuality: null,
        fontSubsetting: false,
        removeUnusedObjects: true,
      },
      deps,
    );
    const v = expectOk(res);
    expect(v.originalBytes).toBe(bytes.byteLength);
    expect(v.compressedBytes).toBeGreaterThan(0);
    expect(v.reductionPercent).toBeGreaterThanOrEqual(0);
    expect(setBytes).toHaveBeenCalledTimes(1);
    expect(setBytes.mock.calls[0]![0]).toBe(7);
  });

  it('uses injected engine in failure path', async () => {
    const fakeEngine: typeof compressDocument = async () => fail('engine_failed', 'fake');
    const deps = makeDeps({
      getBytes: () => new Uint8Array([0x25]),
      compressEngine: fakeEngine,
    });
    const res = await handlePdfCompressDocument(
      {
        handle: 1,
        imageDownsampleDpi: null,
        jpegRecompressQuality: null,
        fontSubsetting: false,
        removeUnusedObjects: true,
      },
      deps,
    );
    expectErr(res, 'engine_failed');
  });

  it('maps invalid_payload from engine to invalid_payload at IPC', async () => {
    const fakeEngine: typeof compressDocument = async () =>
      fail('invalid_payload', 'engine says no');
    const deps = makeDeps({
      getBytes: () => new Uint8Array([0x25]),
      compressEngine: fakeEngine,
    });
    const res = await handlePdfCompressDocument(
      {
        handle: 1,
        imageDownsampleDpi: null,
        jpegRecompressQuality: null,
        fontSubsetting: false,
        removeUnusedObjects: true,
      },
      deps,
    );
    expectErr(res, 'invalid_payload');
  });

  it('propagates engine warnings', async () => {
    const fakeEngine: typeof compressDocument = async () =>
      ok({
        bytes: new Uint8Array([0x25]),
        originalBytes: 100,
        compressedBytes: 50,
        reductionPercent: 50,
        warnings: ['stub-warning'],
      });
    const deps = makeDeps({
      getBytes: () => new Uint8Array([0x25]),
      compressEngine: fakeEngine,
    });
    const res = await handlePdfCompressDocument(
      {
        handle: 1,
        imageDownsampleDpi: 150,
        jpegRecompressQuality: 0.7,
        fontSubsetting: true,
        removeUnusedObjects: true,
      },
      deps,
    );
    const v = expectOk(res);
    expect(v.warnings).toEqual(['stub-warning']);
    expect(v.reductionPercent).toBe(50);
  });
});
