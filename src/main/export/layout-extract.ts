// Layout extractor (Phase 6, export-engine.md §3.4)
//
// Bounding-box clustering recipe over pdf.js getTextContent() output:
//
//   1. Atoms — convert raw pdfjs text-items into typed atoms (x/y/w/h in PDF pts).
//   2. Lines — Y-coord cluster (epsilon configurable, default 2pt).
//   3. Paragraphs — gap detection (> 1.5x median line-height = new paragraph).
//   4. Columns — X-coord cluster for multi-column re-ordering.
//   5. Headings — font-size delta vs body median (H1=1.8x, H2=1.5x, H3=1.3x).
//   6. Alignment — left/center/right by x-position relative to page width.
//   7. Font hints — bold/italic by font-name regex.
//   8. Empty-page guard — return `null` for image-only pages (NOT an empty
//      ExtractedText with 0 paragraphs — anti-sentinel discipline).
//
// Returns `ExtractedText | null`:
//   - Non-null when at least ONE text fragment was extracted.
//   - Null when textContent.items.length === 0 (image-only / blank page).
//   - Paragraphs are reading-ordered (top-to-bottom, columns left-to-right).
//
// Thresholds (lineEpsilonPt, paragraphBreakRatio, headingRatio, columnGapPt)
// come from `LayoutSettings`; defaults match common PDF layouts.

import type {
  ExtractedParagraph,
  ExtractedText,
  LayoutRect,
  LayoutSettings,
  PageSize,
  PdfTextContent,
  PdfTextItem,
} from './types.js';

interface Atom {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontName: string;
  fontSizePt: number;
}

interface Line {
  y: number;
  height: number;
  fontSize: number;
  x: number;
  width: number;
  atoms: Atom[];
  text: string;
}

interface ParagraphInternal {
  lines: Line[];
  rect: LayoutRect;
  fontSize: number;
  fontName: string;
  text: string;
}

// ---- Step 1: atoms ---------------------------------------------------------

