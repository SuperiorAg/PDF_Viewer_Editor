// Signatures slice — Phase 4 capture + sign workflow state.
// Per docs/architecture-phase-4.md §2.3 and docs/ui-spec.md §13.3-§13.5.
//
// CRITICAL — Cert + password discipline (conventions §15.1):
//   The password is NEVER stored in this slice. It lives in the PadesSignModal's
//   component-local React state until passed to apiSignatures.certLoad and is
//   cleared (setPassword('')) BEFORE awaiting that promise. This slice carries
//   only the OPAQUE CertHandle returned by main + the displayable cert metadata
//   (subject CN, issuer CN, fingerprint, validity). Anyone touching this slice
//   should review conventions §15.1 before adding fields.
//
// Single source of truth for the sign workflow per the brief's "single funnel
// discipline" callout for Julian Wave 17.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  type PadesAppearanceSpec,
  type SignaturePlacement,
  type VisualAppearanceSource,
  type VisualAppearanceSpec,
} from '../../types/ipc-contract';

export type SignatureModal = 'none' | 'capture' | 'pades';

export type CaptureTab = 'typed' | 'drawn' | 'image';

export interface CapturedSignature {
  /** Discriminator drives downstream IPC payload shape. */
  source: VisualAppearanceSource;
  /** Optional reason text. */
  reason: string;
  /** UI toggles propagated into VisualAppearanceSpec. */
  showName: boolean;
  showDate: boolean;
  showReason: boolean;
}

export interface CertMetadata {
  handle: string;
  subjectCN: string;
  issuerCN: string;
  notBefore: number;
  notAfter: number;
  fingerprint: string;
  isExpired: boolean;
}

export type PadesStep = 'cert' | 'options' | 'sign';

export interface PadesOptions {
  reason: string;
  location: string;
  showSubjectCN: boolean;
  showIssuerCN: boolean;
  showDate: boolean;
  showReason: boolean;
  showTsaInfo: boolean;
  useTsa: boolean; // user's per-sign toggle; gated by settings.tsaEnabled
}

export interface PlacementState {
  /** When non-null, the signature is in placement mode awaiting drop. */
  active: boolean;
  /** 'visual' = call apiSignatures.applyVisual on drop; 'pades' = applyPades. */
  flow: 'visual' | 'pades' | null;
  placement: SignaturePlacement | null;
  /** For 'pades' flow, the cert handle to use when applying. */
  certHandle: string | null;
}

export interface SignaturesState {
  /** Which Phase-4 modal is open (only one at a time). */
  openModal: SignatureModal;
  /** Capture tab (typed/drawn/image). */
  captureTab: CaptureTab;
  /** Captured visual signature, ready to place. Null until user clicks Place. */
  captured: CapturedSignature | null;
  /** PAdES sign wizard step. */
  padesStep: PadesStep;
  /** Cert metadata (NOT password, NOT cert bytes — see conventions §15.1). */
  cert: CertMetadata | null;
  /** Sign options the user picked in step 2. */
  padesOptions: PadesOptions;
  /** In-flight sign operation (spinner state). */
  signing: boolean;
  /** Last error from a Phase-4 IPC call. Rendered inline + cleared on retry. */
  lastError: string | null;
  /** Placement overlay state — drives the visual placement flow. */
  placement: PlacementState;
}

const initialPadesOptions: PadesOptions = {
  reason: '',
  location: '',
  showSubjectCN: true,
  showIssuerCN: false,
  showDate: true,
  showReason: false,
  showTsaInfo: false,
  useTsa: false,
};

const initialState: SignaturesState = {
  openModal: 'none',
  captureTab: 'typed',
  captured: null,
  padesStep: 'cert',
  cert: null,
  padesOptions: initialPadesOptions,
  signing: false,
  lastError: null,
  placement: {
    active: false,
    flow: null,
    placement: null,
    certHandle: null,
  },
};

