import type { Room, Layer, RoomObject, WallVertex, WallSegment, WallOpening, CameraState } from '../types';
import { MAX_GRID_SIZE } from './shelf';

export const ROOM_FILE_FORMAT = 'srs-lab-designer-room';
export const ROOM_FILE_VERSION = 1;

/**
 * The subset of a Room that defines its design — layout, walls, furniture
 * positions, and camera framing — deliberately excluding `items` (the actual
 * inventory contents), which stay local to the workspace they were logged in.
 */
export interface RoomFilePayload {
  fileFormat: typeof ROOM_FILE_FORMAT;
  fileVersion: number;
  name: string;
  layers: Layer[];
  activeLayerId: string;
  objects: Record<string, RoomObject>;
  vertices: Record<string, WallVertex>;
  walls: Record<string, WallSegment>;
  openings: Record<string, WallOpening>;
  floorColor: string;
  floorOpacity: number;
  camera: CameraState;
}

export function roomToFilePayload(room: Room): RoomFilePayload {
  return {
    fileFormat: ROOM_FILE_FORMAT,
    fileVersion: ROOM_FILE_VERSION,
    name: room.name,
    layers: room.layers,
    activeLayerId: room.activeLayerId,
    objects: room.objects,
    vertices: room.vertices,
    walls: room.walls,
    openings: room.openings,
    floorColor: room.floorColor,
    floorOpacity: room.floorOpacity,
    camera: room.camera,
  };
}

function sanitizeFilename(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  return cleaned || 'Room';
}

/** Triggers a browser download of a room's design as a `[name].json` file. */
export function downloadRoomFile(room: Room): void {
  const payload = roomToFilePayload(room);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(room.name)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Validation — every check below throws a specific, human-readable Error.
// Callers (RoomNavigator's import handler) catch this and show `err.message`
// directly, so messages are written for the end user, not a developer log.
// ---------------------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateLayers(v: unknown): asserts v is Layer[] {
  if (!Array.isArray(v) || v.length === 0) throw new Error("That room design file is missing its layers.");
  for (const l of v) {
    if (
      !isPlainObject(l) ||
      typeof l.id !== 'string' ||
      typeof l.name !== 'string' ||
      typeof l.visible !== 'boolean' ||
      (l.kind !== 'object' && l.kind !== 'wall')
    ) {
      throw new Error("That room design file has a corrupted layer definition.");
    }
  }
}

function validateStorage(storage: unknown, objectLabel: string): void {
  if (!isPlainObject(storage) || (storage.type !== 'single' && storage.type !== 'grid')) {
    throw new Error(`"${objectLabel}" has an invalid storage definition.`);
  }
  if (storage.type === 'single') return;

  const rows = storage.rows;
  const cols = storage.cols;
  if (!isFiniteNumber(rows) || !isFiniteNumber(cols) || rows < 1 || cols < 1 || rows > MAX_GRID_SIZE || cols > MAX_GRID_SIZE) {
    throw new Error(`"${objectLabel}" has a storage grid outside the supported 1–${MAX_GRID_SIZE} range.`);
  }
  if (!Array.isArray(storage.rowFractions) || !Array.isArray(storage.colFractions)) {
    throw new Error(`"${objectLabel}" is missing its shelf proportions.`);
  }
  if (!isPlainObject(storage.cells)) {
    throw new Error(`"${objectLabel}" is missing its compartment list.`);
  }
  if (storage.merges !== undefined) {
    if (!isPlainObject(storage.merges)) throw new Error(`"${objectLabel}" has an invalid merged-compartment list.`);
    for (const span of Object.values(storage.merges)) {
      if (!isPlainObject(span) || !isFiniteNumber(span.rowSpan) || !isFiniteNumber(span.colSpan) || span.rowSpan < 1 || span.colSpan < 1) {
        throw new Error(`"${objectLabel}" has an invalid merged compartment.`);
      }
    }
  }
}

