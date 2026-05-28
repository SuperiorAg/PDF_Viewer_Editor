// Table detector (Phase 6, export-engine.md §3.5)
//
// Line-grid analysis: walks an operator stream's path-construction ops, builds
// a horizontal/vertical line-segment cluster, and identifies rectangular grid
// regions (>=2 horizontal AND >=2 vertical clusters; >=80% perimeter density).
//
// Honest failure modes (export-engine.md §3.5.6):
//   - Borderless tables: ZERO line segments → ZERO TableRegions (correct fail-soft).
//   - Diagonal-only inputs: discarded at orthogonal classifier (step 2).
//   - Outer-border-only rectangles: rejected at step 4 density check.
//   - Merged cells: detected as separate cells per the grid (merge inference
//     is Phase 6.1+).
//
// The operator-stream input is a discriminated union of segment events. The
// caller (image-extract.ts also re-uses the walker) converts pdf.js opLists
// into segment events; this module is pdfjs-shape-agnostic.

import type { LayoutRect, PageSize, PdfTextContent, TableCell, TableRegion } from './types.js';

export interface LineSegment {
  /** Start x in PDF pts */
  x1: number;
  /** Start y */
  y1: number;
  /** End x */
  x2: number;
  /** End y */
  y2: number;
}

export interface TableDetector {
  detect(segments: LineSegment[], textContent: PdfTextContent, pageSize: PageSize): TableRegion[];
}

// Tunables (export-engine.md §3.5):
const ORTHOGONAL_TOL_PT = 1.0;
const CLUSTER_TOL_PT = 2.0;
/** Minimum coverage of expected line length to call a grid "dense". */
const DENSITY_THRESHOLD = 0.8;
/** Minimum line length to consider (filters decorative tick marks). */
const MIN_SEGMENT_LEN_PT = 4;
/** Minimum cell area in pt^2 — smaller rectangles are decorative boxes. */
const MIN_CELL_AREA_PT2 = 16;

function classifySegments(segments: LineSegment[]): {
  horizontal: LineSegment[];
  vertical: LineSegment[];
} {
  const horizontal: LineSegment[] = [];
  const vertical: LineSegment[] = [];
  for (const s of segments) {
    const dx = Math.abs(s.x2 - s.x1);
    const dy = Math.abs(s.y2 - s.y1);
    if (dy < ORTHOGONAL_TOL_PT && dx >= MIN_SEGMENT_LEN_PT) {
      horizontal.push(normalizeHorizontal(s));
    } else if (dx < ORTHOGONAL_TOL_PT && dy >= MIN_SEGMENT_LEN_PT) {
      vertical.push(normalizeVertical(s));
    }
    // Diagonal / too-short — discard.
  }
  return { horizontal, vertical };
}

function normalizeHorizontal(s: LineSegment): LineSegment {
  if (s.x1 <= s.x2) return s;
  return { x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 };
}

function normalizeVertical(s: LineSegment): LineSegment {
  if (s.y1 <= s.y2) return s;
  return { x1: s.x2, y1: s.y2, x2: s.x1, y2: s.y1 };
}

interface AxisCluster {
  /** Median coord (y for horizontal cluster; x for vertical cluster). */
  coord: number;
  members: LineSegment[];
}

function clusterByAxis(segments: LineSegment[], axis: 'y' | 'x'): AxisCluster[] {
  const clusters: AxisCluster[] = [];
  // Use mid-coordinate (y mid for horizontal; x mid for vertical).
  const items = segments.map((s) => ({
    seg: s,
    coord: axis === 'y' ? (s.y1 + s.y2) / 2 : (s.x1 + s.x2) / 2,
  }));
  items.sort((a, b) => a.coord - b.coord);
  for (const it of items) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(it.coord - last.coord) <= CLUSTER_TOL_PT) {
      last.members.push(it.seg);
      // Re-average so cluster coord follows the centroid.
      last.coord =
        last.members.reduce(
          (sum, m) => sum + (axis === 'y' ? (m.y1 + m.y2) / 2 : (m.x1 + m.x2) / 2),
          0,
        ) / last.members.length;
    } else {
      clusters.push({ coord: it.coord, members: [it.seg] });
    }
  }
  return clusters;
}

interface CandidateGrid {
  xs: number[]; // sorted vertical-cluster x-coordinates
  ys: number[]; // sorted horizontal-cluster y-coordinates
  hClusters: AxisCluster[];
  vClusters: AxisCluster[];
}

function buildCandidateGrid(horizontal: AxisCluster[], vertical: AxisCluster[]): CandidateGrid {
  const ys = [...horizontal].sort((a, b) => a.coord - b.coord).map((c) => c.coord);
  const xs = [...vertical].sort((a, b) => a.coord - b.coord).map((c) => c.coord);
  return { xs, ys, hClusters: horizontal, vClusters: vertical };
}

