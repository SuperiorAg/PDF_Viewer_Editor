// Export Report dialog — Phase 7.5 C6 §27.3 (Riley Wave 5e).
//
// Modal that lets the user pick a format (HTML | JSON), filter passed /
// unevaluated results, edit the filename, and trigger the export.
//
// HONESTY CLAUSE (P7.5-L-10):
//   - The verbatim `subsetDisclosure` from David's response is rendered
//     READ-ONLY inside the dialog so the user knows the export envelope
//     will carry it. There is NO checkbox to disable it. The locked label
//     advertises that fact.
//   - "Include passed" / "Include unevaluated" filter the per-rule
//     details only — the report's summary counts remain accurate to the
//     underlying run.
//
// FILE SAVE PLUMBING (Option B per the brief):
//   v0.8.0 uses the Wave 5a Preflight precedent — a blob-download via
//   anchor.click() that triggers Chromium's save dialog. The renderer is
//   sandboxed; Electron supports the trick natively. A typed
//   `fs:writeReport` IPC channel is the proper future home (logged as a
//   Wave 5e open question).

import { useEffect, useMemo, useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { api } from '../../../services/api';
import { downloadBlob } from '../../../services/download-blob';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { exportDialogClosed } from '../../../state/slices/accessibility-check-slice';
import { selectCurrentDocument } from '../../../state/slices/document-selectors';
import { pushToast } from '../../../state/slices/ui-slice';
import type { PdfRunAccessibilityCheckValue } from '../../../types/accessibility-check-contract-stub';
import { ModalShell } from '../../modals/modal-shell';
import { renderAccessibilityReportHtml, type HtmlChromeStrings } from '../html-report-template';
import { serializeAccessibilityReportJson } from '../json-report-serializer';

import styles from './export-report-dialog.module.css';
import { FilenameInput } from './filename-input';
import { FormatRadio, type ExportFormat } from './format-radio';
import { OptionsCheckboxes } from './options-checkboxes';

export interface ExportReportDialogProps {
  /** The current successful run — pre-condition for the dialog to be open. */
  lastResult: PdfRunAccessibilityCheckValue;
}

/** Path-/filesystem-illegal characters on Windows / macOS / Linux. Empty
 *  filenames also rejected. Dots are OK (they form the extension); but
 *  whitespace-only is rejected. Control-character class (0x00–0x1f) is
 *  intentional — Windows rejects these in filenames — so the lint
 *  `no-control-regex` is silenced for this single literal. */
// eslint-disable-next-line no-control-regex
const ILLEGAL_FILENAME_RE = /[\\/:*?"<>|\x00-\x1f]/;

function isFilenameValid(name: string): boolean {
  if (name.trim().length === 0) return false;
  return !ILLEGAL_FILENAME_RE.test(name);
}

/** Strip an extension if the user-edited filename carries one — so we
 *  can swap `.html` ↔ `.json` cleanly when the format toggle changes. */
function stripKnownExtension(name: string): string {
  return name.replace(/\.(html|json)$/i, '');
}

function todayIso(): string {
  // YYYY-MM-DD (UTC-day-stable for filenames). The export `generatedAt`
  // field uses the full ISO string; the filename uses just the date part.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function defaultFilenameForExport(documentName: string, format: ExportFormat): string {
  // Drop the source `.pdf` from displayName before composing.
  const stem = documentName.replace(/\.pdf$/i, '');
  return `accessibility-report-${stem}-${todayIso()}.${format}`;
}

export function ExportReportDialog({ lastResult }: ExportReportDialogProps): JSX.Element {
  const { t, locale } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const documentName = doc?.displayName ?? 'document';

  const [format, setFormat] = useState<ExportFormat>('html');
  const [includePassed, setIncludePassed] = useState(true);
  const [includeUnevaluated, setIncludeUnevaluated] = useState(true);
  const [filename, setFilename] = useState<string>(() =>
    defaultFilenameForExport(documentName, 'html'),
  );

  // Track whether the user has manually edited the filename. If so we
  // do NOT auto-update on format change (would clobber their edits) —
  // we only swap the extension.
  const [filenameTouched, setFilenameTouched] = useState(false);

  // Resolve the app version once on mount for the HTML footer. Don't
  // block the dialog on it; render with "—" if it never resolves.
  const [appVersion, setAppVersion] = useState<string>('—');
  useEffect(() => {
    void (async () => {
      try {
        const v = await api.app.getVersion();
        if (v.ok) setAppVersion(v.value.appVersion);
      } catch {
        // Swallow — appVersion stays at the fallback.
      }
    })();
  }, []);

  const onClose = (): void => {
    dispatch(exportDialogClosed());
  };

  const onFormatChange = (next: ExportFormat): void => {
    setFormat(next);
    // Swap extension on the current filename. If the user hasn't edited
    // the field, just re-compute the default; otherwise preserve the
    // stem and only change the suffix.
    setFilename((prev) =>
      filenameTouched
        ? `${stripKnownExtension(prev)}.${next}`
        : defaultFilenameForExport(documentName, next),
    );
  };

  const onFilenameChange = (v: string): void => {
    setFilename(v);
    setFilenameTouched(true);
  };

  const valid = isFilenameValid(filename);

  // i18n chrome strings for the HTML template. Resolved at export time
  // so a locale switch mid-edit produces a report in the active locale.
  const chrome: HtmlChromeStrings = useMemo(
    () => ({
      title: t('modals:accessibility.checker.export.html.title'),
      documentLabel: t('modals:accessibility.checker.export.html.documentLabel'),
      ranAtLabel: t('modals:accessibility.checker.export.html.ranAtLabel'),
      generatedAtLabel: t('modals:accessibility.checker.export.html.generatedAtLabel'),
      shippedRulesLabel: t('modals:accessibility.checker.export.html.shippedRulesLabel'),
      summaryHeading: t('modals:accessibility.checker.export.html.summaryHeading'),
      passLabel: t('modals:accessibility.checker.summaryPass'),
      warnLabel: t('modals:accessibility.checker.summaryWarn'),
      failLabel: t('modals:accessibility.checker.summaryFail'),
      unevaluatedLabel: t('modals:accessibility.checker.summaryUnevaluated'),
      omittedLabel: t('modals:accessibility.checker.export.html.omittedLabel'),
      failHeading: t('modals:accessibility.checker.export.html.failHeading'),
      warnHeading: t('modals:accessibility.checker.export.html.warnHeading'),
      unevaluatedHeading: t('modals:accessibility.checker.export.html.unevaluatedHeading'),
      passHeading: t('modals:accessibility.checker.export.html.passHeading'),
      ruleColumn: t('modals:accessibility.checker.export.html.ruleColumn'),
      severityColumn: t('modals:accessibility.checker.export.html.severityColumn'),
      statusColumn: t('modals:accessibility.checker.export.html.statusColumn'),
      messageColumn: t('modals:accessibility.checker.export.html.messageColumn'),
      locationsColumn: t('modals:accessibility.checker.export.html.locationsColumn'),
      pageLabel: t('modals:accessibility.checker.export.html.pageLabel'),
      footerReminder: t('modals:accessibility.checker.export.html.footerReminder'),
    }),
    [t],
  );

  const appName = t('modals:accessibility.checker.export.html.appName');

  const onExport = (): void => {
    if (!valid) return;
    const generatedAt = new Date().toISOString();
    const resolveMessage = (key: string): string => t(key);
    try {
      const content =
        format === 'html'
          ? renderAccessibilityReportHtml({
              value: lastResult,
              documentName,
              generatedAt,
              options: { includePassed, includeUnevaluated },
              resolveMessage,
              appName,
              appVersion,
              locale,
              chrome,
            })
          : serializeAccessibilityReportJson({
              value: lastResult,
              documentName,
              generatedAt,
              options: { includePassed, includeUnevaluated },
              resolveMessage,
            });
      const mimeType =
        format === 'html' ? 'text/html;charset=utf-8' : 'application/json;charset=utf-8';
      downloadBlob({ content, filename, mimeType });
      dispatch(
        pushToast({
          kind: 'success',
          message: t('modals:accessibility.checker.export.toast.success', { path: filename }),
        }),
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch(
        pushToast({
          kind: 'error',
          message: t('modals:accessibility.checker.export.toast.failure', { error: message }),
        }),
      );
    }
  };

  return (
    <ModalShell
      title={t('modals:accessibility.checker.export.dialog.title')}
      onClose={onClose}
      size="md"
      footer={
        <>
          <button
            type="button"
            className={styles.secondary}
            onClick={onClose}
            data-testid="export-cancel"
          >
            {t('modals:accessibility.checker.export.dialog.buttons.cancel')}
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={onExport}
            disabled={!valid}
            data-testid="export-confirm"
          >
            {t('modals:accessibility.checker.export.dialog.buttons.export')}
          </button>
        </>
      }
    >
      <div className={styles.body} data-testid="export-report-dialog">
        <FormatRadio value={format} onChange={onFormatChange} />
        <OptionsCheckboxes
          includePassed={includePassed}
          includeUnevaluated={includeUnevaluated}
          onIncludePassedChange={setIncludePassed}
          onIncludeUnevaluatedChange={setIncludeUnevaluated}
        />
        <div className={styles.field}>
          <span className={styles.fieldLegend}>
            {t('modals:accessibility.checker.export.dialog.subsetDisclosure.lockedLabel')}
          </span>
          <blockquote className={styles.lockedDisclosure} data-testid="export-locked-disclosure">
            {lastResult.subsetDisclosure}
          </blockquote>
        </div>
        <FilenameInput value={filename} onChange={onFilenameChange} invalid={!valid} />
      </div>
    </ModalShell>
  );
}