export const signaturesSlice = createSlice({
  name: 'signatures',
  initialState,
  reducers: {
    openCaptureModal(state) {
      state.openModal = 'capture';
      state.captureTab = 'typed';
      state.captured = null;
      state.lastError = null;
    },
    openPadesModal(state) {
      state.openModal = 'pades';
      state.padesStep = 'cert';
      state.cert = null;
      state.padesOptions = initialPadesOptions;
      state.signing = false;
      state.lastError = null;
    },
    closeModal(state) {
      state.openModal = 'none';
      // Cert metadata cleared; the actual handle is released via thunk side-effect.
      state.cert = null;
      state.padesStep = 'cert';
      state.captured = null;
      state.signing = false;
      state.lastError = null;
    },
    setCaptureTab(state, action: PayloadAction<CaptureTab>) {
      state.captureTab = action.payload;
    },
    setCaptured(state, action: PayloadAction<CapturedSignature>) {
      state.captured = action.payload;
    },
    setPadesStep(state, action: PayloadAction<PadesStep>) {
      state.padesStep = action.payload;
    },
    setCert(state, action: PayloadAction<CertMetadata>) {
      state.cert = action.payload;
      // After cert loads, advance to options step.
      state.padesStep = 'options';
      state.lastError = null;
    },
    clearCert(state) {
      state.cert = null;
      state.padesStep = 'cert';
    },
    setPadesOptions(state, action: PayloadAction<Partial<PadesOptions>>) {
      state.padesOptions = { ...state.padesOptions, ...action.payload };
    },
    setSigning(state, action: PayloadAction<boolean>) {
      state.signing = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.lastError = action.payload;
    },
    enterPlacement(
      state,
      action: PayloadAction<{
        flow: 'visual' | 'pades';
        placement: SignaturePlacement;
        certHandle: string | null;
      }>,
    ) {
      state.placement = {
        active: true,
        flow: action.payload.flow,
        placement: action.payload.placement,
        certHandle: action.payload.certHandle,
      };
      // Capture modal closes; placement overlay activates on the canvas.
      state.openModal = 'none';
    },
    updatePlacement(state, action: PayloadAction<SignaturePlacement>) {
      if (state.placement.active) {
        state.placement.placement = action.payload;
      }
    },
    exitPlacement(state) {
      state.placement = initialState.placement;
    },
    resetSignatures() {
      return initialState;
    },
  },
});

export const {
  openCaptureModal,
  openPadesModal,
  closeModal: closeSignatureModal,
  setCaptureTab,
  setCaptured,
  setPadesStep,
  setCert,
  clearCert,
  setPadesOptions,
  setSigning,
  setError: setSignatureError,
  enterPlacement,
  updatePlacement,
  exitPlacement,
  resetSignatures,
} = signaturesSlice.actions;

export default signaturesSlice.reducer;

// -----------------------------------------------------------------------------
// Helper builders — pure functions for assembling IPC payloads.
// -----------------------------------------------------------------------------

/**
 * Build a `VisualAppearanceSpec` from the captured-signature draft + the
 * appearance toggles. Visual signatures: showSubjectCN/IssuerCN/TsaInfo are
 * always false (no cert).
 */
export function buildVisualAppearanceSpec(captured: CapturedSignature): VisualAppearanceSpec {
  const spec: VisualAppearanceSpec = {
    source: captured.source,
    showName: captured.showName,
    showDate: captured.showDate,
    showReason: captured.showReason && captured.reason.length > 0,
    showSubjectCN: false,
    showIssuerCN: false,
    showTsaInfo: false,
  };
  if (captured.reason.length > 0) spec.reason = captured.reason;
  return spec;
}

/**
 * Build a `PadesAppearanceSpec` from a captured visual + the PAdES options.
 * The captured-signature carries the appearance source; the PAdES options
 * govern which cert-derived rows appear.
 */
export function buildPadesAppearanceSpec(
  captured: CapturedSignature,
  options: PadesOptions,
): PadesAppearanceSpec {
  const spec: PadesAppearanceSpec = {
    source: captured.source,
    showName: captured.showName,
    showDate: options.showDate,
    showReason: options.showReason && options.reason.length > 0,
    showSubjectCN: options.showSubjectCN,
    showIssuerCN: options.showIssuerCN,
    showTsaInfo: options.showTsaInfo,
  };
  if (options.reason.length > 0) spec.reason = options.reason;
  return spec;
}
