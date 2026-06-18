// Phase 7.5 Wave 5b — handler tests for pdf:getStructTree / setStructTree /
// autoTagPages. Tests target the handler-shape boundary (zod validation +
// dep injection); the engines have their own deeper unit tests under
// src/main/pdf-ops/.

import { describe, expect, it, vi } from 'vitest';

import type { AutoTagPageInput } from '../../main/pdf-ops/auto-tag-heuristic.js';
import type {
  GetStructTreeValue,
  SetStructTreeValue,
} from '../../main/pdf-ops/struct-tree-engine.js';
import { ok } from '../../shared/result.js';
import type { StructTreeNode } from '../contracts.js';

import {
  handlePdfAutoTagPages,
  handlePdfGetStructTree,
  handlePdfSetStructTree,
  type PdfStructTreeDeps,
} from './pdf-struct-tree.js';

const FAKE_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

function tree(type: string, children: StructTreeNode[] = []): StructTreeNode {
  return { id: `id-${type}`, type, contentRefs: [], children };
}

describe('handlePdfGetStructTree', () => {
  it('rejects an invalid payload', async () => {
    const res = await handlePdfGetStructTree({ handle: 'wat' }, { getBytes: () => FAKE_BYTES });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns handle_not_found when the handle is unknown', async () => {
    const res = await handlePdfGetStructTree(
      { handle: 99, mergeWithEditSession: false },
      { getBytes: () => null },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('handle_not_found');
  });

  it('returns the engine value on the happy path', async () => {
    const engineGet = vi.fn().mockResolvedValue(
      ok<GetStructTreeValue>({
        tree: tree('Document', [tree('H1')]),
        hasExistingTree: true,
        warnings: ['x'],
      }),
    );
    const res = await handlePdfGetStructTree(
      { handle: 1, mergeWithEditSession: true },
      { getBytes: () => FAKE_BYTES, engineGet },
    );
    expect(engineGet).toHaveBeenCalledWith(FAKE_BYTES);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.hasExistingTags).toBe(true);
    expect(res.value.root?.type).toBe('Document');
    expect(res.value.warnings).toEqual(['x']);
  });
});

describe('handlePdfSetStructTree', () => {
  it('rejects a malformed tree at the zod boundary', async () => {
    const res = await handlePdfSetStructTree(
      { handle: 1, root: { id: '', type: '', contentRefs: [], children: [] } },
      { getBytes: () => FAKE_BYTES },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns handle_not_found when the handle is unknown', async () => {
    const res = await handlePdfSetStructTree(
      { handle: 99, root: tree('Document') },
      { getBytes: () => null },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('handle_not_found');
  });

  it('threads the engine result through and refreshes document-store bytes', async () => {
    const newBytes = new Uint8Array([1, 2, 3]);
    const engineSet = vi.fn().mockResolvedValue(
      ok<SetStructTreeValue>({
        bytes: newBytes,
        warnings: ['Overwriting existing /StructTreeRoot'],
        overwroteExistingTree: true,
      }),
    );
    const setBytes = vi.fn();
    const res = await handlePdfSetStructTree(
      { handle: 7, root: tree('Document', [tree('P')]) },
      { getBytes: () => FAKE_BYTES, engineSet, setBytes },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.sessionId).toBe(7);
    expect(res.value.warnings.some((w) => /Overwriting/.test(w))).toBe(true);
    expect(setBytes).toHaveBeenCalledWith(7, newBytes);
  });

  it('survives setBytes throwing without leaking the error to the caller', async () => {
    const engineSet = vi.fn().mockResolvedValue(
      ok<SetStructTreeValue>({
        bytes: new Uint8Array([0]),
        warnings: [],
        overwroteExistingTree: false,
      }),
    );
    const res = await handlePdfSetStructTree(
      { handle: 1, root: tree('Document') },
      {
        getBytes: () => FAKE_BYTES,
        engineSet,
        setBytes: () => {
          throw new Error('boom');
        },
      },
    );
    expect(res.ok).toBe(true);
  });
});

describe('handlePdfAutoTagPages', () => {
  it('rejects a malformed payload', async () => {
    const res = await handlePdfAutoTagPages(
      { handle: 1, pages: 'wat', heuristic: 'font-size-cluster' },
      { getBytes: () => FAKE_BYTES },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns handle_not_found when the handle is unknown', async () => {
    const res = await handlePdfAutoTagPages(
      { handle: 99, pages: 'all', heuristic: 'font-size-cluster' },
      { getBytes: () => null },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('handle_not_found');
  });

  it('fails honestly when no extractor is wired', async () => {
    const res = await handlePdfAutoTagPages(
      { handle: 1, pages: 'all', heuristic: 'font-size-cluster' },
      { getBytes: () => FAKE_BYTES },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('engine_failed');
  });

  it('runs the heuristic on the stub extractor and returns the proposed tree', async () => {
    // Body-dominant page so the heuristic unambiguously labels the 24pt
    // run as a heading.
    const extract = vi.fn().mockResolvedValue([
      {
        pageIndex: 0,
        pageSize: { widthPt: 612, heightPt: 792 },
        textItems: [
          { text: 'Chapter 1', fontSize: 24, readingIndex: 0 },
          { text: 'body 1', fontSize: 12, readingIndex: 1 },
          { text: 'body 2', fontSize: 12, readingIndex: 2 },
          { text: 'body 3', fontSize: 12, readingIndex: 3 },
        ],
        imageItems: [],
      } satisfies AutoTagPageInput,
    ]);
    const deps: PdfStructTreeDeps = {
      getBytes: () => FAKE_BYTES,
      extractAutoTagPages: extract,
    };
    const res = await handlePdfAutoTagPages(
      { handle: 1, pages: 'all', heuristic: 'font-size-cluster' },
      deps,
    );
    expect(extract).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.proposedRoot.type).toBe('Document');
    expect(res.value.proposedRoot.children[0]!.type).toBe('H1');
  });

  it('surfaces extractor errors as engine_failed', async () => {
    const extract = vi.fn().mockRejectedValue(new Error('pdf.js died'));
    const res = await handlePdfAutoTagPages(
      { handle: 1, pages: 'all', heuristic: 'font-size-cluster' },
      { getBytes: () => FAKE_BYTES, extractAutoTagPages: extract },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('engine_failed');
  });
});
