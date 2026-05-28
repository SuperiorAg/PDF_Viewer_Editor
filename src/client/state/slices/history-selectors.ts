import { type RootState } from '../store';

export const selectCanUndo = (s: RootState) => s.history.past.length > 0;
export const selectCanRedo = (s: RootState) => s.history.future.length > 0;
