import { useEffect } from 'react';

import styles from './app.module.css';
import { AddLinkModal } from './components/add-link-modal';
// Phase 7.5 Wave 5c (Riley) — C5 Alt Text Inspector modal.
import { AltTextInspector } from './components/alt-text-inspector';
// Phase 7.5 Wave 5 (Riley) — B19 / B20 / B21+B8 modals.
import { AutoBookmarkModal } from './components/auto-bookmark-modal';
import { DocumentPropertiesModal } from './components/document-properties-modal';
import { EmptyState } from './components/empty-state';
import { ErrorBoundary } from './components/error-boundary';
// Phase 7.5 A7 — Find-a-tool palette (registry-driven, Ctrl+/).
import { FindAToolPalette } from './components/find-a-tool-palette';
import { FormDesignerToolbar } from './components/form-designer';
import { Inspector } from './components/inspector';
import { LinksOverlay } from './components/links-overlay';
import { MenuBar } from './components/menu-bar';
import { AboutModal } from './components/modals/about-modal';
import { CombineModal } from './components/modals/combine-modal';
import { ConfirmCloseUnsavedModal } from './components/modals/confirm-close-unsaved-modal';
import { ExportEngineDialog } from './components/modals/export-engine-dialog';
import { ExportModal } from './components/modals/export-modal';
import { HelpModal } from './components/modals/help-modal';
import { ImageImportModal } from './components/modals/image-import-modal';
import { LanguagePackManagerModal } from './components/modals/language-pack-manager-modal';
import { MailMergeModal } from './components/modals/mail-merge-modal';
import { OcrRunModal } from './components/modals/ocr-run-modal';
import { SaveTemplateModal } from './components/modals/save-template-modal';
import { ScanModal } from './components/modals/scan-modal';
import { SettingsModal } from './components/modals/settings-modal';
import { PageDesignModal } from './components/page-design-modal';
import { PdfViewer } from './components/pdf-viewer';
// Phase 7.5 C1 (Riley Wave 5a) — Read Aloud floating bar.
import { ReadAloudBar } from './components/read-aloud-bar';
// Phase 7.5 C4 (Riley Wave 5c) — Reading Order overlay (numbered badges).
import { ReadingOrderOverlay } from './components/reading-order-overlay';
// Phase 7.4 B1 — Redaction sub-toolbar + Apply confirm modal (same mount
// pattern as ShapeToolbar above, gated on ui.redactionPanelOpen / Modal flag).
import { ApplyRedactionsModal } from './components/redaction-tools/apply-redactions-modal';
import { RedactionToolbar } from './components/redaction-tools/redaction-toolbar';
// Phase 7.5 B12 (Riley Wave 3) — page-content region clipboard overlay.
import { RegionClipboardOverlay } from './components/region-clipboard';
import { SanitizeModal } from './components/sanitize-modal';
// Phase 7.4 A5 — ShapeToolbar mounts as a sibling under the main Toolbar,
// gated on ui.shapesPanelOpen (mirrors the FormDesignerToolbar pattern).
import { ShapeDrawOverlay } from './components/shape-tools/shape-draw-overlay';
import { ShapeToolbar } from './components/shape-tools/shape-toolbar';
// Phase 7.5 Wave 4 (Riley) — shape pointer wiring (closes Wave-3 open
// question #3) + hyperlink overlay + Page Design + Add Link modals.
import { Sidebar } from './components/sidebar';
// Phase 7.5 B7 (Riley Wave 3) — Stamps Add modal + placement overlay mount
// at the app level so they compose with other modals and the placement
// banner stays visible across sidebar tab switches.
import { AddStampModal } from './components/stamps-panel/add-stamp-modal';
import { StampPlacementOverlay } from './components/stamps-panel/stamp-placement-overlay';
import { StatusBar } from './components/status-bar';
import { TextEditOverlay } from './components/text-edit-overlay';
import { ToastStack } from './components/toast';
import { Toolbar } from './components/toolbar';
import { useAppShortcuts } from './hooks/use-app-shortcuts';
import { usePhase7Bootstrap } from './i18n/use-phase7-bootstrap';
import { useT } from './i18n/use-t';
// v0.7.13 (parallel-coordinated with David's main-process work): subscribe to
// the Windows file-association entry channel. The hook is a no-op until the
// preload exposes `api.app.onFileOpenFromShell` — see the comment block on the
// hook itself for the exact contract David is landing.
import { subscribeFileOpenFromShell } from './state/file-open-from-shell';
import { useAppDispatch, useAppSelector } from './state/hooks';
import { selectCurrentDocument } from './state/slices/document-selectors';
// Phase 3 — mail-merge wizard has its own modalOpen flag (separate from ui.activeModal)
import { selectExportModalOpen } from './state/slices/export-selectors';
import { selectMailMergeOpen } from './state/slices/mail-merge-selectors';
// Phase 5 — OCR slice owns its own modal flag (mirrors signatures + mail-merge).
import { selectOcrOpenModal } from './state/slices/ocr-selectors';
// Phase 6 — Export-to-Office modal owns its own openness flag on the export slice.
import { selectScanModalOpen } from './state/slices/scan-selectors';
import {
  selectActiveModal,
  selectFindAToolOpen,
  selectReadMode,
  selectRedactionApplyModalOpen,
} from './state/slices/ui-selectors';
import {
  openImageImportModal,
  pushToast,
  setImageImportPreload,
  setReadMode,
} from './state/slices/ui-slice';
import { openDroppedPathThunk, refreshRecentsThunk } from './state/thunks';
import { subscribeOcrPackDownloadProgress, subscribeOcrProgress } from './state/thunks-phase5';
// Phase 6 — subscribe to export:progress events at app mount.
import { listExportFormatsThunk, subscribeExportProgress } from './state/thunks-phase6';

