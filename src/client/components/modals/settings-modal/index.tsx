// >200 lines: SettingsModal hosts five logical tab sections (general/files/
// export/editing/about), each with its own IPC round-trips via api.settings.set,
// plus the Phase-7 General additions (language picker, telemetry toggle, update
// controls) and the About tab's live update-status area. Splitting into per-tab
// subcomponents would multiply file count without simplifying the shared form
// state. The Phase-7 groups are factored into general-tab.tsx + about-tab.tsx so
// this shell stays focused on tab orchestration.
import { useEffect, useState } from 'react';

import { useTablistKeys } from '../../../hooks/use-tablist-keys';
import { useT } from '../../../i18n/use-t';
import { api } from '../../../services/api';
import { useAppDispatch } from '../../../state/hooks';
import { closeModal, pushToast } from '../../../state/slices/ui-slice';
import { type ExportEnginePreference } from '../../../types/ipc-contract';
import { ModalShell } from '../modal-shell';
import { TelemetryDebugPanel } from '../telemetry-debug-panel';

import { AboutTab } from './about-tab';
import { GeneralTab } from './general-tab';
import styles from './settings-modal.module.css';

interface SettingsFormState {
  recentsMaxItems: number;
  maxFileSizeMB: number;
  exportEngine: ExportEnginePreference;
  showWarningsToast: boolean;
  confirmDelete: boolean;
  commitTextOnBlur: boolean;
  fileAssociationRequested: boolean;
  appVersion: string;
}

const DEFAULT_FORM: SettingsFormState = {
  recentsMaxItems: 20,
  maxFileSizeMB: 500,
  exportEngine: 'auto',
  showWarningsToast: true,
  confirmDelete: true,
  commitTextOnBlur: true,
  fileAssociationRequested: true,
  appVersion: '0.0.0',
};

type SettingsTabId = 'general' | 'files' | 'export' | 'editing' | 'about';
const SETTINGS_TABS: readonly SettingsTabId[] = ['general', 'files', 'export', 'editing', 'about'];

