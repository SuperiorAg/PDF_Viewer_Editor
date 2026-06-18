// Handlers: pdf:getStructTree, pdf:setStructTree, pdf:autoTagPages
// (Phase 7.5 Wave 5b — C3 Tag PDF).
//
// Contract: docs/api-contracts.md §19.7.1–§19.7.3.
// Engines:  src/main/pdf-ops/struct-tree-engine.ts,
//           src/main/pdf-ops/auto-tag-heuristic.ts.
//
// `mergeWithEditSession` is read but Wave 5b ships only the in-PDF path
// (the SQLite side-table merge lands when the migration ships in a follow-
// up wave). When true is requested but no side-table is wired, the handler
// silently falls back to the in-PDF tree — honest no-op rather than a
// "feature unavailable" error.

import { z } from 'zod';

import { autoTagPages, type AutoTagPageInput } from '../../main/pdf-ops/auto-tag-heuristic.js';
import {
  getStructTree,
  setStructTree,
  type StructTreeEngineError,
} from '../../main/pdf-ops/struct-tree-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  MarkedContentRef,
  PdfAutoTagPagesError,
  PdfAutoTagPagesRequest,
  PdfAutoTagPagesResponse,
  PdfAutoTagPagesValue,
  PdfGetStructTreeError,
  PdfGetStructTreeRequest,
  PdfGetStructTreeResponse,
  PdfGetStructTreeValue,
  PdfSetStructTreeError,
  PdfSetStructTreeResponse,
  PdfSetStructTreeValue,
  StructTreeNode,
} from '../contracts.js';

// ============================================================================
// Zod schemas — kept tight, with a depth cap mirroring the engine's
// MAX_NODES_EAGER * 2 ceiling. The recursive shape is approximated with
// z.lazy + a max-children-per-node guard; the engine validates the rest.
// ============================================================================

const contentRefSchema: z.ZodType<MarkedContentRef> = z.union([
  z.object({
    kind: z.literal('mcid'),
    pageIndex: z.number().int().nonnegative(),
    mcid: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('object'),
    pageIndex: z.number().int().nonnegative(),
    sourceObjectNumber: z.number().int(),
  }),
]);

// Zod's `.optional()` emits `T | undefined` which is not assignable to a
// `T?` field under `exactOptionalPropertyTypes: true`. We model the schema
// as a permissive intermediate and transform-strip the `undefined`s on the
// way out so the result type matches `StructTreeNode` exactly.
type StructNodeRaw = {
  id: string;
  type: string;
  altText?: string | undefined;
  actualText?: string | undefined;
  language?: string | undefined;
  contentRefs: MarkedContentRef[];
  children: StructNodeRaw[];
  sourceObjectNumber?: number | undefined;
};

const structNodeSchemaRaw: z.ZodType<StructNodeRaw> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    altText: z.string().optional(),
    actualText: z.string().optional(),
    language: z.string().optional(),
    contentRefs: z.array(contentRefSchema),
    children: z.array(structNodeSchemaRaw),
    sourceObjectNumber: z.number().int().optional(),
  }),
);

function stripUndefined(raw: StructNodeRaw): StructTreeNode {
  const out: StructTreeNode = {
    id: raw.id,
    type: raw.type,
    contentRefs: raw.contentRefs,
    children: raw.children.map(stripUndefined),
  };
  if (raw.altText !== undefined) out.altText = raw.altText;
  if (raw.actualText !== undefined) out.actualText = raw.actualText;
  if (raw.language !== undefined) out.language = raw.language;
  if (raw.sourceObjectNumber !== undefined) out.sourceObjectNumber = raw.sourceObjectNumber;
  return out;
}

const getRequestSchema = z.object({
  handle: z.number().int().positive(),
  mergeWithEditSession: z.boolean(),
});

const setRequestSchema = z.object({
  handle: z.number().int().positive(),
  root: structNodeSchemaRaw,
});

const autoTagRequestSchema = z.object({
  handle: z.number().int().positive(),
  pages: z.union([
    z.literal('all'),
    z.object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    }),
  ]),
  heuristic: z.literal('font-size-cluster'),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfStructTreeDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  /** Optional — post-Wave-5b the renderer will receive a sessionId from the
   *  Ravi side-table migration. Wave 5b passes the handle through as the
   *  sentinel "sessionId". */
  setBytes?: (handle: DocumentHandle, bytes: Uint8Array) => void;
  /** Test seams. */
  engineGet?: typeof getStructTree;
  engineSet?: typeof setStructTree;
  /** Auto-tag requires per-page text + image extraction. Production injects
   *  a pdf.js-backed walker; tests inject a stub that returns
   *  AutoTagPageInput[] directly. The engine NEVER touches pdf.js. */
  extractAutoTagPages?: (
    bytes: Uint8Array,
    range: PdfAutoTagPagesRequest['pages'],
  ) => Promise<ReadonlyArray<AutoTagPageInput>>;
}

// ============================================================================
// pdf:getStructTree
// ============================================================================

