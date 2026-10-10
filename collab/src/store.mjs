import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as Y from 'yjs';

export const MAX_BYTES = 8 * 1024 * 1024;
export function stateHash(bytes) {
  // UndoManager retains deleted structs on clients; normalize those without losing
  // the insertion clocks or delete set that distinguish genuinely pending edits.
  const normalized = new Y.Doc();
  try {
    Y.applyUpdate(normalized, bytes);
    return createHash('sha256').update(Y.encodeStateAsUpdate(normalized)).digest('hex');
  } finally { normalized.destroy(); }
}

export class DocumentStore {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, state BLOB NOT NULL,
        hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY, document_id TEXT NOT NULL, state BLOB NOT NULL,
        version INTEGER NOT NULL, created_at TEXT NOT NULL
      );
    `);
    // Existing states are intact; only refresh the confirmation encoding.
    const refreshHash = this.db.prepare('UPDATE documents SET hash = ? WHERE id = ?');
    for (const row of this.db.prepare('SELECT id, state, hash FROM documents').iterate()) {
      const hash = stateHash(row.state);
      if (hash !== row.hash) refreshHash.run(hash, row.id);
    }
  }
  get(id) { return this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id); }
  create(id, title) {
    const doc = new Y.Doc();
    const state = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    this.db.prepare('INSERT OR IGNORE INTO documents VALUES (?, ?, ?, ?, 0, ?)')
      .run(id, title, state, stateHash(state), new Date().toISOString());
    return this.get(id);
  }
  save(id, doc) {
    const state = Y.encodeStateAsUpdate(doc);
    if (state.length > MAX_BYTES) throw new Error('文档超过 8 MB，请删除部分图片后重试');
    const hash = stateHash(state);
    const current = this.get(id);
    if (!current) throw new Error('Document not found');
    if (hash !== current.hash) {
      this.db.prepare('UPDATE documents SET state = ?, hash = ?, version = version + 1, updated_at = ? WHERE id = ?')
        .run(state, hash, new Date().toISOString(), id);
    }
    const row = this.get(id);
    const latest = this.db.prepare('SELECT created_at FROM snapshots WHERE document_id = ? ORDER BY id DESC LIMIT 1').get(id);
    if (!latest || Date.now() - Date.parse(latest.created_at) > 300_000) this.snapshot(id);
    return { type: 'saved', hash: row.hash, version: row.version, updatedAt: row.updated_at };
  }
  snapshot(id) {
    const row = this.get(id);
    if (!row) throw new Error('Document not found');
    return this.db.transaction(() => {
      const result = this.db.prepare('INSERT INTO snapshots(document_id, state, version, created_at) VALUES (?, ?, ?, ?)')
        .run(id, row.state, row.version, new Date().toISOString());
      this.db.prepare('DELETE FROM snapshots WHERE document_id = ? AND id NOT IN (SELECT id FROM snapshots WHERE document_id = ? ORDER BY id DESC LIMIT 20)').run(id, id);
      return Number(result.lastInsertRowid);
    })();
  }
  readSnapshot(id, snapshotId) {
    return this.db.prepare('SELECT s.id, s.version, s.created_at, s.state FROM snapshots s WHERE s.document_id = ? AND s.id = ?').get(id, snapshotId);
  }
  snapshots(id) {
    return this.db.prepare('SELECT id, version, created_at FROM snapshots WHERE document_id = ? ORDER BY id DESC').all(id);
  }
  close() { this.db.close(); }
}
