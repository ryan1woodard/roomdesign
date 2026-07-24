import type { RoomObject, Storage } from '../types';

/** Largest supported grid storage dimension, in either axis (so up to 400 total compartments). */
export const MAX_GRID_SIZE = 20;

export interface CellRect {
  key: string;
  row: number;
  col: number;
  /** Normalised 0..1 rectangle within the object's face. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Extent in base rows/cols — always 1×1 unless this is a merged compartment. */
  rowSpan: number;
  colSpan: number;
}

function normalise(fracs: number[]): number[] {
  const sum = fracs.reduce((a, b) => a + b, 0) || 1;
  return fracs.map((f) => f / sum);
}

/** Cumulative 0..1 row/col boundaries — `rowY`/`colX` each have length
 * rows+1/cols+1, so `rowY[i]..rowY[i+1]` is the i-th base row's span. Shared
 * by `gridCells()` and by the layout editor's pointer-to-cell math so both
 * always agree on exactly where grid lines fall. */
export function cellBoundaries(storage: Storage): { rowY: number[]; colX: number[] } {
  if (storage.type !== 'grid') return { rowY: [0, 1], colX: [0, 1] };
  const colFracs = normalise(storage.colFractions);
  const rowFracs = normalise(storage.rowFractions);
  const colX: number[] = [0];
  for (const f of colFracs) colX.push(colX[colX.length - 1] + f);
  const rowY: number[] = [0];
  for (const f of rowFracs) rowY.push(rowY[rowY.length - 1] + f);
  return { rowY, colX };
}

/** Given a normalised (0..1, 0..1) point within the grid's face, returns the
 * base row/col it falls in, clamped to the grid's bounds. */
export function rowColAt(storage: Storage, xFrac: number, yFrac: number): { row: number; col: number } {
  if (storage.type !== 'grid') return { row: 0, col: 0 };
  const { rowY, colX } = cellBoundaries(storage);
  let row = rowY.findIndex((_, i) => i < rowY.length - 1 && yFrac < rowY[i + 1]);
  if (row === -1) row = storage.rows - 1;
  let col = colX.findIndex((_, i) => i < colX.length - 1 && xFrac < colX[i + 1]);
  if (col === -1) col = storage.cols - 1;
  return { row: Math.max(0, Math.min(storage.rows - 1, row)), col: Math.max(0, Math.min(storage.cols - 1, col)) };
}

/** Every covered (non-anchor) cell key in a grid's merges, mapped to the anchor that owns it. */
function buildCoverage(storage: Extract<Storage, { type: 'grid' }>): Map<string, string> {
  const coverage = new Map<string, string>();
  const merges = storage.merges;
  if (!merges) return coverage;
  for (const [anchor, span] of Object.entries(merges)) {
    const [ar, ac] = anchor.split(':').map(Number);
    for (let r = ar; r < Math.min(storage.rows, ar + span.rowSpan); r++) {
      for (let c = ac; c < Math.min(storage.cols, ac + span.colSpan); c++) {
        if (r === ar && c === ac) continue;
        coverage.set(`${r}:${c}`, anchor);
      }
    }
  }
  return coverage;
}

/** Compute the normalised (0..1) rectangles for every *visible* compartment
 * in a grid storage — one per merged block plus one per remaining unmerged
 * cell. Cells covered by a merge (everything but its top-left anchor) are
 * omitted entirely; they have no independent identity while merged. */
export function gridCells(storage: Storage): CellRect[] {
  if (storage.type !== 'grid') return [];
  const { rowY, colX } = cellBoundaries(storage);
  const covered = buildCoverage(storage);
  const merges = storage.merges ?? {};

  const cells: CellRect[] = [];
  for (let r = 0; r < storage.rows; r++) {
    for (let c = 0; c < storage.cols; c++) {
      const key = `${r}:${c}`;
      if (covered.has(key)) continue;
      const span = merges[key];
      const rowSpan = span ? Math.max(1, Math.min(span.rowSpan, storage.rows - r)) : 1;
      const colSpan = span ? Math.max(1, Math.min(span.colSpan, storage.cols - c)) : 1;
      cells.push({
        key,
        row: r,
        col: c,
        x: colX[c],
        y: rowY[r],
        w: colX[c + colSpan] - colX[c],
        h: rowY[r + rowSpan] - rowY[r],
        rowSpan,
        colSpan,
      });
    }
  }
  return cells;
}

