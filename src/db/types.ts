// Row types and setting-key types for the SQLite layer.
//
// Mirrors the DDL in migrations/0001_init.sql 1:1. The settings registry is the
// authoritative typed map of all known setting keys (cross-referenced with
// docs/api-contracts.md §5 and docs/data-models.md §2.3).
//
// Anything imported from this module is pure data — no runtime dependencies.

// ============================================================
// Row shapes (snake_case to match SQLite columns exactly; the repo layer
// is the boundary where snake_case becomes whatever the IPC contract expects).
// ============================================================

export interface RecentFileRow {
  path: string;
  last_opened_at: number; // ms epoch
  file_hash: string; // SHA-256(first 64 KiB || size), hex lowercase
  display_name: string;
}

export interface BookmarkRow {
  id: number;
  file_hash: string;
  page_index: number;
  title: string;
  created_at: number; // ms epoch
  // Phase 2 additions — see migrations/0002_phase2_bookmarks.sql + data-models §7.3/§7.4.
  parent_id: number | null; // NULL = top-level bookmark
  sort_order: number; // lower = earlier within sibling group; ties broken by id ASC
}

/**
 * Hierarchical bookmark row — flat BookmarkRow plus `children`. Returned by
 * `BookmarksRepo.listTree`. Snake_case to match BookmarkRow; the db-bridge
 * adapter (David, Wave 7) translates to camelCase `BookmarkNode` for IPC
 * (api-contracts.md §12.5).
 */
export interface BookmarkNodeRow extends BookmarkRow {
  children: BookmarkNodeRow[];
}

export interface SchemaMigrationRow {
  version: number;
  applied_at: number; // ms epoch
}

// ============================================================
// Phase 3 — form-templates row + field-definition payload
//
// FormFieldDefinition is the canonical (JSON-encoded) shape stored in
// form_templates.fields_json. The full payload type and validation rules live
// in docs/data-models.md §8.1 + §8.8. We mirror the type here so the db layer
// can declare it without taking an import dependency on src/ipc/contracts.ts
// (David's file); the IPC contract re-exports an identical shape so the
// renderer + main + db-bridge all share one definition at the structural-type
// level (cf. Wave 7 lesson — parallel waves must keep types in sync).
// ============================================================

/** Field-type enumeration. Mirrors data-models.md §8.1 FormFieldType. */
export type FormFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'signature' | 'date';

/** Option entry for radio + dropdown fields. Mirrors data-models.md §8.1. */
export interface FormFieldOption {
  /** Export value written to /V on selection. */
  value: string;
  /** Display label shown in the UI. */
  label: string;
}

/**
 * Value payload for a single field. Discriminated by `type` so the renderer
 * gets exhaustiveness in commit / fill flows. Mirrors data-models.md §8.1
 * FormFieldValue union.
 */
export type FormFieldValue =
  | { type: 'text'; value: string }
  | { type: 'checkbox'; value: boolean }
  | { type: 'radio'; value: string /* one of options[].value */ }
  | { type: 'dropdown'; value: string }
  | { type: 'signature'; value: null /* always null in Phase 3 */ }
  | { type: 'date'; value: string /* ISO-8601 YYYY-MM-DD */ };

/**
 * Authored / detected form field. The full validation contract (name length,
 * options-required-when, page-bounds clamp) lives in data-models.md §8.8 and
 * is enforced at the IPC handler boundary by David's zod schemas. The repo
 * stores whatever well-formed JSON the bridge serializes — no semantic
 * validation here.
 */
export interface FormFieldDefinition {
  /** Unique within document. AcroForm field name. */
  name: string;
  type: FormFieldType;
  pageIndex: number;
  /** Widget rect in PDF user-space (origin bottom-left). */
  rect: { x: number; y: number; width: number; height: number };
  /** UI-visible label; defaults to `name` when no /TU entry. */
  label: string;
  /** Required-flag from AcroForm /Ff bit 2. */
  required: boolean;
  /** Optional default value populated into /DV. */
  defaultValue?: FormFieldValue;
  /** Required for radio + dropdown; forbidden otherwise. */
  options?: FormFieldOption[];
  /** Detected from source PDF vs authored this session. */
  origin: 'detected' | 'authored';
  /** True when authored this session and not yet saved. */
  unsaved: boolean;
}

