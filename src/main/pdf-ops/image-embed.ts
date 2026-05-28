// Image-embed helpers for the Phase-2 replay engine.
//
// Contract: edit-replay-engine.md §7 + §9.4 (content-hash dedup) + §11
// (TIFF boundary).
//
// Pure functions; no FS, no DB, no logging (conventions §13.2). Called by
// the replay engine in step 3 (op fold) for image-insert / image-overlay
// ops, plus by the pdf:embedImage IPC handler for content-hash computation
// at ingest time.

import { createHash } from 'node:crypto';

import type { PDFDocument, PDFImage } from 'pdf-lib';

import type { ImageEmbedPayload, ImageMimeType } from '../../ipc/contracts.js';
import type { Result } from '../../shared/result.js';
import { fail, ok } from '../../shared/result.js';

import { decodeTiff } from './tiff-decoder.js';

export type ImageEmbedError =
  | 'invalid_image'
  | 'image_decode_failed'
  | 'tiff_decode_failed'
  | 'tiff_decoder_unavailable';

/**
 * Compute SHA-256 of an image buffer, lowercase hex. Used by both the
 * pdf:embedImage handler (at ingest) and the replay engine (for cache lookups).
 */
export function computeImageContentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Per-replay-invocation image cache. Keyed by content hash; value is the
 * pdf-lib `PDFImage` once embedded. Dedup is implicit: the engine asks for
 * an embedded image by hash; on cache miss it decodes once and stores.
 */
export class ImageCache {
  private readonly cache = new Map<string, PDFImage>();

  get(contentHash: string): PDFImage | undefined {
    return this.cache.get(contentHash);
  }

  set(contentHash: string, image: PDFImage): void {
    this.cache.set(contentHash, image);
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Embed (or reuse from cache) an image into a pdf-lib document. TIFF is
 * decoded to PNG first (edit-replay-engine.md §11). Returns the cached or
 * freshly-embedded `PDFImage` for `page.drawImage` calls.
 *
 * Also returns a list of decoder warnings (e.g. "multi-page TIFF: first page
 * only used") which the engine surfaces in `ReplayOk.warnings`.
 */
export async function embedImage(
  doc: PDFDocument,
  cache: ImageCache,
  image: ImageEmbedPayload,
): Promise<Result<{ image: PDFImage; warnings: string[] }, ImageEmbedError>> {
  if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength === 0) {
    return fail<ImageEmbedError>('invalid_image', 'image.bytes is empty or not a Uint8Array');
  }

  const cached = cache.get(image.contentHash);
  if (cached) return ok({ image: cached, warnings: [] });

  let bytesForPdfLib: Uint8Array = image.bytes;
  let format: 'png' | 'jpeg' = 'png';
  const warnings: string[] = [];

  switch (image.mimeType) {
    case 'image/png':
      format = 'png';
      break;
    case 'image/jpeg':
      format = 'jpeg';
      break;
    case 'image/tiff': {
      const decoded = await decodeTiff(image.bytes);
      if (!decoded.ok) {
        if (decoded.error === 'tiff_decoder_unavailable') {
          return fail<ImageEmbedError>('tiff_decoder_unavailable', decoded.message);
        }
        return fail<ImageEmbedError>('tiff_decode_failed', decoded.message);
      }
      bytesForPdfLib = decoded.value.bytes;
      format = 'png';
      warnings.push(...decoded.value.warnings);
      break;
    }
    default: {
      const exhaustive: never = image.mimeType;
      void exhaustive;
      return fail<ImageEmbedError>(
        'invalid_image',
        `unsupported mimeType: ${String(image.mimeType)}`,
      );
    }
  }

  let embedded: PDFImage;
  try {
    if (format === 'png') {
      embedded = await doc.embedPng(bytesForPdfLib);
    } else {
      embedded = await doc.embedJpg(bytesForPdfLib);
    }
  } catch (e) {
    return fail<ImageEmbedError>(
      'image_decode_failed',
      `pdf-lib embed${format === 'png' ? 'Png' : 'Jpg'} threw: ${(e as Error).message}`,
    );
  }

  cache.set(image.contentHash, embedded);
  return ok({ image: embedded, warnings });
}

/**
 * Default-page sizing rule per edit-replay-engine.md §4.3 step 4:
 *   "Image native dims, capped at A4 = 595x842 if larger."
 *
 * Returns target page width/height (PDF user-space). Orientation honored
 * when supplied; otherwise derived from image aspect.
 */
export function computeNewPageSize(
  imageWidth: number,
  imageHeight: number,
  orientation?: 'portrait' | 'landscape',
): { width: number; height: number } {
  const A4_LONG = 842;
  const A4_SHORT = 595;

  // Determine intended orientation
  const intrinsicLandscape = imageWidth > imageHeight;
  const orient = orientation ?? (intrinsicLandscape ? 'landscape' : 'portrait');

  const maxW = orient === 'landscape' ? A4_LONG : A4_SHORT;
  const maxH = orient === 'landscape' ? A4_SHORT : A4_LONG;

  // Fit-inside scale
  const scale = Math.min(1, Math.min(maxW / imageWidth, maxH / imageHeight));
  return {
    width: Math.max(1, Math.round(imageWidth * scale)),
    height: Math.max(1, Math.round(imageHeight * scale)),
  };
}

/**
 * Lightweight mimeType detector — used by pdf:embedImage handler to set
 * the ImageEmbedPayload.mimeType from raw bytes when the renderer didn't
 * supply it. Detects only the three Phase-2 formats; returns null otherwise.
 */
export function detectImageMimeType(bytes: Uint8Array): ImageMimeType | null {
  if (bytes.byteLength < 4) return null;
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // TIFF: II*\0 or MM\0*
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) {
    return 'image/tiff';
  }
  return null;
}
