// Handler tests for pdf:closeCompareSession (Phase 7.5 Wave 7).

import { describe, expect, it } from 'vitest';

import { CompareSessionStore } from '../../main/compare/compare-session-store.js';

import { handlePdfCloseCompareSession } from './pdf-compare-close.js';

describe('handlePdfCloseCompareSession', () => {
  it('rejects invalid payloads', async () => {
    const res = await handlePdfCloseCompareSession({}, { store: new CompareSessionStore() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('rejects empty session id', async () => {
    const res = await handlePdfCloseCompareSession(
      { compareSessionId: '' },
      { store: new CompareSessionStore() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('invalid_payload');
  });

  it('returns session_not_found for unknown session', async () => {
    const res = await handlePdfCloseCompareSession(
      { compareSessionId: 'never-existed' },
      { store: new CompareSessionStore() },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('session_not_found');
  });

  it('closes a registered session successfully', async () => {
    const store = new CompareSessionStore();
    const session = store.open({
      leftHandle: 1,
      rightHandle: 2,
      pageCountLeft: 1,
      pageCountRight: 1,
      pagePairs: [{ leftPageIndex: 0, rightPageIndex: 0 }],
    });
    const res = await handlePdfCloseCompareSession({ compareSessionId: session.id }, { store });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.closed).toBe(true);
    expect(store.get(session.id)).toBeNull();
  });

  it('returns session_not_found on double close (idempotent)', async () => {
    const store = new CompareSessionStore();
    const session = store.open({
      leftHandle: 1,
      rightHandle: 2,
      pageCountLeft: 1,
      pageCountRight: 1,
      pagePairs: [{ leftPageIndex: 0, rightPageIndex: 0 }],
    });
    await handlePdfCloseCompareSession({ compareSessionId: session.id }, { store });
    const res = await handlePdfCloseCompareSession({ compareSessionId: session.id }, { store });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('session_not_found');
  });
});
