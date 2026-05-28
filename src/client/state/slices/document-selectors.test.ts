import { describe, expect, it } from 'vitest';

import { type PDFDocumentModel } from '../../types/ipc-contract';
import { type RootState } from '../store';

import { selectAnnotationsForPage, selectPage } from './document-parameterized-selectors';
import {
  selectAnnotations,
  selectCurrentDocument,
  selectIsDirty,
  selectPageCount,
} from './document-selectors';

function makeState(current: PDFDocumentModel | null): RootState {
  // any: only the document slice is exercised in these unit tests; we cast
  // around the partial shape.
  return {
    document: { current, savePending: false, saveError: null, saveAsTokenPending: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const doc: PDFDocumentModel = {
  handle: 1,
  displayName: 'x.pdf',
  fileHash: 'h',
  pageCount: 2,
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
  ],
  annotations: [
    {
      id: 'a',
      pageIndex: 0,
      subtype: 'Highlight',
      rect: { x: 0, y: 0, width: 10, height: 10 },
      color: { r: 1, g: 1, b: 0 },
      opacity: 0.5,
      createdAt: 0,
      modifiedAt: 0,
      dirty: true,
    },
    {
      id: 'b',
      pageIndex: 1,
      subtype: 'Text',
      rect: { x: 0, y: 0, width: 10, height: 10 },
      color: { r: 0, g: 0, b: 1 },
      opacity: 1,
      createdAt: 0,
      modifiedAt: 0,
      dirty: true,
    },
  ],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

describe('document selectors', () => {
  it('selectCurrentDocument returns null when no doc is open', () => {
    expect(selectCurrentDocument(makeState(null))).toBeNull();
  });

  it('selectPageCount returns 0 when no doc', () => {
    expect(selectPageCount(makeState(null))).toBe(0);
  });

  it('selectPageCount returns the open document page count', () => {
    expect(selectPageCount(makeState(doc))).toBe(2);
  });

  it('selectIsDirty is false when dirtyOps is empty', () => {
    expect(selectIsDirty(makeState(doc))).toBe(false);
  });

  it('selectAnnotationsForPage filters by pageIndex', () => {
    const forPage1 = selectAnnotationsForPage(makeState(doc), 1);
    expect(forPage1.length).toBe(1);
    expect(forPage1[0]?.id).toBe('b');
  });

  it('selectAnnotations returns all annotations', () => {
    expect(selectAnnotations(makeState(doc)).length).toBe(2);
  });

  // H-2 regression guard (2026-05-21): the parameterized memoized selector
  // MUST return the same array reference when called twice with the same
  // (state, pageIndex) pair. The previous factory pattern returned a new
  // createSelector instance per call, producing fresh arrays each time and
  // defeating reselect — which then triggered a render storm in PdfCanvas.
  // If this test fails, document-selectors.ts has regressed back to the
  // factory pattern; do NOT relax the assertion. See docs/conventions.md
  // §6.3 and docs/code-review.md H-2.
  it('selectAnnotationsForPage returns the same array reference on repeat calls (memoization)', () => {
    const state = makeState(doc);
    const first = selectAnnotationsForPage(state, 1);
    const second = selectAnnotationsForPage(state, 1);
    expect(second).toBe(first);
  });

  it('selectAnnotationsForPage returns distinct cached results for distinct pageIndex args', () => {
    const state = makeState(doc);
    const forPage0 = selectAnnotationsForPage(state, 0);
    const forPage1 = selectAnnotationsForPage(state, 1);
    expect(forPage0).not.toBe(forPage1);
    // and calling each again returns its own stable reference
    expect(selectAnnotationsForPage(state, 0)).toBe(forPage0);
    expect(selectAnnotationsForPage(state, 1)).toBe(forPage1);
  });

  it('selectPage returns the same PageModel reference on repeat calls (memoization)', () => {
    const state = makeState(doc);
    const first = selectPage(state, 0);
    const second = selectPage(state, 0);
    expect(second).toBe(first);
    expect(first?.pageIndex).toBe(0);
  });
});
