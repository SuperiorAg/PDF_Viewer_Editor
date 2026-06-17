// FindBar — Phase 7.5 B3 (Riley).
// Anchored top-right of the viewer; opens on Ctrl+F; F3 / Shift+F3 advance the
// active match; supports case-sensitive + whole-word toggles.
//
// Performance discipline (P7.5-L-8 in docs/architecture-phase-7.5.md):
//   - Lazy per-page text extraction via `PdfPageProxy.getTextString()`. No
//     eager full-document index thread. Each page's text is fetched at most
//     once per find-bar session and cached in a module-scope WeakMap keyed by
//     the PdfDocumentProxy so subsequent finds in the same doc are free.
//   - "Searching page N of M..." feedback per the ui-spec §3.1.
//
// Accessibility:
//   - role="search" container with aria-label.
//   - Match counter is aria-live="polite".
//   - Toggles use aria-pressed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../../i18n/use-t';
import { loadDocumentByHandle, type PdfLoaderResult } from '../../services/pdf-loader';
import { type PdfDocumentProxy, type PdfPageProxy } from '../../services/pdf-render';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { selectFindBarOpen } from '../../state/slices/ui-selectors';
import { setFindBarOpen } from '../../state/slices/ui-slice';
import { setCurrentPage } from '../../state/slices/viewport-slice';

import styles from './find-bar.module.css';

// Module-scope cache: per-document page-text cache. Lives only while the doc
// is loaded — `releaseLoadedDocument` destroying the proxy invalidates the
// WeakMap entry via GC.
const docTextCache = new WeakMap<PdfDocumentProxy, Map<number, string>>();

interface Match {
  pageIndex: number;
  start: number; // char offset within the page's text
  length: number;
}

interface FindState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  matches: ReadonlyArray<Match>;
  activeIndex: number; // 0..matches.length-1, or -1 when no match
  searching: boolean;
  searchProgress: { current: number; total: number } | null;
}

const initialState: FindState = {
  query: '',
  caseSensitive: false,
  wholeWord: false,
  matches: [],
  activeIndex: -1,
  searching: false,
  searchProgress: null,
};

