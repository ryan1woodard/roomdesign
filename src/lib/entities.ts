import type { Room, Tag, Checkout, LogEntry, ProjectMeta, User } from '../types';

/**
 * The shared document, decomposed into independently-addressable entities.
 *
 * This is the unit of concurrency for the whole app: two people editing
 * different entities never conflict, because each mutation is sent to (and
 * stored by) the server as its own row rather than as part of one big
 * document blob. Only edits to the *same* entity can collide, and there the
 * later write wins — which is the behaviour people actually expect when two
 * users type into the same field.
 */
export type EntityKind =
  | 'room'
  | 'object'
  | 'item'
  | 'vertex'
  | 'wall'
  | 'opening'
  | 'tag'
  | 'checkout'
  | 'log'
  | 'meta'
  | 'user';

/** Entities that live inside a room; the rest are project-global. */
const ROOM_SCOPED: readonly EntityKind[] = ['object', 'item', 'vertex', 'wall', 'opening'];

export interface EntityOp {
  kind: EntityKind;
  id: string;
  /** Owning room for room-scoped kinds; null/undefined for global ones. */
  roomId?: string | null;
  /** The entity's new value. Absent when `deleted` is true. */
  data?: unknown;
  deleted?: boolean;
}

/** The fixed id of the singleton `meta` entity (room ordering + project info). */
export const META_ID = 'main';

/**
 * A room's own fields, minus the five big collections (which are separate
 * entities) and minus the two per-viewer fields.
 *
 * `camera` and `activeLayerId` are deliberately NOT shared. They describe
 * where a given person is looking and what they're editing, not what the
 * project contains — syncing them would mean one user panning or switching
 * to the Walls layer would yank every other user's screen along with them.
 * They're persisted per-device instead (see the store's local prefs).
 */
export type RoomEntity = Omit<Room, 'objects' | 'items' | 'vertices' | 'walls' | 'openings' | 'camera' | 'activeLayerId'>;

export interface MetaEntity {
  roomOrder: string[];
  projectMeta: ProjectMeta;
}

/** The slice of app state that is shared across every user of the server. */
export interface SharedState {
  rooms: Record<string, Room>;
  roomOrder: string[];
  tags: Record<string, Tag>;
  checkouts: Record<string, Checkout>;
  activityLog: LogEntry[];
  projectMeta: ProjectMeta;
  knownUsers: User[];
}

export function roomEntityOf(room: Room): RoomEntity {
  const { objects: _o, items: _i, vertices: _v, walls: _w, openings: _op, camera: _c, activeLayerId: _a, ...rest } = room;
  return rest;
}

// ---------------------------------------------------------------------------
// Diffing: state → ops
// ---------------------------------------------------------------------------

/**
 * Compares two record maps by *reference*, which is exact here because every
 * store mutation builds new objects immutably — an untouched entity keeps
 * its identity, so this reliably yields "only what this action actually
 * changed" without deep-comparing the whole document on every keystroke.
 */
function diffRecords<T>(
  kind: EntityKind,
  roomId: string | null,
  prev: Record<string, T> | undefined,
  next: Record<string, T> | undefined,
  out: EntityOp[],
): void {
  const before = prev ?? {};
  const after = next ?? {};
  if (before === after) return;

  for (const id of Object.keys(after)) {
    if (before[id] !== after[id]) out.push({ kind, id, roomId, data: after[id] });
  }
  for (const id of Object.keys(before)) {
    if (!(id in after)) out.push({ kind, id, roomId, deleted: true });
  }
}

function diffById<T extends { id: string }>(
  kind: EntityKind,
  prev: readonly T[],
  next: readonly T[],
  out: EntityOp[],
): void {
  if (prev === next) return;
  const before = new Map(prev.map((e) => [e.id, e]));
  const after = new Map(next.map((e) => [e.id, e]));
  for (const [id, entry] of after) {
    if (before.get(id) !== entry) out.push({ kind, id, roomId: null, data: entry });
  }
  for (const id of before.keys()) {
    if (!after.has(id)) out.push({ kind, id, roomId: null, deleted: true });
  }
}

