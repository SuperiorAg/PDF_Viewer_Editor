// preflight.no-encryption — cross-profile (X-1a, X-4, A-1b, A-2b).
// Severity: error. PDF/X and PDF/A both forbid encryption.

import { catalogIsEncrypted } from './_helpers.js';

import type {
  PreflightContext,
  PreflightProfile,
  PreflightRule,
  PreflightRuleResult,
} from './index.js';

const PROFILES: PreflightProfile[] = ['pdf-x-1a', 'pdf-x-4', 'pdf-a-1b', 'pdf-a-2b'];

function check(profile: PreflightProfile, ctx: PreflightContext): PreflightRuleResult {
  const encrypted = catalogIsEncrypted(ctx.doc);
  return {
    ruleId: 'preflight.no-encryption',
    profile,
    severity: 'error',
    passed: !encrypted,
    message: encrypted ? 'preflight.noEncryption.fail' : 'preflight.noEncryption.pass',
    locations: [],
  };
}

export const rulesNoEncryption: PreflightRule[] = PROFILES.map((p) => ({
  id: 'preflight.no-encryption',
  profile: p,
  severity: 'error' as const,
  labelKey: 'preflight.noEncryption.label',
  check: (ctx) => check(p, ctx),
}));
