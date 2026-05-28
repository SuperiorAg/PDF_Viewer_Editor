# Signature Engine — Phase 4 Detailed Design

**Author:** Riley (front-end-architect)
**Date:** 2026-05-26 (Wave 15)
**Status:** Design doc. David + Ravi + Riley implement in Wave 16 under `src/main/pdf-ops/signature-engine.ts`, `pades-signature.ts`, `pades-signature-manual.ts`, `tsa-client.ts`, `visual-signature.ts`, `signature-appearance.ts`, `cert-store.ts`.
**Reads:** `ARCHITECTURE.md` §1-§7; `docs/architecture-phase-2.md` §3; `docs/architecture-phase-3.md` §5+§8; `docs/architecture-phase-4.md` (full); `docs/edit-replay-engine.md`; `docs/form-engine.md`; `docs/api-contracts.md` Phase-4 amendment §14; `docs/data-models.md` Phase-4 amendment §9; `docs/conventions.md` Phase-4 amendment §15.

> **>200-line file justification:** the cert + password lifecycle (§4), the byte-range arithmetic (§3.3), and the appearance composition (§5) each warrant a deep walkthrough. Splitting risks losing the synchronous-flow context that makes the security discipline reviewable. Wave 17 Julian audits this file end-to-end; staying single-file lets the audit be a single linear pass.

---

## 1. Goal

> Given an open PDF (kept as `Uint8Array` in main per `DocumentStore`), provide three signing paths — **visual** (appearance only), **PAdES** (cryptographic CMS, primary engine `node-signpdf`), **PAdES manual fallback** (`node-forge`+`pkijs`) — that share the same external contract and the same cert + password discipline. Plus an RFC 3161 TSA client and an appearance-stream authorship module shared by all three paths. Plus a strict cert store with memory-only persistence and explicit zeroing.

The engine is Phase 4's counterpart to the Phase 2 replay engine + Phase 3 form engine. It is invoked BY:

- `signatures:applyVisual` IPC handler → `applySignature({ kind: 'visual' })`
- `signatures:applyPades` IPC handler → `applySignature({ kind: 'pades' })`
- The replay engine's step 3.7 (`edit-replay-engine.md` Phase-4 extension) when a `signature-visual-place` or `signature-pades-applied` op is encountered. The PAdES op is special — see §7.

Phase 3's form-engine stubbed signing — `applyValueToField`'s `'signature'` case (`form-engine.md §3.2.1`) currently skips silently. Wave 16 extends that case to delegate into `signature-engine.applySignature` when the value is non-null.

---

## 2. Public surface

### 2.1 Top-level orchestrator signature

```ts
// src/main/pdf-ops/signature-engine.ts (NEW, David + Riley Wave 16)

import type { PDFDocument } from 'pdf-lib';
import type {
  SignaturePlacement,
  VisualAppearanceSpec,
  PadesAppearanceSpec,
  CertHandle,
  SignatureAuditRow,
  Result,
} from '@ipc/contracts';

// ============================================================
// Top-level: applySignature (discriminated dispatch)
// ============================================================

export type ApplySignatureInput =
  | {
      kind: 'visual';
      bytes: Uint8Array;
      placement: SignaturePlacement;
      appearance: VisualAppearanceSpec;
    }
  | {
      kind: 'pades';
      bytes: Uint8Array;
      placement: SignaturePlacement;
      certHandle: CertHandle;
      appearance: PadesAppearanceSpec;
      tsaUrl: string | null;
      reason?: string;
      location?: string;
      placeholderSize?: number;          // override default 16384 hex chars
    };

export interface ApplySignatureOk {
  newBytes: Uint8Array;
  /** EditOperation for the renderer's dirtyOps. */
  op: EditOperationSerialized;          // kind: 'signature-visual-place' | 'signature-pades-applied'
  /** For PAdES, the audit log row (already inserted into SQLite). Null for visual. */
  auditRow: SignatureAuditRow | null;
  warnings: string[];
}

export type ApplySignatureError =
  | 'load_failed'
  | 'placeholder_field_not_found'
  | 'placeholder_field_already_signed'
  | 'invalid_placement'
  | 'cert_handle_not_found'
  | 'cert_expired'
  | 'cert_not_yet_valid'
  | 'appearance_compose_failed'
  | 'pades_sign_failed'
  | 'pades_byte_range_failed'
  | 'pades_placeholder_too_small'
  | 'tsa_timeout'
  | 'tsa_http_error'
  | 'tsa_tls_error'
  | 'tsa_invalid_response'
  | 'tsa_disabled_but_requested'
  | 'serialize_failed'
  | 'audit_log_failed';

export type ApplySignatureResult = Result<ApplySignatureOk, ApplySignatureError>;

export async function applySignature(input: ApplySignatureInput): Promise<ApplySignatureResult>;
```

### 2.2 Per-engine path signatures (internal — not exported through IPC)

```ts
// src/main/pdf-ops/visual-signature.ts (NEW)

export interface ApplyVisualInput {
  doc: PDFDocument;                       // already loaded by the orchestrator
  placement: SignaturePlacement;
  appearance: VisualAppearanceSpec;
}

export async function applyVisual(input: ApplyVisualInput): Promise<{ warnings: string[] }>;

// src/main/pdf-ops/pades-signature.ts (NEW — node-signpdf engine)

export interface ApplyPadesInput {
  bytes: Uint8Array;                      // serialized bytes WITH appearance widget already applied
  placement: SignaturePlacement;
  certEntry: ParsedCertEntry;             // from cert-store
  tsaUrl: string | null;
  reason?: string;
  location?: string;
  placeholderSize: number;
}

export interface ApplyPadesOk {
  signedBytes: Uint8Array;
  sigBytesOffset: number;
  sigBytesLength: number;
  byteRange: [number, number, number, number];
  tsaResponseStatus: 'ok' | 'failed' | null;
}

export async function applyPades(input: ApplyPadesInput): Promise<Result<ApplyPadesOk, ApplySignatureError>>;

// src/main/pdf-ops/pades-signature-manual.ts (NEW — node-forge + pkijs fallback)
// SAME signature as applyPades — drop-in replacement. Selected via env PADES_ENGINE=manual.

export async function applyPadesManual(input: ApplyPadesInput): Promise<Result<ApplyPadesOk, ApplySignatureError>>;
```

### 2.3 Shared types (live in `src/ipc/contracts.ts`; full schemas in `api-contracts.md` Phase-4 amendment §14)

```ts
export type SignaturePlacementMode = 'placeholder' | 'freeform';

export interface SignaturePlacement {
  mode: SignaturePlacementMode;
  // For 'placeholder' mode:
  fieldName?: string;                     // Phase-3 placeholder field to fill
  // For 'freeform' mode:
  pageIndex?: number;
  rect?: PdfRect;                         // PDF user-space, origin bottom-left
  rotation?: 0 | 90 | 180 | 270;
}

export type VisualAppearanceSource =
  | { kind: 'typed'; name: string; fontFamily?: string; fontSize?: number }
  | { kind: 'drawn'; pngBytes: Uint8Array; widthPx: number; heightPx: number }
  | { kind: 'image'; bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg'; widthPx: number; heightPx: number };

export interface VisualAppearanceSpec {
  source: VisualAppearanceSource;
  showName: boolean;                      // shown for typed source; default true
  showDate: boolean;                      // default true; locale per Settings
  showReason: boolean;                    // default false unless reason non-empty
  showSubjectCN: boolean;                 // visual-only signatures have no cert; always false here
  reason?: string;                        // displayed inside the appearance box if showReason
}

export interface PadesAppearanceSpec extends VisualAppearanceSpec {
  showSubjectCN: boolean;                 // default true for PAdES
  showIssuerCN: boolean;                  // default false
  showTsaInfo: boolean;                   // default false; "Timestamped by <url>" if true
}

export type CertHandle = string;          // opaque UUID v4; valid only while cert-store holds it

export interface ParsedCertEntry {
  // Internal type; NEVER serialized over IPC.
  x509: forge.pki.Certificate;
  privateKey: forge.pki.PrivateKey;
  privateKeyPem: string;                  // overwritten on release
  fingerprint: string;                    // SHA-256 hex
  subjectCN: string;
  issuerCN: string;
  notBefore: number;                      // ms epoch
  notAfter: number;                       // ms epoch
  loadedAt: number;
  /** Internal counter for autoRelease accounting. */
  refCount: number;
}
```

