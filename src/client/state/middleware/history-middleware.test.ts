// History middleware — Vitest spec. Phase 2 / Wave 7 + Wave 8.6 (N-1 fix).
//
// Asserts the undo/redo round-trip for a representative EditOperation,
// PLUS the Wave 8.6 N-1 fix: dispatched op carries raw image bytes (so
// dirtyOps → IPC → main replay engine sees them) even though the history
// stack stores the compacted form for storage footprint.

import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';

import {
  type EditOperation,
  type ImageEmbedPayload,
  type PDFDocumentModel,
} from '../../types/ipc-contract';
import documentReducer, { applyEdit, setDocument } from '../slices/document-slice';
import historyReducer, { type HistoryEntry } from '../slices/history-slice';

import { historyMiddleware, redoAction, undoAction } from './history-middleware';

function makeDoc(): PDFDocumentModel {
  return {
    handle: 1,
    displayName: 'demo.pdf',
    fileHash: 'a'.repeat(64),
    pageCount: 3,
    pages: [
      {
        pageIndex: 0,
        sourcePageRef: { kind: 'original', originalIndex: 0 },
        rotation: 0,
        width: 612,
        height: 792,
      },
      {
        pageIndex: 1,
        sourcePageRef: { kind: 'original', originalIndex: 1 },
        rotation: 0,
        width: 612,
        height: 792,
      },
      {
        pageIndex: 2,
        sourcePageRef: { kind: 'original', originalIndex: 2 },
        rotation: 0,
        width: 612,
        height: 792,
      },
    ],
    annotations: [],
    dirtyOps: [],
    savedAtHandleVersion: 0,
    pdflibLoadWarnings: [],
  };
}

// Image payload helper — bytes simulate a PNG header. The contentHash is the
// identity key main's image-cache uses; bytes are what `embedImage()` checks
// before consulting the cache (image-embed.ts:69-71 — empty bytes are rejected
// up front, which is the N-1 root cause this test guards against).
function makeImagePayload(hash = 'imgsha-rt-001'): ImageEmbedPayload {
  return {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    mimeType: 'image/png',
    width: 800,
    height: 600,
    contentHash: hash,
  };
}

// Doc with one image-page sandwiched between two original pages. The image
// page mirrors the state after an `image-insert` op has been applied: its
// sourcePageRef.kind === 'image' and carries the full ImageEmbedPayload.
function makeDocWithImagePage(payload: ImageEmbedPayload): PDFDocumentModel {
  return {
    handle: 1,
    displayName: 'demo.pdf',
    fileHash: 'a'.repeat(64),
    pageCount: 3,
    pages: [
      {
        pageIndex: 0,
        sourcePageRef: { kind: 'original', originalIndex: 0 },
        rotation: 0,
        width: 612,
        height: 792,
      },
      {
        pageIndex: 1,
        sourcePageRef: { kind: 'image', image: payload, pageWidth: 600, pageHeight: 450 },
        rotation: 0,
        width: 600,
        height: 450,
      },
      {
        pageIndex: 2,
        sourcePageRef: { kind: 'original', originalIndex: 1 },
        rotation: 0,
        width: 612,
        height: 792,
      },
    ],
    annotations: [],
    dirtyOps: [],
    savedAtHandleVersion: 0,
    pdflibLoadWarnings: [],
  };
}

function makeStore(): ReturnType<typeof configureStore> {
  return configureStore({
    reducer: {
      document: documentReducer,
      history: historyReducer,
    },
    middleware: (g) =>
      // The N-1 tests intentionally route Uint8Array image bytes through state
      // (page-model sourcePageRef.image.bytes, dirtyOps[*].image.bytes,
      // history-entry rawFwd/rawInv image bytes). Disable serializableCheck
      // entirely in this test rather than enumerate every path — the prod
      // store handles serialization at the IPC boundary, not via RTK's check.
      g({ serializableCheck: false }).concat(historyMiddleware),
  });
}

