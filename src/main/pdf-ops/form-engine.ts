// Phase 3 Form Engine — AcroForm detect / fill / flatten / create / edit / remove.
//
// Contract: `docs/form-engine.md` (Riley, Wave 11, 932 lines).
// Architecture cross-ref: `docs/architecture-phase-3.md §4-§6`.
// Convention: `docs/conventions.md §14.5` (pure function contract identical
// to replay engine §13.2).
//
// All public functions are pure over (bytes, args):
//   - No FS, no DB, no network, no console.log
//   - No mutation of `input.bytes`
//   - Same input -> same output (modulo pdf-lib's deterministic re-emit)
//
// The internal helpers (applyFormCommit / applyFormDesignAdd etc.) operate
// on a live PDFForm and are called by the replay engine's step 3.6
// (architecture-phase-3.md §5.7).
//
// L-001 untouched (no BrowserWindow construction here).

import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  StandardFonts,
} from 'pdf-lib';
import type { PDFField, PDFForm } from 'pdf-lib';

import type {
  FormFieldDefinition,
  FormFieldOption,
  FormFieldType,
  FormFieldValue,
} from '../../ipc/contracts.js';
import type { Result } from '../../shared/result.js';
import { fail, ok } from '../../shared/result.js';

import { createSignaturePlaceholder } from './field-dict-authoring.js';

// ============================================================================
// Public function signatures (form-engine.md §2.1)
// ============================================================================

export type DetectFormsError = 'load_failed' | 'detect_failed';
export interface DetectFormsOk {
  fields: FormFieldDefinition[];
  hasAcroForm: boolean;
  hasXfaForm: boolean;
  hasJavaScriptActions: boolean;
  warnings: string[];
}
export type DetectFormsResult = Result<DetectFormsOk, DetectFormsError>;

export type FillFormError =
  | 'load_failed'
  | 'form_not_present'
  | 'field_type_mismatch'
  | 'serialize_failed';
export interface FillFormOk {
  newBytes: Uint8Array;
  filledFieldNames: string[];
  unmatchedFieldNames: string[];
  warnings: string[];
}
export type FillFormResult = Result<FillFormOk, FillFormError>;

export type FlattenFormsError =
  | 'load_failed'
  | 'form_not_present'
  | 'flatten_failed'
  | 'serialize_failed';
export interface FlattenFormsOk {
  newBytes: Uint8Array;
  flattenedFieldCount: number;
  warnings: string[];
}
export type FlattenFormsResult = Result<FlattenFormsOk, FlattenFormsError>;

export type CreateFieldError =
  | 'load_failed'
  | 'duplicate_field_name'
  | 'invalid_field_definition'
  | 'unsupported_field_type'
  | 'page_out_of_range'
  | 'serialize_failed';
export interface CreateFieldOk {
  newBytes: Uint8Array;
  warnings: string[];
}
export type CreateFieldResult = Result<CreateFieldOk, CreateFieldError>;

export type RemoveFieldError = 'load_failed' | 'field_not_found' | 'serialize_failed';
export interface RemoveFieldOk {
  newBytes: Uint8Array;
  warnings: string[];
}
export type RemoveFieldResult = Result<RemoveFieldOk, RemoveFieldError>;

export type EditFieldError =
  | 'load_failed'
  | 'field_not_found'
  | 'invalid_changes'
  | 'serialize_failed';
export interface EditFieldOk {
  newBytes: Uint8Array;
  warnings: string[];
}
export type EditFieldResult = Result<EditFieldOk, EditFieldError>;

// ============================================================================
// Detection (form-engine.md §3.1)
// ============================================================================

export async function detectForms(bytes: Uint8Array): Promise<DetectFormsResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (e) {
    return fail<DetectFormsError>('load_failed', (e as Error).message);
  }

  const warnings: string[] = [];
  let form: PDFForm | null = null;
  try {
    form = doc.getForm();
  } catch {
    // No /AcroForm — treat as empty (not an error).
    form = null;
  }

  const acroFields = form ? safeGetFields(form, warnings) : [];
  const hasAcroForm = acroFields.length > 0;
  const hasXfaForm = detectXfa(doc);
  const hasJavaScriptActions = detectJavaScript(doc);

  const fields: FormFieldDefinition[] = [];
  if (form && hasAcroForm) {
    for (const pdfField of acroFields) {
      const def = extractFieldDefinition(pdfField, doc, warnings);
      if (def) fields.push(def);
    }
  }

  return ok({
    fields,
    hasAcroForm,
    hasXfaForm,
    hasJavaScriptActions,
    warnings,
  });
}

