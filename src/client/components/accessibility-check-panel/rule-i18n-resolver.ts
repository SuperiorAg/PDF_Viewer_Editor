// Accessibility Checker — rule i18n key resolver.
// Phase 7.5 C6 (Riley Wave 5d).
//
// Why this module: David's rule registry uses two key shapes —
//   1. rule.id      = dotted token like 'a11y.document.title-present'
//   2. rule.message = i18n key like 'a11y.documentTitlePresent.fail'
//
// The renderer's i18n resolver uses dot-path traversal into the JSON
// tree, so dotted strings (with hyphens AND multiple dots per
// rule) can't be used as flat translation keys. The
// `modals:accessibility.ruleLabels.<camelCase>` + `modals:accessibility
// .ruleMessages.<camelCase>.<messageTail>` scheme keeps the JSON tree
// resolvable while preserving David's clean rule names.
//
// This module is a pure-function mapping from David's raw ids to the
// JSON tree paths. If a rule is added/renamed on either side, the
// `_unknownRule` fallback + the bare i18n key path appear in the UI as
// the visible signal — a noisy translation gap that QA can grep.

/** Maps David's `rule.id` (e.g. `a11y.document.title-present`) to the
 *  camelCase short-name used as a JSON sub-key
 *  (e.g. `documentTitlePresent`). Pinned to the 12-rule v0.8.0 set; any
 *  new rule David adds without a parallel mapping update renders the
 *  bare key path (UI gap is the signal). */
const RULE_ID_TO_CAMEL: Record<string, string> = {
  'a11y.document.title-present': 'documentTitlePresent',
  'a11y.document.language-set': 'documentLanguageSet',
  'a11y.structure-tree-present': 'structureTreePresent',
  'a11y.figures.all-have-alt-text': 'figuresAllHaveAltText',
  'a11y.figures.alt-not-placeholder': 'altNotPlaceholder',
  'a11y.tables.headers-identified': 'tablesHeadersIdentified',
  'a11y.tables.scope-set': 'tablesScopeSet',
  'a11y.reading.order-defined': 'readingOrderDefined',
  'a11y.content.non-text-tagged': 'contentNonTextTagged',
  'a11y.content.scanned-searchable': 'scannedPagesSearchable',
  'a11y.behavior.javascript-no-form-actions': 'javascriptNoFormActions',
  'a11y.appearance.color-contrast-spot-sample': 'colorContrastSpotSample',
};

/** Resolve the i18n key for a rule's user-facing label. */
export function ruleLabelKey(ruleId: string): string {
  const camel = RULE_ID_TO_CAMEL[ruleId] ?? '_unknownRule';
  return `modals:accessibility.ruleLabels.${camel}`;
}

/** Resolve the i18n key for a rule's outcome message. David's raw
 *  message strings look like `a11y.documentTitlePresent.fail` — the
 *  TAIL after the camelCase segment is the messageKey we look up
 *  inside `ruleMessages.<camelCase>.<tail>`. When David adds a new
 *  message variant the JSON gap surfaces visibly.
 *
 *  Mapping logic: split the raw message on '.', drop the leading
 *  'a11y' segment (if present), take the next segment as the camelCase
 *  rule name (to verify), and concatenate the remaining segments with
 *  '.' as the tail. The verification step is belt-and-braces: if the
 *  rule name in the message doesn't match the rule id's mapping, we
 *  still fall back to the literal tail so the resolver attempts the
 *  ruleMessages.<expectedCamel>.<tail> path. */
export function ruleMessageKey(ruleId: string, rawMessage: string): string {
  const camel = RULE_ID_TO_CAMEL[ruleId];
  if (camel === undefined) {
    return `modals:accessibility.ruleMessages._unknown`;
  }
  // David's raw message strings: `a11y.<camel>.<tail...>` or sometimes
  // longer tails with internal dots (e.g.
  // `a11y.colorContrast.unevaluated.pdf-lib-cannot-rasterize`). Strip the
  // first two segments and rejoin; for dashed tails camelCase via a
  // simple rule (each dash + char → upper-case char).
  const segments = rawMessage.split('.');
  if (segments.length < 3 || segments[0] !== 'a11y') {
    return `modals:accessibility.ruleMessages.${camel}._unknown`;
  }
  const tail = segments.slice(2).join('.');
  // Convert dot-and-dash tail to camelCase. e.g.
  // `unevaluated.pdf-lib-cannot-rasterize` -> `unevaluatedPdfLibCannotRasterize`.
  const camelTail = tail
    .split('.')
    .map((part, idx) => {
      const dashedToCamel = part.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      if (idx === 0) return dashedToCamel;
      return dashedToCamel.charAt(0).toUpperCase() + dashedToCamel.slice(1);
    })
    .join('');
  return `modals:accessibility.ruleMessages.${camel}.${camelTail}`;
}
