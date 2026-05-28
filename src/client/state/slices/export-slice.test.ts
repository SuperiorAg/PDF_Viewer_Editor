// Export slice unit tests — Phase 6.
// Validates Phase 6 reducer behavior, late-init discipline, no-sentinel
// defaults, and the modal-step lifecycle.

import { describe, expect, it } from 'vitest';

import {
  type ExportFormatDescriptor,
  type ExportJobRowDto,
  type ExportProgressEvent,
} from '../../types/ipc-contract';

import exportReducer, {
  applyExportProgressEvent,
  clearCurrentJob,
  closeExportModal,
  openExportModal,
  setDraftFormat,
  setDraftImageOptions,
  setDraftIncludeAnnotations,
  setDraftOutputPath,
  setDraftPageRange,
  setDraftPageSize,
  setDraftQualityTier,
  setFormatCatalog,
  setModalStep,
  setPhase6Error,
  setRecentJobs,
  startJobProgress,
  // Phase 1 actions (preserved on slice)
  setInFlight,
  setLastEngine,
  setPreference,
  setProgress,
} from './export-slice';

const SAMPLE_CATALOG: ExportFormatDescriptor[] = [
  {
    format: 'docx',
    displayName: 'Word document',
    defaultExtension: 'docx',
    category: 'office',
    supportsQualityTier: true,
    defaultQualityTier: 'layout-preserving',
    defaultIncludeAnnotations: true,
    settingKeys: ['export.docx.qualityTier'],
  },
  {
    format: 'xlsx',
    displayName: 'Excel workbook',
    defaultExtension: 'xlsx',
    category: 'office',
    supportsQualityTier: true,
    defaultQualityTier: 'text-only',
    defaultIncludeAnnotations: false,
    settingKeys: ['export.xlsx.qualityTier'],
  },
];

const SAMPLE_JOB_DTO: ExportJobRowDto = {
  id: 42,
  docHash: 'abc123',
  format: 'docx',
  qualityTier: 'layout-preserving',
  pageRange: { start: 0, end: 9 },
  includeAnnotations: true,
  imageOptions: null,
  outputBasename: 'my-doc.docx',
  outputDirHint: 'Downloads',
  outputSizeBytes: 12345,
  status: 'completed',
  startedAt: 1000,
  completedAt: 2000,
  durationMs: 1000,
  pagesProcessed: 10,
  contentStats: {
    paragraphsExtracted: 50,
    tablesDetected: 2,
    imagesEmbedded: 3,
  },
  errorMessage: null,
  createdAt: 999,
};

describe('export-slice — initial state (Phase 6)', () => {
  it('starts with modal closed and nullable fields null (no sentinels)', () => {
    const state = exportReducer(undefined, { type: '@@INIT' });
    expect(state.modalStep).toBe(null);
    expect(state.lastChosenFormat).toBe(null);
    expect(state.formatCatalog).toBe(null);
    expect(state.currentJob).toBe(null);
    expect(state.recentJobs).toBe(null);
    expect(state.phase6LastError).toBe(null);
    expect(state.lastCompletedAtMs).toBe(null);
    // Draft sub-fields
    expect(state.draft.format).toBe(null);
    expect(state.draft.qualityTier).toBe(null);
    expect(state.draft.pageRange).toBe(null);
    expect(state.draft.outputPath).toBe(null);
    expect(state.draft.includeAnnotations).toBe(true);
    expect(state.draft.pageSize).toBe('auto');
  });

  it('preserves Phase 1 export-engine surface unchanged', () => {
    const state = exportReducer(undefined, { type: '@@INIT' });
    expect(state.preference).toBe('auto');
    expect(state.inFlightJobId).toBe(null);
    expect(state.lastEngineUsed).toBe(null);
    expect(state.lastReason).toBe(null);
    expect(state.progress).toBe(null);
    expect(state.warnings).toEqual([]);
  });
});

describe('export-slice — modal lifecycle', () => {
  it('openExportModal with no preset opens Step 1 (format)', () => {
    const next = exportReducer(undefined, openExportModal(undefined));
    expect(next.modalStep).toBe('format');
    expect(next.draft.format).toBe(null);
  });

  it('openExportModal with presetFormat pre-selects the format on Step 1', () => {
    const next = exportReducer(undefined, openExportModal({ presetFormat: 'xlsx' }));
    expect(next.modalStep).toBe('format');
    expect(next.draft.format).toBe('xlsx');
  });

  it('closeExportModal clears modalStep but preserves currentJob', () => {
    const opened = exportReducer(undefined, openExportModal(undefined));
    const withJob = exportReducer(
      opened,
      startJobProgress({ jobId: 7, format: 'docx', totalPages: 5 }),
    );
    expect(withJob.modalStep).toBe('format');
    expect(withJob.currentJob).not.toBe(null);
    const closed = exportReducer(withJob, closeExportModal());
    expect(closed.modalStep).toBe(null);
    expect(closed.currentJob).not.toBe(null);
    expect(closed.currentJob?.jobId).toBe(7);
  });

  it('setModalStep transitions across the wizard', () => {
    let s = exportReducer(undefined, openExportModal(undefined));
    s = exportReducer(s, setModalStep('options'));
    expect(s.modalStep).toBe('options');
    s = exportReducer(s, setModalStep('confirm'));
    expect(s.modalStep).toBe('confirm');
  });
});

