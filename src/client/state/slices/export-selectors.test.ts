// Export selectors — Phase 6 derived-state tests.
//
// The Phase 1 selectors are exercised indirectly by existing tests; this
// file focuses on the Phase 6 additions, in particular the resolved-quality
// -tier selector (conventions §17.6 — explicit tier resolution).

import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';

import { type ExportFormatDescriptor } from '../../types/ipc-contract';
import { type RootState } from '../store';

import {
  selectExportJobRunning,
  selectExportJobTerminal,
  selectExportModalOpen,
  selectResolvedQualityTier,
} from './export-selectors';
import exportReducer, {
  setDraftFormat,
  setDraftQualityTier,
  setFormatCatalog,
  startJobProgress,
} from './export-slice';

function makeStore() {
  return configureStore({ reducer: { export: exportReducer } });
}
type Store = ReturnType<typeof makeStore>;
function rootify(store: Store): RootState {
  // The selectors take RootState; with our skinny store we still match.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return store.getState() as any as RootState;
}

const CATALOG: ExportFormatDescriptor[] = [
  {
    format: 'docx',
    displayName: 'Word document',
    defaultExtension: 'docx',
    category: 'office',
    supportsQualityTier: true,
    defaultQualityTier: 'layout-preserving',
    defaultIncludeAnnotations: true,
    settingKeys: [],
  },
  {
    format: 'xlsx',
    displayName: 'Excel workbook',
    defaultExtension: 'xlsx',
    category: 'office',
    supportsQualityTier: true,
    defaultQualityTier: 'text-only',
    defaultIncludeAnnotations: false,
    settingKeys: [],
  },
];

describe('selectResolvedQualityTier', () => {
  it('returns "n/a" when no format is picked', () => {
    const store = makeStore();
    expect(selectResolvedQualityTier(rootify(store))).toBe('n/a');
  });

  it('returns "n/a" for image formats regardless of any user override', () => {
    const store = makeStore();
    store.dispatch(setDraftFormat('png'));
    store.dispatch(setDraftQualityTier('layout-preserving'));
    expect(selectResolvedQualityTier(rootify(store))).toBe('n/a');
  });

  it('returns user override when set', () => {
    const store = makeStore();
    store.dispatch(setDraftFormat('docx'));
    store.dispatch(setDraftQualityTier('text-only'));
    expect(selectResolvedQualityTier(rootify(store))).toBe('text-only');
  });

  it('returns catalog default when no user override (docx → layout-preserving)', () => {
    const store = makeStore();
    store.dispatch(setFormatCatalog(CATALOG));
    store.dispatch(setDraftFormat('docx'));
    expect(selectResolvedQualityTier(rootify(store))).toBe('layout-preserving');
  });

  it('returns catalog default when no user override (xlsx → text-only)', () => {
    const store = makeStore();
    store.dispatch(setFormatCatalog(CATALOG));
    store.dispatch(setDraftFormat('xlsx'));
    expect(selectResolvedQualityTier(rootify(store))).toBe('text-only');
  });

  it('falls back to Q-D hardcoded mapping when catalog is null', () => {
    const store = makeStore();
    store.dispatch(setDraftFormat('xlsx'));
    expect(selectResolvedQualityTier(rootify(store))).toBe('text-only');
  });
});

describe('selectExportModalOpen', () => {
  it('false initially', () => {
    expect(selectExportModalOpen(rootify(makeStore()))).toBe(false);
  });
});

describe('selectExportJobRunning / selectExportJobTerminal', () => {
  it('running while phase is in active set', () => {
    const store = makeStore();
    store.dispatch(startJobProgress({ jobId: 1, format: 'docx', totalPages: 5 }));
    expect(selectExportJobRunning(rootify(store))).toBe(true);
    expect(selectExportJobTerminal(rootify(store))).toBe(false);
  });
});
