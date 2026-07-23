import type { Room, RoomObject } from '../types';

/** How close (world inches) an edge must be to a candidate line to snap. */
export const SNAP_THRESHOLD_IN = 6;

/** Walls closer to axis-aligned than this (inches, end-to-end) count as
 * straight horizontal/vertical for snapping purposes — a wall drawn a hair
 * off-axis shouldn't stop working as a snap target. */
const WALL_STRAIGHT_EPS = 0.5;

export interface BBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A candidate line to snap to, plus the span it covers (for drawing a guide). */
export interface SnapLine {
  coord: number;
  from: number;
  to: number;
}

export interface SnapLines {
  vertical: SnapLine[];
  horizontal: SnapLine[];
}

export interface SnapGuideV {
  x: number;
  y0: number;
  y1: number;
}

export interface SnapGuideH {
  y: number;
  x0: number;
  x1: number;
}

export interface SnapGuides {
  v: SnapGuideV | null;
  h: SnapGuideH | null;
}

export const NO_SNAP_GUIDES: SnapGuides = { v: null, h: null };

/** Axis-aligned world-space bounding box of an object, accounting for rotation. */
export function objectBBox(obj: Pick<RoomObject, 'x' | 'y' | 'width' | 'height' | 'rotation'>): BBox {
  const rad = (obj.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = obj.width / 2;
  const hh = obj.height / 2;
  const cx = obj.x + hw;
  const cy = obj.y + hh;
  const corners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const rx = cx + x * cos - y * sin;
    const ry = cy + x * sin + y * cos;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  return { left: minX, right: maxX, top: minY, bottom: maxY };
}

/**
 * Every horizontal/vertical wall face and object edge in the room a dragged
 * or resized object's own edges can snap to — everything except `excludeId`
 * itself. Diagonal walls are skipped: only edges parallel to the object's
 * own (axis-aligned) edges are useful snap targets.
 */
export function collectSnapLines(room: Room, excludeId: string | null): SnapLines {
  const vertical: SnapLine[] = [];
  const horizontal: SnapLine[] = [];

  for (const wall of Object.values(room.walls)) {
    const a = room.vertices[wall.a];
    const b = room.vertices[wall.b];
    if (!a || !b) continue;
    if (Math.abs(a.y - b.y) < WALL_STRAIGHT_EPS) {
      horizontal.push({ coord: (a.y + b.y) / 2, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) });
    } else if (Math.abs(a.x - b.x) < WALL_STRAIGHT_EPS) {
      vertical.push({ coord: (a.x + b.x) / 2, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) });
    }
  }

  for (const obj of Object.values(room.objects)) {
    if (obj.id === excludeId) continue;
    const bbox = objectBBox(obj);
    vertical.push({ coord: bbox.left, from: bbox.top, to: bbox.bottom });
    vertical.push({ coord: bbox.right, from: bbox.top, to: bbox.bottom });
    horizontal.push({ coord: bbox.top, from: bbox.left, to: bbox.right });
    horizontal.push({ coord: bbox.bottom, from: bbox.left, to: bbox.right });
  }

  return { vertical, horizontal };
}

export interface TranslateSnap {
  dx: number;
  dy: number;
  guides: SnapGuides;
}

/**
 * Snaps a bbox by translation — both the left+right edges shift together, so
 * whichever vertical edge (left or right) is closest to a line wins; same
 * for top/bottom horizontally. Used while dragging/moving an object, where
 * the whole shape moves as one rigid body.
 */
export function snapTranslate(bbox: BBox, lines: SnapLines, threshold = SNAP_THRESHOLD_IN): TranslateSnap {
  let dx = 0;
  let dy = 0;
  let guideV: SnapGuideV | null = null;
  let guideH: SnapGuideH | null = null;
  let bestV = threshold;
  let bestH = threshold;

  for (const line of lines.vertical) {
    for (const edge of [bbox.left, bbox.right]) {
      const d = Math.abs(edge - line.coord);
      if (d < bestV) {
        bestV = d;
        dx = line.coord - edge;
        guideV = { x: line.coord, y0: Math.min(bbox.top, line.from), y1: Math.max(bbox.bottom, line.to) };
      }
    }
  }
  for (const line of lines.horizontal) {
    for (const edge of [bbox.top, bbox.bottom]) {
      const d = Math.abs(edge - line.coord);
      if (d < bestH) {
        bestH = d;
        dy = line.coord - edge;
        guideH = { y: line.coord, x0: Math.min(bbox.left, line.from), x1: Math.max(bbox.right, line.to) };
      }
    }
  }

  return { dx, dy, guides: { v: guideV, h: guideH } };
}

export interface EdgeSnap extends BBox {
  guides: SnapGuides;
}

/**
 * Snaps a bbox's edges independently — used while resizing. Only edges that
 * differ from `stationary` (the pre-resize reference box) are tested, so the
 * anchor corner you're not dragging never spuriously jumps to a nearby line.
 */
export function snapEdges(bbox: BBox, stationary: BBox, lines: SnapLines, threshold = SNAP_THRESHOLD_IN): EdgeSnap {
  const EPS = 0.05;
  let { left, right, top, bottom } = bbox;
  let guideV: SnapGuideV | null = null;
  let guideH: SnapGuideH | null = null;

  if (Math.abs(bbox.left - stationary.left) > EPS) {
    let best = threshold;
    for (const line of lines.vertical) {
      const d = Math.abs(bbox.left - line.coord);
      if (d < best) {
        best = d;
        left = line.coord;
        guideV = { x: line.coord, y0: Math.min(top, line.from), y1: Math.max(bottom, line.to) };
      }
    }
  }
  if (Math.abs(bbox.right - stationary.right) > EPS) {
    let best = threshold;
    for (const line of lines.vertical) {
      const d = Math.abs(bbox.right - line.coord);
      if (d < best) {
        best = d;
        right = line.coord;
        guideV = { x: line.coord, y0: Math.min(top, line.from), y1: Math.max(bottom, line.to) };
      }
    }
  }
  if (Math.abs(bbox.top - stationary.top) > EPS) {
    let best = threshold;
    for (const line of lines.horizontal) {
      const d = Math.abs(bbox.top - line.coord);
      if (d < best) {
        best = d;
        top = line.coord;
        guideH = { y: line.coord, x0: Math.min(left, line.from), x1: Math.max(right, line.to) };
      }
    }
  }
  if (Math.abs(bbox.bottom - stationary.bottom) > EPS) {
    let best = threshold;
    for (const line of lines.horizontal) {
      const d = Math.abs(bbox.bottom - line.coord);
      if (d < best) {
        best = d;
        bottom = line.coord;
        guideH = { y: line.coord, x0: Math.min(left, line.from), x1: Math.max(right, line.to) };
      }
    }
  }

  return { left, right, top, bottom, guides: { v: guideV, h: guideH } };
}
