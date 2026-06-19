// Spell Check Settings dialog — Phase 7.5 B14 UI (Riley Wave 6).
// Spec: docs/ui-spec-phase-7.5.md §14.3.
//
// Lets the user pick the active locale, toggle the subsystem, and manage the
// user dictionary. The locale picker renders each unavailable locale with
// the verbatim `reason` string from David's contract (P7.5-L-10 honesty —
// es-ES is rendered DISABLED with the verbatim reason).

import { useEffect, useState } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  selectAvailableLocales,
  selectSpellCheckEnabled,
  selectSpellLocale,
  selectSpellSettingsOpen,
  selectUserDictionaryForLocale,
  setSpellCheckEnabled,
  setSpellCheckLocale,
  setSpellCheckSettingsOpen,
} from '../../state/slices/spell-check-slice';
import {
  addUserDictionaryWordThunk,
  listSpellLocalesThunk,
  listUserDictionaryThunk,
  removeUserDictionaryWordThunk,
} from '../../state/thunks-phase7-5-wave6';
import { ModalShell } from '../modals/modal-shell';

import styles from './styles.module.css';

export function SpellCheckSettingsDialog(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const { t } = useT();
  const open = useAppSelector(selectSpellSettingsOpen);
  const enabled = useAppSelector(selectSpellCheckEnabled);
  const locale = useAppSelector(selectSpellLocale);
  const availableLocales = useAppSelector(selectAvailableLocales);
  const userDictionary = useAppSelector((s) => selectUserDictionaryForLocale(s, locale));
  const [newWord, setNewWord] = useState('');

  useEffect(() => {
    if (open) {
      void dispatch(listSpellLocalesThunk());
      void dispatch(listUserDictionaryThunk(locale));
    }
  }, [open, dispatch, locale]);

  if (!open) return null;

  return (
    <ModalShell
      title={t('modals:spellCheck.settingsTitle')}
      onClose={() => dispatch(setSpellCheckSettingsOpen(false))}
      size="md"
      footer={
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => dispatch(setSpellCheckSettingsOpen(false))}
          >
            {t('modals:spellCheck.close')}
          </button>
        </div>
      }
    >
      <div className={styles.settingsBody}>
        <div className={styles.field}>
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => dispatch(setSpellCheckEnabled(e.target.checked))}
            />{' '}
            {t('modals:spellCheck.enableLabel')}
          </label>
        </div>

        <div className={styles.field}>
          <label>{t('modals:spellCheck.localeLabel')}</label>
          <div className={styles.localeRow}>
            {availableLocales.map((descriptor) => (
              <LocaleOption
                key={descriptor.id}
                id={descriptor.id}
                available={descriptor.available}
                reason={descriptor.reason}
                selected={descriptor.id === locale && descriptor.available}
                onSelect={() =>
                  descriptor.available && dispatch(setSpellCheckLocale(descriptor.id))
                }
              />
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label>{t('modals:spellCheck.userDictionaryHeading')}</label>
          <div className={styles.hint}>{t('modals:spellCheck.userDictionaryHint')}</div>
          {userDictionary.length === 0 ? (
            <div className={styles.dictionaryEmpty}>
              {t('modals:spellCheck.userDictionaryEmpty')}
            </div>
          ) : (
            <div className={styles.dictionaryList}>
              {userDictionary.map((word) => (
                <span key={word} className={styles.dictionaryChip}>
                  {word}
                  <button
                    type="button"
                    aria-label={t('modals:spellCheck.removeWordAria', { word })}
                    onClick={() => void dispatch(removeUserDictionaryWordThunk({ locale, word }))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className={styles.field}>
            <label htmlFor="spell-add-word">{t('modals:spellCheck.addWordLabel')}</label>
            <div className={styles.addRow}>
              <input
                id="spell-add-word"
                type="text"
                placeholder={t('modals:spellCheck.addWordPlaceholder')}
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
              />
              <button
                type="button"
                disabled={newWord.trim().length === 0}
                onClick={() => {
                  void dispatch(addUserDictionaryWordThunk({ locale, word: newWord.trim() }));
                  setNewWord('');
                }}
              >
                {t('modals:spellCheck.addWord')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

interface LocaleOptionProps {
  id: string;
  available: boolean;
  reason: string | undefined;
  selected: boolean;
  onSelect: () => void;
}

function LocaleOption(props: LocaleOptionProps): JSX.Element {
  const { t } = useT();
  return (
    <div
      className={`${styles.localeOption} ${props.available ? '' : styles.unavailable}`}
      role="radio"
      aria-checked={props.selected}
      aria-disabled={!props.available}
    >
      <input
        type="radio"
        name="spell-locale"
        value={props.id}
        checked={props.selected}
        disabled={!props.available}
        onChange={props.onSelect}
      />
      <span>{props.id}</span>
      {!props.available && (
        <span className={styles.hint}>({t('modals:spellCheck.localeUnavailable')})</span>
      )}
      {!props.available && props.reason !== undefined && (
        <div className={styles.localeReason} role="note">
          <div className={styles.localeReasonHeading}>
            {t('modals:spellCheck.localeReasonHeading')}
          </div>
          {/* VERBATIM per P7.5-L-10. Do NOT paraphrase. */}
          {props.reason}
        </div>
      )}
    </div>
  );
}
