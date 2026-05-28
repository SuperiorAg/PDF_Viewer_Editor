// Phase-2 PDF Edit-Replay Engine.
//
// Contract: docs/edit-replay-engine.md (Riley, Wave 6 design doc, 857 lines).
// Lynchpin: docs/architecture-phase-2.md §3 — main keeps original bytes
// per handle; the engine reads them, applies the ordered ops list +
// annotation snapshot, and emits new bytes.
//
// Pure function over (originalBytes, ops, annotations) — no FS, no DB, no
// network, no console.log. Per conventions §13.2. See edit-replay-engine.md
// §2.2 for the full purity contract.
//
// Fidelity boundary documented in edit-replay-engine.md §12. This module
// implements ops 1-11 (5 Phase-1 + 6 Phase-2) and Phase-2 annotation subtypes
// (/Underline, /StrikeOut, /Ink). Round-trip fidelity matrix per §12.

import { PDFDocument, degrees, rgb, type PDFPage } from 'pdf-lib';
import { StandardFonts } from 'pdf-lib';

import type {
  AnnotationModel,
  AnnotationModelSerialized,
  EditOperation,
  EditOperationSerialized,
  FormFieldValue,
  ImageEmbedPayload,
  PdfRect,
} from '../../ipc/contracts.js';
import type { Result } from '../../shared/result.js';
import { fail, ok } from '../../shared/result.js';

import {
  applyFormCommit,
  applyFormDesignAdd,
  applyFormDesignEdit,
  applyFormDesignRemove,
  stripDocLevelJavaScript,
} from './form-engine.js';
import { ImageCache, embedImage, computeNewPageSize } from './image-embed.js';
import { applyTextReplace } from './text-replace.js';

// ============================================================================
// Public types (mirror edit-replay-engine.md §2.1)
// ============================================================================

export interface ReplayInput {
  originalBytes: Uint8Array;
  ops: EditOperationSerialized[];
  annotations: AnnotationModelSerialized[];
  jobId: string;
  /**
   * Optional bookmarks snapshot to write to the output PDF's /Outlines
   * dictionary. Present on pdf:export only; absent on fs:writePdf
   * kind:'ops' which preserves the source outline.
   */
  emitBookmarksToOutline?: Array<{
    id: number;
    title: string;
    pageIndex: number;
    parentId: number | null;
    sortOrder: number;
  }>;
  /** Optional progress reporter; engine emits monotonically increasing percents. */
  onProgress?: (evt: ReplayProgressEvent) => void;
}

export type ReplayPhase =
  | 'preparing'
  | 'pdflib-applying-ops'
  | 'pdflib-applying-text-replace'
  | 'pdflib-embedding-images'
  | 'pdflib-emitting-annotations'
  // Phase 3 (architecture-phase-3.md §5.7): step 3.6 sub-phase
  | 'pdflib-applying-forms'
  | 'finalizing';

export interface ReplayProgressEvent {
  jobId: string;
  phase: ReplayPhase;
  percent: number;
  message?: string;
}

export type ReplayError =
  | 'load_failed'
  | 'op_apply_failed'
  | 'annotation_emit_failed'
  | 'image_decode_failed'
  | 'text_span_not_found'
  | 'missing_glyph'
  | 'serialize_failed'
  | 'encrypted_unsupported'
  // Phase 3 (form-engine.md §7)
  | 'form_field_create_failed'
  | 'form_field_not_found'
  | 'form_flatten_failed'
  // Phase 4.1 (H-17.3, David, 2026-05-26): abort save when post-PAdES
  // edits would invalidate the signature embedded in the bytes. See
  // signature-engine.md §7.3 + replay-engine.ts step 3.7.
  | 'pades_invalidated_by_subsequent_edit'
  // Phase 5 (architecture-phase-5.md §4.8, conventions §16.5): mirrors
  // the H-17.3 discipline for OCR. If the doc carries a prior PAdES
  // signature AND an OCR op is in the replay queue without the user's
  // documented confirm (`invalidatesSignatures: true` on the op), replay
  // ABORTS rather than silently invalidate the signature. The OCR modal
  // pre-flight in the IPC handler catches this earlier; this variant
  // exists for the case where a serialized op with `invalidatesSignatures:
  // false` reaches the engine (e.g. a malformed replay request).
  | 'ocr_invalidates_pades_signature'
  // Phase 5 (architecture-phase-5.md §4.8): EditOperation references an
  // `ocr_jobs.id` that no longer exists (e.g. DB was edited externally).
  | 'ocr_job_missing';

export interface ReplayOk {
  newBytes: Uint8Array;
  warnings: string[];
  engineUsed: 'pdf-lib';
  byteCount: number;
  durationMs: number;
  /** annotation.id -> newly-assigned pdfObjectNumber */
  annotationRefAssignments: Record<string, number>;
}

export type ReplayResult = Result<ReplayOk, ReplayError>;

// ============================================================================
// Per-invocation context
// ============================================================================

interface PageContext {
  /** Current position in the (mutating) page array. */
  currentIndex: number;
  page: PDFPage;
}

interface OverlayEntry {
  pageIndex: number;
  rect: PdfRect;
  image: ImageEmbedPayload;
}

