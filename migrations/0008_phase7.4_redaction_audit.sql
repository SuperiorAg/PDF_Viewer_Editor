-- ============================================================
-- 0008_phase7.4_redaction_audit.sql — Phase 7.4 B1 redaction audit cross-link
--
-- Canonical reference: docs/phase-7.4-b1-redaction-design.md §5
-- (PAdES interaction). If this file and that design disagree, the design wins;
-- open a Riley-/Marcus-approved amendment to update both.
--
-- Adds (Phase 7.4 B1):
--   * ALTER TABLE signature_audit_log ADD COLUMN invalidated_by_redaction_at
--     INTEGER — additive nullable column flagging a Phase-4 signature audit row
--     as invalidated by a Phase-7.4 redaction operation. Carries the ms epoch
--     at which the redaction Apply ran. NULL = "not invalidated by redaction".
--   * Partial index idx_signature_audit_log_invalidated_by_redaction_at —
--     supports the audit panel's "Invalidated by redaction on YYYY-MM-DD"
--     badge surface (design §5.4) and the optional reverse-lookup ("which
--     signatures did this redaction invalidate?"). Partial-where clause keeps
--     the index tiny for the common case where most rows are not redaction-
--     invalidated.
--
-- WHY a timestamp column and NOT a parallel `redaction_jobs` table
-- (design §5.3 rationale): redaction has no long-running job lifecycle — it
-- is a synchronous one-shot operation within a single IPC round-trip. Phase 5
-- OCR's `invalidated_by_ocr_job_id` is an FK to a long-running job; redaction
-- has no equivalent state machine. A nullable timestamp is the minimal schema
-- delta and upgrades cleanly to an FK if a future Phase 7.5 introduces
-- background redaction jobs.
--
-- WHY a separate column and NOT a generic `invalidated_at`: the audit log
-- distinguishes invalidation provenance (which subsystem touched the bytes)
-- because the user-facing surface treats them differently — the OCR badge
-- reads "Invalidated by OCR (job #N)" while the redaction badge reads
-- "Invalidated by redaction on YYYY-MM-DD". A single column would force the
-- bridge to disambiguate; per-cause columns let the SELECT speak for itself.
-- The two columns CAN co-exist on one row (a signature can be invalidated by
-- both OCR and redaction at different points in the doc's history).
--
-- Forward-only per migrations/README.md "Rollback".
--
-- The schema_migrations(version=8, applied_at=...) row is written by the
-- runner (src/db/migrate.ts) inside the wrapping transaction — matching the
-- 0001..0007 convention. Including an explicit INSERT here would PRIMARY
-- KEY-conflict the runner's record on every retry (cf. Wave 7/12/16/20/24
-- takeaways).
--
-- IF NOT EXISTS is NOT supported by SQLite ALTER TABLE ADD COLUMN as a syntax
-- form. We rely on the migration runner's watermark to ensure this DDL runs
-- exactly once. If 0008 is replayed against a database that already has the
-- column (manual recovery scenario), the runner raises and the user re-clones
-- the DB — same posture as every prior migration.
--
-- Anti-sentinel discipline (the four-times-bitten 2026-05-26 lesson):
-- `invalidated_by_redaction_at` is nullable; NULL means "not invalidated by
-- redaction". No sentinel `0` / `-1`. The audit-panel selector pattern-matches
-- `invalidatedByRedactionAt === null` to decide whether to render the badge.
-- ============================================================

ALTER TABLE signature_audit_log
  ADD COLUMN invalidated_by_redaction_at INTEGER;

-- Partial index — supports the audit-panel "invalidated by redaction" badge
-- query and any future reverse-lookup. WHERE clause keeps the index sparse so
-- the common case (no redaction) costs nothing on insert/update.
CREATE INDEX IF NOT EXISTS idx_signature_audit_log_invalidated_by_redaction_at
  ON signature_audit_log (invalidated_by_redaction_at)
  WHERE invalidated_by_redaction_at IS NOT NULL;
