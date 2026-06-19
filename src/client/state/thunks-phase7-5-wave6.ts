// Phase 7.5 Wave 6 thunks — B9 Action Wizard + B14 Spell-check + B18 Font swap.
//
// David's contracts for all three subsystems are live in `src/ipc/contracts.ts`
// and the api.ts fallback stubs (services/api.ts) reach the canonical PdfApi
// shape — no feature-detect juggling, no `as any`. The thunks call directly
// through the `api` proxy from `services/api.ts`.

import { createAsyncThunk } from '@reduxjs/toolkit';

import { ACTION_SCRIPT_SCHEMA_VERSION } from '../constants/actions';
import { api } from '../services/api';
import {
  type ActionsImportScriptRequest,
  type ActionsRunScriptRequest,
  type ActionsSaveScriptRequest,
  type DocumentHandle,
  type PdfListEmbeddedFontsRequest,
  type PdfSwapEmbeddedFontRequest,
  type SpellAddWordToDictionaryRequest,
  type SpellCheckTextRequest,
  type SpellListUserDictionaryRequest,
  type SpellRemoveWordFromDictionaryRequest,
} from '../types/ipc-contract';

import {
  closeRecordDialog,
  closeRunner,
  removeScriptLocal,
  selectRecording,
  setListError,
  setListing,
  setRunError,
  setRunning,
  setRunResults,
  setSaveError,
  setSaving,
  setScripts,
} from './slices/action-wizard-slice';
import {
  setEmbeddedFonts,
  setFontListError,
  setLoadingFonts,
  setSwapError,
  setSwapping,
  setSwapResult,
} from './slices/font-swap-slice';
import {
  cacheSpellCheck,
  setAvailableLocales,
  setLoadingLocales,
  setLoadingUserDictionary,
  setLocalesError,
  addUserDictionaryWord,
  removeUserDictionaryWord,
  setUserDictionary,
  setUserDictionaryError,
} from './slices/spell-check-slice';
import { pushToast } from './slices/ui-slice';
import { type AppDispatch, type RootState } from './store';

// ============================================================================
// B9 Action Wizard
// ============================================================================

/**
 * Save the in-progress recording. Names are required; emit a toast on empty.
 * The thunk closes the record dialog on success and refreshes the list.
 */
export const saveActionScriptThunk = createAsyncThunk<
  void,
  void,
  { state: RootState; dispatch: AppDispatch }
>('actionWizard/saveScript', async (_unused, thunkApi) => {
  const recording = selectRecording(thunkApi.getState());
  const name = recording.name.trim();
  if (name.length === 0) {
    thunkApi.dispatch(
      pushToast({
        kind: 'warning',
        message: 'Give the action a name before saving.',
      }),
    );
    return;
  }
  const req: ActionsSaveScriptRequest = {
    name,
    ops: recording.capturedOps,
    schemaVersion: ACTION_SCRIPT_SCHEMA_VERSION,
  };
  thunkApi.dispatch(setSaving(true));
  const res = await api.actions.saveScript(req);
  if (!res.ok) {
    if (res.error === 'banned_op_in_script') {
      thunkApi.dispatch(setSaveError(res.message ?? 'Banned op in script'));
      thunkApi.dispatch(
        pushToast({
          kind: 'error',
          message:
            res.message ??
            'One or more recorded operations are not safe to replay across documents and were rejected by the engine.',
        }),
      );
      return;
    }
    thunkApi.dispatch(setSaveError(res.message ?? res.error));
    thunkApi.dispatch(
      pushToast({ kind: 'error', message: res.message ?? `Save failed: ${res.error}` }),
    );
    return;
  }
  thunkApi.dispatch(setSaving(false));
  thunkApi.dispatch(closeRecordDialog());
  thunkApi.dispatch(
    pushToast({
      kind: 'success',
      message: `Saved action "${name}"`,
    }),
  );
  // Refresh list.
  await thunkApi.dispatch(listActionScriptsThunk());
});

export const listActionScriptsThunk = createAsyncThunk<
  void,
  void,
  { state: RootState; dispatch: AppDispatch }
