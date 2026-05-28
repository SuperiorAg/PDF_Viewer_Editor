// Signature audit slice tests — Phase 4.
// Per docs/architecture-phase-4.md §2.3.

import { describe, expect, it } from 'vitest';

import { type SignatureAuditItem } from '../../types/ipc-contract';

import signatureAuditReducer, {
  closeAuditPanel,
  openAuditPanel,
  removeAuditRow,
  selectAuditRow,
  setAuditError,
  setAuditItems,
  setAuditLoading,
  setAuditScope,
  setMeasureCalibration,
  setSummaryFilter,
  setSummarySort,
  setVerifyResult,
} from './signature-audit-slice';

const INITIAL = signatureAuditReducer(undefined, { type: '@@INIT' });

const SAMPLE: SignatureAuditItem[] = [
  {
    id: 1,
    docHash: 'a',
    preSignDocHash: 'aa',
    signedAt: 1000,
    signatureKind: 'pades',
    signedByFingerprint: null,
    signedBySubjectCN: null,
    signedByIssuerCN: null,
    certNotBefore: null,
    certNotAfter: null,
    tsaUrl: null,
    tsaResponseStatus: null,
    sigBytesOffset: null,
    sigBytesLength: null,
    byteRange: null,
    reason: null,
    location: null,
    fieldName: null,
    createdAt: 0,
  },
  {
    id: 2,
    docHash: 'b',
    preSignDocHash: 'bb',
    signedAt: 2000,
    signatureKind: 'visual',
    signedByFingerprint: null,
    signedBySubjectCN: null,
    signedByIssuerCN: null,
    certNotBefore: null,
    certNotAfter: null,
    tsaUrl: null,
    tsaResponseStatus: null,
    sigBytesOffset: null,
    sigBytesLength: null,
    byteRange: null,
    reason: null,
    location: null,
    fieldName: null,
    createdAt: 0,
  },
];

describe('signatureAuditSlice', () => {
  it('openAuditPanel sets panelOpen + clears error', () => {
    const s = signatureAuditReducer({ ...INITIAL, error: 'old' }, openAuditPanel());
    expect(s.panelOpen).toBe(true);
    expect(s.error).toBeNull();
  });

  it('closeAuditPanel sets panelOpen=false', () => {
    let s = signatureAuditReducer(INITIAL, openAuditPanel());
    s = signatureAuditReducer(s, closeAuditPanel());
    expect(s.panelOpen).toBe(false);
  });

  it('setAuditScope changes scope', () => {
    const s = signatureAuditReducer(INITIAL, setAuditScope('current-document'));
    expect(s.scope).toBe('current-document');
  });

  it('setAuditLoading toggles loading and clears error', () => {
    const s = signatureAuditReducer({ ...INITIAL, error: 'old' }, setAuditLoading(true));
    expect(s.loading).toBe(true);
    expect(s.error).toBeNull();
  });

  it('setAuditItems sets items + total + clears loading', () => {
    const s = signatureAuditReducer(
      { ...INITIAL, loading: true },
      setAuditItems({ items: SAMPLE, total: 2 }),
    );
    expect(s.items.length).toBe(2);
    expect(s.total).toBe(2);
    expect(s.loading).toBe(false);
  });

  it('setAuditError sets error + clears loading', () => {
    const s = signatureAuditReducer(
      { ...INITIAL, loading: true },
      setAuditError('Connection failed'),
    );
    expect(s.error).toBe('Connection failed');
    expect(s.loading).toBe(false);
  });

  it('selectAuditRow sets selectedId', () => {
    const s = signatureAuditReducer(INITIAL, selectAuditRow(42));
    expect(s.selectedId).toBe(42);
  });

  it('setVerifyResult stores keyed by id', () => {
    const s = signatureAuditReducer(
      INITIAL,
      setVerifyResult({ id: 1, valid: true, tamperedSinceSign: false }),
    );
    expect(s.verify[1]).toEqual({ valid: true, tamperedSinceSign: false });
  });

  it('removeAuditRow filters items + clears selection', () => {
    let s = signatureAuditReducer(INITIAL, setAuditItems({ items: SAMPLE, total: 2 }));
    s = signatureAuditReducer(s, selectAuditRow(1));
    s = signatureAuditReducer(s, removeAuditRow(1));
    expect(s.items.length).toBe(1);
    expect(s.items[0]?.id).toBe(2);
    expect(s.selectedId).toBeNull();
    expect(s.total).toBe(1);
  });

  it('setSummaryFilter merges partial filter updates', () => {
    const s = signatureAuditReducer(INITIAL, setSummaryFilter({ highlight: false }));
    expect(s.summaryFilter.highlight).toBe(false);
    expect(s.summaryFilter.sticky).toBe(true);
  });

  it('setSummarySort changes sort', () => {
    const s = signatureAuditReducer(INITIAL, setSummarySort('created'));
    expect(s.summarySort).toBe('created');
  });

  it('setMeasureCalibration stores calibration', () => {
    const s = signatureAuditReducer(INITIAL, setMeasureCalibration({ unit: 'inch', scale: 2 }));
    expect(s.calibration?.scale).toBe(2);
  });
});
