// Export-jobs repository.
//
// Backs the `export:to*`, `export:listJobs`, `export:cancel`, `export:getJob`
// IPC channels (docs/api-contracts.md §17 + docs/architecture-phase-6.md §4.5)
// and the export_jobs table (docs/data-models.md §11.2 + §11.5 + §11.7).
//
// Lifecycle (architecture-phase-6.md §4.5, export-engine.md §8):
//   queued    -> running (worker dequeues)
//   running   -> completed | cancelled | failed
//
// No `superseded_by_undo` value — export is read-only on source (conventions
// §17.1); export does NOT produce an EditOperation (data-models §11.4).
//
// Method surface (data-models §11.7):
//   * insert(row)               — returns new id
//   * get(id)                   — single row, or null
//   * updateStatus(...)         — terminal-status writes + watermark cols
//   * updateProgress(...)       — pages_processed + optional content stats
//   * listByDocHash(...)        — Exports sidebar "this file"
//   * listByStatus(...)         — "running" / "failed" surfaces
//   * listRecent(limit)         — most-recent N, ordered started_at DESC
//   * delete(id)                — user cleanup; NO cascade (FK-less table)
//
// Extension surface beyond §11.7 (same precedent as bookmarks Wave 7 `move()`,
// form-templates Wave 12 `upsert()`, ocr-results Wave 20 `upsert()` — the
// doc is the floor, never the ceiling):
//   * markRunning(id)           — queued -> running transition
//   * markCompleted(id, ...)    — running -> completed (sets completed_at +
//                                 duration_ms + output_size_bytes + stats)
//   * markCancelled(id, ...)    — running -> cancelled
//   * markFailed(id, msg)       — running -> failed (truncates msg to 2048)
//   * listInProgress()          — queued + running union, ordered started_at
//                                 DESC. The Exports sidebar "in progress"
//                                 surface reads this directly without two
//                                 separate listByStatus calls.
//
// IMPORTANT BOUNDARY DISCIPLINE (conventions §17.2): `output_path` is
// MAIN-ONLY. The bridge MUST strip this column when building the
// renderer-facing DTO (data-models §11.5 — `outputBasename` + `outputDirHint`
// replace the absolute path). The repo surfaces the raw column (main-process
// callers need it for fs.unlink on cancel, output reveal, etc.).
//
// IMPORTANT FK POSTURE: `export_jobs` has NO foreign keys (data-models §11.8).
// `doc_hash` is a soft reference; exports survive deletion of the doc's
// bookmarks / OCR jobs / signature audit rows. `delete()` does NOT cascade.
//
// IMPORTANT TAMPER POSTURE (mirror data-models §10.4.3): the export_jobs
// table lives in the same SQLite file as every other repo. Any process with
// write access can forge rows. Phase 6 makes NO claim that this log is
// tamper-evident; it's a convenience surface, not a notarization service.

import type BetterSqlite3 from 'better-sqlite3';

import type { ExportFormat, ExportJobRow, ExportJobStatus, ExportQualityTier } from '../types';

// ============================================================
// Public shape
// ============================================================

/**
 * Insert payload. The bridge supplies every audited field except `id`
 * (autoincrement) and `created_at` (defaulted to Date.now()).
 *
 * Nullable late-init columns (`completed_at`, `duration_ms`,
 * `output_size_bytes`, `paragraphs_extracted`, `tables_detected`,
 * `images_embedded`, `error_message`) default to null on insert. Per the
 * Phase 4.1.1 sentinel-default lesson + Phase 5 reaffirmation + Phase 6
 * conventions §17.4.2, callers MUST NOT pass `-1` / `0` as a "not yet
 * known" sentinel — pass `null` and update later via `updateStatus` or
 * `updateProgress`.
 *
 * Format-conditional fields (data-models §11.9):
 *   * `dpi`             — non-null iff format ∈ {png, jpeg, tiff}
 *   * `jpeg_quality`    — non-null iff format='jpeg'
 *   * `multi_page_tiff` — non-null iff format='tiff'
 *
 * These cross-field invariants are enforced at the IPC handler boundary
 * (David's zod schema in `src/main/ipc/handlers/export-*.ts`); the repo
 * does shape-only validation here (numeric range / non-empty string /
 * enum membership) — same belt-and-suspenders posture as Phase 5.
 */
