// Form-templates repository.
//
// Backs the `forms:listTemplates`, `forms:saveTemplate`, `forms:loadTemplate`
// IPC channels (docs/api-contracts.md §13.6-§13.8) and the form_templates
// table (docs/data-models.md §8.4 + docs/architecture-phase-3.md §7).
//
// Cross-file: templates are keyed by `id`, not by `file_hash`. A template
// authored against one PDF can be applied to any other PDF — see
// architecture-phase-3.md §7.3 for the rationale.
//
// JSON columns: `fields_json` and `last_column_mappings` are stored as TEXT
// and the repo NEVER parses/serializes them. The bridge adapter
// (`src/main/db-bridge.ts`, David) handles the JSON boundary so the repo stays
// a pure SQL-row passthrough. Callers (= the bridge) own the contract that the
// strings round-trip cleanly.
//
// Method surface (data-models §8.6, architecture-phase-3.md §7.4):
//   * list()                        — all templates, ordered by updated_at DESC
//   * get(id)                       — single template by id, or null
//   * getByName(name)               — single template by UNIQUE name, or null
//   * upsert(row)                   — insert-or-update; returns id
//   * delete(id)                    — true if removed
//   * updateColumnMappings(id, ...) — convenience for mail-merge persistence
//
// Error reporting: `upsert` returns a discriminated union so the bridge can
// distinguish `name_in_use` (UNIQUE collision on insert) from generic SQL
// failures, mirroring the Wave 7 / Wave 8.5 lesson on cycle_detected. The
// other methods don't have multi-mode failure semantics — `delete` and
// `updateColumnMappings` return boolean (true = changed, false = no-op), and
// `get` / `getByName` return null for not-found.

import type BetterSqlite3 from 'better-sqlite3';

import type { FormTemplateRow } from '../types';

// ============================================================
// Public shape
// ============================================================

export interface UpsertFormTemplateInput {
  /** Present → update by id. Absent → insert; name UNIQUE collisions return `name_in_use`. */
  id?: number;
  name: string;
  /** JSON-encoded `FormFieldDefinition[]`. The bridge serializes; repo stores verbatim. */
  fields_json: string;
  source_doc_hash: string | null;
  /** JSON-encoded `Record<columnName, fieldName>`; nullable. */
  last_column_mappings: string | null;
  /** Optional override; defaults to Date.now() on insert. Preserved on update. */
  created_at?: number;
  /** Optional override; defaults to Date.now() on insert AND update. */
  updated_at?: number;
}

/**
 * Discriminated result for `upsert`. We surface UNIQUE-name collisions as a
 * typed error variant so the IPC handler (`forms:saveTemplate`, api-contracts
 * §13.7) can map directly to its `name_in_use` error code without try/catch
 * acrobatics or string-matching the better-sqlite3 message.
 *
 * `not_found` covers the "update with non-existent id" path; the IPC handler
 * surfaces that as `invalid_payload` (no separate code in §13.7 for it; the
 * renderer should never request an update of a missing template — that would
 * indicate a stale id in the picker).
 */
export type UpsertFormTemplateResult =
  | { ok: true; id: number }
  | { ok: false; error: 'name_in_use' | 'not_found' };

export interface FormTemplatesRepo {
  /** All templates, ordered by updated_at DESC (most-recently-used first). */
  list(): FormTemplateRow[];

  /** Lookup by primary key. Null if not found. */
  get(id: number): FormTemplateRow | null;

  /** Lookup by UNIQUE name. Null if not found. */
  getByName(name: string): FormTemplateRow | null;

  /**
   * Insert-or-update. Returns a discriminated union so the IPC layer can map
   * the UNIQUE-name collision to `name_in_use` cleanly (api-contracts §13.7).
   *
   *   * `id` present → UPDATE that row. `updated_at` bumps to `Date.now()`
   *     unless the caller supplies an override. `created_at` is preserved.
   *   * `id` absent → INSERT. If `name` already exists, returns
   *     `{ ok: false, error: 'name_in_use' }` WITHOUT inserting.
   */
  upsert(input: UpsertFormTemplateInput): UpsertFormTemplateResult;

  /** Delete by id. Returns true if a row was removed. */
  delete(id: number): boolean;

  /**
   * Persist the column-mapping snapshot from a successful mail-merge run.
   * Bumps `updated_at`. Returns true if the row exists and was updated.
   *
   * The `mappings` value is JSON.stringify'd by the bridge; we accept the
   * raw object here for symmetry with `upsert(last_column_mappings)` which
   * accepts the pre-serialized TEXT. Both shapes end up in the same column.
   */
  updateColumnMappings(id: number, mappings: Record<string, string>): boolean;
}

// ============================================================
// Factory
// ============================================================

