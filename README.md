# DevMemory

Persistent memory layer for Claude Code sessions — works with both the **CLI** and the **VSCode extension**.

---

## How it works

```
Before session                     After session
─────────────                      ─────────────
Load .ai/memory/*.md          →    Parse ~/.claude/projects/<id>.jsonl
TF-IDF search by goal         →    Summarize transcript (Claude API)
Build system prompt           →    Extract structured knowledge
Inject into Claude            →    Append to .ai/memory/*.md
                                   Rebuild TF-IDF index (SQLite)
```

Memory is stored as plain Markdown files in `.ai/memory/` — readable, diffable, committable.

---

## Installation

**Prerequisites**

- Node.js ≥ 18
- Claude Code CLI installed (`claude` in your PATH)
- `ANTHROPIC_API_KEY` set in your environment (for memory compilation)

**Install**

```bash
git clone <repo> dev-memory
cd dev-memory
pnpm install
pnpm link          # makes `dev-memory` available globally
```

---

## Usage — CLI mode

Use this when working in the terminal with `claude`.

DevMemory wraps the Claude CLI, injecting project memory before the session starts and compiling new knowledge when it ends.

```bash
# From inside any project directory
dev-memory

# With a session goal (recommended — improves memory relevance via TF-IDF)
dev-memory --goal "add pagination to the user list API"
dev-memory --goal "debug the flaky auth token expiry test"
```

**Example output**

```
dev-memory --goal "implement auth middleware"

[dev-memory] Loaded 13 memory entries (2 matched goal)
[dev-memory] Starting Claude Code session...

  ← Claude runs normally, but with your project memory as context →

[dev-memory] Session ended. Compiling memory...
[dev-memory] ✓ Memory updated — 4 new entries saved to .ai/memory/
```

**Pass arguments through to Claude**

Any unknown flags are forwarded to the Claude CLI:

```bash
dev-memory --goal "fix bug" -- --worktree
dev-memory -- --model claude-opus-4-6
dev-memory -- --resume
```

**Flags**

| Flag | Description | Default |
|------|-------------|---------|
| `-g, --goal <text>` | Describe what you're working on | — |
| `-d, --project-dir <path>` | Project root (where `.ai/` lives) | `cwd` |
| `--no-memory` | Skip loading memory, start blank | memory on |
| `--no-compile` | Skip knowledge extraction after session | compile on |
| `-v, --verbose` | Show detailed progress logs | off |

---

## Usage — VSCode extension mode

Use this when working inside the Claude Code VSCode extension.

The extension doesn't go through the CLI wrapper, so memory is injected via `CLAUDE.md` instead — a file that both the CLI and the extension always read.

### Step-by-step

**1. Before opening VSCode (or starting a new conversation)**

Run `inject` from your project root. This writes your project memory into `.ai/memory/context.md` and ensures `CLAUDE.md` imports it:

```bash
cd /your/project
dev-memory inject

# [dev-memory] ✓ Memory injected — CLAUDE.md updated (13 entries)
```

With a goal (recommended — surfaces the most relevant entries):

```bash
dev-memory inject --goal "refactor the payment module"

# [dev-memory] ✓ Memory injected — CLAUDE.md updated (13 entries)
# [dev-memory] Goal context: "refactor the payment module"
```

**2. Open your project in VSCode and use Claude normally**

The extension reads `CLAUDE.md` automatically. Your project memory is now part of every conversation context.

**3. After your session — compile new knowledge**

Run `compile` from your project root. It finds the latest session transcript written by the extension and extracts new knowledge into `.ai/memory/`:

```bash
dev-memory compile

# [dev-memory] Looking for recent Claude sessions...
# [dev-memory] Compiling session into memory...
# [dev-memory] ✓ Memory updated — 3 new entries saved to .ai/memory/
```

**4. Next session — re-inject to pick up the new entries**

```bash
dev-memory inject --goal "..."
```

That's the full cycle.

---

### Auto mode — fully automatic with Claude Code hooks

Instead of running `inject` and `compile` manually, you can wire them up as Claude Code hooks so they run automatically inside the extension.

**Step 1 — Copy the hooks config into your project**

```bash
mkdir -p .claude
cp /path/to/dev-memory/.claude/settings.json .claude/settings.json
```