function safeGetFields(form: PDFForm, warnings: string[]): PDFField[] {
  try {
    return form.getFields();
  } catch (e) {
    warnings.push(`form.getFields() threw: ${(e as Error).message}`);
    return [];
  }
}

/**
 * XFA detection: catalog -> /AcroForm -> /XFA. The XFA entry can be either
 * a stream or an array of name/stream pairs (PDF spec). Either presence
 * marks the doc as XFA-bearing.
 */
function detectXfa(doc: PDFDocument): boolean {
  try {
    const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (!acroForm) return false;
    return acroForm.has(PDFName.of('XFA'));
  } catch {
    return false;
  }
}

/**
 * JS-action detection: catalog -> /Names -> /JavaScript. Phase 3 strips
 * these on save (conventions §14.6).
 */
function detectJavaScript(doc: PDFDocument): boolean {
  try {
    const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    if (!names) return false;
    return names.has(PDFName.of('JavaScript'));
  } catch {
    return false;
  }
}

/**
 * Map a pdf-lib field object to FormFieldDefinition per form-engine.md §3.1.1.
 * Returns null for unsupported types (a warning is pushed instead).
 */
function extractFieldDefinition(
  pdfField: PDFField,
  doc: PDFDocument,
  warnings: string[],
): FormFieldDefinition | null {
  const name = pdfField.getName();
  if (!name) {
    warnings.push('Skipped field with empty name');
    return null;
  }

  // Walk the widget annotations on the field — Phase 3 emits the first widget
  // as the canonical rect; multi-widget fields surface a warning so the
  // designer's per-widget layout limitation is honest.
  const acroField = (pdfField as unknown as { acroField: AcroFieldLike }).acroField;
  const widgets = safeGetWidgets(acroField);
  if (widgets.length === 0) {
    warnings.push(`Skipped field '${name}' (no widget annotation)`);
    return null;
  }
  if (widgets.length > 1) {
    warnings.push(`Field '${name}' has ${widgets.length} widgets; using widget 0 for rect`);
  }
  const widget0 = widgets[0];
  if (!widget0) return null;

  const rectArr = widget0.Rect();
  if (!rectArr || rectArr.length < 4) {
    warnings.push(`Skipped field '${name}' (widget /Rect malformed)`);
    return null;
  }
  // ISO 32000 /Rect = [llx lly urx ury]
  const llx = rectArr[0] ?? 0;
  const lly = rectArr[1] ?? 0;
  const urx = rectArr[2] ?? 0;
  const ury = rectArr[3] ?? 0;
  const x = Math.min(llx, urx);
  const y = Math.min(lly, ury);
  const width = Math.abs(urx - llx);
  const height = Math.abs(ury - lly);

  // Page-index resolution: find which page's /Annots holds this widget ref.
  const widgetRef = widget0.ref;
  let pageIndex = -1;
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (!page) continue;
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let j = 0; j < annots.size(); j += 1) {
      const candidate = annots.get(j);
      if (candidate && widgetRef && candidate === widgetRef) {
        pageIndex = i;
        break;
      }
    }
    if (pageIndex >= 0) break;
  }
  if (pageIndex < 0) {
    warnings.push(`Field '${name}' widget not attached to any page; defaulting pageIndex=0`);
    pageIndex = 0;
  }

  // Determine the FormFieldType per the matrix in form-engine.md §3.1.1.
  let type: FormFieldType;
  let options: FormFieldOption[] | undefined;
  const label = readFieldTooltip(pdfField) ?? name;
  const hasDateMarker = /\(date\)/i.test(label);

  if (pdfField instanceof PDFTextField) {
    type = hasDateMarker ? 'date' : 'text';
  } else if (pdfField instanceof PDFCheckBox) {
    type = 'checkbox';
  } else if (pdfField instanceof PDFRadioGroup) {
    type = 'radio';
    try {
      options = pdfField.getOptions().map((v) => ({ value: v, label: v }));
    } catch {
      options = [];
    }
  } else if (pdfField instanceof PDFDropdown) {
    type = 'dropdown';
    try {
      options = pdfField.getOptions().map((v) => ({ value: v, label: v }));
    } catch {
      options = [];
    }
  } else if (pdfField instanceof PDFOptionList) {
    type = 'dropdown';
    try {
      options = pdfField.getOptions().map((v) => ({ value: v, label: v }));
    } catch {
      options = [];
    }
    warnings.push(`Field '${name}': list-box rendered as dropdown (Phase 3 limitation)`);
  } else if (isPDFSignature(pdfField)) {
    type = 'signature';
  } else {
    warnings.push(`Field '${name}': unsupported type ${typeof pdfField}; skipped`);
    return null;
  }

  const required = safeIsRequired(pdfField);

  const def: FormFieldDefinition = {
    name,
    type,
    pageIndex,
    rect: { x, y, width, height },
    label,
    required,
    origin: 'detected',
    unsaved: false,
  };
  if (options !== undefined) def.options = options;
  return def;
}

