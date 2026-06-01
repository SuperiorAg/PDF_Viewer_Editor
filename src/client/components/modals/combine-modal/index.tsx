import { useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { api } from '../../../services/api';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectCurrentDocument } from '../../../state/slices/document-selectors';
import { closeModal, pushToast } from '../../../state/slices/ui-slice';
import { combinePdfsThunk } from '../../../state/thunks';
import { type PdfCombineSource } from '../../../types/ipc-contract';
import { ModalShell } from '../modal-shell';

import styles from './combine-modal.module.css';

interface Entry {
  id: string;
  source: PdfCombineSource;
  /** A display name (file basename, or the open doc's displayName). */
  label: string;
  /** True when this is the currently-open document. */
  isCurrent?: boolean;
}

/**
 * Derive a display name from an absolute path (Windows or POSIX). Avoids a
 * node:path dep in the renderer; the basename heuristic is fine for display.
 */
function basenameFromPath(absPath: string): string {
  const slashIdx = Math.max(absPath.lastIndexOf('/'), absPath.lastIndexOf('\\'));
  return slashIdx >= 0 ? absPath.slice(slashIdx + 1) : absPath;
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
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Render-time label resolution so the suffix is localized + reacts to switch.
  const displayLabel = (e: Entry): string =>
    e.isCurrent ? t('modals:combine.currentlyOpenSuffix', { name: e.label }) : e.label;

  const addFromPicker = async (): Promise<void> => {
    if (picking) return;
    setPicking(true);
    try {
      // Wave-30 follow-up (H-30.1): real path-only file picker. David's
      // `dialog:pickPdfFiles` returns sanitized absolute paths (or
      // user_cancelled). The renderer never reads bytes — pdf:combine reads
      // them main-side under the same sanitization rules.
      const res = await api.dialog.pickPdfFiles({ multi: true });
      if (!res.ok) {
        if (res.error === 'user_cancelled') return;
        // 'invalid_path' or 'bridge_unavailable' (renderer-only sentinel)
        dispatch(
          pushToast({
            kind: 'error',
            message: t('modals:combine.pickerFailed', { message: res.message }),
          }),
        );
        return;
      }
      if (res.value.paths.length === 0) return;
      setEntries((curr) => {
        // De-dup: skip paths already in the list (compare absolute path).
        const existingPaths = new Set(
          curr.flatMap((e) => (e.source.kind === 'path' ? [e.source.path] : [])),
        );
        const newEntries: Entry[] = res.value.paths
          .filter((p) => !existingPaths.has(p))
          .map((p, i) => ({
            id: `path-${Date.now()}-${i}`,
            source: { kind: 'path', path: p },
            label: basenameFromPath(p),
          }));
        return [...curr, ...newEntries];
      });
    } finally {
      setPicking(false);
    }
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
    if (entries.length < 2 || submitting) return;
    setSubmitting(true);
    try {
      const sources = entries.map((e) => e.source);
      await dispatch(combinePdfsThunk(sources));
      close();
    } finally {
      setSubmitting(false);
    }
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
            disabled={entries.length < 2 || submitting}
          >
            {submitting ? t('modals:combine.combining') : t('modals:combine.combineButton')}
          </button>
        </>
      }
    >
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => void addFromPicker()}
          disabled={picking}
        >
          {picking ? t('modals:combine.picking') : t('modals:combine.addFiles')}
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
        {entries.map((e, i) => (
          <li key={e.id} className={styles.row}>
            <span className={styles.rowIndex}>{i + 1}.</span>
            <span className={styles.rowLabel}>{displayLabel(e)}</span>
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
        ))}
      </ul>
      {entries.length > 0 && entries.length < 2 && (
        <p className={styles.note} role="note">
          {t('modals:combine.needTwo')}
        </p>
      )}
      <p className={styles.note}>{t('modals:combine.perRowNote')}</p>
    </ModalShell>
  );
}
