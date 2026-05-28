import { useAppSelector } from '../state/hooks';
import {
  selectCurrentDocument,
  selectIsDirty,
  selectPageCount,
} from '../state/slices/document-selectors';

export function useDocument() {
  const document = useAppSelector(selectCurrentDocument);
  const isDirty = useAppSelector(selectIsDirty);
  const pageCount = useAppSelector(selectPageCount);
  return { document, isDirty, pageCount, isOpen: document !== null };
}
