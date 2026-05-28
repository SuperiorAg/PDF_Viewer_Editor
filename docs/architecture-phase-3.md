# ARCHITECTURE — Phase 3 Additions (Forms & Mail Merge)

**Author:** Riley (front-end-architect)
**Date:** 2026-05-22 (Wave 11)
**Status:** Phase 3 design, locked at end of Wave 11. Additions to Phase-1 `ARCHITECTURE.md` and Phase-2 `docs/architecture-phase-2.md` (both frozen per locked decisions P2-L-5 and the analogous Phase 3 freeze rule below).
**Scope:** Architectural deltas needed for Phase 3 features (AcroForm detection + fill + flatten, form designer authoring, mail merge, flatten-on-export). Phase-1 and Phase-2 sections remain authoritative for anything not amended here.
**Reads:** `ARCHITECTURE.md` (full), `docs/architecture-phase-2.md` (full), `docs/edit-replay-engine.md`, `docs/phase-3-plan.md`, `docs/wave-11-brief.md`, `docs/form-engine.md`.

---

## 0. Scope

Phase 3 lights up the **forms** and **mail-merge** surfaces. Specifically:

1. **AcroForm detection + fill** — opening a PDF with form fields surfaces a Forms sidebar tab; the renderer renders fillable UI overlaid on the canvas; saving persists the values into the PDF's existing AcroForm objects.
2. **Form designer** — the user can author new form fields (text, checkbox, radio, dropdown, signature placeholder, date) on any page; placement is click-to-place + drag-to-resize; field properties (name, label, default, required) live in the right Inspector.
3. **Form templates** — saved templates appear in a picker for re-use across documents; storage is the new `form_templates` table (schema v3).
4. **Mail merge** — wizard imports CSV/Excel, maps columns to form fields, batch-produces filled PDFs (folder of N PDFs or single concatenated PDF — user picks at wizard step 4).
5. **Flatten on export** — option in Save As / Print-to-PDF that runs the AcroForm flatten pass before emission.

Each section below describes the architectural deltas. Phase-1 + Phase-2 chapters that aren't amended remain authoritative.

---

## 1. Locked decisions encoded (Wave 11 self-check)

