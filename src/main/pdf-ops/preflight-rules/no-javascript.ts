// preflight.no-javascript — cross-profile (X-1a, X-4, A-1b, A-2b).
// Severity: error. Forbids /JS, /JavaScript actions, and /AA additional actions.

import { catalogHasJavaScript } from './_helpers.js';

import type {
  PreflightContext,
  PreflightProfile,
  PreflightRule,
  PreflightRuleResult,
} from './index.js';

const PROFILES: PreflightProfile[] = ['pdf-x-1a', 'pdf-x-4', 'pdf-a-1b', 'pdf-a-2b'];

function check(profile: PreflightProfile, ctx: PreflightContext): PreflightRuleResult {
  const hasJs = catalogHasJavaScript(ctx.doc);
  return {
    ruleId: 'preflight.no-javascript',
    profile,
    severity: 'error',
    passed: !hasJs,
    message: hasJs ? 'preflight.noJavascript.fail' : 'preflight.noJavascript.pass',
    locations: [],
  };
}

export const rulesNoJavascript: PreflightRule[] = PROFILES.map((p) => ({
  id: 'preflight.no-javascript',
  profile: p,
  severity: 'error' as const,
  labelKey: 'preflight.noJavascript.label',
  check: (ctx) => check(p, ctx),
}));
