// Handler: annotations:addShape (Phase 4, api-contracts.md §14.8)
//
// Authors a shape annotation EditOperation. The shape is held in the
// renderer's shapes-slice + replayed at save time by the replay engine's
// step 3.8 (which calls into shape-annotations.ts).
//
// The handler itself does NOT mutate the document — it validates the model
// (page bounds, geometry, color range) and returns the EditOperation to
// the renderer for dirtyOps insertion. The save-time emission is what
// actually authors the annotation dict on the page.

import { z } from 'zod';

import { fail, ok } from '../../shared/result.js';
import type {
  AnnotationsAddShapeError,
  AnnotationsAddShapeRequest,
  AnnotationsAddShapeResponse,
  DocumentHandle,
  EditOperationSerialized,
  ShapeAnnotationModel,
} from '../contracts.js';

export interface AnnotationsAddShapeDeps {
  getBytes(h: DocumentHandle): Uint8Array | null;
  /** Optional: total page count for bounds checking. */
  getPageCount?(h: DocumentHandle): number | null;
}

const pdfRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
const rgbSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
});
const shapeSubtype = z.union([
  z.literal('Square'),
  z.literal('Circle'),
  z.literal('Polygon'),
  z.literal('PolyLine'),
  z.literal('Line'),
  z.literal('FreeTextCallout'),
]);
const annotationSchema = z.object({
  id: z.string().min(1).max(128),
  pageIndex: z.number().int().min(0),
  subtype: shapeSubtype,
  rect: pdfRectSchema,
  color: rgbSchema,
  opacity: z.number().min(0).max(1),
  borderWidth: z.number().min(0.25).max(10),
  borderStyle: z.union([z.literal('solid'), z.literal('dashed'), z.literal('dotted')]),
  fillColor: rgbSchema.optional(),
  fillEnabled: z.boolean().optional(),
  vertices: z.array(z.number()).optional(),
  lineStart: z.object({ x: z.number(), y: z.number() }).optional(),
  lineEnd: z.object({ x: z.number(), y: z.number() }).optional(),
  lineStartStyle: z
    .union([z.literal('None'), z.literal('Butt'), z.literal('OpenArrow'), z.literal('ClosedArrow')])
    .optional(),
  lineEndStyle: z
    .union([z.literal('None'), z.literal('Butt'), z.literal('OpenArrow'), z.literal('ClosedArrow')])
    .optional(),
  calloutText: z.string().max(2000).optional(),
  calloutPointer: z.object({ x: z.number(), y: z.number() }).optional(),
  fontSize: z.number().min(4).max(72).optional(),
  fontFamily: z.string().max(64).optional(),
  measure: z
    .object({
      unit: z.union([
        z.literal('inch'),
        z.literal('cm'),
        z.literal('mm'),
        z.literal('pt'),
        z.literal('px'),
        z.literal('custom'),
      ]),
      customUnitLabel: z.string().max(16).optional(),
      scale: z.number().positive(),
    })
    .optional(),
  author: z.string().max(128).optional(),
  contents: z.string().max(4000).optional(),
  createdAt: z.number(),
  modifiedAt: z.number(),
  dirty: z.boolean(),
});
const requestSchema = z.object({
  handle: z.number().int(),
  annotation: annotationSchema,
});

