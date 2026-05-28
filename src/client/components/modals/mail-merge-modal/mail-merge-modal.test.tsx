// MailMergeModal component tests.
// Per ui-spec.md §12.6.

import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument } from '../../../state/slices/document-slice';
import formsReducer, { setDetected } from '../../../state/slices/forms-slice';
import formsTemplatesReducer from '../../../state/slices/forms-templates-slice';
import mailMergeReducer, {
  openWizard,
  setColumnMapping,
  setDataPreview,
  setFlattenInOutput,
  setStep,
} from '../../../state/slices/mail-merge-slice';
import uiReducer from '../../../state/slices/ui-slice';
import { type FormFieldDefinition, type PDFDocumentModel } from '../../../types/ipc-contract';

import { MailMergeModal } from './index';

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'h',
  pageCount: 1,
  pages: [
    {
      pageIndex: 0,
      sourcePageRef: { kind: 'original', originalIndex: 0 },
      rotation: 0,
      width: 612,
      height: 792,
    },
  ],
  annotations: [],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

const F: FormFieldDefinition = {
  name: 'first_name',
  type: 'text',
  pageIndex: 0,
  rect: { x: 0, y: 0, width: 100, height: 24 },
  label: 'First Name',
  required: true,
  origin: 'detected',
  unsaved: false,
};

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      forms: formsReducer,
      formsTemplates: formsTemplatesReducer,
      mailMerge: mailMergeReducer,
      ui: uiReducer,
    },
    middleware: (gdm) =>
      gdm({
        serializableCheck: {
          ignoredActionPaths: ['payload.bytes', 'payload.data.bytes'],
          ignoredPaths: ['mailMerge.data.bytes'],
        },
      }),
  });
}

