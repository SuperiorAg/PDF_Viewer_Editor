// Document Properties — Description tab (Phase 7.5 B21, Riley Wave 5).
// Per docs/ui-spec-phase-7.5.md §21.1.
//
// Editable fields: title / author / subject / keywords.
// Read-only fields: creator / producer / created / modified / pages / page size.

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { updateDescription } from '../../state/slices/document-properties-slice';
import { selectCurrentDocument } from '../../state/slices/document-selectors';

import styles from './document-properties-modal.module.css';

function formatEpoch(ms: number | null, locale: string): string {
  if (ms === null) return '—';
  try {
    return new Date(ms).toLocaleString(locale);
  } catch {
    return new Date(ms).toISOString();
  }
}

function formatPageSize(widthPt: number | undefined, heightPt: number | undefined): string {
  if (widthPt === undefined || heightPt === undefined) return '—';
  const wIn = (widthPt / 72).toFixed(2);
  const hIn = (heightPt / 72).toFixed(2);
  return `${wIn} × ${hIn} in (${widthPt.toFixed(0)} × ${heightPt.toFixed(0)} pt)`;
}

export function DescriptionTab(): JSX.Element {
  const { t, locale } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const state = useAppSelector((s) => s.documentProperties);

  const loaded = state.loaded;
  const firstPageSize = loaded?.pageSizes?.[0];
  const pageCount = doc?.pageCount ?? 0;

  const noValue = t('modals:documentProperties.noValue');

  return (
    <div>
      <div className={styles.fieldGrid}>
        <label className={styles.label} htmlFor="dp-title">
          {t('modals:documentProperties.fields.title')}
        </label>
        <input
          id="dp-title"
          className={styles.input}
          type="text"
          value={state.description.title}
          onChange={(e) => dispatch(updateDescription({ title: e.target.value }))}
          disabled={state.loading || state.applying || loaded === null}
        />

        <label className={styles.label} htmlFor="dp-author">
          {t('modals:documentProperties.fields.author')}
        </label>
        <input
          id="dp-author"
          className={styles.input}
          type="text"
          value={state.description.author}
          onChange={(e) => dispatch(updateDescription({ author: e.target.value }))}
          disabled={state.loading || state.applying || loaded === null}
        />

        <label className={styles.label} htmlFor="dp-subject">
          {t('modals:documentProperties.fields.subject')}
        </label>
        <input
          id="dp-subject"
          className={styles.input}
          type="text"
          value={state.description.subject}
          onChange={(e) => dispatch(updateDescription({ subject: e.target.value }))}
          disabled={state.loading || state.applying || loaded === null}
        />

        <label className={styles.label} htmlFor="dp-keywords">
          {t('modals:documentProperties.fields.keywords')}
        </label>
        <input
          id="dp-keywords"
          className={styles.input}
          type="text"
          value={state.description.keywordsText}
          onChange={(e) => dispatch(updateDescription({ keywordsText: e.target.value }))}
          disabled={state.loading || state.applying || loaded === null}
          aria-describedby="dp-keywords-hint"
        />
      </div>
      <div id="dp-keywords-hint" className={styles.hint}>
        {t('modals:documentProperties.keywordsHint')}
      </div>

      <div className={styles.fieldGridReadonly}>
        <span className={styles.label}>{t('modals:documentProperties.fields.creator')}</span>
        <span className={styles.value}>{loaded?.properties.creator ?? noValue}</span>

        <span className={styles.label}>{t('modals:documentProperties.fields.producer')}</span>
        <span className={styles.value}>{loaded?.properties.producer ?? noValue}</span>

        <span className={styles.label}>{t('modals:documentProperties.fields.created')}</span>
        <span className={styles.value}>
          {formatEpoch(loaded?.properties.creationDate ?? null, locale)}
        </span>

        <span className={styles.label}>{t('modals:documentProperties.fields.modified')}</span>
        <span className={styles.value}>
          {formatEpoch(loaded?.properties.modificationDate ?? null, locale)}
        </span>

        <span className={styles.label}>{t('modals:documentProperties.fields.pages')}</span>
        <span className={styles.value}>{pageCount}</span>

        <span className={styles.label}>{t('modals:documentProperties.fields.pageSize')}</span>
        <span className={styles.value}>
          {formatPageSize(firstPageSize?.widthPt, firstPageSize?.heightPt)}
        </span>
      </div>
    </div>
  );
}
