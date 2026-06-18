// Accessibility Checker — HTML standalone report template.
// Phase 7.5 C6 §27.3 (Riley Wave 5e).
//
// Pure function: takes a `ReportInput` (the same shape the JSON
// serializer accepts) + app metadata (name + version), returns a
// self-contained HTML string.
//
// "Self-contained" is the strict contract:
//   - No external CSS links, no external JS, no remote fonts, no images.
//   - All styling lives in a single inline `<style>` block.
//   - Uses system-font stack — works on any OS without network.
//   - Printable: a `@media print` block adjusts colors to ink-friendly.
//
// Accessibility of the report itself:
//   - `<html lang="...">` populated (default "en" — locale-driven via input).
//   - Semantic structure: single `<h1>`, `<section>` per severity group,
//     `<table>` with `<th scope="col">` for results.
//   - Subset disclosure rendered in a banner with `role="note"` and an
//     `aria-label` for screen readers.
//   - Status color coded but ALSO carries a textual badge label so users
//     who can't perceive color get the same information (WCAG 1.4.1).
//
// HONESTY CLAUSE (P7.5-L-10):
//   - `subsetDisclosure` rendered VERBATIM. The escapeHtml helper is
//     character-substituting only; it does NOT rewrite text content.
//   - `includePassed: false` omits the pass <section> entirely AND
//     marks the summary tile so the reader knows what was filtered.
//   - `includeUnevaluated: false` mirrors the same for the unevaluated
//     bucket.
//
// File-write plumbing lives in `export-report-dialog/index.tsx` — this
// module is pure / testable in isolation.

import type { PdfRunAccessibilityCheckValue } from '../../types/accessibility-check-contract-stub';

import type { ReportInput, AccessibilityReportResultEntry } from './json-report-serializer';
import { buildAccessibilityReport } from './json-report-serializer';

/** Additional input the HTML template needs beyond `ReportInput` —
 *  app metadata for the footer + locale for `<html lang>`. */
export interface HtmlReportInput extends ReportInput {
  /** App name (e.g. "PDF Viewer Editor"). Footer surface. */
  appName: string;
  /** App version string (e.g. "0.8.0"). Footer surface. */
  appVersion: string;
  /** BCP-47 locale code (e.g. "en-US"). Sets `<html lang="...">`. */
  locale: string;
  /** i18n keys → strings — the small UI-chrome set the template needs
   *  (titles, severity labels, etc.). Keeps the function pure & locale-
   *  driven without importing the i18n runtime. */
  chrome: HtmlChromeStrings;
}

export interface HtmlChromeStrings {
  /** "Accessibility Report" — `<title>` + `<h1>`. */
  title: string;
  /** "Document" label. */
  documentLabel: string;
  /** "Check ran at" label. */
  ranAtLabel: string;
  /** "Report generated at" label. */
  generatedAtLabel: string;
  /** "{n} rules shipped" label — template includes `{count}`. */
  shippedRulesLabel: string;
  /** "Summary" heading. */
  summaryHeading: string;
  /** Bucket labels. */
  passLabel: string;
  warnLabel: string;
  failLabel: string;
  unevaluatedLabel: string;
  /** "(omitted from export)" appended to a summary tile when the
   *  bucket was filtered out via export options. */
  omittedLabel: string;
  /** Results-section headings. */
  failHeading: string;
  warnHeading: string;
  unevaluatedHeading: string;
  passHeading: string;
  /** Table column headers. */
  ruleColumn: string;
  severityColumn: string;
  statusColumn: string;
  messageColumn: string;
  locationsColumn: string;
  /** "Page {n}" template — `{page}` placeholder. */
  pageLabel: string;
  /** Footer closing reminder. */
  footerReminder: string;
}

/** Substitute the five HTML-significant characters plus a few unicode
 *  forms a malicious / unusual rule message might carry. */
