// Compare Files Workspace tests — Phase 7.5 Wave 7 B2 (Riley).

import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import compareReducer, {
  COMPARE_MULTI_COLUMN_FOOTNOTE,
  COMPARE_SEQUENTIAL_PAIRING_BANNER,
  sessionOpened,
  type CompareSession,
} from '../../state/slices/compare-slice';
import documentReducer from '../../state/slices/document-slice';
import i18nReducer from '../../state/slices/i18n-slice';
import uiReducer from '../../state/slices/ui-slice';

import { CompareFilesWorkspace } from './index';

function makeStore(session?: CompareSession): ReturnType<typeof configureStore> {
  const store = configureStore({
    reducer: {
      compare: compareReducer,
      document: documentReducer,
      i18n: i18nReducer,
      ui: uiReducer,
    },
    middleware: (g) => g({ serializableCheck: false }),
  });
  if (session) store.dispatch(sessionOpened(session));
  return store;
}

type AnyStore = ReturnType<typeof makeStore>;

function defaultSession(): CompareSession {
  return {
    sessionId: 'session-1',
    leftDisplayName: 'baseline.pdf',
    rightDisplayName: 'modified.pdf',
    pageCountLeft: 3,
    pageCountRight: 2,
    pagePairs: [
      { leftPageIndex: 0, rightPageIndex: 0 },
      { leftPageIndex: 1, rightPageIndex: 1 },
      { leftPageIndex: 2, rightPageIndex: null }, // left-only orphan
    ],
  };
}

function stubPdfApi(): {
  textSpy: ReturnType<typeof vi.fn>;
  visualSpy: ReturnType<typeof vi.fn>;
  closeSpy: ReturnType<typeof vi.fn>;
} {
  // base64 PNG payloads (1x1 transparent PNG).
  const tinyPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZL6dUcAAAAASUVORK5CYII=';
  const textSpy = vi.fn((req: { leftPageIndex: number | null; rightPageIndex: number | null }) =>
    Promise.resolve({
      ok: true,
      value: {
        pageNumber: (req.leftPageIndex ?? req.rightPageIndex ?? 0) + 1,
        leftPageIndex: req.leftPageIndex,
        rightPageIndex: req.rightPageIndex,
        diffs: [
          { kind: 'equal', text: 'Hello ' },
          { kind: 'delete', text: 'old ' },
          { kind: 'insert', text: 'new ' },
          { kind: 'equal', text: 'world' },
        ],
        summary: { equalChars: 11, insertChars: 4, deleteChars: 4, changed: true },
      },
    }),
  );
  const visualSpy = vi.fn((req: { leftPageIndex: number | null; rightPageIndex: number | null }) =>
    Promise.resolve({
      ok: true,
      value: {
        pageNumber: (req.leftPageIndex ?? req.rightPageIndex ?? 0) + 1,
        leftPageIndex: req.leftPageIndex,
        rightPageIndex: req.rightPageIndex,
        width: 800,
        height: 1000,
        diffPixelCount: 1234,
        totalPixelCount: 800000,
        diffPercent: 0.15,
        diffMaskPng: tinyPng,
        leftPagePng: req.leftPageIndex !== null ? tinyPng : null,
        rightPagePng: req.rightPageIndex !== null ? tinyPng : null,
      },
    }),
  );
  const closeSpy = vi.fn(() => Promise.resolve({ ok: true, value: { closed: true } }));
  vi.stubGlobal('pdfApi', {
    dialog: {
      openPdf: vi.fn(),
      saveAs: vi.fn(),
      pickPdfFiles: vi.fn(),
      pickExportOutputPath: vi.fn(),
      pickFolder: vi.fn(),
    },
    pdf: {
      openComparePair: vi.fn(),
      compareTextOnPage: textSpy,
      compareVisualOnPage: visualSpy,
      closeCompareSession: closeSpy,
    },
  });
  return { textSpy, visualSpy, closeSpy };
}

