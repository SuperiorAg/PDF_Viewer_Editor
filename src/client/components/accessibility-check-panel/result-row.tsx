// Accessibility Checker — single result row.
// Phase 7.5 C6 (Riley Wave 5d).
//
// Renders one AccessibilityRuleResult: severity icon + i18n label +
// localized message + per-location page chips + optional quick-fix
// button. Quick-fix dispatch is routed via a callback the parent passes
// in so this component stays pure-presentation.
//
// i18n key resolution:
//   - Label: `modals:accessibility.rules.<ruleId>.label`
//   - Message: `modals:accessibility.rules.<ruleId>.messages.<message>`
//     (where `<message>` is David's raw i18n key from the engine, e.g.
//     `a11y.documentTitlePresent.fail`). If the rules block doesn't have
//     a translation for the exact message key, fallback resolves to the
//     raw key string — still better than blank — and Julian's lint can
//     pick that up.

import { useT } from '../../i18n/use-t';
import type {
  AccessibilityRuleResult,
  AccessibilityRuleSeverity,
} from '../../types/accessibility-check-contract-stub';

import styles from './accessibility-check-panel.module.css';
import { ruleLabelKey, ruleMessageKey } from './rule-i18n-resolver';

interface Props {
  result: AccessibilityRuleResult;
  onJumpToPage: (pageIndex: number) => void;
  onQuickFix: (
    kind: NonNullable<AccessibilityRuleResult['quickFix']>['kind'],
    targetNodeId: string | undefined,
  ) => void;
}

function severityIcon(severity: AccessibilityRuleSeverity, status: string): string {
  if (status === 'unevaluated') return '·';
  if (severity === 'error') return '✗';
  if (severity === 'warning') return '⚠';
  return 'ⓘ';
}

function severityClassName(status: string): string {
  switch (status) {
    case 'fail':
      return styles.severityFail ?? '';
    case 'warn':
      return styles.severityWarn ?? '';
    case 'unevaluated':
      return styles.severityUnevaluated ?? '';
    default:
      return styles.severityPass ?? '';
  }
}

function quickFixLabelKey(kind: NonNullable<AccessibilityRuleResult['quickFix']>['kind']): string {
  switch (kind) {
    case 'open-tag-editor':
      return 'modals:accessibility.checker.quickFix.openTagEditor';
    case 'open-reading-order':
      return 'modals:accessibility.checker.quickFix.openReadingOrder';
    case 'open-alt-text-inspector':
      return 'modals:accessibility.checker.quickFix.openAltTextInspector';
    case 'open-document-properties':
      return 'modals:accessibility.checker.quickFix.openDocumentProperties';
  }
}

export function ResultRow({ result, onJumpToPage, onQuickFix }: Props): JSX.Element {
  const { t } = useT();
  // Resolve the per-rule label + message via the camelCase mapping so
  // the renderer's dot-path i18n resolver can walk the JSON tree cleanly.
  // If David adds a new rule and the mapping isn't updated, the fallback
  // renders the raw key path — visible enough to grep in QA.
  const label = t(ruleLabelKey(result.ruleId));
  const message = t(ruleMessageKey(result.ruleId, result.message));
  const quickFix = result.quickFix;

  return (
    <li className={styles.row} data-testid={`a11y-row-${result.ruleId}`}>
      <div className={styles.rowHead}>
        <span
          className={severityClassName(result.status)}
          aria-hidden="true"
          data-testid="a11y-severity-icon"
        >
          {severityIcon(result.severity, result.status)}
        </span>
        <span className={styles.ruleLabel}>{label}</span>
      </div>
      <p className={styles.message}>{message}</p>
      {result.locations.length > 0 && (
        <div className={styles.locations}>
          {result.locations.map((loc, idx) => (
            <button
              key={`${loc.pageIndex}-${idx}`}
              type="button"
              className={styles.locationChip}
              onClick={() => onJumpToPage(loc.pageIndex)}
              aria-label={t('modals:accessibility.checker.locationPageAria', {
                page: loc.pageIndex + 1,
              })}
            >
              {t('modals:accessibility.checker.locationPage', { page: loc.pageIndex + 1 })}
            </button>
          ))}
        </div>
      )}
      {quickFix !== undefined && (
        <button
          type="button"
          className={styles.quickFix}
          onClick={() => onQuickFix(quickFix.kind, quickFix.targetNodeId)}
          data-testid={`a11y-quickfix-${quickFix.kind}`}
        >
          {t(quickFixLabelKey(quickFix.kind))}
        </button>
      )}
    </li>
  );
}
