from __future__ import annotations

import re
from typing import Any

from .formula import render_math, unicode_math_to_latex
from .models import DocumentPlan, ExtractedDocument, Footnote, PageLayout, TextLine, TextSpan
from .nodes import build_document_plan
from .notes import classify_inline_markers, detect_note_profile
from .paragraph import join_paragraph_lines
from .utils import clean_text, normalize_unicode


def build_markdown(
    metadata: dict[str, Any],
    pages: list[PageLayout],
    footnotes: list[Footnote],
    keep_headers: bool = False,
    keep_page_breaks: bool = False,
    include_footnotes: bool = True,
    footnote_format: str = "obsidian-block",
    footnote_ref_style: str = "wikilink",
    bibliography_links: str = "none",
    bibliography_citation_style: str = "escaped",
) -> str:
    document = ExtractedDocument(pdf_path="", metadata=metadata, pages=pages)
    profile = detect_note_profile(pages)
    inline_markers = classify_inline_markers(pages, profile)
    plan = build_document_plan(document, footnotes if include_footnotes else [], inline_markers)
    return render_markdown(
        plan,
        metadata,
        keep_page_breaks=keep_page_breaks,
        include_footnotes=include_footnotes,
        footnote_format=footnote_format,
        footnote_ref_style=footnote_ref_style,
        bibliography_links=bibliography_links,
        bibliography_citation_style=bibliography_citation_style,
    )


def render_markdown(
    plan: DocumentPlan,
    metadata: dict[str, Any],
    keep_page_breaks: bool = False,
    include_footnotes: bool = True,
    footnote_format: str = "obsidian-block",
    footnote_ref_style: str = "wikilink",
    bibliography_links: str = "none",
    bibliography_citation_style: str = "escaped",
) -> str:
    output: list[str] = []
    output.extend(render_frontmatter(metadata))
    output.append("")
    note_targets = build_note_target_lookup(plan.footnotes)
    last_page: int | None = None
    for index, node in enumerate(plan.nodes):
        if keep_page_breaks and node.page_num is not None and node.page_num != last_page:
            output.append(f"<!-- page: {node.page_num} -->")
            output.append("")
            last_page = node.page_num
        rendered = render_node(node, note_targets, footnote_format, footnote_ref_style, bibliography_citation_style)
        if rendered:
            output.append(rendered)
            next_kind = plan.nodes[index + 1].kind if index + 1 < len(plan.nodes) else ""
            if node.kind != "list_item" or next_kind != "list_item":
                output.append("")
    if include_footnotes:
        render_notes(output, plan.footnotes, footnote_format)
    render_references(output, plan, bibliography_links, bibliography_citation_style)
    return "\n".join(trim_repeated_blank_lines(output)).strip() + "\n"


def render_frontmatter(metadata: dict[str, Any]) -> list[str]:
    lines = ["---"]
    for key, value in metadata.items():
        if value is None or value == "":
            continue
        if isinstance(value, (int, float)):
            lines.append(f"{key}: {value}")
        else:
            escaped = str(value).replace('"', '\\"')
            lines.append(f'{key}: "{escaped}"')
    lines.append("---")
    return lines