function buildRegex(query: string, caseSensitive: boolean, wholeWord: boolean): RegExp | null {
  if (query === '') return null;
  // Escape regex meta-chars in the query so the user's literal text matches.
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
  const flags = caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

async function getPageText(doc: PdfDocumentProxy, pageIndex: number): Promise<string> {
  let entry = docTextCache.get(doc);
  if (entry === undefined) {
    entry = new Map<number, string>();
    docTextCache.set(doc, entry);
  }
  const cached = entry.get(pageIndex);
  if (cached !== undefined) return cached;
  let page: PdfPageProxy | null = null;
  try {
    page = await doc.getPage(pageIndex);
    const text = await page.getTextString();
    entry.set(pageIndex, text);
    return text;
  } finally {
    if (page) page.cleanup();
  }
}

export function FindBar(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const open = useAppSelector(selectFindBarOpen);
  const docModel = useAppSelector(selectCurrentDocument);
  const [state, setState] = useState<FindState>(initialState);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  const pageCount = docModel?.pageCount ?? 0;
  const handle = docModel?.handle;

  // Reset state when the bar closes or the document changes.
  useEffect(() => {
    if (!open) {
      cancelRef.current?.cancelled === false && (cancelRef.current.cancelled = true);
      setState(initialState);
      return;
    }
    if (inputRef.current) inputRef.current.focus();
  }, [open, handle]);

  const runSearch = useCallback(
    async (query: string, caseSensitive: boolean, wholeWord: boolean): Promise<void> => {
      // Cancel any in-flight search.
      if (cancelRef.current) cancelRef.current.cancelled = true;
      const myToken = { cancelled: false };
      cancelRef.current = myToken;
      const regex = buildRegex(query, caseSensitive, wholeWord);
      if (regex === null || handle === undefined || pageCount === 0) {
        setState((s) => ({
          ...s,
          query,
          caseSensitive,
          wholeWord,
          matches: [],
          activeIndex: -1,
          searching: false,
          searchProgress: null,
        }));
        return;
      }
      setState((s) => ({
        ...s,
        query,
        caseSensitive,
        wholeWord,
        searching: true,
        searchProgress: { current: 0, total: pageCount },
      }));
      let res: PdfLoaderResult;
      try {
        res = await loadDocumentByHandle(handle);
      } catch {
        if (myToken.cancelled) return;
        setState((s) => ({ ...s, searching: false, searchProgress: null }));
        return;
      }
      if (myToken.cancelled) return;
      if (!res.ok) {
        setState((s) => ({ ...s, searching: false, searchProgress: null }));
        return;
      }
      const doc = res.doc;
      const allMatches: Match[] = [];
      // Walk pages 0..pageCount-1 lazily so the very first page's matches
      // surface immediately. Yield to the event loop between pages so the UI
      // remains responsive on large docs.
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        if (myToken.cancelled) return;
        let text: string;
        try {
          text = await getPageText(doc, pageIndex);
        } catch {
          continue;
        }
        if (myToken.cancelled) return;
        regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(text)) !== null) {
          allMatches.push({
            pageIndex,
            start: m.index,
            length: m[0].length,
          });
          // Defensive: zero-width matches would loop forever.
          if (m[0].length === 0) regex.lastIndex++;
        }
        const progress = pageIndex + 1;
        setState((s) =>
          s !== null && cancelRef.current === myToken
            ? {
                ...s,
                searchProgress: { current: progress, total: pageCount },
                matches: allMatches.slice(),
                activeIndex: s.activeIndex < 0 && allMatches.length > 0 ? 0 : s.activeIndex,
              }
            : s,
        );
        // Yield every page so the UI can render the partial progress.
        await new Promise((r) => setTimeout(r, 0));
      }
      if (myToken.cancelled) return;
      setState((s) => ({
        ...s,
        searching: false,
        searchProgress: null,
        matches: allMatches,
        activeIndex: allMatches.length > 0 ? Math.max(0, s.activeIndex) : -1,
      }));
    },
    [handle, pageCount],
  );

  // Trigger search on query / toggle changes (debounced).
  const queryRef = useRef(state.query);
  queryRef.current = state.query;
  useEffect(() => {
    if (!open) return;
    const q = state.query;
    const cs = state.caseSensitive;
    const ww = state.wholeWord;
    const handle = setTimeout(() => {
      void runSearch(q, cs, ww);
    }, 180);
    return () => clearTimeout(handle);
  }, [open, state.query, state.caseSensitive, state.wholeWord, runSearch]);

  // Jump the viewer to the page of the active match.
  useEffect(() => {
    if (state.activeIndex < 0) return;
    const m = state.matches[state.activeIndex];
    if (!m) return;
    dispatch(setCurrentPage(m.pageIndex));
  }, [dispatch, state.activeIndex, state.matches]);

  const advance = useCallback((delta: 1 | -1) => {
    setState((s) => {
      if (s.matches.length === 0) return s;
      const next = (s.activeIndex + delta + s.matches.length) % s.matches.length;
      return { ...s, activeIndex: next };
    });
  }, []);

  // F3 / Shift+F3 + Esc handlers — local to the bar's input.
  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        advance(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        dispatch(setFindBarOpen(false));
      }
    },
    [advance, dispatch],
  );

  const counterText = useMemo(() => {
    if (state.searching && state.matches.length === 0) {
      const p = state.searchProgress;
      return p ? t('modals:find.searchingPage', { current: p.current, total: p.total }) : '';
    }
    if (state.matches.length === 0 && state.query !== '') {
      return t('modals:find.noMatches');
    }
    if (state.matches.length === 0) return '';
    return t('modals:find.matchCounter', {
      count: state.matches.length,
      current: state.activeIndex + 1,
      total: state.matches.length,
    });
  }, [state, t]);

  if (!open) return null;

  return (
    <div role="search" aria-label={t('modals:find.bar')} className={styles.bar}>
      <input
        ref={inputRef}
        type="search"
        className={styles.input}
        placeholder={t('modals:find.placeholder')}
        value={state.query}
        onChange={(e) => setState((s) => ({ ...s, query: e.target.value, activeIndex: -1 }))}
        onKeyDown={onInputKeyDown}
        aria-label={t('modals:find.placeholder')}
      />
      <span className={styles.counter} aria-live="polite">
        {counterText}
      </span>
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={state.caseSensitive}
        aria-label={t('modals:find.caseSensitive')}
        title={t('modals:find.caseSensitive')}
        onClick={() =>
          setState((s) => ({ ...s, caseSensitive: !s.caseSensitive, activeIndex: -1 }))
        }
      >
        Aa
      </button>
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={state.wholeWord}
        aria-label={t('modals:find.wholeWord')}
        title={t('modals:find.wholeWord')}
        onClick={() => setState((s) => ({ ...s, wholeWord: !s.wholeWord, activeIndex: -1 }))}
      >
        |W|
      </button>
      <button
        type="button"
        className={styles.navButton}
        aria-label={t('modals:find.previous')}
        title={t('modals:find.previous')}
        disabled={state.matches.length === 0}
        onClick={() => advance(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.navButton}
        aria-label={t('modals:find.next')}
        title={t('modals:find.next')}
        disabled={state.matches.length === 0}
        onClick={() => advance(1)}
      >
        ↓
      </button>
      <button
        type="button"
        className={styles.closeButton}
        aria-label={t('modals:find.close')}
        title={t('modals:find.close')}
        onClick={() => dispatch(setFindBarOpen(false))}
      >
        ×
      </button>
    </div>
  );
}
