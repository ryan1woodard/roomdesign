import { useState } from 'react';
import { Save } from 'lucide-react';
import { useStore, useSaveStore } from '../store/store';

const STATUS_META: Record<string, { dot: string; label: string }> = {
  saved: { dot: '🟢', label: 'Saved' },
  saving: { dot: '🟡', label: 'Saving…' },
  unsaved: { dot: '🔴', label: 'Unsaved changes' },
  error: { dot: '⚠️', label: 'Save failed' },
};

function timeAgo(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleString();
}

export default function SaveIndicator() {
  const saveStatus = useSaveStore((s) => s.saveStatus);
  const saveError = useSaveStore((s) => s.saveError);
  const lastSavedAt = useSaveStore((s) => s.lastSavedAt);
  const saveNow = useStore((s) => s.saveNow);
  const [hover, setHover] = useState(false);

  const meta = STATUS_META[saveStatus] ?? STATUS_META.saved;

  return (
    <div className="save-section" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button className="save-btn" onClick={() => saveNow()} title="Save now">
        <Save size={14} />
        Save
      </button>
      <span className={`save-status save-status--${saveStatus}`}>
        <span className="save-dot">{meta.dot}</span>
        {meta.label}
      </span>

      {hover && (
        <div className="save-tooltip glass">
          <div className="save-tooltip-row">
            <strong>Last saved</strong>
            <span>{timeAgo(lastSavedAt)}</span>
          </div>
          <div className="save-tooltip-row">
            <strong>Destination</strong>
            <span>Browser storage (IndexedDB)</span>
          </div>
          <div className="save-tooltip-row">
            <strong>Auto-save</strong>
            <span>Enabled — after every change</span>
          </div>
          {saveStatus === 'error' && saveError && (
            <div className="save-tooltip-row save-tooltip-error">
              <strong>Error</strong>
              <span>{saveError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