interface ReplayContext {
  imageCache: ImageCache;
  liveOverlays: Map<string /* overlayId */, OverlayEntry>;
  pages: PageContext[];
  warnings: string[];
  jobId: string;
  /**
   * Wave 8.5 (B-2): the raw original PDF bytes for the handle. Held so
   * `applyInsert` can lazily load them as a separate PDFDocument and copy
   * pages back via `doc.copyPages(...)` when reinstating an
   * `insert { source: { kind: 'original', originalIndex } }` op — the inverse
   * of a `delete` of an original page (data-models §7.1.3, §3.2).
   */
  originalBytes: Uint8Array;
  /**
   * Memoized parsed copy of `originalBytes`. Lazily populated on first
   * `insert { kind: 'original' }` op; null until then so the common
   * no-original-insert path pays no parse cost.
   */
  originalDoc: PDFDocument | null;
}

// ============================================================================
// Entry point
// ============================================================================

export async function replay(input: ReplayInput): Promise<ReplayResult> {
  const startedAt = Date.now();

  if (!(input.originalBytes instanceof Uint8Array) || input.originalBytes.byteLength === 0) {
    return fail<ReplayError>('load_failed', 'originalBytes empty or not a Uint8Array');
  }

  emitProgress(input, 'preparing', 0);

  // ---- Step 1: load
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input.originalBytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch (e) {
    const msg = (e as Error).message ?? 'unknown';
    if (/encrypt/i.test(msg)) {
      return fail<ReplayError>(
        'encrypted_unsupported',
        `pdf-lib cannot preserve encryption on save: ${msg}`,
      );
    }
    return fail<ReplayError>('load_failed', `pdf-lib load threw: ${msg}`);
  }

  emitProgress(input, 'preparing', 5);

  // ---- Step 2: build context
  const ctx: ReplayContext = {
    imageCache: new ImageCache(),
    liveOverlays: new Map(),
    pages: doc.getPages().map((page, currentIndex) => ({ currentIndex, page })),
    warnings: [],
    jobId: input.jobId,
    originalBytes: input.originalBytes,
    originalDoc: null,
  };

  // ---- Step 3: fold ops
  const opsTotal = Math.max(1, input.ops.length);
  for (let i = 0; i < input.ops.length; i += 1) {
    const op = input.ops[i] as EditOperation | undefined;
    if (!op) continue;
    const r = await applyOp(doc, ctx, op);
    if (!r.ok) {
      const err = r.error;
      // Translate inner errors into ReplayError codes.
      if (err === 'image_decode_failed') {
        return fail<ReplayError>('image_decode_failed', r.message, {
          opIndex: i,
          opKind: op.kind,
        });
      }
      if (err === 'text_span_not_found') {
        return fail<ReplayError>('text_span_not_found', r.message, {
          opIndex: i,
          opKind: op.kind,
        });
      }
      if (err === 'missing_glyph') {
        return fail<ReplayError>('missing_glyph', r.message, {
          opIndex: i,
          opKind: op.kind,
          ...(r.details ?? {}),
        });
      }
      if (err === 'form_field_create_failed') {
        return fail<ReplayError>('form_field_create_failed', r.message, {
          opIndex: i,
          opKind: op.kind,
        });
      }
      if (err === 'form_field_not_found') {
        return fail<ReplayError>('form_field_not_found', r.message, {
          opIndex: i,
          opKind: op.kind,
        });
      }
      if (err === 'form_flatten_failed') {
        return fail<ReplayError>('form_flatten_failed', r.message, {
          opIndex: i,
          opKind: op.kind,
        });
      }
      return fail<ReplayError>('op_apply_failed', r.message, {
        opIndex: i,
        opKind: op.kind,
      });
    }
    emitProgress(input, 'pdflib-applying-ops', 5 + Math.floor(((i + 1) / opsTotal) * 50));
  }

  // ---- Step 3.5: defer-render overlays (edit-replay-engine.md §4.5)
  if (ctx.liveOverlays.size > 0) {
    emitProgress(input, 'pdflib-embedding-images', 55);
    for (const [, entry] of ctx.liveOverlays) {
      const embedRes = await embedImage(doc, ctx.imageCache, entry.image);
      if (!embedRes.ok) {
        return fail<ReplayError>('image_decode_failed', embedRes.message, {
          overlayId: 'pending',
        });
      }
      ctx.warnings.push(...embedRes.value.warnings);
      const target = ctx.pages[entry.pageIndex];
      if (!target) {
        return fail<ReplayError>(
          'op_apply_failed',
          `overlay pageIndex ${entry.pageIndex} out of range`,
        );
      }
      try {
        target.page.drawImage(embedRes.value.image, {
          x: entry.rect.x,
          y: entry.rect.y,
          width: entry.rect.width,
          height: entry.rect.height,
        });
      } catch (e) {
        return fail<ReplayError>('op_apply_failed', `drawImage threw: ${(e as Error).message}`);
      }
    }
  }

  // ---- Step 3.6: apply form ops (architecture-phase-3.md §5.7).
  // Order: design-add -> design-edit -> design-remove -> commit -> flatten.
  // The fold preserves user intent: author + edit fields, then remove (so a
  // removed field can't be filled), then fill, then optionally flatten last
  // (irreversible bake).
  const formOps = input.ops.filter(
    (op): op is EditOperation =>
      op?.kind === 'form-commit' ||
      op?.kind === 'form-design-add' ||
      op?.kind === 'form-design-remove' ||
      op?.kind === 'form-design-edit' ||
      op?.kind === 'form-flatten',
  );
  if (formOps.length > 0) {
    emitProgress(input, 'pdflib-applying-forms', 58);
    const form = doc.getForm();
    // 1. design-add
    for (const op of formOps) {
      if (op.kind !== 'form-design-add') continue;
      try {
        const r = applyFormDesignAdd(doc, form, op.fieldDefinition);
        ctx.warnings.push(...r.warnings);
      } catch (e) {
        return fail<ReplayError>('form_field_create_failed', (e as Error).message, {
          fieldName: op.fieldDefinition.name,
        });
      }
    }
    // 2. design-edit
    for (const op of formOps) {
      if (op.kind !== 'form-design-edit') continue;
      try {
        const r = applyFormDesignEdit(doc, form, op.fieldName, op.after);
        ctx.warnings.push(...r.warnings);
      } catch (e) {
        return fail<ReplayError>('form_field_not_found', (e as Error).message, {
          fieldName: op.fieldName,
        });
      }
    }
    // 3. design-remove
    for (const op of formOps) {
      if (op.kind !== 'form-design-remove') continue;
      try {
        applyFormDesignRemove(form, op.fieldName);
      } catch (e) {
        // not-found on remove is non-fatal (the field may have been removed
        // earlier in the same batch via a different path); warn but continue.
        ctx.warnings.push(`form-design-remove '${op.fieldName}': ${(e as Error).message}`);
      }
    }
    // 4. form-commit (last-write-wins merge per field name)
    const mergedValues: Record<string, FormFieldValue> = {};
    for (const op of formOps) {
      if (op.kind !== 'form-commit') continue;
      Object.assign(mergedValues, op.fieldValues);
    }
    if (Object.keys(mergedValues).length > 0) {
      const r = applyFormCommit(form, mergedValues);
      ctx.warnings.push(...r.warnings);
      for (const name of r.unmatchedFieldNames) {
        ctx.warnings.push(`form-commit: field '${name}' not in document; skipped`);
      }
    }
    // 6. Update appearances (unless a flatten will run next).
    const willFlatten = formOps.some((op) => op.kind === 'form-flatten');
    if (!willFlatten) {
      try {
        const font = await doc.embedFont(StandardFonts.Helvetica);
        form.updateFieldAppearances(font);
      } catch (e) {
        ctx.warnings.push(`updateFieldAppearances threw: ${(e as Error).message}`);
      }
    }
    // 7. form-flatten (irreversible bake)
    for (const op of formOps) {
      if (op.kind !== 'form-flatten') continue;
      try {
        // Update appearances before flatten so the baked content reflects
        // committed values.
        const font = await doc.embedFont(StandardFonts.Helvetica);
        form.updateFieldAppearances(font);
        form.flatten();
      } catch (e) {
        return fail<ReplayError>('form_flatten_failed', (e as Error).message);
      }
      // Only one flatten op is meaningful; subsequent flattens are no-ops.
      break;
    }
    emitProgress(input, 'pdflib-applying-forms', 60);
  }

  // Pre-declare so step 3.8 can populate before step 4 takes over.
  const annotationRefAssignments: Record<string, number> = {};

  // ---- Step 3.6.5: Strip /Names → /JavaScript per P3-L-2 (conventions §14.6).
  //
  // Phase 4 (Wave 16, M-13.5-1 fix): the strip is now OUTSIDE the
  // `if (formOps.length > 0)` block above so EVERY save path strips — not
  // just form-bearing saves. Per Julian's Wave 13.5 re-audit
  // (code-review.md M-13.5-1) + architecture-phase-4.md §4.8. Test that
  // catches the regression: a JS-laden source PDF + image-only ops + no
  // form ops MUST strip the JS on save. See replay-engine-strip-js.test.ts.
  if (stripDocLevelJavaScript(doc)) {
    ctx.warnings.push(
      'JavaScript actions stripped from document (Phase 3 limitation; Phase 3.1 may preserve read-only)',
    );
  }

  // ---- Step 3.7: signature ops (Phase 4, architecture-phase-4.md §4.7).
  //
  // Visual signatures: at this layer we ASSERT the widget already exists
  // in the bytes (the visual-signature.ts engine ran at sign-time via
  // signatures:applyVisual). Replay is a no-op for visual ops — the bytes
  // already carry the widget.
  //
  // PAdES signatures: same — the bytes already carry the signed widget +
  // /V /Contents. If the user has signed AND continued editing in the same
  // session, replay aborts with pades_invalidated_by_subsequent_edit
  // (architecture-phase-4.md §4.7).
  const sigOps = input.ops.filter(
    (op): op is EditOperation =>
      op?.kind === 'signature-visual-place' ||
      op?.kind === 'signature-visual-remove' ||
      op?.kind === 'signature-pades-applied' ||
      op?.kind === 'signature-pades-removed',
  );
  for (const op of sigOps) {
    if (op.kind === 'signature-pades-applied') {
      // Were there any subsequent doc-mutating ops AFTER this PAdES sign?
      const opIdx = input.ops.indexOf(op);
      const subsequent = input.ops.slice(opIdx + 1);
      const mutators = subsequent.filter(
        (later) =>
          later.kind === 'reorder' ||
          later.kind === 'insert' ||
          later.kind === 'delete' ||
          later.kind === 'rotate' ||
          later.kind === 'image-insert' ||
          later.kind === 'image-overlay' ||
          later.kind === 'image-overlay-edit' ||
          later.kind === 'image-overlay-delete' ||
          later.kind === 'text-replace' ||
          later.kind === 'form-commit' ||
          later.kind === 'form-design-add' ||
          later.kind === 'form-design-remove' ||
          later.kind === 'form-design-edit' ||
          later.kind === 'form-flatten' ||
          // Phase 5: OCR text-behind-image authorship mutates page /Contents
          // streams; same invalidation discipline as every other content-
          // mutating op above.
          later.kind === 'ocr-text-behind-applied' ||
          later.kind === 'ocr-text-behind-removed',
      );
      if (mutators.length > 0) {
        // Phase 4.1 (H-17.3, Julian Wave 17 review): per signature-engine.md
        // §7.3 + architecture-phase-4.md §4.7, replay MUST ABORT (not warn)
        // when post-PAdES edits would invalidate the embedded signature.
        // The earlier behavior (push warning + continue) silently re-saved
        // bytes with subsequent ops applied, leaving an invalid CMS that
        // Acrobat would flag as "Signature is INVALID" with no clue why.
        // The honest behavior is to abort and force the user to undo back
        // to a clean state OR re-sign.
        return fail<ReplayError>(
          'pades_invalidated_by_subsequent_edit',
          `PAdES signature at field '${op.placeholderFieldName ?? '(freeform)'}' invalidated by ${mutators.length} subsequent edit op(s). Undo the edits or apply a new signature.`,
        );
      }
    }
  }
  if (sigOps.length > 0) emitProgress(input, 'pdflib-applying-forms', 65);

  // ---- Step 3.8: shape annotations (Phase 4, architecture-phase-4.md §5).
  //
  // The shape subtypes (Square, Circle, Polygon, PolyLine, Line,
  // FreeTextCallout) are authored via shape-annotations.ts. We delegate
  // here on every annot-add-shape op; annot-edit-shape and annot-delete-
  // shape are handled by the renderer's history middleware (re-authoring
  // produces an updated ShapeAnnotationModel that the next annot-add-shape
  // op carries).
  const shapeAddOps = input.ops.filter(
    (op): op is Extract<EditOperation, { kind: 'annot-add-shape' }> =>
      op?.kind === 'annot-add-shape',
  );
  if (shapeAddOps.length > 0) {
    const { emitShapeAnnotation } = await import('./annotations/shape-annotations.js');
    for (const op of shapeAddOps) {
      const r = emitShapeAnnotation(doc, op.annotation);
      if (!r.ok) {
        return fail<ReplayError>('annotation_emit_failed', r.message, {
          annotationId: op.annotation.id,
        });
      }
      annotationRefAssignments[op.annotation.id] = r.value.pdfObjectNumber;
    }
    emitProgress(input, 'pdflib-emitting-annotations', 70);
  }

  // ---- Step 3.9: OCR-text-behind-image PAdES discipline (Phase 5).
  //
  // Mirrors the Phase 4.1 H-17.3 abort-on-edit-after-sign pattern, but in
  // the opposite direction: we ABORT if any OCR op claims to NOT invalidate
  // signatures while the doc actually carries a prior PAdES widget. The
  // OCR modal pre-flight (conventions §16.5) is supposed to set
  // `invalidatesSignatures: true` whenever the doc has a /V Contents PAdES
  // widget AND surface the user-confirm prompt; this guard catches the
  // case where a malformed serialized op leaks through.
  //
  // The actual text-behind-image authoring lives in
  // searchable-pdf-builder.ts (called from ocr-engine.ts BEFORE the bytes
  // hit document-store). Replay at this point sees the post-OCR bytes; we
  // only validate the op shape against the doc's signature state.
  //
  // See `architecture-phase-5.md §4.8` + `ocr-engine.md §8.4`.
  const ocrAppliedOps = input.ops.filter(
    (op): op is Extract<EditOperation, { kind: 'ocr-text-behind-applied' }> =>
      op?.kind === 'ocr-text-behind-applied',
  );
  if (ocrAppliedOps.length > 0) {
    // Delegate detection to the canonical helper (pades-detect.ts).
    const { detectPriorPadesSignatures } = await import('./pades-detect.js');
    const signedFields = detectPriorPadesSignatures(doc);
    if (signedFields.length > 0) {
      for (const op of ocrAppliedOps) {
        if (!op.invalidatesSignatures) {
          return fail<ReplayError>(
            'ocr_invalidates_pades_signature',
            `OCR op for pages ${op.pageRange.start}-${op.pageRange.end} (job #${op.jobId}) would invalidate a prior PAdES signature (${signedFields.length} field(s) detected); modal pre-flight should have set invalidatesSignatures=true. Refusing to replay.`,
          );
        }
      }
    }
    emitProgress(input, 'pdflib-emitting-annotations', 75);
  }

  // ---- Step 4: emit annotations (annotationRefAssignments was pre-declared above)
  const dirtyAnnots = input.annotations.filter(isDirtyOrUnsaved);
  const annotsTotal = Math.max(1, dirtyAnnots.length);
  for (let i = 0; i < dirtyAnnots.length; i += 1) {
    const a = dirtyAnnots[i];
    if (!a) continue;
    const r = emitAnnotation(doc, ctx, a);
    if (!r.ok) {
      return fail<ReplayError>('annotation_emit_failed', r.message, { annotationId: a.id });
    }
    if (r.value.objectNumber !== null) {
      annotationRefAssignments[a.id] = r.value.objectNumber;
    }
    emitProgress(
      input,
      'pdflib-emitting-annotations',
      60 + Math.floor(((i + 1) / annotsTotal) * 30),
    );
  }

  // ---- Step 4.5: emit bookmarks outline (pdf:export only)
  if (input.emitBookmarksToOutline && input.emitBookmarksToOutline.length > 0) {
    emitProgress(input, 'finalizing', 92);
    // Phase-2 conservative outline emit: pdf-lib doesn't expose an /Outlines
    // builder. We push a warning so the renderer can surface "Outline write-
    // through ships in Phase 2.5". The exported PDF still carries the user-
    // authored bookmarks in our SQLite store (which Phase 5 multi-doc revisits).
    ctx.warnings.push(
      'Bookmarks-to-outline write-through deferred to Phase 2.5; bookmarks remain in app state',
    );
  }

  // ---- Step 5: serialize
  emitProgress(input, 'finalizing', 95);
  let newBytes: Uint8Array;
  try {
    newBytes = await doc.save({
      useObjectStreams: true,
      updateFieldAppearances: false,
      addDefaultPage: false,
    });
  } catch (e) {
    return fail<ReplayError>('serialize_failed', `pdf-lib save threw: ${(e as Error).message}`);
  }

  emitProgress(input, 'finalizing', 100);

  return ok({
    newBytes,
    warnings: ctx.warnings,
    engineUsed: 'pdf-lib' as const,
    byteCount: newBytes.byteLength,
    durationMs: Date.now() - startedAt,
    annotationRefAssignments,
  });
}

