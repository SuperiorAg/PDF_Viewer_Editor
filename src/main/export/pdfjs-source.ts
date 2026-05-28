// Production pdf.js source loader + rasterizer (Phase 6.1, David — Julian M-25.4).
//
// This is the SINGLE production funnel that feeds ALL four export formats:
//   - text-content extraction (page.getTextContent)  → layout-extract pipeline
//   - line-segment extraction (page.getOperatorList)  → table-detect pipeline
//   - image extraction         (page.getOperatorList + page.objs) → docx/pptx images
//   - page rasterization       (page.render → canvas → RGBA) → image-export formats
//
// WHY ONE MODULE: pre-6.1, xlsx "worked" only because its text-content path was
// the only one wired; docx/pptx/image were a throwing stub. The prod source
// loader below replaces that stub and is shared by every format — the source of
// truth for "open the PDF once per job, extract everything from one doc proxy".
//
// PER-JOB BINDING: the export engine is a long-lived singleton; each job carries
// its own `spec.sourceBytes`. `bind(spec)` opens the pdf.js document for the
// current job; `release()` destroys it. The engine guarantees concurrency=1
// (ExportQueue), so a single active-document slot is safe.
//
// PATTERN SOURCE: mirrors `src/main/pdf-ops/ocr-bootstrap.ts:rasterizePageProd`
// (Phase 5 already solved pdf.js-in-main rasterization). The pdf.js module and
// canvas factory are INJECTED so unit tests can drive the whole loader without a
// real PDF or a native canvas binding.

import type { PageSourceLoader } from './export-engine.js';
import { OPS_NAMES } from './image-extract.js';
import type {
  ImageResolver,
  PdfImageObject,
  PdfOperatorList,
  RasterKind,
  OpName,
} from './image-extract.js';
import type { LineSegment } from './table-detect.js';
import type { ExportJobSpec, PageSize, PdfTextContent, PdfTextItem } from './types.js';

// ---------------------------------------------------------------------------
// pdf.js minimal shapes (we type only the surface we touch — the full
// namespace lives in pdfjs-dist's .d.ts; importing it would pull DOM types
// into the Node-only main tsconfig).
// ---------------------------------------------------------------------------

/** pdf.js ImageKind enum values (GRAYSCALE_1BPP / RGB_24BPP / RGBA_32BPP). */
export interface PdfJsImageKind {
  GRAYSCALE_1BPP: number;
  RGB_24BPP: number;
  RGBA_32BPP: number;
}

/** The numeric op code → string name map the image-extract / table-detect
 *  walkers consume. pdf.js `fnArray` carries numeric codes; the walkers expect
 *  the string `OpName` union. We translate using pdf.js's own `OPS` namespace
 *  so the codes are never hard-coded. */
export interface PdfJsOpsNamespace {
  save: number;
  restore: number;
  transform: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
  constructPath: number;
  moveTo: number;
  lineTo: number;
  rectangle: number;
  stroke: number;
  fillStroke: number;
  // closePath / curveTo etc. are not load-bearing for line-grid detection.
  [k: string]: number;
}

interface PdfJsCanvasContext {
  // @napi-rs/canvas's 2d context — only the bits pdf.js + our raster need.
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
  ): {
    data: Uint8ClampedArray | Uint8Array;
  };
}

interface PdfJsCanvas {
  getContext(kind: '2d'): PdfJsCanvasContext;
  width: number;
  height: number;
}

interface PdfJsTextItem {
  str?: string;
  transform?: [number, number, number, number, number, number];
  width?: number;
  height?: number;
  fontName?: string;
}

interface PdfJsObjectStore {
  /** Synchronous get — valid AFTER getOperatorList resolves (objs are filled
   *  during op-list construction). Returns null/undefined for unknown names. */
  get(name: string): unknown;
  has?(name: string): boolean;
}

interface PdfJsPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: PdfJsTextItem[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  render(opts: { canvasContext: unknown; viewport: unknown; annotationMode?: number }): {
    promise: Promise<void>;
  };
  objs: PdfJsObjectStore;
  commonObjs: PdfJsObjectStore;
  cleanup?: () => void;
}

interface PdfJsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfJsPage>;
  destroy?: () => Promise<void> | void;
}

