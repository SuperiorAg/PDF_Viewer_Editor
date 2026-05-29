# ARCHITECTURE — Phase 4 Additions (Visual + PAdES Signatures, Annotation Toolset Expansion)

**Author:** Riley (front-end-architect)
**Date:** 2026-05-26 (Wave 15)
**Status:** Phase 4 design, locked at end of Wave 15. Additions to Phase-1 `ARCHITECTURE.md`, Phase-2 `docs/architecture-phase-2.md`, and Phase-3 `docs/architecture-phase-3.md` (all three frozen per the P3-L-FREEZE rule recorded in `architecture-phase-3.md §13`, extended below).
**Scope:** Architectural deltas needed for Phase 4 features — visual signatures, PAdES (ETSI EN 319 142) cryptographic signatures, optional RFC 3161 timestamping, expanded annotation toolset, signature audit log.
**Reads:** `ARCHITECTURE.md` (full), `docs/architecture-phase-2.md` (full), `docs/architecture-phase-3.md` (full), `docs/edit-replay-engine.md`, `docs/form-engine.md`, `docs/phase-4-plan.md`, `docs/wave-15-brief.md`.

> **Companion document.** This file describes the system additions. The detailed
> design of the signature engine (cert + password lifecycle, byte-range
> arithmetic, appearance streams, TSA client, library decision) lives in
> [`docs/signature-engine.md`](signature-engine.md). Read both together.

---

## 0. Scope

Phase 4 lights up the **fill-sign-and-annotate** surface. Specifically:

1. **Visual signatures** — typed, drawn (canvas), or image-upload signatures placed onto a Phase-3 `/Sig` placeholder field OR a freeform position. Appearance-only; no cryptographic binding.
2. **PAdES cryptographic signatures** — ETSI EN 319 142 detached CMS signatures. User imports a PFX/P12 cert, supplies the password once per signing operation, and the engine computes a byte-range hash, signs it, and embeds the signature dict into the PDF. Cert + password live in memory ONLY for the signing operation and are zeroed in a `finally` block.
3. **Optional RFC 3161 timestamping (TSA)** — disabled by default. User configures a TSA URL in Settings; the signing engine wraps the CMS signature with a timestamp token when enabled.
4. **Date stamp, initials, check mark stamps** — one-click contract-paperwork affordances. Each is a thin wrapper over the existing FreeText / Ink / shape-annotation primitives — they ride the Phase 1/2 annotation infrastructure with no new wire types.
5. **Annotation toolset expansion** — rectangle, ellipse, polygon, arrow, callout, line-measure, polyline-measure. PDF subtypes `/Square`, `/Circle`, `/Polygon`, `/PolyLine`, `/FreeText` (callout flavor), `/Line` (with `/Measure` unit).
6. **Annotation summary view** — sidebar tab listing all annotations with page-jump.
7. **Signature audit log** — local SQLite table (schema v4) recording every signature this app has applied (signed-by-fingerprint, signed-at, doc-hash, signature-bytes-offset). "Show me what I signed and when."

Each section below describes the architectural delta. Phase 1/2/3 chapters that aren't amended remain authoritative.

---

## 1. Locked decisions encoded (Wave 15 self-check)

| ID         | Decision                                                                                                                                                                                                                             | Encoded where in this doc                                                        | Cross-ref                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| **P4-L-1** | Cert NEVER persisted. PFX bytes + password live in main-process memory for the signing op only; both zeroed in a `finally` block.                                                                                                    | §4.2 (cert/password lifecycle), §11 (L-001 cross-check + new convention §15)     | `signature-engine.md §4`                            |
| **P4-L-2** | TSA disabled by default. No default service. User-configured URL; validation on save attempt.                                                                                                                                        | §4.5 (TSA trust model + Settings), §10.4 (Settings additions)                    | `signature-engine.md §6`                            |
| **P4-L-3** | PAdES library: `node-signpdf` is the **recommended primary**, with `node-forge` + `pkijs` as the documented manual-ASN.1 fallback. Both MIT.                                                                                         | §3.1 (library inventory delta), §4.3 (engine pluggability)                       | `signature-engine.md §3`                            |
| **P4-L-4** | Signature appearance = standard PDF widget annotation with `AP` appearance stream showing typed name + drawn image + date + reason. Configurable per signature.                                                                      | §4.4 (appearance composition), `ui-spec.md` Phase-4 amendment §13.4 (sign modal) | `signature-engine.md §5`                            |
| **P4-L-5** | Annotation toolset scope = rectangle, ellipse, polygon, arrow, callout, line-measure, polyline-measure. Explicitly NOT layers, advanced fill patterns, or a full vector editor.                                                      | §5 (annotation toolset additions)                                                | `ui-spec.md` Phase-4 amendment §13.5                |
| **P4-L-6** | Schema v4 = `signature_audit_log` table with `signed_by_fingerprint`, `signed_at`, `doc_hash`, `sig_bytes_offset`, `sig_bytes_length`, etc.                                                                                          | §6 (schema v4)                                                                   | `data-models.md` Phase-4 amendment §9               |
| **P4-L-7** | Phase 4 fills the Phase-3 `/Sig` placeholder. Phase 3's form-engine §3.7 + architecture-phase-3.md §8 already author the placeholder; Phase 4 extends `FormFieldValue { type: 'signature' }` to carry a non-null `SignaturePayload`. | §8 (placeholder fill handoff), `data-models.md` Phase-4 amendment §9.2           | `form-engine.md §3.7`, `architecture-phase-3.md §8` |

**Cross-check against the Wave 11 placeholder design:** verified at `form-engine.md §3.7` (`createSignaturePlaceholder` writes `/FT /Sig` + widget with `/V` intentionally absent) and `architecture-phase-3.md §8` ("Phase 4 will fill the placeholder by computing a `/ByteRange` over the unsigned PDF bytes, embedding a PKCS#7 envelope in the `/V` entry, and writing an appearance stream"). The placeholder IS in place; no Wave 11.5 amendment to `form-engine.md` is required.

---

## 2. Process model deltas

### 2.1 No new processes, no new windows

Phase 4 adds **no new process** and **no new BrowserWindow**. Main, preload, renderer remain the three. The offscreen export window (Phase 1 §6.3, reused Phase 2) is NOT touched.

**L-001 cross-check:** `enableDragDropFiles: true` on the main BrowserWindow is untouched. Phase 4 introduces:

- Signature image / PFX file drag-drop into the sign modal — uses the SAME `File.path` Electron property as Phase 1 PDF drops, Phase 2 image drops, and Phase 3 CSV/Excel drops. L-001 is EXTENDED, not weakened.
- Cert picker — uses the existing `dialog.showOpenDialog` IPC channel pattern, no new BrowserWindow.
- TSA configuration — Settings dialog, no new window.

If a future Phase-4.1 design proposes a separate signing-progress window (e.g. for very long batch-sign jobs), the security-floor inheritance MUST be specified explicitly in that proposal: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, custom protocol if any, identical CSP. Phase 4 does NOT propose a new window — the modal-in-the-main-window pattern is sufficient.

### 2.2 Main-process module additions

