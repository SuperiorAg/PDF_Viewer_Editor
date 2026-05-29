# Export Engine — Detailed Design (Phase 6)

**Author:** Riley (front-end-architect)
**Date:** 2026-05-27 (Wave 23)
**Status:** Phase 6 design, locked at end of Wave 23. Companion to `docs/architecture-phase-6.md` (which carries the system-level deltas).
**Scope:** Detailed design of the main-process export operations — pdf.js text-content extraction, bounding-box clustering, table detection via line-grid analysis, image extraction via operator stream, per-format output writers for docx / xlsx / pptx / png / jpeg / tiff, quality-tier selection, job lifecycle.
**Reads:** `docs/architecture-phase-6.md`, `docs/architecture-phase-5.md`, `docs/ocr-engine.md`, `docs/api-contracts.md` (§17 Phase-6 amendment), `docs/data-models.md` (§11 Phase-6 amendment), `docs/conventions.md` (§17 Phase-6 amendment), `docs/edit-replay-engine.md`.

---

## 1. Document scope

This doc is the **engineering-detail-level** companion to `architecture-phase-6.md`. The architecture doc says _what_ Phase 6 adds at the system level; this doc says _how_ the export engine is built — module shapes, function signatures, algorithm pseudocode, error-handling shape, test coverage targets, per-format-writer specifics.

Wave 24 (David + Ravi + Riley) is the implementation wave. This doc is the binding spec — David must follow the function signatures here; Ravi must follow the schema shape here; Riley must follow the renderer thunk shape here. Wave 25 Julian audits against this doc.

The shape mirrors `ocr-engine.md` (the Phase 5 precedent) — same section count, same self-check pattern at the end. The two engines are structurally analogous: both single-funnel, both background-queue-friendly, both bounded transient memory, both pure-JS no-native-deps.

---

## 2. Engine selection rationale

### 2.1 Why `docx` (MIT) for Word

The `docx` package (npm `docx`, current v9.7.1 published 2026-04-22, MIT) is the standard pure-JS DOCX authoring library on npm. It:

- Has the most idiomatic TypeScript types of the three contenders (`docx` / `officegen` / `pizzip+docxtemplater`).
- Tree-shakes cleanly — the production import surface for Phase 6 is `{ Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, ImageRun, AlignmentType, WidthType }` plus `BorderStyle` for table borders — well under 100 KB raw after Vite bundles.
- Has no native deps, no wasm, no asset files — pure-JS only.
- Has good test coverage upstream and ~2.5K GitHub stars + active maintenance.
- License: MIT (verified live via `npm view docx license` 2026-05-27).

The library is imported from `src/main/export/writers/docx-writer.ts` only. ESLint `no-restricted-imports` keeps `docx` reachable from one module (the engine boundary discipline pattern from Phase 5).

### 2.2 Why `exceljs` (already in deps from Phase 3) for Excel

`exceljs` (MIT, v4.4.0) is already in the project from Phase 3 mail merge, where it parses CSV/XLSX rows for the mail-merge dataset. Phase 6 uses the WRITE side of the same library — `Workbook.xlsx.writeFile` / `writeBuffer`. Symmetric, complementary use; no shared state with the Phase 3 import path (different `Workbook` instances per call).

Re-using a library already vetted by Diego (Phase 3 LICENSES.md walk) saves another license-walk cycle in Wave 25.

Alternative considered: `xlsx` / `xlsx-js-style` (SheetJS). Rejected — exceljs has better TypeScript types AND has a more idiomatic stream-to-disk API. No reason to introduce a parallel xlsx writer. Documented in `architecture-phase-6.md §3.1` under "Native binding NOT added".

### 2.3 Why `pptxgenjs` (MIT) for PowerPoint

`pptxgenjs` (MIT, v4.0.1 published 2026-03-15) is the standard pure-JS PPTX authoring library on npm. It:

- Has TypeScript types.
- Pure-JS; no native deps.
- ~3K GitHub stars + active maintenance.
- Has the surface we need: `pres.addSlide()`, `slide.addText()`, `slide.addImage()`, `slide.addTable()`.
- License: MIT (verified live via `npm view pptxgenjs license` 2026-05-27).

Larger raw bundle (~600 KB) than `docx` (~250 KB) because pptx files are themselves more complex — chart helpers, slide masters, themes. We don't use most of that surface in v1.

### 2.4 Why reuse the existing canvas path for image rasterization

