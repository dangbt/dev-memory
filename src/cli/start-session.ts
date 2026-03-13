#!/usr/bin/env tsx

import { program } from 'commander';
import { execa } from 'execa';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { createRequire } from 'module';
import updateNotifier from 'update-notifier';
import { ContextLoader } from '../engine/context-loader.js';
import { SessionRecorder } from '../engine/session-recorder.js';
import { MemoryCompiler } from '../engine/memory-compiler.js';

// ---------------------------------------------------------------------------
// Subcommand: inject
// Writes project memory into .ai/memory/context.md and ensures CLAUDE.md
// imports it — so both the CLI and the VSCode extension pick it up.
// ---------------------------------------------------------------------------

program
  .command('inject')
  .description('Write project memory into CLAUDE.md (for VSCode extension or manual use)')
  .option('-g, --goal <text>', 'Current session goal (improves relevance of loaded memory)')
  .option('-d, --project-dir <path>', 'Project root directory', process.cwd())
  .option('-f, --force', 'Re-inject even if context.md is already up to date')
  .option('-v, --verbose', 'Show detailed progress output')
  .action(async (opts: { goal?: string; projectDir: string; force: boolean; verbose: boolean }) => {
    const projectRoot = path.resolve(opts.projectDir);

    await initAiDir(projectRoot);

    // Skip if context.md is already fresher than all memory files (safe for hook use)
    if (!opts.force && await isContextFresh(projectRoot)) {
      if (opts.verbose) log('info', 'Context is up to date — skipping inject');
      return;
    }

    if (opts.verbose) log('info', 'Loading project memory...');

    const loader = new ContextLoader(projectRoot);
    const ctx = await loader.load(opts.goal);

    if (ctx.memoryCount === 0) {
      if (opts.verbose) log('info', 'No existing memory — nothing to inject');
      return;
    }

    const snippetNote = ctx.relevantSnippets > 0 ? ` (${ctx.relevantSnippets} matched goal)` : '';
    if (opts.verbose) log('info', `Loaded ${ctx.memoryCount} memory entries${snippetNote}`);

    // Write the context to .ai/memory/context.md
    const contextFile = path.join(projectRoot, '.ai', 'memory', 'context.md');
    await fs.writeFile(contextFile, ctx.systemPrompt, 'utf-8');
    if (opts.verbose) log('info', `Wrote context to ${path.relative(projectRoot, contextFile)}`);

    // Ensure CLAUDE.md at project root imports context.md
    await ensureClaudeMdImport(projectRoot, opts.verbose);

    log('success', `Memory injected — CLAUDE.md updated (${ctx.memoryCount} entries)`);
    if (opts.goal) {
      log('info', `Goal context: "${opts.goal}"`);
    }
  });

// ---------------------------------------------------------------------------
// Subcommand: compile
// Finds the latest Claude session transcript for this project (produced by
// either the CLI or the VSCode extension) and compiles it into memory.
// ---------------------------------------------------------------------------

program
  .command('compile')
  .description('Compile the latest Claude session transcript into project memory')
  .option('-d, --project-dir <path>', 'Project root directory', process.cwd())
  .option('-v, --verbose', 'Show detailed progress output')
  .action(async (opts: { projectDir: string; verbose: boolean }) => {
    const projectRoot = path.resolve(opts.projectDir);

    await initAiDir(projectRoot);

    const recorder = new SessionRecorder(projectRoot);
    await recorder.init();

    log('info', 'Looking for recent Claude sessions...');

    const sessionFile = await findLatestUncompiledSession(projectRoot, opts.verbose);

    if (!sessionFile) {
      log('info', 'No new sessions found — already up to date');
      return;
    }

    if (opts.verbose) log('info', `Session file: ${sessionFile}`);

    log('info', 'Compiling session into memory...');

    try {
      const messages = await recorder.readSession(sessionFile);

      if (messages.length < 2) {
        log('info', 'Session too short — skipping memory compilation');
        return;
      }

      const rawPath = await recorder.saveRaw(messages, sessionFile);
      if (opts.verbose) log('info', `Raw session saved: ${rawPath}`);

      const config = await new ContextLoader(projectRoot).loadConfig();
      const model = config.model ?? 'claude-sonnet-4-6';
      const compiler = new MemoryCompiler(projectRoot, model);

      const knowledge = await compiler.compile(messages);
      const saved = await compiler.saveKnowledge(knowledge);

      if (saved > 0) {
        log('success', `Memory updated — ${saved} new entries saved to .ai/memory/`);
        if (opts.verbose) {
          for (const [type, items] of Object.entries(knowledge)) {
            if ((items as string[]).length > 0) {
              console.log(`         ${type}: ${(items as string[]).length} entries`);
            }
          }
        }
      } else {
        log('info', 'No new knowledge extracted from this session');
      }
    } catch (err) {
      log('error', `Memory compilation failed: ${(err as Error).message}`);
      if (opts.verbose) console.error(err);
    }
  });

// ---------------------------------------------------------------------------
// Default command: start a Claude Code CLI session with memory injected
// ---------------------------------------------------------------------------

