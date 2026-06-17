// Document Properties — Security tab (Phase 7.5 B8 + B21, Riley Wave 5).
// Per docs/ui-spec-phase-7.5.md §8.1.
//
// Bundled under Document Properties per architecture §0.3 — no stand-alone
// modal. Drives qpdf via David's `pdf:setPasswordProtection` channel
// (feature-detected through the Wave-5 thunks file).

import { useState } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  updateSecurity,
  updateSecurityPermissions,
} from '../../state/slices/document-properties-slice';
import { applyPasswordProtectionThunk } from '../../state/thunks-phase7-5-wave5';
import type { PdfSecurityPermissions } from '../../types/document-properties-contract-stub';

import styles from './document-properties-modal.module.css';

type PermissionKey = keyof PdfSecurityPermissions;

const PERMISSION_KEYS: readonly PermissionKey[] = [
  'print',
  'modify',
  'copy',
  'annotate',
  'fillForms',
  'extract',
  'assemble',
  'printHighRes',
];

function minPasswordLength(algo: 'aes-128' | 'aes-256'): number {
  return algo === 'aes-128' ? 4 : 6;
}

export function SecurityTab(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.documentProperties);
  const [validationError, setValidationError] = useState<string | null>(null);

  const sec = state.security;
  const loaded = state.loaded;
  const summary = loaded?.securitySummary;
  const minLen = minPasswordLength(sec.encryption);

  const onApply = (): void => {
    setValidationError(null);

    // Match validations.
    if (sec.requireOpenPassword) {
      if (sec.openPassword !== sec.openPasswordConfirm) {
        setValidationError(t('modals:security.passwordMismatch'));
        return;
      }
      if (sec.openPassword.length < minLen) {
        setValidationError(t('modals:security.passwordTooShort'));
        return;
      }
    }
    if (sec.requirePermissionsPassword) {
      if (sec.permissionsPassword !== sec.permissionsPasswordConfirm) {
        setValidationError(t('modals:security.passwordMismatch'));
        return;
      }
      if (sec.permissionsPassword.length < minLen) {
        setValidationError(t('modals:security.passwordTooShort'));
        return;
      }
    }

    void dispatch(
      applyPasswordProtectionThunk({
        openPassword: sec.requireOpenPassword ? sec.openPassword : null,
        permissionsPassword: sec.requirePermissionsPassword ? sec.permissionsPassword : null,
        permissions: sec.permissions,
        encryption: sec.encryption,
      }),
    );
  };

  const currentLine =
    summary === undefined
      ? '—'
      : summary.encrypted
        ? t('modals:security.encryptionAlgorithm', { algo: summary.encryptionAlgorithm })
        : t('modals:security.noSecurity');

  return (
    <div>
      <div className={styles.summary}>
        {t('modals:security.currentSecurity')}: {currentLine}
      </div>

      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={sec.requireOpenPassword}
          onChange={(e) => dispatch(updateSecurity({ requireOpenPassword: e.target.checked }))}
          disabled={state.applyingSecurity || loaded === null}
        />
        {t('modals:security.requireOpenPassword')}
      </label>
      {sec.requireOpenPassword && (
        <div className={styles.fieldGrid}>
          <label className={styles.label} htmlFor="sec-open-pw">
            {t('modals:security.password')}
          </label>
          <input
            id="sec-open-pw"
            className={styles.input}
            type="password"
            value={sec.openPassword}
            onChange={(e) => dispatch(updateSecurity({ openPassword: e.target.value }))}
            disabled={state.applyingSecurity}
            autoComplete="new-password"
          />
          <label className={styles.label} htmlFor="sec-open-pw-confirm">
            {t('modals:security.confirmPassword')}
          </label>
          <input
            id="sec-open-pw-confirm"
            className={styles.input}
            type="password"
            value={sec.openPasswordConfirm}
            onChange={(e) => dispatch(updateSecurity({ openPasswordConfirm: e.target.value }))}
            disabled={state.applyingSecurity}
            autoComplete="new-password"
          />
        </div>
      )}

      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={sec.requirePermissionsPassword}
          onChange={(e) =>
            dispatch(updateSecurity({ requirePermissionsPassword: e.target.checked }))
          }
          disabled={state.applyingSecurity || loaded === null}
        />
        {t('modals:security.requirePermissionsPassword')}
      </label>
      {sec.requirePermissionsPassword && (
        <div className={styles.fieldGrid}>
          <label className={styles.label} htmlFor="sec-perm-pw">
            {t('modals:security.password')}
          </label>
          <input
            id="sec-perm-pw"
            className={styles.input}
            type="password"
            value={sec.permissionsPassword}
            onChange={(e) => dispatch(updateSecurity({ permissionsPassword: e.target.value }))}
            disabled={state.applyingSecurity}
            autoComplete="new-password"
          />
          <label className={styles.label} htmlFor="sec-perm-pw-confirm">
            {t('modals:security.confirmPassword')}
          </label>
          <input
            id="sec-perm-pw-confirm"
            className={styles.input}
            type="password"
            value={sec.permissionsPasswordConfirm}
            onChange={(e) =>
              dispatch(updateSecurity({ permissionsPasswordConfirm: e.target.value }))
            }
            disabled={state.applyingSecurity}
            autoComplete="new-password"
          />
        </div>
      )}

      <div className={`${styles.label} ${styles.mt2}`}>{t('modals:security.permissions')}</div>
      <div className={styles.permissionsGrid}>
        {PERMISSION_KEYS.map((k) => (
          <label key={k} className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={sec.permissions[k]}
              onChange={(e) => dispatch(updateSecurityPermissions({ [k]: e.target.checked }))}
              disabled={!sec.requirePermissionsPassword || state.applyingSecurity}
            />
            {t(`modals:security.permissionLabels.${k}`)}
          </label>
        ))}
      </div>

      <div className={styles.row}>
        <span className={styles.label}>{t('modals:security.encryption')}</span>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name="sec-encryption"
            checked={sec.encryption === 'aes-128'}
            onChange={() => dispatch(updateSecurity({ encryption: 'aes-128' }))}
            disabled={state.applyingSecurity}
          />
          {t('modals:security.encryptionAes128')}
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name="sec-encryption"
            checked={sec.encryption === 'aes-256'}
            onChange={() => dispatch(updateSecurity({ encryption: 'aes-256' }))}
            disabled={state.applyingSecurity}
          />
          {t('modals:security.encryptionAes256')}
        </label>
      </div>

      <div className={`${styles.warning} ${styles.mt2}`}>{t('modals:security.rebuildWarning')}</div>
      <div className={styles.hint}>{t('modals:security.engineUnavailableHint')}</div>
      {validationError !== null && <div className={styles.error}>{validationError}</div>}

      <div className={styles.rowEnd}>
        <button
          type="button"
          className={styles.input}
          onClick={onApply}
          disabled={
            state.applyingSecurity ||
            loaded === null ||
            (!sec.requireOpenPassword && !sec.requirePermissionsPassword)
          }
        >
          {state.applyingSecurity
            ? t('modals:security.applying')
            : t('modals:security.applyButton')}
        </button>
      </div>
    </div>
  );
}
