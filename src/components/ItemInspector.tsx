import { useRef, useState } from 'react';
import { X, ImagePlus, Trash2, Plus, Minus, ChevronDown } from 'lucide-react';
import { useStore } from '../store/store';
import { fromInches, toInches, UNIT_LABEL } from '../lib/units';
import { locationKeys, cellName } from '../lib/shelf';

const TAG_COLORS = ['#4f8cff', '#39c07a', '#ff9f45', '#a678f0', '#8b95a7', '#ff5d6c', '#2dd4bf', '#f0c674'];

export default function ItemInspector() {
  const id = useStore((s) => s.inspectItemId);
  const items = useStore((s) => s.items);
  const tags = useStore((s) => s.tags);
  const objects = useStore((s) => s.objects);
  const units = useStore((s) => s.settings.units);
  const update = useStore((s) => s.updateItem);
  const remove = useStore((s) => s.removeItem);
  const move = useStore((s) => s.moveItem);
  const addTag = useStore((s) => s.addTag);
  const inspectItem = useStore((s) => s.inspectItem);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [newTag, setNewTag] = useState('');

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

  const dispLen = (v?: number) => (v != null ? Math.round(fromInches(v, units) * 100) / 100 : '');

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
          <input
            className="field"
            type="number"
            value={item.quantity}
            onChange={(e) => update(item.id, { quantity: Math.max(0, parseInt(e.target.value) || 0) })}
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
        <select
          className="field"
          value={`${item.objectId}|${item.cellKey}`}
          onChange={(e) => {
            const [objectId, cellKey] = e.target.value.split('|');
            move(item.id, { objectId, cellKey });
          }}
        >
          {Object.values(objects).map((o) =>
            locationKeys(o).map((k) => (
              <option key={`${o.id}|${k}`} value={`${o.id}|${k}`}>
                {o.name} · {cellName(o, k)}
              </option>
            )),
          )}
        </select>

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
              <label className="num-field">
                <span className="label">W ({u})</span>
                <input
                  className="field"
                  type="number"
                  value={dispLen(item.widthIn)}
                  onChange={(e) => update(item.id, { widthIn: e.target.value ? toInches(parseFloat(e.target.value), units) : undefined })}
                />
              </label>
              <label className="num-field">
                <span className="label">H ({u})</span>
                <input
                  className="field"
                  type="number"
                  value={dispLen(item.heightIn)}
                  onChange={(e) => update(item.id, { heightIn: e.target.value ? toInches(parseFloat(e.target.value), units) : undefined })}
                />
              </label>
              <label className="num-field">
                <span className="label">D ({u})</span>
                <input
                  className="field"
                  type="number"
                  value={dispLen(item.depthIn)}
                  onChange={(e) => update(item.id, { depthIn: e.target.value ? toInches(parseFloat(e.target.value), units) : undefined })}
                />
              </label>
            </div>
            <label className="label">Purchase date</label>
            <input
              className="field"
              type="date"
              value={item.purchaseDate ?? ''}
              onChange={(e) => update(item.id, { purchaseDate: e.target.value || undefined })}
            />
            <div className="grid-2">
              <label className="num-field">
                <span className="label">Value ($)</span>
                <input
                  className="field"
                  type="number"
                  value={item.value ?? ''}
                  onChange={(e) => update(item.id, { value: e.target.value ? parseFloat(e.target.value) : undefined })}
                />
              </label>
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
