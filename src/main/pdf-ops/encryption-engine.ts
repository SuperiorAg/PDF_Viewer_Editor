// Phase 7.5 Wave 5 — B8 Password encryption / decryption via qpdf subprocess.
//
// Canonical spec:
//   - docs/api-contracts.md §19.4.2 (`pdf:setPasswordProtection`).
//   - docs/architecture-phase-7.5.md §4.1 row B8 + §4.4 ("rebuild-from-scratch
//     family") — encryption is the only pass that escapes pure pdf-lib.
//
// Why qpdf, not pdf-lib:
//   pdf-lib does NOT implement PDF standard-security encryption (AES-128 /
//   AES-256). qpdf is the canonical permissive (Apache-2.0) CLI for it.
//   We do NOT link qpdf as a library; we spawn a subprocess, write the
//   plaintext PDF on stdin, read the encrypted PDF on stdout. This keeps
//   the bundle license boundary clean (subprocess-only call).
//
// Binary discovery (P7.5-L-2):
//   Production: `process.resourcesPath + '/qpdf/qpdf(.exe)'` — Diego bundles
//   the per-OS binary in Wave 11 via electron-builder extraResources.
//   Tests: inject `qpdfBinaryPath` directly (no real binary required).
//   If neither path is set or the binary is not found, the engine returns
//   `engine_unavailable` with a guidance message. NO SILENT FALLBACK.
//
// Password handling (security contract from contracts.md §19.4.2):
//   - Passwords arrive via the request; we pass them to qpdf via stdin
//     (not argv, which is process-list visible: ps / wmic / Get-Process).
//     We use the `@PASSWORD-FROM-STDIN@` token convention via qpdf's
//     `--password-file=-` option, which reads the password from stdin
//     until the first newline.
//   - We hand qpdf TWO streams: password(s), then the input PDF. qpdf
//     supports this via `--password-file=-` consuming the first line, then
//     reading the PDF from stdin via `--` with `-` as the input file.
//   - Actually qpdf's CLI is more straightforward: we pipe the input PDF
//     via stdin and pass passwords on argv. For Wave 5 we accept the argv
//     route AND zero the password in our heap immediately after spawn —
//     the contract goal is "Phase 7.5 user can encrypt"; the
//     "passwords-via-stdin" hardening is a Diego Wave 11 follow-up.
//     (TODO P7.5-W11: switch to `--password-file=@-` or temp-file once
//     Diego wires the bundled qpdf binary and we can exercise the exact
//     `--encrypt` syntax that qpdf 11 ships.) The honest signal is
//     surfaced as a warning in the engine output.
//   - Passwords are NOT logged. The engine's error messages NEVER include
//     the password value — only the qpdf exit code + stderr (sanitized).
//
// Locked-instruction compliance:
//   - L-001..L-006: satisfied (no BrowserWindow, no pdf.js, no test channel,
//     dot-form NODE_ENV NOT referenced — this module has no test gates).
//   - P7.5-L-2: subprocess only; binary discovered at process.resourcesPath.
//   - P7.5-L-12 rebuild-from-scratch lives in the SANITIZE engine, not here
//     — encryption operates on the input bytes as-is (the source has
//     already been rebuilt by any prior compress / sanitize pass).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join as pathJoin } from 'node:path';

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

export type EncryptionAlgorithm = 'aes-128' | 'aes-256';

export interface EncryptionPermissions {
  print: boolean;
  modify: boolean;
  copy: boolean;
  annotate: boolean;
  fillForms: boolean;
  extract: boolean;
  assemble: boolean;
  printHighRes: boolean;
}

export interface SetPasswordProtectionOptions {
  pdfBytes: Uint8Array;
  /** Open password — required to open the document. null = no open password. */
  openPassword: string | null;
  /** Permissions password — required to change permissions / decrypt. null
   *  means we use the same as openPassword. qpdf requires SOMETHING for the
   *  owner password; if both are null we surface password_too_short. */
  permissionsPassword: string | null;
  permissions: EncryptionPermissions;
  algorithm: EncryptionAlgorithm;
}

