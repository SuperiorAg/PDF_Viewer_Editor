// Shared test helpers for the accessibility rule unit tests.
//
// Rules consume `AccessibilityCheckContext` snapshots — no live PDF
// required for the rule layer (the engine test covers the snapshot
// build itself). This module provides minimal fake-context + fake-
// element constructors so each rule test stays focused on its own
// pass/warn/fail/unevaluated logic.

import { PDFDocument, type PDFDict } from 'pdf-lib';

import type { AccessibilityCheckContext, PageTextDiagnostic, StructElementRef } from './index.js';

let docCache: PDFDocument | null = null;

/** Lazily-built throwaway PDFDocument so we have a real Catalog dict to
 *  stuff into the fake context. Rules only read from it via the helpers
 *  in the engine snapshot — they never call back into pdf-lib themselves. */
async function getCachedDoc(): Promise<PDFDocument> {
  if (!docCache) {
    docCache = await PDFDocument.create();
    docCache.addPage([612, 792]);
  }
  return docCache;
}

export interface FakeContextOptions {
  structElements?: StructElementRef[];
  pageDiagnostics?: PageTextDiagnostic[] | null;
  /** Override the cached catalog dict (e.g. to attach a /Lang entry). */
  catalog?: PDFDict;
  pageCount?: number;
}

export async function fakeContext(
  opts: FakeContextOptions = {},
): Promise<AccessibilityCheckContext> {
  const doc = await getCachedDoc();
  return {
    doc,
    structElements: opts.structElements ?? [],
    catalog: opts.catalog ?? doc.catalog,
    pageDiagnostics: opts.pageDiagnostics ?? null,
    pageCount: opts.pageCount ?? doc.getPageCount(),
  };
}

export function elem(partial: Partial<StructElementRef> & { type: string }): StructElementRef {
  return {
    structNodeId: partial.structNodeId ?? `struct:${Math.floor(Math.random() * 1_000_000)}`,
    type: partial.type,
    pageIndex: partial.pageIndex ?? 0,
    childTypes: partial.childTypes ?? [],
    hasNonEmptyAlt: partial.hasNonEmptyAlt ?? false,
    hasAltKey: partial.hasAltKey ?? false,
    altValue: partial.altValue ?? null,
    hasScopeAttribute: partial.hasScopeAttribute ?? false,
  };
}
