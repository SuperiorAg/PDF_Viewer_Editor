# PDF_Viewer_Editor — Project Plan (Phase 7.5: Close the Acrobat Parity Gap)

**Author:** Marcus (Chief Delivery Officer)
**Date:** 2026-06-17 (revised same-day after principal "do all" ruling)
**Status:** **APPROVED.** Principal answered "do all" on every open question. Dispatching waves.
**Supersedes:** the Phase 1 plan that previously lived here (Phase 1 shipped 2026-05-21; the durable record is in `docs/build-report.md` and `docs/project-roadmap.md`). Plan history before this revision is preserved in git.

## Principal's rulings (2026-06-17)

The principal answered "do all" on the four open questions from §10 of the prior draft. Interpreted maximalist:

1. **Defer-or-ship calls — SHIP EVERYTHING.** Read Aloud (TTS), Preflight (PDF/X + PDF/A), and the full accessibility-authoring suite (Tag PDF, Reading Order, Alt Text editor, Accessibility Checker) move from defer back into scope. Spell Check + Document Properties dialog stay in. Net effect: **+4 implementation waves** (Wave 5a TTS+Preflight; Waves 5b+5c+5d accessibility authoring).
2. **B8 password encryption — BUNDLE QPDF.** Apache-2.0, ~5–10 MB per OS in the installer. License vetted by Diego in Wave 11.
3. **Release model — CUT v0.8.0 at phase close.** Minor bump, not patch. Wave 13 release ceremony per the Hard-Won Playbook.
4. **L-007 tool-registry lock — LAND IN WAVE 11.** Overrides the audit's §5.4 advice to defer. The principal wants the ratchet now.

## Inputs read

- `docs/acrobat-parity-audit.md` (Riley, 588 lines, 2026-06-15) — parity matrix §2, tool-marking audit §3, Bucket A/B/C recommendations §4, tool-registry proposal §5, 10 surprises §6.
- `docs/acrobat-comparison.html` — principal-facing comparison page (Bucket B1 Redaction now ✅).
- `docs/project-roadmap.md` — Phases 1–7 shipped (v0.7.20); Phase 7.1 + 7.2 hardening closed.
- `D:\Projects\CLAUDE.md` + `D:\Projects\PDF_Viewer_Editor\CLAUDE.md` — swarm rules, file ownership, commit cadence lesson (2026-05-28 batched-commit corruption).
- `.learnings/locked-instructions.md` (L-001..L-006) — every wave below honors these. L-007 lands in Wave 11.
- `.learnings/learnings.jsonl` — recent entries through 2026-06-15 (Phase 7.4 B1 Redaction Wave 1–4 retrospectives; `as any` parallel-wave coordination scar; rebuild-from-scratch sanitize pattern; packaged-smoke gate fix).
- Cross-project Hard-Won Playbook: parallel-write JSONL log contention (mitigation: serialize post-flight log writes through Marcus); release ceremony as separate post-Wave-N dispatch.

---

## 0. TL;DR

- **Wave count:** **13 waves** (1 design; 2–10 implementation; 11 packaging + review; 12 docs; 13 release ceremony for v0.8.0). All deferred items now in scope per the principal's "do all" ruling.
- **Total estimated hours:** **~152 engineering hours** across the swarm (Riley ~44h, David ~64h, Ravi ~6h, Diego ~16h, Julian ~12h, Nathan ~10h). Wall-time with parallelism: ~8–10 working days if no rework, ~12–14 realistic. Up from the prior ~96h estimate because TTS, Preflight, and the four accessibility-authoring features all re-enter scope.
- **Acceptance criteria, every wave:** typecheck green; full vitest suite green; the 1064-page test PDF opens + scrolls + interacts without regression (virtualized rendering preserved); no AGPL/commercial dep added; locked-instructions hold; commit per coherent unit per the 2026-05-28 lesson.
- **Release:** **v0.8.0** at Phase 7.5 close. Minor bump justified by the parity-close scope.

---

## 1. Scope — every feature now in (principal "do all" ruling)

### Bucket A (quick wins) — Wave 2

- **A1** Refresh stale tooltips; delete dishonest `phase3()` toasts; wire Insert → Blank Page / Page from File menu items to real dispatchers; wire toolbar Shapes button to the shape sub-toolbar.
- **A2** i18n-wrap the 8 shape sub-toolbar buttons + container ARIA label (en-US + es-ES).
- **A3** Add missing shortcut suffixes to tooltips; register `Alt+B` / `Alt+O` / `Alt+C` for Bookmarks edit / Run OCR / Combine.
- **A4** Add menu mirrors for 9 toolbar-only items.
- **A5** Add Cursor / Hand-tool button (V) to toolbar.
- **A6** Wire Ctrl+1 (Fit width) + Ctrl+2 (Fit page) to real handlers.
- **A7** Add top-level "Find a tool…" search affordance (Ctrl+/) — depends on tool registry R1.

