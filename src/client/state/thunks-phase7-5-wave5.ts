// Phase 7.5 Wave 5 thunks — Document Properties (B21) + Password (B8) +
// Sanitize (B20). Per docs/ui-spec-phase-7.5.md §8/§20/§21 and
// docs/api-contracts.md §19.4.2-§19.4.4.
//
// Post-v0.8.0 cleanup 2026-06-18 (Riley, Julian 11.2 close):
// David's preload bridge for `getDocumentProperties`, `setDocumentProperties`,
// `setPasswordProtection`, `removeHiddenInfo` has landed (`src/preload/index.ts`,
// canonical types at `src/ipc/contracts.ts:5293-5302`). The four
// `(window.pdfApi!.pdf as any).method(req)` scars from Wave 5 are removed —
// the renderer now narrows through the proper PdfApi type. Only the outer
// `!window.pdfApi` honesty gate remains (it survives a renderer
// preload-bridge fault — the same shape every other thunks-phase* uses).
//
// The renderer's `applySanitizeThunk` arg keeps the legacy field name
// `invalidatesSignaturesConfirmed` for parity with the redaction + OCR
// renderer-side argument shapes (see `applyRedactionsThunk`,
// `runOcrOnDocumentThunk`). At the IPC boundary the thunk maps it to the
// canonical field name `confirmSignedDocOverwrite` David's handler validates.

import { createAsyncThunk } from '@reduxjs/toolkit';

import type {
  DocumentProperties,
  PdfGetDocumentPropertiesRequest,
  PdfGetDocumentPropertiesResponse,
  PdfRemoveHiddenInfoRequest,
  PdfRemoveHiddenInfoResponse,
  PdfSetDocumentPropertiesRequest,
  PdfSetDocumentPropertiesResponse,
  PdfSetPasswordProtectionRequest,
  PdfSetPasswordProtectionResponse,
} from '../types/ipc-contract';

import {
  setDocPropertiesApplyError,
  setDocPropertiesApplying,
  setApplyingSecurity,
  setDocPropertiesLoadError,
  setDocPropertiesLoaded,
  setDocPropertiesLoading,
} from './slices/document-properties-slice';
import {
  closeSanitize,
  selectedCategories,
  setSanitizeApplying,
  setSanitizeLastError,
  setPendingInvalidatedSignatureFields,
} from './slices/sanitize-slice';
import { pushToast } from './slices/ui-slice';
import { type AppDispatch, type RootState } from './store';

// ============================================================================
// IPC boundary — narrow `window.pdfApi.pdf` through the canonical PdfApi type.
// `bridge_unavailable` survives only as the outermost honesty gate (the
// renderer must not crash if preload didn't expose `window.pdfApi` at all);
// per-method feature-detect is no longer needed now David's Wave 5 bridge has
// landed and the methods are part of the canonical `PdfApi['pdf']` surface.
//
// The renderer-side response unions widen each canonical response with the
// renderer-only `bridge_unavailable` failure shape so the thunks' single
// `res.error === 'bridge_unavailable'` discriminant covers both. The
// canonical error union is the source of truth on the wire — this widening
// is renderer-local only.
// ============================================================================

/** Renderer-only failure shape returned by the IPC helpers when
 *  `window.pdfApi` is undefined (the preload bridge didn't run). */
interface BridgeUnavailableResult {
  ok: false;
  error: 'bridge_unavailable';
  message: string;
}

const BRIDGE_UNAVAILABLE: BridgeUnavailableResult = {
  ok: false,
  error: 'bridge_unavailable',
  message: 'window.pdfApi is not exposed',
};

type RendererResponse<R> = R | BridgeUnavailableResult;

function pdfBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && window.pdfApi !== undefined;
}

async function callGetDocumentProperties(
  req: PdfGetDocumentPropertiesRequest,
): Promise<RendererResponse<PdfGetDocumentPropertiesResponse>> {
  if (!pdfBridgeAvailable()) return BRIDGE_UNAVAILABLE;
  // pdfBridgeAvailable() narrows at runtime; TS can't carry that narrowing
  // across the call boundary, so the non-null assertion is the right
  // expression here (no `as any`).
  return window.pdfApi!.pdf.getDocumentProperties(req);
}

