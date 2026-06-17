# ARCHITECTURE — Phase 7.5 (Acrobat Parity Close + Marking Foundation)

**Author:** Riley (VP of Product Design & Frontend Engineering)
**Date:** 2026-06-17 (Wave 1, Phase 7.5)
**Status:** Wave 1 design, locked at end-of-wave. Build on top of Phase 1..7 frozen architecture and Phase 7.4 B1 (Redaction) deltas.
**Scope:** Architectural deltas for the 24 features the principal "do all" ruling brings into Phase 7.5: Bucket A marking quick wins (A1–A7); Bucket B parity closes (B2–B21); Bucket C accessibility + print-prep (C1–C6); the cross-cutting tool registry foundation (R1+R2+R3) plus its Wave-11-bound `L-007` lock.
**Reads:** `docs/project-plan.md` (Marcus, the contract for this wave), `docs/acrobat-parity-audit.md` (588 lines, Riley 2026-06-15), `docs/architecture-phase-7.md` (Phase 7 polish), `docs/phase-7.4-b1-redaction-design.md` (sanitize discipline reused by Bucket B), `docs/conventions.md` §13–§18, `.learnings/locked-instructions.md` L-001..L-006.

> **Companion documents.** This file describes the system-level additions and engine routing. Per-feature UI specs live in [`docs/ui-spec-phase-7.5.md`](ui-spec-phase-7.5.md). The accessibility-authoring suite (C3–C6) has its own deep design in [`docs/accessibility-authoring-spec.md`](accessibility-authoring-spec.md). The PDF/X + PDF/A rule subset (C2) is in [`docs/preflight-spec.md`](preflight-spec.md). The tool-registry data model + contract tests + cutover plan is in [`docs/tool-registry-spec.md`](tool-registry-spec.md). API contracts and SQLite delta land in `docs/api-contracts.md` §19 and `docs/data-models.md` §13 (this wave). Read all five together.

---

## 0. Scope

Phase 7.5 closes the documented parity gap vs Adobe Acrobat Pro DC (desktop, cloud excluded). It is **NOT** a polish phase — it adds 24 user-visible features, 41 new IPC channels, 6 new SQLite tables, and one cross-cutting renderer subsystem (the tool registry). Specifically:

1. **Marking foundation (R1 + R2 + R3, Wave 2).** Declarative `src/client/tools/registry.ts` becomes the canonical source of truth for every toolbar button / menu item / shape sub-toolbar entry / shortcut-only tool. Four Vitest contract tests enforce the 7-dimension "well marked" definition (`docs/conventions.md` new §19). The L-007 lock lands in Wave 11.
2. **Bucket A quick wins (A1–A7, Wave 2).** Stale tooltip refresh + dishonest placeholder removal; i18n on the shape sub-toolbar; missing shortcuts; toolbar↔menu mirror completion; Cursor/Hand tool button; Fit-width/Fit-page handlers; "Find a tool…" search palette (`Ctrl+/`) driven by the registry.
3. **Bucket B parity closes (B2–B21, Waves 2–7).** 20 features. Pure pdf-lib engines wherever possible; one subprocess dep (qpdf, Apache-2.0) for password encryption; one new pure-JS dep for spell check (nspell + Hunspell).
4. **Bucket C accessibility + print-prep (C1–C6, Waves 5a–5d).** Read Aloud (TTS via OS-bundled engines); Preflight (PDF/X + PDF/A subset, pure pdf-lib); the four-feature accessibility-authoring suite (Tag PDF, Reading Order, Alt Text, Accessibility Checker). C3–C6 share a single SQLite-backed structure-tree side-table that materializes to the in-PDF `/StructTreeRoot` on Save.
5. **L-007 tool-registry lock (Wave 11).** Principal override of audit §5.4 advice. Ratchet script (`scripts/ratchet-tool-registry-coverage.mjs`) fails CI if any user-facing tool is not registered.

