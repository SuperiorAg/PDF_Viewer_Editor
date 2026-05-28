// Phase 4 (Wave 16, David) — In-memory cert store with strict no-persist + zero-on-finally.
//
// Contract: docs/signature-engine.md §4 + docs/conventions.md §15 + docs/architecture-phase-4.md §4.2.
//
// FIVE NON-NEGOTIABLES (conventions §15.1):
//   1. No persist — PFX bytes, password, parsed private key never touch disk.
//   2. Renderer-side hygiene — renderer clears its password state BEFORE awaiting.
//   3. Buffer-wrap at the EARLIEST synchronous point in the IPC handler.
//   4. `Buffer.fill(0)` in a `finally` block of the consuming function.
//   5. Try/finally release on EVERY exit path.
//
// THIS FILE OWNS rules 1, 4, 5. Rule 3 is the handler's job (see
// signatures-cert-load.ts); rule 2 is the renderer's job.
//
// Library injection: the PFX parser is injected via `setPfxParser` so this
// module compiles + tests without node-forge installed (Diego ships the dep
// in Wave 17 packaging; cert-store doesn't import forge directly). The
// production wiring registers a node-forge-backed parser at boot; tests
// register a synthetic parser that returns a known PEM + metadata.
//
// L-001 untouched (no BrowserWindow construction).
//
// File length justification (per conventions §3.4): the cert lifecycle is the
// single most security-sensitive code path in Phase 4 and Wave 17 Julian
// audits it end-to-end. Splitting the loadCert / releaseHandle / releaseAll /
// store flow across files would force the audit to bounce between modules
// and lose the synchronous-flow context. Single-file keeps the audit linear.

import { randomUUID, createHash } from 'node:crypto';

