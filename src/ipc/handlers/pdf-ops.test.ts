import { describe, it } from 'vitest';

import { handlePdfCombine, handlePdfExport, handlePdfGetOutline } from './pdf-ops.js';
import { expectErr } from './test-support.js';

describe('pdf:combine (Phase 1 stub)', () => {
  it('rejects < 2 sources', () => {
    const res = handlePdfCombine({ sources: [] });
    expectErr(res, 'invalid_source');
  });

  it('rejects invalid page range', () => {
    const res = handlePdfCombine({
      sources: [
        { kind: 'handle', handle: 1, pageRange: { start: 5, end: 1 } },
        { kind: 'handle', handle: 2 },
      ],
    });
    expectErr(res, 'invalid_page_range');
  });

  it('valid request returns not_implemented (typed stub)', () => {
    const res = handlePdfCombine({
      sources: [
        { kind: 'handle', handle: 1 },
        { kind: 'handle', handle: 2 },
      ],
    });
    expectErr(res, 'not_implemented');
  });
});

describe('pdf:export (Phase 1 stub-validator)', () => {
  // Phase 2 (Wave 7): the real export logic lives in
  // src/ipc/handlers/pdf-export-pdf.ts; this `handlePdfExport` in
  // pdf-ops.ts is retained as a thin pre-validation gate. The Phase-2
  // contract removed 'not_implemented' from PdfExportError, so this test
  // now asserts the validator's 'cancelled' / 'invalid_payload' surfaces.
  it('rejects non-int handle', () => {
    const res = handlePdfExport({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handle: 'bad' as any,
      preference: 'auto',
    });
    expectErr(res, 'handle_not_found');
  });

  it('rejects invalid preference', () => {
    const res = handlePdfExport({
      handle: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      preference: 'xeon' as any,
    });
    expectErr(res, 'invalid_payload');
  });

  it('returns cancelled for valid request (validator stub; real handler in pdf-export-pdf.ts)', () => {
    const res = handlePdfExport({ handle: 1, preference: 'auto' });
    expectErr(res, 'cancelled');
  });
});

describe('pdf:getOutline (Phase 1 stub)', () => {
  it('returns not_implemented for valid handle', () => {
    const res = handlePdfGetOutline({ handle: 1 });
    expectErr(res, 'not_implemented');
  });
});
