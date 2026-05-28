// Phase 4 thunks. Separate from the main thunks.ts to keep the existing
// Phase 1/2/3 thunk surface stable (one file, ~1041 lines) and absorb the
// new Phase 4 IPC calls into a dedicated module. Aggregate `thunks.ts`
// re-exports the new thunks so callers keep one import path.

import { createAsyncThunk } from '@reduxjs/toolkit';

import { apiAnnotationsP4, apiSignatures } from '../services/api';
import {
  type AnnotationsAddShapeRequest,
  type EditOperation,
  type MeasureCalibration,
  type PadesAppearanceSpec,
  type ShapeAnnotationModel,
  type SignaturePlacement,
  type VisualAppearanceSpec,
} from '../types/ipc-contract';

import { applyEdit } from './slices/document-slice';
import {
  removeAuditRow,
  setAuditError,
  setAuditItems,
  setAuditLoading,
  setMeasureCalibration as setMeasureCalibrationAction,
  setVerifyResult,
} from './slices/signature-audit-slice';
import {
  closeSignatureModal,
  enterPlacement,
  setCert,
  setSignatureError,
  setSigning,
} from './slices/signatures-slice';
import { pushToast } from './slices/ui-slice';
import { type AppDispatch, type RootState } from './store';

// =============================================================================
// Cert lifecycle
// =============================================================================

export interface LoadCertThunkArg {
  pfxBytes: Uint8Array;
  password: string;
}

/** Compatibility thunk — most call sites go through the modal's inline IPC
 * dispatch (which carries the password-clear discipline). This thunk exists
 * for non-modal flows (drag-drop of a PFX onto the PadesSignModal step 1).
 * The caller MUST clear its local password state BEFORE awaiting this
 * thunk's promise (conventions §15.1 rule 2). */
export const loadCertThunk = createAsyncThunk<
  void,
  LoadCertThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('signatures/loadCert', async (arg, { dispatch }) => {
  try {
    const res = await apiSignatures.certLoad({
      pfxBytes: arg.pfxBytes,
      password: arg.password,
    });
    if (!res.ok) {
      dispatch(setSignatureError(res.message));
      return;
    }
    dispatch(setCert(res.value));
  } catch (e) {
    dispatch(setSignatureError(e instanceof Error ? e.message : 'Cert load failed.'));
  }
});

export interface ReleaseCertThunkArg {
  handle: string;
}

export const releaseCertThunk = createAsyncThunk<
  void,
  ReleaseCertThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('signatures/releaseCert', async (arg) => {
  // Fire-and-forget. The handle MAY already be released (autoRelease=true on
  // applyPades); the IPC handler is idempotent.
  try {
    await apiSignatures.certRelease({ handle: arg.handle });
  } catch {
    // Swallow — release is best-effort cleanup; the main-process
    // before-quit handler is the real guarantee.
  }
});

// =============================================================================
// Apply visual signature
// =============================================================================

export interface ApplyVisualSignatureThunkArg {
  appearance: VisualAppearanceSpec;
  placement: SignaturePlacement;
}

export const applyVisualSignatureThunk = createAsyncThunk<
  void,
  ApplyVisualSignatureThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('signatures/applyVisual', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  dispatch(setSignatureError(null));
  try {
    const res = await apiSignatures.applyVisual({
      handle: doc.handle,
      placement: arg.placement,
      appearance: arg.appearance,
    });
    if (!res.ok) {
      dispatch(
        pushToast({
          kind: 'error',
          message: `Apply signature failed: ${res.message}`,
        }),
      );
      dispatch(setSignatureError(res.message));
      return;
    }
    for (const w of res.value.warnings) {
      dispatch(pushToast({ kind: 'warning', message: w }));
    }
    dispatch(applyEdit(res.value.op as EditOperation));
    dispatch(pushToast({ kind: 'success', message: 'Signature placed.' }));
    dispatch(closeSignatureModal());
  } catch (e) {
    dispatch(
      pushToast({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Apply signature failed.',
      }),
    );
  }
});

// =============================================================================
// Apply PAdES signature
// =============================================================================

export interface ApplyPadesSignatureThunkArg {
  placement: SignaturePlacement;
  certHandle: string;
  reason?: string;
  location?: string;
  useTsa: boolean;
}

