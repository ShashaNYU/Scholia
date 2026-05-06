const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseSepEntryHtml,
  parseSepSearchResults,
  pickSepCandidateHeuristically,
  stripHtml
} = require("../src/sep.js");

test("parseSepSearchResults extracts titles, urls, and snippets", () => {
  const html = `
  <div class="result_listing">
    <div class="result_title"><a class="l" href="https://plato.stanford.edu/search/r?entry=/entries/knowledge-analysis/">The Analysis of <b>Knowledge</b></a></div><!-- end result_title -->
    <div class="result_snippet">A classic SEP entry about <b>knowledge</b>.</div><!-- end result_snippet -->
    <div class="result_url"><a href="https://plato.stanford.edu/search/r?entry=/entries/knowledge-analysis/">https://plato.stanford.edu/entries/knowledge-analysis/</a></div><!-- end result_url -->
  </div><!-- end result_listing -->
  `;

  const results = parseSepSearchResults(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "The Analysis of Knowledge");
  assert.equal(results[0].url, "https://plato.stanford.edu/entries/knowledge-analysis/");
  assert.equal(results[0].snippet, "A classic SEP entry about knowledge.");
});

test("parseSepEntryHtml extracts preamble paragraphs and revision metadata", () => {
  const html = `
  <meta name="DCTERMS.modified" content="2026-01-21" />
  <h1>The Analysis of Knowledge</h1>
  <div id="preamble">
    <p>Knowledge concerns the attempt to explain what it is to know.</p>
    <p>SEP preambles often give the short conceptual orientation we want.</p>
  </div>
  <div id="toc"></div>
  `;

  const entry = parseSepEntryHtml(html, "https://plato.stanford.edu/entries/knowledge-analysis/");
  assert.equal(entry.title, "The Analysis of Knowledge");
  assert.equal(entry.revised, "2026-01-21");
  assert.equal(entry.paragraphs.length, 2);
  assert.match(entry.preamble, /short conceptual orientation/);
  assert.equal(entry.sourceUrl, "https://plato.stanford.edu/entries/knowledge-analysis/");
});

test("pickSepCandidateHeuristically prefers exact title matches", () => {
  const results = [
    {
      title: "Moral Luck",
      url: "https://plato.stanford.edu/entries/moral-luck/",
      snippet: "Includes a discussion of epistemic luck.",
      normalizedTitle: "moral luck"
    },
    {
      title: "Epistemic Luck",
      url: "https://plato.stanford.edu/entries/epistemic-luck/",
      snippet: "A dedicated entry.",
      normalizedTitle: "epistemic luck"
    }
  ];

  const picked = pickSepCandidateHeuristically(results, "Epistemic Luck", []);
  assert.equal(picked.candidate.title, "Epistemic Luck");
  assert.equal(picked.candidate.score >= 120, true);
});

test("stripHtml decodes entities and removes markup", () => {
  const text = stripHtml("<p>&ldquo;Knowledge&rdquo; &amp; justification&nbsp;matter.</p>");
  assert.equal(text, "“Knowledge” & justification matter.");
});
