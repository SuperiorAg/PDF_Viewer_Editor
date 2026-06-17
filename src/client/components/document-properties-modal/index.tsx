// Document Properties modal — Phase 7.5 B21 + B8 (Riley Wave 5).
// Per docs/ui-spec-phase-7.5.md §21 + §8.
//
// Four tabs: Description (editable metadata) + Security (B8 password) +
// Fonts (placeholder for v0.9.x) + Custom (placeholder for v0.9.x).
//
// On mount the modal kicks off `pdf:getDocumentProperties` via the Wave-5
// thunks file. The Description tab edits flow through
// `pdf:setDocumentProperties` on Apply. The Security tab edits flow through
// `pdf:setPasswordProtection` (qpdf subprocess) on its own Apply button.

import { useEffect } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  closeDocumentProperties,
  setDocPropertiesTab,
  type DocumentPropertiesTab,
} from '../../state/slices/document-properties-slice';
import {
  applyDocumentPropertiesThunk,
  loadDocumentPropertiesThunk,
} from '../../state/thunks-phase7-5-wave5';
import { ModalShell } from '../modals/modal-shell';

import { DescriptionTab } from './description-tab';
import styles from './document-properties-modal.module.css';
import { SecurityTab } from './security-tab';

const TAB_ORDER: readonly DocumentPropertiesTab[] = ['description', 'security', 'fonts', 'custom'];

export function DocumentPropertiesModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.documentProperties);

  // Fetch the snapshot on mount + when the doc identity changes.
  useEffect(() => {
    void dispatch(loadDocumentPropertiesThunk());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const onClose = (): void => {
    dispatch(closeDocumentProperties());
  };

  const onApplyDescription = (): void => {
    // Serialize the Description form-state into the channel's
    // Partial<DocumentProperties> shape. We send ALL four user-editable fields
    // (title / author / subject / keywords) since David's engine treats the
    // partial as "fields the user provided" — an empty string clears the
    // corresponding /Info entry which is the expected v1 semantics.
    const desc = state.description;
    void dispatch(
      applyDocumentPropertiesThunk({
        properties: {
          title: desc.title.length === 0 ? null : desc.title,
          author: desc.author.length === 0 ? null : desc.author,
          subject: desc.subject.length === 0 ? null : desc.subject,
          keywords: desc.keywordsText
            .split(',')
            .map((k) => k.trim())
            .filter((k) => k.length > 0),
        },
      }),
    );
  };

  const renderTabPanel = (): JSX.Element => {
    if (state.loaded === null && state.loading) {
      return <div className={styles.hint}>{t('modals:documentProperties.loading')}</div>;
    }
    if (state.loaded === null && state.lastErrorMessage !== null) {
      return (
        <div className={styles.warning}>{t('modals:documentProperties.engineUnavailable')}</div>
      );
    }
    switch (state.activeTab) {
      case 'description':
        return <DescriptionTab />;
      case 'security':
        return <SecurityTab />;
      case 'fonts':
        return (
          <div className={styles.placeholder}>
            {t('modals:documentProperties.fontsTabPlaceholder')}
          </div>
        );
      case 'custom':
        return (
          <div className={styles.placeholder}>
            {t('modals:documentProperties.customTabPlaceholder')}
          </div>
        );
      default:
        return <DescriptionTab />;
    }
  };

  return (
    <ModalShell title={t('modals:documentProperties.title')} onClose={onClose} size="lg">
      <div role="tablist" className={styles.tabs}>
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={state.activeTab === tab}
            className={`${styles.tab} ${state.activeTab === tab ? styles.tabActive : ''}`}
            onClick={() => dispatch(setDocPropertiesTab(tab))}
          >
            {t(`modals:documentProperties.tabs.${tab}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel">{renderTabPanel()}</div>

      {state.activeTab === 'description' && (
        <div className={styles.rowEnd}>
          <button
            type="button"
            className={styles.input}
            onClick={onClose}
            disabled={state.applying}
          >
            {t('modals:documentProperties.cancel')}
          </button>
          <button
            type="button"
            className={styles.input}
            onClick={onApplyDescription}
            disabled={state.applying || state.loaded === null}
          >
            {state.applying
              ? t('modals:documentProperties.applying')
              : t('modals:documentProperties.apply')}
          </button>
        </div>
      )}

      {state.activeTab !== 'description' && state.activeTab !== 'security' && (
        <div className={styles.rowEnd}>
          <button type="button" className={styles.input} onClick={onClose}>
            {t('modals:documentProperties.cancel')}
          </button>
        </div>
      )}
    </ModalShell>
  );
}
