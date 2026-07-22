import { useMemo, useRef, useState } from 'react';
import { FolderTree, Plus, Upload, Download, ChevronUp, ChevronDown, Copy, Trash2 } from 'lucide-react';
import { useStore, useToastStore } from '../store/store';
import { computeVisibleBounds } from '../lib/bounds';
import { downloadRoomFile, parseRoomFile } from '../lib/roomFile';
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
  const addRoom = useStore((s) => s.addRoom);
  const renameRoom = useStore((s) => s.renameRoom);
  const deleteRoom = useStore((s) => s.deleteRoom);
  const duplicateRoom = useStore((s) => s.duplicateRoom);
  const importRoom = useStore((s) => s.importRoom);
  const reorderRoom = useStore((s) => s.reorderRoom);
  const setActiveRoom = useStore((s) => s.setActiveRoom);
  const mode = useStore((s) => s.settings.mode);
  const isDesign = mode === 'design';

  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const pushToast = useToastStore((s) => s.push);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file to re-trigger onChange
    if (!file) return;
    try {
      const payload = parseRoomFile(await file.text());
      importRoom(payload);
      pushToast('success', `Room imported as "${payload.name}"`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not import that file.');
    }
  };

  const handleExport = (room: Room) => {
    try {
      downloadRoomFile(room);
      pushToast('success', `Exported "${room.name}" as a design file`);
    } catch {
      pushToast('error', `Could not export "${room.name}".`);
    }
  };

  return (
    <div className="room-nav glass">
      <div className="panel-head" onClick={() => setCollapsed((c) => !c)}>
        <FolderTree size={14} />
        <span>Rooms</span>
        {isDesign && (
          <>
            <button
              className="btn icon"
              style={{ marginLeft: 'auto' }}
              title="Import a room design from a file"
              onClick={(e) => {
                e.stopPropagation();
                importInputRef.current?.click();
              }}
            >
              <Upload size={15} />
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onClick={(e) => e.stopPropagation()}
              onChange={handleImportFile}
            />
            <button
              className="btn icon"
              title="Add room"
              onClick={(e) => {
                e.stopPropagation();
                addRoom();
              }}
            >
              <Plus size={15} />
            </button>
          </>
        )}
      </div>

      {!collapsed && (
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
                              <ChevronUp size={12} />
                            </button>
                            <button
                              className="btn icon"
                              disabled={idx === roomOrder.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                reorderRoom(id, 1);
                              }}
                            >
                              <ChevronDown size={12} />
                            </button>
                            <button
                              className="btn icon"
                              title="Duplicate room"
                              onClick={(e) => {
                                e.stopPropagation();
                                duplicateRoom(id);
                              }}
                            >
                              <Copy size={12} />
                            </button>
                            <button
                              className="btn icon"
                              title="Export room design as a file"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExport(r);
                              }}
                            >
                              <Download size={12} />
                            </button>
                            {roomOrder.length > 1 && (
                              <button
                                className="btn icon danger"
                                title="Delete room"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm(`Delete "${r.name}"? This removes all its furniture and inventory.`))
                                    deleteRoom(id);
                                }}
                              >
                                <Trash2 size={12} />
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
      )}
    </div>
  );
}