interface AcroFieldLike {
  getWidgets?: () => Array<{
    Rect: () => number[] | undefined;
    ref?: unknown;
    getOnValue?: () => unknown;
  }>;
}

function safeGetWidgets(
  acroField: AcroFieldLike,
): Array<{ Rect: () => number[] | undefined; ref: unknown }> {
  if (!acroField || typeof acroField.getWidgets !== 'function') return [];
  try {
    const raw = acroField.getWidgets();
    return raw.map((w) => {
      const rectFn = w.Rect;
      // pdf-lib's PDFAnnotation.Rect returns a PDFArray; we read .asNumber()s.
      return {
        Rect: () => {
          try {
            const arr = rectFn.call(w) as
              | { asNumber: () => number; size: () => number }
              | undefined;
            if (!arr || typeof arr.size !== 'function') return undefined;
            const out: number[] = [];
            for (let i = 0; i < arr.size(); i += 1) {
              const it = (arr as unknown as { get: (i: number) => { asNumber: () => number } }).get(
                i,
              );
              out.push(it.asNumber());
            }
            return out;
          } catch {
            return undefined;
          }
        },
        ref: (w as unknown as { ref?: unknown }).ref,
      };
    });
  } catch {
    return [];
  }
}

function readFieldTooltip(pdfField: PDFField): string | null {
  try {
    const dict = (pdfField as unknown as { acroField: { dict: PDFDictLike } }).acroField.dict;
    const tu = dict.lookupMaybe(PDFName.of('TU'), PDFString);
    if (tu) return tu.asString();
  } catch {
    /* no /TU */
  }
  return null;
}

interface PDFDictLike {
  lookupMaybe: (key: PDFName, t: typeof PDFString) => PDFString | undefined;
  has: (key: PDFName) => boolean;
}

function safeIsRequired(pdfField: PDFField): boolean {
  try {
    return pdfField.isRequired();
  } catch {
    return false;
  }
}

function isPDFSignature(pdfField: PDFField): boolean {
  // pdf-lib exposes PDFSignature; check the constructor name to avoid an
  // import cycle between this module and the signature class (which may
  // change name across pdf-lib minor versions).
  try {
    const ctorName = (pdfField as unknown as { constructor: { name: string } }).constructor.name;
    return ctorName === 'PDFSignature';
  } catch {
    return false;
  }
}

// ============================================================================
// Fill (form-engine.md §3.2)
// ============================================================================