/**
 * Snake_case row mirroring form_templates columns 1:1. The bridge adapter
 * (David's `src/main/db-bridge.ts`) translates to camelCase `FormTemplateRowDto`
 * and parses `fields_json` / `last_column_mappings` JSON columns at the IPC
 * boundary (data-models.md §8.5). The repo NEVER parses — that boundary lives
 * in the bridge so the repo stays purely-typed-string-or-null.
 */
export interface FormTemplateRow {
  id: number;
  name: string;
  /** JSON-encoded FormFieldDefinition[]. */
  fields_json: string;
  /** Optional source-doc file_hash; NULL for templates authored from scratch. */
  source_doc_hash: string | null;
  /** JSON-encoded Record<columnName, fieldName>; NULL until first mail-merge. */
  last_column_mappings: string | null;
  created_at: number; // ms epoch
  updated_at: number; // ms epoch
}

// ============================================================
// Phase 4 — signature audit log row (Wave 16, Ravi)
//
// Canonical reference: docs/data-models.md §9.4 + §9.5. The bridge
// (`src/main/db-bridge.ts`, David Wave 16) translates this snake_case row to
// camelCase `SignatureAuditRowDto` at the IPC boundary, parsing the
// `byte_range_json` column into a `number[]` on the DTO. The repo NEVER parses
// — it stores the JSON-encoded TEXT verbatim, same convention as
// FormTemplateRow.fields_json (Wave 12 takeaway #1).
//
// `signature_kind` discriminant:
//   * 'visual'    — typed/drawn/image signature, no cert; fingerprint/CNs NULL,
//                   sig_bytes_* + byte_range_json NULL.
//   * 'pades'     — PAdES B-B (basic) signature with cert; no TSA.
//   * 'pades-tsa' — PAdES B-T with RFC 3161 timestamp embedded.
//
// `tsa_response_status` is NULL for visual + pades (no TSA hop); 'ok' or
// 'failed' for pades-tsa rows (the engine still writes the audit row on TSA
// failure so the user can see what was attempted).
// ============================================================

/**
 * Snake_case row mirroring signature_audit_log columns 1:1. Matches
 * data-models.md §9.5 verbatim. Bridge translates to camelCase
 * SignatureAuditRowDto at the IPC boundary (data-models.md §9.5).
 */
export interface SignatureAuditRow {
  id: number;
  /** SHA-256 of the SIGNED bytes (post-signing); hex lowercase. */
  doc_hash: string;
  /** SHA-256 of the bytes the engine actually signed (byte-range hash input). */
  pre_sign_doc_hash: string;
  signed_at: number; // ms epoch
  signature_kind: 'visual' | 'pades' | 'pades-tsa';
  /** SHA-256 hex of the cert; NULL for visual. */
  signed_by_fingerprint: string | null;
  /** Subject CN for display; NULL for visual. */
  signed_by_subject_cn: string | null;
  /** Issuer CN for display; NULL for visual. */
  signed_by_issuer_cn: string | null;
  /** Cert validity start (ms epoch); NULL for visual. */
  cert_not_before: number | null;
  /** Cert validity end (ms epoch); NULL for visual. */
  cert_not_after: number | null;
  /** TSA URL used at sign time; NULL if no TSA hop attempted. */
  tsa_url: string | null;
  /** 'ok' | 'failed' | NULL — NULL for visual + pades (no-TSA). */
  tsa_response_status: 'ok' | 'failed' | null;
  /** Byte offset of /Contents in signed bytes; NULL for visual. */
  sig_bytes_offset: number | null;
  /** Byte length of /Contents; NULL for visual. */
  sig_bytes_length: number | null;
  /** JSON-encoded [a, b, c, d]; NULL for visual. Bridge parses to number[]. */
  byte_range_json: string | null;
  /** User-supplied; PDF sig dict /Reason. */
  reason: string | null;
  /** User-supplied; PDF sig dict /Location. */
  location: string | null;
  /** Placeholder field name OR NULL for freeform signatures. */
  field_name: string | null;
  created_at: number; // ms epoch
  // Phase 5 additive (data-models.md §10.10): FK on ocr_jobs.id. Nullable —
  // NULL for rows written before Phase 5 (and for any row NOT invalidated by
  // an OCR run). The signature audit panel surfaces "Invalidated by OCR (job
  // #N)" when this is non-null. The 0005 migration adds the column via ALTER
  // TABLE; pre-existing rows default to NULL on read.
  invalidated_by_ocr_job_id: number | null;
}