export function escapeHtml(value: string): string {
  let out = '';
  for (const ch of value) {
    switch (ch) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&#39;';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/** Tiny interpolation helper — replaces `{key}` tokens. The chrome
 *  strings carry `{count}` / `{page}` / etc. placeholders. */
function interp(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

/** Pure entry point. Build the full HTML document as one string. */
export function renderAccessibilityReportHtml(input: HtmlReportInput): string {
  const report = buildAccessibilityReport(input);
  const { chrome } = input;

  // Group filtered results by status. The template ordering (fail → warn
  // → unevaluated → pass) mirrors the panel's visual ordering — the
  // reader's eye hits problems first.
  const byStatus = groupByStatus(report.results);

  const sections = renderSections(byStatus, chrome, input.options);

  const summary = renderSummary(report.summary, chrome, input.options);

  return `<!DOCTYPE html>
<html lang="${escapeHtml(input.locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(chrome.title)} — ${escapeHtml(report.documentName)}</title>
  <style>${INLINE_CSS}</style>
</head>
<body>
  <header class="report-header">
    <h1>${escapeHtml(chrome.title)}</h1>
    <dl class="meta">
      <div><dt>${escapeHtml(chrome.documentLabel)}</dt><dd>${escapeHtml(report.documentName)}</dd></div>
      <div><dt>${escapeHtml(chrome.ranAtLabel)}</dt><dd>${escapeHtml(report.checkRanAt)}</dd></div>
      <div><dt>${escapeHtml(chrome.generatedAtLabel)}</dt><dd>${escapeHtml(report.generatedAt)}</dd></div>
      <div><dt>${escapeHtml(interp(chrome.shippedRulesLabel, { count: report.shippedRuleCount }))}</dt><dd></dd></div>
    </dl>
    <aside class="subset-disclosure" role="note" aria-label="${escapeHtml(chrome.title)}">
      <p>${escapeHtml(report.subsetDisclosure)}</p>
    </aside>
  </header>

  <section class="summary" aria-labelledby="summary-heading">
    <h2 id="summary-heading">${escapeHtml(chrome.summaryHeading)}</h2>
    <div class="summary-tiles">
      ${summary}
    </div>
  </section>

  ${sections}

  <footer class="report-footer">
    <p>${escapeHtml(input.appName)} v${escapeHtml(input.appVersion)}</p>
    <p>${escapeHtml(chrome.footerReminder)}</p>
  </footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

type StatusKind = 'fail' | 'warn' | 'unevaluated' | 'pass';

function groupByStatus(
  results: ReadonlyArray<AccessibilityReportResultEntry>,
): Record<StatusKind, AccessibilityReportResultEntry[]> {
  const out: Record<StatusKind, AccessibilityReportResultEntry[]> = {
    fail: [],
    warn: [],
    unevaluated: [],
    pass: [],
  };
  for (const r of results) {
    out[r.status as StatusKind].push(r);
  }
  return out;
}

function renderSummary(
  summary: PdfRunAccessibilityCheckValue['summary'],
  chrome: HtmlChromeStrings,
  options: ReportInput['options'],
): string {
  const tiles: Array<[StatusKind, string, number, boolean]> = [
    ['fail', chrome.failLabel, summary.fail, false],
    ['warn', chrome.warnLabel, summary.warn, false],
    ['unevaluated', chrome.unevaluatedLabel, summary.unevaluated, !options.includeUnevaluated],
    ['pass', chrome.passLabel, summary.pass, !options.includePassed],
  ];
  return tiles
    .map(
      ([kind, label, count, omitted]) =>
        `<div class="tile tile-${kind}" data-status="${kind}">
          <span class="tile-shape" aria-hidden="true">${TILE_SHAPE[kind]}</span>
          <span class="tile-count">${escapeHtml(String(count))}</span>
          <span class="tile-label">${escapeHtml(label)}</span>
          ${omitted ? `<span class="tile-omitted">${escapeHtml(chrome.omittedLabel)}</span>` : ''}
        </div>`,
    )
    .join('\n      ');
}

/** Shape labels guarantee status is conveyed without color (WCAG 1.4.1). */
const TILE_SHAPE: Record<StatusKind, string> = {
  fail: '✕', // ✕
  warn: '⚠', // ⚠
  unevaluated: '?', // ?
  pass: '✓', // ✓
};

function renderSections(
  byStatus: Record<StatusKind, AccessibilityReportResultEntry[]>,
  chrome: HtmlChromeStrings,
  options: ReportInput['options'],
): string {
  const out: string[] = [];
  // fail / warn always render; unevaluated and pass respect the gates.
  out.push(renderSection('fail', chrome.failHeading, byStatus.fail, chrome));
  out.push(renderSection('warn', chrome.warnHeading, byStatus.warn, chrome));
  if (options.includeUnevaluated) {
    out.push(renderSection('unevaluated', chrome.unevaluatedHeading, byStatus.unevaluated, chrome));
  }
  if (options.includePassed) {
    out.push(renderSection('pass', chrome.passHeading, byStatus.pass, chrome));
  }
  return out.join('\n  ');
}

function renderSection(
  kind: StatusKind,
  heading: string,
  rows: ReadonlyArray<AccessibilityReportResultEntry>,
  chrome: HtmlChromeStrings,
): string {
  const headingId = `section-${kind}-heading`;
  return `<section class="results results-${kind}" data-status="${kind}" aria-labelledby="${headingId}">
    <h2 id="${headingId}">${escapeHtml(heading)} (${rows.length})</h2>
    ${rows.length === 0 ? '<p class="empty">—</p>' : renderTable(rows, chrome)}
  </section>`;
}

function renderTable(
  rows: ReadonlyArray<AccessibilityReportResultEntry>,
  chrome: HtmlChromeStrings,
): string {
  const head = `<thead><tr>
    <th scope="col">${escapeHtml(chrome.ruleColumn)}</th>
    <th scope="col">${escapeHtml(chrome.severityColumn)}</th>
    <th scope="col">${escapeHtml(chrome.statusColumn)}</th>
    <th scope="col">${escapeHtml(chrome.messageColumn)}</th>
    <th scope="col">${escapeHtml(chrome.locationsColumn)}</th>
  </tr></thead>`;
  const body =
    '<tbody>' +
    rows
      .map(
        (r) =>
          `<tr data-rule-id="${escapeHtml(r.ruleId)}">
        <td class="cell-rule"><code>${escapeHtml(r.ruleId)}</code></td>
        <td class="cell-severity">${escapeHtml(r.severity)}</td>
        <td class="cell-status">${escapeHtml(r.status)}</td>
        <td class="cell-message">${escapeHtml(r.messageDisplay)}</td>
        <td class="cell-locations">${renderLocations(r.locations, chrome)}</td>
      </tr>`,
      )
      .join('') +
    '</tbody>';
  return `<table class="results-table">${head}${body}</table>`;
}

function renderLocations(
  locations: ReadonlyArray<{ pageIndex: number; structNodeId?: string }>,
  chrome: HtmlChromeStrings,
): string {
  if (locations.length === 0) return '<span class="no-locations">—</span>';
  return locations
    .map((loc) => escapeHtml(interp(chrome.pageLabel, { page: loc.pageIndex + 1 })))
    .join(', ');
}

// ---------------------------------------------------------------------------
// Inline CSS — kept brief; printable; no remote fonts; uses system stack.
// Color-coding is supplemented by a unicode shape per status so the
// report stays readable with color alone removed (printer-friendly).
// ---------------------------------------------------------------------------

const INLINE_CSS = `
  :root { color-scheme: light; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1c2026;
    background: #ffffff;
    margin: 0;
    padding: 24px;
    line-height: 1.45;
  }
  h1 { font-size: 22px; margin: 0 0 12px; }
  h2 { font-size: 16px; margin: 24px 0 8px; }
  dl.meta { display: grid; grid-template-columns: max-content 1fr; column-gap: 12px; row-gap: 4px; margin: 0 0 16px; }
  dl.meta > div { display: contents; }
  dl.meta dt { font-weight: 600; color: #4a525d; }
  dl.meta dd { margin: 0; }
  aside.subset-disclosure {
    border-left: 3px solid #4a525d;
    background: #f5f7fa;
    padding: 8px 12px;
    margin: 12px 0 0;
    font-style: italic;
    color: #1c2026;
  }
  aside.subset-disclosure p { margin: 0; }
  .summary-tiles { display: flex; flex-wrap: wrap; gap: 12px; }
  .tile {
    display: flex; flex-direction: column; align-items: flex-start;
    padding: 12px 16px; border: 2px solid #c5cdd6; border-radius: 6px;
    min-width: 96px;
  }
  .tile-shape { font-size: 18px; line-height: 1; }
  .tile-count { font-size: 24px; font-weight: 700; margin-top: 4px; }
  .tile-label { font-size: 12px; color: #4a525d; }
  .tile-omitted { font-size: 10px; color: #4a525d; font-style: italic; margin-top: 2px; }
  .tile-fail { border-color: #ef4444; color: #b91c1c; }
  .tile-warn { border-color: #f59e0b; color: #b45309; }
  .tile-unevaluated { border-color: #c5cdd6; color: #4a525d; }
  .tile-pass { border-color: #16a34a; color: #166534; }
  section.results { margin-top: 16px; }
  table.results-table {
    width: 100%; border-collapse: collapse; margin-top: 8px;
    border: 1px solid #c5cdd6;
  }
  table.results-table th,
  table.results-table td {
    text-align: left; vertical-align: top;
    padding: 6px 10px; border-top: 1px solid #eef0f3;
    font-size: 13px;
  }
  table.results-table thead th {
    background: #f5f7fa; border-bottom: 1px solid #c5cdd6;
    font-weight: 600;
  }
  table.results-table code { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 12px; }
  .cell-severity, .cell-status { text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
  .results-fail .cell-status { color: #b91c1c; font-weight: 600; }
  .results-warn .cell-status { color: #b45309; font-weight: 600; }
  .results-unevaluated .cell-status { color: #4a525d; font-weight: 600; }
  .results-pass .cell-status { color: #166534; font-weight: 600; }
  .empty { color: #4a525d; font-style: italic; }
  footer.report-footer {
    margin-top: 32px; padding-top: 12px; border-top: 1px solid #c5cdd6;
    color: #4a525d; font-size: 12px;
  }
  footer.report-footer p { margin: 2px 0; }
  @media print {
    body { padding: 0.5in; color: #000; background: #fff; }
    .tile { border-color: #000 !important; color: #000 !important; }
    table.results-table, table.results-table th, table.results-table td { border-color: #000 !important; }
    .results-fail .cell-status,
    .results-warn .cell-status,
    .results-unevaluated .cell-status,
    .results-pass .cell-status { color: #000 !important; }
  }
`;