describe('export-slice — draft edits', () => {
  it('setDraftFormat for xlsx sets includeAnnotations=false (Q-D default)', () => {
    const s = exportReducer(undefined, setDraftFormat('xlsx'));
    expect(s.draft.format).toBe('xlsx');
    expect(s.draft.includeAnnotations).toBe(false);
    expect(s.lastChosenFormat).toBe('xlsx');
  });

  it('setDraftFormat for docx sets includeAnnotations=true (Q-D default)', () => {
    const s = exportReducer(undefined, setDraftFormat('docx'));
    expect(s.draft.includeAnnotations).toBe(true);
  });

  it('setDraftFormat for image variant updates imageOptions.imageFormat', () => {
    const s = exportReducer(undefined, setDraftFormat('jpeg'));
    expect(s.draft.format).toBe('jpeg');
    expect(s.draft.imageOptions.imageFormat).toBe('jpeg');
  });

  it('setDraftQualityTier overrides the per-format default', () => {
    const s = exportReducer(undefined, setDraftQualityTier('text-only'));
    expect(s.draft.qualityTier).toBe('text-only');
  });

  it('setDraftPageRange accepts null for "all pages"', () => {
    let s = exportReducer(undefined, setDraftPageRange({ start: 0, end: 4 }));
    expect(s.draft.pageRange).toEqual({ start: 0, end: 4 });
    s = exportReducer(s, setDraftPageRange(null));
    expect(s.draft.pageRange).toBe(null);
  });

  it('setDraftIncludeAnnotations flips the toggle', () => {
    const s = exportReducer(undefined, setDraftIncludeAnnotations(false));
    expect(s.draft.includeAnnotations).toBe(false);
  });

  it('setDraftPageSize accepts letter / a4 / auto', () => {
    let s = exportReducer(undefined, setDraftPageSize('letter'));
    expect(s.draft.pageSize).toBe('letter');
    s = exportReducer(s, setDraftPageSize('a4'));
    expect(s.draft.pageSize).toBe('a4');
  });

  it('setDraftImageOptions partial-updates dpi + jpegQuality', () => {
    let s = exportReducer(undefined, setDraftImageOptions({ dpi: 300 }));
    expect(s.draft.imageOptions.dpi).toBe(300);
    s = exportReducer(s, setDraftImageOptions({ jpegQuality: 0.7 }));
    expect(s.draft.imageOptions.jpegQuality).toBe(0.7);
    expect(s.draft.imageOptions.dpi).toBe(300);
  });

  it('setDraftOutputPath accepts a path and null', () => {
    let s = exportReducer(undefined, setDraftOutputPath('C:\\Users\\foo.docx'));
    expect(s.draft.outputPath).toBe('C:\\Users\\foo.docx');
    s = exportReducer(s, setDraftOutputPath(null));
    expect(s.draft.outputPath).toBe(null);
  });
});

describe('export-slice — format catalog', () => {
  it('setFormatCatalog stores the catalog as-is', () => {
    const s = exportReducer(undefined, setFormatCatalog(SAMPLE_CATALOG));
    expect(s.formatCatalog).toEqual(SAMPLE_CATALOG);
  });
});

