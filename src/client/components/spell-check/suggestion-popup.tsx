// Spell-check suggestion popup — Phase 7.5 B14 UI (Riley Wave 6).
// Spec: docs/ui-spec-phase-7.5.md §14.2.
//
// Renders the top-5 suggestions for a misspelled word + an Ignore Once
// action + an Add to Dictionary action + a link to settings. Mounted at the
// app level so it positions absolute relative to the document body using
// `(anchorX, anchorY)` from the slice.

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  hideSpellSuggestionPopup,
  ignoreSpellWordOnce,
  selectSpellLocale,
  selectSpellPopup,
  setSpellCheckSettingsOpen,
} from '../../state/slices/spell-check-slice';
import { addUserDictionaryWordThunk } from '../../state/thunks-phase7-5-wave6';

import styles from './styles.module.css';

export function SpellSuggestionPopup(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const { t } = useT();
  const popup = useAppSelector(selectSpellPopup);
  const locale = useAppSelector(selectSpellLocale);

  if (popup.pageIndex === null || popup.objectId === null) return null;

  return (
    <div
      className={styles.popup}
      style={{ left: popup.anchorX, top: popup.anchorY }}
      role="menu"
      aria-label={`Spelling suggestions for ${popup.word}`}
    >
      <div className={styles.popupHeader}>{popup.word}</div>
      {popup.suggestions.length === 0 ? (
        <div className={styles.popupEmpty}>{t('modals:spellCheck.popup.noSuggestions')}</div>
      ) : (
        popup.suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={styles.popupItem}
            onClick={() => {
              // The popup itself does not commit text — the consumer surface
              // (text-edit overlay) reads `popup.selected` if/when we wire a
              // selection action. v0.8.0 closes the popup on click; the
              // text-edit overlay can decide to apply the suggestion.
              dispatch(hideSpellSuggestionPopup());
            }}
            role="menuitem"
          >
            {suggestion}
          </button>
        ))
      )}
      <div className={styles.popupDivider} />
      <button
        type="button"
        className={styles.popupItem}
        onClick={() => {
          dispatch(
            ignoreSpellWordOnce({
              pageIndex: popup.pageIndex!,
              objectId: popup.objectId!,
              word: popup.word,
            }),
          );
          dispatch(hideSpellSuggestionPopup());
        }}
        role="menuitem"
      >
        {t('modals:spellCheck.popup.ignoreOnce')}
      </button>
      <button
        type="button"
        className={styles.popupItem}
        onClick={() => {
          void dispatch(addUserDictionaryWordThunk({ locale, word: popup.word }));
          dispatch(hideSpellSuggestionPopup());
        }}
        role="menuitem"
      >
        {t('modals:spellCheck.popup.addToDictionary')}
      </button>
      <div className={styles.popupDivider} />
      <button
        type="button"
        className={styles.popupItem}
        onClick={() => {
          dispatch(hideSpellSuggestionPopup());
          dispatch(setSpellCheckSettingsOpen(true));
        }}
        role="menuitem"
      >
        {t('modals:spellCheck.popup.openSettings')}
      </button>
    </div>
  );
}
