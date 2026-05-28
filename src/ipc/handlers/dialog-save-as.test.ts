import { describe, expect, it, vi } from 'vitest';

import { handleDialogSaveAs, type DialogSaveAsDeps } from './dialog-save-as.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(overrides: Partial<DialogSaveAsDeps> = {}): DialogSaveAsDeps {
  return {
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: 'C:/out/saved.pdf' }),
    sanitizePath: (raw: unknown) => (typeof raw === 'string' ? raw : null),
    issueDestinationToken: vi.fn().mockReturnValue({ token: 'tok-1', displayName: 'saved.pdf' }),
    ...overrides,
  };
}

describe('handleDialogSaveAs', () => {
  it('rejects empty suggestedName', async () => {
    const res = await handleDialogSaveAs({ suggestedName: '' }, makeDeps());
    expectErr(res, 'invalid_path');
  });

  it('rejects suggestedName containing path separators', async () => {
    const res = await handleDialogSaveAs({ suggestedName: '../evil.pdf' }, makeDeps());
    expectErr(res, 'invalid_path');
  });

  it('returns user_cancelled when dialog cancelled', async () => {
    const deps = makeDeps({
      showSaveDialog: vi.fn().mockResolvedValue({ canceled: true }),
    });
    const res = await handleDialogSaveAs({ suggestedName: 'x.pdf' }, deps);
    expectErr(res, 'user_cancelled');
  });

  it('returns invalid_path when sanitizer rejects', async () => {
    const deps = makeDeps({ sanitizePath: () => null });
    const res = await handleDialogSaveAs({ suggestedName: 'x.pdf' }, deps);
    expectErr(res, 'invalid_path');
  });

  it('returns token + displayName on success', async () => {
    const value = expectOk(await handleDialogSaveAs({ suggestedName: 'x.pdf' }, makeDeps()));
    expect(value.destinationToken).toBe('tok-1');
    expect(value.displayName).toBe('saved.pdf');
  });
});
