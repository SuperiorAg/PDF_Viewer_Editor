// Mail Merge slice reducer tests.

import { describe, expect, it } from 'vitest';

import mailMergeReducer, {
  closeWizard,
  openWizard,
  progressTick,
  runCompleted,
  runFailed,
  runStarted,
  setColumnMapping,
  setDataPreview,
  setFlattenInOutput,
  setOutputMode,
  setStep,
  setTemplateSource,
  updateColumnMapping,
} from './mail-merge-slice';

const initial = mailMergeReducer(undefined, { type: '@@INIT' });

describe('mailMergeSlice — wizard navigation', () => {
  it('openWizard sets modalOpen=true and step=template', () => {
    const next = mailMergeReducer(initial, openWizard());
    expect(next.modalOpen).toBe(true);
    expect(next.step).toBe('template');
  });

  it('closeWizard sets modalOpen=false but preserves other state', () => {
    const opened = mailMergeReducer(initial, openWizard());
    const closed = mailMergeReducer(opened, closeWizard());
    expect(closed.modalOpen).toBe(false);
  });

  it('setStep advances the wizard step', () => {
    const next = mailMergeReducer(initial, setStep('output'));
    expect(next.step).toBe('output');
  });

  it('setTemplateSource accepts saved template choice', () => {
    const next = mailMergeReducer(
      initial,
      setTemplateSource({ kind: 'saved', templateId: 7, name: 'Contract' }),
    );
    expect(next.templateSource.kind).toBe('saved');
  });
});

describe('mailMergeSlice — data preview + mapping', () => {
  const seeded = mailMergeReducer(
    initial,
    setDataPreview({
      fileName: 'contacts.csv',
      fileKind: 'csv',
      bytes: new Uint8Array(0),
      headers: ['FirstName', 'LastName'],
      previewRows: [{ FirstName: 'Alice', LastName: 'Smith' }],
      totalRowCount: 100,
      warnings: [],
    }),
  );

  it('setDataPreview stores the preview', () => {
    expect(seeded.data?.totalRowCount).toBe(100);
    expect(seeded.data?.headers).toEqual(['FirstName', 'LastName']);
  });

  it('setDataPreview resets mapping on change', () => {
    const withMap = mailMergeReducer(seeded, setColumnMapping({ FirstName: 'first_name' }));
    const replaced = mailMergeReducer(
      withMap,
      setDataPreview({
        fileName: 'new.csv',
        fileKind: 'csv',
        bytes: new Uint8Array(0),
        headers: ['A', 'B'],
        previewRows: [],
        totalRowCount: 0,
        warnings: [],
      }),
    );
    expect(replaced.columnMapping).toEqual({});
  });

  it('updateColumnMapping sets a single column mapping', () => {
    const next = mailMergeReducer(
      seeded,
      updateColumnMapping({ column: 'FirstName', fieldName: 'first_name' }),
    );
    expect(next.columnMapping['FirstName']).toBe('first_name');
  });

  it('updateColumnMapping with empty/skip deletes the mapping', () => {
    const a = mailMergeReducer(
      seeded,
      updateColumnMapping({ column: 'FirstName', fieldName: 'first_name' }),
    );
    const b = mailMergeReducer(a, updateColumnMapping({ column: 'FirstName', fieldName: '' }));
    expect(b.columnMapping['FirstName']).toBeUndefined();
  });
});

describe('mailMergeSlice — output mode + flatten', () => {
  it('setOutputMode replaces the mode', () => {
    const next = mailMergeReducer(
      initial,
      setOutputMode({ kind: 'concat', outputFile: '/tmp/out.pdf' }),
    );
    expect(next.outputMode).toEqual({ kind: 'concat', outputFile: '/tmp/out.pdf' });
  });

  it('setFlattenInOutput toggles flag', () => {
    const next = mailMergeReducer(initial, setFlattenInOutput(true));
    expect(next.flattenInOutput).toBe(true);
  });
});

describe('mailMergeSlice — progress lifecycle', () => {
  it('runStarted seeds progress state', () => {
    const next = mailMergeReducer(initial, runStarted({ jobId: 'job-1' }));
    expect(next.activeJobId).toBe('job-1');
    expect(next.step).toBe('running');
    expect(next.progress.percent).toBe(0);
  });

  it('progressTick updates only for the active jobId', () => {
    const started = mailMergeReducer(initial, runStarted({ jobId: 'job-1' }));
    const tick = mailMergeReducer(
      started,
      progressTick({
        jobId: 'job-1',
        phase: 'rendering-row',
        currentRow: 5,
        totalRows: 100,
        percent: 5,
      }),
    );
    expect(tick.progress.currentRow).toBe(5);
    expect(tick.progress.percent).toBe(5);
  });

  it('progressTick ignores stale jobIds', () => {
    const started = mailMergeReducer(initial, runStarted({ jobId: 'job-1' }));
    const stale = mailMergeReducer(
      started,
      progressTick({
        jobId: 'job-OLD',
        phase: 'rendering-row',
        currentRow: 99,
        totalRows: 100,
        percent: 99,
      }),
    );
    // Unchanged.
    expect(stale.progress.currentRow).toBe(0);
  });

  it('progressTick appends latestWarning to warnings list', () => {
    const started = mailMergeReducer(initial, runStarted({ jobId: 'job-1' }));
    const warned = mailMergeReducer(
      started,
      progressTick({
        jobId: 'job-1',
        phase: 'rendering-row',
        currentRow: 1,
        totalRows: 10,
        percent: 10,
        latestWarning: 'Row 1: missing field',
      }),
    );
    expect(warned.progress.warnings).toContain('Row 1: missing field');
  });

  it('runCompleted records the result and clears activeJobId', () => {
    const started = mailMergeReducer(initial, runStarted({ jobId: 'job-1' }));
    const done = mailMergeReducer(
      started,
      runCompleted({
        rowsWritten: 10,
        totalRows: 10,
        outputPath: '/tmp/x.pdf',
        wasCancelled: false,
        warnings: [],
      }),
    );
    expect(done.activeJobId).toBeNull();
    expect(done.step).toBe('done');
    expect(done.result?.rowsWritten).toBe(10);
  });

  it('runFailed sets error step + clears jobId', () => {
    const started = mailMergeReducer(initial, runStarted({ jobId: 'job-1' }));
    const failed = mailMergeReducer(started, runFailed('Parse error'));
    expect(failed.step).toBe('error');
    expect(failed.errorMessage).toBe('Parse error');
    expect(failed.activeJobId).toBeNull();
  });
});