program
  .name('dev-memory')
  .description('Persistent memory layer for Claude Code sessions')
  .version('1.0.0')
  .option('-g, --goal <text>', 'Describe what you want to work on (enables goal-aware memory retrieval)')
  .option('-d, --project-dir <path>', 'Project root directory', process.cwd())
  .option('--no-memory', 'Skip loading memory (start with a blank context)')
  .option('--no-compile', 'Skip memory compilation when the session ends')
  .option('-v, --verbose', 'Show detailed progress output')
  .allowUnknownOption(true)
  .argument('[claude-args...]', 'Extra arguments forwarded to the Claude CLI')
  .action(async (claudeArgs: string[], opts: {
    goal?: string;
    projectDir: string;
    memory: boolean;
    compile: boolean;
    verbose: boolean;
  }) => {
    await runSession(claudeArgs, opts);
  });

const _require = createRequire(import.meta.url);
const pkg = _require('../../package.json') as { name: string; version: string };
updateNotifier({ pkg }).notify();

program.parse();

// ---------------------------------------------------------------------------
// Session runtime (CLI mode)
// ---------------------------------------------------------------------------

async function runSession(
  claudeArgs: string[],
  opts: {
    goal?: string;
    projectDir: string;
    memory: boolean;
    compile: boolean;
    verbose: boolean;
  }
): Promise<void> {
  const projectRoot = path.resolve(opts.projectDir);

  await initAiDir(projectRoot);

  let appendSystemPrompt = '';

  if (opts.memory) {
    if (opts.verbose) log('info', 'Loading project memory...');

    const loader = new ContextLoader(projectRoot);
    const ctx = await loader.load(opts.goal);
    appendSystemPrompt = ctx.systemPrompt;

    if (ctx.memoryCount > 0) {
      const snippetNote = ctx.relevantSnippets > 0 ? ` (${ctx.relevantSnippets} matched goal)` : '';
      log('info', `Loaded ${ctx.memoryCount} memory entries${snippetNote}`);
    } else {
      log('info', 'No existing memory — starting fresh');
    }
  }

  const recorder = new SessionRecorder(projectRoot);
  await recorder.init();
  const snapshot = await recorder.snapshot();

  log('info', 'Starting Claude Code session...\n');

  const claudeBin = await resolveClaudeBin();
  const args: string[] = [];

  if (appendSystemPrompt) {
    args.push('--append-system-prompt', appendSystemPrompt);
  }

  args.push(...claudeArgs);

  try {
    await execa(claudeBin, args, { stdio: 'inherit', reject: false });
  } catch (err) {
    if (opts.verbose) {
      log('warn', `Claude exited with an error: ${(err as Error).message}`);
    }
  }

  if (!opts.compile) return;

  console.log('');
  log('info', 'Session ended. Compiling memory...');

  const sessionFile = await recorder.findNewSession(snapshot);

  if (!sessionFile) {
    log('warn', 'No session file found — skipping memory compilation');
    return;
  }

  if (opts.verbose) log('info', `Session file: ${sessionFile}`);

  try {
    const messages = await recorder.readSession(sessionFile);

    if (messages.length < 2) {
      log('info', 'Session too short — skipping memory compilation');
      return;
    }

    const rawPath = await recorder.saveRaw(messages, sessionFile);
    if (opts.verbose) log('info', `Raw session saved: ${rawPath}`);

    const config = await new ContextLoader(projectRoot).loadConfig();
    const model = config.model ?? 'claude-sonnet-4-6';
    const compiler = new MemoryCompiler(projectRoot, model);

    const knowledge = await compiler.compile(messages);
    const saved = await compiler.saveKnowledge(knowledge);

    if (saved > 0) {
      log('success', `Memory updated — ${saved} new entries saved to .ai/memory/`);
      if (opts.verbose) {
        for (const [type, items] of Object.entries(knowledge)) {
          if ((items as string[]).length > 0) {
            console.log(`         ${type}: ${(items as string[]).length} entries`);
          }
        }
      }
    } else {
      log('info', 'No new knowledge extracted from this session');
    }
  } catch (err) {
    log('error', `Memory compilation failed: ${(err as Error).message}`);
    if (opts.verbose) console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if .ai/memory/context.md exists and is newer than all
 * source memory files — meaning inject can be safely skipped.
 */
async function isContextFresh(projectRoot: string): Promise<boolean> {
  const contextFile = path.join(projectRoot, '.ai', 'memory', 'context.md');
  if (!await fs.pathExists(contextFile)) return false;

  const contextMtime = (await fs.stat(contextFile)).mtimeMs;
  const memoryTypes = ['architecture', 'decisions', 'bugs', 'learnings'];

  for (const type of memoryTypes) {
    const memFile = path.join(projectRoot, '.ai', 'memory', `${type}.md`);
    if (!await fs.pathExists(memFile)) continue;
    if ((await fs.stat(memFile)).mtimeMs > contextMtime) return false;
  }

  return true;
}

/**
 * Ensure the project's CLAUDE.md file has a line importing
 * .ai/memory/context.md. Creates CLAUDE.md if it doesn't exist.
 */
async function ensureClaudeMdImport(projectRoot: string, verbose?: boolean): Promise<void> {
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  const importLine = '@.ai/memory/context.md';

  let content = '';
  if (await fs.pathExists(claudeMdPath)) {
    content = await fs.readFile(claudeMdPath, 'utf-8');
  }

  if (content.includes(importLine)) {
    if (verbose) log('info', 'CLAUDE.md already imports context.md — no changes needed');
    return;
  }

  // Prepend the import so it's always at the top
  const updated = `${importLine}\n\n${content}`.trimEnd() + '\n';
  await fs.writeFile(claudeMdPath, updated, 'utf-8');

  if (verbose) log('info', 'Added @.ai/memory/context.md import to CLAUDE.md');
}

/**
 * Find the most recently modified Claude JSONL session file for this project
 * that has not yet been compiled (not present in .ai/history/).
 */
async function findLatestUncompiledSession(
  projectRoot: string,
  verbose?: boolean
): Promise<string | null> {
  // Claude encodes the project path by replacing every path separator with '-'
  const encoded = projectRoot.replace(/[/\\]/g, '-');
  const sessionDir = path.join(os.homedir(), '.claude', 'projects', encoded);
  const historyDir = path.join(projectRoot, '.ai', 'history');

  if (!await fs.pathExists(sessionDir)) {
    if (verbose) log('warn', `No Claude session directory found at ${sessionDir}`);
    return null;
  }

  const files = await fs.readdir(sessionDir);
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

  if (jsonlFiles.length === 0) return null;

  // Get compiled session IDs (filenames in .ai/history/ without extension)
  const compiledIds = new Set<string>();
  if (await fs.pathExists(historyDir)) {
    const historyFiles = await fs.readdir(historyDir);
    for (const f of historyFiles) {
      compiledIds.add(path.basename(f, '.json'));
    }
  }

  // Sort by mtime descending, pick the newest uncompiled session
  const withStats = await Promise.all(
    jsonlFiles.map(async f => {
      const p = path.join(sessionDir, f);
      const stat = await fs.stat(p);
      return { path: p, id: path.basename(f, '.jsonl'), mtime: stat.mtimeMs };
    })
  );
  withStats.sort((a, b) => b.mtime - a.mtime);

  const uncompiled = withStats.filter(s => !compiledIds.has(s.id));

  if (uncompiled.length === 0) {
    if (verbose) log('info', 'All sessions already compiled');
    return null;
  }

  if (verbose && uncompiled.length > 1) {
    log('info', `Found ${uncompiled.length} uncompiled sessions — compiling the most recent`);
  }

  return uncompiled[0].path;
}

/**
 * Create the .ai/ project structure on first use.
 * Also ensures .gitignore excludes generated/large files.
 */
async function initAiDir(projectRoot: string): Promise<void> {
  const aiDir = path.join(projectRoot, '.ai');

  await Promise.all([
    fs.ensureDir(path.join(aiDir, 'memory')),
    fs.ensureDir(path.join(aiDir, 'history')),
    fs.ensureDir(path.join(aiDir, 'embeddings')),
  ]);

  const configPath = path.join(aiDir, 'config.json');
  if (!await fs.pathExists(configPath)) {
    await fs.writeJson(configPath, {
      version: 1,
      project: { name: path.basename(projectRoot) },
      model: 'claude-sonnet-4-6',
      maxMemoryEntriesPerType: 50,
    }, { spaces: 2 });
  }

  await ensureGitignore(projectRoot);
}

/**
 * Ensure the project .gitignore excludes generated dev-memory files.
 * Only adds entries that are not already present.
 */
async function ensureGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const requiredEntries = [
    '.ai/*',
  ];

  let content = '';
  if (await fs.pathExists(gitignorePath)) {
    content = await fs.readFile(gitignorePath, 'utf-8');
  }

  const missing = requiredEntries.filter(e => !content.includes(e));
  if (missing.length === 0) return;

  const block = '\n# dev-memory — generated files\n' + missing.join('\n') + '\n';
  await fs.appendFile(gitignorePath, block, 'utf-8');
}

/**
 * Find the real Claude CLI binary, bypassing shell aliases.
 * Supports macOS/Linux (type -P) and Windows (where.exe).
 */
async function resolveClaudeBin(): Promise<string> {
  const isWindows = process.platform === 'win32';

  try {
    if (isWindows) {
      const { stdout } = await execa('where.exe', ['claude']);
      const bin = stdout.trim().split('\n')[0].trim();
      return bin || 'claude';
    } else {
      const { stdout } = await execa('bash', ['-c', 'type -P claude']);
      const bin = stdout.trim();
      return bin || '/usr/local/bin/claude';
    }
  } catch {
    return isWindows ? 'claude' : '/usr/local/bin/claude';
  }
}

function log(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
  const prefix = {
    info:    '[dev-memory]',
    warn:    '[dev-memory] WARNING:',
    error:   '[dev-memory] ERROR:',
    success: '[dev-memory] ✓',
  }[level];
  console.log(`${prefix} ${message}`);
}
