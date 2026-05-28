// Path sanitization for any path string crossing the IPC boundary.
// Used by every fs/dialog handler before touching disk.
//
// Rules:
//   - reject empty / non-string / path-traversal segments (`..`)
//   - reject NUL byte / control chars (Windows + POSIX hazard)
//   - reject UNC paths and Win32 device namespaces (\\, //, \\?\, \\.\)
//   - reject Windows reserved DOS device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
//   - reject percent-encoded path segments (refuse to decode)
//   - reject Unicode bidi overrides / zero-width / format chars
//   - reject non-`.pdf` extension (Phase 1 only opens PDFs)
//   - return the normalized absolute path or null on rejection
//   - never throw — return null and let the caller map to a Result error
//
// See ARCHITECTURE §2.4 (FS access policy) and Playbook entry #15 (never trust
// client-supplied path-equivalent data without normalization at the trust boundary).
//
// Phase 2.5.1 hardening (David) closes the 13 attack vectors that the Wave 10
// path-sanitizer.test.ts "KNOWN GAP" block documented as currently-accepted.
// The vectors and the rule that blocks each are commented at each helper.
//
// PUBLIC CONTRACT INVARIANT: sanitizePath returns string | null. All 14
// downstream callers (IPC handlers, recents repo, replay engine) map null to
// their own Result error code at their boundary. The new fine-grained error
// codes are exposed via the optional `sanitizePathDetailed` export for
// diagnostic logging only — they intentionally do NOT widen the wire contract.

import { isAbsolute, normalize, resolve, extname, basename } from 'node:path';

// eslint-disable-next-line no-control-regex -- intentional: this regex EXISTS to detect and reject ASCII control chars (\x00-\x1f) in IPC-boundary paths. Removing the control chars would defeat the security check (vectors 1-3, NUL-injection / CR-LF path splitting).
const CONTROL_CHAR_RE = /[\x00-\x1f]/;
const ALLOWED_EXT = new Set(['.pdf']);

// Vector 9: percent-encoded path segments.
//
// `%2e%2e%2f` decodes to `../`. Defense-in-depth: refuse to decode entirely;
// any percent-encoded byte in a path crossing the IPC boundary is suspicious
// (Electron's filePaths and renderer-supplied drop paths are NEVER URL-encoded
// on the platforms we ship — Windows + macOS dialogs return raw UTF-16 / UTF-8
// strings). Refusing to decode also prevents double-decode bugs where the
// caller decodes once and the OS decodes again.
const PERCENT_ENCODED_RE = /%[0-9a-fA-F]{2}/;

// Vector 10/11: Unicode bidi-overrides + zero-width + BOM characters.
//
// U+200B  zero-width space         (vector 11)
// U+200C  zero-width non-joiner    (vector 11)
// U+200D  zero-width joiner        (vector 11)
// U+200E  LTR mark                 (bidi-format)
// U+200F  RTL mark                 (bidi-format)
// U+202A  LTR embedding            (bidi-format)
// U+202B  RTL embedding            (bidi-format)
// U+202C  pop directional fmt      (bidi-format)
// U+202D  LTR override             (bidi-format)
// U+202E  RTL override             (vector 10 — filename spoof)
// U+FEFF  byte-order mark / ZWNBSP (vector 11)
//
// These pass the \x00-\x1f control-char regex because they're far higher in
// the BMP. Block ALL of them: legitimate filenames on Windows + macOS never
// contain bidi-format chars, and dropping zero-width chars from filenames is
// the universal recommendation from Unicode TR36 §3 (Visual Spoofing).
// eslint-disable-next-line no-irregular-whitespace -- intentional: the literal zero-width / bidi-format / BOM code points (U+200B-200F, U+202A-202E, U+FEFF) inside this character class ARE the search targets (vectors 10/11, Unicode TR36 visual-spoofing). Replacing them with \u escapes is functionally equivalent but loses the at-a-glance audit of exactly which glyphs are blocked; keep the literal class and scope the disable.
const SUSPICIOUS_UNICODE_RE = /[​-‏‪-‮﻿]/;

// Vectors 4-8: Windows reserved DOS device names.
//
// CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9 are kernel-reserved on every
// Windows version since DOS. Case-insensitive. Reserved regardless of file
// extension — `CON.pdf` opens a console handle, not a file named `CON.pdf`.
// Reserved regardless of directory location (`C:/temp/CON.pdf` is the console
// too). The matcher checks the BASENAME ONLY, strips the extension, then
// lower-cases and compares to the reserved set.
const RESERVED_DOS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/**
 * Vectors 1-3: UNC paths and Win32 device namespaces.
 *
 * - `\\server\share\file.pdf`  → UNC path; resolves over SMB, may hit network
 * - `//server/share/file.pdf`  → same shape with forward slashes
 * - `\\?\C:\path\file.pdf`     → Win32 device namespace; bypasses MAX_PATH +
 *                                normal path resolution + Reserved DOS name
 *                                detection by the Win32 API
 * - `\\.\C:\path\file.pdf`     → Same as `\\?\` for our purposes; also used
 *                                for raw device access (\\.\PhysicalDrive0)
 *
 * The Phase 1 risk model assumes paths come from local OS dialogs / drag-drop
 * / pinned recents — none of which need UNC or device-namespace access. If a
 * future wave needs network-share support, add an opt-in flag to
 * SanitizeOptions; do NOT silently widen the default.
 *
 * Detection: any path whose first TWO characters are `\\`, `//`, `\/`, or
 * `/\` is rejected. Mixed-slash variants are caught the same way because
 * Windows treats both as path separators.
 */
