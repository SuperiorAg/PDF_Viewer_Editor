// Phase 7.5 Wave 3 — B7 Stamps engine.
//
// Canonical spec: docs/architecture-phase-7.5.md §4.1 (B7 row) +
// docs/api-contracts.md §19.10 (`pdf:applyStamp`).
//
// What this module does:
//   Given a stamp library entry and a placement on a target page, draw the
//   stamp into that page's content stream. Two kinds:
//     - 'text': render the entry's textValue at the requested position +
//        rotation + opacity, in the entry's color, sized to the entry's
//        widthPt / heightPt bounding box.
//     - 'image': embed the stamp's PNG/JPG bytes and drawImage at the
//        requested position with the entry's width/height.
//
// Why content-stream draw, not /Stamp annotation:
//   The original wave brief said "prefer /Stamp annotations (rasterize-on-
//   demand)". pdf-lib's public surface does NOT include a clean Stamp-
//   annotation builder, and rasterize-on-demand requires the pdf.js sidecar
//   (which the Wave 3 engine intentionally avoids — pure pdf-lib only). The
//   content-stream draw path is the same trade-off watermark / header-footer
//   / redact already make and is fully round-trippable: re-opening the PDF
//   shows the stamp because it is in the content stream, not in a viewer-
//   side annotation table. Annotation-based stamps are a Wave 6+ enhancement
//   once an annotation IO helper lands.
//
// Stamp library lookup is delegated to the caller (the IPC handler injects a
// `lookupStamp(stampId)` function that reads from Ravi's stamps_library repo
// or the bundled-builtins map). The engine is pure: no DB access, no fs.

import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

/**
 * Stamp library entry (engine-facing). The IPC handler maps Ravi's
 * `StampsLibraryRow` (snake_case) onto this shape AND resolves any
 * BUILTIN:<key> image_path placeholder to the actual bytes (from a bundled
 * stamps directory). For v0.8.0 all builtin stamps are TEXT so the
 * `imageBytes` field is unused for them — but the engine accepts it so a
 * future built-in image stamp doesn't need an engine change.
 */
export interface StampEntry {
  id: number;
  /** `'builtin:...'` for built-ins, null for user-added. */
  builtinKey: string | null;
  kind: 'text' | 'image';
  textValue: string | null;
  /**
   * For image stamps: the actual PNG/JPG bytes. Handler resolves from disk
   * (user stamps) or from the bundled stamps directory (built-ins).
   */
  imageBytes: Uint8Array | null;
  widthPt: number;
  heightPt: number;
  color: string | null; // text only; #RRGGBB
}

export interface StampPlacement {
  pageIndex: number;
  xPt: number;
  yPt: number;
  rotationDegrees: number;
  /** 0..1. */
  opacity: number;
}

export interface ApplyStampOptions {
  pdfBytes: Uint8Array;
  stamp: StampEntry;
  placement: StampPlacement;
}

export type ApplyStampError =
  | 'pdf_load_failed'
  | 'invalid_payload'
  | 'page_out_of_range'
  | 'image_invalid'
  | 'engine_failed';

export interface ApplyStampValue {
  bytes: Uint8Array;
  /** Stable identifier (handler-supplied prefix + stamp id) for renderer undo. */
  annotationId: string;
}

export type ApplyStampResult = Result<ApplyStampValue, ApplyStampError>;

// ============================================================================
// Engine
// ============================================================================

let stampInstanceCounter = 0;

