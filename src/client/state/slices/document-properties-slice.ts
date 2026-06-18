// Document Properties slice — Phase 7.5 B21 (Riley Wave 5).
//
// Drives the Document Properties modal (File → Properties / Ctrl+D).
// Tabs: Description (title/author/subject/keywords + read-only metadata) +
// Security (B8 password protection sub-form). Fonts + Custom tabs are
// deferred per docs/ui-spec-phase-7.5.md §21 — the modal renders them as
// stub tabs with the "Coming later" callout for v0.8.0 honesty.
//
// Cross-check vs sentinel-default lesson:
// - `loaded` is `null` until first fetch completes (not a sentinel)
// - `lastErrorMessage` is `null` when no error (not a sentinel)
// - `dirtyFields` is `{}` (the empty object — not a sentinel; explicit empty)

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  type DocumentPageSize,
  type DocumentProperties,
  type DocumentSecuritySummary,
  type PdfSecurityPermissions,
  DEFAULT_PERMISSIONS,
} from '../../types/document-properties-contract-stub';

export type DocumentPropertiesTab = 'description' | 'security' | 'fonts' | 'custom';

export interface DescriptionFormState {
  title: string;
  author: string;
  subject: string;
  /** User types comma-separated; serialized to keywords[] on Apply. */
  keywordsText: string;
}

export interface SecurityFormState {
  /** Toggle: require open password? */
  requireOpenPassword: boolean;
  openPassword: string;
  openPasswordConfirm: string;
  /** Toggle: require permissions password? */
  requirePermissionsPassword: boolean;
  permissionsPassword: string;
  permissionsPasswordConfirm: string;
  permissions: PdfSecurityPermissions;
  encryption: 'aes-128' | 'aes-256';
}

export interface LoadedSnapshot {
  properties: DocumentProperties;
  securitySummary: DocumentSecuritySummary;
  pageSizes: DocumentPageSize[];
  /** ms epoch when last loaded — drives the refresh button copy. */
  loadedAt: number;
}

export interface DocumentPropertiesState {
  open: boolean;
  activeTab: DocumentPropertiesTab;
  /** null until the first `pdf:getDocumentProperties` call completes. */
  loaded: LoadedSnapshot | null;
  loading: boolean;
  applying: boolean;
  applyingSecurity: boolean;
  lastErrorMessage: string | null;
  /** Description tab form; mirrors `loaded.properties` after refresh, plus
   *  any in-progress user edits. */
  description: DescriptionFormState;
  /** Security tab form; defaults are computed from `loaded.securitySummary`
   *  on refresh. Permissions reflect the last-known state OR the
   *  always-allow default if not encrypted. */
  security: SecurityFormState;
}

const EMPTY_DESCRIPTION: DescriptionFormState = {
  title: '',
  author: '',
  subject: '',
  keywordsText: '',
};

const DEFAULT_SECURITY: SecurityFormState = {
  requireOpenPassword: false,
  openPassword: '',
  openPasswordConfirm: '',
  requirePermissionsPassword: false,
  permissionsPassword: '',
  permissionsPasswordConfirm: '',
  permissions: { ...DEFAULT_PERMISSIONS },
  encryption: 'aes-256',
};

const initialState: DocumentPropertiesState = {
  open: false,
  activeTab: 'description',
  loaded: null,
  loading: false,
  applying: false,
  applyingSecurity: false,
  lastErrorMessage: null,
  description: EMPTY_DESCRIPTION,
  security: DEFAULT_SECURITY,
};

