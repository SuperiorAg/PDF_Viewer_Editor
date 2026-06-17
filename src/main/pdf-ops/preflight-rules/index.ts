// Phase 7.5 Wave 5a — Preflight rule registry.
//
// Each rule lives in its own file (≤200 lines per the modularization rule).
// This module re-exports the full shipped set as a single array; the engine
// iterates it.
//
// SHIPPED RULE COUNT (honest disclosure — preflight-spec.md §3 + §7):
//   Wave 5a ships the SUBSET below. Spec §7 calls for ~30 rules at v0.8.0
//   cut; we ship the framework + the highest-leverage cross-profile and
//   per-profile rules now, and the remainder land in follow-up commits
//   inside Phase 7.5. The honest-disclosure regression test in
//   preflight-engine.test.ts reads this array's length, so number-changes
//   are caught at the test boundary.
//
// File-naming convention:
//   `<rule-id>.ts` where the rule-id matches the `preflight.<category>.<verb>`
//   tokens in preflight-spec.md §3.

import type { PDFDocument } from 'pdf-lib';

export type PreflightProfile = 'pdf-x-1a' | 'pdf-x-4' | 'pdf-a-1b' | 'pdf-a-2b';
export type PreflightSeverity = 'error' | 'warning' | 'info';

export interface PreflightContext {
  doc: PDFDocument;
}

export interface PreflightRuleResult {
  ruleId: string;
  profile: PreflightProfile;
  severity: PreflightSeverity;
  passed: boolean;
  /** i18n key (per docs/api-contracts.md §19.19). Renderer resolves. */
  message: string;
  locations: { pageIndex: number; bbox?: [number, number, number, number] }[];
  /** Optional rule-specific diagnostic payload. Not surfaced over IPC value
   *  yet, but useful for engine tests + future debugging. */
  details?: Record<string, unknown>;
}

export interface PreflightRule {
  id: string;
  profile: PreflightProfile;
  severity: PreflightSeverity;
  /** i18n key for the rule's user-facing label. */
  labelKey: string;
  check(ctx: PreflightContext): PreflightRuleResult;
}

// Rule modules. Auto-sorted by ESLint import/order; grouped logically in the
// ALL_PREFLIGHT_RULES array below (cross-profile first, then per-profile).
import { rulesFontsAllEmbedded } from './fonts-all-embedded.js';
import { rulesMetadataXmpPresent } from './metadata-xmp-present.js';
import { rulesNoEmbeddedFiles } from './no-embedded-files.js';
import { rulesNoEncryption } from './no-encryption.js';
import { rulesNoJavascript } from './no-javascript.js';
import { rulePdfA1bNoLaunchActions } from './pdf-a-1b-no-launch-actions.js';
import { rulePdfA1bXmpMarker } from './pdf-a-1b-xmp-marker.js';
import { rulePdfA2bXmpMarker } from './pdf-a-2b-xmp-marker.js';
import { rulePdfX1aOutputIntentPresent } from './pdf-x-1a-output-intent.js';
import { rulePdfX1aTrappingSpecified } from './pdf-x-1a-trapping.js';

export const ALL_PREFLIGHT_RULES: ReadonlyArray<PreflightRule> = [
  ...rulesFontsAllEmbedded,
  ...rulesNoEncryption,
  ...rulesNoJavascript,
  ...rulesMetadataXmpPresent,
  ...rulesNoEmbeddedFiles,
  rulePdfX1aOutputIntentPresent,
  rulePdfX1aTrappingSpecified,
  rulePdfA1bXmpMarker,
  rulePdfA1bNoLaunchActions,
  rulePdfA2bXmpMarker,
];
