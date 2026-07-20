import {
  Square,
  Squircle,
  Circle,
  Type,
  Boxes,
  Grid3x3,
  Magnet,
  Ruler,
  Undo2,
  Redo2,
  Trash2,
} from 'lucide-react';
import { useStore } from '../store/store';
import { ALL_UNITS, UNIT_LABEL } from '../lib/units';
import type { ObjectKind } from '../types';

const TOOLS: { kind: ObjectKind; icon: React.ReactNode; label: string }[] = [
  { kind: 'container', icon: <Boxes size={17} />, label: 'Shelf / Cabinet' },
  { kind: 'rect', icon: <Square size={17} />, label: 'Rectangle' },
  { kind: 'roundedRect', icon: <Squircle size={17} />, label: 'Rounded' },
  { kind: 'circle', icon: <Circle size={17} />, label: 'Circle' },
  { kind: 'text', icon: <Type size={17} />, label: 'Text' },
];

export default function Toolbar() {
  const settings = useStore((s) => s.settings);
  const addObject = useStore((s) => s.addObject);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const toggleSnap = useStore((s) => s.toggleSnap);
  const toggleSpace = useStore((s) => s.toggleSpaceAwareness);
  const setUnit = useStore((s) => s.setUnit);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const resetAll = useStore((s) => s.resetAll);

  return (
    <div className="toolbar glass">
      <div className="brand">
        <span className="brand-mark">◆</span>
        <span className="brand-name">Roomcraft</span>
      </div>
      <div className="divider-v" />

      {TOOLS.map((t) => (
        <button key={t.kind} className="btn icon" title={t.label} onClick={() => addObject(t.kind)}>
          {t.icon}
        </button>
      ))}

      <div className="divider-v" />

      <button className="btn icon" title="Undo (⌘Z)" disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.3 }} onClick={undo}>
        <Undo2 size={17} />
      </button>
      <button className="btn icon" title="Redo (⌘⇧Z)" disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.3 }} onClick={redo}>
        <Redo2 size={17} />
      </button>

      <div className="divider-v" />

      <button className={`btn icon ${settings.gridVisible ? 'active' : ''}`} title="Toggle grid" onClick={toggleGrid}>
        <Grid3x3 size={17} />
      </button>
      <button className={`btn icon ${settings.snapToGrid ? 'active' : ''}`} title="Snap to grid" onClick={toggleSnap}>
        <Magnet size={17} />
      </button>
      <button
        className={`btn icon ${settings.spaceAwareness ? 'active' : ''}`}
        title="Space awareness — track fill % and warn on overflow"
        onClick={toggleSpace}
      >
        <Ruler size={17} />
      </button>

      <div className="divider-v" />

      <select className="unit-select" value={settings.units} onChange={(e) => setUnit(e.target.value as never)}>
        {ALL_UNITS.map((u) => (
          <option key={u} value={u}>
            {UNIT_LABEL[u]}
          </option>
        ))}
      </select>

      <button className="btn icon danger" title="Reset to demo room" onClick={() => confirm('Reset the room and inventory to the demo?') && resetAll()}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}
