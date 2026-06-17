// Thin typed wrapper over `window.pdfApi` (the preload bridge David exposes).
// The renderer never touches `window.pdfApi` directly — components and thunks
// import `api` from this module. This gives us:
//   - one place to swap for a mock in tests (vi.mock)
//   - a clear failure mode if the preload bridge is missing (e.g. in Vitest)
//   - typed surface that matches docs/api-contracts.md §9 + §12 exactly
//
// Phase 2 (Wave 7): David landed Phase-2 channels into PdfApi. Renderer types
// re-export verbatim from the gatekeeper file (per Wave 2 lesson — no
// hand-mirroring of contract types).

import { fail } from '../../shared/result';
import { type PdfApi, type PdfApiExport, type PdfApiDialogPhase6 } from '../types/ipc-contract';

// Phase 4 namespace types — derived from David's canonical PdfApi shape.
type PdfApiSignatures = PdfApi['signatures'];
type PdfApiAnnotationsPhase4 = PdfApi['annotations'];
// Phase 5 — same shape pattern. Source of truth: contracts.ts §10.9.
type PdfApiOcr = PdfApi['ocr'];
type PdfApiScan = PdfApi['scan'];

/**
 * The fallback API used when `window.pdfApi` is absent (e.g. Vitest, or before
 * David's preload bridge has been wired by Diego in Wave 3). Every call returns
 * an `ok: false` Result with `error: 'bridge_unavailable'` so callers fall into
 * their error-handling path naturally.
 *
 * 'bridge_unavailable' is NOT in any channel's narrow error union — it's the
 * SOLE deliberate exception to the "error variants are named string literals"
 * rule, and only when the bridge itself is missing.
 */
