// TelemetryDebugPanel tests (Wave 28b, ui-spec.md §16.4).
//
// Validates the auditability surface: it shows the opt-in state, the buffer
// summary, and a table of event-name + day-bucket ONLY (the structural PII
// guard — no other column exists). Driven by telemetry:getStatus.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok } from '../../../../shared/result';
import i18nReducer from '../../../state/slices/i18n-slice';
import telemetryReducer, { setTelemetryOptedIn } from '../../../state/slices/telemetry-slice';

import { TelemetryDebugPanel } from './index';

function makeStore(optedIn: boolean) {
  const store = configureStore({
    reducer: { telemetry: telemetryReducer, i18n: i18nReducer },
  });
  store.dispatch(setTelemetryOptedIn(optedIn));
  return store;
}

function stub(buffer: Array<{ name: string; dayBucket: string }>): void {
  vi.stubGlobal('pdfApi', {
    telemetry: {
      getStatus: vi
        .fn()
        .mockResolvedValue(
          ok({ optedIn: true, bufferedCount: buffer.length, lastEventAt: 1716900000000, buffer }),
        ),
      setOptIn: vi.fn(),
      recordEvent: vi.fn(),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TelemetryDebugPanel', () => {
  it('shows the buffered events as name + day-bucket rows', async () => {
    stub([
      { name: 'doc.open', dayBucket: '2026-05-28' },
      { name: 'feature.export.docx', dayBucket: '2026-05-28' },
    ]);
    render(
      <Provider store={makeStore(true)}>
        <TelemetryDebugPanel onClose={vi.fn()} />
      </Provider>,
    );
    expect(await screen.findByText('doc.open')).toBeInTheDocument();
    expect(screen.getByText('feature.export.docx')).toBeInTheDocument();
    // The table exposes exactly two columns — Event + Day (no PII column).
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Event', 'Day']);
  });

  it('reflects opt-in state in the header line', async () => {
    stub([]);
    render(
      <Provider store={makeStore(true)}>
        <TelemetryDebugPanel onClose={vi.fn()} />
      </Provider>,
    );
    expect(await screen.findByText(/Telemetry is currently: ON/i)).toBeInTheDocument();
  });

  it('Close button invokes onClose', async () => {
    stub([]);
    const onClose = vi.fn();
    render(
      <Provider store={makeStore(false)}>
        <TelemetryDebugPanel onClose={onClose} />
      </Provider>,
    );
    // Wait for the async getStatus to settle before interacting.
    await waitFor(() => expect(window.pdfApi!.telemetry.getStatus).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
