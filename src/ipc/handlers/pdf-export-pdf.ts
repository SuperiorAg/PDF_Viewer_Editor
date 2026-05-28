// Handler: pdf:export (Phase 2, Live)
//
// Phase 2 (architecture-phase-2.md §3.8, edit-replay-engine.md §12).
// Replaces the Phase-1 stub. Implements the dual-engine pattern:
//   - pdf-lib: replay({ originalBytes, ops, annotations }) -> newBytes
//   - chromium: offscreen BrowserWindow + webContents.printToPDF()
//   - auto: heuristic per architecture §3.8 picks based on doc signals
//
// The export returns the bytes in the response (renderer writes to disk
// via a follow-up dialog:saveAs / fs:writePdf chain, or the renderer's
// thunk can pipe directly through outputPath). Phase 2 ships the bytes-
// in-response model to match Phase 1's PdfExportValue contract.

import type { ReplayInput, ReplayOk } from '../../main/pdf-ops/replay-engine.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  ExportEnginePreference,
  PdfExportError,
  PdfExportRequest,
  PdfExportResponse,
  PdfExportValue,
} from '../contracts.js';

export interface PdfExportDeps {
  hasHandle(handle: DocumentHandle): boolean;
  getBytes(handle: DocumentHandle): Uint8Array | null;
  /** Replay engine — same as fs:applyEditOps. */
  replay(
    input: ReplayInput,
  ): Promise<{ ok: true; value: ReplayOk } | { ok: false; error: string; message: string }>;
  /**
   * Chromium engine: creates a hidden BrowserWindow with the security
   * floor (contextIsolation, sandbox, no nodeIntegration), loads the
   * source bytes via the pdfedit:// protocol, calls
   * `webContents.printToPDF()` and returns the captured bytes.
   *
   * The wrapper enforces L-001: any BrowserWindow it creates preserves
   * the default `enableDragDropFiles` (omit the property — Electron
   * default is true). The wrapper MUST destroy the window after capture.
   */
  chromiumExport(input: {
    bytes: Uint8Array;
    pageRange?: { start: number; end: number };
    deterministic: boolean;
  }): Promise<
    | { ok: true; value: { bytes: Uint8Array; warnings: string[] } }
    | { ok: false; error: 'engine_failed_chromium' | 'cancelled'; message: string }
  >;
  /**
   * The auto-engine heuristic. Inputs: ops list, annotation subtypes,
   * any pre-known load warnings. Output: 'pdf-lib' | 'chromium' with a
   * reason string.
   */
  pickEngine(
    bytes: Uint8Array,
    ops: PdfExportRequest['ops'],
    annotations: PdfExportRequest['annotations'],
  ): { engine: 'pdf-lib' | 'chromium'; reason: string };
}

