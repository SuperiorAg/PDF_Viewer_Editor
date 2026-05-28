// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { FormFieldDefinition } from '../contracts.js';

import { handleFormsDesignAdd } from './forms-design-add.js';

async function makeBlank(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

const baseFd: FormFieldDefinition = {
  name: 'A',
  type: 'text',
  pageIndex: 0,
  rect: { x: 100, y: 100, width: 100, height: 20 },
  label: 'A',
  required: false,
  origin: 'authored',
  unsaved: true,
};

describe('handleFormsDesignAdd', () => {
  it('returns a form-design-add op with the normalized field def', async () => {
    const bytes = await makeBlank();
    const r = await handleFormsDesignAdd(
      { handle: 1, fieldDefinition: baseFd },
      { getBytes: () => bytes },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.op.kind).toBe('form-design-add');
      expect(r.value.normalizedFieldDefinition.name).toBe('A');
      expect(r.value.normalizedFieldDefinition.origin).toBe('authored');
    }
  });

  it('clamps an out-of-bounds rect and warns', async () => {
    const bytes = await makeBlank();
    const r = await handleFormsDesignAdd(
      {
        handle: 1,
        fieldDefinition: { ...baseFd, rect: { x: 500, y: 700, width: 500, height: 200 } },
      },
      { getBytes: () => bytes },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.warnings.some((w) => /clamped/i.test(w))).toBe(true);
    }
  });

  it('rejects unsupported field type', async () => {
    const bytes = await makeBlank();
    const r = await handleFormsDesignAdd(
      { handle: 1, fieldDefinition: { ...baseFd, type: 'list-box' as unknown as 'text' } },
      { getBytes: () => bytes },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unsupported_field_type');
  });

  it('rejects radio without options', async () => {
    const bytes = await makeBlank();
    const r = await handleFormsDesignAdd(
      { handle: 1, fieldDefinition: { ...baseFd, type: 'radio' } },
      { getBytes: () => bytes },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_field_definition');
  });

  it('rejects out-of-range pageIndex', async () => {
    const bytes = await makeBlank();
    const r = await handleFormsDesignAdd(
      { handle: 1, fieldDefinition: { ...baseFd, pageIndex: 99 } },
      { getBytes: () => bytes },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('page_out_of_range');
  });

  it('rejects names containing a period', async () => {
    const bytes = await makeBlank();
    const r = await handleFormsDesignAdd(
      { handle: 1, fieldDefinition: { ...baseFd, name: 'parent.child' } },
      { getBytes: () => bytes },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_field_definition');
  });
});
