import { useStore } from '../store/store';

/**
 * Reports a client-side error to the server's System Log (see
 * server/index.js's `/api/log` and the SystemLogViewer component) so
 * problems on one person's machine are visible to whoever's watching the
 * shared server, not just lost in that one browser's console. Best-effort:
 * failures here are swallowed rather than thrown, since error reporting must
 * never itself become a source of crashes.
 */
export function reportError(error: unknown, context?: string, level: 'error' | 'warn' = 'error'): void {
  const message = context ? `${context}: ${errorMessage(error)}` : errorMessage(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(message, error);

  let userName: string | undefined;
  try {
    userName = useStore.getState().currentUser?.name;
  } catch {
    // Store not ready yet (very early startup) — omit rather than fail.
  }

  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, message, stack, userName }),
  }).catch(() => {
    // No server reachable (offline, or running the static build without the
    // Node server) — the error is already in the browser console; nothing
    // more useful to do here.
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Catches errors React's own render/lifecycle boundary can't see: thrown
 * inside plain event handlers, timers, or promise chains anywhere in the
 * app. Call once at startup. */
export function installGlobalErrorReporting(): void {
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, 'Uncaught error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, 'Unhandled promise rejection');
  });
}
