import { nanoid } from 'nanoid';
import type { WallVertex, WallSegment, WallOpening, FloorPolygon } from '../types';

export const VERTEX_SNAP_IN = 8; // inches — snap distance when drawing/dragging vertices
export const ANGLE_SNAP_DEG = 15;

export interface WallGraph {
  vertices: Record<string, WallVertex>;
  walls: Record<string, WallSegment>;
  openings: Record<string, WallOpening>;
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Find an existing vertex within snap radius of a point, if any. */
export function findSnapVertex(
  vertices: Record<string, WallVertex>,
  point: { x: number; y: number },
  radius = VERTEX_SNAP_IN,
  exclude?: string,
): WallVertex | null {
  let best: WallVertex | null = null;
  let bestD = radius;
  for (const v of Object.values(vertices)) {
    if (v.id === exclude) continue;
    const d = dist(v, point);
    if (d <= bestD) {
      best = v;
      bestD = d;
    }
  }
  return best;
}

/** Snap an angle (from `origin` to `point`) to the nearest 15° increment, preserving distance. */
export function snapAngle(origin: { x: number; y: number }, point: { x: number; y: number }): { x: number; y: number } {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.0001) return point;
  const angle = Math.atan2(dy, dx);
  const step = (ANGLE_SNAP_DEG * Math.PI) / 180;
  const snapped = Math.round(angle / step) * step;
  return { x: origin.x + Math.cos(snapped) * len, y: origin.y + Math.sin(snapped) * len };
}

export function wallVector(wall: WallSegment, vertices: Record<string, WallVertex>) {
  const a = vertices[wall.a];
  const b = vertices[wall.b];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  return { a, b, dx, dy, length, angle: Math.atan2(dy, dx) };
}

/** Point along a wall at parameter t (0..1), following its curve if any. */
export function wallPointAt(wall: WallSegment, vertices: Record<string, WallVertex>, t: number): { x: number; y: number } {
  const a = vertices[wall.a];
  const b = vertices[wall.b];
  if (!wall.curved || wall.curveOffset === 0) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  const ctrl = curveControlPoint(wall, vertices);
  const mt = 1 - t;
  return {
    x: mt * mt * a.x + 2 * mt * t * ctrl.x + t * t * b.x,
    y: mt * mt * a.y + 2 * mt * t * ctrl.y + t * t * b.y,
  };
}

/** The quadratic bezier control point for a curved wall. */
export function curveControlPoint(wall: WallSegment, vertices: Record<string, WallVertex>): { x: number; y: number } {
  const a = vertices[wall.a];
  const b = vertices[wall.b];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular unit vector.
  const nx = -dy / len;
  const ny = dx / len;
  return { x: mx + nx * wall.curveOffset, y: my + ny * wall.curveOffset };
}

/** Local tangent angle at parameter t, used to orient doors/windows on curved walls. */
export function wallAngleAt(wall: WallSegment, vertices: Record<string, WallVertex>, t: number): number {
  if (!wall.curved || wall.curveOffset === 0) {
    return wallVector(wall, vertices).angle;
  }
  const a = vertices[wall.a];
  const b = vertices[wall.b];
  const ctrl = curveControlPoint(wall, vertices);
  const mt = 1 - t;
  // Derivative of quadratic bezier.
  const dx = 2 * mt * (ctrl.x - a.x) + 2 * t * (b.x - ctrl.x);
  const dy = 2 * mt * (ctrl.y - a.y) + 2 * t * (b.y - ctrl.y);
  return Math.atan2(dy, dx);
}

export interface WallCandidate {
  point: { x: number; y: number };
  snappedVertexId: string | null;
  willClose: boolean;
}

/**
 * Given the wall currently being drawn (or none) and a raw pointer position,
 * compute the resolved point: angle-snapped, then snapped onto any existing
 * vertex within range. Shared by the store (to commit) and the canvas (to
 * preview) so the two can never disagree.
 */
