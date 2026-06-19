// Phase 7.5 Wave 6 (David, 2026-06-18) — B9 Action Wizard handlers.
//
// Seven channels:
//   actions:saveScript    - persist a recorded EditOperation[] under <userData>/actions/<id>.json
//   actions:listScripts   - enumerate saved scripts
//   actions:getScript     - read one full script (incl. ops)
//   actions:deleteScript  - delete a saved script
//   actions:runScript     - replay a script against target documents
//   actions:exportScript  - return the script's JSON envelope (renderer writes file)
//   actions:importScript  - re-persist an externally authored envelope as a new script
//
// Contract: src/ipc/contracts.ts (see the Wave 6 block).
// Storage:  src/main/persistence/actions-store.ts.
// Replay:   src/main/pdf-ops/replay-engine.ts (existing).

import { join, basename, extname } from 'node:path';

import { z } from 'zod';

import type { ReplayInput, ReplayOk } from '../../main/pdf-ops/replay-engine.js';
import type { ActionsStore, StoredActionScript } from '../../main/persistence/actions-store.js';
import {
  ACTION_SCRIPT_SCHEMA_VERSION,
  findBannedOp,
} from '../../main/persistence/actions-store.js';
import { fail, ok, safeMessage, type Result } from '../../shared/result.js';
import type {
  ActionRunResult,
  ActionsDeleteScriptError,
  ActionsDeleteScriptResponse,
  ActionsExportScriptError,
  ActionsExportScriptResponse,
  ActionsExportScriptValue,
  ActionsGetScriptError,
  ActionsGetScriptResponse,
  ActionsGetScriptValue,
  ActionsImportScriptError,
  ActionsImportScriptResponse,
  ActionsImportScriptValue,
  ActionsListScriptsError,
  ActionsListScriptsResponse,
  ActionsListScriptsValue,
  ActionsRunScriptError,
  ActionsRunScriptResponse,
  ActionsRunScriptValue,
  ActionsSaveScriptError,
  ActionsSaveScriptResponse,
  ActionsSaveScriptValue,
  DocumentHandle,
  EditOperationSerialized,
} from '../contracts.js';

// =============================================================================
// Shared types
// =============================================================================

export interface ActionsHandlersDeps {
  store: ActionsStore;
  /** Look up bytes for a registered document handle. */
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  /**
   * The handle's source displayName / path basename, used to fill the
   * `{name}` token in the filename pattern + to write next-to-source when no
   * destinationFolder is supplied. Returns null when the handle is unknown.
   */
  getDisplayName: (handle: DocumentHandle) => string | null;
  /**
   * The handle's source directory (when known), used to write next-to-source
   * when `destinationFolder` is omitted. Returns null when the source has no
   * known directory (e.g. opened via drag-drop from a temp blob).
   */
  getSourceDirectory: (handle: DocumentHandle) => string | null;
  /** L-001 path-sanitizer. Used to validate filenames + final paths. */
  sanitizePath: (raw: string) => string | null;
  /** Folder-mode sanitizer (no .pdf extension required). */
  sanitizeDirectoryPath: (raw: string) => string | null;
  /** Write bytes to disk. Production wraps fs.writeFile. */
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Replay engine entry point. */
  replay: (
    input: ReplayInput,
  ) => Promise<
    | { ok: true; value: ReplayOk }
    | { ok: false; error: string; message: string; details?: Record<string, unknown> }
  >;
  /** Current time in ms — injected for test determinism. */
  now?: () => number;
}

// =============================================================================
// Schemas
// =============================================================================

const saveSchema = z.object({
  name: z.string().min(1).max(200),
  // Ops are passed through as `EditOperationSerialized[]` without zod-narrowing
  // every discriminated variant (the union is too large for an inline schema).
  // The store's `findBannedOp` provides the safety gate.
  ops: z.array(z.unknown()).max(5000),
  schemaVersion: z.number().int().nonnegative(),
});

const listSchema = z.object({}).optional();

const getSchema = z.object({
  id: z.string().min(1).max(100),
});

const deleteSchema = z.object({
  id: z.string().min(1).max(100),
});

const runSchema = z.object({
  scriptId: z.string().min(1).max(100),
  targetHandles: z.array(z.number().int().positive()).min(1).max(500),
  destinationFolder: z.string().min(1).max(1024).optional(),
  filenamePattern: z.string().min(1).max(200).optional(),
});

