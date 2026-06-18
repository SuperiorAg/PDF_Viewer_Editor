// Handlers: pdf:getReadingOrder, pdf:setReadingOrder
// (Phase 7.5 Wave 5c — C4 Reading Order).
//
// Contract: docs/api-contracts.md §19.7.4.
// Engine:   src/main/pdf-ops/reading-order-engine.ts.
//
// The engine is pure pdf-lib; production OPTIONALLY refines per-block
// bboxes via a pdf.js text-content walker injected through deps. When the
// extractor isn't wired (or fails), the engine's zero-bbox is returned
// honestly — the overlay falls back to "show me where this block lives"
// hover behaviour.

import { z } from 'zod';

import {
  getReadingOrder,
  setReadingOrder,
  type ReadingOrderEngineError,
} from '../../main/pdf-ops/reading-order-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfGetReadingOrderError,
  PdfGetReadingOrderResponse,
  PdfGetReadingOrderValue,
  PdfSetReadingOrderError,
  PdfSetReadingOrderResponse,
  PdfSetReadingOrderValue,
  ReadingOrderEntry,
} from '../contracts.js';

// =====================================================================
// Schemas
// =====================================================================

const getRequestSchema = z.object({
  handle: z.number().int().positive(),
  pageIndex: z.number().int().nonnegative().optional(),
});

const readingOrderEntrySchema = z.object({
  structNodeId: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  order: z.number().int().nonnegative(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

const setRequestSchema = z.object({
  handle: z.number().int().positive(),
  order: z.array(readingOrderEntrySchema),
});

// =====================================================================
// Deps
// =====================================================================

export interface PdfReadingOrderDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes?: (handle: DocumentHandle, bytes: Uint8Array) => void;
  /** Engine seam — tests inject. */
  engineGet?: typeof getReadingOrder;
  engineSet?: typeof setReadingOrder;
  /** Optional bbox refinement. When wired, the handler invokes after the
   *  engine read to overlay real bboxes onto the engine's zero-rects.
   *  The map is keyed by structNodeId. Production wires a pdf.js text-
   *  content walker; tests omit. */
  bboxLookup?: (
    bytes: Uint8Array,
    structNodeIds: ReadonlyArray<string>,
  ) => Promise<Map<string, [number, number, number, number]>>;
}

// =====================================================================
// pdf:getReadingOrder
// =====================================================================

export async function handlePdfGetReadingOrder(
  req: unknown,
  deps: PdfReadingOrderDeps,
): Promise<PdfGetReadingOrderResponse> {
  const parsed = getRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfGetReadingOrderError>('invalid_payload', parsed.error.message);
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<PdfGetReadingOrderError>(
      'handle_not_found',
      `handle ${parsed.data.handle} is not registered`,
    );
  }
  const engine = deps.engineGet ?? getReadingOrder;
  try {
    const opts = parsed.data.pageIndex !== undefined ? { pageIndex: parsed.data.pageIndex } : {};
    const res = await engine(bytes, opts);
    if (!res.ok) {
      return mapGetEngineErr(res.error, res.message);
    }
    // Optional bbox refinement — best-effort. A throw here degrades to
    // engine-only bboxes (zero rects); we never fail the whole request
    // because the bbox is purely a UI hint.
    let refined = res.value.blocks;
    if (deps.bboxLookup && refined.length > 0) {
      try {
        const map = await deps.bboxLookup(
          bytes,
          refined.map((b) => b.structNodeId),
        );
        refined = refined.map((b) => {
          const bbox = map.get(b.structNodeId);
          return bbox ? { ...b, bbox } : b;
        });
      } catch {
        // honest degrade — caller still sees the engine's zero-bboxes.
      }
    }
    const entries: ReadingOrderEntry[] = refined.map((b) => ({
      structNodeId: b.structNodeId,
      pageIndex: b.pageIndex,
      order: b.order,
      bbox: b.bbox,
    }));
    const v: PdfGetReadingOrderValue = {
      order: entries,
      warnings: res.value.warnings,
    };
    return ok(v);
  } catch (e) {
    return fail<PdfGetReadingOrderError>(
      'engine_failed',
      safeMessage(e, 'getReadingOrder engine threw'),
    );
  }
}

// =====================================================================
// pdf:setReadingOrder
// =====================================================================

export async function handlePdfSetReadingOrder(
  req: unknown,
  deps: PdfReadingOrderDeps,
): Promise<PdfSetReadingOrderResponse> {
  const parsed = setRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfSetReadingOrderError>('invalid_payload', parsed.error.message);
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<PdfSetReadingOrderError>(
      'handle_not_found',
      `handle ${parsed.data.handle} is not registered`,
    );
  }
  const engine = deps.engineSet ?? setReadingOrder;
  try {
    const res = await engine(
      bytes,
      parsed.data.order.map((e) => ({
        structNodeId: e.structNodeId,
        order: e.order,
      })),
    );
    if (!res.ok) {
      return mapSetEngineErr(res.error, res.message);
    }
    if (deps.setBytes) {
      try {
        deps.setBytes(parsed.data.handle, res.value.bytes);
      } catch {
        // best-effort — log via the caller, not via IPC Result
      }
    }
    const v: PdfSetReadingOrderValue = {
      applied: true,
      warnings: res.value.warnings,
    };
    return ok(v);
  } catch (e) {
    return fail<PdfSetReadingOrderError>(
      'engine_failed',
      safeMessage(e, 'setReadingOrder engine threw'),
    );
  }
}

// =====================================================================
// Engine-error → IPC-error mapping
// =====================================================================

function mapGetEngineErr(err: ReadingOrderEngineError, msg: string): PdfGetReadingOrderResponse {
  switch (err) {
    case 'invalid_payload':
      return fail<PdfGetReadingOrderError>('invalid_payload', msg);
    case 'no_struct_tree':
      return fail<PdfGetReadingOrderError>('no_struct_tree', msg);
    case 'pdf_load_failed':
    case 'order_inconsistent':
    case 'engine_failed':
    default:
      return fail<PdfGetReadingOrderError>('engine_failed', msg);
  }
}

function mapSetEngineErr(err: ReadingOrderEngineError, msg: string): PdfSetReadingOrderResponse {
  switch (err) {
    case 'invalid_payload':
      return fail<PdfSetReadingOrderError>('invalid_payload', msg);
    case 'no_struct_tree':
      return fail<PdfSetReadingOrderError>('no_struct_tree', msg);
    case 'order_inconsistent':
      return fail<PdfSetReadingOrderError>('order_inconsistent', msg);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfSetReadingOrderError>('engine_failed', msg);
  }
}