export function computeWallCandidate(
  vertices: Record<string, WallVertex>,
  draft: { startVertexId: string; lastVertexId: string } | null,
  rawPoint: { x: number; y: number },
  angleSnapOn: boolean,
): WallCandidate {
  if (!draft) {
    const snapped = findSnapVertex(vertices, rawPoint);
    return { point: snapped ?? rawPoint, snappedVertexId: snapped?.id ?? null, willClose: false };
  }
  const lastVertex = vertices[draft.lastVertexId];
  const angled = angleSnapOn ? snapAngle(lastVertex, rawPoint) : rawPoint;
  const snapped = findSnapVertex(vertices, angled, undefined, draft.lastVertexId);
  const willClose = !!snapped && snapped.id === draft.startVertexId && draft.lastVertexId !== draft.startVertexId;
  return { point: snapped ? { x: snapped.x, y: snapped.y } : angled, snappedVertexId: snapped?.id ?? null, willClose };
}

/** Parametric t (0..1, clamped) of the closest point on a wall to `point`. */
export function projectPointOnWall(wall: WallSegment, vertices: Record<string, WallVertex>, point: { x: number; y: number }): number {
  if (!wall.curved || wall.curveOffset === 0) {
    const a = vertices[wall.a];
    const b = vertices[wall.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy || 1;
    const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
    return Math.max(0, Math.min(1, t));
  }
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const p = wallPointAt(wall, vertices, t);
    const d = dist(p, point);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  return bestT;
}

/** Perpendicular distance (inches) from `point` to the nearest point on the wall. */
export function distanceToWall(wall: WallSegment, vertices: Record<string, WallVertex>, point: { x: number; y: number }): number {
  const t = projectPointOnWall(wall, vertices, point);
  return dist(wallPointAt(wall, vertices, t), point);
}

/** Sample n+1 evenly-spaced points along a wall's [t0,t1] range (for curved rendering). */
export function sampleWallPoints(
  wall: WallSegment,
  vertices: Record<string, WallVertex>,
  t0: number,
  t1: number,
  n = 16,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    pts.push(wallPointAt(wall, vertices, t));
  }
  return pts;
}

/** Create a new wall between two vertex ids. */
export function makeWall(a: string, b: string, thickness: number): WallSegment {
  return { id: `wall-${nanoid(8)}`, a, b, thickness, curved: false, curveOffset: 0 };
}

export function makeVertex(x: number, y: number): WallVertex {
  return { id: `vtx-${nanoid(8)}`, x, y };
}

/**
 * Detect simple closed loops in the wall graph. Handles the common case of
 * disjoint simple cycles (one or more independently-drawn rooms) by walking
 * from each unvisited degree-2 vertex around its cycle. Complex planar
 * arrangements (shared/branching walls) are not subdivided into faces.
 */
export function computeFloors(vertices: Record<string, WallVertex>, walls: Record<string, WallSegment>): FloorPolygon[] {
  const adjacency = new Map<string, { neighbor: string; wallId: string }[]>();
  for (const w of Object.values(walls)) {
    if (!adjacency.has(w.a)) adjacency.set(w.a, []);
    if (!adjacency.has(w.b)) adjacency.set(w.b, []);
    adjacency.get(w.a)!.push({ neighbor: w.b, wallId: w.id });
    adjacency.get(w.b)!.push({ neighbor: w.a, wallId: w.id });
  }

  const visitedWalls = new Set<string>();
  const floors: FloorPolygon[] = [];

  for (const startId of Object.keys(vertices)) {
    const neighbors = adjacency.get(startId);
    if (!neighbors || neighbors.length !== 2) continue;

    // Walk the cycle starting at startId, always following the 2-regular chain.
    const loop: string[] = [startId];
    let prev = startId;
    let cur = neighbors[0].neighbor;
    let curWall = neighbors[0].wallId;
    let closed = false;
    let steps = 0;
    const usedWallsThisLoop = new Set<string>([curWall]);

    while (steps++ < Object.keys(vertices).length + 2) {
      if (cur === startId) {
        closed = true;
        break;
      }
      const curNeighbors = adjacency.get(cur);
      if (!curNeighbors || curNeighbors.length !== 2) break; // not a simple cycle
      loop.push(cur);
      const next = curNeighbors.find((n) => !(n.neighbor === prev && n.wallId === curWall));
      if (!next) break;
      prev = cur;
      cur = next.neighbor;
      curWall = next.wallId;
      usedWallsThisLoop.add(curWall);
    }

    if (closed && loop.length >= 3) {
      const alreadyCounted = [...usedWallsThisLoop].some((id) => visitedWalls.has(id));
      if (!alreadyCounted) {
        for (const id of usedWallsThisLoop) visitedWalls.add(id);
        floors.push({ id: `floor-${nanoid(6)}`, vertexIds: loop });
      }
    }
  }

  return floors;
}

