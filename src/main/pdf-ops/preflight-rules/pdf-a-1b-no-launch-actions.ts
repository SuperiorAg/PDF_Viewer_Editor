// preflight.actions.no-launch-actions — PDF/A-1b, severity error.
// No /Launch actions in catalog or annotations.

import { catalogHasLaunchAction } from './_helpers.js';

import type { PreflightContext, PreflightRule, PreflightRuleResult } from './index.js';

export const rulePdfA1bNoLaunchActions: PreflightRule = {
  id: 'preflight.actions.no-launch-actions',
  profile: 'pdf-a-1b',
  severity: 'error',
  labelKey: 'preflight.actions.noLaunchActions.label',
  check(ctx: PreflightContext): PreflightRuleResult {
    const has = catalogHasLaunchAction(ctx.doc);
    return {
      ruleId: 'preflight.actions.no-launch-actions',
      profile: 'pdf-a-1b',
      severity: 'error',
      passed: !has,
      message: has
        ? 'preflight.actions.noLaunchActions.fail'
        : 'preflight.actions.noLaunchActions.pass',
      locations: [],
    };
  },
};
