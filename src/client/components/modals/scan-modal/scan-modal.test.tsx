// ScanModal tests — Phase 5.1 placeholder.
// Validates that the placeholder renders the Phase 5.1 deferral message and
// the close button works. There is no IPC dispatch from this modal — the
// scan:* channels return Result<never, 'not_implemented_phase_5_1'>.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import scanReducer, { openScanModal, setScanError } from '../../../state/slices/scan-slice';

import { ScanModal } from './index';

function makeStore() {
  return configureStore({
    reducer: { scan: scanReducer },
  });
}

describe('ScanModal', () => {
  it('renders the Phase 5.1 deferral message', () => {
    const store = makeStore();
    store.dispatch(openScanModal());
    render(
      <Provider store={store}>
        <ScanModal />
      </Provider>,
    );
    expect(screen.getByText(/Scanner integration arrives in Phase 5.1/i)).toBeTruthy();
    expect(screen.getByText(/Windows Scan app/i)).toBeTruthy();
    expect(screen.getByText(/Windows Fax and Scan/i)).toBeTruthy();
  });

  it('closes via the Close button', () => {
    const store = makeStore();
    store.dispatch(openScanModal());
    render(
      <Provider store={store}>
        <ScanModal />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((store.getState() as any).scan.modalOpen).toBe(false);
  });

  it('surfaces a last error from a real scan:* attempt (Phase 5.1)', () => {
    const store = makeStore();
    store.dispatch(openScanModal());
    store.dispatch(setScanError('not_implemented_phase_5_1'));
    render(
      <Provider store={store}>
        <ScanModal />
      </Provider>,
    );
    expect(screen.getByText(/Last error/i)).toBeTruthy();
    expect(screen.getByText('not_implemented_phase_5_1')).toBeTruthy();
  });
});
