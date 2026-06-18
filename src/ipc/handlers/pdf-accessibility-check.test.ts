// Handler tests for pdf:runAccessibilityCheck.

import { describe, expect, it, vi } from 'vitest';

import { SUBSET_DISCLOSURE } from '../../main/pdf-ops/accessibility-engine.js';
import { ok } from '../../shared/result.js';
import type { PdfRunAccessibilityCheckValue } from '../contracts.js';

import {
  handlePdfRunAccessibilityCheck,
  type PdfAccessibilityCheckDeps,
} from './pdf-accessibility-check.js';

const FAKE_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

function happyValue(): PdfRunAccessibilityCheckValue {
  return {
    results: [
      {
        ruleId: 'a11y.document.title-present',
        severity: 'error',
        status: 'pass',
        passed: true,
        message: 'a11y.documentTitlePresent.pass',
        locations: [],
      },
    ],
    summary: { pass: 1, warn: 0, fail: 0, unevaluated: 0 },
    ranAt: Date.now(),
    shippedRuleCount: 1,
    subsetDisclosure: SUBSET_DISCLOSURE,
  };
}

describe('handlePdfRunAccessibilityCheck', () => {
  it('rejects invalid payloads', async () => {
    const res = await handlePdfRunAccessibilityCheck(
      { handle: 'oops' },
      { getBytes: () => FAKE_BYTES },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns handle_not_found when handle is unknown', async () => {
    const res = await handlePdfRunAccessibilityCheck({ handle: 42 }, { getBytes: () => null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('handle_not_found');
  });

  it('returns engine_failed when the engine throws', async () => {
    const engineRun = vi.fn().mockRejectedValue(new Error('boom'));
    const deps: PdfAccessibilityCheckDeps = {
      getBytes: () => FAKE_BYTES,
      engineRun,
    };
    const res = await handlePdfRunAccessibilityCheck({ handle: 1 }, deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('engine_failed');
  });

  it('passes the value through on happy path', async () => {
    const engineRun = vi.fn().mockResolvedValue(ok(happyValue()));
    const deps: PdfAccessibilityCheckDeps = {
      getBytes: () => FAKE_BYTES,
      engineRun,
    };
    const res = await handlePdfRunAccessibilityCheck({ handle: 1 }, deps);
    expect(engineRun).toHaveBeenCalledWith(FAKE_BYTES, {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.shippedRuleCount).toBe(1);
    expect(res.value.subsetDisclosure).toBe(SUBSET_DISCLOSURE);
    expect(res.value.results).toHaveLength(1);
  });

  it('forwards the extractor when provided', async () => {
    const extractor = vi.fn().mockResolvedValue([]);
    const engineRun = vi.fn().mockResolvedValue(ok(happyValue()));
    const deps: PdfAccessibilityCheckDeps = {
      getBytes: () => FAKE_BYTES,
      engineRun,
      extractor,
    };
    await handlePdfRunAccessibilityCheck({ handle: 1 }, deps);
    expect(engineRun).toHaveBeenCalledWith(FAKE_BYTES, { extractor });
  });
});
