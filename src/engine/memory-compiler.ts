import { execa } from 'execa';
import { MemoryStore, MemoryType, MEMORY_TYPES } from '../storage/memory-store.js';
import { VectorRetriever } from './vector-retriever.js';
import { SessionMessage } from './session-recorder.js';
import { SUMMARIZE_PROMPT, EXTRACT_KNOWLEDGE_PROMPT } from '../prompts/index.js';

export interface ExtractedKnowledge {
  architecture: string[];
  decisions: string[];
  bugs: string[];
  learnings: string[];
}

/**
 * Two-phase LLM pipeline to compile session history into durable project memory.
 *
 * Phase 1 — Summarize:
 *   Raw session transcript → concise 200-300 word summary
 *
 * Phase 2 — Extract:
 *   Summary + existing memory → structured JSON with categorised knowledge entries
 *   Categories: architecture | decisions | bugs | learnings
 *
 * Uses the Claude CLI binary (claude -p) — no API key required, only CLI login.
 */
export class MemoryCompiler {
  private memoryStore: MemoryStore;
  private retriever: VectorRetriever;
  private model: string;

  constructor(projectRoot: string = process.cwd(), model = 'claude-sonnet-4-6') {
    this.memoryStore = new MemoryStore(projectRoot);
    this.retriever = new VectorRetriever(projectRoot);
    this.model = model;
  }

  /**
   * Run the full two-phase compilation pipeline on session messages.
   * Returns structured knowledge ready to be saved.
   */
  async compile(messages: SessionMessage[]): Promise<ExtractedKnowledge> {
    const empty: ExtractedKnowledge = {
      architecture: [],
      decisions: [],
      bugs: [],
      learnings: [],
    };

    if (messages.length < 2) return empty;

    const transcript = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const summary = await this.summarize(transcript);
    const existingMemory = await this.memoryStore.formatAsContext();
    const knowledge = await this.extractKnowledge(summary, existingMemory);

    return knowledge;
  }

  /**
   * Persist extracted knowledge to .ai/memory/ and update the vector index.
   * Returns the total number of new entries saved.
   */
  async saveKnowledge(knowledge: ExtractedKnowledge): Promise<number> {
    let totalSaved = 0;

    for (const type of MEMORY_TYPES) {
      const items = knowledge[type as MemoryType];
      if (items.length > 0) {
        await this.memoryStore.append(type as MemoryType, items);
        totalSaved += items.length;
      }
    }

    // Rebuild TF-IDF index after saving (best-effort)
    try {
      await this.retriever.indexAll();
    } catch {
      // Non-critical — index will be rebuilt on next session start
    }

    return totalSaved;
  }

  // ---------------------------------------------------------------------------
  // Private: LLM pipeline phases
  // ---------------------------------------------------------------------------

  private async runClaude(prompt: string): Promise<string> {
    const claudeBin = await this.resolveClaudeBin();
    const env = { ...process.env };
    delete env['CLAUDECODE'];
    delete env['CLAUDE_CODE_ENTRYPOINT'];
    const { stdout } = await execa(claudeBin, [
      '--print',
      '--model', this.model,
      '--output-format', 'text',
      prompt,
    ], { env, extendEnv: false });
    return stdout;
  }

  private async resolveClaudeBin(): Promise<string> {
    try {
      const { stdout } = await execa('bash', ['-c', 'type -P claude']);
      return stdout.trim() || 'claude';
    } catch {
      return 'claude';
    }
  }

  private async summarize(transcript: string): Promise<string> {
    const prompt = SUMMARIZE_PROMPT.replace('{{TRANSCRIPT}}', transcript);
    return this.runClaude(prompt);
  }

  private async extractKnowledge(
    summary: string,
    existingMemory: string
  ): Promise<ExtractedKnowledge> {
    const systemInstruction =
      'You are a knowledge extraction system. ' +
      'Respond ONLY with valid JSON. No markdown fences, no explanation.\n\n';

    const prompt = systemInstruction + EXTRACT_KNOWLEDGE_PROMPT
      .replace('{{SUMMARY}}', summary)
      .replace('{{EXISTING_MEMORY}}', existingMemory || 'No existing memory yet.');

    const text = await this.runClaude(prompt);
    return this.parseResponse(text);
  }

  // ---------------------------------------------------------------------------
  // Private: response parsing
  // ---------------------------------------------------------------------------

  private parseResponse(text: string): ExtractedKnowledge {
    const empty: ExtractedKnowledge = {
      architecture: [],
      decisions: [],
      bugs: [],
      learnings: [],
    };

    // Strip accidental markdown code fences
    const cleaned = text
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    try {
      const parsed = JSON.parse(cleaned) as Partial<Record<MemoryType, unknown>>;
      return {
        architecture: this.toStringArray(parsed.architecture),
        decisions: this.toStringArray(parsed.decisions),
        bugs: this.toStringArray(parsed.bugs),
        learnings: this.toStringArray(parsed.learnings),
      };
    } catch {
      // Best-effort fallback: extract arrays via regex
      for (const type of MEMORY_TYPES) {
        const match = cleaned.match(
          new RegExp(`"${type}"\\s*:\\s*\\[([\\s\\S]*?)\\]`)
        );
        if (match) {
          const items = match[1].match(/"([^"]+)"/g)?.map(s => s.slice(1, -1)) ?? [];
          (empty as any)[type] = items;
        }
      }
      return empty;
    }
  }

  private toStringArray(val: unknown): string[] {
    if (!Array.isArray(val)) return [];
    return val.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
}
