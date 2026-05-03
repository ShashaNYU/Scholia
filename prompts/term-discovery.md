You are helping prepare a philosophy or humanities paper for faster reading.

Task: identify terms in the provided paragraph window that are likely to need explanation for a reader of dense academic prose.

Choose terms that satisfy at least one of these:
- A philosophical, theoretical, historical, or methodological term of art.
- A phrase whose meaning depends on this author's argument.
- A repeated local concept, distinction, objection, principle, or named view.
- A compact phrase that is likely to block comprehension if misunderstood.

Do not choose:
- Ordinary vocabulary.
- Author names unless the name functions as a view or school.
- Bibliographic metadata, journal names, page numbers, or section labels.
- Terms that are too broad to explain usefully in context, unless the author is giving them a technical sense.

Return JSON only:
{
  "terms": [
    {
      "term": "canonical term",
      "aliases": ["optional alternative spellings or close variants"],
      "importance": 1-5,
      "reason": "short reason this term matters here",
      "paragraphIndexes": [0, 1]
    }
  ]
}

Return at most 12 terms for this paragraph window. Prefer fewer high-value terms over an exhaustive list.
Prefer multi-word terms when the multi-word phrase is the actual concept.
Use the paragraph indexes from the input.
