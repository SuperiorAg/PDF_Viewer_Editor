// Tests for dialog:pickPdfFiles (Wave-30 follow-up H-30.1).
//
// Uses the production sanitizer (per Wave 13.5 / 17 ratchet) so the test
// proves the rejection path actually rejects what the production deployment
// will reject.

import { describe, expect, it, vi } from 'vitest';

import { sanitizePath } from '../../main/security/path-sanitizer.js';

import { handleDialogPickPdfFiles, type DialogPickPdfFilesDeps } from './dialog-pick-pdf-files.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(overrides: Partial<DialogPickPdfFilesDeps> = {}): DialogPickPdfFilesDeps {
  return {
    showOpenDialog: vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['C:/Users/test/a.pdf'],
    }),
    sanitizePath, // production sanitizer
    ...overrides,
  };
}

describe('handleDialogPickPdfFiles', () => {
  it('returns user_cancelled when the dialog is cancelled', async () => {
    const deps = makeDeps({
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    });
    const res = await handleDialogPickPdfFiles({}, deps);
    expectErr(res, 'user_cancelled');
  });

  it('returns user_cancelled when the dialog returns no paths', async () => {
    const deps = makeDeps({
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [] }),
    });
    const res = await handleDialogPickPdfFiles({}, deps);
    expectErr(res, 'user_cancelled');
  });

  it('happy path: returns a single sanitized path for default (single-select)', async () => {
    // Cross-platform: derive the expected shape from the same production
    // sanitizer the handler uses, so this assertion stays load-bearing on
    // BOTH Windows (`C:\Users\test\a.pdf`) and Ubuntu CI
    // (`<cwd>/C:/Users/test/a.pdf`). The point of the test is the
    // production-sanitizer round-trip, not the specific Windows separator
    // shape — hardcoding `C:\Users\test\a.pdf` made the assertion fail on
    // ubuntu-latest because Linux `path.resolve` prepends the cwd to a
    // string that isn't an absolute POSIX path. Phase 7.2 Item B (Diego).
    const input = 'C:/Users/test/a.pdf';
    const expected = sanitizePath(input); // ← same fn the handler calls
    expect(expected, 'sanitizePath rejected the test input — fixture must be valid').not.toBeNull();
    const deps = makeDeps({
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: [input],
      }),
    });
    const res = await handleDialogPickPdfFiles({}, deps);
    const val = expectOk(res);
    expect(val.paths).toEqual([expected!]);
  });

  it('honors multi: true and passes multiSelections to the dialog', async () => {
    const showOpenDialog = vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['C:/Users/test/a.pdf', 'C:/Users/test/b.pdf'],
    });
    const deps = makeDeps({ showOpenDialog });
    const res = await handleDialogPickPdfFiles({ multi: true }, deps);
    const val = expectOk(res);
    expect(val.paths).toHaveLength(2);
    const callArgs = showOpenDialog.mock.calls[0]![0];
    expect(callArgs.properties).toContain('multiSelections');
  });

  it('rejects with invalid_path when ANY chosen path fails sanitization (production sanitizer wired)', async () => {
    // Path-traversal vector that the real sanitizer rejects. A permissive
    // (raw) => raw stub would accept this and the test would fail to gate.
    const deps = makeDeps({
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: ['C:/Users/test/a.pdf', 'C:/Users/../etc/passwd.pdf'],
      }),
    });
    const res = await handleDialogPickPdfFiles({ multi: true }, deps);
    expectErr(res, 'invalid_path');
  });

  it('rejects non-.pdf extensions via the production sanitizer', async () => {
    const deps = makeDeps({
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: ['C:/Users/test/a.exe'],
      }),
    });
    const res = await handleDialogPickPdfFiles({}, deps);
    expectErr(res, 'invalid_path');
  });
});
