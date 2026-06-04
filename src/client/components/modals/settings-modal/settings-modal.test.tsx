// SettingsModal — Wave 28a a11y spec (a11y-audit.md R-2), updated Wave 28b for
// the Phase-7 fifth tab (Editing) + i18n-wrapped tab labels.
//
// Asserts the restored WAI-ARIA tab pattern on the settings tabs:
//   1. role="tablist" (horizontal) with five role="tab" buttons (Phase-7 adds
//      Editing per ui-spec §16.1).
//   2. aria-selected + roving tabindex track the active tab.
//   3. ArrowRight / ArrowLeft move the active tab (horizontal orientation).
//   4. The active tabpanel is associated to the active tab.
//
// The modal fires api.settings.getAll()/app.getVersion() on mount; in Vitest
// the preload bridge is unavailable, so those calls resolve to a
// 'bridge_unavailable' Result that the modal swallows (keeps defaults). The
// tab semantics under test do not depend on the async load.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import { store } from '../../../state/store';

import { SettingsModal } from './index';

function renderSettings(): ReturnType<typeof render> {
  return render(
    <Provider store={store}>
      <SettingsModal />
    </Provider>,
  );
}

describe('SettingsModal — ARIA tab pattern (R-2)', () => {
  it('renders a horizontal tablist with the six settings tabs', () => {
    // v0.7.13: a sixth "Diagnostics" tab was added between Editing and About to
    // surface David's app:diagnoseOcr IPC channel + the ocr-rasterize log path.
    renderSettings();
    const tablist = screen.getByRole('tablist', { name: 'Settings sections' });
    expect(tablist).toHaveAttribute('aria-orientation', 'horizontal');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'General',
      'Files',
      'Export',
      'Editing',
      'Diagnostics',
      'About',
    ]);
  });

  it('General is selected by default with tabIndex 0; others -1', () => {
    renderSettings();
    const general = screen.getByRole('tab', { name: 'General' });
    expect(general).toHaveAttribute('aria-selected', 'true');
    expect(general).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight advances the active tab (General -> Files)', () => {
    renderSettings();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'General' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowLeft from General wraps to About', () => {
    renderSettings();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'General' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');
  });

  it('associates the active tab with its tabpanel', () => {
    renderSettings();
    const general = screen.getByRole('tab', { name: 'General' });
    const panel = screen.getByRole('tabpanel');
    expect(general).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', general.id);
  });
});
