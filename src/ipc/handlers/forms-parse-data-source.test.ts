// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { handleFormsParseDataSource } from './forms-parse-data-source.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('handleFormsParseDataSource', () => {
  it('returns headers + previewRows + totalRowCount for CSV', async () => {
    const r = await handleFormsParseDataSource(
      {
        dataSource: { kind: 'csv', bytes: enc('a,b\n1,2\n3,4\n5,6\n7,8\n9,10\n11,12\n') },
        previewRowCount: 3,
      },
      {},
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.headers).toEqual(['a', 'b']);
      expect(r.value.previewRows).toHaveLength(3);
      expect(r.value.totalRowCount).toBe(6);
    }
  });

  it('defaults preview to 5 rows', async () => {
    const r = await handleFormsParseDataSource(
      {
        dataSource: {
          kind: 'csv',
          bytes: enc('h\n1\n2\n3\n4\n5\n6\n7\n8\n'),
        },
      },
      {},
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.previewRows).toHaveLength(5);
  });

  it('rejects empty bytes', async () => {
    const r = await handleFormsParseDataSource(
      { dataSource: { kind: 'csv', bytes: new Uint8Array([]) } },
      {},
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_payload');
  });
});
