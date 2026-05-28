// Tests for pdf:print handler — Phase 2 (Wave 7, David).

import { describe, it, vi } from 'vitest';

import { handlePdfPrint } from './pdf-print.js';
import { expectErr } from './test-support.js';

function deps(bytes: Uint8Array | null) {
  return {
    hasHandle: (_h: number) => bytes !== null,
    getBytes: (_h: number) => bytes,
    replay: vi.fn(async () => ({
      ok: true as const,
      value: {
        newBytes: new Uint8Array([1, 2, 3]),
        warnings: [],
        engineUsed: 'pdf-lib' as const,
        byteCount: 3,
        durationMs: 1,
        annotationRefAssignments: {},
      },
    })),
    dispatchPrint: vi.fn(async () => ({
      ok: false as const,
      error: 'print_dispatch_failed' as const,
      message: 'Phase-2 conservative — Wave 8 wires the real adapter',
    })),
  };
}

describe('pdf:print handler', () => {
  it('rejects non-integer handle', async () => {
    const r = await handlePdfPrint(
      { handle: 'bad' as unknown as number, ops: [], annotations: [] },
      deps(new Uint8Array([1])),
    );
    expectErr(r, 'invalid_payload');
  });

  it('rejects unknown handle', async () => {
    const r = await handlePdfPrint({ handle: 1, ops: [], annotations: [] }, deps(null));
    expectErr(r, 'handle_not_found');
  });

  it('rejects non-array ops', async () => {
    const r = await handlePdfPrint(
      {
        handle: 1,
        ops: 'not-an-array' as unknown as never,
        annotations: [],
      },
      deps(new Uint8Array([1])),
    );
    expectErr(r, 'invalid_payload');
  });

  it('surfaces print_dispatch_failed from the deps wrapper (Phase-2 conservative)', async () => {
    const r = await handlePdfPrint(
      { handle: 1, ops: [], annotations: [] },
      deps(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    );
    expectErr(r, 'print_dispatch_failed');
  });

  // Wave 8 (D-8.3): wire-up test that proves the dispatchPrint dep returns
  // ok and the handler emits jobDispatched: true. The real adapter
  // (dispatchPrintViaElectron) is covered by src/main/print-window.test.ts;
  // here we just verify the handler propagates a successful dispatch.
  it('returns jobDispatched: true when dispatchPrint resolves ok (D-8.3 wire-up)', async () => {
    const d = {
      hasHandle: () => true,
      getBytes: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      replay: vi.fn(async () => ({
        ok: true as const,
        value: {
          newBytes: new Uint8Array([1, 2, 3]),
          warnings: [],
          engineUsed: 'pdf-lib' as const,
          byteCount: 3,
          durationMs: 1,
          annotationRefAssignments: {},
        },
      })),
      dispatchPrint: vi.fn(async () => ({ ok: true as const })),
    };
    const r = await handlePdfPrint({ handle: 1, ops: [], annotations: [] }, d);
    if (!r.ok) {
      throw new Error(`expected ok, got error: ${r.error}: ${r.message}`);
    }
    if (r.value.jobDispatched !== true) {
      throw new Error('expected jobDispatched: true');
    }
    if (r.value.engineUsed !== 'pdf-lib') {
      throw new Error('expected engineUsed: pdf-lib');
    }
  });
});
