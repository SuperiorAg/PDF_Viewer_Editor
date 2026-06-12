// File-hash strategy per docs/data-models.md §1:
//   SHA-256( first 64 KiB of file bytes || ASCII string of file size ), hex lowercase.
//
// 64 KiB threshold balances fast-on-large-files with differentiating near-identical PDFs.
// Stays in main; Ravi's DB layer just stores the hex string.
//
// NOT THE SAME AS the CI fixture-mutation gate. The hash function here is the
// PRODUCTION docHash used as the join key for db rows (signature_audit_log,
// ocr_jobs, etc.) — partial-content + size, optimized for speed on large PDFs.
// The CI fixture-mutation gate in `tests/fixtures/pdfs/scripts/verify-hashes.mjs`
// computes a RAW SHA-256 of the FULL fixture bytes, recorded in
// `tests/fixtures/pdfs/expected-hashes.json`. The two algorithms are
// intentionally distinct and a fixture's "expected-hashes.json sha256"
// MUST NOT be confused with the docHash the OCR handler / signature-audit
// repos see. Diego lost a Phase 7.2 7.2.4 run conflating the two
// (.learnings/learnings.jsonl 2026-06-10 takeaway L3); the cross-ref here
// (and the reciprocal comment in `verify-hashes.mjs`) exists so future
// readers don't repeat that mistake.

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
