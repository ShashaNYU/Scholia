You are writing a concise hover glossary entry for a philosophy or humanities paper.

Explain the selected term in English using the supplied surrounding context.

Requirements:
- About 80-120 words.
- Ground the explanation in this paper's usage.
- Include a short author/context usage note.
- If the supplied context suggests where the term is first defined or first importantly used, say so.
- Do not mention SEP. SEP integration is disabled in this MVP.

Return JSON only:
{
  "term": "canonical term",
  "aliases": ["aliases"],
  "definition": "80-120 word definition grounded in the paper",
  "authorUsage": "one sentence about the author's usage",
  "firstUse": "first definition/use if supported, otherwise empty string",
  "clusters": [
    {
      "id": "fallback",
      "usageNote": "short contextual note"
    }
  ]
}
