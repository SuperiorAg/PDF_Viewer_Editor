import { forwardRef } from 'react';

import { ToolbarIcon, type ToolbarIconName } from './toolbar-icon';
import styles from './toolbar.module.css';

interface ToolbarButtonProps {
  icon: ToolbarIconName;
  label: string;
  tooltip: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  /** Roving-tabindex value supplied by the parent Toolbar (a11y-audit.md R-3).
   * Only the roving-focused button is 0; all others are -1. */
  tabIndex?: 0 | -1;
  /** Arrow-key handler from the parent toolbar's roving-tabindex controller. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

// Wave 28a (a11y-audit.md R-3): the Phase-1 two-branch literal aria-pressed
// workaround is REMOVED. jsx-a11y 6.10 accepts a dynamic boolean
// `aria-pressed={active}` cleanly at `error` (verified — see build-report
// Wave 28a), so the single-branch form below is both correct and lint-clean.
// `aria-pressed` is only emitted for toggle buttons (active prop supplied);
// momentary-action buttons (Open, Save, etc.) must NOT carry aria-pressed.
export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton(props, ref): JSX.Element {
    const active: boolean = props.active === true;
    const disabled: boolean = props.disabled === true;
    const isToggle = props.active !== undefined;
    const className = `${styles.button} ${active ? styles.buttonActive : ''}`;
    return (
      <button
        ref={ref}
        type="button"
        className={className}
        title={props.tooltip}
        aria-label={props.label}
        aria-pressed={isToggle ? active : undefined}
        tabIndex={props.tabIndex}
        disabled={disabled}
        onClick={props.onClick}
        onKeyDown={props.onKeyDown}
      >
        <ToolbarIcon name={props.icon} />
      </button>
    );
  },
);
