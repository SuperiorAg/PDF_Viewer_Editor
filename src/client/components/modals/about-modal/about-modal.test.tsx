// AboutModal tests (Wave 28b, ui-spec.md §16.2).
//
// Validates: version renders; the acknowledgments name the Phase-7-new MIT deps
// (i18next, react-i18next, electron-updater); the update status area is the
// HONEST not-configured placeholder (never a fake "up to date").

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok } from '../../../../shared/result';
import documentReducer from '../../../state/slices/document-slice';
import i18nReducer from '../../../state/slices/i18n-slice';
import telemetryReducer from '../../../state/slices/telemetry-slice';
import uiReducer, { openModal } from '../../../state/slices/ui-slice';
import updateReducer from '../../../state/slices/update-slice';

import { AboutModal } from './index';

function makeStore() {
  const store = configureStore({
    reducer: {
      ui: uiReducer,
      update: updateReducer,
      telemetry: telemetryReducer,
      i18n: i18nReducer,
      // The shared UpdateStatusArea reads selectIsDirty (document slice) for the
      // unsaved-work install gate, so the test store must include it (H-FIX.1).
      document: documentReducer,
    },
  });
  store.dispatch(openModal('about'));
  return store;
}

function stub(): void {
  vi.stubGlobal('pdfApi', {
    app: { getVersion: vi.fn().mockResolvedValue(ok({ appVersion: '0.7.0' })) },
    telemetry: {
      recordEvent: vi.fn().mockResolvedValue(ok({ recorded: true })),
      getStatus: vi.fn(),
      setOptIn: vi.fn(),
    },
    update: {
      check: vi
        .fn()
        .mockResolvedValue({ ok: false, error: 'update_not_configured', message: 'placeholder' }),
      download: vi.fn(),
      install: vi.fn(),
      onProgress: () => () => undefined,
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderAbout() {
  const store = makeStore();
  render(
    <Provider store={store}>
      <AboutModal />
    </Provider>,
  );
  return store;
}

describe('AboutModal', () => {
  it('renders the app version', async () => {
    stub();
    renderAbout();
    expect(await screen.findByText('0.7.0')).toBeInTheDocument();
  });

  it('acknowledgments name the Phase-7-new MIT dependencies', () => {
    stub();
    renderAbout();
    const builtWith = screen.getByText(/Built with:/i);
    expect(builtWith.textContent).toMatch(/i18next/);
    expect(builtWith.textContent).toMatch(/react-i18next/);
    expect(builtWith.textContent).toMatch(/electron-updater/);
  });

  it('Check for updates surfaces the HONEST not-configured placeholder', async () => {
    stub();
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates now' }));
    const notice = await screen.findByText(/Update channel not configured \(placeholder\)/i);
    expect(notice).toBeInTheDocument();
    // Never a fake "up to date".
    expect(screen.queryByText(/You are running the latest/i)).not.toBeInTheDocument();
  });
});
