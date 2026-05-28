// IPC contracts — the single typed surface shared by main, preload, and renderer.
// Source-of-truth: docs/api-contracts.md (Riley specs; David owns this file).
// Renderer imports read-only via @ipc/contracts.
//
// Deps used here (Diego will fold into the final package.json in Wave 3):
//   - (none at runtime — pure types)

import type { Result } from '../shared/result.js';

// ============================================================================
// 1. Document handles
// ============================================================================

export type DocumentHandle = number;
export type FileHash = string; // 64-char hex lowercase, SHA-256(first 64 KiB || size)

// ============================================================================
// 2. Annotation + page + edit-operation types (mirrors docs/data-models.md §3)
// ============================================================================

export type AnnotationSubtype =
  // Phase 1
  | 'Highlight'
  | 'Text'
  | 'FreeText'
  // Phase 2
  | 'Underline'
  | 'StrikeOut'
  | 'Ink'
  // Phase 4
  | 'Square'
  | 'Circle'
  | 'Line'
  | 'Polygon'
  | 'PolyLine'
  | 'FreeTextCallout';

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

// Phase 2 (data-models.md §7.2): image-embed model. `PdfImage` carries the
// bytes (held in main); the renderer references images by `contentHash`.
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/tiff';

export interface PdfImage {
  contentHash: string;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export interface ImagePlacement {
  rect: PdfRect;
  rotation?: 0;
}

// Phase 2 (data-models.md §7.1): ImageEmbedPayload lives on EditOperations.
export interface ImageEmbedPayload {
  bytes: Uint8Array;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  contentHash: string;
}

export type SourcePageRef =
  | { kind: 'original'; originalIndex: number }
  | { kind: 'inserted'; sourceFileHash: FileHash; sourcePageIndex: number }
  | { kind: 'blank'; width: number; height: number }
  // Phase 2 (data-models.md §7.1.2)
  | {
      kind: 'image';
      image: ImageEmbedPayload;
      pageWidth: number;
      pageHeight: number;
    };

export interface PageModel {
  pageIndex: number;
  sourcePageRef: SourcePageRef;
  rotation: 0 | 90 | 180 | 270;
  width: number;
  height: number;
}

export interface AnnotationModel {
  id: string;
  pageIndex: number;
  subtype: AnnotationSubtype;
  rect: PdfRect;
  color: RgbColor;
  opacity: number;
  contents?: string;
  author?: string;
  createdAt: number;
  modifiedAt: number;
  highlight?: { quadPoints: number[] };
  freeText?: { fontSize: number; fontFamily: string };
  ink?: { paths: Array<{ x: number; y: number }[]> };
  square?: { borderWidth: number };
  pdfObjectNumber?: number;
  dirty: boolean;
  preservedDict?: Record<string, unknown>;
}

export interface EditMeta {
  ts: number;
  undoable: true;
  operationId: string;
}

// ============================================================================
// 2.5 Phase 3 form-field types (data-models.md §8.1, architecture-phase-3.md §4.1)
// ============================================================================

export type FormFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'signature' | 'date';

export interface FormFieldOption {
  /** Export value written to /V on selection. */
  value: string;
  /** Display label shown in the UI. */
  label: string;
}

// Phase 4 (data-models.md §9.2): a signed signature carries the audit log row,
// fingerprint, subject CN, and the timestamp. `value: null` (Phase 3) means
// "placeholder, not yet signed"; non-null means "signed". The renderer
// pattern-matches on `value === null` to surface "Click to sign".
export interface SignaturePayload {
  kind: 'visual' | 'pades';
  /** SignatureAuditLog row id; null for visual signatures (no audit row). */
  auditLogRowId: number | null;
  /** Cert SHA-256 fingerprint; null for visual signatures. */
  fingerprint: string | null;
  /** Subject CN from the cert; null for visual signatures. */
  subjectCN: string | null;
  /** When the signature was applied (ms epoch). */
  signedAt: number;
  /** TSA URL used; null for visual or no-TSA PAdES. */
  tsaUrl: string | null;
}

export type FormFieldValue =
  | { type: 'text'; value: string }
  | { type: 'checkbox'; value: boolean }
  | { type: 'radio'; value: string }
  | { type: 'dropdown'; value: string }
  // Phase 4 (data-models.md §9.2): non-null when signed.
  | { type: 'signature'; value: SignaturePayload | null }
  | { type: 'date'; value: string };

export interface FormFieldDefinition {
  /** Unique within document. AcroForm field name. No periods in Phase 3. */
  name: string;
  type: FormFieldType;
  pageIndex: number;
  /** Widget rect in PDF user-space (origin bottom-left). */
  rect: PdfRect;
  /** UI-visible label; defaults to `name` if /TU absent. */
  label: string;
  /** /Ff bit 2 (Required). */
  required: boolean;
  defaultValue?: FormFieldValue;
  /** Required for radio + dropdown; forbidden for other types. */
  options?: FormFieldOption[];
  /** Detected from source PDF, or authored by user this session. */
  origin: 'detected' | 'authored';
  /** Authored this session and not yet saved. */
  unsaved: boolean;
}

// ============================================================================
// 2.6 Phase 4 signature + shape types (data-models.md §9, api-contracts.md §14)
// ============================================================================

export type SignaturePlacementMode = 'placeholder' | 'freeform';

export interface SignaturePlacement {
  mode: SignaturePlacementMode;
  /** When mode='placeholder', the Phase-3 /Sig field name to fill. */
  fieldName?: string;
  /** When mode='freeform', the page index for a new /Sig field. */
  pageIndex?: number;
  /** When mode='freeform', the rect in PDF user-space (origin bottom-left). */
  rect?: PdfRect;
  rotation?: 0 | 90 | 180 | 270;
}

export type VisualAppearanceSource =
  | {
      kind: 'typed';
      name: string;
      fontFamily?: string;
      fontSize?: number;
      /** Renderer-rasterized PNG of the typed name. */
      pngBytes: Uint8Array;
      widthPx: number;
      heightPx: number;
    }
  | { kind: 'drawn'; pngBytes: Uint8Array; widthPx: number; heightPx: number }
  | {
      kind: 'image';
      bytes: Uint8Array;
      mimeType: 'image/png' | 'image/jpeg';
      widthPx: number;
      heightPx: number;
    };

export interface VisualAppearanceSpec {
  source: VisualAppearanceSource;
  showName: boolean;
  showDate: boolean;
  showReason: boolean;
  /** Visual signatures have no cert; always false. Included for type symmetry. */
  showSubjectCN: boolean;
  showIssuerCN: boolean;
  showTsaInfo: boolean;
  reason?: string;
}

export interface PadesAppearanceSpec extends VisualAppearanceSpec {
  showSubjectCN: boolean;
  showIssuerCN: boolean;
  showTsaInfo: boolean;
}

export type ShapeAnnotationSubtype =
  | 'Square'
  | 'Circle'
  | 'Polygon'
  | 'PolyLine'
  | 'Line'
  | 'FreeTextCallout';

export type LineEndStyle = 'None' | 'Butt' | 'OpenArrow' | 'ClosedArrow';

export type MeasureUnit = 'inch' | 'cm' | 'mm' | 'pt' | 'px' | 'custom';

export interface MeasureCalibration {
  /** 1 PDF user-space unit = N <unit> in the real-world drawing. */
  unit: MeasureUnit;
  customUnitLabel?: string;
  scale: number;
}

export interface ShapeAnnotationModel {
  id: string;
  pageIndex: number;
  subtype: ShapeAnnotationSubtype;
  rect: PdfRect;
  color: RgbColor;
  opacity: number;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed' | 'dotted';
  fillColor?: RgbColor;
  fillEnabled?: boolean;
  vertices?: number[];
  lineStart?: { x: number; y: number };
  lineEnd?: { x: number; y: number };
  lineStartStyle?: LineEndStyle;
  lineEndStyle?: LineEndStyle;
  calloutText?: string;
  calloutPointer?: { x: number; y: number };
  fontSize?: number;
  fontFamily?: string;
  measure?: MeasureCalibration;
  author?: string;
  contents?: string;
  createdAt: number;
  modifiedAt: number;
  pdfObjectNumber?: number;
  dirty: boolean;
  preservedDict?: Record<string, unknown>;
}

export interface SignatureAuditItem {
  id: number;
  docHash: string;
  preSignDocHash: string;
  signedAt: number;
  signatureKind: 'visual' | 'pades' | 'pades-tsa';
  signedByFingerprint: string | null;
  signedBySubjectCN: string | null;
  signedByIssuerCN: string | null;
  certNotBefore: number | null;
  certNotAfter: number | null;
  tsaUrl: string | null;
  tsaResponseStatus: 'ok' | 'failed' | null;
  sigBytesOffset: number | null;
  sigBytesLength: number | null;
  byteRange: number[] | null;
  reason: string | null;
  location: string | null;
  fieldName: string | null;
  createdAt: number;
}

export type EditOperation =
  | { kind: 'reorder'; meta: EditMeta; fromIndex: number; toIndex: number }
  | { kind: 'insert'; meta: EditMeta; atIndex: number; source: SourcePageRef }
  | {
      kind: 'delete';
      meta: EditMeta;
      pageIndex: number;
      preservedSource: SourcePageRef;
    }
  | {
      kind: 'rotate';
      meta: EditMeta;
      pageIndex: number;
      fromRotation: 0 | 90 | 180 | 270;
      toRotation: 0 | 90 | 180 | 270;
    }
  | { kind: 'annot-add'; meta: EditMeta; annotation: AnnotationModel }
  | {
      kind: 'annot-edit';
      meta: EditMeta;
      id: string;
      before: Partial<AnnotationModel>;
      after: Partial<AnnotationModel>;
    }
  | { kind: 'annot-delete'; meta: EditMeta; before: AnnotationModel }
  // Phase 2 (data-models.md §7.1): image + text-replace variants.
  | {
      kind: 'image-insert';
      meta: EditMeta;
      atIndex: number;
      image: ImageEmbedPayload;
    }
  | {
      kind: 'image-overlay';
      meta: EditMeta;
      pageIndex: number;
      rect: PdfRect;
      image: ImageEmbedPayload;
      overlayId: string;
    }
  | {
      kind: 'image-overlay-edit';
      meta: EditMeta;
      pageIndex: number;
      overlayId: string;
      beforeRect: PdfRect;
      afterRect: PdfRect;
    }
  | {
      kind: 'image-overlay-delete';
      meta: EditMeta;
      pageIndex: number;
      overlayId: string;
      before: { rect: PdfRect; image: ImageEmbedPayload };
    }
  | {
      kind: 'text-replace';
      meta: EditMeta;
      pageIndex: number;
      objectId: string;
      oldText: string;
      newText: string;
    }
  // ==========================================================================
  // Phase 3 (data-models.md §8.2, architecture-phase-3.md §5.3): 5 form ops.
  //
  // form-commit batches per-keystroke fill values; the renderer accumulates
  // values transiently in formsSlice.values and dispatches ONE form-commit
  // op at the commit boundary (Save or explicit Commit button) — see
  // conventions §14.2. Inverse swaps fieldValues<->previousValues.
  //
  // form-design-{add,remove,edit} are per-gesture authoring ops following
  // the standard Phase 1/2 EditOperation pattern (one op per user action).
  //
  // form-flatten is a one-shot document-structural op produced by
  // forms:flatten channel; its inverse is composite (re-create N fields +
  // re-fill from beforeValues) — see data-models §8.3.
  // ==========================================================================
  | {
      kind: 'form-commit';
      meta: EditMeta;
      /** Map of field.name -> new value. Only changed values appear. */
      fieldValues: Record<string, FormFieldValue>;
      /** Prior committed values for each changed field (undo target). */
      previousValues: Record<string, FormFieldValue | undefined>;
    }
  | {
      kind: 'form-design-add';
      meta: EditMeta;
      fieldDefinition: FormFieldDefinition;
    }
  | {
      kind: 'form-design-remove';
      meta: EditMeta;
      fieldName: string;
      /** Full snapshot of the removed field for inverse re-author. */
      before: FormFieldDefinition;
    }
  | {
      kind: 'form-design-edit';
      meta: EditMeta;
      fieldName: string;
      before: Partial<FormFieldDefinition>;
      after: Partial<FormFieldDefinition>;
    }
  | {
      kind: 'form-flatten';
      meta: EditMeta;
      /** Snapshot of fields BEFORE flatten (composite inverse: re-create + re-fill). */
      beforeFields: FormFieldDefinition[];
      beforeValues: Record<string, FormFieldValue>;
    }
  // ==========================================================================
  // Phase 4 (data-models.md §9.3): signature + shape annotation ops.
  //
  // signature-visual-place and signature-pades-applied are paired with their
  // inverse companions (-remove / -removed) that the renderer emits via undo.
  // PAdES undo also deletes the audit log row.
  // ==========================================================================
  | {
      kind: 'signature-visual-place';
      meta: EditMeta;
      placement: SignaturePlacement;
      appearance: VisualAppearanceSpec;
      /** Non-null when filling a Phase-3 /Sig placeholder. */
      placeholderFieldName: string | null;
    }
  | {
      kind: 'signature-visual-remove';
      meta: EditMeta;
      placement: SignaturePlacement;
      placeholderFieldName: string | null;
      before: { appearance: VisualAppearanceSpec };
    }
  | {
      kind: 'signature-pades-applied';
      meta: EditMeta;
      placement: SignaturePlacement;
      /** SHA-256 hex; the cert itself never appears in any op. */
      certFingerprint: string;
      signerSubjectCN: string;
      signerIssuerCN: string;
      signedAt: number;
      tsaUrl: string | null;
      /** FK to signature_audit_log.id. */
      auditLogRowId: number;
      placeholderFieldName: string | null;
    }
  | {
      kind: 'signature-pades-removed';
      meta: EditMeta;
      placement: SignaturePlacement;
      placeholderFieldName: string | null;
      auditLogRowId: number;
      before: {
        certFingerprint: string;
        signerSubjectCN: string;
        signedAt: number;
        tsaUrl: string | null;
      };
    }
  | { kind: 'annot-add-shape'; meta: EditMeta; annotation: ShapeAnnotationModel }
  | {
      kind: 'annot-edit-shape';
      meta: EditMeta;
      id: string;
      before: Partial<ShapeAnnotationModel>;
      after: Partial<ShapeAnnotationModel>;
    }
  | { kind: 'annot-delete-shape'; meta: EditMeta; before: ShapeAnnotationModel }
  // ==========================================================================
  // Phase 5 (data-models.md §10.3): OCR text-behind-image ops.
  //
  // `ocr-text-behind-applied` is produced by ocr:runOnDocument; the engine
  // composes an invisible (Tr=3) text layer at recognized word coordinates
  // and appends BT/ET blocks to each page's /Contents stream. Its inverse
  // companion `ocr-text-behind-removed` strips those blocks.
  //
  // `invalidatesSignatures` is true when the doc carried prior PAdES
  // widgets pre-OCR (the user confirmed at the modal). The replay engine
  // step 3.9 reads this and updates signature_audit_log accordingly.
  // ==========================================================================
  | {
      kind: 'ocr-text-behind-applied';
      meta: EditMeta;
      /** FK to ocr_jobs.id. */
      jobId: number;
      pageRange: { start: number; end: number };
      langs: string[];
      meanConfidence: number;
      totalWordsRecognized: number;
      invalidatesSignatures: boolean;
    }
  | {
      kind: 'ocr-text-behind-removed';
      meta: EditMeta;
      before: {
        jobId: number;
        pageRange: { start: number; end: number };
        langs: string[];
        meanConfidence: number;
        totalWordsRecognized: number;
      };
    };

export type EditOperationSerialized = EditOperation;
export type AnnotationModelSerialized = AnnotationModel;

export interface PDFDocumentModel {
  handle: DocumentHandle;
  displayName: string;
  fileHash: FileHash;
  pageCount: number;
  pages: PageModel[];
  annotations: AnnotationModel[];
  dirtyOps: EditOperation[];
  savedAtHandleVersion: number;
  pdflibLoadWarnings: string[];
}

// ============================================================================
// 3. dialog: channels
// ============================================================================

export interface DialogOpenPdfRequest {
  /* no args; multi-select disabled in Phase 1 */
}
export type DialogOpenPdfError = 'user_cancelled' | 'invalid_pdf' | 'fs_read_failed' | 'too_large';
export interface DialogOpenPdfValue {
  handle: DocumentHandle;
  displayName: string;
  fileHash: FileHash;
  pageCount: number;
  pdflibLoadWarnings: string[];
}
export type DialogOpenPdfResponse = Result<DialogOpenPdfValue, DialogOpenPdfError>;

export interface DialogSaveAsRequest {
  suggestedName: string;
}
export type DialogSaveAsError = 'user_cancelled' | 'invalid_path';
export interface DialogSaveAsValue {
  destinationToken: string;
  displayName: string;
}
export type DialogSaveAsResponse = Result<DialogSaveAsValue, DialogSaveAsError>;

// Wave 10 / Phase 2.5 (D-10.3): image-bearing ops at the IPC boundary.
// ---------------------------------------------------------------------------
// Renderer dispatches the raw image-insert op (with `image.bytes`) on undo.
// History middleware stores a compacted form (content-hash reference) for
// audit-trail compactness; the raw form is preserved separately in the
// HistoryEntry and is what reaches the IPC layer at save time.
// See: docs/edit-replay-engine.md §9, src/client/state/middleware/history-middleware.ts
//
// Why this matters at the IPC boundary: `fs:writePdf` with `kind: 'ops'`
// receives `EditOperationSerialized[]` carrying `image.bytes` populated
// (Uint8Array) — never the compacted zero-byte form. Main's `applyImageInsert`
// can therefore consume `op.image.bytes` directly; a separate per-handle
// content-hash cache lookup is NOT required (Riley's Wave 8.6 dual-store
// fix made the renderer side guarantee raw bytes on every dispatch).
// ============================================================================
// 4. fs: channels
// ============================================================================

export interface FsReadPdfRequest {
  droppedPath: string;
}
export type FsReadPdfError = DialogOpenPdfError | 'path_rejected';
export type FsReadPdfResponse = Result<DialogOpenPdfValue, FsReadPdfError>;

export interface FsWritePdfRequest {
  handle: DocumentHandle;
  destinationToken: string;
  payload:
    | { kind: 'bytes'; bytes: Uint8Array }
    | {
        kind: 'ops';
        originalHandle: DocumentHandle;
        ops: EditOperationSerialized[];
        annotations: AnnotationModelSerialized[];
      };
}
export type FsWritePdfError =
  | 'token_expired'
  | 'handle_not_found'
  | 'fs_write_failed'
  | 'disk_full'
  | 'invalid_payload'
  // Phase 2 (edit-replay-engine.md §2.1) — surfaced when kind:'ops' replay fails.
  | 'op_apply_failed'
  | 'annotation_emit_failed'
  | 'image_decode_failed'
  | 'text_span_not_found'
  | 'missing_glyph'
  | 'serialize_failed'
  | 'encrypted_unsupported';
export interface FsWritePdfValue {
  bytesWritten: number;
  newFileHash: FileHash;
  /**
   * Phase 2 (edit-replay-engine.md §5.3): mapping of annotation.id ->
   * newly-assigned pdfObjectNumber so the renderer can clear `dirty` and
   * update its slice. Absent (or empty) on Phase-1 'bytes' writes.
   */
  annotationRefAssignments?: Record<string, number>;
  /** Phase 2: non-fatal replay-engine warnings (clipped text, etc.). */
  warnings?: string[];
}
export type FsWritePdfResponse = Result<FsWritePdfValue, FsWritePdfError>;

export interface FsClosePdfRequest {
  handle: DocumentHandle;
}
export type FsClosePdfError = 'handle_not_found';
export type FsClosePdfResponse = Result<Record<string, never>, FsClosePdfError>;

// ============================================================================
// 5. recents: channels
// ============================================================================

export interface RecentsListRequest {
  limit?: number;
}
export interface RecentsListItem {
  path: string;
  displayName: string;
  lastOpenedAt: number;
  fileHash: FileHash;
  fileStillExists: boolean;
}
export type RecentsListError = 'db_unavailable';
export type RecentsListResponse = Result<{ items: RecentsListItem[] }, RecentsListError>;

export interface RecentsAddRequest {
  path: string;
  displayName: string;
  fileHash: FileHash;
}
export type RecentsAddError = 'db_unavailable' | 'invalid_payload';
export type RecentsAddResponse = Result<Record<string, never>, RecentsAddError>;

export interface RecentsClearRequest {
  /* no args */
}
export type RecentsClearError = 'db_unavailable';
export type RecentsClearResponse = Result<{ cleared: number }, RecentsClearError>;

// ============================================================================
// 6. settings: channels
// ============================================================================

export type SettingKey =
  | 'recents.maxItems'
  | 'open.maxFileSizeMB'
  | 'export.defaultEngine'
  | 'export.showWarningsToast'
  | 'file_association.pdf.requested'
  | 'theme'
  | 'undo.maxHistory'
  // Phase 2 (api-contracts.md §12.9, data-models.md §7.6)
  | 'export.deterministic'
  | 'export.includeBookmarksInOutline'
  | 'editing.confirmDelete'
  | 'editing.commitTextOnBlur'
  // Phase 4 (api-contracts.md §14.10, data-models.md §9.9)
  | 'signatures.tsaUrl'
  | 'signatures.tsaEnabled'
  | 'signatures.tsaTimeoutMs'
  | 'signatures.placeholderSize'
  | 'signatures.defaultShowDate'
  | 'signatures.defaultShowSubjectCN'
  | 'signatures.padesEngine'
  | 'annotations.defaultBorderWidth'
  | 'annotations.defaultBorderStyle'
  | 'annotations.defaultFillEnabled'
  | 'annotations.defaultLineEndStyle'
  // Phase 5 (api-contracts.md §16.11, data-models.md §10.11)
  | 'ocr.defaultLang'
  | 'ocr.lowConfidenceThreshold'
  | 'ocr.rasterDpi'
  | 'ocr.maxConcurrentLanguages'
  | 'ocr.workerWatchdogSec'
  | 'ocr.preprocess.deskew'
  | 'ocr.preprocess.denoise'
  | 'ocr.preprocess.contrastBoost'
  | 'ocr.denoise.kernel'
  | 'ocr.showConfidenceOverlayByDefault'
  | 'ocr.confirmInvalidateSignaturesOnce'
  // Phase 7 (api-contracts.md §18, data-models.md §12.3) — polish-phase keys.
  // Folded into the existing key-value settings store; NO new table (P7-L-7).
  // David + Ravi co-own the union (Wave-7 zero-drift discipline). All four
  // also seeded by Ravi's migration 0007.
  | 'telemetry.optIn'
  | 'i18n.locale'
  | 'update.channel'
  | 'update.lastCheckedAt';

export type PadesEngineChoice = 'signpdf' | 'manual';
export type AnnotationBorderStyle = 'solid' | 'dashed' | 'dotted';
export type AnnotationDefaultLineEndStyle = 'None' | 'OpenArrow' | 'ClosedArrow';

export type ExportEnginePreference = 'auto' | 'pdf-lib' | 'chromium';
export type ThemePreference = 'system' | 'light' | 'dark';

// Phase 7 (api-contracts.md §18). `AppLocale` is the supported-locale union
// (en-US baseline + es-ES proof). `UpdateChannel` is the auto-update trigger
// policy: 'manual' = explicit check only (DEFAULT, because the publish target
// is a placeholder); 'check-on-launch' = opt-in check once at launch.
export type AppLocale = 'en-US' | 'es-ES';
export type UpdateChannel = 'manual' | 'check-on-launch';

// Per-key value typing. Using a conditional helper keeps the channel-level
// generic narrowing intact.
export type SettingValue<K extends SettingKey> = K extends 'recents.maxItems'
  ? number
  : K extends 'open.maxFileSizeMB'
    ? number
    : K extends 'export.defaultEngine'
      ? ExportEnginePreference
      : K extends 'export.showWarningsToast'
        ? boolean
        : K extends 'file_association.pdf.requested'
          ? boolean
          : K extends 'theme'
            ? ThemePreference
            : K extends 'undo.maxHistory'
              ? number
              : K extends 'export.deterministic'
                ? boolean
                : K extends 'export.includeBookmarksInOutline'
                  ? boolean
                  : K extends 'editing.confirmDelete'
                    ? boolean
                    : K extends 'editing.commitTextOnBlur'
                      ? boolean
                      : K extends 'signatures.tsaUrl'
                        ? string
                        : K extends 'signatures.tsaEnabled'
                          ? boolean
                          : K extends 'signatures.tsaTimeoutMs'
                            ? number
                            : K extends 'signatures.placeholderSize'
                              ? number
                              : K extends 'signatures.defaultShowDate'
                                ? boolean
                                : K extends 'signatures.defaultShowSubjectCN'
                                  ? boolean
                                  : K extends 'signatures.padesEngine'
                                    ? PadesEngineChoice
                                    : K extends 'annotations.defaultBorderWidth'
                                      ? number
                                      : K extends 'annotations.defaultBorderStyle'
                                        ? AnnotationBorderStyle
                                        : K extends 'annotations.defaultFillEnabled'
                                          ? boolean
                                          : K extends 'annotations.defaultLineEndStyle'
                                            ? AnnotationDefaultLineEndStyle
                                            : K extends 'ocr.defaultLang'
                                              ? string
                                              : K extends 'ocr.lowConfidenceThreshold'
                                                ? number
                                                : K extends 'ocr.rasterDpi'
                                                  ? number
                                                  : K extends 'ocr.maxConcurrentLanguages'
                                                    ? number
                                                    : K extends 'ocr.workerWatchdogSec'
                                                      ? number
                                                      : K extends 'ocr.preprocess.deskew'
                                                        ? boolean
                                                        : K extends 'ocr.preprocess.denoise'
                                                          ? boolean
                                                          : K extends 'ocr.preprocess.contrastBoost'
                                                            ? boolean
                                                            : K extends 'ocr.denoise.kernel'
                                                              ? number
                                                              : K extends 'ocr.showConfidenceOverlayByDefault'
                                                                ? boolean
                                                                : K extends 'ocr.confirmInvalidateSignaturesOnce'
                                                                  ? boolean
                                                                  : K extends 'telemetry.optIn'
                                                                    ? boolean
                                                                    : K extends 'i18n.locale'
                                                                      ? AppLocale
                                                                      : K extends 'update.channel'
                                                                        ? UpdateChannel
                                                                        : K extends 'update.lastCheckedAt'
                                                                          ? number | null
                                                                          : never;

export interface SettingsGetRequest<K extends SettingKey> {
  key: K;
}
export type SettingsGetError = 'db_unavailable' | 'unknown_key';
export type SettingsGetResponse<K extends SettingKey> = Result<
  { value: SettingValue<K> | null },
  SettingsGetError
>;

export interface SettingsSetRequest<K extends SettingKey> {
  key: K;
  value: SettingValue<K>;
}
export type SettingsSetError = 'db_unavailable' | 'unknown_key' | 'invalid_value';
export type SettingsSetResponse = Result<Record<string, never>, SettingsSetError>;

export interface SettingsGetAllRequest {
  /* no args */
}
export interface SettingsGetAllValue {
  entries: Partial<{ [K in SettingKey]: SettingValue<K> }>;
}
export type SettingsGetAllError = 'db_unavailable';
export type SettingsGetAllResponse = Result<SettingsGetAllValue, SettingsGetAllError>;

// ============================================================================
// 7. bookmarks: channels
// ============================================================================

export interface BookmarksListRequest {
  fileHash: FileHash;
}
export interface BookmarkRow {
  id: number;
  fileHash: FileHash;
  pageIndex: number;
  title: string;
  createdAt: number;
  // Phase 2 (data-models.md §7.4). Optional in the wire contract so Phase-1
  // callers (and the in-memory fallback repo, which doesn't track these)
  // remain compatible — repos that haven't been Phase-2-upgraded simply
  // emit rows without these keys; new UI tolerates absence.
  parentId?: number | null;
  sortOrder?: number;
}
export type BookmarksListError = 'db_unavailable';
export type BookmarksListResponse = Result<{ items: BookmarkRow[] }, BookmarksListError>;

export interface BookmarksUpsertRequest {
  fileHash: FileHash;
  pageIndex: number;
  title: string;
  id?: number;
  // Phase 2 (data-models.md §7.5): renderer may supply parentId + sortOrder
  // on new inserts. Repo defaults to NULL / 0 when absent (Phase-1 compat).
  parentId?: number | null;
  sortOrder?: number;
}
export type BookmarksUpsertError = 'db_unavailable' | 'invalid_payload' | 'duplicate';
export type BookmarksUpsertResponse = Result<{ id: number }, BookmarksUpsertError>;

export interface BookmarksDeleteRequest {
  id: number;
}
export type BookmarksDeleteError = 'db_unavailable' | 'not_found';
export type BookmarksDeleteResponse = Result<Record<string, never>, BookmarksDeleteError>;

// ============================================================================
// 8. pdf: channels
// ============================================================================

export interface PdfCombineRequest {
  sources: Array<
    | {
        kind: 'handle';
        handle: DocumentHandle;
        pageRange?: { start: number; end: number };
      }
    | {
        kind: 'path';
        path: string;
        pageRange?: { start: number; end: number };
      }
  >;
}

// Renderer-friendly alias so the gatekeeper module can re-export this directly
// instead of carrying its own indexed-access workaround.
// Added by Diego in Wave 3 to absorb Marcus's Wave-2 integration delta #4.
export type PdfCombineSource = PdfCombineRequest['sources'][number];
export type PdfCombineError =
  | 'invalid_source'
  | 'handle_not_found'
  | 'fs_read_failed'
  | 'pdf_load_failed'
  | 'invalid_page_range'
  | 'not_implemented';
export interface PdfCombineValue {
  handle: DocumentHandle;
  pageCount: number;
  displayName: string;
}
export type PdfCombineResponse = Result<PdfCombineValue, PdfCombineError>;

export interface PdfExportRequest {
  handle: DocumentHandle;
  preference: ExportEnginePreference;
  // Phase 2 (api-contracts.md §12, edit-replay-engine.md §4.7): caller may
  // supply ops + annotations to replay before emission; export honors them.
  ops?: EditOperationSerialized[];
  annotations?: AnnotationModelSerialized[];
  // Phase 2 (data-models.md §7.6, edit-replay-engine.md §4.7): include user-
  // authored bookmarks in the output PDF's /Outlines dictionary.
  emitBookmarksToOutline?: Array<{
    title: string;
    pageIndex: number;
    parentId: number | null;
    id: number;
    sortOrder: number;
  }>;
}
export type PdfExportError =
  // Phase 2 (architecture-phase-2.md §15): 'not_implemented' is REMOVED;
  // pdf:export is Live. All variants below are real failure modes.
  | 'handle_not_found'
  | 'engine_failed_pdflib'
  | 'engine_failed_chromium'
  | 'no_dirty_changes'
  | 'cancelled'
  | 'invalid_payload'
  | 'op_apply_failed'
  | 'image_decode_failed'
  | 'text_span_not_found'
  | 'missing_glyph'
  | 'serialize_failed'
  | 'encrypted_unsupported';
export interface PdfExportValue {
  engine: 'pdf-lib' | 'chromium';
  reason: string;
  forcedBy: 'user' | 'heuristic';
  warnings: string[];
  outputBytes: Uint8Array;
}
export type PdfExportResponse = Result<PdfExportValue, PdfExportError>;

export type PdfExportProgressPhase =
  | 'preparing'
  | 'pdflib-applying-ops'
  // Phase 2 (api-contracts.md §12.8): additive sub-phase values.
  | 'pdflib-applying-text-replace'
  | 'pdflib-embedding-images'
  | 'pdflib-emitting-annotations'
  | 'chromium-loading'
  | 'chromium-printing'
  | 'finalizing';

export interface PdfExportProgressEvent {
  handle: DocumentHandle;
  jobId: string;
  phase: PdfExportProgressPhase;
  percent: number;
  message?: string;
}

export interface PdfGetOutlineRequest {
  handle: DocumentHandle;
}
export interface OutlineNode {
  title: string;
  pageIndex: number | null;
  children: OutlineNode[];
}
export type PdfGetOutlineError = 'handle_not_found' | 'parse_failed' | 'not_implemented';
export type PdfGetOutlineResponse = Result<{ outline: OutlineNode[] }, PdfGetOutlineError>;

// ============================================================================
// 9. app: channels
// ============================================================================

export interface AppGetVersionRequest {
  /* no args */
}
export interface AppGetVersionValue {
  appVersion: string;
  electronVersion: string;
  chromiumVersion: string;
  nodeVersion: string;
}
export type AppGetVersionResponse = Result<AppGetVersionValue, never>;

export interface AppQuitRequest {
  confirmUnsaved: boolean;
}
export type AppQuitError = 'unsaved_changes';
export type AppQuitResponse = Result<Record<string, never>, AppQuitError>;

export interface AppSetDefaultPdfHandlerRequest {
  enable: boolean;
}
export type AppSetDefaultPdfHandlerError =
  | 'os_denied'
  | 'unsupported_os'
  | 'registry_write_failed'
  | 'already_in_requested_state'
  | 'not_implemented';
export interface AppSetDefaultPdfHandlerValue {
  isNowDefault: boolean;
  prompt: 'shown' | 'not_shown';
}
export type AppSetDefaultPdfHandlerResponse = Result<
  AppSetDefaultPdfHandlerValue,
  AppSetDefaultPdfHandlerError
>;

export interface AppGetDefaultPdfHandlerStatusRequest {
  /* no args */
}
export interface AppGetDefaultPdfHandlerStatusValue {
  isDefault: boolean;
  currentDefaultName?: string;
}
export type AppGetDefaultPdfHandlerStatusError = 'os_query_failed' | 'not_implemented';
export type AppGetDefaultPdfHandlerStatusResponse = Result<
  AppGetDefaultPdfHandlerStatusValue,
  AppGetDefaultPdfHandlerStatusError
>;

export interface AppOpenExternalRequest {
  kind: 'show_in_explorer';
  handle: DocumentHandle;
}
export type AppOpenExternalError = 'handle_not_found' | 'os_failed' | 'not_implemented';
export type AppOpenExternalResponse = Result<Record<string, never>, AppOpenExternalError>;

// ============================================================================
// 10. Window-control channels (renderer chrome buttons)
// ============================================================================

export interface WindowMinimizeRequest {
  /* no args */
}
export type WindowMinimizeError = 'no_window';
export type WindowMinimizeResponse = Result<Record<string, never>, WindowMinimizeError>;

export interface WindowMaximizeRequest {
  /* no args */
}
export type WindowMaximizeError = 'no_window';
export interface WindowMaximizeValue {
  isMaximized: boolean;
}
export type WindowMaximizeResponse = Result<WindowMaximizeValue, WindowMaximizeError>;

export interface WindowCloseRequest {
  /* no args */
}
export type WindowCloseError = 'no_window';
export type WindowCloseResponse = Result<Record<string, never>, WindowCloseError>;

export interface WindowGetStateRequest {
  /* no args */
}
export interface WindowGetStateValue {
  isMinimized: boolean;
  isMaximized: boolean;
  isFullScreen: boolean;
  isFocused: boolean;
}
export type WindowGetStateError = 'no_window';
export type WindowGetStateResponse = Result<WindowGetStateValue, WindowGetStateError>;

// ============================================================================
// 10.5 Phase 2 channels (api-contracts.md §12, 2026-05-21, Riley)
// ============================================================================

// ---- pdf:embedImage ---------------------------------------------------------

export interface PdfEmbedImageRequest {
  handle: DocumentHandle;
  image: {
    bytes: Uint8Array;
    mimeType: ImageMimeType;
    width: number;
    height: number;
  };
  placement:
    | {
        kind: 'new-page';
        atIndex: number;
        orientation?: 'portrait' | 'landscape';
      }
    | {
        kind: 'overlay';
        pageIndex: number;
        rect: PdfRect;
        overlayId?: string;
      };
}
export type PdfEmbedImageError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'image_decode_failed'
  | 'tiff_decode_failed'
  | 'out_of_range';
export interface PdfEmbedImageValue {
  op: EditOperationSerialized;
  contentHash: string;
  warnings: string[];
}
export type PdfEmbedImageResponse = Result<PdfEmbedImageValue, PdfEmbedImageError>;

// ---- pdf:replaceText --------------------------------------------------------

export interface PdfReplaceTextRequest {
  handle: DocumentHandle;
  pageIndex: number;
  objectId: string;
  newText: string;
}
export type PdfReplaceTextError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'text_span_not_found'
  | 'missing_glyph'
  | 'out_of_range';
export interface PdfReplaceTextValue {
  op: EditOperationSerialized;
  willClip: boolean;
  overflowPt?: number;
}
export type PdfReplaceTextResponse = Result<PdfReplaceTextValue, PdfReplaceTextError>;

// ---- pdf:identifyTextSpan ---------------------------------------------------

export interface PdfIdentifyTextSpanRequest {
  handle: DocumentHandle;
  pageIndex: number;
  x: number;
  y: number;
}
export type PdfIdentifyTextSpanError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'no_text_at_point'
  | 'out_of_range';
export interface PdfIdentifyTextSpanValue {
  objectId: string;
  runBoundingRect: PdfRect;
  currentText: string;
  font: {
    family: string;
    size: number;
    glyphWidths: Record<number, number>;
    glyphMapSize: number;
  };
}
export type PdfIdentifyTextSpanResponse = Result<
  PdfIdentifyTextSpanValue,
  PdfIdentifyTextSpanError
>;

// ---- pdf:print --------------------------------------------------------------

export interface PdfPrintRequest {
  handle: DocumentHandle;
  ops: EditOperationSerialized[];
  annotations: AnnotationModelSerialized[];
  printerName?: string;
  pageRange?: { start: number; end: number };
  options?: {
    silent?: boolean;
    copies?: number;
    color?: boolean;
    duplex?: 'simplex' | 'short-edge' | 'long-edge';
    pageSize?: 'A4' | 'Letter' | 'Legal' | { width: number; height: number };
  };
}
export type PdfPrintError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'replay_failed'
  | 'no_printers_found'
  | 'printer_not_found'
  | 'user_cancelled'
  | 'print_dispatch_failed';
export interface PdfPrintValue {
  jobDispatched: true;
  engineUsed: 'pdf-lib' | 'chromium';
  warnings: string[];
}
export type PdfPrintResponse = Result<PdfPrintValue, PdfPrintError>;

// ---- pdf:applyEditOps -------------------------------------------------------
// Phase 2 (architecture-phase-2.md §2.5): convenience channel that wraps
// fs:writePdf kind:'ops' so the renderer thunk has a clean async surface
// without composing dialog:saveAs internally. The thunk supplies an explicit
// destination token from a prior dialog:saveAs response OR an outputPath
// (sanitised in main) for headless / silent saves (Phase 3 readiness).

export interface FsApplyEditOpsRequest {
  handle: DocumentHandle;
  ops: EditOperationSerialized[];
  annotations: AnnotationModelSerialized[];
  outputPath?: string;
  destinationToken?: string;
  engine?: 'auto' | 'pdf-lib';
}
export type FsApplyEditOpsError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'token_expired'
  | 'fs_write_failed'
  | 'disk_full'
  | 'op_apply_failed'
  | 'annotation_emit_failed'
  | 'image_decode_failed'
  | 'text_span_not_found'
  | 'missing_glyph'
  | 'serialize_failed'
  | 'encrypted_unsupported';
export interface FsApplyEditOpsValue {
  bytesWritten: number;
  newFileHash: FileHash;
  annotationRefAssignments: Record<string, number>;
  warnings: string[];
}
export type FsApplyEditOpsResponse = Result<FsApplyEditOpsValue, FsApplyEditOpsError>;

// ---- bookmarks:listTree -----------------------------------------------------

export interface BookmarksListTreeRequest {
  fileHash: FileHash;
}
export interface BookmarkNode {
  id: number;
  fileHash: FileHash;
  pageIndex: number;
  title: string;
  createdAt: number;
  parentId: number | null;
  sortOrder: number;
  children: BookmarkNode[];
}
export type BookmarksListTreeError = 'db_unavailable';
export type BookmarksListTreeResponse = Result<{ tree: BookmarkNode[] }, BookmarksListTreeError>;

// ---- bookmarks:move ---------------------------------------------------------

export interface BookmarksMoveRequest {
  id: number;
  newParentId: number | null;
  newSortOrder: number;
}
// Wave 10 / Phase 2.5 (D-10.1): `'invalid_parent'` added to match the
// amended `docs/api-contracts.md §12.6`. The handler no longer translates
// `invalid_parent → invalid_payload` at the wire boundary; the variant
// flows through verbatim from the repo's MoveBookmarkResult union.
export type BookmarksMoveError =
  | 'db_unavailable'
  | 'not_found'
  | 'invalid_payload'
  | 'cycle_detected'
  | 'invalid_parent';
export type BookmarksMoveResponse = Result<Record<string, never>, BookmarksMoveError>;

// ---- bookmarks:rename -------------------------------------------------------

export interface BookmarksRenameRequest {
  id: number;
  title: string;
}
export type BookmarksRenameError = 'db_unavailable' | 'not_found' | 'invalid_payload';
export type BookmarksRenameResponse = Result<Record<string, never>, BookmarksRenameError>;

// ============================================================================
// 10.6 Phase 3 channels (api-contracts.md §13, 2026-05-22, Riley)
// ============================================================================

// ---- forms:detect -----------------------------------------------------------

export interface FormsDetectRequest {
  handle: DocumentHandle;
}
export type FormsDetectError = 'handle_not_found' | 'load_failed' | 'detect_failed';
export interface FormsDetectValue {
  fields: FormFieldDefinition[];
  hasAcroForm: boolean;
  hasXfaForm: boolean;
  hasJavaScriptActions: boolean;
  warnings: string[];
}
export type FormsDetectResponse = Result<FormsDetectValue, FormsDetectError>;

// ---- forms:fill -------------------------------------------------------------

export interface FormsFillRequest {
  handle: DocumentHandle;
  fieldName: string;
  value: FormFieldValue;
}
export type FormsFillError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'field_not_found'
  | 'field_type_mismatch'
  | 'option_not_in_field';
export interface FormsFillValue {
  fieldName: string;
  normalizedValue: FormFieldValue;
  warnings: string[];
}
export type FormsFillResponse = Result<FormsFillValue, FormsFillError>;

// ---- forms:flatten ----------------------------------------------------------

export interface FormsFlattenRequest {
  handle: DocumentHandle;
}
export type FormsFlattenError =
  | 'handle_not_found'
  | 'load_failed'
  | 'form_not_present'
  | 'flatten_failed'
  | 'serialize_failed';
export interface FormsFlattenValue {
  /** EditOperation pushed to dirtyOps (kind: 'form-flatten'). */
  op: EditOperationSerialized;
  flattenedFieldCount: number;
  warnings: string[];
}
export type FormsFlattenResponse = Result<FormsFlattenValue, FormsFlattenError>;

// ---- forms:designAdd --------------------------------------------------------

export interface FormsDesignAddRequest {
  handle: DocumentHandle;
  fieldDefinition: FormFieldDefinition;
}
export type FormsDesignAddError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'duplicate_field_name'
  | 'invalid_field_definition'
  | 'unsupported_field_type'
  | 'page_out_of_range';
export interface FormsDesignAddValue {
  op: EditOperationSerialized;
  normalizedFieldDefinition: FormFieldDefinition;
  warnings: string[];
}
export type FormsDesignAddResponse = Result<FormsDesignAddValue, FormsDesignAddError>;

// ---- forms:designRemove -----------------------------------------------------

export interface FormsDesignRemoveRequest {
  handle: DocumentHandle;
  fieldName: string;
}
export type FormsDesignRemoveError = 'handle_not_found' | 'invalid_payload' | 'field_not_found';
export interface FormsDesignRemoveValue {
  op: EditOperationSerialized;
  warnings: string[];
}
export type FormsDesignRemoveResponse = Result<FormsDesignRemoveValue, FormsDesignRemoveError>;

// ---- forms:listTemplates ----------------------------------------------------

export interface FormsListTemplatesRequest {
  /* no args */
}
export interface FormTemplateListItem {
  id: number;
  name: string;
  fieldCount: number;
  sourceDocHash: string | null;
  createdAt: number;
  updatedAt: number;
}
export type FormsListTemplatesError = 'db_unavailable';
export interface FormsListTemplatesValue {
  items: FormTemplateListItem[];
}
export type FormsListTemplatesResponse = Result<FormsListTemplatesValue, FormsListTemplatesError>;

// ---- forms:saveTemplate -----------------------------------------------------

export interface FormsSaveTemplateRequest {
  handle: DocumentHandle;
  name: string;
  fields: FormFieldDefinition[];
  columnMappings?: Record<string, string>;
}
export type FormsSaveTemplateError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'name_in_use'
  | 'db_unavailable';
export interface FormsSaveTemplateValue {
  id: number;
  warnings: string[];
}
export type FormsSaveTemplateResponse = Result<FormsSaveTemplateValue, FormsSaveTemplateError>;

// ---- forms:loadTemplate -----------------------------------------------------

export interface FormsLoadTemplateRequest {
  templateId: number;
}
export type FormsLoadTemplateError = 'invalid_payload' | 'template_not_found' | 'db_unavailable';
export interface FormsLoadTemplateValue {
  id: number;
  name: string;
  fields: FormFieldDefinition[];
  lastColumnMappings: Record<string, string> | null;
}
export type FormsLoadTemplateResponse = Result<FormsLoadTemplateValue, FormsLoadTemplateError>;

// ---- forms:runMailMerge -----------------------------------------------------

export type MailMergeDataSource =
  | { kind: 'csv'; bytes: Uint8Array; delimiter?: ',' | ';' | '\t' }
  | { kind: 'xlsx'; bytes: Uint8Array };

export type MailMergeOutputMode =
  | { kind: 'folder'; outputFolder: string; filenameTemplate: string }
  | { kind: 'concat'; outputFile: string };

export interface MailMergeJob {
  jobId: string;
  templateHandle: DocumentHandle | null;
  templateId: number | null;
  dataSource: MailMergeDataSource;
  columnMapping: Record<string, string>;
  outputMode: MailMergeOutputMode;
  fields: FormFieldDefinition[];
  /**
   * Phase 3.1 amendment (H-3.2, David, 2026-05-22). When true, the runner
   * flattens each per-row output before writing — produces non-editable PDFs.
   * Mirrors the `flattenInOutput` checkbox in the mail-merge wizard's output
   * step. Optional + defaults to `false` so existing wire callers that omit
   * the field get unchanged (unflattened) behavior. See api-contracts.md §13.9
   * Phase 3.1 amendment banner.
   */
  flattenForms?: boolean;
}

export interface FormsRunMailMergeRequest {
  job: MailMergeJob;
}
export type FormsRunMailMergeError =
  | 'handle_not_found'
  | 'template_not_found'
  | 'invalid_payload'
  | 'data_parse_failed'
  | 'unmapped_required_field'
  | 'row_fill_failed'
  | 'output_path_invalid'
  | 'fs_write_failed'
  | 'cancelled';
export interface FormsRunMailMergeValue {
  jobId: string;
  outputPath: string | null;
  rowsWritten: number;
  totalRows: number;
  wasCancelled: boolean;
  warnings: string[];
}
export type FormsRunMailMergeResponse = Result<FormsRunMailMergeValue, FormsRunMailMergeError>;

// ---- mail-merge:progress (event stream) -------------------------------------

export type MailMergeProgressPhase =
  | 'parsing-data'
  | 'preparing-template'
  | 'rendering-row'
  | 'writing-row'
  | 'finalizing';

export interface MailMergeProgressEvent {
  jobId: string;
  phase: MailMergeProgressPhase;
  currentRow: number;
  totalRows: number;
  percent: number;
  latestWarning?: string;
}

// ---- forms:cancelMailMerge --------------------------------------------------

export interface FormsCancelMailMergeRequest {
  jobId: string;
}
export type FormsCancelMailMergeError = 'job_not_found';
export type FormsCancelMailMergeResponse = Result<Record<string, never>, FormsCancelMailMergeError>;

// ---- forms:parseDataSource (pre-flight for the wizard) ----------------------
// Companion to forms:runMailMerge — the wizard fetches a header + first 5 rows
// for column-mapping UX BEFORE committing to a full run. Bounded payload.

export interface FormsParseDataSourceRequest {
  dataSource: MailMergeDataSource;
  /** Preview rows count cap; default 5, max 50. */
  previewRowCount?: number;
}
export type FormsParseDataSourceError = 'invalid_payload' | 'invalid_data_source';
export interface FormsParseDataSourceValue {
  headers: string[];
  previewRows: Array<Record<string, string>>;
  totalRowCount: number;
  warnings: string[];
}
export type FormsParseDataSourceResponse = Result<
  FormsParseDataSourceValue,
  FormsParseDataSourceError
>;

// ============================================================================
// 10.7 Phase 4 channels (api-contracts.md §14, 2026-05-26, Riley)
// ============================================================================

// ---- signatures:certLoad ----------------------------------------------------

export interface SignaturesCertLoadRequest {
  pfxBytes: Uint8Array;
  /** CONSUMED by main; Buffer-wrapped within ≤5 lines per conventions §15. */
  password: string;
}
export type SignaturesCertLoadError =
  | 'invalid_payload'
  | 'pfx_decode_failed'
  | 'pfx_no_private_key'
  | 'pfx_no_cert'
  | 'wrong_password';
export interface SignaturesCertLoadValue {
  handle: string;
  subjectCN: string;
  issuerCN: string;
  notBefore: number;
  notAfter: number;
  fingerprint: string;
  isExpired: boolean;
}
export type SignaturesCertLoadResponse = Result<SignaturesCertLoadValue, SignaturesCertLoadError>;

// ---- signatures:certRelease -------------------------------------------------

export interface SignaturesCertReleaseRequest {
  handle: string;
}
export type SignaturesCertReleaseError = 'invalid_payload';
export interface SignaturesCertReleaseValue {
  released: boolean;
}
export type SignaturesCertReleaseResponse = Result<
  SignaturesCertReleaseValue,
  SignaturesCertReleaseError
>;

// ---- signatures:applyVisual -------------------------------------------------

export interface SignaturesApplyVisualRequest {
  handle: DocumentHandle;
  placement: SignaturePlacement;
  appearance: VisualAppearanceSpec;
}
export type SignaturesApplyVisualError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'placeholder_field_not_found'
  | 'placeholder_field_already_signed'
  | 'invalid_placement'
  | 'appearance_compose_failed'
  | 'serialize_failed';
export interface SignaturesApplyVisualValue {
  op: EditOperationSerialized;
  warnings: string[];
}
export type SignaturesApplyVisualResponse = Result<
  SignaturesApplyVisualValue,
  SignaturesApplyVisualError
>;

// ---- signatures:applyPades --------------------------------------------------

export interface SignaturesApplyPadesRequest {
  handle: DocumentHandle;
  placement: SignaturePlacement;
  certHandle: string;
  appearance: PadesAppearanceSpec;
  /** null = no TSA; non-null = attempt TSA with fail-loud on failure. */
  tsaUrl: string | null;
  reason?: string;
  location?: string;
  /** /Contents hex placeholder size; default 16384 hex chars (8192 bytes). */
  placeholderSize?: number;
  /** Release certHandle on completion; default true. */
  autoRelease?: boolean;
}
export type SignaturesApplyPadesError =
  | 'handle_not_found'
  | 'cert_handle_not_found'
  | 'cert_expired'
  | 'cert_not_yet_valid'
  | 'invalid_payload'
  | 'placeholder_field_not_found'
  | 'placeholder_field_already_signed'
  | 'invalid_placement'
  | 'appearance_compose_failed'
  | 'pades_sign_failed'
  | 'pades_byte_range_failed'
  | 'pades_placeholder_too_small'
  | 'pades_invalidated_by_subsequent_edit'
  | 'tsa_http_error'
  | 'tsa_tls_error'
  | 'tsa_timeout'
  | 'tsa_invalid_response'
  | 'tsa_nonce_mismatch'
  | 'tsa_genTime_skew'
  | 'tsa_disabled_but_requested'
  | 'serialize_failed'
  | 'audit_log_failed'
  | 'engine_not_available';
export interface SignaturesApplyPadesValue {
  op: EditOperationSerialized;
  auditLogRowId: number;
  signerSubjectCN: string;
  certFingerprint: string;
  signedAt: number;
  tsaResponseStatus: 'ok' | 'failed' | null;
  warnings: string[];
}
export type SignaturesApplyPadesResponse = Result<
  SignaturesApplyPadesValue,
  SignaturesApplyPadesError
>;

// ---- signatures:requestTimestamp -------------------------------------------

export interface SignaturesRequestTimestampRequest {
  tsaUrl: string;
  hash: Uint8Array;
  timeoutMs?: number;
}
export type SignaturesRequestTimestampError =
  | 'invalid_payload'
  | 'tsa_http_error'
  | 'tsa_tls_error'
  | 'tsa_timeout'
  | 'tsa_invalid_response'
  | 'tsa_nonce_mismatch'
  | 'tsa_genTime_skew';
export interface SignaturesRequestTimestampValue {
  tsrBytes: Uint8Array;
  tsTokenBytes: Uint8Array;
  genTime: number;
  /** Decimal stringified bigint (avoid wire-level bigint). */
  serialNumber: string;
}
export type SignaturesRequestTimestampResponse = Result<
  SignaturesRequestTimestampValue,
  SignaturesRequestTimestampError
>;

// ---- signatures:verify ------------------------------------------------------

export interface SignaturesVerifyRequest {
  handle: DocumentHandle;
  auditLogRowId: number;
}
export type SignaturesVerifyError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'audit_row_not_found'
  | 'signature_not_in_document'
  | 'verify_failed';
export interface SignaturesVerifyCertInfo {
  fingerprint: string;
  subjectCN: string;
  issuerCN: string;
  notBefore: number;
  notAfter: number;
  isExpiredNow: boolean;
}
export interface SignaturesVerifyTsaInfo {
  tsaUrl: string;
  genTime: number;
  valid: boolean;
}
export interface SignaturesVerifyValue {
  valid: boolean;
  tamperedSinceSign: boolean;
  certInfo: SignaturesVerifyCertInfo;
  tsaInfo: SignaturesVerifyTsaInfo | null;
}
export type SignaturesVerifyResponse = Result<SignaturesVerifyValue, SignaturesVerifyError>;

// ---- signatures:listAudit ---------------------------------------------------

export interface SignaturesListAuditRequest {
  fileHash?: string;
  signedByFingerprint?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}
export type SignaturesListAuditError = 'invalid_payload' | 'db_unavailable';
export interface SignaturesListAuditValue {
  items: SignatureAuditItem[];
  total: number;
}
export type SignaturesListAuditResponse = Result<
  SignaturesListAuditValue,
  SignaturesListAuditError
>;

// ---- annotations:addShape ---------------------------------------------------

export interface AnnotationsAddShapeRequest {
  handle: DocumentHandle;
  annotation: ShapeAnnotationModel;
}
export type AnnotationsAddShapeError = 'handle_not_found' | 'invalid_payload' | 'out_of_range';
export interface AnnotationsAddShapeValue {
  op: EditOperationSerialized;
  warnings: string[];
}
export type AnnotationsAddShapeResponse = Result<
  AnnotationsAddShapeValue,
  AnnotationsAddShapeError
>;

// ---- annotations:setMeasureCalibration / getMeasureCalibration --------------

export interface AnnotationsSetMeasureCalibrationRequest {
  handle: DocumentHandle;
  calibration: MeasureCalibration;
}
export type AnnotationsSetMeasureCalibrationError = 'handle_not_found' | 'invalid_payload';
export type AnnotationsSetMeasureCalibrationResponse = Result<
  Record<string, never>,
  AnnotationsSetMeasureCalibrationError
>;

export interface AnnotationsGetMeasureCalibrationRequest {
  handle: DocumentHandle;
}
export type AnnotationsGetMeasureCalibrationError = 'handle_not_found';
export interface AnnotationsGetMeasureCalibrationValue {
  calibration: MeasureCalibration | null;
}
export type AnnotationsGetMeasureCalibrationResponse = Result<
  AnnotationsGetMeasureCalibrationValue,
  AnnotationsGetMeasureCalibrationError
>;

// ============================================================================
// 10.8 Phase 4.1 amendment (api-contracts.md §15, 2026-05-26, David)
// ============================================================================
//
// fs:readBytesByHandle — renderer fetches the validated document bytes (already
// held in main's documentStore) so pdf.js can render pages + thumbnails.
//
// SECURITY: the handler reads bytes FROM the in-memory documentStore (keyed by
// handle). No path is involved on the IPC boundary — the bytes were already
// validated at open time by dialog:openPdf / fs:readPdf. The renderer cannot
// escalate to disk via this channel (no path, no fs read).
//
// The bytes cross the IPC bridge as a single Uint8Array — Electron's structured
// clone copies the ArrayBuffer, so the renderer cannot mutate main's copy and
// main never holds a reference to the renderer's copy. Large docs (>100 MB)
// pay a one-shot copy on first render; that's acceptable per the 500 MB cap.
//
// Error variants:
//   - unknown_handle    handle was never registered (or already closed)
//   - document_evicted  handle is registered but bytes are gone (future LRU)
//   - fs_read_failed    reserved for future on-disk-backed handles
// ============================================================================

export interface FsReadBytesByHandleRequest {
  handle: DocumentHandle;
}
export type FsReadBytesByHandleError = 'unknown_handle' | 'document_evicted' | 'fs_read_failed';
export interface FsReadBytesByHandleValue {
  bytes: Uint8Array;
}
export type FsReadBytesByHandleResponse = Result<
  FsReadBytesByHandleValue,
  FsReadBytesByHandleError
>;

// ============================================================================
// 10.9 Phase 5 additions (api-contracts.md §16, 2026-05-27, Riley)
//
// Nine new IPC channels — seven OCR + two scan-* Phase-5.1 placeholders.
// Plus two event streams (`ocr:progress`, `ocr:languagePackDownload:progress`).
//
// Discipline:
//   - All channels use the discriminated-union Result<T, E> shape (§0).
//   - All renderer-facing shapes strip main-only fields (LanguagePack.filePath
//     stays in main; the DTO never carries it). Conventions §16.2.
//   - `OcrJobSummary.pageResults: OcrPageResult[] | null` — nullable late-init,
//     NOT a sentinel empty array. Conventions §16.3.2.
//   - `OcrWord.pdfRect: PdfRect | null` — nullable late-init; populated only
//     after the searchable-pdf-builder transforms image-space → PDF user-space.
//     Conventions §16.3.3.
//   - The `scan:listDevices` / `scan:acquire` handlers return
//     `Result<never, 'not_implemented_phase_5_1'>` (api-contracts §16.9-§16.10).
//     Renderer pattern-matches on this variant to render disabled menu state.
// ============================================================================

// ---- Language pack shapes ---------------------------------------------------

export type OcrLanguagePackSource = 'bundled' | 'downloaded';

/**
 * Renderer-facing language pack DTO (api-contracts.md §16.1).
 *
 * **Boundary discipline (conventions §16.2):** the renderer-facing shape
 * intentionally OMITS `filePath` (which is the absolute on-disk location).
 * Main holds the resolved path; the renderer pattern-matches on `lang` and
 * `source` only. The full row shape (with `filePath`) is `LanguagePackRow`
 * in `src/db/types.ts` (Ravi's domain) and `LanguagePackRecord` in main's
 * `language-pack-manager.ts`.
 */
export interface LanguagePack {
  /** ISO 639-2/3-letter code (e.g. 'eng', 'spa', 'chi_sim'). */
  lang: string;
  /** Display name resolved from the catalog file. */
  displayName: string;
  source: OcrLanguagePackSource;
  sizeBytes: number;
  /** 64-hex-char SHA-256 of the .traineddata.gz file. */
  sha256: string;
  installedAt: number;
  lastUsedAt: number | null;
}

/**
 * Catalog entry — a pack the user CAN download but has not yet installed.
 * No `source` (it's not installed).
 */
export interface LanguagePackCatalogEntry {
  lang: string;
  displayName: string;
  sizeBytes: number;
  sha256: string;
}

// ---- Preprocess options + OCR result shapes (data-models.md §10.2 + §10.6) -

export interface PreprocessOptions {
  deskew: boolean;
  denoise: boolean;
  contrastBoost: boolean;
}

/**
 * Per-word OCR result (data-models.md §10.6).
 *
 * `pdfRect` is **null until the page is text-behind-image-composed** —
 * per the Phase 4.1 sentinel-default lesson, consumers read `pdfRect === null`
 * as "not yet composed" rather than treating `{ x:0, y:0, width:0, height:0 }`
 * as a real value. Conventions §16.3.3.
 */
export interface OcrWord {
  text: string;
  /** Confidence 0..100, Tesseract default scale. */
  confidence: number;
  imgRect: { x0: number; y0: number; x1: number; y1: number };
  /** PDF user-space rect — late-init; null until searchable-pdf-builder runs. */
  pdfRect: PdfRect | null;
}

export interface OcrPageResult {
  pageIndex: number;
  imgDimsPx: { widthPx: number; heightPx: number };
  totalWords: number;
  lowConfidenceWords: number;
  meanConfidence: number;
  /** Sorted reading-order (top-to-bottom, left-to-right within a line). */
  words: OcrWord[];
  durationMs: number;
}

export type OcrJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'superseded_by_undo';

/**
 * Per-job summary (data-models.md §10.7).
 *
 * `pageResults` is the canonical late-init field: `null` while the job is
 * in-flight; populated on completion (or 'cancelled' with partial results,
 * or 'failed' with whatever pages completed before the failure). NEVER a
 * sentinel empty array — conventions §16.3.2.
 */
export interface OcrJobSummary {
  jobId: number;
  pageRange: { start: number; end: number };
  langs: string[];
  status: 'completed' | 'cancelled' | 'failed';
  totalWords: number;
  meanConfidence: number;
  totalDurationMs: number;
  /** NULLABLE — late-init. Conventions §16.3.2 (NOT a sentinel array). */
  pageResults: OcrPageResult[] | null;
  error?: string;
}

export interface OcrJobRowDto {
  id: number;
  docHash: string;
  pageRange: { start: number; end: number };
  /** Parsed from the '+'-joined langs string. */
  langs: string[];
  /** Parsed from the JSON-encoded preprocess_json column. */
  preprocess: PreprocessOptions;
  status: OcrJobStatus;
  startedAt: number;
  completedAt: number | null;
  meanConfidence: number | null;
  totalWords: number | null;
  errorMessage: string | null;
  invalidatedSignatures: boolean;
  createdAt: number;
}

// ---- ocr:detectLanguages (api-contracts.md §16.1) ---------------------------

export interface OcrDetectLanguagesRequest {
  /* empty body */
}

export type OcrDetectLanguagesError = 'catalog_load_failed';

export interface OcrDetectLanguagesValue {
  installed: LanguagePack[];
  downloadable: LanguagePackCatalogEntry[];
  /** Current value of setting `ocr.defaultLang` (e.g. 'eng'). */
  defaultLang: string;
}

export type OcrDetectLanguagesResponse = Result<OcrDetectLanguagesValue, OcrDetectLanguagesError>;

// ---- ocr:runOnPage (api-contracts.md §16.2) ---------------------------------

export interface OcrRunOnPageRequest {
  handle: DocumentHandle;
  pageIndex: number;
  /** One OR more langs; the engine joins with '+' for tesseract.js multi-lang. */
  langs: string[];
  preprocess: PreprocessOptions;
  /** Required true if the doc has prior PAdES signatures (per conventions §16.5). */
  invalidatesSignaturesConfirmed?: boolean;
}

export type OcrRunOnPageError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_out_of_range'
  | 'language_pack_not_installed'
  | 'signed_pdf_requires_confirm'
  | 'pdf_render_failed'
  | 'ocr_engine_failed'
  | 'worker_watchdog_timeout';

export interface OcrRunOnPageValue {
  pageResult: OcrPageResult;
  durationMs: number;
}

export type OcrRunOnPageResponse = Result<OcrRunOnPageValue, OcrRunOnPageError>;

// ---- ocr:runOnDocument (api-contracts.md §16.3) -----------------------------

export interface OcrRunOnDocumentRequest {
  handle: DocumentHandle;
  /** Inclusive: start <= end < doc.pageCount. */
  pageRange: { start: number; end: number };
  langs: string[];
  preprocess: PreprocessOptions;
  invalidatesSignaturesConfirmed?: boolean;
}

export type OcrRunOnDocumentError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_range_out_of_range'
  | 'language_pack_not_installed'
  | 'signed_pdf_requires_confirm'
  | 'ocr_engine_failed'
  | 'output_serialize_failed'
  | 'cancelled';

export interface OcrRunOnDocumentValue {
  jobId: number;
  summary: OcrJobSummary;
  op: EditOperationSerialized;
}

export type OcrRunOnDocumentResponse = Result<OcrRunOnDocumentValue, OcrRunOnDocumentError>;

// ---- ocr:progress event stream (api-contracts.md §16.4) ---------------------

export type OcrProgressEvent =
  | { jobId: number; phase: 'starting'; totalPages: number }
  | { jobId: number; phase: 'rasterizing'; pageIndex: number; totalPages: number }
  | { jobId: number; phase: 'preprocessing'; pageIndex: number; totalPages: number }
  | {
      jobId: number;
      phase: 'recognizing';
      pageIndex: number;
      totalPages: number;
      confidenceSoFar: number | null;
    }
  | {
      jobId: number;
      phase: 'composing-text-behind-image';
      pageIndex: number;
      totalPages: number;
    }
  | { jobId: number; phase: 'writing-output'; pageIndex: number; totalPages: number }
  | { jobId: number; phase: 'completed'; summary: OcrJobSummary }
  | {
      jobId: number;
      phase: 'cancelled';
      pagesCompleted: number;
      totalPages: number;
    }
  | {
      jobId: number;
      phase: 'failed';
      pagesCompleted: number;
      totalPages: number;
      error: string;
    };

// ---- ocr:cancelJob (api-contracts.md §16.5) ---------------------------------

export interface OcrCancelJobRequest {
  jobId: number;
}

export type OcrCancelJobError = 'invalid_payload' | 'job_not_found' | 'job_already_terminal';

export interface OcrCancelJobValue {
  cancelled: boolean;
  pagesCompleted: number;
}

export type OcrCancelJobResponse = Result<OcrCancelJobValue, OcrCancelJobError>;

// ---- ocr:listJobs (api-contracts.md §16.6) ----------------------------------

export interface OcrListJobsFilters {
  docHash?: string;
  status?: OcrJobStatus;
  since?: number;
  until?: number;
}

export interface OcrListJobsRequest {
  filters?: OcrListJobsFilters;
  limit?: number;
  offset?: number;
}

export type OcrListJobsError = 'invalid_payload';

export interface OcrListJobsValue {
  jobs: OcrJobRowDto[];
  total: number;
}

export type OcrListJobsResponse = Result<OcrListJobsValue, OcrListJobsError>;

// ---- ocr:languagePackDownload (api-contracts.md §16.7) ----------------------

export interface OcrLanguagePackDownloadRequest {
  /** Catalog code, e.g. 'spa'. */
  lang: string;
}

export type OcrLanguagePackDownloadError =
  | 'invalid_payload'
  | 'lang_not_in_catalog'
  | 'pack_already_installed'
  | 'network_error'
  | 'pack_integrity_failed'
  | 'disk_write_failed'
  | 'cancelled';

export interface OcrLanguagePackDownloadValue {
  pack: LanguagePack;
}

export type OcrLanguagePackDownloadResponse = Result<
  OcrLanguagePackDownloadValue,
  OcrLanguagePackDownloadError
>;

export type OcrLanguagePackDownloadProgressEvent =
  | { lang: string; phase: 'starting'; totalBytes: number }
  | {
      lang: string;
      phase: 'downloading';
      bytesDownloaded: number;
      totalBytes: number;
    }
  | { lang: string; phase: 'verifying' }
  | { lang: string; phase: 'completed'; pack: LanguagePack }
  | { lang: string; phase: 'cancelled' }
  | { lang: string; phase: 'failed'; error: string };

// ---- ocr:languagePackRemove (api-contracts.md §16.8) ------------------------

export interface OcrLanguagePackRemoveRequest {
  lang: string;
}

export type OcrLanguagePackRemoveError =
  | 'invalid_payload'
  | 'pack_not_installed'
  | 'cannot_remove_bundled'
  | 'disk_unlink_failed';

export interface OcrLanguagePackRemoveValue {
  removed: boolean;
}

export type OcrLanguagePackRemoveResponse = Result<
  OcrLanguagePackRemoveValue,
  OcrLanguagePackRemoveError
>;

// ---- scan:listDevices — LIVE in Phase 5.1 (api-contracts.md §16.9) ----------
//
// Phase 5.1 (Wave 5.1, David): the native WIA addon (native/wia-scanner/) makes
// this channel LIVE on Windows. The `not_implemented_phase_5_1` variant is
// RETIRED — replaced by `scanner_unavailable` (non-Windows / addon missing /
// WIA service down) so the renderer degrades gracefully instead of treating it
// as a permanent "coming later" state. The value shape matches the reserved
// §16.9 contract: { devices: ScanDevice[] }.

export interface ScanListDevicesRequest {
  /* empty body */
}

export interface ScanDevice {
  /** Stable WIA device id (WIA_DIP_DEV_ID). */
  deviceId: string;
  /** Human-readable device name (WIA_DIP_DEV_NAME). */
  name: string;
  /** "scanner" | "camera" | "video" | "unknown" (from STI device type). */
  type: string;
  /** Device description (WIA_DIP_DEV_DESC); may be empty. */
  description: string;
}

export interface ScanListDevicesValue {
  devices: ScanDevice[];
}

export type ScanListDevicesError =
  | 'scanner_unavailable' // non-Windows, addon missing, or WIA service down
  | 'enumeration_failed'
  | 'addon_internal_error';

export type ScanListDevicesResponse = Result<ScanListDevicesValue, ScanListDevicesError>;

// ---- scan:acquire — LIVE in Phase 5.1 (api-contracts.md §16.10) -------------
//
// Acquires one or more pages from a WIA scanner and composes them into a single
// PDF (the "scan -> PDF" use case). Bytes of the composed PDF do NOT cross the
// IPC boundary; the handler registers the result in the document store and
// returns a DocumentHandle (same discipline as dialog:openPdf / pdf:combine),
// so the renderer opens the scan exactly like any other document. Optionally
// the handler can chain into the OCR pipeline for scan -> searchable-PDF.

export interface ScanAcquireRequest {
  /** Empty => first enumerated device. */
  deviceId?: string;
  /** DPI; default 300. */
  resolution?: number;
  colorMode?: 'bw' | 'grayscale' | 'color';
  /** 'feeder' = ADF multi-page; 'flatbed' = single; 'auto' = device default. */
  source?: 'auto' | 'flatbed' | 'feeder';
}

export interface ScanAcquireValue {
  /** Handle to the composed PDF, registered in the document store. */
  handle: DocumentHandle;
  /** Display name for the scanned document (e.g. "Scan 2026-05-28"). */
  displayName: string;
  /** Number of pages acquired + composed. */
  pageCount: number;
  /** Non-fatal observations (e.g. "multi-page TIFF: first page used"). */
  warnings: string[];
}

export type ScanAcquireError =
  | 'invalid_payload'
  | 'scanner_unavailable'
  | 'no_device'
  | 'device_open_failed'
  | 'no_scan_item'
  | 'transfer_unsupported'
  | 'acquisition_failed'
  | 'page_decode_failed'
  | 'pdf_compose_failed'
  | 'addon_internal_error';

export type ScanAcquireResponse = Result<ScanAcquireValue, ScanAcquireError>;

// ============================================================================
// 10.6 Phase 6 export-to-Office (api-contracts.md §17, data-models.md §11)
//
// Eight new channels for PDF → docx / xlsx / pptx / png / jpeg / tiff export.
// All channels are read-only on the source document; the engine composes new
// output buffers via per-format writers and writes atomically (write-temp +
// rename). Bytes never cross to the renderer — only basename + dirHint.
//
// Discipline (conventions §17):
//   - Required-on-interface writer deps (no optional stub fallback)
//   - LayoutRect is `T | null` everywhere (NEVER {0,0,0,0} sentinel)
//   - No `as any` / `@ts-ignore` in writers
//   - qualityTier is z.enum(...) NEVER .optional() (Q-D discipline)
//   - outputPath stays in main; DTO carries outputBasename + outputDirHint
// ============================================================================

export type ExportFormat = 'docx' | 'xlsx' | 'pptx' | 'png' | 'jpeg' | 'tiff';
export type ImageExportFormat = 'png' | 'jpeg' | 'tiff';
export type ExportQualityTier = 'text-only' | 'layout-preserving';
export type ExportJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

/**
 * Job summary returned on completion of every export:to* channel. Mirrors
 * the data-models.md §11.5 DTO. All "until done" fields are NULLABLE per the
 * anti-sentinel discipline — NEVER `0` / `-1` placeholders.
 */
export interface ExportJobSummary {
  jobId: number;
  format: ExportFormat;
  qualityTier: ExportQualityTier | 'n/a';
  pageCount: number;
  durationMs: number;
  outputBasename: string;
  outputDirHint: string;
  outputSizeBytes: number;
  /** Null for image formats; non-null for docx/xlsx/pptx after completion. */
  contentStats: {
    paragraphsExtracted: number;
    tablesDetected: number;
    imagesEmbedded: number;
  } | null;
  /**
   * Nullable + late-init per the Phase 5 sentinel-default lesson (P5-L-7
   * reaffirmed in P6-L cross-check). NULL until the export starts;
   * populated incrementally during run. NEVER a sentinel empty array.
   */
  perPageProgress: Array<{
    pageIndex: number;
    phase: string;
    completedAt: number | null;
  }> | null;
}

/**
 * Row DTO from `export_jobs` table (data-models.md §11.5). The renderer
 * never sees the absolute `outputPath` — only `outputBasename` +
 * `outputDirHint`. Per-format extras nest into `imageOptions` (null for
 * office formats); office-only stats nest into `contentStats` (null for
 * image formats AND until status='completed').
 */
export interface ExportJobRowDto {
  id: number;
  docHash: string;
  format: ExportFormat;
  qualityTier: ExportQualityTier | 'n/a';
  pageRange: { start: number; end: number };
  includeAnnotations: boolean;
  /** Image-format-specific; null for office formats */
  imageOptions: {
    dpi: number;
    jpegQuality: number | null;
    multiPageTiff: boolean | null;
  } | null;
  /** Basename of output_path; absolute path NOT exposed (boundary discipline). */
  outputBasename: string;
  outputDirHint: string;
  outputSizeBytes: number | null;
  status: ExportJobStatus;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  pagesProcessed: number;
  /** Office-format-specific; null for image formats AND until done. */
  contentStats: {
    paragraphsExtracted: number;
    tablesDetected: number;
    imagesEmbedded: number;
  } | null;
  errorMessage: string | null;
  createdAt: number;
}

// ---- export:toDocx (api-contracts.md §17.1) --------------------------------

export interface ExportToDocxRequest {
  handle: DocumentHandle;
  /** Inclusive: start <= end < doc.pageCount */
  pageRange: { start: number; end: number };
  qualityTier: ExportQualityTier;
  includeAnnotations: boolean;
  pageSize: 'letter' | 'a4' | 'auto';
  outputPath: string;
}

export type ExportToDocxError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_range_out_of_range'
  | 'output_path_unwritable'
  | 'queue_full'
  | 'extraction_failed'
  | 'writer_failed'
  | 'output_write_failed'
  | 'cancelled';

export interface ExportToDocxValue {
  jobId: number;
  summary: ExportJobSummary;
}

export type ExportToDocxResponse = Result<ExportToDocxValue, ExportToDocxError>;

// ---- export:toXlsx (api-contracts.md §17.2) --------------------------------

export interface ExportToXlsxRequest {
  handle: DocumentHandle;
  pageRange: { start: number; end: number };
  qualityTier: ExportQualityTier;
  includeAnnotations: boolean;
  outputPath: string;
}

export type ExportToXlsxError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_range_out_of_range'
  | 'output_path_unwritable'
  | 'queue_full'
  | 'extraction_failed'
  | 'writer_failed'
  | 'output_write_failed'
  | 'cancelled';

export interface ExportToXlsxValue {
  jobId: number;
  summary: ExportJobSummary;
}

export type ExportToXlsxResponse = Result<ExportToXlsxValue, ExportToXlsxError>;

// ---- export:toPptx (api-contracts.md §17.3) --------------------------------

export interface ExportToPptxRequest {
  handle: DocumentHandle;
  pageRange: { start: number; end: number };
  qualityTier: ExportQualityTier;
  includeAnnotations: boolean;
  outputPath: string;
}

export type ExportToPptxError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_range_out_of_range'
  | 'output_path_unwritable'
  | 'queue_full'
  | 'extraction_failed'
  | 'writer_failed'
  | 'output_write_failed'
  | 'cancelled';

export interface ExportToPptxValue {
  jobId: number;
  summary: ExportJobSummary;
}

export type ExportToPptxResponse = Result<ExportToPptxValue, ExportToPptxError>;

// ---- export:toImages (api-contracts.md §17.4) ------------------------------

export interface ExportToImagesRequest {
  handle: DocumentHandle;
  pageRange: { start: number; end: number };
  format: ImageExportFormat;
  /** 72-600 inclusive */
  dpi: number;
  /** 0.1-1.0; honored ONLY when format='jpeg' */
  jpegQuality?: number;
  /** Honored ONLY when format='tiff' */
  multiPageTiff?: boolean;
  includeAnnotations: boolean;
  /** Basename for single-page formats; final path for multi-page tiff */
  outputPath: string;
}

export type ExportToImagesError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_range_out_of_range'
  | 'output_path_unwritable'
  | 'queue_full'
  | 'rasterize_failed'
  | 'encode_failed'
  | 'output_write_failed'
  | 'cancelled';

export interface ExportToImagesValue {
  jobId: number;
  summary: ExportJobSummary;
  /** ONE entry per page for single-page formats; ONE entry total for multi-page tiff. */
  outputPaths: string[];
}

export type ExportToImagesResponse = Result<ExportToImagesValue, ExportToImagesError>;

// ---- export:progress event stream (api-contracts.md §17.5) -----------------

export type ExportProgressEvent =
  | { jobId: number; format: ExportFormat; phase: 'starting'; totalPages: number }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'extracting-text';
      pageIndex: number;
      totalPages: number;
    }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'detecting-tables';
      pageIndex: number;
      totalPages: number;
    }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'extracting-images';
      pageIndex: number;
      totalPages: number;
    }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'rasterizing';
      pageIndex: number;
      totalPages: number;
    }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'writing-output';
      bytesWritten: number;
      totalBytesEstimate: number | null;
    }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'completed';
      summary: ExportJobSummary;
    }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'cancelled';
      pagesCompleted: number;
      totalPages: number;
    }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'failed';
      pagesCompleted: number;
      totalPages: number;
      error: string;
    };

