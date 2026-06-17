// Preflight rule row — one entry in the Errors / Warnings / Info list.
// Phase 7.5 C2 (Riley Wave 5a). Per docs/ui-spec-phase-7.5.md §23.1.
//
// Clicking a row with a non-empty `locations[]` navigates the viewer to
// the first location's pageIndex. Rows without locations render
// disabled-cursor (they're document-level rules — no page to jump to).

import { useT } from '../../i18n/use-t';
import { useAppDispatch } from '../../state/hooks';
import { type PreflightRuleResult } from '../../types/preflight-contract-stub';

import styles from './preflight-panel.module.css';

interface RuleRowProps {
  rule: PreflightRuleResult;
  onJumpToPage: (pageIndex: number) => void;
}

const SEVERITY_CLASSNAME = {
  error: styles.severityError,
  warning: styles.severityWarning,
  info: styles.severityInfo,
} as const;

const PROFILE_LABEL: Record<PreflightRuleResult['profile'], string> = {
  'pdf-x-1a': 'X-1a',
  'pdf-x-4': 'X-4',
  'pdf-a-1b': 'A-1b',
  'pdf-a-2b': 'A-2b',
};

const SEVERITY_GLYPH = {
  error: '✗',
  warning: '⚠',
  info: 'ⓘ',
} as const;

export function RuleRow(props: RuleRowProps): JSX.Element {
  const { rule, onJumpToPage } = props;
  const { t } = useT();
  // We dispatch indirectly via the parent's `onJumpToPage` so the panel
  // can route to the right page-change action without the row knowing
  // about the viewport slice. Keeps the component pure & testable.
  // Reserved for future per-row context-menu actions; intentionally
  // unused here.
  void useAppDispatch;

  const hasLocations = rule.locations.length > 0;
  const onClick = (): void => {
    if (!hasLocations) return;
    const first = rule.locations[0];
    if (first) onJumpToPage(first.pageIndex);
  };

  // The engine returns the message as an i18n key (per preflight-spec.md
  // §2 + api-contracts.md §19.6). Try to resolve via `t()`; if the key
  // doesn't exist in the bundle, fall back to the raw engine string so
  // we never surface a blank message.
  const i18nKey = `modals:preflight.rule.${rule.ruleId}`;
  let resolved = t(i18nKey);
  if (resolved === `preflight.rule.${rule.ruleId}` || resolved === '') {
    // resolveKey returns the path-after-colon when the key is missing
    // from both the active locale AND en-US. Treat that as "not found"
    // and surface the engine's raw message (intended honest fallback per
    // ui-spec §23 — the engine's English description is better than a
    // blank row).
    resolved = rule.message;
  }

  return (
    <li>
      <button
        type="button"
        className={`${styles.row} ${hasLocations ? '' : styles.rowDisabled}`}
        onClick={onClick}
        disabled={!hasLocations}
        aria-label={t('modals:preflight.ruleRowAria', {
          severity: rule.severity,
          profile: PROFILE_LABEL[rule.profile],
          message: resolved,
        })}
      >
        <div className={styles.rowHead}>
          <span className={SEVERITY_CLASSNAME[rule.severity]} aria-hidden="true">
            {SEVERITY_GLYPH[rule.severity]}
          </span>
          <span className={styles.profileBadge}>{PROFILE_LABEL[rule.profile]}</span>
        </div>
        <div className={styles.rowMessage}>{resolved}</div>
        {hasLocations && (
          <div className={styles.rowLocations}>
            {t('modals:preflight.locationCount', {
              count: rule.locations.length,
              firstPage: (rule.locations[0]?.pageIndex ?? 0) + 1,
            })}
          </div>
        )}
      </button>
    </li>
  );
}
