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

localforage.config({ name: 'srs-lab-designer', storeName: 'state' });

const RECOVERY_KEY = 'srs-lab-designer-recovery';

const lfStorage = {
  getItem: async (name: string) => (await localforage.getItem<string>(name)) ?? null,
  setItem: async (name: string, value: string) => {
    await localforage.setItem(name, value);
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

export type WallTool = 'select' | 'draw' | 'door' | 'window';
export type WallEntitySelection = { type: 'wall' | 'vertex' | 'opening'; id: string } | null;

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

  // Transient (not persisted)
  selection: string[];
  openLocation: LocationRef | null;
  pickerObjectId: string | null;
  search: string;
  sortMode: SortMode;
  inspectItemId: string | null;
  contextMenu: ContextMenuState | null;
  clipboard: Clipboard | null;

  wallTool: WallTool;
  wallDraft: { startVertexId: string; lastVertexId: string } | null;
  wallSelection: WallEntitySelection;
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
  toggleSpaceAwareness: () => void;
  toggleShowAllLabels: () => void;
  setWallThicknessDefault: (v: number) => void;
  toggleWallAngleSnap: () => void;

  // Room actions
  addRoom: (name?: string) => string;
  renameRoom: (id: string, name: string) => void;
  deleteRoom: (id: string) => void;
  duplicateRoom: (id: string) => string | null;
  reorderRoom: (id: string, dir: -1 | 1) => void;
  setActiveRoom: (id: string) => void;
  setRoomCamera: (id: string, camera: CameraState) => void;
  setRoomNotes: (notes: string) => void;
  setFloorStyle: (color: string, opacity: number) => void;
  setBlueprint: (image: string) => void;
  setBlueprintOpacity: (opacity: number) => void;
  clearBlueprint: () => void;

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
  moveObjectToRoom: (objectId: string, toRoomId: string) => void;

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
  setItemOrder: (orderedIds: string[]) => void;
  markUsed: (id: string) => void;

  // Tags
  addTag: (name: string, color: string) => string;
  updateTag: (id: string, patch: Partial<Tag>) => void;
  removeTag: (id: string) => void;

  // Navigation
  open: (loc: LocationRef) => void;
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

  restoreFromRecovery: () => Promise<boolean>;
  resetAll: () => void;
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
    notes: '',
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
    blueprint: null,
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
    notes: src.notes,
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
    blueprint: src.blueprint ? { ...src.blueprint } : null,
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
        spaceAwareness: false,
        showAllLabels: false,
        wallThickness: 6,
        wallAngleSnap: true,
      },

      selection: [],
      openLocation: null,
      pickerObjectId: null,
      search: '',
      sortMode: 'manual',
      inspectItemId: null,
      contextMenu: null,
      clipboard: null,

      wallTool: 'select',
      wallDraft: null,
      wallSelection: null,
      fitToViewToken: 0,

      past: [],
      future: [],
      _histAt: 0,
      _histKey: '',
      _rev: 0,

      setUnit: (units) => set((s) => ({ settings: { ...s.settings, units } })),
      toggleGrid: () => set((s) => ({ settings: { ...s.settings, gridVisible: !s.settings.gridVisible } })),
      toggleSnap: () => set((s) => ({ settings: { ...s.settings, snapToGrid: !s.settings.snapToGrid } })),
      toggleSpaceAwareness: () =>
        set((s) => ({ settings: { ...s.settings, spaceAwareness: !s.settings.spaceAwareness } })),
      toggleShowAllLabels: () => set((s) => ({ settings: { ...s.settings, showAllLabels: !s.settings.showAllLabels } })),
      setWallThicknessDefault: (v) => set((s) => ({ settings: { ...s.settings, wallThickness: Math.max(1, v) } })),
      toggleWallAngleSnap: () => set((s) => ({ settings: { ...s.settings, wallAngleSnap: !s.settings.wallAngleSnap } })),

      addRoom: (name) => {
        const room = emptyRoom(name?.trim() || 'New Room');
        set((s) => ({
          ...withHistory(s, 'add-room'),
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
          if (!room) return {};
          return { ...withHistory(s, 'rename-room:' + id), rooms: { ...s.rooms, [id]: { ...room, name: name || room.name } } };
        }),
      deleteRoom: (id) =>
        set((s) => {
          if (s.roomOrder.length <= 1) return {};
          const rooms = { ...s.rooms };
          delete rooms[id];
          const roomOrder = s.roomOrder.filter((r) => r !== id);
          const activeRoomId = s.activeRoomId === id ? roomOrder[0] : s.activeRoomId;
          return {
            ...withHistory(s, 'del-room'),
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
            contextMenu: null,
          };
        }),
      setRoomCamera: (id, camera) =>
        set((s) => {
          const room = s.rooms[id];
          if (!room) return {};
          return { rooms: { ...s.rooms, [id]: { ...room, camera } } };
        }),
      setRoomNotes: (notes) =>
        set((s) => mutateActiveRoom(s, 'room-notes', (room) => ({ ...room, notes }))),
      setFloorStyle: (color, opacity) =>
        set((s) => mutateActiveRoom(s, 'floor-style', (room) => ({ ...room, floorColor: color, floorOpacity: opacity }))),
      setBlueprint: (image) =>
        set((s) => mutateActiveRoom(s, 'blueprint', (room) => ({ ...room, blueprint: { image, opacity: 0.5 } }))),
      setBlueprintOpacity: (opacity) =>
        set((s) =>
          mutateActiveRoom(s, 'blueprint-opacity', (room) =>
            room.blueprint ? { ...room, blueprint: { ...room.blueprint, opacity } } : room,
          ),
        ),
      clearBlueprint: () => set((s) => mutateActiveRoom(s, 'blueprint-clear', (room) => ({ ...room, blueprint: null }))),

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
        set((s) =>
          mutateActiveRoom(s, 'upd-obj:' + id, (room) => {
            const cur = room.objects[id];
            if (!cur) return room;
            return { ...room, objects: { ...room.objects, [id]: { ...cur, ...patch } } };
          }),
        ),
      removeObject: (id) => {
        set((s) =>
          mutateActiveRoom(s, 'del-obj', (room) => {
            const objects = { ...room.objects };
            delete objects[id];
            const items = { ...room.items };
            for (const it of Object.values(room.items)) {
              if (it.objectId === id) delete items[it.id];
            }
            return { ...room, objects, items };
          }),
        );
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
      moveObjectToRoom: (objectId, toRoomId) =>
        set((s) => {
          const fromRoom = s.rooms[s.activeRoomId];
          const toRoom = s.rooms[toRoomId];
          if (!fromRoom || !toRoom || fromRoom.id === toRoomId) return {};
          const obj = fromRoom.objects[objectId];
          if (!obj) return {};
          const fallbackLayer = toRoom.layers.find((l) => l.kind === 'object')?.id ?? toRoom.activeLayerId;
          const movedObj: RoomObject = { ...obj, layerId: fallbackLayer };

          const movedItems: Record<string, Item> = {};
          const remainingItems = { ...fromRoom.items };
          for (const it of Object.values(fromRoom.items)) {
            if (it.objectId === objectId) {
              movedItems[it.id] = it;
              delete remainingItems[it.id];
            }
          }

          const newFromObjects = { ...fromRoom.objects };
          delete newFromObjects[objectId];

          const newFromRoom: Room = { ...fromRoom, objects: newFromObjects, items: remainingItems };
          const newToRoom: Room = {
            ...toRoom,
            objects: { ...toRoom.objects, [objectId]: movedObj },
            items: { ...toRoom.items, ...movedItems },
          };

          return {
            ...withHistory(s, 'move-obj-room'),
            rooms: { ...s.rooms, [newFromRoom.id]: newFromRoom, [newToRoom.id]: newToRoom },
            selection: s.selection.filter((sid) => sid !== objectId),
            contextMenu: null,
          };
        }),

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
        set((s) =>
          mutateActiveRoom(s, 'add-item:' + id, (room) => {
            const now = Date.now();
            const siblings = Object.values(room.items).filter(
              (i) => i.objectId === loc.objectId && i.cellKey === loc.cellKey,
            );
            const item: Item = {
              id,
              name: patch?.name ?? 'New item',
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
            return { ...room, items: { ...room.items, [id]: item } };
          }),
        );
        return id;
      },
      updateItem: (id, patch) =>
        set((s) =>
          mutateActiveRoom(s, 'upd-item:' + id, (room) => {
            const cur = room.items[id];
            if (!cur) return room;
            return { ...room, items: { ...room.items, [id]: { ...cur, ...patch, updatedAt: Date.now() } } };
          }),
        ),
      removeItem: (id) =>
        set((s) => ({
          ...mutateActiveRoom(s, 'del-item', (room) => {
            const items = { ...room.items };
            delete items[id];
            return { ...room, items };
          }),
          inspectItemId: s.inspectItemId === id ? null : s.inspectItemId,
        })),
      moveItem: (id, loc) =>
        set((s) =>
          mutateActiveRoom(s, 'move-item', (room) => {
            const cur = room.items[id];
            if (!cur) return room;
            const siblings = Object.values(room.items).filter(
              (i) => i.objectId === loc.objectId && i.cellKey === loc.cellKey && i.id !== id,
            );
            return {
              ...room,
              items: {
                ...room.items,
                [id]: { ...cur, objectId: loc.objectId, cellKey: loc.cellKey, order: siblings.length, updatedAt: Date.now() },
              },
            };
          }),
        ),
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

          return {
            ...withHistory(s, 'move-item-room'),
            rooms: {
              ...s.rooms,
              [fromRoom.id]: { ...fromRoom, items: fromItems },
              [toRoom.id]: { ...toRoom, items: { ...toRoom.items, [itemId]: movedItem } },
            },
            inspectItemId: fromRoom.id === s.activeRoomId ? null : s.inspectItemId,
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
      openPicker: (id) => set({ pickerObjectId: id }),
      closeDrawer: () => set({ openLocation: null, inspectItemId: null }),
      inspectItem: (id) => set({ inspectItemId: id }),
      setSearch: (q) => set({ search: q }),
      setSortMode: (m) => set({ sortMode: m }),
      openContextMenu: (objectId, x, y) => set({ contextMenu: { objectId, x, y }, selection: [objectId] }),
      closeContextMenu: () => set({ contextMenu: null }),

      setWallTool: (tool) => set({ wallTool: tool, wallDraft: tool === 'draw' ? get().wallDraft : null }),
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
        set((s) => ({
          ...mutateActiveRoom(s, 'del-wall', (room) => {
            const walls = { ...room.walls };
            delete walls[wallId];
            const openings = { ...room.openings };
            for (const o of Object.values(room.openings)) {
              if (o.wallId === wallId) delete openings[o.id];
            }
            // Drop vertices left with no remaining wall connections.
            const stillConnected = new Set<string>();
            for (const w of Object.values(walls)) {
              stillConnected.add(w.a);
              stillConnected.add(w.b);
            }
            const vertices = { ...room.vertices };
            for (const vid of Object.keys(vertices)) {
              if (!stillConnected.has(vid)) delete vertices[vid];
            }
            return recomputeFloors({ ...room, walls, openings, vertices });
          }),
          wallSelection: null,
        })),
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
        set((s) =>
          mutateActiveRoom(s, 'add-opening', (room) => {
            const wall = room.walls[wallId];
            if (!wall) return room;
            const length = wallVector(wall, room.vertices).length || 1;
            const width = Math.min(kind === 'door' ? 32 : 30, length * 0.6);
            const halfT = width / 2 / length;
            const clampedT = Math.max(halfT + 0.02, Math.min(1 - halfT - 0.02, t));
            const opening: WallOpening = { id, wallId, kind, t: clampedT, width, swing: 'right', flip: false };
            return { ...room, openings: { ...room.openings, [id]: opening } };
          }),
        );
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
        set((s) => ({
          ...mutateActiveRoom(s, 'del-opening', (room) => {
            const openings = { ...room.openings };
            delete openings[id];
            return { ...room, openings };
          }),
          wallSelection: null,
        })),

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

      restoreFromRecovery: async () => {
        const raw = await localforage.getItem<string>(RECOVERY_KEY);
        if (!raw) return false;
        try {
          const parsed = JSON.parse(raw) as { state: Doc & { activeRoomId: string; settings: Settings } };
          set((s) => ({
            ...withHistory(s, 'restore-recovery'),
            rooms: parsed.state.rooms,
            roomOrder: parsed.state.roomOrder,
            tags: parsed.state.tags,
            activeRoomId: parsed.state.activeRoomId,
            settings: parsed.state.settings,
          }));
          return true;
        } catch {
          return false;
        }
      },

      resetAll: () =>
        set((s) => ({
          ...withHistory(s, 'reset'),
          ...buildDemo(),
          selection: [],
          openLocation: null,
          pickerObjectId: null,
          inspectItemId: null,
          search: '',
          wallSelection: null,
          wallDraft: null,
          wallTool: 'select',
        })),
      requestFitToView: () => set({ fitToViewToken: Date.now() }),
    }),
    {
      name: 'srs-lab-designer-doc',
      version: 1,
      storage: createJSONStorage(() => lfStorage),
      // Persist only the document + user settings — never transient UI or history.
      partialize: (s) => ({
        rooms: s.rooms,
        roomOrder: s.roomOrder,
        activeRoomId: s.activeRoomId,
        tags: s.tags,
        settings: s.settings,
      }),
    },
  ),
);

export function useActiveRoom(): Room {
  return useStore((s) => s.rooms[s.activeRoomId]);
}

// Lightweight periodic recovery snapshot, independent of the main persisted
// key, so the project can be restored even if the primary write is interrupted.
let lastRecoveryRev = -1;
setInterval(() => {
  const s = useStore.getState();
  if (s._rev === lastRecoveryRev) return;
  lastRecoveryRev = s._rev;
  const payload = {
    state: {
      rooms: s.rooms,
      roomOrder: s.roomOrder,
      tags: s.tags,
      activeRoomId: s.activeRoomId,
      settings: s.settings,
    },
    savedAt: Date.now(),
  };
  localforage.setItem(RECOVERY_KEY, JSON.stringify(payload)).catch(() => {});
}, 45000);
