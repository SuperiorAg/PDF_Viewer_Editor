// useTelemetry — the opt-in-gated event recorder (architecture-phase-7.md §4.4,
// conventions §18.5).
//
// The gate is checked HERE (at the hook), not at every call site, so call sites
// stay a one-liner (`record('feature.export.docx')`) and cannot forget the
// gate. When opt-in is OFF, the hook returns immediately — no event is created,
// nothing touches the transport, nothing crosses IPC. The allowlist is a
// belt-and-suspenders second guard.
//
// The transport is REQUIRED (injected at module scope, never optional with a
// stub fallback — conventions §18.5.7). The call site passes only the event
// NAME; the hook adds `count: 1` + the day bucket. There is no API surface for
// a caller to attach PII — the structural guarantee.

import { useCallback } from 'react';

import { api } from '../services/api';
import { useAppSelector } from '../state/hooks';
import { selectTelemetryOptedIn } from '../state/slices/phase7-selectors';
import type { TelemetryEventName } from '../types/ipc-contract';

import { isAllowlisted, toDayBucket } from './telemetry-events';
import { telemetryTransport } from './telemetry-transport';

export function useTelemetry(): (name: TelemetryEventName) => void {
  const optedIn = useAppSelector(selectTelemetryOptedIn);

  return useCallback(
    (name: TelemetryEventName) => {
      if (!optedIn) return; // hard gate — no event when OFF.
      if (!isAllowlisted(name)) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console -- dev-only diagnostic; never ships a payload.
          console.warn(`telemetry: dropped non-allowlisted '${name}'`);
        }
        return;
      }
      const dayBucket = toDayBucket(Date.now());
      // Renderer mirror (for the debug panel) + the authoritative main-process
      // record. The main handler re-checks opt-in + re-validates the allowlist
      // (belt-and-suspenders, api-contracts.md §18.4) and owns the buffer that
      // telemetry:getStatus returns.
      telemetryTransport.record({ name, count: 1, dayBucket });
      void api.telemetry.recordEvent({ name, dayBucket });
    },
    [optedIn],
  );
}
