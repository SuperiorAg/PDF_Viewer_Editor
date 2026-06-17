// preflight.output-intent.present — PDF/X-1a, severity error.
// PDF/X requires at least one /OutputIntents entry with a PDF/X output intent.

import { outputIntentExists } from './_helpers.js';

import type { PreflightContext, PreflightRule, PreflightRuleResult } from './index.js';

export const rulePdfX1aOutputIntentPresent: PreflightRule = {
  id: 'preflight.output-intent.present',
  profile: 'pdf-x-1a',
  severity: 'error',
  labelKey: 'preflight.outputIntent.present.label',
  check(ctx: PreflightContext): PreflightRuleResult {
    const present = outputIntentExists(ctx.doc);
    return {
      ruleId: 'preflight.output-intent.present',
      profile: 'pdf-x-1a',
      severity: 'error',
      passed: present,
      message: present
        ? 'preflight.outputIntent.present.pass'
        : 'preflight.outputIntent.present.fail',
      locations: [],
    };
  },
};