Phase 1–7 chapters not amended remain authoritative. **No `EditOperation` variant added by this wave** — the new edits (apply watermark, crop, redact already shipped, etc.) become new variants in their respective per-feature designs but the union stays the same closed shape (extend, don't replace; the exhaustive-switch discipline in conventions §1.5 catches missing branches at compile time).

---

## 1. Locked decisions encoded (Wave 1 self-check)

| ID            | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                              | Encoded where                                                                             | Cross-ref                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **P7.5-L-1**  | **Tool registry is the canonical user-facing tool source of truth.** Every toolbar button, menu item, shape sub-toolbar entry, and shortcut-only tool MUST appear in `src/client/tools/registry.ts`. Toolbar/menu/shape-toolbar/search-palette are all renderers of the same registry.                                                                                                                                                                | §2.1, §2.2                                                                                | `docs/tool-registry-spec.md`; `docs/conventions.md` §19                             |
| **P7.5-L-2**  | **qpdf bundled, Apache-2.0, subprocess only.** B8 password encryption shells out to a per-OS qpdf binary at `process.resourcesPath + '/qpdf/qpdf(.exe)'`. We do NOT link qpdf as a library; we spawn-and-read. Diego verifies bundle license in Wave 11.                                                                                                                                                                                              | §4.4 (engine routing); `docs/preflight-spec.md` (independent — preflight is pure pdf-lib) | `docs/project-plan.md` §5 license-vet table; `.learnings/learnings.jsonl` (Wave 11) |
| **P7.5-L-3**  | **nspell + Hunspell `.aff`/`.dic` for B14 spell check, both MIT.** en-US ships from the SCOWL Hunspell project (MIT). es-ES is a Wave 11 vet — fall back to en-US-only if the chosen es-ES dictionary is not MIT/Apache/BSD. Dictionaries lazy-loaded per locale; never loaded for locales the user has not selected.                                                                                                                                 | §4.7                                                                                      | `docs/project-plan.md` §5 row "Hunspell es-ES"                                      |
| **P7.5-L-4**  | **TTS uses OS-bundled engines on Windows + macOS (SAPI + `say`).** Linux degrades gracefully when `espeak` is not installed (GPL-3 — subprocess-only call OK, but we do NOT redistribute the espeak binary in the bundle). Diego confirms in Wave 11.                                                                                                                                                                                                 | §4.5                                                                                      | `docs/project-plan.md` §5 row "Linux espeak"; R10                                   |
| **P7.5-L-5**  | **Accessibility-authoring side-table.** Tag PDF / Reading Order / Alt Text edits accumulate in a new SQLite `accessibility_edit_session` side-table during a session; on Save they materialize to the in-PDF `/StructTreeRoot`. **Save-as-copy by default** when an existing structure tree is detected (R12 mitigation).                                                                                                                             | §4.8; `docs/accessibility-authoring-spec.md`                                              | `docs/data-models.md` §13.4                                                         |
| **P7.5-L-6**  | **Action Wizard reuses `edit-replay-engine.ts`.** B9 is a surface, not a new engine. The recorder writes a `v1.actionScript` JSON document; the runner replays it via the existing replay-engine's deterministic dispatch path. New schema field `schemaVersion: 1` so future engine changes get a migration test (R5 mitigation).                                                                                                                    | §4.6; `docs/edit-replay-engine.md` (existing)                                             | `docs/project-plan.md` R5                                                           |
| **P7.5-L-7**  | **Compare Files (B2) is lazy per-page.** Text diff runs eagerly (cheap); pixel diff (`pixelmatch` MIT) runs only on the user's currently viewed page after the user clicks "Show visual diff" for that page. No eager rasterize of either document. Reuses Phase 5 rasterize pipeline with `loadPdfJs` helper (L-005 compliance).                                                                                                                     | §4.10                                                                                     | `docs/project-plan.md` R2                                                           |
| **P7.5-L-8**  | **Find/Search uses pdf.js TextLayer — no eager full-text index.** B3 builds the search index lazily, one page at a time as the user navigates or as Next/Prev advances. No background full-document index thread. Preserves the virtualized-rendering performance gate.                                                                                                                                                                               | §4.2                                                                                      | `docs/project-plan.md` §3 acceptance #4                                             |
| **P7.5-L-9**  | **C2 Preflight is a SUBSET of PDF/X and PDF/A.** Not full compliance. Honest disclosure ratchet: spec doc (`docs/preflight-spec.md`), UI label ("Subset of PDF/X-1a, PDF/X-4, PDF/A-1b, PDF/A-2b — see docs"), user-guide section, README front-door.                                                                                                                                                                                                 | §4.5 + `docs/preflight-spec.md`                                                           | R11                                                                                 |
| **P7.5-L-10** | **C6 Accessibility Checker is a SUBSET of WCAG 2.1 + PDF/UA-1.** Not full compliance. Same four-location honest-disclosure ratchet as P7.5-L-9.                                                                                                                                                                                                                                                                                                       | §4.9 + `docs/accessibility-authoring-spec.md`                                             | R13                                                                                 |
| **P7.5-L-11** | **L-007 lock lands in Wave 11.** Principal override of audit §5.4 advice. Lock text drafted by Diego, reviewed by Julian, ratchet script in `scripts/ratchet-tool-registry-coverage.mjs`.                                                                                                                                                                                                                                                             | §2.5; `docs/tool-registry-spec.md` §6                                                     | R14                                                                                 |
| **P7.5-L-12** | **B20 Sanitize uses rebuild-from-scratch.** Same pattern proven in Phase 7.4 B1 R1 Redaction (`commit:1078669`, David). Rebuild via `PDFDocument.create() + copyPages()` is strictly stronger than `catalog.delete()` because pdf-lib emits every object in `context.indirectObjects` regardless of reachability. Julian audits in Wave 11 — every new sanitize-class op (B6 Compress, B8 round-trip after encryption, B20) MUST follow this pattern. | §4.4; conventions.md §19.6                                                                | `.learnings/learnings.jsonl` 2026-06-15 David entry                                 |

**Cross-check vs locked instructions L-001..L-006:**

- **L-001** (`enableDragDropFiles: true`): Phase 7.5 does NOT touch `window-manager.ts`. The new "Compare Files" entry uses the existing `dialog:openPdf` channel for the second file — no drag-drop divergence.
- **L-002** (operator screenshot on packaging waves): Wave 11 Diego applies this to v0.8.0 candidate builds. Wave 13 release ceremony re-applies for the actual cut.
- **L-003** (Node 20 baseline): no Node-version sensitivity in this wave. nspell + Hunspell are pure JS. qpdf is a separate binary, not an npm dep.
- **L-004** (pdf.js `getDocument({data})` copy discipline): every new pdf.js call site (B2 Compare Files visual diff rasterize, B19 auto-bookmark heading detect via TextLayer, C2 Preflight color-space sample, C3 auto-tag-heuristic font-size analysis, C4 reading-order layout pass) routes through `toPdfJsBuffer` per the L-004 reference implementation. Diego's grep ratchet (`scripts/ratchet-getDocument-copy.mjs`) catches violations.
- **L-005** (`loadPdfJs` polyfills-before-import): every new pdf.js dynamic-import call site in this wave goes through `loadPdfJs`. No direct `await import('pdfjs-dist/…')` outside the sanctioned helper.
- **L-006** (`process.env.NODE_ENV` dot syntax for test-only IPC): Phase 7.5 adds NO new `__test:*` channels. No exposure surface to extend.

**Cross-check vs the four-times-bitten sentinel-default lesson (global JSONL 2026-05-26):** new state shapes use **nullable + late-init**, never sentinel:

- `ComparisonSession.lastDiffComputedAt: number | null` (null until first diff completes)
- `ActionScript.lastRunAt: number | null` (null until first run)
- `AccessibilityCheckResult.runAt: number` (always set — required on row insert; not a sentinel default)
- `TtsVoicePrefs.preferredVoiceId: string | null` (null until user picks; OS default used at runtime)
- `StampLibraryEntry.lastUsedAt: number | null` (null for never-used)

**Cross-check vs the stub-shipped-with-TODO lesson (global JSONL 2026-05-27):** Phase 7.5 has THREE places where the honesty-vs-stub distinction is load-bearing:

1. **Preflight rule subset** (P7.5-L-9). The Preflight engine ships a real, fully-implemented rule subset (~30 rules). It is not a stub — `runPreflight(handle)` returns rule-by-rule pass/fail for every shipped rule. What is honestly disclosed is the _scope of the subset_ (which rules we ship), not the _quality of the engine_ (the shipped rules truly work).
2. **Accessibility Checker subset** (P7.5-L-10). Same shape — ~12 real rules ship; disclosure is about scope, not stub-ness.
3. **Linux TTS** (P7.5-L-4). The Linux code path REAL-CALLS `espeak` when present, returns `'tts_engine_not_installed'` when absent. It is not a stub that returns fake success. The honest-failure variant is the correct response.

**Cross-check vs the `as any` parallel-wave coordination scar (Julian Phase 7.4 B1 finding 7.4.B1.1):** the tool-registry migration (R1 → UI cutover) is the highest-risk parallel-wave coordination point this wave has. Mitigation: registry-additive commit lands BEFORE any UI cutover commit (R4 mitigation in plan). Julian's Wave 11 review files an explicit finding for any leftover `as any` cast at the registry consumer site.

---

## 2. Tool registry — the marking foundation (R1 + R2 + R3, Wave 2; L-007 Wave 11)

### 2.1 Why a registry

The audit §3 ("the menu lies") documented six real marking-lie defects in shipped code: stale "Coming in Phase 3" tooltip on Find; Shapes button disabled after Phase 4 shipped; Insert→Blank Page menu item fires a "coming soon" toast while the toolbar variant actually inserts; Tools→Fill & Sign disabled with a stale tooltip; Scan tooltip mentions a phase that does not exist in the roadmap; shape sub-toolbar has zero i18n coverage. All six failures share a single root cause: each tool is "implemented" in 3–5 different files (toolbar/index.tsx, menu-bar/index.tsx, shortcuts.ts, i18n bundles, help-content.ts), with no compile-time check that the four representations agree.

The registry collapses these representations to one source of truth.

### 2.2 The shape (R1)

The `ToolDef` interface is reproduced verbatim from audit §5.2 in `docs/tool-registry-spec.md` §1. Key fields:

```ts
export interface ToolDef {
  id: ToolId; // stable identifier ('annotation:highlight', 'page:rotate-cw')
  nameKey: I18nKey; // namespaced i18n key for visible name
  tooltipKey: I18nKey; // namespaced i18n key for tooltip (includes shortcut text)
  ariaLabelKey: I18nKey; // namespaced i18n key for screen reader name
  icon: IconName | null; // Lucide-or-equivalent icon name; null for menu-only tools
  shortcutId: ShortcutId | null; // FK into shortcuts.ts (null for mouse-only tools)
  menu: { top: MenuTopId; section?: string }; // where it lives in the menu (REQUIRED)
  surfaces: {
    toolbar?: ToolbarGroupId;
    menu: boolean;
    contextMenu?: ContextMenuTargetId;
    palette: boolean; // appears in Ctrl+/ search (default true)
  };
  enabledWhen: (state: RootState) => boolean;
  dispatch: (dispatch: AppDispatch) => void;
  searchKeywords: string[]; // for "Find a tool…" fuzzy matcher
  deprecationNote?: string; // populated when a tool is retired/relocated
}
```

Full type set, ID nomenclature, `IntrinsicShortcutSet` (the page-nav / zoom shortcuts that are NOT tools), and a worked example for `'annotation:highlight'` live in `docs/tool-registry-spec.md`.

### 2.3 Renderers (R1 follow-on)

After the registry lands, four UI surfaces become **renderers of the same registry**:

| Surface                       | File                                                  | Reads                                                                                               |
| ----------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Main toolbar                  | `src/client/components/toolbar/index.tsx`             | All tools with `surfaces.toolbar !== undefined`, grouped by `ToolbarGroupId`                        |
| Menu bar                      | `src/client/components/menu-bar/index.tsx`            | All tools with `surfaces.menu === true`, grouped by `menu.top` + `menu.section`                     |
| Shape sub-toolbar             | `src/client/components/shape-tools/shape-toolbar.tsx` | All tools with `surfaces.toolbar === 'shapes'`                                                      |
| Find-a-tool palette (A7, new) | `src/client/components/tool-search-palette/`          | All tools with `surfaces.palette !== false`, fuzzy-matched on `nameKey`-resolved + `searchKeywords` |

This is the mechanism that closes the audit's §3 toolbar↔menu mirror drift: it is structurally impossible to add a toolbar button without also placing it in the menu, because both surfaces read the same `ToolDef`.

### 2.4 Contract tests (R2)

Four Vitest tests in `src/client/tools/registry.contract.test.ts`:

1. **Every tool is well marked.** All 7 dimensions present; i18n keys resolve in both en-US and es-ES.
2. **Tooltips advertise their shortcut.** Every tool with a `shortcutId` has its formatted shortcut text in its tooltip's en-US resolution.
3. **Every shortcut surfaces in the registry.** No orphan shortcut in `shortcuts.ts` that isn't either an `IntrinsicShortcut` (page-nav/zoom) or referenced by a `ToolDef`.
4. **No stale "Coming in Phase N" tooltips.** For all shipped phases, the tooltip i18n string must not contain "Coming in Phase N".

Source code for all four lives in `docs/tool-registry-spec.md` §3.

### 2.5 Lock (L-007, Wave 11)

Principal override of audit §5.4 ("do not lock yet"). The lock is drafted by Diego, reviewed by Julian, lands in `.learnings/locked-instructions.md` as L-007 with the standard sections. Enforcement is via `scripts/ratchet-tool-registry-coverage.mjs` (Diego, Wave 11) which:

- Walks `src/client/components/toolbar/`, `menu-bar/`, `shape-tools/` for JSX elements that look like tool surfaces (button / li / menuitem).
- Computes the set of tool IDs they render (via the `ToolDef` import the registry-renderer pattern enforces).
- Computes the set of tool IDs declared in `registry.ts`.
- Fails CI if either set has members the other does not.

Lock text and unlock conditions are in `docs/tool-registry-spec.md` §6.

### 2.6 R3 — conventions update

A new section `## 19. Well-marked tools (Phase 7.5 addition, 2026-06-17, Riley)` lands in `docs/conventions.md`. Contents: the seven dimensions from audit §5.1 (verbatim) + the four contract tests' intent + the cutover plan (registry-additive commit first, UI-cutover commit second).

---

## 3. Bucket A (A1–A7) architecture deltas

Quick wins — minimal architectural surface. Listed for completeness because A7 ("Find a tool…" palette) depends on the registry from §2.

| A#  | Architectural delta                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | None — string + dispatcher rewires only. Stale tooltips/toasts removed; `phase3()` toast helper retired (caller search confirms).                                                                                                                                                                                                                                                                                                      |
| A2  | None — i18n bundle additions only (`toolbar.shapes.*` keys + `shapes` namespace).                                                                                                                                                                                                                                                                                                                                                      |
| A3  | New shortcut IDs: `bookmark-edit`, `ocr-run`, `combine-open` (`Alt+B` / `Alt+O` / `Alt+C`). Threaded through `shortcuts.ts` + `use-app-shortcuts.ts`.                                                                                                                                                                                                                                                                                  |
| A4  | None beyond the registry — menu mirrors emerge from the `surfaces.menu === true` field on existing annotation + page-op tools.                                                                                                                                                                                                                                                                                                         |
| A5  | New tool `'cursor:default'` already exists as a shortcut; the registry entry adds toolbar surface + i18n.                                                                                                                                                                                                                                                                                                                              |
| A6  | New handlers `fitWidth` + `fitPage` in `pdf-canvas`'s viewport hook. Wave 2 promotes the Phase-1 no-op to real math.                                                                                                                                                                                                                                                                                                                   |
| A7  | **New component** `src/client/components/tool-search-palette/` opened by `Ctrl+/`. Reads the registry. Fuzzy-matches via a small inline scorer (no new dep — Levenshtein is ~20 lines). `role="dialog" aria-modal="true"`; `<input type="search">` autofocused (allowed by `jsx-a11y/no-autofocus` in role=dialog per existing convention). Top-N results render as buttons that dispatch the tool's `dispatch` and close the palette. |

A7 is the discoverability foundation. Every Bucket B and Bucket C tool gets a palette entry for free because of the registry.

---

## 4. Engine routing — every Bucket B + Bucket C feature

This is the load-bearing table for David and Riley. Each row names the engine module (David owns `src/main/pdf-ops/*`; Riley owns `src/client/components/*`), the dep delta, and the IPC channel that bridges them. Per-feature UI specs are in `docs/ui-spec-phase-7.5.md`.

### 4.1 Bucket B at a glance

| Bucket | Feature                             | Engine module(s)                                                                         | Dep delta                                                                                        | License                               | IPC channels                                                                                        |
| ------ | ----------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| B2     | Compare Files                       | `src/main/pdf-ops/compare-engine.ts` + `compare-text-diff.ts` + `compare-visual-diff.ts` | `diff-match-patch`, `pixelmatch`                                                                 | Apache-2.0, MIT                       | `pdf:compareDocuments`                                                                              |
| B3     | Find / Search                       | renderer-only (`src/client/components/find-bar/`)                                        | none (uses pdf.js TextLayer)                                                                     | —                                     | `pdf:findInDocument` (optional cross-page helper)                                                   |
| B4     | Watermark / H&F / Background        | `src/main/pdf-ops/page-design-engine.ts` (shared)                                        | none (pdf-lib)                                                                                   | —                                     | `pdf:applyWatermark`, `pdf:applyHeaderFooter`, `pdf:applyBackground`                                |
| B5     | Crop Pages                          | `src/main/pdf-ops/crop-engine.ts`                                                        | none (pdf-lib CropBox)                                                                           | —                                     | `pdf:cropPages`                                                                                     |
| B6     | Compress / Optimize                 | `src/main/pdf-ops/compress-engine.ts`                                                    | `sharp` (if not already vendored)                                                                | Apache-2.0                            | `pdf:compressDocument`                                                                              |
| B7     | Stamps + Stamp library              | `src/main/pdf-ops/stamp-engine.ts`                                                       | none (image overlay reuses Insert Image pattern)                                                 | —                                     | `pdf:applyStamp`                                                                                    |
| B8     | Password encryption                 | `src/main/pdf-ops/encryption-bridge.ts` (qpdf subprocess)                                | qpdf binary                                                                                      | Apache-2.0                            | `pdf:setPasswordProtection`                                                                         |
| B9     | Action Wizard                       | reuses `src/main/pdf-ops/replay-engine.ts` (existing) + new `action-script-runner.ts`    | none                                                                                             | —                                     | `pdf:replayActionScript`, `pdf:recordActionScript`                                                  |
| B10    | Extract / Split / Replace pages     | `src/main/pdf-ops/page-ops-engine.ts`                                                    | none (pdf-lib copyPages)                                                                         | —                                     | `pdf:extractPages`, `pdf:splitDocument`, `pdf:replacePages`                                         |
| B11    | Insert pages from PDF               | `src/main/pdf-ops/page-ops-engine.ts` (shared with B10)                                  | none                                                                                             | —                                     | `pdf:insertPagesFromFile`                                                                           |
| B12    | Page-content Cut/Copy/Paste         | renderer-side clipboard + `src/main/pdf-ops/page-content-clipboard.ts` engine            | none                                                                                             | —                                     | `pdf:applyPageContentPaste`                                                                         |
| B13    | Hyperlinks                          | `src/main/pdf-ops/link-engine.ts`                                                        | none (pdf-lib annotations)                                                                       | —                                     | `pdf:editLinks`                                                                                     |
| B14    | Spell check                         | renderer-side worker `src/client/spell/spell-worker.ts` + `nspell` + Hunspell dicts      | `nspell`, Hunspell `.aff`/`.dic` en-US + es-ES                                                   | MIT (en-US), TBD (es-ES; vet Wave 11) | `pdf:spellCheckRange` (renderer-internal worker; the IPC channel is optional for cross-doc helpers) |
| B15    | Page Display modes                  | renderer-only (viewer layout switch)                                                     | none                                                                                             | —                                     | none                                                                                                |
| B16    | View-only rotation + true Read Mode | renderer-only (CSS rotation, chrome-toggle)                                              | none                                                                                             | —                                     | none                                                                                                |
| B17    | Area measure                        | reuses `src/main/pdf-ops/measure-engine.ts` (existing) + renderer                        | none                                                                                             | —                                     | none (existing measure IPC)                                                                         |
| B18    | Edit text & images — font swap      | `src/main/pdf-ops/font-swap-engine.ts`                                                   | none (fontkit, already vendored by pdf-lib)                                                      | —                                     | `pdf:swapEmbeddedFont`                                                                              |
| B19    | Auto-bookmarks from headings        | `src/main/pdf-ops/auto-bookmark-engine.ts`                                               | none (pdf.js TextLayer)                                                                          | —                                     | `pdf:autoBookmarkFromHeadings`                                                                      |
| B20    | Remove hidden information           | `src/main/pdf-ops/sanitize-engine.ts` (rebuild-from-scratch per P7.5-L-12)               | none                                                                                             | —                                     | `pdf:removeHiddenInfo`                                                                              |
| B21    | Document Properties dialog          | renderer + `src/main/pdf-ops/document-properties.ts`                                     | none (pdf-lib `getTitle/Author/Subject/Keywords/Creator/Producer/CreationDate/ModificationDate`) | —                                     | `pdf:getDocumentProperties`, `pdf:setDocumentProperties`                                            |

### 4.2 B3 Find/Search — renderer-only design

Find is the audit's worst marking lie ("Coming in Phase 3" tooltip three phases past Phase 3). Architecturally cheap: pdf.js already extracts a TextLayer for every visible page in Path 2 (Phase 1 architecture §4.2). The Find bar reads the existing TextLayer for the current page (cheap) and walks pages on Next/Prev (lazy — never load all pages eagerly). No background indexing thread.

Match counter ("3 of 12") is the count of matches on the _currently visible_ page plus a "search remaining pages…" affordance that the user clicks to walk forward. This is honest, not slow: the audit calls out that Acrobat's "Searching 12 of 50 pages..." progress bar is the right pattern, not a hidden eager-index. Performance gate (project-plan §3 acceptance #4) is preserved.

`pdf:findInDocument` is an optional cross-page IPC for "Find next match in any page" cases where the renderer wants the main process to walk the document; for v1 we ship pure renderer + lazy page walk. The IPC channel is reserved in the contract amendment but the v1 dispatcher does not invoke it.

### 4.3 B4 Watermark / H&F / Background — shared engine

These three Acrobat tools all stamp text/image content onto a page coordinate set across a range. They share a single `page-design-engine.ts` with a discriminated-union request type (`{ kind: 'watermark' | 'header-footer' | 'background', ... }`) so the engine code is one switch, not three modules. Riley's modal UI has three tabs that share the same form-state shape with a `kind` discriminator. Renderer never knows which engine module dispatches — it sees three logical channels (`pdf:applyWatermark`, `pdf:applyHeaderFooter`, `pdf:applyBackground`) that fan into one engine for code-share. Per-channel zod schemas keep the validation surface explicit.

### 4.4 B6 Compress + B8 Encryption + B20 Sanitize — the rebuild-from-scratch family

Three operations that must NOT use `catalog.delete()` + `save()` because pdf-lib emits every object in `context.indirectObjects` regardless of reachability (Phase 7.4 B1 Wave 2 lesson, David, 2026-06-15). All three rebuild:

```ts
// pseudocode pattern (David authors per-engine variant)
const src = await PDFDocument.load(bytes, { updateMetadata: false });
const dst = await PDFDocument.create();
const pages = await dst.copyPages(src, src.getPageIndices());
for (const p of pages) dst.addPage(p);
// apply compress/encrypt/sanitize-specific transforms on `dst`
stripDocLevelJavaScript(dst); // belt-and-braces (Julian Wave 11 mandatory check)
return dst.save();
```

B8's encryption pass is the only one that escapes pdf-lib — qpdf does the encryption on the rebuilt bytes via subprocess. The post-encryption round-trip must NOT re-mutate the structure (encrypted bytes pass through as-is to the destination).

### 4.5 C1 Read Aloud + C2 Preflight (Wave 5a)

**C1 TTS** — three per-OS adapters behind one `TtsEngine` interface:

```ts
interface TtsEngine {
  listVoices(): Promise<TtsVoice[]>;
  speak(text: string, opts: { voiceId?: string; rate?: number; pitch?: number }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}
```

| OS      | Adapter                 | Subprocess                                             | License                                                  | Bundle requirement                                                                            |
| ------- | ----------------------- | ------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Windows | `tts-sapi-adapter.ts`   | PowerShell `System.Speech.Synthesis.SpeechSynthesizer` | OS-bundled                                               | none                                                                                          |
| macOS   | `tts-say-adapter.ts`    | `/usr/bin/say`                                         | OS-bundled                                               | none                                                                                          |
| Linux   | `tts-espeak-adapter.ts` | `/usr/bin/espeak`                                      | GPL-3 (binary owned by user's distro — we do NOT bundle) | **none — subprocess-only call; if espeak not installed, return `'tts_engine_not_installed'`** |

Voice list cached per-OS in memory. Voice prefs persist in SQLite (`tts_voice_prefs` — `docs/data-models.md` §13.4) keyed by locale so the user's "preferred voice + rate + pitch for English" persists across sessions.

The renderer's Read Aloud bar tracks sentence boundaries via a small in-renderer sentence splitter (no NLP dep — `[.!?]` + abbreviation list). The bar highlights the active sentence in the TextLayer as the OS speech engine advances. Pause/resume use the OS engine's pause primitive; on Windows + macOS this is reliable; on Linux (espeak) it is approximate (we stop and re-speak from the active sentence).

**C2 Preflight** — pure pdf-lib + pdf.js. The Preflight engine ships ~30 rules across PDF/X-1a, PDF/X-4, PDF/A-1b, PDF/A-2b. Each rule is one file at `src/main/pdf-ops/preflight-rules/<rule-id>.ts` exporting a `PreflightRule { id, level, profile, check(doc): RuleResult }`. The engine iterates rules and aggregates results. Rule subset enumerated in `docs/preflight-spec.md` §3.

The honest disclosure ratchet (P7.5-L-9):

1. `docs/preflight-spec.md` enumerates exactly which rules ship.
2. Preflight panel header reads `i18n: preflight.subsetDisclosure` → "Subset of PDF/X-1a, PDF/X-4, PDF/A-1b, PDF/A-2b — see Help for the shipped rule set".
3. `docs/user-guide.md` (Nathan Wave 12) has a "What we check, what we don't" subsection.
4. README front-door + roadmap status.

### 4.6 B9 Action Wizard — `replay-engine.ts` reuse

The existing `src/main/pdf-ops/replay-engine.ts` already deterministically replays an `EditOperation[]` against a document. B9 surfaces it:

- **Recorder** (renderer): a toolbar toggle starts recording. Every dispatched `EditOperation` from the user's interaction is appended to a renderer-side buffer. Stop → serialize as JSON.
- **Script format:**

```ts
interface ActionScript {
  schemaVersion: 1; // R5 mitigation — future engine changes get a migration test
  name: string;
  createdAt: number;
  ops: EditOperationSerialized[];
}
```

- **Runner** (main): `pdf:replayActionScript({ scriptId, targetPaths: string[] })` walks `targetPaths`, opens each PDF, runs `replay-engine.applyOps()` over `script.ops`, saves the output to a configurable destination folder. UI exposes the runner via the existing mail-merge runner's batch shell (reuse).
- **Storage:** Scripts persist in SQLite (`action_wizard_scripts`, `docs/data-models.md` §13.3) so they survive restarts. Export/import via `.action.json` files.

Schema-drift risk (R5): a Wave 6 test asserts that a `schemaVersion: 1` script written today replays correctly after any future engine extension. Migrations follow the standard Phase 1 forward-only pattern.

### 4.7 B14 Spell check — renderer-side worker

Spell check runs in the renderer in a Web Worker (`spell-worker.ts`) so it does not block the main thread on long documents. The worker loads the active locale's `.aff`/`.dic` lazily on first use; subsequent calls reuse the loaded dictionary.

The worker exposes one method: `checkRange({ text: string, locale: AppLocale }): { offset: number, length: number, suggestions: string[] }[]`. The renderer's text-edit mode calls it on every keystroke in the active text box (debounced 300ms) and renders red squiggles via the existing annotation overlay.

`pdf:spellCheckRange` IPC channel is reserved in the contract amendment for the cross-doc case (e.g., "spell-check the entire document via a main-process pass") but v1 ships the worker-only path. If es-ES Hunspell dictionary licensing fails Diego's Wave 11 vet, the worker silently degrades to en-US-only for es-ES content (no underline, no error toast — honest "we tried, no MIT dictionary available").

### 4.8 C3–C5 Structure tree IO (Waves 5b–5c)

The accessibility-authoring suite needs to read and write the PDF's structure tree (`/StructTreeRoot` in the PDF catalog). pdf-lib's high-level API does not expose this; we drop to low-level dictionary access:

```ts
// design — David authors in src/main/pdf-ops/struct-tree-engine.ts
const catalog = doc.catalog;
const structTreeRoot = catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict);
// walk K (Kids) array; each entry is either a PDFRef to a structure element dict or a marked-content reference
```

The shape of the in-memory structure tree:

```ts
interface StructTreeNode {
  id: string; // stable client-side id (uuid v4)
  type:
    | 'P'
    | 'H1'
    | 'H2'
    | 'H3'
    | 'H4'
    | 'H5'
    | 'H6'
    | 'Figure'
    | 'Table'
    | 'TR'
    | 'TD'
    | 'TH'
    | 'L'
    | 'LI'
    | 'Lbl'
    | 'LBody'
    | string;
  altText?: string; // /Alt entry (figures, tables)
  actualText?: string; // /ActualText
  language?: string; // /Lang
  pageRef?: number; // page index this element lives on
  contentRefs: MarkedContentRef[]; // marked-content identifiers — what page content this element wraps
  children: StructTreeNode[];
}

type MarkedContentRef =
  | { kind: 'mcid'; pageIndex: number; mcid: number }
  | { kind: 'object'; pageIndex: number; objectRef: PDFRef };
```

**Side-table (P7.5-L-5):** during an edit session, modifications accumulate in a SQLite `accessibility_edit_session` table (`docs/data-models.md` §13.4) keyed by `doc_hash`. The renderer reads the side-table for any open document on load + merges with the in-PDF tree to produce the visible tree. On Save (or Save-As), the materializer writes the merged tree back to the in-PDF `/StructTreeRoot`. The side-table row is deleted on successful Save; on cancel-Save (or app crash with the doc open), the side-table row survives so the user does not lose work.

**Save-as-copy by default for docs with existing tags (R12 mitigation):** when `getStructTree(handle)` returns a non-empty structure tree (the doc has pre-existing tags, e.g., authored in Adobe Acrobat), the renderer treats subsequent edits as a candidate destructive operation. The Save dispatcher detects this state and OPENS the Save-As dialog by default (with a checkbox "Overwrite original (loses existing tags)" off-by-default). User must explicitly opt in to overwrite. This protects against the worst case where we round-trip a known-tagged PDF and silently mutate it.

### 4.9 C6 Accessibility Checker (Wave 5d)

The rules engine has the same shape as Preflight (§4.5): one rule per file at `src/main/pdf-ops/accessibility-rules/<rule-id>.ts`. ~12 rules ship across WCAG 2.1 AA + PDF/UA-1 subsets. Each rule produces a `RuleResult { id, severity, message, locations: [pageRefs], quickFixAction? }`. The `quickFixAction` field lets the renderer jump the user to the Tag editor / Reading Order overlay / Alt Text inspector with the offending element pre-selected — that integration is the value of the "rules + UI" pair.

Rule subset enumeration: `docs/accessibility-authoring-spec.md` §5. Honest-disclosure ratchet identical to Preflight (P7.5-L-10).

History persists in SQLite (`accessibility_check_history`) so the user can compare a current run against the previous run for the same `doc_hash`.

### 4.10 B2 Compare Files — text + visual diff, lazy per-page

The expensive operation is the visual diff (pixel compare requires both pages rasterized at the same resolution). The cheap operation is the text diff (pdf.js TextLayer is already extracted for the visible page on the active document).

**v1 strategy:**

1. User picks two PDFs ("baseline" + "modified") via two file pickers.
2. Engine extracts TextLayer text per page for both docs (lazy — only as the user navigates). Stores per-page text in `compare_sessions.per_page_text_baseline` / `per_page_text_modified` JSON columns (`docs/data-models.md` §13.5).
3. Engine runs `diff-match-patch` on the page-level text the moment a page is in view (text diff is fast — sub-100ms for typical content pages).
4. Visual diff (`pixelmatch`) runs ONLY on user request ("Show visual diff for this page" button). This avoids eager rasterize.
5. Per-page diff summary (counts of insertions/deletions/unchanged spans + visual-diff pixel count if computed) lives in `compare_sessions` so it persists across navigation.

The session row is created on open of the Compare panel and is cleaned up when the user closes the panel (explicit `pdf:closeCompareSession` IPC). On crash, orphan sessions get garbage-collected by a startup scan (delete sessions older than 7 days).

---

## 5. Renderer state shape additions

New Redux slices in `src/client/state/slices/`:

| Slice                          | New file                       | Owns                                                                                         | Persists to                                                         |
| ------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `searchSlice`                  | `search-slice.ts`              | Active Find bar state, current match index, history                                          | `find_history` table (recent searches)                              |
| `compareSlice`                 | `compare-slice.ts`             | Open compare session ID, baseline + modified handles, per-page diff cache                    | `compare_sessions` table                                            |
| `actionWizardSlice`            | `action-wizard-slice.ts`       | Recording-on flag, current recording's ops, saved scripts list                               | `action_wizard_scripts` table                                       |
| `stampSlice`                   | `stamp-slice.ts`               | Library entries, active stamp ID, stamp placement mode                                       | `stamps_library` table                                              |
| `documentPropertiesSlice`      | `document-properties-slice.ts` | Title/Author/Subject/Keywords/Creator/Producer/CreationDate/ModificationDate edit-form state | None (writes via `pdf:setDocumentProperties` directly)              |
| `pageDesignSlice`              | `page-design-slice.ts`         | Watermark/H&F/Background modal form state (kind discriminator)                               | None                                                                |
| `accessibilitySlice`           | `accessibility-slice.ts`       | Structure tree (merged from in-PDF + side-table), edit ops in flight, last check result      | `accessibility_edit_session` + `accessibility_check_history` tables |
| `ttsSlice`                     | `tts-slice.ts`                 | Voice list, active voice, playback state, current sentence index                             | `tts_voice_prefs` table                                             |
| `preflightSlice`               | `preflight-slice.ts`           | Last run result, per-rule pass/fail map                                                      | None (results regenerated per-run)                                  |
| `spellSlice`                   | `spell-slice.ts`               | Dictionary load state per locale, recent suggestions per range                               | None (worker-internal)                                              |
| `findATool` (palette UI state) | extends `ui-slice.ts`          | Palette open flag, query string, top-N matches                                               | None                                                                |

These are additive — Phase 1–7 slices are unchanged. Selectors live in the same per-slice files (`select<X>` exports) following the Phase 6 selector pattern.

---

## 6. Risk register (Phase 7.5 architecture-specific)

These complement Marcus's project-plan §4 risks; this table is architecture-specific.

| #    | Risk                                                                                                                    | Mitigation in architecture                                                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AR1  | Tool registry retrofit produces a large diff vs the four UI surfaces.                                                   | Wave 2 splits into two commits: registry-additive (new file, no UI consumer change) + UI-cutover (toolbar/menu/shape-toolbar rewired to read registry). Julian reviews the cutover diff in Wave 11.                                                             |
| AR2  | Side-table for accessibility edits could leak per-doc PII to the SQLite database.                                       | The side-table stores STRUCTURE only (tag types, parent refs, mcid pointers, alt-text strings the user types). It does NOT store page content bytes. Wave 5b includes a unit test that verifies the side-table row size is bounded (no content blob smuggling). |
| AR3  | qpdf subprocess could fail to spawn (missing binary, AV blocking) in unusual installs.                                  | Engine returns `'qpdf_not_available'` discriminant when `spawn` fails or `which qpdf` returns nothing. Renderer surfaces a clear error toast pointing at the install path. No silent fallback to "encryption skipped".                                          |
| AR4  | Compare Files session table could grow unboundedly on heavy use.                                                        | Startup GC deletes sessions older than 7 days. Per-session size cap (~5 MB JSON) enforced at write time — over-cap sessions get truncated with a banner.                                                                                                        |
| AR5  | Action Wizard scripts could leak credentials if the user records an op that includes a password (B8).                   | The recorder explicitly REJECTS recording `pdf:setPasswordProtection` ops — these are not replayable across docs by design (every doc would get the same password = security hole). Recorder filter list lives in `action-script-runner.ts`.                    |
| AR6  | Find bar's per-page lazy walk could feel slow on docs with many empty pages.                                            | Bar shows "Searched N of M pages" progress. User can cancel at any time. No eager indexing — preserves the perf gate.                                                                                                                                           |
| AR7  | TTS sentence-highlight could de-sync from the OS speech engine's actual playhead.                                       | We approximate by tracking sentence-start times against speech rate (Windows + macOS expose word-boundary events for higher fidelity; we use them when available; Linux degrades to time-based approximation). Documented in user-guide.                        |
| AR8  | C3 auto-tag heuristic could produce wildly wrong tags (e.g., misclassify body text as H1 because of font-size outlier). | Auto-tag is OPT-IN (user clicks "Auto-tag with heuristic"); always editable after. Spec doc warns about expected accuracy.                                                                                                                                      |
| AR9  | Page-content Clipboard (B12) could overflow the renderer clipboard with large image data.                               | Engine writes a private MIME type (`application/vnd.pdfviewereditor.pagecontent+json`) holding only references (page index + bbox). The actual content extracts on paste. Cross-app paste degrades to PNG raster of the bbox.                                   |
| AR10 | Spell check worker could thrash on docs with many large text boxes.                                                     | Worker uses an LRU cache keyed by `(textHash, locale)`. Cache size bounded at 1000 entries.                                                                                                                                                                     |

---

## 7. Performance discipline — preserves Phase 7 gate

The Phase 7.5 acceptance criterion `#4` from project-plan §3 holds: the 1064-page test PDF opens within historical baseline (commits `8761167`, `8d783ab`, `f70797e`, `2fb34e4`); virtualized rendering preserved. Each new feature is audited against this:

| Feature              | Eager-render risk?                                         | Mitigation                                         |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| Compare Files        | YES if we visual-diff all pages                            | Lazy per-page on user navigation (P7.5-L-7)        |
| Find/Search          | YES if we eager-index full doc                             | Lazy per-page walk (P7.5-L-8)                      |
| Auto-bookmarks       | YES if we walk all pages on open                           | Triggered only by user "Generate bookmarks" button |
| Preflight            | NO — engine is metadata + per-page sample, not full raster | n/a                                                |
| Read Aloud           | NO — speaks only the user's selected text                  | n/a                                                |
| Accessibility Check  | YES if rules walk all pages eagerly                        | Rules use TextLayer + structure tree (cheap)       |
| Spell check          | NO — runs only on the active text-edit box                 | n/a                                                |
| Action Wizard replay | YES on multi-file batches                                  | Batch shell already throttles                      |

Julian's Wave 11 review re-confirms each gate.

---

## 8. Trust-floor honesty obligations (Phase 7.5 — eighth instance)

Following the seven-times-proven pattern (H-3, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7, Phase 7.4 B1, now Phase 7.5). Four obligations surface at four locations each (spec doc → UI label → user-guide → README).

| #   | Claim that needs honest disclosure                                           | Spec doc                                  | UI label                                            | User-guide                                | README                |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------- | ----------------------------------------- | --------------------- |
| 1   | Preflight ships a SUBSET of PDF/X + PDF/A rules, not full compliance.        | `docs/preflight-spec.md` §3               | Preflight panel header subtitle                     | "What we check, what we don't" subsection | Feature list footnote |
| 2   | Accessibility Checker ships a SUBSET of WCAG 2.1 + PDF/UA-1 rules.           | `docs/accessibility-authoring-spec.md` §5 | Accessibility Check panel header subtitle           | "What we check, what we don't" subsection | Feature list footnote |
| 3   | Auto-tag heuristic (C3) is a HEURISTIC — expect to review every tag.         | `docs/accessibility-authoring-spec.md` §6 | "Auto-tag" button confirm modal                     | "Auto-tagging is approximate" subsection  | Feature list note     |
| 4   | TTS on Linux requires user-installed espeak (we do NOT bundle GPL-3 binary). | `docs/architecture-phase-7.5.md` §4.5     | Read Aloud panel "Engine not available" empty-state | "Read Aloud on Linux" subsection          | OS-support table      |

A fifth latent obligation (5: Find/Search is lazy and shows "searched N of M pages") is documented in `docs/ui-spec-phase-7.5.md` §3 — not a trust-floor obligation per se (it is honest performance UX, not a missing-feature disclosure) but included here for traceability.

---

## 9. Open questions for Marcus to route to the principal

These are scope-level decisions Riley cannot make alone in Wave 1. They do NOT block Wave 2 dispatch (Riley + David + Ravi can start Wave 2 against the architecture as written), but they need an answer before Wave 5a + Wave 11.

1. **es-ES Hunspell dictionary source.** SCOWL ships only en-US under MIT. Candidates for es-ES: (a) `RLA-ES` (open-source but mixed licenses — needs vet); (b) `LibreOffice-es-ES` (MPL / LGPL — needs vet against our permissive-only rule); (c) ship en-US only and degrade es-ES content to "no underline" with a one-time toast. **Default if no answer: option (c)** — degrade. Principal can override at Wave 11 license vet.
2. **Linux TTS bundling stance.** Confirmed P7.5-L-4: do NOT bundle espeak binary; subprocess-only call. Principal confirms at Wave 11 Diego license vet?
3. **Action Wizard cross-app script import.** Should B9 accept Acrobat `.sequ` (Action Wizard) scripts via a converter? Adobe's format is documented but proprietary in spirit. **Default: no** — we ship our own `.action.json` format and document import-from-Acrobat as out of scope. Principal can override.
4. **Compare Files visual diff on first paint.** Should the visual diff render automatically the first time a page is viewed in compare mode (currently P7.5-L-7 says no — user must click)? Auto-render gives a nicer first impression but burns memory on docs with many pages. **Default: no, user click required**. Principal can override.
5. **Accessibility checker output format for export.** Should the "Export report" feature produce a PDF, an HTML, or both? Acrobat ships HTML. **Default: HTML only** for v1; PDF export deferrable. Principal can override.

---

## 10. Wave-by-wave architecture handoff

| Wave | Architecture handoff to next wave                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | This doc + 7 companion docs land. Wave 2 has everything it needs.                                                                          |
| 2    | R1 registry + Bucket A + B3/B5/B10/B11/B15/B16 land. Wave 3 reads the registry to add stamp + measure tools without rewiring toolbar/menu. |
| 3    | B7 + B12 + B17 + B4 engine land. Wave 4 builds B4 UI on the engine.                                                                        |
| 4    | B4 UI + B6 + B13 + B19 engine land. Wave 5 builds B19 UI + adds B8/B18/B20/B21.                                                            |
| 5    | B8/B18/B20/B21 land. Wave 5a builds C1 + C2 (independent from earlier waves).                                                              |
| 5a   | C1 + C2 land. Wave 5b builds C3 on top of the structure-tree engine introduced here.                                                       |
| 5b   | C3 + struct-tree-engine land. Wave 5c builds C4 + C5 on the same engine.                                                                   |
| 5c   | C4 + C5 land. Wave 5d builds C6 on top of all four C-bucket pieces.                                                                        |
| 5d   | C6 lands. Wave 6 builds B9 + B14 + B18 UI in parallel.                                                                                     |
| 6    | B9 + B14 + B18 UI land. Wave 7 builds B2 Compare Files.                                                                                    |
| 7    | All implementation complete. Wave 11 packages + reviews + locks.                                                                           |
| 11   | qpdf bundled; license manifest signed; L-007 lock written + ratchet green. Wave 12 documents.                                              |
| 12   | README + user-guide + developer-guide updated. Wave 13 cuts v0.8.0.                                                                        |

---

## 11. Cross-reference index

| Topic                                                            | Where                                  |
| ---------------------------------------------------------------- | -------------------------------------- |
| IPC channels (all 41)                                            | `docs/api-contracts.md` §19            |
| SQLite migration `0009_phase7.5.sql`                             | `docs/data-models.md` §13              |
| Per-feature UI specs                                             | `docs/ui-spec-phase-7.5.md`            |
| Tool registry interface + tests + cutover plan                   | `docs/tool-registry-spec.md`           |
| Conventions §19 "Well-marked tools"                              | `docs/conventions.md` §19              |
| Structure-tree model + auto-tag heuristic + side-table lifecycle | `docs/accessibility-authoring-spec.md` |
| Preflight rule subset                                            | `docs/preflight-spec.md`               |
| Phase 7.5 project plan (Marcus)                                  | `docs/project-plan.md`                 |
| Parity audit (input)                                             | `docs/acrobat-parity-audit.md`         |
| Locked instructions                                              | `.learnings/locked-instructions.md`    |

End of Phase-7.5 architecture additions.
