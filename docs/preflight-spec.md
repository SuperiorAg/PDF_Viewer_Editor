# Preflight Spec — C2 (Phase 7.5 Wave 5a)

**Author:** Riley (VP of Product Design & Frontend Engineering)
**Date:** 2026-06-17 (Wave 1, Phase 7.5)
**Status:** Wave 1 design, locked at end-of-wave. Drives David's Wave 5a engine work + Julian's Wave 11 honesty review (R11) + Nathan's Wave 12 user-guide disclosure.
**Reads:** `docs/project-plan.md` §2 Wave 5a + R11; `docs/architecture-phase-7.5.md` §4.5; `docs/api-contracts.md` §19.6 (`pdf:runPreflight`); `docs/ui-spec-phase-7.5.md` §23.

> **Scope.** This document enumerates the PDF/X and PDF/A rules the Phase 7.5 Preflight engine ships. **It is a SUBSET, not full compliance.** Honest disclosure of what we ship vs what Acrobat's full Preflight ships is the load-bearing point of this spec — Nathan, Riley, and David all use this enumeration as the canonical reference.

---

## 0. Standards covered (partial) vs not covered

| Standard                        | Coverage status        | Notes                                                                                                    |
| ------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| PDF/X-1a:2003                   | **Subset** — ~7 rules  | Print-prep focus; we cover color space + font embedding + transparency + trapping basics                 |
| PDF/X-4:2010                    | **Subset** — ~7 rules  | Modern print-prep; we cover the X-4 deltas over X-1a (transparency + ICC)                                |
| PDF/A-1b:2005                   | **Subset** — ~9 rules  | Archival; we cover the must-haves (font embedding, metadata, no JS, no encryption)                       |
| PDF/A-2b:2011                   | **Subset** — ~8 rules  | A-2b deltas over A-1b (transparency allowed, JPEG2000 allowed, etc.)                                     |
| PDF/X-3, X-5, X-6               | **NOT shipped**        | Lower priority; X-1a + X-4 cover ~90% of print-prep needs                                                |
| PDF/A-1a, A-2a, A-3, A-4        | **NOT shipped**        | A-1a/A-2a add tag requirements that overlap with C3 Tag PDF; A-3 is for embedded files; A-4 is 2020 spec |
| PDF/UA-1                        | NOT a Preflight target | Covered by C6 Accessibility Checker instead                                                              |
| PDF/VT (variable data printing) | NOT shipped            | Niche                                                                                                    |
| PDF/E (engineering)             | NOT shipped            | Niche                                                                                                    |

Phase 7.5 ships **~30 rules total** (7 + 7 + 9 + 8 with overlap deduped). Acrobat's Preflight ships hundreds. Our claim is "compliant subset" — never "full PDF/X validation".

---

## 1. UI surface (recap)

`docs/ui-spec-phase-7.5.md` §23 specifies. Header subtitle (permanent, non-dismissible) reads:

> "Subset of PDF/X-1a, PDF/X-4, PDF/A-1b, PDF/A-2b — see Help for the shipped rule set."

The "see Help" link opens this document (rendered or linked from the in-app Help → Preflight section).

---

## 2. Engine surface (recap)

```
pdf:runPreflight({ handle, profiles }) → PreflightRuleResult[]
```

Each rule lives at `src/main/pdf-ops/preflight-rules/<rule-id>.ts`:

```ts
export interface PreflightRule {
  id: string;
  profile: 'pdf-x-1a' | 'pdf-x-4' | 'pdf-a-1b' | 'pdf-a-2b';
  severity: 'error' | 'warning' | 'info';
  labelKey: string; // i18n key for the rule's user-facing label
  check(ctx: PreflightContext): PreflightRuleResult;
}

interface PreflightContext {
  doc: PDFDocument; // pdf-lib doc
  pdfjsDoc: PdfJsDocument; // pdf.js doc for content-level inspection
  catalog: PDFDict; // doc.catalog
}

interface PreflightRuleResult {
  ruleId: string;
  profile: PreflightProfile;
  severity: 'error' | 'warning' | 'info';
  passed: boolean;
  message: string; // i18n key (renderer resolves)
  locations: { pageIndex: number; bbox?: [number, number, number, number] }[];
}
```

