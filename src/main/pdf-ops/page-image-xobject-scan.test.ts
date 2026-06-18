// @vitest-environment node
//
// Unit tests for the pure-pdf-lib image XObject scanner (Phase 7.5 Wave
// 5d follow-up).

import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { scanPagesForImageXObject } from './page-image-xobject-scan.js';

async function makePlainPdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([612, 792]);
  return doc.save();
}

/** Construct a tiny "image XObject" entry under page 0's
 *  Resources/XObject. The stream contents are bogus (a placeholder); the
 *  scanner only cares about the /Subtype /Image marker. */
async function makePdfWithImageXObjectOnFirstPage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  const page0 = doc.getPage(0);
  const ctx = doc.context;
  // Build /XObject << /Im0 <<image-stream>> >> on page 0.
  const imgDict = ctx.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: 1,
    Height: 1,
    BitsPerComponent: 8,
    ColorSpace: 'DeviceGray',
    Filter: 'FlateDecode',
  });
  const stream = PDFRawStream.of(imgDict, new Uint8Array([0x78, 0x9c, 0x00, 0x00]));
  const streamRef = ctx.register(stream);
  let resources = page0.node.lookupMaybe(PDFName.of('Resources'), PDFDict);
  if (!resources) {
    resources = ctx.obj({}) as PDFDict;
    page0.node.set(PDFName.of('Resources'), resources);
  }
  let xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xobjects) {
    xobjects = ctx.obj({}) as PDFDict;
    resources.set(PDFName.of('XObject'), xobjects);
  }
  xobjects.set(PDFName.of('Im0'), streamRef);
  return doc.save();
}

describe('scanPagesForImageXObject', () => {
  it('reports hasImageXObject=false for every page on a plain PDF', async () => {
    const bytes = await makePlainPdf(3);
    const flags = await scanPagesForImageXObject(bytes);
    expect(flags).toHaveLength(3);
    expect(flags.map((f) => f.pageIndex)).toEqual([0, 1, 2]);
    expect(flags.every((f) => f.hasImageXObject === false)).toBe(true);
  });

  it('reports hasImageXObject=true for the page with an image XObject', async () => {
    const bytes = await makePdfWithImageXObjectOnFirstPage();
    const flags = await scanPagesForImageXObject(bytes);
    expect(flags).toHaveLength(2);
    expect(flags[0]?.hasImageXObject).toBe(true);
    expect(flags[1]?.hasImageXObject).toBe(false);
  });
});
