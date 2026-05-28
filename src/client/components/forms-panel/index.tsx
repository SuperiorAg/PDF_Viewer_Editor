// FormsPanel — Phase 3 sidebar tab content.
// Per docs/ui-spec.md §12.3.
//
// Renders the detection-status banner, the field tree (grouped by page),
// the templates dropdown + "Save as template" button, and the
// "Commit form values" affordance when uncommitted edits exist.

import { useEffect, useMemo, useState } from 'react';

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  deepEqualValue,
  selectFormCommittedValues,
  selectFormDetectionStatus,
  selectFormFields,
  selectFormValues,
  selectFormWarnings,
  selectHasJavaScriptActions,
  selectHasUncommittedValues,
  selectHasXfaForm,
} from '../../state/slices/forms-selectors';
import {
  discardUncommitted,
  setSelectedField,
  toggleDesignerMode,
} from '../../state/slices/forms-slice';
import { selectFormsTemplates } from '../../state/slices/forms-templates-selectors';
import { openModal } from '../../state/slices/ui-slice';
import {
  commitFormThunk,
  detectFormsThunk,
  listFormTemplatesThunk,
  loadFormTemplateThunk,
} from '../../state/thunks';
import { type FormFieldDefinition } from '../../types/ipc-contract';

import styles from './forms-panel.module.css';

function fieldTypeBadge(t: FormFieldDefinition['type']): string {
  return `[${t}]`;
}

