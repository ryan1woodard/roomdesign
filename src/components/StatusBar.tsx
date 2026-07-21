import { Hammer, Package, ZoomIn } from 'lucide-react';
import { useStore, useActiveRoom } from '../store/store';
import { formatLength } from '../lib/units';
import { wallVector } from '../lib/walls';

interface Props {
  zoomPct: number;
  cursorWorld: { x: number; y: number } | null;
}

export default function StatusBar({ zoomPct, cursorWorld }: Props) {
  const room = useActiveRoom();
  const settings = useStore((s) => s.settings);
  const selection = useStore((s) => s.selection);
  const wallSelection = useStore((s) => s.wallSelection);
  const wallTool = useStore((s) => s.wallTool);
  const units = settings.units;

  const activeLayer = room.layers.find((l) => l.id === room.activeLayerId);
  const isWallMode = settings.mode === 'design' && activeLayer?.kind === 'wall';

  let hint: string | null = null;
  if (isWallMode && wallTool === 'draw') {
    hint = 'Click to place wall points · Drag for a straight wall · Enter/double-click to finish · Esc to cancel';
  } else if (settings.mode === 'inventory') {
    hint = 'Double-click furniture to open · Scroll to zoom · Drag to pan';
  } else {
    hint = 'Scroll to zoom · Drag to pan';
  }

  let selectionLabel: string | null = null;
  if (wallSelection) {
    if (wallSelection.type === 'wall') {
      const wall = room.walls[wallSelection.id];
      if (wall) {
        const length = wallVector(wall, room.vertices).length;
        selectionLabel = `Wall · ${formatLength(length, units)} long · ${formatLength(wall.thickness, units)} thick`;
      }
    } else if (wallSelection.type === 'opening') {
      const opening = room.openings[wallSelection.id];
      if (opening) selectionLabel = `${opening.kind === 'door' ? 'Door' : 'Window'} · ${formatLength(opening.width, units)}`;
    } else {
      selectionLabel = 'Vertex selected';
    }
  } else if (selection.length === 1) {
    const obj = room.objects[selection[0]];
    if (obj) selectionLabel = `${obj.name} · ${formatLength(obj.width, units)} × ${formatLength(obj.height, units)}`;
  } else if (selection.length > 1) {
    selectionLabel = `${selection.length} objects selected`;
  }

  return (
    <div className="status-bar glass">
      <span className="status-item status-mode">
        {settings.mode === 'design' ? <Hammer size={12} /> : <Package size={12} />}
        {settings.mode === 'design' ? 'Design Mode' : 'Inventory Mode'}
      </span>
      <span className="status-divider" />
      <span className="status-item">
        <ZoomIn size={12} />
        {Math.round(zoomPct)}%
      </span>
      {cursorWorld && (
        <>
          <span className="status-divider" />
          <span className="status-item status-cursor">
            {formatLength(cursorWorld.x, units)}, {formatLength(cursorWorld.y, units)}
          </span>
        </>
      )}
      {selectionLabel && (
        <>
          <span className="status-divider" />
          <span className="status-item status-selection">{selectionLabel}</span>
        </>
      )}
      {hint && <span className="status-item status-hint">{hint}</span>}
    </div>
  );
}
