// Phase 5 — Language pack manager.
//
// Contract: docs/ocr-engine.md §4 + docs/architecture-phase-5.md §4.3 +
// docs/conventions.md §16.2 (bytes-stay-in-main; filePath never crossing the
// IPC boundary).
//
// THREE STATES per language pack (ocr-engine.md §4.1):
//   - 'bundled'     : ships with the installer at process.resourcesPath
//   - 'downloaded'  : in app.getPath('userData')/tessdata
//   - missing       : neither path exists; UI prompts to download
//
// DISCIPLINE:
//   - SHA-256 verification on every download (R-W19-B mitigation)
//   - Bundled `eng` pack is read-only and cannot be removed
//   - The download streamer is INJECTED (dep-injection per anti-stub-shipped-
//     with-TODO discipline §16.3) — tests stub it with a mock HTTP responder,
//     production wiring uses node:https
//   - Network errors do NOT leak filesystem paths into log messages
//
// LIBRARY INJECTION:
//   - `httpStreamer`  — the bytes-stream + progress callback function
//   - `catalogLoader` — returns the catalog JSON object (default: load shipped JSON)
//   - `filesystem`    — fs operations (read/write/unlink/stat); pluggable for tests
//
// All three are REQUIRED on `createLanguagePackManager` (no optional fallback).

import { createHash } from 'node:crypto';

import type {
  LanguagePackCatalogEntry,
  OcrLanguagePackSource,
} from '../../ipc/contracts.js';
import { fail, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Internal main-only record. Includes `filePath` — NEVER returned over IPC.
 * The renderer-facing `LanguagePack` DTO (api-contracts §16.1) strips it.
 */
export interface LanguagePackRecord {
  lang: string;
  displayName: string;
  source: OcrLanguagePackSource;
  /** Absolute path on disk; main-only. */
  filePath: string;
  sizeBytes: number;
  sha256: string;
  installedAt: number;
  lastUsedAt: number | null;
}

export interface CatalogEntry {
  lang: string;
  displayName: string;
  sizeBytes: number;
  sha256: string;
  /** Set on the catalog row for `eng`; absent on downloadable-only rows. */
  bundled?: boolean;
}

export interface Catalog {
  version: string;
  baseUrl: string;
  packs: CatalogEntry[];
}

export type DownloadProgressFn = (bytesDownloaded: number, totalBytes: number) => void;

export interface HttpStreamer {
  /**
   * Stream `url` to `destPath`. Calls `onProgress` periodically.
   * MUST resolve to the total bytes written when complete. MUST reject on
   * network failure, abort via signal, or write failure.
   */
  download(
    url: string,
    destPath: string,
    onProgress: DownloadProgressFn,
    signal: AbortSignal,
  ): Promise<number>;
}

export interface Filesystem {
  existsSync(path: string): boolean;
  mkdir(path: string, recursive: boolean): Promise<void>;
  readFileBytes(path: string): Promise<Uint8Array>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number }>;
}

export interface PathResolver {
  /** Bundled tessdata dir (process.resourcesPath/tessdata). */
  bundledTessdataDir(): string;
  /** User-writable tessdata dir (app.getPath('userData') + /tessdata). */
  userTessdataDir(): string;
}

export interface LanguagePackManagerOptions {
  paths: PathResolver;
  httpStreamer: HttpStreamer;
  fs: Filesystem;
  catalog: Catalog;
  /** Optional: epoch ms supplier; defaults to Date.now. Tests inject a fixed clock. */
  now?: () => number;
}

export type LanguagePackError =
  | 'catalog_load_failed'
  | 'lang_not_in_catalog'
  | 'pack_already_installed'
  | 'pack_not_installed'
  | 'cannot_remove_bundled'
  | 'network_error'
  | 'pack_integrity_failed'
  | 'disk_write_failed'
  | 'disk_unlink_failed'
  | 'cancelled';

