// Action Wizard scripts repository.
//
// Backs the B9 Action Wizard "saved scripts" picker + the `actionWizard:*`
// IPC handlers (David Phase 7.5). Pure functions over better-sqlite3 — no
// Electron API access, no singleton ownership.
//
// Canonical reference: docs/data-models.md §13.4.
//
// JSON column: `script_json` is stored as TEXT verbatim. The bridge parses
// to `ActionScript` (data-models §13.10) at the IPC boundary; repo NEVER
// parses (Wave 12/16/20/24 precedent). Validation of `script_json` shape +
// banned ops happens at the IPC zod schema, NOT here.
//
// Method surface:
//   * insert(input)       — INSERT a new script. Returns discriminated union
//                            ('name_in_use' on UNIQUE(name) collision).
//   * update(id, input)   — UPDATE script_json + schema_version + name on
//                            an existing row. Returns discriminated union
//                            ('not_found' | 'name_in_use').
//   * list()              — all rows, ordered last_run_at DESC NULLS LAST,
//                            then created_at DESC.
//   * getById(id)         — single row, or null.
//   * getByName(name)     — single row, or null.
//   * deleteById(id)      — DELETE; returns rows removed (0 if not found).
//   * recordRun(id, now?) — atomic: bump last_run_at to `now`, increment
//                            run_count. Returns new run_count, or null if
//                            id was unknown.

import type BetterSqlite3 from 'better-sqlite3';

import type { ActionWizardScriptRow } from '../types';

// ============================================================
// Public shape
// ============================================================

export interface InsertActionScriptInput {
  name: string;
  schema_version: number;
  /** JSON-encoded ActionScript body. Repo stores verbatim. */
  script_json: string;
  /** Optional override; defaults to Date.now() at insert time. */
  created_at?: number;
}

export type InsertActionScriptResult =
  | { ok: true; id: number }
  | { ok: false; error: 'name_in_use' };

export interface UpdateActionScriptInput {
  /** Optional rename; omit to keep the existing name. */
  name?: string;
  schema_version: number;
  script_json: string;
}

export type UpdateActionScriptResult =
  | { ok: true }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'name_in_use' };

export interface ActionWizardRepo {
  insert(input: InsertActionScriptInput): InsertActionScriptResult;
  update(id: number, input: UpdateActionScriptInput): UpdateActionScriptResult;
  list(): ActionWizardScriptRow[];
  getById(id: number): ActionWizardScriptRow | null;
  getByName(name: string): ActionWizardScriptRow | null;
  deleteById(id: number): number;
  /** Returns the new run_count, or null if id was unknown. */
  recordRun(id: number, now?: number): number | null;
}

// ============================================================
// Factory
// ============================================================

const SELECT_COLUMNS = `
  id, name, schema_version, script_json, created_at, last_run_at, run_count
`;

