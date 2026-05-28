import { useEffect } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectToasts } from '../../state/slices/ui-selectors';
import { dismissToast } from '../../state/slices/ui-slice';

import styles from './toast.module.css';

const AUTO_DISMISS_MS = 4500;

export function ToastStack(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const toasts = useAppSelector(selectToasts);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => dispatch(dismissToast(toast.id)), AUTO_DISMISS_MS),
    );
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [toasts, dispatch]);

  if (toasts.length === 0) return <></>;

  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${styles[`toast-${toast.kind}`] ?? ''}`}
          role="alert"
        >
          {/* Toast messages are already-localized strings supplied by callers
              (every dispatch site routes through t()); rendered verbatim. */}
          <span className={styles.message}>{toast.message}</span>
          <button
            type="button"
            className={styles.dismiss}
            aria-label={t('common:dismiss')}
            onClick={() => dispatch(dismissToast(toast.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
