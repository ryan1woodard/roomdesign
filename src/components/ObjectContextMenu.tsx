import { useEffect, useRef } from 'react';
import { Copy, Trash2, DoorOpen } from 'lucide-react';
import { useStore, useActiveRoom } from '../store/store';

export default function ObjectContextMenu() {
  const contextMenu = useStore((s) => s.contextMenu);
  const closeContextMenu = useStore((s) => s.closeContextMenu);
  const duplicateObject = useStore((s) => s.duplicateObject);
  const removeObject = useStore((s) => s.removeObject);
  const openPicker = useStore((s) => s.openPicker);
  const open = useStore((s) => s.open);
  const mode = useStore((s) => s.settings.mode);
  const room = useActiveRoom();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeContextMenu();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', closeContextMenu, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', closeContextMenu, true);
    };
  }, [contextMenu, closeContextMenu]);

  if (!contextMenu) return null;
  const obj = room.objects[contextMenu.objectId];
  if (!obj) return null;
  const isContainer = obj.storage.type === 'grid';

  return (
    <div
      ref={ref}
      className="context-menu glass"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="context-menu-title">{obj.name}</div>
      {mode === 'inventory' && (
        <button
          className="context-item"
          onClick={() => {
            if (isContainer) openPicker(obj.id);
            else open({ objectId: obj.id, cellKey: 'surface' });
            closeContextMenu();
          }}
        >
          <DoorOpen size={14} /> Open
        </button>
      )}
      {mode === 'design' && (
        <>
          <button
            className="context-item"
            onClick={() => {
              duplicateObject(obj.id);
              closeContextMenu();
            }}
          >
            <Copy size={14} /> Duplicate
          </button>
          <div className="context-sep" />
          <button
            className="context-item danger"
            onClick={() => {
              removeObject(obj.id);
              closeContextMenu();
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </>
      )}
    </div>
  );
}