export async function handleAnnotationsAddShape(
  req: AnnotationsAddShapeRequest,
  deps: AnnotationsAddShapeDeps,
): Promise<AnnotationsAddShapeResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<AnnotationsAddShapeError>('invalid_payload', parsed.error.message);
  }
  if (!deps.getBytes(parsed.data.handle)) {
    return fail<AnnotationsAddShapeError>(
      'handle_not_found',
      `handle ${parsed.data.handle} not found`,
    );
  }
  const pc = deps.getPageCount?.(parsed.data.handle);
  if (pc !== null && pc !== undefined && parsed.data.annotation.pageIndex >= pc) {
    return fail<AnnotationsAddShapeError>(
      'out_of_range',
      `pageIndex ${parsed.data.annotation.pageIndex} ≥ pageCount ${pc}`,
    );
  }
  // Subtype-specific validation (mirrors shape-annotations.ts validateModel).
  const m = parsed.data.annotation;
  if (m.subtype === 'Polygon' || m.subtype === 'PolyLine') {
    if (!m.vertices || m.vertices.length < 4 || m.vertices.length % 2 !== 0) {
      return fail<AnnotationsAddShapeError>(
        'invalid_payload',
        `${m.subtype} requires vertices array of even length ≥ 4`,
      );
    }
    const minPoints = m.subtype === 'Polygon' ? 3 : 2;
    if (m.vertices.length / 2 < minPoints) {
      return fail<AnnotationsAddShapeError>(
        'invalid_payload',
        `${m.subtype} needs at least ${minPoints} points`,
      );
    }
  }
  if (m.subtype === 'Line' && (!m.lineStart || !m.lineEnd)) {
    return fail<AnnotationsAddShapeError>('invalid_payload', 'Line requires lineStart + lineEnd');
  }
  if (m.subtype === 'FreeTextCallout') {
    if (typeof m.calloutText !== 'string') {
      return fail<AnnotationsAddShapeError>(
        'invalid_payload',
        'FreeTextCallout requires calloutText',
      );
    }
    if (!m.calloutPointer) {
      return fail<AnnotationsAddShapeError>(
        'invalid_payload',
        'FreeTextCallout requires calloutPointer',
      );
    }
  }
  if (m.fillEnabled && !m.fillColor) {
    return fail<AnnotationsAddShapeError>('invalid_payload', 'fillEnabled requires fillColor');
  }

  // Build ShapeAnnotationModel via conditional-spread to satisfy
  // exactOptionalPropertyTypes (zod produces `T | undefined` shapes for
  // optional fields; the model type forbids `undefined`).
  const a = parsed.data.annotation;
  const annotation: ShapeAnnotationModel = {
    id: a.id,
    pageIndex: a.pageIndex,
    subtype: a.subtype,
    rect: a.rect,
    color: a.color,
    opacity: a.opacity,
    borderWidth: a.borderWidth,
    borderStyle: a.borderStyle,
    createdAt: a.createdAt,
    modifiedAt: a.modifiedAt,
    dirty: a.dirty,
    ...(a.fillColor !== undefined ? { fillColor: a.fillColor } : {}),
    ...(a.fillEnabled !== undefined ? { fillEnabled: a.fillEnabled } : {}),
    ...(a.vertices !== undefined ? { vertices: a.vertices } : {}),
    ...(a.lineStart !== undefined ? { lineStart: a.lineStart } : {}),
    ...(a.lineEnd !== undefined ? { lineEnd: a.lineEnd } : {}),
    ...(a.lineStartStyle !== undefined ? { lineStartStyle: a.lineStartStyle } : {}),
    ...(a.lineEndStyle !== undefined ? { lineEndStyle: a.lineEndStyle } : {}),
    ...(a.calloutText !== undefined ? { calloutText: a.calloutText } : {}),
    ...(a.calloutPointer !== undefined ? { calloutPointer: a.calloutPointer } : {}),
    ...(a.fontSize !== undefined ? { fontSize: a.fontSize } : {}),
    ...(a.fontFamily !== undefined ? { fontFamily: a.fontFamily } : {}),
    ...(a.measure !== undefined
      ? {
          measure: {
            unit: a.measure.unit,
            scale: a.measure.scale,
            ...(a.measure.customUnitLabel !== undefined
              ? { customUnitLabel: a.measure.customUnitLabel }
              : {}),
          },
        }
      : {}),
    ...(a.author !== undefined ? { author: a.author } : {}),
    ...(a.contents !== undefined ? { contents: a.contents } : {}),
  };
  const op: EditOperationSerialized = {
    kind: 'annot-add-shape',
    meta: {
      ts: Date.now(),
      undoable: true,
      operationId: `annot-shape-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    },
    annotation,
  };
  return ok({ op, warnings: [] });
}
