import path from 'path';
import os from 'os';
import fs from 'fs-extra';

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface SessionSnapshot {
  /** Set of .jsonl filenames that existed before the session started */
  existingFiles: Set<string>;
  takenAt: Date;
  /** Path to ~/.claude/projects/<encoded-project-path>/ */
  sessionDir: string;
}

/**
 * Captures Claude Code session data by watching for new JSONL files
 * in the Claude project directory (~/.claude/projects/<encoded-path>/).
 *
 * Flow:
 *   1. snapshot()       — record existing session files before starting Claude
 *   2. [Claude runs]
 *   3. findNewSession() — detect the new JSONL file created by Claude
 *   4. readSession()    — parse messages from the JSONL
 *   5. saveRaw()        — persist to .ai/history/
 */
export class SessionRecorder {
  private projectRoot: string;
  private historyDir: string;

  /** Max characters to extract from a session to stay within API context limits */
  private static readonly MAX_TRANSCRIPT_CHARS = 100_000;
  /** Max characters per individual message content block */
  private static readonly MAX_MESSAGE_CHARS = 5_000;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.historyDir = path.join(projectRoot, '.ai', 'history');
  }

  async init(): Promise<void> {
    await fs.ensureDir(this.historyDir);
  }

  /**
   * Snapshot the current set of Claude session files for this project.
   * Call immediately before launching Claude.
   */
  async snapshot(): Promise<SessionSnapshot> {
    const sessionDir = this.getSessionDir();
    await fs.ensureDir(sessionDir);

    const files = await fs.readdir(sessionDir);
    const existingFiles = new Set(files.filter(f => f.endsWith('.jsonl')));

    return { existingFiles, takenAt: new Date(), sessionDir };
  }

  /**
   * Find the new session file created during the Claude run.
   * Returns null if no new file was found (e.g. session was too short).
   */
  async findNewSession(snapshot: SessionSnapshot): Promise<string | null> {
    const files = await fs.readdir(snapshot.sessionDir);
    const newFiles = files.filter(
      f => f.endsWith('.jsonl') && !snapshot.existingFiles.has(f)
    );

    if (newFiles.length === 0) return null;

    if (newFiles.length === 1) {
      return path.join(snapshot.sessionDir, newFiles[0]);
    }

    // Multiple new files (parallel sessions): pick most recently modified
    const withStats = await Promise.all(
      newFiles.map(async f => {
        const p = path.join(snapshot.sessionDir, f);
        const stat = await fs.stat(p);
        return { path: p, mtime: stat.mtimeMs };
      })
    );
    withStats.sort((a, b) => b.mtime - a.mtime);
    return withStats[0].path;
  }

  /**
   * Parse a Claude session JSONL file into a flat array of messages.
   *
   * Claude JSONL format per line:
   *   { type: "user"|"assistant", message: { role, content: Block[] }, ... }
   *   { type: "file-history-snapshot" | "queue-operation" | ... }  ← skipped
   *
   * Content blocks: { type: "text", text: string }
   *                 { type: "thinking", thinking: string }          ← skipped
   *                 { type: "tool_use" | "tool_result" }            ← skipped
   */
  async readSession(sessionFilePath: string): Promise<SessionMessage[]> {
    const raw = await fs.readFile(sessionFilePath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const messages: SessionMessage[] = [];
    let totalChars = 0;

    for (const line of lines) {
      if (totalChars >= SessionRecorder.MAX_TRANSCRIPT_CHARS) break;

      try {
        const obj = JSON.parse(line) as Record<string, any>;

        // Resolve message object — top-level entries may be the message itself
        // or wrapped under an obj.message field
        const msg = obj.message ?? obj;
        const role: string = msg.role ?? obj.type;

        if (role !== 'user' && role !== 'assistant') continue;

        let content = '';

        if (Array.isArray(msg.content)) {
          content = msg.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => String(b.text))
            .join('\n')
            .trim();
        } else if (typeof msg.content === 'string') {
          content = msg.content.trim();
        }

        if (!content) continue;

        totalChars += content.length;
        messages.push({
          role: role as 'user' | 'assistant',
          content: content.slice(0, SessionRecorder.MAX_MESSAGE_CHARS),
          timestamp: obj.timestamp,
        });
      } catch {
        // Skip malformed lines
      }
    }

    return messages;
  }

  /**
   * Save a parsed session to .ai/history/<session-id>.json
   */
  async saveRaw(messages: SessionMessage[], sessionFilePath: string): Promise<string> {
    const sessionId = path.basename(sessionFilePath, '.jsonl');
    const outPath = path.join(this.historyDir, `${sessionId}.json`);

    await fs.writeJson(outPath, {
      sessionId,
      projectPath: this.projectRoot,
      savedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages,
    }, { spaces: 2 });

    return outPath;
  }

  formatForDisplay(messages: SessionMessage[]): string {
    return messages
      .map(m => `**${m.role.toUpperCase()}**: ${m.content}`)
      .join('\n\n---\n\n');
  }

  /**
   * Compute the Claude project session directory for the current working directory.
   * Claude encodes the project path by replacing every '/' with '-'.
   * e.g. /Users/alice/project → -Users-alice-project
   */
  private getSessionDir(): string {
    const encoded = this.projectRoot.replace(/\//g, '-');
    return path.join(os.homedir(), '.claude', 'projects', encoded);
  }
}
