# Scholia

An Obsidian desktop plugin for importing academic PDFs, preparing them for close reading, and serving cached glossary explanations on hover.

## How to use it

The main entrypoint is Obsidian's Command Palette:

1. Open Obsidian.
2. Press `Cmd+P` on macOS or `Ctrl+P` on Windows/Linux.
3. Type part of the action name, such as `Import`, `Glossary`, or `Explain`.
4. Pick the action you want.

The most important commands are:

- `Import PDF and prepare for reading`
- `Convert current PDF to Markdown only`
- `Rebuild glossary for current paper`
- `Extract terms and explain from current Markdown`
- `Highlight key sentences for current paper`
- `Explain term now`

If you just want the normal workflow, use:

1. Convert a digital PDF into Markdown.
2. Optionally highlight key sentences.
3. Precompute context-aware glossary entries.
4. Read the paper in Obsidian with instant hover explanations from cache.

This plugin is designed for text-layer PDFs such as philosophy, logic, and adjacent humanities papers. Scanned OCR-heavy documents are out of scope for the current MVP.

## What Scholia does

- Imports a PDF into a per-paper folder inside your vault.
- Converts the PDF to Markdown with a configurable backend.
- Writes import diagnostics and warnings into `_source/`.
- Optionally highlights key sentences after import.
- Discovers likely technical terms and explains them in background batches.
- Stores glossary entries as normal Markdown files under `_glossary/`.
- Shows cached explanations on hover in the editor.
- Falls back to an explicit `Explain now` action when a term has not been prepared yet.

## Reading model

Scholia is intentionally cache-first:

- Hover does not call the LLM live.
- Term discovery and explanation happen after import.
- Glossary notes stay in your vault as inspectable Markdown artifacts.
- Definitions are grounded in the paper's local usage, not just generic dictionary glosses.

The default pipeline is:

```text
PDF import -> key sentence highlighting (optional) -> glossary preprocessing -> hover from cache
```

## Current import backends

The plugin currently supports three PDF import backends:

- `Paper2MDViaLLM` (default): LLM-native conversion path for digital academic PDFs.
- `Scholar-MD` (beta): lighter local converter for text-layer PDFs.
- `Marker CLI` (optional, not recommended): older fallback path.

`Paper2MDViaLLM` is the default path in the current codebase. `Scholar-MD` remains available for comparison and lighter local experiments. `Marker` is still supported, but the settings UI labels it as not recommended.

## Vault output layout

Importing a paper creates a folder like this:

```text
my-paper/
  my-paper.pdf
  my-paper.md
  _source/
    import-quality.json
    import-warnings.md
    key-sentences.json
    paper2mdviallm.md
  _glossary/
    _status.md
    term-a.md
    term-b.md
```

Possible backend-specific artifacts include:

- `_source/paper2mdviallm.md`
- `_source/scholar-md.md`
- `_source/scholar-md.diagnostics.json`

These files are meant to be inspectable. If import quality is medium or high risk, check `_source/import-warnings.md` before trusting formulas or symbols.

## Requirements

- Obsidian Desktop `>= 1.5.0`
- A local filesystem vault
- Node.js for building the plugin
- Python 3 for local PDF tool bootstrapping
- At least one API key:
  - OpenAI for GPT models
  - Anthropic for Claude models

Notes:

- The plugin is desktop-only.
- `Paper2MDViaLLM` needs an API key because conversion itself is LLM-backed.
- Hover explanations, glossary generation, and key-sentence selection also use the configured provider.
- API keys are currently stored in the plugin's Obsidian `data.json` so the plugin can stay compatible with Obsidian `1.5.0+`. If you later raise `minAppVersion`, migrating to `SecretStorage` is the cleaner review posture.

## Disclosures

- `Scholia` makes network requests to OpenAI and/or Anthropic when you run import, glossary generation, key-sentence selection, or `Explain term now`.
- SEP enrichment, when enabled, also fetches public Stanford Encyclopedia of Philosophy pages.
- The plugin reads PDFs and Markdown files from your vault and writes derived artifacts such as Markdown notes, `_source/*`, and `_glossary/*` back into the same vault.
- The plugin can execute user-configured local tools such as `paper2mdviallm`, `scholar-md`, or `marker_single`.
- The plugin does not include telemetry or ads.

## Install for local use

This repo is currently set up like a local plugin project rather than a packaged community release.

Place it under your vault's plugins directory, then build it:

```sh
npm install
npm run build
```

After that:

1. Open Obsidian.
2. Go to `Settings -> Community plugins`.
3. Enable `Scholia`.

Then the normal usage pattern is:

1. Open a PDF in your vault.
2. Press `Cmd+P` or `Ctrl+P`.
3. Type `Import`.
4. Choose `Import PDF and prepare for reading`.
5. Open the generated Markdown note and hover on prepared terms.

If you are actively developing, use:

```sh
npm run dev
```

## Optional local PDF tool setup

### Paper2MDViaLLM

Recommended user flow with the published `paper2mdviallm` package:

```sh
conda create -n scholia python=3.11
conda activate scholia
pip install paper2mdviallm
```

Then in `Settings -> Community plugins -> Scholia -> CLI path for paper2mdviallm`, set either:

- the full executable path, such as `/Users/me/miniconda3/envs/scholia/bin/paper2mdviallm`, or
- the environment root, such as `/Users/me/miniconda3/envs/scholia`

