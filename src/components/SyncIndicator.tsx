import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { onSyncStatus, type SyncStatus } from '../lib/sync';

const STATUS_LABEL: Record<SyncStatus, string> = {
  online: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline',
};

/** Mirrors SaveIndicator's status-pill pattern, but reflects the multi-user
 * WebSocket connection instead of the local IndexedDB write — this is what
 * tells a user whether their edits are actually reaching everyone else's
 * screen right now, or just sitting locally until the server's back. */
export default function SyncIndicator() {
  const [status, setStatus] = useState<SyncStatus>('connecting');

  useEffect(() => onSyncStatus(setStatus), []);

  return (
    <span className={`save-status sync-status--${status}`} title="Multi-user sync connection">
      <span className="status-dot" />
      <span className="save-status-text">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={status}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="save-status-label"
          >
            {STATUS_LABEL[status]}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