### 2.4 Purity contract

The orchestrator + per-path functions are MOSTLY pure over their inputs, with TWO sanctioned side effects:

1. **Network I/O for TSA.** `tsa-client.ts` performs an HTTPS POST. The orchestrator marks the call as a side effect in its contract — callers know `applySignature({ kind: 'pades', tsaUrl: non-null })` may take up to 30 seconds and may fail with `tsa_*` errors.
2. **SQLite insert into `signature_audit_log`.** `applyPades` writes an audit row before returning. The write happens AFTER the bytes are produced (so a failed audit-insert is its own error class; the bytes are still valid). The audit insert is wrapped in its own try/catch and returns `audit_log_failed` if it fails (rare; database file locked or disk full).

All OTHER aspects of the engine are pure:

- No filesystem I/O for byte production. `bytes` come in via input; `newBytes` go out via return.
- No mutation of `input.bytes`.
- Identical inputs → identical outputs MODULO the TSA hop (timestamp varies) and the audit log row id (assigned by SQLite).

The pure-modulo-side-effects contract is testable: TSA-mocked tests are deterministic; audit-log-disabled tests are deterministic.

---

## 3. PAdES library decision (P4-L-3)

### 3.1 The two candidates

| | `node-signpdf` | `node-forge` + `pkijs` (manual) |
|---|---|---|
| License | MIT | BSD-3-Clause-OR-GPL-2.0 (forge) + MIT (pkijs) |
| Maintenance | Active GitHub, last commit 2025; 1.4k stars | Both active; forge is foundational (5k+ stars); pkijs is the de-facto JS PKI lib |
| Code we own | ~200 LOC adapter | ~600 LOC engine (CMS construction, byte-range, embedding) |
| Byte-range correctness | Known-good algorithm | We own the off-by-one risk |
| RFC 3161 timestamping | Not built-in (we write `tsa-client.ts` either way) | Not built-in (same) |
| Multi-signature workflows | Supported via incremental update | Same machinery; we implement |
| Appearance streams | Pass-through (we author appearance OURSELVES; signpdf doesn't touch /AP) | Pass-through (same) |
| Acrobat Reader DC verification | Externally verified | We'd verify ourselves |
| Test fixtures | Has its own sample PDFs we can borrow | We build our own |

### 3.2 Recommendation: `node-signpdf` as primary

**Rationale:**
1. **Less code, faster ship.** Wave 16 has ~7 days of David+Riley+Ravi capacity; spending 5 of those on byte-range arithmetic is poor risk allocation.
2. **Known-good byte-range.** The single highest-risk failure mode of a PAdES implementation is byte-range off-by-one, which produces signed-but-invalid PDFs that fail silently in Acrobat. node-signpdf has had this thoroughly debugged in its 2.x and 3.x lines.
3. **Auditability.** The code surface is small enough that David's Wave 16 test corpus + Julian's Wave 17 audit can read the entire wrapper end-to-end.
4. **Pluggable.** The orchestrator's discriminated dispatch (§2.1) lets us swap engines later without external contract changes.

**Ship the fallback at the same time.** We bring `node-forge` and `pkijs` in as dependencies AND ship the manual engine module, behind a build-time toggle (`PADES_ENGINE=manual`) + Phase-4.1 Settings switch. Cost: +~600 LOC + ~30 tests. Benefit: if a `node-signpdf` regression / license shift / archive event happens, we flip the toggle and keep shipping without a rewrite.

### 3.3 Byte-range arithmetic (primary path)

PAdES signs a hash over the document EXCEPT the `/Contents <hex>` substring (which holds the CMS bytes themselves). The byte-range is a 4-int array describing the two ranges of the document that ARE hashed.

```
PDF bytes:
+----------------------+--------+---------+-------------------+
| 0                    | a      | b       | c               d |
+----------------------+--------+---------+-------------------+
   range[0]..range[0]+range[1]   range[2]..range[2]+range[3]

The /ByteRange entry: [0, a, b, d-b]
Where:
  a = offset of '<' starting the hex placeholder
  b = a + 1 + 2*placeholderSize + 1 = offset just past '>'
  d = total length of the document
  
The bytes from offset `a` (inclusive) through offset `b` (exclusive)
are the placeholder; they are NOT hashed. Everything else IS.
```

**node-signpdf's algorithm:**
1. Insert a placeholder `/ByteRange [0 0 0 0]` and `/Contents <00...00>` (16384 zero-hex chars) into the signature dict.
2. Serialize the PDF; locate the byte offsets of the placeholders.
3. Replace `/ByteRange [0 0 0 0]` with the computed range `[0, a, b, d-b]` IN PLACE (same byte length — node-signpdf pads with spaces).
4. Hash the document over the range.
5. Compute CMS signature; produce the CMS bytes.
6. Pad the CMS bytes to exactly `placeholderSize` (16384 / 2 = 8192 bytes by default).
7. Replace `<00...00>` with `<actual hex>` IN PLACE.
8. Write the document.

**Failure modes:**

- `pades_placeholder_too_small` — the CMS bytes exceeded `placeholderSize`. node-signpdf surfaces this. Mitigation: default `placeholderSize: 16384` hex chars (8192 bytes) is generous enough for a single-signer cert chain + RFC 3161 TSA token (typical sizes: cert chain ~2 KB; CMS structure ~500 B; TSA token ~3-4 KB; total ~6 KB which fits 8192 with headroom). Configurable via `signatures.placeholderSize` Setting; very long cert chains (10+ intermediates) may need 32768.
- `pades_byte_range_failed` — node-signpdf's internal byte-range computation didn't find the placeholder. Should never happen with correctly authored bytes; treat as engine bug + report.

**Manual path (fallback) byte-range:**

The manual `pades-signature-manual.ts` performs the same algorithm with explicit code:

```ts
// Sketch from pades-signature-manual.ts (David Wave 16)
function computeByteRange(bytes: Uint8Array, placeholderStart: number, placeholderHexLen: number): [number, number, number, number] {
  // placeholderStart is the offset of the '<' character of /Contents <00...00>
  const placeholderEnd = placeholderStart + 1 + placeholderHexLen + 1; // 1 for '<', N hex chars, 1 for '>'
  return [0, placeholderStart, placeholderEnd, bytes.length - placeholderEnd];
}

function hashOverRange(bytes: Uint8Array, range: [number, number, number, number]): Uint8Array {
  const hasher = createHash('sha256');
  hasher.update(bytes.subarray(range[0], range[0] + range[1]));   // bytes 0..a
  hasher.update(bytes.subarray(range[2], range[2] + range[3]));   // bytes b..d
  return hasher.digest();
}
```

The manual path has unit tests pinning the offsets against known-good fixtures (see §9).

### 3.4 CMS envelope structure

PAdES baseline (B-B level, the simplest profile) requires:

```
ContentInfo
  contentType: signedData (1.2.840.113549.1.7.2)
  content: SignedData
    version: 1
    digestAlgorithms: [ sha-256 ]
    encapContentInfo:
      eContentType: id-data (1.2.840.113549.1.7.1)
      eContent: (empty — detached signature)
    certificates: [ signerCert, ...chain ]
    crls: (empty — Phase 4 doesn't include CRLs)
    signerInfos: [
      SignerInfo
        version: 1
        sid: IssuerAndSerialNumber
        digestAlgorithm: sha-256
        signedAttrs:
          contentType: id-data
          messageDigest: <hash from §3.3>
          signingTime: <current time>
          (PAdES) SigningCertificateV2: <hash of signer cert>
        signatureAlgorithm: rsaWithSha256 (or ecdsaWithSha256 if EC cert)
        signature: <RSA/ECDSA over signedAttrs>
        unsignedAttrs:
          (if TSA) timestamp-token: <TSR from §6>
    ]
```

node-signpdf produces this envelope from a forge.pkcs7 SignedData object. The manual engine builds it via pkijs's `SignedData` + `EnvelopedData` classes (we use SignedData since it's detached).

