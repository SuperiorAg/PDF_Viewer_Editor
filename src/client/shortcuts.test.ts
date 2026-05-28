import { describe, expect, it } from 'vitest';

import { findShortcutForEvent } from './shortcuts';

function makeEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('findShortcutForEvent', () => {
  it('should identify Ctrl+O as open', () => {
    expect(findShortcutForEvent(makeEvent({ key: 'o', ctrlKey: true }))).toBe('open');
  });

  it('should identify Ctrl+S as save', () => {
    expect(findShortcutForEvent(makeEvent({ key: 's', ctrlKey: true }))).toBe('save');
  });

  it('should identify Ctrl+Shift+S as save-as', () => {
    expect(findShortcutForEvent(makeEvent({ key: 'S', ctrlKey: true, shiftKey: true }))).toBe(
      'save-as',
    );
  });

  it('should identify single-letter H as highlight tool', () => {
    expect(findShortcutForEvent(makeEvent({ key: 'h' }))).toBe('tool-highlight');
  });

  it('should NOT fire tool shortcut when Ctrl is held', () => {
    expect(findShortcutForEvent(makeEvent({ key: 'h', ctrlKey: true }))).toBeNull();
  });

  it('should identify PageDown', () => {
    expect(findShortcutForEvent(makeEvent({ key: 'PageDown' }))).toBe('page-next');
  });

  it('should identify Escape as tool-cursor', () => {
    expect(findShortcutForEvent(makeEvent({ key: 'Escape' }))).toBe('tool-cursor');
  });
});