// ============================================================================
// Op-fold dispatch (edit-replay-engine.md §4)
// ============================================================================

type ApplyOpError =
  | 'op_apply_failed'
  | 'image_decode_failed'
  | 'text_span_not_found'
  | 'missing_glyph'
  // Phase 3
  | 'form_field_create_failed'
  | 'form_field_not_found'
  | 'form_flatten_failed';

async function applyOp(
  doc: PDFDocument,
  ctx: ReplayContext,
  op: EditOperation,
): Promise<Result<void, ApplyOpError>> {
  switch (op.kind) {
    case 'reorder':
      return applyReorder(doc, ctx, op);
    case 'insert':
      return applyInsert(doc, ctx, op);
    case 'delete':
      return applyDelete(doc, ctx, op);
    case 'rotate':
      return applyRotate(doc, ctx, op);
    case 'annot-add':
    case 'annot-edit':
    case 'annot-delete':
      // Annotation ops don't mutate the doc here — they're driven by the
      // input.annotations snapshot in step 4. Validate shape only.
      return ok(undefined);
    case 'image-insert':
      return applyImageInsert(doc, ctx, op);
    case 'image-overlay':
      return applyImageOverlay(doc, ctx, op);
    case 'image-overlay-edit':
      return applyImageOverlayEdit(ctx, op);
    case 'image-overlay-delete':
      return applyImageOverlayDelete(ctx, op);
    case 'text-replace': {
      const r = await applyTextReplace(doc, op.pageIndex, op.objectId, op.newText, ctx);
      if (!r.ok) {
        if (r.error === 'text_span_not_found') {
          return fail<ApplyOpError>('text_span_not_found', r.message);
        }
        if (r.error === 'missing_glyph') {
          return fail<ApplyOpError>('missing_glyph', r.message, r.details);
        }
        return fail<ApplyOpError>('op_apply_failed', r.message);
      }
      return ok(undefined);
    }
    // ----- Phase 3 form ops --------------------------------------------------
    // Per architecture-phase-3.md §5.7 + form-engine.md §4, form ops do NOT
    // mutate the doc during the per-op fold — they're collected and applied
    // in a single pass at step 3.6 (between drawOverlays and emitAnnots).
    // The per-op fold validates shape only; the actual mutation runs once
    // we have the full ops list partitioned.
    case 'form-commit':
    case 'form-design-add':
    case 'form-design-remove':
    case 'form-design-edit':
    case 'form-flatten':
      return ok(undefined);
    // ----- Phase 4 signature + shape ops -------------------------------------
    // Like form ops, these are partitioned and applied in dedicated post-fold
    // passes (signature ops at step 3.7, shape annotations at step 3.8). The
    // per-op fold validates shape only.
    case 'signature-visual-place':
    case 'signature-visual-remove':
    case 'signature-pades-applied':
    case 'signature-pades-removed':
    case 'annot-add-shape':
    case 'annot-edit-shape':
    case 'annot-delete-shape':
      return ok(undefined);
    // ----- Phase 5 OCR ops ---------------------------------------------------
    // The text-behind-image authorship runs at OCR-engine time via
    // searchable-pdf-builder.ts (which appends BT/ET blocks to each page's
    // /Contents BEFORE the bytes are committed to the document store). By
    // the time replay() sees these ops, the bytes already carry the
    // invisible text layer; replay is no-op + audit-trail. Step 3.9 (below)
    // additionally enforces the PAdES-invalidation discipline.
    case 'ocr-text-behind-applied':
    case 'ocr-text-behind-removed':
      return ok(undefined);
    default: {
      const exhaustive: never = op;
      void exhaustive;
      return fail<ApplyOpError>(
        'op_apply_failed',
        `unknown op kind: ${String((op as { kind: unknown }).kind)}`,
      );
    }
  }
}

