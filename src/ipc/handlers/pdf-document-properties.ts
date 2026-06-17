// Handlers: pdf:getDocumentProperties / pdf:setDocumentProperties
//           (Phase 7.5 Wave 5 — B21)
//
// Contract: docs/api-contracts.md §19.4.4.
// Engine:   src/main/pdf-ops/document-properties.ts.

import { z } from 'zod';

import {
  getDocumentProperties,
  setDocumentProperties,
  type DocumentPropertiesError as EngineErr,
} from '../../main/pdf-ops/document-properties.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfGetDocumentPropertiesError,
  PdfGetDocumentPropertiesResponse,
  PdfGetDocumentPropertiesValue,
  PdfSetDocumentPropertiesError,
  PdfSetDocumentPropertiesResponse,
  PdfSetDocumentPropertiesValue,
} from '../contracts.js';

// ============================================================================
// Schemas
// ============================================================================

const getRequestSchema = z.object({
  handle: z.number().int().positive(),
});

const setPropertiesSchema = z.object({
  title: z.union([z.string(), z.null()]).optional(),
  author: z.union([z.string(), z.null()]).optional(),
  subject: z.union([z.string(), z.null()]).optional(),
  keywords: z.array(z.string()).optional(),
  creator: z.union([z.string(), z.null()]).optional(),
  producer: z.union([z.string(), z.null()]).optional(),
  creationDate: z.union([z.number().int(), z.null()]).optional(),
  modificationDate: z.union([z.number().int(), z.null()]).optional(),
  trapped: z
    .union([z.literal('true'), z.literal('false'), z.literal('unknown'), z.null()])
    .optional(),
  customMetadata: z.record(z.string()).optional(),
});

const setRequestSchema = z.object({
  handle: z.number().int().positive(),
  properties: setPropertiesSchema,
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfDocumentPropertiesDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  getEngine?: typeof getDocumentProperties;
  setEngine?: typeof setDocumentProperties;
}

// ============================================================================
// Get handler
// ============================================================================

export async function handlePdfGetDocumentProperties(
  req: unknown,
  deps: PdfDocumentPropertiesDeps,
): Promise<PdfGetDocumentPropertiesResponse> {
  const parsed = getRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfGetDocumentPropertiesError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfGetDocumentPropertiesError>(
      'handle_not_found',
      `handle ${r.handle} is not registered`,
    );
  }

  const engine = deps.getEngine ?? getDocumentProperties;
  let engineRes;
  try {
    engineRes = await engine(bytes);
  } catch (e) {
    return fail<PdfGetDocumentPropertiesError>(
      'engine_failed',
      safeMessage(e, 'document-properties engine threw'),
    );
  }

  if (!engineRes.ok) {
    return mapGetEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  const v: PdfGetDocumentPropertiesValue = {
    properties: engineRes.value.properties,
    securitySummary: engineRes.value.securitySummary,
    pageSizes: engineRes.value.pageSizes,
  };
  return ok(v);
}

// ============================================================================
// Set handler
// ============================================================================

export async function handlePdfSetDocumentProperties(
  req: unknown,
  deps: PdfDocumentPropertiesDeps,
): Promise<PdfSetDocumentPropertiesResponse> {
  const parsed = setRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfSetDocumentPropertiesError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfSetDocumentPropertiesError>(
      'handle_not_found',
      `handle ${r.handle} is not registered`,
    );
  }

  const engine = deps.setEngine ?? setDocumentProperties;
  let engineRes;
  try {
    // Strip `undefined` from optional fields so the engine's
    // exactOptionalPropertyTypes signature accepts the call. zod's parse
    // emits `T | undefined` for `.optional()` fields; the engine's
    // `Partial<EngineDocumentProperties>` (with exactOptionalPropertyTypes
    // on) rejects bare undefined.
    const cleanProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.properties)) {
      if (v !== undefined) cleanProps[k] = v;
    }
    engineRes = await engine({
      pdfBytes: bytes,
      properties: cleanProps as Parameters<typeof engine>[0]['properties'],
    });
  } catch (e) {
    return fail<PdfSetDocumentPropertiesError>(
      'engine_failed',
      safeMessage(e, 'document-properties engine threw'),
    );
  }

  if (!engineRes.ok) {
    return mapSetEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  const v: PdfSetDocumentPropertiesValue = {
    applied: true,
    warnings: engineRes.value.warnings,
  };
  return ok(v);
}

// ============================================================================
// Helpers
// ============================================================================

function mapGetEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfGetDocumentPropertiesResponse {
  switch (engineErr) {
    case 'invalid_payload':
      return fail<PdfGetDocumentPropertiesError>('invalid_payload', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfGetDocumentPropertiesError>('engine_failed', message, details);
  }
}

function mapSetEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfSetDocumentPropertiesResponse {
  switch (engineErr) {
    case 'invalid_payload':
      return fail<PdfSetDocumentPropertiesError>('invalid_payload', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfSetDocumentPropertiesError>('engine_failed', message, details);
  }
}
