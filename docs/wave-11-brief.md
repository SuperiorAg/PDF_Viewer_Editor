# Wave 11 Brief — Riley solo (Phase 3 architecture design)

**Author:** Main session
**Date:** 2026-05-22
**Status:** Dispatchable on Julian Phase 2.5 GREEN verdict.
**Mode:** Sequential, solo Riley (analogous to Wave 1 for Phase 1 and Wave 6 for Phase 2).
**Output:** Design docs only; NO source code.

## Goal

Design the Phase 3 forms + mail-merge system to enable Wave 12 implementers (David main-process, Ravi DB, Riley renderer UI) to build with zero ambiguity.

## Required reading

1. `docs/phase-3-plan.md` (top-level Phase 3 plan, locked goals + risks)
2. `docs/architecture-phase-2.md` + `docs/edit-replay-engine.md` (Phase 2 system you're extending)
3. `docs/api-contracts.md` (current IPC surface; you add additively)
4. `docs/data-models.md` (current schema + types; you extend)
5. `docs/ui-spec.md` (current UI; you add new affordances)
6. `docs/conventions.md` (code conventions including §13 main-process edit-ops pattern)
7. `CLAUDE.md`, `.learnings/locked-instructions.md` (L-001), `.learnings/learnings.jsonl`
8. pdf-lib documentation on AcroForms: https://pdf-lib.js.org/docs/api/classes/pdfform — research what pdf-lib supports natively for form field CREATION (not just reading/filling) and document the boundary clearly in your architecture-phase-3.md

## Files you own this wave (doc-only)

### NEW
- `docs/architecture-phase-3.md` — Phase 3 system additions (analogous to architecture-phase-2.md)
- `docs/form-engine.md` — detailed design of the main-process form fill + flatten + mail-merge engine (analogous to edit-replay-engine.md)

### AMEND (additive only — never break Phase 1 or Phase 2 contracts)
- `docs/api-contracts.md` — add new channels: `forms:detect`, `forms:fill`, `forms:flatten`, `forms:designAdd`, `forms:designRemove`, `forms:listTemplates`, `forms:saveTemplate`, `forms:loadTemplate`, `forms:runMailMerge`. Each new channel: typed request/response + error variants. Mark all as Phase 3. Banner: `### Phase 3 amendment (2026-05-22, Riley)`.
- `docs/data-models.md` — add `FormFieldDefinition` (discriminated union: text/checkbox/radio/dropdown/signature/date), `FormTemplate` (collection of FormFieldDefinitions + metadata), `FormFillValue` (the runtime per-doc fill state), `MailMergeJob` (template ref + data source + output config). Schema v3 DDL for `form_templates` table.
- `docs/ui-spec.md` — Forms sidebar tab (detection + cycle through fields), Form Designer mode (toggle in toolbar; click-to-place; field-properties panel), Mail Merge Wizard modal (4 steps: template → data source → mapping → output), Flatten-on-export checkbox in Save As. Update shortcuts table.
- `docs/conventions.md` — any new patterns Phase 3 introduces (e.g. how to think about form-state vs document-state separation; form-fill ops as EditOperation variants vs. separate channels)

## Locked design decisions to encode

1. **Permissive OSS only.** No iText (AGPL). Validate every new dep before recommending.
2. **No JavaScript form actions.** Phase 3 ignores embedded JS form actions; document the security rationale + the Phase 3.1 deferral.
3. **Forms persist as standard AcroForms.** Same discipline as Phase 2 annotations — portable. No sidecar JSON.
4. **Schema v3** for form templates table.
5. **CSV + Excel input** for mail merge; pick libraries (csv-parse MIT, xlsx OR exceljs MIT). Recommend in your design.
6. **Mail-merge output:** folder of N PDFs OR single concatenated PDF. User picks at wizard step 4.
7. **Form-fill ops integrate with the EditOperation discriminated union** so undo/redo works; OR they're a separate "form state" track. **Decide and document.** Riley's call. Recommend the cleaner option; consider whether form-fill is conceptually a content edit (treat as EditOperation) or a separate persisted-state track (like bookmarks). Hint: AcroForm values are document-resident PDF objects, so they ARE content edits — but the UI flow (fill out the whole form, then save) is bulkier than per-keystroke ops.

## Specific deliverable details

### `docs/architecture-phase-3.md`
Sections:
- **Scope** (one paragraph per goal area)
- **Form-state model** — how forms are represented in renderer state; how that maps to PDF AcroForm objects on save
- **EditOperation integration** — your call (see Locked decision 7); document the chosen path
- **Form designer model** — how new fields are authored; placement coords (PDF user-space); widget-annotation + form-field-dict pairing
- **Mail-merge architecture** — runner sits in main process; renderer dispatches a job, main streams progress, produces output
- **Schema additions** — form_templates table (id, name, fields JSON, created_at, updated_at)
- **Phase-3 extension points** — where Phase 4 (signatures) and Phase 3.1 (JS form actions, advanced validators) will plug in
- **What's NOT in Phase 3** — explicit scope fence

### `docs/form-engine.md`
The detailed design. Sections:
- **Goal** — single paragraph
- **Function signatures** — `detectForms(bytes): FormFieldDefinition[]`, `fillForm(bytes, values): bytes`, `flattenForms(bytes): bytes`, `createField(bytes, fieldDef): bytes`, `removeField(bytes, fieldId): bytes`, `runMailMerge(template, dataSource, output): MailMergeResult`. All pure/deterministic over (bytes, args) → bytes or structured result.
- **pdf-lib boundary** — what pdf-lib supports natively for AcroForm READ + FILL + FLATTEN; what's required for CREATE (research and document — this is the headline Phase 3 risk). If CREATE is hard, propose a manual-PDF-dict approach (write the form field dict + widget annotation directly using pdf-lib's lower-level API).
- **Mail-merge runner** — batched fill with cached parsed template; progress events streamed via IPC; backpressure
- **Error modes** — malformed CSV, unmapped columns, field type mismatch (text in a checkbox column), file write failures
- **Test strategy** — fixture PDFs with AcroForms; golden-output mail-merge against a small CSV

