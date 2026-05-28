// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';

import {
  createLanguagePackManager,
  isValidLangCode,
  sha256Hex,
  type Catalog,
  type Filesystem,
  type HttpStreamer,
  type LanguagePackManager,
  type PathResolver,
} from './language-pack-manager.js';

const SHIPPED_ENG_SHA = 'a'.repeat(64);
const SHIPPED_SPA_SHA = 'b'.repeat(64);

function buildCatalog(): Catalog {
  return {
    version: 'test',
    baseUrl: 'https://example.test/tessdata',
    packs: [
      {
        lang: 'eng',
        displayName: 'English',
        sizeBytes: 100,
        sha256: SHIPPED_ENG_SHA,
        bundled: true,
      },
      {
        lang: 'spa',
        displayName: 'Spanish',
        sizeBytes: 200,
        sha256: SHIPPED_SPA_SHA,
      },
      {
        lang: 'fra',
        displayName: 'French',
        sizeBytes: 250,
        sha256: 'c'.repeat(64),
      },
    ],
  };
}

interface InMemoryFs extends Filesystem {
  files: Map<string, Uint8Array>;
}

function makeFs(initialFiles: Record<string, Uint8Array> = {}): InMemoryFs {
  const files = new Map(Object.entries(initialFiles));
  return {
    files,
    existsSync(p) {
      return files.has(p);
    },
    async mkdir(_p, _r) {
      // no-op
    },
    async readFileBytes(p) {
      const b = files.get(p);
      if (!b) throw new Error(`ENOENT ${p}`);
      return b;
    },
    async unlink(p) {
      files.delete(p);
    },
    async stat(p) {
      const b = files.get(p);
      if (!b) throw new Error(`ENOENT ${p}`);
      return { size: b.byteLength };
    },
  };
}

function makePaths(): PathResolver {
  return {
    bundledTessdataDir: () => '/bundled/tessdata',
    userTessdataDir: () => '/user/tessdata',
  };
}

function makeHttp(bytes: Uint8Array): HttpStreamer {
  return {
    async download(_url, destPath, onProgress, signal) {
      if (signal.aborted) {
        const err = new Error('AbortError');
        err.name = 'AbortError';
        throw err;
      }
      // Capture-via-side-effect into the shared fs: tests pass a closure
      // that writes the bytes into the in-memory fs file map.
      onProgress(bytes.byteLength / 2, bytes.byteLength);
      onProgress(bytes.byteLength, bytes.byteLength);
      _writeBytesIntoLastFs?.(destPath, bytes);
      return bytes.byteLength;
    },
  };
}

let _writeBytesIntoLastFs: ((p: string, b: Uint8Array) => void) | null = null;

function bindFsCapture(fs: InMemoryFs): void {
  _writeBytesIntoLastFs = (p, b) => fs.files.set(p, b);
}