// ---- export:cancelJob (api-contracts.md §17.6) -----------------------------

export interface ExportCancelJobRequest {
  jobId: number;
}

export type ExportCancelJobError = 'invalid_payload' | 'job_not_found' | 'job_already_terminal';

export interface ExportCancelJobValue {
  cancelled: boolean;
  pagesCompleted: number;
}

export type ExportCancelJobResponse = Result<ExportCancelJobValue, ExportCancelJobError>;

// ---- export:listJobs (api-contracts.md §17.7) ------------------------------

export interface ExportListJobsFilters {
  docHash?: string;
  format?: ExportFormat;
  status?: ExportJobStatus;
  since?: number;
  until?: number;
}

export interface ExportListJobsRequest {
  filters?: ExportListJobsFilters;
  /** Default 100, max 1000 */
  limit?: number;
  offset?: number;
}

export type ExportListJobsError = 'invalid_payload';

export interface ExportListJobsValue {
  jobs: ExportJobRowDto[];
  total: number;
}

export type ExportListJobsResponse = Result<ExportListJobsValue, ExportListJobsError>;

// ---- export:listFormats (api-contracts.md §17.8) ---------------------------

export interface ExportListFormatsRequest {
  /* empty body */
}

// Handler is infallible — kept as a type-system signal only.
export type ExportListFormatsError = 'never';

