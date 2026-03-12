import path from 'path';
import fs from 'fs-extra';
import { MemoryStore } from '../storage/memory-store.js';
import { VectorRetriever } from './vector-retriever.js';

export interface LoadedContext {
  /** Full system prompt to inject into Claude via --append-system-prompt */
  systemPrompt: string;
  /** Total memory entries loaded */
  memoryCount: number;
  /** Number of goal-relevant snippets retrieved via vector search */
  relevantSnippets: number;
}

export interface Config {
  version?: number;
  project?: { name?: string };
  /** Claude model to use for memory compilation */
  model?: string;
  /** Override path to the Claude binary */
  claudeBin?: string;
  maxMemoryEntriesPerType?: number;
}

/**
 * Loads project memory and assembles a system prompt for injection
 * into the upcoming Claude session.
 *
 * Flow:
 *   1. Load all memory entries from .ai/memory/
 *   2. If a session goal is provided, retrieve the most relevant
 *      entries via TF-IDF vector search
 *   3. Build a structured system prompt combining base memory + relevant context
 */
export class ContextLoader {
  private memoryStore: MemoryStore;
  private retriever: VectorRetriever;
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.memoryStore = new MemoryStore(projectRoot);
    this.retriever = new VectorRetriever(projectRoot);
  }

  async load(sessionGoal?: string): Promise<LoadedContext> {
    await this.memoryStore.init();

    const allMemory = await this.memoryStore.loadAll();
    const baseContext = await this.memoryStore.formatAsContext();

    let relevantSnippets = 0;
    let relevantSection = '';

    if (sessionGoal && allMemory.length > 0) {
      try {
        const results = await this.retriever.search(sessionGoal, 5);
        if (results.length > 0) {
          relevantSnippets = results.length;
          relevantSection =
            '\n## Most Relevant to Current Goal\n\n' +
            results.map(r => `[${r.type}] ${r.content}`).join('\n');
        }
      } catch {
        // Vector search is best-effort; fall back to full memory
      }
    }

    const config = await this.loadConfig();
    const systemPrompt = this.buildSystemPrompt(
      baseContext + relevantSection,
      config,
      sessionGoal
    );

    return { systemPrompt, memoryCount: allMemory.length, relevantSnippets };
  }

  async loadConfig(): Promise<Config> {
    const configPath = path.join(this.projectRoot, '.ai', 'config.json');
    if (!await fs.pathExists(configPath)) return {};
    try {
      return await fs.readJson(configPath);
    } catch {
      return {};
    }
  }

  private buildSystemPrompt(
    memoryContext: string,
    config: Config,
    goal?: string
  ): string {
    const project = config?.project?.name ?? path.basename(this.projectRoot);
    const parts: string[] = [];

    if (!memoryContext.trim()) {
      parts.push(
        `You are working on the "${project}" project.`,
        '',
        'No prior memory exists yet for this project. As you work, valuable context will be',
        'automatically extracted and saved for future sessions. Focus on:',
        '- Documenting architectural decisions and the reasoning behind them',
        '- Noting any bugs discovered and how they were resolved',
        '- Capturing key learnings, gotchas, and important context',
      );
    } else {
      parts.push(
        `You are working on the "${project}" project.`,
        '',
        'The following is your persistent project memory, automatically maintained across sessions.',
        'Use it to stay consistent, avoid past mistakes, and build on prior work.',
        '',
        memoryContext,
      );
    }

    if (goal) {
      parts.push('', `## Current Session Goal\n\n${goal}`);
    }

    return parts.join('\n');
  }
}