`shippedRuleCount` in the response equals `30` at v0.8.0 cut. Nathan documents this number.

---

## 3. The shipped rule set

### 3.1 Cross-profile rules (apply to multiple profiles)

| Rule ID                                      | Profiles              | Severity | What it checks                                                                                 | How it checks                                                                                         |
| -------------------------------------------- | --------------------- | -------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `preflight.fonts.all-embedded`               | X-1a, X-4, A-1b, A-2b | error    | Every used font has its program embedded (full or subset)                                      | pdf-lib font-table walk — confirms `/FontDescriptor/FontFile{1,2,3}` is present for each `/Font` dict |
| `preflight.fonts.embedded-subset-not-system` | X-1a, X-4, A-1b, A-2b | warning  | Embedded fonts have unique subset prefixes (e.g. `AAAAAA+TimesRoman`) to avoid name collisions | Regex check on font names                                                                             |
| `preflight.no-encryption`                    | X-1a, X-4, A-1b, A-2b | error    | Document has no encryption                                                                     | pdf-lib `doc.isEncrypted`                                                                             |
| `preflight.no-javascript`                    | X-1a, X-4, A-1b, A-2b | error    | No `/JS` or `/JavaScript` actions; no `/AA` form actions                                       | low-level catalog + form-fields walk                                                                  |
| `preflight.no-multimedia`                    | X-1a, X-4, A-1b, A-2b | error    | No `/Screen`, `/Movie`, `/Sound`, `/3D` annotations                                            | annotation walk                                                                                       |
| `preflight.no-embedded-files`                | X-1a, X-4, A-1b       | error    | No `/EmbeddedFiles` in catalog                                                                 | A-2b ALLOWS embedded files; A-1b does NOT                                                             |
| `preflight.metadata.xmp-present`             | X-1a, X-4, A-1b, A-2b | error    | `/Metadata` stream contains valid XMP                                                          | pdf-lib metadata fetch + XML parse                                                                    |

### 3.2 PDF/X-1a-specific rules

| Rule ID                                  | Severity | What it checks                                                                                | How it checks                                                                |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `preflight.color.no-transparency`        | error    | X-1a forbids transparency (`/CA`, `/ca`, soft masks)                                          | content-stream operator scan for `gs` references to alpha-bearing extgstates |
| `preflight.color.cmyk-or-greyscale-only` | error    | All color spaces are DeviceCMYK, DeviceGray, or named separation/devicen — no RGB             | pdf-lib resource walk per page                                               |
| `preflight.output-intent.present`        | error    | Catalog has `/OutputIntents` array with at least one PDF/X output intent + ICC profile        | low-level catalog lookup                                                     |
| `preflight.trapping.specified`           | warning  | `/Trapped` is `/True`, `/False`, or absent (NOT `/Unknown`)                                   | `/Info/Trapped` read                                                         |
| `preflight.encryption.absent`            | error    | (Same as cross-profile rule; X-1a explicitly forbids)                                         | duplicate; engine dedupes                                                    |
| `preflight.bleed-trim-boxes.consistent`  | warning  | If `/TrimBox` is set, `/BleedBox` (if present) contains `/TrimBox`; `/MediaBox` contains both | per-page box geometry check                                                  |

### 3.3 PDF/X-4-specific rules (deltas over X-1a)

| Rule ID                                        | Severity | What it checks                                                                                        | How it checks                             |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `preflight.color.icc-profile-required`         | error    | Every used color space has an embedded ICC profile or is a device space resolved by the output intent | resource walk + output-intent cross-check |
| `preflight.transparency.allowed-with-icc`      | info     | Transparency is allowed in X-4 IF an output intent ICC is present (informational)                     | output-intent presence check              |
| `preflight.color.no-uncalibrated-rgb`          | error    | Uncalibrated RGB is forbidden; all RGB must be DeviceRGB resolved by output intent OR ICCBased        | resource walk                             |
| `preflight.layers.optional-content-allowed`    | info     | X-4 allows OCGs; mark as info, not error                                                              | catalog `/OCProperties` presence          |
| `preflight.output-intent.icc-profile-embedded` | error    | Output intent's ICC profile is actually embedded as a stream                                          | output-intent `/DestOutputProfile` check  |

### 3.4 PDF/A-1b-specific rules

