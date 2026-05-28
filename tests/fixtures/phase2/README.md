# Phase 2 fixtures

This directory exists for future Wave-7.5 on-disk fixture PDFs (per
`docs/edit-replay-engine.md` §14.1 — `empty.pdf`, `simple-text.pdf`,
`with-annotations.pdf`, `with-form.pdf`, `encrypted.pdf`, `large.pdf`,
`multi-content-stream.pdf`, `cmyk-icc.pdf`, multi-page TIFF, etc.).

**Wave 7 (David) intentionally synthesises fixtures in-test** via
`PDFDocument.create()` + a tiny custom PNG encoder
(`src/main/pdf-ops/tiff-decoder.ts → encodePngRgbaForTest`). This keeps
the build-report status row hermetic — no binary blobs committed in
Wave 7 — and the golden-bytes determinism assertion runs against
pdf-lib's own re-emit (two `replay()` invocations produce byte-stable
output, captured in `replay-engine.test.ts`).

Wave 7.5 / Phase 2.5 may curate real-world fixtures here (per the
edit-replay-engine.md §14.1 corpus) for the fidelity-matrix tests on
encrypted / form / CMYK / multi-page-TIFF files.
