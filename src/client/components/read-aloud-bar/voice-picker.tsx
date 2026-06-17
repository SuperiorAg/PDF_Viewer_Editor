// Voice picker — Phase 7.5 C1 (Riley Wave 5a).
// Per docs/ui-spec-phase-7.5.md §22.1 — small `<select>` populated from
// David's `tts:listVoices` response. Native select so the OS picker is
// available on every platform (keyboard nav, type-to-find, screen reader
// support all come for free). Empty value = OS default for active locale.

import { useT } from '../../i18n/use-t';
import { type TtsVoice } from '../../types/tts-contract-stub';

import styles from './read-aloud-bar.module.css';

interface VoicePickerProps {
  voices: readonly TtsVoice[];
  selectedVoiceId: string | null;
  onSelect: (voiceId: string | null) => void;
  disabled?: boolean;
}

export function VoicePicker(props: VoicePickerProps): JSX.Element {
  const { t } = useT();
  return (
    <select
      className={styles.voiceSelect}
      value={props.selectedVoiceId ?? ''}
      aria-label={t('modals:readAloud.voiceAria')}
      onChange={(e) => {
        const v = e.target.value;
        props.onSelect(v === '' ? null : v);
      }}
      disabled={props.disabled === true}
    >
      <option value="">{t('modals:readAloud.voiceDefault')}</option>
      {props.voices.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name} ({v.locale})
        </option>
      ))}
    </select>
  );
}