// ============================================================
// Phase 5 — OCR + language packs (Wave 20, Ravi)
//
// Canonical reference: docs/data-models.md §10.4 + §10.5 + §10.6 + §10.8. The
// bridge (`src/main/db-bridge.ts`, David Wave 20) translates these snake_case
// rows to camelCase DTOs at the IPC boundary:
//   * `OcrJobRow.langs` ('+'-joined string) -> `OcrJobRowDto.langs` (string[])
//   * `OcrJobRow.preprocess_json` -> `OcrJobRowDto.preprocess` (parsed object)
//   * `OcrJobRow.invalidated_signatures` (0/1) -> boolean
//   * `OcrResultRow.words_json` -> `OcrResultRowDto.words` (parsed OcrWord[])
//   * `LanguagePackRow.file_path` -> DROPPED (main-only; bytes-stay-in-main
//     boundary per data-models §10.1)
//
// The repo NEVER parses/serializes JSON — bridge owns the JSON boundary, same
// convention as form_templates.fields_json (Wave 12 takeaway #1) and
// signature_audit_log.byte_range_json (Wave 16 takeaway #1).
//
// Nullable-late-init discipline (data-models §10.6): `OcrWord.pdfRect` is null
// until the searchable-pdf-builder transforms image-space to PDF user-space.
// Consumers MUST handle null as "not yet composed", NOT as a zero rect (cf.
// Phase 4.1.1 sentinel-default lesson + phase-5-plan §"Anti-stub" note).
// ============================================================

/**
 * OCR job lifecycle status. Six-valued discriminant matching the CHECK guard
 * in 0005_phase5_ocr.sql. Mirrors data-models §10.5.
 *
 * Transitions (architecture-phase-5.md §4.6 + ocr-engine.md §7):
 *   queued    -> running (worker acquired)
 *   running   -> completed | cancelled | failed
 *   completed -> superseded_by_undo (when the user undoes the corresponding
 *                EditOperation; data-models §10.3.1)
 */
export type OcrJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'superseded_by_undo';

/**
 * Snake_case row mirroring ocr_jobs columns 1:1. Matches data-models.md §10.5
 * verbatim. The bridge translates to camelCase `OcrJobRowDto` at the IPC
 * boundary (data-models.md §10.5).
 */
export interface OcrJobRow {
  id: number;
  doc_hash: string;
  page_range_start: number;
  page_range_end: number;
  /** '+'-joined Tesseract lang codes, normalized lowercase ('eng', 'eng+spa'). */
  langs: string;
  /** JSON-encoded PreprocessOptions; repo stores verbatim, bridge parses. */
  preprocess_json: string;
  status: OcrJobStatus;
  started_at: number; // ms epoch
  /** NULL until terminal status. */
  completed_at: number | null;
  /** REAL 0..100; NULL until completed. */
  mean_confidence: number | null;
  /** NULL until completed. */
  total_words: number | null;
  /** Non-null only when status='failed'. */
  error_message: string | null;
  /** 0/1; 1 when a PAdES widget was present pre-run (phase-5 §6). */
  invalidated_signatures: 0 | 1;
  created_at: number; // ms epoch
}

/**
 * Snake_case row mirroring ocr_results columns 1:1. Matches data-models.md
 * §10.6 verbatim. Per-page result for a completed OCR job. The bridge parses
 * `words_json` into `OcrWord[]` at the IPC boundary.
 *
 * UNIQUE(job_id, page_index) at the DDL level — one row per (job, page).
 */
export interface OcrResultRow {
  id: number;
  /** FK to ocr_jobs.id; ON DELETE CASCADE clears results when the job is removed. */
  job_id: number;
  page_index: number;
  total_words: number;
  low_confidence_words: number;
  /** REAL 0..100; arithmetic mean across words on this page. */
  mean_confidence: number;
  /**
   * JSON-encoded `OcrWord[]`. Per-word data:
   *   `{ text, confidence, imgRect: {x0,y0,x1,y1}, pdfRect: PdfRect | null }`.
   * Bridge parses; repo stores verbatim. `pdfRect` is nullable late-init
   * (data-models §10.6) — null until the searchable-pdf-builder composes it.
   */
  words_json: string;
  img_width_px: number;
  img_height_px: number;
  duration_ms: number;
  created_at: number; // ms epoch
}