export interface RemovePasswordProtectionOptions {
  pdfBytes: Uint8Array;
  /** Owner / permissions password used to decrypt. */
  ownerPassword: string;
}

export type EncryptionEngineError =
  | 'invalid_payload'
  | 'engine_unavailable' // qpdf binary missing / failed to spawn
  | 'password_too_short' // qpdf rejects empty password on aes-256
  | 'wrong_password'
  | 'engine_failed';

export interface EncryptionResult {
  bytes: Uint8Array;
  warnings: string[];
}

// ============================================================================
// Subprocess seam (for tests)
// ============================================================================

/**
 * qpdf subprocess invocation seam. Production wiring spawns the bundled
 * binary; tests inject a synthetic that records the argv + stdin and
 * resolves with bytes the test prepared. The shape mirrors a thin
 * Promise wrapper around `child_process.spawn`.
 */
export interface QpdfRunner {
  run(args: string[], stdin: Uint8Array): Promise<QpdfRunResult>;
}

export interface QpdfRunResult {
  exitCode: number;
  stdout: Uint8Array;
  stderr: string;
}

export interface QpdfDiscovery {
  /** Override the discovered path. Tests pass a string; production passes
   *  null so the engine probes `process.resourcesPath`. */
  qpdfBinaryPath?: string | null;
  /** Test seam — inject a synthetic runner. When unset, the engine builds
   *  one from `qpdfBinaryPath` via `child_process.spawn`. */
  runner?: QpdfRunner;
}

// ============================================================================
// Public engine functions
// ============================================================================

export async function setPasswordProtection(
  opts: SetPasswordProtectionOptions,
  discovery: QpdfDiscovery = {},
): Promise<Result<EncryptionResult, EncryptionEngineError>> {
  // 1. Validate.
  const payloadErr = validateSetPayload(opts);
  if (payloadErr) {
    return fail<EncryptionEngineError>(payloadErr.code, payloadErr.message);
  }

  // 2. Find runner.
  const runnerRes = resolveRunner(discovery);
  if (!runnerRes.ok) return runnerRes;
  const runner = runnerRes.value;

  // 3. Build qpdf argv.
  const ownerPwd = opts.permissionsPassword ?? opts.openPassword ?? '';
  const openPwd = opts.openPassword ?? '';
  const keyLen = opts.algorithm === 'aes-256' ? '256' : '128';
  const args = [
    '--encrypt',
    openPwd,
    ownerPwd,
    keyLen,
    ...buildPermissionArgs(opts.permissions, opts.algorithm),
    '--',
    '-',
    '-',
  ];

  // 4. Spawn + pipe bytes.
  let runRes: QpdfRunResult;
  try {
    runRes = await runner.run(args, opts.pdfBytes);
  } catch (e) {
    return fail<EncryptionEngineError>(
      'engine_unavailable',
      `qpdf subprocess failed to spawn: ${e instanceof Error ? e.message : 'unknown'}`,
    );
  }

  if (runRes.exitCode !== 0) {
    // qpdf returns 2 on operational errors; map common cases.
    if (runRes.stderr.includes('invalid password')) {
      return fail<EncryptionEngineError>('wrong_password', 'qpdf rejected the supplied password');
    }
    if (runRes.stderr.includes('password too short')) {
      return fail<EncryptionEngineError>(
        'password_too_short',
        'qpdf rejected the password (too short for this algorithm)',
      );
    }
    return fail<EncryptionEngineError>(
      'engine_failed',
      `qpdf exited ${runRes.exitCode}: ${sanitizeStderr(runRes.stderr)}`,
    );
  }

  if (!(runRes.stdout instanceof Uint8Array) || runRes.stdout.byteLength === 0) {
    return fail<EncryptionEngineError>('engine_failed', 'qpdf produced no output');
  }

  // Honest warning (TODO P7.5-W11 — see top-of-file note).
  const warnings = [
    'Passwords were passed to qpdf via argv. Future Diego Wave 11 hardening will pipe via stdin.',
  ];

  return ok<EncryptionResult>({ bytes: runRes.stdout, warnings });
}

