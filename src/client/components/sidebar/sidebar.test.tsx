// Sidebar — Wave 28a a11y spec (a11y-audit.md R-1).
//
// Asserts the restored WAI-ARIA tab pattern:
//   1. role="tablist" (vertical) with eight role="tab" buttons (Phase 7.5 B7
//      Wave 3 added the Stamps tab; Phase 7.5 C2 Wave 5a added the Preflight
//      tab; Phase 7.5 C3 Wave 5b added the Accessibility tab; previously
//      five → six → seven → eight).
//   2. aria-selected reflects the active tab; roving tabindex (active=0, rest=-1).
//   3. ArrowDown / ArrowUp move the active tab (and aria-selected follows);
//      Home/End jump first/last; wrap-around at the ends.
//   4. The tabpanel is associated via aria-controls / aria-labelledby.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import { store } from '../../state/store';

import { Sidebar } from './index';

function renderSidebar(): ReturnType<typeof render> {
  return render(
    <Provider store={store}>
      <Sidebar />
    </Provider>,
  );
}

describe('Sidebar — ARIA tab pattern (R-1)', () => {
  it('renders a vertical tablist with eight tabs', () => {
    renderSidebar();
    const tablist = screen.getByRole('tablist', { name: 'Sidebar panels' });
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(8);
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Pages',
      'Bookmarks',
      'Forms',
      'OCR',
      'Exports',
      'Stamps',
      'Preflight',
      'Accessibility',
    ]);
  });

  it('marks exactly one tab aria-selected and gives only that tab tabIndex 0 (roving)', () => {
    renderSidebar();
    const pages = screen.getByRole('tab', { name: 'Pages' });
    // Reset store to a known active tab via clicking Pages first.
    fireEvent.click(pages);
    const tabs = screen.getAllByRole('tab');
    const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(pages);
    expect(pages).toHaveAttribute('tabindex', '0');
    tabs.filter((t) => t !== pages).forEach((t) => expect(t).toHaveAttribute('tabindex', '-1'));
  });

  it('ArrowDown moves the active tab to the next tab', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('tab', { name: 'Pages' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Pages' }), { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: 'Bookmarks' })).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowUp from the first tab wraps to the last (Accessibility)', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('tab', { name: 'Pages' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Pages' }), { key: 'ArrowUp' });
    expect(screen.getByRole('tab', { name: 'Accessibility' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('Home jumps to the first tab and End to the last', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('tab', { name: 'Forms' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Forms' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Accessibility' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Accessibility' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
  });

  it('associates the active tab with its tabpanel (aria-controls + labelledby)', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('tab', { name: 'Pages' }));
    const activeTab = screen.getByRole('tab', { name: 'Pages' });
    const panel = screen.getByRole('tabpanel');
    expect(activeTab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', activeTab.id);
  });
});
