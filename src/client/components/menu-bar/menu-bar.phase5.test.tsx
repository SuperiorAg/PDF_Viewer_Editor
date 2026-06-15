// MenuBar Phase 5 wiring tests — Wave 20 Riley.
// Validates:
//   - Tools -> Run OCR opens the OCR run modal.
//   - Tools -> Scan from device is DISABLED with the Phase-5.1 tooltip.
//   - View -> Show/Hide OCR confidence overlay toggles the overlay flag.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import annotationsReducer from '../../state/slices/annotations-slice';
import documentReducer, { setDocument } from '../../state/slices/document-slice';
import formsReducer from '../../state/slices/forms-slice';
import historyReducer from '../../state/slices/history-slice';
import mailMergeReducer from '../../state/slices/mail-merge-slice';
import ocrReducer from '../../state/slices/ocr-slice';
// Phase 7.4 B1 — MenuBar reads redactions slice for Tools menu enable rules.
import redactionsReducer from '../../state/slices/redactions-slice';
import signaturesReducer from '../../state/slices/signatures-slice';
import uiReducer from '../../state/slices/ui-slice';
import viewportReducer from '../../state/slices/viewport-slice';
import { type PDFDocumentModel } from '../../types/ipc-contract';

import { MenuBar } from './index';

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'h',
  pageCount: 1,
  pages: [
    {
      pageIndex: 0,
      sourcePageRef: { kind: 'original', originalIndex: 0 },
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
      // Phase 7.4 A1 (Riley) — MenuBar now reads selectCurrentPage so it can
      // dispatch the same insertBlank applyEdit as the toolbar. The viewport
      // reducer is required even though no Phase-5 wiring test touches it
      // directly; without it the new selector throws on first render.
      viewport: viewportReducer,
      // Phase 7.4 A1 (Riley) — Fill & Sign menu entry dispatches openCaptureModal.
      signatures: signaturesReducer,
      // Phase 7.4 B1 (Riley) — Redact menu mirrors read totalMarks + showMarks.
      redactions: redactionsReducer,
    },
  });
}

describe('MenuBar — Phase 5 wiring', () => {
  it('Tools > Run OCR opens the OCR run modal', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    render(
      <Provider store={store}>
        <MenuBar />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    const runOcr = screen.getByText('Run OCR...');
    fireEvent.click(runOcr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((store.getState() as any).ocr.openModal).toBe('run');
  });

  it('Tools > Scan from device is disabled with an honest deferral tooltip (Phase 7.4 A1)', () => {
    // Was: assertion that the tooltip contained "Phase 5.1". The 5.1 promise is
    // gone (TWAIN/WIA deferred indefinitely per groomed roadmap 0a09f4c); the
    // tooltip now points users at the OS scan utility + drag-drop fallback —
    // which is what the scan-modal body has always said. See acrobat-parity-
    // audit.md §3.5 + Bucket A1 (Phase 7.4 Riley).
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    render(
      <Provider store={store}>
        <MenuBar />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    const scan = screen.getByText('Scan from device...').closest('button');
    expect(scan).not.toBeNull();
    expect((scan as HTMLButtonElement).disabled).toBe(true);
    expect((scan as HTMLButtonElement).title).toMatch(/OS scan utility/i);
    expect((scan as HTMLButtonElement).title).not.toMatch(/Phase 5\.1/i);
  });

  it('Tools > Manage language packs opens the language pack manager', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    render(
      <Provider store={store}>
        <MenuBar />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    const manage = screen.getByText('Manage language packs...');
    fireEvent.click(manage);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((store.getState() as any).ocr.openModal).toBe('language-pack-manager');
  });

  it('View > toggles OCR confidence overlay', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    render(
      <Provider store={store}>
        <MenuBar />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const showOverlay = screen.getByText('Show OCR confidence overlay');
    fireEvent.click(showOverlay);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((store.getState() as any).ocr.overlayVisible).toBe(true);
  });
});
