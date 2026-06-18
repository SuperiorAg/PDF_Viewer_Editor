// Accessibility Checker — summary count pills.
// Phase 7.5 C6 (Riley Wave 5d).
//
// Four-state model surfaced honestly: pass / warn / fail / unevaluated
// each get their own pill. `unevaluated` is NEVER folded into `pass`
// (P7.5-L-10) — rules that pdf-lib alone cannot assess (color contrast
// without a raster, scan-searchability without a text extractor) honestly
// report "Not assessed".

import { useT } from '../../i18n/use-t';
import type { AccessibilityCheckSummary } from '../../types/accessibility-check-contract-stub';

import styles from './accessibility-check-panel.module.css';

interface Props {
  summary: AccessibilityCheckSummary;
}

export function SummaryBar({ summary }: Props): JSX.Element {
  const { t } = useT();
  const aria = t('modals:accessibility.checker.summaryAriaLabel', {
    fail: summary.fail,
    warn: summary.warn,
    pass: summary.pass,
    unevaluated: summary.unevaluated,
  });
  return (
    <div
      className={styles.summaryBar}
      role="status"
      aria-label={aria}
      data-testid="a11y-summary-bar"
    >
      <span className={`${styles.summaryPill} ${styles.summaryPillFail}`}>
        {summary.fail} {t('modals:accessibility.checker.summaryFail')}
      </span>
      <span className={`${styles.summaryPill} ${styles.summaryPillWarn}`}>
        {summary.warn} {t('modals:accessibility.checker.summaryWarn')}
      </span>
      <span className={`${styles.summaryPill} ${styles.summaryPillUnevaluated}`}>
        {summary.unevaluated} {t('modals:accessibility.checker.summaryUnevaluated')}
      </span>
      <span className={`${styles.summaryPill} ${styles.summaryPillPass}`}>
        {summary.pass} {t('modals:accessibility.checker.summaryPass')}
      </span>
    </div>
  );
}
