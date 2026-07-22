import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import localforage from 'localforage';
import { nanoid } from 'nanoid';
import type {
  RoomObject,
  Item,
  Tag,
  Layer,
  Settings,
  Storage,
  LocationRef,
  ObjectKind,
  SortMode,
  Room,
  WallSegment,
  WallOpening,
  CameraState,
  User,
  LogEntry,
  LogScope,
  LogAction,
  SaveStatus,
  ProjectMeta,
  AppMode,
} from '../types';
import { buildDemo } from './demo';
import {
  makeVertex,
  makeWall,
  computeWallCandidate,
  computeFloors,
  splitWall as libSplitWall,
  canMergeAt,
  mergeWalls as libMergeWalls,
  wallVector,
} from '../lib/walls';
import { cellName } from '../lib/shelf';

localforage.config({ name: 'srs-lab-designer', storeName: 'state' });

/**
 * Save-status bookkeeping deliberately lives in its own tiny store, NOT in
 * the persisted `useStore`. Zustand's `persist` middleware re-triggers a
 * storage write on every single `setState` call (it doesn't diff), so if
 * status updates went through `useStore.setState` they'd immediately
 * re-trigger persist's own write, which flips status again, which
 * re-triggers persist again — an infinite loop that pegs the main thread.
 * A separate, unwrapped store can't feed back into persist's write cycle.
 */
export const useSaveStore = create<{
  saveStatus: SaveStatus;
  saveError: string | null;
  lastSavedAt: number | null;
}>(() => ({
  saveStatus: 'saved',
  saveError: null,
  lastSavedAt: null,
}));

const lfStorage = {
  getItem: async (name: string) => (await localforage.getItem<string>(name)) ?? null,
  setItem: async (name: string, value: string) => {
    useSaveStore.setState({ saveStatus: 'saving' });
    try {
      await localforage.setItem(name, value);
      useSaveStore.setState({ saveStatus: 'saved', lastSavedAt: Date.now(), saveError: null });
    } catch (err) {
      useSaveStore.setState({ saveStatus: 'error', saveError: err instanceof Error ? err.message : String(err) });
    }
  },
  removeItem: async (name: string) => {
    await localforage.removeItem(name);
  },
};

interface Doc {
  rooms: Record<string, Room>;
  roomOrder: string[];
  tags: Record<string, Tag>;
}

/**
 * Everything written to durable storage (the main IndexedDB key and every
 * recovery snapshot). Kept as one named shape so both write sites and the
 * restore path can't silently drift apart from each other.
 */
interface PersistedState extends Doc {
  activeRoomId: string;
  settings: Settings;
  currentUser: User | null;
  knownUsers: User[];
  projectMeta: ProjectMeta;
  activityLog: LogEntry[];
}

export type WallTool = 'select' | 'draw' | 'door' | 'window';
export type WallEntitySelection = { type: 'wall' | 'vertex' | 'opening'; id: string } | null;

/** Design-mode object interaction tool. 'select' shows resize handles only;
 * 'move'/'rotate' swap in the dedicated precision gizmo (drag for a live
 * readout, or type an exact amount); 'freeMove' restores plain drag-to-move
 * on the object body (plus resize handles), for quick freehand placement. */
export type ObjectTool = 'select' | 'move' | 'rotate' | 'freeMove';

interface Clipboard {
  objects: RoomObject[];
  items: Item[];
}

interface ContextMenuState {
  objectId: string;
  x: number;
  y: number;
}

interface AppState extends Doc {
  activeRoomId: string;
  settings: Settings;

  // Device identity + project metadata (persisted)
  currentUser: User | null;
  knownUsers: User[];
  projectMeta: ProjectMeta;
  activityLog: LogEntry[];

  // Save status lives in `useSaveStore` (see its definition for why).
  _manualSaveNonce: number;

  // Transient (not persisted)
  selection: string[];
  openLocation: LocationRef | null;
  pickerObjectId: string | null;
  search: string;
  sortMode: SortMode;
  inspectItemId: string | null;
  contextMenu: ContextMenuState | null;
  clipboard: Clipboard | null;
  logViewerOpen: boolean;
  logSearch: string;
  logScopeFilter: LogScope | 'all';

  wallTool: WallTool;
  wallDraft: { startVertexId: string; lastVertexId: string } | null;
  wallSelection: WallEntitySelection;
  objectTool: ObjectTool;
  fitToViewToken: number;

  // History (not persisted)
  past: Doc[];
  future: Doc[];
  _histAt: number;
  _histKey: string;
  _rev: number;

  // Settings actions
  setUnit: (u: Settings['units']) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  toggleShowAllLabels: () => void;
  setWallThicknessDefault: (v: number) => void;
  toggleWallAngleSnap: () => void;
  setMode: (mode: AppMode) => void;
  setObjectTool: (tool: ObjectTool) => void;

  // User / session
  loginUser: (name: string, email: string) => void;
  logout: () => void;

  // Save
  saveNow: () => void;

  // Activity / inventory log
  openLogViewer: () => void;
  closeLogViewer: () => void;
  setLogSearch: (q: string) => void;
  setLogScopeFilter: (scope: LogScope | 'all') => void;

  // Room actions
  addRoom: (name?: string) => string;
  renameRoom: (id: string, name: string) => void;
  deleteRoom: (id: string) => void;
  duplicateRoom: (id: string) => string | null;
  reorderRoom: (id: string, dir: -1 | 1) => void;
  setActiveRoom: (id: string) => void;
  setRoomCamera: (id: string, camera: CameraState) => void;
  setFloorStyle: (color: string, opacity: number) => void;

  // Layer actions
  addLayer: (name?: string) => void;
  renameLayer: (id: string, name: string) => void;
  toggleLayer: (id: string) => void;
  deleteLayer: (id: string) => void;
  reorderLayer: (id: string, dir: -1 | 1) => void;
  setActiveLayer: (id: string) => void;

  // Object actions
  addObject: (kind: ObjectKind, at?: { x: number; y: number }) => string;
  updateObject: (id: string, patch: Partial<RoomObject>) => void;
  removeObject: (id: string) => void;
  duplicateObject: (id: string) => string | null;
  setStorage: (id: string, storage: Storage) => void;

  // Selection & clipboard
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  copySelection: () => void;
  pasteClipboard: () => void;

