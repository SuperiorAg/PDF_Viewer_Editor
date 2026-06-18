// FindAToolPalette — Phase 7.5 A7 (Riley).
// Ctrl+/ opens a centered modal that fuzzy-matches the tool registry. Selecting
// a result dispatches the tool's `dispatch(...)` and closes the palette.
//
// Reads exclusively from `src/client/tools/registry.ts` so every Bucket B and
// Bucket C tool surfaces automatically once it's registered there.
//
// Accessibility per docs/ui-spec-phase-7.5.md §1.7:
//   role="dialog" + aria-modal="true"
//   autoFocus on the search input is allowed inside role="dialog"
//   role="listbox" / role="option" with aria-selected on the active item

import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../../i18n/use-t';
import { formatShortcutById } from '../../shortcuts';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectFindAToolOpen } from '../../state/slices/ui-selectors';
import { setFindAToolOpen } from '../../state/slices/ui-slice';
import { store } from '../../state/store';
import { TOOLS, scoreTool, type ToolDef } from '../../tools/registry';

import styles from './find-a-tool-palette.module.css';

const MAX_RESULTS = 12;

export function FindAToolPalette(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const open = useAppSelector(selectFindAToolOpen);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset when (re)opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // The autoFocus prop is sufficient on most paths, but on a re-open via
      // shortcut the input's already mounted — focus it explicitly.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Filter + sort against the registry. Default (empty query) shows the
  // first MAX_RESULTS tools enabled in the current state — discoverability.
  const matches = useMemo<ReadonlyArray<ToolDef>>(() => {
    if (!open) return [];
    const state = store.getState();
    const enabled = TOOLS.filter(
      (tool) => tool.surfaces.palette !== false && tool.enabledWhen(state),
    );
    if (query.trim() === '') return enabled.slice(0, MAX_RESULTS);
    const scored = enabled.map((tool) => {
      const name = t(tool.nameKey);
      const score = scoreTool(query, name, tool.searchKeywords);
      return { tool, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter((s) => s.score > 0)
      .slice(0, MAX_RESULTS)
      .map((s) => s.tool);
  }, [open, query, t]);

  // Re-clamp activeIndex when matches shrink.
  useEffect(() => {
    if (activeIndex >= matches.length) setActiveIndex(Math.max(0, matches.length - 1));
  }, [activeIndex, matches.length]);

  const runTool = (tool: ToolDef): void => {
    tool.dispatch(dispatch, store.getState());
    dispatch(setFindAToolOpen(false));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dispatch(setFindAToolOpen(false));
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(matches.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      const m = matches[activeIndex];
      if (m) {
        e.preventDefault();
        runTool(m);
      }
    }
  };

  if (!open) return null;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop is non-interactive (Esc closes via the inner dialog's key handler); the click handler is a courtesy click-outside-to-close.
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) dispatch(setFindAToolOpen(false));
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the dialog owns its own keydown for arrow-up/down/enter/esc navigation; the input + listbox children are interactive. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="find-a-tool-title"
        className={styles.palette}
        onKeyDown={onKeyDown}
      >
        <label id="find-a-tool-title" className={styles.srOnly}>
          {t('modals:findATool.title')}
        </label>
        <input
          ref={inputRef}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- per docs/ui-spec-phase-7.5.md §1.7 (dialog-autofocus carve-out)
          autoFocus
          type="search"
          role="searchbox"
          aria-autocomplete="list"
          aria-controls="find-a-tool-results"
          className={styles.input}
          placeholder={t('modals:findATool.placeholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
        />
        <ul
          id="find-a-tool-results"
          role="listbox"
          className={styles.list}
          aria-label={t('modals:findATool.regionAria')}
        >
          {matches.length === 0 ? (
            <li className={styles.noResults}>{t('modals:findATool.noResults', { query })}</li>
          ) : (
            matches.map((tool, i) => {
              // Wave 5d follow-up (Riley) — resolve the chord text at render
              // time from the global shortcut registry. Surfaces the keyboard
              // chord next to the tool name so palette discoverability covers
              // accelerators (e.g. Ctrl+Shift+A for Run Accessibility Check).
              const chord = tool.shortcutId !== null ? formatShortcutById(tool.shortcutId) : null;
              return (
                <li
                  key={tool.id}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`${styles.item} ${i === activeIndex ? styles.itemActive : ''}`}
                >
                  {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- keyboard nav lives on the listbox container's onKeyDown (Enter selects activeIndex); mouse click on a row is a redundant fast-path. */}
                  <span
                    className={styles.itemRow}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => runTool(tool)}
                  >
                    <span className={styles.itemName}>{t(tool.nameKey)}</span>
                    {chord !== null && (
                      <span
                        className={styles.itemShortcut}
                        data-testid={`palette-shortcut-${tool.id}`}
                      >
                        {chord}
                      </span>
                    )}
                    <span className={styles.itemMenu}>
                      {t('modals:findATool.menuSuffix', { menu: tool.menu.top })}
                    </span>
                  </span>
                </li>
              );
            })
          )}
        </ul>
        <div className={styles.instructions}>{t('modals:findATool.instructions')}</div>
      </div>
    </div>
  );
}
