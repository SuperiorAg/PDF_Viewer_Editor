// a11y.document.title-present — PDF/UA-1 §7.1; WCAG 2.4.2.
// Severity: error. Checks that `/Info /Title` is non-empty.
//
// Rationale: assistive tech announces the document title; an empty one
// leaves users with the filename as the only orientation cue.

import { PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib';

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

function check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  let title: string | null = null;
  try {
    const infoRef = ctx.doc.context.trailerInfo.Info;
    if (infoRef) {
      const info = ctx.doc.context.lookup(infoRef);
      if (info instanceof PDFDict) {
        const t = info.get(PDFName.of('Title'));
        if (t instanceof PDFString) title = t.asString();
        else if (t instanceof PDFHexString) title = t.decodeText();
      }
    }
  } catch {
    // defensive — treat as missing rather than throwing
  }
  const present = title !== null && title.trim().length > 0;
  return {
    status: present ? 'pass' : 'fail',
    message: present ? 'a11y.documentTitlePresent.pass' : 'a11y.documentTitlePresent.fail',
    locations: [],
    ...(present ? {} : { quickFix: { kind: 'open-document-properties' as const } }),
  };
}

export const ruleDocumentTitlePresent: AccessibilityRule = {
  id: 'a11y.document.title-present',
  severity: 'error',
  labelKey: 'a11y.documentTitlePresent.label',
  check,
};
