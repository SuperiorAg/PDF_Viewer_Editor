// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { composeScanToPdf } from '../../main/pdf-ops/scan-to-pdf.js';
import { encodePngRgbaForTest } from '../../main/pdf-ops/tiff-decoder.js';
import type { WiaAddon, NativeScannedPage } from '../../main/pdf-ops/wia-scanner.js';

import { handleScanAcquire, type ScanAcquireDeps } from './scan-acquire.js';

// Build a tiny solid-color PNG page via the project's own encoder (no external
// image dep) so the REAL composeScanToPdf can embed it.
function pngPage(w: number, h: number, pageIndex: number): NativeScannedPage {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 200;
    rgba[i + 1] = 200;
    rgba[i + 2] = 255;
    rgba[i + 3] = 255;
  }
  return { bytes: encodePngRgbaForTest(rgba, w, h), format: 'png', pageIndex };
}

function mockAddon(over: Partial<WiaAddon>): WiaAddon {
  return {
    platform: 'win32',
    listDevices: async () => ({ devices: [] }),
    acquire: async () => ({ pages: [pngPage(8, 8, 0)] }),
    ...over,
  };
}

// A registrar that captures the composed bytes so tests can re-open the PDF.
function makeDeps(over: Partial<ScanAcquireDeps>): {
  deps: ScanAcquireDeps;
  captured: { bytes: Uint8Array | null; pageCount: number };
} {
  const captured: { bytes: Uint8Array | null; pageCount: number } = { bytes: null, pageCount: 0 };
  const deps: ScanAcquireDeps = {
    addon: mockAddon({}),
    composeScanToPdf,
    registerScannedPdf: (bytes, displayName, pageCount) => {
      captured.bytes = bytes;
      captured.pageCount = pageCount;
      return { handle: 42, displayName };
    },
    now: () => new Date('2026-05-28T09:30:00Z').getTime(),
    ...over,
  };
  return { deps, captured };
}

describe('scan:acquire (Phase 5.1 — LIVE, api-contracts.md §16.10)', () => {
  it('acquires a single page and returns a handle', async () => {
    const { deps } = makeDeps({});
    const r = await handleScanAcquire({ resolution: 300, colorMode: 'color' }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.handle).toBe(42);
      expect(r.value.pageCount).toBe(1);
      expect(r.value.displayName).toMatch(/^Scan 2026-05-28/);
    }
  });

  it('composes a multi-page ADF scan into a SINGLE PDF with the right page count', async () => {
    const { deps, captured } = makeDeps({
      addon: mockAddon({
        acquire: async () => ({
          pages: [pngPage(8, 8, 0), pngPage(8, 8, 1), pngPage(8, 8, 2)],
        }),
      }),
    });
    const r = await handleScanAcquire({ source: 'feeder' }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pageCount).toBe(3);
    // Verify the captured bytes are a real 3-page PDF.
    expect(captured.bytes).not.toBeNull();
    const doc = await PDFDocument.load(captured.bytes!);
    expect(doc.getPageCount()).toBe(3);
  });

  it('degrades to scanner_unavailable when the addon is null', async () => {
    const { deps } = makeDeps({ addon: null });
    const r = await handleScanAcquire({}, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('scanner_unavailable');
  });

  it('maps a native acquisition_failed to acquisition_failed', async () => {
    const { deps } = makeDeps({
      addon: mockAddon({
        acquire: async () => ({ __wiaError: 'acquisition_failed', detail: 'Download hr=-1' }),
      }),
    });
    const r = await handleScanAcquire({}, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('acquisition_failed');
  });

  it('maps a native no_device to no_device', async () => {
    const { deps } = makeDeps({
      addon: mockAddon({ acquire: async () => ({ __wiaError: 'no_device', detail: 'none' }) }),
    });
    const r = await handleScanAcquire({}, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_device');
  });

  it('treats zero acquired pages as acquisition_failed (not a 0-page PDF)', async () => {
    const { deps } = makeDeps({
      addon: mockAddon({ acquire: async () => ({ pages: [] }) }),
    });
    const r = await handleScanAcquire({}, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('acquisition_failed');
  });

  it('surfaces a page_decode_failed when an undecodable page is returned', async () => {
    const { deps } = makeDeps({
      addon: mockAddon({
        acquire: async () => ({
          pages: [{ bytes: new Uint8Array([1, 2, 3, 4]), format: 'bmp', pageIndex: 0 }],
        }),
      }),
    });
    const r = await handleScanAcquire({}, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('page_decode_failed');
  });

  it('rejects an invalid payload (unknown field) with invalid_payload', async () => {
    const { deps } = makeDeps({});
    const r = await handleScanAcquire({ resolution: 50 }, deps); // below min 72
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });
});
