import { nanoid } from 'nanoid';
import { useStore, type Doc } from '../store/store';
import type { LogEntry } from '../types';
import { reportError } from './errorReporting';

/** Everything pushed to/received from the server over the sync WebSocket:
 * the shared room/inventory document plus the activity log (also shared, so
 * every user's audit trail matches). Deliberately excludes `activeRoomId` —
 * which room a given browser tab has open is that tab's own business, not
 * something one user's navigation should force onto everyone else's screen —
 * and excludes `settings`/`currentUser`/`knownUsers`/`projectMeta`, which are
 * per-device/session concerns rather than shared project data. */
interface SharedDoc extends Doc {
  activityLog: LogEntry[];
}

function sharedDocFromState(): SharedDoc {
  const s = useStore.getState();
  return { rooms: s.rooms, roomOrder: s.roomOrder, tags: s.tags, checkouts: s.checkouts, activityLog: s.activityLog };
}

export type SyncStatus = 'connecting' | 'online' | 'offline';

const CLIENT_ID = nanoid(8);
const PUSH_DEBOUNCE_MS = 300;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15000;

let ws: WebSocket | null = null;
let applyingRemote = false;
let started = false;
let lastPushedRev = -1;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

let status: SyncStatus = 'connecting';
const listeners = new Set<(s: SyncStatus) => void>();

function setStatus(next: SyncStatus) {
  if (status === next) return;
  status = next;
  listeners.forEach((l) => l(next));
}

/** Subscribe to connection status changes (for a header indicator); calls
 * back immediately with the current status, then on every change. Returns
 * an unsubscribe function. */
export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

function applyRemoteDoc(doc: Partial<SharedDoc>) {
  applyingRemote = true;
  try {
    useStore.setState((s) => ({ ...doc, _rev: s._rev + 1 }));
    lastPushedRev = useStore.getState()._rev;
  } finally {
    applyingRemote = false;
  }
}

function push() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  lastPushedRev = useStore.getState()._rev;
  ws.send(JSON.stringify({ type: 'update', clientId: CLIENT_ID, doc: sharedDocFromState() }));
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(push, PUSH_DEBOUNCE_MS);
}

function connect() {
  setStatus('connecting');
  try {
    ws = new WebSocket(wsUrl());
  } catch (err) {
    reportError(err, 'sync: failed to open WebSocket');
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    reconnectDelay = RECONNECT_MIN_MS;
    setStatus('online');
  };

  ws.onclose = () => {
    setStatus('offline');
    scheduleReconnect();
  };

  ws.onerror = () => {
    // The subsequent 'close' event drives reconnection; this handler just
    // avoids an unhandled-error console spew from the socket itself.
  };

  ws.onmessage = (ev) => {
    let msg: { type?: string; doc?: Partial<SharedDoc> };
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if ((msg.type === 'init' || msg.type === 'update') && msg.doc && typeof msg.doc === 'object') {
      applyRemoteDoc(msg.doc);
    }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.6, RECONNECT_MAX_MS);
}

/**
 * Starts multi-user sync: opens the WebSocket, and from then on pushes this
 * tab's shared-doc slice to the server (debounced) whenever a persisted-
 * worthy mutation happens locally (tracked via the store's existing `_rev`
 * counter — the same signal the save-status indicator uses), while applying
 * whatever the server sends back from other tabs. Call once at app startup.
 */
export function startSync() {
  if (started) return;
  started = true;
  lastPushedRev = useStore.getState()._rev;
  connect();
  useStore.subscribe((state) => {
    if (applyingRemote) return;
    if (state._rev === lastPushedRev) return;
    schedulePush();
  });
}
