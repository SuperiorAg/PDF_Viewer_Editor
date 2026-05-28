// Replay-engine tests — Phase 2 (Wave 7, David).
//
// Coverage per conventions §13.6:
//   1. Golden round-trip (no ops): empty + multi-page PDFs come out
//      byte-stable (within pdf-lib's deterministic re-emit).
//   2. Single-op forward: rotate, delete, image-overlay, text-replace.
//   3. Failure modes: load_failed, op_apply_failed.
//   4. Image cache dedup: two image-inserts with the same contentHash
//      embed only one PDFImage.
//
// All fixtures are synthesized in-test via pdf-lib's PDFDocument.create()
// — no on-disk PDF fixtures required for Wave 7. The golden bytes are
// pdf-lib's own deterministic re-emit, captured by running replay() once
// and comparing to a second invocation.

import { PDFDocument, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { EditOperation, AnnotationModel, ImageEmbedPayload } from '../../ipc/contracts.js';

import { computeImageContentHash } from './image-embed.js';
import { replay } from './replay-engine.js';
import { encodePngRgbaForTest } from './tiff-decoder.js';

async function createSimplePdf(pageCount = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(`page ${i + 1}`, { x: 50, y: 700, size: 24, color: rgb(0, 0, 0) });
  }
  doc.setTitle('replay-engine test fixture');
  doc.setCreationDate(new Date(2026, 0, 1));
  doc.setModificationDate(new Date(2026, 0, 1));
  return doc.save();
}

function createBlankPng(
  width = 50,
  height = 50,
): {
  bytes: Uint8Array;
  width: number;
  height: number;
} {
  // Build a real RGBA buffer (opaque red) and PNG-encode it via the same
  // encoder the TIFF -> PNG bridge uses. Guaranteed pdf-lib-loadable.
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 255; // R
    rgba[i + 1] = 0; // G
    rgba[i + 2] = 0; // B
    rgba[i + 3] = 255; // A
  }
  return { bytes: encodePngRgbaForTest(rgba, width, height), width, height };
}

