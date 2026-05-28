// AnnotationSummaryPanel — Phase 4 sidebar tab listing all annotations.
// Per docs/ui-spec.md §13.7 + docs/architecture-phase-4.md §5.
//
// Lists every annotation on the open document by page + type, with click-to-
// scroll. Filters apply per-row; sort is per-group. Data flow:
//   - Reads document.current.annotations (Phase 1 annotation list) — no
//     mutation here; this panel is read-only.
//   - Phase 4 shape annotations (annot-add-shape EditOperation) accumulate
//     into the same annotations list via document-slice's applyEdit reducer.

import { useMemo } from 'react';

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  type AnnotationSummaryFilter,
  type AnnotationSummarySort,
  setSummaryFilter,
  setSummarySort,
} from '../../state/slices/signature-audit-slice';
import { type AnnotationModel } from '../../types/ipc-contract';

import styles from './annotation-summary-panel.module.css';

function iconFor(subtype: string): string {
  switch (subtype) {
    case 'Highlight':
      return 'H';
    case 'Text':
      return 'S';
    case 'FreeText':
      return 'T';
    case 'Square':
      return '◻';
    case 'Circle':
      return '◯';
    case 'Polygon':
      return '⬢';
    case 'PolyLine':
      return '∿';
    case 'Line':
      return '╱';
    case 'FreeTextCallout':
      return '💬';
    case 'Ink':
      return '✎';
    case 'Underline':
      return '_';
    case 'StrikeOut':
      return '⌐';
    default:
      return '•';
  }
}

// Note: David's AnnotationSubtype union uses 'Text' (popup sticky-note) per
// Phase 1; this maps to our 'sticky' filter button per the ui-spec §13.7
// nomenclature ('Sticky' is the user-facing label, 'Text' is the wire form).
function matchesFilter(a: AnnotationModel, f: AnnotationSummaryFilter): boolean {
  if (a.subtype === 'Highlight' && !f.highlight) return false;
  if (a.subtype === 'Text' && !f.sticky) return false;
  if ((a.subtype === 'FreeText' || a.subtype === 'FreeTextCallout') && !f.text) return false;
  if (
    (a.subtype === 'Square' ||
      a.subtype === 'Circle' ||
      a.subtype === 'Polygon' ||
      a.subtype === 'PolyLine' ||
      a.subtype === 'Line') &&
    !f.shape
  )
    return false;
  return true;
}

function sortKey(a: AnnotationModel, sort: AnnotationSummarySort): number | string {
  if (sort === 'page') return a.pageIndex;
  if (sort === 'created') return -a.createdAt;
  return a.author ?? '';
}

export function AnnotationSummaryPanel(): JSX.Element {
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const filter = useAppSelector((s) => s.signatureAudit.summaryFilter);
  const sort = useAppSelector((s) => s.signatureAudit.summarySort);

  const grouped = useMemo(() => {
    if (!doc) return new Map<number, AnnotationModel[]>();
    const filtered = doc.annotations.filter((a) => matchesFilter(a, filter));
    filtered.sort((a, b) => {
      const ka = sortKey(a, sort);
      const kb = sortKey(b, sort);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return 0;
    });
    const m = new Map<number, AnnotationModel[]>();
    for (const a of filtered) {
      const list = m.get(a.pageIndex) ?? [];
      list.push(a);
      m.set(a.pageIndex, list);
    }
    return m;
  }, [doc, filter, sort]);

  if (!doc) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>No document open.</div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <div className={styles.filterRow}>
          {(
            [
              { k: 'highlight', label: 'Highlight' },
              { k: 'sticky', label: 'Sticky' },
              { k: 'text', label: 'Text' },
              { k: 'shape', label: 'Shape' },
              { k: 'signature', label: 'Signature' },
            ] as const
          ).map((f) => (
            <label key={f.k}>
              <input
                type="checkbox"
                checked={filter[f.k]}
                onChange={(e) => dispatch(setSummaryFilter({ [f.k]: e.target.checked }))}
              />{' '}
              {f.label}
            </label>
          ))}
        </div>
        <label>
          Sort:{' '}
          <select
            value={sort}
            onChange={(e) => dispatch(setSummarySort(e.target.value as AnnotationSummarySort))}
          >
            <option value="page">Page (asc)</option>
            <option value="created">Created (newest)</option>
            <option value="author">Author</option>
          </select>
        </label>
      </div>
      <div className={styles.list}>
        {grouped.size === 0 ? (
          <div className={styles.empty}>
            No annotations match. Use the toolbar to create highlights, shapes, signatures, or
            callouts.
          </div>
        ) : (
          Array.from(grouped.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([page, items]) => (
              <div key={page} className={styles.pageGroup}>
                <div className={styles.pageHeader}>Page {page + 1}</div>
                {items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={styles.row}
                    aria-label={`${a.subtype} on page ${page + 1}`}
                    title={a.contents ?? a.subtype}
                  >
                    <span className={styles.icon} aria-hidden="true">
                      {iconFor(a.subtype)}
                    </span>
                    <span className={styles.text}>
                      {a.subtype}
                      {a.contents ? ` — ${a.contents.slice(0, 50)}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            ))
        )}
      </div>
    </div>
  );
}
