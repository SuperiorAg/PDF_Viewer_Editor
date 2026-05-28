import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import { store } from '../../state/store';

import { Toolbar } from './index';

function renderToolbar(): ReturnType<typeof render> {
  return render(
    <Provider store={store}>
      <Toolbar />
    </Provider>,
  );
}

describe('Toolbar', () => {
  it('should render the Open button', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('should disable Save when no document is open', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('should mark Phase 2 annotation tools (underline, freehand, shapes) as disabled', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: 'Underline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Strikethrough' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Freehand' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Shapes' })).toBeDisabled();
  });

  it('should always enable the Combine button regardless of doc state', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: 'Combine' })).not.toBeDisabled();
  });

  // Wave 28a (a11y-audit.md R-3 / §3) — toolbar accessibility.
  describe('accessibility (R-3)', () => {
    it('exposes role="toolbar" with an accessible name', () => {
      renderToolbar();
      expect(screen.getByRole('toolbar', { name: 'Document tools' })).toBeInTheDocument();
    });

    it('every icon-only button has a non-empty accessible name', () => {
      renderToolbar();
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThanOrEqual(25);
      for (const btn of buttons) {
        // Accessible name comes from aria-label (icons are aria-hidden).
        const name = btn.getAttribute('aria-label');
        expect(name).toBeTruthy();
        expect(name!.trim().length).toBeGreaterThan(0);
      }
    });

    it('toggle buttons expose aria-pressed; momentary buttons do not', () => {
      renderToolbar();
      // Highlight is a toggle (active prop supplied) → has aria-pressed.
      expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed');
      // Open is a momentary action (no active prop) → no aria-pressed.
      expect(screen.getByRole('button', { name: 'Open' })).not.toHaveAttribute('aria-pressed');
    });

    it('uses roving tabindex — exactly one button is in the Tab order', () => {
      renderToolbar();
      const buttons = screen.getAllByRole('button');
      const tabbable = buttons.filter((b) => b.getAttribute('tabindex') === '0');
      expect(tabbable).toHaveLength(1);
      // All others are removed from the Tab order (-1).
      const removed = buttons.filter((b) => b.getAttribute('tabindex') === '-1');
      expect(removed.length).toBe(buttons.length - 1);
    });

    it('ArrowRight on the roving-focused button does not throw (moves focus)', () => {
      renderToolbar();
      const open = screen.getByRole('button', { name: 'Open' });
      expect(() => fireEvent.keyDown(open, { key: 'ArrowRight' })).not.toThrow();
    });
  });
});
