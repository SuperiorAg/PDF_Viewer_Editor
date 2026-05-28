// OCR jobs repository.
//
// Backs the `ocr:run`, `ocr:listJobs`, `ocr:cancel`, `ocr:getJob` IPC channels
// (docs/api-contracts.md §16 + docs/architecture-phase-5.md §4.6) and the
// ocr_jobs table (docs/data-models.md §10.4 + §10.5 + §10.9).
//
// Lifecycle (architecture-phase-5.md §4.6, ocr-engine.md §7):
//   queued    -> running (worker acquired)
//   running   -> completed | cancelled | failed
//   completed -> superseded_by_undo (when the user undoes the corresponding
//                EditOperation; data-models §10.3.1)
//
// JSON columns: `preprocess_json` is stored as TEXT verbatim. The bridge
// adapter (`src/main/db-bridge.ts`, David Wave 20) parses/serializes
// PreprocessOptions at the IPC boundary, mirroring the Wave 12 + Wave 16
// JSON-stays-as-text-in-the-repo convention.
//
// Method surface (data-models §10.9):
//   * insert(row)               — returns new id
//   * get(id)                   — single row, or null
//   * updateStatus(...)         — terminal-status writes + watermark cols
//   * listByDocHash(...)        — audit panel "this file"
//   * listByStatus(...)         — "running" / "failed" surfaces
//   * listAll(filters, ...)     — generic filtered list
//   * countAll(filters)         — pagination companion
//   * delete(id)                — cascades ocr_results via FK ON DELETE CASCADE
//
// IMPORTANT TAMPER POSTURE (data-models §10.4.3): the OCR audit tables live
// in the same SQLite file as recents/bookmarks/templates/signature_audit_log.
// Any process with write access can forge rows. Phase 5 makes NO claim that
// this log is tamper-evident; it's a convenience surface, not a notarization
// service. Documented in user-guide §OCR (Wave 22 Nathan).

import type BetterSqlite3 from 'better-sqlite3';

import type { OcrJobRow, OcrJobStatus } from '../types';

// ============================================================
// Public shape
// ============================================================

/**
 * Insert payload. The bridge supplies every audited field except `id`
 * (autoincrement) and `created_at` (defaulted to Date.now()).
 *
 * `started_at` is required because the job is created in 'queued' state with
 * an explicit clock value (often the same as `created_at`, but the engine
 * distinguishes between row-creation and queue-entry timing). The bridge
 * passes `Date.now()` for both unless replaying a historical record.
 *
 * Nullable late-init columns (`completed_at`, `mean_confidence`, `total_words`,
 * `error_message`) default to null on insert. Per the Phase 4.1.1 sentinel-
 * default lesson, callers MUST NOT pass `-1` or `0` as a "not yet known"
 * sentinel — pass `null` and update later via `updateStatus`.
 */
export interface InsertOcrJobInput {
  doc_hash: string;
  page_range_start: number;
  page_range_end: number;
  /** '+'-joined Tesseract lang codes, normalized lowercase. */
  langs: string;
  /** JSON-encoded PreprocessOptions; bridge serializes. */
  preprocess_json: string;
  status: OcrJobStatus;
  started_at: number;
  completed_at?: number | null;
  mean_confidence?: number | null;
  total_words?: number | null;
  error_message?: string | null;
  /** 0/1; 1 when a PAdES widget was present pre-run. */
  invalidated_signatures: 0 | 1;
  /** Optional override; defaults to Date.now() at insert time. */
  created_at?: number;
}

/**
 * Status-update payload. Every field except `status` is optional — only the
 * supplied fields are written. The repo uses an explicit COALESCE-style
 * pattern so a caller updating ONLY `error_message` doesn't accidentally
 * stomp a previously-set `mean_confidence`.
 *
 * Use cases:
 *   * queued -> running: status only
 *   * running -> completed: status + completed_at + mean_confidence + total_words
 *   * running -> failed: status + completed_at + error_message
 *   * running -> cancelled: status + completed_at
 *   * completed -> superseded_by_undo: status only
 */
export interface UpdateOcrJobStatusInput {
  status: OcrJobStatus;
  completed_at?: number;
  mean_confidence?: number;
  total_words?: number;
  error_message?: string;
}

export interface OcrJobListFilters {
  /** Filter by doc_hash (current open file). */
  doc_hash?: string;
  /** Filter by lifecycle status. */
  status?: OcrJobStatus;
  /** Lower bound on started_at (ms epoch, inclusive). */
  since?: number;
  /** Upper bound on started_at (ms epoch, inclusive). */
  until?: number;
}

