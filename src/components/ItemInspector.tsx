import { useEffect, useRef, useState } from 'react';
import { X, ImagePlus, Trash2, Plus, Minus, ChevronDown } from 'lucide-react';
import { useStore, useActiveRoom } from '../store/store';
import { fromInches, toInches, UNIT_LABEL } from '../lib/units';
import { locationKeys, cellName } from '../lib/shelf';
import NumberField from './NumberField';

const TAG_COLORS = ['#4f8cff', '#39c07a', '#ff9f45', '#a678f0', '#8b95a7', '#ff5d6c', '#2dd4bf', '#f0c674'];

export default function ItemInspector() {
  const id = useStore((s) => s.inspectItemId);
  const room = useActiveRoom();
  const items = room.items;
  const tags = useStore((s) => s.tags);
  const objects = room.objects;
  const rooms = useStore((s) => s.rooms);
  const roomOrder = useStore((s) => s.roomOrder);
  const units = useStore((s) => s.settings.units);
  const update = useStore((s) => s.updateItem);
  const remove = useStore((s) => s.removeItem);
  const moveQtyAction = useStore((s) => s.moveItemQty);
  const addTag = useStore((s) => s.addTag);
  const inspectItem = useStore((s) => s.inspectItem);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [moveTarget, setMoveTarget] = useState('');
  const [moveQty, setMoveQty] = useState(1);

  useEffect(() => {
    setMoveTarget('');
    setMoveQty(id ? items[id]?.quantity ?? 1 : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const item = id ? items[id] : null;
  if (!item) return null;

  const u = UNIT_LABEL[units];

  const onFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => update(item.id, { image: String(reader.result) });
    reader.readAsDataURL(f);
  };

  const toggleTag = (tagId: string) => {
    const has = item.tagIds.includes(tagId);
    update(item.id, { tagIds: has ? item.tagIds.filter((t) => t !== tagId) : [...item.tagIds, tagId] });
  };

  const createTag = () => {
    if (!newTag.trim()) return;
    const color = TAG_COLORS[Object.keys(tags).length % TAG_COLORS.length];
    const tid = addTag(newTag.trim(), color);
    update(item.id, { tagIds: [...item.tagIds, tid] });
    setNewTag('');
  };

  const dispLen = (v?: number): number | undefined => (v != null ? Math.round(fromInches(v, units) * 100) / 100 : undefined);

  return (
    <div className="item-inspector glass" onClick={(e) => e.stopPropagation()}>
      <div className="ii-head">
        <strong>Item details</strong>
        <button className="btn icon" onClick={() => inspectItem(null)}>
          <X size={16} />
        </button>
      </div>

      <div className="ii-body">
        <div
          className="ii-image"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
          }}
        >
          {item.image ? <img src={item.image} alt="" /> : (
            <div className="ii-image-empty">
              <ImagePlus size={28} />
              <span>Add photo</span>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </div>

        <label className="label">Name</label>
        <input className="field" value={item.name} onChange={(e) => update(item.id, { name: e.target.value })} />

        <label className="label">Quantity</label>
        <div className="qty-stepper">
          <button className="btn icon" onClick={() => update(item.id, { quantity: Math.max(0, item.quantity - 1) })}>
            <Minus size={15} />
          </button>
          <NumberField
            value={item.quantity}
            step={1}
            onCommit={(v) => update(item.id, { quantity: Math.max(0, Math.round(v ?? item.quantity)) })}
          />
          <button className="btn icon" onClick={() => update(item.id, { quantity: item.quantity + 1 })}>
            <Plus size={15} />
          </button>
        </div>

        <label className="label">Tags</label>
        <div className="tag-picker">
          {Object.values(tags).map((t) => (
            <button
              key={t.id}
              className={`tag-chip toggle ${item.tagIds.includes(t.id) ? 'on' : ''}`}
              style={{
                background: item.tagIds.includes(t.id) ? `${t.color}30` : 'transparent',
                color: item.tagIds.includes(t.id) ? t.color : 'var(--text-2)',
                borderColor: `${t.color}66`,
              }}
              onClick={() => toggleTag(t.id)}
            >
              <span className="dot" style={{ background: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
        <div className="new-tag-row">
          <input
            className="field"
            placeholder="New tag…"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createTag()}
          />
          <button className="btn" onClick={createTag}>
            <Plus size={14} />
          </button>
        </div>

        <label className="label">Location</label>
        <p className="hint ii-current-location">
          {room.name} · {objects[item.objectId] ? `${objects[item.objectId].name} · ${cellName(objects[item.objectId], item.cellKey)}` : 'Unknown'}
        </p>

        <div className="move-row">
          <select className="field" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
            <option value="">Move to…</option>
            <optgroup label={room.name}>
              {Object.values(objects).map((o) =>
                locationKeys(o)
                  .filter((k) => !(o.id === item.objectId && k === item.cellKey))
                  .map((k) => (
                    <option key={`${room.id}|${o.id}|${k}`} value={`${room.id}|${o.id}|${k}`}>
                      {o.name} · {cellName(o, k)}
                    </option>
                  )),
              )}
            </optgroup>
            {roomOrder
              .filter((rid) => rid !== room.id)
              .map((rid) => {
                const r = rooms[rid];
                return (
                  <optgroup key={rid} label={r.name}>
                    {Object.values(r.objects).map((o) =>
                      locationKeys(o).map((k) => (
                        <option key={`${rid}|${o.id}|${k}`} value={`${rid}|${o.id}|${k}`}>
                          {o.name} · {cellName(o, k)}
                        </option>
                      )),
                    )}
                  </optgroup>
                );
              })}
          </select>

          {item.quantity > 1 && (
            <NumberField
              className="move-qty-input"
              min={1}
              max={item.quantity}
              value={moveQty}
              step={1}
              title={`How many of ${item.quantity} to move`}
              onCommit={(v) => setMoveQty(Math.max(1, Math.min(item.quantity, Math.round(v ?? moveQty))))}
            />
          )}

          <button
            className="btn primary"
            disabled={!moveTarget}
            onClick={() => {
              if (!moveTarget) return;
              const [roomId, objectId, cellKey] = moveTarget.split('|');
              moveQtyAction(item.id, item.quantity > 1 ? moveQty : item.quantity, roomId, { objectId, cellKey });
              setMoveTarget('');
            }}
          >
            Move
          </button>
        </div>

        <button className="optional-toggle" onClick={() => setShowOptional((v) => !v)}>
          <ChevronDown size={14} style={{ transform: showOptional ? 'rotate(180deg)' : 'none' }} />
          Optional details
        </button>

        {showOptional && (
          <div className="optional-fields">
            <label className="label">Notes</label>
            <textarea
              className="field"
              rows={2}
              value={item.notes ?? ''}
              onChange={(e) => update(item.id, { notes: e.target.value })}
            />
            <div className="grid-3">
              <NumberField
                label={`W (${u})`}
                value={dispLen(item.widthIn)}
                optional
                onCommit={(v) => update(item.id, { widthIn: v !== undefined ? toInches(v, units) : undefined })}
              />
              <NumberField
                label={`H (${u})`}
                value={dispLen(item.heightIn)}
                optional
                onCommit={(v) => update(item.id, { heightIn: v !== undefined ? toInches(v, units) : undefined })}
              />
              <NumberField
                label={`D (${u})`}
                value={dispLen(item.depthIn)}
                optional
                onCommit={(v) => update(item.id, { depthIn: v !== undefined ? toInches(v, units) : undefined })}
              />
            </div>
            <label className="label">Purchase date</label>
            <input
              className="field"
              type="date"
              value={item.purchaseDate ?? ''}
              onChange={(e) => update(item.id, { purchaseDate: e.target.value || undefined })}
            />
            <div className="grid-2">
              <NumberField
                label="Value ($)"
                value={item.value}
                optional
                onCommit={(v) => update(item.id, { value: v })}
              />
              <label className="num-field">
                <span className="label">Serial</span>
                <input
                  className="field"
                  value={item.serial ?? ''}
                  onChange={(e) => update(item.id, { serial: e.target.value || undefined })}
                />
              </label>
            </div>
          </div>
        )}

        <button className="btn danger ii-delete" onClick={() => remove(item.id)}>
          <Trash2 size={14} /> Delete item
        </button>
      </div>
    </div>
  );
}