export interface ExportFormatDescriptor {
  format: ExportFormat;
  displayName: string;
  defaultExtension: string;
  category: 'office' | 'image';
  supportsQualityTier: boolean;
  defaultQualityTier: ExportQualityTier | 'n/a';
  defaultIncludeAnnotations: boolean;
  settingKeys: string[];
}

export interface ExportListFormatsValue {
  formats: ExportFormatDescriptor[];
}

export type ExportListFormatsResponse = Result<ExportListFormatsValue, ExportListFormatsError>;

// ---- dialog:pickExportOutputPath (api-contracts.md §17.9) ------------------

export interface DialogPickExportOutputPathRequest {
  defaultBasename: string;
  format: ExportFormat;
}

export type DialogPickExportOutputPathError = 'invalid_payload';

export interface DialogPickExportOutputPathValue {
  outputPath: string | null;
}

export type DialogPickExportOutputPathResponse = Result<
  DialogPickExportOutputPathValue,
  DialogPickExportOutputPathError
>;

// ============================================================================
// 10.18 Phase 7 — auto-update + telemetry + i18n (api-contracts.md §18)
//
// Eight new channels across three domains: update:* (auto-update),
// telemetry:* (opt-in usage counts), i18n:* (localization). Plus the
// update:onProgress event stream + telemetry:getBuffer (folded into
// telemetry:getStatus { includeBuffer: true }). The Phase 1-6 surface is
// FROZEN; this is the FINAL roadmap-phase contract amendment + the v1.0.0-rc
// contract freeze.
//
// PRIVACY (conventions §18.5): telemetry payloads PHYSICALLY cannot carry PII
// — there is no free-text / path / value / id field. The zod schema at the
// handler boundary is `.strict()` (rejects any extra property). The transport
// is an in-memory NoOpRingBufferTransport; nothing leaves the machine.
//
// HONESTY (architecture-phase-7.md §3.4): the update controller returns an
// explicit `update_not_configured` when the publish target is a placeholder —
// NEVER a fake "up to date".
// ============================================================================

