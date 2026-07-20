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
} from '../types';
import { buildDemo } from './demo';

localforage.config({ name: 'roomcraft', storeName: 'state' });

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
  objects: Record<string, RoomObject>;
  items: Record<string, Item>;
  tags: Record<string, Tag>;
  layers: Layer[];
}

interface AppState extends Doc {
  settings: Settings;
  activeLayerId: string;

  // Transient (not persisted)
  selection: string[];
  openLocation: LocationRef | null;
  pickerObjectId: string | null;
  search: string;
  sortMode: SortMode;
  inspectItemId: string | null;

  // History (not persisted)
  past: Doc[];
  future: Doc[];
  _histAt: number;
  _histKey: string;

  // Settings actions
  setUnit: (u: Settings['units']) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  toggleSpaceAwareness: () => void;

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

  // Selection
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;

  // Items
  addItem: (loc: LocationRef, patch?: Partial<Item>) => string;
  updateItem: (id: string, patch: Partial<Item>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, loc: LocationRef) => void;
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

  // History
  undo: () => void;
  redo: () => void;

  resetAll: () => void;
}

function snapshot(s: AppState): Doc {
  return { objects: s.objects, items: s.items, tags: s.tags, layers: s.layers };
}

/**
 * Returns the state patch that records a history checkpoint. Rapid successive
 * mutations sharing a key within 500ms coalesce into a single undo step, so
 * a drag or a burst of typing becomes one entry automatically.
 */
function withHistory(s: AppState, key: string): Partial<AppState> {
  const now = Date.now();
  if (s._histKey === key && now - s._histAt < 500) {
    return { _histAt: now };
  }
  return {
    past: [...s.past, snapshot(s)].slice(-80),
    future: [],
    _histAt: now,
    _histKey: key,
  };
}

