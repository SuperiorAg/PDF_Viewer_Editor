import { useEffect } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectRecents } from '../../state/slices/recents-selectors';
import {
  clearRecentsThunk,
  openDocumentThunk,
  openDroppedPathThunk,
  refreshRecentsThunk,
} from '../../state/thunks';

import styles from './empty-state.module.css';

export function EmptyState(): JSX.Element {
  const { t, locale } = useT();
  const dispatch = useAppDispatch();
  const recents = useAppSelector(selectRecents);

  useEffect(() => {
    void dispatch(refreshRecentsThunk());
  }, [dispatch]);

  // Locale-aware relative time via t() plural keys + Intl for the fallback date
  // (conventions §18.4.7 — no date-fns).
  const formatRelative = (ts: number): string => {
    const diffMs = Date.now() - ts;
    const min = Math.round(diffMs / 60000);
    if (min < 1) return t('common:justNow');
    if (min < 60) return t('common:minAgo', { count: min });
    const hr = Math.round(min / 60);
    if (hr < 24) return t('common:hrAgo', { count: hr });
    const day = Math.round(hr / 24);
    if (day < 7) return t('common:dayAgo', { count: day });
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ts));
  };

  return (
    <div className={styles.empty} role="region" aria-label={t('common:welcome')}>
      <svg className={styles.icon} viewBox="0 0 64 80" aria-hidden="true" focusable="false">
        <path
          d="M10 4 H42 L54 16 V72 a4 4 0 0 1 -4 4 H10 a4 4 0 0 1 -4 -4 V8 a4 4 0 0 1 4 -4 z"
          fill="var(--color-bg-surface)"
          stroke="var(--color-border-strong)"
          strokeWidth="2"
        />
        <path
          d="M42 4 V14 a2 2 0 0 0 2 2 H54"
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth="2"
        />
        <text
          x="32"
          y="56"
          textAnchor="middle"
          fontFamily="var(--font-family-ui)"
          fontSize="14"
          fill="var(--color-text-muted)"
        >
          PDF
        </text>
      </svg>
      <h1 className={styles.heading}>{t('common:emptyHeading')}</h1>
      <button
        type="button"
        className={styles.primaryButton}
        onClick={() => {
          void dispatch(openDocumentThunk());
        }}
      >
        {t('common:openFile')}
      </button>
      <p className={styles.hint}>{t('common:dragAndDrop')}</p>

      {recents.length > 0 && (
        <div className={styles.recents}>
          <h2 className={styles.recentsHeading}>{t('common:recentsHeading')}</h2>
          <ul className={styles.recentsList}>
            {recents.slice(0, 5).map((item) => (
              <li key={item.path} className={styles.recentItemWrap}>
                {/* Wave 28a (a11y-audit.md R-6 / §3 Path 1): each recent is a
                    focusable native <button>, activated by Enter/Space, so the
                    open-recent flow has full keyboard parity. Missing files are
                    aria-disabled (still announced, but inert). */}
                <button
                  type="button"
                  className={`${styles.recentItem} ${
                    item.fileStillExists ? '' : styles.recentItemMissing
                  }`}
                  title={item.path}
                  aria-disabled={!item.fileStillExists}
                  aria-label={t('common:openRecentLabel', {
                    name: item.displayName,
                    when: formatRelative(item.lastOpenedAt),
                    missing: item.fileStillExists ? '' : ` ${t('common:fileMissing')}`,
                  })}
                  onClick={() => {
                    if (!item.fileStillExists) return;
                    void dispatch(openDroppedPathThunk(item.path));
                  }}
                >
                  <span className={styles.recentName}>{item.displayName}</span>
                  <span className={styles.recentTime}>{formatRelative(item.lastOpenedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => {
              void dispatch(clearRecentsThunk());
            }}
          >
            {t('common:clearRecents')}
          </button>
        </div>
      )}
    </div>
  );
}
