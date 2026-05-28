import { describe, expect, it } from 'vitest';

import {
  type AnnotationModel,
  type EditOperation,
  type PDFDocumentModel,
  type SourcePageRef,
} from '../../types/ipc-contract';

import { inverseOf } from './document-inverses';
import documentReducer, {
  applyEdit,
  markSaved,
  setDocument,
  setPageDimensions,
} from './document-slice';
import { applyOperationToDocument } from './document-slice-apply';

function makeDoc(pageCount: number): PDFDocumentModel {
  return {
    handle: 1,
    displayName: 'test.pdf',
    fileHash: 'abc',
    pageCount,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      pageIndex: i,
      sourcePageRef: { kind: 'original' as const, originalIndex: i },
      rotation: 0 as const,
      width: 612,
      height: 792,
    })),
    annotations: [],
    dirtyOps: [],
    savedAtHandleVersion: 0,
    pdflibLoadWarnings: [],
  };
}

function makeAnnot(id: string, pageIndex: number): AnnotationModel {
  return {
    id,
    pageIndex,
    subtype: 'Highlight',
    rect: { x: 0, y: 0, width: 100, height: 20 },
    color: { r: 1, g: 1, b: 0 },
    opacity: 0.5,
    createdAt: 0,
    modifiedAt: 0,
    dirty: true,
  };
}

const meta = (id: string) => ({ ts: 0, undoable: true as const, operationId: id });

describe('documentSlice — basic actions', () => {
  it('should set and clear the open document', () => {
    let state = documentReducer(undefined, { type: 'init' });
    state = documentReducer(state, setDocument(makeDoc(3)));
    expect(state.current?.pageCount).toBe(3);
  });

  // Phase 4.1.1 — setPageDimensions root-cause fix for the hardcoded Letter
  // defaults in thunks.ts:82-92. Pinned here so the reducer contract
  // survives future refactors.
  describe('setPageDimensions (Phase 4.1.1)', () => {
    it('replaces width + height for the named pages, preserving other fields', () => {
      let state = documentReducer(undefined, { type: 'init' });
      state = documentReducer(state, setDocument(makeDoc(3)));
      // A4 dims (pdf points). pdf.js reports floats; the slice accepts any
      // finite positive number.
      state = documentReducer(
        state,
        setPageDimensions([
          { pageIndex: 0, width: 595, height: 842 },
          { pageIndex: 1, width: 842, height: 595 },
          { pageIndex: 2, width: 595, height: 842 },
        ]),
      );
      expect(state.current?.pages[0]?.width).toBe(595);
      expect(state.current?.pages[0]?.height).toBe(842);
      expect(state.current?.pages[1]?.width).toBe(842);
      expect(state.current?.pages[1]?.height).toBe(595);
      // sourcePageRef + rotation preserved.
      expect(state.current?.pages[0]?.sourcePageRef).toEqual({
        kind: 'original',
        originalIndex: 0,
      });
      expect(state.current?.pages[0]?.rotation).toBe(0);
    });

    it('is a no-op when no document is open', () => {
      let state = documentReducer(undefined, { type: 'init' });
      state = documentReducer(state, setPageDimensions([{ pageIndex: 0, width: 1, height: 1 }]));
      expect(state.current).toBeNull();
    });

    it('ignores out-of-range pageIndex entries (defensive against stale measures)', () => {
      let state = documentReducer(undefined, { type: 'init' });
      state = documentReducer(state, setDocument(makeDoc(2)));
      state = documentReducer(
        state,
        setPageDimensions([
          { pageIndex: 0, width: 595, height: 842 },
          { pageIndex: 99, width: 100, height: 100 }, // ignored
          { pageIndex: -1, width: 100, height: 100 }, // ignored
        ]),
      );
      expect(state.current?.pages[0]?.width).toBe(595);
      expect(state.current?.pages.length).toBe(2); // no page added
      // Page 1 still has Letter defaults (unchanged).
      expect(state.current?.pages[1]?.width).toBe(612);
      expect(state.current?.pages[1]?.height).toBe(792);
    });

    it('ignores non-finite or non-positive dims (defensive against /MediaBox corruption)', () => {
      let state = documentReducer(undefined, { type: 'init' });
      state = documentReducer(state, setDocument(makeDoc(3)));
      state = documentReducer(
        state,
        setPageDimensions([
          { pageIndex: 0, width: 0, height: 100 }, // ignored (zero)
          { pageIndex: 1, width: 100, height: -1 }, // ignored (negative)
          { pageIndex: 2, width: Number.NaN, height: 100 }, // ignored (NaN)
        ]),
      );
      // All three retain the Letter defaults from makeDoc.
      expect(state.current?.pages[0]?.width).toBe(612);
      expect(state.current?.pages[1]?.height).toBe(792);
      expect(state.current?.pages[2]?.width).toBe(612);
    });

    it('updating dimensions does NOT push a dirty op (not an EditOperation)', () => {
      let state = documentReducer(undefined, { type: 'init' });
      state = documentReducer(state, setDocument(makeDoc(2)));
      state = documentReducer(
        state,
        setPageDimensions([{ pageIndex: 0, width: 595, height: 842 }]),
      );
      expect(state.current?.dirtyOps.length).toBe(0);
    });
  });

  it('should clear dirtyOps and bump version on markSaved', () => {
    let state = documentReducer(undefined, { type: 'init' });
    state = documentReducer(state, setDocument(makeDoc(2)));
    const op: EditOperation = {
      kind: 'rotate',
      meta: meta('r1'),
      pageIndex: 0,
      fromRotation: 0,
      toRotation: 90,
    };
    state = documentReducer(state, applyEdit(op));
    expect(state.current?.dirtyOps.length).toBe(1);
    state = documentReducer(state, markSaved());
    expect(state.current?.dirtyOps.length).toBe(0);
    expect(state.current?.savedAtHandleVersion).toBe(1);
  });
});