Scholia will resolve `bin/paper2mdviallm` on macOS/Linux or `Scripts/paper2mdviallm.exe` on Windows.

Current contributor flow from this repository:

```sh
tools/paper2mdviallm/bootstrap.sh
```

That installs the local development CLI at:

```text
.venv/bin/paper2mdviallm
```

You can then either:

- leave the CLI path as `paper2mdviallm` and let Scholia resolve it from `PATH`,
- click `Use local paper2mdviallm`, or
- paste the full path manually.

Conda environments work too. You can point Scholia at either:

- the executable itself, such as `/Users/me/miniconda3/envs/scholia/bin/paper2mdviallm`, or
- the environment root, such as `/Users/me/miniconda3/envs/scholia`, and Scholia will resolve the executable inside it.

On Windows, the equivalent is usually `C:\\Users\\you\\miniconda3\\envs\\scholia\\Scripts\\paper2mdviallm.exe`.

Use a direct path, not a shell fragment like `conda run -n scholia paper2mdviallm`.

The important mental model is:

- `conda` manages the Python environment
- `pip install paper2mdviallm` installs the CLI into that environment
- Scholia directly executes the resulting `paper2mdviallm` binary

### Scholar-MD

Bootstrap the local `scholar-md` CLI:

```sh
tools/scholar-md/bootstrap.sh
```

That installs:

```text
.venv/bin/scholar-md
```

When the backend is set to `Scholar-MD`, the plugin will prefer the local repo venv tool if it exists.

### Marker

Marker is optional and not the recommended default path.

If you want it for comparison:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-marker.txt
```

That installs `marker_single` into the repo venv. You can then point the plugin's `Marker CLI path` setting at the executable.

## Plugin settings

The settings tab is split into four groups.

### Markdown generation

- `PDF import backend`
- `CLI path for paper2mdviallm`
- `Markdown generation model`
- `Concurrency for paper2mdviallm`
- `CLI path for Marker`

For `Paper2MDViaLLM`, provider choice is inferred from the model name. The plugin injects the global OpenAI or Anthropic API key into the CLI environment. The CLI path can be a plain executable name, a direct executable path, or a conda/venv root.

### API keys

- `OpenAI key`
- `Anthropic key`

These are currently stored in the plugin's Obsidian `data.json` for compatibility with older supported Obsidian versions.

### Reading prep

- `Reading prep provider`
- `Reading prep model`
- `Auto highlight key sentences after import`
- `Key sentence density`

This controls post-import prep: key-sentence selection plus glossary discovery and explanation.

### Glossary

- `Max precomputed terms`
- `Glossary folder name`
- `Glossary explanation length`
- `Hover delay`

Glossary entries are written as Markdown files inside the paper folder, not hidden plugin storage.

## Typical workflow

### One-click reading prep

1. Open a PDF in Obsidian.
2. Press `Cmd+P` or `Ctrl+P`, type `Import`, and run `Import PDF and prepare for reading`.
3. Wait for background preprocessing to finish.
4. Open the generated Markdown note.
5. Hover over prepared terms to read cached explanations.

### Markdown-only import

1. Open a PDF.
2. Press `Cmd+P` or `Ctrl+P`, type `Convert`, and run `Convert current PDF to Markdown only`.
3. Inspect the note and `_source/import-warnings.md`.
4. Run `Extract terms and explain from current Markdown` when ready.

### Manual term explanation

1. Select a term in a Markdown note.
2. Press `Cmd+P` or `Ctrl+P`, type `Explain`, and run `Explain term now`.
3. The plugin writes a glossary note and future hovers use the cached result.

## Key sentence highlighting

When enabled, import runs key-sentence highlighting before glossary preprocessing.

Details:

- Highlights are written with Obsidian's native `==...==` syntax.
- Plugin-managed highlight bookkeeping lives in `_source/key-sentences.json`.
- Re-runs remove only the highlights previously managed by the plugin.
- Manual highlights outside that sidecar are left alone.

## Development

Install JavaScript dependencies:

```sh
npm install
```

Build the plugin:

```sh
npm run build
```

Run the plugin test suite:

```sh
npm test
```

Run the Python tool tests:

```sh
npm run test:paper2mdviallm
npm run test:scholar-md
```

Run the PDF evaluation harness:

```sh
npm run eval:pdf-tools
```

Useful optional variants:

```sh
PDF_EVAL_DOCS=anaf011,logic-of-provability npm run eval:pdf-tools
PDF_EVAL_MINERU=1 PDF_EVAL_DOCS=anaf011 npm run eval:pdf-tools
```

## Repo layout

```text
src/                  Obsidian plugin runtime
prompts/              LLM prompts for term discovery, explanation, and key sentences
tests/                Node-side tests
docs/                 design and pipeline notes
eval/pdf-tools/       PDF backend comparison harness
tools/paper2mdviallm/ LLM-native PDF to Markdown CLI
tools/scholar-md/     lightweight digital PDF to Markdown CLI
```

## Known boundaries

- The MVP targets digital PDFs with an existing text layer.
- Formula-heavy papers still need manual scrutiny.
- Import warnings are advisory, not proof of correctness.
- Hover is cache-only by design.
- SEP is not part of the first-pass import and hover workflow.

## Related docs

- [Reading pipeline](docs/reading-pipeline.md)
- [PDF tool evaluation](eval/pdf-tools/README.md)
- [Scholar-MD extraction plan](docs/scholar-md-extraction-plan.md)
