import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bug, X, Search, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { useStore } from '../store/store';

interface SystemLogRow {
  id: number;
  ts: number;
  level: string;
  source: string;
  message: string;
  detail: string | null;
  stack: string | null;
  user_name: string | null;
}

type LevelFilter = 'all' | 'error' | 'warn';

function formatWhen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

function matchesSearch(row: SystemLogRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.message.toLowerCase().includes(q) ||
    (row.detail ?? '').toLowerCase().includes(q) ||
    (row.user_name ?? '').toLowerCase().includes(q)
  );
}

/**
 * Shows what's landed in the server's `logs` table: crashes/errors reported
 * by any connected browser (via reportError()) plus the server's own
 * exceptions — a shared, always-on record for a self-hosted deployment with
 * no external monitoring service. Fetched from the server on open rather
 * than kept in the Zustand store, since it's server-side data every user's
 * tab shares, not per-device state.
 */
export default function SystemLogViewer() {
  const open = useStore((s) => s.systemLogOpen);
  const close = useStore((s) => s.closeSystemLog);

  const [rows, setRows] = useState<SystemLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = () => {
    setLoading(true);
    setLoadError(null);
    fetch('/api/logs?limit=300')
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'Failed to load logs');
        setRows(data.logs);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const filtered = useMemo(
    () => rows.filter((r) => (levelFilter === 'all' || r.level === levelFilter) && matchesSearch(r, search)),
    [rows, levelFilter, search],
  );

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
              <Bug size={18} />
              <h3>System log</h3>
              <button className="btn icon" style={{ marginLeft: 'auto' }} onClick={load} disabled={loading} title="Refresh">
                <RefreshCw size={15} className={loading ? 'spin' : ''} />
              </button>
              <button className="btn icon" onClick={close}>
                <X size={16} />
              </button>
            </div>

            <div className="log-viewer-filters">
              <div className="log-search">
                <Search size={14} />
                <input
                  className="field"
                  placeholder="Search errors…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="log-scope-tabs">
                {(['all', 'error', 'warn'] as LevelFilter[]).map((lvl) => (
                  <button
                    key={lvl}
                    className={`log-scope-tab ${levelFilter === lvl ? 'active' : ''}`}
                    onClick={() => setLevelFilter(lvl)}
                  >
                    {lvl === 'all' ? 'All' : lvl === 'error' ? 'Errors' : 'Warnings'}
                  </button>
                ))}
              </div>
            </div>

            <div className="log-list">
              {loadError && (
                <p className="hint empty-state" style={{ padding: 16 }}>
                  Couldn't reach the server's log endpoint ({loadError}). This viewer only works when the app is
                  served through the sync server (see server/index.js), not the plain Vite dev preview alone.
                </p>
              )}
              {!loadError && !loading && filtered.length === 0 && (
                <p className="hint empty-state" style={{ padding: 16 }}>No log entries yet — good sign.</p>
              )}
              {filtered.map((row) => (
                <div key={row.id} className="log-entry">
                  <div className="log-entry-main">
                    <span className={`sys-log-badge ${row.level}`}>{row.level}</span>
                    <span className="sys-log-badge source">{row.source}</span>
                    <span className="log-entry-subject">{row.message}</span>
                    {row.user_name && <span className="log-entry-room">— {row.user_name}</span>}
                  </div>
                  {(row.detail || row.stack) && (
                    <button className="sys-log-expand" onClick={() => toggleExpanded(row.id)}>
                      {expanded.has(row.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      Details
                    </button>
                  )}
                  {expanded.has(row.id) && (
                    <pre className="sys-log-detail">{[row.detail, row.stack].filter(Boolean).join('\n\n')}</pre>
                  )}
                  <div className="log-entry-time">{formatWhen(row.ts)}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
