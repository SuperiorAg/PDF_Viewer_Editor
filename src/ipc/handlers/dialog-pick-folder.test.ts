// Unit tests for the Phase 7.5 Wave 3 dialog:pickFolder handler.

import { describe, expect, it, vi } from 'vitest';

import { handleDialogPickFolder, type DialogPickFolderDeps } from './dialog-pick-folder.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(overrides: Partial<DialogPickFolderDeps> = {}): DialogPickFolderDeps {
  return {
    showOpenDirectoryDialog: vi
      .fn()
      .mockResolvedValue({ canceled: false, filePaths: ['C:/users/test/out'] }),
    sanitizePath: (raw: unknown) => (typeof raw === 'string' ? raw : null),
    issueDirectoryToken: vi
      .fn()
      .mockImplementation((_dir: string, leaf: string) => ({ token: 'tok-1', displayName: leaf })),
    ...overrides,
  };
}

describe('handleDialogPickFolder', () => {
  it('returns user_cancelled when dialog cancelled', async () => {
    const deps = makeDeps({
      showOpenDirectoryDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    });
    const res = await handleDialogPickFolder({}, deps);
    expectErr(res, 'user_cancelled');
  });

  it('returns invalid_path when sanitizer rejects', async () => {
    const deps = makeDeps({ sanitizePath: () => null });
    const res = await handleDialogPickFolder({}, deps);
    expectErr(res, 'invalid_path');
  });

  it('returns directoryToken + displayName on success', async () => {
    const deps = makeDeps();
    const res = await handleDialogPickFolder({ title: 'Pick' }, deps);
    const value = expectOk(res);
    expect(value.directoryToken).toBe('tok-1');
    expect(value.displayName).toBe('out');
  });

  it('uses provided baseFilename as the engine hint', async () => {
    const issueDirectoryToken = vi
      .fn()
      .mockImplementation((_d: string, leaf: string, base: string) => ({
        token: 't',
        displayName: leaf,
        baseFilename: base,
      }));
    const deps = makeDeps({ issueDirectoryToken });
    await handleDialogPickFolder({ baseFilename: 'my-doc' }, deps);
    expect(issueDirectoryToken).toHaveBeenCalledWith('C:/users/test/out', 'out', 'my-doc');
  });
});
