// Phase 4 (Wave 16, David) — PAdES engine (primary: node-signpdf).
//
// Contract: docs/signature-engine.md §3 (esp. §3.2-§3.4) +
// docs/architecture-phase-4.md §4.3.
//
// **Library status at Wave 16:** node-signpdf is NOT yet a dependency —
// Diego installs it in Wave 17 packaging. This module uses **dynamic
// `import('node-signpdf')`** so it loads + compiles without the dep; if
// the import fails at sign-time, the engine returns `engine_not_available`
// with a clear message. The byte-range computation + audit-log integration
// + appearance composition all work end-to-end the moment the dep lands.
//
// **Byte-range arithmetic:** node-signpdf owns the byte-range placeholder
// algorithm; we delegate to it for correctness (per design §3.2 rationale).
// The `computeByteRange` + `hashOverRange` helpers below are exported for
// the manual fallback engine + tests.
//
// **Placeholder size:** 16384 hex chars (8192 bytes) default per design §3.3.
// Caller can override via `placeholderSize`.

import { createHash } from 'node:crypto';

// Type-only import — fully erased at compile time, so it does NOT introduce a
// static runtime dependency on node-signpdf (the dep is still loaded lazily via
// the dynamic `import('node-signpdf')` below). Hoisted here to satisfy
// @typescript-eslint/consistent-type-imports (no inline `typeof import(...)`).
import type * as NodeSignPdf from 'node-signpdf';

