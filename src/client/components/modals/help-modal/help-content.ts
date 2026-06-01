// help-content.ts — structured help content for the in-app Help modal.
//
// SOURCE OF TRUTH: docs/user-guide.md (Nathan). This file ports the same
// content into structured TS data so the in-app modal can present every
// shipped feature without an out-of-process markdown renderer (which would
// force a new bundler-config decision + a sanitizer).
//
// All copy lives in i18n (modals.json `help.*`). This module holds only the
// SECTION STRUCTURE — section ids, paragraph keys, ordered subsections. The
// renderer (help-modal/index.tsx) calls `t('modals:help.<key>')` on each
// translation slot, so es-ES (or any future locale) gets the same structure
// with localized strings.
//
// Why structured TS data, not Markdown-at-runtime:
//   (a) zero new deps (the project ships only permissive OSS — adding a
//       markdown lib means evaluating its license + sanitizer story);
//   (b) i18n-native (every string is a t-key with fallback to en-US);
//   (c) typed (TypeScript catches a missing field at build time, not at
//       render).

import type { Namespace } from '../../../i18n/locales-meta';

/** A help-section tab id. Drives the tablist + render switch. */
export type HelpTabId =
  | 'gettingStarted'
  | 'editing'
  | 'annotations'
  | 'forms'
  | 'mailMerge'
  | 'signing'
  | 'ocr'
  | 'scan'
  | 'export'
  | 'shortcuts'
  | 'trustFloor'
  | 'troubleshooting'
  | 'about';

/** Stable ordered list — the tablist renders in this order. */
export const HELP_TABS: readonly HelpTabId[] = [
  'gettingStarted',
  'editing',
  'annotations',
  'forms',
  'mailMerge',
  'signing',
  'ocr',
  'scan',
  'export',
  'shortcuts',
  'trustFloor',
  'troubleshooting',
  'about',
];

/**
 * A SubSection is a small unit of structured content rendered inside one tab.
 * Three shapes:
 *  - `prose`     — a heading + a single paragraph (body).
 *  - `bullets`   — a heading + an intro paragraph + a bulleted list. Bullets
 *                  may carry an inline `strong` lead (for "Name: body"-style
 *                  presentation) — the convention in user-guide.md.
 *  - `steps`     — a numbered list (mail-merge, signing flow).
 */
export type SubSection =
  | { kind: 'prose'; headingKey: string; bodyKey: string }
  | {
      kind: 'bullets';
      headingKey: string;
      introKey?: string;
      /** Bullet key list; each resolves to a single paragraph. */
      bulletKeys: readonly string[];
    }
  | { kind: 'steps'; headingKey: string; stepKeys: readonly string[]; footnoteKey?: string };

/** A help tab — heading + ordered subsections. */
export interface HelpSection {
  id: HelpTabId;
  /** Tab label and section heading both resolve from i18n. */
  titleKey: string;
  /** Optional one-line intro under the heading. */
  introKey?: string;
  /** Ordered list of subsections. */
  subsections: readonly SubSection[];
}

/** The single t-namespace every key in this module resolves under. */
export const HELP_NS: Namespace = 'modals';
/**
 * Full i18n key prefix — every help key resolves under the `modals` namespace
 * with the top-level path `help.<section>.<field>`. We bake the namespace into
 * the prefix so the renderer can pass keys straight to `t(...)` without
 * decoration. (Resolving `t('help.x')` without the `modals:` prefix falls back
 * to the `common` namespace and returns the bare path — the bug Wave 30 RC
 * surfaced.)
 */
const P = 'modals:help';

/**
 * The full section list. KEEP THE ORDER STABLE — it drives the tablist; a
 * re-order changes the WAI-ARIA roving-tabindex sequence.
 */
