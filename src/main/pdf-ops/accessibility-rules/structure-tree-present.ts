// a11y.structure-tree-present — PDF/UA-1 §7.1.
// Severity: error. Checks that `/Catalog /StructTreeRoot` exists.
//
// Foundational rule — every other tag / reading-order / alt-text rule is
// vacuous without a structure tree. Engine emits this first so the UI can
// route the user to Tag PDF if the tree is absent.

import { PDFDict, PDFName } from 'pdf-lib';

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

function check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  const structRoot = ctx.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict);
  const present = structRoot !== undefined;
  return {
    status: present ? 'pass' : 'fail',
    message: present ? 'a11y.structureTreePresent.pass' : 'a11y.structureTreePresent.fail',
    locations: [],
    ...(present ? {} : { quickFix: { kind: 'open-tag-editor' as const } }),
  };
}

export const ruleStructureTreePresent: AccessibilityRule = {
  id: 'a11y.structure-tree-present',
  severity: 'error',
  labelKey: 'a11y.structureTreePresent.label',
  check,
};
