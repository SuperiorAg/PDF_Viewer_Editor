// Handler: pdf:embedImage
//
// Phase 2 (api-contracts.md §12.1). Ingests image bytes from the renderer,
// computes the content-hash for dedup, builds an EditOperation
// (image-insert or image-overlay) and returns it. The renderer dispatches
// applyEdit(op) — the engine applies the op at save time.
//
// The handler is PURE w.r.t. the document (per conventions §13.1 step 3d) —
// it doesn't mutate doc state, only hashes bytes and constructs an op.

import { randomUUID } from 'node:crypto';

import { computeImageContentHash, detectImageMimeType } from '../../main/pdf-ops/image-embed.js';
import { decodeTiff } from '../../main/pdf-ops/tiff-decoder.js';
import { fail, ok } from '../../shared/result.js';
import type {
  EditOperation,
  EditOperationSerialized,
  DocumentHandle,
  ImageEmbedPayload,
  PdfEmbedImageError,
  PdfEmbedImageRequest,
  PdfEmbedImageResponse,
  PdfEmbedImageValue,
} from '../contracts.js';

const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB sanity ceiling (edit-replay-engine.md §11.2)

export interface PdfEmbedImageDeps {
  hasHandle(handle: DocumentHandle): boolean;
}

export async function handlePdfEmbedImage(
  req: PdfEmbedImageRequest,
  deps: PdfEmbedImageDeps,
): Promise<PdfEmbedImageResponse> {
  // ---- Validate ----------------------------------------------------------
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<PdfEmbedImageError>('invalid_payload', 'handle must be an integer');
  }
  if (!deps.hasHandle(req.handle)) {
    return fail<PdfEmbedImageError>('handle_not_found', `handle ${req.handle} not found`);
  }
  if (!req.image || !(req.image.bytes instanceof Uint8Array) || req.image.bytes.byteLength === 0) {
    return fail<PdfEmbedImageError>(
      'invalid_payload',
      'image.bytes must be a non-empty Uint8Array',
    );
  }
  if (req.image.bytes.byteLength > MAX_IMAGE_BYTES) {
    return fail<PdfEmbedImageError>('invalid_payload', `image exceeds ${MAX_IMAGE_BYTES} bytes`);
  }
  // mimeType from request OR sniff
  const sniffed = detectImageMimeType(req.image.bytes);
  const mimeType = req.image.mimeType ?? sniffed;
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/tiff') {
    return fail<PdfEmbedImageError>(
      'invalid_payload',
      `unsupported mimeType (got ${String(req.image.mimeType)}, sniffed ${String(sniffed)})`,
    );
  }
  if (!Number.isFinite(req.image.width) || !Number.isFinite(req.image.height)) {
    return fail<PdfEmbedImageError>('invalid_payload', 'image width/height must be finite numbers');
  }
  if (req.image.width <= 0 || req.image.height <= 0) {
    return fail<PdfEmbedImageError>('invalid_payload', 'image width/height must be > 0');
  }

  if (!req.placement || (req.placement.kind !== 'new-page' && req.placement.kind !== 'overlay')) {
    return fail<PdfEmbedImageError>('invalid_payload', 'placement.kind must be new-page|overlay');
  }

  // ---- Pre-decode TIFF early so the renderer gets actionable error toasts.
  const warnings: string[] = [];
  if (mimeType === 'image/tiff') {
    const decoded = await decodeTiff(req.image.bytes);
    if (!decoded.ok) {
      return fail<PdfEmbedImageError>('tiff_decode_failed', decoded.message);
    }
    warnings.push(...decoded.value.warnings);
  }

  // ---- Compute content hash (sha256) -------------------------------------
  const contentHash = computeImageContentHash(req.image.bytes);

  const payload: ImageEmbedPayload = {
    bytes: req.image.bytes,
    mimeType,
    width: req.image.width,
    height: req.image.height,
    contentHash,
  };

  // ---- Build the EditOperation -------------------------------------------
  const meta = {
    ts: Date.now(),
    undoable: true as const,
    operationId: randomUUID(),
  };

  let op: EditOperation;
  if (req.placement.kind === 'new-page') {
    if (!Number.isInteger(req.placement.atIndex) || req.placement.atIndex < 0) {
      return fail<PdfEmbedImageError>('out_of_range', 'placement.atIndex must be >= 0');
    }
    op = {
      kind: 'image-insert',
      meta,
      atIndex: req.placement.atIndex,
      image: payload,
    };
  } else {
    if (!Number.isInteger(req.placement.pageIndex) || req.placement.pageIndex < 0) {
      return fail<PdfEmbedImageError>('out_of_range', 'placement.pageIndex must be >= 0');
    }
    const rect = req.placement.rect;
    if (
      !rect ||
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return fail<PdfEmbedImageError>('invalid_payload', 'placement.rect invalid');
    }
    op = {
      kind: 'image-overlay',
      meta,
      pageIndex: req.placement.pageIndex,
      rect,
      image: payload,
      overlayId: req.placement.overlayId ?? randomUUID(),
    };
  }

  const value: PdfEmbedImageValue = {
    op: op as EditOperationSerialized,
    contentHash,
    warnings,
  };
  return ok(value);
}
