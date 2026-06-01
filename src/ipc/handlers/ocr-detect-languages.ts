// Handler: ocr:detectLanguages (Phase 5, api-contracts.md §16.1)
//
// Lists installed (bundled + downloaded) + downloadable language packs.
// Renderer calls this on OCR modal open to populate the language picker.
//
// SAFETY: the renderer-facing `LanguagePack` DTO STRIPS `filePath` (conventions
// §16.2 bytes-stay-in-main). Main holds the resolved path; the renderer
// pattern-matches on `lang` + `source` only.

import { z } from 'zod';

import type { LanguagePackManager } from '../../main/pdf-ops/language-pack-manager.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  LanguagePack,
  OcrDetectLanguagesError,
  OcrDetectLanguagesRequest,
  OcrDetectLanguagesResponse,
  SettingKey,
  SettingValue,
} from '../contracts.js';

export interface OcrDetectLanguagesDeps {
  languagePackManager: LanguagePackManager;
  /** Read setting `ocr.defaultLang`; returns null if unset (defaults to 'eng'). */
  getSetting: <K extends SettingKey>(key: K) => SettingValue<K> | null;
}

// Phase 5 channel currently takes empty payload; we still parse to enforce
// "no extra keys" discipline (conventions §0.1).
const requestSchema = z.object({}).strict();

export async function handleOcrDetectLanguages(
  req: unknown,
  deps: OcrDetectLanguagesDeps,
): Promise<OcrDetectLanguagesResponse> {
  const parsed = requestSchema.safeParse(req ?? {});
  if (!parsed.success) {
    return fail<OcrDetectLanguagesError>('catalog_load_failed', parsed.error.message);
  }
  try {
    const { installed, downloadable } = await deps.languagePackManager.list();
    // Strip `filePath` at the bridge (conventions §16.2).
    const installedDto: LanguagePack[] = installed.map((p) => ({
      lang: p.lang,
      displayName: p.displayName,
      source: p.source,
      sizeBytes: p.sizeBytes,
      sha256: p.sha256,
      installedAt: p.installedAt,
      lastUsedAt: p.lastUsedAt,
    }));
    const defaultLangSetting = deps.getSetting('ocr.defaultLang');
    const defaultLang = defaultLangSetting ?? 'eng';
    return ok({
      installed: installedDto,
      downloadable,
      defaultLang,
    });
  } catch (e) {
    return fail<OcrDetectLanguagesError>(
      'catalog_load_failed',
      `catalog load threw: ${safeMessage(e, 'unknown error')}`,
    );
  }
}

// Pure-types use to ensure the discriminated alias `OcrDetectLanguagesRequest`
// is not eliminated (verbatimModuleSyntax).
export type _UnusedReq = OcrDetectLanguagesRequest;