```
src/main/pdf-ops/
  signature-engine.ts                  (NEW — see signature-engine.md §2 — orchestrator over the three engine paths)
  signature-engine.test.ts             (NEW)
  visual-signature.ts                  (NEW — see signature-engine.md §5 — typed/drawn/image appearance composition)
  visual-signature.test.ts             (NEW)
  pades-signature.ts                   (NEW — see signature-engine.md §3 — PAdES CMS via node-signpdf primary)
  pades-signature.test.ts              (NEW)
  pades-signature-manual.ts            (NEW — see signature-engine.md §3.5 — node-forge + pkijs fallback path; ships behind a build-time toggle)
  pades-signature-manual.test.ts       (NEW)
  tsa-client.ts                        (NEW — see signature-engine.md §6 — RFC 3161 over HTTPS)
  tsa-client.test.ts                   (NEW)
  signature-appearance.ts              (NEW — see signature-engine.md §5 — PDF appearance stream authorship; reuses field-dict-authoring pattern)
  signature-appearance.test.ts         (NEW)
  cert-store.ts                        (NEW — see signature-engine.md §4 — in-memory cert handle; STRICT no-persist + zeroing)
  cert-store.test.ts                   (NEW)

src/main/pdf-ops/annotations/          (NEW subdirectory — annotation-subtype authorship modules)
  square-annotation.ts                 (NEW)
  circle-annotation.ts                 (NEW)
  polygon-annotation.ts                (NEW)
  polyline-annotation.ts               (NEW — also handles polyline-measure)
  line-annotation.ts                   (NEW — also handles line-measure)
  callout-annotation.ts                (NEW — /FreeText with /CL callout-line + /IT FreeTextCallout)
  measure-units.ts                     (NEW — /Measure dict authorship; calibration math)
  annotations.test.ts                  (NEW — one file covering the additions; per-subtype describe blocks)

src/ipc/handlers/
  signatures-apply-visual.ts           (NEW)
  signatures-apply-pades.ts            (NEW)
  signatures-request-timestamp.ts      (NEW)
  signatures-verify.ts                 (NEW — verifies signatures applied BY this app; reads signature_audit_log)
  signatures-list-audit.ts             (NEW — UI for audit log)
  signatures-cert-load.ts              (NEW — PFX picker; returns an opaque cert-handle valid only for the next sign call)
  signatures-cert-release.ts           (NEW — explicit zero+release; renderer fires on modal close)
  annotations-add-shape.ts             (NEW — unified handler for square/circle/polygon/line/callout/polyline)
  annotations-set-measure-calibration.ts (NEW — per-document calibration)
```

### 2.3 Renderer-process additions

```
src/client/components/
  modals/signature-capture-modal/      (NEW — tabs: Typed / Drawn / Image)
    index.tsx
    typed-tab.tsx
    drawn-tab.tsx                       (HTML5 canvas + smoothing)
    image-tab.tsx                       (file picker + drag-drop)
    signature-capture-modal.module.css
    signature-capture-modal.test.tsx
  modals/pades-sign-modal/             (NEW — PFX picker + password + reason + location + TSA toggle)
    index.tsx
    cert-loader-step.tsx                (file picker + password)
    sign-options-step.tsx               (reason / location / TSA / appearance)
    confirm-and-sign-step.tsx           (preview + go button)
    pades-sign-modal.module.css
    pades-sign-modal.test.tsx
  signature-placement-overlay/         (NEW — drag/resize/rotate; SHARED with image-overlay component per the question H decision below)
    index.tsx
    placement-handle.tsx
    signature-placement-overlay.module.css
    signature-placement-overlay.test.tsx
  annotation-tools/                    (EXPAND — Phase 1+2 had Highlight, Sticky, Text, Underline, Strikethrough, Freehand. Phase 4 adds the 7 shape/measure tools.)
    shape-tool.tsx                      (rectangle, ellipse, polygon, line, arrow shared component with subtype prop)
    callout-tool.tsx
    measure-tool.tsx                    (line-measure + polyline-measure)
    measure-calibration-modal.tsx
  annotation-summary-panel/            (NEW — sidebar tab; lists all annotations with page jump)
    index.tsx
    annotation-summary-panel.module.css
    annotation-summary-panel.test.tsx
  signature-audit-panel/               (NEW — Tools menu → "What have I signed?" → modal listing audit log entries)
    index.tsx
    signature-audit-panel.module.css

src/client/state/
  slices/signatures-slice.ts           (NEW — capture state, placement state, in-flight sign operation state)
  slices/signatures-selectors.ts       (NEW)
  slices/annotation-summary-slice.ts   (NEW — selectors over the existing annotations + new shape ops)
  slices/measure-calibration-slice.ts  (NEW — per-document calibration state)
  thunks.ts                            (EDIT — new thunks: captureSignatureThunk, placeSignatureThunk,
                                                applyVisualSignatureThunk, applyPadesSignatureThunk,
                                                loadCertThunk, releaseCertThunk,
                                                addShapeAnnotationThunk, setMeasureCalibrationThunk,
                                                listSignatureAuditThunk, verifySignatureThunk)
src/client/hooks/
  use-app-shortcuts.ts                 (EDIT — wire shape-tool shortcuts per ui-spec.md Phase-4 amendment §13.3)
  use-signature-canvas.ts              (NEW — drawn-tab smoothing + pressure handling, where available)
```

### 2.4 Boundary discipline (extends Phase 1/2/3)

Conventions §10 (`renderer never holds Uint8Array of document bytes`) still holds. Phase 4 strengthens with TWO new corollaries, baked into the new conventions §15 amendment:

1. **Cert bytes flow renderer → main, NEVER persisted, NEVER echoed back.** The renderer picks a PFX file and ships the bytes to main via `signatures:certLoad`. Main returns an opaque `CertHandle: string` (UUID) that is valid only for the next `signatures:applyPades` call. The renderer never sees cert bytes again. On modal close, the renderer fires `signatures:certRelease` to force immediate zeroing.

2. **Password bytes flow renderer → main, NEVER persisted, NEVER echoed.** Same channel as `certLoad`. The password is a property of `CertLoadRequest`; main keeps it in a `Buffer` (NOT a JS string — see §4.2.3 below), uses it to decrypt the PFX once, then `buffer.fill(0)`s it BEFORE the cert load function returns. The renderer's password input is `<input type="password">`; after dispatch, the React state is overwritten to `''` (renderer-side hygiene) and the renderer never re-reads it.

These two corollaries are equally important as the existing `no Uint8Array in renderer` rule. They get their own conventions §15 with anti-patterns and Wave 17 Julian-audit-bait.

### 2.5 IPC surface growth

11 new channels (full spec in `api-contracts.md §14`):

| Channel                             | Purpose                                                                                                                                                                                                                           | Stream events?                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `signatures:certLoad`               | Load a PFX file + password into main memory; return opaque `CertHandle`. Cert bytes + password are zeroed before this call returns (only the parsed-but-encrypted bytes + private-key handle stay in memory keyed by the handle). | no                                  |
| `signatures:certRelease`            | Explicitly zero + release a `CertHandle`. Idempotent.                                                                                                                                                                             | no                                  |
| `signatures:applyVisual`            | Apply a visual signature (typed/drawn/image) to a placeholder field OR freeform position. Returns the `EditOperation` to push to dirtyOps.                                                                                        | no                                  |
| `signatures:applyPades`             | Apply a PAdES cryptographic signature. Long-running (TSA hop if enabled). Returns the signed bytes path + the `EditOperation` (kind: `pades-signed`) + audit log row.                                                             | no (synchronous; TSA timeout ≤ 30s) |
| `signatures:requestTimestamp`       | Standalone TSA request (used by `applyPades` internally; also exposed for "test TSA URL" Settings affordance).                                                                                                                    | no                                  |
| `signatures:verify`                 | Verify a signature applied by THIS app (reads `signature_audit_log` and re-hashes the doc bytes). NOT a third-party signature verifier.                                                                                           | no                                  |
| `signatures:listAudit`              | List rows from `signature_audit_log` (optionally filtered by file hash).                                                                                                                                                          | no                                  |
| `annotations:addShape`              | Author a shape / line / callout / measure annotation. Returns the `EditOperation` (kind: `annot-add` with one of the new subtypes).                                                                                               | no                                  |
| `annotations:setMeasureCalibration` | Persist a per-document calibration (e.g. "120 pixels on screen = 1 inch in the printed drawing").                                                                                                                                 | no                                  |
| `annotations:getMeasureCalibration` | Read the per-document calibration.                                                                                                                                                                                                | no                                  |

Plus zero new event streams (all Phase 4 IPC is synchronous-with-timeout; no progress streaming needed). The Phase 1/2/3 surface (`api-contracts.md §1-§13`) remains FROZEN. No existing channel's contract changes.

### 2.6 Zod validation discipline (extends conventions §0.1)

Every Phase 4 IPC handler validates payload with **zod**. Two Phase 4-specific schemas need extra care:

1. `CertLoadRequest.password` — type `string` at the zod layer, BUT the handler immediately wraps it in `Buffer.from(password, 'utf-8')` and overwrites the schema-validated string by setting the local var to `'' as const` after the wrap. The handler never logs, never echoes back. See `signature-engine.md §4.2` for the full discipline.

2. `ApplyPadesRequest.tsaUrl` — `string.url().https()` validation; the handler additionally checks against a small ALLOWLIST of well-formed TSA URL shapes (no `userinfo`, no `query` beyond a small set, no `fragment`), then attempts the actual request. Validation-by-attempt is the trust model — see §4.5.