>('actionWizard/listScripts', async (_unused, thunkApi) => {
  thunkApi.dispatch(setListing(true));
  const res = await api.actions.listScripts({});
  if (!res.ok) {
    thunkApi.dispatch(setListError(res.message ?? res.error));
    return;
  }
  thunkApi.dispatch(setScripts(res.value.scripts));
});

export const deleteActionScriptThunk = createAsyncThunk<
  void,
  string,
  { state: RootState; dispatch: AppDispatch }
>('actionWizard/deleteScript', async (id, thunkApi) => {
  const res = await api.actions.deleteScript({ id });
  if (!res.ok) {
    thunkApi.dispatch(
      pushToast({ kind: 'error', message: res.message ?? `Delete failed: ${res.error}` }),
    );
    return;
  }
  thunkApi.dispatch(removeScriptLocal(id));
  thunkApi.dispatch(pushToast({ kind: 'success', message: 'Action deleted' }));
});

export const exportActionScriptThunk = createAsyncThunk<
  void,
  string,
  { state: RootState; dispatch: AppDispatch }
>('actionWizard/exportScript', async (id, thunkApi) => {
  const res = await api.actions.exportScript({ id });
  if (!res.ok) {
    thunkApi.dispatch(
      pushToast({ kind: 'error', message: res.message ?? `Export failed: ${res.error}` }),
    );
    return;
  }
  // The renderer writes the file via the standard saveAs dialog. The engine
  // returns the serialized JSON; renderer hands it to the OS via a Blob.
  try {
    const blob = new Blob([res.value.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `action-${id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    thunkApi.dispatch(pushToast({ kind: 'success', message: 'Action exported.' }));
  } catch (e) {
    thunkApi.dispatch(
      pushToast({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Export failed to write file.',
      }),
    );
  }
});

export const importActionScriptThunk = createAsyncThunk<
  void,
  void,
  { state: RootState; dispatch: AppDispatch }
>('actionWizard/importScript', async (_unused, thunkApi) => {
  // Use a hidden <input type="file"> to pick a JSON file. We avoid the IPC
  // pickPdfFiles channel because it filters to .pdf extensions; the action
  // import is JSON. The renderer reads the file and forwards its text to
  // David's importScript channel.
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  const fileChosen = new Promise<File | null>((resolve) => {
    input.onchange = (): void => {
      const file = input.files?.[0] ?? null;
      resolve(file);
    };
    // If the user cancels, no change event fires. We rely on the user
    // clicking Import again — the input is one-shot.
  });
  input.click();
  const file = await fileChosen;
  if (!file) return;
  const json = await file.text();
  const req: ActionsImportScriptRequest = { json };
  const res = await api.actions.importScript(req);
  if (!res.ok) {
    if (res.error === 'banned_op_in_script') {
      thunkApi.dispatch(
        pushToast({
          kind: 'error',
          message:
            res.message ??
            'Imported action contains operations that are not safe to replay across documents.',
        }),
      );
      return;
    }
    if (res.error === 'invalid_json') {
      thunkApi.dispatch(pushToast({ kind: 'error', message: 'Imported file is not valid JSON.' }));
      return;
    }
    thunkApi.dispatch(
      pushToast({ kind: 'error', message: res.message ?? `Import failed: ${res.error}` }),
    );
    return;
  }
  thunkApi.dispatch(pushToast({ kind: 'success', message: `Imported action "${res.value.name}"` }));
  await thunkApi.dispatch(listActionScriptsThunk());
});

export interface RunActionScriptThunkArg {
  scriptId: string;
  /** Sanitized absolute paths chosen via dialog:pickPdfFiles. The thunk opens
   *  each via fs:readPdf to obtain a DocumentHandle. */
  targetPaths: string[];
  filenamePattern?: string;
  /** Optional raw directory path. v0.8.0 leaves this UNSET — engine writes
   *  output next to each source. See action-wizard-slice header for why
   *  pickFolder's tokenized return doesn't slot in here yet. */
  destinationFolder?: string;
}

export const runActionScriptThunk = createAsyncThunk<
  void,
  RunActionScriptThunkArg,
  { state: RootState; dispatch: AppDispatch }
>('actionWizard/runScript', async (arg, thunkApi) => {
  // The runScript contract takes DocumentHandle[]. DocumentHandle is an opaque
  // positive integer issued by main's documentStore when fs:readPdf or
  // dialog:openPdf reads a file. The runner opens each user-picked path via
  // fs:readPdf (which sanitizes + reads + registers the handle) and forwards
  // those handles to actions:runScript. Any read that fails is reported to
  // the user; the surviving handles still get the action applied.
  thunkApi.dispatch(setRunning(true));
  const handles: DocumentHandle[] = [];
  const readFailures: string[] = [];
  for (const path of arg.targetPaths) {
    const r = await api.fs.readPdf({ droppedPath: path });
    if (!r.ok) {
      readFailures.push(`${path}: ${r.message ?? r.error}`);
      continue;
    }
    handles.push(r.value.handle);
  }
  if (handles.length === 0) {
    thunkApi.dispatch(
      setRunError(
        readFailures.length > 0
          ? `Could not read any target: ${readFailures.join('; ')}`
          : 'No target files selected.',
      ),
    );
    return;
  }
  if (readFailures.length > 0) {
    thunkApi.dispatch(
      pushToast({
        kind: 'warning',
        message: `${readFailures.length} target(s) could not be read: ${readFailures.join('; ')}`,
      }),
    );
  }
  // exactOptionalPropertyTypes: only include optional fields if defined.
  const req: ActionsRunScriptRequest = {
    scriptId: arg.scriptId,
    targetHandles: handles,
    ...(arg.filenamePattern !== undefined ? { filenamePattern: arg.filenamePattern } : {}),
    ...(arg.destinationFolder !== undefined ? { destinationFolder: arg.destinationFolder } : {}),
  };
  const res = await api.actions.runScript(req);
  if (!res.ok) {
    thunkApi.dispatch(setRunError(res.message ?? res.error));
    thunkApi.dispatch(
      pushToast({ kind: 'error', message: res.message ?? `Run failed: ${res.error}` }),
    );
    return;
  }
  thunkApi.dispatch(setRunResults(res.value.results));
  const ok = res.value.results.filter((r) => r.success).length;
  const fail = res.value.results.length - ok;
  thunkApi.dispatch(
    pushToast({
      kind: fail === 0 ? 'success' : 'warning',
      message:
        fail === 0
          ? `Ran action on ${ok} file${ok === 1 ? '' : 's'}.`
          : `Ran action: ${ok} succeeded, ${fail} failed.`,
    }),
  );
  if (fail === 0) {
    // Close the runner so the user sees the success state from the toast.
    thunkApi.dispatch(closeRunner());
  }
});

// ============================================================================
// B14 Spell-check
// ============================================================================

export const listSpellLocalesThunk = createAsyncThunk<
  void,
  void,
  { state: RootState; dispatch: AppDispatch }
>('spellCheck/listLocales', async (_unused, thunkApi) => {
  thunkApi.dispatch(setLoadingLocales(true));
  const res = await api.spell.listLocales({});
  if (!res.ok) {
    thunkApi.dispatch(setLocalesError(res.message ?? res.error));
    return;
  }
  thunkApi.dispatch(setAvailableLocales(res.value.locales));
});

export interface CheckSpellTextThunkArg {
  pageIndex: number;
  objectId: string;
  locale: string;
  text: string;
}

export const checkSpellTextThunk = createAsyncThunk<
  void,
  CheckSpellTextThunkArg,
  { state: RootState; dispatch: AppDispatch }
>('spellCheck/checkText', async (arg, thunkApi) => {
  const req: SpellCheckTextRequest = { locale: arg.locale, text: arg.text };
  const res = await api.spell.checkText(req);
  if (!res.ok) {
    // Silent on failure for the underline path — the popup surface shows the
    // last error via a separate selector if we ever wire one. v0.8.0 stays
    // honest by simply not rendering underlines on engine error.
    return;
  }
  thunkApi.dispatch(
    cacheSpellCheck({
      pageIndex: arg.pageIndex,
      objectId: arg.objectId,
      text: arg.text,
      misspellings: res.value.misspellings,
    }),
  );
});

export const listUserDictionaryThunk = createAsyncThunk<
  void,
  string,
  { state: RootState; dispatch: AppDispatch }
>('spellCheck/listUserDictionary', async (locale, thunkApi) => {
  thunkApi.dispatch(setLoadingUserDictionary(true));
  const req: SpellListUserDictionaryRequest = { locale };
  const res = await api.spell.listUserDictionary(req);
  if (!res.ok) {
    thunkApi.dispatch(setUserDictionaryError(res.message ?? res.error));
    return;
  }
  thunkApi.dispatch(setUserDictionary({ locale, words: res.value.words }));
});

export const addUserDictionaryWordThunk = createAsyncThunk<
  void,
  { locale: string; word: string },
  { state: RootState; dispatch: AppDispatch }
>('spellCheck/addWord', async (arg, thunkApi) => {
  const req: SpellAddWordToDictionaryRequest = arg;
  const res = await api.spell.addWordToDictionary(req);
  if (!res.ok) {
    thunkApi.dispatch(
      pushToast({ kind: 'error', message: res.message ?? `Add failed: ${res.error}` }),
    );
    return;
  }
  // Update local mirror (idempotent — slice dedups).
  thunkApi.dispatch(addUserDictionaryWord(arg));
  thunkApi.dispatch(
    pushToast({
      kind: 'success',
      message: res.value.added ? `Added "${arg.word}" to dictionary` : 'Already in dictionary',
    }),
  );
});

export const removeUserDictionaryWordThunk = createAsyncThunk<
  void,
  { locale: string; word: string },
  { state: RootState; dispatch: AppDispatch }
>('spellCheck/removeWord', async (arg, thunkApi) => {
  const req: SpellRemoveWordFromDictionaryRequest = arg;
  const res = await api.spell.removeWordFromDictionary(req);
  if (!res.ok) {
    thunkApi.dispatch(
      pushToast({ kind: 'error', message: res.message ?? `Remove failed: ${res.error}` }),
    );
    return;
  }
  thunkApi.dispatch(removeUserDictionaryWord(arg));
});

// ============================================================================
// B18 Font swap
// ============================================================================

export const listEmbeddedFontsThunk = createAsyncThunk<
  void,
  DocumentHandle,
  { state: RootState; dispatch: AppDispatch }
>('fontSwap/listEmbeddedFonts', async (handle, thunkApi) => {
  thunkApi.dispatch(setLoadingFonts(true));
  const req: PdfListEmbeddedFontsRequest = { handle };
  const res = await api.pdf.listEmbeddedFonts(req);
  if (!res.ok) {
    thunkApi.dispatch(setFontListError(res.message ?? res.error));
    return;
  }
  thunkApi.dispatch(setEmbeddedFonts(res.value.fonts));
});

export interface SwapEmbeddedFontThunkArg {
  handle: DocumentHandle;
  fromFontName: string;
  toFontName: PdfSwapEmbeddedFontRequest['toFontName'];
}

export const swapEmbeddedFontThunk = createAsyncThunk<
  void,
  SwapEmbeddedFontThunkArg,
  { state: RootState; dispatch: AppDispatch }
>('fontSwap/swap', async (arg, thunkApi) => {
  thunkApi.dispatch(setSwapping(true));
  const req: PdfSwapEmbeddedFontRequest = {
    handle: arg.handle,
    fromFontName: arg.fromFontName,
    toFontName: arg.toFontName,
  };
  const res = await api.pdf.swapEmbeddedFont(req);
  if (!res.ok) {
    thunkApi.dispatch(setSwapError(res.message ?? res.error));
    thunkApi.dispatch(
      pushToast({ kind: 'error', message: res.message ?? `Swap failed: ${res.error}` }),
    );
    return;
  }
  thunkApi.dispatch(setSwapResult(res.value));
  thunkApi.dispatch(
    pushToast({
      kind: 'success',
      message: `Replaced ${res.value.fontsRewritten} font ${
        res.value.fontsRewritten === 1 ? 'reference' : 'references'
      }.`,
    }),
  );
});
