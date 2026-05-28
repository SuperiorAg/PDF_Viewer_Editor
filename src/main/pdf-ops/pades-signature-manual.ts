// Phase 4 (Wave 16, David) — PAdES manual fallback engine.
//
// Contract: docs/signature-engine.md §3.5 + §3.3 (manual byte-range path).
//
// **Selected via `PADES_ENGINE=manual` env or `signatures.padesEngine`
// Setting (Phase 4.1).** Default is the node-signpdf primary engine
// (pades-signature.ts). Same external contract as the primary.
//
// **Library status at Wave 16:** node-forge + pkijs + asn1js are NOT yet
// dependencies. Diego installs them in Wave 17 packaging. Like
// `pades-signature.ts`, this module uses dynamic `import()` and returns
// `engine_not_available` when the deps are missing.
//
// The manual engine owns the full CMS envelope construction — version,
// digestAlgorithms (sha-256), encapContentInfo (eContentType id-data,
// eContent absent for detached), certificates, signerInfos with signedAttrs
// (contentType, messageDigest, signingTime, SigningCertificateV2). Built
// on top of forge.pkcs7.SignedData + pkijs ASN.1 helpers.
//
// **When this engine is useful:** if node-signpdf regresses or its license
// shifts, flip the toggle and continue. Wave 16 ships the SHAPE end-to-end;
// the actual ASN.1-building body is documented + stubbed until Wave 17.

// Type-only import — erased at compile time, so it does NOT statically depend on
// node-forge (still loaded lazily via the dynamic `import('node-forge')` below).
// Hoisted to satisfy @typescript-eslint/consistent-type-imports.
import type * as NodeForge from 'node-forge';

import { fail } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

import {
  computeByteRange,
  extractByteRangeAndContents,
  hashOverByteRange,
  type ApplyPadesError,
  type ApplyPadesInput,
  type ApplyPadesOk,
} from './pades-signature.js';

export type ApplyPadesManualResult = Result<ApplyPadesOk, ApplyPadesError>;

/**
 * Manual PAdES engine — same signature as `applyPades`. Selected by setting
 * env `PADES_ENGINE=manual` OR the runtime Setting `signatures.padesEngine`
 * to `'manual'`.
 */
export async function applyPadesManual(input: ApplyPadesInput): Promise<ApplyPadesManualResult> {
  if (!input.certPfxBytes || !input.certPassword) {
    return fail<ApplyPadesError>(
      'cert_handle_not_found',
      'manual PAdES engine requires PFX bytes + password',
    );
  }

  // Dynamic-import the deps. Same shape as pades-signature.ts.
  let forge: typeof NodeForge | null = null;
  try {
    forge = (await import(/* @vite-ignore */ 'node-forge')) as typeof NodeForge;
  } catch (e) {
    return fail<ApplyPadesError>(
      'engine_not_available',
      'node-forge not installed; PAdES manual engine unavailable until Wave 17',
      { reason: 'dynamic_import_failed', detail: (e as Error).message },
    );
  }
  if (!forge) {
    return fail<ApplyPadesError>('engine_not_available', 'forge module missing');
  }

  // The manual engine body — Wave 16 ships the SHAPE and the byte-range
  // arithmetic; Wave 17 (post-dep-install) lights up the full ASN.1 path.
  //
  // High-level steps (design §3.5):
  //   1. Author a /Contents <00...> placeholder + /ByteRange [0 0 0 0] in
  //      the bytes (we hand-edit the PDF dict by string-splice — pdf-lib
  //      doesn't expose this entry point; node-signpdf's
  //      plainAddPlaceholder does the same job for the primary engine).
  //   2. Locate the placeholder offsets in the serialized bytes.
  //   3. Compute the byte-range via the pure `computeByteRange` from the
  //      primary engine (shared correctness invariant).
  //   4. SHA-256 hash over the byte-range.
  //   5. Build the CMS SignedData via forge.pkcs7.createSignedData() with
  //      signedAttrs = { contentType, messageDigest, signingTime,
  //      SigningCertificateV2 }, signerInfo digestAlgorithm = sha-256,
  //      signatureAlgorithm matching the key (rsaWithSha256 for RSA;
  //      ecdsaWithSha256 for EC).
  //   6. Serialize the CMS to DER, hex-encode, pad to placeholderSize.
  //   7. Splice the hex into the /Contents placeholder.
  //   8. (Optional TSA) Wrap the CMS with the unsigned-attr id-aa-timeStampToken.
  //
  // Because forge isn't installed at Wave 16 we cannot complete step 5
  // here. The dynamic-import above already returned `engine_not_available`
  // on failure — execution reaching this line means the dep is present.
  // We surface a final `engine_not_available` with a structured signal
  // indicating the manual-engine body is staged for Wave 17 enablement.

  void computeByteRange;
  void extractByteRangeAndContents;
  void hashOverByteRange;

  return fail<ApplyPadesError>(
    'engine_not_available',
    'manual PAdES engine body staged for Wave 17 enablement; use signpdf default',
    { reason: 'manual_engine_staged' },
  );
}
