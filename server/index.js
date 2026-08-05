import express from 'express';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase, createStore, createLogStore } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DIST_DIR = path.join(__dirname, '..', 'dist');

const db = openDatabase(DATA_DIR);
const store = createStore(db);
const logs = createLogStore(db);

const app = express();
app.disable('x-powered-by');
app.use(compression());
// Item photos are stored inline as data URLs, so a batch that creates
// several items can be genuinely large. This ceiling is high enough not to
// reject real work while still bounding a runaway request.
app.use(express.json({ limit: '64mb' }));

// ---------------------------------------------------------------------------
// Sync API
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rev: store.currentRev(), empty: store.isEmpty() });
});

/**
 * Delta poll. `since` is the revision the client already has; the response
 * carries only what changed after it, so a steady-state poll costs an index
 * seek and an empty array rather than the whole project.
 */
app.get('/api/state', (req, res) => {
  const since = Number(req.query.since) || 0;
  const { rev, ops } = store.changesSince(since);
  res.json({ ok: true, rev, ops, empty: store.isEmpty() });
});

/** Applies one action's worth of entity writes atomically. */
app.post('/api/mutate', (req, res) => {
  const { ops, authorId } = req.body ?? {};
  if (!Array.isArray(ops)) {
    return res.status(400).json({ ok: false, error: 'ops must be an array' });
  }
  const rev = store.applyOps(ops, authorId);
  res.json({ ok: true, rev });
});

/**
 * First-run seeding. Guarded so that when several browsers reach a brand-new
 * server at once, exactly one of them plants the starter project instead of
 * each laying down a duplicate copy.
 */
app.post('/api/seed', (req, res) => {
  const { ops, authorId } = req.body ?? {};
  if (!Array.isArray(ops)) return res.status(400).json({ ok: false, error: 'ops must be an array' });
  if (!store.isEmpty()) return res.json({ ok: true, seeded: false, rev: store.currentRev() });
  const rev = store.applyOps(ops, authorId);
  logs.write({ level: 'info', source: 'server', message: 'Seeded initial project' });
  res.json({ ok: true, seeded: true, rev });
});

// ---------------------------------------------------------------------------
// Error log (client crash reports + this process's own failures)
// ---------------------------------------------------------------------------

app.post('/api/log', (req, res) => {
  const { level, message, detail, stack, userName } = req.body ?? {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'message is required' });
  }
  logs.write({
    level: level === 'warn' ? 'warn' : 'error',
    source: 'client',
    message,
    detail: typeof detail === 'string' ? detail.slice(0, 4000) : null,
    stack: typeof stack === 'string' ? stack.slice(0, 8000) : null,
    userName: typeof userName === 'string' ? userName.slice(0, 200) : null,
  });
  res.json({ ok: true });
});

app.get('/api/logs', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  res.json({ ok: true, logs: logs.recent(limit) });
});

// ---------------------------------------------------------------------------
// Static app
// ---------------------------------------------------------------------------

if (fs.existsSync(DIST_DIR)) {
  app.use(
    express.static(DIST_DIR, {
      // Vite fingerprints asset filenames, so they can be cached hard; the
      // HTML entry point must not be, or clients would keep booting an old
      // bundle after a deploy.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  // Written as plain middleware rather than a `'*'` route: Express 5 dropped
  // support for bare wildcard patterns, and this form works on both 4 and 5.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res
      .status(503)
      .send('No production build found. Run `npm run build` first, then restart the server.'),
  );
}

app.use((err, _req, res, _next) => {
  logs.write({ level: 'error', source: 'server', message: 'Request failed', detail: err?.message, stack: err?.stack });
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// Housekeeping, run daily rather than on every write so it never sits in a
// request's critical path.
const pruneTimer = setInterval(
  () => {
    try {
      const removed = store.pruneTombstones();
      if (removed > 0) console.log(`pruned ${removed} old tombstones`);
    } catch (err) {
      logs.write({ level: 'warn', source: 'server', message: 'Tombstone prune failed', detail: String(err) });
    }
  },
  24 * 60 * 60 * 1000,
);
pruneTimer.unref();

const server = app.listen(PORT, HOST, () => {
  console.log(`SRS Lab Designer server listening on http://${HOST}:${PORT}`);
  console.log(`  data: ${path.join(DATA_DIR, 'app.db')}`);
  if (!fs.existsSync(DIST_DIR)) console.warn('  WARNING: dist/ not found — run `npm run build`');
});

process.on('uncaughtException', (err) => {
  logs.write({ level: 'error', source: 'server', message: 'Uncaught exception', detail: err.message, stack: err.stack });
  console.error(err);
});
process.on('unhandledRejection', (reason) => {
  logs.write({
    level: 'error',
    source: 'server',
    message: 'Unhandled promise rejection',
    detail: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : null,
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down…`);
    server.close(() => {
      try {
        db.close();
      } catch {
        // Already closed, or mid-transaction — nothing useful to do at exit.
      }
      process.exit(0);
    });
    // Don't let a hung connection keep the process alive indefinitely.
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
