// Pure builder helpers — convert a finished draft into a ShapeAnnotationModel.
// Per docs/data-models.md §9.7 (Phase 4) — the 7 shape tools each map to a
// ShapeAnnotationSubtype with the right subtype-specific fields populated.
//
// This is the SINGLE FUNNEL where draft-to-annotation conversion happens. The
// addShapeAnnotationThunk takes the model and routes through applyEdit.

import {
  type DraftShape,
  type ShapeDefaults,
  type ShapeTool,
  shapeToolToSubtype,
} from '../../state/slices/shapes-slice';
import {
  type LineEndStyle,
  type RgbColor,
  type ShapeAnnotationModel,
} from '../../types/ipc-contract';

function uuid(): string {
  // RFC 4122 v4-ish — deterministic enough for our id needs. crypto.randomUUID
  // is available in modern browsers + Node 18+, but jsdom may not expose it
  // depending on the version, so fall back to Math.random.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Build a ShapeAnnotationModel from a finished shape draft + the user's
 * current defaults.
 *
 * Returns `null` if the draft cannot produce a valid annotation
 * (e.g. zero-area rect, polygon with <3 points).
 */
export function buildShapeAnnotationFromDraft(
  draft: DraftShape,
  defaults: ShapeDefaults,
  opts: {
    pageWidth: number;
    pageHeight: number;
    /** Optional override color for Square/Circle/Polygon. */
    color?: RgbColor;
    /** Optional callout text payload (cursor-typed). */
    calloutText?: string;
    /** Optional callout pointer position (PDF user-space). */
    calloutPointer?: { x: number; y: number };
    /** Optional measure scale + unit. */
    measureUnit?: 'inch' | 'cm' | 'mm' | 'pt' | 'px';
    measureScale?: number;
  } = { pageWidth: 612, pageHeight: 792 },
): ShapeAnnotationModel | null {
  const subtype = shapeToolToSubtype(draft.tool);
  if (!subtype) return null;
  const id = uuid();
  const now = Date.now();
  const color = opts.color ?? defaults.color;

  const minX = Math.min(draft.startX, draft.currentX);
  const minY = Math.min(draft.startY, draft.currentY);
  const w = Math.abs(draft.currentX - draft.startX);
  const h = Math.abs(draft.currentY - draft.startY);

  const base: Omit<ShapeAnnotationModel, 'subtype'> = {
    id,
    pageIndex: draft.pageIndex,
    rect: { x: minX, y: minY, width: Math.max(1, w), height: Math.max(1, h) },
    color,
    opacity: defaults.opacity,
    borderWidth: defaults.borderWidth,
    borderStyle: defaults.borderStyle,
    createdAt: now,
    modifiedAt: now,
    // David's ShapeAnnotationModel carries a `dirty` flag mirroring the
    // Phase 3 pattern for unsaved authored annotations. New shape ops are
    // dirty until next save.
    dirty: true,
  };

  if (subtype === 'Square' || subtype === 'Circle') {
    if (w < 2 || h < 2) return null;
    return {
      ...base,
      subtype,
      fillEnabled: defaults.fillEnabled,
      fillColor: defaults.fillColor,
    };
  }

  if (subtype === 'Polygon') {
    const vertices = draft.vertices ?? [];
    if (vertices.length < 6) return null; // need ≥3 points
    // Phase 7.5 B17 — area-measure rides through Polygon with a measure block
    // attached. The renderer's overlay computes the area from the shoelace
    // formula; here we only persist the calibration so re-renders + label
    // recomputation stay deterministic on reload.
    const polygonModel: ShapeAnnotationModel = {
      ...base,
      subtype,
      vertices,
      fillEnabled: defaults.fillEnabled,
      fillColor: defaults.fillColor,
    };
    if (draft.tool === 'area-measure') {
      polygonModel.measure = {
        unit: opts.measureUnit ?? 'inch',
        scale: opts.measureScale ?? 1,
      };
    }
    return polygonModel;
  }

  if (subtype === 'PolyLine') {
    const vertices = draft.vertices ?? [];
    if (vertices.length < 4) return null; // need ≥2 points
    const polyLineBase: ShapeAnnotationModel = {
      ...base,
      subtype,
      vertices,
    };
    if (draft.tool === 'polyline-measure') {
      polyLineBase.measure = {
        unit: opts.measureUnit ?? 'inch',
        scale: opts.measureScale ?? 1,
      };
    }
    return polyLineBase;
  }

  if (subtype === 'Line') {
    if (w < 2 && h < 2) return null;
    const lineStart = { x: draft.startX, y: draft.startY };
    const lineEnd = { x: draft.currentX, y: draft.currentY };
    let startStyle: LineEndStyle = 'None';
    let endStyle: LineEndStyle = 'None';
    if (draft.tool === 'arrow') {
      startStyle = defaults.lineStartStyle;
      endStyle = defaults.lineEndStyle;
    }
    const lineModel: ShapeAnnotationModel = {
      ...base,
      subtype,
      lineStart,
      lineEnd,
      lineStartStyle: startStyle,
      lineEndStyle: endStyle,
    };
    if (draft.tool === 'line-measure') {
      lineModel.measure = {
        unit: opts.measureUnit ?? 'inch',
        scale: opts.measureScale ?? 1,
      };
    }
    return lineModel;
  }

  if (subtype === 'FreeTextCallout') {
    return {
      ...base,
      subtype,
      calloutText: opts.calloutText ?? '',
      calloutPointer: opts.calloutPointer ?? { x: draft.startX, y: draft.startY },
      fontSize: defaults.calloutFontSize,
      fontFamily: defaults.calloutFontFamily,
    };
  }

  return null;
}

/**
 * Build a finished annotation for a specific (synthetic) shape tool — used by
 * tests + non-pointer entry points. Convenience over buildShapeAnnotationFromDraft.
 */
export function buildShapeForTool(
  tool: ShapeTool,
  args: {
    pageIndex: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    vertices?: number[];
    defaults: ShapeDefaults;
    calloutText?: string;
    calloutPointer?: { x: number; y: number };
    measureUnit?: 'inch' | 'cm' | 'mm' | 'pt' | 'px';
    measureScale?: number;
  },
): ShapeAnnotationModel | null {
  const draft: DraftShape = {
    pageIndex: args.pageIndex,
    tool,
    startX: args.startX,
    startY: args.startY,
    currentX: args.endX,
    currentY: args.endY,
  };
  if (args.vertices !== undefined) draft.vertices = args.vertices;
  const opts: Parameters<typeof buildShapeAnnotationFromDraft>[2] = {
    pageWidth: 612,
    pageHeight: 792,
  };
  if (args.calloutText !== undefined) opts.calloutText = args.calloutText;
  if (args.calloutPointer !== undefined) opts.calloutPointer = args.calloutPointer;
  if (args.measureUnit !== undefined) opts.measureUnit = args.measureUnit;
  if (args.measureScale !== undefined) opts.measureScale = args.measureScale;
  return buildShapeAnnotationFromDraft(draft, args.defaults, opts);
}
