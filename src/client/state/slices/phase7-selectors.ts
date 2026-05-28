// Phase 7 selectors — update / telemetry / i18n slice readers.

import type { RootState } from '../store';

// Phase-7 slices may be absent in partial-store component tests; every selector
// degrades to the slice's documented default rather than throwing.
import { type UpdateState } from './update-slice';

const UPDATE_DEFAULT: UpdateState = {
  channel: 'manual',
  status: 'idle',
  availableVersion: null,
  currentVersion: null,
  downloadProgressPercent: null,
  lastCheckedAt: null,
  errorCode: null,
};

// ---- update ----------------------------------------------------------------
export const selectUpdateState = (s: RootState): UpdateState => s.update ?? UPDATE_DEFAULT;
export const selectUpdateStatus = (s: RootState): UpdateState['status'] =>
  selectUpdateState(s).status;
export const selectUpdateChannel = (s: RootState): UpdateState['channel'] =>
  selectUpdateState(s).channel;
export const selectUpdateAvailableVersion = (s: RootState): string | null =>
  selectUpdateState(s).availableVersion;
export const selectUpdateLastCheckedAt = (s: RootState): number | null =>
  selectUpdateState(s).lastCheckedAt;

// ---- telemetry -------------------------------------------------------------
export const selectTelemetryOptedIn = (s: RootState): boolean => s.telemetry?.optedIn ?? false;
export const selectTelemetryBufferedCount = (s: RootState): number =>
  s.telemetry?.bufferedCount ?? 0;
export const selectTelemetryLastEventAt = (s: RootState): number | null =>
  s.telemetry?.lastEventAt ?? null;

// ---- i18n ------------------------------------------------------------------
// Defensive read: many existing component tests build a partial store WITHOUT
// the Phase-7 i18n slice. A missing slice must degrade to the en-US baseline
// (the fallbackLng guarantee at the selector level) rather than throw —
// useT/components are rendered in those partial-store tests.
export const selectLocale = (s: RootState): RootState['i18n']['locale'] =>
  s.i18n?.locale ?? 'en-US';
