// Tests for pdf:replaceText handler — Phase 2 (Wave 7, David).

import { describe, expect, it } from 'vitest';

import { handlePdfReplaceText } from './pdf-replace-text.js';
import { expectErr, expectOk } from './test-support.js';

function deps(overrides: Partial<Parameters<typeof handlePdfReplaceText>[1]> = {}) {
  return {
    hasHandle: (_h: number) => true,
    resolveTextSpan: () => null,
    ...overrides,
  };
}

describe('pdf:replaceText handler', () => {
  it('rejects non-integer handle', async () => {
    const r = await handlePdfReplaceText(
      { handle: 'bad' as unknown as number, pageIndex: 0, objectId: '1/0/0', newText: 'x' },
      deps(),
    );
    expectErr(r, 'invalid_payload');
  });

  it('rejects unknown handle', async () => {
    const r = await handlePdfReplaceText(
      { handle: 1, pageIndex: 0, objectId: '1/0/0', newText: 'x' },
      deps({ hasHandle: () => false }),
    );
    expectErr(r, 'handle_not_found');
  });

  it('rejects negative pageIndex', async () => {
    const r = await handlePdfReplaceText(
      { handle: 1, pageIndex: -1, objectId: '1/0/0', newText: 'x' },
      deps(),
    );
    expectErr(r, 'out_of_range');
  });

  it('rejects malformed objectId', async () => {
    const r = await handlePdfReplaceText(
      { handle: 1, pageIndex: 0, objectId: 'bad', newText: 'x' },
      deps(),
    );
    expectErr(r, 'invalid_payload');
  });

  it('rejects too-long newText', async () => {
    const r = await handlePdfReplaceText(
      { handle: 1, pageIndex: 0, objectId: '1/0/0', newText: 'a'.repeat(10_000) },
      deps(),
    );
    expectErr(r, 'invalid_payload');
  });

  it('returns a text-replace op for a valid request', async () => {
    const res = await handlePdfReplaceText(
      { handle: 1, pageIndex: 2, objectId: '5/0/3', newText: 'new value' },
      deps(),
    );
    const value = expectOk(res);
    expect(value.op.kind).toBe('text-replace');
    if (value.op.kind === 'text-replace') {
      expect(value.op.pageIndex).toBe(2);
      expect(value.op.objectId).toBe('5/0/3');
      expect(value.op.newText).toBe('new value');
      expect(value.op.oldText).toBe(''); // Phase-2 conservative
    }
    expect(value.willClip).toBe(false);
  });

  it('reports willClip when resolveTextSpan returns a tight bounding rect', async () => {
    const res = await handlePdfReplaceText(
      { handle: 1, pageIndex: 0, objectId: '5/0/0', newText: 'a long replacement string' },
      deps({
        resolveTextSpan: () => ({
          currentText: 'orig',
          boundingRect: { x: 0, y: 0, width: 10, height: 12 },
          fontSize: 12,
        }),
      }),
    );
    const value = expectOk(res);
    expect(value.willClip).toBe(true);
    expect(value.overflowPt).toBeGreaterThan(0);
  });
});
