import fs from 'fs-extra';
import path from 'path';

export type MemoryType = 'architecture' | 'decisions' | 'bugs' | 'learnings';

export const MEMORY_TYPES: MemoryType[] = ['architecture', 'decisions', 'bugs', 'learnings'];

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  createdAt: string;
}

const MAX_ENTRIES_PER_TYPE = 50;

/**
 * Manages .ai/memory/{architecture,decisions,bugs,learnings}.md files.
 * Each file stores a flat list of bullet-point entries with inline metadata.
 */
export class MemoryStore {
  private memoryDir: string;

  constructor(projectRoot: string = process.cwd()) {
    this.memoryDir = path.join(projectRoot, '.ai', 'memory');
  }

  async init(): Promise<void> {
    await fs.ensureDir(this.memoryDir);
  }

  async loadAll(): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    for (const type of MEMORY_TYPES) {
      entries.push(...await this.loadByType(type));
    }
    return entries;
  }

  async loadByType(type: MemoryType): Promise<MemoryEntry[]> {
    const filePath = path.join(this.memoryDir, `${type}.md`);
    if (!await fs.pathExists(filePath)) return [];
    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseFile(type, content);
  }

  /**
   * Append new string items to a memory type file.
   * Trims to MAX_ENTRIES_PER_TYPE keeping the most recent.
   */
  async append(type: MemoryType, items: string[]): Promise<void> {
    if (items.length === 0) return;

    const existing = await this.loadByType(type);
    const now = new Date().toISOString();

    const newEntries: MemoryEntry[] = items.map((content, i) => ({
      id: `${Date.now()}-${i}`,
      type,
      content: content.trim(),
      createdAt: now,
    }));

    const all = [...existing, ...newEntries].slice(-MAX_ENTRIES_PER_TYPE);
    await this.writeFile(type, all);
  }

  /**
   * Format all memory as a structured Markdown context block
   * suitable for injection into a system prompt.
   */
  async formatAsContext(): Promise<string> {
    const all = await this.loadAll();
    if (all.length === 0) return '';

    const lines: string[] = ['# Project Memory\n'];

    for (const type of MEMORY_TYPES) {
      const entries = all.filter(e => e.type === type);
      if (entries.length === 0) continue;
      lines.push(`## ${capitalize(type)}\n`);
      for (const entry of entries) {
        lines.push(`- ${entry.content}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parseFile(type: MemoryType, content: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];

    for (const line of content.split('\n')) {
      if (!line.startsWith('- ')) continue;

      // Inline metadata: <!-- id:xxx createdAt:yyy -->
      const metaMatch = line.match(/<!-- id:(\S+) createdAt:(\S+) -->$/);
      const text = metaMatch
        ? line.slice(2, line.lastIndexOf(' <!--')).trim()
        : line.slice(2).trim();

      if (text) {
        entries.push({
          id: metaMatch?.[1] ?? `${type}-${entries.length}`,
          type,
          content: text,
          createdAt: metaMatch?.[2] ?? '',
        });
      }
    }

    return entries;
  }

  private async writeFile(type: MemoryType, entries: MemoryEntry[]): Promise<void> {
    const filePath = path.join(this.memoryDir, `${type}.md`);
    const lines = [`# ${capitalize(type)}\n`];
    for (const entry of entries) {
      lines.push(`- ${entry.content} <!-- id:${entry.id} createdAt:${entry.createdAt} -->`);
    }
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