function isUncOrNamespacedPath(p: string): boolean {
  if (p.length < 2) return false;
  const c0 = p.charCodeAt(0);
  const c1 = p.charCodeAt(1);
  // \\, //, \/, /\  — any two leading slash-like chars
  const isSlashLike = (c: number) => c === 0x5c /* \ */ || c === 0x2f; /* / */
  return isSlashLike(c0) && isSlashLike(c1);
}

/**
 * Vectors 4-8: Reserved DOS device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9).
 *
 * Walks every path segment (split on both `\` and `/`), strips the extension
 * from each segment, lower-cases, checks against the reserved set. A reserved
 * name anywhere in the path is a rejection — `C:/temp/CON.pdf` and
 * `C:/CON/temp.pdf` are both unsafe.
 *
 * NOTE: We intentionally check segments, not just the basename. Windows
 * treats any path component matching a reserved name specially (the Win32
 * subsystem rewrites it to the DOS device), so a "valid" trailing filename
 * with a reserved-name directory is still hazardous.
 */
function containsReservedDosName(p: string): boolean {
  const segments = p.split(/[\\/]/);
  for (const segment of segments) {
    if (segment.length === 0) continue;
    // Strip the extension from this segment (handles "CON.pdf" → "CON").
    const dot = segment.lastIndexOf('.');
    const stem = dot > 0 ? segment.slice(0, dot) : segment;
    // Also strip trailing spaces — Windows ignores them in DOS device name
    // resolution ("CON .pdf" still opens CON).
    const stripped = stem.trimEnd().toLowerCase();
    if (RESERVED_DOS_NAMES.has(stripped)) return true;
  }
  return false;
}

/**
 * Vector 9: percent-encoded path bytes.
 *
 * Refuse to decode; reject the entire path if any `%XX` sequence is present.
 * See PERCENT_ENCODED_RE comment above for the rationale.
 */
function containsPercentEncoded(p: string): boolean {
  return PERCENT_ENCODED_RE.test(p);
}

/**
 * Vectors 10-11: Unicode bidi-overrides + zero-width + BOM.
 *
 * See SUSPICIOUS_UNICODE_RE comment above for the full character list and
 * Unicode TR36 reference.
 */
function containsSuspiciousUnicode(p: string): boolean {
  return SUSPICIOUS_UNICODE_RE.test(p);
}

// Diagnostic error variants for `sanitizePathDetailed`. These are
// MAIN-INTERNAL — they do not cross the IPC wire. The IPC contract continues
// to expose `string | null` via `sanitizePath`; callers map null to their
// own contract error code (`path_rejected`, `invalid_pdf`, etc.). Keeping
// these internal avoids widening the wire contract for the 13 hardening
// rejections.
export type SanitizeErrorCode =
  | 'empty_or_non_string'
  | 'control_character'
  | 'unc_or_namespace_path'
  | 'percent_encoded'
  | 'suspicious_unicode'
  | 'reserved_dos_device'
  | 'path_traversal'
  | 'relative_not_allowed'
  | 'disallowed_extension'
  | 'normalize_failed';

export interface SanitizeOptions {
  /** When true, allow paths that are NOT yet absolute (callers may resolve later). */
  allowRelative?: boolean;
  /** Override the allowed extensions (lowercase, with dot). Default = .pdf */
  allowedExtensions?: ReadonlySet<string>;
}

export interface SanitizeFailure {
  ok: false;
  code: SanitizeErrorCode;
}

export interface SanitizeSuccess {
  ok: true;
  value: string;
}

export type SanitizeResult = SanitizeSuccess | SanitizeFailure;

/**
 * Detailed sanitizer that returns a discriminated Result with a specific
 * error code. Intended for diagnostic logging on the main process; not
 * exposed across the IPC boundary. See SanitizeErrorCode for variants.
 *
 * @internal
 */