export interface InsertExportJobInput {
  doc_hash: string;
  format: ExportFormat;
  quality_tier: ExportQualityTier;
  page_range_start: number;
  page_range_end: number;
  /** 0/1; bridge converts from boolean before insert. */
  include_annotations: 0 | 1;
  /** Image-format-only; null for office formats. */
  dpi?: number | null;
  /** JPEG-only. */
  jpeg_quality?: number | null;
  /** TIFF-only. */
  multi_page_tiff?: 0 | 1 | null;
  /** Absolute path on disk. Main-only — never echoed across IPC. */
  output_path: string;
  status: ExportJobStatus;
  started_at: number;
  /** Late-init defaults. Pass null (or omit) for "not yet known". */
  completed_at?: number | null;
  duration_ms?: number | null;
  output_size_bytes?: number | null;
  pages_processed?: number;
  paragraphs_extracted?: number | null;
  tables_detected?: number | null;
  images_embedded?: number | null;
  error_message?: string | null;
  /** Optional override; defaults to Date.now() at insert time. */
  created_at?: number;
}

/**
 * Status-update payload. Every field except `status` is optional — only the
 * supplied fields are written. The repo uses an explicit COALESCE-style
 * pattern (same as ocr-jobs Wave 20) so a caller updating ONLY
 * `error_message` doesn't accidentally stomp a previously-set
 * `output_size_bytes`.
 *
 * Use cases:
 *   * queued -> running: status only
 *   * running -> completed: status + completed_at + duration_ms + output_size_bytes (+ content stats via updateProgress)
 *   * running -> failed: status + completed_at + duration_ms + error_message
 *   * running -> cancelled: status + completed_at + duration_ms
 */
export interface UpdateExportJobStatusInput {
  status: ExportJobStatus;
  completed_at?: number;
  duration_ms?: number;
  output_size_bytes?: number;
  error_message?: string;
}

/**
 * Progress-update payload — bumps `pages_processed` + optional content
 * stats. Same COALESCE pattern as `updateStatus`. Called from the
 * per-page completion callback (export-engine §3.3).
 */
export interface UpdateExportJobProgressInput {
  pages_processed: number;
  paragraphs_extracted?: number;
  tables_detected?: number;
  images_embedded?: number;
  output_size_bytes?: number;
}

/**
 * mark* convenience inputs. Same fields as the corresponding status
 * transitions; named overloads for ergonomics at the bridge.
 */
export interface MarkCompletedInput {
  completed_at: number;
  duration_ms: number;
  output_size_bytes: number;
  paragraphs_extracted?: number;
  tables_detected?: number;
  images_embedded?: number;
}

export interface MarkCancelledInput {
  completed_at: number;
  duration_ms: number;
}

export interface ExportJobsRepo {
  /** Insert a new job row. Returns the new id. */
  insert(input: InsertExportJobInput): number;

  /** Lookup by primary key. Null if not found. */
  get(id: number): ExportJobRow | null;

  /**
   * Update the status + watermark columns. Returns true if the row exists
   * and was updated.
   */
  updateStatus(id: number, input: UpdateExportJobStatusInput): boolean;

  /**
   * Update progress columns (pages_processed + optional content stats).
   * Returns true if the row exists and was updated.
   */
  updateProgress(id: number, input: UpdateExportJobProgressInput): boolean;

  /** Filter by doc_hash. Ordered started_at DESC, id ASC tiebreak. */
  listByDocHash(docHash: string, limit?: number, offset?: number): ExportJobRow[];

  /** Filter by lifecycle status. Ordered started_at DESC, id ASC tiebreak. */
  listByStatus(status: ExportJobStatus, limit?: number, offset?: number): ExportJobRow[];

