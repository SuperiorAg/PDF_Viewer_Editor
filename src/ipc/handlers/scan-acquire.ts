// Handler: scan:acquire (Phase 5.1 placeholder, api-contracts.md §16.10)
//
// Same Q-E deferral as scan:listDevices. Always returns
// `Result<never, 'not_implemented_phase_5_1'>`.

import { fail } from '../../shared/result.js';
import type { ScanAcquireError, ScanAcquireRequest, ScanAcquireResponse } from '../contracts.js';

export async function handleScanAcquire(_req: unknown): Promise<ScanAcquireResponse> {
  return fail<ScanAcquireError>(
    'not_implemented_phase_5_1',
    'Scanner integration ships in Phase 5.1; Phase 5 file-import + OCR only',
  );
}

export type _UnusedReq = ScanAcquireRequest;
