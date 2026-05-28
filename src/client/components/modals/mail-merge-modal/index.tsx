// MailMergeModal — Phase 3 4-step wizard.
// Per docs/ui-spec.md §12.6.
//
// Steps: template -> data -> mapping -> output -> running -> done|error.
// State lives in mailMergeSlice; the modal is a thin renderer over that state.
//
// The runner BYPASSES dirtyOps (conventions §14.4) — runMailMergeThunk just
// fires the IPC + listens for progress events.

import { useEffect, useRef } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectCurrentDocument } from '../../../state/slices/document-selectors';
import { selectFormFields } from '../../../state/slices/forms-selectors';
import { selectFormsTemplates } from '../../../state/slices/forms-templates-selectors';
import {
  selectMailMergeData,
  selectMailMergeFlatten,
  selectMailMergeMapping,
  selectMailMergeOutputMode,
  selectMailMergeProgress,
  selectMailMergeResult,
  selectMailMergeError,
  selectMailMergeStep,
  selectMailMergeTemplateSource,
  selectMailMergeActiveJobId,
} from '../../../state/slices/mail-merge-selectors';
import {
  closeWizard,
  setColumnMapping,
  setFlattenInOutput,
  setOutputMode,
  setStep,
  setTemplateSource,
  updateColumnMapping,
} from '../../../state/slices/mail-merge-slice';
import {
  cancelMailMergeThunk,
  listFormTemplatesThunk,
  parseDataSourceThunk,
  runMailMergeThunk,
} from '../../../state/thunks';
import { type FormFieldDefinition, type MailMergeJob } from '../../../types/ipc-contract';
import { ModalShell } from '../modal-shell';

import styles from './mail-merge-modal.module.css';

const STEP_LABEL_KEYS: Record<string, string> = {
  template: 'modals:mailMerge.templateStep',
  data: 'modals:mailMerge.dataStep',
  mapping: 'modals:mailMerge.mapStep',
  output: 'modals:mailMerge.outputStep',
};

export function MailMergeModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const step = useAppSelector(selectMailMergeStep);
  const fields = useAppSelector(selectFormFields);

  const onClose = (): void => {
    dispatch(closeWizard());
  };

  // Preload templates on open.
  useEffect(() => {
    void dispatch(listFormTemplatesThunk());
  }, [dispatch]);

  const body =
    step === 'template' ? (
      <Step1Template />
    ) : step === 'data' ? (
      <Step2Data />
    ) : step === 'mapping' ? (
      <Step3Mapping fields={fields} />
    ) : step === 'output' ? (
      <Step4Output />
    ) : step === 'running' ? (
      <RunningView />
    ) : step === 'done' ? (
      <DoneView />
    ) : (
      <ErrorView />
    );

  return (
    <ModalShell title={t('modals:mailMerge.title')} onClose={onClose} size="lg" footer={<WizardFooter />}>
      {step !== 'running' && step !== 'done' && step !== 'error' && <StepIndicator step={step} />}
      <div className={styles.body}>{body}</div>
    </ModalShell>
  );
}

function StepIndicator({ step }: { step: string }): JSX.Element {
  const { t } = useT();
  const order = ['template', 'data', 'mapping', 'output'];
  const idx = order.indexOf(step);
  return (
    <ol className={styles.stepIndicator} aria-label={t('modals:mailMerge.stepsLabel')}>
      {order.map((s, i) => (
        <li
          key={s}
          className={`${styles.step} ${i < idx ? styles.stepDone : ''} ${i === idx ? styles.stepActive : ''}`}
        >
          {t(STEP_LABEL_KEYS[s] ?? '')}
        </li>
      ))}
    </ol>
  );
}

