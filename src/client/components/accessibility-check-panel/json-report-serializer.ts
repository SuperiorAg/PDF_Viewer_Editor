// Accessibility Checker — JSON report serializer.
// Phase 7.5 C6 §27.3 (Riley Wave 5e).
//
// Pure function: takes a successful `PdfRunAccessibilityCheckValue`
// + the user's export options + the open document's basename, returns a
// JSON-serialized report string with a pinned schema version.
//
// SCHEMA VERSION DISCIPLINE:
//   - `schemaVersion: 1` is PINNED. The regression test imports
//     `ACCESSIBILITY_REPORT_SCHEMA_VERSION` and asserts the serialized
//     output reports `"schemaVersion": 1`. Any future wave that changes
//     the JSON shape MUST bump this constant in lockstep.
//   - The schema mirrors the Preflight JSON export (Wave 5a) where the
//     fields overlap: `schema`, `schemaVersion`, `generatedAt`, `ranAt`,
//     `shippedRuleCount`. The Accessibility-specific additions are
//     `subsetDisclosure` (verbatim P7.5-L-10 string) and the four-state
//     `summary` (pass / warn / fail / unevaluated).
//
// HONESTY CLAUSE (P7.5-L-10):
//   - `subsetDisclosure` passes through VERBATIM from the live response —
//     never paraphrased, never substituted from a hardcoded fallback.
//   - `summary` always carries the FULL four-state count (computed from
//     the engine, unaffected by `includePassed: false`). Filtering the
//     `results[]` array does NOT change the summary — the counts stay
//     honest while the per-rule details narrow.
//   - Each result carries BOTH the i18n `message` key (stable token for
//     downstream tooling — same compromise Preflight took in Wave 5a)
//     AND the translated `messageDisplay` string (human-readable scan).
//
// File-write plumbing lives in `export-report-dialog/index.tsx` — this
// module is pure / testable in isolation.

import type {
  AccessibilityRuleResult,
  PdfRunAccessibilityCheckValue,
} from '../../types/accessibility-check-contract-stub';

/** Pinned at 1. See header for bump policy. */
export const ACCESSIBILITY_REPORT_SCHEMA_VERSION = 1;

/** Stable schema identifier. Downstream tooling matches on this token. */
export const ACCESSIBILITY_REPORT_SCHEMA = 'pdf-viewer-editor.accessibility-report';

export interface ReportExportOptions {
  /** When false, omit `pass`-status results from `results[]`. The summary
   *  pass count is UNAFFECTED — the count remains accurate to the
   *  underlying run. */
  includePassed: boolean;
  /** When false, omit `unevaluated`-status results from `results[]`. The
   *  summary unevaluated count is UNAFFECTED. */
  includeUnevaluated: boolean;
}

export interface ReportInput {
  /** Verbatim engine response from `pdf:runAccessibilityCheck`. */
  value: PdfRunAccessibilityCheckValue;
  /** PDF basename only — no absolute path. The `documentName` field in
   *  the report carries this; the save-dialog destination path lives
   *  outside the report payload (surfaced in the success toast only). */
  documentName: string;
  /** ISO 8601 — wall-clock at export time. The engine's `ranAt` is
   *  carried separately as `checkRanAt`. */
  generatedAt: string;
  options: ReportExportOptions;
  /** i18n resolver — translates the rule's `message` (i18n key) into a
   *  human-readable string for the `messageDisplay` field. Downstream
   *  consumers get BOTH the stable token (`message`) and the localized
   *  string (`messageDisplay`). */
  resolveMessage: (messageKey: string) => string;
}

/** The output shape. Documented in the brief; mirrors the Preflight
 *  Wave 5a shape where fields overlap. */
export interface AccessibilityReportJson {
  schema: typeof ACCESSIBILITY_REPORT_SCHEMA;
  schemaVersion: typeof ACCESSIBILITY_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  checkRanAt: string;
  documentName: string;
  subsetDisclosure: string;
  shippedRuleCount: number;
  summary: PdfRunAccessibilityCheckValue['summary'];
  exportOptions: ReportExportOptions;
  results: ReadonlyArray<AccessibilityReportResultEntry>;
}

export interface AccessibilityReportResultEntry {
  ruleId: string;
  severity: AccessibilityRuleResult['severity'];
  status: AccessibilityRuleResult['status'];
  /** Stable i18n key — downstream tooling wants this token. */
  message: string;
  /** Translated human-readable string for the export reader. */
  messageDisplay: string;
  locations: ReadonlyArray<{ pageIndex: number; structNodeId?: string }>;
}

/** Build the report payload (no JSON.stringify yet — useful for tests
 *  that want to inspect the object shape without re-parsing). */
export function buildAccessibilityReport(input: ReportInput): AccessibilityReportJson {
  const filtered = input.value.results.filter((r) => {
    if (!input.options.includePassed && r.status === 'pass') return false;
    if (!input.options.includeUnevaluated && r.status === 'unevaluated') return false;
    return true;
  });

  const results: AccessibilityReportResultEntry[] = filtered.map((r) => ({
    ruleId: r.ruleId,
    severity: r.severity,
    status: r.status,
    message: r.message,
    messageDisplay: input.resolveMessage(r.message),
    // Map locations: drop the optional `structNodeId` field entirely when
    // absent so the JSON stays clean (no `"structNodeId": undefined`).
    locations: r.locations.map((loc) =>
      loc.structNodeId !== undefined
        ? { pageIndex: loc.pageIndex, structNodeId: loc.structNodeId }
        : { pageIndex: loc.pageIndex },
    ),
  }));

  return {
    schema: ACCESSIBILITY_REPORT_SCHEMA,
    schemaVersion: ACCESSIBILITY_REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    checkRanAt: new Date(input.value.ranAt).toISOString(),
    documentName: input.documentName,
    subsetDisclosure: input.value.subsetDisclosure,
    shippedRuleCount: input.value.shippedRuleCount,
    summary: input.value.summary,
    exportOptions: input.options,
    results,
  };
}

/** Serialize the report to a pretty-printed JSON string (2-space indent —
 *  same convention as the Preflight JSON export in Wave 5a). */
export function serializeAccessibilityReportJson(input: ReportInput): string {
  return JSON.stringify(buildAccessibilityReport(input), null, 2);
}
