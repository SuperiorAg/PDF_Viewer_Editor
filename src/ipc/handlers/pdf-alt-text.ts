// Handlers: pdf:setAltText, pdf:listFiguresWithoutAltText
// (Phase 7.5 Wave 5c — C5 Alt-text inspector).
//
// Contract: docs/api-contracts.md §19.7.5.
// Engine:   src/main/pdf-ops/alt-text-engine.ts.

import { z } from 'zod';

import {
  listFiguresWithoutAltText,
  setAltText,
  type AltTextEngineError,
} from '../../main/pdf-ops/alt-text-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  FigureWithoutAlt,
  PdfListFiguresWithoutAltTextError,
  PdfListFiguresWithoutAltTextResponse,
  PdfListFiguresWithoutAltTextValue,
  PdfSetAltTextError,
  PdfSetAltTextResponse,
  PdfSetAltTextValue,
} from '../contracts.js';

// =====================================================================
// Schemas
// =====================================================================

const listRequestSchema = z.object({
  handle: z.number().int().positive(),
});

const setRequestSchema = z.object({
  handle: z.number().int().positive(),
  structNodeId: z.string().min(1),
  altText: z.string(),
  actualText: z.string().optional(),
});

// =====================================================================
// Deps
// =====================================================================

export interface PdfAltTextDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes?: (handle: DocumentHandle, bytes: Uint8Array) => void;
  engineList?: typeof listFiguresWithoutAltText;
  engineSet?: typeof setAltText;
  /** Optional bbox refinement (same shape as the reading-order handler's
   *  bboxLookup). When wired, the handler overlays per-figure bboxes
   *  onto the engine's zero-rects so the renderer's inspector can
   *  jump-to-figure. Tests omit. */
  bboxLookup?: (
    bytes: Uint8Array,
    structNodeIds: ReadonlyArray<string>,
  ) => Promise<Map<string, [number, number, number, number]>>;
}

// =====================================================================
// pdf:listFiguresWithoutAltText
// =====================================================================

export async function handlePdfListFiguresWithoutAltText(
  req: unknown,
  deps: PdfAltTextDeps,
): Promise<PdfListFiguresWithoutAltTextResponse> {
  const parsed = listRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfListFiguresWithoutAltTextError>('invalid_payload', parsed.error.message);
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<PdfListFiguresWithoutAltTextError>(
      'handle_not_found',
      `handle ${parsed.data.handle} is not registered`,
    );
  }
  const engine = deps.engineList ?? listFiguresWithoutAltText;
  try {
    const res = await engine(bytes);
    if (!res.ok) {
      return mapListEngineErr(res.error, res.message);
    }
    let figures: FigureWithoutAlt[] = res.value.figures.map((f) => ({
      structNodeId: f.structNodeId,
      pageIndex: f.pageIndex,
      bbox: f.bbox,
    }));
    if (deps.bboxLookup && figures.length > 0) {
      try {
        const map = await deps.bboxLookup(
          bytes,
          figures.map((f) => f.structNodeId),
        );
        figures = figures.map((f) => {
          const bbox = map.get(f.structNodeId);
          return bbox ? { ...f, bbox } : f;
        });
      } catch {
        // honest degrade — engine zero-bboxes survive.
      }
    }
    const v: PdfListFiguresWithoutAltTextValue = {
      figures,
      warnings: res.value.warnings,
    };
    return ok(v);
  } catch (e) {
    return fail<PdfListFiguresWithoutAltTextError>(
      'engine_failed',
      safeMessage(e, 'listFiguresWithoutAltText engine threw'),
    );
  }
}

// =====================================================================
// pdf:setAltText
// =====================================================================

export async function handlePdfSetAltText(
  req: unknown,
  deps: PdfAltTextDeps,
): Promise<PdfSetAltTextResponse> {
  const parsed = setRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfSetAltTextError>('invalid_payload', parsed.error.message);
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<PdfSetAltTextError>(
      'handle_not_found',
      `handle ${parsed.data.handle} is not registered`,
    );
  }
  const engine = deps.engineSet ?? setAltText;
  try {
    const edit =
      parsed.data.actualText !== undefined
        ? {
            structNodeId: parsed.data.structNodeId,
            altText: parsed.data.altText,
            actualText: parsed.data.actualText,
          }
        : {
            structNodeId: parsed.data.structNodeId,
            altText: parsed.data.altText,
          };
    const res = await engine(bytes, [edit]);
    if (!res.ok) {
      return mapSetEngineErr(res.error, res.message);
    }
    if (deps.setBytes) {
      try {
        deps.setBytes(parsed.data.handle, res.value.bytes);
      } catch {
        // best-effort
      }
    }
    const v: PdfSetAltTextValue = {
      applied: true,
      warnings: res.value.warnings,
    };
    return ok(v);
  } catch (e) {
    return fail<PdfSetAltTextError>('engine_failed', safeMessage(e, 'setAltText engine threw'));
  }
}

// =====================================================================
// Engine-error → IPC-error mapping
// =====================================================================

function mapListEngineErr(
  err: AltTextEngineError,
  msg: string,
): PdfListFiguresWithoutAltTextResponse {
  switch (err) {
    case 'invalid_payload':
      return fail<PdfListFiguresWithoutAltTextError>('invalid_payload', msg);
    case 'node_not_found':
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfListFiguresWithoutAltTextError>('engine_failed', msg);
  }
}

function mapSetEngineErr(err: AltTextEngineError, msg: string): PdfSetAltTextResponse {
  switch (err) {
    case 'invalid_payload':
      return fail<PdfSetAltTextError>('invalid_payload', msg);
    case 'node_not_found':
      return fail<PdfSetAltTextError>('node_not_found', msg);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfSetAltTextError>('engine_failed', msg);
  }
}
