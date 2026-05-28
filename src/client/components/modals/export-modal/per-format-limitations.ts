// Per-format limitations catalog — sourced from architecture-phase-6.md §8.1.
//
// THIS IS THE FIFTH-INSTANCE TRUST-FLOOR HONESTY SURFACE. Per conventions
// §17.3 the user MUST see these limitation bullets at point-of-action (inside
// the modal, not buried in docs). The four-location ratchet (preamble +
// dedicated section + inline docs + README + this modal panel = five
// locations) is the canonical pattern for Phase 6.
//
// Each bullet maps to one of the five Phase-6 trust-floor obligations:
//   #1 — Layout-preserving is best-effort
//   #2 — Borderless / merged-cell tables not detected
//   #3 — XFA forms do not export
//   #4 — Signed-PDF source stays valid; exported file has no signature
//   #5 — OCR status determines text fidelity
// + Cross-cutting reminder — duration estimate
//
// The selection per format mirrors ui-spec §15.3.1.

import { type ExportFormat } from '../../../types/ipc-contract';

export interface LimitationBullet {
  /** Which trust-floor obligation this bullet references. The numeric IDs
   *  match the five Phase 6 obligations enumerated in conventions §17.3:
   *  '1' = layout-preserving best-effort
   *  '2' = borderless tables not detected
   *  '3' = XFA forms do not export
   *  '4' = signed-PDF source stays valid (exported file has no signature)
   *  '5' = OCR status determines text fidelity
   *  'duration' = cross-cutting time-estimate reminder
   *  'annotations' / 'bundle' = image-format-specific reminders (NOT one of
   *  the five obligations — labelled distinctly so the audit log can verify
   *  obligation coverage without conflating help text with trust-floor claims). */
  obligationId: '1' | '2' | '3' | '4' | '5' | 'duration' | 'annotations' | 'bundle';
  /** User-facing text. */
  text: string;
}

const OBLIGATION_1 =
  'Layout-preserving conversion is best-effort. Complex multi-column layouts, intricate tables, and decorative typography may not convert faithfully. Review the output before relying on it.';
const OBLIGATION_2_GENERIC =
  'Borderless tables (no visible grid lines) will not be detected — their cells appear as flowing paragraphs instead of structured rows.';
const OBLIGATION_2_EXCEL =
  'Borderless tables will not appear in the workbook. Text-only mode dumps all text to one sheet per page.';
const OBLIGATION_3 =
  'XFA form values do not export. AcroForm values do (flatten via Forms → Flatten on export first if needed).';
const OBLIGATION_4 =
  'Exporting from a signed PDF leaves the source signature intact. The exported file has no signature semantics.';
const OBLIGATION_5 =
  'If the source PDF is image-only and has not been OCR’d, the output will be mostly raster with no selectable text. Run OCR first if needed.';
const DURATION_REMINDER_OFFICE =
  'Time estimate: ~5–30 sec per page for layout-preserving; ~0.5 sec per page for text-only.';
const DURATION_REMINDER_IMAGE =
  'Rasterized at the chosen DPI. Higher DPI produces larger files; 150–300 DPI is typical.';
const IMAGE_NOTE_BUNDLE =
  'Multi-page TIFF bundles every selected page into a single .tiff file. Otherwise one file per page is produced.';
const IMAGE_NOTE_ANNOTATIONS =
  'Annotations are rendered inline into the rasterized page when "Include annotations" is checked.';

const DOCX_BULLETS: LimitationBullet[] = [
  { obligationId: '1', text: OBLIGATION_1 },
  { obligationId: '2', text: OBLIGATION_2_GENERIC },
  { obligationId: '3', text: OBLIGATION_3 },
  { obligationId: '4', text: OBLIGATION_4 },
  { obligationId: '5', text: OBLIGATION_5 },
  { obligationId: 'duration', text: DURATION_REMINDER_OFFICE },
];

const XLSX_BULLETS: LimitationBullet[] = [
  { obligationId: '1', text: OBLIGATION_1 },
  { obligationId: '2', text: OBLIGATION_2_EXCEL },
  { obligationId: '3', text: OBLIGATION_3 },
  { obligationId: '4', text: OBLIGATION_4 },
  { obligationId: 'duration', text: DURATION_REMINDER_OFFICE },
];

const PPTX_BULLETS: LimitationBullet[] = [
  { obligationId: '1', text: OBLIGATION_1 },
  { obligationId: '2', text: OBLIGATION_2_GENERIC },
  { obligationId: '3', text: OBLIGATION_3 },
  { obligationId: '4', text: OBLIGATION_4 },
  { obligationId: '5', text: OBLIGATION_5 },
  { obligationId: 'duration', text: DURATION_REMINDER_OFFICE },
];

// Image-format bullets — focus on what the rasterizer does + does not
// preserve. Trust-floor obligation #4 still applies (source signature stays
// valid). Image-only export does NOT carry obligation #5 because rasterization
// captures every visible pixel regardless of OCR status — the user sees what
// the renderer shows. The annotation + bundle bullets are help-text, NOT
// trust-floor obligations (see obligationId comment above).
const IMAGE_BULLETS: LimitationBullet[] = [
  { obligationId: 'duration', text: DURATION_REMINDER_IMAGE },
  { obligationId: '4', text: OBLIGATION_4 },
  { obligationId: 'annotations', text: IMAGE_NOTE_ANNOTATIONS },
];

const TIFF_BULLETS: LimitationBullet[] = [
  { obligationId: 'duration', text: DURATION_REMINDER_IMAGE },
  { obligationId: '4', text: OBLIGATION_4 },
  { obligationId: 'annotations', text: IMAGE_NOTE_ANNOTATIONS },
  { obligationId: 'bundle', text: IMAGE_NOTE_BUNDLE },
];

export function getLimitationsForFormat(format: ExportFormat): LimitationBullet[] {
  switch (format) {
    case 'docx':
      return DOCX_BULLETS;
    case 'xlsx':
      return XLSX_BULLETS;
    case 'pptx':
      return PPTX_BULLETS;
    case 'png':
    case 'jpeg':
      return IMAGE_BULLETS;
    case 'tiff':
      return TIFF_BULLETS;
  }
}

/** Display-friendly name for a format, used in the panel heading. */
export function formatDisplayName(format: ExportFormat): string {
  switch (format) {
    case 'docx':
      return 'Word document (.docx)';
    case 'xlsx':
      return 'Excel workbook (.xlsx)';
    case 'pptx':
      return 'PowerPoint presentation (.pptx)';
    case 'png':
      return 'PNG image';
    case 'jpeg':
      return 'JPEG image';
    case 'tiff':
      return 'TIFF image';
  }
}