**PAdES-T (with timestamp)** is achieved by adding the `id-aa-timeStampToken` unsigned attribute carrying the TSR from `tsa-client.ts`.

**PAdES-LTV (long-term validation)** with embedded CRLs / OCSPs is OUT OF SCOPE for Phase 4 (locked Phase 4.5+).

### 3.5 Manual engine selection toggle

```ts
// src/main/pdf-ops/signature-engine.ts (orchestrator selects engine)
const padesEngine = process.env.PADES_ENGINE === 'manual' ? applyPadesManual : applyPades;

const result = await padesEngine({ bytes: ..., certEntry: ..., ... });
```

Build-time toggle for Wave 16 ship. Phase 4.1 may expose this in Settings as `signatures.padesEngine: 'signpdf' | 'manual'`. Diego's Wave 17 packaging ensures both engine modules are in the bundle regardless of toggle so the runtime switch works without re-installation.

---

## 4. Cert + password lifecycle (the CRITICAL risk per P4-L-1)

This is the section Wave 17 Julian audits hardest. Every step is documented with the exact memory location, the exact zeroing moment, and the failure-recovery story.

### 4.1 Module: `cert-store.ts`

```ts
// src/main/pdf-ops/cert-store.ts (NEW, David + Riley Wave 16)

import { randomUUID } from 'node:crypto';
import forge from 'node-forge';

interface ParsedCertEntry {
  x509: forge.pki.Certificate;
  privateKey: forge.pki.PrivateKey;
  privateKeyPem: string;                  // mutable; overwritten on release
  fingerprint: string;
  subjectCN: string;
  issuerCN: string;
  notBefore: number;
  notAfter: number;
  loadedAt: number;
  refCount: number;
}

const CERT_STORE = new Map<CertHandle, ParsedCertEntry>();

export type CertLoadError =
  | 'pfx_decode_failed'
  | 'pfx_no_private_key'
  | 'pfx_no_cert'
  | 'wrong_password';

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
 * Load a PFX/P12 blob with a password. Both inputs are CONSUMED — the bytes and
 * the password are zeroed before this function returns the handle. If load fails,
 * the bytes and password are STILL zeroed (in the catch block).
 *
 * The returned handle is a fresh UUID. Callers must pass the handle to applyPades
 * exactly once; the handle is invalidated by signRelease() OR by the autoRelease
 * flag in applyPades (default true).
 */
export function loadCert(
  pfxBytes: Buffer,                       // CONSUMED — zeroed before return
  passwordBuffer: Buffer,                 // CONSUMED — zeroed before return
): Result<CertLoadOk, CertLoadError> {
  try {
    // Step 1: convert PFX bytes to forge ASN.1
    const p12Asn1 = forge.asn1.fromDer(pfxBytes.toString('binary'));

    // Step 2: parse PKCS#12 with the password
    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passwordBuffer.toString('utf-8'));
    } catch (e) {
      // Distinguish wrong password from other decode failures
      if (/MAC verification failed|Invalid password/i.test((e as Error).message)) {
        return fail('wrong_password', 'PFX password is incorrect');
      }
      return fail('pfx_decode_failed', (e as Error).message);
    }

    // Step 3: extract the cert + private key
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
    const certBag = certBags[forge.pki.oids.certBag]?.[0];

    if (!keyBag?.key) return fail('pfx_no_private_key', 'PFX did not contain a private key');
    if (!certBag?.cert) return fail('pfx_no_cert', 'PFX did not contain a certificate');

    // Step 4: derive the display fields
    const privateKey = keyBag.key;
    const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
    const x509 = certBag.cert;
    const fingerprint = forge.md.sha256.create()
      .update(forge.asn1.toDer(forge.pki.certificateToAsn1(x509)).getBytes())
      .digest().toHex();

    const subjectCN = x509.subject.getField('CN')?.value ?? '';
    const issuerCN = x509.issuer.getField('CN')?.value ?? '';
    const notBefore = x509.validity.notBefore.getTime();
    const notAfter = x509.validity.notAfter.getTime();
    const now = Date.now();
    const isExpired = now > notAfter || now < notBefore;

    // Step 5: store under a fresh handle
    const handle = randomUUID();
    CERT_STORE.set(handle, {
      x509,
      privateKey,
      privateKeyPem,
      fingerprint,
      subjectCN,
      issuerCN,
      notBefore,
      notAfter,
      loadedAt: now,
      refCount: 0,
    });

    return ok({
      handle,
      subjectCN,
      issuerCN,
      notBefore,
      notAfter,
      fingerprint,
      isExpired,
    });
  } finally {
    // Step 6: ALWAYS zero the inputs, even on failure.
    pfxBytes.fill(0);
    passwordBuffer.fill(0);
  }
}

/**
 * Release a cert handle. Zeroes the PEM string in the entry and deletes the
 * entry from the map. Idempotent — calling release on a missing handle is a no-op.
 */
export function releaseHandle(handle: CertHandle): boolean {
  const entry = CERT_STORE.get(handle);
  if (!entry) return false;

  // Overwrite the PEM string in the entry by replacing the field with an
  // empty string. The previous string falls out of scope; V8 will collect
  // it on the next GC cycle. We accept the eventual-GC window as the
  // security floor (R-W15-A in architecture-phase-4.md §8.1).
  entry.privateKeyPem = '';
  // The forge.pki.PrivateKey object is a structure of bignums; we can't
  // zero its internals via JS, but the privateKey reference is dropped
  // here and the object is no longer reachable from CERT_STORE after delete.
  CERT_STORE.delete(handle);

  // Suggest GC if exposed (dev only; production no-ops).
  if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
    (globalThis as { gc?: () => void }).gc?.();
  }
  return true;
}

/**
 * Look up a cert entry by handle. Returns null if missing (e.g. already released).
 */
export function getEntry(handle: CertHandle): ParsedCertEntry | null {
  return CERT_STORE.get(handle) ?? null;
}

/**
 * Release all cert handles. Fired on app quit, hot-reload, and at the start
 * of testing setup/teardown. Guarantees no cert outlives the process.
 */
export function releaseAll(): number {
  const count = CERT_STORE.size;
  for (const handle of Array.from(CERT_STORE.keys())) {
    releaseHandle(handle);
  }
  return count;
}
```

### 4.2 IPC handlers — `signatures:certLoad` and `signatures:certRelease`