/**
 * A pdf.js v4 data factory (StandardFontDataFactory / CMapReaderFactory shape).
 * pdf.js constructs it with `{ baseUrl }` and calls `fetch({ filename })`
 * (CMaps additionally pass `{ filename, compressionType }` but we ignore the
 * latter — we return raw bytes and let pdf.js handle decompression via the
 * `compressionType` it already knows). Returns the asset bytes.
 *
 * WHY WE INJECT THIS (Phase 6.2 — fixes v0.6.1 L-002 blank-text bug): pdf.js v4
 * picks `NodeStandardFontDataFactory` when `isNodeJS` is true, which loads fonts
 * via `fs.promises.readFile(url)`. BUT it passes the `standardFontDataUrl`
 * VERBATIM — and we (correctly, for other consumers) hand it a `file://` URL
 * STRING. `fs.readFile` on a `file://` STRING fails (it's not a path), so the
 * standard-14 fonts (Helvetica/Times/Courier) never load and ALL standard-font
 * text rasterizes BLANK. Supplying an explicit factory that reads the bytes
 * ourselves removes the `file://`-string-vs-path ambiguity entirely AND works
 * regardless of pdf.js's `isNodeJS` autodetection (which is environment-fragile
 * under test runners and Electron). Verified: with the factory, a 36pt
 * Helvetica run renders 2628 dark pixels; without it, 0 (blank). */
export interface PdfJsDataFactory {
  new (opts: { baseUrl: string | null }): {
    fetch(opts: { filename: string; compressionType?: number }): Promise<Uint8Array>;
  };
}

export interface PdfJsGetDocumentOpts {
  data: Uint8Array;
  /** file:// URL to pdfjs-dist/standard_fonts/ (trailing slash). REQUIRED for
   *  PDFs that reference non-embedded standard fonts (Helvetica, Times, etc.)
   *  — without it pdf.js cannot resolve glyph paths and page.render throws. */
  standardFontDataUrl?: string;
  /** file:// URL to pdfjs-dist/cmaps/ for CJK / predefined CMaps. */
  cMapUrl?: string;
  cMapPacked?: boolean;
  /** Explicit Node-safe standard-font loader (see PdfJsDataFactory). Overrides
   *  the default file://-fetch path that breaks under Node's fs.readFile. */
  StandardFontDataFactory?: PdfJsDataFactory;
  /** Explicit Node-safe CMap loader (same file:// problem as fonts). */
  CMapReaderFactory?: PdfJsDataFactory;
}

export interface PdfJsModule {
  getDocument(opts: PdfJsGetDocumentOpts): { promise: Promise<PdfJsDocument> };
  OPS: PdfJsOpsNamespace;
  ImageKind: PdfJsImageKind;
  AnnotationMode?: { DISABLE: number; ENABLE: number };
}

/** Canvas factory — production injects @napi-rs/canvas's createCanvas. */
export type CreateCanvasFn = (w: number, h: number) => PdfJsCanvas;

export interface ProdSourceDeps {
  /** Lazy pdf.js loader (the same one ocr-bootstrap uses). */
  loadPdfJs: () => Promise<PdfJsModule>;
  /** Lazy canvas factory (@napi-rs/canvas createCanvas). */
  createCanvas: () => CreateCanvasFn;
  /** Resolve the standard-fonts + cmaps directories (file:// URLs with a
   *  trailing slash). Production resolves them from the pdfjs-dist package;
   *  tests omit (synthetic loaders don't render real glyphs).
   *
   *  May ALSO return Node-safe data factories. When present, they are passed to
   *  `getDocument` and OVERRIDE pdf.js's default `file://`-fetch loaders (which
   *  break under Node's `fs.readFile` — see PdfJsDataFactory). Production should
   *  return them; if omitted, pdf.js falls back to the URL path (fine for the
   *  browser/renderer, blank-text-prone in Node). */
  resolveFontData?: () => {
    standardFontDataUrl: string;
    cMapUrl: string;
    StandardFontDataFactory?: PdfJsDataFactory;
    CMapReaderFactory?: PdfJsDataFactory;
  };
  /**
   * Register the Canvas2D globals (`Path2D`, `DOMMatrix`, `ImageData`,
   * `DOMPoint`) that pdf.js v4 needs to render glyph paths in Node. Without
   * this, `page.render` throws `Value is none of these types String, Path` the
   * moment it hits text — pdf.js builds its own `Path` polyfill that
   * @napi-rs/canvas's `ctx.fill()` rejects. Called ONCE before the first
   * rasterize. Tests omit it. Idempotent.
   */
  registerCanvasGlobals?: () => void;
}