/** Everything that changed between two states, as per-entity operations. */
export function diffState(prev: SharedState, next: SharedState): EntityOp[] {
  const ops: EntityOp[] = [];

  for (const roomId of Object.keys(next.rooms)) {
    const before = prev.rooms[roomId];
    const after = next.rooms[roomId];
    if (before === after) continue;

    const beforeEntity = before ? roomEntityOf(before) : null;
    const afterEntity = roomEntityOf(after);
    if (!beforeEntity || !shallowEqualRoom(beforeEntity, afterEntity)) {
      ops.push({ kind: 'room', id: roomId, roomId: null, data: afterEntity });
    }

    diffRecords('object', roomId, before?.objects, after.objects, ops);
    diffRecords('item', roomId, before?.items, after.items, ops);
    diffRecords('vertex', roomId, before?.vertices, after.vertices, ops);
    diffRecords('wall', roomId, before?.walls, after.walls, ops);
    diffRecords('opening', roomId, before?.openings, after.openings, ops);
  }

  // A deleted room takes all of its contents with it. The server cascades on
  // its side too, but emitting the child tombstones keeps other clients from
  // holding onto orphans until their next full refresh.
  for (const roomId of Object.keys(prev.rooms)) {
    if (roomId in next.rooms) continue;
    const gone = prev.rooms[roomId];
    ops.push({ kind: 'room', id: roomId, roomId: null, deleted: true });
    for (const id of Object.keys(gone.objects)) ops.push({ kind: 'object', id, roomId, deleted: true });
    for (const id of Object.keys(gone.items)) ops.push({ kind: 'item', id, roomId, deleted: true });
    for (const id of Object.keys(gone.vertices)) ops.push({ kind: 'vertex', id, roomId, deleted: true });
    for (const id of Object.keys(gone.walls)) ops.push({ kind: 'wall', id, roomId, deleted: true });
    for (const id of Object.keys(gone.openings)) ops.push({ kind: 'opening', id, roomId, deleted: true });
  }

  diffRecords('tag', null, prev.tags, next.tags, ops);
  diffRecords('checkout', null, prev.checkouts, next.checkouts, ops);
  diffById('log', prev.activityLog, next.activityLog, ops);
  diffById('user', prev.knownUsers, next.knownUsers, ops);

  if (prev.roomOrder !== next.roomOrder || prev.projectMeta !== next.projectMeta) {
    const meta: MetaEntity = { roomOrder: next.roomOrder, projectMeta: next.projectMeta };
    ops.push({ kind: 'meta', id: META_ID, roomId: null, data: meta });
  }

  return ops;
}

/** Room entities are flat enough that a one-level compare avoids re-sending
 * a room on every unrelated child edit (walls rewrite `floors`, etc.). */
