import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs-extra';

export interface EmbeddingRecord {
  chunkId: string;
  memoryType: string;
  content: string;
  /** Reserved for future neural embedding support (stored as JSON). */
  tfidfTerms: string;
  createdAt: number;
}

/**
 * SQLite-backed store for memory chunk metadata.
 * Lives at .ai/embeddings/store.db in the project directory.
 *
 * Currently stores content + metadata for TF-IDF search.
 * Schema is designed to also accommodate vector embeddings
 * (blob column) when neural search is added in the future.
 */
export class EmbeddingStore {
  private db: Database.Database;

  constructor(projectRoot: string = process.cwd()) {
    const dbDir = path.join(projectRoot, '.ai', 'embeddings');
    fs.ensureDirSync(dbDir);

    try {
      this.db = new Database(path.join(dbDir, 'store.db'));
    } catch (err) {
      throw new Error(
        `Failed to open embeddings database. If on macOS, ensure Xcode Command Line Tools are installed: xcode-select --install\n${err}`
      );
    }

    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        chunk_id    TEXT    PRIMARY KEY,
        memory_type TEXT    NOT NULL,
        content     TEXT    NOT NULL,
        tfidf_terms TEXT    NOT NULL DEFAULT '[]',
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_type ON embeddings(memory_type);
    `);
  }

  upsert(record: EmbeddingRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (chunk_id, memory_type, content, tfidf_terms, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(record.chunkId, record.memoryType, record.content, record.tfidfTerms, record.createdAt);
  }

  getAll(): EmbeddingRecord[] {
    return (this.db.prepare('SELECT * FROM embeddings').all() as any[]).map(row => ({
      chunkId: row.chunk_id,
      memoryType: row.memory_type,
      content: row.content,
      tfidfTerms: row.tfidf_terms,
      createdAt: row.created_at,
    }));
  }

  deleteByType(type: string): void {
    this.db.prepare('DELETE FROM embeddings WHERE memory_type = ?').run(type);
  }

  deleteAll(): void {
    this.db.prepare('DELETE FROM embeddings').run();
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) as n FROM embeddings').get() as { n: number }).n;
  }

  close(): void {
    this.db.close();
  }
}
