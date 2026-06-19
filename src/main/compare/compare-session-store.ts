// Phase 7.5 Wave 7 — B2 Compare Files session store.
//
// Canonical spec:
//   - docs/project-plan.md §"Wave 7 — Compare Files (parallel)".
//   - docs/ui-spec-phase-7.5.md §2 (B2 Compare Files).
//
// What this module does:
//   Manages compare-session lifecycle. A session pins two document
//   handles (left = baseline, right = modified) and acts as the lazy
//   cache for pdf.js docs, extracted text, and rasterized PNGs. Pure
//   storage: the engine itself is pure (see text-compare-engine.ts +
//   visual-compare-engine.ts); the wiring layer (pdf-compare-*.ts) hangs
//   pdf.js handles off the cache.
//
// Performance contract:
//   - `openSession` does NOT eagerly load pdf.js for either document.
//     It records the handle pair and emits a session id. The first
//     text or visual compare request triggers per-side pdf.js parse
//     (one parse per document, cached for the session's lifetime).
//   - Per-page work (text extraction, rasterization) is lazy on demand
//     too — the store has a typed cache, but the wiring layer owns
//     filling it.
//   - Eviction: `closeSession` drops every cache entry. Process exit
//     drops the whole Map (no LRU; sessions are short-lived modal-bound).
//
// Memory:
//   Cached PNG bytes can be large. Wiring callers should NOT cache the
//   diff-mask PNG — only the per-side rendered PNG, and only at the
//   `renderWidth` the renderer asked for. Riley's spec suggests modest
//   widths (default 800px). The handler clamps via
//   `visual-compare-engine.MAX_RENDER_WIDTH_PX`.
//
// Engine purity:
//   No pdf.js, no pdf-lib, no I/O. The store is a typed in-memory map
//   with explicit cache slots. L-005 (pdf.js at the wiring boundary)
//   holds — the cached `pdfJsDoc` field has type `unknown` here and is
//   narrowed at the call site.

import { randomUUID } from 'node:crypto';

import type { DocumentHandle } from '../../ipc/contracts.js';

import type { PagePairing } from './page-pairing.js';

/** Compare-session id. Opaque to the renderer. */
export type CompareSessionId = string;

/** Per-side cached page render. `width × height` describe the rendered
 *  canvas; `pngBytes` is the raw PNG buffer the rasterizer produced. */
export interface CachedPageRender {
  width: number;
  height: number;
  pngBytes: Uint8Array;
}

/** Per-side cache state. The wiring layer fills this lazily. */
export interface CompareSessionSide {
  /** Document handle into `documentStore`. */
  handle: DocumentHandle;
  /** Lazily-loaded pdf.js doc handle. Opaque to the store — the wiring
   *  layer narrows the type when it owns the load. */
  pdfJsDoc: unknown | null;
  /** Per-page extracted text cache (keyed by 0-based page index). */
  textCache: Map<number, string>;
  /** Per-page rendered-PNG cache (keyed by `${pageIndex}@${renderWidth}`). */
  renderCache: Map<string, CachedPageRender>;
}

export interface CompareSession {
  id: CompareSessionId;
  createdAt: number;
  left: CompareSessionSide;
  right: CompareSessionSide;
  pageCountLeft: number;
  pageCountRight: number;
  pagePairs: ReadonlyArray<PagePairing>;
}

export class CompareSessionStore {
  private readonly sessions = new Map<CompareSessionId, CompareSession>();

  /** Open a new session. Returns the session record (not just the id)
   *  so the caller can immediately read `pagePairs` for the response
   *  payload. Pure registration — no pdf.js work happens here. */
  open(opts: {
    leftHandle: DocumentHandle;
    rightHandle: DocumentHandle;
    pageCountLeft: number;
    pageCountRight: number;
    pagePairs: ReadonlyArray<PagePairing>;
  }): CompareSession {
    const id = randomUUID();
    const session: CompareSession = {
      id,
      createdAt: Date.now(),
      left: makeSide(opts.leftHandle),
      right: makeSide(opts.rightHandle),
      pageCountLeft: opts.pageCountLeft,
      pageCountRight: opts.pageCountRight,
      pagePairs: opts.pagePairs,
    };
    this.sessions.set(id, session);
    return session;
  }

  /** Look up a session by id, or `null` if unknown. */
  get(id: CompareSessionId): CompareSession | null {
    return this.sessions.get(id) ?? null;
  }

  /** Drop the session and its caches. Returns true if the session was
   *  registered. Idempotent on already-closed sessions (returns false). */
  close(id: CompareSessionId): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    // Best-effort pdf.js doc destroy. The wiring layer owns the type;
    // we look for a `destroy` method via duck-typing.
    tryDestroy(s.left.pdfJsDoc);
    tryDestroy(s.right.pdfJsDoc);
    s.left.textCache.clear();
    s.right.textCache.clear();
    s.left.renderCache.clear();
    s.right.renderCache.clear();
    this.sessions.delete(id);
    return true;
  }

  /** How many sessions are currently open. Diagnostic. */
  size(): number {
    return this.sessions.size;
  }

  /** Test-only: drop every session. Production code should call
   *  `close` explicitly for each session it owns. */
  _resetForTests(): void {
    for (const s of this.sessions.values()) {
      tryDestroy(s.left.pdfJsDoc);
      tryDestroy(s.right.pdfJsDoc);
    }
    this.sessions.clear();
  }
}

// =====================================================================
// Helpers
// =====================================================================

function makeSide(handle: DocumentHandle): CompareSessionSide {
  return {
    handle,
    pdfJsDoc: null,
    textCache: new Map<number, string>(),
    renderCache: new Map<string, CachedPageRender>(),
  };
}

/** Compose the render-cache key. Exported so the wiring layer uses the
 *  same convention. */
export function renderCacheKey(pageIndex: number, renderWidth: number): string {
  return `${pageIndex}@${renderWidth}`;
}

function tryDestroy(doc: unknown): void {
  if (
    doc !== null &&
    typeof doc === 'object' &&
    'destroy' in doc &&
    typeof (doc as { destroy?: unknown }).destroy === 'function'
  ) {
    try {
      const result = (doc as { destroy: () => Promise<void> | void }).destroy();
      // Library returns either undefined or a Promise; swallow either.
      if (result && typeof (result as { catch?: unknown }).catch === 'function') {
        (result as Promise<void>).catch(() => {
          /* best-effort */
        });
      }
    } catch {
      /* best-effort */
    }
  }
}

/** Process-wide instance. Mirrors the documentStore singleton pattern. */
export const compareSessionStore = new CompareSessionStore();