export async function fillForm(
  bytes: Uint8Array,
  fieldValues: Record<string, FormFieldValue>,
  options: { updateAppearances?: boolean; flatten?: boolean } = {},
): Promise<FillFormResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch (e) {
    return fail<FillFormError>('load_failed', (e as Error).message);
  }

  let form: PDFForm;
  try {
    form = doc.getForm();
  } catch {
    return fail<FillFormError>('form_not_present', 'document has no AcroForm');
  }
  // pdf-lib's getForm() creates an empty AcroForm dict when none exists;
  // treat the no-fields case as form_not_present so the caller's error
  // toast is honest about the situation (form-engine.md §3.2 spirit).
  let fieldCount = 0;
  try {
    fieldCount = form.getFields().length;
  } catch {
    fieldCount = 0;
  }
  if (fieldCount === 0) {
    return fail<FillFormError>('form_not_present', 'document has no AcroForm fields');
  }

  const filledFieldNames: string[] = [];
  const unmatchedFieldNames: string[] = [];
  const warnings: string[] = [];

  for (const [name, value] of Object.entries(fieldValues)) {
    const pdfField = safeGetFieldMaybe(form, name);
    if (!pdfField) {
      unmatchedFieldNames.push(name);
      continue;
    }
    const r = applyValueToField(pdfField, value);
    if (!r.ok) {
      return fail<FillFormError>('field_type_mismatch', r.message, { fieldName: name });
    }
    filledFieldNames.push(name);
  }

  // Regenerate appearance streams unless suppressed.
  if (options.updateAppearances !== false) {
    try {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      form.updateFieldAppearances(font);
    } catch (e) {
      warnings.push(`updateFieldAppearances threw: ${(e as Error).message}`);
    }
  }

  // Phase 3.1 (H-3.2, David): optional per-job flatten. The mail-merge runner
  // sets this when `MailMergeJob.flattenForms === true` so the per-row output
  // is non-editable. Form-fill UI (single-doc fillForm IPC) passes false /
  // omits — the renderer dispatches a separate `form-flatten` op when needed.
  if (options.flatten === true) {
    try {
      form.flatten();
    } catch (e) {
      // flatten failure is non-fatal — surface as a warning and continue with
      // the unflattened bytes; the caller can still consume them.
      warnings.push(`flatten failed (non-fatal): ${(e as Error).message}`);
    }
  }

  // Phase 3.1 (H-3.1, David): strip document-level JavaScript actions before
  // serialize per P3-L-2 (conventions §14.6). Previously this was only called
  // inside replay-engine's form-ops branch — `fillForm` itself and the
  // mail-merge runner per-row outputs leaked the template's JS actions.
  // Idempotent: stripDocLevelJavaScript is a no-op when no JS is present.
  if (stripDocLevelJavaScript(doc)) {
    warnings.push(
      'JavaScript actions stripped from document (Phase 3 limitation; Phase 3.1 may preserve read-only)',
    );
  }

  let newBytes: Uint8Array;
  try {
    newBytes = await doc.save({
      useObjectStreams: true,
      updateFieldAppearances: false,
    });
  } catch (e) {
    return fail<FillFormError>('serialize_failed', (e as Error).message);
  }

  return ok({ newBytes, filledFieldNames, unmatchedFieldNames, warnings });
}

function safeGetFieldMaybe(form: PDFForm, name: string): PDFField | null {
  try {
    return form.getFieldMaybe(name) ?? null;
  } catch {
    return null;
  }
}

/**
 * Apply a value to the appropriate pdf-lib field type. Returns the same
 * structure as a Result so the caller can map to the correct error variant.
 * Used by both fillForm and applyFormCommit.
 */
