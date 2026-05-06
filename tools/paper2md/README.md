# paper2md

`paper2md` is a Python CLI for converting digital academic PDFs into
Obsidian-friendly Markdown.

It is the external conversion backend used by the Scholia Obsidian plugin, but
it can also be installed and run on its own.

## Install

When `paper2md` is published to PyPI, install it into a dedicated environment:

```sh
conda create -n scholia python=3.11
conda activate scholia
pip install paper2md
```

For local development from this repository:

```sh
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pip install -e .
```

## Requirements

- Python 3.10+
- An OpenAI or Anthropic API key
- Digital PDFs with a text layer

The CLI reads API keys from the environment:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

## Usage

Inspect a PDF before conversion:

```sh
paper2md inspect paper.pdf
```

Convert a PDF to Markdown:

```sh
paper2md convert paper.pdf -o out/
```

Override the model or concurrency when needed:

```sh
paper2md convert paper.pdf -o out/ --model claude-sonnet-4-6 --concurrency 3
```

## With Scholia

After installing into a conda environment, point Scholia at either:

- the environment root, such as `/Users/me/miniconda3/envs/scholia`, or
- the concrete executable, such as `/Users/me/miniconda3/envs/scholia/bin/paper2md`

Scholia resolves the binary and executes it directly.

## Development

Run tests:

```sh
python -m pytest tests
```

Bootstrap from the repo root:

```sh
tools/paper2md/bootstrap.sh
```

## Boundaries

- The current target is digital PDFs, not OCR-heavy scanned documents.
- Formula-heavy papers still need manual inspection after conversion.
- The output is optimized for Obsidian reading workflows rather than general
  document fidelity.
