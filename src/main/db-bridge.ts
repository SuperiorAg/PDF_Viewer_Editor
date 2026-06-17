// DB bridge — gives David's IPC handlers a stable interface to Ravi's repositories.
//
// Originally introduced in Wave 2 (parallel dispatch — Ravi's repos at
// `src/db/repositories/*` may not have existed yet when David's handlers
// compiled). Now (post-Phase 7) Ravi's repos ARE present and the bridge is
// wired via `setDbBridge({ recents: adaptRecentsRepo(...), ... })` in
// `src/main/index.ts` Step 3.5. The memory-backed default (`createMemoryDbBridge`)
// stays in place as the test/fallback path — see `db-bridge.ts` getters and
// the per-Phase optional-import shape in `src/main/index.ts`.
//
// Repo interfaces mirror `docs/data-models.md §4` 1:1.

import type { StampsLibraryRow } from '../db/types.js';
import type {
  BookmarkRow,
  BookmarkNode,
  FileHash,
  FormFieldDefinition,
  // Phase 5.2 (Marcus, 2026-06-04): bridge now exposes parsed per-page OCR
  // results so the renderer can hydrate the confidence overlay on reopen.
  OcrPageResult,
  OcrWord,
  PdfRect,
  RecentsListItem,
  SettingKey,
  SettingValue,
  // Phase 7.5 Wave 3 (David, 2026-06-17): stamps_library DTO.
  StampLibraryEntry,
} from '../ipc/contracts.js';
// Phase 7.5 Wave 3 (David, 2026-06-17): re-export the StampsLibraryRepoBridge
// shape from the handler (so handler-internal and db-bridge consumers share
// the same interface) and import Ravi's snake_case row type for the adapter.
import type { StampsLibraryRepoBridge } from '../ipc/handlers/stamps-handlers.js';
export type { StampsLibraryRepoBridge };

// ============================================================================
// Repository interfaces (mirrors docs/data-models.md §4)
// ============================================================================

export interface RecentsRepo {
  list(limit: number): RecentsListItem[];
  upsert(row: {
    path: string;
    displayName: string;
    fileHash: FileHash;
    lastOpenedAt?: number;
  }): void;
  clear(): number;
}

export interface SettingsRepo {
  get<K extends SettingKey>(key: K): SettingValue<K> | null;
  set<K extends SettingKey>(key: K, value: SettingValue<K>): void;
  getAll(): Partial<{ [K in SettingKey]: SettingValue<K> }>;
}

/**
 * Wave 8.5 (H-1, data-models.md §7.5 amendment): the bridge's `move()`
 * preserves the discriminated union Ravi's repo returns. The original
 * Wave 7 shape was `boolean`, which collapsed three distinct outcomes
 * (`not_found`, `cycle_detected`, `invalid_parent`) into a single `false`
 * and forced the handler to heuristically reconstruct the variant from
 * the request shape (mis-classifying every legitimate `not_found` with a
 * non-null parent as `cycle_detected`, and rendering `invalid_parent`
 * permanently unreachable). The union now flows end-to-end repo → bridge
 * → handler → IPC contract.
 *
 * Defined here (not imported from `src/db/repositories/bookmarks-repo.ts`)
 * because the bridge is the canonical David-owned boundary for the IPC
 * contract; importing from src/db would couple the handler's compile path
 * to a file in Ravi's directory. The two definitions are structurally
 * identical, and `adaptBookmarksRepo` widens Ravi's identical-shape return
 * value through a runtime pass-through.
 */
export type MoveBookmarkResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'cycle_detected' | 'invalid_parent' };

export interface BookmarksRepo {
  listByFile(fileHash: FileHash): BookmarkRow[];
  upsert(row: {
    id?: number;
    fileHash: FileHash;
    pageIndex: number;
    title: string;
    createdAt?: number;
    // Phase 2 (data-models.md §7.5)
    parentId?: number | null;
    sortOrder?: number;
  }): number;
  delete(id: number): boolean;
  // Phase 2 (api-contracts.md §12.5-§12.7, data-models.md §7.5)
  listTree(fileHash: FileHash): BookmarkNode[];
  move(id: number, newParentId: number | null, newSortOrder: number): MoveBookmarkResult;
  rename(id: number, title: string): boolean;
}

// ============================================================================
// Phase 3 (data-models.md §8.6): form_templates repo
//
// Ravi owns the SQLite implementation in src/db/repositories/form-templates-repo.ts.
// David's adapter (below) translates between her snake_case row + JSON-string
// columns and the camelCase + parsed-object DTO the IPC handlers consume.
//
// The bridge exposes a SaveTemplate discriminated-union result (mirroring the
// MoveBookmarkResult pattern from Wave 8.5 H-1) so the 'name_in_use' constraint
// violation flows through verbatim instead of being collapsed to a boolean.
// ============================================================================

export type SaveFormTemplateResult =
  | { ok: true; id: number }
  | { ok: false; error: 'name_in_use' | 'invalid_payload' };

export interface FormTemplateDto {
  id: number;
  name: string;
  fields: FormFieldDefinition[];
  sourceDocHash: string | null;
  lastColumnMappings: Record<string, string> | null;
  createdAt: number;
  updatedAt: number;
}

export interface FormTemplateListItemBridge {
  id: number;
  name: string;
  fieldCount: number;
  sourceDocHash: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FormTemplatesRepo {
  list(): FormTemplateListItemBridge[];
  get(id: number): FormTemplateDto | null;
  save(input: {
    name: string;
    fields: FormFieldDefinition[];
    sourceDocHash?: string | null;
    columnMappings?: Record<string, string> | null;
  }): SaveFormTemplateResult;
  delete(id: number): boolean;
  updateColumnMappings(id: number, mappings: Record<string, string>): boolean;
}

// ============================================================================
// Phase 4 (data-models.md §9.5 + §9.6): signature_audit_log repo + DTO
//
// Ravi owns `src/db/repositories/signature-audit-repo.ts` (Wave 16 parallel).
// David's adapter (adaptSignatureAuditRepo, below) translates Ravi's
// snake_case rows ↔ camelCase DTOs + parses byte_range_json at the IPC
// boundary. Mirrors the adaptFormTemplatesRepo pattern (Phase 3).
// ============================================================================

export interface SignatureAuditRowDto {
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
  // Phase 5 (data-models §10.10) cross-link to ocr_jobs. Null until an OCR
  // run on the corresponding doc invalidated this signature. Diego added
  // this projection 2026-06-10 (Phase 7.2 7.2.4) so the `__test:listSignatureAudit`
  // channel can carry the column through for e2e assertions; the column has
  // been on Ravi's SELECTs since Wave 16 / Phase 5.
  invalidatedByOcrJobId: number | null;
  // Phase 7.4 B1 (Riley design §5.3, David 2026-06-15) — ms-epoch when a
  // redaction operation invalidated this signature. Null until a redaction
  // Apply marks the row. Migration 0008_phase7.4_redaction_audit.sql adds
  // the column. Defaults to null per the anti-sentinel discipline.
  invalidatedByRedactionAt: number | null;
}

export interface SignatureAuditInsertInput {
  doc_hash: string;
  pre_sign_doc_hash: string;
  signed_at: number;
  signature_kind: 'visual' | 'pades' | 'pades-tsa';
  signed_by_fingerprint: string | null;
  signed_by_subject_cn: string | null;
  signed_by_issuer_cn: string | null;
  cert_not_before: number | null;
  cert_not_after: number | null;
  tsa_url: string | null;
  tsa_response_status: 'ok' | 'failed' | null;
  sig_bytes_offset: number | null;
  sig_bytes_length: number | null;
  byte_range_json: string | null;
  reason: string | null;
  location: string | null;
  field_name: string | null;
}

export interface SignatureAuditListFilters {
  fileHash?: string;
  signedByFingerprint?: string;
  since?: number;
  until?: number;
}

export interface SignatureAuditRepoBridge {
  insert(row: SignatureAuditInsertInput): number;
  get(id: number): SignatureAuditRowDto | null;
  listByDocHash(docHash: string, limit?: number, offset?: number): SignatureAuditRowDto[];
  listAll(
    filters: SignatureAuditListFilters,
    limit: number,
    offset: number,
  ): { items: SignatureAuditRowDto[]; total: number };
  delete(id: number): boolean;
  /**
   * Phase 5 (data-models.md §10.10): back-reference the OCR job that
   * invalidated a signature. Mirrors Ravi's `markInvalidatedByOcrJob` on
   * the signature-audit repo. Null-tolerant — older bridges without
   * the method behave as no-op (returns 0 rows updated).
   *
   * Phase 7.2 (David, 2026-06-10) — non-optional; both the memory repo and
   * `adaptSignatureAuditRepo` implement it. Earlier Phase-5 optionality was
   * a parallel-wave-skew defence that's no longer needed (Ravi's Wave 16
   * repo + the bridge adapter both ship the method).
   */
  markInvalidatedByOcrJob(docHash: string, fieldNames: string[], ocrJobId: number): number;

