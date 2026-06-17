// StampsPanel — Phase 7.5 B7 (Riley Wave 3).
// Per docs/ui-spec-phase-7.5.md §7.
//
// Sidebar tab sibling of Bookmarks / Forms / OCR / Exports. Three groups:
//   - Built-in (10 text stamps from services/builtin-stamps.ts)
//   - My Stamps (user-created text stamps; image kind deferred)
//   - Recently used (drawn from stamps.recentlyUsed)
//
// Clicking a stamp card enters placement mode — the global StampPlacementBanner
// (mounted in app.tsx) shows the placement prompt; the next page-click goes
// through PdfCanvas → buildStampAnnotation + applyEdit.

import { useMemo } from 'react';

import { useT } from '../../i18n/use-t';
import { builtinStampEntries } from '../../services/builtin-stamps';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  enterPlacement,
  removeCustomStamp,
  setAddModalOpen,
  type StampLibraryEntry,
} from '../../state/slices/stamps-slice';

import styles from './stamps-panel.module.css';

interface CardProps {
  stamp: StampLibraryEntry;
  active: boolean;
  onPick: (id: string) => void;
  onRemove?: (id: string) => void;
}

function StampCard(props: CardProps): JSX.Element {
  const { t } = useT();
  const { stamp, active, onPick, onRemove } = props;
  const ariaLabel = t('sidebar:stamps.cardAria', { name: stamp.name });
  const fg = stamp.color
    ? `rgb(${Math.round(stamp.color.r * 255)}, ${Math.round(stamp.color.g * 255)}, ${Math.round(stamp.color.b * 255)})`
    : undefined;
  return (
    <div
      className={`${styles.card} ${active ? styles.cardActive : ''}`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      title={stamp.name}
      onClick={() => onPick(stamp.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick(stamp.id);
        }
      }}
      // eslint-disable-next-line react/forbid-dom-props
      style={fg !== undefined ? { color: fg } : undefined}
    >
      {stamp.text ?? stamp.name}
      {onRemove !== undefined && !stamp.isBuiltin && (
        <button
          type="button"
          className={styles.removeMicroButton}
          aria-label={t('sidebar:stamps.removeAria', { name: stamp.name })}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(stamp.id);
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function StampsPanel(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const customStamps = useAppSelector((s) => s.stamps.customStamps);
  const recentlyUsed = useAppSelector((s) => s.stamps.recentlyUsed);
  const placementId = useAppSelector((s) => s.stamps.placement.stampId);

  // Resolve the built-in catalog inside a memo so the i18n function (closure
  // over `t`) updates on locale switch. The 10-entry list is tiny so the cost
  // is negligible.
  const builtins = useMemo(() => builtinStampEntries(t), [t]);

  // Recently-used set — order by most-recent timestamp, limit to 4. The
  // "recently used" group joins both built-in and custom stamps.
  const recent = useMemo(() => {
    const all = new Map<string, StampLibraryEntry>();
    builtins.forEach((s) => all.set(s.id, s));
    customStamps.forEach((s) => all.set(s.id, s));
    const ids = Object.entries(recentlyUsed).sort((a, b) => b[1] - a[1]);
    const resolved: StampLibraryEntry[] = [];
    for (const [id] of ids) {
      const s = all.get(id);
      if (s !== undefined) resolved.push(s);
      if (resolved.length >= 4) break;
    }
    return resolved;
  }, [builtins, customStamps, recentlyUsed]);

  return (
    <section className={styles.panel} aria-label={t('sidebar:stamps.label')}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('sidebar:stamps.label')}</h2>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => dispatch(setAddModalOpen(true))}
          aria-label={t('sidebar:stamps.addButton')}
        >
          {t('sidebar:stamps.addButton')}
        </button>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupLabel}>{t('sidebar:stamps.builtIn')}</h3>
        <div className={styles.grid}>
          {builtins.map((s) => (
            <StampCard
              key={s.id}
              stamp={s}
              active={placementId === s.id}
              onPick={(id) => dispatch(enterPlacement(id))}
            />
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupLabel}>{t('sidebar:stamps.mine')}</h3>
        {customStamps.length === 0 ? (
          <p className={styles.empty}>{t('sidebar:stamps.empty')}</p>
        ) : (
          <div className={styles.grid}>
            {customStamps.map((s) => (
              <StampCard
                key={s.id}
                stamp={s}
                active={placementId === s.id}
                onPick={(id) => dispatch(enterPlacement(id))}
                onRemove={(id) => dispatch(removeCustomStamp(id))}
              />
            ))}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupLabel}>{t('sidebar:stamps.recent')}</h3>
          <div className={styles.grid}>
            {recent.map((s) => (
              <StampCard
                key={`recent-${s.id}`}
                stamp={s}
                active={placementId === s.id}
                onPick={(id) => dispatch(enterPlacement(id))}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