### Bucket B (ship now) — Waves 2–7

- **B2** Compare Files (text + visual diff)
- **B3** Find / Search (Ctrl+F, F3 / Shift+F3, match counter, case + whole-word)
- **B4** Watermark / Header & Footer / Background
- **B5** Crop Pages
- **B6** Compress / Optimize PDF
- **B7** Stamps + Stamp library
- **B8** Password encryption + permission restrictions — **qpdf-bundled** (carries Document Properties dialog Security tab)
- **B9** Action Wizard (surface the existing edit-replay engine)
- **B10** Extract / Split / Replace pages
- **B11** Insert pages from another PDF
- **B12** Page-content Cut/Copy/Paste
- **B13** Hyperlinks (add/edit/remove)
- **B14** Spell check (`nspell` + Hunspell en-US + es-ES, permissive)
- **B15** Page Display modes (single, two-up, scroll, facing)
- **B16** View-only rotation + true Read Mode (F11 chromeless)
- **B17** Area measure tool
- **B18** Edit text & images — font swap
- **B19** Auto-bookmarks from headings
- **B20** Remove hidden information / sanitize
- **B21** Document Properties dialog

### Bucket C — NOW IN SCOPE per principal "do all" ruling (Waves 5a–5d)

- **C1** Read Aloud (TTS via Windows SAPI / Web Speech API fallback) — Wave 5a
- **C2** Preflight (PDF/X + PDF/A compliance checker) — Wave 5a
- **C3** Tag PDF (semantic structure tree authoring) — Wave 5b
- **C4** Reading Order editor — Wave 5c
- **C5** Alt Text editor — Wave 5c
- **C6** Accessibility Checker (rules engine + report) — Wave 5d

### Marking foundation (cross-cutting; Wave 1 + Wave 2)

- **R1** `src/client/tools/registry.ts` declarative tool registry per audit §5.2.
- **R2** Four convention-enforcing vitest contract tests per audit §5.3.
- **R3** Convention update in `docs/conventions.md` §X for "well-marked tool" definition.
- **L-007** Tool-registry lock — lands in Wave 11 (principal override of audit §5.4 defer).

### Still explicitly NOT shipping (orthogonal to parity gap; honest defer)

- HTML / RTF / XML / EPS export — niche output formats; Word + Excel + PPT + image trio covers 95% of demand. Tracked.
- Audio comment recording — desktop-niche; not a top-3 user ask.
- PDF Portfolio — Adobe-proprietary container; weak open-source story.
- New Window / Cascade / Tile (multi-doc) — single-doc architecture today; pair with future tabs feature.
- Native TWAIN binding — no clean MIT/Apache binding (revisit when one surfaces). Ship A1 marking fix only.
- Distribute form (email-aggregation) — cloud-adjacent; principal cloud exclusion.
- JavaScript form actions — by-design stripped on save per security policy §14.6.
- Adobe Sign / Send for E-signature — cloud; principal cloud exclusion.
- Cloud storage pickers (Dropbox / Drive / OneDrive / Box) — cloud; principal cloud exclusion.

Nathan documents every defer above in `docs/user-guide.md` Wave 12 — honest disclosure.

---

## 2. Wave plan (13 waves)

