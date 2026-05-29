# Phase 3 — Forms & Mail Merge

**Author:** Main session (Marcus's planning hit API overload; inlined the plan)
**Date:** 2026-05-22
**Status:** Plan-on-disk. Wave 11 (Riley solo design) dispatches on Julian Phase 2.5 GREEN verdict.

## Goals (locked)

1. Detect existing AcroForms in opened PDFs and render fillable UI
2. Form designer: create new form fields on a page (text, checkbox, radio, dropdown, signature placeholder, date)
3. Save form templates (project-local schema; reuses bookmarks-like persistence)
4. Mail merge: import CSV / Excel, map columns to form fields, batch-produce filled PDFs
5. Flatten forms on export (option in Save As / Export to PDF)

## Locked design constraints

- **Permissive OSS only.** AcroForm support in pdf-lib is reasonable for read + fill + flatten. For complex form authoring, may need pdf-lib extensions; no AGPL (rules out iText).
- **No JavaScript-form-actions** in this phase — PDFs can embed JS form actions (validation, calculations). Phase 3 ignores them (security risk + scope creep); document as "Coming in Phase 3.1 if demand surfaces."
- **Forms persist as standard AcroForm objects** (same discipline as Phase 2 annotations — portable across Acrobat / Edge / Preview).
- **Mail-merge output:** batch-produce N filled PDFs into a chosen folder OR a single concatenated PDF. User picks.
- **CSV + Excel input:** parse both. Use `csv-parse` (MIT) and `xlsx` or `exceljs` (MIT) — `exceljs` already in deps from Phase 6 plan, so reuse.
- **Schema additions:** form templates table in SQLite (similar pattern to bookmarks tree). Bumps to schema v3.

## Wave structure

| Wave | Owner                | Mode     | Scope                       | Output                                                                                                                                               |
| ---- | -------------------- | -------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11   | Riley                | solo     | Phase 3 architecture design | `docs/architecture-phase-3.md` (NEW), `docs/form-engine.md` (NEW), amendments to api-contracts/data-models/ui-spec/conventions                       |
| 12   | David + Ravi + Riley | parallel | Implementation              | main-process form-fill engine, AcroForm detection, mail-merge runner, schema v3 migration, renderer form-fill UI + form designer + mail-merge wizard |
| 13   | Diego + Julian       | parallel | Packaging + audit           | new deps installed (csv-parse, exceljs already present), CI updates, code review                                                                     |
| 14   | Nathan               | solo     | Documentation               | README + user-guide + developer-guide + api-reference updates; phase-3-release-notes.md                                                              |

Conditional Phase 3.1 if Julian rates HIGH.

## File ownership (Phase 3)

| Owner                          | Files added/modified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Riley (Wave 11 design)         | `docs/architecture-phase-3.md` (NEW), `docs/form-engine.md` (NEW), additive amendments to `docs/api-contracts.md`, `docs/data-models.md`, `docs/ui-spec.md`, `docs/conventions.md`                                                                                                                                                                                                                                                                                                                                                                                                     |
| David (Wave 12)                | `src/main/pdf-ops/form-engine.ts` (NEW), `src/main/pdf-ops/form-engine.test.ts`, `src/main/pdf-ops/mail-merge.ts` (NEW), `src/main/pdf-ops/mail-merge.test.ts`, new IPC handlers (`forms:detect`, `forms:fill`, `forms:flatten`, `forms:designAdd`, `forms:designRemove`, `forms:listTemplates`, `forms:saveTemplate`, `forms:loadTemplate`, `forms:runMailMerge`), `src/ipc/contracts.ts` extension, `src/ipc/register.ts`                                                                                                                                                            |
| Ravi (Wave 12)                 | `migrations/0003_phase3_forms.sql`, `src/db/repositories/form-templates-repo.ts` (NEW), `src/db/repositories/form-templates-repo.test.ts`, `src/db/types.ts` extension (FormTemplateRow, FormFieldDefinition)                                                                                                                                                                                                                                                                                                                                                                          |
| Riley (Wave 12 implementation) | `src/client/components/forms-panel/` (NEW — designer mode toggle), `src/client/components/form-designer/` (NEW — placement UI), `src/client/components/form-fill-overlay/` (NEW — fillable UI for detected AcroForms), `src/client/components/modals/mail-merge-modal/` (NEW — wizard: choose template → choose CSV/Excel → column mapping → output folder choice), `src/client/state/slices/forms-slice.ts` (NEW), `src/client/state/slices/mail-merge-slice.ts` (NEW), `src/client/state/thunks.ts` (form-fill + mail-merge thunks), `src/client/types/ipc-contract.ts` (re-exports) |
| Diego (Wave 13)                | `package.json` deps (`csv-parse` MIT, verify `exceljs` license), CI cache key bump if needed, electron-builder.yml verification                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Julian (Wave 13)               | `docs/code-review.md` Phase 3 section APPENDED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Nathan (Wave 14)               | `README.md`, `docs/user-guide.md`, `docs/developer-guide.md`, `docs/api-reference.md`, `LICENSES.md`, `docs/phase-3-release-notes.md` (NEW)                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Risk register (Phase 3)

1. **HIGH — pdf-lib form-field creation limits.** pdf-lib can READ + FILL AcroForms cleanly. CREATING new form fields (form designer) is less documented; the appearance stream + widget annotation + form field dict triangle must be authored correctly. Mitigation: Wave 11 Riley evaluates pdf-lib's form-creation surface in depth; if insufficient, fall back to drop-in `pdf-lib-form-builder` (verify license) or hand-author the dicts.

2. **MEDIUM — Mail-merge perf.** Batch-producing N filled PDFs naïvely loads, fills, and saves N times. For N=500 the time can be minutes. Mitigation: cache the parsed template `PDFDocument`, only mutate per-row, write per-row. Workers/streaming as Phase 3.1 perf.

3. **MEDIUM — Field-mapping UX.** User imports CSV with 20 columns and a template with 15 fields. Mapping UI must be intuitive. Mitigation: auto-detect by column-name == field-name; let user override.

4. **LOW — Excel format variants.** `.xls` (binary, OLE) vs `.xlsx` (Open XML). `xlsx` lib handles both; verify against fixtures.

5. **LOW — Date field format.** Date form fields lack a canonical PDF format. Mitigation: store ISO-8601 in form value; render per locale.

## Acceptance criteria (Phase 3 close)

- [ ] AcroForm detection: opening a PDF with form fields surfaces a "Forms" sidebar tab; click cycles through fields
- [ ] Form fill: text + checkbox + radio + dropdown + date fields editable; save persists values
- [ ] Form designer: switch into designer mode, click to place a new field on a page, configure (label, type, default, required); save persists
- [ ] Form templates: saved template appears in a template picker for re-use across documents
- [ ] Mail merge: wizard accepts CSV/Excel → maps to template fields → outputs batch (folder of N PDFs) OR concatenated (1 PDF with N pages)
- [ ] Flatten on export: option in Save As / Print-to-PDF that flattens AcroForms into static content
- [ ] Schema v3 migration runs cleanly on first launch of Phase-3 build over a Phase-2 install
- [ ] Test counts: estimate +60 tests across main+ipc + renderer + db
- [ ] L-001 holds
- [ ] No regression on Phases 1 + 2 features
- [ ] Honest limitations documented (no JS form actions, no calculated fields, mail-merge perf caveat for large N)

## Out of scope (explicitly)

- JavaScript form actions (validation, calculations) — Phase 3.1 candidate if user demand
- Form templates shared across users / cloud sync — Phase 3.5+
- Form designer rich validators (regex, length, etc.) — Phase 3.1
- PDF-1.7 XFA forms (mostly deprecated, used in some government forms) — wontfix unless explicit demand
- Per-row signature in mail merge — Phase 4 (signatures land then)

## Wave 11 brief location

`docs/wave-11-brief.md` — written separately. Dispatchable to Riley on Julian Phase 2.5 GREEN.