export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: 'gettingStarted',
    titleKey: `${P}.tabs.gettingStarted`,
    introKey: `${P}.gettingStarted.heading`,
    subsections: [
      {
        kind: 'bullets',
        headingKey: `${P}.gettingStarted.openHeading`,
        introKey: `${P}.gettingStarted.openIntro`,
        bulletKeys: [
          `${P}.gettingStarted.openBullet1`,
          `${P}.gettingStarted.openBullet2`,
          `${P}.gettingStarted.openBullet3`,
        ],
      },
      {
        kind: 'prose',
        headingKey: `${P}.gettingStarted.openHeading`,
        bodyKey: `${P}.gettingStarted.openLimits`,
      },
      {
        kind: 'bullets',
        headingKey: `${P}.gettingStarted.navHeading`,
        introKey: `${P}.gettingStarted.navIntro`,
        bulletKeys: [
          `${P}.gettingStarted.navBullet1`,
          `${P}.gettingStarted.navBullet2`,
          `${P}.gettingStarted.navBullet3`,
          `${P}.gettingStarted.navBullet4`,
        ],
      },
      {
        kind: 'bullets',
        headingKey: `${P}.gettingStarted.zoomHeading`,
        introKey: `${P}.gettingStarted.zoomIntro`,
        bulletKeys: [
          `${P}.gettingStarted.zoomBullet1`,
          `${P}.gettingStarted.zoomBullet2`,
          `${P}.gettingStarted.zoomBullet3`,
          `${P}.gettingStarted.zoomBullet4`,
        ],
      },
      {
        kind: 'prose',
        headingKey: `${P}.gettingStarted.zoomHeading`,
        bodyKey: `${P}.gettingStarted.zoomFootnote`,
      },
    ],
  },
  {
    id: 'editing',
    titleKey: `${P}.tabs.editing`,
    introKey: `${P}.editing.intro`,
    subsections: [
      {
        kind: 'prose',
        headingKey: `${P}.editing.reorderHeading`,
        bodyKey: `${P}.editing.reorderBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.editing.insertHeading`,
        bodyKey: `${P}.editing.insertBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.editing.rotateHeading`,
        bodyKey: `${P}.editing.rotateBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.editing.combineHeading`,
        bodyKey: `${P}.editing.combineBody`,
      },
      { kind: 'prose', headingKey: `${P}.editing.imageHeading`, bodyKey: `${P}.editing.imageBody` },
      { kind: 'prose', headingKey: `${P}.editing.textHeading`, bodyKey: `${P}.editing.textBody` },
      { kind: 'prose', headingKey: `${P}.editing.undoHeading`, bodyKey: `${P}.editing.undoBody` },
    ],
  },
  {
    id: 'annotations',
    titleKey: `${P}.tabs.annotations`,
    introKey: `${P}.annotations.intro`,
    subsections: [
      {
        kind: 'prose',
        headingKey: `${P}.annotations.highlightHeading`,
        bodyKey: `${P}.annotations.highlightBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.annotations.stickyHeading`,
        bodyKey: `${P}.annotations.stickyBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.annotations.textBoxHeading`,
        bodyKey: `${P}.annotations.textBoxBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.annotations.freehandHeading`,
        bodyKey: `${P}.annotations.freehandBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.annotations.shapeHeading`,
        bodyKey: `${P}.annotations.shapeBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.annotations.summaryHeading`,
        bodyKey: `${P}.annotations.summaryBody`,
      },
    ],
  },
  {
    id: 'forms',
    titleKey: `${P}.tabs.forms`,
    introKey: `${P}.forms.intro`,
    subsections: [
      { kind: 'prose', headingKey: `${P}.forms.fillHeading`, bodyKey: `${P}.forms.fillBody` },
      { kind: 'prose', headingKey: `${P}.forms.commitHeading`, bodyKey: `${P}.forms.commitBody` },
      {
        kind: 'prose',
        headingKey: `${P}.forms.designerHeading`,
        bodyKey: `${P}.forms.designerBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.forms.templateHeading`,
        bodyKey: `${P}.forms.templateBody`,
      },
      { kind: 'prose', headingKey: `${P}.forms.honestyHeading`, bodyKey: `${P}.forms.honestyBody` },
    ],
  },
  {
    id: 'mailMerge',
    titleKey: `${P}.tabs.mailMerge`,
    introKey: `${P}.mailMerge.intro`,
    subsections: [
      {
        kind: 'steps',
        headingKey: `${P}.tabs.mailMerge`,
        stepKeys: [
          `${P}.mailMerge.step1`,
          `${P}.mailMerge.step2`,
          `${P}.mailMerge.step3`,
          `${P}.mailMerge.step4`,
          `${P}.mailMerge.step5`,
        ],
        footnoteKey: `${P}.mailMerge.limits`,
      },
    ],
  },
  {
    id: 'signing',
    titleKey: `${P}.tabs.signing`,
    introKey: `${P}.signing.intro`,
    subsections: [
      {
        kind: 'prose',
        headingKey: `${P}.signing.visualHeading`,
        bodyKey: `${P}.signing.visualBody`,
      },
      { kind: 'prose', headingKey: `${P}.signing.padesHeading`, bodyKey: `${P}.signing.padesBody` },
      { kind: 'prose', headingKey: `${P}.signing.auditHeading`, bodyKey: `${P}.signing.auditBody` },
    ],
  },
  {
    id: 'ocr',
    titleKey: `${P}.tabs.ocr`,
    introKey: `${P}.ocr.intro`,
    subsections: [
      { kind: 'prose', headingKey: `${P}.ocr.runHeading`, bodyKey: `${P}.ocr.runBody` },
      { kind: 'prose', headingKey: `${P}.ocr.langHeading`, bodyKey: `${P}.ocr.langBody` },
      {
        kind: 'prose',
        headingKey: `${P}.ocr.confidenceHeading`,
        bodyKey: `${P}.ocr.confidenceBody`,
      },
    ],
  },
  {
    id: 'scan',
    titleKey: `${P}.tabs.scan`,
    introKey: `${P}.scan.intro`,
    subsections: [
      {
        kind: 'prose',
        headingKey: `${P}.scan.discoveryHeading`,
        bodyKey: `${P}.scan.discoveryBody`,
      },
      { kind: 'prose', headingKey: `${P}.scan.captureHeading`, bodyKey: `${P}.scan.captureBody` },
      {
        kind: 'prose',
        headingKey: `${P}.scan.ocrCombineHeading`,
        bodyKey: `${P}.scan.ocrCombineBody`,
      },
    ],
  },
  {
    id: 'export',
    titleKey: `${P}.tabs.export`,
    introKey: `${P}.export.intro`,
    subsections: [
      {
        kind: 'bullets',
        headingKey: `${P}.export.formatsHeading`,
        bulletKeys: [
          `${P}.export.formatsBullet1`,
          `${P}.export.formatsBullet2`,
          `${P}.export.formatsBullet3`,
          `${P}.export.formatsBullet4`,
          `${P}.export.formatsBullet5`,
        ],
      },
      { kind: 'prose', headingKey: `${P}.export.tiersHeading`, bodyKey: `${P}.export.tiersBody` },
      { kind: 'prose', headingKey: `${P}.export.queueHeading`, bodyKey: `${P}.export.queueBody` },
    ],
  },
  // 'shortcuts' is rendered specially (a sortable table, not a SubSection
  // list) — see help-modal/index.tsx. It is included here so it appears in
  // the tablist + tab order.
  {
    id: 'shortcuts',
    titleKey: `${P}.tabs.shortcuts`,
    introKey: `${P}.shortcuts.lead`,
    subsections: [],
  },
  {
    id: 'trustFloor',
    titleKey: `${P}.tabs.trustFloor`,
    introKey: `${P}.trustFloor.intro`,
    subsections: [
      {
        kind: 'prose',
        headingKey: `${P}.trustFloor.telemetryHeading`,
        bodyKey: `${P}.trustFloor.telemetryBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.trustFloor.updatesHeading`,
        bodyKey: `${P}.trustFloor.updatesBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.trustFloor.ocrHeading`,
        bodyKey: `${P}.trustFloor.ocrBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.trustFloor.signHeading`,
        bodyKey: `${P}.trustFloor.signBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.trustFloor.exportHeading`,
        bodyKey: `${P}.trustFloor.exportBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.trustFloor.i18nHeading`,
        bodyKey: `${P}.trustFloor.i18nBody`,
      },
    ],
  },
  {
    id: 'troubleshooting',
    titleKey: `${P}.tabs.troubleshooting`,
    introKey: `${P}.troubleshooting.intro`,
    subsections: [
      {
        kind: 'prose',
        headingKey: `${P}.troubleshooting.openHeading`,
        bodyKey: `${P}.troubleshooting.openBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.troubleshooting.saveHeading`,
        bodyKey: `${P}.troubleshooting.saveBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.troubleshooting.saveGenericHeading`,
        bodyKey: `${P}.troubleshooting.saveGenericBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.troubleshooting.dndHeading`,
        bodyKey: `${P}.troubleshooting.dndBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.troubleshooting.xfaHeading`,
        bodyKey: `${P}.troubleshooting.xfaBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.troubleshooting.jsActionsHeading`,
        bodyKey: `${P}.troubleshooting.jsActionsBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.troubleshooting.ocrFailHeading`,
        bodyKey: `${P}.troubleshooting.ocrFailBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.troubleshooting.signFailHeading`,
        bodyKey: `${P}.troubleshooting.signFailBody`,
      },
      {
        kind: 'prose',
        headingKey: `${P}.troubleshooting.logsHeading`,
        bodyKey: `${P}.troubleshooting.logsBody`,
      },
    ],
  },
  {
    id: 'about',
    titleKey: `${P}.tabs.about`,
    introKey: `${P}.about.intro`,
    subsections: [
      { kind: 'prose', headingKey: `${P}.about.heading`, bodyKey: `${P}.about.versionLine` },
      { kind: 'prose', headingKey: `${P}.about.heading`, bodyKey: `${P}.about.credits` },
    ],
  },
];

/**
 * Find the section descriptor for a tab id (for testing — the runtime renders
 * the full list).
 */
export function findSection(id: HelpTabId): HelpSection | undefined {
  return HELP_SECTIONS.find((s) => s.id === id);
}