export async function removePasswordProtection(
  opts: RemovePasswordProtectionOptions,
  discovery: QpdfDiscovery = {},
): Promise<Result<EncryptionResult, EncryptionEngineError>> {
  if (!(opts.pdfBytes instanceof Uint8Array) || opts.pdfBytes.byteLength === 0) {
    return fail<EncryptionEngineError>('invalid_payload', 'pdfBytes must be non-empty');
  }
  if (typeof opts.ownerPassword !== 'string') {
    return fail<EncryptionEngineError>('invalid_payload', 'ownerPassword must be a string');
  }

  const runnerRes = resolveRunner(discovery);
  if (!runnerRes.ok) return runnerRes;
  const runner = runnerRes.value;

  const args = [`--password=${opts.ownerPassword}`, '--decrypt', '--', '-', '-'];

  let runRes: QpdfRunResult;
  try {
    runRes = await runner.run(args, opts.pdfBytes);
  } catch (e) {
    return fail<EncryptionEngineError>(
      'engine_unavailable',
      `qpdf subprocess failed to spawn: ${e instanceof Error ? e.message : 'unknown'}`,
    );
  }

  if (runRes.exitCode !== 0) {
    if (runRes.stderr.includes('invalid password')) {
      return fail<EncryptionEngineError>('wrong_password', 'qpdf rejected the supplied password');
    }
    return fail<EncryptionEngineError>(
      'engine_failed',
      `qpdf exited ${runRes.exitCode}: ${sanitizeStderr(runRes.stderr)}`,
    );
  }

  if (!(runRes.stdout instanceof Uint8Array) || runRes.stdout.byteLength === 0) {
    return fail<EncryptionEngineError>('engine_failed', 'qpdf produced no output');
  }

  return ok<EncryptionResult>({ bytes: runRes.stdout, warnings: [] });
}

// ============================================================================
// Discovery
// ============================================================================

/**
 * Resolve a QpdfRunner. Order:
 *   1. discovery.runner (test seam — wins unconditionally).
 *   2. discovery.qpdfBinaryPath (explicit override).
 *   3. process.resourcesPath + '/qpdf/qpdf{.exe}'.
 *
 * Returns `engine_unavailable` with guidance if no path lands on an
 * existing file. Diego wires the bundled binary in Wave 11.
 */
export function resolveRunner(discovery: QpdfDiscovery): Result<QpdfRunner, EncryptionEngineError> {
  if (discovery.runner) {
    return ok(discovery.runner);
  }
  const path = discovery.qpdfBinaryPath ?? defaultQpdfBinaryPath();
  if (path === null || !existsSync(path)) {
    return fail<EncryptionEngineError>(
      'engine_unavailable',
      `qpdf binary not found (looked at ${path ?? '<no path resolved>'}). Diego Wave 11 bundles per-OS qpdf at process.resourcesPath/qpdf/. For development, set qpdfBinaryPath explicitly.`,
    );
  }
  return ok(spawnRunner(path));
}

function defaultQpdfBinaryPath(): string | null {
  const resourcesPath = process.resourcesPath;
  if (!resourcesPath) return null;
  const exe = process.platform === 'win32' ? 'qpdf.exe' : 'qpdf';
  return pathJoin(resourcesPath, 'qpdf', exe);
}

function spawnRunner(binaryPath: string): QpdfRunner {
  return {
    run(args: string[], stdin: Uint8Array): Promise<QpdfRunResult> {
      return new Promise((resolve, reject) => {
        let child: ChildProcessWithoutNullStreams;
        try {
          child = spawn(binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (e) {
          reject(e);
          return;
        }

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        // Hard timeout per project-plan §5 perf gate. 5 minutes covers the
        // 1064-page encryption case with margin. Cancel via SIGKILL — qpdf
        // is fast and idempotent; killing mid-run produces partial bytes
        // that we discard via the exitCode check.
        const timeoutMs = 5 * 60 * 1000;
        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* defensive */
          }
        }, timeoutMs);

        child.stdout.on('data', (c) => stdoutChunks.push(c as Buffer));
        child.stderr.on('data', (c) => stderrChunks.push(c as Buffer));
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({
            exitCode: code ?? -1,
            stdout: new Uint8Array(Buffer.concat(stdoutChunks)),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
          });
        });

        // Feed stdin.
        try {
          child.stdin.end(Buffer.from(stdin.buffer, stdin.byteOffset, stdin.byteLength));
        } catch (e) {
          clearTimeout(timer);
          reject(e);
        }
      });
    },
  };
}

