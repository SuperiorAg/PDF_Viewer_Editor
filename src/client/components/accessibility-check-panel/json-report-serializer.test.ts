// JSON report serializer — pure unit tests.
// Phase 7.5 C6 §27.3 (Riley Wave 5e).

import { describe, expect, it } from 'vitest';

import type { PdfRunAccessibilityCheckValue } from '../../types/accessibility-check-contract-stub';

import {
  ACCESSIBILITY_REPORT_SCHEMA,
  ACCESSIBILITY_REPORT_SCHEMA_VERSION,
  buildAccessibilityReport,
  serializeAccessibilityReportJson,
  type ReportInput,
} from './json-report-serializer';

const VERBATIM_DISCLOSURE = 'Subset of WCAG 2.1 + PDF/UA-1 — see Help for the shipped rule set.';

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
        locations: [{ pageIndex: 2, structNodeId: 'struct:42' }],
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

function makeInput(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    value: makeValue(),
    documentName: 'sample.pdf',
    generatedAt: '2026-06-18T18:30:00.000Z',
    options: { includePassed: true, includeUnevaluated: true },
    resolveMessage: (key: string) => `RESOLVED:${key}`,
    ...overrides,
  };
}

describe('schema constants', () => {
  it('exports the stable schema identifier', () => {
    expect(ACCESSIBILITY_REPORT_SCHEMA).toBe('pdf-viewer-editor.accessibility-report');
  });

  it('exports schemaVersion pinned at 1', () => {
    // DRIFT GATE — bumping this value MUST be a deliberate, downstream-
    // breaking change. The brief Wave 5e contract pins this at 1.
    expect(ACCESSIBILITY_REPORT_SCHEMA_VERSION).toBe(1);
  });
});

describe('buildAccessibilityReport — top-level shape', () => {
  it('carries the schema + version + timestamps + doc name', () => {
    const r = buildAccessibilityReport(makeInput());
    expect(r.schema).toBe('pdf-viewer-editor.accessibility-report');
    expect(r.schemaVersion).toBe(1);
    expect(r.generatedAt).toBe('2026-06-18T18:30:00.000Z');
    expect(r.documentName).toBe('sample.pdf');
  });

  it('converts the engine ms-epoch ranAt to ISO 8601 as checkRanAt', () => {
    const r = buildAccessibilityReport(makeInput());
    expect(r.checkRanAt).toBe(new Date(1750000000000).toISOString());
  });

  it('carries the verbatim subsetDisclosure', () => {
    const r = buildAccessibilityReport(makeInput());
    expect(r.subsetDisclosure).toBe(VERBATIM_DISCLOSURE);
  });

  it('carries shippedRuleCount + summary verbatim from the engine', () => {
    const r = buildAccessibilityReport(makeInput());
    expect(r.shippedRuleCount).toBe(12);
    expect(r.summary).toEqual({ pass: 1, warn: 1, fail: 1, unevaluated: 1 });
  });

  it('carries the exportOptions used to build the payload', () => {
    const r = buildAccessibilityReport(
      makeInput({ options: { includePassed: false, includeUnevaluated: true } }),
    );
    expect(r.exportOptions).toEqual({ includePassed: false, includeUnevaluated: true });
  });
});

describe('buildAccessibilityReport — results[]', () => {
  it('carries BOTH the i18n key (message) and the translated display string', () => {
    const r = buildAccessibilityReport(makeInput());
    const fail = r.results.find((x) => x.ruleId === 'a11y.document.title-present');
    expect(fail?.message).toBe('a11y.documentTitlePresent.fail');
    expect(fail?.messageDisplay).toBe('RESOLVED:a11y.documentTitlePresent.fail');
  });

  it('preserves locations including structNodeId when present', () => {
    const r = buildAccessibilityReport(makeInput());
    const warn = r.results.find((x) => x.ruleId === 'a11y.tables.scope-set');
    expect(warn?.locations).toEqual([{ pageIndex: 2, structNodeId: 'struct:42' }]);
  });

  it('omits structNodeId from a location when the engine did not provide one', () => {
    const r = buildAccessibilityReport(
      makeInput({
        value: {
          ...makeValue(),
          results: [
            {
              ruleId: 'a11y.x',
              severity: 'error',
              status: 'fail',
              passed: false,
              message: 'a11y.x.fail',
              locations: [{ pageIndex: 5 }],
            },
          ],
        },
      }),
    );
    const entry = r.results[0];
    expect(entry?.locations[0]).toEqual({ pageIndex: 5 });
    expect(entry?.locations[0]).not.toHaveProperty('structNodeId');
  });
});

describe('buildAccessibilityReport — includePassed gate (P7.5-L-10)', () => {
  it('omits pass-status results from results[] when includePassed: false', () => {
    const r = buildAccessibilityReport(
      makeInput({ options: { includePassed: false, includeUnevaluated: true } }),
    );
    expect(r.results.find((x) => x.status === 'pass')).toBeUndefined();
    expect(r.results.find((x) => x.status === 'fail')).toBeDefined();
    expect(r.results.find((x) => x.status === 'warn')).toBeDefined();
    expect(r.results.find((x) => x.status === 'unevaluated')).toBeDefined();
  });

  it('does NOT change the summary counts when includePassed: false', () => {
    const r = buildAccessibilityReport(
      makeInput({ options: { includePassed: false, includeUnevaluated: true } }),
    );
    expect(r.summary.pass).toBe(1);
    expect(r.summary.warn).toBe(1);
    expect(r.summary.fail).toBe(1);
    expect(r.summary.unevaluated).toBe(1);
  });

  it('omits unevaluated-status results from results[] when includeUnevaluated: false', () => {
    const r = buildAccessibilityReport(
      makeInput({ options: { includePassed: true, includeUnevaluated: false } }),
    );
    expect(r.results.find((x) => x.status === 'unevaluated')).toBeUndefined();
  });
});

describe('serializeAccessibilityReportJson — string output', () => {
  it('emits valid JSON with the pinned schemaVersion', () => {
    const json = serializeAccessibilityReportJson(makeInput());
    const parsed: unknown = JSON.parse(json);
    expect((parsed as { schemaVersion: number }).schemaVersion).toBe(1);
  });

  it('emits a pretty-printed (2-space) JSON document', () => {
    const json = serializeAccessibilityReportJson(makeInput());
    // 2-space indent is the Wave 5a Preflight convention. The presence
    // of "\n  " (newline + two spaces) at the top-level proves this.
    expect(json.includes('\n  "schema"')).toBe(true);
  });

  it('snapshot — the v1 output shape for a representative fixture', () => {
    const json = serializeAccessibilityReportJson(makeInput());
    expect(json).toMatchSnapshot();
  });
});
