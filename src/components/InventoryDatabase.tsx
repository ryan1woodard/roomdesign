import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Database, X, Search, Plus, Trash2, Upload, Download } from 'lucide-react';
import { useStore, useActiveRoom, useToastStore } from '../store/store';
import { locationKeys, cellName } from '../lib/shelf';
import { itemMatches, checkoutsForItem } from '../lib/selectors';
import { downloadInventoryCsv, parseInventoryCsv, looksLikeInventoryCsv } from '../lib/inventoryCsv';
import NumberField from './NumberField';
import type { Item } from '../types';

type SortKey = 'name' | 'quantity' | 'location' | 'value' | 'serial';
type SortDir = 'asc' | 'desc';

const TAG_COLORS = ['#4f8cff', '#39c07a', '#ff9f45', '#a678f0', '#8b95a7', '#ff5d6c', '#2dd4bf', '#f0c674'];

export default function InventoryDatabase() {
  const open = useStore((s) => s.inventoryDbOpen);
  const close = useStore((s) => s.closeInventoryDb);
  const room = useActiveRoom();
  const tags = useStore((s) => s.tags);
  const checkouts = useStore((s) => s.checkouts);
  const addItem = useStore((s) => s.addItem);
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);
  const moveItem = useStore((s) => s.moveItem);
  const addTag = useStore((s) => s.addTag);
  const pushToast = useToastStore((s) => s.push);
  const importInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });

  const objectsList = useMemo(() => Object.values(room.objects), [room.objects]);

  const locLabel = (it: Item) => {
    const obj = room.objects[it.objectId];
    return obj ? `${obj.name} · ${cellName(obj, it.cellKey)}` : 'Unknown';
  };

  const rows = useMemo(() => {
    let list = Object.values(room.items);
    if (search.trim()) list = list.filter((it) => itemMatches(it, search, tags));
    if (tagFilter !== 'all') list = list.filter((it) => it.tagIds.includes(tagFilter));
    const dir = sort.dir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sort.key) {
        case 'quantity':
          return (a.quantity - b.quantity) * dir;
        case 'value':
          return ((a.value ?? 0) - (b.value ?? 0)) * dir;
        case 'serial':
          return (a.serial ?? '').localeCompare(b.serial ?? '') * dir;
        case 'location':
          return locLabel(a).localeCompare(locLabel(b)) * dir;
        case 'name':
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.items, room.objects, search, tagFilter, sort, tags]);

  const toggleSort = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const sortArrow = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  const resolveTagIds = (namesStr: string): string[] => {
    const names = namesStr
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const byName = new Map(Object.values(tags).map((t) => [t.name.toLowerCase(), t.id]));
    return names.map((n) => {
      const existing = byName.get(n.toLowerCase());
      if (existing) return existing;
      const color = TAG_COLORS[Object.keys(tags).length % TAG_COLORS.length];
      const id = addTag(n, color);
      byName.set(n.toLowerCase(), id);
      return id;
    });
  };

  const handleAddItem = () => {
    const firstObj = objectsList[0];
    if (!firstObj) {
      pushToast('error', 'Add furniture to the room before adding inventory items.');
      return;
    }
    addItem({ objectId: firstObj.id, cellKey: locationKeys(firstObj)[0] }, { name: 'New item' });
  };

  const handleExport = () => {
    downloadInventoryCsv(room, tags);
    pushToast('success', `Exported "${room.name}" inventory as CSV`);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    if (!looksLikeInventoryCsv(text)) {
      pushToast('error', "That file doesn't look like an inventory CSV export.");
      return;
    }
    const { rows: parsed, skipped } = parseInventoryCsv(text, room);
    let created = 0;
    let updated = 0;
    for (const row of parsed) {
      const tagIds = resolveTagIds(row.tagNames.join(', '));
      if (row.existingId) {
        updateItem(row.existingId, { ...row.patch, tagIds });
        moveItem(row.existingId, { objectId: row.objectId, cellKey: row.cellKey });
        updated++;
      } else {
        addItem({ objectId: row.objectId, cellKey: row.cellKey }, { ...row.patch, tagIds });
        created++;
      }
    }
    const skippedMsg = skipped.length ? `, skipped ${skipped.length} row(s) with unknown objects` : '';
    pushToast('success', `Imported ${created} new and updated ${updated} item(s)${skippedMsg}`);
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
            className="inventory-db"
            initial={{ scale: 0.96, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, y: 12, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="inventory-db-head">
              <Database size={18} />
              <h3>Inventory database — {room.name}</h3>
              <button className="btn icon" style={{ marginLeft: 'auto' }} onClick={close}>
                <X size={16} />
              </button>
            </div>

            <div className="inventory-db-toolbar">
              <div className="log-search">
                <Search size={14} />
                <input
                  className="field"
                  placeholder="Search items…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select className="field" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                <option value="all">All tags</option>
                {Object.values(tags).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <div className="inventory-db-toolbar-spacer" />
              <button className="btn" onClick={handleAddItem}>
                <Plus size={14} /> Add item
              </button>
              <button className="btn icon" onClick={() => importInputRef.current?.click()} title="Import CSV">
                <Upload size={15} />
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="text/csv,.csv"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
              <button className="btn icon" onClick={handleExport} title="Export CSV">
                <Download size={15} />
              </button>
            </div>

            <div className="inventory-db-table-wrap">
              <table className="inventory-db-table">
                <colgroup>
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '4%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th onClick={() => toggleSort('name')}>Name{sortArrow('name')}</th>
                    <th onClick={() => toggleSort('quantity')} className="num">
                      Qty{sortArrow('quantity')}
                    </th>
                    <th onClick={() => toggleSort('location')}>Location{sortArrow('location')}</th>
                    <th>Tags</th>
                    <th onClick={() => toggleSort('value')} className="num">
                      Value{sortArrow('value')}
                    </th>
                    <th onClick={() => toggleSort('serial')}>Serial{sortArrow('serial')}</th>
                    <th>Purchase date</th>
                    <th>Notes</th>
                    <th aria-label="Delete" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="inventory-db-empty">
                        No items match.
                      </td>
                    </tr>
                  )}
                  {rows.map((it) => {
                    const obj = room.objects[it.objectId];
                    const keys = obj ? locationKeys(obj) : [];
                    return (
                      <tr key={it.id}>
                        <td>
                          <input
                            className="db-cell"
                            value={it.name}
                            onChange={(e) => updateItem(it.id, { name: e.target.value })}
                          />
                        </td>
                        <td className="num">
                          <NumberField
                            className="db-cell num"
                            value={it.quantity}
                            min={0}
                            onCommit={(v) => updateItem(it.id, { quantity: Math.max(0, Math.round(v ?? it.quantity)) })}
                          />
                        </td>
                        <td>
                          <div className="db-location">
                            <select
                              className="db-cell"
                              value={it.objectId}
                              onChange={(e) => {
                                const newObj = room.objects[e.target.value];
                                if (!newObj) return;
                                moveItem(it.id, { objectId: newObj.id, cellKey: locationKeys(newObj)[0] });
                              }}
                            >
                              {objectsList.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name}
                                </option>
                              ))}
                            </select>
                            {keys.length > 1 && (
                              <select
                                className="db-cell"
                                value={it.cellKey}
                                onChange={(e) => moveItem(it.id, { objectId: it.objectId, cellKey: e.target.value })}
                              >
                                {keys.map((k) => (
                                  <option key={k} value={k}>
                                    {obj ? cellName(obj, k) : k}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          {checkoutsForItem(checkouts, it.id).map((c) => (
                            <p key={c.id} className="db-checkout-note">
                              {c.quantity} in {c.userName}'s inventory
                            </p>
                          ))}
                        </td>
                        <td>
                          <input
                            key={it.tagIds.join(',')}
                            className="db-cell"
                            defaultValue={it.tagIds.map((id) => tags[id]?.name).filter(Boolean).join(', ')}
                            placeholder="tag1, tag2"
                            onBlur={(e) => updateItem(it.id, { tagIds: resolveTagIds(e.target.value) })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            }}
                          />
                        </td>
                        <td className="num">
                          <NumberField
                            className="db-cell num"
                            value={it.value}
                            placeholder="—"
                            optional
                            onCommit={(v) => updateItem(it.id, { value: v })}
                          />
                        </td>
                        <td>
                          <input
                            className="db-cell"
                            value={it.serial ?? ''}
                            onChange={(e) => updateItem(it.id, { serial: e.target.value || undefined })}
                          />
                        </td>
                        <td>
                          <input
                            className="db-cell"
                            placeholder="YYYY-MM-DD"
                            value={it.purchaseDate ?? ''}
                            onChange={(e) => updateItem(it.id, { purchaseDate: e.target.value || undefined })}
                          />
                        </td>
                        <td>
                          <input
                            className="db-cell"
                            value={it.notes ?? ''}
                            onChange={(e) => updateItem(it.id, { notes: e.target.value || undefined })}
                          />
                        </td>
                        <td>
                          <button
                            className="btn icon danger"
                            onClick={() => {
                              if (confirm(`Delete "${it.name}"?`)) removeItem(it.id);
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