async function callSetDocumentProperties(
  req: PdfSetDocumentPropertiesRequest,
): Promise<RendererResponse<PdfSetDocumentPropertiesResponse>> {
  if (!pdfBridgeAvailable()) return BRIDGE_UNAVAILABLE;
  return window.pdfApi!.pdf.setDocumentProperties(req);
}

async function callSetPasswordProtection(
  req: PdfSetPasswordProtectionRequest,
): Promise<RendererResponse<PdfSetPasswordProtectionResponse>> {
  if (!pdfBridgeAvailable()) return BRIDGE_UNAVAILABLE;
  return window.pdfApi!.pdf.setPasswordProtection(req);
}

async function callRemoveHiddenInfo(
  req: PdfRemoveHiddenInfoRequest,
): Promise<RendererResponse<PdfRemoveHiddenInfoResponse>> {
  if (!pdfBridgeAvailable()) return BRIDGE_UNAVAILABLE;
  return window.pdfApi!.pdf.removeHiddenInfo(req);
}

// ============================================================================
// Thunks.
// ============================================================================

/** Fetch the document's properties + security summary; populates the slice
 *  on success or sets a load error toast on failure. */
export const loadDocumentPropertiesThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('documentProperties/load', async (_arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) {
    dispatch(setDocPropertiesLoadError('No document open.'));
    return;
  }
  dispatch(setDocPropertiesLoading(true));
  const res = await callGetDocumentProperties({ handle: doc.handle });
  if (!res.ok) {
    dispatch(setDocPropertiesLoadError(res.message));
    // Don't fire a toast for `bridge_unavailable` — the modal renders the
    // honest "engine pending" state inline. Other errors get a toast since
    // they indicate a real failure.
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    return;
  }
  dispatch(
    setDocPropertiesLoaded({
      properties: res.value.properties,
      securitySummary: res.value.securitySummary,
      pageSizes: res.value.pageSizes,
      loadedAt: Date.now(),
    }),
  );
});

export interface ApplyDocumentPropertiesArg {
  /** Only the fields the user changed; reducers in the slice serialize
   *  keywordsText into the keywords[] field before the thunk is invoked. */
  properties: Partial<DocumentProperties>;
}

/** Apply description-tab changes; on success, refetches the snapshot. */
export const applyDocumentPropertiesThunk = createAsyncThunk<
  void,
  ApplyDocumentPropertiesArg,
  { dispatch: AppDispatch; state: RootState }
>('documentProperties/apply', async (arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) {
    dispatch(setDocPropertiesApplyError('No document open.'));
    return;
  }
  dispatch(setDocPropertiesApplying(true));
  try {
    const res = await callSetDocumentProperties({
      handle: doc.handle,
      properties: arg.properties,
    });
    if (!res.ok) {
      dispatch(setDocPropertiesApplyError(res.message));
      dispatch(pushToast({ kind: 'error', message: res.message }));
      return;
    }
    dispatch(pushToast({ kind: 'success', message: 'Document properties updated.' }));
    // Refresh the cached snapshot so the read-only "Modified" / Producer fields
    // reflect David's engine's just-written values.
    await dispatch(loadDocumentPropertiesThunk());
  } finally {
    dispatch(setDocPropertiesApplying(false));
  }
});

export interface ApplyPasswordProtectionArg {
  /** Mirrors the qpdf channel shape; the slice's Security tab marshals here. */
  openPassword: string | null;
  permissionsPassword: string | null;
  permissions: PdfSetPasswordProtectionRequest['permissions'];
  encryption: PdfSetPasswordProtectionRequest['encryption'];
}

/** Apply qpdf password / permissions. Mirrors the redaction flow's pattern. */
export const applyPasswordProtectionThunk = createAsyncThunk<
  void,
  ApplyPasswordProtectionArg,
  { dispatch: AppDispatch; state: RootState }