The pdfjs render pipeline already produces canvas → PNG / JPEG bytes via browser-native APIs (`@napi-rs/canvas` in main, already in deps from Phase 5 OCR's image-only-PDF rendering path). Reusing this path:

- Adds ZERO new native deps (Diego's electron-rebuild matrix unchanged).
- Uses the same code path Phase 4.1 + Phase 5 already exercise and test.
- TIFF via `utif` (MIT, v3.1.0, already in deps from Phase 5 raster import — symmetric encode side).

Alternative considered: `sharp` (libvips). Rejected — native dep with prebuilt binaries that would expand the electron-rebuild matrix. `sharp` only adds value for advanced image processing (resize, color-space conversions) which Phase 6 doesn't need.

### 2.5 The single-package alternative we considered (officegen)

`officegen` (npm, MIT) is an older library that handles docx + xlsx + pptx in ONE package. Considered and rejected because:

- Code quality and test coverage lag behind the modern dedicated triad (`docx` + `exceljs` + `pptxgenjs`).
- TypeScript types are weaker (community-contributed `@types/officegen` rather than first-party types).
- Lower upstream activity vs the three dedicated libraries.

The three-library split (docx + exceljs + pptxgenjs) is cleaner and better-tested. We accept the modest bundle-size cost (~850 KB combined raw vs ~500 KB for officegen) for the maintenance + types benefit. Documented for the audit trail.

### 2.6 The Phase 6.1 escape hatch (NOT shipped in Phase 6)

If users report image-export performance issues (rasterization is ~1-3 sec/page on a typical PDF at 150 DPI; high DPI on large pages is the slow case), `sharp` can be added as an optional native dep in Phase 6.1 behind a setting toggle (`export.image.useSharp: boolean = false`). Default off; sharp is loaded lazily on first use.

Same escape-hatch pattern as Phase 5's `node-tesseract-ocr` for OCR perf. NOT a Phase 6 blocker.

---

## 3. Engine pipeline

### 3.1 Single funnel

`export-engine.ts` is the only module that orchestrates per-format writers. It:

1. Receives an `ExportJobSpec` from the IPC handler.
2. Allocates an `export_jobs` row (status=`queued`).
3. Enqueues the job in `ExportQueue` (concurrency = 1).
4. On dequeue: opens the source PDF via pdf.js (reusing the existing main-side pdfjs init), extracts an `ExtractedDocument` (text + tables + images per page), dispatches to the format-specific writer.
5. The writer composes the output buffer in memory; the engine writes atomically to disk (write-to-`.export-temp` → rename to final).
6. Updates `export_jobs.status = 'completed'`, emits `export:progress { phase: 'completed', summary }`.

```ts
// src/main/export/export-engine.ts
export interface ExportEngine {
  runJob(
    spec: ExportJobSpec,
    signal: AbortSignal,
    onProgress: (event: ExportProgressEvent) => void,
  ): Promise<ExportJobSummary>;
}

export interface ExportJobSpec {
  jobId: number;
  doc: SourceDocumentHandle; // already-loaded pdf.js + pdf-lib doc + meta (Phase 4.1.1 metadata loader output)
  format: 'docx' | 'xlsx' | 'pptx' | 'png' | 'jpeg' | 'tiff';
  qualityTier: 'text-only' | 'layout-preserving' | 'n/a'; // n/a only for image formats
  pageRange: { start: number; end: number };
  includeAnnotations: boolean;
  outputPath: string;
  /** Per-format extras (discriminated by format) */
  perFormat:
    | { format: 'docx'; pageSize: 'letter' | 'a4' | 'auto' }
    | { format: 'xlsx' }
    | { format: 'pptx' }
    | { format: 'png'; dpi: number }
    | { format: 'jpeg'; dpi: number; quality: number }
    | { format: 'tiff'; dpi: number; multiPage: boolean };
}
```

### 3.2 ExtractedDocument shape

The intermediate that the writer consumes:

```ts
export interface ExtractedDocument {
  pageCount: number;
  pageRange: { start: number; end: number };
  pages: ExtractedPage[]; // one per page in pageRange
}

export interface ExtractedPage {
  pageIndex: number;
  pageSize: { widthPt: number; heightPt: number }; // from pdf-lib doc.getPage(i).getSize()
  /** Null if pdf.js getTextContent returned zero fragments (image-only page). */
  text: ExtractedText | null;
  /** Empty array if no tables detected on this page. */
  tables: TableRegion[];
  /** Empty array if no images extracted (or qualityTier='text-only'). */
  images: ExtractedImage[];
  /** Annotations on this page if includeAnnotations=true; empty otherwise. */
  annotations: ExtractedAnnotation[];
}

export interface ExtractedText {
  paragraphs: ExtractedParagraph[]; // sorted reading-order
  columnsDetected: number; // 1 or 2+
}

export interface ExtractedParagraph {
  text: string;
  rect: LayoutRect; // {x,y,w,h} | null per anti-sentinel discipline
  heading: 'H1' | 'H2' | 'H3' | null;
  alignment: 'left' | 'center' | 'right';
  fontHints: { bold?: boolean; italic?: boolean; sizePt?: number };
}

export interface TableRegion {
  rect: LayoutRect;
  rows: number;
  columns: number;
  cells: TableCell[][]; // [row][col]
}

export interface TableCell {
  text: string;
  rect: LayoutRect;
}

export interface ExtractedImage {
  rect: LayoutRect; // position on the page
  bytes: Uint8Array; // PNG-encoded; always converted from PDF native format
  widthPx: number;
  heightPx: number;
}

export interface ExtractedAnnotation {
  kind: 'sticky-note' | 'text-box' | 'highlight' | 'strikethrough' | 'shape';
  text: string | null; // null for visual-only annots
  rect: LayoutRect;
  /** Visually rendered into the page raster (for image format) by default; engine just records metadata. */
}

export type LayoutRect = { x: number; y: number; w: number; h: number } | null;
```

**Anti-sentinel discipline:** `LayoutRect` is nullable everywhere it appears. The writers pattern-match on `null` to skip / render a placeholder; they NEVER read sentinel-zero values.

### 3.3 Per-page streaming (R-W23-B mitigation)

pdf.js's operator-list per page can be large (~50K ops on complex pages). The engine streams pages — extract one page's content, dispatch to the writer's per-page handler, release intermediates, move to next page.

```ts
async function* extractPagesStream(
  doc: SourceDocumentHandle,
  spec: ExportJobSpec,
  signal: AbortSignal,
): AsyncGenerator<ExtractedPage> {
  for (let i = spec.pageRange.start; i <= spec.pageRange.end; i++) {
    if (signal.aborted) return;
    const page = await extractPage(doc, i, spec);
    yield page;
    // intermediate raster / operator-list released by the scope exit
  }
}
```

Writers consume the stream and emit output per-page (docx: `Paragraph` chunks appended to a running `Document`; xlsx: rows added to a `Worksheet`; pptx: a new slide per page; image: per-page raster). This bounds transient memory to ONE page's intermediates at a time.

### 3.4 Layout extractor (R-W23-A mitigation; Q-B answer)

The bounding-box clustering algorithm in pseudocode:

```ts
// src/main/export/layout-extractor.ts
export interface LayoutExtractor {
  extract(
    textContent: pdfjs.TextContent,
    pageSize: PageSize,
    settings: LayoutSettings,
  ): ExtractedText | null;
}

export interface LayoutSettings {
  lineEpsilonPt: number; // default 2
  paragraphBreakRatio: number; // default 1.5
  headingRatio: number; // default 1.3
  columnGapPt: number; // default 40
}
```

#### 3.4.1 Step 1 — Convert fragments to typed atoms

pdf.js returns `textContent.items: TextItem[]` where each item has `str`, `transform: [a, b, c, d, e, f]` (transformation matrix to user-space), `width`, `height`, `fontName`. Convert each to:

```ts
interface Atom {
  text: string;
  x: number; // bottom-left x in PDF points
  y: number; // bottom-left y in PDF points
  w: number;
  h: number; // = item.height (font's ascender-to-baseline; use as line-height proxy)
  fontName: string;
  fontSizePt: number; // approx from item.height / 0.7 (PDF convention)
}
```

#### 3.4.2 Step 2 — Cluster atoms into lines (Y-coordinate clustering)

Group atoms whose `y` values are within `lineEpsilonPt` of each other. For each line:

- Sort members left-to-right by `x`.
- Concatenate `text` with single-space separator (atoms with adjacent `x`-coords without a visible space between them are concat-no-space; atoms with `(member[i+1].x - (member[i].x + member[i].w)) > 0.5 * median(atom.h)` get a space).
- Compute the line's `y` as `median(member.y)`.
- Compute the line's `fontSize` as `median(member.fontSizePt)`.

#### 3.4.3 Step 3 — Cluster lines into paragraphs (gap detection)

Sort lines top-to-bottom by `y` descending (PDF Y is bottom-up). For each consecutive pair:

- Gap = `line[i-1].y - line[i].y - line[i].h`.
- If `gap > paragraphBreakRatio * median(line.h)`, start a new paragraph.

For each paragraph:

- Concatenate member-line text with a single space.
- `rect.x = min(line.x)`, `rect.y = min(line.y)`, `rect.w = max(line.x + line.w) - rect.x`, `rect.h = (last.y + last.h) - rect.y` (LayoutRect bounding the paragraph).

#### 3.4.4 Step 4 — Detect columns (multi-column re-ordering)

PDF content streams sometimes interleave columns. Re-order:

1. Cluster paragraphs by `rect.x` — paragraphs whose `x` values are within `0.05 * pageWidth` of each other form a column cluster.
2. If 2+ distinct column clusters exist AND their X-cluster-centers differ by `> columnGapPt`, treat as multi-column.
3. Emit paragraphs column-by-column, left-to-right per column; within a column, top-to-bottom by `rect.y` descending.
4. Single-column: emit top-to-bottom by `rect.y` descending.

**Locale-aware reading order (RTL languages) is NOT in v1.** Phase 6.2 deferral.

#### 3.4.5 Step 5 — Detect headings (font-size delta)

For each paragraph:

- Compute `bodyMedianFontSize = median(paragraph.fontHints.sizePt where heading = null sentinel ignored)`.
- If `paragraph.fontHints.sizePt > 1.8 * bodyMedianFontSize`: `heading = 'H1'`.
- Else if `> 1.5 * bodyMedianFontSize`: `heading = 'H2'`.
- Else if `> headingRatio * bodyMedianFontSize`: `heading = 'H3'`.
- Else `heading = null` (body paragraph).

#### 3.4.6 Step 6 — Detect alignment

For each paragraph, the alignment classification:

- `paragraph.rect.x ≈ 0.1 * pageWidth` (within margin tolerance) AND `paragraph.rect.x + paragraph.rect.w ≈ 0.9 * pageWidth`: justified (treated as `left` for v1).
- `paragraph.rect.x + paragraph.rect.w / 2 ≈ 0.5 * pageWidth` AND paragraph width < 0.7 \* pageWidth: `center`.
- `paragraph.rect.x + paragraph.rect.w ≈ 0.9 * pageWidth` AND `paragraph.rect.x > 0.5 * pageWidth`: `right`.
- Else: `left` (default).

#### 3.4.7 Step 7 — Detect font hints (bold / italic)

Per the `fontName` of the majority atoms in the paragraph:

- Bold: name matches `/Bold|Black|Heavy|Semibold/i`.
- Italic: name matches `/Italic|Oblique/i`.

Approximate; documented as such. Phase 6.1 could refine with the PDF's actual /Font resource lookup.

#### 3.4.8 Empty-page sentinel guard

If `textContent.items.length === 0` after extraction, return `null` (NOT an `ExtractedText` with empty paragraphs). The writer pattern-matches on `null` to handle image-only / blank pages explicitly.

### 3.5 Table detector (Q-B answer; line-grid analysis)

```ts
// src/main/export/table-detector.ts
export interface TableDetector {
  detect(
    opList: pdfjs.OperatorList,
    textContent: pdfjs.TextContent,
    pageSize: PageSize,
  ): TableRegion[];
}
```

#### 3.5.1 Step 1 — Walk operator list for line segments

Scan `opList.fnArray` + `opList.argsArray` for path-construction ops:

- `OPS.constructPath` arguments include subpath ops like `OPS.moveTo`, `OPS.lineTo`, `OPS.rectangle`.
- For each `OPS.lineTo` that immediately follows an `OPS.moveTo`: capture the `(x1, y1) → (x2, y2)` segment.
- For each `OPS.rectangle (x, y, w, h)`: emit four edges (bottom, right, top, left).
- For `OPS.stroke` AND `OPS.fillStroke` (NOT `OPS.fill` alone — filled boxes have no edges), accept the buffered segments. Discard segments after `OPS.fill` alone (filled-only shapes have no visible lines).

#### 3.5.2 Step 2 — Classify horizontal vs vertical

- Horizontal: `|y1 - y2| < 1.0 pt`.
- Vertical: `|x1 - x2| < 1.0 pt`.
- Diagonal / other: discard. The line-grid algorithm only recognizes orthogonal grids.

#### 3.5.3 Step 3 — Cluster

- Cluster horizontals by `y` (within 2 pt) — these are the row-boundary y-coordinates.
- Cluster verticals by `x` (within 2 pt) — these are the column-boundary x-coordinates.

#### 3.5.4 Step 4 — Identify grid

For each rectangular region bounded by 4+ horizontal clusters and 4+ vertical clusters (or 2+ horizontal AND 2+ vertical for a single-row or single-column table):

- The bounding box is `(min(vertical-cluster.x), min(horizontal-cluster.y), max(vertical-cluster.x) - min, max(horizontal-cluster.y) - min)`.
- The grid is dense IF segments form ≥ 80% of the implied perimeter + internal cell boundaries. Sparse-segment matches (e.g. only the table's outer border, no internal lines) are rejected — the algorithm requires explicit internal grid lines.

#### 3.5.5 Step 5 — Populate cells

For each cell (intersection of horizontal-cluster pair × vertical-cluster pair):

- Cell rect = the bounding rectangle.
- Cell text = concatenate text fragments from `textContent.items` whose center `(x + w/2, y + h/2)` falls inside the cell rect.
- Sort fragments left-to-right by `x`, concatenate with single space.

#### 3.5.6 Failure modes documented honestly

- **Borderless tables:** zero line segments → zero TableRegions. Output is a flat sequence of paragraphs from layout-extractor. Trust-floor obligation #2.
- **Merged cells (rowspan / colspan in source):** detected as separate cells per the grid; merge inference is Phase 6.1.
- **Diagonal lines / decorative rules:** filtered out by orthogonal-only classifier (step 2).
- **Tables with only the outer border (no internal lines):** rejected at step 4 density check. The reasoning: an "outer border only" rectangle is more likely a callout box than a table; we'd produce a 1×1 single-cell table with all the content jammed in, which is worse than no table.

### 3.6 Image extractor (Q-C answer)

```ts
// src/main/export/image-extractor.ts
export interface ImageExtractor {
  extract(
    opList: pdfjs.OperatorList,
    objs: pdfjs.PDFObjects,
    pageSize: PageSize,
  ): Promise<ExtractedImage[]>;
}
```

#### 3.6.1 Operator stream walk

Scan `opList.fnArray` for:

- `OPS.paintImageXObject` — the standard path. Arg is the name of an XObject in the page resource dictionary. Looked up via `objs.get(name)` → returns `{ data, width, height, kind }` where `kind` is RGB / RGBA / Grayscale.
- `OPS.paintInlineImageXObject` — inline images (less common; small images embedded directly in the content stream). Arg carries the image bytes + dims directly.
- `OPS.paintImageMaskXObject` — image masks (transparency masks); we capture the mask + render against white background (v1; Phase 6.1 could preserve transparency in output formats that support it).

#### 3.6.2 Coordinate transformation

The image's position on the page is determined by the current transformation matrix (CTM) at the time of the `paintImageXObject` op. The op is preceded by `OPS.transform` (set CTM) and `OPS.save` / `OPS.restore` (push / pop matrix stack). The extractor maintains a CTM stack walking through opList:

- `OPS.save` / `OPS.restore` push / pop.
- `OPS.transform [a b c d e f]` multiplies into the CTM.
- At `OPS.paintImageXObject`, the image's PDF-space rect is `CTM applied to unit square (0,0)-(1,1)` (per PDF spec — image XObjects are drawn into a 1×1 unit square scaled by CTM).

The resulting rect is the `LayoutRect` for the `ExtractedImage`.

#### 3.6.3 Format conversion

PDF image objects can be in many formats: RGB, RGBA, Grayscale, indexed (palette), CMYK, JPEG-encoded (DCTDecode filter), JBIG2-encoded, JPX (JPEG-2000). The extractor:

- For raw raster (RGB / RGBA / Grayscale): convert to RGBA using a small pure-JS helper, then encode to PNG via `@napi-rs/canvas` (`createCanvas(w, h).getContext('2d').putImageData(...).canvas.toBuffer('image/png')`).
- For JPEG-encoded (`kind: 'JPEG'`): pass-through the raw bytes IF the writer accepts JPEG; else decode (via canvas's `loadImage(buffer)`) and re-encode as PNG.
- For CMYK / JBIG2 / JPX: convert via `@napi-rs/canvas`'s decoder (it handles JPX) or fall back to "render the page as raster and crop to the image rect" if conversion fails.
- For palette / indexed: expand to RGB via pdf.js's `objs.get(name)` which returns expanded RGBA already in most cases.

All output images are PNG-encoded `Uint8Array` (the writer's `ImageRun` / `slide.addImage` / `worksheet.addImage` accept PNG natively). Documented as a simplification — preserving JPEG-as-JPEG would reduce output file size for image-heavy PDFs (Phase 6.1 candidate).

#### 3.6.4 Skip threshold

Images smaller than 8×8 pixels OR with bounding rect area < 16 pt² are skipped (these are typically decorative bullets / glyphs that should be in the text layer, not standalone images). Configurable via `export.image.skipBelowPx` and `export.image.skipBelowAreaPt2`.

### 3.7 Form-field value extraction (P6-L-9 cross-cut)

The layout extractor's pdf.js `getTextContent` already sees Phase-3-flattened form values as native text. For unflattened AcroForms, the engine falls back to `pdfjs.PDFDocumentProxy.getFieldObjects()`:

```ts
async function getFlattenedFieldValues(
  doc: pdfjs.PDFDocumentProxy,
  pageIndex: number,
): Promise<Array<{ name: string; value: string; rect: LayoutRect }>> {
  const fields = await doc.getFieldObjects();
  if (!fields) return [];
  // Filter to the requested page
  return Object.entries(fields).flatMap(([name, fieldList]) =>
    fieldList
      .filter((f) => f.page === pageIndex)
      .map((f) => ({
        name,
        value: String(f.value ?? ''),
        rect: { x: f.rect[0], y: f.rect[1], w: f.rect[2] - f.rect[0], h: f.rect[3] - f.rect[1] },
      })),
  );
}
```

The engine integrates field values as additional paragraphs in the `ExtractedText` (positioned by the field rect) when they're not already in the text content. De-duplication: if a paragraph's text exactly matches a field value AND they overlap in position, the paragraph wins (it's the same value seen twice).

**XFA forms (Phase-3 read-only) are NOT in `getFieldObjects()`.** Trust-floor obligation #3 surfaces this honestly.

---

## 4. DOCX writer (P6-L-2)

### 4.1 docx-writer.ts surface

```ts
// src/main/export/writers/docx-writer.ts
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  AlignmentType,
  WidthType,
  BorderStyle,
} from 'docx';

export interface DocxWriter {
  write(doc: ExtractedDocument, opts: DocxWriteOptions): Promise<Uint8Array>;
}

export interface DocxWriteOptions {
  pageSize: 'letter' | 'a4' | 'auto'; // 'auto' = use source page size
  includeAnnotations: boolean;
  qualityTier: 'text-only' | 'layout-preserving';
}
```

### 4.2 Per-page handling (streaming)

```ts
async function writeDocxStream(
  stream: AsyncGenerator<ExtractedPage>,
  opts: DocxWriteOptions,
): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];

  // Optional TOC at the start (Phase 6 ships a flat list; bookmark-anchored TOC is Phase 6.1)
  // children.push(new TableOfContents('Contents', { hyperlink: false, headingStyleRange: '1-3' }));

  for await (const page of stream) {
    if (opts.qualityTier === 'text-only') {
      // Bypass table detection + image extraction
      for (const p of page.text?.paragraphs ?? []) {
        children.push(buildParagraph(p));
      }
    } else {
      // layout-preserving: emit paragraphs + tables + images in reading order
      const ordered = mergeByReadingOrder(page); // sorts by rect.y descending
      for (const item of ordered) {
        if (item.kind === 'paragraph') children.push(buildParagraph(item));
        else if (item.kind === 'table') children.push(buildTable(item));
        else if (item.kind === 'image') children.push(buildImageParagraph(item));
      }
    }

    // Annotations as inline trailing notes per page (if includeAnnotations)
    if (opts.includeAnnotations && page.annotations.length > 0) {
      for (const ann of page.annotations) {
        if (ann.text) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: `[Note: ${ann.text}]`, italics: true, color: '666666' }),
              ],
            }),
          );
        }
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: { page: { size: resolvePageSize(opts.pageSize) } },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
```

### 4.3 buildParagraph

```ts
function buildParagraph(p: ExtractedParagraph): Paragraph {
  const headingLevel =
    p.heading === 'H1'
      ? HeadingLevel.HEADING_1
      : p.heading === 'H2'
        ? HeadingLevel.HEADING_2
        : p.heading === 'H3'
          ? HeadingLevel.HEADING_3
          : undefined;

  const alignment =
    p.alignment === 'center'
      ? AlignmentType.CENTER
      : p.alignment === 'right'
        ? AlignmentType.RIGHT
        : AlignmentType.LEFT;

  return new Paragraph({
    ...(headingLevel !== undefined ? { heading: headingLevel } : {}),
    alignment,
    children: [
      new TextRun({
        text: p.text,
        bold: p.fontHints.bold ?? false,
        italics: p.fontHints.italic ?? false,
        ...(p.fontHints.sizePt !== undefined ? { size: Math.round(p.fontHints.sizePt * 2) } : {}), // docx size is half-points
      }),
    ],
  });
}
```

**Phase 5 exactOptionalPropertyTypes lesson applied:** never pass `undefined` to optional docx options; spread conditionally. See `learnings.jsonl` Wave 20 entry.

### 4.4 buildTable

```ts
function buildTable(t: TableRegion): Table {
  const rows = t.cells.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun(cell.text)] })],
              width: { size: 100 / t.columns, type: WidthType.PERCENTAGE },
            }),
        ),
      }),
  );
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '000000' } /* ...other 5 borders */,
    },
  });
}
```

### 4.5 buildImageParagraph

```ts
function buildImageParagraph(img: ExtractedImage): Paragraph {
  const widthEmu = Math.round((img.rect?.w ?? 100) * 9525); // 1 pt = 12700 EMU; but docx ImageRun uses pixels at 96 DPI → 9525 EMU/pt approximation
  const heightEmu = Math.round((img.rect?.h ?? 100) * 9525);
  return new Paragraph({
    children: [
      new ImageRun({
        data: img.bytes,
        transformation: { width: widthEmu / 9525, height: heightEmu / 9525 }, // docx expects pixels here
      }),
    ],
  });
}
```

**v1 simplification:** images flow inline (one image per paragraph, paragraph-positioned). Floating images with text-wrap are Phase 6.1.

### 4.6 Test coverage targets

- Layout-extractor unit tests: 4 fixture PDFs (simple-text / multi-column / table-with-borders / image-heavy) — corpus per conventions §13.6.
- docx-writer golden-bytes tests: 3 fixtures (text-only round-trip / table round-trip / image round-trip). The "golden bytes" pattern from Phase 5 searchable-pdf-builder applies — capture the docx zip's content.xml + media/\* and assert via canonical-XML compare (whitespace-insensitive).
- Targeting 16+ unit tests for docx-writer (mirror of Phase 5's ocr-text-layer test count).

---

## 5. XLSX writer (P6-L-3)

### 5.1 xlsx-writer.ts surface

```ts
// src/main/export/writers/xlsx-writer.ts
import ExcelJS from 'exceljs';

export interface XlsxWriter {
  write(doc: ExtractedDocument, opts: XlsxWriteOptions): Promise<Uint8Array>;
}

export interface XlsxWriteOptions {
  includeAnnotations: boolean;
  qualityTier: 'text-only' | 'layout-preserving';
}
```

### 5.2 Per-page handling

```ts
async function writeXlsxStream(
  stream: AsyncGenerator<ExtractedPage>,
  opts: XlsxWriteOptions,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PDF Viewer & Editor (Phase 6 export)';
  workbook.created = new Date();

  let pageNum = 0;
  for await (const page of stream) {
    pageNum++;

    // Table sheets (one per detected TableRegion on this page)
    page.tables.forEach((table, tableIndex) => {
      const sheetName = `Page${pageNum}_Table${tableIndex + 1}`.slice(0, 31); // Excel sheet name limit
      const ws = workbook.addWorksheet(sheetName);
      for (const row of table.cells) {
        ws.addRow(row.map((cell) => coerceCellValue(cell.text)));
      }
      // Simple alignment per cell type
      ws.eachRow((r) =>
        r.eachCell((c) => {
          c.alignment = { horizontal: typeof c.value === 'number' ? 'right' : 'left' };
        }),
      );
    });

    // Text sheet for non-table paragraphs (only in layout-preserving tier; text-only tier skips tables, emits ALL text into a single sheet per page)
    if (opts.qualityTier === 'layout-preserving' && page.text) {
      const ws = workbook.addWorksheet(`Text_Page${pageNum}`.slice(0, 31));
      page.text.paragraphs.forEach((p) => {
        if (!isInsideAnyTable(p.rect, page.tables)) {
          ws.addRow([p.text]);
        }
      });
    } else if (opts.qualityTier === 'text-only' && page.text) {
      const ws = workbook.addWorksheet(`Page${pageNum}`.slice(0, 31));
      page.text.paragraphs.forEach((p) => ws.addRow([p.text]));
    }
  }

  // Streaming write to buffer for memory efficiency on large workbooks
  return new Uint8Array(
    await workbook.xlsx.writeBuffer({ useSharedStrings: true, useStyles: true }),
  );
}

function coerceCellValue(text: string): string | number {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  const asNumber = Number(trimmed.replace(/,/g, '')); // tolerate thousands separators
  if (!Number.isNaN(asNumber) && /^-?\d+(\.\d+)?$/.test(trimmed.replace(/,/g, ''))) {
    return asNumber;
  }
  return text;
}
```

### 5.3 Streaming for large workbooks (R-W23-C)

exceljs supports a true streaming writer (`workbook.xlsx.createInputStream()`) for very-large workbooks. For Phase 6 v1 we use `writeBuffer({ useSharedStrings: true, useStyles: true })` which already de-duplicates strings (memory-efficient enough for typical PDFs of 100s of pages). Phase 6.1 can switch to the streaming writer if user-reported memory issues warrant.

### 5.4 Annotations: excluded by default

Per P6-L-8, Excel default `includeAnnotations = false`. The modal toggle CAN override; if true, an `Annotations` sheet is appended with `[Page, Kind, Text]` columns. Documented for completeness.

### 5.5 Test coverage targets

- xlsx-writer unit tests: 3 fixtures (table-with-borders → cells / table-with-numbers → numeric coercion / text-only-mode → single sheet).
- Golden-bytes pattern: capture `xl/worksheets/sheet1.xml` + `xl/sharedStrings.xml` and compare canonically.
- Targeting 12+ unit tests.

---

## 6. PPTX writer (P6-L-4)

### 6.1 pptx-writer.ts surface

```ts
// src/main/export/writers/pptx-writer.ts
import PptxGenJS from 'pptxgenjs';

export interface PptxWriter {
  write(doc: ExtractedDocument, opts: PptxWriteOptions): Promise<Uint8Array>;
}

export interface PptxWriteOptions {
  includeAnnotations: boolean;
  qualityTier: 'text-only' | 'layout-preserving';
}
```

### 6.2 Per-page handling (one slide per page)

```ts
async function writePptxStream(
  stream: AsyncGenerator<ExtractedPage>,
  opts: PptxWriteOptions,
): Promise<Uint8Array> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.333in × 7.5in (16:9 widescreen)
  pres.title = 'Exported from PDF';

  const slideW = 13.333;
  const slideH = 7.5;

  for await (const page of stream) {
    const slide = pres.addSlide();

    // Resolve scale: source pageSize → slide dimensions
    const sx = slideW / ptToIn(page.pageSize.widthPt);
    const sy = slideH / ptToIn(page.pageSize.heightPt);

    if (opts.qualityTier === 'text-only') {
      // Single text box per slide with all text concatenated
      const text = (page.text?.paragraphs ?? []).map((p) => p.text).join('\n\n');
      slide.addText(text, { x: 0.5, y: 0.5, w: slideW - 1, h: slideH - 1, fontSize: 12 });
    } else {
      // layout-preserving: position each paragraph + image + table by rect (scaled)
      for (const p of page.text?.paragraphs ?? []) {
        if (p.rect === null) continue;
        slide.addText(p.text, {
          x: ptToIn(p.rect.x) * sx,
          y: ptToIn(page.pageSize.heightPt - (p.rect.y + p.rect.h)) * sy, // PDF Y is bottom-up; PPTX Y is top-down
          w: ptToIn(p.rect.w) * sx,
          h: ptToIn(p.rect.h) * sy,
          fontSize: p.fontHints.sizePt ?? 12,
          bold: p.fontHints.bold ?? false,
          italic: p.fontHints.italic ?? false,
          align: p.alignment,
        });
      }
      for (const img of page.images) {
        if (img.rect === null) continue;
        slide.addImage({
          data: `data:image/png;base64,${Buffer.from(img.bytes).toString('base64')}`,
          x: ptToIn(img.rect.x) * sx,
          y: ptToIn(page.pageSize.heightPt - (img.rect.y + img.rect.h)) * sy,
          w: ptToIn(img.rect.w) * sx,
          h: ptToIn(img.rect.h) * sy,
        });
      }
      for (const t of page.tables) {
        if (t.rect === null) continue;
        slide.addTable(
          t.cells.map((row) => row.map((cell) => ({ text: cell.text }))),
          {
            x: ptToIn(t.rect.x) * sx,
            y: ptToIn(page.pageSize.heightPt - (t.rect.y + t.rect.h)) * sy,
            w: ptToIn(t.rect.w) * sx,
            h: ptToIn(t.rect.h) * sy,
          },
        );
      }
    }

    if (opts.includeAnnotations) {
      // Annotations as a footer text box; speaker notes are Phase 6.1
      const annLines = page.annotations.filter((a) => a.text).map((a) => `[${a.kind}] ${a.text}`);
      if (annLines.length > 0) {
        slide.addText(annLines.join('\n'), {
          x: 0.3,
          y: slideH - 1,
          w: slideW - 0.6,
          h: 0.9,
          fontSize: 9,
          color: '666666',
          italic: true,
        });
      }
    }
  }

  return new Uint8Array((await pres.write({ outputType: 'nodebuffer' })) as Buffer);
}

function ptToIn(pt: number): number {
  return pt / 72;
}
```

### 6.3 Async wrap (R-W23-D)

pptxgenjs's `pres.write()` returns a Promise of `Buffer | Blob | string` depending on `outputType`. We use `outputType: 'nodebuffer'` and await the Promise. The library blocks on internal sync zip-build for large presentations — bounded by the per-page streaming pattern in §3.3.

### 6.4 Test coverage targets

- pptx-writer unit tests: 3 fixtures (text-only-mode / single-image-per-slide / table-on-slide).
- Golden-bytes: capture `ppt/slides/slide1.xml` + `ppt/media/*` and compare canonically.
- Targeting 12+ unit tests.

---

## 7. Image writer (P6-L-5; Q-F)

### 7.1 image-writer.ts surface

```ts
// src/main/export/writers/image-writer.ts
import { createCanvas } from '@napi-rs/canvas';
import * as UTIF from 'utif';

export interface ImageWriter {
  /** Returns ONE buffer per page for single-page formats; ONE buffer total for multi-page TIFF. */
  write(
    doc: ExtractedDocument,
    source: SourceDocumentHandle,
    opts: ImageWriteOptions,
  ): Promise<Uint8Array[]>;
}

export interface ImageWriteOptions {
  format: 'png' | 'jpeg' | 'tiff';
  dpi: number; // 72-600
  jpegQuality?: number; // 0.1-1.0; default 0.9
  multiPageTiff?: boolean; // for tiff only
  includeAnnotations: boolean; // controls pdfjs annotationMode
}
```

### 7.2 Rasterization (reuses Phase 4.1 + Phase 5 path)

```ts
async function rasterizePage(
  source: SourceDocumentHandle,
  pageIndex: number,
  dpi: number,
  includeAnnotations: boolean,
): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  const page = await source.pdfjsDoc.getPage(pageIndex + 1);
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
    annotationMode: includeAnnotations ? 2 /* AnnotationMode.ENABLE */ : 0 /* DISABLE */,
  }).promise;
  return {
    rgba: new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer),
    width: canvas.width,
    height: canvas.height,
  };
}
```

### 7.3 Encoding

```ts
async function encodePage(
  rgba: Uint8Array,
  width: number,
  height: number,
  format: ImageWriteOptions['format'],
  jpegQuality?: number,
): Promise<Uint8Array> {
  if (format === 'tiff') {
    // utif expects RGBA input
    const ifd = { width, height, data: rgba, t258: [8, 8, 8, 8] }; // bits per sample
    return new Uint8Array(UTIF.encodeImage(rgba, width, height));
  }
  // PNG / JPEG via canvas
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  imgData.data.set(rgba);
  ctx.putImageData(imgData, 0, 0);
  if (format === 'png') {
    return canvas.toBuffer('image/png');
  } else {
    return canvas.toBuffer('image/jpeg', { quality: jpegQuality ?? 0.9 });
  }
}
```

### 7.4 Multi-page TIFF bundling

```ts
async function encodeMultiPageTiff(
  pages: Array<{ rgba: Uint8Array; width: number; height: number }>,
): Promise<Uint8Array> {
  // utif.encode([{...IFD1}, {...IFD2}, ...]) returns a multi-page TIFF buffer
  const ifds = pages.map((p) => {
    const ifd: any = { width: p.width, height: p.height, data: p.rgba, t258: [8, 8, 8, 8] };
    UTIF.encodeImage(p.rgba, p.width, p.height); // utif populates the IFD internally
    return ifd;
  });
  return new Uint8Array(UTIF.encode(ifds));
}
```

### 7.5 Output naming

- Single-page formats (PNG, JPEG, single TIFF): one file per page, named `<basename>-page<NNN>.<ext>` (zero-padded to width of `String(totalPages).length`).
- Multi-page TIFF: one file at `<basename>.tiff`.

The engine handles the rename pattern internally; the user picks ONE output path in the SAVE-AS dialog (a basename for single-page; the full path for multi-page).

### 7.6 Test coverage targets

- image-writer unit tests: 4 fixtures (PNG / JPEG-quality-0.5 / TIFF-single / TIFF-multi-page).
- File-signature assertions on encoded bytes (PNG header `89 50 4E 47`, JPEG `FF D8 FF`, TIFF `49 49 2A 00` or `4D 4D 00 2A`).
- Targeting 10+ unit tests.

---

## 8. Job lifecycle

### 8.1 IPC sequence

```
renderer (modal)                    main (handler)                  main (engine + queue)            disk

submit export job
─────────────────────►   export:toDocx(req)
                        ├─ zod validate
                        ├─ insert export_jobs row (status='queued')
                        └─ queue.enqueue({ jobId, spec })
                                                                    ◄─ ready to run; dequeue immediately if idle
                                                                    ├─ updateStatus(jobId, 'running', started_at)
                                                                    ├─ emit export:progress { phase: 'starting' }
                                                                    │
                                                                    ├─ async for page in extractPagesStream():
                                                                    │   ├─ emit export:progress { phase: 'extracting-text', pageIndex }
                                                                    │   ├─ layoutExtractor.extract(...)
                                                                    │   ├─ emit export:progress { phase: 'detecting-tables', pageIndex }
                                                                    │   ├─ tableDetector.detect(...)
                                                                    │   ├─ emit export:progress { phase: 'extracting-images', pageIndex }
                                                                    │   ├─ imageExtractor.extract(...)
                                                                    │   └─ writer.handlePage(page)
                                                                    │
                                                                    ├─ emit export:progress { phase: 'writing-output' }
                                                                    ├─ writer.finalize() → output Uint8Array
                                                                    ├─ fs.writeFile(`${outputPath}.export-temp`, bytes)
                                                                    ├─ fs.rename(`${outputPath}.export-temp`, outputPath)        ──► output on disk
                                                                    ├─ updateStatus(jobId, 'completed', completed_at, duration_ms)
                                                                    ├─ updateProgress(jobId, pages, paragraphs, tables, images, sizeBytes)
                                                                    └─ emit export:progress { phase: 'completed', summary }
status-bar / sidebar         ◄────────────  summary
update via subscription
```

### 8.2 Event stream shape

`export:progress` event types are enumerated in `api-contracts.md §17.5`. The engine throttles `extracting-text` / `detecting-tables` / `extracting-images` events to ≤ 10/sec per phase per page to prevent renderer rerender storms. The throttle is implemented in `export-engine.ts` (single funnel) via a per-job last-emit-timestamp map.

### 8.3 Cancellation

`export:cancelJob` is **graceful**:

1. The queue sets the per-job `AbortSignal.abort()`.
2. The engine checks `signal.aborted` at three points: at the start of each page (between pages), after `layoutExtractor.extract()` completes, after `tableDetector.detect()` completes.
3. On abort: writer's `finalize()` is NOT called; any partial in-memory output is discarded; the `.export-temp` file (if created) is `fs.unlink`'d.
4. `updateStatus(jobId, 'cancelled', completed_at, duration_ms)` records the partial-page state.
5. Emit `export:progress { phase: 'cancelled', pagesCompleted, totalPages }`.

Mid-page cancellation is NOT in v1 (the writer libraries' per-cell / per-paragraph synchronous loops don't accept abort signals natively). Phase 6.1 candidate.

### 8.4 Modal close vs job continuation

Per Q-E + P6-L-6 (background queue):

- Closing the modal does NOT cancel the job. The job continues in the background.
- The user can re-open the modal to monitor (it switches to the in-flight job's progress step) OR check the status-bar widget OR the Exports sidebar tab.
- Explicit cancel requires clicking the Cancel button (in the modal, the status-bar widget, or the sidebar row).

### 8.5 Atomic write (R-W23-E)

Output is written via the `.export-temp` → `rename` pattern:

```ts
async function writeAtomic(outputPath: string, bytes: Uint8Array): Promise<void> {
  const tmpPath = `${outputPath}.export-temp`;
  await fs.writeFile(tmpPath, bytes);
  await fs.rename(tmpPath, outputPath); // atomic on same-volume; fallback to copy+unlink on cross-volume
}
```

`fs.rename` is atomic on the same filesystem volume per POSIX semantics (Windows `MoveFileExW` honors `MOVEFILE_REPLACE_EXISTING`). If the rename fails (typically because the destination is locked by another process — e.g. user has the previous output file open in Word), the engine emits `export:progress { phase: 'failed', error: 'output_path_unwritable' }` and the user can retry.

---

## 9. Wave 25 Julian audit checklist (mechanical greps)

Per the conventions §17.8 mechanical-grep pattern from Phase 5, Wave 25 Julian runs these checks. False positives are acceptable; false negatives are not.

| Check                                                                | Grep                                                                              | Expected                                                                                                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| No `as any` in writers                                               | `grep -rn 'as any' src/main/export/writers/`                                      | ZERO matches; any match is a code-comment-contradiction candidate per Julian Wave 21 H-21.1                                            |
| No `@ts-ignore` in writers                                           | `grep -rn '@ts-ignore' src/main/export/writers/`                                  | ZERO matches                                                                                                                           |
| `LayoutRect` is nullable everywhere it appears                       | `grep -rn 'LayoutRect' src/main/export/` followed by manual scan                  | every consumer pattern-matches on null                                                                                                 |
| No sentinel `{x: 0, y: 0, w: 0, h: 0}` returned from extractors      | `grep -n 'x: 0, y: 0, w: 0, h: 0' src/main/export/`                               | ZERO matches                                                                                                                           |
| Required-on-interface writer deps                                    | `grep -A 5 'interface RegisterExportOptions' src/main/export/export-engine.ts`    | all four writers REQUIRED (no `?`)                                                                                                     |
| Single-funnel — only export-engine.ts imports the format libs        | `grep -rn "from 'docx'" src/`                                                     | ONE file: `src/main/export/writers/docx-writer.ts`                                                                                     |
|                                                                      | `grep -rn "from 'pptxgenjs'" src/`                                                | ONE file: `src/main/export/writers/pptx-writer.ts`                                                                                     |
| exceljs WRITE side does not contaminate Phase 3 mail-merge READ side | `grep -rn "from 'exceljs'" src/`                                                  | TWO files: `src/main/forms/mail-merge.ts` (Phase 3 read) + `src/main/export/writers/xlsx-writer.ts` (Phase 6 write); no third location |
| Atomic write pattern                                                 | `grep -rn '\.export-temp' src/main/export/`                                       | one location: `export-engine.ts` writeAtomic helper                                                                                    |
| Cancel signal checked at three points per §8.3                       | `grep -n 'signal.aborted' src/main/export/export-engine.ts`                       | THREE matches per the spec                                                                                                             |
| Trust-floor obligations surface in conventions §17.3                 | `grep -n 'trust.floor\|honesty' docs/conventions.md`                              | non-zero match count                                                                                                                   |
| Required-on-modal limitations panel                                  | `grep -rn 'PerFormatLimitationsPanel' src/client/components/modals/export-modal/` | one mount per format                                                                                                                   |

---

## 10. Cross-reference checklist (Wave 23 self-verification)

- [x] Engine selection rationale — docx, exceljs (reuse), pptxgenjs, canvas (reuse) (§2)
- [x] Single funnel pattern (§3.1)
- [x] ExtractedDocument shape — nullable LayoutRect everywhere (§3.2)
- [x] Per-page streaming for bounded memory (§3.3; R-W23-B mitigation)
- [x] Layout extractor algorithm — 8 steps + R-W23-A multi-column handling (§3.4)
- [x] Table detector — line-grid 5-step algorithm + honest failure modes (§3.5)
- [x] Image extractor — operator-stream walk + CTM tracking + format conversion (§3.6)
- [x] Form-field value extraction — `getFieldObjects()` fallback + XFA honest exclusion (§3.7)
- [x] DOCX writer surface — Q-A scope locked (§4)
- [x] XLSX writer surface — Q-D Excel-text-only default + streaming for large workbooks (§5; R-W23-C)
- [x] PPTX writer surface — async wrap + R-W23-D (§6)
- [x] Image writer — Q-F defaults: PNG default, JPEG quality slider, TIFF multi-page toggle (§7)
- [x] Job lifecycle — IPC sequence + cancellation + atomic write (§8; R-W23-E)
- [x] Wave 25 Julian audit mechanical-grep checklist (§9)
- [x] Anti-stub-shipped-with-TODO at writer interface (§4 + cross-ref architecture-phase-6 §4.4.5)
- [x] Code-comment-contradiction discipline — no `as any`, no `@ts-ignore` (§9 + conventions §17.5)

End of Phase-6 export-engine detailed design.