  /**
   * Most-recent N jobs across all docs + statuses. Ordered started_at DESC,
   * id ASC tiebreak. Drives the global "Exports" sidebar tab.
   */
  listRecent(limit?: number): ExportJobRow[];

  /**
   * Union of queued + running rows. Ordered started_at DESC, id ASC tiebreak.
   * Convenience for the "in progress" sidebar surface; avoids two
   * listByStatus calls + a renderer-side merge.
   */
  listInProgress(): ExportJobRow[];

  /** queued -> running transition (convenience over updateStatus). */
  markRunning(id: number): boolean;

  /** running -> completed (convenience; sets terminal watermark fields). */
  markCompleted(id: number, input: MarkCompletedInput): boolean;

  /** running -> cancelled (convenience). */
  markCancelled(id: number, input: MarkCancelledInput): boolean;

  /**
   * running -> failed (convenience). Truncates `errorMessage` to 2048 chars
   * per data-models §11.9.
   */
  markFailed(id: number, errorMessage: string, completedAt: number, durationMs: number): boolean;

  /** Delete by id. Returns true if a row was removed. No cascade (FK-less). */
  delete(id: number): boolean;
}

// ============================================================
// Factory
// ============================================================

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 10000;
const MAX_ERROR_MESSAGE_LENGTH = 2048;

const VALID_STATUSES: readonly ExportJobStatus[] = [
  'queued',
  'running',
  'completed',
  'cancelled',
  'failed',
] as const;

const VALID_FORMATS: readonly ExportFormat[] = [
  'docx',
  'xlsx',
  'pptx',
  'png',
  'jpeg',
  'tiff',
] as const;

const VALID_QUALITY_TIERS: readonly ExportQualityTier[] = [
  'text-only',
  'layout-preserving',
  'n/a',
] as const;

