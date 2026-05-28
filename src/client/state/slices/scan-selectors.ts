// Scan selectors — Phase 5.1 placeholder. Tiny surface.

import { type RootState } from '../store';

export const selectScanModalOpen = (s: RootState): boolean => s.scan.modalOpen;
export const selectScanLastError = (s: RootState): string | null => s.scan.lastError;
