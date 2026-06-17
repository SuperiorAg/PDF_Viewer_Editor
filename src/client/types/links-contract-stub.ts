// Link types — Phase 7.5 B13 (Riley Wave 4).
//
// David's canonical `pdf:editLinks` channel in `src/ipc/contracts.ts` is the
// source of truth for the on-wire shape. Renderer code uses the canonical
// `LinkTarget` + `LinkAction` types directly; this file re-exports them
// under the renderer's gatekeeper path and adds the renderer-only
// `PdfLinkAnnotation` shape that the in-memory `links-slice` stores.
//
// Wave 4 dispatch notice: the file was originally introduced as a stub
// (matching the brief: "if David's contracts are missing pieces, leave
// typed stub + open question"). David's contract landed `pdf:editLinks`
// in lockstep with this wave so the stub is a thin wrapper, not a fiction.

// Renderer routes through the gatekeeper `./ipc-contract` (conventions §4.3).
// That re-exports David's canonical shapes; we extend with the renderer-only
// `PdfLinkAnnotation` model below.
import type {
  LinkAction,
  LinkTarget,
  PdfEditLinksError,
  PdfEditLinksRequest,
  PdfEditLinksResponse,
  PdfEditLinksValue,
} from './ipc-contract';

export type {
  LinkAction,
  LinkTarget,
  PdfEditLinksError,
  PdfEditLinksRequest,
  PdfEditLinksResponse,
  PdfEditLinksValue,
};

export interface PdfLinkAnnotation {
  /** Stable identifier (renderer-side uuid OR engine-returned `linkIds[i]`). */
  readonly id: string;
  readonly pageIndex: number;
  /** PDF user-space rectangle. Bottom-left origin. */
  readonly rect: { x: number; y: number; width: number; height: number };
  readonly target: LinkTarget;
  readonly createdAt: number;
  readonly modifiedAt: number;
}