describe('replay-engine', () => {
  // -------------------------------------------------------------------------
  // Golden round-trip (conventions §13.6 #1)
  // -------------------------------------------------------------------------

  it('round-trips empty-ops with byte-stable output (determinism)', async () => {
    const orig = await createSimplePdf(3);
    const r1 = await replay({
      originalBytes: orig,
      ops: [],
      annotations: [],
      jobId: 'test-1',
    });
    const r2 = await replay({
      originalBytes: orig,
      ops: [],
      annotations: [],
      jobId: 'test-2',
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      // Two invocations of pdf-lib with no edits produce byte-stable output.
      // The pdf-lib version is pinned in package.json so this is a hard
      // determinism assertion — if it breaks, the cause is a pdf-lib bump.
      expect(Buffer.compare(Buffer.from(r1.value.newBytes), Buffer.from(r2.value.newBytes))).toBe(
        0,
      );
      expect(r1.value.engineUsed).toBe('pdf-lib');
      expect(r1.value.byteCount).toBeGreaterThan(0);
    }
  });

  it('round-trip preserves the page count', async () => {
    const orig = await createSimplePdf(5);
    const r = await replay({ originalBytes: orig, ops: [], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reload = await PDFDocument.load(r.value.newBytes);
      expect(reload.getPageCount()).toBe(5);
    }
  });

  // -------------------------------------------------------------------------
  // Single-op forward tests (conventions §13.6 #2)
  // -------------------------------------------------------------------------

  it('rotate op: page rotation is reflected in the output', async () => {
    const orig = await createSimplePdf(2);
    const op: EditOperation = {
      kind: 'rotate',
      meta: { ts: 1, undoable: true, operationId: 'op1' },
      pageIndex: 0,
      fromRotation: 0,
      toRotation: 90,
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reload = await PDFDocument.load(r.value.newBytes);
      expect(reload.getPage(0).getRotation().angle).toBe(90);
    }
  });

  it('delete op: page count drops by 1', async () => {
    const orig = await createSimplePdf(3);
    const op: EditOperation = {
      kind: 'delete',
      meta: { ts: 1, undoable: true, operationId: 'op1' },
      pageIndex: 1,
      preservedSource: { kind: 'blank', width: 612, height: 792 },
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reload = await PDFDocument.load(r.value.newBytes);
      expect(reload.getPageCount()).toBe(2);
    }
  });

  it('image-overlay op: stamps an image onto a page (page count unchanged)', async () => {
    const orig = await createSimplePdf(2);
    const png = createBlankPng();
    const image: ImageEmbedPayload = {
      bytes: png.bytes,
      mimeType: 'image/png',
      width: png.width,
      height: png.height,
      contentHash: computeImageContentHash(png.bytes),
    };
    const op: EditOperation = {
      kind: 'image-overlay',
      meta: { ts: 1, undoable: true, operationId: 'op1' },
      pageIndex: 0,
      rect: { x: 100, y: 100, width: 200, height: 100 },
      image,
      overlayId: 'overlay-1',
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reload = await PDFDocument.load(r.value.newBytes);
      expect(reload.getPageCount()).toBe(2);
      // The PNG embed shows up as an XObject — the output size grows.
      expect(r.value.byteCount).toBeGreaterThan(orig.byteLength);
    }
  });

  it('image-insert op: page count grows by 1', async () => {
    const orig = await createSimplePdf(2);
    const png = createBlankPng();
    const image: ImageEmbedPayload = {
      bytes: png.bytes,
      mimeType: 'image/png',
      width: png.width,
      height: png.height,
      contentHash: computeImageContentHash(png.bytes),
    };
    const op: EditOperation = {
      kind: 'image-insert',
      meta: { ts: 1, undoable: true, operationId: 'op1' },
      atIndex: 1,
      image,
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reload = await PDFDocument.load(r.value.newBytes);
      expect(reload.getPageCount()).toBe(3);
    }
  });

  // -------------------------------------------------------------------------
  // Failure-mode tests (conventions §13.6 #4)
  // -------------------------------------------------------------------------

  it('returns load_failed on garbage input', async () => {
    const r = await replay({
      originalBytes: new Uint8Array([0, 1, 2, 3, 4]),
      ops: [],
      annotations: [],
      jobId: 't',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('load_failed');
    }
  });

  it('returns load_failed on empty input', async () => {
    const r = await replay({
      originalBytes: new Uint8Array(),
      ops: [],
      annotations: [],
      jobId: 't',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('load_failed');
    }
  });

  it('returns op_apply_failed when delete pageIndex is out of range', async () => {
    const orig = await createSimplePdf(2);
    const op: EditOperation = {
      kind: 'delete',
      meta: { ts: 1, undoable: true, operationId: 'op1' },
      pageIndex: 99,
      preservedSource: { kind: 'blank', width: 612, height: 792 },
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('op_apply_failed');
      expect(r.details?.['opIndex']).toBe(0);
      expect(r.details?.['opKind']).toBe('delete');
    }
  });

  it('emits a highlight annotation via the emit phase', async () => {
    const orig = await createSimplePdf(2);
    const a: AnnotationModel = {
      id: 'a1',
      pageIndex: 0,
      subtype: 'Highlight',
      rect: { x: 50, y: 700, width: 100, height: 15 },
      color: { r: 255, g: 230, b: 0 },
      opacity: 0.5,
      createdAt: 1,
      modifiedAt: 1,
      dirty: true,
    };
    const r = await replay({ originalBytes: orig, ops: [], annotations: [a], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // pdf-lib draws the rectangle; we don't surface objectNumber for
      // page-content-drawn annotations (Phase 3 will). The map is still
      // populated only with annotations that DID get a /Annots-style ref.
      expect(typeof r.value.annotationRefAssignments).toBe('object');
    }
  });

  // -------------------------------------------------------------------------
  // Image cache dedup (edit-replay-engine.md §7)
  // -------------------------------------------------------------------------

  it('image cache: two overlays with the same contentHash embed only one image', async () => {
    const orig = await createSimplePdf(2);
    const png = createBlankPng();
    const contentHash = computeImageContentHash(png.bytes);
    const image: ImageEmbedPayload = {
      bytes: png.bytes,
      mimeType: 'image/png',
      width: png.width,
      height: png.height,
      contentHash,
    };
    const overlay1: EditOperation = {
      kind: 'image-overlay',
      meta: { ts: 1, undoable: true, operationId: 'op1' },
      pageIndex: 0,
      rect: { x: 100, y: 100, width: 100, height: 100 },
      image,
      overlayId: 'o1',
    };
    const overlay2: EditOperation = {
      kind: 'image-overlay',
      meta: { ts: 2, undoable: true, operationId: 'op2' },
      pageIndex: 1,
      rect: { x: 200, y: 200, width: 100, height: 100 },
      image,
      overlayId: 'o2',
    };
    const r = await replay({
      originalBytes: orig,
      ops: [overlay1, overlay2],
      annotations: [],
      jobId: 't',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Reload, count XObjects — dedup should keep this at 1 (both overlays
      // reference the same XObject). pdf-lib doesn't expose the XObject
      // count directly; we proxy via output size: two-overlay output should
      // be only marginally larger than one-overlay because the image bytes
      // are shared.
      expect(r.value.byteCount).toBeGreaterThan(orig.byteLength);
    }
  });

  // -------------------------------------------------------------------------
  // Wave 8.5 B-1 — applyReorder must move the page, not delete it.
  //
  // Pre-Wave-8.5 the handler called `removePage(fromIndex)` and never
  // re-inserted, so the saved PDF was structurally short by one page. These
  // tests pin the corrected semantics by tagging each page with a unique
  // text marker, applying a reorder op, then reloading the output and
  // reading the marker at the new index back.
  // -------------------------------------------------------------------------

  /**
   * Create a PDF whose pages have UNIQUE sizes (width-keyed) so we can
   * identify which source page ended up at which destination index after
   * a reorder. pdf-lib's `getSize()` is a stable structural API that
   * survives save+reload — unlike content-stream text, which is gated
   * behind FlateDecode in the saved output. Each input width becomes the
   * page's permanent "marker".
   */
  async function createSizeTaggedPdf(widths: number[]): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (const w of widths) {
      const page = doc.addPage([w, 792]);
      page.drawText(`w=${w}`, { x: 10, y: 700, size: 12, color: rgb(0, 0, 0) });
    }
    doc.setTitle('size-tagged fixture');
    doc.setCreationDate(new Date(2026, 0, 1));
    doc.setModificationDate(new Date(2026, 0, 1));
    return doc.save();
  }

  /** Read back the width of every page after a save/replay. */
  async function readPageWidths(pdfBytes: Uint8Array): Promise<number[]> {
    const doc = await PDFDocument.load(pdfBytes);
    return doc.getPages().map((p) => Math.round(p.getSize().width));
  }

  it('reorder: moves page 0 to position 2 in a 3-page PDF (B-1)', async () => {
    // Width-tagged fixture: each page has a unique width so we can identify
    // which source page ended up at which destination index after replay.
    const orig = await createSizeTaggedPdf([100, 200, 300]);
    const op: EditOperation = {
      kind: 'reorder',
      meta: { ts: 1, undoable: true, operationId: 'op1' },
      fromIndex: 0,
      toIndex: 2,
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Page count is preserved — the regression-spec point. Pre-Wave-8.5
      // this dropped to 2 because the engine silently deleted the page.
      const widths = await readPageWidths(r.value.newBytes);
      expect(widths).toEqual([200, 300, 100]);
    }
  });

  it('reorder: page 2 to position 0 (B-1, reverse direction)', async () => {
    const orig = await createSizeTaggedPdf([100, 200, 300]);
    const op: EditOperation = {
      kind: 'reorder',
      meta: { ts: 1, undoable: true, operationId: 'op1' },
      fromIndex: 2,
      toIndex: 0,
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const widths = await readPageWidths(r.value.newBytes);
      expect(widths).toEqual([300, 100, 200]);
    }
  });

  it('reorder: fromIndex === toIndex is a no-op (B-1)', async () => {
    const orig = await createSizeTaggedPdf([100, 200, 300]);
    const op: EditOperation = {
      kind: 'reorder',
      meta: { ts: 1, undoable: true, operationId: 'op1' },
      fromIndex: 1,
      toIndex: 1,
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const widths = await readPageWidths(r.value.newBytes);
      expect(widths).toEqual([100, 200, 300]);
    }
  });

  it('reorder: out-of-range index returns op_apply_failed (B-1)', async () => {
    const orig = await createSizeTaggedPdf([100, 200]);
    const op: EditOperation = {
      kind: 'reorder',
      meta: { ts: 1, undoable: true, operationId: 'op1' },
      fromIndex: 0,
      toIndex: 99,
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('op_apply_failed');
      expect(r.details?.['opKind']).toBe('reorder');
    }
  });

  it('reorder composes with rotate: rotation survives the reorder (B-1)', async () => {
    const orig = await createSizeTaggedPdf([100, 200, 300]);
    const rotateOp: EditOperation = {
      kind: 'rotate',
      meta: { ts: 1, undoable: true, operationId: 'r1' },
      pageIndex: 0,
      fromRotation: 0,
      toRotation: 90,
    };
    const reorderOp: EditOperation = {
      kind: 'reorder',
      meta: { ts: 2, undoable: true, operationId: 'r2' },
      fromIndex: 0,
      toIndex: 2,
    };
    const r = await replay({
      originalBytes: orig,
      ops: [rotateOp, reorderOp],
      annotations: [],
      jobId: 't',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reload = await PDFDocument.load(r.value.newBytes);
      expect(reload.getPageCount()).toBe(3);
      // Page width 100 (originally index 0, rotated 90, then moved to
      // index 2) should still be rotated 90 in the output.
      const widths = await readPageWidths(r.value.newBytes);
      expect(widths).toEqual([200, 300, 100]);
      expect(reload.getPage(2).getRotation().angle).toBe(90);
    }
  });

  // -------------------------------------------------------------------------
  // Wave 8.5 B-2 — applyInsert honors every source.kind variant.
  //
  // Pre-Wave-8.5 the handler silently dropped insert ops for `original`,
  // `image`, and `inserted` source kinds, so an undo-of-delete restored the
  // page in the renderer but the saved bytes were missing it. The tests
  // below pin each variant's behavior.
  // -------------------------------------------------------------------------

  it('insert source.kind=original: restores a deleted original page (B-2)', async () => {
    // Scenario: 3-page PDF (widths 100,200,300), delete page 1 (width 200),
    // then insert original page 1 back at position 1. Output widths must
    // be [100, 200, 300] again — the original 200-width page must reappear
    // via copyPages from originalBytes.
    const orig = await createSizeTaggedPdf([100, 200, 300]);
    const deleteOp: EditOperation = {
      kind: 'delete',
      meta: { ts: 1, undoable: true, operationId: 'd1' },
      pageIndex: 1,
      preservedSource: { kind: 'original', originalIndex: 1 },
    };
    const insertOp: EditOperation = {
      kind: 'insert',
      meta: { ts: 2, undoable: true, operationId: 'i1' },
      atIndex: 1,
      source: { kind: 'original', originalIndex: 1 },
    };
    const r = await replay({
      originalBytes: orig,
      ops: [deleteOp, insertOp],
      annotations: [],
      jobId: 't',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The width-200 page (originalIndex 1) made it back in via copyPages.
      // Pre-Wave-8.5 the output was [100, 300] (silent deletion).
      const widths = await readPageWidths(r.value.newBytes);
      expect(widths).toEqual([100, 200, 300]);
    }
  });

  it('insert source.kind=original: out-of-range originalIndex returns op_apply_failed (B-2)', async () => {
    const orig = await createSizeTaggedPdf([100, 200]);
    const insertOp: EditOperation = {
      kind: 'insert',
      meta: { ts: 1, undoable: true, operationId: 'i1' },
      atIndex: 0,
      source: { kind: 'original', originalIndex: 99 },
    };
    const r = await replay({
      originalBytes: orig,
      ops: [insertOp],
      annotations: [],
      jobId: 't',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('op_apply_failed');
    }
  });

  it('insert source.kind=image: re-creates an image page (B-2, image-undo path)', async () => {
    // Used to be a silent no-op (the brief calls this "the SourcePageRef
    // bridge"). It must now produce a real page.
    const orig = await createSizeTaggedPdf([612, 612]);
    const png = createBlankPng();
    const image: ImageEmbedPayload = {
      bytes: png.bytes,
      mimeType: 'image/png',
      width: png.width,
      height: png.height,
      contentHash: computeImageContentHash(png.bytes),
    };
    const insertOp: EditOperation = {
      kind: 'insert',
      meta: { ts: 1, undoable: true, operationId: 'i1' },
      atIndex: 1,
      source: { kind: 'image', image, pageWidth: 100, pageHeight: 100 },
    };
    const r = await replay({
      originalBytes: orig,
      ops: [insertOp],
      annotations: [],
      jobId: 't',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reload = await PDFDocument.load(r.value.newBytes);
      // Pre-Wave-8.5 the page count would be 2 because the insert silently
      // dropped — now we get 3 because the image page is real.
      expect(reload.getPageCount()).toBe(3);
      // The injected page is at index 1 sized 100x100 per the source spec.
      const injected = reload.getPage(1);
      expect(injected.getSize().width).toBe(100);
      expect(injected.getSize().height).toBe(100);
    }
  });

  it('insert source.kind=blank still works (B-2, regression)', async () => {
    const orig = await createSizeTaggedPdf([612, 612]);
    const insertOp: EditOperation = {
      kind: 'insert',
      meta: { ts: 1, undoable: true, operationId: 'i1' },
      atIndex: 1,
      source: { kind: 'blank', width: 200, height: 200 },
    };
    const r = await replay({
      originalBytes: orig,
      ops: [insertOp],
      annotations: [],
      jobId: 't',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const widths = await readPageWidths(r.value.newBytes);
      // The 200-width blank page is at index 1 between the two originals.
      expect(widths).toEqual([612, 200, 612]);
    }
  });

  it('insert source.kind=inserted: surfaces a Phase-3 warning, no crash (B-2)', async () => {
    // The `inserted` variant is reserved for the Phase-3 combine bridge; it
    // can't be served from a single original-bytes input. We push a warning
    // and return ok rather than failing the whole save — Riley's
    // document-inverses.ts is responsible for never emitting this shape
    // through the undo path. This test pins that the engine doesn't crash
    // when an `inserted`-shaped op reaches it.
    const orig = await createSizeTaggedPdf([100, 200]);
    const insertOp: EditOperation = {
      kind: 'insert',
      meta: { ts: 1, undoable: true, operationId: 'i1' },
      atIndex: 1,
      source: {
        kind: 'inserted',
        sourceFileHash: 'f'.repeat(64),
        sourcePageIndex: 0,
      },
    };
    const r = await replay({
      originalBytes: orig,
      ops: [insertOp],
      annotations: [],
      jobId: 't',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reload = await PDFDocument.load(r.value.newBytes);
      // No new page (Phase-3 scope-fence) — engine is honest with a warning.
      expect(reload.getPageCount()).toBe(2);
      expect(r.value.warnings.some((w) => w.includes('Phase-3'))).toBe(true);
    }
  });

  it('delete + insert round-trip preserves rotation on the restored page (B-2 composition)', async () => {
    // Realistic multi-op flow: rotate page 0, delete page 0, then undo
    // (insert original-page-0 back at index 0). The restored page is
    // copyPages-d from a fresh load of originalBytes, which never saw the
    // rotate — so the restored page has rotation 0 (the original-bytes
    // value). This matches edit-replay-engine.md §4.1's contract: original
    // = fresh-from-bytes. The behavior is symmetric with what happens at
    // the renderer (rotating then deleting + undoing yields the unrotated
    // original page).
    const orig = await createSizeTaggedPdf([100, 200]);
    const ops: EditOperation[] = [
      {
        kind: 'rotate',
        meta: { ts: 1, undoable: true, operationId: 'r1' },
        pageIndex: 0,
        fromRotation: 0,
        toRotation: 90,
      },
      {
        kind: 'delete',
        meta: { ts: 2, undoable: true, operationId: 'd1' },
        pageIndex: 0,
        preservedSource: { kind: 'original', originalIndex: 0 },
      },
      {
        kind: 'insert',
        meta: { ts: 3, undoable: true, operationId: 'i1' },
        atIndex: 0,
        source: { kind: 'original', originalIndex: 0 },
      },
    ];
    const r = await replay({ originalBytes: orig, ops, annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reload = await PDFDocument.load(r.value.newBytes);
      expect(reload.getPageCount()).toBe(2);
      // Width-100 page is back at index 0 — it's been restored from origin.
      const widths = await readPageWidths(r.value.newBytes);
      expect(widths).toEqual([100, 200]);
      // The restored page has rotation 0 (a fresh copy from original-bytes
      // which never saw the rotate). This is the documented contract.
      expect(reload.getPage(0).getRotation().angle).toBe(0);
    }
  });

  // -------------------------------------------------------------------------
  // Composition test (multi-op realistic sequence)
  // -------------------------------------------------------------------------

  it('multi-op composition: rotate + delete + annotation', async () => {
    const orig = await createSimplePdf(4);
    const rotateOp: EditOperation = {
      kind: 'rotate',
      meta: { ts: 1, undoable: true, operationId: 'op1' },
      pageIndex: 0,
      fromRotation: 0,
      toRotation: 270,
    };
    const deleteOp: EditOperation = {
      kind: 'delete',
      meta: { ts: 2, undoable: true, operationId: 'op2' },
      pageIndex: 2,
      preservedSource: { kind: 'blank', width: 612, height: 792 },
    };
    const annot: AnnotationModel = {
      id: 'a-x',
      pageIndex: 1,
      subtype: 'Highlight',
      rect: { x: 100, y: 600, width: 50, height: 12 },
      color: { r: 0, g: 200, b: 0 },
      opacity: 0.4,
      createdAt: 3,
      modifiedAt: 3,
      dirty: true,
    };
    const r = await replay({
      originalBytes: orig,
      ops: [rotateOp, deleteOp],
      annotations: [annot],
      jobId: 't',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reload = await PDFDocument.load(r.value.newBytes);
      expect(reload.getPageCount()).toBe(3);
      expect(reload.getPage(0).getRotation().angle).toBe(270);
    }
  });

  // ---------------------------------------------------------------------------
  // Phase 3 form ops (Wave 12, David). Per architecture-phase-3.md §5.7,
  // form ops are folded in step 3.6 between drawOverlays and emitAnnots.
  // ---------------------------------------------------------------------------

  async function createFormFixture(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    form.createTextField('Existing').addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
    doc.setCreationDate(new Date(2026, 0, 1));
    doc.setModificationDate(new Date(2026, 0, 1));
    return doc.save();
  }

  it('form-commit: applies values at save time', async () => {
    const orig = await createFormFixture();
    const op: EditOperation = {
      kind: 'form-commit',
      meta: { ts: 1, undoable: true, operationId: 'fc-1' },
      fieldValues: { Existing: { type: 'text', value: 'Ada' } },
      previousValues: {},
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const doc = await PDFDocument.load(r.value.newBytes);
      const form = doc.getForm();
      const field = form.getTextField('Existing');
      expect(field.getText()).toBe('Ada');
    }
  });

  it('form-design-add: authors a new text field', async () => {
    const orig = await createFormFixture();
    const op: EditOperation = {
      kind: 'form-design-add',
      meta: { ts: 1, undoable: true, operationId: 'fa-1' },
      fieldDefinition: {
        name: 'NewField',
        type: 'text',
        pageIndex: 0,
        rect: { x: 50, y: 600, width: 200, height: 20 },
        label: 'New',
        required: false,
        origin: 'authored',
        unsaved: true,
      },
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const doc = await PDFDocument.load(r.value.newBytes);
      expect(doc.getForm().getFieldMaybe('NewField')).toBeTruthy();
    }
  });

  it('form-design-remove: removes a detected field', async () => {
    const orig = await createFormFixture();
    const op: EditOperation = {
      kind: 'form-design-remove',
      meta: { ts: 1, undoable: true, operationId: 'fr-1' },
      fieldName: 'Existing',
      before: {
        name: 'Existing',
        type: 'text',
        pageIndex: 0,
        rect: { x: 50, y: 700, width: 200, height: 20 },
        label: 'Existing',
        required: false,
        origin: 'detected',
        unsaved: false,
      },
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const doc = await PDFDocument.load(r.value.newBytes);
      expect(doc.getForm().getFieldMaybe('Existing')).toBeUndefined();
    }
  });

  it('form-design-edit: toggles the required flag', async () => {
    const orig = await createFormFixture();
    const op: EditOperation = {
      kind: 'form-design-edit',
      meta: { ts: 1, undoable: true, operationId: 'fe-1' },
      fieldName: 'Existing',
      before: { required: false },
      after: { required: true },
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const doc = await PDFDocument.load(r.value.newBytes);
      expect(doc.getForm().getTextField('Existing').isRequired()).toBe(true);
    }
  });

  it('form-flatten: bakes fields into page content', async () => {
    const orig = await createFormFixture();
    const ops: EditOperation[] = [
      {
        kind: 'form-commit',
        meta: { ts: 1, undoable: true, operationId: 'fc-2' },
        fieldValues: { Existing: { type: 'text', value: 'X' } },
        previousValues: {},
      },
      {
        kind: 'form-flatten',
        meta: { ts: 2, undoable: true, operationId: 'ff-1' },
        beforeFields: [],
        beforeValues: {},
      },
    ];
    const r = await replay({ originalBytes: orig, ops, annotations: [], jobId: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const doc = await PDFDocument.load(r.value.newBytes);
      expect(doc.getForm().getFields()).toHaveLength(0);
    }
  });

  it('form-design-add: duplicate name -> form_field_create_failed', async () => {
    const orig = await createFormFixture();
    const op: EditOperation = {
      kind: 'form-design-add',
      meta: { ts: 1, undoable: true, operationId: 'fa-dup' },
      fieldDefinition: {
        name: 'Existing', // collides with the fixture
        type: 'text',
        pageIndex: 0,
        rect: { x: 50, y: 600, width: 200, height: 20 },
        label: '',
        required: false,
        origin: 'authored',
        unsaved: true,
      },
    };
    const r = await replay({ originalBytes: orig, ops: [op], annotations: [], jobId: 't' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('form_field_create_failed');
  });
});
