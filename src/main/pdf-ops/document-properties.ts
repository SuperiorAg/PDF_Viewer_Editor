// Phase 7.5 Wave 5 — B21 Document Properties engine.
//
// Canonical spec:
//   - docs/api-contracts.md §19.4.4 (`pdf:getDocumentProperties` /
//     `pdf:setDocumentProperties`).
//   - docs/architecture-phase-7.5.md §4.1 row B21.
//
// Read path:
//   pdf-lib surfaces the /Info dict as ergonomic accessors (`getTitle()`,
//   `getAuthor()`, ...). We use them all PLUS surface a securitySummary
//   (encrypted flag + algorithm + permission map) and pageSizes (one entry
//   per page — used by the Document Properties → Description panel).
//
// Write path:
//   pdf-lib mirrors the read accessors with setTitle / setAuthor / etc.
//   The /ModDate is automatically updated when the doc is re-saved.
//   `customMetadata` writes ARE NOT IMPLEMENTED in v0.8.0 — pdf-lib does
//   not expose /Info subkeys outside the canonical eight. We surface a
//   warning when the caller passes a non-empty customMetadata object.
//
// Locked-instruction compliance:
//   - L-001..L-006: pure pdf-lib, no pdf.js, no test channel.

import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types — mirrors contracts.ts DocumentProperties exactly
// ============================================================================

export interface EngineDocumentProperties {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string[];
  creator: string | null;
  producer: string | null;
  creationDate: number | null;
  modificationDate: number | null;
  trapped: 'true' | 'false' | 'unknown' | null;
  customMetadata: Record<string, string>;
}

export interface SecuritySummary {
  encrypted: boolean;
  encryptionAlgorithm: 'aes-128' | 'aes-256' | 'rc4-128' | 'none';
  permissions: Record<string, boolean>;
}

export interface PageSize {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
}

export interface GetDocumentPropertiesResult {
  properties: EngineDocumentProperties;
  securitySummary: SecuritySummary;
  pageSizes: PageSize[];
}

export interface SetDocumentPropertiesOptions {
  pdfBytes: Uint8Array;
  properties: Partial<EngineDocumentProperties>;
}

export interface SetDocumentPropertiesResult {
  bytes: Uint8Array;
  warnings: string[];
}

export type DocumentPropertiesError = 'invalid_payload' | 'pdf_load_failed' | 'engine_failed';

// ============================================================================
// Read
// ============================================================================

export async function getDocumentProperties(
  pdfBytes: Uint8Array,
): Promise<Result<GetDocumentPropertiesResult, DocumentPropertiesError>> {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return fail<DocumentPropertiesError>(
      'invalid_payload',
      'pdfBytes must be a non-empty Uint8Array',
    );
  }
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<DocumentPropertiesError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const properties: EngineDocumentProperties = {
    title: nullable(doc.getTitle()),
    author: nullable(doc.getAuthor()),
    subject: nullable(doc.getSubject()),
    keywords: parseKeywords(doc.getKeywords()),
    creator: nullable(doc.getCreator()),
    producer: nullable(doc.getProducer()),
    creationDate: dateToMs(doc.getCreationDate()),
    modificationDate: dateToMs(doc.getModificationDate()),
    trapped: readTrapped(doc),
    customMetadata: {}, // v0.8.0 does not surface /Info subkeys beyond the canonical eight
  };

  const securitySummary: SecuritySummary = {
    encrypted: doc.isEncrypted,
    encryptionAlgorithm: doc.isEncrypted ? 'aes-256' : 'none',
    permissions: {},
  };

  const pageSizes: PageSize[] = doc.getPages().map((p, ix) => ({
    pageIndex: ix,
    widthPt: p.getWidth(),
    heightPt: p.getHeight(),
  }));

  return ok<GetDocumentPropertiesResult>({ properties, securitySummary, pageSizes });
}

// ============================================================================
// Write
// ============================================================================

