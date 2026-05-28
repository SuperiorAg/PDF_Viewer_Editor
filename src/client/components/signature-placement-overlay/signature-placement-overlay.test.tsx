// SignaturePlacementOverlay tests — Phase 4.
// Per docs/ui-spec.md §13.4.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument } from '../../state/slices/document-slice';
import signaturesReducer, {
  enterPlacement,
  setCaptured,
} from '../../state/slices/signatures-slice';
import uiReducer from '../../state/slices/ui-slice';
import { type PDFDocumentModel } from '../../types/ipc-contract';

import { SignaturePlacementOverlay } from './index';

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
      signatures: signaturesReducer,
      ui: uiReducer,
    },
    middleware: (gdm) =>
      gdm({
        serializableCheck: {
          ignoredActionPaths: [
            'payload.source.pngBytes',
            'payload.source.bytes',
            'payload.captured.source.pngBytes',
            'payload.captured.source.bytes',
          ],
          ignoredPaths: ['signatures.captured.source.pngBytes', 'signatures.captured.source.bytes'],
        },
      }),
  });
}

describe('SignaturePlacementOverlay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders nothing when placement is not active', () => {
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <SignaturePlacementOverlay />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders banner + overlay + Apply/Cancel buttons when active', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setCaptured({
        source: {
          kind: 'drawn',
          pngBytes: new Uint8Array([1, 2, 3]),
          widthPx: 100,
          heightPx: 50,
        },
        reason: '',
        showName: true,
        showDate: true,
        showReason: false,
      }),
    );
    store.dispatch(
      enterPlacement({
        flow: 'visual',
        placement: { mode: 'freeform' },
        certHandle: null,
      }),
    );

    render(
      <Provider store={store}>
        <SignaturePlacementOverlay />
      </Provider>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('application')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apply placement/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel placement/i })).toBeInTheDocument();
  });

  it('Cancel button exits placement mode', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setCaptured({
        source: {
          kind: 'drawn',
          pngBytes: new Uint8Array([1, 2, 3]),
          widthPx: 100,
          heightPx: 50,
        },
        reason: '',
        showName: true,
        showDate: true,
        showReason: false,
      }),
    );
    store.dispatch(
      enterPlacement({
        flow: 'visual',
        placement: { mode: 'freeform' },
        certHandle: null,
      }),
    );
    expect(store.getState().signatures.placement.active).toBe(true);

    render(
      <Provider store={store}>
        <SignaturePlacementOverlay />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel placement/i }));
    expect(store.getState().signatures.placement.active).toBe(false);
  });
});