export function createExportJobsRepo(db: BetterSqlite3.Database): ExportJobsRepo {
  // ---- Prepared statements (data-models §5: cache once per repo).

  const insertStmt = db.prepare<{
    doc_hash: string;
    format: string;
    quality_tier: string;
    page_range_start: number;
    page_range_end: number;
    include_annotations: 0 | 1;
    dpi: number | null;
    jpeg_quality: number | null;
    multi_page_tiff: 0 | 1 | null;
    output_path: string;
    output_size_bytes: number | null;
    status: string;
    started_at: number;
    completed_at: number | null;
    duration_ms: number | null;
    pages_processed: number;
    paragraphs_extracted: number | null;
    tables_detected: number | null;
    images_embedded: number | null;
    error_message: string | null;
    created_at: number;
  }>(
    `INSERT INTO export_jobs
        (doc_hash, format, quality_tier, page_range_start, page_range_end,
         include_annotations, dpi, jpeg_quality, multi_page_tiff,
         output_path, output_size_bytes, status, started_at, completed_at,
         duration_ms, pages_processed, paragraphs_extracted,
         tables_detected, images_embedded, error_message, created_at)
      VALUES
        (@doc_hash, @format, @quality_tier, @page_range_start, @page_range_end,
         @include_annotations, @dpi, @jpeg_quality, @multi_page_tiff,
         @output_path, @output_size_bytes, @status, @started_at, @completed_at,
         @duration_ms, @pages_processed, @paragraphs_extracted,
         @tables_detected, @images_embedded, @error_message, @created_at)`,
  );

  const SELECT_COLUMNS = `
    id, doc_hash, format, quality_tier, page_range_start, page_range_end,
    include_annotations, dpi, jpeg_quality, multi_page_tiff,
    output_path, output_size_bytes, status, started_at, completed_at,
    duration_ms, pages_processed, paragraphs_extracted, tables_detected,
    images_embedded, error_message, created_at
  `;

  const getStmt = db.prepare<{ id: number }, ExportJobRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM export_jobs
      WHERE id = @id
      LIMIT 1`,
  );

  // updateStatus uses the same CASE-WHEN-supplied COALESCE pattern as
  // ocr-jobs Wave 20. Each field has a `*_supplied` 0/1 flag; when 0,
  // CASE picks the existing column value; when 1, it picks the new value.
  // One prepared statement covers every transition.
  const updateStatusStmt = db.prepare<{
    id: number;
    status: string;
    completed_at: number;
    completed_at_supplied: number;
    duration_ms: number;
    duration_ms_supplied: number;
    output_size_bytes: number;
    output_size_bytes_supplied: number;
    error_message: string;
    error_message_supplied: number;
  }>(
    `UPDATE export_jobs
        SET status            = @status,
            completed_at      = CASE WHEN @completed_at_supplied = 1
                                     THEN @completed_at ELSE completed_at END,
            duration_ms       = CASE WHEN @duration_ms_supplied = 1
                                     THEN @duration_ms ELSE duration_ms END,
            output_size_bytes = CASE WHEN @output_size_bytes_supplied = 1
                                     THEN @output_size_bytes ELSE output_size_bytes END,
            error_message     = CASE WHEN @error_message_supplied = 1
                                     THEN @error_message ELSE error_message END
      WHERE id = @id`,
  );

  const updateProgressStmt = db.prepare<{
    id: number;
    pages_processed: number;
    paragraphs_extracted: number;
    paragraphs_extracted_supplied: number;
    tables_detected: number;
    tables_detected_supplied: number;
    images_embedded: number;
    images_embedded_supplied: number;
    output_size_bytes: number;
    output_size_bytes_supplied: number;
  }>(
    `UPDATE export_jobs
        SET pages_processed      = @pages_processed,
            paragraphs_extracted = CASE WHEN @paragraphs_extracted_supplied = 1
                                        THEN @paragraphs_extracted
                                        ELSE paragraphs_extracted END,
            tables_detected      = CASE WHEN @tables_detected_supplied = 1
                                        THEN @tables_detected
                                        ELSE tables_detected END,
            images_embedded      = CASE WHEN @images_embedded_supplied = 1
                                        THEN @images_embedded
                                        ELSE images_embedded END,
            output_size_bytes    = CASE WHEN @output_size_bytes_supplied = 1
                                        THEN @output_size_bytes
                                        ELSE output_size_bytes END
      WHERE id = @id`,
  );

  const listByDocHashStmt = db.prepare<
    { doc_hash: string; limit: number; offset: number },
    ExportJobRow
  >(
    `SELECT ${SELECT_COLUMNS}
       FROM export_jobs
      WHERE doc_hash = @doc_hash
      ORDER BY started_at DESC, id ASC
      LIMIT @limit OFFSET @offset`,
  );

  const listByStatusStmt = db.prepare<
    { status: string; limit: number; offset: number },
    ExportJobRow
  >(
    `SELECT ${SELECT_COLUMNS}
       FROM export_jobs
      WHERE status = @status
      ORDER BY started_at DESC, id ASC
      LIMIT @limit OFFSET @offset`,
  );

  const listRecentStmt = db.prepare<{ limit: number }, ExportJobRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM export_jobs
      ORDER BY started_at DESC, id ASC
      LIMIT @limit`,
  );

  const listInProgressStmt = db.prepare<[], ExportJobRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM export_jobs
      WHERE status IN ('queued', 'running')
      ORDER BY started_at DESC, id ASC`,
  );

  const deleteStmt = db.prepare<{ id: number }>(`DELETE FROM export_jobs WHERE id = @id`);

  // ----- Implementation -----

  const doUpdateStatus = (id: number, input: UpdateExportJobStatusInput): boolean => {
    assertValidId(id, 'id');
    assertExportStatus(input.status);

    const completedSupplied = input.completed_at !== undefined ? 1 : 0;
    const durationSupplied = input.duration_ms !== undefined ? 1 : 0;
    const sizeSupplied = input.output_size_bytes !== undefined ? 1 : 0;
    const errorSupplied = input.error_message !== undefined ? 1 : 0;

    if (completedSupplied) {
      assertValidTimestamp(input.completed_at ?? 0, 'completed_at');
    }
    if (durationSupplied) {
      assertNonNegativeInt(input.duration_ms ?? 0, 'duration_ms');
    }
    if (sizeSupplied) {
      assertNonNegativeInt(input.output_size_bytes ?? 0, 'output_size_bytes');
    }

    const truncatedError = errorSupplied ? truncateErrorMessage(input.error_message ?? '') : '';

    const result = updateStatusStmt.run({
      id,
      status: input.status,
      completed_at: input.completed_at ?? 0,
      completed_at_supplied: completedSupplied,
      duration_ms: input.duration_ms ?? 0,
      duration_ms_supplied: durationSupplied,
      output_size_bytes: input.output_size_bytes ?? 0,
      output_size_bytes_supplied: sizeSupplied,
      error_message: truncatedError,
      error_message_supplied: errorSupplied,
    });
    return result.changes > 0;
  };

  return {
    insert(input: InsertExportJobInput): number {
      assertNonEmptyString(input.doc_hash, 'doc_hash');
      assertNonEmptyString(input.output_path, 'output_path');
      assertExportFormat(input.format);
      assertExportQualityTier(input.quality_tier);
      assertExportStatus(input.status);
      assertPageIndex(input.page_range_start, 'page_range_start');
      assertPageIndex(input.page_range_end, 'page_range_end');
      assertOrderedRange(input.page_range_start, input.page_range_end);
      assertValidTimestamp(input.started_at, 'started_at');
      assertIncludeAnnotationsFlag(input.include_annotations);
      assertOptionalDpi(input.dpi ?? null);
      assertOptionalJpegQuality(input.jpeg_quality ?? null);
      assertOptionalMultiPageTiff(input.multi_page_tiff ?? null);
      assertOptionalTimestamp(input.completed_at ?? null, 'completed_at');
      assertOptionalNonNegativeInt(input.duration_ms ?? null, 'duration_ms');
      assertOptionalNonNegativeInt(input.output_size_bytes ?? null, 'output_size_bytes');
      assertOptionalNonNegativeInt(input.paragraphs_extracted ?? null, 'paragraphs_extracted');
      assertOptionalNonNegativeInt(input.tables_detected ?? null, 'tables_detected');
      assertOptionalNonNegativeInt(input.images_embedded ?? null, 'images_embedded');
      if (input.pages_processed !== undefined) {
        assertNonNegativeInt(input.pages_processed, 'pages_processed');
      }

      const now = Date.now();
      const truncatedError =
        input.error_message !== null && input.error_message !== undefined
          ? truncateErrorMessage(input.error_message)
          : null;

      const result = insertStmt.run({
        doc_hash: input.doc_hash,
        format: input.format,
        quality_tier: input.quality_tier,
        page_range_start: input.page_range_start,
        page_range_end: input.page_range_end,
        include_annotations: input.include_annotations,
        dpi: input.dpi ?? null,
        jpeg_quality: input.jpeg_quality ?? null,
        multi_page_tiff: input.multi_page_tiff ?? null,
        output_path: input.output_path,
        output_size_bytes: input.output_size_bytes ?? null,
        status: input.status,
        started_at: input.started_at,
        completed_at: input.completed_at ?? null,
        duration_ms: input.duration_ms ?? null,
        pages_processed: input.pages_processed ?? 0,
        paragraphs_extracted: input.paragraphs_extracted ?? null,
        tables_detected: input.tables_detected ?? null,
        images_embedded: input.images_embedded ?? null,
        error_message: truncatedError,
        created_at: input.created_at ?? now,
      });

      const rowid = result.lastInsertRowid;
      return typeof rowid === 'bigint' ? Number(rowid) : rowid;
    },

    get(id: number): ExportJobRow | null {
      assertValidId(id, 'id');
      return getStmt.get({ id }) ?? null;
    },

    updateStatus(id: number, input: UpdateExportJobStatusInput): boolean {
      return doUpdateStatus(id, input);
    },

    updateProgress(id: number, input: UpdateExportJobProgressInput): boolean {
      assertValidId(id, 'id');
      assertNonNegativeInt(input.pages_processed, 'pages_processed');

      const paragraphsSupplied = input.paragraphs_extracted !== undefined ? 1 : 0;
      const tablesSupplied = input.tables_detected !== undefined ? 1 : 0;
      const imagesSupplied = input.images_embedded !== undefined ? 1 : 0;
      const sizeSupplied = input.output_size_bytes !== undefined ? 1 : 0;

      if (paragraphsSupplied) {
        assertNonNegativeInt(input.paragraphs_extracted ?? 0, 'paragraphs_extracted');
      }
      if (tablesSupplied) {
        assertNonNegativeInt(input.tables_detected ?? 0, 'tables_detected');
      }
      if (imagesSupplied) {
        assertNonNegativeInt(input.images_embedded ?? 0, 'images_embedded');
      }
      if (sizeSupplied) {
        assertNonNegativeInt(input.output_size_bytes ?? 0, 'output_size_bytes');
      }

      const result = updateProgressStmt.run({
        id,
        pages_processed: input.pages_processed,
        paragraphs_extracted: input.paragraphs_extracted ?? 0,
        paragraphs_extracted_supplied: paragraphsSupplied,
        tables_detected: input.tables_detected ?? 0,
        tables_detected_supplied: tablesSupplied,
        images_embedded: input.images_embedded ?? 0,
        images_embedded_supplied: imagesSupplied,
        output_size_bytes: input.output_size_bytes ?? 0,
        output_size_bytes_supplied: sizeSupplied,
      });
      return result.changes > 0;
    },

    listByDocHash(docHash: string, limit: number = DEFAULT_LIMIT, offset = 0): ExportJobRow[] {
      assertNonEmptyString(docHash, 'docHash');
      return listByDocHashStmt.all({
        doc_hash: docHash,
        limit: clampLimit(limit),
        offset: clampOffset(offset),
      });
    },

    listByStatus(
      status: ExportJobStatus,
      limit: number = DEFAULT_LIMIT,
      offset = 0,
    ): ExportJobRow[] {
      assertExportStatus(status);
      return listByStatusStmt.all({
        status,
        limit: clampLimit(limit),
        offset: clampOffset(offset),
      });
    },

    listRecent(limit: number = DEFAULT_LIMIT): ExportJobRow[] {
      return listRecentStmt.all({ limit: clampLimit(limit) });
    },

    listInProgress(): ExportJobRow[] {
      return listInProgressStmt.all();
    },

    markRunning(id: number): boolean {
      return doUpdateStatus(id, { status: 'running' });
    },

    markCompleted(id: number, input: MarkCompletedInput): boolean {
      assertValidId(id, 'id');
      assertValidTimestamp(input.completed_at, 'completed_at');
      assertNonNegativeInt(input.duration_ms, 'duration_ms');
      assertNonNegativeInt(input.output_size_bytes, 'output_size_bytes');

      const okStatus = doUpdateStatus(id, {
        status: 'completed',
        completed_at: input.completed_at,
        duration_ms: input.duration_ms,
        output_size_bytes: input.output_size_bytes,
      });
      if (!okStatus) return false;

      // Content stats are optional (image formats have no stats; office
      // formats supply them on completion).
      const hasStats =
        input.paragraphs_extracted !== undefined ||
        input.tables_detected !== undefined ||
        input.images_embedded !== undefined;
      if (hasStats) {
        // Reuse updateProgress to land the stats (pages_processed unchanged
        // — pass the row's existing value).
        const row = getStmt.get({ id });
        if (!row) return false;
        const progressInput: UpdateExportJobProgressInput = {
          pages_processed: row.pages_processed,
        };
        if (input.paragraphs_extracted !== undefined) {
          progressInput.paragraphs_extracted = input.paragraphs_extracted;
        }
        if (input.tables_detected !== undefined) {
          progressInput.tables_detected = input.tables_detected;
        }
        if (input.images_embedded !== undefined) {
          progressInput.images_embedded = input.images_embedded;
        }
        return this.updateProgress(id, progressInput);
      }
      return true;
    },

    markCancelled(id: number, input: MarkCancelledInput): boolean {
      assertValidId(id, 'id');
      assertValidTimestamp(input.completed_at, 'completed_at');
      assertNonNegativeInt(input.duration_ms, 'duration_ms');
      return doUpdateStatus(id, {
        status: 'cancelled',
        completed_at: input.completed_at,
        duration_ms: input.duration_ms,
      });
    },

    markFailed(id: number, errorMessage: string, completedAt: number, durationMs: number): boolean {
      assertValidId(id, 'id');
      assertNonEmptyString(errorMessage, 'errorMessage');
      assertValidTimestamp(completedAt, 'completed_at');
      assertNonNegativeInt(durationMs, 'duration_ms');
      return doUpdateStatus(id, {
        status: 'failed',
        completed_at: completedAt,
        duration_ms: durationMs,
        error_message: errorMessage,
      });
    },

    delete(id: number): boolean {
      assertValidId(id, 'id');
      const result = deleteStmt.run({ id });
      return result.changes > 0;
    },
  };
}

// ============================================================
// Validators
// ============================================================

function assertNonEmptyString(s: string, label: string): void {
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertValidTimestamp(n: number, label: string): void {
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label} must be a non-negative finite number (ms epoch)`);
  }
}