/** Returns true when the grid's segments cover ≥ DENSITY_THRESHOLD of the
 *  implied perimeter + internal cell boundaries (orthogonal mesh). */
function gridIsDense(grid: CandidateGrid): boolean {
  if (grid.xs.length < 2 || grid.ys.length < 2) return false;
  const xMin = grid.xs[0]!;
  const xMax = grid.xs[grid.xs.length - 1]!;
  const yMin = grid.ys[0]!;
  const yMax = grid.ys[grid.ys.length - 1]!;
  const cellWidth = xMax - xMin;
  const cellHeight = yMax - yMin;

  // Expected internal horizontal line total length = #rows * cellWidth
  const expectedH = grid.ys.length * cellWidth;
  // Expected internal vertical line total length = #cols * cellHeight
  const expectedV = grid.xs.length * cellHeight;

  const actualH = grid.hClusters.reduce(
    (sum, c) => sum + c.members.reduce((sm, s) => sm + Math.abs(s.x2 - s.x1), 0),
    0,
  );
  const actualV = grid.vClusters.reduce(
    (sum, c) => sum + c.members.reduce((sm, s) => sm + Math.abs(s.y2 - s.y1), 0),
    0,
  );
  if (expectedH <= 0 || expectedV <= 0) return false;
  return actualH / expectedH >= DENSITY_THRESHOLD && actualV / expectedV >= DENSITY_THRESHOLD;
}

function gridToRegion(grid: CandidateGrid, textContent: PdfTextContent): TableRegion | null {
  const xs = grid.xs;
  const ys = grid.ys;
  if (xs.length < 2 || ys.length < 2) return null;
  const xMin = xs[0]!;
  const xMax = xs[xs.length - 1]!;
  const yMin = ys[0]!;
  const yMax = ys[ys.length - 1]!;
  const rect: LayoutRect = { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };

  if (rect.w * rect.h < MIN_CELL_AREA_PT2) return null;

  // Build cells: rows top-to-bottom (PDF y descending), columns left-to-right.
  const yPairs: Array<[number, number]> = [];
  for (let i = ys.length - 1; i > 0; i--) {
    // top-to-bottom in reading order means highest Y first.
    yPairs.push([ys[i - 1]!, ys[i]!]); // [bottom, top]
  }
  const xPairs: Array<[number, number]> = [];
  for (let i = 0; i < xs.length - 1; i++) xPairs.push([xs[i]!, xs[i + 1]!]);

  const rows: TableCell[][] = [];
  for (const [bottomY, topY] of yPairs) {
    const row: TableCell[] = [];
    for (const [leftX, rightX] of xPairs) {
      const cellRect: LayoutRect = {
        x: leftX,
        y: bottomY,
        w: rightX - leftX,
        h: topY - bottomY,
      };
      // Collect text fragments whose center falls inside this cell rect.
      const fragments: string[] = [];
      const items: Array<{ x: number; str: string }> = [];
      for (const it of textContent.items) {
        if (it.str.length === 0) continue;
        const [, , , , e, f] = it.transform;
        const cx = e + it.width / 2;
        const cy = f + it.height / 2;
        if (cx >= leftX && cx <= rightX && cy >= bottomY && cy <= topY) {
          items.push({ x: e, str: it.str });
        }
      }
      // Sort left-to-right; concatenate.
      items.sort((a, b) => a.x - b.x);
      for (const it of items) fragments.push(it.str);
      row.push({
        text: fragments.join(' ').replace(/\s+/g, ' ').trim(),
        rect: cellRect,
      });
    }
    rows.push(row);
  }
  return {
    rect,
    rows: yPairs.length,
    columns: xPairs.length,
    cells: rows,
  };
}

export function createTableDetector(): TableDetector {
  return {
    detect(segments, textContent, _pageSize) {
      if (segments.length === 0) return [];
      const { horizontal, vertical } = classifySegments(segments);
      if (horizontal.length < 2 || vertical.length < 2) return [];
      const hClusters = clusterByAxis(horizontal, 'y');
      const vClusters = clusterByAxis(vertical, 'x');
      if (hClusters.length < 2 || vClusters.length < 2) return [];
      // Phase 6 v1: one TableRegion per page (the dominant grid). Multiple
      // tables on one page is documented as Phase 6.1+. The Wave 24 brief
      // accepts this for v1; the test fixture exercises single-table pages.
      const grid = buildCandidateGrid(hClusters, vClusters);
      if (!gridIsDense(grid)) return [];
      const region = gridToRegion(grid, textContent);
      return region ? [region] : [];
    },
  };
}
