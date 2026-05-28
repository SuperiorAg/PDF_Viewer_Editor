// TelemetryDebugPanel — the auditability surface (ui-spec.md §16.4).
//
// Opened from Settings → Privacy → "View collected data". Lists the in-memory
// ring-buffer contents so the opt-in is verifiable BY THE USER: they can read
// every event the framework recorded and confirm it is event-name + day-bucket
// ONLY (no PII — the structural privacy guard, conventions §18.5.3). "Clear
// buffer" empties it. Driven by telemetry:getStatus { includeBuffer: true }.

import { useEffect, useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { api } from '../../../services/api';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectTelemetryOptedIn } from '../../../state/slices/phase7-selectors';
import { setTelemetryBufferSummary } from '../../../state/slices/telemetry-slice';
import { telemetryTransport } from '../../../telemetry/telemetry-transport';
import type { TelemetryBufferEntry } from '../../../types/ipc-contract';
import { ModalShell } from '../modal-shell';

import styles from './telemetry-debug-panel.module.css';

const RING_BUFFER_MAX = 500;

interface TelemetryDebugPanelProps {
  onClose: () => void;
}

export function TelemetryDebugPanel({ onClose }: TelemetryDebugPanelProps): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const optedIn = useAppSelector(selectTelemetryOptedIn);
  const [buffer, setBuffer] = useState<TelemetryBufferEntry[]>([]);

  const refresh = async (): Promise<void> => {
    const res = await api.telemetry.getStatus({ includeBuffer: true });
    if (res.ok) {
      setBuffer(res.value.buffer ?? []);
      dispatch(
        setTelemetryBufferSummary({
          bufferedCount: res.value.bufferedCount,
          lastEventAt: res.value.lastEventAt,
        }),
      );
    } else {
      // Bridge unavailable (tests, or pre-Diego): fall back to the renderer
      // transport mirror so the panel is still exercisable end-to-end.
      setBuffer(
        telemetryTransport.snapshot().map((e) => ({ name: e.name, dayBucket: e.dayBucket })),
      );
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot load on open
  }, []);

  const clearBuffer = async (): Promise<void> => {
    telemetryTransport.clear();
    // Turning the buffer summary to zero; the main process clears its
    // authoritative buffer when opt-in is toggled off, and there is no dedicated
    // clear-only channel in Phase 7, so the renderer mirror clear + a re-fetch
    // is the auditable surface's reset.
    dispatch(setTelemetryBufferSummary({ bufferedCount: 0, lastEventAt: null }));
    setBuffer([]);
  };

  return (
    <ModalShell
      title={t('modals:telemetryDebug.title')}
      onClose={onClose}
      size="md"
      footer={
        <button type="button" className={styles.secondary} onClick={onClose}>
          {t('modals:telemetryDebug.close')}
        </button>
      }
    >
      <div className={styles.panel}>
        <p className={styles.statusLine}>
          {optedIn
            ? t('modals:telemetryDebug.currentlyOn')
            : t('modals:telemetryDebug.currentlyOff')}
        </p>
        <p className={styles.summary}>
          {t('modals:telemetryDebug.bufferedSummary', {
            count: buffer.length,
            max: RING_BUFFER_MAX,
          })}
        </p>

        {buffer.length === 0 ? (
          <p className={styles.empty}>{t('modals:telemetryDebug.empty')}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('modals:telemetryDebug.columnEvent')}</th>
                <th scope="col">{t('modals:telemetryDebug.columnDay')}</th>
              </tr>
            </thead>
            <tbody>
              {buffer.map((entry, i) => (
                <tr key={`${entry.name}-${entry.dayBucket}-${i}`}>
                  <td className={styles.eventName}>{entry.name}</td>
                  <td className={styles.dayBucket}>{entry.dayBucket}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <button type="button" className={styles.clear} onClick={() => void clearBuffer()}>
          {t('modals:telemetryDebug.clearBuffer')}
        </button>
      </div>
    </ModalShell>
  );
}
