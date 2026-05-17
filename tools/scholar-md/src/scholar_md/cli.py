from __future__ import annotations

import argparse
import os
import sys

from .convert import ConversionOptions, convert_pdf


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="scholar-md",
        description="Convert a digital academic PDF to Obsidian-compatible Markdown.",
    )
    parser.add_argument("pdf_path", help="Input digital PDF path.")
    parser.add_argument("-o", "--output", default=None, help="Output Markdown path. Defaults to input basename with .md.")
    parser.add_argument("--llm-provider", choices=("none", "anthropic", "openai"), default="none")
    parser.add_argument("--model", default=None, help="Model name for targeted low-confidence review.")
    parser.add_argument("--api-key", default=None, help="LLM API key. Defaults to provider-specific environment variables.")
    parser.add_argument("--emit-diagnostics", action="store_true", help="Write a diagnostics JSON sidecar.")
    parser.add_argument("--diagnostics-output", default=None, help="Explicit diagnostics JSON output path.")
    parser.add_argument("--keep-page-breaks", action="store_true", help="Emit page break comments.")
    parser.add_argument("--keep-headers", action="store_true", help="Keep detected headers and footers.")
    parser.add_argument("--no-footnotes", action="store_true", help="Do not relink footnotes.")
    parser.add_argument(
        "--footnote-format",
        choices=("obsidian-block", "markdown"),
        default="obsidian-block",
        help="Footnote rendering style. Defaults to Obsidian block links.",
    )
    parser.add_argument(
        "--footnote-ref-style",
        choices=("plain", "wikilink", "html-sup"),
        default="wikilink",
        help="Inline note reference style. Defaults to Obsidian block wikilinks.",
    )
    parser.add_argument(
        "--bibliography-links",
        choices=("none", "block"),
        default="none",
        help="Whether to attach block IDs to bibliography entries. Defaults to no bibliography links.",
    )
    parser.add_argument(
        "--bibliography-citation-style",
        choices=("escaped", "plain"),
        default="escaped",
        help="Render numeric citations as escaped brackets by default to avoid Obsidian link styling.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    api_key = args.api_key or provider_api_key(args.llm_provider)
    options = ConversionOptions(
        keep_headers=args.keep_headers,
        keep_page_breaks=args.keep_page_breaks,
        include_footnotes=not args.no_footnotes,
        emit_diagnostics=args.emit_diagnostics,
        diagnostics_output=args.diagnostics_output,
        llm_provider=args.llm_provider,
        model=args.model,
        api_key=api_key,
        footnote_format=args.footnote_format,
        footnote_ref_style=args.footnote_ref_style,
        bibliography_links=args.bibliography_links,
        bibliography_citation_style=args.bibliography_citation_style,
    )
    try:
        result = convert_pdf(args.pdf_path, args.output, options)
    except RuntimeError as exc:
        print(f"scholar-md: {exc}", file=sys.stderr)
        return 2
    print(str(result.markdown_path))
    if result.diagnostics_path:
        print(str(result.diagnostics_path))
    return 0


def provider_api_key(provider: str) -> str | None:
    if provider == "anthropic":
        return os.environ.get("ANTHROPIC_API_KEY")
    if provider == "openai":
        return os.environ.get("OPENAI_API_KEY")
    return None


if __name__ == "__main__":
    raise SystemExit(main())
