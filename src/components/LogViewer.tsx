import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { History, X, Search } from 'lucide-react';
import { useStore } from '../store/store';
import type { LogEntry, LogScope } from '../types';

const SCOPE_LABEL: Record<LogScope | 'all', string> = {
  all: 'All',
  inventory: 'Inventory',
  room: 'Rooms',
  object: 'Furniture',
  wall: 'Walls',
  layer: 'Layers',
};

const ACTION_LABEL: Record<LogEntry['action'], string> = {
  created: 'created',
  deleted: 'deleted',
  quantity_changed: 'changed quantity of',
  moved: 'moved',
  renamed: 'renamed',
  notes_edited: 'edited notes on',
  edited: 'edited',
};

function formatWhen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

function matchesSearch(entry: LogEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    entry.subject.toLowerCase().includes(q) ||
    entry.userName.toLowerCase().includes(q) ||
    (entry.roomName ?? '').toLowerCase().includes(q) ||
    (entry.detail ?? '').toLowerCase().includes(q) ||
    (entry.previousValue ?? '').toLowerCase().includes(q) ||
    (entry.newValue ?? '').toLowerCase().includes(q)
  );
}

export default function LogViewer() {
  const open = useStore((s) => s.logViewerOpen);
  const close = useStore((s) => s.closeLogViewer);
  const activityLog = useStore((s) => s.activityLog);
  const search = useStore((s) => s.logSearch);
  const setSearch = useStore((s) => s.setLogSearch);
  const scopeFilter = useStore((s) => s.logScopeFilter);
  const setScopeFilter = useStore((s) => s.setLogScopeFilter);

  const filtered = useMemo(
    () =>
      activityLog.filter(
        (e) => (scopeFilter === 'all' || e.scope === scopeFilter) && matchesSearch(e, search),
      ),
    [activityLog, scopeFilter, search],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="overlay-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={close}
        >
          <motion.div
            className="log-viewer"
            initial={{ scale: 0.96, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, y: 12, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="log-viewer-head">
              <History size={18} />
              <h3>Inventory log</h3>
              <button className="btn icon" style={{ marginLeft: 'auto' }} onClick={close}>
                <X size={16} />
              </button>
            </div>

            <div className="log-viewer-filters">
              <div className="log-search">
                <Search size={14} />
                <input
                  className="field"
                  placeholder="Search log…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="log-scope-tabs">
                {(Object.keys(SCOPE_LABEL) as (LogScope | 'all')[]).map((scope) => (
                  <button
                    key={scope}
                    className={`log-scope-tab ${scopeFilter === scope ? 'active' : ''}`}
                    onClick={() => setScopeFilter(scope)}
                  >
                    {SCOPE_LABEL[scope]}
                  </button>
                ))}
              </div>
            </div>

            <div className="log-list">
              {filtered.length === 0 && <p className="hint" style={{ padding: 16 }}>No matching activity yet.</p>}
              {filtered.map((entry) => (
                <div key={entry.id} className="log-entry">
                  <div className="log-entry-main">
                    <span className="log-entry-user">{entry.userName}</span>
                    <span className="log-entry-action">{ACTION_LABEL[entry.action]}</span>
                    <span className="log-entry-subject">{entry.subject}</span>
                    {entry.roomName && <span className="log-entry-room">in {entry.roomName}</span>}
                  </div>
                  {(entry.previousValue !== undefined || entry.newValue !== undefined) && (
                    <div className="log-entry-diff">
                      {entry.previousValue !== undefined && <span className="log-entry-prev">{entry.previousValue}</span>}
                      {entry.previousValue !== undefined && entry.newValue !== undefined && <span>→</span>}
                      {entry.newValue !== undefined && <span className="log-entry-new">{entry.newValue}</span>}
                    </div>
                  )}
                  {entry.detail && <div className="log-entry-detail">{entry.detail}</div>}
                  <div className="log-entry-time">{formatWhen(entry.timestamp)}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
