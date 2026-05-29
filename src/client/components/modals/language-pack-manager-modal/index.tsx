// LanguagePackManagerModal — Phase 5 language-pack inventory + downloader.
// Per docs/ui-spec.md §14.5 and docs/architecture-phase-5.md §4.3.
//
// Trust-floor honesty obligation #2: "OCR runs locally; no cloud upload.
// Language packs are downloaded from Tesseract's official upstream on first
// use." Surfaced inline in this modal.

import { useEffect } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import {
  selectOcrDownloadProgress,
  selectOcrDownloadablePacks,
  selectOcrInstalledPacks,
} from '../../../state/slices/ocr-selectors';
import { closeOcrModal } from '../../../state/slices/ocr-slice';
import {
  detectLanguagesThunk,
  downloadLanguagePackThunk,
  removeLanguagePackThunk,
} from '../../../state/thunks-phase5';
import { type LanguagePack, type LanguagePackCatalogEntry } from '../../../types/ipc-contract';
import { ModalShell } from '../modal-shell';

import styles from './language-pack-manager-modal.module.css';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

function formatLastUsed(lastUsedAt: number | null, t: ReturnType<typeof useT>['t']): string {
  if (lastUsedAt === null) return t('modals:languagePack.neverUsed');
  const days = Math.floor((Date.now() - lastUsedAt) / (1000 * 60 * 60 * 24));
  if (days === 0) return t('modals:languagePack.today');
  if (days === 1) return t('modals:languagePack.yesterday');
  return t('modals:languagePack.daysAgo', { count: days });
}

interface InstalledPackRowProps {
  pack: LanguagePack;
  onRemove: (lang: string) => void;
}

function InstalledPackRow(props: InstalledPackRowProps): JSX.Element {
  const { t } = useT();
  const { pack } = props;
  const isBundled = pack.source === 'bundled';
  return (
    <div className={styles.packRow}>
      <div className={styles.packName}>
        <span>{pack.displayName}</span>
        <span className={styles.packLangCode}>
          {pack.lang} · {formatSize(pack.sizeBytes)} · {formatLastUsed(pack.lastUsedAt, t)}
        </span>
      </div>
      {isBundled ? (
        <span className={styles.bundledTag}>{t('modals:languagePack.bundled')}</span>
      ) : (
        <span className={styles.packMeta}>{t('modals:languagePack.downloaded')}</span>
      )}
      {isBundled ? (
        <span className={styles.packMeta} title={t('modals:languagePack.bundledCannotRemove')}>
          —
        </span>
      ) : (
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
          onClick={() => props.onRemove(pack.lang)}
        >
          {t('modals:languagePack.remove')}
        </button>
      )}
    </div>
  );
}

interface DownloadablePackRowProps {
  entry: LanguagePackCatalogEntry;
  onDownload: (lang: string) => void;
  inFlightPhase: string | null;
  bytesDownloaded: number;
  totalBytes: number;
}

function DownloadablePackRow(props: DownloadablePackRowProps): JSX.Element {
  const { t } = useT();
  const { entry, inFlightPhase } = props;
  const isInFlight =
    inFlightPhase === 'starting' ||
    inFlightPhase === 'downloading' ||
    inFlightPhase === 'verifying';
  const percent =
    props.totalBytes > 0 ? Math.round((props.bytesDownloaded / props.totalBytes) * 100) : 0;
  return (
    <div className={styles.packRow}>
      <div className={styles.packName}>
        <span>{entry.displayName}</span>
        <span className={styles.packLangCode}>
          {entry.lang} · ~{formatSize(entry.sizeBytes)}
        </span>
      </div>
      <span className={styles.packMeta}>{t('modals:languagePack.availableTag')}</span>
      <button
        type="button"
        className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
        disabled={isInFlight}
        onClick={() => props.onDownload(entry.lang)}
      >
        {isInFlight ? t('modals:languagePack.downloadingShort') : t('modals:languagePack.download')}
      </button>
      {isInFlight && (
        <>
          <div className={styles.downloadProgressBar}>
            <div className={styles.downloadProgressFill} style={{ width: `${String(percent)}%` }} />
          </div>
          <span className={styles.downloadPhaseLabel}>
            {t('modals:languagePack.downloadPhase', { phase: inFlightPhase ?? '', percent })}
          </span>
        </>
      )}
    </div>
  );
}

export function LanguagePackManagerModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const installed = useAppSelector(selectOcrInstalledPacks);
  const downloadable = useAppSelector(selectOcrDownloadablePacks);
  const downloadProgress = useAppSelector(selectOcrDownloadProgress);

  useEffect(() => {
    void dispatch(detectLanguagesThunk());
  }, [dispatch]);

  const onClose = (): void => {
    dispatch(closeOcrModal());
  };

  return (
    <ModalShell title={t('modals:languagePack.title')} onClose={onClose} size="lg">
      <div className={styles.body}>
        <section className={styles.section}>
          <h3 className={styles.sectionHeader}>{t('modals:languagePack.installed')}</h3>
          {installed.length === 0 ? (
            <div className={styles.emptyState}>{t('modals:languagePack.empty')}</div>
          ) : (
            <div className={styles.packList}>
              {installed.map((pack) => (
                <InstalledPackRow
                  key={pack.lang}
                  pack={pack}
                  onRemove={(lang) => void dispatch(removeLanguagePackThunk({ lang }))}
                />
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionHeader}>{t('modals:languagePack.available')}</h3>
          {downloadable.length === 0 ? (
            <div className={styles.emptyState}>{t('modals:languagePack.allInstalled')}</div>
          ) : (
            <div className={styles.packList}>
              {downloadable.map((entry) => {
                const progress = downloadProgress[entry.lang];
                return (
                  <DownloadablePackRow
                    key={entry.lang}
                    entry={entry}
                    onDownload={(lang) => void dispatch(downloadLanguagePackThunk({ lang }))}
                    inFlightPhase={progress?.phase ?? null}
                    bytesDownloaded={progress?.bytesDownloaded ?? 0}
                    totalBytes={progress?.totalBytes ?? entry.sizeBytes}
                  />
                );
              })}
            </div>
          )}
        </section>

        <div className={styles.honestyReminder}>{t('modals:languagePack.honestyReminder')}</div>

        <div className={styles.footer}>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            {t('modals:languagePack.close')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