### Amendment specifics

**api-contracts.md** — for each new channel, specify:
- Request type
- Response type (success + error variants)
- Whether it streams progress events
- Examples (1-2 each)

**data-models.md** — Wave 8.5-style §amendment banner; include the DDL for migration 0003_phase3_forms.sql; include TypeScript interfaces.

**ui-spec.md** — wireframe-level prose for:
- Forms sidebar tab (resembles bookmarks sidebar in structure)
- Form Designer mode (toolbar toggle; cursor changes; click-to-place; properties panel docks right)
- Mail Merge Wizard (modal, 4 steps with Back/Next navigation; preview panel showing 1 filled sample)
- Flatten-on-export option (checkbox in Save As dialog + Print-to-PDF dialog)
- Keyboard shortcuts (Ctrl+Shift+F for forms designer toggle? — your call, avoid Phase 1/2 conflicts)

**conventions.md** — add only what's needed. Don't pad.

## Files you do NOT touch

- ARCHITECTURE.md (Phase 1 frozen)
- architecture-phase-2.md, edit-replay-engine.md (Phase 2 frozen)
- Any source under src/
- Marcus/Diego/Nathan/Julian-owned docs
- LICENSE, README, all user-facing guides
- package.json, configs, electron-builder, CI
- .learnings/locked-instructions.md

## Verification (your responsibility)

After writing:
1. Cross-reference: every new IPC channel in api-contracts has a matching mention in architecture-phase-3.md AND (if applicable) a Phase-3 EditOperation variant in data-models.md
2. Schema v3 DDL is idempotent + safe migration from schema v2
3. Mail-merge perf considerations addressed (caching, batching) — don't ship a quadratic algorithm
4. All 7 locked design decisions encoded somewhere — grep for them
5. L-001 not implicitly weakened (e.g. mail-merge runner doesn't spawn new BrowserWindows; if it does, they inherit security floor)

## L-001
Doc-only work. Not at runtime risk. If your design proposes a new BrowserWindow (e.g. mail-merge progress window), specify the security-floor inheritance explicitly in architecture-phase-3.md.

## Output

- 2 NEW docs + 4 amended docs
- Append "Riley — Wave 11 Phase 3 architecture" status row to `docs/build-report.md`: line counts per doc, locked decisions encoded check, top-3 Phase 3 risks, Wave 12 dispatch-readiness verdict
- Append one JSONL line to `.learnings/learnings.jsonl`

## What NOT to do

- Don't write Wave 12 implementation code. Brief later.
- Don't break Phase 1 or Phase 2 contracts. Strictly additive.
- Don't invent commercial-SDK escape hatches. Permissive OSS only.
- Don't speculate on Phase 4 / 5 / 6 / 7 designs in these docs — keep scope.

Return a ≤300-word summary: docs written + amended, headline design decisions (especially the EditOperation-integration choice + the pdf-lib CREATE-form-field boundary call), Phase 3 risk register, Wave 12 dispatch-readiness verdict.
