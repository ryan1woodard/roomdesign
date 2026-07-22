import type { Room, Layer, RoomObject, WallVertex, WallSegment, WallOpening, CameraState } from '../types';

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

/**
 * Parses and validates a room-design file's raw text. Throws a descriptive
 * Error if the file isn't a recognizable room-design export — callers should
 * catch this and show `err.message` directly to the user.
 */
export function parseRoomFile(text: string): RoomFilePayload {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error("That file isn't a room design export.");
  }
  const d = data as Record<string, unknown>;
  if (d.fileFormat !== ROOM_FILE_FORMAT) {
    throw new Error("That file isn't a room design export from SRS Lab Designer.");
  }
  if (typeof d.name !== 'string' || typeof d.objects !== 'object' || d.objects === null || !Array.isArray(d.layers)) {
    throw new Error('That room design file looks corrupted or incomplete.');
  }
  return d as unknown as RoomFilePayload;
}