>('documentProperties/applyPassword', async (arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) {
    dispatch(setDocPropertiesApplyError('No document open.'));
    return;
  }
  dispatch(setApplyingSecurity(true));
  try {
    const res = await callSetPasswordProtection({
      handle: doc.handle,
      openPassword: arg.openPassword,
      permissionsPassword: arg.permissionsPassword,
      permissions: arg.permissions,
      encryption: arg.encryption,
    });
    if (!res.ok) {
      dispatch(setDocPropertiesApplyError(res.message));
      // Engine-unavailable surfaces an honest "qpdf not bundled yet" toast.
      const msg =
        res.error === 'engine_unavailable'
          ? 'qpdf encryption engine is not available in this build.'
          : res.error === 'password_too_short'
            ? 'Password is too short for the selected encryption strength.'
            : res.message;
      dispatch(pushToast({ kind: 'error', message: msg }));
      return;
    }
    dispatch(
      pushToast({
        kind: 'success',
        message: 'Encryption applied. Reopen the document to view the protected bytes.',
      }),
    );
    // Refresh the cached snapshot so the Security tab's read-only summary
    // reflects the new encryption state.
    await dispatch(loadDocumentPropertiesThunk());
  } finally {
    dispatch(setApplyingSecurity(false));
  }
});

export interface ApplySanitizeArg {
  invalidatesSignaturesConfirmed: boolean;
}

/** Apply the sanitize categories the user has checked. Mirrors the redaction
 *  Apply flow's PAdES gate: first call without the confirm flag; if engine
 *  returns `signed_pdf_requires_confirm`, surface the field-name list in the
 *  slice + leave the modal open for the user to re-arm with confirmed=true.
 *
 *  At the IPC boundary the renderer's `invalidatesSignaturesConfirmed` is
 *  mapped to the canonical handler-side field `confirmSignedDocOverwrite`
 *  (the renderer keeps the legacy name for parity with redactions + OCR).
 *  When the engine returns the signed-PDF gate error, the field-name list
 *  lives at `details.signatureFieldNames` per the canonical `Result.fail`
 *  shape — read it from there, not from the legacy stub field. */
export const applySanitizeThunk = createAsyncThunk<
  void,
  ApplySanitizeArg,
  { dispatch: AppDispatch; state: RootState }
>('sanitize/apply', async (arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) {
    dispatch(setSanitizeLastError('No document open.'));
    return;
  }
  const categories = selectedCategories(state.sanitize.checked);
  if (categories.length === 0) {
    dispatch(setSanitizeLastError('Select at least one category to remove.'));
    return;
  }
  dispatch(setSanitizeApplying(true));
  try {
    const res = await callRemoveHiddenInfo({
      handle: doc.handle,
      categories,
      ...(arg.invalidatesSignaturesConfirmed === true ? { confirmSignedDocOverwrite: true } : {}),
    });
    if (!res.ok) {
      if (res.error === 'signed_pdf_requires_confirm') {
        // Canonical `Result.fail` surfaces engine-side metadata via the
        // `details` bag. The sanitize engine populates
        // `details.signatureFieldNames` (see
        // `src/main/pdf-ops/sanitize-engine.ts` `signed_pdf_requires_confirm`
        // branch).
        const detailFields = (res.details?.['signatureFieldNames'] ?? []) as string[];
        const fields = Array.isArray(detailFields) ? detailFields : [];
        dispatch(setPendingInvalidatedSignatureFields(fields));
        // Modal stays open; user re-clicks Sanitize after confirming the
        // signature paragraph.
        return;
      }
      dispatch(setSanitizeLastError(res.message));
      dispatch(pushToast({ kind: 'error', message: res.message }));
      return;
    }
    // Honest warnings first, then success toast.
    for (const w of res.value.warnings) {
      dispatch(pushToast({ kind: 'warning', message: w }));
    }
    const removedTotal = Object.values(res.value.itemsRemoved).reduce<number>(
      (sum, n) => sum + (n ?? 0),
      0,
    );
    dispatch(
      pushToast({
        kind: 'success',
        message: `Sanitized: ${res.value.categoriesApplied.length} categor${
          res.value.categoriesApplied.length === 1 ? 'y' : 'ies'
        } cleaned (${removedTotal} item${removedTotal === 1 ? '' : 's'} removed). Reopen the document to verify.`,
      }),
    );
    dispatch(closeSanitize());
  } finally {
    dispatch(setSanitizeApplying(false));
  }
});
