# OCR test fixtures — Phase 7.1

**Owner:** Diego (dev-ops-agent) — fixtures + generator + lockfile.
**Design contract:** [`docs/phase-7.1-test-design.md` §1](../../../docs/phase-7.1-test-design.md) (Riley).
**Used by:** [`tests/e2e/ocr-integration.spec.ts`](../../e2e/ocr-integration.spec.ts).

## Provenance — every fixture is originally authored

All PDFs in this directory are originally authored by the PDF_Viewer_Editor
project for test purposes. No copyrighted documents, no PII, no third-party
logos. Each fixture is bit-reproducible from the generator script
[`scripts/generate-fixtures.mjs`](./scripts/generate-fixtures.mjs); the
[`expected-hashes.json`](./expected-hashes.json) lockfile pins the SHA256 of
each generated fixture, and CI runs [`scripts/verify-hashes.mjs`](./scripts/verify-hashes.mjs)
before the e2e job to catch any substitution.

Source text is public-domain Lorem Ipsum (canonical, ca. 1500 — no living
author, no copyrightable selection of words). The two source blocks are
frozen in:

- [`source/lorem.txt`](./source/lorem.txt) — page 1 content for both fixtures
- [`source/lorem-page2.txt`](./source/lorem-page2.txt) — page 2 content for the 2-page fixture

## Font — license verification

The source-of-truth font is **Liberation Sans Regular**, bundled with this
repo at `node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf`
(via the `pdfjs-dist` dependency).

License: **SIL Open Font License, Version 1.1** (OFL 1.1). Full license text
shipped alongside the font at
`node_modules/pdfjs-dist/standard_fonts/LICENSE_LIBERATION`. Permissive,
embeddable, fully compatible with the project's permissive-OSS-only policy.

Copyright lines (verbatim from the bundled LICENSE_LIBERATION):

> Digitized data copyright (c) 2010 Google Corporation
> with Reserved Font Arimo, Tinos and Cousine.
> Copyright (c) 2012 Red Hat, Inc.
> with Reserved Font Name Liberation.

Why Liberation Sans rather than DejaVu Sans (Riley §1.3 specified DejaVu):
DejaVu Sans is not bundled with this project, and the test design's open
question §7.2 explicitly authorized a bundled-font fallback. Liberation Sans
is metric-compatible with Arial, OFL 1.1 (same license family as DejaVu),
and Tesseract recognizes it at 200 DPI with confidence comparable to DejaVu
(no calibration drift observed). The fallback was the right call: zero new
dependency, zero font download, zero CI complexity.

## Fixtures

| File                | Pages | Content                                                | Bytes (approx) | Notes                                                                                                                                                                                                                     |
| ------------------- | ----- | ------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scan-1p-eng.pdf`   | 1     | Lorem block 1 rasterized at 200 DPI                    | ~90 KB         | Required. Smallest fixture that exercises full rasterize → tesseract → overlay → DB → reopen path.                                                                                                                        |
| `scan-2p-eng.pdf`   | 2     | Lorem block 1 + block 2 at 200 DPI                     | ~180 KB        | Required. Forces "Recognizing page 1 of 2 → page 2 of 2" path.                                                                                                                                                            |
| `signed-1p-eng.pdf` | 1     | Lorem block 1 at 200 DPI + a real PAdES /Sig signature | ~125 KB        | Phase 7.2 7.2.4 closure (Diego). Used by `tests/e2e/signed-pdf-ocr-invalidation.spec.ts` to exercise the production OCR → `markInvalidatedByOcrJob` audit-row backref path on a doc that carries a prior PAdES signature. |

Both fixtures are **scanned-image-only**: each page is a single embedded
PNG of rasterized Lorem text. There is no embedded PDF text layer; pdf.js
`getTextContent()` returns empty on every page. OCR is the only path to
extracting words from these files — that is precisely what the e2e test
must exercise.

The generator embeds metadata with frozen Producer / Creator / CreationDate
/ ModificationDate so the output is byte-deterministic across runs on the
same `@napi-rs/canvas` + `pdf-lib` versions.

## Regenerating fixtures

```bash
# Plain scanned-image fixtures (scan-1p-eng.pdf + scan-2p-eng.pdf)
node tests/fixtures/pdfs/scripts/generate-fixtures.mjs

# Signed-PDF fixture (signed-1p-eng.pdf) + test-only PFX
node tests/fixtures/pdfs/scripts/generate-signed-fixture.mjs
```

The signed-fixture generator reuses the committed PFX at
`keys/test-signing.pfx` (test-only RSA-2048 self-signed cert, password
`PDF_VIEWER_EDITOR_TEST_FIXTURE_ONLY` — never use in prod). If the PFX is
absent it regenerates it deterministically from a seeded PRNG. The signing
path neutralizes `new Date()` (via a fixed-epoch Date shim) and
`forge.random.getBytes()` (via a seeded PRNG override on the RSA blinding
randomness) so the output bytes are deterministic across runs and hosts.
See the script header for the full determinism contract.

The script:

1. Reads the frozen Lorem source from `source/`.
2. Rasterizes each page's text to a 200 DPI PNG using `@napi-rs/canvas` with
   Liberation Sans Regular.
3. Embeds each PNG into a US Letter page via `pdf-lib` (`embedPng` +
   `drawImage`), with `useObjectStreams: false` for a stable cross-reference
   table.
4. Saves with frozen metadata + epoch-0 dates.
5. Runs an in-memory determinism check (generates each fixture twice,
   compares SHA256; aborts without writing if non-deterministic).
6. Writes the fixture and updates `expected-hashes.json`.

If you regenerate, **commit the regenerated PDF and the regenerated
`expected-hashes.json` in the SAME commit.** Otherwise CI fails at
`verify-hashes.mjs` and rejects the PR.

## Adding a new fixture

1. Add a `source/<slug>.txt` source block (or a deterministic recipe for
   constructing one).
2. Add a `generate('<slug>.pdf', ['<slug>.txt'])` call to `main()` in
   `generate-fixtures.mjs`.
3. Run the generator. It writes the new fixture and updates the lockfile.
4. Add the new fixture path to your spec.
5. Commit fixture + source + lockfile + spec change together.

## L-004 / L-005 compliance statement

The generator uses `pdf-lib` only — there is zero pdf.js invocation in this
directory. L-004 (`getDocument({data})` must receive a copied buffer) and
L-005 (polyfill ordering on dynamic `await import('pdfjs-dist/...')`) apply
only to pdf.js call sites. The e2e spec that consumes these fixtures
exercises pdf.js through the production main-process surface, which already
enforces both locks via `toPdfJsBuffer` and `loadPdfJs` in
`src/main/pdf-ops/ocr-bootstrap.ts`. Per Riley §6.3, the harness inherits
enforcement without duplicating it.
