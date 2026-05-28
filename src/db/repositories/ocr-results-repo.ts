// OCR results repository.
//
// Backs the per-page result write path (`ocr:run` handler accumulates rows as
// each page completes — architecture-phase-5.md §4.6) and read paths exposed
// via David's bridge (`ocr:getResults` per api-contracts §16) on the
// ocr_results table (docs/data-models.md §10.4 + §10.6 + §10.9).
//
// JSON columns: `words_json` is stored as TEXT verbatim. The bridge
// (`src/main/db-bridge.ts`, David Wave 20) parses on read, mapping to
// `OcrWord[]` at the IPC boundary. Repo NEVER parses — same convention as
// form_templates.fields_json (Wave 12) and signature_audit_log.byte_range_json
// (Wave 16). Single-table JSON blob avoids a fifth table with thousands of
// word rows per page (data-models §10.4.2).
//
// Nullable-late-init discipline (data-models §10.6): the JSON encoding of
// each `OcrWord` may carry `pdfRect: null` until the searchable-pdf-builder
// composes the PDF user-space rect. Consumers MUST handle null as "not yet
// composed", NOT as a zero rect. The repo stores whatever JSON the bridge
// hands it — validation lives at the IPC handler boundary.
//
// FK: ocr_results.job_id REFERENCES ocr_jobs(id) ON DELETE CASCADE. Removing
// a job auto-clears its results. `deleteByJobId` is also provided for callers
// that want to clear results without deleting the parent job (rare; the
// undo-OCR replay path uses `ocr_jobs.status = 'superseded_by_undo'` rather
// than delete, so the words remain queryable for audit).
//
// Method surface (data-models §10.9):
//   * insert(row)                     — returns new id
//   * listByJobId(jobId)              — ordered page_index ASC
//   * getByJobAndPage(jobId, pageIdx) — single row, or null
//   * deleteByJobId(jobId)            — bulk delete; returns rows removed
//   * upsert(row)                     — UNIQUE(job_id, page_index) collision
//                                        path; returns id (extension method
//                                        beyond data-models §10.9 strictly,
//                                        but required to make per-page writes
//                                        idempotent under retry — same pattern
//                                        as bookmarks/recent-files upsert)

import type BetterSqlite3 from 'better-sqlite3';

import type { OcrResultRow } from '../types';

// ============================================================
// Public shape
// ============================================================

/**
 * Insert payload. The bridge supplies every audited field except `id` and
 * `created_at` (the latter defaulted to Date.now()).
 *
 * `job_id` MUST reference an existing ocr_jobs row — the FK constraint will
 * reject orphans. SQLite's foreign_keys PRAGMA is set ON at connection time
 * (data-models §5).
 */
export interface InsertOcrResultInput {
  job_id: number;
  page_index: number;
  total_words: number;
  low_confidence_words: number;
  /** REAL 0..100; arithmetic mean across words on the page. */
  mean_confidence: number;
  /** JSON-encoded `OcrWord[]`. Bridge serializes; repo stores verbatim. */
  words_json: string;
  img_width_px: number;
  img_height_px: number;
  duration_ms: number;
  /** Optional override; defaults to Date.now() at insert time. */
  created_at?: number;
}

/**
 * Discriminated insert result. UNIQUE(job_id, page_index) collision surfaces
 * as `duplicate` — the caller (David's OCR handler) should treat this as a
 * "I already wrote this page" path and skip, OR upsert instead. The signed-
 * audit-repo Wave 16 + form-templates-repo Wave 12 pattern.
 */
export type InsertOcrResultResult = { ok: true; id: number } | { ok: false; error: 'duplicate' };

export interface OcrResultsRepo {
  /** Insert one per-page result. Returns id, or `duplicate` on UNIQUE collision. */
  insert(input: InsertOcrResultInput): InsertOcrResultResult;

