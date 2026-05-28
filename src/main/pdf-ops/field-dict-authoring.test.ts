// Tests for the manual PDFDict signature-placeholder authoring path.
// Covers the one gap pdf-lib's high-level API leaves (form-engine.md §3.7).

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { createSignaturePlaceholder } from './field-dict-authoring.js';
import { detectForms } from './form-engine.js';

async function makeBlankPdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([612, 792]);
  return doc.save();
}

describe('field-dict-authoring: createSignaturePlaceholder', () => {
  it('writes a /Sig field that round-trips through reload', async () => {
    const bytes = await makeBlankPdf();
    const doc = await PDFDocument.load(bytes);
    const r = createSignaturePlaceholder(doc, {
      name: 'Sig1',
      type: 'signature',
      pageIndex: 0,
      rect: { x: 100, y: 100, width: 200, height: 50 },
      label: 'Sign here',
      required: false,
      origin: 'authored',
      unsaved: true,
    });
    expect(r.ok).toBe(true);
    const newBytes = await doc.save();
    const det = await detectForms(newBytes);
    expect(det.ok).toBe(true);
    if (det.ok) {
      const sig = det.value.fields.find((f) => f.name === 'Sig1');
      expect(sig?.type).toBe('signature');
      expect(sig?.label).toBe('Sign here');
    }
  });

  it('rejects out-of-range pageIndex', async () => {
    const bytes = await makeBlankPdf(2);
    const doc = await PDFDocument.load(bytes);
    const r = createSignaturePlaceholder(doc, {
      name: 'SigOob',
      type: 'signature',
      pageIndex: 99,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      label: '',
      required: false,
      origin: 'authored',
      unsaved: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('page_out_of_range');
  });

  it('rejects duplicate field names', async () => {
    const bytes = await makeBlankPdf();
    const doc = await PDFDocument.load(bytes);
    const r1 = createSignaturePlaceholder(doc, {
      name: 'Dup',
      type: 'signature',
      pageIndex: 0,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      label: '',
      required: false,
      origin: 'authored',
      unsaved: true,
    });
    expect(r1.ok).toBe(true);
    const r2 = createSignaturePlaceholder(doc, {
      name: 'Dup',
      type: 'signature',
      pageIndex: 0,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      label: '',
      required: false,
      origin: 'authored',
      unsaved: true,
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('duplicate_field_name');
  });

  it('sets the required flag when fd.required is true', async () => {
    const bytes = await makeBlankPdf();
    const doc = await PDFDocument.load(bytes);
    const r = createSignaturePlaceholder(doc, {
      name: 'SigReq',
      type: 'signature',
      pageIndex: 0,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      label: '',
      required: true,
      origin: 'authored',
      unsaved: true,
    });
    expect(r.ok).toBe(true);
    const newBytes = await doc.save();
    const det = await detectForms(newBytes);
    if (det.ok) {
      const sig = det.value.fields.find((f) => f.name === 'SigReq');
      expect(sig?.required).toBe(true);
    }
  });
});
