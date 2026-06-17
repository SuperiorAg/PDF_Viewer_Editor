// preflight.no-embedded-files — PDF/X-1a, PDF/X-4, PDF/A-1b only.
// PDF/A-2b ALLOWS embedded files (with caveats) so we exclude it from this rule
// — the A-2b allowance is itself an info-rule (`preflight.embedded-files.allowed`)
// that lives in pdf-a-2b-xmp-marker.ts territory.

import { catalogEmbeddedFileCount } from './_helpers.js';

import type {
  PreflightContext,
  PreflightProfile,
  PreflightRule,
  PreflightRuleResult,
} from './index.js';

const PROFILES: PreflightProfile[] = ['pdf-x-1a', 'pdf-x-4', 'pdf-a-1b'];

function check(profile: PreflightProfile, ctx: PreflightContext): PreflightRuleResult {
  const count = catalogEmbeddedFileCount(ctx.doc);
  const passed = count === 0;
  return {
    ruleId: 'preflight.no-embedded-files',
    profile,
    severity: 'error',
    passed,
    message: passed ? 'preflight.noEmbeddedFiles.pass' : 'preflight.noEmbeddedFiles.fail',
    locations: [],
    ...(passed ? {} : { details: { embeddedFileCount: count } }),
  };
}

export const rulesNoEmbeddedFiles: PreflightRule[] = PROFILES.map((p) => ({
  id: 'preflight.no-embedded-files',
  profile: p,
  severity: 'error' as const,
  labelKey: 'preflight.noEmbeddedFiles.label',
  check: (ctx) => check(p, ctx),
}));
