# Wave 15 Brief — Riley solo (Phase 4 architecture design)

**Author:** Main session
**Date:** 2026-05-22
**Status:** Dispatchable when Wave 12 Phase 3 implementation closes.
**Mode:** Sequential, solo Riley (analogous to Wave 6 + Wave 11).
**Output:** Design docs only; NO source code.

## Goal

Design the Phase 4 visual + PAdES cryptographic signature system + expanded annotation toolset to enable Wave 16 implementers to build with zero ambiguity, especially around the **cert/password lifecycle** (Phase 4's CRITICAL risk).

## Required reading

1. `docs/phase-4-plan.md` (top-level plan; locked goals + 7-risk register)
2. Phase 1/2/3 frozen design docs (what you're extending)
3. `docs/api-contracts.md`, `docs/data-models.md`, `docs/ui-spec.md`, `docs/conventions.md` (additive amendments)
4. `docs/architecture-phase-3.md` + `docs/form-engine.md` (your Wave 11 docs — Phase 4 depends on the signature-placeholder form field type you designed there)
5. `docs/code-review.md` accumulated history
6. `.learnings/locked-instructions.md` (L-001)
7. `.learnings/learnings.jsonl` last 250 lines
8. ETSI EN 319 142 (PAdES) overview — sufficient to know:
   - Signature dictionary structure (`/Type /Sig`, `/Filter /Adobe.PPKLite`, `/SubFilter /ETSI.CAdES.detached`, `/Contents <hex>`, `/ByteRange`)
   - Byte-range definition (covers the whole document except the `/Contents <...>` placeholder)
   - PKCS#7 / CMS signature container
   - Optional RFC 3161 timestamp token in `/Contents`
9. `node-signpdf` GitHub README + license (MIT verification)
10. Backup: `node-forge` + `pkijs` (manual ASN.1 + signing path) GitHub READMEs + licenses (both MIT)

## Files you own this wave (doc-only)

**NEW:**
- `docs/architecture-phase-4.md` — Phase 4 system additions
- `docs/signature-engine.md` — detailed design of the main-process signature operations (visual + PAdES + TSA + appearance streams)

**AMEND (additive only):**
- `docs/api-contracts.md` — add Phase 4 channels with `### Phase 4 amendment (2026-MM-DD, Riley)` banner
- `docs/data-models.md` — add signature audit log schema v4 DDL + TypeScript types
- `docs/ui-spec.md` — signature capture modal, signature placement overlay, PAdES sign modal, expanded annotation tools, annotation summary
- `docs/conventions.md` — add new patterns: cert handling discipline (memory-only, never-persisted), password lifecycle, TSA URL trust model

## Locked design decisions to encode

1. **Cert NEVER persisted.** PFX file contents loaded once, kept in main-process memory for the signing op, zeroed in a `finally` block. Password collected via modal input, never logged, never stored.
2. **TSA disabled by default.** User-configured URL; no default service to avoid legal/T&C entanglement.
3. **PAdES library:** evaluate `node-signpdf` vs `node-forge`+`pkijs` manual. Recommend one with rationale. If `node-signpdf` is good enough, prefer (less code). If gaps in byte-range correctness or appearance, fall back to manual ASN.1.
4. **Signature appearance:** standard PDF widget annotation with `AP` (appearance stream) showing typed name + drawn image + date + reason. Configurable.
5. **Annotation toolset scope:** rectangle, ellipse, polygon, arrow, callout (arrow + bubble), line-measure, polyline-measure. NOT: layers, advanced fill patterns, full vector editor.
6. **Schema v4** for signature audit log table: signed-by-fingerprint, signed-at, doc-hash, sig-bytes-offset (for verification reference).
7. **Phase 4 fills the Phase-3 signature-placeholder field** — verify your Wave 11 design includes this type; if it doesn't, flag for Wave 11.5 amendment.

## Specific design questions you must answer

### A. PAdES library selection
Research both candidates:
- `node-signpdf` — MIT; how mature is the byte-range handling? Does it support timestamping? Does it handle multi-signature workflows (not needed Phase 4 but design awareness)?
- `node-forge` + `pkijs` manual — MIT each; significantly more code but full control over ASN.1 + byte-range + appearance.

Recommend one. Document both with their trade-offs.

### B. Cert/password lifecycle
Diagram the full lifecycle of the PFX bytes + password from user input → in-memory load → signing → cleanup. Where exactly is the password zeroed? When is the cert object destroyed? Are there any GC pauses where the bytes could linger? (Practical answer: V8 GC will eventually collect, but explicit `Buffer.fill(0)` on the PFX bytes + overwriting the password variable with empty string is the discipline. Document this.)

### C. TSA URL trust model
- Default: empty / off
- User config: provide a TSA URL in Settings
- Validation: ping the TSA on save with a small test request? Or just attempt the real request and fail clearly if invalid?
- Document acceptable TSA URLs (RFC 3161-compliant; HTTPS; user responsibility for trust)

### D. Signature appearance stream design
PDF widget annotation needs an `AP` dictionary with `N` (normal appearance) and optionally `R` (rollover) + `D` (down). The N stream contains the visual elements. Design:
- Layout: signature image OR typed name (positioned)
- Date / Reason text
- Padding + sizing
- How user customizes (Settings option? per-signature option in the sign modal?)

### E. Visual signature vs PAdES — UI distinction
User flow when clicking the Sign affordance:
- "Quick stamp" (visual only — typed/drawn/image, no crypto)
- "Cryptographic signature" (PAdES — opens cert picker + password)

How does the UI present these? Two buttons? One button with sub-menu? Modal step?

### F. Verification UX (out of scope or in scope?)
Phase 4 plan says verification of OTHER docs is Phase 4.1. But the user signing their OWN doc may want a "Verify this signature works" preview. Design: post-sign confirmation modal showing "Signature valid; cert: <subject CN>; signed at: <time>"? Or just trust that Acrobat Reader will verify and skip the preview?

### G. Annotation toolset expansion
For each new tool (shapes, arrows, callouts, measure):
- PDF annotation subtype mapping (`/Square`, `/Circle`, `/Polygon`, `/PolyLine`, `/FreeText` with callout, `/Line` with measure unit)
- Configuration options (color, line weight, fill, arrow style)
- Tool selection UX (toolbar buttons; cursor changes)
- Measure tool calibration (user sets a known length to scale; per-document calibration persisted in document state)

### H. Signature placement
After capture, the user drags the signature onto:
- A Phase-3 signature-placeholder field → snaps to field bounds
- A freeform position → drag/resize/rotate handles

How does the placement overlay differ from the Phase-2 image-overlay? Likely very similar — consider sharing the overlay component.

## Risk register to include in architecture-phase-4.md

Per phase-4-plan §risk-register: 7 risks. Address each with mitigation in your design.

## Verification (your responsibility)

1. Cross-reference: every new IPC channel in api-contracts has a mention in architecture-phase-4.md + a database/schema mapping where applicable
2. Schema v4 DDL is idempotent
3. Cert/password lifecycle (B) is bullet-proof on paper — Wave 17 Julian audits this hard
4. PAdES library decision (A) is documented with explicit rationale
5. All 7 locked decisions encoded
6. L-001 not implicitly weakened (signature engine doesn't spawn unsecured BrowserWindows)
7. The Phase-3 signature-placeholder type is referenced + leveraged

## L-001
Doc-only. Don't propose new BrowserWindow constructions in your design without security-floor inheritance.

## Output

- 2 NEW + 4 amended docs
- Append "Riley — Wave 15 Phase 4 architecture" status row to `docs/build-report.md`: line counts, locked decisions encoded check, PAdES library decision (A) + rationale, cert/password lifecycle diagram summary, Wave 16 dispatch-readiness verdict
- Append one JSONL line to `.learnings/learnings.jsonl`

## What NOT to do

- Don't write Wave 16 implementation code
- Don't break Phase 1/2/3 contracts (strictly additive)
- Don't default TSA URL to anyone's service
- Don't persist cert or password in design — Wave 17 Julian rejects this
- Don't expand annotation toolset scope beyond locked-decision #5
- Don't speculate on Phase 5/6/7 in Phase 4 docs

Return a ≤300-word summary: 6 docs touched + line counts, PAdES library decision (A) + rationale, cert/password lifecycle key invariants, top-3 Phase 4 risks, Wave 16 dispatch-readiness verdict.
