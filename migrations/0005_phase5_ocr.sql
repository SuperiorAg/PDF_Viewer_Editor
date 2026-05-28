-- ============================================================
-- 0005_phase5_ocr.sql — Phase 5 OCR + language packs
--
-- Canonical reference: docs/data-models.md §10.4 + docs/architecture-phase-5.md §5.1
-- + docs/ocr-engine.md §4 (language-pack lifecycle) and §7 (job lifecycle).
-- If this file and any of those docs disagree, the doc wins; open a
-- Marcus-approved amendment to update both.
--
-- Adds (Phase 5):
--   * ocr_jobs       — one row per OCR run (queued/running/completed/cancelled/
--                      failed/superseded_by_undo); doubles as in-progress
--                      tracking + historical audit.
--   * ocr_results    — one row per (job, page) on completed jobs; carries the
--                      word-level data as a JSON blob (parsed on demand by the
--                      application layer per data-models §10.4.2).
--   * language_packs — installed-pack manifest (bundled + downloaded).
--                      `file_path` is main-only; the bridge strips it from the
--                      renderer-facing DTO per data-models §10.1 boundary rule.
--   * ALTER TABLE signature_audit_log ADD COLUMN invalidated_by_ocr_job_id
--     INTEGER REFERENCES ocr_jobs(id) — additive nullable column linking a
--     Phase-4 signature audit row to the Phase-5 OCR job that invalidated it
--     (architecture-phase-5.md §6). Pre-Phase-5 rows have NULL = "not
--     invalidated by OCR".
--
-- Indexes (data-models §10.4):
--   * idx_ocr_jobs_doc_hash, idx_ocr_jobs_status, idx_ocr_jobs_started_at
--   * idx_ocr_results_job_id
--   * idx_language_packs_source
--   * idx_signature_audit_log_invalidated_by_ocr_job_id (FK)
--
-- The schema_migrations(version=5, applied_at=...) row is written by the runner
-- (src/db/migrate.ts) inside the wrapping transaction — matching the 0001 +
-- 0002 + 0003 + 0004 convention. Including an explicit INSERT here would
-- PRIMARY KEY-conflict the runner's record on every retry (cf. Wave 7 + Wave 12
-- + Wave 16 takeaways, build-report "Schema delta" entries).
--
-- ON DELETE CASCADE on ocr_results.job_id -> ocr_jobs.id per phase-5 brief —
-- removing an OCR job removes its per-page results in the same transaction.
-- The signature_audit_log FK is NOT ON DELETE CASCADE: deleting an OCR job
-- should leave the signature audit row intact with invalidated_by_ocr_job_id
-- preserved (history-of-invalidation survives even if the job row is purged).
-- SQLite's default ON DELETE NO ACTION suffices.
--
-- Forward-only per migrations/README.md "Rollback".
-- ============================================================

-- ocr_jobs: one row per OCR run.
--
-- Column shape mirrors docs/data-models.md §10.4 verbatim — Ravi's repo +
-- David's bridge depend on the column names not drifting from the spec.
--
-- `doc_hash`               — SHA-256 of the doc bytes when the job started.
--                            The audit panel filters by this column.
-- `page_range_start/end`   — inclusive 0-based page indices.
-- `langs`                  — '+'-joined Tesseract lang codes, normalized
--                            lowercase ('eng', 'eng+spa', 'eng+spa+fra').
--                            Multi-lang runs preserve the joined key per
--                            phase-5-plan.md §7 worker-pool eviction note.
-- `preprocess_json`        — JSON-encoded PreprocessOptions; repo stores
--                            verbatim, bridge parses (same convention as
--                            form_templates.fields_json).
-- `status`                 — six-valued discriminant (CHECK guard).
-- `started_at`             — ms epoch; set at INSERT (queued).
-- `completed_at`           — ms epoch; NULL until terminal status.
-- `mean_confidence`        — REAL 0..100; NULL until completed.
-- `total_words`            — count; NULL until completed.
-- `error_message`          — non-NULL only when status='failed'.
-- `invalidated_signatures` — 0/1; 1 when a PAdES widget was present pre-run
--                            (phase-5 §6 PAdES interaction). NOT NULL with
--                            CHECK + default 0 so the audit panel can do
--                            fast WHERE invalidated_signatures = 1 lookups.
-- `created_at`             — ms epoch (defaulted by repo to Date.now()).
CREATE TABLE IF NOT EXISTS ocr_jobs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_hash                 TEXT    NOT NULL,
  page_range_start         INTEGER NOT NULL,
  page_range_end           INTEGER NOT NULL,
  langs                    TEXT    NOT NULL,
  preprocess_json          TEXT    NOT NULL,
  status                   TEXT    NOT NULL
                           CHECK (status IN
                                  ('queued', 'running', 'completed',
                                   'cancelled', 'failed', 'superseded_by_undo')),
  started_at               INTEGER NOT NULL,
  completed_at             INTEGER,
  mean_confidence          REAL,
  total_words              INTEGER,
  error_message            TEXT,
  invalidated_signatures   INTEGER NOT NULL DEFAULT 0
                           CHECK (invalidated_signatures IN (0, 1)),
  created_at               INTEGER NOT NULL
);

