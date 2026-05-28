// Handler: export:listFormats (Phase 6, api-contracts.md §17.8)
//
// Static catalog — the renderer uses this to render the format picker +
// per-format defaults. No DB read; data is compiled in. Handler is
// infallible; the `'never'` error variant is a type-system signal.

import { ok } from '../../shared/result.js';
import type {
  ExportFormatDescriptor,
  ExportListFormatsRequest,
  ExportListFormatsResponse,
} from '../contracts.js';

const FORMATS: ExportFormatDescriptor[] = [
  {
    format: 'docx',
    displayName: 'Word document',
    defaultExtension: 'docx',
    category: 'office',
    supportsQualityTier: true,
    defaultQualityTier: 'layout-preserving',
    defaultIncludeAnnotations: true,
    settingKeys: [
      'export.docx.qualityTier',
      'export.docx.pageSize',
      'export.docx.includeAnnotations',
    ],
  },
  {
    format: 'xlsx',
    displayName: 'Excel workbook',
    defaultExtension: 'xlsx',
    category: 'office',
    supportsQualityTier: true,
    defaultQualityTier: 'text-only',
    defaultIncludeAnnotations: false,
    settingKeys: ['export.xlsx.qualityTier', 'export.xlsx.includeAnnotations'],
  },
  {
    format: 'pptx',
    displayName: 'PowerPoint presentation',
    defaultExtension: 'pptx',
    category: 'office',
    supportsQualityTier: true,
    defaultQualityTier: 'layout-preserving',
    defaultIncludeAnnotations: true,
    settingKeys: ['export.pptx.qualityTier', 'export.pptx.includeAnnotations'],
  },
  {
    format: 'png',
    displayName: 'PNG image',
    defaultExtension: 'png',
    category: 'image',
    supportsQualityTier: false,
    defaultQualityTier: 'n/a',
    defaultIncludeAnnotations: true,
    settingKeys: ['export.image.format', 'export.image.dpi', 'export.image.includeAnnotations'],
  },
  {
    format: 'jpeg',
    displayName: 'JPEG image',
    defaultExtension: 'jpeg',
    category: 'image',
    supportsQualityTier: false,
    defaultQualityTier: 'n/a',
    defaultIncludeAnnotations: true,
    settingKeys: [
      'export.image.format',
      'export.image.dpi',
      'export.image.jpegQuality',
      'export.image.includeAnnotations',
    ],
  },
  {
    format: 'tiff',
    displayName: 'TIFF image',
    defaultExtension: 'tiff',
    category: 'image',
    supportsQualityTier: false,
    defaultQualityTier: 'n/a',
    defaultIncludeAnnotations: true,
    settingKeys: [
      'export.image.format',
      'export.image.dpi',
      'export.image.multiPageTiff',
      'export.image.includeAnnotations',
    ],
  },
];

export async function handleExportListFormats(_req: unknown): Promise<ExportListFormatsResponse> {
  return ok({ formats: FORMATS });
}

export const FORMATS_FOR_TEST = FORMATS;
export type _UnusedReq = ExportListFormatsRequest;