/**
 * OCR language-pack source. 'bundled' ships with the app; 'downloaded' is
 * lazy-pulled from upstream after first-use. Mirrors data-models §10.1.
 */
export type OcrLanguagePackSource = 'bundled' | 'downloaded';

// ============================================================
// Phase 6 — Export to Office / image formats (Wave 24, Ravi)
//
// Canonical reference: docs/data-models.md §11 + §11.2 + §11.7. The bridge
// (`src/main/db-bridge.ts`, David Wave 24) translates this snake_case row to
// the camelCase `ExportJobRowDto` at the IPC boundary, mapping:
//   * `include_annotations` (0/1)     -> boolean
//   * `multi_page_tiff` (0/1 | null)  -> boolean | null
//   * `output_path` (absolute)        -> DROPPED; replaced by `outputBasename`
//                                        + `outputDirHint` per conventions §17.2
//                                        bytes-stay-in-main / paths-stay-in-main
//                                        boundary discipline
//   * image-options nesting           -> bridge nests dpi/jpegQuality/multiPageTiff
//                                        into `imageOptions` (or null for office)
//   * office-stats nesting            -> bridge nests paragraphs_extracted /
//                                        tables_detected / images_embedded into
//                                        `contentStats` (or null pre-terminal)
//
// Anti-sentinel discipline (data-models §11.5; Phase 4.1.1 + Phase 5 reaffirmed):
// every "not yet known" column is NULLABLE — repo + bridge surface `null`,
// NEVER a sentinel `0` / `-1` / `''`. See conventions §17.4.2.
//
// NO foreign keys (data-models §11.8) — export is independent of edit history.
// `doc_hash` is a soft reference; exports survive deletion of the doc's
// bookmarks / OCR / signature audit rows.
//
// Phase 6 introduces NO new EditOperation variant (data-models §11.4) —
// export does not produce an edit; the `EditOperation` union is frozen by
// Phase 6.
// ============================================================

/**
 * Export-job lifecycle status. Five-valued discriminant matching the CHECK
 * guard in 0006_phase6_export.sql. Mirrors data-models §11.2 + §11.7.
 *
 * Transitions (architecture-phase-6.md §4.5 + export-engine.md §8):
 *   queued    -> running (worker dequeues)
 *   running   -> completed | cancelled | failed
 *
 * No 'superseded_by_undo' value — export is read-only on source, conventions
 * §17.1.
 */
export type ExportJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

/** Output format. Six-valued; matches CHECK guard. Mirrors data-models §11.2. */
export type ExportFormat = 'docx' | 'xlsx' | 'pptx' | 'png' | 'jpeg' | 'tiff';

/**
 * Quality tier. `'n/a'` is the valid value for image formats (PNG / JPEG /
 * TIFF do not have a quality tier); office formats are always `'text-only'`
 * or `'layout-preserving'`. Mirrors data-models §11.2.
 */
export type ExportQualityTier = 'text-only' | 'layout-preserving' | 'n/a';

/**
 * Snake_case row mirroring export_jobs columns 1:1. Matches data-models.md
 * §11.2 + §11.7 verbatim. The bridge translates to camelCase
 * `ExportJobRowDto` at the IPC boundary (data-models.md §11.5).
 */
