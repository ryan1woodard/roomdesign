import {
  Square,
  Squircle,
  Circle,
  Boxes,
  Undo2,
  Redo2,
  Maximize,
  MousePointer2,
  PencilLine,
  DoorOpen,
  RectangleHorizontal,
  History,
  Database,
  Backpack,
  Move,
  RotateCw,
  Hand,
  Tags,
  Shapes,
} from 'lucide-react';
import { useStore, useActiveRoom } from '../store/store';
import { ALL_UNITS, UNIT_LABEL } from '../lib/units';
import type { ObjectKind } from '../types';
import SaveIndicator from './SaveIndicator';
import Tooltip from './Tooltip';

const TOOLS: { kind: ObjectKind; icon: React.ReactNode; label: string }[] = [
  { kind: 'container', icon: <Boxes size={17} />, label: 'Shelf / Cabinet' },
  { kind: 'rect', icon: <Square size={17} />, label: 'Rectangle' },
  { kind: 'roundedRect', icon: <Squircle size={17} />, label: 'Rounded' },
  { kind: 'circle', icon: <Circle size={17} />, label: 'Circle' },
];

const WALL_TOOLS: { tool: 'select' | 'draw' | 'door' | 'window'; icon: React.ReactNode; label: string }[] = [
  { tool: 'select', icon: <MousePointer2 size={17} />, label: 'Select' },
  { tool: 'draw', icon: <PencilLine size={17} />, label: 'Draw Walls' },
  { tool: 'door', icon: <DoorOpen size={17} />, label: 'Add Door' },
  { tool: 'window', icon: <RectangleHorizontal size={17} />, label: 'Add Window' },
];

export default function Toolbar() {
  const settings = useStore((s) => s.settings);
  const room = useActiveRoom();
  const addObject = useStore((s) => s.addObject);
  const toggleShowAllLabels = useStore((s) => s.toggleShowAllLabels);
  const toggleShowIcons = useStore((s) => s.toggleShowIcons);
  const setUnit = useStore((s) => s.setUnit);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const requestFitToView = useStore((s) => s.requestFitToView);
  const wallTool = useStore((s) => s.wallTool);
  const setWallTool = useStore((s) => s.setWallTool);
  const objectTool = useStore((s) => s.objectTool);
  const setObjectTool = useStore((s) => s.setObjectTool);
  const openLogViewer = useStore((s) => s.openLogViewer);
  const openInventoryDb = useStore((s) => s.openInventoryDb);
  const openMyInventory = useStore((s) => s.openMyInventory);

  const mode = settings.mode;
  const activeLayer = room.layers.find((l) => l.id === room.activeLayerId);
  const isWallMode = mode === 'design' && activeLayer?.kind === 'wall';

  return (
    <div className="toolbar glass">
      <div className="brand">
        <span className="brand-name">SRS Inventory</span>
      </div>
      <SaveIndicator />
      {mode !== 'inventory' && <div className="divider-v" />}

      {mode === 'inventory' ? null : isWallMode ? (
        WALL_TOOLS.map((t) => (
          <Tooltip key={t.tool} label={t.label}>
            <button className={`btn icon ${wallTool === t.tool ? 'active' : ''}`} onClick={() => setWallTool(t.tool)}>
              {t.icon}
            </button>
          </Tooltip>
        ))
      ) : (
        <>
          {TOOLS.map((t) => (
            <Tooltip key={t.kind} label={t.label}>
              <button className="btn icon" onClick={() => addObject(t.kind)}>
                {t.icon}
              </button>
            </Tooltip>
          ))}
          <div className="divider-v" />
          <Tooltip label="Grab (G)">
            <button
              className={`btn icon ${objectTool === 'freeMove' ? 'active' : ''}`}
              onClick={() => setObjectTool(objectTool === 'freeMove' ? 'select' : 'freeMove')}
            >
              <Hand size={17} />
            </button>
          </Tooltip>
          <Tooltip label="Move (M)">
            <button
              className={`btn icon ${objectTool === 'move' ? 'active' : ''}`}
              onClick={() => setObjectTool(objectTool === 'move' ? 'select' : 'move')}
            >
              <Move size={17} />
            </button>
          </Tooltip>
          <Tooltip label="Rotate (R)">
            <button
              className={`btn icon ${objectTool === 'rotate' ? 'active' : ''}`}
              onClick={() => setObjectTool(objectTool === 'rotate' ? 'select' : 'rotate')}
            >
              <RotateCw size={17} />
            </button>
          </Tooltip>
        </>
      )}

      <div className="divider-v" />

      <Tooltip label="Undo (Ctrl+Z)">
        <button className="btn icon" disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.3 }} onClick={undo}>
          <Undo2 size={17} />
        </button>
      </Tooltip>
      <Tooltip label="Redo (Ctrl+Shift+Z)">
        <button className="btn icon" disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.3 }} onClick={redo}>
          <Redo2 size={17} />
        </button>
      </Tooltip>

      <div className="divider-v" />

      <Tooltip label="Labels">
        <button className={`btn icon ${settings.showAllLabels ?? true ? 'active' : ''}`} onClick={toggleShowAllLabels}>
          <Tags size={17} />
        </button>
      </Tooltip>
      <Tooltip label="Icons">
        <button className={`btn icon ${settings.showIcons ?? true ? 'active' : ''}`} onClick={toggleShowIcons}>
          <Shapes size={17} />
        </button>
      </Tooltip>
      <Tooltip label="Fit to View (F)">
        <button className="btn icon" onClick={requestFitToView}>
          <Maximize size={17} />
        </button>
      </Tooltip>
      {mode === 'inventory' && (
        <>
          <div className="divider-v" />
          <Tooltip label="Inventory Log">
            <button className="btn icon" onClick={openLogViewer}>
              <History size={17} />
            </button>
          </Tooltip>
          <Tooltip label="Inventory Database">
            <button className="btn icon" onClick={openInventoryDb}>
              <Database size={17} />
            </button>
          </Tooltip>
          <Tooltip label="My Inventory">
            <button className="btn icon" onClick={openMyInventory}>
              <Backpack size={17} />
            </button>
          </Tooltip>
        </>
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
