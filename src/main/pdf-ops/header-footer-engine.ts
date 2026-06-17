// Phase 7.5 Wave 3 — B4 Header & Footer engine.
//
// Canonical spec: docs/architecture-phase-7.5.md §4.3 ("B4 Watermark / H&F /
// Background — shared engine") and docs/api-contracts.md §19.3.2
// (`pdf:applyHeaderFooter`).
//
// What this module does:
//   For each target page, draw a three-column header strip (left / center /
//   right) above marginTop and / or a three-column footer strip below
//   marginBottom. Substitutes `{page}` with the running page number,
//   `{totalPages}` with the source page count (when totalPageCountToken is
//   true), and `{date}` with a caller-supplied dateString.
//
// What this module does NOT do:
//   - Reflow page content. Headers/footers OVERLAY existing content at the
//     specified margins. Acrobat's Header/Footer dialog has the same behavior
//     by default.
//   - Substitute `{filename}` or `{author}`. Those are renderer-resolved.
//
// Performance — page-tree access is lazy (see watermark-engine.ts §0).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

export type HeaderFooterTarget =
  | { kind: 'all' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'list'; indices: ReadonlyArray<number> };

export interface HeaderFooterStrip {
  left: string;
  center: string;
  right: string;
  fontSize: number;
}

export interface ApplyHeaderFooterOptions {
  pdfBytes: Uint8Array;
  target: HeaderFooterTarget;
  header?: HeaderFooterStrip;
  footer?: HeaderFooterStrip;
  marginTop: number;
  marginBottom: number;
  startPageNumber: number;
  totalPageCountToken: boolean;
  /** Pre-formatted (caller / locale owns the format). Substituted verbatim. */
  dateString?: string;
}

export type ApplyHeaderFooterError =
  | 'pdf_load_failed'
  | 'invalid_payload'
  | 'invalid_target'
  | 'page_out_of_range'
  | 'engine_failed';

export interface ApplyHeaderFooterValue {
  bytes: Uint8Array;
  pagesAffected: number;
  warnings: string[];
}

export type ApplyHeaderFooterResult = Result<ApplyHeaderFooterValue, ApplyHeaderFooterError>;

// ============================================================================
// Engine
// ============================================================================

export async function applyHeaderFooter(
  opts: ApplyHeaderFooterOptions,
): Promise<ApplyHeaderFooterResult> {
  const payloadErr = validatePayload(opts);
  if (payloadErr) return fail<ApplyHeaderFooterError>('invalid_payload', payloadErr);

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<ApplyHeaderFooterError>('pdf_load_failed', (e as Error).message ?? 'unknown');
  }

  const totalPages = doc.getPageCount();
  const targetsRes = resolveTarget(opts.target, totalPages);
  if (!targetsRes.ok) return targetsRes;
  const targets = targetsRes.value;

  let font: PDFFont;
  try {
    font = await doc.embedFont(StandardFonts.Helvetica);
  } catch (e) {
    return fail<ApplyHeaderFooterError>(
      'engine_failed',
      `embedFont threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  const warnings: string[] = [];
  let pagesAffected = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const pageIndex = targets[i]!;
    let page: PDFPage;
    try {
      page = doc.getPage(pageIndex);
    } catch (e) {
      warnings.push(
        `page ${pageIndex}: getPage threw (${(e as Error).message ?? 'unknown'}); skipped`,
      );
      continue;
    }
    const pageNumber = opts.startPageNumber + i;
    try {
      if (opts.header) {
        drawStrip(page, font, opts.header, opts.marginTop, 'header', {
          pageNumber,
          totalPages: opts.totalPageCountToken ? totalPages : null,
          dateString: opts.dateString ?? null,
        });
      }
      if (opts.footer) {
        drawStrip(page, font, opts.footer, opts.marginBottom, 'footer', {
          pageNumber,
          totalPages: opts.totalPageCountToken ? totalPages : null,
          dateString: opts.dateString ?? null,
        });
      }
      pagesAffected += 1;
    } catch (e) {
      warnings.push(
        `page ${pageIndex}: draw threw (${(e as Error).message ?? 'unknown'}); skipped`,
      );
    }
  }

  let outBytes: Uint8Array;
  try {
    outBytes = await doc.save({ useObjectStreams: true });
  } catch (e) {
    return fail<ApplyHeaderFooterError>(
      'engine_failed',
      `save threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }
  return ok<ApplyHeaderFooterValue>({ bytes: outBytes, pagesAffected, warnings });
}

// ============================================================================
// Token substitution
// ============================================================================