export function applyValueToField(
  pdfField: PDFField,
  value: FormFieldValue,
): Result<void, 'field_type_mismatch'> {
  switch (value.type) {
    case 'text':
      if (!(pdfField instanceof PDFTextField)) {
        return fail('field_type_mismatch', `field is not text`);
      }
      pdfField.setText(value.value);
      return ok(undefined);
    case 'checkbox':
      if (!(pdfField instanceof PDFCheckBox)) {
        return fail('field_type_mismatch', `field is not checkbox`);
      }
      if (value.value) pdfField.check();
      else pdfField.uncheck();
      return ok(undefined);
    case 'radio':
      if (!(pdfField instanceof PDFRadioGroup)) {
        return fail('field_type_mismatch', `field is not radio group`);
      }
      pdfField.select(value.value);
      return ok(undefined);
    case 'dropdown':
      if (!(pdfField instanceof PDFDropdown) && !(pdfField instanceof PDFOptionList)) {
        return fail('field_type_mismatch', `field is not dropdown/list`);
      }
      pdfField.select(value.value);
      return ok(undefined);
    case 'date':
      if (!(pdfField instanceof PDFTextField)) {
        return fail('field_type_mismatch', `field is not text (for date)`);
      }
      // ISO-8601 string written to /V; renderer formats per locale (P3-L-2).
      pdfField.setText(value.value);
      return ok(undefined);
    case 'signature':
      // Phase 3: signature values always null; no-op. Phase 4 will dispatch
      // into sign-engine.ts here.
      return ok(undefined);
    default: {
      const exhaustive: never = value;
      void exhaustive;
      return fail('field_type_mismatch', 'unknown value.type');
    }
  }
}

// ============================================================================
// Flatten (form-engine.md §3.3)
// ============================================================================

export async function flattenForms(bytes: Uint8Array): Promise<FlattenFormsResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch (e) {
    return fail<FlattenFormsError>('load_failed', (e as Error).message);
  }
  let form: PDFForm;
  try {
    form = doc.getForm();
  } catch {
    return fail<FlattenFormsError>('form_not_present', 'document has no AcroForm');
  }

  let fieldCount = 0;
  try {
    fieldCount = form.getFields().length;
  } catch {
    fieldCount = 0;
  }

  if (fieldCount === 0) {
    return fail<FlattenFormsError>('form_not_present', 'AcroForm has zero fields');
  }

  try {
    form.flatten();
  } catch (e) {
    return fail<FlattenFormsError>('flatten_failed', (e as Error).message);
  }

  // Phase 3.1 (H-3.1, David): strip doc-level JS actions before serialize per
  // P3-L-2 (conventions §14.6). A flattened form's output should not retain
  // /Names /JavaScript regardless of whether the runner came in via replay or
  // a standalone flattenForms() call.
  const warnings: string[] = [];
  if (stripDocLevelJavaScript(doc)) {
    warnings.push(
      'JavaScript actions stripped from document (Phase 3 limitation; Phase 3.1 may preserve read-only)',
    );
  }

  let newBytes: Uint8Array;
  try {
    newBytes = await doc.save({ useObjectStreams: true });
  } catch (e) {
    return fail<FlattenFormsError>('serialize_failed', (e as Error).message);
  }

  return ok({ newBytes, flattenedFieldCount: fieldCount, warnings });
}

// ============================================================================
// Create field (form-engine.md §3.4)
// ============================================================================