describe('historyMiddleware — Phase 2 undo/redo', () => {
  it('pushes an entry onto past when an undoable applyEdit fires', () => {
    const store = makeStore();
    store.dispatch(setDocument(makeDoc()));
    const op: EditOperation = {
      kind: 'rotate',
      meta: { ts: Date.now(), undoable: true, operationId: 'r-1' },
      pageIndex: 0,
      fromRotation: 0,
      toRotation: 90,
    };
    store.dispatch(applyEdit(op));
    const state = store.getState() as {
      document: { current: PDFDocumentModel | null };
      history: { past: unknown[]; future: unknown[] };
    };
    expect(state.history.past.length).toBe(1);
    expect(state.document.current?.pages[0]?.rotation).toBe(90);
  });

  it('undoAction applies the inverse and pops past into future', () => {
    const store = makeStore();
    store.dispatch(setDocument(makeDoc()));
    const op: EditOperation = {
      kind: 'rotate',
      meta: { ts: Date.now(), undoable: true, operationId: 'r-1' },
      pageIndex: 0,
      fromRotation: 0,
      toRotation: 90,
    };
    store.dispatch(applyEdit(op));
    store.dispatch(undoAction());
    const state = store.getState() as {
      document: { current: PDFDocumentModel | null };
      history: { past: unknown[]; future: unknown[] };
    };
    expect(state.document.current?.pages[0]?.rotation).toBe(0);
    expect(state.history.past.length).toBe(0);
    expect(state.history.future.length).toBe(1);
  });

  it('redoAction re-applies the forward op and moves future back to past', () => {
    const store = makeStore();
    store.dispatch(setDocument(makeDoc()));
    const op: EditOperation = {
      kind: 'rotate',
      meta: { ts: Date.now(), undoable: true, operationId: 'r-1' },
      pageIndex: 0,
      fromRotation: 0,
      toRotation: 90,
    };
    store.dispatch(applyEdit(op));
    store.dispatch(undoAction());
    store.dispatch(redoAction());
    const state = store.getState() as {
      document: { current: PDFDocumentModel | null };
      history: { past: unknown[]; future: unknown[] };
    };
    expect(state.document.current?.pages[0]?.rotation).toBe(90);
    expect(state.history.past.length).toBe(1);
    expect(state.history.future.length).toBe(0);
  });
});

// ----------------------------------------------------------------------
// Wave 8.6 N-1 fix — two-state model: compacted in storage, raw on dispatch.
//
// This block is the regression test that would have caught N-1 in Wave 7.
// The flow guarded here is exactly the user-facing scenario Julian called out
// in the Wave 8.5 re-audit:
//   1. User has a doc whose page 1 is an image-page (sourcePageRef.kind === 'image').
//   2. User deletes page 1 — fwd op `delete{preservedSource: {kind: 'image', image: {...full bytes}}}`.
//   3. User undoes — middleware dispatches the inverse `image-insert`.
//   4. The dispatched payload MUST carry full image bytes so dirtyOps → IPC →
//      main's `embedImage()` does not reject `invalid_image`.
//   5. Simultaneously the history slice MUST hold the compacted form so the
//      stack memory footprint stays bounded.
// ----------------------------------------------------------------------

