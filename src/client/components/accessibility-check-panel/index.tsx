// Accessibility Checker panel — Phase 7.5 C6 (Riley Wave 5d).
// Per docs/ui-spec-phase-7.5.md §27 + docs/accessibility-authoring-spec.md §6.
//
// Lives INSIDE the 8th sidebar tab (Accessibility), above the Wave 5b
// Tag PDF tree editor. The tab now hosts a two-pane layout:
//   1. Accessibility Checker (this component) — Run button + results
//   2. Tag PDF tree editor (Wave 5b) — unchanged
//
// HONESTY surfaces (P7.5-L-10 obligation #2):
//   - `subsetDisclosure` rendered VERBATIM from David's response — NEVER
//     paraphrased, NEVER hardcoded. Tests assert the rendered DOM carries
//     the fixture string.
//   - `shippedRuleCount` shown as an upfront pill (e.g. "12 rules").
//   - Engine-failure ('engine_failed', 'handle_not_found', etc.) renders
//     an explicit error banner with Retry — never a fake "succeeded with
//     0 results" claim.
//   - Four-state model fully exposed (pass/warn/fail/unevaluated). The
//     'unevaluated' bucket is NEVER folded into 'pass'.
//
// Per CLAUDE.md modularization rule, the panel is split across
// sub-components: disclosure-banner / summary-bar / results-list /
// result-row, each <150 lines.

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  selectA11yExpandedGroups,
  selectA11yLastErrorMessage,
  selectA11yResults,
  selectA11yStatus,
  toggleGroup,
} from '../../state/slices/accessibility-check-slice';
import { setAltTextOpen } from '../../state/slices/alt-text-slice';
import { openDocumentProperties } from '../../state/slices/document-properties-slice';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { setReadingOrderActive } from '../../state/slices/reading-order-slice';
import { selectNode } from '../../state/slices/struct-tree-slice';
import { setCurrentPage } from '../../state/slices/viewport-slice';
import { runAccessibilityCheckThunk } from '../../state/thunks-phase7-5-wave5d';
import type { AccessibilityRuleResult } from '../../types/accessibility-check-contract-stub';

import styles from './accessibility-check-panel.module.css';
import { DisclosureBanner } from './disclosure-banner';
import { ResultsList } from './results-list';
import { SummaryBar } from './summary-bar';

type QuickFixKind = NonNullable<AccessibilityRuleResult['quickFix']>['kind'];

export function AccessibilityCheckPanel(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const status = useAppSelector(selectA11yStatus);
  const lastResult = useAppSelector(selectA11yResults);
  const lastErrorMessage = useAppSelector(selectA11yLastErrorMessage);
  const expandedGroups = useAppSelector(selectA11yExpandedGroups);

  const canRun = doc !== null && status !== 'running';

  const onRun = (): void => {
    void dispatch(runAccessibilityCheckThunk());
  };

  const onJumpToPage = (pageIndex: number): void => {
    if (!doc) return;
    if (pageIndex < 0 || pageIndex >= doc.pageCount) return;
    dispatch(setCurrentPage(pageIndex));
  };

  const onQuickFix = (kind: QuickFixKind, targetNodeId: string | undefined): void => {
    switch (kind) {
      case 'open-tag-editor':
        // The Tag PDF tree editor lives in the same sidebar tab — no
        // tab switch needed. Pre-select the offending node so the
        // user lands directly on it.
        if (targetNodeId !== undefined) {
          dispatch(selectNode(targetNodeId));
        }
        break;
      case 'open-reading-order':
        // Arm the page-level overlay. The overlay auto-loads on activation;
        // the targetNodeId is not used by the overlay directly (badges are
        // keyed by structNodeId already).
        dispatch(setReadingOrderActive(true));
        break;
      case 'open-alt-text-inspector':
        // Open the Wave 5c modal.
        dispatch(setAltTextOpen(true));
        break;
      case 'open-document-properties':
        // Default to the 'description' tab (where /Title and /Lang live).
        dispatch(openDocumentProperties(undefined));
        break;
    }
  };

  // Format the timestamp via the user's locale — the i18n helper's date
  // formatter isn't exposed as a hook, so we use Intl directly for the
  // value substitution (mirrors PreflightPanel.lastRunTime).
  const lastRunTime = lastResult !== null ? new Date(lastResult.ranAt).toLocaleString() : null;

  return (
    <section
      className={styles.panel}
      aria-label={t('modals:accessibility.checker.panelAria')}
      data-testid="a11y-checker-panel"
    >
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{t('modals:accessibility.checker.title')}</h2>
          {lastResult !== null && (
            <span
              className={styles.shippedBadge}
              aria-label={t('modals:accessibility.checker.shippedRulesAria', {
                count: lastResult.shippedRuleCount,
              })}
              data-testid="a11y-shipped-badge"
            >
              {t('modals:accessibility.checker.shippedRules', {
                count: lastResult.shippedRuleCount,
              })}
            </span>
          )}
        </div>
        {/* HONESTY DISCLOSURE — verbatim from David's response, NEVER
            paraphrased. Permanent, italicized. Per P7.5-L-10. */}
        {lastResult !== null && <DisclosureBanner disclosure={lastResult.subsetDisclosure} />}
        {lastResult !== null && lastRunTime !== null && (
          <p className={styles.lastRun}>
            {t('modals:accessibility.checker.lastRun', { when: lastRunTime })}
          </p>
        )}
      </header>

      <div className={styles.runRow}>
        <button
          type="button"
          className={styles.runButton}
          onClick={onRun}
          disabled={!canRun}
          aria-label={t('modals:accessibility.checker.runAria')}
          title={doc === null ? t('modals:accessibility.checker.noDocumentTooltip') : undefined}
          data-testid="a11y-run-button"
        >
          {status === 'running'
            ? t('modals:accessibility.checker.running')
            : lastResult !== null
              ? t('modals:accessibility.checker.rerun')
              : t('modals:accessibility.checker.run')}
        </button>
      </div>

      {status === 'error' && (
        <div className={styles.error} role="alert" data-testid="a11y-error">
          <span className={styles.errorTitle}>
            {t('modals:accessibility.checker.engineFailedTitle')}
          </span>
          <span>
            {lastErrorMessage?.includes('bridge_unavailable') ||
            lastErrorMessage?.includes('not exposed')
              ? t('modals:accessibility.checker.bridgeUnavailableBody')
              : t('modals:accessibility.checker.engineFailedBody')}
          </span>
          <button type="button" className={styles.retryButton} onClick={onRun} disabled={!canRun}>
            {t('modals:accessibility.checker.retry')}
          </button>
        </div>
      )}

      {status === 'idle' && lastResult === null && (
        <div className={styles.emptyState}>
          {doc === null
            ? t('modals:accessibility.checker.noDocument')
            : t('modals:accessibility.checker.clickRunHint')}
        </div>
      )}

      {lastResult !== null && (
        <>
          <SummaryBar summary={lastResult.summary} />
          <ResultsList
            results={lastResult.results}
            expandedGroups={expandedGroups}
            onToggleGroup={(g) => dispatch(toggleGroup(g))}
            onJumpToPage={onJumpToPage}
            onQuickFix={onQuickFix}
          />
        </>
      )}
    </section>
  );
}