/** Maps any base `${row}:${col}` key to the anchor key that currently owns
 * it — itself, if it's already an anchor or an unmerged cell. Use this
 * before looking up an arbitrary cell's identity, since a cell that was
 * merged into a neighbor no longer has independent metadata. */
export function resolveCellKey(storage: Storage, key: string): string {
  if (storage.type !== 'grid') return key;
  return buildCoverage(storage).get(key) ?? key;
}

/** Every compartment's display name is its 1-based position among the
 * object's current *visible* compartments — left to right, top to bottom,
 * with a merged block counting as a single number — computed fresh from
 * `gridCells()` every time rather than read from stored data, so it can
 * never go stale after adding/removing rows or columns, merging, or
 * unmerging. There is deliberately no way to override it: the number always
 * reflects the current layout, never a preserved historical label. */
export function cellName(obj: RoomObject, key: string): string {
  if (obj.storage.type === 'single') return obj.name;
  const anchor = resolveCellKey(obj.storage, key);
  const idx = gridCells(obj.storage).findIndex((c) => c.key === anchor);
  return String(idx >= 0 ? idx + 1 : 1);
}

export function cellKind(obj: RoomObject, key: string): 'shelf' | 'drawer' | 'surface' {
  if (obj.storage.type === 'single') return 'surface';
  const anchor = resolveCellKey(obj.storage, key);
  return obj.storage.cells[anchor]?.kind ?? 'shelf';
}

/** List of every location key an object exposes (one per visible compartment). */
export function locationKeys(obj: RoomObject): string[] {
  if (obj.storage.type === 'single') return ['surface'];
  return gridCells(obj.storage).map((c) => c.key);
}

export interface SelectionRect {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

/**
 * Validates that a set of cell keys forms one exact, gapless rectangle —
 * the requirement for a valid merge. Each key is first resolved to its
 * current anchor, so selecting any cell inside an already-merged block
 * counts as selecting that whole block. Returns the rectangle's bounds in
 * base-cell row/col units, or null if invalid: an L-shape, a disconnected
 * selection, or a selection that only partially overlaps a different
 * existing merge.
 */
export function rectFromSelection(storage: Storage, keys: string[]): SelectionRect | null {
  if (storage.type !== 'grid' || keys.length === 0) return null;
  const anchors = new Set(keys.map((k) => resolveCellKey(storage, k)));
  const merges = storage.merges ?? {};

  let rowStart = Infinity;
  let rowEnd = -Infinity;
  let colStart = Infinity;
  let colEnd = -Infinity;
  let area = 0;

  for (const key of anchors) {
    const [r, c] = key.split(':').map(Number);
    const span = merges[key];
    const rowSpan = span?.rowSpan ?? 1;
    const colSpan = span?.colSpan ?? 1;
    rowStart = Math.min(rowStart, r);
    colStart = Math.min(colStart, c);
    rowEnd = Math.max(rowEnd, r + rowSpan - 1);
    colEnd = Math.max(colEnd, c + colSpan - 1);
    area += rowSpan * colSpan;
  }

  const expected = (rowEnd - rowStart + 1) * (colEnd - colStart + 1);
  if (area !== expected) return null;
  return { rowStart, rowEnd, colStart, colEnd };
}

export type StorageCharacter = 'surface' | 'shelf' | 'drawer' | 'grid';

/** Classifies an object's storage for visual-differentiation purposes: a
 * single flat surface, a uniformly-shelved container, a uniformly-drawer
 * container, or a mixed/generic compartment grid. */
export function storageCharacter(obj: RoomObject): StorageCharacter {
  if (obj.storage.type === 'single') return 'surface';
  const kinds = new Set(Object.values(obj.storage.cells).map((c) => c.kind));
  if (kinds.size === 1) {
    const [only] = kinds;
    if (only === 'shelf' || only === 'drawer') return only;
  }
  return 'grid';
}