// ============================================================================
// Page-structure ops (Phase 1, now Live)
// ============================================================================

function applyReorder(
  doc: PDFDocument,
  ctx: ReplayContext,
  op: Extract<EditOperation, { kind: 'reorder' }>,
): Result<void, ApplyOpError> {
  const n = doc.getPageCount();
  if (op.fromIndex < 0 || op.fromIndex >= n || op.toIndex < 0 || op.toIndex >= n) {
    return fail<ApplyOpError>(
      'op_apply_failed',
      `reorder out of range: from=${op.fromIndex} to=${op.toIndex} (n=${n})`,
    );
  }
  // No-op when source == destination. removePage+insertPage with identical
  // index is also a valid identity, but skipping spares pdf-lib a page-tree
  // round-trip and keeps the post-fold ctx.pages strictly equal.
  if (op.fromIndex === op.toIndex) {
    return ok(undefined);
  }
  // Wave 8.5 fix (B-1): capture the page reference BEFORE removePage so we
  // can re-insert it at toIndex. pdf-lib's `insertPage(index, page)` accepts
  // a `PDFPage` whose `doc` is this document and re-wires its parent via
  // `catalog.insertLeafNode(page.ref, index)`. After removePage, the pages
  // above fromIndex shift down by one; inserting at toIndex (referring to
  // the FINAL position in the resulting array) mirrors the renderer's splice
  // semantics in document-slice-apply.ts:applyReorder. Worked-example:
  //   [A,B,C], from=0,to=2 → remove A → [B,C] → insert(2,A) → [B,C,A] ✓
  //   [A,B,C], from=2,to=0 → remove C → [A,B] → insert(0,C) → [C,A,B] ✓
  try {
    const captured = doc.getPage(op.fromIndex);
    doc.removePage(op.fromIndex);
    doc.insertPage(op.toIndex, captured);
  } catch (e) {
    return fail<ApplyOpError>('op_apply_failed', `reorder failed: ${(e as Error).message}`);
  }
  // Rebuild ctx.pages with the new ordering so downstream ops in the same
  // fold see the post-reorder indexes.
  ctx.pages = doc.getPages().map((page, currentIndex) => ({ currentIndex, page }));
  return ok(undefined);
}

