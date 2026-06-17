// Stamps repo-pattern IPC shim — Phase 7.5 B7 (Riley Wave 3).
//
// David has NOT yet exposed `window.pdfApi.stamps.{list,add,remove}` as of
// Wave 3 (open question for Marcus — see docs/api-contracts.md §19.10 which
// reserves the three channel names following the bookmarks:* shape, but the
// contract types + handlers + preload bridge are deferred to a later wave).
//
// This shim gives the renderer a typed surface to write against today. When
// David lands the live bridge, the implementation here swaps in a single
// place — every panel + thunk consuming `stampsApi` is untouched.
//
// L-006 cross-check: not a `__test:*` channel; no NODE_ENV gate required.

import type { Result } from '../../shared/result';
import { fail, ok } from '../../shared/result';
import type { StampLibraryEntry } from '../state/slices/stamps-slice';

type StampsListError = 'bridge_unavailable' | 'engine_failed';
type StampsAddError = 'bridge_unavailable' | 'invalid_payload' | 'engine_failed';
type StampsRemoveError = 'bridge_unavailable' | 'not_found' | 'engine_failed';

export interface StampsApi {
  /** List the user's custom stamps (built-ins merge in renderer-side). */
  list(): Promise<Result<StampLibraryEntry[], StampsListError>>;
  /** Persist a new custom stamp. Returns the row id. */
  add(
    entry: Omit<StampLibraryEntry, 'id' | 'isBuiltin' | 'lastUsedAt'>,
  ): Promise<Result<{ id: string }, StampsAddError>>;
  /** Remove a custom stamp by id. Built-in ids are rejected. */
  remove(id: string): Promise<Result<{ removed: true }, StampsRemoveError>>;
}

/** Fallback API when the live bridge isn't exposed yet (Wave 3 default). */
const fallbackApi: StampsApi = {
  list: () => Promise.resolve(ok<StampLibraryEntry[]>([])),
  add: () =>
    Promise.resolve(
      fail<StampsAddError>('bridge_unavailable', 'window.pdfApi.stamps is not exposed yet'),
    ),
  remove: () =>
    Promise.resolve(
      fail<StampsRemoveError>('bridge_unavailable', 'window.pdfApi.stamps is not exposed yet'),
    ),
};

function resolveStampsApi(): StampsApi {
  if (typeof window !== 'undefined' && window.pdfApi !== undefined) {
    // The live bridge will expose `window.pdfApi.stamps` with the same
    // `StampsApi` shape — we feature-detect rather than augment the
    // canonical PdfApi type (which lives under David's ownership).
    const w = window.pdfApi as unknown as { stamps?: StampsApi };
    if (w.stamps !== undefined) return w.stamps;
  }
  return fallbackApi;
}

export const stampsApi: StampsApi = new Proxy({} as StampsApi, {
  get(_target, prop: keyof StampsApi) {
    const live = resolveStampsApi();
    return live[prop];
  },
}) as StampsApi;