def render_node(
    node: Any,
    note_targets: dict[tuple[str, int | None], Footnote],
    footnote_format: str = "obsidian-block",
    footnote_ref_style: str = "wikilink",
    bibliography_citation_style: str = "escaped",
) -> str:
    if node.kind == "heading":
        level = max(1, min(6, node.level or 2))
        text = render_lines(node.lines, note_targets, footnote_format, footnote_ref_style, bibliography_citation_style) if node.lines else clean_text(node.text)
        return f"{'#' * level} {text}"
    if node.kind == "paragraph":
        return render_lines(node.lines, note_targets, footnote_format, footnote_ref_style, bibliography_citation_style) if node.lines else clean_text(node.text)
    if node.kind == "blockquote":
        return render_blockquote(node.lines, note_targets, footnote_format, footnote_ref_style, bibliography_citation_style)
    if node.kind == "list_item":
        return (
            render_list_item(node, note_targets, footnote_format, footnote_ref_style, bibliography_citation_style)
            if node.lines
            else render_list_prefix(node) + strip_list_marker(clean_text(node.text))
        )
    if node.kind == "definition_item":
        return render_definition_item(node, note_targets, footnote_format, footnote_ref_style, bibliography_citation_style)
    if node.kind == "latex_display_formula":
        text = clean_text(node.text)
        return f"$$\n{text}\n$$" if text else ""
    if node.kind == "display_formula":
        text = strip_list_marker(clean_text(node.text))
        if not text:
            return ""
        return render_math(text, display=True)
    if node.kind == "figure":
        text = clean_text(node.text)
        return f"> [!figure] {text}" if text else "> [!figure]"
    return clean_text(node.text)


def render_lines(
    lines: list[TextLine],
    note_targets: dict[tuple[str, int | None], Footnote],
    footnote_format: str,
    footnote_ref_style: str = "wikilink",
    bibliography_citation_style: str = "escaped",
) -> str:
    return join_paragraph_lines(
        [render_line_text(line, note_targets, footnote_format, footnote_ref_style, bibliography_citation_style) for line in lines]
    )


def render_list_item(
    node: Any,
    note_targets: dict[tuple[str, int | None], Footnote],
    footnote_format: str,
    footnote_ref_style: str,
    bibliography_citation_style: str,
) -> str:
    lines = node.lines
    rendered_lines = [render_line_text(line, note_targets, footnote_format, footnote_ref_style, bibliography_citation_style) for line in lines]
    if rendered_lines:
        rendered_lines[0] = strip_list_marker(rendered_lines[0])
    text = join_paragraph_lines(rendered_lines)
    return f"{render_list_prefix(node)}{text}" if text else render_list_prefix(node).rstrip()


def render_blockquote(
    lines: list[TextLine],
    note_targets: dict[tuple[str, int | None], Footnote],
    footnote_format: str,
    footnote_ref_style: str,
    bibliography_citation_style: str,
) -> str:
    paragraphs = split_blockquote_paragraphs(lines)
    rendered: list[str] = []
    for index, paragraph in enumerate(paragraphs):
        text = render_lines(paragraph, note_targets, footnote_format, footnote_ref_style, bibliography_citation_style)
        if text:
            rendered.extend(f"> {line}" if line else ">" for line in text.splitlines())
        if index + 1 < len(paragraphs):
            rendered.append(">")
    return "\n".join(rendered)


def split_blockquote_paragraphs(lines: list[TextLine]) -> list[list[TextLine]]:
    paragraphs: list[list[TextLine]] = []
    current: list[TextLine] = []
    for line in lines:
        if not current:
            current = [line]
            continue
        previous = current[-1]
        line_height = max(previous.font_size, line.font_size, previous.bbox.height, line.bbox.height, 1.0)
        y_gap = line.bbox.y0 - previous.bbox.y1
        if y_gap > line_height * 0.55:
            paragraphs.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        paragraphs.append(current)
    return paragraphs


def render_list_prefix(node: Any) -> str:
    indent = "  " * max(0, getattr(node, "list_level", 0) or 0)
    if getattr(node, "list_kind", "unordered") == "ordered":
        index = getattr(node, "list_index", 0) or 1
        preserved_marker = clean_text(getattr(node, "list_marker", "") or "")
        if preserved_marker:
            return f"{indent}{format_list_marker(preserved_marker)} "
        if getattr(node, "list_level", 0) == 1:
            marker = f"{chr(ord('a') + max(0, index - 1))}."
        else:
            marker = f"{index}."
        return f"{indent}{marker} "
    return f"{indent}- "