Order chosen for **file-ownership independence within parallel waves** and **dependency-correct sequencing** (B3 Find precedes search-and-redact; tool registry R1 precedes A7 search affordance; encryption B8 precedes Document Properties because Properties' Security tab is the carrier; Tag PDF precedes Accessibility Checker because the rules engine reads the structure tree).

```
Wave 1  (sequential)          Riley                design docs + tool registry spec
Wave 2  (parallel — 3 agents) Riley + David + Ravi marking foundation + Bucket A + B3 + B15 + B16 + B5/B10/B11 + migration 0009
Wave 3  (parallel — 2 agents) Riley + David        B7 Stamps + B17 Area measure + B12 + B4 engine
Wave 4  (parallel — 2 agents) Riley + David        B4 UI + B13 + B6 + B19 engine
Wave 5  (parallel — 2 agents) Riley + David        B8 + B20 + B21 + B18 engine
Wave 5a (parallel — 2 agents) Riley + David        C1 Read Aloud (TTS) + C2 Preflight
Wave 5b (parallel — 2 agents) Riley + David        C3 Tag PDF (structure tree authoring)
Wave 5c (parallel — 2 agents) Riley + David        C4 Reading Order + C5 Alt Text editor
Wave 5d (parallel — 2 agents) Riley + David        C6 Accessibility Checker (rules + report)
Wave 6  (parallel — 2 agents) Riley + David        B9 Action Wizard + B14 Spell check + B18 UI
Wave 7  (parallel — 2 agents) Riley + David        B2 Compare Files
Wave 11 (parallel — 2 agents) Diego + Julian       packaging + qpdf bundle + L-007 lock + review
Wave 12 (sequential)          Nathan               README + user-guide + developer-guide
Wave 13 (sequential)          Diego                release ceremony — v0.8.0 cut
```

Wave numbering note: I keep the **5a/5b/5c/5d** subscripts (not renumbering to 8/9/10/11) so the `docs/build-report.md` audit trail of the principal's "do all" ruling stays explicit — the lettered waves are the ones added because of the maximalist decision. The packaging + review wave is **Wave 11** (not Wave 8 as in the prior draft) because there are now four more implementation waves between Wave 7 and the packaging gate.

### Per-wave detail

#### Wave 1 — Architecture & Marking Foundation (Riley, sequential)

**Inputs:** this plan, audit doc, comparison HTML, locked instructions L-001..L-006, existing `docs/architecture-phase-7.md`.

**Deliverables:**

1. `docs/architecture-phase-7.5.md` — top-level Phase 7.5 architecture: which engines are pure pdf-lib vs need new deps (B8 qpdf subprocess, B14 nspell, C1 SAPI/WebSpeech, C2 Preflight, C3–C6 structure tree); where the tool registry lives; how Action Wizard reuses replay-engine; how the accessibility-authoring suite stores structure tree side-table vs in-PDF `/StructTreeRoot`.
2. **Updates** to `docs/api-contracts.md` — new IPC channels (B + C buckets):
   - `pdf:cropPages`, `pdf:extractPages`, `pdf:splitDocument`, `pdf:replacePages`, `pdf:insertPagesFromFile`
   - `pdf:applyWatermark`, `pdf:applyHeaderFooter`, `pdf:applyBackground`
   - `pdf:compressDocument`
   - `pdf:setPasswordProtection`, `pdf:removeHiddenInfo`, `pdf:getDocumentProperties`, `pdf:setDocumentProperties`
   - `pdf:compareDocuments`
   - `pdf:applyStamp`
   - `pdf:findInDocument`
   - `pdf:replayActionScript`, `pdf:recordActionScript`
   - `pdf:spellCheckRange`
   - `pdf:autoBookmarkFromHeadings`
   - `pdf:editLinks`
   - `pdf:swapEmbeddedFont`
   - **C bucket:** `tts:speakText`, `tts:listVoices`, `tts:pause`, `tts:resume`, `tts:stop` (C1)
   - `pdf:runPreflight` (C2)
   - `pdf:getStructTree`, `pdf:setStructTree`, `pdf:autoTagPages` (C3)
   - `pdf:getReadingOrder`, `pdf:setReadingOrder` (C4)
   - `pdf:setAltText`, `pdf:listFiguresWithoutAltText` (C5)
   - `pdf:runAccessibilityCheck` (C6)
3. **Updates** to `docs/data-models.md` — SQLite migration `0009_phase7.5.sql` (Ravi):
   - `stamps_library`, `find_history`, `action_wizard_scripts`, `compare_sessions`
   - `tts_voice_prefs` (per-locale preferred voice + rate + pitch)
   - `accessibility_check_history` (recent rule-set results per doc hash)
4. **New** `docs/ui-spec-phase-7.5.md` — per-feature UI specs: Find bar, Compare Files split panel, Watermark/H&F/Background modal, Crop overlay, Document Properties dialog, Stamps panel, Action Wizard, Find-a-tool palette, **Read Aloud floating toolbar (C1), Preflight report panel (C2), Tag PDF tree editor (C3), Reading Order overlay (C4), Alt Text inspector (C5), Accessibility Check report panel (C6).**
5. **New** `docs/tool-registry-spec.md` — `ToolDef` interface from audit §5.2 + the four enforcement tests from §5.3 + migration plan. Marks the L-007 lock candidate (the lock itself lands in Wave 11).
6. **Updates** to `docs/conventions.md` — section X "Well-marked tools" per audit §5.1.
7. **New** `docs/accessibility-authoring-spec.md` — the structure-tree model, how Tag PDF / Reading Order / Alt Text / Accessibility Checker compose, where the side-table lives (SQLite for in-progress edits) vs the in-PDF `/StructTreeRoot` on Save.
8. **New** `docs/preflight-spec.md` — PDF/X + PDF/A rule subset we ship in Wave 5a; explicit "compliant subset" disclosure for Nathan to surface honestly.

**Estimated hours:** Riley ~14h (up from ~10h to absorb the C bucket design surface).

---

#### Wave 2 — Marking Foundation + Bucket A + Find + Page Display + Read Mode + Page Ops Stage 1 (parallel)

Three agents, **no file overlap**:

- **Riley** (~6h):
  - R1 + R2 + R3 marking foundation.
  - A1–A7.
  - B3 Find/Search, B15 Page Display, B16 Read Mode.
  - Owned files per prior draft.
- **David** (~5h):
  - B5 Crop, B11 Insert pages from file, B10 Extract/Split/Replace.
  - IPC handlers, contracts, preload exposure.
- **Ravi** (~2h):
  - Migration 0009 (+ tts_voice_prefs + accessibility_check_history tables added per principal "do all").
  - Repos.

**Acceptance:** typecheck + vitest green; four `registry.contract.test.ts` tests pass; A1 stale-tooltip test catches zero strings; 1064-page open + virtualized scroll fast; Find finds across all pages; per-agent commits (3 this wave).

---

#### Wave 3 — Stamps + Watermark Engine + Area Measure + Page-Content Clipboard (parallel)

- **Riley** (~4h): B7 Stamps UI, B17 Area measure, B12 Cut/Copy/Paste, registry entries, i18n.
- **David** (~5h): B7 Stamp engine + asset bundle, B4 page-design engine, IPC handlers.

**Acceptance:** stamps render on 1064-page test PDF (virtualized); watermark/H&F/Background apply-to-range works; vitest + typecheck green.

---

#### Wave 4 — Watermark UI + Compress + Hyperlinks + Auto-bookmarks Engine (parallel)

- **Riley** (~3h): B4 modal UI, B13 Hyperlinks UI.
- **David** (~5h): B6 Compress engine, B13 link engine, B19 auto-bookmark engine.

**Acceptance:** compress on 1064-page PDF produces meaningfully smaller file without corruption; link round-trips; auto-bookmark heuristic returns reasonable tree; vitest + typecheck green.

---

#### Wave 5 — Document Properties + Encryption + Sanitize + Font Swap (parallel)

- **Riley** (~4h): B21 Document Properties UI, B8 Security tab UI, B19 auto-bookmark UI, B20 sanitize UI.
- **David** (~6h): B8 encryption engine via qpdf subprocess (Apache-2.0; principal-confirmed bundle); B20 sanitize via rebuild-from-scratch; B18 font-swap engine; `pdf:getDocumentProperties`/`setDocumentProperties` handlers.

**Acceptance:** encrypted PDF round-trips (encrypt → re-open → verify); sanitize wipes expected categories without corruption; vitest + typecheck green. **Diego is on standby for qpdf binary bundling glue** — Wave 11 finalizes, but Wave 5 produces the subprocess-spawn code path against an assumed binary location (`process.resourcesPath + '/qpdf/qpdf(.exe)'`).

---

#### Wave 5a — Read Aloud (TTS) + Preflight (parallel) — NEW per principal "do all"

- **Riley** (~5h):
  - **C1** Read Aloud floating toolbar (play / pause / resume / stop / rate slider / voice picker), text-layer selection → speech, sentence highlighting as TTS advances.
  - **C2** Preflight report panel (rule-by-rule pass/fail list, per-page navigation to failures, export report as JSON).
  - Owned files: `src/client/components/read-aloud-bar/` (NEW), `src/client/components/preflight-panel/` (NEW), tool-registry entries, i18n.
- **David** (~6h):
  - **C1** TTS engine: Windows SAPI via `node-windows-tts` or PowerShell `System.Speech.Synthesis` subprocess; macOS `say` subprocess; Linux `espeak` subprocess fallback. Voice list cached per-OS. IPC: `tts:speakText`, `tts:listVoices`, `tts:pause`, `tts:resume`, `tts:stop`.
  - **C2** Preflight rules engine: PDF/X subset (PDF/X-1a, PDF/X-4) + PDF/A subset (PDF/A-1b, PDF/A-2b) — color space / font embedding / transparency / metadata / encryption rule checks via pdf-lib. Returns rule-by-rule pass/fail report.
  - Owned files: `src/main/tts/tts-engine.ts` + per-OS adapters, `src/main/pdf-ops/preflight-engine.ts` + rule modules, IPC handlers.

**License vet (Diego Wave 11 second-pass):** SAPI = OS-bundled; `say` = OS-bundled; `espeak` = GPL-3 — **CAUTION:** GPL-3 subprocess-only usage is normally OK (we shell out, we don't link), but Diego must confirm in Wave 11 that the bundled-installer pathway does not redistribute `espeak` binaries. If it does, ship only SAPI + `say` and degrade gracefully on Linux. **Preflight engine is pure pdf-lib — zero new deps.**

**Acceptance:** TTS reads selected text on Windows with at least one default SAPI voice; Preflight on a known PDF/A-1b-compliant file returns all-pass; Preflight on a known-failing file returns the expected rule fails. Vitest + typecheck green.

---

#### Wave 5b — Tag PDF (structure tree authoring) — NEW per principal "do all"

- **Riley** (~6h):
  - **C3** Tag PDF tree editor — sidebar panel showing the document's structure tree (`/StructTreeRoot`); drag-and-drop tag re-parenting; add / rename / delete tags; auto-tag-from-content button (heuristic).
  - Owned files: `src/client/components/tag-tree-editor/` (NEW), tool-registry, i18n.
- **David** (~7h):
  - **C3** Structure tree engine: read existing `/StructTreeRoot` via pdf-lib (low-level dictionary access); write back to `/StructTreeRoot` on Save; heuristic auto-tag-from-content (font-size cluster + position-on-page → P / H1 / H2 / Figure / Table).
  - IPC: `pdf:getStructTree`, `pdf:setStructTree`, `pdf:autoTagPages`.
  - Owned files: `src/main/pdf-ops/struct-tree-engine.ts`, `src/main/pdf-ops/auto-tag-heuristic.ts`, IPC handlers.

**Acceptance:** open a tagged PDF, structure tree displays correctly; add a tag, re-save, re-open, the tag persists. Auto-tag on the 1064-page test PDF returns a reasonable tree (P/H1/H2 buckets). Vitest + typecheck green.

---

#### Wave 5c — Reading Order + Alt Text editor — NEW per principal "do all"

- **Riley** (~5h):
  - **C4** Reading Order overlay — numbered badges on each content block in render order; drag-to-reorder; "auto-detect from layout" button.
  - **C5** Alt Text inspector — list of all `/Figure` structure elements without alt text; per-figure alt-text input; quick "set bulk alt text" for repeated images (logo, decorative).
  - Owned files: `src/client/components/reading-order-overlay/` (NEW), `src/client/components/alt-text-inspector/` (NEW), registry, i18n.
- **David** (~5h):
  - **C4** Reading order engine: rewrites the structure-tree element order to match user-defined sequence; round-trip through Save.
  - **C5** Alt-text engine: maps `/Alt` strings to `/Figure` struct elements; list-figures-without-alt-text query; bulk-set helper.
  - IPC: `pdf:getReadingOrder`, `pdf:setReadingOrder`, `pdf:setAltText`, `pdf:listFiguresWithoutAltText`.
  - Owned files: `src/main/pdf-ops/reading-order-engine.ts`, `src/main/pdf-ops/alt-text-engine.ts`, IPC handlers.

**Acceptance:** reorder reading order on a 5-page PDF, re-save, re-open, the order persists; set alt text on a figure, re-save, re-open, the alt text persists. Vitest + typecheck green.

---

#### Wave 5d — Accessibility Checker (rules + report) — NEW per principal "do all"

- **Riley** (~5h):
  - **C6** Accessibility Check report panel — rule-by-rule pass/fail with quick-fix links (jump to Tag editor, Reading Order overlay, Alt Text inspector); export report as JSON / HTML; per-issue navigation.
  - Owned files: `src/client/components/accessibility-check-panel/` (NEW), registry, i18n.
- **David** (~6h):
  - **C6** Accessibility rules engine: WCAG 2.1 + PDF/UA-1 rule subset — document title set, language set, structure tree present, all figures tagged with alt text, table headers identified, reading order defined, color contrast (warn-only on this one — needs raster sample), no scanned-only pages without OCR, no JS form actions. Each rule returns a `RuleResult { id, severity, message, locations: [pageRefs] }`.
  - IPC: `pdf:runAccessibilityCheck`.
  - Owned files: `src/main/pdf-ops/accessibility-rules/` (NEW directory, one rule per file ≤200 lines), `src/main/pdf-ops/accessibility-engine.ts`, IPC handler.

**Acceptance:** run check on a known-accessible PDF returns all-pass; run on the 1064-page test PDF returns the expected rule fails (will likely fail on missing alt text + missing language tag — verify the failure shape matches what the rules engine emits). Vitest + typecheck green.

---

#### Wave 6 — Action Wizard + Spell Check + Font-Swap UI (parallel)

- **Riley** (~3h): B9 Action Wizard UI, B14 Spell-check UI, B18 font-swap UI.
- **David** (~5h): B9 Action runner via existing replay-engine; B14 nspell + Hunspell en-US + es-ES.

**Acceptance:** Record-replay round-trip works; spell-check flags known misspellings; vitest + typecheck green.

---

#### Wave 7 — Compare Files (parallel)

- **Riley** (~4h): B2 Compare Files UI.
- **David** (~3h): B2 engine via diff-match-patch (Apache-2.0) + pixelmatch (MIT), lazy per-page on viewport.

**Acceptance:** compare against known pair returns correct per-page summary; viewport stays responsive (no eager rasterize); vitest + typecheck green.

---

#### Wave 11 — Packaging + Code Review + L-007 Lock (parallel)

- **Diego** (~10h, up from ~6h to absorb qpdf bundling + L-007 enforcement plumbing + the C-bucket dep license vet):
  - **qpdf binary bundling.** Apache-2.0 verified; per-OS binaries downloaded at install-build time + pinned by SHA256; `electron-builder.yml` `extraResources` configuration; binary discovery at runtime via `process.resourcesPath` + per-OS suffix. Installer size delta documented. Cross-platform verification: Windows-mandatory; mac + Linux configured-but-unverified per the Phase 7 convention.
  - **License manifest update** — every new dep verified MIT/Apache/BSD/permissive-only:
    - diff-match-patch (Apache-2.0)
    - pixelmatch (MIT)
    - sharp (Apache-2.0) if newly added
    - nspell (MIT)
    - Hunspell `.aff/.dic` en-US (MIT scowl) + es-ES (per-source vet, fall back to en-US-only if blocked)
    - qpdf (Apache-2.0)
    - **TTS:** OS-bundled SAPI / `say` (no license issue); **`espeak` on Linux — Diego CONFIRMS no binary redistribution** (subprocess-only call, user installs separately) OR ships SAPI + `say` and degrades on Linux.
  - **L-007 tool-registry lock plumbing** — per the principal's Wave 8 ruling overriding audit §5.4: ratchet script `scripts/ratchet-tool-registry-coverage.mjs` that fails CI if any user-facing toolbar button / menu item / shape sub-toolbar entry is NOT declared in `src/client/tools/registry.ts`. Lock entry written to `.learnings/locked-instructions.md` as L-007 with all the standard sections (constraint / why / enforcement / affected files / unlock).
  - `electron-builder.yml` size budget check — quantify the cumulative installer growth from qpdf + Hunspell dicts + stamp PNG bundle + any C-bucket asset.
  - CI matrix update — new e2e specs for C1 TTS + C6 Accessibility Check land.
  - Re-run packaged-smoke spec against `release/smoke-v*/win-unpacked/` once packaging dry-run completes.
- **Julian** (~8h, up from ~6h to cover the four C-bucket waves):
  - Full code review across Waves 2–7 + Waves 5a–5d. Findings to `docs/code-review.md`.
  - **Mandatory checks:** rebuild-from-scratch over strip-post-hoc for every new sanitize-class op (B6, B20, B8 round-trip); no `as any` parallel-wave coordination scars (the 2026-06-15 Phase-7.4 B1 finding pattern); tool-registry contract tests not weakened; new IPC contracts shape-match preload exposure; honesty clause holds (no `success` while a smoke test is red).
  - **L-007 review** — the lock text Diego drafts and the ratchet script; Julian's verdict required before commit.
  - License audit second-pass (independent of Diego's). **GPL-3 espeak subprocess pattern explicitly reviewed** — Julian confirms or rejects the no-redistribution argument.
  - Accessibility-rules engine review — make sure the rule set is honest about WCAG 2.1 / PDF/UA-1 coverage subset (don't claim full compliance if we only ship a subset).

**Acceptance:** Diego packaging dry-run succeeds; Julian verdict GO or GO-with-follow-up; L-007 lock entry written + ratchet green; license manifest signed off.

---

#### Wave 12 — Documentation (Nathan, sequential)

- **Nathan** (~10h, up from ~6h to cover the C bucket):
  - README updates — feature list reflects parity-closed state including TTS + Preflight + Accessibility-authoring.
  - `docs/user-guide.md` — new sections: Find / Compare / Watermark / Crop / Extract / Split / Stamps / Action Wizard / Document Properties / Encrypt / Spell Check / **Read Aloud / Preflight / Tag PDF / Reading Order / Alt Text / Accessibility Check.**
  - `docs/developer-guide.md` — tool registry pattern + how to add a new tool + the four marking contract tests + **the structure-tree side-table pattern + the accessibility rules engine extension pattern.**
  - `docs/api-reference.md` — every new IPC channel (B + C buckets).
  - **Honest defer disclosure:** every item in §1 "still NOT shipping" gets a one-paragraph "what we don't do" entry in `docs/user-guide.md` so users know what's tracked-but-deferred.
  - Update `docs/project-roadmap.md` — Phase 7.5 ✅ SHIPPED; v0.8.0 milestone; remaining defers honestly listed.

**Acceptance:** lint green; every new IPC channel + every new feature has at least one user-facing paragraph; deferred items disclosed honestly; trust-floor obligations preserved (per the 2026-05-28 Nathan trust-floor pattern).

---

#### Wave 13 — Release ceremony — v0.8.0 cut (Diego, sequential)

Per the Hard-Won Playbook standing rule (release ceremony is always a separate post-Wave-N dispatch). 15-step runbook from `D:\Vault\Agents\Projects\PDF_Viewer_Editor\Runbooks\release-ceremony.md`. **Mandatory L-002 PrintWindow capture.** Build-report row mandatory. Handoff-seam acknowledgment paragraph mandatory. Post-flight JSONL returned to Marcus (do NOT let Diego append directly — Playbook §1 serialization rule).

**Version bump:** `0.7.20` → `0.8.0`. Commit message: `chore(release): v0.8.0 — Phase 7.5 Acrobat parity close`.

---

## 3. Per-wave acceptance criteria (rolled up)

Every wave must satisfy ALL of:

1. `npm run typecheck` green.
2. `npm run lint` green.
3. Full vitest suite green (no skipped tests added without an explicit follow-up TODO + reason).
4. The 1064-page test PDF: opens within historical baseline (no regression vs commits `8761167`, `8d783ab`, `f70797e`, `2fb34e4`); scrolls + zooms + thumbnails responsive; new feature doesn't eager-render or eager-measure all pages (virtualization preserved).
5. No new AGPL or commercial-license dep added. Each new dep license-vetted in Diego's manifest.
6. Locked instructions L-001..L-006 all hold (pre-commit hook + CI both enforce); L-007 lands in Wave 11 and holds from then.
7. Commits land at end-of-wave per agent (the 2026-05-28 lesson — no parallel work batched into one deferred commit).
8. Per-wave post-flight log entry returned to Marcus as JSON; Marcus appends serially (Hard-Won Playbook §1).
9. Honesty clause: agent reports `success` only if (1)–(8) above truly hold. No self-deception.

---

## 4. Risk register (updated for "do all")

| #   | Risk                                                                                                                                                                      | Likelihood    | Impact | Mitigation                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | qpdf binary bundling adds ~5–10 MB per OS to the installer.                                                                                                               | **Confirmed** | Medium | Principal approved bundle. Diego documents the size delta in Wave 11 build-report row.                                                                                                                                                                                                                                            |
| R2  | B2 Compare Files memory cost on 1064-page docs.                                                                                                                           | High          | High   | Lazy per-page on viewport; pixelmatch only on pages with text-diff hits AND only on user navigation. Acceptance criterion #4 enforces.                                                                                                                                                                                            |
| R3  | B14 Spell check dictionary licenses (es-ES varies).                                                                                                                       | Medium        | Medium | License-vet per locale in Wave 11; ship only locales with permissive dicts; degrade gracefully (no underline) for unshipped locales.                                                                                                                                                                                              |
| R4  | Tool registry retrofit large diff.                                                                                                                                        | Medium        | Medium | Riley structures the migration as registry-additive then UI-cutover in two commits within Wave 2; Julian reviews the cutover diff.                                                                                                                                                                                                |
| R5  | B9 Action Wizard schema drift vs existing `replay-engine.ts`.                                                                                                             | Medium        | High   | Wave 1 design doc captures `v1.actionScript` schema with `schemaVersion`; future engine changes get a migration test.                                                                                                                                                                                                             |
| R6  | B6 Compress + B20 Sanitize — pdf-lib catalog leftover artifacts.                                                                                                          | High          | Medium | Mandatory rebuild-from-scratch per Julian's Wave 11 review gate.                                                                                                                                                                                                                                                                  |
| R7  | Parallel-write JSONL log contention.                                                                                                                                      | High          | Low    | Each agent returns its log entry as JSON to Marcus; Marcus appends serially. Brief forbids direct write.                                                                                                                                                                                                                          |
| R8  | `as any` parallel-wave coordination scars.                                                                                                                                | Medium        | Low    | Each wave's downstream agent lands a cleanup commit removing any `as any` before wave join; Julian's Wave 11 review files explicit finding for any leftover cast.                                                                                                                                                                 |
| R9  | TWAIN binding unavailable — defer per audit §6.9.                                                                                                                         | n/a           | n/a    | Explicit defer; A1 marking fix only; Nathan documents OS-scan-then-import workflow.                                                                                                                                                                                                                                               |
| R10 | **C1 TTS on Linux — espeak GPL-3.**                                                                                                                                       | Medium        | Medium | **Subprocess-only call (we shell out, we don't link) is normally OK for GPL.** Diego confirms in Wave 11 that the bundled installer does NOT redistribute espeak binaries. If bundle redistribution required, ship SAPI + `say` only; Linux degrades gracefully.                                                                  |
| R11 | **C2 Preflight rule subset.** Real Preflight is hundreds of rules; we ship a subset.                                                                                      | Medium        | Low    | Wave 1 `docs/preflight-spec.md` explicitly documents which rules ship; Nathan surfaces "we ship a compliant subset, not the full PDF/X / PDF/A rulebook" honestly in user-guide. Same trust-floor pattern Nathan applied for Phase 7 telemetry.                                                                                   |
| R12 | **C3–C6 structure-tree round-trip on docs with existing tags.** Risk: we overwrite an author's existing structure tree and lose data.                                     | High          | High   | Wave 5b reads existing `/StructTreeRoot` before allowing edits; Diego adds a regression test that round-trips a known-tagged PDF (e.g. tagged via Adobe Acrobat) through Tag PDF UI without data loss. Save-as-copy by default when an existing structure tree is detected; user opts in to overwrite.                            |
| R13 | **C6 Accessibility Checker honesty.** Claiming WCAG/PDF-UA compliance when we ship a subset is the worst kind of marking lie.                                             | Medium        | High   | Wave 1 design doc enumerates the rule subset; Wave 5d UI clearly labels "Subset of WCAG 2.1 / PDF/UA-1 rules — see docs"; Nathan documents the subset explicitly. Julian reviews the rule-set claims in Wave 11.                                                                                                                  |
| R14 | **L-007 lock pre-flight risk.** Locking the registry before it's fully mature might trigger CI failures on legitimately-not-yet-registered tools that surface in Wave 11. | Medium        | Low    | Principal accepted this risk by overriding audit §5.4 advice. Mitigation: Wave 11 Diego implements the ratchet AND runs it against the post-Wave-7 codebase BEFORE writing the lock entry. Any gap surfaced is fixed in the same wave. The lock entry references "all post-Wave-10 toolbar/menu surfaces" as the canonical scope. |
| R15 | **Wall-time blowout.** 13 waves vs 9 in prior draft.                                                                                                                      | High          | Medium | Per-wave honesty + commit cadence + parallel dispatch where independent. Principal aware of the tradeoff; "do all" was explicit.                                                                                                                                                                                                  |

---

## 5. License-vet checklist (Diego Wave 11 — pre-merge gate)

| New dep                              | License     | Status to verify                                                                            |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------- |
| diff-match-patch                     | Apache-2.0  | ✅ permissive                                                                               |
| pixelmatch                           | MIT         | ✅ permissive                                                                               |
| sharp (image recompress)             | Apache-2.0  | ✅ permissive — confirm vendor status                                                       |
| nspell                               | MIT         | ✅ permissive                                                                               |
| Hunspell `.aff`/`.dic` en-US (scowl) | MIT         | ✅                                                                                          |
| Hunspell `.aff`/`.dic` es-ES         | varies      | ⚠️ vet per dictionary source                                                                |
| qpdf binary                          | Apache-2.0  | ✅ permissive; bundle-vet per-OS                                                            |
| fontkit                              | MIT         | ✅ already vendored via pdf-lib                                                             |
| Windows SAPI (TTS)                   | OS-bundled  | ✅ no licensing                                                                             |
| macOS `say` (TTS)                    | OS-bundled  | ✅ no licensing                                                                             |
| Linux espeak (TTS)                   | GPL-3       | ⚠️ **subprocess-only OK, NO BINARY REDISTRIBUTION** — Diego confirms or ships SAPI+say only |
| All-existing deps                    | (unchanged) | ✅ no AGPL/commercial introduced                                                            |

Any ⚠️ row blocks merge until remediated.

---

## 6. Marking foundation (R1+R2+R3+L-007) — non-negotiable in Wave 2 + lock in Wave 11

The audit §3 demonstrated "the menu lies" as a real failure mode. The registry + contract tests + conventions update mechanize prevention. Without these, every future tool recreates the marking debt.

- **R1** `src/client/tools/registry.ts` — `ToolDef` interface + all Phase 7.5 tools registered.
- **R2** `src/client/tools/registry.contract.test.ts` — four tests from audit §5.3.
- **R3** `docs/conventions.md` §X "Well-marked tools" — 7-dimension definition.
- **L-007** Tool-registry lock — lands in Wave 11 per the principal's override of audit §5.4. Diego drafts; Julian reviews; Marcus signs off; ratchet script lands in `scripts/ratchet-tool-registry-coverage.mjs`.

---

## 7. Inter-wave handoff format

Each wave's outputs feed the next via:

1. **Source code:** committed to `main` per agent at end-of-wave.
2. **Post-flight JSON log entry:** returned to Marcus (NOT written direct to `learnings.jsonl` — Playbook §1). Marcus appends serially.
3. **Open questions:** any "principal-confirm required" items surfaced in a wave-end message; Marcus aggregates and re-confirms with principal between waves if needed.

Marcus reviews Wave N before dispatching Wave N+1. If a wave's acceptance criteria fail, Marcus re-dispatches the responsible agent with a clear remediation brief rather than letting the next wave layer on.

---

## 8. Approval log

- 2026-06-17 — Marcus DRAFT submitted with four open questions.
- 2026-06-17 — Principal answered "do all": ship all Bucket C; bundle qpdf; cut v0.8.0; land L-007 in Wave 11. Plan updated. Dispatching Wave 1.
