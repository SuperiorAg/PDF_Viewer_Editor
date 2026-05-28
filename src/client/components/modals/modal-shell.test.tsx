// ModalShell — Wave 28a a11y spec (a11y-audit.md R-8).
//
// Asserts the standardized modal focus discipline (useFocusTrap):
//   1. role="dialog" + aria-modal="true" + aria-labelledby the visible title.
//   2. role="alertdialog" when role="alertdialog" prop is passed (destructive).
//   3. On mount, focus moves into the modal (first focusable element).
//   4. Tab from the last focusable wraps to the first (focus trapped within).
//   5. Shift+Tab from the first wraps to the last.
//   6. Escape calls onClose.
//   7. On unmount, focus returns to the element that was focused before open.

import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactElement, useState } from 'react';
import { Provider } from 'react-redux';
import { describe, expect, it, vi } from 'vitest';

import { store } from '../../state/store';

import { ModalShell } from './modal-shell';

// ModalShell consumes useT (for the "Close dialog" aria-label) which reads the
// i18n slice — so it must render inside a Redux Provider. The store defaults to
// the en-US locale, so the asserted accessible names stay English.
function renderShell(ui: ReactElement): ReturnType<typeof render> {
  return render(<Provider store={store}>{ui}</Provider>);
}

function Harness({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <ModalShell
      title="Test dialog"
      onClose={onClose}
      footer={<button type="button">Footer</button>}
    >
      <button type="button">First</button>
      <input aria-label="Middle input" />
      <button type="button">Last body</button>
    </ModalShell>
  );
}

describe('ModalShell — focus trap + dialog semantics (R-8)', () => {
  it('exposes role="dialog", aria-modal, and is labelled by the visible title', () => {
    renderShell(<Harness onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const heading = screen.getByRole('heading', { name: 'Test dialog' });
    expect(dialog).toHaveAttribute('aria-labelledby', heading.id);
  });

  it('renders role="alertdialog" when requested', () => {
    renderShell(
      <ModalShell title="Confirm" onClose={vi.fn()} role="alertdialog">
        <button type="button">OK</button>
      </ModalShell>,
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('moves focus into the modal on mount', () => {
    renderShell(<Harness onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('traps Tab — from the last focusable, Tab wraps to the first', () => {
    renderShell(<Harness onClose={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'Close dialog' });
    const footer = screen.getByRole('button', { name: 'Footer' });
    // Footer is the last focusable in DOM order (header close is first).
    footer.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it('traps Shift+Tab — from the first focusable, wraps to the last', () => {
    renderShell(<Harness onClose={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'Close dialog' });
    const footer = screen.getByRole('button', { name: 'Footer' });
    close.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(footer);
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    renderShell(<Harness onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the trigger element on unmount', () => {
    function ToggleHarness(): JSX.Element {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Trigger
          </button>
          {open && (
            <ModalShell title="T" onClose={() => setOpen(false)}>
              <button type="button" onClick={() => setOpen(false)}>
                Close it
              </button>
            </ModalShell>
          )}
        </div>
      );
    }
    renderShell(<ToggleHarness />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger); // opens modal — focus moves in
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Close it' })); // unmounts
    expect(document.activeElement).toBe(trigger);
  });
});
