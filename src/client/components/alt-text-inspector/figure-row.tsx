// Alt Text Inspector — single figure row.
// Phase 7.5 C5 (Riley Wave 5c). Per docs/ui-spec-phase-7.5.md §26.
//
// Per-figure row in the inspector modal. Renders the page number,
// optional similarity hint, a text input for the alt text draft, and an
// Apply button that dispatches `applyAltTextThunk` for this single
// figure. The row reads its draft from the parent (slice selector); the
// Apply button is disabled while the IPC is in flight.

import { useT } from '../../i18n/use-t';
import type { FigureWithoutAlt } from '../../types/alt-text-contract-stub';

import styles from './alt-text-inspector.module.css';

interface FigureRowProps {
  figure: FigureWithoutAlt;
  draft: string;
  applying: boolean;
  /** Click jumps the viewer to this figure's page. */
  onJumpToPage: (pageIndex: number) => void;
  onDraftChange: (value: string) => void;
  onApply: () => void;
}

export function FigureRow(props: FigureRowProps): JSX.Element {
  const { t } = useT();
  const ariaLabel = t('modals:accessibility.altText.rowAria', {
    page: props.figure.pageIndex + 1,
    id: props.figure.structNodeId,
  });
  return (
    <div className={styles.row} aria-label={ariaLabel}>
      <div className={styles.rowHeader}>
        <button
          type="button"
          className={styles.rowTitle}
          // Title doubles as the page-jump trigger; keep it a real button
          // for keyboard nav.
          onClick={() => props.onJumpToPage(props.figure.pageIndex)}
          // Make the row title button visually a link — borderless +
          // text-only — so it stops being a heavy CTA next to Apply.
          // eslint-disable-next-line react/forbid-dom-props
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            font: 'inherit',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--accent, #2563eb)',
          }}
        >
          {t('modals:accessibility.altText.figure', { page: props.figure.pageIndex + 1 })}
        </button>
        {props.figure.pHash !== undefined && props.figure.pHash !== '' && (
          <span className={styles.rowMeta}>pHash: {props.figure.pHash.slice(0, 8)}</span>
        )}
      </div>
      <input
        type="text"
        className={styles.rowInput}
        aria-label={t('modals:accessibility.altText.altLabel')}
        placeholder={t('modals:accessibility.altText.altPlaceholder')}
        value={props.draft}
        onChange={(e) => props.onDraftChange(e.target.value)}
      />
      <div className={styles.rowActions}>
        <button
          type="button"
          className={styles.applyButton}
          onClick={props.onApply}
          disabled={props.applying || props.draft.length === 0}
        >
          {props.applying
            ? t('modals:accessibility.altText.applying')
            : t('modals:accessibility.altText.apply')}
        </button>
      </div>
    </div>
  );
}
