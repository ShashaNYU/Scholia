from __future__ import annotations

import re
from collections import Counter

from .formula import is_likely_math_text, math_density
from .models import InlineMarker, NoteProfile, PageLayout, TextLine, TextSpan
from .utils import clean_text

BRACKET_CITATION_RE = re.compile(r"^\[(?P<marker>\d{1,4})\]$")
BRACKET_CITATION_FIND_RE = re.compile(r"\[(?P<marker>\d{1,4})\]")
NOTE_MARKER_RE = re.compile(r"^\d{1,3}$|^[*†‡§]$")


def detect_note_profile(pages: list[PageLayout]) -> NoteProfile:
    bibliography_markers: set[str] = set()
    references_seen = False
    bracket_citations: Counter[str] = Counter()
    page_footnote_lines = 0

    for page in pages:
        for line in page.lines:
            text = clean_text(line.text)
            if re.match(r"^references\b", text, re.IGNORECASE):
                references_seen = True
            if references_seen:
                for match in BRACKET_CITATION_FIND_RE.finditer(text):
                    bibliography_markers.add(match.group("marker"))
            elif page.height * 0.12 < line.bbox.y0 < page.height * 0.9:
                for match in BRACKET_CITATION_FIND_RE.finditer(text):
                    bracket_citations[match.group("marker")] += 1
            if line.region == "footnote":
                page_footnote_lines += 1

    return NoteProfile(
        has_numeric_bibliography=bool(bibliography_markers) or (references_seen and bool(bracket_citations)),
        has_page_footnotes=page_footnote_lines > 0,
        has_endnotes=references_seen and page_footnote_lines == 0,
        bibliography_markers=bibliography_markers,
    )


def classify_inline_markers(pages: list[PageLayout], profile: NoteProfile) -> list[InlineMarker]:
    markers: list[InlineMarker] = []
    for page in pages:
        for line in page.lines:
            for span in line.spans:
                text = clean_text(span.text)
                bracket = BRACKET_CITATION_RE.match(text)
                if bracket and is_body_baseline_span(span, line):
                    marker = bracket.group("marker")
                    span.role = f"bibliographic_citation:{marker}"
                    markers.append(
                        InlineMarker(
                            kind="bibliographic_citation",
                            marker=marker,
                            page_num=page.page_num,
                            line_id=line.line_id,
                            bbox=span.bbox,
                            confidence=0.95 if profile.has_numeric_bibliography else 0.75,
                        )
                    )
                    continue

                if NOTE_MARKER_RE.match(text) and is_superscript_note_span(span, line, page):
                    span.role = f"note_ref:{text}"
                    markers.append(
                        InlineMarker(
                            kind="note_ref",
                            marker=text,
                            page_num=page.page_num,
                            line_id=line.line_id,
                            bbox=span.bbox,
                            confidence=0.9,
                        )
                    )
                    continue

                if NOTE_MARKER_RE.match(text) and is_math_subscript_or_label_number(span, line):
                    span.role = f"math_subscript:{text}"
                    markers.append(
                        InlineMarker(
                            kind="plain_number",
                            marker=text,
                            page_num=page.page_num,
                            line_id=line.line_id,
                            bbox=span.bbox,
                            confidence=0.85,
                        )
                    )
                    continue

                if text.isdigit():
                    markers.append(
                        InlineMarker(
                            kind="plain_number",
                            marker=text,
                            page_num=page.page_num,
                            line_id=line.line_id,
                            bbox=span.bbox,
                            confidence=0.8,
                        )
                    )
    return markers


def is_body_baseline_span(span: TextSpan, line: TextLine) -> bool:
    if span.size and line.font_size and abs(span.size - line.font_size) > line.font_size * 0.12:
        return False
    return span.bbox.y1 >= line.bbox.y0 + line.bbox.height * 0.7


def is_superscript_note_span(span: TextSpan, line: TextLine, page: PageLayout) -> bool:
    if line.region != "body":
        return False
    text = clean_text(span.text)
    if not NOTE_MARKER_RE.match(text):
        return False
    if span.role == "math" or math_density(line.text) > 0.18:
        return False
    if is_math_subscript_or_label_number(span, line):
        return False
    if span.size and line.font_size and span.size >= line.font_size * 0.88:
        return False
    if page.body_size and span.size >= page.body_size * 0.88:
        return False
    return span.bbox.y1 <= line.bbox.y0 + line.bbox.height * 0.72


def is_math_subscript_or_label_number(span: TextSpan, line: TextLine) -> bool:
    spans = sorted(line.spans, key=lambda item: item.bbox.x0)
    try:
        index = spans.index(span)
    except ValueError:
        return False
    previous = previous_text_span(spans, index)
    next_span = next_text_span(spans, index)
    previous_text = clean_text(previous.text) if previous else ""
    next_text = clean_text(next_span.text) if next_span else ""
    if not is_lower_small_span(span, previous, line):
        return False
    if previous and (
        previous.role == "math"
        or is_likely_math_text(previous.text, previous.font, line.text)
        or re.search(r"(?:[A-Z]|\bPr|\(NC|\bNC)$", previous_text)
    ):
        return True
    if previous_text in {"H", "E", "K", "Pr", "c", "r", "l", "∼H"}:
        return True
    if next_text.startswith((")", "]")) and previous_text:
        return True
    return False


def is_lower_small_span(span: TextSpan, previous: TextSpan | None, line: TextLine) -> bool:
    if previous is None:
        return False
    reference_size = line.font_size or previous.size or span.size
    if reference_size and span.size and span.size >= reference_size * 0.9:
        return False
    return span.bbox.y0 > previous.bbox.y0 + max(0.8, line.bbox.height * 0.08)


def previous_text_span(spans: list[TextSpan], index: int) -> TextSpan | None:
    for item in reversed(spans[:index]):
        if clean_text(item.text):
            return item
    return None


def next_text_span(spans: list[TextSpan], index: int) -> TextSpan | None:
    for item in spans[index + 1 :]:
        if clean_text(item.text):
            return item
    return None


def note_anchor(marker: str, page_num: int | None = None, duplicate: bool = False) -> str:
    normalized = marker.strip()
    if normalized.isdigit():
        base = f"fn-{int(normalized):03d}"
    else:
        names = {"*": "asterisk", "†": "dagger", "‡": "double-dagger", "§": "section"}
        base = f"fn-{names.get(normalized, 'symbol')}"
    if duplicate and page_num is not None:
        return f"{base}-p{page_num:03d}"
    return base


def note_label(marker: str, page_num: int | None = None, linked: bool = True) -> str:
    if linked:
        return marker
    if page_num is not None:
        return f"Page {page_num} note"
    return "Unlinked note"