describe('export-slice — job lifecycle', () => {
  it('startJobProgress creates a currentJob with null pageIndex (late-init)', () => {
    const s = exportReducer(
      undefined,
      startJobProgress({ jobId: 1, format: 'docx', totalPages: 10 }),
    );
    expect(s.currentJob).not.toBe(null);
    expect(s.currentJob?.jobId).toBe(1);
    expect(s.currentJob?.totalPages).toBe(10);
    // No sentinel zero — pageIndex starts null until first per-page event.
    expect(s.currentJob?.pageIndex).toBe(null);
    expect(s.currentJob?.phase).toBe('starting');
  });

  it('applyExportProgressEvent (extracting-text) updates pageIndex', () => {
    let s = exportReducer(
      undefined,
      startJobProgress({ jobId: 1, format: 'docx', totalPages: 10 }),
    );
    const evt: ExportProgressEvent = {
      jobId: 1,
      format: 'docx',
      phase: 'extracting-text',
      pageIndex: 3,
      totalPages: 10,
    };
    s = exportReducer(s, applyExportProgressEvent(evt));
    expect(s.currentJob?.pageIndex).toBe(3);
    expect(s.currentJob?.phase).toBe('extracting-text');
  });

  it('applyExportProgressEvent (writing-output) updates bytesWritten', () => {
    let s = exportReducer(
      undefined,
      startJobProgress({ jobId: 1, format: 'docx', totalPages: 10 }),
    );
    const evt: ExportProgressEvent = {
      jobId: 1,
      format: 'docx',
      phase: 'writing-output',
      bytesWritten: 4096,
      totalBytesEstimate: 8192,
    };
    s = exportReducer(s, applyExportProgressEvent(evt));
    expect(s.currentJob?.bytesWritten).toBe(4096);
    expect(s.currentJob?.phase).toBe('writing-output');
  });

  it('applyExportProgressEvent (completed) sets lastCompletedAtMs', () => {
    let s = exportReducer(
      undefined,
      startJobProgress({ jobId: 1, format: 'docx', totalPages: 10 }),
    );
    const summary = {
      jobId: 1,
      format: 'docx' as const,
      qualityTier: 'layout-preserving' as const,
      pageCount: 10,
      durationMs: 1000,
      outputBasename: 'my.docx',
      outputDirHint: 'Downloads',
      outputSizeBytes: 12345,
      contentStats: {
        paragraphsExtracted: 50,
        tablesDetected: 2,
        imagesEmbedded: 1,
      },
      perPageProgress: null,
    };
    const evt: ExportProgressEvent = {
      jobId: 1,
      format: 'docx',
      phase: 'completed',
      summary,
    };
    s = exportReducer(s, applyExportProgressEvent(evt));
    expect(s.lastCompletedAtMs).not.toBe(null);
    expect(s.currentJob?.phase).toBe('completed');
  });

  it('applyExportProgressEvent (failed) records errorMessage', () => {
    let s = exportReducer(
      undefined,
      startJobProgress({ jobId: 1, format: 'docx', totalPages: 10 }),
    );
    const evt: ExportProgressEvent = {
      jobId: 1,
      format: 'docx',
      phase: 'failed',
      pagesCompleted: 3,
      totalPages: 10,
      error: 'extraction_failed',
    };
    s = exportReducer(s, applyExportProgressEvent(evt));
    expect(s.currentJob?.phase).toBe('failed');
    expect(s.currentJob?.errorMessage).toBe('extraction_failed');
    expect(s.currentJob?.pagesCompleted).toBe(3);
  });

  it('applyExportProgressEvent (cancelled) records pagesCompleted', () => {
    let s = exportReducer(
      undefined,
      startJobProgress({ jobId: 1, format: 'docx', totalPages: 10 }),
    );
    const evt: ExportProgressEvent = {
      jobId: 1,
      format: 'docx',
      phase: 'cancelled',
      pagesCompleted: 4,
      totalPages: 10,
    };
    s = exportReducer(s, applyExportProgressEvent(evt));
    expect(s.currentJob?.phase).toBe('cancelled');
    expect(s.currentJob?.pagesCompleted).toBe(4);
  });

  it('applyExportProgressEvent drops stale-job events silently', () => {
    let s = exportReducer(
      undefined,
      startJobProgress({ jobId: 1, format: 'docx', totalPages: 10 }),
    );
    const evt: ExportProgressEvent = {
      jobId: 999, // different job
      format: 'docx',
      phase: 'extracting-text',
      pageIndex: 5,
      totalPages: 10,
    };
    const before = s.currentJob;
    s = exportReducer(s, applyExportProgressEvent(evt));
    expect(s.currentJob).toEqual(before);
  });

  it('clearCurrentJob nulls the in-flight job', () => {
    let s = exportReducer(
      undefined,
      startJobProgress({ jobId: 1, format: 'docx', totalPages: 10 }),
    );
    s = exportReducer(s, clearCurrentJob());
    expect(s.currentJob).toBe(null);
  });
});

describe('export-slice — recent jobs + errors', () => {
  it('setRecentJobs stores the DTO list', () => {
    const s = exportReducer(undefined, setRecentJobs([SAMPLE_JOB_DTO]));
    expect(s.recentJobs).toEqual([SAMPLE_JOB_DTO]);
  });

  it('setPhase6Error stores and clears the error', () => {
    let s = exportReducer(undefined, setPhase6Error('boom'));
    expect(s.phase6LastError).toBe('boom');
    s = exportReducer(s, setPhase6Error(null));
    expect(s.phase6LastError).toBe(null);
  });
});

describe('export-slice — Phase 1 actions still work', () => {
  it('Phase 1 setPreference updates preference', () => {
    const s = exportReducer(undefined, setPreference('chromium'));
    expect(s.preference).toBe('chromium');
  });

  it('Phase 1 setInFlight + setProgress + setLastEngine flow', () => {
    let s = exportReducer(undefined, setInFlight('j-1'));
    expect(s.inFlightJobId).toBe('j-1');
    s = exportReducer(
      s,
      setProgress({ jobId: 'j-1', phase: 'starting' } as Parameters<typeof setProgress>[0]),
    );
    expect(s.progress?.jobId).toBe('j-1');
    s = exportReducer(s, setLastEngine({ engine: 'pdf-lib', reason: 'fast', warnings: [] }));
    expect(s.lastEngineUsed).toBe('pdf-lib');
    s = exportReducer(s, setInFlight(null));
    expect(s.inFlightJobId).toBe(null);
    expect(s.progress).toBe(null);
  });
});
