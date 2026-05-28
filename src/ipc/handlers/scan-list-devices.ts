// Handler: scan:listDevices — LIVE in Phase 5.1 (api-contracts.md §16.9)
//
// Phase 5.1 (Wave 5.1, David): the native WIA addon (native/wia-scanner/) makes
// this channel LIVE on Windows. Replaces the Phase-5 `not_implemented_phase_5_1`
// placeholder.
//
// DISCIPLINE (conventions §16 + brief requirement C):
//   - The addon is injected via a REQUIRED `addon` field on the deps interface
//     (library-injection seam, like the OCR pool + auto-updater). Tests inject
//     a mock addon; production injects the real `WiaAddon | null` from
//     scan-bootstrap.ts.
//   - A null addon (non-Windows / addon missing) degrades to a typed
//     `scanner_unavailable` Result — NEVER a crash, NEVER a silent no-op.
//   - Returns `Result<T,E>`; never throws across the IPC bridge.

import {
  listDevicesVia,
  type ScanError,
  type WiaAddon,
} from '../../main/pdf-ops/wia-scanner.js';
import { fail, ok } from '../../shared/result.js';
import type {
  ScanListDevicesError,
  ScanListDevicesRequest,
  ScanListDevicesResponse,
} from '../contracts.js';

export interface ScanListDevicesDeps {
  /**
   * REQUIRED on the interface (no optional stub fallback). The VALUE may be
   * null — that's the explicit, tested graceful-degrade path (non-Windows /
   * addon missing), not an omitted dep.
   */
  addon: WiaAddon | null;
}

// Native ScanError -> handler error union. listDevices only surfaces the
// enumeration-relevant subset; everything else collapses to scanner_unavailable.
function mapError(e: ScanError): ScanListDevicesError {
  switch (e) {
    case 'enumeration_failed':
      return 'enumeration_failed';
    case 'addon_internal_error':
      return 'addon_internal_error';
    case 'scanner_unavailable':
    case 'no_device':
    case 'device_open_failed':
    case 'no_scan_item':
    case 'transfer_unsupported':
    case 'acquisition_failed':
    default:
      return 'scanner_unavailable';
  }
}

export async function handleScanListDevices(
  _req: unknown,
  deps: ScanListDevicesDeps,
): Promise<ScanListDevicesResponse> {
  const result = await listDevicesVia(deps.addon);
  if (!result.ok) {
    return fail<ScanListDevicesError>(mapError(result.error), result.message);
  }
  return ok({ devices: result.value.devices });
}

// Keep the alias alive under verbatimModuleSyntax.
export type _UnusedReq = ScanListDevicesRequest;