function WizardFooter(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const step = useAppSelector(selectMailMergeStep);
  const data = useAppSelector(selectMailMergeData);
  const fields = useAppSelector(selectFormFields);
  const mapping = useAppSelector(selectMailMergeMapping);
  const outputMode = useAppSelector(selectMailMergeOutputMode);
  const flatten = useAppSelector(selectMailMergeFlatten);
  const doc = useAppSelector(selectCurrentDocument);
  const templateSource = useAppSelector(selectMailMergeTemplateSource);
  const activeJobId = useAppSelector(selectMailMergeActiveJobId);

  const order = ['template', 'data', 'mapping', 'output'];
  const idx = order.indexOf(step);

  const onBack = (): void => {
    if (idx > 0) {
      const prev = order[idx - 1];
      if (prev) dispatch(setStep(prev as 'template' | 'data' | 'mapping' | 'output'));
    }
  };

  const onNext = (): void => {
    if (step === 'template') dispatch(setStep('data'));
    else if (step === 'data') dispatch(setStep('mapping'));
    else if (step === 'mapping') dispatch(setStep('output'));
    else if (step === 'output') {
      // RUN
      if (!doc || !data) return;
      const jobId = `mm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Wave 13.5 H-3.2: David's contract amendment added `flattenForms?: boolean`
      // to MailMergeJob (src/ipc/contracts.ts, api-contracts §13.9 Phase 3.1
      // banner). Plumb the slice value directly onto the job — runner honors it
      // per-job (form-engine.fillForm flatten option). Prior void-discard closed.
      const dataSource =
        data.fileKind === 'csv'
          ? ({ kind: 'csv', bytes: data.bytes ?? new Uint8Array(0) } as const)
          : ({ kind: 'xlsx', bytes: data.bytes ?? new Uint8Array(0) } as const);
      const job: MailMergeJob = {
        jobId,
        templateHandle: templateSource.kind === 'current' ? doc.handle : null,
        templateId: templateSource.kind === 'saved' ? templateSource.templateId : null,
        dataSource,
        columnMapping: mapping,
        outputMode,
        fields,
        flattenForms: flatten,
      };
      void dispatch(runMailMergeThunk({ job }));
    }
  };

  const onCancel = (): void => {
    if (activeJobId) {
      void dispatch(cancelMailMergeThunk({ jobId: activeJobId }));
    } else {
      dispatch(closeWizard());
    }
  };

  const nextDisabled = nextDisabledFor(step, {
    hasData: data !== null,
    mapping,
    fields,
    outputMode,
  });

  if (step === 'running' || step === 'done' || step === 'error') {
    return (
      <div className={styles.footer}>
        {step === 'running' ? (
          <button type="button" onClick={onCancel} className={styles.cancelButton}>
            {t('modals:mailMerge.cancelButton')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => dispatch(closeWizard())}
            className={styles.cancelButton}
          >
            {t('modals:mailMerge.close')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.footer}>
      <button type="button" onClick={onBack} disabled={idx === 0} className={styles.backButton}>
        {t('modals:mailMerge.back')}
      </button>
      <button type="button" onClick={onCancel} className={styles.cancelButton}>
        {t('modals:mailMerge.cancelButton')}
      </button>
      <button type="button" onClick={onNext} disabled={nextDisabled} className={styles.nextButton}>
        {step === 'output' ? t('modals:mailMerge.runButton') : t('modals:mailMerge.next')}
      </button>
    </div>
  );
}

function nextDisabledFor(
  step: string,
  ctx: {
    hasData: boolean;
    mapping: Record<string, string>;
    fields: FormFieldDefinition[];
    outputMode: ReturnType<typeof selectMailMergeOutputMode>;
  },
): boolean {
  if (step === 'data') return !ctx.hasData;
  if (step === 'mapping') {
    // Block Next if any required field has no mapping.
    const mapped = new Set(Object.values(ctx.mapping));
    return ctx.fields.some((f) => f.required && !mapped.has(f.name));
  }
  if (step === 'output') {
    if (ctx.outputMode.kind === 'folder')
      return !ctx.outputMode.outputFolder || !ctx.outputMode.filenameTemplate;
    return !ctx.outputMode.outputFile;
  }
  return false;
}

function Step1Template(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const fields = useAppSelector(selectFormFields);
  const templateSource = useAppSelector(selectMailMergeTemplateSource);
  const templates = useAppSelector(selectFormsTemplates);

  return (
    <div className={styles.step}>
      <h3>{t('modals:mailMerge.chooseTemplate')}</h3>
      <div>
        <label className={styles.radioRow}>
          <input
            type="radio"
            checked={templateSource.kind === 'current'}
            onChange={() => dispatch(setTemplateSource({ kind: 'current' }))}
          />
          {t('modals:mailMerge.useCurrentDoc', { count: fields.length })}
        </label>
        <label className={styles.radioRow}>
          <input
            type="radio"
            checked={templateSource.kind === 'saved'}
            onChange={() => {
              const first = templates[0];
              if (first) {
                dispatch(
                  setTemplateSource({ kind: 'saved', templateId: first.id, name: first.name }),
                );
              }
            }}
            disabled={templates.length === 0}
          />
          {t('modals:mailMerge.savedTemplate')}
        </label>
        {templateSource.kind === 'saved' && (
          <select
            className={styles.templateDropdown}
            aria-label={t('modals:mailMerge.savedTemplateLabel')}
            value={templateSource.templateId}
            onChange={(e) => {
              const id = Number(e.currentTarget.value);
              const tpl = templates.find((x) => x.id === id);
              if (tpl) {
                dispatch(setTemplateSource({ kind: 'saved', templateId: tpl.id, name: tpl.name }));
              }
            }}
          >
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {t('modals:mailMerge.templateFieldCount', {
                  name: tpl.name,
                  count: tpl.fieldCount,
                })}
              </option>
            ))}
          </select>
        )}
      </div>
      {fields.length > 0 && templateSource.kind === 'current' && (
        <div className={styles.preview}>
          <h4>{t('modals:mailMerge.previewFields', { count: fields.length })}</h4>
          <ul>
            {fields.slice(0, 5).map((f) => (
              <li key={f.name}>
                {t('modals:mailMerge.fieldBullet', { label: f.label || f.name, type: f.type })}
              </li>
            ))}
            {fields.length > 5 && (
              <li>{t('modals:mailMerge.moreFields', { count: fields.length - 5 })}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Step2Data(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const data = useAppSelector(selectMailMergeData);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File): Promise<void> => {
    const lower = file.name.toLowerCase();
    const kind: 'csv' | 'xlsx' = lower.endsWith('.csv') ? 'csv' : 'xlsx';
    const ab = await file.arrayBuffer();
    const bytes = new Uint8Array(ab);
    void dispatch(parseDataSourceThunk({ bytes, fileName: file.name, fileKind: kind }));
  };

  return (
    <div className={styles.step}>
      <h3>{t('modals:mailMerge.chooseDataFile')}</h3>
      <div className={styles.dataPicker}>
        <button
          type="button"
          className={styles.chooseButton}
          onClick={() => inputRef.current?.click()}
        >
          {t('modals:mailMerge.chooseFile')}
        </button>
        {data && (
          <span className={styles.dataFile}>
            {t('modals:mailMerge.dataFileSummary', {
              name: data.fileName,
              count: data.totalRowCount,
            })}
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          aria-label={t('modals:mailMerge.chooseDataFileLabel')}
          className={styles.hiddenFileInput}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </div>
      {data && (
        <div className={styles.preview}>
          <h4>{t('modals:mailMerge.previewFirstRows', { count: data.previewRows.length })}</h4>
          <table className={styles.previewTable}>
            <thead>
              <tr>
                {data.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.previewRows.map((row, i) => (
                <tr key={i}>
                  {data.headers.map((h) => (
                    <td key={h}>{row[h] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data.warnings.length > 0 && (
            <ul className={styles.previewWarnings}>
              {data.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Step3Mapping({ fields }: { fields: FormFieldDefinition[] }): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const data = useAppSelector(selectMailMergeData);
  const mapping = useAppSelector(selectMailMergeMapping);

  // Auto-detect on first render of step 3, only when mapping is empty.
  useEffect(() => {
    if (!data || Object.keys(mapping).length > 0) return;
    const detected: Record<string, string> = {};
    const fieldNamesByLower = new Map<string, string>(
      fields.map((f) => [f.name.toLowerCase(), f.name]),
    );
    for (const col of data.headers) {
      const matched = fieldNamesByLower.get(col.toLowerCase());
      if (matched) detected[col] = matched;
    }
    if (Object.keys(detected).length > 0) dispatch(setColumnMapping(detected));
  }, [data, fields, mapping, dispatch]);

  if (!data) return <p>{t('modals:mailMerge.noDataLoaded')}</p>;

  const mappedFieldNames = new Set(Object.values(mapping));
  const unmappedRequired = fields.filter((f) => f.required && !mappedFieldNames.has(f.name));

  return (
    <div className={styles.step}>
      <h3>{t('modals:mailMerge.mapColumns')}</h3>
      {unmappedRequired.length > 0 && (
        <div className={styles.mappingError}>
          ⚠{' '}
          {t('modals:mailMerge.requiredUnmapped', {
            count: unmappedRequired.length,
            names: unmappedRequired.map((f) => f.label || f.name).join(', '),
          })}
        </div>
      )}
      <table className={styles.mappingTable}>
        <thead>
          <tr>
            <th>{t('modals:mailMerge.columnHeader')}</th>
            <th aria-hidden="true">→</th>
            <th>{t('modals:mailMerge.fieldHeader')}</th>
          </tr>
        </thead>
        <tbody>
          {data.headers.map((col) => {
            const current = mapping[col] ?? '';
            return (
              <tr key={col}>
                <td>{col}</td>
                <td>→</td>
                <td>
                  <select
                    value={current}
                    aria-label={t('modals:mailMerge.mapColumnLabel', { column: col })}
                    onChange={(e) =>
                      dispatch(
                        updateColumnMapping({
                          column: col,
                          fieldName: e.currentTarget.value,
                        }),
                      )
                    }
                  >
                    <option value="">{t('modals:mailMerge.skipOption')}</option>
                    {fields.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.required
                          ? t('modals:mailMerge.fieldOptionRequired', {
                              label: f.label || f.name,
                              type: f.type,
                            })
                          : t('modals:mailMerge.fieldOption', {
                              label: f.label || f.name,
                              type: f.type,
                            })}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Step4Output(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const outputMode = useAppSelector(selectMailMergeOutputMode);
  const flatten = useAppSelector(selectMailMergeFlatten);

  return (
    <div className={styles.step}>
      <h3>{t('modals:mailMerge.output')}</h3>
      <label className={styles.radioRow}>
        <input
          type="radio"
          checked={outputMode.kind === 'folder'}
          onChange={() =>
            dispatch(
              setOutputMode({
                kind: 'folder',
                outputFolder: outputMode.kind === 'folder' ? outputMode.outputFolder : '',
                filenameTemplate: 'merged-{rowIndex:04}.pdf',
              }),
            )
          }
        />
        {t('modals:mailMerge.folderOfPdfs')}
      </label>
      {outputMode.kind === 'folder' && (
        <div className={styles.subOptions}>
          <input
            type="text"
            value={outputMode.outputFolder}
            placeholder={t('modals:mailMerge.outputFolderPlaceholder')}
            onChange={(e) =>
              dispatch(
                setOutputMode({
                  ...outputMode,
                  outputFolder: e.currentTarget.value,
                }),
              )
            }
          />
          <input
            type="text"
            value={outputMode.filenameTemplate}
            placeholder={t('modals:mailMerge.filenameTemplatePlaceholder')}
            onChange={(e) =>
              dispatch(
                setOutputMode({
                  ...outputMode,
                  filenameTemplate: e.currentTarget.value,
                }),
              )
            }
          />
          <p className={styles.hint}>{t('modals:mailMerge.tokenHint')}</p>
        </div>
      )}
      <label className={styles.radioRow}>
        <input
          type="radio"
          checked={outputMode.kind === 'concat'}
          onChange={() =>
            dispatch(
              setOutputMode({
                kind: 'concat',
                outputFile: outputMode.kind === 'concat' ? outputMode.outputFile : '',
              }),
            )
          }
        />
        {t('modals:mailMerge.singleConcatPdf')}
      </label>
      {outputMode.kind === 'concat' && (
        <div className={styles.subOptions}>
          <input
            type="text"
            value={outputMode.outputFile}
            placeholder={t('modals:mailMerge.outputFilePlaceholder')}
            onChange={(e) =>
              dispatch(setOutputMode({ ...outputMode, outputFile: e.currentTarget.value }))
            }
          />
        </div>
      )}
      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={flatten}
          onChange={(e) => dispatch(setFlattenInOutput(e.currentTarget.checked))}
        />
        {t('modals:mailMerge.flattenForms')}
      </label>
    </div>
  );
}

function RunningView(): JSX.Element {
  const { t } = useT();
  const progress = useAppSelector(selectMailMergeProgress);
  return (
    <div className={styles.step}>
      <h3>{t('modals:mailMerge.running')}</h3>
      <p>
        {progress.totalRows >= 0
          ? t('modals:mailMerge.processingRow', {
              current: progress.currentRow,
              total: progress.totalRows,
            })
          : t('modals:mailMerge.processingRowUnknown', { current: progress.currentRow })}
      </p>
      {/*
        Progress bar is presentational; the "Processing row N of M" text above
        announces progress to screen readers via aria-live="polite" on the
        running modal. role="progressbar" with dynamic numeric aria-valuenow
        trips jsx-a11y/aria-proptypes (same Phase 1 sidebar pattern) so we
        keep ARIA semantics minimal here. Phase 7 a11y audit will revisit.
       */}
      <div className={styles.progressBar} aria-hidden="true">
        <div
          className={styles.progressFill}
          // Inline style is load-bearing here — `width` varies per-render with
          // the percent value, which can't be expressed in a CSS module file.
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <p className={styles.phaseLabel}>
        {t('modals:mailMerge.phasePrefix', { phase: progress.phase })}
      </p>
      {progress.warnings.length > 0 && (
        <details>
          <summary>
            {t('modals:mailMerge.recentWarnings', { count: progress.warnings.length })}
          </summary>
          <ul>
            {progress.warnings.slice(-5).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function DoneView(): JSX.Element {
  const { t } = useT();
  const result = useAppSelector(selectMailMergeResult);
  if (!result) return <p>{t('modals:mailMerge.done')}</p>;
  return (
    <div className={styles.step}>
      <h3>{result.wasCancelled ? t('modals:mailMerge.cancelled') : t('modals:mailMerge.complete')}</h3>
      <p>
        {t('modals:mailMerge.rowsWritten', {
          written: result.rowsWritten,
          total: result.totalRows,
        })}
      </p>
      {result.outputPath && <p className={styles.outputPath}>{result.outputPath}</p>}
      {result.warnings.length > 0 && (
        <details>
          <summary>{t('modals:mailMerge.warnings', { count: result.warnings.length })}</summary>
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ErrorView(): JSX.Element {
  const { t } = useT();
  const err = useAppSelector(selectMailMergeError);
  return (
    <div className={styles.step}>
      <h3>{t('modals:mailMerge.errorTitle')}</h3>
      <p>{err}</p>
    </div>
  );
}