export interface Normal {
  x: number;
  y: number;
}

/**
 * For every wall that belongs to exactly one closed floor loop, compute the
 * outward-pointing unit normal (away from the room interior).
 *
 * Vertices are treated as the *interior* face of the wall — the boundary you'd
 * get by measuring the inside of the room — so walls not part of any loop
 * (open chains, mid-draw) have no defined interior side and are omitted; the
 * renderer falls back to a centered stroke for those.
 */
export function computeWallOutwardNormals(
  vertices: Record<string, WallVertex>,
  walls: Record<string, WallSegment>,
  floors: FloorPolygon[],
): Record<string, Normal> {
  const result: Record<string, Normal> = {};

  for (const floor of floors) {
    const ids = floor.vertexIds;
    const n = ids.length;
    if (n < 3) continue;

    // Shoelace sum: its sign tells us, consistently, which side of each
    // directed edge (in this same loop order) is the interior.
    let area = 0;
    for (let i = 0; i < n; i++) {
      const p0 = vertices[ids[i]];
      const p1 = vertices[ids[(i + 1) % n]];
      if (!p0 || !p1) continue;
      area += p0.x * p1.y - p1.x * p0.y;
    }
    const positive = area > 0;

    for (let i = 0; i < n; i++) {
      const aId = ids[i];
      const bId = ids[(i + 1) % n];
      const a = vertices[aId];
      const b = vertices[bId];
      if (!a || !b) continue;
      const wall = Object.values(walls).find((w) => (w.a === aId && w.b === bId) || (w.a === bId && w.b === aId));
      if (!wall) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const leftNormal: Normal = { x: -dy / len, y: dx / len };
      const inward = positive ? leftNormal : { x: -leftNormal.x, y: -leftNormal.y };
      result[wall.id] = { x: -inward.x, y: -inward.y };
    }
  }

  return result;
}

/** Shift a wall's two endpoints outward by half its thickness, for rendering only. */
export function outwardShiftedEndpoints(
  wall: WallSegment,
  vertices: Record<string, WallVertex>,
  outwardNormals: Record<string, Normal>,
): { a: WallVertex; b: WallVertex } {
  const a = vertices[wall.a];
  const b = vertices[wall.b];
  const n = outwardNormals[wall.id];
  if (!n) return { a, b };
  const half = wall.thickness / 2;
  return {
    a: { ...a, x: a.x + n.x * half, y: a.y + n.y * half },
    b: { ...b, x: b.x + n.x * half, y: b.y + n.y * half },
  };
}

