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
import uiReducer from '../../state/slices/ui-slice';
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

  it('Tools > Scan from device is disabled with Phase 5.1 tooltip', () => {
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
    expect((scan as HTMLButtonElement).title).toContain('Phase 5.1');
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