const exportSchema = z.object({
  id: z.string().min(1).max(100),
});

const importSchema = z.object({
  json: z
    .string()
    .min(1)
    .max(8 * 1024 * 1024), // 8 MB envelope cap
});

// =============================================================================
// Handlers
// =============================================================================

export async function handleActionsSaveScript(
  req: unknown,
  deps: ActionsHandlersDeps,
): Promise<ActionsSaveScriptResponse> {
  const parsed = saveSchema.safeParse(req);
  if (!parsed.success) {
    return fail<ActionsSaveScriptError>('invalid_payload', parsed.error.message);
  }
  if (parsed.data.schemaVersion !== ACTION_SCRIPT_SCHEMA_VERSION) {
    return fail<ActionsSaveScriptError>(
      'schema_version_unsupported',
      `schemaVersion ${parsed.data.schemaVersion} != current ${ACTION_SCRIPT_SCHEMA_VERSION}`,
    );
  }
  const banned = findBannedOp(parsed.data.ops);
  if (banned !== null) {
    return fail<ActionsSaveScriptError>(
      'banned_op_in_script',
      `op kind "${banned}" is not replayable across documents`,
    );
  }
  try {
    const r = await deps.store.save(
      parsed.data.name,
      parsed.data.ops as EditOperationSerialized[],
      parsed.data.schemaVersion,
    );
    if (!r.ok) {
      return mapStoreErr<ActionsSaveScriptError>(r.error, r.message, {
        invalid_payload: 'invalid_payload',
        banned_op_in_script: 'banned_op_in_script',
        schema_version_unsupported: 'schema_version_unsupported',
        persistence_failed: 'persistence_failed',
      });
    }
    const value: ActionsSaveScriptValue = r.value;
    return ok(value);
  } catch (e) {
    return fail<ActionsSaveScriptError>(
      'persistence_failed',
      safeMessage(e, 'actions store threw'),
    );
  }
}

export async function handleActionsListScripts(
  req: unknown,
  deps: ActionsHandlersDeps,
): Promise<ActionsListScriptsResponse> {
  const parsed = listSchema.safeParse(req);
  if (!parsed.success) {
    return fail<ActionsListScriptsError>('persistence_failed', parsed.error.message);
  }
  try {
    const r = await deps.store.listAll();
    if (!r.ok) {
      return fail<ActionsListScriptsError>('persistence_failed', r.message);
    }
    const value: ActionsListScriptsValue = { scripts: r.value };
    return ok(value);
  } catch (e) {
    return fail<ActionsListScriptsError>(
      'persistence_failed',
      safeMessage(e, 'actions store threw'),
    );
  }
}

export async function handleActionsGetScript(
  req: unknown,
  deps: ActionsHandlersDeps,
): Promise<ActionsGetScriptResponse> {
  const parsed = getSchema.safeParse(req);
  if (!parsed.success) {
    return fail<ActionsGetScriptError>('invalid_payload', parsed.error.message);
  }
  try {
    const r = await deps.store.get(parsed.data.id);
    if (!r.ok) {
      return mapStoreErr<ActionsGetScriptError>(r.error, r.message, {
        invalid_payload: 'invalid_payload',
        script_not_found: 'script_not_found',
        schema_version_unsupported: 'schema_version_unsupported',
        persistence_failed: 'persistence_failed',
      });
    }
    const s = r.value;
    const value: ActionsGetScriptValue = {
      id: s.id,
      name: s.name,
      savedAt: s.savedAt,
      usageCount: s.usageCount,
      schemaVersion: s.schemaVersion,
      ops: s.ops,
    };
    return ok(value);
  } catch (e) {
    return fail<ActionsGetScriptError>('persistence_failed', safeMessage(e, 'actions store threw'));
  }
}

export async function handleActionsDeleteScript(
  req: unknown,
  deps: ActionsHandlersDeps,
): Promise<ActionsDeleteScriptResponse> {
  const parsed = deleteSchema.safeParse(req);
  if (!parsed.success) {
    return fail<ActionsDeleteScriptError>('invalid_payload', parsed.error.message);
  }
  try {
    const r = await deps.store.delete(parsed.data.id);
    if (!r.ok) {
      return mapStoreErr<ActionsDeleteScriptError>(r.error, r.message, {
        invalid_payload: 'invalid_payload',
        script_not_found: 'script_not_found',
        persistence_failed: 'persistence_failed',
      });
    }
    return ok(r.value);
  } catch (e) {
    return fail<ActionsDeleteScriptError>(
      'persistence_failed',
      safeMessage(e, 'actions store threw'),
    );
  }
}

