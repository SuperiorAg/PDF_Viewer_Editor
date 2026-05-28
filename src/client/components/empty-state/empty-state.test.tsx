import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import { store } from '../../state/store';

import { EmptyState } from './index';

function renderWithStore(): ReturnType<typeof render> {
  return render(
    <Provider store={store}>
      <EmptyState />
    </Provider>,
  );
}

describe('EmptyState', () => {
  it('should render the "Open a PDF to get started" prompt', () => {
    renderWithStore();
    expect(screen.getByText(/Open a PDF to get started/i)).toBeInTheDocument();
  });

  it('should render the drag-and-drop hint', () => {
    renderWithStore();
    expect(screen.getByText(/or drag and drop/i)).toBeInTheDocument();
  });

  it('should expose an "Open file..." button', () => {
    renderWithStore();
    expect(screen.getByRole('button', { name: /Open file/i })).toBeInTheDocument();
  });
});
