// Export Report dialog — Format radio (HTML | JSON).
// Phase 7.5 C6 §27.3 (Riley Wave 5e).

import { useT } from '../../../i18n/use-t';

import styles from './export-report-dialog.module.css';

export type ExportFormat = 'html' | 'json';

export interface FormatRadioProps {
  value: ExportFormat;
  onChange: (value: ExportFormat) => void;
}

export function FormatRadio({ value, onChange }: FormatRadioProps): JSX.Element {
  const { t } = useT();
  return (
    <fieldset className={styles.field}>
      <legend className={styles.fieldLegend}>
        {t('modals:accessibility.checker.export.dialog.format.label')}
      </legend>
      <div className={styles.radioRow}>
        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="export-format"
            value="html"
            checked={value === 'html'}
            onChange={() => onChange('html')}
            data-testid="export-format-html"
          />
          <span>{t('modals:accessibility.checker.export.dialog.format.options.html')}</span>
        </label>
        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="export-format"
            value="json"
            checked={value === 'json'}
            onChange={() => onChange('json')}
            data-testid="export-format-json"
          />
          <span>{t('modals:accessibility.checker.export.dialog.format.options.json')}</span>
        </label>
      </div>
    </fieldset>
  );
}
