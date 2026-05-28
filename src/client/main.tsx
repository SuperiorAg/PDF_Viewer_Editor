// Vite entry point for the renderer. Mounts <App /> into #root.
//
// CSP note: the renderer's index.html mirrors the main-process CSP. pdf.js
// requires `worker-src 'self' blob:` and `img-src ... blob:` because it
// instantiates its worker from a blob URL and rasterizes pages into blob URLs.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';

import { App } from './app';
import { store } from './state/store';

import './styles/global.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('PDF_Viewer_Editor renderer: #root element missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
