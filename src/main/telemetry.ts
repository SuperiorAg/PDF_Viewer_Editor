// Phase 7 — telemetry framework (hand-rolled, opt-in default OFF, zero new deps).
//
// ARCHITECTURE: architecture-phase-7.md §4 (P7-L-3) + conventions §18.5 +
// api-contracts.md §18.4-§18.6.
//
// PRIVACY STANCE (loud, by design):
//   - Opt-in is DEFAULT OFF (`settings.telemetry.optIn` defaults false).
//   - When OFF, recordEvent is a SILENT NO-OP — it does not even buffer.
//   - Records ANONYMOUS feature-usage counts ONLY: `{ name, dayBucket }`.
//     There is PHYSICALLY no field for document content, file paths, field
//     values, error strings, or user identity. The IPC handler's `.strict()`
//     zod schema rejects any extra property — the STRUCTURAL PII guard.
//   - Transport is a `NoOpRingBufferTransport`: an in-memory bounded buffer.
//     NOTHING leaves the machine in Phase 7. Never persisted to SQLite, never
//     written to disk, cleared on opt-out + on quit.
//   - The buffer is auditable via telemetry:getStatus { includeBuffer: true }
//     (the renderer debug panel).
//
// NO third-party phone-home SDK (no GA / Sentry / PostHog / Mixpanel /
// Amplitude). The transport interface field is REQUIRED — no optional + stub
// fallback (anti-stub discipline, conventions §18.5 rule 7).

import type {
  TelemetryBufferEntry,
  TelemetryEventName,
  TelemetryGetStatusValue,
} from '../ipc/contracts.js';

// ----------------------------------------------------------------------------
// The explicit event-name allowlist. Closed TS union (contracts.ts) + this
// runtime Set. Adding an event = adding to BOTH. Anything not allowlisted is
// dropped (conventions §18.5 rule 2). Kept in lockstep with
// `TelemetryEventName` in src/ipc/contracts.ts.
// ----------------------------------------------------------------------------

export const TELEMETRY_ALLOWLIST: ReadonlySet<TelemetryEventName> = new Set<TelemetryEventName>([
  'app.launch',
  'doc.open',
  'doc.save',
  'feature.annotate.add',
  'feature.page.reorder',
  'feature.combine.run',
  'feature.form.fill',
  'feature.mailmerge.run',
  'feature.sign.pades',
  'feature.ocr.run',
  'feature.export.docx',
  'feature.export.xlsx',
  'feature.export.pptx',
  'feature.export.image',
  'feature.update.checked',
  'feature.locale.changed',
]);

export function isAllowlistedEvent(name: string): name is TelemetryEventName {
  return TELEMETRY_ALLOWLIST.has(name as TelemetryEventName);
}

// ----------------------------------------------------------------------------
// The transport interface (Q-B). The Phase 7 shipped impl is the no-op ring
// buffer; Phase 7.1 may add a NetworkBatchTransport behind the SAME interface.
// ----------------------------------------------------------------------------

export interface TelemetryTransport {
  /** Called only when opt-in is TRUE. */
  record(event: TelemetryBufferEntry): void;
  /** For the debug panel — a read-only snapshot. */
  snapshot(): readonly TelemetryBufferEntry[];
  /** Drop all buffered events (on opt-out). */
  clear(): void;
  /** Number of buffered events. */
  size(): number;
}

// ----------------------------------------------------------------------------
// NoOpRingBufferTransport — in-memory bounded ring buffer (default 500).
// Oldest evicted on overflow. Never written to disk; never sent over network.
// "NoOp" = it performs no network/disk side-effect — it is the COMPLETE Phase 7
// transport, exercisable end-to-end via the debug panel.
// ----------------------------------------------------------------------------

const DEFAULT_RING_CAPACITY = 500;

export class NoOpRingBufferTransport implements TelemetryTransport {
  private readonly capacity: number;
  private readonly events: TelemetryBufferEntry[] = [];