  /**
   * Insert-or-replace. Replaces the existing per-page row if (job_id, page_index)
   * is already present; otherwise inserts. Useful for retry idempotency under
   * the OCR engine's between-page restart path (ocr-engine.md §7.4). Returns
   * the id of the resulting row (new or existing).
   */
  upsert(input: InsertOcrResultInput): number;

  /** All per-page rows for a job, ordered page_index ASC. */
  listByJobId(jobId: number): OcrResultRow[];

  /** Single per-page row, or null. */
  getByJobAndPage(jobId: number, pageIndex: number): OcrResultRow | null;

  /**
   * Bulk delete all results for a job. Returns the number of rows removed.
   * Cascade also fires automatically on DELETE FROM ocr_jobs — this method
   * is for callers that want to clear results WITHOUT deleting the parent
   * job row.
   */
  deleteByJobId(jobId: number): number;
}

// ============================================================
// Factory
// ============================================================

export function createOcrResultsRepo(db: BetterSqlite3.Database): OcrResultsRepo {
  const insertStmt = db.prepare<{
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
  }>(
    `INSERT INTO ocr_results
        (job_id, page_index, total_words, low_confidence_words,
         mean_confidence, words_json, img_width_px, img_height_px,
         duration_ms, created_at)
      VALUES
        (@job_id, @page_index, @total_words, @low_confidence_words,
         @mean_confidence, @words_json, @img_width_px, @img_height_px,
         @duration_ms, @created_at)`,
  );

  const upsertStmt = db.prepare<{
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
  }>(
    `INSERT INTO ocr_results
        (job_id, page_index, total_words, low_confidence_words,
         mean_confidence, words_json, img_width_px, img_height_px,
         duration_ms, created_at)
      VALUES
        (@job_id, @page_index, @total_words, @low_confidence_words,
         @mean_confidence, @words_json, @img_width_px, @img_height_px,
         @duration_ms, @created_at)
      ON CONFLICT (job_id, page_index) DO UPDATE SET
        total_words          = excluded.total_words,
        low_confidence_words = excluded.low_confidence_words,
        mean_confidence      = excluded.mean_confidence,
        words_json           = excluded.words_json,
        img_width_px         = excluded.img_width_px,
        img_height_px        = excluded.img_height_px,
        duration_ms          = excluded.duration_ms`,
  );

  const getByJobAndPageStmt = db.prepare<{ job_id: number; page_index: number }, OcrResultRow>(
    `SELECT id, job_id, page_index, total_words, low_confidence_words,
            mean_confidence, words_json, img_width_px, img_height_px,
            duration_ms, created_at
       FROM ocr_results
      WHERE job_id = @job_id AND page_index = @page_index
      LIMIT 1`,
  );

  const listByJobIdStmt = db.prepare<{ job_id: number }, OcrResultRow>(
    `SELECT id, job_id, page_index, total_words, low_confidence_words,
            mean_confidence, words_json, img_width_px, img_height_px,
            duration_ms, created_at
       FROM ocr_results
      WHERE job_id = @job_id
      ORDER BY page_index ASC`,
  );

  const deleteByJobIdStmt = db.prepare<{ job_id: number }>(
    `DELETE FROM ocr_results WHERE job_id = @job_id`,
  );

  // Existence-check for the duplicate path of `insert`. Same pattern as
  // form-templates-repo nameExistsStmt (Wave 12).
  const existsByJobAndPageStmt = db.prepare<{ job_id: number; page_index: number }, { id: number }>(
    `SELECT id FROM ocr_results
      WHERE job_id = @job_id AND page_index = @page_index
      LIMIT 1`,
  );

  return {
    insert(input: InsertOcrResultInput): InsertOcrResultResult {
      assertInsertPayload(input);
      const now = Date.now();

      // Pre-check UNIQUE then INSERT inside a single transaction so the
      // existence-check + write are atomic. Same pattern as signature-audit
      // Wave 16 + form-templates Wave 12.
      const txn = db.transaction((): InsertOcrResultResult => {
        const existing = existsByJobAndPageStmt.get({
          job_id: input.job_id,
          page_index: input.page_index,
        });
        if (existing) {
          return { ok: false, error: 'duplicate' };
        }
        const result = insertStmt.run({
          job_id: input.job_id,
          page_index: input.page_index,
          total_words: input.total_words,
          low_confidence_words: input.low_confidence_words,
          mean_confidence: input.mean_confidence,
          words_json: input.words_json,
          img_width_px: input.img_width_px,
          img_height_px: input.img_height_px,
          duration_ms: input.duration_ms,
          created_at: input.created_at ?? now,
        });
        const rowid = result.lastInsertRowid;
        const id = typeof rowid === 'bigint' ? Number(rowid) : rowid;
        return { ok: true, id };
      });

      return txn();
    },

    upsert(input: InsertOcrResultInput): number {
      assertInsertPayload(input);
      const now = Date.now();

      // ON CONFLICT path doesn't touch created_at on the UPDATE branch —
      // preserve original insertion time. New rows get @created_at.
      upsertStmt.run({
        job_id: input.job_id,
        page_index: input.page_index,
        total_words: input.total_words,
        low_confidence_words: input.low_confidence_words,
        mean_confidence: input.mean_confidence,
        words_json: input.words_json,
        img_width_px: input.img_width_px,
        img_height_px: input.img_height_px,
        duration_ms: input.duration_ms,
        created_at: input.created_at ?? now,
      });

      // Look up the (possibly pre-existing) row id rather than relying on
      // lastInsertRowid — under ON CONFLICT DO UPDATE, lastInsertRowid is
      // not guaranteed to point at the affected row across SQLite versions.
      const row = getByJobAndPageStmt.get({
        job_id: input.job_id,
        page_index: input.page_index,
      });
      // Should be impossible — upsert just inserted or updated this row.
      if (!row) {
        throw new Error(
          `upsert post-condition violated: row not found for job_id=${String(input.job_id)}, page_index=${String(input.page_index)}`,
        );
      }
      return row.id;
    },

    listByJobId(jobId: number): OcrResultRow[] {
      assertValidId(jobId, 'jobId');
      return listByJobIdStmt.all({ job_id: jobId });
    },

    getByJobAndPage(jobId: number, pageIndex: number): OcrResultRow | null {
      assertValidId(jobId, 'jobId');
      assertPageIndex(pageIndex, 'pageIndex');
      return getByJobAndPageStmt.get({ job_id: jobId, page_index: pageIndex }) ?? null;
    },

    deleteByJobId(jobId: number): number {
      assertValidId(jobId, 'jobId');
      const result = deleteByJobIdStmt.run({ job_id: jobId });
      return result.changes;
    },
  };
}

