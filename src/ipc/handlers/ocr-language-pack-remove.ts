// Handler: ocr:languagePackRemove (Phase 5, api-contracts.md §16.8)
//
// Remove a downloaded language pack. Refuses to remove the bundled `eng` pack
// (per locked decision P5-L-4).

import { z } from 'zod';

import type { LanguagePackManager } from '../../main/pdf-ops/language-pack-manager.js';
import { fail, ok } from '../../shared/result.js';
import type {
  OcrLanguagePackRemoveError,
  OcrLanguagePackRemoveRequest,
  OcrLanguagePackRemoveResponse,
} from '../contracts.js';

export interface LanguagePacksRemoveRepoBridge {
  remove(lang: string): boolean;
}

export interface OcrLanguagePackRemoveDeps {
  languagePackManager: LanguagePackManager;
  /** Null if Ravi's repo not yet wired; file-system removal still proceeds. */
  languagePacksRepo: LanguagePacksRemoveRepoBridge | null;
}

const requestSchema = z.object({
  lang: z.string().regex(/^[a-z]{3}(_[a-z]+)?$/i),
});

export async function handleOcrLanguagePackRemove(
  req: unknown,
  deps: OcrLanguagePackRemoveDeps,
): Promise<OcrLanguagePackRemoveResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<OcrLanguagePackRemoveError>('invalid_payload', parsed.error.message);
  }
  const r = await deps.languagePackManager.remove(parsed.data.lang);
  if (!r.ok) {
    const mapped: OcrLanguagePackRemoveError =
      r.error === 'pack_not_installed'
        ? 'pack_not_installed'
        : r.error === 'cannot_remove_bundled'
          ? 'cannot_remove_bundled'
          : 'disk_unlink_failed';
    return fail<OcrLanguagePackRemoveError>(mapped, r.message);
  }
  // Best-effort row removal.
  if (deps.languagePacksRepo) {
    try {
      deps.languagePacksRepo.remove(parsed.data.lang);
    } catch {
      // Pack is gone from disk; row cleanup is non-critical.
    }
  }
  return ok({ removed: r.value.removed });
}

export type _UnusedReq = OcrLanguagePackRemoveRequest;
