// In-memory store mapping DocumentHandle -> absolute path + bytes.
// One process-wide instance; handles are monotonic ints (renderer treats opaque).
//
// Lifecycle per docs/api-contracts.md §1:
//   - Created by dialog:openPdf, fs:readPdf, pdf:combine
//   - Released by fs:closePdf
//   - All bytes drop on app quit (process exit GCs the Map)
//
// The store also issues short-lived save-destination tokens used by
// dialog:saveAs -> fs:writePdf so the renderer never sees raw paths.
//
// PHASE 2 (architecture-phase-2.md §3, conventions §13.5):
//   - The store is the lynchpin (decision P2-L-2): main keeps the original
//     `Uint8Array` per handle for the handle's lifetime. Phase 1 already
//     persisted bytes; Phase 2 adds the explicit `getBytes` / `setBytes`
//     accessors used by the replay engine to read source bytes and refresh
//     them post-save (so undo across save still works).
//   - No eviction in Phase 2 (single open document). Phase 5 may add an LRU.
//   - `setBytes` is a SURGICAL extension — the Phase-1 surface
//     (register/get/release/issueDestinationToken/consumeDestinationToken)
//     is preserved bit-for-bit.

import { randomUUID } from 'node:crypto';

import type { DocumentHandle, FileHash } from '../../ipc/contracts.js';

export interface DocumentRecord {
  handle: DocumentHandle;
  /** Absolute path on disk, or null for in-memory-only docs (e.g. combine output). */
  path: string | null;
  displayName: string;
  fileHash: FileHash;
  bytes: Uint8Array;
  pageCount: number;
  pdflibLoadWarnings: string[];
  openedAt: number;
}

export interface SaveDestination {
  token: string;
  path: string;
  displayName: string;
  createdAt: number;
}

const TOKEN_TTL_MS = 60_000;

export class DocumentStore {
  private nextHandle: DocumentHandle = 1;
  private readonly docs = new Map<DocumentHandle, DocumentRecord>();
  private readonly destinations = new Map<string, SaveDestination>();

  /** Register a new document and return its handle. */
  register(rec: Omit<DocumentRecord, 'handle' | 'openedAt'>): DocumentRecord {
    const handle = this.nextHandle++;
    const full: DocumentRecord = { ...rec, handle, openedAt: Date.now() };
    this.docs.set(handle, full);
    return full;
  }

  get(handle: DocumentHandle): DocumentRecord | null {
    return this.docs.get(handle) ?? null;
  }

  /** Release a document handle and its bytes. Returns true if a record was removed. */
  release(handle: DocumentHandle): boolean {
    return this.docs.delete(handle);
  }

  size(): number {
    return this.docs.size;
  }

  // --------------------------------------------------------------------------
  // Phase 2 bytes accessors (architecture-phase-2.md §3.2 / conventions §13.5)
  // --------------------------------------------------------------------------

  /**
   * Phase 2 (architecture-phase-2.md §3.2):
   * Return the document's current original-bytes snapshot, or null if the
   * handle is unknown. The replay-engine's caller (e.g. fs:writePdf,
   * pdf:export, pdf:print) reads here, then passes the result into
   * replay({ originalBytes, ops, annotations, jobId }).
   *
   * NEVER mutate the returned buffer in place — pdf-lib's PDFDocument.load
   * is non-destructive and the engine emits a fresh Uint8Array; callers
   * preserving the original bytes is part of the purity contract.
   */
  getBytes(handle: DocumentHandle): Uint8Array | null {
    const rec = this.docs.get(handle);
    return rec ? rec.bytes : null;
  }

  /**
   * Phase 2 (architecture-phase-2.md §3.3 row "Save succeeds"):
   * Replace the stored bytes for a handle after a successful save / replay.
   * This is the post-save handle-bytes refresh (edit-replay-engine.md §13.1)
   * which keeps the engine's next replay invocation reading from the just-
   * written bytes — required for undo-across-save and for objectId values
   * to round-trip text-replace inverses.
   *
   * Silently no-ops if the handle is unknown (defensive against a race
   * between save and close; renderer surfaces no error in that case).
   */
  setBytes(handle: DocumentHandle, bytes: Uint8Array): void {
    const rec = this.docs.get(handle);
    if (!rec) return;
    rec.bytes = bytes;
  }

  /**
   * Phase 2 (architecture-phase-2.md §3.4 memory accounting hooks).
   * Phase 2 single-document doesn't enforce a global cap, but the accessors
   * are exposed now so Phase 5 multi-document can wire eviction policy
   * without refactoring this class.
   */
  getOpenDocCount(): number {
    return this.docs.size;
  }

  getTotalBytesHeld(): number {
    let total = 0;
    for (const rec of this.docs.values()) total += rec.bytes.byteLength;
    return total;
  }

  /** Allocate a save-destination token bound to an absolute path. Expires after 60s. */
  issueDestinationToken(path: string, displayName: string): SaveDestination {
    this.gcDestinations();
    const token = randomUUID();
    const dest: SaveDestination = { token, path, displayName, createdAt: Date.now() };
    this.destinations.set(token, dest);
    return dest;
  }

  consumeDestinationToken(token: string): SaveDestination | null {
    this.gcDestinations();
    const dest = this.destinations.get(token);
    if (!dest) return null;
    this.destinations.delete(token);
    return dest;
  }

  private gcDestinations(): void {
    const now = Date.now();
    for (const [token, dest] of this.destinations) {
      if (now - dest.createdAt > TOKEN_TTL_MS) this.destinations.delete(token);
    }
  }

  /** Test-only reset. */
  _resetForTests(): void {
    this.nextHandle = 1;
    this.docs.clear();
    this.destinations.clear();
  }
}

// Process-wide singleton. Per Playbook entry #3, stash on globalThis to
// survive any duplicate-module-load case (renderer + custom-server style).
declare global {
  // eslint-disable-next-line no-var
  var __pdfViewerEditorDocumentStore: DocumentStore | undefined;
}

export const documentStore: DocumentStore =
  globalThis.__pdfViewerEditorDocumentStore ??
  (globalThis.__pdfViewerEditorDocumentStore = new DocumentStore());
