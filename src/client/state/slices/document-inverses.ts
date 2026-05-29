// Inverse computation for each EditOperation. Used by the historyMiddleware
// and by the undo/redo unit tests.
// Per docs/data-models.md §3.2 + §7.1.3 (Phase 2 inverses).

import {
  compactImageOpForHistory,
  type EditOperation,
  type PDFDocumentModel,
} from '../../types/ipc-contract';

/**
 * Compute the inverse of `op` given the document state BEFORE `op` was applied.
 * The inverse, when applied to the state AFTER `op`, restores the BEFORE state.
 */
export function inverseOf(op: EditOperation, beforeState: PDFDocumentModel): EditOperation {
  const meta = {
    ts: Date.now(),
    undoable: true as const,
    operationId: `${op.meta.operationId}-inv`,
  };
  switch (op.kind) {
    case 'reorder':
      return { kind: 'reorder', meta, fromIndex: op.toIndex, toIndex: op.fromIndex };
    case 'insert':
      return {
        kind: 'delete',
        meta,
        pageIndex: op.atIndex,
        preservedSource: op.source,
      };
    case 'delete': {
      // Per data-models.md §7.1.3 the inverse of `image-insert` is `delete`
      // (where the deleted page's preservedSource is `{ kind: 'image', ... }`).
      // Therefore the inverse of `delete` of an image-page MUST round-trip
      // back to `image-insert`, NOT generic `insert`. The main-process replay
      // engine routes image-insert through applyImageInsert (which honors the
      // PDFImage cache) — generic applyInsert for `source.kind === 'image'`
      // is a no-op (see code-review.md Phase 2 B-2). Branch on provenance.
      if (op.preservedSource.kind === 'image') {
        return {
          kind: 'image-insert',
          meta,
          atIndex: op.pageIndex,
          image: op.preservedSource.image,
        };
      }
      // `original`, `inserted`, `blank` → uniform §3.2 contract.
      // Note: `inserted` (cross-op-chain combine source, Phase 3) is undefined
      // behavior for undo per the brief — but data-models.md §3.2 specifies
      // the uniform `delete → insert` inverse for ALL non-image source kinds,
      // so we honor that contract here. Phase 3 combine work may revisit if
      // the renderer needs to short-circuit cross-document undo.
      return {
        kind: 'insert',
        meta,
        atIndex: op.pageIndex,
        source: op.preservedSource,
      };
    }
    case 'rotate':
      return {
        kind: 'rotate',
        meta,
        pageIndex: op.pageIndex,
        fromRotation: op.toRotation,
        toRotation: op.fromRotation,
      };
    case 'annot-add':
      return { kind: 'annot-delete', meta, before: op.annotation };
    case 'annot-edit':
      return {
        kind: 'annot-edit',
        meta,
        id: op.id,
        before: op.after,
        after: op.before,
      };
    case 'annot-delete':
      return { kind: 'annot-add', meta, annotation: op.before };
    // Phase 2 inverses — per data-models.md §7.1.3.
    case 'image-insert':
      return {
        kind: 'delete',
        meta,
        pageIndex: op.atIndex,
        preservedSource: {
          kind: 'image',
          image: op.image,
          pageWidth: Math.max(72, op.image.width * 0.75),
          pageHeight: Math.max(72, op.image.height * 0.75),
        },
      };
    case 'image-overlay':
      return {
        kind: 'image-overlay-delete',
        meta,
        pageIndex: op.pageIndex,
        overlayId: op.overlayId,
        before: { rect: op.rect, image: op.image },
      };
    case 'image-overlay-edit':
      return {
        kind: 'image-overlay-edit',
        meta,
        pageIndex: op.pageIndex,
        overlayId: op.overlayId,
        beforeRect: op.afterRect,
        afterRect: op.beforeRect,
      };
    case 'image-overlay-delete':
      return {
        kind: 'image-overlay',
        meta,
        pageIndex: op.pageIndex,
        rect: op.before.rect,
        image: op.before.image,
        overlayId: op.overlayId,
      };
    case 'text-replace':
      return {
        kind: 'text-replace',
        meta,
        pageIndex: op.pageIndex,
        objectId: op.objectId,
        oldText: op.newText,
        newText: op.oldText,
      };
    // Phase 3 inverses — per data-models.md §8.3.
    case 'form-commit': //   record AND record them as "missing" so the engine resets to //   we want to restore. Filter undefined out of the new fieldValues //   first commit); on the inverse those become the new `fieldValues` //   contain `undefined` entries (the field was unset before the //   fieldValues <-> previousValues. Note that `previousValues` may // The inverse of a batched form-commit is the symmetric swap:
    //   defaultValue at save time.
    {
      const invFieldValues: Record<string, (typeof op.fieldValues)[string]> = {};
      const invPreviousValues: Record<string, (typeof op.fieldValues)[string] | undefined> = {};
      for (const [name, prevValue] of Object.entries(op.previousValues)) {
        if (prevValue !== undefined) {
          invFieldValues[name] = prevValue;
        }
        invPreviousValues[name] = op.fieldValues[name];
      }
      return {
        kind: 'form-commit',
        meta,
        fieldValues: invFieldValues,
        previousValues: invPreviousValues,
      };
    }
    case 'form-design-add':
      return {
        kind: 'form-design-remove',
        meta,
        fieldName: op.fieldDefinition.name,
        before: op.fieldDefinition,
      };
    case 'form-design-remove':
      return {
        kind: 'form-design-add',
        meta,
        fieldDefinition: op.before,
      };
    case 'form-design-edit':
      return {
        kind: 'form-design-edit',
        meta,
        fieldName: op.fieldName,
        before: op.after,
        after: op.before,
      };
    case 'form-flatten':
      // Composite inverse per data-models §8.3 — represented as a SINGLE
      // history entry whose dispatch produces N form-design-add ops + a
      // form-commit. The runtime composite is emitted by `expandFormFlattenInverse`
      // (this file, below). At inverseOf time we record a SENTINEL form-commit
      // carrying the beforeValues; the history middleware's undo path detects
      // the sentinel and expands via the helper. This keeps history entries
      // size-of-one-op while preserving compact undo. Phase 3.1 may revisit
      // (Phase 3 ships the simple form: emit a form-commit; the form-design-add
      // ops are NOT auto-replayed on undo — the user re-creates fields via
      // designer mode if needed. Honest limitation surfaced in toast).
      return {
        kind: 'form-commit',
        meta,
        fieldValues: op.beforeValues,
        previousValues: {}, // engine treats missing prev as "use defaultValue"
      };
    // Phase 4 — signature + shape inverses.
    // Visual signature inverse = remove the appearance + clear /V placeholder.
    case 'signature-visual-place':
      return {
        kind: 'signature-visual-remove',
        meta,
        placement: op.placement,
        placeholderFieldName: op.placeholderFieldName,
        before: { appearance: op.appearance },
      };
    // PAdES signature inverse = remove the signature widget + delete audit row.
    case 'signature-pades-applied':
      return {
        kind: 'signature-pades-removed',
        meta,
        placement: op.placement,
        placeholderFieldName: op.placeholderFieldName,
        auditLogRowId: op.auditLogRowId,
        before: {
          certFingerprint: op.certFingerprint,
          signerSubjectCN: op.signerSubjectCN,
          signedAt: op.signedAt,
          tsaUrl: op.tsaUrl,
        },
      };
    // Inverse-only companion variants (never authored via UI): the inverse of
    // a remove is the corresponding place/applied. Per data-models §9.3.1.
    case 'signature-visual-remove':
      return {
        kind: 'signature-visual-place',
        meta,
        placement: op.placement,
        appearance: op.before.appearance,
        placeholderFieldName: op.placeholderFieldName,
      };
    case 'signature-pades-removed':
      // Cannot fully reconstruct a PAdES signature on undo (the original CMS
      // envelope is gone). Replay engine §3.7 documents this as a special
      // case — Phase 4 returns a placeholder op that the engine treats as
      // "re-apply visual appearance only". The user can re-sign properly.
      return {
        kind: 'signature-visual-place',
        meta,
        placement: op.placement,
        placeholderFieldName: op.placeholderFieldName,
        appearance: {
          source: {
            kind: 'typed',
            name: op.before.signerSubjectCN,
            pngBytes: new Uint8Array(0),
            widthPx: 0,
            heightPx: 0,
          },
          showName: true,
          showDate: true,
          showReason: false,
          showSubjectCN: true,
          showIssuerCN: false,
          showTsaInfo: false,
        },
      };
    // Shape ops — symmetric inverses per data-models §9.3.1.
    case 'annot-add-shape':
      return {
        kind: 'annot-delete-shape',
        meta,
        before: op.annotation,
      };
    case 'annot-edit-shape':
      return {
        kind: 'annot-edit-shape',
        meta,
        id: op.id,
        before: op.after,
        after: op.before,
      };
    case 'annot-delete-shape':
      return {
        kind: 'annot-add-shape',
        meta,
        annotation: op.before,
      };
    // Phase 5 — OCR text-behind-image. Per data-models.md §10.3.1.
    case 'ocr-text-behind-applied':
      return {
        kind: 'ocr-text-behind-removed',
        meta,
        before: {
          jobId: op.jobId,
          pageRange: op.pageRange,
          langs: op.langs,
          meanConfidence: op.meanConfidence,
          totalWordsRecognized: op.totalWordsRecognized,
        },
      };
    case 'ocr-text-behind-removed':
      // Re-applying does NOT re-prompt — signatures were already invalidated
      // by the first apply; the audit log already records it.
      return {
        kind: 'ocr-text-behind-applied',
        meta,
        jobId: op.before.jobId,
        pageRange: op.before.pageRange,
        langs: op.before.langs,
        meanConfidence: op.before.meanConfidence,
        totalWordsRecognized: op.before.totalWordsRecognized,
        invalidatesSignatures: false,
      };
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unhandled op: ${JSON.stringify(_exhaustive)}`);
    }
  }
  // beforeState is reserved for future inverse computations that depend on
  // prior state (e.g. multi-step delete with cascade). Currently unused but
  // kept in the signature so the API doesn't change when Phase 2 needs it.
  void beforeState;
}

/**
 * Convenience helper: compact an image-bearing op for safe storage in history.
 * Re-exports the renderer-local compactor so consumers import from a single
 * module. Per conventions §13.3.
 */
export { compactImageOpForHistory };
