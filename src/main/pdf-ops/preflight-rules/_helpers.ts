// Phase 7.5 Wave 5a — Preflight rule shared helpers.
//
// Per docs/preflight-spec.md §5.2: every rule that walks the same source
// (font table, color spaces, annotations, catalog entries) uses one of the
// helpers below so we don't repeat the dict-walking code. All helpers are
// pure-pdf-lib; per docs/preflight-spec.md §5.4, NO helper calls pdf.js
// directly.
//
// Module size budget: ≤200 lines (architecture-phase-7.5.md modularization).

import { PDFArray, PDFDict, PDFName, PDFRef, PDFStream, PDFString } from 'pdf-lib';
import type { PDFDocument } from 'pdf-lib';

// ============================================================================
// Font table walk
// ============================================================================

export interface FontRecord {
  ref: PDFRef;
  dict: PDFDict;
  baseFont: string;
  isEmbedded: boolean;
}

/** Walk every /Font resource on every page; dedupe by ref. */
export function walkFonts(doc: PDFDocument): FontRecord[] {
  const out: FontRecord[] = [];
  const seen = new Set<PDFRef>();
  for (const page of doc.getPages()) {
    const resources = page.node.lookupMaybe(PDFName.of('Resources'), PDFDict);
    if (!resources) continue;
    const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (!fonts) continue;
    for (const [, fontVal] of fonts.entries()) {
      let dict: PDFDict | undefined;
      let ref: PDFRef | undefined;
      if (fontVal instanceof PDFRef) {
        ref = fontVal;
        const dr = doc.context.lookupMaybe(fontVal, PDFDict);
        if (dr) dict = dr;
      } else if (fontVal instanceof PDFDict) {
        dict = fontVal;
      }
      if (!dict) continue;
      if (ref && seen.has(ref)) continue;
      if (ref) seen.add(ref);
      const baseFontName = dict.lookupMaybe(PDFName.of('BaseFont'), PDFName);
      const baseFont = baseFontName ? baseFontName.asString() : '';
      out.push({
        ref: ref ?? PDFRef.of(0),
        dict,
        baseFont,
        isEmbedded: isFontEmbedded(dict),
      });
    }
  }
  return out;
}

function isFontEmbedded(fontDict: PDFDict): boolean {
  // Type-0 fonts have /DescendantFonts -> [<<CIDFontType2 with /FontDescriptor>>]
  const descendants = fontDict.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
  if (descendants && descendants.size() > 0) {
    const first = descendants.lookupMaybe(0, PDFDict);
    if (first) {
      const descriptor = first.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
      if (descriptor && hasFontFile(descriptor)) return true;
    }
  }
  const descriptor = fontDict.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
  if (descriptor && hasFontFile(descriptor)) return true;
  // Type-1 standard 14 fonts (Helvetica, Times-Roman, etc.) are never
  // embedded — preflight treats them as "not embedded" per ISO 19005-1 7.3.5.
  return false;
}

function hasFontFile(descriptor: PDFDict): boolean {
  for (const name of ['FontFile', 'FontFile2', 'FontFile3']) {
    const ff = descriptor.lookupMaybe(PDFName.of(name), PDFStream);
    if (ff) return true;
  }
  return false;
}

// ============================================================================
// XMP metadata extract (best-effort string parse — no XML lib).
// ============================================================================

export interface XmpFacts {
  raw: string | null;
  pdfaidPart: string | null;
  pdfaidConformance: string | null;
}

export function extractXmpFacts(doc: PDFDocument): XmpFacts {
  const out: XmpFacts = { raw: null, pdfaidPart: null, pdfaidConformance: null };
  const catalog = doc.catalog;
  const metaStream = catalog.lookupMaybe(PDFName.of('Metadata'), PDFStream);
  if (!metaStream) return out;
  let raw: string | null = null;
  try {
    const bytes = metaStream.getContents();
    if (bytes && bytes.length > 0) {
      raw = Buffer.from(bytes).toString('utf8');
    }
  } catch {
    /* defensive */
  }
  if (!raw) return out;
  out.raw = raw;
  out.pdfaidPart =
    matchOne(raw, /pdfaid:part>\s*([\dA-Z]+)\s*</) ?? matchOne(raw, /pdfaid:part="([\dA-Z]+)"/);
  out.pdfaidConformance =
    matchOne(raw, /pdfaid:conformance>\s*([A-Z]+)\s*</) ??
    matchOne(raw, /pdfaid:conformance="([A-Z]+)"/);
  return out;
}

function matchOne(input: string, re: RegExp): string | null {
  const m = re.exec(input);
  return m ? m[1]! : null;
}

// ============================================================================
// Catalog probes
// ============================================================================

export function catalogHasJavaScript(doc: PDFDocument): boolean {
  const catalog = doc.catalog;
  if (catalog.has(PDFName.of('OpenAction'))) {
    const oa = catalog.lookupMaybe(PDFName.of('OpenAction'), PDFDict);
    if (oa && isJsAction(oa)) return true;
  }
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names && names.lookupMaybe(PDFName.of('JavaScript'), PDFDict)) return true;
  const aa = catalog.lookupMaybe(PDFName.of('AA'), PDFDict);
  if (aa) return true; // additional-actions presence is sufficient for fail
  return false;
}

function isJsAction(dict: PDFDict): boolean {
  const s = dict.lookupMaybe(PDFName.of('S'), PDFName);
  if (!s) return false;
  const v = s.asString();
  return v === '/JavaScript' || v === '/JS';
}

export function catalogHasLaunchAction(doc: PDFDocument): boolean {
  const catalog = doc.catalog;
  const oa = catalog.lookupMaybe(PDFName.of('OpenAction'), PDFDict);
  if (oa) {
    const s = oa.lookupMaybe(PDFName.of('S'), PDFName);
    if (s && s.asString() === '/Launch') return true;
  }
  // walk annotations for /Launch actions.
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a) continue;
      const action = a.lookupMaybe(PDFName.of('A'), PDFDict);
      if (action) {
        const s = action.lookupMaybe(PDFName.of('S'), PDFName);
        if (s && s.asString() === '/Launch') return true;
      }
    }
  }
  return false;
}

export function catalogEmbeddedFileCount(doc: PDFDocument): number {
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (!names) return 0;
  const ef = names.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  if (!ef) return 0;
  const arr = ef.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!arr) return 1; // present-but-empty still counts as a violation
  return arr.size() / 2;
}

export function catalogIsEncrypted(doc: PDFDocument): boolean {
  return doc.isEncrypted;
}

export function infoTrappedRaw(doc: PDFDocument): string | null {
  try {
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (!(info instanceof PDFDict)) return null;
    const v = info.lookupMaybe(PDFName.of('Trapped'), PDFName);
    if (v) return v.asString();
    const s = info.lookupMaybe(PDFName.of('Trapped'), PDFString);
    return s ? s.asString() : null;
  } catch {
    return null;
  }
}

export function outputIntentExists(doc: PDFDocument): boolean {
  const oi = doc.catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray);
  return oi !== undefined && oi.size() > 0;
}
