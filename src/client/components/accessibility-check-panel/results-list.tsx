// Accessibility Checker — results list grouped by status.
// Phase 7.5 C6 (Riley Wave 5d).
//
// Renders four collapsible sections in priority order:
// fail → warn → unevaluated → pass. Each section is collapsible via
// the slice's `toggleGroup` action so collapse state survives unmounts.
// Default expand state: fail / warn / unevaluated open, pass collapsed —
// the user's eye lands on what needs attention first.

import { useT } from '../../i18n/use-t';
import type { AccessibilityCheckGroup } from '../../state/slices/accessibility-check-slice';
import type { AccessibilityRuleResult } from '../../types/accessibility-check-contract-stub';

import styles from './accessibility-check-panel.module.css';
import { ResultRow } from './result-row';

interface Props {
  results: AccessibilityRuleResult[];
  expandedGroups: Record<AccessibilityCheckGroup, boolean>;
  onToggleGroup: (group: AccessibilityCheckGroup) => void;
  onJumpToPage: (pageIndex: number) => void;
  onQuickFix: (
    kind: NonNullable<AccessibilityRuleResult['quickFix']>['kind'],
    targetNodeId: string | undefined,
  ) => void;
}

const SECTION_ORDER: readonly AccessibilityCheckGroup[] = ['fail', 'warn', 'unevaluated', 'pass'];

function groupTitleKey(group: AccessibilityCheckGroup): string {
  switch (group) {
    case 'fail':
      return 'modals:accessibility.checker.groupFail';
    case 'warn':
      return 'modals:accessibility.checker.groupWarn';
    case 'unevaluated':
      return 'modals:accessibility.checker.groupUnevaluated';
    case 'pass':
      return 'modals:accessibility.checker.groupPass';
  }
}

export function ResultsList(props: Props): JSX.Element {
  const { t } = useT();
  const grouped: Record<AccessibilityCheckGroup, AccessibilityRuleResult[]> = {
    fail: [],
    warn: [],
    unevaluated: [],
    pass: [],
  };
  for (const r of props.results) {
    grouped[r.status].push(r);
  }
  return (
    <div className={styles.results} data-testid="a11y-results-list">
      {SECTION_ORDER.map((group) => {
        const items = grouped[group];
        const expanded = props.expandedGroups[group];
        return (
          <div className={styles.section} key={group} data-testid={`a11y-section-${group}`}>
            <button
              type="button"
              className={styles.sectionHeader}
              aria-expanded={expanded}
              onClick={() => props.onToggleGroup(group)}
            >
              <span aria-hidden="true">{expanded ? '▼' : '▶'}</span>
              <span>{t(groupTitleKey(group), { count: items.length })}</span>
            </button>
            {expanded && items.length > 0 && (
              <ul className={styles.sectionList}>
                {items.map((r) => (
                  <ResultRow
                    key={`${r.ruleId}-${r.locations[0]?.pageIndex ?? '_'}`}
                    result={r}
                    onJumpToPage={props.onJumpToPage}
                    onQuickFix={props.onQuickFix}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