```ts
// src/ipc/handlers/signatures-cert-load.ts (NEW)

import { z } from 'zod';
import { loadCert } from '@main/pdf-ops/cert-store';

const requestSchema = z.object({
  pfxBytes: z.instanceof(Uint8Array),
  password: z.string().min(1).max(256),
});

export async function handleCertLoad(req: unknown): Promise<CertLoadResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) return fail('invalid_payload', parsed.error.message);

  // CRITICAL DISCIPLINE — see conventions §15.
  // We convert password from JS string to Buffer at the EARLIEST possible point.
  // The local `passwordString` is set to '' to drop the JS string reference;
  // the original parsed.data.password reference is also dropped by going out of scope
  // at function return. The Buffer is what loadCert consumes and zeroes.
  const pfxBuf = Buffer.from(parsed.data.pfxBytes);   // copy bytes into Buffer
  const passwordBuf = Buffer.from(parsed.data.password, 'utf-8');
  // overwrite local strings/refs:
  let passwordString: string = parsed.data.password;
  passwordString = '';                                 // explicit zero; V8 may intern, see §4.2.3
  (parsed.data as { password: string }).password = ''; // overwrite parsed obj field
  void passwordString;                                 // discard

  try {
    const result = loadCert(pfxBuf, passwordBuf);     // CONSUMES both buffers
    // pfxBuf and passwordBuf are now zeroed; do not re-use them.
    return result;
  } catch (e) {
    // loadCert handles its own try/finally; this catch is defensive.
    return fail('pfx_decode_failed', (e as Error).message);
  }
}
```

```ts
// src/ipc/handlers/signatures-cert-release.ts (NEW)

const requestSchema = z.object({ handle: z.string().uuid() });

export async function handleCertRelease(req: unknown): Promise<CertReleaseResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) return fail('invalid_payload', parsed.error.message);
  const released = releaseHandle(parsed.data.handle);
  return ok({ released });
}
```

The renderer's PAdES sign modal `useEffect` cleanup fires the release thunk:

```ts
// pades-sign-modal/index.tsx — Wave 16 Riley
useEffect(() => {
  return () => {
    if (certHandle) {
      dispatch(releaseCertThunk({ handle: certHandle }));
    }
  };
}, [certHandle, dispatch]);
```

### 4.2.1 Lifecycle diagram (referenced from architecture-phase-4.md §4.2)

```
┌──────────────┐    1.   ┌──────────────┐
│  Renderer    │ ──────→ │  Preload     │
│  modal      │  pfxBytes│  bridge      │
│  state      │  password│              │
└──────────────┘         └──────────────┘
                                 │
                                 │ 2. ipcRenderer.invoke('signatures:certLoad', ...)
                                 ▼
                         ┌──────────────────────┐
                         │  Main handler         │
                         │  • zod validate      │
                         │  • Buffer.from(pwd)  │
                         │  • zero JS string    │ ← ≤5 lines synchronous
                         │  • call loadCert()   │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │  cert-store.loadCert │
                         │  try:                │
                         │    parse PFX         │
                         │    extract key+cert  │
                         │    derive metadata   │
                         │    store under handle│
                         │  finally:            │
                         │    pfxBuf.fill(0)    │
                         │    pwdBuf.fill(0)    │
                         └──────────┬───────────┘
                                    │ 3. returns { handle, subjectCN, ... }
                                    │    (cert bytes + password ZEROED)
                                    ▼
                         ┌──────────────────────┐
                         │  Main handler        │
                         │  returns to IPC      │
                         └──────────┬───────────┘
                                    │ 4. IPC response { ok: true, handle, ... }
                                    ▼
                         ┌──────────────────────┐
                         │  Renderer            │
                         │  state.certHandle    │
                         │  (string only)       │
                         └──────────────────────┘

Subsequent sign:
   Renderer dispatches signatures:applyPades { handle, ... }
   Main looks up entry by handle (entry.privateKey usable)
   Main signs (no cert bytes leave main)
   Main inserts audit row
   (autoRelease=true)
   Main calls releaseHandle(handle):
     entry.privateKeyPem = ''   (PEM string dropped)
     entry.privateKey reference dropped via map.delete()
     map.delete(handle)
   Returns signed bytes

Modal close before sign:
   Renderer useEffect cleanup fires signatures:certRelease
   Same releaseHandle path
```

### 4.2.2 Failure recovery — guaranteed zeroing on every path

| Failure | What's left in memory? |
|---|---|
| `wrong_password` returned from forge | `passwordBuf` zeroed in finally; `pfxBuf` zeroed in finally. Renderer shows "Wrong password — try again". No cert entry created. |
| `pfx_decode_failed` (malformed PFX) | Same — both buffers zeroed in finally. No entry created. |
| Network failure during PFX read (impossible — bytes already in renderer) | N/A |
| Main process crash mid-load | Crash dump may contain bytes. Mitigated by Wave 17 follow-up (purge crashpad dir on quit). |
| `applyPades` fails after successful load | `try/finally releaseHandle(handle)` in the handler ensures cleanup. If autoRelease=false (multi-sign session), the modal cleanup fires release on dismiss. |
| Renderer hot-reload during dev | Main's `app.on('before-quit')` fires releaseAll(); on dev reload the new main process starts with empty store. |
| User force-kills the app | OS reclaims process memory; no on-disk artifacts because no on-disk writes. |

### 4.2.3 What V8 makes hard — honest write-up

JS strings are immutable; you can't `password.fill(0)`. The discipline above:
- Converts to `Buffer` at the EARLIEST opportunity (handler line 2).
- Overwrites the string variables with `''`.
- Drops the references by scope exit.

But the original string CAN linger in V8's heap until next GC. Worst case: ~1-2 seconds on a busy Electron main. For our threat model (local desktop attacker who can read process memory while the modal is open), the residual is acceptable because we've narrowed the window to a small synchronous code block.

**What we explicitly do NOT promise:**
- Defending against an attacker with a debugger attached to the process.
- Defending against a kernel-level memory dump captured during the modal flow.
- Defending against compromised OS keychain or trust store.
- "Secure memory" pages (mlock / VirtualLock) for the cert — Phase 4 doesn't attempt this; Phase 4.1+ may add via `node-keytar` for OS-keychain-backed password retrieval.

**What we DO promise:**
- No password written to disk (no log, no .env, no auto-fill, no Electron-Store).
- No cert bytes written to disk (no log, no temp file, no swap dump that we trigger).
- No password reflected back over IPC.
- Explicit zero of Buffer-wrapped password + PFX bytes after parse.
- Try/finally cleanup on EVERY code path.
- Cert release on EVERY modal-close path.
- `app.before-quit` releases all certs.

### 4.3 Wave 17 Julian audit checklist (this section)

Mechanical greps Julian can run:

```bash
# (1) Every password reference must be ≤5 lines from input to Buffer wrap
rg -n "password" src/main/pdf-ops/cert-store.ts src/ipc/handlers/signatures-cert-*.ts

# (2) No log statement contains password / pfx / cert / privateKey
rg -n "log\.(info|debug|warn|error)" src/main/pdf-ops/cert-store.ts src/ipc/handlers/signatures-cert-*.ts | rg -i "password|pfx|cert|privateKey"
# Should produce ZERO matches.

# (3) Every Buffer.from(password) is followed by a fill(0) in finally
rg -n -B 2 -A 30 "passwordBuf" src/main/pdf-ops/cert-store.ts | rg "fill\(0\)"

# (4) No PFX or PEM written to disk
rg -n "writeFile|writeFileSync|createWriteStream" src/main/pdf-ops/cert-store.ts src/main/pdf-ops/pades-*.ts src/ipc/handlers/signatures-*.ts
# Should produce ZERO matches.

# (5) app.before-quit releases all certs
rg -n "app\.on\(['\"]before-quit" src/main/
# Should find one match that calls cert-store.releaseAll()

# (6) Tests use REAL passwords + assert REAL zeroing (no stubbed cert-store)
rg -n "cert-store" src/main/pdf-ops/*.test.ts src/ipc/handlers/signatures-*.test.ts
# Tests should call the real loadCert with real PFX bytes (test fixture) +
# assert the input buffers are zeroed post-call.
```