export function sanitizePathDetailed(raw: unknown, opts: SanitizeOptions = {}): SanitizeResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, code: 'empty_or_non_string' };
  }

  // Vector 11/10: suspicious Unicode — checked BEFORE control-char regex
  // because U+200B-U+202E are outside the \x00-\x1f range.
  if (containsSuspiciousUnicode(raw)) {
    return { ok: false, code: 'suspicious_unicode' };
  }

  // Existing rule: reject control chars (NUL byte, TAB, CR, LF, ESC, etc.).
  if (CONTROL_CHAR_RE.test(raw)) {
    return { ok: false, code: 'control_character' };
  }

  // Vector 9: percent-encoded paths — reject before any decoding happens.
  if (containsPercentEncoded(raw)) {
    return { ok: false, code: 'percent_encoded' };
  }

  // Vectors 1-3: UNC + device-namespace prefixes.
  if (isUncOrNamespacedPath(raw)) {
    return { ok: false, code: 'unc_or_namespace_path' };
  }

  // Existing rule: reject traversal intent BEFORE normalize collapses it.
  if (/(^|[\\/])\.\.([\\/]|$)/.test(raw)) {
    return { ok: false, code: 'path_traversal' };
  }

  let normalized: string;
  try {
    normalized = normalize(raw);
  } catch {
    return { ok: false, code: 'normalize_failed' };
  }

  if (!opts.allowRelative && !isAbsolute(normalized)) {
    return { ok: false, code: 'relative_not_allowed' };
  }

  // Re-check traversal post-normalize as defense-in-depth.
  if (/(^|[\\/])\.\.([\\/]|$)/.test(normalized)) {
    return { ok: false, code: 'path_traversal' };
  }

  // Vectors 4-8: reserved DOS device names (after normalize so we catch
  // segments through any forward-slash → backslash flip path.normalize does
  // on Windows). The basename import is here to support future single-segment
  // checks if the segment-walk in containsReservedDosName ever changes.
  void basename; // keep the import documented even if unused
  if (containsReservedDosName(normalized)) {
    return { ok: false, code: 'reserved_dos_device' };
  }

  // Extension check.
  const allowed = opts.allowedExtensions ?? ALLOWED_EXT;
  const ext = extname(normalized).toLowerCase();
  if (!allowed.has(ext)) {
    return { ok: false, code: 'disallowed_extension' };
  }

  // Resolve to absolute form (no-op if already absolute).
  const value = opts.allowRelative ? normalized : resolve(normalized);
  return { ok: true, value };
}

/**
 * Public sanitizer. Returns the normalized absolute path on success, `null`
 * on any rejection. The 14 downstream callers map `null` to their own Result
 * error code (`path_rejected`, `invalid_pdf`, etc.) at the IPC boundary; this
 * thin wrapper preserves that contract while delegating the detailed
 * categorization to `sanitizePathDetailed` for internal logging.
 */
export function sanitizePath(raw: unknown, opts: SanitizeOptions = {}): string | null {
  const result = sanitizePathDetailed(raw, opts);
  return result.ok ? result.value : null;
}

/** True if the path is allowed; convenience wrapper. */
export function isSafePath(raw: unknown, opts?: SanitizeOptions): boolean {
  return sanitizePath(raw, opts) !== null;
}

/**
 * Phase 3.1 (David, B-3.1): directory-path sanitizer for mail-merge folder mode.
 *
 * Runs ALL of the security hardening checks `sanitizePath` performs (control
 * chars, traversal, UNC/device-namespace, percent-encoded, suspicious Unicode,
 * reserved DOS names) but does NOT require a `.pdf` extension. Folder outputs
 * are directory paths that typically have NO extension (`C:/Users/me/Output`)
 * — feeding them through the default `.pdf`-only sanitizer rejects every
 * folder-mode mail-merge invocation with `output_path_invalid`.
 *
 * Allowed extensions: empty string OR `.pdf` (the latter so a user who picks
 * a folder named `Backups.pdf` isn't surprised). All other extensions are
 * still rejected — a directory named `something.exe` is rejected the same as
 * a file path with that extension.
 *
 * Returns the normalized absolute directory path or `null` on rejection.
 * Never throws. Same contract shape as `sanitizePath` — callers map `null` to
 * `output_path_invalid` at the IPC boundary.
 *
 * NOTE: Like `sanitizePath`, this is a STRING-LEVEL hardening pass — it does
 * NOT stat the filesystem. The caller is responsible for verifying the
 * directory exists + is writable (the mail-merge runner does this implicitly
 * via the per-row `writeFile` call's first-row error). The Phase-3 risk model
 * assumes the user picked the folder via the OS dialog, which already gates
 * existence + write permission via the OS shell.
 */
export function sanitizeDirectoryPath(
  raw: unknown,
  opts: Omit<SanitizeOptions, 'allowedExtensions'> = {},
): string | null {
  // Re-use the detailed sanitizer with the folder-mode extension whitelist.
  // The whitelist intentionally includes BOTH '' (the common case) and '.pdf'
  // (defensive: a folder named "Documents.pdf" should pass; the typical
  // sanitizer would accept the same name for a file).
  const result = sanitizePathDetailed(raw, {
    ...opts,
    allowedExtensions: new Set(['', '.pdf']),
  });
  return result.ok ? result.value : null;
}
