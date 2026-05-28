import { useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { selectCurrentPage } from '../../state/slices/viewport-selectors';
import type { SourcePageRef } from '../../types/ipc-contract';

import styles from './page-metadata.module.css';

export function PageMetadata(): JSX.Element | null {
  const doc = useAppSelector(selectCurrentDocument);
  const pageIndex = useAppSelector(selectCurrentPage);
  if (!doc) return null;
  const page = doc.pages[pageIndex];
  if (!page) return null;

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>Page {pageIndex + 1}</h3>
      <dl className={styles.dl}>
        <dt>Dimensions</dt>
        <dd>
          {fmt(page.width)} x {fmt(page.height)} pts ({(page.width / 72).toFixed(2)} x{' '}
          {(page.height / 72).toFixed(2)} in)
        </dd>
        <dt>Rotation</dt>
        <dd>{page.rotation}°</dd>
        <dt>Source</dt>
        <dd>{describeSource(page.sourcePageRef)}</dd>
      </dl>
      <hr className={styles.divider} />
      <h3 className={styles.heading}>Document</h3>
      <dl className={styles.dl}>
        <dt>Name</dt>
        <dd className={styles.ellipsis} title={doc.displayName}>
          {doc.displayName}
        </dd>
        <dt>Pages</dt>
        <dd>{doc.pageCount}</dd>
        <dt>Hash</dt>
        <dd>
          <code>{doc.fileHash.slice(0, 8) || '—'}</code>
        </dd>
        <dt>Annotations</dt>
        <dd>{doc.annotations.length}</dd>
        <dt>Modified</dt>
        <dd>{doc.dirtyOps.length > 0 ? 'Yes' : 'No'}</dd>
      </dl>
    </div>
  );
}

function fmt(n: number): string {
  return n.toFixed(1);
}

function describeSource(s: SourcePageRef): string {
  if (s.kind === 'blank') return 'Blank (inserted)';
  if (s.kind === 'original') return `Original page ${s.originalIndex + 1}`;
  if (s.kind === 'inserted') return `Inserted from another PDF (p.${s.sourcePageIndex + 1})`;
  // Phase 2 (data-models §7.1.2): image-as-page source.
  return `Image (${s.image.width}×${s.image.height})`;
}
