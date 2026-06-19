// Tiny path-basename helper for renderer use. Renderer cannot import
// node:path. Splits on either forward slash or backslash since paths from
// David's dialog:pickPdfFiles channel are Windows-shaped on Windows hosts.

export function basename(absPath: string): string {
  if (typeof absPath !== 'string') return '';
  const idx = Math.max(absPath.lastIndexOf('/'), absPath.lastIndexOf('\\'));
  if (idx === -1) return absPath;
  return absPath.slice(idx + 1);
}
