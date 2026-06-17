// preflight.metadata.xmp-present — cross-profile.
// PDF/X-1a + PDF/X-4 + PDF/A-1b + PDF/A-2b all require an XMP /Metadata stream.

import { extractXmpFacts } from './_helpers.js';

import type {
  PreflightContext,
  PreflightProfile,
  PreflightRule,
  PreflightRuleResult,
} from './index.js';

const PROFILES: PreflightProfile[] = ['pdf-x-1a', 'pdf-x-4', 'pdf-a-1b', 'pdf-a-2b'];

function check(profile: PreflightProfile, ctx: PreflightContext): PreflightRuleResult {
  const xmp = extractXmpFacts(ctx.doc);
  const present = xmp.raw !== null && xmp.raw.includes('<x:xmpmeta');
  return {
    ruleId: 'preflight.metadata.xmp-present',
    profile,
    severity: 'error',
    passed: present,
    message: present ? 'preflight.metadata.xmpPresent.pass' : 'preflight.metadata.xmpPresent.fail',
    locations: [],
  };
}

export const rulesMetadataXmpPresent: PreflightRule[] = PROFILES.map((p) => ({
  id: 'preflight.metadata.xmp-present',
  profile: p,
  severity: 'error' as const,
  labelKey: 'preflight.metadata.xmpPresent.label',
  check: (ctx) => check(p, ctx),
}));