export async function handlePdfExport(
  req: PdfExportRequest,
  deps: PdfExportDeps,
): Promise<PdfExportResponse> {
  // ---- Validate -----------------------------------------------------------
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<PdfExportError>('handle_not_found', 'handle must be an integer');
  }
  if (!deps.hasHandle(req.handle)) {
    return fail<PdfExportError>('handle_not_found', `handle ${req.handle} not found`);
  }
  const validPrefs: ReadonlySet<ExportEnginePreference> = new Set(['auto', 'pdf-lib', 'chromium']);
  if (!validPrefs.has(req.preference)) {
    return fail<PdfExportError>('invalid_payload', 'preference must be auto|pdf-lib|chromium');
  }

  const bytes = deps.getBytes(req.handle);
  if (!bytes) {
    return fail<PdfExportError>('handle_not_found', `handle ${req.handle} has no bytes`);
  }

  const ops = req.ops ?? [];
  const annotations = req.annotations ?? [];

  // ---- Engine selection ---------------------------------------------------
  let chosen: 'pdf-lib' | 'chromium';
  let reason: string;
  let forcedBy: 'user' | 'heuristic';
  if (req.preference === 'pdf-lib' || req.preference === 'chromium') {
    chosen = req.preference;
    reason = `user-forced engine: ${req.preference}`;
    forcedBy = 'user';
  } else {
    const picked = deps.pickEngine(bytes, ops, annotations);
    chosen = picked.engine;
    reason = picked.reason;
    forcedBy = 'heuristic';
  }

  // ---- Dispatch -----------------------------------------------------------
  if (chosen === 'pdf-lib') {
    const r = await deps.replay({
      originalBytes: bytes,
      ops,
      annotations,
      jobId: `export-${Date.now()}`,
      ...(req.emitBookmarksToOutline !== undefined
        ? { emitBookmarksToOutline: req.emitBookmarksToOutline }
        : {}),
    });
    if (!r.ok) {
      return mapReplayErr('pdf-lib', r.error, r.message);
    }
    const value: PdfExportValue = {
      engine: 'pdf-lib',
      reason,
      forcedBy,
      warnings: r.value.warnings,
      outputBytes: r.value.newBytes,
    };
    return ok(value);
  }

  // Chromium path
  const chromium = await deps.chromiumExport({ bytes, deterministic: false });
  if (!chromium.ok) {
    if (chromium.error === 'cancelled') {
      return fail<PdfExportError>('cancelled', chromium.message);
    }
    return fail<PdfExportError>('engine_failed_chromium', chromium.message);
  }
  const value: PdfExportValue = {
    engine: 'chromium',
    reason,
    forcedBy,
    warnings: chromium.value.warnings,
    outputBytes: chromium.value.bytes,
  };
  return ok(value);
}

function mapReplayErr(
  engine: 'pdf-lib' | 'chromium',
  error: string,
  message: string,
): PdfExportResponse {
  // pdf-lib path errors mapped to the export error union.
  switch (error) {
    case 'op_apply_failed':
      return fail<PdfExportError>('op_apply_failed', message);
    case 'image_decode_failed':
      return fail<PdfExportError>('image_decode_failed', message);
    case 'text_span_not_found':
      return fail<PdfExportError>('text_span_not_found', message);
    case 'missing_glyph':
      return fail<PdfExportError>('missing_glyph', message);
    case 'serialize_failed':
      return fail<PdfExportError>('serialize_failed', message);
    case 'encrypted_unsupported':
      return fail<PdfExportError>('encrypted_unsupported', message);
    default:
      return fail<PdfExportError>(
        engine === 'pdf-lib' ? 'engine_failed_pdflib' : 'engine_failed_chromium',
        message,
      );
  }
}

// ============================================================================
// Default heuristic + Chromium wrapper — exported so register.ts can wire.
// ============================================================================

/**
 * Default heuristic per architecture-phase-2.md §3.8.
 * Phase-2 conservative — relies on the ops/annotation signals available
 * without re-parsing the PDF. Phase 2.5 may add pdf-lib load-warning
 * introspection.
 */
export function defaultPickEngine(
  bytes: Uint8Array,
  ops: PdfExportRequest['ops'],
  annotations: PdfExportRequest['annotations'],
): { engine: 'pdf-lib' | 'chromium'; reason: string } {
  void bytes;
  const opsArr = ops ?? [];
  const annotsArr = annotations ?? [];

  // text-replace -> pdf-lib (Chromium would substitute the font).
  if (opsArr.some((op) => op.kind === 'text-replace')) {
    return { engine: 'pdf-lib', reason: 'text-replace ops require pdf-lib for font preservation' };
  }
  // many image-overlays -> pdf-lib (Chromium reflows; many overlays compose better via direct write).
  const overlayCount = opsArr.filter((op) => op.kind === 'image-overlay').length;
  if (overlayCount > 10) {
    return { engine: 'pdf-lib', reason: `${overlayCount} image overlays -> pdf-lib direct write` };
  }
  // Ink annotation -> Chromium (best vector fidelity).
  if (annotsArr.some((a) => a.subtype === 'Ink')) {
    return {
      engine: 'chromium',
      reason: 'Ink annotations present -> Chromium for vector fidelity',
    };
  }
  // Default: pdf-lib.
  return { engine: 'pdf-lib', reason: 'default — pdf-lib preserves source structure' };
}
