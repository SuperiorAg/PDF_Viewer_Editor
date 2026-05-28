// @vitest-environment node
//
// Production pdf.js source-loader test (Phase 6.1, David — Julian M-25.4).
//
// Drives the WHOLE prod source bundle (loader + rasterizer) via a synthetic
// pdf.js module + synthetic canvas factory — no real PDF, no native binding.
// The synthetic module mimics pdf.js's numeric OPS codes, ImageKind enum,
// TextItem shape, operator list, and page.objs store so the translation layer
// (numeric op codes → string OpName, packed grayscale → bytes, TextItem →
// PdfTextItem, constructPath → LineSegments) is exercised end-to-end.

import { describe, expect, it } from 'vitest';

import { OPS_NAMES } from './image-extract.js';
import { createProdPdfJsSource, type PdfJsModule } from './pdfjs-source.js';
import type { ExportJobSpec } from './types.js';

// pdf.js OPS codes (the real numeric values — pinned so the translation is
// proven against the actual codes, not the names).
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  rectangle: 19,
  stroke: 20,
  fillStroke: 24,
  constructPath: 91,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
};

const ImageKind = { GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3 };

function syntheticPdfJs(): PdfJsModule {
  const imXObject = {
    data: new Uint8Array(64 * 64 * 3).fill(120),
    width: 64,
    height: 64,
    kind: ImageKind.RGB_24BPP,
  };
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
    }),
    getTextContent: async () => ({
      items: [
        {
          str: 'Hello',
          transform: [12, 0, 0, 12, 72, 720] as [number, number, number, number, number, number],
          width: 40,
          height: 12,
          fontName: 'Helvetica-Bold',
        },
        // A TextMarkedContent-style item with no transform — must be dropped.
        { type: 'beginMarkedContent' } as unknown as { str?: string },
      ],
    }),
    getOperatorList: async () => ({
      fnArray: [
        OPS.save,
        OPS.transform,
        OPS.paintImageXObject,
        OPS.restore,
        OPS.constructPath,
        OPS.stroke,
      ],
      argsArray: [
        [],
        [100, 0, 0, 100, 50, 200],
        ['Im0'],
        [],
        // constructPath: [subOps, coords] — a rectangle (4 edges).
        [[OPS.rectangle], [10, 20, 100, 50]],
        [],
      ],
    }),
    render: ({ canvasContext }: { canvasContext: { __fill?: number } }) => ({
      promise: (async () => {
        // Simulate pdf.js filling the canvas — write a marker into the ctx.
        canvasContext.__fill = 1;
      })(),
    }),
    objs: {
      get(name: string) {
        return name === 'Im0' ? imXObject : null;
      },
      has(name: string) {
        return name === 'Im0';
      },
    },
    commonObjs: {
      get() {
        return null;
      },
      has() {
        return false;
      },
    },
    cleanup: () => {},
  };
  return {
    getDocument: (_opts: { data: Uint8Array }) => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async (_n: number) => page,
        destroy: async () => {},
      }),
    }),
    OPS: OPS as unknown as PdfJsModule['OPS'],
    ImageKind,
    AnnotationMode: { DISABLE: 0, ENABLE: 1 },
  } as unknown as PdfJsModule;
}

function syntheticCanvas() {
  return (w: number, h: number) => {
    const ctx = {
      __fill: 0,
      getImageData(_x: number, _y: number, gw: number, gh: number) {
        // Return RGBA bytes — fill with the marker so the test can assert real
        // bytes flowed through (not zeros).
        const data = new Uint8ClampedArray(gw * gh * 4).fill(200);
        return { data };
      },
    };
    return {
      width: w,
      height: h,
      getContext: (_k: '2d') => ctx,
    };
  };
}

function spec(over?: Partial<ExportJobSpec>): ExportJobSpec {
  return {
    jobId: 1,
    docHash: 'h',
    sourceBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    pageCount: 1,
    format: 'docx',
    qualityTier: 'layout-preserving',
    pageRange: { start: 0, end: 0 },
    includeAnnotations: false,
    outputPath: '/tmp/out.docx',
    perFormat: { format: 'docx', pageSize: 'auto' },
    ...over,
  };
}

