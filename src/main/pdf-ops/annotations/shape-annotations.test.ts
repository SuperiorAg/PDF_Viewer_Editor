// @vitest-environment node
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { ShapeAnnotationModel } from '../../../ipc/contracts.js';

import { emitShapeAnnotation } from './shape-annotations.js';

function baseModel(
  subtype: ShapeAnnotationModel['subtype'],
  overrides: Partial<ShapeAnnotationModel> = {},
): ShapeAnnotationModel {
  return {
    id: 'test-' + subtype,
    pageIndex: 0,
    subtype,
    rect: { x: 100, y: 100, width: 200, height: 100 },
    color: { r: 0.9, g: 0.1, b: 0.1 },
    opacity: 0.7,
    borderWidth: 1.5,
    borderStyle: 'solid',
    createdAt: 1_700_000_000_000,
    modifiedAt: 1_700_000_000_000,
    dirty: true,
    ...overrides,
  };
}

async function newDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc;
}

describe('emitShapeAnnotation — Square', () => {
  it('writes /Subtype /Square with rect + color + border', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(doc, baseModel('Square'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Verify by reloading the saved doc.
    const reloaded = await PDFDocument.load(await doc.save());
    const page = reloaded.getPage(0);
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    expect(annots).toBeDefined();
    let found = false;
    for (let i = 0; i < annots!.size(); i += 1) {
      const a = annots!.lookupMaybe(i, PDFDict);
      if (!a) continue;
      const sub = a.lookupMaybe(PDFName.of('Subtype'), PDFName);
      // PDFName.asString() preserves the leading '/' — match against the
      // canonical form (e.g. '/Square').
      if (sub?.asString() === '/Square') {
        found = true;
        const c = a.lookupMaybe(PDFName.of('C'), PDFArray);
        expect(c).toBeDefined();
      }
    }
    expect(found).toBe(true);
  });

  it('Square with fillEnabled writes /IC interior color', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(
      doc,
      baseModel('Square', { fillEnabled: true, fillColor: { r: 0, g: 0.5, b: 1 } }),
    );
    expect(r.ok).toBe(true);
    const reloaded = await PDFDocument.load(await doc.save());
    const page = reloaded.getPage(0);
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    expect(annots).toBeDefined();
    let hasIc = false;
    for (let i = 0; i < annots!.size(); i += 1) {
      const a = annots!.lookupMaybe(i, PDFDict);
      if (a?.lookupMaybe(PDFName.of('IC'), PDFArray)) hasIc = true;
    }
    expect(hasIc).toBe(true);
  });

  it('rejects invalid pageIndex', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(doc, baseModel('Square', { pageIndex: 9 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('page_out_of_range');
  });
});

describe('emitShapeAnnotation — Circle', () => {
  it('writes /Subtype /Circle', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(doc, baseModel('Circle'));
    expect(r.ok).toBe(true);
  });
});

describe('emitShapeAnnotation — Polygon', () => {
  it('writes vertices array', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(
      doc,
      baseModel('Polygon', { vertices: [100, 100, 200, 100, 150, 200] }),
    );
    expect(r.ok).toBe(true);
    const reloaded = await PDFDocument.load(await doc.save());
    const page = reloaded.getPage(0);
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    let verticesFound = false;
    for (let i = 0; i < annots!.size(); i += 1) {
      const a = annots!.lookupMaybe(i, PDFDict);
      const v = a?.lookupMaybe(PDFName.of('Vertices'), PDFArray);
      if (v && v.size() === 6) verticesFound = true;
    }
    expect(verticesFound).toBe(true);
  });

  it('rejects Polygon with fewer than 3 points', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(doc, baseModel('Polygon', { vertices: [10, 10, 20, 20] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_model');
  });
});

describe('emitShapeAnnotation — PolyLine + measure', () => {
  it('writes Measure dict when polyline carries calibration', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(
      doc,
      baseModel('PolyLine', {
        vertices: [50, 50, 150, 150],
        measure: { unit: 'inch', scale: 1 },
      }),
    );
    expect(r.ok).toBe(true);
    const reloaded = await PDFDocument.load(await doc.save());
    const page = reloaded.getPage(0);
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    let measureFound = false;
    for (let i = 0; i < annots!.size(); i += 1) {
      const a = annots!.lookupMaybe(i, PDFDict);
      if (a?.lookupMaybe(PDFName.of('Measure'), PDFDict)) measureFound = true;
    }
    expect(measureFound).toBe(true);
  });
});

describe('emitShapeAnnotation — Line (incl. arrow)', () => {
  it('writes /L + /LE for arrow', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(
      doc,
      baseModel('Line', {
        lineStart: { x: 50, y: 50 },
        lineEnd: { x: 250, y: 50 },
        lineStartStyle: 'None',
        lineEndStyle: 'OpenArrow',
      }),
    );
    expect(r.ok).toBe(true);
    const reloaded = await PDFDocument.load(await doc.save());
    const page = reloaded.getPage(0);
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    let hasLeArr = false;
    for (let i = 0; i < annots!.size(); i += 1) {
      const a = annots!.lookupMaybe(i, PDFDict);
      const le = a?.lookupMaybe(PDFName.of('LE'), PDFArray);
      if (le && le.size() === 2) hasLeArr = true;
    }
    expect(hasLeArr).toBe(true);
  });

  it('rejects Line missing lineStart/lineEnd', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(doc, baseModel('Line'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_model');
  });
});

describe('emitShapeAnnotation — FreeTextCallout', () => {
  it('writes /IT FreeTextCallout + /CL pointer array', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(
      doc,
      baseModel('FreeTextCallout', {
        calloutText: 'See here',
        calloutPointer: { x: 350, y: 250 },
        fontSize: 12,
      }),
    );
    expect(r.ok).toBe(true);
    const reloaded = await PDFDocument.load(await doc.save());
    const page = reloaded.getPage(0);
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    let calloutFound = false;
    for (let i = 0; i < annots!.size(); i += 1) {
      const a = annots!.lookupMaybe(i, PDFDict);
      const it = a?.lookupMaybe(PDFName.of('IT'), PDFName);
      const cl = a?.lookupMaybe(PDFName.of('CL'), PDFArray);
      if (it?.asString() === '/FreeTextCallout' && cl) calloutFound = true;
    }
    expect(calloutFound).toBe(true);
  });

  it('rejects callout missing pointer', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(doc, baseModel('FreeTextCallout', { calloutText: 'X' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_model');
  });
});

describe('emitShapeAnnotation — validation', () => {
  it('rejects borderWidth out of range', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(doc, baseModel('Square', { borderWidth: 20 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_model');
  });

  it('rejects opacity out of range', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(doc, baseModel('Square', { opacity: 2 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_model');
  });

  it('rejects zero-area rect', async () => {
    const doc = await newDoc();
    const r = emitShapeAnnotation(
      doc,
      baseModel('Square', { rect: { x: 0, y: 0, width: 0, height: 100 } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_model');
  });
});