interface SubstitutionContext {
  pageNumber: number;
  totalPages: number | null;
  dateString: string | null;
}

export function substituteTokens(template: string, ctx: SubstitutionContext): string {
  return template
    .replace(/\{page\}/g, String(ctx.pageNumber))
    .replace(/\{totalPages\}/g, ctx.totalPages !== null ? String(ctx.totalPages) : '{totalPages}')
    .replace(/\{date\}/g, ctx.dateString !== null ? ctx.dateString : '{date}');
}

// ============================================================================
// Validation
// ============================================================================

function validatePayload(opts: ApplyHeaderFooterOptions): string | null {
  if (!opts.header && !opts.footer) {
    return 'at least one of header / footer must be provided';
  }
  for (const [label, strip] of [
    ['header', opts.header],
    ['footer', opts.footer],
  ] as const) {
    if (!strip) continue;
    if (
      typeof strip.left !== 'string' ||
      typeof strip.center !== 'string' ||
      typeof strip.right !== 'string'
    ) {
      return `${label} left/center/right must be strings (may be empty)`;
    }
    if (!Number.isFinite(strip.fontSize) || strip.fontSize <= 0) {
      return `${label}.fontSize must be a positive number`;
    }
  }
  if (!Number.isFinite(opts.marginTop) || opts.marginTop < 0) {
    return 'marginTop must be a non-negative number';
  }
  if (!Number.isFinite(opts.marginBottom) || opts.marginBottom < 0) {
    return 'marginBottom must be a non-negative number';
  }
  if (!Number.isInteger(opts.startPageNumber)) {
    return 'startPageNumber must be an integer';
  }
  if (typeof opts.totalPageCountToken !== 'boolean') {
    return 'totalPageCountToken must be a boolean';
  }
  return null;
}

function resolveTarget(
  target: HeaderFooterTarget,
  pageCount: number,
): Result<number[], ApplyHeaderFooterError> {
  if (target.kind === 'all') {
    const all: number[] = [];
    for (let i = 0; i < pageCount; i += 1) all.push(i);
    return ok(all);
  }
  if (target.kind === 'range') {
    if (!Number.isInteger(target.start) || !Number.isInteger(target.end)) {
      return fail<ApplyHeaderFooterError>('invalid_target', 'range start/end must be integers');
    }
    if (target.start < 0 || target.end < 0 || target.end < target.start) {
      return fail<ApplyHeaderFooterError>(
        'invalid_target',
        'range start/end must be in order >= 0',
      );
    }
    if (target.end >= pageCount) {
      return fail<ApplyHeaderFooterError>(
        'page_out_of_range',
        `range.end ${target.end} >= pageCount ${pageCount}`,
      );
    }
    const list: number[] = [];
    for (let i = target.start; i <= target.end; i += 1) list.push(i);
    return ok(list);
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (const ix of target.indices) {
    if (!Number.isInteger(ix) || ix < 0) {
      return fail<ApplyHeaderFooterError>(
        'invalid_target',
        `index ${ix} is not a non-negative integer`,
      );
    }
    if (ix >= pageCount) {
      return fail<ApplyHeaderFooterError>(
        'page_out_of_range',
        `index ${ix} >= pageCount ${pageCount}`,
      );
    }
    if (!seen.has(ix)) {
      seen.add(ix);
      out.push(ix);
    }
  }
  return ok(out);
}

// ============================================================================
// Drawing
// ============================================================================

function drawStrip(
  page: PDFPage,
  font: PDFFont,
  strip: HeaderFooterStrip,
  margin: number,
  position: 'header' | 'footer',
  ctx: SubstitutionContext,
): void {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const sideMargin = 36; // ~0.5"

  const baselineY =
    position === 'header' ? pageHeight - margin - font.heightAtSize(strip.fontSize) : margin;

  const left = substituteTokens(strip.left, ctx);
  const center = substituteTokens(strip.center, ctx);
  const right = substituteTokens(strip.right, ctx);

  if (left.length > 0) {
    page.drawText(left, {
      x: sideMargin,
      y: baselineY,
      size: strip.fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }
  if (center.length > 0) {
    const w = font.widthOfTextAtSize(center, strip.fontSize);
    page.drawText(center, {
      x: (pageWidth - w) / 2,
      y: baselineY,
      size: strip.fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }
  if (right.length > 0) {
    const w = font.widthOfTextAtSize(right, strip.fontSize);
    page.drawText(right, {
      x: pageWidth - sideMargin - w,
      y: baselineY,
      size: strip.fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }
}