export function FormsPanel(): JSX.Element {
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const fields = useAppSelector(selectFormFields);
  const detectionStatus = useAppSelector(selectFormDetectionStatus);
  const values = useAppSelector(selectFormValues);
  const committedValues = useAppSelector(selectFormCommittedValues);
  const hasUncommitted = useAppSelector(selectHasUncommittedValues);
  const hasXfa = useAppSelector(selectHasXfaForm);
  const hasJs = useAppSelector(selectHasJavaScriptActions);
  const detectWarnings = useAppSelector(selectFormWarnings);
  const templates = useAppSelector(selectFormsTemplates);

  const [expandedPages, setExpandedPages] = useState<Record<number, boolean>>({});
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Load templates list once the panel opens. Cheap; cached in slice.
  useEffect(() => {
    void dispatch(listFormTemplatesThunk());
  }, [dispatch]);

  // Group fields by pageIndex.
  const fieldsByPage = useMemo(() => {
    const out: Map<number, FormFieldDefinition[]> = new Map();
    for (const f of fields) {
      const arr = out.get(f.pageIndex) ?? [];
      arr.push(f);
      out.set(f.pageIndex, arr);
    }
    return out;
  }, [fields]);

  const uncommittedCount = useMemo(() => {
    let n = 0;
    for (const [name, value] of Object.entries(values)) {
      if (!deepEqualValue(value, committedValues[name])) n++;
    }
    return n;
  }, [values, committedValues]);

  if (!doc) {
    return (
      <div className={styles.panel}>
        <p className={styles.placeholder}>Open a document to view forms.</p>
      </div>
    );
  }

  const banner = renderBanner({
    detectionStatus,
    fieldCount: fields.length,
    hasXfa,
    hasJs,
    detectWarnings,
    onRetry: () => void dispatch(detectFormsThunk()),
  });

  const onSelectField = (name: string): void => {
    dispatch(setSelectedField(name));
  };

  const onSaveTemplate = (): void => {
    dispatch(openModal('save-template'));
  };

  const onApplyTemplate = (templateId: number, name: string): void => {
    if (
      typeof window !== 'undefined' &&
      // eslint-disable-next-line no-alert -- minimal confirm UX in Phase 3; Phase 3.1 may modal it
      !window.confirm(`Apply template "${name}"? This will add fields to the current document.`)
    ) {
      return;
    }
    void dispatch(loadFormTemplateThunk({ templateId }));
    setTemplatesOpen(false);
  };

  return (
    <div className={styles.panel}>
      {banner}

      {hasUncommitted && (
        <div className={styles.commitBanner} role="status">
          <span>
            You have {uncommittedCount} unsaved field {uncommittedCount === 1 ? 'value' : 'values'}.
          </span>
          <span className={styles.commitActions}>
            <button
              type="button"
              className={styles.commitButton}
              onClick={() => void dispatch(commitFormThunk())}
            >
              Commit
            </button>
            <button
              type="button"
              className={styles.discardButton}
              onClick={() => dispatch(discardUncommitted())}
            >
              Discard
            </button>
          </span>
        </div>
      )}

      {fields.length === 0 && detectionStatus !== 'detecting' && (
        <p className={styles.placeholder}>
          {detectionStatus === 'none'
            ? 'No fillable form fields detected. Switch to Form Designer to add some.'
            : 'No fields yet.'}
        </p>
      )}

      <ul className={styles.fieldTree} aria-label="Form fields">
        {Array.from(fieldsByPage.entries())
          .sort(([a], [b]) => a - b)
          .map(([pageIdx, list]) => {
            const expanded: boolean = expandedPages[pageIdx] !== false; // default open
            return (
              <li key={pageIdx} className={styles.pageGroup}>
                <button
                  type="button"
                  className={styles.pageHeader}
                  aria-expanded={expanded ? 'true' : 'false'}
                  onClick={() =>
                    setExpandedPages((p) => ({ ...p, [pageIdx]: !(p[pageIdx] !== false) }))
                  }
                >
                  <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> Page {pageIdx + 1}
                  <span className={styles.pageCount}>({list.length})</span>
                </button>
                {expanded && (
                  <ul className={styles.fieldList}>
                    {list.map((f) => {
                      const dirty: boolean = !deepEqualValue(
                        values[f.name],
                        committedValues[f.name],
                      );
                      return (
                        <li key={f.name}>
                          <button
                            type="button"
                            className={styles.fieldRow}
                            onClick={() => onSelectField(f.name)}
                          >
                            <span className={styles.fieldName}>
                              {f.label || f.name}
                              {f.required && (
                                <span aria-label="required" className={styles.required}>
                                  *
                                </span>
                              )}
                            </span>
                            <span className={styles.fieldType}>{fieldTypeBadge(f.type)}</span>
                            {dirty && (
                              <span
                                aria-label="uncommitted"
                                className={styles.dirtyDot}
                                title="Uncommitted edit"
                              />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
      </ul>

      <div className={styles.bottomBar}>
        <div className={styles.templatesGroup}>
          <button
            type="button"
            className={styles.templateToggle}
            onClick={() => setTemplatesOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={templatesOpen ? 'true' : 'false'}
          >
            Templates ▾
          </button>
          {templatesOpen && (
            // role="menu" + <ul> children violates the jsx-a11y constraint that
            // menu role requires menuitem children. Use no role (plain dropdown);
            // the popup affordance is still announced via aria-haspopup on the
            // toggle. Phase 7 a11y audit will revisit with a fully typed menu pattern.
            <div className={styles.templatesDropdown}>
              {templates.length === 0 ? (
                <p className={styles.templatesEmpty}>No saved templates.</p>
              ) : (
                <ul>
                  {templates.slice(0, 10).map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className={styles.templateItem}
                        onClick={() => onApplyTemplate(t.id, t.name)}
                      >
                        <span className={styles.templateName}>{t.name}</span>
                        <span className={styles.templateCount}>{t.fieldCount} fields</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.designerToggle}
          onClick={() => dispatch(toggleDesignerMode())}
        >
          Form Designer
        </button>
        <button
          type="button"
          className={styles.saveTemplateButton}
          onClick={onSaveTemplate}
          disabled={!fields.some((f) => f.origin === 'authored')}
          title={
            fields.some((f) => f.origin === 'authored')
              ? 'Save these fields as a reusable template'
              : 'Author at least one field before saving as template'
          }
        >
          Save as template…
        </button>
      </div>
    </div>
  );
}

function renderBanner(args: {
  detectionStatus: ReturnType<typeof selectFormDetectionStatus>;
  fieldCount: number;
  hasXfa: boolean;
  hasJs: boolean;
  detectWarnings: string[];
  onRetry: () => void;
}): JSX.Element {
  if (args.detectionStatus === 'detecting') {
    return (
      <div className={styles.banner} aria-live="polite">
        Detecting forms…
      </div>
    );
  }
  if (args.detectionStatus === 'error') {
    return (
      <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
        Couldn&apos;t detect forms in this document.
        <button type="button" className={styles.retryButton} onClick={args.onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (args.detectionStatus === 'none') {
    return (
      <div className={styles.banner}>No fillable form fields. Use Form Designer to add some.</div>
    );
  }
  if (args.detectionStatus === 'present') {
    return (
      <div className={styles.banner}>
        <div>AcroForm detected: {args.fieldCount} fields</div>
        {args.hasJs && (
          <div className={styles.bannerWarning}>⚠ JavaScript actions stripped on save</div>
        )}
        {args.hasXfa && <div className={styles.bannerWarning}>⚠ XFA payload (read-only)</div>}
        {args.detectWarnings.slice(0, 2).map((w, i) => (
          <div key={i} className={styles.bannerWarning}>
            ⚠ {w}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.banner}>
      <button type="button" className={styles.retryButton} onClick={args.onRetry}>
        Detect forms
      </button>
    </div>
  );
}