export interface LanguagePackManager {
  /**
   * Return both installed packs (bundled + downloaded) and downloadable
   * catalog entries (not yet installed).
   */
  list(): Promise<{
    installed: LanguagePackRecord[];
    downloadable: LanguagePackCatalogEntry[];
  }>;
  /**
   * Return the directory containing `<lang>.traineddata.gz`, or null if not
   * installed. Tesseract.js's `createWorker` expects a directory.
   */
  resolve(lang: string): string | null;
  /**
   * Download a pack from upstream. Verifies SHA-256 BEFORE inserting any
   * persistent state. Rejects with `pack_integrity_failed` on mismatch.
   */
  download(
    lang: string,
    onProgress: (bytesDownloaded: number, totalBytes: number) => void,
    signal: AbortSignal,
  ): Promise<Result<LanguagePackRecord, LanguagePackError>>;
  /**
   * Remove a downloaded pack. Refuses to remove `source === 'bundled'`.
   */
  remove(lang: string): Promise<Result<{ removed: boolean }, LanguagePackError>>;
  /** Update the `lastUsedAt` timestamp on a pack (called by the worker pool). */
  touchLastUsed(lang: string, when: number): void;
  /** Look up the catalog entry for a lang code. Returns null if unknown. */
  catalogEntry(lang: string): CatalogEntry | null;
  /** Read-only access to the loaded catalog. */
  getCatalog(): Catalog;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Validate a lang code against the documented regex (conventions §16.2).
 * Used at the IPC boundary too (in the OCR handlers).
 */
export function isValidLangCode(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z]{3}(_[a-z]+)?$/i.test(s);
}

/**
 * Compute SHA-256 of an in-memory Uint8Array, hex-encoded lowercase.
 */
export function sha256Hex(bytes: Uint8Array): string {
  const hash = createHash('sha256');
  hash.update(bytes);
  return hash.digest('hex');
}

