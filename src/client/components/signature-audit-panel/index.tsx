// SignatureAuditPanel — Phase 4 audit log viewer.
// Per docs/ui-spec.md §13.9 + docs/architecture-phase-4.md §2.3.
//
// Renders rows from the `signature_audit_log` table via `pdfApi.signatures.listAudit`.
// Loads on open + on scope change. The verify button calls `signatures:verify`
// for the selected row. Audit data is READ-ONLY through this panel; manual
// delete is a UI override that does NOT touch signed bytes.

import { useEffect } from 'react';

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  closeAuditPanel,
  selectAuditRow,
  setAuditScope,
} from '../../state/slices/signature-audit-slice';
import {
  deleteAuditRowThunk,
  listSignatureAuditThunk,
  verifySignatureThunk,
} from '../../state/thunks-phase4';
import { ModalShell } from '../modals/modal-shell';

import styles from './signature-audit-panel.module.css';

export function SignatureAuditPanel(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const open = useAppSelector((s) => s.signatureAudit.panelOpen);
  const items = useAppSelector((s) => s.signatureAudit.items);
  const loading = useAppSelector((s) => s.signatureAudit.loading);
  const error = useAppSelector((s) => s.signatureAudit.error);
  const scope = useAppSelector((s) => s.signatureAudit.scope);
  const selectedId = useAppSelector((s) => s.signatureAudit.selectedId);
  const verify = useAppSelector((s) => s.signatureAudit.verify);
  const doc = useAppSelector(selectCurrentDocument);

  // Load on open + on scope change.
  useEffect(() => {
    if (!open) return;
    const arg: Parameters<typeof listSignatureAuditThunk>[0] = {};
    if (scope === 'current-document' && doc?.fileHash) {
      arg.fileHash = doc.fileHash;
    }
    void dispatch(listSignatureAuditThunk(arg));
  }, [open, scope, doc, dispatch]);

  if (!open) return null;

  const selected = items.find((it) => it.id === selectedId) ?? null;

  const onClose = (): void => {
    dispatch(closeAuditPanel());
  };

  const onVerify = (): void => {
    if (selected) void dispatch(verifySignatureThunk({ auditLogRowId: selected.id }));
  };

  const onDelete = (): void => {
    if (selected) void dispatch(deleteAuditRowThunk({ id: selected.id }));
  };

  return (
    <ModalShell title="Signatures applied by this app" onClose={onClose} size="lg">
      <div className={styles.panel}>
        <div className={styles.header}>
          <label htmlFor="audit-scope">Scope:</label>
          <select
            id="audit-scope"
            className={styles.select}
            value={scope}
            onChange={(e) => dispatch(setAuditScope(e.target.value as 'all' | 'current-document'))}
          >
            <option value="all">All signatures</option>
            <option value="current-document">This document</option>
          </select>
        </div>
        {loading ? (
          <div className={styles.empty}>Loading…</div>
        ) : error ? (
          <div className={styles.empty} role="alert">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>No signatures recorded.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tableHeader}>
                  <th>Date</th>
                  <th>Kind</th>
                  <th>Subject CN</th>
                  <th>Field</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const v = verify[row.id];
                  let status: string;
                  let statusCls = '';
                  if (!v) {
                    status = '—';
                  } else if (v.valid && !v.tamperedSinceSign) {
                    status = '✓ ok';
                    statusCls = styles.statusOk ?? '';
                  } else if (v.tamperedSinceSign) {
                    status = '⚠ drift';
                    statusCls = styles.statusWarn ?? '';
                  } else {
                    status = '✗ fail';
                    statusCls = styles.statusFail ?? '';
                  }
                  return (
                    <tr
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      className={`${styles.row} ${selectedId === row.id ? styles.selected : ''}`}
                      onClick={() => dispatch(selectAuditRow(row.id))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          dispatch(selectAuditRow(row.id));
                        }
                      }}
                    >
                      <td>{new Date(row.signedAt).toISOString().slice(0, 19).replace('T', ' ')}</td>
                      <td>{row.signatureKind}</td>
                      <td>{row.signedBySubjectCN ?? '—'}</td>
                      <td>{row.fieldName ?? 'freeform'}</td>
                      <td className={statusCls}>{status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {selected && (
          <dl className={styles.details}>
            <dt>Fingerprint</dt>
            <dd>{selected.signedByFingerprint ?? '—'}</dd>
            <dt>Cert valid</dt>
            <dd>
              {selected.certNotBefore !== null && selected.certNotAfter !== null
                ? `${new Date(selected.certNotBefore).toISOString().slice(0, 10)} → ${new Date(
                    selected.certNotAfter,
                  )
                    .toISOString()
                    .slice(0, 10)}`
                : '—'}
            </dd>
            <dt>TSA</dt>
            <dd>
              {selected.tsaUrl
                ? `${selected.tsaUrl} (${selected.tsaResponseStatus ?? 'unknown'})`
                : 'no timestamp'}
            </dd>
            <dt>Byte-range</dt>
            <dd>{selected.byteRange ? JSON.stringify(selected.byteRange) : '—'}</dd>
            <dt>Reason</dt>
            <dd>{selected.reason ?? '—'}</dd>
            <dt>Doc hash</dt>
            <dd>{selected.docHash.slice(0, 16)}…</dd>
          </dl>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={onVerify} disabled={!selected}>
            Verify hash
          </button>
          <button type="button" className={styles.button} onClick={onDelete} disabled={!selected}>
            Delete row (local only)
          </button>
        </div>
        <div className={styles.disclaimer}>
          This is a local log of signatures you&apos;ve applied with this app. It is NOT a
          tamper-evident record. For legal-effect signatures, rely on the PAdES signature inside the
          PDF itself, not on this log.
        </div>
      </div>
    </ModalShell>
  );
}
