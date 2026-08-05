import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { useStore, initSync } from './store/store';
import './index.css';

// Load the shared project from the server before the app renders. Local
// preferences rehydrate from IndexedDB first so a returning user's saved
// camera position is available by the time rooms arrive.
if (useStore.persist?.hasHydrated?.()) initSync();
else useStore.persist?.onFinishHydration?.(() => initSync());

// The canvas renders to <canvas>, so end-to-end tests have no DOM text to
// assert against; this gives them a handle on the real state instead.
if (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_STORE === '1') {
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
