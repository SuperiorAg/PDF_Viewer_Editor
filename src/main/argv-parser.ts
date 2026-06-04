// ============================================================================
// Shell-launched PDF path parser
// ============================================================================
//
// Windows Explorer's "Open with..." / double-click invocation passes the PDF
// path as an additional argv entry to PDF_Viewer_Editor.exe. macOS instead
// fires the `open-file` event (see src/main/index.ts), and Linux desktop
// integrations follow the same argv pattern as Windows.
//
// Pre-existing main-side bug (RCA recorded 2026-06-04):
//   `app.requestSingleInstanceLock()` was acquired, but the `argv` argument of
//   the second-instance handler was DISCARDED, AND on first-launch process.argv
//   was NEVER inspected. Double-click "Open with PDF_Viewer_Editor" launched
//   the binary but the document never opened. File -> Open and drag-drop both
//   worked, masking the regression in dev.
//
// This module isolates the argv-parse logic so:
//   - It's covered by unit tests independently of Electron's app lifecycle.
//   - The same helper runs on cold-start (process.argv) and second-instance
//     handler (forwarded argv).
//   - Path sanitization runs at the trust boundary via the existing
//     `src/main/security/path-sanitizer.ts` module (Playbook #15: never trust
//     user-supplied path-equivalent data without normalization).
//
// Behavior contract:
//   - Returns the FIRST argv entry whose extension is `.pdf` (case-insensitive)
//     AND points at a file that exists on disk RIGHT NOW.
//   - Returns null on any of: empty argv, no `.pdf` arg, sanitizer rejected,
//     path does not exist, path is a directory, etc.
//   - Never throws; the caller maps null to "no shell-launched file to open."
//
// Argv skipping rules:
//   - argv[0] is the executable path (Electron binary / packaged exe). Skipped
//     unconditionally.
//   - In dev mode (app.isPackaged === false) argv[1] is typically the entry
//     script (Vite / electron-vite output). Skipped when isPackaged=false.
//   - Every remaining arg is candidate-scanned in order.
//
// Sanitization order:
//   1. path.resolve() to absolute (the sanitizer rejects relative paths by
//      default, but Explorer always passes absolute paths so this is belt+
//      braces; see src/main/security/path-sanitizer.ts isAbsoluteCrossPlatform).
//   2. sanitizePath() to gate UNC / device-namespace / control-char / reserved
//      DOS-name / suspicious-Unicode / non-.pdf paths.
//   3. existsSync() AFTER sanitization — never stat an unsanitized path.

import { existsSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { sanitizePath } from './security/path-sanitizer.js';

/**
 * Inspect `argv` for the first existing `.pdf` path the shell handed us.
 *
 * @param argv  Full argv array as received from `process.argv` (cold-start)
 *              or the `second-instance` event handler's second arg.
 * @param opts  `isPackaged` — when false (dev) argv[1] is the entry script
 *              and is skipped. When true (packaged exe) only argv[0] is
 *              skipped. Caller passes `app.isPackaged` directly.
 * @returns The normalized absolute PDF path, or `null` if no candidate exists.
 */
export function parseShellPdfPath(
  argv: readonly string[],
  opts: { isPackaged: boolean } = { isPackaged: true },
): string | null {
  if (!Array.isArray(argv) || argv.length === 0) return null;

  // argv[0] is always the executable; argv[1] is the entry script in dev.
  const startIndex = opts.isPackaged ? 1 : 2;
  if (argv.length <= startIndex) return null;

  for (let i = startIndex; i < argv.length; i++) {
    const raw = argv[i];
    if (typeof raw !== 'string' || raw.length === 0) continue;

    // Cheap reject before touching disk: must end with .pdf (case-insensitive).
    // The sanitizer also enforces this, but doing it here lets us skip ahead
    // past `--flag` / `--option=value` / per-process-instance Electron flags
    // (e.g. `--remote-debugging-port=...`) without spamming sanitizer rejects.
    if (!raw.toLowerCase().endsWith('.pdf')) continue;

    // Resolve to absolute BEFORE sanitization — Explorer always passes
    // absolute paths, but a CLI invocation might pass a relative one.
    let absolute: string;
    try {
      absolute = resolvePath(raw);
    } catch {
      continue;
    }

    const sanitized = sanitizePath(absolute);
    if (sanitized === null) continue;

    // Verify it's an existing FILE (not a directory named `Backups.pdf`).
    try {
      if (!existsSync(sanitized)) continue;
      const st = statSync(sanitized);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }

    return sanitized;
  }

  return null;
}