// ---- update:check (api-contracts.md §18.1) ---------------------------------

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'not-configured';

export interface UpdateCheckRequest {
  /** 'launch' callers MUST have verified `settings.update.channel` first. */
  trigger: 'explicit' | 'launch';
}

export type UpdateCheckError =
  | 'invalid_payload'
  | 'update_not_configured' // publish target is a PLACEHOLDER (P7-L-2); HONEST, not fake up-to-date
  | 'network_failed'
  | 'feed_parse_failed';

export interface UpdateCheckValue {
  status: UpdateStatus;
  /** null unless status === 'available' (NO sentinel ''). */
  availableVersion: string | null;
  /** app.getVersion(). */
  currentVersion: string;
  /** ms epoch; the controller stamps + persists this to settings. */
  lastCheckedAt: number;
}

export type UpdateCheckResponse = Result<UpdateCheckValue, UpdateCheckError>;

// ---- update:download (api-contracts.md §18.2) ------------------------------

export interface UpdateDownloadRequest {
  /** The availableVersion from a prior check (guards stale UI). */
  version: string;
}

export type UpdateDownloadError =
  | 'invalid_payload'
  | 'update_not_configured'
  | 'no_update_available'
  | 'download_failed'
  | 'signature_verification_failed'; // cert dependency; P7-L-2 §3.5