export interface OcrJobsRepo {
  /** Insert a new job row. Returns the new id. */
  insert(input: InsertOcrJobInput): number;

  /** Lookup by primary key. Null if not found. */
  get(id: number): OcrJobRow | null;

  /**
   * Update the status + watermark columns. Returns true if the row exists
   * and was updated. The data-models §10.9 contract uses positional optional
   * args; we accept a payload object for readability + future-proofing.
   *
   * Convenience overload-equivalent: call with `{ status: 'running' }` to
   * transition without touching completion fields.
   */
  updateStatus(id: number, input: UpdateOcrJobStatusInput): boolean;

  /** Audit panel filter: jobs for the file currently open. Ordered started_at DESC. */
  listByDocHash(docHash: string, limit?: number, offset?: number): OcrJobRow[];

  /** Lifecycle filter: 'running' for resume UI, 'failed' for retry surface. */
  listByStatus(status: OcrJobStatus, limit?: number, offset?: number): OcrJobRow[];

  /**
   * Generic filtered list. Optional filters are AND'd; omitted filters do not
   * constrain. Ordered started_at DESC with id ASC as the stable tie-break.
   */
  listAll(filters: OcrJobListFilters, limit?: number, offset?: number): OcrJobRow[];

  /** Total-count companion for listAll. */
  countAll(filters: OcrJobListFilters): number;

  /**
   * Delete by id. Returns true if a row was removed. Cascades to ocr_results
   * via FK ON DELETE CASCADE; the signature_audit_log.invalidated_by_ocr_job_id
   * column is NOT cascaded (intentional — see migrations/0005 comment).
   */
  delete(id: number): boolean;
}

// ============================================================
// Factory
// ============================================================

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 10000;

const VALID_STATUSES: readonly OcrJobStatus[] = [
  'queued',
  'running',
  'completed',
  'cancelled',
  'failed',
  'superseded_by_undo',
] as const;

