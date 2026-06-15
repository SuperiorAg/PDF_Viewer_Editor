// Phase 7.4 B1 thunks — Redaction engine integration.
// Per docs/phase-7.4-b1-redaction-design.md §3 (IPC contract).
//
// applyRedactionsThunk:
//   1. Pre-flight: if no marks, dispatch a defensive error (UI gates this).
//   2. Flatten the `byPage` slice into the channel's flat `redactions[]` shape.
//   3. First-pass call WITHOUT `invalidatesSignaturesConfirmed`.
//   4. If the engine returns `signed_pdf_requires_confirm`, store the field-
//      name list in the slice + open the Apply modal (the modal is open already
//      in our flow — it just renders the signature paragraph reactively).
//   5. On the second pass with the flag, on success: clear marks + reload doc.
//
// David's IPC channel contract (per design §3.1) is:
//   window.pdfApi.pdf.applyRedactions(req: PdfApplyRedactionsRequest)
//     => Promise<Result<PdfApplyRedactionsValue, PdfApplyRedactionsError>>
//
// David's IPC contract entries (PdfApi.pdf.applyRedactions + the request /
// value / error / response types) are landing in his Wave 2 commit. Until
// then we type the surface LOCALLY in this file with the exact shape from the
// design doc so the typecheck passes today. When David lands, the local
// PdfApplyRedactions* types in this file should be deleted and the channel
// should be reached via the `api.pdf` namespace's typed surface. The runtime
// dispatch path here works in both cases: it feature-detects
// `window.pdfApi?.pdf?.applyRedactions` and routes through to it.

import { createAsyncThunk } from '@reduxjs/toolkit';

import { fail } from '../../shared/result';
import { type DocumentHandle } from '../types/ipc-contract';

// Per conventions, slice imports are alphabetical; this group orders cleanly.
import {
  applySucceeded,
  type RedactionApplyError,
  setApplyError,
  setApplying,
  setPendingInvalidatedSignatureFields,
} from './slices/redactions-slice';
import { pushToast, setRedactionApplyModalOpen } from './slices/ui-slice';
import { type AppDispatch, type RootState } from './store';

// ============================================================================
// Local IPC types (mirror David's design §3.1; remove once landed)
// ============================================================================

