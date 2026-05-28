// Image extractor (Phase 6, export-engine.md §3.6 — Q-C)
//
// Walks a pdf.js-shaped operator list, tracks the CTM stack across
// save/restore/transform ops, and captures images at the time they're painted
// (paintImageXObject / paintInlineImageXObject / paintImageMaskXObject).
//
// The pdf.js OperatorList shape is well-known. We type it minimally here so
// the engine doesn't pull the full pdfjs namespace into types.ts. Production
// wires through pdfjs's actual OPS constants; tests synthesize an OperatorList
// using the OPS_NAMES constants below + a Map<string, Uint8Array> of XObject
// payloads.
//
// Image post-processing (Q-C answer in export-engine.md §3.6.3):
//   - All output images are PNG-encoded Uint8Array (writer's ImageRun /
//     slide.addImage all accept PNG natively).
//   - Caller injects a `pngEncoder` dep (factory returns a function that
//     takes RGBA + dims; production uses @napi-rs/canvas, tests use a
//     synthetic encoder that returns a known PNG byte sequence).
//
// Skip threshold (export-engine.md §3.6.4):
//   - <8x8 pixels OR <16 pt^2 area → discarded (decorative bullets / glyphs).

import type { ExtractedImage, LayoutRect, PageSize } from './types.js';

/** Op-name constants — the small subset pdf.js uses that we care about. */
export const OPS_NAMES = {
  save: 'save',
  restore: 'restore',
  transform: 'transform',
  paintImageXObject: 'paintImageXObject',
  paintInlineImageXObject: 'paintInlineImageXObject',
  paintImageMaskXObject: 'paintImageMaskXObject',
} as const;

export type OpName = (typeof OPS_NAMES)[keyof typeof OPS_NAMES];

export interface PdfOperatorList {
  fnArray: OpName[];
  argsArray: unknown[][];
}

export type RasterKind = 'rgb' | 'rgba' | 'grayscale';

export interface PdfImageObject {
  /** Decoded raster bytes — kind-specific layout (rgb / rgba / grayscale). */
  data: Uint8Array;
  width: number;
  height: number;
  kind: RasterKind;
}

export interface ImageResolver {
  /** XObject lookup for paintImageXObject. Returns null for unknown names. */
  get(name: string): PdfImageObject | null;
}

export type PngEncoder = (rgba: Uint8Array, width: number, height: number) => Uint8Array;

export interface ImageExtractor {
  extract(opList: PdfOperatorList, objs: ImageResolver, pageSize: PageSize): ExtractedImage[];
}

const MIN_PIXELS = 8;
const MIN_AREA_PT2 = 16;

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(m1: Matrix, m2: Matrix): Matrix {
  // m1 * m2 (apply m1 then m2 in PDF convention)
  return {
    a: m1.a * m2.a + m1.b * m2.c,
    b: m1.a * m2.b + m1.b * m2.d,
    c: m1.c * m2.a + m1.d * m2.c,
    d: m1.c * m2.b + m1.d * m2.d,
    e: m1.e * m2.a + m1.f * m2.c + m2.e,
    f: m1.e * m2.b + m1.f * m2.d + m2.f,
  };
}

/** CTM applied to the unit square (0,0)-(1,1) gives the image's PDF-space rect.
 *  In PDF the image is drawn into a 1x1 unit square scaled by the CTM. */
function ctmToRect(ctm: Matrix): LayoutRect {
  // Corners of unit square transformed.
  const pts = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ].map(({ x, y }) => ({
    x: x * ctm.a + y * ctm.c + ctm.e,
    y: x * ctm.b + y * ctm.d + ctm.f,
  }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  if (w * h < MIN_AREA_PT2) return null;
  return { x: minX, y: minY, w, h };
}

/** Convert a raster image to RGBA bytes for the PNG encoder. */
function toRgba(img: PdfImageObject): Uint8Array {
  const px = img.width * img.height;
  const out = new Uint8Array(px * 4);
  switch (img.kind) {
    case 'rgba':
      // already 4-channel — copy.
      out.set(img.data.subarray(0, Math.min(img.data.length, out.length)));
      return out;
    case 'rgb': {
      for (let i = 0; i < px; i++) {
        const si = i * 3;
        const di = i * 4;
        out[di] = img.data[si] ?? 0;
        out[di + 1] = img.data[si + 1] ?? 0;
        out[di + 2] = img.data[si + 2] ?? 0;
        out[di + 3] = 255;
      }
      return out;
    }
    case 'grayscale': {
      for (let i = 0; i < px; i++) {
        const g = img.data[i] ?? 0;
        const di = i * 4;
        out[di] = g;
        out[di + 1] = g;
        out[di + 2] = g;
        out[di + 3] = 255;
      }
      return out;
    }
  }
}

export function createImageExtractor(pngEncoder: PngEncoder): ImageExtractor {
  return {
    extract(opList, objs, _pageSize) {
      const results: ExtractedImage[] = [];
      const stack: Matrix[] = [];
      let ctm: Matrix = { ...IDENTITY };
      const fns = opList.fnArray;
      const args = opList.argsArray;
      for (let i = 0; i < fns.length; i++) {
        const op = fns[i];
        const a = args[i] ?? [];
        switch (op) {
          case OPS_NAMES.save:
            stack.push({ ...ctm });
            break;
          case OPS_NAMES.restore: {
            const prev = stack.pop();
            if (prev) ctm = prev;
            break;
          }
          case OPS_NAMES.transform: {
            // args = [a, b, c, d, e, f]
            const [ta, tb, tc, td, te, tf] = a as [number, number, number, number, number, number];
            ctm = multiply({ a: ta, b: tb, c: tc, d: td, e: te, f: tf }, ctm);
            break;
          }
          case OPS_NAMES.paintImageXObject: {
            const name = String(a[0] ?? '');
            const obj = objs.get(name);
            if (!obj) break;
            if (obj.width < MIN_PIXELS || obj.height < MIN_PIXELS) break;
            const rect = ctmToRect(ctm);
            if (rect === null) break;
            const rgba = toRgba(obj);
            const bytes = pngEncoder(rgba, obj.width, obj.height);
            results.push({
              rect,
              bytes,
              widthPx: obj.width,
              heightPx: obj.height,
            });
            break;
          }
          case OPS_NAMES.paintInlineImageXObject: {
            // Inline image: arg[0] is { data, width, height, kind }.
            const inline = a[0] as PdfImageObject | undefined;
            if (!inline) break;
            if (inline.width < MIN_PIXELS || inline.height < MIN_PIXELS) break;
            const rect = ctmToRect(ctm);
            if (rect === null) break;
            const rgba = toRgba(inline);
            const bytes = pngEncoder(rgba, inline.width, inline.height);
            results.push({
              rect,
              bytes,
              widthPx: inline.width,
              heightPx: inline.height,
            });
            break;
          }
          case OPS_NAMES.paintImageMaskXObject: {
            // Image masks: rasterize the mask against white background.
            // v1 uses the mask alpha as RGB+alpha (grayscale → black on white).
            const name = String(a[0] ?? '');
            const obj = objs.get(name);
            if (!obj) break;
            if (obj.width < MIN_PIXELS || obj.height < MIN_PIXELS) break;
            const rect = ctmToRect(ctm);
            if (rect === null) break;
            const rgba = toRgba(obj);
            const bytes = pngEncoder(rgba, obj.width, obj.height);
            results.push({
              rect,
              bytes,
              widthPx: obj.width,
              heightPx: obj.height,
            });
            break;
          }
          default:
            // ignore — not an image op
            break;
        }
      }
      return results;
    },
  };
}
