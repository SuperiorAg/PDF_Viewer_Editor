// File-hash strategy per docs/data-models.md §1:
//   SHA-256( first 64 KiB of file bytes || ASCII string of file size ), hex lowercase.
//
// 64 KiB threshold balances fast-on-large-files with differentiating near-identical PDFs.
// Stays in main; Ravi's DB layer just stores the hex string.

import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';

const HEAD_BYTES = 64 * 1024;

export async function computeFileHash(absPath: string): Promise<string> {
  const st = await stat(absPath);
  const sizeStr = String(st.size);
  const head = Buffer.alloc(Math.min(HEAD_BYTES, st.size));
  if (head.length > 0) {
    const fh = await open(absPath, 'r');
    try {
      await fh.read(head, 0, head.length, 0);
    } finally {
      await fh.close();
    }
  }
  const hash = createHash('sha256');
  hash.update(head);
  hash.update(sizeStr, 'ascii');
  return hash.digest('hex');
}

/** Convenience: hash a Buffer/Uint8Array using the same algorithm as on-disk files. */
export function computeBufferHash(bytes: Uint8Array): string {
  const head = bytes.subarray(0, HEAD_BYTES);
  const hash = createHash('sha256');
  hash.update(head);
  hash.update(String(bytes.length), 'ascii');
  return hash.digest('hex');
}
