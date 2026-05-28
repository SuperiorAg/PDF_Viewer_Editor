// FlattenOnExportCheckbox — Phase 3 "Flatten forms" advanced option.
// Per docs/ui-spec.md §12.7. Rendered inside the Export Engine dialog's
// Advanced section.
//
// Disabled cases (greyed-out with tooltip):
//   - When the chosen engine is 'chromium' — Chromium output is always flattened.
//   - When the document has no AcroForm — nothing to flatten.

import { useAppSelector } from '../../state/hooks';
import { selectFormDetectionStatus, selectFormFields } from '../../state/slices/forms-selectors';

import styles from './flatten-on-export-checkbox.module.css';

interface FlattenOnExportCheckboxProps {
  /** The engine the user currently has selected in the dialog. */
  engine: 'auto' | 'pdflib' | 'chromium';
  /** Current value of the flatten checkbox. */
  value: boolean;
  /** Called when the user toggles the checkbox. */
  onChange: (next: boolean) => void;
}

export function FlattenOnExportCheckbox(props: FlattenOnExportCheckboxProps): JSX.Element {
  const detectionStatus = useAppSelector(selectFormDetectionStatus);
  const fields = useAppSelector(selectFormFields);

  const noForm: boolean = detectionStatus !== 'present' && fields.length === 0;
  const chromium: boolean = props.engine === 'chromium';
  const disabled: boolean = noForm || chromium;

  const tooltip = chromium
    ? 'Chromium printing always produces flattened output.'
    : noForm
      ? 'This document has no form fields.'
      : 'Flatten all form fields to static page content.';

  return (
    <label className={disabled ? styles.labelDisabled : styles.label}>
      <input
        type="checkbox"
        checked={props.value && !disabled}
        disabled={disabled}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
        title={tooltip}
      />
      <span title={tooltip}>Flatten forms in output (Phase 3)</span>
    </label>
  );
}