export function App(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const activeModal = useAppSelector(selectActiveModal);
  const mailMergeOpen = useAppSelector(selectMailMergeOpen);
  const ocrOpenModal = useAppSelector(selectOcrOpenModal);
  const scanOpen = useAppSelector(selectScanModalOpen);
  const exportModalOpen = useAppSelector(selectExportModalOpen);
  const redactionApplyModalOpen = useAppSelector(selectRedactionApplyModalOpen);
  // Phase 7.5 A7 / B16 — registry palette + Read Mode visibility gates.
  const findAToolOpen = useAppSelector(selectFindAToolOpen);
  const readMode = useAppSelector(selectReadMode);
  // Phase 7.5 Wave 4 (Riley) — Page Design + Add Link modal gates.
  const pageDesignOpen = useAppSelector((s) => s.pageDesign.open);
  const addLinkOpen = useAppSelector(
    (s) => s.links.addModal !== null || s.links.editModalLinkId !== null,
  );
  // Phase 7.5 Wave 5 (Riley) — Document Properties + Sanitize + Auto-bookmark
  // each own a single `open` flag on their dedicated slice so they compose
  // freely with other modal pipelines.
  const docPropertiesOpen = useAppSelector((s) => s.documentProperties.open);
  const sanitizeOpen = useAppSelector((s) => s.sanitize.open);
  const autoBookmarkOpen = useAppSelector((s) => s.autoBookmark.open);

  useAppShortcuts();

  // Phase 7 — seed locale / telemetry opt-in / update channel from settings on
  // mount; optionally run the launch update-check on the opt-in channel.
  usePhase7Bootstrap();

  useEffect(() => {
    void dispatch(refreshRecentsThunk());
  }, [dispatch]);

  // Phase 5 — subscribe to OCR progress event streams at app mount.
  // Each subscription returns its unsubscribe handle; cleanup tears down the
  // bridge listener on unmount.
  useEffect(() => {
    const unsubProgress = subscribeOcrProgress(dispatch);
    const unsubDownload = subscribeOcrPackDownloadProgress(dispatch);
    return () => {
      unsubProgress();
      unsubDownload();
    };
  }, [dispatch]);

  // Phase 6 — subscribe to export:progress + load the format catalog once.
  useEffect(() => {
    void dispatch(listExportFormatsThunk());
    const unsub = subscribeExportProgress(dispatch);
    return () => {
      unsub();
    };
  }, [dispatch]);

  // v0.7.13 — subscribe to file:openFromShell. When Windows opens the app with
  // a .pdf path on argv (file-association double-click, Shell open verb, drag-
  // onto-taskbar-icon), the main process emits an event and we route the path
  // through the same opener thunk drag-drop uses. The subscription is a no-op
  // until David's parallel main+preload run lands `api.app.onFileOpenFromShell`
  // — `subscribeFileOpenFromShell` feature-detects and returns a no-op
  // unsubscribe in that case (see its module comment for the gap).
  useEffect(() => {
    const unsub = subscribeFileOpenFromShell(dispatch);
    return () => {
      unsub();
    };
  }, [dispatch]);

  // Phase 7.5 B16 — Esc exits Read Mode (and exits OS fullscreen if active).
  // The global Esc handler is scoped to read-mode-on so it doesn't fight with
  // modal dismiss handlers (each modal owns its own Esc). The find-a-tool
  // palette also has its own Esc handler — that fires first because the
  // palette's container has focus when open.
  useEffect(() => {
    if (!readMode) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dispatch(setReadMode(false));
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, readMode]);

  // Window-level drag/drop hand-off. Phase 2 extends the file-type matrix:
  //   - .pdf  -> openDroppedPathThunk (Phase 1 behavior, untouched per L-001)
  //   - .png/.jpg/.jpeg/.tif/.tiff -> open the ImageImportModal with the
  //     image preloaded (ui-spec.md §11.9 drag-drop matrix).
  // L-001 invariant: relies on Electron's enableDragDropFiles=true; do NOT
  // touch window-manager.ts. The `(file as any).path` access depends on it.
  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files);
      const pdf = files.find((f) => f.name.toLowerCase().endsWith('.pdf'));
      if (pdf) {
        // any: Electron extends File with a `.path` string at runtime (L-001).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const droppedPath = (pdf as any).path as string | undefined;
        if (!droppedPath) {
          dispatch(
            pushToast({
              kind: 'error',
              message: t('errors:dropPathFailed'),
            }),
          );
          return;
        }
        void dispatch(openDroppedPathThunk(droppedPath));
        return;
      }
      // Phase 2: image drag-drop. Only if a document is already open (ui-spec
      // §11.9 — image-only documents are NOT Phase 2).
      const image = files.find((f) => {
        const n = f.name.toLowerCase();
        return (
          n.endsWith('.png') ||
          n.endsWith('.jpg') ||
          n.endsWith('.jpeg') ||
          n.endsWith('.tif') ||
          n.endsWith('.tiff')
        );
      });
      if (image) {
        if (!doc) {
          dispatch(
            pushToast({
              kind: 'warning',
              message: t('errors:openPdfFirst'),
            }),
          );
          return;
        }
        void (async () => {
          const buf = await image.arrayBuffer();
          const u8 = new Uint8Array(buf);
          const lower = image.name.toLowerCase();
          const mime: 'image/png' | 'image/jpeg' | 'image/tiff' = lower.endsWith('.png')
            ? 'image/png'
            : lower.endsWith('.tif') || lower.endsWith('.tiff')
              ? 'image/tiff'
              : 'image/jpeg';
          dispatch(
            setImageImportPreload({
              bytes: u8,
              mimeType: mime,
              fileName: image.name,
              // Drop position is window-relative; we leave the rect derivation
              // to the modal (renderer doesn't know the canvas->PDF coord
              // transform here in app.tsx). The modal defaults to (100,100)
              // for the rect; user can refine after insert via canvas handles.
              initialMode: 'overlay',
              initialOverlayPageIndex: null,
              initialOverlayRect: null,
            }),
          );
          dispatch(openImageImportModal());
        })();
        return;
      }
      if (files.length > 0) {
        dispatch(
          pushToast({
            kind: 'warning',
            message: t('errors:unsupportedDropType'),
          }),
        );
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [dispatch, doc, t]);

  return (
    <ErrorBoundary>
      <div className={styles.app} data-read-mode={readMode ? 'on' : 'off'}>
        {/* Phase 7.5 B16 — Read Mode hides menu / toolbars / sidebar / status
            bar. F11 toggles; Esc exits. Implemented as conditional render so
            the chrome surfaces are not in the layout while hidden (preserves
            keyboard tab order — there's nothing to focus through). */}
        {!readMode && <MenuBar />}
        {!readMode && <Toolbar />}
        {/* Phase 3 — designer field-type pills toolbar (visible only in designer mode). */}
        {!readMode && <FormDesignerToolbar />}
        {/* Phase 7.4 A5 — shape tools sub-toolbar (visible only when the main
            toolbar's Shapes toggle is on). Component returns null while the
            ui.shapesPanelOpen flag is false. */}
        {!readMode && <ShapeToolbar />}
        {/* Phase 7.4 B1 — redaction tools sub-toolbar. Same sibling-under-Toolbar
            mount as ShapeToolbar; returns null while ui.redactionPanelOpen
            is false. The Apply modal mounts below with the other modals. */}
        {!readMode && <RedactionToolbar />}
        <main className={styles.main}>
          {doc ? (
            <>
              {!readMode && <Sidebar />}
              <PdfViewer />
              {!readMode && <Inspector />}
            </>
          ) : (
            <EmptyState />
          )}
        </main>
        {!readMode && <StatusBar />}
        <ToastStack />
        {activeModal === 'combine' && <CombineModal />}
        {activeModal === 'settings' && <SettingsModal />}
        {activeModal === 'about' && <AboutModal />}
        {activeModal === 'confirm-close-unsaved' && <ConfirmCloseUnsavedModal />}
        {activeModal === 'export-engine' && <ExportEngineDialog />}
        {activeModal === 'help' && <HelpModal />}
        {activeModal === 'image-import' && <ImageImportModal />}
        {/* Phase 3 modals */}
        {activeModal === 'save-template' && <SaveTemplateModal />}
        {mailMergeOpen && <MailMergeModal />}
        {/* Phase 5 modals — OcrRunModal + LanguagePackManagerModal share the
            ocr-slice's openModal field (mutually exclusive). ScanModal lives
            on the scan-slice's modalOpen flag (placeholder). */}
        {ocrOpenModal === 'run' && <OcrRunModal />}
        {ocrOpenModal === 'language-pack-manager' && <LanguagePackManagerModal />}
        {scanOpen && <ScanModal />}
        {/* Phase 6 — Export-to-Office modal. The export-slice carries its own
            modalStep flag (separate from ui.activeModal) so it composes with
            other modal pipelines (Settings + Export simultaneously is not
            possible by intent, but the structural separation mirrors Phase 5
            ocr-slice). */}
        {exportModalOpen && <ExportModal />}
        {/* Phase 7.4 B1 — Redaction Apply confirmation modal. Owns its own
            open flag (ui.redactionApplyModalOpen) independent of activeModal
            since the redaction sub-toolbar mounts in parallel to other modals. */}
        {redactionApplyModalOpen && <ApplyRedactionsModal />}
        {/* Phase 7.5 A7 — Find-a-tool palette (Ctrl+/). Reads from the tool
            registry; dispatches the chosen tool's action on Enter. */}
        {findAToolOpen && <FindAToolPalette />}
        {/* Phase 7.5 B7 (Riley Wave 3) — Stamps modal + placement overlay.
            Both gate on their own slice flags. The placement overlay mounts
            unconditionally (returns null when no placement) so the global
            click listener installs and tears down cleanly across renders. */}
        <AddStampModal />
        <StampPlacementOverlay />
        {/* Phase 7.5 B12 (Riley Wave 3) — region-clipboard overlay. Returns
            only render-effects when no marquee / paste-ghost is active. */}
        <RegionClipboardOverlay />
        {/* Phase 7.5 Wave 4 (Riley) — Shape drawing pointer-event wiring.
            Returns null when no shape tool is armed. Closes the Wave-3
            open question #3 — line / polyline / area measure tools can now
            actually draw on a page. */}
        <ShapeDrawOverlay />
        {/* Phase 7.5 B13 (Riley Wave 4) — Hyperlink overlay. Always mounted
            so persisted-link badges render over visible pages; arms the
            marquee when `links.tool === 'add-link'`. */}
        <LinksOverlay />
        {pageDesignOpen && <PageDesignModal />}
        {addLinkOpen && <AddLinkModal />}
        {/* Phase 7.5 Wave 5 (Riley) — Document Properties (B21+B8) + Sanitize
            (B20) + Auto-bookmark (B19) modals. Each gates on its own slice
            flag so they compose with other modal pipelines. */}
        {docPropertiesOpen && <DocumentPropertiesModal />}
        {sanitizeOpen && <SanitizeModal />}
        {autoBookmarkOpen && <AutoBookmarkModal />}
        {/* Phase 7.5 C1 (Riley Wave 5a) — Read Aloud floating bar. Returns
            null when closed; renders fixed-position over the viewer when
            open so it stays visible across sidebar/inspector toggles. */}
        <ReadAloudBar />
        {/* Phase 7.5 C4 (Riley Wave 5c) — Reading Order overlay. Always
            mounted so badges can render over visible pages; returns null
            when `readingOrder.active === false`. */}
        <ReadingOrderOverlay />
        {/* Phase 7.5 C5 (Riley Wave 5c) — Alt Text Inspector modal. Returns
            null when `altText.open === false`. */}
        <AltTextInspector />
        <TextEditOverlay />
      </div>
    </ErrorBoundary>
  );
}