export function createFormTemplatesRepo(db: BetterSqlite3.Database): FormTemplatesRepo {
  const listStmt = db.prepare<[], FormTemplateRow>(
    `SELECT id, name, fields_json, source_doc_hash, last_column_mappings, created_at, updated_at
       FROM form_templates
      ORDER BY updated_at DESC, id DESC`,
  );

  const getStmt = db.prepare<{ id: number }, FormTemplateRow>(
    `SELECT id, name, fields_json, source_doc_hash, last_column_mappings, created_at, updated_at
       FROM form_templates
      WHERE id = @id
      LIMIT 1`,
  );

  const getByNameStmt = db.prepare<{ name: string }, FormTemplateRow>(
    `SELECT id, name, fields_json, source_doc_hash, last_column_mappings, created_at, updated_at
       FROM form_templates
      WHERE name = @name
      LIMIT 1`,
  );

  const insertStmt = db.prepare<{
    name: string;
    fields_json: string;
    source_doc_hash: string | null;
    last_column_mappings: string | null;
    created_at: number;
    updated_at: number;
  }>(
    `INSERT INTO form_templates
        (name, fields_json, source_doc_hash, last_column_mappings, created_at, updated_at)
      VALUES
        (@name, @fields_json, @source_doc_hash, @last_column_mappings, @created_at, @updated_at)`,
  );

  // Update path keeps created_at untouched (preserve original authoring time);
  // updated_at bumps unconditionally.
  const updateStmt = db.prepare<{
    id: number;
    name: string;
    fields_json: string;
    source_doc_hash: string | null;
    last_column_mappings: string | null;
    updated_at: number;
  }>(
    `UPDATE form_templates
        SET name                 = @name,
            fields_json          = @fields_json,
            source_doc_hash      = @source_doc_hash,
            last_column_mappings = @last_column_mappings,
            updated_at           = @updated_at
      WHERE id = @id`,
  );

  const deleteStmt = db.prepare<{ id: number }>(`DELETE FROM form_templates WHERE id = @id`);

  const updateMappingsStmt = db.prepare<{
    id: number;
    last_column_mappings: string;
    updated_at: number;
  }>(
    `UPDATE form_templates
        SET last_column_mappings = @last_column_mappings,
            updated_at           = @updated_at
      WHERE id = @id`,
  );

  // Used inside the upsert transaction to spot UNIQUE-name collisions BEFORE
  // attempting the insert — the SQLite UNIQUE constraint also catches it,
  // but checking first lets us return a typed error without try/catch around
  // a constraint message.
  const nameExistsStmt = db.prepare<{ name: string }, { id: number }>(
    `SELECT id FROM form_templates WHERE name = @name LIMIT 1`,
  );

  return {
    list(): FormTemplateRow[] {
      return listStmt.all();
    },

    get(id: number): FormTemplateRow | null {
      assertValidId(id, 'id');
      return getStmt.get({ id }) ?? null;
    },

    getByName(name: string): FormTemplateRow | null {
      assertNonEmptyName(name);
      return getByNameStmt.get({ name }) ?? null;
    },

    upsert(input: UpsertFormTemplateInput): UpsertFormTemplateResult {
      assertNonEmptyName(input.name);
      if (typeof input.fields_json !== 'string') {
        throw new Error('fields_json must be a string (JSON-encoded FormFieldDefinition[])');
      }
      if (input.last_column_mappings !== null && typeof input.last_column_mappings !== 'string') {
        throw new Error('last_column_mappings must be a string or null');
      }
      if (input.id !== undefined) assertValidId(input.id, 'id');

      // Wrap in a transaction so the name-collision-check + insert are atomic
      // (no race with a concurrent insert, even though main-process is
      // single-threaded — defensive against future preload-side callers).
      const now = Date.now();

      const txn = db.transaction((): UpsertFormTemplateResult => {
        if (input.id !== undefined) {
          // UPDATE path. If a different row already owns this name, the UNIQUE
          // constraint would fire — surface it as `name_in_use` proactively.
          const conflict = nameExistsStmt.get({ name: input.name });
          if (conflict && conflict.id !== input.id) {
            return { ok: false, error: 'name_in_use' };
          }
          const result = updateStmt.run({
            id: input.id,
            name: input.name,
            fields_json: input.fields_json,
            source_doc_hash: input.source_doc_hash,
            last_column_mappings: input.last_column_mappings,
            updated_at: input.updated_at ?? now,
          });
          if (result.changes === 0) {
            return { ok: false, error: 'not_found' };
          }
          return { ok: true, id: input.id };
        }

        // INSERT path. Pre-check UNIQUE(name).
        const conflict = nameExistsStmt.get({ name: input.name });
        if (conflict) {
          return { ok: false, error: 'name_in_use' };
        }

        const result = insertStmt.run({
          name: input.name,
          fields_json: input.fields_json,
          source_doc_hash: input.source_doc_hash,
          last_column_mappings: input.last_column_mappings,
          created_at: input.created_at ?? now,
          updated_at: input.updated_at ?? now,
        });

        // better-sqlite3 returns lastInsertRowid as number | bigint depending
        // on platform. AUTOINCREMENT integers below 2^53 fit safely in number.
        const rowid = result.lastInsertRowid;
        const id = typeof rowid === 'bigint' ? Number(rowid) : rowid;
        return { ok: true, id };
      });

      return txn();
    },

    delete(id: number): boolean {
      assertValidId(id, 'id');
      const result = deleteStmt.run({ id });
      return result.changes > 0;
    },

    updateColumnMappings(id: number, mappings: Record<string, string>): boolean {
      assertValidId(id, 'id');
      if (mappings === null || typeof mappings !== 'object') {
        throw new Error('mappings must be a Record<string, string>');
      }
      // The repo serializes here for ergonomic symmetry with the bridge's
      // "object in, object out" expectation. `upsert` accepts the pre-encoded
      // TEXT because the bridge already has the JSON string in hand from the
      // template-save payload.
      const json = JSON.stringify(mappings);
      const result = updateMappingsStmt.run({
        id,
        last_column_mappings: json,
        updated_at: Date.now(),
      });
      return result.changes > 0;
    },
  };
}

// ============================================================
// Validators
// ============================================================

function assertNonEmptyName(name: string): void {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('Template name must be a non-empty string');
  }
}

function assertValidId(id: number, label: string): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label}: ${String(id)} (must be positive integer)`);
  }
}
