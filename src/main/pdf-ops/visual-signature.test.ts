// @vitest-environment node
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { VisualAppearanceSpec, FormFieldDefinition } from '../../ipc/contracts.js';

import { createSignaturePlaceholder } from './field-dict-authoring.js';
import { applyVisualSignature } from './visual-signature.js';

const ONE_PX_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function appearance(): VisualAppearanceSpec {
  return {
    source: { kind: 'drawn', pngBytes: ONE_PX_PNG, widthPx: 1, heightPx: 1 },
    showName: true,
    showDate: true,
    showReason: false,
    showSubjectCN: false,
    showIssuerCN: false,
    showTsaInfo: false,
  };
}

async function makePlaceholderPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const fd: FormFieldDefinition = {
    name: 'SigField1',
    type: 'signature',
    pageIndex: 0,
    rect: { x: 100, y: 100, width: 200, height: 80 },
    label: 'Signature',
    required: false,
    origin: 'authored',
    unsaved: true,
  };
  const r = createSignaturePlaceholder(doc, fd);
  if (!r.ok) throw new Error(`setup failed: ${r.message}`);
  return doc.save();
}

describe('applyVisualSignature — placeholder mode', () => {
  it('signs the placeholder and writes empty /V <<>> marker', async () => {
    const bytes = await makePlaceholderPdf();
    const r = await applyVisualSignature({
      bytes,
      placement: { mode: 'placeholder', fieldName: 'SigField1' },
      appearance: appearance(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fieldName).toBe('SigField1');

    // Reload and verify /V is present + empty (visual-signed marker).
    const reloaded = await PDFDocument.load(r.value.newBytes);
    const acroForm = reloaded.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    expect(acroForm).toBeDefined();
    const fields = acroForm!.lookupMaybe(PDFName.of('Fields'), PDFArray);
    expect(fields).toBeDefined();
    let found = false;
    for (let i = 0; i < fields!.size(); i += 1) {
      const ref = fields!.get(i);
      if (!(ref instanceof PDFRef)) continue;
      const f = reloaded.context.lookup(ref, PDFDict);
      if (!(f instanceof PDFDict)) continue;
      const t = f.lookupMaybe(PDFName.of('T'), PDFString);
      if (t?.asString() === 'SigField1') {
        const v = f.lookupMaybe(PDFName.of('V'), PDFDict);
        expect(v).toBeDefined();
        // No /Contents entry — that's the PAdES marker.
        expect(v!.get(PDFName.of('Contents'))).toBeUndefined();
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('rejects placeholder_field_not_found', async () => {
    const bytes = await makePlaceholderPdf();
    const r = await applyVisualSignature({
      bytes,
      placement: { mode: 'placeholder', fieldName: 'NoSuchField' },
      appearance: appearance(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('placeholder_field_not_found');
  });

  it('rejects placeholder_field_already_signed', async () => {
    const bytes0 = await makePlaceholderPdf();
    const first = await applyVisualSignature({
      bytes: bytes0,
      placement: { mode: 'placeholder', fieldName: 'SigField1' },
      appearance: appearance(),
    });
    if (!first.ok) throw new Error('test setup');
    const second = await applyVisualSignature({
      bytes: first.value.newBytes,
      placement: { mode: 'placeholder', fieldName: 'SigField1' },
      appearance: appearance(),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('placeholder_field_already_signed');
  });
});

describe('applyVisualSignature — freeform mode', () => {
  it('authors a new /Sig field and signs it', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const r = await applyVisualSignature({
      bytes,
      placement: {
        mode: 'freeform',
        pageIndex: 0,
        rect: { x: 100, y: 200, width: 200, height: 80 },
      },
      appearance: appearance(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fieldName).toMatch(/^Signature_\d+$/);
  });

  it('rejects invalid placement (missing rect)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const r = await applyVisualSignature({
      bytes: await doc.save(),
      placement: { mode: 'freeform', pageIndex: 0 },
      appearance: appearance(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_placement');
  });

  it('rejects pageIndex out of range', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const r = await applyVisualSignature({
      bytes: await doc.save(),
      placement: {
        mode: 'freeform',
        pageIndex: 9,
        rect: { x: 100, y: 100, width: 100, height: 50 },
      },
      appearance: appearance(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_placement');
  });
});