export function createActionWizardRepo(db: BetterSqlite3.Database): ActionWizardRepo {
  // last_run_at IS NULL ASC -> NULL last (the SQLite trick: false=0, true=1,
  // so non-null rows sort before null rows).
  const listStmt = db.prepare<[], ActionWizardScriptRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM action_wizard_scripts
      ORDER BY last_run_at IS NULL ASC, last_run_at DESC, created_at DESC, id DESC`,
  );

  const getByIdStmt = db.prepare<{ id: number }, ActionWizardScriptRow>(
    `SELECT ${SELECT_COLUMNS} FROM action_wizard_scripts WHERE id = @id LIMIT 1`,
  );

  const getByNameStmt = db.prepare<{ name: string }, ActionWizardScriptRow>(
    `SELECT ${SELECT_COLUMNS} FROM action_wizard_scripts WHERE name = @name LIMIT 1`,
  );

  const nameExistsStmt = db.prepare<{ name: string }, { id: number }>(
    `SELECT id FROM action_wizard_scripts WHERE name = @name LIMIT 1`,
  );

  const insertStmt = db.prepare<{
    name: string;
    schema_version: number;
    script_json: string;
    created_at: number;
  }>(
    `INSERT INTO action_wizard_scripts
        (name, schema_version, script_json, created_at, last_run_at, run_count)
       VALUES (@name, @schema_version, @script_json, @created_at, NULL, 0)`,
  );

  const updateStmt = db.prepare<{
    id: number;
    name: string;
    schema_version: number;
    script_json: string;
  }>(
    `UPDATE action_wizard_scripts
        SET name = @name,
            schema_version = @schema_version,
            script_json = @script_json
      WHERE id = @id`,
  );

  const deleteStmt = db.prepare<{ id: number }>(`DELETE FROM action_wizard_scripts WHERE id = @id`);

  const recordRunStmt = db.prepare<{ id: number; now: number }>(
    `UPDATE action_wizard_scripts
        SET last_run_at = @now,
            run_count   = run_count + 1
      WHERE id = @id`,
  );

  const getRunCountStmt = db.prepare<{ id: number }, { run_count: number }>(
    `SELECT run_count FROM action_wizard_scripts WHERE id = @id LIMIT 1`,
  );

  return {
    insert(input: InsertActionScriptInput): InsertActionScriptResult {
      assertInsertPayload(input);

      // Atomic existence-check + insert. Same pattern as Wave 12 form-templates.
      const txn = db.transaction((): InsertActionScriptResult => {
        if (nameExistsStmt.get({ name: input.name })) {
          return { ok: false, error: 'name_in_use' };
        }
        const result = insertStmt.run({
          name: input.name,
          schema_version: input.schema_version,
          script_json: input.script_json,
          created_at: input.created_at ?? Date.now(),
        });
        const rowid = result.lastInsertRowid;
        return { ok: true, id: typeof rowid === 'bigint' ? Number(rowid) : rowid };
      });
      return txn();
    },

    update(id: number, input: UpdateActionScriptInput): UpdateActionScriptResult {
      assertValidId(id, 'id');
      assertSchemaVersion(input.schema_version);
      assertNonEmptyString(input.script_json, 'script_json');

      const txn = db.transaction((): UpdateActionScriptResult => {
        const existing = getByIdStmt.get({ id });
        if (!existing) {
          return { ok: false, error: 'not_found' };
        }
        const nextName = input.name ?? existing.name;
        assertNonEmptyString(nextName, 'name');

        if (nextName !== existing.name) {
          const conflict = nameExistsStmt.get({ name: nextName });
          if (conflict) {
            return { ok: false, error: 'name_in_use' };
          }
        }

        updateStmt.run({
          id,
          name: nextName,
          schema_version: input.schema_version,
          script_json: input.script_json,
        });
        return { ok: true };
      });
      return txn();
    },

    list(): ActionWizardScriptRow[] {
      return listStmt.all();
    },

    getById(id: number): ActionWizardScriptRow | null {
      assertValidId(id, 'id');
      return getByIdStmt.get({ id }) ?? null;
    },

    getByName(name: string): ActionWizardScriptRow | null {
      assertNonEmptyString(name, 'name');
      return getByNameStmt.get({ name }) ?? null;
    },

    deleteById(id: number): number {
      assertValidId(id, 'id');
      return deleteStmt.run({ id }).changes;
    },

    recordRun(id: number, now: number = Date.now()): number | null {
      assertValidId(id, 'id');
      if (!Number.isFinite(now) || now < 0) {
        throw new Error('now must be a non-negative ms epoch');
      }
      const txn = db.transaction((): number | null => {
        const result = recordRunStmt.run({ id, now });
        if (result.changes === 0) {
          return null;
        }
        const row = getRunCountStmt.get({ id });
        return row?.run_count ?? null;
      });
      return txn();
    },
  };
}

// ============================================================
// Validators
// ============================================================

function assertInsertPayload(input: InsertActionScriptInput): void {
  assertNonEmptyString(input.name, 'name');
  assertSchemaVersion(input.schema_version);
  assertNonEmptyString(input.script_json, 'script_json');
}

function assertNonEmptyString(s: unknown, label: string): void {
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertSchemaVersion(n: number): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`schema_version must be an integer >= 1 (got ${String(n)})`);
  }
}

function assertValidId(id: number, label: string): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label}: ${String(id)} (must be positive integer)`);
  }
}
