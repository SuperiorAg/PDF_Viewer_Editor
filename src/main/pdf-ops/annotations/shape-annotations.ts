// Phase 4 (Wave 16, David) — Shape + line + polygon + callout + measure annotations.
//
// Contract: docs/architecture-phase-4.md §5; docs/data-models.md §9.7;
// docs/signature-engine.md §7 (replay-engine integration step 3.8).
//
// SEVEN new annotation tools, each mapped to an ISO 32000 subtype:
//   - Square      → rectangle
//   - Circle      → ellipse
//   - Polygon     → closed polygon
//   - PolyLine    → open polyline (also line-measure when measure dict present)
//   - Line        → straight line (also arrow + line-measure)
//   - FreeText    → callout flavor (/IT FreeTextCallout + /CL pointer)
//
// Pure functions over (doc, model). They produce a widget-style annotation
// dict + register it on the target page's /Annots array. pdf-lib does NOT
// provide high-level helpers for Polygon / PolyLine / Callout / Measure —
// we hand-author the dicts using the same pattern as field-dict-authoring.ts.

import { PDFArray, PDFBool, PDFDict, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import type { PDFDocument, PDFRef, PDFContext } from 'pdf-lib';

import type { ShapeAnnotationModel } from '../../../ipc/contracts.js';
import { fail, ok } from '../../../shared/result.js';
import type { Result } from '../../../shared/result.js';

export type EmitShapeError =
  | 'page_out_of_range'
  | 'invalid_model'
  | 'unsupported_subtype'
  | 'write_failed';

export interface EmitShapeOk {
  annotRef: PDFRef;
  pdfObjectNumber: number;
}

export type EmitShapeResult = Result<EmitShapeOk, EmitShapeError>;

/**
 * Author + register a shape annotation. Dispatches over subtype.
 */
export function emitShapeAnnotation(
  doc: PDFDocument,
  model: ShapeAnnotationModel,
): EmitShapeResult {
  if (model.pageIndex < 0 || model.pageIndex >= doc.getPageCount()) {
    return fail<EmitShapeError>(
      'page_out_of_range',
      `pageIndex ${model.pageIndex} out of range (pageCount=${doc.getPageCount()})`,
    );
  }
  if (model.rect.width <= 0 || model.rect.height <= 0) {
    return fail<EmitShapeError>('invalid_model', 'rect width/height must be > 0');
  }
  const validate = validateModel(model);
  if (!validate.ok) return validate;

  try {
    switch (model.subtype) {
      case 'Square':
      case 'Circle':
        return emitSquareOrCircle(doc, model);
      case 'Polygon':
      case 'PolyLine':
        return emitPolygonOrPolyLine(doc, model);
      case 'Line':
        return emitLineOrMeasure(doc, model);
      case 'FreeTextCallout':
        return emitCallout(doc, model);
      default: {
        const exhaustive: never = model.subtype;
        void exhaustive;
        return fail<EmitShapeError>('unsupported_subtype', String(model.subtype));
      }
    }
  } catch (e) {
    return fail<EmitShapeError>('write_failed', `${(e as Error).message}`);
  }
}

function validateModel(model: ShapeAnnotationModel): Result<void, EmitShapeError> {
  if (model.subtype === 'Polygon' || model.subtype === 'PolyLine') {
    if (!model.vertices || model.vertices.length < 4 || model.vertices.length % 2 !== 0) {
      return fail<EmitShapeError>(
        'invalid_model',
        `${model.subtype} requires vertices array of even length ≥ 4 (got ${model.vertices?.length ?? 0})`,
      );
    }
    const minPoints = model.subtype === 'Polygon' ? 3 : 2;
    if (model.vertices.length / 2 < minPoints) {
      return fail<EmitShapeError>(
        'invalid_model',
        `${model.subtype} needs at least ${minPoints} points`,
      );
    }
  }
  if (model.subtype === 'Line') {
    if (!model.lineStart || !model.lineEnd) {
      return fail<EmitShapeError>('invalid_model', 'Line requires lineStart + lineEnd');
    }
  }
  if (model.subtype === 'FreeTextCallout') {
    if (typeof model.calloutText !== 'string') {
      return fail<EmitShapeError>('invalid_model', 'FreeTextCallout requires calloutText');
    }
    if (!model.calloutPointer) {
      return fail<EmitShapeError>('invalid_model', 'FreeTextCallout requires calloutPointer');
    }
  }
  if (model.borderWidth < 0.25 || model.borderWidth > 10) {
    return fail<EmitShapeError>(
      'invalid_model',
      `borderWidth ${model.borderWidth} out of [0.25, 10]`,
    );
  }
  if (model.opacity < 0 || model.opacity > 1) {
    return fail<EmitShapeError>('invalid_model', `opacity ${model.opacity} out of [0, 1]`);
  }
  return ok(undefined);
}

// ============================================================================
// Per-subtype authoring
// ============================================================================

function emitSquareOrCircle(doc: PDFDocument, model: ShapeAnnotationModel): EmitShapeResult {
  const ctx = doc.context;
  const dict = baseAnnotDict(ctx, model.subtype, model);
  setBorderStyle(ctx, dict, model);
  setColorAndOpacity(ctx, dict, model);
  if (model.fillEnabled && model.fillColor) {
    setInteriorColor(ctx, dict, model.fillColor);
  }
  return registerAndAttach(doc, dict, model.pageIndex);
}

function emitPolygonOrPolyLine(doc: PDFDocument, model: ShapeAnnotationModel): EmitShapeResult {
  const ctx = doc.context;
  const dict = baseAnnotDict(ctx, model.subtype, model);
  setBorderStyle(ctx, dict, model);
  setColorAndOpacity(ctx, dict, model);
  if (model.fillEnabled && model.fillColor && model.subtype === 'Polygon') {
    setInteriorColor(ctx, dict, model.fillColor);
  }
  // /Vertices [x1 y1 x2 y2 ...]
  const vert = model.vertices ?? [];
  const arr = PDFArray.withContext(ctx);
  for (const n of vert) arr.push(PDFNumber.of(n));
  dict.set(PDFName.of('Vertices'), arr);

  if (model.measure && model.subtype === 'PolyLine') {
    dict.set(PDFName.of('Measure'), measureDict(ctx, model.measure));
    // Per ISO 32000, /IT MeasureLine or similar — pdf-lib doesn't define it;
    // we mark our authorship loosely via /IT for downstream tools.
    dict.set(PDFName.of('IT'), PDFName.of('PolyLineDimension'));
  }
  return registerAndAttach(doc, dict, model.pageIndex);
}

function emitLineOrMeasure(doc: PDFDocument, model: ShapeAnnotationModel): EmitShapeResult {
  const ctx = doc.context;
  const dict = baseAnnotDict(ctx, 'Line', model);
  setBorderStyle(ctx, dict, model);
  setColorAndOpacity(ctx, dict, model);
  // /L [x1 y1 x2 y2]
  const lArr = PDFArray.withContext(ctx);
  lArr.push(PDFNumber.of(model.lineStart!.x));
  lArr.push(PDFNumber.of(model.lineStart!.y));
  lArr.push(PDFNumber.of(model.lineEnd!.x));
  lArr.push(PDFNumber.of(model.lineEnd!.y));
  dict.set(PDFName.of('L'), lArr);
  // /LE [<startStyle> <endStyle>]
  if (model.lineStartStyle || model.lineEndStyle) {
    const leArr = PDFArray.withContext(ctx);
    leArr.push(PDFName.of(model.lineStartStyle ?? 'None'));
    leArr.push(PDFName.of(model.lineEndStyle ?? 'None'));
    dict.set(PDFName.of('LE'), leArr);
  }
  if (model.measure) {
    dict.set(PDFName.of('Measure'), measureDict(ctx, model.measure));
    dict.set(PDFName.of('IT'), PDFName.of('LineDimension'));
  }
  return registerAndAttach(doc, dict, model.pageIndex);
}

function emitCallout(doc: PDFDocument, model: ShapeAnnotationModel): EmitShapeResult {
  const ctx = doc.context;
  const dict = baseAnnotDict(ctx, 'FreeText', model);
  setBorderStyle(ctx, dict, model);
  setColorAndOpacity(ctx, dict, model);
  dict.set(PDFName.of('Contents'), PDFString.of(model.calloutText ?? ''));
  dict.set(PDFName.of('IT'), PDFName.of('FreeTextCallout'));
  // /CL [x1 y1 (x2 y2)? x3 y3] — start, optional knee, end (the pointer tip).
  const cl = PDFArray.withContext(ctx);
  // From the rect-edge to the pointer; we use rect center as start.
  const cx = model.rect.x + model.rect.width / 2;
  const cy = model.rect.y + model.rect.height / 2;
  cl.push(PDFNumber.of(cx));
  cl.push(PDFNumber.of(cy));
  cl.push(PDFNumber.of(model.calloutPointer!.x));
  cl.push(PDFNumber.of(model.calloutPointer!.y));
  dict.set(PDFName.of('CL'), cl);
  // /DA — default appearance string (font Helvetica + color black).
  const fontSize = model.fontSize ?? 11;
  dict.set(PDFName.of('DA'), PDFString.of(`/Helv ${fontSize} Tf 0 0 0 rg`));
  return registerAndAttach(doc, dict, model.pageIndex);
}

// ============================================================================
// Helpers
// ============================================================================

function baseAnnotDict(ctx: PDFContext, subtype: string, model: ShapeAnnotationModel): PDFDict {
  const d = PDFDict.withContext(ctx);
  d.set(PDFName.of('Type'), PDFName.of('Annot'));
  d.set(PDFName.of('Subtype'), PDFName.of(subtype));
  const rect = PDFArray.withContext(ctx);
  rect.push(PDFNumber.of(model.rect.x));
  rect.push(PDFNumber.of(model.rect.y));
  rect.push(PDFNumber.of(model.rect.x + model.rect.width));
  rect.push(PDFNumber.of(model.rect.y + model.rect.height));
  d.set(PDFName.of('Rect'), rect);
  // /F bit 3 = Print
  d.set(PDFName.of('F'), PDFNumber.of(4));
  d.set(PDFName.of('NM'), PDFString.of(model.id));
  if (model.contents) d.set(PDFName.of('Contents'), PDFString.of(model.contents));
  if (model.author) d.set(PDFName.of('T'), PDFString.of(model.author));
  d.set(PDFName.of('M'), PDFString.of(toPdfDate(model.modifiedAt || Date.now())));
  d.set(PDFName.of('CA'), PDFNumber.of(model.opacity));
  return d;
}

function setBorderStyle(ctx: PDFContext, dict: PDFDict, model: ShapeAnnotationModel): void {
  const bs = PDFDict.withContext(ctx);
  bs.set(PDFName.of('Type'), PDFName.of('Border'));
  bs.set(PDFName.of('W'), PDFNumber.of(model.borderWidth));
  bs.set(PDFName.of('S'), PDFName.of(borderStyleCode(model.borderStyle)));
  if (model.borderStyle === 'dashed') {
    const dash = PDFArray.withContext(ctx);
    dash.push(PDFNumber.of(3));
    dash.push(PDFNumber.of(2));
    bs.set(PDFName.of('D'), dash);
  } else if (model.borderStyle === 'dotted') {
    const dash = PDFArray.withContext(ctx);
    dash.push(PDFNumber.of(1));
    dash.push(PDFNumber.of(1));
    bs.set(PDFName.of('D'), dash);
  }
  dict.set(PDFName.of('BS'), bs);
}

function borderStyleCode(s: 'solid' | 'dashed' | 'dotted'): string {
  // PDF /S codes: S=Solid, D=Dashed, B=Beveled, I=Inset, U=Underline.
  // 'dotted' uses /S /D with /D array short-dashes.
  return s === 'solid' ? 'S' : 'D';
}

function setColorAndOpacity(ctx: PDFContext, dict: PDFDict, model: ShapeAnnotationModel): void {
  const c = PDFArray.withContext(ctx);
  c.push(PDFNumber.of(clamp01(model.color.r)));
  c.push(PDFNumber.of(clamp01(model.color.g)));
  c.push(PDFNumber.of(clamp01(model.color.b)));
  dict.set(PDFName.of('C'), c);
  dict.set(PDFName.of('CA'), PDFNumber.of(clamp01(model.opacity)));
}

function setInteriorColor(
  ctx: PDFContext,
  dict: PDFDict,
  rgb: { r: number; g: number; b: number },
): void {
  const ic = PDFArray.withContext(ctx);
  ic.push(PDFNumber.of(clamp01(rgb.r)));
  ic.push(PDFNumber.of(clamp01(rgb.g)));
  ic.push(PDFNumber.of(clamp01(rgb.b)));
  dict.set(PDFName.of('IC'), ic);
}

function measureDict(
  ctx: PDFContext,
  m: { unit: string; customUnitLabel?: string; scale: number },
): PDFDict {
  const d = PDFDict.withContext(ctx);
  d.set(PDFName.of('Type'), PDFName.of('Measure'));
  d.set(PDFName.of('Subtype'), PDFName.of('RL'));
  // /R is the user-facing display label, e.g. "1 in"
  const labelMap: Record<string, string> = {
    inch: 'in',
    cm: 'cm',
    mm: 'mm',
    pt: 'pt',
    px: 'px',
    custom: 'unit',
  };
  const label = m.customUnitLabel ?? labelMap[m.unit] ?? m.unit;
  d.set(PDFName.of('R'), PDFString.of(`${m.scale} ${label}`));
  // /X array: NumberFormat dicts. We add ONE — the main unit.
  const x = PDFArray.withContext(ctx);
  const fmt = PDFDict.withContext(ctx);
  fmt.set(PDFName.of('Type'), PDFName.of('NumberFormat'));
  fmt.set(PDFName.of('U'), PDFString.of(label));
  fmt.set(PDFName.of('C'), PDFNumber.of(m.scale));
  fmt.set(PDFName.of('F'), PDFName.of('D'));
  fmt.set(PDFName.of('D'), PDFNumber.of(100));
  fmt.set(PDFName.of('FD'), PDFBool.False);
  x.push(fmt);
  d.set(PDFName.of('X'), x);
  return d;
}

function registerAndAttach(doc: PDFDocument, dict: PDFDict, pageIndex: number): EmitShapeResult {
  const ctx = doc.context;
  const page = doc.getPage(pageIndex);
  dict.set(PDFName.of('P'), page.ref);
  const ref = ctx.register(dict);
  let annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) {
    annots = PDFArray.withContext(ctx);
    page.node.set(PDFName.of('Annots'), annots);
  }
  annots.push(ref);
  return ok({
    annotRef: ref,
    pdfObjectNumber: ref.objectNumber,
  });
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function toPdfDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    `D:${d.getUTCFullYear()}` +
    `${pad(d.getUTCMonth() + 1)}` +
    `${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}` +
    `${pad(d.getUTCMinutes())}` +
    `${pad(d.getUTCSeconds())}Z`
  );
}