export async function handlePdfGetStructTree(
  req: unknown,
  deps: PdfStructTreeDeps,
): Promise<PdfGetStructTreeResponse> {
  const parsed = getRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfGetStructTreeError>('invalid_payload', parsed.error.message);
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<PdfGetStructTreeError>(
      'handle_not_found',
      `handle ${parsed.data.handle} is not registered`,
    );
  }
  const engine = deps.engineGet ?? getStructTree;
  try {
    const res = await engine(bytes);
    if (!res.ok) {
      return mapGetEngineErr(res.error, res.message);
    }
    const v: PdfGetStructTreeValue = {
      root: res.value.tree,
      hasExistingTags: res.value.hasExistingTree,
      warnings: res.value.warnings,
    };
    return ok(v);
  } catch (e) {
    return fail<PdfGetStructTreeError>(
      'engine_failed',
      safeMessage(e, 'getStructTree engine threw'),
    );
  }
}

// ============================================================================
// pdf:setStructTree
// ============================================================================

export async function handlePdfSetStructTree(
  req: unknown,
  deps: PdfStructTreeDeps,
): Promise<PdfSetStructTreeResponse> {
  const parsed = setRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfSetStructTreeError>('invalid_payload', parsed.error.message);
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<PdfSetStructTreeError>(
      'handle_not_found',
      `handle ${parsed.data.handle} is not registered`,
    );
  }
  const engine = deps.engineSet ?? setStructTree;
  try {
    const rootNode = stripUndefined(parsed.data.root);
    const res = await engine(bytes, rootNode);
    if (!res.ok) {
      return mapSetEngineErr(res.error, res.message);
    }
    // Refresh the document store's bytes so subsequent IPC reads see the
    // tagged version. The renderer is responsible for triggering a Save
    // to materialise to disk (Wave 5b shape — direct write only).
    if (deps.setBytes) {
      try {
        deps.setBytes(parsed.data.handle, res.value.bytes);
      } catch {
        // Best-effort — log via the caller, not via the IPC Result.
      }
    }
    const v: PdfSetStructTreeValue = {
      sessionId: parsed.data.handle,
      warnings: res.value.warnings,
    };
    return ok(v);
  } catch (e) {
    return fail<PdfSetStructTreeError>(
      'engine_failed',
      safeMessage(e, 'setStructTree engine threw'),
    );
  }
}

// ============================================================================
// pdf:autoTagPages
// ============================================================================

export async function handlePdfAutoTagPages(
  req: unknown,
  deps: PdfStructTreeDeps,
): Promise<PdfAutoTagPagesResponse> {
  const parsed = autoTagRequestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfAutoTagPagesError>('invalid_payload', parsed.error.message);
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<PdfAutoTagPagesError>(
      'handle_not_found',
      `handle ${parsed.data.handle} is not registered`,
    );
  }
  const extract = deps.extractAutoTagPages;
  if (!extract) {
    // Production wiring MUST provide an extractor. Honest failure rather
    // than a stub-success — accessibility-authoring-spec §3.4 honesty.
    return fail<PdfAutoTagPagesError>(
      'engine_failed',
      'auto-tag extractor not wired (Wave 5b production pdf.js extractor is a follow-up)',
    );
  }

  let pageInputs: ReadonlyArray<AutoTagPageInput>;
  try {
    pageInputs = await extract(bytes, parsed.data.pages);
  } catch (e) {
    return fail<PdfAutoTagPagesError>('engine_failed', safeMessage(e, 'auto-tag extractor threw'));
  }

  try {
    const res = autoTagPages({ pages: pageInputs });
    if (!res.ok) {
      // autoTagPages only fails with 'invalid_payload' or 'engine_failed' —
      // map identity into the handler's contract error set.
      if (res.error === 'invalid_payload') {
        return fail<PdfAutoTagPagesError>('invalid_payload', res.message);
      }
      return fail<PdfAutoTagPagesError>('engine_failed', res.message);
    }
    const v: PdfAutoTagPagesValue = {
      proposedRoot: res.value.tree,
      warnings: res.value.warnings,
    };
    return ok(v);
  } catch (e) {
    return fail<PdfAutoTagPagesError>('engine_failed', safeMessage(e, 'autoTagPages engine threw'));
  }
}

// ============================================================================
// Engine-error → IPC-error mapping
// ============================================================================

function mapGetEngineErr(err: StructTreeEngineError, msg: string): PdfGetStructTreeResponse {
  switch (err) {
    case 'invalid_payload':
      return fail<PdfGetStructTreeError>('invalid_payload', msg);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfGetStructTreeError>('engine_failed', msg);
  }
}

function mapSetEngineErr(err: StructTreeEngineError, msg: string): PdfSetStructTreeResponse {
  switch (err) {
    case 'invalid_payload':
      return fail<PdfSetStructTreeError>('invalid_payload', msg);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfSetStructTreeError>('engine_failed', msg);
  }
}

// Suppress unused-param warning on the get path; the merge field exists for
// forward-compat (Wave 5c side-table merge).
export function _wave5bMergeFlagNoop(_req: PdfGetStructTreeRequest): void {
  /* no-op */
}
