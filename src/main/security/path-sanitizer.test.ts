import { describe, expect, it } from 'vitest';

import {
  isSafePath,
  sanitizeDirectoryPath,
  sanitizePath,
  sanitizePathDetailed,
} from './path-sanitizer.js';

describe('sanitizePath', () => {
  it('should reject empty / non-string inputs', () => {
    expect(sanitizePath('')).toBeNull();
    expect(sanitizePath(undefined)).toBeNull();
    expect(sanitizePath(null)).toBeNull();
    expect(sanitizePath(42)).toBeNull();
  });

  it('should reject control characters and NUL bytes', () => {
    expect(sanitizePath('C:/temp\x00.pdf')).toBeNull();
    expect(sanitizePath('C:/temp\nfile.pdf')).toBeNull();
  });

  it('should reject path-traversal segments', () => {
    expect(sanitizePath('C:/x/../y/file.pdf')).toBeNull();
    expect(sanitizePath('../file.pdf', { allowRelative: true })).toBeNull();
    expect(sanitizePath('/etc/../passwd.pdf')).toBeNull();
  });

  it('should reject non-pdf extensions', () => {
    expect(sanitizePath('C:/temp/file.txt')).toBeNull();
    expect(sanitizePath('C:/temp/file.exe')).toBeNull();
    expect(sanitizePath('C:/temp/file')).toBeNull();
  });

  it('should accept a real absolute .pdf path (case-insensitive ext)', () => {
    const out = sanitizePath('C:/Users/me/Documents/contract.pdf');
    expect(out).not.toBeNull();
    expect(out!.toLowerCase()).toContain('contract.pdf');
    expect(sanitizePath('C:/Users/me/file.PDF')).not.toBeNull();
  });

  it('should reject relative paths unless allowRelative', () => {
    expect(sanitizePath('subdir/file.pdf')).toBeNull();
    expect(sanitizePath('subdir/file.pdf', { allowRelative: true })).not.toBeNull();
  });

  it('isSafePath returns a boolean shortcut', () => {
    expect(isSafePath('C:/Users/me/file.pdf')).toBe(true);
    expect(isSafePath('../etc/passwd.pdf')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Phase 2.5 hardening — adversarial fixtures (Diego Wave 10 + David Wave 2.5.1).
  //
  // These tests came from the Phase 1 Julian MEDIUM "path-sanitizer harder
  // tests" deferral (docs/code-review.md finding B: path-sanitizer.ts row,
  // re-affirmed in the Phase 2 §I test-coverage list). The vectors below were
  // suggested by Julian. As of Phase 2.5.1, ALL of them are rejected by the
  // sanitizer source — there are no longer any KNOWN GAP cases.
  //
  // Categorization rule (read this before changing an assertion):
  //   - regression-pin blocks pin documented REJECTIONS. These are the
  //     active defense. If a future patch loosens the sanitizer and an
  //     assertion flips, that is a security regression — fail loud.
  //   - There is NO "KNOWN GAP" block anymore. The 13 Wave 10 KNOWN GAP
  //     vectors (UNC paths, Win32 device namespaces, reserved DOS names,
  //     percent-encoded traversal, U+202E bidi override, zero-width chars)
  //     are all closed in Wave 2.5.1 and pinned as regression tests below.
  //     M-1 in docs/code-review.md is CLOSED.
  //
  // Why the 13 cases were KNOWN GAP in Wave 10 and not earlier: Diego owned
  // the test file in Wave 10 but not the source file (David). The hardening
  // wave (Phase 2.5.1) is David's; the categorization comment moved with the
  // assertions.
  // ---------------------------------------------------------------------------

  describe('hardening regression-pin: traversal vectors stay rejected', () => {
    it.each([
      ['just dots', '..'],
      ['dot-dot-slash', '../'],
      ['middle traversal forward-slash', 'C:/temp/sub/../foo.pdf'],
      ['middle traversal back-slash', 'C:\\temp\\..\\foo.pdf'],
      ['mixed-slash traversal', 'C:/temp\\..\\foo.pdf'],
      ['leading traversal absolute', '/var/../etc/passwd.pdf'],
      ['nested traversal', 'C:/a/b/../../etc.pdf'],
    ])('rejects %s: %j', (_desc, input) => {
      expect(sanitizePath(input)).toBeNull();
    });
  });

  describe('hardening regression-pin: control characters', () => {
    it.each([
      ['NUL byte after valid prefix', 'C:/foo.pdf\x00.exe'],
      ['NUL byte mid-segment', 'C:/te\x00mp/file.pdf'],
      ['TAB control char', 'C:/te\tmp/file.pdf'],
      ['CR control char', 'C:/temp/file\r.pdf'],
      ['LF control char', 'C:/temp\nfile.pdf'],
      ['ESC control char', 'C:/temp/\x1bfile.pdf'],
    ])('rejects %s: %j', (_desc, input) => {
      expect(sanitizePath(input)).toBeNull();
    });

    it('pins behavior: DEL (0x7f) is NOT in the documented control range', () => {
      // The CONTROL_CHAR_RE in path-sanitizer.ts is /[\x00-\x1f]/, which stops
      // at 0x1f. DEL (0x7f) and the Unicode C1 control range (0x80-0x9f) are
      // outside that range and currently pass. Pinning so any deliberate
      // change to the regex surfaces a test diff.
      expect(sanitizePath('C:/temp/file\x7f.pdf')).not.toBeNull();
    });
  });

  describe('hardening regression-pin: extension validation', () => {
    it.each([
      ['no extension', 'C:/temp/file'],
      ['wrong extension', 'C:/temp/file.exe'],
      ['executable extension', 'C:/temp/payload.bat'],
      ['javascript extension', 'C:/temp/script.js'],
      ['double extension with non-pdf last', 'C:/temp/file.pdf.exe'],
      ['trailing dot makes extname blank', 'C:/temp/file.pdf.'],
      ['trailing space mangles extname', 'C:/temp/file.pdf '],
    ])('rejects %s: %j', (_desc, input) => {
      expect(sanitizePath(input)).toBeNull();
    });

    it('accepts case-variant pdf extensions', () => {
      expect(sanitizePath('C:/temp/file.PDF')).not.toBeNull();
      expect(sanitizePath('C:/temp/file.Pdf')).not.toBeNull();
      expect(sanitizePath('C:/temp/file.pDf')).not.toBeNull();
    });
  });

  describe('hardening regression-pin: relative-mode boundary', () => {
    it('rejects parent-ref under allowRelative', () => {
      expect(sanitizePath('../file.pdf', { allowRelative: true })).toBeNull();
      expect(sanitizePath('sub/../file.pdf', { allowRelative: true })).toBeNull();
      expect(sanitizePath('..\\file.pdf', { allowRelative: true })).toBeNull();
    });

    it('accepts plain sub-paths under allowRelative', () => {
      expect(sanitizePath('sub/file.pdf', { allowRelative: true })).not.toBeNull();
      expect(sanitizePath('a/b/c/file.pdf', { allowRelative: true })).not.toBeNull();
      expect(sanitizePath('./file.pdf', { allowRelative: true })).not.toBeNull();
    });
  });

  describe('hardening regression-pin: allowedExtensions option', () => {
    it('honors caller-supplied extension allow-list', () => {
      const allow = new Set(['.txt']);
      expect(sanitizePath('C:/temp/file.txt', { allowedExtensions: allow })).not.toBeNull();
      expect(sanitizePath('C:/temp/file.pdf', { allowedExtensions: allow })).toBeNull();
    });

    it('empty allow-list rejects everything', () => {
      const allow = new Set<string>();
      expect(sanitizePath('C:/temp/file.pdf', { allowedExtensions: allow })).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Wave 2.5.1 hardening — Phase 2.5.1 closed the 13 KNOWN GAP vectors.
  //
  // These were the 13 attack vectors that Wave 10 documented as currently
  // accepted (with .not.toBeNull() assertions). David's Wave 2.5.1 source
  // patch added 4 new helpers + 5 new SanitizeErrorCode variants to
  // path-sanitizer.ts:
  //
  //   - isUncOrNamespacedPath        → unc_or_namespace_path
  //   - containsReservedDosName      → reserved_dos_device
  //   - containsPercentEncoded       → percent_encoded
  //   - containsSuspiciousUnicode    → suspicious_unicode
  //
  // The public sanitizePath signature is UNCHANGED (still string | null);
  // the new error codes are exposed via sanitizePathDetailed for diagnostic
  // logging only. The IPC wire contract is unchanged — all 14 downstream
  // callers continue to map null → their own contract error code.
  //
  // If any assertion below flips back to .not.toBeNull(), the sanitizer was
  // loosened — fail LOUD and audit the diff.
  // ---------------------------------------------------------------------------
  describe('hardening regression-pin: UNC paths and Win32 device namespaces (vectors 1-3)', () => {
    it('rejects UNC backslash path', () => {
      expect(sanitizePath('\\\\server\\share\\file.pdf')).toBeNull();
    });

    it('rejects UNC forward-slash path', () => {
      expect(sanitizePath('//server/share/file.pdf')).toBeNull();
    });

    it('rejects Win32 device-namespace \\\\?\\', () => {
      expect(sanitizePath('\\\\?\\C:\\file.pdf')).toBeNull();
    });

    it('rejects Win32 device-namespace \\\\.\\', () => {
      expect(sanitizePath('\\\\.\\C:\\file.pdf')).toBeNull();
    });

    it('reports the unc_or_namespace_path error code via the detailed API', () => {
      const result = sanitizePathDetailed('\\\\server\\share\\file.pdf');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('unc_or_namespace_path');
    });
  });

  describe('hardening regression-pin: Windows reserved DOS device names (vectors 4-8)', () => {
    it.each([
      ['CON.pdf', 'C:/temp/CON.pdf'],
      ['PRN.pdf', 'C:/temp/PRN.pdf'],
      ['AUX.pdf', 'C:/temp/AUX.pdf'],
      ['NUL.pdf', 'C:/temp/NUL.pdf'],
      ['COM1.pdf', 'C:/temp/COM1.pdf'],
      ['COM9.pdf', 'C:/temp/COM9.pdf'],
      ['LPT1.pdf', 'C:/temp/LPT1.pdf'],
      ['LPT9.pdf', 'C:/temp/LPT9.pdf'],
      ['lowercase aux.pdf', 'C:/temp/aux.pdf'],
      ['mixed-case Con.pdf', 'C:/temp/Con.pdf'],
      ['reserved name as directory', 'C:/AUX/file.pdf'],
    ])('rejects Windows reserved device name %s', (_desc, input) => {
      expect(sanitizePath(input)).toBeNull();
    });

    it('reports the reserved_dos_device error code via the detailed API', () => {
      const result = sanitizePathDetailed('C:/temp/CON.pdf');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('reserved_dos_device');
    });

    it('does NOT false-positive on names that merely contain reserved substrings', () => {
      // "concord.pdf" contains "con" but is NOT the reserved name.
      expect(sanitizePath('C:/temp/concord.pdf')).not.toBeNull();
      // "communication.pdf" contains "com" but is NOT reserved (COM with no
      // digit is fine; COM1-COM9 are reserved).
      expect(sanitizePath('C:/temp/communication.pdf')).not.toBeNull();
      // "lpt.pdf" — LPT with no digit is fine; LPT1-LPT9 are reserved.
      expect(sanitizePath('C:/temp/lpt.pdf')).not.toBeNull();
    });
  });

  describe('hardening regression-pin: percent-encoded traversal (vector 9)', () => {
    it('rejects lowercase percent-encoded `..`', () => {
      expect(sanitizePath('C:/x/%2e%2e/y.pdf')).toBeNull();
    });

    it('rejects uppercase percent-encoded `..`', () => {
      expect(sanitizePath('C:/x/%2E%2E/y.pdf')).toBeNull();
    });

    it('rejects ANY percent-encoded byte (defense in depth)', () => {
      // Even an innocuous %20 (space) is rejected — local OS dialogs don't
      // URL-encode and refusing to decode prevents double-decode bugs.
      expect(sanitizePath('C:/temp/file%20name.pdf')).toBeNull();
    });

    it('reports the percent_encoded error code via the detailed API', () => {
      const result = sanitizePathDetailed('C:/x/%2e%2e/y.pdf');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('percent_encoded');
    });
  });

  describe('hardening regression-pin: Unicode bidi/zero-width (vectors 10-11)', () => {
    it('rejects right-to-left override (U+202E)', () => {
      expect(sanitizePath('C:/temp/file‮.pdf')).toBeNull();
    });

    it('rejects left-to-right override (U+202D)', () => {
      expect(sanitizePath('C:/temp/file‭.pdf')).toBeNull();
    });

    it('rejects RTL/LTR marks (U+200E, U+200F)', () => {
      expect(sanitizePath('C:/temp/file‎.pdf')).toBeNull();
      expect(sanitizePath('C:/temp/file‏.pdf')).toBeNull();
    });

    it('rejects directional embeddings (U+202A-U+202C)', () => {
      expect(sanitizePath('C:/temp/file‪.pdf')).toBeNull();
      expect(sanitizePath('C:/temp/file‫.pdf')).toBeNull();
      expect(sanitizePath('C:/temp/file‬.pdf')).toBeNull();
    });

    it('rejects zero-width space (U+200B)', () => {
      expect(sanitizePath('C:/temp/file​.pdf')).toBeNull();
    });

    it('rejects zero-width non-joiner (U+200C)', () => {
      expect(sanitizePath('C:/temp/file‌.pdf')).toBeNull();
    });

    it('rejects zero-width joiner (U+200D)', () => {
      expect(sanitizePath('C:/temp/file‍.pdf')).toBeNull();
    });

    it('rejects byte-order mark / ZWNBSP (U+FEFF)', () => {
      expect(sanitizePath('C:/temp/file﻿.pdf')).toBeNull();
    });

    it('reports the suspicious_unicode error code via the detailed API', () => {
      const result = sanitizePathDetailed('C:/temp/file‮.pdf');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('suspicious_unicode');
    });
  });

  // ---------------------------------------------------------------------------
  // Wave 2.5.1 positive tests — legitimate paths still pass.
  //
  // The hardening rules are first-match rejections; we must not regress on
  // legitimate-path acceptance. These 3 cases guard the most common shapes:
  // a Windows user-profile path, a relative sub-path under allowRelative, and
  // a path containing spaces + non-ASCII characters that are NOT control or
  // bidi characters.
  // ---------------------------------------------------------------------------
  describe('Wave 2.5.1 positive tests: legitimate paths still pass', () => {
    it('accepts a typical Windows user-profile path', () => {
      const out = sanitizePath('C:\\Users\\ahudson\\Documents\\report.pdf');
      expect(out).not.toBeNull();
      expect(out!.toLowerCase()).toContain('report.pdf');
    });

    it('accepts a relative sub-path under allowRelative (no traversal)', () => {
      expect(sanitizePath('docs/subdir/quarterly.pdf', { allowRelative: true })).not.toBeNull();
    });

    it('accepts spaces and non-ASCII letters that are NOT control/bidi', () => {
      // Accented characters (U+00E9 é, U+00FC ü), CJK ideograph (U+4E2D 中),
      // and a regular space — all legitimate filename characters that must
      // NOT be confused with the suspicious-Unicode bidi/zero-width range.
      const out = sanitizePath('C:/Users/me/Documents/résumé für 中文.pdf');
      expect(out).not.toBeNull();
      expect(out!).toContain('résumé');
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 3.1 (B-3.1, David, Wave 13.5) — sanitizeDirectoryPath
//
// Folder-mode mail-merge needs a sanitizer that accepts directory paths
// (typically no extension) while still running every hardening check the
// `.pdf`-only sanitizer enforces.
// ---------------------------------------------------------------------------
describe('sanitizeDirectoryPath', () => {
  it('accepts an absolute directory path with NO extension', () => {
    expect(sanitizeDirectoryPath('C:/Users/me/Output')).not.toBeNull();
    expect(sanitizeDirectoryPath('/tmp/mail-merge-output')).not.toBeNull();
  });

  it('accepts a directory path with a .pdf-shaped name (defensive)', () => {
    // A user might name a folder "Backups.pdf" — we accept the `.pdf` arm of
    // the whitelist so that case isn't surprising.
    expect(sanitizeDirectoryPath('C:/Users/me/Backups.pdf')).not.toBeNull();
  });

  it('rejects directory paths with non-empty, non-.pdf extensions', () => {
    // Mirror the file sanitizer's extension policy at the "weird names"
    // boundary: a folder named "something.exe" is suspicious.
    expect(sanitizeDirectoryPath('C:/Users/me/output.exe')).toBeNull();
    expect(sanitizeDirectoryPath('C:/Users/me/output.txt')).toBeNull();
  });

  it('still rejects path-traversal in directory mode', () => {
    expect(sanitizeDirectoryPath('C:/Users/me/../etc')).toBeNull();
    expect(sanitizeDirectoryPath('/tmp/../var')).toBeNull();
  });

  it('still rejects UNC paths in directory mode', () => {
    expect(sanitizeDirectoryPath('\\\\server\\share')).toBeNull();
    expect(sanitizeDirectoryPath('//server/share')).toBeNull();
  });

  it('still rejects reserved DOS device names in directory mode', () => {
    expect(sanitizeDirectoryPath('C:/temp/CON')).toBeNull();
    expect(sanitizeDirectoryPath('C:/temp/AUX/sub')).toBeNull();
  });

  it('still rejects percent-encoded bytes in directory mode', () => {
    expect(sanitizeDirectoryPath('C:/temp/%2e%2e/etc')).toBeNull();
  });

  it('still rejects control characters in directory mode', () => {
    expect(sanitizeDirectoryPath('C:/temp/\x00folder')).toBeNull();
    expect(sanitizeDirectoryPath('C:/temp/\nfolder')).toBeNull();
  });

  it('still rejects suspicious Unicode (bidi / zero-width) in directory mode', () => {
    // U+202E RTL override
    expect(sanitizeDirectoryPath('C:/temp/exec‮gnp.exe')).toBeNull();
    // U+200B zero-width space
    expect(sanitizeDirectoryPath('C:/temp​/folder')).toBeNull();
  });

  it('rejects empty / non-string inputs', () => {
    expect(sanitizeDirectoryPath('')).toBeNull();
    expect(sanitizeDirectoryPath(undefined)).toBeNull();
    expect(sanitizeDirectoryPath(null)).toBeNull();
  });

  it('rejects relative paths unless allowRelative is set', () => {
    expect(sanitizeDirectoryPath('subdir/output')).toBeNull();
    expect(sanitizeDirectoryPath('subdir/output', { allowRelative: true })).not.toBeNull();
  });
});
