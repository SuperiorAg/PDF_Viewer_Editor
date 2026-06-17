// Preflight sidebar panel — Phase 7.5 C2 (Riley Wave 5a).
// Per docs/ui-spec-phase-7.5.md §23 + docs/preflight-spec.md §1.
//
// HONESTY CLAUSE (preflight-spec §7): the panel header always shows the
// permanent, non-dismissible "Subset of PDF/X-1a, PDF/X-4, PDF/A-1b,
// PDF/A-2b — see Help for the shipped rule set." disclosure. We do NOT
// auto-run on panel open — the Run button is the sole trigger so the
// 1064-page perf gate is honored.

import { useMemo, useState } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { setCurrentPage } from '../../state/slices/viewport-slice';
import { runPreflightThunk } from '../../state/thunks-phase7-5-wave5a';
import { bucketResults, type PreflightRuleResult } from '../../types/preflight-contract-stub';

import styles from './preflight-panel.module.css';
import { ProfilePicker } from './profile-picker';
import { RuleRow } from './rule-row';

type SectionKey = 'errors' | 'warnings' | 'infos';

export function PreflightPanel(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const state = useAppSelector((s) => s.preflight);

  // Section expand/collapse is pure UI state — lives in component, not
  // the slice (mirrors the redaction Apply modal section pattern).
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    errors: false,
    warnings: true,
    infos: true,
  });

  const buckets = useMemo(
    () => (state.lastResults ? bucketResults(state.lastResults.results) : null),
    [state.lastResults],
  );

  const canRun = doc !== null && state.selectedProfiles.length > 0 && !state.running;

  const onRun = (): void => {
    void dispatch(runPreflightThunk());
  };

  const onJumpToPage = (pageIndex: number): void => {
    if (!doc) return;
    if (pageIndex < 0 || pageIndex >= doc.pageCount) return;
    dispatch(setCurrentPage(pageIndex));
  };

  const onExportJson = (): void => {
    if (!state.lastResults) return;
    const json = JSON.stringify(
      {
        ranAt: state.lastResults.ranAt,
        shippedRuleCount: state.lastResults.shippedRuleCount,
        profilesRun: state.selectedProfiles,
        results: state.lastResults.results,
      },
      null,
      2,
    );
    // Trigger a browser download via a blob URL. The renderer is sandboxed
    // but Blob + a.download work in Electron's renderer; an OS save dialog
    // could be wired through David's preload bridge in a follow-up if the
    // browser path proves limiting.
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `preflight-report-${state.lastResults.ranAt}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const toggleSection = (key: SectionKey): void => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const lastRunTime = state.lastResults ? new Date(state.lastResults.ranAt).toLocaleString() : null;

  return (
    <section className={styles.panel} aria-label={t('modals:preflight.title')}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('modals:preflight.title')}</h2>
        {/* HONESTY DISCLOSURE — permanent, non-dismissible. preflight-spec §7. */}
        <p className={styles.subsetDisclosure}>{t('modals:preflight.subsetDisclosure')}</p>
      </header>

      <ProfilePicker disabled={state.running} />

      <div className={styles.runRow}>
        <button
          type="button"
          className={styles.runButton}
          onClick={onRun}
          disabled={!canRun}
          aria-label={t('modals:preflight.runAria')}
        >
          {state.running ? t('modals:preflight.running') : t('modals:preflight.run')}
        </button>
        <button
          type="button"
          className={styles.exportButton}
          onClick={onExportJson}
          disabled={state.lastResults === null}
          aria-label={t('modals:preflight.exportReportAria')}
          title={t('modals:preflight.exportReport')}
        >
          ⤓ {t('modals:preflight.exportReport')}
        </button>
      </div>

      {state.lastErrorMessage !== null && (
        <div className={styles.error} role="alert">
          {state.lastErrorMessage}
        </div>
      )}

      {state.lastResults === null && state.lastErrorMessage === null && (
        <div className={styles.emptyState}>
          {doc === null ? t('modals:preflight.noDocument') : t('modals:preflight.clickRunHint')}
        </div>
      )}

      {state.lastResults !== null && (
        <>
          <div className={styles.lastRun}>
            {t('modals:preflight.lastRun', {
              when: lastRunTime ?? '',
              shipped: state.lastResults.shippedRuleCount,
            })}
          </div>
          {buckets !== null && (
            <div className={styles.results}>
              <Section
                kind="errors"
                titleKey="modals:preflight.errors"
                items={buckets.errors}
                collapsed={collapsed.errors}
                onToggle={() => toggleSection('errors')}
                onJumpToPage={onJumpToPage}
              />
              <Section
                kind="warnings"
                titleKey="modals:preflight.warnings"
                items={buckets.warnings}
                collapsed={collapsed.warnings}
                onToggle={() => toggleSection('warnings')}
                onJumpToPage={onJumpToPage}
              />
              <Section
                kind="infos"
                titleKey="modals:preflight.info"
                items={buckets.infos}
                collapsed={collapsed.infos}
                onToggle={() => toggleSection('infos')}
                onJumpToPage={onJumpToPage}
              />
              {buckets.errors.length === 0 &&
                buckets.warnings.length === 0 &&
                buckets.infos.length === 0 && (
                  <div className={styles.emptyState}>{t('modals:preflight.allPass')}</div>
                )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

interface SectionProps {
  kind: SectionKey;
  titleKey: string;
  items: PreflightRuleResult[];
  collapsed: boolean;
  onToggle: () => void;
  onJumpToPage: (pageIndex: number) => void;
}

function Section(props: SectionProps): JSX.Element {
  const { t } = useT();
  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.sectionHeader}
        aria-expanded={!props.collapsed}
        onClick={props.onToggle}
      >
        <span>{props.collapsed ? '▶' : '▼'}</span>
        <span>{t(props.titleKey)}</span>
        <span className={styles.sectionCount}>({props.items.length})</span>
      </button>
      {!props.collapsed && (
        <ul className={styles.sectionList}>
          {props.items.map((r) => (
            <RuleRow
              key={`${r.profile}:${r.ruleId}:${r.locations[0]?.pageIndex ?? '_'}`}
              rule={r}
              onJumpToPage={props.onJumpToPage}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
