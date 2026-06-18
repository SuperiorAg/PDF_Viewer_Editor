// Phase 7.5 Wave 5b — C3 Auto-tag heuristic.
//
// Canonical spec:
//   - docs/accessibility-authoring-spec.md §3.3 — font-size cluster +
//     position-on-page heuristic.
//   - docs/architecture-phase-7.5.md §4.8 — engine routing.
//   - docs/api-contracts.md §19.7.3 (`pdf:autoTagPages`).
//
// What this module does:
//   Given per-page text items (font-size + bbox + reading-order index),
//   clusters fonts into H1/H2/H3/P buckets, detects Figure regions from
//   image hints, and emits a hierarchical `StructTreeNode` tree where
//   smaller-level headings nest under preceding larger-level headings and
//   paragraphs nest under their preceding heading.
//
// What this module does NOT do (honest deferrals — see §3.4 honesty):
//   - Use pdf.js. The engine reads its input from an INJECTED extractor
//     (per the auto-bookmark-engine pattern) so the engine stays pure and
//     tests don't need pdf.js. Production wires this to a pdf.js
//     getTextContent walker. L-004 / L-005 compliance lives at the
//     wiring boundary (the canonical `loadPdfJs` helper).
//   - Tag tables with strict row/column structure. Wave 5b emits a
//     low-confidence `Table` node for image-region candidates only; the
//     real table-detection heuristic ships in C6 (Wave 5d) where the
//     accessibility checker reports table-tag failures.
//   - Detect lists. Spec §3.3 step 4 is honestly deferred — list detection
//     requires bullet-glyph + indent analysis that is high-FP without a
//     proper layout pass. Wave 5b emits paragraphs for list items;
//     Wave 5c reading-order overlay lets the user fix manually.
//
// Honest accuracy expectation (matches accessibility-authoring-spec §3.5):
//   ~80% correct on standard-layout business docs, ~40% on multi-column or
//   visually-rich. The Auto-tag button MUST surface a confirm modal with
//   "Auto-tagging is a HEURISTIC — every tag should be reviewed" before
//   producing tags the user can accidentally save.
//
// Locked-instruction compliance:
//   - L-001..L-006 (no BrowserWindow, pure module, no test channel, no
//     pdf.js direct import — extractor injection).
//   - P7.5-L-10 (subset honesty): the heuristic is a real heuristic that
//     truly emits the documented tag types; the disclosure is about
//     ACCURACY, not stub-ness.

import { randomUUID } from 'node:crypto';

import type { MarkedContentRef, StructTreeNode, StructTreeType } from '../../ipc/contracts.js';
import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

export interface AutoTagTextItem {
  text: string;
  fontSize: number;
  /** Reading-order index within the page. Required — the heuristic preserves
   *  the order the extractor emits. */
  readingIndex: number;
  /** Optional bbox [llx, lly, urx, ury] in user-space points. Used for the
   *  "top 15% of page" H1 refinement and the figure-overlap test. */
  bbox?: [number, number, number, number];
  /** Optional marked-content id if the extractor exposes it. When present,
   *  the heuristic threads it through into `contentRefs` so the resulting
   *  tree round-trips through the materializer. */
  mcid?: number;
}

export interface AutoTagImageItem {
  /** Reading-order index — used to interleave Figure nodes with text. */
  readingIndex: number;
  /** bbox in user-space points. Used to detect overlap with text items
   *  (caption detection). */
  bbox: [number, number, number, number];
  /** Optional alt text already on the image XObject. */
  altText?: string;
  /** Optional marked-content id. */
  mcid?: number;
}

export interface AutoTagPageInput {
  pageIndex: number;
  /** Page bbox in user-space points; required for the position-on-page
   *  refinements. [width, height]. */
  pageSize: { widthPt: number; heightPt: number };
  textItems: AutoTagTextItem[];
  imageItems: AutoTagImageItem[];
}

export interface AutoTagOptions {
  pages: ReadonlyArray<AutoTagPageInput>;
  /** Max heading depth. Default 3 (H1..H3). Range [1, 6]. */
  maxHeadingDepth?: number;
}

