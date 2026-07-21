import { Hammer, Package } from 'lucide-react';
import { useStore } from '../store/store';
import type { AppMode } from '../types';

const MODES: { mode: AppMode; icon: React.ReactNode; label: string }[] = [
  { mode: 'design', icon: <Hammer size={14} />, label: 'Design' },
  { mode: 'inventory', icon: <Package size={14} />, label: 'Inventory' },
];

export default function ModeSwitch() {
  const mode = useStore((s) => s.settings.mode);
  const setMode = useStore((s) => s.setMode);

  return (
    <div className="mode-switch-panel glass">
      {MODES.map((m) => (
        <button
          key={m.mode}
          className={`mode-switch-btn ${mode === m.mode ? 'active' : ''}`}
          onClick={() => setMode(m.mode)}
        >
          {m.icon}
          {m.label}
        </button>
      ))}
    </div>
  );
}
