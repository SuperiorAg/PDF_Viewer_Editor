// Accessibility Checker — verbatim subsetDisclosure banner.
// Phase 7.5 C6 (Riley Wave 5d).
//
// HONESTY: this component MUST render `disclosure` exactly as David's
// engine emitted it. Per P7.5-L-10 obligation #2: the contract carries
// the words, not a flag. The test
// `accessibility-check-panel.test.tsx` asserts the rendered DOM contains
// the fixture string. If we ever paraphrase, the test catches it.

import styles from './accessibility-check-panel.module.css';

interface Props {
  /** The verbatim string from `PdfRunAccessibilityCheckValue.subsetDisclosure`. */
  disclosure: string;
}

export function DisclosureBanner({ disclosure }: Props): JSX.Element {
  return (
    <p className={styles.subsetDisclosure} data-testid="a11y-subset-disclosure">
      {disclosure}
    </p>
  );
}
