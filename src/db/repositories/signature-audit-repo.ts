// Signature-audit-log repository.
//
// File length justification (conventions §10, >200 lines): this repo backs SEVEN
// distinct read paths (audit-panel-by-doc, verify-by-pre-sign-hash, "signed by
// me" by fingerprint, generic filtered listAll with pagination + total, plus
// get/insert/delete) — each requires its own prepared statement with explicit
// column projection (~25 lines of SQL apiece, intentionally not concatenated
// for readability) AND the file co-locates 8 input validators. Splitting into
// sub-modules would fragment the prepared-statement cache contract that
// `data-models.md §5` requires ("Prepared statements cached in repository
// constructors. Don't re-prepare in a hot loop."). The boundary is the factory:
// one factory call returns all 7 method closures sharing the cache.
//
// Backs the `signatures:listAudit` / `signatures:verify` IPC channels
// (docs/api-contracts.md §14 + docs/signature-engine.md §8) and the
// signature_audit_log table (docs/data-models.md §9.4 + §9.5 + §9.6).
//
// The signature engine inserts one row per successful sign op (visual or PAdES)
// — see signature-engine.md §8 for the call site contract. The audit panel
// reads via list / listByDocHash / listByFingerprint; the verify flow reads
// via listByPreSignDocHash + recomputes the byte-range hash to confirm
// integrity.
//
// IMPORTANT TAMPER POSTURE (data-models §9.4.3): the audit log lives in the
// same SQLite file as recents/bookmarks/templates. Any process with write
// access can forge rows. Phase 4 makes NO claim that this log is tamper-
// evident; it's a convenience surface, not a notarization service. The
// user-guide will state this plainly (Nathan, Wave 18).
//
// JSON columns: `byte_range_json` is stored as TEXT (or NULL) and the repo
// NEVER parses/serializes it. The bridge adapter (`src/main/db-bridge.ts`,
// David Wave 16) handles the JSON boundary, same convention as Wave 12's
// `FormTemplateRow.fields_json`. This keeps the repo a pure SQL-row passthrough.
//
// Method surface (data-models §9.6):
//   * insert(row)                                           — returns new id
//   * get(id)                                               — single row, or null
//   * listByDocHash(docHash, limit?, offset?)               — audit panel "this file"
//   * listByPreSignDocHash(preSignDocHash, limit?, offset?) — verify flow
//   * listByFingerprint(fp, since?, until?, limit?, offset?) — "signed by ME"
//   * listAll(filters, limit?, offset?)                     — { items, total }
//   * delete(id)                                            — undo-PAdES flow

import type BetterSqlite3 from 'better-sqlite3';

import type { SignatureAuditRow } from '../types';

// ============================================================
// Public shape
// ============================================================

/**
 * Insert payload. The caller (David's bridge) supplies every audited field
 * except `id` (autoincrement) and `created_at` (defaulted to Date.now()).
 *
 * `signed_at` is required because it is sometimes set from the cert's signing-
 * time attribute rather than wall-clock at insert time (signature-engine §8).
 * `created_at` may differ from `signed_at` if the engine retried.
 */
export interface InsertSignatureAuditInput {
  doc_hash: string;
  pre_sign_doc_hash: string;
  signed_at: number;
  signature_kind: SignatureAuditRow['signature_kind'];
  signed_by_fingerprint: string | null;
  signed_by_subject_cn: string | null;
  signed_by_issuer_cn: string | null;
  cert_not_before: number | null;
  cert_not_after: number | null;
  tsa_url: string | null;
  tsa_response_status: SignatureAuditRow['tsa_response_status'];
  sig_bytes_offset: number | null;
  sig_bytes_length: number | null;
  /** JSON-encoded `[a, b, c, d]`. Bridge serializes; repo stores verbatim. */
  byte_range_json: string | null;
  reason: string | null;
  location: string | null;
  field_name: string | null;
  /** Optional override; defaults to Date.now() at insert time. */
  created_at?: number;
}

/**
 * Discriminated insert result. UNIQUE(doc_hash, sig_bytes_offset) collisions
 * surface as `duplicate` — the engine should treat this as a soft-bug
 * (a row was already written for this exact signature; signature-engine §8
 * has the retry idempotency contract).
 */
export type InsertSignatureAuditResult =
  | { ok: true; id: number }
  | { ok: false; error: 'duplicate' };

