// Phase 7.5 Wave 5d — Accessibility rule registry.
//
// Each rule lives in its own file (one rule per file, <=200 lines per the
// modularization rule). This module re-exports the full shipped set as a
// single array; `accessibility-engine.ts` iterates it.
//
// SHIPPED RULE COUNT (honest disclosure per accessibility-authoring-spec.md
// §6.3 + the four-location ratchet §6.5): 12 rules at v0.8.0 cut. Spec §6.3
// enumerates each — any drift between the spec table and ALL_A11Y_RULES is
// a finding (Julian's Wave 11 review explicitly checks this).
//
// File-naming convention: `<rule-id>.ts` where the rule-id matches the
// `a11y.<category>.<verb>` tokens in spec §6.3. Hyphens in filenames stay
// (e.g. `document-title-present.ts` for `a11y.document.title-present`).
//
// Engine-context shape: a per-doc structural snapshot the engine computes
// ONCE (catalog + struct tree + page text-layer counts) and hands to every
// rule. Rules never load the PDFDocument themselves — they read only from
// the prepared context. Keeps rules pure + cheap; the 1064-page perf gate
// holds because pdf-lib parses once, not 12 times.

import type { PDFDict, PDFDocument } from 'pdf-lib';

import { ruleAltNotPlaceholder } from './alt-not-placeholder.js';
import { ruleColorContrastSpotSample } from './color-contrast-spot-sample.js';
import { ruleContentNonTextTagged } from './content-non-text-tagged.js';
import { ruleDocumentLanguageSet } from './document-language-set.js';
import { ruleDocumentTitlePresent } from './document-title-present.js';
import { ruleFiguresAllHaveAltText } from './figures-all-have-alt-text.js';
import { ruleJavascriptNoFormActions } from './javascript-no-form-actions.js';
import { ruleReadingOrderDefined } from './reading-order-defined.js';
import { ruleScannedPagesSearchable } from './scanned-pages-searchable.js';
import { ruleStructureTreePresent } from './structure-tree-present.js';
import { ruleTablesHeadersIdentified } from './tables-headers-identified.js';
import { ruleTablesScopeSet } from './tables-scope-set.js';

export type AccessibilityRuleSeverity = 'error' | 'warning' | 'info';
export type AccessibilityRuleStatus = 'pass' | 'warn' | 'fail' | 'unevaluated';

/** Per-figure / per-table struct-element record gathered in the engine's
 *  snapshot. Rules consume the snapshot; they never re-walk the tree. */
export interface StructElementRef {
  /** `struct:<objectNumber>` — same scheme as reading-order-engine. */
  structNodeId: string;
  /** Structure element type ("Figure", "Table", "TH", ...). */
  type: string;
  /** Owning page (0-based) when derivable from /Pg; -1 when not. */
  pageIndex: number;
  /** Direct child structure-element types — used for table-header check. */
  childTypes: string[];
  /** Has a non-empty `/Alt` entry. */
  hasNonEmptyAlt: boolean;
  /** Has an `/Alt` entry at all — including the empty-string "decorative"
   *  signal. Distinguishes "author marked decorative" from "no alt at all". */
  hasAltKey: boolean;
  /** Raw `/Alt` string, if present and decodable; `null` otherwise. Used by
   *  the placeholder-alt rule to flag generic strings. */
  altValue: string | null;
  /** Has a `/Scope` attribute in `/A` (table-header rule). */
  hasScopeAttribute: boolean;
}

/** Per-page diagnostic the engine collects via the optional text-extractor
 *  seam. Rules that care about scanned-image-only pages consume this. */
export interface PageTextDiagnostic {
  pageIndex: number;
  /** Count of text glyphs / runs the extractor reported. Engine zeroes
   *  this for every page when no extractor is wired (the rule then emits
   *  `'unevaluated'` honestly). */
  textItemCount: number;
  /** True iff this page's resource dict references at least one image
   *  XObject (used by the non-text-tagged rule). */
  hasImageXObject: boolean;
}

/** Engine snapshot — built once by accessibility-engine, consumed by every
 *  rule. Pure data; no methods. */
export interface AccessibilityCheckContext {
  doc: PDFDocument;
  /** All structure elements in the tree, flattened. Order is doc-order
   *  (pre-traversal of /K). Empty when no /StructTreeRoot exists. */
  structElements: StructElementRef[];
  /** Catalog dict — handy for cheap lookups in document-level rules. */
  catalog: PDFDict;
  /** Page diagnostics or `null` when no extractor was wired (rules that
   *  need text-layer counts must emit `'unevaluated'` in that case). */
  pageDiagnostics: PageTextDiagnostic[] | null;
  /** Total page count (doc.getPageCount()). */
  pageCount: number;
}

export interface AccessibilityRule {
  /** Stable identifier — see spec §6.3. */
  id: string;
  severity: AccessibilityRuleSeverity;
  /** i18n key for the rule's user-facing label. */
  labelKey: string;
  /** Pure check. Throwing is caught by the engine; rules that fail
   *  internally should return a `'fail'` or `'unevaluated'` result with
   *  an informative message rather than throwing. */
  check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome;
}

/** What a rule returns. Engine wraps this with severity + boolean
 *  passed-mirror to produce the IPC-level `AccessibilityRuleResult`. */
export interface AccessibilityRuleOutcome {
  status: AccessibilityRuleStatus;
  /** i18n key — see spec §6.4. */
  message: string;
  /** Where the failure / warning is. Empty for doc-level rules. */
  locations: { pageIndex: number; structNodeId?: string }[];
  /** Quick-fix routing — drives the panel's "Open X" buttons. */
  quickFix?: {
    kind:
      | 'open-tag-editor'
      | 'open-reading-order'
      | 'open-alt-text-inspector'
      | 'open-document-properties';
    targetNodeId?: string;
  };
}

export const ALL_A11Y_RULES: ReadonlyArray<AccessibilityRule> = [
  ruleDocumentTitlePresent,
  ruleDocumentLanguageSet,
  ruleStructureTreePresent,
  ruleFiguresAllHaveAltText,
  ruleAltNotPlaceholder,
  ruleTablesHeadersIdentified,
  ruleTablesScopeSet,
  ruleReadingOrderDefined,
  ruleContentNonTextTagged,
  ruleScannedPagesSearchable,
  ruleJavascriptNoFormActions,
  ruleColorContrastSpotSample,
];