def render_definition_item(
    node: Any,
    note_targets: dict[tuple[str, int | None], Footnote],
    footnote_format: str,
    footnote_ref_style: str,
    bibliography_citation_style: str,
) -> str:
    if len(node.lines) < 2:
        return "- " + clean_text(node.text)
    formula_line, gloss_line = node.lines[0], node.lines[1]
    formula_text = render_definition_formula(clean_text(formula_line.text))
    gloss_text = render_line_text(gloss_line, note_targets, footnote_format, footnote_ref_style, bibliography_citation_style)
    gloss_text = clean_text(gloss_text)
    if gloss_text.startswith("[") and gloss_text.endswith("]"):
        gloss_text = rf"\[{gloss_text[1:-1]}\]"
    return f"- {formula_text} — {gloss_text}".strip()


def render_definition_formula(text: str) -> str:
    match = re.match(r"^\((?P<label>[^)]+)\)\s*(?P<body>.*?)[.]?$", clean_text(text))
    if not match:
        return render_math(text)
    label = render_math(f"({match.group('label')})")
    body = clean_text(match.group("body"))
    return f"{label} {render_math(body)}" if body else label


def render_line_text(
    line: TextLine,
    note_targets: dict[tuple[str, int | None], Footnote] | None = None,
    footnote_format: str = "obsidian-block",
    footnote_ref_style: str = "wikilink",
    bibliography_citation_style: str = "escaped",
) -> str:
    if not line.spans:
        return clean_text(line.text)
    note_targets = note_targets or {}
    spans = sorted(line.spans, key=lambda item: item.bbox.x0)
    pieces: list[str] = []
    math_buffer: list[TextSpan] = []
    previous_span: TextSpan | None = None

    def flush_math() -> None:
        nonlocal previous_span
        if not math_buffer:
            return
        math_text = steal_trailing_math_operator(pieces, "".join(span.text for span in math_buffer))
        if attach_plain_prime_to_previous_token(pieces, math_text):
            previous_span = math_buffer[-1]
            math_buffer.clear()
            return
        append_piece(pieces, render_math(math_text), previous_span, math_buffer[0])
        previous_span = math_buffer[-1]
        math_buffer.clear()

    for index, span in enumerate(spans):
        if span.role.startswith("math_subscript:") and math_buffer:
            math_buffer.append(span)
            continue
        if should_buffer_as_math(span, spans, index, line):
            math_buffer.append(span)
            continue
        flush_math()
        if span.role.startswith("math_subscript:"):
            append_subscript_piece(pieces, span.role.split(":", 1)[1])
        else:
            rendered = render_non_math_span(span, note_targets, footnote_format, footnote_ref_style, bibliography_citation_style)
            append_piece(pieces, rendered, previous_span, span)
        previous_span = span
    flush_math()
    return clean_text("".join(pieces))


def render_non_math_span(
    span: TextSpan,
    note_targets: dict[tuple[str, int | None], Footnote],
    footnote_format: str,
    footnote_ref_style: str,
    bibliography_citation_style: str,
) -> str:
    if span.role.startswith("note_ref:"):
        marker = span.role.split(":", 1)[1]
        target = note_targets.get((marker, span.page_num)) or note_targets.get((marker, None))
        if not target:
            return clean_text(marker)
        if footnote_ref_style == "plain":
            return clean_text(marker)
        if footnote_format == "markdown":
            return f"[^{target.label or marker}]"
        link = f"[[#^{target.anchor}|{clean_text(marker)}]]"
        if footnote_ref_style == "html-sup":
            return f"<sup>{link}</sup>"
        return link
    if span.role.startswith("bibliographic_citation:"):
        return render_bibliographic_citation(span.text, bibliography_citation_style)
    return normalize_span_text(span.text)


def normalize_span_text(text: str) -> str:
    text = normalize_unicode(text)
    return re.sub(r"[ \t]+", " ", text)


def append_piece(pieces: list[str], piece: str, previous_span: TextSpan | None, current_span: TextSpan) -> None:
    if not piece:
        return
    piece = absorb_math_closing_delimiter(pieces, piece)
    if not piece:
        return
    if pieces and needs_inserted_space(pieces[-1], piece, previous_span, current_span):
        pieces.append(" ")
    pieces.append(piece)