  constructor(capacity: number = DEFAULT_RING_CAPACITY) {
    // Guard against a degenerate capacity; minimum 1.
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  record(event: TelemetryBufferEntry): void {
    // Defensive copy — store ONLY name + dayBucket (no PII can sneak in).
    this.events.push({ name: event.name, dayBucket: event.dayBucket });
    if (this.events.length > this.capacity) {
      // Evict oldest (ring semantics).
      this.events.splice(0, this.events.length - this.capacity);
    }
  }

  snapshot(): readonly TelemetryBufferEntry[] {
    // Return a defensive copy so callers cannot mutate the internal buffer.
    return this.events.map((e) => ({ name: e.name, dayBucket: e.dayBucket }));
  }

  clear(): void {
    this.events.length = 0;
  }

  size(): number {
    return this.events.length;
  }
}

// ----------------------------------------------------------------------------
// The telemetry service. Holds the transport + the opt-in gate. Opt-in is
// persisted via the injected settings accessor (`settings.telemetry.optIn`).
// ----------------------------------------------------------------------------

export type TelemetryRecordResult =
  | { recorded: true }
  | { recorded: false; reason: 'not_opted_in' | 'not_allowlisted' };

export interface TelemetrySettingsAccess {
  /** Read the persisted opt-in flag (DEFAULT false when null/unknown). */
  getOptIn: () => boolean;
  /** Persist the opt-in flag. Throws on write failure (handler maps it). */
  setOptIn: (value: boolean) => void;
}

export interface TelemetryService {
  /**
   * Record an event. Returns the structured outcome. When opt-in is OFF this
   * is a SILENT no-op (does not even buffer) and returns `not_opted_in`.
   * When the name is not allowlisted it returns `not_allowlisted` (dropped).
   */
  recordEvent(name: string, dayBucket: string): TelemetryRecordResult;
  /**
   * Set opt-in. Turning OFF clears the ring buffer (no orphaned events survive
   * opt-out — api-contracts.md §18.10). Returns whether the buffer was cleared.
   */
  setOptIn(enabled: boolean): { optIn: boolean; bufferCleared: boolean };
  /** Current status (+ optional auditable buffer snapshot for the debug panel). */
  getStatus(includeBuffer: boolean): TelemetryGetStatusValue;
}

export interface TelemetryServiceDeps {
  transport: TelemetryTransport;
  settings: TelemetrySettingsAccess;
  /** Now, ms epoch. Injected for deterministic tests. */
  now: () => number;
}

export function createTelemetryService(deps: TelemetryServiceDeps): TelemetryService {
  // lastEventAt is nullable + late-init (NO sentinel 0 — anti-sentinel
  // discipline). null until the first event is recorded this session.
  let lastEventAt: number | null = null;

  function recordEvent(name: string, dayBucket: string): TelemetryRecordResult {
    // Hard gate: opt-in OFF means a SILENT no-op — do not even buffer.
    if (!deps.settings.getOptIn()) {
      return { recorded: false, reason: 'not_opted_in' };
    }
    // Belt-and-suspenders allowlist re-check (the renderer hook already gates,
    // but the main-process handler re-validates per api-contracts.md §18.10).
    if (!isAllowlistedEvent(name)) {
      return { recorded: false, reason: 'not_allowlisted' };
    }
    deps.transport.record({ name, dayBucket });
    lastEventAt = deps.now();
    return { recorded: true };
  }

  function setOptIn(enabled: boolean): { optIn: boolean; bufferCleared: boolean } {
    deps.settings.setOptIn(enabled);
    if (!enabled) {
      // Turning OFF clears the buffer. Also reset lastEventAt so the status
      // does not retain a stale timestamp across an opt-out.
      deps.transport.clear();
      lastEventAt = null;
      return { optIn: false, bufferCleared: true };
    }
    return { optIn: true, bufferCleared: false };
  }

  function getStatus(includeBuffer: boolean): TelemetryGetStatusValue {
    const optedIn = deps.settings.getOptIn();
    const buffer: TelemetryBufferEntry[] | null = includeBuffer
      ? deps.transport.snapshot().map((e) => ({ name: e.name, dayBucket: e.dayBucket }))
      : null;
    return {
      optedIn,
      bufferedCount: deps.transport.size(),
      lastEventAt,
      buffer,
    };
  }

  return { recordEvent, setOptIn, getStatus };
}