---

## 5. Visual signature + appearance composition (P4-L-4)

### 5.1 `visual-signature.ts`

Visual signatures ride the existing image-overlay infrastructure where possible. The pipeline:

```
applyVisual(input):
  1. Compose appearance image bytes (PNG) from input.appearance.source:
       'typed'  → text-to-PNG via the renderer-side canvas (sent as drawnBytes by the modal)
       'drawn'  → PNG bytes directly from canvas
       'image'  → PNG/JPEG bytes (passed through)
  2. Compose the appearance container:
       canvas of widget-rect size
       layout: [appearance image][metadata text rows]
       see signature-appearance.ts §5.2
  3. Author the widget annotation:
       3a. If placeholder mode: locate the existing /Sig field by name; reuse its widget rect.
       3b. If freeform mode: author a new /Sig field via field-dict-authoring.ts pattern
           (same as Phase 3 placeholder, but mark it as "visually signed" with /V <<>>).
  4. Embed the composed appearance image as the /AP /N stream of the widget.
  5. Mark the field as visually signed by writing /V <<>> (empty Sig value dict; signals
     "no PAdES /Contents but not a placeholder either" per R-W15-D).
  6. Save the document via pdf-lib's doc.save() with useObjectStreams: true.
  7. Return warnings + the EditOperation { kind: 'signature-visual-place', ... }.
```

### 5.2 `signature-appearance.ts`

Composes the appearance stream (`/AP /N` content stream) shared by visual + PAdES paths.

```ts
// src/main/pdf-ops/signature-appearance.ts

export interface AppearanceSpec {
  rect: PdfRect;                          // widget rect; appearance fits this rect
  source: VisualAppearanceSource;
  showName: boolean;
  showDate: boolean;
  showReason: boolean;
  showSubjectCN: boolean;
  showIssuerCN: boolean;
  showTsaInfo: boolean;
  reason?: string;
  subjectCN?: string;
  issuerCN?: string;
  signedAt?: number;                      // ms epoch
  tsaUrl?: string;
}

export interface AppearanceStreamOk {
  pdfStream: Uint8Array;                  // ready to attach as widget.AP.N
  warnings: string[];                     // e.g. "Reason text was truncated"
}

export async function composeAppearance(
  doc: PDFDocument,
  spec: AppearanceSpec,
): Promise<AppearanceStreamOk>;
```

**Layout algorithm (deterministic):**

```
+----------------------------------+ <- widget rect (height = H, width = W)
|                                  |
|  [appearance image]              |     ← takes top 60% of H
|                                  |
+----------------------------------+
|  Signed by: <subjectCN>          |     ← shown if showSubjectCN
|  Issuer: <issuerCN>              |     ← shown if showIssuerCN
|  Date: 2026-05-26 14:32:08 UTC   |     ← shown if showDate
|  Reason: <reason>                |     ← shown if showReason
|  Timestamped by: <tsaUrl>        |     ← shown if showTsaInfo
+----------------------------------+
```

Each text row is one line at fontSize = `min(10, H/8)`, Helvetica embed. Rows are dropped in priority order if they don't fit:
1. (lowest) Timestamped by
2. Reason
3. Issuer
4. Date
5. Subject CN
6. (highest) appearance image

The drop policy is documented in user-guide (Wave 18 Nathan).

