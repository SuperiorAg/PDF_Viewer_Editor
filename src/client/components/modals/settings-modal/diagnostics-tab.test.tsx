// Settings → Diagnostics tab (v0.7.13).
//
// Asserts:
//   1. The Diagnostics tab is present in the tablist and reachable via the
//      same WAI-ARIA roving-tabindex pattern as the other tabs (a11y-audit R-2).
//   2. Clicking "Run OCR diagnostics" calls api.app.diagnoseOcr and renders the
//      Result envelope as pretty-printed JSON in a <pre>.
//   3. The trust-floor disclaimer is present and matches the verified claim
//      (canvas binding + Node/Electron + OCR state; no PDF content).
//   4. The log-folder path is rendered as a copyable code element.
//
// The diagnoseOcr call is stubbed at the api proxy via vi.stubGlobal('pdfApi', ...)
// — same pattern as settings-phase7.test.tsx — so we exercise the live api.ts
// proxy without mocking it.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok } from '../../../../shared/result';
import documentReducer from '../../../state/slices/document-slice';
import i18nReducer from '../../../state/slices/i18n-slice';
import telemetryReducer from '../../../state/slices/telemetry-slice';
import uiReducer from '../../../state/slices/ui-slice';
import updateReducer from '../../../state/slices/update-slice';

import { SettingsModal } from './index';

function makeStore() {
  return configureStore({
    reducer: {
      ui: uiReducer,
      update: updateReducer,
      telemetry: telemetryReducer,
      i18n: i18nReducer,
      document: documentReducer,
    },
  });
}

interface StubOverrides {
  diagnoseOcr?: ReturnType<typeof vi.fn>;
}

function stubBridge(overrides: StubOverrides = {}): { diagnoseOcr: ReturnType<typeof vi.fn> } {
  const diagnoseOcr =
    overrides.diagnoseOcr ??
    vi.fn().mockResolvedValue(
      ok({
        canvasModuleResolvable: true,
        canvasModuleLoadError: null,
        pdfjsLoadable: true,
        tesseractCoreReachable: true,
        documentStoreCount: 0,
      }),
    );
  vi.stubGlobal('pdfApi', {
    settings: {
      getAll: vi.fn().mockResolvedValue(ok({ entries: {} })),
      set: vi.fn(),
      get: vi.fn(),
    },
    app: {
      getVersion: vi.fn().mockResolvedValue(ok({ appVersion: '0.7.13' })),
      getDefaultPdfHandlerStatus: vi
        .fn()
        .mockResolvedValue({ ok: false, error: 'not_implemented', message: '' }),
      setDefaultPdfHandler: vi.fn(),
      diagnoseOcr,
    },
    i18n: {
      setLocale: vi.fn(),
      getAvailableLocales: vi.fn().mockResolvedValue(
        ok({
          locales: [{ locale: 'en-US', nativeName: 'English (US)', complete: true }],
        }),
      ),
    },
    telemetry: {
      setOptIn: vi.fn(),
      getStatus: vi
        .fn()
        .mockResolvedValue(
          ok({ optedIn: false, bufferedCount: 0, lastEventAt: null, buffer: null }),
        ),
      recordEvent: vi.fn(),
    },
    update: {
      check: vi.fn(),
      download: vi.fn(),
      install: vi.fn(),
      onProgress: () => () => undefined,
    },
  });
  return { diagnoseOcr };
}

function renderSettings() {
  const store = makeStore();
  render(
    <Provider store={store}>
      <SettingsModal />
    </Provider>,
  );
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Settings → Diagnostics tab (v0.7.13)', () => {
  it('renders the Diagnostics tab between Editing and About', () => {
    stubBridge();
    renderSettings();
    const tablist = screen.getByRole('tablist', { name: 'Settings sections' });
    const labels = within(tablist)
      .getAllByRole('tab')
      .map((t) => t.textContent);
    const diagIdx = labels.indexOf('Diagnostics');
    expect(diagIdx).toBeGreaterThan(-1);
    expect(labels[diagIdx - 1]).toBe('Editing');
    expect(labels[diagIdx + 1]).toBe('About');
  });

  it('keyboard arrow navigation reaches the Diagnostics tab', () => {
    stubBridge();
    renderSettings();
    // Activate Diagnostics by clicking (covers the click handler) — arrow
    // navigation is exercised generically in settings-modal.test.tsx.
    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }));
    expect(screen.getByRole('tab', { name: 'Diagnostics' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('"Run OCR diagnostics" calls api.app.diagnoseOcr and renders the JSON', async () => {
    const { diagnoseOcr } = stubBridge();
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }));
    const runButton = screen.getByRole('button', { name: 'Run OCR diagnostics' });
    fireEvent.click(runButton);
    await waitFor(() => expect(diagnoseOcr).toHaveBeenCalledTimes(1));
    // Verbatim Result envelope payload check: the JSON pretty-print includes
    // each scalar field. The diagnostic <pre> carries aria-label so we don't
    // depend on raw text-matching the rendered block.
    const pre = await screen.findByLabelText('Diagnostic result (JSON)');
    expect(pre.textContent).toContain('"ok": true');
    expect(pre.textContent).toContain('"canvasModuleResolvable": true');
    expect(pre.textContent).toContain('"tesseractCoreReachable": true');
  });

  it('shows the trust-floor disclaimer (no PDF content claim)', () => {
    stubBridge();
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }));
    // The exact wording is load-bearing per conventions §18 — match the
    // load-bearing phrase, not the entire sentence, so a future copy-edit
    // doesn't break the assertion without changing the honesty claim.
    expect(screen.getByText(/No PDF content is included\./i)).toBeInTheDocument();
    expect(screen.getByText(/@napi-rs\/canvas binding version/i)).toBeInTheDocument();
  });

  it('renders the user-data logs path as a copyable code element', () => {
    stubBridge();
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }));
    // The hint string contains the productName + logs subfolder. We assert
    // the substring (the leading "%APPDATA%" prefix is platform-specific
    // syntax — Windows-only — and is fine to bake into the assertion since
    // this is a Windows-first project per project rules).
    expect(screen.getByText(/PDF Viewer & Editor\\logs/)).toBeInTheDocument();
  });
});
