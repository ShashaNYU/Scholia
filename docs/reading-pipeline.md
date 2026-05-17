# Reading Pipeline

Scholia prepares imported papers in up to five stages:

1. PDF import writes a paper markdown file plus `_source/` artifacts.
2. Key-sentence highlighting optionally runs on the markdown file and writes `==...==` back into the note.
3. Glossary preprocessing discovers terms, explains them, and writes `_glossary/<term>.md`.
4. SEP enrichment optionally looks up matching Stanford Encyclopedia of Philosophy entries and updates the same glossary notes with cached SEP supplements.
5. Hover lookup reads only from the cached glossary notes at reading time.

## Current flow

### Import

- Entry points: `Scholia: Import PDF and Prepare for Reading` and `Scholia: Convert Current PDF to Markdown Only`.
- Import creates a per-paper folder, copies the PDF, writes `_source/` diagnostics, and creates the markdown note.
- If `Auto highlight key sentences after import` is enabled, the background pipeline becomes:
  `import -> key-sentence highlighting -> glossary preprocessing -> optional SEP enrichment`.
- If the toggle is disabled, import falls back to the previous behavior:
  `import -> glossary preprocessing -> optional SEP enrichment`.

### Key-sentence highlighting

- Trigger points:
  - Automatic after import when the setting is enabled.
  - Manual via `Scholia: Highlight Key Sentences for Current Paper`.
- The plugin splits eligible prose paragraphs into sentence candidates locally, then sends only `paragraphId` / `sentenceId` choices to the configured LLM provider.
- `Key sentence density` controls selection strictness:
  - `Medium` is the default and matches the current behavior.
  - `Sparse` highlights only structurally important sentences and omits most paragraphs.
- v1 limits:
  - At most one highlighted sentence per paragraph.
  - Single-sentence and very short paragraphs are skipped.
  - SEP is not involved in sentence selection.
  - Hover never calls the LLM live.

### SEP enrichment

- Trigger points:
  - Automatic after glossary preprocessing when `Enable SEP enrichment` is enabled.
  - Manual via `Scholia: Enrich Glossary with SEP for Current Paper`.
  - Single-term follow-up after `Explain now` when SEP enrichment is enabled.
- The plugin searches SEP with the canonical term first, then aliases.
- Clear title matches are selected locally; ambiguous candidates are disambiguated by the configured LLM provider using the paper-local definition and usage clusters.
- Once a SEP entry is selected, the plugin extracts the entry preamble, compresses it to a two-sentence supplement, and caches the result back into `_glossary/<term>.md`.
- SEP failures and no-match cases are cached too, so hover stays offline and repeated runs skip already resolved entries by default.

### Managed output

- Highlight syntax is Obsidian-native `==...==`.
- The plugin stores its own highlight bookkeeping in `_source/key-sentences.json`.
- Re-runs first remove only the highlights recorded in that sidecar, then compute fresh selections and write them back.
- The cleanup is targeted. It does not globally remove `==...==`, so unrelated manual highlighting remains untouched.

## Artifacts

- Paper note: `<paper>/<paper>.md`
- Highlight audit sidecar: `<paper>/_source/key-sentences.json`
- Import diagnostics: `<paper>/_source/import-quality.json`, `<paper>/_source/import-warnings.md`, backend-specific raw files
- Glossary cache: `<paper>/_glossary/<term>.md`
- Glossary status: `<paper>/_glossary/_status.md`

## Interfaces and boundaries

- Settings:
  - `autoHighlightKeySentences: boolean` controls whether import runs sentence highlighting before glossary generation.
  - `keySentenceDensity: "medium" | "sparse"` controls how selective the LLM should be.
  - `sepEnrichmentEnabled: boolean` controls whether glossary generation should append the SEP cache stage.
- Provider contract:
  - `selectKeySentences(...)` accepts a density value plus paragraph-local sentence ids and returns selected `paragraphId` / `sentenceId` pairs.
  - `chooseSepEntry(...)` selects one SEP candidate when local heuristics are ambiguous.
  - `summarizeSepEntry(...)` turns a SEP preamble into a two-sentence hover supplement.
- Core text utilities:
  - sentence splitting
  - applying managed sentence highlights
  - removing previously managed highlights from sidecar metadata
- SEP parsing utilities handle result-page extraction, preamble extraction, and candidate ranking without introducing a DOM parser dependency.
- Glossary schema now stores optional cached SEP metadata alongside the local term definition. Sentence highlighting remains a reading aid layered on top of the cache-first glossary pipeline.
