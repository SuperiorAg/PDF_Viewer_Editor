// Export Report dialog — Include-passed / Include-unevaluated checkboxes.
// Phase 7.5 C6 §27.3 (Riley Wave 5e).

import { useT } from '../../../i18n/use-t';

import styles from './export-report-dialog.module.css';

export interface OptionsCheckboxesProps {
  includePassed: boolean;
  includeUnevaluated: boolean;
  onIncludePassedChange: (v: boolean) => void;
  onIncludeUnevaluatedChange: (v: boolean) => void;
}

export function OptionsCheckboxes({
  includePassed,
  includeUnevaluated,
  onIncludePassedChange,
  onIncludeUnevaluatedChange,
}: OptionsCheckboxesProps): JSX.Element {
  const { t } = useT();
  return (
    <fieldset className={styles.field}>
      <legend className={styles.fieldLegend}>
        {t('modals:accessibility.checker.export.dialog.options.legend')}
      </legend>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={includePassed}
          onChange={(e) => onIncludePassedChange(e.target.checked)}
          data-testid="export-include-passed"
        />
        <span>{t('modals:accessibility.checker.export.dialog.options.includePassed')}</span>
      </label>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={includeUnevaluated}
          onChange={(e) => onIncludeUnevaluatedChange(e.target.checked)}
          data-testid="export-include-unevaluated"
        />
        <span>{t('modals:accessibility.checker.export.dialog.options.includeUnevaluated')}</span>
      </label>
    </fieldset>
  );
}
