// a11y.document.language-set — PDF/UA-1 §7.2; WCAG 3.1.1.
// Severity: error. Checks that `/Catalog /Lang` is non-empty.
//
// Rationale: screen readers switch pronunciation models based on /Lang;
// missing the entry forces them to guess based on the host system locale.

import { PDFHexString, PDFName, PDFString } from 'pdf-lib';

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

function check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  const langEntry = ctx.catalog.get(PDFName.of('Lang'));
  let lang: string | null = null;
  if (langEntry instanceof PDFString) lang = langEntry.asString();
  else if (langEntry instanceof PDFHexString) lang = langEntry.decodeText();
  const present = lang !== null && lang.trim().length > 0;
  return {
    status: present ? 'pass' : 'fail',
    message: present ? 'a11y.documentLanguageSet.pass' : 'a11y.documentLanguageSet.fail',
    locations: [],
    ...(present ? {} : { quickFix: { kind: 'open-document-properties' as const } }),
  };
}

export const ruleDocumentLanguageSet: AccessibilityRule = {
  id: 'a11y.document.language-set',
  severity: 'error',
  labelKey: 'a11y.documentLanguageSet.label',
  check,
};
