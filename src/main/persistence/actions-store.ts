// Phase 7.5 Wave 6 (David, 2026-06-18) — B9 Action Wizard persistence.
//
// Persists Action Scripts (recorded EditOperation[] sequences) to JSON files
// under <userDataDir>/actions/<id>.json. Pure-ish: no Electron imports, no
// `app.getPath` call — the caller (register.ts) injects an absolute baseDir.
//
// =============================================================================
// Schema version + banned-op allowlist (project-plan §4 row R5 mitigation)
// =============================================================================
//
// `ACTION_SCRIPT_SCHEMA_VERSION` is the on-disk schema version. When loading a
// stored script whose `schemaVersion !== ACTION_SCRIPT_SCHEMA_VERSION`, we
// REJECT with `'schema_version_unsupported'`. The R5 commitment from the
// project plan is: when this constant changes, ship a migration test alongside
// the bump. Today (Wave 6) we're at v1.
//
// `ALLOWED_OP_KINDS` is the allowlist of EditOperation kinds that survive
// cross-document replay safely. Banned op categories + rationale:
//
//   - `text-replace`            -> binds to a specific page+objectId; replay
//                                  against a DIFFERENT document would either
//                                  miss the target or hit the wrong text.
//   - `annot-edit` / `annot-delete` / `annot-edit-shape` / `annot-delete-shape`
//                              -> bind to a specific annotation `id` from the
//                                 source doc. Cross-doc replay is meaningless.
//   - `image-overlay-edit` / `image-overlay-delete`
//                              -> bind to a specific overlayId. Same problem.
//   - `form-commit` / `form-design-edit` / `form-design-remove` / `form-flatten`
//                              -> bind to source-doc field names + objectNumbers.
//   - `signature-visual-place` / `signature-visual-remove`
//   - `signature-pades-applied` / `signature-pades-removed`
//                              -> AR5 (architecture-phase-7.5.md): signatures
//                                 carry the user's cert; multi-doc replay would
//                                 either fail or silently sign every batch doc
//                                 with the same cert (security hole).
//   - `ocr-text-behind-applied` / `ocr-text-behind-removed`
//                              -> bind to an `ocr_jobs.id` (FK); cross-doc would
//                                 resurrect the wrong words.
//
// Allowlist (kinds that ARE replayable across docs):
//   - `reorder`, `insert`, `delete`, `rotate`          (page-level structural)
//   - `annot-add`, `annot-add-shape`                   (fresh annotations)
//   - `image-insert`, `image-overlay`                  (fresh images; bytes
//                                                       travel with the op)
//   - `form-design-add`                                (fresh form fields)
//
// The recorder (renderer-side, Riley's domain) is also responsible for filtering
// non-recordable ops, but the persistence layer is the load-bearing defense.
//
// =============================================================================
// Concurrency
// =============================================================================
//
// Per-script JSON files: each file is independently created/read/deleted. The
// directory walk for `listAll` is read-only. Two concurrent writes to the SAME
// script id would race; we don't attempt to mutex because the wizard never
// emits two parallel saves for one id (each save creates a new uuid).
// Concurrent reads of a deleted file degrade to `'script_not_found'`.

import { randomUUID } from 'node:crypto';
import { promises as fsPromises } from 'node:fs';
import { join, basename } from 'node:path';

import type { EditOperationSerialized } from '../../ipc/contracts.js';
import { fail, ok, type Result } from '../../shared/result.js';

// =============================================================================
// Public constants
// =============================================================================

export const ACTION_SCRIPT_SCHEMA_VERSION = 1 as const;

/**
 * The allowlist of EditOperation kinds that survive cross-document replay
 * safely. See file header for the rationale per banned category.
 */
export const ALLOWED_OP_KINDS = new Set<string>([
  'reorder',
  'insert',
  'delete',
  'rotate',
  'annot-add',
  'annot-add-shape',
  'image-insert',
  'image-overlay',
  'form-design-add',
]);

// =============================================================================
// Errors
// =============================================================================

export type ActionsStoreError =
  | 'invalid_payload'
  | 'banned_op_in_script'
  | 'schema_version_unsupported'
  | 'invalid_json'
  | 'script_not_found'
  | 'persistence_failed';

export interface StoredActionScript {
  id: string;
  name: string;
  savedAt: number;
  usageCount: number;
  schemaVersion: number;
  ops: EditOperationSerialized[];
}

export interface StoredActionScriptSummary {
  id: string;
  name: string;
  savedAt: number;
  usageCount: number;
  opCount: number;
  schemaVersion: number;
}

// =============================================================================
// Store
// =============================================================================

export interface ActionsStoreDeps {
  /** Absolute path to the directory the store owns. Caller ensures it exists. */
  baseDir: string;
  /** Override for tests; defaults to node:fs/promises. */
  fs?: Pick<
    typeof fsPromises,
    'mkdir' | 'readdir' | 'readFile' | 'writeFile' | 'unlink' | 'rename'
  >;
  /** Override for tests; defaults to crypto.randomUUID. */
  uuid?: () => string;
  /** Override for tests; defaults to Date.now. */
  now?: () => number;
}

