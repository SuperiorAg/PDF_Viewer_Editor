// Handler: fs:applyEditOps
//
// Phase 2 (architecture-phase-2.md §2.5, edit-replay-engine.md §10):
// Replaces the Phase-1 stub of `fs:writePdf kind:'ops'` with a real
// pdf-lib replay + atomic temp-rename. Returns Result with the
// annotationRefAssignments map and any non-fatal warnings.
//
// The renderer's `saveDocumentThunk` calls this channel; thunks supply
// either a destinationToken (preferred — from a prior dialog:saveAs) or
// an outputPath (sanitized in main; used for headless / silent saves).

import { dirname, basename, join } from 'node:path';

import type { ReplayInput, ReplayOk } from '../../main/pdf-ops/replay-engine.js';
import { fail, ok } from '../../shared/result.js';
import type {
  FsApplyEditOpsError,
  FsApplyEditOpsRequest,
  FsApplyEditOpsResponse,
  FsApplyEditOpsValue,
  DocumentHandle,
  FileHash,
} from '../contracts.js';

export interface FsApplyEditOpsDeps {
  /** Pull the original bytes for this handle from the document store. */
  getBytes(handle: DocumentHandle): Uint8Array | null;
  /** Refresh stored bytes post-save (edit-replay-engine.md §13.1). */
  setBytes(handle: DocumentHandle, bytes: Uint8Array): void;
  /** Resolve a destinationToken to an absolute path (and consume it). */
  consumeDestinationToken(token: string): { path: string; displayName: string } | null;
  /** Sanitize a user-supplied output path (path-traversal guard). */
  sanitizePath(raw: string): string | null;
  /** Write bytes to disk. Main passes a fs.writeFile wrapper. */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Rename one path to another (atomic on same FS). */
  rename(from: string, to: string): Promise<void>;
  /** Best-effort cleanup. */
  unlink(path: string): Promise<void>;
  /** Hash the output bytes for the response. */
  computeBufferHash(bytes: Uint8Array): FileHash;
  /** The replay engine entry point. */
  replay(input: ReplayInput): Promise<
    | { ok: true; value: ReplayOk }
    | {
        ok: false;
        error: string;
        message: string;
        details?: Record<string, unknown>;
      }
  >;
}

const MAX_OPS = 10_000;
const MAX_ANNOTS = 5_000;

export async function handleFsApplyEditOps(
  req: FsApplyEditOpsRequest,
  deps: FsApplyEditOpsDeps,
): Promise<FsApplyEditOpsResponse> {
  // ---- Validate payload ---------------------------------------------------
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<FsApplyEditOpsError>('invalid_payload', 'handle must be an integer');
  }
  if (!Array.isArray(req.ops)) {
    return fail<FsApplyEditOpsError>('invalid_payload', 'ops must be an array');
  }
  if (req.ops.length > MAX_OPS) {
    return fail<FsApplyEditOpsError>('invalid_payload', `ops too large (>${MAX_OPS})`);
  }
  if (!Array.isArray(req.annotations)) {
    return fail<FsApplyEditOpsError>('invalid_payload', 'annotations must be an array');
  }
  if (req.annotations.length > MAX_ANNOTS) {
    return fail<FsApplyEditOpsError>('invalid_payload', `annotations too large (>${MAX_ANNOTS})`);
  }

  // ---- Resolve destination ------------------------------------------------
  let destPath: string;
  if (req.destinationToken) {
    const dest = deps.consumeDestinationToken(req.destinationToken);
    if (!dest) {
      return fail<FsApplyEditOpsError>('token_expired', 'destinationToken is expired or unknown');
    }
    destPath = dest.path;
  } else if (req.outputPath) {
    const sanitized = deps.sanitizePath(req.outputPath);
    if (!sanitized) {
      return fail<FsApplyEditOpsError>('invalid_payload', 'outputPath rejected by sanitiser');
    }
    destPath = sanitized;
  } else {
    return fail<FsApplyEditOpsError>(
      'invalid_payload',
      'one of destinationToken or outputPath is required',
    );
  }

  // ---- Resolve original bytes ---------------------------------------------
  const originalBytes = deps.getBytes(req.handle);
  if (!originalBytes) {
    return fail<FsApplyEditOpsError>('handle_not_found', `handle ${req.handle} not found`);
  }

  // ---- Replay -------------------------------------------------------------
  const jobId = `fs-apply-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const r = await deps.replay({
    originalBytes,
    ops: req.ops,
    annotations: req.annotations,
    jobId,
  });
  if (!r.ok) {
    return mapReplayError(r.error, r.message);
  }

  // ---- Atomic write (temp-in-same-directory + rename) --------------------
  const tempPath = join(
    dirname(destPath),
    `.${basename(destPath)}.tmp-${process.pid}-${Date.now()}`,
  );
  try {
    await deps.writeFile(tempPath, r.value.newBytes);
    await deps.rename(tempPath, destPath);
  } catch (e) {
    await deps.unlink(tempPath).catch(() => {});
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOSPC') {
      return fail<FsApplyEditOpsError>('disk_full', (e as Error).message, { tempPath });
    }
    return fail<FsApplyEditOpsError>('fs_write_failed', (e as Error).message, { tempPath });
  }

  // ---- Post-save bytes refresh (edit-replay-engine.md §13.1) -------------
  deps.setBytes(req.handle, r.value.newBytes);

  const value: FsApplyEditOpsValue = {
    bytesWritten: r.value.byteCount,
    newFileHash: deps.computeBufferHash(r.value.newBytes),
    annotationRefAssignments: r.value.annotationRefAssignments,
    warnings: r.value.warnings,
  };
  return ok(value);
}

function mapReplayError(error: string, message: string): FsApplyEditOpsResponse {
  switch (error) {
    case 'op_apply_failed':
      return fail<FsApplyEditOpsError>('op_apply_failed', message);
    case 'annotation_emit_failed':
      return fail<FsApplyEditOpsError>('annotation_emit_failed', message);
    case 'image_decode_failed':
      return fail<FsApplyEditOpsError>('image_decode_failed', message);
    case 'text_span_not_found':
      return fail<FsApplyEditOpsError>('text_span_not_found', message);
    case 'missing_glyph':
      return fail<FsApplyEditOpsError>('missing_glyph', message);
    case 'serialize_failed':
      return fail<FsApplyEditOpsError>('serialize_failed', message);
    case 'encrypted_unsupported':
      return fail<FsApplyEditOpsError>('encrypted_unsupported', message);
    default:
      return fail<FsApplyEditOpsError>('op_apply_failed', message);
  }
}
