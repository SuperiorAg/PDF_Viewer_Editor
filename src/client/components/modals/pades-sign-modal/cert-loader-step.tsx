// Cert-loader step — Phase 4 PAdES sign step 1.
// Per docs/ui-spec.md §13.5 (Step 1) + docs/conventions.md §15 (cert+password discipline).
//
// ============================================================================
// CRITICAL — Password discipline (conventions §15.1 rules 2, 3):
// ----------------------------------------------------------------------------
//   - The password is held in COMPONENT-LOCAL React state. It is NEVER
//     pushed into the Redux store (conventions §15.1 rule 2).
//   - On dispatch: the React state is set to '' BEFORE awaiting the IPC
//     promise (the inverted order discipline — see §15.1 rule 2 + the
//     anti-pattern at §15.3 "Awaiting before clear").
//   - On modal close (Esc / X / route change): the cleanup effect ensures
//     the password state is reset to '' even if no IPC was attempted.
//   - The cert PFX bytes are read via <input type="file"> and shipped via
//     IPC; the local File reference is nulled after dispatch (best-effort;
//     main-process zero-on-finally is the real guarantee — David Wave 16).
//   - NO console.log of password OR pfxBytes values, ever.
// ----------------------------------------------------------------------------
// Wave 17 Julian audit:
//   - Search this file for "password" and verify EVERY mention is either:
//     (a) the React state holder (this file's setPassword), OR
//     (b) the dispatch site where it's CLEARED before await.
//   - Search for `console.log` / `console.debug`: NONE may reference password
//     or pfxBytes.
//   - The IPC dispatch lives ~5 lines from the clear-then-await pattern; the
//     clear MUST precede the await in source order.
// ============================================================================

import { useEffect, useRef, useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { apiSignatures } from '../../../services/api';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { setCert, setSignatureError } from '../../../state/slices/signatures-slice';

import styles from './pades-sign-modal.module.css';

export function CertLoaderStep(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const cert = useAppSelector((s) => s.signatures.cert);
  const lastError = useAppSelector((s) => s.signatures.lastError);

  const [pfxFile, setPfxFile] = useState<File | null>(null);
  // Password lives ONLY in component-local state. See discipline header.
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // Refs: when we dispatch, we want to drop the local file ref too.
  const pfxFileRef = useRef<File | null>(null);

  // Cleanup effect — fires on UNMOUNT (modal close: X, Esc, route change).
  // Clears the password so any subsequent re-mount starts from a blank
  // state. This is the renderer half of the "modal cleanup" rule
  // (conventions §15.1 rule 5).
  useEffect(() => {
    return () => {
      setPassword('');
      pfxFileRef.current = null;
    };
  }, []);

  // Mirror file selection to the ref so we can null both at dispatch time.
  useEffect(() => {
    pfxFileRef.current = pfxFile;
  }, [pfxFile]);

  const onLoadCert = async (): Promise<void> => {
    if (!pfxFile || password.length === 0) return;

    // ---- DISCIPLINE: Clear password BEFORE awaiting the IPC promise. ----
    // This is the inverted ordering from the natural React pattern
    // (`await dispatch; setPassword('')`). See conventions §15.1 rule 2 +
    // the §15.3 anti-pattern "Awaiting before clear".
    // Snapshot the password value, then immediately clear the React state.
    const passwordSnapshot = password;
    setPassword('');

    // Read PFX bytes synchronously into a Uint8Array. The File reference is
    // dropped after the IPC dispatch (the ArrayBuffer becomes garbage when
    // no one holds it).
    setLoading(true);
    dispatch(setSignatureError(null));
    try {
      const buf = await pfxFile.arrayBuffer();
      const pfxBytes = new Uint8Array(buf);
      // Drop local references to the file (best-effort renderer hygiene).
      setPfxFile(null);
      pfxFileRef.current = null;

      const res = await apiSignatures.certLoad({
        pfxBytes,
        password: passwordSnapshot,
      });

      if (!res.ok) {
        const msg =
          res.error === 'wrong_password'
            ? t('modals:padesSign.errWrongPassword')
            : res.error === 'pfx_decode_failed'
              ? t('modals:padesSign.errPfxDecode')
              : res.error === 'pfx_no_private_key'
                ? t('modals:padesSign.errPfxNoKey')
                : res.error === 'pfx_no_cert'
                  ? t('modals:padesSign.errPfxNoCert')
                  : res.message;
        dispatch(setSignatureError(msg));
        return;
      }
      dispatch(
        setCert({
          handle: res.value.handle,
          subjectCN: res.value.subjectCN,
          issuerCN: res.value.issuerCN,
          notBefore: res.value.notBefore,
          notAfter: res.value.notAfter,
          fingerprint: res.value.fingerprint,
          isExpired: res.value.isExpired,
        }),
      );
    } catch (e) {
      dispatch(
        setSignatureError(e instanceof Error ? e.message : t('modals:padesSign.errCertLoadFailed')),
      );
    } finally {
      setLoading(false);
    }
  };

  if (cert) {
    return (
      <div className={styles.body}>
        <dl className={styles.certInfo}>
          <dt>{t('modals:padesSign.certSubject')}</dt>
          <dd>{cert.subjectCN}</dd>
          <dt>{t('modals:padesSign.certIssuer')}</dt>
          <dd>{cert.issuerCN}</dd>
          <dt>{t('modals:padesSign.certValid')}</dt>
          <dd>
            {new Date(cert.notBefore).toISOString().slice(0, 10)} →{' '}
            {new Date(cert.notAfter).toISOString().slice(0, 10)}
            {cert.isExpired && (
              <span className={styles.errorText}>{t('modals:padesSign.certExpired')}</span>
            )}
          </dd>
          <dt>{t('modals:padesSign.certFingerprint')}</dt>
          <dd>{cert.fingerprint.slice(0, 16)}…</dd>
        </dl>
        <div className={styles.warningBlock}>{t('modals:padesSign.passwordDiscarded')}</div>
      </div>
    );
  }

  return (
    <div className={styles.body}>
      <label className={styles.field}>
        <span className={styles.label}>{t('modals:padesSign.pfxFile')}</span>
        <input
          type="file"
          accept=".pfx,.p12,application/x-pkcs12"
          onChange={(e) => setPfxFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t('modals:padesSign.password')}</span>
        <input
          aria-label={t('modals:padesSign.password')}
          className={styles.input}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className={styles.warningBlock}>{t('modals:padesSign.passwordNeverSaved')}</div>
      {lastError && <div className={styles.errorText}>{lastError}</div>}
      <div className={styles.footer}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary} ${
            !pfxFile || password.length === 0 || loading ? styles.buttonDisabled : ''
          }`}
          onClick={() => void onLoadCert()}
          disabled={!pfxFile || password.length === 0 || loading}
        >
          {loading ? t('modals:padesSign.loading') : t('modals:padesSign.loadCertButton')}
        </button>
      </div>
    </div>
  );
}
