// Unit tests for the Phase 7.5 Wave 4 B13 Link engine.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { editLinks, listLinks } from './link-engine.js';

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) doc.addPage([200, 300]);
  return doc.save();
}

describe('listLinks', () => {
  it('rejects empty bytes', async () => {
    const res = await listLinks(new Uint8Array(0));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns empty list on a fresh PDF', async () => {
    const bytes = await makePdf(3);
    const res = await listLinks(bytes);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.links).toEqual([]);
  });
});

describe('editLinks add + list round-trip', () => {
  it('adds a URI link and lists it back', async () => {
    const bytes = await makePdf(2);
    const added = await editLinks(bytes, [
      {
        kind: 'add',
        pageIndex: 0,
        bbox: [10, 20, 100, 40],
        target: { kind: 'uri', uri: 'https://example.com' },
      },
    ]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.linkIds).toEqual(['0:0']);

    const listed = await listLinks(added.value.bytes);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.links).toHaveLength(1);
    const link = listed.value.links[0]!;
    expect(link.linkId).toBe('0:0');
    expect(link.pageIndex).toBe(0);
    expect(link.bbox).toEqual([10, 20, 100, 40]);
    expect(link.target).toEqual({ kind: 'uri', uri: 'https://example.com' });
  });

  it('adds a goto-page link with fit-page zoom', async () => {
    const bytes = await makePdf(3);
    const added = await editLinks(bytes, [
      {
        kind: 'add',
        pageIndex: 0,
        bbox: [0, 0, 50, 20],
        target: { kind: 'goto-page', pageIndex: 2, zoom: 'fit-page' },
      },
    ]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const listed = await listLinks(added.value.bytes);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.links).toHaveLength(1);
    expect(listed.value.links[0]!.target).toEqual({
      kind: 'goto-page',
      pageIndex: 2,
      zoom: 'fit-page',
    });
  });

  it('rejects goto-page with out-of-range pageIndex', async () => {
    const bytes = await makePdf(2);
    const res = await editLinks(bytes, [
      {
        kind: 'add',
        pageIndex: 0,
        bbox: [0, 0, 10, 10],
        target: { kind: 'goto-page', pageIndex: 9 },
      },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('page_out_of_range');
  });

  it('updates an existing link target', async () => {
    const bytes = await makePdf(2);
    const added = await editLinks(bytes, [
      {
        kind: 'add',
        pageIndex: 0,
        bbox: [0, 0, 50, 20],
        target: { kind: 'uri', uri: 'https://old.example' },
      },
    ]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const updated = await editLinks(added.value.bytes, [
      {
        kind: 'update',
        linkId: '0:0',
        target: { kind: 'uri', uri: 'https://new.example' },
      },
    ]);
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const listed = await listLinks(updated.value.bytes);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.links).toHaveLength(1);
    expect(listed.value.links[0]!.target).toEqual({
      kind: 'uri',
      uri: 'https://new.example',
    });
  });

  it('removes a link cleanly', async () => {
    const bytes = await makePdf(2);
    const added = await editLinks(bytes, [
      {
        kind: 'add',
        pageIndex: 0,
        bbox: [0, 0, 50, 20],
        target: { kind: 'uri', uri: 'https://a' },
      },
      {
        kind: 'add',
        pageIndex: 0,
        bbox: [0, 30, 50, 50],
        target: { kind: 'uri', uri: 'https://b' },
      },
    ]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.linkIds).toEqual(['0:0', '0:1']);

    const removed = await editLinks(added.value.bytes, [{ kind: 'remove', linkId: '0:0' }]);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const listed = await listLinks(removed.value.bytes);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.links).toHaveLength(1);
    expect(listed.value.links[0]!.target).toEqual({ kind: 'uri', uri: 'https://b' });
  });

  it('returns link_not_found for an unknown linkId', async () => {
    const bytes = await makePdf(1);
    const res = await editLinks(bytes, [{ kind: 'remove', linkId: '0:99' }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('link_not_found');
  });

  it('rejects malformed linkId', async () => {
    const bytes = await makePdf(1);
    const res = await editLinks(bytes, [
      { kind: 'update', linkId: 'not-an-id', target: { kind: 'uri', uri: 'x' } },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('full add → list → update → remove round-trip', async () => {
    const bytes = await makePdf(2);

    // 1. Add
    const r1 = await editLinks(bytes, [
      {
        kind: 'add',
        pageIndex: 1,
        bbox: [5, 5, 100, 25],
        target: { kind: 'uri', uri: 'https://example.com/start' },
      },
    ]);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const idAfterAdd = r1.value.linkIds[0]!;

    // 2. List
    const l1 = await listLinks(r1.value.bytes);
    expect(l1.ok).toBe(true);
    if (!l1.ok) return;
    expect(l1.value.links.map((l) => l.linkId)).toContain(idAfterAdd);

    // 3. Update
    const r2 = await editLinks(r1.value.bytes, [
      {
        kind: 'update',
        linkId: idAfterAdd,
        target: { kind: 'goto-page', pageIndex: 0, zoom: 'fit-width' },
      },
    ]);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    // 4. List
    const l2 = await listLinks(r2.value.bytes);
    expect(l2.ok).toBe(true);
    if (!l2.ok) return;
    expect(l2.value.links).toHaveLength(1);
    expect(l2.value.links[0]!.target).toEqual({
      kind: 'goto-page',
      pageIndex: 0,
      zoom: 'fit-width',
    });

    // 5. Remove
    const r3 = await editLinks(r2.value.bytes, [{ kind: 'remove', linkId: idAfterAdd }]);
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;

    // 6. List — empty
    const l3 = await listLinks(r3.value.bytes);
    expect(l3.ok).toBe(true);
    if (!l3.ok) return;
    expect(l3.value.links).toEqual([]);
  });

  it('preserves goto-bookmark via private key', async () => {
    const bytes = await makePdf(2);
    const added = await editLinks(bytes, [
      {
        kind: 'add',
        pageIndex: 0,
        bbox: [0, 0, 50, 20],
        target: { kind: 'goto-bookmark', bookmarkId: 42 },
      },
    ]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const listed = await listLinks(added.value.bytes);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.links).toHaveLength(1);
    expect(listed.value.links[0]!.target).toEqual({ kind: 'goto-bookmark', bookmarkId: 42 });
  });

  // Wave 5 carry-over (2026-06-17, David): when a bookmarksResolver is
  // provided, goto-bookmark must produce a real /Dest so the link works in
  // Acrobat — AND the private /ConductorBookmarkId stays put so the round-
  // trip still surfaces as goto-bookmark (renderer intent preservation).
  it('Wave-5 carry-over: goto-bookmark with resolver emits /Dest AND preserves bookmark id', async () => {
    const bytes = await makePdf(4);
    const resolver = (bookmarkId: number): number | null => {
      if (bookmarkId === 7) return 2; // bookmarkId 7 → page index 2
      return null;
    };
    const added = await editLinks(
      bytes,
      [
        {
          kind: 'add',
          pageIndex: 0,
          bbox: [0, 0, 50, 20],
          target: { kind: 'goto-bookmark', bookmarkId: 7 },
        },
      ],
      { bookmarksResolver: resolver },
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    // Inspect the raw PDF dict to confirm /Dest was written.
    const out = await PDFDocument.load(added.value.bytes);
    const page0 = out.getPage(0);
    const annots = page0.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    expect(annots).toBeDefined();
    const annotDict = annots!.lookupMaybe(0, PDFDict);
    expect(annotDict).toBeDefined();
    const dest = annotDict!.lookupMaybe(PDFName.of('Dest'), PDFArray);
    expect(dest).toBeDefined();
    expect(dest!.size()).toBeGreaterThanOrEqual(2);
    // First entry of /Dest must be a page ref pointing at page 2 of the output.
    const pageRef = dest!.get(0);
    expect(pageRef).toBeInstanceOf(PDFRef);
    const targetPage = out.getPage(2);
    expect((pageRef as PDFRef).objectNumber).toBe(targetPage.ref.objectNumber);
    // Second entry is the /Fit name.
    const fitName = dest!.lookupMaybe(1, PDFName);
    expect(fitName?.asString()).toBe('/Fit');

    // Round-trip: list still surfaces this as goto-bookmark (renderer intent
    // preserved). The /Dest is for Acrobat; /ConductorBookmarkId is for us.
    const listed = await listLinks(added.value.bytes);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.links).toHaveLength(1);
    expect(listed.value.links[0]!.target).toEqual({ kind: 'goto-bookmark', bookmarkId: 7 });
  });

  it('Wave-5 carry-over: resolver returning null falls back to private key only', async () => {
    const bytes = await makePdf(3);
    const resolver = (): number | null => null; // unknown bookmark
    const added = await editLinks(
      bytes,
      [
        {
          kind: 'add',
          pageIndex: 0,
          bbox: [0, 0, 50, 20],
          target: { kind: 'goto-bookmark', bookmarkId: 999 },
        },
      ],
      { bookmarksResolver: resolver },
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    // /Dest must NOT have been emitted.
    const out = await PDFDocument.load(added.value.bytes);
    const annots = out.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    const annotDict = annots!.lookupMaybe(0, PDFDict);
    expect(annotDict!.lookupMaybe(PDFName.of('Dest'), PDFArray)).toBeUndefined();
    // Private key still present.
    expect(annotDict!.has(PDFName.of('ConductorBookmarkId'))).toBe(true);
  });
});
