import { type RootState } from '../store';

export const selectRecents = (s: RootState) => s.recents.items;
export const selectRecentsLoaded = (s: RootState) => s.recents.loaded;
