-- ============================================================
-- 0003_phase3_forms.sql — Phase 3 form templates (cross-file)
--
-- Canonical reference: docs/data-models.md §8.4 + docs/architecture-phase-3.md §7.
-- If this file and either doc disagree, the doc wins; open a Marcus-approved
-- amendment to update both.
--
-- Adds:
--   * form_templates table — saved form-field definition collections, indexed by
--     a session-stable name. JSON-encoded `fields_json` (FormFieldDefinition[])
--     keeps the schema flat: most users have < 50 templates, so per-field rows
--     would be premature normalization (data-models §8.4.2).
--   * idx_form_templates_name        — name lookup for getByName + UNIQUE assist
--   * idx_form_templates_updated_at  — list() ordering ("recently used" surface)
--
-- The schema_migrations(version=3, applied_at=...) row is written by the runner
-- (src/db/migrate.ts) inside the wrapping transaction — matching the 0001 +
-- 0002 convention. Including an explicit INSERT here would PRIMARY KEY-conflict
-- the runner's record on every retry (cf. Ravi Wave 7 learning, build-report
-- "Deviations from data-models.md §7" entry 3).
--
-- Forward-only per migrations/README.md "Rollback".
-- ============================================================

-- form_templates: cross-file template storage. Templates are document-independent
-- so the renderer's "apply template" flow can author identical field collections
-- across many PDFs (data-models §8.4.2; architecture-phase-3.md §7.3).
--
-- `name`            — UNIQUE; collisions surface as `name_in_use` at the IPC
--                     layer (api-contracts §13.7).
-- `fields_json`     — JSON-encoded `FormFieldDefinition[]`. Parsing happens at
--                     the IPC boundary in `src/main/db-bridge.ts` (David's adapter).
-- `source_doc_hash` — Optional file_hash of the PDF the template was authored
--                     from. NULL for templates authored from scratch.
-- `last_column_mappings`
--                   — JSON-encoded `Record<columnName, fieldName>` from the
--                     previous mail-merge run. Populated by
--                     `updateColumnMappings` after a successful run so the next
--                     wizard surface pre-populates the mapping
--                     (architecture-phase-3.md §6.4).
CREATE TABLE IF NOT EXISTS form_templates (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL UNIQUE,
  fields_json          TEXT    NOT NULL,
  source_doc_hash      TEXT,
  last_column_mappings TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- Name lookup for getByName() and back-up for the UNIQUE constraint (SQLite
-- already creates an implicit index for UNIQUE, but the explicit name keeps
-- the EXPLAIN QUERY PLAN output legible).
CREATE INDEX IF NOT EXISTS idx_form_templates_name
  ON form_templates (name);

-- list() returns templates ordered by updated_at DESC (most-recently used
-- first) — the index keeps this O(log N) instead of a sort over the full table.
CREATE INDEX IF NOT EXISTS idx_form_templates_updated_at
  ON form_templates (updated_at DESC);
