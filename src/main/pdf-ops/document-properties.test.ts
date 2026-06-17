// Unit tests for the Phase 7.5 Wave 5 B21 document-properties engine.

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { getDocumentProperties, setDocumentProperties } from './document-properties.js';

async function makePdf(
  opts: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    creator?: string;
    producer?: string;
    pageSizes?: [number, number][];
  } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (opts.title !== undefined) doc.setTitle(opts.title);
  if (opts.author !== undefined) doc.setAuthor(opts.author);
  if (opts.subject !== undefined) doc.setSubject(opts.subject);
  if (opts.keywords !== undefined) doc.setKeywords(opts.keywords);
  if (opts.creator !== undefined) doc.setCreator(opts.creator);
  if (opts.producer !== undefined) doc.setProducer(opts.producer);
  const pages = opts.pageSizes ?? [[612, 792]];
  for (const [w, h] of pages) doc.addPage([w, h]);
  return doc.save();
}

describe('getDocumentProperties', () => {
  it('rejects empty bytes', async () => {
    const res = await getDocumentProperties(new Uint8Array(0));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('reads canonical /Info fields', async () => {
    const bytes = await makePdf({
      title: 'My Doc',
      author: 'Alice',
      subject: 'Test',
      keywords: ['alpha', 'beta', 'gamma'],
      creator: 'Test Suite',
    });
    const res = await getDocumentProperties(bytes);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.properties.title).toBe('My Doc');
    expect(res.value.properties.author).toBe('Alice');
    expect(res.value.properties.subject).toBe('Test');
    expect(res.value.properties.keywords).toEqual(['alpha', 'beta', 'gamma']);
    expect(res.value.properties.creator).toBe('Test Suite');
    expect(res.value.properties.producer).not.toBeNull();
  });

  it('returns pageSizes per page', async () => {
    const bytes = await makePdf({
      pageSizes: [
        [612, 792],
        [400, 600],
        [200, 300],
      ],
    });
    const res = await getDocumentProperties(bytes);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.pageSizes).toHaveLength(3);
    expect(res.value.pageSizes[0]).toMatchObject({ pageIndex: 0, widthPt: 612, heightPt: 792 });
    expect(res.value.pageSizes[2]).toMatchObject({ pageIndex: 2, widthPt: 200, heightPt: 300 });
  });

  it('returns securitySummary for an unencrypted doc', async () => {
    const bytes = await makePdf({});
    const res = await getDocumentProperties(bytes);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.securitySummary.encrypted).toBe(false);
    expect(res.value.securitySummary.encryptionAlgorithm).toBe('none');
  });

  it('treats missing /Info fields as null', async () => {
    const bytes = await makePdf({});
    const res = await getDocumentProperties(bytes);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.properties.title).toBeNull();
    expect(res.value.properties.author).toBeNull();
    expect(res.value.properties.subject).toBeNull();
    expect(res.value.properties.keywords).toEqual([]);
  });
});

describe('setDocumentProperties', () => {
  it('rejects empty bytes', async () => {
    const res = await setDocumentProperties({
      pdfBytes: new Uint8Array(0),
      properties: { title: 'X' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('round-trip: setTitle → save → reload → getTitle', async () => {
    const bytes = await makePdf({});
    const setRes = await setDocumentProperties({
      pdfBytes: bytes,
      properties: { title: 'NEW TITLE', author: 'NEW AUTHOR' },
    });
    expect(setRes.ok).toBe(true);
    if (!setRes.ok) return;

    const getRes = await getDocumentProperties(setRes.value.bytes);
    expect(getRes.ok).toBe(true);
    if (!getRes.ok) return;
    expect(getRes.value.properties.title).toBe('NEW TITLE');
    expect(getRes.value.properties.author).toBe('NEW AUTHOR');
  });

  it('round-trip: keywords array survives', async () => {
    const bytes = await makePdf({});
    const setRes = await setDocumentProperties({
      pdfBytes: bytes,
      properties: { keywords: ['foo', 'bar', 'baz'] },
    });
    expect(setRes.ok).toBe(true);
    if (!setRes.ok) return;
    const getRes = await getDocumentProperties(setRes.value.bytes);
    expect(getRes.ok).toBe(true);
    if (!getRes.ok) return;
    expect(getRes.value.properties.keywords).toEqual(['foo', 'bar', 'baz']);
  });

  it('only writes provided fields; leaves others untouched', async () => {
    const bytes = await makePdf({
      title: 'KEEP TITLE',
      author: 'KEEP AUTHOR',
    });
    const setRes = await setDocumentProperties({
      pdfBytes: bytes,
      properties: { subject: 'NEW SUBJECT' }, // only subject
    });
    expect(setRes.ok).toBe(true);
    if (!setRes.ok) return;
    const getRes = await getDocumentProperties(setRes.value.bytes);
    expect(getRes.ok).toBe(true);
    if (!getRes.ok) return;
    expect(getRes.value.properties.title).toBe('KEEP TITLE');
    expect(getRes.value.properties.author).toBe('KEEP AUTHOR');
    expect(getRes.value.properties.subject).toBe('NEW SUBJECT');
  });

  it('surfaces warning when customMetadata is non-empty', async () => {
    const bytes = await makePdf({});
    const setRes = await setDocumentProperties({
      pdfBytes: bytes,
      properties: { customMetadata: { myKey: 'myValue' } },
    });
    expect(setRes.ok).toBe(true);
    if (!setRes.ok) return;
    expect(setRes.value.warnings.some((w) => w.toLowerCase().includes('custom'))).toBe(true);
  });
});
