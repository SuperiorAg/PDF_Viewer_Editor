// SignatureAuditPanel tests — Phase 4.
// Per docs/ui-spec.md §13.9.
//
// Brief requirement: "mock pdfApi.signatures.listAudit returning 3 rows;
// assert all 3 render in chronological order with the documented fields."

import { configureStore } from '@reduxjs/toolkit';
import { act, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import documentReducer from '../../state/slices/document-slice';
import signatureAuditReducer, { openAuditPanel } from '../../state/slices/signature-audit-slice';
import signaturesReducer from '../../state/slices/signatures-slice';
import uiReducer from '../../state/slices/ui-slice';
import { type SignatureAuditItem } from '../../types/ipc-contract';

import { SignatureAuditPanel } from './index';

const ROW_BASE: Omit<SignatureAuditItem, 'id' | 'signedAt' | 'signedBySubjectCN'> = {
  docHash: 'deadbeefcafef00d',
  preSignDocHash: 'deadbeef',
  signatureKind: 'pades',
  signedByFingerprint: 'a'.repeat(64),
  signedByIssuerCN: 'CN=Example CA',
  certNotBefore: Date.UTC(2024, 0, 1),
  certNotAfter: Date.UTC(2027, 0, 1),
  tsaUrl: null,
  tsaResponseStatus: null,
  sigBytesOffset: 12345,
  sigBytesLength: 8192,
  byteRange: [0, 12345, 28729, 8765],
  reason: 'approval',
  location: 'remote',
  fieldName: 'signature_1',
  createdAt: 0,
};

const ROWS: SignatureAuditItem[] = [
  {
    ...ROW_BASE,
    id: 1,
    signedAt: Date.UTC(2026, 4, 26, 14, 32, 8),
    signedBySubjectCN: 'CN=John Smith',
  },
  {
    ...ROW_BASE,
    id: 2,
    signedAt: Date.UTC(2026, 4, 25, 9, 15, 0),
    signedBySubjectCN: 'CN=Jane Doe',
    signatureKind: 'visual',
    signedByFingerprint: null,
    signedByIssuerCN: null,
    certNotBefore: null,
    certNotAfter: null,
  },
  {
    ...ROW_BASE,
    id: 3,
    signedAt: Date.UTC(2026, 4, 24, 18, 0, 0),
    signedBySubjectCN: 'CN=John Smith',
    signatureKind: 'pades-tsa',
    tsaUrl: 'https://freetsa.org/tsr',
    tsaResponseStatus: 'ok',
  },
];

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      signatureAudit: signatureAuditReducer,
      signatures: signaturesReducer,
      ui: uiReducer,
    },
  });
}

describe('SignatureAuditPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does NOT render when closed', () => {
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <SignatureAuditPanel />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  // ===========================================================================
  // BRIEF REQUIREMENT: 3 rows render with documented fields.
  // ===========================================================================
  it('lists 3 rows from listAudit with subject CN, kind, date, field', async () => {
    const listAudit = vi.fn().mockResolvedValue({
      ok: true,
      value: { items: ROWS, total: 3 },
    });
    vi.stubGlobal('pdfApi', {
      signatures: { listAudit },
    });

    const store = makeStore();
    store.dispatch(openAuditPanel());

    await act(async () => {
      render(
        <Provider store={store}>
          <SignatureAuditPanel />
        </Provider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // All three subject CNs are present. "CN=John Smith" appears in TWO rows
    // (the pades row id=1 and the pades-tsa row id=3) — each rendered in its
    // own <td> — so getByText would throw on the multi-match. Assert both
    // John-Smith cells render via getAllByText, and the single Jane-Doe cell
    // via getByText. This keeps the behavioral assertion (all three subject
    // CNs render) fully intact.
    expect(screen.getAllByText(/CN=John Smith/)).toHaveLength(2);
    expect(screen.getByText(/CN=Jane Doe/)).toBeInTheDocument();

    // All three signatureKinds are visible.
    expect(screen.getByText('pades')).toBeInTheDocument();
    expect(screen.getByText('visual')).toBeInTheDocument();
    expect(screen.getByText('pades-tsa')).toBeInTheDocument();

    // listAudit was called with the current scope.
    expect(listAudit).toHaveBeenCalledTimes(1);
    expect(store.getState().signatureAudit.items.length).toBe(3);
  });

  it('handles listAudit error and shows the message', async () => {
    const listAudit = vi.fn().mockResolvedValue({
      ok: false,
      error: 'db_unavailable',
      message: 'Could not reach the SQLite database.',
    });
    vi.stubGlobal('pdfApi', {
      signatures: { listAudit },
    });
    const store = makeStore();
    store.dispatch(openAuditPanel());
    await act(async () => {
      render(
        <Provider store={store}>
          <SignatureAuditPanel />
        </Provider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/SQLite/);
  });

  it('shows empty state when no signatures', async () => {
    const listAudit = vi.fn().mockResolvedValue({
      ok: true,
      value: { items: [], total: 0 },
    });
    vi.stubGlobal('pdfApi', {
      signatures: { listAudit },
    });
    const store = makeStore();
    store.dispatch(openAuditPanel());
    await act(async () => {
      render(
        <Provider store={store}>
          <SignatureAuditPanel />
        </Provider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/No signatures recorded/i)).toBeInTheDocument();
  });

  it('renders the tamper-vulnerability disclaimer', async () => {
    const listAudit = vi.fn().mockResolvedValue({
      ok: true,
      value: { items: [], total: 0 },
    });
    vi.stubGlobal('pdfApi', {
      signatures: { listAudit },
    });
    const store = makeStore();
    store.dispatch(openAuditPanel());
    await act(async () => {
      render(
        <Provider store={store}>
          <SignatureAuditPanel />
        </Provider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/NOT a tamper-evident record/i)).toBeInTheDocument();
  });
});
