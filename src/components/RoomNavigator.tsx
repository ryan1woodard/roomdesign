import { useMemo, useRef, useState } from 'react';
import {
  FolderTree,
  Plus,
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  Building2,
  ImagePlus,
  X,
  RotateCcw,
} from 'lucide-react';
import { useStore, useActiveRoom } from '../store/store';
import { computeVisibleBounds } from '../lib/bounds';
import type { Room } from '../types';

function RoomThumb({ room }: { room: Room }) {
  const bounds = useMemo(() => computeVisibleBounds(room) ?? { minX: 0, minY: 0, maxX: 200, maxY: 150 }, [room]);
  const pad = 20;
  const b = { minX: bounds.minX - pad, minY: bounds.minY - pad, maxX: bounds.maxX + pad, maxY: bounds.maxY + pad };
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const W = 64;
  const H = 44;
  const scale = Math.min(W / bw, H / bh);
  const to = (x: number, y: number) => ({ x: (x - b.minX) * scale, y: (y - b.minY) * scale });

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="room-thumb">
      <rect x={0} y={0} width={W} height={H} fill={room.floorColor} rx={4} />
      {Object.values(room.walls).map((wall) => {
        const a = room.vertices[wall.a];
        const bb = room.vertices[wall.b];
        if (!a || !bb) return null;
        const pa = to(a.x, a.y);
        const pb = to(bb.x, bb.y);
        return <line key={wall.id} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#8b95a8" strokeWidth={1.2} />;
      })}
      {Object.values(room.objects).map((obj) => {
        const p = to(obj.x, obj.y);
        return (
          <rect
            key={obj.id}
            x={p.x}
            y={p.y}
            width={Math.max(1, obj.width * scale)}
            height={Math.max(1, obj.height * scale)}
            fill={obj.fill === 'transparent' ? '#4f8cff' : obj.fill}
          />
        );
      })}
    </svg>
  );
}

export default function RoomNavigator() {
  const rooms = useStore((s) => s.rooms);
  const roomOrder = useStore((s) => s.roomOrder);
  const activeRoomId = useStore((s) => s.activeRoomId);
  const activeRoom = useActiveRoom();
  const addRoom = useStore((s) => s.addRoom);
  const renameRoom = useStore((s) => s.renameRoom);
  const deleteRoom = useStore((s) => s.deleteRoom);
  const duplicateRoom = useStore((s) => s.duplicateRoom);
  const reorderRoom = useStore((s) => s.reorderRoom);
  const setActiveRoom = useStore((s) => s.setActiveRoom);
  const setRoomNotes = useStore((s) => s.setRoomNotes);
  const setBlueprint = useStore((s) => s.setBlueprint);
  const setBlueprintOpacity = useStore((s) => s.setBlueprintOpacity);
  const clearBlueprint = useStore((s) => s.clearBlueprint);
  const restoreFromRecovery = useStore((s) => s.restoreFromRecovery);
  const mode = useStore((s) => s.settings.mode);
  const isDesign = mode === 'design';

  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showProps, setShowProps] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onBlueprintFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => setBlueprint(String(reader.result));
    reader.readAsDataURL(f);
  };

  return (
    <div className="room-nav glass">
      <div className="panel-head" onClick={() => setCollapsed((c) => !c)}>
        <FolderTree size={14} />
        <span>Rooms</span>
        {isDesign && (
          <button
            className="btn icon"
            style={{ marginLeft: 'auto' }}
            onClick={(e) => {
              e.stopPropagation();
              addRoom();
            }}
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="room-list">
            {roomOrder.map((id, idx) => {
              const r = rooms[id];
              const active = id === activeRoomId;
              return (
                <div
                  key={id}
                  className={`room-row ${active ? 'active' : ''} ${isDesign ? 'interactive' : ''}`}
                  onClick={() => setActiveRoom(id)}
                >
                  <RoomThumb room={r} />
                  <div className="room-row-body">
                    {editing === id ? (
                      <input
                        autoFocus
                        className="field layer-name-input"
                        defaultValue={r.name}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          renameRoom(id, e.target.value || r.name);
                          setEditing(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                      />
                    ) : (
                      <>
                        <div className="room-row-info">
                          <span
                            className="room-name"
                            onDoubleClick={(e) => {
                              if (!isDesign) return;
                              e.stopPropagation();
                              setEditing(id);
                            }}
                          >
                            {r.name}
                          </span>
                          <span className="room-meta">{Object.keys(r.items).length} items</span>
                        </div>
                        {isDesign && (
                          <div className="room-row-actions-slot">
                            <button
                              className="btn icon"
                              disabled={idx === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                reorderRoom(id, -1);
                              }}
                            >
                              <ChevronUp size={13} />
                            </button>
                            <button
                              className="btn icon"
                              disabled={idx === roomOrder.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                reorderRoom(id, 1);
                              }}
                            >
                              <ChevronDown size={13} />
                            </button>
                            <button
                              className="btn icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                duplicateRoom(id);
                              }}
                            >
                              <Copy size={13} />
                            </button>
                            {roomOrder.length > 1 && (
                              <button
                                className="btn icon danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm(`Delete "${r.name}"? This removes all its furniture and inventory.`))
                                    deleteRoom(id);
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button className="panel-subhead" onClick={() => setShowProps((v) => !v)}>
            <Building2 size={13} /> Room properties
          </button>

          {showProps && (
            <div className="room-props">
              <label className="label">Notes</label>
              {isDesign ? (
                <textarea
                  className="field"
                  rows={2}
                  value={activeRoom.notes}
                  placeholder="Optional notes about this room…"
                  onChange={(e) => setRoomNotes(e.target.value)}
                />
              ) : (
                <p className="hint">{activeRoom.notes || 'No notes.'}</p>
              )}
              {isDesign && (
                <>
                  <label className="label">Blueprint reference</label>
                  {activeRoom.blueprint ? (
                    <>
                      <div className="blueprint-row">
                        <span className="hint">Image loaded</span>
                        <button className="btn icon danger" onClick={clearBlueprint}>
                          <X size={13} />
                        </button>
                      </div>
                      <input
                        className="field"
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={activeRoom.blueprint.opacity}
                        onChange={(e) => setBlueprintOpacity(parseFloat(e.target.value))}
                      />
                    </>
                  ) : (
                    <button className="btn" onClick={() => fileRef.current?.click()}>
                      <ImagePlus size={14} /> Import floor plan image
                    </button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => e.target.files?.[0] && onBlueprintFile(e.target.files[0])}
                  />
                </>
              )}
            </div>
          )}

          {isDesign && (
            <button
              className="panel-subhead"
              onClick={async () => {
                if (confirm('Restore the most recent auto-save recovery snapshot? This replaces your current project.')) {
                  const ok = await restoreFromRecovery();
                  if (!ok) alert('No recovery snapshot was found yet.');
                }
              }}
            >
              <RotateCcw size={13} /> Restore last snapshot
            </button>
          )}
        </>
      )}
    </div>
  );
}
