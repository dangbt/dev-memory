# Decisions

- Chose TF-IDF over neural embeddings (@xenova/transformers) to avoid 100MB ONNX runtime download and external model dependencies <!-- id:dec-001 createdAt:2026-03-12T00:00:00.000Z -->
- Used better-sqlite3 (sync API) instead of async sqlite3 wrapper to eliminate async state machine complexity in the retriever pipeline <!-- id:dec-002 createdAt:2026-03-12T00:00:00.000Z -->
- Prompts are stored as TypeScript string constants in src/prompts/index.ts rather than .md files to avoid runtime path resolution issues between tsx and compiled output <!-- id:dec-003 createdAt:2026-03-12T00:00:00.000Z -->
- Package uses "type": "module" (ESM) because execa v9 is ESM-only; better-sqlite3 and natural are CJS but importable via Node ESM interop <!-- id:dec-004 createdAt:2026-03-12T00:00:00.000Z -->
- Claude binary is resolved via `bash -c "type -P claude"` to find the real executable path and bypass shell aliases <!-- id:dec-005 createdAt:2026-03-12T00:00:00.000Z -->
