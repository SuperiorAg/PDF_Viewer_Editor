// CombineModal — Vitest spec. Wave-30 follow-up (H-30.1, L-30.10).
//
// Asserts:
//  1. Renders the title and the +Add files button (no placeholder/empty
//     entries are pushed on click — the old L-30.10 bug).
//  2. Picking files via dialog:pickPdfFiles appends path-kind entries with
//     real labels and the placeholder mode is GONE.
//  3. user_cancelled from the picker is silent (no toast, no entries).
//  4. Submit is disabled with <2 entries and enabled with ≥2.
//  5. Submit dispatches pdf.combine with the expected sources payload;
//     a successful response triggers setDocument; each variant of
//     PdfCombineError maps to its honest user-facing toast string and
//     the "Phase 1 stub" string is GONE.
//  6. Re-picking deduplicates by absolute path.

import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument } from '../../../state/slices/document-slice';
import uiReducer from '../../../state/slices/ui-slice';
import type {
  PdfCombineError,
  PdfCombineResponse,
  PdfCombineValue,
  PDFDocumentModel,
} from '../../../types/ipc-contract';

import { CombineModal } from './index';

const SEED_DOC: PDFDocumentModel = {
  handle: 7,
  displayName: 'seed.pdf',
  fileHash: 'a'.repeat(64),
  pageCount: 3,
  pages: Array.from({ length: 3 }, (_, i) => ({
    pageIndex: i,
    sourcePageRef: { kind: 'original' as const, originalIndex: i },
    rotation: 0 as const,
    width: 612,
    height: 792,
  })),
  annotations: [],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

function makeStore(withSeedDoc = true) {
  const store = configureStore({
    reducer: {
      ui: uiReducer,
      document: documentReducer,
    },
    middleware: (g) => g({ serializableCheck: { ignoredActionPaths: ['payload.bytes'] } }),
  });
  if (withSeedDoc) {
    store.dispatch(setDocument(SEED_DOC));
  }
  return store;
}
type AnyStore = ReturnType<typeof makeStore>;

interface PickPdfFilesResponseOk {
  ok: true;
  value: { paths: string[] };
}
interface PickPdfFilesResponseErr {
  ok: false;
  error: 'user_cancelled' | 'invalid_path' | 'bridge_unavailable';
  message: string;
}
type PickPdfFilesResponse = PickPdfFilesResponseOk | PickPdfFilesResponseErr;

function stubPdfApi(stubs: {
  pickPdfFiles?: (req: { multi?: boolean }) => Promise<PickPdfFilesResponse>;
  combine?: (req: { sources: unknown[] }) => Promise<PdfCombineResponse>;
}): {
  pickSpy: ReturnType<typeof vi.fn>;
  combineSpy: ReturnType<typeof vi.fn>;
} {
  const pickSpy = vi.fn(
    stubs.pickPdfFiles ??
      (() =>
        Promise.resolve<PickPdfFilesResponse>({
          ok: false,
          error: 'user_cancelled',
          message: 'cancelled',
        })),
  );
  const combineSpy = vi.fn(stubs.combine ?? (() => Promise.resolve({ ok: true } as never)));
  vi.stubGlobal('pdfApi', {
    dialog: {
      openPdf: vi.fn(),
      saveAs: vi.fn(),
      pickExportOutputPath: vi.fn(),
      pickPdfFiles: pickSpy,
    },
    pdf: {
      combine: combineSpy,
      export: vi.fn(),
      getOutline: vi.fn(),
      embedImage: vi.fn(),
      replaceText: vi.fn(),
      identifyTextSpan: vi.fn(),
      print: vi.fn(),
    },
  });
  return { pickSpy, combineSpy };
}

beforeEach(() => {
  vi.stubGlobal('pdfApi', undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderModal(store: AnyStore) {
  return render(
    <Provider store={store}>
      <CombineModal />
    </Provider>,
  );
}

describe('CombineModal — Wave-30 wire-up', () => {
  it('renders the title and the + Add files button (no placeholder entries)', () => {
    stubPdfApi({});
    renderModal(makeStore());
    expect(screen.getByRole('dialog', { name: /Combine PDF files/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Add files/i })).toBeInTheDocument();
    // The seeded currently-open document is present (1 entry) — submit
    // should be disabled while < 2 entries.
    expect(screen.getByRole('button', { name: /^Combine$/ })).toBeDisabled();
    // No row should be marked aria-invalid — the L-30.10 placeholder
    // mechanism is GONE.
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it('clicking + Add files calls dialog:pickPdfFiles and appends real path entries', async () => {
    const { pickSpy } = stubPdfApi({
      pickPdfFiles: () =>
        Promise.resolve({
          ok: true,
          value: { paths: ['C:/tmp/one.pdf', '/home/u/two.pdf'] },
        }),
    });
    renderModal(makeStore());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /\+ Add files/i }));
    });
    expect(pickSpy).toHaveBeenCalledWith({ multi: true });
    await waitFor(() => {
      expect(screen.getByText('one.pdf')).toBeInTheDocument();
      expect(screen.getByText('two.pdf')).toBeInTheDocument();
    });
    // Submit is enabled with ≥ 2 entries (the seed doc + 2 paths = 3 entries).
    expect(screen.getByRole('button', { name: /^Combine$/ })).toBeEnabled();
  });

  it('user_cancelled from the picker is silent — no toast, no new rows', async () => {
    stubPdfApi({
      pickPdfFiles: () =>
        Promise.resolve({
          ok: false,
          error: 'user_cancelled',
          message: 'cancelled',
        }),
    });
    const store = makeStore();
    renderModal(store);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /\+ Add files/i }));
    });
    const ui = (store.getState() as { ui: { toasts: { message: string }[] } }).ui;
    expect(ui.toasts).toHaveLength(0);
  });

  it('Submit dispatches pdf.combine with the expected sources and fires setDocument on success', async () => {
    const okValue: PdfCombineValue = {
      handle: 99,
      pageCount: 5,
      displayName: 'combined.pdf',
    };
    const { pickSpy, combineSpy } = stubPdfApi({
      pickPdfFiles: () =>
        Promise.resolve({
          ok: true,
          value: { paths: ['C:/a.pdf', 'C:/b.pdf'] },
        }),
      combine: () => Promise.resolve({ ok: true, value: okValue }),
    });
    const store = makeStore(false); // no seed doc — start from empty
    renderModal(store);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /\+ Add files/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('a.pdf')).toBeInTheDocument();
    });

    expect(pickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /^Combine$/ })).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Combine$/ }));
    });

    expect(combineSpy).toHaveBeenCalledWith({
      sources: [
        { kind: 'path', path: 'C:/a.pdf' },
        { kind: 'path', path: 'C:/b.pdf' },
      ],
    });
    await waitFor(() => {
      const doc = (store.getState() as { document: { current: PDFDocumentModel | null } }).document
        .current;
      expect(doc?.handle).toBe(99);
      expect(doc?.displayName).toBe('combined.pdf');
      expect(doc?.pageCount).toBe(5);
    });
  });

  it.each<{ variant: PdfCombineError; expected: RegExp }>([
    { variant: 'invalid_source', expected: /At least two valid PDF sources/i },
    { variant: 'invalid_page_range', expected: /page ranges is invalid/i },
    { variant: 'handle_not_found', expected: /no longer open/i },
    { variant: 'fs_read_failed', expected: /could not be read/i },
    { variant: 'pdf_load_failed', expected: /not a valid PDF/i },
  ])('maps $variant to its honest toast string', async ({ variant, expected }) => {
    stubPdfApi({
      pickPdfFiles: () =>
        Promise.resolve({
          ok: true,
          value: { paths: ['/x/a.pdf', '/x/b.pdf'] },
        }),
      combine: () =>
        Promise.resolve({
          ok: false,
          error: variant,
          message: 'detail-from-handler',
        }),
    });
    const store = makeStore(false);
    renderModal(store);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /\+ Add files/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('a.pdf')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Combine$/ }));
    });

    const ui = (store.getState() as { ui: { toasts: { message: string; kind: string }[] } }).ui;
    const errorToasts = ui.toasts.filter((t) => t.kind === 'error');
    expect(errorToasts).toHaveLength(1);
    expect(errorToasts[0]?.message).toMatch(expected);
    // The "Phase 1 stub" / "Wave 2 follow-up" string MUST NOT appear in any
    // user-facing toast.
    expect(errorToasts[0]?.message).not.toMatch(/Phase 1 stub/);
    expect(errorToasts[0]?.message).not.toMatch(/Wave 2 follow-up/);
  });

  it('de-duplicates paths across multiple picker invocations', async () => {
    const responses: PickPdfFilesResponse[] = [
      { ok: true, value: { paths: ['C:/x/one.pdf', 'C:/x/two.pdf'] } },
      { ok: true, value: { paths: ['C:/x/two.pdf', 'C:/x/three.pdf'] } },
    ];
    let call = 0;
    stubPdfApi({
      pickPdfFiles: () => Promise.resolve(responses[call++]!),
    });
    const store = makeStore(false);
    renderModal(store);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /\+ Add files/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('two.pdf')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /\+ Add files/i }));
    });
    await waitFor(() => {
      expect(screen.getByText('three.pdf')).toBeInTheDocument();
    });

    // 'two.pdf' should appear exactly once — the second pick de-dupes it.
    const twoMatches = screen.queryAllByText('two.pdf');
    expect(twoMatches).toHaveLength(1);
  });
});
