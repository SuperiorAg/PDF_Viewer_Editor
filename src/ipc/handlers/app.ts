// Handlers: app:getVersion, app:quit, app:openExternal,
// app:setDefaultPdfHandler, app:getDefaultPdfHandlerStatus.
//
// app:setDefaultPdfHandler — opens the Windows Default-apps Settings page
// (ms-settings:defaultapps) so the user can confirm. Modern Windows 10/11
// gate the actual file-association flip behind the OS UI; an app cannot
// silently flip the default handler. This is the same flow Edge, Adobe
// Reader, and Chrome use. Install-time path is still handled by Diego's
// NSIS installer (electron-builder.yml) at first install. On non-Windows
// platforms (linux/mac, CI) the handler returns `not_implemented` honestly
// rather than claim a no-op success.
//
// app:getDefaultPdfHandlerStatus remains an honest `not_implemented` stub:
// reading the current default handler reliably on modern Windows would
// require the deprecated IApplicationAssociationRegistration COM API, which
// we deliberately do not depend on.

import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  AppDiagnoseOcrError,
  AppDiagnoseOcrRequest,
  AppDiagnoseOcrResponse,
  AppDiagnoseOcrValue,
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
  /**
   * Open the Windows Default-apps Settings page so the user can confirm
   * making this app the default .pdf handler. Returns true if the OS
   * accepted the shell-open call. Implementations on non-Windows platforms
   * MUST return false so the handler can surface `not_implemented` honestly.
   */
  openDefaultAppsSettings: () => Promise<boolean>;
  /**
   * David 2026-06-01: OCR runtime introspection. Returns ground-truth booleans
   * for every dep `rasterizePageProd` needs. Production wires this to
   * `diagnoseOcr()` from `ocr-bootstrap.ts`; tests inject a synthetic so the
   * handler shape can be asserted without standing up the real OCR engine.
   */
  diagnoseOcr: () => Promise<AppDiagnoseOcrValue>;
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
// File-association handlers
//
// setDefaultPdfHandler opens the Windows Default-apps Settings page (the OS
// owns the actual association flip on modern Windows). The `enable` field on
// the request is preserved for contract stability but is now MOOT — the OS
// owns the decision after we navigate the user to its UI; we ignore it.
//
// getDefaultPdfHandlerStatus remains an honest `not_implemented` stub: there
// is no reliable user-mode API to read the current default on modern Windows
// without the deprecated IApplicationAssociationRegistration COM interface.
// ----------------------------------------------------------------------------

export async function handleAppSetDefaultPdfHandler(
  _req: AppSetDefaultPdfHandlerRequest, // `enable` is intentionally ignored — the OS UI owns the decision now.
  deps: AppDeps,
): Promise<AppSetDefaultPdfHandlerResponse> {
  try {
    const opened = await deps.openDefaultAppsSettings();
    if (opened) {
      // We do not know the post-confirmation state — the user may cancel out
      // of Settings, leave it open, or confirm. Report `isNowDefault: false`
      // honestly and signal that the OS prompt was shown. The renderer can
      // use `prompt === 'shown'` to surface a "you have been redirected to
      // Windows Settings — confirm there" message.
      return ok({ isNowDefault: false, prompt: 'shown' });
    }
    return fail<AppSetDefaultPdfHandlerError>(
      'not_implemented',
      'Opening Default apps requires Windows 10/11. On this platform you must set the default in your OS settings.',
    );
  } catch (e) {
    return fail<AppSetDefaultPdfHandlerError>(
      'not_implemented',
      safeMessage(e, 'Unable to open the OS Default apps settings page.'),
    );
  }
}

export function handleAppGetDefaultPdfHandlerStatus(
  _req: AppGetDefaultPdfHandlerStatusRequest,
): AppGetDefaultPdfHandlerStatusResponse {
  return fail(
    'not_implemented',
    'Default-app status cannot be read on modern Windows; check Windows Settings -> Default apps.',
  );
}

// ----------------------------------------------------------------------------
// app:diagnoseOcr — David 2026-06-01
//
// One-shot OCR runtime probe. No UI surface yet (intentional; brief says
// "callable from devtools or future Diagnostics tile"). The handler simply
// forwards to the injected `deps.diagnoseOcr()` and wraps the result in a
// Result envelope. Any unexpected throw collapses to `diagnose_failed` with
// `safeMessage()` discipline (production never leaks the raw error string).
// ----------------------------------------------------------------------------
export async function handleAppDiagnoseOcr(
  _req: AppDiagnoseOcrRequest,
  deps: AppDeps,
): Promise<AppDiagnoseOcrResponse> {
  try {
    const snapshot = await deps.diagnoseOcr();
    return ok(snapshot);
  } catch (e) {
    return fail<AppDiagnoseOcrError>(
      'diagnose_failed',
      safeMessage(e, 'OCR diagnostic probe failed unexpectedly.'),
    );
  }
}
