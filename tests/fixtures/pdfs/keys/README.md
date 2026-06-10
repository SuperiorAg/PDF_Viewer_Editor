# Test-only signing keys — DO NOT USE FOR ANYTHING REAL

Everything in this directory exists solely to drive the e2e fixture pipeline
at `tests/fixtures/pdfs/scripts/generate-signed-fixture.mjs`. **None of it
ever ships in the packaged binary** (the entire `tests/` tree is excluded
from `electron-builder` packaging) and **none of it represents production
secrets.**

## `test-signing.pfx`

A 2048-bit RSA self-signed PKCS#12 envelope generated deterministically by
`generate-signed-fixture.mjs` when the file is absent. It signs the
`signed-1p-eng.pdf` fixture so the production PAdES detector
(`src/main/pdf-ops/pades-detect.ts`) recognizes a prior signature and the
OCR run dispatches `signatureAudit.markInvalidatedByOcrJob`.

**Password:** `PDF_VIEWER_EDITOR_TEST_FIXTURE_ONLY`

The password is documented here in plain text **on purpose** — the PFX
itself is committed, and obscuring its password would not change the
threat surface (anyone with repo read access has both). Re-derivation is
fully deterministic from a fixed PRNG seed coded into the generator
script; deleting this file and re-running the generator produces a
byte-identical replacement.

**Cert details (subject == issuer, since it's self-signed):**

- CN: `PDF_Viewer_Editor Test Signer`
- O: `PDF_Viewer_Editor`
- OU: `Test Fixtures`
- C: `US`
- Serial: `01`
- Validity: 2026-01-01 → 2076-01-01 UTC (50-year window)
- Signature algorithm: SHA-256 with RSA (PKCS#1 v1.5 padding — deterministic
  unlike PSS)
- Key usage: digitalSignature, nonRepudiation, keyEncipherment

The cert chain has no production CA in it. Any signature it produces will
fail trust-store validation in Acrobat / system viewers — which is exactly
what we want: the fixture must never be mistaken for a real signed document
if it leaks out of this repo.

## Why commit the PFX instead of generating on every CI run

Two reasons:

1. **node-forge is a heavy dep** — keeping it on the runtime hot path of the
   CI hash-verify step would slow the gate. The committed PFX lets
   `verify-hashes.mjs` stay pure `node:crypto` + `node:fs` (it already does).
2. **Determinism debugging** — if a future node-forge bump changes the PKCS#12
   envelope encoding, the committed PFX surfaces that on the first PR that
   touches the dep (the signed-fixture hash gate fails). Regenerating on
   every run would mask the drift.

If a contributor needs to regenerate (rare — only when node-forge or
node-signpdf change versions), the flow is:

```bash
rm tests/fixtures/pdfs/keys/test-signing.pfx
node tests/fixtures/pdfs/scripts/generate-signed-fixture.mjs
# Commit BOTH the new PFX and the updated expected-hashes.json
git add tests/fixtures/pdfs/keys/test-signing.pfx \
        tests/fixtures/pdfs/signed-1p-eng.pdf \
        tests/fixtures/pdfs/expected-hashes.json
```

## Threat model — committed test PFX in a public repo

This PFX **must not** be:

- Trusted by any system trust store
- Used to sign any document outside `tests/fixtures/pdfs/`
- Imported into a developer's local cert store
- Reused as a template for a "real" cert (rotate the key, change the seed,
  use a real CA)

If you find yourself reaching for it for any of the above, you have a bug
in your design — the production PAdES path always loads a user-supplied
cert through `cert-store.loadCert(...)`. The test PFX is a closed-system
artifact.
