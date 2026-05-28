// Phase 3 form-engine tests (Wave 12, David).
//
// Per docs/form-engine.md §9: golden-bytes round-trip for fill, plus
// per-field-type create + reload + assert.
//
// All fixtures synthesized in-test via pdf-lib's PDFDocument.create() +
// form.createXxx(); no on-disk PDF fixtures required.

import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFString,
  PDFTextField,
  rgb,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { FormFieldDefinition } from '../../ipc/contracts.js';

import {
  createField,
  detectForms,
  editField,
  fillForm,
  flattenForms,
  removeField,
} from './form-engine.js';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

async function makeBlankPdf(pageCount = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(`page ${i + 1}`, { x: 50, y: 700, size: 12, color: rgb(0, 0, 0) });
  }
  doc.setCreationDate(new Date(2026, 0, 1));
  doc.setModificationDate(new Date(2026, 0, 1));
  return doc.save();
}

async function makeSimpleFormPdf(): Promise<Uint8Array> {
  // Three text fields, one checkbox, one dropdown — covers the fill matrix.
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const tf1 = form.createTextField('FirstName');
  tf1.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  const tf2 = form.createTextField('LastName');
  tf2.addToPage(page, { x: 50, y: 670, width: 200, height: 20 });
  const tf3 = form.createTextField('Age');
  tf3.addToPage(page, { x: 50, y: 640, width: 100, height: 20 });
  const cb = form.createCheckBox('Confirm');
  cb.addToPage(page, { x: 50, y: 600, width: 20, height: 20 });
  const dd = form.createDropdown('Country');
  dd.addOptions(['US', 'UK', 'DE']);
  dd.addToPage(page, { x: 50, y: 560, width: 100, height: 20 });
  doc.setCreationDate(new Date(2026, 0, 1));
  doc.setModificationDate(new Date(2026, 0, 1));
  return doc.save();
}

// ----------------------------------------------------------------------------
// Detection
// ----------------------------------------------------------------------------

describe('form-engine: detectForms', () => {
  it('returns hasAcroForm=false for a blank PDF', async () => {
    const bytes = await makeBlankPdf();
    const r = await detectForms(bytes);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.hasAcroForm).toBe(false);
      expect(r.value.fields).toHaveLength(0);
      expect(r.value.hasXfaForm).toBe(false);
      expect(r.value.hasJavaScriptActions).toBe(false);
    }
  });

  it('returns five field definitions for the simple form fixture', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await detectForms(bytes);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.hasAcroForm).toBe(true);
      const names = r.value.fields.map((f) => f.name).sort();
      expect(names).toEqual(['Age', 'Confirm', 'Country', 'FirstName', 'LastName']);
      const country = r.value.fields.find((f) => f.name === 'Country');
      expect(country?.type).toBe('dropdown');
      expect(country?.options?.map((o) => o.value).sort()).toEqual(['DE', 'UK', 'US']);
      const confirm = r.value.fields.find((f) => f.name === 'Confirm');
      expect(confirm?.type).toBe('checkbox');
    }
  });

  it('fails load on garbage bytes', async () => {
    const r = await detectForms(new Uint8Array([1, 2, 3, 4]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('load_failed');
  });
});

// ----------------------------------------------------------------------------
// Fill
// ----------------------------------------------------------------------------