function makeBridgeUnavailableFallback(): PdfApi {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const unavailable = () =>
    Promise.resolve(fail('bridge_unavailable' as any, 'window.pdfApi is not exposed')) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    dialog: {
      openPdf: unavailable,
      saveAs: unavailable,
      // Phase 6 — pickExportOutputPath joins the dialog namespace per
      // api-contracts.md §17.9.
      pickExportOutputPath: unavailable,
      // Wave-30 follow-up (H-30.1): path-only PDF picker for the Combine modal.
      pickPdfFiles: unavailable,
      // Phase 7.5 Wave 3 (David, 2026-06-17): directory picker.
      pickFolder: unavailable,
    },
    fs: {
      readPdf: unavailable,
      writePdf: unavailable,
      closePdf: unavailable,
      // Phase 2
      applyEditOps: unavailable,
      // Phase 4.1 — renderer fetches document bytes for pdf.js render path
      // (api-contracts.md §15). Fallback returns 'bridge_unavailable' so tests
      // that don't stub the preload still get a Result-shaped reject.
      readBytesByHandle: unavailable,
    },
    recents: { list: unavailable, add: unavailable, clear: unavailable },
    settings: { get: unavailable, set: unavailable, getAll: unavailable },
    bookmarks: {
      list: unavailable,
      upsert: unavailable,
      delete: unavailable,
      // Phase 2
      listTree: unavailable,
      move: unavailable,
      rename: unavailable,
    },
    pdf: {
      combine: unavailable,
      export: unavailable,
      getOutline: unavailable,
      // Phase 2
      embedImage: unavailable,
      replaceText: unavailable,
      identifyTextSpan: unavailable,
      print: unavailable,
      // Phase 7.4 B1 — Riley design §3.1.
      applyRedactions: unavailable,
      // Phase 7.5 B5/B10/B11 — David Wave 2 IPC stubs. Riley pre-wires the
      // unavailable fallback so the renderer typechecks before David's preload
      // implementation lands. Real impl is in David's IPC handler + preload
      // expose. See docs/api-contracts.md §19.2.
      cropPages: unavailable,
      extractPages: unavailable,
      splitDocument: unavailable,
      replacePages: unavailable,
      insertPagesFromFile: unavailable,
      // Phase 7.5 Wave 3 (David, 2026-06-17): B4 page-design + B7 stamp apply.
      applyWatermark: unavailable,
      applyHeaderFooter: unavailable,
      applyBackground: unavailable,
      applyStamp: unavailable,
      // Phase 7.5 Wave 4 (David, 2026-06-17): B6 / B13 / B19.
      compressDocument: unavailable,
      autoBookmarkFromHeadings: unavailable,
      editLinks: unavailable,
    },
    // Phase 3 (api-contracts §13)
    forms: {
      detect: unavailable,
      fill: unavailable,
      flatten: unavailable,
      designAdd: unavailable,
      designRemove: unavailable,
      listTemplates: unavailable,
      saveTemplate: unavailable,
      loadTemplate: unavailable,
      runMailMerge: unavailable,
      cancelMailMerge: unavailable,
      parseDataSource: unavailable,
    },
    app: {
      getVersion: unavailable,
      quit: unavailable,
      setDefaultPdfHandler: unavailable,
      getDefaultPdfHandlerStatus: unavailable,
      openExternal: unavailable,
      // David 2026-06-01: OCR runtime introspection (no UI surface yet).
      diagnoseOcr: unavailable,
      // David 2026-06-04: shell-launched PDF event listener. Fallback returns
      // a no-op disposer so renderer cleanup paths don't blow up under Vitest.
      onFileOpenFromShell: () => () => undefined,
    },
    window: {
      minimize: unavailable,
      maximize: unavailable,
      close: unavailable,
      getState: unavailable,
    },
    // Phase 4 (api-contracts §14)
    signatures: {
      certLoad: unavailable,
      certRelease: unavailable,
      applyVisual: unavailable,
      applyPades: unavailable,
      requestTimestamp: unavailable,
      verify: unavailable,
      listAudit: unavailable,
    },
    annotations: {
      addShape: unavailable,
      setMeasureCalibration: unavailable,
      getMeasureCalibration: unavailable,
    },
    // Phase 5 (api-contracts §16)
    ocr: {
      detectLanguages: unavailable,
      runOnPage: unavailable,
      runOnDocument: unavailable,
      cancelJob: unavailable,
      listJobs: unavailable,
      // Phase 5.2 (Marcus, 2026-06-04)
      listResultsByJob: unavailable,
      languagePackDownload: unavailable,
      languagePackRemove: unavailable,
      // Event subscribers — return a no-op unsubscribe so the renderer's
      // cleanup paths don't blow up when the bridge isn't there.
      onProgress: () => () => undefined,
      onLanguagePackDownloadProgress: () => () => undefined,
    },
    scan: {
      listDevices: unavailable,
      acquire: unavailable,
    },
    // Phase 6 (api-contracts.md §17.10)
    export: {
      toDocx: unavailable,
      toXlsx: unavailable,
      toPptx: unavailable,
      toImages: unavailable,
      cancelJob: unavailable,
      listJobs: unavailable,
      listFormats: unavailable,
      onProgress: () => () => undefined,
    },
    events: {
      onExportProgress: () => () => undefined,
      // Phase 3
      onMailMergeProgress: () => () => undefined,
    },
    // Phase 7 (api-contracts.md §18) — David landed the update/telemetry/i18n
    // contract types into the canonical PdfApi shape, so the fallback must
    // implement them to typecheck. Calls return 'bridge_unavailable'; event
    // subscribers return a no-op unsubscribe. The CONTROL wiring (Settings
    // General + About update area) is Wave 28b alongside i18n — this is just
    // the fallback surface so the renderer compiles.
    update: {
      check: unavailable,
      download: unavailable,
      install: unavailable,
      onProgress: () => () => undefined,
    },
    telemetry: {
      recordEvent: unavailable,
      setOptIn: unavailable,
      getStatus: unavailable,
    },
    i18n: {
      setLocale: unavailable,
      getAvailableLocales: unavailable,
    },
    // Phase 7.5 Wave 3 (David, 2026-06-17) — stamps_library CRUD fallback.
    stamps: {
      list: unavailable,
      create: unavailable,
      delete: unavailable,
    },
  };
}

