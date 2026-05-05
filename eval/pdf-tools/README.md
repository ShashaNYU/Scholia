# PDF Tool Evaluation

This harness compares digital PDF-to-Markdown/text tools against philosophy,
logic, and physics samples without copying the source PDFs into the repo.

## Run

```sh
npm run eval:pdf-tools
```

The runner writes outputs and `summary.json` under `eval/pdf-tools/output/`,
which is ignored by git.

Run only selected documents:

```sh
PDF_EVAL_DOCS=anaf011,logic-of-provability npm run eval:pdf-tools
```

Run MinerU as well:

```sh
PDF_EVAL_MINERU=1 PDF_EVAL_DOCS=anaf011 npm run eval:pdf-tools
```

## Tools

- `pdftotext -layout` is the installed baseline.
- `markitdown` runs when the CLI is available. The local install used here is
  `.eval-venv/bin/markitdown`.
- `scholar-md` runs from `tools/scholar-md/src` when a Python interpreter with
  PyMuPDF can import it. Install it into the eval venv with
  `.eval-venv/bin/pip install -e tools/scholar-md`.
- `mineru` runs only when `PDF_EVAL_MINERU=1` is set. MinerU is heavy: the
  local `mineru[all]` install made `.eval-venv/` roughly gigabyte-scale and
  first run downloads model files into the user model cache.

Missing tools are recorded as `skipped`; this lets the same harness work before
and after installing MarkItDown or MinerU.

## What To Inspect

- `summary.json`: per-document tool status, PDF metadata, image counts, font
  Unicode-map risk, and text-quality counters.
- Tool outputs: spot-check reading order, headers/footers, footnotes,
  hyphenation, and formulas.
- `scholar-md.diagnostics.json`: inspect detected columns, removed marginalia,
  formulas, footnotes, image placeholders, and low-confidence warnings.

For this project, formulas are a hard criterion. Control characters, mojibake,
`(cid:3)`, `6=` for `!=`, or arrow/Greek corruption should count as failures
even if the prose is readable. LaTeX-looking output is not automatically a pass:
for modal logic, `\boxed{...}` in place of the box operator is still a formula
failure.

## Current Findings

- MarkItDown is promising for ordinary philosophy prose, but formula-heavy TeX
  PDFs still produce `(cid:...)` placeholders and table-like Markdown fragments.
- MinerU pipeline mode cleaned a publisher article page better than MarkItDown,
  especially side-watermark text. On a modal-logic formula page, it produced
  LaTeX-like output but misrecognized the modal box as `\boxed{...}`, so formula
  accuracy is not yet acceptable.
- MinerU uses Python multiprocessing and model inference; in Codex sandbox it
  may need to be run outside the sandbox. In a normal terminal this should not
  matter.