// ============================================================
// Validators
// ============================================================

function assertInsertPayload(input: InsertOcrResultInput): void {
  assertValidId(input.job_id, 'job_id');
  assertPageIndex(input.page_index, 'page_index');
  assertNonNegativeInt(input.total_words, 'total_words');
  assertNonNegativeInt(input.low_confidence_words, 'low_confidence_words');
  if (input.low_confidence_words > input.total_words) {
    throw new Error(
      `low_confidence_words (${String(input.low_confidence_words)}) must be <= total_words (${String(input.total_words)})`,
    );
  }
  assertConfidence(input.mean_confidence, 'mean_confidence');
  if (typeof input.words_json !== 'string') {
    throw new Error('words_json must be a string (JSON-encoded OcrWord[])');
  }
  assertPositiveInt(input.img_width_px, 'img_width_px');
  assertPositiveInt(input.img_height_px, 'img_height_px');
  assertNonNegativeInt(input.duration_ms, 'duration_ms');
}

function assertValidId(id: number, label: string): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label}: ${String(id)} (must be positive integer)`);
  }
}

function assertPageIndex(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer (0-based page index)`);
  }
}

function assertNonNegativeInt(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function assertPositiveInt(n: number, label: string): void {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertConfidence(n: number, label: string): void {
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(`${label} must be a number in [0, 100]`);
  }
}
