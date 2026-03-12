# Architecture

- CLI entry point is src/cli/start-session.ts, invoked as `dev-memory` binary via tsx shebang <!-- id:arch-001 createdAt:2026-03-12T00:00:00.000Z -->
- Session recording works by snapshotting ~/.claude/projects/<encoded-path>/ before launch and diffing after exit to find the new JSONL file <!-- id:arch-002 createdAt:2026-03-12T00:00:00.000Z -->
- Memory is persisted as flat Markdown files in .ai/memory/{architecture,decisions,bugs,learnings}.md with inline metadata comments <!-- id:arch-003 createdAt:2026-03-12T00:00:00.000Z -->
- Vector search uses TF-IDF via the natural library (no API key, no model download required) backed by SQLite in .ai/embeddings/store.db <!-- id:arch-004 createdAt:2026-03-12T00:00:00.000Z -->
- Memory compilation is a two-phase LLM pipeline: summarize transcript → extract structured JSON knowledge <!-- id:arch-005 createdAt:2026-03-12T00:00:00.000Z -->
