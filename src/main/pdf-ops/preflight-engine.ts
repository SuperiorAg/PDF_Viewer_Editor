// Phase 7.5 Wave 5a — C2 Preflight rules engine.
//
// Canonical spec:
//   - docs/preflight-spec.md — rule enumeration, profiles, severity.
//   - docs/api-contracts.md §19.6 (`pdf:runPreflight`).
//   - docs/architecture-phase-7.5.md §4.5.
//
// Wave 5a ships a SUBSET of the rules enumerated in preflight-spec.md §3 —
// honest disclosure per the four-location ratchet (§7). Each rule lives in
// `src/main/pdf-ops/preflight-rules/<rule-id>.ts` and exports a
// `PreflightRule` constant. The engine:
//   1. Loads the source via pdf-lib (no pdf.js — pure pdf-lib per L-004/L-005
//      compliance note in the spec).
//   2. For each requested profile, runs every rule whose `profile` matches.
//   3. Returns a flat `PreflightRuleResult[]` (cross-profile rules are
//      run once per profile they apply to so the UI can group by profile
//      without ambiguity).
//
// Engine surface:
//   `runPreflight({ pdfBytes, profiles })` -> Result<PreflightEngineValue, ...>
//   Each rule is a plain function — Promise.all over rules for parallelism
//   (rules are pure; no shared state between them).

import { PDFDocument } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

import {
  ALL_PREFLIGHT_RULES,
  type PreflightProfile,
  type PreflightRule,
  type PreflightRuleResult,
} from './preflight-rules/index.js';

export type PreflightEngineError = 'invalid_payload' | 'pdf_load_failed' | 'engine_failed';

export interface PreflightEngineOptions {
  pdfBytes: Uint8Array;
  profiles: ReadonlyArray<PreflightProfile>;
}

export interface PreflightEngineValue {
  results: PreflightRuleResult[];
  ranAt: number;
  shippedRuleCount: number;
}

export async function runPreflight(
  opts: PreflightEngineOptions,
): Promise<Result<PreflightEngineValue, PreflightEngineError>> {
  if (!(opts.pdfBytes instanceof Uint8Array) || opts.pdfBytes.byteLength === 0) {
    return fail<PreflightEngineError>('invalid_payload', 'pdfBytes must be a non-empty Uint8Array');
  }
  if (!Array.isArray(opts.profiles) || opts.profiles.length === 0) {
    return fail<PreflightEngineError>('invalid_payload', 'profiles must be a non-empty array');
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<PreflightEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const requestedProfiles = new Set<PreflightProfile>(opts.profiles);
  const results: PreflightRuleResult[] = [];

  // Run rules. Each rule is synchronous (pure pdf-lib reads); we still wrap
  // in try/catch so one buggy rule cannot kill the whole report.
  for (const rule of ALL_PREFLIGHT_RULES) {
    if (!requestedProfiles.has(rule.profile)) continue;
    try {
      const r = rule.check({ doc });
      results.push(r);
    } catch (e) {
      results.push({
        ruleId: rule.id,
        profile: rule.profile,
        severity: 'warning',
        passed: false,
        message: 'preflight.rule.threw',
        locations: [],
        details: { error: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  return ok<PreflightEngineValue>({
    results,
    ranAt: Date.now(),
    shippedRuleCount: ALL_PREFLIGHT_RULES.length,
  });
}

// Re-export for callers.
export type { PreflightProfile, PreflightRule, PreflightRuleResult };