export interface UpdateDownloadValue {
  status: 'downloaded';
  version: string;
}

export type UpdateDownloadResponse = Result<UpdateDownloadValue, UpdateDownloadError>;

// ---- update:install (api-contracts.md §18.3) -------------------------------

export interface UpdateInstallRequest {
  /** Must match the downloaded version. */
  version: string;
  /**
   * Unsaved-work install gate (Phase 7.1 — Julian H-29.1, mirrors the OCR
   * `invalidatesSignaturesConfirmed` PAdES-confirm pattern). When the renderer
   * has unsaved edits/annotations/signatures and the user has explicitly chosen
   * "Discard and install", it sets this `true`. If unsaved work exists and this
   * is falsy, the controller refuses with `unsaved_work_blocks_install` so the
   * renderer can show a "Save before updating?" dialog instead of silently
   * discarding work on quitAndInstall.
   */
  confirmedDiscardUnsaved?: boolean;
}

export type UpdateInstallError =
  | 'invalid_payload'
  | 'no_downloaded_update'
  // Unsaved edits/annotations/signatures exist and the user has NOT confirmed
  // discarding them (Phase 7.1 — Julian H-29.1). The renderer surfaces a
  // Save / Discard-and-install / Cancel dialog, then retries with
  // `confirmedDiscardUnsaved: true`.
  | 'unsaved_work_blocks_install'
  | 'install_failed';

