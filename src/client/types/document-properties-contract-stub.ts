// Document Properties + Password Protection types — Phase 7.5 B21+B8 (Riley Wave 5).
//
// PROMOTED 2026-06-18 (Riley, post-v0.8.0 follow-up): David's canonical contract
// landed in `src/ipc/contracts.ts` Wave 5; the renderer now re-exports from the
// gatekeeper module (`./ipc-contract`) — the same promotion path the
// `links-contract-stub.ts` followed in Wave 4. The file kept its filename so
// existing import sites work unchanged; new code may import directly from
// `./ipc-contract`.
//
// Renderer-only constants (`DEFAULT_PERMISSIONS`) live here — they are UI seed
// values, not part of the IPC contract.
//
// Legacy alias `PdfSecurityPermissions = EncryptionPermissions` (kept as a
// type-only re-export with a TODO for slice + UI rename) preserves the
// existing call sites' identifier while canonical reigns on the wire.

import type {
  DocumentProperties,
  EncryptionPermissions,
  PdfGetDocumentPropertiesError,
  PdfGetDocumentPropertiesRequest,
  PdfGetDocumentPropertiesResponse,
  PdfGetDocumentPropertiesValue,
  PdfSetDocumentPropertiesError,
  PdfSetDocumentPropertiesRequest,
  PdfSetDocumentPropertiesResponse,
  PdfSetDocumentPropertiesValue,
  PdfSetPasswordProtectionError,
  PdfSetPasswordProtectionRequest,
  PdfSetPasswordProtectionResponse,
  PdfSetPasswordProtectionValue,
} from './ipc-contract';

export type {
  DocumentProperties,
  EncryptionPermissions,
  PdfGetDocumentPropertiesError,
  PdfGetDocumentPropertiesRequest,
  PdfGetDocumentPropertiesResponse,
  PdfGetDocumentPropertiesValue,
  PdfSetDocumentPropertiesError,
  PdfSetDocumentPropertiesRequest,
  PdfSetDocumentPropertiesResponse,
  PdfSetDocumentPropertiesValue,
  PdfSetPasswordProtectionError,
  PdfSetPasswordProtectionRequest,
  PdfSetPasswordProtectionResponse,
  PdfSetPasswordProtectionValue,
};

/**
 * Legacy renderer identifier — alias for canonical `EncryptionPermissions`.
 *
 * Kept to avoid a sprawling rename in the slice + UI in this dispatch. New
 * code should import `EncryptionPermissions` directly. v0.9.0+ may complete
 * the rename to drop this alias.
 */
export type PdfSecurityPermissions = EncryptionPermissions;

// ============================================================================
// Renderer-only derived types — not part of the IPC contract.
// ============================================================================

/**
 * Inline shape mirror for the `securitySummary` field of the canonical
 * `PdfGetDocumentPropertiesValue`. Surfaced as a named type so slice + UI
 * call sites can name the shape they hold without reaching into the nested
 * canonical type.
 */
export interface DocumentSecuritySummary {
  encrypted: boolean;
  encryptionAlgorithm: 'aes-128' | 'aes-256' | 'rc4-128' | 'none';
  permissions: Record<string, boolean>;
}

/**
 * Inline shape mirror for the per-page entry in `pageSizes`. Same rationale
 * as `DocumentSecuritySummary` above.
 */
export interface DocumentPageSize {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
}

// ============================================================================
// Renderer-only constants — UI seed values.
// ============================================================================

export const DEFAULT_PERMISSIONS: EncryptionPermissions = {
  print: true,
  modify: true,
  copy: true,
  annotate: true,
  fillForms: true,
  extract: true,
  assemble: true,
  printHighRes: true,
};
