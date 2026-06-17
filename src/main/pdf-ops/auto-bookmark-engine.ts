// Phase 7.5 Wave 4 — B19 Auto-bookmark heuristic engine.
//
// Canonical spec: docs/architecture-phase-7.5.md §4.1 row B19 + api-contracts
// §19.14.1 (`pdf:autoBookmarkFromHeadings`).
//
// What this module does:
//   Cluster text items by font size; treat the largest one or two clusters as
//   headings (H1, H2, ...). Build a hierarchical `ProposedBookmark[]` tree
//   from the per-page heading hits, in reading order. The result is a list
//   the user reviews before persisting via `bookmarks:upsert`.
//
// What this module does NOT do:
//   - Persist the bookmarks. The engine returns proposals only; the user
//     edits / accepts in the renderer, then dispatches `bookmarks:upsert`.
//   - Walk the existing `/Outlines` dict. Auto-bookmark generates a fresh
//     proposed tree from the visual heading structure; merging into an
//     existing outline is a Wave-6+ concern.
//   - Decide which language a heading is in (no NLP).
//
// Heuristic (kept honest — easy to reason about, easy to disable):
//
//   1. Walk each page in reading order and extract `(text, fontSize)` per
//      run. We rely on an INJECTED extractor so the engine stays pure (and
//      so tests don't need pdf.js). Production wiring lives outside this
//      module per L-004 / L-005 (the canonical pdf.js loader is in
//      `ocr-bootstrap.ts` — same shape, same polyfill ordering).
//   2. Find the dominant font size (highest frequency). Anything strictly
//      LARGER than the dominant size + within a tolerance is a heading
//      candidate. Group candidates into at most `maxDepth` clusters by
//      descending size. The largest cluster is depth 0 (H1), the next is
//      depth 1 (H2), and so on.
//   3. For each heading hit, emit a `ProposedBookmark`. The bookmark title is
//      the concatenated text of the run, trimmed to 200 chars.
//   4. Build a strict hierarchy by depth (no skipping levels): if we see a
//      depth-1 heading before any depth-0, demote it to depth 0 to keep the
//      tree well-formed.
//
// Locked-instruction compliance:
//   - L-001..L-006 (no BrowserWindow, pure module, no test channel).
//   - L-004 / L-005: this module has NO pdf.js import. The default extractor
//     factory routes through the canonical injection point — see the
//     production-wiring note inside `buildExtractorFromPdfJs` (test-injectable,
//     not auto-wired).

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

/** A single text run extracted from a page. The engine only reads `text`,
 *  `fontSize`, and the reading-order index. Coordinates are not load-bearing
 *  for the heuristic but are passed through so future variants can refine. */
export interface PageTextItem {
  text: string;
  fontSize: number;
  /** Optional baseline x — left edge in user-space points. Unused in v1. */
  x?: number;
  /** Optional baseline y — top edge in user-space points. Unused in v1. */
  y?: number;
}

export interface ProposedBookmark {
  title: string;
  pageIndex: number;
  /** 0 = top-level. Higher = nested. */
  depth: number;
}

export interface AutoBookmarkOptions {
  pdfBytes: Uint8Array;
  /** Default 3 (H1, H2, H3). Range `[1, 6]`. */
  maxDepth?: number;
  /** REQUIRED. Returns text items per page IN READING ORDER (top-to-bottom,
   *  left-to-right). Production wires this to a pdf.js getTextContent walker;
   *  tests inject a stub. The engine never touches pdf.js directly. */
  extractPageTextItems: (pdfBytes: Uint8Array, pageIndex: number) => Promise<PageTextItem[]>;
  /** Discovered by walking the bytes. The engine reads page count from the
   *  caller because pdf-lib's load is the cheapest way to get it AND the
   *  caller often already has it cached. */
  pageCount: number;
}

export type AutoBookmarkError = 'invalid_payload' | 'no_headings_detected' | 'engine_failed';

export interface AutoBookmarkValue {
  proposed: ProposedBookmark[];
  warnings: string[];
}

export type AutoBookmarkResult = Result<AutoBookmarkValue, AutoBookmarkError>;

// Tunables. Kept here, NOT in the option set, so the heuristic is one place.
const DEFAULT_MAX_DEPTH = 3;
const HEADING_MIN_RATIO = 1.15; // heading font must be ≥ 1.15× the dominant body font
const TITLE_MAX_CHARS = 200;
const FONT_SIZE_GROUP_EPS = 0.5; // group sizes within 0.5pt as "the same"

// ============================================================================
// Engine
// ============================================================================