**Why deterministic:** golden-bytes tests need byte-identical output for the same input. The algorithm uses a fixed seed for any randomness (there isn't any — purely deterministic layout based on W, H, and the flags).

### 5.3 Drawn / typed / image source handling

| Source kind | Renderer prepares | Main embeds |
|---|---|---|
| `typed { name, fontFamily?, fontSize? }` | Renderer renders the name in a `<canvas>` at high DPI (96 → 192), exports PNG bytes, ships in `VisualAppearanceSpec.source.pngBytes`. The renderer (NOT main) chooses the font — same modules used by FreeText annotations. | Main treats the PNG as the appearance image. |
| `drawn { pngBytes, widthPx, heightPx }` | Renderer's `<canvas>` captures pointer events with smoothing; exports PNG. | Main treats the PNG as the appearance image. |
| `image { bytes, mimeType, widthPx, heightPx }` | Renderer reads the dropped file; ships bytes. | Main decodes PNG/JPEG via pdf-lib's `embedPng`/`embedJpg`; uses the embedded image. |

The "drawn" source is the most common; smoothing is renderer-side using a small Catmull-Rom interpolation in `use-signature-canvas.ts`. The canvas exports at 4x device pixel ratio for crispness when embedded at 96 DPI.

### 5.4 Distinguishing placeholder / visual-signed / PAdES-signed (R-W15-D)

After Phase 4 signs a placeholder, we need the form-engine + renderer to distinguish three states:

| State | Field `/V` entry | Widget `/AP /N` | Audit log row |
|---|---|---|---|
| Placeholder (Phase 3) | absent | absent | none |
| Visual-signed | empty dict `<< >>` | present | none |
| PAdES-signed | `<< /ByteRange [...] /Contents <hex> >>` etc. | present | one row |

The form-engine's `extractFieldDefinition` (`form-engine.md §3.1.1`) gains a branch for visual-signed detection:

```ts
// form-engine.ts (David Wave 16 extension)
if (pdfField instanceof PDFSignature) {
  const dict = pdfField.acroField.getDict();
  const vEntry = dict.lookupMaybe(PDFName.of('V'), PDFDict);
  if (!vEntry) {
    return { type: 'signature', value: { type: 'signature', value: null }, /* placeholder */ };
  }
  const contents = vEntry.lookupMaybe(PDFName.of('Contents'), PDFHexString);
  if (!contents) {
    return { type: 'signature', value: { type: 'signature', value: { kind: 'visual', auditLogRowId: null, fingerprint: null, signedAt: vEntry.lookupMaybe(PDFName.of('M'), PDFString)?.asDate()?.getTime() ?? null } } };
  }
  // PAdES-signed: extract fingerprint + audit row id from the audit table by doc hash
  return { type: 'signature', value: { type: 'signature', value: { kind: 'pades', ... } } };
}
```

The renderer's form-fill overlay (`ui-spec.md §12.5`) gains the THREE states:
- placeholder → "Click to sign" (Phase 4 active button)
- visual-signed → "Signed (visual)" lock + tooltip
- pades-signed → "Signed by <subjectCN> on <date>" lock + tooltip + clickable to open audit detail

---

## 6. RFC 3161 TSA client

### 6.1 `tsa-client.ts`

```ts
// src/main/pdf-ops/tsa-client.ts (NEW, David Wave 16)

import { request } from 'node:https';
import forge from 'node-forge';

export interface TsaRequestInput {
  tsaUrl: string;                         // https://...; validated by caller
  hash: Uint8Array;                       // sha256 of the doc bytes (32 bytes)
  hashAlgorithm: 'sha-256';
  nonce: bigint;                          // random nonce; verify in response
  timeoutMs?: number;                     // default 30000
}

export interface TsaResponseOk {
  tsr: Uint8Array;                        // TimeStampResp DER bytes (full response, for embedding)
  tsToken: Uint8Array;                    // TimeStampToken DER bytes (inner content; goes into CMS unsignedAttrs)
  genTime: number;                        // ms epoch from the TSR
  serialNumber: bigint;                   // TSR serial number
}

export type TsaError =
  | 'tsa_http_error'
  | 'tsa_tls_error'
  | 'tsa_timeout'
  | 'tsa_invalid_response'
  | 'tsa_nonce_mismatch'
  | 'tsa_genTime_skew';                   // genTime drift from system clock > 5 minutes

export async function requestTimestamp(input: TsaRequestInput): Promise<Result<TsaResponseOk, TsaError>>;
```

### 6.2 Algorithm

```
1. Build a TimeStampReq ASN.1 structure:
     TimeStampReq SEQUENCE {
       version INTEGER 1,
       messageImprint SEQUENCE {
         hashAlgorithm AlgorithmIdentifier { OID sha-256 },
         hashedMessage OCTET STRING = input.hash
       },
       nonce INTEGER = input.nonce,
       certReq BOOLEAN TRUE
     }
2. DER-encode the request.
3. HTTPS POST to input.tsaUrl with:
     Content-Type: application/timestamp-query
     Body: DER bytes
4. Receive response (Content-Type: application/timestamp-reply); parse:
     TimeStampResp SEQUENCE {
       status PKIStatusInfo,                  ← assert .status = 0 (granted)
       timeStampToken ContentInfo (optional)  ← the embedded token
     }
5. Inside the timeStampToken (ContentInfo with id-signedData):
     SignedData.encapContentInfo.eContent = TSTInfo:
       version INTEGER 1,
       policy OID,
       messageImprint SEQUENCE { hashAlgorithm, hashedMessage },
       serialNumber INTEGER,
       genTime GeneralizedTime,
       nonce INTEGER (optional)
6. Validate:
   - status.status === 0 (granted) — else 'tsa_invalid_response' with status info
   - messageImprint.hashedMessage === input.hash — else 'tsa_invalid_response'
   - nonce === input.nonce — else 'tsa_nonce_mismatch'
   - |genTime - Date.now()| < 5 minutes — else 'tsa_genTime_skew' (per R-W15-C)
7. Return { tsr, tsToken, genTime, serialNumber }.
```

### 6.3 TSA failure modes

Per architecture-phase-4.md §4.5, ALL failures are fail-loud:

| Code | Cause | Renderer message |
|---|---|---|
| `tsa_http_error` | 4xx/5xx HTTP status | "TSA returned HTTP <code>: <body>. Disable TSA or check the URL." |
| `tsa_tls_error` | TLS handshake failure | "TSA TLS error: <code>. The TSA's certificate may not be in your system trust store." |
| `tsa_timeout` | No response within `timeoutMs` | "TSA timed out after <n> seconds. The service may be down." |
| `tsa_invalid_response` | Malformed TSR or status != granted | "TSA rejected the request: <status>." |
| `tsa_nonce_mismatch` | Returned nonce doesn't match | "TSA response is suspicious (nonce mismatch). Do not trust this TSA URL." |
| `tsa_genTime_skew` | genTime drifts >5 min from system clock | "TSA returned a time that's <n> minutes off your system clock. Sync your clock or pick a different TSA." |

The sign fails; no signed bytes are produced. User can disable TSA and re-sign.

### 6.4 Settings: TSA URL trust

`signatures.tsaUrl` and `signatures.tsaEnabled` Settings (new in §10.4 of architecture-phase-4.md).

Settings dialog renders:

```
Timestamping (TSA)
  ☐ Enable RFC 3161 timestamping when signing
  URL: [https://...                                ]
  Timeout: [30 s]
  [Test connection]                ← fires signatures:requestTimestamp with a 32-byte zero hash
                                     and reports success/failure (green checkmark or red message)
```

The "Test connection" button fires a test request with a fake (zero) hash; we expect the TSA to grant a timestamp (most TSAs accept any hash since they're just signing the time). On failure, the same error codes surface.

---

## 7. Replay engine integration (step 3.7)

Per `architecture-phase-4.md §4.7`. The replay engine adds step 3.7 between 3.6 (form ops) and 4 (emit annots):

```
3.7 applySignatureOps(ctx, doc, ops):
    const sigOps = ops.filter(op => op.kind === 'signature-visual-place' || op.kind === 'signature-pades-applied')
    if (sigOps.length === 0) return

    for op of sigOps:
      if (op.kind === 'signature-visual-place'):
        // Compose appearance + attach to widget. Re-runnable; idempotent on doc.
        await applyVisual({
          doc,
          placement: op.placement,
          appearance: op.appearance,
        })

      if (op.kind === 'signature-pades-applied'):
        // The PAdES sign was already applied at signing time; the renderer's
        // dirtyOps shouldn't contain a pades op on save UNLESS the user signed
        // and then continued editing. In that case, replay needs to ABORT —
        // re-signing would require the cert which we don't have at replay time.
        if (anyOtherEditOpsAfter(ops, op)):
          throw new ReplayError('pades_invalidated_by_subsequent_edit', ...)

        // No-op otherwise: the widget is already in the bytes the engine loaded.
        // Just assert the widget is still present.
        assertSignatureWidgetPresent(doc, op.placement.fieldName ?? op.placement.freeformFieldName)

    yield progress { phase: 'pdflib-applying-signatures', percent: 65-70% }
```

The order matters: signatures run AFTER form ops (which may add the placeholder field that the signature fills) but BEFORE the regular emit-annotations step (so the widget's appearance is in place when the page content is finalized).

**Two new `ReplayError` variants:**

```ts
export type ReplayError =
  // ...existing variants...
  | 'signature_widget_missing'
  | 'pades_invalidated_by_subsequent_edit';
```

### 7.4 Undo semantics for PAdES

Undoing a `signature-pades-applied` op is conceptually weird (the bytes ARE the document). Wave 16 implementation:

| Scenario | Behavior |
|---|---|
| Sign + Undo BEFORE save | Renderer rolls back via inverse `signature-pades-removed` (deletes the widget + clears the `/V` Contents from the field dict). Audit log row is DELETED (Ravi Wave 16 adds `delete(id)` to the repo). Document returns to placeholder state. |
| Sign + Save + Undo | Renderer's history still has the inverse. Save replaces on-disk file with the unsigned bytes. **A confirmation modal warns** "Undoing the PAdES signature will produce an unsigned file. External verifiers will no longer trust the previously signed file. Continue?" If user proceeds, audit log row is deleted; document is unsigned; on disk file is unsigned-bytes. |
| Sign + Save + Close + Reopen | Document has the signature; the renderer reconstructs the form-fill overlay from the signed `/V`. Undo history is EMPTY (history doesn't survive close). User can sign-again to add a second signature (Phase 4.5 multi-sign workflow); Phase 4 instead prompts "This document is already signed; re-signing will invalidate the previous signature. Continue?" |

The Wave 16 implementer keeps undo behavior simple: the inverse `signature-pades-removed` removes the widget + clears `/V` + deletes the audit row. The confirmation modal lives in the renderer.

---

## 8. Signature audit log integration

### 8.1 Insert flow

```
applyPades returns successfully with signedBytes + sigBytesOffset + sigBytesLength + byteRange.
   ↓
signature-engine.ts top-level orchestrator:
   1. Computes doc_hash = sha256(signedBytes)
   2. Computes pre_sign_doc_hash = sha256(input.bytes)  // the bytes we hashed for signing
   3. Calls signatureAuditRepo.insert({
        doc_hash,
        pre_sign_doc_hash,
        signed_at: Date.now(),
        signature_kind: input.tsaUrl ? 'pades-tsa' : 'pades',
        signed_by_fingerprint: certEntry.fingerprint,
        signed_by_subject_cn: certEntry.subjectCN,
        signed_by_issuer_cn: certEntry.issuerCN,
        cert_not_before: certEntry.notBefore,
        cert_not_after: certEntry.notAfter,
        tsa_url: input.tsaUrl,
        tsa_response_status: tsaResponseStatus,  // 'ok' | 'failed' | null
        sig_bytes_offset: sigBytesOffset,
        sig_bytes_length: sigBytesLength,
        byte_range_json: JSON.stringify(byteRange),
        reason: input.reason ?? null,
        location: input.location ?? null,
        field_name: input.placement.fieldName ?? null,
      })
   4. The insert returns the row id, which is embedded in the EditOperation:
      { kind: 'signature-pades-applied', auditLogRowId: id, ... }
```

If the audit insert fails (rare; SQLite locked or disk full), the engine returns `audit_log_failed` AND still includes the signed bytes in the error details so the renderer can offer "Save the signed file anyway, but the audit log entry was lost."

### 8.2 List + filter

```
signatures:listAudit Request:
  - fileHash?: string                     // filter by doc_hash OR pre_sign_doc_hash
  - signedByFingerprint?: string          // filter by fingerprint
  - since?: number, until?: number        // signed_at range
  - limit?: number, offset?: number

Response:
  - items: SignatureAuditRow[]            // newest first
```

The audit panel renderer (`signature-audit-panel/`) fetches all rows for the current doc (by `doc_hash`) and shows a table; clicking a row opens a detail view with the byte-range hex, cert info, TSA info, reason, location.

### 8.3 Verify (limited — Phase 4)

`signatures:verify` re-hashes the current document bytes over the byte-range from the audit row and compares to the hash inside the CMS envelope. If matched, the signature is valid; the cert is shown along with the fingerprint match.

**This is ONLY for signatures THIS APP applied** (because the audit log entry has the byte-range cached). Third-party signature verification is Phase 4.1+.

```
signatures:verify Request:
  - handle: DocumentHandle
  - auditLogRowId: number

Response Ok:
  - valid: boolean                        // hash matches
  - tamperedSinceSign: boolean             // doc_hash from audit row !== sha256(current bytes)
  - certInfo: { fingerprint, subjectCN, issuerCN, notBefore, notAfter, isExpiredNow }
  - tsaInfo: { tsaUrl, genTime, valid } | null
```

---

## 9. Test strategy (Wave 16, David + Ravi + Riley)

### 9.1 Fixture corpus

Lives in `tests/fixtures/signature-engine/`:

- `placeholder-only.pdf` — Phase-3-authored doc with a single `/Sig` placeholder; bytes-stable
- `signed-by-other.pdf` — externally-produced signed doc (we open, we don't sign); used to verify form-engine detection of third-party signatures
- `test-cert.pfx` + `test-cert-password.txt` — 2048-bit RSA self-signed cert with known fingerprint; password is `test-password-do-not-use-in-prod`. PFX bytes < 10 KB. Cert valid 2026-2030. The password is stored UNENCRYPTED in the fixture (it's a fixture for a test cert; not production). README in fixtures dir documents the threat model.
- `test-cert-ec.pfx` — 256-bit ECDSA self-signed; tests the EC path in CMS
- `test-cert-expired.pfx` — cert valid 2020-2021 (expired); tests `cert_expired` flow
- `test-cert-not-yet.pfx` — cert valid 2030-2031 (not yet valid); tests `cert_not_yet_valid`
- `test-cert-corrupted.pfx` — PFX with random bytes flipped; tests `pfx_decode_failed`
- `test-cert-wrong-pwd-test.pfx` — same cert encrypted with a different password; tests `wrong_password`
- `golden-pdf-signed-via-signpdf.pdf` — known-good output from applying `test-cert.pfx` to `placeholder-only.pdf`; byte-stable golden for the primary engine round-trip
- `golden-pdf-signed-via-manual.pdf` — same input + cert through the manual engine; byte-stable golden for the fallback
- `tsa-response-fixture.bin` — recorded TSR from freetsa.org for offline test reproducibility

### 9.2 Test categories

| Category | Coverage |
|---|---|
| Cert load — happy path | Load test-cert.pfx with correct password; assert handle returned, subjectCN/issuerCN/fingerprint correct, isExpired=false. |
| Cert load — wrong password | Load with wrong password; assert error='wrong_password'. Assert pfxBuf + passwordBuf zeroed post-call (read the buffer back; should be all zeros). |
| Cert load — expired cert | Load test-cert-expired.pfx; assert isExpired=true; load succeeds (it's still loadable, just expired). |
| Cert load — buffer zeroing | After every load (success OR failure), assert both input buffers are entirely zero. |
| Cert release — happy path | Load, release, assert getEntry returns null. |
| Cert release — idempotent | Load, release, release again; second release returns false but doesn't throw. |
| Cert release — releaseAll | Load 3 certs, releaseAll(), assert all 3 are released. |
| `signatures:certLoad` IPC — password discipline | Spy on the handler; assert the password string is set to '' before the IPC response returns. (Tricky to test directly; use a wrapper that captures the local var.) |
| Visual sign — typed | Apply typed signature to a placeholder; reload; assert widget has /AP /N stream + /V <<>>. |
| Visual sign — drawn | Same with drawn PNG bytes. |
| Visual sign — image | Same with uploaded PNG. |
| Visual sign — freeform placement | Same, no placeholder; assert new /Sig field authored at the rect. |
| PAdES sign (primary engine) — placeholder | Sign placeholder-only.pdf with test-cert.pfx; reload; verify against golden bytes. |
| PAdES sign — verify in Acrobat Reader DC | Manual test step (Wave 16 + Wave 17): open signed PDF in Acrobat, verify signature shows green checkmark. |
| PAdES sign — byte-range correctness | Re-hash the bytes over the byte-range from the audit row; compare to messageDigest in CMS; assert match. |
| PAdES sign — TSA happy path | Mock TSA returns a valid TSR; assert sign succeeds with tsa_response_status='ok'. |
| PAdES sign — TSA timeout | Mock TSA never responds within 30s; assert error='tsa_timeout' AND no audit row inserted AND no bytes returned. |
| PAdES sign — TSA HTTP error | Mock TSA returns 500; assert error='tsa_http_error'. |
| PAdES sign — TSA invalid response | Mock TSA returns malformed bytes; assert error='tsa_invalid_response'. |
| PAdES sign — TSA nonce mismatch | Mock TSA returns wrong nonce; assert error='tsa_nonce_mismatch'. |
| PAdES sign — TSA genTime skew | Mock TSA returns genTime 10 minutes off; assert error='tsa_genTime_skew'. |
| PAdES sign — expired cert | Sign with test-cert-expired.pfx; assert error='cert_expired' OR success with warning (Wave 16 decides; Riley's recommendation: error). |
| PAdES sign (manual engine) — same matrix as primary | Run identical tests against `applyPadesManual`; assert byte-stable against `golden-pdf-signed-via-manual.pdf` (NOT the same as primary's golden — manual produces slightly different bytes due to ASN.1 ordering, but both are valid). |
| PAdES sign — placeholder too small | Use placeholderSize=100 (intentionally tiny); assert error='pades_placeholder_too_small'. |
| Audit log — insert + list | Sign, list by doc_hash, assert row present with correct fields. |
| Audit log — delete (for undo) | Sign, delete, assert row gone. |
| Audit log — listByFingerprint | Insert 3 rows with same fingerprint; query; assert all 3 returned. |
| Verify — happy path | Sign, immediately verify; assert valid=true tamperedSinceSign=false. |
| Verify — tampered | Sign, modify one byte of the signed file, verify; assert valid=false tamperedSinceSign=true. |
| Replay engine — sign + reorder | Sign + reorder pages in the same dirtyOps; assert `pades_invalidated_by_subsequent_edit` error. |
| Annotation shapes — Square | Add a Square annotation; reload; assert subtype + rect + color preserved. |
| Annotation shapes — Polygon | Same for polygon. |
| Annotation shapes — Polyline-measure | Add polyline with measure calibration; assert /Measure dict written + reload preserves it. |
| Calibration — set / get | Set per-doc calibration; read it back. |
| App quit — releaseAll | Trigger `before-quit`; assert releaseAll fires and all certs are released. |

### 9.3 Permissive-stub anti-pattern guards

Per the Wave 13.5 lesson (permissive-stub root cause): tests MUST use REAL production crypto primitives:

- Tests for `loadCert` MUST use the real test-cert.pfx fixture, NOT a fake cert object. Verify both the success AND the failure paths (wrong password, expired, corrupted).
- Tests for `applyPades` MUST use the real node-signpdf library, NOT a stub. The TSA mock is the ONLY acceptable stub (network is unavailable in CI; mocking the HTTP layer is necessary).
- Tests for `requestTimestamp` MUST use a fixture TSR (`tsa-response-fixture.bin`) replayed via a local HTTPS test server; do NOT stub the parse path.
- The Audit log test MUST use a real `:memory:` SQLite connection, NOT a fake repo.

Diego's Wave 17 packaging adds a CI lint that grep-flags permissive stubs in `*.test.ts`:
- `loadCert: () => ok\(.*\)` — flag
- `applyPades: () => ok\(.*\)` — flag
- `requestTimestamp: () => ok\(.*\)` — flag
- Bare success-stub of any signature-engine top-level function — flag

### 9.4 Golden-bytes test pattern

Same as Phase 2 + Phase 3 golden-bytes pattern (`edit-replay-engine.md §14.3`, `form-engine.md §9.3`). The PAdES output is `pkcs7`-deterministic for the primary engine when signing the same input with the same cert + the same `signingTime`. Wave 16 tests pin a known timestamp via `signaturetime` injection AND a known nonce for the TSR; the resulting bytes are byte-identical across runs.

If `node-signpdf` updates and the output bytes change, the golden test alerts the team and they re-pin consciously.

---

## 10. Files this engine creates / extends (Wave 16 ownership)

| File | Status | Owner |
|---|---|---|
| `src/main/pdf-ops/signature-engine.ts` | NEW | David + Riley |
| `src/main/pdf-ops/signature-engine.test.ts` | NEW | David |
| `src/main/pdf-ops/visual-signature.ts` | NEW | David |
| `src/main/pdf-ops/visual-signature.test.ts` | NEW | David |
| `src/main/pdf-ops/pades-signature.ts` | NEW | David |
| `src/main/pdf-ops/pades-signature.test.ts` | NEW | David |
| `src/main/pdf-ops/pades-signature-manual.ts` | NEW | David |
| `src/main/pdf-ops/pades-signature-manual.test.ts` | NEW | David |
| `src/main/pdf-ops/tsa-client.ts` | NEW | David |
| `src/main/pdf-ops/tsa-client.test.ts` | NEW | David |
| `src/main/pdf-ops/signature-appearance.ts` | NEW | David |
| `src/main/pdf-ops/signature-appearance.test.ts` | NEW | David |
| `src/main/pdf-ops/cert-store.ts` | NEW | David |
| `src/main/pdf-ops/cert-store.test.ts` | NEW | David |
| `src/main/pdf-ops/annotations/square-annotation.ts` | NEW | David |
| `src/main/pdf-ops/annotations/circle-annotation.ts` | NEW | David |
| `src/main/pdf-ops/annotations/polygon-annotation.ts` | NEW | David |
| `src/main/pdf-ops/annotations/polyline-annotation.ts` | NEW | David |
| `src/main/pdf-ops/annotations/line-annotation.ts` | NEW | David |
| `src/main/pdf-ops/annotations/callout-annotation.ts` | NEW | David |
| `src/main/pdf-ops/annotations/measure-units.ts` | NEW | David |
| `src/main/pdf-ops/annotations/annotations.test.ts` | NEW | David |
| `src/main/pdf-ops/replay-engine.ts` | EDIT | David — adds step 3.7 + H-3.1 JS-strip move (§4.8 absorption) |
| `src/ipc/handlers/signatures-cert-load.ts` | NEW | David |
| `src/ipc/handlers/signatures-cert-release.ts` | NEW | David |
| `src/ipc/handlers/signatures-apply-visual.ts` | NEW | David |
| `src/ipc/handlers/signatures-apply-pades.ts` | NEW | David |
| `src/ipc/handlers/signatures-request-timestamp.ts` | NEW | David |
| `src/ipc/handlers/signatures-verify.ts` | NEW | David |
| `src/ipc/handlers/signatures-list-audit.ts` | NEW | David |
| `src/ipc/handlers/annotations-add-shape.ts` | NEW | David |
| `src/ipc/handlers/annotations-set-measure-calibration.ts` | NEW | David |
| `src/ipc/contracts.ts` | EDIT | David — new channel types per `api-contracts.md §14` |
| `src/ipc/register.ts` | EDIT | David |
| `src/main/pdf-ops/types/node-signpdf.d.ts` | NEW | David — type shim |
| `migrations/0004_phase4_signatures.sql` | NEW | Ravi |
| `src/db/repositories/signature-audit-repo.ts` | NEW | Ravi |
| `src/db/repositories/signature-audit-repo.test.ts` | NEW | Ravi |
| `src/db/types.ts` | EDIT | Ravi — `SignatureAuditRow` |
| `tests/fixtures/signature-engine/*.pdf` | NEW | David |
| `tests/fixtures/signature-engine/*.pfx` | NEW | David |
| `tests/fixtures/signature-engine/*.bin` | NEW | David |
| `src/client/components/modals/signature-capture-modal/**` | NEW | Riley |
| `src/client/components/modals/pades-sign-modal/**` | NEW | Riley |
| `src/client/components/signature-placement-overlay/**` | NEW | Riley |
| `src/client/components/annotation-tools/shape-tool.tsx` etc. | NEW | Riley |
| `src/client/components/annotation-summary-panel/**` | NEW | Riley |
| `src/client/components/signature-audit-panel/**` | NEW | Riley |
| `src/client/state/slices/signatures-slice.ts` | NEW | Riley |
| `src/client/state/slices/annotation-summary-slice.ts` | NEW | Riley |
| `src/client/state/slices/measure-calibration-slice.ts` | NEW | Riley |
| `src/client/state/thunks.ts` | EDIT | Riley |
| `src/client/hooks/use-signature-canvas.ts` | NEW | Riley |

Wave 16 implementation count: **~40 new files** (excluding tests) + ~6 edits. Test files roughly double the count. Aligns with phase-4-plan's "+80 tests" estimate.

---

## 11. Cross-reference checklist (Wave 15 self-verification)

- [x] Top-level orchestrator + per-engine path signatures (§2.1, §2.2)
- [x] Purity contract with TWO sanctioned side effects (§2.4)
- [x] PAdES library decision: node-signpdf primary, manual fallback shipped behind toggle (§3)
- [x] Byte-range arithmetic for primary + manual paths (§3.3)
- [x] CMS envelope structure (§3.4)
- [x] Cert + password lifecycle — full diagram + zeroing discipline + V8 honest write-up (§4)
- [x] Wave 17 Julian audit checklist with mechanical greps (§4.3)
- [x] Visual signature + appearance composition (§5)
- [x] Appearance layout deterministic + drop priority (§5.2)
- [x] R-W15-D placeholder / visual-signed / PAdES-signed distinguishing (§5.4)
- [x] RFC 3161 TSA client + failure modes (§6)
- [x] TSA Settings + test connection (§6.4)
- [x] Replay engine step 3.7 + ReplayError variants (§7)
- [x] Undo semantics for PAdES (§7.4)
- [x] Audit log insert + list + verify flows (§8)
- [x] Test strategy with fixture corpus (§9)
- [x] Permissive-stub anti-pattern guards (Wave 13.5 lesson absorbed) (§9.3)
- [x] File ownership map for Wave 16 (§10)
- [x] L-001 untouched — this doc does not weaken or reference `enableDragDropFiles`

End of signature-engine design.
