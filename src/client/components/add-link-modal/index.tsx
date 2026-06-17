// Add Link / Edit Link modal — Phase 7.5 B13 (Riley Wave 4).
// Per docs/ui-spec-phase-7.5.md §13.1.
//
// Shows the marquee rect captured by the link-tool overlay, lets the user
// pick a target (URL / page / bookmark), and dispatches the link into the
// session-local `linksSlice`. Engine round-trip is deferred to Wave 5 (David)
// — see add-link-modal's "engineDeferredNote" copy.

import { useEffect, useMemo, useState } from 'react';

import { useT } from '../../i18n/use-t';
import { editLinks } from '../../services/links-api';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  addLink,
  closeAddLinkModal,
  closeEditLinkModal,
  removeLink,
  updateLink,
} from '../../state/slices/links-slice';
import { pushToast } from '../../state/slices/ui-slice';
import { selectCurrentPage } from '../../state/slices/viewport-selectors';
import type { LinkTarget, PdfLinkAnnotation } from '../../types/links-contract-stub';
import { ModalShell } from '../modals/modal-shell';

import styles from './add-link-modal.module.css';

type TargetKind = LinkTarget['kind'];

function newId(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return `lnk-${c.randomUUID()}`;
  return `lnk-${Math.random().toString(36).slice(2, 12)}`;
}

