// Handler: pdf:print
//
// Phase 2 (api-contracts.md §12.4, architecture-phase-2.md §7).
// Replays the current ops + annotations to fresh bytes, then dispatches to
// the OS print dialog via Electron's `webContents.print()`. Print is
// fire-and-forget once dispatched; we don't track spool lifecycle.
//
// Phase 2 ships the OS-native print dialog (no custom print UI). The
// channel returns immediately after the print callback fires.

import type { ReplayInput, ReplayOk } from '../../main/pdf-ops/replay-engine.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfPrintError,
  PdfPrintRequest,
  PdfPrintResponse,
  PdfPrintValue,
} from '../contracts.js';

export interface PdfPrintDeps {
  hasHandle(handle: DocumentHandle): boolean;
  getBytes(handle: DocumentHandle): Uint8Array | null;
  replay(
    input: ReplayInput,
  ): Promise<{ ok: true; value: ReplayOk } | { ok: false; error: string; message: string }>;
  /**
   * Print the replayed PDF bytes via Electron's webContents.print(). Main
   * provides a wrapper that creates an offscreen window, loads the bytes
   * via the pdfedit:// protocol (or data URL), calls print(), then destroys
   * the window. Returns a Result indicating dispatch.
   */
  dispatchPrint(input: {
    bytes: Uint8Array;
    printerName?: string;
    pageRange?: { start: number; end: number };
    options?: PdfPrintRequest['options'];
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        error:
          | 'user_cancelled'
          | 'printer_not_found'
          | 'print_dispatch_failed'
          | 'no_printers_found';
        message: string;
      }
  >;
}

export async function handlePdfPrint(
  req: PdfPrintRequest,
  deps: PdfPrintDeps,
): Promise<PdfPrintResponse> {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<PdfPrintError>('invalid_payload', 'handle must be an integer');
  }
  if (!deps.hasHandle(req.handle)) {
    return fail<PdfPrintError>('handle_not_found', `handle ${req.handle} not found`);
  }
  if (!Array.isArray(req.ops) || !Array.isArray(req.annotations)) {
    return fail<PdfPrintError>('invalid_payload', 'ops + annotations must be arrays');
  }

  const bytes = deps.getBytes(req.handle);
  if (!bytes) {
    return fail<PdfPrintError>('handle_not_found', `handle ${req.handle} has no bytes`);
  }

  const r = await deps.replay({
    originalBytes: bytes,
    ops: req.ops,
    annotations: req.annotations,
    jobId: `print-${Date.now()}`,
  });
  if (!r.ok) {
    return fail<PdfPrintError>('replay_failed', r.message);
  }

  const printArgs: {
    bytes: Uint8Array;
    printerName?: string;
    pageRange?: { start: number; end: number };
    options?: PdfPrintRequest['options'];
  } = {
    bytes: r.value.newBytes,
    ...(req.printerName !== undefined ? { printerName: req.printerName } : {}),
    ...(req.pageRange !== undefined ? { pageRange: req.pageRange } : {}),
    ...(req.options !== undefined ? { options: req.options } : {}),
  };
  const dispatch = await deps.dispatchPrint(printArgs);
  if (!dispatch.ok) {
    return fail<PdfPrintError>(dispatch.error, dispatch.message);
  }

  const value: PdfPrintValue = {
    jobDispatched: true,
    engineUsed: 'pdf-lib',
    warnings: r.value.warnings,
  };
  return ok(value);
}
