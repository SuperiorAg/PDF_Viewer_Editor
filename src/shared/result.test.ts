// Tests for src/shared/result.ts — Result helpers + safeMessage production guard.
// Julian 2026-06-01 audit (B-finding follow-up — Hard-Won Playbook #4).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fail, ok, safeMessage } from './result.js';

describe('ok / fail', () => {
  it('ok carries a value and discriminates as ok:true', () => {
    const r = ok({ count: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ count: 3 });
  });

  it('fail without details omits the details field', () => {
    const r = fail('some_error', 'a message');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('some_error');
      expect(r.message).toBe('a message');
      expect('details' in r).toBe(false);
    }
  });

  it('fail with details includes them', () => {
    const r = fail('some_error', 'a message', { size: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.details).toEqual({ size: 99 });
    }
  });
});

describe('safeMessage', () => {
  const originalEnv = process.env['NODE_ENV'];
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = originalEnv;
    }
  });

  describe('in production', () => {
    beforeEach(() => {
      process.env['NODE_ENV'] = 'production';
    });

    it('returns the fallback for an Error with a real message (no leak)', () => {
      const e = new Error(
        "ENOENT: no such file or directory, open 'C:\\Users\\victim\\secret.pdf'",
      );
      expect(safeMessage(e, 'Failed to read the file')).toBe('Failed to read the file');
    });

    it('returns the fallback for a SqliteError-shaped object', () => {
      const e = new Error('SqliteError: UNIQUE constraint failed: bookmarks.title');
      expect(safeMessage(e, 'Database is unavailable')).toBe('Database is unavailable');
    });

    it('returns the fallback for a non-Error throw', () => {
      expect(safeMessage('a string was thrown', 'fallback')).toBe('fallback');
      expect(safeMessage({ ugly: 'object' }, 'fallback')).toBe('fallback');
      expect(safeMessage(null, 'fallback')).toBe('fallback');
      expect(safeMessage(undefined, 'fallback')).toBe('fallback');
    });
  });

  describe('outside production (dev / test)', () => {
    beforeEach(() => {
      process.env['NODE_ENV'] = 'development';
    });

    it('returns the raw Error.message for an Error', () => {
      const e = new Error('detailed message for dev');
      expect(safeMessage(e, 'fallback')).toBe('detailed message for dev');
    });

    it('returns fallback when the value is not an Error', () => {
      expect(safeMessage('a string', 'fallback')).toBe('fallback');
      expect(safeMessage(42, 'fallback')).toBe('fallback');
    });

    it('returns fallback when Error.message is empty', () => {
      const e = new Error('');
      expect(safeMessage(e, 'fallback')).toBe('fallback');
    });
  });

  describe('with NODE_ENV unset', () => {
    beforeEach(() => {
      delete process.env['NODE_ENV'];
    });

    it('treats unset env as non-production (returns the raw message)', () => {
      const e = new Error('dev message');
      expect(safeMessage(e, 'fallback')).toBe('dev message');
    });
  });
});
