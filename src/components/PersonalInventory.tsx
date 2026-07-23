import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Backpack, X, PackageCheck, CornerUpLeft } from 'lucide-react';
import { useStore } from '../store/store';
import { checkoutsForUser } from '../lib/selectors';
import { locationKeys, cellName } from '../lib/shelf';

function formatWhen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function PersonalInventory() {
  const open = useStore((s) => s.myInventoryOpen);
  const close = useStore((s) => s.closeMyInventory);
  const checkouts = useStore((s) => s.checkouts);
  const currentUser = useStore((s) => s.currentUser);
  const rooms = useStore((s) => s.rooms);
  const returnCheckout = useStore((s) => s.returnCheckout);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [returnQty, setReturnQty] = useState(1);
  const [returnTarget, setReturnTarget] = useState('');

  const mine = useMemo(() => {
    if (!currentUser) return [];
    return checkoutsForUser(checkouts, currentUser.id).sort((a, b) => b.takenAt - a.takenAt);
  }, [checkouts, currentUser]);

  const toggleExpand = (checkoutId: string, objectId: string, cellKey: string, quantity: number) => {
    if (expandedId === checkoutId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(checkoutId);
    setReturnQty(quantity);
    setReturnTarget(`${objectId}|${cellKey}`);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="overlay-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={close}
        >
          <motion.div
            className="personal-inventory"
            initial={{ scale: 0.96, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, y: 12, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="personal-inventory-head">
              <Backpack size={18} />
              <h3>My inventory</h3>
              <button className="btn icon" style={{ marginLeft: 'auto' }} onClick={close}>
                <X size={16} />
              </button>
            </div>

            <div className="personal-inventory-list">
              {mine.length === 0 && (
                <p className="hint" style={{ padding: 16 }}>
                  You haven't taken any items. Take an item from its inspector panel to see it here.
                </p>
              )}
              {mine.map((c) => {
                const room = rooms[c.roomId];
                const obj = room?.objects[c.objectId];
                const expanded = expandedId === c.id;
                const objects = room ? Object.values(room.objects) : [];
                return (
                  <div key={c.id} className={`pi-row ${expanded ? 'expanded' : ''}`}>
                    <button
                      className="pi-row-main"
                      onClick={() => toggleExpand(c.id, c.objectId, c.cellKey, c.quantity)}
                    >
                      <PackageCheck size={16} />
                      <div className="pi-row-info">
                        <span className="pi-row-name">
                          {c.quantity}× {c.itemName}
                        </span>
                        <span className="pi-row-meta">
                          from {room ? room.name : 'a deleted room'}
                          {obj ? ` · ${obj.name} · ${cellName(obj, c.cellKey)}` : ''} · {formatWhen(c.takenAt)}
                        </span>
                      </div>
                    </button>

                    {expanded && room && (
                      <div className="pi-return-form">
                        {objects.length === 0 ? (
                          <p className="hint">No furniture left in {room.name} to return this to.</p>
                        ) : (
                          <>
                            <select
                              className="field"
                              value={returnTarget}
                              onChange={(e) => setReturnTarget(e.target.value)}
                            >
                              {objects.map((o) =>
                                locationKeys(o).map((k) => (
                                  <option key={`${o.id}|${k}`} value={`${o.id}|${k}`}>
                                    {o.name} · {cellName(o, k)}
                                  </option>
                                )),
                              )}
                            </select>
                            {c.quantity > 1 && (
                              <input
                                className="field pi-qty-input"
                                type="number"
                                min={1}
                                max={c.quantity}
                                value={returnQty}
                                onChange={(e) =>
                                  setReturnQty(Math.max(1, Math.min(c.quantity, parseInt(e.target.value, 10) || 1)))
                                }
                              />
                            )}
                            <button
                              className="btn primary"
                              disabled={!returnTarget}
                              onClick={() => {
                                const [objectId, cellKey] = returnTarget.split('|');
                                returnCheckout(c.id, c.quantity > 1 ? returnQty : c.quantity, { objectId, cellKey });
                                setExpandedId(null);
                              }}
                            >
                              <CornerUpLeft size={14} /> Return
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
