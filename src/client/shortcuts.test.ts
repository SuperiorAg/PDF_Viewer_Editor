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

  // Phase 7.4 B1 — redaction shortcuts (Ctrl+Shift+Y, Shift+R).
  it('should identify Ctrl+Shift+Y as redaction-apply', () => {
    expect(findShortcutForEvent(makeEvent({ key: 'Y', ctrlKey: true, shiftKey: true }))).toBe(
      'redaction-apply',
    );
  });

  it('should identify Shift+R as redaction-mark-rect (no ctrl)', () => {
    expect(findShortcutForEvent(makeEvent({ key: 'R', shiftKey: true }))).toBe(
      'redaction-mark-rect',
    );
  });

  it('should NOT confuse Ctrl+Shift+R (rotate-ccw) with Shift+R (redaction-mark-rect)', () => {
    expect(findShortcutForEvent(makeEvent({ key: 'R', ctrlKey: true, shiftKey: true }))).toBe(
      'rotate-ccw',
    );
  });
});