  // Items
  addItem: (loc: LocationRef, patch?: Partial<Item>) => string;
  updateItem: (id: string, patch: Partial<Item>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, loc: LocationRef) => void;
  moveItemToRoom: (itemId: string, toRoomId: string, loc: LocationRef) => void;
  /** Moves `qty` units of an item to a location, splitting off a new item
   * record for the moved portion when qty is less than the full stack
   * (leaving the remainder behind), or moving the whole item when qty
   * covers the entire quantity. `toRoomId` may be the active room's id. */
  moveItemQty: (itemId: string, qty: number, toRoomId: string, loc: LocationRef) => void;
  setItemOrder: (orderedIds: string[]) => void;
  markUsed: (id: string) => void;

  // Tags
  addTag: (name: string, color: string) => string;
  updateTag: (id: string, patch: Partial<Tag>) => void;
  removeTag: (id: string) => void;

  // Navigation
  open: (loc: LocationRef) => void;
  /** Opens a drawer from within the compartment picker, leaving the picker's
   * state intact so "Back" returns to compartment selection instead of
   * jumping straight to the room. */
  openFromPicker: (loc: LocationRef) => void;
  openPicker: (id: string | null) => void;
  closeDrawer: () => void;
  inspectItem: (id: string | null) => void;
  setSearch: (q: string) => void;
  setSortMode: (m: SortMode) => void;
  openContextMenu: (objectId: string, x: number, y: number) => void;
  closeContextMenu: () => void;

  // Wall designer
  setWallTool: (tool: WallTool) => void;
  commitWallPoint: (point: { x: number; y: number }) => void;
  cancelWallDraft: () => void;
  selectWallEntity: (sel: WallEntitySelection) => void;
  updateWallThickness: (wallId: string, thickness: number) => void;
  toggleWallCurved: (wallId: string) => void;
  setWallCurveOffset: (wallId: string, offset: number) => void;
  moveVertex: (vertexId: string, x: number, y: number) => void;
  deleteWall: (wallId: string) => void;
  splitWallAt: (wallId: string, t: number) => void;
  mergeAtVertex: (vertexId: string) => void;
  addOpening: (wallId: string, kind: 'door' | 'window', t: number) => string;
  updateOpening: (id: string, patch: Partial<WallOpening>) => void;
  moveOpeningAlongWall: (id: string, t: number) => void;
  removeOpening: (id: string) => void;

  // History
  undo: () => void;
  redo: () => void;

  requestFitToView: () => void;
}

function snapshot(s: AppState): Doc {
  return { rooms: s.rooms, roomOrder: s.roomOrder, tags: s.tags };
}

/**
 * Returns the state patch that records a history checkpoint. Rapid successive
 * mutations sharing a key within 500ms coalesce into a single undo step, so
 * a drag or a burst of typing becomes one entry automatically.
 */
function withHistory(s: AppState, key: string): Partial<AppState> {
  const now = Date.now();
  if (s._histKey === key && now - s._histAt < 500) {
    return { _histAt: now, _rev: s._rev + 1 };
  }
  return {
    past: [...s.past, snapshot(s)].slice(-80),
    future: [],
    _histAt: now,
    _histKey: key,
    _rev: s._rev + 1,
  };
}

/** Apply a transform to the currently-active room and wrap it as a history-tracked patch. */
function mutateActiveRoom(s: AppState, historyKey: string, fn: (room: Room) => Room): Partial<AppState> {
  const room = s.rooms[s.activeRoomId];
  if (!room) return {};
  const nextRoom = fn(room);
  return { ...withHistory(s, historyKey), rooms: { ...s.rooms, [room.id]: nextRoom } };
}

function recomputeFloors(room: Room): Room {
  return { ...room, floors: computeFloors(room.vertices, room.walls) };
}

const LOG_COALESCE_MS = 4000;
const LOG_MAX_ENTRIES = 500;

interface LogInput {
  scope: LogScope;
  action: LogAction;
  entityId: string;
  subject: string;
  roomId?: string;
  roomName?: string;
  previousValue?: string;
  newValue?: string;
  detail?: string;
}

/**
 * Append an attributed log entry, or — if the most recent entry is about the
 * same thing within a few seconds — fold into it instead. This turns a burst
 * of rapid edits (typing a name, clicking a quantity stepper) into a single
 * entry that reads "changed 4 → 9" rather than five near-identical rows.
 */
function pushLogEntry(s: AppState, input: LogInput): Partial<AppState> {
  const userName = s.currentUser?.name ?? 'Unknown user';
  const userEmail = s.currentUser?.email ?? '';
  const now = Date.now();
  const top = s.activityLog[0];
  if (top && top.entityId === input.entityId && top.action === input.action && top.scope === input.scope && now - top.timestamp < LOG_COALESCE_MS) {
    const merged: LogEntry = {
      ...top,
      timestamp: now,
      subject: input.subject,
      newValue: input.newValue ?? top.newValue,
      detail: input.detail ?? top.detail,
    };
    return { activityLog: [merged, ...s.activityLog.slice(1)] };
  }
  const entry: LogEntry = { id: `log-${nanoid(8)}`, timestamp: now, userName, userEmail, ...input };
  return { activityLog: [entry, ...s.activityLog].slice(0, LOG_MAX_ENTRIES) };
}

const DEFAULT_FILL = '#3b4a63';

function defaultLayers(suffix: string): { layers: Layer[]; activeLayerId: string } {
  const wallLayer: Layer = { id: `layer-walls-${suffix}`, name: 'Walls', visible: true, kind: 'wall' };
  const mainLayer: Layer = { id: `layer-main-${suffix}`, name: 'Room', visible: true, kind: 'object' };
  return { layers: [wallLayer, mainLayer], activeLayerId: mainLayer.id };
}

function emptyRoom(name: string): Room {
  const suffix = nanoid(6);
  const { layers, activeLayerId } = defaultLayers(suffix);
  return {
    id: `room-${nanoid(8)}`,
    name,
    order: 0,
    objects: {},
    items: {},
    layers,
    activeLayerId,
    vertices: {},
    walls: {},
    openings: {},
    floors: [],
    floorColor: '#1c2233',
    floorOpacity: 1,
    camera: { x: 160, y: 140, scale: 1 },
  };
}

