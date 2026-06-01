// >200 lines: ImageImportModal hosts BOTH placement modes (new-page +
// overlay) plus the drag-drop preload bridge, the file-picker, the per-mode
// option forms (position selector for new-page; x/y/w/h rect inputs for
// overlay), and the per-format honesty surfaces (multi-page TIFF warning,
// unsupported-mime error). Per convention §3.4 the escape hatch is justified
// because the bytes-lifecycle invariant (conventions §10 + §13.3 — bytes live
// only in this component's local state until commit, never copied into Redux
// or history) is a SINGLE-component invariant: every code path that introduces
// bytes (drag-drop preload, file picker) and every path that consumes them
// (submit → embedImage; cancel → clearPreload) must live in one file so the
// "bytes never leak" rule is mechanical to audit. Splitting per mode would
// duplicate the bytes contract across two components.
//
// ImageImportModal — Phase 2 entry point for inserting PNG/JPEG/TIFF images.
// Per ui-spec.md §11.3.
//
// Two modes:
//  - new-page: image becomes a new page at user-chosen index.
//  - overlay: image is stamped over the current page at user-chosen rect.
//
// Entry points:
//  - Ctrl+I shortcut, Insert menu, toolbar button: opens with empty preload.
//  - Drag-drop of an image file onto canvas / thumbnail-strip: opens with
//    preloaded bytes + mode pre-selected (handled by app.tsx — Phase 2 extends
//    the existing drag-drop handler).
//
// Image-bytes lifecycle (conventions §10 + §13.3):
//  - Bytes arrive via File.arrayBuffer() (file picker) or via the preload slot
//    populated by the drag-drop handler. They live ONLY in this component's
//    local state until commit, then are shipped to main via pdf.embedImage().
//  - Never copied to history (history middleware compacts before push).
//  - The preload slot in ui-slice is cleared on submit/cancel.

import { useEffect, useRef, useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectCurrentDocument } from '../../../state/slices/document-selectors';
import { selectImageImportPreload } from '../../../state/slices/ui-selectors';
import { clearImageImportPreload, closeModal } from '../../../state/slices/ui-slice';
import { selectCurrentPage } from '../../../state/slices/viewport-selectors';
import { embedImageThunk } from '../../../state/thunks';
import { ModalShell } from '../modal-shell';

import styles from './image-import-modal.module.css';

type Mode = 'new-page' | 'overlay';
type ImageMime = 'image/png' | 'image/jpeg' | 'image/tiff';
type InsertPosition = 'beginning' | 'before-current' | 'after-current' | 'end' | 'custom';

const ACCEPT = 'image/png,image/jpeg,image/tiff,.tif,.tiff';

function mimeFromName(name: string): ImageMime | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
  return null;
}

