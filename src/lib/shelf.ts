import type { RoomObject, Storage } from '../types';

export interface CellRect {
  key: string;
  row: number;
  col: number;
  /** Normalised 0..1 rectangle within the object's face. */
  x: number;
  y: number;
  w: number;
  h: number;
}

function normalise(fracs: number[]): number[] {
  const sum = fracs.reduce((a, b) => a + b, 0) || 1;
  return fracs.map((f) => f / sum);
}

/** Compute the normalised (0..1) rectangles for every cell in a grid storage. */
export function gridCells(storage: Storage): CellRect[] {
  if (storage.type !== 'grid') return [];
  const cols = normalise(storage.colFractions);
  const rows = normalise(storage.rowFractions);
  const cells: CellRect[] = [];
  let y = 0;
  for (let r = 0; r < storage.rows; r++) {
    let x = 0;
    for (let c = 0; c < storage.cols; c++) {
      cells.push({ key: `${r}:${c}`, row: r, col: c, x, y, w: cols[c], h: rows[r] });
      x += cols[c];
    }
    y += rows[r];
  }
  return cells;
}

export function cellName(obj: RoomObject, key: string): string {
  if (obj.storage.type === 'single') return obj.name;
  return obj.storage.cells[key]?.name ?? key;
}

export function cellKind(obj: RoomObject, key: string): 'shelf' | 'drawer' | 'surface' {
  if (obj.storage.type === 'single') return 'surface';
  return obj.storage.cells[key]?.kind ?? 'shelf';
}

/** List of every location key an object exposes. */
export function locationKeys(obj: RoomObject): string[] {
  if (obj.storage.type === 'single') return ['surface'];
  return gridCells(obj.storage).map((c) => c.key);
}