export interface ListAllFilters {
  /** Filter by doc_hash (current open file). */
  fileHash?: string;
  /** Filter by signer cert SHA-256 fingerprint. */
  signedByFingerprint?: string;
  /** Lower bound on signed_at (ms epoch, inclusive). */
  since?: number;
  /** Upper bound on signed_at (ms epoch, inclusive). */
  until?: number;
}

export interface ListAllResult {
  items: SignatureAuditRow[];
  /** Count of matching rows BEFORE limit/offset; for pagination UI. */
  total: number;
}

export interface SignatureAuditRepo {
  /**
   * Insert a new audit row. Returns the new id, or `duplicate` if the
   * UNIQUE(doc_hash, sig_bytes_offset) constraint fired. Visual signatures
   * (sig_bytes_offset = NULL) never collide because SQLite UNIQUE treats
   * NULL != NULL (data-models §9.4.1).
   */
  insert(row: InsertSignatureAuditInput): InsertSignatureAuditResult;

  /** Lookup by primary key. Null if not found. */
  get(id: number): SignatureAuditRow | null;

  /** Audit panel filter: signatures on the file currently open. */
  listByDocHash(docHash: string, limit?: number, offset?: number): SignatureAuditRow[];

  /** Verify flow: rows whose pre-sign hash matches the recomputed byte-range hash. */
  listByPreSignDocHash(
    preSignDocHash: string,
    limit?: number,
    offset?: number,
  ): SignatureAuditRow[];

  /** "Signed by ME" filter; signed_at window optional. */
  listByFingerprint(
    fingerprint: string,
    since?: number,
    until?: number,
    limit?: number,
    offset?: number,
  ): SignatureAuditRow[];

  /**
   * Generic filtered list with pagination + total count. Optional filters are
   * AND'd; omitted filters do not constrain. Total is computed in the same
   * transaction so the count is consistent with the page.
   */
  listAll(filters: ListAllFilters, limit?: number, offset?: number): ListAllResult;

  /**
   * Delete by id. Returns true if a row was removed. Used by the undo-PAdES
   * flow (data-models §9.6) — when the user undoes a PAdES sign, the audit
   * row is removed alongside the signature widget. The signature engine
   * handles ordering: widget cleared first, then audit-row delete.
   */
  delete(id: number): boolean;

  // ============================================================
  // Phase 5 — OCR invalidation cross-link (data-models §10.10 + §10.9)
  //
  // When an OCR run mutates page bytes on a previously-PAdES-signed doc, the
  // engine first asks the user to confirm at modal time (architecture-phase-5
  // §6) then, after the OCR job completes, calls `markInvalidatedByOcrJob`
  // to back-link the affected audit rows. `listInvalidatedByOcrJob` is the
  // reverse query — used by the OCR audit panel's "this job invalidated N
  // signatures" surface.
  // ============================================================

  /**
   * Mark the supplied audit-row ids as invalidated by the given OCR job.
   * Returns the number of rows updated. Idempotent — re-marking the same row
   * with the same job id is a no-op (the UPDATE produces 0 changes since
   * SQLite is lenient about setting a column to its existing value).
   *
   * The caller (David's OCR handler) computes the row ids by reading
   * `listByDocHash(doc_hash)` BEFORE running OCR, then passes the surviving
   * PAdES row ids here once the job completes. Visual-signature rows do NOT
   * get marked — they aren't cryptographically invalidated by byte changes.
   */
  markInvalidatedByOcrJob(rowIds: number[], ocrJobId: number): number;

  /**
   * List signature-audit rows that were invalidated by the given OCR job.
   * Used by the OCR audit panel's "this run invalidated N signatures" badge
   * and the signature audit panel's reverse-lookup.
   */
  listInvalidatedByOcrJob(ocrJobId: number): SignatureAuditRow[];
}

// ============================================================
// Factory
// ============================================================

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 10000;