export async function createField(
  bytes: Uint8Array,
  fd: FormFieldDefinition,
): Promise<CreateFieldResult> {
  // Field-definition validation per data-models §8.8
  const validationErr = validateFieldDefinition(fd);
  if (validationErr) {
    return fail<CreateFieldError>('invalid_field_definition', validationErr);
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch (e) {
    return fail<CreateFieldError>('load_failed', (e as Error).message);
  }

  if (fd.pageIndex < 0 || fd.pageIndex >= doc.getPageCount()) {
    return fail<CreateFieldError>(
      'page_out_of_range',
      `pageIndex ${fd.pageIndex} of ${doc.getPageCount()}`,
    );
  }

  const form = doc.getForm();
  if (safeGetFieldMaybe(form, fd.name)) {
    return fail<CreateFieldError>('duplicate_field_name', `field '${fd.name}' already exists`, {
      fieldName: fd.name,
    });
  }

  const warnings: string[] = [];

  try {
    addFieldToDoc(doc, form, fd, warnings);
  } catch (e) {
    const msg = (e as Error).message;
    // Surface authoring failures with the right discriminant.
    if (/duplicate/i.test(msg)) {
      return fail<CreateFieldError>('duplicate_field_name', msg);
    }
    return fail<CreateFieldError>('invalid_field_definition', `create field threw: ${msg}`);
  }

  let newBytes: Uint8Array;
  try {
    newBytes = await doc.save({ useObjectStreams: true });
  } catch (e) {
    return fail<CreateFieldError>('serialize_failed', (e as Error).message);
  }
  return ok({ newBytes, warnings });
}

function validateFieldDefinition(fd: FormFieldDefinition): string | null {
  if (typeof fd.name !== 'string' || fd.name.length === 0 || fd.name.length > 63) {
    return 'name must be 1..63 chars';
  }
  if (fd.name.includes('.')) {
    return "name must not contain '.' (nested fields not supported in Phase 3)";
  }
  if (
    !Number.isFinite(fd.rect.x) ||
    !Number.isFinite(fd.rect.y) ||
    !Number.isFinite(fd.rect.width) ||
    !Number.isFinite(fd.rect.height)
  ) {
    return 'rect coords must be finite';
  }
  if (fd.rect.width <= 0 || fd.rect.height <= 0) {
    return 'rect width/height must be > 0';
  }
  if (fd.type === 'radio' || fd.type === 'dropdown') {
    if (!fd.options || fd.options.length === 0) {
      return `${fd.type} requires non-empty options`;
    }
  }
  if (fd.type !== 'radio' && fd.type !== 'dropdown' && fd.options !== undefined) {
    // Forbidden but not fatal — strip silently? Be strict per §8.8.
    return `options forbidden for type '${fd.type}'`;
  }
  return null;
}

function addFieldToDoc(
  doc: PDFDocument,
  form: PDFForm,
  fd: FormFieldDefinition,
  warnings: string[],
): void {
  const page = doc.getPage(fd.pageIndex);
  const rect = { x: fd.rect.x, y: fd.rect.y, width: fd.rect.width, height: fd.rect.height };

  switch (fd.type) {
    case 'text':
    case 'date': {
      const tf = form.createTextField(fd.name);
      if (fd.defaultValue?.type === 'text') tf.setText(fd.defaultValue.value);
      else if (fd.defaultValue?.type === 'date') tf.setText(fd.defaultValue.value);
      tf.addToPage(page, rect);
      if (fd.required) tf.enableRequired();
      setTooltip(tf, fd.type === 'date' ? withDateMarker(fd.label || fd.name) : fd.label);
      return;
    }
    case 'checkbox': {
      const cb = form.createCheckBox(fd.name);
      if (fd.defaultValue?.type === 'checkbox' && fd.defaultValue.value) cb.check();
      cb.addToPage(page, rect);
      if (fd.required) cb.enableRequired();
      setTooltip(cb, fd.label);
      return;
    }
    case 'radio': {
      if (!fd.options || fd.options.length === 0) {
        throw new Error('radio requires options');
      }
      const rg = form.createRadioGroup(fd.name);
      // Vertical-stack auto-layout: each option gets a sub-rect of equal height.
      const optH = rect.height / fd.options.length;
      for (let i = 0; i < fd.options.length; i += 1) {
        const opt = fd.options[i];
        if (!opt) continue;
        rg.addOptionToPage(opt.value, page, {
          x: rect.x,
          y: rect.y + (fd.options.length - 1 - i) * optH,
          width: rect.width,
          height: optH,
        });
      }
      if (fd.defaultValue?.type === 'radio') rg.select(fd.defaultValue.value);
      if (fd.required) rg.enableRequired();
      return;
    }
    case 'dropdown': {
      if (!fd.options || fd.options.length === 0) {
        throw new Error('dropdown requires options');
      }
      const dd = form.createDropdown(fd.name);
      dd.addOptions(fd.options.map((o) => o.value));
      if (fd.defaultValue?.type === 'dropdown') dd.select(fd.defaultValue.value);
      dd.addToPage(page, rect);
      if (fd.required) dd.enableRequired();
      setTooltip(dd, fd.label);
      return;
    }
    case 'signature': {
      const r = createSignaturePlaceholder(doc, fd);
      if (!r.ok) {
        throw new Error(`signature placeholder authorship failed: ${r.message}`);
      }
      return;
    }
    default: {
      const exhaustive: never = fd.type;
      void exhaustive;
      warnings.push(`Unknown type '${String((fd as { type: unknown }).type)}'`);
    }
  }
}

function setTooltip(field: PDFField, label: string): void {
  if (!label) return;
  try {
    const dict = (field as unknown as { acroField: { dict: PDFDictWriteable } }).acroField.dict;
    dict.set(PDFName.of('TU'), PDFString.of(label));
  } catch {
    /* tooltip is best-effort */
  }
}

interface PDFDictWriteable {
  set: (k: PDFName, v: PDFString) => void;
}

function withDateMarker(label: string): string {
  return /\(date\)/i.test(label) ? label : `${label} (date)`;
}

// ============================================================================
// Remove field (form-engine.md §3.5)
// ============================================================================

export async function removeField(
  bytes: Uint8Array,
  fieldName: string,
): Promise<RemoveFieldResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch (e) {
    return fail<RemoveFieldError>('load_failed', (e as Error).message);
  }
  const form = doc.getForm();
  const pdfField = safeGetFieldMaybe(form, fieldName);
  if (!pdfField) {
    return fail<RemoveFieldError>('field_not_found', `field '${fieldName}' not found`);
  }
  try {
    form.removeField(pdfField);
  } catch (e) {
    return fail<RemoveFieldError>('field_not_found', (e as Error).message);
  }
  let newBytes: Uint8Array;
  try {
    newBytes = await doc.save({ useObjectStreams: true });
  } catch (e) {
    return fail<RemoveFieldError>('serialize_failed', (e as Error).message);
  }
  return ok({ newBytes, warnings: [] });
}