-- Doc-hash filter for the "OCR jobs on the file currently open" panel surface.
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_doc_hash
  ON ocr_jobs (doc_hash);

-- Status filter for the "running jobs" / "failed jobs" surfaces.
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status
  ON ocr_jobs (status);

-- Chronological default sort for the audit panel; DESC matches list() ordering.
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_started_at
  ON ocr_jobs (started_at DESC);


-- ocr_results: one row per (job, page) on completed jobs.
--
-- `job_id`               — FK to ocr_jobs.id. ON DELETE CASCADE clears per-
--                          page results when the parent job is removed.
-- `page_index`           — 0-based; UNIQUE within (job_id, page_index).
-- `total_words`          — count of recognized words on the page.
-- `low_confidence_words` — count below the threshold AT RUN time. The raw
--                          per-word confidence in words_json is preserved so
--                          re-rendering against a different threshold doesn't
--                          require re-OCR (ocr-engine.md §confidence).
-- `mean_confidence`      — REAL 0..100; arithmetic mean across words on page.
-- `words_json`           — JSON-encoded OcrWord[]; repo stores verbatim,
--                          bridge / consumers parse on demand. Per data-models
--                          §10.4.2, single-table JSON blob avoids a 5th table
--                          with thousands of word rows per page.
-- `img_width/height_px`  — raster dimensions used for OCR (px).
-- `duration_ms`          — per-page recognition wall-clock.
-- `created_at`           — ms epoch.
CREATE TABLE IF NOT EXISTS ocr_results (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id                   INTEGER NOT NULL
                           REFERENCES ocr_jobs(id) ON DELETE CASCADE,
  page_index               INTEGER NOT NULL,
  total_words              INTEGER NOT NULL,
  low_confidence_words     INTEGER NOT NULL,
  mean_confidence          REAL    NOT NULL,
  words_json               TEXT    NOT NULL,
  img_width_px             INTEGER NOT NULL,
  img_height_px            INTEGER NOT NULL,
  duration_ms              INTEGER NOT NULL,
  created_at               INTEGER NOT NULL,
  UNIQUE (job_id, page_index)
);

-- FK lookup index; covers the listByJobId read path.
CREATE INDEX IF NOT EXISTS idx_ocr_results_job_id
  ON ocr_results (job_id);


-- language_packs: installed-pack manifest.
--
-- `lang`         — Tesseract lang code (ISO 639-2/3 letter, optionally suffixed
--                  with a Tesseract variant like 'chi_tra'). PRIMARY KEY by
--                  intent — one row per installed pack; no autoincrement.
-- `source`       — 'bundled' (ships with the app) | 'downloaded' (lazy-pulled
--                  from upstream after first-use).
-- `file_path`    — absolute path on disk. NEVER echoed to renderer; data-models
--                  §10.1 + §10.8 boundary discipline.
-- `size_bytes`   — pack size; used for "you are about to download 12MB" UI.
-- `sha256`       — 64-hex pack hash; verified at download + at every load.
-- `installed_at` — ms epoch (download time OR first-launch bundle registration).
-- `last_used_at` — ms epoch; NULL if never used. Updated by touchLastUsed() on
--                  every OCR run that loads the pack — drives "least-recently-
--                  used eviction" candidate selection in Phase 5.2 if disk
--                  pressure becomes a thing.
CREATE TABLE IF NOT EXISTS language_packs (
  lang                     TEXT    PRIMARY KEY,
  source                   TEXT    NOT NULL
                           CHECK (source IN ('bundled', 'downloaded')),
  file_path                TEXT    NOT NULL,
  size_bytes               INTEGER NOT NULL,
  sha256                   TEXT    NOT NULL,
  installed_at             INTEGER NOT NULL,
  last_used_at             INTEGER
);

-- Source filter for the Settings → Language Packs surface
-- ("Installed (bundled)" vs "Installed (downloaded)" sections).
CREATE INDEX IF NOT EXISTS idx_language_packs_source
  ON language_packs (source);


-- ============================================================
-- Phase 4 additive amendment — signature_audit_log
--
-- Per data-models.md §10.10: a nullable column links a Phase-4 signature audit
-- row to the Phase-5 OCR job that invalidated it. Pre-Phase-5 rows default to
-- NULL ("not invalidated by OCR"). This is the ONLY Phase-4 surface change
-- permitted by the Phase-5 freeze — purely additive (nullable column, nullable
-- field). The signature_audit_log table itself was created in 0004 and is
-- unchanged otherwise.
--
-- IF NOT EXISTS is NOT supported by SQLite ALTER TABLE ADD COLUMN as a syntax
-- form. We rely on the migration runner's watermark to ensure this DDL runs
-- exactly once. If 0005 is replayed against a database that already has the
-- column (manual recovery scenario), the runner raises and the user re-clones
-- the DB — same posture as every prior migration.
-- ============================================================

ALTER TABLE signature_audit_log
  ADD COLUMN invalidated_by_ocr_job_id INTEGER
             REFERENCES ocr_jobs(id);

-- FK lookup index — supports listInvalidatedByOcrJob and the signature audit
-- panel's "Invalidated by OCR (job #N)" badge query.
CREATE INDEX IF NOT EXISTS idx_signature_audit_log_invalidated_by_ocr_job_id
  ON signature_audit_log (invalidated_by_ocr_job_id);
