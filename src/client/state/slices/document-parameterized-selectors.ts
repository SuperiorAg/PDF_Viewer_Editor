// Parameterized memoized selectors for the document slice (H-2 fix, 2026-05-21).
//
// Background
// ----------
// Prior versions of `document-selectors.ts` exposed factory selectors:
//
//   export const selectAnnotationsForPage = (pageIndex: number) =>
//     createSelector(selectAnnotations, (anns) => anns.filter(...));
//
// That pattern returns a FRESH `createSelector` instance on every call. When
// consumed via `useAppSelector(selectAnnotationsForPage(props.index))` (see
// PdfCanvas before this fix) it runs on every render, builds a new selector
// whose cache is cold, computes the filter from scratch, returns a new array
// reference, and react-redux then schedules another render against the new
// reference. Memoization is fully defeated.
//
// Fix
// ---
// Use Reselect 5's parameterized form: declare the selector ONCE at module
// scope; include the argument as an input selector so it participates in the
// memo key. Reselect 5.x defaults to `weakMapMemoize`, which is keyed by
// argument identity with effectively unbounded cache size — multi-page render
// scenarios (thumbnail strip + main canvas) share the same selector instance
// and each unique `(state, pageIndex)` pair gets its own cached value.
//
// Consumer call shape:
//   const annotations = useAppSelector((s) => selectAnnotationsForPage(s, idx));
//   const page = useAppSelector((s) => selectPage(s, idx));
//
// docs/conventions.md §6.3 documents the rationale + anti-pattern. See also
// docs/code-review.md H-2 finding (2026-05-21).
//
// Why this file exists separately from `document-selectors.ts`
// ------------------------------------------------------------
// Reselect 5's parameterized `createSelector` produces a deeply generic
// `OutputSelector` type. The explicit return-type annotations on the
// exported `const`s below collapse that to a plain function signature so
// declaration emit (composite: true in tsconfig.renderer.json) does not
// try to NAME the deeply-nested generic. Keeping these selectors in a
// dedicated file also keeps the Reselect generic noise out of the main
// `document-selectors.ts` API surface.

import { createSelector } from '@reduxjs/toolkit';

import { type AnnotationModel, type PageModel } from '../../types/ipc-contract';
import { type RootState } from '../store';

import { selectAnnotations, selectPages } from './document-selectors';

const selectPageIndexArg = (_s: RootState, pageIndex: number): number => pageIndex;

// Explicit return-type annotation is REQUIRED — see file header.
export const selectPage: (state: RootState, pageIndex: number) => PageModel | null = createSelector(
  [selectPages, selectPageIndexArg],
  (pages, pageIndex) => pages[pageIndex] ?? null,
);

// Explicit return-type annotation is REQUIRED — see file header.
export const selectAnnotationsForPage: (state: RootState, pageIndex: number) => AnnotationModel[] =
  createSelector([selectAnnotations, selectPageIndexArg], (annotations, pageIndex) =>
    annotations.filter((a) => a.pageIndex === pageIndex),
  );
