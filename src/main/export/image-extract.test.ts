// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  OPS_NAMES,
  createImageExtractor,
  type ImageResolver,
  type PdfImageObject,
  type PdfOperatorList,
  type PngEncoder,
} from './image-extract.js';

const PAGE = { widthPt: 612, heightPt: 792 };

/** Test PNG encoder that returns a deterministic byte sequence + dims. */
const pngEncoder: PngEncoder = (rgba, w, h) => {
  // Return a fixed-prefix byte buffer with embedded dims so tests can assert.
  const out = new Uint8Array(8 + 8 + Math.min(rgba.length, 8));
  out[0] = 0x89;
  out[1] = 0x50;
  out[2] = 0x4e;
  out[3] = 0x47;
  out[4] = 0x0d;
  out[5] = 0x0a;
  out[6] = 0x1a;
  out[7] = 0x0a;
  out[8] = (w >>> 24) & 0xff;
  out[9] = (w >>> 16) & 0xff;
  out[10] = (w >>> 8) & 0xff;
  out[11] = w & 0xff;
  out[12] = (h >>> 24) & 0xff;
  out[13] = (h >>> 16) & 0xff;
  out[14] = (h >>> 8) & 0xff;
  out[15] = h & 0xff;
  out.set(rgba.subarray(0, Math.min(rgba.length, 8)), 16);
  return out;
};

function resolver(map: Record<string, PdfImageObject>): ImageResolver {
  return {
    get(name) {
      return map[name] ?? null;
    },
  };
}

function rgbObj(w: number, h: number, fill = 100): PdfImageObject {
  const data = new Uint8Array(w * h * 3).fill(fill);
  return { data, width: w, height: h, kind: 'rgb' };
}

function rgbaObj(w: number, h: number): PdfImageObject {
  const data = new Uint8Array(w * h * 4).fill(128);
  return { data, width: w, height: h, kind: 'rgba' };
}

describe('image-extract (export-engine.md §3.6)', () => {
  const extract = createImageExtractor(pngEncoder);

  it('extracts a single XObject image at the CTM-determined rect', () => {
    // CTM: scale 100 x 100, translate (50, 200) → image rect = (50,200,100,100)
    const opList: PdfOperatorList = {
      fnArray: [
        OPS_NAMES.save,
        OPS_NAMES.transform,
        OPS_NAMES.paintImageXObject,
        OPS_NAMES.restore,
      ],
      argsArray: [[], [100, 0, 0, 100, 50, 200], ['Im0'], []],
    };
    const objs = resolver({ Im0: rgbObj(64, 64) });
    const imgs = extract.extract(opList, objs, PAGE);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.widthPx).toBe(64);
    expect(imgs[0]!.heightPx).toBe(64);
    expect(imgs[0]!.rect).not.toBeNull();
    expect(imgs[0]!.rect!.x).toBe(50);
    expect(imgs[0]!.rect!.y).toBe(200);
    expect(imgs[0]!.rect!.w).toBeCloseTo(100, 5);
    expect(imgs[0]!.rect!.h).toBeCloseTo(100, 5);
    expect(imgs[0]!.bytes[0]).toBe(0x89); // PNG header
  });

  it('respects save/restore — CTM resets after restore', () => {
    // After restore the CTM goes back to identity. A second transform OUTSIDE
    // the save/restore block must therefore start from identity (NOT from the
    // pre-restore matrix). To prove this we apply two different transforms:
    //   • Inside save/restore: scale 100 × translate (50,50)  → rect (50,50,100,100)
    //   • After restore: scale 60 × translate (10,10)         → rect (10,10,60,60)
    // If the restore did NOT reset the CTM, the second image's rect would
    // include the pre-restore translation (e.g. x ≈ 60, not 10).
    const opList: PdfOperatorList = {
      fnArray: [
        OPS_NAMES.save,
        OPS_NAMES.transform,
        OPS_NAMES.paintImageXObject,
        OPS_NAMES.restore,
        OPS_NAMES.transform,
        OPS_NAMES.paintImageXObject,
      ],
      argsArray: [[], [100, 0, 0, 100, 50, 50], ['Im0'], [], [60, 0, 0, 60, 10, 10], ['Im1']],
    };
    const objs = resolver({
      Im0: rgbObj(32, 32),
      Im1: rgbObj(32, 32),
    });
    const imgs = extract.extract(opList, objs, PAGE);
    expect(imgs).toHaveLength(2);
    expect(imgs[0]!.rect!.x).toBe(50);
    expect(imgs[0]!.rect!.y).toBe(50);
    // Second image — restore must have reset to identity before the second
    // transform applied. The post-restore rect is (10,10,60,60).
    expect(imgs[1]!.rect!.x).toBe(10);
    expect(imgs[1]!.rect!.y).toBe(10);
  });

  it('skips images below 8x8 px (decorative bullet threshold)', () => {
    const opList: PdfOperatorList = {
      fnArray: [OPS_NAMES.transform, OPS_NAMES.paintImageXObject],
      argsArray: [[100, 0, 0, 100, 0, 0], ['tiny']],
    };
    const objs = resolver({ tiny: rgbObj(4, 4) });
    const imgs = extract.extract(opList, objs, PAGE);
    expect(imgs).toHaveLength(0);
  });

  it('skips images below 16 pt² area (CTM-area threshold)', () => {
    const opList: PdfOperatorList = {
      fnArray: [OPS_NAMES.transform, OPS_NAMES.paintImageXObject],
      argsArray: [[2, 0, 0, 2, 0, 0], ['Im0']], // 2x2 area = 4 pt²
    };
    const objs = resolver({ Im0: rgbObj(64, 64) });
    const imgs = extract.extract(opList, objs, PAGE);
    expect(imgs).toHaveLength(0);
  });

  it('handles RGBA images', () => {
    const opList: PdfOperatorList = {
      fnArray: [OPS_NAMES.transform, OPS_NAMES.paintImageXObject],
      argsArray: [[80, 0, 0, 80, 0, 0], ['rgba']],
    };
    const objs = resolver({ rgba: rgbaObj(16, 16) });
    const imgs = extract.extract(opList, objs, PAGE);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.widthPx).toBe(16);
  });

  it('handles inline images (paintInlineImageXObject)', () => {
    const opList: PdfOperatorList = {
      fnArray: [OPS_NAMES.transform, OPS_NAMES.paintInlineImageXObject],
      argsArray: [[80, 0, 0, 80, 0, 0], [rgbObj(16, 16, 50)]],
    };
    const imgs = extract.extract(opList, resolver({}), PAGE);
    expect(imgs).toHaveLength(1);
  });

  it('returns empty array when no images present', () => {
    const opList: PdfOperatorList = {
      fnArray: [OPS_NAMES.save, OPS_NAMES.restore],
      argsArray: [[], []],
    };
    expect(extract.extract(opList, resolver({}), PAGE)).toEqual([]);
  });

  it('skips unknown XObject names gracefully', () => {
    const opList: PdfOperatorList = {
      fnArray: [OPS_NAMES.transform, OPS_NAMES.paintImageXObject],
      argsArray: [[100, 0, 0, 100, 0, 0], ['Unknown']],
    };
    const imgs = extract.extract(opList, resolver({}), PAGE);
    expect(imgs).toHaveLength(0);
  });
});
