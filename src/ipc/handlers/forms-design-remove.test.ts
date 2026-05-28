// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { handleFormsDesignRemove } from './forms-design-remove.js';

async function makeFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p = doc.addPage([612, 792]);
  const form = doc.getForm();
  form.createTextField('Existing').addToPage(p, { x: 0, y: 0, width: 50, height: 20 });
  return doc.save();
}

describe('handleFormsDesignRemove', () => {
  it('returns form-design-remove op carrying the full FormFieldDefinition snapshot', async () => {
    const bytes = await makeFormPdf();
    const r = await handleFormsDesignRemove(
      { handle: 1, fieldName: 'Existing' },
      { getBytes: () => bytes },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.op.kind).toBe('form-design-remove');
      if (r.value.op.kind === 'form-design-remove') {
        expect(r.value.op.fieldName).toBe('Existing');
        expect(r.value.op.before.name).toBe('Existing');
      }
    }
  });

  it('returns field_not_found for unknown field', async () => {
    const bytes = await makeFormPdf();
    const r = await handleFormsDesignRemove(
      { handle: 1, fieldName: 'Nope' },
      { getBytes: () => bytes },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('field_not_found');
  });
});
