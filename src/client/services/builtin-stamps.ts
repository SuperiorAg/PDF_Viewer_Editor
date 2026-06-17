// Built-in stamp catalog — Phase 7.5 B7 (Riley Wave 3).
// Per docs/ui-spec-phase-7.5.md §7.5 (i18n keys list the ten labels).
//
// These are shipped — not user-edited and not stored in the SQLite
// stamps_library table. They merge into the panel listing at read time via
// `services/stamps-api.ts`.
//
// All ten are TEXT stamps (Phase 7.5 v0.8.0 ships text-only; the optional
// image kind is deferred per the principal). Display labels come from
// i18n key `stamps.builtin.<id>` so non-Latin locales can localize them
// while the PDF-embedded text stays English by default.

import type { StampLibraryEntry } from '../state/slices/stamps-slice';
import type { RgbColor } from '../types/ipc-contract';

const RED: RgbColor = { r: 0.8, g: 0.13, b: 0.13 };
const GREEN: RgbColor = { r: 0.04, g: 0.45, b: 0.04 };
const BLUE: RgbColor = { r: 0.04, g: 0.32, b: 0.66 };

interface BuiltinStampDef {
  id: string;
  /** i18n key for the user-visible name (resolves to t('stamps:builtin.<id>')). */
  nameI18nKey: string;
  /** Default text that gets embedded in the PDF (English baseline). */
  text: string;
  color: RgbColor;
  widthPt: number;
}

/** The ten built-in text stamps. Order matches docs/ui-spec-phase-7.5.md §7.5. */
export const BUILTIN_STAMPS: readonly BuiltinStampDef[] = [
  {
    id: 'builtin:approved',
    nameI18nKey: 'stamps:builtin.approved',
    text: 'APPROVED',
    color: GREEN,
    widthPt: 180,
  },
  {
    id: 'builtin:confidential',
    nameI18nKey: 'stamps:builtin.confidential',
    text: 'CONFIDENTIAL',
    color: RED,
    widthPt: 220,
  },
  {
    id: 'builtin:draft',
    nameI18nKey: 'stamps:builtin.draft',
    text: 'DRAFT',
    color: BLUE,
    widthPt: 160,
  },
  {
    id: 'builtin:sample',
    nameI18nKey: 'stamps:builtin.sample',
    text: 'SAMPLE',
    color: BLUE,
    widthPt: 160,
  },
  {
    id: 'builtin:reviewed',
    nameI18nKey: 'stamps:builtin.reviewed',
    text: 'REVIEWED',
    color: GREEN,
    widthPt: 180,
  },
  {
    id: 'builtin:urgent',
    nameI18nKey: 'stamps:builtin.urgent',
    text: 'URGENT',
    color: RED,
    widthPt: 160,
  },
  {
    id: 'builtin:notForDistribution',
    nameI18nKey: 'stamps:builtin.notForDistribution',
    text: 'NOT FOR DISTRIBUTION',
    color: RED,
    widthPt: 280,
  },
  {
    id: 'builtin:received',
    nameI18nKey: 'stamps:builtin.received',
    text: 'RECEIVED',
    color: BLUE,
    widthPt: 180,
  },
  {
    id: 'builtin:faxed',
    nameI18nKey: 'stamps:builtin.faxed',
    text: 'FAXED',
    color: BLUE,
    widthPt: 160,
  },
  {
    id: 'builtin:copy',
    nameI18nKey: 'stamps:builtin.copy',
    text: 'COPY',
    color: BLUE,
    widthPt: 140,
  },
];

/** Convert the catalog into `StampLibraryEntry` shape for panel rendering. */
export function builtinStampEntries(t: (key: string) => string): StampLibraryEntry[] {
  return BUILTIN_STAMPS.map((s) => ({
    id: s.id,
    name: t(s.nameI18nKey),
    kind: 'text',
    text: s.text,
    color: s.color,
    widthPt: s.widthPt,
    isBuiltin: true,
    lastUsedAt: null,
  }));
}

/** Resolve a stamp id (built-in or custom) to its embedding payload. */
export function resolveStampForPlacement(
  stampId: string,
  customStamps: readonly StampLibraryEntry[],
): {
  text: string;
  color: RgbColor;
  widthPt: number;
} | null {
  if (stampId.startsWith('builtin:')) {
    const builtin = BUILTIN_STAMPS.find((s) => s.id === stampId);
    if (!builtin) return null;
    return { text: builtin.text, color: builtin.color, widthPt: builtin.widthPt };
  }
  const custom = customStamps.find((s) => s.id === stampId);
  if (!custom || custom.kind !== 'text') return null;
  return {
    text: custom.text ?? custom.name,
    color: custom.color ?? BLUE,
    widthPt: custom.widthPt ?? 200,
  };
}
