import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../../../packages/ui/src/tokens.css';
import { App } from './App.js';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
