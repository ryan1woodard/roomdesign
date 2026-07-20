import type { Room } from '../types';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function extend(b: Bounds | null, x: number, y: number): Bounds {
  if (!b) return { minX: x, minY: y, maxX: x, maxY: y };
  return {
    minX: Math.min(b.minX, x),
    minY: Math.min(b.minY, y),
    maxX: Math.max(b.maxX, x),
    maxY: Math.max(b.maxY, y),
  };
}

/** Rotated-rectangle corner points, for an accurate bounding box under rotation. */
function objectCorners(x: number, y: number, w: number, h: number, rotationDeg: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
  return corners.map((c) => ({ x: cx + c.x * cos - c.y * sin, y: cy + c.x * sin + c.y * cos }));
}

/** Bounding box (world inches) of everything visible in a room, ignoring hidden layers. */
export function computeVisibleBounds(room: Room): Bounds | null {
  let b: Bounds | null = null;
  const visibleLayers = new Set(room.layers.filter((l) => l.visible).map((l) => l.id));

  for (const obj of Object.values(room.objects)) {
    if (!visibleLayers.has(obj.layerId)) continue;
    for (const c of objectCorners(obj.x, obj.y, obj.width, obj.height, obj.rotation)) {
      b = extend(b, c.x, c.y);
    }
  }

  const wallLayerVisible = room.layers.some((l) => l.kind === 'wall' && l.visible);
  if (wallLayerVisible) {
    for (const v of Object.values(room.vertices)) {
      b = extend(b, v.x, v.y);
    }
  }

  return b;
}
