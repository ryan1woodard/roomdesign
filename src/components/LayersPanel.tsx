import { useState } from 'react';
import { Eye, EyeOff, ChevronUp, ChevronDown, Plus, Layers, Trash2, Layers3 } from 'lucide-react';
import { useStore, useActiveRoom } from '../store/store';

export default function LayersPanel() {
  const room = useActiveRoom();
  const layers = room.layers;
  const objects = room.objects;
  const activeLayerId = room.activeLayerId;
  const objectLayerCount = layers.filter((l) => l.kind === 'object').length;
  const addLayer = useStore((s) => s.addLayer);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const renameLayer = useStore((s) => s.renameLayer);
  const reorderLayer = useStore((s) => s.reorderLayer);
  const deleteLayer = useStore((s) => s.deleteLayer);
  const setActiveLayer = useStore((s) => s.setActiveLayer);
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const countFor = (layerId: string) =>
    Object.values(objects).filter((o) => o.layerId === layerId).length;

  return (
    <div className="layers-panel glass">
      <div className="panel-head" onClick={() => setCollapsed((c) => !c)}>
        <Layers size={14} />
        <span>Layers</span>
        <button
          className="btn icon"
          style={{ marginLeft: 'auto' }}
          onClick={(e) => {
            e.stopPropagation();
            addLayer();
          }}
        >
          <Plus size={15} />
        </button>
      </div>

      {!collapsed && (
        <div className="layer-list">
          {[...layers].reverse().map((l, revIdx) => {
            const idx = layers.length - 1 - revIdx;
            const active = l.id === activeLayerId;
            return (
              <div
                key={l.id}
                className={`layer-row ${active ? 'active' : ''}`}
                onClick={() => setActiveLayer(l.id)}
              >
                <button
                  className="btn icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayer(l.id);
                  }}
                >
                  {l.visible ? <Eye size={14} /> : <EyeOff size={14} style={{ opacity: 0.5 }} />}
                </button>
                {l.kind === 'wall' && (
                  <span className="wall-layer-icon" title="Wall Designer layer">
                    <Layers3 size={12} />
                  </span>
                )}
                {editing === l.id ? (
                  <input
                    autoFocus
                    className="field layer-name-input"
                    defaultValue={l.name}
                    onBlur={(e) => {
                      renameLayer(l.id, e.target.value || l.name);
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span
                    className="layer-name"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditing(l.id);
                    }}
                  >
                    {l.name}
                    <span className="layer-count">{countFor(l.id)}</span>
                  </span>
                )}
                <div className="layer-actions">
                  <button
                    className="btn icon"
                    disabled={idx === layers.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      reorderLayer(l.id, 1);
                    }}
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    className="btn icon"
                    disabled={idx === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      reorderLayer(l.id, -1);
                    }}
                  >
                    <ChevronDown size={13} />
                  </button>
                  {l.kind === 'object' && objectLayerCount > 1 && (
                    <button
                      className="btn icon danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteLayer(l.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