export async function handleActionsRunScript(
  req: unknown,
  deps: ActionsHandlersDeps,
): Promise<ActionsRunScriptResponse> {
  const parsed = runSchema.safeParse(req);
  if (!parsed.success) {
    return fail<ActionsRunScriptError>('invalid_payload', parsed.error.message);
  }
  // 1. Load script.
  let script: StoredActionScript;
  try {
    const r = await deps.store.get(parsed.data.scriptId);
    if (!r.ok) {
      return mapStoreErr<ActionsRunScriptError>(r.error, r.message, {
        invalid_payload: 'invalid_payload',
        script_not_found: 'script_not_found',
        schema_version_unsupported: 'schema_version_unsupported',
        persistence_failed: 'persistence_failed',
      });
    }
    script = r.value;
  } catch (e) {
    return fail<ActionsRunScriptError>('persistence_failed', safeMessage(e, 'actions store threw'));
  }
  // 2. Defensive: re-validate ops against the allowlist in case the stored
  //    file pre-dates a tightening of the allowlist (R5 resilience).
  const banned = findBannedOp(script.ops);
  if (banned !== null) {
    return fail<ActionsRunScriptError>(
      'banned_op_in_script',
      `op kind "${banned}" is not replayable across documents`,
    );
  }
  // 3. Resolve destination folder (L-001 path-sanitizer compliance).
  let destFolder: string | null = null;
  if (parsed.data.destinationFolder !== undefined) {
    const safe = deps.sanitizeDirectoryPath(parsed.data.destinationFolder);
    if (safe === null) {
      return fail<ActionsRunScriptError>(
        'destination_invalid',
        `destinationFolder rejected by sanitizer: ${parsed.data.destinationFolder}`,
      );
    }
    destFolder = safe;
  }
  // 4. Filename pattern. Default '{name}-acted.pdf'.
  const pattern = parsed.data.filenamePattern ?? '{name}-acted.pdf';
  if (extname(pattern).toLowerCase() !== '.pdf') {
    return fail<ActionsRunScriptError>(
      'destination_invalid',
      `filenamePattern must produce a .pdf file: ${pattern}`,
    );
  }
  // 5. Iterate targets. Per-target failure does NOT abort the batch — surfaced
  //    in the per-target result.
  const results: ActionRunResult[] = [];
  const ranAt = (deps.now ?? Date.now)();
  for (let i = 0; i < parsed.data.targetHandles.length; i += 1) {
    const handle = parsed.data.targetHandles[i]!;
    const result = await runOneTarget({
      handle,
      handleIndex: i,
      script,
      destFolder,
      pattern,
      deps,
    });
    results.push(result);
  }
  // 6. Increment usage count once if any target succeeded. Per-target wins
  //    don't multiply the count — the user ran the script once.
  if (results.some((r) => r.success)) {
    try {
      await deps.store.incrementUsage(script.id);
    } catch {
      // Best-effort — the increment is informational; don't fail the run if
      // disk is suddenly read-only.
    }
  }
  const value: ActionsRunScriptValue = { results, ranAt };
  return ok(value);
}

export async function handleActionsExportScript(
  req: unknown,
  deps: ActionsHandlersDeps,
): Promise<ActionsExportScriptResponse> {
  const parsed = exportSchema.safeParse(req);
  if (!parsed.success) {
    return fail<ActionsExportScriptError>('invalid_payload', parsed.error.message);
  }
  try {
    const r = await deps.store.get(parsed.data.id);
    if (!r.ok) {
      return mapStoreErr<ActionsExportScriptError>(r.error, r.message, {
        invalid_payload: 'invalid_payload',
        script_not_found: 'script_not_found',
        persistence_failed: 'persistence_failed',
        schema_version_unsupported: 'persistence_failed',
      });
    }
    const envelope = {
      id: r.value.id,
      name: r.value.name,
      savedAt: r.value.savedAt,
      usageCount: r.value.usageCount,
      schemaVersion: r.value.schemaVersion,
      ops: r.value.ops,
    };
    const value: ActionsExportScriptValue = {
      json: JSON.stringify(envelope, null, 2),
      schemaVersion: r.value.schemaVersion,
    };
    return ok(value);
  } catch (e) {
    return fail<ActionsExportScriptError>(
      'persistence_failed',
      safeMessage(e, 'actions store threw'),
    );
  }
}

