import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useId } from 'react';

import { useFocusTrap } from '../../hooks/use-focus-trap';
import { useT } from '../../i18n/use-t';

import styles from './modal-shell.module.css';

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Use role="alertdialog" instead of "dialog" for destructive confirms
   * (a11y-audit §3 Path 6/8). Default 'dialog'. */
  role?: 'dialog' | 'alertdialog';
}

export function ModalShell(props: ModalShellProps): JSX.Element {
  const { t } = useT();
  // R-8 (a11y-audit.md): focus is trapped within the modal and restored to the
  // triggering control on close. The ref is attached to the dialog panel.
  const dialogRef = useFocusTrap<HTMLDivElement>();
  // labelledby: the visible <h2> title is the accessible name (preferred over
  // aria-label per WAI-ARIA APG — the name is visible on screen).
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  // Click-outside dismiss: only fires when the click landed directly on the
  // overlay backdrop, not on the modal content (or any descendant). Per Phase 1.1
  // acceptance criteria for the Help modal; cross-modal benefit since every
  // existing modal already exposes onClose via the close button + Esc.
  const onOverlayMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  };

  const panelClassName = `${styles.modal} ${
    props.size === 'lg' ? styles.modalLg : props.size === 'sm' ? styles.modalSm : ''
  }`;

  // The panel header/body/footer is identical regardless of role; only the
  // dialog wrapper's `role` differs. jsx-a11y's aria-modal check requires the
  // role to be a STATIC literal (it cannot resolve `props.role ?? 'dialog'`),
  // so the two-branch split below is genuinely required — unlike the dynamic
  // boolean aria-* attrs which lint clean on jsx-a11y 6.10 (Wave 28a finding).
  const panelInner = (
    <>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {props.title}
        </h2>
        <button
          type="button"
          className={styles.closeButton}
          aria-label={t('common:closeDialog')}
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      <div className={styles.body}>{props.children}</div>
      {props.footer && <footer className={styles.footer}>{props.footer}</footer>}
    </>
  );

  return (
    // The overlay is a presentational backdrop (click-to-close affordance);
    // role="dialog"/"alertdialog" + aria-modal live on the inner panel so
    // screen readers attach to actual modal content. `role="presentation"`
    // clears the overlay of any implicit semantic so jsx-a11y/no-noninteractive-
    // element-interactions does not flag the mouse handler.
    <div className={styles.overlay} role="presentation" onMouseDown={onOverlayMouseDown}>
      {props.role === 'alertdialog' ? (
        <div
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={panelClassName}
        >
          {panelInner}
        </div>
      ) : (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={panelClassName}
        >
          {panelInner}
        </div>
      )}
    </div>
  );
}
