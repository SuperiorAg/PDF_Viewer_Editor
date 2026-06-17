// Handler tests for pdf:autoBookmarkFromHeadings (Phase 7.5 Wave 4 — B19).

import { describe, expect, it, vi } from 'vitest';

import type {
  autoBookmarkFromHeadings,
  PageTextItem,
} from '../../main/pdf-ops/auto-bookmark-engine.js';
import { fail, ok } from '../../shared/result.js';

import {
  handlePdfAutoBookmarkFromHeadings,
  type PdfAutoBookmarkFromHeadingsDeps,
} from './pdf-auto-bookmark-from-headings.js';
import { expectErr, expectOk } from './test-support.js';

function makeDeps(
  overrides: Partial<PdfAutoBookmarkFromHeadingsDeps> = {},
): PdfAutoBookmarkFromHeadingsDeps {
  return {
    getBytes: vi.fn().mockReturnValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    getPageCount: async () => 1,
    extractPageTextItems: async () => [],
    ...overrides,
  };
}

describe('handlePdfAutoBookmarkFromHeadings', () => {
  it('rejects invalid payload', async () => {
    const res = await handlePdfAutoBookmarkFromHeadings({ handle: 'bad' }, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('rejects maxDepth > 6', async () => {
    const res = await handlePdfAutoBookmarkFromHeadings(
      { handle: 1, heuristic: 'font-size-cluster', maxDepth: 99 },
      makeDeps(),
    );
    expectErr(res, 'invalid_payload');
  });

  it('returns handle_not_found when documentStore has no bytes', async () => {
    const deps = makeDeps({ getBytes: () => null });
    const res = await handlePdfAutoBookmarkFromHeadings(
      { handle: 1, heuristic: 'font-size-cluster', maxDepth: 3 },
      deps,
    );
    expectErr(res, 'handle_not_found');
  });

  it('runs end-to-end against a synthetic extractor', async () => {
    const body: PageTextItem = { text: 'body', fontSize: 12 };
    const deps = makeDeps({
      getPageCount: async () => 1,
      extractPageTextItems: async () => [
        { text: 'Chapter 1', fontSize: 24 },
        body,
        body,
        body,
        { text: 'Section 1.1', fontSize: 16 },
        body,
        body,
      ],
    });
    const res = await handlePdfAutoBookmarkFromHeadings(
      { handle: 1, heuristic: 'font-size-cluster', maxDepth: 3 },
      deps,
    );
    const v = expectOk(res);
    expect(v.proposed.length).toBeGreaterThanOrEqual(2);
    expect(v.proposed[0]!.title).toBe('Chapter 1');
    expect(v.proposed[0]!.depth).toBe(0);
    expect(v.proposed[1]!.title).toBe('Section 1.1');
    expect(v.proposed[1]!.depth).toBe(1);
  });

  it('surfaces no_headings_detected from engine', async () => {
    const res = await handlePdfAutoBookmarkFromHeadings(
      { handle: 1, heuristic: 'font-size-cluster', maxDepth: 3 },
      makeDeps({
        getPageCount: async () => 1,
        extractPageTextItems: async () => [],
      }),
    );
    expectErr(res, 'no_headings_detected');
  });

  it('surfaces engine_failed when getPageCount throws', async () => {
    const res = await handlePdfAutoBookmarkFromHeadings(
      { handle: 1, heuristic: 'font-size-cluster', maxDepth: 3 },
      makeDeps({
        getPageCount: async () => {
          throw new Error('boom');
        },
      }),
    );
    expectErr(res, 'engine_failed');
  });

  it('uses injected engine in success path', async () => {
    const fakeEngine: typeof autoBookmarkFromHeadings = async () =>
      ok({
        proposed: [{ title: 'fake', pageIndex: 0, depth: 0 }],
        warnings: ['stub'],
      });
    const res = await handlePdfAutoBookmarkFromHeadings(
      { handle: 1, heuristic: 'font-size-cluster', maxDepth: 3 },
      makeDeps({ autoBookmarkEngine: fakeEngine }),
    );
    const v = expectOk(res);
    expect(v.proposed).toEqual([{ title: 'fake', pageIndex: 0, depth: 0 }]);
    expect(v.warnings).toEqual(['stub']);
  });

  it('maps engine_failed via injected engine', async () => {
    const fakeEngine: typeof autoBookmarkFromHeadings = async () => fail('engine_failed', 'fake');
    const res = await handlePdfAutoBookmarkFromHeadings(
      { handle: 1, heuristic: 'font-size-cluster', maxDepth: 3 },
      makeDeps({ autoBookmarkEngine: fakeEngine }),
    );
    expectErr(res, 'engine_failed');
  });
});
