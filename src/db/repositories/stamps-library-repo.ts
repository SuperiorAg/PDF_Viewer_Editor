// Stamps library repository.
//
// Backs the B7 Stamps panel + the stamp-apply IPC handlers (David's
// `stamps:*` channels per Phase 7.5 architecture). Pure functions over a
// better-sqlite3 `Database` — no Electron API access, no singleton ownership.
//
// Canonical reference: docs/data-models.md §13.2 (table schema) + §13.10
// (`StampLibraryEntry` DTO). The bridge translates snake_case rows to
// camelCase DTOs at the IPC boundary.
//
// Built-in stamp resolution: rows with `builtin_key IS NOT NULL` store
// `image_path = NULL` (text stamps) OR the placeholder `BUILTIN:<key>` token
// for any future image-based built-in. The main-process stamp renderer
// resolves `BUILTIN:<key>` to `process.resourcesPath + '/stamps/<key>.png'`
// at read time, so the install directory can move without breaking the
// library (data-models §13.2 honesty note).
//
// Caller contract: `image_path` strings are TRUSTED at this layer. David's
// main-process handlers sanitize via src/main/security/path-sanitizer.ts
// before they reach the repo. The repo uses prepared statements so even an
// unsanitized path could not SQL-inject — but the boundary is documented.
//
// Method surface (data-models §13.2 + §13.11 + Wave 12/24 convenience-method
// precedent — ratio conveniences:primitives < 1:2 so no Marcus check needed):
//   * list()                — all rows, ordered last_used_at DESC NULLS LAST,
//                              then created_at DESC. Powers the panel.
//   * listRecent(limit?)    — rows where last_used_at IS NOT NULL, DESC.
//                              Powers "Recently used" panel section.
//   * listByKind(kind)      — filter rows by 'text' | 'image'.
//   * getById(id)           — single row, or null.
//   * getByBuiltinKey(key)  — single row, or null.
//   * insertUserStamp(...)  — INSERT a user-authored stamp (builtin_key=NULL).
//                              Returns { ok: true, id } on success.
//   * deleteUserStamp(id)   — DELETE; FORBIDS deleting built-ins. Returns
//                              discriminated union ('forbidden_builtin' |
//                              'not_found' | { ok: true, removed }).
//   * recordUse(id)         — bump last_used_at + use_count. Atomic.

import type BetterSqlite3 from 'better-sqlite3';

import type { StampsLibraryRow } from '../types';

// ============================================================
// Public shape
// ============================================================

export interface InsertUserStampInput {
  /** Display name. Raw user-entered string. */
  name: string;
  kind: 'text' | 'image';
  /** Required when kind='text'; ignored otherwise. */
  text_value?: string | null;
  /** Required when kind='image'; absolute path (renderer-validated). */
  image_path?: string | null;
  width_pt: number;
  height_pt: number;
  /** `#RRGGBB`; only used for text stamps. */
  color?: string | null;
  /** Optional override; defaults to Date.now() at insert time. */
  created_at?: number;
}

export type InsertUserStampResult =
  | { ok: true; id: number }
  | { ok: false; error: 'invalid_payload'; reason: string };

export type DeleteUserStampResult =
  | { ok: true; removed: number }
  | { ok: false; error: 'forbidden_builtin' }
  | { ok: false; error: 'not_found' };

export interface StampsLibraryRepo {
  list(): StampsLibraryRow[];
  listRecent(limit?: number): StampsLibraryRow[];
  listByKind(kind: 'text' | 'image'): StampsLibraryRow[];
  getById(id: number): StampsLibraryRow | null;
  getByBuiltinKey(key: string): StampsLibraryRow | null;
  insertUserStamp(input: InsertUserStampInput): InsertUserStampResult;
  deleteUserStamp(id: number): DeleteUserStampResult;
  /** Returns the new use_count, or null if id was unknown. */
  recordUse(id: number, now?: number): number | null;
}

// ============================================================
// Factory
// ============================================================

const SELECT_COLUMNS = `
  id, builtin_key, name, kind, text_value, image_path,
  width_pt, height_pt, color, created_at, last_used_at, use_count
`;

const DEFAULT_RECENT_LIMIT = 12;

