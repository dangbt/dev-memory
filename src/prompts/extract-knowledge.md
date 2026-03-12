# Extract Knowledge Prompt

> **Usage**: Phase 2 of memory compilation. Converts session summary into structured memory entries.
> Replace `{{SUMMARY}}` and `{{EXISTING_MEMORY}}` before sending.
> **System prompt**: "You are a knowledge extraction system. Respond ONLY with valid JSON. No markdown, no explanation."

---

You are extracting structured knowledge from a development session to store in project memory.

Given the session summary and the project's existing memory, identify NEW durable knowledge
to add. Focus on information that will be genuinely useful in future sessions.

Rules:
- Do NOT repeat items already present in existing memory
- Each item must be a complete, standalone sentence (self-contained without context)
- Only include information that is likely to remain relevant long-term
- If a category has nothing new, use an empty array []

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):

```json
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
```

## Session Summary

{{SUMMARY}}

## Existing Memory (do NOT repeat these)

{{EXISTING_MEMORY}}
