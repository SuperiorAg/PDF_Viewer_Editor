import { describe, expect, it, vi } from 'vitest';

import { expectErr, expectOk } from './test-support.js';
import {
  handleWindowClose,
  handleWindowGetState,
  handleWindowMaximize,
  handleWindowMinimize,
  type WindowLike,
} from './window.js';

function makeWin(over: Partial<WindowLike> = {}): WindowLike {
  return {
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockReturnValue(false),
    isMinimized: vi.fn().mockReturnValue(false),
    isFullScreen: vi.fn().mockReturnValue(false),
    isFocused: vi.fn().mockReturnValue(true),
    ...over,
  };
}

describe('window handlers', () => {
  it('minimize: returns no_window without an active window', () => {
    const res = handleWindowMinimize({}, { getWindow: () => null });
    expectErr(res, 'no_window');
  });

  it('minimize: calls minimize()', () => {
    const w = makeWin();
    handleWindowMinimize({}, { getWindow: () => w });
    expect(w.minimize).toHaveBeenCalled();
  });

  it('maximize: toggles based on current state', () => {
    const wMax = makeWin({ isMaximized: vi.fn().mockReturnValue(true) });
    handleWindowMaximize({}, { getWindow: () => wMax });
    expect(wMax.unmaximize).toHaveBeenCalled();
    const wMin = makeWin();
    handleWindowMaximize({}, { getWindow: () => wMin });
    expect(wMin.maximize).toHaveBeenCalled();
  });

  it('close: invokes close()', () => {
    const w = makeWin();
    handleWindowClose({}, { getWindow: () => w });
    expect(w.close).toHaveBeenCalled();
  });

  it('getState: returns the four flags', () => {
    const w = makeWin({
      isMaximized: vi.fn().mockReturnValue(true),
      isFocused: vi.fn().mockReturnValue(false),
    });
    const value = expectOk(handleWindowGetState({}, { getWindow: () => w }));
    expect(value.isMaximized).toBe(true);
    expect(value.isFocused).toBe(false);
  });
});