export async function setDocumentProperties(
  opts: SetDocumentPropertiesOptions,
): Promise<Result<SetDocumentPropertiesResult, DocumentPropertiesError>> {
  if (!(opts.pdfBytes instanceof Uint8Array) || opts.pdfBytes.byteLength === 0) {
    return fail<DocumentPropertiesError>(
      'invalid_payload',
      'pdfBytes must be a non-empty Uint8Array',
    );
  }
  if (!opts.properties || typeof opts.properties !== 'object') {
    return fail<DocumentPropertiesError>('invalid_payload', 'properties object required');
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<DocumentPropertiesError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const p = opts.properties;
  const warnings: string[] = [];

  try {
    if (p.title !== undefined) doc.setTitle(p.title ?? '');
    if (p.author !== undefined) doc.setAuthor(p.author ?? '');
    if (p.subject !== undefined) doc.setSubject(p.subject ?? '');
    if (p.keywords !== undefined) {
      doc.setKeywords(p.keywords ?? []);
    }
    if (p.creator !== undefined) doc.setCreator(p.creator ?? '');
    if (p.producer !== undefined) doc.setProducer(p.producer ?? '');
    if (p.creationDate !== undefined && p.creationDate !== null) {
      doc.setCreationDate(new Date(p.creationDate));
    }
    if (p.modificationDate !== undefined && p.modificationDate !== null) {
      doc.setModificationDate(new Date(p.modificationDate));
    }
    if (p.trapped !== undefined && p.trapped !== null) {
      writeTrapped(doc, p.trapped);
    }
    if (p.customMetadata !== undefined && Object.keys(p.customMetadata).length > 0) {
      warnings.push(
        'customMetadata writes are not implemented in v0.8.0 (pdf-lib does not expose /Info subkeys beyond the canonical eight); rebuild proceeds without it',
      );
    }
  } catch (e) {
    return fail<DocumentPropertiesError>(
      'engine_failed',
      e instanceof Error && e.message ? `set threw: ${e.message}` : 'set threw',
    );
  }

  let outBytes: Uint8Array;
  try {
    outBytes = await doc.save({ useObjectStreams: false });
  } catch (e) {
    return fail<DocumentPropertiesError>(
      'engine_failed',
      e instanceof Error && e.message ? `save threw: ${e.message}` : 'save threw',
    );
  }

  return ok<SetDocumentPropertiesResult>({ bytes: outBytes, warnings });
}

// ============================================================================
// Helpers
// ============================================================================

function nullable(v: string | undefined): string | null {
  if (v === undefined) return null;
  if (typeof v !== 'string') return null;
  return v;
}

function parseKeywords(raw: string | undefined): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  // PDFs store keywords as a single string; common conventions are
  // comma-separated or semicolon-separated. pdf-lib's setKeywords joins
  // with a single space (see node_modules/pdf-lib/.../PDFDocument.setKeywords),
  // so we must also split on whitespace when no other separator is present
  // to round-trip cleanly.
  const hasStructuredSep = /[,;]/.test(raw);
  const parts = hasStructuredSep ? raw.split(/[,;]/) : raw.split(/\s+/);
  return parts.map((k) => k.trim()).filter((k) => k.length > 0);
}

function dateToMs(d: Date | undefined): number | null {
  if (!d || !(d instanceof Date)) return null;
  const n = d.getTime();
  return Number.isFinite(n) ? n : null;
}

function readTrapped(doc: PDFDocument): 'true' | 'false' | 'unknown' | null {
  try {
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (!(info instanceof PDFDict)) return null;
    const trapped = info.lookupMaybe(PDFName.of('Trapped'), PDFName);
    if (!trapped) return null;
    const s = trapped.asString().toLowerCase().replace(/^\//, '');
    if (s === 'true') return 'true';
    if (s === 'false') return 'false';
    if (s === 'unknown') return 'unknown';
    return null;
  } catch {
    return null;
  }
}

function writeTrapped(doc: PDFDocument, value: 'true' | 'false' | 'unknown'): void {
  try {
    const info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (info instanceof PDFDict) {
      info.set(PDFName.of('Trapped'), PDFName.of(value));
    }
  } catch {
    /* defensive */
  }
}