  /**
   * Phase 7.4 B1 (Riley design §5.3, David 2026-06-15) — back-reference the
   * redaction Apply that invalidated a signature. Mirrors the OCR-back-ref
   * method above; the timestamp is stamped INSIDE Ravi's SQL via
   * `unixepoch() * 1000` (no separate `redaction_jobs` table — redaction is
   * synchronous within one round-trip, per Riley §5.3 rationale). Returns
   * rows updated.
   *
   * SIGNATURE matches Ravi's repo method exactly — `(docHash, fieldNames):
   * number` (src/db/repositories/signature-audit-repo.ts:228). Differs from
   * the OCR back-ref by NOT exposing the timestamp at the bridge layer
   * (Ravi's design — handler doesn't synthesize one; the SQL `unixepoch() *
   * 1000` is the single source of truth).
   *
   * Memory-bridge equivalent at `MemorySignatureAuditRepo.markInvalidatedByRedaction`
   * — stamps `invalidatedByRedactionAt = Date.now()` on matched rows so unit
   * tests can exercise the back-ref against the in-memory bridge.
   */
  markInvalidatedByRedaction(docHash: string, fieldNames: string[]): number;
}

export interface DbBridge {
  recents: RecentsRepo;
  settings: SettingsRepo;
  bookmarks: BookmarksRepo;
  /** Phase 3 (data-models.md §8.6). Memory-backed by default; adaptFormTemplatesRepo
   *  wraps Ravi's SQLite repo when the production bridge is wired. */
  formTemplates: FormTemplatesRepo;
  /** Phase 4 (data-models.md §9). Null when Ravi's Wave 16 repo hasn't shipped yet. */
  signatureAudit: SignatureAuditRepoBridge | null;
  /** Phase 5 (data-models.md §10.5). Null until Ravi's Wave 20 repo ships. */
  ocrJobs: OcrJobsRepoBridge | null;
  /** Phase 5 (data-models.md §10.6). Null until Ravi's Wave 20 repo ships. */
  ocrResults: OcrResultsRepoBridge | null;
  /** Phase 5 (data-models.md §10.8). Null until Ravi's Wave 20 repo ships. */
  languagePacks: LanguagePacksRepoBridge | null;
  /** Phase 6 (data-models.md §11). Null until Ravi's Wave 24 repo ships. */
  exportJobs: ExportJobsRepoBridge | null;
  /**
   * Phase 7.5 Wave 3 (David, 2026-06-17) — stamps_library bridge for B7.
   * Memory-backed by default; production wiring is in `src/main/index.ts`
   * (`adaptStampsLibraryRepo(createStampsLibraryRepo(db))`). Null state never
   * happens at runtime — the memory bridge always exists — but the slot
   * stays optional so future "kinds" introspection can mark it 'memory' vs
   * 'sqlite' the same way Phase 5/6 do.
   */
  stampsLibrary: StampsLibraryRepoBridge;
}

// ============================================================================
// Phase 6 (data-models.md §11.7): bridge contract for the export_jobs repo.
// Mirrors the OCR-jobs-repo pattern but with Phase 6's discriminated columns
// (dpi / jpeg_quality / multi_page_tiff are NULLABLE per anti-sentinel
// discipline) and the new `quality_tier: 'n/a'` enum value for image formats.
// Ravi's Wave-24 SQLite implementation lives in
// `src/db/repositories/export-jobs-repo.ts`.
// ============================================================================

export type ExportJobBridgeStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export type ExportFormatBridge = 'docx' | 'xlsx' | 'pptx' | 'png' | 'jpeg' | 'tiff';

export interface ExportJobsRepoBridge {
  insert(row: {
    doc_hash: string;
    format: ExportFormatBridge;
    quality_tier: 'text-only' | 'layout-preserving' | 'n/a';
    page_range_start: number;
    page_range_end: number;
    include_annotations: 0 | 1;
    dpi: number | null;
    jpeg_quality: number | null;
    multi_page_tiff: 0 | 1 | null;
    output_path: string;
    status: 'queued';
    started_at: number;
  }): number;
  updateStatus(
    id: number,
    update: {
      status: 'running' | 'completed' | 'cancelled' | 'failed';
      completed_at?: number;
      duration_ms?: number;
      error_message?: string;
    },
  ): boolean;
  updateProgress(
    id: number,
    pagesProcessed: number,
    extras?: {
      paragraphsExtracted?: number;
      tablesDetected?: number;
      imagesEmbedded?: number;
      outputSizeBytes?: number;
    },
  ): boolean;
  get(id: number): unknown;
  listAll(
    filters: {
      docHash?: string;
      format?: ExportFormatBridge;
      status?: ExportJobBridgeStatus;
      since?: number;
      until?: number;
    },
    limit: number,
    offset: number,
  ): { items: unknown[]; total: number };
  delete(id: number): boolean;
}

// ============================================================================
// Phase 5 (data-models.md §10.5-§10.9): bridge contracts for the three new
// OCR repos. Ravi's Wave-20 SQLite implementations live in
// src/db/repositories/{ocr-jobs-repo,ocr-results-repo,language-packs-repo}.ts.
// The adapters (adaptOcrJobsRepo / adaptOcrResultsRepo / adaptLanguagePacksRepo)
// translate snake_case rows + JSON-string columns ↔ camelCase + parsed DTOs
// AND extend the signatureAudit bridge with the Phase 5 invalidation back-ref
// method (markInvalidatedByOcrJob).
// ============================================================================

export type OcrJobBridgeStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'superseded_by_undo';

export interface OcrJobRowDto {
  id: number;
  docHash: string;
  pageRangeStart: number;
  pageRangeEnd: number;
  langs: string;
  preprocessJson: string;
  status: OcrJobBridgeStatus;
  startedAt: number;
  completedAt: number | null;
  meanConfidence: number | null;
  totalWords: number | null;
  errorMessage: string | null;
  invalidatedSignatures: boolean;
  createdAt: number;
}

export interface OcrJobsRepoBridge {
  insert(row: {
    doc_hash: string;
    page_range_start: number;
    page_range_end: number;
    langs: string;
    preprocess_json: string;
    status: OcrJobBridgeStatus;
    started_at: number;
    invalidated_signatures: 0 | 1;
  }): number;
  updateStatus(
    id: number,
    update: {
      status: 'completed' | 'cancelled' | 'failed';
      completed_at?: number;
      mean_confidence?: number;
      total_words?: number;
      error_message?: string;
    },
  ): boolean;
  get(id: number): OcrJobRowDto | null;
  listAll(
    filters: {
      docHash?: string;
      status?: OcrJobBridgeStatus;
      since?: number;
      until?: number;
    },
    limit: number,
    offset: number,
  ): { items: OcrJobRowDto[]; total: number };
  delete(id: number): boolean;
}

export interface OcrResultRowDto {
  id: number;
  jobId: number;
  pageIndex: number;
  totalWords: number;
  lowConfidenceWords: number;
  meanConfidence: number;
  wordsJson: string;
  imgWidthPx: number;
  imgHeightPx: number;
  durationMs: number;
  createdAt: number;
}

export interface OcrResultsRepoBridge {
  insert(row: {
    job_id: number;
    page_index: number;
    total_words: number;
    low_confidence_words: number;
    mean_confidence: number;
    words_json: string;
    img_width_px: number;
    img_height_px: number;
    duration_ms: number;
  }): number;
  listByJobId(jobId: number): OcrResultRowDto[];
  /**
   * Phase 5.2 (Marcus, 2026-06-04): parsed-and-camelCased per-page result list.
   *
   * Reads each ocr_results row for the job, parses `words_json` into
   * `OcrWord[]`, and assembles `OcrPageResult[]` (sorted page_index ASC). The
   * bridge is the canonical JSON parse layer per the repo's "never parses" rule
   * (see ocr-results-repo.ts:6-13 + data-models §10.6).
   *
   * Behavior on malformed `words_json`:
   *   - Best-effort per-row recovery: rows that fail JSON.parse are SKIPPED
   *     (logged via console.warn). The rest are returned. This mirrors the
   *     `safeParsePreprocess` pattern in `ocr-list-jobs.ts:52` — never let one
   *     corrupt blob deny the user the rest of the document's OCR overlay.
   *   - The `'results_parse_failed'` IPC error is reserved for catastrophic
   *     bridge failures (e.g. the table itself is unreadable); per-row JSON
   *     decode failures degrade to a partial result.
   */
  listPageResultsByJobId(jobId: number): OcrPageResult[];
}

export interface LanguagePackRowDto {
  lang: string;
  source: 'bundled' | 'downloaded';
  filePath: string;
  sizeBytes: number;
  sha256: string;
  installedAt: number;
  lastUsedAt: number | null;
}

export interface LanguagePacksRepoBridge {
  upsert(row: {
    lang: string;
    source: 'bundled' | 'downloaded';
    file_path: string;
    size_bytes: number;
    sha256: string;
    installed_at: number;
    last_used_at: number | null;
  }): void;
  list(): LanguagePackRowDto[];
  get(lang: string): LanguagePackRowDto | null;
  remove(lang: string): boolean;
  touchLastUsed(lang: string, when: number): void;
}

// ============================================================================
// Memory-backed fallback (used in tests and until Ravi's repos are wired)
// ============================================================================

class MemoryRecentsRepo implements RecentsRepo {
  private readonly rows = new Map<string, RecentsListItem>();

  list(limit: number): RecentsListItem[] {
    return Array.from(this.rows.values())
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, Math.max(0, limit));
  }

  upsert(row: {
    path: string;
    displayName: string;
    fileHash: FileHash;
    lastOpenedAt?: number;
  }): void {
    this.rows.set(row.path, {
      path: row.path,
      displayName: row.displayName,
      fileHash: row.fileHash,
      lastOpenedAt: row.lastOpenedAt ?? Date.now(),
      fileStillExists: true,
    });
  }

  clear(): number {
    const n = this.rows.size;
    this.rows.clear();
    return n;
  }
}

class MemorySettingsRepo implements SettingsRepo {
  private readonly map = new Map<SettingKey, unknown>();

  get<K extends SettingKey>(key: K): SettingValue<K> | null {
    if (!this.map.has(key)) return null;
    return this.map.get(key) as SettingValue<K>;
  }

  set<K extends SettingKey>(key: K, value: SettingValue<K>): void {
    this.map.set(key, value);
  }

  getAll(): Partial<{ [K in SettingKey]: SettingValue<K> }> {
    const out: Partial<{ [K in SettingKey]: SettingValue<K> }> = {};
    for (const [k, v] of this.map) {
      // any: bridging a heterogeneous Map<SettingKey, unknown> to the partial-record
      // shape requires a cross-key cast; each value is type-correct by construction
      // because set() only accepts SettingValue<K>.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[k] = v;
    }
    return out;
  }
}

class MemoryBookmarksRepo implements BookmarksRepo {
  private nextId = 1;
  private readonly rows: Array<BookmarkRow & { parentId: number | null; sortOrder: number }> = [];

  listByFile(fileHash: FileHash): BookmarkRow[] {
    return this.rows.filter((r) => r.fileHash === fileHash);
  }

  upsert(row: {
    id?: number;
    fileHash: FileHash;
    pageIndex: number;
    title: string;
    createdAt?: number;
    parentId?: number | null;
    sortOrder?: number;
  }): number {
    if (row.id !== undefined) {
      const existing = this.rows.find((r) => r.id === row.id);
      if (existing) {
        existing.fileHash = row.fileHash;
        existing.pageIndex = row.pageIndex;
        existing.title = row.title;
        if (row.parentId !== undefined) existing.parentId = row.parentId;
        if (row.sortOrder !== undefined) existing.sortOrder = row.sortOrder;
        return existing.id;
      }
    }
    const id = this.nextId++;
    this.rows.push({
      id,
      fileHash: row.fileHash,
      pageIndex: row.pageIndex,
      title: row.title,
      createdAt: row.createdAt ?? Date.now(),
      parentId: row.parentId ?? null,
      sortOrder: row.sortOrder ?? 0,
    });
    return id;
  }

  delete(id: number): boolean {
    // Cascade: also drop descendants (mirrors SQLite FK ON DELETE CASCADE).
    const toDelete = new Set<number>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of this.rows) {
        if (r.parentId !== null && toDelete.has(r.parentId) && !toDelete.has(r.id)) {
          toDelete.add(r.id);
          grew = true;
        }
      }
    }
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const row = this.rows[i];
      if (row && toDelete.has(row.id)) this.rows.splice(i, 1);
    }
    return this.rows.length < before;
  }

  listTree(fileHash: FileHash): BookmarkNode[] {
    const items = this.rows.filter((r) => r.fileHash === fileHash);
    const byParent = new Map<number | null, BookmarkNode[]>();
    for (const r of items) {
      const node: BookmarkNode = {
        id: r.id,
        fileHash: r.fileHash,
        pageIndex: r.pageIndex,
        title: r.title,
        createdAt: r.createdAt,
        parentId: r.parentId,
        sortOrder: r.sortOrder,
        children: [],
      };
      const bucket = byParent.get(r.parentId) ?? [];
      bucket.push(node);
      byParent.set(r.parentId, bucket);
    }
    const sortAll = (parentId: number | null): BookmarkNode[] => {
      const list = (byParent.get(parentId) ?? []).slice();
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
      for (const node of list) node.children = sortAll(node.id);
      return list;
    };
    return sortAll(null);
  }

  move(id: number, newParentId: number | null, newSortOrder: number): MoveBookmarkResult {
    // Wave 8.5 (H-1): widened from `boolean` to MoveBookmarkResult so the
    // handler can map each failure mode to the right IPC error variant
    // without heuristic reconstruction.
    const target = this.rows.find((r) => r.id === id);
    if (!target) return { ok: false, error: 'not_found' };
    // newParentId must reference an existing bookmark belonging to the same
    // file (mirrors Ravi's SQLite implementation in
    // src/db/repositories/bookmarks-repo.ts:266-271).
    if (newParentId !== null) {
      if (newParentId === id) return { ok: false, error: 'cycle_detected' };
      const parent = this.rows.find((r) => r.id === newParentId);
      if (!parent) return { ok: false, error: 'invalid_parent' };
      if (parent.fileHash !== target.fileHash) {
        return { ok: false, error: 'invalid_parent' };
      }
      // Cycle detection — newParentId must not be a descendant of id.
      const descendants = new Set<number>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const r of this.rows) {
          if (r.parentId !== null && descendants.has(r.parentId) && !descendants.has(r.id)) {
            descendants.add(r.id);
            grew = true;
          }
        }
      }
      if (descendants.has(newParentId)) {
        return { ok: false, error: 'cycle_detected' };
      }
    }
    target.parentId = newParentId;
    target.sortOrder = newSortOrder;
    return { ok: true };
  }

  rename(id: number, title: string): boolean {
    const target = this.rows.find((r) => r.id === id);
    if (!target) return false;
    target.title = title;
    return true;
  }
}

// ----------------------------------------------------------------------------
// Memory-backed FormTemplatesRepo (Phase 3 — used in tests and until Ravi's
// SQLite repo lands; the production bridge swaps in adaptFormTemplatesRepo).
// ----------------------------------------------------------------------------

interface MemoryFormTemplateRow {
  id: number;
  name: string;
  fields: FormFieldDefinition[];
  sourceDocHash: string | null;
  lastColumnMappings: Record<string, string> | null;
  createdAt: number;
  updatedAt: number;
}

class MemoryFormTemplatesRepo implements FormTemplatesRepo {
  private nextId = 1;
  private readonly rows: MemoryFormTemplateRow[] = [];