describe('prod pdf.js source loader (Julian M-25.4 wire)', () => {
  function bundle() {
    return createProdPdfJsSource({
      loadPdfJs: async () => syntheticPdfJs(),
      createCanvas: () => syntheticCanvas(),
    });
  }

  it('throws if used before bind()', async () => {
    const { loader } = bundle();
    await expect(loader.getPageSize(0)).rejects.toThrow(/before bind/);
  });

  it('getPageSize returns real viewport dimensions after bind', async () => {
    const { loader } = bundle();
    await loader.bind!(spec());
    const size = await loader.getPageSize(0);
    expect(size).toEqual({ widthPt: 612, heightPt: 792 });
  });

  it('getTextContent extracts real items and drops non-TextItem entries', async () => {
    const { loader } = bundle();
    await loader.bind!(spec());
    const tc = await loader.getTextContent(0);
    expect(tc.items).toHaveLength(1);
    expect(tc.items[0]!.str).toBe('Hello');
    expect(tc.items[0]!.transform).toEqual([12, 0, 0, 12, 72, 720]);
    expect(tc.items[0]!.fontName).toBe('Helvetica-Bold');
  });

  it('getOperatorList translates numeric codes → string OpNames', async () => {
    const { loader } = bundle();
    await loader.bind!(spec());
    const op = await loader.getOperatorList(0);
    // save, transform, paintImageXObject, restore are kept; constructPath +
    // stroke are dropped (not image ops). The image-extract walker reads these.
    expect(op.fnArray).toEqual([
      OPS_NAMES.save,
      OPS_NAMES.transform,
      OPS_NAMES.paintImageXObject,
      OPS_NAMES.restore,
    ]);
    // paintImageXObject arg is the XObject name (resolved later via resolver).
    const idx = op.fnArray.indexOf(OPS_NAMES.paintImageXObject);
    expect(op.argsArray[idx]).toEqual(['Im0']);
  });

  it('getImageResolver resolves a real RGB XObject', async () => {
    const { loader } = bundle();
    await loader.bind!(spec());
    const resolver = await loader.getImageResolver(0);
    const img = resolver.get('Im0');
    expect(img).not.toBeNull();
    expect(img!.width).toBe(64);
    expect(img!.height).toBe(64);
    expect(img!.kind).toBe('rgb');
    expect(resolver.get('Unknown')).toBeNull();
  });

  it('getLineSegments reconstructs rectangle edges from constructPath', async () => {
    const { loader } = bundle();
    await loader.bind!(spec());
    const segs = await loader.getLineSegments(0);
    // A rectangle (10,20,100,50) → 4 edges.
    expect(segs).toHaveLength(4);
    // bottom edge
    expect(segs).toContainEqual({ x1: 10, y1: 20, x2: 110, y2: 20 });
    // left edge
    expect(segs).toContainEqual({ x1: 10, y1: 70, x2: 10, y2: 20 });
  });

  it('rasterize returns real RGBA bytes at the requested DPI', async () => {
    const { rasterize } = bundle();
    const { loader } = bundle();
    // rasterize uses its OWN bundle's active doc — bind that bundle's loader.
    // (Use one bundle for both so they share state.)
    const b = bundle();
    await b.loader.bind!(spec());
    const r = await b.rasterize({ pageIndex: 0, dpi: 144, includeAnnotations: false });
    expect(r.width).toBe(612 * 2); // 144/72 = 2x scale
    expect(r.height).toBe(792 * 2);
    expect(r.rgba.length).toBe(r.width * r.height * 4);
    expect(r.rgba[0]).toBe(200); // real pixel bytes flowed through
    void rasterize;
    void loader;
  });

  it('release() tears the active doc down so subsequent use throws', async () => {
    const { loader } = bundle();
    await loader.bind!(spec());
    await loader.release!();
    await expect(loader.getPageSize(0)).rejects.toThrow(/before bind/);
  });

  it('out-of-range pageIndex throws', async () => {
    const { loader } = bundle();
    await loader.bind!(spec());
    await expect(loader.getPageSize(5)).rejects.toThrow(/out of range/);
  });
});

