// Handler: pdf:listEmbeddedFonts (Phase 7.5 Wave 6 — B18 listing helper).
//
// Contract: src/ipc/contracts.ts (Wave 6 block).
// Engine:   src/main/pdf-ops/font-list.ts.

import { z } from 'zod';

import { listEmbeddedFonts, type FontListError } from '../../main/pdf-ops/font-list.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfListEmbeddedFontsError,
  PdfListEmbeddedFontsResponse,
  PdfListEmbeddedFontsValue,
} from '../contracts.js';

const requestSchema = z.object({
  handle: z.number().int().positive(),
});

export interface PdfListEmbeddedFontsDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  /** Engine seam — tests inject. */
  engine?: typeof listEmbeddedFonts;
}

export async function handlePdfListEmbeddedFonts(
  req: unknown,
  deps: PdfListEmbeddedFontsDeps,
): Promise<PdfListEmbeddedFontsResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfListEmbeddedFontsError>('invalid_payload', parsed.error.message);
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<PdfListEmbeddedFontsError>(
      'handle_not_found',
      `handle ${parsed.data.handle} is not registered`,
    );
  }
  const engine = deps.engine ?? listEmbeddedFonts;
  try {
    const r = await engine(bytes);
    if (!r.ok) {
      return mapEngineErr(r.error, r.message);
    }
    const value: PdfListEmbeddedFontsValue = { fonts: r.value };
    return ok(value);
  } catch (e) {
    return fail<PdfListEmbeddedFontsError>(
      'engine_failed',
      safeMessage(e, 'listEmbeddedFonts engine threw'),
    );
  }
}

function mapEngineErr(err: FontListError, msg: string): PdfListEmbeddedFontsResponse {
  switch (err) {
    case 'invalid_payload':
      return fail<PdfListEmbeddedFontsError>('invalid_payload', msg);
    case 'pdf_load_failed':
      return fail<PdfListEmbeddedFontsError>('pdf_load_failed', msg);
    case 'engine_failed':
    default:
      return fail<PdfListEmbeddedFontsError>('engine_failed', msg);
  }
}
