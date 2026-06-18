// Tag PDF tree row — Phase 7.5 C3 (Riley Wave 5b).
//
// One row + its (optionally expanded) children. Drag-and-drop hooks emit
// move actions through the parent panel's slice dispatchers. Visual cues
// per docs/ui-spec-phase-7.5.md §24.1.

import { useState, type DragEvent, type KeyboardEvent } from 'react';

import { useT } from '../../i18n/use-t';
import type { StructTreeNode } from '../../types/struct-tree-contract-stub';

import styles from './tag-tree-editor.module.css';

interface TagNodeProps {
  node: StructTreeNode;
  depth: number;
  selectedId: string | null;
  unreviewedIds: Record<string, true>;
  hasPreview: boolean;
  onSelect: (id: string) => void;
  onMove: (nodeId: string, newParentId: string, newIndex: number) => void;
  /** Drag-and-drop data transfer uses a private mime type — the renderer
   *  is the only consumer + this lets us reject cross-browser drops cleanly. */
}

const DND_MIME = 'application/x-pdf-viewer-struct-node';

function nodeHasMissingAlt(node: StructTreeNode): boolean {
  return node.type === 'Figure' && (node.altText === undefined || node.altText.trim() === '');
}

export function TagNode(props: TagNodeProps): JSX.Element {
  const { t } = useT();
  const { node, depth, selectedId, unreviewedIds, hasPreview, onSelect, onMove } = props;
  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;
  // Default expanded for depth 0-2 (Document + top-level sections); deeper
  // tiers start collapsed so a long tree doesn't dominate the viewport on
  // first paint.
  const [expanded, setExpanded] = useState(depth <= 2);
  const [dragOverChildIndex, setDragOverChildIndex] = useState<number | null>(null);

  const missingAlt = nodeHasMissingAlt(node);
  const showUnreviewed = hasPreview && unreviewedIds[node.id] !== true;

  const onRowClick = (): void => {
    onSelect(node.id);
  };

  const onRowKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(node.id);
    } else if (e.key === 'ArrowRight' && hasChildren && !expanded) {
      setExpanded(true);
    } else if (e.key === 'ArrowLeft' && expanded) {
      setExpanded(false);
    }
  };

  const onDragStart = (e: DragEvent<HTMLDivElement>): void => {
    e.dataTransfer.setData(DND_MIME, node.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>, childIndex: number): void => {
    // Only accept our private mime; cross-window drags would otherwise look
    // identical and produce confusing moves.
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverChildIndex(childIndex);
  };

  const onDragLeave = (): void => {
    setDragOverChildIndex(null);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, childIndex: number): void => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(DND_MIME);
    setDragOverChildIndex(null);
    if (draggedId.length === 0) return;
    if (draggedId === node.id) return;
    onMove(draggedId, node.id, childIndex);
  };

  const label =
    node.title !== undefined && node.title.trim().length > 0
      ? node.title
      : t('modals:accessibility.tagPdf.unlabeled');

  return (
    <li>
      <div
        className={[
          styles.row,
          isSelected ? styles.rowSelected : '',
          showUnreviewed ? styles.rowUnreviewed : '',
          dragOverChildIndex !== null ? styles.dragOver : '',
        ]
          .filter((c): c is string => typeof c === 'string' && c.length > 0)
          .join(' ')}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-level={depth + 1}
        tabIndex={isSelected ? 0 : -1}
        draggable={depth > 0 /* root not draggable */}
        onDragStart={onDragStart}
        onDragOver={(e) => onDragOver(e, node.children.length)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, node.children.length)}
        onClick={onRowClick}
        onKeyDown={onRowKeyDown}
        data-node-id={node.id}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.disclosure}
            aria-label={
              expanded
                ? t('modals:accessibility.tagPdf.collapse', { type: node.type })
                : t('modals:accessibility.tagPdf.expand', { type: node.type })
            }
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => !prev);
            }}
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className={styles.disclosure} aria-hidden="true">
            ·
          </span>
        )}
        <span className={styles.typeBadge}>{node.type}</span>
        <span className={styles.rowLabel}>{label}</span>
        {missingAlt && (
          <span
            className={styles.warningIcon}
            title={t('modals:accessibility.tagPdf.figureNoAlt')}
            aria-label={t('modals:accessibility.tagPdf.figureNoAlt')}
          >
            ⚠
          </span>
        )}
      </div>
      {hasChildren && expanded && (
        <ul className={styles.treeRowNested} role="group">
          {node.children.map((child) => (
            <TagNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              unreviewedIds={unreviewedIds}
              hasPreview={hasPreview}
              onSelect={onSelect}
              onMove={onMove}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
