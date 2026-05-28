// Export slice selectors — Phase 1 + Phase 6.
//
// Phase 1 selectors carry the PDF→PDF print-engine state (preference / in-flight /
// engine indicator). Phase 6 selectors carry the Export-to-Office modal state +
// in-flight job + recent jobs DTOs.

import { type RootState } from '../store';

// =============================================================================
// Phase 1
// =============================================================================

export const selectExportPreference = (s: RootState) => s.export.preference;
export const selectExportInFlight = (s: RootState) => s.export.inFlightJobId !== null;
export const selectLastEngine = (s: RootState) => s.export.lastEngineUsed;
export const selectExportProgress = (s: RootState) => s.export.progress;
export const selectExportWarnings = (s: RootState) => s.export.warnings;

// =============================================================================
// Phase 6 — Modal lifecycle
// =============================================================================

export const selectExportModalStep = (s: RootState) => s.export.modalStep;
export const selectExportModalOpen = (s: RootState): boolean => s.export.modalStep !== null;
export const selectExportDraft = (s: RootState) => s.export.draft;
export const selectExportFormatCatalog = (s: RootState) => s.export.formatCatalog;
export const selectLastChosenExportFormat = (s: RootState) => s.export.lastChosenFormat;
export const selectExportPhase6LastError = (s: RootState) => s.export.phase6LastError;

// =============================================================================
// Phase 6 — Job lifecycle
// =============================================================================

export const selectExportCurrentJob = (s: RootState) => s.export.currentJob;
export const selectExportJobRunning = (s: RootState): boolean => {
  const j = s.export.currentJob;
  if (j === null) return false;
  return (
    j.phase === 'starting' ||
    j.phase === 'extracting-text' ||
    j.phase === 'detecting-tables' ||
    j.phase === 'extracting-images' ||
    j.phase === 'rasterizing' ||
    j.phase === 'writing-output'
  );
};
export const selectExportJobTerminal = (s: RootState): boolean => {
  const j = s.export.currentJob;
  if (j === null) return false;
  return j.phase === 'completed' || j.phase === 'cancelled' || j.phase === 'failed';
};
export const selectRecentExportJobs = (s: RootState) => s.export.recentJobs;
export const selectExportLastCompletedAtMs = (s: RootState) => s.export.lastCompletedAtMs;

// =============================================================================
// Phase 6 — Derived: resolved per-format defaults from the catalog
// =============================================================================

/**
 * Resolve the effective `qualityTier` for the in-flight draft, falling back
 * to the per-format catalog default when the user has not made an explicit
 * choice. Conventions §17.6 — the renderer NEVER sends sparse partial; this
 * helper materializes the explicit value the thunk dispatches.
 */
export function selectResolvedQualityTier(s: RootState): 'text-only' | 'layout-preserving' | 'n/a' {
  const draft = s.export.draft;
  if (draft.format === null) return 'n/a';
  // Image formats have no tier; main ignores the field but we send 'n/a' for
  // the audit row per architecture-phase-6.md §4.4.4.
  if (draft.format === 'png' || draft.format === 'jpeg' || draft.format === 'tiff') {
    return 'n/a';
  }
  if (draft.qualityTier !== null) return draft.qualityTier;
  const catalogEntry = s.export.formatCatalog?.find((f) => f.format === draft.format);
  // Default when catalog not loaded yet: hardcoded Q-D mapping. The catalog
  // (when present) is the source of truth.
  if (catalogEntry) {
    if (catalogEntry.defaultQualityTier === 'n/a') return 'n/a';
    return catalogEntry.defaultQualityTier;
  }
  // Q-D fallback (data-models.md §11.6).
  return draft.format === 'xlsx' ? 'text-only' : 'layout-preserving';
}