export interface ExportJobRow {
  id: number;
  doc_hash: string;
  format: ExportFormat;
  quality_tier: ExportQualityTier;
  page_range_start: number;
  page_range_end: number;
  /** 0/1; bridge converts to boolean. */
  include_annotations: 0 | 1;
  /** Non-null only for image formats (png / jpeg / tiff). */
  dpi: number | null;
  /** Non-null only when format='jpeg'. Range [0.1, 1.0] enforced at IPC. */
  jpeg_quality: number | null;
  /** 0/1; non-null only when format='tiff'. */
  multi_page_tiff: 0 | 1 | null;
  /**
   * Absolute path on disk. MAIN-ONLY — the bridge strips this from the
   * renderer-facing DTO per conventions §17.2 (paths-stay-in-main).
   * Treat as a main-process value; do not echo across IPC.
   */
  output_path: string;
  /** NULL until terminal status. */
  output_size_bytes: number | null;
  status: ExportJobStatus;
  started_at: number; // ms epoch
  /** NULL until terminal status. */
  completed_at: number | null;
  /** NULL until terminal status; = completed_at - started_at when set. */
  duration_ms: number | null;
  /** Bumped as each page completes; drives progress UI. */
  pages_processed: number;
  /** NULL for image formats AND until done. */
  paragraphs_extracted: number | null;
  /** NULL for image formats AND until done. */
  tables_detected: number | null;
  /** NULL for image formats AND until done. */
  images_embedded: number | null;
  /** Non-null only when status='failed'. Max 2048 chars at IPC boundary. */
  error_message: string | null;
  created_at: number; // ms epoch
}

/**
 * Snake_case row mirroring language_packs columns 1:1. Matches data-models.md
 * §10.8 verbatim.
 *
 * `file_path` is MAIN-ONLY — the bridge strips it from the renderer-facing
 * `LanguagePackDto` (data-models §10.1 + §10.8 boundary discipline). Treat
 * this row as a main-process value; do not export it across IPC.
 */
export interface LanguagePackRow {
  /** Tesseract lang code (ISO 639-2/3, optionally with a variant suffix). */
  lang: string;
  source: OcrLanguagePackSource;
  /** Absolute path; main-only. NEVER export across IPC. */
  file_path: string;
  size_bytes: number;
  /** 64-hex pack hash; verified at download + at every load. */
  sha256: string;
  installed_at: number; // ms epoch
  /** NULL if never used; updated by touchLastUsed(). */
  last_used_at: number | null;
}

// ============================================================
// Settings registry (mirrors docs/api-contracts.md §5)
//
// SettingKey is the union of every legal key; SettingValue<K> is the strongly-typed
// value shape for that key. The repo serializes via JSON.stringify on write and
// parses on read — the caller gets a typed value, never the raw TEXT.
// ============================================================

export type SettingKey =
  // Phase 1
  | 'recents.maxItems'
  | 'open.maxFileSizeMB'
  | 'export.defaultEngine'
  | 'export.showWarningsToast'
  | 'file_association.pdf.requested'
  | 'theme'
  | 'undo.maxHistory'
  // Phase 2 (data-models.md §7.6 + api-contracts.md §12.9)
  | 'export.deterministic'
  | 'export.includeBookmarksInOutline'
  | 'editing.confirmDelete'
  | 'editing.commitTextOnBlur'
  // Phase 3 (data-models.md §8.7) — added pre-emptively so the db layer
  // doesn't lag David's IPC contract additions in this same wave
  // (cf. Wave 7 takeaway #3 in .learnings/learnings.jsonl).
  | 'forms.dateLocale'
  | 'forms.flattenOnExportDefault'
  | 'mailMerge.lastOutputFolder'
  | 'mailMerge.defaultOutputMode'
  // Phase 4 (data-models.md §9.9) — pre-emptive parity with David's Wave 16
  // IPC contract additions. Same rationale as the Phase-3 batch above
  // (Wave 7 + Wave 12 takeaway #3): SettingsRepo structural typing fails
  // if src/db/types.ts lags src/ipc/contracts.ts.
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
  // Phase 5 (data-models.md §10.11) — pre-emptive parity with David's Wave 20
  // IPC contract additions. Same rationale as the Phase-3 + Phase-4 batches
  // (Wave 7 + Wave 12 + Wave 16 takeaway #3): SettingsRepo structural typing
  // fails if src/db/types.ts lags src/ipc/contracts.ts.
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
  // Phase 6 (data-models.md §11.6) — pre-emptive parity with David's Wave 24
  // IPC contract additions. Same rationale as the Phase-3/4/5 batches
  // (Wave 7 + 12 + 16 + 20 takeaway #3): SettingsRepo structural typing
  // fails if src/db/types.ts lags src/ipc/contracts.ts.
  | 'export.docx.qualityTier'
  | 'export.docx.pageSize'
  | 'export.docx.includeAnnotations'
  | 'export.xlsx.qualityTier'
  | 'export.xlsx.includeAnnotations'
  | 'export.pptx.qualityTier'
  | 'export.pptx.includeAnnotations'
  | 'export.image.format'
  | 'export.image.dpi'
  | 'export.image.jpegQuality'
  | 'export.image.multiPageTiff'
  | 'export.image.includeAnnotations'
  | 'export.layout.lineEpsilonPt'
  | 'export.layout.paragraphBreakRatio'
  | 'export.layout.headingRatio'
  | 'export.layout.columnGapPt'
  | 'export.maxQueueSize'
  // Phase 7 (data-models.md §12.2 + §12.3) — telemetry / i18n / auto-update.
  // Co-owned with David's src/ipc/contracts.ts SettingKey union (zero-drift
  // discipline from the Wave 7 lesson): both files MUST carry the SAME four
  // members so SettingsRepo structural typing converges. Pre-emptive parity —
  // landing the db-side in this wave unblocks David's `settings.get(...)`
  // typecheck whichever of us merges first (Wave 7/12/16/20/24 takeaway #3).
  | 'telemetry.optIn'
  | 'i18n.locale'
  | 'update.channel'
  | 'update.lastCheckedAt';