function assertOptionalTimestamp(n: number | null, label: string): void {
  if (n === null) return;
  assertValidTimestamp(n, label);
}

function assertNonNegativeInt(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function assertOptionalNonNegativeInt(n: number | null, label: string): void {
  if (n === null) return;
  assertNonNegativeInt(n, label);
}

function assertPageIndex(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer (0-based page index)`);
  }
}

function assertOrderedRange(start: number, end: number): void {
  if (end < start) {
    throw new Error(
      `page_range_end (${String(end)}) must be >= page_range_start (${String(start)})`,
    );
  }
}

function assertValidId(id: number, label: string): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label}: ${String(id)} (must be positive integer)`);
  }
}

function assertExportStatus(s: ExportJobStatus): void {
  if (!VALID_STATUSES.includes(s)) {
    throw new Error(`status must be one of ${VALID_STATUSES.join('|')} (got ${String(s)})`);
  }
}

function assertExportFormat(f: ExportFormat): void {
  if (!VALID_FORMATS.includes(f)) {
    throw new Error(`format must be one of ${VALID_FORMATS.join('|')} (got ${String(f)})`);
  }
}

function assertExportQualityTier(t: ExportQualityTier): void {
  if (!VALID_QUALITY_TIERS.includes(t)) {
    throw new Error(
      `quality_tier must be one of ${VALID_QUALITY_TIERS.join('|')} (got ${String(t)})`,
    );
  }
}

function assertIncludeAnnotationsFlag(n: 0 | 1): void {
  if (n !== 0 && n !== 1) {
    throw new Error(`include_annotations must be 0 or 1 (got ${String(n)})`);
  }
}

function assertOptionalDpi(n: number | null): void {
  if (n === null) return;
  // Range [72, 600] enforced at IPC handler boundary (data-models §11.9);
  // repo guards numeric shape only.
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`dpi must be a positive integer or null (got ${String(n)})`);
  }
}

function assertOptionalJpegQuality(n: number | null): void {
  if (n === null) return;
  if (!Number.isFinite(n) || n <= 0 || n > 1) {
    throw new Error(`jpeg_quality must be a number in (0, 1] or null (got ${String(n)})`);
  }
}

function assertOptionalMultiPageTiff(n: 0 | 1 | null): void {
  if (n === null) return;
  if (n !== 0 && n !== 1) {
    throw new Error(`multi_page_tiff must be 0 or 1 or null (got ${String(n)})`);
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function clampOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}

function truncateErrorMessage(s: string): string {
  if (s.length <= MAX_ERROR_MESSAGE_LENGTH) return s;
  return s.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}