def append_subscript_piece(pieces: list[str], marker: str) -> None:
    latex = unicode_math_to_latex(marker)
    if not latex:
        return
    if pieces and re.fullmatch(r"\$[^$\n]*\$", pieces[-1]):
        pieces[-1] = f"{pieces[-1][:-1]}_{{{latex}}}$"
        return
    if pieces and re.search(r"[A-Za-z0-9)\]}]$", pieces[-1]):
        pieces[-1] = f"{pieces[-1]}$_{{{latex}}}$"
        return
    pieces.append(f"$_{{{latex}}}$")


def absorb_math_closing_delimiter(pieces: list[str], piece: str) -> str:
    if not pieces or piece[:1] not in ")]}":
        return piece
    match = re.fullmatch(r"\$([^$\n]*)\$", pieces[-1])
    if not match:
        return piece
    opener_by_closer = {")": "(", "]": "[", "}": "{"}
    closer = piece[0]
    opener = opener_by_closer[closer]
    content = match.group(1)
    if content.count(opener) <= content.count(closer):
        return piece
    pieces[-1] = f"${content}{closer}$"
    return piece[1:]


def steal_trailing_math_operator(pieces: list[str], math_text: str) -> str:
    if not pieces or not math_text.startswith("("):
        return math_text
    match = re.search(r"(?P<iff>iﬀ|iff)?\s*Pr\s*$", pieces[-1])
    if not match:
        return math_text
    replacement = "iff " if match.group("iff") else ""
    pieces[-1] = pieces[-1][: match.start()] + replacement
    if not pieces[-1]:
        pieces.pop()
    return f"Pr{math_text}"


def should_buffer_as_math(span: TextSpan, spans: list[TextSpan], index: int, line: TextLine) -> bool:
    if span.role == "math":
        return True
    text = clean_text(span.text)
    if not text:
        return False
    previous_span = spans[index - 1] if index > 0 else None
    next_span = spans[index + 1] if index + 1 < len(spans) else None
    previous_math = previous_span is not None and (
        previous_span.role == "math" or previous_span.role.startswith("math_subscript:")
    )
    next_math = next_span is not None and (next_span.role == "math" or next_span.role.startswith("math_subscript:"))
    if text in {"&", "|", "=", "<", ">", "+", "-", "−", "/", ","} and (previous_math or next_math or line.region == "formula"):
        return True
    if re.fullmatch(r"(?:iff)?Pr", text) and next_span is not None and clean_text(next_span.text).startswith("("):
        return True
    return False


def strip_list_marker(text: str) -> str:
    return re.sub(
        r"^(?:[•·∙]|[-*]|\(\d{1,3}[′']\)|\d{1,3}[′'][.]?|\d{1,3}[.)]|\(?[a-z]\)|[xyz{])[\s.]*",
        "",
        clean_text(text),
    ).strip()


def attach_plain_prime_to_previous_token(pieces: list[str], math_text: str) -> bool:
    if clean_text(math_text) not in {"′", "’", "'"}:
        return False
    if not pieces:
        return False
    math_match = re.fullmatch(r"\$([A-Za-z0-9]+)\$", pieces[-1])
    if math_match:
        pieces[-1] = f"${math_match.group(1)}′$"
        return True
    if not re.search(r"[A-Za-z0-9]$", pieces[-1]):
        return False
    pieces[-1] += "′"
    return True


def format_list_marker(marker: str) -> str:
    cleaned = marker.strip()
    prime = re.fullmatch(r"\(?(\d{1,3})[′']\)?", cleaned)
    if prime:
        return f"{prime.group(1)}′."
    if cleaned.endswith((".", ")")):
        return cleaned
    return f"{cleaned}."


