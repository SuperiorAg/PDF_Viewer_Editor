// Export Report dialog — Filename text input + inline validation.
// Phase 7.5 C6 §27.3 (Riley Wave 5e).

import { useT } from '../../../i18n/use-t';

import styles from './export-report-dialog.module.css';

export interface FilenameInputProps {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}

export function FilenameInput({ value, onChange, invalid }: FilenameInputProps): JSX.Element {
  const { t } = useT();
  return (
    <div className={styles.field}>
      <label htmlFor="export-filename" className={styles.fieldLegend}>
        {t('modals:accessibility.checker.export.dialog.filename.label')}
      </label>
      <input
        id="export-filename"
        type="text"
        className={[styles.filenameInput, invalid ? styles.filenameInputInvalid : '']
          .filter((c): c is string => typeof c === 'string' && c.length > 0)
          .join(' ')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        aria-describedby={invalid ? 'export-filename-error' : undefined}
        data-testid="export-filename-input"
      />
      {invalid && (
        <p
          id="export-filename-error"
          className={styles.filenameError}
          role="alert"
          data-testid="export-filename-error"
        >
          {t('modals:accessibility.checker.export.dialog.filename.invalid')}
        </p>
      )}
    </div>
  );
}
