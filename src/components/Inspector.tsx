import { Copy, Trash2, DoorOpen, Boxes, X } from 'lucide-react';
import { useStore } from '../store/store';
import { fromInches, toInches, UNIT_LABEL } from '../lib/units';
import type { RoomObject } from '../types';
import ShelfEditor from './ShelfEditor';

const SWATCHES = ['#3b4a63', '#4a3b5f', '#3b5f4a', '#5f4a3b', '#5f3b4a', '#334', '#2a2f3a', '#4f8cff'];

function NumberField({
  label,
  value,
  onCommit,
  unitLabel,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  unitLabel?: string;
  step?: number;
}) {
  return (
    <label className="num-field">
      <span className="label">{label}</span>
      <div className="num-input-wrap">
        <input
          className="field"
          type="number"
          step={step}
          value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
          onChange={(e) => onCommit(parseFloat(e.target.value) || 0)}
        />
        {unitLabel && <span className="num-unit">{unitLabel}</span>}
      </div>
    </label>
  );
}

export default function Inspector() {
  const selection = useStore((s) => s.selection);
  const objects = useStore((s) => s.objects);
  const layers = useStore((s) => s.layers);
  const units = useStore((s) => s.settings.units);
  const spaceAwareness = useStore((s) => s.settings.spaceAwareness);
  const items = useStore((s) => s.items);
  const update = useStore((s) => s.updateObject);
  const remove = useStore((s) => s.removeObject);
  const duplicate = useStore((s) => s.duplicateObject);
  const setStorage = useStore((s) => s.setStorage);
  const open = useStore((s) => s.open);
  const openPicker = useStore((s) => s.openPicker);
  const clearSelection = useStore((s) => s.clearSelection);

  if (selection.length !== 1) {
    if (selection.length > 1) {
      return (
        <div className="inspector glass">
          <div className="inspector-head">
            <strong>{selection.length} objects</strong>
            <button className="btn icon" onClick={clearSelection}>
              <X size={15} />
            </button>
          </div>
          <p className="hint" style={{ padding: 16 }}>
            Multiple objects selected. Drag to move them, or select a single object to edit its properties.
          </p>
        </div>
      );
    }
    return null;
  }

  const obj: RoomObject | undefined = objects[selection[0]];
  if (!obj) return null;

  const isContainer = obj.storage.type === 'grid';
  const u = UNIT_LABEL[units];

  const dispLen = (inches: number) => fromInches(inches, units);
  const setLen = (key: keyof RoomObject) => (v: number) => update(obj.id, { [key]: toInches(v, units) } as never);

  // Space-awareness fill estimate (footprint area basis).
  const fill = (() => {
    if (!spaceAwareness) return null;
    const cellItems = Object.values(items).filter((i) => i.objectId === obj.id);
    const containerArea = obj.width * obj.height;
    let used = 0;
    for (const it of cellItems) {
      if (it.widthIn && it.heightIn) used += it.widthIn * it.heightIn * it.quantity;
    }
    return containerArea > 0 ? Math.min(999, Math.round((used / containerArea) * 100)) : 0;
  })();

  return (
    <div className="inspector glass">
      <div className="inspector-head">
        <input
          className="field name-field"
          value={obj.name}
          onChange={(e) => update(obj.id, { name: e.target.value })}
        />
        <button className="btn icon" onClick={clearSelection} title="Deselect">
          <X size={15} />
        </button>
      </div>

      <div className="inspector-body">
        <button
          className="btn primary open-btn"
          onClick={() => (isContainer ? openPicker(obj.id) : open({ objectId: obj.id, cellKey: 'surface' }))}
        >
          <DoorOpen size={16} /> Open {isContainer ? 'compartments' : 'contents'}
        </button>

        {fill !== null && (
          <div className={`fill-meter ${fill > 100 ? 'over' : ''}`}>
            <div className="fill-bar" style={{ width: `${Math.min(100, fill)}%` }} />
            <span>{fill}% full</span>
          </div>
        )}

        <div className="section">
          <span className="label">Dimensions</span>
          <div className="grid-2">
            <NumberField label="Width" value={dispLen(obj.width)} unitLabel={u} onCommit={setLen('width')} />
            <NumberField label="Depth" value={dispLen(obj.height)} unitLabel={u} onCommit={setLen('height')} />
            <NumberField label="Height" value={dispLen(obj.depthIn)} unitLabel={u} onCommit={setLen('depthIn')} />
            <NumberField label="Rotation" value={obj.rotation} unitLabel="°" onCommit={(v) => update(obj.id, { rotation: v })} />
          </div>
        </div>

        {obj.kind !== 'text' && (
          <div className="section">
            <span className="label">Appearance</span>
            <div className="swatches">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  className={`swatch ${obj.fill === c ? 'sel' : ''}`}
                  style={{ background: c }}
                  onClick={() => update(obj.id, { fill: c })}
                />
              ))}
              <input
                type="color"
                className="color-picker"
                value={obj.fill.startsWith('#') ? obj.fill : '#3b4a63'}
                onChange={(e) => update(obj.id, { fill: e.target.value })}
              />
            </div>
            {(obj.kind === 'roundedRect' || obj.kind === 'container') && (
              <NumberField
                label="Corner radius"
                value={obj.cornerRadius}
                onCommit={(v) => update(obj.id, { cornerRadius: v })}
              />
            )}
          </div>
        )}

        <div className="section">
          <span className="label">Layer</span>
          <select
            className="field"
            value={obj.layerId}
            onChange={(e) => update(obj.id, { layerId: e.target.value })}
          >
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <div className="section">
          <div className="section-head">
            <span className="label">Storage</span>
            {!isContainer ? (
              <button
                className="btn"
                onClick={() =>
                  setStorage(obj.id, {
                    type: 'grid',
                    rows: 2,
                    cols: 2,
                    rowFractions: [1, 1],
                    colFractions: [1, 1],
                    cells: {
                      '0:0': { name: 'Bin 1', kind: 'drawer' },
                      '0:1': { name: 'Bin 2', kind: 'drawer' },
                      '1:0': { name: 'Bin 3', kind: 'drawer' },
                      '1:1': { name: 'Bin 4', kind: 'drawer' },
                    },
                  })
                }
              >
                <Boxes size={14} /> Make shelf
              </button>
            ) : (
              <button className="btn" onClick={() => setStorage(obj.id, { type: 'single' })}>
                Single space
              </button>
            )}
          </div>
          {isContainer && <ShelfEditor obj={obj} />}
        </div>

        <div className="section">
          <span className="label">Notes</span>
          <textarea
            className="field"
            rows={3}
            value={obj.notes}
            placeholder="Optional notes…"
            onChange={(e) => update(obj.id, { notes: e.target.value })}
          />
        </div>

        <div className="inspector-actions">
          <button className="btn" onClick={() => duplicate(obj.id)}>
            <Copy size={14} /> Duplicate
          </button>
          <button className="btn danger" onClick={() => remove(obj.id)}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
