import { useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectCurrentDocument } from '../../../state/slices/document-selectors';
import { closeModal } from '../../../state/slices/ui-slice';
import { combinePdfsThunk } from '../../../state/thunks';
import { type PdfCombineSource } from '../../../types/ipc-contract';
import { ModalShell } from '../modal-shell';

import styles from './combine-modal.module.css';

interface Entry {
  id: string;
  source: PdfCombineSource;
  /** A display name (e.g. file name); rendered with the t()-keyed suffixes. */
  label: string;
  /** True when this is the currently-open document. */
  isCurrent?: boolean;
  /** True when this is an unresolved placeholder picker row. */
  isPlaceholder?: boolean;
}

export function CombineModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const currentDoc = useAppSelector(selectCurrentDocument);
  const [entries, setEntries] = useState<Entry[]>(() => {
    if (currentDoc) {
      return [
        {
          id: 'current',
          source: { kind: 'handle', handle: currentDoc.handle },
          label: currentDoc.displayName,
          isCurrent: true,
        },
      ];
    }
    return [];
  });

  // Render-time label resolution so the suffix is localized + reacts to switch.
  const displayLabel = (e: Entry): string =>
    e.isPlaceholder
      ? t('modals:combine.pickPlaceholder')
      : e.isCurrent
        ? t('modals:combine.currentlyOpenSuffix', { name: e.label })
        : e.label;

  const addFromPicker = (): void => {
    // Phase 1: a path picker is normally David's responsibility, but he doesn't
    // expose a separate channel for "pick a file without reading it" — combine
    // takes paths or handles. For Phase 1 we surface a Coming-Soon placeholder
    // here. Phase 2 wires an `app:pickPdfPath` IPC.
    const fakeId = `pick-${Date.now()}`;
    setEntries((curr) => [
      ...curr,
      {
        id: fakeId,
        source: { kind: 'path', path: '' },
        label: '',
        isPlaceholder: true,
      },
    ]);
  };

  const removeEntry = (id: string): void => {
    setEntries((curr) => curr.filter((e) => e.id !== id));
  };

  const moveUp = (idx: number): void => {
    setEntries((curr) => {
      if (idx <= 0) return curr;
      const next = [...curr];
      const removed = next.splice(idx, 1)[0];
      if (removed) next.splice(idx - 1, 0, removed);
      return next;
    });
  };

  const moveDown = (idx: number): void => {
    setEntries((curr) => {
      if (idx >= curr.length - 1) return curr;
      const next = [...curr];
      const removed = next.splice(idx, 1)[0];
      if (removed) next.splice(idx + 1, 0, removed);
      return next;
    });
  };

  const close = (): void => {
    dispatch(closeModal());
  };

  const submit = async (): Promise<void> => {
    const sources = entries.map((e) => e.source);
    await dispatch(combinePdfsThunk(sources));
    close();
  };

  return (
    <ModalShell
      title={t('modals:combine.title')}
      onClose={close}
      size="lg"
      footer={
        <>
          <button type="button" className={styles.secondary} onClick={close}>
            {t('common:cancel')}
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void submit()}
            disabled={entries.length < 2}
          >
            {t('modals:combine.combineButton')}
          </button>
        </>
      }
    >
      <div className={styles.actions}>
        <button type="button" className={styles.actionButton} onClick={addFromPicker}>
          {t('modals:combine.addFiles')}
        </button>
        {currentDoc && !entries.find((e) => e.id === 'current') && (
          <button
            type="button"
            className={styles.actionButton}
            onClick={() =>
              setEntries((curr) => [
                ...curr,
                {
                  id: 'current',
                  source: { kind: 'handle', handle: currentDoc.handle },
                  label: currentDoc.displayName,
                  isCurrent: true,
                },
              ])
            }
          >
            {t('modals:combine.useCurrentlyOpen')}
          </button>
        )}
      </div>

      <ul className={styles.list}>
        {entries.length === 0 && <li className={styles.empty}>{t('modals:combine.empty')}</li>}
        {entries.map((e, i) => {
          // Wave 28a (a11y-audit.md R-7): an unresolved/empty source path is an
          // invalid entry — surface it to assistive tech via aria-invalid +
          // aria-describedby (not color/placeholder text alone). 3.3.1 Error ID.
          const isInvalid = e.source.kind === 'path' && e.source.path.trim() === '';
          const errId = `combine-entry-err-${e.id}`;
          return (
            <li key={e.id} className={styles.row}>
              <span className={styles.rowIndex}>{i + 1}.</span>
              <span
                className={styles.rowLabel}
                aria-invalid={isInvalid}
                aria-describedby={isInvalid ? errId : undefined}
              >
                {displayLabel(e)}
              </span>
              {isInvalid && (
                <span id={errId} className={styles.rowError} role="note">
                  {t('modals:combine.noFileSelected')}
                </span>
              )}
              <span className={styles.rowRange}>{t('modals:combine.allPages')}</span>
              <span className={styles.rowControls}>
                <button
                  type="button"
                  aria-label={t('modals:combine.moveUp')}
                  disabled={i === 0}
                  onClick={() => moveUp(i)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={t('modals:combine.moveDown')}
                  disabled={i === entries.length - 1}
                  onClick={() => moveDown(i)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={t('common:remove')}
                  onClick={() => removeEntry(e.id)}
                >
                  ×
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <p className={styles.note}>{t('modals:combine.perRowNote')}</p>
    </ModalShell>
  );
}