// ---------------------------------------------------------------------------
// Operator-list translation
// ---------------------------------------------------------------------------

/** Build the numeric-code → string-OpName map ONCE per pdf.js module. */
function buildOpNameByCode(ops: PdfJsOpsNamespace): Map<number, OpName> {
  const m = new Map<number, OpName>();
  m.set(ops.save, OPS_NAMES.save);
  m.set(ops.restore, OPS_NAMES.restore);
  m.set(ops.transform, OPS_NAMES.transform);
  m.set(ops.paintImageXObject, OPS_NAMES.paintImageXObject);
  m.set(ops.paintInlineImageXObject, OPS_NAMES.paintInlineImageXObject);
  m.set(ops.paintImageMaskXObject, OPS_NAMES.paintImageMaskXObject);
  return m;
}

/**
 * Translate a raw pdf.js operator list into the string-named `PdfOperatorList`
 * the image-extract walker expects. Ops we don't care about are dropped (their
 * args go with them), preserving the relative order of save/restore/transform/
 * paintImage* — the only ops the CTM-tracking extractor reads.
 */
function translateOpList(
  raw: { fnArray: number[]; argsArray: unknown[][] },
  ops: PdfJsOpsNamespace,
  imageKind: PdfJsImageKind,
  resolveObj: (name: string) => PdfImageObject | null,
): { opList: PdfOperatorList; segments: LineSegment[] } {
  const nameByCode = buildOpNameByCode(ops);
  const fnArray: OpName[] = [];
  const argsArray: unknown[][] = [];

  for (let i = 0; i < raw.fnArray.length; i++) {
    const code = raw.fnArray[i]!;
    const name = nameByCode.get(code);
    if (name === undefined) continue;
    const args = raw.argsArray[i] ?? [];
    if (name === OPS_NAMES.paintInlineImageXObject) {
      // Inline image: pdf.js arg[0] is the decoded image object. Normalize it
      // to our PdfImageObject shape so the extractor reads it directly.
      const inline = normalizeInlineImage(args[0], imageKind);
      argsArray.push([inline]);
    } else if (name === OPS_NAMES.paintImageXObject || name === OPS_NAMES.paintImageMaskXObject) {
      // XObject paint: arg[0] is the object NAME. The extractor resolves it via
      // the ImageResolver, so we pass the name through unchanged.
      argsArray.push([String(args[0] ?? '')]);
    } else {
      argsArray.push(args);
    }
    fnArray.push(name);
  }

  const segments = extractLineSegments(raw, ops);
  void resolveObj; // resolver is wired via getImageResolver, not here.
  return { opList: { fnArray, argsArray }, segments };
}

/**
 * Walk the raw op list for path-construction segments feeding the table
 * detector (export-engine.md §3.5.1). pdf.js encodes paths as a single
 * `constructPath` op whose args are `[opCodes: number[], coords: number[]]`.
 * We reconstruct horizontal/vertical segments from moveTo/lineTo/rectangle
 * subpaths. Diagonal segments are kept here and discarded later by the
 * detector's orthogonal classifier.
 */
