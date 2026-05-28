// SignatureCaptureModal — Phase 4 visual signature capture.
// Per docs/ui-spec.md §13.3 + docs/architecture-phase-4.md §2.3.
//
// Three tabs: Typed (rasterizes name in script font), Drawn (canvas), Image
// (file picker + drag-drop). On Place, the modal closes and the renderer
// enters placement mode with the SignaturePlacementOverlay attached to the
// cursor.

import { useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import {
  closeSignatureModal,
  enterPlacement,
  setCaptureTab,
  setCaptured,
} from '../../../state/slices/signatures-slice';
import { type VisualAppearanceSource } from '../../../types/ipc-contract';
import { ModalShell } from '../modal-shell';

import { DrawnTab } from './drawn-tab';
import { ImageTab } from './image-tab';
import styles from './signature-capture-modal.module.css';
import { TypedTab } from './typed-tab';

const TAB_LABEL_KEYS: Record<'typed' | 'drawn' | 'image', string> = {
  typed: 'modals:signatureCapture.typedTab',
  drawn: 'modals:signatureCapture.drawnTab',
  image: 'modals:signatureCapture.imageTab',
};

export function SignatureCaptureModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const tab = useAppSelector((s) => s.signatures.captureTab);

  const [source, setSource] = useState<VisualAppearanceSource | null>(null);
  const [reason, setReason] = useState('');
  const [showName, setShowName] = useState(true);
  const [showDate, setShowDate] = useState(true);
  const [showReason, setShowReason] = useState(false);

  const onClose = (): void => {
    dispatch(closeSignatureModal());
  };

  const onPlace = (): void => {
    if (!source) return;
    dispatch(
      setCaptured({
        source,
        reason,
        showName,
        showDate,
        showReason,
      }),
    );
    // Enter placement mode — overlay activates on the canvas. Until the user
    // drops the signature, applyVisual is NOT dispatched.
    dispatch(
      enterPlacement({
        flow: 'visual',
        placement: { mode: 'freeform' },
        certHandle: null,
      }),
    );
  };

  const tabBody =
    tab === 'typed' ? (
      <TypedTab
        onChange={(p) => {
          if (!p) {
            setSource(null);
            return;
          }
          setSource({
            kind: 'typed',
            name: p.name,
            fontFamily: p.fontFamily,
            fontSize: p.fontSize,
            pngBytes: p.pngBytes,
            widthPx: p.widthPx,
            heightPx: p.heightPx,
          });
        }}
      />
    ) : tab === 'drawn' ? (
      <DrawnTab
        onChange={(p) => {
          if (!p) {
            setSource(null);
            return;
          }
          setSource({
            kind: 'drawn',
            pngBytes: p.pngBytes,
            widthPx: p.widthPx,
            heightPx: p.heightPx,
          });
        }}
      />
    ) : (
      <ImageTab
        onChange={(p) => {
          if (!p) {
            setSource(null);
            return;
          }
          setSource({
            kind: 'image',
            bytes: p.bytes,
            mimeType: p.mimeType,
            widthPx: p.widthPx,
            heightPx: p.heightPx,
          });
        }}
      />
    );

  return (
    <ModalShell title={t('modals:signatureCapture.title')} onClose={onClose} size="md">
      <div className={styles.body}>
        <div
          role="tablist"
          aria-label={t('modals:signatureCapture.modeLabel')}
          className={styles.tabs}
        >
          {(['typed', 'drawn', 'image'] as const).map((tabId) => (
            <button
              key={tabId}
              type="button"
              role="tab"
              aria-selected={tab === tabId}
              className={`${styles.tab} ${tab === tabId ? styles.tabActive : ''}`}
              onClick={() => dispatch(setCaptureTab(tabId))}
            >
              {t(TAB_LABEL_KEYS[tabId])}
            </button>
          ))}
        </div>
        {tabBody}
        <div className={styles.optionsBlock}>
          <label className={styles.optionRow}>
            <input
              type="checkbox"
              checked={showName}
              onChange={(e) => setShowName(e.target.checked)}
            />
            {t('modals:signatureCapture.showTypedName')}
          </label>
          <label className={styles.optionRow}>
            <input
              type="checkbox"
              checked={showDate}
              onChange={(e) => setShowDate(e.target.checked)}
            />
            {t('modals:signatureCapture.showDateOpt')}
          </label>
          <label className={styles.optionRow}>
            <input
              type="checkbox"
              checked={showReason}
              onChange={(e) => setShowReason(e.target.checked)}
            />
            {t('modals:signatureCapture.showReasonOpt')}
          </label>
          {showReason && (
            <label className={styles.field}>
              <span className={styles.label}>{t('modals:signatureCapture.reason')}</span>
              <input
                className={styles.input}
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('modals:signatureCapture.reasonPlaceholder')}
              />
            </label>
          )}
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.button} onClick={onClose}>
            {t('modals:signatureCapture.cancel')}
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary} ${!source ? styles.buttonDisabled : ''}`}
            onClick={onPlace}
            disabled={!source}
          >
            {t('modals:signatureCapture.placeSignature')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
