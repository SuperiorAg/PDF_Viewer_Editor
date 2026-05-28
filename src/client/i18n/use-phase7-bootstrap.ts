// Phase 7 bootstrap — seeds the renderer mirrors (locale, telemetry opt-in,
// update channel) from the settings store on app mount, then optionally runs an
// auto update-check.
//
// Sources of truth (data-models.md §12.3, all in the existing settings KV
// store — no new table per P7-L-7):
//   - 'i18n.locale'         default 'en-US'  → i18n slice + i18next.changeLanguage
//   - 'telemetry.optIn'     default false    → telemetry slice (hard-gate source)
//   - 'update.channel'      default 'manual' → update slice
//   - 'update.lastCheckedAt' nullable        → update slice
//
// Auto update-check: ONLY when settings.update.channel === 'check-on-launch'
// (default 'manual', so OFF). The renderer verifies the setting BEFORE
// dispatching update:check { trigger: 'launch' } (api-contracts.md §18.10).

import { useEffect } from 'react';

import { api } from '../services/api';
import { useAppDispatch } from '../state/hooks';
import { setLocaleMirror } from '../state/slices/i18n-slice';
import { setTelemetryBufferSummary, setTelemetryOptedIn } from '../state/slices/telemetry-slice';
import {
  setUpdateChannel,
  updateCheckStarted,
  updateCheckSucceeded,
  updateNotConfigured,
  updateCheckFailed,
} from '../state/slices/update-slice';

import { applyLocale } from './apply-locale';
import { isSupportedLocale } from './locales-meta';

export function usePhase7Bootstrap(): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    void (async () => {
      const res = await api.settings.getAll();
      if (res.ok) {
        const e = res.value.entries;

        const locale = e['i18n.locale'] ?? 'en-US';
        if (isSupportedLocale(locale)) {
          dispatch(setLocaleMirror(locale));
          // Apply to the i18next engine too (no-op until Diego installs it; the
          // store mirror drives useT in the meantime).
          await applyLocale(locale);
        }

        dispatch(setTelemetryOptedIn(e['telemetry.optIn'] ?? false));
        dispatch(setUpdateChannel(e['update.channel'] ?? 'manual'));

        // Auto update-check only on the opt-in 'check-on-launch' channel.
        if (e['update.channel'] === 'check-on-launch') {
          dispatch(updateCheckStarted());
          const check = await api.update.check({ trigger: 'launch' });
          if (check.ok) {
            dispatch(updateCheckSucceeded(check.value));
          } else if (check.error === 'update_not_configured') {
            dispatch(updateNotConfigured());
          } else {
            dispatch(updateCheckFailed(check.error));
          }
        }
      }

      // Seed the telemetry buffer summary (count + lastEventAt) for the Settings
      // privacy summary line.
      const status = await api.telemetry.getStatus({ includeBuffer: false });
      if (status.ok) {
        dispatch(
          setTelemetryBufferSummary({
            bufferedCount: status.value.bufferedCount,
            lastEventAt: status.value.lastEventAt,
          }),
        );
      }
    })();
  }, [dispatch]);
}
