// Document slice — the open PDF model + edit-operation reducer.
// Per docs/conventions.md §6, ARCHITECTURE.md §4–§5.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  type AnnotationModel,
  type EditOperation,
  type PDFDocumentModel,
  type PageModel,
  type SourcePageRef,
} from '../../types/ipc-contract';

import { applyOperationToDocument } from './document-slice-apply';

interface DocumentState {
  current: PDFDocumentModel | null;
  // savePending: a save IPC call is in-flight. Used by the UI to disable Save
  // button and to know whether to show a spinner.
  savePending: boolean;
  saveError: string | null;
  // Set when the user has been prompted about a destination but hasn't completed
  // the dialog yet.
  saveAsTokenPending: boolean;
}

const initialState: DocumentState = {
  current: null,
  savePending: false,
  saveError: null,
  saveAsTokenPending: false,
};

export const documentSlice = createSlice({
  name: 'document',
  initialState,
  reducers: {
    /** Replace the open document. Called after dialog:openPdf / fs:readPdf / pdf:combine. */
    setDocument(state, action: PayloadAction<PDFDocumentModel>) {
      state.current = action.payload;
      state.saveError = null;
    },
    /** Close the open document; clears all per-document state. */
    closeDocument(state) {
      state.current = null;
      state.savePending = false;
      state.saveError = null;
      state.saveAsTokenPending = false;
    },
    /** Apply an EditOperation to the document. Single funnel for all mutations. */
    applyEdit: {
      reducer(state, action: PayloadAction<EditOperation>) {
        if (!state.current) return;
        applyOperationToDocument(state.current, action.payload);
      },
      prepare(op: EditOperation) {
        return {
          payload: op,
          meta: { undoable: true as const, operationId: op.meta.operationId },
        };
      },
    },
    /** Add a Page directly (used by the open path; not an undoable edit). */
    replacePages(
      state,
      action: PayloadAction<{ pages: PageModel[]; annotations: AnnotationModel[] }>,
    ) {
      if (!state.current) return;
      state.current.pages = action.payload.pages;
      state.current.annotations = action.payload.annotations;
      state.current.pageCount = action.payload.pages.length;
    },
    /**
     * Phase 4.1.1 — Update PageModel width/height for pages whose dimensions
     * have been measured by pdf.js. The initial document open uses a US-Letter
     * default (612×792) at thunks.ts:82-90 because `dialog:openPdf` doesn't
     * return per-page dims; this action is dispatched once pdf.js reports
     * the real natural-page dims via `measurePageDimensionsThunk`.
     *
     * Payload contract: array of `{ pageIndex, width, height }`. Entries with
     * a pageIndex out of range OR a non-finite/non-positive dim are ignored
     * silently (defensive — pdf.js can rarely report odd zero-dim pages for
     * a corrupt /MediaBox; we'd rather keep the Letter default than crash).
     *
     * NOT undoable. Pure pagination metadata refresh; preserves every other
     * field of each PageModel (sourcePageRef + rotation in particular).
     */
    setPageDimensions(
      state,
      action: PayloadAction<Array<{ pageIndex: number; width: number; height: number }>>,
    ) {
      if (!state.current) return;
      const pages = state.current.pages;
      for (const update of action.payload) {
        if (
          update.pageIndex < 0 ||
          update.pageIndex >= pages.length ||
          !Number.isFinite(update.width) ||
          !Number.isFinite(update.height) ||
          update.width <= 0 ||
          update.height <= 0
        ) {
          continue;
        }
        const page = pages[update.pageIndex];
        if (!page) continue;
        page.width = update.width;
        page.height = update.height;
      }
    },
    /** Mark the document saved: clears dirtyOps, increments version. */
    markSaved(state) {
      if (!state.current) return;
      state.current.dirtyOps = [];
      state.current.savedAtHandleVersion += 1;
      for (const a of state.current.annotations) {
        a.dirty = false;
      }
      state.savePending = false;
      state.saveError = null;
    },
    setSavePending(state, action: PayloadAction<boolean>) {
      state.savePending = action.payload;
    },
    setSaveError(state, action: PayloadAction<string | null>) {
      state.saveError = action.payload;
      state.savePending = false;
    },
    setSaveAsTokenPending(state, action: PayloadAction<boolean>) {
      state.saveAsTokenPending = action.payload;
    },
  },
});

export const {
  setDocument,
  closeDocument,
  applyEdit,
  replacePages,
  setPageDimensions,
  markSaved,
  setSavePending,
  setSaveError,
  setSaveAsTokenPending,
} = documentSlice.actions;

export default documentSlice.reducer;

// Re-export the source-ref helper for test fixtures + dev tools.
export type { SourcePageRef };
