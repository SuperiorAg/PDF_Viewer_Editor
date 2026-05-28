// Handler: signatures:applyVisual (Phase 4, api-contracts.md §14.3)
//
// H-17.2 (Phase 4.1, Julian Wave 17 review): payload validation is via zod
// `safeParse` at the boundary, matching the discipline already in
// signatures-cert-load / annotations-add-shape. Previous ad-hoc `typeof`
// checks didn't enforce nested structure (placement.mode discriminator,
// appearance.source shape).

import { z } from 'zod';

import { applySignature } from '../../main/pdf-ops/signature-engine.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  SignaturesApplyVisualError,
  SignaturesApplyVisualRequest,
  SignaturesApplyVisualResponse,
} from '../contracts.js';

export interface SignaturesApplyVisualDeps {
  getBytes(h: DocumentHandle): Uint8Array | null;
  setBytes(h: DocumentHandle, b: Uint8Array): void;
}

// Shape-level zod schema. Cross-cuts the discriminated union in
// `VisualAppearanceSource` via a passthrough on `source` (the engine
// validates source.kind specifics — keeping handler validation lean).
const placementSchema = z.object({
  mode: z.enum(['placeholder', 'freeform']),
  fieldName: z.string().optional(),
  pageIndex: z.number().int().nonnegative().optional(),
  rect: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
});

const appearanceSchema = z
  .object({
    source: z.unknown(),
    showName: z.boolean(),
    showDate: z.boolean(),
    showReason: z.boolean(),
    showSubjectCN: z.boolean(),
    showIssuerCN: z.boolean(),
    showTsaInfo: z.boolean(),
    reason: z.string().optional(),
  })
  .passthrough();

const requestSchema = z.object({
  handle: z.number().int().positive(),
  placement: placementSchema,
  appearance: appearanceSchema,
});

export async function handleSignaturesApplyVisual(
  req: SignaturesApplyVisualRequest,
  deps: SignaturesApplyVisualDeps,
): Promise<SignaturesApplyVisualResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SignaturesApplyVisualError>('invalid_payload', parsed.error.message);
  }
  if (!parsed.data.appearance.source || typeof parsed.data.appearance.source !== 'object') {
    return fail<SignaturesApplyVisualError>('invalid_payload', 'appearance.source required');
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<SignaturesApplyVisualError>(
      'handle_not_found',
      `handle ${parsed.data.handle} not found`,
    );
  }
  const r = await applySignature(
    {
      kind: 'visual',
      bytes,
      placement: req.placement,
      appearance: req.appearance,
    },
    { auditLog: null },
  );
  if (!r.ok) {
    if (
      r.error === 'placeholder_field_not_found' ||
      r.error === 'placeholder_field_already_signed' ||
      r.error === 'invalid_placement' ||
      r.error === 'appearance_compose_failed' ||
      r.error === 'serialize_failed'
    ) {
      return fail<SignaturesApplyVisualError>(r.error, r.message);
    }
    return fail<SignaturesApplyVisualError>('serialize_failed', r.message);
  }
  // Update the in-memory document bytes so subsequent ops see the widget.
  deps.setBytes(parsed.data.handle, r.value.newBytes);
  return ok({ op: r.value.op, warnings: r.value.warnings });
}
