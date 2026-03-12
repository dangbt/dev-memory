import natural from 'natural';
const { TfIdf } = natural;
import { EmbeddingStore } from '../storage/embedding-store.js';
import { MemoryStore, MemoryType } from '../storage/memory-store.js';

export interface SearchResult {
  score: number;
  content: string;
  type: MemoryType;
}

/**
 * TF-IDF based semantic retriever for project memory.
 *
 * Uses the `natural` library's TfIdf implementation to score
 * memory entries against a query. The index is rebuilt in-memory
 * from SQLite on each search (fast enough for <500 entries).
 *
 * Designed to be swappable with a neural embedding backend
 * (e.g. @xenova/transformers) in the future by adding a
 * `useNeuralEmbeddings: true` flag in .ai/config.json.
 */
export class VectorRetriever {
  private embeddingStore: EmbeddingStore;
  private memoryStore: MemoryStore;

  constructor(projectRoot: string = process.cwd()) {
    this.embeddingStore = new EmbeddingStore(projectRoot);
    this.memoryStore = new MemoryStore(projectRoot);
  }

  /**
   * Re-index all memory entries from disk into the embedding store.
   * Call after any memory update.
   */
  async indexAll(): Promise<void> {
    const entries = await this.memoryStore.loadAll();

    this.embeddingStore.deleteAll();

    for (const entry of entries) {
      this.embeddingStore.upsert({
        chunkId: `${entry.type}-${entry.id}`,
        memoryType: entry.type,
        content: entry.content,
        tfidfTerms: '[]',
        createdAt: Date.now(),
      });
    }
  }

  /**
   * Search memory for entries relevant to `query`.
   * Returns the top-K results sorted by descending TF-IDF score.
   */
  async search(query: string, topK: number = 5): Promise<SearchResult[]> {
    const records = this.embeddingStore.getAll();
    if (records.length === 0) return [];

    const tfidf = new TfIdf();
    for (const record of records) {
      tfidf.addDocument(record.content);
    }

    const scores: number[] = new Array(records.length).fill(0);
    tfidf.tfidfs(query, (i: number, measure: number) => {
      scores[i] = measure;
    });

    return records
      .map((record, i) => ({
        score: scores[i] ?? 0,
        content: record.content,
        type: record.memoryType as MemoryType,
      }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  close(): void {
    this.embeddingStore.close();
  }
}