  list(): FormTemplateListItemBridge[] {
    return this.rows
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((r) => ({
        id: r.id,
        name: r.name,
        fieldCount: r.fields.length,
        sourceDocHash: r.sourceDocHash,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
  }

  get(id: number): FormTemplateDto | null {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      fields: r.fields,
      sourceDocHash: r.sourceDocHash,
      lastColumnMappings: r.lastColumnMappings,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  save(input: {
    name: string;
    fields: FormFieldDefinition[];
    sourceDocHash?: string | null;
    columnMappings?: Record<string, string> | null;
  }): SaveFormTemplateResult {
    if (!input.name || typeof input.name !== 'string') {
      return { ok: false, error: 'invalid_payload' };
    }
    if (this.rows.some((r) => r.name === input.name)) {
      return { ok: false, error: 'name_in_use' };
    }
    const now = Date.now();
    const row: MemoryFormTemplateRow = {
      id: this.nextId++,
      name: input.name,
      fields: input.fields,
      sourceDocHash: input.sourceDocHash ?? null,
      lastColumnMappings: input.columnMappings ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return { ok: true, id: row.id };
  }

  delete(id: number): boolean {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.rows.splice(idx, 1);
    return true;
  }

  updateColumnMappings(id: number, mappings: Record<string, string>): boolean {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return false;
    r.lastColumnMappings = mappings;
    r.updatedAt = Date.now();
    return true;
  }
}

// ----------------------------------------------------------------------------
// Memory-backed SignatureAuditRepo (Phase 4; used in tests + until Ravi's
// SQLite repo lands).
// ----------------------------------------------------------------------------

class MemorySignatureAuditRepo implements SignatureAuditRepoBridge {
  private nextId = 1;
  private readonly rows: SignatureAuditRowDto[] = [];

  insert(row: SignatureAuditInsertInput): number {
    const id = this.nextId++;
    const now = Date.now();
    const byteRange = row.byte_range_json ? this.tryParseRange(row.byte_range_json) : null;
    this.rows.push({
      id,
      docHash: row.doc_hash,
      preSignDocHash: row.pre_sign_doc_hash,
      signedAt: row.signed_at,
      signatureKind: row.signature_kind,
      signedByFingerprint: row.signed_by_fingerprint,
      signedBySubjectCN: row.signed_by_subject_cn,
      signedByIssuerCN: row.signed_by_issuer_cn,
      certNotBefore: row.cert_not_before,
      certNotAfter: row.cert_not_after,
      tsaUrl: row.tsa_url,
      tsaResponseStatus: row.tsa_response_status,
      sigBytesOffset: row.sig_bytes_offset,
      sigBytesLength: row.sig_bytes_length,
      byteRange,
      reason: row.reason,
      location: row.location,
      fieldName: row.field_name,
      createdAt: now,
      invalidatedByOcrJobId: null,
      invalidatedByRedactionAt: null,
    });
    return id;
  }

  get(id: number): SignatureAuditRowDto | null {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  listByDocHash(docHash: string, limit = 100, offset = 0): SignatureAuditRowDto[] {
    return this.rows
      .filter((r) => r.docHash === docHash)
      .sort((a, b) => b.signedAt - a.signedAt)
      .slice(offset, offset + limit);
  }

  listAll(
    filters: SignatureAuditListFilters,
    limit: number,
    offset: number,
  ): { items: SignatureAuditRowDto[]; total: number } {
    const filtered = this.rows.filter((r) => {
      if (
        filters.fileHash &&
        r.docHash !== filters.fileHash &&
        r.preSignDocHash !== filters.fileHash
      ) {
        return false;
      }
      if (filters.signedByFingerprint && r.signedByFingerprint !== filters.signedByFingerprint) {
        return false;
      }
      if (filters.since !== undefined && r.signedAt < filters.since) return false;
      if (filters.until !== undefined && r.signedAt > filters.until) return false;
      return true;
    });
    const sorted = filtered.sort((a, b) => b.signedAt - a.signedAt);
    return { items: sorted.slice(offset, offset + limit), total: filtered.length };
  }

  delete(id: number): boolean {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.rows.splice(idx, 1);
    return true;
  }

  markInvalidatedByOcrJob(docHash: string, fieldNames: string[], ocrJobId: number): number {
    // Phase 7.2 (David, 2026-06-10) — added to satisfy the now-non-optional
    // SignatureAuditRepoBridge.markInvalidatedByOcrJob contract.
    //
    // Phase 7.2 7.2.4 (Diego, 2026-06-10) — now actually MUTATES the
    // invalidatedByOcrJobId column on matched rows (was previously a
    // count-only no-op). This keeps the in-memory bridge in lock-step with
    // Ravi's SQLite UPDATE behaviour so a future test against the memory
    // bridge sees the same observable state as one running against SQLite.
    // The e2e at signed-pdf-ocr-invalidation.spec.ts runs against SQLite
    // (Item A static-import lift, per L-006 e2e exception); the memory-
    // repo behaviour is still load-bearing for any unit test that exercises
    // the back-ref through the in-memory bridge.
    if (fieldNames.length === 0) return 0;
    const set = new Set(fieldNames);
    let changed = 0;
    for (const r of this.rows) {
      if (r.docHash === docHash && r.fieldName !== null && set.has(r.fieldName)) {
        r.invalidatedByOcrJobId = ocrJobId;
        changed += 1;
      }
    }
    return changed;
  }

  markInvalidatedByRedaction(docHash: string, fieldNames: string[]): number {
    // Phase 7.4 B1 (David, 2026-06-15) — mirrors `markInvalidatedByOcrJob`
    // above. Mutates `invalidatedByRedactionAt = Date.now()` on every matched
    // row. Empty fieldNames → 0 rows. Same anti-sentinel discipline as the
    // OCR sibling. Mirrors Ravi's SQL `unixepoch() * 1000` timestamping —
    // the memory bridge uses Date.now() since it lacks a SQL clock; the
    // observable behaviour (non-null timestamp on matched rows, null on
    // unmatched) is identical.
    if (fieldNames.length === 0) return 0;
    const now = Date.now();
    const set = new Set(fieldNames);
    let changed = 0;
    for (const r of this.rows) {
      if (r.docHash === docHash && r.fieldName !== null && set.has(r.fieldName)) {
        r.invalidatedByRedactionAt = now;
        changed += 1;
      }
    }
    return changed;
  }

  private tryParseRange(json: string): number[] | null {
    try {
      const parsed = JSON.parse(json) as unknown;
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  }
}

// ----------------------------------------------------------------------------
// Memory-backed Phase 5 repos (used in tests + parallel-wave skew).
// ----------------------------------------------------------------------------

class MemoryOcrJobsRepo implements OcrJobsRepoBridge {
  private nextId = 1;
  private readonly rows: OcrJobRowDto[] = [];

  insert(row: {
    doc_hash: string;
    page_range_start: number;
    page_range_end: number;
    langs: string;
    preprocess_json: string;
    status: OcrJobBridgeStatus;
    started_at: number;
    invalidated_signatures: 0 | 1;
  }): number {
    const id = this.nextId++;
    this.rows.push({
      id,
      docHash: row.doc_hash,
      pageRangeStart: row.page_range_start,
      pageRangeEnd: row.page_range_end,
      langs: row.langs,
      preprocessJson: row.preprocess_json,
      status: row.status,
      startedAt: row.started_at,
      completedAt: null,
      meanConfidence: null,
      totalWords: null,
      errorMessage: null,
      invalidatedSignatures: row.invalidated_signatures === 1,
      createdAt: Date.now(),
    });
    return id;
  }

  updateStatus(
    id: number,
    update: {
      status: 'completed' | 'cancelled' | 'failed';
      completed_at?: number;
      mean_confidence?: number;
      total_words?: number;
      error_message?: string;
    },
  ): boolean {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return false;
    row.status = update.status;
    if (update.completed_at !== undefined) row.completedAt = update.completed_at;
    if (update.mean_confidence !== undefined) row.meanConfidence = update.mean_confidence;
    if (update.total_words !== undefined) row.totalWords = update.total_words;
    if (update.error_message !== undefined) row.errorMessage = update.error_message;
    return true;
  }

  get(id: number): OcrJobRowDto | null {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  listAll(
    filters: {
      docHash?: string;
      status?: OcrJobBridgeStatus;
      since?: number;
      until?: number;
    },
    limit: number,
    offset: number,
  ): { items: OcrJobRowDto[]; total: number } {
    const filtered = this.rows.filter((r) => {
      if (filters.docHash !== undefined && r.docHash !== filters.docHash) return false;
      if (filters.status !== undefined && r.status !== filters.status) return false;
      if (filters.since !== undefined && r.startedAt < filters.since) return false;
      if (filters.until !== undefined && r.startedAt > filters.until) return false;
      return true;
    });
    const sorted = filtered.sort((a, b) => b.startedAt - a.startedAt);
    return { items: sorted.slice(offset, offset + limit), total: filtered.length };
  }

  delete(id: number): boolean {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.rows.splice(idx, 1);
    return true;
  }
}

class MemoryOcrResultsRepo implements OcrResultsRepoBridge {
  private nextId = 1;
  private readonly rows: OcrResultRowDto[] = [];

  insert(row: {
    job_id: number;
    page_index: number;
    total_words: number;
    low_confidence_words: number;
    mean_confidence: number;
    words_json: string;
    img_width_px: number;
    img_height_px: number;
    duration_ms: number;
  }): number {
    const id = this.nextId++;
    this.rows.push({
      id,
      jobId: row.job_id,
      pageIndex: row.page_index,
      totalWords: row.total_words,
      lowConfidenceWords: row.low_confidence_words,
      meanConfidence: row.mean_confidence,
      wordsJson: row.words_json,
      imgWidthPx: row.img_width_px,
      imgHeightPx: row.img_height_px,
      durationMs: row.duration_ms,
      createdAt: Date.now(),
    });
    return id;
  }

  listByJobId(jobId: number): OcrResultRowDto[] {
    return this.rows.filter((r) => r.jobId === jobId);
  }

  listPageResultsByJobId(jobId: number): OcrPageResult[] {
    return assemblePageResultsFromRows(this.rows.filter((r) => r.jobId === jobId));
  }
}

// ============================================================================
// Phase 5.2 (Marcus, 2026-06-04): shared parse-and-assemble for
// OcrResultsRepoBridge.listPageResultsByJobId — used by BOTH the memory-backed
// repo (tests) and the SQLite-backed adapter (production).
//
// Per-row JSON-parse failures degrade to a SKIP of that single row (logged),
// so one corrupt blob does not deny the user the rest of the document's
// confidence overlay. Returns rows sorted page_index ASC.
// ============================================================================

function assemblePageResultsFromRows(rows: OcrResultRowDto[]): OcrPageResult[] {
  const sorted = [...rows].sort((a, b) => a.pageIndex - b.pageIndex);
  const out: OcrPageResult[] = [];
  for (const row of sorted) {
    const words = safeParseWordsJson(row.wordsJson, row.id);
    if (words === null) continue;
    out.push({
      pageIndex: row.pageIndex,
      imgDimsPx: { widthPx: row.imgWidthPx, heightPx: row.imgHeightPx },
      totalWords: row.totalWords,
      lowConfidenceWords: row.lowConfidenceWords,
      meanConfidence: row.meanConfidence,
      words,
      durationMs: row.durationMs,
    });
  }
  return out;
}

/**
 * Parse and validate a `words_json` blob into `OcrWord[]`. Returns `null` on
 * any structural failure so the caller can skip the row (per the partial-result
 * recovery policy).
 *
 * Validation is shape-only — coordinates / confidence ranges are not re-checked
 * here (the engine validated them on insert). We only guard against shapes
 * that would crash the renderer.
 */
function safeParseWordsJson(json: string, rowId: number): OcrWord[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `ocr-results bridge: row id=${String(rowId)} words_json JSON.parse failed — skipping row.`,
      e,
    );
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const words: OcrWord[] = [];
  for (const raw of parsed) {
    if (raw === null || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.text !== 'string') return null;
    if (typeof r.confidence !== 'number') return null;
    const imgRect = r.imgRect;
    if (imgRect === null || typeof imgRect !== 'object') return null;
    const ir = imgRect as Record<string, unknown>;
    if (
      typeof ir.x0 !== 'number' ||
      typeof ir.y0 !== 'number' ||
      typeof ir.x1 !== 'number' ||
      typeof ir.y1 !== 'number'
    ) {
      return null;
    }
    let pdfRect: PdfRect | null = null;
    if (r.pdfRect !== null && r.pdfRect !== undefined) {
      if (typeof r.pdfRect !== 'object') return null;
      const pr = r.pdfRect as Record<string, unknown>;
      if (
        typeof pr.x !== 'number' ||
        typeof pr.y !== 'number' ||
        typeof pr.width !== 'number' ||
        typeof pr.height !== 'number'
      ) {
        return null;
      }
      pdfRect = { x: pr.x, y: pr.y, width: pr.width, height: pr.height };
    }
    words.push({
      text: r.text,
      confidence: r.confidence,
      imgRect: { x0: ir.x0, y0: ir.y0, x1: ir.x1, y1: ir.y1 },
      pdfRect,
    });
  }
  return words;
}

class MemoryLanguagePacksRepo implements LanguagePacksRepoBridge {
  private readonly rows = new Map<string, LanguagePackRowDto>();

  upsert(row: {
    lang: string;
    source: 'bundled' | 'downloaded';
    file_path: string;
    size_bytes: number;
    sha256: string;
    installed_at: number;
    last_used_at: number | null;
  }): void {
    this.rows.set(row.lang, {
      lang: row.lang,
      source: row.source,
      filePath: row.file_path,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      installedAt: row.installed_at,
      lastUsedAt: row.last_used_at,
    });
  }

  list(): LanguagePackRowDto[] {
    return Array.from(this.rows.values());
  }

  get(lang: string): LanguagePackRowDto | null {
    return this.rows.get(lang) ?? null;
  }

  remove(lang: string): boolean {
    const r = this.rows.get(lang);
    if (!r) return false;
    if (r.source === 'bundled') return false;
    this.rows.delete(lang);
    return true;
  }

  touchLastUsed(lang: string, when: number): void {
    const r = this.rows.get(lang);
    if (r) r.lastUsedAt = when;
  }
}

export function createMemoryDbBridge(): DbBridge {
  return {
    recents: new MemoryRecentsRepo(),
    settings: new MemorySettingsRepo(),
    bookmarks: new MemoryBookmarksRepo(),
    formTemplates: new MemoryFormTemplatesRepo(),
    // Phase 4: memory-backed signature audit repo (Ravi's SQLite repo wraps
    // through adaptSignatureAuditRepo when shipped).
    signatureAudit: new MemorySignatureAuditRepo(),
    // Phase 5 memory-backed repos. adapt*Repo functions wrap Ravi's SQLite
    // when wired by the bootstrap.
    ocrJobs: new MemoryOcrJobsRepo(),
    ocrResults: new MemoryOcrResultsRepo(),
    languagePacks: new MemoryLanguagePacksRepo(),
    exportJobs: new MemoryExportJobsRepo(),
    // Phase 7.5 Wave 3 (David, 2026-06-17): stamps_library memory bridge.
    stampsLibrary: new MemoryStampsLibraryRepo(),
  };
}

// ============================================================================
// Phase 7.5 Wave 3 (David, 2026-06-17) — memory stamps_library bridge.
//
// Used for tests + dev fallback. Production wiring constructs
// adaptStampsLibraryRepo(createStampsLibraryRepo(db)) in src/main/index.ts.
// Seeds the same 10 built-in stamps the SQLite migration seeds so the test
// surface matches production behavior.
// ============================================================================

interface MemoryStampRow extends StampLibraryEntry {}

const MEMORY_STAMP_BUILTINS: Array<Omit<MemoryStampRow, 'id'>> = [
  // Match migrations/0009_phase7.5.sql seeds. Color is the rubber-stamp red
  // except 'paid' and 'final' which are green.
  builtin('builtin:approved', 'stamps.builtin.approved', 'APPROVED', 144, 36, '#C2272D'),
  builtin(
    'builtin:confidential',
    'stamps.builtin.confidential',
    'CONFIDENTIAL',
    180,
    36,
    '#C2272D',
  ),
  builtin('builtin:draft', 'stamps.builtin.draft', 'DRAFT', 120, 36, '#C2272D'),
  builtin('builtin:sample', 'stamps.builtin.sample', 'SAMPLE', 120, 36, '#C2272D'),
  builtin('builtin:reviewed', 'stamps.builtin.reviewed', 'REVIEWED', 144, 36, '#C2272D'),
  builtin('builtin:received', 'stamps.builtin.received', 'RECEIVED', 144, 36, '#C2272D'),
  builtin('builtin:paid', 'stamps.builtin.paid', 'PAID', 108, 36, '#1F7A1F'),
  builtin('builtin:void', 'stamps.builtin.void', 'VOID', 108, 36, '#C2272D'),
  builtin('builtin:final', 'stamps.builtin.final', 'FINAL', 108, 36, '#1F7A1F'),
  builtin(
    'builtin:not-approved',
    'stamps.builtin.not-approved',
    'NOT APPROVED',
    180,
    36,
    '#C2272D',
  ),
];

function builtin(
  key: string,
  name: string,
  text: string,
  widthPt: number,
  heightPt: number,
  color: string,
): Omit<MemoryStampRow, 'id'> {
  return {
    builtinKey: key,
    name,
    kind: 'text',
    textValue: text,
    imagePath: null,
    widthPt,
    heightPt,
    color,
    createdAt: 0,
    lastUsedAt: null,
    useCount: 0,
  };
}

export class MemoryStampsLibraryRepo implements StampsLibraryRepoBridge {
  private nextId = 1;
  private readonly rows = new Map<number, MemoryStampRow>();

  constructor() {
    for (const seed of MEMORY_STAMP_BUILTINS) {
      const id = this.nextId++;
      this.rows.set(id, { ...seed, id });
    }
  }

  list(): StampLibraryEntry[] {
    return Array.from(this.rows.values()).sort(this.byRecentDesc);
  }

  listRecent(limit: number): StampLibraryEntry[] {
    return Array.from(this.rows.values())
      .filter((r) => r.lastUsedAt !== null)
      .sort(this.byRecentDesc)
      .slice(0, Math.max(0, limit));
  }

  listByKind(kind: 'text' | 'image'): StampLibraryEntry[] {
    return Array.from(this.rows.values())
      .filter((r) => r.kind === kind)
      .sort(this.byRecentDesc);
  }

  getById(id: number): StampLibraryEntry | null {
    return this.rows.get(id) ?? null;
  }

  getByBuiltinKey(key: string): StampLibraryEntry | null {
    for (const r of this.rows.values()) {
      if (r.builtinKey === key) return r;
    }
    return null;
  }

  insertUserStamp(
    input: Parameters<StampsLibraryRepoBridge['insertUserStamp']>[0],
  ): ReturnType<StampsLibraryRepoBridge['insertUserStamp']> {
    if (typeof input.name !== 'string' || input.name.length === 0) {
      return { ok: false, error: 'invalid_payload', reason: 'name required' };
    }
    if (
      input.kind === 'text' &&
      (typeof input.textValue !== 'string' || input.textValue.length === 0)
    ) {
      return { ok: false, error: 'invalid_payload', reason: 'text requires textValue' };
    }
    if (
      input.kind === 'image' &&
      (typeof input.imagePath !== 'string' || input.imagePath.length === 0)
    ) {
      return { ok: false, error: 'invalid_payload', reason: 'image requires imagePath' };
    }
    const id = this.nextId++;
    this.rows.set(id, {
      id,
      builtinKey: null,
      name: input.name,
      kind: input.kind,
      textValue: input.kind === 'text' ? (input.textValue ?? null) : null,
      imagePath: input.kind === 'image' ? (input.imagePath ?? null) : null,
      widthPt: input.widthPt,
      heightPt: input.heightPt,
      color: input.kind === 'text' ? (input.color ?? null) : null,
      createdAt: Date.now(),
      lastUsedAt: null,
      useCount: 0,
    });
    return { ok: true, id };
  }

  deleteUserStamp(id: number): ReturnType<StampsLibraryRepoBridge['deleteUserStamp']> {
    const row = this.rows.get(id);
    if (!row) return { ok: false, error: 'not_found' };
    if (row.builtinKey !== null) return { ok: false, error: 'forbidden_builtin' };
    this.rows.delete(id);
    return { ok: true, removed: 1 };
  }

  recordUse(id: number, now: number = Date.now()): number | null {
    const row = this.rows.get(id);
    if (!row) return null;
    row.lastUsedAt = now;
    row.useCount += 1;
    return row.useCount;
  }

  private readonly byRecentDesc = (a: StampLibraryEntry, b: StampLibraryEntry): number => {
    const aNull = a.lastUsedAt === null;
    const bNull = b.lastUsedAt === null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && !bNull) {
      const diff = (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
      if (diff !== 0) return diff;
    }
    return b.createdAt - a.createdAt;
  };
}

// ============================================================================
// Phase 7.5 Wave 3 (David, 2026-06-17) — adapter wrapping Ravi's
// `StampsLibraryRepo` (SQLite, snake_case rows) into the camelCase
// StampLibraryEntry DTO the IPC contract uses.
// ============================================================================

export interface RaviStampsLibraryRepo {
  list(): StampsLibraryRow[];
  listRecent(limit?: number): StampsLibraryRow[];
  listByKind(kind: 'text' | 'image'): StampsLibraryRow[];
  getById(id: number): StampsLibraryRow | null;
  getByBuiltinKey(key: string): StampsLibraryRow | null;
  insertUserStamp(input: {
    name: string;
    kind: 'text' | 'image';
    text_value?: string | null;
    image_path?: string | null;
    width_pt: number;
    height_pt: number;
    color?: string | null;
    created_at?: number;
  }): { ok: true; id: number } | { ok: false; error: 'invalid_payload'; reason: string };
  deleteUserStamp(
    id: number,
  ):
    | { ok: true; removed: number }
    | { ok: false; error: 'forbidden_builtin' }
    | { ok: false; error: 'not_found' };
  recordUse(id: number, now?: number): number | null;
}

function rowToDto(r: StampsLibraryRow): StampLibraryEntry {
  return {
    id: r.id,
    builtinKey: r.builtin_key,
    name: r.name,
    kind: r.kind,
    textValue: r.text_value,
    imagePath: r.image_path,
    widthPt: r.width_pt,
    heightPt: r.height_pt,
    color: r.color,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    useCount: r.use_count,
  };
}

export function adaptStampsLibraryRepo(raw: RaviStampsLibraryRepo): StampsLibraryRepoBridge {
  return {
    list: () => raw.list().map(rowToDto),
    listRecent: (limit: number) => raw.listRecent(limit).map(rowToDto),
    listByKind: (kind: 'text' | 'image') => raw.listByKind(kind).map(rowToDto),
    getById: (id: number) => {
      const r = raw.getById(id);
      return r ? rowToDto(r) : null;
    },
    getByBuiltinKey: (key: string) => {
      const r = raw.getByBuiltinKey(key);
      return r ? rowToDto(r) : null;
    },
    insertUserStamp: (input) =>
      raw.insertUserStamp({
        name: input.name,
        kind: input.kind,
        text_value: input.textValue ?? null,
        image_path: input.imagePath ?? null,
        width_pt: input.widthPt,
        height_pt: input.heightPt,
        color: input.color ?? null,
      }),
    deleteUserStamp: (id) => raw.deleteUserStamp(id),
    recordUse: (id, now) => raw.recordUse(id, now),
  };
}

// ============================================================================
// Phase 6 memory-backed export-jobs repo (used in tests and until Ravi's
// SQLite repo ships in Wave 24). The renderer-facing DTO translation lives
// in src/ipc/handlers/export-list-jobs.ts (consumed by Riley's selectors).
// ============================================================================

interface MemoryExportJobRow {
  id: number;
  doc_hash: string;
  format: ExportFormatBridge;
  quality_tier: 'text-only' | 'layout-preserving' | 'n/a';
  page_range_start: number;
  page_range_end: number;
  include_annotations: 0 | 1;
  dpi: number | null;
  jpeg_quality: number | null;
  multi_page_tiff: 0 | 1 | null;
  output_path: string;
  status: ExportJobBridgeStatus;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  pages_processed: number;
  paragraphs_extracted: number | null;
  tables_detected: number | null;
  images_embedded: number | null;
  output_size_bytes: number | null;
  error_message: string | null;
  created_at: number;
}

class MemoryExportJobsRepo implements ExportJobsRepoBridge {
  private nextId = 1;
  private readonly rows = new Map<number, MemoryExportJobRow>();

  insert(row: Parameters<ExportJobsRepoBridge['insert']>[0]): number {
    const id = this.nextId++;
    const now = Date.now();
    this.rows.set(id, {
      id,
      doc_hash: row.doc_hash,
      format: row.format,
      quality_tier: row.quality_tier,
      page_range_start: row.page_range_start,
      page_range_end: row.page_range_end,
      include_annotations: row.include_annotations,
      dpi: row.dpi,
      jpeg_quality: row.jpeg_quality,
      multi_page_tiff: row.multi_page_tiff,
      output_path: row.output_path,
      status: row.status,
      started_at: row.started_at,
      completed_at: null,
      duration_ms: null,
      pages_processed: 0,
      paragraphs_extracted: null,
      tables_detected: null,
      images_embedded: null,
      output_size_bytes: null,
      error_message: null,
      created_at: now,
    });
    return id;
  }

  updateStatus(id: number, update: Parameters<ExportJobsRepoBridge['updateStatus']>[1]): boolean {
    const row = this.rows.get(id);
    if (!row) return false;
    row.status = update.status;
    if (typeof update.completed_at === 'number') row.completed_at = update.completed_at;
    if (typeof update.duration_ms === 'number') row.duration_ms = update.duration_ms;
    if (typeof update.error_message === 'string') row.error_message = update.error_message;
    return true;
  }

  updateProgress(
    id: number,
    pagesProcessed: number,
    extras?: Parameters<ExportJobsRepoBridge['updateProgress']>[2],
  ): boolean {
    const row = this.rows.get(id);
    if (!row) return false;
    row.pages_processed = pagesProcessed;
    if (extras) {
      if (typeof extras.paragraphsExtracted === 'number')
        row.paragraphs_extracted = extras.paragraphsExtracted;
      if (typeof extras.tablesDetected === 'number') row.tables_detected = extras.tablesDetected;
      if (typeof extras.imagesEmbedded === 'number') row.images_embedded = extras.imagesEmbedded;
      if (typeof extras.outputSizeBytes === 'number')
        row.output_size_bytes = extras.outputSizeBytes;
    }
    return true;
  }

  get(id: number): unknown {
    return this.rows.get(id) ?? null;
  }

  listAll(
    filters: Parameters<ExportJobsRepoBridge['listAll']>[0],
    limit: number,
    offset: number,
  ): { items: unknown[]; total: number } {
    let all = Array.from(this.rows.values());
    if (filters.docHash !== undefined) all = all.filter((r) => r.doc_hash === filters.docHash);
    if (filters.format !== undefined) all = all.filter((r) => r.format === filters.format);
    if (filters.status !== undefined) all = all.filter((r) => r.status === filters.status);
    if (filters.since !== undefined) all = all.filter((r) => r.started_at >= filters.since!);
    if (filters.until !== undefined) all = all.filter((r) => r.started_at <= filters.until!);
    all.sort((a, b) => b.started_at - a.started_at);
    const total = all.length;
    const items = all.slice(offset, offset + limit);
    return { items, total };
  }

  delete(id: number): boolean {
    return this.rows.delete(id);
  }
}

// ----------------------------------------------------------------------------
// Adapter — wrap Ravi's snake_case repos into the camelCase IPC contract.
// Ravi's SettingsRepo signature matches us 1:1; recents and bookmarks need
// field-name translation at the boundary.
// ----------------------------------------------------------------------------

export interface RaviRecentRow {
  path: string;
  last_opened_at: number;
  file_hash: string;
  display_name: string;
}

export interface RaviRecentsRepo {
  list(limit?: number): RaviRecentRow[];
  upsert(input: {
    path: string;
    display_name: string;
    file_hash: string;
    last_opened_at?: number;
  }): void;
  clear(): number;
}

export interface RaviBookmarkRow {
  id: number;
  file_hash: string;
  page_index: number;
  title: string;
  created_at: number;
}

export interface RaviBookmarksRepo {
  listByFile(fileHash: string): RaviBookmarkRow[];
  upsert(input: {
    id?: number;
    file_hash: string;
    page_index: number;
    title: string;
    created_at?: number;
  }): number;
  delete(id: number): boolean;
}

export function adaptRecentsRepo(raw: RaviRecentsRepo): RecentsRepo {
  return {
    list(limit) {
      return raw.list(limit).map((r) => ({
        path: r.path,
        displayName: r.display_name,
        fileHash: r.file_hash,
        lastOpenedAt: r.last_opened_at,
        fileStillExists: true,
      }));
    },
    upsert(row) {
      // D-2 / TS2379 fix: `exactOptionalPropertyTypes: true` forbids passing
      // `T | undefined` into a `T?` field. Use conditional spread so the
      // `last_opened_at` key is only present when the caller supplied a value;
      // Ravi's repo defaults to `Date.now()` when the key is absent.
      raw.upsert({
        path: row.path,
        display_name: row.displayName,
        file_hash: row.fileHash,
        ...(row.lastOpenedAt !== undefined ? { last_opened_at: row.lastOpenedAt } : {}),
      });
    },
    clear() {
      return raw.clear();
    },
  };
}

export function adaptBookmarksRepo(raw: RaviBookmarksRepo): BookmarksRepo {
  return {
    listByFile(fileHash) {
      return raw.listByFile(fileHash).map((r) => ({
        id: r.id,
        fileHash: r.file_hash,
        pageIndex: r.page_index,
        title: r.title,
        createdAt: r.created_at,
        // Phase 2 (data-models.md §7.4): translate snake_case parent_id /
        // sort_order to camelCase when Ravi's Phase-2 repo exposes them.
        ...(hasParentId(r) ? { parentId: r.parent_id } : {}),
        ...(hasSortOrder(r) ? { sortOrder: r.sort_order } : {}),
      }));
    },
    upsert(row) {
      // D-2 / TS2379 fix (same pattern as adaptRecentsRepo above): omit
      // optional id/created_at when the caller didn't supply them. Ravi's
      // repo treats absence as "auto-assign" / "now()" respectively.
      //
      // Phase 2 parent_id / sort_order are passed via an extra-keys object
      // cast through unknown — Ravi's Phase-1 repo ignores unknown fields
      // (object-rest strips), Phase-2 repo picks them up.
      const input: {
        id?: number;
        file_hash: string;
        page_index: number;
        title: string;
        created_at?: number;
        parent_id?: number | null;
        sort_order?: number;
      } = {
        file_hash: row.fileHash,
        page_index: row.pageIndex,
        title: row.title,
        ...(row.id !== undefined ? { id: row.id } : {}),
        ...(row.createdAt !== undefined ? { created_at: row.createdAt } : {}),
        ...(row.parentId !== undefined ? { parent_id: row.parentId } : {}),
        ...(row.sortOrder !== undefined ? { sort_order: row.sortOrder } : {}),
      };
      return raw.upsert(input);
    },
    delete(id) {
      return raw.delete(id);
    },
    // Phase 2 (data-models.md §7.5): tree / move / rename — adapt to Ravi's
    // snake_case methods when present, otherwise return a sensible default.
    listTree(fileHash) {
      const raviTree = (raw as Partial<RaviBookmarksRepoPhase2>).listTree;
      if (typeof raviTree !== 'function') {
        // Fallback: build a flat tree from listByFile so the renderer still
        // works against a Phase-1 repo. Parent edges are unavailable, so
        // every row is a root-level node.
        return raw.listByFile(fileHash).map((r) => ({
          id: r.id,
          fileHash: r.file_hash,
          pageIndex: r.page_index,
          title: r.title,
          createdAt: r.created_at,
          parentId: hasParentId(r) ? r.parent_id : null,
          sortOrder: hasSortOrder(r) ? r.sort_order : 0,
          children: [] as ReturnType<BookmarksRepo['listTree']>,
        }));
      }
      const tree = raviTree.call(raw, fileHash);
      return tree.map(mapRaviBookmarkNode);
    },
    move(id, newParentId, newSortOrder): MoveBookmarkResult {
      // Wave 8.5 (H-1): forward Ravi's discriminated-union result verbatim.
      // When her Phase-2 method isn't yet present (parallel-wave skew), map
      // the absence to `not_found` rather than fabricating a generic
      // failure — the renderer never gets the chance to mis-classify a
      // legitimate cycle as not-found.
      const fn = (raw as Partial<RaviBookmarksRepoPhase2>).move;
      if (typeof fn !== 'function') {
        return { ok: false, error: 'not_found' };
      }
      return fn.call(raw, id, newParentId, newSortOrder);
    },
    rename(id, title) {
      const fn = (raw as Partial<RaviBookmarksRepoPhase2>).rename;
      if (typeof fn !== 'function') return false;
      return fn.call(raw, id, title);
    },
  };
}

// Phase 2 — Ravi's Phase-2 BookmarkRow + repo shape (data-models.md §7.4).
// Declared optionally here so the adapter compiles regardless of whether
// Ravi's repo has shipped the Phase-2 methods yet.
interface RaviBookmarkRowPhase2 extends RaviBookmarkRow {
  parent_id: number | null;
  sort_order: number;
}

interface RaviBookmarkNodeRow extends RaviBookmarkRowPhase2 {
  children: RaviBookmarkNodeRow[];
}

export interface RaviBookmarksRepoPhase2 extends RaviBookmarksRepo {
  listTree(fileHash: string): RaviBookmarkNodeRow[];
  // Wave 8.5 (H-1): mirrors Ravi's repo signature in
  // src/db/repositories/bookmarks-repo.ts:86 — the underlying SQLite repo
  // has always returned the discriminated union; this interface previously
  // collapsed it to `boolean` and threw away the variant information.
  move(id: number, newParentId: number | null, newSortOrder: number): MoveBookmarkResult;
  rename(id: number, title: string): boolean;
}

function hasParentId(r: RaviBookmarkRow): r is RaviBookmarkRow & { parent_id: number | null } {
  return 'parent_id' in r;
}

function hasSortOrder(r: RaviBookmarkRow): r is RaviBookmarkRow & { sort_order: number } {
  return 'sort_order' in r;
}

function mapRaviBookmarkNode(r: RaviBookmarkNodeRow): BookmarkNode {
  return {
    id: r.id,
    fileHash: r.file_hash,
    pageIndex: r.page_index,
    title: r.title,
    createdAt: r.created_at,
    parentId: r.parent_id,
    sortOrder: r.sort_order,
    children: (r.children ?? []).map(mapRaviBookmarkNode),
  };
}

// ----------------------------------------------------------------------------
// Phase 3 (data-models.md §8.5-§8.6): adapter for Ravi's form_templates SQLite
// repo. Translates snake_case rows + JSON-string columns into the camelCase +
// parsed-object DTOs the IPC handlers consume.
//
// Ravi's contract (from data-models.md §8.6):
//   list(): FormTemplateRow[]                       // ordered by updated_at DESC
//   get(id): FormTemplateRow | null
//   getByName(name): FormTemplateRow | null
//   upsert({ name, fields_json, source_doc_hash, last_column_mappings, id?,
//            created_at?, updated_at? }): number    // returns id
//   delete(id): boolean
//   updateColumnMappings(id, mappings): boolean
//
// The adapter widens to the bridge's SaveFormTemplateResult discriminated
// union so the IPC layer surfaces 'name_in_use' (UNIQUE constraint) cleanly.
// ----------------------------------------------------------------------------

export interface RaviFormTemplateRow {
  id: number;
  name: string;
  fields_json: string;
  source_doc_hash: string | null;
  last_column_mappings: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Mirror of Ravi's `UpsertFormTemplateResult` (src/db/repositories/form-templates-repo.ts).
 * Defined here so this bridge module doesn't import from src/db (file-ownership
 * boundary — David owns the bridge, Ravi owns the repo). Structurally identical;
 * `adaptFormTemplatesRepo` runtime-passes the value through.
 */
export type RaviUpsertFormTemplateResult =
  | { ok: true; id: number }
  | { ok: false; error: 'name_in_use' | 'not_found' };

export interface RaviFormTemplatesRepo {
  list(): RaviFormTemplateRow[];
  get(id: number): RaviFormTemplateRow | null;
  getByName(name: string): RaviFormTemplateRow | null;
  upsert(row: {
    id?: number;
    name: string;
    fields_json: string;
    source_doc_hash: string | null;
    last_column_mappings: string | null;
    created_at?: number;
    updated_at?: number;
  }): RaviUpsertFormTemplateResult;
  delete(id: number): boolean;
  updateColumnMappings(id: number, mappings: Record<string, string>): boolean;
}

export function adaptFormTemplatesRepo(raw: RaviFormTemplatesRepo): FormTemplatesRepo {
  const parseFields = (json: string): FormFieldDefinition[] => {
    try {
      const parsed = JSON.parse(json) as unknown;
      return Array.isArray(parsed) ? (parsed as FormFieldDefinition[]) : [];
    } catch {
      return [];
    }
  };
  const parseMappings = (json: string | null): Record<string, string> | null => {
    if (json === null) return null;
    try {
      const parsed = JSON.parse(json) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : null;
    } catch {
      return null;
    }
  };

  return {
    list(): FormTemplateListItemBridge[] {
      return raw.list().map((r) => ({
        id: r.id,
        name: r.name,
        fieldCount: parseFields(r.fields_json).length,
        sourceDocHash: r.source_doc_hash,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },
    get(id: number): FormTemplateDto | null {
      const r = raw.get(id);
      if (!r) return null;
      return {
        id: r.id,
        name: r.name,
        fields: parseFields(r.fields_json),
        sourceDocHash: r.source_doc_hash,
        lastColumnMappings: parseMappings(r.last_column_mappings),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    },
    save(input): SaveFormTemplateResult {
      if (!input.name || typeof input.name !== 'string') {
        return { ok: false, error: 'invalid_payload' };
      }
      // Ravi's upsert returns a discriminated UpsertFormTemplateResult
      // (RaviUpsertFormTemplateResult) — forward the 'name_in_use' variant
      // verbatim, map 'not_found' to 'invalid_payload' (no separate code
      // for it in api-contracts §13.7 — the renderer should never request
      // an update of a missing template).
      try {
        const result = raw.upsert({
          name: input.name,
          fields_json: JSON.stringify(input.fields),
          source_doc_hash: input.sourceDocHash ?? null,
          last_column_mappings:
            input.columnMappings && Object.keys(input.columnMappings).length > 0
              ? JSON.stringify(input.columnMappings)
              : null,
        });
        if (result.ok) {
          return { ok: true, id: result.id };
        }
        if (result.error === 'name_in_use') {
          return { ok: false, error: 'name_in_use' };
        }
        return { ok: false, error: 'invalid_payload' };
      } catch (e) {
        const msg = (e as Error).message ?? '';
        if (/UNIQUE|unique/.test(msg)) return { ok: false, error: 'name_in_use' };
        return { ok: false, error: 'invalid_payload' };
      }
    },
    delete(id: number): boolean {
      return raw.delete(id);
    },
    updateColumnMappings(id: number, mappings: Record<string, string>): boolean {
      return raw.updateColumnMappings(id, mappings);
    },
  };
}

// ----------------------------------------------------------------------------
// Phase 2 (api-contracts.md §12.9, data-models.md §7.6):
// `SettingsRepo` adapter for parallel-wave deltas — Ravi's Phase-1 SettingsRepo
// only knows the Phase-1 SettingKey union. When David adds 4 new Phase-2 keys
// (export.deterministic, export.includeBookmarksInOutline, editing.*) the
// renderer / handler may try to read them BEFORE Ravi widens her repo. The
// adapter intercepts unknown keys and returns `null` (the handler's "use
// default" signal). Phase-1 keys pass through unchanged.
// ----------------------------------------------------------------------------

const PHASE_2_SETTING_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
  'export.deterministic',
  'export.includeBookmarksInOutline',
  'editing.confirmDelete',
  'editing.commitTextOnBlur',
  // Phase 7 (Wave 28a, David — data-models.md §12.3): the same cross-wave-skew
  // tolerance. Ravi's migration 0007 seeds these four keys, but the renderer /
  // handler may read them BEFORE Ravi's schema v7 lands in this parallel wave.
  // Until then they cleanly fall back to null (the "use default" signal). This
  // reuses the Phase-2 graceful-degradation set name; the behavior is identical.
  'telemetry.optIn',
  'i18n.locale',
  'update.channel',
  'update.lastCheckedAt',
]);

/**
 * Type-erased shape for accepting Ravi's narrower Phase-1 SettingsRepo.
 * The unknown-key tolerance is enforced at runtime (try/catch) — at the
 * type level we accept the loosest signature that includes both Ravi's
 * Phase-1 repo and any Phase-2 widening she ships later.
 */
export interface RaviSettingsRepoLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  getAll(): Record<string, unknown>;
}

export function adaptSettingsRepo(raw: unknown): SettingsRepo {
  // The Ravi repo carries a tighter generic signature; we accept `unknown`
  // and assert internally to bridge the variance gap (David's adapter is
  // the single audit boundary for this cross-Wave incompatibility).
  const r = raw as RaviSettingsRepoLike;
  return {
    get<K extends SettingKey>(key: K): SettingValue<K> | null {
      try {
        const v = r.get(key);
        return v === undefined || v === null ? null : (v as SettingValue<K>);
      } catch {
        // Ravi's Phase-1 repo throws on unknown key — Phase-2 keys cleanly
        // fall back to null until Ravi widens the SettingKey union.
        if (PHASE_2_SETTING_KEYS.has(key)) return null;
        throw new Error(`settings.get('${key}') failed`);
      }
    },
    set<K extends SettingKey>(key: K, value: SettingValue<K>): void {
      try {
        r.set(key, value);
      } catch {
        // Phase-2 keys silently no-op if the repo doesn't know them yet.
        // Code-review notes call this out; Wave 8 ratchets it once Ravi's
        // repo widens.
        if (PHASE_2_SETTING_KEYS.has(key)) return;
        throw new Error(`settings.set('${key}') failed`);
      }
    },
    getAll(): Partial<{ [K in SettingKey]: SettingValue<K> }> {
      const all = r.getAll();
      // Cast through unknown — caller-side keys are validated by SettingKey
      // union; values are typed by serialization at the repo layer.
      return all as Partial<{ [K in SettingKey]: SettingValue<K> }>;
    },
  };
}

// ----------------------------------------------------------------------------
// Phase 4 (data-models.md §9.5-§9.6): adapter for Ravi's SQLite
// signature_audit_log repo. Translates snake_case rows + JSON-string columns
// into the camelCase + parsed-array DTOs the IPC handlers consume.
//
// Ravi's contract (data-models.md §9.6):
//   insert(row: Omit<SignatureAuditRow, 'id' | 'created_at'>): number
//   get(id): SignatureAuditRow | null
//   listByDocHash(docHash, limit?, offset?): SignatureAuditRow[]
//   listByPreSignDocHash(preSignDocHash, limit?, offset?): SignatureAuditRow[]
//   listByFingerprint(fp, since?, until?, limit?, offset?): SignatureAuditRow[]
//   listAll(filters, limit?, offset?): { items, total }
//   delete(id): boolean
//
// The adapter parses `byte_range_json` → `byteRange: number[] | null` and
// translates snake_case → camelCase. The IPC layer never sees raw rows.
// ----------------------------------------------------------------------------

export interface RaviSignatureAuditRow {
  id: number;
  doc_hash: string;
  pre_sign_doc_hash: string;
  signed_at: number;
  signature_kind: 'visual' | 'pades' | 'pades-tsa';
  signed_by_fingerprint: string | null;
  signed_by_subject_cn: string | null;
  signed_by_issuer_cn: string | null;
  cert_not_before: number | null;
  cert_not_after: number | null;
  tsa_url: string | null;
  tsa_response_status: 'ok' | 'failed' | null;
  sig_bytes_offset: number | null;
  sig_bytes_length: number | null;
  byte_range_json: string | null;
  reason: string | null;
  location: string | null;
  field_name: string | null;
  created_at: number;
  // Phase 5 (data-models §10.10) — set by `markInvalidatedByOcrJob` when an
  // OCR run mutates page bytes on a previously-PAdES-signed doc. Null until
  // an OCR run invalidates this row. Added here Phase 7.2 7.2.4 (Diego,
  // 2026-06-10) so the read path can carry the column through to the DTO —
  // Ravi's SELECT statements already project it; the gap was only on the
  // bridge-interface side.
  invalidated_by_ocr_job_id: number | null;
  // Phase 7.4 B1 (Riley design §5.3, David 2026-06-15) — set by
  // `markInvalidatedByRedaction` (Ravi's SQL stamps via `unixepoch() * 1000`)
  // when a redaction Apply mutates page bytes on a previously-PAdES-signed
  // doc. Optional on the Ravi-row shape — tolerates older repo builds that
  // haven't yet projected the column.
  invalidated_by_redaction_at?: number | null;
}

/**
 * Mirrors Ravi's `SignatureAuditRepo` signature
 * (src/db/repositories/signature-audit-repo.ts:110).
 *
 * Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
 *   * `insert` returns a discriminated `InsertSignatureAuditResult`, not a
 *     bare `number`. The adapter unwraps to `number` (the duplicate path
 *     surfaces as `-1` so the IPC handler can branch — this preserves the
 *     bridge contract while making the failure mode explicit).
 *   * `markInvalidatedByOcrJob` takes `(rowIds: number[], ocrJobId: number)`,
 *     not `(docHash, fieldNames, ocrJobId)`. The adapter accepts the
 *     bridge's higher-level signature and resolves `rowIds` via
 *     `listByDocHash(docHash) + filter by fieldName`.
 *   * `listInvalidatedByOcrJob` is a real-repo method not previously
 *     surfaced on the bridge interface. Not currently called by any IPC
 *     handler; declared here for completeness so the audit catches future
 *     callers via type-error rather than runtime missing-method.
 */
export type RaviInsertSignatureAuditResult =
  | { ok: true; id: number }
  | { ok: false; error: 'duplicate' };

export interface RaviSignatureAuditRepo {
  insert(row: SignatureAuditInsertInput): RaviInsertSignatureAuditResult;
  get(id: number): RaviSignatureAuditRow | null;
  listByDocHash(docHash: string, limit?: number, offset?: number): RaviSignatureAuditRow[];
  listAll(
    filters: SignatureAuditListFilters,
    limit?: number,
    offset?: number,
  ): { items: RaviSignatureAuditRow[]; total: number };
  delete(id: number): boolean;
  markInvalidatedByOcrJob(rowIds: number[], ocrJobId: number): number;
  listInvalidatedByOcrJob(ocrJobId: number): RaviSignatureAuditRow[];
  // Phase 7.4 B1 (Riley design §5.3) — Ravi's signature matches the bridge's
  // higher-level shape verbatim: `(docHash, fieldNames): number`. SQL stamps
  // `unixepoch() * 1000` on matched rows internally. Optional on this
  // interface to tolerate older Ravi-repo builds during the parallel-wave
  // land (the adapter `typeof` checks for the method before forwarding).
  markInvalidatedByRedaction?(docHash: string, fieldNames: string[]): number;
}

export function adaptSignatureAuditRepo(raw: RaviSignatureAuditRepo): SignatureAuditRepoBridge {
  const parseRange = (json: string | null): number[] | null => {
    if (json === null) return null;
    try {
      const parsed = JSON.parse(json) as unknown;
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  };
  const toDto = (r: RaviSignatureAuditRow): SignatureAuditRowDto => ({
    id: r.id,
    docHash: r.doc_hash,
    preSignDocHash: r.pre_sign_doc_hash,
    signedAt: r.signed_at,
    signatureKind: r.signature_kind,
    signedByFingerprint: r.signed_by_fingerprint,
    signedBySubjectCN: r.signed_by_subject_cn,
    signedByIssuerCN: r.signed_by_issuer_cn,
    certNotBefore: r.cert_not_before,
    certNotAfter: r.cert_not_after,
    tsaUrl: r.tsa_url,
    tsaResponseStatus: r.tsa_response_status,
    sigBytesOffset: r.sig_bytes_offset,
    sigBytesLength: r.sig_bytes_length,
    byteRange: parseRange(r.byte_range_json),
    reason: r.reason,
    location: r.location,
    fieldName: r.field_name,
    createdAt: r.created_at,
    // Phase 7.2 7.2.4 (Diego, 2026-06-10) — surface the Phase-5 OCR back-ref
    // column on the DTO. `?? null` keeps the projection safe across older
    // adapter mocks that may not carry the column yet (Wave-skew defence).
    invalidatedByOcrJobId: r.invalidated_by_ocr_job_id ?? null,
    // Phase 7.4 B1 (David, 2026-06-15) — surface the new redaction back-ref
    // column. `?? null` tolerates older Ravi-repo rows that haven't yet
    // projected the column (parallel-wave skew during the Phase 7.4 B1 Wave 2
    // land).
    invalidatedByRedactionAt: r.invalidated_by_redaction_at ?? null,
  });
  return {
    insert(row) {
      // Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
      // Ravi's repo returns a discriminated union. Bridge contract is `number`
      // — unwrap. Duplicate path surfaces as `-1` (sentinel; no production
      // caller currently distinguishes, but the value is non-positive so a
      // future caller can branch without ambiguity vs valid id ≥ 1).
      const r = raw.insert(row);
      return r.ok ? r.id : -1;
    },
    get(id) {
      const r = raw.get(id);
      return r ? toDto(r) : null;
    },
    listByDocHash(docHash, limit, offset) {
      return raw.listByDocHash(docHash, limit, offset).map(toDto);
    },
    listAll(filters, limit, offset) {
      const result = raw.listAll(filters, limit, offset);
      return { items: result.items.map(toDto), total: result.total };
    },
    delete(id) {
      return raw.delete(id);
    },
    markInvalidatedByOcrJob(docHash, fieldNames, ocrJobId) {
      // Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
      // Bridge contract: `(docHash, fieldNames, ocrJobId) -> number`.
      // Ravi's repo: `(rowIds, ocrJobId) -> number`.
      // The bridge resolves rowIds by reading current rows for the doc and
      // filtering to the supplied field names. This keeps the IPC-handler
      // call site (ocr-run-on-document.ts:376) ergonomic — the OCR engine
      // knows the doc hash and field names but never sees row ids.
      //
      // Edge cases:
      //   * Empty fieldNames → no rows to mark; return 0 immediately.
      //   * Missing row.fieldName / null field_name on a row → that row is
      //     filtered out (cannot match a name we never recorded).
      //   * Over-fetch limit: defensive MAX_FETCH so a doc with hundreds of
      //     signature rows is still covered.
      if (fieldNames.length === 0) return 0;
      const MAX_FETCH = 10000;
      const rows = raw.listByDocHash(docHash, MAX_FETCH, 0);
      const set = new Set(fieldNames);
      const rowIds = rows
        .filter((r) => r.field_name !== null && set.has(r.field_name))
        .map((r) => r.id);
      if (rowIds.length === 0) return 0;
      return raw.markInvalidatedByOcrJob(rowIds, ocrJobId);
    },
    markInvalidatedByRedaction(docHash, fieldNames) {
      // Phase 7.4 B1 (David, 2026-06-15) — direct pass-through. Ravi's repo
      // signature `(docHash, fieldNames): number` matches the bridge's
      // higher-level shape verbatim (the SQL stamps the timestamp via
      // `unixepoch() * 1000` internally). The OCR sibling above needs the
      // (docHash, fieldNames) → rowIds adapter step because Ravi's OCR
      // method takes `(rowIds, ocrJobId)`; the redaction repo method
      // collapsed that lookup into SQL so no adapter work is needed here.
      //
      // Defensive: if the production Ravi repo lacks the method (parallel-
      // wave land race), we fall back to a best-effort no-op + return 0.
      // The handler-layer call site is also try/catch-wrapped so the
      // redaction Apply itself never fails on an audit-log absence.
      if (fieldNames.length === 0) return 0;
      const fn = raw.markInvalidatedByRedaction;
      if (typeof fn !== 'function') return 0;
      return fn.call(raw, docHash, fieldNames);
    },
  };
}

// ----------------------------------------------------------------------------
// Phase 5 (data-models.md §10.9): adapters for Ravi's SQLite OCR repos.
// Mirrors adaptSignatureAuditRepo. Translates snake_case rows ↔ camelCase
// DTOs. Ravi's interfaces are duck-typed at the boundary because David's
// bridge module must not import from src/db (file-ownership boundary).
// ----------------------------------------------------------------------------

export interface RaviOcrJobRow {
  id: number;
  doc_hash: string;
  page_range_start: number;
  page_range_end: number;
  langs: string;
  preprocess_json: string;
  status: OcrJobBridgeStatus;
  started_at: number;
  completed_at: number | null;
  mean_confidence: number | null;
  total_words: number | null;
  error_message: string | null;
  invalidated_signatures: 0 | 1;
  created_at: number;
}

/**
 * Mirrors Ravi's `OcrJobsRepo` signature (src/db/repositories/ocr-jobs-repo.ts:108).
 *
 * Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix. The previous shape of
 * this interface was authored against an older repo signature where
 * `updateStatus` took six positional args and `listAll` returned
 * `{items, total}`. Ravi's Phase 5.2 commit f0715f8 evolved both:
 *   * `updateStatus(id, { status, ... })` — one object payload, COALESCE-pattern.
 *   * `listAll(filters, limit, offset): OcrJobRow[]` — plain row array.
 *   * `countAll(filters): number` — paired total.
 *
 * The dynamic-require gap in `src/main/index.ts` Wave 12..24 silently fell
 * through to the memory bridge under `_electron.launch()`, so the drift went
 * undetected until the Item A-1 static-import lift connected the adapter to
 * the real SQLite repo for the first time.
 *
 * Adapter behaviour:
 *   * `updateStatus` forwards the object payload verbatim (modulo undefined
 *     filtering — Ravi's COALESCE pattern interprets `undefined` as "don't
 *     touch this column"; the adapter passes through unchanged).
 *   * `listAll` calls Ravi's `listAll` + `countAll` and assembles
 *     `{items, total}` — the bridge contract stays stable for IPC handlers.
 *   * `filters` is camelCase (`docHash`) at the bridge; Ravi's repo is
 *     snake_case (`doc_hash`); the adapter translates one field name.
 */
export interface RaviOcrJobsRepo {
  insert(row: {
    doc_hash: string;
    page_range_start: number;
    page_range_end: number;
    langs: string;
    preprocess_json: string;
    status: OcrJobBridgeStatus;
    started_at: number;
    invalidated_signatures: 0 | 1;
  }): number;
  updateStatus(
    id: number,
    input: {
      status: OcrJobBridgeStatus;
      completed_at?: number;
      mean_confidence?: number;
      total_words?: number;
      error_message?: string;
    },
  ): boolean;
  get(id: number): RaviOcrJobRow | null;
  listAll(
    filters: {
      doc_hash?: string;
      status?: OcrJobBridgeStatus;
      since?: number;
      until?: number;
    },
    limit?: number,
    offset?: number,
  ): RaviOcrJobRow[];
  countAll(filters: {
    doc_hash?: string;
    status?: OcrJobBridgeStatus;
    since?: number;
    until?: number;
  }): number;
  delete(id: number): boolean;
}

function ocrJobRowToDto(r: RaviOcrJobRow): OcrJobRowDto {
  return {
    id: r.id,
    docHash: r.doc_hash,
    pageRangeStart: r.page_range_start,
    pageRangeEnd: r.page_range_end,
    langs: r.langs,
    preprocessJson: r.preprocess_json,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    meanConfidence: r.mean_confidence,
    totalWords: r.total_words,
    errorMessage: r.error_message,
    invalidatedSignatures: r.invalidated_signatures === 1,
    createdAt: r.created_at,
  };
}

export function adaptOcrJobsRepo(raw: RaviOcrJobsRepo): OcrJobsRepoBridge {
  return {
    insert(row) {
      return raw.insert(row);
    },
    updateStatus(id, update) {
      // Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
      // Ravi's repo accepts a single object payload (UpdateOcrJobStatusInput)
      // mirroring `data-models §10.9` and the COALESCE-pattern UPDATE in
      // ocr-jobs-repo.ts:208-230. The bridge contract already accepts an
      // object; pass through verbatim. Earlier versions of this adapter
      // forwarded six positional args, which evaluated `assertOcrStatus`
      // against the wrong arg and threw "status must be one of … (got
      // undefined)" — the e2e Phase B abort signature.
      return raw.updateStatus(id, {
        status: update.status,
        ...(update.completed_at !== undefined ? { completed_at: update.completed_at } : {}),
        ...(update.mean_confidence !== undefined
          ? { mean_confidence: update.mean_confidence }
          : {}),
        ...(update.total_words !== undefined ? { total_words: update.total_words } : {}),
        ...(update.error_message !== undefined ? { error_message: update.error_message } : {}),
      });
    },
    get(id) {
      const r = raw.get(id);
      return r ? ocrJobRowToDto(r) : null;
    },
    listAll(filters, limit, offset) {
      // Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
      // Ravi's `listAll` returns `OcrJobRow[]`; the paired total is computed
      // by `countAll(filters)`. The bridge contract returns `{items, total}`
      // for the IPC handler's pagination UI; assemble it here.
      const raviFilters: {
        doc_hash?: string;
        status?: OcrJobBridgeStatus;
        since?: number;
        until?: number;
      } = {
        ...(filters.docHash !== undefined ? { doc_hash: filters.docHash } : {}),
        ...(filters.status !== undefined ? { status: filters.status } : {}),
        ...(filters.since !== undefined ? { since: filters.since } : {}),
        ...(filters.until !== undefined ? { until: filters.until } : {}),
      };
      const items = raw.listAll(raviFilters, limit, offset);
      const total = raw.countAll(raviFilters);
      return { items: items.map(ocrJobRowToDto), total };
    },
    delete(id) {
      return raw.delete(id);
    },
  };
}

export interface RaviOcrResultRow {
  id: number;
  job_id: number;
  page_index: number;
  total_words: number;
  low_confidence_words: number;
  mean_confidence: number;
  words_json: string;
  img_width_px: number;
  img_height_px: number;
  duration_ms: number;
  created_at: number;
}

/**
 * Mirrors Ravi's `OcrResultsRepo` signature
 * (src/db/repositories/ocr-results-repo.ts:79).
 *
 * Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
 *   * `insert` returns `InsertOcrResultResult` (discriminated). The bridge
 *     adapter calls Ravi's `upsert` instead — same idempotency story as
 *     the OCR engine's between-page restart path (ocr-engine §7.4) and
 *     skips the duplicate-error branch entirely. The bridge contract
 *     remains `insert(row): number`.
 */
export interface RaviOcrResultsRepo {
  insert(row: {
    job_id: number;
    page_index: number;
    total_words: number;
    low_confidence_words: number;
    mean_confidence: number;
    words_json: string;
    img_width_px: number;
    img_height_px: number;
    duration_ms: number;
  }): { ok: true; id: number } | { ok: false; error: 'duplicate' };
  upsert(row: {
    job_id: number;
    page_index: number;
    total_words: number;
    low_confidence_words: number;
    mean_confidence: number;
    words_json: string;
    img_width_px: number;
    img_height_px: number;
    duration_ms: number;
  }): number;
  listByJobId(jobId: number): RaviOcrResultRow[];
}

function ocrResultRowToDto(r: RaviOcrResultRow): OcrResultRowDto {
  return {
    id: r.id,
    jobId: r.job_id,
    pageIndex: r.page_index,
    totalWords: r.total_words,
    lowConfidenceWords: r.low_confidence_words,
    meanConfidence: r.mean_confidence,
    wordsJson: r.words_json,
    imgWidthPx: r.img_width_px,
    imgHeightPx: r.img_height_px,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  };
}

export function adaptOcrResultsRepo(raw: RaviOcrResultsRepo): OcrResultsRepoBridge {
  return {
    insert(row) {
      // Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
      // Ravi's `insert` returns a discriminated `InsertOcrResultResult`
      // (the `duplicate` variant surfaces UNIQUE(job_id, page_index) collisions).
      // The bridge contract says `number`, and the IPC handler discards the
      // return — so we use Ravi's `upsert` here, which is idempotent under
      // retry (between-page restart in ocr-engine §7.4) and returns `number`
      // unconditionally. This is a strict improvement: under the previous
      // dynamic-require gap the handler was talking to the memory repo's
      // plain-number `insert`; calling `upsert` against Ravi's SQLite now
      // restores that semantic.
      return raw.upsert(row);
    },
    listByJobId(jobId) {
      return raw.listByJobId(jobId).map(ocrResultRowToDto);
    },
    // Phase 5.2 (Marcus, 2026-06-04): same parse-and-assemble as the
    // memory-backed repo, run against Ravi's SQLite-backed rows.
    listPageResultsByJobId(jobId) {
      return assemblePageResultsFromRows(raw.listByJobId(jobId).map(ocrResultRowToDto));
    },
  };
}

export interface RaviLanguagePackRow {
  lang: string;
  source: 'bundled' | 'downloaded';
  file_path: string;
  size_bytes: number;
  sha256: string;
  installed_at: number;
  last_used_at: number | null;
}

/**
 * Mirrors Ravi's `LanguagePacksRepo` signature
 * (src/db/repositories/language-packs-repo.ts:67).
 *
 * Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
 *   * `remove` returns a discriminated `RemoveLanguagePackResult`
 *     (`{ok: true} | {ok: false, error: 'bundled_protected' | 'not_found'}`).
 *     The bridge contract is `boolean`; the adapter unwraps to `r.ok`. This
 *     collapses the `bundled_protected` variant into a generic "false" — the
 *     IPC handler `ocr-language-pack-remove` discards the boolean today
 *     (best-effort) so the loss is contained. A future widening of the
 *     bridge contract should pass the discriminated union through, but
 *     that's outside this remediation's scope.
 *   * `touchLastUsed` returns `boolean` (true iff the row exists). Bridge
 *     contract is `void`; the adapter swallows the return.
 *   * `upsert` accepts an optional `last_used_at` per Ravi's
 *     `UpsertLanguagePackInput`. The bridge always passes one (the OCR
 *     handler tracks it), so the optionality is benign here.
 */
export type RaviRemoveLanguagePackResult =
  | { ok: true }
  | { ok: false; error: 'bundled_protected' | 'not_found' };

export interface RaviLanguagePacksRepo {
  upsert(row: {
    lang: string;
    source: 'bundled' | 'downloaded';
    file_path: string;
    size_bytes: number;
    sha256: string;
    installed_at: number;
    last_used_at?: number | null;
  }): void;
  list(): RaviLanguagePackRow[];
  get(lang: string): RaviLanguagePackRow | null;
  remove(lang: string): RaviRemoveLanguagePackResult;
  touchLastUsed(lang: string, when: number): boolean;
}

function languagePackRowToDto(r: RaviLanguagePackRow): LanguagePackRowDto {
  return {
    lang: r.lang,
    source: r.source,
    filePath: r.file_path,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    installedAt: r.installed_at,
    lastUsedAt: r.last_used_at,
  };
}

export function adaptLanguagePacksRepo(raw: RaviLanguagePacksRepo): LanguagePacksRepoBridge {
  return {
    upsert(row) {
      raw.upsert(row);
    },
    list() {
      return raw.list().map(languagePackRowToDto);
    },
    get(lang) {
      const r = raw.get(lang);
      return r ? languagePackRowToDto(r) : null;
    },
    remove(lang) {
      // Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
      // Ravi's repo returns a discriminated `RemoveLanguagePackResult`.
      // Bridge contract is `boolean`; unwrap to `r.ok`.
      return raw.remove(lang).ok;
    },
    touchLastUsed(lang, when) {
      // Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
      // Ravi's `touchLastUsed` returns boolean (true iff the row exists);
      // bridge contract is `void`. Swallow the return.
      raw.touchLastUsed(lang, when);
    },
  };
}

// ----------------------------------------------------------------------------
// Phase 6 (data-models.md §11.7): adapter for Ravi's export_jobs SQLite repo.
// Translates Ravi's snake_case rows and the DTO shape consumed by the
// renderer's Exports sidebar tab (which sees `ExportJobRowDto`, NOT raw
// snake_case rows; outputPath stripped to basename + dirHint).
//
// Ravi's contract (mirrors data-models.md §11.7):
//   insert(row): number
//   updateStatus(id, update): boolean
//   updateProgress(id, pagesProcessed, extras?): boolean
//   get(id): ExportJobRow | null
//   listByDocHash(docHash, limit?, offset?): ExportJobRow[]
//   listByStatus(status, limit?, offset?): ExportJobRow[]
//   listRecent(limit?): ExportJobRow[]
//   delete(id): boolean
// ----------------------------------------------------------------------------

export interface RaviExportJobRow {
  id: number;
  doc_hash: string;
  format: ExportFormatBridge;
  quality_tier: 'text-only' | 'layout-preserving' | 'n/a';
  page_range_start: number;
  page_range_end: number;
  include_annotations: 0 | 1;
  dpi: number | null;
  jpeg_quality: number | null;
  multi_page_tiff: 0 | 1 | null;
  output_path: string;
  output_size_bytes: number | null;
  status: ExportJobBridgeStatus;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  pages_processed: number;
  paragraphs_extracted: number | null;
  tables_detected: number | null;
  images_embedded: number | null;
  error_message: string | null;
  created_at: number;
}

/**
 * Mirrors Ravi's `ExportJobsRepo` signature (src/db/repositories/export-jobs-repo.ts:165).
 *
 * Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix. The previous shape of
 * this interface declared a `listAll(filters, limit, offset): {items, total}`
 * method that DOES NOT EXIST on Ravi's real repo. The real surface exposes
 * single-axis list methods (`listByDocHash`, `listByStatus`, `listRecent`,
 * `listInProgress`). The dynamic-require gap hid the drift because the
 * memory bridge provided a `listAll` that matched the bridge's contract.
 *
 * The `updateProgress` parameter is also a snake_case object on Ravi's repo
 * (`UpdateExportJobProgressInput { pages_processed, ... }`), not three
 * positional args — earlier drift class.
 *
 * `output_size_bytes` is a top-level field on `UpdateExportJobStatusInput`
 * (Ravi accepts it on the status payload, NOT only on progress).
 *
 * Adapter behaviour:
 *   * `listAll` emulates the bridge contract by reading via the most-
 *     specific available filter method (`listByDocHash` or `listByStatus`
 *     when those are the only constraints; `listRecent` when neither;
 *     `listInProgress` when status filter is queued|running), then
 *     in-memory filtering by the remaining filters and computing `total`
 *     from the post-filter set length. Export jobs are a low-volume
 *     surface (single-digit per session); the in-memory step is cheap.
 *   * `updateProgress` translates positional → object input.
 */
export interface RaviExportJobsRepo {
  insert(row: {
    doc_hash: string;
    format: ExportFormatBridge;
    quality_tier: 'text-only' | 'layout-preserving' | 'n/a';
    page_range_start: number;
    page_range_end: number;
    include_annotations: 0 | 1;
    dpi: number | null;
    jpeg_quality: number | null;
    multi_page_tiff: 0 | 1 | null;
    output_path: string;
    status: 'queued';
    started_at: number;
  }): number;
  updateStatus(
    id: number,
    update: {
      status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
      completed_at?: number;
      duration_ms?: number;
      output_size_bytes?: number;
      error_message?: string;
    },
  ): boolean;
  updateProgress(
    id: number,
    input: {
      pages_processed: number;
      paragraphs_extracted?: number;
      tables_detected?: number;
      images_embedded?: number;
      output_size_bytes?: number;
    },
  ): boolean;
  get(id: number): RaviExportJobRow | null;
  listByDocHash(docHash: string, limit?: number, offset?: number): RaviExportJobRow[];
  listByStatus(status: ExportJobBridgeStatus, limit?: number, offset?: number): RaviExportJobRow[];
  listRecent(limit?: number): RaviExportJobRow[];
  listInProgress(): RaviExportJobRow[];
  delete(id: number): boolean;
}

export function adaptExportJobsRepo(raw: RaviExportJobsRepo): ExportJobsRepoBridge {
  return {
    insert(row) {
      return raw.insert(row);
    },
    updateStatus(id, update) {
      return raw.updateStatus(id, update);
    },
    updateProgress(id, pagesProcessed, extras) {
      // Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
      // Ravi's repo accepts a single object input
      // (UpdateExportJobProgressInput); earlier shape took positional args.
      return raw.updateProgress(id, {
        pages_processed: pagesProcessed,
        ...(extras?.paragraphsExtracted !== undefined
          ? { paragraphs_extracted: extras.paragraphsExtracted }
          : {}),
        ...(extras?.tablesDetected !== undefined ? { tables_detected: extras.tablesDetected } : {}),
        ...(extras?.imagesEmbedded !== undefined ? { images_embedded: extras.imagesEmbedded } : {}),
        ...(extras?.outputSizeBytes !== undefined
          ? { output_size_bytes: extras.outputSizeBytes }
          : {}),
      });
    },
    get(id) {
      return raw.get(id);
    },
    listAll(filters, limit, offset) {
      // Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix.
      // Ravi's repo has NO `listAll(filters)` method. It exposes single-axis
      // list methods. The bridge contract for IPC requires a paginated
      // {items, total} shape with multi-axis filtering, so the adapter
      // assembles it:
      //   1. Pick the most specific upstream method given the filter set.
      //   2. Apply remaining filters in-memory.
      //   3. Total is the post-filter set length; slice for limit/offset.
      // Export jobs are a low-volume surface (single-digit per session,
      // bounded by user actions); in-memory filtering is cheap.
      //
      // We over-fetch (`MAX_LIMIT`) from the chosen method to ensure the
      // multi-filter intersection is complete before slicing.
      const MAX_FETCH = 10000;
      let candidates: RaviExportJobRow[];
      if (filters.docHash !== undefined) {
        candidates = raw.listByDocHash(filters.docHash, MAX_FETCH, 0);
      } else if (
        filters.status !== undefined &&
        (filters.status === 'queued' || filters.status === 'running')
      ) {
        // Optimisation: listInProgress is the queued+running union.
        candidates = raw.listInProgress();
      } else if (filters.status !== undefined) {
        candidates = raw.listByStatus(filters.status, MAX_FETCH, 0);
      } else {
        candidates = raw.listRecent(MAX_FETCH);
      }
      const filtered = candidates.filter((r) => {
        if (filters.docHash !== undefined && r.doc_hash !== filters.docHash) return false;
        if (filters.format !== undefined && r.format !== filters.format) return false;
        if (filters.status !== undefined && r.status !== filters.status) return false;
        if (filters.since !== undefined && r.started_at < filters.since) return false;
        if (filters.until !== undefined && r.started_at > filters.until) return false;
        return true;
      });
      // Ravi's single-axis methods already return started_at DESC, id ASC —
      // but `listInProgress` mixes queued + running; sort here defensively
      // so the slice is deterministic regardless of source method.
      filtered.sort((a, b) => b.started_at - a.started_at || a.id - b.id);
      const items = filtered.slice(offset, offset + limit);
      return { items, total: filtered.length };
    },
    delete(id) {
      return raw.delete(id);
    },
  };
}

// ----------------------------------------------------------------------------
// Active bridge — module-scope singleton. Production code calls setDbBridge()
// once at app startup with Ravi's real repos. Tests can swap freely.
// ----------------------------------------------------------------------------

let activeBridge: DbBridge = createMemoryDbBridge();

/**
 * Phase 7.2 (David, 2026-06-10) — bridge-introspection tag map.
 *
 * For each of the six Phase-3..6 repo slots, records whether the slot was
 * populated with the SQLite-backed factory or fell back to the memory bridge
 * (e.g. the factory threw at construction time). The `__test:whichBridge`
 * IPC handler (test-only, NODE_ENV==='test') reads this map and reports it
 * to the e2e spec so the test can assert "all six are 'sqlite' under
 * `_electron.launch()`" — i.e. the static-import lift in `src/main/index.ts`
 * actually put the repos into the bundle.
 *
 * `null` reflects the pre-`setDbBridge` boot state (or a test fixture that
 * called `setDbBridge` without supplying kinds — the memory bridge is still
 * active, but no introspection happened). The handler treats a null map as
 * `bridge_not_initialized`.
 *
 * Riley's design (`docs/phase-7.2-test-design.md §2.6`) specifies:
 *   "David adds a tiny tag at construction (`{kind, repo}`) read by the probe."
 * The tag is the `'sqlite' | 'memory'` enum below; the `repo` is the live
 * instance already wired into `DbBridge` — no need to duplicate it here.
 */
export type DbBridgeKind = 'sqlite' | 'memory';

export interface DbBridgeKinds {
  formTemplates: DbBridgeKind;
  signatureAudit: DbBridgeKind;
  ocrJobs: DbBridgeKind;
  ocrResults: DbBridgeKind;
  languagePacks: DbBridgeKind;
  exportJobs: DbBridgeKind;
}

let activeBridgeKinds: DbBridgeKinds | null = null;

export function setDbBridge(bridge: DbBridge, kinds?: DbBridgeKinds): void {
  activeBridge = bridge;
  if (kinds !== undefined) activeBridgeKinds = kinds;
}

export function getDbBridge(): DbBridge {
  return activeBridge;
}

/** Returns the per-slot SQLite/memory tag map, or null if `setDbBridge` was
 *  never called with a `kinds` argument. Used exclusively by the test-only
 *  `__test:whichBridge` IPC handler. */
export function getDbBridgeKinds(): DbBridgeKinds | null {
  return activeBridgeKinds;
}
