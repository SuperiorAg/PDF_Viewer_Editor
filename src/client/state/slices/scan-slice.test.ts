// Scan slice unit tests — Phase 5.1 placeholder.

import { describe, expect, it } from 'vitest';

import scanReducer, {
  closeScanModal,
  openScanModal,
  resetScanState,
  setScanError,
} from './scan-slice';

describe('scan-slice', () => {
  it('initializes with the modal closed and no error', () => {
    const s = scanReducer(undefined, { type: 'scan/_init' } as never);
    expect(s.modalOpen).toBe(false);
    expect(s.lastError).toBeNull();
  });

  it('opens and closes the placeholder modal', () => {
    let s = scanReducer(undefined, openScanModal());
    expect(s.modalOpen).toBe(true);
    s = scanReducer(s, closeScanModal());
    expect(s.modalOpen).toBe(false);
  });

  it('records the last error', () => {
    const s = scanReducer(undefined, setScanError('not_implemented_phase_5_1'));
    expect(s.lastError).toBe('not_implemented_phase_5_1');
  });

  it('clears the error on open', () => {
    let s = scanReducer(undefined, setScanError('foo'));
    s = scanReducer(s, openScanModal());
    expect(s.lastError).toBeNull();
  });

  it('resets to initial state', () => {
    let s = scanReducer(undefined, openScanModal());
    s = scanReducer(s, setScanError('boom'));
    s = scanReducer(s, resetScanState());
    expect(s.modalOpen).toBe(false);
    expect(s.lastError).toBeNull();
  });
});
