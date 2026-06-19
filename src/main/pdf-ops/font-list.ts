// Phase 7.5 Wave 6 (David, 2026-06-18) — B18 font listing helper.
//
// Pure pdf-lib walk of each page's /Resources/Font dict + /FontDescriptor
// inspection for embedded font detection. Wave 5 shipped the font-SWAP engine
// (font-swap-engine.ts); this helper exposes a thin LIST used by Riley's font
// picker UI.
//
// What we extract per font reference (deduped by PostScript name):
//   - `name`        => /BaseFont (preferred) or /Name (fallback)
//   - `isEmbedded`  => /FontDescriptor has /FontFile or /FontFile2 or /FontFile3
//   - `isSubset`    => name starts with /^[A-Z]{6}\+/ (standard subset prefix)
//   - `pageRefs`    => sorted unique 0-based page indices that reference it
//
// Honest deferral: this walker ONLY inspects /Resources/Font on each page; it
// does NOT recurse into Form XObjects' own Resources. Form XObjects can carry
// their own font references; v0.8.0 catches the common case (>95%). Same
// rationale as the page-image-xobject-scan helper (Wave 5d follow-up).

import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';

import type { EmbeddedFontInfo } from '../../ipc/contracts.js';
import { fail, ok, type Result } from '../../shared/result.js';

export type FontListError = 'invalid_payload' | 'pdf_load_failed' | 'engine_failed';

const SUBSET_PREFIX_REGEX = /^[A-Z]{6}\+/;

interface PerFontAccumulator {
  name: string;
  isEmbedded: boolean;
  isSubset: boolean;
  pageRefs: Set<number>;
}

export async function listEmbeddedFonts(
  bytes: Uint8Array,
): Promise<Result<EmbeddedFontInfo[], FontListError>> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return fail<FontListError>('invalid_payload', 'bytes must be a non-empty Uint8Array');
  }
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (e) {
    return fail<FontListError>(
      'pdf_load_failed',
      `pdf-lib load threw: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    const accum = new Map<string, PerFontAccumulator>();
    const pages = doc.getPages();
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = pages[pageIndex]!;
      const resources = page.node.Resources();
      if (!(resources instanceof PDFDict)) continue;
      const fontDictRaw = resources.get(PDFName.of('Font'));
      const fontDict = resolveDict(doc, fontDictRaw);
      if (fontDict === null) continue;
      for (const [, fontEntry] of fontDict.entries()) {
        const fontDef = resolveDict(doc, fontEntry);
        if (fontDef === null) continue;
        const info = extractFontInfo(doc, fontDef);
        if (info === null) continue;
        const cur = accum.get(info.name);
        if (cur) {
          cur.pageRefs.add(pageIndex);
          // OR the embedded flag across all references — if any reference
          // carries a FontFile, the font is embedded somewhere in the doc.
          cur.isEmbedded = cur.isEmbedded || info.isEmbedded;
        } else {
          accum.set(info.name, {
            name: info.name,
            isEmbedded: info.isEmbedded,
            isSubset: info.isSubset,
            pageRefs: new Set([pageIndex]),
          });
        }
      }
    }
    const fonts: EmbeddedFontInfo[] = Array.from(accum.values())
      .map((a) => ({
        name: a.name,
        isEmbedded: a.isEmbedded,
        isSubset: a.isSubset,
        pageRefs: Array.from(a.pageRefs).sort((x, y) => x - y),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return ok(fonts);
  } catch (e) {
    return fail<FontListError>(
      'engine_failed',
      `font list walk threw: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Look up a possibly-indirect entry. Returns the PDFDict if the entry is a
 * dict or a ref-to-dict; null otherwise (e.g. PDFStream references aren't
 * dicts — though `entries()` of /Resources/Font could yield such cases on
 * malformed PDFs).
 */
function resolveDict(doc: PDFDocument, raw: unknown): PDFDict | null {
  if (raw instanceof PDFDict) return raw;
  if (raw instanceof PDFRef) {
    const resolved = doc.context.lookup(raw);
    if (resolved instanceof PDFDict) return resolved;
    if (resolved instanceof PDFRawStream) {
      // Streams carry a dict; return that so /FontDescriptor reads via dict APIs
      // work. (Rare — but defensive.)
      return resolved.dict;
    }
  }
  return null;
}

/**
 * Extract the (name, embedded, subset) signal from a single font dict.
 * Returns null when the dict is malformed (no /BaseFont and no /Name).
 */
function extractFontInfo(
  doc: PDFDocument,
  fontDef: PDFDict,
): { name: string; isEmbedded: boolean; isSubset: boolean } | null {
  // Prefer /BaseFont (PostScript name) — that's what the font-swap engine
  // matches against. Fall back to /Name (Type1 only) if absent.
  let name = readNameString(fontDef.get(PDFName.of('BaseFont')));
  if (name === null) {
    name = readNameString(fontDef.get(PDFName.of('Name')));
  }
  if (name === null || name.length === 0) return null;
  const isSubset = SUBSET_PREFIX_REGEX.test(name);
  const fdRaw = fontDef.get(PDFName.of('FontDescriptor'));
  const fd = resolveDict(doc, fdRaw);
  let isEmbedded = false;
  if (fd) {
    isEmbedded =
      fd.has(PDFName.of('FontFile')) ||
      fd.has(PDFName.of('FontFile2')) ||
      fd.has(PDFName.of('FontFile3'));
  }
  return { name, isEmbedded, isSubset };
}

/**
 * Read a PDFName / PDFString / PDFHexString into a JS string. Returns null
 * for any other type.
 */
function readNameString(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  // PDFName.toString() yields '/Name' — strip the leading slash.
  if (typeof (raw as { toString?: () => string }).toString === 'function') {
    const s = String((raw as { toString: () => string }).toString());
    if (s.startsWith('/')) return s.slice(1);
    return s;
  }
  return null;
}
