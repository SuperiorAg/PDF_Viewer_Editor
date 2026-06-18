// HTML report template — pure unit tests.
// Phase 7.5 C6 §27.3 (Riley Wave 5e).

import { describe, expect, it } from 'vitest';

import type { PdfRunAccessibilityCheckValue } from '../../types/accessibility-check-contract-stub';

import {
  escapeHtml,
  renderAccessibilityReportHtml,
  type HtmlChromeStrings,
  type HtmlReportInput,
} from './html-report-template';

const VERBATIM_DISCLOSURE = 'Subset of WCAG 2.1 + PDF/UA-1 — see Help for the shipped rule set.';

const CHROME: HtmlChromeStrings = {
  title: 'Accessibility Report',
  documentLabel: 'Document',
  ranAtLabel: 'Check ran at',
  generatedAtLabel: 'Report generated at',
  shippedRulesLabel: '{count} rules shipped',
  summaryHeading: 'Summary',
  passLabel: 'Pass',
  warnLabel: 'Warn',
  failLabel: 'Fail',
  unevaluatedLabel: 'Not assessed',
  omittedLabel: '(omitted from export)',
  failHeading: 'Errors',
  warnHeading: 'Warnings',
  unevaluatedHeading: 'Not assessed',
  passHeading: 'Passed',
  ruleColumn: 'Rule',
  severityColumn: 'Severity',
  statusColumn: 'Status',
  messageColumn: 'Message',
  locationsColumn: 'Locations',
  pageLabel: 'Page {page}',
  footerReminder: 'Subset of WCAG 2.1 + PDF/UA-1 — see Help for the shipped rule set.',
};

