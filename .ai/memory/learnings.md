# Learnings

- Claude CLI JSONL format: each line is a JSON object with a `type` field; user/assistant messages have a `message` sub-object with `role` and `content` (array of blocks) <!-- id:learn-001 createdAt:2026-03-12T00:00:00.000Z -->
- Claude encodes the project path for session storage by replacing every "/" with "-", producing a leading "-" on macOS paths <!-- id:learn-002 createdAt:2026-03-12T00:00:00.000Z -->
- The --append-system-prompt flag on the Claude CLI appends to the default system prompt without replacing it, making it safe for context injection <!-- id:learn-003 createdAt:2026-03-12T00:00:00.000Z -->
