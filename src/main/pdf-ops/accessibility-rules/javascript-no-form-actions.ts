// a11y.behavior.javascript-no-form-actions — PDF/UA-1 §7.17; WCAG 2.2.2.
// Severity: warning. Avoid embedded JavaScript actions that side-effect
// form behavior — they're frequently inaccessible to AT and can change
// content unexpectedly during form fill.
//
// Coarse detection (documented limitation): we walk three known places
// for JS actions in a tagged PDF:
//   1. /Catalog /OpenAction — a single action OR an array containing one.
//   2. /Catalog /Names /JavaScript — a name tree of named JS scripts.
//   3. /AcroForm /Fields[*] /AA + /A — per-field action dicts.
//
// Detection is intentionally OR-of-found-once: any single JS action
// anywhere flips this rule to `warn`. We do NOT try to enumerate every
// JS site (the spec calls out the dozen-plus AA event names like /F /K /V
// /D etc.); a single hit is enough signal for the user to investigate.
// This is acceptable for a warning-severity rule — false negatives are
// possible (e.g. JS deeply nested in an annotation's AA dict we don't
// walk into), but a positive hit is always a true positive.

import { PDFArray, PDFDict, PDFName, PDFRef, type PDFObject } from 'pdf-lib';

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

function isJavaScriptAction(obj: PDFObject | undefined, ctx: AccessibilityCheckContext): boolean {
  if (obj === undefined) return false;
  let resolved: PDFObject | undefined;
  if (obj instanceof PDFRef) {
    resolved = ctx.doc.context.lookup(obj) ?? undefined;
  } else {
    resolved = obj;
  }
  if (!(resolved instanceof PDFDict)) return false;
  const s = resolved.lookupMaybe(PDFName.of('S'), PDFName);
  if (!s) return false;
  const sStr = s.asString();
  return sStr === '/JavaScript' || sStr === 'JavaScript';
}

function scanArrayForJs(arr: PDFArray, ctx: AccessibilityCheckContext): boolean {
  for (let i = 0; i < arr.size(); i += 1) {
    const entry = arr.get(i);
    if (isJavaScriptAction(entry, ctx)) return true;
  }
  return false;
}

function check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  let found = false;

  // 1. /Catalog /OpenAction.
  try {
    const oa = ctx.catalog.get(PDFName.of('OpenAction'));
    if (oa !== undefined) {
      if (oa instanceof PDFArray) {
        if (scanArrayForJs(oa, ctx)) found = true;
      } else if (isJavaScriptAction(oa, ctx)) {
        found = true;
      }
    }
  } catch {
    // defensive — malformed OpenAction means we just skip it.
  }

  // 2. /Catalog /Names /JavaScript — presence of the name tree alone is
  //    the signal; we don't enumerate the names.
  if (!found) {
    try {
      const names = ctx.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
      if (names) {
        const js = names.get(PDFName.of('JavaScript'));
        if (js !== undefined) found = true;
      }
    } catch {
      // defensive
    }
  }

  // 3. /AcroForm /Fields[*] /AA + /A.
  if (!found) {
    try {
      const acroForm = ctx.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
      if (acroForm) {
        const fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray);
        if (fields) {
          for (let i = 0; i < fields.size() && !found; i += 1) {
            const fEntry = fields.get(i);
            let f: PDFObject | undefined;
            if (fEntry instanceof PDFRef) {
              f = ctx.doc.context.lookup(fEntry) ?? undefined;
            } else {
              f = fEntry;
            }
            if (!(f instanceof PDFDict)) continue;
            const a = f.get(PDFName.of('A'));
            if (a !== undefined && isJavaScriptAction(a, ctx)) {
              found = true;
              break;
            }
            const aa = f.lookupMaybe(PDFName.of('AA'), PDFDict);
            if (aa) {
              // /AA contains action dicts keyed by trigger event name.
              const entries = aa.entries();
              for (const [, v] of entries) {
                if (isJavaScriptAction(v, ctx)) {
                  found = true;
                  break;
                }
              }
            }
          }
        }
      }
    } catch {
      // defensive
    }
  }

  if (!found) {
    return {
      status: 'pass',
      message: 'a11y.javascriptNoFormActions.pass',
      locations: [],
    };
  }
  return {
    status: 'warn',
    message: 'a11y.javascriptNoFormActions.warn',
    locations: [],
  };
}

export const ruleJavascriptNoFormActions: AccessibilityRule = {
  id: 'a11y.behavior.javascript-no-form-actions',
  severity: 'warning',
  labelKey: 'a11y.javascriptNoFormActions.label',
  check,
};
