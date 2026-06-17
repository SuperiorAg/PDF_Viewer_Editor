// Preflight contract stub — Phase 7.5 C2 (Riley Wave 5a).
//
// David's canonical `pdf:runPreflight` channel lands in his parallel
// Wave 5a commit to `src/ipc/contracts.ts`. Until those types are
// re-exported through the renderer gatekeeper (`./ipc-contract`), the
// renderer types the surface LOCALLY here against the exact shape in
// `docs/api-contracts.md §19.6` + `docs/preflight-spec.md §2`. When David
// lands, this file becomes a thin re-export wrapper (same promotion path
// as the prior Wave-5 stubs).
//
// HONESTY CLAUSE: this stub mirrors the engine contract verbatim — the
// "subset of PDF/X / PDF/A" disclosure surfaces in the Preflight panel's
// header (rendered from `modals:preflight.subsetDisclosure`). The
// `shippedRuleCount` field on the engine response drives the user-guide's
// honesty number per `docs/preflight-spec.md §7`.

import type { DocumentHandle } from './ipc-contract';

export type PreflightProfile = 'pdf-x-1a' | 'pdf-x-4' | 'pdf-a-1b' | 'pdf-a-2b';

export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface PreflightLocation {
  pageIndex: number;
  bbox?: [number, number, number, number];
}

export interface PreflightRuleResult {
  /** Stable rule id — see `docs/preflight-spec.md §3`. */
  ruleId: string;
  profile: PreflightProfile;
  severity: PreflightSeverity;
  passed: boolean;
  /** i18n key the renderer resolves via `t()`; the engine returns the
   *  raw key, not a pre-translated string. */
  message: string;
  locations: PreflightLocation[];
}

export interface PdfRunPreflightRequest {
  handle: DocumentHandle;
  profiles: PreflightProfile[];
}

export type PdfRunPreflightError = 'invalid_payload' | 'handle_not_found' | 'engine_failed';

export interface PdfRunPreflightValue {
  results: PreflightRuleResult[];
  /** ms epoch when David's engine completed the run. */
  ranAt: number;
  /** Engine echoes the number of rules it actually executed — drives the
   *  honest "X rules across Y profiles" disclosure in the panel + the
   *  preflight-spec ratchet. */
  shippedRuleCount: number;
}

export type PdfRunPreflightResponse =
  | { ok: true; value: PdfRunPreflightValue }
  | { ok: false; error: PdfRunPreflightError | 'bridge_unavailable'; message: string };

/** Convenience UI grouping — buckets results by severity for the panel
 *  collapsible sections. Pure function so it's testable independently of
 *  the engine; consumed by both the slice (counts) and the panel (render
 *  ordering). */
export interface PreflightSeverityBuckets {
  errors: PreflightRuleResult[];
  warnings: PreflightRuleResult[];
  infos: PreflightRuleResult[];
}

export function bucketResults(results: readonly PreflightRuleResult[]): PreflightSeverityBuckets {
  const errors: PreflightRuleResult[] = [];
  const warnings: PreflightRuleResult[] = [];
  const infos: PreflightRuleResult[] = [];
  for (const r of results) {
    if (r.passed) continue; // Panel surfaces only failures + info hits.
    switch (r.severity) {
      case 'error':
        errors.push(r);
        break;
      case 'warning':
        warnings.push(r);
        break;
      case 'info':
        infos.push(r);
        break;
    }
  }
  return { errors, warnings, infos };
}

/** Default profile picks — both modern profiles selected. The user can
 *  uncheck either before clicking Run. */
export const DEFAULT_PROFILES: readonly PreflightProfile[] = ['pdf-x-4', 'pdf-a-2b'];

export const ALL_PROFILES: readonly PreflightProfile[] = [
  'pdf-x-1a',
  'pdf-x-4',
  'pdf-a-1b',
  'pdf-a-2b',
];
