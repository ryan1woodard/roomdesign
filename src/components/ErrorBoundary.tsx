import { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes app-wide. Without this, an uncaught error
 * (e.g. from malformed room data) unmounts the whole React tree and leaves
 * a blank/black screen with no way back short of manually clearing browser
 * storage — this gives that same recovery path a button, in-app.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Uncaught render error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetAndReload = async () => {
    // Matches localforage.config({ name: 'srs-lab-designer' }) in store.ts —
    // this is the one IndexedDB database this app writes to.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('srs-lab-designer');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="crash-screen">
        <div className="crash-card glass">
          <AlertTriangle size={32} color="var(--danger)" />
          <h2>Something went wrong</h2>
          <p className="hint">
            The app hit an unexpected error and can't continue. Reloading fixes most one-off glitches — if the same
            crash keeps happening on reload, it means the saved room data itself is the problem, and resetting will
            clear it so you can get back in.
          </p>
          <p className="crash-detail">{this.state.error.message}</p>
          <div className="crash-actions">
            <button className="btn" onClick={this.handleReload}>
              <RotateCcw size={14} /> Reload
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (confirm('This clears all locally-saved rooms and inventory on this device. Continue?')) {
                  this.handleResetAndReload();
                }
              }}
            >
              <Trash2 size={14} /> Reset app data &amp; reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