describe('form-engine: fillForm', () => {
  it('fills text + checkbox + dropdown values and round-trips', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await fillForm(bytes, {
      FirstName: { type: 'text', value: 'Ada' },
      LastName: { type: 'text', value: 'Lovelace' },
      Age: { type: 'text', value: '36' },
      Confirm: { type: 'checkbox', value: true },
      Country: { type: 'dropdown', value: 'UK' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.filledFieldNames.sort()).toEqual([
        'Age',
        'Confirm',
        'Country',
        'FirstName',
        'LastName',
      ]);
      // Re-open and verify
      const doc = await PDFDocument.load(r.value.newBytes);
      const form = doc.getForm();
      const firstName = form.getField('FirstName');
      expect(firstName).toBeInstanceOf(PDFTextField);
      expect((firstName as PDFTextField).getText()).toBe('Ada');
      const confirm = form.getField('Confirm');
      expect(confirm).toBeInstanceOf(PDFCheckBox);
      expect((confirm as PDFCheckBox).isChecked()).toBe(true);
      const country = form.getField('Country');
      expect(country).toBeInstanceOf(PDFDropdown);
      expect((country as PDFDropdown).getSelected()).toContain('UK');
    }
  });

  it('returns unmatchedFieldNames for fields not in the doc', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await fillForm(bytes, {
      FirstName: { type: 'text', value: 'A' },
      DoesNotExist: { type: 'text', value: 'x' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.filledFieldNames).toContain('FirstName');
      expect(r.value.unmatchedFieldNames).toContain('DoesNotExist');
    }
  });

  it('fails with field_type_mismatch when value type clashes with field type', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await fillForm(bytes, {
      FirstName: { type: 'checkbox', value: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('field_type_mismatch');
  });

  it('fails form_not_present on a docu with no AcroForm', async () => {
    const bytes = await makeBlankPdf();
    const r = await fillForm(bytes, { Foo: { type: 'text', value: 'x' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('form_not_present');
  });

  it('fill is deterministic: same input -> same output bytes', async () => {
    const bytes = await makeSimpleFormPdf();
    const r1 = await fillForm(bytes, { FirstName: { type: 'text', value: 'X' } });
    const r2 = await fillForm(bytes, { FirstName: { type: 'text', value: 'X' } });
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(Buffer.compare(Buffer.from(r1.value.newBytes), Buffer.from(r2.value.newBytes))).toBe(
        0,
      );
    }
  });
});

// ----------------------------------------------------------------------------
// Flatten
// ----------------------------------------------------------------------------

describe('form-engine: flattenForms', () => {
  it('removes the AcroForm after flatten', async () => {
    const filled = await fillForm(await makeSimpleFormPdf(), {
      FirstName: { type: 'text', value: 'Ada' },
    });
    if (!filled.ok) throw new Error(`fill failed: ${filled.message}`);
    const r = await flattenForms(filled.value.newBytes);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.flattenedFieldCount).toBeGreaterThan(0);
      const doc = await PDFDocument.load(r.value.newBytes);
      // After flatten, the form is empty / vanished.
      const form = doc.getForm();
      expect(form.getFields().length).toBe(0);
    }
  });

  it('fails form_not_present on a doc without AcroForm', async () => {
    const r = await flattenForms(await makeBlankPdf());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('form_not_present');
  });
});

// ----------------------------------------------------------------------------
// createField — each pdf-lib-supported type + signature
// ----------------------------------------------------------------------------

describe('form-engine: createField', () => {
  const baseRect = { x: 100, y: 600, width: 200, height: 30 };

  it.each([
    ['text', {}],
    ['checkbox', {}],
    [
      'dropdown',
      {
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
    ],
    [
      'radio',
      {
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
    ],
    ['date', {}],
    ['signature', {}],
  ] as const)('creates and round-trips a %s field', async (type, extra) => {
    const bytes = await makeBlankPdf();
    const fd: FormFieldDefinition = {
      name: `Test_${type}`,
      type,
      pageIndex: 0,
      rect: baseRect,
      label: `My ${type}`,
      required: false,
      origin: 'authored',
      unsaved: true,
      ...extra,
    } as FormFieldDefinition;
    const r = await createField(bytes, fd);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const det = await detectForms(r.value.newBytes);
      expect(det.ok).toBe(true);
      if (det.ok) {
        const found = det.value.fields.find((f) => f.name === `Test_${type}`);
        expect(found, `field 'Test_${type}' should exist after create+reload`).toBeTruthy();
      }
    }
  });

  it('rejects duplicate field names', async () => {
    let bytes = await makeBlankPdf();
    const fd: FormFieldDefinition = {
      name: 'Dup',
      type: 'text',
      pageIndex: 0,
      rect: baseRect,
      label: 'Dup',
      required: false,
      origin: 'authored',
      unsaved: true,
    };
    const r1 = await createField(bytes, fd);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    bytes = r1.value.newBytes;
    const r2 = await createField(bytes, fd);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('duplicate_field_name');
  });

  it('rejects invalid field definition (radio without options)', async () => {
    const bytes = await makeBlankPdf();
    const fd: FormFieldDefinition = {
      name: 'BadRadio',
      type: 'radio',
      pageIndex: 0,
      rect: baseRect,
      label: '',
      required: false,
      origin: 'authored',
      unsaved: true,
      // intentionally no options
    };
    const r = await createField(bytes, fd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_field_definition');
  });

  it('rejects out-of-range pageIndex', async () => {
    const bytes = await makeBlankPdf(1);
    const fd: FormFieldDefinition = {
      name: 'PageOob',
      type: 'text',
      pageIndex: 99,
      rect: baseRect,
      label: 'X',
      required: false,
      origin: 'authored',
      unsaved: true,
    };
    const r = await createField(bytes, fd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('page_out_of_range');
  });
});

// ----------------------------------------------------------------------------
// removeField
// ----------------------------------------------------------------------------

describe('form-engine: removeField', () => {
  it('removes the field and the widget annotation', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await removeField(bytes, 'Confirm');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const det = await detectForms(r.value.newBytes);
      if (det.ok) {
        expect(det.value.fields.find((f) => f.name === 'Confirm')).toBeUndefined();
      }
    }
  });

  it('returns field_not_found for unknown name', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await removeField(bytes, 'Nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('field_not_found');
  });
});

// ----------------------------------------------------------------------------
// editField
// ----------------------------------------------------------------------------

describe('form-engine: editField', () => {
  it('rejects rename', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await editField(bytes, 'FirstName', { name: 'Renamed' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_changes');
  });

  it('rejects type change', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await editField(bytes, 'FirstName', { type: 'checkbox' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_changes');
  });

  it('toggles required flag', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await editField(bytes, 'FirstName', { required: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const det = await detectForms(r.value.newBytes);
      if (det.ok) {
        const f = det.value.fields.find((x) => x.name === 'FirstName');
        expect(f?.required).toBe(true);
      }
    }
  });

  it('returns field_not_found for unknown field', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await editField(bytes, 'NoSuchField', { required: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('field_not_found');
  });
});

// ----------------------------------------------------------------------------
// Phase 3.1 (H-3.1, David, Wave 13.5) — JS-action strip on every save path
//
// P3-L-2 (conventions §14.6) requires document-level JavaScript actions to be
// stripped on EVERY save. Previously the strip was only called inside the
// replay engine's form-ops branch (replay-engine.ts:343), so:
//   - fillForm() outputs leaked JS actions
//   - flattenForms() outputs leaked JS actions
//   - mail-merge per-row outputs leaked JS actions (via fillForm)
// These tests guard against regression.
// ----------------------------------------------------------------------------

async function makeJsLadenForm(): Promise<Uint8Array> {
  // A real PDF with an AcroForm + a doc-level /Names /JavaScript action.
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  doc.getForm().createTextField('Name').addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  const namesDict = PDFDict.withContext(doc.context);
  const jsNameTree = PDFDict.withContext(doc.context);
  const jsActionDict = PDFDict.withContext(doc.context);
  jsActionDict.set(PDFName.of('S'), PDFName.of('JavaScript'));
  jsActionDict.set(PDFName.of('JS'), PDFString.of('app.alert("malicious");'));
  const namesArr = PDFArray.withContext(doc.context);
  namesArr.push(PDFString.of('script-1'));
  namesArr.push(jsActionDict);
  jsNameTree.set(PDFName.of('Names'), namesArr);
  namesDict.set(PDFName.of('JavaScript'), jsNameTree);
  doc.catalog.set(PDFName.of('Names'), namesDict);
  doc.setCreationDate(new Date(2026, 0, 1));
  doc.setModificationDate(new Date(2026, 0, 1));
  return doc.save();
}

describe('form-engine: H-3.1 stripDocLevelJavaScript on save', () => {
  it('the JS-laden template fixture does carry /Names /JavaScript (sanity check)', async () => {
    const bytes = await makeJsLadenForm();
    const doc = await PDFDocument.load(bytes);
    const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    expect(names?.has(PDFName.of('JavaScript'))).toBe(true);
  });

  it('fillForm output has /Names /JavaScript stripped', async () => {
    const bytes = await makeJsLadenForm();
    const r = await fillForm(bytes, { Name: { type: 'text', value: 'Ada' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const outDoc = await PDFDocument.load(r.value.newBytes);
      const names = outDoc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
      // Either /Names dict is empty of JS OR no /Names dict at all.
      const hasJs = names?.has(PDFName.of('JavaScript')) === true;
      expect(hasJs).toBe(false);
      // Warning surfaces honestly to the caller.
      expect(r.value.warnings.some((w) => w.toLowerCase().includes('javascript'))).toBe(true);
    }
  });

  it('flattenForms output has /Names /JavaScript stripped', async () => {
    const bytes = await makeJsLadenForm();
    // First fill so flatten has something to bake, then flatten the result.
    const filled = await fillForm(bytes, { Name: { type: 'text', value: 'Grace' } });
    if (!filled.ok) throw new Error(`fill failed: ${filled.message}`);
    // fillForm itself strips JS — verify flatten also does its own pass so a
    // direct standalone flatten (not via fill) still meets the invariant.
    const jsLadenAgain = await makeJsLadenForm();
    const r = await flattenForms(jsLadenAgain);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const outDoc = await PDFDocument.load(r.value.newBytes);
      const names = outDoc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
      const hasJs = names?.has(PDFName.of('JavaScript')) === true;
      expect(hasJs).toBe(false);
    }
  });

  it('fillForm on a JS-free document is a clean no-op (no spurious warning)', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await fillForm(bytes, { FirstName: { type: 'text', value: 'Ada' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // No JS to strip, so the warning array must NOT mention JavaScript.
      expect(r.value.warnings.some((w) => w.toLowerCase().includes('javascript'))).toBe(false);
    }
  });
});

// ----------------------------------------------------------------------------
// Phase 3.1 (H-3.2, David, Wave 13.5) — fillForm({ flatten: true }) option
// ----------------------------------------------------------------------------

describe('form-engine: H-3.2 fillForm flatten option', () => {
  it('fillForm({ flatten: true }) bakes the form into the page content', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await fillForm(
      bytes,
      { FirstName: { type: 'text', value: 'Ada' } },
      { flatten: true },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = await PDFDocument.load(r.value.newBytes);
      expect(out.getForm().getFields().length).toBe(0);
    }
  });

  it('fillForm({ flatten: false }) leaves the form intact (default)', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await fillForm(bytes, { FirstName: { type: 'text', value: 'Ada' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = await PDFDocument.load(r.value.newBytes);
      expect(out.getForm().getFields().length).toBeGreaterThan(0);
    }
  });
});