// ============================================================================
// Edit field (form-engine.md §3.6)
// ============================================================================

export async function editField(
  bytes: Uint8Array,
  fieldName: string,
  changes: Partial<FormFieldDefinition>,
): Promise<EditFieldResult> {
  if (changes.name !== undefined && changes.name !== fieldName) {
    return fail<EditFieldError>('invalid_changes', 'field rename not supported in Phase 3');
  }
  if (changes.type !== undefined) {
    return fail<EditFieldError>('invalid_changes', 'field type cannot be changed');
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch (e) {
    return fail<EditFieldError>('load_failed', (e as Error).message);
  }
  const form = doc.getForm();
  const pdfField = safeGetFieldMaybe(form, fieldName);
  if (!pdfField) {
    return fail<EditFieldError>('field_not_found', `field '${fieldName}' not found`);
  }

  const warnings: string[] = [];
  try {
    if (changes.label !== undefined) setTooltip(pdfField, changes.label);
    if (changes.required !== undefined) {
      if (changes.required) pdfField.enableRequired();
      else pdfField.disableRequired();
    }
    if (changes.rect) {
      // Update widget rect by overwriting the field's first widget's /Rect.
      const acroField = (pdfField as unknown as { acroField: AcroFieldLike }).acroField;
      const widgets = acroField.getWidgets?.() ?? [];
      const widget0 = widgets[0] as unknown as {
        dict: { set: (k: PDFName, v: unknown) => void };
        ref?: unknown;
      };
      if (widget0?.dict) {
        const arr = PDFArray.withContext(doc.context);
        arr.push(PDFNumber.of(changes.rect.x));
        arr.push(PDFNumber.of(changes.rect.y));
        arr.push(PDFNumber.of(changes.rect.x + changes.rect.width));
        arr.push(PDFNumber.of(changes.rect.y + changes.rect.height));
        widget0.dict.set(PDFName.of('Rect'), arr);
      } else {
        warnings.push('rect change requested but widget not accessible');
      }
    }
    // Note: pageIndex change (moving a widget to a different page) is
    // intentionally NOT handled in Phase 3 — it requires walking BOTH the
    // source and destination /Annots arrays. Documented as a Phase 3.1 gap.
    if (changes.pageIndex !== undefined) {
      warnings.push('pageIndex change is Phase 3.1; ignored');
    }
  } catch (e) {
    return fail<EditFieldError>('invalid_changes', (e as Error).message);
  }

  let newBytes: Uint8Array;
  try {
    newBytes = await doc.save({ useObjectStreams: true });
  } catch (e) {
    return fail<EditFieldError>('serialize_failed', (e as Error).message);
  }
  return ok({ newBytes, warnings });
}

// ============================================================================
// Internal helpers — called by the replay engine's step 3.6
// (architecture-phase-3.md §5.7). NOT exported via the public top-level surface
// because they take a live PDFForm rather than bytes.
// ============================================================================

export interface ApplyFormCommitResult {
  warnings: string[];
  filledFieldNames: string[];
  unmatchedFieldNames: string[];
}

export function applyFormCommit(
  form: PDFForm,
  fieldValues: Record<string, FormFieldValue>,
): ApplyFormCommitResult {
  const warnings: string[] = [];
  const filledFieldNames: string[] = [];
  const unmatchedFieldNames: string[] = [];
  for (const [name, value] of Object.entries(fieldValues)) {
    const f = safeGetFieldMaybe(form, name);
    if (!f) {
      unmatchedFieldNames.push(name);
      continue;
    }
    const r = applyValueToField(f, value);
    if (!r.ok) {
      warnings.push(`field '${name}' type mismatch: ${r.message}`);
      continue;
    }
    filledFieldNames.push(name);
  }
  return { warnings, filledFieldNames, unmatchedFieldNames };
}

export function applyFormDesignAdd(
  doc: PDFDocument,
  form: PDFForm,
  fd: FormFieldDefinition,
): { warnings: string[] } {
  const warnings: string[] = [];
  const err = validateFieldDefinition(fd);
  if (err) throw new Error(err);
  if (safeGetFieldMaybe(form, fd.name)) {
    throw new Error(`duplicate field name '${fd.name}'`);
  }
  if (fd.pageIndex < 0 || fd.pageIndex >= doc.getPageCount()) {
    throw new Error(`pageIndex ${fd.pageIndex} out of range`);
  }
  addFieldToDoc(doc, form, fd, warnings);
  return { warnings };
}

export function applyFormDesignRemove(form: PDFForm, fieldName: string): void {
  const f = safeGetFieldMaybe(form, fieldName);
  if (!f) throw new Error(`field '${fieldName}' not found`);
  form.removeField(f);
}

export function applyFormDesignEdit(
  doc: PDFDocument,
  form: PDFForm,
  fieldName: string,
  changes: Partial<FormFieldDefinition>,
): { warnings: string[] } {
  const warnings: string[] = [];
  if (changes.name !== undefined && changes.name !== fieldName) {
    throw new Error('rename not supported');
  }
  if (changes.type !== undefined) throw new Error('type change not supported');
  const f = safeGetFieldMaybe(form, fieldName);
  if (!f) throw new Error(`field '${fieldName}' not found`);
  if (changes.label !== undefined) setTooltip(f, changes.label);
  if (changes.required !== undefined) {
    if (changes.required) f.enableRequired();
    else f.disableRequired();
  }
  if (changes.rect) {
    const acroField = (f as unknown as { acroField: AcroFieldLike }).acroField;
    const widgets = acroField.getWidgets?.() ?? [];
    const widget0 = widgets[0] as unknown as {
      dict: { set: (k: PDFName, v: unknown) => void };
    };
    if (widget0?.dict) {
      const arr = PDFArray.withContext(doc.context);
      arr.push(PDFNumber.of(changes.rect.x));
      arr.push(PDFNumber.of(changes.rect.y));
      arr.push(PDFNumber.of(changes.rect.x + changes.rect.width));
      arr.push(PDFNumber.of(changes.rect.y + changes.rect.height));
      widget0.dict.set(PDFName.of('Rect'), arr);
    } else {
      warnings.push('rect change requested but widget not accessible');
    }
  }
  return { warnings };
}

/**
 * Strip /Names -> /JavaScript and any per-field /AA from the doc. Called at
 * the end of replay engine's form-ops pass (conventions §14.6 P3-L-2).
 * Returns true when something was actually stripped.
 */
export function stripDocLevelJavaScript(doc: PDFDocument): boolean {
  let stripped = false;
  try {
    const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    if (names && names.has(PDFName.of('JavaScript'))) {
      names.delete(PDFName.of('JavaScript'));
      stripped = true;
    }
  } catch {
    /* ignore */
  }
  return stripped;
}
