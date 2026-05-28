// Document selectors.
//
// Parameterized selectors (those that take a runtime arg like a pageIndex)
// live in a sibling file `document-parameterized-selectors.ts`. See that file
// for the H-2 (2026-05-21) memoization fix rationale and the project-wide
// "parameterized memoized selector" pattern documented in
// `docs/conventions.md` §6.3.

import { createSelector } from '@reduxjs/toolkit';

import { type RootState } from '../store';

export const selectCurrentDocument = (s: RootState) => s.document.current;

export const selectDocumentHandle = createSelector(
  selectCurrentDocument,
  (doc) => doc?.handle ?? null,
);

export const selectDisplayName = createSelector(
  selectCurrentDocument,
  (doc) => doc?.displayName ?? '',
);

export const selectPageCount = createSelector(selectCurrentDocument, (doc) => doc?.pageCount ?? 0);

export const selectPages = createSelector(selectCurrentDocument, (doc) => doc?.pages ?? []);

export const selectAnnotations = createSelector(
  selectCurrentDocument,
  (doc) => doc?.annotations ?? [],
);

export const selectDirtyOps = createSelector(selectCurrentDocument, (doc) => doc?.dirtyOps ?? []);

export const selectIsDirty = createSelector(selectDirtyOps, (ops) => ops.length > 0);

export const selectSavePending = (s: RootState) => s.document.savePending;
export const selectSaveError = (s: RootState) => s.document.saveError;

// `selectPage` and `selectAnnotationsForPage` are parameterized memoized
// selectors. They live in `./document-parameterized-selectors` so Reselect's
// deeply generic OutputSelector types do not leak into THIS file's
// declaration emit. Import them directly from
// `./document-parameterized-selectors` at the call site.