export function createOcrJobsRepo(db: BetterSqlite3.Database): OcrJobsRepo {
  // ---- Statements ----
  // Prepared once per repo per data-models §5.

  const insertStmt = db.prepare<{
    doc_hash: string;
    page_range_start: number;
    page_range_end: number;
    langs: string;
    preprocess_json: string;
    status: string;
    started_at: number;
    completed_at: number | null;
    mean_confidence: number | null;
    total_words: number | null;
    error_message: string | null;
    invalidated_signatures: 0 | 1;
    created_at: number;
  }>(
    `INSERT INTO ocr_jobs
        (doc_hash, page_range_start, page_range_end, langs, preprocess_json,
         status, started_at, completed_at, mean_confidence, total_words,
         error_message, invalidated_signatures, created_at)
      VALUES
        (@doc_hash, @page_range_start, @page_range_end, @langs, @preprocess_json,
         @status, @started_at, @completed_at, @mean_confidence, @total_words,
         @error_message, @invalidated_signatures, @created_at)`,
  );

  const getStmt = db.prepare<{ id: number }, OcrJobRow>(
    `SELECT id, doc_hash, page_range_start, page_range_end, langs,
            preprocess_json, status, started_at, completed_at,
            mean_confidence, total_words, error_message,
            invalidated_signatures, created_at
       FROM ocr_jobs
      WHERE id = @id
      LIMIT 1`,
  );

  // updateStatus uses the COALESCE-supplied-flag pattern so a single prepared
  // statement covers every transition. Each field has a `*_supplied` 0/1 flag;
  // when 0, COALESCE picks the existing column value; when 1, it picks the
  // new value. Same approach as bookmarks-repo Wave 7 + signature-audit-repo
  // Wave 16 listAll.
  const updateStatusStmt = db.prepare<{
    id: number;
    status: string;
    completed_at: number;
    completed_at_supplied: number;
    mean_confidence: number;
    mean_confidence_supplied: number;
    total_words: number;
    total_words_supplied: number;
    error_message: string;
    error_message_supplied: number;
  }>(
    `UPDATE ocr_jobs
        SET status          = @status,
            completed_at    = CASE WHEN @completed_at_supplied = 1
                                   THEN @completed_at ELSE completed_at END,
            mean_confidence = CASE WHEN @mean_confidence_supplied = 1
                                   THEN @mean_confidence ELSE mean_confidence END,
            total_words     = CASE WHEN @total_words_supplied = 1
                                   THEN @total_words ELSE total_words END,
            error_message   = CASE WHEN @error_message_supplied = 1
                                   THEN @error_message ELSE error_message END
      WHERE id = @id`,
  );

  const listByDocHashStmt = db.prepare<
    { doc_hash: string; limit: number; offset: number },
    OcrJobRow
  >(
    `SELECT id, doc_hash, page_range_start, page_range_end, langs,
            preprocess_json, status, started_at, completed_at,
            mean_confidence, total_words, error_message,
            invalidated_signatures, created_at
       FROM ocr_jobs
      WHERE doc_hash = @doc_hash
      ORDER BY started_at DESC, id ASC
      LIMIT @limit OFFSET @offset`,
  );

  const listByStatusStmt = db.prepare<{ status: string; limit: number; offset: number }, OcrJobRow>(
    `SELECT id, doc_hash, page_range_start, page_range_end, langs,
            preprocess_json, status, started_at, completed_at,
            mean_confidence, total_words, error_message,
            invalidated_signatures, created_at
       FROM ocr_jobs
      WHERE status = @status
      ORDER BY started_at DESC, id ASC
      LIMIT @limit OFFSET @offset`,
  );

  // listAll — same toggle pattern as signature-audit-repo Wave 16.
  const listAllStmt = db.prepare<
    {
      doc_hash: string;
      doc_hash_supplied: number;
      status: string;
      status_supplied: number;
      since: number;
      since_supplied: number;
      until: number;
      until_supplied: number;
      limit: number;
      offset: number;
    },
    OcrJobRow
  >(
    `SELECT id, doc_hash, page_range_start, page_range_end, langs,
            preprocess_json, status, started_at, completed_at,
            mean_confidence, total_words, error_message,
            invalidated_signatures, created_at
       FROM ocr_jobs
      WHERE (@doc_hash_supplied = 0 OR doc_hash = @doc_hash)
        AND (@status_supplied   = 0 OR status   = @status)
        AND (@since_supplied    = 0 OR started_at >= @since)
        AND (@until_supplied    = 0 OR started_at <= @until)
      ORDER BY started_at DESC, id ASC
      LIMIT @limit OFFSET @offset`,
  );

  const countAllStmt = db.prepare<
    {
      doc_hash: string;
      doc_hash_supplied: number;
      status: string;
      status_supplied: number;
      since: number;
      since_supplied: number;
      until: number;
      until_supplied: number;
    },
    { c: number }
  >(
    `SELECT COUNT(*) AS c
       FROM ocr_jobs
      WHERE (@doc_hash_supplied = 0 OR doc_hash = @doc_hash)
        AND (@status_supplied   = 0 OR status   = @status)
        AND (@since_supplied    = 0 OR started_at >= @since)
        AND (@until_supplied    = 0 OR started_at <= @until)`,
  );

  const deleteStmt = db.prepare<{ id: number }>(`DELETE FROM ocr_jobs WHERE id = @id`);

  return {
    insert(input: InsertOcrJobInput): number {
      assertNonEmptyString(input.doc_hash, 'doc_hash');
      assertNonEmptyString(input.langs, 'langs');
      assertNonEmptyString(input.preprocess_json, 'preprocess_json');
      assertPageIndex(input.page_range_start, 'page_range_start');
      assertPageIndex(input.page_range_end, 'page_range_end');
      assertOrderedRange(input.page_range_start, input.page_range_end);
      assertValidTimestamp(input.started_at, 'started_at');
      assertOcrStatus(input.status);
      assertOptionalTimestamp(input.completed_at ?? null, 'completed_at');
      assertOptionalConfidence(input.mean_confidence ?? null, 'mean_confidence');
      assertOptionalNonNegativeInt(input.total_words ?? null, 'total_words');
      assertInvalidatedFlag(input.invalidated_signatures);

      const now = Date.now();
      const result = insertStmt.run({
        doc_hash: input.doc_hash,
        page_range_start: input.page_range_start,
        page_range_end: input.page_range_end,
        langs: input.langs,
        preprocess_json: input.preprocess_json,
        status: input.status,
        started_at: input.started_at,
        completed_at: input.completed_at ?? null,
        mean_confidence: input.mean_confidence ?? null,
        total_words: input.total_words ?? null,
        error_message: input.error_message ?? null,
        invalidated_signatures: input.invalidated_signatures,
        created_at: input.created_at ?? now,
      });

      const rowid = result.lastInsertRowid;
      return typeof rowid === 'bigint' ? Number(rowid) : rowid;
    },

    get(id: number): OcrJobRow | null {
      assertValidId(id, 'id');
      return getStmt.get({ id }) ?? null;
    },

    updateStatus(id: number, input: UpdateOcrJobStatusInput): boolean {
      assertValidId(id, 'id');
      assertOcrStatus(input.status);

      const completedSupplied = input.completed_at !== undefined ? 1 : 0;
      const meanSupplied = input.mean_confidence !== undefined ? 1 : 0;
      const totalSupplied = input.total_words !== undefined ? 1 : 0;
      const errorSupplied = input.error_message !== undefined ? 1 : 0;

      if (completedSupplied) {
        assertValidTimestamp(input.completed_at ?? 0, 'completed_at');
      }
      if (meanSupplied) {
        assertOptionalConfidence(input.mean_confidence ?? null, 'mean_confidence');
      }
      if (totalSupplied) {
        assertOptionalNonNegativeInt(input.total_words ?? null, 'total_words');
      }

      const result = updateStatusStmt.run({
        id,
        status: input.status,
        completed_at: input.completed_at ?? 0,
        completed_at_supplied: completedSupplied,
        mean_confidence: input.mean_confidence ?? 0,
        mean_confidence_supplied: meanSupplied,
        total_words: input.total_words ?? 0,
        total_words_supplied: totalSupplied,
        error_message: input.error_message ?? '',
        error_message_supplied: errorSupplied,
      });
      return result.changes > 0;
    },

    listByDocHash(docHash: string, limit: number = DEFAULT_LIMIT, offset = 0): OcrJobRow[] {
      assertNonEmptyString(docHash, 'docHash');
      return listByDocHashStmt.all({
        doc_hash: docHash,
        limit: clampLimit(limit),
        offset: clampOffset(offset),
      });
    },

    listByStatus(status: OcrJobStatus, limit: number = DEFAULT_LIMIT, offset = 0): OcrJobRow[] {
      assertOcrStatus(status);
      return listByStatusStmt.all({
        status,
        limit: clampLimit(limit),
        offset: clampOffset(offset),
      });
    },

    listAll(filters: OcrJobListFilters, limit: number = DEFAULT_LIMIT, offset = 0): OcrJobRow[] {
      const params = buildListAllParams(filters);
      return listAllStmt.all({
        ...params,
        limit: clampLimit(limit),
        offset: clampOffset(offset),
      });
    },

    countAll(filters: OcrJobListFilters): number {
      const params = buildListAllParams(filters);
      const row = countAllStmt.get(params);
      return row?.c ?? 0;
    },

    delete(id: number): boolean {
      assertValidId(id, 'id');
      const result = deleteStmt.run({ id });
      return result.changes > 0;
    },
  };
}

