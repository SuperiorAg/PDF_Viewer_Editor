// preflight.fonts.all-embedded — cross-profile (X-1a, X-4, A-1b, A-2b).
// Severity: error. Spec: docs/preflight-spec.md §3.1.

import { walkFonts } from './_helpers.js';

import type {
  PreflightContext,
  PreflightProfile,
  PreflightRule,
  PreflightRuleResult,
} from './index.js';

const PROFILES: PreflightProfile[] = ['pdf-x-1a', 'pdf-x-4', 'pdf-a-1b', 'pdf-a-2b'];

function check(profile: PreflightProfile, ctx: PreflightContext): PreflightRuleResult {
  const fonts = walkFonts(ctx.doc);
  const unembedded = fonts.filter((f) => !f.isEmbedded).map((f) => f.baseFont || '(unnamed)');
  const passed = unembedded.length === 0;
  return {
    ruleId: 'preflight.fonts.all-embedded',
    profile,
    severity: 'error',
    passed,
    message: passed ? 'preflight.fonts.allEmbedded.pass' : 'preflight.fonts.allEmbedded.fail',
    locations: [],
    ...(passed ? {} : { details: { unembeddedFonts: unembedded } }),
  };
}

export const rulesFontsAllEmbedded: PreflightRule[] = PROFILES.map((p) => ({
  id: 'preflight.fonts.all-embedded',
  profile: p,
  severity: 'error' as const,
  labelKey: 'preflight.fonts.allEmbedded.label',
  check: (ctx) => check(p, ctx),
}));
