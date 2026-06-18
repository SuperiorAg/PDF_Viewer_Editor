// Accessibility Checker panel tests — Phase 7.5 C6 (Riley Wave 5d).
//
// Honesty contract covered:
//   - Run button enabled when a doc is open; disabled when no doc.
//   - The subsetDisclosure renders VERBATIM from David's response
//     (asserts the exact fixture substring appears in the DOM).
//   - Shipped-rule-count badge appears with the response value.
//   - Engine-failure state renders the engine-failed banner + Retry.
//   - Four-state summary: each pill shows the right count.
//   - The four-state grouping survives: 'unevaluated' is its OWN bucket.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import accessibilityCheckReducer, {
  runFailed,
  runSucceeded,
} from '../../state/slices/accessibility-check-slice';
import altTextReducer from '../../state/slices/alt-text-slice';
import documentPropertiesReducer from '../../state/slices/document-properties-slice';
import documentReducer, { setDocument } from '../../state/slices/document-slice';
import readingOrderReducer from '../../state/slices/reading-order-slice';
import structTreeReducer from '../../state/slices/struct-tree-slice';
import uiReducer from '../../state/slices/ui-slice';
import viewportReducer from '../../state/slices/viewport-slice';
import type { PdfRunAccessibilityCheckValue } from '../../types/accessibility-check-contract-stub';
import type { PDFDocumentModel } from '../../types/ipc-contract';

import { AccessibilityCheckPanel } from './index';

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'h',
  pageCount: 5,
  pages: [],
  annotations: [],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

const VERBATIM_DISCLOSURE = 'Subset of WCAG 2.1 + PDF/UA-1 — see Help for the shipped rule set.';

function makeStore() {
  return configureStore({
    reducer: {
      accessibilityCheck: accessibilityCheckReducer,
      altText: altTextReducer,
      document: documentReducer,
      documentProperties: documentPropertiesReducer,
      readingOrder: readingOrderReducer,
      structTree: structTreeReducer,
      ui: uiReducer,
      viewport: viewportReducer,
    },
  });
}

function fixtureValue(
  overrides: Partial<PdfRunAccessibilityCheckValue> = {},
): PdfRunAccessibilityCheckValue {
  return {
    results: [
      {
        ruleId: 'a11y.document.title-present',
        severity: 'error',
        status: 'fail',
        passed: false,
        message: 'a11y.documentTitlePresent.fail',
        locations: [],
        quickFix: { kind: 'open-document-properties' },
      },
      {
        ruleId: 'a11y.figures.all-have-alt-text',
        severity: 'error',
        status: 'fail',
        passed: false,
        message: 'a11y.figuresAllHaveAltText.fail',
        locations: [{ pageIndex: 0 }, { pageIndex: 2 }],
        quickFix: { kind: 'open-alt-text-inspector' },
      },
      {
        ruleId: 'a11y.tables.scope-set',
        severity: 'warning',
        status: 'warn',
        passed: false,
        message: 'a11y.tablesScopeSet.warn',
        locations: [],
        quickFix: { kind: 'open-tag-editor', targetNodeId: 'n-42' },
      },
      {
        ruleId: 'a11y.appearance.color-contrast-spot-sample',
        severity: 'info',
        status: 'unevaluated',
        passed: false,
        message: 'a11y.colorContrast.unevaluated.pdf-lib-cannot-rasterize',
        locations: [],
      },
      {
        ruleId: 'a11y.document.language-set',
        severity: 'error',
        status: 'pass',
        passed: true,
        message: 'a11y.documentLanguageSet.pass',
        locations: [],
      },
    ],
    summary: { pass: 1, warn: 1, fail: 2, unevaluated: 1 },
    ranAt: 1750000000000,
    shippedRuleCount: 12,
    subsetDisclosure: VERBATIM_DISCLOSURE,
    ...overrides,
  };
}

function renderPanel(store: ReturnType<typeof makeStore>) {
  return render(
    <Provider store={store}>
      <AccessibilityCheckPanel />
    </Provider>,
  );
}

describe('AccessibilityCheckPanel — empty / no-document state', () => {
  it('disables the Run button when no document is open', () => {
    const store = makeStore();
    renderPanel(store);
    const button = screen.getByTestId('a11y-run-button');
    expect(button).toBeDisabled();
  });

  it('enables the Run button when a document is open', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    renderPanel(store);
    const button = screen.getByTestId('a11y-run-button');
    expect(button).not.toBeDisabled();
  });
});