The `zod` dependency is already in the project (Phase 1+); no new dep.

---

## 3. Library inventory deltas

### 3.1 New runtime dependencies

| Library        | Version                           | License                                            | Process | Purpose                                                                                                                                                                                                                                                                                                                                |
| -------------- | --------------------------------- | -------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-signpdf` | 3.x (current at Wave 15 dispatch) | MIT                                                | Main    | Primary PAdES library. Handles byte-range placeholder, hash, CMS sign, embed. Built on top of `node-forge`. **Recommended primary** — see `signature-engine.md §3.2` for the rationale.                                                                                                                                                |
| `node-forge`   | 1.3.x                             | (BSD-3-Clause OR GPL-2.0); we exercise the BSD arm | Main    | PKCS#7 / CMS / X.509 / PFX parsing + signing primitives. Already a transitive dep of `node-signpdf`; pinned directly so the fallback path (manual ASN.1) can use it without version skew.                                                                                                                                              |
| `pkijs`        | 3.x                               | MIT                                                | Main    | Higher-level ASN.1 + PKI helpers; used ONLY in the manual fallback path (`pades-signature-manual.ts`). Ships in the bundle so the fallback is available without a follow-up install; ESLint `no-restricted-imports` keeps it out of the primary path. Build-time toggle `PADES_ENGINE=manual` selects it; default toggle is `signpdf`. |
| `asn1js`       | 3.x                               | BSD-3-Clause                                       | Main    | Transitive of `pkijs`. Pinned for the same fallback reason.                                                                                                                                                                                                                                                                            |

**License verification (Wave 15, against npm registry 2026-05-26):**

- `node-signpdf` → `npm view node-signpdf license` → `MIT` ✓
- `node-forge` → `npm view node-forge license` → `(BSD-3-Clause OR GPL-2.0)` ✓ — we exercise the BSD arm explicitly, documented in `LICENSES.md` permissive-dual-licensed block per the existing pattern (jszip's MIT-OR-GPL3 precedent from Wave 13)
- `pkijs` → `npm view pkijs license` → `MIT` ✓
- `asn1js` → `npm view asn1js license` → `BSD-3-Clause` ✓

All four are PERMISSIVE. None are AGPL. None are commercial. Compliant with project policy.

**Diego's Wave 17 packaging note:** the transitive subtree from `node-signpdf` brings ~30 additional packages (mostly small crypto utilities). Per the Wave 13 lesson (dev-ops global JSONL entry, 2026-05-22), allocate license-walk budget for the full subtree and surface UNKNOWN entries in LICENSES.md follow-ups.

**Explicitly NOT added (locked decision P4-L-1 / scope):**

- PDFTron / Apryse signing SDK (commercial)
- Foxit signing SDK (commercial)
- Adobe Sign API (cloud service; out-of-scope)
- iText / iText 7 PAdES (AGPL or commercial dual-license — license-policy fail)
- `@types/node-signpdf` (no published types as of 2026-05-26; David authors a small `.d.ts` shim in `src/main/pdf-ops/types/node-signpdf.d.ts` per the Wave 13 dynamic-import pattern)

### 3.2 Existing libraries — extended use

| Library          | New Phase 4 use                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdf-lib`        | Continues to author annotation dicts via the existing `field-dict-authoring`-style pattern for the 7 new annotation subtypes. Also used to compute the page-content offset where `signature-engine.ts` will inject the signature dict (the dict itself is authored by hand because pdf-lib has no `addSignature` helper). |
| `better-sqlite3` | Schema v4 migration `0004_phase4_signatures.sql` adds `signature_audit_log` table. See §6 + `data-models.md §9`.                                                                                                                                                                                                          |
| `zod`            | New schemas for 11 IPC channels in §2.5; the `CertLoadRequest` schema has the password-discipline pattern documented in §2.6.                                                                                                                                                                                             |

### 3.3 Phase 5+ libraries (NOT added in Phase 4)

| Library                                   | Phase | Purpose                                                   |
| ----------------------------------------- | ----- | --------------------------------------------------------- |
| `tesseract.js`                            | 5     | OCR (was Phase 5 already)                                 |
| `docx` / `pptxgenjs` / `exceljs`-extended | 6     | Office export (exceljs already pulled forward to Phase 3) |
| Twain / WIA bindings                      | 5     | Scanner integration                                       |

---

## 4. Signature engine — high-level architecture

> Detailed design in [`docs/signature-engine.md`](signature-engine.md). This section
> describes the SHAPE of the engine and its integration points with the rest
> of the system.

### 4.1 Three engine paths

The signature engine is a **discriminated dispatch** over three paths:

```
                     ┌──────────────────────────┐
   sign request ──→  │ signature-engine.ts      │  ──→ EditOperation (renderer)
                     │ (orchestrator)           │  ──→ signed bytes (main)
                     └──────────┬───────────────┘      ──→ audit log row (SQLite)
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
        ┌──────────┐     ┌────────────┐     ┌──────────────┐
        │ Visual   │     │ PAdES      │     │ PAdES Manual │
        │ (P1+P2   │     │ (signpdf)  │     │ (forge+pkijs)│
        │ infra    │     │ DEFAULT    │     │ FALLBACK     │
        │ reuse)   │     │            │     │ (build flag) │
        └──────────┘     └────────────┘     └──────────────┘
```

- **Visual** — `visual-signature.ts`. Composes an appearance image (typed name → text-to-glyph, drawn → PNG bytes from canvas, image → user-supplied PNG/JPEG). Embeds via the existing image-overlay pdf-lib path. No crypto. Output is a regular EditOperation (kind: `signature-visual-place`).
- **PAdES (signpdf, default)** — `pades-signature.ts`. Uses `node-signpdf` for the byte-range + CMS + embed. Optional TSA hop via `tsa-client.ts` before the CMS finalize.
- **PAdES (manual, fallback)** — `pades-signature-manual.ts`. Uses `node-forge` + `pkijs` to build the CMS envelope manually + author the byte-range + embed via hand-edited pdf-lib bytes. Same external contract as the primary path. Selected via build-time env `PADES_ENGINE=manual` OR runtime Settings (Phase 4.1) for users who hit a node-signpdf bug.

The orchestrator's signature is:

```ts
export async function applySignature(input: ApplySignatureInput): Promise<ApplySignatureResult>;

type ApplySignatureInput =
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
    };
```

### 4.2 Cert + password lifecycle (the CRITICAL risk per P4-L-1)

The full lifecycle is documented at `signature-engine.md §4`. Summary table:

