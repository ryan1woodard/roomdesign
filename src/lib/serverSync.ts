import { applyOps, diffState, opKey, type EntityOp, type SharedState } from './entities';

/**
 * Keeps this browser's copy of the shared project in step with the server.
 *
 * Shape of the contract:
 *  - Local edits apply to the store immediately (the UI never waits on the
 *    network), then queue as per-entity operations in an outbox.
 *  - The outbox flushes in order. Each flush is one atomic server write.
 *  - A background poll asks for everything changed since the revision we
 *    last saw and folds it in.
 *  - An entity with an unflushed local write is skipped when remote data for
 *    it arrives, so the network can never undo something the user just did
 *    and can still see on screen.
 */

export type SyncStatus = 'starting' | 'synced' | 'syncing' | 'offline';

const POLL_INTERVAL_MS = 4000;
const FLUSH_DEBOUNCE_MS = 250;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 20000;

interface SyncHooks {
  /** Reads the current shared slice out of the store. */
  getState: () => SharedState;
  /** Folds server-sent operations into the store without re-queuing them. */
  applyRemote: (apply: (prev: SharedState) => SharedState) => void;
  /** Builds the starter project for a brand-new server. */
  buildSeed: () => SharedState;
  /** Called once the first load completes (success or failure) so the app
   *  can leave its loading screen. */
  onReady: () => void;
}

let hooks: SyncHooks | null = null;
let started = false;

let lastRev = 0;
/** Ops written locally but not yet acknowledged by the server. */
let outbox: EntityOp[] = [];
/** Entity keys with an in-flight or queued local write, by count. */
const pending = new Map<string, number>();
let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = RETRY_MIN_MS;

let status: SyncStatus = 'starting';
const listeners = new Set<(s: SyncStatus) => void>();

function setStatus(next: SyncStatus) {
  if (status === next) return;
  status = next;
  listeners.forEach((fn) => fn(next));
}

export function getSyncStatus(): SyncStatus {
  return status;
}

/** Subscribe to connection/sync status; fires immediately with the current
 *  value and returns an unsubscribe function. */
export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

function trackPending(ops: readonly EntityOp[], delta: 1 | -1) {
  for (const op of ops) {
    const key = opKey(op);
    const n = (pending.get(key) ?? 0) + delta;
    if (n <= 0) pending.delete(key);
    else pending.set(key, n);
  }
}

/** Ceiling on any single request. Without it, a server that accepts the
 *  connection but never answers would hang startup indefinitely. */
const REQUEST_TIMEOUT_MS = 8000;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

/**
 * Records a local mutation for upload. Called from the store's single
 * mutation chokepoint, so every action is covered without each one having to
 * know that a server exists.
 */
export function queueOps(ops: readonly EntityOp[]): void {
  if (!started || ops.length === 0) return;
  outbox.push(...ops);
  trackPending(ops, 1);
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), FLUSH_DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  if (flushing || outbox.length === 0) return;
  flushing = true;
  const batch = outbox;
  outbox = [];
  setStatus('syncing');

  try {
    await api<{ rev: number }>('/api/mutate', {
      method: 'POST',
      body: JSON.stringify({ ops: batch, authorId: currentAuthorId }),
    });
    // Deliberately does NOT advance `lastRev` to the revision the server
    // just assigned. Another client's write can land between our last poll
    // and this one, taking a lower revision than ours; skipping ahead to
    // our own would step over theirs and we'd never fetch it. Re-reading
    // our own write on the next poll is harmless — it's byte-identical to
    // what we already have — and it guarantees nothing is missed.
    trackPending(batch, -1);
    retryDelay = RETRY_MIN_MS;
    setStatus(outbox.length > 0 ? 'syncing' : 'synced');
    if (outbox.length > 0) scheduleFlush();
  } catch {
    // Put the batch back at the front so ordering survives a failure, and
    // leave its entities marked pending so incoming remote data can't
    // overwrite edits the user can still see.
    outbox = [...batch, ...outbox];
    setStatus('offline');
    setTimeout(() => void flush(), retryDelay);
    retryDelay = Math.min(retryDelay * 1.7, RETRY_MAX_MS);
  } finally {
    flushing = false;
  }
}