Or add this to your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "dev-memory inject 2>/dev/null || true"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "nohup dev-memory compile > /dev/null 2>&1 &"
          }
        ]
      }
    ]
  }
}
```

**Step 2 — Done**

- `inject` runs before each prompt. If `context.md` is already up to date, it exits in milliseconds — no unnecessary work.
- `compile` runs in the **background** after Claude finishes (`nohup ... &`), so it doesn't block your workflow. It makes 2 API calls to the Anthropic API — typically < $0.01 per session with the default model.

To apply the same hooks globally (all projects), add them to `~/.claude/settings.json` instead.

---

### inject flags

| Flag | Description | Default |
|------|-------------|---------|
| `-g, --goal <text>` | Current session goal (improves relevance) | — |
| `-d, --project-dir <path>` | Project root (where `.ai/` lives) | `cwd` |
| `-v, --verbose` | Show detailed progress logs | off |

### compile flags

| Flag | Description | Default |
|------|-------------|---------|
| `-d, --project-dir <path>` | Project root (where `.ai/` lives) | `cwd` |
| `-v, --verbose` | Show detailed progress logs | off |

---

## Project structure

Running `dev-memory` or `dev-memory inject` for the first time in a project creates:

```
your-project/
├── CLAUDE.md                    ← @.ai/memory/context.md added here
└── .ai/
    ├── config.json              ← project config
    ├── memory/
    │   ├── context.md           ← generated: full context injected into CLAUDE.md
    │   ├── architecture.md      ← architectural decisions & patterns
    │   ├── decisions.md         ← important decisions & rationale
    │   ├── bugs.md              ← bugs found and how they were fixed
    │   └── learnings.md         ← key insights, gotchas, lessons learned
    ├── history/
    │   └── <uuid>.json          ← raw session transcripts (auto-saved)
    └── embeddings/
        └── store.db             ← TF-IDF index (SQLite)
```

Add to your `.gitignore`:

```gitignore
# DevMemory — commit memory/, ignore generated files
.ai/history/
.ai/embeddings/
.ai/memory/context.md   ← generated on each inject, not worth committing
```

Commit `.ai/memory/*.md` (except `context.md`) — they are your project's living knowledge base.

---

## Config — `.ai/config.json`

```json
{
  "version": 1,
  "project": {
    "name": "my-project"
  },
  "model": "claude-sonnet-4-6",
  "maxMemoryEntriesPerType": 50
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `project.name` | Project name shown in Claude's context | directory name |
| `model` | Claude model used for memory compilation | `claude-sonnet-4-6` |
| `maxMemoryEntriesPerType` | Max entries kept per memory type (oldest trimmed) | `50` |

---

## How memory compilation works

When a session ends (CLI: automatically; extension: via `dev-memory compile`), DevMemory runs a two-phase pipeline:

**Phase 1 — Summarize**

The raw session transcript (user/assistant text only, max 100K chars) is sent to Claude, producing a 150–300 word technical summary.

**Phase 2 — Extract**

The summary plus existing memory are sent to Claude with a strict JSON-output prompt. Claude returns new knowledge categorised into the four memory types, avoiding duplication with existing entries.

New entries are appended to the relevant `.md` files and the TF-IDF search index is rebuilt.

---

## Troubleshooting

**`ANTHROPIC_API_KEY not set`**

Memory compilation requires the Anthropic API. Set the key in your shell:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**`No session file found — skipping memory compilation`**

Claude exited before writing any messages (e.g. immediate Ctrl+C). Nothing to compile.

**`No new sessions found — already up to date`** (from `dev-memory compile`)

All session transcripts in `~/.claude/projects/<your-project>/` have already been compiled. This is the expected message after the first `compile` if no new extension session has run since then.

**`better-sqlite3 failed to load`**

On macOS, ensure Xcode Command Line Tools are installed:
```bash
xcode-select --install
```
Then reinstall: `pnpm install`

**Memory not loading for a project**

Check that you're running from the same directory as `.ai/`. Use `--project-dir` to point to the right root:
```bash
dev-memory inject --project-dir /path/to/your/project
dev-memory compile --project-dir /path/to/your/project
```

**Claude binary not found**

DevMemory resolves `claude` using `type -P claude` (bypasses shell aliases). Ensure the Claude CLI is installed and on your PATH:
```bash
which claude          # should return a path
claude --version      # should show version
```