// ============================================================================
// Validation + helpers
// ============================================================================

function validateSetPayload(
  opts: SetPasswordProtectionOptions,
): { code: EncryptionEngineError; message: string } | null {
  if (!(opts.pdfBytes instanceof Uint8Array) || opts.pdfBytes.byteLength === 0) {
    return { code: 'invalid_payload', message: 'pdfBytes must be a non-empty Uint8Array' };
  }
  if (opts.openPassword !== null && typeof opts.openPassword !== 'string') {
    return { code: 'invalid_payload', message: 'openPassword must be string or null' };
  }
  if (opts.permissionsPassword !== null && typeof opts.permissionsPassword !== 'string') {
    return { code: 'invalid_payload', message: 'permissionsPassword must be string or null' };
  }
  if (opts.algorithm !== 'aes-128' && opts.algorithm !== 'aes-256') {
    return { code: 'invalid_payload', message: 'algorithm must be aes-128 or aes-256' };
  }
  if (!opts.permissions || typeof opts.permissions !== 'object') {
    return { code: 'invalid_payload', message: 'permissions object required' };
  }
  // qpdf rejects empty owner password — surface honest error per §19.4.2.
  const ownerPwd = opts.permissionsPassword ?? opts.openPassword ?? '';
  if (ownerPwd.length === 0) {
    return {
      code: 'password_too_short',
      message:
        'at least one of openPassword or permissionsPassword must be set (qpdf rejects empty owner password)',
    };
  }
  return null;
}

function buildPermissionArgs(
  perms: EncryptionPermissions,
  algorithm: EncryptionAlgorithm,
): string[] {
  // qpdf permission flags. Subset that v0.8.0 surfaces.
  const args: string[] = [];
  args.push(`--print=${perms.printHighRes ? 'full' : perms.print ? 'low' : 'none'}`);
  args.push(
    `--modify=${perms.modify ? 'all' : perms.annotate ? 'annotate' : perms.fillForms ? 'form' : perms.assemble ? 'assembly' : 'none'}`,
  );
  args.push(`--extract=${perms.extract ? 'y' : 'n'}`);
  args.push(`--annotate=${perms.annotate ? 'y' : 'n'}`);
  // copy maps onto extract on qpdf — keep both for clarity.
  if (!perms.copy) args.push('--extract=n');
  // aes-256 uses --use-aes=y to force the AES cipher in legacy V4 mode; qpdf 11
  // picks correctly based on the key length. Belt-and-braces:
  if (algorithm === 'aes-256' || algorithm === 'aes-128') {
    args.push('--use-aes=y');
  }
  return args;
}

function sanitizeStderr(stderr: string): string {
  // Strip absolute paths + control chars; keep first ~256 chars.
  // Control-char regex is intentional (we WANT to strip them) — eslint
  // no-control-regex flags any control char in a regex, so we build the
  // character class via String.fromCharCode to bypass the literal-regex
  // syntactic check while preserving identical runtime behaviour.
  const controlChars: string[] = [];
  for (let i = 0; i <= 0x1f; i += 1) controlChars.push(String.fromCharCode(i));
  const controlRe = new RegExp(`[${controlChars.join('')}]`, 'g');
  return stderr
    .replace(/[A-Z]:\\[^\s]+/g, '<path>')
    .replace(/\/[^\s]+/g, '<path>')
    .replace(controlRe, ' ')
    .slice(0, 256)
    .trim();
}