function shallowEqualRoom(a: RoomEntity, b: RoomEntity): boolean {
  const keys = Object.keys(b) as (keyof RoomEntity)[];
  if (keys.length !== Object.keys(a).length) return false;
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/** The entire shared state as ops — used to seed an empty server. */
export function stateToOps(state: SharedState): EntityOp[] {
  const empty: SharedState = {
    rooms: {},
    roomOrder: [],
    tags: {},
    checkouts: {},
    activityLog: [],
    projectMeta: state.projectMeta,
    knownUsers: [],
  };
  const ops = diffState(empty, state);
  // diffState only emits `meta` when it changed by reference; for a full
  // seed we always want it present.
  if (!ops.some((o) => o.kind === 'meta')) {
    ops.push({ kind: 'meta', id: META_ID, roomId: null, data: { roomOrder: state.roomOrder, projectMeta: state.projectMeta } });
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Applying: ops → state
// ---------------------------------------------------------------------------

/** A room shell for entities that arrive before (or without) their room row. */
function placeholderRoom(id: string): Room {
  return {
    id,
    name: 'Room',
    order: 0,
    objects: {},
    items: {},
    layers: [],
    activeLayerId: '',
    vertices: {},
    walls: {},
    openings: {},
    floors: [],
    floorColor: '#20293a',
    floorOpacity: 1,
    camera: { x: 0, y: 0, scale: 1 },
  };
}

const ROOM_COLLECTION: Record<string, keyof Pick<Room, 'objects' | 'items' | 'vertices' | 'walls' | 'openings'>> = {
  object: 'objects',
  item: 'items',
  vertex: 'vertices',
  wall: 'walls',
  opening: 'openings',
};

/**
 * Folds a batch of remote operations into local state, preserving this
 * device's own view fields (camera, active layer) on any room the batch
 * touches. Returns a new state object; untouched branches keep their
 * identity so React re-renders stay narrow.
 */
export function applyOps(state: SharedState, ops: readonly EntityOp[]): SharedState {
  if (ops.length === 0) return state;

  const rooms: Record<string, Room> = { ...state.rooms };
  let tags = state.tags;
  let checkouts = state.checkouts;
  let roomOrder = state.roomOrder;
  let projectMeta = state.projectMeta;
  const logById = new Map(state.activityLog.map((e) => [e.id, e]));
  const usersById = new Map(state.knownUsers.map((u) => [u.id, u]));
  let logChanged = false;
  let usersChanged = false;

  for (const op of ops) {
    switch (op.kind) {
      case 'room': {
        if (op.deleted) {
          delete rooms[op.id];
          break;
        }
        const incoming = op.data as RoomEntity;
        const existing = rooms[op.id] ?? placeholderRoom(op.id);
        rooms[op.id] = {
          ...existing,
          ...incoming,
          // Never let a remote room overwrite where this person is looking.
          camera: existing.camera,
          activeLayerId: existing.activeLayerId,
        };
        break;
      }
      case 'object':
      case 'item':
      case 'vertex':
      case 'wall':
      case 'opening': {
        const roomId = op.roomId;
        if (!roomId) break;
        const collection = ROOM_COLLECTION[op.kind];
        const room = rooms[roomId] ?? placeholderRoom(roomId);
        const next = { ...(room[collection] as Record<string, unknown>) };
        if (op.deleted) delete next[op.id];
        else next[op.id] = op.data;
        rooms[roomId] = { ...room, [collection]: next } as Room;
        break;
      }
      case 'tag': {
        const next = { ...tags };
        if (op.deleted) delete next[op.id];
        else next[op.id] = op.data as Tag;
        tags = next;
        break;
      }
      case 'checkout': {
        const next = { ...checkouts };
        if (op.deleted) delete next[op.id];
        else next[op.id] = op.data as Checkout;
        checkouts = next;
        break;
      }
      case 'log': {
        if (op.deleted) logById.delete(op.id);
        else logById.set(op.id, op.data as LogEntry);
        logChanged = true;
        break;
      }
      case 'user': {
        if (op.deleted) usersById.delete(op.id);
        else usersById.set(op.id, op.data as User);
        usersChanged = true;
        break;
      }
      case 'meta': {
        const meta = op.data as MetaEntity;
        if (meta?.roomOrder) roomOrder = meta.roomOrder;
        if (meta?.projectMeta) projectMeta = meta.projectMeta;
        break;
      }
    }
  }

  // Room order can legitimately lag behind room creation (two separate ops);
  // make sure every room we know about is reachable in the navigator.
  const known = new Set(roomOrder);
  const missing = Object.keys(rooms).filter((id) => !known.has(id));
  if (missing.length) {
    missing.sort((a, b) => (rooms[a].order ?? 0) - (rooms[b].order ?? 0));
    roomOrder = [...roomOrder.filter((id) => id in rooms), ...missing];
  } else if (roomOrder.some((id) => !(id in rooms))) {
    roomOrder = roomOrder.filter((id) => id in rooms);
  }

  return {
    rooms,
    roomOrder,
    tags,
    checkouts,
    projectMeta,
    activityLog: logChanged
      ? [...logById.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 500)
      : state.activityLog,
    knownUsers: usersChanged ? [...usersById.values()] : state.knownUsers,
  };
}

/** Stable key for an entity, used to match pending local writes against
 * incoming remote ones. */
export function opKey(op: EntityOp): string {
  return ROOM_SCOPED.includes(op.kind) ? `${op.kind}:${op.roomId}:${op.id}` : `${op.kind}:${op.id}`;
}