function validateObjects(v: unknown): asserts v is Record<string, RoomObject> {
  if (!isPlainObject(v)) throw new Error("That room design file has a corrupted furniture list.");
  for (const [key, raw] of Object.entries(v)) {
    if (!isPlainObject(raw)) throw new Error(`Furniture item "${key}" is corrupted.`);
    const label = typeof raw.name === 'string' ? raw.name : key;
    if (
      typeof raw.id !== 'string' ||
      typeof raw.name !== 'string' ||
      typeof raw.kind !== 'string' ||
      !isFiniteNumber(raw.x) ||
      !isFiniteNumber(raw.y) ||
      !isFiniteNumber(raw.width) ||
      !isFiniteNumber(raw.height) ||
      !isFiniteNumber(raw.rotation) ||
      typeof raw.fill !== 'string' ||
      !isFiniteNumber(raw.cornerRadius) ||
      typeof raw.layerId !== 'string'
    ) {
      throw new Error(`"${label}" is missing required fields.`);
    }
    validateStorage(raw.storage, label);
  }
}

function validateVertices(v: unknown): asserts v is Record<string, WallVertex> {
  if (!isPlainObject(v)) throw new Error("That room design file has a corrupted wall-vertex list.");
  for (const [key, raw] of Object.entries(v)) {
    if (!isPlainObject(raw) || typeof raw.id !== 'string' || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) {
      throw new Error(`Wall vertex "${key}" is corrupted.`);
    }
  }
}

function validateWalls(v: unknown): asserts v is Record<string, WallSegment> {
  if (!isPlainObject(v)) throw new Error("That room design file has a corrupted wall list.");
  for (const [key, raw] of Object.entries(v)) {
    if (
      !isPlainObject(raw) ||
      typeof raw.id !== 'string' ||
      typeof raw.a !== 'string' ||
      typeof raw.b !== 'string' ||
      raw.a === raw.b ||
      !isFiniteNumber(raw.thickness) ||
      typeof raw.curved !== 'boolean' ||
      !isFiniteNumber(raw.curveOffset)
    ) {
      throw new Error(`Wall "${key}" is corrupted.`);
    }
  }
}

function validateOpenings(v: unknown): asserts v is Record<string, WallOpening> {
  if (!isPlainObject(v)) throw new Error("That room design file has a corrupted door/window list.");
  for (const [key, raw] of Object.entries(v)) {
    if (
      !isPlainObject(raw) ||
      typeof raw.id !== 'string' ||
      typeof raw.wallId !== 'string' ||
      (raw.kind !== 'door' && raw.kind !== 'window') ||
      !isFiniteNumber(raw.t) ||
      !isFiniteNumber(raw.width)
    ) {
      throw new Error(`Door/window "${key}" is corrupted.`);
    }
  }
}

function validateCamera(v: unknown): asserts v is CameraState {
  if (!isPlainObject(v) || !isFiniteNumber(v.x) || !isFiniteNumber(v.y) || !isFiniteNumber(v.scale)) {
    throw new Error("That room design file has a corrupted camera position.");
  }
}

/**
 * Parses and validates a room-design file's raw text. Throws a descriptive
 * Error if the file isn't a recognizable, structurally-sound room-design
 * export — callers should catch this and show `err.message` directly to the
 * user rather than letting a malformed file crash the import.
 */
export function parseRoomFile(text: string): RoomFilePayload {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!isPlainObject(data)) {
    throw new Error("That file isn't a room design export.");
  }
  if (data.fileFormat !== ROOM_FILE_FORMAT) {
    throw new Error("That file isn't a room design export from SRS Inventory.");
  }
  if (!isFiniteNumber(data.fileVersion) || data.fileVersion < 1) {
    throw new Error("That room design file has an invalid or missing version number.");
  }
  if (data.fileVersion > ROOM_FILE_VERSION) {
    throw new Error("That file was exported by a newer version of SRS Inventory — update the app to import it.");
  }
  if (typeof data.name !== 'string' || !data.name.trim()) {
    throw new Error("That room design file is missing a room name.");
  }

  validateLayers(data.layers);
  if (typeof data.activeLayerId !== 'string') {
    throw new Error("That room design file has a corrupted active-layer reference.");
  }
  validateObjects(data.objects);
  validateVertices(data.vertices);
  validateWalls(data.walls);
  validateOpenings(data.openings);
  if (typeof data.floorColor !== 'string' || !isFiniteNumber(data.floorOpacity)) {
    throw new Error("That room design file has a corrupted floor style.");
  }
  validateCamera(data.camera);

  return data as unknown as RoomFilePayload;
}
