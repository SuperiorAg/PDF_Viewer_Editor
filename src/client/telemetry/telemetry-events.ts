// Telemetry event allowlist (architecture-phase-7.md §4.2, conventions §18.5.2).
//
// EXPLICIT, CLOSED allowlist. Adding an event = adding a literal to the union
// (re-exported from David's canonical contract) AND to the runtime Set below.
// Anything not in the Set is dropped (dev-mode console.warn). This is the
// belt-and-suspenders runtime guard that complements the type union.
//
// PRIVACY: the only payload a telemetry event ever carries is its NAME + a
// coarse day bucket. There is physically no field for document content, file
// paths, field values, or user identity — the structural PII guarantee
// (conventions §18.5.3). See telemetry-transport.ts for the TelemetryEvent shape.

import type { TelemetryEventName } from '../types/ipc-contract';

/** Runtime mirror of the `TelemetryEventName` union (David's contract §18.4). */
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

export function isAllowlisted(name: string): name is TelemetryEventName {
  return TELEMETRY_ALLOWLIST.has(name as TelemetryEventName);
}

/**
 * Coarse day bucket — 'YYYY-MM-DD' in UTC. NO sub-day resolution
 * (conventions §18.5.4 — defeats session fingerprinting). The only timestamp a
 * telemetry event is permitted to carry.
 */
export function toDayBucket(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