export function AddLinkModal(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const currentPage = useAppSelector(selectCurrentPage);
  const addModalState = useAppSelector((s) => s.links.addModal);
  const editModalId = useAppSelector((s) => s.links.editModalLinkId);
  const byHandle = useAppSelector((s) => s.links.byHandle);
  const bookmarks = useAppSelector((s) => s.bookmarks.tree);

  const isEdit = editModalId !== null;
  const existing = useMemo<PdfLinkAnnotation | null>(() => {
    if (!isEdit || doc === null) return null;
    const list = byHandle[doc.handle] ?? [];
    return list.find((l) => l.id === editModalId) ?? null;
  }, [isEdit, doc, byHandle, editModalId]);

  const initialRect = isEdit ? existing?.rect : addModalState?.rect;
  const initialPageIndex = isEdit ? existing?.pageIndex : addModalState?.pageIndex;

  const [kind, setKind] = useState<TargetKind>(() => existing?.target.kind ?? 'uri');
  const [url, setUrl] = useState<string>(() =>
    existing?.target.kind === 'uri' ? existing.target.uri : 'https://',
  );
  const [pageNumber, setPageNumber] = useState<number>(() =>
    existing?.target.kind === 'goto-page'
      ? existing.target.pageIndex + 1
      : (initialPageIndex ?? currentPage) + 1,
  );
  const [bookmarkId, setBookmarkId] = useState<number | null>(() =>
    existing?.target.kind === 'goto-bookmark' ? existing.target.bookmarkId : null,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    // When the modal is reused for a different link, reset the inputs.
    if (existing !== null) {
      setKind(existing.target.kind);
      if (existing.target.kind === 'uri') setUrl(existing.target.uri);
      if (existing.target.kind === 'goto-page') setPageNumber(existing.target.pageIndex + 1);
      if (existing.target.kind === 'goto-bookmark') setBookmarkId(existing.target.bookmarkId);
    }
  }, [existing]);

  if (!isEdit && addModalState === null) return null;
  if (isEdit && existing === null) return null;
  if (doc === null || initialRect === undefined || initialPageIndex === undefined) return null;

  const flatBookmarks: Array<{ id: number; title: string; pageIndex: number; depth: number }> = [];
  const walk = (
    list: ReadonlyArray<{
      id: number;
      title: string;
      pageIndex: number;
      children: readonly unknown[];
    }>,
    depth: number,
  ): void => {
    for (const b of list) {
      flatBookmarks.push({ id: b.id, title: b.title, pageIndex: b.pageIndex, depth });
      if (b.children.length > 0) {
        walk(
          b.children as ReadonlyArray<{
            id: number;
            title: string;
            pageIndex: number;
            children: readonly unknown[];
          }>,
          depth + 1,
        );
      }
    }
  };
  walk(bookmarks, 0);

  const onClose = (): void => {
    if (isEdit) dispatch(closeEditLinkModal());
    else dispatch(closeAddLinkModal());
  };

  const onSubmit = async (): Promise<void> => {
    setValidationError(null);
    let target: LinkTarget;
    if (kind === 'uri') {
      if (!/^https?:\/\/.+/i.test(url)) {
        setValidationError(t('modals:addLink.uri.invalid'));
        return;
      }
      target = { kind: 'uri', uri: url };
    } else if (kind === 'goto-page') {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.pageCount) {
        setValidationError(t('modals:addLink.page.outOfRange', { total: doc.pageCount }));
        return;
      }
      target = { kind: 'goto-page', pageIndex: pageNumber - 1 };
    } else {
      if (bookmarkId === null) {
        setValidationError(t('modals:addLink.bookmark.none'));
        return;
      }
      target = { kind: 'goto-bookmark', bookmarkId };
    }
    const now = Date.now();
    if (isEdit && existing !== null) {
      dispatch(updateLink({ handle: doc.handle, linkId: existing.id, target }));
      await editLinks({
        handle: doc.handle,
        actions: [{ kind: 'update', linkId: existing.id, target }],
      });
      dispatch(closeEditLinkModal());
    } else {
      const link: PdfLinkAnnotation = {
        id: newId(),
        pageIndex: initialPageIndex,
        rect: initialRect,
        target,
        createdAt: now,
        modifiedAt: now,
      };
      dispatch(addLink({ handle: doc.handle, link }));
      // David's canonical `add` action uses pageIndex + bbox + target. The
      // engine returns its own linkId — we ignore it for v0.8.0 and trust
      // the renderer-side id (a future patch can reconcile the engine id).
      await editLinks({
        handle: doc.handle,
        actions: [
          {
            kind: 'add',
            pageIndex: link.pageIndex,
            bbox: [
              link.rect.x,
              link.rect.y,
              link.rect.x + link.rect.width,
              link.rect.y + link.rect.height,
            ],
            target,
          },
        ],
      });
      dispatch(closeAddLinkModal());
    }
    dispatch(
      pushToast({
        kind: 'info',
        message: t('modals:addLink.engineDeferredNote'),
      }),
    );
  };

  const onRemove = async (): Promise<void> => {
    if (!isEdit || existing === null) return;
    dispatch(removeLink({ handle: doc.handle, linkId: existing.id }));
    await editLinks({ handle: doc.handle, actions: [{ kind: 'remove', linkId: existing.id }] });
    dispatch(closeEditLinkModal());
  };

  return (
    <ModalShell
      title={isEdit ? t('modals:addLink.editTitle') : t('modals:addLink.title')}
      onClose={onClose}
    >
      <div className={styles.row}>
        <span className={styles.label}>{t('modals:addLink.type.label')}</span>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name="link-kind"
            checked={kind === 'uri'}
            onChange={() => setKind('uri')}
          />
          {t('modals:addLink.type.uri')}
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name="link-kind"
            checked={kind === 'goto-page'}
            onChange={() => setKind('goto-page')}
          />
          {t('modals:addLink.type.gotoPage')}
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name="link-kind"
            checked={kind === 'goto-bookmark'}
            onChange={() => setKind('goto-bookmark')}
          />
          {t('modals:addLink.type.gotoBookmark')}
        </label>
      </div>

      {kind === 'uri' && (
        <div className={styles.row}>
          <label className={styles.label} htmlFor="link-url">
            {t('modals:addLink.uri.label')}
          </label>
          <input
            id="link-url"
            className={styles.input}
            type="url"
            value={url}
            placeholder={t('modals:addLink.uri.placeholder')}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      )}

      {kind === 'goto-page' && (
        <div className={styles.row}>
          <label className={styles.label} htmlFor="link-page">
            {t('modals:addLink.page.label')}
          </label>
          <input
            id="link-page"
            className={styles.input}
            type="number"
            min={1}
            max={doc.pageCount}
            value={String(pageNumber)}
            onChange={(e) => setPageNumber(Number(e.target.value))}
          />
          <button
            type="button"
            className={styles.input}
            onClick={() => setPageNumber(currentPage + 1)}
          >
            {t('modals:addLink.page.currentPage')}
          </button>
        </div>
      )}

      {kind === 'goto-bookmark' && (
        <div className={styles.row}>
          <label className={styles.label} htmlFor="link-bookmark">
            {t('modals:addLink.bookmark.label')}
          </label>
          {flatBookmarks.length === 0 ? (
            <span className={styles.hint}>{t('modals:addLink.bookmark.none')}</span>
          ) : (
            <select
              id="link-bookmark"
              className={styles.select}
              value={bookmarkId === null ? '' : String(bookmarkId)}
              onChange={(e) => setBookmarkId(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">—</option>
              {flatBookmarks.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {`${'  '.repeat(b.depth)}${b.title} (p${b.pageIndex + 1})`}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className={styles.hint}>
        {t('modals:addLink.rectInfo', {
          page: initialPageIndex + 1,
          width: Math.round(initialRect.width),
          height: Math.round(initialRect.height),
        })}
      </div>

      {validationError !== null && <div className={styles.error}>{validationError}</div>}

      <div className={styles.note}>{t('modals:addLink.engineDeferredNote')}</div>

      <div className={styles.actions}>
        {isEdit && (
          <button type="button" className={styles.input} onClick={() => void onRemove()}>
            {t('modals:addLink.removeLink')}
          </button>
        )}
        <button type="button" className={styles.input} onClick={onClose}>
          {t('modals:addLink.cancel')}
        </button>
        <button type="button" className={styles.input} onClick={() => void onSubmit()}>
          {isEdit ? t('modals:addLink.save') : t('modals:addLink.add')}
        </button>
      </div>
    </ModalShell>
  );
}
