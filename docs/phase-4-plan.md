# Phase 4 — Fill, Sign & Annotate (full)

**Author:** Main session (Marcus's planning hit API overload; inlined the plan)
**Date:** 2026-05-22
**Status:** Plan-on-disk. Wave 15 (Riley solo design) dispatches once Wave 11 + Phase 3 implementation close.

## Goals (locked)

1. Signature capture: typed, drawn (canvas), image upload
2. Signature placement (drag onto field or freeform position; size + rotate)
3. **PAdES cryptographic signatures** — PFX/P12 cert import (password-protected), signature dictionary, byte-range hashing, optional RFC 3161 timestamping
4. Date stamp, initials, check marks for contracts
5. Full annotation toolset (shapes, arrows, callouts, measure tools)
6. Annotation summary / export

## Locked design constraints

- **Visual signatures + PAdES both ship.** Visual = appearance-only stamps (typed/drawn/image). PAdES = ETSI EN 319 142 cryptographic signatures with X.509 cert + signature dictionary + byte-range hashing + optional RFC 3161 TSA timestamping.
- **Library selection for PAdES:** `node-signpdf` (MIT) is the leading candidate. Riley evaluates in Wave 15. If insufficient: manual byte-range + ASN.1 via `node-forge` (MIT) + `pkijs` (MIT).
- **Cert storage:** user imports a PFX/P12 file at sign-time; password prompted via modal; cert NEVER persisted (no Electron-Store, no SQLite, no env vars). Password never logged. Loaded into memory only for the signing operation, zeroed after.
- **Timestamping (TSA):** optional. User can configure a TSA URL in Settings (defaults to a free public TSA — verify legal-compatibility before defaulting to anyone's service). Skipped if disabled.
- **Signature appearance:** standard PDF signature widget annotation with appearance stream showing typed name + drawn signature image + date + reason field.
- **No commercial SDKs** (rules out PDFTron, Foxit, Adobe Sign). Permissive OSS only.
- **Phase 4 does NOT ship:**
  - Signature certificate verification of OTHER documents (Phase 4.1 if user demand)
  - Multi-signer workflows (Phase 4.5)
  - Trust list management (CAs/CRL) — relies on system trust store for verification view
  - Cert generation (users bring their own PFX)
  - Redaction — flagged in roadmap as wontfix-unless-demand

## Wave structure

| Wave | Owner | Mode | Scope | Output |
|---|---|---|---|---|
| 15 | Riley | solo | Phase 4 architecture | `docs/architecture-phase-4.md` (NEW), `docs/signature-engine.md` (NEW), `docs/annotation-toolset-phase-4.md` (NEW or amend), additive doc amendments |
| 16 | David + Ravi + Riley | parallel | Implementation | main-process signature engine (visual + PAdES), TSA client, expanded annotation toolset, schema v4 (signature audit log?) |
| 17 | Diego + Julian | parallel | Packaging + audit | new deps (node-signpdf or node-forge+pkijs), CI updates, security review (cert handling top priority) |
| 18 | Nathan | solo | Documentation | README + user-guide + developer-guide + api-reference updates; phase-4-release-notes.md |

## File ownership (Phase 4)

| Owner | Files added/modified |
|---|---|
| Riley (Wave 15) | `docs/architecture-phase-4.md` (NEW), `docs/signature-engine.md` (NEW), additive amendments to api-contracts/data-models/ui-spec/conventions |
| David (Wave 16) | `src/main/pdf-ops/signature-engine.ts` (NEW), `src/main/pdf-ops/signature-engine.test.ts`, `src/main/pdf-ops/visual-signature.ts` (NEW), `src/main/pdf-ops/pades-signature.ts` (NEW), `src/main/pdf-ops/tsa-client.ts` (NEW), 3-4 new IPC handlers (`pdf:applyVisualSignature`, `pdf:applyPadesSignature`, `pdf:requestTimestamp`, `pdf:verifySignature`), `src/ipc/contracts.ts` extension, `src/ipc/register.ts` |
| Ravi (Wave 16) | `migrations/0004_phase4_signatures.sql` (signature audit log table — track signed-by, signed-at, cert-fingerprint, hash, doc-handle), `src/db/repositories/signature-audit-repo.ts` (NEW) + test |
| Riley (Wave 16 impl) | `src/client/components/modals/signature-capture-modal/` (NEW — typed/drawn/image tabs), `src/client/components/signature-placement-overlay/` (NEW — drag+resize+rotate), `src/client/components/modals/pades-sign-modal/` (NEW — PFX picker + password prompt + TSA config + sign button), `src/client/components/annotation-tools/` (EXPAND — shapes, arrows, callouts, measure), `src/client/state/slices/signatures-slice.ts` (NEW), `src/client/state/thunks.ts` (signature thunks) |
| Diego (Wave 17) | `package.json` deps (`node-signpdf` MIT or `node-forge`+`pkijs` MIT — verify), CI updates, electron-builder verification (cert/PFX files must NOT be packaged into the installer — verify the ASAR ignore-list excludes any test PFX fixtures) |
| Julian (Wave 17) | `docs/code-review.md` Phase 4 section — security review is THE focus. Cert handling, password lifecycle, TSA URL trust, byte-range correctness, signature replay attacks |
| Nathan (Wave 18) | `README.md`, `docs/user-guide.md`, `docs/developer-guide.md`, `docs/api-reference.md`, `LICENSES.md`, `docs/phase-4-release-notes.md` (NEW) |

## Risk register (Phase 4)

1. **CRITICAL — Cert/password handling.** PFX file contents in memory only, password never persisted, both zeroed after signing op completes. A leak here (logged password, persistent cert, etc.) is a real security incident. Wave 17 Julian MUST audit this end-to-end.

2. **HIGH — PAdES library selection.** `node-signpdf` (MIT) appears actively maintained but has historically had byte-range edge cases. Alternative: `node-forge` + `pkijs` (both MIT) for manual ASN.1 + byte-range. Wave 15 Riley evaluates and recommends.

3. **HIGH — Byte-range correctness.** PAdES requires computing a hash over a specific byte range that excludes the signature dictionary itself. Off-by-one bugs here produce invalid signatures. Mitigation: comprehensive round-trip tests against a reference PDF reader (Acrobat Reader DC if available; fallback to `node-signpdf`'s own verifier).

4. **HIGH — TSA URL trust.** Defaulting to a public TSA means trusting their CA. Some public TSAs require paid accounts or have rate limits. Don't ship with a default TSA URL pointing to anyone's service without explicit license-or-T&C alignment. Recommendation: ship with TSA disabled by default; user provides their own URL.

5. **MEDIUM — Signature appearance interop.** Acrobat displays PAdES signatures with chrome that varies by signer/cert. Test against Acrobat Reader DC for visual confirmation.

6. **MEDIUM — Annotation toolset scope creep.** Phase 4 lists "full annotation toolset" — risk of growing into a Sketch app. Stay scoped to: shapes (rectangle/ellipse/polygon), arrows, callouts (arrow + text bubble), measure tools (line distance, polyline distance). No advanced fill patterns, no layers.

7. **LOW — Signed-doc audit log scope.** Phase 4 sign action writes a row to a signature_audit_log table for "show me what I signed and when." Don't expand to multi-user/audit-trail/notarization scope.

## Acceptance criteria (Phase 4 close)

- [ ] Visual signature: typed/drawn/image, placed on a page, saved as PDF signature widget with appearance stream
- [ ] PAdES signature: user imports PFX with password → cert loaded into memory → byte-range computed → hash signed → signature dictionary embedded → signed PDF saved; verifies in Acrobat Reader DC
- [ ] Optional RFC 3161 timestamping toggleable in Settings; defaults OFF
- [ ] Date stamp, initials, check-mark stamps for contract paperwork (one-click per stamp type)
- [ ] Annotation toolset expansion: rectangles, ellipses, polygons, arrows, callouts, line-measure, polyline-measure
- [ ] Annotation summary view: sidebar tab lists all annotations with page jump
- [ ] Signature audit log: signed docs tracked in DB (cert-fingerprint, sign-time, doc-hash)
- [ ] Cert NEVER persisted to disk; password NEVER logged
- [ ] Schema v4 migration runs cleanly over v3
- [ ] All Phase 1-3 features still work; no regression
- [ ] L-001 holds
- [ ] Test count: estimate +80 tests (signature engine has heavy crypto fixture surface)
- [ ] Honest limitations documented (no signer-cert verification of other docs, no multi-signer workflows, no cert generation, no trust-list management)

## Wave 15 brief location

`docs/wave-15-brief.md` — written separately. Dispatchable to Riley when Wave 12 Phase 3 implementation closes (Phase 4 depends on Phase 3 forms because the signature-placeholder form field designed in Phase 3 is what signatures fill in Phase 4).

## Phase 4 depends on Phase 3

The **signature placeholder form field** designed in Phase 3 is what Phase 4 fills. Riley's Wave 11 design must include the signature-placeholder type in the FormFieldDefinition discriminated union so Phase 4 can reach for it.
