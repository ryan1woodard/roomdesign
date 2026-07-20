import { useRef, useState } from 'react';
import type { RoomObject, Storage, CellMeta } from '../types';
import { gridCells } from '../lib/shelf';
import { useStore } from '../store/store';
import { Plus, Minus } from 'lucide-react';

/** Build/repair the per-cell metadata map for a given grid size. */
function rebuildCells(
  rows: number,
  cols: number,
  prev: Record<string, CellMeta>,
): Record<string, CellMeta> {
  const cells: Record<string, CellMeta> = {};
  let n = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r}:${c}`;
      cells[key] = prev[key] ?? { name: `Bin ${n}`, kind: 'drawer' };
      n++;
    }
  }
  return cells;
}

function normalize(arr: number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0) || 1;
  return arr.map((v) => (v / sum) * arr.length);
}

interface Props {
  obj: RoomObject;
}

export default function ShelfEditor({ obj }: Props) {
  const setStorage = useStore((s) => s.setStorage);
  const removeItem = useStore((s) => s.removeItem);
  const items = useStore((s) => s.items);
  const boxRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(null);

  const storage = obj.storage;
  if (storage.type !== 'grid') return null;

  const cells = gridCells(storage);

  const commit = (next: Storage) => setStorage(obj.id, next);

  const resize = (rows: number, cols: number) => {
    rows = Math.max(1, Math.min(8, rows));
    cols = Math.max(1, Math.min(8, cols));
    // Drop items that live in cells about to disappear.
    for (const it of Object.values(items)) {
      if (it.objectId !== obj.id) continue;
      const [r, c] = it.cellKey.split(':').map(Number);
      if (r >= rows || c >= cols) removeItem(it.id);
    }
    commit({
      type: 'grid',
      rows,
      cols,
      rowFractions: normalize(Array.from({ length: rows }, (_, i) => storage.rowFractions[i] ?? 1)),
      colFractions: normalize(Array.from({ length: cols }, (_, i) => storage.colFractions[i] ?? 1)),
      cells: rebuildCells(rows, cols, storage.cells),
    });
  };

  const dragDivider = (axis: 'col' | 'row', index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const box = boxRef.current!;
    const rect = box.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const fracs = axis === 'col' ? [...storage.colFractions] : [...storage.rowFractions];
      const total = fracs.reduce((a, b) => a + b, 0);
      const pos = axis === 'col' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
      // Cumulative fraction up to and including `index`.
      let before = 0;
      for (let i = 0; i < index; i++) before += fracs[i] / total;
      const target = Math.max(0.05, Math.min(0.95, pos)) - before;
      const pairSum = (fracs[index] + fracs[index + 1]) / total;
      const newFirst = Math.max(0.03, Math.min(pairSum - 0.03, target));
      fracs[index] = newFirst * total;
      fracs[index + 1] = (pairSum - newFirst) * total;
      commit({
        ...storage,
        colFractions: axis === 'col' ? fracs : storage.colFractions,
        rowFractions: axis === 'row' ? fracs : storage.rowFractions,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const selMeta = sel ? storage.cells[sel] : null;

  return (
    <div className="shelf-editor">
      <div className="stepper-row">
        <span className="label">Rows</span>
        <button className="btn icon" onClick={() => resize(storage.rows - 1, storage.cols)}>
          <Minus size={13} />
        </button>
        <span className="stepper-val">{storage.rows}</span>
        <button className="btn icon" onClick={() => resize(storage.rows + 1, storage.cols)}>
          <Plus size={13} />
        </button>
        <span className="label" style={{ marginLeft: 12 }}>
          Cols
        </span>
        <button className="btn icon" onClick={() => resize(storage.rows, storage.cols - 1)}>
          <Minus size={13} />
        </button>
        <span className="stepper-val">{storage.cols}</span>
        <button className="btn icon" onClick={() => resize(storage.rows, storage.cols + 1)}>
          <Plus size={13} />
        </button>
      </div>

      <div className="shelf-preview" ref={boxRef}>
        {cells.map((c) => {
          const meta = storage.cells[c.key];
          return (
            <div
              key={c.key}
              className={`shelf-cell ${meta?.kind ?? 'shelf'} ${sel === c.key ? 'sel' : ''}`}
              style={{
                left: `${c.x * 100}%`,
                top: `${c.y * 100}%`,
                width: `${c.w * 100}%`,
                height: `${c.h * 100}%`,
              }}
              onClick={() => setSel(c.key)}
            >
              <span>{meta?.name}</span>
            </div>
          );
        })}
        {/* Column dividers */}
        {Array.from({ length: storage.cols - 1 }).map((_, i) => {
          const fracs = normalizeReadable(storage.colFractions);
          const left = fracs.slice(0, i + 1).reduce((a, b) => a + b, 0);
          return (
            <div
              key={`cd${i}`}
              className="divider-handle vertical"
              style={{ left: `${left * 100}%` }}
              onPointerDown={dragDivider('col', i)}
            />
          );
        })}
        {/* Row dividers */}
        {Array.from({ length: storage.rows - 1 }).map((_, i) => {
          const fracs = normalizeReadable(storage.rowFractions);
          const top = fracs.slice(0, i + 1).reduce((a, b) => a + b, 0);
          return (
            <div
              key={`rd${i}`}
              className="divider-handle horizontal"
              style={{ top: `${top * 100}%` }}
              onPointerDown={dragDivider('row', i)}
            />
          );
        })}
      </div>

      {selMeta && sel && (
        <div className="cell-edit">
          <input
            className="field"
            value={selMeta.name}
            onChange={(e) =>
              commit({ ...storage, cells: { ...storage.cells, [sel]: { ...selMeta, name: e.target.value } } })
            }
          />
          <div className="seg">
            <button
              className={selMeta.kind === 'drawer' ? 'active' : ''}
              onClick={() => commit({ ...storage, cells: { ...storage.cells, [sel]: { ...selMeta, kind: 'drawer' } } })}
            >
              Drawer
            </button>
            <button
              className={selMeta.kind === 'shelf' ? 'active' : ''}
              onClick={() => commit({ ...storage, cells: { ...storage.cells, [sel]: { ...selMeta, kind: 'shelf' } } })}
            >
              Shelf
            </button>
          </div>
        </div>
      )}
      <p className="hint">Drag the divider lines to resize compartments. Click a compartment to rename it.</p>
    </div>
  );
}

function normalizeReadable(arr: number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0) || 1;
  return arr.map((v) => v / sum);
}
