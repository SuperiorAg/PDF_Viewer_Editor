// Telemetry transport (architecture-phase-7.md §4.3, conventions §18.5).
//
// The transport interface is REQUIRED at every injection point — there is no
// optional + stub fallback (the anti-stub discipline, conventions §18.5.7). The
// Phase 7 shipped implementation is a bounded in-memory ring buffer that NEVER
// writes to disk and NEVER sends anything over the network. The user can read
// every buffered event via the telemetry debug panel, which is what makes the
// opt-in auditable.
//
// Phase 7.1 may add a `NetworkBatchTransport implements TelemetryTransport`
// behind this same interface; the opt-in UI and the allowlist do not change.

import type { TelemetryEventName } from '../types/ipc-contract';

/**
 * The ONLY shape a telemetry event takes: a name + a count (always 1 per call;
 * aggregation is the transport's job) + a coarse day bucket. There is no field
 * for PII — that absence is the structural privacy guarantee (conventions
 * §18.5.3), not a discipline that can be forgotten.
 */
export interface TelemetryEvent {
  readonly name: TelemetryEventName;
  readonly count: 1;
  readonly dayBucket: string;
}

export interface TelemetryTransport {
  /** Called only when opt-in is TRUE (the hook gates on it). */
  record(event: TelemetryEvent): void;
  /** Read the buffered events for the debug panel. */
  snapshot(): readonly TelemetryEvent[];
  /** Empty the buffer (called on opt-out + on the panel's "Clear buffer"). */
  clear(): void;
}

/**
 * The Phase 7 shipped transport: a bounded ring buffer. Oldest events are
 * evicted past `maxEvents`. Nothing is persisted; nothing is sent. This is the
 * COMPLETE Phase 7 implementation, not a stub with a TODO.
 *
 * NOTE: the renderer-side buffer here is the debug-panel mirror; the main
 * process keeps its own authoritative ring buffer (David's telemetry handler)
 * which `telemetry:getStatus { includeBuffer: true }` returns. The renderer
 * transport exists so the `useTelemetry` hook has a synchronous record sink and
 * so the framework is exercisable end-to-end in tests without the bridge.
 */
export class NoOpRingBufferTransport implements TelemetryTransport {
  private readonly buffer: TelemetryEvent[] = [];

  constructor(private readonly maxEvents: number = 500) {}

  record(event: TelemetryEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.maxEvents) {
      this.buffer.splice(0, this.buffer.length - this.maxEvents);
    }
  }

  snapshot(): readonly TelemetryEvent[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

/** The single process-wide renderer transport instance (required injection). */
export const telemetryTransport: TelemetryTransport = new NoOpRingBufferTransport();
