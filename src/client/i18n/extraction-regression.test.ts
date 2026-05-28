// Extraction-regression guard (i18n-strategy.md §9, conventions §18.4).
//
// A lint-style test: it reads the SWEPT high-traffic component sources and
// asserts no bare user-facing JSX text or hardcoded aria-label/title literal
// survived the big-bang sweep. This is the structural complaint Julian (Wave
// 29) greps for, encoded as a test so a regression fails CI rather than slipping
// past review. Scope is the components extracted this wave; it is intentionally
// conservative (flags obvious capitalized JSX text + literal aria/title attrs)
// to avoid false positives on proper nouns.
//
// node env: this test reads files from disk.
// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, '..');

// The high-traffic components swept in Wave 28b.
const SWEPT = [
  'components/sidebar/index.tsx',
  'components/toolbar/index.tsx',
  'components/menu-bar/index.tsx',
  'components/status-bar/index.tsx',
  'components/empty-state/index.tsx',
  'components/toast/index.tsx',
  'components/error-boundary/index.tsx',
  'components/modals/modal-shell.tsx',
  'components/modals/combine-modal/index.tsx',
  'components/modals/settings-modal/index.tsx',
  'components/modals/settings-modal/general-tab.tsx',
  'components/modals/settings-modal/about-tab.tsx',
  'components/modals/about-modal/index.tsx',
  'components/modals/telemetry-debug-panel/index.tsx',
  'components/update-status-area/index.tsx',
];

// The deep Phase-4..6 modal-STEP bodies swept in the Backlog-Fix wave (28c). These
// are the bodies Wave 28b deferred behind fallbackLng; they now route through t().
// Their group differs from SWEPT only in that some are not the modal's index.tsx
// but a per-step sub-component — the same literal-attr + useT assertions apply.
const SWEPT_28C = [
  'components/modals/export-engine-dialog/index.tsx',
  'components/modals/scan-modal/index.tsx',
  'components/modals/save-template-modal/index.tsx',
  'components/modals/language-pack-manager-modal/index.tsx',
  'components/modals/help-modal/index.tsx',
  'components/modals/image-import-modal/index.tsx',
  'components/modals/pades-sign-modal/index.tsx',
  'components/modals/pades-sign-modal/cert-loader-step.tsx',
  'components/modals/pades-sign-modal/sign-options-step.tsx',
  'components/modals/pades-sign-modal/confirm-and-sign-step.tsx',
  'components/modals/signature-capture-modal/index.tsx',
  'components/modals/signature-capture-modal/typed-tab.tsx',
  'components/modals/signature-capture-modal/drawn-tab.tsx',
  'components/modals/signature-capture-modal/image-tab.tsx',
  'components/modals/ocr-run-modal/index.tsx',
  'components/modals/ocr-run-modal/configure-step.tsx',
  'components/modals/ocr-run-modal/confirm-invalidate-step.tsx',
  'components/modals/ocr-run-modal/running-step.tsx',
  'components/modals/ocr-run-modal/done-step.tsx',
  'components/modals/export-modal/index.tsx',
  'components/modals/export-modal/format-picker.tsx',
  'components/modals/export-modal/quality-tier-picker.tsx',
  'components/modals/export-modal/per-format-options.tsx',
  'components/modals/export-modal/running-step.tsx',
  'components/modals/mail-merge-modal/index.tsx',
];

/** Hardcoded aria-label / title / placeholder attributes with a literal value. */
const LITERAL_ATTR = /(?:aria-label|title|placeholder)="[A-Za-z][^"]*"/g;

describe('i18n extraction regression — no hardcoded user-facing strings', () => {
  for (const rel of SWEPT) {
    it(`${rel} has no literal aria-label/title/placeholder attributes`, () => {
      const src = readFileSync(resolve(clientRoot, rel), 'utf8');
      const matches = src.match(LITERAL_ATTR) ?? [];
      // Every accessible-name attribute must go through {t(...)} — a string
      // literal means it was missed (conventions §18.4 rule 9 / §18.3 rule 1).
      expect(matches, `literal a11y attrs in ${rel}: ${matches.join(', ')}`).toHaveLength(0);
    });
  }

  it('each swept component imports the useT hook', () => {
    for (const rel of SWEPT) {
      const src = readFileSync(resolve(clientRoot, rel), 'utf8');
      // error-boundary uses useT in its ErrorFallback subcomponent; all others
      // import useT directly. Both forms contain the literal "useT".
      expect(src, `${rel} should consume t()`).toMatch(/useT/);
    }
  });

  it('no `as any` cast appears on a t() call in the i18n module', () => {
    const idx = readFileSync(resolve(here, 'use-t.ts'), 'utf8');
    const resolveSrc = readFileSync(resolve(here, 'resolve.ts'), 'utf8');
    expect(idx).not.toMatch(/\bas any\b/);
    expect(resolveSrc).not.toMatch(/\bas any\b/);
  });
});

describe('i18n extraction regression (28c) — deep modal-step bodies', () => {
  for (const rel of SWEPT_28C) {
    it(`${rel} has no literal aria-label/title/placeholder attributes`, () => {
      const src = readFileSync(resolve(clientRoot, rel), 'utf8');
      const matches = src.match(LITERAL_ATTR) ?? [];
      expect(matches, `literal a11y attrs in ${rel}: ${matches.join(', ')}`).toHaveLength(0);
    });
  }

  it('each deep modal-step component consumes the useT hook', () => {
    for (const rel of SWEPT_28C) {
      const src = readFileSync(resolve(clientRoot, rel), 'utf8');
      expect(src, `${rel} should consume t()`).toMatch(/useT/);
    }
  });
});

describe('annotation-layer a11y (Fix 2) — accessible name + no static-interaction disable', () => {
  const rel = 'components/annotation-layer/index.tsx';

  it('has an accessible role + name and no leftover eslint-disable for no-static-element-interactions', () => {
    const src = readFileSync(resolve(clientRoot, rel), 'utf8');
    // The drawing surface must be an accessible-named interactive element.
    expect(src).toMatch(/role="application"/);
    expect(src).toMatch(/aria-label=\{layerLabel\}/);
    // The prior scoped disable for the pointer-only surface must be gone (the
    // role + name make the element pass the rule legitimately).
    expect(src).not.toMatch(/eslint-disable.*no-static-element-interactions/);
  });

  it('routes the accessible name through t() (no hardcoded aria-label literal)', () => {
    const src = readFileSync(resolve(clientRoot, rel), 'utf8');
    const matches = src.match(LITERAL_ATTR) ?? [];
    expect(matches, `literal a11y attrs in ${rel}: ${matches.join(', ')}`).toHaveLength(0);
    expect(src).toMatch(/useT/);
  });
});