function extractLineSegments(
  raw: { fnArray: number[]; argsArray: unknown[][] },
  ops: PdfJsOpsNamespace,
): LineSegment[] {
  const segments: LineSegment[] = [];
  for (let i = 0; i < raw.fnArray.length; i++) {
    if (raw.fnArray[i] !== ops.constructPath) continue;
    const args = raw.argsArray[i] ?? [];
    // pdf.js v4 constructPath args: [ subOps: number[], coords: number[] ]
    const subOps = Array.isArray(args[0]) ? (args[0] as number[]) : [];
    const coords = Array.isArray(args[1]) ? (args[1] as number[]) : [];
    let ci = 0;
    let cx = 0;
    let cy = 0;
    for (const sub of subOps) {
      if (sub === ops.moveTo) {
        cx = coords[ci++] ?? cx;
        cy = coords[ci++] ?? cy;
      } else if (sub === ops.lineTo) {
        const nx = coords[ci++] ?? cx;
        const ny = coords[ci++] ?? cy;
        segments.push({ x1: cx, y1: cy, x2: nx, y2: ny });
        cx = nx;
        cy = ny;
      } else if (sub === ops.rectangle) {
        const rx = coords[ci++] ?? 0;
        const ry = coords[ci++] ?? 0;
        const rw = coords[ci++] ?? 0;
        const rh = coords[ci++] ?? 0;
        // Four edges of the rectangle.
        segments.push({ x1: rx, y1: ry, x2: rx + rw, y2: ry }); // bottom
        segments.push({ x1: rx + rw, y1: ry, x2: rx + rw, y2: ry + rh }); // right
        segments.push({ x1: rx + rw, y1: ry + rh, x2: rx, y2: ry + rh }); // top
        segments.push({ x1: rx, y1: ry + rh, x2: rx, y2: ry }); // left
        cx = rx;
        cy = ry;
      } else if (sub === ops.curveTo) {
        // Skip the 6 control-point coords; curves aren't grid lines.
        ci += 6;
      }
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Image object normalization (pdf.js kind → our RasterKind)
// ---------------------------------------------------------------------------

function kindFromPdfJs(kind: unknown, imageKind: PdfJsImageKind): RasterKind | null {
  if (kind === imageKind.RGBA_32BPP) return 'rgba';
  if (kind === imageKind.RGB_24BPP) return 'rgb';
  if (kind === imageKind.GRAYSCALE_1BPP) return 'grayscale';
  return null;
}

interface RawPdfJsImage {
  data?: Uint8Array | Uint8ClampedArray;
  width?: number;
  height?: number;
  kind?: number;
  bitmap?: { width: number; height: number };
}

/**
 * Convert a pdf.js decoded image object into our `PdfImageObject`. For
 * GRAYSCALE_1BPP, pdf.js packs 8 pixels per byte (1 bit each); we unpack to one
 * byte per pixel so image-extract's grayscale path (which assumes 1 byte/px)
 * reads it correctly.
 */
function normalizeImageObject(raw: unknown, imageKind: PdfJsImageKind): PdfImageObject | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const r = raw as RawPdfJsImage;
  const width = r.width ?? r.bitmap?.width ?? 0;
  const height = r.height ?? r.bitmap?.height ?? 0;
  if (width <= 0 || height <= 0) return null;
  const kind = kindFromPdfJs(r.kind, imageKind);
  if (kind === null || r.data === undefined) return null;
  const data =
    r.data instanceof Uint8Array
      ? r.data
      : new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  if (kind === 'grayscale') {
    // GRAYSCALE_1BPP is bit-packed (MSB-first). Unpack to one byte per pixel.
    const out = new Uint8Array(width * height);
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * rowBytes + (x >> 3)] ?? 0;
        const bit = (byte >> (7 - (x & 7))) & 1;
        out[y * width + x] = bit ? 255 : 0;
      }
    }
    return { data: out, width, height, kind: 'grayscale' };
  }
  return { data, width, height, kind };
}

function normalizeInlineImage(raw: unknown, imageKind: PdfJsImageKind): PdfImageObject | null {
  return normalizeImageObject(raw, imageKind);
}

// ---------------------------------------------------------------------------
// Text-content normalization (pdf.js TextItem → our PdfTextItem)
// ---------------------------------------------------------------------------

function normalizeTextContent(raw: { items: PdfJsTextItem[] }): PdfTextContent {
  const items: PdfTextItem[] = [];
  for (const it of raw.items) {
    // pdf.js mixes TextItem and TextMarkedContent; only TextItem has transform.
    if (it.transform === undefined || typeof it.str !== 'string') continue;
    items.push({
      str: it.str,
      transform: it.transform,
      width: it.width ?? 0,
      height: it.height ?? 0,
      fontName: it.fontName ?? '',
    });
  }
  return { items };
}

// ---------------------------------------------------------------------------
// The production source loader + rasterizer (one factory, one active doc)
// ---------------------------------------------------------------------------

export interface ProdSourceBundle {
  loader: PageSourceLoader;
  /** Rasterize bound to the SAME active document the loader uses. Wired into
   *  the image-writer deps. */
  rasterize: (opts: {
    pageIndex: number;
    dpi: number;
    includeAnnotations: boolean;
  }) => Promise<{ rgba: Uint8Array; width: number; height: number }>;
}

interface ActiveDoc {
  jobId: number;
  doc: PdfJsDocument;
  pageCache: Map<number, PdfJsPage>;
}

/**
 * Build the production source bundle. The returned loader + rasterize share a
 * single mutable `active` slot, rebound per job via `loader.bind(spec)`.
 */
