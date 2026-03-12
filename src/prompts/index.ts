/**
 * Prompt templates used by the MemoryCompiler.
 *
 * Using TypeScript constants avoids runtime path resolution issues
 * when switching between `tsx` (development) and compiled output.
 *
 * The companion .md files (summarize.md, extract-knowledge.md) are
 * human-readable versions of the same content.
 */

/**
 * Phase 1 — Summarize the raw session transcript into a concise narrative.
 * Placeholder: {{TRANSCRIPT}}
 */
export const SUMMARIZE_PROMPT = `\
You are summarizing a Claude Code development session for long-term project memory.

Given the session transcript below, write a concise technical summary (150–300 words) covering:
- The main task or goal of the session
- What was accomplished or attempted
- Key technical decisions made and their rationale
- Any problems encountered and how they were resolved
- Important context or constraints discovered

Be specific and technical. Avoid generic statements like "code was written" —
name the actual files, functions, patterns, or technologies involved.

## Session Transcript

{{TRANSCRIPT}}`;

/**
 * Phase 2 — Extract structured, durable knowledge from the session summary.
 * Placeholders: {{SUMMARY}}, {{EXISTING_MEMORY}}
 */
export const EXTRACT_KNOWLEDGE_PROMPT = `\
You are extracting structured knowledge from a development session to store in project memory.

Given the session summary and the project's existing memory, identify NEW durable knowledge
to add. Focus on information that will be genuinely useful in future sessions.

Rules:
- Do NOT repeat items already present in existing memory
- Each item must be a complete, standalone sentence (self-contained without context)
- Only include information that is likely to remain relevant long-term
- If a category has nothing new, use an empty array []

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):

{
  "architecture": [
    "One sentence describing an architectural decision, pattern, or structural insight"
  ],
  "decisions": [
    "One sentence describing an important decision made and the reason behind it"
  ],
  "bugs": [
    "One sentence describing a bug that was found and how it was fixed"
  ],
  "learnings": [
    "One sentence describing a key insight, gotcha, or lesson learned"
  ]
}

## Session Summary

{{SUMMARY}}

## Existing Memory (do NOT repeat these)

{{EXISTING_MEMORY}}`;
