// Handlers: app:getVersion, app:quit, app:openExternal,
// app:setDefaultPdfHandler, app:getDefaultPdfHandlerStatus.
//
// File-association handlers remain honest stubs that return 'not_implemented'.
// Install-time path is handled by Diego's NSIS installer
// (electron-builder.yml) — the registry write happens at install. The runtime
// IPC toggle (this handler) is intentionally not wired: the renderer UI in
// Settings → General surfaces the not_implemented result honestly rather than
// claiming a no-op success. Tracked in app.test.ts as the explicit contract.

import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  AppGetDefaultPdfHandlerStatusRequest,
  AppGetDefaultPdfHandlerStatusResponse,
  AppGetVersionRequest,
  AppGetVersionResponse,
  AppGetVersionValue,
  AppOpenExternalError,
  AppOpenExternalRequest,
  AppOpenExternalResponse,
  AppQuitError,
  AppQuitRequest,
  AppQuitResponse,
  AppSetDefaultPdfHandlerError,
  AppSetDefaultPdfHandlerRequest,
  AppSetDefaultPdfHandlerResponse,
} from '../contracts.js';

export interface AppDeps {
  getVersions: () => AppGetVersionValue;
  hasUnsavedChanges: () => boolean;
  requestQuit: () => void;
  showInExplorer: (handle: number) => Promise<boolean>;
  getDocumentPath: (handle: number) => string | null;
}

export function handleAppGetVersion(
  _req: AppGetVersionRequest,
  deps: AppDeps,
): AppGetVersionResponse {
  return ok(deps.getVersions());
}

export function handleAppQuit(req: AppQuitRequest, deps: AppDeps): AppQuitResponse {
  if (!req.confirmUnsaved && deps.hasUnsavedChanges()) {
    return fail<AppQuitError>('unsaved_changes', 'There are unsaved changes');
  }
  deps.requestQuit();
  return ok({});
}

export async function handleAppOpenExternal(
  req: AppOpenExternalRequest,
  deps: AppDeps,
): Promise<AppOpenExternalResponse> {
  if (req.kind !== 'show_in_explorer') {
    return fail<AppOpenExternalError>('os_failed', 'unknown kind');
  }
  const path = deps.getDocumentPath(req.handle);
  if (!path) return fail<AppOpenExternalError>('handle_not_found', 'unknown handle');
  try {
    const okFlag = await deps.showInExplorer(req.handle);
    if (!okFlag) return fail<AppOpenExternalError>('os_failed', 'shell call returned false');
    return ok({});
  } catch (e) {
    return fail<AppOpenExternalError>('os_failed', safeMessage(e, 'Unable to open in Explorer'));
  }
}

// ----------------------------------------------------------------------------
// File-association stubs (Phase 1: typed channel + not-implemented response)
// ----------------------------------------------------------------------------

// File-association honest stubs.
// Install-time path: NSIS installer (electron-builder.yml) writes
// HKCU\Software\Classes\.pdf at install.
// Runtime toggle (these handlers): not implemented — the renderer surfaces
// the honest not_implemented result rather than claim a no-op success.
export function handleAppSetDefaultPdfHandler(
  _req: AppSetDefaultPdfHandlerRequest,
): AppSetDefaultPdfHandlerResponse {
  return fail<AppSetDefaultPdfHandlerError>(
    'not_implemented',
    'Runtime .pdf association toggle is not implemented; use the installer or OS settings.',
  );
}

export function handleAppGetDefaultPdfHandlerStatus(
  _req: AppGetDefaultPdfHandlerStatusRequest,
): AppGetDefaultPdfHandlerStatusResponse {
  return fail('not_implemented', 'Runtime .pdf association status is not implemented.');
}
