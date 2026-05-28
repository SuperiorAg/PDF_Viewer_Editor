// Handler: fs:readBytesByHandle (Phase 4.1, api-contracts.md §15)
//
// Renderer fetches the validated document bytes (already held in main's
// documentStore) so pdf.js can render pages + thumbnails. The bytes were
// validated at open time by `dialog:openPdf` / `fs:readPdf` — this handler
// is a SIMPLE LOOKUP-BY-HANDLE with NO path on the IPC boundary.
//
// SECURITY (conventions §13 + Hard-Won Playbook entry #15):
//   - No path is accepted from the renderer. Trust derives from the
//     `handle` (a process-local integer minted by `documentStore.register`
//     after sanitizePath + statFile + read at open time).
//   - The renderer cannot escalate to disk via this channel. The path
//     stored on the document record is NEVER returned over IPC.
//   - Bytes cross via Electron's structured clone, which copies the
//     underlying ArrayBuffer — renderer mutations cannot affect main's
//     copy, and vice versa. The one-shot copy is acceptable per the
//     500 MB max file size cap.
//
// ERROR variants (api-contracts.md §15):
//   - unknown_handle    : handle never registered (or already closed)
//   - document_evicted  : handle is registered but bytes are gone (future LRU)
//   - fs_read_failed    : reserved for future on-disk-backed handles

import { z } from 'zod';

import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  FsReadBytesByHandleError,
  FsReadBytesByHandleResponse,
} from '../contracts.js';

export interface FsReadBytesByHandleDeps {
  /** Lookup bytes by handle. Returns null when the handle is unknown. */
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
}

const requestSchema = z.object({
  handle: z.number().int().positive(),
});

export async function handleFsReadBytesByHandle(
  req: unknown,
  deps: FsReadBytesByHandleDeps,
): Promise<FsReadBytesByHandleResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<FsReadBytesByHandleError>(
      'unknown_handle',
      `invalid_payload: ${parsed.error.message}`,
    );
  }

  const bytes = deps.getBytes(parsed.data.handle);
  if (bytes === null) {
    // Could be never-registered or already-closed. From the renderer's
    // perspective both are the same observable state; one error variant
    // suffices. (`document_evicted` is reserved for the Phase 5 LRU case
    // where the handle exists but bytes were swapped out.)
    return fail<FsReadBytesByHandleError>(
      'unknown_handle',
      `handle ${parsed.data.handle} not found (released or never opened)`,
    );
  }

  // Sanity floor: defensive empty-bytes check — `documentStore.register`
  // requires non-empty bytes at open time, so this should be unreachable.
  if (bytes.byteLength === 0) {
    return fail<FsReadBytesByHandleError>(
      'document_evicted',
      `handle ${parsed.data.handle} resolved to zero bytes`,
    );
  }

  return ok({ bytes });
}
