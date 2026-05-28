// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { handleFormsFill } from './forms-fill.js';

async function makeFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  form.createTextField('Name').addToPage(page, { x: 0, y: 0, width: 100, height: 20 });
  form.createCheckBox('Agree').addToPage(page, { x: 0, y: 30, width: 20, height: 20 });
  const dd = form.createDropdown('Region');
  dd.addOptions(['NA', 'EU']);
  dd.addToPage(page, { x: 0, y: 60, width: 100, height: 20 });
  return doc.save();
}

describe('handleFormsFill', () => {
  it('validates a text value against a text field', async () => {
    const bytes = await makeFormPdf();
    const r = await handleFormsFill(
      { handle: 1, fieldName: 'Name', value: { type: 'text', value: 'Ada' } },
      { getBytes: (h) => (h === 1 ? bytes : null) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.fieldName).toBe('Name');
      expect(r.value.normalizedValue).toEqual({ type: 'text', value: 'Ada' });
    }
  });

  it('rejects type mismatch (text value on a checkbox)', async () => {
    const bytes = await makeFormPdf();
    const r = await handleFormsFill(
      { handle: 1, fieldName: 'Agree', value: { type: 'text', value: 'X' } },
      { getBytes: (h) => (h === 1 ? bytes : null) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('field_type_mismatch');
  });

  it('rejects dropdown value not in options', async () => {
    const bytes = await makeFormPdf();
    const r = await handleFormsFill(
      { handle: 1, fieldName: 'Region', value: { type: 'dropdown', value: 'Mars' } },
      { getBytes: (h) => (h === 1 ? bytes : null) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('option_not_in_field');
  });

  it('normalizes US date MM/DD/YYYY to ISO-8601', async () => {
    // Create a date field via the date-marker tooltip path
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    const tf = form.createTextField('When');
    tf.addToPage(page, { x: 0, y: 0, width: 100, height: 20 });
    // Manually set the (date) tooltip so detect classifies it as 'date'
    // — done by mimicking the engine's setTooltip helper.
    // (The handler under test only calls detectForms, which reads /TU.)
    // Use a dummy field-dict pathway via setting acroField.dict TU.
    const acroDict = (
      tf as unknown as { acroField: { dict: { set: (k: unknown, v: unknown) => void } } }
    ).acroField.dict;
    const { PDFName, PDFString } = await import('pdf-lib');
    acroDict.set(PDFName.of('TU'), PDFString.of('When (date)'));
    const bytes = await doc.save();
    const r = await handleFormsFill(
      { handle: 1, fieldName: 'When', value: { type: 'date', value: '01/02/2026' } },
      { getBytes: () => bytes },
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.normalizedValue.type === 'date') {
      expect(r.value.normalizedValue.value).toBe('2026-01-02');
    }
  });

  it('returns field_not_found when field is missing', async () => {
    const bytes = await makeFormPdf();
    const r = await handleFormsFill(
      { handle: 1, fieldName: 'Nope', value: { type: 'text', value: '' } },
      { getBytes: () => bytes },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('field_not_found');
  });
});