function itemToAtom(item: PdfTextItem): Atom | null {
  // pdf.js spacers and zero-width fragments — skip.
  if (item.str.length === 0) return null;
  const [a, , , , e, f] = item.transform;
  const fontScale = Math.abs(a);
  // pdf.js item.height is the font-bbox height in user-space; treat it as line
  // height. fontSize approximation: height / 0.7 (the typical ascender ratio
  // for Latin fonts; documented honestly in export-engine.md §3.4.1).
  const h = item.height || fontScale || 12;
  const fontSizePt = h / 0.7;
  return {
    text: item.str,
    x: e,
    y: f,
    w: Math.max(item.width, 0),
    h,
    fontName: item.fontName,
    fontSizePt,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((p, q) => p - q);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// ---- Step 2: cluster atoms into lines -------------------------------------
//
// Two-pass clustering — first by Y (within epsilon), then split each Y-bucket
// by X-gap (atoms with x-gap > 5x median atom-width are separate lines on the
// same Y row — that's the multi-column layout case). This is the multi-column
// safety net BEFORE column-detection runs at the paragraph stage.

export function clusterAtomsIntoLines(atoms: Atom[], lineEpsilonPt: number): Line[] {
  if (atoms.length === 0) return [];
  const sorted = [...atoms].sort((p, q) => q.y - p.y); // top-to-bottom
  const lines: Line[] = [];

  let current: Atom[] = [];
  let currentY = Number.NaN;
  for (const atom of sorted) {
    if (Number.isNaN(currentY) || Math.abs(atom.y - currentY) <= lineEpsilonPt) {
      current.push(atom);
      currentY = Number.isNaN(currentY) ? atom.y : currentY;
    } else {
      // Flush current Y-bucket — splitting into multiple lines if there's a
      // huge X-gap between atoms (multi-column rows).
      for (const sub of splitYBucketByXGap(current)) {
        lines.push(linesFrom(sub));
      }
      current = [atom];
      currentY = atom.y;
    }
  }
  if (current.length > 0) {
    for (const sub of splitYBucketByXGap(current)) {
      lines.push(linesFrom(sub));
    }
  }
  return lines;
}

/** Split a Y-aligned bucket of atoms into separate lines when the X-gap
 *  between consecutive atoms is more than 40pt (matches the default
 *  `columnGapPt` threshold). This is the multi-column detection signal at
 *  the LINE level — without it, "Left col" and "Right col" at the same Y
 *  merge into one paragraph spanning the page. The 40pt floor is consistent
 *  with the column-detection threshold at the paragraph stage so the two
 *  passes agree.
 *
 *  We use the MEDIAN line height (≈ font size) as the secondary scale: a
 *  gap of more than ~3x the line height is conclusive evidence of a
 *  column break. */
function splitYBucketByXGap(atoms: Atom[]): Atom[][] {
  if (atoms.length <= 1) return [atoms];
  const sortedLR = [...atoms].sort((p, q) => p.x - q.x);
  const heights = sortedLR.map((a) => a.h).filter((h) => h > 0);
  const medianH = median(heights.length > 0 ? heights : [10]);
  // 40pt OR 3x line height, whichever is larger — that's the column-gap
  // detection threshold from the paragraph-stage column algorithm.
  const threshold = Math.max(40, medianH * 3);
  const groups: Atom[][] = [];
  let group: Atom[] = [sortedLR[0]!];
  for (let i = 1; i < sortedLR.length; i++) {
    const prev = group[group.length - 1]!;
    const cur = sortedLR[i]!;
    const gap = cur.x - (prev.x + prev.w);
    if (gap > threshold) {
      groups.push(group);
      group = [cur];
    } else {
      group.push(cur);
    }
  }
  groups.push(group);
  return groups;
}

function linesFrom(members: Atom[]): Line {
  const sortedLeftToRight = [...members].sort((p, q) => p.x - q.x);
  const ys = sortedLeftToRight.map((m) => m.y);
  const heights = sortedLeftToRight.map((m) => m.h);
  const sizes = sortedLeftToRight.map((m) => m.fontSizePt);
  // Concatenate text with adaptive spacing.
  let text = '';
  let prevRight = -Infinity;
  const medianH = median(heights);
  for (const a of sortedLeftToRight) {
    const gap = a.x - prevRight;
    if (text.length > 0 && gap > 0.5 * medianH) {
      // visible gap → insert a space (if missing)
      if (!text.endsWith(' ') && !a.text.startsWith(' ')) text += ' ';
    }
    text += a.text;
    prevRight = a.x + a.w;
  }
  const minX = Math.min(...sortedLeftToRight.map((m) => m.x));
  const maxRight = Math.max(...sortedLeftToRight.map((m) => m.x + m.w));
  return {
    y: median(ys),
    height: medianH,
    fontSize: median(sizes),
    x: minX,
    width: maxRight - minX,
    atoms: sortedLeftToRight,
    text,
  };
}

// ---- Step 3: cluster lines into paragraphs --------------------------------

function linesIntoParagraphs(lines: Line[], paragraphBreakRatio: number): ParagraphInternal[] {
  if (lines.length === 0) return [];
  const medianLineHeight = median(lines.map((l) => l.height));
  const yThreshold = paragraphBreakRatio * medianLineHeight;
  // X-discontinuity threshold: lines whose X centers differ by more than
  // 40pt (matches columnGapPt floor) belong to DIFFERENT paragraphs, even
  // when Y gap is small. Without this, multi-column rows merge.
  const xDiscontinuity = 40;

  // First pass — group lines whose X centers are close (paragraph-by-X-cluster)
  // and whose Y gap is small. We process lines in input order (top-to-bottom
  // already) but split a group whenever the X-center changes substantially
  // OR the Y-gap exceeds the paragraph-break threshold.
  const paragraphs: ParagraphInternal[] = [];
  let group: Line[] = [];
  const xCenter = (l: Line): number => l.x + l.width / 2;
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]!;
    if (group.length === 0) {
      group.push(cur);
      continue;
    }
    const prev = group[group.length - 1]!;
    const yGap = prev.y - cur.y - prev.height;
    const xGap = Math.abs(xCenter(cur) - xCenter(prev));
    if (yGap > yThreshold || xGap > xDiscontinuity) {
      paragraphs.push(paragraphFrom(group));
      group = [cur];
    } else {
      group.push(cur);
    }
  }
  if (group.length > 0) paragraphs.push(paragraphFrom(group));
  return paragraphs;
}