// ============================================================
// Helpers
// ============================================================

interface ListAllParams {
  doc_hash: string;
  doc_hash_supplied: number;
  status: string;
  status_supplied: number;
  since: number;
  since_supplied: number;
  until: number;
  until_supplied: number;
}

function buildListAllParams(filters: OcrJobListFilters): ListAllParams {
  const docHashSupplied = filters.doc_hash !== undefined ? 1 : 0;
  const statusSupplied = filters.status !== undefined ? 1 : 0;
  const sinceSupplied = filters.since !== undefined ? 1 : 0;
  const untilSupplied = filters.until !== undefined ? 1 : 0;

  if (docHashSupplied) assertNonEmptyString(filters.doc_hash ?? '', 'doc_hash');
  if (statusSupplied) assertOcrStatus(filters.status ?? 'queued');
  if (sinceSupplied) assertValidTimestamp(filters.since ?? 0, 'since');
  if (untilSupplied) assertValidTimestamp(filters.until ?? 0, 'until');
  if (sinceSupplied && untilSupplied) {
    assertWindow(filters.since ?? 0, filters.until ?? 0);
  }

  return {
    doc_hash: filters.doc_hash ?? '',
    doc_hash_supplied: docHashSupplied,
    status: filters.status ?? 'queued',
    status_supplied: statusSupplied,
    since: filters.since ?? 0,
    since_supplied: sinceSupplied,
    until: filters.until ?? 0,
    until_supplied: untilSupplied,
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

function assertOptionalNonNegativeInt(n: number | null, label: string): void {
  if (n === null) return;
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer or null`);
  }
}

function assertOptionalConfidence(n: number | null, label: string): void {
  if (n === null) return;
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(`${label} must be a number in [0, 100] or null`);
  }
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

function assertOcrStatus(s: OcrJobStatus): void {
  if (!VALID_STATUSES.includes(s)) {
    throw new Error(`status must be one of ${VALID_STATUSES.join('|')} (got ${String(s)})`);
  }
}

function assertInvalidatedFlag(n: 0 | 1): void {
  if (n !== 0 && n !== 1) {
    throw new Error(`invalidated_signatures must be 0 or 1 (got ${String(n)})`);
  }
}

function assertWindow(lower: number, upper: number): void {
  if (lower > upper) {
    throw new Error(`started_at window invalid: since=${String(lower)} > until=${String(upper)}`);
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
