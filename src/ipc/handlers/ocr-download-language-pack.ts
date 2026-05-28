// Handler: ocr:languagePackDownload (Phase 5, api-contracts.md §16.7)
//
// Stream-download a language pack from the upstream tessdata mirror.
// Verifies SHA-256 against the shipped catalog before persisting state.
//
// EMITS `ocr:languagePackDownload:progress` events. Follows the mail-merge
// progress-event pattern (Phase 3).

import { z } from 'zod';

import type {
  LanguagePackManager,
  LanguagePackRecord,
} from '../../main/pdf-ops/language-pack-manager.js';
import { fail, ok } from '../../shared/result.js';
import type {
  LanguagePack,
  OcrLanguagePackDownloadError,
  OcrLanguagePackDownloadProgressEvent,
  OcrLanguagePackDownloadRequest,
  OcrLanguagePackDownloadResponse,
} from '../contracts.js';

// Bridge to Ravi's language_packs repo (snake_case row insert).
export interface LanguagePackRowInsert {
  lang: string;
  source: 'bundled' | 'downloaded';
  file_path: string;
  size_bytes: number;
  sha256: string;
  installed_at: number;
  last_used_at: number | null;
}

export interface LanguagePacksRepoBridge {
  upsert(row: LanguagePackRowInsert): void;
}

export interface OcrLanguagePackDownloadDeps {
  languagePackManager: LanguagePackManager;
  /** Null if Ravi's repo not yet wired (parallel-wave). Download still works. */
  languagePacksRepo: LanguagePacksRepoBridge | null;
  emitProgress: (event: OcrLanguagePackDownloadProgressEvent) => void;
}

const requestSchema = z.object({
  lang: z.string().regex(/^[a-z]{3}(_[a-z]+)?$/i),
});

function toRendererDto(p: LanguagePackRecord): LanguagePack {
  // Strip `filePath` at the IPC boundary (conventions §16.2).
  return {
    lang: p.lang,
    displayName: p.displayName,
    source: p.source,
    sizeBytes: p.sizeBytes,
    sha256: p.sha256,
    installedAt: p.installedAt,
    lastUsedAt: p.lastUsedAt,
  };
}

export async function handleOcrLanguagePackDownload(
  req: unknown,
  deps: OcrLanguagePackDownloadDeps,
): Promise<OcrLanguagePackDownloadResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<OcrLanguagePackDownloadError>('invalid_payload', parsed.error.message);
  }
  const lang = parsed.data.lang;
  const entry = deps.languagePackManager.catalogEntry(lang);
  if (!entry) {
    return fail<OcrLanguagePackDownloadError>(
      'lang_not_in_catalog',
      `lang '${lang}' not in catalog`,
    );
  }
  deps.emitProgress({ lang, phase: 'starting', totalBytes: entry.sizeBytes });

  const controller = new AbortController();
  const r = await deps.languagePackManager.download(
    lang,
    (bytesDownloaded, totalBytes) => {
      deps.emitProgress({ lang, phase: 'downloading', bytesDownloaded, totalBytes });
    },
    controller.signal,
  );
  if (!r.ok) {
    if (r.error === 'cancelled') {
      deps.emitProgress({ lang, phase: 'cancelled' });
      return fail<OcrLanguagePackDownloadError>('cancelled', r.message);
    }
    deps.emitProgress({ lang, phase: 'failed', error: r.message });
    // Map manager errors to handler error union.
    const mapped: OcrLanguagePackDownloadError =
      r.error === 'lang_not_in_catalog'
        ? 'lang_not_in_catalog'
        : r.error === 'pack_already_installed'
          ? 'pack_already_installed'
          : r.error === 'network_error'
            ? 'network_error'
            : r.error === 'pack_integrity_failed'
              ? 'pack_integrity_failed'
              : 'disk_write_failed';
    return fail<OcrLanguagePackDownloadError>(mapped, r.message);
  }
  deps.emitProgress({ lang, phase: 'verifying' });

  // Persist to language_packs table (best-effort; pack is usable without
  // the row).
  if (deps.languagePacksRepo) {
    try {
      deps.languagePacksRepo.upsert({
        lang: r.value.lang,
        source: r.value.source,
        file_path: r.value.filePath,
        size_bytes: r.value.sizeBytes,
        sha256: r.value.sha256,
        installed_at: r.value.installedAt,
        last_used_at: r.value.lastUsedAt,
      });
    } catch {
      // Best-effort; pack is on disk and resolvable.
    }
  }

  const dto = toRendererDto(r.value);
  deps.emitProgress({ lang, phase: 'completed', pack: dto });
  return ok({ pack: dto });
}

export type _UnusedReq = OcrLanguagePackDownloadRequest;