export async function autoBookmarkFromHeadings(
  opts: AutoBookmarkOptions,
): Promise<AutoBookmarkResult> {
  const validationErr = validate(opts);
  if (validationErr) return fail<AutoBookmarkError>('invalid_payload', validationErr);

  const maxDepth = clampInt(opts.maxDepth ?? DEFAULT_MAX_DEPTH, 1, 6);
  const warnings: string[] = [];

  // 1. Extract per-page items, in order. We collect into a flat list with
  //    the page index attached so the cluster pass can find dominant body size
  //    globally (not per page — bodies are usually uniform across the doc).
  type ItemWithPage = PageTextItem & { pageIndex: number };
  const all: ItemWithPage[] = [];
  try {
    for (let p = 0; p < opts.pageCount; p += 1) {
      const items = await opts.extractPageTextItems(opts.pdfBytes, p);
      for (const it of items) {
        if (typeof it.text !== 'string' || it.text.trim().length === 0) continue;
        if (!Number.isFinite(it.fontSize) || it.fontSize <= 0) continue;
        all.push({ ...it, pageIndex: p });
      }
    }
  } catch (e) {
    return fail<AutoBookmarkError>(
      'engine_failed',
      e instanceof Error && e.message ? `extractor threw: ${e.message}` : 'extractor threw',
    );
  }

  if (all.length === 0) {
    return fail<AutoBookmarkError>(
      'no_headings_detected',
      'document contains no extractable text — auto-bookmark requires a text-bearing PDF',
    );
  }

  // 2. Find dominant body font size.
  const sizeBuckets = groupSizes(all.map((i) => i.fontSize));
  const dominantSize = pickDominant(sizeBuckets);
  if (dominantSize === null) {
    return fail<AutoBookmarkError>('engine_failed', 'failed to cluster font sizes');
  }

  // 3. Identify heading candidate sizes — anything strictly larger than the
  //    dominant size by at least HEADING_MIN_RATIO. Group those buckets and
  //    sort descending so the LARGEST cluster becomes depth 0.
  const headingSizes = sizeBuckets
    .map((b) => b.center)
    .filter((s) => s >= dominantSize * HEADING_MIN_RATIO);
  if (headingSizes.length === 0) {
    return fail<AutoBookmarkError>(
      'no_headings_detected',
      `no font sizes ≥ ${HEADING_MIN_RATIO}× dominant ${dominantSize.toFixed(1)}pt found`,
    );
  }
  headingSizes.sort((a, b) => b - a);
  // Trim to maxDepth heading levels. Sizes beyond cluster `maxDepth-1` are
  // merged into the deepest cluster.
  const sizeToDepth = new Map<number, number>();
  for (let i = 0; i < headingSizes.length; i += 1) {
    sizeToDepth.set(headingSizes[i]!, Math.min(i, maxDepth - 1));
  }

  // 4. Build the proposed bookmark list. Walk in reading order, normalize
  //    depths so we don't skip levels (e.g. H1 → H3 becomes H1 → H2).
  const proposed: ProposedBookmark[] = [];
  for (const item of all) {
    const sizeKey = findClosest(headingSizes, item.fontSize);
    if (sizeKey === null) continue;
    const depth = sizeToDepth.get(sizeKey);
    if (depth === undefined) continue;
    const title = item.text.trim().slice(0, TITLE_MAX_CHARS);
    proposed.push({ title, pageIndex: item.pageIndex, depth });
  }

  if (proposed.length === 0) {
    return fail<AutoBookmarkError>(
      'no_headings_detected',
      'after clustering, no items matched any heading size',
    );
  }

  // 5. Hierarchy normalization: ensure first entry is depth 0; never skip
  //    levels (Wave-1 spec calls this out as Acrobat behavior). Also dedupe
  //    adjacent identical headings (the same H1 appearing twice in a row
  //    is usually a layout artifact like a header + repeated TOC entry).
  const normalized: ProposedBookmark[] = [];
  let currentMaxDepth = -1;
  for (const b of proposed) {
    let d = b.depth;
    if (currentMaxDepth === -1) {
      // First entry pinned to depth 0.
      d = 0;
    } else if (d > currentMaxDepth + 1) {
      d = currentMaxDepth + 1;
    }
    if (
      normalized.length > 0 &&
      normalized[normalized.length - 1]!.title === b.title &&
      normalized[normalized.length - 1]!.pageIndex === b.pageIndex &&
      normalized[normalized.length - 1]!.depth === d
    ) {
      continue;
    }
    normalized.push({ title: b.title, pageIndex: b.pageIndex, depth: d });
    if (d > currentMaxDepth) currentMaxDepth = d;
  }

  return ok<AutoBookmarkValue>({ proposed: normalized, warnings });
}

// ============================================================================
// Helpers
// ============================================================================

interface SizeBucket {
  center: number;
  count: number;
}

/** Group raw font sizes into buckets keyed by quantized center value. The
 *  quantization tolerance is FONT_SIZE_GROUP_EPS pt so 11.99pt and 12.01pt
 *  collapse into the same body-size bucket. */
function groupSizes(sizes: ReadonlyArray<number>): SizeBucket[] {
  const buckets: SizeBucket[] = [];
  for (const s of sizes) {
    let found = false;
    for (const b of buckets) {
      if (Math.abs(b.center - s) <= FONT_SIZE_GROUP_EPS) {
        // Online mean — keeps bucket center honest as more samples land.
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
  for (const b of buckets) {
    if (b.count > best.count) best = b;
  }
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

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  const i = Math.floor(n);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

function validate(opts: AutoBookmarkOptions): string | null {
  if (!(opts.pdfBytes instanceof Uint8Array) || opts.pdfBytes.byteLength === 0) {
    return 'pdfBytes must be a non-empty Uint8Array';
  }
  if (typeof opts.extractPageTextItems !== 'function') {
    return 'extractPageTextItems must be a function';
  }
  if (!Number.isInteger(opts.pageCount) || opts.pageCount < 0) {
    return 'pageCount must be a non-negative integer';
  }
  if (opts.maxDepth !== undefined) {
    if (!Number.isFinite(opts.maxDepth) || opts.maxDepth < 1) {
      return 'maxDepth must be >= 1 when provided';
    }
    // Values > 6 are clamped silently inside the engine (clampInt). The IPC
    // handler's zod schema enforces the strict upper bound at the caller-
    // facing surface — callers that bypass the handler (e.g. tests) get the
    // clamp.
  }
  return null;
}
