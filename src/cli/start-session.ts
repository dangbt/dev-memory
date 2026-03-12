#!/usr/bin/env tsx

import { program } from 'commander';
import { execa } from 'execa';
import path from 'path';
import fs from 'fs-extra';
import { ContextLoader } from '../engine/context-loader.js';
import { SessionRecorder } from '../engine/session-recorder.js';
import { MemoryCompiler } from '../engine/memory-compiler.js';

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

program
  .name('dev-memory')
  .description('Persistent memory layer for Claude Code sessions')
  .version('1.0.0')
  .option(
    '-g, --goal <text>',
    'Describe what you want to work on (enables goal-aware memory retrieval)'
  )
  .option(
    '-d, --project-dir <path>',
    'Project root directory',
    process.cwd()
  )
  .option('--no-memory', 'Skip loading memory (start with a blank context)')
  .option('--no-compile', 'Skip memory compilation when the session ends')
  .option('-v, --verbose', 'Show detailed progress output')
  .allowUnknownOption(true) // pass remaining flags through to claude
  .argument('[claude-args...]', 'Extra arguments forwarded to the Claude CLI')
  .action(async (claudeArgs: string[], opts: {
    goal?: string;
    projectDir: string;
    memory: boolean;
    compile: boolean;
    verbose: boolean;
  }) => {
    await run(claudeArgs, opts);
  });

program.parse();

// ---------------------------------------------------------------------------
// Main runtime
// ---------------------------------------------------------------------------

async function run(
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

  // 1. Ensure .ai/ directory structure exists
  await initAiDir(projectRoot);

  // 2. Pre-flight: check API key if compilation is requested
  if (!process.env.ANTHROPIC_API_KEY && opts.compile) {
    log('warn', 'ANTHROPIC_API_KEY not set — memory compilation will be skipped after the session');
    opts.compile = false;
  }

  // 3. Load memory context
  let appendSystemPrompt = '';

  if (opts.memory) {
    if (opts.verbose) log('info', 'Loading project memory...');

    const loader = new ContextLoader(projectRoot);
    const ctx = await loader.load(opts.goal);
    appendSystemPrompt = ctx.systemPrompt;

    if (ctx.memoryCount > 0) {
      const snippetNote =
        ctx.relevantSnippets > 0 ? ` (${ctx.relevantSnippets} matched goal)` : '';
      log('info', `Loaded ${ctx.memoryCount} memory entries${snippetNote}`);
    } else {
      log('info', 'No existing memory — starting fresh');
    }
  }

  // 4. Snapshot existing Claude sessions so we can detect the new one later
  const recorder = new SessionRecorder(projectRoot);
  await recorder.init();
  const snapshot = await recorder.snapshot();

  // 5. Launch Claude
  log('info', 'Starting Claude Code session...\n');

  const claudeBin = await resolveClaudeBin();
  const args: string[] = [];

  if (appendSystemPrompt) {
    args.push('--append-system-prompt', appendSystemPrompt);
  }

  args.push(...claudeArgs);

  try {
    await execa(claudeBin, args, {
      stdio: 'inherit',
      // Don't throw on non-zero exit — Ctrl+C produces exit 130
      reject: false,
    });
  } catch (err) {
    if (opts.verbose) {
      log('warn', `Claude exited with an error: ${(err as Error).message}`);
    }
  }

  // 6. Post-session: compile memory
  if (!opts.compile) return;

  console.log(''); // spacer after Claude's output
  log('info', 'Session ended. Compiling memory...');

  const sessionFile = await recorder.findNewSession(snapshot);

  if (!sessionFile) {
    log('warn', 'No session file found — skipping memory compilation');
    return;
  }

  if (opts.verbose) {
    log('info', `Session file: ${sessionFile}`);
  }

  try {
    const messages = await recorder.readSession(sessionFile);

    if (messages.length < 2) {
      log('info', 'Session too short — skipping memory compilation');
      return;
    }

    // Save raw session to .ai/history/
    const rawPath = await recorder.saveRaw(messages, sessionFile);
    if (opts.verbose) log('info', `Raw session saved: ${rawPath}`);

    // Run two-phase knowledge extraction
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
 * Create the .ai/ project structure on first use.
 * Also writes a default config.json if one doesn't exist yet.
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
      project: {
        name: path.basename(projectRoot),
      },
      model: 'claude-sonnet-4-6',
      maxMemoryEntriesPerType: 50,
    }, { spaces: 2 });
    // Silently create — only show in verbose mode via the caller
  }
}

/**
 * Find the real Claude CLI binary, bypassing shell aliases.
 * `type -P` returns the file path without resolving aliases.
 */
async function resolveClaudeBin(): Promise<string> {
  try {
    const { stdout } = await execa('bash', ['-c', 'type -P claude']);
    const bin = stdout.trim();
    return bin || '/usr/local/bin/claude';
  } catch {
    return '/usr/local/bin/claude';
  }
}

function log(
  level: 'info' | 'warn' | 'error' | 'success',
  message: string
): void {
  const prefix = {
    info:    '[dev-memory]',
    warn:    '[dev-memory] WARNING:',
    error:   '[dev-memory] ERROR:',
    success: '[dev-memory] ✓',
  }[level];

  console.log(`${prefix} ${message}`);
}