def render_bibliographic_citation(text: str, style: str) -> str:
    cleaned = clean_text(text)
    if style != "escaped":
        return cleaned
    match = re.fullmatch(r"\[(\d{1,4})\]", cleaned)
    if not match:
        return cleaned
    return rf"\[{match.group(1)}\]"


def needs_inserted_space(previous_piece: str, piece: str, previous_span: TextSpan | None, current_span: TextSpan) -> bool:
    if previous_span is None:
        return False
    if previous_piece.endswith((" ", "\n")) or piece.startswith((" ", "\n")):
        return False
    if piece[:1] in ",.;:!?)]}":
        return False
    if piece.startswith("[[#") and previous_piece.endswith("!"):
        return True
    if piece.startswith("[[#") or previous_piece.endswith("([[#") or previous_piece.endswith("<sup>"):
        return False
    if current_span.role.startswith("note_ref:") and re.fullmatch(r"\d{1,3}|[*†‡§]", piece):
        return False
    gap = current_span.bbox.x0 - previous_span.bbox.x1
    threshold = max(1.2, min(previous_span.size or 8, current_span.size or 8) * 0.18)
    return gap > threshold


def build_note_target_lookup(footnotes: list[Footnote]) -> dict[tuple[str, int | None], Footnote]:
    targets: dict[tuple[str, int | None], Footnote] = {}
    for note in footnotes:
        if not note.linked:
            continue
        targets[(note.marker, note.page_num)] = note
        targets.setdefault((note.marker, None), note)
    return targets


def is_heading(line: TextLine, page: PageLayout) -> bool:
    if not line.is_bold or page.body_size <= 0:
        return False
    if line.font_size >= page.body_size + 4:
        return True
    if line.font_size >= page.body_size + 2 and line.bbox.y0 < page.height * 0.35:
        return True
    return False


def render_heading(line: TextLine, page: PageLayout) -> str:
    if line.font_size >= page.body_size + 5:
        level = 1
    elif line.font_size >= page.body_size + 3:
        level = 2
    else:
        level = 3
    return f"{'#' * level} {render_line_text(line)}"


def render_notes(output: list[str], footnotes: list[Footnote], footnote_format: str) -> None:
    linked = [note for note in footnotes if note.linked]
    unlinked = [note for note in footnotes if not note.linked]
    if footnote_format == "markdown":
        if linked or unlinked:
            output.append("")
        for note in linked + unlinked:
            output.append(f"[^{note.label or note.marker}]: {clean_text(note.content)}")
        return
    if linked:
        output.append("## Notes")
        output.append("")
        for note in linked:
            output.extend(render_obsidian_note(note))
            output.append("")
    if unlinked:
        output.append("## Unlinked Notes")
        output.append("")
        for note in unlinked:
            output.extend(render_obsidian_note(note))
            output.append("")


def render_obsidian_note(note: Footnote) -> list[str]:
    label = clean_text(note.label or note.marker)
    lines = [f"> [!note]- {label}"]
    content_lines = clean_text(note.content).splitlines() or [""]
    for content_line in content_lines:
        lines.append(f"> {content_line}" if content_line else ">")
    lines.append("")
    lines.append(f"^{note.anchor}")
    return lines


def render_references(output: list[str], plan: DocumentPlan, bibliography_links: str, bibliography_citation_style: str) -> None:
    if not plan.references:
        return
    output.append("## References")
    output.append("")
    for entry in plan.references:
        line = f"{render_bibliographic_citation(f'[{entry.marker}]', bibliography_citation_style)} {clean_text(entry.text)}"
        if bibliography_links == "block" and entry.anchor:
            line = f"{line} ^{entry.anchor}"
        output.append(line)
        output.append("")


def trim_repeated_blank_lines(lines: list[str]) -> list[str]:
    trimmed: list[str] = []
    blank = False
    for line in lines:
        is_blank = line.strip() == ""
        if is_blank and blank:
            continue
        trimmed.append(line.rstrip())
        blank = is_blank
    return trimmed
