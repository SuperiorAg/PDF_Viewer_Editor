// Inverse-map tests for document-inverses.ts.
// Focus: B-2 — delete-of-page inverse must round-trip cleanly for every
// SourcePageRef variant (original / blank / inserted / image). See
// code-review.md Phase 2 B-2 + data-models.md §3.2 + §7.1.3.

import { describe, expect, it } from 'vitest';

import {
  type AnnotationModel,
  type EditMeta,
  type EditOperation,
  type ImageEmbedPayload,
  type PDFDocumentModel,
  type SourcePageRef,
} from '../../types/ipc-contract';

import { inverseOf } from './document-inverses';
import { applyOperationToDocument } from './document-slice-apply';

// ----------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------

const meta = (id: string): EditMeta => ({
  ts: 0,
  undoable: true as const,
  operationId: id,
});

function makeImagePayload(hash = 'imgsha-001'): ImageEmbedPayload {
  return {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mimeType: 'image/png',
    width: 800,
    height: 600,
    contentHash: hash,
  };
}

function makeAnnot(id: string, pageIndex: number): AnnotationModel {
  return {
    id,
    pageIndex,
    subtype: 'Highlight',
    rect: { x: 0, y: 0, width: 100, height: 20 },
    color: { r: 1, g: 1, b: 0 },
    opacity: 0.5,
    createdAt: 0,
    modifiedAt: 0,
    dirty: true,
  };
}

function makeBlankDoc(): PDFDocumentModel {
  return {
    handle: 1,
    displayName: 't.pdf',
    fileHash: 'h',
    pageCount: 0,
    pages: [],
    annotations: [],
    dirtyOps: [],
    savedAtHandleVersion: 0,
    pdflibLoadWarnings: [],
  };
}

function makeDocWithPages(refs: SourcePageRef[]): PDFDocumentModel {
  const doc = makeBlankDoc();
  doc.pages = refs.map((sourcePageRef, i) => ({
    pageIndex: i,
    sourcePageRef,
    rotation: 0 as const,
    width: 612,
    height: 792,
  }));
  doc.pageCount = doc.pages.length;
  return doc;
}

// ----------------------------------------------------------------------
// B-2 — delete inverse: per source kind
// ----------------------------------------------------------------------

describe('inverseOf(delete) — per SourcePageRef variant (B-2)', () => {
  it('delete of an original page → inverse is insert with source.kind=original', () => {
    const op: EditOperation = {
      kind: 'delete',
      meta: meta('d-orig'),
      pageIndex: 2,
      preservedSource: { kind: 'original', originalIndex: 2 },
    };
    const inv = inverseOf(op, makeBlankDoc());
    expect(inv.kind).toBe('insert');
    if (inv.kind !== 'insert') return; // narrowing
    expect(inv.atIndex).toBe(2);
    expect(inv.source.kind).toBe('original');
    if (inv.source.kind === 'original') {
      expect(inv.source.originalIndex).toBe(2);
    }
  });

  it('delete of a blank-inserted page → inverse is insert with source.kind=blank', () => {
    const op: EditOperation = {
      kind: 'delete',
      meta: meta('d-blank'),
      pageIndex: 1,
      preservedSource: { kind: 'blank', width: 612, height: 792 },
    };
    const inv = inverseOf(op, makeBlankDoc());
    expect(inv.kind).toBe('insert');
    if (inv.kind !== 'insert') return;
    expect(inv.source.kind).toBe('blank');
    expect(inv.atIndex).toBe(1);
  });

  it('delete of an image page → inverse is image-insert (NOT generic insert)', () => {
    // B-2 root case. The renderer-side delete of an image-inserted page
    // captures preservedSource.kind === 'image'. The inverse must be
    // `image-insert` so David's applyImageInsert (rather than applyInsert)
    // handles the restoration on save.
    const image = makeImagePayload();
    const op: EditOperation = {
      kind: 'delete',
      meta: meta('d-img'),
      pageIndex: 3,
      preservedSource: {
        kind: 'image',
        image,
        pageWidth: image.width * 0.75,
        pageHeight: image.height * 0.75,
      },
    };
    const inv = inverseOf(op, makeBlankDoc());
    expect(inv.kind).toBe('image-insert');
    if (inv.kind !== 'image-insert') return;
    expect(inv.atIndex).toBe(3);
    expect(inv.image.contentHash).toBe('imgsha-001');
    expect(inv.image.mimeType).toBe('image/png');
  });

  it('delete of an inserted (cross-op-chain) page → inverse is insert with source.kind=inserted', () => {
    // Per the brief: cross-op-chain undo is undefined behavior. Per
    // data-models.md §3.2 the uniform contract is `delete → insert`.
    // The renderer honors §3.2; Phase 3 combine work may revisit.
    const op: EditOperation = {
      kind: 'delete',
      meta: meta('d-ins'),
      pageIndex: 0,
      preservedSource: {
        kind: 'inserted',
        sourceFileHash: 'src-doc-hash',
        sourcePageIndex: 5,
      },
    };
    const inv = inverseOf(op, makeBlankDoc());
    expect(inv.kind).toBe('insert');
    if (inv.kind !== 'insert') return;
    expect(inv.source.kind).toBe('inserted');
    if (inv.source.kind === 'inserted') {
      expect(inv.source.sourceFileHash).toBe('src-doc-hash');
      expect(inv.source.sourcePageIndex).toBe(5);
    }
  });
});

