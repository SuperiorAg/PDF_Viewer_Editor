// Settings → General tab (ui-spec.md §16.1). The existing Theme/Recents/
// Confirm-close controls PLUS the three Phase-7 groups:
//   - Language picker (i18n:setLocale persist + i18next live-switch).
//   - Privacy / telemetry opt-in toggle (default OFF; trust-floor obligation #1
//     privacy copy inline + always visible, not a tooltip).
//   - Updates: channel radio group (default 'manual') + "Check for updates now"
//     + the honest placeholder copy inline (trust-floor obligation #2).
//
// Every string is t()-keyed from the start. The telemetry + locale copy carry
// the load-bearing honesty (conventions §18.2 never-overstate).

import { useEffect, useState } from 'react';

import { useUpdateActions } from '../../../hooks/use-update-actions';
import { applyLocale } from '../../../i18n/apply-locale';
import { formatDateTime } from '../../../i18n/format';
import { LOCALE_DESCRIPTORS, descriptorFor } from '../../../i18n/locales-meta';
import { useT } from '../../../i18n/use-t';
import { api } from '../../../services/api';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { setLocaleMirror } from '../../../state/slices/i18n-slice';
import {
  selectLocale,
  selectTelemetryOptedIn,
  selectUpdateChannel,
  selectUpdateLastCheckedAt,
} from '../../../state/slices/phase7-selectors';
import { setTelemetryOptedIn } from '../../../state/slices/telemetry-slice';
import { pushToast } from '../../../state/slices/ui-slice';
import { setUpdateChannel } from '../../../state/slices/update-slice';
import { useTelemetry } from '../../../telemetry/use-telemetry';
import type { AppLocale, LocaleDescriptor, UpdateChannel } from '../../../types/ipc-contract';

import styles from './settings-modal.module.css';

interface GeneralTabProps {
  recentsMaxItems: number;
  onRecentsMaxChange: (n: number) => void;
  confirmClose: boolean;
  onConfirmCloseChange: (v: boolean) => void;
  onOpenDebugPanel: () => void;
}