function paragraphFrom(group: Line[]): ParagraphInternal {
  const text = group.map((l) => l.text).join(' ');
  const xs = group.map((l) => l.x);
  const rights = group.map((l) => l.x + l.width);
  const minX = Math.min(...xs);
  const maxRight = Math.max(...rights);
  // y-rect: top = max(line.y + line.height); bottom = min(line.y)
  const topY = Math.max(...group.map((l) => l.y + l.height));
  const bottomY = Math.min(...group.map((l) => l.y));
  const rect: LayoutRect = {
    x: minX,
    y: bottomY,
    w: maxRight - minX,
    h: topY - bottomY,
  };
  // pick the most common font name as the paragraph's representative
  const fontCount = new Map<string, number>();
  for (const l of group)
    for (const a of l.atoms) fontCount.set(a.fontName, (fontCount.get(a.fontName) ?? 0) + 1);
  let pickedFont = '';
  let bestCount = -1;
  for (const [name, count] of fontCount) {
    if (count > bestCount) {
      bestCount = count;
      pickedFont = name;
    }
  }
  return {
    lines: group,
    rect,
    fontSize: median(group.map((l) => l.fontSize)),
    fontName: pickedFont,
    text,
  };
}

// ---- Step 4: detect columns (multi-column re-ordering) --------------------

function detectColumns(
  paragraphs: ParagraphInternal[],
  pageWidth: number,
  columnGapPt: number,
): { ordered: ParagraphInternal[]; columnsDetected: number } {
  if (paragraphs.length <= 1) {
    return { ordered: paragraphs, columnsDetected: 1 };
  }
  // Cluster by rect.x (paragraphs whose x values are within 5% of pageWidth).
  const tolerance = Math.max(pageWidth * 0.05, 5);
  const clusters: Array<{ x: number; members: ParagraphInternal[] }> = [];
  for (const p of paragraphs) {
    if (p.rect === null) continue;
    let placed = false;
    for (const c of clusters) {
      if (Math.abs(c.x - p.rect.x) <= tolerance) {
        c.members.push(p);
        c.x = (c.x * (c.members.length - 1) + p.rect.x) / c.members.length;
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ x: p.rect.x, members: [p] });
  }
  clusters.sort((a, b) => a.x - b.x);

  // If only ONE cluster, single-column.
  if (clusters.length === 1) {
    return {
      ordered: orderTopToBottom(paragraphs),
      columnsDetected: 1,
    };
  }
  // Multi-column requires meaningful X separation between clusters.
  let maxGap = 0;
  for (let i = 1; i < clusters.length; i++) {
    const gap = clusters[i]!.x - clusters[i - 1]!.x;
    if (gap > maxGap) maxGap = gap;
  }
  if (maxGap < columnGapPt) {
    return {
      ordered: orderTopToBottom(paragraphs),
      columnsDetected: 1,
    };
  }
  // Reading order: column-by-column, top-to-bottom per column.
  const ordered: ParagraphInternal[] = [];
  for (const c of clusters) {
    ordered.push(...orderTopToBottom(c.members));
  }
  return { ordered, columnsDetected: clusters.length };
}

function orderTopToBottom(paragraphs: ParagraphInternal[]): ParagraphInternal[] {
  return [...paragraphs].sort((a, b) => {
    const ay = a.rect?.y ?? 0;
    const ah = a.rect?.h ?? 0;
    const by = b.rect?.y ?? 0;
    const bh = b.rect?.h ?? 0;
    return by + bh - (ay + ah); // top first (higher PDF Y first)
  });
}

// ---- Step 5: detect headings -----------------------------------------------

function classifyHeading(
  fontSizePt: number,
  bodyMedian: number,
  headingRatio: number,
): 'H1' | 'H2' | 'H3' | null {
  if (bodyMedian <= 0) return null;
  const ratio = fontSizePt / bodyMedian;
  if (ratio >= 1.8) return 'H1';
  if (ratio >= 1.5) return 'H2';
  if (ratio >= headingRatio) return 'H3';
  return null;
}

