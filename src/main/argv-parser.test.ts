// @vitest-environment node
//
// Unit tests for src/main/argv-parser.ts.
//
// Why this test exists:
//   v0.7.12 shipped a bug where double-clicking a .pdf in Windows Explorer
//   launched PDF_Viewer_Editor.exe but the PDF did NOT open. process.argv was
//   being ignored on cold-start AND warm-start (second-instance argv was
//   discarded). The fix isolates the argv parse into this module so the parse
//   behaviour is independently provable from the Electron app lifecycle.
//
// Test surface:
//   1. Empty argv -> null.
//   2. No .pdf among args -> null.
//   3. .pdf path that doesn't exist on disk -> null.
//   4. Existing .pdf path -> returns sanitized absolute path.
//   Plus a small handful of edge cases that the regression burned on
//   (case-insensitive extension, mixed extension types, isPackaged=false
//   skip).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseShellPdfPath } from './argv-parser.js';

describe('parseShellPdfPath', () => {
  let tmpDir: string;
  let realPdf: string;
  let realPdfUpper: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'argv-parser-test-'));
    // Real on-disk file the sanitizer will accept (extension + existence).
    realPdf = join(tmpDir, 'sample.pdf');
    writeFileSync(realPdf, Buffer.from('%PDF-1.7\n'));
    // Same content, uppercase extension — sanitizer is case-insensitive too.
    realPdfUpper = join(tmpDir, 'OTHER.PDF');
    writeFileSync(realPdfUpper, Buffer.from('%PDF-1.7\n'));
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('returns null for empty argv', () => {
    expect(parseShellPdfPath([], { isPackaged: true })).toBeNull();
  });

  it('returns null when only the executable is present', () => {
    expect(
      parseShellPdfPath(['C:/path/to/PDF_Viewer_Editor.exe'], { isPackaged: true }),
    ).toBeNull();
  });

  it('returns null when no arg ends with .pdf', () => {
    expect(
      parseShellPdfPath(
        ['C:/path/to/PDF_Viewer_Editor.exe', '--remote-debugging-port=9222', '--flag'],
        { isPackaged: true },
      ),
    ).toBeNull();
  });

  it('returns null when a .pdf-shaped arg does not exist on disk', () => {
    expect(
      parseShellPdfPath(['C:/path/to/PDF_Viewer_Editor.exe', join(tmpDir, 'does-not-exist.pdf')], {
        isPackaged: true,
      }),
    ).toBeNull();
  });

  it('returns the sanitized absolute path when a valid .pdf exists', () => {
    const out = parseShellPdfPath(['C:/path/to/PDF_Viewer_Editor.exe', realPdf], {
      isPackaged: true,
    });
    expect(out).not.toBeNull();
    // Sanitizer normalizes to absolute; on Windows the slashes may flip to
    // backslashes via path.normalize. Compare via path.resolve on both sides.
    expect(out).toEqual(realPdf);
  });

  it('accepts uppercase .PDF extension (case-insensitive)', () => {
    const out = parseShellPdfPath(['C:/path/to/PDF_Viewer_Editor.exe', realPdfUpper], {
      isPackaged: true,
    });
    expect(out).toEqual(realPdfUpper);
  });

  it('skips argv[1] in dev mode (isPackaged=false)', () => {
    // In dev, argv = [node-exe, entry-script.js, ...userArgs]. If the entry
    // script happens to end with .pdf (it never does, but defense-in-depth),
    // it must NOT be picked up as a shell-handoff target.
    const out = parseShellPdfPath(['node.exe', 'src/main/index.js', realPdf], {
      isPackaged: false,
    });
    expect(out).toEqual(realPdf);
  });

  it('returns the FIRST matching .pdf when multiple are present', () => {
    const out = parseShellPdfPath(['C:/path/to/PDF_Viewer_Editor.exe', realPdf, realPdfUpper], {
      isPackaged: true,
    });
    expect(out).toEqual(realPdf);
  });
});
