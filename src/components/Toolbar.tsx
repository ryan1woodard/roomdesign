import {
  Square,
  Squircle,
  Circle,
  Type,
  Boxes,
  Grid3x3,
  Magnet,
  Undo2,
  Redo2,
  Tags,
  Maximize,
  MousePointer2,
  PencilLine,
  DoorOpen,
  RectangleHorizontal,
  History,
} from 'lucide-react';
import { useStore, useActiveRoom } from '../store/store';
import { ALL_UNITS, UNIT_LABEL } from '../lib/units';
import type { ObjectKind } from '../types';
import SaveIndicator from './SaveIndicator';

const TOOLS: { kind: ObjectKind; icon: React.ReactNode; label: string }[] = [
  { kind: 'container', icon: <Boxes size={17} />, label: 'Shelf / Cabinet' },
  { kind: 'rect', icon: <Square size={17} />, label: 'Rectangle' },
  { kind: 'roundedRect', icon: <Squircle size={17} />, label: 'Rounded' },
  { kind: 'circle', icon: <Circle size={17} />, label: 'Circle' },
  { kind: 'text', icon: <Type size={17} />, label: 'Text' },
];

const WALL_TOOLS: { tool: 'select' | 'draw' | 'door' | 'window'; icon: React.ReactNode; label: string }[] = [
  { tool: 'select', icon: <MousePointer2 size={17} />, label: 'Select & edit' },
  { tool: 'draw', icon: <PencilLine size={17} />, label: 'Draw walls' },
  { tool: 'door', icon: <DoorOpen size={17} />, label: 'Add door' },
  { tool: 'window', icon: <RectangleHorizontal size={17} />, label: 'Add window' },
];

export default function Toolbar() {
  const settings = useStore((s) => s.settings);
  const room = useActiveRoom();
  const addObject = useStore((s) => s.addObject);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const toggleSnap = useStore((s) => s.toggleSnap);
  const toggleShowAllLabels = useStore((s) => s.toggleShowAllLabels);
  const setUnit = useStore((s) => s.setUnit);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const requestFitToView = useStore((s) => s.requestFitToView);
  const wallTool = useStore((s) => s.wallTool);
  const setWallTool = useStore((s) => s.setWallTool);
  const openLogViewer = useStore((s) => s.openLogViewer);

  const mode = settings.mode;
  const activeLayer = room.layers.find((l) => l.id === room.activeLayerId);
  const isWallMode = mode === 'design' && activeLayer?.kind === 'wall';

  return (
    <div className="toolbar glass">
      <div className="brand">
        <span className="brand-mark">◆</span>
        <span className="brand-name">SRS Lab Designer</span>
      </div>
      <SaveIndicator />
      <div className="divider-v" />

      {mode === 'inventory' ? (
        <button className="btn icon" title="Select & navigate" disabled>
          <MousePointer2 size={17} />
        </button>
      ) : isWallMode ? (
        WALL_TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`btn icon ${wallTool === t.tool ? 'active' : ''}`}
            title={t.label}
            onClick={() => setWallTool(t.tool)}
          >
            {t.icon}
          </button>
        ))
      ) : (
        TOOLS.map((t) => (
          <button key={t.kind} className="btn icon" title={t.label} onClick={() => addObject(t.kind)}>
            {t.icon}
          </button>
        ))
      )}

      <div className="divider-v" />

      <button className="btn icon" title="Undo (⌘Z)" disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.3 }} onClick={undo}>
        <Undo2 size={17} />
      </button>
      <button className="btn icon" title="Redo (⌘⇧Z)" disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.3 }} onClick={redo}>
        <Redo2 size={17} />
      </button>

      <div className="divider-v" />

      {mode === 'design' && (
        <>
          <button className={`btn icon ${settings.gridVisible ? 'active' : ''}`} title="Toggle grid" onClick={toggleGrid}>
            <Grid3x3 size={17} />
          </button>
          <button className={`btn icon ${settings.snapToGrid ? 'active' : ''}`} title="Snap to grid" onClick={toggleSnap}>
            <Magnet size={17} />
          </button>
        </>
      )}
      <button
        className={`btn icon ${settings.showAllLabels ? 'active' : ''}`}
        title="Show All Labels"
        onClick={toggleShowAllLabels}
      >
        <Tags size={17} />
      </button>
      <button className="btn icon" title="Fit to view (F)" onClick={requestFitToView}>
        <Maximize size={17} />
      </button>
      {mode === 'inventory' && (
        <button className="btn icon" title="Inventory log" onClick={openLogViewer}>
          <History size={17} />
        </button>
      )}

      <div className="divider-v" />

      <select className="unit-select" value={settings.units} onChange={(e) => setUnit(e.target.value as never)}>
        {ALL_UNITS.map((u) => (
          <option key={u} value={u}>
            {UNIT_LABEL[u]}
          </option>
        ))}
      </select>
    </div>
  );
}
