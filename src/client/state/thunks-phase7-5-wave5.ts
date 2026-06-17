// Phase 7.5 Wave 5 thunks — Document Properties (B21) + Password (B8) +
// Sanitize (B20). Per docs/ui-spec-phase-7.5.md §8/§20/§21 and
// docs/api-contracts.md §19.4.2-§19.4.4.
//
// IPC routing follows the same parallel-wave coordination pattern Wave 2
// established for `pdf:applyRedactions` (see thunks-phase7-4.ts module
// header): feature-detect the bridge method on `window.pdfApi?.pdf?.<name>`
// and short-circuit with a structurally-correct `'bridge_unavailable'` /
// `'engine_failed'` Result when missing. The thunks never `as any` the api
// proxy — they only narrow the bridge namespace inline at call time so
// David's parallel preload-bridge commit can land without renderer
// re-mapping. When David lands the canonical types in `src/ipc/contracts.ts`,
// the locally-typed stubs in `types/{document-properties,sanitize}-contract-stub.ts`
// will be promoted to re-export wrappers (mirroring the
// `links-contract-stub.ts` Wave-4 promotion path).

import { createAsyncThunk } from '@reduxjs/toolkit';

import {
  type DocumentProperties,
  type PdfGetDocumentPropertiesRequest,
  type PdfGetDocumentPropertiesResponse,
  type PdfSetDocumentPropertiesRequest,
  type PdfSetDocumentPropertiesResponse,
  type PdfSetPasswordProtectionRequest,
  type PdfSetPasswordProtectionResponse,
} from '../types/document-properties-contract-stub';
import {
  type PdfRemoveHiddenInfoRequest,
  type PdfRemoveHiddenInfoResponse,
} from '../types/sanitize-contract-stub';

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
// Feature-detect adapters — same pattern as thunks-phase7-4.ts.
// ============================================================================

function bridgeOk(): boolean {
  return typeof window !== 'undefined' && window.pdfApi !== undefined;
}

async function callGetDocumentProperties(
  req: PdfGetDocumentPropertiesRequest,
): Promise<PdfGetDocumentPropertiesResponse> {
  if (!bridgeOk()) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi is not exposed',
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfNs = window.pdfApi!.pdf as any;
  if (typeof pdfNs?.getDocumentProperties !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message:
        'window.pdfApi.pdf.getDocumentProperties is not exposed (David Wave 5 not yet landed)',
    };
  }
  return (await pdfNs.getDocumentProperties(req)) as PdfGetDocumentPropertiesResponse;
}

async function callSetDocumentProperties(
  req: PdfSetDocumentPropertiesRequest,
): Promise<PdfSetDocumentPropertiesResponse> {
  if (!bridgeOk()) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi is not exposed',
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfNs = window.pdfApi!.pdf as any;
  if (typeof pdfNs?.setDocumentProperties !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message:
        'window.pdfApi.pdf.setDocumentProperties is not exposed (David Wave 5 not yet landed)',
    };
  }
  return (await pdfNs.setDocumentProperties(req)) as PdfSetDocumentPropertiesResponse;
}

async function callSetPasswordProtection(
  req: PdfSetPasswordProtectionRequest,
): Promise<PdfSetPasswordProtectionResponse> {
  if (!bridgeOk()) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi is not exposed',
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfNs = window.pdfApi!.pdf as any;
  if (typeof pdfNs?.setPasswordProtection !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message:
        'window.pdfApi.pdf.setPasswordProtection is not exposed (David Wave 5 not yet landed)',
    };
  }
  return (await pdfNs.setPasswordProtection(req)) as PdfSetPasswordProtectionResponse;
}

async function callRemoveHiddenInfo(
  req: PdfRemoveHiddenInfoRequest,
): Promise<PdfRemoveHiddenInfoResponse> {
  if (!bridgeOk()) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi is not exposed',
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfNs = window.pdfApi!.pdf as any;
  if (typeof pdfNs?.removeHiddenInfo !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf.removeHiddenInfo is not exposed (David Wave 5 not yet landed)',
    };
  }
  return (await pdfNs.removeHiddenInfo(req)) as PdfRemoveHiddenInfoResponse;
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
 *  slice + leave the modal open for the user to re-arm with confirmed=true. */
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
      ...(arg.invalidatesSignaturesConfirmed === true
        ? { invalidatesSignaturesConfirmed: true }
        : {}),
    });
    if (!res.ok) {
      if (res.error === 'signed_pdf_requires_confirm') {
        const fields = res.invalidatedSignatureFields ?? [];
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
    const removedTotal = Object.values(res.value.itemsRemoved).reduce(
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