export const documentPropertiesSlice = createSlice({
  name: 'documentProperties',
  initialState,
  reducers: {
    openDocumentProperties(
      state,
      action: PayloadAction<
        DocumentPropertiesTab | { tab?: DocumentPropertiesTab; seedNodeId?: string } | undefined
      >,
    ) {
      // Wave 5d follow-up (Riley): the C6 accessibility checker's quick-fix
      // dispatcher passes `{ seedNodeId }` to every open-action for API
      // symmetry across the four quick-fix kinds. Document properties is
      // doc-level — there is no per-struct-node concept here — so the
      // `seedNodeId` is intentionally a no-op. We accept it in the
      // signature so the dispatcher doesn't have to special-case this
      // branch; tooling that surfaces a quick-fix without a target id
      // (or with one — both work) drops cleanly into this opener.
      const payload = action.payload;
      let tab: DocumentPropertiesTab | undefined;
      if (typeof payload === 'string') {
        tab = payload;
      } else if (payload !== undefined) {
        tab = payload.tab;
      }
      state.open = true;
      state.activeTab = tab ?? 'description';
      state.lastErrorMessage = null;
    },
    closeDocumentProperties(state) {
      state.open = false;
      state.applying = false;
      state.applyingSecurity = false;
      // Wipe sensitive password fields on close so they don't linger in
      // memory between sessions (security hygiene).
      state.security.openPassword = '';
      state.security.openPasswordConfirm = '';
      state.security.permissionsPassword = '';
      state.security.permissionsPasswordConfirm = '';
    },
    setActiveTab(state, action: PayloadAction<DocumentPropertiesTab>) {
      state.activeTab = action.payload;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setLoaded(state, action: PayloadAction<LoadedSnapshot>) {
      state.loaded = action.payload;
      state.loading = false;
      state.lastErrorMessage = null;
      // Seed Description form from the loaded snapshot. User edits stomp this
      // when they type — we re-seed only on explicit Refresh (load action).
      const p = action.payload.properties;
      state.description = {
        title: p.title ?? '',
        author: p.author ?? '',
        subject: p.subject ?? '',
        keywordsText: p.keywords.join(', '),
      };
      // Seed Security permissions from the loaded summary when encrypted; when
      // not encrypted, keep the always-allow default so the user starts from a
      // known-good baseline if they enable encryption.
      const sec = action.payload.securitySummary;
      if (sec.encrypted) {
        state.security.permissions = {
          print: sec.permissions['print'] ?? true,
          modify: sec.permissions['modify'] ?? true,
          copy: sec.permissions['copy'] ?? true,
          annotate: sec.permissions['annotate'] ?? true,
          fillForms: sec.permissions['fillForms'] ?? true,
          extract: sec.permissions['extract'] ?? true,
          assemble: sec.permissions['assemble'] ?? true,
          printHighRes: sec.permissions['printHighRes'] ?? true,
        };
        state.security.encryption = sec.encryptionAlgorithm === 'aes-128' ? 'aes-128' : 'aes-256';
      } else {
        state.security.permissions = { ...DEFAULT_PERMISSIONS };
        state.security.encryption = 'aes-256';
      }
    },
    setLoadError(state, action: PayloadAction<string>) {
      state.loading = false;
      state.lastErrorMessage = action.payload;
    },
    updateDescription(state, action: PayloadAction<Partial<DescriptionFormState>>) {
      state.description = { ...state.description, ...action.payload };
    },
    updateSecurity(state, action: PayloadAction<Partial<SecurityFormState>>) {
      state.security = { ...state.security, ...action.payload };
    },
    updateSecurityPermissions(state, action: PayloadAction<Partial<PdfSecurityPermissions>>) {
      state.security.permissions = { ...state.security.permissions, ...action.payload };
    },
    setApplying(state, action: PayloadAction<boolean>) {
      state.applying = action.payload;
    },
    setApplyingSecurity(state, action: PayloadAction<boolean>) {
      state.applyingSecurity = action.payload;
    },
    setApplyError(state, action: PayloadAction<string | null>) {
      state.lastErrorMessage = action.payload;
    },
    resetDocumentProperties() {
      return initialState;
    },
  },
});

export const {
  openDocumentProperties,
  closeDocumentProperties,
  setActiveTab: setDocPropertiesTab,
  setLoading: setDocPropertiesLoading,
  setLoaded: setDocPropertiesLoaded,
  setLoadError: setDocPropertiesLoadError,
  updateDescription,
  updateSecurity,
  updateSecurityPermissions,
  setApplying: setDocPropertiesApplying,
  setApplyingSecurity,
  setApplyError: setDocPropertiesApplyError,
  resetDocumentProperties,
} = documentPropertiesSlice.actions;

export default documentPropertiesSlice.reducer;
