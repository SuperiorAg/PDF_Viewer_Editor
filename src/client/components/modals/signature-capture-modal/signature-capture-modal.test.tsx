// SignatureCaptureModal tests — Phase 4.
// Per docs/ui-spec.md §13.3.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import signaturesReducer, { openCaptureModal } from '../../../state/slices/signatures-slice';
import uiReducer from '../../../state/slices/ui-slice';

import { SignatureCaptureModal } from './index';

// Stub canvas API so the Typed-tab rasterizer can produce bytes.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = function () {
    return {
      clearRect: vi.fn(),
      fillText: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set fillStyle(_v: string) {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set font(_v: string) {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set textBaseline(_v: string) {},
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).toBlob = function (cb: (b: Blob) => void) {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    setTimeout(() => cb(new Blob([bytes], { type: 'image/png' })), 0);
  };
});

function makeStore() {
  return configureStore({
    reducer: {
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

describe('SignatureCaptureModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders three tabs and the Typed tab is active by default', () => {
    const store = makeStore();
    store.dispatch(openCaptureModal());
    render(
      <Provider store={store}>
        <SignatureCaptureModal />
      </Provider>,
    );
    // Tab labels go through i18n (modals:signatureCapture.{typed,drawn,image}Tab
    // = "Type" / "Draw" / "Image" — Backlog-Fix 28c extraction).
    expect(screen.getByRole('tab', { name: /Type/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Draw/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Image/ })).toBeInTheDocument();
  });

  it('switches to the Drawn tab on click', () => {
    const store = makeStore();
    store.dispatch(openCaptureModal());
    render(
      <Provider store={store}>
        <SignatureCaptureModal />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: /Draw/ }));
    expect(screen.getByRole('tab', { name: /Draw/ })).toHaveAttribute('aria-selected', 'true');
    // Clear button is visible in Drawn tab.
    expect(screen.getByRole('button', { name: /Clear/i })).toBeInTheDocument();
  });

  it('Place signature button is disabled until a source is captured', () => {
    const store = makeStore();
    store.dispatch(openCaptureModal());
    render(
      <Provider store={store}>
        <SignatureCaptureModal />
      </Provider>,
    );
    const placeBtn = screen.getByRole('button', { name: /Place signature/i });
    expect(placeBtn).toBeDisabled();
  });

  it('Reason input only renders when "Show reason" is checked', () => {
    const store = makeStore();
    store.dispatch(openCaptureModal());
    render(
      <Provider store={store}>
        <SignatureCaptureModal />
      </Provider>,
    );
    expect(screen.queryByPlaceholderText(/Approval for Q2 budget/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Show reason/));
    expect(screen.getByPlaceholderText(/Approval for Q2 budget/)).toBeInTheDocument();
  });

  it('Cancel button closes the modal (dispatches closeSignatureModal)', () => {
    const store = makeStore();
    store.dispatch(openCaptureModal());
    expect(store.getState().signatures.openModal).toBe('capture');
    render(
      <Provider store={store}>
        <SignatureCaptureModal />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(store.getState().signatures.openModal).toBe('none');
  });
});

// beforeAll is in scope via Vitest globals.
declare const beforeAll: (cb: () => void) => void;