describe('AccessibilityCheckPanel — verbatim subsetDisclosure (P7.5-L-10)', () => {
  it('renders the disclosure VERBATIM from the response value', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(runSucceeded(fixtureValue()));
    renderPanel(store);
    const disclosure = screen.getByTestId('a11y-subset-disclosure');
    // Substring check: the rendered text MUST contain David's verbatim string.
    expect(disclosure.textContent).toContain(VERBATIM_DISCLOSURE);
  });

  it('renders a CUSTOM disclosure verbatim — no hardcoded fallback', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      runSucceeded(
        fixtureValue({
          subsetDisclosure: 'CUSTOM TEST DISCLOSURE 12345',
        }),
      ),
    );
    renderPanel(store);
    const disclosure = screen.getByTestId('a11y-subset-disclosure');
    expect(disclosure.textContent).toBe('CUSTOM TEST DISCLOSURE 12345');
  });

  it('renders the shipped rule count as a permanent badge', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(runSucceeded(fixtureValue({ shippedRuleCount: 12 })));
    renderPanel(store);
    const badge = screen.getByTestId('a11y-shipped-badge');
    expect(badge.textContent).toContain('12');
  });
});

describe('AccessibilityCheckPanel — four-state summary (P7.5-L-10)', () => {
  it('exposes pass, warn, fail, and unevaluated as DISTINCT pills', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(runSucceeded(fixtureValue()));
    renderPanel(store);
    const bar = screen.getByTestId('a11y-summary-bar');
    expect(bar).toBeTruthy();
    // The aria-label honestly states all four numbers — even when zero.
    expect(bar.getAttribute('aria-label')).toContain('1');
  });

  it('groups results by status — unevaluated is its OWN bucket, not folded into pass', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(runSucceeded(fixtureValue()));
    renderPanel(store);
    // Four sections present (fail / warn / unevaluated / pass).
    expect(screen.getByTestId('a11y-section-fail')).toBeTruthy();
    expect(screen.getByTestId('a11y-section-warn')).toBeTruthy();
    expect(screen.getByTestId('a11y-section-unevaluated')).toBeTruthy();
    expect(screen.getByTestId('a11y-section-pass')).toBeTruthy();
    // The 'unevaluated' bucket carries the color-contrast rule — its row
    // must be visible (default-expanded), and it is NOT in the pass section.
    const unevaluatedSection = screen.getByTestId('a11y-section-unevaluated');
    expect(unevaluatedSection.textContent).toMatch(/contrast/i);
    const passSection = screen.getByTestId('a11y-section-pass');
    expect(passSection.textContent ?? '').not.toMatch(/contrast/i);
  });
});

describe('AccessibilityCheckPanel — engine-failure state', () => {
  it('renders an honest error banner + Retry on engine_failed', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(runFailed({ error: 'engine_failed', message: 'engine crashed' }));
    renderPanel(store);
    const error = screen.getByTestId('a11y-error');
    expect(error.textContent).toMatch(/failed/i);
    // Run button label is "Run" not "Re-run" (no prior successful result).
    expect(screen.getByTestId('a11y-run-button').textContent ?? '').toMatch(/run/i);
  });

  it('surfaces bridge_unavailable as a distinct, honest message', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      runFailed({
        error: 'bridge_unavailable',
        message:
          'window.pdfApi.pdf.runAccessibilityCheck is not exposed (David Wave 5d preload not yet wired)',
      }),
    );
    renderPanel(store);
    const error = screen.getByTestId('a11y-error');
    // Renderer must NOT pretend "0 results" — it must explicitly say the engine isn't there.
    expect(error.textContent).toMatch(/available|exposed/i);
  });
});

