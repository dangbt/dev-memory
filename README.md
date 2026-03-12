# DevMemory

[![npm version](https://img.shields.io/npm/v/dev-memory)](https://www.npmjs.com/package/dev-memory)
[![license](https://img.shields.io/npm/l/dev-memory)](LICENSE)
[![website](https://img.shields.io/badge/website-dev--memory.pages.dev-7c6aff)](https://dev-memory.pages.dev)

Give AI coding agents **long-term memory**.

Debug a bug once. Never debug it again.

DevMemory lets tools like Claude Code remember:

- bugs you fixed
- architecture decisions
- project patterns
- past debugging sessions

Your AI assistant **learns your project over time**.

Memory is stored as **plain Markdown** inside your repo — readable, diffable, committable.

---

## The Problem

AI coding assistants forget everything.

Every new session starts from zero.

That means:

- You fix the same bugs again
- You re-explain your architecture
- You repeat the same context
- Your AI pair programmer has **no long-term memory**

---

## The Solution

DevMemory adds a persistent memory layer for AI coding sessions.

It automatically:

1. Loads relevant project knowledge before each session
2. Records what happens during the session
3. Extracts useful knowledge
4. Saves it for future sessions

Your AI assistant slowly builds **experience with your codebase**.

---

## How It Works

```
Before session                 After session
─────────────────              ─────────────────
Load project memory    →       Parse Claude transcript
TF-IDF search by goal  →       Summarize session
Inject into Claude context  →  Extract knowledge
                               Append to memory
                               Rebuild search index
```

Memory lives in `.ai/memory/*.md` — human readable, git friendly, easy to edit manually.

---

## Demo

### Session 1

You debug a Redis timeout.

Claude finds the fix:

```
increase Redis timeout to 10s
due to network jitter in staging
```

DevMemory automatically saves it to `.ai/memory/bugs.md`.

### Session 2

You hit the same issue again.

Claude already knows the solution:

> "This issue happened before. Increase Redis timeout to 10s."

Your AI assistant **learned from the past session**.

---

## Installation

### Requirements

- Node.js ≥ 18
- Claude Code CLI installed
- `ANTHROPIC_API_KEY` set

### Install

```bash
npm install -g dev-memory
```

---

## Quick Start

Inside any project directory:

```bash
dev-memory --goal "debug auth middleware"
```

Example output:

```
[dev-memory] Loaded 13 memory entries (2 relevant)
[dev-memory] Starting Claude Code session...

...

[dev-memory] Session ended
[dev-memory] Extracted 3 new learnings
```

---

## Auto Mode (Recommended)

DevMemory can run automatically using Claude Code hooks.

Add this to `.claude/settings.json`:

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

Now DevMemory will:

- inject memory before each prompt
- compile new knowledge after each session

Fully automatic.

---

## What DevMemory Remembers

Memory is organized by type:

```
.ai/memory/
├── architecture.md
├── decisions.md
├── bugs.md
└── learnings.md
```

Example entry:

```markdown
### Bug: Redis timeout in staging

Cause: network jitter
Fix: increase redis timeout to 10s
```

Your project slowly builds a **living knowledge base**.

---

## CLI Usage

```bash
# Start a session
dev-memory

# With a goal
dev-memory --goal "implement auth middleware"

# Pass arguments to Claude
dev-memory -- --resume
dev-memory -- --model claude-opus
```

---

## CLI Flags

| Flag | Description |
|---|---|
| `--goal` | Describe what you're working on |
| `--project-dir` | Project root |
| `--no-memory` | Start session without loading memory |
| `--no-compile` | Skip memory compilation |
| `--verbose` | Detailed logs |

---

## Project Structure

```
your-project/
├── CLAUDE.md
└── .ai/
    ├── config.json
    ├── memory/
    │   ├── architecture.md
    │   ├── decisions.md
    │   ├── bugs.md
    │   ├── learnings.md
    │   └── context.md
    ├── history/
    │   └── session.json
    └── embeddings/
        └── store.db
```

Add to `.gitignore`:

```
.ai/history/
.ai/embeddings/
.ai/memory/context.md
```

Commit `.ai/memory/*.md` — these files become your **project knowledge base**.

---

## Architecture

DevMemory runs a two-phase pipeline.

**Phase 1 — Summarize**
Session transcript → Claude → summary.

**Phase 2 — Extract**
Claude extracts structured knowledge:

- bugs
- decisions
- architecture
- learnings

Stored locally and indexed using **SQLite + TF-IDF**. Fast, local, cheap.

---

## Memory Graph (Experimental)

Visualize your project's knowledge graph.

```bash
dev-memory graph
```

Example output:

```
Auth System
├── decision: use JWT
├── bug: token expiry race condition
└── learning: refresh token rotation

Payment System
├── decision: Stripe webhooks
├── bug: duplicate charge bug
└── learning: idempotency keys
```

Coming soon:

```bash
dev-memory graph --visual
dev-memory graph --web
```

Interactive knowledge graph for your codebase.

---

## Philosophy

AI tools should learn like developers do — from experience.

DevMemory turns coding sessions into a growing **project memory**.

Over time your AI assistant becomes faster, smarter, and more aware of your architecture.

---

## Roadmap

Planned features:

- Memory Graph
- Architecture Map generation
- Multi-agent memory
- Cursor integration
- GitHub Copilot integration

---

## Contributing

PRs welcome. If you have ideas for improving AI memory systems, open an issue.

---

## License

MIT
