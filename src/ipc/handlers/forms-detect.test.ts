// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { handleFormsDetect } from './forms-detect.js';

async function makeSimpleFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  form.createTextField('A').addToPage(page, { x: 0, y: 0, width: 100, height: 20 });
  return doc.save();
}

describe('handleFormsDetect', () => {
  it('returns fields for a known handle', async () => {
    const bytes = await makeSimpleFormPdf();
    const r = await handleFormsDetect({ handle: 1 }, { getBytes: (h) => (h === 1 ? bytes : null) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.hasAcroForm).toBe(true);
      expect(r.value.fields.find((f) => f.name === 'A')).toBeTruthy();
    }
  });

  it('returns handle_not_found for unknown handle', async () => {
    const r = await handleFormsDetect({ handle: 999 }, { getBytes: () => null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('handle_not_found');
  });

  it('returns detect_failed for non-integer handle', async () => {
    const r = await handleFormsDetect(
      { handle: NaN as unknown as number },
      { getBytes: () => null },
    );
    expect(r.ok).toBe(false);
  });
});
