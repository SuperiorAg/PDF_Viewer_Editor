// Per-document measure calibration store (Phase 4).
//
// Contract: docs/data-models.md §9.8 + docs/api-contracts.md §14.9.
//
// Stored in main-process memory keyed by DocumentHandle for the document's
// open session. Persisted into the PDF on save by writing a /Measure dict
// onto the document's first measure-bearing annotation (handled in the
// replay engine; this module is only the in-memory store).

import type { DocumentHandle, MeasureCalibration } from '../../../ipc/contracts.js';

const STORE: Map<DocumentHandle, MeasureCalibration> = new Map();

export function setCalibration(handle: DocumentHandle, calibration: MeasureCalibration): void {
  STORE.set(handle, calibration);
}

export function getCalibration(handle: DocumentHandle): MeasureCalibration | null {
  return STORE.get(handle) ?? null;
}

/** Drop a doc's calibration (call on close-document). */
export function clearCalibration(handle: DocumentHandle): boolean {
  return STORE.delete(handle);
}

/** Reset all calibrations (test teardown + app quit). */
export function clearAllCalibrations(): number {
  const n = STORE.size;
  STORE.clear();
  return n;
}
