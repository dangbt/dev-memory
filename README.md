# DevMemory

Persistent memory layer for Claude Code sessions.

DevMemory wraps the Claude CLI so every session automatically loads project knowledge from previous sessions — and saves new knowledge when the session ends.

```
dev-memory --goal "implement auth middleware"

[dev-memory] Loaded 13 memory entries (2 matched goal)
[dev-memory] Starting Claude Code session...

  ← Claude runs normally, but with your project memory as context →

[dev-memory] Session ended. Compiling memory...
[dev-memory] ✓ Memory updated — 4 new entries saved to .ai/memory/
```

---

## How it works

```
Before session                     After session
─────────────                      ─────────────
Load .ai/memory/*.md          →    Parse ~/.claude/projects/<id>.jsonl
TF-IDF search by goal         →    Summarize transcript (Claude API)
Build system prompt           →    Extract structured knowledge
Inject via --append-system-   →    Append to .ai/memory/*.md
  prompt into Claude          →    Rebuild TF-IDF index (SQLite)
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
# Clone or copy into your tools directory
git clone <repo> dev-memory
cd dev-memory
pnpm install        # or npm install / yarn install
```

**Make it globally available**

```bash
# Option A — npm link
npm link

# Option B — add to PATH directly
echo 'export PATH="/path/to/dev-memory/src/cli:$PATH"' >> ~/.zshrc

# Option C — alias in ~/.zshrc
alias claude="npx tsx /path/to/dev-memory/src/cli/start-session.ts"
```

---

## Usage

### Basic — start a Claude session with memory

```bash
# From inside any project directory
dev-memory
```

### With a session goal (recommended)

Providing a goal enables TF-IDF search to surface the most relevant memory entries for your current task.

```bash
dev-memory --goal "add pagination to the user list API"
dev-memory --goal "debug the flaky auth token expiry test"
dev-memory --goal "refactor the payment module to use the new SDK"
```

### Pass arguments through to Claude

Any arguments after `--` (or unknown flags) are forwarded to the Claude CLI.

```bash
# Start in a specific worktree
dev-memory --goal "fix bug" -- --worktree

# Use a specific model
dev-memory -- --model claude-opus-4-6

# Resume a previous Claude session
dev-memory -- --resume
```

### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `-g, --goal <text>` | Describe what you're working on | — |
| `-d, --project-dir <path>` | Project root (where `.ai/` lives) | `cwd` |
| `--no-memory` | Skip loading memory, start blank | memory on |
| `--no-compile` | Skip knowledge extraction after session | compile on |
| `-v, --verbose` | Show detailed progress logs | off |

---

## Project structure

Running `dev-memory` for the first time in a project creates:

```
your-project/
└── .ai/
    ├── config.json          ← project config
    ├── memory/
    │   ├── architecture.md  ← architectural decisions & patterns
    │   ├── decisions.md     ← important decisions & rationale
    │   ├── bugs.md          ← bugs found and how they were fixed
    │   └── learnings.md     ← key insights, gotchas, lessons learned
    ├── history/
    │   └── <uuid>.json      ← raw session transcripts
    └── embeddings/
        └── store.db         ← TF-IDF index (SQLite)
```

Add `.ai/history/` and `.ai/embeddings/` to `.gitignore`.
Commit `.ai/memory/` — it's your project's living knowledge base.

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

## Memory files

Memory is plain Markdown — you can read, edit, or delete entries manually.

**`.ai/memory/architecture.md`**
```markdown
# Architecture

- Uses Commander.js for CLI with a single main command that wraps Claude sessions
- Session recorder reads JSONL files from ~/.claude/projects/<encoded-path>/
- Memory stored as Markdown files in .ai/memory/, one per type
```

**`.ai/memory/decisions.md`**
```markdown
# Decisions

- Chose Postgres over SQLite for the main store because the team is already familiar with it
- API uses REST not GraphQL — complexity not justified for current feature set
```

**`.ai/memory/bugs.md`**
```markdown
# Bugs

- Auth token was not being refreshed on 401; fixed by adding interceptor in api-client.ts
- Race condition in job queue when two workers picked the same task; fixed with SELECT FOR UPDATE
```

**`.ai/memory/learnings.md`**
```markdown
# Learnings

- The staging environment uses a different S3 bucket region — always check AWS_REGION when debugging uploads
- Running migrations without --transaction flag caused partial state on failures; always use --transaction
```

---

## Recommended `.gitignore`

```gitignore
# DevMemory — commit memory/, ignore generated files
.ai/history/
.ai/embeddings/
```

---

## How memory compilation works

When a session ends, DevMemory runs a two-phase pipeline using the Claude API:

**Phase 1 — Summarize**

The raw session transcript (filtered to user/assistant text, max 100K chars) is sent to Claude with a prompt that produces a 150–300 word technical summary of what happened.

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

**`better-sqlite3 failed to load`**

On macOS, ensure Xcode Command Line Tools are installed:
```bash
xcode-select --install
```
Then reinstall: `pnpm install`

**Memory not loading for a project**

Check that you're running `dev-memory` from the same directory as `.ai/`. Use `--project-dir` to point to the right root:
```bash
dev-memory --project-dir /path/to/your/project
```

**Claude binary not found**

DevMemory resolves `claude` using `type -P claude` (bypasses shell aliases). Ensure the Claude CLI is installed and on your PATH:
```bash
which claude          # should return a path
claude --version      # should show version
```
