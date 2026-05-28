import { useAppSelector } from '../../state/hooks';
import { selectSelectedAnnotationId } from '../../state/slices/annotations-selectors';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { selectDesignerMode, selectSelectedFieldName } from '../../state/slices/forms-selectors';
import { selectInspectorCollapsed } from '../../state/slices/ui-selectors';
import { AnnotationProperties } from '../annotation-properties';
import { FieldPropertiesPane } from '../form-designer';
import { PageMetadata } from '../page-metadata';

import styles from './inspector.module.css';

export function Inspector(): JSX.Element | null {
  const doc = useAppSelector(selectCurrentDocument);
  const collapsed = useAppSelector(selectInspectorCollapsed);
  const selectedAnnotation = useAppSelector(selectSelectedAnnotationId);
  const designerMode = useAppSelector(selectDesignerMode);
  const selectedFieldName = useAppSelector(selectSelectedFieldName);

  if (collapsed || !doc) return null;

  // Phase 3: when designer mode is active AND a field is selected, the
  // Inspector hosts the form-field properties pane. Falls through to the
  // annotation/page panes otherwise (Phase 1 + Phase 2 unchanged).
  const showFieldPane: boolean = designerMode && selectedFieldName !== null;

  return (
    <aside className={styles.inspector} aria-label="Inspector">
      {showFieldPane ? (
        <FieldPropertiesPane />
      ) : selectedAnnotation ? (
        <AnnotationProperties />
      ) : (
        <PageMetadata />
      )}
    </aside>
  );
}
