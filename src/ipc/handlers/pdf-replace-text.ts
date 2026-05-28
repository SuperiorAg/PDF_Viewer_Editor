// Handler: pdf:replaceText
//
// Phase 2 (api-contracts.md §12.2). Validates a text-replace request and
// returns the EditOperation for the renderer to dispatch. The actual
// content-stream mutation happens at save time inside the replay engine
// (edit-replay-engine.md §4.6).
//
// The handler is PURE w.r.t. the document. It validates the objectId
// shape, computes the current text (returned in EditOperation.oldText for
// undo), and reports willClip via a width comparison against a Helvetica
// fallback (Phase-2 conservative; original-font glyph checks land in the
// engine at save time).

import { randomUUID } from 'node:crypto';

import { parseObjectId } from '../../main/pdf-ops/text-replace.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  EditOperation,
  EditOperationSerialized,
  PdfReplaceTextError,
  PdfReplaceTextRequest,
  PdfReplaceTextResponse,
  PdfReplaceTextValue,
} from '../contracts.js';

const MAX_REPLACE_TEXT_LEN = 5_000;

export interface PdfReplaceTextDeps {
  hasHandle(handle: DocumentHandle): boolean;
  /**
   * Look up the current text + bbox for an objectId; returns null if not
   * resolvable (Phase-2 conservative — the engine's text-run scanner is a
   * Phase-2.5 upgrade, so this typically returns null and the handler
   * sets oldText=''). The renderer-side cache from a prior
   * pdf:identifyTextSpan call MAY be passed back through this RPC in
   * Phase 2.5, but Phase 2 keeps the handler ignorant.
   */
  resolveTextSpan(
    handle: DocumentHandle,
    pageIndex: number,
    objectId: string,
  ): {
    currentText: string;
    boundingRect: { x: number; y: number; width: number; height: number };
    fontSize: number;
  } | null;
}

export async function handlePdfReplaceText(
  req: PdfReplaceTextRequest,
  deps: PdfReplaceTextDeps,
): Promise<PdfReplaceTextResponse> {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<PdfReplaceTextError>('invalid_payload', 'handle must be an integer');
  }
  if (!deps.hasHandle(req.handle)) {
    return fail<PdfReplaceTextError>('handle_not_found', `handle ${req.handle} not found`);
  }
  if (!Number.isInteger(req.pageIndex) || req.pageIndex < 0) {
    return fail<PdfReplaceTextError>('out_of_range', 'pageIndex must be a non-negative integer');
  }
  if (typeof req.objectId !== 'string' || req.objectId.length === 0) {
    return fail<PdfReplaceTextError>('invalid_payload', 'objectId must be a non-empty string');
  }
  if (!parseObjectId(req.objectId)) {
    return fail<PdfReplaceTextError>(
      'invalid_payload',
      `objectId '${req.objectId}' is malformed; expected 'P/C/R'`,
    );
  }
  if (typeof req.newText !== 'string') {
    return fail<PdfReplaceTextError>('invalid_payload', 'newText must be a string');
  }
  if (req.newText.length > MAX_REPLACE_TEXT_LEN) {
    return fail<PdfReplaceTextError>(
      'invalid_payload',
      `newText too long (>${MAX_REPLACE_TEXT_LEN})`,
    );
  }

  // Look up current text + bbox (may be null per the docstring above).
  const located = deps.resolveTextSpan(req.handle, req.pageIndex, req.objectId);

  const op: EditOperation = {
    kind: 'text-replace',
    meta: {
      ts: Date.now(),
      undoable: true,
      operationId: randomUUID(),
    },
    pageIndex: req.pageIndex,
    objectId: req.objectId,
    oldText: located ? located.currentText : '',
    newText: req.newText,
  };

  // Phase-2 willClip computation: approximate using 0.5pt-per-char as a
  // conservative ratio when the renderer doesn't pass glyph metrics. The
  // renderer's text-edit overlay already did the real measurement with
  // cached glyph widths (architecture-phase-2.md §4.3); this is a safety
  // net for callers who skipped the renderer-side check.
  let willClip = false;
  let overflowPt: number | undefined;
  if (located) {
    const approxFontSize = located.fontSize > 0 ? located.fontSize : 12;
    const approxNewWidth = req.newText.length * approxFontSize * 0.5;
    if (approxNewWidth > located.boundingRect.width) {
      willClip = true;
      overflowPt = approxNewWidth - located.boundingRect.width;
    }
  }

  const value: PdfReplaceTextValue = {
    op: op as EditOperationSerialized,
    willClip,
    ...(overflowPt !== undefined ? { overflowPt } : {}),
  };
  return ok(value);
}