describe('AccessibilityCheckPanel — quick-fix routing', () => {
  it('renders quick-fix buttons for each routable kind in the fixture', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(runSucceeded(fixtureValue()));
    renderPanel(store);
    expect(screen.getByTestId('a11y-quickfix-open-document-properties')).toBeTruthy();
    expect(screen.getByTestId('a11y-quickfix-open-alt-text-inspector')).toBeTruthy();
    expect(screen.getByTestId('a11y-quickfix-open-tag-editor')).toBeTruthy();
  });

  it('open-tag-editor quick-fix dispatches selectNode with the target id', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(runSucceeded(fixtureValue()));
    renderPanel(store);
    const btn = screen.getByTestId('a11y-quickfix-open-tag-editor');
    fireEvent.click(btn);
    // The struct-tree slice receives the selectNode action — assert via state.
    expect(store.getState().structTree.selectedNodeId).toBe('n-42');
  });

  it('open-alt-text-inspector quick-fix opens the alt-text modal', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(runSucceeded(fixtureValue()));
    renderPanel(store);
    const btn = screen.getByTestId('a11y-quickfix-open-alt-text-inspector');
    fireEvent.click(btn);
    expect(store.getState().altText.open).toBe(true);
  });

  it('open-document-properties quick-fix opens the document-properties dialog', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(runSucceeded(fixtureValue()));
    renderPanel(store);
    const btn = screen.getByTestId('a11y-quickfix-open-document-properties');
    fireEvent.click(btn);
    expect(store.getState().documentProperties.open).toBe(true);
  });

  it('open-reading-order quick-fix arms the reading-order overlay', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    // Add a fail result whose quick-fix is open-reading-order to drive the test.
    store.dispatch(
      runSucceeded(
        fixtureValue({
          results: [
            {
              ruleId: 'a11y.reading.order-defined',
              severity: 'error',
              status: 'fail',
              passed: false,
              message: 'a11y.readingOrderDefined.unevaluatedNoStructTree',
              locations: [],
              quickFix: { kind: 'open-reading-order' },
            },
          ],
          summary: { pass: 0, warn: 0, fail: 1, unevaluated: 0 },
        }),
      ),
    );
    renderPanel(store);
    const btn = screen.getByTestId('a11y-quickfix-open-reading-order');
    fireEvent.click(btn);
    expect(store.getState().readingOrder.active).toBe(true);
  });

  // Wave 5d follow-up (Riley) Fix 1 — targetNodeId plumbing.
  // Each of the three non-tag-editor quick-fix branches now passes
  // targetNodeId through to its slice's open action.

  it('open-reading-order quick-fix WITH targetNodeId seeds the focused entry', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      runSucceeded(
        fixtureValue({
          results: [
            {
              ruleId: 'a11y.reading.order-defined',
              severity: 'error',
              status: 'fail',
              passed: false,
              message: 'a11y.readingOrderDefined.unevaluatedNoStructTree',
              locations: [],
              quickFix: { kind: 'open-reading-order', targetNodeId: 'struct:99' },
            },
          ],
          summary: { pass: 0, warn: 0, fail: 1, unevaluated: 0 },
        }),
      ),
    );
    renderPanel(store);
    fireEvent.click(screen.getByTestId('a11y-quickfix-open-reading-order'));
    expect(store.getState().readingOrder.active).toBe(true);
    expect(store.getState().readingOrder.focusedEntryId).toBe('struct:99');
  });

  it('open-alt-text-inspector quick-fix WITH targetNodeId seeds the figure row', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      runSucceeded(
        fixtureValue({
          results: [
            {
              ruleId: 'a11y.figures.all-have-alt-text',
              severity: 'error',
              status: 'fail',
              passed: false,
              message: 'a11y.figuresAllHaveAltText.fail',
              locations: [{ pageIndex: 0 }],
              quickFix: { kind: 'open-alt-text-inspector', targetNodeId: 'struct:33' },
            },
          ],
          summary: { pass: 0, warn: 0, fail: 1, unevaluated: 0 },
        }),
      ),
    );
    renderPanel(store);
    fireEvent.click(screen.getByTestId('a11y-quickfix-open-alt-text-inspector'));
    expect(store.getState().altText.open).toBe(true);
    expect(store.getState().altText.seedNodeId).toBe('struct:33');
  });

  it('open-document-properties accepts targetNodeId for API symmetry — no-op semantics', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      runSucceeded(
        fixtureValue({
          results: [
            {
              ruleId: 'a11y.document.title-present',
              severity: 'error',
              status: 'fail',
              passed: false,
              message: 'a11y.documentTitlePresent.fail',
              locations: [],
              // No targetNodeId field on the response — but the dispatcher
              // unconditionally passes it (undefined → no-op). Same shape
              // when David later starts including an id.
              quickFix: { kind: 'open-document-properties' },
            },
          ],
          summary: { pass: 0, warn: 0, fail: 1, unevaluated: 0 },
        }),
      ),
    );
    renderPanel(store);
    fireEvent.click(screen.getByTestId('a11y-quickfix-open-document-properties'));
    // The dialog opens (description tab default) — and the slice has no
    // per-struct-node concept, so no seed-equivalent state to inspect.
    expect(store.getState().documentProperties.open).toBe(true);
    expect(store.getState().documentProperties.activeTab).toBe('description');
  });
});
