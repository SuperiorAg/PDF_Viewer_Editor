// PerFormatLimitationsPanel — the trust-floor honesty surface IN the modal.
//
// Per docs/conventions.md §17.3, this panel is the FIFTH-instance trust-floor
// surface (after H-3 + Phase 3 forms + Phase 4 PAdES + Phase 5 OCR). Wave 24
// Riley owns this UI surface; Wave 26 Nathan owns the docs equivalents.
//
// The component renders the per-format limitation bullets sourced from
// `per-format-limitations.ts`, plus a header that names the chosen format.
// It MUST be mounted in Step 2 of the Export modal (ui-spec §15.3.1) so the
// user reads the bullets BEFORE clicking START.

import { type ExportFormat } from '../../../types/ipc-contract';

import styles from './export-modal.module.css';
import { formatDisplayName, getLimitationsForFormat } from './per-format-limitations';

interface PerFormatLimitationsPanelProps {
  format: ExportFormat;
}

export function PerFormatLimitationsPanel(props: PerFormatLimitationsPanelProps): JSX.Element {
  const { format } = props;
  const bullets = getLimitationsForFormat(format);
  const displayName = formatDisplayName(format);

  return (
    <section
      className={styles.limitationsPanel}
      aria-label={`About ${displayName} export`}
      data-testid="per-format-limitations-panel"
    >
      <header className={styles.limitationsHeader}>
        <h3 className={styles.limitationsTitle}>About {displayName} export — what to expect</h3>
      </header>
      <ul className={styles.limitationsList}>
        {bullets.map((b, idx) => (
          <li
            key={`${b.obligationId}-${idx}`}
            className={styles.limitationsBullet}
            data-obligation={b.obligationId}
          >
            {b.text}
          </li>
        ))}
      </ul>
      <p className={styles.limitationsFooter}>
        Full details are in the user guide&apos;s &ldquo;Export to Office trust floor&rdquo;
        section.
      </p>
    </section>
  );
}
