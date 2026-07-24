import { Hammer, Package } from 'lucide-react';
import { useStore } from '../store/store';
import type { AppMode } from '../types';
import Tooltip from './Tooltip';

const MODES: { mode: AppMode; icon: React.ReactNode; label: string; shortcut: string }[] = [
  { mode: 'design', icon: <Hammer size={14} />, label: 'Design', shortcut: 'D' },
  { mode: 'inventory', icon: <Package size={14} />, label: 'Inventory', shortcut: 'I' },
];

export default function ModeSwitch() {
  const mode = useStore((s) => s.settings.mode);
  const setMode = useStore((s) => s.setMode);

  return (
    <div className="mode-switch-panel glass">
      {MODES.map((m) => (
        <Tooltip key={m.mode} label={`${m.label} Mode (${m.shortcut})`}>
          <button
            className={`mode-switch-btn ${mode === m.mode ? 'active' : ''}`}
            onClick={() => setMode(m.mode)}
          >
            {m.icon}
            {m.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
