// Vite client-type ambient declarations. The renderer tsconfig.json already
// includes `"types": ["vite/client"]` so this file is purely additive for
// (a) `tsconfig.test.json` which compiles renderer-side .test files but does
// NOT pull in vite/client, and (b) IDE typecheckers that read the loose
// `tsconfig.json` per-file.
//
// Phase 4.1 (Riley): added the `?url` suffix declaration so
// `pdfjs-dist/build/pdf.worker.min.mjs?url` resolves under all configs.
// Vite's runtime semantics: import a module with `?url` suffix and the
// default export is the asset URL string at build time.

/// <reference types="vite/client" />

declare module '*?url' {
  const src: string;
  export default src;
}

declare module '*?worker' {
  const workerCtor: new () => Worker;
  export default workerCtor;
}
