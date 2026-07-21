import { Save } from 'lucide-react';
import { useStore, useSaveStore } from '../store/store';

const STATUS_META: Record<string, { dot: string; label: string }> = {
  saved: { dot: '🟢', label: 'Saved' },
  saving: { dot: '🟡', label: 'Saving…' },
  unsaved: { dot: '🔴', label: 'Unsaved changes' },
  error: { dot: '⚠️', label: 'Save failed' },
};

export default function SaveIndicator() {
  const saveStatus = useSaveStore((s) => s.saveStatus);
  const saveNow = useStore((s) => s.saveNow);

  const meta = STATUS_META[saveStatus] ?? STATUS_META.saved;

  return (
    <div className="save-section">
      <button className="save-btn" onClick={() => saveNow()} title="Save now">
        <Save size={14} />
        Save
      </button>
      <span className={`save-status save-status--${saveStatus}`}>
        <span className="save-dot">{meta.dot}</span>
        {meta.label}
      </span>
    </div>
  );
}
