const assert = require("node:assert/strict");
const test = require("node:test");

const {
  analyzeMarkdownQuality,
  applySentenceHighlights,
  buildContextClusters,
  buildGlossaryMarkdown,
  buildKeySentenceParagraphs,
  buildParagraphWindows,
  chooseClusterForOffset,
  findPreparedTermAtPosition,
  findTermOccurrences,
  findWordAtPosition,
  mergeTermCandidates,
  normalizeTerm,
  parseGlossaryMarkdown,
  parseJsonFromText,
  parseLooseJsonFromText,
  removeManagedSentenceHighlights,
  slugify,
  splitParagraphSentences,
  splitParagraphs
} = require("../src/core.js");

test("slugify and normalizeTerm produce stable cache keys", () => {
  assert.equal(normalizeTerm("  Transcendental   Idealism. "), "transcendental idealism");
  assert.equal(slugify("Transcendental Idealism"), "transcendental-idealism");
  assert.equal(slugify("!!!", "paper"), "paper");
});

test("splitParagraphs tracks headings and offsets", () => {
  const markdown = [
    "---",
    "title: Example",
    "---",
    "",
    "# Section One",
    "",
    "The first paragraph introduces transcendental idealism as a doctrine about cognition.",
    "",
    "The second paragraph uses the concept to frame the author's objection.",
    "",
    "## Section Two",
    "",
    "A later paragraph changes the role of transcendental idealism in the argument."
  ].join("\n");

  const paragraphs = splitParagraphs(markdown);
  assert.equal(paragraphs.length, 3);
  assert.equal(paragraphs[0].heading, "Section One");
  assert.equal(paragraphs[2].heading, "Section Two");
  assert.ok(paragraphs[0].start > markdown.indexOf("# Section One"));
});

test("buildParagraphWindows uses overlap", () => {
  const paragraphs = Array.from({ length: 7 }, (_, index) => ({
    index,
    start: index * 10,
    end: index * 10 + 5,
    raw: `Paragraph ${index}`,
    text: `Paragraph ${index} has enough content to be included.`,
    heading: ""
  }));

  const windows = buildParagraphWindows(paragraphs, 3, 1);
  assert.deepEqual(windows.map((window) => window.paragraphIndexes), [
    [0, 1, 2],
    [2, 3, 4],
    [4, 5, 6]
  ]);
});

test("mergeTermCandidates deduplicates and ranks terms", () => {
  const merged = mergeTermCandidates([
    { term: "transcendental idealism", importance: 5, aliases: ["TI"], paragraphIndexes: [1] },
    { term: "Transcendental Idealism", importance: 4, paragraphIndexes: [4] },
    { term: "claim", importance: 1, paragraphIndexes: [2] }
  ], 10);

  assert.equal(merged[0].normalizedTerm, "transcendental idealism");
  assert.equal(merged[0].frequency, 2);
  assert.deepEqual(merged[0].paragraphIndexes.sort(), [1, 4]);
  assert.equal(merged.length, 2);
});

test("findTermOccurrences respects word boundaries", () => {
  const markdown = "Idealism differs from transcendental idealism. Anti-idealism is another phrase.";
  const occurrences = findTermOccurrences(markdown, "idealism", []);
  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[0].text, "Idealism");
  assert.equal(occurrences[1].text, "idealism");
});

test("findTermOccurrences still matches terms inside sentence highlights", () => {
  const markdown = "==Transcendental idealism== frames the opening move. A later sentence reuses transcendental idealism.";
  const occurrences = findTermOccurrences(markdown, "transcendental idealism", []);

  assert.equal(occurrences.length, 2);
});

test("buildContextClusters groups occurrences by heading", () => {
  const markdown = [
    "# First",
    "",
    "Transcendental idealism is introduced here with enough surrounding prose to count.",
    "",
    "The author returns to transcendental idealism in the same section.",
    "",
    "# Second",
    "",
    "Here transcendental idealism is used against a different objection."
  ].join("\n");
  const paragraphs = splitParagraphs(markdown);
  const clusters = buildContextClusters(markdown, paragraphs, {
    term: "transcendental idealism",
    aliases: []
  }, 5);

  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].label, "First");
  assert.equal(clusters[1].label, "Second");
});