async function applyInsert(
  doc: PDFDocument,
  ctx: ReplayContext,
  op: Extract<EditOperation, { kind: 'insert' }>,
): Promise<Result<void, ApplyOpError>> {
  const n = doc.getPageCount();
  if (op.atIndex < 0 || op.atIndex > n) {
    return fail<ApplyOpError>('op_apply_failed', `insert atIndex ${op.atIndex} out of range`);
  }
  // ---- 'blank': insert a freshly-created blank page sized as requested.
  if (op.source.kind === 'blank') {
    try {
      doc.insertPage(op.atIndex, [op.source.width, op.source.height]);
    } catch (e) {
      return fail<ApplyOpError>('op_apply_failed', `insert blank failed: ${(e as Error).message}`);
    }
    ctx.pages = doc.getPages().map((page, currentIndex) => ({ currentIndex, page }));
    return ok(undefined);
  }
  // ---- 'image': re-create an image-as-page (inverse of image-insert).
  // Wave 8.5 fix (B-2): this branch used to silently no-op. Riley's
  // document-inverses.ts is being moved to emit `image-insert` directly for
  // image undo-of-delete (the canonical inverse per data-models §7.1.3); we
  // still honor the generic `insert { source.kind: 'image' }` shape because
  // it is part of the documented SourcePageRef union and an external caller
  // (e.g. a future combine bridge) may produce it. We delegate to the same
  // code path applyImageInsert uses — page sized to the image, full-bleed
  // drawImage.
  if (op.source.kind === 'image') {
    const embedRes = await embedImage(doc, ctx.imageCache, op.source.image);
    if (!embedRes.ok) {
      if (embedRes.error === 'image_decode_failed' || embedRes.error === 'tiff_decode_failed') {
        return fail<ApplyOpError>('image_decode_failed', embedRes.message);
      }
      return fail<ApplyOpError>('op_apply_failed', embedRes.message);
    }
    ctx.warnings.push(...embedRes.value.warnings);
    // Prefer the caller-provided pageWidth/pageHeight (set by Riley's
    // image-insert inverse to match the original creation dims). Fall back
    // to the A4-fit default if either is unset / non-positive.
    const fallback = computeNewPageSize(op.source.image.width, op.source.image.height);
    const pageWidth = op.source.pageWidth > 0 ? op.source.pageWidth : fallback.width;
    const pageHeight = op.source.pageHeight > 0 ? op.source.pageHeight : fallback.height;
    try {
      const page = doc.insertPage(op.atIndex, [pageWidth, pageHeight]);
      page.drawImage(embedRes.value.image, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
    } catch (e) {
      return fail<ApplyOpError>('op_apply_failed', `insert image failed: ${(e as Error).message}`);
    }
    ctx.pages = doc.getPages().map((page, currentIndex) => ({ currentIndex, page }));
    return ok(undefined);
  }
  // ---- 'original': copy the page from the original PDF and insert.
  // Wave 8.5 fix (B-2): used to be the silent "Phase-3 scope fence" no-op
  // that turned undo-of-delete into a permanent deletion. The original
  // bytes are already held per handle (P2-L-2); we lazily parse a second
  // PDFDocument off them and use copyPages to re-introduce the page into
  // the in-progress doc. See edit-replay-engine.md §4.1 — pdf-lib supports
  // cross-document page copy via copyPages even when both docs share
  // bytes (it deep-clones via the PDFCopier).
  if (op.source.kind === 'original') {
    const origIdx = op.source.originalIndex;
    if (!Number.isInteger(origIdx) || origIdx < 0) {
      return fail<ApplyOpError>(
        'op_apply_failed',
        `insert original: invalid originalIndex ${origIdx}`,
      );
    }
    if (!ctx.originalDoc) {
      try {
        ctx.originalDoc = await PDFDocument.load(ctx.originalBytes, {
          ignoreEncryption: false,
          updateMetadata: false,
        });
      } catch (e) {
        return fail<ApplyOpError>(
          'op_apply_failed',
          `insert original: loading originalBytes failed: ${(e as Error).message}`,
        );
      }
    }
    const origPageCount = ctx.originalDoc.getPageCount();
    if (origIdx >= origPageCount) {
      return fail<ApplyOpError>(
        'op_apply_failed',
        `insert original: originalIndex ${origIdx} out of range (origPageCount=${origPageCount})`,
      );
    }
    try {
      const copied = await doc.copyPages(ctx.originalDoc, [origIdx]);
      const copiedPage = copied[0];
      if (!copiedPage) {
        return fail<ApplyOpError>('op_apply_failed', `insert original: copyPages returned no page`);
      }
      doc.insertPage(op.atIndex, copiedPage);
    } catch (e) {
      return fail<ApplyOpError>(
        'op_apply_failed',
        `insert original failed: ${(e as Error).message}`,
      );
    }
    ctx.pages = doc.getPages().map((page, currentIndex) => ({ currentIndex, page }));
    return ok(undefined);
  }
  // ---- 'inserted': cross-doc page copy from a different open handle.
  // Phase 3 work — combine / multi-doc bridge. We don't have access to the
  // source handle's bytes inside the engine (the replay function is pure
  // over a SINGLE original-bytes input). Warn and skip; renderer enforces
  // that this variant should not survive Riley's inverse pipeline.
  ctx.warnings.push(
    `insert.source.kind='inserted' is Phase-3 (combine bridge); page-structure op skipped`,
  );
  return ok(undefined);
}

function applyDelete(
  doc: PDFDocument,
  ctx: ReplayContext,
  op: Extract<EditOperation, { kind: 'delete' }>,
): Result<void, ApplyOpError> {
  const n = doc.getPageCount();
  if (op.pageIndex < 0 || op.pageIndex >= n) {
    return fail<ApplyOpError>('op_apply_failed', `delete pageIndex ${op.pageIndex} out of range`);
  }
  try {
    doc.removePage(op.pageIndex);
  } catch (e) {
    return fail<ApplyOpError>('op_apply_failed', `removePage failed: ${(e as Error).message}`);
  }
  ctx.pages = doc.getPages().map((page, currentIndex) => ({ currentIndex, page }));
  return ok(undefined);
}

function applyRotate(
  doc: PDFDocument,
  ctx: ReplayContext,
  op: Extract<EditOperation, { kind: 'rotate' }>,
): Result<void, ApplyOpError> {
  const n = doc.getPageCount();
  if (op.pageIndex < 0 || op.pageIndex >= n) {
    return fail<ApplyOpError>('op_apply_failed', `rotate pageIndex ${op.pageIndex} out of range`);
  }
  try {
    const page = doc.getPage(op.pageIndex);
    page.setRotation(degrees(op.toRotation));
    const ctxEntry = ctx.pages[op.pageIndex];
    if (ctxEntry) ctxEntry.page = page;
  } catch (e) {
    return fail<ApplyOpError>('op_apply_failed', `rotate failed: ${(e as Error).message}`);
  }
  return ok(undefined);
}

// ============================================================================
// Phase-2 image ops
// ============================================================================

async function applyImageInsert(
  doc: PDFDocument,
  ctx: ReplayContext,
  op: Extract<EditOperation, { kind: 'image-insert' }>,
): Promise<Result<void, ApplyOpError>> {
  const n = doc.getPageCount();
  if (op.atIndex < 0 || op.atIndex > n) {
    return fail<ApplyOpError>('op_apply_failed', `image-insert atIndex ${op.atIndex} out of range`);
  }
  const embedRes = await embedImage(doc, ctx.imageCache, op.image);
  if (!embedRes.ok) {
    if (embedRes.error === 'image_decode_failed' || embedRes.error === 'tiff_decode_failed') {
      return fail<ApplyOpError>('image_decode_failed', embedRes.message);
    }
    return fail<ApplyOpError>('op_apply_failed', embedRes.message);
  }
  ctx.warnings.push(...embedRes.value.warnings);
  const { width: pageWidth, height: pageHeight } = computeNewPageSize(
    op.image.width,
    op.image.height,
  );
  try {
    const page = doc.insertPage(op.atIndex, [pageWidth, pageHeight]);
    page.drawImage(embedRes.value.image, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
  } catch (e) {
    return fail<ApplyOpError>('op_apply_failed', `image-insert failed: ${(e as Error).message}`);
  }
  ctx.pages = doc.getPages().map((page, currentIndex) => ({ currentIndex, page }));
  return ok(undefined);
}

function applyImageOverlay(
  doc: PDFDocument,
  ctx: ReplayContext,
  op: Extract<EditOperation, { kind: 'image-overlay' }>,
): Result<void, ApplyOpError> {
  const n = doc.getPageCount();
  if (op.pageIndex < 0 || op.pageIndex >= n) {
    return fail<ApplyOpError>(
      'op_apply_failed',
      `image-overlay pageIndex ${op.pageIndex} out of range`,
    );
  }
  if (!isValidRect(op.rect)) {
    return fail<ApplyOpError>('op_apply_failed', `image-overlay invalid rect`);
  }
  ctx.liveOverlays.set(op.overlayId, {
    pageIndex: op.pageIndex,
    rect: op.rect,
    image: op.image,
  });
  return ok(undefined);
}

function applyImageOverlayEdit(
  ctx: ReplayContext,
  op: Extract<EditOperation, { kind: 'image-overlay-edit' }>,
): Result<void, ApplyOpError> {
  if (!isValidRect(op.afterRect)) {
    return fail<ApplyOpError>('op_apply_failed', `image-overlay-edit invalid afterRect`);
  }
  const entry = ctx.liveOverlays.get(op.overlayId);
  if (!entry) {
    return fail<ApplyOpError>('op_apply_failed', `overlay ${op.overlayId} not found`);
  }
  entry.rect = op.afterRect;
  return ok(undefined);
}

function applyImageOverlayDelete(
  ctx: ReplayContext,
  op: Extract<EditOperation, { kind: 'image-overlay-delete' }>,
): Result<void, ApplyOpError> {
  ctx.liveOverlays.delete(op.overlayId);
  return ok(undefined);
}

// ============================================================================
// Annotation emit (edit-replay-engine.md §5)
// ============================================================================

function isDirtyOrUnsaved(a: AnnotationModelSerialized): boolean {
  return a.dirty === true || a.pdfObjectNumber === undefined;
}

function emitAnnotation(
  doc: PDFDocument,
  ctx: ReplayContext,
  a: AnnotationModel,
): Result<{ objectNumber: number | null }, string> {
  const ctxEntry = ctx.pages[a.pageIndex];
  if (!ctxEntry) {
    return fail<string>(
      'op_apply_failed',
      `annotation ${a.id} pageIndex ${a.pageIndex} out of range`,
    );
  }
  try {
    const page = ctxEntry.page;
    switch (a.subtype) {
      case 'Highlight':
      case 'Underline':
      case 'StrikeOut': {
        page.drawRectangle({
          x: a.rect.x,
          y: a.rect.y,
          width: a.rect.width,
          height: a.subtype === 'Highlight' ? a.rect.height : 1,
          color: rgb(a.color.r / 255, a.color.g / 255, a.color.b / 255),
          opacity: a.subtype === 'Highlight' ? a.opacity * 0.4 : a.opacity,
        });
        break;
      }
      case 'Text':
      case 'FreeText': {
        page.drawRectangle({
          x: a.rect.x,
          y: a.rect.y,
          width: a.rect.width,
          height: a.rect.height,
          borderColor: rgb(a.color.r / 255, a.color.g / 255, a.color.b / 255),
          borderWidth: 1,
          opacity: a.opacity,
        });
        if (a.contents) {
          // Renderer is the source of truth for font rendering; we draw a
          // marker rect — the actual /FreeText annotation appearance stream
          // is Phase-3 work. Document loudly.
        }
        break;
      }
      case 'Ink': {
        if (a.ink && a.ink.paths.length > 0) {
          for (const path of a.ink.paths) {
            if (path.length < 2) continue;
            for (let i = 1; i < path.length; i += 1) {
              const p0 = path[i - 1];
              const p1 = path[i];
              if (!p0 || !p1) continue;
              page.drawLine({
                start: { x: p0.x, y: p0.y },
                end: { x: p1.x, y: p1.y },
                thickness: 1.5,
                color: rgb(a.color.r / 255, a.color.g / 255, a.color.b / 255),
                opacity: a.opacity,
              });
            }
          }
        }
        break;
      }
      case 'Square':
      case 'Circle':
      case 'Line':
      case 'Polygon':
      case 'PolyLine':
      case 'FreeTextCallout':
        // Phase-4 shape subtypes ride the dedicated `annot-add-shape` op +
        // `ShapeAnnotationModel` (data-models §9.3 + §9.7) and are emitted
        // by replay step 3.8 via shape-annotations.ts. The legacy
        // AnnotationModel path here is the Phase-1/2 surface only; if a
        // Phase-1 AnnotationModel ends up with one of these subtypes we
        // skip emit and warn (the renderer's authoring lives in shapes-
        // slice, not annotations-slice).
        ctx.warnings.push(
          `Phase-4 subtype '${a.subtype}' rides annot-add-shape (step 3.8); skipping legacy emit`,
        );
        return ok({ objectNumber: null });
      default: {
        const exhaustive: never = a.subtype;
        void exhaustive;
        return fail<string>('op_apply_failed', `unknown subtype: ${String(a.subtype)}`);
      }
    }
  } catch (e) {
    return fail<string>('op_apply_failed', `emit ${a.subtype} threw: ${(e as Error).message}`);
  }
  // pdf-lib's drawn shapes don't surface as /Annots — Phase 2 ships the
  // drawing approach; Phase 3 upgrades to true /Annots. We return null for
  // the object number; renderer keeps `dirty=true` on these annotations until
  // Phase 3 ships the appearance-stream-emit path.
  return ok({ objectNumber: null });
}

// ============================================================================
// Utilities
// ============================================================================

function isValidRect(r: PdfRect | null | undefined): r is PdfRect {
  if (!r) return false;
  if (
    !Number.isFinite(r.x) ||
    !Number.isFinite(r.y) ||
    !Number.isFinite(r.width) ||
    !Number.isFinite(r.height)
  ) {
    return false;
  }
  if (r.width <= 0 || r.height <= 0) return false;
  return true;
}

function emitProgress(input: ReplayInput, phase: ReplayPhase, percent: number): void {
  if (input.onProgress) {
    input.onProgress({ jobId: input.jobId, phase, percent });
  }
}