describe('historyMiddleware — Wave 8.6 N-1 two-state model', () => {
  it('stores compacted fwd/inv but keeps raw bytes in rawFwd/rawInv (image-insert)', () => {
    const store = makeStore();
    store.dispatch(setDocument(makeDoc()));
    const payload = makeImagePayload('imgsha-store-001');
    const op: EditOperation = {
      kind: 'image-insert',
      meta: { ts: Date.now(), undoable: true, operationId: 'ii-1' },
      atIndex: 1,
      image: payload,
    };
    store.dispatch(applyEdit(op));
    const state = store.getState() as {
      document: { current: PDFDocumentModel | null };
      history: { past: HistoryEntry[]; future: HistoryEntry[] };
    };
    expect(state.history.past.length).toBe(1);
    const entry = state.history.past[0];
    expect(entry).toBeDefined();
    if (!entry) return;

    // Compacted form: image bytes zeroed.
    if (entry.fwd.kind !== 'image-insert') throw new Error('expected image-insert fwd');
    expect(entry.fwd.image.bytes.byteLength).toBe(0);
    expect(entry.fwd.image.contentHash).toBe('imgsha-store-001');

    // Raw form: bytes intact for on-the-wire dispatch.
    if (entry.rawFwd.kind !== 'image-insert') throw new Error('expected image-insert rawFwd');
    expect(entry.rawFwd.image.bytes.byteLength).toBe(payload.bytes.byteLength);
    expect(entry.rawFwd.image.contentHash).toBe('imgsha-store-001');

    // Inverse: `delete` carries `preservedSource: { kind: 'image', image: ... }`
    // with bytes intact on rawInv. (The current `compactImageOpForHistory` does
    // not zero bytes on the delete-preservedSource path — only on image-insert /
    // image-overlay / image-overlay-delete — so `inv` here happens to match
    // `rawInv`. That's a separate observation flagged for Phase 2.5; the
    // load-bearing assertion this test guards is that rawInv preserves bytes
    // for the dispatch path. The symmetric case (image-insert AS an inverse,
    // produced by undo-of-delete-image-page) is the round-trip test below.)
    if (entry.rawInv.kind !== 'delete') throw new Error('expected delete rawInv');
    if (entry.rawInv.preservedSource.kind !== 'image') {
      throw new Error('expected image preservedSource on rawInv');
    }
    expect(entry.rawInv.preservedSource.image.bytes.byteLength).toBe(payload.bytes.byteLength);
  });

  it('round-trip: delete image-page → undo → dirtyOps carries image-insert with REAL bytes (N-1 regression)', () => {
    // This is THE regression test Julian's N-1 audit asks for.
    // Sequence: doc with image-page → delete it → undo → inspect dirtyOps.
    // The undo-dispatched op MUST carry full image bytes; otherwise on save
    // main's embedImage() rejects `invalid_image` and atomic save rolls back.
    const store = makeStore();
    const payload = makeImagePayload('imgsha-rt-002');
    store.dispatch(setDocument(makeDocWithImagePage(payload)));

    // Step 1: delete the image page (index 1).
    const deleteOp: EditOperation = {
      kind: 'delete',
      meta: { ts: Date.now(), undoable: true, operationId: 'd-img-1' },
      pageIndex: 1,
      preservedSource: { kind: 'image', image: payload, pageWidth: 600, pageHeight: 450 },
    };
    store.dispatch(applyEdit(deleteOp));

    // After delete: page count down to 2, dirtyOps has the delete.
    let state = store.getState() as {
      document: { current: PDFDocumentModel | null };
      history: { past: HistoryEntry[]; future: HistoryEntry[] };
    };
    expect(state.document.current?.pageCount).toBe(2);
    expect(state.document.current?.dirtyOps.length).toBe(1);
    expect(state.history.past.length).toBe(1);

    // Step 2: undo. The inverse is `image-insert` and MUST be dispatched
    // with full image bytes so dirtyOps carries them.
    store.dispatch(undoAction());

    state = store.getState() as {
      document: { current: PDFDocumentModel | null };
      history: { past: HistoryEntry[]; future: HistoryEntry[] };
    };

    // The page came back.
    expect(state.document.current?.pageCount).toBe(3);
    expect(state.document.current?.pages[1]?.sourcePageRef.kind).toBe('image');

    // dirtyOps now has [delete, image-insert] — both flow to IPC at save time.
    expect(state.document.current?.dirtyOps.length).toBe(2);
    const insertOp = state.document.current?.dirtyOps[1];
    expect(insertOp).toBeDefined();
    if (!insertOp || insertOp.kind !== 'image-insert') {
      throw new Error('expected image-insert as the second dirtyOp after undo');
    }
    // THE LOAD-BEARING ASSERTION: bytes are intact, not zeroed.
    // Pre-fix (Wave 7/8.5), this would be 0 because the middleware dispatched
    // the compacted form. Post-fix, dispatching rawInv preserves the bytes.
    expect(insertOp.image.bytes.byteLength).toBe(payload.bytes.byteLength);
    expect(insertOp.image.contentHash).toBe('imgsha-rt-002');

    // History bookkeeping: entry moved past → future.
    expect(state.history.past.length).toBe(0);
    expect(state.history.future.length).toBe(1);
  });

  // Wave 10 R-10.2 — pin the implicit-dedup invariant. `inverseOf` aliases
  // `op.image` / `op.preservedSource.image` (no clone, no byte copy), so the
  // raw forward and raw inverse share the SAME Uint8Array reference per
  // image-op history entry. Any future change to `inverseOf` that introduces
  // a structuredClone or byte-slice breaks this dedup and doubles the
  // per-entry footprint. This test fails fast if that happens.
  it('rawFwd and rawInv share the SAME Uint8Array reference for image-insert (R-10.2)', () => {
    const store = makeStore();
    store.dispatch(setDocument(makeDoc()));
    const payload = makeImagePayload('imgsha-r102-001');
    const op: EditOperation = {
      kind: 'image-insert',
      meta: { ts: Date.now(), undoable: true, operationId: 'ii-r102-1' },
      atIndex: 1,
      image: payload,
    };
    store.dispatch(applyEdit(op));
    const state = store.getState() as {
      document: { current: PDFDocumentModel | null };
      history: { past: HistoryEntry[]; future: HistoryEntry[] };
    };
    const entry = state.history.past[0];
    if (!entry) throw new Error('expected history entry');
    if (entry.rawFwd.kind !== 'image-insert') throw new Error('expected image-insert rawFwd');
    if (entry.rawInv.kind !== 'delete') throw new Error('expected delete rawInv');
    if (entry.rawInv.preservedSource.kind !== 'image') {
      throw new Error('expected image preservedSource on rawInv');
    }
    // Identity, not equality — the same Uint8Array buffer instance.
    expect(entry.rawFwd.image.bytes).toBe(entry.rawInv.preservedSource.image.bytes);
    // And both still reference the user's original payload bytes (no clone).
    expect(entry.rawFwd.image.bytes).toBe(payload.bytes);
  });

  // Wave 10 R-10.1 regression — compactImageOpForHistory now covers the
  // `delete{preservedSource:image}` shape (the missing fourth variant Riley
  // flagged as Wave 8.6 contract-observation #2). Pre-fix: the FORWARD delete
  // of an image-page leaked full bytes into history.past[*].fwd. Post-fix:
  // entry.fwd.preservedSource.image.bytes is zero-length; entry.rawFwd
  // preserves the bytes for dispatch on redo. Symmetric to image-insert.
  it('compacts FWD delete{preservedSource:image} bytes in history storage (R-10.1)', () => {
    const store = makeStore();
    const payload = makeImagePayload('imgsha-r101-001');
    store.dispatch(setDocument(makeDocWithImagePage(payload)));

    const deleteOp: EditOperation = {
      kind: 'delete',
      meta: { ts: Date.now(), undoable: true, operationId: 'd-r101-1' },
      pageIndex: 1,
      preservedSource: { kind: 'image', image: payload, pageWidth: 600, pageHeight: 450 },
    };
    store.dispatch(applyEdit(deleteOp));

    const state = store.getState() as {
      document: { current: PDFDocumentModel | null };
      history: { past: HistoryEntry[]; future: HistoryEntry[] };
    };
    expect(state.history.past.length).toBe(1);
    const entry = state.history.past[0];
    if (!entry) throw new Error('expected history entry');

    // Compacted forward form: preservedSource.image.bytes zeroed; contentHash retained.
    if (entry.fwd.kind !== 'delete') throw new Error('expected delete fwd');
    if (entry.fwd.preservedSource.kind !== 'image') {
      throw new Error('expected image preservedSource on fwd');
    }
    expect(entry.fwd.preservedSource.image.bytes.byteLength).toBe(0);
    expect(entry.fwd.preservedSource.image.contentHash).toBe('imgsha-r101-001');

    // Raw forward form: bytes intact for dispatch on redo.
    if (entry.rawFwd.kind !== 'delete') throw new Error('expected delete rawFwd');
    if (entry.rawFwd.preservedSource.kind !== 'image') {
      throw new Error('expected image preservedSource on rawFwd');
    }
    expect(entry.rawFwd.preservedSource.image.bytes.byteLength).toBe(payload.bytes.byteLength);
    expect(entry.rawFwd.preservedSource.image.contentHash).toBe('imgsha-r101-001');

    // Compacted INVERSE (image-insert) is also bytes-zeroed — the existing
    // image-insert branch of the compactor already covered this; assert here
    // so the four-variant compaction surface is exhaustively pinned.
    if (entry.inv.kind !== 'image-insert') throw new Error('expected image-insert inv');
    expect(entry.inv.image.bytes.byteLength).toBe(0);
    expect(entry.inv.image.contentHash).toBe('imgsha-r101-001');
  });

  it('redo after undo of delete-image: dirtyOps carries the delete op via rawFwd', () => {
    // Symmetric path: after undo (above), pressing redo re-applies the original
    // delete. The dispatched payload comes from entry.rawFwd. The delete op
    // doesn't itself carry image bytes, but the rawFwd path must be honored so
    // the meta/operationId on dirtyOps is the ORIGINAL forward op (not the
    // compacted clone). Verifies the symmetric half of the two-state model.
    const store = makeStore();
    const payload = makeImagePayload('imgsha-rt-003');
    store.dispatch(setDocument(makeDocWithImagePage(payload)));

    const deleteOp: EditOperation = {
      kind: 'delete',
      meta: { ts: 12345, undoable: true, operationId: 'd-img-3' },
      pageIndex: 1,
      preservedSource: { kind: 'image', image: payload, pageWidth: 600, pageHeight: 450 },
    };
    store.dispatch(applyEdit(deleteOp));
    store.dispatch(undoAction());
    store.dispatch(redoAction());

    const state = store.getState() as {
      document: { current: PDFDocumentModel | null };
      history: { past: HistoryEntry[]; future: HistoryEntry[] };
    };
    // After redo: page deleted again, page count 2.
    expect(state.document.current?.pageCount).toBe(2);
    // dirtyOps now has [delete, image-insert(undo), delete(redo)] — three ops.
    expect(state.document.current?.dirtyOps.length).toBe(3);
    const redoneOp = state.document.current?.dirtyOps[2];
    if (!redoneOp || redoneOp.kind !== 'delete') {
      throw new Error('expected delete as the third dirtyOp after redo');
    }
    // The redone delete carries the ORIGINAL operationId — proves rawFwd was
    // dispatched (compacted fwd would have the same id because delete has no
    // image bytes to compact, but the raw-dispatch path is still the route).
    expect(redoneOp.meta.operationId).toBe('d-img-3');
    // The preservedSource bytes survived the round-trip via rawFwd.
    if (redoneOp.preservedSource.kind !== 'image') {
      throw new Error('expected image preservedSource on redone delete');
    }
    expect(redoneOp.preservedSource.image.bytes.byteLength).toBe(payload.bytes.byteLength);
  });
});