const MAX_NAME_LEN = 200;
const MAX_OPS = 5_000;

function validateName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LEN) return null;
  return trimmed;
}

/**
 * Check whether every op in the script is on the cross-document-replay
 * allowlist. Returns null on pass; returns the first offending kind on fail.
 * Tolerates `undefined` op entries (treats as banned).
 */
export function findBannedOp(ops: ReadonlyArray<unknown>): string | null {
  for (const op of ops) {
    if (!op || typeof op !== 'object') return '<non-object>';
    const kind = (op as { kind?: unknown }).kind;
    if (typeof kind !== 'string') return '<no-kind>';
    if (!ALLOWED_OP_KINDS.has(kind)) return kind;
  }
  return null;
}

function jsonPath(baseDir: string, id: string): string {
  return join(baseDir, `${id}.json`);
}

function isLikelyScriptFilename(filename: string): boolean {
  // Defensive: only walk files matching a script id format. Production uses
  // crypto.randomUUID() (hex + dashes); tests inject shorter ids like
  // 'uuid-1.json'. Accept any alphanumeric+dash basename with .json suffix —
  // the file's internal `id` field is the authoritative identifier, and
  // listAll already tolerates parse failures (corrupt files are skipped).
  return /^[A-Za-z0-9_-]+\.json$/.test(filename);
}

export class ActionsStore {
  private readonly baseDir: string;
  private readonly fs: NonNullable<ActionsStoreDeps['fs']>;
  private readonly uuid: () => string;
  private readonly now: () => number;

  constructor(deps: ActionsStoreDeps) {
    this.baseDir = deps.baseDir;
    this.fs = deps.fs ?? fsPromises;
    this.uuid = deps.uuid ?? randomUUID;
    this.now = deps.now ?? Date.now;
  }