export function createProdPdfJsSource(deps: ProdSourceDeps): ProdSourceBundle {
  let pdfjs: PdfJsModule | null = null;
  let createCanvasFn: CreateCanvasFn | null = null;
  let globalsRegistered = false;
  let active: ActiveDoc | null = null;

  function ensureCanvasGlobals(): void {
    if (globalsRegistered) return;
    // Register Path2D / DOMMatrix / ImageData / DOMPoint. This MUST happen
    // BEFORE pdf.js's module is evaluated — pdf.js v4 captures whether
    // globalThis.Path2D exists at load time and builds an internal polyfill if
    // it doesn't (which @napi-rs/canvas's ctx.fill() then rejects). So we call
    // this from ensurePdfJs (before the import) AND ensureCanvas (defensive).
    deps.registerCanvasGlobals?.();
    globalsRegistered = true;
  }

  async function ensurePdfJs(): Promise<PdfJsModule> {
    if (pdfjs === null) {
      ensureCanvasGlobals();
      pdfjs = await deps.loadPdfJs();
    }
    return pdfjs;
  }

  function ensureCanvas(): CreateCanvasFn {
    ensureCanvasGlobals();
    if (createCanvasFn === null) createCanvasFn = deps.createCanvas();
    return createCanvasFn;
  }

  function requireActive(): ActiveDoc {
    if (active === null) {
      throw new Error('export source loader used before bind() — no active document');
    }
    return active;
  }

  async function getPage(pageIndex: number): Promise<PdfJsPage> {
    const a = requireActive();
    const cached = a.pageCache.get(pageIndex);
    if (cached) return cached;
    if (pageIndex < 0 || pageIndex >= a.doc.numPages) {
      throw new Error(`pageIndex ${pageIndex} out of range [0, ${a.doc.numPages - 1}]`);
    }
    const page = await a.doc.getPage(pageIndex + 1); // pdf.js is 1-indexed
    a.pageCache.set(pageIndex, page);
    return page;
  }

  const loader: PageSourceLoader = {
    async bind(spec: ExportJobSpec): Promise<void> {
      // Release any previous job's doc first (defensive; the engine releases
      // on terminal, but a crashed prior job could leave a dangling doc).
      await loader.release?.();
      const mod = await ensurePdfJs();
      // pdf.js DETACHES (transfers) the input `data` ArrayBuffer to its worker.
      // documentStore.getBytes() hands back the SAME stored buffer on every
      // call, so passing it directly would permanently detach the store's
      // bytes — breaking every SUBSEQUENT export (and any other reader) of the
      // same document. Hand pdf.js a fresh copy it can safely detach.
      const data = spec.sourceBytes.slice();
      const fontData = deps.resolveFontData?.();
      const getDocOpts: PdfJsGetDocumentOpts = { data };
      if (fontData) {
        getDocOpts.standardFontDataUrl = fontData.standardFontDataUrl;
        getDocOpts.cMapUrl = fontData.cMapUrl;
        getDocOpts.cMapPacked = true;
        // Node-safe loaders override the default file://-fetch path that fails
        // under fs.readFile and drops every standard-font glyph (v0.6.1 L-002).
        if (fontData.StandardFontDataFactory) {
          getDocOpts.StandardFontDataFactory = fontData.StandardFontDataFactory;
        }
        if (fontData.CMapReaderFactory) {
          getDocOpts.CMapReaderFactory = fontData.CMapReaderFactory;
        }
      }
      const doc = await mod.getDocument(getDocOpts).promise;
      active = { jobId: spec.jobId, doc, pageCache: new Map() };
    },

    async release(): Promise<void> {
      const a = active;
      active = null;
      if (!a) return;
      for (const page of a.pageCache.values()) {
        try {
          page.cleanup?.();
        } catch {
          /* best-effort */
        }
      }
      a.pageCache.clear();
      try {
        await a.doc.destroy?.();
      } catch {
        /* best-effort */
      }
    },

    async getPageSize(pageIndex: number): Promise<PageSize> {
      const page = await getPage(pageIndex);
      const vp = page.getViewport({ scale: 1 });
      return { widthPt: vp.width, heightPt: vp.height };
    },

    async getTextContent(pageIndex: number): Promise<PdfTextContent> {
      const page = await getPage(pageIndex);
      const raw = await page.getTextContent();
      return normalizeTextContent(raw);
    },

    async getOperatorList(pageIndex: number): Promise<PdfOperatorList> {
      const mod = await ensurePdfJs();
      const page = await getPage(pageIndex);
      const raw = await page.getOperatorList();
      const { opList } = translateOpList(raw, mod.OPS, mod.ImageKind, () => null);
      return opList;
    },

    async getImageResolver(pageIndex: number): Promise<ImageResolver> {
      const mod = await ensurePdfJs();
      const page = await getPage(pageIndex);
      // The op list must be run so page.objs is populated with image XObjects.
      await page.getOperatorList();
      return {
        get(name: string): PdfImageObject | null {
          // commonObjs holds shared resources; objs holds page-local ones.
          // Either store may throw if the name isn't resolved yet — guard.
          let raw: unknown = null;
          try {
            if (page.objs.has?.(name) ?? true) raw = page.objs.get(name);
          } catch {
            raw = null;
          }
          if (raw === null || raw === undefined) {
            try {
              if (page.commonObjs.has?.(name) ?? true) {
                raw = page.commonObjs.get(name);
              }
            } catch {
              raw = null;
            }
          }
          return normalizeImageObject(raw, mod.ImageKind);
        },
      };
    },

    async getLineSegments(pageIndex: number): Promise<LineSegment[]> {
      const mod = await ensurePdfJs();
      const page = await getPage(pageIndex);
      const raw = await page.getOperatorList();
      const { segments } = translateOpList(raw, mod.OPS, mod.ImageKind, () => null);
      return segments;
    },
  };

  const rasterize = async (opts: {
    pageIndex: number;
    dpi: number;
    includeAnnotations: boolean;
  }): Promise<{ rgba: Uint8Array; width: number; height: number }> => {
    const mod = await ensurePdfJs();
    const create = ensureCanvas();
    const page = await getPage(opts.pageIndex);
    const scale = opts.dpi / 72;
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = create(width, height);
    const ctx = canvas.getContext('2d');
    const annotationMode = opts.includeAnnotations
      ? (mod.AnnotationMode?.ENABLE ?? 1)
      : (mod.AnnotationMode?.DISABLE ?? 0);
    // FONT-READINESS GATE (Phase 6.2 — fixes v0.6.1 L-002 blank-text bug).
    //
    // pdf.js loads font data (including the standard-14 Type-1 substitutes —
    // Helvetica/Times/Courier — fetched from `standardFontDataUrl`) LAZILY and
    // ASYNCHRONOUSLY. `page.render()` does NOT await that fetch before it starts
    // painting: when it reaches a text op whose font isn't resolved yet it throws
    // `getPathGenerator ... isn't resolved yet <Font>_path_<n>` (in Node, where
    // there is no microtask gap to let the font fetch settle mid-render) OR — the
    // more insidious failure — silently paints nothing for that glyph run, so the
    // exported image shows embedded raster images correctly but ALL standard-font
    // text comes out blank.
    //
    // `getOperatorList()` walks the page's content stream to completion, which
    // forces pdf.js to resolve EVERY font referenced on the page (it awaits the
    // `standardFontDataUrl` fetch and builds the glyph-path generators) and caches
    // the result on the page. Awaiting it here guarantees the fonts are ready
    // BEFORE `render()` paints, so glyph paths resolve synchronously during the
    // render walk. (The export pipeline already calls getOperatorList for image /
    // line-segment extraction, but the rasterize path is independent — image-only
    // export jobs may rasterize without ever extracting ops — so the gate must
    // live here, not be assumed from a sibling call.)
    //
    // WHY OCR's rasterizer (ocr-bootstrap.rasterizePageProd) gets away WITHOUT
    // this: OCR's input is scanned / image-only PDFs that carry no standard-font
    // text runs, so its render never hits an unresolved built-in font. Export
    // rasterizes arbitrary text-bearing PDFs and MUST gate.
    await page.getOperatorList();
    await page.render({
      canvasContext: ctx,
      viewport,
      annotationMode,
    }).promise;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const src = imageData.data;
    // Copy into a plain Uint8Array (the encoders + utif want Uint8Array, and we
    // must not hold a reference into canvas-owned memory after the next render).
    const rgba = new Uint8Array(src.length);
    rgba.set(src);
    return { rgba, width: canvas.width, height: canvas.height };
  };

  return { loader, rasterize };
}
