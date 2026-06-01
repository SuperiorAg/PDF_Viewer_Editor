// Settings → General Phase-7 controls + About update area (Wave 28b).
//
// Validates the load-bearing Phase-7 UI:
//   1. Language picker is data-driven and shows the proof-locale honesty subtext.
//   2. Switching the locale calls i18n.setLocale + flips the store mirror live.
//   3. Telemetry toggle (default OFF) calls telemetry.setOptIn.
//   4. "Check for updates now" → update.check; the not-configured placeholder
//      renders the HONEST notice (never a fake "up to date").
//   5. The trust-floor honesty copy is present (telemetry privacy + update
//      placeholder) and is NOT one of the forbidden overstated sentences.
//   6. Settings → Files default-PDF-handler honest UX (commit 47ccb70 follow-up):
//      success path opens Windows Settings (`prompt:'shown'`) — banner says
//      "redirected"; non-Windows / failure surfaces `not_implemented` honestly;
//      `getDefaultPdfHandlerStatus` is `not_implemented` so we NEVER show a
//      "Currently default" label we couldn't truthfully derive.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fail, ok } from '../../../../shared/result';
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
      // The Settings → About tab renders UpdateStatusArea, which reads
      // selectIsDirty (document slice) for the unsaved-work install gate
      // (H-FIX.1), so the test store must include the document reducer.
      document: documentReducer,
    },
  });
}

function stubBridge(overrides: Record<string, unknown> = {}): void {
  const settingsGetAll = vi.fn().mockResolvedValue(ok({ entries: {} }));
  const setLocale = vi.fn().mockResolvedValue(ok({ locale: 'es-ES' }));
  const setOptIn = vi.fn().mockResolvedValue(ok({ optIn: true, bufferCleared: false }));
  const check = vi
    .fn()
    .mockResolvedValue({ ok: false, error: 'update_not_configured', message: 'placeholder' });
  vi.stubGlobal('pdfApi', {
    settings: { getAll: settingsGetAll, set: vi.fn().mockResolvedValue(ok({})), get: vi.fn() },
    app: {
      getVersion: vi.fn().mockResolvedValue(ok({ appVersion: '0.7.0' })),
      // Honest reality (commit 47ccb70): we cannot read the current OS default
      // reliably on modern Windows — the handler returns not_implemented. The
      // renderer MUST NOT display a false "Currently default" status.
      getDefaultPdfHandlerStatus: vi
        .fn()
        .mockResolvedValue(fail('not_implemented', 'reading default pdf handler is not supported')),
      // Success path: handler opened ms-settings:defaultapps for the user; we
      // never claim to know the post-confirm state — isNowDefault stays false,
      // prompt is 'shown'. Renderer surfaces a "redirected" banner.
      setDefaultPdfHandler: vi.fn().mockResolvedValue(ok({ isNowDefault: false, prompt: 'shown' })),
    },
    i18n: {
      setLocale,
      getAvailableLocales: vi.fn().mockResolvedValue(
        ok({
          locales: [
            { locale: 'en-US', nativeName: 'English (US)', complete: true },
            { locale: 'es-ES', nativeName: 'Español (España)', complete: false },
          ],
        }),
      ),
    },
    telemetry: {
      setOptIn,
      getStatus: vi
        .fn()
        .mockResolvedValue(
          ok({ optedIn: false, bufferedCount: 0, lastEventAt: null, buffer: null }),
        ),
      recordEvent: vi.fn().mockResolvedValue(ok({ recorded: true })),
    },
    update: { check, download: vi.fn(), install: vi.fn(), onProgress: () => () => undefined },
    ...overrides,
  });
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

describe('Settings → General Phase 7 controls', () => {
  it('renders the five settings tabs incl. Editing', () => {
    stubBridge();
    renderSettings();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'General',
      'Files',
      'Export',
      'Editing',
      'About',
    ]);
  });

  it('language picker is data-driven (English + Spanish options)', async () => {
    stubBridge();
    renderSettings();
    const picker = await screen.findByLabelText('Interface language');
    const options = picker.querySelectorAll('option');
    expect(Array.from(options).map((o) => o.textContent)).toEqual([
      'English (US)',
      'Español (España)',
    ]);
  });

  it('switching to Spanish calls i18n.setLocale + shows the proof-locale honesty subtext', async () => {
    stubBridge();
    const store = renderSettings();
    const picker = await screen.findByLabelText('Interface language');
    fireEvent.change(picker, { target: { value: 'es-ES' } });
    await waitFor(() => expect(store.getState().i18n.locale).toBe('es-ES'));
    // The IPC persist call fired.
    expect(window.pdfApi!.i18n.setLocale).toHaveBeenCalledWith({ locale: 'es-ES' });
    // Honesty subtext (obligation #4) — now rendered in Spanish (sample copy).
    expect(screen.getByText(/muestra de traducción/i)).toBeInTheDocument();
  });

  it('telemetry toggle defaults OFF and calls setOptIn when enabled', async () => {
    stubBridge();
    renderSettings();
    const toggle = screen.getByLabelText('Share anonymous usage statistics');
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(window.pdfApi!.telemetry.setOptIn).toHaveBeenCalledWith({ optIn: true }),
    );
  });

  it('telemetry privacy copy states OFF-by-default + no PII (honest, not overstated)', () => {
    stubBridge();
    renderSettings();
    const copy = screen.getByText(/Off by default/i);
    expect(copy.textContent).toMatch(/anonymous feature-usage counts only/i);
    expect(copy.textContent).toMatch(
      /never document content, file paths, or personal information/i,
    );
    // NOT the forbidden overstated sentence.
    expect(copy.textContent).not.toMatch(/we collect anonymous analytics/i);
  });

  it('"Check for updates now" → update.check; placeholder copy is present (honest)', async () => {
    stubBridge();
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates now' }));
    await waitFor(() =>
      expect(window.pdfApi!.update.check).toHaveBeenCalledWith({ trigger: 'explicit' }),
    );
    // The inline placeholder honesty (obligation #2).
    expect(screen.getByText(/release channel is\s+a placeholder/i)).toBeInTheDocument();
  });
});

