// Handler: scan:acquire — LIVE in Phase 5.1 (api-contracts.md §16.10)
//
// Phase 5.1 (Wave 5.1, David): acquire pages from a WIA scanner and compose
// them into a single PDF (scan -> PDF). Bytes do NOT cross IPC — the composed
// PDF is registered in the document store and a DocumentHandle is returned
// (same discipline as dialog:openPdf / pdf:combine), so the renderer opens the
// scan exactly like any other document.
//
// DISCIPLINE (conventions §16 + brief requirement C):
//   - zod safeParse at the boundary.
//   - Addon + composer + register are REQUIRED on the deps interface
//     (library-injection). Tests inject mocks; a null addon degrades to a typed
//     `scanner_unavailable` Result.
//   - Returns `Result<T,E>`; never throws across the IPC bridge.

import { z } from 'zod';

import type { ScanPage, ScanToPdfError } from '../../main/pdf-ops/scan-to-pdf.js';
import {
  acquireVia,
  type ScanError,
  type WiaAddon,
} from '../../main/pdf-ops/wia-scanner.js';
import { fail, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';
import type {
  DocumentHandle,
  ScanAcquireError,
  ScanAcquireRequest,
  ScanAcquireResponse,
} from '../contracts.js';

export interface ScanAcquireDeps {
  /** REQUIRED on the interface; null VALUE = graceful-degrade (see listDevices). */
  addon: WiaAddon | null;
  /** Compose scanned pages into a single PDF. Production: composeScanToPdf. */
  composeScanToPdf: (
    pages: ScanPage[],
  ) => Promise<Result<{ bytes: Uint8Array; pageCount: number; warnings: string[] }, ScanToPdfError>>;
  /**
   * Register the composed PDF in the document store; returns the handle +
   * display name the renderer opens with. Production wraps documentStore.register.
   */
  registerScannedPdf: (
    bytes: Uint8Array,
    displayName: string,
    pageCount: number,
  ) => { handle: DocumentHandle; displayName: string };
  /** Clock for the default display name; tests inject a fixed clock. */
  now?: () => number;
}

const requestSchema = z
  .object({
    deviceId: z.string().min(1).optional(),
    resolution: z.number().int().min(72).max(1200).optional(),
    colorMode: z.enum(['bw', 'grayscale', 'color']).optional(),
    source: z.enum(['auto', 'flatbed', 'feeder']).optional(),
  })
  .strict();

function mapScanError(e: ScanError): ScanAcquireError {
  switch (e) {
    case 'scanner_unavailable':
      return 'scanner_unavailable';
    case 'no_device':
      return 'no_device';
    case 'device_open_failed':
      return 'device_open_failed';
    case 'no_scan_item':
      return 'no_scan_item';
    case 'transfer_unsupported':
      return 'transfer_unsupported';
    case 'acquisition_failed':
      return 'acquisition_failed';
    case 'enumeration_failed':
    case 'addon_internal_error':
    default:
      return 'addon_internal_error';
  }
}

function mapComposeError(e: ScanToPdfError): ScanAcquireError {
  switch (e) {
    case 'no_pages':
      return 'acquisition_failed';
    case 'page_decode_failed':
      return 'page_decode_failed';
    case 'pdf_compose_failed':
    default:
      return 'pdf_compose_failed';
  }
}

function defaultDisplayName(now: number): string {
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `Scan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function handleScanAcquire(
  req: unknown,
  deps: ScanAcquireDeps,
): Promise<ScanAcquireResponse> {
  const parsed = requestSchema.safeParse(req ?? {});
  if (!parsed.success) {
    return fail<ScanAcquireError>('invalid_payload', parsed.error.message);
  }
  const data = parsed.data;

  // Acquire raw image pages from the scanner.
  const acquired = await acquireVia(deps.addon, {
    ...(data.deviceId !== undefined ? { deviceId: data.deviceId } : {}),
    ...(data.resolution !== undefined ? { resolution: data.resolution } : {}),
    ...(data.colorMode !== undefined ? { colorMode: data.colorMode } : {}),
    ...(data.source !== undefined ? { source: data.source } : {}),
  });
  if (!acquired.ok) {
    return fail<ScanAcquireError>(mapScanError(acquired.error), acquired.message);
  }

  // Compose the pages into a single PDF.
  const pages: ScanPage[] = acquired.value.pages.map((p) => ({ bytes: p.bytes, format: p.format }));
  const composed = await deps.composeScanToPdf(pages);
  if (!composed.ok) {
    return fail<ScanAcquireError>(mapComposeError(composed.error), composed.message);
  }

  // Register in the document store; return a handle (bytes never cross IPC).
  const clock = deps.now ?? Date.now;
  const name = defaultDisplayName(clock());
  const registered = deps.registerScannedPdf(composed.value.bytes, name, composed.value.pageCount);

  return ok({
    handle: registered.handle,
    displayName: registered.displayName,
    pageCount: composed.value.pageCount,
    warnings: composed.value.warnings,
  });
}

// Keep the alias alive under verbatimModuleSyntax.
export type _UnusedReq = ScanAcquireRequest;