test("splitParagraphSentences produces stable sentence ids and offsets", () => {
  const markdown = [
    "# Section One",
    "",
    "The first sentence introduces the central claim. The second sentence sharpens the objection. The third sentence resolves the tension."
  ].join("\n");

  const paragraph = splitParagraphs(markdown)[0];
  const sentences = splitParagraphSentences(markdown, paragraph);

  assert.equal(sentences.length, 3);
  assert.equal(sentences[0].id, "p-0-s-1");
  assert.equal(sentences[1].id, "p-0-s-2");
  assert.equal(markdown.slice(sentences[1].startOffset, sentences[1].endOffset), "The second sentence sharpens the objection.");
});

test("buildKeySentenceParagraphs skips single-sentence and short paragraphs", () => {
  const markdown = [
    "This paragraph is long enough to count but it still has only one sentence and should be skipped.",
    "",
    "A longer paragraph opens with a claim about practical reason. A second sentence develops the argumentative stakes for the reader."
  ].join("\n");

  const paragraphs = splitParagraphs(markdown);
  const candidates = buildKeySentenceParagraphs(markdown, paragraphs, 40);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].paragraphIndex, 1);
  assert.equal(candidates[0].sentences.length, 2);
});

test("glossary markdown round-trips cache metadata", () => {
  const markdown = buildGlossaryMarkdown({
    term: "Transcendental Idealism",
    normalizedTerm: "transcendental idealism",
    aliases: ["TI"],
    sourcePaper: "paper/example.md",
    provider: "openai",
    model: "gpt-5.4-mini",
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    definition: "A context-aware definition.",
    sep: {
      status: "matched",
      query: "transcendental idealism",
      entryTitle: "Transcendental Idealism",
      entryUrl: "https://plato.stanford.edu/entries/transcendental-idealism/",
      summary: "A short SEP supplement.",
      sourceExcerpt: "A longer source excerpt.",
      revised: "2026-01-21",
      fetchedAt: "2026-01-02T00:00:00.000Z"
    },
    clusters: [{
      id: "cluster-1",
      label: "First",
      paragraphIndexes: [0],
      startOffset: 10,
      endOffset: 80,
      excerpt: "Excerpt",
      usageNote: "It frames the local argument."
    }]
  });

  const parsed = parseGlossaryMarkdown(markdown);
  assert.equal(parsed.term, "Transcendental Idealism");
  assert.equal(parsed.definition, "A context-aware definition.");
  assert.equal(parsed.sep.status, "matched");
  assert.equal(parsed.sep.entryUrl, "https://plato.stanford.edu/entries/transcendental-idealism/");
  assert.equal(parsed.clusters[0].usageNote, "It frames the local argument.");
  assert.match(markdown, /## SEP/);
});

test("legacy glossary markdown still parses without exposing removed fields", () => {
  const markdown = `---
term: "Transcendental Idealism"
normalizedTerm: "transcendental idealism"
aliases: ["TI"]
sourcePaper: "paper/example.md"
provider: "openai"
model: "gpt-5.4-mini"
created: "2026-01-01T00:00:00.000Z"
updated: "2026-01-01T00:00:00.000Z"
firstUse: "Introduced in the opening section."
definition: "A context-aware definition."
authorUsage: "The author uses it as a local contrast class."
sep_enabled: false
clusters: [{"id":"cluster-1","label":"First","paragraphIndexes":[0],"startOffset":10,"endOffset":80,"excerpt":"Excerpt","usageNote":"It frames the local argument."}]
---

# Transcendental Idealism

A context-aware definition.

## Author usage

The author uses it as a local contrast class.

## First use

Introduced in the opening section.

## Usage notes

### First

It frames the local argument.
`;

  const parsed = parseGlossaryMarkdown(markdown);
  assert.equal(parsed.term, "Transcendental Idealism");
  assert.equal(parsed.definition, "A context-aware definition.");
  assert.equal(parsed.clusters[0].usageNote, "It frames the local argument.");
  assert.equal("authorUsage" in parsed, false);
  assert.equal("firstUse" in parsed, false);
});

test("glossary markdown records SEP cache failures without breaking parse", () => {
  const markdown = buildGlossaryMarkdown({
    term: "Epistemic Luck",
    normalizedTerm: "epistemic luck",
    aliases: [],
    sourcePaper: "paper/example.md",
    provider: "openai",
    model: "gpt-5.4-mini",
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    definition: "A local definition.",
    sep: {
      status: "failed",
      query: "epistemic luck",
      entryTitle: "",
      entryUrl: "",
      summary: "",
      sourceExcerpt: "",
      revised: "",
      fetchedAt: "2026-01-02T00:00:00.000Z",
      error: "Timed out"
    },
    clusters: []
  });

  const parsed = parseGlossaryMarkdown(markdown);
  assert.equal(parsed.sep.status, "failed");
  assert.equal(parsed.sep.error, "Timed out");
  assert.match(markdown, /SEP enrichment failed/);
});

test("applySentenceHighlights is idempotent for the same sentence", () => {
  const markdown = "The first sentence frames the issue. The second sentence states the decisive claim. The third sentence applies it.";
  const paragraph = splitParagraphs(markdown)[0];
  const sentence = splitParagraphSentences(markdown, paragraph)[1];

  const highlighted = applySentenceHighlights(markdown, [sentence]);
  assert.equal(highlighted, "The first sentence frames the issue. ==The second sentence states the decisive claim.== The third sentence applies it.");
  assert.equal(applySentenceHighlights(highlighted, [sentence]), highlighted);
});

test("removeManagedSentenceHighlights removes only targeted highlights", () => {
  const markdown = "==The first sentence states the main claim.== The second sentence remains plain. ==The third sentence was highlighted manually.==";
  const cleaned = removeManagedSentenceHighlights(markdown, [
    {
      paragraphIndex: 0,
      text: "The first sentence states the main claim."
    }
  ]);

  assert.equal(cleaned, "The first sentence states the main claim. The second sentence remains plain. ==The third sentence was highlighted manually.==");
});

test("splitParagraphs strips sentence highlight markup from paragraph text", () => {
  const markdown = "==Transcendental idealism== structures the opening claim. A later sentence extends the same contrast.";
  const paragraphs = splitParagraphs(markdown);

  assert.equal(paragraphs[0].text, "Transcendental idealism structures the opening claim. A later sentence extends the same contrast.");
});

test("findPreparedTermAtPosition prefers longest matching term", () => {
  const entry = parseGlossaryMarkdown(buildGlossaryMarkdown({
    term: "transcendental idealism",
    normalizedTerm: "transcendental idealism",
    aliases: ["idealism"],
    sourcePaper: "paper/example.md",
    provider: "openai",
    model: "gpt-5.4-mini",
    created: "",
    updated: "",
    definition: "Definition",
    clusters: []
  }));
  const line = "Kant's transcendental idealism matters here.";
  const match = findPreparedTermAtPosition(line, line.indexOf("idealism") + 2, [entry]);
  assert.equal(match.term, "transcendental idealism");
});

test("chooseClusterForOffset returns containing or nearest cluster", () => {
  const entry = {
    clusters: [
      { id: "a", label: "A", startOffset: 10, endOffset: 20, paragraphIndexes: [], excerpt: "" },
      { id: "b", label: "B", startOffset: 100, endOffset: 120, paragraphIndexes: [], excerpt: "" }
    ]
  };

  assert.equal(chooseClusterForOffset(entry, 15).id, "a");
  assert.equal(chooseClusterForOffset(entry, 80).id, "b");
});

test("parseJsonFromText accepts fenced JSON", () => {
  const parsed = parseJsonFromText("```json\n{\"terms\":[{\"term\":\"form\"}]}\n```");
  assert.deepEqual(parsed, { terms: [{ term: "form" }] });
});

test("parseLooseJsonFromText repairs bare quotes inside string values", () => {
  const parsed = parseLooseJsonFromText(`[
    {
      "term": "metalinguistic negotiation",
      "definition": "The paper describes a "metalinguistic" use of a term.",
      "clusters": []
    }
  ]`);

  assert.equal(parsed[0].definition, "The paper describes a \"metalinguistic\" use of a term.");
});

test("findWordAtPosition ignores short words", () => {
  assert.equal(findWordAtPosition("the form of life", 1), null);
  assert.deepEqual(findWordAtPosition("the concept of form", 5), {
    word: "concept",
    from: 4,
    to: 11
  });
});

test("analyzeMarkdownQuality flags formula extraction failures", () => {
  const report = analyzeMarkdownQuality("The K axiom: (cid:3)(φ→ψ) and $\\boxed { \\phi }$");
  assert.equal(report.cidRefs, 1);
  assert.equal(report.boxedFormulaMarks, 1);
  assert.ok(report.suspiciousFormulaMarks >= 2);
  assert.notEqual(report.riskLevel, "ok");
});