export type ExportEnginePreference = 'auto' | 'pdf-lib' | 'chromium';
export type ThemePreference = 'system' | 'light' | 'dark';
export type FormDateLocale = 'system' | 'en-US' | 'en-GB' | 'ISO';
export type MailMergeOutputMode = 'folder' | 'concat';
// Phase 4 (data-models.md §9.9).
export type PadesEngine = 'signpdf' | 'manual';
export type AnnotationBorderStyle = 'solid' | 'dashed' | 'dotted';
export type AnnotationLineEndStyle = 'None' | 'OpenArrow' | 'ClosedArrow';
// Phase 6 (data-models.md §11.6).
export type ExportOfficeQualityTier = 'text-only' | 'layout-preserving';
export type ExportDocxPageSize = 'letter' | 'a4' | 'auto';
export type ExportImageFormatPref = 'png' | 'jpeg' | 'tiff';
// Phase 7 (data-models.md §12.2). `'es-ES'` is the proof locale (sample);
// `supportedLngs` is the runtime allowlist enforced by David's IPC zod
// schema (data-models §12.8). `update.channel` is the auto-update trigger
// policy; `'manual'` (default) = explicit check only, `'check-on-launch'` =
// opt-in single check on launch.
export type AppLocale = 'en-US' | 'es-ES';
export type UpdateChannel = 'manual' | 'check-on-launch';

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
                      : K extends 'forms.dateLocale'
                        ? FormDateLocale
                        : K extends 'forms.flattenOnExportDefault'
                          ? boolean
                          : K extends 'mailMerge.lastOutputFolder'
                            ? string
                            : K extends 'mailMerge.defaultOutputMode'
                              ? MailMergeOutputMode
                              : // Phase 4 (data-models.md §9.9)
                                K extends 'signatures.tsaUrl'
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
                                            ? PadesEngine
                                            : K extends 'annotations.defaultBorderWidth'
                                              ? number
                                              : K extends 'annotations.defaultBorderStyle'
                                                ? AnnotationBorderStyle
                                                : K extends 'annotations.defaultFillEnabled'
                                                  ? boolean
                                                  : K extends 'annotations.defaultLineEndStyle'
                                                    ? AnnotationLineEndStyle
                                                    : // Phase 5 (data-models.md §10.11)
                                                      K extends 'ocr.defaultLang'
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
                                                                          : // Phase 6 (data-models.md §11.6)
                                                                            K extends 'export.docx.qualityTier'
                                                                            ? ExportOfficeQualityTier
                                                                            : K extends 'export.docx.pageSize'
                                                                              ? ExportDocxPageSize
                                                                              : K extends 'export.docx.includeAnnotations'
                                                                                ? boolean
                                                                                : K extends 'export.xlsx.qualityTier'
                                                                                  ? ExportOfficeQualityTier
                                                                                  : K extends 'export.xlsx.includeAnnotations'
                                                                                    ? boolean
                                                                                    : K extends 'export.pptx.qualityTier'
                                                                                      ? ExportOfficeQualityTier
                                                                                      : K extends 'export.pptx.includeAnnotations'
                                                                                        ? boolean
                                                                                        : K extends 'export.image.format'
                                                                                          ? ExportImageFormatPref
                                                                                          : K extends 'export.image.dpi'
                                                                                            ? number
                                                                                            : K extends 'export.image.jpegQuality'
                                                                                              ? number
                                                                                              : K extends 'export.image.multiPageTiff'
                                                                                                ? boolean
                                                                                                : K extends 'export.image.includeAnnotations'
                                                                                                  ? boolean
                                                                                                  : K extends 'export.layout.lineEpsilonPt'
                                                                                                    ? number
                                                                                                    : K extends 'export.layout.paragraphBreakRatio'
                                                                                                      ? number
                                                                                                      : K extends 'export.layout.headingRatio'
                                                                                                        ? number
                                                                                                        : K extends 'export.layout.columnGapPt'
                                                                                                          ? number
                                                                                                          : K extends 'export.maxQueueSize'
                                                                                                            ? number
                                                                                                            : // Phase 7 (data-models.md §12.2)
                                                                                                              K extends 'telemetry.optIn'
                                                                                                              ? boolean
                                                                                                              : K extends 'i18n.locale'
                                                                                                                ? AppLocale
                                                                                                                : K extends 'update.channel'
                                                                                                                  ? UpdateChannel
                                                                                                                  : K extends 'update.lastCheckedAt'
                                                                                                                    ? // null until the first check ever runs (anti-sentinel,
                                                                                                                        // data-models §12.2). NEVER 0 for "never".
                                                                                                                        | number
                                                                                                                        | null
                                                                                                                    : never;

