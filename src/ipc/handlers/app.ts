// Handlers: app:getVersion, app:quit, app:openExternal,
// app:setDefaultPdfHandler, app:getDefaultPdfHandlerStatus.
//
// File-association handlers are Phase 1 stubs that return 'not_implemented'
// with the correct shape. Full implementation lands before Wave 3 packaging
// (see CLAUDE.md Wave 2 brief — Diego's installer covers the install-time
// path; David's runtime path is the IPC toggle).

import { fail, ok } from '../../shared/result.js';
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
    return fail<AppOpenExternalError>('os_failed', (e as Error).message);
  }
}

// ----------------------------------------------------------------------------
// File-association stubs (Phase 1: typed channel + not-implemented response)
// ----------------------------------------------------------------------------

export function handleAppSetDefaultPdfHandler(
  _req: AppSetDefaultPdfHandlerRequest,
): AppSetDefaultPdfHandlerResponse {
  return fail<AppSetDefaultPdfHandlerError>(
    'not_implemented',
    'Phase 1 stub: runtime .pdf association toggle lands before Wave 3 packaging',
  );
}

export function handleAppGetDefaultPdfHandlerStatus(
  _req: AppGetDefaultPdfHandlerStatusRequest,
): AppGetDefaultPdfHandlerStatusResponse {
  return fail('not_implemented', 'Phase 1 stub');
}