export async function applyStamp(opts: ApplyStampOptions): Promise<ApplyStampResult> {
  const payloadErr = validatePayload(opts);
  if (payloadErr) return fail<ApplyStampError>('invalid_payload', payloadErr);

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<ApplyStampError>('pdf_load_failed', (e as Error).message ?? 'unknown');
  }

  const pageCount = doc.getPageCount();
  if (opts.placement.pageIndex < 0 || opts.placement.pageIndex >= pageCount) {
    return fail<ApplyStampError>(
      'page_out_of_range',
      `pageIndex ${opts.placement.pageIndex} not in [0, ${pageCount})`,
    );
  }

  let page: PDFPage;
  try {
    page = doc.getPage(opts.placement.pageIndex);
  } catch (e) {
    return fail<ApplyStampError>(
      'engine_failed',
      `getPage threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  if (opts.stamp.kind === 'text') {
    let font: PDFFont;
    try {
      font = await doc.embedFont(StandardFonts.HelveticaBold);
    } catch (e) {
      return fail<ApplyStampError>(
        'engine_failed',
        `embedFont threw: ${(e as Error).message ?? 'unknown'}`,
      );
    }
    try {
      drawTextStamp(page, font, opts.stamp, opts.placement);
    } catch (e) {
      return fail<ApplyStampError>(
        'engine_failed',
        `drawText threw: ${(e as Error).message ?? 'unknown'}`,
      );
    }
  } else {
    if (!opts.stamp.imageBytes) {
      return fail<ApplyStampError>('image_invalid', 'image stamp requires imageBytes');
    }
    const embed = await tryEmbedImage(doc, opts.stamp.imageBytes);
    if (!embed.ok) return embed;
    try {
      drawImageStamp(page, embed.value, opts.stamp, opts.placement);
    } catch (e) {
      return fail<ApplyStampError>(
        'engine_failed',
        `drawImage threw: ${(e as Error).message ?? 'unknown'}`,
      );
    }
  }

  let outBytes: Uint8Array;
  try {
    outBytes = await doc.save({ useObjectStreams: true });
  } catch (e) {
    return fail<ApplyStampError>(
      'engine_failed',
      `save threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  stampInstanceCounter = (stampInstanceCounter + 1) % Number.MAX_SAFE_INTEGER;
  return ok<ApplyStampValue>({
    bytes: outBytes,
    annotationId: `${opts.stamp.id}:${stampInstanceCounter}`,
  });
}

// ============================================================================
// Validation
// ============================================================================

function validatePayload(opts: ApplyStampOptions): string | null {
  const s = opts.stamp;
  if (!Number.isFinite(s.widthPt) || s.widthPt <= 0) return 'stamp.widthPt must be positive';
  if (!Number.isFinite(s.heightPt) || s.heightPt <= 0) return 'stamp.heightPt must be positive';
  if (s.kind === 'text') {
    if (typeof s.textValue !== 'string' || s.textValue.length === 0) {
      return 'text stamp requires non-empty textValue';
    }
    if (s.color !== null && !/^#[0-9a-fA-F]{6}$/.test(s.color)) {
      return `stamp.color must be #RRGGBB or null (got ${s.color})`;
    }
  } else if (s.kind === 'image') {
    if (!s.imageBytes || !(s.imageBytes instanceof Uint8Array) || s.imageBytes.byteLength === 0) {
      return 'image stamp requires non-empty imageBytes';
    }
  } else {
    return `unknown stamp kind: ${String((s as { kind: string }).kind)}`;
  }
  const p = opts.placement;
  if (!Number.isInteger(p.pageIndex) || p.pageIndex < 0) {
    return 'placement.pageIndex must be a non-negative integer';
  }
  for (const k of ['xPt', 'yPt', 'rotationDegrees', 'opacity'] as const) {
    if (!Number.isFinite(p[k])) return `placement.${k} must be finite`;
  }
  if (p.opacity < 0 || p.opacity > 1) return 'placement.opacity must be in [0, 1]';
  return null;
}

// ============================================================================
// Draw helpers
// ============================================================================

function drawTextStamp(
  page: PDFPage,
  font: PDFFont,
  stamp: StampEntry,
  placement: StampPlacement,
): void {
  // Size the text to fit the stamp's heightPt (which is the natural cap-height
  // for the built-in "STATUS" stamps). Scale by 0.75 so the rendered glyph is
  // visually balanced against the bounding box (Helvetica's ascent + descent
  // together sum to roughly 1.0 em; we want the visible glyph to be ~0.75 of
  // the heightPt).
  const fontSize = stamp.heightPt * 0.85;
  const colorHex = stamp.color ?? '#C2272D';
  const color = parseHexColor(colorHex);
  page.drawText(stamp.textValue ?? '', {
    x: placement.xPt,
    y: placement.yPt,
    size: fontSize,
    font,
    color: rgb(color.r, color.g, color.b),
    opacity: placement.opacity,
    rotate: degrees(placement.rotationDegrees),
  });
}

function drawImageStamp(
  page: PDFPage,
  image: PDFImage,
  stamp: StampEntry,
  placement: StampPlacement,
): void {
  page.drawImage(image, {
    x: placement.xPt,
    y: placement.yPt,
    width: stamp.widthPt,
    height: stamp.heightPt,
    opacity: placement.opacity,
    rotate: degrees(placement.rotationDegrees),
  });
}

async function tryEmbedImage(
  doc: PDFDocument,
  bytes: Uint8Array,
): Promise<Result<PDFImage, ApplyStampError>> {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpg) {
    return fail<ApplyStampError>('image_invalid', 'image bytes are not PNG or JPEG');
  }
  try {
    const owned = bytes.slice();
    const img = isPng ? await doc.embedPng(owned) : await doc.embedJpg(owned);
    return ok(img);
  } catch (e) {
    return fail<ApplyStampError>(
      'image_invalid',
      `image embed failed: ${(e as Error).message ?? 'unknown'}`,
    );
  }
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}

// ============================================================================
// Test-only reset (instance counter)
// ============================================================================

/** Test-only: reset the in-process stamp-instance counter so test snapshots
 *  are stable. Not exported through the package surface for production. */
export function _resetStampInstanceCounterForTests(): void {
  stampInstanceCounter = 0;
}