describe('MailMergeModal', () => {
  it('renders the step indicator and Step 1 (Template) by default', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [F],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    store.dispatch(openWizard());
    render(
      <Provider store={store}>
        <MailMergeModal />
      </Provider>,
    );
    expect(screen.getByText(/Choose a template/i)).toBeInTheDocument();
    expect(screen.getByText(/Use currently open document/)).toBeInTheDocument();
    expect(screen.getByText('1. Template')).toBeInTheDocument();
  });

  it('Step 3 (Mapping) shows a required-field error if mapping is empty', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [F], // required: true
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    store.dispatch(openWizard());
    store.dispatch(
      setDataPreview({
        fileName: 'contacts.csv',
        fileKind: 'csv',
        bytes: new Uint8Array(0),
        headers: ['Name'], // not 'first_name' → no auto-detect
        previewRows: [],
        totalRowCount: 0,
        warnings: [],
      }),
    );
    store.dispatch(setStep('mapping'));
    render(
      <Provider store={store}>
        <MailMergeModal />
      </Provider>,
    );
    expect(screen.getByText(/Required field/i)).toBeInTheDocument();
    expect(screen.getByText(/unmapped/i)).toBeInTheDocument();
    // Next button disabled.
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    expect(nextBtn).toBeDisabled();
  });

  it('Step 3 (Mapping) auto-detects when column-name matches field-name', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [F],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    store.dispatch(openWizard());
    store.dispatch(
      setDataPreview({
        fileName: 'contacts.csv',
        fileKind: 'csv',
        bytes: new Uint8Array(0),
        headers: ['first_name'], // exact match (case-insensitive)
        previewRows: [],
        totalRowCount: 0,
        warnings: [],
      }),
    );
    store.dispatch(setStep('mapping'));
    render(
      <Provider store={store}>
        <MailMergeModal />
      </Provider>,
    );
    // Auto-detect should populate mapping; Next button enabled.
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    expect(nextBtn).not.toBeDisabled();
  });

  it('Step 4 (Output) shows the flatten checkbox', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [F],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    store.dispatch(openWizard());
    store.dispatch(setStep('output'));
    render(
      <Provider store={store}>
        <MailMergeModal />
      </Provider>,
    );
    expect(screen.getByText(/Flatten forms in output/)).toBeInTheDocument();
    expect(screen.getByText(/Folder of N PDFs/)).toBeInTheDocument();
    expect(screen.getByText(/Single concatenated PDF/)).toBeInTheDocument();
  });

  it('shows a Cancel button on the running step', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(openWizard());
    store.dispatch(setStep('running'));
    render(
      <Provider store={store}>
        <MailMergeModal />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    expect(screen.getByText(/Running/i)).toBeInTheDocument();
  });

  it('Back button is disabled on step 1', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(openWizard());
    render(
      <Provider store={store}>
        <MailMergeModal />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: /Back/i })).toBeDisabled();
  });

  it('clicking Next advances template -> data', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(openWizard());
    render(
      <Provider store={store}>
        <MailMergeModal />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    expect(store.getState().mailMerge.step).toBe('data');
  });

  // Wave 13.5 H-3.2 regression: the modal must thread the slice's
  // `flattenInOutput` value onto MailMergeJob.flattenForms when dispatching
  // the run. Prior behaviour `void`-discarded the flag at the dispatch site
  // (see learnings.jsonl 2026-05-22T15:00:00Z Phase 3 takeaway #4).
  describe('Run merge dispatch (H-3.2)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function setupReadyToRunStore(flatten: boolean) {
      const store = makeStore();
      store.dispatch(setDocument(DOC));
      store.dispatch(
        setDetected({
          fields: [F],
          hasAcroForm: true,
          hasXfaForm: false,
          hasJavaScriptActions: false,
          warnings: [],
        }),
      );
      store.dispatch(openWizard());
      store.dispatch(
        setDataPreview({
          fileName: 'contacts.csv',
          fileKind: 'csv',
          bytes: new Uint8Array([0x61, 0x2c, 0x62]),
          headers: ['first_name'],
          previewRows: [{ first_name: 'Ada' }],
          totalRowCount: 1,
          warnings: [],
        }),
      );
      store.dispatch(setColumnMapping({ first_name: 'first_name' }));
      store.dispatch(setFlattenInOutput(flatten));
      // Output step requires an output target to enable Run.
      store.dispatch(setStep('output'));
      return store;
    }

    function makeRunMailMergeSpy() {
      const runMailMerge = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          rowsWritten: 1,
          totalRows: 1,
          outputPath: '/tmp/out.pdf',
          wasCancelled: false,
          warnings: [],
        },
      });
      // Minimal pdfApi shim — only what runMailMergeThunk touches before the
      // promise settles. forms.runMailMerge is the spy; events.onMailMergeProgress
      // returns a no-op unsubscribe.
      vi.stubGlobal('pdfApi', {
        forms: {
          runMailMerge,
        },
        events: {
          onMailMergeProgress: () => () => undefined,
        },
      });
      return runMailMerge;
    }

    it('threads flattenInOutput=true onto MailMergeJob.flattenForms in the IPC call', async () => {
      const store = setupReadyToRunStore(true);
      const runMailMerge = makeRunMailMergeSpy();

      render(
        <Provider store={store}>
          <MailMergeModal />
        </Provider>,
      );

      // Set a valid concat output so the Run button enables.
      const concatRadio = screen.getByLabelText(/Single concatenated PDF/i);
      fireEvent.click(concatRadio);
      const outputFileInput = screen.getByPlaceholderText(/Output file path/i);
      fireEvent.change(outputFileInput, { target: { value: '/tmp/out.pdf' } });

      const runBtn = screen.getByRole('button', { name: /Run merge/i });
      // Wrap the click in act() — the run thunk fires post-dispatch reducer
      // updates (runStarted -> runCompleted -> pushToast) that the test
      // doesn't directly assert on; act() flushes them quietly.
      await act(async () => {
        fireEvent.click(runBtn);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(runMailMerge).toHaveBeenCalledTimes(1);
      const callArg = runMailMerge.mock.calls[0]?.[0] as {
        job: { flattenForms?: boolean };
      };
      expect(callArg.job.flattenForms).toBe(true);
    });

    it('threads flattenInOutput=false onto MailMergeJob.flattenForms in the IPC call', async () => {
      const store = setupReadyToRunStore(false);
      const runMailMerge = makeRunMailMergeSpy();

      render(
        <Provider store={store}>
          <MailMergeModal />
        </Provider>,
      );

      const concatRadio = screen.getByLabelText(/Single concatenated PDF/i);
      fireEvent.click(concatRadio);
      const outputFileInput = screen.getByPlaceholderText(/Output file path/i);
      fireEvent.change(outputFileInput, { target: { value: '/tmp/out.pdf' } });

      const runBtn = screen.getByRole('button', { name: /Run merge/i });
      await act(async () => {
        fireEvent.click(runBtn);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(runMailMerge).toHaveBeenCalledTimes(1);
      const callArg = runMailMerge.mock.calls[0]?.[0] as {
        job: { flattenForms?: boolean };
      };
      expect(callArg.job.flattenForms).toBe(false);
    });
  });
});
