// Phase 4.1 (Riley) — tokens.css sanity. Parses the CSS file (string-level,
// no full PostCSS) to assert the Z-index scale ordering. The fix this test
// pins is the menu-dropdown overlay-vs-sidebar bug: in Phase 4 the File menu
// list used --z-toolbar (10) which sat BELOW --z-sidebar (20), so the
// dropdown rendered behind the Pages/Bookmarks/Forms tabs.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readToken(name: string): number {
  const path = resolve(__dirname, 'tokens.css');
  const css = readFileSync(path, 'utf-8');
  const re = new RegExp(`--${name}:\\s*(\\d+)\\s*;`);
  const m = css.match(re);
  if (m === null || m[1] === undefined) {
    throw new Error(`token --${name} not found in tokens.css`);
  }
  return Number(m[1]);
}

describe('tokens.css Z-index scale ordering', () => {
  it('--z-menu-dropdown is defined', () => {
    expect(readToken('z-menu-dropdown')).toBeGreaterThan(0);
  });

  it('--z-menu-dropdown > --z-sidebar (the Phase 4.1 fix)', () => {
    const dropdown = readToken('z-menu-dropdown');
    const sidebar = readToken('z-sidebar');
    expect(dropdown).toBeGreaterThan(sidebar);
  });

  it('--z-menu-dropdown < --z-modal-overlay (dropdown still below modal scrim)', () => {
    const dropdown = readToken('z-menu-dropdown');
    const overlay = readToken('z-modal-overlay');
    expect(dropdown).toBeLessThan(overlay);
  });

  it('--z-toolbar < --z-sidebar (the toolbar itself stays below sidebar tabs)', () => {
    expect(readToken('z-toolbar')).toBeLessThan(readToken('z-sidebar'));
  });

  it('--z-modal > --z-modal-overlay (modal content above its own scrim)', () => {
    expect(readToken('z-modal')).toBeGreaterThan(readToken('z-modal-overlay'));
  });

  it('--z-toast > --z-modal (toasts overlay modals)', () => {
    expect(readToken('z-toast')).toBeGreaterThan(readToken('z-modal'));
  });
});
