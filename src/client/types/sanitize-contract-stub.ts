// Sanitize (Remove Hidden Information) contract stub — Phase 7.5 B20 (Riley Wave 5).
//
// David's canonical `pdf:removeHiddenInfo` channel lands in his parallel
// Wave 5 commit to `src/ipc/contracts.ts`. Until those types are re-exported
// through the renderer gatekeeper, the renderer types the surface LOCALLY
// here against the exact shape in `docs/api-contracts.md §19.4.3`. When
// David lands, this file becomes a thin re-export wrapper (same path
// `links-contract-stub.ts` followed in Wave 4).

import type { DocumentHandle } from './ipc-contract';

/**
 * The full Acrobat parity list (~17 categories). v0.8.0 ships the
 * commonly-requested subset; David's engine may honestly fail subset items
 * with a warning. The UI surfaces only the v0.8.0-supported categories per
 * `docs/ui-spec-phase-7.5.md §20.1` — the rest are documented for forward
 * compatibility.
 */
export type SanitizeCategory =
  | 'metadata' // /Info dict + XMP
  | 'attachments' // /EmbeddedFiles
  | 'comments' // annotations
  | 'form-fields' // AcroForm
  | 'bookmarks' // outline
  | 'js' // /JS, /JavaScript actions (also always-on baseline per security policy)
  | 'hidden-text' // text with non-printing rendering mode
  | 'hidden-layers' // OCGs with Off state
  | 'deleted-content' // pdf-lib rebuild-from-scratch always drops this
  | 'object-data' // /Names, /OpenAction, /Threads
  | 'thumbnails'
  | 'web-capture-info'
  | 'links'
  | 'overlapping-objects'
  | 'cross-reference-data'
  | 'content-not-on-page'
  | 'private-application-data';

export interface PdfRemoveHiddenInfoRequest {
  handle: DocumentHandle;
  categories: SanitizeCategory[];
  /** Required when the doc has at least one PAdES signature; engine refuses
   *  without the explicit confirm (mirrors the redaction flow). */
  invalidatesSignaturesConfirmed?: boolean;
}

export type PdfRemoveHiddenInfoError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'no_categories'
  | 'signed_pdf_requires_confirm'
  | 'engine_failed';

export interface PdfRemoveHiddenInfoValue {
  /** Echo of the categories applied; engine may drop unsupported entries
   *  with a non-fatal warning. */
  categoriesApplied: SanitizeCategory[];
  itemsRemoved: Partial<Record<SanitizeCategory, number>>;
  warnings: string[];
}

export type PdfRemoveHiddenInfoResponse =
  | { ok: true; value: PdfRemoveHiddenInfoValue }
  | {
      ok: false;
      error: PdfRemoveHiddenInfoError | 'bridge_unavailable';
      message: string;
      invalidatedSignatureFields?: string[];
    };

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
