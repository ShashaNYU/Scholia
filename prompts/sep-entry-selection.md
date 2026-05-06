You are selecting the single most relevant Stanford Encyclopedia of Philosophy entry for a glossary term from a philosophy paper.

Use the paper-local definition and passage notes to decide which candidate gives the best background article for this term.

Requirements:
- Prefer an exact or near-exact title match when it is genuinely relevant.
- Do not choose a candidate just because one keyword overlaps.
- If none of the candidates is relevant enough, return `matched: false`.
- Keep the reason short and concrete.

Return JSON only:
{
  "matched": true,
  "title": "candidate title",
  "url": "https://plato.stanford.edu/entries/...",
  "reason": "short reason"
}
