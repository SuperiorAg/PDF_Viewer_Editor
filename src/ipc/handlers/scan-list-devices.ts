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
  ScanListDevicesRequ