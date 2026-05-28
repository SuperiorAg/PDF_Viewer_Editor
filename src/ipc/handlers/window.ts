// Window control handlers — minimize, maximize/toggle, close, getState.
// Each takes a dependency surface that wraps the active BrowserWindow, so the
// handlers stay testable without Electron.

import { fail, ok } from '../../shared/result.js';
import type {
  WindowCloseError,
  WindowCloseRequest,
  WindowCloseResponse,
  WindowGetStateError,
  WindowGetStateRequest,
  WindowGetStateResponse,
  WindowGetStateValue,
  WindowMaximizeError,
  WindowMaximizeRequest,
  WindowMaximizeResponse,
  WindowMaximizeValue,
  WindowMinimizeError,
  WindowMinimizeRequest,
  WindowMinimizeResponse,
} from '../contracts.js';

export interface WindowDeps {
  /** Returns null if no window is currently focusable. */
  getWindow: () => WindowLike | null;
}

export interface WindowLike {
  minimize: () => void;
  maximize: () => void;
  unmaximize: () => void;
  close: () => void;
  isMaximized: () => boolean;
  isMinimized: () => boolean;
  isFullScreen: () => boolean;
  isFocused: () => boolean;
}

export function handleWindowMinimize(
  _req: WindowMinimizeRequest,
  deps: WindowDeps,
): WindowMinimizeResponse {
  const w = deps.getWindow();
  if (!w) return fail<WindowMinimizeError>('no_window', 'No active window');
  w.minimize();
  return ok({});
}

export function handleWindowMaximize(
  _req: WindowMaximizeRequest,
  deps: WindowDeps,
): WindowMaximizeResponse {
  const w = deps.getWindow();
  if (!w) return fail<WindowMaximizeError>('no_window', 'No active window');
  if (w.isMaximized()) {
    w.unmaximize();
  } else {
    w.maximize();
  }
  const value: WindowMaximizeValue = { isMaximized: w.isMaximized() };
  return ok(value);
}

export function handleWindowClose(_req: WindowCloseRequest, deps: WindowDeps): WindowCloseResponse {
  const w = deps.getWindow();
  if (!w) return fail<WindowCloseError>('no_window', 'No active window');
  w.close();
  return ok({});
}

export function handleWindowGetState(
  _req: WindowGetStateRequest,
  deps: WindowDeps,
): WindowGetStateResponse {
  const w = deps.getWindow();
  if (!w) return fail<WindowGetStateError>('no_window', 'No active window');
  const value: WindowGetStateValue = {
    isMinimized: w.isMinimized(),
    isMaximized: w.isMaximized(),
    isFullScreen: w.isFullScreen(),
    isFocused: w.isFocused(),
  };
  return ok(value);
}