const DEFAULT_FILL = '#3b4a63';

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...buildDemo(),
      settings: { units: 'in', gridVisible: true, snapToGrid: true, spaceAwareness: false },
      activeLayerId: 'layer-main',

      selection: [],
      openLocation: null,
      pickerObjectId: null,
      search: '',
      sortMode: 'manual',
      inspectItemId: null,

      past: [],
      future: [],
      _histAt: 0,
      _histKey: '',

      setUnit: (units) => set((s) => ({ settings: { ...s.settings, units } })),
      toggleGrid: () => set((s) => ({ settings: { ...s.settings, gridVisible: !s.settings.gridVisible } })),
      toggleSnap: () => set((s) => ({ settings: { ...s.settings, snapToGrid: !s.settings.snapToGrid } })),
      toggleSpaceAwareness: () =>
        set((s) => ({ settings: { ...s.settings, spaceAwareness: !s.settings.spaceAwareness } })),

      addLayer: (name) =>
        set((s) => {
          const layer: Layer = { id: `layer-${nanoid(6)}`, name: name || `Layer ${s.layers.length + 1}`, visible: true };
          return { ...withHistory(s, 'add-layer'), layers: [...s.layers, layer], activeLayerId: layer.id };
        }),
      renameLayer: (id, name) =>
        set((s) => ({
          ...withHistory(s, 'rename-layer:' + id),
          layers: s.layers.map((l) => (l.id === id ? { ...l, name } : l)),
        })),
      toggleLayer: (id) =>
        set((s) => ({
          ...withHistory(s, 'toggle-layer'),
          layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
        })),
      deleteLayer: (id) =>
        set((s) => {
          if (s.layers.length <= 1) return {};
          const layers = s.layers.filter((l) => l.id !== id);
          // Reassign orphaned objects to the first remaining layer.
          const fallback = layers[0].id;
          const objects = { ...s.objects };
          for (const o of Object.values(objects)) {
            if (o.layerId === id) objects[o.id] = { ...o, layerId: fallback };
          }
          return {
            ...withHistory(s, 'del-layer'),
            layers,
            objects,
            activeLayerId: s.activeLayerId === id ? fallback : s.activeLayerId,
          };
        }),
      reorderLayer: (id, dir) =>
        set((s) => {
          const idx = s.layers.findIndex((l) => l.id === id);
          const next = idx + dir;
          if (idx < 0 || next < 0 || next >= s.layers.length) return {};
          const layers = [...s.layers];
          [layers[idx], layers[next]] = [layers[next], layers[idx]];
          return { ...withHistory(s, 'reorder-layer'), layers };
        }),
      setActiveLayer: (id) => set({ activeLayerId: id }),

      addObject: (kind, at) => {
        const id = `obj-${nanoid(8)}`;
        set((s) => {
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
            layerId: s.activeLayerId,
            storage: isContainer
              ? { type: 'grid', rows: 3, cols: 3, rowFractions: [1, 1, 1], colFractions: [1, 1, 1], cells: {} }
              : { type: 'single' },
          };
          return { ...withHistory(s, 'add-obj:' + id), objects: { ...s.objects, [id]: obj }, selection: [id] };
        });
        return id;
      },
      updateObject: (id, patch) =>
        set((s) => {
          const cur = s.objects[id];
          if (!cur) return {};
          return {
            ...withHistory(s, 'upd-obj:' + id),
            objects: { ...s.objects, [id]: { ...cur, ...patch } },
          };
        }),
      removeObject: (id) =>
        set((s) => {
          const objects = { ...s.objects };
          delete objects[id];
          const items = { ...s.items };
          for (const it of Object.values(s.items)) {
            if (it.objectId === id) delete items[it.id];
          }
          return {
            ...withHistory(s, 'del-obj'),
            objects,
            items,
            selection: s.selection.filter((x) => x !== id),
          };
        }),
      duplicateObject: (id) => {
        const src = get().objects[id];
        if (!src) return null;
        const newId = `obj-${nanoid(8)}`;
        set((s) => ({
          ...withHistory(s, 'dup-obj'),
          objects: {
            ...s.objects,
            [newId]: { ...src, id: newId, name: `${src.name} copy`, x: src.x + 16, y: src.y + 16 },
          },
          selection: [newId],
        }));
        return newId;
      },
      setStorage: (id, storage) =>
        set((s) => {
          const cur = s.objects[id];
          if (!cur) return {};
          return { ...withHistory(s, 'set-storage:' + id), objects: { ...s.objects, [id]: { ...cur, storage } } };
        }),

      setSelection: (ids) => set({ selection: ids }),
      clearSelection: () => set({ selection: [] }),

      addItem: (loc, patch) => {
        const id = `item-${nanoid(8)}`;
        set((s) => {
          const now = Date.now();
          const siblings = Object.values(s.items).filter(
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
          return { ...withHistory(s, 'add-item:' + id), items: { ...s.items, [id]: item } };
        });
        return id;
      },
      updateItem: (id, patch) =>
        set((s) => {
          const cur = s.items[id];
          if (!cur) return {};
          return {
            ...withHistory(s, 'upd-item:' + id),
            items: { ...s.items, [id]: { ...cur, ...patch, updatedAt: Date.now() } },
          };
        }),
      removeItem: (id) =>
        set((s) => {
          const items = { ...s.items };
          delete items[id];
          return {
            ...withHistory(s, 'del-item'),
            items,
            inspectItemId: s.inspectItemId === id ? null : s.inspectItemId,
          };
        }),
      moveItem: (id, loc) =>
        set((s) => {
          const cur = s.items[id];
          if (!cur) return {};
          const siblings = Object.values(s.items).filter(
            (i) => i.objectId === loc.objectId && i.cellKey === loc.cellKey && i.id !== id,
          );
          return {
            ...withHistory(s, 'move-item'),
            items: {
              ...s.items,
              [id]: { ...cur, objectId: loc.objectId, cellKey: loc.cellKey, order: siblings.length, updatedAt: Date.now() },
            },
          };
        }),
      setItemOrder: (orderedIds) =>
        set((s) => {
          const items = { ...s.items };
          orderedIds.forEach((id, idx) => {
            if (items[id]) items[id] = { ...items[id], order: idx };
          });
          return { ...withHistory(s, 'reorder-items'), items };
        }),
      markUsed: (id) =>
        set((s) => {
          const cur = s.items[id];
          if (!cur) return {};
          return { items: { ...s.items, [id]: { ...cur, lastUsedAt: Date.now() } } };
        }),

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
          const items = { ...s.items };
          for (const it of Object.values(items)) {
            if (it.tagIds.includes(id)) items[it.id] = { ...it, tagIds: it.tagIds.filter((t) => t !== id) };
          }
          return { ...withHistory(s, 'del-tag'), tags, items };
        }),

      open: (loc) => set({ openLocation: loc, pickerObjectId: null, inspectItemId: null }),
      openPicker: (id) => set({ pickerObjectId: id }),
      closeDrawer: () => set({ openLocation: null, inspectItemId: null }),
      inspectItem: (id) => set({ inspectItemId: id }),
      setSearch: (q) => set({ search: q }),
      setSortMode: (m) => set({ sortMode: m }),

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
          };
        }),

      resetAll: () =>
        set((s) => ({
          ...withHistory(s, 'reset'),
          ...buildDemo(),
          selection: [],
          openLocation: null,
          inspectItemId: null,
          search: '',
        })),
    }),
    {
      name: 'roomcraft-doc',
      version: 1,
      storage: createJSONStorage(() => lfStorage),
      // Persist only the document + user settings — never transient UI or history.
      partialize: (s) => ({
        objects: s.objects,
        items: s.items,
        tags: s.tags,
        layers: s.layers,
        settings: s.settings,
        activeLayerId: s.activeLayerId,
      }),
    },
  ),
);
