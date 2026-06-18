// Tag PDF tree editor panel — Phase 7.5 C3 (Riley Wave 5b).
// Per docs/ui-spec-phase-7.5.md §24 + docs/accessibility-authoring-spec.md §3.
//
// HONESTY CLAUSE (accessibility-authoring-spec §1.4 / R12 mitigation): the
// panel header surfaces the permanent "Save-as-copy by default when an
// existing /StructTreeRoot is detected" disclosure whenever the engine
// reports `hasExistingTags === true`. The disclosure cannot be dismissed.
// Auto-tag NEVER auto-runs — the "Auto-tag" button opens a confirm modal
// before the heuristic is dispatched (P7.5-L-10 obligation #3).
// The Apply button gates on `dirty` so the user can never write a
// no-op tree update into David's side-table.

import { useEffect } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  acceptAutoTagPreview,
  addChild,
  deleteNode,
  dismissAutoTagPreview,
  makeNode,
  moveNode,
  replaceNode,
  reorderSibling,
  selectNode,
  selectSelectedStructNode,
  selectStructTreeDirty,
  selectStructTreeHasExistingTags,
  selectStructTreeRoot,
  selectStructTreeWarnings,
  setAddModalOpen,
  setAutoTagConfirmOpen,
} from '../../state/slices/struct-tree-slice';
import {
  applyStructTreeThunk,
  loadStructTreeThunk,
  runAutoTagThunk,
} from '../../state/thunks-phase7-5-wave5b';
import {
  PICKABLE_TYPES,
  type StructTreeNode,
  type StructTreeNodeType,
} from '../../types/struct-tree-contract-stub';

import { TagAddModal } from './tag-add-modal';
import { TagNode } from './tag-node';
import styles from './tag-tree-editor.module.css';

