// preflight.metadata.xmp-pdfaid-part-2 — PDF/A-2b, severity error.
// XMP metadata must include `pdfaid:part = 2` AND `pdfaid:conformance = B`.

import { extractXmpFacts } from './_helpers.js';

import type { PreflightContext, PreflightRule, PreflightRuleResult } from './index.js';

export const rulePdfA2bXmpMarker: PreflightRule = {
  id: 'preflight.metadata.xmp-pdfaid-part-2',
  profile: 'pdf-a-2b',
  severity: 'error',
  labelKey: 'preflight.metadata.xmpPdfaidPart2.label',
  check(ctx: PreflightContext): PreflightRuleResult {
    const xmp = extractXmpFacts(ctx.doc);
    const partOk = xmp.pdfaidPart === '2';
    const confOk = xmp.pdfaidConformance === 'B';
    const passed = partOk && confOk;
    return {
      ruleId: 'preflight.metadata.xmp-pdfaid-part-2',
      profile: 'pdf-a-2b',
      severity: 'error',
      passed,
      message: passed
        ? 'preflight.metadata.xmpPdfaidPart2.pass'
        : 'preflight.metadata.xmpPdfaidPart2.fail',
      locations: [],
      ...(passed
        ? {}
        : { details: { pdfaidPart: xmp.pdfaidPart, pdfaidConformance: xmp.pdfaidConformance } }),
    };
  },
};
