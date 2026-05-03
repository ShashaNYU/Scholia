const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildContextClusters,
  buildGlossaryMarkdown,
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
  slugify,
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
    firstUse: "Introduced in the opening section.",
    definition: "A context-aware definition.",
    authorUsage: "The author uses it as a local contrast class.",
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
  assert.equal(parsed.clusters[0].usageNote, "It frames the local argument.");
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
    firstUse: "",
    definition: "Definition",
    authorUsage: "",
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
      "firstUse": "The paper describes a "metalinguistic" use of a term.",
      "clusters": []
    }
  ]`);

  assert.equal(parsed[0].firstUse, "The paper describes a \"metalinguistic\" use of a term.");
});

test("findWordAtPosition ignores short words", () => {
  assert.equal(findWordAtPosition("the form of life", 1), null);
  assert.deepEqual(findWordAtPosition("the concept of form", 5), {
    word: "concept",
    from: 4,
    to: 11
  });
});
