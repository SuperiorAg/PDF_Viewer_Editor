// MenuBar Phase 7.4 A4 wiring tests — Riley.
// Validates the 9 menu mirrors added for previously-toolbar-only tools:
//   - Edit menu: Rotate CW, Rotate CCW, Delete Current Page
//   - Tools menu: Highlight, Sticky Note, Text Box, Underline, Strikethrough,
//     Freehand
// Per docs/acrobat-parity-audit.md §3.5 + Bucket A4: each entry must dispatch
// the SAME action as the corresponding toolbar button.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import annotationsReducer, { type AnnotationTool } from '../../state/slices/annotations-slice';
import documentReducer, { setDocument } from '../../state/slices/document-slice';
import formsReducer from '../../state/slices/forms-slice';
import historyReducer from '../../state/slices/history-slice';
import mailMergeReducer from '../../state/slices/mail-merge-slice';
import ocrReducer from '../../state/slices/ocr-slice';
import signaturesReducer from '../../state/slices/signatures-slice';
import uiReducer from '../../state/slices/ui-slice';
import viewportReducer from '../../state/slices/viewport-slice';
import { type PDFDocumentModel } from '../../types/ipc-contract';

import { MenuBar } from './index';

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'h',
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

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      ui: uiReducer,
      annotations: annotationsReducer,
      forms: formsReducer,
      mailMerge: mailMergeReducer,
      history: historyReducer,
      ocr: ocrReducer,
      viewport: viewportReducer,
      signatures: signaturesReducer,
    },
  });
}

describe('MenuBar — Phase 7.4 A4 (toolbar-only mirror entries)', () => {
  describe('Edit menu page-op mirrors', () => {
    it('Edit > Rotate Page Clockwise rotates the current page CW', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.click(screen.getByText('Rotate Page Clockwise'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (store.getState() as any).document.current as PDFDocumentModel;
      expect(doc.pages[0]?.rotation).toBe(90);
    });

    it('Edit > Rotate Page Counter-Clockwise rotates the current page CCW', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.click(screen.getByText('Rotate Page Counter-Clockwise'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (store.getState() as any).document.current as PDFDocumentModel;
      expect(doc.pages[0]?.rotation).toBe(270);
    });

    it('Edit > Delete Current Page removes the current page', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.click(screen.getByText('Delete Current Page'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (store.getState() as any).document.current as PDFDocumentModel;
      expect(doc.pageCount).toBe(2);
    });

    it('Edit > Delete Current Page on a single-page doc surfaces the warning toast', () => {
      const store = makeStore();
      store.dispatch(
        setDocument({
          ...DOC,
          pageCount: 1,
          pages: [DOC.pages[0]!],
        }),
      );
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.click(screen.getByText('Delete Current Page'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toasts = (store.getState() as any).ui.toasts as Array<{ kind: string }>;
      expect(toasts.some((tt) => tt.kind === 'warning')).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (store.getState() as any).document.current as PDFDocumentModel;
      expect(doc.pageCount).toBe(1);
    });
  });

  describe('Tools menu annotation tool mirrors', () => {
    const cases: ReadonlyArray<{ label: string; tool: AnnotationTool }> = [
      { label: 'Highlight Tool', tool: 'highlight' },
      { label: 'Sticky Note Tool', tool: 'sticky' },
      { label: 'Text Box Tool', tool: 'text' },
      { label: 'Underline Tool', tool: 'underline' },
      { label: 'Strikethrough Tool', tool: 'strikeout' },
      { label: 'Freehand Tool', tool: 'ink' },
    ];

    for (const { label, tool } of cases) {
      it(`Tools > ${label} sets activeTool to ${tool}`, () => {
        const store = makeStore();
        store.dispatch(setDocument(DOC));
        render(
          <Provider store={store}>
            <MenuBar />
          </Provider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
        fireEvent.click(screen.getByText(label));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((store.getState() as any).annotations.activeTool).toBe(tool);
      });
    }
  });

  describe('Phase 7.4 A1 re-checks', () => {
    it('Insert > Blank Page is wired (not a toast)', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
      fireEvent.click(screen.getByText('Blank Page'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (store.getState() as any).document.current as PDFDocumentModel;
      // pageCount grew by 1 — confirms a real insert dispatch, not a toast.
      expect(doc.pageCount).toBe(4);
    });

    it('Tools > Fill & Sign opens the signature capture modal', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
      fireEvent.click(screen.getByText('Fill & Sign...'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((store.getState() as any).signatures.openModal).toBe('capture');
    });

    it('Edit > Find is disabled with no shortcut and an honest tooltip', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const findBtn = screen.getByText('Find...').closest('button');
      expect(findBtn).not.toBeNull();
      expect((findBtn as HTMLButtonElement).disabled).toBe(true);
      const tip = (findBtn as HTMLButtonElement).title;
      expect(tip).toMatch(/upcoming release/i);
      expect(tip).not.toMatch(/Phase 3/i);
    });
  });
});
