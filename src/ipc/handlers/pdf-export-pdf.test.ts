// Tests for pdf:export (Phase 2 Live) handler — Wave 7, David.

import { describe, expect, it, vi } from 'vitest';

import { defaultPickEngine, handlePdfExport } from './pdf-export-pdf.js';
import type { PdfExportDeps } from './pdf-export-pdf.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(overrides: Partial<PdfExportDeps> = {}): PdfExportDeps {
  return {
    hasHandle: (_h: number) => true,
    getBytes: (_h: number) => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    replay: vi.fn(async () => ({
      ok: true as const,
      value: {
        newBytes: new Uint8Array([9, 9, 9]),
        warnings: ['test-warn'],
        engineUsed: 'pdf-lib' as const,
        byteCount: 3,
        durationMs: 1,
        annotationRefAssignments: {},
      },
    })),
    chromiumExport: vi.fn(async () => ({
      ok: true as const,
      value: { bytes: new Uint8Array([7, 7, 7, 7]), warnings: [] },
    })),
    pickEngine: () => ({ engine: 'pdf-lib', reason: 'unit-test heuristic' }),
    ...overrides,
  };
}

describe('pdf:export handler — Phase 2 Live', () => {
  it('rejects unknown handle', async () => {
    const deps = makeDeps({ hasHandle: () => false });
    const res = await handlePdfExport({ handle: 99, preference: 'auto' }, deps);
    expectErr(res, 'handle_not_found');
  });

  it('rejects invalid preference', async () => {
    const deps = makeDeps();
    const res = await handlePdfExport({ handle: 1, preference: 'xeon' as unknown as 'auto' }, deps);
    expectErr(res, 'invalid_payload');
  });

  it('runs the pdf-lib engine when user forces it', async () => {
    const deps = makeDeps();
    const res = await handlePdfExport({ handle: 1, preference: 'pdf-lib' }, deps);
    const value = expectOk(res);
    expect(value.engine).toBe('pdf-lib');
    expect(value.forcedBy).toBe('user');
    expect(value.outputBytes.byteLength).toBe(3);
  });

  it('runs the chromium engine when user forces it', async () => {
    const deps = makeDeps();
    const res = await handlePdfExport({ handle: 1, preference: 'chromium' }, deps);
    const value = expectOk(res);
    expect(value.engine).toBe('chromium');
    expect(value.outputBytes.byteLength).toBe(4);
  });

  it('uses the heuristic when preference is auto', async () => {
    const deps = makeDeps({
      pickEngine: () => ({ engine: 'chromium', reason: 'heuristic-says-chromium' }),
    });
    const res = await handlePdfExport({ handle: 1, preference: 'auto' }, deps);
    const value = expectOk(res);
    expect(value.engine).toBe('chromium');
    expect(value.forcedBy).toBe('heuristic');
    expect(value.reason).toBe('heuristic-says-chromium');
  });

  it('surfaces replay engine errors as the matching PdfExportError', async () => {
    const deps = makeDeps({
      replay: vi.fn(async () => ({
        ok: false as const,
        error: 'missing_glyph',
        message: 'codepoint 0xfc not in font WinAnsi',
      })),
    });
    const res = await handlePdfExport({ handle: 1, preference: 'pdf-lib' }, deps);
    expectErr(res, 'missing_glyph');
  });

  it('surfaces chromium failures as engine_failed_chromium', async () => {
    const deps = makeDeps({
      chromiumExport: vi.fn(async () => ({
        ok: false as const,
        error: 'engine_failed_chromium' as const,
        message: 'offscreen window dead',
      })),
    });
    const res = await handlePdfExport({ handle: 1, preference: 'chromium' }, deps);
    expectErr(res, 'engine_failed_chromium');
  });
});

// Wave 8 (D-8.2): wire-up test that exercises the real exportViaChromium
// factory (mocked Electron) through the handler dep injection point. Asserts
// the handler's "chromium" preference path and the engineUsed field.
describe('pdf:export handler — Chromium path wired via exportViaChromium (D-8.2)', () => {
  it('passes preference: chromium through to the deps.chromiumExport adapter', async () => {
    const chromiumSpy: PdfExportDeps['chromiumExport'] = vi.fn(async (input) => {
      // Capture the input bytes via the closure-bound `lastInput` so the
      // assertion below sees a typed value rather than wrestling with vi.fn's
      // generic Mock<...> argument tuple.
      lastInput = input;
      return {
        ok: true as const,
        value: {
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
          warnings: [],
        },
      };
    });
    let lastInput: { bytes: Uint8Array } | undefined;
    const deps = makeDeps({ chromiumExport: chromiumSpy });
    const res = await handlePdfExport({ handle: 1, preference: 'chromium' }, deps);
    const value = expectOk(res);
    // engine field should match the contract spec (api-contracts §12 / brief D-8.2)
    expect(value.engine).toBe('chromium');
    expect(value.forcedBy).toBe('user');
    expect(value.outputBytes.byteLength).toBe(8);
    // Adapter received the source bytes (proves the wiring)
    expect(chromiumSpy).toHaveBeenCalledTimes(1);
    expect(lastInput?.bytes).toBeInstanceOf(Uint8Array);
  });

  it('surfaces cancelled from chromium adapter as PdfExportError cancelled', async () => {
    const deps = makeDeps({
      chromiumExport: vi.fn(async () => ({
        ok: false as const,
        error: 'cancelled' as const,
        message: 'user dismissed dialog',
      })),
    });
    const res = await handlePdfExport({ handle: 1, preference: 'chromium' }, deps);
    expectErr(res, 'cancelled');
  });
});

describe('defaultPickEngine heuristic', () => {
  it('picks pdf-lib for text-replace ops', () => {
    const r = defaultPickEngine(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      [
        {
          kind: 'text-replace',
          meta: { ts: 1, undoable: true, operationId: 'x' },
          pageIndex: 0,
          objectId: '1/0/0',
          oldText: 'a',
          newText: 'b',
        },
      ],
      [],
    );
    expect(r.engine).toBe('pdf-lib');
  });

  it('picks chromium when Ink annotations are present', () => {
    const r = defaultPickEngine(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      [],
      [
        {
          id: 'a1',
          pageIndex: 0,
          subtype: 'Ink',
          rect: { x: 0, y: 0, width: 10, height: 10 },
          color: { r: 0, g: 0, b: 0 },
          opacity: 1,
          createdAt: 1,
          modifiedAt: 1,
          dirty: true,
        },
      ],
    );
    expect(r.engine).toBe('chromium');
  });

  it('default to pdf-lib for ordinary docs', () => {
    const r = defaultPickEngine(new Uint8Array([0x25, 0x50, 0x44, 0x46]), [], []);
    expect(r.engine).toBe('pdf-lib');
  });
});