  /** Idempotent: creates the base directory if it doesn't exist. */
  async ensureBaseDir(): Promise<Result<void, ActionsStoreError>> {
    try {
      await this.fs.mkdir(this.baseDir, { recursive: true });
      return ok(undefined);
    } catch (e) {
      return fail<ActionsStoreError>(
        'persistence_failed',
        `mkdir failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async save(
    name: string,
    ops: EditOperationSerialized[],
    schemaVersion: number,
  ): Promise<Result<{ id: string; savedAt: number }, ActionsStoreError>> {
    if (schemaVersion !== ACTION_SCRIPT_SCHEMA_VERSION) {
      return fail<ActionsStoreError>(
        'schema_version_unsupported',
        `schemaVersion ${schemaVersion} unsupported (current: ${ACTION_SCRIPT_SCHEMA_VERSION})`,
      );
    }
    const safeName = validateName(name);
    if (safeName === null) {
      return fail<ActionsStoreError>(
        'invalid_payload',
        `name must be a non-empty string <= ${MAX_NAME_LEN} chars`,
      );
    }
    if (!Array.isArray(ops)) {
      return fail<ActionsStoreError>('invalid_payload', 'ops must be an array');
    }
    if (ops.length > MAX_OPS) {
      return fail<ActionsStoreError>('invalid_payload', `ops too large (> ${MAX_OPS})`);
    }
    const banned = findBannedOp(ops);
    if (banned !== null) {
      return fail<ActionsStoreError>(
        'banned_op_in_script',
        `op kind "${banned}" is not replayable across documents`,
      );
    }
    const ensured = await this.ensureBaseDir();
    if (!ensured.ok) return ensured;

    const id = this.uuid();
    const savedAt = this.now();
    const script: StoredActionScript = {
      id,
      name: safeName,
      savedAt,
      usageCount: 0,
      schemaVersion,
      ops,
    };
    try {
      await this.fs.writeFile(jsonPath(this.baseDir, id), JSON.stringify(script, null, 2), 'utf8');
      return ok({ id, savedAt });
    } catch (e) {
      return fail<ActionsStoreError>(
        'persistence_failed',
        `writeFile failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async listAll(): Promise<Result<StoredActionScriptSummary[], ActionsStoreError>> {
    let entries: string[];
    try {
      await this.fs.mkdir(this.baseDir, { recursive: true });
      entries = await this.fs.readdir(this.baseDir);
    } catch (e) {
      return fail<ActionsStoreError>(
        'persistence_failed',
        `readdir failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const summaries: StoredActionScriptSummary[] = [];
    for (const filename of entries) {
      if (!isLikelyScriptFilename(filename)) continue;
      try {
        const raw = await this.fs.readFile(join(this.baseDir, filename), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
          summaries.push({
            id: parsed.id,
            name: typeof parsed.name === 'string' ? parsed.name : basename(filename, '.json'),
            savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
            usageCount: typeof parsed.usageCount === 'number' ? parsed.usageCount : 0,
            opCount: Array.isArray(parsed.ops) ? parsed.ops.length : 0,
            schemaVersion:
              typeof parsed.schemaVersion === 'number'
                ? parsed.schemaVersion
                : ACTION_SCRIPT_SCHEMA_VERSION,
          });
        }
      } catch {
        // Best-effort: skip unreadable/corrupt files. The store is forward-only;
        // we never delete user data. Operators can manually clean up via the
        // file system.
      }
    }
    // Most-recently-saved first.
    summaries.sort((a, b) => b.savedAt - a.savedAt);
    return ok(summaries);
  }

  async get(id: string): Promise<Result<StoredActionScript, ActionsStoreError>> {
    if (typeof id !== 'string' || id.length === 0) {
      return fail<ActionsStoreError>('invalid_payload', 'id must be a non-empty string');
    }
    let raw: string;
    try {
      raw = await this.fs.readFile(jsonPath(this.baseDir, id), 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return fail<ActionsStoreError>('script_not_found', `script ${id} not found`);
      }
      return fail<ActionsStoreError>(
        'persistence_failed',
        `readFile failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return fail<ActionsStoreError>(
        'persistence_failed',
        `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const script = coerceStoredScript(parsed);
    if (script === null) {
      return fail<ActionsStoreError>('persistence_failed', 'stored script shape invalid');
    }
    if (script.schemaVersion !== ACTION_SCRIPT_SCHEMA_VERSION) {
      return fail<ActionsStoreError>(
        'schema_version_unsupported',
        `stored schemaVersion ${script.schemaVersion} != current ${ACTION_SCRIPT_SCHEMA_VERSION}`,
      );
    }
    return ok(script);
  }

  async delete(id: string): Promise<Result<{ deleted: true }, ActionsStoreError>> {
    if (typeof id !== 'string' || id.length === 0) {
      return fail<ActionsStoreError>('invalid_payload', 'id must be a non-empty string');
    }
    try {
      await this.fs.unlink(jsonPath(this.baseDir, id));
      return ok({ deleted: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return fail<ActionsStoreError>('script_not_found', `script ${id} not found`);
      }
      return fail<ActionsStoreError>(
        'persistence_failed',
        `unlink failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Increment a script's usageCount. Best-effort: a concurrent get during the
   * write window may observe the pre-increment value, but this is purely an
   * informational counter (no business logic depends on exact value).
   */
  async incrementUsage(id: string): Promise<Result<void, ActionsStoreError>> {
    const got = await this.get(id);
    if (!got.ok) {
      // Forward script_not_found / schema_version_unsupported / persistence_failed.
      return fail<ActionsStoreError>(got.error, got.message);
    }
    const updated: StoredActionScript = {
      ...got.value,
      usageCount: got.value.usageCount + 1,
    };
    try {
      await this.fs.writeFile(jsonPath(this.baseDir, id), JSON.stringify(updated, null, 2), 'utf8');
      return ok(undefined);
    } catch (e) {
      return fail<ActionsStoreError>(
        'persistence_failed',
        `writeFile failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Import a script from an exported JSON envelope. The envelope is the same
   * shape the `get` method returns; we re-validate it (banned ops, schema
   * version, name) and persist with a NEW id so the import is non-destructive.
   */
  async importFromJson(
    json: string,
  ): Promise<Result<{ id: string; name: string; schemaVersion: number }, ActionsStoreError>> {
    if (typeof json !== 'string' || json.length === 0) {
      return fail<ActionsStoreError>('invalid_payload', 'json must be a non-empty string');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      return fail<ActionsStoreError>(
        'invalid_json',
        `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const script = coerceStoredScript(parsed);
    if (script === null) {
      return fail<ActionsStoreError>('invalid_json', 'envelope shape invalid');
    }
    if (script.schemaVersion !== ACTION_SCRIPT_SCHEMA_VERSION) {
      return fail<ActionsStoreError>(
        'schema_version_unsupported',
        `envelope schemaVersion ${script.schemaVersion} != current ${ACTION_SCRIPT_SCHEMA_VERSION}`,
      );
    }
    const banned = findBannedOp(script.ops);
    if (banned !== null) {
      return fail<ActionsStoreError>(
        'banned_op_in_script',
        `op kind "${banned}" is not replayable across documents`,
      );
    }
    const saved = await this.save(script.name, script.ops, script.schemaVersion);
    if (!saved.ok) return fail<ActionsStoreError>(saved.error, saved.message);
    return ok({ id: saved.value.id, name: script.name, schemaVersion: script.schemaVersion });
  }
}

/**
 * Defensive coercion of a parsed-JSON unknown into a StoredActionScript shape.
 * Returns null on any structural mismatch. Used both by `get` (file load) and
 * `importFromJson` (envelope load); single source of truth for the shape check.
 */
function coerceStoredScript(raw: unknown): StoredActionScript | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : null;
  const name = typeof r.name === 'string' ? r.name : null;
  const savedAt = typeof r.savedAt === 'number' ? r.savedAt : null;
  const usageCount = typeof r.usageCount === 'number' ? r.usageCount : 0;
  const schemaVersion = typeof r.schemaVersion === 'number' ? r.schemaVersion : null;
  const ops = Array.isArray(r.ops) ? (r.ops as EditOperationSerialized[]) : null;
  if (id === null || name === null || savedAt === null || schemaVersion === null || ops === null) {
    return null;
  }
  return { id, name, savedAt, usageCount, schemaVersion, ops };
}