export function createLanguagePackManager(opts: LanguagePackManagerOptions): LanguagePackManager {
  const { paths, httpStreamer, fs: filesys, catalog } = opts;
  const clock = opts.now ?? Date.now;

  // Track lastUsedAt + sha256 in memory; the persistent record is in Ravi's
  // `language_packs` table, but the manager is the file-system source of
  // truth. The DB row mirrors what the manager already knows.
  //
  // Map<lang, LanguagePackRecord>
  const inMemoryRecords = new Map<string, LanguagePackRecord>();

  function bundledPathFor(lang: string): string {
    return `${paths.bundledTessdataDir()}/${lang}.traineddata.gz`;
  }
  function userPathFor(lang: string): string {
    return `${paths.userTessdataDir()}/${lang}.traineddata.gz`;
  }

  function buildBundledRecord(entry: CatalogEntry): LanguagePackRecord | null {
    const filePath = bundledPathFor(entry.lang);
    if (!filesys.existsSync(filePath)) return null;
    return {
      lang: entry.lang,
      displayName: entry.displayName,
      source: 'bundled',
      filePath,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256,
      installedAt: 0, // bundled at install time; no precise ms epoch
      lastUsedAt: null,
    };
  }

  function buildDownloadedRecord(entry: CatalogEntry): LanguagePackRecord | null {
    const filePath = userPathFor(entry.lang);
    if (!filesys.existsSync(filePath)) return null;
    return {
      lang: entry.lang,
      displayName: entry.displayName,
      source: 'downloaded',
      filePath,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256,
      installedAt: clock(),
      lastUsedAt: null,
    };
  }

  function refreshRecords(): void {
    for (const entry of catalog.packs) {
      // Bundled wins over downloaded — if both exist (developer install with
      // tessdata mirrored to userData), prefer the bundled-resourcesPath copy.
      const bundled = entry.bundled ? buildBundledRecord(entry) : null;
      if (bundled) {
        inMemoryRecords.set(entry.lang, bundled);
        continue;
      }
      const downloaded = buildDownloadedRecord(entry);
      if (downloaded) {
        // Preserve lastUsedAt from prior in-memory record (worker pool may
        // have touched it).
        const existing = inMemoryRecords.get(entry.lang);
        if (existing) {
          downloaded.lastUsedAt = existing.lastUsedAt;
          downloaded.installedAt = existing.installedAt;
        }
        inMemoryRecords.set(entry.lang, downloaded);
      } else {
        inMemoryRecords.delete(entry.lang);
      }
    }
  }

  return {
    async list() {
      refreshRecords();
      const installed = Array.from(inMemoryRecords.values());
      const installedLangs = new Set(installed.map((p) => p.lang));
      const downloadable: LanguagePackCatalogEntry[] = catalog.packs
        .filter((p) => !installedLangs.has(p.lang))
        .map((p) => ({
          lang: p.lang,
          displayName: p.displayName,
          sizeBytes: p.sizeBytes,
          sha256: p.sha256,
        }));
      return { installed, downloadable };
    },

    resolve(lang) {
      refreshRecords();
      const rec = inMemoryRecords.get(lang);
      if (!rec) return null;
      // Per ocr-engine.md §4.2: tesseract.js wants the DIRECTORY containing
      // the .traineddata.gz file.
      const lastSlash = rec.filePath.lastIndexOf('/');
      const lastBack = rec.filePath.lastIndexOf('\\');
      const cut = Math.max(lastSlash, lastBack);
      return cut > 0 ? rec.filePath.slice(0, cut) : rec.filePath;
    },

    async download(lang, onProgress, signal) {
      if (!isValidLangCode(lang)) {
        return fail<LanguagePackError>('lang_not_in_catalog', `invalid lang code: ${lang}`);
      }
      const entry = catalog.packs.find((p) => p.lang === lang);
      if (!entry) {
        return fail<LanguagePackError>('lang_not_in_catalog', `lang '${lang}' not in catalog`);
      }
      refreshRecords();
      if (inMemoryRecords.has(lang)) {
        return fail<LanguagePackError>('pack_already_installed', `${lang} already installed`);
      }
      // Ensure the user tessdata dir exists.
      try {
        await filesys.mkdir(paths.userTessdataDir(), true);
      } catch (e) {
        return fail<LanguagePackError>('disk_write_failed', `mkdir failed: ${(e as Error).name}`);
      }
      const dest = userPathFor(lang);
      const url = `${catalog.baseUrl}/${lang}.traineddata.gz`;
      try {
        await httpStreamer.download(url, dest, onProgress, signal);
      } catch (e) {
        // Clean up partial file (best-effort).
        try {
          if (filesys.existsSync(dest)) await filesys.unlink(dest);
        } catch {
          /* ignore */
        }
        const name = (e as Error).name ?? 'unknown';
        if (name === 'AbortError' || signal.aborted) {
          return fail<LanguagePackError>('cancelled', 'download aborted');
        }
        // Do NOT echo the URL or path in the message (conventions §16.6
        // anti-pattern — logs may reveal local FS layout).
        return fail<LanguagePackError>('network_error', `download failed: ${name}`);
      }
      // Read back and verify SHA-256 BEFORE inserting state (R-W19-B).
      let actualSha: string;
      try {
        const bytes = await filesys.readFileBytes(dest);
        actualSha = sha256Hex(bytes);
      } catch (e) {
        try {
          await filesys.unlink(dest);
        } catch {
          /* ignore */
        }
        return fail<LanguagePackError>(
          'disk_write_failed',
          `read-back failed: ${(e as Error).name}`,
        );
      }
      // "TBD-FILL-AT-RELEASE" is the sentinel from the seed catalog ship —
      // we still REJECT mismatch on real published hashes. The sentinel
      // path is for development before Diego's release-build computes the
      // real hashes. In production the catalog ships with real SHA-256s;
      // this sentinel returns `pack_integrity_failed` because the actual
      // computed hash will never equal the literal string.
      if (actualSha !== entry.sha256) {
        try {
          await filesys.unlink(dest);
        } catch {
          /* ignore */
        }
        return fail<LanguagePackError>('pack_integrity_failed', `SHA-256 mismatch for ${lang}`);
      }
      let stat: { size: number };
      try {
        stat = await filesys.stat(dest);
      } catch (e) {
        return fail<LanguagePackError>('disk_write_failed', `stat failed: ${(e as Error).name}`);
      }
      const record: LanguagePackRecord = {
        lang,
        displayName: entry.displayName,
        source: 'downloaded',
        filePath: dest,
        sizeBytes: stat.size,
        sha256: actualSha,
        installedAt: clock(),
        lastUsedAt: null,
      };
      inMemoryRecords.set(lang, record);
      return ok(record);
    },

    async remove(lang) {
      if (!isValidLangCode(lang)) {
        return fail<LanguagePackError>('pack_not_installed', `invalid lang code: ${lang}`);
      }
      refreshRecords();
      const rec = inMemoryRecords.get(lang);
      if (!rec) {
        return fail<LanguagePackError>('pack_not_installed', `${lang} not installed`);
      }
      if (rec.source === 'bundled') {
        return fail<LanguagePackError>(
          'cannot_remove_bundled',
          `cannot remove bundled '${lang}' pack`,
        );
      }
      try {
        await filesys.unlink(rec.filePath);
      } catch (e) {
        return fail<LanguagePackError>('disk_unlink_failed', `unlink failed: ${(e as Error).name}`);
      }
      inMemoryRecords.delete(lang);
      return ok({ removed: true });
    },

    touchLastUsed(lang, when) {
      const rec = inMemoryRecords.get(lang);
      if (rec) rec.lastUsedAt = when;
    },

    catalogEntry(lang) {
      return catalog.packs.find((p) => p.lang === lang) ?? null;
    },

    getCatalog() {
      return catalog;
    },
  };
}
