import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, ArrowUpDown, Package } from 'lucide-react';
import { useStore, useActiveRoom } from '../store/store';
import { itemsInLocation, sortItems, itemMatches } from '../lib/selectors';
import { cellName, cellKind, gridCells } from '../lib/shelf';
import ItemCard from './ItemCard';
import ItemInspector from './ItemInspector';
import type { SortMode } from '../types';

const SORT_LABELS: Record<SortMode, string> = {
  manual: 'Manual',
  alpha: 'A–Z',
  'recent-added': 'Recently added',
  'recent-used': 'Recently used',
  quantity: 'Quantity',
  color: 'Color',
};

export default function DrawerView() {
  const loc = useStore((s) => s.openLocation);
  const room = useActiveRoom();
  const objects = room.objects;
  const items = room.items;
  const tags = useStore((s) => s.tags);
  const sortMode = useStore((s) => s.sortMode);
  const search = useStore((s) => s.search);
  const setSortMode = useStore((s) => s.setSortMode);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const addItem = useStore((s) => s.addItem);
  const inspectItem = useStore((s) => s.inspectItem);
  const moveItem = useStore((s) => s.moveItem);
  const setItemOrder = useStore((s) => s.setItemOrder);
  const inspectItemId = useStore((s) => s.inspectItemId);
  const [dragId, setDragId] = useState<string | null>(null);

  const obj = loc ? objects[loc.objectId] : null;

  const list = useMemo(() => {
    if (!loc) return [];
    return sortItems(itemsInLocation(items, loc.objectId, loc.cellKey), sortMode, tags);
  }, [items, loc, sortMode, tags]);

  const kind = obj && loc ? cellKind(obj, loc.cellKey) : 'shelf';
  const title = obj && loc ? cellName(obj, loc.cellKey) : '';

  const handleCardDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = list.map((i) => i.id).filter((id) => id !== dragId);
    const idx = ids.indexOf(targetId);
    ids.splice(idx, 0, dragId);
    setItemOrder(ids);
    setSortMode('manual');
    setDragId(null);
  };

  return (
    <AnimatePresence>
      {obj && loc && (
        <motion.div
          className="drawer-view"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={() => inspectItem(null)}
        >
          <motion.div
            className="drawer-panel"
            initial={{ scale: 0.96, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, y: 12, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <button className="btn icon" onClick={closeDrawer}>
                <ArrowLeft size={18} />
              </button>
              <div className="drawer-title">
                <span className="dt-crumb">{obj.name}</span>
                <h2>
                  {title}
                  <span className={`kind-badge ${kind}`}>{kind}</span>
                </h2>
              </div>

              <div className="drawer-sort">
                <ArrowUpDown size={14} />
                <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
                  {Object.entries(SORT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <button className="btn primary" onClick={() => inspectItem(addItem(loc))}>
                <Plus size={16} /> Add item
              </button>
            </div>

            <div
              className={`drawer-floor ${kind}`}
              onDragOver={(e) => e.preventDefault()}
            >
              {list.length === 0 && (
                <div className="drawer-empty">
                  <Package size={40} strokeWidth={1.2} />
                  <p>This {kind} is empty.</p>
                  <button className="btn primary" onClick={() => inspectItem(addItem(loc))}>
                    <Plus size={16} /> Add the first item
                  </button>
                </div>
              )}
              <div className="card-grid">
                {list.map((it) => (
                  <div
                    key={it.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleCardDrop(it.id)}
                  >
                    <ItemCard
                      item={it}
                      tags={tags}
                      highlighted={search.trim().length > 0 && itemMatches(it, search, tags)}
                      onClick={() => inspectItem(it.id)}
                      onDragStart={(e) => {
                        setDragId(it.id);
                        e.dataTransfer.setData('text/plain', it.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Move-to rail: drop a card here to relocate it. */}
            <MoveRail currentObjId={obj.id} currentCell={loc.cellKey} onDropItem={(o, c) => dragId && moveItem(dragId, { objectId: o, cellKey: c })} />
          </motion.div>

          <AnimatePresence>
            {inspectItemId && (
              <motion.div
                key="ii"
                initial={{ x: 40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 40, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                style={{ position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: 5 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <ItemInspector />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MoveRail({
  currentObjId,
  currentCell,
  onDropItem,
}: {
  currentObjId: string;
  currentCell: string;
  onDropItem: (objectId: string, cellKey: string) => void;
}) {
  const objects = useActiveRoom().objects;
  const [hover, setHover] = useState<string | null>(null);

  const targets = useMemo(() => {
    const out: { objectId: string; cellKey: string; label: string }[] = [];
    for (const o of Object.values(objects)) {
      const keys = o.storage.type === 'grid' ? gridCells(o.storage).map((c) => c.key) : ['surface'];
      for (const k of keys) {
        if (o.id === currentObjId && k === currentCell) continue;
        out.push({ objectId: o.id, cellKey: k, label: `${o.name} · ${cellName(o, k)}` });
      }
    }
    return out;
  }, [objects, currentObjId, currentCell]);

  return (
    <div className="move-rail">
      <span className="label">Drag an item here to move it →</span>
      <div className="move-targets">
        {targets.map((t) => {
          const id = `${t.objectId}|${t.cellKey}`;
          return (
            <div
              key={id}
              className={`move-target ${hover === id ? 'hover' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setHover(id);
              }}
              onDragLeave={() => setHover(null)}
              onDrop={() => {
                onDropItem(t.objectId, t.cellKey);
                setHover(null);
              }}
            >
              {t.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
