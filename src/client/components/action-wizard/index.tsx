// Action Wizard — Phase 7.5 Wave 6 (Riley).
// Mounts three modals (record, saved list, runner). Each renders null when
// its slice flag is off, so this component is cheap to mount at the top of
// the app tree alongside other modal hosts.

import { ActionWizardRecordDialog } from './record-dialog';
import { ActionWizardRunnerPanel } from './runner-panel';
import { SavedActionsList } from './saved-actions-list';

export function ActionWizard(): JSX.Element {
  return (
    <>
      <SavedActionsList />
      <ActionWizardRecordDialog />
      <ActionWizardRunnerPanel />
    </>
  );
}

export { ActionWizardRecordDialog, ActionWizardRunnerPanel, SavedActionsList };