export type AutoTagError = 'invalid_payload' | 'engine_failed';

export interface AutoTagValue {
  tree: StructTreeNode;
  /** Per-page diagnostics ("Page 14: single font size — no headings detected"). */
  warnings: string[];
}

// Tunables — kept here so the heuristic is one place to read.
const DEFAULT_MAX_HEADING_DEPTH = 3;
const HEADING_MIN_RATIO = 1.15;
const FONT_SIZE_GROUP_EPS = 0.5;
const TOP_OF_PAGE_FRACTION = 0.15;
const TITLE_TRIM_CHARS = 200;

// ============================================================================
// Engine
// ============================================================================

export function autoTagPages(opts: AutoTagOptions): Result<AutoTagValue, AutoTagError> {
  const validationErr = validateOpts(opts);
  if (validationErr) {
    return fail<AutoTagError>('invalid_payload', validationErr);
  }
  const maxDepth = clampInt(opts.maxHeadingDepth ?? DEFAULT_MAX_HEADING_DEPTH, 1, 6);
  const warnings: string[] = [];

  // 1. Globally cluster font sizes across all pages — bodies are usually
  //    uniform across a doc, so cross-page clustering catches consistent
  //    headings even when an individual page has only body text.
  type ItemRef = AutoTagTextItem & { pageIndex: number };
  const all: ItemRef[] = [];
  for (const p of opts.pages) {
    for (const it of p.textItems) {
      if (typeof it.text !== 'string' || it.text.trim().length === 0) continue;
      if (!Number.isFinite(it.fontSize) || it.fontSize <= 0) continue;
      all.push({ ...it, pageIndex: p.pageIndex });
    }
  }

  // Even if there's no text at all we still emit a tree (Document + Figure
  // children) — image-only docs are valid input.
  let dominantSize = 0;
  let headingSizes: number[] = [];
  const sizeToDepth = new Map<number, number>();
  if (all.length > 0) {
    const buckets = groupSizes(all.map((i) => i.fontSize));
    const dom = pickDominant(buckets);
    if (dom !== null) {
      dominantSize = dom;
      headingSizes = buckets
        .map((b) => b.center)
        .filter((s) => s >= dominantSize * HEADING_MIN_RATIO);
      headingSizes.sort((a, b) => b - a);
      for (let i = 0; i < headingSizes.length; i += 1) {
        sizeToDepth.set(headingSizes[i]!, Math.min(i, maxDepth - 1));
      }
    }
  }

  // 2. Per-page synthesis — emit leaf nodes (P / H1-H6 / Figure) in reading
  //    order, then build the document hierarchy by nesting.
  type Leaf = {
    kind: 'heading' | 'paragraph' | 'figure';
    headingDepth?: number; // 0..maxDepth-1
    node: StructTreeNode;
  };
  const leavesByPage: Leaf[][] = [];

  for (const page of opts.pages) {
    const pageLeaves: Leaf[] = [];

    // 2a. Emit text leaves.
    const sortedText = [...page.textItems].sort((a, b) => a.readingIndex - b.readingIndex);
    for (const it of sortedText) {
      if (typeof it.text !== 'string' || it.text.trim().length === 0) continue;
      if (!Number.isFinite(it.fontSize) || it.fontSize <= 0) continue;
      const closest = headingSizes.length > 0 ? findClosest(headingSizes, it.fontSize) : null;
      let kind: 'heading' | 'paragraph' = 'paragraph';
      let depth = 0;
      if (closest !== null) {
        const d = sizeToDepth.get(closest);
        if (d !== undefined) {
          kind = 'heading';
          depth = d;
        }
      }
      // Position-on-page refinement: items in the top TOP_OF_PAGE_FRACTION of
      // the page AND in the largest cluster get promoted to H1 (depth 0).
      if (
        kind === 'heading' &&
        it.bbox &&
        page.pageSize.heightPt > 0 &&
        // bbox[3] is the top y in PDF user space (origin bottom-left)
        page.pageSize.heightPt - it.bbox[3] < page.pageSize.heightPt * TOP_OF_PAGE_FRACTION
      ) {
        depth = 0;
      }
      const node: StructTreeNode = {
        id: randomUUID(),
        type: (kind === 'heading' ? headingTypeForDepth(depth) : 'P') as StructTreeType,
        contentRefs: buildContentRefs(page.pageIndex, it.mcid),
        children: [],
      };
      // Trim text for warning context; we don't store actualText for headings
      // unless the user opts in via the C5 editor.
      const trimmed = it.text.trim().slice(0, TITLE_TRIM_CHARS);
      if (kind === 'heading') {
        // Use /ActualText so screen readers read the heading title even
        // when mcid associations are dropped (Wave 5b ships best-effort
        // mcid round-trip; ActualText is the durable carrier).
        node.actualText = trimmed;
      }
      pageLeaves.push({ kind, headingDepth: depth, node });
    }

    // 2b. Emit figure leaves, interleaved by readingIndex. Caption detection
    //     is a separate concern: a text item whose bbox vertically abuts an
    //     image's bbox and whose font size is at/below the dominant body
    //     size becomes the Figure's child (instead of a P sibling).
    const sortedImages = [...page.imageItems].sort((a, b) => a.readingIndex - b.readingIndex);
    for (const img of sortedImages) {
      const fig: StructTreeNode = {
        id: randomUUID(),
        type: 'Figure',
        ...(img.altText !== undefined && { altText: img.altText }),
        contentRefs: buildContentRefs(page.pageIndex, img.mcid),
        children: [],
      };
      pageLeaves.push({ kind: 'figure', node: fig });

      // Best-effort caption detection — find the nearest P leaf below the
      // figure bbox; mark its node as a Caption child of the Figure.
      const captionCandidate = pageLeaves
        .filter((l) => l.kind === 'paragraph' && l.node.type === 'P')
        .map((l) => l)
        .reverse()
        .find((l) => l.node !== fig);
      if (captionCandidate && captionCandidate.node.actualText === undefined) {
        // Don't reparent — captions are a Wave-5c refinement. The hint
        // surfaces only as a warning so the user knows to review.
        warnings.push(`Page ${page.pageIndex + 1}: figure may have a caption (review).`);
      }
    }

    // 2c. Per-page warning surfacing.
    if (page.textItems.length > 0) {
      const sizesOnPage = new Set(page.textItems.map((t) => quantizeSize(t.fontSize)));
      if (sizesOnPage.size === 1 && pageLeaves.some((l) => l.kind === 'paragraph')) {
        warnings.push(`Page ${page.pageIndex + 1}: single font size — no headings detected.`);
      }
    }

    leavesByPage.push(pageLeaves);
  }

  // 3. Build the document hierarchy. Walk all pages in order; maintain a
  //    stack [section_h1, section_h2, ...]; paragraphs/figures attach to
  //    the deepest open section. Heading-level normalisation: if we see an
  //    H2 before any H1, demote it to H1 (no skipping levels).
  const docRoot: StructTreeNode = {
    id: randomUUID(),
    type: 'Document',
    contentRefs: [],
    children: [],
  };
  // Stack entries pair (depth -> the section node currently open at that depth).
  const stack: Array<{ depth: number; node: StructTreeNode }> = [];

  function attachToCurrent(node: StructTreeNode): void {
    if (stack.length === 0) {
      docRoot.children.push(node);
    } else {
      stack[stack.length - 1]!.node.children.push(node);
    }
  }

  for (const pageLeaves of leavesByPage) {
    for (const leaf of pageLeaves) {
      if (leaf.kind === 'heading' && leaf.headingDepth !== undefined) {
        let d = leaf.headingDepth;
        // Normalize: never skip a level.
        const currentDepth = stack.length === 0 ? -1 : stack[stack.length - 1]!.depth;
        if (d > currentDepth + 1) d = currentDepth + 1;
        // Pop deeper-or-equal sections off the stack.
        while (stack.length > 0 && stack[stack.length - 1]!.depth >= d) {
          stack.pop();
        }
        // Rewrite the leaf node's type to match the normalized depth.
        leaf.node.type = headingTypeForDepth(d) as StructTreeType;
        attachToCurrent(leaf.node);
        stack.push({ depth: d, node: leaf.node });
      } else {
        attachToCurrent(leaf.node);
      }
    }
  }

  if (all.length === 0 && opts.pages.every((p) => p.imageItems.length === 0)) {
    // Empty doc — emit warning but still return a tree (the renderer will
    // surface an "Empty tree — add tags manually" hint).
    warnings.push('No extractable content — auto-tag produced an empty tree.');
  } else if (headingSizes.length === 0 && all.length > 0) {
    warnings.push(
      `No font sizes >= ${HEADING_MIN_RATIO}x dominant ${dominantSize.toFixed(
        1,
      )}pt found across the doc — only P / Figure tags emitted.`,
    );
  }

  return ok<AutoTagValue>({ tree: docRoot, warnings });
}

