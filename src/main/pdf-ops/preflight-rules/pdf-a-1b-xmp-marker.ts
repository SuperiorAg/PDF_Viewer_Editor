// preflight.metadata.xmp-pdfaid-marker — PDF/A-1b, severity error.
// XMP metadata must include `pdfaid:part = 1` AND `pdfaid:conformance = B`.

import { extractXmpFacts } from './_helpers.js';

import type { PreflightContext, PreflightRule, PreflightRuleResult } from './index.js';

export const rulePdfA1bXmpMarker: PreflightRule = {
  id: 'preflight.metadata.xmp-pdfaid-marker',
  profile: 'pdf-a-1b',
  severity: 'error',
  labelKey: 'preflight.metadata.xmpPdfaidMarker.label',
  check(ctx: PreflightContext): PreflightRuleResult {
    const xmp = extractXmpFacts(ctx.doc);
    const partOk = xmp.pdfaidPart === '1';
    const confOk = xmp.pdfaidConformance === 'B';
    const passed = partOk && confOk;
    return {
      ruleId: 'preflight.metadata.xmp-pdfaid-marker',
      profile: 'pdf-a-1b',
      severity: 'error',
      passed,
      message: passed
        ? 'preflight.metadata.xmpPdfaidMarker.pass'
        : 'preflight.metadata.xmpPdfaidMarker.fail',
      locations: [],
      ...(passed
        ? {}
        : { details: { pdfaidPart: xmp.pdfaidPart, pdfaidConformance: xmp.pdfaidConformance } }),
    };
  },
};
