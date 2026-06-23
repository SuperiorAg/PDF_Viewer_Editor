// Sanitize (Remove Hidden Information) types — Phase 7.5 B20 (Riley Wave 5).
//
// PROMOTED 2026-06-18 (Riley, post-v0.8.0 follow-up): David's canonical contract
// landed in `src/ipc/contracts.ts` Wave 5; the renderer now re-exports from the
// gatekeeper module (`./ipc-contract`) — the same promotion path the
// `links-contract-stub.ts` followed in Wave 4. The file kept its filename so
// existing import sites work unchanged; new code may import directly from
// `./ipc-contract`.
//
// Renderer-only constants (`V080_SUPPORTED_CATEGORIES`, `DEFAULT_CATEGORY_CHECKED`)
// live here — they are UI seed values, not part of the IPC contract.

import type {
  PdfRemoveHiddenInfoError,
  PdfRemoveHiddenInfoRequest,
  PdfRemoveHiddenInfoResponse,
  PdfRemoveHiddenInfoValue,
  SanitizeCategory,
} from './ipc-contract';

export type {
  PdfRemoveHiddenInfoError,
  PdfRemoveHiddenInfoRequest,
  PdfRemoveHiddenInfoResponse,
  PdfRemoveHiddenInfoValue,
  SanitizeCategory,
};

// ============================================================================
// Renderer-only constants — UI seed values, not part of the IPC contract.
// ============================================================================

/** v0.8.0 supported categories surfaced in the UI checkbox list. */
export const V080_SUPPORTED_CATEGORIES: readonly SanitizeCategory[] = [
  'metadata',
  'attachments',
  'comments',
  'form-fields',
  'bookmarks',
  'js',
  'hidden-text',
  'hidden-layers',
  'deleted-content',
];

/** Default checkbox state on modal open — destructive items default OFF;
 *  metadata + js + deleted-content default ON since they are the most
 *  commonly desired "scrub before sharing" categories. */
export const DEFAULT_CATEGORY_CHECKED: Record<SanitizeCategory, boolean> = {
  metadata: true,
  attachments: false,
  comments: false,
  'form-fields': false,
  bookmarks: false,
  js: true,
  'hidden-text': true,
  'hidden-layers': false,
  'deleted-content': true,
  'object-data': false,
  thumbnails: false,
  'web-capture-info': false,
  links: false,
  'overlapping-objects': false,
  'cross-reference-data': false,
  'content-not-on-page': false,
  'private-application-data': false,
};