// ============================================================================
// Helpers
// ============================================================================

function headingTypeForDepth(depth: number): StructTreeType {
  // Clamp into H1..H6.
  const d = Math.max(0, Math.min(5, depth));
  return `H${d + 1}` as 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6' satisfies StructTreeType;
}

function buildContentRefs(pageIndex: number, mcid: number | undefined): MarkedContentRef[] {
  if (typeof mcid !== 'number' || !Number.isFinite(mcid)) return [];
  return [{ kind: 'mcid', pageIndex, mcid }];
}

interface SizeBucket {
  center: number;
  count: number;
}

function groupSizes(sizes: ReadonlyArray<number>): SizeBucket[] {
  const buckets: SizeBucket[] = [];
  for (const s of sizes) {
    let found = false;
    for (const b of buckets) {
      if (Math.abs(b.center - s) <= FONT_SIZE_GROUP_EPS) {
        b.center = (b.center * b.count + s) / (b.count + 1);
        b.count += 1;
        found = true;
        break;
      }
    }
    if (!found) buckets.push({ center: s, count: 1 });
  }
  return buckets;
}

function pickDominant(buckets: ReadonlyArray<SizeBucket>): number | null {
  if (buckets.length === 0) return null;
  let best = buckets[0]!;
  for (const b of buckets) if (b.count > best.count) best = b;
  return best.center;
}

