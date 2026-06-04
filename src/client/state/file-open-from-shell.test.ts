// Tests for subscribeFileOpenFromShell — the renderer hook that consumes
// David's main-process file:openFromShell event (v0.7.13).
//
// Assertions:
//   1. When `window.pdfApi.app.onFileOpenFromShell` is exposed, the hook
//      subscribes and dispatches `openDroppedPathThunk` with the absolutePath
//      on receive.
//   2. When the bridge is missing OR the channel is not yet exposed, the
//      hook returns a no-op unsubscribe and never dispatches.
//   3. The unsubscribe handle from the bridge is honoured on cleanup.

import { describe, expect, it, vi, afterEach } from 'vitest';

import { subscribeFileOpenFromShell } from './file-open-from-shell';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('subscribeFileOpenFromShell', () => {
  it('subscribes and dispatches openDroppedPathThunk when the bridge exposes the channel', () => {
    let captured: ((e: { absolutePath: string }) => void) | null = null;
    const unsub = vi.fn();
    const onFileOpenFromShell = vi.fn((handler: (e: { absolutePath: string }) => void) => {
      captured = handler;
      return unsub;
    });
    vi.stubGlobal('pdfApi', { app: { onFileOpenFromShell } });
    const dispatch = vi.fn();

    const teardown = subscribeFileOpenFromShell(dispatch);
    expect(onFileOpenFromShell).toHaveBeenCalledTimes(1);
    expect(captured).not.toBeNull();

    // Simulate main process emitting the event.
    captured!({ absolutePath: 'C:\\Users\\test\\report.pdf' });

    // dispatch was called with the thunk action — we cannot import the live
    // thunk and compare references in this lightweight test (would pull in
    // the entire api proxy), so we assert via the shape of the call.
    expect(dispatch).toHaveBeenCalledTimes(1);
    const arg = dispatch.mock.calls[0]?.[0];
    expect(typeof arg).toBe('function'); // RTK thunk dispatched object is a function

    // Cleanup: the unsub returned by the hook IS the unsub from the bridge.
    teardown();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('returns a no-op unsubscribe when the bridge has no onFileOpenFromShell yet (parallel race)', () => {
    // Simulates the parallel-coordination window where David's preload work
    // hasn't landed yet — pdfApi exists but the property is missing.
    vi.stubGlobal('pdfApi', { app: {} });
    const dispatch = vi.fn();

    const teardown = subscribeFileOpenFromShell(dispatch);
    // No throw, dispatch never called, teardown is callable.
    expect(dispatch).not.toHaveBeenCalled();
    expect(() => teardown()).not.toThrow();
  });

  it('returns a no-op unsubscribe when window.pdfApi is entirely absent', () => {
    // Hard absence — e.g. Vitest run without any vi.stubGlobal('pdfApi', ...).
    vi.unstubAllGlobals();
    const dispatch = vi.fn();

    const teardown = subscribeFileOpenFromShell(dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    expect(() => teardown()).not.toThrow();
  });
});
