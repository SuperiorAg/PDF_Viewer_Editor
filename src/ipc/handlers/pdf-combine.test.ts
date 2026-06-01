// Tests for the pdf:combine IPC handler (Wave-30 follow-up H-30.1).
//
// Per the Wave 13.5 / 17 ratchet, this test uses the REAL production
// sanitizer (`src/main/security/path-sanitizer.ts`) injected directly, NOT
// a permissive `(raw) => raw` stub. The combine handler is one of the few
// surfaces that takes renderer-supplied file paths, so the test must prove
// the production sanitizer is wired through and gates inputs honestly.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { combinePdfs } from '../../main/pdf-ops/combine.js';
import type { DocumentRecord } from '../../main/pdf-ops/document-store.js';
import { computeBufferHash } from '../../main/pdf-ops/file-hash.js';
import { sanitizePath } from '../../main/security/path-sanitizer.js';

import { handlePdfCombine, type PdfCombineDeps } from './pdf-combine.js';
import { expectErr, expectOk } from './test-support.js';

async function makePdf(pageSpecs: Array<{ width: number; height: number }>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const { width, height } of pageSpecs) {
    doc.addPage([width, height]);
  }
  return doc.save();
}

function makeRegisterHandle(): {
  registerHandle: PdfCombineDeps['registerHandle'];
  captured: DocumentRecord[];
} {
  let nextHandle = 100;
  const captured: DocumentRecord[] = [];
  const registerHandle: PdfCombineDeps['registerHandle'] = (rec) => {
    const full: DocumentRecord = { ...rec, handle: nextHandle++, openedAt: Date.now() };
    captured.push(full);
    return full;
  };
  return { registerHandle, captured };
}

function makeDeps(overrides: Partial<PdfCombineDeps> = {}): PdfCombineDeps {
  const { registerHandle } = makeRegisterHandle();
  return {
    readFile: vi.fn().mockResolvedValue(new Uint8Array(0)),
    sanitizePath, // production sanitizer
    getBytesByHandle: vi.fn().mockReturnValue(null),
    computeBufferHash,
    combineEngine: combinePdfs,
    registerHandle,
    ...overrides,
  };
}

describe('handlePdfCombine', () => {
  it('rejects < 2 sources with invalid_source', async () => {
    const deps = makeDeps();
    const res = await handlePdfCombine({ sources: [] }, deps);
    expectErr(res, 'invalid_source');
  });

  it('rejects invalid page range (end < start)', async () => {
    const deps = makeDeps();
    const res = await handlePdfCombine(
      {
        sources: [
          { kind: 'handle', handle: 1, pageRange: { start: 5, end: 1 } },
          { kind: 'handle', handle: 2 },
        ],
      },
      deps,
    );
    expectErr(res, 'invalid_page_range');
  });

  it('rejects malformed payload with invalid_source', async () => {
    const deps = makeDeps();
    // missing `sources` key entirely
    const res = await handlePdfCombine({}, deps);
    expectErr(res, 'invalid_source');
  });

  it('returns handle_not_found when a handle source is not in the store', async () => {
    const deps = makeDeps({
      getBytesByHandle: vi.fn().mockReturnValue(null),
    });
    const res = await handlePdfCombine(
      {
        sources: [
          { kind: 'handle', handle: 99 },
          { kind: 'handle', handle: 100 },
        ],
      },
      deps,
    );
    expectErr(res, 'handle_not_found');
  });

  it('returns path_rejected when sanitizer rejects (production sanitizer wired)', async () => {
    // Production sanitizer rejects relative paths, traversal, non-.pdf,
    // UNC, etc. A traversal vector is rejected by the production sanitizer
    // but accepted by a permissive stub — proves the real one is wired.
    const deps = makeDeps();
    const res = await handlePdfCombine(
      {
        sources: [
          { kind: 'path', path: 'C:/temp/../etc/passwd.pdf' },
          { kind: 'path', path: 'C:/temp/b.pdf' },
        ],
      },
      deps,
    );
    expectErr(res, 'path_rejected');
  });

  it('returns path_rejected for a non-.pdf extension (production sanitizer)', async () => {
    const deps = makeDeps();
    const res = await handlePdfCombine(
      {
        sources: [
          { kind: 'path', path: 'C:/temp/a.exe' },
          { kind: 'path', path: 'C:/temp/b.pdf' },
        ],
      },
      deps,
    );
    expectErr(res, 'path_rejected');
  });

  it('returns fs_read_failed if readFile throws', async () => {
    const deps = makeDeps({
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
    });
    const res = await handlePdfCombine(
      {
        sources: [
          { kind: 'path', path: 'C:/temp/a.pdf' },
          { kind: 'path', path: 'C:/temp/b.pdf' },
        ],
      },
      deps,
    );
    expectErr(res, 'fs_read_failed');
  });

  it('propagates combine_invalid_source from the engine with sourceIndex detail', async () => {
    const good = await makePdf([{ width: 612, height: 792 }]);
    const bad = new Uint8Array([0x00, 0x00, 0x00]);
    const reads = [good, bad];
    let idx = 0;
    const deps = makeDeps({
      readFile: vi.fn().mockImplementation(async () => reads[idx++]!),
    });
    const res = await handlePdfCombine(
      {
        sources: [
          { kind: 'path', path: 'C:/temp/a.pdf' },
          { kind: 'path', path: 'C:/temp/b.pdf' },
        ],
      },
      deps,
    );
    expectErr(res, 'combine_invalid_source');
    if (!res.ok) {
      expect(res.details?.sourceIndex).toBe(1);
    }
  });

  it('happy path: combines two real PDFs, registers a handle, returns hash + page count', async () => {
    const a = await makePdf([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ]);
    const b = await makePdf([{ width: 595, height: 842 }]);
    const reads = [a, b];
    let idx = 0;
    const { registerHandle, captured } = makeRegisterHandle();
    const deps = makeDeps({
      readFile: vi.fn().mockImplementation(async () => reads[idx++]!),
      registerHandle,
    });
    const res = await handlePdfCombine(
      {
        sources: [
          { kind: 'path', path: 'C:/temp/a.pdf' },
          { kind: 'path', path: 'C:/temp/b.pdf' },
        ],
      },
      deps,
    );
    const val = expectOk(res);
    expect(val.pageCount).toBe(3);
    expect(val.displayName).toBe('Combined.pdf');
    expect(val.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(val.warnings).toEqual([]);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.pageCount).toBe(3);
    expect(captured[0]!.bytes.byteLength).toBeGreaterThan(0);
    expect(captured[0]!.path).toBeNull(); // in-memory until Save-As
    // The output bytes are a valid PDF.
    const round = await PDFDocument.load(captured[0]!.bytes);
    expect(round.getPageCount()).toBe(3);
  });

  it('happy path: combines via handle-only sources (no fs touch)', async () => {
    const a = await makePdf([{ width: 612, height: 792 }]);
    const b = await makePdf([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ]);
    const handleBytes: Record<number, Uint8Array> = { 7: a, 8: b };
    const readFile = vi.fn();
    const { registerHandle, captured } = makeRegisterHandle();
    const deps = makeDeps({
      readFile,
      getBytesByHandle: (h) => handleBytes[h] ?? null,
      registerHandle,
    });
    const res = await handlePdfCombine(
      {
        sources: [
          { kind: 'handle', handle: 7 },
          { kind: 'handle', handle: 8 },
        ],
      },
      deps,
    );
    const val = expectOk(res);
    expect(val.pageCount).toBe(3);
    expect(readFile).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);
  });
});
