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

/**
 * Storage describes the "inside" of a room object.
 *  - `single`  → one location, conceptually the object's surface.
 *  - `grid`    → a shelf/cabinet split into rows × columns of compartments.
 *                Each cell is an independent storage location.
 */
export type Storage =
  | { type: 'single' }
  | {
      type: 'grid';
      rows: number;
      cols: number;
      /** Relative row heights, length === rows, sums are normalised on read. */
      rowFractions: number[];
      /** Relative column widths, length === cols. */
      colFractions: number[];
      /** Per-cell metadata keyed by `${row}:${col}`. */
      cells: Record<string, CellMeta>;
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
  /** Physical vertical extent in inches — used for space-awareness volume. */
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

export interface Settings {
  units: Unit;
  gridVisible: boolean;
  snapToGrid: boolean;
  spaceAwareness: boolean;
  /** Global override — show every object's label regardless of hover state. */
  showAllLabels: boolean;
  /** Default thickness (inches) applied to newly-drawn walls. */
  wallThickness: number;
  /** Snap wall drawing/dragging to 15° increments. */
  wallAngleSnap: boolean;
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

export interface Blueprint {
  image: string; // data URL
  opacity: number;
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
  notes: string;

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
  blueprint: Blueprint | null;
}