// Phase 4 (Wave 16) — fallback factory for the new namespaces. Lives in a
// separate function (and not as a `PdfApi` field) because David's contract
// hasn't yet added these to the canonical `PdfApi` shape. When David lands
// the contract additions, fold these into `makeBridgeUnavailableFallback`.
function makeSignaturesFallback(): PdfApiSignatures {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const unavailable = () =>
    Promise.resolve(
      fail('bridge_unavailable' as any, 'window.pdfApi.signatures is not exposed'),
    ) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    certLoad: unavailable,
    certRelease: unavailable,
    applyVisual: unavailable,
    applyPades: unavailable,
    requestTimestamp: unavailable,
    verify: unavailable,
    listAudit: unavailable,
  };
}

function makeAnnotationsPhase4Fallback(): PdfApiAnnotationsPhase4 {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const unavailable = () =>
    Promise.resolve(
      fail('bridge_unavailable' as any, 'window.pdfApi.annotations is not exposed'),
    ) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    addShape: unavailable,
    setMeasureCalibration: unavailable,
    getMeasureCalibration: unavailable,
  };
}

function resolveApi(): PdfApi {
  if (typeof window !== 'undefined' && window.pdfApi !== undefined) {
    return window.pdfApi;
  }
  return makeBridgeUnavailableFallback();
}

// Lazy resolution: in tests `vi.stubGlobal('pdfApi', mock)` runs AFTER module
// import, so we resolve on each access via a Proxy. In production the runtime
// cost is one property lookup per call.
export const api: PdfApi = new Proxy({} as PdfApi, {
  get(_target, prop: keyof PdfApi) {
    const live = resolveApi();
    return live[prop];
  },
}) as PdfApi;

// Phase 4 — separate Proxy for the new namespaces. The proxies resolve
// against the live `window.pdfApi` and fall back to a stub when either
// namespace is missing (e.g. in Vitest where the renderer didn't stub it).
function resolveSignatures(): PdfApiSignatures {
  if (typeof window !== 'undefined' && window.pdfApi !== undefined) {
    // Tests may stub only a subset of the namespaces; treat missing as
    // optional and fall back to the unavailable stub for that domain.
    const w = window.pdfApi as PdfApi & { signatures?: PdfApiSignatures };
    if (w.signatures !== undefined) return w.signatures;
  }
  return makeSignaturesFallback();
}

function resolveAnnotationsPhase4(): PdfApiAnnotationsPhase4 {
  if (typeof window !== 'undefined' && window.pdfApi !== undefined) {
    const w = window.pdfApi as PdfApi & {
      annotations?: PdfApiAnnotationsPhase4;
    };
    if (w.annotations !== undefined) return w.annotations;
  }
  return makeAnnotationsPhase4Fallback();
}

export const apiSignatures: PdfApiSignatures = new Proxy({} as PdfApiSignatures, {
  get(_target, prop: keyof PdfApiSignatures) {
    const live = resolveSignatures();
    return live[prop];
  },
}) as PdfApiSignatures;

export const apiAnnotationsP4: PdfApiAnnotationsPhase4 = new Proxy({} as PdfApiAnnotationsPhase4, {
  get(_target, prop: keyof PdfApiAnnotationsPhase4) {
    const live = resolveAnnotationsPhase4();
    return live[prop];
  },
}) as PdfApiAnnotationsPhase4;

// Phase 5 (Wave 20) — separate proxies for the OCR + scan namespaces.
// Same lazy-resolve pattern as Phase 4 so tests can stub a partial
// `window.pdfApi = { ocr: { ... } }` without exercising the bridge fallback.
function makeOcrFallback(): PdfApiOcr {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const unavailable = () =>
    Promise.resolve(fail('bridge_unavailable' as any, 'window.pdfApi.ocr is not exposed')) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    detectLanguages: unavailable,
    runOnPage: unavailable,
    runOnDocument: unavailable,
    cancelJob: unavailable,
    listJobs: unavailable,
    // Phase 5.2 (Marcus, 2026-06-04)
    listResultsByJob: unavailable,
    languagePackDownload: unavailable,
    languagePackRemove: unavailable,
    onProgress: () => () => undefined,
    onLanguagePackDownloadProgress: () => () => undefined,
  };
}

function makeScanFallback(): PdfApiScan {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const unavailable = () =>
    Promise.resolve(fail('bridge_unavailable' as any, 'window.pdfApi.scan is not exposed')) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    listDevices: unavailable,
    acquire: unavailable,
  };
}

