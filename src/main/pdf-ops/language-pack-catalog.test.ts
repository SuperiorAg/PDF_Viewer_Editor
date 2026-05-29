// @vitest-environment node
//
// B-21.1 regression guard (David, 2026-05-28): the SHIPPED language-pack catalog
// must carry REAL SHA-256 verification hashes for the downloadable packs — NOT
// the `TBD-FILL-AT-RELEASE` sentinel that made every non-English download fail
// `pack_integrity_failed`. This test reads the actual JSON that ships in the
// bundle (the same one ocr-bootstrap.ts loads via require), so a regression to
// sentinel values (or a malformed hash) fails CI without needing network.
//
// Download-path integrity (a matching SHA accepts, a wrong SHA rejects) is
// proven against the manager in language-pack-manager.test.ts; this file proves
// the CATALOG DATA itself is shippable.

import { describe, expect, it } from 'vitest';

import catalog from './language-pack-catalog.json';

const HEX64 = /^[0-9a-f]{64}$/;
const SENTINEL = /TBD|FILL|PLACEHOLDER|REPLACE/i;

describe('language-pack-catalog.json (B-21.1 shippability)', () => {
  it('has a baseUrl pointing at the tessdata_fast mirror the download path uses', () => {
    expect(catalog.baseUrl).toBe('https://tessdata.projectnaptha.com/4.0.0_fast');
  });

  it('ships at least the common downloadable languages', () => {
    const langs = catalog.packs.map((p) => p.lang);
    for (const lang of ['eng', 'spa', 'fra', 'deu']) {
      expect(langs).toContain(lang);
    }
  });

  it('every pack carries a real 64-hex SHA-256 (no TBD sentinels)', () => {
    for (const pack of catalog.packs) {
      expect(pack.sha256, `${pack.lang} sha256`).not.toMatch(SENTINEL);
      expect(pack.sha256, `${pack.lang} sha256 must be 64 lowercase hex`).toMatch(HEX64);
    }
  });

  it('every pack has a positive sizeBytes', () => {
    for (const pack of catalog.packs) {
      expect(pack.sizeBytes, `${pack.lang} sizeBytes`).toBeGreaterThan(0);
    }
  });

  it('pins the bundled eng pack to its known npm-package hash', () => {
    // eng ships bundled from @tesseract.js-data/eng@4.0.0 (NOT the CDN). Pin its
    // hash so an accidental swap to the CDN variant (different bytes) is caught.
    const eng = catalog.packs.find((p) => p.lang === 'eng');
    expect(eng).toBeDefined();
    expect(eng!.bundled).toBe(true);
    expect(eng!.sha256).toBe('ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468');
  });

  it('downloadable packs (non-bundled) all have distinct hashes', () => {
    const downloadable = catalog.packs.filter((p) => !('bundled' in p) || p.bundled !== true);
    const shas = downloadable.map((p) => p.sha256);
    expect(new Set(shas).size).toBe(shas.length);
    // And there must be several downloadable packs (the multi-language story).
    expect(downloadable.length).toBeGreaterThanOrEqual(8);
  });
});
