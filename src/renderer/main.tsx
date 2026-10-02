// PixiJS uses eval-based code paths for performance by default. This module
// swaps them for CSP-safe polyfills and MUST be imported before Pixi
// initializes — our CSP (strict in production) blocks unsafe-eval.
import 'pixi.js/unsafe-eval';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found in index.html');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
