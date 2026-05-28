import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeBufferHash, computeFileHash } from './file-hash.js';

describe('file-hash', () => {
  let dir: string;
  let smallPath: string;
  let largePath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pdfve-hash-'));
    smallPath = join(dir, 'small.pdf');
    largePath = join(dir, 'large.pdf');
    await writeFile(smallPath, Buffer.from('%PDF-1.4 hello'));
    // 80 KiB so we cross the 64 KiB head boundary
    const big = Buffer.alloc(80 * 1024, 0x41);
    big.write('%PDF-1.4', 0);
    await writeFile(largePath, big);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('produces a 64-char hex SHA-256', async () => {
    const h = await computeFileHash(smallPath);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is stable across calls', async () => {
    const a = await computeFileHash(smallPath);
    const b = await computeFileHash(smallPath);
    expect(a).toBe(b);
  });

  it('changes when content changes', async () => {
    const a = await computeFileHash(smallPath);
    const newPath = join(dir, 'small2.pdf');
    await writeFile(newPath, Buffer.from('%PDF-1.4 different'));
    const b = await computeFileHash(newPath);
    expect(a).not.toBe(b);
  });

  it('handles files larger than the head threshold (64 KiB)', async () => {
    const h = await computeFileHash(largePath);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('computeBufferHash matches computeFileHash for same bytes', async () => {
    const bytes = new Uint8Array(Buffer.from('%PDF-1.4 hello'));
    const fileHash = await computeFileHash(smallPath);
    const bufHash = computeBufferHash(bytes);
    expect(bufHash).toBe(fileHash);
  });
});