// ----------------------------------------------------------------------
// Round-trip identity: apply forward, apply inverse, expect initial state
// ----------------------------------------------------------------------

describe('inverseOf(delete) — round-trip identity (B-2)', () => {
  it('delete of original page → inverse re-creates the page at the same index', () => {
    const refs: SourcePageRef[] = [
      { kind: 'original', originalIndex: 0 },
      { kind: 'original', originalIndex: 1 },
      { kind: 'original', originalIndex: 2 },
    ];
    const docA = makeDocWithPages(refs);
    const docB = makeDocWithPages(refs);
    const fwd: EditOperation = {
      kind: 'delete',
      meta: meta('f'),
      pageIndex: 1,
      preservedSource: refs[1]!,
    };
    applyOperationToDocument(docA, fwd);
    expect(docA.pageCount).toBe(2);
    const inv = inverseOf(fwd, docB);
    applyOperationToDocument(docA, inv);
    expect(docA.pageCount).toBe(3);
    expect(docA.pages.map((p) => p.sourcePageRef)).toEqual(refs);
  });

  it('delete of an image page → image-insert inverse restores image-source page', () => {
    // The critical B-2 round-trip: dispatch delete on an image page, compute
    // the inverse, dispatch it back. Final pages array must include an image
    // source ref at the deleted index.
    const image = makeImagePayload('img-roundtrip-001');
    const imageSource: SourcePageRef = {
      kind: 'image',
      image,
      pageWidth: image.width * 0.75,
      pageHeight: image.height * 0.75,
    };
    const startRefs: SourcePageRef[] = [
      { kind: 'original', originalIndex: 0 },
      imageSource,
      { kind: 'original', originalIndex: 1 },
    ];
    const doc = makeDocWithPages(startRefs);
    const initialPageCount = doc.pageCount;

    const fwd: EditOperation = {
      kind: 'delete',
      meta: meta('f-img'),
      pageIndex: 1,
      preservedSource: imageSource,
    };
    applyOperationToDocument(doc, fwd);
    expect(doc.pageCount).toBe(initialPageCount - 1);
    // The image page is gone; surrounding originals collapse.
    expect(doc.pages.map((p) => p.sourcePageRef.kind)).toEqual(['original', 'original']);

    const inv = inverseOf(fwd, makeBlankDoc());
    // Critical assertion: inverse is image-insert, not generic insert.
    expect(inv.kind).toBe('image-insert');

    applyOperationToDocument(doc, inv);
    expect(doc.pageCount).toBe(initialPageCount);
    // Page at index 1 is now an image-source page again (applyImageInsert
    // builds the sourcePageRef itself from the image payload — verify by hash).
    const restored = doc.pages[1];
    expect(restored?.sourcePageRef.kind).toBe('image');
    if (restored?.sourcePageRef.kind === 'image') {
      expect(restored.sourcePageRef.image.contentHash).toBe('img-roundtrip-001');
    }
  });

  it('delete of a blank-inserted page → insert inverse restores blank page', () => {
    const startRefs: SourcePageRef[] = [
      { kind: 'original', originalIndex: 0 },
      { kind: 'blank', width: 612, height: 792 },
    ];
    const doc = makeDocWithPages(startRefs);
    const fwd: EditOperation = {
      kind: 'delete',
      meta: meta('f-blank'),
      pageIndex: 1,
      preservedSource: startRefs[1]!,
    };
    applyOperationToDocument(doc, fwd);
    expect(doc.pageCount).toBe(1);
    const inv = inverseOf(fwd, makeBlankDoc());
    applyOperationToDocument(doc, inv);
    expect(doc.pages.map((p) => p.sourcePageRef)).toEqual(startRefs);
  });
});

// ----------------------------------------------------------------------
// Defensive: annotations on the deleted page do NOT round-trip via the
// inverse map alone (annotation restoration is a separate concern — the
// inverse-of-delete doesn't restore annotations, only the page). Pin this
// behavior so a future refactor doesn't accidentally try to merge them.
// ----------------------------------------------------------------------

describe('inverseOf(delete) — annotation behavior (regression pin)', () => {
  it('inverse-of-delete restores the page but NOT annotations on it', () => {
    const refs: SourcePageRef[] = [
      { kind: 'original', originalIndex: 0 },
      { kind: 'original', originalIndex: 1 },
    ];
    const doc = makeDocWithPages(refs);
    doc.annotations.push(makeAnnot('a-on-p1', 1));
    const fwd: EditOperation = {
      kind: 'delete',
      meta: meta('f-with-annot'),
      pageIndex: 1,
      preservedSource: refs[1]!,
    };
    applyOperationToDocument(doc, fwd);
    expect(doc.annotations.length).toBe(0);
    const inv = inverseOf(fwd, makeBlankDoc());
    applyOperationToDocument(doc, inv);
    // Page is back; the annotation is NOT — this is the documented Phase 2
    // limitation. A future enhancement could pair delete with annot-deletes
    // in a compound op, but that's out of scope.
    expect(doc.pageCount).toBe(2);
    expect(doc.annotations.length).toBe(0);
  });
});
