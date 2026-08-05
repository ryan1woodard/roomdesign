import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Storage for the shared project.
 *
 * Every row is one independently-addressable entity (a single object, item,
 * wall, tag…) carrying a global revision number stamped at its last write.
 * That single `rev` column is what makes cheap delta polling possible:
 * a client says "give me everything above rev N" and gets back exactly the
 * rows that changed since it last looked, no matter who changed them.
 *
 * Deletes are kept as tombstones (`deleted = 1`) rather than removing the
 * row, because a client that was offline during the delete still has to
 * learn the entity is gone — a missing row is indistinguishable from one it
 * simply hasn't seen yet.
 */
export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'app.db'));

  // WAL lets readers (polling clients) proceed while a write is in flight,
  // which matters because every client polls on an interval.
  db.exec(`PRAGMA journal_mode = WAL`);
  db.exec(`PRAGMA synchronous = NORMAL`);
  db.exec(`PRAGMA foreign_keys = ON`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      kind       TEXT    NOT NULL,
      id         TEXT    NOT NULL,
      room_id    TEXT,
      data       TEXT,
      deleted    INTEGER NOT NULL DEFAULT 0,
      rev        INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT,
      PRIMARY KEY (kind, id)
    );
    CREATE INDEX IF NOT EXISTS idx_entities_rev ON entities (rev);

    CREATE TABLE IF NOT EXISTS counters (
      name  TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO counters (name, value) VALUES ('rev', 0);

    CREATE TABLE IF NOT EXISTS logs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ts        INTEGER NOT NULL,
      level     TEXT    NOT NULL,
      source    TEXT    NOT NULL,
      message   TEXT    NOT NULL,
      detail    TEXT,
      stack     TEXT,
      user_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts DESC);
  `);

  return db;
}

export function createStore(db) {
  const selectRev = db.prepare(`SELECT value FROM counters WHERE name = 'rev'`);
  const bumpRev = db.prepare(`UPDATE counters SET value = value + 1 WHERE name = 'rev'`);
  const upsert = db.prepare(`
    INSERT INTO entities (kind, id, room_id, data, deleted, rev, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, id) DO UPDATE SET
      room_id    = excluded.room_id,
      data       = excluded.data,
      deleted    = excluded.deleted,
      rev        = excluded.rev,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `);
  const selectSince = db.prepare(`SELECT kind, id, room_id, data, deleted FROM entities WHERE rev > ? ORDER BY rev ASC`);
  const selectAllLive = db.prepare(`SELECT kind, id, room_id, data, deleted FROM entities WHERE deleted = 0`);
  const countAll = db.prepare(`SELECT COUNT(*) AS n FROM entities`);

  const currentRev = () => selectRev.get().value;

  function rowToOp(row) {
    return {
      kind: row.kind,
      id: row.id,
      roomId: row.room_id ?? null,
      ...(row.deleted ? { deleted: true } : { data: JSON.parse(row.data) }),
    };
  }

  return {
    currentRev,

    isEmpty: () => countAll.get().n === 0,

    /**
     * Applies a batch of entity writes atomically and returns the revision
     * they were all stamped with. One revision per batch (not per entity)
     * keeps a multi-entity action — splitting a wall, pasting a selection —
     * indivisible from a polling client's point of view: it can never
     * observe half of one.
     */
    applyOps(ops, authorId) {
      if (!Array.isArray(ops) || ops.length === 0) return currentRev();
      const now = Date.now();
      const write = db.prepare('BEGIN IMMEDIATE');
      write.run();
      try {
        bumpRev.run();
        const rev = currentRev();
        for (const op of ops) {
          if (!op || typeof op.kind !== 'string' || typeof op.id !== 'string') continue;
          upsert.run(
            op.kind,
            op.id,
            op.roomId ?? null,
            op.deleted ? null : JSON.stringify(op.data ?? null),
            op.deleted ? 1 : 0,
            rev,
            now,
            authorId ?? null,
          );
        }
        db.prepare('COMMIT').run();
        return rev;
      } catch (err) {
        db.prepare('ROLLBACK').run();
        throw err;
      }
    },

    /**
     * Drops tombstones that every client has certainly seen.
     *
     * Safe because a client's revision watermark only lives in memory: any
     * browser that has been away long enough to miss these has since
     * reloaded and re-fetched from scratch (`since=0`), which ignores
     * tombstones entirely. Bounds the table so a long-running deployment
     * doesn't accumulate delete markers forever — the activity log in
     * particular self-prunes to its 500-entry cap and would otherwise leave
     * one behind for every entry ever written.
     */
    pruneTombstones(olderThanMs = 30 * 24 * 60 * 60 * 1000) {
      const cutoff = Date.now() - olderThanMs;
      const info = db.prepare(`DELETE FROM entities WHERE deleted = 1 AND updated_at < ?`).run(cutoff);
      return info.changes ?? 0;
    },

    /** Everything changed since `since`, plus the revision that reflects. */
    changesSince(since) {
      const rev = currentRev();
      if (since >= rev) return { rev, ops: [] };
      // `since = 0` means a cold start, where tombstones are noise: the
      // client has nothing to forget yet.
      const rows = since <= 0 ? selectAllLive.all() : selectSince.all(since);
      return { rev, ops: rows.map(rowToOp) };
    },
  };
}

export function createLogStore(db, maxRows = 5000) {
  const insert = db.prepare(
    `INSERT INTO logs (ts, level, source, message, detail, stack, user_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const trim = db.prepare(`DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY ts DESC LIMIT ?)`);
  const recent = db.prepare(`SELECT * FROM logs ORDER BY ts DESC LIMIT ?`);

  return {
    write({ level = 'error', source = 'server', message, detail = null, stack = null, userName = null }) {
      try {
        insert.run(Date.now(), level, source, String(message).slice(0, 2000), detail, stack, userName);
        if (Math.random() < 0.02) trim.run(maxRows);
      } catch (err) {
        // A failure to record an error must never itself take the server
        // down, and must never recurse back into this function.
        console.error('log write failed:', err);
      }
    },
    recent: (limit) => recent.all(limit),
  };
}
