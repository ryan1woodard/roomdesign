import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const LOG_RETENTION_MAX_ROWS = 5000;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS doc (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    detail TEXT,
    stack TEXT,
    user_name TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts DESC);
`);

/** Structured server-side log write — every path that can fail in this
 * process (WS handling, DB access, uncaught errors) funnels through here so
 * the in-app System Log viewer sees it exactly like a client-reported error. */
function writeLog({ level, source, message, detail = null, stack = null, userName = null }) {
  try {
    db.prepare(
      `INSERT INTO logs (ts, level, source, message, detail, stack, user_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(Date.now(), level, source, message, detail, stack, userName);
    // Cheap unbounded-growth guard: trim occasionally rather than on every
    // insert, since exact row count doesn't matter for a debug log.
    if (Math.random() < 0.01) {
      db.prepare(
        `DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY ts DESC LIMIT ?)`,
      ).run(LOG_RETENTION_MAX_ROWS);
    }
  } catch (err) {
    // The log write itself failing must never crash the process or recurse.
    console.error('Failed to write log entry:', err);
  }
  console.log(`[${source}:${level}] ${message}`);
}

function loadDoc() {
  const row = db.prepare(`SELECT data FROM doc WHERE id = 'main'`).get();
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function saveDoc(doc) {
  const data = JSON.stringify(doc);
  db.prepare(
    `INSERT INTO doc (id, data, updated_at) VALUES ('main', ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(data, Date.now());
}

let currentDoc = loadDoc();

const app = express();
app.use(express.json({ limit: '15mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/log', (req, res) => {
  const { level, message, detail, stack, userName } = req.body ?? {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'message is required' });
  }
  writeLog({
    level: level === 'warn' ? 'warn' : 'error',
    source: 'client',
    message: message.slice(0, 2000),
    detail: typeof detail === 'string' ? detail.slice(0, 4000) : null,
    stack: typeof stack === 'string' ? stack.slice(0, 8000) : null,
    userName: typeof userName === 'string' ? userName.slice(0, 200) : null,
  });
  res.json({ ok: true });
});

app.get('/api/logs', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const rows = db.prepare(`SELECT * FROM logs ORDER BY ts DESC LIMIT ?`).all(limit);
  res.json({ ok: true, logs: rows });
});

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res.status(200).send('Server is running, but no production build was found. Run `npm run build` first.'),
  );
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

/**
 * Multi-user sync model: whole-document, last-write-wins. Every connected
 * browser tab periodically pushes its full shared-doc slice (rooms, tags,
 * checkouts, activity log — see src/lib/sync.ts for exactly what's
 * included); the server persists whatever arrives and rebroadcasts it to
 * every other tab. There's no per-field merge or conflict resolution: if two
 * people edit at almost the same instant, whichever update reaches the
 * server last simply wins. That's a deliberate, disclosed trade-off for a
 * small internal tool, not an oversight — true operational-transform/CRDT
 * merging is a much larger undertaking than this app needs today.
 */
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', doc: currentDoc }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg?.type === 'update' && msg.doc && typeof msg.doc === 'object') {
      currentDoc = msg.doc;
      try {
        saveDoc(currentDoc);
      } catch (err) {
        writeLog({ level: 'error', source: 'server', message: 'Failed to persist synced document', detail: String(err) });
      }
      const payload = JSON.stringify({ type: 'update', doc: currentDoc });
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) client.send(payload);
      }
    }
  });

  ws.on('error', (err) => {
    writeLog({ level: 'error', source: 'server', message: 'WebSocket connection error', detail: String(err) });
  });
});

process.on('uncaughtException', (err) => {
  writeLog({ level: 'error', source: 'server', message: 'Uncaught exception', detail: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  writeLog({
    level: 'error',
    source: 'server',
    message: 'Unhandled promise rejection',
    detail: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

httpServer.listen(PORT, () => {
  console.log(`SRS Lab Designer server listening on http://localhost:${PORT}`);
});