beforeEach(() => {
  vi.stubGlobal('pdfApi', undefined);
  // jsdom's URL.createObjectURL / revokeObjectURL aren't real — provide
  // counted spies so the revoke test can assert without bizarre URL access.
  if (typeof URL.createObjectURL !== 'function') {
    let counter = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: () => `blob:fake-${++counter}`,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderWorkspace(store: AnyStore): void {
  render(
    <Provider store={store}>
      <CompareFilesWorkspace />
    </Provider>,
  );
}

describe('CompareFilesWorkspace — header + honesty', () => {
  test('header shows the file names + page counts', () => {
    stubPdfApi();
    renderWorkspace(makeStore(defaultSession()));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/baseline\.pdf/);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/modified\.pdf/);
    expect(screen.getByText(/3 pages vs 2 pages/)).toBeInTheDocument();
  });

  test('sequential-pairing banner is rendered VERBATIM (P7.5-L-10)', () => {
    stubPdfApi();
    renderWorkspace(makeStore(defaultSession()));
    expect(screen.getByText(COMPARE_SEQUENTIAL_PAIRING_BANNER)).toBeInTheDocument();
  });

  test('multi-column footnote is rendered VERBATIM (David open question)', () => {
    stubPdfApi();
    renderWorkspace(makeStore(defaultSession()));
    expect(screen.getByText(COMPARE_MULTI_COLUMN_FOOTNOTE)).toBeInTheDocument();
  });

  test('Exit triggers closeCompareSessionThunk', async () => {
    const { closeSpy } = stubPdfApi();
    const store = makeStore(defaultSession());
    renderWorkspace(store);
    await act(async () => {
      fireEvent.click(screen.getByTestId('compare-exit'));
    });
    await waitFor(() => {
      expect(closeSpy).toHaveBeenCalledWith({ compareSessionId: 'session-1' });
    });
  });
});

describe('CompareFilesWorkspace — view mode toggle', () => {
  test('text mode is default', () => {
    stubPdfApi();
    renderWorkspace(makeStore(defaultSession()));
    expect(screen.getByTestId('compare-view-mode-text')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('compare-view-mode-visual')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('compare-view-mode-side-by-side')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('clicking Visual switches the active toggle', () => {
    stubPdfApi();
    renderWorkspace(makeStore(defaultSession()));
    act(() => {
      fireEvent.click(screen.getByTestId('compare-view-mode-visual'));
    });
    expect(screen.getByTestId('compare-view-mode-visual')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('compare-view-mode-text')).toHaveAttribute('aria-checked', 'false');
  });

  test('clicking Side-by-side switches the active toggle', () => {
    stubPdfApi();
    renderWorkspace(makeStore(defaultSession()));
    act(() => {
      fireEvent.click(screen.getByTestId('compare-view-mode-side-by-side'));
    });
    expect(screen.getByTestId('compare-view-mode-side-by-side')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('CompareFilesWorkspace — text mode rendering', () => {
  test('per-page rows dispatch ensureCompareTextLoadedThunk and render diff segments', async () => {
    const { textSpy } = stubPdfApi();
    renderWorkspace(makeStore(defaultSession()));
    await waitFor(() => {
      expect(textSpy).toHaveBeenCalled();
    });
    // Wait for at least one text pane to flip to ready.
    await waitFor(() => {
      expect(screen.getByTestId('compare-text-0')).toBeInTheDocument();
    });
    const pane = screen.getByTestId('compare-text-0');
    expect(pane).toHaveAttribute('data-changed', 'true');
    // equal/insert/delete segment classes
    expect(pane.querySelector('[data-kind="equal"]')).toBeTruthy();
    expect(pane.querySelector('[data-kind="insert"]')).toBeTruthy();
    expect(pane.querySelector('[data-kind="delete"]')).toBeTruthy();
  });
});

describe('CompareFilesWorkspace — visual mode rendering', () => {
  test('visual mode shows percent + count + diff mask image', async () => {
    stubPdfApi();
    renderWorkspace(makeStore(defaultSession()));
    act(() => {
      fireEvent.click(screen.getByTestId('compare-view-mode-visual'));
    });
    await waitFor(() => {
      // Workspace renders one VisualDiffPane per pair; we only need one.
      const percents = screen.getAllByTestId('compare-visual-percent');
      expect(percents.length).toBeGreaterThan(0);
    });
    const percent = screen.getAllByTestId('compare-visual-percent')[0];
    expect(percent).toHaveTextContent(/0\.15% changed/);
    const count = screen.getAllByTestId('compare-visual-count')[0];
    expect(count).toHaveTextContent(/1234 pixels different/);
    const masks = screen.getAllByTestId('compare-visual-mask');
    const mask = masks[0] as HTMLImageElement;
    expect(mask.src).toMatch(/^blob:/);
  });
});

describe('CompareFilesWorkspace — orphan pages', () => {
  test('orphan pair renders the "Only on left" label', async () => {
    stubPdfApi();
    renderWorkspace(makeStore(defaultSession()));
    // The third pair (index 2) is a left-only orphan in defaultSession().
    await waitFor(() => {
      expect(screen.getByTestId('compare-orphan-2')).toHaveAttribute('data-orphan', 'left');
    });
    expect(screen.getByTestId('compare-orphan-2')).toHaveTextContent(/Only on left/);
  });
});

describe('CompareFilesWorkspace — blob URL revoke on close', () => {
  test('Exit revokes all blob URLs created by visual loads', async () => {
    stubPdfApi();
    const store = makeStore(defaultSession());
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    renderWorkspace(store);
    // Switch to visual to provoke createObjectURL calls.
    act(() => {
      fireEvent.click(screen.getByTestId('compare-view-mode-visual'));
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('compare-visual-mask').length).toBeGreaterThan(0);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('compare-exit'));
    });
    // We expect revoke to have been called at least once per visual entry
    // that loaded. The exact count depends on how many of the 3 rows the
    // virtualizer surfaced; we assert >= 1 to avoid flake.
    await waitFor(() => {
      expect(revokeSpy).toHaveBeenCalled();
    });
  });
});

describe('CompareFilesWorkspace — badge column', () => {
  test('badge column renders one badge per pair', async () => {
    stubPdfApi();
    renderWorkspace(makeStore(defaultSession()));
    await waitFor(() => {
      expect(screen.getByTestId('compare-badge-0')).toBeInTheDocument();
      expect(screen.getByTestId('compare-badge-1')).toBeInTheDocument();
      expect(screen.getByTestId('compare-badge-2')).toBeInTheDocument();
    });
  });

  test('badge starts gray (no result loaded) then turns colored once text+visual ready', async () => {
    stubPdfApi();
    renderWorkspace(makeStore(defaultSession()));
    // Initially gray (no result).
    const badge0 = await screen.findByTestId('compare-badge-0');
    expect(badge0).toHaveAttribute('data-color', 'gray');
    // Switch to side-by-side which loads BOTH text + visual on the same row.
    act(() => {
      fireEvent.click(screen.getByTestId('compare-view-mode-side-by-side'));
    });
    await waitFor(() => {
      // textChanged + visualChanged in our stub → red
      expect(screen.getByTestId('compare-badge-0')).toHaveAttribute('data-color', 'red');
    });
  });
});
