// Phase 4.1 (Riley) — pdf-loader unit tests. The loader is the SINGLE funnel
// that composes (a) `window.pdfApi.fs.readBytesByHandle` and (b)
// `getPdfRenderService().loadDocument(bytes)` into a single async call. We
// mock both seams here.
//
// The "cached PdfDocumentProxy per handle" contract is the load-bearing
// behavior — without it, every zoom change in PdfCanvas would re-fetch the
// bytes from main and re-parse the PDF, which is wasteful at best and a UI
// hang at worst on a 50 MB document.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, fail } from '../../shared/result';

import { _resetPdfLoaderForTests, loadDocumentByHandle, releaseLoadedDocument } from './pdf-loader';

// Mock the pdf-render module to avoid pulling pdf.js into this test.
const fakeDoc = {
  pageCount: 3,
  getPage: vi.fn(),
  destroy: vi.fn(async () => undefined),
};
const loadDocumentMock = vi.fn(async (_bytes: Uint8Array) => fakeDoc);
vi.mock('./pdf-render', () => ({
  getPdfRenderService: () => ({
    loadDocument: loadDocumentMock,
    shutdown: async () => undefined,
  }),
}));

interface ReadBytesArgs {
  handle: number;
}
const readBytesMock = vi.fn();

function stubPdfApi(impl: (req: ReadBytesArgs) => Promise<unknown>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = (globalThis as any).window ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window.pdfApi = {
    fs: {
      readBytesByHandle: (req: ReadBytesArgs) => impl(req),
    },
  };
  readBytesMock.mockImplementation(impl);
}

function clearPdfApi(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window.pdfApi = undefined;
}

beforeEach(async () => {
  await _resetPdfLoaderForTests();
  loadDocumentMock.mockClear();
  readBytesMock.mockClear();
  fakeDoc.destroy.mockClear();
  clearPdfApi();
});

describe('pdf-loader — happy path', () => {
  it('fetches bytes via IPC and loads them into pdf.js, returning the proxy', async () => {
    stubPdfApi(async () => ok({ bytes: new Uint8Array([1, 2, 3, 4, 5]) }));

    const res = await loadDocumentByHandle(42);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc).toBe(fakeDoc);
    expect(loadDocumentMock).toHaveBeenCalledTimes(1);
    const passedBytes = loadDocumentMock.mock.calls[0]![0];
    expect(Array.from(passedBytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it('caches the proxy per-handle and reuses it on a second call', async () => {
    stubPdfApi(async () => ok({ bytes: new Uint8Array([1]) }));

    const a = await loadDocumentByHandle(7);
    const b = await loadDocumentByHandle(7);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.doc).toBe(b.doc);
    }
    // pdf.js parse happened exactly once, IPC fetch happened exactly once.
    expect(loadDocumentMock).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates concurrent loads for the same handle', async () => {
    let resolveBytes!: (v: { bytes: Uint8Array }) => void;
    stubPdfApi(
      () =>
        new Promise((resolve) => {
          resolveBytes = (v) => resolve(ok(v));
        }),
    );

    const p1 = loadDocumentByHandle(99);
    const p2 = loadDocumentByHandle(99);
    resolveBytes({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.doc).toBe(r2.doc);
    expect(loadDocumentMock).toHaveBeenCalledTimes(1);
  });
});

describe('pdf-loader — error variants', () => {
  it('surfaces fs:readBytesByHandle error variants unchanged', async () => {
    stubPdfApi(async () => fail('unknown_handle', 'handle not found in store'));
    const res = await loadDocumentByHandle(404);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('unknown_handle');
    expect(res.message).toBe('handle not found in store');
    expect(loadDocumentMock).not.toHaveBeenCalled();
  });

  it('surfaces document_evicted from the IPC layer', async () => {
    stubPdfApi(async () => fail('document_evicted', 'handle bytes purged'));
    const res = await loadDocumentByHandle(5);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('document_evicted');
  });

  it("returns 'pdfjs_load_failed' when pdf.js itself rejects", async () => {
    stubPdfApi(async () => ok({ bytes: new Uint8Array([0]) }));
    loadDocumentMock.mockRejectedValueOnce(new Error('Invalid PDF structure'));
    const res = await loadDocumentByHandle(11);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('pdfjs_load_failed');
    expect(res.message).toBe('Invalid PDF structure');
  });

  it("returns 'bridge_unavailable' when window.pdfApi is absent", async () => {
    // No stubPdfApi call — pdfApi is undefined; api.ts fallback fires.
    const res = await loadDocumentByHandle(1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('bridge_unavailable');
  });
});

describe('pdf-loader — release lifecycle', () => {
  it('destroys the proxy on release and drops the cache entry', async () => {
    stubPdfApi(async () => ok({ bytes: new Uint8Array([0]) }));
    await loadDocumentByHandle(15);
    expect(fakeDoc.destroy).toHaveBeenCalledTimes(0);

    await releaseLoadedDocument(15);
    expect(fakeDoc.destroy).toHaveBeenCalledTimes(1);

    // Next call after release should re-fetch + re-parse (cache empty).
    await loadDocumentByHandle(15);
    expect(loadDocumentMock).toHaveBeenCalledTimes(2);
  });

  it('release is idempotent for unknown handles', async () => {
    await expect(releaseLoadedDocument(999)).resolves.toBeUndefined();
  });
});