| Phase                                  | Lives in                                                                                  | Lifecycle                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. User picks PFX file in renderer     | `File` object (browser-level)                                                             | Renderer reads bytes via `FileReader.readAsArrayBuffer`; immediately ships to main via IPC. Renderer's `ArrayBuffer` reference is dropped (set the `file` state to `null` after dispatch).                                                                                                                                                                                                                                                                                              |
| 2. Password collected                  | React state in `<input type="password">`                                                  | Renderer dispatches `certLoad({ pfxBytes, password })`; the React state holding the password is set to `''` BEFORE awaiting the IPC promise (so even if the IPC takes a network hop, the renderer doesn't hold it).                                                                                                                                                                                                                                                                     |
| 3. Main receives                       | Buffer (`pfxBytes`) + Buffer (`password`)                                                 | `signatures:certLoad` handler converts the JS string to a `Buffer` via `Buffer.from(password, 'utf-8')`, then sets the local string var to `''`. **The password as a JS string lives for fewer than 10 lines of synchronous handler code.**                                                                                                                                                                                                                                             |
| 4. Cert parsed                         | `forge.pkcs12.pkcs12FromAsn1(...)` produces a parsed structure containing the private key | The pfx Buffer is `pfx.fill(0)`'d AFTER the parse succeeds. The password Buffer is `password.fill(0)`'d in the SAME synchronous block. Both happen BEFORE the function returns the cert handle to the IPC layer.                                                                                                                                                                                                                                                                        |
| 5. Cert stored under handle            | `Map<CertHandle, ParsedCertEntry>` in `cert-store.ts`                                     | `ParsedCertEntry` has `{ x509: forge.pki.Certificate; privateKeyPem: string; fingerprint: string; loadedAt: number }`. The PEM is encrypted-at-rest? **No** — it lives in process memory; we accept the V8 heap is in-memory secret as the security floor. The user's threat model is "an attacker who can read process memory while the modal is open"; defending past that requires HSM / OS-keychain integration which Phase 4 explicitly defers. The PEM is overwritten on release. |
| 6. Sign operation uses cert handle     | `signatures:applyPades({ certHandle, ... })`                                              | Handler reads from the store map by handle; never accepts cert bytes again.                                                                                                                                                                                                                                                                                                                                                                                                             |
| 7. After sign succeeds OR modal closes | `cert-store.releaseHandle(handle)`                                                        | Zeroes the PEM string (overwrites the `privateKeyPem` field with `''.padStart(originalLength, '\0')`), zeroes the fingerprint, deletes the map entry, then suggests a `gc()` if `--expose-gc` is set (dev-only; production silently relies on V8's eventual collection).                                                                                                                                                                                                                |
| 8. Modal force-close (Esc / X)         | Same as step 7 via `signatures:certRelease` IPC                                           | Renderer's modal `useEffect` cleanup fires `releaseCertThunk(handle)` so the cert doesn't survive the modal.                                                                                                                                                                                                                                                                                                                                                                            |

**Try/finally discipline:** the `applyPades` handler wraps the entire sign sequence in a `try { ... } finally { releaseHandle(certHandle) }` if `autoRelease: true` is set in the request (default `true` for the single-shot flow; renderer can pass `false` if it wants to sign multiple times with the same cert in one modal session, but the modal cleanup STILL fires releaseHandle on dismiss).

**What V8 makes hard:**

- JS strings are immutable; `password.fill(0)` is not directly possible on a string. That's why step 3 converts to Buffer at the EARLIEST opportunity and lets the original string fall out of scope. The string CAN linger in V8's heap until next collection — we accept this 1-2 second window as the security floor.
- V8 may intern short strings; we don't rely on `password.padStart(n, '\0')` patching the underlying memory. The Buffer wrapping is the load-bearing mechanism.

**Wave 17 Julian audit checklist (this section):**

- [ ] Every reference to `password` as a string in `cert-store.ts` is shorter than 5 lines of synchronous code from input to Buffer-wrap.
- [ ] Every reference to `pfx` as a Buffer is `.fill(0)`-ed in a `finally` block of the parse function.
- [ ] No console.log / log.info / log.debug / log.error contains `password`, `pfx`, `cert.privateKey*`, or `privateKeyPem` substrings. ESLint custom rule candidate.
- [ ] `signatures:certLoad`'s IPC log entry contains channel + duration + ok/error ONLY, no payload reflection (per conventions §9).
- [ ] The Map of cert handles is reset on app quit (`app.on('before-quit', () => certStore.releaseAll())`).
- [ ] No file in `src/main/pdf-ops/` writes a PFX or PEM to disk. Audit via grep for `writeFile.*\.pfx|\.p12|\.pem|privateKey`.

### 4.3 Engine pluggability — primary vs fallback

Locked decision P4-L-3: `node-signpdf` is the recommended primary. Rationale documented in `signature-engine.md §3.2`:

| Concern                          | `node-signpdf` (primary)                                                          | `node-forge` + `pkijs` (manual fallback)                     |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Lines of code (David's estimate) | ~200 LOC engine                                                                   | ~600 LOC engine                                              |
| Byte-range arithmetic            | Handled internally with a known-good algorithm                                    | Hand-rolled; we'd own the off-by-one risk                    |
| Maintenance                      | Active GitHub repo (last commit 2025); 1.4k stars; multiple known bugs all closed | node-forge active; pkijs active; we'd combine them ourselves |
| RFC 3161 timestamping            | NOT built-in; we write `tsa-client.ts` regardless of primary or fallback          | Same — we write the TSA hook ourselves                       |
| Multi-signature workflows        | Supported (incremental update pattern)                                            | Same machinery; we'd implement                               |
| Custom appearance streams        | Pass-through; we author the appearance OURSELVES and signpdf embeds               | Pass-through; same                                           |
| Acrobat Reader DC verification   | Verified by external testers in node-signpdf's CI                                 | Would have to verify ourselves                               |
| **Verdict**                      | **Primary** — less code, known-good, faster Wave 16 ship                          | Fallback — full control, defensive option                    |

**Ship strategy:** primary path is wired by default; fallback is BEHIND a build-time toggle and a runtime Settings switch (Phase 4.1 if user demand). Both engines satisfy the SAME external contract (`applySignature(input) → result`).

**Why ship the fallback if we don't use it by default:** the project's license policy + downstream auditability requires we own the second path. If `node-signpdf` ships a regression OR a license-incompatible dep (unlikely; MIT) lands in a transitive, we flip the toggle and continue without a rewrite. The cost is ~600 LOC + ~30 tests in Wave 16; Diego's packaging absorbs both libs anyway (pkijs is small).

### 4.4 Signature appearance composition (P4-L-4)

The PDF widget annotation that visually represents the signature has an `AP` (appearance) dictionary. Phase 4 authors ONE appearance stream — the `N` (normal) — and skips `R` (rollover) + `D` (down) for scope discipline. The N stream is a small PDF graphics block containing:

```
+-----------------------------------+
|  [User's typed name OR drawn img  |
|   OR uploaded image — 1 of 3]     |
|                                   |
|  Signed by: <subject CN from cert>|
|  Date: 2026-05-26 14:32:08 UTC    |
|  Reason: <user's optional reason> |
+-----------------------------------+
```

User controls per-signature (in the sign modal):

- Whether to show the typed name (default yes if Typed tab)
- Whether to show the drawn glyph (default yes if Drawn tab)
- Whether to show the date (default yes; Settings can change default)
- Whether to show the reason (default no unless reason is non-empty)
- Whether to show the subject CN (default yes for PAdES; visual signatures have no cert so this row is hidden)

Visual layout: a `signature-appearance.ts` module composes the stream using pdf-lib's graphics primitives (`drawText`, `drawRectangle`, `drawImage`). The Y-axis is PDF user-space (origin bottom-left). The appearance fits the widget rect; if the rect is too small to fit all selected rows, rows are dropped in this priority order: reason (lowest) → date → CN → name/glyph (highest).

Implementation detail in `signature-engine.md §5`.

### 4.5 TSA URL trust model (P4-L-2)

**Default state:** TSA disabled. The Settings dialog ships with the `signatures.tsaUrl` field empty AND `signatures.tsaEnabled = false`. A user who wants timestamping must explicitly configure both.

**Validation:**

- At Save in Settings: zod validates URL shape (https, no userinfo, no fragment, no query beyond a small set). Renderer offers a **"Test TSA URL"** button that fires `signatures:requestTimestamp` with a known small payload; on success, the button turns green and the URL is acceptable.
- At sign time: if `tsaUrl` is configured AND `tsaEnabled` is true, the engine attempts the TSA hop. Failure modes:
  - HTTP error (4xx/5xx) — `tsa_http_error` — Sign FAILS with a specific error; user can disable TSA and re-sign.
  - TLS error — `tsa_tls_error` — Sign FAILS; same recovery.
  - Malformed TSR response — `tsa_invalid_response` — Sign FAILS.
  - Timeout (30s default; configurable as `signatures.tsaTimeoutMs`) — `tsa_timeout` — Sign FAILS.

**Why fail-loud instead of "fall back to no TSA":** if the user has TSA enabled in their settings, they have a reason — usually a compliance or audit requirement. Silently degrading to an untimestamped signature would violate trust. The user can explicitly re-sign without TSA if they choose.

**Documented acceptable TSA URLs:** RFC 3161-compliant time-stamp services, HTTPS only, user-provided. Examples documented in user-guide (Wave 18 Nathan): FreeTSA, DigiCert TSA (paid), GlobalSign TSA (paid), Sectigo TSA (paid). We do NOT ship example URLs in the Settings UI — the user must paste their own. This avoids any T&C entanglement with a third-party TSA service.

**Trust scope:** the TSA's certificate is trusted via the SYSTEM trust store at HTTPS-handshake time (Node.js default). We do NOT ship a custom trust list. If the user's TSA requires a custom CA, they install it at the OS level. Phase 4 does NOT ship custom CA management — that's a future Phase 4.5+.

### 4.6 EditOperation integration

Phase 4 adds FIVE new `EditOperation` variants (full list in `data-models.md` Phase-4 amendment §9.3):

```ts
// Phase 4 additions to the EditOperation union — append-only

type EditOperation =
  // ...Phase 1 + 2 + 3 variants...

  | {
      kind: 'signature-visual-place';
      meta: EditMeta;
      placement: SignaturePlacement; // see signature-engine.md §2.3
      appearance: VisualAppearanceSpec; // image bytes via the existing image-overlay path
      placeholderFieldName: string | null; // non-null when placing onto a Phase-3 /Sig field
    }
  | {
      kind: 'signature-pades-applied';
      meta: EditMeta;
      placement: SignaturePlacement;
      certFingerprint: string; // not the cert itself!
      signerSubjectCN: string;
      signedAt: number; // ms epoch from the engine
      tsaUrl: string | null;
      auditLogRowId: number; // SQLite row id from signature_audit_log
      placeholderFieldName: string | null;
    }
  | {
      kind: 'annot-add-shape';
      meta: EditMeta;
      annotation: ShapeAnnotationModel; // subtype = Square | Circle | Polygon | PolyLine | Line | FreeText (callout flavor)
    }
  | {
      kind: 'annot-edit-shape';
      meta: EditMeta;
      id: string;
      before: Partial<ShapeAnnotationModel>;
      after: Partial<ShapeAnnotationModel>;
    }
  | { kind: 'annot-delete-shape'; meta: EditMeta; before: ShapeAnnotationModel };
```

The shape ops are intentionally NEW variants (not extensions of the Phase 1 `annot-*` ops) because the shape annotations carry additional fields (`borderWidth`, `borderStyle`, `points`, `measureCalibration`) that the Phase 1 `AnnotationModel` doesn't have. The shape inverse table (`data-models.md §9.3.1`) mirrors the Phase 1 pattern.

**The `signature-pades-applied` op is special** — it carries the audit log row id as a hard reference. Undo of a PAdES signature is conceptually weird: the signed bytes ARE the document; reversing them produces an unsigned doc but invalidates any external verifier's trust chain. The Wave 16 implementation:

- Undo of `signature-pades-applied` immediately preceding a Save is supported (the user hasn't committed; rolling back removes the signature widget + clears the audit row).
- Undo AFTER the bytes are on disk (next Save replaces the on-disk file with the unsigned bytes) is supported BUT shows a confirmation modal: "Undoing a PAdES signature removes the signature; external verifiers will no longer trust the previous signed file. Continue?"

Refer to `signature-engine.md §7.4` for the full undo semantics.

### 4.7 Replay-engine integration

The `replay()` function (`edit-replay-engine.md §3`, extended Phase 3 with step 3.6) is extended Phase 4 with step **3.7** between 3.6 (form ops) and step 4 (emit annots):

```
3.7 applySignatureOps:
    const sigOps = ops.filter(op => isSignatureOp(op))
    if (sigOps.length === 0) yield to 3.8
    for op of sigOps where op.kind === 'signature-visual-place':
      // delegate to visual-signature.ts; appearance composition + image embed
      applyVisualSignature(doc, ctx, op)
    for op of sigOps where op.kind === 'signature-pades-applied':
      // The PAdES sign is NOT replayed at save time — it was already
      // applied at sign time. Instead, the bytes the renderer holds
      // include the signature widget; the engine just embeds the widget's
      // visual-only twin (the appearance stream) and trusts the
      // certificate-bound widget exists in the source bytes.
      assertSignatureWidgetPresent(doc, op.placeholderFieldName ?? op.placement.fieldName)
    yield progress { phase: 'pdflib-applying-signatures', percent: 65-70% }

3.8 applyShapeAndCalloutOps:
    // The new annotation subtypes ride the existing emitAnnots pipeline at step 4.
    // 3.8 only handles the optional measure-calibration recompute when calibration changed mid-session.
    if (anyMeasureCalibrationChange(ops)):
      recomputeMeasureAnnotations(doc, ctx)
```

The shape annotations themselves are emitted by the regular `step 4: emitAnnots` (Phase 1 / Phase 2 pipeline) — each new subtype gets a `case` branch in `emit-annotations.ts` (David's Wave 16 work). The pipeline already handles the Square/Circle/Line subtypes that Phase 1's `data-models.md §3.4` table flagged as "Phase 4 — Native pdf-lib support"; Wave 16 just unblocks the toolbar buttons and adds polygon/polyline/callout.

**One new `ReplayError` variant** (`signature-engine.md §7`):

- `'signature_widget_missing'` — Phase 4 `pades-signed` op refers to a placeholder field that's no longer in the document (e.g. removed via undo of `form-design-remove`). Replay aborts; user is shown a recovery toast.

The existing `op_apply_failed` covers everything else.

### 4.8 H-3.1 residual (M-13.5-1) — absorbed in Phase 4

Per Julian's Wave 13.5 re-audit (`code-review.md` line ~967), the `stripDocLevelJavaScript` call at `replay-engine.ts:343` is still gated inside `if (formOps.length > 0)`. Phase 4 absorbs the 2-line fix:

- Move the `stripDocLevelJavaScript(doc)` call to a step between `3.5 drawOverlays` and `3.6 applyFormOps` so EVERY save path strips (annotation-only, image-only, text-replace-only, AND form-related).
- The strip is idempotent, so the double-call when both formOps and the new global strip fire is a no-op.
- The change lives in `replay-engine.ts` (David's file). Wave 16 implementer (David) absorbs it as a touched-file change.
- Wave 17 Julian re-verifies that M-13.5-1 closes.

Rationale: Phase 4's signing surface is a natural place to harden the global JS-strip pass because a signed PDF carrying JavaScript is exactly the kind of compound attack-surface that downstream verifiers would flag. The fix has the H-3.1 lineage (Wave 13 → Wave 13.5 → Phase 4 absorb-as-touched).

---

## 5. Annotation toolset expansion (P4-L-5)

Phase 4 adds SEVEN new annotation tools. Each maps to an existing ISO 32000 subtype:

| Tool             | PDF subtype                                                       | Notes                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rectangle        | `/Square`                                                         | pdf-lib native support (Phase 1 `data-models.md §3.4` table flagged Phase 4)                                                                                |
| Ellipse / Circle | `/Circle`                                                         | Same as Square                                                                                                                                              |
| Polygon          | `/Polygon`                                                        | `Vertices` array of [x, y, x, y, ...]; pdf-lib does NOT have a native helper — manual dict via the existing `annotations.ts` pattern (David's Phase 2 file) |
| Arrow            | `/Line` with `/LE [ Square ButtArrow ]` line-ending styles        | Same as Line                                                                                                                                                |
| Callout          | `/FreeText` with `/IT FreeTextCallout` + `/CL` callout-line array | Extends Phase 1 FreeText pattern                                                                                                                            |
| Line-measure     | `/Line` with `/Measure` dict                                      | pdf-lib has the line helper; measure dict is hand-authored                                                                                                  |
| Polyline-measure | `/PolyLine` with `/Measure` dict                                  | Same pattern as polygon; manual dict                                                                                                                        |

**Toolbar grouping:** the existing annotation toolbar group (Phase 1: H/S/T; Phase 2: U/K/F) gets a new "Shapes" submenu with the 7 tools. The shape toolbar group activates a tool, then a click-drag on the canvas creates the annotation. Calibration is a separate Tools menu item (one calibration per document; stored in `measure_calibration` per-handle in main memory + serialized into the PDF's `/Measure` dict on save).

**Properties pane (Inspector) — new fields:**

| Field           | Tools                                           | Type                                                                |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Border weight   | rect/circle/polygon/line/arrow/callout/polyline | number, 0.25..10 pt                                                 |
| Border style    | rect/circle/polygon/line/arrow/callout/polyline | solid / dashed / dotted (PDF `/BS /S` values D/D/D with `/D` array) |
| Fill color      | rect/circle/polygon                             | RgbColor + opacity                                                  |
| Fill enabled    | rect/circle/polygon                             | bool                                                                |
| Line end style  | line/arrow                                      | start + end picks from Butt/OpenArrow/ClosedArrow/None              |
| Measure unit    | line-measure / polyline-measure                 | `'inch' \| 'cm' \| 'mm' \| 'pt' \| 'px' \| 'custom'`                |
| Measure scale   | line-measure / polyline-measure                 | number; "1 page-unit = N <unit>"                                    |
| Callout text    | callout                                         | string (multi-line)                                                 |
| Callout pointer | callout                                         | screen-point of the callout arrow tip (PDF user-space)              |

**Annotation summary panel** (sidebar tab — new in Phase 4):

```
Annotations
┌────────────────────────────────────────┐
│ Filters: [ ] Highlights  [ ] Sticky    │
│          [ ] Text  [ ] Shape  [ ] Sig  │
├────────────────────────────────────────┤
│ Page 1                                  │
│  ⬛ Square — "Important section"  →     │
│  💬 FreeText — "Approved"         →     │
│ Page 4                                  │
│  ✏ Ink — drawn signature glyph    →     │
│  ⬛ Square — region 1              →     │
│ Page 7                                  │
│  📍 Signature widget (PAdES)        →    │
│      Signed by John Smith               │
│      2026-05-26 14:32:08 UTC            │
└────────────────────────────────────────┘
```

Each row is clickable → scrolls viewer to that annotation + selects it. Filters are checkboxes at the top. Sort orders: by page (default), by created-at, by author.

The summary panel reuses the Phase 1 `annotations-slice.ts` data; no new state needed beyond a small `annotation-summary-slice.ts` for the filter/sort state.

**Annotation export (Phase 4)**: a "Export annotations…" button in the panel exports a CSV of `[page, subtype, contents, author, createdAt, x, y, width, height]`. Useful for review workflows. The CSV writer is a tiny module — reuses the existing `csv-parse` (Phase 3) author functions inverted.

---

## 6. Schema additions (P4-L-6)

### 6.1 New table — `signature_audit_log`

Full DDL in `data-models.md` Phase-4 amendment §9.4. Summary:

```sql
CREATE TABLE signature_audit_log (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_hash                 TEXT NOT NULL,            -- SHA-256 of the SIGNED bytes (post-signing)
  pre_sign_doc_hash        TEXT NOT NULL,            -- SHA-256 of the bytes the engine signed (i.e. the byte-range hash input)
  signed_at                INTEGER NOT NULL,         -- ms epoch
  signature_kind           TEXT NOT NULL,            -- 'visual' | 'pades' | 'pades-tsa'
  signed_by_fingerprint    TEXT,                     -- SHA-256 fingerprint of the cert; NULL for visual
  signed_by_subject_cn     TEXT,                     -- subject CN extracted for display; NULL for visual
  signed_by_issuer_cn      TEXT,                     -- issuer CN for display; NULL for visual
  cert_not_before          INTEGER,                  -- ms epoch, from cert.tbsCertificate.validity.notBefore
  cert_not_after           INTEGER,                  -- ms epoch
  tsa_url                  TEXT,                     -- the configured TSA URL at sign time; NULL if no TSA
  tsa_response_status      TEXT,                     -- 'ok' | 'failed' | NULL
  sig_bytes_offset         INTEGER,                  -- byte offset of /Contents in the SIGNED bytes
  sig_bytes_length         INTEGER,                  -- byte length of /Contents
  byte_range_json          TEXT,                     -- JSON-encoded byte-range array [a, b, c, d]
  reason                   TEXT,                     -- user-supplied
  location                 TEXT,                     -- user-supplied
  field_name               TEXT,                     -- placeholder field name OR null for freeform
  created_at               INTEGER NOT NULL,
  UNIQUE (doc_hash, sig_bytes_offset)                -- one row per signature on one signed document
);

CREATE INDEX idx_signature_audit_log_doc_hash ON signature_audit_log(doc_hash);
CREATE INDEX idx_signature_audit_log_pre_sign_doc_hash ON signature_audit_log(pre_sign_doc_hash);
CREATE INDEX idx_signature_audit_log_signed_at ON signature_audit_log(signed_at DESC);
CREATE INDEX idx_signature_audit_log_fingerprint ON signature_audit_log(signed_by_fingerprint);
```

### 6.2 Migration behavior

- Forward-only. No rollback (consistent with Phase 1/2/3 policy).
- Idempotent — `migrate.ts` skips applied versions.
- Clean migration from schema v3 — no existing tables touched.
- The doc_hash + pre_sign_doc_hash distinction is critical for the "verify what I signed" flow: the user can show that THIS document (current bytes' hash) is THIS audit row, AND the bytes that were signed (pre-signing hash) match what the cert was used to sign.

### 6.3 Repository interface

```ts
// src/db/repositories/signature-audit-repo.ts (Ravi Wave 16)

interface SignatureAuditRepo {
  insert(row: Omit<SignatureAuditRow, 'id' | 'created_at'> & { created_at?: number }): number;
  listByDocHash(docHash: string): SignatureAuditRow[];
  listByPreSignDocHash(preSignDocHash: string): SignatureAuditRow[];
  listAll(limit?: number, offset?: number): SignatureAuditRow[];
  getByFingerprintRange(fp: string, since?: number, until?: number): SignatureAuditRow[];
  delete(id: number): boolean; // for the undo-pades flow
}
```

`db-bridge.ts` (David's adapter) translates snake_case rows ↔ camelCase DTOs at the IPC boundary, parsing `byte_range_json` to `number[]`.

---

## 7. Signature placeholder fill — handoff from Phase 3

Per architecture-phase-3.md §8, Phase 3 emits placeholder `/Sig` fields with:

- `/FT /Sig` field dict
- `/V` intentionally absent (the placeholder marker)
- Widget annotation on the chosen page+rect with `/F 4` (print bit set)
- No appearance stream (Acrobat shows its default "click to sign" affordance)

**Phase 4 fills this placeholder**:

1. **Visual signature into placeholder** — `signature-engine.ts:applySignature({ kind: 'visual', placement: { mode: 'placeholder', fieldName } })` reads the field's widget rect, composes the appearance stream into that rect, writes the `/AP /N` stream onto the widget, leaves `/V` absent (it's a visual signature; no `/Sig` value). The widget now shows the visual signature.

2. **PAdES signature into placeholder** — `signature-engine.ts:applySignature({ kind: 'pades', placement: { mode: 'placeholder', fieldName }, certHandle, ... })`:
   - Composes appearance stream (same path as visual)
   - Computes byte-range over the document
   - Builds CMS envelope, optionally TSA-timestamps
   - Writes the CMS bytes to `/V /Contents <hex>` on the field dict
   - Writes the byte-range array to `/V /ByteRange [a b c d]`
   - The widget remains tied to the field via `/Kids` — no widget rewrite needed
   - Records the audit log row

3. **Freeform signature (no placeholder)** — `placement: { mode: 'freeform', pageIndex, rect }`. Engine authors a NEW `/Sig` field dict + widget annotation at the rect, then proceeds as if it were a placeholder. The audit log row has `field_name = NULL`.

**Forward-compatibility:**

- `FormFieldValue.{ type: 'signature' }` extends from Phase 3 `value: null` to Phase 4 `value: SignaturePayload | null`. `null` means "placeholder, not yet signed" (current state Phase 3); non-null means "signed in Phase 4" with the payload carrying the audit-log row id + cert fingerprint. Type defined in `data-models.md` Phase-4 amendment §9.2.
- `forms:detect`'s response includes signed fields with their `SignaturePayload` populated, so a doc opened with prior Phase-4 signatures shows them correctly in the Forms sidebar (as locked "Signed" rows).
- The form-engine's `fillForm` (`form-engine.md §3.2.1`) signature-value case currently no-ops (Phase 3); Phase 4 extends it to call into `applySignature` when the value is non-null.

---

## 8. Risk register (extends `phase-4-plan.md §risk-register`)

Each of the 7 risks from the phase plan, addressed in the design:

| #   | Risk                               | Severity | Mitigation in this design                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Cert/password handling leak**    | CRITICAL | §4.2 + `signature-engine.md §4` define the full lifecycle. Conventions §15 (new) bakes the discipline into reviewable code. Wave 17 Julian audit checklist provided (§4.2). No persist. Buffer-wrap immediately. `finally` cleanup. Test coverage requires real PFX fixtures with REAL passwords that are zeroed (not stub passwords). |
| 2   | **PAdES library selection**        | HIGH     | §4.3 + `signature-engine.md §3`. Recommend `node-signpdf` primary; ship `node-forge`+`pkijs` fallback at the same time so Phase 4.1 toggle is a switch flip, not a rewrite. License audit (§3.1) done.                                                                                                                                 |
| 3   | **Byte-range correctness**         | HIGH     | `signature-engine.md §3.3` walks the byte-range algorithm step-by-step. Round-trip tests against a reference reader (Acrobat Reader DC + node-signpdf's own verifier). Wave 16 fixture corpus includes 5+ known-good signed PDFs to round-trip against.                                                                                |
| 4   | **TSA URL trust**                  | HIGH     | §4.5 + `signature-engine.md §6`. Default OFF; user-provided URL; no shipped default service. Validation pings on Settings save. Fail-loud on TSA failures (no silent fallback to no-TSA).                                                                                                                                              |
| 5   | **Signature appearance interop**   | MEDIUM   | §4.4 + `signature-engine.md §5`. Standard `/AP /N` widget appearance. Wave 16 fixture corpus includes verifying against Acrobat Reader DC + Edge PDF viewer + Foxit Reader. Default appearance composition is small and predictable.                                                                                                   |
| 6   | **Annotation toolset scope creep** | MEDIUM   | §5 enumerates the exact 7 tools. `ui-spec.md` Phase-4 amendment §13.5 (Riley Wave 15) keeps the toolbar scope tight. NOT: layers, advanced fill patterns, vector editor. The new conventions §15.3 row reaffirms the scope fence.                                                                                                      |
| 7   | **Signed-doc audit log scope**     | LOW      | §6 keeps the table single-purpose: "show me what I signed and when". No multi-user fields, no notarization data, no remote-server schemas. Phase 4.5+ can extend if user demand.                                                                                                                                                       |

### 8.1 Additional risks Riley uncovered during Wave 15 design

These are NOT in the original 7-risk register; flagged here for Wave 16 awareness:

- **R-W15-A — V8 string-interning of passwords.** JS strings are interned and immutable; even with Buffer-wrap-then-clear discipline, the original JS string can linger in V8's heap until the next GC cycle. Mitigation: ship the discipline at the SMALLEST possible window (Buffer-wrap inside ≤5 lines of handler code). Document the residual 1-2-second window as an accepted security floor in `signature-engine.md §4.2.3`. Phase 4.1 candidate: investigate `node-keytar` / OS-keychain for password collection so the JS string never holds the cleartext.
- **R-W15-B — Cert handle leak via crash before release.** If main crashes between `certLoad` and the matching `certRelease`, the cert PEM remains in process memory until the crash dump is collected by the OS. Mitigation: `app.on('before-quit', releaseAllCerts)` AND `process.on('exit', releaseAllCerts)`. Crash dump files (`crashpad-*.dmp` if Electron crashes) are NOT explicitly purged — flagged for Diego packaging follow-up (Phase 4.5+).
- **R-W15-C — TSA response replay.** A malicious TSA could return a stale timestamp token. Mitigation: the TSA client compares `genTime` in the TSR against system clock (within a 5-minute skew window) and fails if mismatch. Documented in `signature-engine.md §6.4`.
- **R-W15-D — Signature widget without `/V` confusable with placeholder.** After a visual-only signature, the widget has an `/AP` appearance but no `/V` — this LOOKS like a Phase-3 placeholder to a subsequent open. Mitigation: the engine writes a `/V` placeholder marker that's a small `<<>>` dict (an empty Sig value) so the field's "signed" state is explicit; OR we use a custom `/FT` extension. **Wave 15 decision: write an empty `/V <<>>` dict** (PDF spec allows this) and let the renderer distinguish "no /V" (placeholder) from "/V is empty" (visual-signed) from "/V has Contents" (PAdES-signed). This is encoded in `signature-engine.md §5.4`.
- **R-W15-E — Audit log poisoning via direct SQLite access.** The audit log table is in the same SQLite file as recents/bookmarks/templates. Any process that can write to `userData/pdf-viewer-editor.db` can forge audit log rows. Mitigation: explicitly DOCUMENT this is a local log, not a notarization service; do NOT make any product claim that the audit log is tamper-evident. Phase 4 user-guide must call this out plainly (Wave 18 Nathan).
- **R-W15-F — `node-signpdf` placeholder size estimation.** node-signpdf reserves a fixed-size placeholder for `/Contents <hex>` before computing the byte-range. If the actual CMS envelope exceeds the placeholder (rare; happens with large cert chains + TSA tokens), the sign fails. Mitigation: the engine sizes the placeholder generously (default 16384 hex chars = 8192 bytes; configurable via `signatures.placeholderSize`). Documented in `signature-engine.md §3.3`.

### 8.2 Risks that DON'T apply to Phase 4 (explicitly excluded)

- Multi-signer workflow concurrency — Phase 4.5+
- Cert revocation checks (CRL/OCSP) — Phase 4.5+, requires trust-list infra
- Signature timestamp authority hosting (we don't host one)
- Signing audit-log replication or backup
- HSM / smart-card integration

---

## 9. Extension points for Phase 4.1+, Phase 5+

### 9.1 In Phase 4 (Wave 16)

- Visual signature (typed / drawn / image)
- PAdES signature with optional RFC 3161 TSA
- 7 new annotation tools (square / circle / polygon / arrow / callout / line-measure / polyline-measure)
- Annotation summary panel + CSV export
- Signature audit log (`signature_audit_log` table; schema v4)
- Flatten-on-export gains a "Lock signatures (flatten signature widgets only)" option (Phase 4 extension to the existing Phase 3 flatten checkbox)

### 9.2 Phase 4.1 (post-ship hardening, OPTIONAL — only if Julian Phase 4 close flags HIGH)

- Manual PAdES engine toggle exposed in Settings (so users can switch from node-signpdf to forge+pkijs without a rebuild)
- HSM / smart-card integration via PKCS#11 (`node-pkcs11js` if MIT)
- OS-keychain password retrieval (`node-keytar`)
- Signature verification of OTHER documents (third-party signed PDFs) — requires trust list
- Multi-signer workflow (single doc, multiple incremental updates)
- Trust list management (custom CAs, CRL polling)

### 9.3 Phase 5+

| Phase | Feature                              | Extension point                                                                           |
| ----- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| 5     | OCR-then-sign workflow               | `applySignature` accepts a freshly-OCR'd doc; no engine change                            |
| 5     | Sign on scanned doc                  | Same                                                                                      |
| 6     | Office export of signed doc          | Office export drops signatures (lossy); user-guide warns. PDF format only preserves them. |
| 7     | Localization of audit log subject CN | Subject CN may be non-ASCII; renderer respects user locale for display                    |
| 7     | macOS / Linux PFX integration        | OS-keychain integration unblocks                                                          |

---

## 10. Phase 4 fidelity boundary

Phase 4 closes some Phase 3 boundaries and introduces new ones. Per the H-3 lesson, documented loudly.

### 10.1 Boundaries Phase 4 closes

| Phase 3 limitation                                 | Phase 4 reality     | Doc update target                                                                                              |
| -------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| "Signature placeholders — signing arrives Phase 4" | Visual + PAdES live | user-guide.md (Nathan Wave 18); release-notes; Forms sidebar surface change                                    |
| "Square / Circle / Line annotations — Phase 4"     | LIVE                | data-models.md Phase-4 amendment §9.5 (existing table updated; new rows for Polygon/PolyLine/FreeText-callout) |
| H-3.1 / M-13.5-1 replay-engine JS-strip residual   | CLOSED (§4.8)       | code-review.md Wave 17 audit will verify; build-report Wave 16 status                                          |

### 10.2 New Phase-4 boundaries

| Boundary                                         | Description                                                                                                                                                                                                                                    | Where to surface                                                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Cert revocation NOT checked                      | Phase 4 signs with whatever cert the user provides. CRL/OCSP checks are Phase 4.1+. A user can sign with a revoked cert and the audit log will record it as if valid.                                                                          | user-guide §Signing + sign-modal tooltip near the "Cert info" display                                                                           |
| Trust list NOT managed                           | We trust the system trust store at HTTPS-handshake time (for TSA). User-installed CAs are honored; we don't ship our own trust list.                                                                                                           | user-guide §Settings → TSA                                                                                                                      |
| Audit log is local + tamper-vulnerable           | The audit log lives in the local SQLite DB and offers NO tamper-evidence. Any process with write access to the DB can forge entries. We document this explicitly.                                                                              | user-guide §Signing → "What the audit log is and isn't"                                                                                         |
| Third-party signature verification NOT supported | Phase 4 only verifies signatures THIS app applied (via `signature_audit_log` lookup). External signatures are displayed but not validated.                                                                                                     | UI: Forms sidebar shows third-party signed fields as locked + tooltip "Signature applied by another tool — verification unavailable in Phase 4" |
| Multi-signer workflow NOT supported              | Signing a doc with two different signatures creates two separate signed files in Phase 4. The "first signature covers everything" + "second signature covers everything-up-to-second" pattern (incremental update PAdES) is Phase 4.5+.        | user-guide; release-notes                                                                                                                       |
| Sign while form fields are dirty                 | If the user has uncommitted form fill values when they click Sign, the signature applies to the BYTES-AT-SIGN-TIME (after auto-commit of form values). Documented because users may expect the dirty values to be excluded from the signature. | sign modal tooltip near the Sign button                                                                                                         |
| Cert PEM lingers in V8 heap                      | R-W15-A: there's a 1-2 second window after cert release where the cert PEM may be in V8's pre-GC heap. Phase 4.1 may switch to Buffer-only storage.                                                                                            | conventions.md §15 + user-guide §Signing → "About security" (Nathan)                                                                            |
| Visual signature is NOT cryptographic            | A visual signature looks like a signature but has no PKI binding. Users who need legal effect must use PAdES.                                                                                                                                  | sign modal makes the distinction loud (two clearly-labeled buttons); user-guide §Signing → "Visual vs cryptographic"                            |
| Sign modal supports ONE cert at a time           | Multi-cert workflows (corp + personal) are Phase 4.5+. Phase 4 allows one CertLoad per modal session.                                                                                                                                          | sign modal copy + user-guide                                                                                                                    |

### 10.3 Round-trip fidelity matrix delta

Extends `edit-replay-engine.md §12`, Phase 2 Phase 3 matrices:

| PDF feature in source                         | Phase 3 behavior                                             | Phase 4 behavior                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing PAdES signature `/V Contents <...>`  | Partial — placeholder preserved, signed `/V` dropped         | **STILL DROPPED on resave that mutates content** — once a PAdES signature is broken by content change, it cannot be re-validated. Phase 4 ADDS: if the user attempts to Save a doc with an existing third-party signature, a confirmation modal warns "Saving will invalidate the existing signature by Jane Doe (2026-01-15)." User can Cancel, Save (invalidate), or Sign Anew (cover the new bytes). |
| PAdES signature with TSA token                | Same — dropped on resave that mutates content                | Same — but the audit log records the signature was invalidated by save (for our own signatures)                                                                                                                                                                                                                                                                                                         |
| Square / Circle / Line subtypes               | N/A (Phase 1 stubbed)                                        | Native pdf-lib support; lossless round-trip                                                                                                                                                                                                                                                                                                                                                             |
| Polygon / PolyLine                            | N/A                                                          | Manual dict authoring; lossless round-trip (golden-bytes-tested)                                                                                                                                                                                                                                                                                                                                        |
| FreeText callout (`/IT FreeTextCallout`)      | N/A                                                          | Manual dict authoring; preserves `/CL` callout-line + `/IT`                                                                                                                                                                                                                                                                                                                                             |
| Measure annotations (`/Line` with `/Measure`) | N/A                                                          | Manual dict authoring; calibration round-trips via `/Measure` dict                                                                                                                                                                                                                                                                                                                                      |
| Document-level JS (`/Names /JavaScript`)      | STRIPPED (form-bearing saves only — H-3.1 residual M-13.5-1) | **STRIPPED ON EVERY SAVE PATH** (§4.8 above)                                                                                                                                                                                                                                                                                                                                                            |

---

## 11. What's NOT in Phase 4

Hard scope-fence per `phase-4-plan.md §Phase 4 does NOT ship`. Listed here to absorb any Phase-4 brief drift:

- Signature verification of OTHER documents (third-party signed PDFs) — Phase 4.1 if user demand
- Multi-signer workflows (incremental update PAdES) — Phase 4.5
- Trust list management (CAs / CRL / OCSP polling) — Phase 4.5+
- Cert generation (users bring their own PFX)
- Redaction — wontfix-unless-demand (per phase-4-plan)
- Layer annotations (PDF `/OC` content-control) — wontfix Phase 4
- Advanced annotation fill patterns (cross-hatch, etc.) — wontfix Phase 4
- Vector editing (Bezier path manipulation beyond polygon) — wontfix Phase 4
- HSM / smart-card cert source — Phase 4.1
- OS-keychain password retrieval — Phase 4.1

If a Phase-4 wave brief or implementation pulls toward any of these, the agent stops and surfaces to Marcus.

---

## 12. L-001 cross-check

**L-001 status: unchanged.** Phase 4 introduces:

- Signature capture modal — pure renderer overlay; no new BrowserWindow.
- PAdES sign modal — same.
- Cert picker — uses `dialog.showOpenDialog` IPC (existing Phase 1 channel pattern).
- PFX / image / signature drag-drop into the capture modal — uses the SAME `File.path` Electron property as Phase 1 PDF drops, Phase 2 image drops, Phase 3 CSV/Excel drops. Phase 4 EXTENDS the L-001 pathway; does not weaken it.
- Annotation tools — pure renderer overlay; no main-process window changes.
- Signature audit panel — pure renderer modal; no new window.

Wave 16 implementers (David / Ravi / Riley) MUST NOT touch `src/main/window-manager.ts`. If Wave 16 surfaces a need for a new lock (e.g. "PFX passwords must always be Buffer-wrapped before any logging"), that's a Marcus call after Julian's Wave 17 audit.

---

## 13. Phase 1 + Phase 2 + Phase 3 freeze rule extends to Phase 4

Per the analogous Phase 3 freeze rule (`architecture-phase-3.md §13`):

**P4-L-FREEZE (implicit, recorded here):** `ARCHITECTURE.md`, `docs/architecture-phase-2.md`, `docs/architecture-phase-3.md`, `docs/edit-replay-engine.md`, `docs/form-engine.md` are FROZEN by Phase 4. Phase 4 design lives in THIS doc and `docs/signature-engine.md` exclusively. The api-contracts / data-models / ui-spec / conventions docs are AMENDED with Phase 4 sections (not edited in their Phase 1 / Phase 2 / Phase 3 sections).

If Wave 16 implementation needs a Phase-1/2/3 contract change, the agent stops and surfaces to Marcus — same protocol as `api-contracts.md §11` (Phase 1 backward-compat policy) and the Phase-3 freeze.

---

## 14. Cross-reference checklist (Wave 15 self-verification)

- [x] All 7 locked decisions encoded (§1)
- [x] No new processes; no new BrowserWindow; L-001 untouched (§2.1, §12)
- [x] 11 new IPC channels listed + cross-ref to api-contracts (§2.5)
- [x] Library inventory delta with license verification (§3.1)
- [x] Cert + password lifecycle table + Wave 17 audit checklist (§4.2)
- [x] PAdES library decision (P4-L-3) + rationale (§4.3, cross-ref to signature-engine.md §3.2)
- [x] Appearance composition (P4-L-4) (§4.4)
- [x] TSA URL trust model (P4-L-2) (§4.5)
- [x] 5 new EditOperation variants (§4.6)
- [x] Replay-engine integration: step 3.7 (§4.7)
- [x] H-3.1 / M-13.5-1 absorption (§4.8)
- [x] Annotation toolset expansion (P4-L-5) — scope-fenced (§5)
- [x] Schema v4 DDL + repo interface (P4-L-6) (§6)
- [x] Signature placeholder fill handoff from Phase 3 (P4-L-7) (§7) — verified Phase-3 placeholder design is sufficient; no Wave 11.5 amendment needed
- [x] Phase 4 risk register addressed (§8) + Riley's additional risks R-W15-A through R-W15-F (§8.1)
- [x] Phase 4.1+ deferral list (§9.2)
- [x] Phase 4 fidelity boundary matrix (§10)
- [x] Phase 4 scope fence (§11)
- [x] L-001 unchanged (§12)
- [x] Phase 4 freeze rule recorded (§13)

End of Phase-4 architecture amendment.