let currentAuthorId: string | null = null;
export function setSyncAuthor(id: string | null): void {
  currentAuthorId = id;
}

/** Pushes anything queued right now, bypassing the debounce (the Save button). */
export function flushNow(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  return flush();
}

/** True when local edits are still waiting to reach the server. */
export function hasPendingWrites(): boolean {
  return outbox.length > 0 || flushing;
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

async function poll(): Promise<void> {
  if (!hooks) return;
  try {
    const { rev, ops } = await api<{ rev: number; ops: EntityOp[] }>(`/api/state?since=${lastRev}`);

    // Anything the user has changed but we haven't successfully uploaded yet
    // stays as-is; the pending write is the newer truth and is about to be
    // sent. Without this, a poll landing mid-edit would visibly revert it.
    const incoming = pending.size === 0 ? ops : ops.filter((op) => !pending.has(opKey(op)));

    if (incoming.length > 0) hooks.applyRemote((prev) => applyOps(prev, incoming));
    lastRev = Math.max(lastRev, rev);
    retryDelay = RETRY_MIN_MS;
    if (status !== 'syncing' && outbox.length === 0) setStatus('synced');
  } catch {
    setStatus('offline');
  } finally {
    schedulePoll();
  }
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  const delay = status === 'offline' ? Math.min(retryDelay, RETRY_MAX_MS) : POLL_INTERVAL_MS;
  pollTimer = setTimeout(() => void poll(), delay);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * Loads the project from the server and begins syncing. On a brand-new
 * server this also plants the starter project — guarded server-side, so if
 * several people open the app at once exactly one seed takes effect.
 */
export async function startSync(h: SyncHooks): Promise<void> {
  if (started) return;
  hooks = h;
  started = true;

  try {
    const first = await api<{ rev: number; ops: EntityOp[]; empty: boolean }>('/api/state?since=0');

    if (first.empty) {
      const seed = h.buildSeed();
      const seedOps = diffState(emptyShared(seed), seed);
      const result = await api<{ seeded: boolean; rev: number }>('/api/seed', {
        method: 'POST',
        body: JSON.stringify({ ops: seedOps, authorId: currentAuthorId }),
      });
      if (result.seeded) {
        h.applyRemote(() => seed);
        lastRev = result.rev;
      } else {
        // Someone else won the race — take their project, not ours.
        const fresh = await api<{ rev: number; ops: EntityOp[] }>('/api/state?since=0');
        h.applyRemote((prev) => applyOps(prev, fresh.ops));
        lastRev = fresh.rev;
      }
    } else {
      h.applyRemote((prev) => applyOps(prev, first.ops));
      lastRev = first.rev;
    }
    setStatus('synced');
  } catch {
    // The app still mounts; the header shows Offline and the outbox holds
    // any edits until the server comes back.
    setStatus('offline');
  } finally {
    h.onReady();
    schedulePoll();
  }
}

function emptyShared(like: SharedState): SharedState {
  return {
    rooms: {},
    roomOrder: [],
    tags: {},
    checkouts: {},
    activityLog: [],
    projectMeta: like.projectMeta,
    knownUsers: [],
  };
}

/** Best-effort flush for page unload, so a final edit isn't stranded. */
export function flushBeforeUnload(): void {
  if (outbox.length === 0) return;
  try {
    navigator.sendBeacon?.(
      '/api/mutate',
      new Blob([JSON.stringify({ ops: outbox, authorId: currentAuthorId })], { type: 'application/json' }),
    );
  } catch {
    // Nothing more we can do while the page is going away.
  }
}