/** Insert a new vertex into a wall at parameter t, splitting it into two walls. */
export function splitWall(
  wall: WallSegment,
  vertices: Record<string, WallVertex>,
  openings: Record<string, WallOpening>,
  t: number,
): { vertex: WallVertex; wallA: WallSegment; wallB: WallSegment; openingUpdates: Record<string, WallOpening> } {
  const p = wallPointAt(wall, vertices, t);
  const vertex = makeVertex(p.x, p.y);
  const wallA: WallSegment = { ...makeWall(wall.a, vertex.id, wall.thickness), curved: false, curveOffset: 0 };
  const wallB: WallSegment = { ...makeWall(vertex.id, wall.b, wall.thickness), curved: false, curveOffset: 0 };

  const openingUpdates: Record<string, WallOpening> = {};
  for (const o of Object.values(openings)) {
    if (o.wallId !== wall.id) continue;
    if (o.t < t) {
      openingUpdates[o.id] = { ...o, wallId: wallA.id, t: clamp01(o.t / t) };
    } else {
      openingUpdates[o.id] = { ...o, wallId: wallB.id, t: clamp01((o.t - t) / (1 - t)) };
    }
  }

  return { vertex, wallA, wallB, openingUpdates };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Whether two walls sharing `vertexId` are roughly collinear and mergeable. */
export function canMergeAt(vertexId: string, vertices: Record<string, WallVertex>, walls: Record<string, WallSegment>): { w1: WallSegment; w2: WallSegment } | null {
  const connected = Object.values(walls).filter((w) => w.a === vertexId || w.b === vertexId);
  if (connected.length !== 2) return null;
  const [w1, w2] = connected;
  const v1 = wallVector(w1, vertices);
  const v2 = wallVector(w2, vertices);
  // Direction pointing away from vertexId, for each wall.
  const a1 = Math.atan2(v1.dy * (w1.a === vertexId ? 1 : -1), v1.dx * (w1.a === vertexId ? 1 : -1));
  const a2 = Math.atan2(v2.dy * (w2.a === vertexId ? 1 : -1), v2.dx * (w2.a === vertexId ? 1 : -1));
  let diff = Math.abs(a1 - a2);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return Math.abs(diff - Math.PI) < 0.08 ? { w1, w2 } : null;
}

/** Merge two collinear walls meeting at `vertexId` into a single wall. */
export function mergeWalls(
  vertexId: string,
  w1: WallSegment,
  w2: WallSegment,
  vertices: Record<string, WallVertex>,
  openings: Record<string, WallOpening>,
): { newWall: WallSegment; removedVertexId: string; openingUpdates: Record<string, WallOpening> } {
  const otherA = w1.a === vertexId ? w1.b : w1.a;
  const otherB = w2.a === vertexId ? w2.b : w2.a;
  const w1Reversed = w1.a === vertexId;
  const w2Reversed = w2.b === vertexId;
  const newWall = makeWall(otherA, otherB, (w1.thickness + w2.thickness) / 2);

  const len1 = wallVector(w1, vertices).length || 1;
  const len2 = wallVector(w2, vertices).length || 1;
  const split = len1 / (len1 + len2);

  const openingUpdates: Record<string, WallOpening> = {};
  for (const o of Object.values(openings)) {
    if (o.wallId === w1.id) {
      const t = w1Reversed ? 1 - o.t : o.t;
      openingUpdates[o.id] = { ...o, wallId: newWall.id, t: clamp01(t * split) };
    } else if (o.wallId === w2.id) {
      const t = w2Reversed ? 1 - o.t : o.t;
      openingUpdates[o.id] = { ...o, wallId: newWall.id, t: clamp01(split + t * (1 - split)) };
    }
  }

  return { newWall, removedVertexId: vertexId, openingUpdates };
}

/** Render-ready sub-segments of a wall with any openings cut out. */
export interface WallRenderSegment {
  t0: number;
  t1: number;
}

export function wallRenderSegments(
  wall: WallSegment,
  vertices: Record<string, WallVertex>,
  openings: WallOpening[],
): WallRenderSegment[] {
  const cuts = openings.filter((o) => o.wallId === wall.id).sort((a, b) => a.t - b.t);
  if (cuts.length === 0) return [{ t0: 0, t1: 1 }];

  const length = wallVector(wall, vertices).length || 1;
  const segments: WallRenderSegment[] = [];
  let cursor = 0;
  for (const o of cuts) {
    const halfWidthT = o.width / 2 / length;
    const start = Math.max(cursor, o.t - halfWidthT);
    if (start > cursor) segments.push({ t0: cursor, t1: start });
    cursor = Math.min(1, o.t + halfWidthT);
  }
  if (cursor < 1) segments.push({ t0: cursor, t1: 1 });
  return segments;
}
