// ---------------------------------------------------------------------------
// Core domain model
//
// Everything in the app is expressed in a single canonical unit: inches.
// The UI converts to/from the user's chosen display unit at the edges only.
// ---------------------------------------------------------------------------

export type Unit = 'in' | 'ft' | 'cm' | 'm';

export type ObjectKind = 'rect' | 'roundedRect' | 'circle' | 'text' | 'container';

/** A named layer, Figma-style. Objects belong to exactly one layer. */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  /** 'wall' layers activate Wall Designer Mode when made active. Exactly one per room. */
  kind: 'object' | 'wall';
}

/** A merged compartment's extent, in base-cell units, anchored at its top-left cell. */
export interface CellMerge {
  rowSpan: number;
  colSpan: number;
}

/**
 * Storage describes the "inside" of a room object.
 *  - `single`  → one location, conceptually the object's surface.
 *  - `grid`    → a shelf/cabinet split into rows × columns of compartments.
 *                Each cell is an independent storage location, unless
 *                merged with its neighbors (see `merges`).
 */
export type Storage =
  | { type: 'single' }
  | {
      type: 'grid';
      rows: number; // 1..20
      cols: number; // 1..20
      /** Relative row heights, length === rows, sums are normalised on read. */
      rowFractions: number[];
      /** Relative column widths, length === cols. */
      colFractions: number[];
      /** Per-cell metadata keyed by `${row}:${col}`. */
      cells: Record<string, CellMeta>;
      /** Merged compartments, keyed by the top-left cell's `${row}:${col}`.
       * Every other cell within the span is "covered" — it has no
       * independent identity while the merge exists (not addressable by
       * item storage, not returned by `gridCells()`). Absent/undefined
       * means no merges, so existing saved data is already valid. */
      merges?: Record<string, CellMerge>;
    };

export interface CellMeta {
  name: string;
  kind: 'shelf' | 'drawer';
}

export interface RoomObject {
  id: string;
  name: string;
  kind: ObjectKind;
  /** Top-left position of the footprint in world inches. */
  x: number;
  y: number;
  /** Footprint width in inches (screen-horizontal before rotation). */
  width: number;
  /** Footprint height/depth in inches (screen-vertical before rotation). */
  height: number;
  /** Physical vertical extent (height) in inches. */
  depthIn: number;
  rotation: number;
  fill: string;
  cornerRadius: number;
  notes: string;
  layerId: string;
  storage: Storage;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Item {
  id: string;
  name: string;
  /** Data-URL of the item photo, if any. */
  image?: string;
  quantity: number;
  tagIds: string[];

  // Optional fields — never required.
  notes?: string;
  widthIn?: number;
  heightIn?: number;
  depthIn?: number;
  purchaseDate?: string;
  value?: number;
  serial?: string;

  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;

  // Physical home.
  objectId: string;
  /** `surface` for single storage, or `${row}:${col}` for grid storage. */
  cellKey: string;
  /** Manual sort order within the cell. */
  order: number;
}

export type SortMode =
  | 'manual'
  | 'alpha'
  | 'recent-added'
  | 'recent-used'
  | 'quantity'
  | 'color';

/**
 * Design Mode is for building/arranging the space; Inventory Mode is for
 * browsing and managing what's stored inside it. The two are mutually
 * exclusive on purpose — each hides the other's tools to keep the interface
 * focused, and Inventory Mode disables furniture-layout edits so browsing
 * never accidentally reshapes the room.
 */
export type AppMode = 'design' | 'inventory';

export interface Settings {
  units: Unit;
  gridVisible: boolean;
  snapToGrid: boolean;
  /** Global override — show every object's label regardless of hover state. */
  showAllLabels: boolean;
  /** Preview containers' internal compartment layout (shelf/drawer/grid
   * divisions) directly on the canvas, without opening them. */
  showCompartments: boolean;
  /** Default thickness (inches) applied to newly-drawn walls. */
  wallThickness: number;
  mode: AppMode;
}

/** A single location reference: an object + one of its cells. */
export interface LocationRef {
  objectId: string;
  cellKey: string;
}

// ---------------------------------------------------------------------------
// Walls, doors, windows, floors
// ---------------------------------------------------------------------------

export interface WallVertex {
  id: string;
  x: number;
  y: number;
}

export interface WallSegment {
  id: string;
  a: string; // vertex id
  b: string; // vertex id
  thickness: number; // inches
  curved: boolean;
  /** Perpendicular offset (inches) of the bezier control point; ignored unless curved. */
  curveOffset: number;
}

export interface WallOpening {
  id: string;
  wallId: string;
  kind: 'door' | 'window';
  /** Position along the wall from vertex a to b, 0..1. */
  t: number;
  width: number; // inches
}

export interface FloorPolygon {
  id: string;
  /** Ordered loop of vertex ids forming the enclosed polygon. */
  vertexIds: string[];
}

export interface CameraState {
  x: number;
  y: number;
  scale: number;
}

export interface Room {
  id: string;
  name: string;
  order: number;

  objects: Record<string, RoomObject>;
  items: Record<string, Item>;
  layers: Layer[];
  activeLayerId: string;

  vertices: Record<string, WallVertex>;
  walls: Record<string, WallSegment>;
  openings: Record<string, WallOpening>;
  floors: FloorPolygon[];
  floorColor: string;
  floorOpacity: number;

  camera: CameraState;
}

// ---------------------------------------------------------------------------
// Users, change tracking, save state, project metadata
// ---------------------------------------------------------------------------

/** A lightweight local identity — for attribution, not authentication. */
export interface User {
  id: string;
  name: string;
  email: string;
}

export type LogScope = 'inventory' | 'room' | 'wall' | 'object' | 'layer';

export type LogAction =
  | 'created'
  | 'deleted'
  | 'quantity_changed'
  | 'moved'
  | 'renamed'
  | 'notes_edited'
  | 'edited'
  | 'checked_out'
  | 'returned';

/** A single attributed change, feeding the Inventory Log (and, later, any
 * broader activity view). Kept flat and self-describing so an entry still
 * reads sensibly even after the item/room/wall it refers to is gone. */
export interface LogEntry {
  id: string;
  timestamp: number;
  userName: string;
  userEmail: string;
  scope: LogScope;
  action: LogAction;
  /** Id of the item/room/wall/object this entry is about, used only to
   * coalesce a burst of rapid edits (e.g. typing) into a single entry. */
  entityId: string;
  /** Human-readable subject, e.g. the item or room name at the time. */
  subject: string;
  roomId?: string;
  roomName?: string;
  previousValue?: string;
  newValue?: string;
  detail?: string;
}

/**
 * A quantity of an item taken out of its physical location into a user's
 * personal ("on me") inventory, until they return it. Kept flat and
 * self-describing like LogEntry, so a checkout still reads sensibly even
 * if the item or room it came from is later renamed or removed.
 */
export interface Checkout {
  id: string;
  itemId: string;
  itemName: string;
  roomId: string;
  roomName: string;
  /** The item's location at the moment it was taken — the default return target. */
  objectId: string;
  cellKey: string;
  userId: string;
  userName: string;
  userEmail: string;
  quantity: number;
  takenAt: number;
}

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
}
