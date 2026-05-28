import { describe, expect, it, vi } from 'vitest';

import { handleFsClosePdf } from './fs-close-pdf.js';
import { expectErr, expectOk } from './test-support.js';

describe('handleFsClosePdf', () => {
  it('rejects non-integer handles', () => {
    const res = handleFsClosePdf({ handle: 1.5 }, { releaseHandle: vi.fn() });
    expectErr(res, 'handle_not_found');
  });

  it('returns ok when release succeeds', () => {
    const releaseHandle = vi.fn().mockReturnValue(true);
    const res = handleFsClosePdf({ handle: 4 }, { releaseHandle });
    expectOk(res);
    expect(releaseHandle).toHaveBeenCalledWith(4);
  });

  it('returns handle_not_found when no record removed', () => {
    const res = handleFsClosePdf({ handle: 4 }, { releaseHandle: () => false });
    expectErr(res, 'handle_not_found');
  });
});