/** Deep-clone a room, generating fresh ids for every nested entity it contains. */
function cloneRoomWithNewIds(src: Room, newName: string): Room {
  const roomId = `room-${nanoid(8)}`;
  const layerIdMap = new Map<string, string>();
  const layers: Layer[] = src.layers.map((l) => {
    const id = `layer-${nanoid(6)}`;
    layerIdMap.set(l.id, id);
    return { ...l, id };
  });

  const objectIdMap = new Map<string, string>();
  const objects: Record<string, RoomObject> = {};
  for (const o of Object.values(src.objects)) {
    const id = `obj-${nanoid(8)}`;
    objectIdMap.set(o.id, id);
    objects[id] = { ...o, id, layerId: layerIdMap.get(o.layerId) ?? layers[layers.length - 1].id };
  }

  const items: Record<string, Item> = {};
  for (const it of Object.values(src.items)) {
    const id = `item-${nanoid(8)}`;
    const objectId = objectIdMap.get(it.objectId);
    if (!objectId) continue;
    items[id] = { ...it, id, objectId };
  }

  const vertexIdMap = new Map<string, string>();
  const vertices: Room['vertices'] = {};
  for (const v of Object.values(src.vertices)) {
    const nv = makeVertex(v.x, v.y);
    vertexIdMap.set(v.id, nv.id);
    vertices[nv.id] = nv;
  }

  const wallIdMap = new Map<string, string>();
  const walls: Room['walls'] = {};
  for (const w of Object.values(src.walls)) {
    const a = vertexIdMap.get(w.a)!;
    const b = vertexIdMap.get(w.b)!;
    const nw: WallSegment = { ...makeWall(a, b, w.thickness), curved: w.curved, curveOffset: w.curveOffset };
    wallIdMap.set(w.id, nw.id);
    walls[nw.id] = nw;
  }

  const openings: Room['openings'] = {};
  for (const o of Object.values(src.openings)) {
    const wallId = wallIdMap.get(o.wallId);
    if (!wallId) continue;
    const id = `open-${nanoid(8)}`;
    openings[id] = { ...o, id, wallId };
  }

  return {
    id: roomId,
    name: newName,
    order: src.order,
    objects,
    items,
    layers,
    activeLayerId: layerIdMap.get(src.activeLayerId) ?? layers[layers.length - 1].id,
    vertices,
    walls,
    openings,
    floors: computeFloors(vertices, walls),
    floorColor: src.floorColor,
    floorOpacity: src.floorOpacity,
    camera: { ...src.camera },
  };
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...buildDemo(),
      settings: {
        units: 'in',
        gridVisible: true,
        snapToGrid: true,
        showAllLabels: false,
        wallThickness: 6,
        wallAngleSnap: true,
        mode: 'design',
      },

      currentUser: null,
      knownUsers: [],
      projectMeta: { id: `project-${nanoid(8)}`, name: 'My Project', createdAt: Date.now() },
      activityLog: [],

      _manualSaveNonce: 0,

      selection: [],
      openLocation: null,
      pickerObjectId: null,
      search: '',
      sortMode: 'manual',
      inspectItemId: null,
      contextMenu: null,
      clipboard: null,
      logViewerOpen: false,
      logSearch: '',
      logScopeFilter: 'all',

      wallTool: 'select',
      wallDraft: null,
      wallSelection: null,
      objectTool: 'select',
      fitToViewToken: 0,

      past: [],
      future: [],
      _histAt: 0,
      _histKey: '',
      _rev: 0,

      setUnit: (units) => set((s) => ({ settings: { ...s.settings, units } })),
      toggleGrid: () => set((s) => ({ settings: { ...s.settings, gridVisible: !s.settings.gridVisible } })),
      toggleSnap: () => set((s) => ({ settings: { ...s.settings, snapToGrid: !s.settings.snapToGrid } })),
      toggleShowAllLabels: () => set((s) => ({ settings: { ...s.settings, showAllLabels: !s.settings.showAllLabels } })),
      setWallThicknessDefault: (v) => set((s) => ({ settings: { ...s.settings, wallThickness: Math.max(1, v) } })),
      toggleWallAngleSnap: () => set((s) => ({ settings: { ...s.settings, wallAngleSnap: !s.settings.wallAngleSnap } })),
      setMode: (mode) =>
        set((s) => ({
          settings: { ...s.settings, mode },
          // Leaving a mode clears state that only makes sense in the other one.
          selection: [],
          wallSelection: null,
          wallDraft: null,
          wallTool: 'select',
          objectTool: 'select',
          openLocation: mode === 'design' ? null : s.openLocation,
          pickerObjectId: mode === 'design' ? null : s.pickerObjectId,
        })),

      loginUser: (name, email) =>
        set((s) => {
          const trimmedName = name.trim();
          const trimmedEmail = email.trim().toLowerCase();
          const existing = s.knownUsers.find((u) => u.email.toLowerCase() === trimmedEmail);
          const user: User = existing ? { ...existing, name: trimmedName } : { id: `user-${nanoid(8)}`, name: trimmedName, email: trimmedEmail };
          const knownUsers = [user, ...s.knownUsers.filter((u) => u.email.toLowerCase() !== trimmedEmail)].slice(0, 8);
          return { currentUser: user, knownUsers };
        }),
      logout: () => set({ currentUser: null }),

      saveNow: () => set((s) => ({ _manualSaveNonce: s._manualSaveNonce + 1 })),

      openLogViewer: () => set({ logViewerOpen: true }),
      closeLogViewer: () => set({ logViewerOpen: false }),
      setLogSearch: (q) => set({ logSearch: q }),
      setLogScopeFilter: (scope) => set({ logScopeFilter: scope }),

      addRoom: (name) => {
        const room = emptyRoom(name?.trim() || 'New Room');
        set((s) => ({
          ...withHistory(s, 'add-room'),
          ...pushLogEntry(s, { scope: 'room', action: 'created', entityId: room.id, subject: room.name, roomId: room.id, roomName: room.name }),
          rooms: { ...s.rooms, [room.id]: { ...room, order: s.roomOrder.length } },
          roomOrder: [...s.roomOrder, room.id],
          activeRoomId: room.id,
          selection: [],
          openLocation: null,
          pickerObjectId: null,
          wallSelection: null,
          wallDraft: null,
        }));
        return room.id;
      },
      renameRoom: (id, name) =>
        set((s) => {
          const room = s.rooms[id];
          if (!room || !name || name === room.name) return {};
          return {
            ...withHistory(s, 'rename-room:' + id),
            ...pushLogEntry(s, { scope: 'room', action: 'renamed', entityId: id, subject: name, roomId: id, roomName: name, previousValue: room.name, newValue: name }),
            rooms: { ...s.rooms, [id]: { ...room, name } },
          };
        }),
      deleteRoom: (id) =>
        set((s) => {
          if (s.roomOrder.length <= 1) return {};
          const room = s.rooms[id];
          const rooms = { ...s.rooms };
          delete rooms[id];
          const roomOrder = s.roomOrder.filter((r) => r !== id);
          const activeRoomId = s.activeRoomId === id ? roomOrder[0] : s.activeRoomId;
          return {
            ...withHistory(s, 'del-room'),
            ...(room ? pushLogEntry(s, { scope: 'room', action: 'deleted', entityId: id, subject: room.name }) : {}),
            rooms,
            roomOrder,
            activeRoomId,
            selection: [],
            openLocation: null,
            pickerObjectId: null,
          };
        }),
      duplicateRoom: (id) => {
        const src = get().rooms[id];
        if (!src) return null;
        const clone = cloneRoomWithNewIds(src, `${src.name} copy`);
        set((s) => ({
          ...withHistory(s, 'dup-room'),
          ...pushLogEntry(s, { scope: 'room', action: 'created', entityId: clone.id, subject: clone.name, roomId: clone.id, roomName: clone.name, detail: `Duplicated from "${src.name}"` }),
          rooms: { ...s.rooms, [clone.id]: { ...clone, order: s.roomOrder.length } },
          roomOrder: [...s.roomOrder, clone.id],
          activeRoomId: clone.id,
        }));
        return clone.id;
      },
      reorderRoom: (id, dir) =>
        set((s) => {
          const idx = s.roomOrder.indexOf(id);
          const next = idx + dir;
          if (idx < 0 || next < 0 || next >= s.roomOrder.length) return {};
          const order = [...s.roomOrder];
          [order[idx], order[next]] = [order[next], order[idx]];
          return { ...withHistory(s, 'reorder-room'), roomOrder: order };
        }),
      setActiveRoom: (id) =>
        set((s) => {
          if (!s.rooms[id] || s.activeRoomId === id) return {};
          return {
            activeRoomId: id,
            selection: [],
            openLocation: null,
            pickerObjectId: null,
            inspectItemId: null,
            wallSelection: null,
            wallDraft: null,
            wallTool: 'select',
            objectTool: 'select',
            contextMenu: null,
          };
        }),
      setRoomCamera: (id, camera) =>
        set((s) => {
          const room = s.rooms[id];
          if (!room) return {};
          return { rooms: { ...s.rooms, [id]: { ...room, camera } } };
        }),
      setFloorStyle: (color, opacity) =>
        set((s) => mutateActiveRoom(s, 'floor-style', (room) => ({ ...room, floorColor: color, floorOpacity: opacity }))),

      addLayer: (name) =>
        set((s) =>
          mutateActiveRoom(s, 'add-layer', (room) => {
            const layer: Layer = { id: `layer-${nanoid(6)}`, name: name || `Layer ${room.layers.length + 1}`, visible: true, kind: 'object' };
            return { ...room, layers: [...room.layers, layer], activeLayerId: layer.id };
          }),
        ),
      renameLayer: (id, name) =>
        set((s) =>
          mutateActiveRoom(s, 'rename-layer:' + id, (room) => ({
            ...room,
            layers: room.layers.map((l) => (l.id === id ? { ...l, name } : l)),
          })),
        ),
      toggleLayer: (id) =>
        set((s) =>
          mutateActiveRoom(s, 'toggle-layer', (room) => ({
            ...room,
            layers: room.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
          })),
        ),
      deleteLayer: (id) =>
        set((s) =>
          mutateActiveRoom(s, 'del-layer', (room) => {
            const target = room.layers.find((l) => l.id === id);
            if (!target || target.kind === 'wall') return room; // the wall layer is permanent
            const objectLayers = room.layers.filter((l) => l.kind === 'object');
            if (objectLayers.length <= 1) return room; // keep at least one object layer
            const layers = room.layers.filter((l) => l.id !== id);
            const fallback = layers.find((l) => l.kind === 'object')!.id;
            const objects = { ...room.objects };
            for (const o of Object.values(objects)) {
              if (o.layerId === id) objects[o.id] = { ...o, layerId: fallback };
            }
            return {
              ...room,
              layers,
              objects,
              activeLayerId: room.activeLayerId === id ? fallback : room.activeLayerId,
            };
          }),
        ),
      reorderLayer: (id, dir) =>
        set((s) =>
          mutateActiveRoom(s, 'reorder-layer', (room) => {
            const idx = room.layers.findIndex((l) => l.id === id);
            const next = idx + dir;
            if (idx < 0 || next < 0 || next >= room.layers.length) return room;
            const layers = [...room.layers];
            [layers[idx], layers[next]] = [layers[next], layers[idx]];
            return { ...room, layers };
          }),
        ),
      setActiveLayer: (id) =>
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          if (!room) return {};
          const layer = room.layers.find((l) => l.id === id);
          const enteringWall = layer?.kind === 'wall';
          return {
            rooms: { ...s.rooms, [room.id]: { ...room, activeLayerId: id } },
            wallTool: enteringWall ? s.wallTool : 'select',
            wallSelection: enteringWall ? s.wallSelection : null,
            wallDraft: enteringWall ? s.wallDraft : null,
            selection: enteringWall ? [] : s.selection,
          };
        }),

      addObject: (kind, at) => {
        const id = `obj-${nanoid(8)}`;
        set((s) =>
          mutateActiveRoom(s, 'add-obj:' + id, (room) => {
            const isContainer = kind === 'container';
            const obj: RoomObject = {
              id,
              name: kind === 'container' ? 'Shelf' : kind === 'text' ? 'Label' : 'Object',
              kind,
              x: at?.x ?? 40,
              y: at?.y ?? 40,
              width: kind === 'circle' ? 24 : kind === 'text' ? 30 : 48,
              height: kind === 'circle' ? 24 : kind === 'text' ? 10 : 24,
              depthIn: 24,
              rotation: 0,
              fill: kind === 'text' ? 'transparent' : DEFAULT_FILL,
              cornerRadius: kind === 'roundedRect' ? 8 : 0,
              notes: '',
              layerId: room.activeLayerId,
              storage: isContainer
                ? { type: 'grid', rows: 3, cols: 3, rowFractions: [1, 1, 1], colFractions: [1, 1, 1], cells: {} }
                : { type: 'single' },
            };
            return { ...room, objects: { ...room.objects, [id]: obj } };
          }),
        );
        set({ selection: [id] });
        return id;
      },
      updateObject: (id, patch) =>
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          const cur = room?.objects[id];
          const roomPatch = mutateActiveRoom(s, 'upd-obj:' + id, (r) => {
            const c = r.objects[id];
            if (!c) return r;
            return { ...r, objects: { ...r.objects, [id]: { ...c, ...patch } } };
          });
          if (cur && room && patch.name !== undefined && patch.name !== cur.name) {
            return {
              ...roomPatch,
              ...pushLogEntry(s, {
                scope: 'object',
                action: 'renamed',
                entityId: id,
                subject: patch.name,
                roomId: room.id,
                roomName: room.name,
                previousValue: cur.name,
                newValue: patch.name,
              }),
            };
          }
          return roomPatch;
        }),
      removeObject: (id) => {
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          const cur = room?.objects[id];
          const roomPatch = mutateActiveRoom(s, 'del-obj', (r) => {
            const objects = { ...r.objects };
            delete objects[id];
            const items = { ...r.items };
            for (const it of Object.values(r.items)) {
              if (it.objectId === id) delete items[it.id];
            }
            return { ...r, objects, items };
          });
          if (cur && room) {
            return { ...roomPatch, ...pushLogEntry(s, { scope: 'object', action: 'deleted', entityId: id, subject: cur.name, roomId: room.id, roomName: room.name }) };
          }
          return roomPatch;
        });
        set((s) => ({ selection: s.selection.filter((x) => x !== id) }));
      },
      duplicateObject: (id) => {
        const room = get().rooms[get().activeRoomId];
        const src = room?.objects[id];
        if (!src) return null;
        const newId = `obj-${nanoid(8)}`;
        set((s) =>
          mutateActiveRoom(s, 'dup-obj', (r) => ({
            ...r,
            objects: { ...r.objects, [newId]: { ...src, id: newId, name: `${src.name} copy`, x: src.x + 16, y: src.y + 16 } },
          })),
        );
        set({ selection: [newId] });
        return newId;
      },
      setStorage: (id, storage) =>
        set((s) =>
          mutateActiveRoom(s, 'set-storage:' + id, (room) => {
            const cur = room.objects[id];
            if (!cur) return room;
            return { ...room, objects: { ...room.objects, [id]: { ...cur, storage } } };
          }),
        ),
      setSelection: (ids) => set({ selection: ids }),
      clearSelection: () => set({ selection: [] }),
      copySelection: () =>
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          if (!room || s.selection.length === 0) return {};
          const objects = s.selection.map((id) => room.objects[id]).filter(Boolean) as RoomObject[];
          const objIds = new Set(objects.map((o) => o.id));
          const items = Object.values(room.items).filter((it) => objIds.has(it.objectId));
          return { clipboard: { objects, items } };
        }),
      pasteClipboard: () =>
        set((s) => {
          const clip = s.clipboard;
          const room = s.rooms[s.activeRoomId];
          if (!clip || !room || clip.objects.length === 0) return {};
          const targetLayer = room.layers.find((l) => l.id === room.activeLayerId && l.kind === 'object')
            ? room.activeLayerId
            : (room.layers.find((l) => l.kind === 'object')?.id ?? room.activeLayerId);

          const idMap = new Map<string, string>();
          const newObjects: Record<string, RoomObject> = {};
          for (const o of clip.objects) {
            const id = `obj-${nanoid(8)}`;
            idMap.set(o.id, id);
            newObjects[id] = { ...o, id, x: o.x + 20, y: o.y + 20, layerId: targetLayer };
          }
          const newItems: Record<string, Item> = {};
          for (const it of clip.items) {
            const objectId = idMap.get(it.objectId);
            if (!objectId) continue;
            const id = `item-${nanoid(8)}`;
            newItems[id] = { ...it, id, objectId };
          }

          return {
            ...withHistory(s, 'paste'),
            rooms: {
              ...s.rooms,
              [room.id]: {
                ...room,
                objects: { ...room.objects, ...newObjects },
                items: { ...room.items, ...newItems },
              },
            },
            selection: Object.keys(newObjects),
          };
        }),

      addItem: (loc, patch) => {
        const id = `item-${nanoid(8)}`;
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          const name = patch?.name ?? 'New item';
          const roomPatch = mutateActiveRoom(s, 'add-item:' + id, (r) => {
            const now = Date.now();
            const siblings = Object.values(r.items).filter(
              (i) => i.objectId === loc.objectId && i.cellKey === loc.cellKey,
            );
            const item: Item = {
              id,
              name,
              quantity: patch?.quantity ?? 1,
              tagIds: patch?.tagIds ?? [],
              image: patch?.image,
              createdAt: now,
              updatedAt: now,
              objectId: loc.objectId,
              cellKey: loc.cellKey,
              order: siblings.length,
              ...patch,
            };
            return { ...r, items: { ...r.items, [id]: item } };
          });
          if (!room) return roomPatch;
          return {
            ...roomPatch,
            ...pushLogEntry(s, { scope: 'inventory', action: 'created', entityId: id, subject: name, roomId: room.id, roomName: room.name }),
          };
        });
        return id;
      },
      updateItem: (id, patch) =>
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          const cur = room?.items[id];
          const roomPatch = mutateActiveRoom(s, 'upd-item:' + id, (r) => {
            const c = r.items[id];
            if (!c) return r;
            return { ...r, items: { ...r.items, [id]: { ...c, ...patch, updatedAt: Date.now() } } };
          });
          if (!cur || !room) return roomPatch;

          const base = { roomId: room.id, roomName: room.name };
          if (patch.quantity !== undefined && patch.quantity !== cur.quantity) {
            return {
              ...roomPatch,
              ...pushLogEntry(s, { scope: 'inventory', action: 'quantity_changed', entityId: id, subject: cur.name, ...base, previousValue: String(cur.quantity), newValue: String(patch.quantity) }),
            };
          }
          if (patch.name !== undefined && patch.name !== cur.name) {
            return {
              ...roomPatch,
              ...pushLogEntry(s, { scope: 'inventory', action: 'renamed', entityId: id, subject: patch.name, ...base, previousValue: cur.name, newValue: patch.name }),
            };
          }
          if (patch.notes !== undefined && patch.notes !== cur.notes) {
            return {
              ...roomPatch,
              ...pushLogEntry(s, { scope: 'inventory', action: 'notes_edited', entityId: id, subject: cur.name, ...base }),
            };
          }
          const meaningfulKeys = Object.keys(patch).filter((k) => !['name', 'quantity', 'notes', 'updatedAt'].includes(k));
          if (meaningfulKeys.length) {
            return {
              ...roomPatch,
              ...pushLogEntry(s, { scope: 'inventory', action: 'edited', entityId: id, subject: cur.name, ...base }),
            };
          }
          return roomPatch;
        }),
      removeItem: (id) =>
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          const cur = room?.items[id];
          const roomPatch = mutateActiveRoom(s, 'del-item', (r) => {
            const items = { ...r.items };
            delete items[id];
            return { ...r, items };
          });
          return {
            ...roomPatch,
            ...(cur && room ? pushLogEntry(s, { scope: 'inventory', action: 'deleted', entityId: id, subject: cur.name, roomId: room.id, roomName: room.name }) : {}),
            inspectItemId: s.inspectItemId === id ? null : s.inspectItemId,
          };
        }),
      moveItem: (id, loc) =>
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          const cur = room?.items[id];
          const roomPatch = mutateActiveRoom(s, 'move-item', (r) => {
            const c = r.items[id];
            if (!c) return r;
            const siblings = Object.values(r.items).filter(
              (i) => i.objectId === loc.objectId && i.cellKey === loc.cellKey && i.id !== id,
            );
            return {
              ...r,
              items: {
                ...r.items,
                [id]: { ...c, objectId: loc.objectId, cellKey: loc.cellKey, order: siblings.length, updatedAt: Date.now() },
              },
            };
          });
          if (!cur || !room) return roomPatch;
          const fromObj = room.objects[cur.objectId];
          const toObj = room.objects[loc.objectId];
          const fromLabel = fromObj ? `${fromObj.name} · ${cellName(fromObj, cur.cellKey)}` : 'Unknown';
          const toLabel = toObj ? `${toObj.name} · ${cellName(toObj, loc.cellKey)}` : 'Unknown';
          return {
            ...roomPatch,
            ...pushLogEntry(s, {
              scope: 'inventory',
              action: 'moved',
              entityId: id,
              subject: cur.name,
              roomId: room.id,
              roomName: room.name,
              previousValue: fromLabel,
              newValue: toLabel,
            }),
          };
        }),
      moveItemToRoom: (itemId, toRoomId, loc) =>
        set((s) => {
          const fromRoom = s.rooms[s.activeRoomId];
          const toRoom = s.rooms[toRoomId];
          if (!fromRoom || !toRoom) return {};
          const item = fromRoom.items[itemId];
          if (!item) return {};
          const siblings = Object.values(toRoom.items).filter((i) => i.objectId === loc.objectId && i.cellKey === loc.cellKey);
          const movedItem: Item = { ...item, objectId: loc.objectId, cellKey: loc.cellKey, order: siblings.length, updatedAt: Date.now() };

          const fromItems = { ...fromRoom.items };
          delete fromItems[itemId];

          const fromObj = fromRoom.objects[item.objectId];
          const toObj = toRoom.objects[loc.objectId];
          const fromLabel = fromObj ? `${fromRoom.name} · ${fromObj.name} · ${cellName(fromObj, item.cellKey)}` : fromRoom.name;
          const toLabel = toObj ? `${toRoom.name} · ${toObj.name} · ${cellName(toObj, loc.cellKey)}` : toRoom.name;

          return {
            ...withHistory(s, 'move-item-room'),
            ...pushLogEntry(s, {
              scope: 'inventory',
              action: 'moved',
              entityId: itemId,
              subject: item.name,
              roomId: toRoom.id,
              roomName: toRoom.name,
              previousValue: fromLabel,
              newValue: toLabel,
            }),
            rooms: {
              ...s.rooms,
              [fromRoom.id]: { ...fromRoom, items: fromItems },
              [toRoom.id]: { ...toRoom, items: { ...toRoom.items, [itemId]: movedItem } },
            },
            inspectItemId: fromRoom.id === s.activeRoomId ? null : s.inspectItemId,
          };
        }),
      moveItemQty: (itemId, qty, toRoomId, loc) =>
        set((s) => {
          const fromRoom = s.rooms[s.activeRoomId];
          const item = fromRoom?.items[itemId];
          const toRoom = s.rooms[toRoomId];
          if (!fromRoom || !item || !toRoom) return {};
          const moveQty = Math.max(1, Math.min(Math.round(qty), item.quantity));
          const sameRoom = fromRoom.id === toRoom.id;
          if (sameRoom && loc.objectId === item.objectId && loc.cellKey === item.cellKey) return {};

          const fromObj = fromRoom.objects[item.objectId];
          const toObj = toRoom.objects[loc.objectId];
          const fromLabel = sameRoom
            ? fromObj
              ? `${fromObj.name} · ${cellName(fromObj, item.cellKey)}`
              : 'Unknown'
            : fromObj
              ? `${fromRoom.name} · ${fromObj.name} · ${cellName(fromObj, item.cellKey)}`
              : fromRoom.name;
          const toLabel = sameRoom
            ? toObj
              ? `${toObj.name} · ${cellName(toObj, loc.cellKey)}`
              : 'Unknown'
            : toObj
              ? `${toRoom.name} · ${toObj.name} · ${cellName(toObj, loc.cellKey)}`
              : toRoom.name;

          const full = moveQty >= item.quantity;
          const toSiblings = Object.values(toRoom.items).filter(
            (i) => i.objectId === loc.objectId && i.cellKey === loc.cellKey,
          );

          // Same-room and cross-room moves share this logic by having both
          // "sides" point at the same working map when the room is the same.
          let fromItems = { ...fromRoom.items };
          let toItems = sameRoom ? fromItems : { ...toRoom.items };

          if (full) {
            const movedItem: Item = { ...item, objectId: loc.objectId, cellKey: loc.cellKey, order: toSiblings.length, updatedAt: Date.now() };
            delete fromItems[itemId];
            toItems = { ...(sameRoom ? fromItems : toItems), [itemId]: movedItem };
            if (sameRoom) fromItems = toItems;
          } else {
            const remaining: Item = { ...item, quantity: item.quantity - moveQty, updatedAt: Date.now() };
            const newId = `item-${nanoid(8)}`;
            const newItem: Item = {
              ...item,
              id: newId,
              quantity: moveQty,
              objectId: loc.objectId,
              cellKey: loc.cellKey,
              order: toSiblings.length,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            fromItems = { ...fromItems, [itemId]: remaining };
            toItems = { ...(sameRoom ? fromItems : toItems), [newId]: newItem };
            if (sameRoom) fromItems = toItems;
          }

          return {
            ...withHistory(s, 'move-item-qty'),
            ...pushLogEntry(s, {
              scope: 'inventory',
              action: 'moved',
              entityId: itemId,
              subject: full ? item.name : `${item.name} (${moveQty} of ${item.quantity})`,
              roomId: toRoom.id,
              roomName: toRoom.name,
              previousValue: fromLabel,
              newValue: toLabel,
            }),
            rooms: {
              ...s.rooms,
              [fromRoom.id]: { ...fromRoom, items: fromItems },
              [toRoom.id]: { ...toRoom, items: toItems },
            },
            inspectItemId: full && !sameRoom && fromRoom.id === s.activeRoomId ? null : s.inspectItemId,
          };
        }),
      setItemOrder: (orderedIds) =>
        set((s) =>
          mutateActiveRoom(s, 'reorder-items', (room) => {
            const items = { ...room.items };
            orderedIds.forEach((id, idx) => {
              if (items[id]) items[id] = { ...items[id], order: idx };
            });
            return { ...room, items };
          }),
        ),
      markUsed: (id) =>
        set((s) =>
          mutateActiveRoom(s, 'mark-used:' + id, (room) => {
            const cur = room.items[id];
            if (!cur) return room;
            return { ...room, items: { ...room.items, [id]: { ...cur, lastUsedAt: Date.now() } } };
          }),
        ),

      addTag: (name, color) => {
        const id = `tag-${nanoid(6)}`;
        set((s) => ({ ...withHistory(s, 'add-tag'), tags: { ...s.tags, [id]: { id, name, color } } }));
        return id;
      },
      updateTag: (id, patch) =>
        set((s) => {
          const cur = s.tags[id];
          if (!cur) return {};
          return { ...withHistory(s, 'upd-tag:' + id), tags: { ...s.tags, [id]: { ...cur, ...patch } } };
        }),
      removeTag: (id) =>
        set((s) => {
          const tags = { ...s.tags };
          delete tags[id];
          const rooms = { ...s.rooms };
          for (const room of Object.values(rooms)) {
            let changed = false;
            const items = { ...room.items };
            for (const it of Object.values(items)) {
              if (it.tagIds.includes(id)) {
                items[it.id] = { ...it, tagIds: it.tagIds.filter((t) => t !== id) };
                changed = true;
              }
            }
            if (changed) rooms[room.id] = { ...room, items };
          }
          return { ...withHistory(s, 'del-tag'), tags, rooms };
        }),

      open: (loc) => set({ openLocation: loc, pickerObjectId: null, inspectItemId: null }),
      openFromPicker: (loc) => set({ openLocation: loc, inspectItemId: null }),
      openPicker: (id) => set({ pickerObjectId: id }),
      closeDrawer: () => set({ openLocation: null, inspectItemId: null }),
      inspectItem: (id) => set({ inspectItemId: id }),
      setSearch: (q) => set({ search: q }),
      setSortMode: (m) => set({ sortMode: m }),
      openContextMenu: (objectId, x, y) => set({ contextMenu: { objectId, x, y }, selection: [objectId] }),
      closeContextMenu: () => set({ contextMenu: null }),

      setWallTool: (tool) => set({ wallTool: tool, wallDraft: tool === 'draw' ? get().wallDraft : null }),
      setObjectTool: (tool) => set({ objectTool: tool }),
      commitWallPoint: (point) =>
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          if (!room) return {};
          const draft = s.wallDraft;
          const thickness = s.settings.wallThickness;
          const candidate = computeWallCandidate(room.vertices, draft, point, s.settings.wallAngleSnap);

          if (!draft) {
            const vertex = candidate.snappedVertexId ? room.vertices[candidate.snappedVertexId] : makeVertex(candidate.point.x, candidate.point.y);
            const vertices = candidate.snappedVertexId ? room.vertices : { ...room.vertices, [vertex.id]: vertex };
            return {
              rooms: { ...s.rooms, [room.id]: { ...room, vertices } },
              wallDraft: { startVertexId: vertex.id, lastVertexId: vertex.id },
            };
          }

          // Closing the loop back to the start.
          if (candidate.willClose) {
            const wall = makeWall(draft.lastVertexId, draft.startVertexId, thickness);
            const nextRoom = recomputeFloors({ ...room, walls: { ...room.walls, [wall.id]: wall } });
            return { ...withHistory(s, 'wall-close'), rooms: { ...s.rooms, [room.id]: nextRoom }, wallDraft: null };
          }

          const targetVertex = candidate.snappedVertexId ? room.vertices[candidate.snappedVertexId] : makeVertex(candidate.point.x, candidate.point.y);
          const vertices = candidate.snappedVertexId ? room.vertices : { ...room.vertices, [targetVertex.id]: targetVertex };
          const wall = makeWall(draft.lastVertexId, targetVertex.id, thickness);
          const nextRoom = recomputeFloors({ ...room, vertices, walls: { ...room.walls, [wall.id]: wall } });
          return {
            ...withHistory(s, 'wall-draw'),
            rooms: { ...s.rooms, [room.id]: nextRoom },
            wallDraft: { startVertexId: draft.startVertexId, lastVertexId: targetVertex.id },
          };
        }),
      cancelWallDraft: () => set({ wallDraft: null }),
      selectWallEntity: (sel) => set({ wallSelection: sel, selection: [] }),
      updateWallThickness: (wallId, thickness) =>
        set((s) =>
          mutateActiveRoom(s, 'wall-thickness:' + wallId, (room) => {
            const w = room.walls[wallId];
            if (!w) return room;
            return { ...room, walls: { ...room.walls, [wallId]: { ...w, thickness: Math.max(1, thickness) } } };
          }),
        ),
      toggleWallCurved: (wallId) =>
        set((s) =>
          mutateActiveRoom(s, 'wall-curve-toggle:' + wallId, (room) => {
            const w = room.walls[wallId];
            if (!w) return room;
            const curved = !w.curved;
            return { ...room, walls: { ...room.walls, [wallId]: { ...w, curved, curveOffset: curved ? w.curveOffset || 24 : 0 } } };
          }),
        ),
      setWallCurveOffset: (wallId, offset) =>
        set((s) =>
          mutateActiveRoom(s, 'wall-curve-offset:' + wallId, (room) => {
            const w = room.walls[wallId];
            if (!w) return room;
            return { ...room, walls: { ...room.walls, [wallId]: { ...w, curveOffset: offset } } };
          }),
        ),
      moveVertex: (vertexId, x, y) =>
        set((s) =>
          mutateActiveRoom(s, 'move-vertex:' + vertexId, (room) => {
            const v = room.vertices[vertexId];
            if (!v) return room;
            const nextRoom = { ...room, vertices: { ...room.vertices, [vertexId]: { ...v, x, y } } };
            return recomputeFloors(nextRoom);
          }),
        ),
      deleteWall: (wallId) =>
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          const roomPatch = mutateActiveRoom(s, 'del-wall', (r) => {
            const walls = { ...r.walls };
            delete walls[wallId];
            const openings = { ...r.openings };
            for (const o of Object.values(r.openings)) {
              if (o.wallId === wallId) delete openings[o.id];
            }
            // Drop vertices left with no remaining wall connections.
            const stillConnected = new Set<string>();
            for (const w of Object.values(walls)) {
              stillConnected.add(w.a);
              stillConnected.add(w.b);
            }
            const vertices = { ...r.vertices };
            for (const vid of Object.keys(vertices)) {
              if (!stillConnected.has(vid)) delete vertices[vid];
            }
            return recomputeFloors({ ...r, walls, openings, vertices });
          });
          return {
            ...roomPatch,
            ...(room && room.walls[wallId] ? pushLogEntry(s, { scope: 'wall', action: 'deleted', entityId: wallId, subject: 'Wall', roomId: room.id, roomName: room.name }) : {}),
            wallSelection: null,
          };
        }),
      splitWallAt: (wallId, t) =>
        set((s) =>
          mutateActiveRoom(s, 'split-wall', (room) => {
            const wall = room.walls[wallId];
            if (!wall) return room;
            const clampedT = Math.max(0.08, Math.min(0.92, t));
            const { vertex, wallA, wallB, openingUpdates } = libSplitWall(wall, room.vertices, room.openings, clampedT);
            const walls = { ...room.walls };
            delete walls[wallId];
            walls[wallA.id] = wallA;
            walls[wallB.id] = wallB;
            return recomputeFloors({
              ...room,
              vertices: { ...room.vertices, [vertex.id]: vertex },
              walls,
              openings: { ...room.openings, ...openingUpdates },
            });
          }),
        ),
      mergeAtVertex: (vertexId) =>
        set((s) =>
          mutateActiveRoom(s, 'merge-walls', (room) => {
            const pair = canMergeAt(vertexId, room.vertices, room.walls);
            if (!pair) return room;
            const { newWall, removedVertexId, openingUpdates } = libMergeWalls(vertexId, pair.w1, pair.w2, room.vertices, room.openings);
            const walls = { ...room.walls };
            delete walls[pair.w1.id];
            delete walls[pair.w2.id];
            walls[newWall.id] = newWall;
            const vertices = { ...room.vertices };
            delete vertices[removedVertexId];
            return recomputeFloors({ ...room, vertices, walls, openings: { ...room.openings, ...openingUpdates } });
          }),
        ),
      addOpening: (wallId, kind, t) => {
        const id = `open-${nanoid(8)}`;
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          const roomPatch = mutateActiveRoom(s, 'add-opening', (r) => {
            const wall = r.walls[wallId];
            if (!wall) return r;
            const length = wallVector(wall, r.vertices).length || 1;
            const width = Math.min(kind === 'door' ? 32 : 30, length * 0.6);
            const halfT = width / 2 / length;
            const clampedT = Math.max(halfT + 0.02, Math.min(1 - halfT - 0.02, t));
            const opening: WallOpening = { id, wallId, kind, t: clampedT, width };
            return { ...r, openings: { ...r.openings, [id]: opening } };
          });
          if (!room) return roomPatch;
          return {
            ...roomPatch,
            ...pushLogEntry(s, { scope: 'wall', action: 'created', entityId: id, subject: kind === 'door' ? 'Door' : 'Window', roomId: room.id, roomName: room.name }),
          };
        });
        set({ wallSelection: { type: 'opening', id }, wallTool: 'select' });
        return id;
      },
      updateOpening: (id, patch) =>
        set((s) =>
          mutateActiveRoom(s, 'upd-opening:' + id, (room) => {
            const cur = room.openings[id];
            if (!cur) return room;
            return { ...room, openings: { ...room.openings, [id]: { ...cur, ...patch } } };
          }),
        ),
      moveOpeningAlongWall: (id, t) =>
        set((s) =>
          mutateActiveRoom(s, 'move-opening:' + id, (room) => {
            const cur = room.openings[id];
            const wall = cur ? room.walls[cur.wallId] : null;
            if (!cur || !wall) return room;
            const length = wallVector(wall, room.vertices).length || 1;
            const halfT = cur.width / 2 / length;
            const clampedT = Math.max(halfT + 0.01, Math.min(1 - halfT - 0.01, t));
            return { ...room, openings: { ...room.openings, [id]: { ...cur, t: clampedT } } };
          }),
        ),
      removeOpening: (id) =>
        set((s) => {
          const room = s.rooms[s.activeRoomId];
          const cur = room?.openings[id];
          const roomPatch = mutateActiveRoom(s, 'del-opening', (r) => {
            const openings = { ...r.openings };
            delete openings[id];
            return { ...r, openings };
          });
          return {
            ...roomPatch,
            ...(cur && room ? pushLogEntry(s, { scope: 'wall', action: 'deleted', entityId: id, subject: cur.kind === 'door' ? 'Door' : 'Window', roomId: room.id, roomName: room.name }) : {}),
            wallSelection: null,
          };
        }),

      undo: () =>
        set((s) => {
          if (!s.past.length) return {};
          const prev = s.past[s.past.length - 1];
          return {
            ...prev,
            past: s.past.slice(0, -1),
            future: [snapshot(s), ...s.future].slice(0, 80),
            _histKey: '',
            selection: [],
            wallSelection: null,
          };
        }),
      redo: () =>
        set((s) => {
          if (!s.future.length) return {};
          const next = s.future[0];
          return {
            ...next,
            past: [...s.past, snapshot(s)].slice(-80),
            future: s.future.slice(1),
            _histKey: '',
            selection: [],
            wallSelection: null,
          };
        }),

      requestFitToView: () => set({ fitToViewToken: Date.now() }),
    }),
    {
      name: 'srs-lab-designer-doc',
      version: 2,
      storage: createJSONStorage(() => lfStorage),
      // Persist the full project + device state — everything a user would
      // expect to survive a reload: rooms/walls/floors/furniture/inventory,
      // settings (including mode), the device's remembered users, the
      // activity log, and project metadata. Never transient UI or undo
      // history — see the audit in PersistedState below.
      partialize: (s): PersistedState => ({
        rooms: s.rooms,
        roomOrder: s.roomOrder,
        activeRoomId: s.activeRoomId,
        tags: s.tags,
        settings: s.settings,
        currentUser: s.currentUser,
        knownUsers: s.knownUsers,
        projectMeta: s.projectMeta,
        activityLog: s.activityLog,
      }),
    },
  ),
);

export function useActiveRoom(): Room {
  return useStore((s) => s.rooms[s.activeRoomId]);
}

// Flip the indicator to "unsaved" the instant a persisted-worthy mutation
// happens (a `_rev` bump), so it never sits on a stale "saved" while the
// persist middleware's async write to IndexedDB is still in flight. This
// writes to the separate `useSaveStore`, never back into `useStore` — see
// that store's definition for why that separation matters.
let lastRevForSaveStatus = useStore.getState()._rev;
useStore.subscribe((state) => {
  if (state._rev !== lastRevForSaveStatus) {
    lastRevForSaveStatus = state._rev;
    if (useSaveStore.getState().saveStatus !== 'saving') useSaveStore.setState({ saveStatus: 'unsaved' });
  }
});