function makeValue(): PdfRunAccessibilityCheckValue {
  return {
    results: [
      {
        ruleId: 'a11y.document.title-present',
        severity: 'error',
        status: 'fail',
        passed: false,
        message: 'a11y.documentTitlePresent.fail',
        locations: [],
      },
      {
        ruleId: 'a11y.tables.scope-set',
        severity: 'warning',
        status: 'warn',
        passed: false,
        message: 'a11y.tablesScopeSet.warn',
        locations: [{ pageIndex: 2 }],
      },
      {
        ruleId: 'a11y.color-contrast.spot-sample',
        severity: 'info',
        status: 'unevaluated',
        passed: false,
        message: 'a11y.colorContrast.unevaluated',
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
    summary: { pass: 1, warn: 1, fail: 1, unevaluated: 1 },
    ranAt: 1750000000000,
    shippedRuleCount: 12,
    subsetDisclosure: VERBATIM_DISCLOSURE,
  };
}

function makeInput(overrides: Partial<HtmlReportInput> = {}): HtmlReportInput {
  return {
    value: makeValue(),
    documentName: 'sample.pdf',
    generatedAt: '2026-06-18T18:30:00.000Z',
    options: { includePassed: true, includeUnevaluated: true },
    resolveMessage: (key: string) => `RESOLVED:${key}`,
    appName: 'PDF Viewer Editor',
    appVersion: '0.8.0',
    locale: 'en-US',
    chrome: CHROME,
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('substitutes the five HTML-significant characters', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('passes other characters through verbatim', () => {
    expect(escapeHtml('abc 123 — © λ')).toBe('abc 123 — © λ');
  });

  it('substitutes all occurrences in a mixed string', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('handles a unicode-bearing string without mangling code points', () => {
    expect(escapeHtml('日本語 < テスト')).toBe('日本語 &lt; テスト');
  });
});

describe('renderAccessibilityReportHtml — structure + a11y', () => {
  it('renders a complete HTML document with the right doctype', () => {
    const html = renderAccessibilityReportHtml(makeInput());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.includes('<html lang="en-US">')).toBe(true);
    expect(html.includes('</html>')).toBe(true);
  });

  it('sets the <html lang> attribute from the locale input', () => {
    const html = renderAccessibilityReportHtml(makeInput({ locale: 'es-ES' }));
    expect(html.includes('<html lang="es-ES">')).toBe(true);
  });

  it('has a single <h1> and per-section <h2> headings', () => {
    const html = renderAccessibilityReportHtml(makeInput());
    const h1Count = (html.match(/<h1>/g) ?? []).length;
    expect(h1Count).toBe(1);
    // Summary + (fail / warn / unevaluated / pass) = 5 h2s.
    const h2Count = (html.match(/<h2/g) ?? []).length;
    expect(h2Count).toBeGreaterThanOrEqual(5);
  });

  it('renders results in a <table> with <th scope="col"> headers', () => {
    const html = renderAccessibilityReportHtml(makeInput());
    expect(html.includes('<table')).toBe(true);
    expect(html.includes('scope="col"')).toBe(true);
  });

  it('embeds a single inline <style> block — no external assets', () => {
    const html = renderAccessibilityReportHtml(makeInput());
    expect((html.match(/<style>/g) ?? []).length).toBe(1);
    expect(html.includes('<link')).toBe(false);
    expect(html.includes('<script')).toBe(false);
    expect(html.includes('http://')).toBe(false);
    expect(html.includes('https://')).toBe(false);
  });

  it('contains a @media print block for printable rendering', () => {
    const html = renderAccessibilityReportHtml(makeInput());
    expect(html.includes('@media print')).toBe(true);
  });
});

describe('renderAccessibilityReportHtml — honesty (P7.5-L-10)', () => {
  it('renders the subsetDisclosure VERBATIM in the body', () => {
    const html = renderAccessibilityReportHtml(makeInput());
    expect(html.includes(VERBATIM_DISCLOSURE)).toBe(true);
  });

  it('renders a CUSTOM verbatim disclosure unchanged', () => {
    const html = renderAccessibilityReportHtml(
      makeInput({
        value: { ...makeValue(), subsetDisclosure: 'CUSTOM TEST DISCLOSURE 12345' },
      }),
    );
    expect(html.includes('CUSTOM TEST DISCLOSURE 12345')).toBe(true);
  });

  it('renders the document name (basename) — no absolute path leak', () => {
    const html = renderAccessibilityReportHtml(makeInput({ documentName: 'q.pdf' }));
    expect(html.includes('q.pdf')).toBe(true);
    // The save-dialog destination is NOT part of the input contract — assert
    // no Windows drive-letter path appears in the rendered output.
    expect(html.match(/[A-Z]:\\/i)).toBeNull();
  });
});

describe('renderAccessibilityReportHtml — export options', () => {
  it('renders all four result sections when both gates are on', () => {
    const html = renderAccessibilityReportHtml(makeInput());
    expect(html.includes('data-status="fail"')).toBe(true);
    expect(html.includes('data-status="warn"')).toBe(true);
    expect(html.includes('data-status="unevaluated"')).toBe(true);
    expect(html.includes('data-status="pass"')).toBe(true);
  });

  it('omits the pass <section> entirely when includePassed: false', () => {
    const html = renderAccessibilityReportHtml(
      makeInput({ options: { includePassed: false, includeUnevaluated: true } }),
    );
    // The pass section gets `data-status="pass"` on its `<section>`.
    // The pass summary tile also carries `data-status="pass"`, so the
    // assertion needs to scope to the <section> tag — but the simplest
    // proof: the pass <h2> "Passed (n)" string should NOT appear when
    // the gate is off (no section rendered → no heading).
    expect(html.includes('id="section-pass-heading"')).toBe(false);
  });

  it('omits the unevaluated <section> entirely when includeUnevaluated: false', () => {
    const html = renderAccessibilityReportHtml(
      makeInput({ options: { includePassed: true, includeUnevaluated: false } }),
    );
    expect(html.includes('id="section-unevaluated-heading"')).toBe(false);
  });

  it('still surfaces the omitted counts in the summary tiles', () => {
    const html = renderAccessibilityReportHtml(
      makeInput({ options: { includePassed: false, includeUnevaluated: false } }),
    );
    // The summary tile is still rendered, just labelled as omitted.
    expect(html.includes('tile-pass')).toBe(true);
    expect(html.includes('tile-unevaluated')).toBe(true);
    expect(html.includes('(omitted from export)')).toBe(true);
  });
});

describe('renderAccessibilityReportHtml — schema constants', () => {
  it('does NOT leak the JSON schemaVersion into the HTML body', () => {
    // The schemaVersion is a JSON-only concept; the HTML carries its own
    // chrome. Just sanity-check the literal token does not appear.
    const html = renderAccessibilityReportHtml(makeInput());
    expect(html.includes('schemaVersion')).toBe(false);
  });
});

describe('renderAccessibilityReportHtml — locations + footer', () => {
  it('renders 1-based "Page N" labels from 0-based pageIndex', () => {
    const html = renderAccessibilityReportHtml(makeInput());
    // The warn row has pageIndex: 2 → "Page 3".
    expect(html.includes('Page 3')).toBe(true);
  });

  it('renders app name + version in the footer', () => {
    const html = renderAccessibilityReportHtml(
      makeInput({ appName: 'PDF Viewer Editor', appVersion: '0.8.0' }),
    );
    expect(html.includes('PDF Viewer Editor')).toBe(true);
    expect(html.includes('v0.8.0')).toBe(true);
  });
});
