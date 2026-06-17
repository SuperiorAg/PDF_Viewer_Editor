// Handler tests for pdf:editLinks (Phase 7.5 Wave 4 — B13).

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import type { editLinks } from '../../main/pdf-ops/link-engine.js';
import { fail, ok } from '../../shared/result.js';

import { handlePdfEditLinks, type PdfEditLinksDeps } from './pdf-edit-links.js';
import { expectErr, expectOk } from './test-support.js';

async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([200, 300]);
  return doc.save();
}

function makeDeps(overrides: Partial<PdfEditLinksDeps> = {}): PdfEditLinksDeps {
  return {
    getBytes: vi.fn().mockReturnValue(new Uint8Array([0])),
    setBytes: vi.fn(),
    ...overrides,
  };
}

describe('handlePdfEditLinks', () => {
  it('rejects empty actions array', async () => {
    const res = await handlePdfEditLinks({ handle: 1, actions: [] }, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('rejects malformed action shape', async () => {
    const res = await handlePdfEditLinks({ handle: 1, actions: [{ kind: 'weird' }] }, makeDeps());
    expectErr(res, 'invalid_payload');
  });

  it('returns handle_not_found when documentStore has no bytes', async () => {
    const deps = makeDeps({ getBytes: () => null });
    const res = await handlePdfEditLinks(
      {
        handle: 1,
        actions: [
          {
            kind: 'add',
            pageIndex: 0,
            bbox: [0, 0, 10, 10],
            target: { kind: 'uri', uri: 'https://x' },
          },
        ],
      },
      deps,
    );
    expectErr(res, 'handle_not_found');
  });

  it('adds a URI link end-to-end and updates store', async () => {
    const bytes = await makePdf(2);
    const setBytes = vi.fn();
    const deps = makeDeps({ getBytes: () => bytes, setBytes });
    const res = await handlePdfEditLinks(
      {
        handle: 9,
        actions: [
          {
            kind: 'add',
            pageIndex: 0,
            bbox: [10, 10, 100, 30],
            target: { kind: 'uri', uri: 'https://example.com' },
          },
        ],
      },
      deps,
    );
    const v = expectOk(res);
    expect(v.linkIds).toEqual(['0:0']);
    expect(setBytes).toHaveBeenCalledTimes(1);
    expect(setBytes.mock.calls[0]![0]).toBe(9);
  });

  it('surfaces link_not_found from engine', async () => {
    const fakeEngine: typeof editLinks = async () => fail('link_not_found', 'gone');
    const deps = makeDeps({
      getBytes: () => new Uint8Array([0x25]),
      linkEngine: fakeEngine,
    });
    const res = await handlePdfEditLinks(
      {
        handle: 1,
        actions: [{ kind: 'remove', linkId: '0:0' }],
      },
      deps,
    );
    expectErr(res, 'link_not_found');
  });

  it('uses injected engine in success path', async () => {
    const fakeEngine: typeof editLinks = async () =>
      ok({ bytes: new Uint8Array([0x25]), linkIds: ['7:3', '7:4'] });
    const setBytes = vi.fn();
    const deps = makeDeps({
      getBytes: () => new Uint8Array([0x25]),
      setBytes,
      linkEngine: fakeEngine,
    });
    const res = await handlePdfEditLinks(
      {
        handle: 2,
        actions: [
          {
            kind: 'add',
            pageIndex: 0,
            bbox: [0, 0, 10, 10],
            target: { kind: 'uri', uri: 'https://a' },
          },
          {
            kind: 'add',
            pageIndex: 0,
            bbox: [0, 20, 10, 30],
            target: { kind: 'uri', uri: 'https://b' },
          },
        ],
      },
      deps,
    );
    const v = expectOk(res);
    expect(v.linkIds).toEqual(['7:3', '7:4']);
    expect(setBytes).toHaveBeenCalled();
  });

  it('maps page_out_of_range engine err to invalid_payload at IPC', async () => {
    const fakeEngine: typeof editLinks = async () =>
      fail('page_out_of_range', 'page 99 out of range');
    const deps = makeDeps({
      getBytes: () => new Uint8Array([0x25]),
      linkEngine: fakeEngine,
    });
    const res = await handlePdfEditLinks(
      {
        handle: 1,
        actions: [
          {
            kind: 'add',
            pageIndex: 0,
            bbox: [0, 0, 10, 10],
            target: { kind: 'goto-page', pageIndex: 99 },
          },
        ],
      },
      deps,
    );
    expectErr(res, 'invalid_payload');
  });
});