/** Runtime list of valid keys — used by repo to reject unknown keys cheaply. */
export const KNOWN_SETTING_KEYS: readonly SettingKey[] = [
  'recents.maxItems',
  'open.maxFileSizeMB',
  'export.defaultEngine',
  'export.showWarningsToast',
  'file_association.pdf.requested',
  'theme',
  'undo.maxHistory',
  // Phase 2
  'export.deterministic',
  'export.includeBookmarksInOutline',
  'editing.confirmDelete',
  'editing.commitTextOnBlur',
  // Phase 3
  'forms.dateLocale',
  'forms.flattenOnExportDefault',
  'mailMerge.lastOutputFolder',
  'mailMerge.defaultOutputMode',
  // Phase 4
  'signatures.tsaUrl',
  'signatures.tsaEnabled',
  'signatures.tsaTimeoutMs',
  'signatures.placeholderSize',
  'signatures.defaultShowDate',
  'signatures.defaultShowSubjectCN',
  'signatures.padesEngine',
  'annotations.defaultBorderWidth',
  'annotations.defaultBorderStyle',
  'annotations.defaultFillEnabled',
  'annotations.defaultLineEndStyle',
  // Phase 5
  'ocr.defaultLang',
  'ocr.lowConfidenceThreshold',
  'ocr.rasterDpi',
  'ocr.maxConcurrentLanguages',
  'ocr.workerWatchdogSec',
  'ocr.preprocess.deskew',
  'ocr.preprocess.denoise',
  'ocr.preprocess.contrastBoost',
  'ocr.denoise.kernel',
  'ocr.showConfidenceOverlayByDefault',
  'ocr.confirmInvalidateSignaturesOnce',
  // Phase 6
  'export.docx.qualityTier',
  'export.docx.pageSize',
  'export.docx.includeAnnotations',
  'export.xlsx.qualityTier',
  'export.xlsx.includeAnnotations',
  'export.pptx.qualityTier',
  'export.pptx.includeAnnotations',
  'export.image.format',
  'export.image.dpi',
  'export.image.jpegQuality',
  'export.image.multiPageTiff',
  'export.image.includeAnnotations',
  'export.layout.lineEpsilonPt',
  'export.layout.paragraphBreakRatio',
  'export.layout.headingRatio',
  'export.layout.columnGapPt',
  'export.maxQueueSize',
  // Phase 7
  'telemetry.optIn',
  'i18n.locale',
  'update.channel',
  'update.lastCheckedAt',
] as const;

export function isKnownSettingKey(key: string): key is SettingKey {
  return (KNOWN_SETTING_KEYS as readonly string[]).includes(key);
}