export function createStampsLibraryRepo(db: BetterSqlite3.Database): StampsLibraryRepo {
  // Order: last_used_at DESC with NULLs LAST (recently-used first; never-used
  // sink to the bottom). created_at DESC as the tiebreaker so newer additions
  // beat older identical-timestamp rows.
  const listStmt = db.prepare<[], StampsLibraryRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM stamps_library
      ORDER BY last_used_at IS NULL ASC, last_used_at DESC, created_at DESC, id DESC`,
  );

  const listRecentStmt = db.prepare<{ limit: number }, StampsLibraryRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM stamps_library
      WHERE last_used_at IS NOT NULL
      ORDER BY last_used_at DESC, id DESC
      LIMIT @limit`,
  );

  const listByKindStmt = db.prepare<{ kind: 'text' | 'image' }, StampsLibraryRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM stamps_library
      WHERE kind = @kind
      ORDER BY last_used_at IS NULL ASC, last_used_at DESC, created_at DESC, id DESC`,
  );

  const getByIdStmt = db.prepare<{ id: number }, StampsLibraryRow>(
    `SELECT ${SELECT_COLUMNS} FROM stamps_library WHERE id = @id LIMIT 1`,
  );

  const getByBuiltinKeyStmt = db.prepare<{ key: string }, StampsLibraryRow>(
    `SELECT ${SELECT_COLUMNS} FROM stamps_library WHERE builtin_key = @key LIMIT 1`,
  );

  const insertStmt = db.prepare<{
    name: string;
    kind: 'text' | 'image';
    text_value: string | null;
    image_path: string | null;
    width_pt: number;
    height_pt: number;
    color: string | null;
    created_at: number;
  }>(
    `INSERT INTO stamps_library
        (builtin_key, name, kind, text_value, image_path,
         width_pt, height_pt, color, created_at, last_used_at, use_count)
       VALUES
        (NULL, @name, @kind, @text_value, @image_path,
         @width_pt, @height_pt, @color, @created_at, NULL, 0)`,
  );

  // Forbid deleting built-ins at the SQL layer too — the JS guard is the
  // first line of defense, this is belt-and-suspenders.
  const deleteUserStampStmt = db.prepare<{ id: number }>(
    `DELETE FROM stamps_library WHERE id = @id AND builtin_key IS NULL`,
  );

  const recordUseStmt = db.prepare<{ id: number; now: number }>(
    `UPDATE stamps_library
        SET last_used_at = @now,
            use_count    = use_count + 1
      WHERE id = @id`,
  );

  const getUseCountStmt = db.prepare<{ id: number }, { use_count: number }>(
    `SELECT use_count FROM stamps_library WHERE id = @id LIMIT 1`,
  );

  return {
    list(): StampsLibraryRow[] {
      return listStmt.all();
    },

    listRecent(limit: number = DEFAULT_RECENT_LIMIT): StampsLibraryRow[] {
      const safeLimit =
        Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_RECENT_LIMIT;
      return listRecentStmt.all({ limit: safeLimit });
    },

    listByKind(kind: 'text' | 'image'): StampsLibraryRow[] {
      if (kind !== 'text' && kind !== 'image') {
        throw new Error(`Invalid kind: ${String(kind)} (must be 'text' or 'image')`);
      }
      return listByKindStmt.all({ kind });
    },

    getById(id: number): StampsLibraryRow | null {
      assertValidId(id, 'id');
      return getByIdStmt.get({ id }) ?? null;
    },

    getByBuiltinKey(key: string): StampsLibraryRow | null {
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error('builtin_key must be a non-empty string');
      }
      return getByBuiltinKeyStmt.get({ key }) ?? null;
    },

    insertUserStamp(input: InsertUserStampInput): InsertUserStampResult {
      const validation = validateInsert(input);
      if (!validation.ok) {
        return { ok: false, error: 'invalid_payload', reason: validation.reason };
      }

      const result = insertStmt.run({
        name: input.name,
        kind: input.kind,
        text_value: input.kind === 'text' ? (input.text_value ?? null) : null,
        image_path: input.kind === 'image' ? (input.image_path ?? null) : null,
        width_pt: input.width_pt,
        height_pt: input.height_pt,
        color: input.kind === 'text' ? (input.color ?? null) : null,
        created_at: input.created_at ?? Date.now(),
      });
      const rowid = result.lastInsertRowid;
      const id = typeof rowid === 'bigint' ? Number(rowid) : rowid;
      return { ok: true, id };
    },

    deleteUserStamp(id: number): DeleteUserStampResult {
      assertValidId(id, 'id');

      // Atomic: existence + builtin-status check + delete inside a single txn
      // so a concurrent INSERT can't slip a row in between the SELECT and
      // the DELETE. (No concurrent writer in Electron main, but cheap insurance.)
      const txn = db.transaction((): DeleteUserStampResult => {
        const row = getByIdStmt.get({ id });
        if (!row) {
          return { ok: false, error: 'not_found' };
        }
        if (row.builtin_key !== null) {
          return { ok: false, error: 'forbidden_builtin' };
        }
        const result = deleteUserStampStmt.run({ id });
        return { ok: true, removed: result.changes };
      });
      return txn();
    },

    recordUse(id: number, now: number = Date.now()): number | null {
      assertValidId(id, 'id');
      if (!Number.isFinite(now) || now < 0) {
        throw new Error('now must be a non-negative ms epoch');
      }

      const txn = db.transaction((): number | null => {
        const result = recordUseStmt.run({ id, now });
        if (result.changes === 0) {
          return null;
        }
        const row = getUseCountStmt.get({ id });
        return row?.use_count ?? null;
      });
      return txn();
    },
  };
}

// ============================================================
// Validators
// ============================================================

interface ValidationResult {
  ok: boolean;
  reason: string;
}

function validateInsert(input: InsertUserStampInput): ValidationResult {
  if (typeof input.name !== 'string' || input.name.length === 0) {
    return { ok: false, reason: 'name must be a non-empty string' };
  }
  if (input.kind !== 'text' && input.kind !== 'image') {
    return { ok: false, reason: `kind must be 'text' or 'image' (got ${String(input.kind)})` };
  }
  if (!Number.isFinite(input.width_pt) || input.width_pt <= 0) {
    return { ok: false, reason: 'width_pt must be a positive number' };
  }
  if (!Number.isFinite(input.height_pt) || input.height_pt <= 0) {
    return { ok: false, reason: 'height_pt must be a positive number' };
  }
  if (input.kind === 'text') {
    if (typeof input.text_value !== 'string' || input.text_value.length === 0) {
      return { ok: false, reason: "text_value required when kind='text'" };
    }
  } else {
    if (typeof input.image_path !== 'string' || input.image_path.length === 0) {
      return { ok: false, reason: "image_path required when kind='image'" };
    }
  }
  return { ok: true, reason: '' };
}

function assertValidId(id: number, label: string): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid ${label}: ${String(id)} (must be positive integer)`);
  }
}
