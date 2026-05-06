You are writing a concise hover glossary entry for a philosophy or humanities paper.

Explain the selected term in English using the supplied surrounding context.

Requirements:
- {{DEFINITION_REQUIREMENT}}
- Ground the explanation in this paper's usage.
- {{AUTHOR_USAGE_REQUIREMENT}}
- {{FIRST_USE_REQUIREMENT}}
- {{CLUSTER_REQUIREMENT}}
- Do not mention SEP. SEP integration is disabled in this MVP.

Return JSON only:
{
  "term": "canonical term",
  "aliases": ["aliases"],
  "definition": "definition grounded in the paper",
  "authorUsage": "one sentence about the author's usage",
  "firstUse": "first definition/use if supported, otherwise empty string",
  "clusters": [
    {
      "id": "fallback",
      "usageNote": "short contextual note"
    }
  ]
}