export function GeneralTab(props: GeneralTabProps): JSX.Element {
  const { t, locale } = useT();
  const dispatch = useAppDispatch();
  const record = useTelemetry();
  const { checkNow } = useUpdateActions();

  const activeLocale = useAppSelector(selectLocale);
  const optedIn = useAppSelector(selectTelemetryOptedIn);
  const channel = useAppSelector(selectUpdateChannel);
  const lastCheckedAt = useAppSelector(selectUpdateLastCheckedAt);

  // Data-driven locale list (i18n:getAvailableLocales); static descriptors are
  // the synchronous fallback while the IPC call is in flight.
  const [locales, setLocales] = useState<readonly LocaleDescriptor[]>(LOCALE_DESCRIPTORS);
  useEffect(() => {
    void (async () => {
      const res = await api.i18n.getAvailableLocales({});
      if (res.ok) setLocales(res.value.locales);
    })();
  }, []);

  const onLocaleChange = async (next: AppLocale): Promise<void> => {
    // Apply live to the store mirror FIRST so the UI re-renders instantly
    // (useT is store-driven). Persist + telemetry next so they always fire
    // regardless of the i18next engine. The engine prime (applyLocale) is a
    // fire-and-forget no-op until Diego installs i18next.
    dispatch(setLocaleMirror(next));
    record('feature.locale.changed');
    const res = await api.i18n.setLocale({ locale: next });
    if (!res.ok) {
      dispatch(
        pushToast({ kind: 'error', message: t('settings:saveError', { message: res.error }) }),
      );
    }
    void applyLocale(next);
  };

  const onTelemetryToggle = async (next: boolean): Promise<void> => {
    dispatch(setTelemetryOptedIn(next));
    const res = await api.telemetry.setOptIn({ optIn: next });
    if (res.ok && res.value.bufferCleared) {
      dispatch(pushToast({ kind: 'info', message: t('settings:privacy.dataCleared') }));
    }
  };

  const onChannelChange = async (next: UpdateChannel): Promise<void> => {
    dispatch(setUpdateChannel(next));
    // any: settings.set is generic over the SettingKey union; the runtime
    // key/value pair matches at this call site (same justified cast pattern as
    // the rest of settings-modal). NOT an i18n/t() cast — conventions §18.4.4.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (api.settings.set as any)({ key: 'update.channel', value: next });
  };

  const selectedDescriptor = descriptorFor(activeLocale);
  const lastCheckedLabel =
    lastCheckedAt === null ? t('common:never') : formatDateTime(locale, lastCheckedAt);

  return (
    <>
      {/* Theme — still Phase 2-deferred. */}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('settings:general.themeLabel')}</span>
        <select disabled title={t('settings:general.themeComingSoon')}>
          <option>{t('settings:general.themeSystem')}</option>
        </select>
        <span className={styles.fieldHint}>{t('settings:general.themeComingSoon')}</span>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('settings:general.recentsMaxLabel')}</span>
        <input
          type="number"
          min={1}
          max={200}
          value={props.recentsMaxItems}
          onChange={(e) => props.onRecentsMaxChange(Number(e.target.value))}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('settings:general.confirmCloseLabel')}</span>
        <input
          type="checkbox"
          checked={props.confirmClose}
          onChange={(e) => props.onConfirmCloseChange(e.target.checked)}
        />
      </label>

      {/* ── Language ─────────────────────────────────────────────── */}
      <fieldset className={styles.group}>
        <legend className={styles.groupHeading}>{t('settings:language.groupHeading')}</legend>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('settings:language.pickerLabel')}</span>
          <select
            aria-label={t('settings:language.pickerLabel')}
            value={activeLocale}
            onChange={(e) => void onLocaleChange(e.target.value as AppLocale)}
          >
            {locales.map((d) => (
              <option key={d.locale} value={d.locale}>
                {d.nativeName}
              </option>
            ))}
          </select>
          {/* Trust-floor obligation #4: the proof locale is a SAMPLE, not a
              complete localization. Shown whenever an incomplete locale is
              selected. */}
          {!selectedDescriptor.complete && (
            <span className={styles.fieldHint}>
              {t('settings:language.sampleSubtext', { name: selectedDescriptor.nativeName })}
            </span>
          )}
        </label>
      </fieldset>

      {/* ── Privacy ──────────────────────────────────────────────── */}
      <fieldset className={styles.group}>
        <legend className={styles.groupHeading}>{t('settings:privacy.groupHeading')}</legend>
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={optedIn}
            aria-describedby="telemetry-privacy-copy"
            onChange={(e) => void onTelemetryToggle(e.target.checked)}
          />
          <span className={styles.fieldLabel}>{t('settings:privacy.telemetryLabel')}</span>
        </label>
        {/* Always visible (NOT a tooltip — obligation #1 must be read, not
            hovered). aria-describedby links it to the checkbox for Narrator. */}
        <p id="telemetry-privacy-copy" className={styles.privacyCopy}>
          {t('settings:privacy.telemetryDescription')}
        </p>
        <button type="button" className={styles.secondary} onClick={props.onOpenDebugPanel}>
          {t('settings:privacy.viewCollectedData')}
        </button>
      </fieldset>

      {/* ── Updates ──────────────────────────────────────────────── */}
      <fieldset className={styles.group}>
        <legend className={styles.groupHeading}>{t('settings:updates.groupHeading')}</legend>
        <div
          role="radiogroup"
          aria-label={t('settings:updates.policyLabel')}
          className={styles.radioGroup}
        >
          <label className={styles.checkboxField}>
            <input
              type="radio"
              name="update-channel"
              checked={channel === 'manual'}
              onChange={() => void onChannelChange('manual')}
            />
            <span>{t('settings:updates.policyManual')}</span>
          </label>
          <label className={styles.checkboxField}>
            <input
              type="radio"
              name="update-channel"
              checked={channel === 'check-on-launch'}
              onChange={() => void onChannelChange('check-on-launch')}
            />
            <span>{t('settings:updates.policyLaunch')}</span>
          </label>
        </div>
        <button type="button" className={styles.secondary} onClick={() => void checkNow()}>
          {t('settings:updates.checkNow')}
        </button>
        <p className={styles.fieldHint}>
          {t('settings:updates.lastChecked', { when: lastCheckedLabel })}
        </p>
        {/* Trust-floor obligation #2: the publish target is a placeholder. */}
        <p className={styles.fieldHint}>{t('settings:updates.placeholderNote')}</p>
      </fieldset>
    </>
  );
}