export function TagTreeEditor(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const root = useAppSelector(selectStructTreeRoot);
  const hasExistingTags = useAppSelector(selectStructTreeHasExistingTags);
  const dirty = useAppSelector(selectStructTreeDirty);
  const warnings = useAppSelector(selectStructTreeWarnings);
  const selected = useAppSelector(selectSelectedStructNode);
  const state = useAppSelector((s) => s.structTree);

  // Auto-load on mount if a doc is open and we haven't loaded yet for it.
  useEffect(() => {
    if (doc && (!state.loaded || state.docHash !== doc.fileHash)) {
      void dispatch(loadStructTreeThunk());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.fileHash]);

  const onSelect = (id: string): void => {
    dispatch(selectNode(id));
  };

  const onMove = (nodeId: string, newParentId: string, newIndex: number): void => {
    dispatch(moveNode({ nodeId, newParentId, newIndex }));
  };

  const onAddClick = (): void => {
    if (selected === null && root === null) return;
    dispatch(setAddModalOpen(true));
  };

  const onAddSubmit = (type: StructTreeNodeType, title: string): void => {
    const parentId = selected !== null ? selected.id : root?.id;
    if (parentId === undefined) return;
    const childOpts: { type: StructTreeNodeType; title?: string } = { type };
    if (title.trim().length > 0) childOpts.title = title.trim();
    const child = makeNode(childOpts);
    dispatch(addChild({ parentId, node: child }));
    dispatch(setAddModalOpen(false));
  };

  const onDelete = (): void => {
    if (selected === null) return;
    if (root !== null && selected.id === root.id) return;
    dispatch(deleteNode({ id: selected.id }));
  };

  const onMoveUp = (): void => {
    if (selected === null) return;
    dispatch(reorderSibling({ nodeId: selected.id, direction: 'up' }));
  };

  const onMoveDown = (): void => {
    if (selected === null) return;
    dispatch(reorderSibling({ nodeId: selected.id, direction: 'down' }));
  };

  const onApply = (): void => {
    void dispatch(applyStructTreeThunk());
  };

  const onAutoTag = (): void => {
    dispatch(setAutoTagConfirmOpen(true));
  };

  const onConfirmAutoTag = (): void => {
    void dispatch(runAutoTagThunk({ pages: 'all' }));
  };

  const onCancelAutoTag = (): void => {
    dispatch(setAutoTagConfirmOpen(false));
  };

  const onSelectedFieldChange = (patch: Partial<StructTreeNode>): void => {
    if (selected === null) return;
    const merged: StructTreeNode = { ...selected, ...patch };
    dispatch(replaceNode({ id: selected.id, replacement: merged }));
  };

  return (
    <section className={styles.panel} aria-label={t('modals:accessibility.tagPdf.title')}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{t('modals:accessibility.tagPdf.title')}</h2>
          <div className={styles.headerButtons}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onAddClick}
              disabled={root === null || state.autoTagRunning}
              aria-label={t('modals:accessibility.tagPdf.addChildAria')}
              title={t('modals:accessibility.tagPdf.addChild')}
            >
              +
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onAutoTag}
              disabled={doc === null || state.autoTagRunning}
              aria-label={t('modals:accessibility.tagPdf.autoTagAria')}
              title={t('modals:accessibility.tagPdf.autoTag')}
            >
              {state.autoTagRunning
                ? t('modals:accessibility.tagPdf.autoTagging')
                : `▶ ${t('modals:accessibility.tagPdf.autoTag')}`}
            </button>
          </div>
        </div>
        {/* HONESTY DISCLOSURE — surfaces ONLY when hasExistingTags is true,
            per P7.5-L-5 + R12 mitigation. */}
        {hasExistingTags && (
          <p className={styles.saveAsCopyDisclosure} data-testid="save-as-copy-disclosure">
            {t('modals:accessibility.tagPdf.saveAsCopyDisclosure')}
          </p>
        )}
        {root !== null && (warnings.figuresMissingAlt > 0 || warnings.headingNestingJumps > 0) && (
          <div className={styles.warningSummary}>
            {warnings.figuresMissingAlt > 0 && (
              <span>
                ⚠{' '}
                {t('modals:accessibility.tagPdf.figuresNoAltCount', {
                  count: warnings.figuresMissingAlt,
                })}
              </span>
            )}
            {warnings.headingNestingJumps > 0 && (
              <span>
                ⚠{' '}
                {t('modals:accessibility.tagPdf.headingJumpCount', {
                  count: warnings.headingNestingJumps,
                })}
              </span>
            )}
          </div>
        )}
      </header>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.applyButton}
          onClick={onApply}
          disabled={!dirty || state.applying || doc === null}
          aria-label={t('modals:accessibility.tagPdf.applyAria')}
        >
          {state.applying
            ? t('modals:accessibility.tagPdf.applying')
            : t('modals:accessibility.tagPdf.apply')}
        </button>
      </div>

      {state.lastErrorMessage !== null && (
        <div className={styles.error} role="alert">
          {state.lastErrorMessage}
        </div>
      )}

      {doc === null && (
        <div className={styles.emptyState}>{t('modals:accessibility.tagPdf.noDocument')}</div>
      )}

      {doc !== null && root === null && !state.loading && state.loaded && (
        <div className={styles.emptyState}>{t('modals:accessibility.tagPdf.noTags')}</div>
      )}

      {state.loading && (
        <div className={styles.emptyState}>{t('modals:accessibility.tagPdf.loading')}</div>
      )}

      {root !== null && (
        <div className={styles.treeScroll}>
          <ul
            className={styles.tree}
            role="tree"
            aria-label={t('modals:accessibility.tagPdf.treeAria')}
          >
            <TagNode
              node={root}
              depth={0}
              selectedId={state.selectedNodeId}
              unreviewedIds={state.reviewedNodeIds}
              hasPreview={state.autoTagPreview !== null}
              onSelect={onSelect}
              onMove={onMove}
            />
          </ul>
        </div>
      )}

      {state.autoTagWarnings.length > 0 && (
        <ul
          className={styles.warningsList}
          aria-label={t('modals:accessibility.tagPdf.heuristicWarnings')}
        >
          {state.autoTagWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {state.autoTagPreview !== null && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => dispatch(dismissAutoTagPreview())}
          >
            {t('modals:accessibility.tagPdf.dismissPreview')}
          </button>
          <button
            type="button"
            className={styles.applyButton}
            onClick={() => dispatch(acceptAutoTagPreview())}
          >
            {t('modals:accessibility.tagPdf.acceptPreview')}
          </button>
        </div>
      )}

      {selected !== null && (
        <div className={styles.inspector}>
          <div className={styles.inspectorTitle}>
            {t('modals:accessibility.tagPdf.selected')}: {selected.type}
          </div>
          <div className={styles.inspectorField}>
            <label htmlFor="tag-inspector-type">{t('modals:accessibility.tagPdf.type')}</label>
            <select
              id="tag-inspector-type"
              value={selected.type}
              onChange={(e) =>
                onSelectedFieldChange({ type: e.target.value as StructTreeNodeType })
              }
            >
              {PICKABLE_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {tp}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.inspectorField}>
            <label htmlFor="tag-inspector-title">
              {t('modals:accessibility.tagPdf.titleLabel')}
            </label>
            <input
              id="tag-inspector-title"
              type="text"
              value={selected.title ?? ''}
              onChange={(e) => onSelectedFieldChange({ title: e.target.value })}
            />
          </div>
          {selected.type === 'Figure' && (
            <div className={styles.inspectorField}>
              <label htmlFor="tag-inspector-alt">{t('modals:accessibility.tagPdf.altText')}</label>
              <input
                id="tag-inspector-alt"
                type="text"
                value={selected.altText ?? ''}
                onChange={(e) => onSelectedFieldChange({ altText: e.target.value })}
              />
            </div>
          )}
          <div className={styles.inspectorActions}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onMoveUp}
              disabled={root === null}
            >
              ↑ {t('modals:accessibility.tagPdf.moveUp')}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onMoveDown}
              disabled={root === null}
            >
              ↓ {t('modals:accessibility.tagPdf.moveDown')}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onDelete}
              disabled={root !== null && selected.id === root.id}
              aria-label={t('modals:accessibility.tagPdf.deleteAria')}
            >
              {t('modals:accessibility.tagPdf.delete')}
            </button>
          </div>
        </div>
      )}

      {state.addModalOpen && (selected !== null || root !== null) && (
        <TagAddModal
          parentType={(selected ?? root)?.type ?? ''}
          onCancel={() => dispatch(setAddModalOpen(false))}
          onSubmit={onAddSubmit}
        />
      )}

      {state.autoTagConfirmOpen && (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="autotag-confirm-title"
        >
          <div className={styles.modal}>
            <h3 id="autotag-confirm-title" className={styles.modalTitle}>
              {t('modals:accessibility.tagPdf.autoTagConfirmTitle')}
            </h3>
            <p className={styles.modalBody}>
              {t('modals:accessibility.tagPdf.autoTagConfirmBody')}
            </p>
            <div className={styles.modalActions}>
              <button type="button" className={styles.iconButton} onClick={onCancelAutoTag}>
                {t('common:cancel')}
              </button>
              <button type="button" className={styles.applyButton} onClick={onConfirmAutoTag}>
                {t('modals:accessibility.tagPdf.autoTagRun')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