export function createSignatureAuditRepo(db: BetterSqlite3.Database): SignatureAuditRepo {
  // ---- Statements ----
  // Each is prepared once per repo instance and reused per data-models §5.

  const insertStmt = db.prepare<{
    doc_hash: string;
    pre_sign_doc_hash: string;
    signed_at: number;
    signature_kind: string;
    signed_by_fingerprint: string | null;
    signed_by_subject_cn: string | null;
    signed_by_issuer_cn: string | null;
    cert_not_before: number | null;
    cert_not_after: number | null;
    tsa_url: string | null;
    tsa_response_status: string | null;
    sig_bytes_offset: number | null;
    sig_bytes_length: number | null;
    byte_range_json: string | null;
    reason: string | null;
    location: string | null;
    field_name: string | null;
    created_at: number;
  }>(
    `INSERT INTO signature_audit_log
        (doc_hash, pre_sign_doc_hash, signed_at, signature_kind,
         signed_by_fingerprint, signed_by_subject_cn, signed_by_issuer_cn,
         cert_not_before, cert_not_after,
         tsa_url, tsa_response_status,
         sig_bytes_offset, sig_bytes_length, byte_range_json,
         reason, location, field_name, created_at)
      VALUES
        (@doc_hash, @pre_sign_doc_hash, @signed_at, @signature_kind,
         @signed_by_fingerprint, @signed_by_subject_cn, @signed_by_issuer_cn,
         @cert_not_before, @cert_not_after,
         @tsa_url, @tsa_response_status,
         @sig_bytes_offset, @sig_bytes_length, @byte_range_json,
         @reason, @location, @field_name, @created_at)`,
  );

  const getStmt = db.prepare<{ id: number }, SignatureAuditRow>(
    `SELECT id, doc_hash, pre_sign_doc_hash, signed_at, signature_kind,
            signed_by_fingerprint, signed_by_subject_cn, signed_by_issuer_cn,
            cert_not_before, cert_not_after,
            tsa_url, tsa_response_status,
            sig_bytes_offset, sig_bytes_length, byte_range_json,
            reason, location, field_name, created_at,
            invalidated_by_ocr_job_id
       FROM signature_audit_log
      WHERE id = @id
      LIMIT 1`,
  );

  // listByDocHash — ordered by signed_at DESC, with id ASC as a stable tie-break.
  // The idx_signature_audit_log_doc_hash + idx_signature_audit_log_signed_at
  // indexes cover the WHERE + ORDER BY; SQLite picks the doc_hash index for the
  // selective filter and sorts the (typically small) matching set.
  const listByDocHashStmt = db.prepare<
    { doc_hash: string; limit: number; offset: number },
    SignatureAuditRow
  >(
    `SELECT id, doc_hash, pre_sign_doc_hash, signed_at, signature_kind,
            signed_by_fingerprint, signed_by_subject_cn, signed_by_issuer_cn,
            cert_not_before, cert_not_after,
            tsa_url, tsa_response_status,
            sig_bytes_offset, sig_bytes_length, byte_range_json,
            reason, location, field_name, created_at,
            invalidated_by_ocr_job_id
       FROM signature_audit_log
      WHERE doc_hash = @doc_hash
      ORDER BY signed_at DESC, id ASC
      LIMIT @limit OFFSET @offset`,
  );

  const listByPreSignDocHashStmt = db.prepare<
    { pre_sign_doc_hash: string; limit: number; offset: number },
    SignatureAuditRow
  >(
    `SELECT id, doc_hash, pre_sign_doc_hash, signed_at, signature_kind,
            signed_by_fingerprint, signed_by_subject_cn, signed_by_issuer_cn,
            cert_not_before, cert_not_after,
            tsa_url, tsa_response_status,
            sig_bytes_offset, sig_bytes_length, byte_range_json,
            reason, location, field_name, created_at,
            invalidated_by_ocr_job_id
       FROM signature_audit_log
      WHERE pre_sign_doc_hash = @pre_sign_doc_hash
      ORDER BY signed_at DESC, id ASC
      LIMIT @limit OFFSET @offset`,
  );

  // listByFingerprint — accepts optional [since, until] signed_at window.
  // The since/until parameters are passed unconditionally; passing NULL makes
  // the bounds non-restrictive (`signed_at >= NULL` evaluates to NULL which is
  // treated as false, so we coalesce instead).
  const listByFingerprintStmt = db.prepare<
    {
      fingerprint: string;
      since: number;
      until: number;
      limit: number;
      offset: number;
    },
    SignatureAuditRow
  >(
    `SELECT id, doc_hash, pre_sign_doc_hash, signed_at, signature_kind,
            signed_by_fingerprint, signed_by_subject_cn, signed_by_issuer_cn,
            cert_not_before, cert_not_after,
            tsa_url, tsa_response_status,
            sig_bytes_offset, sig_bytes_length, byte_range_json,
            reason, location, field_name, created_at,
            invalidated_by_ocr_job_id
       FROM signature_audit_log
      WHERE signed_by_fingerprint = @fingerprint
        AND signed_at >= @since
        AND signed_at <= @until
      ORDER BY signed_at DESC, id ASC
      LIMIT @limit OFFSET @offset`,
  );

  // listAll: dynamic-WHERE with all four optional filters. SQL is built with
  // safe placeholder substitution at the boundary — never interpolating user
  // strings — and the four IS-NULL toggle params let us reuse a single
  // prepared statement across all filter combinations.
  //
  // The toggles `*_supplied` are 0/1 ints: when 0, the matching clause
  // collapses to TRUE so the filter is non-restrictive. Same pattern as
  // bookmarks-repo's COALESCE-on-update — keeps a single prepared statement.
  const listAllStmt = db.prepare<
    {
      file_hash: string;
      file_hash_supplied: number;
      fingerprint: string;
      fingerprint_supplied: number;
      since: number;
      since_supplied: number;
      until: number;
      until_supplied: number;
      limit: number;
      offset: number;
    },
    SignatureAuditRow
  >(
    `SELECT id, doc_hash, pre_sign_doc_hash, signed_at, signature_kind,
            signed_by_fingerprint, signed_by_subject_cn, signed_by_issuer_cn,
            cert_not_before, cert_not_after,
            tsa_url, tsa_response_status,
            sig_bytes_offset, sig_bytes_length, byte_range_json,
            reason, location, field_name, created_at,
            invalidated_by_ocr_job_id
       FROM signature_audit_log
      WHERE (@file_hash_supplied = 0 OR doc_hash = @file_hash)
        AND (@fingerprint_supplied = 0 OR signed_by_fingerprint = @fingerprint)
        AND (@since_supplied = 0 OR signed_at >= @since)
        AND (@until_supplied = 0 OR signed_at <= @until)
      ORDER BY signed_at DESC, id ASC
      LIMIT @limit OFFSET @offset`,
  );

  // Companion total-count statement for listAll's pagination shape. Same
  // toggle pattern so the count matches the page.
  const listAllCountStmt = db.prepare<
    {
      file_hash: string;
      file_hash_supplied: number;
      fingerprint: string;
      fingerprint_supplied: number;
      since: number;
      since_supplied: number;
      until: number;
      until_supplied: number;
    },
    { c: number }
  >(
    `SELECT COUNT(*) AS c
       FROM signature_audit_log
      WHERE (@file_hash_supplied = 0 OR doc_hash = @file_hash)
        AND (@fingerprint_supplied = 0 OR signed_by_fingerprint = @fingerprint)
        AND (@since_supplied = 0 OR signed_at >= @since)
        AND (@until_supplied = 0 OR signed_at <= @until)`,
  );

  const existsByDocAndOffsetStmt = db.prepare<
    { doc_hash: string; sig_bytes_offset: number },
    { id: number }
  >(
    `SELECT id FROM signature_audit_log
      WHERE doc_hash = @doc_hash AND sig_bytes_offset = @sig_bytes_offset
      LIMIT 1`,
  );

  const deleteStmt = db.prepare<{ id: number }>(`DELETE FROM signature_audit_log WHERE id = @id`);

  // Phase 5 — OCR cross-link. The UPDATE is keyed by id and only touches the
  // additive Phase-5 column; Phase-4 columns are not affected. The bridge
  // calls this in a transaction wrapping the OCR-completed handler so the
  // mark + the ocr_jobs.status='completed' write commit atomically.
  const markInvalidatedStmt = db.prepare<{
    id: number;
    ocr_job_id: number;
  }>(
    `UPDATE signature_audit_log
        SET invalidated_by_ocr_job_id = @ocr_job_id
      WHERE id = @id`,
  );

  const listInvalidatedByOcrJobStmt = db.prepare<{ ocr_job_id: number }, SignatureAuditRow>(
    `SELECT id, doc_hash, pre_sign_doc_hash, signed_at, signature_kind,
            signed_by_fingerprint, signed_by_subject_cn, signed_by_issuer_cn,
            cert_not_before, cert_not_after,
            tsa_url, tsa_response_status,
            sig_bytes_offset, sig_bytes_length, byte_range_json,
            reason, location, field_name, created_at,
            invalidated_by_ocr_job_id
       FROM signature_audit_log
      WHERE invalidated_by_ocr_job_id = @ocr_job_id
      ORDER BY signed_at DESC, id ASC`,
  );

  return {
    insert(input: InsertSignatureAuditInput): InsertSignatureAuditResult {
      assertNonEmptyString(input.doc_hash, 'doc_hash');
      assertNonEmptyString(input.pre_sign_doc_hash, 'pre_sign_doc_hash');
      assertValidTimestamp(input.signed_at, 'signed_at');
      assertSignatureKind(input.signature_kind);
      assertOptionalTimestamp(input.cert_not_before, 'cert_not_before');
      assertOptionalTimestamp(input.cert_not_after, 'cert_not_after');
      assertOptionalNonNegativeInt(input.sig_bytes_offset, 'sig_bytes_offset');
      assertOptionalNonNegativeInt(input.sig_bytes_length, 'sig_bytes_length');
      assertOptionalTsaStatus(input.tsa_response_status);

      const now = Date.now();

      // Wrap in a transaction so the existence-check + insert are atomic and
      // we can return `duplicate` without try/catch around the UNIQUE
      // constraint message — same pattern as form-templates-repo's
      // name-collision path (Wave 12).
      const txn = db.transaction((): InsertSignatureAuditResult => {
        // Visual signatures (sig_bytes_offset = NULL) never collide because
        // SQLite UNIQUE treats NULL != NULL. Only pre-check for PAdES rows.
        if (input.sig_bytes_offset !== null) {
          const existing = existsByDocAndOffsetStmt.get({
            doc_hash: input.doc_hash,
            sig_bytes_offset: input.sig_bytes_offset,
          });
          if (existing) {
            return { ok: false, error: 'duplicate' };
          }
        }

        const result = insertStmt.run({
          doc_hash: input.doc_hash,
          pre_sign_doc_hash: input.pre_sign_doc_hash,
          signed_at: input.signed_at,
          signature_kind: input.signature_kind,
          signed_by_fingerprint: input.signed_by_fingerprint,
          signed_by_subject_cn: input.signed_by_subject_cn,
          signed_by_issuer_cn: input.signed_by_issuer_cn,
          cert_not_before: input.cert_not_before,
          cert_not_after: input.cert_not_after,
          tsa_url: input.tsa_url,
          tsa_response_status: input.tsa_response_status,
          sig_bytes_offset: input.sig_bytes_offset,
          sig_bytes_length: input.sig_bytes_length,
          byte_range_json: input.byte_range_json,
          reason: input.reason,
          location: input.location,
          field_name: input.field_name,
          created_at: input.created_at ?? now,
        });

        // better-sqlite3 returns lastInsertRowid as number | bigint depending on
        // platform. AUTOINCREMENT integers below 2^53 fit safely in number —
        // same handling as form-templates-repo (Wave 12).
        const rowid = result.lastInsertRowid;
        const id = typeof rowid === 'bigint' ? Number(rowid) : rowid;
        return { ok: true, id };
      });

      return txn();
    },

    get(id: number): SignatureAuditRow | null {
      assertValidId(id, 'id');
      return getStmt.get({ id }) ?? null;
    },

    listByDocHash(docHash: string, limit: number = DEFAULT_LIMIT, offset = 0): SignatureAuditRow[] {
      assertNonEmptyString(docHash, 'docHash');
      return listByDocHashStmt.all({
        doc_hash: docHash,
        limit: clampLimit(limit),
        offset: clampOffset(offset),
      });
    },

    listByPreSignDocHash(
      preSignDocHash: string,
      limit: number = DEFAULT_LIMIT,
      offset = 0,
    ): SignatureAuditRow[] {
      assertNonEmptyString(preSignDocHash, 'preSignDocHash');
      return listByPreSignDocHashStmt.all({
        pre_sign_doc_hash: preSignDocHash,
        limit: clampLimit(limit),
        offset: clampOffset(offset),
      });
    },

    listByFingerprint(
      fingerprint: string,
      since?: number,
      until?: number,
      limit: number = DEFAULT_LIMIT,
      offset = 0,
    ): SignatureAuditRow[] {
      assertNonEmptyString(fingerprint, 'fingerprint');
      // Open-ended bounds default to the full representable range; the index
      // on signed_at keeps either bound cheap.
      const lower = since ?? Number.MIN_SAFE_INTEGER;
      const upper = until ?? Number.MAX_SAFE_INTEGER;
      assertWindow(lower, upper);
      return listByFingerprintStmt.all({
        fingerprint,
        since: lower,
        until: upper,
        limit: clampLimit(limit),
        offset: clampOffset(offset),
      });
    },

    listAll(filters: ListAllFilters, limit: number = DEFAULT_LIMIT, offset = 0): ListAllResult {
      const fileHashSupplied = filters.fileHash !== undefined ? 1 : 0;
      const fingerprintSupplied = filters.signedByFingerprint !== undefined ? 1 : 0;
      const sinceSupplied = filters.since !== undefined ? 1 : 0;
      const untilSupplied = filters.until !== undefined ? 1 : 0;

      if (fileHashSupplied) assertNonEmptyString(filters.fileHash ?? '', 'fileHash');
      if (fingerprintSupplied)
        assertNonEmptyString(filters.signedByFingerprint ?? '', 'signedByFingerprint');
      if (sinceSupplied) assertValidTimestamp(filters.since ?? 0, 'since');
      if (untilSupplied) assertValidTimestamp(filters.until ?? 0, 'until');
      if (sinceSupplied && untilSupplied) {
        assertWindow(filters.since ?? 0, filters.until ?? 0);
      }

      const safeLimit = clampLimit(limit);
      const safeOffset = clampOffset(offset);

      const params = {
        file_hash: filters.fileHash ?? '',
        file_hash_supplied: fileHashSupplied,
        fingerprint: filters.signedByFingerprint ?? '',
        fingerprint_supplied: fingerprintSupplied,
        since: filters.since ?? 0,
        since_supplied: sinceSupplied,
        until: filters.until ?? 0,
        until_supplied: untilSupplied,
      };

      // Read items + total inside an implicit transaction (better-sqlite3
      // gives us read-consistency for the duration of a single .get/.all call,
      // but we still want the count to align with the page — bundle the two).
      const fetch = db.transaction(() => {
        const items = listAllStmt.all({ ...params, limit: safeLimit, offset: safeOffset });
        const countRow = listAllCountStmt.get(params);
        return { items, total: countRow?.c ?? 0 };
      });

      return fetch();
    },

    delete(id: number): boolean {
      assertValidId(id, 'id');
      const result = deleteStmt.run({ id });
      return result.changes > 0;
    },

    markInvalidatedByOcrJob(rowIds: number[], ocrJobId: number): number {
      if (!Array.isArray(rowIds)) {
        throw new Error('rowIds must be an array of positive integers');
      }
      assertValidId(ocrJobId, 'ocrJobId');
      if (rowIds.length === 0) return 0;
      for (const id of rowIds) {
        assertValidId(id, 'rowIds[]');
      }

      // Wrap the per-row UPDATEs in a transaction. better-sqlite3's prepared
      // statement is per-row; the txn batches them into one fsync so a bulk
      // mark of N signatures is one disk write rather than N. This mirrors
      // the bookmarks-repo bulk-update pattern (Wave 7).
      const apply = db.transaction((ids: number[]): number => {
        let changed = 0;
        for (const id of ids) {
          const result = markInvalidatedStmt.run({ id, ocr_job_id: ocrJobId });
          changed += result.changes;
        }
        return changed;
      });
      return apply(rowIds);
    },

    listInvalidatedByOcrJob(ocrJobId: number): SignatureAuditRow[] {
      assertValidId(ocrJobId, 'ocrJobId');
      return listInvalidatedByOcrJobStmt.all({ ocr_job_id: ocrJobId });
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

function assertOptionalNonNegativeInt(n: number | null, label: string): void {
  if (n === null) return;
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer or null`);
  }
}

function assertValidId(id: number, label: string): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label}: ${String(id)} (must be positive integer)`);
  }
}

function assertSignatureKind(k: string): void {
  if (k !== 'visual' && k !== 'pades' && k !== 'pades-tsa') {
    throw new Error(`signature_kind must be 'visual' | 'pades' | 'pades-tsa' (got ${String(k)})`);
  }
}

function assertOptionalTsaStatus(s: 'ok' | 'failed' | null): void {
  if (s === null) return;
  if (s !== 'ok' && s !== 'failed') {
    throw new Error(`tsa_response_status must be 'ok' | 'failed' | null (got ${String(s)})`);
  }
}

function assertWindow(lower: number, upper: number): void {
  if (lower > upper) {
    throw new Error(`signed_at window invalid: since=${String(lower)} > until=${String(upper)}`);
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
