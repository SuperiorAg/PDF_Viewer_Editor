// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { handleFormsFlatten } from './forms-flatten.js';

async function makeForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p = doc.addPage([612, 792]);
  const form = doc.getForm();
  form.createTextField('A').addToPage(p, { x: 0, y: 0, width: 50, height: 20 });
  return doc.save();
}

async function makeBlank(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

describe('handleFormsFlatten', () => {
  it('returns a form-flatten EditOperation for a doc with fields', async () => {
    const bytes = await makeForm();
    const r = await handleFormsFlatten({ handle: 1 }, { getBytes: () => bytes });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.op.kind).toBe('form-flatten');
      expect(r.value.flattenedFieldCount).toBe(1);
    }
  });

  it('returns form_not_present on a blank doc', async () => {
    const bytes = await makeBlank();
    const r = await handleFormsFlatten({ handle: 1 }, { getBytes: () => bytes });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('form_not_present');
  });

  it('returns handle_not_found for unknown handle', async () => {
    const r = await handleFormsFlatten({ handle: 1 }, { getBytes: () => null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('handle_not_found');
  });
});
