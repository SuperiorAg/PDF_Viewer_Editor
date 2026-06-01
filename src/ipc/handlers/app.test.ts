import { describe, expect, it, vi } from 'vitest';

import {
  handleAppGetDefaultPdfHandlerStatus,
  handleAppGetVersion,
  handleAppOpenExternal,
  handleAppQuit,
  handleAppSetDefaultPdfHandler,
  type AppDeps,
} from './app.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(over: Partial<AppDeps> = {}): AppDeps {
  return {
    getVersions: vi.fn().mockReturnValue({
      appVersion: '1.0.0',
      electronVersion: '30.0.0',
      chromiumVersion: '124',
      nodeVersion: '20.0.0',
    }),
    hasUnsavedChanges: vi.fn().mockReturnValue(false),
    requestQuit: vi.fn(),
    showInExplorer: vi.fn().mockResolvedValue(true),
    getDocumentPath: vi.fn().mockReturnValue('C:/x.pdf'),
    openDefaultAppsSettings: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

describe('app handlers', () => {
  it('getVersion: returns the four versions', () => {
    const value = expectOk(handleAppGetVersion({}, makeDeps()));
    expect(value.appVersion).toBe('1.0.0');
  });

  it('quit: returns unsaved_changes when dirty and not confirmed', () => {
    const deps = makeDeps({ hasUnsavedChanges: () => true });
    const res = handleAppQuit({ confirmUnsaved: false }, deps);
    expectErr(res, 'unsaved_changes');
    expect(deps.requestQuit).not.toHaveBeenCalled();
  });

  it('quit: calls requestQuit() when confirmed', () => {
    const deps = makeDeps({ hasUnsavedChanges: () => true });
    const res = handleAppQuit({ confirmUnsaved: true }, deps);
    expectOk(res);
    expect(deps.requestQuit).toHaveBeenCalled();
  });

  it('openExternal: handle_not_found when path unknown', async () => {
    const deps = makeDeps({ getDocumentPath: () => null });
    const res = await handleAppOpenExternal({ kind: 'show_in_explorer', handle: 1 }, deps);
    expectErr(res, 'handle_not_found');
  });

  it('openExternal: ok on success', async () => {
    const res = await handleAppOpenExternal({ kind: 'show_in_explorer', handle: 1 }, makeDeps());
    expectOk(res);
  });

  it('setDefaultPdfHandler returns ok when ms-settings opens', async () => {
    const deps = makeDeps({ openDefaultAppsSettings: vi.fn().mockResolvedValue(true) });
    const res = await handleAppSetDefaultPdfHandler({ enable: true }, deps);
    const value = expectOk(res);
    expect(value.isNowDefault).toBe(false);
    expect(value.prompt).toBe('shown');
    expect(deps.openDefaultAppsSettings).toHaveBeenCalledTimes(1);
  });

  it('setDefaultPdfHandler falls back to not_implemented when the OS UI is unavailable', async () => {
    const deps = makeDeps({ openDefaultAppsSettings: vi.fn().mockResolvedValue(false) });
    const res = await handleAppSetDefaultPdfHandler({ enable: true }, deps);
    expectErr(res, 'not_implemented');
  });

  it('getDefaultPdfHandlerStatus stub returns not_implemented', () => {
    const res = handleAppGetDefaultPdfHandlerStatus({});
    expectErr(res, 'not_implemented');
  });
});