interface RedactionRectIpc {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfApplyRedactionsRequest {
  handle: DocumentHandle;
  redactions: RedactionRectIpc[];
  invalidatesSignaturesConfirmed?: boolean;
  rasterDpi?: number;
}

interface PdfApplyRedactionsValue {
  bytes: Uint8Array;
  pagesRedacted: number;
  rectsApplied: number;
  invalidatedSignatures: boolean;
  invalidatedSignatureFields: string[];
  warnings: string[];
}

type PdfApplyRedactionsErrorCode =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'no_redactions'
  | 'page_out_of_range'
  | 'rect_invalid'
  | 'signed_pdf_requires_confirm'
  | 'pdf_load_failed'
  | 'rasterize_failed'
  | 'engine_failed'
  | 'output_too_large'
  | 'cancelled';

/**
 * Result with a side-channel `invalidatedSignatureFields` on the error branch
 * — the engine carries that list when error === 'signed_pdf_requires_confirm'.
 * Mirrors David's response shape (Result.details may also carry it; either
 * shape is handled below).
 */
type PdfApplyRedactionsResponse =
  | { ok: true; value: PdfApplyRedactionsValue }
  | {
      ok: false;
      error: PdfApplyRedactionsErrorCode;
      message: string;
      invalidatedSignatureFields?: string[];
      details?: Record<string, unknown>;
    };

// ============================================================================
// Adapter — feature-detect the bridge method until David's PdfApi update lands.
// ============================================================================

async function callApplyRedactions(
  req: PdfApplyRedactionsRequest,
): Promise<PdfApplyRedactionsResponse> {
  if (typeof window === 'undefined' || !window.pdfApi) {
    return fail<'engine_failed'>('engine_failed', 'window.pdfApi is not exposed') as never;
  }
  // Feature-detect: David's preload adds .applyRedactions to .pdf. Until then,
  // any caller hits the bridge_unavailable path (and the renderer's slice
  // surfaces it as a generic "engine_failed" toast — we map below).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfNs = window.pdfApi.pdf as any;
  if (typeof pdfNs?.applyRedactions !== 'function') {
    return fail<'engine_failed'>(
      'engine_failed',
      'window.pdfApi.pdf.applyRedactions is not exposed (David Wave 2 not yet landed)',
    ) as never;
  }
  return (await pdfNs.applyRedactions(req)) as PdfApplyRedactionsResponse;
}

// ============================================================================
// applyRedactionsThunk — the Apply flow.
// ============================================================================

export interface ApplyRedactionsThunkArg {
  /** Whether the user already confirmed the signature-invalidation paragraph. */
  invalidatesSignaturesConfirmed: boolean;
  /** Raster DPI; if omitted, the engine uses its default. */
  rasterDpi?: number;
}

export const applyRedactionsThunk = createAsyncThunk<
  PdfApplyRedactionsValue | null,
  ApplyRedactionsThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('redactions/apply', async (arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) {
    dispatch(setApplyError('handle_not_found'));
    dispatch(pushToast({ kind: 'error', message: 'No document open.' }));
    return null;
  }
  const byPage = state.redactions.byPage;
  // Flatten {pageIndex -> mark[]} to a list of {pageIndex, x, y, w, h}.
  const redactions: RedactionRectIpc[] = [];
  for (const k of Object.keys(byPage)) {
    const pageIndex = Number(k);
    const marks = byPage[pageIndex] ?? [];
    for (const m of marks) {
      redactions.push({
        pageIndex,
        x: m.rect.x,
        y: m.rect.y,
        width: m.rect.width,
        height: m.rect.height,
      });
    }
  }
  if (redactions.length === 0) {
    dispatch(setApplyError('no_redactions'));
    return null;
  }

  dispatch(setApplying(true));

  const req: PdfApplyRedactionsRequest = {
    handle: doc.handle,
    redactions,
    invalidatesSignaturesConfirmed: arg.invalidatesSignaturesConfirmed,
    ...(arg.rasterDpi !== undefined ? { rasterDpi: arg.rasterDpi } : {}),
  };

  let res: PdfApplyRedactionsResponse;
  try {
    res = await callApplyRedactions(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Redaction engine error.';
    dispatch(setApplyError('engine_failed'));
    dispatch(pushToast({ kind: 'error', message: `Redaction engine error: ${msg}` }));
    return null;
  }

  if (!res.ok) {
    if (res.error === 'signed_pdf_requires_confirm') {
      // Engine surfaced the field-name list — engine may carry it inline
      // (res.invalidatedSignatureFields) or in `details.invalidatedSignatureFields`.
      const fields =
        res.invalidatedSignatureFields ??
        (res.details?.['invalidatedSignatureFields'] as string[] | undefined) ??
        [];
      dispatch(setPendingInvalidatedSignatureFields(fields));
      dispatch(setApplyError('signed_pdf_requires_confirm'));
      // The Apply modal is already open at this point (user clicked Apply).
      // The modal reads pendingInvalidatedSignatureFields and re-renders with
      // the signature paragraph + a re-arm button that re-dispatches us with
      // invalidatesSignaturesConfirmed: true.
      return null;
    }
    dispatch(setApplyError(res.error as RedactionApplyError));
    return null;
  }

  // Success. Clear marks, close modal, surface honest warnings.
  dispatch(applySucceeded());
  dispatch(setRedactionApplyModalOpen(false));

  // Honest warnings: surface each one as a toast (one toast per warning so the
  // user can read each). Trust-floor obligation #B1-1 ("redacted pages lose
  // searchability") is the canonical post-Apply disclosure.
  for (const w of res.value.warnings) {
    dispatch(pushToast({ kind: 'warning', message: w }));
  }
  dispatch(
    pushToast({
      kind: 'success',
      message: `Redaction applied: ${res.value.rectsApplied} area(s) on ${res.value.pagesRedacted} page(s). Reopen the document to view the redacted bytes.`,
    }),
  );

  return res.value;
});