describe('language-pack-manager', () => {
  let fs: InMemoryFs;
  let mgr: LanguagePackManager;

  beforeEach(() => {
    fs = makeFs();
    bindFsCapture(fs);
  });

  describe('isValidLangCode', () => {
    it('accepts valid Tesseract lang codes', () => {
      expect(isValidLangCode('eng')).toBe(true);
      expect(isValidLangCode('spa')).toBe(true);
      expect(isValidLangCode('chi_sim')).toBe(true);
      expect(isValidLangCode('chi_tra')).toBe(true);
    });
    it('rejects invalid codes', () => {
      expect(isValidLangCode('EN')).toBe(false); // 2 chars
      expect(isValidLangCode('toolong')).toBe(false);
      // Two underscores not allowed (regex: ^[a-z]{3}(_[a-z]+)?$ — one optional variant).
      expect(isValidLangCode('eng_TOO_MANY')).toBe(false);
      // Single variant IS allowed.
      expect(isValidLangCode('chi_sim')).toBe(true);
      expect(isValidLangCode('')).toBe(false);
      expect(isValidLangCode(null)).toBe(false);
      expect(isValidLangCode(123)).toBe(false);
    });
  });

  describe('sha256Hex', () => {
    it('computes a stable 64-char hex hash', () => {
      const h = sha256Hex(new Uint8Array([1, 2, 3, 4]));
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      // Stable across calls.
      const h2 = sha256Hex(new Uint8Array([1, 2, 3, 4]));
      expect(h).toBe(h2);
    });
  });

  describe('resolve / list', () => {
    it('list returns empty installed + all downloadable when no packs present', async () => {
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(new Uint8Array()),
        fs,
        catalog: buildCatalog(),
      });
      const r = await mgr.list();
      expect(r.installed).toHaveLength(0);
      expect(r.downloadable).toHaveLength(3);
    });

    it('list detects bundled `eng` when present at bundled path', async () => {
      fs.files.set('/bundled/tessdata/eng.traineddata.gz', new Uint8Array([1, 2]));
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(new Uint8Array()),
        fs,
        catalog: buildCatalog(),
      });
      const r = await mgr.list();
      expect(r.installed).toHaveLength(1);
      const eng = r.installed[0]!;
      expect(eng.lang).toBe('eng');
      expect(eng.source).toBe('bundled');
      expect(r.downloadable).toHaveLength(2);
    });

    it('resolve returns the DIRECTORY containing the pack', async () => {
      fs.files.set('/bundled/tessdata/eng.traineddata.gz', new Uint8Array([1, 2]));
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(new Uint8Array()),
        fs,
        catalog: buildCatalog(),
      });
      const dir = mgr.resolve('eng');
      expect(dir).toBe('/bundled/tessdata');
    });

    it('resolve returns null for missing pack', async () => {
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(new Uint8Array()),
        fs,
        catalog: buildCatalog(),
      });
      // refresh internal state by calling list
      await mgr.list();
      expect(mgr.resolve('eng')).toBe(null);
      expect(mgr.resolve('zzz')).toBe(null);
    });
  });

  describe('download', () => {
    it('rejects unknown lang with lang_not_in_catalog', async () => {
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(new Uint8Array()),
        fs,
        catalog: buildCatalog(),
      });
      const ctl = new AbortController();
      const r = await mgr.download('zzz', () => {}, ctl.signal);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('lang_not_in_catalog');
    });

    it('rejects invalid lang code shape with lang_not_in_catalog', async () => {
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(new Uint8Array()),
        fs,
        catalog: buildCatalog(),
      });
      const ctl = new AbortController();
      const r = await mgr.download('EN!', () => {}, ctl.signal);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('lang_not_in_catalog');
    });

    it('rejects already-installed pack', async () => {
      fs.files.set('/bundled/tessdata/eng.traineddata.gz', new Uint8Array([1]));
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(new Uint8Array()),
        fs,
        catalog: buildCatalog(),
      });
      const r = await mgr.download('eng', () => {}, new AbortController().signal);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('pack_already_installed');
    });

    it('rejects on SHA-256 mismatch (R-W19-B mitigation)', async () => {
      // Catalog says SHIPPED_SPA_SHA but the bytes we stream produce a
      // different hash → engine MUST reject + clean up the partial file.
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(bytes),
        fs,
        catalog: buildCatalog(),
      });
      const r = await mgr.download('spa', () => {}, new AbortController().signal);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('pack_integrity_failed');
      // Partial file is cleaned up.
      expect(fs.existsSync('/user/tessdata/spa.traineddata.gz')).toBe(false);
    });

    it('accepts on SHA-256 match and inserts the pack into resolve()', async () => {
      const bytes = new Uint8Array([0x80, 0x81, 0x82]);
      const realHash = sha256Hex(bytes);
      // Update catalog to use the real hash for `fra`.
      const catalog = buildCatalog();
      const fraIdx = catalog.packs.findIndex((p) => p.lang === 'fra');
      catalog.packs[fraIdx]!.sha256 = realHash;
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(bytes),
        fs,
        catalog,
      });
      const ctl = new AbortController();
      const progresses: Array<{ b: number; t: number }> = [];
      const r = await mgr.download('fra', (b, t) => progresses.push({ b, t }), ctl.signal);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.lang).toBe('fra');
        expect(r.value.source).toBe('downloaded');
        expect(r.value.sha256).toBe(realHash);
      }
      // Pack is now resolvable.
      expect(mgr.resolve('fra')).toBe('/user/tessdata');
      // Progress events fired.
      expect(progresses.length).toBeGreaterThan(0);
    });

    it('cancellation propagates as cancelled error', async () => {
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(new Uint8Array([1, 2])),
        fs,
        catalog: buildCatalog(),
      });
      const ctl = new AbortController();
      ctl.abort();
      const r = await mgr.download('fra', () => {}, ctl.signal);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('cancelled');
    });
  });

  describe('remove', () => {
    it('refuses to remove bundled `eng`', async () => {
      fs.files.set('/bundled/tessdata/eng.traineddata.gz', new Uint8Array([1]));
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(new Uint8Array()),
        fs,
        catalog: buildCatalog(),
      });
      const r = await mgr.remove('eng');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('cannot_remove_bundled');
    });

    it('removes downloaded packs and unlinks the file', async () => {
      const bytes = new Uint8Array([0x10, 0x20]);
      const realHash = sha256Hex(bytes);
      const catalog = buildCatalog();
      catalog.packs[1]!.sha256 = realHash;
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(bytes),
        fs,
        catalog,
      });
      await mgr.download('spa', () => {}, new AbortController().signal);
      expect(mgr.resolve('spa')).toBe('/user/tessdata');
      const r = await mgr.remove('spa');
      expect(r.ok).toBe(true);
      expect(fs.existsSync('/user/tessdata/spa.traineddata.gz')).toBe(false);
      expect(mgr.resolve('spa')).toBe(null);
    });

    it('returns pack_not_installed for unknown lang', async () => {
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(new Uint8Array()),
        fs,
        catalog: buildCatalog(),
      });
      const r = await mgr.remove('zzz');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('pack_not_installed');
    });
  });

  describe('catalogEntry', () => {
    it('returns the catalog entry for known langs', () => {
      mgr = createLanguagePackManager({
        paths: makePaths(),
        httpStreamer: makeHttp(new Uint8Array()),
        fs,
        catalog: buildCatalog(),
      });
      const e = mgr.catalogEntry('eng');
      expect(e?.displayName).toBe('English');
      expect(mgr.catalogEntry('zzz')).toBe(null);
    });
  });
});
