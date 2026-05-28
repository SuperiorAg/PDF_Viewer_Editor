// Form Designer component tests.
// Per ui-spec.md §12.4.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import formsReducer, {
  setDesignerFieldType,
  setDesignerMode,
} from '../../state/slices/forms-slice';

import { FormDesignerToolbar, nextUnusedName } from './index';

function makeStore() {
  return configureStore({
    reducer: { forms: formsReducer },
  });
}

describe('FormDesignerToolbar', () => {
  it('renders nothing when designer mode is off', () => {
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <FormDesignerToolbar />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the field-type pills when designer mode is on', () => {
    const store = makeStore();
    store.dispatch(setDesignerMode(true));
    render(
      <Provider store={store}>
        <FormDesignerToolbar />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: 'Text' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checkbox' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Signature' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
  });

  it('renders the Exit button when designer mode is on', () => {
    const store = makeStore();
    store.dispatch(setDesignerMode(true));
    render(
      <Provider store={store}>
        <FormDesignerToolbar />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: /Exit/i })).toBeInTheDocument();
  });

  it('highlights the active field-type pill', () => {
    const store = makeStore();
    store.dispatch(setDesignerMode(true));
    store.dispatch(setDesignerFieldType('checkbox'));
    render(
      <Provider store={store}>
        <FormDesignerToolbar />
      </Provider>,
    );
    const checkboxBtn = screen.getByRole('button', { name: 'Checkbox' });
    // Active class name contains 'Active' substring per CSS module convention.
    expect(checkboxBtn.className).toMatch(/Active/);
  });
});

describe('nextUnusedName', () => {
  it('returns "<type>_1" when no fields exist', () => {
    expect(nextUnusedName([], 'text')).toBe('text_1');
  });

  it('finds the next free index', () => {
    expect(nextUnusedName(['text_1', 'text_2'], 'text')).toBe('text_3');
  });

  it('ignores names of different types', () => {
    expect(nextUnusedName(['text_1', 'checkbox_1', 'checkbox_2'], 'checkbox')).toBe('checkbox_3');
  });
});