describe('applyOperationToDocument — page ops', () => {
  it('should rotate a page', () => {
    const doc = makeDoc(2);
    applyOperationToDocument(doc, {
      kind: 'rotate',
      meta: meta('r'),
      pageIndex: 1,
      fromRotation: 0,
      toRotation: 90,
    });
    expect(doc.pages[1]?.rotation).toBe(90);
    expect(doc.dirtyOps.length).toBe(1);
  });

  it('should reorder a page and update indices', () => {
    const doc = makeDoc(3);
    applyOperationToDocument(doc, {
      kind: 'reorder',
      meta: meta('o'),
      fromIndex: 0,
      toIndex: 2,
    });
    expect(doc.pages[0]?.sourcePageRef).toEqual({ kind: 'original', originalIndex: 1 });
    expect(doc.pages[1]?.sourcePageRef).toEqual({ kind: 'original', originalIndex: 2 });
    expect(doc.pages[2]?.sourcePageRef).toEqual({ kind: 'original', originalIndex: 0 });
    expect(doc.pages.map((p) => p.pageIndex)).toEqual([0, 1, 2]);
  });

  it('should insert a blank page and shift indices', () => {
    const doc = makeDoc(2);
    const src: SourcePageRef = { kind: 'blank', width: 612, height: 792 };
    applyOperationToDocument(doc, {
      kind: 'insert',
      meta: meta('i'),
      atIndex: 1,
      source: src,
    });
    expect(doc.pageCount).toBe(3);
    expect(doc.pages[1]?.sourcePageRef.kind).toBe('blank');
  });

  it('should delete a page and shift annotations', () => {
    const doc = makeDoc(3);
    doc.annotations.push(makeAnnot('a', 2));
    applyOperationToDocument(doc, {
      kind: 'delete',
      meta: meta('d'),
      pageIndex: 0,
      preservedSource: { kind: 'original', originalIndex: 0 },
    });
    expect(doc.pageCount).toBe(2);
    expect(doc.annotations[0]?.pageIndex).toBe(1);
  });
});

describe('applyOperationToDocument — annotation ops', () => {
  it('should add an annotation', () => {
    const doc = makeDoc(1);
    applyOperationToDocument(doc, {
      kind: 'annot-add',
      meta: meta('aa'),
      annotation: makeAnnot('x', 0),
    });
    expect(doc.annotations.length).toBe(1);
    expect(doc.annotations[0]?.dirty).toBe(true);
  });

  it('should edit an annotation', () => {
    const doc = makeDoc(1);
    doc.annotations.push(makeAnnot('x', 0));
    applyOperationToDocument(doc, {
      kind: 'annot-edit',
      meta: meta('ae'),
      id: 'x',
      before: { opacity: 0.5 },
      after: { opacity: 0.9 },
    });
    expect(doc.annotations[0]?.opacity).toBe(0.9);
  });

  it('should delete an annotation', () => {
    const doc = makeDoc(1);
    doc.annotations.push(makeAnnot('x', 0));
    applyOperationToDocument(doc, {
      kind: 'annot-delete',
      meta: meta('ad'),
      before: makeAnnot('x', 0),
    });
    expect(doc.annotations.length).toBe(0);
  });
});

describe('inverseOf — round-trip identity', () => {
  it('reorder composed with its inverse is identity', () => {
    const docA = makeDoc(4);
    const docB = makeDoc(4);
    const fwd: EditOperation = {
      kind: 'reorder',
      meta: meta('f'),
      fromIndex: 0,
      toIndex: 3,
    };
    applyOperationToDocument(docA, fwd);
    const inv = inverseOf(fwd, docB);
    applyOperationToDocument(docA, inv);
    // Strip dirtyOps and compare logical state.
    expect(docA.pages.map((p) => p.sourcePageRef)).toEqual(docB.pages.map((p) => p.sourcePageRef));
  });

  it('insert composed with its inverse is identity', () => {
    const docA = makeDoc(2);
    const docB = makeDoc(2);
    const fwd: EditOperation = {
      kind: 'insert',
      meta: meta('f'),
      atIndex: 1,
      source: { kind: 'blank', width: 612, height: 792 },
    };
    applyOperationToDocument(docA, fwd);
    const inv = inverseOf(fwd, docB);
    applyOperationToDocument(docA, inv);
    expect(docA.pageCount).toBe(docB.pageCount);
  });

  it('rotate composed with its inverse is identity', () => {
    const docA = makeDoc(1);
    const docB = makeDoc(1);
    const fwd: EditOperation = {
      kind: 'rotate',
      meta: meta('f'),
      pageIndex: 0,
      fromRotation: 0,
      toRotation: 90,
    };
    applyOperationToDocument(docA, fwd);
    const inv = inverseOf(fwd, docB);
    applyOperationToDocument(docA, inv);
    expect(docA.pages[0]?.rotation).toBe(0);
  });

  it('annot-add inverse is annot-delete', () => {
    const doc = makeDoc(1);
    const annot = makeAnnot('a', 0);
    const fwd: EditOperation = { kind: 'annot-add', meta: meta('f'), annotation: annot };
    applyOperationToDocument(doc, fwd);
    expect(doc.annotations.length).toBe(1);
    const inv = inverseOf(fwd, doc);
    expect(inv.kind).toBe('annot-delete');
    applyOperationToDocument(doc, inv);
    expect(doc.annotations.length).toBe(0);
  });
});