describe('prod source loader — font-readiness gate (Phase 6.2, v0.6.1 L-002)', () => {
  // The synthetic pdf.js records the order of getOperatorList vs render calls so
  // we can pin that rasterize() forces font resolution (getOperatorList) BEFORE
  // it paints (render). Without the gate, standard-font glyphs are dropped and
  // the exported image shows blank text. This unit pin holds even when the real
  // @napi-rs/canvas binding is unavailable (prod-render.test.ts is then skipped).
  function instrumentedPdfJs(calls: string[]): PdfJsModule {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 100 * scale }),
      getTextContent: async () => ({ items: [] }),
      getOperatorList: async () => {
        calls.push('getOperatorList');
        return { fnArray: [], argsArray: [] };
      },
      render: ({ canvasContext }: { canvasContext: { __fill?: number } }) => ({
        promise: (async () => {
          calls.push('render');
          canvasContext.__fill = 1;
        })(),
      }),
      objs: { get: () => null, has: () => false },
      commonObjs: { get: () => null, has: () => false },
      cleanup: () => {},
    };
    return {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => page,
          destroy: async () => {},
        }),
      }),
      OPS: OPS as unknown as PdfJsModule['OPS'],
      ImageKind,
      AnnotationMode: { DISABLE: 0, ENABLE: 1 },
    } as unknown as PdfJsModule;
  }

  it('awaits getOperatorList (forces font resolution) BEFORE render', async () => {
    const calls: string[] = [];
    const b = createProdPdfJsSource({
      loadPdfJs: async () => instrumentedPdfJs(calls),
      createCanvas: () => syntheticCanvas(),
    });
    await b.loader.bind!(spec());
    await b.rasterize({ pageIndex: 0, dpi: 72, includeAnnotations: false });
    // getOperatorList MUST precede render — that is the font-readiness gate.
    expect(calls).toEqual(['getOperatorList', 'render']);
    expect(calls.indexOf('getOperatorList')).toBeLessThan(calls.indexOf('render'));
  });
});

describe('prod source loader — grayscale unpacking', () => {
  it('unpacks GRAYSCALE_1BPP to one byte per pixel', async () => {
    // 8x1 image, bit pattern 10110001 → pixels [255,0,255,255,0,0,0,255]
    const packed = new Uint8Array([0b10110001]);
    const mod = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getViewport: () => ({ width: 8, height: 1 }),
            getTextContent: async () => ({ items: [] }),
            getOperatorList: async () => ({
              fnArray: [OPS.paintImageXObject],
              argsArray: [['G']],
            }),
            render: () => ({ promise: Promise.resolve() }),
            objs: {
              get: (n: string) =>
                n === 'G'
                  ? { data: packed, width: 8, height: 1, kind: ImageKind.GRAYSCALE_1BPP }
                  : null,
              has: (n: string) => n === 'G',
            },
            commonObjs: { get: () => null, has: () => false },
            cleanup: () => {},
          }),
          destroy: async () => {},
        }),
      }),
      OPS: OPS as unknown as PdfJsModule['OPS'],
      ImageKind,
      AnnotationMode: { DISABLE: 0, ENABLE: 1 },
    } as unknown as PdfJsModule;

    const b = createProdPdfJsSource({
      loadPdfJs: async () => mod,
      createCanvas: () => syntheticCanvas(),
    });
    await b.loader.bind!(spec());
    const resolver = await b.loader.getImageResolver(0);
    const img = resolver.get('G');
    expect(img).not.toBeNull();
    expect(img!.kind).toBe('grayscale');
    expect(Array.from(img!.data)).toEqual([255, 0, 255, 255, 0, 0, 0, 255]);
  });
});