// On success the process quits; the handler returns ok({ quitting: true })
// immediately, then schedules quitAndInstall on the next tick.
export interface UpdateInstallValue {
  quitting: true;
}

export type UpdateInstallResponse = Result<UpdateInstallValue, UpdateInstallError>;

// ---- update:onProgress event stream (api-contracts.md §18.3) ---------------

export interface UpdateProgressEvent {
  version: string;
  /** 0-100. */
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

// ---- telemetry:recordEvent (api-contracts.md §18.4) ------------------------

export type TelemetryEventName =
  | 'app.launch'
  | 'doc.open'
  | 'doc.save'
  | 'feature.annotate.add'
  | 'feature.page.reorder'
  | 'feature.combine.run'
  | 'feature.form.fill'
  | 'feature.mailmerge.run'
  | 'feature.sign.pades'
  | 'feature.ocr.run'
  | 'feature.export.docx'
  | 'feature.export.xlsx'
  | 'feature.export.pptx'
  | 'feature.export.image'
  | 'feature.update.checked'
  | 'feature.locale.changed';

export interface TelemetryRecordEventRequest {
  name: TelemetryEventName;
  /** 'YYYY-MM-DD' — coarse; NO sub-day timestamp (anti-fingerprint). */
  dayBucket: string;
  // NO other fields permitted. NO document content, NO file paths, NO field
  // values, NO user id. The handler zod schema is `.strict()`.
}

export type TelemetryRecordEventError =
  | 'invalid_payload'
  | 'not_opted_in' // opt-in OFF; event dropped
  | 'not_allowlisted'; // name not in the static allowlist; dropped

export interface TelemetryRecordEventValue {
  /** false when dropped (not opted in / not allowlisted). */
  recorded: boolean;
}

export type TelemetryRecordEventResponse = Result<
  TelemetryRecordEventValue,
  TelemetryRecordEventError
>;

// ---- telemetry:setOptIn (api-contracts.md §18.5) ---------------------------

export interface TelemetrySetOptInRequest {
  optIn: boolean;
}

export type TelemetrySetOptInError = 'invalid_payload' | 'settings_write_failed';

export interface TelemetrySetOptInValue {
  optIn: boolean;
  /** true when turning OFF (the ring buffer is cleared on opt-out). */
  bufferCleared: boolean;
}

export type TelemetrySetOptInResponse = Result<TelemetrySetOptInValue, TelemetrySetOptInError>;

// ---- telemetry:getStatus (api-contracts.md §18.6) --------------------------

export interface TelemetryGetStatusRequest {
  /** Debug panel passes true to receive the auditable buffer snapshot. */
  includeBuffer: boolean;
}

export type TelemetryGetStatusError = 'invalid_payload';

/** The auditable buffer entry — name + dayBucket ONLY (no PII). */
export interface TelemetryBufferEntry {
  name: TelemetryEventName;
  dayBucket: string;
}

export interface TelemetryGetStatusValue {
  optedIn: boolean;
  bufferedCount: number;
  /** nullable + late-init (NO sentinel 0). */
  lastEventAt: number | null;
  /** Only present (non-null) when includeBuffer === true. */
  buffer: TelemetryBufferEntry[] | null;
}

export type TelemetryGetStatusResponse = Result<TelemetryGetStatusValue, TelemetryGetStatusError>;

// ---- i18n:setLocale (api-contracts.md §18.7) -------------------------------

export interface I18nSetLocaleRequest {
  locale: AppLocale;
}

export type I18nSetLocaleError = 'invalid_payload' | 'unsupported_locale' | 'settings_write_failed';

export interface I18nSetLocaleValue {
  locale: AppLocale;
}

export type I18nSetLocaleResponse = Result<I18nSetLocaleValue, I18nSetLocaleError>;

// ---- i18n:getAvailableLocales (api-contracts.md §18.8) ---------------------

export interface I18nGetAvailableLocalesRequest {
  /* empty */
}

// Always succeeds (static list). The error union has no inhabitants; kept for
// Result<> shape parity. (Using `never` per the contract spec; the handler
// always returns ok().)
export type I18nGetAvailableLocalesError = never;

export interface LocaleDescriptor {
  locale: AppLocale;
  /** 'English (US)' / 'Español (España)'. */
  nativeName: string;
  /** false for the proof locale — UI shows "translation sample, some English". */
  complete: boolean;
}

export interface I18nGetAvailableLocalesValue {
  locales: LocaleDescriptor[];
}

export type I18nGetAvailableLocalesResponse = Result<
  I18nGetAvailableLocalesValue,
  I18nGetAvailableLocalesError
>;

// ============================================================================
// 11. Channel-name registry
// ============================================================================

export const Channels = {
  // dialog
  DialogOpenPdf: 'dialog:openPdf',
  DialogSaveAs: 'dialog:saveAs',
  // fs
  FsReadPdf: 'fs:readPdf',
  FsWritePdf: 'fs:writePdf',
  FsClosePdf: 'fs:closePdf',
  // recents
  RecentsList: 'recents:list',
  RecentsAdd: 'recents:add',
  RecentsClear: 'recents:clear',
  // settings
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  SettingsGetAll: 'settings:getAll',
  // bookmarks
  BookmarksList: 'bookmarks:list',
  BookmarksUpsert: 'bookmarks:upsert',
  BookmarksDelete: 'bookmarks:delete',
  // Phase 2 bookmarks
  BookmarksListTree: 'bookmarks:listTree',
  BookmarksMove: 'bookmarks:move',
  BookmarksRename: 'bookmarks:rename',
  // pdf
  PdfCombine: 'pdf:combine',
  PdfExport: 'pdf:export',
  PdfExportProgress: 'pdf:export:progress',
  PdfGetOutline: 'pdf:getOutline',
  // Phase 2 pdf
  PdfEmbedImage: 'pdf:embedImage',
  PdfReplaceText: 'pdf:replaceText',
  PdfIdentifyTextSpan: 'pdf:identifyTextSpan',
  PdfPrint: 'pdf:print',
  // Phase 2 fs (replay-engine entry point)
  FsApplyEditOps: 'fs:applyEditOps',
  // Phase 4.1 (api-contracts.md §15, David)
  FsReadBytesByHandle: 'fs:readBytesByHandle',
  // app
  AppGetVersion: 'app:getVersion',
  AppQuit: 'app:quit',
  AppSetDefaultPdfHandler: 'app:setDefaultPdfHandler',
  AppGetDefaultPdfHandlerStatus: 'app:getDefaultPdfHandlerStatus',
  AppOpenExternal: 'app:openExternal',
  // window
  WindowMinimize: 'window:minimize',
  WindowMaximize: 'window:maximize',
  WindowClose: 'window:close',
  WindowGetState: 'window:getState',
  // Phase 3 forms (api-contracts.md §13)
  FormsDetect: 'forms:detect',
  FormsFill: 'forms:fill',
  FormsFlatten: 'forms:flatten',
  FormsDesignAdd: 'forms:designAdd',
  FormsDesignRemove: 'forms:designRemove',
  FormsListTemplates: 'forms:listTemplates',
  FormsSaveTemplate: 'forms:saveTemplate',
  FormsLoadTemplate: 'forms:loadTemplate',
  FormsRunMailMerge: 'forms:runMailMerge',
  FormsCancelMailMerge: 'forms:cancelMailMerge',
  FormsParseDataSource: 'forms:parseDataSource',
  MailMergeProgress: 'mail-merge:progress',
  // Phase 4 signatures + shape annotations (api-contracts.md §14)
  SignaturesCertLoad: 'signatures:certLoad',
  SignaturesCertRelease: 'signatures:certRelease',
  SignaturesApplyVisual: 'signatures:applyVisual',
  SignaturesApplyPades: 'signatures:applyPades',
  SignaturesRequestTimestamp: 'signatures:requestTimestamp',
  SignaturesVerify: 'signatures:verify',
  SignaturesListAudit: 'signatures:listAudit',
  AnnotationsAddShape: 'annotations:addShape',
  AnnotationsSetMeasureCalibration: 'annotations:setMeasureCalibration',
  AnnotationsGetMeasureCalibration: 'annotations:getMeasureCalibration',
  // Phase 5 OCR + scan-* placeholders (api-contracts.md §16)
  OcrDetectLanguages: 'ocr:detectLanguages',
  OcrRunOnPage: 'ocr:runOnPage',
  OcrRunOnDocument: 'ocr:runOnDocument',
  OcrCancelJob: 'ocr:cancelJob',
  OcrListJobs: 'ocr:listJobs',
  OcrLanguagePackDownload: 'ocr:languagePackDownload',
  OcrLanguagePackRemove: 'ocr:languagePackRemove',
  OcrProgress: 'ocr:progress',
  OcrLanguagePackDownloadProgress: 'ocr:languagePackDownload:progress',
  ScanListDevices: 'scan:listDevices',
  ScanAcquire: 'scan:acquire',
  // Phase 6 export-to-Office (api-contracts.md §17)
  ExportToDocx: 'export:toDocx',
  ExportToXlsx: 'export:toXlsx',
  ExportToPptx: 'export:toPptx',
  ExportToImages: 'export:toImages',
  ExportCancelJob: 'export:cancelJob',
  ExportListJobs: 'export:listJobs',
  ExportListFormats: 'export:listFormats',
  ExportProgress: 'export:progress',
  DialogPickExportOutputPath: 'dialog:pickExportOutputPath',
  // Phase 7 (api-contracts.md §18) — auto-update + telemetry + i18n.
  UpdateCheck: 'update:check',
  UpdateDownload: 'update:download',
  UpdateInstall: 'update:install',
  UpdateProgress: 'update:onProgress',
  TelemetryRecordEvent: 'telemetry:recordEvent',
  TelemetrySetOptIn: 'telemetry:setOptIn',
  TelemetryGetStatus: 'telemetry:getStatus',
  I18nSetLocale: 'i18n:setLocale',
  I18nGetAvailableLocales: 'i18n:getAvailableLocales',
} as const;

export type ChannelName = (typeof Channels)[keyof typeof Channels];

// ============================================================================
// 12. Aggregate PdfApi (preload bridge surface)
// ============================================================================

export interface PdfApi {
  dialog: {
    openPdf: () => Promise<DialogOpenPdfResponse>;
    saveAs: (req: DialogSaveAsRequest) => Promise<DialogSaveAsResponse>;
    // Phase 6 (api-contracts.md §17.9): main-process file SAVE-AS dialog
    // for export output. Returns the absolute path (null on cancel).
    pickExportOutputPath: (
      req: DialogPickExportOutputPathRequest,
    ) => Promise<DialogPickExportOutputPathResponse>;
  };
  fs: {
    readPdf: (req: FsReadPdfRequest) => Promise<FsReadPdfResponse>;
    writePdf: (req: FsWritePdfRequest) => Promise<FsWritePdfResponse>;
    closePdf: (req: FsClosePdfRequest) => Promise<FsClosePdfResponse>;
    // Phase 2 (architecture-phase-2.md §2.5): replay-engine entry point.
    applyEditOps: (req: FsApplyEditOpsRequest) => Promise<FsApplyEditOpsResponse>;
    // Phase 4.1 (api-contracts.md §15): renderer fetches document bytes for
    // pdf.js rendering. Lookup-by-handle, no path involved.
    readBytesByHandle: (req: FsReadBytesByHandleRequest) => Promise<FsReadBytesByHandleResponse>;
  };
  recents: {
    list: (req: RecentsListRequest) => Promise<RecentsListResponse>;
    add: (req: RecentsAddRequest) => Promise<RecentsAddResponse>;
    clear: () => Promise<RecentsClearResponse>;
  };
  settings: {
    get: <K extends SettingKey>(req: SettingsGetRequest<K>) => Promise<SettingsGetResponse<K>>;
    set: <K extends SettingKey>(req: SettingsSetRequest<K>) => Promise<SettingsSetResponse>;
    getAll: () => Promise<SettingsGetAllResponse>;
  };
  bookmarks: {
    list: (req: BookmarksListRequest) => Promise<BookmarksListResponse>;
    upsert: (req: BookmarksUpsertRequest) => Promise<BookmarksUpsertResponse>;
    delete: (req: BookmarksDeleteRequest) => Promise<BookmarksDeleteResponse>;
    // Phase 2 (api-contracts.md §12.5-§12.7)
    listTree: (req: BookmarksListTreeRequest) => Promise<BookmarksListTreeResponse>;
    move: (req: BookmarksMoveRequest) => Promise<BookmarksMoveResponse>;
    rename: (req: BookmarksRenameRequest) => Promise<BookmarksRenameResponse>;
  };
  pdf: {
    combine: (req: PdfCombineRequest) => Promise<PdfCombineResponse>;
    export: (req: PdfExportRequest) => Promise<PdfExportResponse>;
    getOutline: (req: PdfGetOutlineRequest) => Promise<PdfGetOutlineResponse>;
    // Phase 2 (api-contracts.md §12.1-§12.4)
    embedImage: (req: PdfEmbedImageRequest) => Promise<PdfEmbedImageResponse>;
    replaceText: (req: PdfReplaceTextRequest) => Promise<PdfReplaceTextResponse>;
    identifyTextSpan: (req: PdfIdentifyTextSpanRequest) => Promise<PdfIdentifyTextSpanResponse>;
    print: (req: PdfPrintRequest) => Promise<PdfPrintResponse>;
  };
  app: {
    getVersion: () => Promise<AppGetVersionResponse>;
    quit: (req: AppQuitRequest) => Promise<AppQuitResponse>;
    setDefaultPdfHandler: (
      req: AppSetDefaultPdfHandlerRequest,
    ) => Promise<AppSetDefaultPdfHandlerResponse>;
    getDefaultPdfHandlerStatus: () => Promise<AppGetDefaultPdfHandlerStatusResponse>;
    openExternal: (req: AppOpenExternalRequest) => Promise<AppOpenExternalResponse>;
  };
  window: {
    minimize: () => Promise<WindowMinimizeResponse>;
    maximize: () => Promise<WindowMaximizeResponse>;
    close: () => Promise<WindowCloseResponse>;
    getState: () => Promise<WindowGetStateResponse>;
  };
  // Phase 3 (api-contracts.md §13.13)
  forms: {
    detect: (req: FormsDetectRequest) => Promise<FormsDetectResponse>;
    fill: (req: FormsFillRequest) => Promise<FormsFillResponse>;
    flatten: (req: FormsFlattenRequest) => Promise<FormsFlattenResponse>;
    designAdd: (req: FormsDesignAddRequest) => Promise<FormsDesignAddResponse>;
    designRemove: (req: FormsDesignRemoveRequest) => Promise<FormsDesignRemoveResponse>;
    listTemplates: (req: FormsListTemplatesRequest) => Promise<FormsListTemplatesResponse>;
    saveTemplate: (req: FormsSaveTemplateRequest) => Promise<FormsSaveTemplateResponse>;
    loadTemplate: (req: FormsLoadTemplateRequest) => Promise<FormsLoadTemplateResponse>;
    runMailMerge: (req: FormsRunMailMergeRequest) => Promise<FormsRunMailMergeResponse>;
    cancelMailMerge: (req: FormsCancelMailMergeRequest) => Promise<FormsCancelMailMergeResponse>;
    parseDataSource: (req: FormsParseDataSourceRequest) => Promise<FormsParseDataSourceResponse>;
  };
  // Phase 4 (api-contracts.md §14.11)
  signatures: {
    certLoad: (req: SignaturesCertLoadRequest) => Promise<SignaturesCertLoadResponse>;
    certRelease: (req: SignaturesCertReleaseRequest) => Promise<SignaturesCertReleaseResponse>;
    applyVisual: (req: SignaturesApplyVisualRequest) => Promise<SignaturesApplyVisualResponse>;
    applyPades: (req: SignaturesApplyPadesRequest) => Promise<SignaturesApplyPadesResponse>;
    requestTimestamp: (
      req: SignaturesRequestTimestampRequest,
    ) => Promise<SignaturesRequestTimestampResponse>;
    verify: (req: SignaturesVerifyRequest) => Promise<SignaturesVerifyResponse>;
    listAudit: (req: SignaturesListAuditRequest) => Promise<SignaturesListAuditResponse>;
  };
  annotations: {
    addShape: (req: AnnotationsAddShapeRequest) => Promise<AnnotationsAddShapeResponse>;
    setMeasureCalibration: (
      req: AnnotationsSetMeasureCalibrationRequest,
    ) => Promise<AnnotationsSetMeasureCalibrationResponse>;
    getMeasureCalibration: (
      req: AnnotationsGetMeasureCalibrationRequest,
    ) => Promise<AnnotationsGetMeasureCalibrationResponse>;
  };
  // Phase 5 (api-contracts.md §16.12)
  ocr: {
    detectLanguages: (req: OcrDetectLanguagesRequest) => Promise<OcrDetectLanguagesResponse>;
    runOnPage: (req: OcrRunOnPageRequest) => Promise<OcrRunOnPageResponse>;
    runOnDocument: (req: OcrRunOnDocumentRequest) => Promise<OcrRunOnDocumentResponse>;
    cancelJob: (req: OcrCancelJobRequest) => Promise<OcrCancelJobResponse>;
    listJobs: (req: OcrListJobsRequest) => Promise<OcrListJobsResponse>;
    languagePackDownload: (
      req: OcrLanguagePackDownloadRequest,
    ) => Promise<OcrLanguagePackDownloadResponse>;
    languagePackRemove: (
      req: OcrLanguagePackRemoveRequest,
    ) => Promise<OcrLanguagePackRemoveResponse>;
    onProgress: (handler: (event: OcrProgressEvent) => void) => () => void;
    onLanguagePackDownloadProgress: (
      handler: (event: OcrLanguagePackDownloadProgressEvent) => void,
    ) => () => void;
  };
  scan: {
    listDevices: (req: ScanListDevicesRequest) => Promise<ScanListDevicesResponse>;
    acquire: (req: ScanAcquireRequest) => Promise<ScanAcquireResponse>;
  };
  // Phase 6 (api-contracts.md §17.10)
  export: {
    toDocx: (req: ExportToDocxRequest) => Promise<ExportToDocxResponse>;
    toXlsx: (req: ExportToXlsxRequest) => Promise<ExportToXlsxResponse>;
    toPptx: (req: ExportToPptxRequest) => Promise<ExportToPptxResponse>;
    toImages: (req: ExportToImagesRequest) => Promise<ExportToImagesResponse>;
    cancelJob: (req: ExportCancelJobRequest) => Promise<ExportCancelJobResponse>;
    listJobs: (req: ExportListJobsRequest) => Promise<ExportListJobsResponse>;
    listFormats: (req: ExportListFormatsRequest) => Promise<ExportListFormatsResponse>;
    /** Subscribe to export:progress events. Returns unsubscribe fn. */
    onProgress: (handler: (event: ExportProgressEvent) => void) => () => void;
  };
  events: {
    onExportProgress: (handler: (evt: PdfExportProgressEvent) => void) => () => void;
    onMailMergeProgress: (handler: (evt: MailMergeProgressEvent) => void) => () => void;
  };
  // Phase 7 (api-contracts.md §18.9)
  update: {
    check: (req: UpdateCheckRequest) => Promise<UpdateCheckResponse>;
    download: (req: UpdateDownloadRequest) => Promise<UpdateDownloadResponse>;
    install: (req: UpdateInstallRequest) => Promise<UpdateInstallResponse>;
    /** Subscribe to update:onProgress events. Returns unsubscribe fn. */
    onProgress: (handler: (event: UpdateProgressEvent) => void) => () => void;
  };
  telemetry: {
    recordEvent: (req: TelemetryRecordEventRequest) => Promise<TelemetryRecordEventResponse>;
    setOptIn: (req: TelemetrySetOptInRequest) => Promise<TelemetrySetOptInResponse>;
    getStatus: (req: TelemetryGetStatusRequest) => Promise<TelemetryGetStatusResponse>;
  };
  i18n: {
    setLocale: (req: I18nSetLocaleRequest) => Promise<I18nSetLocaleResponse>;
    getAvailableLocales: (
      req: I18nGetAvailableLocalesRequest,
    ) => Promise<I18nGetAvailableLocalesResponse>;
  };
}