| ID | Decision | Encoded where in this doc |
|---|---|---|
| **P3-L-1** | Permissive OSS only (no iText AGPL, no commercial SDKs) | §3.1 (library inventory delta), §6 (mail-merge dependencies) |
| **P3-L-2** | No JavaScript form actions in Phase 3 (security + scope) | §4 (form-state model), §11 (Phase 3.1 deferral) |
| **P3-L-3** | Forms persist as standard ISO 32000 AcroForms — no sidecar | §4.5 (round-trip), §10 (fidelity boundary) |
| **P3-L-4** | Schema v3 for `form_templates` table | §7 (schema delta), `data-models.md §8` |
| **P3-L-5** | CSV via `csv-parse` (MIT); Excel via `exceljs` (MIT) reused from Phase 6 plan | §3.1, §6.1 |
| **P3-L-6** | Mail-merge output: folder of N PDFs OR single concatenated PDF (user picks) | §6.3 (wizard step 4), `form-engine.md §6.4` |
| **P3-L-7** | Form-fill ops integrate into `EditOperation` discriminated union (Riley's call) — HYBRID model with explicit commit boundary | §5 (the headline architectural decision) |

---

## 2. Process model deltas

### 2.1 No new processes

Phase 3 adds no new process. Main, preload, renderer remain the three. The offscreen BrowserWindow (Phase 1 §6.3) is **not** reused for mail-merge — see §6.2 for the runner placement decision.

### 2.2 Main-process module additions

```
src/main/pdf-ops/
  form-engine.ts             (NEW — see form-engine.md §3 — detect + fill + flatten + create)
  form-engine.test.ts        (NEW)
  mail-merge.ts              (NEW — see form-engine.md §6 — batched runner over a parsed template)
  mail-merge.test.ts         (NEW)
  field-dict-authoring.ts    (NEW — manual PDFDict authorship for signature placeholders + date appearance streams)

src/main/data-sources/
  csv-source.ts              (NEW — wraps csv-parse, returns Row[] with header detection)
  excel-source.ts            (NEW — wraps exceljs, picks sheet 1 or user-selected sheet)

src/ipc/handlers/
  forms-detect.ts            (NEW)
  forms-fill.ts              (NEW)
  forms-flatten.ts           (NEW)
  forms-design-add.ts        (NEW — author a new field via the form-engine create path)
  forms-design-remove.ts     (NEW)
  forms-list-templates.ts    (NEW)
  forms-save-template.ts     (NEW)
  forms-load-template.ts     (NEW)
  forms-run-mail-merge.ts    (NEW — drives the mail-merge runner; streams progress; produces results)
```

### 2.3 Renderer-process additions

```
src/client/components/
  forms-panel/                       (NEW — sidebar tab; detected-field list + cycle nav + template picker)
  form-designer/                     (NEW — toolbar toggle; placement UI; field-properties inspector pane)
  form-fill-overlay/                 (NEW — fillable UI for detected AcroForms; per-field React component)
  modals/mail-merge-modal/           (NEW — wizard: template → data source → mapping → output)
  modals/flatten-on-export-modal/    (NEW — checkbox in Save As + Print-to-PDF surfaces)

src/client/state/
  slices/forms-slice.ts              (NEW — current document's detected + authored form fields)
  slices/forms-selectors.ts          (NEW)
  slices/mail-merge-slice.ts         (NEW — wizard step state + in-flight job state)
  slices/mail-merge-selectors.ts     (NEW)
  thunks.ts                          (EDIT — new thunks: detectFormsThunk, fillFormFieldThunk,
                                              commitFormThunk, designAddFieldThunk, designRemoveFieldThunk,
                                              saveFormTemplateThunk, loadFormTemplateThunk,
                                              runMailMergeThunk)

src/client/hooks/
  use-app-shortcuts.ts               (EDIT — wire Ctrl+Shift+F for Form Designer toggle; M for Mail Merge wizard)
```

### 2.4 Boundary discipline (unchanged from Phase 1 + Phase 2)

Conventions §10 still holds: **renderer never holds `Uint8Array` of document bytes**. Phase 3 strengthens by adding a corollary:

- **Form-fill values flow renderer → main via channel calls; the renderer never holds parsed PDFForm objects.** The renderer holds the lightweight `FormFieldDefinition[]` snapshot returned by `forms:detect` (a JSON object) plus the current per-field fill values (`Record<fieldName, string | boolean | number>`). The pdf-lib `PDFForm` instance lives in main only, materialized per replay invocation.
- **Mail-merge data rows flow renderer → main via channel; main parses CSV/Excel and never streams the parsed rows back to the renderer.** The wizard's preview step (§6.3 step 3) fetches only the first 5 rows + the header for column-mapping UX; the full data set stays in main.

### 2.5 IPC surface growth

9 new channels (full spec in `api-contracts.md` §13):

| Channel | Purpose | Stream events? |
|---|---|---|
| `forms:detect` | Detect AcroForm fields in the open document; return `FormFieldDefinition[]` | no |
| `forms:fill` | Apply a single per-field fill value; returns an EditOperation per §5 | no |
| `forms:flatten` | Flatten all form fields to static page content; standalone op (also bundled into export) | no |
| `forms:designAdd` | Author a new form field at a page+rect with a type | no |
| `forms:designRemove` | Remove a field (authored OR detected) from the document | no |
| `forms:listTemplates` | List saved form templates (db query) | no |
| `forms:saveTemplate` | Save the current field set as a reusable template | no |
| `forms:loadTemplate` | Load a template; apply the fields to the current document | no |
| `forms:runMailMerge` | Execute a mail-merge job; stream `mail-merge:progress` events | **yes** (event stream) |

Plus one event stream:

| Event | Purpose |
|---|---|
| `mail-merge:progress` | Streams `{ jobId, phase, percent, currentRow, totalRows }` from main to renderer during a mail-merge run |

The Phase-1 + Phase-2 surface (§1-§12 of `api-contracts.md`) remains frozen. No existing channel's contract changes.

---

## 3. Library inventory deltas

### 3.1 New runtime dependencies

| Library | Version | License | Process | Purpose |
|---|---|---|---|---|
| `csv-parse` | 5.x | MIT | Main | Stream-based CSV parser; supports header detection, custom delimiters, quoted fields, BOM handling |
| `exceljs` | 4.x | MIT | Main | XLSX + XLS read; sheet iteration. **Reused from Phase 6 plan**, pulled forward to Phase 3. |

No new renderer-side libraries. The form designer uses existing React + dnd-kit + the Phase-1 coord system.

**Explicitly NOT added (locked decision P3-L-1):**
- iText / iText 7 (AGPL or commercial dual-license — license-policy fail)
- PDFTron / Apryse forms SDK (commercial)
- pdf-lib-form-builder (no such package on npm at Phase 3 dispatch; the name appeared in Phase 3 plan §risk-register as a fallback; verified not-published 2026-05-22)
- jsPDF AcroForm extensions (jsPDF is itself MIT but its AcroForm support is renderer-side; we keep PDF mutation in main per Phase 1 boundary §1.2.4)

### 3.2 Existing libraries — extended use

| Library | New Phase 3 use |
|---|---|
| `pdf-lib` | Form-field CREATE via `form.createTextField()` / `createCheckBox()` / `createDropdown()` / `createOptionList()` / `createRadioGroup()` / `createButton()`. Form FILL via `field.setText()` / `checkBox.check()` / `dropdown.select()` / `radioGroup.select()`. Form FLATTEN via `form.flatten()`. See §4.2 for the CREATE-boundary verdict. |
| `better-sqlite3` | Schema v3 migration `0003_phase3_forms.sql` adds `form_templates` table. See §7. |
| `zod` | New schemas for the 9 IPC channels in §2.5 |

### 3.3 Phase-4+ libraries (NOT added in Phase 3)

| Library | Phase | Purpose |
|---|---|---|
| `node-forge` | 4 | Signature dictionary creation (PKCS#7); only the placeholder field is authored in Phase 3, see §8 |
| `tesseract.js` | 5 | OCR |
| `docx` / `pptxgenjs` | 6 | Office export |

---

## 4. Form-state model

### 4.1 In-memory representation

```ts
// src/ipc/contracts.ts (David Wave 12 edit; types specified here)
// Renderer mirrors in src/client/state/slices/forms-slice.ts

type FormFieldType =
  | 'text'
  | 'checkbox'
  | 'radio'      // a radio GROUP; individual radio buttons live in the options array
  | 'dropdown'   // single-select combo
  | 'signature'  // placeholder only; signing is Phase 4
  | 'date';      // text field with date-format hint + locale-aware renderer

interface FormFieldDefinition {
  /** Unique within document. AcroForm field name (period-separated for nested fields). */
  name: string;
  type: FormFieldType;
  pageIndex: number;
  /** Widget rect in PDF user-space (origin bottom-left). */
  rect: PdfRect;
  /** UI-visible label; defaults to `name` if author didn't supply a /TU (tooltip) entry. */
  label: string;
  /** Required-flag from AcroForm /Ff bit 2 (Required). */
  required: boolean;
  /** Optional default value populated into the AcroForm /DV entry. */
  defaultValue?: FormFieldValue;
  /** For radio + dropdown only; options the user can pick from. */
  options?: FormFieldOption[];
  /** Origin of the field. */
  origin: 'detected' | 'authored';
  /** Set to true if the renderer authored this field in the current session (still in dirtyOps). */
  unsaved: boolean;
}

interface FormFieldOption {
  /** Export value written to /V on selection. */
  value: string;
  /** Display label shown in the UI. */
  label: string;
}

type FormFieldValue =
  | { type: 'text'; value: string }
  | { type: 'checkbox'; value: boolean }
  | { type: 'radio'; value: string /* one of options[].value */ }
  | { type: 'dropdown'; value: string }
  | { type: 'signature'; value: null /* always null in Phase 3 */ }
  | { type: 'date'; value: string /* ISO-8601 YYYY-MM-DD */ };
```

### 4.2 pdf-lib AcroForm boundary — honest assessment

Researched 2026-05-22 against pdf-lib 1.17.x.

| Capability | pdf-lib native support | Phase 3 path |
|---|---|---|
| **READ** existing AcroForm fields | YES — `doc.getForm()` → `PDFForm`; `form.getFields()` enumerates `PDFTextField` / `PDFCheckBox` / `PDFDropdown` / `PDFRadioGroup` / `PDFOptionList` / `PDFButton`. Iterates via accept-visitor pattern. | Use `form.getFields()` directly. See `form-engine.md §4.1`. |
| **FILL** values into existing fields | YES — `textField.setText(value)`, `checkBox.check() / .uncheck()`, `dropdown.select(option)`, `radioGroup.select(option)`. Appearance streams are regenerated by `updateFieldAppearances(font)` on save unless suppressed. | Use the high-level fill helpers. See `form-engine.md §4.2`. |
| **FLATTEN** form fields to static page content | YES — `form.flatten()`. Removes widget annotations + AcroForm dictionary; bakes appearance into page content streams. **Irreversible** within the same `PDFDocument` instance (caller works on a fresh load to retain originals). | Use `form.flatten()` directly. See `form-engine.md §5`. |
| **CREATE** text field | YES — `form.createTextField(name)` returns `PDFTextField`. Then `textField.addToPage(page, { x, y, width, height, font?, fontSize?, borderColor?, backgroundColor? })`. Appearance stream is auto-generated. | Use `createTextField` + `addToPage`. See `form-engine.md §3.4`. |
| **CREATE** checkbox | YES — `form.createCheckBox(name).addToPage(page, {...})`. Default state can be set via `checkBox.check()` before `addToPage`. | Use `createCheckBox`. |
| **CREATE** radio group | YES — `form.createRadioGroup(name)` then `.addOptionToPage(label, page, {...})` for each radio button. The group manages mutual exclusion. | Use `createRadioGroup`. |
| **CREATE** dropdown (combo box) | YES — `form.createDropdown(name)` then `dropdown.addOptions([...])` then `.addToPage(page, {...})`. | Use `createDropdown`. |
| **CREATE** list box | YES — `form.createOptionList(name)`. Phase 3 does NOT expose this as a distinct type (dropdown covers the common case); flagged for Phase 3.1 if demand surfaces. | N/A Phase 3 |
| **CREATE** push-button | YES — `form.createButton(name)`. Used in PDFs for JavaScript-action triggers. **Phase 3 does NOT expose** (locked decision P3-L-2 forbids JS actions). | N/A Phase 3 |
| **CREATE** signature field | **NO** native helper. pdf-lib has no `createSignatureField`. The PDF spec calls this a `/Sig` field type, which has a unique field-flag + appearance-stream contract. | **Manual-PDFDict authorship.** See `form-engine.md §3.6` for the dict template + Phase-3 placeholder approach. |
| **CREATE** date field | **NO** distinct date helper — PDF treats dates as text fields with formatting hints stored in JS action callbacks. Phase 3 forbids JS actions (P3-L-2). | **Hybrid:** create a text field via `createTextField`, set a date-format hint in `/TU` (tooltip), and render the date picker UI in the renderer. Stored value is ISO-8601 in `/V`. The PDF will display the string verbatim if opened in Acrobat (Acrobat shows a text input, not a date picker; this is the honest fidelity trade-off — see §10 fidelity matrix). |

**Verdict (Wave 11): `native-supported with one manual-dict gap`.**

- The four common field types (text / checkbox / radio / dropdown) are fully native-supported via pdf-lib's high-level `createXxx + addToPage` pattern. NO fallback library is needed.
- Signature placeholders require manual `PDFDict` authorship — this is the same path pdf-lib uses internally for `/Ink` annotations in Phase 2 (`data-models.md §3.4`), so it's a well-trodden pattern. David authors `field-dict-authoring.ts` (NEW) with the signature-field template; the template lives in code and is reusable when Phase 4 adds actual signing.
- Date fields ship as text-fields-with-renderer-affordance — honest about the Acrobat round-trip limitation in the user guide.

**No fallback library required.** The Phase 3 plan §risk-register-#1 fear ("pdf-lib insufficient for CREATE") was based on outdated documentation; the 1.17.x line has shipped full CREATE coverage for the common types since 1.16 (verified by reading the pdf-lib source at `node_modules/pdf-lib/cjs/api/form/PDFForm.js`).

### 4.3 Storage in Redux

```ts
// src/client/state/slices/forms-slice.ts (NEW Phase 3)

interface FormsState {
  /** Field definitions for the open document (detected + authored). */
  fields: FormFieldDefinition[];
  /** Per-field fill values; keyed by field.name. Cleared on document close. */
  values: Record<string /* field.name */, FormFieldValue>;
  /** Detection status: 'unknown' (not yet detected), 'none' (no AcroForm), 'present' (fields detected). */
  detectionStatus: 'unknown' | 'none' | 'present';
  /** True while in form-designer mode (toolbar toggle). */
  designerMode: boolean;
  /** Currently-selected field in the designer (for the inspector). */
  selectedFieldName: string | null;
  /** Form-fill commit boundary state. See §5. */
  pendingCommitOps: EditOperation[];
}
```

Selectors (`forms-selectors.ts`):
- `selectFormFields` — memoized via `createSelector`
- `selectFormFieldsByPage(pageIndex)` — keyed memoization for the per-page overlay
- `selectFormValues`
- `selectIsDesignerMode`
- `selectFormFieldByName(name)`

### 4.4 Form templates (cross-file storage)

Templates are reusable across documents. The user authors a template once, then loads it onto any open PDF.

Storage: new SQLite table `form_templates` (schema v3, §7). Keyed by template `id`, not by file_hash — templates are document-independent.

Loading a template onto a document creates **authored** fields at the template's stored coords. The user can then nudge / resize before save. Each loaded field becomes an `EditOperation { kind: 'form-design-add' }` per §5.

### 4.5 Round-trip (P3-L-3)

Phase 3 forms persist as standard ISO 32000 AcroForm objects:

- **Detected fields** that the user fills: pdf-lib's `textField.setText()` etc. write to `/V` (value) on the field dict. Appearance stream regenerated via `updateFieldAppearances` unless flatten is enabled.
- **Authored fields**: pdf-lib's `createXxx + addToPage` writes the field dict to `/AcroForm /Fields` AND the widget annotation to the page's `/Annots`. Both ISO 32000 standard.
- **Signature placeholders**: manual dict authorship (`field-dict-authoring.ts`) writes a `/FT /Sig` field with `/V` undefined (placeholder). Phase 4 will populate `/V` with a `/ByteRange` + PKCS#7.
- **Date fields**: stored as text fields with `/TU` hint; value is ISO-8601 string.

**No sidecar JSON.** Same discipline as Phase 2 annotations (P2-L-3 from architecture-phase-2.md §1) and the no-sidecar locked decision from Phase 1 (Decision 2 from project-plan).

When the user reopens a Phase-3-authored PDF in any compliant viewer (Acrobat, Edge, Foxit, Preview), the form fields are visible and fillable. This is the portability promise.

---

## 5. EditOperation integration — the headline architectural decision

Per locked decision P3-L-7 (Riley's call). The question: do form-fill ops integrate into the `EditOperation` discriminated union, or sit on a separate persisted-state track?

### 5.1 Options considered

**Option A: Treat-as-EditOperation (every fill IS an EditOperation).**
Pros: undo/redo works for free via Wave 8.6 history middleware; each field-fill becomes one history entry.
Cons: filling a 20-field form pollutes the history stack with 20 micro-ops; an accidental Ctrl+Z after a save unwinds field 20 of the form which is a poor UX surprise; mail-merge runs would push thousands of ops onto history (unworkable).

**Option B: Separate persisted-state track (form values live in `formsSlice.values`; not in dirtyOps).**
Pros: history is clean; the form is a "bulk" edit that commits once.
Cons: undo of a form-fill requires custom history logic per slice (parallel to Phase 2 bookmarks pattern at `edit-replay-engine.md §4.7`); save-time merging of form values + EditOperations into the replay engine duplicates state-management logic; mail-merge runs need a separate write path entirely.

**Option C: HYBRID — fill values live in `formsSlice.values` (transient), commit boundary produces a single `EditOperation { kind: 'form-commit', values }` that batches all changed values into one history entry.**
Pros: clean history (one entry per "I'm done filling the form" act, not one per keystroke); undo unwinds the whole form-fill batch; mail-merge can SKIP the form-commit path entirely and write per-row directly; form-design ops still use EditOperation per-field (since those mutate document structure, not user-entered values).
Cons: requires an explicit "commit" boundary in the UX (auto-commit on save? on focus-leave from the form panel? on toolbar button?); the boundary is a learnable UX concept.

### 5.2 Decision: Option C (HYBRID)

**Form FILL values:** live in `formsSlice.values` as transient state. **Commit boundary** = the moment the user clicks Save (or clicks an explicit "Commit form values" button in the Forms sidebar). At commit, `commitFormThunk` reads `formsSlice.values`, computes the diff from `formsSlice.committedValues` (the last-committed snapshot), and dispatches ONE `EditOperation { kind: 'form-commit', meta, fieldValues: { [name]: value }, committedAt }` per commit. This single op carries all changed values for the batch.

**Form DESIGNER ops** (authoring new fields, removing fields, moving fields): use the standard per-op EditOperation pattern, one variant per gesture:
- `form-design-add { meta, fieldDefinition }`
- `form-design-remove { meta, fieldName, before /* full FormFieldDefinition for inverse */ }`
- `form-design-edit { meta, fieldName, before, after }` — covers rect changes (move/resize) AND property edits (label, required, options)

**Rationale:**
1. **Aligns with semantic boundaries.** Authoring a field is one editorial act per field; filling 20 values is ONE editorial act (filling the form). The history should respect that distinction. Treating every keystroke as an op is bottom-up; treating every form-commit as an op is top-down — top-down matches the user's mental model.
2. **Avoids history pollution.** The Wave 8.6 architectural ceiling (~25 MB at maxHistory=100, per Riley's Wave 10 R-10.2 verification) leaves room for thousands of small ops, but the UX cost of "Ctrl+Z unwinds my form one field at a time" is independent of memory. The commit-boundary approach prevents the UX cost.
3. **Mail-merge bypass.** Mail-merge runs do NOT go through `applyEdit` — they call `forms:runMailMerge` which invokes `mail-merge.ts` directly. Each per-row save produces its own bytes; the renderer never sees the per-row ops. This makes mail-merge perf decoupled from history-middleware overhead (see §6.2 below). Treating form-fill as a normal EditOperation would force mail-merge to bypass the dirtyOps funnel anyway, so the bypass is honest in the design.
4. **Composable with replay engine.** The replay engine (`edit-replay-engine.md`) gains exactly four new `case` branches in `applyOp`: `form-commit`, `form-design-add`, `form-design-remove`, `form-design-edit`. `form-commit` calls into `form-engine.ts:fillForm` with the values map; the other three call into `form-engine.ts:createField` / `removeField` / `editField`. See `form-engine.md §4` for the function signatures.

### 5.3 New EditOperation variants

```ts
// extends data-models.md §7.1 EditOperation union (Phase 3 append-only)

type EditOperation =
  // ...Phase 1 + Phase 2 variants...

  // Phase 3:
  | { kind: 'form-commit';
      meta: EditMeta;
      /** Map of field.name → new value. Only changed values appear. */
      fieldValues: Record<string, FormFieldValue>;
      /** Snapshot of prior committed values for each changed field (undo target). */
      previousValues: Record<string, FormFieldValue | undefined>;
    }
  | { kind: 'form-design-add';
      meta: EditMeta;
      fieldDefinition: FormFieldDefinition;
    }
  | { kind: 'form-design-remove';
      meta: EditMeta;
      fieldName: string;
      before: FormFieldDefinition;     // for inverse
    }
  | { kind: 'form-design-edit';
      meta: EditMeta;
      fieldName: string;
      before: Partial<FormFieldDefinition>;
      after: Partial<FormFieldDefinition>;
    };
```

### 5.4 Inverse table (extends `data-models.md §7.1.3`)

| Forward | Inverse |
|---|---|
| `form-commit { fieldValues, previousValues }` | `form-commit { fieldValues: previousValues, previousValues: fieldValues }` |
| `form-design-add { fieldDefinition }` | `form-design-remove { fieldName: fieldDefinition.name, before: fieldDefinition }` |
| `form-design-remove { fieldName, before }` | `form-design-add { fieldDefinition: before }` |
| `form-design-edit { fieldName, before, after }` | `form-design-edit { fieldName, before: after, after: before }` |

`form-commit` is symmetric — the inverse swaps `fieldValues` and `previousValues`. This is the same pattern as Phase 2's `annot-edit` (`data-models.md §3.2`).

### 5.5 Commit boundary UX

Three trigger paths for the commit boundary:

1. **Save (Ctrl+S)** — auto-commits any pending form-fill values BEFORE the save thunk fires `fs:writePdf`. This is the default and handles 95% of cases.
2. **Explicit "Commit form values" button** in the Forms sidebar — surfaces when `formsSlice.values` differs from `formsSlice.committedValues`. Lets the user commit a partial fill (e.g. saved a checkpoint, wants to undo back to before this batch). Useful for power users.
3. **Document close** — if uncommitted values exist on close, the existing `ConfirmCloseUnsavedModal` (ui-spec §9.3) shows them as part of "unsaved changes" so the user can choose to save (commit) or discard.

**No auto-commit on field-blur.** Field-blur would shred the batch into per-field commits, defeating the boundary. The user owns the boundary; the renderer enforces it explicitly.

### 5.6 Form fill is NOT a content edit at the byte level

`form-commit` doesn't mutate page content streams. It mutates the AcroForm field dictionaries (`/V` entries on the field objects) via pdf-lib's high-level fill API. The replay engine handles this in step 3.6 (NEW) — see `form-engine.md §4.2` for the algorithm and `edit-replay-engine.md` cross-reference at §5 below.

### 5.7 Replay-engine integration

The `replay()` function (`edit-replay-engine.md §3`) is extended with step 3.6 between step 3.5 (drawOverlays) and step 4 (emitAnnots):

```
3.6 applyFormOps:
    if (anyFormCommitInOps OR anyFormDesignInOps):
      const form = doc.getForm()                                    // may be empty
      for op of formDesignAddOps:    formEngine.createField(form, op.fieldDefinition)
      for op of formDesignEditOps:   formEngine.editField(form, op.fieldName, op.after)
      for op of formDesignRemoveOps: formEngine.removeField(form, op.fieldName)
      const mergedValues = mergeCommits(formCommitOps)              // last-write-wins per field name
      formEngine.fillForm(form, mergedValues)
      form.updateFieldAppearances(font)                              // unless flatten phase will run next
    yield progress { phase: 'pdflib-applying-forms', percent: 55-60% }
```

Order matters: design-add → design-edit → design-remove → fill. This way the user can author a field, edit it, then fill it within the same commit. The remove pass runs before fill so a removed field isn't filled (defensive).

Two new `ReplayError` variants (`form-engine.md §7`):
- `'form_field_create_failed'` — pdf-lib refused the create (e.g. duplicate name)
- `'form_field_not_found'` — fill or edit targets a field that doesn't exist
- `'form_flatten_failed'` — `form.flatten()` threw

The existing `op_apply_failed` covers everything else.

---

## 6. Mail-merge architecture

### 6.1 Data flow

```
User opens Mail Merge wizard (Ctrl+M / Tools menu / toolbar)
   ↓
Wizard step 1: pick template (renderer → forms:listTemplates → list)
   ↓
Wizard step 2: pick data source (file picker; CSV or XLSX)
   ↓
Renderer fires forms:loadDataSourcePreview (new sub-channel, returns first 5 rows + headers — bounded)
   ↓
Wizard step 3: map columns to fields (auto-detect column-name == field-name; user can override)
   ↓
Wizard step 4: choose output mode (folder of N PDFs OR single concatenated PDF) + destination
   ↓
Renderer fires forms:runMailMerge with MailMergeJob
   ↓
Main process: mail-merge runner (§6.2)
   - Parses full data source (csv-parse / exceljs stream)
   - Loads template document bytes ONCE
   - For each row: clone template doc, apply form values, save bytes
   - Streams mail-merge:progress events back to renderer
   - When done, returns { ok: true, jobId, outputPath, rowsWritten, warnings }
   ↓
Renderer: dismisses wizard with success toast; offers "Show in folder" button
```

### 6.2 Runner placement and L-001 cross-check

**The mail-merge runner lives in the main process** (`src/main/pdf-ops/mail-merge.ts`). It does NOT spawn a new BrowserWindow or worker. Rationale:

1. **L-001 cross-check.** No new BrowserWindow means no security-floor inheritance question to answer. The existing offscreen export window (Phase 1 §6.3 / Phase 2 §2.1) is for Chromium printToPDF only and is NOT reused here — mail-merge uses the pdf-lib engine path exclusively. L-001 (`enableDragDropFiles: true` on the main BrowserWindow) is untouched by Phase 3.
2. **Backpressure.** Per-row save is sequential within a single async function; main can yield to the event loop between rows so the renderer stays responsive. Worker_threads would add IPC overhead per row without significant CPU parallelism gain (pdf-lib is single-threaded internally).
3. **Memory.** Template is loaded ONCE (cached parsed `PDFDocument`); per-row work clones the doc, fills, and serializes. Memory footprint per row ≈ 2× template size; the runner explicitly nullifies the per-row PDFDocument after writing to disk so GC reclaims promptly.
4. **Cancellation.** The runner checks a `cancelRequested` flag between rows; the renderer fires `forms:runMailMerge:cancel` (sub-channel) to set it. Cancellation produces a partial result with `rowsWritten < totalRows` and `warnings: ['cancelled at row N']`.

### 6.3 Progress reporting (your question C answer)

Decision: **stream `mail-merge:progress` events via IPC from main to renderer** (option a from the question). Renderer renders a modal with a progress bar + "Cancel" button. NOT blocking — the modal is closable but the run continues until completion or cancel.

Why not background-and-toast: a 500-row mail merge can take 30+ seconds. Hiding the progress in a toast (lower-right ephemeral surface) makes the long wait feel un-actionable. A modal with progress bar + cancel button respects the user's time.

Why not block-renderer: blocking eliminates the cancel option. A modal that the user can move/minimize/close-with-cancel preserves agency.

Progress event shape (api-contracts §13.10):

```ts
interface MailMergeProgressEvent {
  jobId: string;
  phase: 'parsing-data' | 'preparing-template' | 'rendering-row' | 'writing-row' | 'finalizing';
  currentRow: number;       // 1-based; 0 during parsing-data / preparing-template
  totalRows: number;        // populated after parsing-data; -1 before
  percent: number;          // 0-100
  warnings: string[];       // accumulator; renderer shows the most recent in the modal
}
```

Renderer subscribes via `window.pdfApi.events.onMailMergeProgress(handler)` (preload exposes a typed listener registration, mirroring `onExportProgress`).

### 6.4 Field-mapping UX (your question D answer)

**Auto-detect by exact case-insensitive match of column-name to field-name.** When a column matches a field, the wizard pre-populates the mapping. The user can override any mapping via a dropdown in step 3 (column → field, with "(skip)" option).

**Mappings persist as part of `FormTemplate`** (the saved template, NOT a per-job-only). Each `FormTemplate` row carries `last_column_mappings: Record<columnName, fieldName>` so the next time the user picks that template, the mapping pre-populates from the prior run. If the data source has different columns from the prior run, only the matching columns pre-populate; the rest fall back to auto-detect.

Rationale:
- Auto-detect handles the 80% case where the CSV was authored by someone who knew the form's field names.
- Persistence across runs covers the power-user case where someone runs the same merge weekly with the same column-naming conventions.
- Per-job override covers the edge case (typo in the CSV, last-minute column rename).

Per-job-only persistence was considered and rejected — re-mapping on every run is friction for the power user.

### 6.5 Performance — avoiding quadratic operations

The runner architecture explicitly avoids per-row re-parsing of the template. Loop invariants:

- Template `PDFDocument` parsed ONCE outside the per-row loop. Stored in a local `templateBytes: Uint8Array` (not the parsed object, to avoid pdf-lib internal-state aliasing between rows).
- Each row: `PDFDocument.load(templateBytes)` (fresh load) + fill + save. Bytes are GC'd at end of iteration.
- For **concatenated-PDF output mode** (P3-L-6): each filled row's bytes are kept in an array; after all rows complete, a single concatenation pass via `pdf-lib`'s `copyPages` merges them into one document. Memory peak = N × (1 filled row bytes), bounded; for N=500 with 100 KB templates, peak ≈ 50 MB. Acceptable.
- For **folder-of-N-PDFs output mode**: each row is written directly to disk via atomic temp+rename (conventions §13.4). No in-memory accumulation. Memory peak = 2× template size constant across N.

Risk register table (§risk-register-#2 from phase-3-plan.md) addressed:

| Concern | Mitigation |
|---|---|
| N=500 takes minutes | Template-parse-once + per-row sequential = O(N) not O(N²); 500 rows × ~50ms per fill = ~25s, acceptable |
| Memory growth across rows | Folder mode: constant memory; Concat mode: peak ≈ N × row-bytes, bounded |
| Renderer freezes | Sequential async with `await Promise.resolve()` yield between rows; progress events stream |
| Partial-output recovery on crash | Folder mode: rows already written stay on disk; Concat mode: failed run leaves no output (atomic) |

Phase 3.1 (post-ship perf) could move the per-row work to `worker_threads` if real-world reports show pressure on multi-thousand-row jobs.

---

## 7. Schema additions (P3-L-4)

### 7.1 New table — `form_templates`

```sql
-- ============================================================
-- migrations/0003_phase3_forms.sql (Phase 3, Ravi Wave 12)
-- Forward-only. Adds form_templates table.
-- ============================================================

CREATE TABLE form_templates (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  name                     TEXT NOT NULL UNIQUE,
  /** JSON-encoded FormFieldDefinition[]. */
  fields_json              TEXT NOT NULL,
  /** Optional source-doc file_hash; null for templates authored from scratch. */
  source_doc_hash          TEXT,
  /** JSON-encoded Record<columnName, fieldName> from the last mail-merge run; null until first run. */
  last_column_mappings     TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

CREATE INDEX idx_form_templates_name ON form_templates(name);
CREATE INDEX idx_form_templates_updated_at ON form_templates(updated_at DESC);

-- Record migration.
INSERT INTO schema_migrations (version, applied_at) VALUES (3, strftime('%s', 'now') * 1000);
```

### 7.2 Migration behavior

- Idempotent if `schema_migrations.version >= 3` (the runner skips applied migrations per Phase-1 `data-models.md §2.2`).
- Forward-only. No rollback path.
- Clean migration from schema v2 (Phase 2 bookmarks) — no existing tables are touched.
- Cross-file templates: keyed by `id`, not file_hash. A single template can be applied to multiple PDFs.

### 7.3 Why a separate table, not per-file association

Considered: extend `user_bookmarks`-style per-file association (templates live keyed by `file_hash`). Rejected because:

- Templates are reusable across documents. The 80% use case is "I authored a contract template; now I want to apply it to the next client's PDF." Per-file association forces re-authoring.
- File-hash binding is fragile: editing the PDF changes the hash, the template loses its association.
- The cross-file pattern matches user expectations from Word / Excel templates.

`form_templates` lives in the same SQLite database as `user_bookmarks`, `recent_files`, `app_settings`. No new database file.

### 7.4 Repository interface

```ts
// src/db/repositories/form-templates-repo.ts (Ravi Wave 12)

interface FormTemplatesRepo {
  list(): FormTemplateRow[];                              // ordered by updated_at DESC
  get(id: number): FormTemplateRow | null;
  getByName(name: string): FormTemplateRow | null;
  upsert(row: Omit<FormTemplateRow, 'id' | 'created_at' | 'updated_at'> & {
    id?: number;
    created_at?: number;
    updated_at?: number;
  }): number;                                              // returns id
  delete(id: number): boolean;
  updateColumnMappings(id: number, mappings: Record<string, string>): boolean;
}

interface FormTemplateRow {
  id: number;
  name: string;
  fields_json: string;                                     // JSON-encoded FormFieldDefinition[]
  source_doc_hash: string | null;
  last_column_mappings: string | null;                     // JSON-encoded Record<string, string>
  created_at: number;
  updated_at: number;
}
```

`db-bridge.ts` (David's adapter) translates snake_case rows ↔ camelCase DTOs at the IPC boundary, including parsing `fields_json` to `FormFieldDefinition[]` for the renderer.

---

## 8. Signature placeholder handoff to Phase 4

Phase 3 authors signature **placeholder** fields. Phase 3 does NOT sign anything. The handoff:

**Phase 3 emits:** a `/FT /Sig` field dict with `/V` undefined, attached to a widget annotation on the chosen page+rect. The field has a name (e.g. `Signature1`) and inherits all common form-field properties (rect, page, required, label).

**Phase 4 will:** fill the placeholder by computing a `/ByteRange` over the unsigned PDF bytes, embedding a PKCS#7 envelope in the `/V` entry, and writing an appearance stream representing the signature image (typeset name, drawn glyph, or imported image). The Phase-4 signing flow is opt-in per document.

**Forward-compatibility:**
- Phase 3 form-template export includes signature-placeholder field definitions, so a template authored in Phase 3 will continue to surface its placeholder when Phase 4 opens the same template.
- The `FormFieldDefinition.type === 'signature'` value's `FormFieldValue` is always `{ type: 'signature', value: null }` in Phase 3 (`null` value). Phase 4 extends the value union to `{ type: 'signature', value: SignaturePayload }` where `SignaturePayload` carries the PKCS#7 envelope reference.
- The renderer's fill overlay shows signature placeholders as visual "click to sign" buttons with the Phase 3 placeholder behavior: clicking surfaces a toast "Signing arrives in Phase 4."
- The form-engine's `fillForm()` function in Phase 3 SKIPS signature fields silently (it's a no-op when the value is `null`). Phase 4 extends to call into `sign-engine.ts:applySignature` for non-null signature values.

The `field-dict-authoring.ts` template for `/Sig` fields lives in code at Phase 3 ship; Phase 4 reuses it without modification.

---

## 9. Extension points for Phase 3.1, Phase 4+

### 9.1 In Phase 3 (Wave 12)

- AcroForm detection for documents WITH pre-existing forms
- Form fill for text / checkbox / radio / dropdown
- Form authoring for the same five types + signature placeholder + date
- Mail merge with CSV + Excel inputs; folder OR concatenated output
- Flatten-on-export option
- Form templates (cross-file storage; schema v3)

### 9.2 Phase 3.1 (post-ship hardening, OPTIONAL — only if Julian Phase 3 close flags HIGH)

- JavaScript form actions (validation, calculations) — currently STRIPPED on save (P3-L-2 keeps Phase 2 behavior); 3.1 would preserve them in a read-only mode
- Calculated fields (e.g. `total = sum(line_items)`)
- Regex / length validators on text fields
- Multi-line text fields with explicit `/MaxLen` enforcement
- `PDFOptionList` (list-box) as a distinct type
- Worker_threads parallelism for very large mail-merge runs
- Field tab-order authoring UX
- Excel sheet picker (Phase 3 uses sheet 1 only)

### 9.3 Phase 4+

| Phase | Feature | Extension point |
|---|---|---|
| 4 | Actual signing (Sig field fill) | `form-engine.ts:fillForm` extended; `sign-engine.ts` NEW; `FormFieldValue { type: 'signature' }` value-union extended |
| 4 | Square / Circle / Line annotations | (unchanged from Phase 1 extension table) |
| 5 | OCR overlay (form fields on scanned docs) | OCR pass produces a layer; form-engine can detect overlap |
| 6 | Office export with forms | `docx` doesn't natively support fillable forms; the Office export will flatten forms first |
| 7 | Localization | Form labels + button texts pulled from i18n bundle |

---

## 10. Phase 3 fidelity boundary

Phase 3 closes some Phase 2 boundaries and introduces new ones. Documented loudly per the H-3 lesson (Wave 3.5).

### 10.1 Boundaries Phase 3 closes

| Phase 2 limitation | Phase 3 reality | Doc update target |
|---|---|---|
| "Form fields: pdf-lib loses appearance streams; pages with forms route to Chromium engine" | Form fields are detected, filled, and preserved through the pdf-lib path. `updateFieldAppearances` regenerates appearance streams from the form's default font. Chromium fallback is no longer the default for AcroForm docs. | Update `architecture-phase-2.md §3.8` heuristic via Phase 3 amendment in api-contracts; update user-guide.md §"Forms" section |
| "AcroForms detection or filling (Phase 3)" stub | LIVE | `README.md` Phase 3 status; user-guide; release notes |
| "Form designer (Phase 3)" stub | LIVE | Same |
| "Mail merge (Phase 3)" stub | LIVE | Same |

### 10.2 New Phase-3 boundaries

| Boundary | Description | Where to surface |
|---|---|---|
| JS form actions | Stripped silently on save; calculations + JS validators do not run | User-guide Forms section + form-fill overlay tooltip when opened doc has JS actions detected (warning toast) |
| Date fields in Acrobat round-trip | Authored as text fields with ISO-8601 storage; Acrobat displays as text input, not date picker; the renderer's date-picker affordance is renderer-side only | User-guide Forms section + tooltip on date-field designer affordance |
| Signature placeholders | Phase 3 places the placeholder; signing arrives Phase 4 | User-guide Forms section + toast on click of placeholder |
| Excel multi-sheet | Phase 3 reads sheet 1 only; multi-sheet picker is Phase 3.1 | Wizard step 2 warning when XLSX has >1 sheet |
| Excel formula evaluation | exceljs does NOT evaluate formulas — cell value reads the cached value (if Excel saved it) or the formula string itself. Recommend the user uses paste-as-values in Excel before merge | Wizard step 2 + user-guide Mail Merge section |
| Calculated form fields | NOT preserved — pdf-lib strips JS actions, calculations do not run on fill | Forms sidebar tooltip when calc-field detected; user-guide |
| Form templates that reference a deleted field | Loading the template silently skips fields whose definitions are stale (e.g. references a fontFamily that's not in the target doc) | Toast on template load: "Some template fields couldn't be applied (N skipped)" |
| XFA forms (PDF 1.7 LiveCycle Designer) | NOT supported — Phase 3 detects AcroForm only; XFA-only documents show a banner "Some forms in this document use the XFA format which isn't supported" | Forms sidebar empty state when XFA-only |

### 10.3 Round-trip fidelity matrix delta

Extends `edit-replay-engine.md §12` Phase 2 matrix:

| PDF feature in source | Phase 2 behavior | Phase 3 behavior |
|---|---|---|
| AcroForm fields | **No** (pdf-lib drops appearance streams + can drop field values; routed to Chromium) | **YES** — preserved through pdf-lib; values fill correctly; appearance streams regenerated cleanly |
| AcroForm with JS actions | **No** (stripped silently) | **No** (still stripped — locked decision P3-L-2; same Chromium fallback behavior on heuristic) |
| Signature fields with existing /V | **No** (pdf-lib drops the signature) | Partial — Phase 3 preserves placeholder fields with `/V` undefined; existing signed `/Sig` fields are still dropped on save (Phase 4 will preserve via byte-range signing) |
| XFA forms | N/A (Phase 2 didn't surface them at all) | Detected and flagged read-only; not editable or fillable |
| Form appearance streams (custom /AP) | Lost on save | Regenerated by `updateFieldAppearances` using the form's `/DA` default-appearance string + Helvetica embed (or original font if cached in form) |

---

## 11. What's NOT in Phase 3

Hard scope-fence per `phase-3-plan.md §Out of scope`. Listed here to absorb any Phase-3 brief drift:

- JavaScript form actions (validation, calculations) — Phase 3.1 candidate
- Form templates shared across users / cloud sync — Phase 3.5+
- Regex / length validators on text fields — Phase 3.1
- Multi-line text fields with `/MaxLen` enforcement — Phase 3.1
- PDF-1.7 XFA forms — wontfix unless explicit demand
- Per-row signature in mail merge — Phase 4 (signatures land then)
- Excel sheet picker (multi-sheet docs) — Phase 3.1
- Excel formula evaluation — wontfix (recommend paste-as-values upstream)
- List-box (`PDFOptionList`) as a distinct field type — Phase 3.1 (dropdown covers common case)
- Push-button fields (used for JS actions) — wontfix (P3-L-2 forbids JS)
- Field tab-order authoring UX — Phase 3.1
- macOS / Linux packaging — Phase 7 (still)
- Auto-update — Phase 7 (still)

If a Phase-3 wave brief or implementation pulls toward any of these, the agent stops and surfaces to Marcus.

---

## 12. L-001 cross-check

**L-001 status: unchanged.** Phase 3 introduces:

- Mail-merge runner in main process — no new BrowserWindow; existing offscreen export window is NOT reused; runner is a plain async function within the main IPC handler's process context.
- Forms designer mode — pure renderer overlay; no main-process window changes.
- Flatten-on-export — extends the existing export path; no new windows.
- Drag-drop of CSV/Excel into the mail-merge wizard — uses the SAME `File.path` Electron property as Phase 1 PDF drops + Phase 2 image drops (`enableDragDropFiles: true`). Phase 3 EXTENDS the L-001 pathway; does not weaken it.

Wave 12 implementer (David / Ravi / Riley) MUST NOT touch `src/main/window-manager.ts`. If Wave 12 implementation surfaces a need for a new lock (e.g. "AcroForm /JavaScript field-actions must always be stripped before save"), that's a Marcus call after Julian's Wave 13 audit.

If a future Phase-3 design proposes a new BrowserWindow (e.g. a separate progress window for mail merge), the security-floor inheritance MUST be specified: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, custom protocol if any, identical CSP to the main viewer. Phase 3 explicitly does NOT propose a new window — the modal-in-the-main-window pattern is sufficient.

---

## 13. Phase 1 + Phase 2 freeze rule extends to Phase 3

Per locked decisions P2-L-5 (Phase 2) and the analogous P3-L-5 extension below:

**P3-L-FREEZE (implicit, recorded here):** `ARCHITECTURE.md`, `docs/architecture-phase-2.md`, `docs/edit-replay-engine.md` are FROZEN by Phase 3. Phase 3 design lives in THIS doc and `docs/form-engine.md` exclusively. The api-contracts / data-models / ui-spec / conventions docs are AMENDED with Phase 3 sections (not edited in their Phase 1 / Phase 2 §s).

If Wave 12 implementation needs a Phase-1 or Phase-2 contract change, the agent stops and surfaces to Marcus — same protocol as `api-contracts.md §11` (Phase 1 backward-compat policy).

---

## 14. Cross-reference checklist (Wave 11 self-verification)

- [x] All 7 locked decisions encoded (§1)
- [x] No new processes; main-process runner placement justified (§2.1, §6.2)
- [x] 9 new IPC channels listed + cross-ref to api-contracts (§2.5)
- [x] Library inventory delta with license verification (§3.1)
- [x] FormFieldDefinition + FormFieldValue types defined (§4.1)
- [x] pdf-lib CREATE boundary verdict: native-supported + one manual-dict gap (§4.2)
- [x] Round-trip via standard AcroForms (§4.5)
- [x] EditOperation integration HYBRID model documented with rationale (§5)
- [x] 4 new EditOperation variants + inverses (§5.3, §5.4)
- [x] Mail-merge runner placement + L-001 cross-check (§6.2)
- [x] Mail-merge progress streaming decision (§6.3 — question C)
- [x] Field-mapping UX with per-template persistence (§6.4 — question D)
- [x] Mail-merge perf: avoids quadratic operations (§6.5)
- [x] Schema v3 DDL idempotent + clean migration from v2 (§7)
- [x] form_templates table cross-file (not per-file) — question G answer (§7.3)
- [x] Signature placeholder Phase 4 handoff (§8 — question F)
- [x] Phase 3.1 deferral list (§9.2)
- [x] Phase 3 fidelity boundary matrix (§10)
- [x] Phase 3 scope fence (§11)
- [x] L-001 unchanged (§12)
- [x] Phase 3 freeze rule recorded (§13)

End of Phase-3 architecture amendment.