import { fail, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

// ============================================================================
// Types — public surface
// ============================================================================

/**
 * Opaque handle returned by `loadCert`. Treat as a string; the only operations
 * are `getEntry(handle)`, `releaseHandle(handle)`, and `releaseAll()`.
 */
export type CertHandle = string;

export type CertLoadError =
  | 'pfx_decode_failed'
  | 'pfx_no_private_key'
  | 'pfx_no_cert'
  | 'wrong_password'
  | 'parser_not_installed';

export interface CertLoadOk {
  handle: CertHandle;
  subjectCN: string;
  issuerCN: string;
  notBefore: number;
  notAfter: number;
  fingerprint: string;
  isExpired: boolean;
}

/**
 * Internal cert record. NEVER serialized over IPC. Never persisted. Lives
 * only in the per-process Map until `releaseHandle` zeroes its fields.
 *
 * The forge.pki.PrivateKey object is opaque (a struct of bignums); we hold a
 * reference here so signing operations can use it. On release we overwrite
 * the PEM string + clear the reference; V8 collects the private-key object
 * on the next GC cycle.
 *
 * **Phase 4.1 (B-17.1, David, 2026-05-26):** `pfxBytes` and `passwordBuffer`
 * are retained on the entry so the PAdES engine (node-signpdf) can call
 * `signpdf.sign(pdf, pfxBytes, { passphrase })` without re-traversing the
 * IPC contract (which never carries PFX bytes after the initial load).
 * The zero-on-finally discipline (conventions §15.1 rule 4) is preserved:
 * cert-store is now the sole holder of these buffers AND the sole zeroer,
 * via `releaseHandle`. The orchestrator at signature-engine.applyPadesPath
 * wraps every PAdES sign in `try { ... } finally { releaseHandle() }` so
 * the buffers live exactly as long as the single sign call. See
 * `docs/code-review.md §B-17.1` for the audit + remediation rationale.
 */
export interface ParsedCertEntry {
  /** Opaque private-key object from the parser (e.g. forge.pki.PrivateKey). */
  privateKey: unknown;
  /**
   * Private key in PEM format. Mutable so `releaseHandle` can overwrite it
   * with '' BEFORE deleting the map entry — narrows the V8-heap residual
   * window described in R-W15-A.
   */
  privateKeyPem: string;
  /** SHA-256 fingerprint of the DER-encoded certificate. */
  fingerprint: string;
  subjectCN: string;
  issuerCN: string;
  notBefore: number;
  notAfter: number;
  /** DER-encoded cert bytes; needed by the PAdES engine when building the CMS. */
  certDer: Uint8Array;
  /**
   * Phase 4.1 (B-17.1): retained PFX bytes for node-signpdf consumption.
   * Owned by cert-store; zeroed in `releaseHandle`. NEVER returned over IPC.
   * The PAdES engine reads this via `getEntry(handle).pfxBytes` ONLY inside
   * the orchestrator's `try { ... } finally { releaseHandle() }` envelope.
   * Set to null after `releaseHandle` is invoked.
   */
  pfxBytes: Buffer | null;
  /**
   * Phase 4.1 (B-17.1): retained password buffer for node-signpdf
   * consumption. Same lifecycle as `pfxBytes` above.
   */
  passwordBuffer: Buffer | null;
  loadedAt: number;
  /** Bookkeeping for multi-sign sessions; default 0. */
  refCount: number;
}

/**
 * Parser function injected at process boot. The default parser returns
 * `parser_not_installed`; production wires this to a node-forge-backed
 * implementation, tests wire it to a synthetic implementation that returns
 * a known shape.
 *
 * **Discipline contract:** the parser MUST NOT mutate the input buffers
 * (cert-store mutates them itself in `loadCert`'s finally). The parser
 * MUST NOT log the password or PFX bytes. The parser MUST throw a clearly-
 * identifiable error message when the password is wrong (matching one of
 * `MAC verification`, `Invalid password`, `bad password`).
 */
export interface PfxParseInput {
  /**
   * PFX/P12 DER bytes. Already a Buffer (mutable view); the parser must
   * read-only. cert-store.loadCert zeroes this buffer after the parser
   * returns OR throws.
   */
  pfxBytes: Buffer;
  /** UTF-8 password bytes. Same zeroing contract as `pfxBytes`. */
  passwordBuffer: Buffer;
}

export interface PfxParseOutput {
  /** Opaque private-key object (passed back to the PAdES engine verbatim). */
  privateKey: unknown;
  /** PEM-encoded private key for diagnostics + the manual-engine fallback. */
  privateKeyPem: string;
  /** DER-encoded cert. */
  certDer: Uint8Array;
  subjectCN: string;
  issuerCN: string;
  notBefore: number;
  notAfter: number;
}

export type PfxParser = (input: PfxParseInput) => PfxParseOutput;

/**
 * The default parser surfaces a structured error indicating the lib isn't
 * installed; Wave 17 packaging swaps this for a forge-backed parser.
 */
const DEFAULT_PARSER: PfxParser = () => {
  throw new Error('parser_not_installed: node-forge not wired (Wave 17 packaging)');
};

let activeParser: PfxParser = DEFAULT_PARSER;

/**
 * Wire a production or test parser. Production code calls this once at boot.
 * Tests may call this before each test and pass a synthetic parser.
 */
export function setPfxParser(parser: PfxParser): void {
  activeParser = parser;
}

/** Reset to the default (parser_not_installed) parser. Tests + teardown. */
export function resetPfxParser(): void {
  activeParser = DEFAULT_PARSER;
}

// ============================================================================
// In-memory store
// ============================================================================

const CERT_STORE: Map<CertHandle, ParsedCertEntry> = new Map();

/**
 * Load a PFX/P12 blob with a password into the in-memory cert store.
 *
 * **Buffer ownership semantics (Phase 4.1, B-17.1):**
 *
 * - On **failure**, both `pfxBytes` and `passwordBuffer` are zeroed in
 *   `finally` before returning. Callers MUST NOT reuse them.
 * - On **success**, ownership of both buffers TRANSFERS to the cert-store
 *   entry (`entry.pfxBytes`, `entry.passwordBuffer`). The buffers live
 *   until `releaseHandle` zeroes them. Callers MUST NOT reuse the buffers
 *   after this function returns success — the cert-store now owns them.
 *
 * This is the B-17.1 remediation (option 1 from Julian's Wave 17 audit):
 * cert-store retains the bytes so the PAdES engine can call
 * `signpdf.sign(pdf, pfxBytes, { passphrase })` without the IPC contract
 * needing to re-carry PFX bytes after the initial load. The zero-on-finally
 * discipline (conventions §15.1 rule 4) is reinterpreted: the "consuming
 * function" is now the load-AND-sign lifecycle, not the load call in
 * isolation. The single function that ALWAYS runs `fill(0)` on every exit
 * path (success, failure, exception) is now `releaseHandle`, called from
 * `signature-engine.applyPadesPath`'s `try { ... } finally` envelope.
 *
 * The returned `handle` is a fresh UUID. Pass it to `applyPades` (which
 * uses `getEntry(handle)`) and either let `applyPades` auto-release or
 * explicitly call `releaseHandle` from the IPC handler / modal cleanup.
 *
 * Lifecycle invariants (conventions §15.1, reaffirmed for Phase 4.1):
 *   - No log statement in this file contains password / pfx / cert / privateKey
 *     substrings (Wave 17 audit grep).
 *   - On failure, `pfxBytes.fill(0)` AND `passwordBuffer.fill(0)` run in
 *     `finally` BEFORE this function returns.
 *   - On success, ownership transfers; `releaseHandle` runs the same fills.
 *   - The parsed PEM string is held in the map entry; `releaseHandle`
 *     overwrites it before deletion.
 *   - No filesystem I/O is performed in this function or any helper it calls.
 */
export function loadCert(
  pfxBytes: Buffer,
  passwordBuffer: Buffer,
): Result<CertLoadOk, CertLoadError> {
  // Whether ownership transferred to the entry (success path).
  let ownershipTransferred = false;
  try {
    let parsed: PfxParseOutput;
    try {
      parsed = activeParser({ pfxBytes, passwordBuffer });
    } catch (e) {
      const msg = (e as Error).message ?? '';
      // Wrong-password signals from forge (and our test parser convention).
      if (/MAC verification failed|Invalid password|bad password|wrong[-_ ]?password/i.test(msg)) {
        return fail<CertLoadError>('wrong_password', 'PFX password is incorrect');
      }
      if (/parser_not_installed/.test(msg)) {
        return fail<CertLoadError>(
          'parser_not_installed',
          'PFX parser not installed; PAdES signing is unavailable until Wave 17 ships node-forge',
        );
      }
      if (/no[-_ ]?private[-_ ]?key/i.test(msg)) {
        return fail<CertLoadError>('pfx_no_private_key', 'PFX did not contain a private key');
      }
      if (/no[-_ ]?cert/i.test(msg)) {
        return fail<CertLoadError>('pfx_no_cert', 'PFX did not contain a certificate');
      }
      return fail<CertLoadError>(
        'pfx_decode_failed',
        // Defensive: the parser SHOULD have sanitized its error message but
        // we don't trust it; the inbound `msg` could contain part of the PFX
        // or password bytes from a poorly-written parser. Replace it with a
        // generic string and log a counter instead.
        'PFX decode failed (see structured details)',
        { reason: 'parser_threw' },
      );
    }

    if (!parsed.certDer || parsed.certDer.byteLength === 0) {
      return fail<CertLoadError>('pfx_no_cert', 'PFX parser returned empty cert');
    }
    if (!parsed.privateKeyPem || parsed.privateKeyPem.length === 0) {
      return fail<CertLoadError>('pfx_no_private_key', 'PFX parser returned empty private key');
    }

    const fingerprint = computeCertFingerprint(parsed.certDer);
    const now = Date.now();
    const isExpired = now > parsed.notAfter || now < parsed.notBefore;

    const handle = randomUUID();
    const entry: ParsedCertEntry = {
      privateKey: parsed.privateKey,
      privateKeyPem: parsed.privateKeyPem,
      fingerprint,
      subjectCN: parsed.subjectCN,
      issuerCN: parsed.issuerCN,
      notBefore: parsed.notBefore,
      notAfter: parsed.notAfter,
      certDer: parsed.certDer,
      // Phase 4.1 (B-17.1): retain the original buffers so the PAdES engine
      // can consume them without re-traversing the IPC contract. Ownership
      // transfers — releaseHandle is the sole zeroer from here on.
      pfxBytes,
      passwordBuffer,
      loadedAt: now,
      refCount: 0,
    };
    CERT_STORE.set(handle, entry);
    ownershipTransferred = true;

    return ok({
      handle,
      subjectCN: parsed.subjectCN,
      issuerCN: parsed.issuerCN,
      notBefore: parsed.notBefore,
      notAfter: parsed.notAfter,
      fingerprint,
      isExpired,
    });
  } finally {
    // Phase 4.1 (B-17.1): zero buffers on FAILURE paths only — success
    // transfers ownership to the entry, where releaseHandle zeros. This
    // preserves the "every exit path has a fill(0)" discipline, but the
    // owning function is now releaseHandle on the success path. Wave 17
    // audit grep `rg "passwordBuf|pfxBuf" | rg "fill\(0\)"` lands here AND
    // in `releaseHandle` (both sites required for the grep to pass).
    if (!ownershipTransferred) {
      pfxBytes.fill(0);
      passwordBuffer.fill(0);
    }
  }
}

/**
 * Release a cert handle. Zeroes the PEM string in the entry and deletes the
 * entry from the map. Idempotent — calling on a missing handle is a no-op
 * that returns false.
 *
 * Why we overwrite the PEM before delete: deleting the map entry drops the
 * last reachable reference, but V8's heap may retain the string until the
 * next GC cycle. Overwriting `entry.privateKeyPem = ''` narrows the residual
 * window (R-W15-A) by ensuring the string-storage no longer holds the cert.
 */
export function releaseHandle(handle: CertHandle): boolean {
  const entry = CERT_STORE.get(handle);
  if (!entry) return false;

  // Phase 4.1 (B-17.1): zero the retained PFX bytes + password buffer.
  // This is the canonical zeroer on the success-of-load path (the failure
  // path zeros inside loadCert's finally). Conventions §15.1 rule 4 is
  // satisfied by these two sites together. Wave 17 audit grep
  // `rg "passwordBuf|pfxBuf" | rg "fill\(0\)"` lands here AND in loadCert.
  if (entry.pfxBytes) {
    try {
      entry.pfxBytes.fill(0);
    } catch {
      /* Buffer may be detached if a parser misbehaved; ignore. */
    }
    entry.pfxBytes = null;
  }
  if (entry.passwordBuffer) {
    try {
      entry.passwordBuffer.fill(0);
    } catch {
      /* same */
    }
    entry.passwordBuffer = null;
  }

  // Narrow the V8-heap residual window per R-W15-A.
  entry.privateKeyPem = '';
  // The certDer Buffer is a Uint8Array view; zero it.
  try {
    entry.certDer.fill(0);
  } catch {
    /* Uint8Array may be frozen by some parser implementations; ignore. */
  }
  // Drop the private-key reference (the forge object is a struct of bignums;
  // V8 collects it on the next GC).
  entry.privateKey = null;
  entry.fingerprint = '';
  entry.subjectCN = '';
  entry.issuerCN = '';

  CERT_STORE.delete(handle);

  // Suggest GC if exposed (dev only with `--expose-gc`; production no-ops).
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc === 'function') {
    try {
      gc();
    } catch {
      /* ignore */
    }
  }
  return true;
}

/**
 * Look up an entry by handle. Returns null if missing (released or never
 * loaded). The returned object is the LIVE map entry — callers MUST NOT
 * mutate it (only `releaseHandle` mutates).
 */
export function getEntry(handle: CertHandle): ParsedCertEntry | null {
  return CERT_STORE.get(handle) ?? null;
}

/**
 * Release every cert handle. Fired on app quit + hot-reload + test
 * teardown. Returns the number of handles that were released.
 *
 * Registered on `app.before-quit` AND `process.on('exit')` in
 * src/main/index.ts (Wave 16 wiring) so no cert outlives the process.
 */
export function releaseAll(): number {
  let count = 0;
  for (const handle of Array.from(CERT_STORE.keys())) {
    if (releaseHandle(handle)) count += 1;
  }
  return count;
}

/** Test + debug accessor — returns the count of live handles. */
export function liveHandleCount(): number {
  return CERT_STORE.size;
}

// ============================================================================
// Helpers
// ============================================================================

function computeCertFingerprint(certDer: Uint8Array): string {
  return createHash('sha256').update(certDer).digest('hex');
}
