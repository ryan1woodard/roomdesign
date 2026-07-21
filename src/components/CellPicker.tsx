import { motion, AnimatePresence } from 'framer-motion';
import { X, Package } from 'lucide-react';
import { useStore, useActiveRoom } from '../store/store';
import { gridCells, cellName } from '../lib/shelf';

export default function CellPicker() {
  const pickerObjectId = useStore((s) => s.pickerObjectId);
  const room = useActiveRoom();
  const openPicker = useStore((s) => s.openPicker);
  const openFromPicker = useStore((s) => s.openFromPicker);

  const obj = pickerObjectId ? room.objects[pickerObjectId] : null;

  return (
    <AnimatePresence>
      {obj && obj.storage.type === 'grid' && (
        <motion.div
          className="overlay-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={() => openPicker(null)}
        >
          <motion.div
            className="picker glass"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="picker-head">
              <h3>{obj.name}</h3>
              <span className="hint">Choose a compartment</span>
              <button className="btn icon" style={{ marginLeft: 'auto' }} onClick={() => openPicker(null)}>
                <X size={18} />
              </button>
            </div>
            <div
              className="picker-face"
              style={{ aspectRatio: `${obj.width} / ${obj.height}` }}
            >
              {gridCells(obj.storage).map((c) => {
                const meta = obj.storage.type === 'grid' ? obj.storage.cells[c.key] : undefined;
                const count = Object.values(room.items).filter(
                  (i) => i.objectId === obj.id && i.cellKey === c.key,
                ).length;
                return (
                  <button
                    key={c.key}
                    className={`picker-cell ${meta?.kind ?? 'shelf'}`}
                    style={{
                      left: `${c.x * 100}%`,
                      top: `${c.y * 100}%`,
                      width: `${c.w * 100}%`,
                      height: `${c.h * 100}%`,
                    }}
                    onClick={() => openFromPicker({ objectId: obj.id, cellKey: c.key })}
                  >
                    <span className="pc-name">{cellName(obj, c.key)}</span>
                    <span className="pc-count">
                      <Package size={12} /> {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