function resolveOcr(): PdfApiOcr {
  if (typeof window !== 'undefined' && window.pdfApi !== undefined) {
    const w = window.pdfApi as PdfApi & { ocr?: PdfApiOcr };
    if (w.ocr !== undefined) return w.ocr;
  }
  return makeOcrFallback();
}

function resolveScan(): PdfApiScan {
  if (typeof window !== 'undefined' && window.pdfApi !== undefined) {
    const w = window.pdfApi as PdfApi & { scan?: PdfApiScan };
    if (w.scan !== undefined) return w.scan;
  }
  return makeScanFallback();
}

export const apiOcr: PdfApiOcr = new Proxy({} as PdfApiOcr, {
  get(_target, prop: keyof PdfApiOcr) {
    const live = resolveOcr();
    return live[prop];
  },
}) as PdfApiOcr;

export const apiScan: PdfApiScan = new Proxy({} as PdfApiScan, {
  get(_target, prop: keyof PdfApiScan) {
    const live = resolveScan();
    return live[prop];
  },
}) as PdfApiScan;

// =============================================================================
// Phase 6 (Wave 24) — Export-to-Office namespace.
//
// David's preload bridge exposes `window.pdfApi.export.*` and a Phase-6 dialog
// extension `window.pdfApi.dialog.pickExportOutputPath`. The lazy-resolve +
// bridge-unavailable fallback mirrors the Phase 4 / Phase 5 pattern.
// =============================================================================

function makeExportFallback(): PdfApiExport {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const unavailable = () =>
    Promise.resolve(
      fail('bridge_unavailable' as any, 'window.pdfApi.export is not exposed'),
    ) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    toDocx: unavailable,
    toXlsx: unavailable,
    toPptx: unavailable,
    toImages: unavailable,
    cancelJob: unavailable,
    listJobs: unavailable,
    listFormats: unavailable,
    onProgress: () => () => undefined,
  };
}

function makeDialogPhase6Fallback(): PdfApiDialogPhase6 {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const unavailable = () =>
    Promise.resolve(
      fail('bridge_unavailable' as any, 'window.pdfApi.dialog.pickExportOutputPath is not exposed'),
    ) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    pickExportOutputPath: unavailable,
  };
}

function resolveExport(): PdfApiExport {
  if (typeof window !== 'undefined' && window.pdfApi !== undefined) {
    const w = window.pdfApi as PdfApi & { export?: PdfApiExport };
    if (w.export !== undefined) return w.export;
  }
  return makeExportFallback();
}

function resolveDialogPhase6(): PdfApiDialogPhase6 {
  if (typeof window !== 'undefined' && window.pdfApi !== undefined) {
    const w = window.pdfApi as PdfApi & {
      dialog: PdfApi['dialog'] & Partial<PdfApiDialogPhase6>;
    };
    if (
      w.dialog !== undefined &&
      typeof (w.dialog as Partial<PdfApiDialogPhase6>).pickExportOutputPath === 'function'
    ) {
      // Narrow back to the Phase-6 extension surface.
      return {
        pickExportOutputPath: (w.dialog as PdfApiDialogPhase6).pickExportOutputPath,
      };
    }
  }
  return makeDialogPhase6Fallback();
}

export const apiExport: PdfApiExport = new Proxy({} as PdfApiExport, {
  get(_target, prop: keyof PdfApiExport) {
    const live = resolveExport();
    return live[prop];
  },
}) as PdfApiExport;

export const apiDialogPhase6: PdfApiDialogPhase6 = new Proxy({} as PdfApiDialogPhase6, {
  get(_target, prop: keyof PdfApiDialogPhase6) {
    const live = resolveDialogPhase6();
    return live[prop];
  },
}) as PdfApiDialogPhase6;

// cross-roster: minimal hook so v0.7.13 ships the user-reported double-click fix; Riley owns the proper UX
// David 2026-06-04 — the renderer-side subscriber lives in
// `src/client/state/file-open-from-shell.ts` (wired into app.tsx by a parallel
// agent). This file only needs the no-op `onFileOpenFromShell` in
// `makeBridgeUnavailableFallback` (above) — the live bridge call belongs to
// that hook so there's a single useEffect subscription with a clean unsub
// lifecycle. No module-load side effect here; no double-dispatch on shell open.
