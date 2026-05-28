// Phase 4 (Wave 16, David) — Signature appearance stream composition.
//
// Contract: docs/signature-engine.md §5.2 + docs/architecture-phase-4.md §4.4.
//
// Builds the /AP /N stream of a signature widget annotation:
//   - top region: the appearance image (typed / drawn / image PNG-or-JPEG)
//   - bottom region: 0-N metadata text rows (subject CN, issuer CN, date,
//     reason, TSA info) — drop policy when rows don't fit (lowest priority
//     first; see §5.2 of the design doc).
//
// Pure function over (doc, spec). pdf-lib creates the appearance XObject via
// `doc.embedPdf` / `page.drawText`. No FS, no DB, no log.

import { StandardFonts, rgb } from 'pdf-lib';
import type { PDFDocument, PDFFont, PDFImage } from 'pdf-lib';

import type { PdfRect, VisualAppearanceSpec } from '../../ipc/contracts.js';
import { fail, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

export interface AppearanceSpec extends VisualAppearanceSpec {
  /** Widget rect in PDF user-space. */
  rect: PdfRect;
  /** Optional metadata shown when the source's own image doesn't carry these. */
  subjectCN?: string;
  issuerCN?: string;
  signedAt?: number;
  tsaUrl?: string;
}

export type AppearanceError = 'embed_image_failed' | 'invalid_source' | 'rect_too_small';

export interface AppearanceOk {
  /** The image XObject embedded into the doc (or null when text-only). */
  image: PDFImage | null;
  /**
   * Pre-computed row strings (top-to-bottom) that fit the widget; useful for
   * test-asserting the drop priority.
   */
  rows: string[];
  warnings: string[];
}

export type AppearanceResult = Result<AppearanceOk, AppearanceError>;

const PRIORITY_HIGH_TO_LOW: Array<
  keyof Pick<
    AppearanceSpec,
    'showSubjectCN' | 'showDate' | 'showIssuerCN' | 'showReason' | 'showTsaInfo'
  >
> = ['showSubjectCN', 'showDate', 'showIssuerCN', 'showReason', 'showTsaInfo'];

/**
 * Compose the appearance for a signature widget. Returns the embedded image
 * (when present) + the metadata rows that fit. Does NOT itself author the
 * /AP /N XObject — that's the caller's job (visual-signature.ts or pades-
 * signature.ts) because they need to wire the XObject into the widget dict
 * via different code paths.
 *
 * Why this lives in a separate module: the rows + drop-priority logic is the
 * same for visual + PAdES. Keeping it here makes the drop policy testable
 * in isolation.
 */
export async function composeAppearance(
  doc: PDFDocument,
  spec: AppearanceSpec,
): Promise<AppearanceResult> {
  const warnings: string[] = [];

  if (spec.rect.width <= 0 || spec.rect.height <= 0) {
    return fail<AppearanceError>('rect_too_small', 'rect width/height must be > 0');
  }

  // 1) Embed the source image (typed → pre-rasterized PNG; drawn → PNG;
  //    image → PNG or JPEG).
  let image: PDFImage | null = null;
  const src = spec.source;
  try {
    if (src.kind === 'typed' || src.kind === 'drawn') {
      if (!src.pngBytes || src.pngBytes.byteLength === 0) {
        return fail<AppearanceError>('invalid_source', `${src.kind} source missing pngBytes`);
      }
      image = await doc.embedPng(src.pngBytes);
    } else if (src.kind === 'image') {
      if (!src.bytes || src.bytes.byteLength === 0) {
        return fail<AppearanceError>('invalid_source', 'image source missing bytes');
      }
      image =
        src.mimeType === 'image/png'
          ? await doc.embedPng(src.bytes)
          : await doc.embedJpg(src.bytes);
    } else {
      // exhaustive
      const exhaustive: never = src;
      void exhaustive;
      return fail<AppearanceError>('invalid_source', 'unknown source kind');
    }
  } catch (e) {
    return fail<AppearanceError>('embed_image_failed', `embed threw: ${(e as Error).message}`);
  }

  // 2) Compute candidate rows (showName + showDate + ... toggled).
  const rows = buildCandidateRows(spec);

  // 3) Drop rows that don't fit, lowest priority first. The estimate uses
  //    a fixed line-height of 10pt; the caller may tune via spec.rect.
  const lineHeight = Math.min(10, Math.max(6, spec.rect.height / 8));
  const reservedForImage = spec.rect.height * 0.6;
  const availableForText = Math.max(0, spec.rect.height - reservedForImage);
  const maxRows = Math.floor(availableForText / lineHeight);
  const fitted = applyDropPolicy(rows, maxRows, spec);
  if (fitted.length < rows.length) {
    warnings.push(
      `Appearance rect too small for ${rows.length} rows; dropped ${rows.length - fitted.length}`,
    );
  }

  return ok({ image, rows: fitted, warnings });
}

interface RowEntry {
  text: string;
  priorityKey:
    | 'image'
    | 'showSubjectCN'
    | 'showDate'
    | 'showIssuerCN'
    | 'showReason'
    | 'showTsaInfo';
}

function buildCandidateRows(spec: AppearanceSpec): string[] {
  const all: RowEntry[] = [];
  if (spec.showSubjectCN && spec.subjectCN) {
    all.push({ text: `Signed by: ${spec.subjectCN}`, priorityKey: 'showSubjectCN' });
  }
  if (spec.showIssuerCN && spec.issuerCN) {
    all.push({ text: `Issuer: ${spec.issuerCN}`, priorityKey: 'showIssuerCN' });
  }
  if (spec.showDate) {
    const ts = spec.signedAt ?? Date.now();
    const iso = new Date(ts).toISOString().replace('T', ' ').replace(/\..+$/, ' UTC');
    all.push({ text: `Date: ${iso}`, priorityKey: 'showDate' });
  }
  if (spec.showReason && spec.reason) {
    all.push({ text: `Reason: ${spec.reason}`, priorityKey: 'showReason' });
  }
  if (spec.showTsaInfo && spec.tsaUrl) {
    all.push({ text: `Timestamped by: ${spec.tsaUrl}`, priorityKey: 'showTsaInfo' });
  }
  return all.map((r) => r.text);
}

function applyDropPolicy(rows: string[], maxRows: number, spec: AppearanceSpec): string[] {
  if (rows.length <= maxRows) return rows;
  // Re-derive priority order: keep highest-priority first.
  const entries: RowEntry[] = rows.map((text) => ({
    text,
    priorityKey: classifyRow(text, spec),
  }));
  const rank = (k: RowEntry['priorityKey']): number =>
    PRIORITY_HIGH_TO_LOW.indexOf(k as Exclude<RowEntry['priorityKey'], 'image'>);
  const sorted = entries.slice().sort((a, b) => rank(a.priorityKey) - rank(b.priorityKey));
  const kept = sorted.slice(0, Math.max(0, maxRows));
  // Restore source order.
  return entries.filter((e) => kept.includes(e)).map((e) => e.text);
}

function classifyRow(text: string, _spec: AppearanceSpec): RowEntry['priorityKey'] {
  if (text.startsWith('Signed by:')) return 'showSubjectCN';
  if (text.startsWith('Issuer:')) return 'showIssuerCN';
  if (text.startsWith('Date:')) return 'showDate';
  if (text.startsWith('Reason:')) return 'showReason';
  if (text.startsWith('Timestamped by:')) return 'showTsaInfo';
  return 'showDate'; // safe default mid-priority
}

/**
 * Draw the composed appearance onto a target page at the given rect. Used by
 * `visual-signature.ts` and (later) `pades-signature.ts` for the visible
 * widget face. Caller is responsible for wiring the result into a widget
 * annotation's /AP /N stream if a separate XObject is desired; for the
 * common case (page-level draw) the result is the visible content directly.
 *
 * Returns a font reference so the caller can reuse it for the widget's
 * default-appearance string.
 */
export async function drawAppearanceOnPage(
  doc: PDFDocument,
  pageIndex: number,
  composed: AppearanceOk,
  rect: PdfRect,
): Promise<Result<{ font: PDFFont }, 'page_out_of_range' | 'draw_failed'>> {
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
    return fail('page_out_of_range', `pageIndex ${pageIndex} out of range`);
  }
  const page = doc.getPage(pageIndex);
  let font: PDFFont;
  try {
    font = await doc.embedFont(StandardFonts.Helvetica);
  } catch (e) {
    return fail('draw_failed', `embedFont threw: ${(e as Error).message}`);
  }

  try {
    if (composed.image) {
      const imgRect = {
        x: rect.x,
        y: rect.y + rect.height * 0.4,
        width: rect.width,
        height: rect.height * 0.6,
      };
      page.drawImage(composed.image, imgRect);
    }
    const fontSize = Math.min(10, Math.max(6, rect.height / 8));
    let yCursor = rect.y + rect.height * 0.4 - fontSize - 2;
    for (const row of composed.rows) {
      if (yCursor < rect.y) break;
      page.drawText(row, {
        x: rect.x + 2,
        y: yCursor,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
      yCursor -= fontSize + 2;
    }
  } catch (e) {
    return fail('draw_failed', `draw threw: ${(e as Error).message}`);
  }
  return ok({ font });
}
