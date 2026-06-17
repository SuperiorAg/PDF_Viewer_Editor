// Handler: pdf:editLinks (Phase 7.5 Wave 4 — B13)
//
// Contract: docs/api-contracts.md §19.15.1.
// Engine:   src/main/pdf-ops/link-engine.ts.

import { z } from 'zod';

import {
  editLinks,
  type EngineLinkAction,
  type EngineLinkTarget,
  type LinkEngineError as EngineErr,
} from '../../main/pdf-ops/link-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfEditLinksError,
  PdfEditLinksResponse,
  PdfEditLinksValue,
} from '../contracts.js';

// ============================================================================
// Schemas
// ============================================================================

const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uri'), uri: z.string().min(1) }),
  z.object({
    kind: z.literal('goto-page'),
    pageIndex: z.number().int().nonnegative(),
    zoom: z
      .union([z.literal('fit-page'), z.literal('fit-width'), z.number().positive()])
      .optional(),
  }),
  z.object({
    kind: z.literal('goto-bookmark'),
    bookmarkId: z.number().int().nonnegative(),
  }),
]);

const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('add'),
    pageIndex: z.number().int().nonnegative(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    target: targetSchema,
  }),
  z.object({
    kind: z.literal('update'),
    linkId: z.string().min(1),
    target: targetSchema,
  }),
  z.object({
    kind: z.literal('remove'),
    linkId: z.string().min(1),
  }),
]);

const requestSchema = z.object({
  handle: z.number().int().positive(),
  actions: z.array(actionSchema).min(1),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfEditLinksDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  linkEngine?: typeof editLinks;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfEditLinks(
  req: unknown,
  deps: PdfEditLinksDeps,
): Promise<PdfEditLinksResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfEditLinksError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfEditLinksError>('handle_not_found', `handle ${r.handle} is not registered`);
  }

  const actions: EngineLinkAction[] = r.actions.map(contractActionToEngine);

  const engine = deps.linkEngine ?? editLinks;
  let engineRes;
  try {
    engineRes = await engine(bytes, actions);
  } catch (e) {
    return fail<PdfEditLinksError>('engine_failed', safeMessage(e, 'link engine threw'));
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  const v: PdfEditLinksValue = { linkIds: engineRes.value.linkIds };
  return ok(v);
}

// ============================================================================
// Helpers
// ============================================================================

// `r.actions` items are the zod-INFERRED shape (optional fields carry
// `| undefined`). The engine and the contract `LinkAction` shape do NOT carry
// `| undefined` on optionals (exactOptionalPropertyTypes: true). The mappers
// below strip undefined via conditional spread so both targets typecheck.
type ZodLinkTarget =
  | { kind: 'uri'; uri: string }
  | { kind: 'goto-page'; pageIndex: number; zoom?: 'fit-page' | 'fit-width' | number | undefined }
  | { kind: 'goto-bookmark'; bookmarkId: number };

type ZodLinkAction =
  | {
      kind: 'add';
      pageIndex: number;
      bbox: [number, number, number, number];
      target: ZodLinkTarget;
    }
  | { kind: 'update'; linkId: string; target: ZodLinkTarget }
  | { kind: 'remove'; linkId: string };

function contractActionToEngine(a: ZodLinkAction): EngineLinkAction {
  if (a.kind === 'add') {
    return {
      kind: 'add',
      pageIndex: a.pageIndex,
      bbox: a.bbox,
      target: contractTargetToEngine(a.target),
    };
  }
  if (a.kind === 'update') {
    return { kind: 'update', linkId: a.linkId, target: contractTargetToEngine(a.target) };
  }
  return { kind: 'remove', linkId: a.linkId };
}

function contractTargetToEngine(t: ZodLinkTarget): EngineLinkTarget {
  if (t.kind === 'uri') return { kind: 'uri', uri: t.uri };
  if (t.kind === 'goto-page') {
    return t.zoom !== undefined
      ? { kind: 'goto-page', pageIndex: t.pageIndex, zoom: t.zoom }
      : { kind: 'goto-page', pageIndex: t.pageIndex };
  }
  return { kind: 'goto-bookmark', bookmarkId: t.bookmarkId };
}

function mapEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfEditLinksResponse {
  switch (engineErr) {
    case 'invalid_payload':
      return fail<PdfEditLinksError>('invalid_payload', message, details);
    case 'page_out_of_range':
      // page_out_of_range from the engine surfaces as invalid_payload at the
      // IPC layer per §19.15.1 error enum (no page_out_of_range alias).
      return fail<PdfEditLinksError>('invalid_payload', message, details);
    case 'link_not_found':
      return fail<PdfEditLinksError>('link_not_found', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfEditLinksError>('engine_failed', message, details);
  }
}