| Rule ID                                              | Severity | What it checks                                                                              | How it checks                             |
| ---------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `preflight.metadata.xmp-pdfaid-marker`               | error    | XMP metadata includes `pdfaid:part = 1` and `pdfaid:conformance = B`                        | XML XPath into the parsed XMP             |
| `preflight.color.colorspace-consistent`              | error    | All color spaces have a defined relationship to the output intent OR are device-independent | resource walk + output-intent cross-check |
| `preflight.no-transparency`                          | error    | A-1b forbids transparency (same as X-1a)                                                    | content-stream scan                       |
| `preflight.no-lzw`                                   | error    | No LZW-compressed streams (patent-encumbered; ISO 19005-1 forbids)                          | stream filter check                       |
| `preflight.fonts.no-symbolic-without-encoding`       | error    | Symbolic fonts have `/Encoding` defined                                                     | font-table walk                           |
| `preflight.actions.no-launch-actions`                | error    | No `/Launch` actions in catalog or annotations                                              | low-level walk                            |
| `preflight.no-external-references`                   | error    | No external file references (`/URL` actions are exempt)                                     | annotation + action walk                  |
| `preflight.viewer-preferences.no-print-restrictions` | warning  | `/ViewerPreferences/PrintScaling` allowed; no `/HideToolbar` restricting access             | catalog walk                              |

### 3.5 PDF/A-2b-specific rules (deltas over A-1b)

| Rule ID                                            | Severity | What it checks                                                                | How it checks                       |
| -------------------------------------------------- | -------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| `preflight.metadata.xmp-pdfaid-part-2`             | error    | XMP metadata includes `pdfaid:part = 2` and `pdfaid:conformance = B`          | XML XPath into the parsed XMP       |
| `preflight.transparency.allowed`                   | info     | A-2b ALLOWS transparency (informational — different from A-1b)                | inverse of A-1b rule                |
| `preflight.jpeg2000.allowed`                       | info     | A-2b ALLOWS JPEG2000-compressed images; A-1b does not                         | stream filter scan                  |
| `preflight.embedded-files.allowed-with-metadata`   | warning  | A-2b allows embedded files IF the embedded file has its own PDF/A subtype     | catalog `/Names/EmbeddedFiles` walk |
| `preflight.color.no-uncalibrated-rgb`              | error    | (Same as X-4 rule; A-2b is stricter about device-independent color than A-1b) | duplicate; engine dedupes           |
| `preflight.layers.optional-content-allowed`        | info     | A-2b allows OCGs                                                              | catalog `/OCProperties` presence    |
| `preflight.fonts.cid-fonts-allowed`                | info     | A-2b allows CID fonts more broadly than A-1b                                  | informational                       |
| `preflight.linked-annotations.no-unembedded-files` | warning  | File-attachment annotations have inline data, not external references         | annotation walk                     |

---

## 4. Rules explicitly NOT shipped (transparency for Nathan)

Documented honestly so user-guide can mirror:

- **Pre-press resolution checks** — image DPI ≥ 300 dpi for offset print. Not shipped; we'd need raster sampling per image.
- **Spot color names match output intent** — beyond name-presence, deep validation of separation color names against ICC profile.
- **Overprint settings** — `/OPM` for K100% overprint, etc. Print-niche.
- **Halftone screens** — `/HT` checks. Print-niche.
- **Trapping presets** — `/TR` checks beyond `/Trapped`.
- **Specific ICC profile validation** — we check ICC presence, not profile validity vs ISO test vectors.
- **PDF/X output intent registry** — Acrobat validates output intent identifiers against a registry; we accept any well-formed entry.
- **Form-field appearance streams** — A-1b/A-2b require generated appearance streams for AcroForm fields. Not enforced as a rule; we trust pdf-lib's writer.
- **Color rendering intent restrictions** — `/RenderingIntent` value checks.
- **Most A-1a / A-2a tag rules** — covered partially by C6 Accessibility Checker rules.

---

## 5. Engine implementation notes (David)

### 5.1 Each rule is one file

`src/main/pdf-ops/preflight-rules/<rule-id>.ts` — one file per rule, ≤ 200 lines per the modularization rule. Each exports a `PreflightRule` and a `__test__` namespace for the per-rule test fixtures.

### 5.2 Shared helpers

