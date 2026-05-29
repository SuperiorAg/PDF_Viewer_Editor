# Form Engine — Phase 3 Detailed Design

**Author:** Riley (front-end-architect)
**Date:** 2026-05-22 (Wave 11)
**Status:** Design doc. David implements in Wave 12 under `src/main/pdf-ops/form-engine.ts` and `src/main/pdf-ops/mail-merge.ts`.
**Reads:** `ARCHITECTURE.md` §1-§7; `docs/architecture-phase-2.md` §3; `docs/edit-replay-engine.md`; `docs/architecture-phase-3.md`; `docs/api-contracts.md` §13; `docs/data-models.md` §8.

---

## 1. Goal

> Given an open PDF (kept as `Uint8Array` in main per `DocumentStore`), provide pure functions for AcroForm detection, fill, flatten, and field authoring. Plus a batched mail-merge runner that streams progress and produces N filled PDFs (folder mode) or one concatenated PDF (concat mode).

The form engine is the Phase 3 counterpart to Phase 2's replay engine (`edit-replay-engine.md`). It is invoked BY the replay engine (`edit-replay-engine.md §3` step 3.6) when form-related ops are present in the ops list, and ALSO invoked directly for the mail-merge runner which bypasses the dirtyOps funnel per `architecture-phase-3.md §5.2`.

Phase 2 stubbed AcroForm handling — pdf-lib's load was lossy and the engine heuristic routed AcroForm-bearing docs to Chromium fallback (`edit-replay-engine.md §12`). Wave 12 replaces that limitation with this engine.

---

## 2. Inputs / outputs

### 2.1 Function signatures (the engine's public surface)

```ts
// src/main/pdf-ops/form-engine.ts (NEW, David Wave 12)

import type { PDFDocument, PDFForm } from 'pdf-lib';
import type { FormFieldDefinition, FormFieldValue, Result } from '@ipc/contracts';

// ============================================================
// Detection
// ============================================================

export interface DetectFormsInput {
  bytes: Uint8Array;
}

export interface DetectFormsOk {
  fields: FormFieldDefinition[];
  /** Detection report — useful for the renderer's Forms sidebar empty state. */
  hasAcroForm: boolean;
  hasXfaForm: boolean;
  hasJavaScriptActions: boolean;
  warnings: string[];
}

export type DetectFormsError = 'load_failed' | 'detect_failed';

export type DetectFormsResult = Result<DetectFormsOk, DetectFormsError>;

export async function detectForms(input: DetectFormsInput): Promise<DetectFormsResult>;

// ============================================================
// Fill (apply values to existing fields)
// ============================================================

export interface FillFormInput {
  bytes: Uint8Array;
  /** Map of field.name → new value. Only changed values appear. */
  fieldValues: Record<string, FormFieldValue>;
  /** When true, regenerate appearance streams from font; default true. */
  updateAppearances?: boolean;
}

export interface FillFormOk {
  newBytes: Uint8Array;
  /** Fields the engine actually filled (subset of fieldValues keys). */
  filledFieldNames: string[];
  /** Fields requested but not found in the document. */
  unmatchedFieldNames: string[];
  warnings: string[];
}

export type FillFormError =
  | 'load_failed'
  | 'form_not_present'
  | 'field_type_mismatch' // e.g. trying to set 'text' value on a checkbox field
  | 'serialize_failed';

export type FillFormResult = Result<FillFormOk, FillFormError>;

export async function fillForm(input: FillFormInput): Promise<FillFormResult>;

// ============================================================
// Flatten (bake form fields into page content)
// ============================================================

export interface FlattenFormsInput {
  bytes: Uint8Array;
}

export interface FlattenFormsOk {
  newBytes: Uint8Array;
  flattenedFieldCount: number;
  warnings: string[];
}

export type FlattenFormsError =
  | 'load_failed'
  | 'form_not_present'
  | 'flatten_failed'
  | 'serialize_failed';

export type FlattenFormsResult = Result<FlattenFormsOk, FlattenFormsError>;

export async function flattenForms(input: FlattenFormsInput): Promise<FlattenFormsResult>;

// ============================================================
// Author new field (form designer add)
// ============================================================

export interface CreateFieldInput {
  bytes: Uint8Array;
  fieldDefinition: FormFieldDefinition;
}

export interface CreateFieldOk {
  newBytes: Uint8Array;
  warnings: string[];
}

export type CreateFieldError =
  | 'load_failed'
  | 'duplicate_field_name'
  | 'invalid_field_definition'
  | 'unsupported_field_type' // e.g. 'list-box' (Phase 3.1) or unknown
  | 'page_out_of_range'
  | 'serialize_failed';

export type CreateFieldResult = Result<CreateFieldOk, CreateFieldError>;

export async function createField(input: CreateFieldInput): Promise<CreateFieldResult>;

// ============================================================
// Remove field (form designer remove)
// ============================================================

export interface RemoveFieldInput {
  bytes: Uint8Array;
  fieldName: string;
}

export interface RemoveFieldOk {
  newBytes: Uint8Array;
  warnings: string[];
}

export type RemoveFieldError = 'load_failed' | 'field_not_found' | 'serialize_failed';

export type RemoveFieldResult = Result<RemoveFieldOk, RemoveFieldError>;

export async function removeField(input: RemoveFieldInput): Promise<RemoveFieldResult>;

// ============================================================
// Edit field (form designer move/resize/property edit)
// ============================================================

export interface EditFieldInput {
  bytes: Uint8Array;
  fieldName: string;
  /** Partial update; only fields present are changed. */
  changes: Partial<FormFieldDefinition>;
}

export interface EditFieldOk {
  newBytes: Uint8Array;
  warnings: string[];
}

export type EditFieldError =
  | 'load_failed'
  | 'field_not_found'
  | 'invalid_changes'
  | 'serialize_failed';

export type EditFieldResult = Result<EditFieldOk, EditFieldError>;

export async function editField(input: EditFieldInput): Promise<EditFieldResult>;
```

