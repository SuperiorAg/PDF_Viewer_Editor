// Handler: fs:writePdf
// Consumes a destinationToken (from dialog:saveAs) and writes either
// a bytes blob or — Phase 2 (Live) — applies a serialized ops list main-side
// before writing via the edit-replay engine. The 'ops' branch now produces
// real bytes; the legacy `applyOpsToBytes` shim is kept for tests but the
// production wiring in `register.ts` supplies the replay engine directly.

import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  FsWritePdfError,
  FsWritePdfRequest,
  FsWritePdfResponse,
  FsWritePdfValue,
} from '../contracts.js';

export interface FsWritePdfDeps {
  consumeDestinationToken: (
    token: string,
  ) => { token: string; path: string; displayName: string } | null;
  getDocument: (handle: number) => { bytes: Uint8Array; path: string | null } | null;
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  computeBufferHash: (bytes: Uint8Array) => string;
  /**
   * Phase 2: replay-engine bridge. Returns the new bytes for kind:'ops'
   * writes plus the annotation-ref-assignments map. Optional so legacy
   * Phase-1 tests still construct the deps without the engine.
   */
  applyOpsToBytes?: (input: {
    originalBytes: Uint8Array;
    ops: unknown[];
    annotations: unknown[];
  }) => Promise<
    | {
        ok: true;
        value: {
          newBytes: Uint8Array;
          annotationRefAssignments: Record<string, number>;
          warnings: string[];
        };
      }
    | { ok: false; error: FsWritePdfError; message: string }
  >;
  /** Phase 2: post-save bytes refresh (edit-replay-engine.md §13.1). */
  setBytes?: (handle: number, bytes: Uint8Array) => void;
}

const MAX_PDF_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB sanity ceiling

export async function handleFsWritePdf(
  req: FsWritePdfRequest,
  deps: FsWritePdfDeps,
): Promise<FsWritePdfResponse> {
  if (typeof req.destinationToken !== 'string' || req.destinationToken.length === 0) {
    return fail<FsWritePdfError>('invalid_payload', 'destinationToken is required');
  }
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<FsWritePdfError>('invalid_payload', 'handle must be an integer');
  }
  const dest = deps.consumeDestinationToken(req.destinationToken);
  if (!dest) {
    return fail<FsWritePdfError>('token_expired', 'destinationToken is expired or unknown');
  }

  let bytesToWrite: Uint8Array;
  let annotationRefAssignments: Record<string, number> | undefined;
  let warnings: string[] | undefined;
  if (req.payload.kind === 'bytes') {
    if (!(req.payload.bytes instanceof Uint8Array)) {
      return fail<FsWritePdfError>('invalid_payload', 'payload.bytes must be Uint8Array');
    }
    if (req.payload.bytes.byteLength > MAX_PDF_BYTES) {
      return fail<FsWritePdfError>('invalid_payload', 'payload exceeds 2 GiB ceiling');
    }
    bytesToWrite = req.payload.bytes;
  } else if (req.payload.kind === 'ops') {
    if (!deps.applyOpsToBytes) {
      return fail<FsWritePdfError>(
        'invalid_payload',
        'ops payload requires the Phase-2 replay engine (deps.applyOpsToBytes)',
      );
    }
    const orig = deps.getDocument(req.payload.originalHandle);
    if (!orig) {
      return fail<FsWritePdfError>('handle_not_found', 'originalHandle not found');
    }
    const r = await deps.applyOpsToBytes({
      originalBytes: orig.bytes,
      ops: req.payload.ops,
      annotations: req.payload.annotations,
    });
    if (!r.ok) {
      return fail<FsWritePdfError>(r.error, r.message);
    }
    bytesToWrite = r.value.newBytes;
    annotationRefAssignments = r.value.annotationRefAssignments;
    warnings = r.value.warnings;
  } else {
    return fail<FsWritePdfError>('invalid_payload', 'unknown payload.kind');
  }

  try {
    await deps.writeFile(dest.path, bytesToWrite);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code === 'ENOSPC' ? 'disk_full' : 'fs_write_failed';
    return fail<FsWritePdfError>(
      code,
      safeMessage(e, code === 'disk_full' ? 'Disk full' : 'Failed to write the file'),
    );
  }

  // Phase 2: refresh stored bytes post-save so undo-across-save works
  // (edit-replay-engine.md §13.1).
  if (req.payload.kind === 'ops' && deps.setBytes) {
    deps.setBytes(req.handle, bytesToWrite);
  }

  const value: FsWritePdfValue = {
    bytesWritten: bytesToWrite.byteLength,
    newFileHash: deps.computeBufferHash(bytesToWrite),
    ...(annotationRefAssignments !== undefined ? { annotationRefAssignments } : {}),
    ...(warnings !== undefined ? { warnings } : {}),
  };
  return ok(value);
}
