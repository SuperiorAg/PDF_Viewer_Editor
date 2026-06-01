import { describe, it } from 'vitest';

import { handlePdfExport, handlePdfGetOutline } from './pdf-ops.js';
import { expectErr } from './test-support.js';

// Wave-30 follow-up (H-30.1, David 2026-06-01): the original `pdf:combine`
// Phase-1 stub was removed from pdf-ops.ts. The real combine handler lives
// in `pdf-combine.ts` and its tests in `pdf-combine.test.ts`. This file now
// covers only the residual stubs in pdf-ops.ts (pdf:export validator, pdf:
// getOutline M-30.1 honest stub).

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

describe('pdf:getOutline (M-30.1 honest stub — zero callers)', () => {
  it('returns not_implemented for valid handle', () => {
    const res = handlePdfGetOutline({ handle: 1 });
    expectErr(res, 'not_implemented');
  });
});
