import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { installGlobalErrorReporting } from './lib/errorReporting';
import { startSync } from './lib/sync';
import './index.css';

installGlobalErrorReporting();
startSync();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
