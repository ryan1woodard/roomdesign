import { AnimatePresence, motion } from 'framer-motion';
import { Save } from 'lucide-react';
import { useStore, useSaveStore } from '../store/store';

const STATUS_LABEL: Record<string, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved',
  error: 'Save failed',
};

export default function SaveIndicator() {
  const saveStatus = useSaveStore((s) => s.saveStatus);
  const saveNow = useStore((s) => s.saveNow);

  const label = STATUS_LABEL[saveStatus] ?? STATUS_LABEL.saved;

  return (
    <div className="save-section">
      <button className="save-btn" onClick={() => saveNow()} title="Save now">
        <Save size={13} />
        Save
      </button>
      {/* Fixed-width slot sized for the longest state ("Save failed"), so the
          header never resizes as the label changes — only the label content
          crossfades via opacity. */}
      <span className={`save-status save-status--${saveStatus}`}>
        <span className="status-dot" />
        <span className="save-status-text">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={saveStatus}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="save-status-label"
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </span>
      </span>
    </div>
  );
}
