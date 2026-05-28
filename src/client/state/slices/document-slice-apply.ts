// Pure reducer-step functions for each EditOperation variant.
// Lives next to document-slice.ts so Immer's draft type still applies.
// Exhaustiveness is enforced by the `never` assertion default branch.

import {
  type AnnotationModel,
  type EditOperation,
  type PDFDocumentModel,
} from '../../types/ipc-contract';

export function applyOperationToDocument(doc: PDFDocumentModel, op: EditOperation): void {
  switch (op.kind) {
    case 'reorder':
      applyReorder(doc, op);
      break;
    case 'insert':
      applyInsert(doc, op);
      break;
    case 'delete':
      applyDelete(doc, op);
      break;
    case 'rotate':
      applyRotate(doc, op);
      break;
    case 'annot-add':
      applyAnnotAdd(doc, op);
      break;
    case 'annot-edit':
      applyAnnotEdit(doc, op);
      break;
    case 'annot-delete':
      applyAnnotDelete(doc, op);
      break;
    // Phase 2 variants — renderer-side state mutations are minimal because the
    // engine (main-process replay) owns the byte-level work. The renderer
    // tracks dirty state via `dirtyOps.push(op)` below; UI overlays read
    // image-overlays directly from `dirtyOps` until next save (architecture-
    // phase-2.md §4 + §11).
    case 'image-insert':
      applyImageInsert(doc, op);
      break;
    case 'image-overlay':
      // Pure renderer: overlay is presentational until save; nothing to mutate
      // on the PageModel. The PdfCanvas reads image-overlay ops from dirtyOps.
      break;
    case 'image-overlay-edit':
      // Overlay rect change — Canvas re-reads from dirtyOps; no PageModel field.
      break;
    case 'image-overlay-delete':
      // Overlay removal — Canvas re-reads from dirtyOps; no PageModel field.
      break;
    case 'text-replace':
      // Renderer-side text replacement is presentational (the text-edit overlay
      // shows the new text until next save → refresh per ui-spec §11.5). The
      // underlying PageModel doesn't store run text; the engine resolves the
      // objectId at save time.
      break;
    // Phase 3 form ops — renderer-side state lives in formsSlice; the
    // document-slice only records the op in dirtyOps for the engine to consume
    // at save time. No PageModel mutation here (form widgets are an overlay).
    // The forms-slice receives the truthful field def update via the matching
    // reducer (addAuthoredField / removeFieldByName / patchField / markCommitted)
    // dispatched alongside applyEdit by the owning thunk.
    case 'form-commit':
      break;
    case 'form-design-add':
      break;
    case 'form-design-remove':
      break;
    case 'form-design-edit':
      break;
    case 'form-flatten':
      break;
    // Phase 4 — signature + shape ops. Renderer-side mutations are minimal:
    // the engine owns the byte-level signing + shape rendering on save.
    // The annotation summary panel reads shape annotations from
    // doc.annotations; the addShape thunk dispatches a follow-up
    // (handled via the slice's addAuthoredShape pattern, future Wave).
    case 'signature-visual-place':
      break;
    case 'signature-pades-applied':
      break;
    case 'signature-visual-remove':
      break;
    case 'signature-pades-removed':
      break;
    case 'annot-add-shape':
      // Mirror the shape into doc.annotations so the summary panel sees it.
      // We model it as a regular AnnotationModel — the subtype field is the
      // shape subtype; other shape-specific fields (vertices, lineEnd, etc.)
      // are intentionally NOT mirrored here (the canvas reads them from
      // dirtyOps); the summary panel only needs subtype/page/rect/contents.
      {
        const a = op.annotation;
        const mirrored: AnnotationModel = {
          id: a.id,
          pageIndex: a.pageIndex,
          subtype: a.subtype,
          rect: a.rect,
          color: a.color,
          opacity: a.opacity,
          createdAt: a.createdAt,
          modifiedAt: a.modifiedAt,
          dirty: true,
        };
        if (a.contents !== undefined) mirrored.contents = a.contents;
        if (a.author !== undefined) mirrored.author = a.author;
        doc.annotations.push(mirrored);
      }
      break;
    case 'annot-edit-shape':
      // Patch the mirrored AnnotationModel (rect/contents/opacity changes).
      {
        const idx = doc.annotations.findIndex((a) => a.id === op.id);
        if (idx >= 0) {
          const existing = doc.annotations[idx];
          if (existing) {
            const after = op.after;
            doc.annotations[idx] = {
              ...existing,
              modifiedAt: Date.now(),
              ...(after.rect !== undefined ? { rect: after.rect } : {}),
              ...(after.color !== undefined ? { color: after.color } : {}),
              ...(after.opacity !== undefined ? { opacity: after.opacity } : {}),
              ...(after.contents !== undefined ? { contents: after.contents } : {}),
            };
          }
        }
      }
      break;
    case 'annot-delete-shape':
      doc.annotations = doc.annotations.filter((a) => a.id !== op.before.id);
      break;
    // Phase 5 — OCR text-behind-image ops. Per architecture-phase-5.md §4.8.
    // Renderer side: no PageModel mutation. The /Contents stream authorship
    // lives entirely in main (searchable-pdf-builder.ts). The op is pushed to
    // dirtyOps below so the replay engine sees it at next Save.
    case 'ocr-text-behind-applied':
      break;
    case 'ocr-text-behind-removed':
      break;
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unhandled op: ${JSON.stringify(_exhaustive)}`);
    }
  }
  doc.dirtyOps.push(op);
}

function applyReorder(
  doc: PDFDocumentModel,
  op: Extract<EditOperation, { kind: 'reorder' }>,
): void {
  const { fromIndex, toIndex } = op;
  if (fromIndex < 0 || fromIndex >= doc.pages.length) return;
  if (toIndex < 0 || toIndex >= doc.pages.length) return;
  const removed = doc.pages.splice(fromIndex, 1)[0];
  if (!removed) return;
  doc.pages.splice(toIndex, 0, removed);
  // Reindex.
  for (let i = 0; i < doc.pages.length; i++) {
    const p = doc.pages[i];
    if (p) p.pageIndex = i;
  }
  // Rebind annotation pageIndex: annotations on the moved page follow it.
  for (const a of doc.annotations) {
    if (a.pageIndex === fromIndex) {
      a.pageIndex = toIndex;
    } else if (fromIndex < toIndex && a.pageIndex > fromIndex && a.pageIndex <= toIndex) {
      a.pageIndex -= 1;
    } else if (fromIndex > toIndex && a.pageIndex >= toIndex && a.pageIndex < fromIndex) {
      a.pageIndex += 1;
    }
  }
}

function applyInsert(doc: PDFDocumentModel, op: Extract<EditOperation, { kind: 'insert' }>): void {
  const { atIndex, source } = op;
  let width = 612;
  let height = 792;
  if (source.kind === 'blank') {
    width = source.width;
    height = source.height;
  } else if (source.kind === 'original' || source.kind === 'inserted') {
    // For Phase 1 we don't have the source PDF's page dimensions handy
    // (David's main process owns them). Use a safe default; David's pdf-lib
    // engine corrects this on save.
    width = 612;
    height = 792;
  }
  doc.pages.splice(atIndex, 0, {
    pageIndex: atIndex,
    sourcePageRef: source,
    rotation: 0,
    width,
    height,
  });
  // Reindex.
  for (let i = 0; i < doc.pages.length; i++) {
    const p = doc.pages[i];
    if (p) p.pageIndex = i;
  }
  for (const a of doc.annotations) {
    if (a.pageIndex >= atIndex) a.pageIndex += 1;
  }
  doc.pageCount = doc.pages.length;
}

function applyDelete(doc: PDFDocumentModel, op: Extract<EditOperation, { kind: 'delete' }>): void {
  const { pageIndex } = op;
  if (pageIndex < 0 || pageIndex >= doc.pages.length) return;
  doc.pages.splice(pageIndex, 1);
  // Remove annotations on this page; rebind others.
  doc.annotations = doc.annotations.filter((a) => a.pageIndex !== pageIndex);
  for (const a of doc.annotations) {
    if (a.pageIndex > pageIndex) a.pageIndex -= 1;
  }
  for (let i = 0; i < doc.pages.length; i++) {
    const p = doc.pages[i];
    if (p) p.pageIndex = i;
  }
  doc.pageCount = doc.pages.length;
}

function applyRotate(doc: PDFDocumentModel, op: Extract<EditOperation, { kind: 'rotate' }>): void {
  const page = doc.pages[op.pageIndex];
  if (!page) return;
  page.rotation = op.toRotation;
}

function applyAnnotAdd(
  doc: PDFDocumentModel,
  op: Extract<EditOperation, { kind: 'annot-add' }>,
): void {
  doc.annotations.push({ ...op.annotation, dirty: true });
}

function applyAnnotEdit(
  doc: PDFDocumentModel,
  op: Extract<EditOperation, { kind: 'annot-edit' }>,
): void {
  const idx = doc.annotations.findIndex((a) => a.id === op.id);
  if (idx === -1) return;
  const existing = doc.annotations[idx];
  if (!existing) return;
  Object.assign(existing, op.after, { dirty: true, modifiedAt: Date.now() });
}

function applyAnnotDelete(
  doc: PDFDocumentModel,
  op: Extract<EditOperation, { kind: 'annot-delete' }>,
): void {
  doc.annotations = doc.annotations.filter((a) => a.id !== op.before.id);
}

function applyImageInsert(
  doc: PDFDocumentModel,
  op: Extract<EditOperation, { kind: 'image-insert' }>,
): void {
  const { atIndex, image } = op;
  // Default page size derived from image intrinsic pixels; engine corrects on
  // save (architecture-phase-2.md §4). A reasonable PDF user-space scale at
  // 72 dpi assumes 1px = 0.75pt; clamp to US Letter floor.
  const pageWidth = Math.max(72, image.width * 0.75);
  const pageHeight = Math.max(72, image.height * 0.75);
  doc.pages.splice(atIndex, 0, {
    pageIndex: atIndex,
    sourcePageRef: {
      kind: 'image',
      image,
      pageWidth,
      pageHeight,
    },
    rotation: 0,
    width: pageWidth,
    height: pageHeight,
  });
  for (let i = 0; i < doc.pages.length; i++) {
    const p = doc.pages[i];
    if (p) p.pageIndex = i;
  }
  for (const a of doc.annotations) {
    if (a.pageIndex >= atIndex) a.pageIndex += 1;
  }
  doc.pageCount = doc.pages.length;
}
