# scholar-md

`scholar-md` is a lightweight digital PDF to Obsidian Markdown converter for
humanities and adjacent formal papers. It targets PDFs that already have a text
layer. Scanned OCR is intentionally out of scope for the MVP.

The goal is not to recreate PDF pages. The goal is to recover reading
structure: reading order, paragraph boundaries, headings, footnotes, inline and
display formulas, special characters, header/footer removal, and multi-column
ordering.

## Install

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
```

## Run

```sh
scholar-md paper.pdf -o paper.md
scholar-md paper.pdf -o paper.md --emit-diagnostics
scholar-md paper.pdf -o paper.md --keep-page-breaks
```

Stable MVP interface:

```sh
scholar-md input.pdf \
  -o output.md \
  --llm-provider none \
  --model default \
  --footnote-format obsidian-block \
  --footnote-ref-style wikilink \
  --bibliography-links none \
  --bibliography-citation-style escaped \
  --emit-diagnostics \
  --keep-page-breaks
```

## Conversion Policy

- Preserve natural-language Unicode: Greek, Arabic, accents, IPA-like
  characters, curly quotes, and dashes are not ASCII-flattened.
- Repair extraction artifacts: ligatures, control characters, and common
  mojibake sequences are normalized.
- Convert math-context symbols to LaTeX: Greek variables, logic symbols,
  arrows, relations, superscripts, and subscripts are rendered for MathJax.
- Escape numeric bibliography citations such as `\[17\]` in the body by
  default, so Obsidian does not style them as links. References are collected
  under `## References` without links.
- Render superscript note references as Obsidian block links by default, e.g.
  `[[#^fn-002|2]]`, and collect linked notes under `## Notes`.
- Quarantine page-bottom author notes or unmatched note-like material under
  `## Unlinked Notes` instead of merging it into the body.
- Use LLMs only for low-confidence regions in later iterations; the MVP keeps
  the interface but does not rewrite whole documents.

## Diagnostics

With `--emit-diagnostics`, the converter writes a sidecar JSON file containing
page-level layout facts, removed headers/footers, detected formulas and
footnotes, low-confidence warnings, and source bounding boxes where available.