// ---- Step 6: detect alignment ---------------------------------------------

function classifyAlignment(rect: LayoutRect, pageWidth: number): 'left' | 'center' | 'right' {
  if (rect === null || pageWidth <= 0) return 'left';
  const leftMargin = rect.x / pageWidth;
  const rightMargin = (rect.x + rect.w) / pageWidth;
  const center = (rect.x + rect.w / 2) / pageWidth;
  const isCentered = rect.w < pageWidth * 0.7 && Math.abs(center - 0.5) < 0.05 && leftMargin > 0.15;
  if (isCentered) return 'center';
  if (rightMargin > 0.85 && leftMargin > 0.5) return 'right';
  return 'left';
}

// ---- Step 7: detect font hints --------------------------------------------

function detectBold(fontName: string): boolean {
  return /Bold|Black|Heavy|Semibold/i.test(fontName);
}

function detectItalic(fontName: string): boolean {
  return /Italic|Oblique/i.test(fontName);
}

// ---- Main extract entry point ----------------------------------------------

export interface LayoutExtractor {
  extract(
    textContent: PdfTextContent,
    pageSize: PageSize,
    settings?: Partial<LayoutSettings>,
  ): ExtractedText | null;
}

export function createLayoutExtractor(baseSettings?: Partial<LayoutSettings>): LayoutExtractor {
  return {
    extract(textContent, pageSize, settings) {
      const cfg: LayoutSettings = {
        lineEpsilonPt: 2,
        paragraphBreakRatio: 1.5,
        headingRatio: 1.3,
        columnGapPt: 40,
        ...baseSettings,
        ...settings,
      };
      // Step 8 (early): empty-page guard. ANTI-SENTINEL: return null, never
      // an empty ExtractedText.
      if (textContent.items.length === 0) return null;

      const atoms: Atom[] = [];
      for (const item of textContent.items) {
        const a = itemToAtom(item);
        if (a) atoms.push(a);
      }
      if (atoms.length === 0) return null;

      // Step 2: cluster atoms into lines.
      const lines = clusterAtomsIntoLines(atoms, cfg.lineEpsilonPt);
      if (lines.length === 0) return null;

      // Step 3: cluster lines into paragraphs.
      const paragraphs = linesIntoParagraphs(lines, cfg.paragraphBreakRatio);

      // Step 4: detect columns + re-order.
      const { ordered, columnsDetected } = detectColumns(
        paragraphs,
        pageSize.widthPt,
        cfg.columnGapPt,
      );

      // Body-font median: use the MODE of font sizes (bucketed to 1pt
      // precision) so a single giant heading doesn't pull the median up. If
      // the mode is tied, prefer the SMALLER size (heading is rare; body is
      // the common case). This is the standard anti-outlier discipline —
      // without it, a doc with one giant title shifts the median enough to
      // mis-classify itself as body.
      const bodyMedian = (() => {
        const sizes = ordered.filter((p) => p.text.length > 0).map((p) => p.fontSize);
        if (sizes.length === 0) return 0;
        const buckets = new Map<number, number>();
        for (const s of sizes) {
          const k = Math.round(s);
          buckets.set(k, (buckets.get(k) ?? 0) + 1);
        }
        let bestSize = sizes[0]!;
        let bestCount = 0;
        for (const [size, count] of buckets) {
          if (count > bestCount || (count === bestCount && size < bestSize)) {
            bestCount = count;
            bestSize = size;
          }
        }
        return bestSize;
      })();

      // Steps 5-7: heading + alignment + font-hints per paragraph.
      const final: ExtractedParagraph[] = ordered.map((p) => ({
        text: p.text,
        rect: p.rect,
        heading: classifyHeading(p.fontSize, bodyMedian, cfg.headingRatio),
        alignment: classifyAlignment(p.rect, pageSize.widthPt),
        fontHints: {
          bold: detectBold(p.fontName),
          italic: detectItalic(p.fontName),
          sizePt: p.fontSize,
        },
      }));
      return {
        paragraphs: final,
        columnsDetected,
      };
    },
  };
}