export function SettingsModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const [form, setForm] = useState<SettingsFormState>(DEFAULT_FORM);
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general');
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);

  // Wave 28a (a11y-audit.md R-2): proper WAI-ARIA tab pattern — horizontal
  // orientation (ArrowLeft/ArrowRight; Home/End) + roving tabindex. Labels are
  // i18n-wrapped (Wave 28b) but the tab IDS stay stable English enum values.
  const { onKeyDown, tabIndexFor } = useTablistKeys<SettingsTabId>({
    tabs: SETTINGS_TABS,
    active: activeTab,
    onActivate: setActiveTab,
    orientation: 'horizontal',
    idPrefix: 'settings-tab-id-',
  });

  useEffect(() => {
    void (async () => {
      const res = await api.settings.getAll();
      if (res.ok) {
        const entries = res.value.entries;
        setForm((curr) => ({
          ...curr,
          recentsMaxItems: entries['recents.maxItems'] ?? curr.recentsMaxItems,
          maxFileSizeMB: entries['open.maxFileSizeMB'] ?? curr.maxFileSizeMB,
          exportEngine: entries['export.defaultEngine'] ?? curr.exportEngine,
          showWarningsToast: entries['export.showWarningsToast'] ?? curr.showWarningsToast,
          confirmDelete: entries['editing.confirmDelete'] ?? curr.confirmDelete,
          commitTextOnBlur: entries['editing.commitTextOnBlur'] ?? curr.commitTextOnBlur,
          fileAssociationRequested:
            entries['file_association.pdf.requested'] ?? curr.fileAssociationRequested,
        }));
      }
      const v = await api.app.getVersion();
      if (v.ok) setForm((curr) => ({ ...curr, appVersion: v.value.appVersion }));
      // Note: we still ping getDefaultPdfHandlerStatus so the IPC surface stays
      // exercised, but the result is intentionally unused — the handler is
      // honestly not_implemented (modern Windows requires the deprecated
      // IApplicationAssociationRegistration COM API to read this reliably) and
      // we no longer surface a derived "Currently default" label that could lie.
      void api.app.getDefaultPdfHandlerStatus();
    })();
  }, []);

  const close = (): void => {
    dispatch(closeModal());
  };

  const saveField = async <K extends string, V>(
    key: K,
    value: V,
    setter: (s: SettingsFormState) => SettingsFormState,
  ): Promise<void> => {
    setForm(setter);
    // any: settings.set is generic over a const-string union; runtime payload
    // matches at the call site.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (api.settings.set as any)({ key, value });
    if (!res.ok) {
      dispatch(
        pushToast({ kind: 'error', message: t('settings:saveError', { message: res.message }) }),
      );
    }
  };

  const openDefaultHandlerSettings = async (): Promise<void> => {
    // David's IPC contract (commit 47ccb70): we cannot silently flip the .pdf
    // default on modern Windows — we open ms-settings:defaultapps and the user
    // confirms there. `enable` is preserved on the request shape for stability
    // but ignored by the handler. On ok-path the OS Settings UI was opened
    // (`prompt: 'shown'`); `isNowDefault` is always false because we genuinely
    // don't know the post-confirm state. On non-Windows / failure the handler
    // surfaces `not_implemented` honestly — we tell the user to set it manually
    // in their OS settings, never imply we "succeeded".
    const res = await api.app.setDefaultPdfHandler({ enable: true });
    if (!res.ok) {
      const msg =
        res.error === 'not_implemented'
          ? t('settings:files.notImplementedDefault')
          : res.error === 'os_denied'
            ? t('settings:files.osDenied')
            : res.error === 'unsupported_os'
              ? t('settings:files.unsupportedOs')
              : res.message;
      dispatch(pushToast({ kind: 'warning', message: msg }));
      return;
    }
    dispatch(
      pushToast({
        kind: 'success',
        message: t('settings:files.redirectedToOsDefaults'),
      }),
    );
  };

  return (
    <ModalShell
      title={t('settings:title')}
      onClose={close}
      size="lg"
      footer={
        <button type="button" className={styles.primary} onClick={close}>
          {t('common:done')}
        </button>
      }
    >
      <div
        className={styles.tabs}
        role="tablist"
        aria-label={t('settings:sectionsLabel')}
        aria-orientation="horizontal"
      >
        {SETTINGS_TABS.map((tabId) => {
          const isActive: boolean = activeTab === tabId;
          const className = `${styles.tab} ${isActive ? styles.tabActive : ''}`;
          return (
            <button
              key={tabId}
              type="button"
              role="tab"
              id={`settings-tab-id-${tabId}`}
              aria-selected={isActive}
              aria-controls={`settings-panel-${tabId}`}
              tabIndex={tabIndexFor(tabId)}
              className={className}
              onClick={() => setActiveTab(tabId)}
              onKeyDown={onKeyDown}
            >
              {t(`settings:tabs.${tabId}`)}
            </button>
          );
        })}
      </div>

      <div
        className={styles.panel}
        role="tabpanel"
        id={`settings-panel-${activeTab}`}
        aria-labelledby={`settings-tab-id-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === 'general' && (
          <GeneralTab
            recentsMaxItems={form.recentsMaxItems}
            onRecentsMaxChange={(n) =>
              void saveField('recents.maxItems', n, (s) => ({ ...s, recentsMaxItems: n }))
            }
            onConfirmCloseChange={(v) =>
              void saveField('editing.confirmDelete', v, (s) => ({ ...s, confirmDelete: v }))
            }
            confirmClose={form.confirmDelete}
            onOpenDebugPanel={() => setDebugPanelOpen(true)}
          />
        )}

        {activeTab === 'files' && (
          <>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('settings:files.maxFileSizeLabel')}</span>
              <input
                type="number"
                min={1}
                max={10000}
                value={form.maxFileSizeMB}
                onChange={(e) =>
                  void saveField('open.maxFileSizeMB', Number(e.target.value), (s) => ({
                    ...s,
                    maxFileSizeMB: Number(e.target.value),
                  }))
                }
              />
            </label>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('settings:files.associationLabel')}</span>
              {/* Honest UX (Wave 47 follow-up to commit 47ccb70): we cannot read
                  the current OS default reliably, and we cannot flip it silently
                  — modern Windows owns that flow. So we drop the toggle and the
                  derived "Currently default" status, and offer one button that
                  takes the user to ms-settings:defaultapps where the OS confirms. */}
              <p className={styles.fieldHint}>{t('settings:files.associationStatusNote')}</p>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void openDefaultHandlerSettings()}
              >
                {t('settings:files.openOsDefaultsSettings')}
              </button>
            </div>
          </>
        )}

        {activeTab === 'export' && (
          <>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('settings:export.engineLabel')}</span>
              <select
                value={form.exportEngine}
                onChange={(e) =>
                  void saveField(
                    'export.defaultEngine',
                    e.target.value as ExportEnginePreference,
                    (s) => ({ ...s, exportEngine: e.target.value as ExportEnginePreference }),
                  )
                }
              >
                <option value="auto">{t('settings:export.engineAuto')}</option>
                <option value="pdf-lib">{t('settings:export.enginePdfLib')}</option>
                <option value="chromium">{t('settings:export.engineChromium')}</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('settings:export.showWarningsLabel')}</span>
              <input
                type="checkbox"
                checked={form.showWarningsToast}
                onChange={(e) =>
                  void saveField('export.showWarningsToast', e.target.checked, (s) => ({
                    ...s,
                    showWarningsToast: e.target.checked,
                  }))
                }
              />
            </label>
          </>
        )}

        {activeTab === 'editing' && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('settings:general.confirmCloseLabel')}</span>
            <input
              type="checkbox"
              checked={form.commitTextOnBlur}
              onChange={(e) =>
                void saveField('editing.commitTextOnBlur', e.target.checked, (s) => ({
                  ...s,
                  commitTextOnBlur: e.target.checked,
                }))
              }
            />
          </label>
        )}

        {activeTab === 'about' && <AboutTab appVersion={form.appVersion} />}
      </div>

      {debugPanelOpen && <TelemetryDebugPanel onClose={() => setDebugPanelOpen(false)} />}
    </ModalShell>
  );
}
