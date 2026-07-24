import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Minus, Combine, Ungroup } from 'lucide-react';
import type { Storage, CellMeta, CellMerge } from '../types';

type GridStorage = Extract<Storage, { type: 'grid' }>;
import { gridCells, rowColAt, resolveCellKey, rectFromSelection, MAX_GRID_SIZE } from '../lib/shelf';
import { useStore, useActiveRoom } from '../store/store';

function normalize(arr: number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0) || 1;
  return arr.map((v) => (v / sum) * arr.length);
}

function normalizeReadable(arr: number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0) || 1;
  return arr.map((v) => v / sum);
}

/** Build/repair the per-cell metadata map for a given grid size. Display
 * names are always derived from position (see `cellName()`), so new cells
 * only need a default `kind`. */
function rebuildCells(rows: number, cols: number, prev: Record<string, CellMeta>): Record<string, CellMeta> {
  const cells: Record<string, CellMeta> = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r}:${c}`;
      cells[key] = prev[key] ?? { kind: 'drawer' };
    }
  }
  return cells;
}

/** Drops any merges that no longer fit within a shrunk grid. */
function clampMerges(merges: GridStorage['merges'], rows: number, cols: number): GridStorage['merges'] {
  if (!merges) return merges;
  const next: Record<string, CellMerge> = {};
  for (const [key, span] of Object.entries(merges)) {
    const [r, c] = key.split(':').map(Number);
    if (r < rows && c < cols) next[key] = span;
  }
  return next;
}

export default function ShelfLayoutModal() {
  const shelfEditObjectId = useStore((s) => s.shelfEditObjectId);
  const openShelfEditor = useStore((s) => s.openShelfEditor);
  const setStorage = useStore((s) => s.setStorage);
  const mergeCells = useStore((s) => s.mergeCells);
  const removeItem = useStore((s) => s.removeItem);
  const room = useActiveRoom();
  const items = room.items;

  const obj = shelfEditObjectId ? room.objects[shelfEditObjectId] : null;
  const storage = obj?.storage;

  const boxRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorCell, setAnchorCell] = useState<{ row: number; col: number } | null>(null);
  const [dragBox, setDragBox] = useState<{ start: { row: number; col: number }; current: { row: number; col: number } } | null>(null);

  const cells = useMemo(() => (storage ? gridCells(storage) : []), [storage]);

  if (!obj || !storage || storage.type !== 'grid') return null;

  const commit = (next: Storage) => setStorage(obj.id, next);

  const clearSelection = () => {
    setSelected(new Set());
    setAnchorCell(null);
  };

  const close = () => {
    clearSelection();
    openShelfEditor(null);
  };

  const resize = (rows: number, cols: number) => {
    rows = Math.max(1, Math.min(MAX_GRID_SIZE, rows));
    cols = Math.max(1, Math.min(MAX_GRID_SIZE, cols));
    for (const it of Object.values(items)) {
      if (it.objectId !== obj.id) continue;
      const [r, c] = it.cellKey.split(':').map(Number);
      if (Number.isFinite(r) && (r >= rows || c >= cols)) removeItem(it.id);
    }
    clearSelection();
    commit({
      type: 'grid',
      rows,
      cols,
      rowFractions: normalize(Array.from({ length: rows }, (_, i) => storage.rowFractions[i] ?? 1)),
      colFractions: normalize(Array.from({ length: cols }, (_, i) => storage.colFractions[i] ?? 1)),
      cells: rebuildCells(rows, cols, storage.cells),
      merges: clampMerges(storage.merges, rows, cols),
    });
  };

  const dragDivider = (axis: 'col' | 'row', index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current!;
    const rect = box.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const fracs = axis === 'col' ? [...storage.colFractions] : [...storage.rowFractions];
      const total = fracs.reduce((a, b) => a + b, 0);
      const pos = axis === 'col' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
      let before = 0;
      for (let i = 0; i < index; i++) before += fracs[i] / total;
      const target = Math.max(0.02, Math.min(0.98, pos)) - before;
      const pairSum = (fracs[index] + fracs[index + 1]) / total;
      const newFirst = Math.max(0.015, Math.min(pairSum - 0.015, target));
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

  const posToCell = (clientX: number, clientY: number) => {
    const rect = boxRef.current!.getBoundingClientRect();
    const xFrac = (clientX - rect.left) / rect.width;
    const yFrac = (clientY - rect.top) / rect.height;
    return rowColAt(storage, xFrac, yFrac);
  };

  const anchorsInRect = (r1: number, r2: number, c1: number, c2: number): Set<string> => {
    const rowLo = Math.min(r1, r2);
    const rowHi = Math.max(r1, r2);
    const colLo = Math.min(c1, c2);
    const colHi = Math.max(c1, c2);
    const set = new Set<string>();
    for (let r = rowLo; r <= rowHi; r++) {
      for (let c = colLo; c <= colHi; c++) {
        set.add(resolveCellKey(storage, `${r}:${c}`));
      }
    }
    return set;
  };

  const handleCellMouseDown = (e: React.MouseEvent, c: { row: number; col: number; key: string }) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey && anchorCell) {
      setSelected(anchorsInRect(anchorCell.row, c.row, anchorCell.col, c.col));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(c.key)) next.delete(c.key);
        else next.add(c.key);
        return next;
      });
      setAnchorCell({ row: c.row, col: c.col });
      return;
    }

    setAnchorCell({ row: c.row, col: c.col });
    setSelected(new Set([c.key]));
    setDragBox({ start: { row: c.row, col: c.col }, current: { row: c.row, col: c.col } });

    const move = (ev: MouseEvent) => {
      const cell = posToCell(ev.clientX, ev.clientY);
      setDragBox((db) => (db ? { ...db, current: cell } : db));
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const cell = posToCell(ev.clientX, ev.clientY);
      setSelected(anchorsInRect(c.row, cell.row, c.col, cell.col));
      setDragBox(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const inDragBox = (c: { row: number; col: number; rowSpan: number; colSpan: number }): boolean => {
    if (!dragBox) return false;
    const rowLo = Math.min(dragBox.start.row, dragBox.current.row);
    const rowHi = Math.max(dragBox.start.row, dragBox.current.row);
    const colLo = Math.min(dragBox.start.col, dragBox.current.col);
    const colHi = Math.max(dragBox.start.col, dragBox.current.col);
    return c.row <= rowHi && c.row + c.rowSpan - 1 >= rowLo && c.col <= colHi && c.col + c.colSpan - 1 >= colLo;
  };

  const selArr = [...selected];
  const singleKey = selArr.length === 1 ? selArr[0] : null;
  const singleMeta = singleKey ? storage.cells[singleKey] : null;
  const singleRect = singleKey ? cells.find((c) => c.key === singleKey) : null;
  const singleNumber = singleRect ? cells.indexOf(singleRect) + 1 : null;
  const isMergedSingle = !!singleRect && (singleRect.rowSpan > 1 || singleRect.colSpan > 1);
  const mergeRect = selArr.length >= 2 ? rectFromSelection(storage, selArr) : null;

  const handleMerge = () => {
    if (!mergeRect) return;
    mergeCells(obj.id, mergeRect.rowStart, mergeRect.rowEnd, mergeRect.colStart, mergeRect.colEnd);
    const anchorKey = `${mergeRect.rowStart}:${mergeRect.colStart}`;
    setSelected(new Set([anchorKey]));
    setAnchorCell({ row: mergeRect.rowStart, col: mergeRect.colStart });
  };

  const handleUnmerge = () => {
    if (!singleKey) return;
    const count = Object.values(items).filter((i) => i.objectId === obj.id && i.cellKey === singleKey).length;
    if (count > 0) {
      const ok = confirm(
        `This compartment contains ${count} item${count === 1 ? '' : 's'}. Unmerging will keep ${count === 1 ? 'it' : 'them'} together in one of the resulting compartments. Continue?`,
      );
      if (!ok) return;
    }
    const span = storage.merges?.[singleKey];
    const nextMerges = { ...(storage.merges ?? {}) };
    delete nextMerges[singleKey];

    // Cells absorbed by the merge had their metadata deleted; give any that
    // are reappearing a default kind (display names are always derived from
    // position, so no name needs restoring here).
    const nextCells = { ...storage.cells };
    if (span) {
      const [ar, ac] = singleKey.split(':').map(Number);
      for (let r = ar; r < ar + span.rowSpan; r++) {
        for (let c = ac; c < ac + span.colSpan; c++) {
          const key = `${r}:${c}`;
          if (key !== singleKey && !nextCells[key]) nextCells[key] = { kind: 'drawer' };
        }
      }
    }
    commit({ ...storage, merges: nextMerges, cells: nextCells });
  };

  return (
    <AnimatePresence>
      {shelfEditObjectId && (
        <motion.div
          className="overlay-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={close}
        >
          <motion.div
            className="picker glass shelf-modal"
            initial={{ scale: 0.94, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="picker-head">
              <h3>{obj.name}</h3>
              <span className="hint">Edit storage layout &amp; compartments</span>
              <button className="btn icon" style={{ marginLeft: 'auto' }} onClick={close}>
                <X size={18} />
              </button>
            </div>

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
              <span className="hint" style={{ marginLeft: 'auto' }}>
                {storage.rows * storage.cols} base cells · {cells.length} compartment{cells.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="shelf-preview shelf-preview-lg" ref={boxRef} onMouseDown={clearSelection}>
              {cells.map((c, i) => {
                const meta = storage.cells[c.key];
                const dense = storage.rows * storage.cols > 120;
                return (
                  <div
                    key={c.key}
                    className={`shelf-cell ${meta?.kind ?? 'shelf'} ${selected.has(c.key) ? 'sel' : ''} ${inDragBox(c) ? 'drag' : ''} ${dense ? 'dense' : ''}`}
                    style={{
                      left: `${c.x * 100}%`,
                      top: `${c.y * 100}%`,
                      width: `${c.w * 100}%`,
                      height: `${c.h * 100}%`,
                    }}
                    onMouseDown={(e) => handleCellMouseDown(e, c)}
                  >
                    {/* Compartment numbers are always the cell's 1-based position
                        among currently-visible compartments — never a stored,
                        manually-set name — so they stay correct after any
                        row/column/merge change with no user action needed. */}
                    {!dense && <span>{i + 1}</span>}
                  </div>
                );
              })}
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

            <div className="shelf-modal-footer">
              {singleKey && singleMeta ? (
                <div className="cell-edit">
                  {/* Compartment numbers are always auto-generated from position
                      (see cellName() in lib/shelf.ts) — never user-editable —
                      so they can never drift out of sync after a layout change. */}
                  <span className="cell-edit-label">Compartment {singleNumber}</span>
                  <div className="seg">
                    <button
                      className={singleMeta.kind === 'drawer' ? 'active' : ''}
                      onClick={() => commit({ ...storage, cells: { ...storage.cells, [singleKey]: { ...singleMeta, kind: 'drawer' } } })}
                    >
                      Drawer
                    </button>
                    <button
                      className={singleMeta.kind === 'shelf' ? 'active' : ''}
                      onClick={() => commit({ ...storage, cells: { ...storage.cells, [singleKey]: { ...singleMeta, kind: 'shelf' } } })}
                    >
                      Shelf
                    </button>
                  </div>
                  {isMergedSingle && (
                    <button className="btn" onClick={handleUnmerge}>
                      <Ungroup size={14} /> Unmerge
                    </button>
                  )}
                </div>
              ) : selArr.length >= 2 ? (
                <div className="cell-edit">
                  {mergeRect ? (
                    <button className="btn primary" onClick={handleMerge}>
                      <Combine size={14} /> Merge {selArr.length} compartments
                    </button>
                  ) : (
                    <button className="btn" disabled>
                      <Combine size={14} /> Merge compartments
                    </button>
                  )}
                </div>
              ) : null}
              <p className="hint">
                {selArr.length === 0
                  ? 'Click a compartment to select it, Ctrl+click or Shift+click to select more, or drag to select a range. Drag the divider lines to resize compartments.'
                  : selArr.length >= 2 && !mergeRect
                    ? 'Select a rectangular block with no gaps to merge it into one compartment.'
                    : ' '}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