### 2.2 Purity contract

Identical to `edit-replay-engine.md §2.2`. All six functions are pure over their inputs:

- No filesystem I/O. Callers (`forms:*` IPC handlers or the mail-merge runner) write bytes to disk via the atomic-rename path (conventions §13.4).
- No DB access. Templates flow in as `FormFieldDefinition[]` arrays.
- No network.
- No mutation of `input.bytes`.
- Same input → same output (modulo pdf-lib's deterministic re-emit signature).

Pure functions enable golden-bytes testing (§9) and partial-failure rollback (§7).

### 2.3 Internal-only helpers (referenced by replay engine step 3.6)

The replay engine calls into the form engine via wrapper helpers that operate on a live `PDFDocument` + `PDFForm` rather than `Uint8Array`. These are NOT exported from the public surface:

```ts
// Internal — called by replay engine, NOT by IPC handlers directly
export function applyFormCommit(
  form: PDFForm,
  fieldValues: Record<string, FormFieldValue>,
): { warnings: string[] };
export function applyFormDesignAdd(form: PDFForm, fieldDefinition: FormFieldDefinition): void;
export function applyFormDesignRemove(form: PDFForm, fieldName: string): void;
export function applyFormDesignEdit(
  form: PDFForm,
  fieldName: string,
  changes: Partial<FormFieldDefinition>,
): void;
```

These mutate the in-flight `PDFForm` and let the replay engine's single `doc.save()` produce final bytes. The standalone public functions (§2.1) wrap these helpers with a load + save shell.

---

## 3. Algorithm — detect + fill + flatten + create

### 3.1 detectForms

```
detectForms(input):
  1. doc = PDFDocument.load(input.bytes, { ignoreEncryption: false })
     warnings = doc's pdflibLoadWarnings
  2. let form = null
     try { form = doc.getForm() } catch { /* no AcroForm */ }
  3. hasAcroForm = form !== null && form.getFields().length > 0
  4. hasXfaForm = checkXfaDict(doc.catalog) // detect /XFA in catalog /AcroForm
  5. hasJavaScriptActions = checkJavaScriptDict(doc.catalog) // /Names /JavaScript
  6. fields = []
     if (hasAcroForm):
       for pdfField of form.getFields():
         const def = extractFieldDefinition(pdfField, doc)
         if (def) fields.push(def)
         else warnings.push(`Skipped unsupported field type: ${pdfField.constructor.name}`)
  7. return ok({ fields, hasAcroForm, hasXfaForm, hasJavaScriptActions, warnings })
```

#### 3.1.1 `extractFieldDefinition`

Maps a pdf-lib field object to a `FormFieldDefinition` (per `data-models.md §8`):

| pdf-lib type    | `type` mapping                                            | Notes                                                               |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| `PDFTextField`  | `'text'` (or `'date'` if `/TU` tooltip contains "(date)") | The date-marker convention is documented in the user-guide          |
| `PDFCheckBox`   | `'checkbox'`                                              |                                                                     |
| `PDFRadioGroup` | `'radio'`                                                 | `options` populated from `getOptions()`                             |
| `PDFDropdown`   | `'dropdown'`                                              | `options` populated from `getOptions()`                             |
| `PDFOptionList` | `'dropdown'` (collapsed type)                             | Warns: "List-box rendered as dropdown — Phase 3 limitation"         |
| `PDFButton`     | SKIPPED                                                   | warning: "Push-buttons are not supported in Phase 3"                |
| `PDFSignature`  | `'signature'`                                             | Phase 3 reads existing placeholders; signed values are warned about |
| anything else   | SKIPPED                                                   | warning: `Unknown form field type: ${typeName}`                     |

The widget rect comes from `pdfField.acroField.getWidgets()[0].getRectangle()`. For multi-widget fields (rare; same field on multiple pages), the engine emits one definition per widget with `name` suffixed by `:${widgetIndex}` so the renderer can render distinct rects. The first widget keeps the bare name for compatibility.

#### 3.1.2 Page index resolution

Each widget annotation belongs to a page via its parent `/P` reference. The engine maps the widget's parent PDF ref to the document's page-array index. If the widget is orphan (no `/P` and not in any page's `/Annots`), the field is dropped with warning.

### 3.2 fillForm

```
fillForm(input):
  1. doc = PDFDocument.load(input.bytes)
  2. let form = null
     try { form = doc.getForm() } catch {}
     if (!form) return fail('form_not_present')
  3. const filled = [], unmatched = [], warnings = []
  4. for (const [name, value] of Object.entries(input.fieldValues)):
       const pdfField = form.getFieldMaybe(name)
       if (!pdfField) { unmatched.push(name); continue }
       try {
         applyValueToField(pdfField, value)
         filled.push(name)
       } catch (e) {
         if (e is TypeMismatchError) return fail('field_type_mismatch', e.message, { fieldName: name })
         throw e
       }
  5. if (input.updateAppearances !== false):
       const font = await doc.embedFont(StandardFonts.Helvetica)
       form.updateFieldAppearances(font)
  6. const newBytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false })
       // already updated in step 5; don't double-run
  7. return ok({ newBytes, filledFieldNames: filled, unmatchedFieldNames: unmatched, warnings })
```

#### 3.2.1 `applyValueToField`

```ts
function applyValueToField(pdfField: PDFField, value: FormFieldValue): void {
  switch (value.type) {
    case 'text':
      if (!(pdfField instanceof PDFTextField)) throw new TypeMismatchError('expected text field');
      pdfField.setText(value.value);
      break;
    case 'checkbox':
      if (!(pdfField instanceof PDFCheckBox))
        throw new TypeMismatchError('expected checkbox field');
      if (value.value) pdfField.check();
      else pdfField.uncheck();
      break;
    case 'radio':
      if (!(pdfField instanceof PDFRadioGroup)) throw new TypeMismatchError('expected radio group');
      pdfField.select(value.value);
      break;
    case 'dropdown':
      if (!(pdfField instanceof PDFDropdown || pdfField instanceof PDFOptionList))
        throw new TypeMismatchError('expected dropdown');
      pdfField.select(value.value);
      break;
    case 'signature':
      // Phase 3: signature values are always null; skip silently.
      // Phase 4 will replace this with sign-engine.ts:applySignature(pdfField, value.value).
      break;
    case 'date':
      if (!(pdfField instanceof PDFTextField))
        throw new TypeMismatchError('expected text field for date');
      pdfField.setText(value.value); // ISO-8601 string written to /V
      break;
  }
}
```

### 3.3 flattenForms

```
flattenForms(input):
  1. doc = PDFDocument.load(input.bytes)
  2. try { form = doc.getForm() } catch { return fail('form_not_present') }
  3. const fieldCount = form.getFields().length
  4. try {
       form.flatten()  // bakes appearance into page content; removes /AcroForm
     } catch (e) {
       return fail('flatten_failed', e.message)
     }
  5. const newBytes = await doc.save({ useObjectStreams: true })
  6. return ok({ newBytes, flattenedFieldCount: fieldCount, warnings: [] })
```

After flatten, the document has no interactive form. Re-opening shows the values as static page content. Irreversible at the byte level — the caller must keep the pre-flatten bytes if they want to preserve interactivity (the replay engine does, via the `documentStore.getBytes(handle)` pre-save bytes).

### 3.4 createField

The four common types use pdf-lib's high-level API:

```
createField(input):
  1. doc = PDFDocument.load(input.bytes)
  2. const form = doc.getForm()  // creates if absent
  3. const fd = input.fieldDefinition
  4. const page = doc.getPage(fd.pageIndex)  // out-of-range throws → fail('page_out_of_range')
  5. // Duplicate-name check
     if (form.getFieldMaybe(fd.name)) return fail('duplicate_field_name', ..., { fieldName: fd.name })
  6. const rect = { x: fd.rect.x, y: fd.rect.y, width: fd.rect.width, height: fd.rect.height }
  7. switch (fd.type):
       case 'text':
       case 'date':                                              // date is text-with-hint per architecture-phase-3 §4.2
         const tf = form.createTextField(fd.name)
         if (fd.defaultValue?.type === 'text') tf.setText(fd.defaultValue.value)
         else if (fd.defaultValue?.type === 'date') tf.setText(fd.defaultValue.value)
         tf.addToPage(page, rect)
         if (fd.required) tf.enableRequired()
         if (fd.label && fd.label !== fd.name) setTooltipDict(tf, fd.label)
         if (fd.type === 'date') setDateMarkerInTooltip(tf)       // appends "(date)" to /TU
         break;

       case 'checkbox':
         const cb = form.createCheckBox(fd.name)
         if (fd.defaultValue?.type === 'checkbox' && fd.defaultValue.value) cb.check()
         cb.addToPage(page, rect)
         if (fd.required) cb.enableRequired()
         if (fd.label) setTooltipDict(cb, fd.label)
         break;

       case 'radio':
         if (!fd.options || fd.options.length === 0) return fail('invalid_field_definition', 'radio requires options')
         const rg = form.createRadioGroup(fd.name)
         for (const opt of fd.options):
           rg.addOptionToPage(opt.value, page, rect)             // Phase 3 simplification: all options at same rect; designer enforces vertical stacking
         if (fd.defaultValue?.type === 'radio') rg.select(fd.defaultValue.value)
         if (fd.required) rg.enableRequired()
         break;

       case 'dropdown':
         if (!fd.options || fd.options.length === 0) return fail('invalid_field_definition', 'dropdown requires options')
         const dd = form.createDropdown(fd.name)
         dd.addOptions(fd.options.map(o => o.value))
         if (fd.defaultValue?.type === 'dropdown') dd.select(fd.defaultValue.value)
         dd.addToPage(page, rect)
         if (fd.required) dd.enableRequired()
         if (fd.label) setTooltipDict(dd, fd.label)
         break;

       case 'signature':
         // pdf-lib has no createSignatureField; manual PDFDict authorship.
         createSignaturePlaceholder(doc, form, fd)
         break;

       default:
         return fail('unsupported_field_type', `Phase 3 doesn't support ${fd.type}`)

  8. const newBytes = await doc.save({ useObjectStreams: true })
  9. return ok({ newBytes, warnings })
```

#### 3.4.1 Radio button placement caveat

The Phase-3 simplification places all radio options at the same `rect`. The form-designer UI (ui-spec.md §12.4 — see ui-spec amendment §12.4) requires the user to author each radio button as a separate "form-design-add" op on the renderer side, then merges them into one logical group at save. This is a UX convention; the engine still supports the canonical pdf-lib radio API.

For Phase 3 simplicity, the wave-12 implementation may opt to ship radio as a vertical-stack auto-layout: given N options + a rect, place each option in a sub-rect of equal height. This is implementation choice — David's call. The engine signature accommodates both (the `options` array is the source of truth).

### 3.5 removeField

```
removeField(input):
  1. doc = PDFDocument.load(input.bytes)
  2. const form = doc.getForm()
  3. const pdfField = form.getFieldMaybe(input.fieldName)
     if (!pdfField) return fail('field_not_found', ..., { fieldName: input.fieldName })
  4. form.removeField(pdfField)
     // This removes the field from /AcroForm /Fields AND removes widget annotations from pages.
  5. const newBytes = await doc.save({ useObjectStreams: true })
  6. return ok({ newBytes, warnings: [] })
```

### 3.6 editField

```
editField(input):
  1. doc = PDFDocument.load(input.bytes)
  2. const form = doc.getForm()
  3. const pdfField = form.getFieldMaybe(input.fieldName)
     if (!pdfField) return fail('field_not_found')
  4. apply changes:
     if (changes.rect): updateWidgetRect(pdfField, changes.rect)
     if (changes.pageIndex !== undefined): moveWidgetToPage(doc, pdfField, changes.pageIndex)
     if (changes.label): setTooltipDict(pdfField, changes.label)
     if (changes.required !== undefined): pdfField.enableRequired() / disableRequired()
     if (changes.defaultValue !== undefined): setDefaultValue(pdfField, changes.defaultValue)
     if (changes.options): updateRadioOrDropdownOptions(pdfField, changes.options)
     if (changes.name): return fail('invalid_changes', 'Field rename not supported in Phase 3')
                        // Rename would require updating /T on the field + all widgets + form_templates references;
                        // deferred to Phase 3.1
     if (changes.type): return fail('invalid_changes', 'Field type cannot be changed after creation')
  5. const newBytes = await doc.save({ useObjectStreams: true })
  6. return ok({ newBytes, warnings })
```

### 3.7 Signature placeholder authorship (manual PDFDict path)

pdf-lib has no `createSignatureField` helper. The engine hand-authors the field dict:

```
createSignaturePlaceholder(doc, form, fd):
  1. const fieldDict = PDFDict.fromMapWithContext(new Map([
       [PDFName.of('FT'), PDFName.of('Sig')],
       [PDFName.of('T'), PDFString.of(fd.name)],
       [PDFName.of('TU'), PDFString.of(fd.label ?? fd.name)],
       [PDFName.of('Ff'), PDFNumber.of(fd.required ? 2 : 0)],   // /Ff bit 2 = required
       // /V is intentionally absent in Phase 3 (placeholder)
     ]), doc.context)
  2. const widgetDict = PDFDict.fromMapWithContext(new Map([
       [PDFName.of('Type'), PDFName.of('Annot')],
       [PDFName.of('Subtype'), PDFName.of('Widget')],
       [PDFName.of('Rect'), PDFArray.fromArray([
         PDFNumber.of(fd.rect.x),
         PDFNumber.of(fd.rect.y),
         PDFNumber.of(fd.rect.x + fd.rect.width),
         PDFNumber.of(fd.rect.y + fd.rect.height),
       ], doc.context)],
       [PDFName.of('F'), PDFNumber.of(4)],                       // /F bit 3 = print
       [PDFName.of('P'), pageRef],
       [PDFName.of('Parent'), fieldRef],
     ]), doc.context)
  3. fieldDict.set(PDFName.of('Kids'), PDFArray.of([widgetRef]))
  4. form.acroForm.addField(fieldRef)
  5. page.node.addAnnot(widgetRef)
```

Detail in `src/main/pdf-ops/field-dict-authoring.ts` (David Wave 12). Inspired by the `/Ink` annotation authorship pattern (`data-models.md §3.4`, `edit-replay-engine.md §5.2`).

The widget has NO appearance stream in Phase 3. Acrobat will render the placeholder with a default "click to sign" affordance (Acrobat's built-in behavior for `/Sig` fields without `/V`). Other viewers may show a red border or nothing visible — documented in user-guide §Forms.

Phase 4 will extend this to write an appearance stream (typeset name, drawn glyph, or image), and to populate `/V` with the PKCS#7 signature dict.

---

## 4. Replay-engine integration

Per `architecture-phase-3.md §5.7`. The replay engine adds step 3.6 between 3.5 (drawOverlays) and 4 (emitAnnots):

```
3.6 applyFormOps(ctx, doc, ops):
    const formOps = ops.filter(op => isFormOp(op))
    if (formOps.length === 0) return

    let form: PDFForm
    try {
      form = doc.getForm()
    } catch (e) {
      // form may not exist; createField creates it
      form = doc.context.lookup(doc.catalog.get(PDFName.of('AcroForm')))
      if (!form) form = PDFForm.create(doc)
    }

    // Apply design ops first (mutate document structure)
    for (const op of formOps.filter(o => o.kind === 'form-design-add')) {
      try {
        applyFormDesignAdd(form, op.fieldDefinition)
      } catch (e) {
        if (e instanceof DuplicateFieldNameError) {
          ctx.warnings.push(`Skipped duplicate field name: ${op.fieldDefinition.name}`)
        } else {
          throw new ReplayError('form_field_create_failed', e.message, { fieldName: op.fieldDefinition.name })
        }
      }
    }
    for (const op of formOps.filter(o => o.kind === 'form-design-edit')) {
      applyFormDesignEdit(form, op.fieldName, op.after)
    }
    for (const op of formOps.filter(o => o.kind === 'form-design-remove')) {
      applyFormDesignRemove(form, op.fieldName)
    }

    // Merge form-commit ops (last-write-wins per field name)
    const mergedValues: Record<string, FormFieldValue> = {}
    for (const op of formOps.filter(o => o.kind === 'form-commit')) {
      Object.assign(mergedValues, op.fieldValues)
    }
    if (Object.keys(mergedValues).length > 0) {
      const { warnings } = applyFormCommit(form, mergedValues)
      ctx.warnings.push(...warnings)
    }

    // Update appearances (unless a flatten will run next; see §5)
    const font = await doc.embedFont(StandardFonts.Helvetica)
    form.updateFieldAppearances(font)
```

The order is deterministic and matches `architecture-phase-3.md §5.7`. New `ReplayError` variants:

```ts
export type ReplayError =
  // ...existing variants...
  'form_field_create_failed' | 'form_field_not_found' | 'form_flatten_failed';
```

The replay engine's purity contract (`edit-replay-engine.md §2.2`) is preserved.

---

## 5. Flatten-on-export

`pdf:export` (Phase 2 channel) gains a new request flag:

```ts
interface PdfExportRequest {
  handle: DocumentHandle;
  preference: ExportEnginePreference;
  /** NEW Phase 3: when true, flatten AcroForms in the output. */
  flattenForms?: boolean;
}
```

When `flattenForms === true`, the export pipeline:

1. Runs the regular replay (applies all ops including any form ops).
2. Calls `flattenForms({ bytes: replayResult.newBytes })` on the result.
3. Returns the flattened bytes as the final export.

For the **Chromium engine path** (Phase 1 §6.3), flatten-on-export is implicit — Chromium's `printToPDF` always emits flattened content because it's printing the rendered DOM, not preserving structure. The flag is a no-op when engine === 'chromium' (the renderer's UI hides the checkbox when Chromium is the chosen engine to avoid confusion).

For `fs:writePdf kind:'ops'` (Save), the existing channel does NOT accept a flatten flag — Save preserves form interactivity. Only Export and Print-to-PDF offer the flatten option. This is a deliberate semantic split: Save is round-trip; Export is portable artifact (`edit-replay-engine.md §4.7`).

---

## 6. Mail-merge runner

### 6.1 Algorithm

```
runMailMerge(job, onProgress):
  1. Phase: parsing-data
     const rows = await parseDataSource(job.dataSource)
       // CSV: csv-parse stream; XLSX: exceljs first-sheet rows
     onProgress({ phase: 'parsing-data', currentRow: 0, totalRows: rows.length, percent: 5 })

  2. Phase: preparing-template
     const templateBytes = await documentStore.getBytes(job.templateHandle)
       // OR: load from form_templates table and a fresh PDFDocument
     onProgress({ phase: 'preparing-template', percent: 10 })

  3. Phase: rendering-row (loop)
     const outputs: Uint8Array[] = []          // only used in concat mode
     for (let i = 0; i < rows.length; i++):
       if (cancelRequested) break
       const row = rows[i]
       const fieldValues = mapRowToFieldValues(row, job.columnMapping, job.fields)
       const fillResult = await fillForm({ bytes: templateBytes, fieldValues })
       if (!fillResult.ok) return fail('row_fill_failed', ..., { rowIndex: i, error: fillResult.error })

       if (job.outputMode === 'folder'):
         const filename = renderFilenameTemplate(job.filenameTemplate, row, i)
         const destPath = path.join(job.outputFolder, filename)
         await writeAtomic(destPath, fillResult.value.newBytes)
       else if (job.outputMode === 'concat'):
         outputs.push(fillResult.value.newBytes)

       onProgress({ phase: 'rendering-row', currentRow: i + 1, totalRows: rows.length,
                    percent: 10 + (i + 1) / rows.length * 80 })

       // Yield to event loop so renderer stays responsive
       if (i % 10 === 0) await new Promise(r => setImmediate(r))

  4. Phase: finalizing
     if (job.outputMode === 'concat'):
       const merged = await concatPdfs(outputs)
       await writeAtomic(job.outputFile, merged)
     onProgress({ phase: 'finalizing', percent: 100 })

  5. return ok({
       jobId: job.id,
       outputPath: job.outputMode === 'folder' ? job.outputFolder : job.outputFile,
       rowsWritten: cancelRequested ? i : rows.length,
       wasCancelled: cancelRequested,
       warnings: [...],
     })
```

### 6.2 `mapRowToFieldValues`

```ts
function mapRowToFieldValues(
  row: Record<string, string>,
  mapping: Record<string /* columnName */, string /* fieldName */>,
  fields: FormFieldDefinition[],
): Record<string, FormFieldValue> {
  const result: Record<string, FormFieldValue> = {};
  for (const [columnName, fieldName] of Object.entries(mapping)) {
    const cellValue = row[columnName];
    if (cellValue === undefined || cellValue === '') continue;
    const fieldDef = fields.find(f => f.name === fieldName);
    if (!fieldDef) continue;
    result[fieldName] = coerceCellToFieldValue(cellValue, fieldDef.type);
  }
  return result;
}

function coerceCellToFieldValue(cell: string, type: FormFieldType): FormFieldValue {
  switch (type) {
    case 'text':   return { type: 'text',   value: cell };
    case 'date':   return { type: 'date',   value: normalizeDate(cell) };
    case 'checkbox': {
      const truthy = ['true', 'yes', 'y', '1', 'on', 'x', 'checked'];
      return { type: 'checkbox', value: truthy.includes(cell.toLowerCase().trim()) };
    }
    case 'radio':    return { type: 'radio',    value: cell };
    case 'dropdown': return { type: 'dropdown', value: cell };
    case 'signature':return { type: 'signature',value: null };
  }
}

function normalizeDate(cell: string): string {
  // Accepts MM/DD/YYYY, DD/MM/YYYY (with locale hint from setting), ISO-8601.
  // Falls back to literal pass-through if unparseable.
  // Implementation: Phase 3 ships a simple parser; Phase 3.1 adds locale-aware via Intl.DateTimeFormat reverse-parse.
  ...
}
```

### 6.3 Filename templating

`job.filenameTemplate` (folder mode only) is a small template string with `{column}` substitutions:

```
"contract-{LastName}-{FirstName}.pdf"  →  "contract-Smith-John.pdf"
"output-{rowIndex:04}.pdf"             →  "output-0001.pdf" (zero-padded)
```

Defaults to `"merged-{rowIndex:04}.pdf"` if not supplied. Invalid filename characters are stripped via `path-sanitizer.ts` (existing Phase-1 module).

### 6.4 Concat mode

```ts
async function concatPdfs(filledBytesArray: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const bytes of filledBytesArray) {
    const src = await PDFDocument.load(bytes);
    const copiedPages = await merged.copyPages(src, src.getPageIndices());
    copiedPages.forEach((p) => merged.addPage(p));
  }
  return await merged.save({ useObjectStreams: true });
}
```

Memory: each `PDFDocument.load` parses the source; pages are deep-copied into `merged`. The source can be GC'd after `copyPages` resolves. Peak memory ≈ 2× row bytes during the copy. For N=500 with 100 KB rows, peak ≈ ~50 MB; the final merged buffer is ~50 MB. Acceptable.

Phase 3.1 perf option: stream-write to a temp file rather than holding `outputs[]` in memory. Not needed at N≤1000.

### 6.5 Cancellation

The runner reads a `cancelRequested` flag at the top of each row iteration. The renderer fires `forms:runMailMerge:cancel { jobId }` (sub-channel) which sets the flag on the active job's runner state.

On cancel:

- Folder mode: rows written so far stay on disk; runner returns `{ rowsWritten: i, wasCancelled: true }`.
- Concat mode: NO output file written (atomic semantics). Runner returns `{ rowsWritten: i, wasCancelled: true, outputPath: null }`.

---

## 7. Error modes (full table)

| Error                                  | Source                                                  | Renderer surface                                                                                  |
| -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `load_failed`                          | pdf-lib couldn't parse template bytes                   | Toast: "Couldn't load template PDF — file may be corrupt."                                        |
| `form_not_present`                     | fillForm / flattenForms on a doc without AcroForm       | Toast: "This PDF has no fillable form fields."                                                    |
| `field_type_mismatch`                  | fillForm got 'text' value on a checkbox field           | Wizard step 3 error inline: "Column '${col}' (string) cannot map to field '${field}' (checkbox)." |
| `serialize_failed`                     | pdf-lib save threw                                      | Toast: "Couldn't save the filled PDF — try Save As."                                              |
| `duplicate_field_name`                 | createField on existing name                            | Inspector inline: "A field named '${name}' already exists."                                       |
| `invalid_field_definition`             | createField with bad shape (e.g. radio without options) | Inspector inline: "Radio fields need at least one option."                                        |
| `unsupported_field_type`               | createField with future-type (e.g. list-box)            | Designer toolbar greys out the type; if forced via template load, warning toast                   |
| `page_out_of_range`                    | createField at pageIndex >= pageCount                   | Inspector inline: "Page ${page} doesn't exist in this document."                                  |
| `field_not_found`                      | removeField / editField on missing field                | Inspector inline: "Field '${name}' no longer exists."                                             |
| `invalid_changes`                      | editField with name change or type change               | Inspector inline: "Renaming fields isn't supported in Phase 3."                                   |
| `flatten_failed`                       | form.flatten() threw                                    | Toast: "Couldn't flatten the form — try export with Chromium engine."                             |
| (Mail-merge) `row_fill_failed`         | Per-row fillForm failure during merge                   | Wizard error: "Row ${i} couldn't be filled. Cancel and review the CSV."                           |
| (Mail-merge) `data_parse_failed`       | csv-parse / exceljs threw                               | Wizard step 2 inline: "Couldn't parse the data file. Check format."                               |
| (Mail-merge) `unmapped_required_field` | A required field has no column mapping                  | Wizard step 3 inline: "Field '${name}' is required but no column is mapped."                      |
| (Mail-merge) `output_path_invalid`     | output folder / file path failed sanitizer              | Wizard step 4 inline: "Choose a valid output location."                                           |

---

## 8. Data source parsers

### 8.1 CSV (`csv-source.ts`)

```ts
import { parse } from 'csv-parse/sync';

export async function parseCsv(bytes: Uint8Array, options: ParseOptions): Promise<Row[]> {
  const text = new TextDecoder('utf-8').decode(bytes);
  const records = parse(text, {
    columns: true, // first row = headers
    bom: true, // strip UTF-8 BOM
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true, // accept rows with fewer columns
    relax_quotes: true,
  });
  return records as Row[];
}
```

Handles: UTF-8 BOM, quoted strings with embedded commas, escaped quotes (RFC 4180), CRLF and LF line endings, ragged rows. Does NOT handle: Latin-1 encoding (user-guide flags this — recommend re-saving as UTF-8 in Excel).

### 8.2 Excel (`excel-source.ts`)

```ts
import ExcelJS from 'exceljs';

export async function parseExcel(bytes: Uint8Array): Promise<{ rows: Row[]; warnings: string[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const warnings: string[] = [];

  if (workbook.worksheets.length > 1) {
    warnings.push(
      `Workbook has ${workbook.worksheets.length} sheets; using sheet 1 only (Phase 3 limitation)`,
    );
  }

  const sheet = workbook.worksheets[0];
  const headerRow = sheet.getRow(1).values as string[]; // [empty, col1, col2, ...]
  const headers = headerRow.slice(1).map(String);

  const rows: Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const obj: Row = {};
    headers.forEach((header, i) => {
      const cell = row.getCell(i + 1);
      obj[header] = cell.text; // .text reads formula's cached value as string
    });
    rows.push(obj);
  });

  return { rows, warnings };
}
```

Handles: `.xlsx` (Open XML) AND `.xls` (legacy binary OLE — exceljs supports via separate codepath). Formula cells return their cached value (Excel saves these on `Save`). Empty cells return empty string. Multi-sheet warning surfaces in wizard step 2.

Does NOT handle: formula evaluation, embedded objects, password-protected workbooks (returns parse error).

---

## 9. Test strategy (Wave 12, David + Ravi)

### 9.1 Fixture corpus

Lives in `tests/fixtures/form-engine/`:

- `empty-form.pdf` — minimal PDF with empty `/AcroForm` dict (detection should return `hasAcroForm: false`)
- `simple-text-form.pdf` — three text fields (golden detect + fill)
- `mixed-form.pdf` — text + checkbox + radio + dropdown + date (golden detect + fill matrix)
- `signed-form.pdf` — has existing `/Sig` field with `/V` populated (Phase 3 surfaces but doesn't preserve on save; warns)
- `js-action-form.pdf` — has `/Names /JavaScript` block (Phase 3 strips; warns)
- `xfa-only-form.pdf` — XFA payload, no AcroForm (Phase 3 detects + flags read-only)
- `multi-widget-field.pdf` — single field with two widget annotations on different pages
- `template-source.pdf` — used for mail-merge tests
- `merge-data.csv` — 5 rows with header row
- `merge-data.xlsx` — same data + a second sheet (warning)
- `corrupt-form.pdf` — malformed `/AcroForm` (detect_failed path)

### 9.2 Test categories

| Category                       | Coverage                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Detection — happy path         | For each fixture: detectForms returns the expected `fields` shape                                                     |
| Detection — unsupported types  | js-action-form, xfa-only-form, signed-form — assert specific warnings + flags                                         |
| Fill — single value            | Each field type: fill, save, reload, assert /V contains the value                                                     |
| Fill — type mismatch           | Fill 'text' value on a checkbox field → field_type_mismatch                                                           |
| Fill — unmatched               | Fill a name not in the doc → returns in unmatchedFieldNames, NOT an error                                             |
| Flatten                        | Flatten a filled form, reload, assert no /AcroForm dict, assert pages have visible filled content via text-extraction |
| Create — each type             | For text / checkbox / radio / dropdown / signature: create, save, reload, detect, assert presence                     |
| Create — duplicate name        | createField with name already used → duplicate_field_name                                                             |
| Create — invalid radio         | createField with type radio and empty options → invalid_field_definition                                              |
| Edit — rect change             | editField with new rect, reload, assert widget rect updated                                                           |
| Edit — rename rejected         | editField with `changes.name` set → invalid_changes                                                                   |
| Remove                         | removeField, reload, assert field gone from /AcroForm and widget gone from page /Annots                               |
| Mail-merge — folder mode       | 5-row CSV, assert 5 files written, assert each has correct values                                                     |
| Mail-merge — concat mode       | Same, assert single output PDF with 5 pages and correct values                                                        |
| Mail-merge — cancellation      | Trigger cancel mid-run, assert partial folder output OR no concat output                                              |
| Mail-merge — unmapped required | Field marked required + no column mapping → unmapped_required_field                                                   |
| Mail-merge — perf              | 100-row CSV completes in <30s on the Linux CI runner                                                                  |
| Progress events                | Capture progress event sequence, assert phases reach 100% monotonically, currentRow increments                        |
| Round-trip (golden bytes)      | Fill same fixture with same values twice; assert byte-equality (determinism)                                          |
| Replay-engine integration      | Dispatch a `form-commit` op into `replay()`; assert the output PDF has the value at the right field                   |

### 9.3 Golden-bytes test pattern

Same as `edit-replay-engine.md §14.3`. Pin a `simple-fill.golden.pdf` for the simple-text-form fixture + a known fill values map. If pdf-lib changes its `updateFieldAppearances` output bytes, the test alerts and the team re-pins consciously.

### 9.4 Property tests (stretch, Phase 3.1 if budget runs out)

For the round-trip identity: random field-fill + flatten → re-extract text → assert the filled values appear in the page content stream. Uses `fast-check` (already a pattern in Phase 1 inverse tests).

---

## 10. Phase-3 vs Phase-3.1 vs Phase-4 boundaries

### 10.1 In Phase 3 (Wave 12)

- detectForms with the field-type matrix (§3.1.1)
- fillForm for text / checkbox / radio / dropdown / date
- flattenForms
- createField + editField + removeField for the same five types + signature placeholder
- Mail-merge runner with CSV + Excel, folder + concat output modes, progress streaming, cancellation
- Field-mapping persistence in `form_templates.last_column_mappings`
- Replay-engine step 3.6 integration

### 10.2 Phase 3.1 (post-ship hardening, optional)

- JavaScript form actions preserved read-only
- Calculated fields
- Regex / length validators
- Multi-line text fields with `/MaxLen`
- List-box (`PDFOptionList`) as distinct type
- worker_threads parallelism for huge mail-merge jobs
- Excel sheet picker
- Field rename (with form_templates back-reference rewrite)
- Field tab-order authoring

### 10.3 Phase 4+

- Actual signing (sign-engine.ts integrates with fillForm for `signature` value with non-null payload)
- Square / Circle / Line annotations (unchanged from Phase 1 extension table)
- OCR-as-fillable-form (Phase 5)
- Office export of filled forms (Phase 6, flattens first)

The engine's module shape is designed to absorb these without refactoring `FormFieldDefinition` or `FormFieldValue` — each new field-type variant is one new `case` branch in `applyValueToField` + one in `createField` + one type test in `extractFieldDefinition`.

---

## 11. Files this engine creates / extends (Wave 12 ownership, for reference)

| File                                              | Status | Owner                                                |
| ------------------------------------------------- | ------ | ---------------------------------------------------- |
| `src/main/pdf-ops/form-engine.ts`                 | NEW    | David                                                |
| `src/main/pdf-ops/form-engine.test.ts`            | NEW    | David                                                |
| `src/main/pdf-ops/mail-merge.ts`                  | NEW    | David                                                |
| `src/main/pdf-ops/mail-merge.test.ts`             | NEW    | David                                                |
| `src/main/pdf-ops/field-dict-authoring.ts`        | NEW    | David                                                |
| `src/main/data-sources/csv-source.ts`             | NEW    | David                                                |
| `src/main/data-sources/excel-source.ts`           | NEW    | David                                                |
| `src/main/pdf-ops/replay-engine.ts`               | EDIT   | David — adds step 3.6                                |
| `src/ipc/handlers/forms-detect.ts`                | NEW    | David                                                |
| `src/ipc/handlers/forms-fill.ts`                  | NEW    | David                                                |
| `src/ipc/handlers/forms-flatten.ts`               | NEW    | David                                                |
| `src/ipc/handlers/forms-design-add.ts`            | NEW    | David                                                |
| `src/ipc/handlers/forms-design-remove.ts`         | NEW    | David                                                |
| `src/ipc/handlers/forms-list-templates.ts`        | NEW    | David                                                |
| `src/ipc/handlers/forms-save-template.ts`         | NEW    | David                                                |
| `src/ipc/handlers/forms-load-template.ts`         | NEW    | David                                                |
| `src/ipc/handlers/forms-run-mail-merge.ts`        | NEW    | David                                                |
| `src/ipc/contracts.ts`                            | EDIT   | David — new channel types per `api-contracts.md §13` |
| `src/ipc/register.ts`                             | EDIT   | David                                                |
| `migrations/0003_phase3_forms.sql`                | NEW    | Ravi                                                 |
| `src/db/repositories/form-templates-repo.ts`      | NEW    | Ravi                                                 |
| `src/db/repositories/form-templates-repo.test.ts` | NEW    | Ravi                                                 |
| `src/db/types.ts`                                 | EDIT   | Ravi — `FormTemplateRow`                             |
| `tests/fixtures/form-engine/*.pdf`                | NEW    | David                                                |
| `tests/fixtures/form-engine/*.csv` / `*.xlsx`     | NEW    | David                                                |

Riley owns nothing in this engine — it's entirely main-process + DB. Riley owns the **callers** in the renderer (`thunks.ts`, the new components in `architecture-phase-3.md §2.3`).

---

## 12. Cross-reference checklist

- [x] All six engine functions have signatures + algorithms (§2.1, §3)
- [x] Purity contract documented (§2.2)
- [x] pdf-lib CREATE boundary verdict + manual-dict path for signature (§3.4, §3.7)
- [x] Replay-engine integration spec (§4)
- [x] Flatten-on-export spec (§5)
- [x] Mail-merge runner: parse + fill + write loop (§6.1)
- [x] Mail-merge cancellation (§6.5)
- [x] Error mode table (§7)
- [x] Data-source parsers (CSV + Excel) (§8)
- [x] Test strategy with fixture corpus (§9)
- [x] Phase 3 vs 3.1 vs 4+ scope fence (§10)
- [x] File-ownership map for Wave 12 (§11)
- [x] L-001 untouched — this doc does not weaken or reference `enableDragDropFiles`

End of form-engine design.
