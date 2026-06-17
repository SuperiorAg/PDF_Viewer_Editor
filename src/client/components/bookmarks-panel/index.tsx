// BookmarksPanel — Phase 2 rewrite with full CRUD + nesting + edit mode.
// Per ui-spec.md §11.6 + data-models.md §7.4 + api-contracts.md §12.5–§12.7.
//
// Two display modes:
//  - Read-only (Phase 1 default): native PDF outline + user bookmarks flat list,
//    click to navigate.
//  - Edit mode (Phase 2 toggle): tree-style UI with rename / delete / new-child
//    / move up / move down via a per-row action menu. Drag-to-reorder is
//    Phase-2.5 scope (placeholder buttons today; @dnd-kit wiring is queued for
//    a follow-up when David confirms the IPC handlers return tree-shape).
//
// Empty state copy: matches ui-spec §11.6.

import { useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
// Phase 7.5 B19 (Riley Wave 5) — "Auto-generate from headings" link launches the modal.
import { openAutoBookmark } from '../../state/slices/auto-bookmark-slice';
import {
  selectBookmarksTree,
  selectPdfOutline,
  selectUserBookmarks,
} from '../../state/slices/bookmarks-selectors';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { selectBookmarksEditMode } from '../../state/slices/ui-selectors';
import { toggleBookmarksEditMode } from '../../state/slices/ui-slice';
import { selectCurrentPage } from '../../state/slices/viewport-selectors';
import { setCurrentPage } from '../../state/slices/viewport-slice';
import {
  addBookmarkThunk,
  deleteBookmarkThunk,
  moveBookmarkThunk,
  refreshBookmarksThunk,
  renameBookmarkThunk,
} from '../../state/thunks';
import { type BookmarkNode, type OutlineNode } from '../../types/ipc-contract';

import styles from './bookmarks-panel.module.css';

// Wave 28a (a11y-audit.md R-5): the Phase-1 two-branch literal aria-pressed
// workaround is REMOVED — jsx-a11y 6.10 accepts the dynamic boolean
// `aria-pressed={editMode}` at `error` (see build-report Wave 28a).
function EditModeButton(props: { editMode: boolean; onToggle: () => void }): JSX.Element {
  const className = `${styles.toolbarButton} ${props.editMode ? styles.toolbarButtonActive : ''}`;
  return (
    <button
      type="button"
      className={className}
      onClick={props.onToggle}
      aria-pressed={props.editMode}
      aria-label="Toggle bookmarks edit mode"
    >
      {props.editMode ? 'Edit mode: ON' : 'Edit mode: off'}
    </button>
  );
}

// Depth-padding for nested tree rows. Rendered via inline CSS custom property
// to avoid a deeply-nested static class table while satisfying the
// no-inline-styles lint (the only dynamic value is the depth integer).
function depthIndentStyle(depth: number): React.CSSProperties {
  const indent = depth * 14 + 8;
  return { paddingLeft: `${indent}px` };
}

export function BookmarksPanel(): JSX.Element {
  const dispatch = useAppDispatch();
  const { t } = useT();
  const doc = useAppSelector(selectCurrentDocument);
  const outline = useAppSelector(selectPdfOutline);
  const userBookmarks = useAppSelector(selectUserBookmarks);
  const tree = useAppSelector(selectBookmarksTree);
  const editMode = useAppSelector(selectBookmarksEditMode);
  const currentPage = useAppSelector(selectCurrentPage);

  // Refresh tree from main on mount + doc change.
  // We intentionally key the effect on `doc?.fileHash` (the stable document
  // identity) rather than the whole `doc` object: depending on `doc` would
  // re-fire this refresh on every in-memory document mutation (page edits, save
  // state), not just when a different file is opened. Omission is deliberate.
  useEffect(() => {
    if (doc) void dispatch(refreshBookmarksThunk());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, doc?.fileHash]);

  if (!doc) {
    return <p className={styles.empty}>No document open.</p>;
  }

  const jumpTo = (pageIndex: number | null): void => {
    if (pageIndex !== null) dispatch(setCurrentPage(pageIndex));
  };

  const onAddTopLevel = (): void => {
    void dispatch(
      addBookmarkThunk({
        pageIndex: currentPage,
        title: `Bookmark p.${currentPage + 1}`,
        parentId: null,
        sortOrder: tree.length,
      }),
    );
  };

  const hasUserBookmarks = userBookmarks.length > 0 || tree.length > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <EditModeButton editMode={editMode} onToggle={() => dispatch(toggleBookmarksEditMode())} />
        {editMode && (
          <button
            type="button"
            className={styles.toolbarButton}
            onClick={onAddTopLevel}
            aria-label="Add bookmark at current page"
          >
            + Add at current page
          </button>
        )}
        {/* Phase 7.5 B19 (Riley Wave 5) — Auto-generate from headings.
            Opens the registry-driven AutoBookmarkModal which dispatches
            David's `pdf:autoBookmarkFromHeadings` engine (Wave 4). */}
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={() => dispatch(openAutoBookmark())}
          aria-label={t('modals:autoBookmark.title')}
          title={t('modals:autoBookmark.title')}
        >
          {t('modals:autoBookmark.title')}
        </button>
      </div>

      {outline.length > 0 && (
        <section className={styles.section} aria-label="Document outline">
          <h3 className={styles.heading}>Document outline (read-only)</h3>
          <ul className={styles.list}>
            {outline.map((node, i) => (
              <OutlineRow key={`o-${i}`} node={node} depth={0} onJump={jumpTo} />
            ))}
          </ul>
        </section>
      )}

      <section className={styles.section} aria-label="User bookmarks">
        <h3 className={styles.heading}>My bookmarks</h3>
        {!hasUserBookmarks && (
          <div className={styles.emptyState}>
            <p className={styles.empty}>
              No bookmarks yet. Switch to Edit mode and click &ldquo;Add at current page&rdquo; to
              create one.
            </p>
          </div>
        )}
        {tree.length > 0 ? (
          <ul className={styles.list}>
            {tree.map((node) => (
              <BookmarkTreeRow
                key={node.id}
                node={node}
                depth={0}
                editMode={editMode}
                onJump={jumpTo}
              />
            ))}
          </ul>
        ) : (
          userBookmarks.length > 0 && (
            <ul className={styles.list}>
              {userBookmarks.map((b) => (
                <li key={b.id} className={styles.rowItem}>
                  <button
                    type="button"
                    className={styles.rowJump}
                    onClick={() => jumpTo(b.pageIndex)}
                    title={b.title}
                  >
                    <span className={styles.rowTitle}>{b.title}</span>
                    <span className={styles.rowPage}>p.{b.pageIndex + 1}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    </div>
  );
}

interface BookmarkTreeRowProps {
  node: BookmarkNode;
  depth: number;
  editMode: boolean;
  onJump: (pageIndex: number | null) => void;
}

function BookmarkTreeRow(props: BookmarkTreeRowProps): JSX.Element {
  const { node, depth, editMode, onJump } = props;
  const dispatch = useAppDispatch();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.title);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  const commitRename = (): void => {
    setRenaming(false);
    if (renameValue.trim() !== '' && renameValue !== node.title) {
      void dispatch(renameBookmarkThunk({ id: node.id, title: renameValue.trim() }));
    } else {
      setRenameValue(node.title);
    }
  };

  const onDelete = (): void => {
    const hasChildren = node.children.length > 0;
    const msg = hasChildren
      ? `Delete "${node.title}" and its ${node.children.length} sub-bookmark${
          node.children.length === 1 ? '' : 's'
        }?`
      : `Delete "${node.title}"?`;
    // eslint-disable-next-line no-alert
    if (window.confirm(msg)) {
      void dispatch(deleteBookmarkThunk({ id: node.id }));
    }
  };

  const onAddChild = (): void => {
    void dispatch(
      addBookmarkThunk({
        pageIndex: node.pageIndex,
        title: 'New child',
        parentId: node.id,
        sortOrder: node.children.length,
      }),
    );
  };

  const onMoveUp = (): void => {
    void dispatch(
      moveBookmarkThunk({
        id: node.id,
        newParentId: node.parentId,
        newSortOrder: Math.max(0, node.sortOrder - 1),
      }),
    );
  };

  const onMoveDown = (): void => {
    void dispatch(
      moveBookmarkThunk({
        id: node.id,
        newParentId: node.parentId,
        newSortOrder: node.sortOrder + 1,
      }),
    );
  };

  return (
    <li className={styles.rowItem}>
      <div className={styles.row} style={depthIndentStyle(depth)}>
        {renaming ? (
          <input
            ref={renameInputRef}
            className={styles.renameInput}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setRenaming(false);
                setRenameValue(node.title);
              }
            }}
            aria-label="Rename bookmark"
          />
        ) : (
          <button
            type="button"
            className={styles.rowJump}
            title={node.title}
            onClick={() => onJump(node.pageIndex)}
            onDoubleClick={() => {
              if (editMode) {
                setRenaming(true);
                setRenameValue(node.title);
              }
            }}
          >
            <span className={styles.rowTitle}>{node.title}</span>
            <span className={styles.rowPage}>p.{node.pageIndex + 1}</span>
          </button>
        )}
        {editMode && !renaming && (
          <span className={styles.actions}>
            <button
              type="button"
              className={styles.actionButton}
              aria-label={`Rename ${node.title}`}
              onClick={() => {
                setRenaming(true);
                setRenameValue(node.title);
              }}
              title="Rename"
            >
              ✎
            </button>
            <button
              type="button"
              className={styles.actionButton}
              aria-label={`Add child under ${node.title}`}
              onClick={onAddChild}
              title="New child"
            >
              +
            </button>
            <button
              type="button"
              className={styles.actionButton}
              aria-label={`Move ${node.title} up`}
              onClick={onMoveUp}
              title="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              className={styles.actionButton}
              aria-label={`Move ${node.title} down`}
              onClick={onMoveDown}
              title="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              className={styles.actionButtonDelete}
              aria-label={`Delete ${node.title}`}
              onClick={onDelete}
              title="Delete"
            >
              ×
            </button>
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className={styles.list}>
          {node.children.map((child) => (
            <BookmarkTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              editMode={editMode}
              onJump={onJump}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function outlineDepthStyle(depth: number): React.CSSProperties {
  const indent = depth * 12 + 8;
  return { paddingLeft: `${indent}px` };
}

function OutlineRow({
  node,
  depth,
  onJump,
}: {
  node: OutlineNode;
  depth: number;
  onJump: (pageIndex: number | null) => void;
}): JSX.Element {
  return (
    <li className={styles.rowItem}>
      <button
        type="button"
        className={`${styles.rowJump} ${styles.rowOutline}`}
        style={outlineDepthStyle(depth)}
        onClick={() => onJump(node.pageIndex)}
        title={node.title}
      >
        <span className={styles.rowTitle}>{node.title}</span>
        {node.pageIndex !== null && <span className={styles.rowPage}>p.{node.pageIndex + 1}</span>}
      </button>
      {node.children.length > 0 && (
        <ul className={styles.list}>
          {node.children.map((child, i) => (
            <OutlineRow key={`c-${i}`} node={child} depth={depth + 1} onJump={onJump} />
          ))}
        </ul>
      )}
    </li>
  );
}