export async function handleActionsImportScript(
  req: unknown,
  deps: ActionsHandlersDeps,
): Promise<ActionsImportScriptResponse> {
  const parsed = importSchema.safeParse(req);
  if (!parsed.success) {
    return fail<ActionsImportScriptError>('invalid_payload', parsed.error.message);
  }
  try {
    const r = await deps.store.importFromJson(parsed.data.json);
    if (!r.ok) {
      return mapStoreErr<ActionsImportScriptError>(r.error, r.message, {
        invalid_payload: 'invalid_payload',
        invalid_json: 'invalid_json',
        banned_op_in_script: 'banned_op_in_script',
        schema_version_unsupported: 'schema_version_unsupported',
        persistence_failed: 'persistence_failed',
      });
    }
    const value: ActionsImportScriptValue = r.value;
    return ok(value);
  } catch (e) {
    return fail<ActionsImportScriptError>(
      'persistence_failed',
      safeMessage(e, 'actions store threw'),
    );
  }
}

// =============================================================================
// Internal: per-target run
// =============================================================================

interface RunOneTargetCtx {
  handle: DocumentHandle;
  handleIndex: number;
  script: StoredActionScript;
  destFolder: string | null;
  pattern: string;
  deps: ActionsHandlersDeps;
}

async function runOneTarget(ctx: RunOneTargetCtx): Promise<ActionRunResult> {
  const { handle, handleIndex, script, destFolder, pattern, deps } = ctx;
  const bytes = deps.getBytes(handle);
  const displayName = deps.getDisplayName(handle);
  if (!bytes || !displayName) {
    return {
      handleIndex,
      success: false,
      error: `handle ${handle} not registered`,
    };
  }
  // Derive output path. {name} -> source basename (no .pdf).
  const baseName = stripPdfExt(basename(displayName));
  const filename = pattern.replace(/\{name\}/g, baseName);
  // Sanitize the FULL output path through the SAME sanitizer the production
  // replay-engine save path uses (path-sanitizer.sanitizePath). Per L-001 we
  // explicitly do NOT inject a permissive variant here OR in tests.
  let outputPath: string;
  if (destFolder !== null) {
    outputPath = join(destFolder, filename);
  } else {
    const srcDir = deps.getSourceDirectory(handle);
    if (srcDir === null) {
      return {
        handleIndex,
        success: false,
        error: 'no source directory known for handle and no destinationFolder supplied',
      };
    }
    outputPath = join(srcDir, filename);
  }
  const safeOutput = deps.sanitizePath(outputPath);
  if (safeOutput === null) {
    return {
      handleIndex,
      success: false,
      error: `output path rejected by sanitizer: ${outputPath}`,
    };
  }
  // Replay the script's ops via the existing replay-engine.
  let replayed: { ok: true; value: ReplayOk } | { ok: false; error: string; message: string };
  try {
    replayed = await deps.replay({
      originalBytes: bytes,
      ops: script.ops,
      annotations: [],
      jobId: `actions-run-${script.id}-${handleIndex}-${Date.now()}`,
    });
  } catch (e) {
    return {
      handleIndex,
      success: false,
      error: `replay engine threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!replayed.ok) {
    return {
      handleIndex,
      success: false,
      error: `${replayed.error}: ${replayed.message}`,
    };
  }
  // Write the output.
  try {
    await deps.writeFile(safeOutput, replayed.value.newBytes);
    return { handleIndex, success: true, outputPath: safeOutput };
  } catch (e) {
    return {
      handleIndex,
      success: false,
      error: `write failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function stripPdfExt(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

// =============================================================================
// Generic store-error mapper
// =============================================================================

function mapStoreErr<E extends string>(
  source: string,
  message: string,
  mapping: Partial<Record<string, E>>,
): Result<never, E> {
  const target = mapping[source];
  if (target) return fail<E>(target, message);
  return fail<E>(Object.values(mapping)[0] as E, message);
}
