import { useEffect, useState } from 'react';
import { CloudOff, RotateCcw } from 'lucide-react';

/**
 * Shown when the project can't be loaded because the server isn't
 * reachable. Without this the app would sit on its loading spinner forever
 * — there are no rooms to render and no way for the user to tell whether
 * it's still working or something is broken.
 */
export default function ServerUnavailable() {
  const [retrying, setRetrying] = useState(false);

  // Come back on our own the moment the server answers, so someone who
  // starts it after opening the page doesn't have to know to reload.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
        if (res.ok) window.location.reload();
      } catch {
        // Still down; the next tick will try again.
      }
    }, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="crash-screen">
      <div className="crash-card glass">
        <CloudOff size={32} color="var(--danger)" />
        <h2>Can't reach the server</h2>
        <p className="hint">
          This app keeps its rooms and inventory on a shared server so everyone sees the same data, and it can't
          load them right now. Nothing has been lost — the data is on the server, not in this browser.
        </p>
        <p className="hint">
          If you're running it yourself, make sure the server is started (<code>npm run server</code>). This page
          will reconnect on its own as soon as it's up.
        </p>
        <div className="crash-actions">
          <button
            className="btn"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              window.location.reload();
            }}
          >
            <RotateCcw size={14} /> {retrying ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      </div>
    </div>
  );
}
