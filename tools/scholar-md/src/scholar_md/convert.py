from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .diagnostics import build_diagnostics
from .extract import extract_pdf
from .footnote import extract_and_link_footnotes
from .layout import prepare_layout
from .llm import LLMConfig, review_low_confidence_regions
from .markdown import render_markdown
from .models import Footnote
from .nodes import build_document_plan
from .notes import classify_inline_markers, detect_note_profile
from .polish import polish_markdown


@dataclass
class ConversionOptions:
    keep_headers: bool = False
    keep_page_breaks: bool = False
    include_footnotes: bool = True
    emit_diagnostics: bool = False
    diagnostics_output: str | None = None
    llm_provider: str = "none"
    model: str | None = None
    api_key: str | None = None
    footnote_format: str = "obsidian-block"
    footnote_ref_style: str = "wikilink"
    bibliography_links: str = "none"
    bibliography_citation_style: str = "escaped"


@dataclass
class ConversionResult:
    markdown_path: Path
    diagnostics_path: Path | None
    footnotes: list[Footnote]


def convert_pdf(pdf_path: str | Path, output_path: str | Path | None = None, options: ConversionOptions | None = None) -> ConversionResult:
    opts = options or ConversionOptions()
    pdf = Path(pdf_path)
    output = Path(output_path) if output_path else pdf.with_suffix(".md")

    document = extract_pdf(pdf)
    prepare_layout(document, keep_headers=opts.keep_headers)
    profile = detect_note_profile(document.pages)
    inline_markers = classify_inline_markers(document.pages, profile)
    footnotes = extract_and_link_footnotes(document.pages) if opts.include_footnotes else []
    plan = build_document_plan(document, footnotes, inline_markers)
    review_low_confidence_regions(
        document,
        LLMConfig(provider=opts.llm_provider, model=opts.model, api_key=opts.api_key),
    )
    markdown = render_markdown(
        plan,
        document.metadata,
        keep_page_breaks=opts.keep_page_breaks,
        include_footnotes=opts.include_footnotes,
        footnote_format=opts.footnote_format,
        footnote_ref_style=opts.footnote_ref_style,
        bibliography_links=opts.bibliography_links,
        bibliography_citation_style=opts.bibliography_citation_style,
    )
    polished = polish_markdown(markdown)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(polished.text, encoding="utf8")

    diagnostics_path: Path | None = None
    if opts.emit_diagnostics:
        diagnostics_path = Path(opts.diagnostics_output) if opts.diagnostics_output else output.with_suffix(".diagnostics.json")
        diagnostics_path.write_text(
            json.dumps(
                build_diagnostics(
                    document,
                    footnotes,
                    plan=plan,
                    polish_stats=polished.stats,
                    polish_warnings=polished.warnings,
                ),
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf8",
        )

    return ConversionResult(markdown_path=output, diagnostics_path=diagnostics_path, footnotes=footnotes)
