// Settings → Diagnostics tab (v0.7.13 follow-up to David's OCR rasterize fixes).
//
// Surface for two backend channels that previously had no UI:
//   1. `app:diagnoseOcr` (David, 2026-06-01) — one-shot probe of canvas /
//      pdf.js / tesseract reachability + the document-store census. Until now
//      the only way to call it was DevTools (`await window.pdfApi.app.diagnoseOcr({})`).
//   2. The `userData/logs` folder where David's `ocr-rasterize-<ts>.json`
//      diagnostic logs land on rasterize failure (v0.7.13). We can't open a
//      path via `shell.openPath` from the renderer yet (no IPC channel for
//      arbitrary path opens — `app:openExternal` only does
//      `show_in_explorer` against a document handle). So we show the path as
//      a copyable string and tell the user to paste it into Explorer.
//
// Trust-floor disclaimer (bottom of the tab): the diagnostic JSON includes
// canvas binding identity + Node/Electron versions + OCR pipeline state.
// Verified against `DiagnoseOcrSnapshot` in src/main/pdf-ops/ocr-bootstrap.ts
// — the snapshot contains: canvasModuleResolvable (boolean), canvasModuleLoadError
// (string|null), pdfjsLoadable (boolean), tesseractCoreReachable (boolean),
// documentStoreCount (number). NO PDF content, NO file paths, NO PII.

import { useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { api } from '../../../services/api';
import { useAppDispatch } from '../../../state/hooks';
import { pushToast } from '../../../state/slices/ui-slice';

import styles from './settings-modal.module.css';

/**
 * Resolve the userData/logs path for display.
 *
 * In Electron we'd use `app.getPath('userData')` (main) — but the renderer
 * doesn't have access to that synchronously. We surface the literal path as a
 * platform hint string so the user can paste-replace `%APPDATA%` themselves.
 * The honest fact is: we don't know the absolute path from the renderer side
 * without an IPC round-trip that doesn't exist yet (no `app:getUserDataPath`).
 *
 * Per the brief: "If David exposes a shell-open-path IPC, call it; otherwise
 * just display the path so the user can paste into Explorer."
 *
 * The product name in the Roaming subfolder is electron-builder's
 * `productName` from electron-builder.yml. Diego's config sets that to
 * "PDF Viewer & Editor" (Wave 17 packaging — see release/wave17 build report).
 */
const USER_DATA_LOGS_HINT = '%APPDATA%\\PDF Viewer & Editor\\logs';

export function DiagnosticsTab(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const runDiagnostics = async (): Promise<void> => {
    setRunning(true);
    try {
      const res = await api.app.diagnoseOcr({});
      // We render the full Result envelope verbatim so the user copy-pastes a
      // self-describing JSON document (the `ok` discriminator is part of the
      // story when troubleshooting). Pretty-print with 2-space indent.
      setDiagnostic(JSON.stringify(res, null, 2));
    } catch (e) {
      // The bridge proxy normally turns missing channels into Result envelopes,
      // so a thrown error here is unusual — surface it honestly.
      const message = e instanceof Error ? e.message : String(e);
      setDiagnostic(JSON.stringify({ ok: false, error: 'renderer_error', message }, null, 2));
    } finally {
      setRunning(false);
    }
  };

  const copyDiagnostic = async (): Promise<void> => {
    if (diagnostic === null) return;
    try {
      await navigator.clipboard.writeText(diagnostic);
      dispatch(pushToast({ kind: 'success', message: t('settings:diagnostics.copied') }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      dispatch(
        pushToast({
          kind: 'error',
          message: t('settings:diagnostics.copyFailed', { message }),
        }),
      );
    }
  };

  const copyLogPath = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(USER_DATA_LOGS_HINT);
      dispatch(pushToast({ kind: 'success', message: t('settings:diagnostics.pathCopied') }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      dispatch(
        pushToast({
          kind: 'error',
          message: t('settings:diagnostics.copyFailed', { message }),
        }),
      );
    }
  };

  return (
    <>
      {/* Row A — Run OCR diagnostics */}
      <fieldset className={styles.group}>
        <legend className={styles.groupHeading}>{t('settings:diagnostics.runHeading')}</legend>
        <p className={styles.fieldHint}>{t('settings:diagnostics.runDescription')}</p>
        <div className={styles.diagnosticsButtonRow}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void runDiagnostics()}
            disabled={running}
          >
            {running ? t('settings:diagnostics.runningLabel') : t('settings:diagnostics.runButton')}
          </button>
          {diagnostic !== null && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void copyDiagnostic()}
            >
              {t('settings:diagnostics.copyButton')}
            </button>
          )}
        </div>
        {diagnostic !== null && (
          // role="region" + aria-label promotes the <pre> to a landmark so
          // screen-reader users can navigate to it. The block is scrollable
          // visually; keyboard users can copy via the "Copy result" button
          // above (no need for a focusable scroll container).
          <pre
            className={styles.diagnosticsJson}
            role="region"
            aria-label={t('settings:diagnostics.resultLabel')}
          >
            {diagnostic}
          </pre>
        )}
      </fieldset>

      {/* Row B — Show log folder */}
      <fieldset className={styles.group}>
        <legend className={styles.groupHeading}>
          {t('settings:diagnostics.logFolderHeading')}
        </legend>
        <p className={styles.fieldHint}>{t('settings:diagnostics.logFolderDescription')}</p>
        <code className={styles.diagnosticsPath}>{USER_DATA_LOGS_HINT}</code>
        <button type="button" className={styles.secondary} onClick={() => void copyLogPath()}>
          {t('settings:diagnostics.copyPathButton')}
        </button>
      </fieldset>

      {/* Row C — Latest OCR error log (no IPC channel yet; honest pointer) */}
      <fieldset className={styles.group}>
        <legend className={styles.groupHeading}>
          {t('settings:diagnostics.latestLogHeading')}
        </legend>
        <p className={styles.fieldHint}>{t('settings:diagnostics.latestLogDescription')}</p>
      </fieldset>

      {/* Trust-floor disclaimer — the EXACT claim is verified against
          DiagnoseOcrSnapshot in src/main/pdf-ops/ocr-bootstrap.ts (canvas
          resolvability + load error, pdf.js loadable, tesseract reachable,
          document-store count). No PDF content is included; this comment is
          load-bearing per conventions §18 trust-floor. */}
      <p className={styles.privacyCopy}>{t('settings:diagnostics.disclaimer')}</p>
    </>
  );
}