`src/main/pdf-ops/preflight-rules/_helpers/` provides:

- `extractXmpMetadata(doc)` — parses `/Metadata` stream + returns a typed XMP object.
- `walkFonts(doc)` — yields every font ref + its descriptor.
- `walkColorSpaces(doc)` — yields every color space ref.
- `walkAnnotations(doc)` — yields every annotation + parent page.
- `getOutputIntent(doc)` — returns first PDF/X output intent or null.
- `contentStreamHasTransparency(page)` — scans for `gs` operators referencing alpha-bearing `extgstate`s, or soft masks.

### 5.3 Performance

Rules run in parallel (`Promise.all`) per profile. The 1064-page test PDF should complete the full 30-rule run in **< 10 seconds**. Verified in Wave 5a acceptance.

Rules that need pdf.js (content-stream scans) batch their per-page passes so each page is loaded once across all such rules.

### 5.4 L-004 / L-005 compliance

Any rule that calls `pdfjs.getDocument({ data })` MUST use the `toPdfJsBuffer` helper (L-004) and route through `loadPdfJs` (L-005). The helpers in `_helpers/` enforce this — rules don't call pdf.js directly.

---

## 6. Test plan

### 6.1 Per-rule pass/fail fixtures

Each rule file has a `<rule-id>.test.ts` with at least:

1. **Pass fixture** — a minimal PDF that satisfies the rule.
2. **Fail fixture** — a minimal PDF that violates the rule.
3. **Edge case** — when applicable (e.g., empty doc, single-page doc).

Fixtures live in `tests/fixtures/preflight/` and are checked in (small — typically < 50 KB each).

### 6.2 Profile-level integration tests

- `preflight-pdf-x-4-pass.test.ts` — run all X-4 rules against a known-X-4-compliant fixture; all pass.
- `preflight-pdf-a-1b-fail.test.ts` — run all A-1b rules against a known-non-compliant doc; expect the documented failures.
- Similar for X-1a + A-2b.

### 6.3 Performance gate

```ts
test('full preflight on 1064-page test PDF completes in under 10s', async () => {
  const handle = await openTestFixture('1064-page-stress.pdf');
  const start = Date.now();
  await pdf.runPreflight({ handle, profiles: ['pdf-x-4'] });
  expect(Date.now() - start).toBeLessThan(10_000);
});
```

### 6.4 Honest disclosure regression

```ts
test('shippedRuleCount matches docs/preflight-spec.md', () => {
  expect(PREFLIGHT_RULES.length).toBe(30);
});
```

Number-change catches drift between code and documentation.

---

## 7. Honesty disclosure ratchet (P7.5-L-9 obligation #1)

The four-location ratchet:

| Location                               | What it says                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/preflight-spec.md` (this doc) §3 | Full rule enumeration (30 rules)                                                                                                                     |
| Preflight panel header (ui-spec §23.2) | "Subset of PDF/X-1a, PDF/X-4, PDF/A-1b, PDF/A-2b — see Help for the shipped rule set."                                                               |
| `docs/user-guide.md` (Wave 12 Nathan)  | "What we check, what we don't" subsection — must enumerate the 30 shipped rules + the §4 not-shipped list                                            |
| `README.md` (Wave 12 Nathan)           | Feature-list footnote: "Preflight: validates against compliant subset of PDF/X-1a, PDF/X-4, PDF/A-1b, PDF/A-2b (≈30 rules); not full ISO compliance" |

Julian's Wave 11 review (project-plan §Wave 11, R11) re-confirms the four locations all match. Any drift between them is a finding.

---

## 8. Open questions

1. **PDF/X-3 / PDF/A-1a.** Should we add either as a follow-up phase? **Default for v0.8.0: no**. X-3 is RGB-friendly (some markets prefer X-3 over X-1a); A-1a adds tagging. Track for v0.9.x.
2. **Per-image DPI check** for print prep. Acrobat ships this. We'd need a raster pass per image. **Default for v0.8.0: no** — performance cost on 1064-page docs is non-trivial. Track for v0.9.x.
3. **Output intent registry validation.** Acrobat ships a registry of valid PDF/X output intent identifiers. **Default: no** — we accept any well-formed entry; the registry adds dependency drag for marginal benefit. Document the gap in user-guide.

End of preflight spec.
