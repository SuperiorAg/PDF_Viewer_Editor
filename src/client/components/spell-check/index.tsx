// Spell Check surfaces — Phase 7.5 Wave 6 (Riley).
// Mounts the settings dialog + the suggestion popup at the app level. The
// underline-render surface lives inside text-edit overlay (renderer-only
// CSS layer); it is not a component but a render hook the overlay consumes
// via `selectMisspellingsFor`.

import { SpellCheckSettingsDialog } from './settings-dialog';
import { SpellSuggestionPopup } from './suggestion-popup';

export function SpellCheck(): JSX.Element {
  return (
    <>
      <SpellCheckSettingsDialog />
      <SpellSuggestionPopup />
    </>
  );
}

export { SpellCheckSettingsDialog, SpellSuggestionPopup };