async function probeIntrinsicDimensions(
  bytes: Uint8Array,
  mime: ImageMime,
): Promise<{ width: number; height: number }> {
  // TIFF can't be probed via <img>; default to sensible US-Letter-ish defaults
  // and let the engine correct on save. PNG/JPEG go through <img> for fidelity.
  if (mime === 'image/tiff') {
    return { width: 800, height: 1000 };
  }
  // Wrap in a blob URL so we don't have to materialize a base64 data URL.
  // The blob is revoked after the image loads. The .slice(0) copy normalizes
  // a Uint8Array<ArrayBufferLike> to a Uint8Array<ArrayBuffer> which is what
  // BlobPart requires under strict lib types.
  const blob = new Blob([bytes.slice(0)], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image_decode_failed'));
      img.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ImageImportModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const currentPage = useAppSelector(selectCurrentPage);
  const preload = useAppSelector(selectImageImportPreload);

  const [bytes, setBytes] = useState<Uint8Array | null>(preload.bytes);
  const [mime, setMime] = useState<ImageMime | null>(preload.mimeType);
  const [fileName, setFileName] = useState<string>(preload.fileName ?? '');
  const [intrinsicWidth, setIntrinsicWidth] = useState<number | null>(preload.intrinsicWidth);
  const [intrinsicHeight, setIntrinsicHeight] = useState<number | null>(preload.intrinsicHeight);

  const [mode, setMode] = useState<Mode>(preload.initialMode);
  const [insertPosition, setInsertPosition] = useState<InsertPosition>('end');
  const [customIndex, setCustomIndex] = useState<number>(1);

  const [overlayPageIndex, setOverlayPageIndex] = useState<number>(
    preload.initialOverlayPageIndex ?? currentPage,
  );
  const [overlayRect, setOverlayRect] = useState({
    x: preload.initialOverlayRect?.x ?? 100,
    y: preload.initialOverlayRect?.y ?? 100,
    width: preload.initialOverlayRect?.width ?? 200,
    height: preload.initialOverlayRect?.height ?? 100,
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-probe dimensions when preloaded bytes arrive without dims (e.g.
  // drag-drop handler skipped the probe).
  useEffect(() => {
    if (bytes && mime && (intrinsicWidth === null || intrinsicHeight === null)) {
      void probeIntrinsicDimensions(bytes, mime).then(
        ({ width, height }) => {
          setIntrinsicWidth(width);
          setIntrinsicHeight(height);
        },
        () => {
          setIntrinsicWidth(800);
          setIntrinsicHeight(1000);
        },
      );
    }
  }, [bytes, mime, intrinsicWidth, intrinsicHeight]);

  const close = (): void => {
    dispatch(clearImageImportPreload());
    dispatch(closeModal());
  };

  const onFile = async (file: File): Promise<void> => {
    const detectedMime = (file.type as ImageMime) || mimeFromName(file.name);
    if (
      detectedMime !== 'image/png' &&
      detectedMime !== 'image/jpeg' &&
      detectedMime !== 'image/tiff'
    ) {
      setErrorMsg(t('modals:imageImport.errUnsupported'));
      return;
    }
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    setBytes(u8);
    setMime(detectedMime);
    setFileName(file.name);
    setErrorMsg(null);
    try {
      const { width, height } = await probeIntrinsicDimensions(u8, detectedMime);
      setIntrinsicWidth(width);
      setIntrinsicHeight(height);
    } catch {
      setIntrinsicWidth(800);
      setIntrinsicHeight(1000);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    void onFile(file);
  };

  const clearFile = (): void => {
    setBytes(null);
    setMime(null);
    setFileName('');
    setIntrinsicWidth(null);
    setIntrinsicHeight(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const computeNewPageIndex = (): number => {
    if (!doc) return 0;
    switch (insertPosition) {
      case 'beginning':
        return 0;
      case 'before-current':
        return Math.max(0, currentPage);
      case 'after-current':
        return Math.min(doc.pageCount, currentPage + 1);
      case 'end':
        return doc.pageCount;
      case 'custom':
        return Math.max(0, Math.min(doc.pageCount, customIndex - 1));
    }
  };

  const canSubmit =
    bytes !== null &&
    mime !== null &&
    intrinsicWidth !== null &&
    intrinsicHeight !== null &&
    doc !== null;

  const submit = async (): Promise<void> => {
    if (!canSubmit || !bytes || !mime || !intrinsicWidth || !intrinsicHeight) return;
    if (mode === 'new-page') {
      await dispatch(
        embedImageThunk({
          bytes,
          mimeType: mime,
          intrinsicWidth,
          intrinsicHeight,
          placement: { kind: 'new-page', atIndex: computeNewPageIndex() },
        }),
      );
    } else {
      await dispatch(
        embedImageThunk({
          bytes,
          mimeType: mime,
          intrinsicWidth,
          intrinsicHeight,
          placement: {
            kind: 'overlay',
            pageIndex: overlayPageIndex,
            rect: overlayRect,
          },
        }),
      );
    }
  };

  const isMultiPageTiffWarning = mime === 'image/tiff';

  return (
    <ModalShell
      title={t('modals:imageImport.title')}
      onClose={close}
      size="md"
      footer={
        <>
          <button type="button" className={styles.secondary} onClick={close}>
            {t('modals:imageImport.cancel')}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {t('modals:imageImport.insertButton')}
          </button>
        </>
      }
    >
      <p className={styles.intro}>{t('modals:imageImport.intro')}</p>
      <div className={styles.filePickerRow}>
        <button
          type="button"
          className={styles.fileButton}
          onClick={() => fileInputRef.current?.click()}
        >
          {t('modals:imageImport.chooseFile')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className={styles.fileInput}
          onChange={onFileInputChange}
          aria-label={t('modals:imageImport.chooseFileLabel')}
        />
        {fileName ? (
          <>
            <span className={styles.fileName}>{fileName}</span>
            <button
              type="button"
              className={styles.clearFile}
              onClick={clearFile}
              aria-label={t('modals:imageImport.clearSelectedFile')}
            >
              ×
            </button>
          </>
        ) : (
          <span className={styles.fileNamePlaceholder}>
            {t('modals:imageImport.noFileSelected')}
          </span>
        )}
      </div>

      {errorMsg && <p className={styles.error}>{errorMsg}</p>}

      {isMultiPageTiffWarning && (
        <p className={styles.warning}>{t('modals:imageImport.multiPageTiffWarning')}</p>
      )}

      <fieldset className={styles.fieldset}>
        <legend>{t('modals:imageImport.insertAs')}</legend>
        <label className={styles.radioRow}>
          <input
            type="radio"
            name="image-mode"
            value="new-page"
            checked={mode === 'new-page'}
            onChange={() => setMode('new-page')}
          />
          {t('modals:imageImport.newPageAt')}
          <select
            value={insertPosition}
            onChange={(e) => setInsertPosition(e.target.value as InsertPosition)}
            disabled={mode !== 'new-page'}
            className={styles.positionSelect}
            aria-label={t('modals:imageImport.newPagePositionLabel')}
          >
            <option value="end">{t('modals:imageImport.posEnd')}</option>
            <option value="beginning">{t('modals:imageImport.posBeginning')}</option>
            <option value="before-current">{t('modals:imageImport.posBeforeCurrent')}</option>
            <option value="after-current">{t('modals:imageImport.posAfterCurrent')}</option>
            <option value="custom">{t('modals:imageImport.posCustom')}</option>
          </select>
          {insertPosition === 'custom' && (
            <input
              type="number"
              value={customIndex}
              min={1}
              max={doc?.pageCount ?? 1}
              onChange={(e) =>
                setCustomIndex(Math.max(1, Number.parseInt(e.target.value, 10) || 1))
              }
              disabled={mode !== 'new-page'}
              className={styles.customIndexInput}
              aria-label={t('modals:imageImport.customPositionLabel')}
            />
          )}
        </label>

        <label className={styles.radioRow}>
          <input
            type="radio"
            name="image-mode"
            value="overlay"
            checked={mode === 'overlay'}
            onChange={() => setMode('overlay')}
          />
          {t('modals:imageImport.overlayOnCurrent')}
        </label>

        {mode === 'overlay' && (
          <div className={styles.overlayFields}>
            <label className={styles.overlayLabel}>
              {t('modals:imageImport.overlayPage')}
              <input
                type="number"
                value={overlayPageIndex + 1}
                min={1}
                max={doc?.pageCount ?? 1}
                onChange={(e) =>
                  setOverlayPageIndex(Math.max(0, (Number.parseInt(e.target.value, 10) || 1) - 1))
                }
                aria-label={t('modals:imageImport.overlayTargetPageLabel')}
              />
            </label>
            <label className={styles.overlayLabel}>
              {t('modals:imageImport.overlayX')}
              <input
                type="number"
                value={overlayRect.x}
                onChange={(e) =>
                  setOverlayRect((r) => ({
                    ...r,
                    x: Number.parseFloat(e.target.value) || 0,
                  }))
                }
                aria-label={t('modals:imageImport.overlayXLabel')}
              />
            </label>
            <label className={styles.overlayLabel}>
              {t('modals:imageImport.overlayY')}
              <input
                type="number"
                value={overlayRect.y}
                onChange={(e) =>
                  setOverlayRect((r) => ({
                    ...r,
                    y: Number.parseFloat(e.target.value) || 0,
                  }))
                }
                aria-label={t('modals:imageImport.overlayYLabel')}
              />
            </label>
            <label className={styles.overlayLabel}>
              {t('modals:imageImport.overlayW')}
              <input
                type="number"
                value={overlayRect.width}
                min={1}
                onChange={(e) =>
                  setOverlayRect((r) => ({
                    ...r,
                    width: Math.max(1, Number.parseFloat(e.target.value) || 1),
                  }))
                }
                aria-label={t('modals:imageImport.overlayWLabel')}
              />
            </label>
            <label className={styles.overlayLabel}>
              {t('modals:imageImport.overlayH')}
              <input
                type="number"
                value={overlayRect.height}
                min={1}
                onChange={(e) =>
                  setOverlayRect((r) => ({
                    ...r,
                    height: Math.max(1, Number.parseFloat(e.target.value) || 1),
                  }))
                }
                aria-label={t('modals:imageImport.overlayHLabel')}
              />
            </label>
          </div>
        )}
      </fieldset>

      <p className={styles.note}>{t('modals:imageImport.userSpaceNote')}</p>
    </ModalShell>
  );
}
