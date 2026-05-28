-- ============================================================
-- 0004_phase4_signatures.sql — Phase 4 signature audit log
--
-- Canonical reference: docs/data-models.md §9.4 + docs/architecture-phase-4.md §6
-- + docs/signature-engine.md §8 (insert flow). If this file and any of those
-- docs disagree, the doc wins; open a Marcus-approved amendment to update both.
--
-- Adds:
--   * signature_audit_log table — local "what have I signed?" log written by the
--     signature engine after each successful sign op (visual or PAdES). The log
--     is NOT tamper-evident (data-models §9.4.3); it lives in the same SQLite
--     file as recents/bookmarks/templates and any process with write access can
--     forge rows. It is a convenience surface, not a notarization service.
--   * 4 indexes covering the four primary access paths:
--       - by doc_hash (audit panel filter to "this open file")
--       - by pre_sign_doc_hash (verify flow recomputing the byte-range hash)
--       - by signed_at DESC (chronological list, default sort)
--       - by signed_by_fingerprint (filter by signer cert)
--
-- The schema_migrations(version=4, applied_at=...) row is written by the runner
-- (src/db/migrate.ts) inside the wrapping transaction — matching the 0001 +
-- 0002 + 0003 convention. Including an explicit INSERT here would PRIMARY KEY-
-- conflict the runner's record on every retry (cf. Ravi Wave 7 + Wave 12
-- learnings, build-report "Deviations from data-models.md §7" entry 3).
--
-- UNIQUE (doc_hash, sig_bytes_offset) covers two scenarios (data-models §9.4.1):
--   * Same doc signed twice at the same field → second insert violates uniqueness
--   * Visual signatures have sig_bytes_offset = NULL; SQLite's UNIQUE semantics
--     treat NULL != NULL, so multiple visual signatures on the same doc coexist
--
-- Forward-only per migrations/README.md "Rollback".
-- ============================================================

-- signature_audit_log: one row per signature applied this session.
--
-- Column shape mirrors docs/data-models.md §9.4 verbatim — Ravi's repo + David's
-- bridge depend on the column names not drifting from the spec.
--
-- `doc_hash`              — SHA-256 of the SIGNED bytes (post-signing).
-- `pre_sign_doc_hash`     — SHA-256 of the bytes the engine actually signed
--                           (the byte-range hash input); lets verify-flow
--                           recompute without re-parsing the whole document.
-- `signed_at`             — ms epoch.
-- `signature_kind`        — 'visual' | 'pades' | 'pades-tsa'. CHECK guard.
-- `signed_by_fingerprint` — SHA-256 hex of the cert; NULL for visual.
-- `signed_by_subject_cn`  — Subject CN for display; NULL for visual.
-- `signed_by_issuer_cn`   — Issuer CN for display; NULL for visual.
-- `cert_not_before`       — ms epoch; NULL for visual.
-- `cert_not_after`        — ms epoch; NULL for visual.
-- `tsa_url`               — TSA URL used; NULL if no TSA hop attempted.
-- `tsa_response_status`   — 'ok' | 'failed' | NULL. CHECK guard with NULL allow.
-- `sig_bytes_offset`      — byte offset of /Contents in signed bytes; NULL for visual.
-- `sig_bytes_length`      — byte length of /Contents.
-- `byte_range_json`       — JSON-encoded [a, b, c, d]. Repo stores verbatim;
--                           the bridge parses at the IPC boundary.
-- `reason`                — user-supplied; PDF sig dict /Reason.
-- `location`              — user-supplied; PDF sig dict /Location.
-- `field_name`            — placeholder field name OR NULL for freeform.
-- `created_at`            — ms epoch.
CREATE TABLE IF NOT EXISTS signature_audit_log (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_hash                 TEXT    NOT NULL,
  pre_sign_doc_hash        TEXT    NOT NULL,
  signed_at                INTEGER NOT NULL,
  signature_kind           TEXT    NOT NULL
                           CHECK (signature_kind IN ('visual', 'pades', 'pades-tsa')),
  signed_by_fingerprint    TEXT,
  signed_by_subject_cn     TEXT,
  signed_by_issuer_cn      TEXT,
  cert_not_before          INTEGER,
  cert_not_after           INTEGER,
  tsa_url                  TEXT,
  tsa_response_status      TEXT
                           CHECK (tsa_response_status IS NULL
                                  OR tsa_response_status IN ('ok', 'failed')),
  sig_bytes_offset         INTEGER,
  sig_bytes_length         INTEGER,
  byte_range_json          TEXT,
  reason                   TEXT,
  location                 TEXT,
  field_name               TEXT,
  created_at               INTEGER NOT NULL,
  UNIQUE (doc_hash, sig_bytes_offset)
);

-- Doc-hash filter for the "signatures on the file currently open" panel surface.
CREATE INDEX IF NOT EXISTS idx_signature_audit_log_doc_hash
  ON signature_audit_log (doc_hash);

-- pre_sign_doc_hash filter for the verify flow (recompute over the byte-range).
CREATE INDEX IF NOT EXISTS idx_signature_audit_log_pre_sign_doc_hash
  ON signature_audit_log (pre_sign_doc_hash);

-- Chronological default sort for the audit panel; DESC matches list() ordering.
CREATE INDEX IF NOT EXISTS idx_signature_audit_log_signed_at
  ON signature_audit_log (signed_at DESC);

-- Filter by signer cert (audit-panel "signed by ME" / "by Issuer X" surfaces).
CREATE INDEX IF NOT EXISTS idx_signature_audit_log_fingerprint
  ON signature_audit_log (signed_by_fingerprint);