describe('Settings → About tab update status (not-configured honesty)', () => {
  it('shows the honest "not configured" placeholder after a check, never "up to date"', async () => {
    stubBridge();
    renderSettings();
    // Check fires from General; then switch to the About tab.
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates now' }));
    await waitFor(() => expect(window.pdfApi!.update.check).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));
    const notice = await screen.findByText(/Update channel not configured \(placeholder\)/i);
    expect(notice).toBeInTheDocument();
    expect(screen.queryByText(/You are running the latest/i)).not.toBeInTheDocument();
  });
});

describe('Settings → Files default-PDF-handler honest UX (commit 47ccb70 follow-up)', () => {
  it('does NOT show a "Currently default" derived status (getStatus is not_implemented)', async () => {
    stubBridge();
    renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    // The honest status sentence is present...
    expect(
      await screen.findByText(/Status is set in Windows Settings → Default apps/i),
    ).toBeInTheDocument();
    // ...and none of the old derived-status / toggle strings leak through.
    expect(screen.queryByText(/IS the default PDF viewer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NOT the default PDF viewer/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Make default$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Relinquish default/i })).not.toBeInTheDocument();
  });

  it('clicking "Open Windows Default apps settings" calls setDefaultPdfHandler and shows the redirected banner', async () => {
    stubBridge();
    const store = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    const btn = await screen.findByRole('button', { name: /Open Windows Default apps settings/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(window.pdfApi!.app.setDefaultPdfHandler).toHaveBeenCalledWith({ enable: true }),
    );
    await waitFor(() => {
      const toasts = store.getState().ui.toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].kind).toBe('success');
      expect(toasts[0].message).toMatch(/Opened Windows Settings/i);
    });
  });

  it('on not_implemented failure shows the honest fallback toast (never a fake "now default")', async () => {
    stubBridge({
      app: {
        getVersion: vi.fn().mockResolvedValue(ok({ appVersion: '0.7.0' })),
        getDefaultPdfHandlerStatus: vi
          .fn()
          .mockResolvedValue(fail('not_implemented', 'not supported')),
        setDefaultPdfHandler: vi
          .fn()
          .mockResolvedValue(fail('not_implemented', 'shell.openExternal unavailable')),
      },
    });
    const store = renderSettings();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    const btn = await screen.findByRole('button', { name: /Open Windows Default apps settings/i });
    fireEvent.click(btn);
    await waitFor(() => {
      const toasts = store.getState().ui.toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].kind).toBe('warning');
      expect(toasts[0].message).toMatch(/Runtime default-app changes aren't supported/i);
    });
    // Never the misleading success banner.
    expect(
      screen.queryByText(/PDF_Viewer_Editor is now the default PDF viewer/i),
    ).not.toBeInTheDocument();
  });
});
