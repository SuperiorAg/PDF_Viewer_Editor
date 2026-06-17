// Preflight profile picker — Phase 7.5 C2 (Riley Wave 5a).
// Per docs/ui-spec-phase-7.5.md §23. Four toggle checkboxes (PDF/X-1a,
// PDF/X-4, PDF/A-1b, PDF/A-2b). At least one must remain selected — the
// slice's `toggleProfile` reducer enforces this.

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { toggleProfile } from '../../state/slices/preflight-slice';
import { ALL_PROFILES, type PreflightProfile } from '../../types/preflight-contract-stub';

import styles from './preflight-panel.module.css';

const PROFILE_I18N_KEY: Record<PreflightProfile, string> = {
  'pdf-x-1a': 'modals:preflight.profile.pdfX1a',
  'pdf-x-4': 'modals:preflight.profile.pdfX4',
  'pdf-a-1b': 'modals:preflight.profile.pdfA1b',
  'pdf-a-2b': 'modals:preflight.profile.pdfA2b',
};

export function ProfilePicker(props: { disabled?: boolean }): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const selected = useAppSelector((s) => s.preflight.selectedProfiles);

  return (
    <div className={styles.profiles} role="group" aria-label={t('modals:preflight.profilesAria')}>
      {ALL_PROFILES.map((p) => (
        <label key={p} className={styles.profileRow}>
          <input
            type="checkbox"
            checked={selected.includes(p)}
            onChange={() => dispatch(toggleProfile(p))}
            disabled={props.disabled === true}
          />
          {t(PROFILE_I18N_KEY[p])}
        </label>
      ))}
    </div>
  );
}