export const applyPadesSignatureThunk = createAsyncThunk<
  void,
  ApplyPadesSignatureThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('signatures/applyPades', async (arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) return;
  // Build appearance from the slice's captured-signature + sign options.
  const captured = state.signatures.captured;
  const options = state.signatures.padesOptions;
  if (!captured) {
    dispatch(setSignatureError('Capture a signature appearance first.'));
    return;
  }
  const appearance: PadesAppearanceSpec = {
    source: captured.source,
    showName: captured.showName,
    showDate: options.showDate,
    showReason: options.showReason && (arg.reason ?? '').length > 0,
    showSubjectCN: options.showSubjectCN,
    showIssuerCN: options.showIssuerCN,
    showTsaInfo: options.showTsaInfo,
  };
  if (arg.reason !== undefined && arg.reason.length > 0) appearance.reason = arg.reason;

  dispatch(setSigning(true));
  dispatch(setSignatureError(null));
  try {
    const req: Parameters<typeof apiSignatures.applyPades>[0] = {
      handle: doc.handle,
      placement: arg.placement,
      certHandle: arg.certHandle,
      appearance,
      tsaUrl: arg.useTsa ? null : null, // resolved by main from settings when useTsa=true
      autoRelease: true,
    };
    if (arg.reason !== undefined) req.reason = arg.reason;
    if (arg.location !== undefined) req.location = arg.location;
    const res = await apiSignatures.applyPades(req);
    if (!res.ok) {
      const msg =
        res.error === 'cert_expired'
          ? 'This certificate is expired.'
          : res.error === 'tsa_timeout'
            ? 'Timestamping service did not respond within the timeout.'
            : res.message;
      dispatch(setSignatureError(msg));
      dispatch(pushToast({ kind: 'error', message: `Sign failed: ${msg}` }));
      return;
    }
    dispatch(applyEdit(res.value.op as EditOperation));
    dispatch(
      pushToast({
        kind: 'success',
        message: `Signed by ${res.value.signerSubjectCN}.`,
      }),
    );
    dispatch(closeSignatureModal());
    if (arg.placement.mode === 'freeform') {
      // Activate placement overlay so user can drag the visible signature.
      dispatch(
        enterPlacement({
          flow: 'pades',
          placement: arg.placement,
          certHandle: null,
        }),
      );
    }
  } catch (e) {
    dispatch(
      pushToast({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Sign failed.',
      }),
    );
  } finally {
    dispatch(setSigning(false));
  }
});

// =============================================================================
// Shape annotation add
// =============================================================================

export interface AddShapeAnnotationThunkArg {
  annotation: ShapeAnnotationModel;
}

export const addShapeAnnotationThunk = createAsyncThunk<
  void,
  AddShapeAnnotationThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('shapes/addShape', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  const req: AnnotationsAddShapeRequest = {
    handle: doc.handle,
    annotation: arg.annotation,
  };
  try {
    const res = await apiAnnotationsP4.addShape(req);
    if (!res.ok) {
      dispatch(
        pushToast({
          kind: 'error',
          message: `Add shape failed: ${res.message}`,
        }),
      );
      return;
    }
    for (const w of res.value.warnings) {
      dispatch(pushToast({ kind: 'warning', message: w }));
    }
    // Route through the single funnel — applyEdit per conventions/Phase 1.
    dispatch(applyEdit(res.value.op as EditOperation));
  } catch (e) {
    dispatch(
      pushToast({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Add shape failed.',
      }),
    );
  }
});

// =============================================================================
// Measure calibration
// =============================================================================

export interface SetMeasureCalibrationThunkArg {
  calibration: MeasureCalibration;
}

export const setMeasureCalibrationThunk = createAsyncThunk<
  void,
  SetMeasureCalibrationThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('shapes/setCalibration', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  try {
    const res = await apiAnnotationsP4.setMeasureCalibration({
      handle: doc.handle,
      calibration: arg.calibration,
    });
    if (!res.ok) {
      dispatch(
        pushToast({
          kind: 'error',
          message: `Calibration failed: ${res.message}`,
        }),
      );
      return;
    }
    dispatch(setMeasureCalibrationAction(arg.calibration));
    dispatch(pushToast({ kind: 'success', message: 'Calibration saved.' }));
  } catch (e) {
    dispatch(
      pushToast({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Calibration failed.',
      }),
    );
  }
});

// =============================================================================
// Signature audit log listing + verify + delete
// =============================================================================

export interface ListSignatureAuditThunkArg {
  fileHash?: string;
  signedByFingerprint?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export const listSignatureAuditThunk = createAsyncThunk<
  void,
  ListSignatureAuditThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('signatureAudit/list', async (arg, { dispatch }) => {
  dispatch(setAuditLoading(true));
  try {
    const res = await apiSignatures.listAudit(arg);
    if (!res.ok) {
      dispatch(setAuditError(res.message));
      return;
    }
    dispatch(setAuditItems({ items: res.value.items, total: res.value.total }));
  } catch (e) {
    dispatch(setAuditError(e instanceof Error ? e.message : 'List failed.'));
  }
});

export interface VerifySignatureThunkArg {
  auditLogRowId: number;
}

export const verifySignatureThunk = createAsyncThunk<
  void,
  VerifySignatureThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('signatureAudit/verify', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  try {
    const res = await apiSignatures.verify({
      handle: doc.handle,
      auditLogRowId: arg.auditLogRowId,
    });
    if (!res.ok) {
      dispatch(pushToast({ kind: 'error', message: `Verify failed: ${res.message}` }));
      return;
    }
    dispatch(
      setVerifyResult({
        id: arg.auditLogRowId,
        valid: res.value.valid,
        tamperedSinceSign: res.value.tamperedSinceSign,
      }),
    );
  } catch (e) {
    dispatch(
      pushToast({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Verify failed.',
      }),
    );
  }
});

export interface DeleteAuditRowThunkArg {
  id: number;
}

export const deleteAuditRowThunk = createAsyncThunk<
  void,
  DeleteAuditRowThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('signatureAudit/delete', async (arg, { dispatch }) => {
  // The delete IPC is not exposed yet (David Wave 16 may add); for now we
  // remove client-side from the panel — this is a manual override per
  // ui-spec.md §13.9 ("Delete row — does NOT affect signed bytes").
  // When David ships an IPC, we'll add the API call here.
  dispatch(removeAuditRow(arg.id));
  dispatch(pushToast({ kind: 'info', message: 'Audit row removed locally.' }));
});