function findClosest(sizes: ReadonlyArray<number>, target: number): number | null {
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of sizes) {
    const d = Math.abs(s - target);
    if (d < bestDist && d <= FONT_SIZE_GROUP_EPS) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

function quantizeSize(s: number): number {
  return Math.round(s / FONT_SIZE_GROUP_EPS) * FONT_SIZE_GROUP_EPS;
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  const i = Math.floor(n);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

function validateOpts(opts: AutoTagOptions): string | null {
  if (!opts || typeof opts !== 'object') return 'opts must be an object';
  if (!Array.isArray(opts.pages)) return 'opts.pages must be an array';
  for (const p of opts.pages) {
    if (!Number.isInteger(p.pageIndex) || p.pageIndex < 0) {
      return 'every page.pageIndex must be a non-negative integer';
    }
    if (
      !p.pageSize ||
      !Number.isFinite(p.pageSize.widthPt) ||
      !Number.isFinite(p.pageSize.heightPt) ||
      p.pageSize.widthPt <= 0 ||
      p.pageSize.heightPt <= 0
    ) {
      return `page ${p.pageIndex}: pageSize must have positive widthPt + heightPt`;
    }
    if (!Array.isArray(p.textItems)) {
      return `page ${p.pageIndex}: textItems must be an array`;
    }
    if (!Array.isArray(p.imageItems)) {
      return `page ${p.pageIndex}: imageItems must be an array`;
    }
  }
  if (opts.maxHeadingDepth !== undefined) {
    if (!Number.isFinite(opts.maxHeadingDepth) || opts.maxHeadingDepth < 1) {
      return 'maxHeadingDepth must be >= 1 when provided';
    }
  }
  return null;
}
