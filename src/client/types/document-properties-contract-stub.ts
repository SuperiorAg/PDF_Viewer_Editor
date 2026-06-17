// Document Properties + Password Protection contract stub — Phase 7.5 B21+B8 (Riley Wave 5).
//
// David's canonical `pdf:getDocumentProperties`, `pdf:setDocumentProperties`,
// and `pdf:setPasswordProtection` channels land in his parallel Wave 5 commit
// to `src/ipc/contracts.ts`. Until those types are re-exported through the
// renderer gatekeeper (`./ipc-contract`), the renderer types the surface
// LOCALLY here against the exact shape in `docs/api-contracts.md §19.4.2` and
// `§19.4.4`. When David lands, this file becomes a thin re-export wrapper (the
// same promotion path the `links-contract-stub.ts` followed in Wave 4).
//
// The runtime dispatcher in `state/thunks-phase7-5-wave5.ts` feature-detects
// the bridge method (`window.pdfApi?.pdf?.getDocumentProperties` etc.) so the
// renderer compiles and runs even before David's preload bridge exposes them
// — same `bridge_unavailable` fallback shape `applyRedactions` used in Wave 2.

import type { DocumentHandle } from './ipc-contract';

// ============================================================================
// `pdf:getDocumentProperties` + `pdf:setDocumentProperties` (api-contracts §19.4.4)
// ============================================================================

export interface DocumentProperties {
  title: string | null;
  author: string | null;
  subject: string | null;
  /** PDF /Info Keywords is a single string; split on commas. */
  keywords: string[];
  /** The application that originally authored the doc (read-only). */
  creator: string | null;
  /** The last-write tool (set by our save path; read-only here). */
  producer: string | null;
  /** ms since epoch. Read-only — David's engine handles PDF date parsing. */
  creationDate: number | null;
  modificationDate: number | null;
  trapped: 'true' | 'false' | 'unknown' | null;
  customMetadata: Record<string, string>;
}

export interface PdfGetDocumentPropertiesRequest {
  handle: DocumentHandle;
}

export type PdfGetDocumentPropertiesError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'engine_failed';

export interface DocumentSecuritySummary {
  encrypted: boolean;
  encryptionAlgorithm: 'aes-128' | 'aes-256' | 'rc4-128' | 'none';
  /** Permissions map (`print`, `modify`, `copy`, ...). Empty when not encrypted. */
  permissions: Record<string, boolean>;
}

export interface DocumentPageSize {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
}

export interface PdfGetDocumentPropertiesValue {
  properties: DocumentProperties;
  securitySummary: DocumentSecuritySummary;
  pageSizes: DocumentPageSize[];
}

export type PdfGetDocumentPropertiesResponse =
  | { ok: true; value: PdfGetDocumentPropertiesValue }
  | { ok: false; error: PdfGetDocumentPropertiesError | 'bridge_unavailable'; message: string };

export interface PdfSetDocumentPropertiesRequest {
  handle: DocumentHandle;
  /** Only fields the user changed; engine merges into existing /Info dict. */
  properties: Partial<DocumentProperties>;
}

export type PdfSetDocumentPropertiesError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'engine_failed';

export type PdfSetDocumentPropertiesValue = { applied: true };

export type PdfSetDocumentPropertiesResponse =
  | { ok: true; value: PdfSetDocumentPropertiesValue }
  | { ok: false; error: PdfSetDocumentPropertiesError | 'bridge_unavailable'; message: string };

// ============================================================================
// `pdf:setPasswordProtection` (api-contracts §19.4.2, qpdf subprocess)
// ============================================================================

export interface PdfSecurityPermissions {
  print: boolean;
  modify: boolean;
  copy: boolean;
  annotate: boolean;
  fillForms: boolean;
  extract: boolean;
  assemble: boolean;
  printHighRes: boolean;
}

export interface PdfSetPasswordProtectionRequest {
  handle: DocumentHandle;
  /** null = no open password (printing-only restriction case). */
  openPassword: string | null;
  /** null = no permissions password. */
  permissionsPassword: string | null;
  permissions: PdfSecurityPermissions;
  encryption: 'aes-128' | 'aes-256';
}

export type PdfSetPasswordProtectionError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'engine_unavailable'
  | 'password_too_short'
  | 'engine_failed';

export interface PdfSetPasswordProtectionValue {
  outputBytes: number;
  newFileHash: string;
}

export type PdfSetPasswordProtectionResponse =
  | { ok: true; value: PdfSetPasswordProtectionValue }
  | { ok: false; error: PdfSetPasswordProtectionError | 'bridge_unavailable'; message: string };

export const DEFAULT_PERMISSIONS: PdfSecurityPermissions = {
  print: true,
  modify: true,
  copy: true,
  annotate: true,
  fillForms: true,
  extract: true,
  assemble: true,
  printHighRes: true,
};
