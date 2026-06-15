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
// Phase 7.4 B1 — Redact menu wiring
import redactionsReducer, { addMark } from '../../state/slices/redactions-slice';
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
      redactions: redactionsReducer,
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

  describe('Phase 7.4 B1 Redaction menu mirrors', () => {
    const RECT = { x: 10, y: 20, width: 100, height: 40 };

    it('Tools > Mark Rectangle for Redaction opens the panel + arms the rect tool', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
      fireEvent.click(screen.getByText('Mark Rectangle for Redaction'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ui = (store.getState() as any).ui as {
        redactionPanelOpen: boolean;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (store.getState() as any).redactions as { activeTool: string | null };
      expect(ui.redactionPanelOpen).toBe(true);
      expect(r.activeTool).toBe('rect');
    });

    it('Tools > Show Redaction Markups toggles the overlay flag', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const initial = (store.getState() as any).redactions.showMarks as boolean;
      fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
      fireEvent.click(screen.getByText('Show Redaction Markups'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((store.getState() as any).redactions.showMarks).toBe(!initial);
    });

    it('Tools > Clear Redaction Marks is disabled when no marks are pending', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
      const clearBtn = screen.getByText('Clear Redaction Marks').closest('button');
      expect((clearBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('Tools > Clear Redaction Marks clears marks when enabled', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      store.dispatch(addMark({ pageIndex: 0, rect: RECT }));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
      fireEvent.click(screen.getByText('Clear Redaction Marks'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((store.getState() as any).redactions.totalMarks).toBe(0);
    });

    it('Tools > Apply Redactions... is disabled with no marks and enabled with marks', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
      const applyBtnA = screen.getByText('Apply Redactions...').closest('button');
      expect((applyBtnA as HTMLButtonElement).disabled).toBe(true);

      // Add a mark, close + reopen the menu, re-check.
      store.dispatch(addMark({ pageIndex: 0, rect: RECT }));
      // Closing happens via clicking somewhere else; for the test we re-click Tools.
      fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
      fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
      const applyBtnB = screen.getByText('Apply Redactions...').closest('button');
      expect((applyBtnB as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(applyBtnB!);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((store.getState() as any).ui.redactionApplyModalOpen).toBe(true);
    });

    it('Tools > Apply Redactions... has an honest "irreversible" tooltip when enabled', () => {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      store.dispatch(addMark({ pageIndex: 0, rect: RECT }));
      render(
        <Provider store={store}>
          <MenuBar />
        </Provider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
      const applyBtn = screen.getByText('Apply Redactions...').closest('button');
      expect((applyBtn as HTMLButtonElement).title).toMatch(/irreversible|Save As/i);
    });
  });
});
