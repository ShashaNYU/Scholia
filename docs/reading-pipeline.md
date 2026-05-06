# Reading Pipeline

Philosophy Reader prepares imported papers in four stages:

1. PDF import writes a paper markdown file plus `_source/` artifacts.
2. Key-sentence highlighting optionally runs on the markdown file and writes `==...==` back into the note.
3. Glossary preprocessing discovers terms, explains them, and writes `_glossary/<term>.md`.
4. Hover lookup reads only from the cached glossary notes at reading time.

## Current flow

### Import

- Entry points: `Import PDF as Philosophy Paper` and `Convert Current PDF to Markdown`.
- Import creates a per-paper folder, copies the PDF, writes `_source/` diagnostics, and creates the markdown note.
- If `Auto highlight key sentences after import` is enabled, the background pipeline becomes:
  `import -> key-sentence highlighting -> glossary preprocessing`.
- If the toggle is disabled, import falls back to the previous behavior:
  `import -> glossary preprocessing`.

### Key-sentence highlighting

- Trigger points:
  - Automatic after import when the setting is enabled.
  - Manual via `Highlight Key Sentences for Current Paper`.
- The plugin splits eligible prose paragraphs into sentence candidates locally, then sends only `paragraphId` / `sentenceId` choices to the configured LLM provider.
- `Key sentence density` controls selection strictness:
  - `Medium` is the default and matches the current behavior.
  - `Sparse` highlights only structurally important sentences and omits most paragraphs.
- v1 limits:
  - At most one highlighted sentence per paragraph.
  - Single-sentence and very short paragraphs are skipped.
  - SEP is not involved.
  - Hover never calls the LLM live.

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
- Provider contract:
  - `selectKeySentences(...)` accepts a density value plus paragraph-local sentence ids and returns selected `paragraphId` / `sentenceId` pairs.
- Core text utilities:
  - sentence splitting
  - applying managed sentence highlights
  - removing previously managed highlights from sidecar metadata
- Glossary schema is unchanged. Sentence highlighting is a reading aid layered on top of the existing cache-first glossary pipeline.