import type { SignaturePlacement } from '../../ipc/contracts.js';
import { fail, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

import type { ParsedCertEntry } from './cert-store.js';

export type ApplyPadesError =
  | 'engine_not_available'
  | 'invalid_placement'
  | 'cert_handle_not_found'
  | 'pades_sign_failed'
  | 'pades_byte_range_failed'
  | 'pades_placeholder_too_small'
  | 'serialize_failed';

export interface ApplyPadesInput {
  /** PDF bytes WITH the visual widget already composed onto the placeholder. */
  bytesWithWidget: Uint8Array;
  placement: SignaturePlacement;
  certEntry: ParsedCertEntry;
  /** PFX/P12 bytes (held in main only; never persisted). */
  certPfxBytes: Buffer | null;
  /** Password (already-decrypted but still useful to node-signpdf). */
  certPassword: Buffer | null;
  /** Default 16384 hex chars. */
  placeholderSize?: number;
  reason?: string;
  location?: string;
}

export interface ApplyPadesOk {
  signedBytes: Uint8Array;
  sigBytesOffset: number;
  sigBytesLength: number;
  byteRange: [number, number, number, number];
}

export type ApplyPadesResult = Result<ApplyPadesOk, ApplyPadesError>;

const DEFAULT_PLACEHOLDER_SIZE = 16384;

/**
 * Sign a PDF using node-signpdf (when available). When the library isn't
 * installed, returns `engine_not_available` with a clear message; the
 * caller (signature-engine.ts orchestrator) surfaces this to the renderer
 * so the user knows PAdES is unavailable until Wave 17 ships the dep.
 *
 * The visual appearance widget MUST already be drawn onto `bytesWithWidget`
 * — `applyPades` only handles the cryptographic envelope + byte-range. The
 * signature engine's top-level `applySignature({ kind: 'pades' })`
 * orchestrates: visual appearance compose → bytesWithWidget → applyPades →
 * audit-log insert.
 */
export async function applyPades(input: ApplyPadesInput): Promise<ApplyPadesResult> {
  if (!input.certPfxBytes || !input.certPassword) {
    // The orchestrator must pass the PFX bytes + password through (held in
    // memory ONLY for this call; zeroed in finally by cert-store.loadCert
    // before the orchestrator dispatches here). In Wave 16 we keep the
    // PFX+password ephemeral on the cert-store entry to feed node-signpdf;
    // future iterations may have node-signpdf consume the parsed key
    // directly without re-bundling.
    return fail<ApplyPadesError>(
      'cert_handle_not_found',
      'PAdES engine requires PFX bytes; cert entry did not carry them',
    );
  }

  // Dynamic import keeps this module compilable without the dep.
  let signpdf: (typeof NodeSignPdf)['default'] | null = null;
  let plainAddPlaceholder: typeof NodeSignPdf.plainAddPlaceholder | null = null;
  try {
    const mod = await import(
      // The string-literal indirection prevents bundlers from resolving the
      // module at compile-time when the dep isn't installed.
      /* @vite-ignore */ 'node-signpdf'
    );
    signpdf = (mod.default ?? mod) as (typeof NodeSignPdf)['default'];
    plainAddPlaceholder =
      (mod.plainAddPlaceholder as typeof NodeSignPdf.plainAddPlaceholder) ?? null;
  } catch (e) {
    return fail<ApplyPadesError>(
      'engine_not_available',
      'node-signpdf not installed; PAdES signing unavailable until Wave 17 packaging',
      { reason: 'dynamic_import_failed', detail: (e as Error).message },
    );
  }
  if (!signpdf || !plainAddPlaceholder) {
    return fail<ApplyPadesError>(
      'engine_not_available',
      'node-signpdf module did not export expected shape',
    );
  }

  const placeholderHexLen = input.placeholderSize ?? DEFAULT_PLACEHOLDER_SIZE;

  // Step 1: add a /Contents placeholder + /ByteRange [0 0 0 0] to the bytes.
  let buffered: Buffer;
  try {
    buffered = plainAddPlaceholder({
      pdfBuffer: Buffer.from(input.bytesWithWidget),
      reason: input.reason ?? 'Signed with PDF_Viewer_Editor',
      location: input.location ?? '',
      name: input.certEntry.subjectCN,
      signatureLength: Math.floor(placeholderHexLen / 2),
    });
  } catch (e) {
    return fail<ApplyPadesError>(
      'pades_sign_failed',
      `placeholder authoring failed: ${(e as Error).message}`,
    );
  }

  // Step 2: sign — node-signpdf locates the placeholder, computes the
  // byte-range, hashes, builds the CMS, and replaces the placeholder.
  //
  // H-17.1 (Phase 4.1, Julian Wave 17 review): the `passphrase` argument
  // below is a fresh JS string from `Buffer.toString('utf-8')`. It lives
  // in V8's heap until the next GC cycle — the R-W15-A residual that
  // conventions §15.6 explicitly acknowledges as the security floor we
  // accept. Do NOT capture this value in a closure that outlives this
  // single synchronous call (e.g. a retry wrapper that holds args across
  // attempts); doing so widens the residual from ~1s to indefinite.
  let signed: Buffer;
  try {
    // R-W15-A residual: passphrase string lives in V8 heap until next GC.
    signed = signpdf.sign(buffered, input.certPfxBytes, {
      passphrase: input.certPassword.toString('utf-8'),
    });
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (/placeholder.*too small|signature.*length|exceed/i.test(msg)) {
      return fail<ApplyPadesError>('pades_placeholder_too_small', msg);
    }
    if (/byte.?range|range/i.test(msg)) {
      return fail<ApplyPadesError>('pades_byte_range_failed', msg);
    }
    return fail<ApplyPadesError>('pades_sign_failed', msg);
  }

  // Step 3: extract the byte-range + content offsets from the signed bytes
  // so the audit log can record them.
  const extracted = extractByteRangeAndContents(signed);
  if (!extracted.ok) return extracted as Result<never, ApplyPadesError>;

  return ok({
    signedBytes: new Uint8Array(signed),
    sigBytesOffset: extracted.value.contentsHexStart,
    sigBytesLength: extracted.value.contentsHexLength,
    byteRange: extracted.value.byteRange,
  });
}

// ============================================================================
// Exported helpers (also used by tests + manual engine)
// ============================================================================

export function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

/**
 * Pure byte-range computation (design §3.3). Given the start offset of the
 * `<` character that opens the /Contents hex placeholder + the placeholder
 * hex length, returns the canonical PAdES `/ByteRange [start0 length0 start1 length1]`:
 *
 *   - start0 = 0
 *   - length0 = a       (bytes 0..a-1 are hashed; byte at offset a is '<')
 *   - start1 = b        (byte at offset b is the first char AFTER '>')
 *   - length1 = total-b (bytes b..end are hashed)
 *
 * Where:
 *   - a = contentsHexStart - 1  (offset of '<')
 *   - b = contentsHexStart + contentsHexLength + 1  (offset just past '>')
 *
 * The byte-range thus EXCLUDES the placeholder itself ('<...>') from the
 * hash — which is exactly the bytes that the CMS envelope replaces.
 *
 * Verifying this function against a golden fixture is the #1 round-trip
 * discipline in design §9.2 (the test suite below pins a known fixture).
 */
export function computeByteRange(
  totalLen: number,
  contentsHexStart: number,
  contentsHexLength: number,
): [number, number, number, number] {
  const a = contentsHexStart - 1;
  const b = contentsHexStart + contentsHexLength + 1;
  return [0, a, b, totalLen - b];
}

export function hashOverByteRange(
  bytes: Uint8Array,
  range: [number, number, number, number],
): Uint8Array {
  const h = createHash('sha256');
  h.update(bytes.subarray(range[0], range[0] + range[1]));
  h.update(bytes.subarray(range[2], range[2] + range[3]));
  return new Uint8Array(h.digest());
}

interface ExtractedRanges {
  contentsHexStart: number; // first hex char (just after '<')
  contentsHexLength: number;
  byteRange: [number, number, number, number];
}

/**
 * Locate /Contents <...> + /ByteRange [...] in a signed PDF. Returns the
 * offsets and the parsed byte-range numbers. Best-effort parser used post-
 * sign to populate the audit-log row; node-signpdf itself does the
 * authoritative computation during signing.
 */
export function extractByteRangeAndContents(
  bytes: Uint8Array,
): Result<ExtractedRanges, ApplyPadesError> {
  const text = Buffer.from(bytes).toString('latin1');
  const contentsIdx = text.indexOf('/Contents <');
  const byteRangeIdx = text.indexOf('/ByteRange [');
  if (contentsIdx < 0 || byteRangeIdx < 0) {
    return fail<ApplyPadesError>('pades_byte_range_failed', '/Contents or /ByteRange not found');
  }
  const hexStart = contentsIdx + '/Contents <'.length;
  const hexEnd = text.indexOf('>', hexStart);
  if (hexEnd < 0) {
    return fail<ApplyPadesError>('pades_byte_range_failed', 'unterminated /Contents');
  }
  const brStart = byteRangeIdx + '/ByteRange ['.length;
  const brEnd = text.indexOf(']', brStart);
  if (brEnd < 0) {
    return fail<ApplyPadesError>('pades_byte_range_failed', 'unterminated /ByteRange');
  }
  const nums = text
    .slice(brStart, brEnd)
    .trim()
    .split(/\s+/)
    .map((s) => Number(s));
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
    return fail<ApplyPadesError>('pades_byte_range_failed', 'invalid /ByteRange numbers');
  }
  return ok({
    contentsHexStart: hexStart,
    contentsHexLength: hexEnd - hexStart,
    byteRange: [nums[0]!, nums[1]!, nums[2]!, nums[3]!],
  });
}
